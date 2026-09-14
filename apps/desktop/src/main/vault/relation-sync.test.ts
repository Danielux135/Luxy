// pruebas de la pasada que apunta los pendientes.
//
// Todo simulado: ni CLI, ni red, ni tokens. Lo que se comprueba aqui es
// exactamente lo que no se puede comprobar ejecutando Codex —que nunca se le
// manda el trabajo a una API de pago, que el cursor solo avanza cuando la
// respuesta vale y que una negativa no se lleva por delante a las demas
// conversaciones—, mas las dos reglas que protegen el turno del usuario: no leer
// un mensaje sin respuesta y no tocar una conversacion mientras se le contesta.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  RELATION_CLOSE,
  RELATION_EXTRACTOR_VERSION,
  RELATION_OPEN,
  relationCountersSchema,
  type AuxiliaryChoice,
  type TemporalAnchor,
} from '@luxy/shared';
import type { PrivateConversationSummary, PrivateTurnView } from './conversation-store.js';
import type { RelationMutator, RelationSnapshot, RelationState } from './relation-store.js';
import type { VaultService } from './vault-service.js';
import {
  RELATION_IDLE_MS,
  RelationSync,
  createAuxiliaryLane,
  type AuxiliaryController,
  type RelationSyncDeps,
} from './relation-sync.js';

const CONV_VIEJA = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_NUEVA = 'bbbbbbbb-2222-4222-8222-222222222222';
const LIA = 'lia';

const CAFES = 'mañana te traigo dos cafés y una tarta de chocolate a la cama';

const ANCHOR: TemporalAnchor = {
  instant: '2026-09-14T10:00:00.000Z',
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

/** una respuesta del extractor con el bloque tal y como se le pide */
function bloque(body: { new?: unknown[]; closed?: unknown[] }): string {
  return `${RELATION_OPEN}${JSON.stringify({
    new: body.new ?? [],
    closed: body.closed ?? [],
  })}${RELATION_CLOSE}`;
}

/**
 * una conversacion de turnos alternos.
 *
 * Los pares son del usuario y los impares del personaje, que es como quedan al
 * escribirse: un mensaje, una respuesta.
 */
function conversacion(count: number, textos: Record<number, string> = {}): PrivateTurnView[] {
  return Array.from({ length: count }, (_unused, index) => ({
    sequence: index,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text: textos[index] ?? `turno numero ${index} sin nada que apuntar`,
    title: 'titulo',
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
  }));
}

/** el almacen de pendientes, en memoria y con la misma forma que el de verdad */
class FakeRelations {
  state: RelationState = {
    notes: [],
    cursors: [],
    counters: relationCountersSchema.parse({}),
  };

  async read(_vault: VaultService): Promise<RelationSnapshot> {
    return { ...this.state, droppedOnRead: 0, unreadable: { notes: [], cursors: [] } };
  }

  async apply(_vault: VaultService, mutator: RelationMutator): Promise<RelationState> {
    const next = await mutator(await this.read(_vault));
    this.state = { notes: next.notes, cursors: next.cursors, counters: next.counters };
    return this.state;
  }
}

interface Montaje {
  sync: RelationSync;
  relations: FakeRelations;
  calls: { provider: string; model: string | null; prompt: string; kind?: string }[];
  sending: Set<string>;
  unlocked: { value: boolean };
  /** cuantas llamadas al CLI coincidieron dentro: el carril lo deja en uno */
  concurrency: { max: number };
}

interface MontajeOptions {
  /** los turnos de cada conversacion, en el orden en que se listan */
  conversations: { conversationId: string; characterId: string | null; turns: PrivateTurnView[] }[];
  /** que contesta el CLI en cada llamada, por orden; la ultima se repite */
  replies: string[];
  auxiliary?: AuxiliaryChoice | null;
  excluded?: Set<string>;
  /** para bloquear la llamada y poder mirar el carril */
  gate?: Promise<void>;
  onCall?: () => void;
  /** conversaciones cuyo descifrado revienta: pasa FUERA del try de la llamada */
  unreadable?: Set<string>;
}

function montar(options: MontajeOptions): Montaje {
  const relations = new FakeRelations();
  const calls: Montaje['calls'] = [];
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
      options.onCall?.();
      dentro += 1;
      concurrency.max = Math.max(concurrency.max, dentro);
      try {
        if (options.gate !== undefined) await options.gate;
        const reply =
          options.replies[calls.length - 1] ?? options.replies[options.replies.length - 1] ?? '';
        return { outcome: 'completed', text: reply, error: null, executedModel: 'codex-cli' };
      } finally {
        dentro -= 1;
      }
    },
  };

  const deps: RelationSyncDeps = {
    vault: { isUnlocked: () => unlocked.value } as unknown as VaultService,
    conversations: {
      async list(): Promise<PrivateConversationSummary[]> {
        return options.conversations.map((each) => ({
          conversationId: each.conversationId,
          title: 'titulo',
          turns: each.turns.length,
          updatedAt: each.turns[each.turns.length - 1]?.createdAt ?? ANCHOR.instant,
          characterId: each.characterId,
        }));
      },
      async read(_vault, conversationId): Promise<PrivateTurnView[]> {
        if (options.unreadable?.has(conversationId) === true) {
          throw new Error('no se ha podido descifrar un turno de esta conversacion');
        }
        return byId.get(conversationId)?.turns ?? [];
      },
    },
    relations,
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
    log: () => undefined,
  };

  return { sync: new RelationSync(deps), relations, calls, sending, unlocked, concurrency };
}

