// la sincronizacion cruzando el IPC (SYNC-F1-07).
//
// Lo que solo se ve aqui, con los handlers de verdad: que dos pasadas no corren
// a la vez, que borrar espera a que la pasada suelte la conversacion y que lo
// borrado no vuelve, que la lapida se apunta ANTES de borrar nada, que lo bajado
// invalida la memoria DESPUES de escribirse, que una replica no escribe turnos
// y que nada de esto mantiene abierta la boveda (`D-106`).
//
// El gateway es el de verdad con su Supabase falso (`sync-gateway.fixture.ts`):
// sin red y sin tokens.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** canales registrados por `registerIpcHandlers`, para poder invocarlos */
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
const { IPC_INVOKE, vaultSyncResultSchema, vaultSyncDiagnosisSchema } = await import(
  '../../shared/ipc.js'
);
const { VaultService } = await import('../vault/vault-service.js');
const { vaultFilePathFor } = await import('../vault/key-file.js');
const { PrivateConversationStore, conversationsDirectory } = await import(
  '../vault/conversation-store.js'
);
const { PrivateMediaStore, mediaIndexDirectory } = await import('../vault/media-store.js');
const { LocalBlobStore, mediaDirectory } = await import('../vault/blob-store.js');
const { SyncStateStore, syncStateFilePath } = await import('../vault/sync-state-store.js');
const { SyncDeletedStore, syncDeletedFilePath } = await import('../vault/sync-deleted-store.js');
const { SyncAnchorStore, syncAnchorFilePath } = await import('../vault/sync-anchor-store.js');
const { REPLICA_BLOCKED, DELETED_BLOCKED, SyncCoordinator } = await import('../vault/sync-coordinator.js');
const { sealTurn } = await import('../vault/private-store.js');
const { syncVault } = await import('../vault/sync.js');
const { TEST_TOKEN, startTestGateway } = await import('../vault/sync-gateway.fixture.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];
type Gateway = Awaited<ReturnType<typeof startTestGateway>>;
type Vault = InstanceType<typeof VaultService>;

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const X = '0000000a-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Y = '0000000b-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const turn = (text: string) => ({
  role: 'user' as const,
  text,
  title: 'Titulo',
  provider: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
});

function memoryKeys() {
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

interface Equipo {
  directory: string;
  conversations: InstanceType<typeof PrivateConversationStore>;
  media: InstanceType<typeof PrivateMediaStore>;
  state: InstanceType<typeof SyncStateStore>;
  deleted: InstanceType<typeof SyncDeletedStore>;
  anchor: InstanceType<typeof SyncAnchorStore>;
}

let root: string;
let vault: Vault;
let gateway: Gateway;
let equipos = 0;

function equipo(): Equipo {
  equipos += 1;
  const directory = join(root, `equipo-${equipos}`);
  mkdirSync(directory, { recursive: true });
  return {
    directory,
    conversations: new PrivateConversationStore(conversationsDirectory(directory)),
    media: new PrivateMediaStore(mediaIndexDirectory(directory), new LocalBlobStore(mediaDirectory(directory))),
    state: new SyncStateStore(syncStateFilePath(directory)),
    deleted: new SyncDeletedStore(syncDeletedFilePath(directory)),
    anchor: new SyncAnchorStore(syncAnchorFilePath(directory)),
  };
}

/** sube al servidor, desde otro equipo, `count` turnos de cada conversacion */
async function servidorCon(conversaciones: Record<string, number>): Promise<void> {
  const otro = equipo();
  for (const [id, count] of Object.entries(conversaciones)) {
    const records = [];
    for (let sequence = 0; sequence < count; sequence += 1) {
      records.push(await sealTurn(vault, { conversationId: id, sequence, turn: turn(`${id}-${sequence}`) }));
    }
    mkdirSync(conversationsDirectory(otro.directory), { recursive: true });
    writeFileSync(
      join(conversationsDirectory(otro.directory), `${id}.jsonl`),
      records.map((r) => `${JSON.stringify(r)}\n`).join(''),
      'utf8',
    );
  }
  const result = await syncVault(
    vault,
    {
      conversations: otro.conversations,
      media: otro.media,
      state: otro.state,
      deleted: otro.deleted,
      anchor: otro.anchor,
    },
    { gatewayUrl: 'https://gateway.test', sessionToken: TEST_TOKEN, fetchImpl: gateway.fetchImpl },
  );
  expect(result.stopped).toBeNull();
}

interface Huella {
  invalidaciones: { lineas: Record<string, number> }[];
  borrados: string[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
}

function registrar(local: Equipo, extra: Partial<Record<string, unknown>> = {}): Huella {
  const huella: Huella = { invalidaciones: [], borrados: [], registros: [] };
  const lineas = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const id of local.conversations.listConversationIds()) {
      out[id] = local.conversations.syncView(id).records.length;
    }
    return out;
  };
  const quitar = (que: string) => async (_vault: unknown, id: string) => {
    huella.borrados.push(`${que}:${id}`);
  };
  const context = {
    vault,
    privateConversations: local.conversations,
    privateMedia: local.media,
    syncLedger: {
      state: local.state,
      deleted: local.deleted,
      anchor: local.anchor,
      fetchImpl: gateway.fetchImpl,
    },
    configStore: { load: () => ({ gatewayUrl: 'https://gateway.test' }) },
    accounts: {
      sessionToken: () => TEST_TOKEN,
      forgetSession: () => undefined,
      renewSessionExpiry: () => undefined,
    },
    privateMemory: {
      // lo que habia en disco en el momento de invalidar
      invalidate: () => huella.invalidaciones.push({ lineas: lineas() }),
    },
    recaps: { removeConversation: quitar('recap') },
    catalogs: { removeConversation: quitar('catalogo') },
    relations: { removeConversation: quitar('pendientes') },
    imageAttempts: { removeConversation: quitar('intentos') },
    conversationOwners: { removeConversation: quitar('enganche') },
    log: (mensaje: string, campos?: Record<string, unknown>) => {
      huella.registros.push({ mensaje, campos });
    },
    ...extra,
  } as unknown as HandlerContext;
  registerIpcHandlers(context);
  return huella;
}

async function invocar(channel: string, args: unknown): Promise<{ ok: boolean; value?: unknown; error?: string; hint?: string | null }> {
  const handler = canales.get(channel);
  if (handler === undefined) throw new Error(`el canal ${channel} no se registro`);
  return (await handler(null, args)) as { ok: boolean; value?: unknown; error?: string };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'luxy-ipc-sync-'));
  vault = new VaultService(vaultFilePathFor(root), memoryKeys(), { argon2Params: FAST });
  await vault.create(PASSWORD);
  gateway = await startTestGateway();
  equipos = 0;
});

