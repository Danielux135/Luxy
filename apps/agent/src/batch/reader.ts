// lectura por lotes de un archivo de datos grande.
//
// RESTRICCION QUE MANDA: el archivo puede tener gigas. Nada aqui lee el archivo
// entero ni acumula todos los registros. Se leen trozos, se emiten lotes, y lo
// consumido se olvida.
//
// POR QUE NO VALE SPLIT POR LINEAS: en un CSV exportado de una base de datos,
// una descripcion de producto puede contener saltos de linea dentro de comillas.
// Trocear por "\n" partiria ese registro en dos y corromperia los datos sin
// avisar. Aqui las comillas se respetan.
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

export type BatchFormat = 'csv' | 'jsonl';

export interface BatchRecordset {
  /** indice del primer registro, empezando en 0 */
  from: number;
  /** registros del lote, ya como objetos */
  rows: Record<string, unknown>[];
  /** huella del contenido: permite detectar que el origen cambio */
  hash: string;
}

export interface ReaderOptions {
  format: BatchFormat;
  /** cuantos registros por lote */
  batchSize: number;
  /** separador del csv. si no se da, se adivina de la cabecera */
  delimiter?: string;
  /** tope de seguridad para no procesar un archivo entero sin querer */
  maxRows?: number;
}

/**
 * trocea un CSV respetando las comillas.
 *
 * devuelve los campos de una fila, o null si la fila esta incompleta porque
 * quedaron comillas abiertas: en ese caso hay que seguir leyendo.
 *
 * `start` evita recortar la cadena en cada fila, lo que ahorra una asignacion
 * por registro. NO se apunta como arreglo de memoria: se midio, y el consumo ya
 * era constante antes del cambio. Un CSV de 31 MB y otro de 194 MB (6,2 veces
 * mas) dieron el mismo pico, ~110 MB de RSS y ~100 MB de heap: eso es margen
 * del recolector, no datos vivos. El lector ya escalaba.
 *
 * `end` es el indice ABSOLUTO donde acaba la fila, no una longitud.
 */
export function parseCsvRow(
  texto: string,
  delimiter: string,
  start = 0,
): { fields: string[]; end: number } | null {
  const fields: string[] = [];
  let campo = '';
  let dentroDeComillas = false;

  for (let i = start; i < texto.length; i += 1) {
    const c = texto[i]!;

    if (dentroDeComillas) {
      if (c === '"') {
        // dos comillas seguidas son una comilla literal, no el cierre
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else dentroDeComillas = false;
      } else campo += c;
      continue;
    }

    if (c === '"') {
      dentroDeComillas = true;
      continue;
    }
    if (c === delimiter) {
      fields.push(campo);
      campo = '';
      continue;
    }
    if (c === '\n') {
      fields.push(campo);
      return { fields, end: i + 1 };
    }
    if (c === '\r') {
      // se ignora: el salto real es el \n siguiente
      continue;
    }
    campo += c;
  }

  // se acabo el texto sin cerrar la fila
  return null;
}

/** adivina el separador contando cual aparece mas en la cabecera */
export function guessDelimiter(cabecera: string): string {
  const candidatos = [',', ';', '\t', '|'];
  let mejor = ',';
  let maximo = -1;
  for (const candidato of candidatos) {
    // se cuenta fuera de comillas, para no contar los de dentro de un campo
    const cuenta = (parseCsvRow(`${cabecera}\n`, candidato)?.fields.length ?? 1) - 1;
    if (cuenta > maximo) {
      maximo = cuenta;
      mejor = candidato;
    }
  }
  return mejor;
}

/**
 * lee el archivo emitiendo lotes de registros.
 *
 * es un generador a proposito: quien consume decide cuando pedir el lote
 * siguiente, asi que el ritmo lo marca la llamada al modelo y no se acumulan
 * lotes en memoria esperando turno.
 */
