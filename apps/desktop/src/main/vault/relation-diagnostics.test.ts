// pruebas del diagnostico de los pendientes, sobre datos escritos a mano.
//
// Todo es aritmetica: sin boveda, sin disco y sin reloj real. Una boveda de
// juguete con dos conversaciones de Lia, una excluida, un hilo sin personaje y
// una nota huerfana basta para ejercitar los nueve grupos, y hace que cada cifra
// se pueda calcular a mano y comprobar aqui.
//
// La ultima prueba es la que de verdad protege: el resultado entero se serializa
// y no puede contener ni una cita ni un identificador. Este objeto acaba en el
// registro y cruza el IPC.
import { describe, it, expect } from 'vitest';
import {
  RELATION_EXTRACTOR_VERSION,
  relationCountersSchema,
  type RelationCursor,
  type RelationNote,
  type TemporalAnchor,
} from '@luxy/shared';
import { noteId } from './relation.js';
import { diagnoseRelations, type RelationDiagnosticsInput } from './relation-diagnostics.js';
import { tokenize } from './turn-index.js';

// un identificador de verdad: si se colara en el resultado, la prueba de abajo
// lo caza tanto por la cadena como por la forma de uuid
const LIA = 'f0f0f0f0-6666-4666-8666-666666666666';
const CONV_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_B = 'bbbbbbbb-2222-4222-8222-222222222222';
/** excluida del banco de recuerdos: ni se revisa ni se ofrece */
const CONV_X = 'cccccccc-3333-4333-8333-333333333333';
/** un hilo sin personaje: no hereda las promesas de nadie (`D-062`) */
const CONV_N = 'dddddddd-4444-4444-8444-444444444444';
/** la conversacion de la nota huerfana: ya no existe */
const CONV_GONE = 'eeeeeeee-5555-4555-8555-555555555555';

