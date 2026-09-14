// pruebas del nucleo puro de la memoria de lo ya hablado.
//
// Lo que se fija aqui es, sobre todo, QUE NO SE USA. Una ficha a medias que se
// dé por buena apaga el aviso de turnos omitidos, y entonces el personaje deja
// de preguntar justo cuando lo que tiene delante es un hueco. Por eso casi todas
// las pruebas de `chooseConversationMemory` comprueban el `null`.
//
// Y lo segundo: que el presupuesto por turno NO es el del catalogo. Ese error ya
// se cometio con el extractor de promesas y perdia material en silencio.
import { describe, expect, it } from 'vitest';
import {
  RECAP_BLOCK_CHARS,
  RECAP_CLOSE,
  RECAP_ENTRY_CHARS,
  RECAP_LIST_MAX,
  RECAP_OPEN,
  RECAP_SUMMARY_CHARS,
  RECAP_VERSION,
  buildRecapPrompt,
  chooseConversationMemory,
  clampRecapMemory,
  countKeptEntries,
  deduceRecap,
  parseRecapResponse,
  recapCoverage,
  recapEntrySchema,
  recapWindow,
  refusedStillRecap,
  restoreRecapAnchor,
  scoreRecapVagueness,
  verifyRecap,
  type RecapCatalog,
  type RecapEntry,
  type RecapTurn,
  type RecapTurnRef,
} from './vault-recap.js';
import { CATALOG_CUT_MARK, type CatalogedScene } from './vault-catalog.js';
import { formatConversationMemory, type ConversationMemory } from './schemas.js';
import type { TemporalAnchor } from './temporal-reference.js';

const CONV = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';

const ANCLA: TemporalAnchor = {
  instant: '2026-09-14T10:00:00.000Z',
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

function memoria(overrides: Partial<ConversationMemory> = {}): ConversationMemory {
  return {
    version: 1,
    summary: 'Lia y Daniel siguen en casa de el; ella se quedo a dormir el jueves.',
    facts: [],
    decisions: [],
    plan: [],
    openQuestions: [],
    lessons: [],
    ...overrides,
  };
}

/** turnos alternos: el par es del usuario, el impar del personaje */
function turnos(count: number, from = 0): RecapTurn[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = from + index;
    return {
      sequence,
      role: sequence % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `turno ${sequence}`,
      createdAt: instante(sequence),
    };
  });
}

function referencias(count: number, from = 0): RecapTurnRef[] {
  return turnos(count, from).map((turn) => ({
    sequence: turn.sequence,
    createdAt: turn.createdAt,
  }));
}

function instante(sequence: number): string {
  const minutos = String(sequence % 60).padStart(2, '0');
  const horas = String(10 + Math.floor(sequence / 60)).padStart(2, '0');
  return `2026-09-01T${horas}:${minutos}:00.000Z`;
}

/** la respuesta tal y como llega: el bloque dentro de texto suelto */
function respuesta(payload: unknown): string {
  return `Aqui la tienes.\n${RECAP_OPEN}\n${JSON.stringify(payload)}\n${RECAP_CLOSE}\n`;
}

function ficha(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    summary: 'Lia y Daniel se quedan en casa; ella le pide que le cepille el pelo.',
    facts: ['Empezo: se conocieron en el tren de Vigo'],
    decisions: [],
    plan: [],
    openQuestions: [],
    lessons: [],
    covered: { from: 0, to: 9 },
    skipped: [],
    ...overrides,
  };
}

function entrada(overrides: Partial<RecapEntry> = {}): RecapEntry {
  return recapEntrySchema.parse({
    conversationId: CONV,
    memory: memoria(),
    source: 'cli',
    covered: { from: 0, to: 9 },
    coveredAt: instante(9),
    gaps: [],
    turnsAtRecap: 10,
    version: RECAP_VERSION,
    provider: 'codex',
    model: null,
    at: '2026-09-14T09:00:00.000Z',
    chars: 120,
    approved: true,
    ...overrides,
  });
}

function escena(overrides: Partial<CatalogedScene> = {}): CatalogedScene {
  return {
    from: 0,
    to: 9,
    title: 'Primer encuentro',
    tags: [],
    summary: 'Se conocen en el tren y quedan para verse en Vigo.',
    ...overrides,
  };
}

