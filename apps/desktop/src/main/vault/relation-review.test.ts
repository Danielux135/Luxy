// pruebas de la lista para corregir.
//
// Puro: ni boveda, ni disco, ni reloj. Lo que se fija aqui es lo que hace que
// repasar sirva de algo —que la cita rota se vea, que cada nota caiga en su
// personaje y que la decision de Daniel quede marcada como suya— porque es
// justo lo que despues impide que el extractor la deshaga en la pasada
// siguiente.
import { describe, it, expect } from 'vitest';
import { RELATION_EXTRACTOR_VERSION, type RelationNote, type TemporalAnchor } from '@luxy/shared';
import { noteId } from './relation.js';
import { decideRelation, listRelationsForReview } from './relation-review.js';

const CONV_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const LIA = 'c0000000-3333-4333-8333-333333333333';

const CAFES = 'mañana te traigo dos cafés y una tarta de chocolate a la cama';
const MERCADO = 'el sábado vamos juntos al mercado de las flores';

/** UTC a proposito: asi el dia civil de la prueba no depende de donde corra */
const anchor: TemporalAnchor = {
  instant: '2026-09-14T10:00:00.000Z',
  timeZone: 'UTC',
  dayStartsAtHour: 5,
};

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

const owners = new Map<string, string | null>([
  [CONV_A, LIA],
  [CONV_B, null],
]);

/** el turno existe y sigue diciendo lo mismo */
const intacto = (text: string) => (): { text: string } | null => ({ text });

describe('la lista para corregir', () => {
  it('lleva la cita literal, el dia, el estado y quien la reviso', () => {
    const lista = listRelationsForReview({
      notes: [stored({ quote: CAFES })],
      owners,
      turnAt: intacto(`*se rie* ${CAFES}, te lo juro`),
      anchor,
    });

    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      characterId: LIA,
      kind: 'promise',
      by: 'user',
      quote: CAFES,
      day: '2026-09-04',
      status: 'open',
      decidedBy: 'extractor',
      extractedBy: 'codex',
      quoteBroken: false,
      closedDay: null,
      origin: { conversationId: CONV_A, sequence: 4 },
    });
  });

  it('NO lleva las palabras clave del extractor', () => {
    const lista = listRelationsForReview({
      notes: [stored({ quote: CAFES, keywords: ['TARTA_SENTINEL'] })],
      owners,
      turnAt: intacto(CAFES),
      anchor,
    });

    // solo sirven para callarla antes de tiempo; enseñarlas invitaria a
    // corregirlas, y corregir un indice interno no arregla nada
    expect(JSON.stringify(lista)).not.toContain('TARTA_SENTINEL');
  });

  it('marca la cita rota cuando el turno ya no dice eso', () => {
    const retirado = listRelationsForReview({
      notes: [stored({ quote: CAFES })],
      owners,
      // el turno se retiro y su numero se reutilizo con otro mensaje
      turnAt: intacto('¿te acuerdas de lo de ayer?'),
      anchor,
    });
    expect(retirado[0]?.quoteBroken).toBe(true);

    const ausente = listRelationsForReview({
      notes: [stored({ quote: CAFES })],
      owners,
      turnAt: () => null,
      anchor,
    });
    expect(ausente[0]?.quoteBroken).toBe(true);
  });

  it('cada nota va con el dueño de SU conversacion, y sin ella se queda sin dueño', () => {
    const lista = listRelationsForReview({
      notes: [
        stored({ quote: CAFES }),
        stored({
          quote: MERCADO,
          origin: {
            conversationId: CONV_B,
            sequence: 2,
            role: 'assistant',
            at: '2026-09-06T12:00:00.000Z',
          },
        }),
        stored({
          quote: 'te debo una cena en el sitio ese del puerto',
          origin: {
            conversationId: 'ffffffff-9999-4999-8999-999999999999',
            sequence: 1,
            role: 'user',
            at: '2026-09-02T12:00:00.000Z',
          },
        }),
      ],
      owners,
      turnAt: (ref) =>
        ref.conversationId === CONV_A
          ? { text: CAFES }
          : ref.conversationId === CONV_B
            ? { text: MERCADO }
            : null,
      anchor,
    });

    const ownerOf = (quote: string): string | null | undefined =>
      lista.find((item) => item.quote === quote)?.characterId;

    expect(ownerOf(CAFES)).toBe(LIA);
    // un hilo sin personaje no hereda el de nadie (`D-062`)
    expect(ownerOf(MERCADO)).toBeNull();
    // y una nota cuya conversacion ya no existe se queda sin dueño en vez de
    // colarse en el grupo de otro: borrarla la sacaria del alcance de Daniel
    expect(ownerOf('te debo una cena en el sitio ese del puerto')).toBeNull();
  });

  it('deja fuera un kind que no es un pendiente, sin tocar los demas', () => {
    const lista = listRelationsForReview({
      // lo que escribiria una version posterior: el animo no es una promesa
      notes: [stored({ quote: CAFES, kind: 'joy' }), stored({ quote: MERCADO })],
      owners,
      turnAt: intacto(MERCADO),
      anchor,
    });

    expect(lista.map((item) => item.quote)).toEqual([MERCADO]);
  });

  it('ordena lo abierto primero y lo reciente antes', () => {
    const abiertaVieja = stored({
      quote: 'te llevo al cine el jueves que viene sin falta',
      origin: { conversationId: CONV_A, sequence: 1, role: 'user', at: '2026-09-01T10:00:00.000Z' },
    });
    const abiertaNueva = stored({
      quote: MERCADO,
      origin: { conversationId: CONV_A, sequence: 9, role: 'user', at: '2026-09-09T10:00:00.000Z' },
    });
    const cumplida = stored({
      quote: CAFES,
      status: 'fulfilled',
      closure: { how: 'fulfilled', ref: null, at: '2026-09-12T08:00:00.000Z' },
      origin: { conversationId: CONV_A, sequence: 4, role: 'user', at: '2026-09-10T10:00:00.000Z' },
    });

    const lista = listRelationsForReview({
      notes: [cumplida, abiertaVieja, abiertaNueva],
      owners,
      turnAt: intacto(`${CAFES} ${MERCADO} te llevo al cine el jueves que viene sin falta`),
      anchor,
    });

    expect(lista.map((item) => item.status)).toEqual(['open', 'open', 'fulfilled']);
    expect(lista[0]?.quote).toBe(MERCADO);
    expect(lista[2]?.closedDay).toBe('2026-09-12');
  });
});