const NOW = '2026-09-11T21:00:00.000Z';
const ANCHOR: TemporalAnchor = {
  instant: NOW,
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

const CAFES = 'mañana te traigo dos cafés y una tarta de chocolate a la cama';
const MERCADO = 'el sábado vamos juntos al mercado de las flores';
const PLAYA = 'te voy a enseñar la playa de mi pueblo';
const COLLAR = 'un collar de perlas de tu abuela';

/** comparte cuatro de las siete raices de la cita de los cafes */
const RECUERDA_CAFES = 'sigo esperando los dos cafés y la tarta de chocolate';

interface FixtureTurn {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  createdAt: string;
  text: string;
}

const turn = (
  conversationId: string,
  sequence: number,
  role: 'user' | 'assistant',
  createdAt: string,
  text: string,
): FixtureTurn => ({ conversationId, sequence, role, createdAt, text });

const TURNS: FixtureTurn[] = [
  turn(CONV_A, 0, 'user', '2026-09-01T18:00:00.000Z', `${CAFES}, te lo juro`),
  turn(CONV_A, 1, 'assistant', '2026-09-01T18:05:00.000Z', 'no te creo nada, pero me encantaria'),
  turn(CONV_A, 2, 'user', '2026-09-01T18:10:00.000Z', `${MERCADO}, ¿vale?`),
  turn(CONV_A, 3, 'assistant', '2026-09-01T18:15:00.000Z', `${PLAYA} algun dia`),
  turn(CONV_N, 0, 'user', '2026-09-02T09:00:00.000Z', 'esto es una prueba sin personaje'),
  turn(CONV_N, 1, 'assistant', '2026-09-02T09:05:00.000Z', 'entendido'),
  turn(CONV_B, 0, 'user', '2026-09-05T10:00:00.000Z', 'buenos dias'),
  turn(CONV_B, 1, 'assistant', '2026-09-05T10:05:00.000Z', RECUERDA_CAFES),
  turn(CONV_B, 2, 'user', '2026-09-05T10:10:00.000Z', 'vale, mañana sin falta'),
  turn(CONV_B, 3, 'assistant', '2026-09-05T10:15:00.000Z', 'eso dijiste'),
];

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
/** cerrada por Daniel, y su prueba se fue con la conversacion que la contenia */
const PLAYA_NOTE = note({
  quote: PLAYA,
  by: 'character',
  status: 'fulfilled',
  decidedBy: 'daniel',
  closure: { how: 'fulfilled', ref: null, at: '2026-09-06T10:00:00.000Z' },
  origin: {
    conversationId: CONV_A,
    sequence: 3,
    role: 'assistant',
    at: '2026-09-01T18:15:00.000Z',
  },
});
/** su conversacion ya no esta: sin turno contra el que verificar la cita */
const ORPHAN_NOTE = note({
  quote: COLLAR,
  origin: { conversationId: CONV_GONE, sequence: 0, role: 'user', at: '2026-09-03T12:00:00.000Z' },
});

function cursor(
  conversationId: string,
  through: number,
  over: Partial<RelationCursor> = {},
): RelationCursor {
  return {
    conversationId,
    through,
    throughAt: null,
    version: RELATION_EXTRACTOR_VERSION,
    provider: 'codex',
    model: null,
    at: '2026-09-11T00:00:00.000Z',
    refusedVersion: null,
    refusedAtTurns: null,
    ...over,
  };
}

const COUNTERS = relationCountersSchema.parse({
  proposed: 10,
  accepted: 4,
  rejectedShape: 1,
  rejectedQuote: 2,
  rejectedRole: 1,
  rejectedWindow: 1,
  rejectedClosure: 0,
  merged: 1,
  refused: 0,
});

const texts = new Map(TURNS.map((item) => [`${item.conversationId}#${item.sequence}`, item.text]));

function input(over: Partial<RelationDiagnosticsInput> = {}): RelationDiagnosticsInput {
  return {
    notes: [CAFES_NOTE, MERCADO_NOTE, PLAYA_NOTE, ORPHAN_NOTE],
    cursors: [
      cursor(CONV_A, 3),
      cursor(CONV_B, 1, { provider: 'claude' }),
      // se nego y no ha crecido: deja de contar como hueco hasta que lo haga
      cursor(CONV_N, -1, {
        refusedVersion: RELATION_EXTRACTOR_VERSION,
        refusedAtTurns: 2,
      }),
    ],
    counters: COUNTERS,
    droppedOnRead: 2,
    conversations: [
      { conversationId: CONV_A, characterId: LIA },
      { conversationId: CONV_B, characterId: LIA },
      { conversationId: CONV_X, characterId: LIA },
      { conversationId: CONV_N, characterId: null },
    ],
    excluded: new Set([CONV_X]),
    // la excluida no aparece: la linea temporal ya la deja fuera
    timeline: TURNS.map((item) => ({
      conversationId: item.conversationId,
      sequence: item.sequence,
      role: item.role,
      createdAt: item.createdAt,
      stems: new Set(tokenize(item.text)),
    })),
    userMessages: TURNS.filter(
      (item) => item.role === 'user' && item.conversationId !== CONV_N,
    ).map((item) => ({
      text: item.text,
      createdAt: item.createdAt,
      conversationId: item.conversationId,
      sequence: item.sequence,
    })),
    replies: [
      {
        text: 'me prometiste los dos cafés y la tarta de chocolate',
        createdAt: '2026-09-05T10:05:00.000Z',
        characterId: LIA,
      },
      {
        text: `me debes ${COLLAR}`,
        createdAt: '2026-09-06T10:00:00.000Z',
        characterId: LIA,
      },
    ],
    catalog: [
      { conversationId: CONV_A, provider: 'codex' },
      { conversationId: CONV_B, provider: 'deepseek' },
      // catalogada antes de la guarda: no dice con que se hizo
      { conversationId: CONV_N },
    ],
    turnAt: (ref) => {
      const text = texts.get(`${ref.conversationId}#${ref.sequence}`);
      return text === undefined ? null : { text };
    },
    failedThisSession: 1,
    auxiliaryConfigured: true,
    anchor: ANCHOR,
    ...over,
  };
}

describe('55. cifras correctas con datos sinteticos', () => {
  it('la guarda del catalogo separa el CLI local de lo que se cobra', () => {
    const result = diagnoseRelations(input());
    expect(result.catalogGuard).toEqual({
      entries: 3,
      byLocalCli: 1,
      byOther: 1,
      legacyUnknown: 1,
    });
  });

  it('la cobertura cuenta las excluidas aparte y no las da por revisadas', () => {
    const result = diagnoseRelations(input());
    expect(result.coverage).toEqual({
      conversations: 4,
      // solo CONV_A llega hasta su ultima respuesta
      upToDate: 1,
      behind: 2,
      // dos turnos de CONV_B y los dos de CONV_N
      turnsBehind: 4,
      outdatedVersion: 0,
      excludedSkipped: 1,
      refusedPersisted: 1,
      failedThisSession: 1,
      auxiliaryConfigured: true,
    });
  });

  it('una version anterior del extractor deja la conversacion por delante otra vez', () => {
    const result = diagnoseRelations(
      input({ cursors: [cursor(CONV_A, 3, { version: RELATION_EXTRACTOR_VERSION - 1 })] }),
    );
    expect(result.coverage.outdatedVersion).toBe(1);
    expect(result.coverage.behind).toBe(3);
  });

  it('los contadores acumulados van con quien reviso cada conversacion', () => {
    const result = diagnoseRelations(input());
    expect(result.extraction).toEqual({
      ...COUNTERS,
      byProvider: { claude: 1, codex: 2, other: 0 },
    });
  });

  it('lo apuntado se reparte por estado, tipo y voz', () => {
    const result = diagnoseRelations(input());
    expect(result.notes).toEqual({
      total: 4,
      byStatus: { open: 3, fulfilled: 1, released: 0, dismissed: 0 },
      byKind: { promise: 3, plan: 1 },
      byWho: { user: 2, character: 1, both: 1 },
      decidedByDaniel: 1,
      reopenedByDaniel: 0,
      // las dos abiertas son de hace diez dias: ninguna esta dormida todavia
      dormant: 0,
    });
  });

  it('una nota vieja y callada cuenta como dormida', () => {
    const result = diagnoseRelations(
      input({ anchor: { ...ANCHOR, instant: '2026-10-20T21:00:00.000Z' } }),
    );
    // las dos abiertas: mas de treinta dias desde que se prometieron y mas de
    // catorce desde la ultima vez que alguien las nombro. La cerrada no cuenta
    expect(result.notes.dormant).toBe(2);
  });

  it('la integridad separa la cita rota de la conversacion que ya no esta', () => {
    const result = diagnoseRelations(input());
    expect(result.integrity).toEqual({
      quoteValid: 3,
      quoteBroken: 1,
      closuresOrphaned: 1,
      droppedOnRead: 2,
      orphanNoCharacter: 1,
    });
  });

  it('la dosificacion simula cada mensaje real con la misma funcion', () => {
    const result = diagnoseRelations(input());
    expect(result.dosing).toEqual({
      userTurnsSimulated: 4,
      turnsWithBlock: 2,
      linesOffered: 4,
      touched: 0,
      // el origen dentro de los ocho recientes, y la mencion de ella despues
      suppressedInScene: 2,
      suppressedCooldown: 0,
      suppressedWaiting: 0,
      dormant: 0,
      blockedStale: 0,
      quoteBroken: 0,
      maxConsecutiveOffersSameNote: 2,
    });
  });

  it('sin cursores, el desfase bloquea la dosificacion entera', () => {
    const conCursores = diagnoseRelations(input());
    const result = diagnoseRelations(input({ cursors: [] }));
    expect(result.dosing.blockedStale).toBeGreaterThan(0);
    expect(result.dosing.linesOffered).toBeLessThan(conCursores.dosing.linesOffered);
  });

  it('cuenta las que saco ella y si se adelanto a el', () => {
    const result = diagnoseRelations(input());
    expect(result.raising).toEqual({
      herMentions: 1,
      notesRaisedByHer: 1,
      notesRaisedByHerBeforeHim: 1,
      sameNoteWithin24h: 0,
      maxRaisesPerNote: 1,
      medianDaysToFirstRaise: 4,
    });
  });

  it('dos veces la misma en el mismo dia se cuenta como repeticion', () => {
    const repetida = turn(
      CONV_B,
      4,
      'assistant',
      '2026-09-05T18:00:00.000Z',
      'que pasa con los dos cafés y la tarta de chocolate',
    );
    const conRepeticion = [...TURNS, repetida];
    const result = diagnoseRelations(
      input({
        timeline: conRepeticion.map((item) => ({
          conversationId: item.conversationId,
          sequence: item.sequence,
          role: item.role,
          createdAt: item.createdAt,
          stems: new Set(tokenize(item.text)),
        })),
      }),
    );
    expect(result.raising.herMentions).toBe(2);
    expect(result.raising.maxRaisesPerNote).toBe(2);
    expect(result.raising.sameNoteWithin24h).toBe(1);
  });

  it('lo que ella reclama se respalda solo con una promesa anterior que consta', () => {
    const result = diagnoseRelations(input());
    expect(result.inventionGuard).toEqual({ herClaims: 2, backed: 1, unbacked: 1 });
  });

  it('el siguiente turno se calcula sobre la conversacion mas reciente', () => {
    const result = diagnoseRelations(input());
    // CAFES esta en escena por la mencion reciente; queda el plan del mercado
    expect(result.nextTurn.linesForLatestConversation).toBe(1);
  });

  it('un hilo sin personaje no hereda ningun pendiente (`D-062`)', () => {
    const result = diagnoseRelations(
      input({
        // el hilo sin personaje pasa a ser lo ultimo que se hablo
        timeline: TURNS.map((item) => ({
          conversationId: item.conversationId,
          sequence: item.sequence,
          role: item.role,
          createdAt:
            item.conversationId === CONV_N ? '2026-09-09T09:00:00.000Z' : item.createdAt,
          stems: new Set(tokenize(item.text)),
        })),
      }),
    );
    expect(result.nextTurn.linesForLatestConversation).toBe(0);
  });

  it('sin nada apuntado todo queda a cero y no revienta', () => {
    const result = diagnoseRelations(
      input({ notes: [], cursors: [], timeline: [], userMessages: [], replies: [], catalog: [] }),
    );
    expect(result.notes.total).toBe(0);
    expect(result.dosing.userTurnsSimulated).toBe(0);
    expect(result.raising.medianDaysToFirstRaise).toBe(0);
    expect(result.nextTurn.linesForLatestConversation).toBe(0);
    expect(result.coverage.upToDate).toBe(3);
  });
});

describe('56. del diagnostico no sale ni una palabra de lo dicho', () => {
  it('el resultado serializado no lleva citas, ni identificadores, ni dias', () => {
    const serialized = JSON.stringify(diagnoseRelations(input()));

    for (const fragment of ['cafés', 'cafes', 'chocolate', 'mercado', 'playa', 'collar']) {
      expect(serialized.toLowerCase()).not.toContain(fragment);
    }
    for (const id of [CONV_A, CONV_B, CONV_N, CONV_GONE, LIA, CAFES_NOTE.id]) {
      expect(serialized).not.toContain(id);
    }
    // ni un uuid, ni una fecha: solo cifras y booleanos
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('cada hoja del resultado es un entero o un booleano', () => {
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'boolean') return;
      if (typeof value === 'number') {
        expect(Number.isInteger(value), `${path} no es entero`).toBe(true);
        return;
      }
      expect(typeof value, `${path} no es un objeto`).toBe('object');
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, `${path}.${key}`);
      }
    };
    walk(diagnoseRelations(input()), 'relations');
  });
});
