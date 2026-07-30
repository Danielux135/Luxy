// registro de avance de un trabajo por lotes.
//
// POR QUE LO ESCRIBE LUXY Y NO EL MODELO
//
// La idea intuitiva es pedirle al modelo que apunte en un .txt lo que ya ha
// hecho y que al volver lo lea. Suena bien y falla: si el modelo se despista,
// se salta cien registros o los procesa dos veces, y nadie se entera. La
// contabilidad no puede depender del que ejecuta.
//
// Aqui el bucle es codigo. El modelo solo transforma el trozo que se le da y
// no sabe que existe un registro. Reanudar es exacto porque lo que se apunta
// es un hecho comprobado, no lo que alguien dice que hizo.
//
// FORMATO: JSONL, una linea por lote. Se elige por dos razones concretas:
//   * se escribe anadiendo al final, asi que un corte de luz a mitad pierde
//     como maximo la ultima linea, no el archivo entero
//   * una linea corrupta se descarta sola sin invalidar las demas
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

/** resultado de un lote, tal y como queda registrado */
export const batchRecordSchema = z.object({
  /** indice del lote, empezando en 0 */
  batch: z.number().int().nonnegative(),
  /** primer y ultimo registro del lote, ambos incluidos */
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  status: z.enum(['done', 'failed']),
  /** cuantos registros devolvio el modelo para este lote */
  items: z.number().int().nonnegative().default(0),
  /** huella del contenido de entrada: detecta que el origen cambio */
  inputHash: z.string().min(8).max(64),
  error: z.string().max(500).nullable().default(null),
  durationMs: z.number().int().nonnegative().default(0),
  at: z.string(),
});

export type BatchRecord = z.infer<typeof batchRecordSchema>;

/**
 * lleva la cuenta de los lotes ya procesados.
 *
 * no guarda los resultados: solo QUE lotes estan hechos. Los resultados van a
 * su propio archivo, porque pueden ser gigas y esto tiene que caber en memoria.
 */
export class Checkpoint {
  private readonly hechos = new Map<number, BatchRecord>();

  private constructor(
    readonly path: string,
    registros: BatchRecord[],
  ) {
    for (const registro of registros) this.hechos.set(registro.batch, registro);
  }

  /**
   * abre el registro, leyendo lo que ya hubiera.
   *
   * una linea ilegible se ignora en vez de abortar: el objetivo del formato es
   * justamente que un corte a mitad de escritura no impida reanudar.
   */
  static open(path: string): { checkpoint: Checkpoint; descartadas: number } {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      return { checkpoint: new Checkpoint(path, []), descartadas: 0 };
    }

    const registros: BatchRecord[] = [];
    let descartadas = 0;

    for (const linea of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (linea.trim().length === 0) continue;
      try {
        registros.push(batchRecordSchema.parse(JSON.parse(linea)));
      } catch {
        descartadas += 1;
      }
    }

    return { checkpoint: new Checkpoint(path, registros), descartadas };
  }

  /**
   * true si este lote ya se completo con este mismo contenido.
   *
   * la huella importa: si el archivo de origen cambio, el lote 7 de ahora no es
   * el lote 7 de antes, y darlo por hecho seria saltarse datos nuevos.
   */
  isDone(batch: number, inputHash: string): boolean {
    const registro = this.hechos.get(batch);
    return registro?.status === 'done' && registro.inputHash === inputHash;
  }

  /** lotes que fallaron y conviene reintentar */
  failed(): BatchRecord[] {
    return [...this.hechos.values()].filter((registro) => registro.status === 'failed');
  }

  /** apunta el resultado de un lote. escribe al disco en el acto */
  record(registro: BatchRecord): void {
    const validado = batchRecordSchema.parse(registro);
    this.hechos.set(validado.batch, validado);
    // sincrono y anadiendo: si el proceso muere en la linea siguiente, esto ya
    // esta en el disco
    appendFileSync(this.path, `${JSON.stringify(validado)}\n`, 'utf8');
  }

  /** resumen para poder decirle al usuario donde va */
  summary(): { done: number; failed: number; items: number } {
    let done = 0;
    let failed = 0;
    let items = 0;
    for (const registro of this.hechos.values()) {
      if (registro.status === 'done') {
        done += 1;
        items += registro.items;
      } else failed += 1;
    }
    return { done, failed, items };
  }
}
