// el almacen de enganches y el dueño resuelto de punta a punta (`D-103`), con la
// boveda de verdad y archivos temporales. Todo el texto es inventado.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultError, VaultService, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';
import { ConversationOwnerStore, conversationOwnersFilePath } from './conversation-owner-store.js';
import { PrivateMemory } from './private-memory.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const NORA = 'nora-inventada';
const OTRA = 'otra-inventada';

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

const turno = (text: string, role: 'user' | 'assistant' = 'user', createdAt?: string) => ({
  role,
  text,
  title: 'Titulo inventado',
  provider: 'x',
  model: null,
  inputTokens: null,
  outputTokens: null,
  ...(createdAt === undefined ? {} : { createdAt }),
});

const enganche = (lastSequence: number, over: Partial<Parameters<ConversationOwnerStore['append']>[2]> = {}) => ({
  lastSequence,
  characterId: NORA,
  characterLabel: 'Nora Inventada',
  characterDescription: 'FICHA-INVENTADA-DE-NORA',
  instructions: null,
  now: '2026-09-25T10:00:00.000Z',
  ...over,
});

describe('ConversationOwnerStore', () => {
  let directory: string;
  let vault: VaultService;
  let owners: ConversationOwnerStore;
  let file: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-owners-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), { argon2Params: FAST });
    await vault.create(PASSWORD);
    file = conversationOwnersFilePath(directory);
    owners = new ConversationOwnerStore(file);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('dos enganches a la vez no repiten generacion y el segundo cita al primero', async () => {
    const [uno, dos] = await Promise.all([
      owners.append(vault, A, enganche(3)),
      owners.append(vault, A, enganche(3, { characterId: null, characterLabel: null, characterDescription: null })),
    ]);
    expect(uno.generation).toBe(1);
    expect(dos.generation).toBe(2);
    expect(dos.supersedes).toEqual([uno.eventId]);
    expect(await owners.forConversation(vault, A)).toHaveLength(2);
  });

  it('el ancla hereda la de los eventos conocidos aunque este equipo tenga menos turnos', async () => {
    await owners.append(vault, A, enganche(43));
    const segundo = await owners.append(vault, A, enganche(19, { characterId: null }));
    expect(segundo.anchorSequence).toBe(43);
  });

  it('en disco no se ve ni la etiqueta ni la ficha, y no queda temporal', async () => {
    await owners.append(vault, A, enganche(3));
    const crudo = readFileSync(file, 'utf8');
    expect(crudo).not.toContain('Nora Inventada');
    expect(crudo).not.toContain('FICHA-INVENTADA');
    expect(crudo).not.toContain(A);
    expect(readdirSync(join(directory, 'vault')).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('un archivo que no abre detiene el trabajo y no se toca', async () => {
    await owners.append(vault, A, enganche(3));
    writeFileSync(file, '{"version":1,"content":{"version":1,"purpose":"x","nonce":"y","ciphertext":"z"}}');
    const antes = readFileSync(file);
    await expect(owners.append(vault, A, enganche(4))).rejects.toThrow(VaultError);
    await expect(owners.all(vault)).rejects.toThrow(VaultError);
    expect(readFileSync(file).equals(antes)).toBe(true);
  });

  it('una fila que no valida se conserva al escribir; al borrar su conversacion se va', async () => {
    // una fila «de una version mas nueva», metida por el mismo camino que escribe
    const { sealText } = await import('@luxy/vault-crypto');
    const key = vault.subkeyFor('identity', 'conversation-owners');
    const futura = { event: { v: 2, conversationId: B, algo: 'nuevo' }, uploadedAt: null };
    const ajena = { event: { v: 2, conversationId: C }, uploadedAt: null };
    const sealed = await sealText(key, 'vault.identity', JSON.stringify({ v: 1, rows: [futura, ajena] }));
    mkdirSync(join(directory, 'vault'), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, content: sealed }));

    await owners.append(vault, A, enganche(3));
    expect((await owners.all(vault)).get(A)).toHaveLength(1);

    // la de B sigue ahi: al borrar B se va, la de C no
    await owners.removeConversation(vault, B);
    await owners.append(vault, A, enganche(5));
    const { openText } = await import('@luxy/vault-crypto');
    const guardado = JSON.parse(readFileSync(file, 'utf8')) as { content: never };
    const key2 = vault.subkeyFor('identity', 'conversation-owners');
    const dentro = JSON.parse(await openText(key2, 'vault.identity', guardado.content)) as {
      rows: { event: { conversationId: string } }[];
    };
    const conversaciones = dentro.rows.map((row) => row.event.conversationId);
    expect(conversaciones).not.toContain(B);
    expect(conversaciones).toContain(C);
    expect(conversaciones.filter((id) => id === A)).toHaveLength(2);
  });

  it('borrar sin archivo no crea nada', async () => {
    await owners.removeConversation(vault, A);
    expect(existsSync(file)).toBe(false);
  });
});