/** una conversacion corta donde el usuario promete algo en el turno 2 */
function conPromesa(): PrivateTurnView[] {
  return conversacion(4, { 2: `pues nada, ${CAFES}, que te lo has ganado` });
}

const PROMESA = bloque({
  new: [
    {
      turn: 2,
      by: 'user',
      kind: 'promise',
      quote: CAFES,
      keywords: ['cafes', 'tarta'],
    },
  ],
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a quien se le manda el trabajo de fondo', () => {
  it('NUNCA a una API de pago, aunque la preferencia guardada diga eso', async () => {
    // un archivo de preferencias tocado a mano: el esquema no lo admite, pero
    // aqui se comprueba que aunque colara no se gastaria una llamada de pago
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
      auxiliary: { provider: 'deepseek', model: 'deepseek-chat' } as unknown as AuxiliaryChoice,
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(1);
    expect(montaje.calls[0]!.provider).toBe('codex');
    // y su modelo se descarta con el: no es de ninguno de los dos CLI
    expect(montaje.calls[0]!.model).toBeNull();
    // catalogar y apuntar son tareas sobre un texto: no encarnan a nadie
    expect(montaje.calls[0]!.kind).toBe('technical');
  });

  it('respeta el CLI elegido en el panel', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
      auxiliary: { provider: 'claude', model: 'sonnet' },
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls[0]).toMatchObject({ provider: 'claude', model: 'sonnet' });
  });
});

describe('el cursor', () => {
  it('avanza y guarda la nota cuando la respuesta trae el bloque', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result).toMatchObject({ reviewed: 1, notes: 1, refused: 0, pending: 0 });
    const nota = montaje.relations.state.notes[0]!;
    expect(nota.quote).toBe(CAFES);
    expect(nota.by).toBe('user');
    expect(nota.status).toBe('open');
    expect(nota.origin).toMatchObject({ conversationId: CONV_VIEJA, sequence: 2, role: 'user' });
    // quien la reviso, que es lo que despues se enseña como «revisado con...»
    expect(nota.extractedBy).toBe('codex-cli');

    const cursor = montaje.relations.state.cursors[0]!;
    expect(cursor).toMatchObject({
      conversationId: CONV_VIEJA,
      through: 3,
      version: RELATION_EXTRACTOR_VERSION,
      provider: 'codex',
      refusedVersion: null,
    });
    expect(cursor.throughAt).toBe(conPromesa()[3]!.createdAt);
  });

  it('NO avanza con una negativa, y la negativa se guarda', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: ['no puedo ayudarte con esta conversacion'],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(result).toMatchObject({ reviewed: 0, refused: 1, notes: 0 });
    expect(montaje.relations.state.notes).toHaveLength(0);
    expect(montaje.relations.state.cursors[0]).toMatchObject({
      through: -1,
      refusedVersion: RELATION_EXTRACTOR_VERSION,
      refusedAtTurns: 4,
    });
    expect(montaje.relations.state.counters.refused).toBe(1);

    // y no se reintenta sola mientras la conversacion no crezca: cada intento
    // cuesta el arranque del CLI y el resultado va a ser el mismo
    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(1);
  });

  it('no vuelve a mandar una conversacion que ya esta al dia', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    const segunda = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(1);
    expect(segunda).toMatchObject({ reviewed: 0, pending: 0 });
    expect(montaje.relations.state.notes).toHaveLength(1);
  });
});

