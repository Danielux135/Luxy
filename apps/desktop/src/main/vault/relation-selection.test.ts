// pruebas de la dosificacion, con el reloj y el ancla inyectados.
//
// Son las que deciden si ella suena a persona o a formulario, asi que cada una
// fija UN comportamiento y nada mas. Todo es aritmetica sobre una linea temporal
// escrita a mano: sin boveda, sin disco y sin esperar tres dias a que venza un
// reposo.
import { describe, it, expect } from 'vitest';
import { RELATION_EXTRACTOR_VERSION, type RelationCursor, type RelationNote, type TemporalAnchor } from '@luxy/shared';
import { noteId } from './relation.js';
import { selectPendingForTurn, type PendingSelection } from './relation-selection.js';
import { tokenize } from './turn-index.js';

const CONV_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_C = 'cccccccc-2222-4222-8222-222222222222';
const CONV_NOW = 'eeeeeeee-3333-4333-8333-333333333333';
const CONV_OTRA = 'ffffffff-4444-4444-8444-444444444444';

const NOW = '2026-09-11T21:00:00.000Z';
const ANCHOR: TemporalAnchor = {
  instant: NOW,
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

const CAFES = 'mañana te traigo dos cafés y una tarta de chocolate a la cama';
const MERCADO = 'el sábado vamos juntos al mercado de las flores';
const PLAYA = 'te voy a enseñar la playa de mi pueblo';
const LIBRO = 'te devuelvo el libro de recetas cuando acabe';

/** una mencion que comparte cuatro de las siete raices de la cita de los cafes */
const RECUERDA_CAFES = 'sigo esperando los dos cafés y la tarta de chocolate';

interface FixtureTurn {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  createdAt: string;
  text: string;
}

interface Fixture {
  notes: readonly RelationNote[];
  turns?: readonly FixtureTurn[];
  cursors?: readonly RelationCursor[];
  conversations?: readonly string[];
  /** las que no se han podido leer en esta sesion */
  failed?: readonly string[];
  /** con el instante ya resuelto, como lo pasa el diagnostico */
  withInstants?: boolean;
  current?: Partial<{
    conversationId: string;
    sequence: number;
    text: string;
    oldestRecent: number | null;
  }>;
  now?: string;
}

const turn = (
  conversationId: string,
  sequence: number,
  role: 'user' | 'assistant',
  createdAt: string,
  text: string,
): FixtureTurn => ({ conversationId, sequence, role, createdAt, text });

function cursor(
  conversationId: string,
  through: number,
  refusedVersion: number | null = null,
): RelationCursor {
  return {
    conversationId,
    through,
    throughAt: null,
    version: RELATION_EXTRACTOR_VERSION,
    provider: 'codex',
    model: null,
    at: '2026-09-11T00:00:00.000Z',
    refusedVersion,
    refusedAtTurns: refusedVersion === null ? null : 0,
  };
}

function note(
  over: Partial<RelationNote> & { quote: string; origin: RelationNote['origin'] },
): RelationNote {
  return {
    id: noteId(over.origin, over.quote),
    kind: 'promise',
    by: 'user',
    keywords: [],
    status: 'open',
    closure: null,
    source: 'extractor',
    decidedBy: 'extractor',
    reopenedByDaniel: false,
    extractedBy: 'codex',
    extractorVersion: RELATION_EXTRACTOR_VERSION,
    createdAt: over.origin.at,
    updatedAt: over.origin.at,
    ...over,
  };
}

/**
 * monta la entrada y llama a la seleccion.
 *
 * Los cursores por defecto se ponen al dia —el ultimo turno de cada
 * conversacion—, porque si no la guarda de desfase bloquearia todas las pruebas
 * por un motivo que no es el que se esta midiendo.
 */
function select(fixture: Fixture): PendingSelection {
  const turns = fixture.turns ?? [];
  const texts = new Map(turns.map((item) => [`${item.conversationId}#${item.sequence}`, item.text]));

  const current = {
    conversationId: CONV_NOW,
    sequence: 900,
    text: 'buenas noches, ¿que tal el dia?',
    oldestRecent: null as number | null,
    ...fixture.current,
  };

  const latest = new Map<string, number>();
  for (const item of turns) {
    latest.set(item.conversationId, Math.max(latest.get(item.conversationId) ?? -1, item.sequence));
  }

  return selectPendingForTurn({
    notes: fixture.notes,
    cursors: fixture.cursors ?? [...latest].map(([id, through]) => cursor(id, through)),
    ...(fixture.failed === undefined ? {} : { failed: new Set(fixture.failed) }),
    timeline: turns.map((item) => ({
      conversationId: item.conversationId,
      sequence: item.sequence,
      role: item.role,
      createdAt: item.createdAt,
      stems: new Set(tokenize(item.text)),
      ...(fixture.withInstants === true ? { at: Date.parse(item.createdAt) } : {}),
    })),
    conversations: new Set(
      fixture.conversations ?? [...turns.map((item) => item.conversationId), current.conversationId],
    ),
    turnAt: (ref) => {
      const text = texts.get(`${ref.conversationId}#${ref.sequence}`);
      return text === undefined ? null : { text };
    },
    current,
    anchor: ANCHOR,
    now: fixture.now ?? NOW,
  });
}

// una tarde de conversacion con cuatro promesas, y una sola mencion de ella
const TARDE: FixtureTurn[] = [
  turn(CONV_A, 0, 'user', '2026-09-01T18:00:00.000Z', `${CAFES}, te lo juro`),
  turn(CONV_A, 1, 'assistant', '2026-09-01T18:05:00.000Z', 'no te creo nada, pero me encantaria'),
  turn(CONV_A, 2, 'user', '2026-09-01T18:10:00.000Z', `${MERCADO}, ¿vale?`),
  turn(CONV_A, 3, 'assistant', '2026-09-01T18:15:00.000Z', `${PLAYA} algun dia`),
  turn(CONV_A, 4, 'user', '2026-09-01T18:20:00.000Z', `${LIBRO} de copiarlas`),
  turn(CONV_A, 5, 'assistant', '2026-09-01T18:25:00.000Z', 'tranquilo, no corre prisa'),
  turn(
    CONV_A,
    6,
    'assistant',
    '2026-09-05T12:00:00.000Z',
    'no te preocupes por el libro de recetas, ya me lo devolverás',
  ),
];

const CAFES_NOTE = note({
  quote: CAFES,
  by: 'user',
  origin: { conversationId: CONV_A, sequence: 0, role: 'user', at: '2026-09-01T18:00:00.000Z' },
});
const MERCADO_NOTE = note({
  quote: MERCADO,
  by: 'both',
  kind: 'plan',
  origin: { conversationId: CONV_A, sequence: 2, role: 'user', at: '2026-09-01T18:10:00.000Z' },
});
const PLAYA_NOTE = note({
  quote: PLAYA,
  by: 'character',
  origin: {
    conversationId: CONV_A,
    sequence: 3,
    role: 'assistant',
    at: '2026-09-01T18:15:00.000Z',
  },
});
const LIBRO_NOTE = note({
  quote: LIBRO,
  by: 'user',
  origin: { conversationId: CONV_A, sequence: 4, role: 'user', at: '2026-09-01T18:20:00.000Z' },
});

describe('20. tope de dos y orden de prioridad', () => {
  it('con cuatro disponibles salen dos, y primero la suya mas antigua', () => {
    const result = select({
      notes: [LIBRO_NOTE, PLAYA_NOTE, MERCADO_NOTE, CAFES_NOTE],
      turns: TARDE,
    });

    expect(result.counters.open).toBe(4);
    expect(result.counters.offered).toBe(2);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ by: 'user', quote: CAFES, daysAgo: 10 });
    expect(result.lines[1]).toMatchObject({ by: 'both', quote: MERCADO });
  });

  it('nunca sacada por ella pesa mas que de quien es la promesa', () => {
    const result = select({ notes: [LIBRO_NOTE, PLAYA_NOTE], turns: TARDE });

    // LIBRO es suya y mas antigua, pero ella ya la saco una vez
    expect(result.lines[0]).toMatchObject({ quote: PLAYA, raisedCount: 0 });
    expect(result.lines[1]).toMatchObject({ quote: LIBRO, raisedCount: 1, lastRaisedDaysAgo: 6 });
  });

  it('los hechos de la linea salen del dia civil, no del reloj', () => {
    const result = select({ notes: [CAFES_NOTE], turns: TARDE });
    expect(result.lines[0]).toEqual({
      by: 'user',
      day: '2026-09-01',
      daysAgo: 10,
      quote: CAFES,
      raisedCount: 0,
      lastRaisedDaysAgo: null,
      heMentionedDaysAgo: null,
      touchedNow: false,
    });
  });
});

