// pruebas del nucleo local de los pendientes.
//
// Todo es puro: no hay boveda, ni disco, ni reloj. Lo que se fija aqui es lo que
// impide los dos fallos graves —que una promesa se duplique y que una decision
// de Daniel se deshaga sola— y por eso las pruebas son de comportamiento y no de
// forma.
import { describe, it, expect } from 'vitest';
import {
  RELATION_EXTRACTOR_VERSION,
  offerOpenRelations,
  relationCountersSchema,
  type RelationCounters,
  type RelationNote,
  type VerifiedRelationExtraction,
  type VerifiedRelationNote,
} from '@luxy/shared';
import {
  detectClaims,
  matchesNote,
  mergeExtraction,
  noteId,
  quoteStems,
  type OwnedRelationNote,
} from './relation.js';

const CONV_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const LIA = 'c0000000-3333-4333-8333-333333333333';
const OTRA = 'd0000000-4444-4444-8444-444444444444';

const CAFES = 'mañana te traigo dos cafés y una tarta de chocolate a la cama';
const MERCADO = 'el sábado vamos juntos al mercado de las flores';

const counters = (over: Partial<RelationCounters> = {}): RelationCounters => ({
  ...relationCountersSchema.parse({}),
  ...over,
});

function verified(
  notes: readonly VerifiedRelationNote[],
  closures: VerifiedRelationExtraction['closures'] = [],
): VerifiedRelationExtraction {
  return {
    notes: [...notes],
    closures: [...closures],
    counters: counters({ proposed: notes.length + closures.length, accepted: notes.length + closures.length }),
  };
}

function promise(
  over: Partial<VerifiedRelationNote> & { quote: string } = { quote: CAFES },
): VerifiedRelationNote {
  return {
    kind: 'promise',
    by: 'user',
    origin: {
      conversationId: CONV_A,
      sequence: 4,
      role: 'user',
      at: '2026-09-04T20:00:00.000Z',
    },
    keywords: ['desayuno', 'tarta'],
    ...over,
  };
}

function stored(over: Partial<RelationNote> & { quote: string }): RelationNote {
  const origin = over.origin ?? {
    conversationId: CONV_A,
    sequence: 4,
    role: 'user' as const,
    at: '2026-09-04T20:00:00.000Z',
  };
  return {
    id: noteId(origin, over.quote),
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
    createdAt: '2026-09-04T20:05:00.000Z',
    updatedAt: '2026-09-04T20:05:00.000Z',
    ...over,
    origin,
  };
}

const own = (note: RelationNote, characterId: string | null = LIA): OwnedRelationNote => ({
  note,
  characterId,
});

const scope = { conversationId: CONV_A, characterId: LIA };

describe('14. la misma extraccion dos veces deja el mismo almacen', () => {
  it('no duplica, y el id no depende de como se escribiera la cita', () => {
    const extraction = verified([promise({ quote: CAFES })]);

    const first = mergeExtraction({
      existing: [],
      verified: extraction,
      scope,
      extractedBy: 'codex',
      now: '2026-09-04T20:05:00.000Z',
    });
    const second = mergeExtraction({
      existing: first.notes.map((note) => own(note)),
      verified: extraction,
      scope,
      // otro dia y otro CLI: aun asi no puede cambiar nada
      extractedBy: 'claude',
      now: '2026-09-09T11:00:00.000Z',
    });

    expect(first.added).toHaveLength(1);
    expect(second.added).toHaveLength(0);
    expect(second.notes).toEqual(first.notes);
    expect(second.counters.merged).toBe(1);
    expect(second.counters.accepted).toBe(0);
  });

  it('la clave sale de la cita normalizada, no de la copia del extractor', () => {
    const ref = { conversationId: CONV_A, sequence: 4 };
    expect(noteId(ref, CAFES)).toBe(
      noteId(ref, '  MAÑANA te traigo *dos cafes* y una tarta de chocolate a la cama  '),
    );
    expect(noteId(ref, CAFES)).toMatch(/^[0-9a-f]{16}$/);
    // el turno forma parte de la clave: la misma frase en otro turno es otra nota
    expect(noteId({ conversationId: CONV_A, sequence: 5 }, CAFES)).not.toBe(noteId(ref, CAFES));
  });
});

