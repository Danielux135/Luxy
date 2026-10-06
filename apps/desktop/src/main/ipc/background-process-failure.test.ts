// el trabajo de fondo cuando el PROCESO del CLI falla (`INV-FONDO-001`), por los
// canales de verdad: el catalogo, los pendientes y el estado que lee la pantalla.
//
// Claude Code sin sesion devolvia su mensaje de error como si fuera la
// respuesta. El catalogo no miraba el final y lo contaba como «no supo», con un
// trozo de ese mensaje en el motivo; la conversacion quedaba fuera hasta
// reiniciar Studio aunque el CLI ya funcionara. Aqui el controlador devuelve el
// resultado de fallo del contrato del agente: `failed`, texto vacio y el motivo.
// Sin CLI, sin red y sin tokens. Todo el texto es INVENTADO.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { CATALOG_CLOSE, CATALOG_OPEN, relationCountersSchema } from '@luxy/shared';

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
const { AUXILIARY_BLOCK_MS, AUXILIARY_PROCESS_WAIT_MS } =
  await import('../vault/auxiliary-cooldown.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const PRIMERA = 'aaaaaaaa-1111-4111-8111-111111111111';
const SEGUNDA = 'bbbbbbbb-2222-4222-8222-222222222222';

const escenas = `${CATALOG_OPEN}\n[{"from":0,"to":1,"title":"una escena","tags":["algo"],"summary":"pasa algo"}]\n${CATALOG_CLOSE}`;

/** lo que devuelve el agente con Claude Code sin sesion, segun su contrato */
const SIN_SESION = {
  outcome: 'failed',
  // un agente nuevo lo manda vacio; si un texto llegara, NO puede usarse
  text: 'TEXTO-DEL-CLI-INVENTADO',
  error: 'MENSAJE-DEL-AGENTE-INVENTADO: ejecuta claude auth login',
  executedModel: 'opus',
  inputTokens: null,
  outputTokens: null,
  durationMs: 10,
  failureReason: 'auth',
} as const;

interface Huella {
  /** cada llamada al CLI, con su proveedor */
  llamadas: string[];
  /** true: contesta como Claude Code sin sesion */
  roto: { valor: boolean };
  /**
   * la conversacion cuyo proceso falla SIEMPRE por su cuenta —un `api_error` de
   * su prompt— mientras el CLI contesta a las demas; `null`, ninguna
   */
  fallaSola: { valor: string | null };
  guardadas: string[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  /** con que modelo se lanzo cada llamada, en el mismo orden que `llamadas` */
  modelos: (string | null)[];
}

interface Montaje {
  /**
   * quien hace el trabajo de fondo; `null` es «Automatico». Por defecto Claude,
   * como lo tiene Daniel
   */
  preferencia?: { provider: 'claude' | 'codex'; model: string | null } | null;
  /** un modelo que el CLI instalado no soporta: todo lo que va con el falla */
  modeloRoto?: string;
}

/** lo que devuelve el agente cuando el CLI marca como error el prompt de UNA */
const FALLO_PROPIO = {
  ...SIN_SESION,
  error: 'MENSAJE-DEL-AGENTE-INVENTADO: no pudo terminar',
  failureReason: 'api_error',
} as const;

function montar(opciones: Montaje = {}): Huella {
  const huella: Huella = {
    llamadas: [],
    roto: { valor: true },
    fallaSola: { valor: null },
    guardadas: [],
    registros: [],
    modelos: [],
  };
  const preferencia =
    opciones.preferencia === undefined
      ? { provider: 'claude' as const, model: null }
      : opciones.preferencia;
  const turnos = (conversationId: string) => [
    {
      conversationId,
      sequence: 0,
      role: 'user',
      // con su identificador, para que el CLI simulado sepa a quien contesta
      text: `hola inventado ${conversationId}`,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      conversationId,
      sequence: 1,
      role: 'assistant',
      text: 'respuesta',
      createdAt: '2026-09-01T10:01:00.000Z',
    },
  ];

  const context = {
    vault: {
      isUnlocked: () => true,
      onLock: () => () => undefined,
      beginUserWait: () => () => undefined,
      derivationCount: 42,
      status: () => ({
        configured: true,
        unlocked: true,
        methods: { password: true, recovery: true, device: false },
        autoLockMinutes: 15,
        lockingInMs: null,
      }),
    },
    accounts: {
      status: () => ({
        email: null,
        signedIn: false,
        expiresAt: null,
        openedWithRecoveryKey: false,
      }),
    },
    secretStore: { get: () => undefined },
    catalogs: {
      // lo catalogado queda al dia: con los dos turnos que tiene
      list: async () =>
        huella.guardadas.map((conversationId) => ({ conversationId, turnsAtCatalog: 2 })),
      replaceForConversation: async (_vault: unknown, conversationId: string) => {
        huella.guardadas.push(conversationId);
      },
    },
    privateConversations: {
      list: async () =>
        [PRIMERA, SEGUNDA].map((conversationId) => ({
          conversationId,
          title: '',
          turns: 2,
          updatedAt: '',
          characterId: null,
        })),
      read: async (_vault: unknown, conversationId: string) => turnos(conversationId),
    },
    relations: {
      read: async () => ({
        notes: [],
        cursors: [],
        counters: relationCountersSchema.parse({}),
        droppedOnRead: 0,
        unreadable: { notes: [], cursors: [] },
      }),
      apply: async () => undefined,
    },
    memoryPreferences: {
      // Claude elegido en «Quien hace el trabajo de fondo», como Daniel
      auxiliary: () => preferencia,
      excluded: () => new Set<string>(),
    },
    privateMemory: {
      invalidate: () => undefined,
      timeline: async () => [...turnos(PRIMERA), ...turnos(SEGUNDA)],
    },
    controller: {
      runLocalTurn: async (request: { provider: string; model: string | null; prompt: string }) => {
        huella.llamadas.push(request.provider);
        huella.modelos.push(request.model);
        if (huella.roto.valor) return SIN_SESION;
        if (opciones.modeloRoto !== undefined && request.model === opciones.modeloRoto) {
          return FALLO_PROPIO;
        }
        const sola = huella.fallaSola.valor;
        if (sola !== null && request.prompt.includes(sola)) return FALLO_PROPIO;
        return {
          outcome: 'completed',
          text: escenas,
          executedModel: 'opus',
          inputTokens: null,
          outputTokens: null,
          durationMs: 10,
          error: null,
          failureReason: null,
        };
      },
    },
    log: (mensaje: string, campos?: Record<string, unknown>) => {
      huella.registros.push({ mensaje, campos });
    },
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return huella;
}

async function invocar<T>(canal: string, args: unknown): Promise<{ ok: boolean; value: T }> {
  const handler = canales.get(canal);
  if (handler === undefined) throw new Error(`el canal ${canal} no se registro`);
  return (await handler(null, args)) as { ok: boolean; value: T };
}

interface CatalogoResultado {
  cataloged: number;
  failed: { conversationId: string; reason: string; process?: boolean; blocked?: boolean }[];
  pending: number;
  waiting?: number;
  catalogedIds?: string[];
  provider?: string | null;
}

const catalogar = (retryNow = false, conversationId?: string) =>
  invocar<CatalogoResultado>(IPC_INVOKE.vaultCatalogSync, {
    provider: 'claude',
    projectAlias: 'luxy',
    retryNow,
    ...(conversationId === undefined ? {} : { conversationId }),
  });

const estado = async () =>
  (await invocar<{ auxiliaryFailures?: unknown[] }>(IPC_INVOKE.vaultStatus, {})).value;

afterEach(() => {
  vi.useRealTimers();
});

describe('el catalogo con el CLI sin sesion', () => {
  it('cuenta fallida con el mensaje de Luxy, sin texto del CLI, y no la deja fuera hasta reiniciar', async () => {
    const huella = montar();

    const { value } = await catalogar();

    expect(value.cataloged).toBe(0);
    expect(value.failed).toEqual([
      {
        conversationId: PRIMERA,
        reason: 'MENSAJE-DEL-AGENTE-INVENTADO: ejecuta claude auth login',
        process: true,
      },
    ]);
    // la segunda no se manda: con el CLI roto fallaria igual
    expect(huella.llamadas).toEqual(['claude']);
    expect(value).toMatchObject({ waiting: 1, pending: 2 });
    expect(huella.guardadas).toEqual([]);

    const linea = huella.registros.find((r) => r.mensaje === 'escenas catalogadas')?.campos;
    expect(linea).toMatchObject({
      fallidas: 1,
      enEspera: 1,
      motivoFallo: 'auth',
      proveedor: 'claude',
      derivaciones: 42,
    });
    // ni el texto que trajo ni el mensaje llegan al registro
    const volcado = JSON.stringify(huella.registros);
    expect(volcado).not.toContain('TEXTO-DEL-CLI-INVENTADO');
    expect(volcado).not.toContain('MENSAJE-DEL-AGENTE-INVENTADO');
  });

  it('mientras espera no lanza nada, y la pantalla lo sabe por el estado', async () => {
    const huella = montar();
    await catalogar();
    await catalogar();
    expect(huella.llamadas).toHaveLength(1);

    expect((await estado()).auxiliaryFailures).toEqual([
      expect.objectContaining({ provider: 'claude', reason: 'auth' }),
    ]);
    // solo enums y horas: nada de lo que dijo nadie
    expect(JSON.stringify(await estado())).not.toContain('MENSAJE-DEL-AGENTE');
  });

  it('el boton prueba una vez aunque espere', async () => {
    const huella = montar();
    await catalogar();
    const { value } = await catalogar(true);
    expect(huella.llamadas).toHaveLength(2);
    expect(value).toMatchObject({ waiting: 1 });
  });

  it('tras `claude auth login` se retoma sola al acabar la espera, sin reiniciar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'));
    const huella = montar();
    await catalogar();
    expect(huella.llamadas).toHaveLength(1);

    huella.roto.valor = false;
    vi.setSystemTime(new Date(Date.now() + AUXILIARY_PROCESS_WAIT_MS));
    const { value } = await catalogar();

    expect(value).toMatchObject({ cataloged: 2, failed: [] });
    // la que fallo no quedo marcada: entra como las demas
    expect(huella.guardadas.sort()).toEqual([PRIMERA, SEGUNDA].sort());
    // y el aviso se va solo
    expect((await estado()).auxiliaryFailures).toEqual([]);
  });
});

