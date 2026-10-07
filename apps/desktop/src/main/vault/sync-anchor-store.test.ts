// el ancla del papel de este equipo (F1-R1-01).
//
// Lo que se fija: que se lee y se escribe sin la llave, que una replica no se
// rebaja nunca, que un archivo que no se entiende no se da por «nada apuntado»,
// y la tabla con que se juntan el estado sellado y el ancla.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  SyncAnchorStore,
  effectiveSyncRole,
  syncAnchorFilePath,
  type SyncAnchorRead,
} from './sync-anchor-store.js';

describe('el ancla del papel', () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-sync-anchor-'));
    file = syncAnchorFilePath(directory);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('sin archivo no hay nada apuntado', () => {
    expect(new SyncAnchorStore(file).read()).toEqual({ kind: 'none' });
  });

  it('se apunta sin la llave y sin un solo identificador', () => {
    new SyncAnchorStore(file).record('replica', 'account-login', new Date('2026-10-07T10:00:00.000Z'));
    expect(new SyncAnchorStore(file).read()).toEqual({ kind: 'role', role: 'replica' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      version: 1,
      role: 'replica',
      source: 'account-login',
      at: '2026-10-07T10:00:00.000Z',
    });
  });

  it('una replica no se rebaja a origen', () => {
    const store = new SyncAnchorStore(file);
    store.record('replica', 'account-login');
    store.record('origin', 'sync-pass');
    expect(store.read()).toEqual({ kind: 'role', role: 'replica' });
  });

  it('un origen si puede pasar a replica', () => {
    const store = new SyncAnchorStore(file);
    store.record('origin', 'sync-pass');
    store.record('replica', 'sync-pass');
    expect(store.read()).toEqual({ kind: 'role', role: 'replica' });
  });

  it('un archivo que no se entiende es «ilegible», no «nada apuntado»', () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ roto', 'utf8');
    expect(new SyncAnchorStore(file).read()).toEqual({ kind: 'unreadable' });
    writeFileSync(file, JSON.stringify({ version: 1, role: 'jefe', source: 'sync-pass', at: 'ayer' }), 'utf8');
    expect(new SyncAnchorStore(file).read()).toEqual({ kind: 'unreadable' });
  });

  it('un fallo de E/S al leerlo se lanza: no dice nada del papel', () => {
    // una carpeta en su sitio: leerla da EISDIR, que no es «no existe»
    mkdirSync(file, { recursive: true });
    expect(() => new SyncAnchorStore(file).read()).toThrow();
  });
});

describe('el papel que vale, juntando el estado sellado y el ancla', () => {
  const nada: SyncAnchorRead = { kind: 'none' };
  const replica: SyncAnchorRead = { kind: 'role', role: 'replica' };
  const origen: SyncAnchorRead = { kind: 'role', role: 'origin' };
  const ilegible: SyncAnchorRead = { kind: 'unreadable' };

  it('replica gana siempre, venga de donde venga', () => {
    expect(effectiveSyncRole('replica', nada)).toBe('replica');
    expect(effectiveSyncRole('replica', origen)).toBe('replica');
    expect(effectiveSyncRole('origin', replica)).toBe('replica');
    // el estado sellado perdido no la rebaja
    expect(effectiveSyncRole(null, replica)).toBe('replica');
  });

  it('el origen se reconoce por cualquiera de los dos', () => {
    expect(effectiveSyncRole('origin', nada)).toBe('origin');
    expect(effectiveSyncRole(null, origen)).toBe('origin');
    expect(effectiveSyncRole('origin', ilegible)).toBe('origin');
  });

  it('un ancla ilegible sin nada en el estado es lo prudente: replica', () => {
    expect(effectiveSyncRole(null, ilegible)).toBe('replica');
  });

  it('sin nada en ningun lado, nadie sabe: el de siempre antes de su primera pasada', () => {
    expect(effectiveSyncRole(null, nada)).toBeNull();
  });
});
