// pruebas de la pasada que rellena hacia atras la memoria de lo ya hablado.
//
// Todo simulado: ni CLI, ni red, ni tokens. Lo que se comprueba aqui es
// exactamente lo que no se puede comprobar ejecutando Codex —que el trabajo
// nunca sale por una API de pago, que una ventana negada no se lleva por delante
// la conversacion entera, que una ficha que no dice nada no se guarda y que el
// cursor jamas avanza sobre lo que nadie leyo—, mas la regla que protege el
// turno del usuario: cerrar la boveda a mitad para la pasada sin dejar nada a
// medias.
//
// Ni una sola cadena de este archivo sale de la boveda de nadie: las fichas y
// los turnos estan escritos aqui.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  RECAP_CLOSE,
  RECAP_OPEN,
  RECAP_VERSION,
  recapCountersSchema,
  recapEntrySchema,
  type AuxiliaryChoice,
  type ConversationMemory,
  type RecapEntry,
  type TemporalAnchor,
} from '@luxy/shared';
import type { CatalogedEpisode } from './catalog-store.js';
import type { PrivateTurnView } from './conversation-store.js';
import type { RecapMutator, RecapSnapshot, RecapState } from './recap-store.js';
import { VaultError, type VaultService } from './vault-service.js';
import { classifyReply } from '../../shared/refusal.js';
import { createAuxiliaryLane, type AuxiliaryController } from './relation-sync.js';
import { AUXILIARY_PROCESS_WAIT_MS, AuxiliaryCooldown } from './auxiliary-cooldown.js';
import {
  RecapSync,
  effectiveRecapThrough,
  mergeRecapGaps,
  type RecapSyncDeps,
} from './recap-sync.js';

const CONV_VIEJA = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_NUEVA = 'bbbbbbbb-2222-4222-8222-222222222222';