// undecima ronda: todo fallo del proceso se trataba como del CLI entero. Una
// conversacion cuyo prompt fallaba siempre rearmaba la espera de los cuatro
// trabajos cada vez que se la probaba, y las demas se quedaban esperando
describe('una conversacion que falla sola en el catalogo', () => {
  it('no frena a las demas ni pone al CLI en espera; repetida, se queda fuera sin rearmarla', async () => {
    const huella = montar();
    huella.roto.valor = false;
    huella.fallaSola.valor = PRIMERA;

    const primera = await catalogar();
    // la otra se cataloga en la misma tanda
    expect(primera.value).toMatchObject({
      cataloged: 1,
      catalogedIds: [SEGUNDA],
      waiting: 0,
      pending: 1,
      provider: 'claude',
    });
    expect(primera.value.failed).toEqual([
      expect.objectContaining({ conversationId: PRIMERA, process: true }),
    ]);
    expect((await estado()).auxiliaryFailures).toEqual([]);

    // vuelve a fallar con el CLI contestando a las demas: es suya. Se queda
    // fuera un par de horas —`blocked`, y sin `process`, que prometeria
    // reintentarla en minutos— y la espera de los demas trabajos no se toca
    const segunda = await catalogar();
    expect(segunda.value.failed).toEqual([
      {
        conversationId: PRIMERA,
        reason: 'MENSAJE-DEL-AGENTE-INVENTADO: no pudo terminar',
        blocked: true,
      },
    ]);
    expect(segunda.value.pending).toBe(0);
    expect((await estado()).auxiliaryFailures).toEqual([]);

    // y no se lanza en cada apertura del panel
    await catalogar();
    await catalogar();
    expect(huella.llamadas).toHaveLength(3);
    // los pendientes siguen sin espera
    await invocar(IPC_INVOKE.vaultRelationSync, { projectAlias: 'luxy' });
    expect(huella.llamadas.length).toBeGreaterThan(3);

    const lineas = huella.registros.filter((r) => r.mensaje === 'escenas catalogadas');
    expect(lineas.map((r) => r.campos?.atribucion)).toEqual(['conversation', 'blocked', null, null]);
    expect(JSON.stringify(huella.registros)).not.toContain('MENSAJE-DEL-AGENTE-INVENTADO');

    // pedida a mano, se prueba; si vuelve a fallar sigue fuera, y el resultado
    // no promete que se reintente en minutos: la pasada sola la seguiria
    // saltando, y la pantalla la retomaria para nada
    const llamadasAntes = huella.llamadas.length;
    const boton = await catalogar(true, PRIMERA);
    expect(huella.llamadas).toHaveLength(llamadasAntes + 1);
    expect(boton.value.failed).toEqual([
      {
        conversationId: PRIMERA,
        reason: 'MENSAJE-DEL-AGENTE-INVENTADO: no pudo terminar',
        blocked: true,
      },
    ]);
    expect((await estado()).auxiliaryFailures).toEqual([]);
  });

  it('la que es suya se vuelve a probar sola pasadas dos horas, no al reiniciar', async () => {
    // decimotercera ronda: se quedaba fuera la sesion entera, y un fallo del CLI
    // mal reconocido la dejaba sin ordenar aunque el CLI se recuperase
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'));
    const huella = montar();
    huella.roto.valor = false;
    huella.fallaSola.valor = PRIMERA;
    await catalogar();
    await catalogar();
    await catalogar();
    expect(huella.llamadas).toHaveLength(3);

    // ya no falla; pasadas las dos horas, abrir el panel la vuelve a coger
    huella.fallaSola.valor = null;
    vi.setSystemTime(new Date(Date.now() + AUXILIARY_BLOCK_MS));
    const { value } = await catalogar();
    expect(huella.llamadas).toHaveLength(4);
    expect(value).toMatchObject({ cataloged: 1, catalogedIds: [PRIMERA], failed: [] });
  });

  it('un repaso a mano de una ya ordenada no promete reintentarse solo', async () => {
    // «Repasar sus momentos» en una ya catalogada: la pasada sola no la vuelve a
    // coger, asi que si su proceso falla nadie la reintenta. Con `process`, la
    // pantalla decia «se vuelven a intentar solas» (decimotercera ronda)
    const huella = montar();
    huella.roto.valor = false;
    await catalogar();
    expect(huella.guardadas.sort()).toEqual([PRIMERA, SEGUNDA].sort());

    huella.fallaSola.valor = PRIMERA;
    const { value } = await catalogar(true, PRIMERA);
    expect(value.failed).toEqual([
      { conversationId: PRIMERA, reason: 'MENSAJE-DEL-AGENTE-INVENTADO: no pudo terminar' },
    ]);
  });

  it('pedida una sola, «quedan» sigue siendo la cola entera', async () => {
    const huella = montar();
    huella.roto.valor = false;
    // «Repasar sus momentos» en una: antes contestaba «quedan 0» con la otra
    // sin ordenar, y la pantalla lo enseñaba como si fuera de todas
    const { value } = await catalogar(true, PRIMERA);
    expect(value).toMatchObject({ cataloged: 1, catalogedIds: [PRIMERA], pending: 1 });
  });
});

