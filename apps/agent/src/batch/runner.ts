// bucle de un trabajo por lotes.
//
// EL BUCLE ES CODIGO, NO PROMPT. Al modelo se le da un trozo y se le pide el
// resultado de ese trozo. No sabe cuantos lotes hay, ni cual va, ni lleva la
// cuenta: si la llevara, un despiste suyo saltaria registros sin que nadie se
// enterase. Ver checkpoint.ts.
//
// COSTE: la facturacion medida en la conexion del usuario es POR LLAMADA, no
// por token (dos llamadas de 1007 y 1050 tokens costaron lo mismo). Por eso el
// tamano de lote se maximiza en vez de minimizarse: el ahorro esta en hacer
// pocas llamadas grandes, y es de dos ordenes de magnitud.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { redact } from '@luxy/shared';
import { Checkpoint } from './checkpoint.js';
import { readBatches, type BatchFormat } from './reader.js';

export interface BatchJobOptions {
  /** archivo de entrada; puede pesar gigas */
  inputPath: string;
  format: BatchFormat;
  /** donde se escriben los resultados, una linea por registro */
  outputPath: string;
  /** donde se apunta el avance */
  checkpointPath: string;
  /** registros por llamada */
  batchSize: number;
  /** instruccion del usuario, igual para todos los lotes */
  instruction: string;
  /** tope de registros, para poder probar sin procesar los dos giga */
  maxRows?: number;
  /** cuantos lotes fallidos seguidos se toleran antes de parar */
  maxConsecutiveFailures?: number;
}

export interface BatchProgress {
  batch: number;
  from: number;
  to: number;
  status: 'skipped' | 'done' | 'failed';
  items: number;
  error?: string;
}

/** lo que se le pide al modelo por cada lote */
export const batchAnswerSchema = z.object({
  results: z.array(z.record(z.string(), z.unknown())).max(1000),
});

export interface BatchModel {
  /**
   * procesa un lote. debe devolver un registro por cada registro de entrada.
   *
   * `from` es el indice del primer registro. Hace falta para que el prompt
   * numere bien: sin el, todos los lotes se numeraban desde 0.
   */
  process(rows: Record<string, unknown>[], instruction: string, from: number): Promise<string>;
}

export interface BatchOutcome {
  batches: number;
  done: number;
  skipped: number;
  failed: number;
  items: number;
  stoppedEarly: boolean;
  reason: string | null;
  /**
   * causa del ultimo lote fallido.
   *
   * el resumen decia "1 lotes fallaron" y se quedaba ahi: para saber POR QUE
   * habia que abrir avance.jsonl a mano en la maquina. Un mensaje que dice que
   * algo fallo sin decir la causa obliga a un viaje de ida y vuelta que se
   * puede ahorrar aqui.
   */
  lastError: string | null;
}

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

/**
 * recorre el archivo llamando al modelo lote a lote.
 *
 * reanudable: si se corta, la siguiente ejecucion salta los lotes ya hechos
 * comprobando ADEMAS que el contenido no ha cambiado.
 */