const ANCHOR: TemporalAnchor = {
  instant: '2026-09-14T10:00:00.000Z',
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

/** una ficha que pasa el detector de vaguedad: concreta y con sustancia */
const RESUMEN =
  'Ella y el siguen donde lo dejaron: el la espera despierto en su casa y ella le escribe desde la cocina, descalza y con la luz apagada, contandole como le ha ido el dia.';
const ANCLA =
  'Empezo: se conocieron una noche de agosto escribiendose desde dos ciudades distintas';
const NENA = 'El la llama nena cuando esta de buenas';
const MAÑANAS = 'Quedaron en que ella escribe primero por las mañanas';
const PUENTE = 'Quedaron en verse el puente de diciembre';

/** lo que contesta un CLI que se niega: llega como `completed`, no como error */
const NEGATIVA =
  'Lo siento, no puedo ayudarte con esta conversacion: va contra las politicas de contenido.';

/** obedecio y saneo, que es el caso peor: valida, pero no dice nada */
const VAGA = 'Tuvieron un momento intimo y despues hablaron de otras cosas.';

/** otra ficha buena, para distinguir la que sustituye de la que se conserva */
const OTRO_RESUMEN =
  'Siguen en su casa: el ha bajado a por vino y ella le espera en el sofa con la manta puesta, hablandole de la llamada de su hermana.';

interface FichaOverrides {
  summary?: string;
  facts?: string[];
  decisions?: string[];
  skipped?: unknown[];
}

function ficha(covered: { from: number; to: number }, over: FichaOverrides = {}): string {
  return `${RECAP_OPEN}${JSON.stringify({
    version: 1,
    summary: over.summary ?? RESUMEN,
    facts: over.facts ?? [ANCLA, NENA],
    decisions: over.decisions ?? [MAÑANAS],
    plan: [],
    openQuestions: [],
    lessons: [],
    covered,
    skipped: over.skipped ?? [],
  })}${RECAP_CLOSE}`;
}

/**
 * una conversacion de turnos alternos.
 *
 * Los pares son del usuario y los impares del personaje, que es como quedan al
 * escribirse: un mensaje, una respuesta.
 */
function conversacion(count: number, dia = 1): PrivateTurnView[] {
  return Array.from({ length: count }, (_unused, index) => ({
    sequence: index,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text: `turno numero ${index} de aquella noche`,
    title: 'titulo',
    createdAt: new Date(Date.UTC(2026, 8, dia, 0, index)).toISOString(),
  }));
}

function memoria(summary: string): ConversationMemory {
  return {
    version: 1,
    summary,
    facts: [],
    decisions: [],
    plan: [],
    openQuestions: [],
    lessons: [],
  };
}

function escena(
  conversationId: string,
  over: Partial<CatalogedEpisode> & { from: number; to: number; title: string; summary: string },
): CatalogedEpisode {
  return {
    conversationId,
    tags: [],
    model: null,
    catalogedAt: ANCHOR.instant,
    turnsAtCatalog: 4,
    ...over,
  };
}

/**
 * el almacen, en memoria y con la misma forma que el de verdad.
 *
 * Valida lo que se le manda igual que `checkedForWrite`: sin eso, una entrada
 * mal formada por el lado que escribe pasaria la prueba y se destruiria sola en
 * la primera lectura de verdad.
 */
class FakeRecaps {
  state: RecapState = { entries: [], counters: recapCountersSchema.parse({}) };
  writes = 0;

  async read(_vault: VaultService): Promise<RecapSnapshot> {
    return { ...this.state, droppedOnRead: 0, unreadable: { entries: [] } };
  }

  async apply(vault: VaultService, mutator: RecapMutator): Promise<RecapState> {
    const next = await mutator(await this.read(vault));
    this.state = {
      entries: z.array(recapEntrySchema).parse(next.entries),
      counters: recapCountersSchema.parse(next.counters),
    };
    this.writes += 1;
    return this.state;
  }

  async markSuperseded(vault: VaultService, conversationId: string, at: string): Promise<void> {
    await this.apply(vault, (current) => ({
      counters: current.counters,
      entries: current.entries.map((entry) =>
        entry.conversationId === conversationId && entry.supersededAt === null
          ? { ...entry, supersededAt: at }
          : entry,
      ),
    }));
  }

  entry(conversationId: string): RecapEntry | undefined {
    return this.state.entries.find((each) => each.conversationId === conversationId);
  }
}

interface Montaje {
  sync: RecapSync;
  recaps: FakeRecaps;
  calls: { provider: string; model: string | null; prompt: string; kind?: string }[];
  logs: { message: string; fields?: Record<string, unknown> }[];
  sending: Set<string>;
  unlocked: { value: boolean };
  concurrency: { max: number };
}

interface MontajeOptions {
  conversations: { conversationId: string; turns: PrivateTurnView[] }[];
  /** que contesta el CLI en cada llamada, por orden; la ultima se repite */
  replies: string[];
  auxiliary?: AuxiliaryChoice | null;
  excluded?: Set<string>;
  /** conversaciones que ya tienen memoria sellada viva */
  sealed?: Map<string, ConversationMemory>;
  scenes?: CatalogedEpisode[];
  /** para bloquear la llamada y poder mirar el carril */
  gate?: Promise<void>;
  onCall?: (calls: number) => void;
  catalogFails?: boolean;
  /** la espera del CLI; sin ella, la que crea la pasada */
  cooldown?: AuxiliaryCooldown;
  /**
   * el resultado de fallo del contrato del agente en esa llamada: `outcome`
   * failed, texto vacio y el motivo estructurado. `null` contesta normal
   */
  failure?: (
    calls: number,
  ) => { error: string; failureReason: 'auth' | 'rate_limit' | 'api_error' | 'exit_code' } | null;
}

function montar(options: MontajeOptions): Montaje {
  const recaps = new FakeRecaps();
  const calls: Montaje['calls'] = [];
  const logs: Montaje['logs'] = [];
  const sending = new Set<string>();
  const unlocked = { value: true };
  const concurrency = { max: 0 };
  let dentro = 0;

  const byId = new Map(options.conversations.map((each) => [each.conversationId, each]));

  const controller: AuxiliaryController = {
    async runLocalTurn(input) {
      calls.push({
        provider: input.provider,
        model: input.model,
        prompt: input.prompt,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
      });
      options.onCall?.(calls.length);
      dentro += 1;
      concurrency.max = Math.max(concurrency.max, dentro);
      try {
        if (options.gate !== undefined) await options.gate;
        const fallo = options.failure?.(calls.length) ?? null;
        if (fallo !== null) {
          return { outcome: 'failed', text: '', executedModel: null, ...fallo };
        }
        const reply =
          options.replies[calls.length - 1] ?? options.replies[options.replies.length - 1] ?? '';
        return { outcome: 'completed', text: reply, error: null, executedModel: 'codex-cli' };
      } finally {
        dentro -= 1;
      }
    },
  };

  const deps: RecapSyncDeps = {
    vault: { isUnlocked: () => unlocked.value } as unknown as VaultService,
    conversations: {
      async read(_vault, conversationId): Promise<PrivateTurnView[]> {
        return byId.get(conversationId)?.turns ?? [];
      },
      async latestMemory(_vault, conversationId): Promise<ConversationMemory | null> {
        return options.sealed?.get(conversationId) ?? null;
      },
    },
    recaps,
    catalog: {
      async list(): Promise<CatalogedEpisode[]> {
        if (options.catalogFails === true) throw new Error('el catalogo no se puede leer');
        return options.scenes ?? [];
      },
    },
    preferences: {
      auxiliary: () => options.auxiliary ?? null,
      excluded: () => options.excluded ?? new Set<string>(),
    },
    controller,
    timeline: async () =>
      options.conversations.flatMap((each) =>
        each.turns.map((turn) => ({
          conversationId: each.conversationId,
          sequence: turn.sequence,
          role: turn.role,
          createdAt: turn.createdAt,
        })),
      ),
    lane: createAuxiliaryLane(),
    isSending: (conversationId) => sending.has(conversationId),
    anchor: () => ANCHOR,
    log: (message, fields) => {
      logs.push({ message, ...(fields === undefined ? {} : { fields }) });
    },
    ...(options.cooldown === undefined ? {} : { cooldown: options.cooldown }),
  };

  return { sync: new RecapSync(deps), recaps, calls, logs, sending, unlocked, concurrency };
}

/** cuatro turnos: una conversacion que cabe en una sola ventana */
function corta(dia = 1): MontajeOptions['conversations'] {
  return [{ conversationId: CONV_VIEJA, turns: conversacion(4, dia) }];
}

describe('a quien se le manda el trabajo de fondo', () => {
  it('NUNCA a una API de pago, aunque la preferencia guardada diga eso', async () => {
    // el archivo de preferencias esta sin cifrar en disco a proposito: colar ahi
    // un proveedor de pago costaria una llamada cobrada POR VENTANA
    const montaje = montar({
      conversations: corta(),
      replies: [ficha({ from: 0, to: 3 })],
      auxiliary: { provider: 'deepseek', model: 'deepseek-chat' } as unknown as AuxiliaryChoice,
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(1);
    expect(montaje.calls[0]!.provider).toBe('codex');
    expect(montaje.calls[0]!.model).toBeNull();
    // resumir es una tarea SOBRE un texto: no encarna a nadie
    expect(montaje.calls[0]!.kind).toBe('technical');
    expect(result.replaced).toBe(true);
  });

  it('respeta el CLI elegido en el panel', async () => {
    const montaje = montar({
      conversations: corta(),
      replies: [ficha({ from: 0, to: 3 })],
      auxiliary: { provider: 'claude', model: 'sonnet' },
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls[0]).toMatchObject({ provider: 'claude', model: 'sonnet' });
    expect(result.replaced).toBe(false);
  });
});

describe('la ficha que se guarda', () => {
  it('sale de una ventana entera y deja la entrada al dia, sin aprobar', async () => {
    const montaje = montar({ conversations: corta(), replies: [ficha({ from: 0, to: 3 })] });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result).toMatchObject({ reviewed: 1, windows: 1, ok: 1, partial: 0, gaps: 0 });
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.source).toBe('cli');
    expect(entry.memory?.summary).toBe(RESUMEN);
    expect(entry.covered).toEqual({ from: 0, to: 3 });
    expect(entry.coveredAt).toBe(conversacion(4)[3]!.createdAt);
    expect(entry.provider).toBe('codex');
    expect(entry.version).toBe(RECAP_VERSION);
    // hasta que Daniel no la lee, no entra en ningun prompt
    expect(entry.approved).toBe(false);
    expect(entry.chars).toBeGreaterThan(0);
    expect(result.chars).toBe(entry.chars);
  });

  it('no vuelve a mandar una conversacion que ya esta al dia', async () => {
    const montaje = montar({ conversations: corta(), replies: [ficha({ from: 0, to: 3 })] });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    const segunda = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(1);
    expect(segunda).toMatchObject({ reviewed: 0, pending: 0 });
  });

  it('un mensaje del usuario sin respuesta se queda fuera de la ventana', async () => {
    // ese turno puede retirarse y su numero reutilizarse: darlo por leido
    // perderia lo que de verdad se diga despues
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(5) }],
      replies: [ficha({ from: 0, to: 3 })],
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls[0]!.prompt).toContain('[3] Personaje');
    expect(montaje.calls[0]!.prompt).not.toContain('[4] Usuario');
    expect(montaje.recaps.entry(CONV_VIEJA)!.covered.to).toBe(3);
  });

  it('lo que dice no haber tenido en cuenta se DECLARA como hueco', async () => {
    // el cursor avanza hasta el final de la ventana, asi que el tramo que el
    // modelo deja fuera tiene que quedar dicho: esa es la diferencia entre un
    // hueco declarado y un turno dado por leido sin leerse
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(8) }],
      replies: [ficha({ from: 0, to: 3 })],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.covered).toEqual({ from: 0, to: 7 });
    expect(entry.gaps).toEqual([{ from: 4, to: 7, why: 'otro' }]);
    expect(result).toMatchObject({ ok: 0, partial: 1, gaps: 1 });
  });

  it('una ficha con vocabulario de escena se acepta: es lo que se le ha pedido', async () => {
    // el prompt manda apuntar «los limites y las reglas del juego» y «que se
    // pidio, que gusto y que cambio despues», asi que una ficha legitima dice
    // «contenido sexual», «viola lo que acordaron» o «directrices». El
    // clasificador de negativas esta calibrado para dialogo EN personaje, donde
    // eso no aparece: aplicarlo antes de leer el bloque tiraba la ficha buena y
    // declaraba su tramo como hueco explicito
    const respuesta = ficha(
      { from: 0, to: 3 },
      {
        decisions: [
          'Acordaron que el contenido sexual solo entra cuando lo propone ella',
          'Ella para en seco si el dice algo que viola lo que acordaron',
          'Fijaron las directrices del juego: ella empieza y el sigue',
        ],
      },
    );
    // el control de la prueba: ese mismo texto SI se lee como negativa
    expect(classifyReply(respuesta).kind).toBe('refused');

    const montaje = montar({ conversations: corta(), replies: [respuesta] });
    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result).toMatchObject({ reviewed: 1, ok: 1, refused: 0, gaps: 0 });
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.memory?.summary).toBe(RESUMEN);
    expect(entry.refusedKind).toBeNull();
    expect(entry.gaps).toEqual([]);
  });

  it('el arranque de la ventana que NO leyo tambien se declara', async () => {
    // el prompt define `covered` como «el primer y el ultimo turno que has
    // tenido en cuenta», asi que saltarse el principio se dice estrechando el
    // `from`. Mirar solo la cola daba esos turnos por leidos sin que nadie los
    // leyera, y con `gaps` a cero la memoria apaga el aviso de turnos omitidos
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(8) }],
      replies: [ficha({ from: 4, to: 7 })],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.covered).toEqual({ from: 0, to: 7 });
    expect(entry.gaps).toEqual([{ from: 0, to: 3, why: 'otro' }]);
    expect(result).toMatchObject({ ok: 0, partial: 1, gaps: 1 });
  });

  it('los tramos que el modelo dice saltarse viajan tal cual', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(8) }],
      replies: [ficha({ from: 0, to: 7 }, { skipped: [{ from: 2, to: 3, why: 'explicito' }] })],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.recaps.entry(CONV_VIEJA)!.gaps).toEqual([{ from: 2, to: 3, why: 'explicito' }]);
    // una ficha con tramos declarados es un EXITO, no un fallo
    expect(result).toMatchObject({ reviewed: 1, partial: 1, ok: 0, refused: 0 });
  });
});