describe('21. lo que ya esta en los ocho turnos recientes no se ofrece', () => {
  it('el origen dentro de la ventana reciente', () => {
    const result = select({
      notes: [
        note({
          quote: CAFES,
          origin: {
            conversationId: CONV_NOW,
            sequence: 6,
            role: 'user',
            at: '2026-09-11T20:00:00.000Z',
          },
        }),
      ],
      turns: [turn(CONV_NOW, 6, 'user', '2026-09-11T20:00:00.000Z', CAFES)],
      cursors: [cursor(CONV_NOW, 6)],
      current: { sequence: 12, oldestRecent: 4 },
    });

    expect(result.counters.inScene).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('una mencion dentro de la ventana reciente', () => {
    const result = select({
      notes: [CAFES_NOTE],
      turns: [
        ...TARDE,
        turn(CONV_NOW, 8, 'user', '2026-09-11T20:30:00.000Z', RECUERDA_CAFES),
      ],
      cursors: [cursor(CONV_A, 6), cursor(CONV_NOW, 8)],
      current: { sequence: 12, oldestRecent: 4 },
    });

    expect(result.counters.inScene).toBe(1);
    expect(result.lines).toEqual([]);
  });
});

describe('22. reposo de 72 horas despues de que ella la saque', () => {
  const conElla = (createdAt: string): Fixture => ({
    notes: [CAFES_NOTE],
    turns: [...TARDE, turn(CONV_C, 0, 'assistant', createdAt, RECUERDA_CAFES)],
  });

  it('a las 71 horas todavia calla', () => {
    const result = select(conElla('2026-09-08T22:00:00.000Z'));
    expect(result.counters.cooling).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('a las 73 vuelve a estar disponible, y se dice cuantas veces la saco', () => {
    const result = select(conElla('2026-09-08T20:00:00.000Z'));
    expect(result.counters.cooling).toBe(0);
    expect(result.lines[0]).toMatchObject({ raisedCount: 1, lastRaisedDaysAgo: 3 });
  });
});

describe('23. tanda de seis mensajes y espera de 48 horas', () => {
  const ORIGEN = turn(CONV_A, 0, 'user', '2026-09-01T10:00:00.000Z', `${CAFES}, te lo juro`);
  const NOTA = note({
    quote: CAFES,
    origin: { conversationId: CONV_A, sequence: 0, role: 'user', at: '2026-09-01T10:00:00.000Z' },
  });
  const charla = (horas: readonly string[]): FixtureTurn[] =>
    horas.map((createdAt, index) =>
      turn(CONV_C, index * 2, 'user', createdAt, 'hola, ¿que tal la mañana?'),
    );

  it('el sexto mensaje todavia la lleva', () => {
    const result = select({
      notes: [NOTA],
      turns: [
        ORIGEN,
        ...charla([
          '2026-09-02T10:00:00.000Z',
          '2026-09-02T11:00:00.000Z',
          '2026-09-02T12:00:00.000Z',
          '2026-09-02T13:00:00.000Z',
        ]),
      ],
      now: '2026-09-02T14:00:00.000Z',
    });

    expect(result.lines).toHaveLength(1);
  });

  it('el septimo, dentro de las 48 horas, ya no', () => {
    const result = select({
      notes: [NOTA],
      turns: [
        ORIGEN,
        ...charla([
          '2026-09-02T10:00:00.000Z',
          '2026-09-02T11:00:00.000Z',
          '2026-09-02T12:00:00.000Z',
          '2026-09-02T13:00:00.000Z',
          '2026-09-02T14:00:00.000Z',
        ]),
      ],
      now: '2026-09-02T15:00:00.000Z',
    });

    expect(result.counters.waiting).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('pasadas las 48 horas empieza otra tanda', () => {
    const result = select({
      notes: [NOTA],
      turns: [
        ORIGEN,
        ...charla([
          '2026-09-02T10:00:00.000Z',
          '2026-09-02T11:00:00.000Z',
          '2026-09-02T12:00:00.000Z',
          '2026-09-02T13:00:00.000Z',
          '2026-09-02T14:00:00.000Z',
        ]),
      ],
      now: '2026-09-04T15:00:00.000Z',
    });

    expect(result.counters.waiting).toBe(0);
    expect(result.lines).toHaveLength(1);
  });
});

describe('24. tocada: se ofrece aunque descanse, y va la primera', () => {
  it('el la nombra en su mensaje de ahora', () => {
    const result = select({
      notes: [MERCADO_NOTE, CAFES_NOTE],
      turns: [
        ...TARDE,
        // ella la saco hace una hora: sin el mensaje de el, estaria en reposo
        turn(CONV_C, 0, 'assistant', '2026-09-11T20:00:00.000Z', RECUERDA_CAFES),
      ],
      current: { text: 'estoy preparando los dos cafés y la tarta de chocolate' },
    });

    expect(result.counters.touched).toBe(1);
    expect(result.counters.cooling).toBe(0);
    expect(result.lines[0]).toMatchObject({ quote: CAFES, touchedNow: true });
    expect(result.lines[1]).toMatchObject({ quote: MERCADO, touchedNow: false });
  });
});

describe('25. las keywords solo la callan', () => {
  const CON_KEYWORDS = note({
    quote: CAFES,
    keywords: ['desayuno', 'bandeja'],
    origin: { conversationId: CONV_A, sequence: 0, role: 'user', at: '2026-09-01T18:00:00.000Z' },
  });
  const POR_KEYWORDS = 'mañana te subo el desayuno en una bandeja';

  it('una mencion suya solo por keywords abre el reposo', () => {
    const result = select({
      notes: [CON_KEYWORDS],
      turns: [...TARDE, turn(CONV_C, 0, 'assistant', '2026-09-11T20:00:00.000Z', POR_KEYWORDS)],
    });

    expect(result.counters.cooling).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('pero no cuenta como vez que la saco', () => {
    const result = select({
      notes: [CON_KEYWORDS],
      turns: [...TARDE, turn(CONV_C, 0, 'assistant', '2026-09-07T12:00:00.000Z', POR_KEYWORDS)],
    });

    expect(result.lines[0]).toMatchObject({ raisedCount: 0, lastRaisedDaysAgo: null });
  });

  it('ni marcan como tocado el mensaje de ahora', () => {
    const result = select({
      notes: [CON_KEYWORDS],
      turns: TARDE,
      current: { text: POR_KEYWORDS },
    });

    expect(result.counters.touched).toBe(0);
    expect(result.lines[0]).toMatchObject({ touchedNow: false });
  });
});

describe('26. desfase: solo el hueco posterior al origen de ESA nota', () => {
  const VIEJA = note({
    quote: CAFES,
    origin: { conversationId: CONV_A, sequence: 0, role: 'user', at: '2026-09-01T18:00:00.000Z' },
  });
  const NUEVA = note({
    quote: MERCADO,
    by: 'both',
    kind: 'plan',
    origin: { conversationId: CONV_A, sequence: 2, role: 'user', at: '2026-09-06T18:00:00.000Z' },
  });
  const HUECO = turn(CONV_C, 5, 'user', '2026-09-03T10:00:00.000Z', 'te cuento lo del trabajo');
  const CON_HUECO = [
    turn(CONV_A, 0, 'user', '2026-09-01T18:00:00.000Z', `${CAFES}, te lo juro`),
    turn(CONV_A, 2, 'user', '2026-09-06T18:00:00.000Z', `${MERCADO}, ¿vale?`),
    HUECO,
  ];

  it('bloquea la nota anterior al hueco', () => {
    const result = select({
      notes: [VIEJA],
      turns: CON_HUECO,
      cursors: [cursor(CONV_A, 2), cursor(CONV_C, 2)],
    });

    expect(result.counters.blockedStale).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('no bloquea la posterior', () => {
    const result = select({
      notes: [NUEVA],
      turns: CON_HUECO,
      cursors: [cursor(CONV_A, 2), cursor(CONV_C, 2)],
    });

    expect(result.counters.blockedStale).toBe(0);
    expect(result.lines).toHaveLength(1);
  });

  it('una conversacion con negativa persistida no bloquea nada', () => {
    const result = select({
      notes: [VIEJA],
      turns: CON_HUECO,
      cursors: [cursor(CONV_A, 2), cursor(CONV_C, 2, RELATION_EXTRACTOR_VERSION)],
    });

    expect(result.counters.blockedStale).toBe(0);
    expect(result.lines).toHaveLength(1);
  });

  it('ni una que no se ha podido leer en esta sesion', () => {
    // un CLI que no arranca, un timeout, la boveda cerrada a mitad: no escriben
    // cursor y esa conversacion no se reintenta hoy. Contar su hueco dejaba al
    // personaje mudo sobre TODO lo demas durante toda la sesion, sin mas rastro
    // que un contador en otra pantalla
    const result = select({
      notes: [VIEJA],
      turns: CON_HUECO,
      cursors: [cursor(CONV_A, 2), cursor(CONV_C, 2)],
      failed: [CONV_C],
    });

    expect(result.counters.blockedStale).toBe(0);
    expect(result.lines).toHaveLength(1);
  });

  it('y un hueco de otro personaje tampoco', () => {
    const result = select({
      notes: [VIEJA],
      turns: [...CON_HUECO, turn(CONV_OTRA, 9, 'user', '2026-09-04T10:00:00.000Z', 'otra cosa')],
      cursors: [cursor(CONV_A, 2), cursor(CONV_C, 2, RELATION_EXTRACTOR_VERSION)],
      conversations: [CONV_A, CONV_C, CONV_NOW],
    });

    expect(result.counters.blockedStale).toBe(0);
    expect(result.lines).toHaveLength(1);
  });
});

describe('27. el alcance es del personaje, y lo excluido no existe', () => {
  it('un hilo sin personaje no hereda las promesas de Lia', () => {
    const result = select({
      notes: [CAFES_NOTE],
      turns: TARDE,
      // `conversationsFor(null)` son los hilos SIN personaje, no todos
      conversations: [CONV_NOW],
    });

    expect(result.counters.open).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('una conversacion excluida del banco de recuerdos no ofrece las suyas', () => {
    const result = select({
      notes: [CAFES_NOTE, MERCADO_NOTE],
      turns: TARDE,
      conversations: [CONV_C, CONV_NOW],
    });

    expect(result.counters.open).toBe(0);
    expect(result.lines).toEqual([]);
  });
});

describe('28. una cita que ya no consta no se ofrece', () => {
  it('el turno se retiro', () => {
    const result = select({
      notes: [CAFES_NOTE],
      turns: TARDE.filter((item) => item.sequence !== 0),
      cursors: [cursor(CONV_A, 6)],
      conversations: [CONV_A, CONV_NOW],
    });

    expect(result.counters.quoteBroken).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('el numero de turno se reutilizo para otro texto', () => {
    const result = select({
      notes: [CAFES_NOTE],
      turns: [
        turn(CONV_A, 0, 'user', '2026-09-01T18:00:00.000Z', 'perdona, borra lo de antes'),
        ...TARDE.slice(1),
      ],
    });

    expect(result.counters.quoteBroken).toBe(1);
    expect(result.lines).toEqual([]);
  });
});

describe('29. dormida: mas de 30 dias y 14 en silencio', () => {
  const TARDISIMO = '2026-10-15T21:00:00.000Z';

  it('se calla sola', () => {
    const result = select({ notes: [CAFES_NOTE], turns: TARDE, now: TARDISIMO });
    expect(result.counters.dormant).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('salvo que el la nombre ahora', () => {
    const result = select({
      notes: [CAFES_NOTE],
      turns: TARDE,
      now: TARDISIMO,
      current: { text: 'estoy preparando los dos cafés y la tarta de chocolate' },
    });

    expect(result.counters.dormant).toBe(0);
    expect(result.lines[0]).toMatchObject({ touchedNow: true });
  });

  it('y no se duerme si alguno la nombro hace poco', () => {
    const result = select({
      notes: [CAFES_NOTE],
      turns: [...TARDE, turn(CONV_C, 0, 'user', '2026-10-10T12:00:00.000Z', RECUERDA_CAFES)],
      now: TARDISIMO,
    });

    expect(result.counters.dormant).toBe(0);
    expect(result.lines[0]).toMatchObject({ heMentionedDaysAgo: 5 });
  });
});

describe('30. en la misma conversacion, antes de seis horas no es otra vez', () => {
  const HOY = note({
    quote: CAFES,
    origin: { conversationId: CONV_A, sequence: 0, role: 'user', at: '2026-09-11T13:00:00.000Z' },
  });
  const origen = turn(CONV_A, 0, 'user', '2026-09-11T13:00:00.000Z', `${CAFES}, te lo juro`);

  it('tres horas despues sigue siendo el mismo rato', () => {
    const result = select({
      notes: [HOY],
      turns: [origen, turn(CONV_A, 1, 'assistant', '2026-09-11T16:00:00.000Z', RECUERDA_CAFES)],
    });

    expect(result.counters.cooling).toBe(0);
    expect(result.lines[0]).toMatchObject({ raisedCount: 0, lastRaisedDaysAgo: null });
  });

  it('siete horas despues ya es sacarla otra vez', () => {
    const result = select({
      notes: [HOY],
      turns: [origen, turn(CONV_A, 1, 'assistant', '2026-09-11T20:00:00.000Z', RECUERDA_CAFES)],
    });

    expect(result.counters.cooling).toBe(1);
    expect(result.lines).toEqual([]);
  });
});

describe('30 ter. en la conversacion de AHORA, el mismo rato si la calla', () => {
  // una promesa de hace un rato, en este mismo hilo: el hueco de seis horas la
  // sacaba de las menciones y con eso cegaba las dos cosas para las que existe
  // el filtro de escena —si ella ya lo tiene delante y si acaba de decirlo—. El
  // resultado era ofrecerle, como asunto de otra conversacion, algo dicho veinte
  // minutos antes, y volver a ofrecerselo el turno siguiente a que lo sacara
  const PROMETIDA_AL_4 = '2026-09-11T12:20:00.000Z';
  const HILO = note({
    quote: CAFES,
    origin: { conversationId: CONV_NOW, sequence: 4, role: 'user', at: PROMETIDA_AL_4 },
  });
  const origen = turn(CONV_NOW, 4, 'user', PROMETIDA_AL_4, `${CAFES}, te lo juro`);
  const relleno = (sequence: number, minuto: number): FixtureTurn =>
    turn(
      CONV_NOW,
      sequence,
      sequence % 2 === 0 ? 'user' : 'assistant',
      `2026-09-11T12:${String(minuto).padStart(2, '0')}:00.000Z`,
      'seguimos con otra cosa',
    );
  const resto = [relleno(8, 40), relleno(9, 45), relleno(10, 50), relleno(11, 55)];
  const ahora = { conversationId: CONV_NOW, sequence: 12, oldestRecent: 6 };

  it('si ella la comento en el mismo rato, descansa aunque quede fuera de los recientes', () => {
    const result = select({
      notes: [HILO],
      turns: [
        origen,
        turn(CONV_NOW, 5, 'assistant', '2026-09-11T12:25:00.000Z', RECUERDA_CAFES),
        ...resto,
      ],
      current: ahora,
    });

    expect(result.counters.cooling).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('y si ese comentario sigue en los ocho recientes, es que ya lo tiene delante', () => {
    const result = select({
      notes: [HILO],
      turns: [
        origen,
        turn(CONV_NOW, 7, 'assistant', '2026-09-11T12:35:00.000Z', RECUERDA_CAFES),
        ...resto,
      ],
      current: ahora,
    });

    expect(result.counters.inScene).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('pero sigue sin contar como haberla sacado: eso no ha pasado', () => {
    // si nadie la comenta, la promesa vieja del hilo se ofrece igual, y su linea
    // dice la verdad: ella no la ha sacado nunca
    const result = select({
      notes: [HILO],
      turns: [origen, ...resto],
      current: ahora,
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ raisedCount: 0, lastRaisedDaysAgo: null });
  });
});

describe('30 quater. el instante ya resuelto no cambia nada', () => {
  it('la linea temporal con «at» hecho da exactamente lo mismo', () => {
    // el diagnostico lo pasa ya calculado para no volver a leer 137 veces las
    // mismas fechas; si eso cambiara una sola cifra, la simulacion mediria otra
    // cosa que el turno real
    const fixture: Fixture = { notes: [LIBRO_NOTE, PLAYA_NOTE, MERCADO_NOTE], turns: TARDE };
    expect(select({ ...fixture, withInstants: true })).toEqual(select(fixture));
  });
});

describe('30 bis. lo dicho antes de la promesa no es haberla sacado', () => {
  const RECIEN = note({
    quote: CAFES,
    by: 'user',
    origin: { conversationId: CONV_A, sequence: 10, role: 'user', at: '2026-09-11T13:00:00.000Z' },
  });
  const ORIGEN = turn(CONV_A, 10, 'user', '2026-09-11T13:00:00.000Z', `${CAFES}, te lo juro`);

  it('ni ella la saco ni el volvio a nombrarlo antes de que existiera', () => {
    const result = select({
      notes: [RECIEN],
      turns: [
        // el tema venia de lejos: se hablo de cafes y tarta una semana antes y
        // tres horas antes de prometer nada
        turn(CONV_C, 0, 'user', '2026-09-04T12:00:00.000Z', RECUERDA_CAFES),
        turn(CONV_C, 1, 'assistant', '2026-09-11T10:00:00.000Z', RECUERDA_CAFES),
        ORIGEN,
      ],
    });

    expect(result.counters.cooling).toBe(0);
    expect(result.counters.offered).toBe(1);
    expect(result.lines[0]).toMatchObject({
      quote: CAFES,
      daysAgo: 0,
      raisedCount: 0,
      lastRaisedDaysAgo: null,
      heMentionedDaysAgo: null,
    });
  });

  it('y por eso sigue contando como nunca sacada, que es lo que le da el sitio', () => {
    const result = select({
      notes: [RECIEN, MERCADO_NOTE, PLAYA_NOTE],
      turns: [
        ...TARDE,
        turn(CONV_C, 0, 'assistant', '2026-09-11T10:00:00.000Z', RECUERDA_CAFES),
        ORIGEN,
      ],
    });

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ by: 'user', quote: CAFES, raisedCount: 0 });
    expect(result.lines[1]).toMatchObject({ by: 'both', quote: MERCADO });
  });
});
