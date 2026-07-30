// pruebas del modo por lotes.
//
// LO QUE SE PROTEGE, en orden de importancia:
//
// 1. NO PERDER REGISTROS. Con dos giga de datos nadie va a revisar a mano si
//    faltan cien filas. Si el modelo devuelve menos de lo que se le dio, el
//    lote se rechaza en vez de dejar un hueco silencioso.
// 2. REANUDAR EXACTO. La contabilidad la lleva Luxy, no el modelo. Reanudar no
//    puede repetir ni saltarse nada.
// 3. NO CORROMPER EL CSV. Una descripcion con saltos de linea dentro de
//    comillas es normal en una exportacion de base de datos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Checkpoint } from './checkpoint.js';
import { parseCsvRow, guessDelimiter, readBatches } from './reader.js';
import { runBatchJob, parseBatchAnswer, type BatchModel } from './runner.js';

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'luxy-batch-'));
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function escribir(nombre: string, contenido: string): string {
  const path = join(raiz, nombre);
  writeFileSync(path, contenido, 'utf8');
  return path;
}

async function lotes(path: string, batchSize: number, format: 'csv' | 'jsonl' = 'csv') {
  const salida = [];
  for await (const recordset of readBatches(path, { format, batchSize })) salida.push(recordset);
  return salida;
}

// -----------------------------------------------------------------------------
// csv
// -----------------------------------------------------------------------------
describe('parseCsvRow', () => {
  it('trocea una fila normal', () => {
    expect(parseCsvRow('a,b,c\n', ',')?.fields).toEqual(['a', 'b', 'c']);
  });

  it('respeta el separador dentro de comillas', () => {
    expect(parseCsvRow('1,"Taladro, percutor",25\n', ',')?.fields).toEqual([
      '1',
      'Taladro, percutor',
      '25',
    ]);
  });

  it('entiende la comilla escapada como dos comillas', () => {
    expect(parseCsvRow('1,"Llave de 1/2"" pulgada",3\n', ',')?.fields).toEqual([
      '1',
      'Llave de 1/2" pulgada',
      '3',
    ]);
  });

  it('devuelve null si las comillas quedan abiertas: la fila sigue', () => {
    // esto es lo que permite que una descripcion multilinea no se parta
    expect(parseCsvRow('1,"descripcion que sigue\n', ',')).toBeNull();
  });

  it('acepta CRLF', () => {
    expect(parseCsvRow('a,b\r\n', ',')?.fields).toEqual(['a', 'b']);
  });

  it('adivina el separador', () => {
    expect(guessDelimiter('id;nombre;precio')).toBe(';');
    expect(guessDelimiter('id,nombre,precio')).toBe(',');
    expect(guessDelimiter('id\tnombre\tprecio')).toBe('\t');
  });
});

