// pruebas del puente entre un trabajo de Telegram y el bucle de lotes.
//
// LO QUE SE PROTEGE AQUI ES LA RUTA. El usuario escribe el nombre del archivo en
// un mensaje de Telegram, asi que es dato NO confiable. Sin confinamiento,
// "/batch test ../../.ssh/id_rsa lee esto" mandaria una clave privada a una API
// china. Con dos giga de datos y comandos escritos desde el movil, esto no es
// una hipotesis remota.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readBatchRequest,
  resolveBatchPaths,
  renderBatchSummary,
  guessFormat,
  BatchSetupError,
  DEFAULT_BATCH_SIZE,
} from './job.js';

let raiz: string;
let proyecto: string;
let datos: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'luxy-batchjob-'));
  proyecto = join(raiz, 'proyecto');
  mkdirSync(join(proyecto, 'datos'), { recursive: true });
  datos = join(proyecto, 'datos', 'productos.csv');
  writeFileSync(datos, 'id,nombre\n1,Martillo\n', 'utf8');

  // un secreto FUERA del proyecto, para comprobar que no se puede alcanzar
  writeFileSync(join(raiz, 'secreto.txt'), 'clave-que-no-debe-salir', 'utf8');
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

const contexto = () => ({
  projectPath: proyecto,
  shortId: 'LUX-TEST1',
  env: { LUXY_DATA_DIR: join(raiz, 'luxydata') } as NodeJS.ProcessEnv,
});

describe('readBatchRequest', () => {
  it('un trabajo normal no es de lotes', () => {
    expect(readBatchRequest({})).toBeNull();
    expect(readBatchRequest({ batch: null })).toBeNull();
  });

  it('reconoce una peticion de lotes', () => {
    expect(readBatchRequest({ batch: { file: 'datos/productos.csv' } })).toMatchObject({
      file: 'datos/productos.csv',
    });
  });

  it('una peticion con forma rara se rechaza, no se ignora', () => {
    // ignorarla en silencio convertiria un /batch en un trabajo de codigo
    expect(() => readBatchRequest({ batch: { file: '' } })).toThrow(BatchSetupError);
    expect(() => readBatchRequest({ batch: { nada: 1 } })).toThrow(BatchSetupError);
  });
});

describe('resolveBatchPaths: la barrera', () => {
  it('acepta una ruta relativa dentro del proyecto', () => {
    const paths = resolveBatchPaths({ file: 'datos/productos.csv' }, contexto());
    expect(paths.inputPath).toBe(datos);
    expect(paths.batchSize).toBe(DEFAULT_BATCH_SIZE);
    expect(paths.inputBytes).toBeGreaterThan(0);
  });

  it('RECHAZA salir del proyecto con ..', () => {
    expect(() => resolveBatchPaths({ file: '../secreto.txt' }, contexto())).toThrow(
      BatchSetupError,
    );
  });

  it('RECHAZA una ruta absoluta fuera del proyecto', () => {
    expect(() =>
      resolveBatchPaths({ file: join(raiz, 'secreto.txt') }, contexto()),
    ).toThrow(BatchSetupError);
  });

  it('RECHAZA los nombres que nunca se exponen', () => {
    for (const prohibido of ['.env', 'clave.pem', 'id_rsa', '.npmrc']) {
      writeFileSync(join(proyecto, prohibido), 'x', 'utf8');
      expect(() => resolveBatchPaths({ file: prohibido }, contexto()), prohibido).toThrow(
        BatchSetupError,
      );
    }
  });

  it('RECHAZA la carpeta .git', () => {
    mkdirSync(join(proyecto, '.git'), { recursive: true });
    writeFileSync(join(proyecto, '.git', 'config'), 'x', 'utf8');
    expect(() => resolveBatchPaths({ file: '.git/config' }, contexto())).toThrow(BatchSetupError);
  });

  it('un archivo que no existe se dice claro, no se intenta leer', () => {
    expect(() => resolveBatchPaths({ file: 'datos/no-existe.csv' }, contexto())).toThrow(
      /no existe/,
    );
  });

  it('una carpeta no es un archivo de datos', () => {
    expect(() => resolveBatchPaths({ file: 'datos' }, contexto())).toThrow(/no es un archivo/);
  });
});

describe('resolveBatchPaths: salida', () => {
  it('la salida NO va dentro del proyecto', () => {
    const paths = resolveBatchPaths({ file: 'datos/productos.csv' }, contexto());
    // un resultado de dos giga dentro del repo saldria en el diff y pediria
    // aprobacion de commit para algo que no es codigo
    expect(paths.outputPath.startsWith(proyecto)).toBe(false);
    expect(paths.checkpointPath.startsWith(proyecto)).toBe(false);
  });

  it('las rutas se derivan del id corto, para que reintentar reanude', () => {
    const primera = resolveBatchPaths({ file: 'datos/productos.csv' }, contexto());
    const segunda = resolveBatchPaths({ file: 'datos/productos.csv' }, contexto());
    expect(segunda.checkpointPath).toBe(primera.checkpointPath);
  });

  it('dos trabajos distintos no comparten checkpoint', () => {
    const uno = resolveBatchPaths({ file: 'datos/productos.csv' }, contexto());
    const dos = resolveBatchPaths(
      { file: 'datos/productos.csv' },
      { ...contexto(), shortId: 'LUX-OTRO' },
    );
    expect(dos.checkpointPath).not.toBe(uno.checkpointPath);
  });
});

describe('formato', () => {
  it('se deduce de la extension', () => {
    expect(guessFormat('a.jsonl')).toBe('jsonl');
    expect(guessFormat('a.json')).toBe('jsonl');
    expect(guessFormat('a.csv')).toBe('csv');
    expect(guessFormat('exportacion.txt')).toBe('csv');
  });

  it('lo que diga el usuario manda sobre la extension', () => {
    const paths = resolveBatchPaths(
      { file: 'datos/productos.csv', format: 'jsonl' },
      contexto(),
    );
    expect(paths.format).toBe('jsonl');
  });
});

describe('renderBatchSummary', () => {
  const paths = { outputPath: 'C:/datos/resultados.jsonl', checkpointPath: 'C:/datos/avance.jsonl' };

  it('dice donde estan los resultados', () => {
    const texto = renderBatchSummary(
      { batches: 10, done: 10, skipped: 0, failed: 0, items: 1000, reason: null },
      paths,
    );
    expect(texto).toContain('1.000');
    expect(texto).toContain('resultados.jsonl');
    expect(texto).not.toContain('ATENCION');
  });

  it('un trabajo con lotes fallidos NO se presenta como limpio', () => {
    const texto = renderBatchSummary(
      { batches: 10, done: 8, skipped: 0, failed: 2, items: 800, reason: null },
      paths,
    );
    expect(texto).toContain('ATENCION');
    expect(texto).toContain('NO estan en la salida');
    // y se dice como recuperarlos
    expect(texto).toContain('reanuda');
  });

  it('si se paro antes de acabar, se dice', () => {
    const texto = renderBatchSummary(
      { batches: 3, done: 0, skipped: 0, failed: 3, items: 0, reason: 'la API responde 500' },
      paths,
    );
    expect(texto).toContain('Se paro antes de acabar');
  });
});
