// la memoria de las ultimas conversaciones (`D-105`). Todo el texto es inventado.
import { describe, expect, it } from 'vitest';
import type { ConversationMemory } from './schemas.js';
import {
  RECENT_MEMORY_ENTRY_CHARS,
  RECENT_SECTION_LABELS,
  condenseRecentMemories,
  pickRecentConversations,
  type RecentMemoryItem,
} from './vault-recent-memories.js';

function memoria(over: Partial<ConversationMemory> = {}): ConversationMemory {
  return {
    version: 1,
    summary: 'Pasearon por un puerto inventado. Comieron pulpo.',
    facts: [],
    decisions: [],
    plan: [],
    openQuestions: [],
    lessons: [],
    ...over,
  };
}

function item(memory: ConversationMemory, over: Partial<RecentMemoryItem> = {}): RecentMemoryItem {
  return { date: '2026-09-20', title: 'El puerto', memory, source: 'turn', ...over };
}

/**
 * un texto cortado a `n` como lo cortaba el `slice` de antes: a media palabra.
 * La prueba comprueba que de verdad queda partida antes de usarlo
 */
function cortadoA(n: number, base = 'Frase inventada larga '): string {
  const texto = base.repeat(Math.ceil(n / base.length) + 2);
  const cortado = texto.slice(0, n);
  expect(/[a-z]$/.test(cortado) && /[a-z]/.test(texto.charAt(n))).toBe(true);
  return cortado;
}

describe('pickRecentConversations', () => {
  const a = { conversationId: 'a', updatedAt: '2026-09-20T10:00:00.000Z', linkedAt: null };
  const b = { conversationId: 'b', updatedAt: '2026-09-22T10:00:00.000Z', linkedAt: null };
  const c = { conversationId: 'c', updatedAt: '2026-09-24T10:00:00.000Z', linkedAt: null };
  const enganchada = {
    conversationId: 'e',
    updatedAt: '2026-09-10T10:00:00.000Z',
    linkedAt: '2026-09-25T09:00:00.000Z',
  };

  it('ordena por el ultimo turno o el enganche, lo mas tarde', () => {
    const elegidas = pickRecentConversations([a, b, c, enganchada], null, 2);
    expect(elegidas.map((each) => each.conversationId)).toEqual(['e', 'c']);
  });

  it('nunca incluye la conversacion de ahora', () => {
    const elegidas = pickRecentConversations([a, b, c], 'c', 2);
    expect(elegidas.map((each) => each.conversationId)).toEqual(['b', 'a']);
  });

  it('son dos por defecto', () => {
    expect(pickRecentConversations([a, b, c], null)).toHaveLength(2);
  });

  it('con tres se ve la tercera, que es el control de la medida', () => {
    const elegidas = pickRecentConversations([a, b, c], null, 3);
    expect(elegidas.map((each) => each.conversationId)).toEqual(['c', 'b', 'a']);
  });
});