describe('buildRecapPrompt', () => {
  it('la primera ventana pide el ancla «Empezo:» y no lleva ficha anterior', () => {
    const prompt = buildRecapPrompt({
      context: [],
      turns: turnos(4),
      previous: null,
      anchor: null,
      startsAtFirstTurn: true,
    });

    expect(prompt).toContain('Esta es la PRIMERA parte de la conversacion.');
    expect(prompt).toContain('que empezar por «Empezo: »');
    expect(prompt).not.toContain('LO QUE YA ESTABA ANOTADO');
    // el encuadre: es una ficha para ELLA, no un informe
    expect(prompt).toContain('Quien va a leer esto es ELLA, el personaje');
    expect(prompt).toContain('«tuvieron un encuentro intimo» no sirve para nada');
    expect(prompt).toContain(RECAP_OPEN);
    expect(prompt).toContain('"covered":{"from":0,"to":3}');
  });

  it('la segunda ventana lleva la ficha anterior, la orden de conservar y el ancla', () => {
    const previous = memoria({
      facts: ['Empezo: se conocieron en el tren de Vigo', 'El la llama nena'],
      decisions: ['Quedaron en que ella escribe primero por las mañanas'],
    });

    const prompt = buildRecapPrompt({
      context: turnos(2),
      turns: turnos(4, 2),
      previous,
      anchor: 'Empezo: se conocieron en el tren de Vigo',
      startsAtFirstTurn: false,
    });

    expect(prompt).toContain('LO QUE YA ESTABA ANOTADO. Abajo tienes la ficha');
    expect(prompt).toContain('Lo que siga siendo verdad se queda TAL CUAL, palabra por palabra.');
    // las dos ordenes juntas —«devuelvelas todas» y «maximo 6»— dejaban al
    // modelo encajonado, y el codigo resolvia el empate tirando lo nuevo
    expect(prompt).toContain('lo nuevo NO se queda fuera');
    expect(prompt).toContain('LO QUE YA ESTABA ANOTADO (DATOS):');
    expect(prompt).toContain(formatConversationMemory(previous));
    // el ancla viaja aparte de la ficha: es lo unico que no puede perderse
    expect(prompt).toContain('EL PRINCIPIO DE ESTA CONVERSACION (DATOS):');
    expect(prompt).toContain('Empezo: se conocieron en el tren de Vigo');
    expect(prompt).toContain('YA REVISADO, SOLO PARA ENGANCHAR (DATOS):');
    expect(prompt).not.toContain('Esta es la PRIMERA parte de la conversacion.');
  });

  it('una ventana que empieza por la mitad y sin ficha NO se presenta como el principio', () => {
    // pasa de verdad: tras una ventana negada el cursor avanza y la ficha sigue
    // en `null`. Decirle ahi «di como arranco esto» le obliga a inventarselo, y
    // lo que escriba se queda de ancla en todos los prompts siguientes
    const prompt = buildRecapPrompt({
      context: turnos(3, 37),
      turns: turnos(4, 40),
      previous: null,
      anchor: null,
      startsAtFirstTurn: false,
    });

    expect(prompt).not.toContain('Esta es la PRIMERA parte de la conversacion.');
    expect(prompt).not.toContain('que empezar por «Empezo: »');
    expect(prompt).toContain('Esto NO es el principio de la conversacion');
    expect(prompt).toContain('no lo cuentes, no lo supongas');
    expect(prompt).not.toContain('LO QUE YA ESTABA ANOTADO');
  });

  it('NO hereda el tope por turno del catalogo: un turno largo va entero', () => {
    const largo = 'a'.repeat(3000);
    const prompt = buildRecapPrompt({
      context: [],
      turns: [
        { sequence: 0, role: 'user', text: largo },
        { sequence: 1, role: 'assistant', text: largo },
      ],
      previous: null,
      anchor: null,
      startsAtFirstTurn: true,
    });

    // con el tope del catalogo (1.400) los dos saldrian partidos por el medio, y
    // el cursor avanzaria igual sobre un centro que nadie ha leido
    expect(prompt).toContain(`[0] Usuario: ${largo}`);
    expect(prompt).toContain(`[1] Personaje: ${largo}`);
    // la marca solo aparece donde se explica que significa, nunca dentro de un turno
    expect(prompt.split(CATALOG_CUT_MARK.trim())).toHaveLength(2);
  });
});

