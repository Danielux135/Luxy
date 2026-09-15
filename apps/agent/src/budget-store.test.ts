// el presupuesto tiene que sobrevivir a cerrar Studio.
//
// si no, un limite «diario» se reinicia con cada sesion y el contador de
// llamadas —lo unico que protege contra una tarifa plana por peticion— da una
// falsa sensacion de proteccion: cuenta hasta que cierras la ventana.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BudgetState } from '@luxy/shared';
import { FileBudgetStore } from './budget-store.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'luxy-budget-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const estado: BudgetState = {
  deepseek: { day: '2026-09-15', spent: 20.805, inputTokens: 22803, outputTokens: 0, calls: 3 },
};

describe('FileBudgetStore', () => {
  it('empieza vacio cuando no hay archivo', () => {
    expect(new FileBudgetStore(directory).read()).toEqual({});
  });

  it('lo escrito sigue ahi en la sesion siguiente', () => {
    new FileBudgetStore(directory).write(estado);
    expect(new FileBudgetStore(directory).read()).toEqual(estado);
  });

  it('un archivo ilegible no impide arrancar', () => {
    writeFileSync(join(directory, 'budget.json'), 'esto no es json', 'utf8');
    expect(new FileBudgetStore(directory).read()).toEqual({});
  });

  it('una entrada corrupta no borra la cuenta de los demas proveedores', () => {
    writeFileSync(
      join(directory, 'budget.json'),
      JSON.stringify({ deepseek: estado['deepseek'], roto: { day: 'ayer', spent: -1 } }),
      'utf8',
    );
    const store = new FileBudgetStore(directory);
    expect(store.read()['deepseek']).toEqual(estado['deepseek']);
    expect(store.read()['roto']).toBeUndefined();
  });

  it('un disco que no deja escribir avisa pero no interrumpe', () => {
    // el turno de Daniel es una llamada de pago: la contabilidad puede
    // perderse, la respuesta no
    const fallos: unknown[] = [];
    const store = new FileBudgetStore(join(directory, 'sub'), (error) => fallos.push(error));
    // se rompe el archivo poniendo una carpeta en su sitio
    rmSync(join(directory, 'sub'), { recursive: true, force: true });
    writeFileSync(join(directory, 'sub'), 'ahora es un archivo', 'utf8');

    expect(() => store.write(estado)).not.toThrow();
    expect(fallos.length).toBeGreaterThan(0);
    // y la copia en memoria sigue siendo correcta
    expect(store.read()).toEqual(estado);
  });

  it('no guarda nada que no sean cifras', () => {
    new FileBudgetStore(directory).write(estado);
    const crudo = readFileSync(join(directory, 'budget.json'), 'utf8');
    const leido = JSON.parse(crudo) as Record<string, Record<string, unknown>>;
    expect(Object.keys(leido['deepseek'] ?? {}).sort()).toEqual([
      'calls',
      'day',
      'inputTokens',
      'outputTokens',
      'spent',
    ]);
  });
});
