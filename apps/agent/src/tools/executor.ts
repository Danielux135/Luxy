// ejecutor de herramientas.
//
// Todo lo que un modelo puede hacer sobre un proyecto pasa por aqui. Las reglas
// que no se negocian:
//
//   1. TODA ruta pasa por confinePath. Sin excepciones.
//   2. Los comandos de prueba salen de la configuracion del proyecto. El modelo
//      elige CUAL ejecutar (por indice), nunca QUE se ejecuta.
//   3. Escribir exige allowEdits. La puerta se comprueba aqui, no en la interfaz.
//   4. Los limites son techos duros: al alcanzarlos la herramienta falla con
//      explicacion en vez de seguir gastando.
//   5. Toda invocacion queda auditada, con los argumentos redactados.
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { redact, type AgentToolName, type ModelLimits, type ProjectConfig } from '@luxy/shared';
import { confinePath, isForbiddenName, PathConfinementError } from './confine.js';
import { TOOL_SCHEMAS, TOOL_DESCRIPTIONS, isToolName } from './definitions.js';
import { status as gitStatus, collectDiff } from '../git.js';
import { runProjectTests } from '../test-runner.js';
import {
  detectManifestChanges,
  describeManifestChanges,
  snapshotManifests,
  type ManifestSnapshot,
} from './manifest-guard.js';

/** tope de salida por herramienta: protege el contexto del modelo y la memoria */
const MAX_OUTPUT_CHARS = 20_000;
/** tope de un archivo leido de una vez */
const MAX_FILE_BYTES = 512_000;

export interface ToolInvocation {
  tool: AgentToolName;
  /** argumentos ya redactados, solo para mostrar y auditar */
  detail: string;
  ok: boolean;
  durationMs: number;
}

export interface ToolContext {
  /** raiz permitida: el worktree del trabajo */
  root: string;
  project: ProjectConfig;
  limits: ModelLimits;
  allowedTools: readonly AgentToolName[];
  signal: AbortSignal;
  /** se invoca por cada herramienta ejecutada, para auditar y para la interfaz */
  onInvocation: (invocation: ToolInvocation) => void;
}

export interface ToolResult {
  ok: boolean;
  /** contenido que se devuelve al modelo, ya recortado y redactado */
  content: string;
}

export class ToolLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolLimitError';
  }
}

/** contadores acumulados durante un trabajo */
interface Counters {
  filesRead: number;
  bytesRead: number;
  filesChanged: number;
  steps: number;
}

export class ToolExecutor {
  private readonly counters: Counters = { filesRead: 0, bytesRead: 0, filesChanged: 0, steps: 0 };
  /** archivos distintos modificados, para no contar dos veces el mismo */
  private readonly changed = new Set<string>();
  /**
   * huella de los manifiestos al empezar. Si el modelo los cambia, las
   * comprobaciones dejan de ejecutarse solas: `npm test` ejecuta lo que ponga
   * package.json, asi que un manifiesto editado por el modelo es codigo suyo.
   */
  private readonly manifestsAtStart: ManifestSnapshot;

  constructor(private readonly context: ToolContext) {
    this.manifestsAtStart = snapshotManifests(context.root);
  }

  get stepsUsed(): number {
    return this.counters.steps;
  }

  get filesChanged(): number {
    return this.changed.size;
  }

