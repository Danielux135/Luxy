// pruebas de los asuntos pendientes: la parte pura.
//
// Lo que se fija aqui es sobre todo QUE SE RECHAZA. El extractor es un modelo y
// puede parafrasear, inventarse un turno o atribuirle a el lo que dijo ella.
// Dejar pasar cualquiera de esas cosas es darle a ella algo que reclamar que
// nunca se dijo, que es justo lo que esta funcion no puede hacer.
import { describe, expect, it } from 'vitest';
import {
  RELATION_CLOSE,
  RELATION_OPEN,
  buildRelationExtractionPrompt,
  normalizeQuote,
  offerOpenRelations,
  parseRelationExtraction,
  quoteAppearsIn,
  relationNoteSchema,
  verifyRelationExtraction,
  type RelationNote,
  type RelationOpenOffer,
  type RelationVerificationContext,
  type RelationWindowTurn,
} from './vault-relation.js';
import type { TemporalAnchor } from './temporal-reference.js';

const CONV = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';

const ANCLA: TemporalAnchor = {
  instant: '2026-09-11T10:00:00.000Z',
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

/** la promesa real que motivo todo esto */
const PROMESA = 'Mañana te traigo dos cafés y una tarta de chocolate a la cama';

const TURNOS: RelationWindowTurn[] = [
  {
    sequence: 10,
    role: 'user',
    text: `*me acerco y te beso la frente*\n\n${PROMESA}, te lo prometo.`,
    createdAt: '2026-09-04T20:00:00.000Z',
  },
  {
    sequence: 11,
    role: 'assistant',
    text: '*sonríe* ¿De verdad? Entonces el sábado vamos al mercado juntos, que me lo debes.',
    createdAt: '2026-09-04T20:01:00.000Z',
  },
  {
    sequence: 12,
    role: 'user',
    text: 'Hecho. Y ya te he traído los cafés… aquí los tienes, recién hechos.',
    createdAt: '2026-09-05T08:00:00.000Z',
  },
  {
    sequence: 13,
    role: 'assistant',
    text: '*se cruza de brazos* Me prometiste un collar de perlas para mi cumpleaños y aún lo espero.',
    createdAt: '2026-09-05T08:01:00.000Z',
  },
];

/** una promesa de el, abierta, de otra conversacion anterior con la misma chica */
const OFERTA: RelationOpenOffer = {
  ref: 'p1',
  noteId: '0123456789abcdef',
  by: 'user',
  quote: 'mañana te traigo dos cafés a la cama',
  origin: { conversationId: OTRA, sequence: 3, at: '2026-09-01T10:00:00.000Z' },
  characterId: 'lia',
};

const contexto = (
  cambios: Partial<RelationVerificationContext> = {},
): RelationVerificationContext => ({
  conversationId: CONV,
  characterId: 'lia',
  turns: TURNOS,
  open: [OFERTA],
  ...cambios,
});

const bloque = (cuerpo: unknown): string =>
  `${RELATION_OPEN}\n${typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)}\n${RELATION_CLOSE}`;

const nueva = (turn: number, by: string, quote: string, kind = 'promise') => ({
  turn,
  by,
  kind,
  quote,
  keywords: ['cafés', 'tarta'],
});

const cierre = (ref: string, turn: number, quote: string) => ({
  ref,
  how: 'fulfilled',
  turn,
  quote,
});

const verificar = (
  cuerpo: { new?: unknown[]; closed?: unknown[] },
  cambios: Partial<RelationVerificationContext> = {},
) => verifyRelationExtraction(parseRelationExtraction(bloque(cuerpo)), contexto(cambios));

describe('la cita tiene que estar tal cual en el turno', () => {
  it('casa escrita sin tildes, con asteriscos y con otros espacios, y se guarda la del turno', () => {
    const resultado = verificar({
      new: [nueva(10, 'user', 'mañana te traigo  dos cafes y una *tarta*   de chocolate a la cama')],
    });

    expect(resultado.counters.accepted).toBe(1);
    // lo que luego se le enseña entre comillas es lo que se dijo, con sus tildes
    expect(resultado.notes[0]!.quote).toBe(PROMESA);
    expect(resultado.notes[0]!.origin).toEqual({
      conversationId: CONV,
      sequence: 10,
      role: 'user',
      at: '2026-09-04T20:00:00.000Z',
    });
    expect(quoteAppearsIn('«MAÑANA te traigo dos cafes»', TURNOS[0]!.text)).toBe(true);
  });

  it('normaliza: minusculas, sin tildes pero con la ñ, sin asteriscos ni comillas', () => {
    expect(normalizeQuote('«¡Mañana, TE lo JURO!» *sonríe*  "vale"')).toBe(
      'mañana te lo juro sonrie vale',
    );
    // «año» y «ano» no son la misma palabra
    expect(normalizeQuote('año')).not.toBe(normalizeQuote('ano'));
  });

  it('una parafrasis no casa: «2 cafés» no es «dos cafés»', () => {
    const resultado = verificar({
      new: [nueva(10, 'user', 'Mañana te traigo 2 cafés y una tarta de chocolate')],
    });
    expect(resultado.counters.rejectedQuote).toBe(1);
    expect(resultado.notes).toEqual([]);
  });

  it('unos puntos suspensivos que recortan la frase se rechazan', () => {
    const resultado = verificar({
      new: [
        nueva(10, 'user', 'Mañana te traigo dos cafés… a la cama'),
        nueva(10, 'user', 'Mañana te traigo dos cafés... a la cama'),
      ],
    });
    expect(resultado.counters.rejectedQuote).toBe(2);
    // pero unos que SI estan en el turno, en el mismo sitio, no son una elision
    expect(quoteAppearsIn('te he traído los cafés... aquí los tienes', TURNOS[2]!.text)).toBe(true);
  });

  it('una cita que cruza «[…recorte…]» se rechaza, porque junta dos trozos que no van seguidos', () => {
    const largo: RelationWindowTurn = {
      sequence: 20,
      role: 'user',
      text: `Te prometo que mañana ${'bla '.repeat(3000)}te llevo a cenar al italiano`,
      createdAt: '2026-09-06T10:00:00.000Z',
    };
    // el extractor de verdad ve el turno recortado
    const prompt = buildRelationExtractionPrompt({
      context: [],
      turns: [largo],
      open: [],
      anchor: ANCLA,
    });
    expect(prompt.split('\n').find((line) => line.startsWith('[20] '))).toContain('[…recorte…]');

    const resultado = verifyRelationExtraction(
      parseRelationExtraction(
        bloque({
          new: [
            nueva(20, 'user', 'mañana bla bla […recorte…] bla te llevo a cenar'),
            nueva(20, 'user', 'bla bla [...recorte...] bla bla te llevo a cenar'),
            nueva(20, 'user', 'Te prometo que mañana te llevo a cenar al italiano'),
            // lo que no cruza la marca sigue valiendo
            nueva(20, 'user', 'Te prometo que mañana bla bla'),
          ],
        }),
      ),
      contexto({ turns: [largo] }),
    );
    expect(resultado.counters.rejectedQuote).toBe(3);
    expect(resultado.counters.accepted).toBe(1);
  });
});

describe('quien se compromete', () => {
  it('«by: user» con la cita en un turno de ella se rechaza: es el blanqueo de «me prometiste»', () => {
    const resultado = verificar({
      new: [nueva(13, 'user', 'Me prometiste un collar de perlas para mi cumpleaños')],
    });
    expect(resultado.counters.rejectedRole).toBe(1);
    expect(resultado.notes).toEqual([]);

    // y al reves: lo que dice el no se apunta como promesa de ella
    expect(verificar({ new: [nueva(10, 'character', PROMESA)] }).counters.rejectedRole).toBe(1);
  });

  it('un plan de los dos vale en boca de cualquiera', () => {
    const resultado = verificar({
      new: [
        nueva(11, 'both', 'el sábado vamos al mercado juntos', 'plan'),
        nueva(10, 'both', PROMESA, 'plan'),
      ],
    });
    expect(resultado.counters.accepted).toBe(2);
    expect(resultado.notes.map((note) => note.origin.role)).toEqual(['assistant', 'user']);
  });
});

describe('donde se puede apuntar', () => {
  it('un turno del contexto, o que no se enseño, no es de la parte nueva', () => {
    const resultado = verificar({
      new: [nueva(8, 'user', PROMESA), nueva(99, 'user', PROMESA)],
    });
    expect(resultado.counters.rejectedWindow).toBe(2);
    expect(resultado.notes).toEqual([]);
  });
});

describe('cierres', () => {
  const cita = 'ya te he traído los cafés';

  it('un cierre de una ref ofrecida, posterior y del mismo personaje pasa, con la ref como la copie', () => {
    const resultado = verificar({ closed: [cierre('[P1]', 12, cita)] });
    expect(resultado.counters.accepted).toBe(1);
    expect(resultado.closures).toEqual([
      {
        noteId: OFERTA.noteId,
        how: 'fulfilled',
        ref: { conversationId: CONV, sequence: 12, quote: cita, at: TURNOS[2]!.createdAt },
      },
    ]);
  });

  it('ref no ofrecida, turno anterior al origen, otro personaje o fuera de la parte nueva: no cierra', () => {
    const casos = [
      verificar({ closed: [cierre('p7', 12, cita)] }),
      verificar(
        { closed: [cierre('p1', 12, cita)] },
        { open: [{ ...OFERTA, origin: { ...OFERTA.origin, at: '2026-09-06T10:00:00.000Z' } }] },
      ),
      verificar({ closed: [cierre('p1', 12, cita)] }, { open: [{ ...OFERTA, characterId: 'otra' }] }),
      verificar({ closed: [cierre('p1', 8, cita)] }),
    ];
    for (const resultado of casos) {
      expect(resultado.counters.rejectedClosure).toBe(1);
      expect(resultado.closures).toEqual([]);
    }
  });

  it('un cierre con una cita que no esta en el turno se rechaza por la cita', () => {
    const resultado = verificar({ closed: [cierre('p1', 12, 'ya te he traído el desayuno')] });
    expect(resultado.counters.rejectedQuote).toBe(1);
    expect(resultado.closures).toEqual([]);
  });
});

describe('la respuesta del extractor', () => {
  it('una propuesta mal formada se descarta y las demas se conservan', () => {
    const parsed = parseRelationExtraction(
      bloque({
        new: [
          { ...nueva(10, 'user', PROMESA), keywords: [7, 'x', 'desayuno', null] },
          { ...nueva(10, 'user', PROMESA), turn: 'diez' },
          // v1 no apunta animo
          nueva(11, 'character', 'el sábado vamos al mercado juntos', 'joy'),
          nueva(10, 'user', 'corta'),
        ],
        closed: [{ ref: 'p1' }],
      }),
    );
    expect(parsed.status).toBe('structured');
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0]!.keywords).toEqual(['desayuno']);
    expect(parsed.malformed).toBe(4);

    const resultado = verifyRelationExtraction(parsed, contexto());
    expect(resultado.counters).toMatchObject({ proposed: 5, accepted: 1, rejectedShape: 4 });
  });

  it('si NINGUNA tiene la forma, no se da por vacia: el cursor no debe avanzar', () => {
    const parsed = parseRelationExtraction(bloque({ new: [{ turno: 10, cita: PROMESA }] }));
    expect(parsed.status).toBe('invalid');
    expect(parsed.malformed).toBe(1);
  });

  it('dos listas vacias son una respuesta valida: no habia nada', () => {
    const parsed = parseRelationExtraction(bloque({ new: [], closed: [] }));
    expect(parsed).toEqual({
      status: 'structured',
      proposals: [],
      closures: [],
      malformed: 0,
      reason: null,
    });
  });

  it('sin bloque es una ausencia, no un fallo: asi se ve una negativa', () => {
    const parsed = parseRelationExtraction('Lo siento, no puedo ayudar con ese contenido.');
    expect(parsed.status).toBe('absent');
  });

  it('un bloque cortado se distingue de uno que no vino', () => {
    const parsed = parseRelationExtraction(`${RELATION_OPEN}\n{"new":[{"turn":10`);
    expect(parsed.status).toBe('truncated_block');
  });

  it('un bloque que no se lee es invalido', () => {
    expect(parseRelationExtraction(bloque('esto no es json')).reason).toContain('JSON');
    expect(parseRelationExtraction(bloque('[]')).status).toBe('invalid');
    expect(parseRelationExtraction(bloque('{"new":"nada"}')).status).toBe('invalid');
  });

  it('acepta el objeto envuelto en {"pendientes": …}', () => {
    const parsed = parseRelationExtraction(
      bloque({ pendientes: { new: [nueva(10, 'user', PROMESA)], closed: [] } }),
    );
    expect(parsed.status).toBe('structured');
    expect(parsed.proposals).toHaveLength(1);
  });

  it('tolera la cerca Markdown, dentro del bloque o alrededor de todo', () => {
    const json = JSON.stringify({ new: [nueva(10, 'user', PROMESA)], closed: [] });
    const dentro = `${RELATION_OPEN}\n\`\`\`json\n${json}\n\`\`\`\n${RELATION_CLOSE}`;
    const fuera = `\`\`\`\n${bloque(json)}\n\`\`\``;
    for (const respuesta of [dentro, fuera]) {
      const parsed = parseRelationExtraction(respuesta);
      expect(parsed.status).toBe('structured');
      expect(parsed.proposals).toHaveLength(1);
    }
  });

  it('nada de esto lanza: una extraccion mala no puede tumbar nada', () => {
    for (const entrada of ['', RELATION_OPEN, RELATION_CLOSE, bloque('null'), bloque('{}'), bloque('7')]) {
      expect(() =>
        verifyRelationExtraction(parseRelationExtraction(entrada), contexto()),
      ).not.toThrow();
    }
  });
});

