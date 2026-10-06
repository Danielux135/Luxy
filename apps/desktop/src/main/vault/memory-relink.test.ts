// quien reescribe con la ficha la memoria de una conversacion enganchada
// (`D-108`), con la boveda, las conversaciones, los enganches y el almacen DE
// VERDAD en una carpeta temporal. Solo se simula el CLI. Todo el texto es
// INVENTADO.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { MemoryRelink, type MemoryRelinkDeps } from './memory-relink.js';
import { createAuxiliaryLane } from './relation-sync.js';
import {
  AUXILIARY_BLOCK_MS,
  AUXILIARY_PROCESS_WAIT_MS,
  AuxiliaryCooldown,
} from './auxiliary-cooldown.js';

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
  let respuesta: () => Promise<{
    outcome: 'completed' | 'failed';
    text: string;
    error?: string | null;
    failureReason?: 'auth' | 'rate_limit' | 'api_error' | 'exit_code' | null;
  }>;
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
          return { error: null, ...r, executedModel: 'cli' };
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

  /**
   * el archivo tal y como lo dejaba el codigo de antes de `INV-FONDO-001`:
   * sellado igual, pero sin la marca de las recuperaciones ya hechas
   */
  const escribirArchivoAntiguo = async (rows: unknown[]): Promise<void> => {
    const { sealText } = await import('@luxy/vault-crypto');
    const sealed = await sealText(
      vault.subkeyFor('identity', 'memory-relink'),
      'vault.identity',
      JSON.stringify({ v: 1, rows }),
    );
    writeFileSync(memoryRelinkFilePath(directory), JSON.stringify({ version: 1, content: sealed }));
  };

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
  // escritos sin su ficha, y la primera que se selle sale de ahi. Decima: lo
  // decide el turno que de verdad parte de ellos, no el enganche, porque una
  // ficha retroactiva sin aprobar no viaja y la memoria siguiente nace con su
  // ficha
  it('sin sellada pero con ficha retroactiva, el enganche no decide: la reescribe el turno que parte de ella', async () => {
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
    expect(await relinks.forConversation(vault, otra)).toMatchObject({
      status: 'not-needed',
      basedOn: null,
    });
    // el turno parte del indice
    await relink.noteInheritedMemoryUsed(otra, await store.owner(vault, otra));
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

  // `noteLink` solo ve lo que hay al enganchar: una ficha retroactiva o un
  // indice que aparecen DESPUES dejaban la fila en «no hace falta», que la
  // pasada salta siempre, y la memoria que salia de ellos no se reescribia nunca
  it('una ficha retroactiva que aparece despues de enganchar vuelve la fila a pendiente al usarse', async () => {
    const otra = '55555555-5555-4555-8555-555555555555';
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

    // se resume despues de enganchar, y el turno parte de ahi
    fichas.set(otra, { conversationId: otra, memory: vieja, source: 'index' } as RecapEntry);
    await relink.noteInheritedMemoryUsed(otra, await store.owner(vault, otra));
    expect(await relinks.forConversation(vault, otra)).toMatchObject({ status: 'pending', basedOn: null, memory: null });

    // y la memoria que sella ese turno se reescribe
    await store.appendTurn(vault, otra, turno('r', 'assistant', '2026-09-26T10:01:00.000Z'), { memory: vieja });
    expect(await relink.run({ conversationId: otra, projectAlias: 'luxy' })).toBe('ready');
    expect(llamadas).toHaveLength(1);
  });

  // decima ronda: un «Borrar su memoria» que no pudo apuntar la fila al final
  // la dejaba `applied` atada a una sellada que ya no esta, que se lee
  // «cumplida»; si despues viajaba lo heredado, esa memoria no se reescribia
  it('usar lo heredado vuelve a pendiente una fila de una sellada que ya no esta', async () => {
    await enganchar();
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('ready');
    const lista = (await relinks.forConversation(vault, CONV))!;
    for (const [vuelta, estado] of (['applied', 'discarded', 'failed'] as const).entries()) {
      const antes = (await relinks.forConversation(vault, CONV))!;
      await relinks.replace(vault, CONV, antes, {
        ...lista,
        status: estado,
        memory: estado === 'applied' ? lista.memory : null,
        // la sellada a la que se ataba se borro
        basedOn: { sequence: 99, createdAt: '2026-09-01T00:00:00.000Z' },
        provider: 'codex',
        failure: estado === 'failed' ? 'refused' : null,
        updatedAt: `2026-09-2${vuelta}T00:00:00.000Z`,
      });
      await relink.noteInheritedMemoryUsed(CONV, await store.owner(vault, CONV));
      expect(await relinks.forConversation(vault, CONV)).toMatchObject({
        status: 'pending',
        basedOn: null,
        memory: null,
        failure: null,
      });
    }
  });

  // si el apunte fallaba, los turnos siguientes ya iban con la sellada y no lo
  // volvian a intentar: la memoria salida de lo heredado no se reescribia nunca
  it('si no pudo apuntar que partio de lo heredado, la pasada lo apunta antes de decidir', async () => {
    const otra = '77777777-7777-4777-8777-777777777777';
    await store.appendTurn(vault, otra, turno('hola', 'user', '2026-09-10T10:00:00.000Z'));
    await owners.append(vault, otra, {
      lastSequence: 0,
      characterId: NORA,
      characterLabel: 'Nora',
      characterDescription: null,
      instructions: null,
      now: '2026-09-25T10:00:00.000Z',
    });
    let romper = false;
    const conFallo = new MemoryRelink({
      vault,
      conversations: store,
      relinks: {
        forConversation: (v, id) => relinks.forConversation(v, id),
        replace: (...args) => {
          if (romper) throw new Error('no escribe');
          return relinks.replace(...args);
        },
      },
      recaps: { entryFor: async (_vault, id) => fichas.get(id) },
      characters: { list: async () => [] as never },
      preferences: { auxiliary: () => null as never, excluded: () => excluidas },
      controller: {
        runLocalTurn: async (input) => {
          llamadas.push({ provider: input.provider, kind: input.kind, prompt: input.prompt });
          return { outcome: 'completed', text: bloque(corregida), error: null, executedModel: 'cli' };
        },
      },
      lane: createAuxiliaryLane(),
      isBusy: () => false,
      now: () => new Date().toISOString(),
      log: (mensaje, campos) => registros.push({ mensaje, campos }),
    });
    await conFallo.noteLink(otra);
    expect((await relinks.forConversation(vault, otra))?.status).toBe('not-needed');

    romper = true;
    await conFallo.noteInheritedMemoryUsed(otra, await store.owner(vault, otra));
    romper = false;
    expect(registros.at(-1)).toEqual({
      mensaje: 'memoria reescrita con su ficha',
      campos: { resultado: 'sin-apuntar', paso: 'heredada' },
    });
    expect((await relinks.forConversation(vault, otra))?.status).toBe('not-needed');

    // el turno sella la memoria que salio de lo heredado, y la pasada la reescribe
    await store.appendTurn(vault, otra, turno('r', 'assistant', '2026-09-26T10:01:00.000Z'), { memory: vieja });
    expect(await conFallo.run({ conversationId: otra, projectAlias: 'luxy' })).toBe('ready');
    expect(llamadas).toHaveLength(1);
  });

  // un «Soltar» que no pudo quitar la fila, en una conversacion excluida: la
  // pasada devolvia `excluded` antes de soltar, y el texto se quedaba en disco
  // mientras siguiera excluida
  it('excluida, la pasada suelta igual el texto de una reescrita que ya no vale, sin llamar a nadie', async () => {
    await enganchar();
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('ready');
    await owners.append(vault, CONV, {
      lastSequence: 1,
      characterId: null,
      characterLabel: null,
      characterDescription: null,
      instructions: null,
      now: '2026-09-26T10:00:00.000Z',
    });
    excluidas.add(CONV);
    await relink.sweep('luxy', [CONV]);
    await relink.sweep('luxy', [CONV]);
    expect((await relinks.forConversation(vault, CONV))?.memory).toBeNull();
    expect(llamadas).toHaveLength(1);

    // y una atada que vale no se toca: sigue siendo la que viaja aqui
    const segunda = '88888888-8888-4888-8888-888888888888';
    await store.appendTurn(vault, segunda, turno('hola', 'user', '2026-09-10T10:00:00.000Z'));
    await store.appendTurn(vault, segunda, turno('r', 'assistant', '2026-09-10T10:01:00.000Z'), { memory: vieja });
    await owners.append(vault, segunda, {
      lastSequence: 1,
      characterId: NORA,
      characterLabel: 'Nora',
      characterDescription: null,
      instructions: null,
      now: '2026-09-25T10:00:00.000Z',
    });
    await relink.noteLink(segunda);
    expect(await relink.run({ conversationId: segunda, projectAlias: 'luxy' })).toBe('ready');
    excluidas.add(segunda);
    expect(await relink.run({ conversationId: segunda, projectAlias: 'luxy' })).toBe('excluded');
    expect((await relinks.forConversation(vault, segunda))?.memory).toEqual(corregida);
  });

  it('usar lo heredado no toca una reescrita atada a la sellada de ahora, ni una de otro enganche', async () => {
    await enganchar();
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('ready');
    const lista = await relinks.forConversation(vault, CONV);
    await relink.noteInheritedMemoryUsed(CONV, await store.owner(vault, CONV));
    expect(await relinks.forConversation(vault, CONV)).toEqual(lista);
    // sin enganche no hace nada
    const suelta = '66666666-6666-4666-8666-666666666666';
    await store.appendTurn(vault, suelta, turno('hola', 'user', '2026-09-10T10:00:00.000Z'));
    await relink.noteInheritedMemoryUsed(suelta, await store.owner(vault, suelta));
    expect(await relinks.forConversation(vault, suelta)).toBeUndefined();
  });

  // un «Soltar» que no pudo quitar la fila dejaba el texto reescrito en disco
  // para siempre: la pasada lo veia en fase `none` y no lo tocaba
  it('la pasada suelta el texto de una reescrita cuyo enganche ya no gana', async () => {
    await enganchar();
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('ready');
    // soltar, sin poder quitar la fila
    await owners.append(vault, CONV, {
      lastSequence: 1,
      characterId: null,
      characterLabel: null,
      characterDescription: null,
      instructions: null,
      now: '2026-09-26T10:00:00.000Z',
    });
    expect((await relinks.forConversation(vault, CONV))?.memory).not.toBeNull();

    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('skipped');
    expect((await relinks.forConversation(vault, CONV))?.memory).toBeNull();
    expect(llamadas).toHaveLength(1);
    // y en disco no queda ni una palabra de la reescrita
    expect(await store.latestMemory(vault, CONV)).toEqual(vieja);
  });

  // lo visto sin nada que hacer se saltaba hasta cerrar la boveda, aunque Daniel
  // quitara la conversacion de las excluidas o cambiara de CLI
  it('recheck vuelve a mirar en la pasada lo que se dio por visto', async () => {
    await enganchar();
    excluidas.add(CONV);
    await relink.sweep('luxy', [CONV]);
    excluidas.clear();
    await relink.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(0);
    relink.recheck(CONV);
    await relink.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(1);
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('ready');
  });

  it('recheck sin argumento: tras cambiar de CLI, el otro intenta la negativa del primero', async () => {
    await enganchar();
    auxiliar = { provider: 'claude', model: null };
    respuesta = async () => ({ outcome: 'completed', text: 'Lo siento, no puedo ayudar con eso.' });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('refused');
    await relink.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(1);
    auxiliar = { provider: 'codex', model: null };
    respuesta = async () => ({ outcome: 'completed', text: bloque(corregida) });
    await relink.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(1);
    relink.recheck();
    await relink.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(2);
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('ready');
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

  // `INV-FONDO-001`: un proceso caido ya no deja la conversacion atascada hasta
  // reiniciar. Pone al CLI en espera, y la pantalla lo dice mientras dura
  it('un proceso caido del CLI lo pone en espera, y lo dice; con el otro CLI no espera', async () => {
    await enganchar();
    auxiliar = { provider: 'codex', model: null };
    // un limite de uso es del CLI por si solo (undecima ronda)
    respuesta = async () => ({ outcome: 'failed', text: '', failureReason: 'rate_limit' });
    expect(relink.waitingForProcess()).toBe(false);
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('process');
    expect(relink.waitingForProcess()).toBe(true);
    // con el otro CLI si se volveria a intentar solo: ese no ha fallado
    auxiliar = { provider: 'claude', model: null };
    expect(relink.waitingForProcess()).toBe(false);
    auxiliar = { provider: 'codex', model: null };
    // el boton prueba una vez aunque espere, y si contesta la espera se acaba
    respuesta = async () => ({ outcome: 'completed', text: bloque(corregida) });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy', force: true })).toBe('ready');
    expect(relink.waitingForProcess()).toBe(false);
  });

  // el resultado de fallo del contrato del agente: Claude Code sin sesion. Antes
  // llegaba como `completed` con el mensaje del CLI de texto y se guardaba una
  // fila `failed`/`invalid` que las pasadas automaticas ya no reintentaban
  it('Claude sin sesion no guarda ninguna fila invalid, y el registro dice auth sin texto', async () => {
    await enganchar();
    auxiliar = { provider: 'claude', model: null };
    respuesta = async () => ({
      outcome: 'failed',
      text: '',
      error: 'MENSAJE-DEL-AGENTE-INVENTADO: ejecuta claude auth login',
      failureReason: 'auth',
    });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('process');
    expect(await relinks.forConversation(vault, CONV)).toMatchObject({
      status: 'pending',
      failure: null,
      memory: null,
    });
    const linea = registros.filter((r) => r.mensaje === 'memoria reescrita con su ficha').at(-1);
    expect(linea?.campos).toMatchObject({ resultado: 'process', motivoFallo: 'auth' });
    expect(typeof linea?.campos?.derivaciones).toBe('number');
    expect(JSON.stringify(registros)).not.toContain('MENSAJE-DEL-AGENTE-INVENTADO');
  });

  it('con el CLI arreglado se retoma solo al acabar la espera, sin reiniciar', async () => {
    let ahora = Date.parse('2026-10-06T10:00:00.000Z');
    const espera = new AuxiliaryCooldown({ now: () => ahora });
    const conEspera = new MemoryRelink({
      vault,
      conversations: store,
      relinks,
      recaps: { entryFor: async () => undefined },
      characters: { list: async () => [] as never },
      preferences: {
        auxiliary: () => ({ provider: 'claude', model: null }) as never,
        excluded: () => new Set(),
      },
      controller: {
        runLocalTurn: async (input) => {
          llamadas.push({ provider: input.provider, kind: input.kind, prompt: input.prompt });
          const r = await respuesta();
          return { error: null, ...r, executedModel: 'cli' };
        },
      },
      lane: createAuxiliaryLane(),
      isBusy: () => false,
      now: () => new Date(ahora).toISOString(),
      log: () => undefined,
      cooldown: espera,
    });
    await enganchar();
    respuesta = async () => ({ outcome: 'failed', text: '', failureReason: 'auth' });
    expect(await conEspera.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('process');
    // cada envio lanza la pasada general: durante la espera no llama a nadie
    await conEspera.sweep('luxy', [CONV]);
    await conEspera.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(1);
    expect(espera.lastFailure('claude')).toMatchObject({ reason: 'auth' });

    // Daniel ejecuta `claude auth login`; Studio sigue abierto
    respuesta = async () => ({ outcome: 'completed', text: bloque(corregida) });
    ahora += AUXILIARY_PROCESS_WAIT_MS;
    await conEspera.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(2);
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('ready');
    expect(espera.lastFailure('claude')).toBeNull();
  });

  // undecima ronda: la pasada general recorre las filas en el orden del archivo
  // y un fallo del proceso no escribe nada, asi que la enganchada que fallaba
  // iba SIEMPRE primera. Cada fallo, tratado como del CLI, rearmaba la espera de
  // los cuatro trabajos, y las enganchadas de detras volvian `waiting` la
  // sesion entera, sin reescribirse nunca
  describe('una enganchada que falla delante de las demas', () => {
    const R = '99999999-9999-4999-8999-999999999999';

    /** R, enganchada y pendiente ANTES que CONV en el archivo */
    const engancharLasDos = async (): Promise<void> => {
      await store.appendTurn(vault, R, turno('hola', 'user', '2026-09-10T10:00:00.000Z'));
      await store.appendTurn(vault, R, turno('r', 'assistant', '2026-09-10T10:01:00.000Z'), {
        memory: { ...vieja, summary: `${vieja.summary} MARCA-R` },
      });
      await owners.append(vault, R, {
        lastSequence: 1,
        characterId: NORA,
        characterLabel: 'Nora',
        characterDescription: null,
        instructions: null,
        now: '2026-09-25T10:00:00.000Z',
      });
      await relink.noteLink(R);
      await enganchar();
    };

    /** de quien era cada llamada, por lo que llevaba el prompt */
    const quien = (): string[] =>
      llamadas.map((each) => (each.prompt.includes('MARCA-R') ? 'R' : 'X'));

    const conEspera = (
      espera: AuxiliaryCooldown,
      contestar: (prompt: string) => {
        outcome: 'completed' | 'failed';
        text: string;
        failureReason?: 'auth' | 'api_error';
      },
      cambios: Partial<MemoryRelinkDeps> = {},
    ): MemoryRelink =>
      new MemoryRelink({
        vault,
        conversations: store,
        relinks,
        recaps: { entryFor: async () => undefined },
        characters: { list: async () => [] as never },
        preferences: {
          auxiliary: () => ({ provider: 'claude', model: null }) as never,
          excluded: () => new Set(),
        },
        controller: {
          runLocalTurn: async (input) => {
            llamadas.push({ provider: input.provider, kind: input.kind, prompt: input.prompt });
            return { error: null, executedModel: 'cli', ...contestar(input.prompt) };
          },
        },
        lane: createAuxiliaryLane(),
        isBusy: () => false,
        now: () => new Date().toISOString(),
        log: (mensaje, campos) => registros.push({ mensaje, campos }),
        cooldown: espera,
        ...cambios,
      });

    it('su fallo propio no frena a las de detras ni rearma la espera, y repetido se salta', async () => {
      await engancharLasDos();
      const espera = new AuxiliaryCooldown();
      const pasada = conEspera(espera, (prompt) =>
        prompt.includes('MARCA-R')
          ? { outcome: 'failed', text: '', failureReason: 'api_error' }
          : { outcome: 'completed', text: bloque(corregida) },
      );

      // la pasada tras un envio: R falla, y CONV se reescribe en la misma
      await pasada.sweep('luxy', [R, CONV]);
      expect(quien()).toEqual(['R', 'X']);
      expect((await relinks.forConversation(vault, CONV))?.status).toBe('ready');
      expect(espera.waiting('claude')).toBe(false);

      // la siguiente: R vuelve a fallar con el CLI contestando a las demas. Es
      // suya: se salta un par de horas (decimotercera ronda), sin frenar a nadie
      await pasada.sweep('luxy', [R, CONV]);
      expect(quien()).toEqual(['R', 'X', 'R']);
      expect(espera.waiting('claude')).toBe(false);
      expect(espera.failures()).toEqual([]);
      expect(pasada.blockedThisSession(R)).toBe(true);
      for (let envio = 0; envio < 3; envio += 1) await pasada.sweep('luxy', [R, CONV]);
      expect(llamadas).toHaveLength(3);
      // nada en disco: sigue pendiente, y el boton la prueba igual
      expect((await relinks.forConversation(vault, R))?.status).toBe('pending');
      expect(await pasada.run({ conversationId: R, projectAlias: 'luxy', force: true })).toBe(
        'process',
      );
      expect(llamadas).toHaveLength(4);
      // y si falla tambien a mano, sigue siendo suya: ni rearma la espera ni
      // vuelve a la cola (decimotercera ronda)
      expect(espera.waiting('claude')).toBe(false);
      expect(pasada.blockedThisSession(R)).toBe(true);

      // el registro dice de quien era cada fallo, con enums
      const fallos = registros.filter(
        (each) =>
          each.mensaje === 'memoria reescrita con su ficha' && each.campos?.resultado === 'process',
      );
      expect(fallos.map((each) => each.campos?.atribucion)).toEqual([
        'conversation',
        'blocked',
        'blocked',
      ]);
      expect(JSON.stringify(registros)).not.toContain(R);
    });

    it('tras una espera del CLI, la que fallo va al final: no vuelve a ser la primera', async () => {
      await engancharLasDos();
      let ahora = Date.parse('2026-10-06T10:00:00.000Z');
      const espera = new AuxiliaryCooldown({ now: () => ahora });
      let roto = true;
      const pasada = conEspera(espera, () =>
        roto
          ? { outcome: 'failed', text: '', failureReason: 'auth' }
          : { outcome: 'completed', text: bloque(corregida) },
      );

      await pasada.sweep('luxy', [R, CONV]);
      // sin sesion es del CLI: la de detras espera
      expect(quien()).toEqual(['R']);
      expect(espera.waiting('claude')).toBe(true);

      // `claude auth login`, y pasa la espera
      roto = false;
      ahora += AUXILIARY_PROCESS_WAIT_MS;
      await pasada.sweep('luxy', [R, CONV]);
      expect(quien()).toEqual(['R', 'X', 'R']);
      expect((await relinks.forConversation(vault, CONV))?.status).toBe('ready');
      expect((await relinks.forConversation(vault, R))?.status).toBe('ready');
    });

    // «dos horas, no la sesion» (decimotercera ronda). Saltada por la espera, la
    // pasada la daba por vista (`skipped`, a `idle`) hasta cerrar la boveda: con
    // la boveda abierta, pasadas las dos horas nadie la volvia a probar sola,
    // aunque su fila prometia que si
    it('saltada por la espera, ni se descifra ni se da por vista: pasadas las dos horas la pasada la prueba', async () => {
      await engancharLasDos();
      let ahora = Date.parse('2026-10-06T10:00:00.000Z');
      const espera = new AuxiliaryCooldown({ now: () => ahora });
      let roto = true;
      const descifradas: string[] = [];
      const pasada = conEspera(
        espera,
        (prompt) =>
          roto && prompt.includes('MARCA-R')
            ? { outcome: 'failed', text: '', failureReason: 'api_error' }
            : { outcome: 'completed', text: bloque(corregida) },
        {
          conversations: {
            owner: (cual, id) => {
              descifradas.push(id);
              return store.owner(cual, id);
            },
            latestMemoryRecord: (cual, id) => store.latestMemoryRecord(cual, id),
          },
        },
      );
      // falla sola dos veces con el CLI contestando a la otra entre medias: suya
      await pasada.sweep('luxy', [R, CONV]);
      await pasada.sweep('luxy', [R, CONV]);
      expect(quien()).toEqual(['R', 'X', 'R']);
      expect(pasada.blockedThisSession(R)).toBe(true);

      // cada envio lanza la pasada: mientras la espera la salta, ni la llama ni
      // la descifra para nada
      descifradas.length = 0;
      for (let envio = 0; envio < 3; envio += 1) await pasada.sweep('luxy', [R, CONV]);
      expect(llamadas).toHaveLength(3);
      expect(descifradas).not.toContain(R);

      // un envio EN ella la lanza sin pasar por la pasada: tampoco la da por vista
      expect(await pasada.run({ conversationId: R, projectAlias: 'luxy' })).toBe('blocked');
      expect(llamadas).toHaveLength(3);

      // lo suyo se arregla y pasan las dos horas: el envio siguiente, en
      // cualquier conversacion, la prueba
      roto = false;
      ahora += AUXILIARY_BLOCK_MS + 1;
      expect(pasada.blockedThisSession(R)).toBe(false);
      await pasada.sweep('luxy', [R, CONV]);
      expect(quien()).toEqual(['R', 'X', 'R', 'R']);
      expect((await relinks.forConversation(vault, R))?.status).toBe('ready');
    });

    // un cierre para la pasada que estaba en curso, y solo esa: la de despues
    // sigue donde se quedo
    it('un cierre a mitad corta la pasada aunque la boveda se abra antes de la siguiente', async () => {
      await engancharLasDos();
      const referencia: { pasada: MemoryRelink | null } = { pasada: null };
      const pasada = conEspera(
        new AuxiliaryCooldown(),
        () => ({ outcome: 'completed', text: bloque(corregida) }),
        {
          // la primera queda escrita y, antes de la segunda, se cierra y se
          // vuelve a abrir: lo que ve la pasada es solo el `cancel()`
          log: (mensaje, campos) => {
            registros.push({ mensaje, campos });
            if (campos?.resultado === 'ready' && llamadas.length === 1) referencia.pasada?.cancel();
          },
        },
      );
      referencia.pasada = pasada;
      await pasada.sweep('luxy', [R, CONV]);
      expect(quien()).toEqual(['R']);
      await pasada.sweep('luxy', [R, CONV]);
      expect(quien()).toEqual(['R', 'X']);
      expect((await relinks.forConversation(vault, CONV))?.status).toBe('ready');
    });
  });

  // las dos filas `failed`/`invalid` del 29/09 eran fallos del proceso: se
  // recuperan UNA vez al primer paso por la pasada, y se reescriben solas
  it('recupera una vez la fila invalid que dejo un fallo del proceso, y la reescribe', async () => {
    await enganchar();
    const pendiente = await relinks.forConversation(vault, CONV);
    // lo que dejo el codigo de antes: `failed`/`invalid` con Claude, en un
    // archivo escrito antes de que existiera la marca de recuperacion
    await escribirArchivoAntiguo([
      {
        ...pendiente!,
        status: 'failed',
        failure: 'invalid',
        provider: 'claude',
        updatedAt: '2026-09-29T15:48:00.000Z',
      },
    ]);
    auxiliar = { provider: 'claude', model: null };
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('ready');
    expect(llamadas).toHaveLength(1);
    expect(
      registros.some((r) => r.campos?.resultado === 'recuperadas' && r.campos?.filas === 1),
    ).toBe(true);

    // y no se repite: una `invalid` de verdad, escrita despues, se respeta
    // aunque se cierre y se vuelva a abrir la boveda
    const lista = await relinks.forConversation(vault, CONV);
    await relinks.replace(vault, CONV, lista, {
      ...lista!,
      status: 'failed',
      failure: 'invalid',
      memory: null,
      drift: null,
      provider: 'claude',
      updatedAt: '2026-10-06T10:00:00.000Z',
    });
    vault.lock('manual');
    relink.cancel();
    await vault.unlock(PASSWORD);
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('skipped');
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('failed');
    expect(llamadas).toHaveLength(1);
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

  it('un proceso caido no se persiste; repetido sin que el CLI conteste a nadie, espera', async () => {
    await enganchar();
    respuesta = async () => ({ outcome: 'failed', text: '' });
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('process');
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('pending');
    // el primero sin motivo no se sabe de quien es: no frena a nadie (undecima
    // ronda). El segundo, sin una respuesta del CLI entre medias, tampoco se
    // sabe, y entonces espera: `INV-FONDO-001`, no «hasta reiniciar»
    expect(relink.waitingForProcess()).toBe(false);
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('process');
    expect(relink.waitingForProcess()).toBe(true);
    expect(relink.blockedThisSession(CONV)).toBe(false);
    expect(await relink.run({ conversationId: CONV, projectAlias: 'luxy' })).toBe('waiting');
    expect(llamadas).toHaveLength(2);
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

  // tras el primer cierre, `sweep()` miraba si parar ANTES de llamar a `run()`,
  // que era lo unico que lo desmarcaba: la pasada general no volvia a hacer
  // nada hasta un envio en una enganchada, un enganche o el boton
  it('tras cerrar y volver a abrir la boveda, la pasada general vuelve a lanzar el CLI', async () => {
    await enganchar();
    vault.lock('manual');
    relink.cancel();
    await vault.unlock(PASSWORD);

    await relink.sweep('luxy', [CONV]);
    expect(llamadas).toHaveLength(1);
    expect((await relinks.forConversation(vault, CONV))?.status).toBe('ready');
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
