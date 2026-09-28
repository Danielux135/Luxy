// la medida del blanqueo (`D-105`). Todo el texto es inventado.
import { describe, expect, it } from 'vitest';
import type { ConversationMemory } from '@luxy/shared';
import { measureRecentEcho } from './recent-echo.js';

function memoria(over: Partial<ConversationMemory> = {}): ConversationMemory {
  return {
    version: 1,
    summary: 'Hablaron del faro inventado de la isla. Luego cenaron sopa.',
    facts: [],
    decisions: [],
    plan: [],
    openQuestions: [],
    lessons: [],
    ...over,
  };
}

const FRASE = 'Subieron juntos al faro inventado de la isla de niebla';

describe('measureRecentEcho', () => {
  it('cuenta las entradas que copian una frase del resumen sin apoyo aqui', () => {
    const eco = measureRecentEcho({
      memory: memoria({ decisions: ['Subir otra vez al faro inventado de la isla de niebla'] }),
      phrases: [FRASE],
      turns: [{ text: 'hola, ¿que tal el dia?' }],
    });
    expect(eco.entradas).toBe(3);
    expect(eco.conFrasesDeRecientes).toBeGreaterThanOrEqual(1);
    expect(eco.sinApoyoAqui).toBe(eco.conFrasesDeRecientes);
  });

  it('si la frase tambien sale en un turno de aqui, no es blanqueo', () => {
    const eco = measureRecentEcho({
      memory: memoria({ decisions: ['Subir otra vez al faro inventado de la isla de niebla'] }),
      phrases: [FRASE],
      turns: [{ text: '¿te acuerdas de cuando subimos al faro inventado de la isla de niebla?' }],
    });
    expect(eco.conFrasesDeRecientes).toBeGreaterThanOrEqual(1);
    expect(eco.sinApoyoAqui).toBe(0);
  });

  it('sin nada en comun, todo a cero salvo las entradas', () => {
    const eco = measureRecentEcho({
      memory: memoria({ summary: 'Pintaron una pared azul.' }),
      phrases: [FRASE],
      turns: [],
    });
    expect(eco).toEqual({ entradas: 1, conFrasesDeRecientes: 0, sinApoyoAqui: 0 });
  });

  it('solo devuelve enteros', () => {
    const eco = measureRecentEcho({ memory: memoria(), phrases: [FRASE], turns: [] });
    for (const value of Object.values(eco)) expect(Number.isInteger(value)).toBe(true);
  });
});