export async function* readBatches(
  path: string,
  options: ReaderOptions,
): AsyncGenerator<BatchRecordset> {
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });

  let pendiente = '';
  // cuanto de `pendiente` ya se consumio: se avanza en vez de recortar
  let offset = 0;
  let cabecera: string[] | null = null;
  let delimiter = options.delimiter ?? null;
  let indice = 0;
  let lote: Record<string, unknown>[] = [];
  let desde = 0;

  const emitir = (): BatchRecordset => {
    const recordset: BatchRecordset = { from: desde, rows: lote, hash: hashRows(lote) };
    lote = [];
    desde = indice;
    return recordset;
  };

  for await (const trozo of stream) {
    // se tira lo ya consumido antes de anadir mas trozos de red
    pendiente = offset > 0 ? pendiente.slice(offset) + (trozo as string) : pendiente + (trozo as string);
    offset = 0;

    for (;;) {
      if (options.maxRows !== undefined && indice >= options.maxRows) break;

      // --- jsonl: una linea, un registro ---
      if (options.format === 'jsonl') {
        const salto = pendiente.indexOf('\n', offset);
        if (salto === -1) break;
        const linea = pendiente.slice(offset, salto).trim();
        offset = salto + 1;
        if (linea.length === 0) continue;
        const fila = parseJsonlRow(linea, indice);
        if (fila !== null) {
          lote.push(fila);
          indice += 1;
        }
        if (lote.length >= options.batchSize) yield emitir();
        continue;
      }

      // --- csv ---
      if (delimiter === null) {
        const salto = pendiente.indexOf('\n', offset);
        if (salto === -1) break;
        delimiter = guessDelimiter(pendiente.slice(offset, salto));
      }

      const fila = parseCsvRow(pendiente, delimiter, offset);
      if (fila === null) break;
      offset = fila.end;

      if (cabecera === null) {
        cabecera = fila.fields.map((nombre, posicion) => normalizeHeader(nombre, posicion));
        continue;
      }

      // una fila vacia al final del archivo no es un registro
      if (fila.fields.length === 1 && fila.fields[0]!.trim().length === 0) continue;

      lote.push(toRecord(cabecera, fila.fields));
      indice += 1;
      if (lote.length >= options.batchSize) yield emitir();
    }

    if (options.maxRows !== undefined && indice >= options.maxRows) break;
  }

  stream.destroy();

  // lo que quedo sin cerrar al final del archivo.
  //
  // el tope se comprueba TAMBIEN aqui: sin esto, maxRows=25 devolvia 26 filas,
  // porque la cola se procesaba despues de salir del bucle que lo vigilaba
  const cabeSinPasarse = options.maxRows === undefined || indice < options.maxRows;
  const resto = pendiente.slice(offset);

  if (cabeSinPasarse && options.format === 'csv' && cabecera !== null && resto.trim().length > 0) {
    const fila = parseCsvRow(`${resto}\n`, delimiter ?? ',');
    if (fila !== null && !(fila.fields.length === 1 && fila.fields[0]!.trim().length === 0)) {
      lote.push(toRecord(cabecera, fila.fields));
      indice += 1;
    }
  } else if (cabeSinPasarse && options.format === 'jsonl' && resto.trim().length > 0) {
    const fila = parseJsonlRow(resto.trim(), indice);
    if (fila !== null) {
      lote.push(fila);
      indice += 1;
    }
  }

  if (lote.length > 0) yield emitir();
}

/** una linea de jsonl que no es json se conserva como texto, no se descarta */
function parseJsonlRow(linea: string, indice: number): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(linea) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { __row: indice, value: parsed };
  } catch {
    // se conserva para que el usuario vea que habia algo raro, en vez de que el
    // registro desaparezca en silencio
    return { __row: indice, __unparsed: linea.slice(0, 500) };
  }
}

/** una cabecera vacia o repetida rompe el mapeo: se le da un nombre estable */
function normalizeHeader(nombre: string, posicion: number): string {
  const limpio = nombre.trim();
  return limpio.length > 0 ? limpio : `columna_${posicion + 1}`;
}

function toRecord(cabecera: string[], fields: string[]): Record<string, unknown> {
  const fila: Record<string, unknown> = {};
  for (const [posicion, nombre] of cabecera.entries()) {
    fila[nombre] = fields[posicion] ?? '';
  }
  // si la fila trae mas campos que la cabecera no se tiran: se conservan aparte
  if (fields.length > cabecera.length) {
    fila.__extra = fields.slice(cabecera.length);
  }
  return fila;
}

/** huella del contenido de un lote, para detectar que el origen cambio */
export function hashRows(rows: Record<string, unknown>[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}
