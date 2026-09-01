// operaciones de git y gestion de worktrees aislados
import { cpSync, mkdirSync, existsSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { buildBranchName, isPathInside, containsTraversal } from '@luxy/shared';
import { runProcess } from './process.js';
import { worktreesDir } from './paths.js';

export class GitError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

const GIT_TIMEOUT_MS = 120_000;

const DEFAULT_GITIGNORE = [
  '# secretos locales',
  '.env',
  '.env.*',
  '!.env.example',
  '',
  '# dependencias y salidas generadas',
  'node_modules/',
  'dist/',
  'out/',
  'build/',
  'release/',
  '',
  '# archivos temporales',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '',
].join('\n');

/** ejecuta git con argumentos separados, nunca por shell */
async function git(
  args: string[],
  cwd: string,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const result = await runProcess({ executable: 'git', args, cwd, timeoutMs });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

/**
 * identidad de respaldo para confirmar cuando el equipo no tiene ninguna.
 *
 * un Windows recien instalado no trae user.name ni user.email, y entonces
 * `git commit` falla con "unable to auto-detect email address". Luxy no puede
 * quedarse sin poder confirmar el trabajo del modelo por eso.
 */
const FALLBACK_IDENTITY_ARGS = [
  '-c',
  'user.name=Luxy',
  '-c',
  'user.email=luxy@local.invalid',
] as const;

/**
 * indica si git puede resolver una identidad de autor en esta ruta.
 *
 * se pregunta a git en vez de leer la configuracion a mano porque la identidad
 * puede venir de cuatro sitios distintos (variables de entorno, config local,
 * global o de sistema) y solo git conoce la precedencia real.
 */
async function hasCommitIdentity(cwd: string): Promise<boolean> {
  const result = await git(['var', 'GIT_COMMITTER_IDENT'], cwd, 20_000);
  return result.exitCode === 0;
}

/** comprueba si una ruta es la raiz de un repositorio git */
export async function isGitRepository(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const result = await git(['rev-parse', '--is-inside-work-tree'], path, 20_000);
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}

/** prepara un proyecto editable que todavía no tiene repositorio Git. */
export async function ensureGitRepository(
  path: string,
): Promise<{ initialized: boolean; createdGitignore: boolean }> {
  if (!existsSync(path)) {
    throw new GitError(
      `la carpeta del proyecto no existe: "${path}"`,
      'corrige la ruta del proyecto en Ajustes y vuelve a intentarlo',
    );
  }
  if (!statSync(path).isDirectory()) {
    throw new GitError(
      `la ruta del proyecto no es una carpeta: "${path}"`,
      'elige una carpeta de proyecto en Ajustes y vuelve a intentarlo',
    );
  }
  if (await isGitRepository(path)) return { initialized: false, createdGitignore: false };

  const gitignorePath = join(path, '.gitignore');
  const createdGitignore = !existsSync(gitignorePath);
  if (createdGitignore) writeFileSync(gitignorePath, DEFAULT_GITIGNORE, 'utf8');

  const init = await git(['init', '--initial-branch=main'], path, 60_000);
  if (init.exitCode !== 0) {
    throw new GitError(
      `no se pudo inicializar el repositorio Git: ${init.stderr.trim() || init.stdout.trim()}`,
      'comprueba que la carpeta del proyecto permite escritura',
    );
  }

  const add = await git(['add', '-A'], path, 120_000);
  if (add.exitCode !== 0) {
    throw new GitError(
      `no se pudo preparar el estado inicial de Git: ${add.stderr.trim() || add.stdout.trim()}`,
    );
  }

  const commit = await git(
    [
      // el commit de arranque lo crea Luxy, no el usuario: aqui la identidad de
      // respaldo se usa siempre, no solo cuando falta la del equipo.
      ...FALLBACK_IDENTITY_ARGS,
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=',
      'commit',
      '--no-verify',
      '--allow-empty',
      '-m',
      'estado inicial',
    ],
    path,
    120_000,
  );
  if (commit.exitCode !== 0) {
    throw new GitError(
      `no se pudo crear el commit inicial: ${commit.stderr.trim() || commit.stdout.trim()}`,
    );
  }

  return { initialized: true, createdGitignore };
}

/** comprueba que el repositorio tiene HEAD, es decir, algun commit */
export async function hasHead(path: string): Promise<boolean> {
  const result = await git(['rev-parse', '--verify', 'HEAD'], path, 20_000);
  return result.exitCode === 0;
}

export async function currentBranch(path: string): Promise<string | null> {
  const result = await git(['rev-parse', '--abbrev-ref', 'HEAD'], path, 20_000);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function status(path: string): Promise<string> {
  const result = await git(['status', '--porcelain=v1'], path);
  return result.stdout;
}

/** lista los archivos modificados a partir de git status --porcelain */
export function parseModifiedFiles(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // el formato es "XY ruta"; se descartan los dos caracteres de estado
    .map((line) => line.slice(2).trim())
    // los renombrados aparecen como "origen -> destino"
    .map((path) => (path.includes(' -> ') ? path.split(' -> ')[1]!.trim() : path))
    .filter((path) => path.length > 0);
}

export interface Worktree {
  path: string;
  branch: string;
  baseRepository: string;
}

/**
 * crea un worktree aislado dentro de la carpeta local de luxy.
 * la carpeta principal del proyecto NUNCA se toca.
 */
export async function createWorktree(
  repositoryPath: string,
  shortId: string,
  prompt: string,
  baseDirectory: string = worktreesDir(),
): Promise<Worktree> {
  if (!(await isGitRepository(repositoryPath))) {
    throw new GitError(
      `"${repositoryPath}" no es un repositorio git`,
      'inicializalo con: git init && git add -A && git commit -m "inicial"',
    );
  }
  const branch = buildBranchName(shortId, prompt);
  const folderName = `${shortId.toLowerCase()}-${Date.now()}`;
  const worktreePath = resolve(join(baseDirectory, folderName));

  // el worktree debe quedar dentro de la carpeta de luxy, sin excepcion
  if (containsTraversal(worktreePath) || !isPathInside(worktreePath, resolve(baseDirectory))) {
    throw new GitError('la ruta calculada para el worktree no es segura');
  }

  mkdirSync(baseDirectory, { recursive: true });

  const hasInitialCommit = await hasHead(repositoryPath);
  // Un repositorio vacio puede entrar en el flujo aislado: la rama huerfana
  // nace sin historia y el commit aprobado sera su primer commit.
  const worktreeArgs = hasInitialCommit
    ? ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']
    : ['worktree', 'add', '--orphan', '-b', branch, worktreePath];
  const result = await git(worktreeArgs, repositoryPath, 180_000);
  if (result.exitCode !== 0) {
    throw new GitError(
      `no se pudo crear el worktree: ${result.stderr.trim() || result.stdout.trim()}`,
      'comprueba que no exista ya una rama con ese nombre',
    );
  }

  if (!hasInitialCommit) {
    // Un repositorio sin historial puede tener archivos sin seguimiento. Se
    // copian al worktree aislado para que el primer commit represente el
    // proyecto real; `.git` nunca cruza a la rama huérfana.
    cpSync(repositoryPath, worktreePath, {
      recursive: true,
      filter: (source) => source === repositoryPath || !source.split(sep).includes('.git'),
    });
  }

  return { path: worktreePath, branch, baseRepository: repositoryPath };
}

/** recupera un worktree anterior sin crear otra rama ni copiar el proyecto. */
export async function resumeWorktree(
  repositoryPath: string,
  worktreePath: string,
  baseDirectory: string,
): Promise<Worktree> {
  const resolvedWorktree = resolve(worktreePath);
  const resolvedBase = resolve(baseDirectory);
  if (
    containsTraversal(worktreePath) ||
    !isPathInside(resolvedWorktree, resolvedBase) ||
    !existsSync(resolvedWorktree)
  ) {
    throw new GitError('el worktree anterior no esta dentro de la carpeta segura de Luxy');
  }
  if (!(await isGitRepository(repositoryPath))) {
    throw new GitError('el proyecto base ya no es un repositorio Git');
  }

  const top = await git(['rev-parse', '--show-toplevel'], resolvedWorktree, 20_000);
  if (top.exitCode !== 0 || resolve(top.stdout.trim()) !== resolvedWorktree) {
    throw new GitError('el worktree anterior no corresponde a la carpeta registrada');
  }
  const branch = await currentBranch(resolvedWorktree);
  if (branch === null || !/^luxy\/[a-z0-9-]{1,180}$/.test(branch)) {
    throw new GitError('la rama del worktree anterior no es una rama de Luxy');
  }

  const listed = await git(['worktree', 'list', '--porcelain'], repositoryPath, 20_000);
  const block = listed.stdout.split(/\r?\n(?=worktree )/).find((entry) => {
    const firstLine = entry.split(/\r?\n/)[0] ?? '';
    return firstLine.startsWith('worktree ') && resolve(firstLine.slice('worktree '.length)) === resolvedWorktree;
  });
  if (listed.exitCode !== 0 || block === undefined || !block.includes(`branch refs/heads/${branch}`)) {
    throw new GitError('el worktree anterior ya no esta registrado en el proyecto base');
  }

  return { path: resolvedWorktree, branch, baseRepository: repositoryPath };
}

/**
 * elimina un worktree. exige que no queden cambios, salvo que se fuerce
 * explicitamente tras una aprobacion del usuario.
 */
export async function removeWorktree(
  worktree: Worktree,
  options: { force: boolean },
): Promise<void> {
  const dirty = (await status(worktree.path)).trim().length > 0;
  if (dirty && !options.force) {
    throw new GitError(
      'el worktree tiene cambios sin guardar',
      'aprueba el descarte desde telegram si quieres eliminarlo',
    );
  }

  const args = ['worktree', 'remove', worktree.path];
  if (options.force) args.push('--force');
  const result = await git(args, worktree.baseRepository);
  if (result.exitCode !== 0) {
    throw new GitError(`no se pudo eliminar el worktree: ${result.stderr.trim()}`);
  }

  // la rama solo se borra si se descarto el trabajo entero
  if (options.force) {
    await git(['branch', '-D', worktree.branch], worktree.baseRepository).catch(() => undefined);
  }
}

export interface DiffSummary {
  statusPorcelain: string;
  diffStat: string;
  diff: string;
  modifiedFiles: string[];
  filesChanged: number;
}

/**
 * recoge el estado del worktree tras ejecutar el proveedor.
 * el diff completo se recorta: telegram no puede con diffs enormes.
 */
/** ultimos mensajes de commit de la rama del worktree */
export async function gitLog(worktreePath: string, count = 5): Promise<string> {
  const result = await git(['log', `-${count}`, '--oneline'], worktreePath);
  return result.stdout;
}

export async function collectDiff(worktreePath: string, maxDiffBytes = 60_000): Promise<DiffSummary> {
  // se incluyen los archivos nuevos para que aparezcan en el diff
  await git(['add', '-A', '--intent-to-add'], worktreePath).catch(() => undefined);

  const diffBase = (await hasHead(worktreePath)) ? ['HEAD'] : [];
  const [statusResult, statResult, diffResult] = await Promise.all([
    git(['status', '--porcelain=v1'], worktreePath),
    git(['diff', '--stat', ...diffBase], worktreePath),
    git(['diff', ...diffBase], worktreePath),
  ]);

  const modifiedFiles = parseModifiedFiles(statusResult.stdout);
  let diff = diffResult.stdout;
  if (diff.length > maxDiffBytes) {
    diff = `${diff.slice(0, maxDiffBytes)}\n\n[diff recortado: ${diff.length} bytes en total]`;
  }

  return {
    statusPorcelain: statusResult.stdout,
    diffStat: statResult.stdout.trim(),
    diff,
    modifiedFiles,
    filesChanged: modifiedFiles.length,
  };
}

/**
 * crea un commit en el worktree. solo se llama tras una aprobacion explicita.
 * el mensaje se pasa como argumento separado, nunca por shell.
 */
export async function commitWorktree(
  worktreePath: string,
  message: string,
): Promise<{ ok: boolean; output: string }> {
  const add = await git(['add', '-A'], worktreePath);
  if (add.exitCode !== 0) return { ok: false, output: add.stderr };

  // este commit es trabajo del usuario, asi que su identidad manda. La de Luxy
  // solo entra cuando el equipo no tiene ninguna, para no borrar la autoria.
  const identity = (await hasCommitIdentity(worktreePath)) ? [] : [...FALLBACK_IDENTITY_ARGS];

  const commit = await git(
    [
      ...identity,
      // se desactiva la firma para que no bloquee esperando una passphrase
      '-c',
      'commit.gpgsign=false',
      // y se anulan los hooks: viven en .git/hooks del worktree, que es
      // territorio que el modelo puede haber tocado. Un pre-commit escrito por
      // el modelo seria ejecucion de codigo justo aqui.
      '-c',
      'core.hooksPath=',
      'commit',
      '--no-verify',
      '-m',
      message,
    ],
    worktreePath,
  );
  return { ok: commit.exitCode === 0, output: `${commit.stdout}\n${commit.stderr}`.trim() };
}

/**
 * comprueba que una ruta objetivo no escapa del worktree ni mediante symlinks.
 * resuelve los enlaces reales antes de comparar.
 */
export function assertInsideWorktree(candidate: string, worktreePath: string): void {
  if (containsTraversal(candidate)) {
    throw new GitError(`la ruta "${candidate}" contiene segmentos ".."`);
  }

  const root = resolve(worktreePath);
  const target = resolve(candidate);

  // comparacion textual primero, que ya descarta la mayoria de los casos
  if (!isPathInside(target, root)) {
    throw new GitError(`la ruta "${candidate}" queda fuera del worktree`);
  }

  // comprobacion real de enlaces simbolicos: un symlink dentro del worktree
  // podria apuntar a cualquier sitio del disco
  try {
    const realRoot = realpathSync(root);
    const realTarget = existsSync(target) ? realpathSync(target) : target;
    if (!isPathInside(realTarget, realRoot)) {
      throw new GitError(
        `la ruta "${candidate}" apunta fuera del worktree a traves de un enlace simbolico`,
      );
    }
  } catch (error) {
    if (error instanceof GitError) throw error;
    // si realpath falla, se mantiene el resultado de la comparacion textual
  }
}

/**
 * empuja la rama del worktree a su remoto.
 *
 * es la unica funcion de todo Luxy que puede publicar algo, y por eso:
 *   - el remoto y la rama se pasan explicitos, nunca salen de un modelo
 *   - se prohiben las opciones que convierten un push en otra cosa
 *   - sin hooks, por la misma razon que en el commit
 *
 * quien la llama DEBE haber comprobado antes allowPush y la doble confirmacion.
 * Esta funcion no sabe de politicas: solo ejecuta.
 */
export async function pushWorktree(
  worktreePath: string,
  branch: string,
  remote = 'origin',
): Promise<{ ok: boolean; output: string }> {
  if (!/^[a-zA-Z0-9._/-]{1,200}$/.test(branch) || branch.startsWith('-')) {
    throw new GitError(`nombre de rama no valido: ${branch}`);
  }
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(remote) || remote.startsWith('-')) {
    throw new GitError(`nombre de remoto no valido: ${remote}`);
  }

  const result = await git(
    ['-c', 'core.hooksPath=', 'push', '--no-verify', remote, `${branch}:${branch}`],
    worktreePath,
    300_000,
  );
  return { ok: result.exitCode === 0, output: `${result.stdout}
${result.stderr}`.trim() };
}
