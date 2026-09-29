// una conversacion ENGANCHADA tiene que quedar como una empezada con el
// personaje (`D-108`): la memoria reescrita con su ficha y leida igual por todos,
// la foto de perfil desde el enganche, y lo que se borra, borrado.
//
// Con los almacenes DE VERDAD —boveda, conversaciones, enganches, reescrituras e
// indice— en una carpeta temporal. Solo se simulan el CLI, los pendientes, los
// medios y el registro. Todo el texto es INVENTADO.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROFILE_PHOTO_LABEL,
  RELATION_CLOSE,
  RELATION_OPEN,
  RELINK_CLOSE,
  RELINK_OPEN,
  relationCountersSchema,
  type ConversationMemory,
} from '@luxy/shared';

const canales = vi.hoisted(
  () => new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
);

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0', getPath: () => '' },
  dialog: {},
  shell: {},
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: {
    removeHandler: (channel: string) => {
      canales.delete(channel);
    },
    handle: (channel: string, fn: (event: unknown, args: unknown) => Promise<unknown>) => {
      canales.set(channel, fn);
    },
  },
  BrowserWindow: class {},
}));

const { registerIpcHandlers } = await import('./handlers.js');
const { IPC_INVOKE } = await import('../../shared/ipc.js');
const { vaultCharacterSchema } = await import('../vault/character-store.js');
const { VaultService } = await import('../vault/vault-service.js');
const { vaultFilePathFor } = await import('../vault/key-file.js');
const { PrivateConversationStore, conversationsDirectory } = await import(
  '../vault/conversation-store.js'
);
const { ConversationOwnerStore, conversationOwnersFilePath } = await import(
  '../vault/conversation-owner-store.js'
);
const { MemoryRelinkStore, memoryRelinkFilePath } = await import('../vault/memory-relink-store.js');
const { PrivateMemory } = await import('../vault/private-memory.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];
type Vault = InstanceType<typeof VaultService>;
type Store = InstanceType<typeof PrivateConversationStore>;
type Relinks = InstanceType<typeof MemoryRelinkStore>;

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const HUERFANA = '11111111-1111-4111-8111-111111111111';
const NACIDA = '22222222-2222-4222-8222-222222222222';
const NORA = 'e0000000-5555-4555-8555-555555555555';
const FICHA = 'Te llamas Nora y eres una pintora inventada.';
const RELACION_VACIA = `${RELATION_OPEN}${JSON.stringify({ new: [], closed: [] })}${RELATION_CLOSE}`;
// cada prueba crea una boveda y hace varios turnos de verdad: sola tarda unos
// 10 s, y con la carga de `npm run check` el tope global de 20 s no alcanza
const LENTA = { timeout: 90_000 } as const;

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

function personaje(over: Record<string, unknown> = {}): unknown {
  return vaultCharacterSchema.parse({
    characterId: NORA,
    imageProvider: 'xavira',
    xavira: { characterId: NORA, modelId: 'modelo-inventado' },
    description: FICHA,
    label: 'Nora',
    avatarObjectKey: 'abcdef0123456789abcdef0123456789',
    createdAt: '2026-09-04T10:00:00.000Z',
    ...over,
  });
}

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

interface Medio {
  mediaId: string;
  metadata: Record<string, unknown>;
  hasThumbnail: boolean;
}

interface Montaje {
  directory: string;
  vault: Vault;
  store: Store;
  relinks: Relinks;
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  prompts: string[];
  reescrituras: number;
  personajes: unknown[];
  excluidas: Set<string>;
  medios: Map<string, Medio[]>;
  modelo: { memoria: ConversationMemory | null };
  respuestaReescritura: string;
  /** para simular un almacen de reescrituras que no escribe */
  romperReescrituras: boolean;
  /** la ficha retroactiva o el indice de cada conversacion */
  fichas: Map<string, unknown>;
  /**
   * si no es null, los dos borrados se paran aqui a mitad: en el primer
   * `await` de cada uno, que es donde cabia el arranque de un envio
   */
  puerta: Promise<void> | null;
  campos: (mensaje: string) => Record<string, unknown> | undefined;
}

let montaje: Montaje;

async function montar(): Promise<Montaje> {
  const directory = mkdtempSync(join(tmpdir(), 'luxy-relink-ipc-'));
  const vault = new VaultService(
    vaultFilePathFor(directory),
    { get: () => undefined, set: () => undefined, delete: () => undefined },
    { argon2Params: FAST },
  );
  await vault.create(PASSWORD);
  const owners = new ConversationOwnerStore(conversationOwnersFilePath(directory));
  const store = new PrivateConversationStore(conversationsDirectory(directory), owners);
  const relinks = new MemoryRelinkStore(memoryRelinkFilePath(directory));
  const excluidas = new Set<string>();
  const memory = new PrivateMemory(store, { excluded: () => excluidas });
  const registros: Montaje['registros'] = [];
  const m: Montaje = {
    directory,
    vault,
    store,
    relinks,
    registros,
    prompts: [],
    reescrituras: 0,
    personajes: [personaje()],
    excluidas,
    medios: new Map(),
    modelo: { memoria: null },
    respuestaReescritura: `${RELINK_OPEN}${JSON.stringify(corregida)}${RELINK_CLOSE}`,
    romperReescrituras: false,
    fichas: new Map(),
    puerta: null,
    campos: (mensaje) => [...registros].reverse().find((r) => r.mensaje === mensaje)?.campos,
  };

  const relations = { notes: [], cursors: [], counters: relationCountersSchema.parse({}) };
  const context = {
    vault,
    privateConversations: store,
    conversationOwners: owners,
    memoryRelinks: {
      all: (v: Vault) => relinks.all(v),
      forConversation: (v: Vault, id: string) => relinks.forConversation(v, id),
      removeConversation: (v: Vault, id: string) => relinks.removeConversation(v, id),
      replace: (...args: Parameters<Relinks['replace']>) => {
        if (m.romperReescrituras) throw new Error('no escribe');
        return relinks.replace(...args);
      },
    },
    privateMemory: memory,
    characters: {
      list: async () => m.personajes,
      readAvatar: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
    privateMedia: {
      list: async (_v: unknown, id: string) => m.medios.get(id) ?? [],
      add: async (_v: unknown, id: string, _bytes: unknown, metadata: Record<string, unknown>) => {
        const lista = m.medios.get(id) ?? [];
        lista.push({ mediaId: `medio-${lista.length + 1}`, metadata, hasThumbnail: false });
        m.medios.set(id, lista);
        return { mediaId: `medio-${lista.length}` };
      },
      deleteConversation: async (id: string) => {
        if (m.puerta !== null) await m.puerta;
        m.medios.delete(id);
      },
    },
    secretStore: { get: () => undefined },
    imageAttempts: { pending: async () => undefined, removeConversation: async () => undefined },
    recaps: {
      entryFor: async (_v: unknown, id: string) => m.fichas.get(id),
      read: async () => ({ entries: [], counters: {} }),
      removeConversation: async () => undefined,
      clearSuperseded: async () => {
        if (m.puerta !== null) await m.puerta;
      },
    },
    catalogs: { removeConversation: async () => undefined },
    relations: {
      read: async () => ({ ...relations, droppedOnRead: 0, unreadable: { notes: [], cursors: [] } }),
      apply: async () => undefined,
      removeConversation: async () => undefined,
    },
    memoryPreferences: { auxiliary: () => null, excluded: () => excluidas },
    controller: {
      runLocalTurn: async (request: { prompt: string; kind?: string }) => {
        if (request.kind === 'technical') {
          if (request.prompt.includes(RELINK_OPEN)) {
            m.reescrituras += 1;
            return { outcome: 'completed', text: m.respuestaReescritura, executedModel: 'cli', error: null };
          }
          return { outcome: 'completed', text: RELACION_VACIA, executedModel: 'cli', error: null };
        }
        m.prompts.push(request.prompt);
        return {
          outcome: 'completed',
          text: 'una respuesta inventada',
          executedModel: 'modelo-inventado',
          inputTokens: 1,
          outputTokens: 1,
          durationMs: 5,
          error: null,
          ...(m.modelo.memoria === null
            ? {}
            : { memory: m.modelo.memoria, memoryStatus: 'structured' }),
        };
      },
    },
    log: (mensaje: string, campos?: Record<string, unknown>) => {
      registros.push({ mensaje, campos });
    },
  } as unknown as HandlerContext;
  registerIpcHandlers(context);
  return m;
}

beforeEach(async () => {
  montaje = await montar();
}, LENTA.timeout);

afterEach(() => {
  rmSync(montaje.directory, { recursive: true, force: true });
});

type Resultado<T> = { ok: true; value: T } | { ok: false; error: string; hint: string | null };

async function invocar<T = Record<string, unknown>>(canal: string, args: unknown): Promise<Resultado<T>> {
  const handler = canales.get(canal);
  if (handler === undefined) throw new Error(`el canal ${canal} no se registro`);
  return (await handler(null, args)) as Resultado<T>;
}

const cambiar = (conversationId: string, characterId: string | null) =>
  invocar(IPC_INVOKE.vaultConversationOwnerSet, { conversationId, characterId, projectAlias: 'luxy' });
const enviar = (conversationId: string) =>
  invocar(IPC_INVOKE.vaultConversationSend, {
    conversationId,
    message: 'mensaje inventado nuevo',
    provider: 'conexion-inventada',
    model: 'modelo-inventado',
    projectAlias: 'luxy',
  });

interface FilaRecuerdo {
  conversationId: string;
  sealedBlock: string;
  relink: {
    phase: string;
    previousBlock: string;
    holdsRewrite: boolean;
    hasMemory: boolean;
    stalled: boolean;
  } | null;
}
const recuerdos = async (): Promise<FilaRecuerdo[]> => {
  const r = await invocar<{ rows: FilaRecuerdo[] }>(IPC_INVOKE.vaultRecapList, {});
  if (!r.ok) throw new Error(r.error);
  return r.value.rows;
};
const decidir = (choice: 'keep-old' | 'retry') =>
  invocar(IPC_INVOKE.vaultMemoryRelinkDecide, { conversationId: HUERFANA, choice, projectAlias: 'luxy' });

/** una conversacion sin personaje, con memoria escrita sin ficha */
async function huerfana(): Promise<void> {
  await montaje.store.appendTurn(montaje.vault, HUERFANA, turno('hola sin nadie', 'user', '2026-09-10T10:00:00.000Z'));
  await montaje.store.appendTurn(
    montaje.vault,
    HUERFANA,
    turno('respuesta sin ficha', 'assistant', '2026-09-10T10:01:00.000Z'),
    { memory: vieja },
  );
}

/**
 * espera a lo que corre en segundo plano, con tope de TIEMPO y no de intentos:
 * con `npm run check` en paralelo cada vuelta tarda mucho mas que 20 ms
 */
async function hasta(condicion: () => Promise<boolean>): Promise<void> {
  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('no llego a pasar');
}
const estado = async (): Promise<string | undefined> =>
  (await montaje.relinks.forConversation(montaje.vault, HUERFANA))?.status;

async function engancharYEsperar(): Promise<void> {
  await huerfana();
  expect((await cambiar(HUERFANA, NORA)).ok).toBe(true);
  await hasta(async () => (await estado()) === 'ready');
}

describe('la memoria de una enganchada, reescrita con su ficha', LENTA, () => {
  it('el siguiente turno viaja con la reescrita, como una nacida con esa memoria', async () => {
    await engancharYEsperar();
    expect(montaje.reescrituras).toBe(1);
    const jsonl = join(conversationsDirectory(montaje.directory), `${HUERFANA}.jsonl`);
    const antes = readFileSync(jsonl);

    expect((await enviar(HUERFANA)).ok).toBe(true);
    const prompt = montaje.prompts.at(-1)!;
    expect(prompt).toContain('Nora vive en un faro inventado');
    expect(prompt).not.toContain('La IA vive en un faro inventado');
    expect(montaje.campos('prompt privado compuesto')).toMatchObject({ memoriaReescrita: true });
    // la uso un mensaje: lo que selle a partir de aqui sale de ella
    expect(await estado()).toBe('applied');
    // lo sellado de antes no se ha tocado: el turno solo AÑADIO lineas
    expect(readFileSync(jsonl).subarray(0, antes.length).equals(antes)).toBe(true);
    expect(await montaje.store.latestMemory(montaje.vault, HUERFANA)).toEqual(vieja);

    // un turno que sella memoria nueva la deja cumplida, y ya no hay vuelta atras
    montaje.modelo.memoria = { ...corregida, summary: `${corregida.summary} MEMORIA-NUEVA.` };
    expect((await enviar(HUERFANA)).ok).toBe(true);
    montaje.modelo.memoria = null;
    const fila = (await recuerdos()).find((each) => each.conversationId === HUERFANA)!;
    expect(fila.relink?.phase).toBe('done');
    expect(fila.sealedBlock).toContain('MEMORIA-NUEVA');
    expect((await decidir('keep-old')).ok).toBe(false);
    // y no se vuelve a reescribir sola
    expect((await enviar(HUERFANA)).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(montaje.reescrituras).toBe(1);
  });

  it('«Lo que recuerda» enseña la que viaja y la de antes, y se puede volver a ella', async () => {
    await engancharYEsperar();
    let fila = (await recuerdos()).find((each) => each.conversationId === HUERFANA)!;
    expect(fila.sealedBlock).toContain('Nora vive en un faro inventado');
    expect(fila.relink).toMatchObject({ phase: 'ready', holdsRewrite: true });
    expect(fila.relink?.previousBlock).toContain('La IA vive en un faro inventado');

    expect((await decidir('keep-old')).ok).toBe(true);
    fila = (await recuerdos()).find((each) => each.conversationId === HUERFANA)!;
    expect(fila.relink).toMatchObject({ phase: 'discarded', holdsRewrite: false });
    expect(fila.sealedBlock).toContain('La IA vive en un faro inventado');
    expect((await enviar(HUERFANA)).ok).toBe(true);
    expect(montaje.prompts.at(-1)).toContain('La IA vive en un faro inventado');
    expect(montaje.campos('prompt privado compuesto')).toMatchObject({ memoriaReescrita: false });

    // pedirla otra vez la vuelve a escribir, y la pantalla sabe en que acabo
    const otraVez = await decidir('retry');
    expect(otraVez).toMatchObject({ ok: true, value: { relinkOutcome: 'ready' } });
    expect(await estado()).toBe('ready');
    expect(montaje.reescrituras).toBe(2);
  });

  // septima ronda: el boton no decia nada cuando la pasada no llegaba a nada
  it('«Reescribir con su ficha» devuelve en que acabo, tambien cuando no sale', async () => {
    await engancharYEsperar();
    expect((await decidir('keep-old')).ok).toBe(true);
    montaje.respuestaReescritura = 'no es un bloque';
    const mal = await decidir('retry');
    expect(mal).toMatchObject({ ok: true, value: { relinkOutcome: 'invalid' } });
    expect(await estado()).toBe('failed');
    // volver a la de antes no lleva resultado de pasada
    montaje.respuestaReescritura = `${RELINK_OPEN}${JSON.stringify(corregida)}${RELINK_CLOSE}`;
    expect(await decidir('retry')).toMatchObject({ ok: true, value: { relinkOutcome: 'ready' } });
    expect(await decidir('keep-old')).toMatchObject({ ok: true, value: { relinkOutcome: null } });
  });

  // septima ronda: sin memoria sellada viaja la ficha retroactiva o el indice,
  // tambien escritos sin su ficha
  it('sin memoria propia y con indice, queda pendiente y reescribe la primera que se selle', async () => {
    await montaje.store.appendTurn(montaje.vault, HUERFANA, turno('hola sin nadie', 'user', '2026-09-10T10:00:00.000Z'));
    await montaje.store.appendTurn(montaje.vault, HUERFANA, turno('respuesta', 'assistant', '2026-09-10T10:01:00.000Z'));
    montaje.fichas.set(HUERFANA, {
      conversationId: HUERFANA,
      memory: vieja,
      source: 'index',
      covered: { from: 0, to: 1 },
      coveredAt: '2026-09-10T10:01:00.000Z',
      gaps: [],
      turnsAtRecap: 2,
      version: 1,
      provider: null,
      model: null,
      at: '2026-09-20T10:00:00.000Z',
      chars: 100,
      approved: false,
      approvalReset: false,
      refusedKind: null,
      refusedAtTurns: null,
      refusedProvider: null,
      supersededAt: null,
    });
    const vista = await invocar<{ inheritedMemory: boolean; hasOwnMemory: boolean }>(
      IPC_INVOKE.vaultConversationOwnerPreview,
      { conversationId: HUERFANA, characterId: NORA },
    );
    expect(vista).toMatchObject({ ok: true, value: { hasOwnMemory: false, inheritedMemory: true } });
    expect((await cambiar(HUERFANA, NORA)).ok).toBe(true);
    expect(await estado()).toBe('pending');
    let fila = (await recuerdos()).find((each) => each.conversationId === HUERFANA);
    expect(fila?.relink).toMatchObject({ phase: 'pending', hasMemory: false });
    // no hay nada sobre lo que trabajar: se dice, sin llamar a nadie
    const pronto = await decidir('retry');
    expect(pronto.ok).toBe(false);
    expect(montaje.reescrituras).toBe(0);

    // la primera respuesta sella memoria: esa es la que se reescribe
    montaje.modelo.memoria = vieja;
    expect((await enviar(HUERFANA)).ok).toBe(true);
    montaje.modelo.memoria = null;
    await hasta(async () => (await estado()) === 'ready');
    expect(montaje.reescrituras).toBe(1);
    fila = (await recuerdos()).find((each) => each.conversationId === HUERFANA);
    expect(fila?.relink).toMatchObject({ phase: 'ready', hasMemory: true });
  });

  it('la sonda y el resumen de sus otras conversaciones leen la misma memoria', async () => {
    montaje.personajes = [personaje({ recentMemories: 'recent-two' })];
    await montaje.store.appendTurn(montaje.vault, NACIDA, {
      ...turno('hola nora', 'user', '2026-09-20T10:00:00.000Z'),
      characterId: NORA,
      characterDescription: FICHA,
    });
    await montaje.store.appendTurn(montaje.vault, NACIDA, turno('hola', 'assistant', '2026-09-20T10:01:00.000Z'));
    await engancharYEsperar();

    // lista y sin usar en su hilo: a sus otras conversaciones les llega YA, y
    // antes se apunta como usada, igual que hace el turno de su hilo. La
    // septima ronda no la llevaba fuera hasta que la usara un mensaje de su
    // hilo, y en una enganchada que Daniel no sigue eso era nunca (octava ronda)
    expect((await enviar(NACIDA)).ok).toBe(true);
    expect(montaje.prompts.at(-1)).toContain('Nora vive en un faro inventado');
    expect(montaje.prompts.at(-1)).not.toContain('La IA vive en un faro inventado');
    expect(await estado()).toBe('applied');

    // y con un mensaje de su hilo sigue igual
    expect((await enviar(HUERFANA)).ok).toBe(true);
    expect(await estado()).toBe('applied');
    expect((await enviar(NACIDA)).ok).toBe(true);
    const deLaOtra = montaje.prompts.at(-1)!;
    expect(deLaOtra).toContain('Nora vive en un faro inventado');
    expect(deLaOtra).not.toContain('La IA vive en un faro inventado');

    const sonda = await invocar(IPC_INVOKE.vaultCompatibility, {
      conversationId: HUERFANA,
      projectAlias: 'luxy',
      targets: [{ provider: 'conexion-inventada' }],
    });
    expect(sonda.ok).toBe(true);
    expect(montaje.prompts.at(-1)).toContain('Nora vive en un faro inventado');
    expect(montaje.prompts.at(-1)).not.toContain('La IA vive en un faro inventado');
  });

  it('excluida no se reescribe, ni pidiendolo', async () => {
    await huerfana();
    montaje.excluidas.add(HUERFANA);
    expect((await cambiar(HUERFANA, NORA)).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(montaje.reescrituras).toBe(0);
    expect((await decidir('retry')).ok).toBe(false);
  });
});

describe('lo que se borra se lleva la reescrita', LENTA, () => {
  it('«Borrar su memoria» la quita ANTES que la sellada, y si no puede no toca nada', async () => {
    await engancharYEsperar();
    montaje.romperReescrituras = true;
    const fallo = await invocar(IPC_INVOKE.vaultConversationMemoryForget, { conversationId: HUERFANA });
    expect(fallo.ok).toBe(false);
    expect(await montaje.store.latestMemory(montaje.vault, HUERFANA)).toEqual(vieja);
    expect(await estado()).toBe('ready');

    montaje.romperReescrituras = false;
    expect((await invocar(IPC_INVOKE.vaultConversationMemoryForget, { conversationId: HUERFANA })).ok).toBe(true);
    expect(await montaje.store.latestMemory(montaje.vault, HUERFANA)).toBeNull();
    // queda apuntado que no hace falta, sin texto: la siguiente nace con la ficha
    expect(await montaje.relinks.forConversation(montaje.vault, HUERFANA)).toMatchObject({
      status: 'not-needed',
      memory: null,
    });
  });

  it('«Borrar su memoria» con un indice detras la deja pendiente, no «no hace falta»', async () => {
    await engancharYEsperar();
    montaje.fichas.set(HUERFANA, { conversationId: HUERFANA, memory: vieja, source: 'index' });
    expect((await invocar(IPC_INVOKE.vaultConversationMemoryForget, { conversationId: HUERFANA })).ok).toBe(true);
    expect(await montaje.relinks.forConversation(montaje.vault, HUERFANA)).toMatchObject({
      status: 'pending',
      memory: null,
      basedOn: null,
    });
  });

  // septima ronda: mirar `sendInFlight` al empezar no bastaba; en el primer
  // `await` de cada borrado cabia el arranque de un envio
  it('mientras dura un borrado no arranca ningun envio', async () => {
    await engancharYEsperar();
    let abrir: () => void = () => undefined;
    montaje.puerta = new Promise<void>((resolve) => {
      abrir = resolve;
    });
    const olvido = invocar(IPC_INVOKE.vaultConversationMemoryForget, { conversationId: HUERFANA });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const envio = await enviar(HUERFANA);
    expect(envio).toMatchObject({ ok: false, error: 'se esta borrando algo de esta conversacion' });
    // tampoco decidir sobre la reescrita
    expect(await decidir('retry')).toMatchObject({ ok: false, error: 'se esta borrando algo de esta conversacion' });
    abrir();
    montaje.puerta = null;
    expect((await olvido).ok).toBe(true);
    expect(await montaje.store.latestMemory(montaje.vault, HUERFANA)).toBeNull();

    // y lo mismo borrando la conversacion entera
    montaje.puerta = new Promise<void>((resolve) => {
      abrir = resolve;
    });
    const borrado = invocar(IPC_INVOKE.vaultConversationDelete, { conversationId: HUERFANA });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await enviar(HUERFANA)).toMatchObject({ ok: false, error: 'se esta borrando algo de esta conversacion' });
    abrir();
    montaje.puerta = null;
    expect((await borrado).ok).toBe(true);
    // no resucita: ni un turno de ella en un archivo borrado
    expect(await montaje.store.read(montaje.vault, HUERFANA)).toEqual([]);
    // y al terminar se puede volver a enviar
    expect((await enviar(HUERFANA)).ok).toBe(true);
  });

  it('soltar y borrar la conversacion se la llevan', async () => {
    await engancharYEsperar();
    expect((await cambiar(HUERFANA, null)).ok).toBe(true);
    expect(await estado()).toBeUndefined();
    // soltada, viaja la sellada de siempre
    expect((await enviar(HUERFANA)).ok).toBe(true);
    expect(montaje.prompts.at(-1)).toContain('La IA vive en un faro inventado');

    expect((await cambiar(HUERFANA, NORA)).ok).toBe(true);
    await hasta(async () => (await estado()) === 'ready');
    expect((await invocar(IPC_INVOKE.vaultConversationDelete, { conversationId: HUERFANA })).ok).toBe(true);
    expect(await estado()).toBeUndefined();
  });
});

describe('la foto de perfil de una enganchada', LENTA, () => {
  it('se copia al enganchar, aunque ya hubiera una imagen generada de ella', async () => {
    await huerfana();
    montaje.medios.set(HUERFANA, [
      {
        mediaId: 'generada',
        metadata: {
          characterId: NORA,
          prompt: 'escena inventada junto al faro',
          caption: null,
          attemptId: 'intento-inventado',
          displayName: null,
        },
        hasThumbnail: false,
      },
    ]);
    expect((await cambiar(HUERFANA, NORA)).ok).toBe(true);
    // desde el enganche, no desde el siguiente mensaje
    const medios = montaje.medios.get(HUERFANA)!;
    expect(medios).toHaveLength(2);
    expect(medios[1]!.metadata).toMatchObject({ caption: PROFILE_PHOTO_LABEL, prompt: null, characterId: NORA });

    // y el turno no la duplica, ni anuncia la generada como su foto de perfil
    expect((await enviar(HUERFANA)).ok).toBe(true);
    expect(montaje.medios.get(HUERFANA)).toHaveLength(2);
    const prompt = montaje.prompts.at(-1)!;
    expect(prompt).toContain('escena inventada junto al faro');
    expect(prompt).not.toContain(`${PROFILE_PHOTO_LABEL} — escena inventada`);
    expect(prompt).toContain(PROFILE_PHOTO_LABEL);
  });
});
