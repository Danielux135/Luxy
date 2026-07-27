// logs estructurados en json con redaccion automatica de secretos
import { redactDeep, redact } from '@luxy/shared';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  [key: string]: unknown;
}

export class Logger {
  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly base: LogFields = {},
  ) {}

  /** crea un logger hijo que arrastra campos fijos, por ejemplo el requestId */
  child(fields: LogFields): Logger {
    return new Logger(this.minLevel, { ...this.base, ...fields });
  }

  private write(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: redact(message),
      ...(redactDeep({ ...this.base, ...fields }) as LogFields),
    };
    // una sola linea json por evento, legible desde `wrangler tail`
    console.log(JSON.stringify(entry));
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
}

/** convierte cualquier error en algo serializable y sin secretos */
export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: redact(error.message) };
  }
  return { name: 'UnknownError', message: redact(String(error)) };
}
