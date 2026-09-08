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

/** el nombre por defecto: es el log del AGENTE y asi se ha llamado siempre */
export const DEFAULT_LOG_BASENAME = 'luxy';

/** escapa lo que pueda tener significado dentro de una expresion regular */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class AgentLogger {
  private readonly file: string;
  /** solo los rotados de ESTE log; nunca los de otro que comparta carpeta */
  private readonly rotatedPattern: RegExp;
  private readonly recent: string[] = [];

  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly directory: string = logsDir(),
    private readonly toConsole = true,
    /**
     * nombre base del archivo, sin extension.
     *
     * PARAMETRIZARLO NO ES GENERALIDAD GRATUITA: Studio necesita su propio log
     * en la MISMA carpeta que el del agente, y el nombre estaba cableado en
     * tres sitios que tenian que moverse juntos —el archivo, el nombre al rotar
     * y el patron de limpieza—. Cambiar solo el primero dejaba a un logger
     * borrando los archivos rotados del otro, porque la limpieza filtraba por
     * `luxy-*.log` a secas y despues los BORRA.
     */
    private readonly baseName: string = DEFAULT_LOG_BASENAME,
  ) {
    mkdirSync(this.directory, { recursive: true });
    this.file = join(this.directory, `${this.baseName}.log`);
    this.rotatedPattern = new RegExp(`^${escapeForRegExp(this.baseName)}-.*\\.log$`);
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
      renameSync(this.file, join(this.directory, `${this.baseName}-${stamp}.log`));
      // se conservan solo los ultimos archivos rotados
      const rotated = readdirSync(this.directory)
        .filter((name) => this.rotatedPattern.test(name))
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
