// el enganche de la memoria retroactiva, visto desde el IPC.
//
// El nucleo puro, el almacen y la pasada ya tienen sus pruebas. Lo que solo
// puede romperse AQUI es la costura: que la lectura del turno vivo pase por
// `chooseConversationMemory`, que el origen y los huecos lleguen al prompt, que
// la sellada siga ganando, que el panel lea lo mismo que decide el turno, y
// sobre todo lo que no puede fallar nunca: que un fallo del trabajo de fondo no
// cueste un turno de Daniel (`D-088`) y que ni una palabra de la boveda acabe en
// el registro.
//
// Ni un CLI de verdad, ni red, ni tokens: todo lo que se lee esta escrito aqui.
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  RECAP_CLOSE,
  RECAP_OPEN,
  RECAP_VERSION,
  recapCountersSchema,
  recapEntrySchema,
  type ConversationMemory,
  type RecapEntry,
} from '@luxy/shared';
// solo el tipo: el modulo de verdad se carga abajo, despues de simular electron
import type { vaultRecapListResultSchema } from '../../shared/ipc.js';

type RecapList = z.infer<typeof vaultRecapListResultSchema>;

/** canales registrados por `registerIpcHandlers`, para poder invocarlos */
const canales = vi.hoisted(
  () => new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
);

// electron no existe fuera de electron: solo hace falta lo que se toca al
// REGISTRAR, que es el registro de canales
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
const { tokenize } = await import('../vault/turn-index.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];
type RecapMutator = Parameters<HandlerContext['recaps']['apply']>[1];

const CONV = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTRA = 'bbbbbbbb-2222-4222-8222-222222222222';
const LIA = 'c0000000-3333-4333-8333-333333333333';

/** doce turnos alternos, el ultimo del personaje: la ventana entera cabe */
const TURNOS = 12;
const BASE = Date.UTC(2026, 8, 1, 20, 0, 0);

function instante(sequence: number): string {
  return new Date(BASE + sequence * 60_000).toISOString();
}

/** la ficha del relleno: concreta, para que no la marque el detector de vaguedad */
const RESUMEN_RECAP =
  'Ella y el llevan tres noches escribiendose desde dos ciudades y quedaron en verse el sabado en la estacion, a las siete.';
/** la ficha que ya estaba sellada dentro del `.jsonl` */
const RESUMEN_SELLADO =
  'Lo que ella recordaba por su cuenta de aquella noche, escrito por el modelo que la vivio.';

function ficha(summary: string): ConversationMemory {
  return {
    version: 1,
    summary,
    facts: ['Empezo: se conocieron una noche de agosto en el tren de las siete'],
    decisions: ['Quedaron en que ella escribe primero por las mañanas'],
    plan: [],
    openQuestions: [],
    lessons: [],
  };
}

interface Entrada {
  memory?: ConversationMemory | null;
  source?: 'cli' | 'index';
  approved?: boolean;
  to?: number;
  gaps?: RecapEntry['gaps'];
  version?: number;
  supersededAt?: string | null;
  conversationId?: string;
}

function entrada(over: Entrada = {}): RecapEntry {
  const to = over.to ?? TURNOS - 1;
  return recapEntrySchema.parse({
    conversationId: over.conversationId ?? CONV,
    memory: over.memory === undefined ? ficha(RESUMEN_RECAP) : over.memory,
    source: over.source ?? 'cli',
    covered: { from: 0, to },
    // la fecha del turno al que dice llegar: sin esto no pasa la invariante de
    // cobertura y la ficha no se usa, que es justo lo que hay que poder probar
    coveredAt: instante(to),
    gaps: over.gaps ?? [],
    turnsAtRecap: TURNOS,
    version: over.version ?? RECAP_VERSION,
    provider: 'codex',
    model: null,
    at: instante(TURNOS - 1),
    chars: 420,
    approved: over.approved ?? true,
    supersededAt: over.supersededAt ?? null,
  });
}

interface TurnoFalso {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

function historial(conversationId: string, cuantos = TURNOS): TurnoFalso[] {
  return Array.from({ length: cuantos }, (_unused, index) => ({
    conversationId,
    sequence: index,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text: `turno numero ${index} de aquella noche`,
    createdAt: instante(index),
  }));
}

/** el almacen, en memoria, validando lo que se escribe igual que el de disco */
class FakeRecaps {
  entries: RecapEntry[];
  writes = 0;

  constructor(entries: readonly RecapEntry[]) {
    this.entries = [...entries];
  }

  async read(): Promise<{
    entries: RecapEntry[];
    counters: z.infer<typeof recapCountersSchema>;
    droppedOnRead: number;
    unreadable: { entries: readonly unknown[] };
  }> {
    return {
      entries: [...this.entries],
      counters: recapCountersSchema.parse({}),
      droppedOnRead: 0,
      unreadable: { entries: [] },
    };
  }

  async entryFor(_vault: unknown, conversationId: string): Promise<RecapEntry | undefined> {
    let found: RecapEntry | undefined;
    for (const entry of this.entries) {
      if (entry.conversationId === conversationId) found = entry;
    }
    return found;
  }

  async apply(
    _vault: unknown,
    mutator: RecapMutator,
  ): Promise<{ entries: RecapEntry[]; counters: z.infer<typeof recapCountersSchema> }> {
    const next = await mutator(await this.read());
    this.entries = z.array(recapEntrySchema).parse(next.entries);
    this.writes += 1;
    return { entries: this.entries, counters: recapCountersSchema.parse(next.counters) };
  }

  async markSuperseded(_vault: unknown, conversationId: string, at: string): Promise<void> {
    this.entries = this.entries.map((entry) =>
      entry.conversationId === conversationId && entry.supersededAt === null
        ? { ...entry, supersededAt: at }
        : entry,
    );
    this.writes += 1;
  }

  async removeConversation(_vault: unknown, conversationId: string): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.conversationId !== conversationId);
    this.writes += 1;
  }
}