describe('lo que no se lee', () => {
  it('un mensaje del usuario sin respuesta se queda fuera de la ventana', async () => {
    // cinco turnos: el ultimo es suyo y nadie le ha contestado todavia
    const turns = conversacion(5, { 4: 'y no te olvides de lo que me debes' });
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns }],
      replies: [bloque({})],
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    const prompt = montaje.calls[0]!.prompt;
    expect(prompt).toContain('[3] Personaje');
    // ese turno puede retirarse y su numero reutilizarse: darlo por revisado
    // perderia lo que de verdad se diga despues
    expect(prompt).not.toContain('y no te olvides de lo que me debes');
    expect(montaje.relations.state.cursors[0]).toMatchObject({ through: 3 });
  });

  it('no toca una conversacion mientras se le esta contestando', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
    });
    montaje.sending.add(CONV_VIEJA);

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(0);
    expect(result).toMatchObject({ reviewed: 0 });
  });

  it('no toca lo excluido del banco de recuerdos', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
      excluded: new Set([CONV_VIEJA]),
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(0);
  });

  it('con la boveda cerrada no lee nada', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
    });
    montaje.unlocked.value = false;

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(0);
  });
});

describe('las ventanas', () => {
  it('son de 40 turnos, y la siguiente lleva 4 de contexto marcado', async () => {
    const turns = conversacion(100);
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns }],
      replies: [bloque({})],
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    const primera = montaje.calls[0]!.prompt;
    // la primera no tiene nada revisado detras, asi que no hay contexto
    expect(primera).not.toContain('CONTEXTO YA REVISADO');
    expect(primera).toContain('[0] Usuario');
    expect(primera).toContain('[39] Personaje');
    expect(primera).not.toContain('[40] Usuario');
    expect(montaje.relations.state.cursors[0]).toMatchObject({ through: 39 });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    const segunda = montaje.calls[1]!.prompt;
    expect(segunda).toContain('CONTEXTO YA REVISADO');
    // los cuatro de antes, marcados; la parte nueva empieza donde quedo
    expect(segunda).toContain('[36] Usuario');
    expect(segunda).toContain('PARTE NUEVA (DATOS):\n[40] Usuario');
    expect(segunda).toContain('[79] Personaje');
    expect(montaje.relations.state.cursors[0]).toMatchObject({ through: 79 });
    // el progreso se conserva ventana a ventana: no hay que acabarla de una vez
    expect(montaje.calls).toHaveLength(2);
  });
});

describe('la pasada sobre lo ya hablado', () => {
  const dosConversaciones = (): MontajeOptions['conversations'] => [
    // la nueva se lista primero, como haria el almacen: ordena por actividad
    {
      conversationId: CONV_NUEVA,
      characterId: LIA,
      turns: conversacion(4).map((turn) => ({
        ...turn,
        createdAt: new Date(Date.UTC(2026, 8, 10, 0, turn.sequence)).toISOString(),
      })),
    },
    { conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() },
  ];

  it('va en orden cronologico: primero la mas antigua', async () => {
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [bloque({})],
    });

    // asi, al llegar a la del dia 10 ya existe la promesa del dia 1 y se puede
    // cerrar. Al reves no habria nada que cerrar
    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 1 });

    expect(montaje.calls).toHaveLength(1);
    expect(montaje.relations.state.cursors[0]!.conversationId).toBe(CONV_VIEJA);
    expect(result.pending).toBe(1);
  });

  it('una negativa no para las demas', async () => {
    const montaje = montar({
      conversations: dosConversaciones(),
      // la vieja se niega; la nueva contesta bien
      replies: ['lo siento, no puedo', bloque({})],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });

    expect(montaje.calls).toHaveLength(2);
    expect(result).toMatchObject({ reviewed: 1, refused: 1 });
    const nueva = montaje.relations.state.cursors.find(
      (cursor) => cursor.conversationId === CONV_NUEVA,
    );
    expect(nueva).toMatchObject({ through: 3, refusedVersion: null });
  });

  it('un fallo del CLI se cuenta y no tira la tanda', async () => {
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [bloque({})],
      onCall: () => {
        if (montaje.calls.length === 1) throw new Error('el agente no respondio a tiempo');
      },
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.conversationId).toBe(CONV_VIEJA);
    expect(result.reviewed).toBe(1);
  });

  it('una conversacion que no se puede descifrar tampoco tira la tanda', async () => {
    // esto pasa FUERA del try de la llamada al CLI: antes salia de la tanda
    // entera, la conversacion no quedaba marcada y, como el orden es
    // cronologico, volvia a ser la primera candidata en cada disparo
    const montaje = montar({
      conversations: dosConversaciones(),
      replies: [bloque({})],
      unreadable: new Set([CONV_VIEJA]),
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.conversationId).toBe(CONV_VIEJA);
    // la otra si se reviso: el fallo se quedo en la suya
    expect(result.reviewed).toBe(1);
    expect(montaje.relations.state.cursors[0]!.conversationId).toBe(CONV_NUEVA);
    expect(montaje.sync.failedThisSession).toBe(1);
    expect([...montaje.sync.failedConversations]).toEqual([CONV_VIEJA]);

    // y no se reintenta sola: falla siempre igual, asi que repetirla solo
    // impediria avanzar
    const segunda = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 2 });
    expect(segunda.failed).toHaveLength(0);
    expect(montaje.calls).toHaveLength(1);
  });

  it('lo que queda se cuenta AL TERMINAR, no restando las intentadas', async () => {
    // una conversacion de mas de 40 turnos gasta una ventana por tanda y sigue
    // teniendo cola: restar las intentadas daba cero con trabajo sin hacer, el
    // panel cortaba el bucle y esos turnos bloqueaban por desfase todo lo demas
    const montaje = montar({
      conversations: [
        { conversationId: CONV_VIEJA, characterId: LIA, turns: conversacion(100) },
        {
          conversationId: CONV_NUEVA,
          characterId: LIA,
          turns: conversacion(4).map((turn) => ({
            ...turn,
            createdAt: new Date(Date.UTC(2026, 8, 10, 0, turn.sequence)).toISOString(),
          })),
        },
      ],
      replies: [bloque({})],
    });

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', limit: 3 });

    expect(result.reviewed).toBe(2);
    expect(montaje.relations.state.cursors).toHaveLength(2);
    // la larga se quedo en su primera ventana: sigue pendiente
    expect(result.pending).toBe(1);
  });
});