describe('el dueño resuelto, de punta a punta', () => {
  let directory: string;
  let vault: VaultService;
  let owners: ConversationOwnerStore;
  let store: PrivateConversationStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-owner-e2e-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), { argon2Params: FAST });
    await vault.create(PASSWORD);
    owners = new ConversationOwnerStore(conversationOwnersFilePath(directory));
    store = new PrivateConversationStore(conversationsDirectory(directory), owners);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /** la lista y `owner()` son dos entradas a la misma funcion, no dos verdades */
  async function mismaVerdad(id: string): Promise<string | null> {
    const deLaLista = (await store.list(vault)).find((each) => each.conversationId === id)!;
    const entero = await store.owner(vault, id);
    expect(deLaLista.characterId).toBe(entero.characterId);
    return entero.characterId;
  }

  it('datos antiguos: el nacimiento fija dueño, ficha e instrucciones', async () => {
    await store.appendTurn(vault, A, {
      ...turno('hola'),
      characterId: NORA,
      characterDescription: 'Ficha antigua.',
      instructions: 'Habla bajito.',
    });
    await store.appendTurn(vault, A, turno('respuesta', 'assistant'));
    const owner = await store.owner(vault, A);
    expect(owner).toMatchObject({
      characterId: NORA,
      characterDescription: 'Ficha antigua.',
      instructions: 'Habla bajito.',
      source: 'turn',
      signedAfter: 0,
    });
    expect(await mismaVerdad(A)).toBe(NORA);
  });

  it('datos antiguos: soltar con cadena vacia ya no deja la ficha vieja', async () => {
    await store.appendTurn(vault, A, {
      ...turno('hola'),
      characterId: NORA,
      characterDescription: 'Ficha antigua.',
    });
    await store.appendTurn(vault, A, turno('respuesta', 'assistant'));
    await store.appendTurn(vault, A, { ...turno('otra'), characterId: '' });
    const owner = await store.owner(vault, A);
    expect(owner.characterId).toBeNull();
    expect(owner.characterDescription).toBeNull();
    expect(await mismaVerdad(A)).toBeNull();
  });

  it('datos antiguos: un id nuevo sin ficha no hereda la de otro personaje', async () => {
    await store.appendTurn(vault, A, {
      ...turno('hola'),
      characterId: OTRA,
      characterDescription: 'Ficha de la otra.',
    });
    await store.appendTurn(vault, A, turno('respuesta', 'assistant'));
    await store.appendTurn(vault, A, { ...turno('cambio'), characterId: NORA });
    expect((await store.owner(vault, A)).characterDescription).toBeNull();
    expect(await mismaVerdad(A)).toBe(NORA);
  });

  it('con un enganche la conversacion pasa a ser suya, con la ficha del evento', async () => {
    await store.appendTurn(vault, A, turno('hola'));
    await store.appendTurn(vault, A, turno('respuesta', 'assistant'));
    await owners.append(vault, A, enganche(1, { instructions: 'Del personaje.' }));

    const owner = await store.owner(vault, A);
    expect(owner).toMatchObject({
      characterId: NORA,
      characterDescription: 'FICHA-INVENTADA-DE-NORA',
      instructions: 'Del personaje.',
      source: 'link',
      signedAfter: 1,
      linkedAt: '2026-09-25T10:00:00.000Z',
    });
    const resumen = (await store.list(vault)).find((each) => each.conversationId === A)!;
    expect(resumen).toMatchObject({
      characterId: NORA,
      ownerSource: 'link',
      ownerLinked: true,
      linkedAt: '2026-09-25T10:00:00.000Z',
      ownerLabel: 'Nora Inventada',
    });
    expect(await mismaVerdad(A)).toBe(NORA);

    // y los turnos que vienen despues no lo sueltan
    await store.appendTurn(vault, A, turno('sigo'));
    expect(await mismaVerdad(A)).toBe(NORA);

    // soltar
    await owners.append(vault, A, enganche(2, { characterId: null, characterLabel: null, characterDescription: null, instructions: '' }));
    const suelto = await store.owner(vault, A);
    expect(suelto.characterId).toBeNull();
    expect(suelto.instructions).toBeNull();
    expect(await mismaVerdad(A)).toBeNull();
    const tras = (await store.list(vault)).find((each) => each.conversationId === A)!;
    expect(tras.ownerLinked).toBe(true);
    expect(tras.ownerSource).toBe('none');
  });

  it('el indice la cuenta como de Nora al invalidar, y el resumen la pone primera por el enganche', async () => {
    // B: de Nora de nacimiento, reciente
    await store.appendTurn(vault, B, { ...turno('hola b', 'user', '2026-09-24T10:00:00.000Z'), characterId: NORA });
    await store.appendTurn(vault, B, turno('resp b', 'assistant', '2026-09-24T10:01:00.000Z'));
    // A: sin personaje, vieja
    await store.appendTurn(vault, A, turno('hola a', 'user', '2026-09-10T10:00:00.000Z'));
    await store.appendTurn(vault, A, turno('resp a', 'assistant', '2026-09-10T10:01:00.000Z'));
    // C: de Nora, pero excluida
    await store.appendTurn(vault, C, { ...turno('hola c', 'user', '2026-09-25T09:00:00.000Z'), characterId: NORA });

    const memory = new PrivateMemory(store, { excluded: () => new Set([C]) });
    await memory.timeline(vault);
    expect([...memory.conversationsFor(NORA)]).toEqual([B]);

    await owners.append(vault, A, enganche(1, { now: '2026-09-25T11:00:00.000Z' }));
    memory.invalidate();
    await memory.timeline(vault);
    expect([...memory.conversationsFor(NORA)].sort()).toEqual([A, B].sort());
    expect(memory.ownerOf(A)).toEqual({ characterId: NORA, linked: true });
    expect(memory.ownerOf(C)).toBeUndefined();

    const recientes = memory.recentFor(NORA, 'ninguna-actual', 2);
    expect(recientes.map((each) => each.conversationId)).toEqual([A, B]);
    // la excluida no sale nunca, y la actual tampoco
    expect(memory.recentFor(NORA, A, 2).map((each) => each.conversationId)).toEqual([B]);
  });
});