describe('readBatches', () => {
  it('mapea la cabecera a claves', async () => {
    const path = escribir('a.csv', 'id,nombre\n1,Martillo\n2,Sierra\n');
    const [lote] = await lotes(path, 10);
    expect(lote!.rows).toEqual([
      { id: '1', nombre: 'Martillo' },
      { id: '2', nombre: 'Sierra' },
    ]);
  });

  it('NO parte un registro con saltos de linea dentro de comillas', async () => {
    // el fallo que esto evita: split("\n") daria 4 registros en vez de 2 y
    // corromperia las descripciones sin avisar
    const path = escribir(
      'multi.csv',
      'id,descripcion\n1,"Taladro.\nIncluye maletin.\nGarantia 2 anos."\n2,"Sierra normal"\n',
    );
    const [lote] = await lotes(path, 10);

    expect(lote!.rows).toHaveLength(2);
    expect(lote!.rows[0]!.descripcion).toBe('Taladro.\nIncluye maletin.\nGarantia 2 anos.');
    expect(lote!.rows[1]!.descripcion).toBe('Sierra normal');
  });

  it('trocea en lotes del tamano pedido y numera desde 0', async () => {
    const filas = Array.from({ length: 7 }, (_, i) => `${i},producto ${i}`).join('\n');
    const path = escribir('siete.csv', `id,nombre\n${filas}\n`);

    const resultado = await lotes(path, 3);
    expect(resultado.map((r) => [r.from, r.rows.length])).toEqual([
      [0, 3],
      [3, 3],
      [6, 1],
    ]);
  });

  it('no pierde la ultima fila si el archivo no acaba en salto', async () => {
    const path = escribir('sinsalto.csv', 'id,nombre\n1,Uno\n2,Dos');
    const [lote] = await lotes(path, 10);
    expect(lote!.rows).toHaveLength(2);
  });

  it('una cabecera vacia recibe un nombre estable en vez de perder la columna', async () => {
    const path = escribir('vacia.csv', 'id,,precio\n1,x,5\n');
    const [lote] = await lotes(path, 10);
    expect(Object.keys(lote!.rows[0]!)).toEqual(['id', 'columna_2', 'precio']);
  });

  it('respeta maxRows para poder probar sin procesar el archivo entero', async () => {
    const filas = Array.from({ length: 100 }, (_, i) => `${i},p`).join('\n');
    const path = escribir('cien.csv', `id,nombre\n${filas}\n`);

    const salida = [];
    for await (const r of readBatches(path, { format: 'csv', batchSize: 10, maxRows: 25 })) {
      salida.push(r);
    }
    expect(salida.reduce((total, r) => total + r.rows.length, 0)).toBe(25);
  });

  it('lee jsonl', async () => {
    const path = escribir('a.jsonl', '{"id":1}\n{"id":2}\n');
    const [lote] = await lotes(path, 10, 'jsonl');
    expect(lote!.rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('una linea de jsonl ilegible se conserva, no desaparece', async () => {
    const path = escribir('roto.jsonl', '{"id":1}\n{roto\n{"id":3}\n');
    const [lote] = await lotes(path, 10, 'jsonl');
    expect(lote!.rows).toHaveLength(3);
    expect(lote!.rows[1]).toHaveProperty('__unparsed');
  });

  it('el hash cambia si cambia el contenido', async () => {
    const a = escribir('h1.csv', 'id\n1\n');
    const b = escribir('h2.csv', 'id\n2\n');
    const [uno] = await lotes(a, 10);
    const [dos] = await lotes(b, 10);
    expect(uno!.hash).not.toBe(dos!.hash);
  });
});

// -----------------------------------------------------------------------------
// checkpoint
// -----------------------------------------------------------------------------
describe('Checkpoint', () => {
  it('recuerda los lotes hechos entre ejecuciones', () => {
    const path = join(raiz, 'cp.jsonl');
    const registro = {
      batch: 0,
      from: 0,
      to: 9,
      status: 'done' as const,
      items: 10,
      inputHash: 'abcdef1234567890',
      error: null,
      durationMs: 100,
      at: new Date().toISOString(),
    };

    Checkpoint.open(path).checkpoint.record(registro);

    // segunda apertura: simula reanudar tras un corte
    const { checkpoint } = Checkpoint.open(path);
    expect(checkpoint.isDone(0, 'abcdef1234567890')).toBe(true);
  });

  it('si el contenido del lote cambio, NO lo da por hecho', () => {
    const path = join(raiz, 'cp2.jsonl');
    const { checkpoint } = Checkpoint.open(path);
    checkpoint.record({
      batch: 0,
      from: 0,
      to: 9,
      status: 'done',
      items: 10,
      inputHash: 'huella-vieja-0000',
      error: null,
      durationMs: 1,
      at: new Date().toISOString(),
    });

    // el archivo de origen cambio: el lote 0 de ahora no es el de antes
    expect(checkpoint.isDone(0, 'huella-nueva-0000')).toBe(false);
  });

  it('un lote fallido no cuenta como hecho', () => {
    const path = join(raiz, 'cp3.jsonl');
    const { checkpoint } = Checkpoint.open(path);
    checkpoint.record({
      batch: 0,
      from: 0,
      to: 9,
      status: 'failed',
      items: 0,
      inputHash: 'h0000000',
      error: 'timeout',
      durationMs: 1,
      at: new Date().toISOString(),
    });

    expect(checkpoint.isDone(0, 'h0000000')).toBe(false);
    expect(checkpoint.failed()).toHaveLength(1);
  });

  it('una linea corrupta se descarta sin invalidar las demas', () => {
    const path = join(raiz, 'cp4.jsonl');
    const bueno = JSON.stringify({
      batch: 0,
      from: 0,
      to: 1,
      status: 'done',
      items: 2,
      inputHash: 'h0000000',
      error: null,
      durationMs: 1,
      at: new Date().toISOString(),
    });
    // la linea de en medio simula un corte de luz a mitad de escritura
    writeFileSync(path, `${bueno}\n{"batch":1,"stat\n`, 'utf8');

    const { checkpoint, descartadas } = Checkpoint.open(path);
    expect(descartadas).toBe(1);
    expect(checkpoint.isDone(0, 'h0000000')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// validacion de la respuesta del modelo
// -----------------------------------------------------------------------------
describe('parseBatchAnswer', () => {
  it('acepta {"results":[...]}', () => {
    expect(parseBatchAnswer('{"results":[{"a":1},{"a":2}]}', 2)).toHaveLength(2);
  });

  it('acepta un array pelado', () => {
    expect(parseBatchAnswer('[{"a":1}]', 1)).toHaveLength(1);
  });

  it('saca el json de un bloque de codigo', () => {
    expect(parseBatchAnswer('Aqui va:\n```json\n[{"a":1}]\n```\nlisto', 1)).toHaveLength(1);
  });

  it('RECHAZA el lote si el modelo devuelve menos registros de los que se le dieron', () => {
    // el fallo que esto evita: aceptar 8 de 10 y dejar dos huecos que nadie
    // detectaria hasta mucho despues
    expect(() => parseBatchAnswer('[{"a":1},{"a":2}]', 10)).toThrow(/2 registros.*esperaban 10/);
  });

  it('rechaza si devuelve mas de los que se le dieron', () => {
    expect(() => parseBatchAnswer('[{"a":1},{"a":2}]', 1)).toThrow(/esperaban 1/);
  });

  it('rechaza una respuesta sin json', () => {
    expect(() => parseBatchAnswer('lo siento, no puedo ayudarte con eso', 1)).toThrow();
  });

  it('rechaza json roto', () => {
    expect(() => parseBatchAnswer('[{"a":', 1)).toThrow();
  });
});

// -----------------------------------------------------------------------------
// el bucle completo
// -----------------------------------------------------------------------------
describe('runBatchJob', () => {
  function entrada(filas = 10): string {
    const cuerpo = Array.from({ length: filas }, (_, i) => `${i},producto ${i}`).join('\n');
    return escribir('in.csv', `id,nombre\n${cuerpo}\n`);
  }

  function opciones(inputPath: string, batchSize = 5) {
    return {
      inputPath,
      format: 'csv' as const,
      outputPath: join(raiz, 'out.jsonl'),
      checkpointPath: join(raiz, 'cp.jsonl'),
      batchSize,
      instruction: 'pon el nombre en mayusculas',
    };
  }

  /** modelo que devuelve un registro por cada uno de entrada */
  function modeloBueno(): BatchModel {
    return {
      process: vi.fn(async (rows) =>
        JSON.stringify({
          results: rows.map((fila) => ({ id: fila.id, nombre: String(fila.nombre).toUpperCase() })),
        }),
      ),
    };
  }

  const hooks = () => ({ signal: new AbortController().signal, onProgress: vi.fn() });

  it('procesa todos los lotes y escribe un resultado por registro', async () => {
    const model = modeloBueno();
    const resultado = await runBatchJob(opciones(entrada(10)), model, hooks());

    expect(resultado).toMatchObject({ batches: 2, done: 2, failed: 0, skipped: 0, items: 10 });

    const salida = readFileSync(join(raiz, 'out.jsonl'), 'utf8').trim().split('\n');
    expect(salida).toHaveLength(10);
    // cada resultado lleva el indice de su fila de origen: sin eso, conciliar
    // dos giga de salida con la entrada es imposible
    expect(JSON.parse(salida[0]!)).toMatchObject({ __row: 0, nombre: 'PRODUCTO 0' });
    expect(JSON.parse(salida[9]!)).toMatchObject({ __row: 9, nombre: 'PRODUCTO 9' });
  });

  it('REANUDA por donde toca: la segunda vez no vuelve a llamar al modelo', async () => {
    const path = entrada(10);
    const primera = modeloBueno();
    await runBatchJob(opciones(path), primera, hooks());
    expect(primera.process).toHaveBeenCalledTimes(2);

    // segunda ejecucion sobre el mismo archivo y el mismo checkpoint
    const segunda = modeloBueno();
    const resultado = await runBatchJob(opciones(path), segunda, hooks());

    expect(segunda.process).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ done: 0, skipped: 2, items: 0 });
  });

  it('reanuda solo lo que falta cuando se corto a mitad', async () => {
    const path = entrada(10);

    // el primer intento falla en el segundo lote
    let llamadas = 0;
    const aMedias: BatchModel = {
      process: async (rows) => {
        llamadas += 1;
        if (llamadas === 2) throw new Error('se corto la red');
        return JSON.stringify({ results: rows.map((f) => ({ id: f.id })) });
      },
    };
    const primero = await runBatchJob(opciones(path), aMedias, hooks());
    expect(primero).toMatchObject({ done: 1, failed: 1 });

    // el segundo intento salta el lote bueno y reintenta SOLO el que fallo
    const segundo = modeloBueno();
    const resultado = await runBatchJob(opciones(path), segundo, hooks());

    expect(segundo.process).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ skipped: 1, done: 1 });
  });

  it('un modelo que se come registros deja el lote como fallido, no escribe huecos', async () => {
    const tramposo: BatchModel = {
      // devuelve 3 de 5
      process: async (rows) =>
        JSON.stringify({ results: rows.slice(0, 3).map((f) => ({ id: f.id })) }),
    };

    const resultado = await runBatchJob(opciones(entrada(5)), tramposo, hooks());

    expect(resultado).toMatchObject({ done: 0, failed: 1, items: 0 });
    // y no se ha escrito NADA en la salida: mejor vacio que incompleto
    expect(existsSync(join(raiz, 'out.jsonl'))).toBe(false);
  });

  it('para tras varios fallos seguidos en vez de gastar llamadas', async () => {
    const roto: BatchModel = {
      process: vi.fn(async () => {
        throw new Error('la API responde 500');
      }),
    };

    const resultado = await runBatchJob(
      { ...opciones(entrada(100), 5), maxConsecutiveFailures: 3 },
      roto,
      hooks(),
    );

    expect(roto.process).toHaveBeenCalledTimes(3);
    expect(resultado.stoppedEarly).toBe(true);
    expect(resultado.reason).toContain('no gastar mas llamadas');
  });

  it('un fallo suelto no dispara la parada: el contador se reinicia', async () => {
    let llamadas = 0;
    const irregular: BatchModel = {
      process: async (rows) => {
        llamadas += 1;
        // falla el 1 y el 3, con exitos en medio
        if (llamadas === 2 || llamadas === 4) throw new Error('fallo suelto');
        return JSON.stringify({ results: rows.map((f) => ({ id: f.id })) });
      },
    };

    const resultado = await runBatchJob(
      { ...opciones(entrada(30), 5), maxConsecutiveFailures: 3 },
      irregular,
      hooks(),
    );

    expect(resultado.stoppedEarly).toBe(false);
    expect(resultado).toMatchObject({ batches: 6, done: 4, failed: 2 });
  });

  it('respeta la cancelacion', async () => {
    const abort = new AbortController();
    const model: BatchModel = {
      process: vi.fn(async (rows) => {
        abort.abort();
        return JSON.stringify({ results: rows.map((f) => ({ id: f.id })) });
      }),
    };

    const resultado = await runBatchJob(opciones(entrada(50), 5), model, {
      signal: abort.signal,
      onProgress: vi.fn(),
    });

    expect(model.process).toHaveBeenCalledTimes(1);
    expect(resultado.reason).toBe('cancelado');
  });

  it('informa del progreso lote a lote', async () => {
    const onProgress = vi.fn();
    await runBatchJob(opciones(entrada(10)), modeloBueno(), {
      signal: new AbortController().signal,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0]![0]).toMatchObject({
      batch: 0,
      from: 0,
      to: 4,
      status: 'done',
      items: 5,
    });
  });
});
