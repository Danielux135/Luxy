// ejecucion de procesos hijos.
//
// REGLA INNEGOCIABLE: siempre spawn con ejecutable y argumentos separados.
// NUNCA se usa exec, ni shell: true, ni se construye una linea de comandos
// concatenando texto que venga de telegram o de un archivo del proyecto.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { isWindows } from './paths.js';
import { redact, buildSafeEnv } from '@luxy/shared';
import {
  resolveFromCandidates,
  getCachedResolution,
  setCachedResolution,
  assertSafeForCmd,
  type ResolvedExecutable,
} from './resolve-executable.js';

export interface SpawnRequest {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** nombres de variables de entorno que se permiten heredar */
  envAllowList?: string[];
  /** variables adicionales explicitas (por ejemplo la clave de una api http) */
  extraEnv?: Record<string, string>;
  /** texto que se escribe en stdin y se cierra */
  stdin?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /** maximo de bytes que se conservan de cada flujo */
  maxCaptureBytes?: number;
}

export interface SpawnResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
}

/**
 * variables minimas que casi cualquier herramienta necesita en windows.
 * NUNCA se hereda el entorno completo: eso filtraria claves al proceso hijo.
 */
export const BASE_ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'LANG',
  'HOME',
  'SHELL',
  'USER',
];

export class ProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessError';
  }
}

/** busca todas las rutas de un ejecutable con where.exe (o which en posix) */
function locateCandidates(name: string): string[] {
  try {
    const result = spawnSync(isWindows ? 'where.exe' : 'which', [name], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 10_000,
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') return [];
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * traduce un nombre de ejecutable a algo que spawn pueda lanzar sin shell.
 * en windows desreferencia los shims .cmd (npm, claude, codex, flutter).
 */
export function resolveExecutable(name: string): ResolvedExecutable {
  // una ruta absoluta ya la dio quien llama: se usa tal cual
  if (isAbsolute(name)) return { command: name, prefixArgs: [], source: name };

  const cached = getCachedResolution(name);
  if (cached !== undefined) {
    return cached ?? { command: name, prefixArgs: [], source: name };
  }

  const resolved = resolveFromCandidates(name, locateCandidates(name));
  setCachedResolution(name, resolved);
  // si no se pudo resolver se intenta el nombre a secas: puede ser un .exe del PATH
  return resolved ?? { command: name, prefixArgs: [], source: name };
}

/**
 * mata el arbol completo de procesos.
 * en windows un `kill` al padre deja huerfanos (por ejemplo node dentro de cmd),
 * asi que se usa taskkill /T /F, que es la unica forma fiable.
 */
export function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined || child.killed) return;

  if (isWindows) {
    try {
      // taskkill se invoca tambien con spawn y argumentos separados
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        // si taskkill no esta disponible se recurre al kill normal
        try {
          child.kill('SIGKILL');
        } catch {
          /* el proceso ya habia terminado */
        }
      });
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* el proceso ya habia terminado */
      }
    }
    return;
  }

  // en posix se mata el grupo entero, creado con detached: true
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* el proceso ya habia terminado */
    }
  }
}

/** acumulador que conserva solo la cola del flujo, para no agotar la memoria */
class TailBuffer {
  private data = '';

  constructor(private readonly maxBytes: number) {}

  push(chunk: string): void {
    this.data += chunk;
    if (this.data.length > this.maxBytes) {
      this.data = this.data.slice(this.data.length - this.maxBytes);
    }
  }

  toString(): string {
    return this.data;
  }
}

/**
 * ejecuta un proceso con timeout y cancelacion reales.
 * nunca lanza por codigo de salida distinto de cero: eso lo decide quien llama.
 */
export function runProcess(request: SpawnRequest): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const maxCapture = request.maxCaptureBytes ?? 200_000;
    const stdout = new TailBuffer(maxCapture);
    const stderr = new TailBuffer(maxCapture);

    const env = {
      ...buildSafeEnv(process.env, request.envAllowList ?? BASE_ENV_ALLOWLIST),
      ...(request.extraEnv ?? {}),
    };

    // el shim .cmd se desreferencia aqui: spawn recibe siempre un binario real
    const resolved = resolveExecutable(request.executable);

    // si el destino es un .bat que obliga a pasar por cmd.exe, los argumentos
    // se validan para que ninguno pueda escapar del comando
    if (resolved.requiresCmd) {
      try {
        assertSafeForCmd(request.args);
      } catch (error) {
        reject(
          new ProcessError(
            `no se puede ejecutar "${request.executable}" con seguridad: ${String(error)}`,
          ),
        );
        return;
      }
    }

    const finalArgs = [...resolved.prefixArgs, ...request.args];

    let child: ChildProcess;
    try {
      child = spawn(resolved.command, finalArgs, {
        cwd: request.cwd,
        env,
        // shell SIEMPRE false: es la barrera contra command injection
        shell: false,
        windowsHide: true,
        // en posix se crea un grupo propio para poder matar el arbol
        detached: !isWindows,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new ProcessError(`no se pudo lanzar "${request.executable}": ${String(error)}`));
      return;
    }

    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, request.timeoutMs);

    const onAbort = (): void => {
      cancelled = true;
      killProcessTree(child);
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => {
      stdout.push(chunk);
      // el callback recibe la salida ya redactada
      request.onStdout?.(redact(chunk));
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr.push(chunk);
      request.onStderr?.(redact(chunk));
    });

    if (typeof request.stdin === 'string') {
      child.stdin?.end(request.stdin);
    } else {
      // se cierra stdin para que la herramienta no se quede esperando entrada
      child.stdin?.end();
    }

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProcessError(`fallo ejecutando "${request.executable}": ${error.message}`));
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode: code,
        signal,
        stdout: redact(stdout.toString()),
        stderr: redact(stderr.toString()),
        durationMs: Date.now() - startedAt,
        timedOut,
        cancelled,
      });
    });
  });
}

/**
 * localiza un ejecutable. en windows se usa where.exe, como pide el diseño.
 * devuelve la primera ruta encontrada o null.
 */
export async function which(executable: string): Promise<string | null> {
  try {
    const result = await runProcess({
      executable: isWindows ? 'where.exe' : 'which',
      args: [executable],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0) return null;
    const first = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}