describe('la decision de Daniel', () => {
  const abierta = stored({ quote: CAFES });

  it('cerrarla la marca como SUYA y sin turno de cierre', () => {
    const cumplida = decideRelation(abierta, 'fulfilled', '2026-09-14T09:00:00.000Z');

    expect(cumplida.status).toBe('fulfilled');
    expect(cumplida.decidedBy).toBe('daniel');
    // `ref: null` porque lo cerro el: un turno inventado aqui haria que el panel
    // enseñara una cita de cierre que nadie dijo
    expect(cumplida.closure).toEqual({
      how: 'fulfilled',
      ref: null,
      at: '2026-09-14T09:00:00.000Z',
    });
    expect(cumplida.updatedAt).toBe('2026-09-14T09:00:00.000Z');
    // el puntero no se mueve nunca: sigue señalando el mismo turno
    expect(cumplida.id).toBe(abierta.id);
    expect(cumplida.origin).toEqual(abierta.origin);
    expect(cumplida.quote).toBe(abierta.quote);
  });

  it('la lapida deja `dismissed` con la misma marca', () => {
    const enterrada = decideRelation(abierta, 'dismissed', '2026-09-14T09:00:00.000Z');

    expect(enterrada.status).toBe('dismissed');
    expect(enterrada.decidedBy).toBe('daniel');
    expect(enterrada.closure?.how).toBe('dismissed');
  });

  it('reabrir borra el cierre y enciende la marca de que volvio por el', () => {
    const cumplida = decideRelation(abierta, 'fulfilled', '2026-09-14T09:00:00.000Z');
    const devuelta = decideRelation(cumplida, 'open', '2026-09-14T10:00:00.000Z');

    expect(devuelta.status).toBe('open');
    // dejar el cierre haria que el panel siguiera enseñando «cumplida el 14»
    // debajo de algo que vuelve a estar pendiente
    expect(devuelta.closure).toBeNull();
    expect(devuelta.decidedBy).toBe('daniel');
    expect(devuelta.reopenedByDaniel).toBe(true);
  });

  it('reabrir lo que ya estaba abierto no enciende la marca', () => {
    const igual = decideRelation(abierta, 'open', '2026-09-14T10:00:00.000Z');

    expect(igual.status).toBe('open');
    expect(igual.reopenedByDaniel).toBe(false);
    expect(igual.decidedBy).toBe('daniel');
  });

  it('la marca de reabierta es historia y no se apaga al volver a cerrarla', () => {
    const devuelta = decideRelation(
      decideRelation(abierta, 'fulfilled', '2026-09-14T09:00:00.000Z'),
      'open',
      '2026-09-14T10:00:00.000Z',
    );
    const otraVez = decideRelation(devuelta, 'released', '2026-09-14T11:00:00.000Z');

    expect(otraVez.reopenedByDaniel).toBe(true);
    expect(otraVez.status).toBe('released');
  });
});
