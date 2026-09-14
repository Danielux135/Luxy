// quien hace el trabajo de fondo de la boveda: se guarda junto a las
// exclusiones, y no puede estropearlas ni colar una API de pago.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryPreferences, memoryPreferencesPath } from './memory-preferences.js';

const A = '11111111-1111-4111-8111-111111111111';

describe('quien hace el trabajo de fondo', () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-prefs-fondo-'));
    file = memoryPreferencesPath(directory);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const escribir = (contenido: unknown): void => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(contenido), 'utf8');
  };

  it('un archivo de antes, sin el campo, es automatico y conserva las exclusiones', () => {
    escribir({ version: 1, excluded: [A] });
    const preferences = new MemoryPreferences(file);
    expect(preferences.auxiliary()).toBeNull();
    expect(preferences.isExcluded(A)).toBe(true);
  });

  it('se guarda, sobrevive a reabrir y no pierde las exclusiones', () => {
    escribir({ version: 1, excluded: [A] });
    new MemoryPreferences(file).setAuxiliary({ provider: 'claude', model: null });

    const reabierto = new MemoryPreferences(file);
    expect(reabierto.auxiliary()).toEqual({ provider: 'claude', model: null });
    expect(reabierto.isExcluded(A)).toBe(true);
  });

  it('excluir despues no borra la eleccion', () => {
    const preferences = new MemoryPreferences(file);
    preferences.setAuxiliary({ provider: 'codex', model: 'gpt-6' });
    preferences.set(A, true);

    const reabierto = new MemoryPreferences(file);
    expect(reabierto.auxiliary()).toEqual({ provider: 'codex', model: 'gpt-6' });
    expect(reabierto.isExcluded(A)).toBe(true);
  });

  it('un proveedor de pago metido a mano en el archivo no pasa, y las exclusiones siguen', () => {
    escribir({ version: 1, excluded: [A], auxiliary: { provider: 'deepseek', model: null } });
    const preferences = new MemoryPreferences(file);
    expect(preferences.auxiliary()).toBeNull();
    expect(preferences.isExcluded(A)).toBe(true);
  });

  it('volver a automatico se guarda como null', () => {
    const preferences = new MemoryPreferences(file);
    preferences.setAuxiliary({ provider: 'claude', model: null });
    preferences.setAuxiliary(null);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ auxiliary: null });
    expect(new MemoryPreferences(file).auxiliary()).toBeNull();
  });
});
