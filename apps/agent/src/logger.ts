// logger con rotacion por tamaño y redaccion automatica
import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { redact, redactDeep } from '@luxy/shared';
import { logsDir } from './paths.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// tamaño maximo de un archivo de log antes de rotar
const MAX_LOG_BYTES = 5 * 1024 * 1024;
// numero de archivos rotados que se conservan
const MAX_LOG_FILES = 5;

export interface LogFields {
  [key: string]: unknown;
}

export class AgentLogger {
  private readonly file: string;
  private readonly recent: string[] = [];

  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly directory: string = logsDir(),
    private readonly toConsole = true,
  ) {
    mkdirSync(this.directory, { recursive: true });
    this.file = join(this.directory, 'luxy.log');
  }

  private rotateIfNeeded(): void {
    try {
      const stats = statSync(this.file);
      if (stats.size < MAX_LOG_BYTES) return;
    } catch {
      // el archivo aun no existe: no hay nada que rotar
      return;
    }

    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      renameSync(this.file, join(this.directory, `luxy-${stamp}.log`));
      // se conservan solo los ultimos archivos rotados
      const rotated = readdirSync(this.directory)
        .filter((name) => /^luxy-.*\.log$/.test(name))
        .sort()
        .reverse();
      for (const name of rotated.slice(MAX_LOG_FILES)) {
        try {
          unlinkSync(join(this.directory, name));
        } catch {
          /* si no se puede borrar, no es critico */
        }
      }
    } catch {
      /* si falla la rotacion se sigue escribiendo en el mismo archivo */
    }
  }

  private write(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: redact(message),
      ...(redactDeep(fields) as LogFields),
    };
    const line = JSON.stringify(entry);

    // buffer en memoria que alimenta la interfaz local
    this.recent.push(line);
    if (this.recent.length > 200) this.recent.shift();

    if (this.toConsole) {
      const suffix = Object.keys(fields).length > 0 ? ` ${JSON.stringify(redactDeep(fields))}` : '';
      console.log(`[${level}] ${entry.msg}${suffix}`);
    }

    try {
      this.rotateIfNeeded();
      appendFileSync(this.file, `${line}\n`, 'utf8');
    } catch {
      // si el disco falla, los logs de consola siguen funcionando
    }
  }

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields);
  }

  /** ultimas lineas, que muestra la interfaz local */
  tail(count = 50): string[] {
    return this.recent.slice(-count);
  }

  get logFile(): string {
    return this.file;
  }
}

export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: redact(error.message) };
  return { name: 'UnknownError', message: redact(String(error)) };
}
