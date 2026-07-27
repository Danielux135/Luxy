// cola local de eventos: si el gateway no responde, nada se pierde.
// los eventos se persisten en disco y se reenvian cuando vuelve la conexion.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { JobEventInput, JobEventType } from '@luxy/shared';
import { redact } from '@luxy/shared';
import { stateDir } from './paths.js';

interface QueuedEvent extends JobEventInput {
  jobId: string;
}

export interface EventSender {
  sendEvents(jobId: string, events: JobEventInput[], renewLeaseSeconds?: number): Promise<void>;
}

/**
 * cola con persistencia y envio por lotes.
 * la secuencia es monotona por trabajo, y el gateway ignora duplicados por
 * (job_id, sequence), asi que reenviar es seguro.
 */
export class EventQueue {
  private pending: QueuedEvent[] = [];
  private readonly sequences = new Map<string, number>();
  private readonly file: string;
  private flushing = false;

  constructor(
    private readonly sender: EventSender,
    private readonly options: {
      directory?: string;
      maxPending?: number;
      renewLeaseSeconds?: number;
      onError?: (error: unknown) => void;
    } = {},
  ) {
    const directory = options.directory ?? stateDir();
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'pending-events.json');
    this.restore();
  }

  /** recupera los eventos que quedaron sin enviar en una ejecucion anterior */
  private restore(): void {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(raw)) return;
      this.pending = raw as QueuedEvent[];
      // se continua la numeracion desde el maximo recuperado
      for (const event of this.pending) {
        const current = this.sequences.get(event.jobId) ?? -1;
        if (event.sequence > current) this.sequences.set(event.jobId, event.sequence);
      }
    } catch {
      // un archivo corrupto no debe impedir arrancar
      this.pending = [];
    }
  }

  /** escritura atomica: primero un temporal, luego rename */
  private persist(): void {
    try {
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.pending), 'utf8');
      renameSync(temporary, this.file);
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  /** siguiente numero de secuencia de un trabajo */
  nextSequence(jobId: string): number {
    const next = (this.sequences.get(jobId) ?? -1) + 1;
    this.sequences.set(jobId, next);
    return next;
  }

  /** encola un evento. no envia nada por si mismo. */
  push(jobId: string, type: JobEventType, message: string, metadata?: Record<string, unknown>): void {
    const event: QueuedEvent = {
      jobId,
      sequence: this.nextSequence(jobId),
      type,
      // se redacta al encolar, para que un secreto nunca llegue ni al disco
      message: redact(message).slice(0, 4000),
      metadata,
      clientCreatedAt: new Date().toISOString(),
    };
    this.pending.push(event);

    // si la cola crece sin control se descartan los eventos de log mas antiguos,
    // que son los menos importantes. las fases y errores se conservan.
    const maxPending = this.options.maxPending ?? 2000;
    if (this.pending.length > maxPending) {
      const keep = this.pending.filter((item) => item.type !== 'log' && item.type !== 'provider_output');
      this.pending = keep.length > maxPending / 2 ? keep.slice(-maxPending) : this.pending.slice(-maxPending);
    }
    this.persist();
  }

  /**
   * intenta enviar todo lo pendiente.
   * si falla, los eventos siguen en la cola para el siguiente intento.
   */
  async flush(): Promise<boolean> {
    if (this.flushing || this.pending.length === 0) return true;
    this.flushing = true;

    try {
      // se agrupan por trabajo, porque el endpoint es por trabajo
      const byJob = new Map<string, QueuedEvent[]>();
      for (const event of this.pending) {
        byJob.set(event.jobId, [...(byJob.get(event.jobId) ?? []), event]);
      }

      const delivered = new Set<QueuedEvent>();
      for (const [jobId, events] of byJob) {
        // el endpoint acepta como maximo 50 eventos por peticion
        for (let index = 0; index < events.length; index += 50) {
          const batch = events.slice(index, index + 50);
          try {
            await this.sender.sendEvents(
              jobId,
              batch.map(({ jobId: _jobId, ...rest }) => rest),
              this.options.renewLeaseSeconds,
            );
            for (const event of batch) delivered.add(event);
          } catch (error) {
            this.options.onError?.(error);
            // se deja de intentar con este trabajo, pero se guarda lo entregado
            break;
          }
        }
      }

      if (delivered.size > 0) {
        this.pending = this.pending.filter((event) => !delivered.has(event));
        this.persist();
      }
      return this.pending.length === 0;
    } finally {
      this.flushing = false;
    }
  }

  get size(): number {
    return this.pending.length;
  }

  /** descarta los eventos de un trabajo, tras confirmarse su cierre */
  forget(jobId: string): void {
    this.pending = this.pending.filter((event) => event.jobId !== jobId);
    this.sequences.delete(jobId);
    this.persist();
  }
}