describe('condenseRecentMemories: la memoria entera (quinta ronda)', () => {
  it('nunca lleva plan ni preguntas abiertas: son el canal de eco de las promesas', () => {
    const resultado = condenseRecentMemories([
      item(
        memoria({
          decisions: ['Quedaron en escribirse por las mañanas.'],
          plan: ['MARCA-PLAN-UNICA'],
          openQuestions: ['MARCA-PREGUNTA-UNICA'],
          facts: ['Hecho inventado del puerto.'],
          lessons: ['Leccion inventada del puerto.'],
        }),
      ),
    ]);
    const todo = JSON.stringify(resultado);
    expect(todo).not.toContain('MARCA-PLAN');
    expect(todo).not.toContain('MARCA-PREGUNTA');
    const texto = resultado.entries[0]!.text;
    expect(texto).toContain('Quedaron en escribirse por las mañanas.');
    expect(texto).toContain('Hecho inventado del puerto.');
    expect(texto).toContain('Leccion inventada del puerto.');
  });

  it('lo lleva todo entero y en su orden, sin recortar', () => {
    const frases = Array.from(
      { length: 12 },
      (_, i) => `Frase inventada numero ${i} con relleno suficiente para ocupar sitio.`,
    );
    const hechos = Array.from({ length: 5 }, (_, i) => `Hecho inventado ${i}.`);
    const decisiones = Array.from({ length: 3 }, (_, i) => `Decision inventada ${i}.`);
    const lecciones = ['Leccion inventada A.', 'Leccion inventada B.'];
    const resultado = condenseRecentMemories([
      item(
        memoria({
          summary: frases.join(' '),
          facts: hechos,
          decisions: decisiones,
          lessons: lecciones,
        }),
      ),
    ]);
    const texto = resultado.entries[0]!.text;
    expect(texto).toBe(
      [
        `${RECENT_SECTION_LABELS.resumen}: ${frases.join(' ')}`,
        `${RECENT_SECTION_LABELS.hechos}:`,
        ...hechos.map((h) => `- ${h}`),
        `${RECENT_SECTION_LABELS.decisiones}:`,
        ...decisiones.map((d) => `- ${d}`),
        `${RECENT_SECTION_LABELS.lecciones}:`,
        ...lecciones.map((l) => `- ${l}`),
      ].join('\n'),
    );
    // el hueco de la version corta ya no existe
    expect(texto).not.toContain(' … ');
    expect(resultado.stats).toMatchObject({
      hechos: 5,
      decisiones: 3,
      lecciones: 2,
      recortadas: 0,
      fuera: 0,
      cortadasAlGuardar: 0,
      huecos: 0,
      caracteres: texto.length,
    });
  });

  it('las secciones vacias no salen', () => {
    const texto = condenseRecentMemories([item(memoria({ decisions: ['Una inventada.'] }))])
      .entries[0]!.text;
    expect(texto).not.toContain(`${RECENT_SECTION_LABELS.hechos}:`);
    expect(texto).not.toContain(`${RECENT_SECTION_LABELS.lecciones}:`);
    expect(texto).toContain(`${RECENT_SECTION_LABELS.decisiones}:\n- Una inventada.`);
  });

  it('los hechos no se rotulan como caducados: la regla que los separa va en el bloque', () => {
    const texto = condenseRecentMemories([item(memoria({ facts: ['El la llama capitana.'] }))])
      .entries[0]!.text;
    expect(texto).toContain('Hechos:\n- El la llama capitana.');
    expect(texto).not.toContain('de entonces');
  });

  it('la memoria mas grande que admite el esquema no pasa de la salvaguarda y el resumen va entero', () => {
    const lista = (letra: string): string[] =>
      Array.from({ length: 12 }, (_, i) =>
        `${letra}${i} ${'relleno inventado '.repeat(13)}`.slice(0, 240).trim(),
      );
    const hechos = lista('H');
    const decisiones = lista('D');
    const lecciones = lista('L');
    // 1.168 caracteres: cerca del tope del esquema y sin la huella del `slice`
    const resumen = `Principio inventado. ${'Relleno del medio inventado. '.repeat(39)}Final inventado.`;
    const resultado = condenseRecentMemories([
      item(memoria({ summary: resumen, facts: hechos, decisions: decisiones, lessons: lecciones })),
    ]);
    const texto = resultado.entries[0]!.text;
    expect(texto.length).toBeLessThanOrEqual(RECENT_MEMORY_ENTRY_CHARS);
    expect(texto).toContain(resumen);
    // se va lo MAS VIEJO de cada lista, y lo ultimo que paso se queda
    for (const listaEntera of [hechos, decisiones, lecciones]) {
      expect(texto).toContain(`- ${listaEntera[11]!}`);
    }
    expect(texto).not.toContain(`- ${lecciones[0]!}`);
    // ninguna entrada va partida: cada linea de lista es una entrada entera
    const puestas = texto
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2));
    for (const puesta of puestas) {
      expect([...hechos, ...decisiones, ...lecciones]).toContain(puesta);
    }
    expect(resultado.stats.recortadas).toBe(1);
    expect(resultado.stats.fuera).toBeGreaterThan(0);
    expect(resultado.stats.hechos + resultado.stats.decisiones + resultado.stats.lecciones).toBe(
      puestas.length,
    );
  });

  it('a igual antiguedad se quitan antes las lecciones que las decisiones y los hechos', () => {
    const larga = (letra: string, i: number): string =>
      `${letra}${i} ${'relleno inventado '.repeat(13)}`.slice(0, 240).trim();
    const resultado = condenseRecentMemories([
      item(
        memoria({
          summary: 'Corto e inventado.',
          facts: Array.from({ length: 9 }, (_, i) => larga('H', i)),
          decisions: Array.from({ length: 9 }, (_, i) => larga('D', i)),
          lessons: Array.from({ length: 9 }, (_, i) => larga('L', i)),
        }),
      ),
    ]);
    const texto = resultado.entries[0]!.text;
    // 27 × ~240 no cabe en 6.000: sale la primera leccion y la primera decision
    // antes que el primer hecho
    expect(texto).not.toContain(larga('L', 0));
    expect(resultado.stats.lecciones).toBeLessThanOrEqual(resultado.stats.hechos);
  });

  it('el aviso de los tramos sin resumir viaja primero y la salvaguarda no lo quita', () => {
    const larga = (letra: string, i: number): string =>
      `${letra}${i} ${'relleno inventado '.repeat(13)}`.slice(0, 240).trim();
    const resultado = condenseRecentMemories([
      item(
        memoria({
          summary: 'Resumen inventado.',
          facts: Array.from({ length: 12 }, (_, i) => larga('H', i)),
          decisions: Array.from({ length: 12 }, (_, i) => larga('D', i)),
          lessons: Array.from({ length: 12 }, (_, i) => larga('L', i)),
        }),
        { source: 'recap', gaps: 2 },
      ),
    ]);
    const texto = resultado.entries[0]!.text;
    expect(resultado.stats.recortadas).toBe(1);
    expect(texto.startsWith('De esa conversacion hay 2 tramos que no se pudieron resumir')).toBe(
      true,
    );
    expect(texto).toContain('preguntalo en vez de suponerlo');
    expect(resultado.stats.huecos).toBe(2);
    // y el aviso no es una frase de la memoria: no se mide como copiada
    expect(resultado.phrases.some((f) => f.text.includes('tramos'))).toBe(false);
  });

  it('un tramo, en singular; sin tramos, sin aviso', () => {
    const uno = condenseRecentMemories([item(memoria(), { source: 'recap', gaps: 1 })]);
    expect(uno.entries[0]!.text).toContain('hay 1 tramo que no se pudo resumir');
    const ninguno = condenseRecentMemories([item(memoria(), { source: 'recap', gaps: 0 })]);
    expect(ninguno.entries[0]!.text).not.toContain('tramo');
  });

  it('las frases para medir salen de lo que viajo, con su parte', () => {
    const resultado = condenseRecentMemories([
      item(
        memoria({
          summary: 'Primera inventada. Segunda inventada.',
          facts: ['Hecho.'],
          decisions: ['Uno.'],
          lessons: ['Leccion.'],
          plan: ['Plan que no viaja.'],
        }),
      ),
    ]);
    expect(resultado.phrases).toEqual([
      { text: 'Primera inventada.', field: 'resumen' },
      { text: 'Segunda inventada.', field: 'resumen' },
      { text: 'Hecho.', field: 'hechos' },
      { text: 'Uno.', field: 'decisiones' },
      { text: 'Leccion.', field: 'lecciones' },
    ]);
  });

  // octava ronda: partia en cada punto y fabricaba frases de medir que no eran
  it('un punto sin espacio detras, o tras un tratamiento, no cierra frase', () => {
    const resultado = condenseRecentMemories([
      item(memoria({ summary: 'Quedaron a las 3.30 en el bar. Sr. Pérez vino. ¡Qué noche!Y ya.' })),
    ]);
    expect(resultado.phrases.map((frase) => frase.text)).toEqual([
      'Quedaron a las 3.30 en el bar.',
      'Sr. Pérez vino.',
      '¡Qué noche!Y ya.',
    ]);
  });
});