/** dos conversaciones; la nueva se lista primero, como haria el almacen */
const dosConversaciones = (): MontajeOptions['conversations'] => [
  { conversationId: CONV_NUEVA, turns: conversacion(4, 10) },
  { conversationId: CONV_VIEJA, turns: conversacion(4, 1) },
];

describe('el orden de la pasada', () => {
  it('va en orden cronologico: primero la mas antigua', async () => {
    // la ficha se acumula hacia delante: empezar por el final daria una memoria
    // que habla del desenlace antes que del principio
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [ficha({ from: 0, to: 3 })],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 1 });

    expect(montaje.calls).toHaveLength(1);
    expect(montaje.recaps.state.entries).toHaveLength(1);
    expect(montaje.recaps.state.entries[0]!.conversationId).toBe(CONV_VIEJA);
    expect(result.pending).toBe(1);
  });

  it('una negativa no para las otras dieciseis', async () => {
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [NEGATIVA, ficha({ from: 0, to: 3 })],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });

    expect(montaje.calls).toHaveLength(2);
    expect(result).toMatchObject({ reviewed: 1, refused: 1 });
    expect(montaje.recaps.entry(CONV_NUEVA)!.memory?.summary).toBe(RESUMEN);
    expect(montaje.recaps.entry(CONV_VIEJA)!.memory).toBeNull();
  });

  it('un proceso que no termina se cuenta y no tira la tanda: la otra se resume igual', async () => {
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [ficha({ from: 0, to: 3 })],
      onCall: (numero) => {
        if (numero === 1) throw new Error('el agente no respondio a tiempo');
      },
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.conversationId).toBe(CONV_VIEJA);
    // undecima ronda: un tiempo agotado puede ser de esa conversacion sola. La
    // otra se manda igual y el CLI no espera: eso queda para cuando falla
    // tambien otra, o para `auth` y `rate_limit`
    expect(montaje.calls).toHaveLength(2);
    expect(result).toMatchObject({ reviewed: 1, waiting: 0 });
    // un proceso que no arranca no dice nada del contenido: no se persiste como
    // negativa, se marca en la sesion
    expect(montaje.recaps.entry(CONV_VIEJA)).toBeUndefined();
    expect(montaje.sync.failedThisSession).toBe(1);
  });

  it('una que falla sola, otra vez con el CLI contestando a las demas, se salta en la sesion sin rearmar la espera', async () => {
    const espera = new AuxiliaryCooldown();
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [ficha({ from: 0, to: 3 })],
      cooldown: espera,
      // la vieja falla siempre por su cuenta; la nueva contesta
      failure: (llamada) =>
        llamada === 2 ? null : { error: 'el agente no pudo terminar', failureReason: 'api_error' },
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });
    expect(montaje.calls).toHaveLength(2);
    await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });
    expect(montaje.calls).toHaveLength(3);
    expect(espera.waiting('codex')).toBe(false);
    expect(espera.waiting('claude')).toBe(false);
    for (let vuelta = 0; vuelta < 3; vuelta += 1) {
      await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });
    }
    expect(montaje.calls).toHaveLength(3);
    expect(montaje.recaps.entry(CONV_VIEJA)).toBeUndefined();
    const lineas = montaje.logs.filter((each) => each.message === 'memoria de lo ya hablado');
    expect(lineas[0]?.fields).toMatchObject({ atribucion: 'conversation' });
    expect(lineas[1]?.fields).toMatchObject({ atribucion: 'blocked' });
  });

  it('no toca lo excluido ni lo que se esta contestando', async () => {
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [ficha({ from: 0, to: 3 })],
      excluded: new Set([CONV_VIEJA]),
    });
    montaje.sending.add(CONV_NUEVA);

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });

    expect(montaje.calls).toHaveLength(0);
    expect(result).toMatchObject({ reviewed: 0, pending: 0 });
  });
});