describe('una espera para los cuatro trabajos', () => {
  it('lo que fallo en el catalogo frena tambien los pendientes; su boton prueba una vez', async () => {
    const huella = montar();
    await catalogar();
    expect(huella.llamadas).toHaveLength(1);

    // la pasada sola (la de cada turno o la de abrir el panel) no lo lanza
    const sola = await invocar<{ waiting?: number; refused: number }>(
      IPC_INVOKE.vaultRelationSync,
      {
        projectAlias: 'luxy',
      },
    );
    expect(huella.llamadas).toHaveLength(1);
    expect(sola.value).toMatchObject({ refused: 0, waiting: 2 });

    // «Buscar lo pendiente en lo ya hablado» si, una vez
    const boton = await invocar<{ refused: number; failed: unknown[] }>(
      IPC_INVOKE.vaultRelationSync,
      { projectAlias: 'luxy', force: true },
    );
    expect(huella.llamadas).toHaveLength(2);
    // y su fallo no es una negativa
    expect(boton.value.refused).toBe(0);
    expect(boton.value.failed).toHaveLength(1);
  });
});

// duodecima ronda: la espera iba solo por CLI. Con «Automatico», el catalogo
// lanza el modelo de la ventana y los pendientes el CLI a secas, asi que un
// modelo que el CLI instalado no soporta paraba tambien a los pendientes
describe('la espera es de lo que se lanza, con su modelo', () => {
  const MODELO_ROTO = 'modelo-inventado-a';

  it('un modelo de la ventana que el CLI no soporta no frena a los pendientes', async () => {
    const huella = montar({ preferencia: null, modeloRoto: MODELO_ROTO });
    huella.roto.valor = false;

    const catalogo = await invocar<CatalogoResultado & { model?: string | null }>(
      IPC_INVOKE.vaultCatalogSync,
      { provider: 'codex', model: MODELO_ROTO, projectAlias: 'luxy' },
    );
    // fallan las dos con ESE modelo: es del CLI con ese modelo, y espera
    expect(catalogo.value.failed).toHaveLength(2);
    expect(catalogo.value).toMatchObject({ provider: 'codex', model: MODELO_ROTO });
    expect((await estado()).auxiliaryFailures).toEqual([
      expect.objectContaining({ provider: 'codex', model: MODELO_ROTO, wholeProvider: false }),
    ]);
    // la retoma del catalogo con ese modelo si espera
    await invocar(IPC_INVOKE.vaultCatalogSync, {
      provider: 'codex',
      model: MODELO_ROTO,
      projectAlias: 'luxy',
    });
    expect(huella.llamadas).toHaveLength(2);

    // los pendientes van con Codex a secas: no esperan
    const sola = await invocar<{ waiting?: number }>(IPC_INVOKE.vaultRelationSync, {
      projectAlias: 'luxy',
    });
    expect(sola.value.waiting ?? 0).toBe(0);
    expect(huella.llamadas).toEqual(['codex', 'codex', 'codex', 'codex']);
    expect(huella.modelos).toEqual([MODELO_ROTO, MODELO_ROTO, null, null]);
  });
});