describe('15. una cita solapada en el mismo turno se queda con la existente', () => {
  it('no apunta la version corta y no toca la guardada', () => {
    const existing = stored({ quote: CAFES });

    const result = mergeExtraction({
      existing: [own(existing)],
      verified: verified([promise({ quote: 'te traigo dos cafés y una tarta de chocolate' })]),
      scope,
      extractedBy: 'codex',
      now: '2026-09-05T09:00:00.000Z',
    });

    expect(result.added).toHaveLength(0);
    expect(result.notes).toEqual([existing]);
    expect(result.counters.merged).toBe(1);
  });
});

describe('16. una repeticion en otra conversacion cuenta como merged', () => {
  it('la misma deuda dicha con otras palabras no abre otra nota', () => {
    const existing = stored({ quote: CAFES });

    const result = mergeExtraction({
      existing: [own(existing)],
      verified: verified([
        promise({
          quote: 'te traigo la tarta de chocolate y los cafés a la cama',
          origin: {
            conversationId: CONV_B,
            sequence: 2,
            role: 'user',
            at: '2026-09-07T21:00:00.000Z',
          },
        }),
      ]),
      scope: { conversationId: CONV_B, characterId: LIA },
      extractedBy: 'codex',
      now: '2026-09-07T21:05:00.000Z',
    });

    expect(result.added).toHaveLength(0);
    expect(result.counters.merged).toBe(1);
    expect(result.notes).toHaveLength(1);
  });

  it('pero una promesa distinta del mismo dia si se apunta', () => {
    const existing = stored({ quote: CAFES });

    const result = mergeExtraction({
      existing: [own(existing)],
      verified: verified([
        promise({
          quote: MERCADO,
          by: 'both',
          kind: 'plan',
          origin: {
            conversationId: CONV_A,
            sequence: 6,
            role: 'user',
            at: '2026-09-04T20:20:00.000Z',
          },
        }),
      ]),
      scope,
      extractedBy: 'codex',
      now: '2026-09-04T20:25:00.000Z',
    });

    expect(result.added).toHaveLength(1);
    expect(result.counters.merged).toBe(0);
  });

  it('la repeticion de otro personaje no se fusiona con la de este', () => {
    const existing = stored({ quote: CAFES });

    const result = mergeExtraction({
      existing: [own(existing, OTRA)],
      verified: verified([
        promise({
          quote: 'te traigo la tarta de chocolate y los cafés a la cama',
          origin: {
            conversationId: CONV_B,
            sequence: 2,
            role: 'user',
            at: '2026-09-07T21:00:00.000Z',
          },
        }),
      ]),
      scope: { conversationId: CONV_B, characterId: LIA },
      extractedBy: 'codex',
      now: '2026-09-07T21:05:00.000Z',
    });

    expect(result.added).toHaveLength(1);
  });
});

describe('17. la lapida dismissed bloquea que se vuelva a proponer', () => {
  it('ni en el mismo turno ni en otra conversacion', () => {
    const tomb = stored({
      quote: CAFES,
      status: 'dismissed',
      decidedBy: 'daniel',
      closure: { how: 'dismissed', ref: null, at: '2026-09-06T10:00:00.000Z' },
    });

    const result = mergeExtraction({
      existing: [own(tomb)],
      verified: verified([
        promise({ quote: 'te traigo dos cafés y una tarta de chocolate' }),
        promise({
          quote: 'te traigo la tarta de chocolate y los cafés a la cama',
          origin: {
            conversationId: CONV_B,
            sequence: 2,
            role: 'user',
            at: '2026-09-07T21:00:00.000Z',
          },
        }),
      ]),
      scope,
      extractedBy: 'codex',
      now: '2026-09-07T21:05:00.000Z',
    });

    expect(result.added).toHaveLength(0);
    expect(result.counters.merged).toBe(2);
    expect(result.notes).toEqual([tomb]);
  });

  // la lapida no viaja en el prompt (`offerOpenRelations` solo enseña las
  // abiertas), asi que el extractor no sabe que existe y la puede reformular
  // desde el otro lado: «te debo una cena» vuelve como plan de los dos. Si la
  // lapida se atara al `by`, bastaria ese cambio para que ella reclamase lo que
  // Daniel enterro
  it('tampoco si el extractor la reapunta con otro «by»', () => {
    const tomb = stored({
      quote: CAFES,
      status: 'dismissed',
      decidedBy: 'daniel',
      closure: { how: 'dismissed', ref: null, at: '2026-09-06T10:00:00.000Z' },
    });

    const otraVoz = (by: 'both' | 'character', role: 'user' | 'assistant') =>
      mergeExtraction({
        existing: [own(tomb)],
        verified: verified([
          promise({
            quote: 'te traigo la tarta de chocolate y los cafés a la cama',
            by,
            origin: { conversationId: CONV_B, sequence: 2, role, at: '2026-09-07T21:00:00.000Z' },
          }),
        ]),
        scope: { conversationId: CONV_B, characterId: LIA },
        extractedBy: 'codex',
        now: '2026-09-07T21:05:00.000Z',
      });

    for (const result of [otraVoz('both', 'user'), otraVoz('character', 'assistant')]) {
      expect(result.added).toHaveLength(0);
      expect(result.counters.merged).toBe(1);
      expect(result.notes).toEqual([tomb]);
    }
  });

  it('pero una abierta repetida con otro «by» si es otra promesa', () => {
    const open = stored({ quote: CAFES });

    const result = mergeExtraction({
      existing: [own(open)],
      verified: verified([
        promise({
          quote: 'te traigo la tarta de chocolate y los cafés a la cama',
          by: 'both',
          origin: {
            conversationId: CONV_B,
            sequence: 2,
            role: 'user',
            at: '2026-09-07T21:00:00.000Z',
          },
        }),
      ]),
      scope: { conversationId: CONV_B, characterId: LIA },
      extractedBy: 'codex',
      now: '2026-09-07T21:05:00.000Z',
    });

    expect(result.added).toHaveLength(1);
    expect(result.counters.merged).toBe(0);
  });
});