describe('condenseRecentMemories: la palabra cortada de lo ya guardado', () => {
  it('un resumen sellado de 1.200 justos que acaba a media palabra se presenta cortado en palabra', () => {
    const resumen = cortadoA(1200);
    const resultado = condenseRecentMemories([item(memoria({ summary: resumen }))]);
    const linea = resultado.entries[0]!.text.split('\n')[0]!;
    expect(linea.endsWith('…')).toBe(true);
    // lo de delante del «…» es una palabra entera del texto
    expect(linea).toMatch(/(Frase|inventada|larga)…$/u);
    expect(resultado.stats.cortadasAlGuardar).toBe(1);
    // y la frase partida no se mide como una frase
    expect(resultado.phrases.some((f) => f.text.endsWith('Frase invent'))).toBe(false);
  });

  it('uno de 1.200 que acaba en punto no se toca', () => {
    const resumen = `${cortadoA(1199)}.`;
    const resultado = condenseRecentMemories([item(memoria({ summary: resumen }))]);
    expect(resultado.entries[0]!.text).toContain(resumen);
    expect(resultado.stats.cortadasAlGuardar).toBe(0);
  });

  it('una entrada sellada de 240 justos, igual', () => {
    const hecho = cortadoA(240);
    const resultado = condenseRecentMemories([item(memoria({ facts: [hecho] }))]);
    expect(resultado.entries[0]!.text).not.toContain(hecho);
    expect(resultado.stats.cortadasAlGuardar).toBe(1);
  });

  it('una ficha se guardaba a 160: esa es su huella, no la de 240', () => {
    const hecho = cortadoA(160, 'Hecho inventado aqui ');
    const ficha = condenseRecentMemories([item(memoria({ facts: [hecho] }), { source: 'recap' })]);
    expect(ficha.entries[0]!.text).not.toContain(hecho);
    expect(ficha.stats.cortadasAlGuardar).toBe(1);
    // en una memoria sellada 160 no es un tope: se deja como esta
    const sellada = condenseRecentMemories([item(memoria({ facts: [hecho] }))]);
    expect(sellada.entries[0]!.text).toContain(hecho);
    expect(sellada.stats.cortadasAlGuardar).toBe(0);
  });

  it('lo que no viaja tampoco cuenta como arreglado', () => {
    const resultado = condenseRecentMemories([item(memoria({ plan: [cortadoA(240)] }))]);
    expect(resultado.stats.cortadasAlGuardar).toBe(0);
  });
});
