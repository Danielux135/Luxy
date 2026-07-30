// pruebas del comando /batch.
//
// ATENCION AL REPARTO DE RESPONSABILIDAD: esta funcion NO es la barrera de
// seguridad. Solo separa la ruta de la instruccion y rechaza lo evidente para
// dar un error legible. Quien autoriza la ruta es confinePath en la maquina,
// contra la carpeta del proyecto, porque el gateway no sabe que hay en ese disco.
import { describe, it, expect } from 'vitest';
import {
  parseCommand,
  splitBatchPrompt,
  resolveTaskTarget,
  isBatchCommand,
  CommandParseError,
  TASK_COMMANDS,
} from './commands.js';

describe('/batch como comando', () => {
  it('esta entre los comandos que lanzan trabajo', () => {
    expect(TASK_COMMANDS).toContain('batch');
  });

  it('se analiza como una tarea normal, con el proyecto delante', () => {
    const parsed = parseCommand('/batch test datos/productos.csv ordena la descripcion');
    expect(parsed).toMatchObject({
      kind: 'task',
      command: 'batch',
      projectAlias: 'test',
      prompt: 'datos/productos.csv ordena la descripcion',
    });
  });

  it('no fija modelo: lo elige el router', () => {
    const parsed = parseCommand('/batch test a.csv haz algo');
    expect(parsed).toMatchObject({ provider: null, model: null });
  });
});

describe('elegir el modelo', () => {
  it('/batch sin sufijo deja elegir al router', () => {
    expect(resolveTaskTarget('batch')).toEqual({ provider: null, model: null });
  });

  it('/batch_kimi fija la familia y usa su modelo predeterminado', () => {
    expect(resolveTaskTarget('batch_kimi')).toEqual({ provider: 'kimi', model: null });
  });

  it('/batch_<alias de modelo> fija el apiModel EXACTO', () => {
    // el mismo vocabulario que las tareas normales: si /kimi_k26 existe,
    // /batch_kimi_k26 tambien, sin una segunda tabla que mantener
    const normal = resolveTaskTarget('kimi_k26');
    expect(resolveTaskTarget('batch_kimi_k26')).toEqual(normal);
    expect(resolveTaskTarget('batch_kimi_k26').model).toBe('Kimi-K2.6');
  });

  it('todos los alias de modelo tienen su version por lotes', () => {
    for (const alias of ['batch_kimi', 'batch_deepseek', 'batch_glm', 'batch_qwen']) {
      expect(TASK_COMMANDS, alias).toContain(alias);
    }
  });

  it('isBatchCommand reconoce las dos formas y no confunde otras', () => {
    expect(isBatchCommand('batch')).toBe(true);
    expect(isBatchCommand('batch_kimi')).toBe(true);
    expect(isBatchCommand('kimi')).toBe(false);
    expect(isBatchCommand('auto')).toBe(false);
  });

  it('se analiza entero: proyecto, archivo e instruccion', () => {
    const parsed = parseCommand('/batch_kimi test datos/p.csv limpia la descripcion');
    expect(parsed).toMatchObject({
      kind: 'task',
      command: 'batch_kimi',
      provider: 'kimi',
      projectAlias: 'test',
      prompt: 'datos/p.csv limpia la descripcion',
    });
  });
});

describe('--lote=N, el mando del coste', () => {
  // MEDIDO contra la API: 25 registros gastan ~470 tokens de salida cada uno y
  // 100 solo 90, porque el razonamiento del modelo es coste FIJO y no crece con
  // los registros. Con facturacion por llamada, el tamano de lote es la unica
  // palanca que mueve la factura de verdad.
  it('saca el tamano de lote de la instruccion', () => {
    expect(splitBatchPrompt('datos.csv --lote=200 limpia la descripcion')).toEqual({
      file: 'datos.csv',
      instruction: 'limpia la descripcion',
      batchSize: 200,
    });
  });

  it('lo encuentra al final de la instruccion', () => {
    const { instruction, batchSize } = splitBatchPrompt('datos.csv limpia esto --lote=50');
    expect(instruction).toBe('limpia esto');
    expect(batchSize).toBe(50);
  });

  it('lo encuentra en medio y no deja doble espacio', () => {
    const { instruction } = splitBatchPrompt('datos.csv limpia --lote=10 la descripcion');
    expect(instruction).toBe('limpia la descripcion');
  });

  it('sin la bandera no fija tamano: manda el de por defecto', () => {
    expect(splitBatchPrompt('datos.csv limpia esto').batchSize).toBeUndefined();
  });

  it('un valor fuera de rango se rechaza en el momento', () => {
    expect(() => splitBatchPrompt('datos.csv --lote=0 limpia')).toThrow(/fuera de rango/);
    expect(() => splitBatchPrompt('datos.csv --lote=5000 limpia')).toThrow(/fuera de rango/);
  });

  it('la bandera sola, sin instruccion, se rechaza', () => {
    expect(() => splitBatchPrompt('datos.csv --lote=100')).toThrow(/falta la instruccion/);
  });

  it('no confunde un guion cualquiera de la instruccion', () => {
    const { instruction, batchSize } = splitBatchPrompt(
      'datos.csv pon guiones alto-medio y quita --lote de la descripcion',
    );
    expect(batchSize).toBeUndefined();
    expect(instruction).toContain('--lote de la descripcion');
  });

  it('no se traga un numero pegado a otra palabra', () => {
    expect(splitBatchPrompt('datos.csv usa el x--lote=50 formato').batchSize).toBeUndefined();
  });
});

