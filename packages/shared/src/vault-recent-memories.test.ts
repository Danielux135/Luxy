// el resumen de las ultimas conversaciones (`D-105`). Todo el texto es inventado.
import { describe, expect, it } from 'vitest';
import type { ConversationMemory } from './schemas.js';
import {
  RECENT_DECISIONS_CHARS,
  RECENT_SUMMARY_GAP,
  RECENT_DECISIONS_LABEL,
  RECENT_MEMORIES_BLOCK_CHARS,
  RECENT_MEMORY_ENTRY_CHARS,
  condenseRecentMemories,
  pickRecentConversations,
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
});

describe('condenseRecentMemories', () => {
  it('nunca lleva plan, preguntas abiertas, hechos ni lecciones', () => {
    const resultado = condenseRecentMemories([
      {
        date: 'ayer',
        title: 'El puerto',
        memory: memoria({
          decisions: ['Quedaron en escribirse por las mañanas.'],
          plan: ['MARCA-PLAN-UNICA'],
          openQuestions: ['MARCA-PREGUNTA-UNICA'],
          facts: ['MARCA-HECHO-UNICO'],
          lessons: ['MARCA-LECCION-UNICA'],
        }),
      },
    ]);
    const todo = JSON.stringify(resultado);
    for (const marca of ['MARCA-PLAN', 'MARCA-PREGUNTA', 'MARCA-HECHO', 'MARCA-LECCION']) {
      expect(todo).not.toContain(marca);
    }
    expect(resultado.entries[0]?.text).toContain('Quedaron en escribirse por las mañanas.');
    expect(resultado.stats.decisiones).toBe(1);
  });

  it('las decisiones van enteras, desde la ultima, sin pasar del tope', () => {
    const decisiones = Array.from(
      { length: 8 },
      (_, index) => `Decision inventada numero ${index} con algo de texto de relleno.`,
    );
    const resultado = condenseRecentMemories([
      { date: 'hoy', title: 't', memory: memoria({ decisions: decisiones }) },
    ]);
    const texto = resultado.entries[0]!.text;
    const linea = texto.split('\n').find((each) => each.startsWith(RECENT_DECISIONS_LABEL))!;
    expect(linea.length).toBeLessThanOrEqual(RECENT_DECISIONS_CHARS);
    // la ultima entra y ninguna va cortada
    expect(linea).toContain(decisiones[7]);
    const puestas = linea.slice(RECENT_DECISIONS_LABEL.length).split('; ');
    for (const puesta of puestas) expect(decisiones).toContain(puesta);
    expect(puestas.length).toBeLessThan(decisiones.length);
    expect(resultado.stats.recortadas).toBe(1);
  });

  it('el resumen se corta en final de frase', () => {
    const frase = 'Una frase inventada que ocupa bastante espacio en el resumen. ';
    const resultado = condenseRecentMemories([
      { date: 'hoy', title: 't', memory: memoria({ summary: frase.repeat(20).trim() }) },
    ]);
    const texto = resultado.entries[0]!.text;
    expect(texto.length).toBeLessThanOrEqual(RECENT_MEMORY_ENTRY_CHARS);
    expect(texto.endsWith('resumen.')).toBe(true);
    expect(resultado.stats.recortadas).toBe(1);
  });

  // revision del 28/09: antes viajaba el PRINCIPIO y lo ultimo que paso, que en
  // un resumen acumulativo suele ir al final, se caia siempre
  it('de un resumen largo viajan la primera frase y las ULTIMAS, con el hueco marcado', () => {
    const frases = Array.from(
      { length: 8 },
      (_, index) => `Frase inventada numero ${index} con relleno suficiente para ocupar sitio de verdad.`,
    );
    const resultado = condenseRecentMemories([
      {
        date: 'hoy',
        title: 't',
        memory: memoria({
          summary: frases.join(' '),
          decisions: Array.from({ length: 4 }, (_, i) => `Decision inventada ${i} con algo de relleno.`),
        }),
      },
    ]);
    const texto = resultado.entries[0]!.text;
    expect(texto.length).toBeLessThanOrEqual(RECENT_MEMORY_ENTRY_CHARS);
    expect(texto.startsWith(frases[0]!)).toBe(true);
    expect(texto).toContain(frases[7]);
    expect(texto).toContain(RECENT_SUMMARY_GAP);
    expect(texto).not.toContain(frases[1]);
    // el hueco no es una frase: no se mide como copiada
    expect(resultado.phrases).toContain(frases[0]);
    expect(resultado.phrases).toContain(frases[7]);
    expect(resultado.phrases.some((frase) => frase.includes('…'))).toBe(false);
    // y cuanto se quedo fuera, en caracteres
    expect(resultado.stats.fuera).toBeGreaterThan(0);
    // al resumen le queda sitio para algo mas que una frase
    expect(texto.split('\n')[0]!.length).toBeGreaterThan(200);
  });

  it('si la primera no deja sitio, viaja lo del final', () => {
    const primera = `Una primera frase inventada ${'larguisima '.repeat(40).trim()}.`;
    const resultado = condenseRecentMemories([
      {
        date: 'hoy',
        title: 't',
        memory: memoria({ summary: `${primera} La ultima inventada.` }),
      },
    ]);
    expect(resultado.entries[0]!.text).toBe('La ultima inventada.');
  });

  it('un resumen que cabe entero no se toca ni suma nada a fuera', () => {
    const resultado = condenseRecentMemories([
      { date: 'hoy', title: 't', memory: memoria({ summary: 'Corta e inventada. Otra.' }) },
    ]);
    expect(resultado.entries[0]!.text).toBe('Corta e inventada. Otra.');
    expect(resultado.stats.fuera).toBe(0);
  });

  it('sin final de frase a mano, corta en un espacio y lo marca', () => {
    const resultado = condenseRecentMemories([
      { date: 'hoy', title: 't', memory: memoria({ summary: 'palabra '.repeat(150).trim() }) },
    ]);
    const texto = resultado.entries[0]!.text;
    expect(texto.length).toBeLessThanOrEqual(RECENT_MEMORY_ENTRY_CHARS);
    expect(texto.endsWith('…')).toBe(true);
  });

  it('respeta 400 por conversacion y 800 en el bloque', () => {
    const larga = memoria({
      summary: 'Algo inventado. '.repeat(80).trim(),
      decisions: Array.from({ length: 12 }, (_, i) => `Acuerdo inventado ${i}.`),
    });
    const resultado = condenseRecentMemories([
      { date: 'a', title: 'a', memory: larga },
      { date: 'b', title: 'b', memory: larga },
      { date: 'c', title: 'c', memory: larga },
    ]);
    for (const entry of resultado.entries) {
      expect(entry.text.length).toBeLessThanOrEqual(RECENT_MEMORY_ENTRY_CHARS);
    }
    expect(resultado.stats.caracteres).toBeLessThanOrEqual(RECENT_MEMORIES_BLOCK_CHARS);
  });

  it('las frases para medir salen de lo que viajo', () => {
    const resultado = condenseRecentMemories([
      {
        date: 'hoy',
        title: 't',
        memory: memoria({ summary: 'Primera inventada. Segunda inventada.', decisions: ['Uno.'] }),
      },
    ]);
    expect(resultado.phrases).toEqual(['Primera inventada.', 'Segunda inventada.', 'Uno.']);
  });
});