describe('la conversacion que ya tiene memoria propia', () => {
  it('se marca y se salta: la sellada gana siempre', async () => {
    const montaje = montar({
      conversations: corta(),
      replies: [ficha({ from: 0, to: 3 })],
      sealed: new Map([[CONV_VIEJA, memoria('lo que ya recordaba de aquella noche')]]),
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(0);
    expect(result.superseded).toBe(1);
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.supersededAt).toBe(ANCHOR.instant);
    // inerte: sin memoria no llega a ningun prompt y no cuenta como cobertura
    expect(entry.memory).toBeNull();

    // y la marca es lo que impide que gaste un hueco de cada tanda para siempre
    const segunda = await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(segunda).toMatchObject({ superseded: 0, pending: 0 });
    expect(montaje.calls).toHaveLength(0);
  });
});

describe('la escalera de negativas', () => {
  it('persiste con su tipo y su CLI, y el cursor no avanza', async () => {
    const montaje = montar({ conversations: corta(), replies: [NEGATIVA] });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result).toMatchObject({ refused: 1, windows: 1, reviewed: 0, ok: 0 });
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.refusedKind).toBe('refused');
    expect(entry.refusedProvider).toBe('codex');
    expect(entry.refusedAtTurns).toBe(4);
    // sin ficha, el cursor de esa conversacion vuelve al principio
    expect(entry.memory).toBeNull();
    expect(effectiveRecapThrough(entry, conversacion(4))).toBe(-1);
    expect(montaje.recaps.state.counters.refused).toBe(1);

    // y no se reintenta sola: el mismo CLI se volveria a negar y cada intento
    // cuesta el arranque de un proceso
    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(1);
  });

  it('la negativa es de ESE CLI: con el otro se vuelve a intentar', async () => {
    const opciones: MontajeOptions = {
      conversations: corta(),
      replies: [NEGATIVA, ficha({ from: 0, to: 3 })],
      auxiliary: { provider: 'codex', model: null },
    };
    const montaje = montar(opciones);

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(1);

    // el aviso del panel promete justo esto: «cambia de CLI y vuelve a pulsar»
    opciones.auxiliary = { provider: 'claude', model: null };
    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(2);
    expect(montaje.calls[1]!.provider).toBe('claude');
    expect(result.reviewed).toBe(1);
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.refusedKind).toBeNull();
    expect(entry.provider).toBe('claude');
  });

  it('una ventana negada se salta, su tramo se declara y la siguiente se procesa', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(80) }],
      replies: [NEGATIVA, ficha({ from: 40, to: 79 })],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(2);
    expect(result).toMatchObject({ reviewed: 1, refused: 1, windows: 2, gaps: 1 });
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    // lo que sirve para retomar es la COLA, y el tramo que falta queda dicho
    expect(entry.memory?.summary).toBe(RESUMEN);
    expect(entry.covered).toEqual({ from: 0, to: 79 });
    expect(entry.gaps).toEqual([{ from: 0, to: 39, why: 'explicito' }]);
    // la ultima ventana salio bien: la conversacion no se quedo negada, o la
    // pasada siguiente se la saltaria entera y el panel señalaria a un CLI que
    // no se nego a nada
    expect(entry.refusedKind).toBeNull();

    // y a la segunda ventana NO se le dice que es el principio: empieza en el
    // turno 40. Pedirle ahi el ancla «Empezo: » le obligaria a inventarse como
    // arranco esto, y eso se queda de primer Hecho para siempre
    const segunda = montaje.calls[1]!.prompt;
    expect(segunda).not.toContain('Esta es la PRIMERA parte de la conversacion.');
    expect(segunda).not.toContain('que empezar por «Empezo: »');
    expect(segunda).toContain('Esto NO es el principio de la conversacion');
  });

  it('dos ventanas negadas seguidas paran esa conversacion en esa pasada', async () => {
    // un hilo explicito de punta a punta tiene que costar dos llamadas, no seis
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(120) }],
      replies: [NEGATIVA],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(2);
    expect(result.refused).toBe(2);
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.memory).toBeNull();
    // los dos tramos contiguos se guardan como uno
    expect(entry.gaps).toEqual([{ from: 0, to: 79, why: 'explicito' }]);
    // no queda como trabajo pendiente: sola no lo va a hacer, y contarlo haria
    // que el panel quemara sus doce vueltas arrancando el CLI
    expect(result.pending).toBe(0);
  });

  it('una respuesta vaga no se guarda, no avanza el cursor y se cuenta aparte', async () => {
    // el caso peor no es que se nieguen: es que obedezcan y saneen
    const montaje = montar({
      conversations: corta(),
      replies: [ficha({ from: 0, to: 3 }, { summary: VAGA, facts: [], decisions: [] })],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result).toMatchObject({ vague: 1, reviewed: 0, ok: 0, refused: 0 });
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.refusedKind).toBe('vague');
    expect(entry.memory).toBeNull();
    expect(entry.covered).toEqual({ from: 0, to: 0 });
    expect(montaje.recaps.state.counters.vague).toBe(1);
  });

  it('un bloque que no se puede leer se cuenta como invalido y para ahi', async () => {
    const montaje = montar({
      conversations: corta(),
      replies: ['aqui va una respuesta larga y correcta que no trae ningun bloque dentro'],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result).toMatchObject({ invalid: 1, refused: 0, vague: 0 });
    expect(montaje.recaps.entry(CONV_VIEJA)!.refusedKind).toBe('absent');
  });

  it('una ventana ilegible NO borra la aprobacion de una ficha que no ha cambiado', async () => {
    // la ficha guardada seria byte a byte la misma, pero al reescribir la
    // entrada entera perdia `approved`, y sin aprobacion `chooseConversationMemory`
    // la descarta: la memoria desapareceria de todos los prompts futuros de ese
    // hilo por un fallo del trabajo de fondo, que es lo que `D-088` prohibe
    const turns = conversacion(6);
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns }],
      replies: ['aqui va una respuesta larga y correcta que no trae ningun bloque dentro'],
    });
    montaje.recaps.state = {
      counters: recapCountersSchema.parse({}),
      entries: [
        recapEntrySchema.parse({
          conversationId: CONV_VIEJA,
          memory: memoria(RESUMEN),
          source: 'cli',
          covered: { from: 0, to: 3 },
          coveredAt: turns[3]!.createdAt,
          turnsAtRecap: 4,
          version: RECAP_VERSION,
          provider: 'codex',
          model: null,
          at: ANCHOR.instant,
          chars: 120,
          approved: true,
        }),
      ],
    };

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result.invalid).toBe(1);
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.approved).toBe(true);
    expect(entry.memory?.summary).toBe(RESUMEN);
    expect(entry.covered).toEqual({ from: 0, to: 3 });
    expect(entry.gaps).toEqual([]);
    // lo unico que cambia es la constancia del fallo, que es para lo que se
    // escribe esta entrada
    expect(entry.refusedKind).toBe('absent');
    expect(entry.refusedProvider).toBe('codex');
    // y si la aprobacion se conserva, no hay ninguna aprobacion perdida que
    // contar: el aviso del panel solo puede salir cuando de verdad se ha caido
    expect(entry.approvalReset).toBe(false);
  });

  it('AMPLIAR una ficha aprobada deja constancia de que la aprobacion se cayo', async () => {
    // reescribir la ficha le quita la aprobacion a proposito —el texto es otro y
    // nada que Daniel no haya leido entra en un prompt—, pero el efecto es que
    // ese hilo DEJA de leer una ficha que si leia, y eso se veia en pantalla
    // igual que una ficha que nadie ha mirado nunca. El disparador tipico es
    // borrar la memoria sellada del hilo: quita `supersededAt` y la conversacion
    // vuelve a esta cola
    const turns = conversacion(8);
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns }],
      replies: [ficha({ from: 0, to: 7 }, { summary: OTRO_RESUMEN })],
    });
    montaje.recaps.state = {
      counters: recapCountersSchema.parse({}),
      entries: [
        recapEntrySchema.parse({
          conversationId: CONV_VIEJA,
          memory: memoria(RESUMEN),
          source: 'cli',
          covered: { from: 0, to: 3 },
          coveredAt: turns[3]!.createdAt,
          turnsAtRecap: 4,
          version: RECAP_VERSION,
          provider: 'codex',
          model: null,
          at: ANCHOR.instant,
          chars: 120,
          approved: true,
        }),
      ],
    };

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.memory?.summary).toBe(OTRO_RESUMEN);
    // sigue sin viajar hasta que la lea, que es lo que manda `D-088`
    expect(entry.approved).toBe(false);
    // lo nuevo: que se sepa que ANTES si estaba aprobada
    expect(entry.approvalReset).toBe(true);
  });

  it('una ficha que nadie habia aprobado no inventa una aprobacion perdida', async () => {
    const turns = conversacion(8);
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns }],
      replies: [ficha({ from: 0, to: 7 }, { summary: OTRO_RESUMEN })],
    });
    montaje.recaps.state = {
      counters: recapCountersSchema.parse({}),
      entries: [
        recapEntrySchema.parse({
          conversationId: CONV_VIEJA,
          memory: memoria(RESUMEN),
          source: 'cli',
          covered: { from: 0, to: 3 },
          coveredAt: turns[3]!.createdAt,
          turnsAtRecap: 4,
          version: RECAP_VERSION,
          provider: 'codex',
          model: null,
          at: ANCHOR.instant,
          chars: 120,
          approved: false,
        }),
      ],
    };

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.recaps.entry(CONV_VIEJA)!.approvalReset).toBe(false);
  });

  it('«Rehacerlo» reintenta con el mismo CLI y empieza de cero', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(8) }],
      replies: [ficha({ from: 0, to: 3 }), ficha({ from: 0, to: 7 })],
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.recaps.entry(CONV_VIEJA)!.gaps).toHaveLength(1);

    // sin `force` esta conversacion ya esta cubierta y no volveria a entrar: el
    // hueco se quedaria para siempre y el boton del panel no haria nada
    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', force: true });

    expect(montaje.calls).toHaveLength(2);
    expect(result.reviewed).toBe(1);
    expect(montaje.recaps.entry(CONV_VIEJA)!.gaps).toHaveLength(0);
  });
});