afterEach(() => {
  gateway.stop();
  rmSync(root, { recursive: true, force: true });
});

describe('sincronizar desde la pantalla', () => {
  it('sin argumentos sincroniza todo, y el resultado cumple el contrato del IPC', async () => {
    await servidorCon({ [X]: 3, [Y]: 2 });
    const local = equipo();
    registrar(local);

    const respuesta = await invocar(IPC_INVOKE.vaultSync, undefined);
    expect(respuesta.ok).toBe(true);
    const result = vaultSyncResultSchema.parse(respuesta.value);
    expect(result).toMatchObject({ scope: 'all', stopped: null, downloaded: 5 });
  });

  it('«solo esta conversacion» no toca las demas', async () => {
    await servidorCon({ [X]: 3, [Y]: 2 });
    const local = equipo();
    registrar(local);

    const respuesta = await invocar(IPC_INVOKE.vaultSync, { mode: 'conversation', conversationId: Y });
    const result = vaultSyncResultSchema.parse(respuesta.value);
    expect(result).toMatchObject({ scope: 'conversation', downloaded: 2 });
    expect(local.conversations.listConversationIds()).toEqual([Y]);
  });

  it('rechaza un alcance que no es ni todo ni una conversacion', async () => {
    registrar(equipo());
    expect(await invocar(IPC_INVOKE.vaultSync, { mode: 'conversation' })).toMatchObject({ ok: false });
    expect(await invocar(IPC_INVOKE.vaultSync, { mode: 'todo' })).toMatchObject({ ok: false });
  });

  it('dos sincronizaciones a la vez no duplican lineas, y una tercera no añade otra pasada', async () => {
    await servidorCon({ [X]: 6 });
    const local = equipo();
    registrar(local);
    gateway.calls.length = 0;

    const [uno, dos, tres] = await Promise.all([
      invocar(IPC_INVOKE.vaultSync, {}),
      invocar(IPC_INVOKE.vaultSync, {}),
      invocar(IPC_INVOKE.vaultSync, {}),
    ]);

    expect([uno.ok, dos.ok, tres.ok]).toEqual([true, true, true]);
    // la primera baja todo; la que espera, nada: es la misma pasada para las dos
    expect(vaultSyncResultSchema.parse(uno.value).downloaded).toBe(6);
    expect(vaultSyncResultSchema.parse(dos.value).downloaded).toBe(0);
    expect(dos.value).toEqual(tres.value);
    expect(gateway.calls.filter((c) => c.path.endsWith('/v2/capabilities'))).toHaveLength(2);
    // un solo vuelo: la segunda empieza cuando la primera ya no pide nada
    const segunda = gateway.calls.map((c) => c.path).lastIndexOf('/api/vault/v2/capabilities');
    const ultimaDeLaPrimera = gateway.calls.findIndex((c) => c.path.endsWith('/records/fetch'));
    expect(segunda).toBeGreaterThan(ultimaDeLaPrimera);
    expect(local.conversations.syncView(X).integrity).toMatchObject({ lines: 6, duplicateLines: 0 });
  });

  it('borrar durante una pasada espera a que la suelte, y la conversacion no resucita', async () => {
    await servidorCon({ [X]: 3, [Y]: 2 });
    const local = equipo();
    const huella = registrar(local);

    let borrado: Promise<{ ok: boolean }> | null = null;
    let lapidaMientrasLaTenia: boolean | null = null;
    gateway.intercept = async (path, body) => {
      if (path.endsWith('/records/fetch') && JSON.stringify(body).includes(X) && borrado === null) {
        // Daniel pulsa «Borrar» justo mientras se baja
        borrado = invocar(IPC_INVOKE.vaultConversationDelete, { conversationId: X });
        await new Promise((resolve) => setTimeout(resolve, 30));
        // el borrado espera: aun no ha apuntado ni borrado nada
        lapidaMientrasLaTenia = local.deleted.has(X);
      }
      return undefined;
    };

    const respuesta = await invocar(IPC_INVOKE.vaultSync, {});
    expect(borrado).not.toBeNull();
    expect(await borrado).toMatchObject({ ok: true });

    expect(lapidaMientrasLaTenia).toBe(false);
    const result = vaultSyncResultSchema.parse(respuesta.value);
    // lo que bajaba de X no se escribio: el borrado ya estaba en marcha
    expect(result.conversations.find((c) => c.conversationId === X)).toMatchObject({
      status: 'busy',
      downloaded: 0,
    });
    expect(local.conversations.listConversationIds()).toEqual([Y]);
    expect(local.deleted.has(X)).toBe(true);
    expect(huella.borrados).toContain(`recap:${X}`);

    // y la siguiente pasada no la trae de vuelta
    gateway.intercept = null;
    const otra = vaultSyncResultSchema.parse((await invocar(IPC_INVOKE.vaultSync, {})).value);
    expect(otra.deletedStillOnServer).toBe(1);
    expect(local.conversations.listConversationIds()).toEqual([Y]);
  });

  it('la lapida se apunta ANTES de borrar nada, y sin ella no se borra', async () => {
    const local = equipo();
    await local.conversations.appendTurn(vault, X, turn('hola'));
    let lapidaAlBorrarMedios: boolean | null = null;
    registrar(local, {
      privateMedia: {
        deleteConversation: async (id: string) => {
          lapidaAlBorrarMedios = local.deleted.has(id);
          return 0;
        },
      },
    });

    expect(await invocar(IPC_INVOKE.vaultConversationDelete, { conversationId: X })).toMatchObject({ ok: true });
    expect(lapidaAlBorrarMedios).toBe(true);

    // con la lista de borradas ilegible, borrar se para antes de tocar nada
    const otro = equipo();
    await otro.conversations.appendTurn(vault, Y, turn('sigue aqui'));
    mkdirSync(join(otro.directory, 'vault'), { recursive: true });
    writeFileSync(syncDeletedFilePath(otro.directory), '{ roto', 'utf8');
    registrar(otro);
    const fallo = await invocar(IPC_INVOKE.vaultConversationDelete, { conversationId: Y });
    expect(fallo).toMatchObject({ ok: false });
    expect(otro.conversations.listConversationIds()).toEqual([Y]);
  });

  it('borrar purga sus entradas del estado de la sincronizacion', async () => {
    const local = equipo();
    await local.conversations.appendTurn(vault, X, turn('hola'));
    registrar(local);
    await invocar(IPC_INVOKE.vaultSync, {});
    expect((await local.state.read(vault)).conversations[X]).toBeDefined();

    await invocar(IPC_INVOKE.vaultConversationDelete, { conversationId: X });
    expect((await local.state.read(vault)).conversations[X]).toBeUndefined();
  });

  it('la memoria se invalida DESPUES de escribir lo bajado', async () => {
    await servidorCon({ [X]: 4 });
    const local = equipo();
    const huella = registrar(local);

    await invocar(IPC_INVOKE.vaultSync, {});

    expect(huella.invalidaciones.length).toBeGreaterThan(0);
    // en el momento de invalidar, los cuatro ya estaban en disco
    expect(huella.invalidaciones[0]?.lineas[X]).toBe(4);
  });

  it('sincronizar no mantiene abierta la boveda (D-106)', async () => {
    await servidorCon({ [X]: 2 });
    const local = equipo();
    registrar(local);
    const espera = vi.spyOn(vault, 'beginUserWait');
    const toque = vi.spyOn(vault, 'touch');

    await invocar(IPC_INVOKE.vaultSync, {});

    expect(espera).not.toHaveBeenCalled();
    expect(toque).not.toHaveBeenCalled();
  });

  it('el diagnostico cuenta sin descifrar', async () => {
    const local = equipo();
    await local.conversations.appendTurn(vault, X, turn('uno'));
    await local.conversations.appendTurn(vault, X, turn('dos'));
    registrar(local);
    vault.lock('manual');

    const respuesta = await invocar(IPC_INVOKE.vaultSyncDiagnose, {});
    expect(vaultSyncDiagnosisSchema.parse(respuesta.value)).toEqual({
      conversations: [
        {
          conversationId: X,
          lines: 2,
          turns: 2,
          unreadable: 0,
          duplicateLines: 0,
          duplicateSequences: 0,
          holes: 0,
          partialTail: false,
        },
      ],
      deleted: 0,
    });
  });

  it('en el registro solo hay cifras: ni ids ni texto', async () => {
    await servidorCon({ [X]: 2 });
    const local = equipo();
    const huella = registrar(local);
    await invocar(IPC_INVOKE.vaultSync, {});

    const linea = huella.registros.find((r) => r.mensaje === 'sincronizacion de la boveda');
    expect(linea).toBeDefined();
    expect(JSON.stringify(huella.registros)).not.toContain(X);
    expect(JSON.stringify(huella.registros)).not.toContain(`${X}-0`);
  });
});