describe('prompt del extractor', () => {
  const CONTEXTO = [
    { sequence: 8, role: 'user' as const, text: 'buenas noches' },
    { sequence: 9, role: 'assistant' as const, text: 'hasta\nmañana' },
  ];

  it('da la conversacion como DATOS, con el rango de la parte nueva y el contexto marcado', () => {
    const prompt = buildRelationExtractionPrompt({
      context: CONTEXTO,
      turns: TURNOS,
      open: [],
      anchor: ANCLA,
    });

    expect(prompt).toContain('No la continues, no la valores y no hables con');
    expect(prompt).toContain('1. NUEVOS, solo en los turnos [10] a [13] (la PARTE NUEVA). De cada uno das:');
    expect(prompt).toContain('PENDIENTES ABIERTOS (DATOS):\n- ninguno\n');
    expect(prompt).toContain(
      'CONTEXTO YA REVISADO (DATOS; no apuntes nada de aqui):\n[8] Usuario: buenas noches\n[9] Personaje: hasta mañana\n',
    );
    expect(prompt).toContain(
      'PARTE NUEVA (DATOS):\n[10] Usuario: *me acerco y te beso la frente* Mañana te traigo',
    );
    expect(prompt.indexOf('[9] Personaje')).toBeLessThan(prompt.indexOf('PARTE NUEVA (DATOS):'));
    expect(prompt).toContain('Si un turno viene con «[…recorte…]» en medio, se le ha quitado el');
    expect(prompt).toContain(`${RELATION_OPEN}\n{"new":[{"turn":12,"by":"user"`);
    expect(prompt.endsWith(`[13] Personaje: ${TURNOS[3]!.text}`)).toBe(true);
  });

  it('enseña las abiertas con su ref, su dia y quien la hizo', () => {
    const prompt = buildRelationExtractionPrompt({
      context: [],
      turns: TURNOS,
      open: [OFERTA, { ...OFERTA, ref: 'p2', by: 'both', quote: 'el domingo vamos al mercado' }],
      anchor: ANCLA,
    });
    expect(prompt).toContain(
      'PENDIENTES ABIERTOS (DATOS):\n- [p1] 2026-09-01 · prometio el Usuario: «mañana te traigo dos cafés a la cama»\n- [p2] 2026-09-01 · lo quedaron los dos: «el domingo vamos al mercado»\n',
    );
    expect(prompt).not.toContain('- ninguno');
    // sin nada revisado antes, no hay contexto que marcar
    expect(prompt).not.toContain('CONTEXTO YA REVISADO');
  });
});