describe('parseRecapResponse', () => {
  const expected = { from: 0, to: 9 };

  it('lee una ficha bien formada', () => {
    const parsed = parseRecapResponse(respuesta(ficha()), expected);

    expect(parsed.status).toBe('structured');
    expect(parsed.reply?.memory.facts).toEqual(['Empezo: se conocieron en el tren de Vigo']);
    expect(parsed.reply?.covered).toEqual({ from: 0, to: 9 });
  });

  it('sin bloque devuelve `absent`', () => {
    const parsed = parseRecapResponse('No voy a resumir eso.', expected);
    expect(parsed.status).toBe('absent');
    expect(parsed.reply).toBeNull();
  });

  it('con el bloque abierto y sin cerrar devuelve `truncated`', () => {
    const parsed = parseRecapResponse(`${RECAP_OPEN}\n{"version":1,"summary":"a`, expected);
    expect(parsed.status).toBe('truncated');
  });

  it('con un bloque ilegible devuelve `invalid`', () => {
    const parsed = parseRecapResponse(`${RECAP_OPEN}\nno soy json\n${RECAP_CLOSE}`, expected);
    expect(parsed.status).toBe('invalid');
    expect(parsed.reason).toBe('el bloque no es JSON');
  });

  it('sin `covered` y sin tramos saltados se queda con la ventana que se enseño', () => {
    const sinCovered = ficha();
    delete sinCovered.covered;

    const parsed = parseRecapResponse(respuesta(sinCovered), expected);
    expect(parsed.status).toBe('structured');
    expect(parsed.reply?.covered).toEqual(expected);
  });

  it('con tramos saltados y sin `covered` se rechaza: no hay donde colocarlos', () => {
    const sinCovered = ficha({ skipped: [{ from: 2, to: 4, why: 'explicito' }] });
    delete sinCovered.covered;

    const parsed = parseRecapResponse(respuesta(sinCovered), expected);
    expect(parsed.status).toBe('invalid');
  });
});

describe('verifyRecap', () => {
  const ctx = { expected: { from: 0, to: 9 } };

  it('acepta una ficha con tramos saltados dentro de lo cubierto', () => {
    const parsed = parseRecapResponse(
      respuesta(ficha({ skipped: [{ from: 4, to: 6, why: 'explicito' }] })),
      ctx.expected,
    );
    const verified = verifyRecap(parsed, ctx);

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.recap.gaps).toEqual([{ from: 4, to: 6, why: 'explicito' }]);
    expect(verified.recap.chars).toBe(formatConversationMemory(verified.recap.memory).length);
  });

  it('acepta el tramo que declara el arranque que NO leyo, aunque estreche `covered`', () => {
    // la respuesta honesta: se salta el principio de la ventana, estrecha
    // `covered` y lo dice. Comparar el tramo contra el `covered` del propio
    // modelo la rechazaba entera y paraba la conversacion, mientras que la
    // version silenciosa —estrechar `covered` y no decir nada— pasaba
    const parsed = parseRecapResponse(
      respuesta(
        ficha({
          covered: { from: 4, to: 9 },
          skipped: [{ from: 0, to: 3, why: 'explicito' }],
        }),
      ),
      ctx.expected,
    );
    const verified = verifyRecap(parsed, ctx);

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.recap.gaps).toEqual([{ from: 0, to: 3, why: 'explicito' }]);
    expect(verified.recap.covered).toEqual({ from: 4, to: 9 });
  });

  it('rechaza un tramo saltado que cae fuera de lo cubierto', () => {
    const parsed = parseRecapResponse(
      respuesta(ficha({ skipped: [{ from: 40, to: 44, why: 'explicito' }] })),
      ctx.expected,
    );
    const verified = verifyRecap(parsed, ctx);

    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe('un tramo saltado cae fuera de lo cubierto');
  });

  it('rechaza un motivo que no esta en el enum', () => {
    const parsed = parseRecapResponse(
      respuesta(
        ficha({ skipped: [{ from: 4, to: 6, why: 'era demasiado explicito, prefiero no' }] }),
      ),
      ctx.expected,
    );
    const verified = verifyRecap(parsed, ctx);

    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe('un tramo saltado trae un motivo que no esta en la lista');
    // y el motivo escrito a mano NO viaja a ningun sitio
    expect(verified.reason).not.toContain('explicito, prefiero');
  });

  it('rechaza una entrada que lleve dentro la cadena `<LUXY_`', () => {
    const parsed = parseRecapResponse(
      respuesta(ficha({ facts: ['El copio un bloque <LUXY_MEMORY> dentro de la ficha'] })),
      ctx.expected,
    );
    const verified = verifyRecap(parsed, ctx);

    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe('la ficha lleva dentro una marca de bloque de Luxy');
  });

  it('rechaza una ficha con codigo dentro', () => {
    const parsed = parseRecapResponse(
      respuesta(ficha({ facts: ['function saludar() { return "hola"; }'] })),
      ctx.expected,
    );
    const verified = verifyRecap(parsed, ctx);

    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe('la ficha lleva codigo dentro');
    // el motivo no arrastra nada de lo que dijo el modelo (§8.3)
    expect(verified.reason).not.toContain('saludar');
  });

  it('rechaza una ficha que dice cubrir turnos que no se le enseñaron', () => {
    const parsed = parseRecapResponse(
      respuesta(ficha({ covered: { from: 0, to: 90 } })),
      ctx.expected,
    );
    const verified = verifyRecap(parsed, ctx);

    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe('dice cubrir turnos que no se le enseñaron');
  });
});

