import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

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

const turn = (text: string, role: 'user' | 'assistant' = 'user') => ({
  role,
  text,
  title: 'Un titulo revelador',
  provider: 'xavira',
  model: 'un-modelo',
  inputTokens: null,
  outputTokens: null,
});

describe('conversaciones privadas en disco', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;
  let conversations: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-conv-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    conversations = conversationsDirectory(directory);
    store = new PrivateConversationStore(conversations);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('guarda y recupera un turno', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    const turns = await store.read(vault, A);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe('hola');
    expect(turns[0]?.role).toBe('user');
  });

  it('conserva el orden de los turnos', async () => {
    await store.appendTurn(vault, A, turn('primero'));
    await store.appendTurn(vault, A, turn('segundo', 'assistant'));
    await store.appendTurn(vault, A, turn('tercero'));

    const turns = await store.read(vault, A);
    expect(turns.map((t) => t.text)).toEqual(['primero', 'segundo', 'tercero']);
    expect(turns.map((t) => t.sequence)).toEqual([0, 1, 2]);
  });

  it('el archivo en disco no contiene el texto ni el titulo', async () => {
    await store.appendTurn(vault, A, turn('un secreto que no debe verse'));

    const raw = readFileSync(join(conversations, `${A}.jsonl`), 'utf8');
    expect(raw).not.toContain('un secreto que no debe verse');
    expect(raw).not.toContain('Un titulo revelador');
    expect(raw).not.toContain('xavira');
  });

  it('el nombre del archivo es el uuid, nunca el titulo', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    // %APPDATA% no puede revelar de que hablas ni con la boveda cerrada
    expect(readdirSync(conversations)).toEqual([`${A}.jsonl`]);
  });

  it('sobrevive a cerrar y volver a abrir la boveda', async () => {
    await store.appendTurn(vault, A, turn('escrito antes de cerrar'));
    vault.lock();

    const otra = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await otra.unlock(PASSWORD);
    const turns = await new PrivateConversationStore(conversations).read(otra, A);
    expect(turns[0]?.text).toBe('escrito antes de cerrar');
  });

  it('con la boveda cerrada no se puede leer nada', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    vault.lock();
    await expect(store.read(vault, A)).rejects.toThrow(VaultError);
    await expect(store.list(vault)).rejects.toThrow(VaultError);
  });

  it('separa conversaciones distintas', async () => {
    await store.appendTurn(vault, A, turn('de la primera'));
    await store.appendTurn(vault, B, turn('de la segunda'));

    expect((await store.read(vault, A)).map((t) => t.text)).toEqual(['de la primera']);
    expect((await store.read(vault, B)).map((t) => t.text)).toEqual(['de la segunda']);
  });

  it('lista con titulo y numero de turnos', async () => {
    await store.appendTurn(vault, A, turn('uno'));
    await store.appendTurn(vault, A, turn('dos', 'assistant'));
    await store.appendTurn(vault, B, turn('solo uno'));

    const list = await store.list(vault);
    expect(list).toHaveLength(2);
    const first = list.find((c) => c.conversationId === A);
    expect(first?.title).toBe('Un titulo revelador');
    expect(first?.turns).toBe(2);
  });

  it('el proveedor y el modelo pertenecen a la conversacion', async () => {
    // vivian solo en memoria de la ventana: al reiniciar Studio el proveedor
    // volvia al primero de la lista y el modelo nunca se elegia, asi que una
    // conversacion de roleplay acababa en un modelo que la rechaza
    await store.appendTurn(vault, A, { ...turn('hola'), provider: 'deepseek', model: 'flash' });
    await store.appendTurn(vault, A, {
      ...turn('que tal', 'assistant'),
      provider: 'deepseek',
      model: 'pro',
    });

    expect(await store.latestProvider(vault, A)).toBe('deepseek');
    // vale el ULTIMO que lo llevaba, igual que las instrucciones
    expect(await store.latestModel(vault, A)).toBe('pro');
  });

  it('un turno sin proveedor ni modelo no borra el que hubiera', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), provider: 'deepseek', model: 'pro' });
    await store.appendTurn(vault, A, { ...turn('dos'), provider: null, model: null });

    // `null` significa «este turno no lo cambio», no «se quito»
    expect(await store.latestProvider(vault, A)).toBe('deepseek');
    expect(await store.latestModel(vault, A)).toBe('pro');
  });

  it('sin turnos no hay proveedor ni modelo que recordar', async () => {
    expect(await store.latestProvider(vault, A)).toBeNull();
    expect(await store.latestModel(vault, A)).toBeNull();
  });

  it('cada conversacion recuerda el suyo', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), provider: 'deepseek', model: 'pro' });
    await store.appendTurn(vault, B, { ...turn('otro'), provider: 'claude', model: 'opus' });

    expect(await store.latestModel(vault, A)).toBe('pro');
    expect(await store.latestModel(vault, B)).toBe('opus');
  });

  it('una conversacion inexistente es una lista vacia, no un error', async () => {
    expect(await store.read(vault, B)).toEqual([]);
  });

  it('borrar elimina el archivo', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    store.delete(A);
    expect(await store.read(vault, A)).toEqual([]);
    expect(readdirSync(conversations)).toEqual([]);
  });

  it('una linea corrupta no invalida el resto', async () => {
    await store.appendTurn(vault, A, turn('valido'));
    const file = join(conversations, `${A}.jsonl`);
    // se simula un corte de luz a media escritura
    writeFileSync(file, `${readFileSync(file, 'utf8')}{ esto no es json\n`, 'utf8');

    const turns = await store.read(vault, A);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe('valido');
  });

  it('rechaza un identificador que no sea uuid', async () => {
    // sin esto, "..\\..\\algo" seria una ruta valida de archivo
    await expect(store.appendTurn(vault, '../fuera', turn('x'))).rejects.toThrow(VaultError);
    await expect(store.read(vault, 'no-es-uuid')).rejects.toThrow(VaultError);
  });

  it('ignora archivos ajenos que haya en la carpeta', async () => {
    mkdirSync(conversations, { recursive: true });
    writeFileSync(join(conversations, 'notas.txt'), 'algo', 'utf8');
    writeFileSync(join(conversations, 'invalido.jsonl'), 'algo', 'utf8');
    await store.appendTurn(vault, A, turn('hola'));

    const list = await store.list(vault);
    expect(list.map((c) => c.conversationId)).toEqual([A]);
  });

  it('sin carpeta todavia, la lista esta vacia', async () => {
    const vacio = new PrivateConversationStore(join(directory, 'no-existe'));
    expect(await vacio.list(vault)).toEqual([]);
  });
});

