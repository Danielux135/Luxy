// cola local de resultados finales.
//
// un trabajo no deja de existir porque el gateway este caido justo al cerrar.
// El resultado se escribe primero en disco y solo se borra cuando el gateway
// confirma la recepcion. Los endpoints finales son idempotentes para que un
// reenvio despues de perder la respuesta no duplique notificaciones.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  jobCancelledRequestSchema,
  jobCompleteRequestSchema,
  jobFailRequestSchema,
  redactDeep,
} from '@luxy/shared';
import type { JobCancelledRequest, JobCompleteRequest, JobFailRequest } from '@luxy/shared';
import { stateDir } from './paths.js';

const queuedOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    jobId: z.string().min(1).max(64),
    kind: z.literal('completed'),
    payload: jobCompleteRequestSchema,
    createdAt: z.string(),
  }),
  z.object({
    jobId: z.string().min(1).max(64),
    kind: z.literal('failed'),
    payload: jobFailRequestSchema,
    createdAt: z.string(),
  }),
  z.object({
    jobId: z.string().min(1).max(64),
    kind: z.literal('cancelled'),
    payload: jobCancelledRequestSchema,
    createdAt: z.string(),
  }),
]);

type QueuedOutcome = z.infer<typeof queuedOutcomeSchema>;

export interface OutcomeSender {
  completeJob(jobId: string, payload: JobCompleteRequest): Promise<void>;
  failJob(jobId: string, payload: JobFailRequest): Promise<void>;
  reportCancelled(jobId: string, payload: JobCancelledRequest): Promise<void>;
}

export class OutcomeQueue {
  private pending: QueuedOutcome[] = [];
  private readonly file: string;
  private flushing = false;

  constructor(
    private readonly sender: OutcomeSender,
    options: { directory?: string; onError?: (error: unknown) => void } = {},
  ) {
    const directory = options.directory ?? stateDir();
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'pending-outcomes.json');
    this.onError = options.onError;
    this.restore();
  }

  private readonly onError: ((error: unknown) => void) | undefined;

  private restore(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = z
        .array(queuedOutcomeSchema)
        .safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      this.pending = parsed.success ? parsed.data : [];
    } catch {
      // un estado corrupto no impide arrancar; nunca se ejecuta su contenido
      this.pending = [];
    }
  }

  private persist(pending: QueuedOutcome[] = this.pending): void {
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(pending), 'utf8');
    renameSync(temporary, this.file);
  }

  private replace(outcome: QueuedOutcome): void {
    // un trabajo solo puede tener un resultado final. Reemplazar evita que un
    // error de control genere dos cierres incompatibles para el mismo id.
    this.pending = [...this.pending.filter((item) => item.jobId !== outcome.jobId), outcome];
    try {
      this.persist();
    } catch (error) {
      // se conserva en memoria y se impide la entrega hasta que una escritura
      // posterior confirme que el resultado ya es recuperable tras un corte.
      this.onError?.(error);
      throw error;
    }
  }

  pushCompleted(jobId: string, payload: JobCompleteRequest): void {
    this.replace({
      jobId,
      kind: 'completed',
      payload: jobCompleteRequestSchema.parse(redactDeep(payload)),
      createdAt: new Date().toISOString(),
    });
  }

  pushFailed(jobId: string, payload: JobFailRequest): void {
    this.replace({
      jobId,
      kind: 'failed',
      payload: jobFailRequestSchema.parse(redactDeep(payload)),
      createdAt: new Date().toISOString(),
    });
  }

  pushCancelled(jobId: string, payload: JobCancelledRequest): void {
    this.replace({
      jobId,
      kind: 'cancelled',
      payload: jobCancelledRequestSchema.parse(redactDeep(payload)),
      createdAt: new Date().toISOString(),
    });
  }

  private async send(outcome: QueuedOutcome): Promise<void> {
    switch (outcome.kind) {
      case 'completed':
        await this.sender.completeJob(outcome.jobId, outcome.payload);
        break;
      case 'failed':
        await this.sender.failJob(outcome.jobId, outcome.payload);
        break;
      case 'cancelled':
        await this.sender.reportCancelled(outcome.jobId, outcome.payload);
        break;
    }
  }

  /** intenta entregar todos los cierres; los fallidos permanecen en disco */
  async flush(): Promise<boolean> {
    if (this.flushing) return this.pending.length === 0;
    this.flushing = true;
    try {
      // persistir antes de cualquier envio es la barrera de durabilidad. Si el
      // disco falla no se llama al gateway y el cierre permanece en memoria.
      try {
        this.persist();
      } catch (error) {
        this.onError?.(error);
        return false;
      }

      for (const outcome of [...this.pending]) {
        try {
          await this.send(outcome);
          const remaining = this.pending.filter((item) => item !== outcome);
          // se actualiza primero el disco. Si falla, se conserva el elemento
          // en memoria y un reenvio idempotente resolvera la ambiguedad.
          this.persist(remaining);
          this.pending = remaining;
        } catch (error) {
          this.onError?.(error);
        }
      }
      return this.pending.length === 0;
    } finally {
      this.flushing = false;
    }
  }

  has(jobId: string): boolean {
    return this.pending.some((outcome) => outcome.jobId === jobId);
  }

  get size(): number {
    return this.pending.length;
  }
}
