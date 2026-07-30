// puente entre un trabajo de Telegram y el bucle de lotes.
//
// LA DECISION DE SEGURIDAD QUE MANDA AQUI: la ruta del archivo la escribe el
// usuario en un mensaje de Telegram. Eso es dato NO confiable, y una ruta suelta
// leeria cualquier cosa del disco: claves, la configuracion de Luxy, el
// secrets.enc. Se pasa por confinePath contra la carpeta del proyecto, que es la
// misma barrera que usan las herramientas del agente.
//
// La salida NO se escribe dentro del proyecto: va a la carpeta de datos de Luxy.
// Un archivo de resultados de dos giga dentro del repo saldria en el diff, y
// pediria aprobacion de commit para algo que no es codigo.
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { z } from 'zod';
import { confinePath, PathConfinementError } from '../tools/confine.js';
import { dataDir } from '../paths.js';
import type { BatchFormat } from './reader.js';

/** lo que el gateway mete en la metadata del trabajo */
export const batchRequestSchema = z.object({
  /** ruta del archivo, relativa al proyecto */
  file: z.string().min(1).max(400),
  format: z.enum(['csv', 'jsonl']).optional(),
  batchSize: z.number().int().min(1).max(1000).optional(),
  maxRows: z.number().int().min(1).optional(),
});

export type BatchRequest = z.infer<typeof batchRequestSchema>;

/** tamano de lote por defecto */
export const DEFAULT_BATCH_SIZE = 100;

export interface ResolvedBatchPaths {
  inputPath: string;
  outputPath: string;
  checkpointPath: string;
  format: BatchFormat;
  batchSize: number;
  inputBytes: number;
}

export class BatchSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchSetupError';
  }
}

/**
 * saca la peticion de lotes de la metadata, o null si este no es un trabajo de
 * lotes.
 */
export function readBatchRequest(metadata: Record<string, unknown>): BatchRequest | null {
  const raw = metadata['batch'];
  if (raw === undefined || raw === null) return null;
  const parsed = batchRequestSchema.safeParse(raw);
  if (!parsed.success) throw new BatchSetupError('la peticion de lotes no tiene la forma esperada');
  return parsed.data;
}

/**
 * resuelve las rutas de un trabajo de lotes.
 *
 * el checkpoint y la salida se derivan del ID CORTO del trabajo, no de un
 * aleatorio: asi reintentar el mismo trabajo reanuda donde lo dejo, que es el
 * objetivo de todo esto.
 */
export function resolveBatchPaths(
  request: BatchRequest,
  context: { projectPath: string; shortId: string; env?: NodeJS.ProcessEnv },
): ResolvedBatchPaths {
  let inputPath: string;
  try {
    // la barrera: la ruta que escribio el usuario NO puede salir del proyecto
    inputPath = confinePath({ root: context.projectPath, candidate: request.file });
  } catch (error) {
    if (error instanceof PathConfinementError) {
      throw new BatchSetupError(
        `"${request.file}" no es una ruta valida dentro del proyecto: ${error.message}`,
      );
    }
    throw error;
  }

  if (!existsSync(inputPath)) {
    throw new BatchSetupError(`el archivo "${request.file}" no existe en el proyecto`);
  }
  const stat = statSync(inputPath);
  if (!stat.isFile()) {
    throw new BatchSetupError(`"${request.file}" no es un archivo`);
  }

  const base = join(dataDir(context.env ?? process.env), 'batch', context.shortId);

  return {
    inputPath,
    outputPath: join(base, 'resultados.jsonl'),
    checkpointPath: join(base, 'avance.jsonl'),
    format: request.format ?? guessFormat(request.file),
    batchSize: request.batchSize ?? DEFAULT_BATCH_SIZE,
    inputBytes: stat.size,
  };
}

/**
 * separador de miles fijo.
 *
 * toLocaleString depende del ICU del entorno: en las pruebas daba "1,000" y en
 * la maquina "1.000". Un mensaje que va a Telegram no puede cambiar de formato
 * segun donde se ejecute.
 */
export function miles(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** el formato se deduce de la extension si el usuario no lo dice */
export function guessFormat(file: string): BatchFormat {
  return /\.jsonl?$/i.test(file) ? 'jsonl' : 'csv';
}

/**
 * texto del informe final.
 *
 * se dice donde estan los archivos porque el usuario los va a necesitar, y se
 * dice cuantos lotes fallaron sin adornar: un trabajo con lotes fallidos NO es
 * un trabajo terminado bien, aunque el resto haya ido.
 */
export function renderBatchSummary(
  outcome: {
    batches: number;
    done: number;
    skipped: number;
    failed: number;
    items: number;
    reason: string | null;
    lastError?: string | null;
  },
  paths: { outputPath: string; checkpointPath: string },
): string {
  const lineas = [
    `Lotes: ${outcome.batches} (${outcome.done} procesados, ${outcome.skipped} ya estaban hechos, ${outcome.failed} fallidos)`,
    `Registros escritos: ${miles(outcome.items)}`,
  ];

  // la ruta de la salida solo sirve si hay algo escrito
  if (outcome.items > 0) lineas.push(`Resultados: ${paths.outputPath}`);

  if (outcome.failed > 0) {
    lineas.push('', `${outcome.failed} lotes fallaron. Sus registros NO estan en la salida.`);
    // LA CAUSA, no solo el hecho: sin esto habia que abrir avance.jsonl a mano
    if (outcome.lastError !== undefined && outcome.lastError !== null) {
      lineas.push('', `Causa: ${outcome.lastError}`);
    }
    lineas.push('', 'Vuelve a lanzar el mismo comando: reanuda y reintenta solo lo que falta.');
  }
  if (outcome.reason !== null) lineas.push('', `Se paro antes de acabar: ${outcome.reason}`);

  return lineas.join('\n');
}