describe('18. el extractor no pisa a Daniel y no reabre nada', () => {
  it('un cierre sobre una nota decidida por Daniel se rechaza', () => {
    const mine = stored({ quote: CAFES, decidedBy: 'daniel', reopenedByDaniel: true });

    const result = mergeExtraction({
      existing: [own(mine)],
      verified: verified(
        [],
        [
          {
            noteId: mine.id,
            how: 'fulfilled',
            ref: {
              conversationId: CONV_A,
              sequence: 9,
              quote: 'aqui tienes tu tarta de chocolate',
              at: '2026-09-06T09:00:00.000Z',
            },
          },
        ],
      ),
      scope,
      extractedBy: 'codex',
      now: '2026-09-06T09:05:00.000Z',
    });

    expect(result.notes).toEqual([mine]);
    expect(result.closed).toHaveLength(0);
    expect(result.counters.rejectedClosure).toBe(1);
  });

  it('una nota ya cerrada no vuelve a open ni cambia de cierre', () => {
    const done = stored({
      quote: CAFES,
      status: 'fulfilled',
      closure: {
        how: 'fulfilled',
        ref: {
          conversationId: CONV_A,
          sequence: 9,
          quote: 'aqui tienes tu tarta',
          at: '2026-09-06T09:00:00.000Z',
        },
        at: '2026-09-06T09:05:00.000Z',
      },
    });

    const result = mergeExtraction({
      existing: [own(done)],
      verified: verified(
        [],
        [
          {
            noteId: done.id,
            how: 'released',
            ref: {
              conversationId: CONV_A,
              sequence: 20,
              quote: 'dejalo, ya da igual lo de la tarta',
              at: '2026-09-08T09:00:00.000Z',
            },
          },
        ],
      ),
      scope,
      extractedBy: 'codex',
      now: '2026-09-08T09:05:00.000Z',
    });

    expect(result.notes).toEqual([done]);
    expect(result.counters.rejectedClosure).toBe(1);
  });

  it('una abierta del extractor si se cierra, con su turno y su cita', () => {
    const open = stored({ quote: CAFES });

    const result = mergeExtraction({
      existing: [own(open)],
      verified: verified(
        [],
        [
          {
            noteId: open.id,
            how: 'fulfilled',
            ref: {
              conversationId: CONV_A,
              sequence: 9,
              quote: 'aqui tienes tu tarta de chocolate',
              at: '2026-09-06T09:00:00.000Z',
            },
          },
        ],
      ),
      scope,
      extractedBy: 'codex',
      now: '2026-09-06T09:05:00.000Z',
    });

    expect(result.closed).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({
      status: 'fulfilled',
      decidedBy: 'extractor',
      updatedAt: '2026-09-06T09:05:00.000Z',
      closure: { how: 'fulfilled', at: '2026-09-06T09:05:00.000Z' },
    });
  });
});

