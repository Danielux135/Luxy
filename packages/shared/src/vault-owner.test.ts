// la regla del dueño de una conversacion (`D-103`). Todo el texto es inventado.
import { describe, expect, it } from 'vitest';
import {
  conversationOwnerEventSchema,
  lastForeignSequence,
  nextOwnerEventPosition,
  resolveConversationOwner,
  type ConversationOwnerEvent,
  type OwnerTurnFact,
} from './vault-owner.js';
import { relationCursorSchema } from './vault-relation.js';

const CONV = '11111111-1111-4111-8111-111111111111';
const NORA = 'nora-inventada';
const OTRA = 'otra-inventada';

function turn(sequence: number, over: Partial<OwnerTurnFact> = {}): OwnerTurnFact {
  return {
    sequence,
    characterId: null,
    characterDescription: null,
    instructions: null,
    ...over,
  };
}

let serial = 0;
function evento(over: Partial<ConversationOwnerEvent> = {}): ConversationOwnerEvent {
  serial += 1;
  return {
    v: 1,
    kind: 'owner',
    eventId: `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
    conversationId: CONV,
    anchorSequence: 5,
    generation: 1,
    supersedes: [],
    characterId: NORA,
    characterLabel: 'Nora',
    characterDescription: 'Nora, una pintora inventada.',
    instructions: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    ...over,
  };
}

describe('resolveConversationOwner', () => {
  it('sin hechos no hay dueño', () => {
    const owner = resolveConversationOwner({ turns: [], events: [] });
    expect(owner).toMatchObject({
      characterId: null,
      characterDescription: null,
      instructions: null,
      source: 'none',
      signedAfter: null,
      linkedAt: null,
      events: 0,
    });
  });

  it('el nacimiento en el turno 0 fija dueño y ficha', () => {
    const owner = resolveConversationOwner({
      turns: [
        turn(0, { characterId: NORA, characterDescription: 'Ficha de Nora.' }),
        turn(1),
        turn(2),
      ],
      events: [],
    });
    expect(owner.characterId).toBe(NORA);
    expect(owner.characterDescription).toBe('Ficha de Nora.');
    expect(owner.source).toBe('turn');
    expect(owner.signedAfter).toBe(0);
  });

  it('una descripcion anterior al cambio de dueño no se hereda', () => {
    const owner = resolveConversationOwner({
      turns: [
        turn(0, { characterId: OTRA, characterDescription: 'Ficha de la otra.' }),
        turn(4, { characterId: NORA }),
        turn(5),
      ],
      events: [],
    });
    expect(owner.characterId).toBe(NORA);
    expect(owner.characterDescription).toBeNull();
  });

  it('soltar y volver a elegir al MISMO personaje conserva su ficha (datos del Studio anterior)', () => {
    // el Studio anterior no repetia la ficha al volver a elegirla porque era
    // igual a la de antes: solo sellaba el id. La regla estricta la perdia
    const owner = resolveConversationOwner({
      turns: [
        turn(0, { characterId: NORA, characterDescription: 'Ficha de Nora.' }),
        turn(1),
        turn(2, { characterId: '' }),
        turn(3),
        turn(4, { characterId: NORA }),
        turn(5),
      ],
      events: [],
    });
    expect(owner.characterId).toBe(NORA);
    expect(owner.characterDescription).toBe('Ficha de Nora.');
    expect(owner.source).toBe('turn');
    expect(owner.signedAfter).toBe(4);
  });

  it('la ficha sellada sin dueño y el id despues: vale la ficha', () => {
    const owner = resolveConversationOwner({
      turns: [turn(0, { characterDescription: 'Ficha de Nora.' }), turn(1), turn(2, { characterId: NORA })],
      events: [],
    });
    expect(owner.characterDescription).toBe('Ficha de Nora.');
  });

  it('pero la ficha de otro dueño no se hereda aunque haya un soltar en medio', () => {
    const owner = resolveConversationOwner({
      turns: [
        turn(0, { characterId: OTRA, characterDescription: 'Ficha de la otra.' }),
        turn(2, { characterId: '' }),
        turn(4, { characterId: NORA }),
      ],
      events: [],
    });
    expect(owner.characterId).toBe(NORA);
    expect(owner.characterDescription).toBeNull();
  });

  it('ni una ficha sin dueño si despues hubo otro personaje en medio', () => {
    const owner = resolveConversationOwner({
      turns: [
        turn(0, { characterDescription: 'Ficha suelta.' }),
        turn(2, { characterId: OTRA }),
        turn(4, { characterId: '' }),
        turn(6, { characterId: NORA }),
      ],
      events: [],
    });
    expect(owner.characterDescription).toBeNull();
  });

  it('una ficha quitada con cadena vacia sigue quitada al volver al mismo', () => {
    const owner = resolveConversationOwner({
      turns: [
        turn(0, { characterId: NORA, characterDescription: 'Ficha de Nora.' }),
        turn(2, { characterDescription: '' }),
        turn(4, { characterId: '' }),
        turn(6, { characterId: NORA }),
      ],
      events: [],
    });
    expect(owner.characterDescription).toBeNull();
  });

  it('un enganche sin ficha no hereda la de los turnos: lleva los tres campos juntos', () => {
    const owner = resolveConversationOwner({
      turns: [turn(0, { characterDescription: 'Ficha suelta.' }), turn(3)],
      events: [evento({ anchorSequence: 3, characterDescription: null })],
    });
    expect(owner.source).toBe('link');
    expect(owner.characterDescription).toBeNull();
  });

  it('soltar con cadena vacia quita dueño Y ficha (el defecto demostrado)', () => {
    const owner = resolveConversationOwner({
      turns: [
        turn(0, { characterId: NORA, characterDescription: 'Ficha de Nora.' }),
        turn(6, { characterId: '' }),
      ],
      events: [],
    });
    expect(owner.characterId).toBeNull();
    expect(owner.characterDescription).toBeNull();
    expect(owner.source).toBe('none');
  });

  it('un enganche fija dueño, ficha, instrucciones y fecha', () => {
    const enganche = evento({ anchorSequence: 18, instructions: 'Habla despacio.' });
    const owner = resolveConversationOwner({
      turns: [turn(0), turn(18)],
      events: [enganche],
    });
    expect(owner).toMatchObject({
      characterId: NORA,
      characterDescription: 'Nora, una pintora inventada.',
      instructions: 'Habla despacio.',
      characterLabel: 'Nora',
      source: 'link',
      signedAfter: 18,
      linkedAt: '2026-09-25T10:00:00.000Z',
      events: 1,
      winningEventId: enganche.eventId,
      instructionsSource: { kind: 'event', eventId: enganche.eventId },
    });
  });

  it('soltar despues deja sin dueño; con cadena vacia quita las instrucciones del enganche', () => {
    const enganche = evento({ anchorSequence: 3, instructions: 'Habla despacio.' });
    const soltar = evento({
      anchorSequence: 3,
      generation: 2,
      supersedes: [enganche.eventId],
      characterId: null,
      characterLabel: null,
      characterDescription: null,
      instructions: '',
    });
    const owner = resolveConversationOwner({ turns: [turn(0), turn(3)], events: [enganche, soltar] });
    expect(owner.characterId).toBeNull();
    expect(owner.characterDescription).toBeNull();
    expect(owner.instructions).toBeNull();
    expect(owner.source).toBe('none');
    expect(owner.events).toBe(2);
  });

  it('soltar con instrucciones en null conserva las de los turnos', () => {
    const enganche = evento({ anchorSequence: 3 });
    const soltar = evento({
      anchorSequence: 3,
      generation: 2,
      characterId: null,
      characterLabel: null,
      characterDescription: null,
      instructions: null,
    });
    const owner = resolveConversationOwner({
      turns: [turn(0, { instructions: 'Las propias.' }), turn(3)],
      events: [enganche, soltar],
    });
    expect(owner.instructions).toBe('Las propias.');
    expect(owner.instructionsSource).toEqual({ kind: 'turn', sequence: 0 });
  });

  it('un turno con instrucciones posterior al ancla gana al evento', () => {
    const enganche = evento({ anchorSequence: 3, instructions: 'Del enganche.' });
    const owner = resolveConversationOwner({
      turns: [turn(0), turn(3), turn(4, { instructions: 'Nuevas.' })],
      events: [enganche],
    });
    expect(owner.instructions).toBe('Nuevas.');
    expect(owner.characterId).toBe(NORA);
  });

  it('un turno en la misma secuencia que el ancla pierde contra el evento', () => {
    const enganche = evento({ anchorSequence: 3 });
    const owner = resolveConversationOwner({
      turns: [turn(3, { characterId: OTRA, characterDescription: 'Otra.' })],
      events: [enganche],
    });
    expect(owner.characterId).toBe(NORA);
  });

  it('CAUSALIDAD: un evento que cita a otro le gana aunque su equipo tenga menos turnos', () => {
    const e1 = evento({ anchorSequence: 43, generation: 1 });
    const posicion = nextOwnerEventPosition([e1], 19);
    expect(posicion).toEqual({ anchorSequence: 43, generation: 2, supersedes: [e1.eventId] });

    const e2 = evento({
      ...posicion,
      characterId: null,
      characterLabel: null,
      characterDescription: null,
    });
    for (const events of [
      [e1, e2],
      [e2, e1],
    ]) {
      const owner = resolveConversationOwner({ turns: [turn(0), turn(19)], events });
      expect(owner.characterId).toBeNull();
    }
  });

  it('el conflicto de la refutacion se cierra de verdad: el evento que cita a los dos gana', () => {
    const eA = evento({ anchorSequence: 30, generation: 1 });
    const eB = evento({
      anchorSequence: 12,
      generation: 1,
      characterId: null,
      characterLabel: null,
      characterDescription: null,
    });
    const posicion = nextOwnerEventPosition([eA, eB], 12);
    expect(posicion.anchorSequence).toBe(30);
    expect(posicion.generation).toBe(2);
    expect([...posicion.supersedes].sort()).toEqual([eA.eventId, eB.eventId].sort());

    const eC = evento({
      ...posicion,
      characterId: null,
      characterLabel: null,
      characterDescription: null,
    });
    const owner = resolveConversationOwner({ turns: [], events: [eB, eC, eA] });
    expect(owner.characterId).toBeNull();
    expect(owner.events).toBe(3);
  });

  it('sin eventos conocidos, la posicion nueva ancla en la ultima secuencia y nace en la generacion 1', () => {
    expect(nextOwnerEventPosition([], -1)).toEqual({
      anchorSequence: -1,
      generation: 1,
      supersedes: [],
    });
    expect(nextOwnerEventPosition([], 7).anchorSequence).toBe(7);
  });

  it('suficiencia del sufijo: basta con los turnos por encima del ancla o hasta el ultimo que fijo dueño', () => {
    const casos: { turns: OwnerTurnFact[]; events: ConversationOwnerEvent[] }[] = [
      {
        turns: [turn(0, { characterId: NORA, characterDescription: 'N.' }), turn(1), turn(2)],
        events: [],
      },
      {
        turns: [turn(0, { characterId: NORA }), turn(1), turn(2, { characterId: '' }), turn(3)],
        events: [],
      },
      { turns: [turn(0), turn(1), turn(2)], events: [evento({ anchorSequence: 1 })] },
      {
        turns: [turn(0, { characterId: OTRA }), turn(1), turn(2)],
        events: [evento({ anchorSequence: 0 })],
      },
      {
        turns: [turn(0), turn(1), turn(2, { characterId: OTRA }), turn(3)],
        events: [evento({ anchorSequence: 1 })],
      },
    ];
    for (const caso of casos) {
      const maxAnchor = Math.max(-1, ...caso.events.map((event) => event.anchorSequence));
      const suffix: OwnerTurnFact[] = [];
      for (let index = caso.turns.length - 1; index >= 0; index -= 1) {
        const fact = caso.turns[index]!;
        if (fact.sequence <= maxAnchor) break;
        suffix.unshift(fact);
        if (fact.characterId !== null) break;
      }
      const entero = resolveConversationOwner(caso);
      const corto = resolveConversationOwner({ turns: suffix, events: caso.events });
      expect(corto.characterId).toBe(entero.characterId);
      expect(corto.characterDescription).toBe(entero.characterDescription);
    }
  });
});

describe('conversationOwnerEventSchema', () => {
  it('acepta la carga v1', () => {
    expect(conversationOwnerEventSchema.safeParse(evento()).success).toBe(true);
  });

  it('rechaza un campo de mas y una version desconocida', () => {
    expect(conversationOwnerEventSchema.safeParse({ ...evento(), extra: 1 }).success).toBe(false);
    expect(conversationOwnerEventSchema.safeParse({ ...evento(), v: 2 }).success).toBe(false);
  });

  it('rechaza un identificador de personaje vacio: soltar es null', () => {
    expect(conversationOwnerEventSchema.safeParse({ ...evento(), characterId: '' }).success).toBe(
      false,
    );
  });
});

describe('el cursor de pendientes con dueño', () => {
  const cursor = {
    conversationId: CONV,
    through: 3,
    throughAt: '2026-09-25T10:00:00.000Z',
    version: 1,
    provider: 'codex',
    model: null,
    at: '2026-09-25T10:05:00.000Z',
  };

  it('un cursor anterior, sin el campo, sigue parseando y lo deja ausente', () => {
    const parsed = relationCursorSchema.parse(cursor);
    expect(parsed.owner).toBeUndefined();
  });

  it('y uno con dueño null o con dueño tambien', () => {
    expect(relationCursorSchema.parse({ ...cursor, owner: null }).owner).toBeNull();
    expect(relationCursorSchema.parse({ ...cursor, owner: NORA }).owner).toBe(NORA);
  });
});

// octava ronda: la firma de una enganchada no pone su nombre en lo que se
// escribio con la ficha de OTRO personaje
describe('lastForeignSequence', () => {
  it('lo escrito con otro personaje antes del enganche queda marcado', () => {
    // turnos 0-3 con OTRA, soltada en el 4 y enganchada a Nora con ancla 5
    const turns = [
      turn(0, { characterId: OTRA }),
      turn(1),
      turn(2),
      turn(3),
      turn(4, { characterId: '' }),
      turn(5),
      turn(6),
    ];
    const events = [evento({ anchorSequence: 5 })];
    const owner = resolveConversationOwner({ turns, events });
    expect(owner.source).toBe('link');
    expect(lastForeignSequence({ turns, events }, owner.characterId)).toBe(3);
  });

  it('sin otro personaje en vigor no hay nada que marcar', () => {
    const turns = [turn(0), turn(1), turn(2)];
    const events = [evento({ anchorSequence: 2 })];
    expect(lastForeignSequence({ turns, events }, NORA)).toBeNull();
    // lo escrito con ella misma tampoco es ajeno
    const suyas = [turn(0, { characterId: NORA }), turn(1), turn(2, { characterId: '' }), turn(3)];
    expect(lastForeignSequence({ turns: suyas, events: [evento({ anchorSequence: 3 })] }, NORA)).toBeNull();
    expect(lastForeignSequence({ turns, events }, null)).toBeNull();
  });

  it('un enganche anterior a otro personaje tambien cuenta', () => {
    const turns = [turn(0), turn(1), turn(2), turn(3), turn(4), turn(5)];
    const events = [
      evento({ anchorSequence: 1, generation: 1, characterId: OTRA, characterLabel: 'Otra' }),
      evento({ anchorSequence: 4, generation: 2 }),
    ];
    expect(resolveConversationOwner({ turns, events }).characterId).toBe(NORA);
    // 2, 3 y 4 se escribieron con OTRA; el 4 es el ancla, anterior al evento
    expect(lastForeignSequence({ turns, events }, NORA)).toBe(4);
  });
});