interface Huella {
  /** cada prompt que se le mando a un proveedor, en orden */
  prompts: string[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  campos: (mensaje: string) => Record<string, unknown> | undefined;
  recaps: FakeRecaps;
}

interface Montaje {
  entries?: RecapEntry[];
  /** lo que lanza el almacen al leerlo: el caso que no puede costar un turno */
  entryFalla?: Error;
  /** la memoria sellada de la conversacion, si la hay */
  sellada?: ConversationMemory | null;
  /** lo que contesta el CLI de fondo cuando la pasada le pide una ficha */
  respuestaCli?: string;
  /** conversaciones fuera del trabajo de fondo */
  excluidas?: string[];
  /**
   * conversaciones que el indice episodico NO publica.
   *
   * Es lo que hace de verdad: `PrivateMemory.build` se salta las excluidas, y
   * una construccion abortada a medias devuelve la linea temporal vacia. El
   * panel media con eso y el turno con el historial de verdad.
   */
  indiceCiego?: string[];
}

function montar(montaje: Montaje = {}): Huella {
  const huella: Huella = {
    prompts: [],
    registros: [],
    campos: (mensaje) => huella.registros.find((r) => r.mensaje === mensaje)?.campos,
    recaps: new FakeRecaps(montaje.entries ?? []),
  };

  const turnos = [...historial(CONV), ...historial(OTRA, 2)];
  if (montaje.entryFalla !== undefined) {
    huella.recaps.entryFor = async (): Promise<RecapEntry | undefined> => {
      throw montaje.entryFalla;
    };
  }

  const context = {
    vault: { isUnlocked: () => true, onLock: () => () => undefined },
    privateConversations: {
      list: async () => [
        {
          conversationId: CONV,
          title: 'aquella noche de agosto',
          turns: turnos.filter((turno) => turno.conversationId === CONV).length,
          updatedAt: instante(TURNOS - 1),
          characterId: LIA,
        },
        {
          conversationId: OTRA,
          title: 'la otra',
          turns: 2,
          updatedAt: instante(1),
          characterId: LIA,
        },
      ],
      read: async (_vault: unknown, conversationId: string) =>
        turnos.filter((turno) => turno.conversationId === conversationId),
      appendTurn: async (
        _vault: unknown,
        conversationId: string,
        turno: { role: 'user' | 'assistant'; text: string },
      ) => {
        const propios = turnos.filter((each) => each.conversationId === conversationId);
        turnos.push({
          conversationId,
          sequence: propios.length,
          role: turno.role,
          text: turno.text,
          createdAt: new Date().toISOString(),
        });
      },
      removeLastTurn: () => turnos.pop(),
      latestMemory: async (_vault: unknown, conversationId: string) =>
        conversationId === CONV ? (montaje.sellada ?? null) : null,
      latestInstructions: async () => null,
      latestCharacterId: async () => LIA,
      latestCharacterDescription: async () => 'Lia, veinticuatro años',
      latestProvider: async () => null,
      latestModel: async () => null,
    },
    characters: { list: async () => [] },
    privateMedia: { list: async () => [] },
    secretStore: { get: () => undefined },
    catalogs: { list: async () => [], removeConversation: async () => undefined },
    recaps: huella.recaps,
    relations: {
      read: async () => ({
        notes: [],
        cursors: [],
        counters: {},
        droppedOnRead: 0,
        unreadable: { notes: [], cursors: [] },
      }),
      apply: async () => undefined,
      removeConversation: async () => undefined,
    },
    privateMemory: {
      invalidate: () => undefined,
      search: async () => [],
      listEpisodes: async () => [],
      readEpisode: async () => [],
      timeline: async () =>
        turnos
          .filter((turno) => !(montaje.indiceCiego ?? []).includes(turno.conversationId))
          .map((turno) => ({
            conversationId: turno.conversationId,
            sequence: turno.sequence,
            role: turno.role,
            createdAt: turno.createdAt,
            stems: new Set(tokenize(turno.text)),
          })),
      conversationsFor: () => new Set([CONV, OTRA]),
      turnAt: () => null,
    },
    memoryPreferences: {
      auxiliary: () => null,
      excluded: () => new Set(montaje.excluidas ?? [CONV, OTRA]),
    },
    controller: {
      runLocalTurn: async (request: { prompt: string }) => {
        huella.prompts.push(request.prompt);
        return {
          outcome: 'completed',
          text: montaje.respuestaCli ?? '*se estira* buenas noches',
          executedModel: 'deepseek-chat',
          inputTokens: 10,
          outputTokens: 20,
          durationMs: 1234,
          error: null,
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

type Respuesta =
  | { ok: true; value: { outcome: string; userTurnKept: boolean } }
  | { ok: false; error: string };

async function invocar(channel: string, args: unknown): Promise<unknown> {
  const handler = canales.get(channel);
  if (handler === undefined) throw new Error(`el canal ${channel} no se registro`);
  return handler(null, args);
}

async function enviar(mensaje: string): Promise<Respuesta> {
  return (await invocar(IPC_INVOKE.vaultConversationSend, {
    conversationId: CONV,
    message: mensaje,
    provider: 'deepseek',
    model: 'deepseek-chat',
    projectAlias: 'luxy',
  })) as Respuesta;
}

/**
 * el ULTIMO prompt que salio hacia un proveedor.
 *
 * El ultimo y no el primero porque el CLI de fondo y el turno de pago comparten
 * el mismo controlador falso: en una prueba que dispara la pasada antes de
 * enviar, el primero es el de la ficha y el que interesa es el del turno.
 */
function promptDelTurno(huella: Huella): string {
  return huella.prompts[huella.prompts.length - 1] ?? '';
}

const AVISO_SIN_MEMORIA = 'todavia no hay memoria acumulativa';
const AVISO_CON_HUECOS = 'lo que tienes anotado arriba no los cubre enteros';

describe('la memoria retroactiva dentro del turno privado', () => {
  it('una ficha aprobada que llega hasta la cola literal viaja en el prompt', async () => {
    const huella = montar({ entries: [entrada()] });

    expect((await enviar('sigues despierto?')).ok).toBe(true);

    const prompt = promptDelTurno(huella);
    expect(prompt).toContain('MEMORIA ACUMULATIVA DE ESTA CONVERSACION');
    expect(prompt).toContain(RESUMEN_RECAP);
    // cubre lo omitido entera, asi que el aviso sobra: repetirlo le daria
    // permiso para ignorar los dos
    expect(prompt).not.toContain(AVISO_SIN_MEMORIA);
    expect(prompt).not.toContain(AVISO_CON_HUECOS);
    // y la regla contra la invencion va SIEMPRE, tambien aqui
    expect(prompt).toContain('De aqui sabes SOLO lo que pone.');
  });

  it('LA SELLADA GANA SIEMPRE, aunque haya una ficha aprobada al lado', async () => {
    // dos memorias escritas por modelos distintos y sin criterio de desempate
    // serian un modo de fallo nuevo a cambio de nada
    const huella = montar({ entries: [entrada()], sellada: ficha(RESUMEN_SELLADO) });

    expect((await enviar('sigues despierto?')).ok).toBe(true);

    const prompt = promptDelTurno(huella);
    expect(prompt).toContain(RESUMEN_SELLADO);
    expect(prompt).not.toContain(RESUMEN_RECAP);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      memoriaOrigen: 'turn',
      memoriaHuecos: 0,
    });
  });

  it('una ficha con tramos sin resumir conserva el aviso de turnos omitidos', async () => {
    const huella = montar({
      entries: [entrada({ gaps: [{ from: 2, to: 5, why: 'explicito' }] })],
    });

    expect((await enviar('sigues despierto?')).ok).toBe(true);

    const prompt = promptDelTurno(huella);
    expect(prompt).toContain('MEMORIA ACUMULATIVA DE ESTA CONVERSACION');
    expect(prompt).toContain('hay 1 tramo que no se pudo resumir');
    // un resumen con agujeros leido como completo se rellena solo, asi que el
    // aviso se queda: es la orden de preguntar en vez de suponer
    expect(prompt).toContain(AVISO_CON_HUECOS);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      memoriaOrigen: 'recap',
      memoriaHuecos: 1,
    });
  });

  it('un indice deducido se presenta COMO INDICE y conserva el aviso', async () => {
    const huella = montar({ entries: [entrada({ source: 'index', approved: false })] });

    expect((await enviar('sigues despierto?')).ok).toBe(true);

    const prompt = promptDelTurno(huella);
    // llamar «memoria» a un indice hace que de por sabido lo que solo esta
    // enunciado
    expect(prompt).toContain('INDICE DE ESTA CONVERSACION (no es un resumen de lo que se dijo)');
    expect(prompt).toContain('No supongas el contenido a partir del titulo.');
    expect(prompt).toContain(AVISO_CON_HUECOS);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({ memoriaOrigen: 'index' });
  });

  it('una ficha SIN APROBAR no entra en ningun prompt', async () => {
    const huella = montar({ entries: [entrada({ approved: false })] });

    expect((await enviar('sigues despierto?')).ok).toBe(true);

    const prompt = promptDelTurno(huella);
    expect(prompt).not.toContain(RESUMEN_RECAP);
    expect(prompt).not.toContain('MEMORIA ACUMULATIVA DE ESTA CONVERSACION');
    // el estado seguro es el de hoy: sin memoria y con su aviso
    expect(prompt).toContain(AVISO_SIN_MEMORIA);
  });

  it('una ficha que no llega hasta la cola literal tampoco entra', async () => {
    // hay un tramo que NADIE ha declarado: no es un hueco dicho, es que la
    // pasada no ha terminado. Antes el aviso de siempre que media memoria
    const huella = montar({ entries: [entrada({ to: 2 })] });

    expect((await enviar('sigues despierto?')).ok).toBe(true);

    const prompt = promptDelTurno(huella);
    expect(prompt).not.toContain(RESUMEN_RECAP);
    expect(prompt).toContain(AVISO_SIN_MEMORIA);
  });

  it('una ficha de otra version del relleno no se usa', async () => {
    const huella = montar({ entries: [entrada({ version: RECAP_VERSION + 1 })] });

    expect((await enviar('sigues despierto?')).ok).toBe(true);
    expect(promptDelTurno(huella)).not.toContain(RESUMEN_RECAP);
  });

  it('SI EL ALMACEN REVIENTA, el turno sale igual y con la memoria de siempre', async () => {
    // un fallo del trabajo de fondo NUNCA puede costar un turno de Daniel
    // (`D-088`): el enganche va dentro de un `try` y lo que queda es el
    // comportamiento de antes de que esto existiera
    const huella = montar({
      entryFalla: new Error('el archivo de la memoria retroactiva no se puede descifrar'),
      sellada: ficha(RESUMEN_SELLADO),
    });

    const respuesta = await enviar('sigues despierto?');
    expect(respuesta.ok).toBe(true);
    expect(respuesta.ok && respuesta.value.userTurnKept).toBe(true);
    expect(promptDelTurno(huella)).toContain(RESUMEN_SELLADO);
  });

  it('y sin memoria sellada tambien SALE, sin bloque y con su aviso', async () => {
    const huella = montar({
      entryFalla: new Error('el archivo de la memoria retroactiva no se puede descifrar'),
    });

    expect((await enviar('sigues despierto?')).ok).toBe(true);
    const prompt = promptDelTurno(huella);
    expect(prompt).toContain(AVISO_SIN_MEMORIA);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({ memoriaOrigen: 'ninguna' });
  });

  it('el registro lleva el ORIGEN y ni una palabra de la ficha', async () => {
    const huella = montar({ entries: [entrada()] });

    expect((await enviar('sigues despierto?')).ok).toBe(true);

    const volcado = JSON.stringify(huella.registros);
    expect(volcado).not.toContain(RESUMEN_RECAP);
    expect(volcado).not.toContain('estacion');
    expect(volcado).toContain('memoriaOrigen');
  });

  it('la sonda de compatibilidad mide sobre el MISMO prompt que el turno', async () => {
    // si midiera sobre un prompt sin el bloque de memoria estaria midiendo otra
    // cosa: lo que se quiere saber es si ese modelo acepta LO SUYO
    const huella = montar({ entries: [entrada()] });

    const resultado = (await invocar(IPC_INVOKE.vaultCompatibility, {
      conversationId: CONV,
      projectAlias: 'luxy',
      targets: [{ provider: 'claude', model: null, effort: null }],
      repetitions: 1,
    })) as { ok: boolean };

    expect(resultado.ok).toBe(true);
    expect(promptDelTurno(huella)).toContain(RESUMEN_RECAP);
  });
});

describe('el panel de la memoria de lo ya hablado', () => {
  async function listar(): Promise<{ ok: boolean; value: RecapList }> {
    return (await invocar(IPC_INVOKE.vaultRecapList, {})) as { ok: boolean; value: RecapList };
  }

  it('la linea de cobertura SUMA, y la fila dice si hoy viajaria de verdad', async () => {
    // sin excluidas: lo que se mide aqui es la cobertura, y una conversacion
    // excluida no cuenta en ninguno de los cinco cajones
    montar({ entries: [entrada()], excluidas: [] });

    const { ok, value } = await listar();
    expect(ok).toBe(true);

    const { coverage } = value;
    // `summarized + withGaps + indexOnly + awaitingApproval + missing + sealed
    //  === total - excluded`
    expect(
      coverage.summarized +
        coverage.withGaps +
        coverage.indexOnly +
        coverage.awaitingApproval +
        coverage.missing +
        coverage.sealed,
    ).toBe(coverage.total - coverage.excluded);
    expect(coverage.total).toBe(2);
    expect(coverage.summarized).toBe(1);
    expect(coverage.missing).toBe(1);

    // una fila por CONVERSACION rellenable, no por entrada del almacen: la que
    // todavia no se ha leido sale igual, vacia
    expect(value.rows).toHaveLength(2);
    const fila = value.rows.find((each) => each.conversationId === CONV)!;
    expect(fila.title).toBe('aquella noche de agosto');
    expect(fila.inPrompt).toBe(true);
    expect(fila.hasEntry).toBe(true);
    // «cubre 12 de 12»: turnos de verdad dentro del tramo, no `to - from`
    expect(fila.covered).toBe(TURNOS);
    expect(fila.turns).toBe(TURNOS);
    expect(fila.block).toContain(RESUMEN_RECAP);
  });

  it('LA QUE NI SE PUDO LEER tiene fila, que es desde donde se reintenta', async () => {
    // sin fila no hay boton, y el aviso de la pantalla mandaba pulsar
    // «Rehacerlo» en una conversacion que no salia por ningun lado: la pasada
    // que falla antes de la primera ventana no escribe entrada ninguna
    montar({ entries: [], excluidas: [] });

    const { value } = await listar();

    const fila = value.rows.find((each) => each.conversationId === OTRA)!;
    expect(fila).toBeDefined();
    expect(fila.hasEntry).toBe(false);
    expect(fila.block).toBe('');
    expect(fila.inPrompt).toBe(false);
    expect(fila.approved).toBe(false);
    expect(fila.turns).toBe(2);
  });

  it('la EXCLUIDA se mide con su historial, no con el indice que la omite', async () => {
    // el indice episodico se salta las excluidas, y el turno no consulta las
    // exclusiones: la ficha SI viaja en su propio hilo. Midiendo con el indice,
    // el panel decia «cubre 0 de 12» y «todavia no llega hasta los ultimos
    // turnos» de algo que estaba entrando en cada prompt
    montar({ entries: [entrada()], excluidas: [CONV], indiceCiego: [CONV] });

    const { value } = await listar();

    const fila = value.rows.find((each) => each.conversationId === CONV)!;
    expect(fila).toBeDefined();
    expect(fila.excluded).toBe(true);
    expect(fila.inPrompt).toBe(true);
    expect(fila.covered).toBe(TURNOS);
  });

  it('y una tanda del indice que se queda a medias no convierte lo bueno en «sin nada»', async () => {
    // `invalidate()` en mitad de una construccion deja la linea temporal vacia
    // para quien la estaba esperando. Con ella, TODAS las filas se pintaban
    // fuera del prompt justo despues de una pasada correcta
    montar({ entries: [entrada()], excluidas: [], indiceCiego: [CONV, OTRA] });

    const { value } = await listar();

    const fila = value.rows.find((each) => each.conversationId === CONV)!;
    expect(fila.inPrompt).toBe(true);
    expect(fila.covered).toBe(TURNOS);
    expect(value.coverage.summarized).toBe(1);
  });

  it('una ficha sin aprobar sale en la lista pero NO como algo que viaje', async () => {
    montar({ entries: [entrada({ approved: false })], excluidas: [] });

    const { value } = await listar();
    const fila = value.rows.find((each) => each.conversationId === CONV)!;
    expect(fila.approved).toBe(false);
    expect(fila.inPrompt).toBe(false);
    // y no cuenta como cobertura: el panel no puede decir «resumida» de algo
    // que el turno esta descartando
    expect(value.coverage.summarized).toBe(0);
    // pero TAMPOCO como «sin nada»: esta escrita y solo espera que la lea. Con
    // los dos estados en el mismo cajon, la linea decia «17 sin leer» justo
    // despues de la pasada que escribio las diecisiete
    expect(value.coverage.awaitingApproval).toBe(1);
    expect(value.coverage.missing).toBe(1);
  });

  it('la que ya tiene memoria propia cuenta como sellada, no como resumida', async () => {
    montar({ entries: [entrada()], sellada: ficha(RESUMEN_SELLADO), excluidas: [] });

    const { value } = await listar();
    expect(value.coverage.sealed).toBe(1);
    expect(value.coverage.summarized).toBe(0);
    expect(value.rows[0]!.inPrompt).toBe(false);
  });

  it('aprobar deja entrar esa ficha, y solo esa', async () => {
    const huella = montar({
      entries: [
        entrada({ approved: false }),
        entrada({ conversationId: OTRA, approved: false, to: 1 }),
      ],
    });

    const resultado = (await invocar(IPC_INVOKE.vaultRecapUpdate, {
      action: 'approve',
      conversationId: CONV,
    })) as { ok: boolean };
    expect(resultado.ok).toBe(true);

    expect(huella.recaps.entries.find((e) => e.conversationId === CONV)?.approved).toBe(true);
    expect(huella.recaps.entries.find((e) => e.conversationId === OTRA)?.approved).toBe(false);
    // y en el registro va una cifra, no de que conversacion
    const campos = huella.campos('memoria de lo ya hablado corregida');
    expect(campos).toEqual({ accion: 'aprobar', fichas: 1 });
    expect(JSON.stringify(campos)).not.toContain(CONV);
  });

  it('aprobar todas aprueba las que son fichas y deja fuera lo que no lo es', async () => {
    const huella = montar({
      entries: [
        entrada({ approved: false }),
        // una negativa no es una ficha: aprobarla dejaria en disco un
        // `approved` que no significa nada
        entrada({ conversationId: OTRA, memory: null, approved: false }),
      ],
    });

    expect(
      ((await invocar(IPC_INVOKE.vaultRecapUpdate, { action: 'approve-all' })) as { ok: boolean })
        .ok,
    ).toBe(true);

    expect(huella.recaps.entries.find((e) => e.conversationId === CONV)?.approved).toBe(true);
    expect(huella.recaps.entries.find((e) => e.conversationId === OTRA)?.approved).toBe(false);
    expect(huella.campos('memoria de lo ya hablado corregida')).toEqual({
      accion: 'aprobar-todas',
      fichas: 1,
    });
  });

  it('olvidarla la quita y devuelve esa conversacion a su aviso', async () => {
    const huella = montar({ entries: [entrada()] });

    expect(
      (
        (await invocar(IPC_INVOKE.vaultRecapUpdate, {
          action: 'forget',
          conversationId: CONV,
        })) as { ok: boolean }
      ).ok,
    ).toBe(true);

    expect(huella.recaps.entries).toHaveLength(0);
    // y desde ese momento el turno vuelve a ir sin memoria, que es el estado
    // seguro: conserva el aviso de turnos omitidos
    expect((await enviar('sigues despierto?')).ok).toBe(true);
    expect(promptDelTurno(huella)).toContain(AVISO_SIN_MEMORIA);
  });

  it('olvidar una ficha que ya no esta avisa en vez de callarse', async () => {
    montar({ entries: [] });

    const resultado = (await invocar(IPC_INVOKE.vaultRecapUpdate, {
      action: 'forget',
      conversationId: CONV,
    })) as { ok: boolean };
    expect(resultado.ok).toBe(false);
  });
});

describe('la pasada, disparada desde su canal', () => {
  /** lo que el CLI de fondo devuelve: una ficha valida para los doce turnos */
  const RESPUESTA_CLI = `${RECAP_OPEN}${JSON.stringify({
    version: 1,
    summary: RESUMEN_RECAP,
    facts: ['Empezo: se conocieron una noche de agosto en el tren de las siete'],
    decisions: ['Quedaron en que ella escribe primero por las mañanas'],
    plan: [],
    openQuestions: [],
    lessons: [],
    covered: { from: 0, to: TURNOS - 1 },
    skipped: [],
  })}${RECAP_CLOSE}`;

  it('escribe la ficha, y NO la deja aprobada: hasta que Daniel no la lee, no viaja', async () => {
    const huella = montar({ respuestaCli: RESPUESTA_CLI, excluidas: [OTRA] });

    const resultado = (await invocar(IPC_INVOKE.vaultRecapSync, {
      projectAlias: 'luxy',
      conversationId: CONV,
    })) as { ok: boolean; value: { reviewed: number; ok: number; provider: string } };

    expect(resultado.ok).toBe(true);
    expect(resultado.value.reviewed).toBe(1);
    expect(resultado.value.ok).toBe(1);
    // el trabajo de fondo va SIEMPRE a un CLI local con la sesion abierta
    expect(['claude', 'codex']).toContain(resultado.value.provider);

    const escrita = huella.recaps.entries[0];
    expect(escrita?.conversationId).toBe(CONV);
    expect(escrita?.approved).toBe(false);
    expect(escrita?.memory?.summary).toContain('estacion');

    // y mientras no se apruebe, el turno sigue yendo sin bloque de memoria
    expect((await enviar('sigues despierto?')).ok).toBe(true);
    expect(promptDelTurno(huella)).toContain(AVISO_SIN_MEMORIA);
  });

  it('la tanda deja CIFRAS en el registro, sin la conversacion ni la ficha', async () => {
    const huella = montar({ respuestaCli: RESPUESTA_CLI, excluidas: [OTRA] });

    await invocar(IPC_INVOKE.vaultRecapSync, { projectAlias: 'luxy', conversationId: CONV });

    const campos = huella.campos('memoria de lo ya hablado');
    expect(campos).toMatchObject({ conversaciones: 1, ventanas: 1, resumidas: 1 });
    const volcado = JSON.stringify(campos);
    expect(volcado).not.toContain(CONV);
    expect(volcado).not.toContain(RESUMEN_RECAP);
    expect(volcado).not.toContain('estacion');
  });

  it('`dryRun` corre la pasada y no escribe nada', async () => {
    const huella = montar({ respuestaCli: RESPUESTA_CLI, excluidas: [OTRA] });

    const resultado = (await invocar(IPC_INVOKE.vaultRecapSync, {
      projectAlias: 'luxy',
      conversationId: CONV,
      dryRun: true,
    })) as { ok: boolean; value: { preview: { block: string }[] } };

    expect(resultado.ok).toBe(true);
    expect(resultado.value.preview[0]?.block).toContain(RESUMEN_RECAP);
    expect(huella.recaps.writes).toBe(0);
    expect(huella.recaps.entries).toHaveLength(0);
  });

  it('pedir UNA conversacion no la empieza desde cero: eso lo pide `force`', async () => {
    // el cursor de la ficha que ya hay llega al ultimo turno, asi que sin
    // `force` no queda nada por leer y no se gasta ni una llamada. Deducir
    // `force` de que venga una conversacion tiraria el trabajo ya hecho
    const huella = montar({
      entries: [entrada()],
      respuestaCli: RESPUESTA_CLI,
      excluidas: [OTRA],
    });

    const resultado = (await invocar(IPC_INVOKE.vaultRecapSync, {
      projectAlias: 'luxy',
      conversationId: CONV,
    })) as { ok: boolean; value: { windows: number } };

    expect(resultado.ok).toBe(true);
    expect(resultado.value.windows).toBe(0);
    expect(huella.recaps.writes).toBe(0);
  });
});