describe('19. una ventana antigua no ve ni cierra una promesa del futuro', () => {
  const future = stored({
    quote: MERCADO,
    by: 'both',
    kind: 'plan',
    origin: {
      conversationId: CONV_B,
      sequence: 3,
      role: 'user',
      at: '2026-09-09T18:00:00.000Z',
    },
  });

  it('no se le ofrece: la lista abierta se corta por el primer turno de la ventana', () => {
    const offers = offerOpenRelations([own(future)], {
      characterId: LIA,
      before: '2026-09-04T19:00:00.000Z',
    });
    expect(offers).toEqual([]);
  });

  it('y un cierre anterior a su origen se rechaza aunque llegue igualmente', () => {
    const result = mergeExtraction({
      existing: [own(future)],
      verified: verified(
        [],
        [
          {
            noteId: future.id,
            how: 'fulfilled',
            ref: {
              conversationId: CONV_A,
              sequence: 9,
              quote: 'ya fuimos al mercado de las flores',
              at: '2026-09-04T20:30:00.000Z',
            },
          },
        ],
      ),
      scope,
      extractedBy: 'codex',
      now: '2026-09-04T20:35:00.000Z',
    });

    expect(result.notes).toEqual([future]);
    expect(result.counters.rejectedClosure).toBe(1);
  });
});

describe('raices y coincidencia', () => {
  it('las raices de una cita no se repiten', () => {
    const stems = quoteStems('la tarta, la tarta de chocolate');
    expect(new Set(stems).size).toBe(stems.length);
  });

  it('hablar de una promesa larga exige mas que rozarla', () => {
    const stems = quoteStems(CAFES);
    // una raiz suelta es casi siempre una palabra corriente
    expect(matchesNote('me apetece un café', stems)).toBe(false);
    // dos de siete llegan al minimo pero no al 40 %: sigue sin ser esa promesa
    expect(matchesNote('¿y mi tarta de chocolate?', stems)).toBe(false);
    expect(matchesNote('sigo esperando los dos cafés y la tarta de chocolate', stems)).toBe(true);
  });

  it('con una sola raiz se exigen todas', () => {
    expect(matchesNote('hablamos del mercado', ['merc'])).toBe(true);
    expect(matchesNote('hablamos de otra cosa', ['merc'])).toBe(false);
  });
});

describe('reclamaciones sin respaldo', () => {
  const respaldada = stored({ quote: CAFES });

  it('una reclamacion con una promesa detras cuenta como respaldada', () => {
    const result = detectClaims(
      [
        {
          characterId: LIA,
          createdAt: '2026-09-08T10:00:00.000Z',
          text: 'me prometiste una tarta de chocolate y aqui sigo esperando',
        },
      ],
      [own(respaldada)],
    );
    expect(result).toEqual({ herClaims: 1, backed: 1, unbacked: 0 });
  });

  it('una promesa posterior no respalda un reproche anterior', () => {
    const result = detectClaims(
      [
        {
          characterId: LIA,
          createdAt: '2026-09-01T10:00:00.000Z',
          text: 'me prometiste una tarta de chocolate',
        },
      ],
      [own(respaldada)],
    );
    expect(result).toEqual({ herClaims: 1, backed: 0, unbacked: 1 });
  });

  it('la de otro personaje tampoco respalda', () => {
    const result = detectClaims(
      [
        {
          characterId: OTRA,
          createdAt: '2026-09-08T10:00:00.000Z',
          text: 'me prometiste una tarta de chocolate',
        },
      ],
      [own(respaldada)],
    );
    expect(result.unbacked).toBe(1);
  });

  it('«me prometiste que» no cuenta dos veces', () => {
    const result = detectClaims(
      [
        {
          characterId: LIA,
          createdAt: '2026-09-08T10:00:00.000Z',
          text: 'me prometiste que vendrias',
        },
      ],
      [],
    );
    expect(result.herClaims).toBe(1);
  });

  it('sin formula no hay reclamacion', () => {
    const result = detectClaims(
      [
        {
          characterId: LIA,
          createdAt: '2026-09-08T10:00:00.000Z',
          text: 'buenos dias, ¿has dormido bien?',
        },
      ],
      [own(respaldada)],
    );
    expect(result).toEqual({ herClaims: 0, backed: 0, unbacked: 0 });
  });
});
