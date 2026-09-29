// el almacen de memorias reescritas con la ficha (`D-108`), con la boveda de
// verdad y archivos temporales. Todo el texto es inventado.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryRelinkEntrySchema, type MemoryRelinkEntry } from '@luxy/shared';
import { VaultError, VaultService, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { MemoryRelinkStore, memoryRelinkFilePath } from './memory-relink-store.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';

function memoryDeviceKeys(): DeviceKeyStore {
  let value: string | undefined;
  return {
    get: () => value,
    set: (next: string) => {
      value = next;
    },
    delete: () => {
      value = undefined;
    },
  };
}

function fila(conversationId: string, over: Partial<MemoryRelinkEntry> = {}): MemoryRelinkEntry {
  return memoryRelinkEntrySchema.parse({
    v: 1,
    conversationId,
    ownerEventId: EVENT,
    characterId: 'nora-inventada',
    status: 'ready',
    basedOn: { sequence: 3, createdAt: '2026-09-20T10:00:00.000Z' },
    memory: {
      version: 1,
      summary: 'RESUMEN-INVENTADO-REESCRITO',
      facts: [],
      decisions: [],
      plan: [],
      openQuestions: [],
      lessons: [],
    },
    drift: { kept: 0, rewritten: 0, dropped: 0, added: 0, shortened: 0 },
    provider: 'claude',
    model: null,
    failure: null,
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
    ...over,
  });
}

describe('MemoryRelinkStore', () => {
  let directory: string;
  let vault: VaultService;
  let store: MemoryRelinkStore;
  let file: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-relink-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), { argon2Params: FAST });
    await vault.create(PASSWORD);
    file = memoryRelinkFilePath(directory);
    store = new MemoryRelinkStore(file);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('guarda cifrado: en disco no se ve ni la memoria ni la conversacion, y no queda temporal', async () => {
    expect(await store.replace(vault, A, undefined, fila(A))).toBe(true);
    const crudo = readFileSync(file, 'utf8');
    expect(crudo).not.toContain('RESUMEN-INVENTADO');
    expect(crudo).not.toContain(A);
    expect(readdirSync(join(directory, 'vault')).some((name) => name.endsWith('.tmp'))).toBe(false);
    expect((await store.forConversation(vault, A))?.memory?.summary).toBe('RESUMEN-INVENTADO-REESCRITO');
  });

  it('lo que llega tarde no pisa lo que se decidio entre medias', async () => {
    await store.replace(vault, A, undefined, fila(A));
    const leida = await store.forConversation(vault, A);
    // Daniel vuelve a la de antes mientras el CLI pensaba
    expect(
      await store.replace(vault, A, leida, { ...leida!, status: 'discarded', memory: null, updatedAt: '2026-09-28T11:00:00.000Z' }),
    ).toBe(true);
    // y el resultado que traia la fila vieja se tira
    expect(await store.replace(vault, A, leida, fila(A, { updatedAt: '2026-09-28T12:00:00.000Z' }))).toBe(false);
    expect((await store.forConversation(vault, A))?.status).toBe('discarded');
    // una fila nueva donde se esperaba ninguna, tambien
    expect(await store.replace(vault, A, undefined, fila(A))).toBe(false);
  });

  it('una fila por conversacion: la nueva sustituye a la de antes', async () => {
    await store.replace(vault, A, undefined, fila(A));
    const antes = await store.forConversation(vault, A);
    await store.replace(vault, A, antes, fila(A, { status: 'applied', updatedAt: '2026-09-28T11:00:00.000Z' }));
    expect([...(await store.all(vault)).values()]).toHaveLength(1);
  });

  it('no guarda la fila de otra conversacion por la puerta de esta', async () => {
    await expect(store.replace(vault, A, undefined, fila(B))).rejects.toThrow(VaultError);
  });

  it('un archivo que no abre detiene el trabajo y no se toca', async () => {
    await store.replace(vault, A, undefined, fila(A));
    writeFileSync(file, '{"version":1,"content":{"version":1,"purpose":"x","nonce":"y","ciphertext":"z"}}');
    const antes = readFileSync(file);
    await expect(store.replace(vault, B, undefined, fila(B))).rejects.toThrow(VaultError);
    await expect(store.all(vault)).rejects.toThrow(VaultError);
    expect(readFileSync(file).equals(antes)).toBe(true);
  });

  it('una fila que no valida se conserva; al borrar su conversacion se va con las suyas', async () => {
    const { sealText } = await import('@luxy/vault-crypto');
    const key = vault.subkeyFor('identity', 'memory-relink');
    const futura = { v: 2, conversationId: B, algo: 'nuevo' };
    const otra = { v: 2, conversationId: A };
    const sealed = await sealText(key, 'vault.identity', JSON.stringify({ v: 1, rows: [futura, otra] }));
    mkdirSync(join(directory, 'vault'), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, content: sealed }));

    await store.replace(vault, A, undefined, fila(A));
    await store.removeConversation(vault, A);
    expect(await store.forConversation(vault, A)).toBeUndefined();

    // lo que queda en disco: solo la ilegible de B
    const { openText } = await import('@luxy/vault-crypto');
    const disco = JSON.parse(readFileSync(file, 'utf8')) as { content: never };
    const texto = await openText(vault.subkeyFor('identity', 'memory-relink'), 'vault.identity', disco.content);
    expect(JSON.parse(texto)).toEqual({ v: 1, rows: [futura] });
  });

  it('borrar una conversacion sin fila no reescribe el archivo', async () => {
    await store.replace(vault, A, undefined, fila(A));
    const antes = readFileSync(file);
    await store.removeConversation(vault, B);
    // byte a byte: resellar cambiaria el nonce aunque el contenido fuera igual
    expect(readFileSync(file).equals(antes)).toBe(true);
    expect((await store.forConversation(vault, A))?.status).toBe('ready');
  });

  it('borrar sin archivo no crea ninguno', async () => {
    await store.removeConversation(vault, A);
    expect(readdirSync(directory).includes('vault') ? readdirSync(join(directory, 'vault')) : []).not.toContain(
      'memory-relink.json',
    );
  });
});