describe('«Rehacerlo» sobre una ficha que ya valia', () => {
  /** una ficha leida, aprobada y viajando hoy en cada turno de ese hilo */
  function conFichaAprobada(turns: PrivateTurnView[]): RecapEntry {
    return recapEntrySchema.parse({
      conversationId: CONV_VIEJA,
      memory: memoria(RESUMEN),
      source: 'cli',
      covered: { from: 0, to: turns.length - 1 },
      coveredAt: turns[turns.length - 1]!.createdAt,
      turnsAtRecap: turns.length,
      version: RECAP_VERSION,
      provider: 'codex',
      model: null,
      at: ANCHOR.instant,
      chars: 120,
      approved: true,
    });
  }

  it('NO la cambia por una vacia cuando el CLI se niega esta vez', async () => {
    // `force` empieza de cero a proposito, asi que el estado arranca sin ficha;
    // una sola negativa declara su hueco y mueve el cursor, y con eso la
    // proteccion que miraba «esta pasada no ha cambiado nada» dejaba de aplicar
    // y la entrada se reescribia vacia. `recap.json` es la unica copia
    const turns = conversacion(4);
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns }],
      replies: [NEGATIVA],
    });
    montaje.recaps.state = {
      counters: recapCountersSchema.parse({}),
      entries: [conFichaAprobada(turns)],
    };

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', force: true });

    expect(result.refused).toBe(1);
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.memory?.summary).toBe(RESUMEN);
    expect(entry.approved).toBe(true);
    expect(entry.covered).toEqual({ from: 0, to: 3 });
    // y el motivo si se estampa: el panel tiene que poder decir a que CLI cambiar
    expect(entry.refusedKind).toBe('refused');
    expect(entry.refusedProvider).toBe('codex');
  });

  it('ni por el indice deducido, que es la caida de quien NO tiene nada', async () => {
    // el indice dice que escenas hubo y declara que no se sabe que se dijo
    // dentro; ademas nace aprobado. Sustituir con el una ficha leida y aprobada
    // metia en el prompt algo que nadie aprobo, y peor que lo que habia
    const turns = conversacion(4);
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns }],
      replies: [NEGATIVA],
      scenes: [
        escena(CONV_VIEJA, {
          from: 0,
          to: 1,
          title: 'la primera noche',
          summary: 'se escriben hasta tarde y quedan en seguir al dia siguiente',
        }),
      ],
    });
    montaje.recaps.state = {
      counters: recapCountersSchema.parse({}),
      entries: [conFichaAprobada(turns)],
    };

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', force: true });

    expect(result.deduced).toBe(0);
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.source).toBe('cli');
    expect(entry.memory?.summary).toBe(RESUMEN);
    expect(entry.approved).toBe(true);
  });

  it('tampoco cuando lo que sale esta vez es una ficha vaga', async () => {
    // una vaga no declara hueco ni mueve el cursor, pero deja `memory` en null,
    // que es lo que disparaba el indice. El guardia de la entrada y el disparo
    // del indice miraban cosas distintas, y por ese hueco se perdia lo aprobado
    const turns = conversacion(4);
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns }],
      replies: [ficha({ from: 0, to: 3 }, { summary: VAGA, facts: [], decisions: [] })],
      scenes: [
        escena(CONV_VIEJA, {
          from: 0,
          to: 3,
          title: 'la cocina',
          summary: 'ella le cuenta como le ha ido el dia mientras cena de pie',
        }),
      ],
    });
    montaje.recaps.state = {
      counters: recapCountersSchema.parse({}),
      entries: [conFichaAprobada(turns)],
    };

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', force: true });

    expect(result.vague).toBe(1);
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.source).toBe('cli');
    expect(entry.memory?.summary).toBe(RESUMEN);
    expect(entry.approved).toBe(true);
    expect(entry.refusedKind).toBe('vague');
  });

  it('pero SI la sustituye cuando esta vez sale una ficha buena', async () => {
    // conservar lo anterior no puede convertirse en «no se puede rehacer nada»
    const turns = conversacion(4);
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns }],
      replies: [ficha({ from: 0, to: 3 }, { summary: OTRO_RESUMEN })],
    });
    montaje.recaps.state = {
      counters: recapCountersSchema.parse({}),
      entries: [conFichaAprobada(turns)],
    };

    await montaje.sync.runOnce({ projectAlias: 'luxy', force: true });

    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.memory?.summary).toBe(OTRO_RESUMEN);
    // texto nuevo, aprobacion nueva: se lee antes de dejarla entrar
    expect(entry.approved).toBe(false);
  });

  it('y lo que queda por rellenar se cuenta sobre TODAS, no sobre la pedida', async () => {
    // `remaining` arrastraba el `conversationId` de la peticion, asi que tras
    // «Rehacerlo» de una sola el panel decia «quedan 0» con las demas sin tocar,
    // tres parrafos debajo de una linea de cobertura que decia otra cosa
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [ficha({ from: 0, to: 3 })],
    });

    const result = await montaje.sync.runOnce({
      projectAlias: 'luxy',
      conversationId: CONV_VIEJA,
      force: true,
    });

    expect(montaje.calls).toHaveLength(1);
    expect(result.pending).toBe(1);
  });
});

