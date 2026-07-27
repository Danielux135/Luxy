// operaciones de git y gestion de worktrees aislados
import { mkdirSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

/** ejecuta git con argumentos separados, nunca por shell */
async function git(
  args: string[],
  cwd: string,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const result = await runProcess({ executable: 'git', args, cwd, timeoutMs });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

/** comprueba si una ruta es la raiz de un repositorio git */
export async function isGitRepository(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const result = await git(['rev-parse', '--is-inside-work-tree'], path, 20_000);
  return result.exitCode === 0 && result.stdout.trim() === 'true';
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
  if (!(await hasHead(repositoryPath))) {
    throw new GitError(
      'el repositorio no tiene ningun commit todavia',
      'crea el primer commit antes de lanzar tareas de edicion',
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

  const result = await git(
    ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'],
    repositoryPath,
    180_000,
  );
  if (result.exitCode !== 0) {
    throw new GitError(
      `no se pudo crear el worktree: ${result.stderr.trim() || result.stdout.trim()}`,
      'comprueba que no exista ya una rama con ese nombre',
    );
  }

  return { path: worktreePath, branch, baseRepository: repositoryPath };
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
export async function collectDiff(worktreePath: string, maxDiffBytes = 60_000): Promise<DiffSummary> {
  // se incluyen los archivos nuevos para que aparezcan en el diff
  await git(['add', '-A', '--intent-to-add'], worktreePath).catch(() => undefined);

  const [statusResult, statResult, diffResult] = await Promise.all([
    git(['status', '--porcelain=v1'], worktreePath),
    git(['diff', '--stat', 'HEAD'], worktreePath),
    git(['diff', 'HEAD'], worktreePath),
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

  const commit = await git(
    // se desactiva la firma para que no bloquee esperando una passphrase
    ['-c', 'commit.gpgsign=false', 'commit', '-m', message],
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