describe('el error que confundio de verdad', () => {
  it('una instruccion sin archivo se explica en el momento, no en la maquina', () => {
    // paso tal cual: "/batch test haz 5 archivos locales..." tomo "haz" como
    // nombre de archivo y el error llegaba desde la maquina diciendo
    // 'el archivo "haz" no existe', que no explica nada
    expect(() => splitBatchPrompt('haz 5 archivos locales con textos')).toThrow(
      /no parece un nombre de archivo/,
    );
  });

  it('y ademas dice donde ir si lo que querias era una tarea normal', () => {
    try {
      splitBatchPrompt('haz 5 archivos locales');
      expect.unreachable();
    } catch (error) {
      expect((error as CommandParseError).hint).toContain('/kimi');
    }
  });

  it('un nombre de archivo de verdad sigue pasando', () => {
    for (const bueno of ['datos.csv', 'datos/p.csv', './p.jsonl', 'export.txt', 'sub/dir/a.csv']) {
      expect(() => splitBatchPrompt(`${bueno} limpia esto`), bueno).not.toThrow();
    }
  });
});

describe('splitBatchPrompt', () => {
  it('separa la ruta de la instruccion', () => {
    expect(splitBatchPrompt('datos/productos.csv ordena la descripcion')).toEqual({
      file: 'datos/productos.csv',
      instruction: 'ordena la descripcion',
    });
  });

  it('la instruccion puede tener varias palabras y saltos', () => {
    const { instruction } = splitBatchPrompt('a.csv catalogar por familia\ny corregir tildes');
    expect(instruction).toBe('catalogar por familia\ny corregir tildes');
  });

  it('sin instruccion se rechaza: procesar dos giga sin saber que hacer no tiene sentido', () => {
    expect(() => splitBatchPrompt('datos/productos.csv')).toThrow(CommandParseError);
    expect(() => splitBatchPrompt('datos/productos.csv   ')).toThrow(CommandParseError);
  });

  it('rechaza una ruta absoluta de Windows con un mensaje util', () => {
    expect(() => splitBatchPrompt('C:\\Users\\daniel\\secreto.txt lee esto')).toThrow(
      /relativa al proyecto/,
    );
    expect(() => splitBatchPrompt('C:/Users/daniel/secreto.txt lee esto')).toThrow(
      /relativa al proyecto/,
    );
  });

  it('rechaza una ruta UNC', () => {
    expect(() => splitBatchPrompt('\\\\servidor\\compartido\\datos.csv lee esto')).toThrow(
      /relativa al proyecto/,
    );
    expect(() => splitBatchPrompt('//servidor/datos.csv lee esto')).toThrow(
      /relativa al proyecto/,
    );
  });

  it('rechaza una URL', () => {
    expect(() => splitBatchPrompt('https://ejemplo.com/datos.csv lee esto')).toThrow(
      /relativa al proyecto/,
    );
    expect(() => splitBatchPrompt('file:///c:/datos.csv lee esto')).toThrow(
      /relativa al proyecto/,
    );
  });

  it('un .. NO se rechaza aqui: eso lo decide confinePath en la maquina', () => {
    // deliberado. Aqui no se sabe donde esta la raiz del proyecto, asi que
    // fingir que se valida seria peor: daria una falsa sensacion de barrera
    expect(splitBatchPrompt('../datos.csv lee esto').file).toBe('../datos.csv');
  });
});