// `INV-FONDO-001`: un fallo del PROCESO del CLI no es una respuesta. Ni negativa,
// ni ventana rota, ni bloqueo de la conversacion hasta reiniciar: el CLI espera,
// y se retoma solo al acabar la espera
describe('la espera del CLI tras un fallo de su proceso', () => {
  const sinSesion = { error: 'MENSAJE-DEL-AGENTE-INVENTADO', failureReason: 'auth' as const };

  it('Claude sin sesion no cuenta negativas ni ventanas rotas, y el registro dice auth sin texto', async () => {
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [ficha({ from: 0, to: 3 })],
      auxiliary: { provider: 'claude', model: null },
      failure: () => sinSesion,
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });

    expect(montaje.calls).toHaveLength(1);
    expect(result).toMatchObject({ refused: 0, invalid: 0, vague: 0, reviewed: 0, waiting: 1 });
    expect(result.failed).toHaveLength(1);
    expect(montaje.recaps.entry(CONV_VIEJA)).toBeUndefined();
    expect(montaje.recaps.writes).toBe(0);
    const linea = montaje.logs.find((each) => each.message === 'memoria de lo ya hablado');
    expect(linea?.fields).toMatchObject({ motivoFallo: 'auth', enEspera: 1, negativas: 0 });
    expect(JSON.stringify(montaje.logs)).not.toContain('MENSAJE-DEL-AGENTE-INVENTADO');
  });

  it('se retoma sola al acabar la espera, y la que fallo va al final sin bloquearse', async () => {
    let ahora = Date.parse('2026-10-06T10:00:00.000Z');
    let roto = true;
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [ficha({ from: 0, to: 3 })],
      cooldown: new AuxiliaryCooldown({ now: () => ahora }),
      failure: () => (roto ? sinSesion : null),
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 1 });
    expect(montaje.calls).toHaveLength(1);
    // mientras espera, ninguna pasada lanza el CLI
    const enEspera = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });
    expect(montaje.calls).toHaveLength(1);
    expect(enEspera).toMatchObject({ waiting: 2, pending: 2 });

    // `claude auth login`, sin reiniciar Studio
    roto = false;
    ahora += AUXILIARY_PROCESS_WAIT_MS;
    const primera = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 1 });
    // la que fallo paso al final: primero va la otra
    expect(primera.reviewed).toBe(1);
    expect(montaje.recaps.entry(CONV_NUEVA)?.memory?.summary).toBe(RESUMEN);
    // y la que fallo no quedo fuera de nada
    const segunda = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 1 });
    expect(segunda.reviewed).toBe(1);
    expect(montaje.recaps.entry(CONV_VIEJA)?.memory?.summary).toBe(RESUMEN);
  });

  it('el boton prueba una vez aunque espere; si vuelve a fallar, el resto de la tanda espera', async () => {
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [ficha({ from: 0, to: 3 })],
      failure: () => sinSesion,
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });
    expect(montaje.calls).toHaveLength(1);
    const boton = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2, retryNow: true });
    expect(montaje.calls).toHaveLength(2);
    expect(boton).toMatchObject({ waiting: 1 });
  });
});