describe('la guardia de replica en el envio', () => {
  /** un envio con todo falso salvo la guardia, que es lo que se mide */
  function registrarEnvio(estado: {
    role: 'origin' | 'replica' | null;
    borrada?: boolean;
    /** lo que dice el ancla sin sellar; por defecto, nada apuntado */
    ancla?: { kind: 'none' } | { kind: 'role'; role: 'origin' | 'replica' } | { kind: 'unreadable' };
    /** el estado sellado no se puede leer (un EBUSY, la boveda a medio cerrar) */
    estadoIlegible?: boolean;
  }) {
    const escritos: string[] = [];
    let llamadasAlModelo = 0;
    const context = {
      vault: { isUnlocked: () => true, onLock: () => () => undefined, beginUserWait: () => () => undefined },
      privateConversations: {
        list: async () => [],
        read: async () => [],
        appendTurn: async (_vault: unknown, conversationId: string) => {
          escritos.push(conversationId);
          return { recordId: 'registro' };
        },
        removeLastTurn: () => false,
        latestMemory: async () => null,
        owner: async () => ({
          characterId: null,
          characterDescription: null,
          instructions: null,
          characterLabel: null,
          source: 'none' as const,
          signedAfter: 0,
          linkedAt: null,
          events: 0,
          winningEventId: null,
          instructionsSource: null,
        }),
      },
      privateMedia: { list: async () => [] },
      characters: { list: async () => [] },
      secretStore: { get: () => undefined },
      syncLedger: {
        state: {
          read: async () => {
            if (estado.estadoIlegible === true) throw new Error('EBUSY: recurso ocupado');
            return {
              v: 1,
              deviceId: '99999999-9999-4999-8999-999999999999',
              role: estado.role,
              factsBootstrapped: false,
              autoSync: false,
              conversations: {},
            };
          },
          update: async () => undefined,
          removeConversation: async () => undefined,
        },
        deleted: { has: () => estado.borrada === true, ids: () => new Set(), add: () => undefined },
        anchor: { read: () => estado.ancla ?? { kind: 'none' }, record: () => undefined },
      },
      controller: {
        runLocalTurn: async () => {
          llamadasAlModelo += 1;
          return {
            outcome: 'completed',
            text: 'hola',
            executedModel: null,
            inputTokens: null,
            outputTokens: null,
            durationMs: 1,
            error: null,
          };
        },
      },
      log: () => undefined,
    } as unknown as HandlerContext;
    registerIpcHandlers(context);
    return { escritos, llamadas: () => llamadasAlModelo };
  }

  async function enviar(): Promise<{ ok: boolean; error?: string; hint?: string | null }> {
    return invocar(IPC_INVOKE.vaultConversationSend, {
      conversationId: X,
      message: 'hola',
      provider: 'hcnsec',
      model: 'deepseek-v4-flash',
      projectAlias: 'luxy',
    });
  }

  it('una replica sin los hechos no escribe ni gasta una llamada', async () => {
    const huella = registrarEnvio({ role: 'replica' });

    const respuesta = await enviar();

    expect(respuesta).toMatchObject({ ok: false, error: REPLICA_BLOCKED.message });
    expect(huella.escritos).toEqual([]);
    expect(huella.llamadas()).toBe(0);
  });

  it('en una conversacion borrada en este equipo tampoco', async () => {
    const huella = registrarEnvio({ role: 'origin', borrada: true });

    const respuesta = await enviar();

    expect(respuesta).toMatchObject({ ok: false, error: DELETED_BLOCKED.message });
    expect(huella.escritos).toEqual([]);
  });

  it('el equipo de siempre envia como siempre', async () => {
    const huella = registrarEnvio({ role: 'origin' });
    const respuesta = await enviar();
    expect(huella.escritos.length).toBeGreaterThan(0);
    expect(respuesta.error ?? '').not.toContain(REPLICA_BLOCKED.message);
  });

  it('el que entro en la cuenta no escribe ni ANTES de su primera pasada (F1-R1-01)', async () => {
    // el papel aun sin decidir en el estado sellado; el ancla, apuntada al entrar
    const huella = registrarEnvio({ role: null, ancla: { kind: 'role', role: 'replica' } });

    const respuesta = await enviar();

    expect(respuesta).toMatchObject({ ok: false, error: REPLICA_BLOCKED.message });
    expect(huella.escritos).toEqual([]);
    expect(huella.llamadas()).toBe(0);
  });

  it('una replica cuyo estado sellado no se lee sigue sin escribir (F1-R1-01)', async () => {
    // antes, un fallo al leerlo devolvia «sin papel» y dejaba enviar
    const huella = registrarEnvio({
      role: 'replica',
      estadoIlegible: true,
      ancla: { kind: 'role', role: 'replica' },
    });

    expect(await enviar()).toMatchObject({ ok: false, error: REPLICA_BLOCKED.message });
    expect(huella.escritos).toEqual([]);
  });

  it('el de siempre, sin ancla de replica, envia aunque su estado sellado no se lea', async () => {
    const huella = registrarEnvio({ role: null, estadoIlegible: true });
    const respuesta = await enviar();
    expect(huella.escritos.length).toBeGreaterThan(0);
    expect(respuesta.error ?? '').not.toContain(REPLICA_BLOCKED.message);
  });
});