  /**
   * ejecuta una herramienta pedida por el modelo.
   *
   * nunca lanza: un fallo se devuelve como resultado para que el modelo pueda
   * corregirse. Lo que si corta el bucle son los limites.
   */
  async execute(name: string, rawArgs: unknown): Promise<ToolResult> {
    const started = Date.now();

    const finish = (ok: boolean, content: string, detail: string): ToolResult => {
      this.context.onInvocation({
        tool: isToolName(name) ? name : 'read_file',
        detail: redact(detail).slice(0, 300),
        ok,
        durationMs: Date.now() - started,
      });
      return { ok, content: redact(content).slice(0, MAX_OUTPUT_CHARS) };
    };

    if (!isToolName(name)) {
      return finish(false, `la herramienta "${name}" no existe`, name);
    }
    if (!this.context.allowedTools.includes(name)) {
      return finish(false, `la herramienta "${name}" no esta habilitada para este modelo`, name);
    }

    this.counters.steps += 1;
    if (this.counters.steps > this.context.limits.maxToolSteps) {
      throw new ToolLimitError(
        `se alcanzo el limite de ${this.context.limits.maxToolSteps} pasos de herramienta`,
      );
    }
    if (this.context.signal.aborted) {
      throw new ToolLimitError('el trabajo se cancelo');
    }

    // la escritura exige que el proyecto lo permita. Se comprueba aqui, en el
    // agente, y no solo en la interfaz de Telegram.
    if (TOOL_DESCRIPTIONS[name].mutating && !this.context.project.allowEdits) {
      return finish(false, 'este proyecto no permite modificar archivos', name);
    }

    const parsed = TOOL_SCHEMAS[name].safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const detalle = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`)
        .join('; ');
      return finish(false, `argumentos invalidos (${detalle})`, name);
    }

    try {
      const { content, detail } = await this.dispatch(name, parsed.data as never);
      return finish(true, content, detail);
    } catch (error) {
      if (error instanceof ToolLimitError) throw error;
      const message =
        error instanceof PathConfinementError
          ? `ruta rechazada: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      return finish(false, message, name);
    }
  }

  // ---------------------------------------------------------------------------

  private resolve(candidate: string): string {
    return confinePath({ root: this.context.root, candidate });
  }

  /**
   * decide si una entrada de directorio se puede visitar.
   *
   * los recorridos usaban join() y statSync() directamente, y eso SIGUE los
   * enlaces: un symlink dentro del worktree apuntando a ..\.env se habria
   * leido. El worktree se crea desde el repositorio del usuario, asi que puede
   * contener enlaces que Luxy no ha creado.
   */
  private canVisit(entry: { name: string; isSymbolicLink(): boolean }, full: string): boolean {
    if (entry.name === '.git' || entry.name === 'node_modules') return false;
    if (isForbiddenName(entry.name)) return false;
    // un enlace no se sigue nunca: ni para listar, ni para leer, ni para bajar
    if (entry.isSymbolicLink()) return false;
    try {
      // y ademas se confirma que la ruta real sigue dentro de la raiz
      this.resolve(full);
      return true;
    } catch {
      return false;
    }
  }

  private relativeToRoot(absolute: string): string {
    return relative(this.context.root, absolute).split(sep).join('/') || '.';
  }

  private countRead(bytes: number): void {
    this.counters.filesRead += 1;
    this.counters.bytesRead += bytes;
    if (this.counters.filesRead > this.context.limits.maxFilesRead) {
      throw new ToolLimitError(
        `se alcanzo el limite de ${this.context.limits.maxFilesRead} archivos leidos`,
      );
    }
    if (this.counters.bytesRead > this.context.limits.maxBytesRead) {
      throw new ToolLimitError('se alcanzo el limite de bytes leidos');
    }
  }

  private countChange(absolute: string): void {
    this.changed.add(absolute);
    if (this.changed.size > this.context.limits.maxFilesChanged) {
      throw new ToolLimitError(
        `se alcanzo el limite de ${this.context.limits.maxFilesChanged} archivos modificados`,
      );
    }
  }

  private async dispatch(
    name: AgentToolName,
    args: Record<string, never>,
  ): Promise<{ content: string; detail: string }> {
    switch (name) {
      case 'list_files':
        return this.listFiles(args as never);
      case 'read_file':
        return this.readFile(args as never);
      case 'search_files':
        return this.searchFiles(args as never);
      case 'search_text':
        return this.searchText(args as never);
      case 'write_file':
        return this.writeFile(args as never);
      case 'apply_patch':
        return this.applyPatch(args as never);
      case 'delete_file':
        return this.deleteFile(args as never);
      case 'git_status':
        return this.gitStatus();
      case 'git_diff':
        return this.gitDiff();
      case 'run_tests':
      case 'run_lint':
      case 'run_build':
        return this.runConfiguredCommand(name, args as never);
    }
  }

  private listFiles({ path, recursive }: { path: string; recursive: boolean }): {
    content: string;
    detail: string;
  } {
    const absolute = this.resolve(path);
    const entries: string[] = [];

    const walk = (current: string, depth: number): void => {
      if (entries.length >= 500) return;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (!this.canVisit(entry, full)) continue;

        entries.push(`${entry.isDirectory() ? 'dir ' : 'file'} ${this.relativeToRoot(full)}`);
        if (recursive && entry.isDirectory() && depth < 6) walk(full, depth + 1);
      }
    };

    walk(absolute, 0);
    return {
      content: entries.length === 0 ? '(carpeta vacia)' : entries.join('\n'),
      detail: path,
    };
  }

  private readFile({
    path,
    startLine,
    endLine,
  }: {
    path: string;
    startLine?: number;
    endLine?: number;
  }): { content: string; detail: string } {
    const absolute = this.resolve(path);
    const stats = statSync(absolute);
    if (stats.size > MAX_FILE_BYTES) {
      throw new Error(`el archivo ocupa ${stats.size} bytes, mas del maximo permitido`);
    }
    this.countRead(stats.size);

    const text = readFileSync(absolute, 'utf8');
    if (startLine === undefined) return { content: text, detail: path };

    const lines = text.split(/\r?\n/);
    const from = Math.max(0, startLine - 1);
    const to = endLine === undefined ? lines.length : Math.min(lines.length, endLine);
    return { content: lines.slice(from, to).join('\n'), detail: `${path}:${startLine}-${to}` };
  }

  private searchFiles({ pattern, path }: { pattern: string; path: string }): {
    content: string;
    detail: string;
  } {
    const absolute = this.resolve(path);
    // glob simple: solo * y ?, nunca una expresion regular del modelo
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
      'i',
    );
    const found: string[] = [];

    const walk = (current: string, depth: number): void => {
      if (found.length >= 200 || depth > 8) return;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (!this.canVisit(entry, full)) continue;
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (regex.test(entry.name)) found.push(this.relativeToRoot(full));
      }
    };

    walk(absolute, 0);
    return {
      content: found.length === 0 ? '(sin coincidencias)' : found.join('\n'),
      detail: `${pattern} en ${path}`,
    };
  }

  private searchText({
    query,
    path,
    maxResults,
  }: {
    query: string;
    path: string;
    maxResults: number;
  }): { content: string; detail: string } {
    const absolute = this.resolve(path);
    const results: string[] = [];
    const needle = query.toLowerCase();

    const walk = (current: string, depth: number): void => {
      if (results.length >= maxResults || depth > 8) return;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (results.length >= maxResults) return;
        const full = join(current, entry.name);
        if (!this.canVisit(entry, full)) continue;

        if (entry.isDirectory()) {
          walk(full, depth + 1);
          continue;
        }
        let stats;
        try {
          stats = statSync(full);
        } catch {
          continue;
        }
        if (stats.size > MAX_FILE_BYTES) continue;
        this.countRead(stats.size);

        let text: string;
        try {
          text = readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        text.split(/\r?\n/).forEach((line, index) => {
          if (results.length >= maxResults) return;
          if (line.toLowerCase().includes(needle)) {
            results.push(`${this.relativeToRoot(full)}:${index + 1}: ${line.trim().slice(0, 200)}`);
          }
        });
      }
    };

    walk(absolute, 0);
    return {
      content: results.length === 0 ? '(sin coincidencias)' : results.join('\n'),
      detail: `"${query}" en ${path}`,
    };
  }

  private writeFile({ path, content }: { path: string; content: string }): {
    content: string;
    detail: string;
  } {
    const absolute = this.resolve(path);
    this.countChange(absolute);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
    return {
      content: `escrito ${this.relativeToRoot(absolute)} (${content.length} caracteres)`,
      detail: path,
    };
  }

  private applyPatch({
    path,
    find,
    replace,
  }: {
    path: string;
    find: string;
    replace: string;
  }): { content: string; detail: string } {
    const absolute = this.resolve(path);
    const original = readFileSync(absolute, 'utf8');

    const first = original.indexOf(find);
    if (first === -1) {
      throw new Error('el fragmento a sustituir no aparece en el archivo');
    }
    // coincidencia unica obligatoria: adivinar cual de varias es la buena seria
    // una fuente silenciosa de cambios equivocados
    if (original.indexOf(find, first + 1) !== -1) {
      throw new Error('el fragmento aparece varias veces; incluye mas contexto para desambiguarlo');
    }

    this.countChange(absolute);
    writeFileSync(absolute, original.replace(find, replace), 'utf8');
    return { content: `parche aplicado en ${this.relativeToRoot(absolute)}`, detail: path };
  }

  private deleteFile({ path }: { path: string }): { content: string; detail: string } {
    const absolute = this.resolve(path);
    this.countChange(absolute);
    unlinkSync(absolute);
    return { content: `borrado ${this.relativeToRoot(absolute)}`, detail: path };
  }

  private async gitStatus(): Promise<{ content: string; detail: string }> {
    const porcelain = await gitStatus(this.context.root);
    return { content: porcelain.length === 0 ? '(sin cambios)' : porcelain, detail: 'git status' };
  }

  private async gitDiff(): Promise<{ content: string; detail: string }> {
    const summary = await collectDiff(this.context.root);
    return {
      content: summary.diff.length === 0 ? '(sin cambios)' : summary.diff,
      detail: 'git diff',
    };
  }

  /**
   * ejecuta uno de los comandos configurados para el proyecto.
   *
   * el modelo solo elige el INDICE. El contenido del comando sale de
   * config.json y pasa por la lista blanca de test-runner, igual que antes.
   */
  private async runConfiguredCommand(
    name: 'run_tests' | 'run_lint' | 'run_build',
    { commandIndex }: { commandIndex?: number },
  ): Promise<{ content: string; detail: string }> {
    // sellado del vector npm run: si cambio un manifiesto, no se ejecuta
    const changes = detectManifestChanges(this.context.root, this.manifestsAtStart);
    if (changes.length > 0) {
      return { content: describeManifestChanges(changes), detail: `${name} (bloqueado)` };
    }

    const commands = this.context.project.testCommands;
    if (commands.length === 0) {
      return {
        content: 'este proyecto no tiene comandos de comprobacion configurados',
        detail: name,
      };
    }

    const selected = commandIndex === undefined ? undefined : commands[commandIndex];
    if (commandIndex !== undefined && selected === undefined) {
      throw new Error(
        `no existe el comando ${commandIndex}; hay ${commands.length} configurados`,
      );
    }

    // se reutiliza el ejecutor de pruebas tal cual, con su lista blanca y su
    // validacion de argumentos: solo se acota que comandos entran
    const results = await runProjectTests({
      workingDirectory: this.context.root,
      project: {
        ...this.context.project,
        testCommands: selected === undefined ? commands : [selected],
        testTimeoutMs: Math.min(
          this.context.limits.maxCommandDurationMs,
          this.context.project.testTimeoutMs,
        ),
      },
      signal: this.context.signal,
      onEvent: () => undefined,
    });

    const lines = results.map(
      (result) =>
        `${result.passed ? 'OK  ' : 'FALLO'} ${result.command} ${result.args.join(' ')}\n` +
        `${result.stdoutTail.slice(-2000)}\n${result.stderrTail.slice(-1000)}`,
    );
    return { content: lines.join('\n---\n'), detail: `${name} (${results.length} comandos)` };
  }
}