describe('instrucciones fijas de la conversacion', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-instr-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    store = new PrivateConversationStore(conversationsDirectory(directory));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('sin instrucciones no hay instrucciones', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    expect(await store.latestInstructions(vault, A)).toBeNull();
  });

  it('valen las del ultimo turno que las llevaba', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'responde en gallego' });
    // un turno que no las toca NO las borra: solo significa que no las cambio
    await store.appendTurn(vault, A, turn('dos'));
    expect(await store.latestInstructions(vault, A)).toBe('responde en gallego');
  });

  it('la ultima gana', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'la primera' });
    await store.appendTurn(vault, A, { ...turn('dos'), instructions: 'la segunda' });
    expect(await store.latestInstructions(vault, A)).toBe('la segunda');
  });

  it('una cadena vacia las borra, y se distingue de no tocarlas', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'algo' });
    await store.appendTurn(vault, A, { ...turn('dos'), instructions: '' });
    // sin esta distincion no habria forma de volver atras una vez puestas
    expect(await store.latestInstructions(vault, A)).toBeNull();
  });

  it('no salen en claro en el archivo', async () => {
    await store.appendTurn(vault, A, {
      ...turn('hola'),
      instructions: 'un contexto que no debe verse en disco',
    });
    const file = join(conversationsDirectory(directory), `${A}.jsonl`);
    expect(readFileSync(file, 'utf8')).not.toContain('un contexto que no debe verse');
  });

  it('con la boveda cerrada no se pueden leer', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'secreto' });
    vault.lock();
    await expect(store.latestInstructions(vault, A)).rejects.toThrow(VaultError);
  });

  it('cada conversacion tiene las suyas', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'las de A' });
    await store.appendTurn(vault, B, turn('uno'));
    expect(await store.latestInstructions(vault, B)).toBeNull();
  });
});