export async function runBatchJob(
  options: BatchJobOptions,
  model: BatchModel,
  hooks: { signal: AbortSignal; onProgress: (progress: BatchProgress) => void },
): Promise<BatchOutcome> {
  const { checkpoint } = Checkpoint.open(options.checkpointPath);
  mkdirSync(dirname(options.outputPath), { recursive: true });

  const topeFallos = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  let indiceLote = 0;
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let items = 0;
  let fallosSeguidos = 0;
  let reason: string | null = null;
  let lastError: string | null = null;

  for await (const recordset of readBatches(options.inputPath, {
    format: options.format,
    batchSize: options.batchSize,
    ...(options.maxRows === undefined ? {} : { maxRows: options.maxRows }),
  })) {
    if (hooks.signal.aborted) {
      reason = 'cancelado';
      break;
    }

    const lote = indiceLote;
    indiceLote += 1;
    const hasta = recordset.from + recordset.rows.length - 1;

    // ya hecho Y con el mismo contenido: se salta sin gastar una llamada
    if (checkpoint.isDone(lote, recordset.hash)) {
      skipped += 1;
      hooks.onProgress({
        batch: lote,
        from: recordset.from,
        to: hasta,
        status: 'skipped',
        items: 0,
      });
      continue;
    }

    const inicio = Date.now();
    try {
      const respuesta = await model.process(recordset.rows, options.instruction, recordset.from);
      const resultados = parseBatchAnswer(respuesta, recordset.rows.length);

      // los resultados se escriben ANTES de apuntar el lote como hecho: si el
      // proceso muere entre las dos cosas, el lote se repite y se reescribe.
      // Al reves se perderian datos, que es el fallo que no se puede permitir.
      appendResults(options.outputPath, recordset.from, resultados);

      checkpoint.record({
        batch: lote,
        from: recordset.from,
        to: hasta,
        status: 'done',
        items: resultados.length,
        inputHash: recordset.hash,
        error: null,
        durationMs: Date.now() - inicio,
        at: new Date().toISOString(),
      });

      done += 1;
      items += resultados.length;
      fallosSeguidos = 0;
      hooks.onProgress({
        batch: lote,
        from: recordset.from,
        to: hasta,
        status: 'done',
        items: resultados.length,
      });
    } catch (error) {
      const mensaje = redact(error instanceof Error ? error.message : String(error)).slice(0, 400);

      checkpoint.record({
        batch: lote,
        from: recordset.from,
        to: hasta,
        status: 'failed',
        items: 0,
        inputHash: recordset.hash,
        error: mensaje,
        durationMs: Date.now() - inicio,
        at: new Date().toISOString(),
      });

      failed += 1;
      fallosSeguidos += 1;
      lastError = mensaje;
      hooks.onProgress({
        batch: lote,
        from: recordset.from,
        to: hasta,
        status: 'failed',
        items: 0,
        error: mensaje,
      });

      // no se insiste indefinidamente: si algo esta roto de verdad, seguir
      // llamando solo gasta dinero. Con facturacion por llamada, mucho.
      if (fallosSeguidos >= topeFallos) {
        reason = `${fallosSeguidos} lotes seguidos fallaron: se para para no gastar mas llamadas`;
        break;
      }
    }
  }

  return {
    batches: indiceLote,
    done,
    skipped,
    failed,
    items,
    stoppedEarly: reason !== null,
    reason,
    lastError,
  };
}

/**
 * valida la respuesta del modelo.
 *
 * se exige un registro por cada registro de entrada. Si el modelo devuelve
 * menos, se ha comido datos, y aceptarlo dejaria huecos silenciosos en la
 * salida. Se rechaza el lote y se apunta como fallido.
 */
export function parseBatchAnswer(
  respuesta: string,
  esperados: number,
): Record<string, unknown>[] {
  const json = extractJson(respuesta);
  if (json === null) throw new Error('el modelo no devolvio JSON');

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('el JSON del modelo no se puede parsear');
  }

  // se acepta tanto {"results":[...]} como un array pelado
  const candidato = Array.isArray(parsed) ? { results: parsed } : parsed;
  const validado = batchAnswerSchema.safeParse(candidato);
  if (!validado.success) throw new Error('el JSON del modelo no tiene la forma esperada');

  if (validado.data.results.length !== esperados) {
    throw new Error(
      `el modelo devolvio ${validado.data.results.length} registros y se esperaban ${esperados}`,
    );
  }

  return validado.data.results;
}

/** saca el JSON de una respuesta que puede venir envuelta en explicaciones */
function extractJson(respuesta: string): string | null {
  const enBloque = /```(?:json)?\s*([\s\S]*?)```/.exec(respuesta);
  const texto = (enBloque?.[1] ?? respuesta).trim();

  const primeroObjeto = texto.indexOf('{');
  const primeroArray = texto.indexOf('[');
  const inicio =
    primeroArray !== -1 && (primeroObjeto === -1 || primeroArray < primeroObjeto)
      ? primeroArray
      : primeroObjeto;
  if (inicio === -1) return null;

  const cierre = texto[inicio] === '[' ? ']' : '}';
  const fin = texto.lastIndexOf(cierre);
  if (fin <= inicio) return null;

  return texto.slice(inicio, fin + 1);
}

/**
 * escribe los resultados anadiendo al final, en JSONL.
 *
 * EL ORDEN DE LAS CLAVES NO ES COSMETICO: `__row` va DESPUES del spread, asi que
 * el indice que calcula el codigo gana al que devuelve el modelo.
 *
 * Al reves (`{ __row: calculado, ...fila }`) el modelo sobrescribia el indice
 * con su propia copia, y como el prompt numeraba mal, los cuatro lotes salieron
 * con los indices 0-4. Veinte registros escritos y solo cinco indices
 * distintos: la salida era imposible de conciliar con la entrada. Es el mismo
 * error contra el que existe el checkpoint, fiarse de la contabilidad del
 * modelo, cometido aqui dentro.
 */
function appendResults(
  path: string,
  desde: number,
  resultados: Record<string, unknown>[],
): void {
  const lineas = resultados
    .map((fila, posicion) => JSON.stringify({ ...fila, __row: desde + posicion }))
    .join('\n');
  appendFileSync(path, `${lineas}\n`, 'utf8');
}
