// pruebas del comando /batch.
//
// ATENCION AL REPARTO DE RESPONSABILIDAD: esta funcion NO es la barrera de
// seguridad. Solo separa la ruta de la instruccion y rechaza lo evidente para
// dar un error legible. Quien autoriza la ruta es confinePath en la maquina,
// contra la carpeta del proyecto, porque el gateway no sabe que hay en ese disco.
import { describe, it, expect } from 'vitest';
import { parseCommand, splitBatchPrompt, CommandParseError, TASK_COMMANDS } from './commands.js';

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
