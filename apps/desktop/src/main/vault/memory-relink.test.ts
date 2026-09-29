// quien reescribe con la ficha la memoria de una conversacion enganchada
// (`D-108`), con la boveda, las conversaciones, los enganches y el almacen DE
// VERDAD en una carpeta temporal. Solo se simula el CLI. Todo el texto es
// INVENTADO.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONVERSATION_MEMORY_ENTRY_CHARS,
  RELINK_CLOSE,
  RELINK_OPEN,
  type ConversationMemory,
  type RecapEntry,
} from '@luxy/shared';
import { VaultService, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';
import { ConversationOwnerStore, conversationOwnersFilePath } from './conversation-owner-store.js';
import { MemoryRelinkStore, memoryRelinkFilePath } from './memory-relink-store.js';
import { MemoryRelink } from './memory-relink.js';
import { createAuxiliaryLane } from './relation-sync.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const CONV = '11111111-1111-4111-8111-111111111111';
const NORA = 'e0000000-5555-4555-8555-555555555555';

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

const vieja: ConversationMemory = {
  version: 1,
  summary:
    'La IA y el pasean por un puerto inventado. Ella le cuenta que pinta barcos al amanecer y el le promete ir a verla el sabado por la mañana, con cafe.',
  facts: ['La IA vive en un faro inventado', 'El la llama marinera cuando esta de buenas'],
  decisions: ['Quedaron en escribirse cada noche'],
  plan: ['El ira al faro el sabado'],
  openQuestions: [],
  lessons: ['A ella le gusta que el pregunte por sus cuadros'],
};

const corregida: ConversationMemory = {
  ...vieja,
  summary: vieja.summary.replace('La IA', 'Nora'),
  facts: ['Nora vive en un faro inventado', vieja.facts[1]!],
};

const bloque = (memory: ConversationMemory): string =>
  `${RELINK_OPEN}${JSON.stringify(memory)}${RELINK_CLOSE}`;

const turno = (text: string, role: 'user' | 'assistant', createdAt: string) => ({
  role,
  text,
  title: 'Titulo inventado',
  provider: 'conexion-inventada',
  model: null,
  inputTokens: null,
  outputTokens: null,
  createdAt,
});

interface Llamada {
  provider: string;
  kind: string | undefined;
  prompt: string;
}

// cada prueba crea una boveda y la desbloquea: sola tarda unos 8 s, y con la
// carga de `npm run check` el tope global de 20 s no alcanza
describe('MemoryRelink', { timeout: 90_000 }, () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;
  let owners: ConversationOwnerStore;
  let relinks: MemoryRelinkStore;
  let llamadas: Llamada[];
  let respuesta: () => Promise<{ outcome: 'completed' | 'failed'; text: string }>;
  let ocupadas: Set<string>;
  let excluidas: Set<string>;
  let auxiliar: { provider: string; model: string | null } | null;
  let registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  let fichas: Map<string, RecapEntry>;
  let relink: MemoryRelink;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-relink-run-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), { argon2Params: FAST });
    await vault.create(PASSWORD);
    owners = new ConversationOwnerStore(conversationOwnersFilePath(directory));
    store = new PrivateConversationStore(conversationsDirectory(directory), owners);
    relinks = new MemoryRelinkStore(memoryRelinkFilePath(directory));
    llamadas = [];
    respuesta = async () => ({ outcome: 'completed', text: bloque(corregida) });
    ocupadas = new Set();
    excluidas = new Set();
    auxiliar = null;
    registros = [];
    fichas = new Map();
    relink = new MemoryRelink({
      vault,
      conversations: store,
      relinks,
      recaps: { entryFor: async (_vault, id) => fichas.get(id) },
      characters: {
        list: async () =>
          [
            {
              characterId: NORA,
              label: 'Nora',
              description: 'Nora es una pintora inventada de treinta años.',
            },
          ] as never,
      },
      preferences: {
        auxiliary: () => auxiliar as never,
        excluded: () => excluidas,
      },
      controller: {
        runLocalTurn: async (input) => {
          llamadas.push({ provider: input.provider, kind: input.kind, prompt: input.prompt });
          const r = await respuesta();
          return { ...r, error: null, executedModel: 'cli' };
        },
      },
      lane: createAuxiliaryLane(),
      isBusy: (id) => ocupadas.has(id),
      now: () => new Date().toISOString(),
      log: (mensaje, campos) => registros.push({ mensaje, campos }),
    });

    await store.appendTurn(vault, CONV, turno('hola sin nadie', 'user', '2026-09-10T10:00:00.000Z'));
    await store.appendTurn(
      vault,
      CONV,
      turno('respuesta sin ficha', 'assistant', '2026-09-10T10:01:00.000Z'),
      { memory: vieja },
    );
  }, 90_000);

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const enganchar = async (): Promise<void> => {
    await owners.append(vault, CONV, {
      lastSequence: 1,
      characterId: NORA,
      characterLabel: 'Nora',
      characterDescription: 'Nora es una pintora inventada de treinta años.',
      instructions: null,
      now: '2026-09-25T10:00:00.000Z',
    });
    await relink.noteLink(CONV);
  };

  const jsonl = (): Buffer => readFileSync(join(conversationsDirectory(directory), `${CONV}.jsonl`));

  it('reescribe con el CLI local, en un turno tecnico, sin tocar el .jsonl', async () => {
    await enganchar();
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('pending');
    const antes = jsonl();

    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('ready');

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.kind).toBe('technical');
    expect(['claude', 'codex']).toContain(llamadas[0]!.provider);
    expect(llamadas[0]!.prompt).toContain('Nora es una pintora inventada');
    const fila = await relinks.forConversation(vault, CONV);
    expect(fila).toMatchObject({ status: 'ready', basedOn: { sequence: 1 } });
    expect(fila?.memory?.facts[0]).toBe('Nora vive en un faro inventado');
    // byte a byte: la memoria sellada de siempre sigue ahi
    expect(jsonl().equals(antes)).toBe(true);
    expect(await store.latestMemory(vault, CONV)).toEqual(vieja);
    // y la segunda pasada no vuelve a llamar
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('skipped');
    expect(llamadas).toHaveLength(1);
  });

  it('nunca una API de pago, aunque la preferencia lo diga', async () => {
    auxiliar = { provider: 'conexion-de-pago', model: 'caro' };
    await enganchar();
    await relink.run({ conversationId: CONV, projectAlias: 'luxy' });
    expect(llamadas).toHaveLength(1);
    expect(['claude', 'codex']).toContain(llamadas[0]!.provider);
  });

  it('sin memoria al enganchar no hay nada que reescribir, ni despues', async () => {
    const otra = '22222222-2222-4222-8222-222222222222';
    await store.appendTurn(vault, otra, turno('hola', 'user', '2026-09-10T10:00:00.000Z'));
    await owners.append(vault, otra, {
      lastSequence: 0,
      characterId: NORA,
      characterLabel: 'Nora',
      characterDescription: null,
      instructions: null,
      now: '2026-09-25T10:00:00.000Z',
    });
    await relink.noteLink(otra);
    expect((await relinks.forConversation(vault, otra))?.status).toBe('not-needed');
    // la memoria que se selle despues ya nace con la ficha
    await store.appendTurn(vault, otra, turno('hola', 'assistant', '2026-09-26T10:00:00.000Z'), { memory: vieja });
    expect(await relink.run({ conversationId: otra, projectAlias: 'luxy' })).toBe('skipped');
    expect(llamadas).toHaveLength(0);
  });

  // septima ronda: sin memoria sellada viaja la ficha retroactiva o el indice,
  // escritos sin su ficha, y la primera que se selle sale de ahi
  it('sin sellada pero con ficha retroactiva, queda pendiente y reescribe la primera que se selle', async () => {
    const otra = '33333333-3333-4333-8333-333333333333';
    await store.appendTurn(vault, otra, turno('hola', 'user', '2026-09-10T10:00:00.000Z'));
    await store.appendTurn(vault, otra, turno('r', 'assistant', '2026-09-10T10:01:00.000Z'));
    fichas.set(otra, { conversationId: otra, memory: vieja, source: 'index' } as RecapEntry);
    await owners.append(vault, otra, {
      lastSequence: 1,
      characterId: NORA,
      characterLabel: 'Nora',
      characterDescription: null,
      instructions: null,
      now: '2026-09-25T10:00:00.000Z',
    });
    await relink.noteLink(otra);
    expect(await relinks.forConversation(vault, otra)).toMatchObject({ status: 'pending', basedOn: null });
    // nada que reescribir todavia: no se llama a nadie
    expect(await relink.run({ conversationId: otra, projectAlias: 'luxy' })).toBe('no-memory');
    expect(llamadas).toHaveLength(0);
    // la primera respuesta sella memoria a partir de la ficha: esa se reescribe
    await store.appendTurn(vault, otra, turno('otra', 'user', '2026-09-26T10:00:00.000Z'));
    await store.appendTurn(vault, otra, turno('r2', 'assistant', '2026-09-26T10:01:00.000Z'), { memory: vieja });
    expect(await relink.run({ conversationId: otra, projectAlias: 'luxy' })).toBe('ready');
    expect(llamadas).toHaveLength(1);
    expect(await relinks.forConversation(vault, otra)).toMatchObject({ status: 'ready', basedOn: { sequence: 3 } });
  });

  it('sin sellada y sin ficha, no hace falta; si la ficha no se puede leer, pendiente', async () => {
    const otra = '44444444-4444-4444-8444-444444444444';
    await store.appendTurn(vault, otra, turno('hola', 'user', '2026-09-10T10:00:00.000Z'));
    await owners.append(vault, otra, {
      lastSequence: 0,
      characterId: NORA,
      characterLabel: 'Nora',
      characterDescription: null,
      instructions: null,
      now: '2026-09-25T10:00:00.000Z',
    });
    expect(await relink.inheritsUnsheetedMemory(otra)).toBe(false);
    fichas.set(otra, { conversationId: otra, memory: null, source: 'cli' } as RecapEntry);
    expect(await relink.inheritsUnsheetedMemory(otra)).toBe(false);
    // lo seguro es una llamada de mas, no dejar lo improvisado sin reescribir
    const rota = new MemoryRelink({
      vault,
      conversations: store,
      relinks,
      recaps: {
        entryFor: async () => {
          throw new Error('no abre');
        },
      },
      characters: { list: async () => [] as never },
      preferences: { auxiliary: () => null as never, excluded: () => new Set() },
      controller: { runLocalTurn: async () => ({ outcome: 'failed', text: '', error: null, executedModel: null }) as never },
      lane: createAuxiliaryLane(),
      isBusy: () => false,
      now: () => new Date().toISOString(),
      log: () => undefined,
    });
    expect(await rota.inheritsUnsheetedMemory(otra)).toBe(true);
  });

  it('al CLI le llega la memoria con la palabra partida ya arreglada', async () => {
    // la huella del `slice` de antes: mide justo su tope y acaba en letra
    const partida = 'palabras '.repeat(40).slice(0, CONVERSATION_MEMORY_ENTRY_CHARS);
    expect(partida.length).toBe(CONVERSATION_MEMORY_ENTRY_CHARS);
    expect(partida.endsWith('palabr')).toBe(true);
    await store.appendTurn(vault, CONV, turno('mas', 'user', '2026-09-11T10:00:00.000Z'));
    await store.appendTurn(vault, CONV, turno('mas', 'assistant', '2026-09-11T10:01:00.000Z'), {
      memory: { ...vieja, facts: [...vieja.facts, partida] },
    });
    await owners.append(vault, CONV, {
      lastSequence: 3,
      characterId: NORA,
      characterLabel: 'Nora',
      characterDescription: 'Nora es una pintora inventada de treinta años.',
      instructions: null,
      now: '2026-09-25T10:00:00.000Z',
    });
    await relink.noteLink(CONV);
    respuesta = async () => ({ outcome: 'completed', text: bloque({ ...corregida, facts: [...corregida.facts, partida] }) });
    await relink.run({ conversationId: CONV, projectAlias: 'luxy' });
    const prompt = llamadas[0]!.prompt;
    expect(prompt).not.toContain(`${partida}"`);
    expect(prompt).toContain('palabras palabras…"');
  });

  it('un proceso caido deja la conversacion atascada en la sesion, y lo dice', async () => {
    await enganchar();
    auxiliar = { provider: 'codex', model: null };
    respuesta = async () => ({ outcome: 'failed', text: '' });
    expect(relink.stalledThisSession(CONV)).toBe(false);
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('process');
    expect(relink.stalledThisSession(CONV)).toBe(true);
    // con el otro CLI si se volveria a intentar solo: no esta atascada
    auxiliar = { provider: 'claude', model: null };
    expect(relink.stalledThisSession(CONV)).toBe(false);
    auxiliar = { provider: 'codex', model: null };
    respuesta = async () => ({ outcome: 'completed', text: bloque(corregida) });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy', force: true })).toBe('ready');
    expect(relink.stalledThisSession(CONV)).toBe(false);
  });

  it('excluida, ocupada o sin enganche no llama a nadie', async () => {
    await enganchar();
    excluidas.add(CONV);
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('excluded');
    excluidas.clear();
    ocupadas.add(CONV);
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('busy');
    expect(llamadas).toHaveLength(0);
  });

  it('una negativa se guarda con su CLI y solo se reintenta con el otro o a mano', async () => {
    await enganchar();
    respuesta = async () => ({ outcome: 'completed', text: 'Lo siento, no puedo ayudar con eso.' });
    auxiliar = { provider: 'claude', model: null };
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('refused');
    expect(await relinks.forConversation(vault, CONV)).toMatchObject({
      status: 'failed',
      failure: 'refused',
      provider: 'claude',
      memory: null,
    });
    // el mismo CLI no vuelve a llamarse solo
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('skipped');
    expect(llamadas).toHaveLength(1);
    // el otro si
    auxiliar = { provider: 'codex', model: null };
    respuesta = async () => ({ outcome: 'completed', text: bloque(corregida) });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('ready');
    expect(llamadas).toHaveLength(2);
  });

  it('una reescritura que pierde material no se aplica y sigue valiendo la de antes', async () => {
    await enganchar();
    respuesta = async () => ({
      outcome: 'completed',
      text: bloque({ ...corregida, summary: 'Nora y el pasean y quedan el sabado.' }),
    });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('lossy');
    expect(await relinks.forConversation(vault, CONV)).toMatchObject({ status: 'failed', failure: 'lossy', memory: null });
  });

  it('un proceso caido no se persiste, y con el mismo CLI no se repite en la sesion', async () => {
    await enganchar();
    respuesta = async () => ({ outcome: 'failed', text: '' });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('process');
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('pending');
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('skipped');
    expect(llamadas).toHaveLength(1);
    // a mano si
    respuesta = async () => ({ outcome: 'completed', text: bloque(corregida) });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy', force: true })).toBe('ready');
  });

  it('un cierre de la boveda a mitad no marca nada', async () => {
    await enganchar();
    respuesta = async () => {
      vault.lock('manual');
      return { outcome: 'completed', text: bloque(corregida) };
    };
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('cut');
    await vault.unlock(PASSWORD);
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('pending');
    // y en la siguiente pasada se vuelve a intentar con el mismo CLI
    respuesta = async () => ({ outcome: 'completed', text: bloque(corregida) });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('ready');
  });

  it('lo que llega tarde se tira: otra memoria sellada o un envio en medio', async () => {
    await enganchar();
    respuesta = async () => {
      // mientras el CLI piensa, un turno sella otra memoria
      await store.appendTurn(vault, CONV, turno('otro', 'user', '2026-09-26T10:00:00.000Z'));
      await store.appendTurn(vault, CONV, turno('otra', 'assistant', '2026-09-26T10:01:00.000Z'), {
        memory: { ...vieja, summary: `${vieja.summary} Y algo mas.` },
      });
      return { outcome: 'completed', text: bloque(corregida) };
    };
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('stale');
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('pending');

    respuesta = async () => {
      ocupadas.add(CONV);
      return { outcome: 'completed', text: bloque(corregida) };
    };
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('stale');
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('pending');
  });

  // octava ronda: una pasada cortada por el cierre solo se reintentaba con un
  // envio EN esa conversacion; la pasada general la recoge tras cualquier envio
  it('la pasada general recoge una pendiente que corto un cierre, y no repite lo hecho', async () => {
    await enganchar();
    respuesta = async () => {
      vault.lock('manual');
      return { outcome: 'completed', text: bloque(corregida) };
    };
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('cut');
    await vault.unlock(PASSWORD);
    respuesta = async () => ({ outcome: 'completed', text: bloque(corregida) });

    await relink.sweep('luxy', [CONV]);
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('ready');
    expect(llamadas).toHaveLength(2);
    // y una segunda pasada no llama a nadie
    await relink.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(2);
    // con la boveda cerrada no hace nada
    vault.lock('manual');
    await relink.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(2);
  });

  // octava ronda: una reescrita ya cumplida guardaba su texto sin que nada lo leyera
  it('una reescrita ya cumplida suelta su texto en la pasada siguiente', async () => {
    await enganchar();
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('ready');
    const lista = await relinks.forConversation(vault, CONV);
    // lo que hace el turno antes de usarla
    await relinks.replace(vault, CONV, lista, { ...lista!, status: 'applied' });
    // y la memoria que sella ese turno sale de ella: la reescrita deja de estar atada
    await store.appendTurn(vault, CONV, turno('otro', 'user', '2026-09-26T10:00:00.000Z'));
    await store.appendTurn(vault, CONV, turno('otra', 'assistant', '2026-09-26T10:01:00.000Z'), {
      memory: corregida,
    });
    expect((await relinks.forConversation(vault, CONV))?.memory).not.toBeNull();

    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('skipped');
    const fila = await relinks.forConversation(vault, CONV);
    expect(fila).toMatchObject({ status: 'applied', memory: null });
    expect(llamadas).toHaveLength(1);
  });

  it('el registro lleva cifras y clasificaciones, nunca texto de la memoria', async () => {
    await enganchar();
    await relink.run({ conversationId: CONV, projectAlias: 'luxy' });
    const linea = registros.find((r) => r.mensaje === 'memoria reescrita con su ficha');
    expect(linea?.campos).toMatchObject({ resultado: 'ready', conservadas: expect.any(Number) });
    const volcado = JSON.stringify(registros);
    expect(volcado).not.toContain('faro');
    expect(volcado).not.toContain(CONV);
    expect(volcado).not.toContain('Nora');
  });
});
