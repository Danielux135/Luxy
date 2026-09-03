import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryPreferences, memoryPreferencesPath } from './memory-preferences.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('conversaciones excluidas del banco de recuerdos', () => {
  let directory: string;
  let file: string;
  let preferences: MemoryPreferences;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-prefs-'));
    file = memoryPreferencesPath(directory);
    preferences = new MemoryPreferences(file);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('sin archivo no hay ninguna excluida, y no es un error', () => {
    expect([...preferences.excluded()]).toEqual([]);
    expect(preferences.isExcluded(A)).toBe(false);
  });

  it('excluir y volver a incluir', () => {
    expect(preferences.set(A, true)).toEqual([A]);
    expect(preferences.isExcluded(A)).toBe(true);

    expect(preferences.set(A, false)).toEqual([]);
    expect(preferences.isExcluded(A)).toBe(false);
  });

  it('sobrevive a reiniciar la aplicacion', () => {
    preferences.set(A, true);
    expect([...new MemoryPreferences(file).excluded()]).toEqual([A]);
  });

  it('excluir dos veces no la duplica', () => {
    preferences.set(A, true);
    expect(preferences.set(A, true)).toEqual([A]);
  });

  it('el archivo guarda identificadores y NADA mas', () => {
    // es lo que permite no cifrarlo: los uuid ya estan a la vista como nombres
    // de archivo en vault/conversations
    preferences.set(A, true);
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain(A);
    expect(JSON.parse(raw)).toEqual({ version: 1, excluded: [A] });
  });

  it('un archivo ilegible no impide usar la aplicacion', () => {
    // lo peor que pasa es que vuelva a recordarse algo excluido, y eso se
    // arregla volviendo a excluirlo. Fallar aqui dejaria Privado inservible
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'esto no es json', 'utf8');
    expect([...new MemoryPreferences(file).excluded()]).toEqual([]);
  });

  it('un archivo con otra forma se ignora igual', () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 99, excluded: ['no-es-un-uuid'] }), 'utf8');
    expect([...new MemoryPreferences(file).excluded()]).toEqual([]);
  });

  it('cada conversacion se excluye por separado', () => {
    preferences.set(A, true);
    preferences.set(B, true);
    preferences.set(A, false);
    expect([...preferences.excluded()]).toEqual([B]);
  });
});