describe('las abiertas que se ofrecen', () => {
  const hex = (n: number): string => n.toString(16).padStart(16, '0');
  const nota = (id: number, at: string, cambios: Partial<RelationNote> = {}): RelationNote =>
    relationNoteSchema.parse({
      id: hex(id),
      kind: 'promise',
      by: 'user',
      origin: { conversationId: OTRA, sequence: id, role: 'user', at },
      quote: PROMESA,
      status: 'open',
      closure: null,
      decidedBy: 'extractor',
      extractedBy: 'codex',
      extractorVersion: 1,
      createdAt: at,
      updatedAt: at,
      ...cambios,
    });
  const deLia = (note: RelationNote) => ({ note, characterId: 'lia' });

  it('solo las abiertas del mismo personaje y anteriores a la ventana: las 30 mas recientes, p1 la mas antigua', () => {
    const muchas = Array.from({ length: 35 }, (_, i) =>
      deLia(nota(i + 1, new Date(Date.UTC(2026, 7, 1 + i, 12)).toISOString())),
    );
    const ofertas = offerOpenRelations(
      [
        ...muchas,
        { note: nota(100, '2026-09-06T12:00:00.000Z'), characterId: 'otra' },
        { note: nota(101, '2026-09-06T12:00:00.000Z'), characterId: null },
        deLia(nota(102, '2026-09-06T12:00:00.000Z', { status: 'dismissed', decidedBy: 'daniel' })),
        deLia(nota(103, '2026-09-06T12:00:00.000Z', { kind: 'joy' })),
        // de despues de la ventana: todavia no se habia prometido
        deLia(nota(104, '2026-09-12T12:00:00.000Z')),
      ],
      { characterId: 'lia', before: '2026-09-10T00:00:00.000Z' },
    );

    expect(ofertas).toHaveLength(30);
    expect(ofertas.map((oferta) => oferta.ref)).toEqual(
      Array.from({ length: 30 }, (_, i) => `p${i + 1}`),
    );
    expect(ofertas[0]!.noteId).toBe(hex(6));
    expect(ofertas[29]!.noteId).toBe(hex(35));
    expect(ofertas.every((oferta) => oferta.characterId === 'lia')).toBe(true);
  });
});