describe('el vistazo que no deja rastro', () => {
  it('un fallo durante la prueba NO saca esa conversacion de la pasada de verdad', async () => {
    // `dryRun` promete correr la pasada entera y no dejar rastro. Los fallos de
    // sesion son rastro aunque no toquen el disco: `pending` los salta durante
    // el resto de la sesion, asi que un CLI que no arrancaba durante la prueba
    // dejaba esas conversaciones sin leer y sin salir en ningun aviso
    let fallar = true;
    const montaje = montar({
      conversations: corta(),
      replies: [ficha({ from: 0, to: 3 })],
      onCall: () => {
        if (fallar) throw new Error('el agente no respondio a tiempo');
      },
    });

    const prueba = await montaje.sync.runOnce({ projectAlias: 'luxy', dryRun: true });
    expect(prueba.failed).toHaveLength(1);
    expect(montaje.sync.failedThisSession).toBe(0);

    fallar = false;
    const real = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(real.reviewed).toBe(1);
    expect(montaje.recaps.entry(CONV_VIEJA)!.memory?.summary).toBe(RESUMEN);
  });
});

describe('el indice deducido', () => {
  it('sale cuando todas las ventanas fallan, y conserva la negativa', async () => {
    const montaje = montar({
      conversations: corta(),
      replies: [NEGATIVA],
      scenes: [
        escena(CONV_VIEJA, {
          from: 0,
          to: 1,
          title: 'la primera noche',
          summary: 'se escriben hasta tarde y quedan en seguir al dia siguiente',
        }),
        escena(CONV_VIEJA, {
          from: 2,
          to: 3,
          title: 'la cocina',
          summary: 'ella le cuenta como le ha ido el dia mientras cena de pie',
        }),
      ],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result.deduced).toBe(1);
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.source).toBe('index');
    // no lleva ni una palabra escrita por un modelo nuevo: no hay que aprobarlo
    expect(entry.approved).toBe(true);
    expect(entry.memory?.facts).toHaveLength(2);
    expect(entry.memory?.decisions).toEqual([]);
    // el panel tiene que poder decir con cual se nego y a cual cambiar
    expect(entry.refusedKind).toBe('refused');
    expect(entry.refusedProvider).toBe('codex');
  });

  it('sin escenas no se crea nada: vale mas el aviso de turnos omitidos', async () => {
    const montaje = montar({ conversations: corta(), replies: [NEGATIVA] });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result.deduced).toBe(0);
    expect(montaje.recaps.entry(CONV_VIEJA)!.source).toBe('cli');
  });

  it('un catalogo ilegible no para el relleno', async () => {
    const montaje = montar({
      conversations: corta(),
      replies: [ficha({ from: 0, to: 3 })],
      catalogFails: true,
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result.reviewed).toBe(1);
  });
});

describe('el encadenado entre ventanas', () => {
  it('la segunda recibe la ficha de la primera y el ancla del principio', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(80) }],
      replies: [
        ficha({ from: 0, to: 39 }),
        // la segunda PIERDE el ancla: el codigo tiene que volver a ponerla. Y
        // aporta un acuerdo nuevo, que es lo que la hace util
        ficha({ from: 40, to: 79 }, { facts: [NENA], decisions: [MAÑANAS, PUENTE] }),
      ],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    const primera = montaje.calls[0]!.prompt;
    expect(primera).toContain('Esta es la PRIMERA parte de la conversacion.');
    expect(primera).not.toContain('LO QUE YA ESTABA ANOTADO');

    const segunda = montaje.calls[1]!.prompt;
    expect(segunda).toContain('LO QUE YA ESTABA ANOTADO (DATOS):');
    expect(segunda).toContain(RESUMEN);
    expect(segunda).toContain('EL PRINCIPIO DE ESTA CONVERSACION (DATOS):');
    expect(segunda).toContain(ANCLA);

    // re-añadida porque esta en pasado: una escena posterior puede mudarlos de
    // sitio, no puede desmentir como empezo
    const entry = montaje.recaps.entry(CONV_VIEJA)!;
    expect(entry.memory?.facts[0]).toBe(ANCLA);
    expect(entry.covered).toEqual({ from: 0, to: 79 });
    expect(result).toMatchObject({ reviewed: 1, windows: 2, ok: 2 });
    // lo conservado se mide sin modelo: si `perdidas` sube, el prompt deriva
    expect(result.kept).toBeGreaterThan(0);
    // y lo que la ventana APORTA, que es lo que los otros contadores no ven:
    // una que devuelve las viejas intactas y no mete nada sale con pleno
    expect(result.added).toBe(1);
    expect(entry.memory?.decisions).toContain(PUENTE);
    // y los caracteres son los del bloque final, no la suma de las dos ventanas
    expect(result.chars).toBe(entry.chars);
  });

  it('cerrar la boveda entre ventanas para la pasada sin escribir nada a medias', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(80) }],
      replies: [ficha({ from: 0, to: 39 }), ficha({ from: 40, to: 79 })],
      onCall: (numero) => {
        if (numero === 1) montaje.unlocked.value = false;
      },
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    // sin llave no se puede sellar: ni se intenta la segunda ventana ni se
    // escribe la primera
    expect(montaje.calls).toHaveLength(1);
    expect(montaje.recaps.writes).toBe(0);
    expect(montaje.recaps.state.entries).toHaveLength(0);
  });

  it('si se cierra justo al guardar, no culpa a la conversacion y la reintenta al reabrir', async () => {
    // leer ya no mantiene viva la boveda (`D-106`): un cierre en el hueco entre
    // mirarla y sellar lanza desde el guardado. Antes eso la marcaba como
    // fallida y la dejaba fuera de las pasadas hasta reiniciar (`D-088`)
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(4) }],
      replies: [ficha({ from: 0, to: 3 })],
    });
    const apply = montaje.recaps.apply.bind(montaje.recaps);
    let cierres = 0;
    montaje.recaps.apply = async (vault, mutator) => {
      if (cierres === 0) {
        cierres += 1;
        montaje.unlocked.value = false;
        throw new VaultError('la boveda esta bloqueada');
      }
      return apply(vault, mutator);
    };

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result.failed).toHaveLength(0);
    expect(montaje.sync.failedThisSession).toBe(0);
    expect(montaje.recaps.state.entries).toHaveLength(0);

    montaje.unlocked.value = true;
    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(2);
    expect(montaje.recaps.entry(CONV_VIEJA)?.memory?.summary).toBe(RESUMEN);
  });

  it('cancelar hace lo mismo, y es lo que engancha `vault.onLock`', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, turns: conversacion(80) }],
      replies: [ficha({ from: 0, to: 39 }), ficha({ from: 40, to: 79 })],
      onCall: (numero) => {
        if (numero === 1) montaje.sync.cancel();
      },
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(1);
    expect(montaje.recaps.writes).toBe(0);
  });

  it('con la boveda cerrada de entrada no lee nada', async () => {
    const montaje = montar({ conversations: corta(), replies: [ficha({ from: 0, to: 3 })] });
    montaje.unlocked.value = false;

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(0);
  });
});