describe('cambiar de CLI cuando uno se niega', () => {
  it('la negativa es de ESE CLI: con el otro se vuelve a intentar', async () => {
    const opciones: MontajeOptions = {
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: ['lo siento, no puedo ayudarte con esto', PROMESA],
      auxiliary: { provider: 'codex', model: null },
    };
    const montaje = montar(opciones);

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.relations.state.cursors[0]).toMatchObject({
      provider: 'codex',
      refusedVersion: RELATION_EXTRACTOR_VERSION,
    });

    // el mismo CLI no la reintenta: volveria a negarse
    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(1);

    // pero el otro no ha dicho nada todavia, y el aviso del panel promete justo
    // esto: «cambia de CLI y vuelve a pulsar»
    opciones.auxiliary = { provider: 'claude', model: null };
    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(2);
    expect(montaje.calls[1]!.provider).toBe('claude');
    expect(result).toMatchObject({ reviewed: 1, notes: 1 });
    expect(montaje.relations.state.cursors[0]).toMatchObject({
      provider: 'claude',
      through: 3,
      refusedVersion: null,
    });
  });

  it('y el boton puede reintentar con el mismo, porque lo pide Daniel', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: ['lo siento, no puedo ayudarte con esto', PROMESA],
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(1);

    const result = await montaje.sync.runOnce({ projectAlias: 'luxy', force: true });

    expect(montaje.calls).toHaveLength(2);
    expect(result).toMatchObject({ reviewed: 1, notes: 1 });
  });

  it('un fallo tampoco se hereda de un CLI al otro', async () => {
    const opciones: MontajeOptions = {
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
      auxiliary: { provider: 'codex', model: null },
      onCall: () => {
        if (montaje.calls.length === 1) throw new Error('spawn codex ENOENT');
      },
    };
    const montaje = montar(opciones);

    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    await montaje.sync.runOnce({ projectAlias: 'luxy' });
    expect(montaje.calls).toHaveLength(1);

    opciones.auxiliary = { provider: 'claude', model: null };
    const result = await montaje.sync.runOnce({ projectAlias: 'luxy' });

    expect(montaje.calls).toHaveLength(2);
    expect(result.reviewed).toBe(1);
  });
});

