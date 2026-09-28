// enganchar y soltar una conversacion, y lo que eso cambia en el turno
// (`D-103`, `D-105`).
//
// Con los almacenes DE VERDAD —boveda, conversaciones, enganches e indice— en
// una carpeta temporal: lo que hay que probar es justo la costura entre ellos.
// Solo se simulan el CLI, los pendientes, los medios y el registro. Todo el
// texto es INVENTADO.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RELATION_CLOSE,
  RELATION_OPEN,
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
const { PrivateMemory } = await import('../vault/private-memory.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];
type Vault = InstanceType<typeof VaultService>;
type Store = InstanceType<typeof PrivateConversationStore>;
type Owners = InstanceType<typeof ConversationOwnerStore>;
type Memory = InstanceType<typeof PrivateMemory>;

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const HUERFANA = '11111111-1111-4111-8111-111111111111';
const NACIDA = '22222222-2222-4222-8222-222222222222';
const OTRA_DE_NORA = '33333333-3333-4333-8333-333333333333';
const EXCLUIDA = '44444444-4444-4444-8444-444444444444';
const NORA = 'e0000000-5555-4555-8555-555555555555';
const FICHA = 'Te llamas Nora y eres una pintora inventada.';
const RELACION_VACIA = `${RELATION_OPEN}${JSON.stringify({ new: [], closed: [] })}${RELATION_CLOSE}`;

function personaje(over: Record<string, unknown> = {}): unknown {
  return vaultCharacterSchema.parse({
    characterId: NORA,
    imageProvider: 'xavira',
    xavira: { characterId: NORA, modelId: 'modelo-inventado' },
    description: FICHA,
    label: 'Nora',
    avatarObjectKey: null,
    createdAt: '2026-09-04T10:00:00.000Z',
    ...over,
  });
}

function memoria(summary: string, over: Partial<ConversationMemory> = {}): ConversationMemory {
  return {
    version: 1,
    summary,
    facts: [],
    decisions: [],
    plan: [],
    openQuestions: [],
    lessons: [],
    ...over,
  };
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

interface Registro {
  mensaje: string;
  campos: Record<string, unknown> | undefined;
}

interface Montaje {
  directory: string;
  vault: Vault;
  store: Store;
  owners: Owners;
  memory: Memory;
  registros: Registro[];
  prompts: string[];
  tecnicas: { projectAlias: string; kind: string | undefined }[];
  personajes: unknown[];
  excluidas: Set<string>;
  /** para bloquear la lista de personajes a mitad de un enganche */
  puerta: { abierta: Promise<void> | null; bloqueados: number };
  /** para bloquear la llamada al modelo a mitad de un envio */
  modelo: { puerta: Promise<void> | null; memoria: ConversationMemory | null };
  campos: (mensaje: string) => Record<string, unknown> | undefined;
}

let montaje: Montaje;

async function montar(personajes: unknown[] = [personaje()]): Promise<Montaje> {
  const directory = mkdtempSync(join(tmpdir(), 'luxy-enganche-'));
  const vault = new VaultService(vaultFilePathFor(directory), {
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }, { argon2Params: FAST });
  await vault.create(PASSWORD);
  const owners = new ConversationOwnerStore(conversationOwnersFilePath(directory));
  const store = new PrivateConversationStore(conversationsDirectory(directory), owners);
  const excluidas = new Set<string>();
  const memory = new PrivateMemory(store, { excluded: () => excluidas });
  const registros: Registro[] = [];
  const m: Montaje = {
    directory,
    vault,
    store,
    owners,
    memory,
    registros,
    prompts: [],
    tecnicas: [],
    personajes,
    excluidas,
    puerta: { abierta: null, bloqueados: 0 },
    modelo: { puerta: null, memoria: null },
    campos: (mensaje) => [...registros].reverse().find((r) => r.mensaje === mensaje)?.campos,
  };

  const relations = { notes: [], cursors: [], counters: relationCountersSchema.parse({}) };
  const context = {
    vault,
    privateConversations: store,
    conversationOwners: owners,
    privateMemory: memory,
    characters: {
      list: async () => {
        if (m.puerta.abierta !== null) {
          m.puerta.bloqueados += 1;
          await m.puerta.abierta;
        }
        return m.personajes;
      },
    },
    privateMedia: { list: async () => [], add: async () => undefined },
    secretStore: { get: () => undefined },
    imageAttempts: { pending: async () => undefined },
    recaps: { entryFor: async () => undefined },
    relations: {
      read: async () => ({ ...relations, droppedOnRead: 0, unreadable: { notes: [], cursors: [] } }),
      apply: async () => undefined,
    },
    memoryPreferences: { auxiliary: () => null, excluded: () => excluidas },
    controller: {
      runLocalTurn: async (request: { prompt: string; projectAlias: string; kind?: string }) => {
        if (request.kind === 'technical') {
          m.tecnicas.push({ projectAlias: request.projectAlias, kind: request.kind });
          return { outcome: 'completed', text: RELACION_VACIA, executedModel: 'cli', error: null };
        }
        m.prompts.push(request.prompt);
        if (m.modelo.puerta !== null) await m.modelo.puerta;
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
});

afterEach(() => {
  rmSync(montaje.directory, { recursive: true, force: true });
});

type Resultado<T> = { ok: true; value: T } | { ok: false; error: string; hint: string | null };

async function invocar<T = Record<string, unknown>>(canal: string, args: unknown): Promise<Resultado<T>> {
  const handler = canales.get(canal);
  if (handler === undefined) throw new Error(`el canal ${canal} no se registro`);
  return (await handler(null, args)) as Resultado<T>;
}

const previsualizar = (conversationId: string, characterId: string | null) =>
  invocar(IPC_INVOKE.vaultConversationOwnerPreview, { conversationId, characterId });
const cambiar = (conversationId: string, characterId: string | null) =>
  invocar<{ owner: { source: string; label: string | null; signedAfter: number | null } }>(
    IPC_INVOKE.vaultConversationOwnerSet,
    { conversationId, characterId, projectAlias: 'luxy' },
  );
const enviar = (conversationId: string | null, extra: Record<string, unknown> = {}) =>
  invocar<{
    conversationId: string;
    characterId: string | null;
    characterDescription: string | null;
    instructions: string | null;
    owner: { source: string; label: string | null; signedAfter: number | null };
  }>(IPC_INVOKE.vaultConversationSend, {
    conversationId,
    message: 'mensaje inventado nuevo',
    provider: 'conexion-inventada',
    model: 'modelo-inventado',
    projectAlias: 'luxy',
    ...extra,
  });

/** una conversacion sin personaje, de dos turnos */
async function huerfana(): Promise<void> {
  await montaje.store.appendTurn(montaje.vault, HUERFANA, turno('hola sin nadie', 'user', '2026-09-10T10:00:00.000Z'));
  await montaje.store.appendTurn(
    montaje.vault,
    HUERFANA,
    turno('respuesta sin ficha', 'assistant', '2026-09-10T10:01:00.000Z'),
    { memory: memoria('Resumen inventado de la huerfana. Hablaron de un faro.') },
  );
}

/** una conversacion que nacio con Nora, con instrucciones */
async function nacida(instrucciones: string | null = 'Instrucciones inventadas de Nora.'): Promise<void> {
  await montaje.store.appendTurn(montaje.vault, NACIDA, {
    ...turno('hola nora', 'user', '2026-09-20T10:00:00.000Z'),
    characterId: NORA,
    characterDescription: FICHA,
    ...(instrucciones === null ? {} : { instructions: instrucciones }),
  });
  await montaje.store.appendTurn(montaje.vault, NACIDA, turno('hola', 'assistant', '2026-09-20T10:01:00.000Z'));
}

const esperar = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('las guardas del enganche', () => {
  it('con la boveda cerrada no hace nada', async () => {
    await huerfana();
    montaje.vault.lock('manual');
    const r = await cambiar(HUERFANA, NORA);
    expect(r.ok).toBe(false);
  });

  it('una conversacion vacia se engancha eligiendo antes del primer mensaje', async () => {
    const r = await cambiar(HUERFANA, NORA);
    expect(r).toMatchObject({
      ok: false,
      error: 'esa conversacion no tiene mensajes todavia',
      hint: 'en una conversacion nueva, elige el personaje antes del primer mensaje',
    });
  });

  it('un personaje que no esta en la boveda no se engancha', async () => {
    await huerfana();
    const r = await cambiar(HUERFANA, 'personaje-que-no-existe');
    expect(r).toMatchObject({ ok: false, error: 'ese personaje no esta en la boveda' });
  });

  it('una conversacion que ya es de alguien no se cambia a otro', async () => {
    await nacida();
    const r = await cambiar(NACIDA, NORA);
    expect(r).toMatchObject({
      ok: false,
      error: 'esta conversacion ya es de un personaje',
      hint: 'cambiarla de uno a otro no esta disponible',
    });
  });

  it('soltar no deshace un nacimiento', async () => {
    await nacida();
    const r = await cambiar(NACIDA, null);
    expect(r).toMatchObject({
      ok: false,
      error: 'esa conversacion tiene su personaje fijado en sus propios mensajes',
      hint: 'soltar solo deshace un enganche hecho con el selector',
    });
  });

  it('con un envio en curso no se engancha, y con un enganche en curso no se envia', async () => {
    await huerfana();
    let soltarModelo: () => void = () => undefined;
    montaje.modelo.puerta = new Promise<void>((resolve) => {
      soltarModelo = resolve;
    });
    const envio = enviar(HUERFANA);
    // hasta que el envio este de verdad dentro del modelo: un temporizador fijo
    // se queda corto con la suite entera en marcha
    await vi.waitFor(() => expect(montaje.prompts.length).toBeGreaterThanOrEqual(1), {
      timeout: 10_000,
    });
    expect(await cambiar(HUERFANA, NORA)).toMatchObject({
      ok: false,
      error: 'esa conversacion esta contestando ahora mismo',
    });
    montaje.modelo.puerta = null;
    soltarModelo();
    expect((await envio).ok).toBe(true);

    let abrir: () => void = () => undefined;
    montaje.puerta.abierta = new Promise<void>((resolve) => {
      abrir = resolve;
    });
    const enganche = cambiar(HUERFANA, NORA);
    await vi.waitFor(() => expect(montaje.puerta.bloqueados).toBeGreaterThanOrEqual(1), {
      timeout: 10_000,
    });
    expect(await enviar(HUERFANA)).toMatchObject({
      ok: false,
      error: 'se esta cambiando el personaje de esta conversacion',
      hint: 'espera un momento y vuelve a enviar',
    });
    montaje.puerta.abierta = null;
    abrir();
    expect((await enganche).ok).toBe(true);
  });
});

describe('enganchar', () => {
  it('la vista previa dice lo que va a pasar, sin hacerlo', async () => {
    await huerfana();
    await nacida();
    const r = await previsualizar(HUERFANA, NORA);
    expect(r).toMatchObject({
      ok: true,
      value: {
        characterLabel: 'Nora',
        turns: 2,
        instructionsOutcome: 'character',
        hasOwnMemory: true,
        recentMemoriesOn: false,
        excluded: false,
        backgroundCli: 'codex',
        reviewCalls: 1,
        profilePhotoStays: false,
      },
    });
    expect((await montaje.store.owner(montaje.vault, HUERFANA)).characterId).toBeNull();
  });

  it('engancha con la ficha de la boveda y las instrucciones de su ultima conversacion', async () => {
    await huerfana();
    await nacida();
    const invalidar = vi.spyOn(montaje.memory, 'invalidate');
    const r = await cambiar(HUERFANA, NORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.owner).toMatchObject({ source: 'link', label: 'Nora', signedAfter: 1 });

    const owner = await montaje.store.owner(montaje.vault, HUERFANA);
    expect(owner).toMatchObject({
      characterId: NORA,
      characterDescription: FICHA,
      instructions: 'Instrucciones inventadas de Nora.',
      source: 'link',
    });
    expect(invalidar).toHaveBeenCalled();

    // la relectura se lanza sola, con el proyecto y como tarea tecnica. Va en
    // segundo plano y con la boveda de verdad: con la suite entera en marcha
    // tarda mas que un temporizador fijo, asi que se espera a que ocurra
    await vi.waitFor(() => expect(montaje.tecnicas.length).toBeGreaterThanOrEqual(1), {
      timeout: 10_000,
    });
    expect(montaje.tecnicas[0]).toEqual({ projectAlias: 'luxy', kind: 'technical' });

    // el registro: el verbo y cifras. Ni ids ni nombres
    const campos = montaje.campos('personaje de una conversacion');
    expect(campos).toEqual({ accion: 'enganchar', turnos: 2, instrucciones: 'character', revision: true });
    const todo = JSON.stringify(montaje.registros);
    expect(todo).not.toContain(HUERFANA);
    expect(todo).not.toContain(NORA);
    expect(todo).not.toContain('Nora');
    expect(todo).not.toContain(FICHA);
  });

  it('si la conversacion tiene instrucciones propias, no se pisan', async () => {
    await montaje.store.appendTurn(montaje.vault, HUERFANA, {
      ...turno('hola', 'user', '2026-09-10T10:00:00.000Z'),
      instructions: 'Las propias, inventadas.',
    });
    await montaje.store.appendTurn(montaje.vault, HUERFANA, turno('r', 'assistant', '2026-09-10T10:01:00.000Z'));
    await nacida();
    expect((await previsualizar(HUERFANA, NORA)) as unknown).toMatchObject({
      value: { instructionsOutcome: 'own' },
    });
    await cambiar(HUERFANA, NORA);
    expect((await montaje.store.owner(montaje.vault, HUERFANA)).instructions).toBe(
      'Las propias, inventadas.',
    );
  });

  it('una conversacion excluida no lanza ninguna relectura', async () => {
    await huerfana();
    montaje.excluidas.add(HUERFANA);
    expect((await previsualizar(HUERFANA, NORA)) as unknown).toMatchObject({
      value: { excluded: true, reviewCalls: 0 },
    });
    await cambiar(HUERFANA, NORA);
    await esperar();
    expect(montaje.tecnicas).toHaveLength(0);
    expect(montaje.campos('personaje de una conversacion')).toMatchObject({ revision: false });
  });

  it('el siguiente mensaje ya va con su ficha y firmado desde el ancla', async () => {
    await huerfana();
    await cambiar(HUERFANA, NORA);
    const r = await enviar(HUERFANA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(montaje.prompts.at(-1)).toContain(`QUIEN ERES:\n${FICHA}`);
    expect(r.value.characterId).toBe(NORA);
    expect(r.value.owner).toMatchObject({ source: 'link', signedAfter: 1 });
  });
});

describe('soltar', () => {
  it('quita las instrucciones solo si las puso el enganche', async () => {
    await huerfana();
    await nacida();
    await cambiar(HUERFANA, NORA);
    expect((await previsualizar(HUERFANA, null)) as unknown).toMatchObject({
      value: { instructionsOutcome: 'removed', characterLabel: 'Nora' },
    });
    const r = await cambiar(HUERFANA, null);
    expect(r.ok).toBe(true);
    const owner = await montaje.store.owner(montaje.vault, HUERFANA);
    expect(owner.characterId).toBeNull();
    expect(owner.instructions).toBeNull();
    expect(montaje.campos('personaje de una conversacion')).toMatchObject({
      accion: 'soltar',
      instrucciones: 'removed',
    });
  });

  it('si despues se cambiaron en un turno, se quedan', async () => {
    await huerfana();
    await nacida();
    await cambiar(HUERFANA, NORA);
    expect((await enviar(HUERFANA, { instructions: 'Cambiadas despues.' })).ok).toBe(true);
    expect((await previsualizar(HUERFANA, null)) as unknown).toMatchObject({
      value: { instructionsOutcome: 'kept' },
    });
    await cambiar(HUERFANA, null);
    expect((await montaje.store.owner(montaje.vault, HUERFANA)).instructions).toBe('Cambiadas despues.');
  });
});

describe('el envio y el dueño', () => {
  it('mandar un personaje a una conversacion ya empezada se rechaza sin gastar nada', async () => {
    await huerfana();
    const antes = (await montaje.store.read(montaje.vault, HUERFANA)).length;
    const r = await enviar(HUERFANA, { characterId: NORA });
    expect(r).toMatchObject({
      ok: false,
      error: 'el personaje de una conversacion ya empezada se cambia con el selector Personaje',
      hint: 'no se ha enviado nada',
    });
    expect(montaje.prompts).toHaveLength(0);
    expect((await montaje.store.read(montaje.vault, HUERFANA)).length).toBe(antes);
    expect((await enviar(HUERFANA, { characterDescription: 'otra' })).ok).toBe(false);
  });

  it('al nacer, main sella la ficha de la boveda y las instrucciones del personaje', async () => {
    await nacida();
    const r = await enviar(null, { characterId: NORA, characterDescription: 'LA DEL RENDERER' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const owner = await montaje.store.owner(montaje.vault, r.value.conversationId);
    expect(owner).toMatchObject({
      characterId: NORA,
      characterDescription: FICHA,
      instructions: 'Instrucciones inventadas de Nora.',
      source: 'turn',
      signedAfter: 0,
    });
    expect(montaje.prompts.at(-1)).not.toContain('LA DEL RENDERER');
    expect(montaje.prompts.at(-1)).toContain('Instrucciones inventadas de Nora.');
    expect(r.value.owner).toMatchObject({ source: 'turn', label: 'Nora', signedAfter: 0 });
  });
});

describe('el resumen de sus ultimas conversaciones en el turno', () => {
  async function escena(recent: 'off' | 'recent-two' | undefined): Promise<void> {
    montaje.personajes = [personaje(recent === undefined ? {} : { recentMemories: recent })];
    // la conversacion de ahora
    await nacida();
    // otra de Nora, con memoria sellada
    await montaje.store.appendTurn(montaje.vault, OTRA_DE_NORA, {
      ...turno('hola otra', 'user', '2026-09-22T10:00:00.000Z'),
      characterId: NORA,
    });
    await montaje.store.appendTurn(
      montaje.vault,
      OTRA_DE_NORA,
      turno('r', 'assistant', '2026-09-22T10:01:00.000Z'),
      { memory: memoria('Resumen inventado de la otra. Pintaron un mural.', { decisions: ['Quedaron en volver al mural.'], plan: ['MARCA-PLAN-NO-DEBE-SALIR'] }) },
    );
    // una excluida de Nora, la mas reciente de todas
    await montaje.store.appendTurn(montaje.vault, EXCLUIDA, {
      ...turno('hola excluida', 'user', '2026-09-24T10:00:00.000Z'),
      characterId: NORA,
    });
    await montaje.store.appendTurn(
      montaje.vault,
      EXCLUIDA,
      turno('r', 'assistant', '2026-09-24T10:01:00.000Z'),
      { memory: memoria('MARCA-EXCLUIDA-NO-DEBE-SALIR.') },
    );
    montaje.excluidas.add(EXCLUIDA);
    // y la huerfana, vieja, que se engancha ahora
    await huerfana();
    await cambiar(HUERFANA, NORA);
  }

  it('apagado: el prompt es el de un personaje sin el campo, y `recientes` es null', async () => {
    await escena('off');
    expect((await enviar(NACIDA)).ok).toBe(true);
    const apagado = montaje.prompts.at(-1)!;
    expect(montaje.campos('prompt privado compuesto')).toMatchObject({
      recientes: null,
      recientesError: false,
    });
    rmSync(montaje.directory, { recursive: true, force: true });

    montaje = await montar();
    await escena(undefined);
    expect((await enviar(NACIDA)).ok).toBe(true);
    // un personaje sin el campo se lee como `off`: byte a byte el mismo prompt
    expect(montaje.prompts.at(-1)).toBe(apagado);
    expect(apagado).not.toContain('NO DE ESTA');
    expect(apagado).not.toContain('QUE VA EN CADA CAMPO');
  });

  it('encendido: trae la otra y la enganchada, sin la actual ni la excluida', async () => {
    await escena('recent-two');
    expect((await enviar(NACIDA)).ok).toBe(true);
    const prompt = montaje.prompts.at(-1)!;
    expect(prompt).toContain('DE OTRAS CONVERSACIONES CON EL, NO DE ESTA (DATOS)');
    expect(prompt).toContain('Resumen inventado de la huerfana.');
    expect(prompt).toContain('Resumen inventado de la otra.');
    expect(prompt).toContain('Quedaron en volver al mural.');
    expect(prompt).not.toContain('MARCA-PLAN');
    expect(prompt).not.toContain('MARCA-EXCLUIDA');
    // la enganchada, primera: cuenta como reciente desde el enganche
    expect(prompt.indexOf('de la huerfana')).toBeLessThan(prompt.indexOf('de la otra'));
    expect(prompt).toContain('QUE VA EN CADA CAMPO DE LA MEMORIA');
    expect(montaje.campos('prompt privado compuesto')).toMatchObject({
      recientes: { conversaciones: 2, sinMemoria: 0, decisiones: 1, fuera: 0, sinIndice: false },
      recientesError: false,
    });
    // el canal de las promesas por el resumen se mide; aqui no hay notas vivas
    const eco = montaje.campos('prompt privado compuesto')?.ecoOtras as Record<string, unknown>;
    expect(eco).toMatchObject({ enNotas: 0 });
    expect(Number.isInteger(eco.frases)).toBe(true);
    expect(eco.frases).toBeGreaterThan(0);
  });

  it('apagado, `ecoOtras` es null', async () => {
    await escena('off');
    expect((await enviar(NACIDA)).ok).toBe(true);
    expect(montaje.campos('prompt privado compuesto')).toMatchObject({ ecoOtras: null });
  });

  it('si leer una memoria falla, el turno sale sin bloque y el motivo no se registra', async () => {
    await escena('recent-two');
    const original = montaje.store.latestMemory.bind(montaje.store);
    montaje.store.latestMemory = async (vault, id) => {
      if (id === OTRA_DE_NORA) throw new Error('MOTIVO-SECRETO-INVENTADO');
      return original(vault, id);
    };
    expect((await enviar(NACIDA)).ok).toBe(true);
    expect(montaje.prompts.at(-1)).not.toContain('NO DE ESTA');
    expect(montaje.campos('prompt privado compuesto')).toMatchObject({
      recientes: null,
      recientesError: true,
    });
    expect(JSON.stringify(montaje.registros)).not.toContain('MOTIVO-SECRETO');
  });

  it('`ecoRecientes` lleva solo enteros', async () => {
    await escena('recent-two');
    montaje.modelo.memoria = memoria('Pintaron un mural y volvieron al mural inventado.', {
      decisions: ['Quedaron en volver al mural.'],
    });
    expect((await enviar(NACIDA)).ok).toBe(true);
    const eco = montaje.campos('turno privado terminado')?.ecoRecientes as Record<string, unknown>;
    expect(eco).not.toBeNull();
    for (const value of Object.values(eco)) expect(Number.isInteger(value)).toBe(true);
    expect(eco.conFrasesDeRecientes).toBeGreaterThanOrEqual(1);
  });
});

describe('lo que arreglo la revision del 28/09', () => {
  it('al nacer con un personaje que no esta en la boveda, la ficha del renderer no se usa', async () => {
    const r = await enviar(null, {
      characterId: 'personaje-que-no-existe',
      characterDescription: 'LA DEL RENDERER',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(montaje.prompts.at(-1)).not.toContain('LA DEL RENDERER');
    const owner = await montaje.store.owner(montaje.vault, r.value.conversationId);
    expect(owner.characterDescription).toBeNull();
  });

  it('una conversacion del Studio anterior que solto y volvio a elegir a Nora sigue con su ficha', async () => {
    // el Studio anterior sellaba `''` al soltar y, al volver a elegirla, solo el
    // id: la ficha era igual a la de antes y no se repetia
    await montaje.store.appendTurn(montaje.vault, NACIDA, {
      ...turno('hola nora', 'user', '2026-09-20T10:00:00.000Z'),
      characterId: NORA,
      characterDescription: FICHA,
    });
    await montaje.store.appendTurn(montaje.vault, NACIDA, turno('hola', 'assistant', '2026-09-20T10:01:00.000Z'));
    await montaje.store.appendTurn(montaje.vault, NACIDA, {
      ...turno('sin nadie un rato', 'user', '2026-09-20T10:02:00.000Z'),
      characterId: '',
    });
    await montaje.store.appendTurn(montaje.vault, NACIDA, turno('vale', 'assistant', '2026-09-20T10:03:00.000Z'));
    await montaje.store.appendTurn(montaje.vault, NACIDA, {
      ...turno('vuelve nora', 'user', '2026-09-20T10:04:00.000Z'),
      characterId: NORA,
    });
    await montaje.store.appendTurn(montaje.vault, NACIDA, turno('aqui estoy', 'assistant', '2026-09-20T10:05:00.000Z'));

    const r = await enviar(NACIDA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(montaje.prompts.at(-1)).toContain(`QUIEN ERES:\n${FICHA}`);
    expect(r.value.owner).toMatchObject({ source: 'turn', signedAfter: 4 });
  });

  it('un personaje sin nombre firma como «Sin nombre», no con una cadena vacia', async () => {
    montaje.personajes = [personaje({ label: '' })];
    await huerfana();
    const r = await cambiar(HUERFANA, NORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.owner.label).toBe('Sin nombre');
  });
});

describe('lo que arreglo la segunda ronda del 28/09', () => {
  it('la ficha editada en la boveda llega a una conversacion que ya existe, y se sella una vez', async () => {
    await nacida();
    const nueva = 'Te llamas Nora y ahora eres escultora, tambien inventada.';
    montaje.personajes = [personaje({ description: nueva })];
    const sellados = vi.spyOn(montaje.store, 'appendTurn');
    const conFicha = () =>
      sellados.mock.calls.filter(
        ([, , turn]) => typeof (turn as { characterDescription?: unknown }).characterDescription === 'string',
      ).length;

    const r = await enviar(NACIDA);
    expect(r.ok).toBe(true);
    expect(montaje.prompts.at(-1)).toContain(`QUIEN ERES:\n${nueva}`);
    expect(montaje.prompts.at(-1)).not.toContain(FICHA);
    const owner = await montaje.store.owner(montaje.vault, NACIDA);
    expect(owner).toMatchObject({ characterId: NORA, characterDescription: nueva, source: 'turn' });
    expect(conFicha()).toBe(1);

    // igual que la sellada: no se repite en cada turno
    expect((await enviar(NACIDA)).ok).toBe(true);
    expect(conFicha()).toBe(1);
  });

  it('una ficha vacia en la boveda no borra la sellada', async () => {
    await nacida();
    montaje.personajes = [personaje({ description: '' })];
    expect((await enviar(NACIDA)).ok).toBe(true);
    expect(montaje.prompts.at(-1)).toContain(`QUIEN ERES:\n${FICHA}`);
  });

  it('una ficha de solo espacios tampoco la borra (revision del 28/09)', async () => {
    // el compositor descarta una ficha de espacios con `trim`; si main la
    // sellaba, el prompt se quedaba sin QUIEN ERES
    await nacida();
    montaje.personajes = [personaje({ description: '   ' })];
    expect((await enviar(NACIDA)).ok).toBe(true);
    expect(montaje.prompts.at(-1)).toContain(`QUIEN ERES:\n${FICHA}`);
    const owner = await montaje.store.owner(montaje.vault, NACIDA);
    expect(owner).toMatchObject({ characterDescription: FICHA });
  });

  it('en una conversacion enganchada, la ficha editada tambien llega', async () => {
    await huerfana();
    expect((await cambiar(HUERFANA, NORA)).ok).toBe(true);
    const nueva = 'Te llamas Nora, version corregida e inventada.';
    montaje.personajes = [personaje({ description: nueva })];
    expect((await enviar(HUERFANA)).ok).toBe(true);
    expect(montaje.prompts.at(-1)).toContain(`QUIEN ERES:\n${nueva}`);
    expect((await montaje.store.owner(montaje.vault, HUERFANA)).source).toBe('link');
  });
});