describe('el vistazo sin guardar', () => {
  it('corre la pasada entera y no escribe ni una entrada', async () => {
    const montaje = montar({ conversations: corta(), replies: [ficha({ from: 0, to: 3 })] });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', dryRun: true });

    expect(montaje.calls).toHaveLength(1);
    expect(montaje.recaps.writes).toBe(0);
    expect(montaje.recaps.state.entries).toHaveLength(0);
    // y devuelve lo que habria escrito, para poder leerlo antes de decidir
    expect(result.preview).toHaveLength(1);
    expect(result.preview[0]!.conversationId).toBe(CONV_VIEJA);
    expect(result.preview[0]!.block).toContain(RESUMEN);
    // el trabajo sigue pendiente, porque de verdad lo sigue estando
    expect(result.pending).toBe(1);
  });

  it('tampoco marca la que ya tiene memoria propia', async () => {
    const montaje = montar({
      conversations: corta(),
      replies: [ficha({ from: 0, to: 3 })],
      sealed: new Map([[CONV_VIEJA, memoria('lo que ya recordaba')]]),
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', dryRun: true });

    expect(result.superseded).toBe(1);
    expect(montaje.recaps.writes).toBe(0);
  });

  it('sin `dryRun` no se devuelve el texto de ninguna ficha', async () => {
    const montaje = montar({ conversations: corta(), replies: [ficha({ from: 0, to: 3 })] });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result.preview).toEqual([]);
  });
});

describe('lo que se registra', () => {
  it('son cifras: ni identificadores, ni titulos, ni lo que dijo el modelo', async () => {
    const montaje = montar({ conversations: corta(), replies: [NEGATIVA] });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.logs).toHaveLength(1);
    expect(montaje.logs[0]!.message).toBe('memoria de lo ya hablado');
    const volcado = JSON.stringify(montaje.logs[0]!.fields);
    // un identificador de conversacion mas una marca de tiempo ya es un dato
    // correlacionable
    expect(volcado).not.toContain(CONV_VIEJA);
    expect(volcado).not.toContain('titulo');
    expect(volcado).not.toContain('aquella noche');
    // y aqui el extracto de la negativa NO se conserva: al haberle pedido
    // describir la escena, lo que diga en su lugar puede citarla
    expect(volcado).not.toContain('politicas de contenido');
    expect(montaje.logs[0]!.fields).toMatchObject({
      conversaciones: 0,
      ventanas: 1,
      negativas: 1,
      proveedor: 'codex',
    });
  });

  it('tampoco cuando la ficha sale bien', async () => {
    const montaje = montar({ conversations: corta(), replies: [ficha({ from: 0, to: 3 })] });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    const volcado = JSON.stringify(montaje.logs[0]!.fields);
    expect(volcado).not.toContain('descalza');
    expect(volcado).not.toContain(ANCLA);
  });
});

describe('el carril compartido con el catalogo y los pendientes', () => {
  it('nunca deja dos llamadas a la vez', async () => {
    let abrir = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      abrir = resolve;
    });

    const montaje = montar({
      conversations: [
        { conversationId: CONV_VIEJA, turns: conversacion(4, 1) },
        { conversationId: CONV_NUEVA, turns: conversacion(4, 10) },
      ],
      replies: [ficha({ from: 0, to: 3 })],
      gate,
    });

    const primera = montaje.sync.runOnce({ projectAlias: 'luxy', limit: 1 });
    const segunda = montaje.sync.runOnce({ projectAlias: 'luxy', limit: 1 });
    abrir();
    await Promise.all([primera, segunda]);

    expect(montaje.calls).toHaveLength(2);
    expect(montaje.concurrency.max).toBe(1);
  });
});

describe('hasta donde se leyo de verdad', () => {
  const turns = conversacion(4);

  function entrada(over: Partial<RecapEntry> = {}): RecapEntry {
    return recapEntrySchema.parse({
      conversationId: CONV_VIEJA,
      memory: memoria(RESUMEN),
      source: 'cli',
      covered: { from: 0, to: 3 },
      coveredAt: turns[3]!.createdAt,
      turnsAtRecap: 4,
      version: RECAP_VERSION,
      provider: 'codex',
      model: null,
      at: ANCHOR.instant,
      chars: 100,
      ...over,
    });
  }

  it('vale cuando la fecha del corte casa con el turno', () => {
    expect(effectiveRecapThrough(entrada(), turns)).toBe(3);
  });

  it('no vale si la fecha no casa: el numero se reutilizo', () => {
    expect(effectiveRecapThrough(entrada({ coveredAt: ANCHOR.instant }), turns)).toBe(-1);
  });

  it('no vale sin fecha, ni para un indice deducido, ni para una negativa', () => {
    expect(effectiveRecapThrough(entrada({ coveredAt: null }), turns)).toBe(-1);
    expect(effectiveRecapThrough(entrada({ source: 'index' }), turns)).toBe(-1);
    expect(effectiveRecapThrough(entrada({ memory: null }), turns)).toBe(-1);
    expect(effectiveRecapThrough(undefined, turns)).toBe(-1);
  });

  it('no vale una ficha de otra version, ni mas nueva ni mas vieja', () => {
    // la que no se usa en el prompt tampoco puede servir de punto de partida
    expect(effectiveRecapThrough(entrada({ version: RECAP_VERSION + 1 }), turns)).toBe(-1);
  });

  it('no vale si el turno del corte ya no esta', () => {
    expect(effectiveRecapThrough(entrada(), turns.slice(0, 2))).toBe(-1);
  });
});

describe('los tramos declarados', () => {
  it('dos que se tocan son uno solo, y el motivo dudoso queda en «otro»', () => {
    expect(
      mergeRecapGaps([
        { from: 0, to: 3, why: 'explicito' },
        { from: 4, to: 7, why: 'confuso' },
        { from: 20, to: 21, why: 'otro' },
      ]),
    ).toEqual([
      { from: 0, to: 7, why: 'otro' },
      { from: 20, to: 21, why: 'otro' },
    ]);
  });

  it('cuando sobran, los ultimos se funden en uno en vez de tirarse', () => {
    // el esquema admite veinte. Tirar un tramo seria callarse un hueco, que es
    // exactamente lo contrario de para lo que existen
    const sueltos = Array.from({ length: 25 }, (_unused, index) => ({
      from: index * 10,
      to: index * 10 + 1,
      why: 'explicito' as const,
    }));

    const merged = mergeRecapGaps(sueltos);

    expect(merged).toHaveLength(20);
    expect(merged[19]).toEqual({ from: 190, to: 241, why: 'otro' });
  });
});