describe('cuanto se le enseña de cada turno', () => {
  it('una ventana que cabe entera va entera, y consta que no se recorto nada', async () => {
    // el tope del catalogo son 1.400 caracteres: dejaba unos 700 de principio y
    // 700 de final de cada turno y tiraba el centro. Para una escena da igual
    // —se abre al principio y se cierra al final—, pero una promesa dicha en
    // mitad de una respuesta larga caia en el agujero Y el cursor avanzaba igual
    const medio = `${'bla '.repeat(200)}${CAFES}${' bla'.repeat(200)}`;
    const turns = conversacion(16, { 2: medio });
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns }],
      replies: [bloque({})],
    });

    await montaje.sync.runOnce({ projectAlias: 'luxy' });

    // la marca sale tambien en las instrucciones, asi que se mira SU linea
    const linea = montaje.calls[0]!.prompt.split('\n').find((each) => each.startsWith('[2] '));
    expect(linea).not.toContain('[…recorte…]');
    expect(linea).toContain(CAFES);
    expect(montaje.relations.state.counters.clipped).toBe(0);
  });
});

describe('el carril compartido con el catalogo', () => {
  it('nunca deja dos llamadas a la vez', async () => {
    let abrir = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      abrir = resolve;
    });

    const montaje = montar({
      conversations: [
        { conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() },
        { conversationId: CONV_NUEVA, characterId: LIA, turns: conversacion(4) },
      ],
      replies: [bloque({})],
      gate,
    });

    const primera = montaje.sync.runOnce({ projectAlias: 'luxy', limit: 1 });
    const segunda = montaje.sync.runOnce({ projectAlias: 'luxy', limit: 1 });
    abrir();
    await Promise.all([primera, segunda]);

    // dos CLI a la vez no solo doblan la memoria: el segundo leeria un almacen
    // que el primero esta a punto de reescribir
    expect(montaje.calls).toHaveLength(2);
    expect(montaje.concurrency.max).toBe(1);
  });
});

describe('los disparos despues de un turno', () => {
  it('con cuatro turnos por detras, la mira ya', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
    });

    await montaje.sync.afterTurn({
      conversationId: CONV_VIEJA,
      projectAlias: 'luxy',
      wroteReply: true,
      firstTurn: false,
    });

    expect(montaje.calls).toHaveLength(1);
    montaje.sync.cancel();
  });

  it('con dos, espera: asi sale media llamada por turno', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conversacion(2) }],
      replies: [bloque({})],
    });

    await montaje.sync.afterTurn({
      conversationId: CONV_VIEJA,
      projectAlias: 'luxy',
      wroteReply: true,
      firstTurn: false,
    });

    expect(montaje.calls).toHaveLength(0);
    montaje.sync.cancel();
  });

  it('sin respuesta escrita no hace nada', async () => {
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conPromesa() }],
      replies: [PROMESA],
    });

    await montaje.sync.afterTurn({
      conversationId: CONV_VIEJA,
      projectAlias: 'luxy',
      wroteReply: false,
      firstTurn: false,
    });

    expect(montaje.calls).toHaveLength(0);
  });

  it('a los tres minutos de silencio repasa lo que quedo a medias', async () => {
    vi.useFakeTimers();
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conversacion(2) }],
      replies: [bloque({})],
    });

    await montaje.sync.afterTurn({
      conversationId: CONV_VIEJA,
      projectAlias: 'luxy',
      wroteReply: true,
      firstTurn: false,
    });
    expect(montaje.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(RELATION_IDLE_MS);
    expect(montaje.calls).toHaveLength(1);
  });

  it('cerrar la boveda cancela ese temporizador', async () => {
    vi.useFakeTimers();
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conversacion(2) }],
      replies: [bloque({})],
    });

    await montaje.sync.afterTurn({
      conversationId: CONV_VIEJA,
      projectAlias: 'luxy',
      wroteReply: true,
      firstTurn: false,
    });
    // es lo que hace `vault.onLock`: sin llave no se puede sellar nada
    montaje.sync.cancel();

    await vi.advanceTimersByTimeAsync(RELATION_IDLE_MS * 2);
    expect(montaje.calls).toHaveLength(0);
  });

  it('con la boveda cerrada, el temporizador que salte no lee nada', async () => {
    vi.useFakeTimers();
    const montaje = montar({
      conversations: [{ conversationId: CONV_VIEJA, characterId: LIA, turns: conversacion(2) }],
      replies: [bloque({})],
    });

    await montaje.sync.afterTurn({
      conversationId: CONV_VIEJA,
      projectAlias: 'luxy',
      wroteReply: true,
      firstTurn: false,
    });
    montaje.unlocked.value = false;

    await vi.advanceTimersByTimeAsync(RELATION_IDLE_MS);
    expect(montaje.calls).toHaveLength(0);
  });
});