describe('clampRecapMemory', () => {
  it('recorta a 400/6/160 en vez de rechazar', () => {
    const clamped = clampRecapMemory(
      memoria({
        summary: 'R'.repeat(600),
        facts: Array.from({ length: 8 }, () => 'H'.repeat(200)),
      }),
    );

    expect(clamped.summary.length).toBe(RECAP_SUMMARY_CHARS);
    expect(clamped.facts).toHaveLength(RECAP_LIST_MAX);
    expect(clamped.facts[0]?.length).toBe(RECAP_ENTRY_CHARS);
  });

  it('el bloque renderizado nunca pasa de 1.800: se van `lessons` antes que `facts`', () => {
    const llena = (letra: string): string[] =>
      Array.from({ length: RECAP_LIST_MAX }, () => letra.repeat(200));

    const clamped = clampRecapMemory(
      memoria({
        summary: 'R'.repeat(600),
        facts: llena('H'),
        decisions: llena('D'),
        plan: llena('P'),
        openQuestions: llena('Q'),
        lessons: llena('L'),
      }),
    );

    expect(formatConversationMemory(clamped).length).toBeLessThanOrEqual(RECAP_BLOCK_CHARS);
    expect(clamped.lessons).toHaveLength(0);
    expect(clamped.openQuestions).toHaveLength(0);
    // el estado y los acuerdos se defienden los ultimos
    expect(clamped.facts).toHaveLength(RECAP_LIST_MAX);
    expect(clamped.decisions.length).toBeGreaterThan(0);
  });

  it('encadenada conserva el ancla y LO NUEVO, y tira lo mas viejo', () => {
    // el modelo obediente devuelve las seis de antes y añade lo nuevo al final.
    // Cortando por el final, la segunda ventana de la conversacion de 65 turnos
    // no aportaba ni un hecho: solo cambiaba el resumen
    const clamped = clampRecapMemory(
      memoria({
        facts: [
          'Empezo: se conocieron en el tren de Vigo',
          'Vieja 2',
          'Vieja 3',
          'Vieja 4',
          'Vieja 5',
          'Vieja 6',
          'Nueva 7: ella se muda a Madrid en enero',
        ],
        decisions: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7 nueva'],
      }),
      { chained: true },
    );

    expect(clamped.facts).toHaveLength(RECAP_LIST_MAX);
    expect(clamped.facts[0]).toBe('Empezo: se conocieron en el tren de Vigo');
    expect(clamped.facts).toContain('Nueva 7: ella se muda a Madrid en enero');
    expect(clamped.facts).not.toContain('Vieja 2');
    expect(clamped.decisions).toContain('D7 nueva');
    expect(clamped.decisions).not.toContain('D1');
  });

  it('sin ficha anterior se sigue quedando con las primeras', () => {
    const clamped = clampRecapMemory(
      memoria({ facts: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'] }),
    );

    expect(clamped.facts).toHaveLength(RECAP_LIST_MAX);
    expect(clamped.facts).not.toContain('H7');
  });
});

describe('scoreRecapVagueness', () => {
  it('marca la ficha saneada', () => {
    const score = scoreRecapVagueness(
      memoria({ summary: 'Tuvieron un encuentro íntimo y quedaron el sábado.' }),
    );

    expect(score.vague).toBe(true);
    expect(score.marker).toBe('encuentro intimo');
  });

  it('no marca una ficha concreta de tamaño parecido', () => {
    const vaga = scoreRecapVagueness(
      memoria({
        summary:
          'Tuvieron un encuentro íntimo y acordaron verse el sábado por la tarde en su casa, para seguir con lo que dejaron a medias la otra noche.',
        facts: ['Se llevan bien', 'Quedaron el sábado'],
      }),
    );
    const concreta = scoreRecapVagueness(
      memoria({
        summary:
          'Lía duerme en casa de Daniel desde el jueves y esta noche le pidió que le cepillara el pelo antes de dormir; él aceptó y ella se durmió apoyada en su hombro.',
        facts: ['Él la llama nena', 'Duermen en Madrid'],
      }),
    );

    // las dos por encima del minimo duro y de tamaño comparable: lo unico que
    // las separa es el comodin, no la longitud
    expect(vaga.chars).toBeGreaterThanOrEqual(150);
    expect(concreta.chars).toBeGreaterThanOrEqual(150);
    expect(Math.abs(vaga.chars - concreta.chars)).toBeLessThan(60);

    expect(vaga.vague).toBe(true);
    expect(concreta.vague).toBe(false);
    expect(concreta.marker).toBeNull();
  });

  it('una ficha larga con un comodin dentro NO se marca', () => {
    const score = scoreRecapVagueness(
      memoria({
        summary:
          'Lía y Daniel discuten por el viaje a Vigo y acaban riéndose; ella se queda a dormir y le pide que la despierte temprano porque entra a trabajar a las ocho. Hubo un momento intimo que ella recuerda con cariño y que cambió el tono de la noche entera, y despues se durmieron abrazados.',
        facts: ['Él la llama nena cuando está de buenas', 'Ella vive en Vigo y él en Madrid'],
        decisions: ['Quedaron en verse el puente de diciembre'],
      }),
    );

    expect(score.marker).toBe('momento intimo');
    expect(score.vague).toBe(false);
  });
});

describe('recapWindow', () => {
  it('termina siempre en turno del personaje', () => {
    const window = recapWindow(turnos(5), -1);

    expect(window).not.toBeNull();
    expect(window?.last.role).toBe('assistant');
    // el turno 4 es del usuario y no tiene respuesta: no se da por leido
    expect(window?.last.sequence).toBe(3);
  });

  it('corta en el `to` de una escena cuando el catalogo es fiable', () => {
    const catalog: RecapCatalog = {
      scenes: [
        escena({ from: 0, to: 9 }),
        escena({ from: 10, to: 35, title: 'La noche larga' }),
        escena({ from: 36, to: 49, title: 'La mañana' }),
      ],
      turnsAtCatalog: 50,
    };

    const window = recapWindow(turnos(50), -1, catalog);

    expect(window?.last.sequence).toBe(35);
    expect(window?.fresh).toHaveLength(36);
  });

  it('el corte de escena tampoco puede dejar el cursor en un turno del usuario', () => {
    const catalog: RecapCatalog = {
      // el 34 es del usuario: se retrocede al 33 aunque la escena acabe ahi
      scenes: [
        escena({ from: 0, to: 9 }),
        escena({ from: 10, to: 34 }),
        escena({ from: 35, to: 49 }),
      ],
      turnsAtCatalog: 50,
    };

    const window = recapWindow(turnos(50), -1, catalog);

    expect(window?.last.sequence).toBe(33);
    expect(window?.last.role).toBe('assistant');
  });

  it('no usa los rangos del catalogo con un reparto uniforme', () => {
    const catalog: RecapCatalog = {
      scenes: [
        escena({ from: 0, to: 9 }),
        escena({ from: 10, to: 19 }),
        escena({ from: 20, to: 29 }),
        escena({ from: 30, to: 39 }),
        escena({ from: 40, to: 49 }),
      ],
      turnsAtCatalog: 50,
    };

    const window = recapWindow(turnos(50), -1, catalog);

    expect(window?.last.sequence).toBe(39);
    expect(window?.fresh).toHaveLength(40);
  });

  it('no usa los rangos del catalogo si se cataloga con menos turnos de los que hay', () => {
    const catalog: RecapCatalog = {
      scenes: [
        escena({ from: 0, to: 9 }),
        escena({ from: 10, to: 35 }),
        escena({ from: 36, to: 39 }),
      ],
      turnsAtCatalog: 40,
    };

    const window = recapWindow(turnos(50), -1, catalog);

    expect(window?.last.sequence).toBe(39);
  });

  it('con cuarenta mensajes del usuario seguidos alarga hasta la primera respuesta', () => {
    const seguidos: RecapTurn[] = [
      ...Array.from({ length: 40 }, (_, index) => ({
        sequence: index,
        role: 'user' as const,
        text: `mensaje ${index}`,
        createdAt: instante(index),
      })),
      {
        sequence: 40,
        role: 'assistant' as const,
        text: 'perdona, me dormi',
        createdAt: instante(40),
      },
    ];

    const window = recapWindow(seguidos, -1);

    expect(window).not.toBeNull();
    expect(window?.last.sequence).toBe(40);
    expect(window?.fresh).toHaveLength(41);
  });

  it('sin nada nuevo del personaje devuelve null', () => {
    expect(recapWindow(turnos(5), 3)).toBeNull();
  });
});

describe('countKeptEntries', () => {
  it('cuenta lo conservado, lo reescrito y lo perdido', () => {
    const previous = memoria({
      facts: ['Empezo: se conocieron en el tren de Vigo', 'El la llama nena', 'Ella vive en Vigo'],
      decisions: ['Quedaron en verse el puente de diciembre'],
    });
    const next = memoria({
      facts: [
        'Empezo: se conocieron en el tren de Vigo',
        'El la llama nena cuando esta de buenas',
        'Duermen juntos desde el jueves',
      ],
      decisions: ['Quedaron en verse el puente de diciembre'],
    });

    expect(countKeptEntries(previous, next)).toEqual({
      kept: 2,
      rewritten: 1,
      dropped: 1,
      added: 1,
    });
  });

  it('cuenta las que APORTA la ventana, que es lo que los otros tres no ven', () => {
    // una ventana encadenada que devuelve las de antes intactas y no mete nada
    // nuevo sale con el marcador perfecto: `kept` lleno y `dropped` a cero
    const previous = memoria({ facts: ['El la llama nena', 'Ella vive en Vigo'] });

    expect(countKeptEntries(previous, previous).added).toBe(0);
    expect(
      countKeptEntries(previous, memoria({ facts: [...previous.facts, 'Duermen juntos'] })).added,
    ).toBe(1);
  });

  it('sin ficha anterior no hay nada que contar', () => {
    expect(countKeptEntries(null, memoria({ facts: ['algo'] }))).toEqual({
      kept: 0,
      rewritten: 0,
      dropped: 0,
      added: 0,
    });
  });
});

describe('restoreRecapAnchor', () => {
  it('vuelve a poner el ancla si el modelo la perdio', () => {
    const restored = restoreRecapAnchor(
      memoria({ facts: ['El la llama nena'] }),
      'Empezo: se conocieron en el tren de Vigo',
    );

    expect(restored.facts[0]).toBe('Empezo: se conocieron en el tren de Vigo');
  });

  it('con la lista llena hace sitio tirando lo mas viejo, no lo recien visto', () => {
    const restored = restoreRecapAnchor(
      memoria({ facts: ['V1', 'V2', 'V3', 'V4', 'V5', 'Nuevo de esta ventana'] }),
      'Empezo: se conocieron en el tren de Vigo',
    );

    expect(restored.facts).toHaveLength(RECAP_LIST_MAX);
    expect(restored.facts[0]).toBe('Empezo: se conocieron en el tren de Vigo');
    expect(restored.facts).toContain('Nuevo de esta ventana');
    expect(restored.facts).not.toContain('V1');
  });

  it('no la duplica si el modelo la conservo, aunque la escriba con acento', () => {
    const restored = restoreRecapAnchor(
      memoria({ facts: ['Empezó: se conocieron en el tren de Vigo'] }),
      'Empezo: se conocieron en el tren de Vigo',
    );

    expect(restored.facts).toHaveLength(1);
  });
});

describe('deduceRecap', () => {
  const base = {
    conversationId: CONV,
    first: { sequence: 0, createdAt: '2026-09-01T12:00:00.000Z' },
    last: { sequence: 21, createdAt: '2026-09-03T12:00:00.000Z' },
    turnsAtRecap: 22,
    anchor: ANCLA,
    at: '2026-09-14T09:00:00.000Z',
  };

  it('solo lleva los resumenes de escena, y las demas listas van vacias', () => {
    const deduced = deduceRecap({
      ...base,
      scenes: [
        escena({ from: 0, to: 9, title: 'Primer encuentro', summary: 'Se conocen en el tren.' }),
        escena({ from: 10, to: 21, title: 'La cena', summary: 'Cenan en casa de el y se quedan.' }),
      ],
    });

    expect(deduced).not.toBeNull();
    expect(deduced?.source).toBe('index');
    expect(deduced?.approved).toBe(true);
    expect(deduced?.provider).toBeNull();
    expect(deduced?.memory?.summary).toContain('Indice de las 2 escenas');
    expect(deduced?.memory?.summary).toContain('del 2026-09-01 al 2026-09-03');
    expect(deduced?.memory?.facts).toEqual([
      '«Primer encuentro»: Se conocen en el tren.',
      '«La cena»: Cenan en casa de el y se quedan.',
    ]);
    expect(deduced?.memory?.decisions).toEqual([]);
    expect(deduced?.memory?.plan).toEqual([]);
    expect(deduced?.memory?.openQuestions).toEqual([]);
    expect(deduced?.memory?.lessons).toEqual([]);
    expect(deduced?.covered).toEqual({ from: 0, to: 21 });
    expect(deduced?.coveredAt).toBe('2026-09-03T12:00:00.000Z');
  });

  it('no crea entrada sin escenas ni con todas sin resumen', () => {
    expect(deduceRecap({ ...base, scenes: [] })).toBeNull();
    expect(
      deduceRecap({
        ...base,
        scenes: [escena({ summary: '' }), escena({ from: 10, summary: '  ' })],
      }),
    ).toBeNull();
  });

  it('con mas de seis escenas dice las dos cifras: las que enseña y las que hubo', () => {
    const scenes = Array.from({ length: 9 }, (_, index) =>
      escena({
        from: index * 2,
        to: index * 2 + 1,
        title: `Escena ${index}`,
        summary: 'x'.repeat(index + 5),
      }),
    );

    const deduced = deduceRecap({ ...base, scenes });

    expect(deduced?.memory?.facts).toHaveLength(6);
    // decir «las 6 escenas» teniendo nueve catalogadas es una afirmacion falsa
    // sobre la conversacion, y este nivel declara lo que no sabe, no lo esconde
    expect(deduced?.memory?.summary).toContain('Indice de 6 de las 9 escenas');
    expect(deduced?.memory?.summary).toContain('no significa que no pasara');
    expect(deduced?.memory?.summary.length).toBeLessThanOrEqual(RECAP_SUMMARY_CHARS);
  });
});

describe('chooseConversationMemory', () => {
  it('la sellada gana siempre sobre el relleno', () => {
    const sealed = memoria({ summary: 'la que escribio el turno vivo' });
    const chosen = chooseConversationMemory({
      sealed,
      entry: entrada(),
      turns: referencias(10),
    });

    expect(chosen.memory).toBe(sealed);
    expect(chosen.source).toBe('turn');
    expect(chosen.gaps).toBe(0);
  });

  it('usa el relleno aprobado y al dia, con sus huecos', () => {
    const chosen = chooseConversationMemory({
      entry: entrada({ gaps: [{ from: 2, to: 4, why: 'explicito' }] }),
      sealed: null,
      turns: referencias(10),
    });

    expect(chosen.source).toBe('recap');
    expect(chosen.gaps).toBe(1);
  });

  it('un relleno sin aprobar no se usa', () => {
    const chosen = chooseConversationMemory({
      sealed: null,
      entry: entrada({ approved: false }),
      turns: referencias(10),
    });

    expect(chosen.memory).toBeNull();
    expect(chosen.source).toBe('turn');
  });

  it('un relleno cuyo `coveredAt` no casa no se usa', () => {
    const chosen = chooseConversationMemory({
      sealed: null,
      entry: entrada({ coveredAt: '2020-01-01T00:00:00.000Z' }),
      turns: referencias(10),
    });

    expect(chosen.memory).toBeNull();
  });

  it('un relleno de otra version no se usa', () => {
    const chosen = chooseConversationMemory({
      sealed: null,
      entry: { ...entrada(), version: RECAP_VERSION + 1 },
      turns: referencias(10),
    });

    expect(chosen.memory).toBeNull();
  });

  it('el indice deducido no necesita aprobacion y se anuncia como indice', () => {
    const chosen = chooseConversationMemory({
      sealed: null,
      entry: entrada({ source: 'index', approved: false }),
      turns: referencias(10),
    });

    expect(chosen.source).toBe('index');
    expect(chosen.gaps).toBe(0);
  });

  it('sin entrada se comporta como hoy', () => {
    const chosen = chooseConversationMemory({
      sealed: null,
      entry: undefined,
      turns: referencias(10),
    });

    expect(chosen).toEqual({ memory: null, source: 'turn', gaps: 0 });
  });

  describe('invariante de cobertura', () => {
    const turns = referencias(65);

    it('un relleno que cubre 0-39 de 65 turnos NO se usa', () => {
      const chosen = chooseConversationMemory({
        sealed: null,
        entry: entrada({ covered: { from: 0, to: 39 }, coveredAt: instante(39) }),
        turns,
      });

      expect(chosen.memory).toBeNull();
      expect(chosen.source).toBe('turn');
    });

    it('uno que llega al primer turno de la cola literal SI se usa', () => {
      // la cola son los ultimos 8 turnos: del 57 al 64. Llegar al 56 basta
      const chosen = chooseConversationMemory({
        sealed: null,
        entry: entrada({ covered: { from: 0, to: 56 }, coveredAt: instante(56) }),
        turns,
      });

      expect(chosen.source).toBe('recap');
    });
  });
});

describe('refusedStillRecap', () => {
  const negada = entrada({
    memory: null,
    refusedKind: 'refused',
    refusedAtTurns: 20,
    refusedProvider: 'codex',
    turnsAtRecap: 20,
  });

  it('no se reintenta sola con el mismo CLI y sin turnos nuevos', () => {
    expect(refusedStillRecap(negada, 20, 'codex')).toBe(true);
  });

  it('deja pasar cuando crece la conversacion', () => {
    expect(refusedStillRecap(negada, 21, 'codex')).toBe(false);
  });

  it('deja pasar cuando cambia el CLI', () => {
    expect(refusedStillRecap(negada, 20, 'claude')).toBe(false);
  });

  it('deja pasar cuando sube la version del resumidor', () => {
    expect(refusedStillRecap({ ...negada, version: RECAP_VERSION - 1 }, 20, 'codex')).toBe(false);
  });

  it('una entrada que nunca se nego no bloquea nada', () => {
    expect(refusedStillRecap(entrada(), 20, 'codex')).toBe(false);
    expect(refusedStillRecap(undefined, 20, 'codex')).toBe(false);
  });
});

describe('recapCoverage', () => {
  it('los numeros suman siempre el total menos las excluidas', () => {
    const conversacion = (
      id: string,
      overrides: Partial<{ sealed: boolean; excluded: boolean }> = {},
    ) => ({
      conversationId: id,
      sealed: overrides.sealed ?? false,
      excluded: overrides.excluded ?? false,
      turns: referencias(10),
    });

    const coverage = recapCoverage({
      conversations: [
        conversacion(CONV),
        conversacion(OTRA),
        conversacion('33333333-3333-4333-8333-333333333333'),
        conversacion('44444444-4444-4444-8444-444444444444'),
        conversacion('55555555-5555-4555-8555-555555555555', { sealed: true }),
        conversacion('66666666-6666-4666-8666-666666666666', { excluded: true }),
        conversacion('77777777-7777-4777-8777-777777777777'),
        conversacion('88888888-8888-4888-8888-888888888888'),
      ],
      entries: [
        entrada(),
        entrada({ conversationId: OTRA, gaps: [{ from: 2, to: 3, why: 'explicito' }] }),
        entrada({ conversationId: '33333333-3333-4333-8333-333333333333', source: 'index' }),
        // esta se quedo sin nada: solo una negativa persistida
        entrada({
          conversationId: '44444444-4444-4444-8444-444444444444',
          memory: null,
          refusedKind: 'refused',
          refusedAtTurns: 10,
          refusedProvider: 'codex',
        }),
        // escrita y solo a la espera del visto bueno: ni resumida ni «sin nada»
        entrada({ conversationId: '77777777-7777-4777-8777-777777777777', approved: false }),
        // escrita, sin aprobar Y ademas no llega hasta la cola literal: aprobarla
        // no bastaria, asi que NO puede contarse como «esperando»
        entrada({
          conversationId: '88888888-8888-4888-8888-888888888888',
          approved: false,
          covered: { from: 0, to: 0 },
          coveredAt: instante(0),
        }),
      ],
    });

    expect(coverage).toEqual({
      total: 8,
      excluded: 1,
      summarized: 1,
      withGaps: 1,
      indexOnly: 1,
      awaitingApproval: 1,
      missing: 2,
      sealed: 1,
    });

    const suma =
      coverage.summarized +
      coverage.withGaps +
      coverage.indexOnly +
      coverage.awaitingApproval +
      coverage.missing +
      coverage.sealed;
    expect(suma).toBe(coverage.total - coverage.excluded);
  });

  it('«escrita esperando tu visto bueno» NO es lo mismo que «sin nada»', () => {
    // justo despues de la pasada las diecisiete fichas estan sin aprobar, y la
    // unica linea que mide esto decia «17 sin leer», que es lo contrario de lo
    // que acababa de pasar. Y lo que eso invita a pulsar es volver a rellenar
    const conversacion = {
      conversationId: CONV,
      sealed: false,
      excluded: false,
      turns: referencias(10),
    };

    const recienEscrita = recapCoverage({
      conversations: [conversacion],
      entries: [entrada({ approved: false })],
    });
    expect(recienEscrita.awaitingApproval).toBe(1);
    expect(recienEscrita.missing).toBe(0);

    const sinNada = recapCoverage({ conversations: [conversacion], entries: [] });
    expect(sinNada.awaitingApproval).toBe(0);
    expect(sinNada.missing).toBe(1);

    // y aprobarla la pasa a resumida, sin tocar ningun otro cajon
    const aprobada = recapCoverage({
      conversations: [conversacion],
      entries: [entrada({ approved: true })],
    });
    expect(aprobada.summarized).toBe(1);
    expect(aprobada.awaitingApproval).toBe(0);
  });
});