describe('la guardia de replica, de punta a punta (T3)', () => {
  // el SyncCoordinator, el SyncStateStore y el ancla de verdad, contra el
  // gateway de verdad con su Supabase falso. Antes solo se probaba con un estado
  // falso que ya decia «replica», y no como llega un equipo a serlo
  function coordinador(
    local: Equipo,
    anchor: Pick<InstanceType<typeof SyncAnchorStore>, 'read' | 'record'> = local.anchor,
  ) {
    return new SyncCoordinator({
      vault,
      conversations: local.conversations,
      media: local.media,
      state: local.state,
      deleted: local.deleted,
      anchor: anchor as InstanceType<typeof SyncAnchorStore>,
      isBusy: () => false,
      connection: () => ({
        gatewayUrl: 'https://gateway.test',
        sessionToken: TEST_TOKEN,
        onUnauthorized: () => undefined,
        onSessionRenewed: () => undefined,
      }),
      onDownloaded: () => undefined,
      fetchImpl: gateway.fetchImpl,
    });
  }

  it('equipo nuevo con el servidor lleno: ni antes ni despues de la primera pasada escribe', async () => {
    await servidorCon({ [X]: 3 });
    const nuevo = equipo();
    // lo que apunta entrar en la cuenta con la carpeta vacia (account-manager.test)
    nuevo.anchor.record('replica', 'account-login');
    const sync = coordinador(nuevo);

    // antes de pulsar «Sincronizar»: una conversacion nueva tampoco
    await expect(sync.assertMayWrite(Y)).rejects.toThrow(REPLICA_BLOCKED.message);

    // aunque algo se hubiera escrito aqui antes, la pasada no lo hace origen
    await nuevo.conversations.appendTurn(vault, Y, turn('escrito antes de sincronizar'));
    const result = await sync.request({ mode: 'all' });
    expect(result.role).toBe('replica');
    expect(result.downloaded).toBe(3);

    // y la conversacion bajada del otro equipo no se puede seguir aqui
    await expect(sync.assertMayWrite(X)).rejects.toThrow(REPLICA_BLOCKED.message);
    await expect(sync.assertMayWrite(Y)).rejects.toThrow(REPLICA_BLOCKED.message);
  });

  it('la guardia se vuelve a leer despues de la pasada que decide el papel', async () => {
    // un equipo sin ancla de replica (entro con un Studio anterior a F1) y sin
    // nada propio. El ancla se aisla con un doble que no apunta nada: lo que se
    // mide es que la guardia guardada antes de la pasada no se queda vieja
    await servidorCon({ [X]: 2 });
    const viejo = equipo();
    const sync = coordinador(viejo, { read: () => ({ kind: 'none' }), record: () => undefined });

    // sin papel todavia: el de siempre antes de su primera pasada puede escribir
    await expect(sync.assertMayWrite(Y)).resolves.toBeUndefined();

    const result = await sync.request({ mode: 'all' });
    expect(result.role).toBe('replica');
    await expect(sync.assertMayWrite(X)).rejects.toThrow(REPLICA_BLOCKED.message);
  });

  it('una replica que pierde su estado sellado no vuelve a escribir', async () => {
    await servidorCon({ [X]: 2 });
    const nuevo = equipo();
    const sync = coordinador(nuevo);
    expect((await sync.request({ mode: 'all' })).role).toBe('replica');

    // el estado sellado desaparece (ilegible y borrado, o a mano)
    rmSync(syncStateFilePath(nuevo.directory));
    const otra = await sync.request({ mode: 'all' });
    expect(otra.role).toBe('replica');
    await expect(sync.assertMayWrite(X)).rejects.toThrow(REPLICA_BLOCKED.message);
  });

  it('el de siempre, con lo suyo, sigue escribiendo antes y despues', async () => {
    const deSiempre = equipo();
    await deSiempre.conversations.appendTurn(vault, X, turn('mio'));
    const sync = coordinador(deSiempre);
    await expect(sync.assertMayWrite(X)).resolves.toBeUndefined();
    expect((await sync.request({ mode: 'all' })).role).toBe('origin');
    await expect(sync.assertMayWrite(X)).resolves.toBeUndefined();
  });
});
