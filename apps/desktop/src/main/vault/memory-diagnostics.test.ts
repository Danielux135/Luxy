import { describe, expect, it } from 'vitest';
import type { TemporalAnchor } from '@luxy/shared';
import type { Episode } from './episodes.js';
import { diagnoseMemory } from './memory-diagnostics.js';

// el instante del ancla da igual: cada prueba de fecha pone el suyo
const ANCLA: TemporalAnchor = {
  instant: '2026-09-11T10:00:00Z',
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

function episodio(parcial: Partial<Episode> & { conversationId: string; startedAt: string }): Episode {
  return {
    from: 1,
    to: 4,
    endedAt: parcial.startedAt,
    turns: 4,
    title: 'escena',
    catalogedBy: null,
    ...parcial,
  };
}

describe('diagnoseMemory', () => {
  it('sin nada que mirar devuelve ceros, no revienta', () => {
    const d = diagnoseMemory({ episodes: [], userMessages: [], conversationIds: [], anchor: ANCLA });
    expect(d.conversations).toEqual({ total: 0, cataloged: 0, gapOnly: 0, withoutEpisodes: 0 });
    expect(d.episodes).toEqual({
      total: 0,
      cataloged: 0,
      firstDay: null,
      lastDay: null,
      distinctDays: 0,
    });
    expect(d.dateRecall).toEqual({ tested: 0, hits: 0, misses: 0, missedDays: [] });
    expect(d.style.medianChars).toBe(0);
  });

  it('separa las catalogadas de las que solo se trocean por pausas', () => {
    const d = diagnoseMemory({
      episodes: [
        episodio({ conversationId: 'c1', startedAt: '2026-09-07T18:00:00Z', catalogedBy: 'codex' }),
        episodio({ conversationId: 'c1', startedAt: '2026-09-08T18:00:00Z', catalogedBy: 'codex' }),
        episodio({ conversationId: 'c2', startedAt: '2026-09-09T18:00:00Z' }),
      ],
      userMessages: [],
      // c3 no tiene episodios: vacia, o de otro personaje
      conversationIds: ['c1', 'c2', 'c3'],
      anchor: ANCLA,
    });
    expect(d.conversations).toEqual({ total: 3, cataloged: 1, gapOnly: 1, withoutEpisodes: 1 });
    expect(d.episodes.total).toBe(3);
    expect(d.episodes.cataloged).toBe(2);
    expect(d.episodes.firstDay).toBe('2026-09-07');
    expect(d.episodes.lastDay).toBe('2026-09-09');
    expect(d.episodes.distinctDays).toBe(3);
  });

  it('una charla de madrugada cuenta en el dia civil anterior, no en el del calendario', () => {
    const d = diagnoseMemory({
      episodes: [
        // 20:00 del miercoles en Madrid
        episodio({ conversationId: 'c1', startedAt: '2026-09-09T18:00:00Z' }),
        // 04:30 del jueves en Madrid: todavia es la noche del miercoles
        episodio({ conversationId: 'c2', startedAt: '2026-09-10T02:30:00Z' }),
      ],
      userMessages: [],
      conversationIds: ['c1', 'c2'],
      anchor: ANCLA,
    });
    expect(d.episodes.distinctDays).toBe(1);
    expect(d.episodes.firstDay).toBe('2026-09-09');
    expect(d.episodes.lastDay).toBe('2026-09-09');
  });

  it('la pregunta por fecha encuentra cada dia en que se hablo, madrugadas incluidas', () => {
    const d = diagnoseMemory({
      episodes: [
        episodio({ conversationId: 'c1', startedAt: '2026-09-07T18:00:00Z' }),
        // pasada la medianoche UTC y la local, antes de las cinco
        episodio({ conversationId: 'c2', startedAt: '2026-09-09T01:00:00Z' }),
        // dos el mismo dia: se elige el mas largo y sigue siendo ese dia
        episodio({ conversationId: 'c3', startedAt: '2026-09-10T08:00:00Z', turns: 2 }),
        episodio({ conversationId: 'c3', startedAt: '2026-09-10T16:00:00Z', from: 5, to: 30, turns: 26 }),
      ],
      userMessages: [],
      conversationIds: ['c1', 'c2', 'c3'],
      anchor: ANCLA,
    });
    expect(d.dateRecall.tested).toBe(3);
    expect(d.dateRecall.hits).toBe(3);
    expect(d.dateRecall.misses).toBe(0);
    expect(d.dateRecall.missedDays).toEqual([]);
  });

  it('el estilo cuenta patrones, no guarda frases', () => {
    const d = diagnoseMemory({
      episodes: [],
      userMessages: [
        '¿te acuerdas del faro?',
        'hoy me duele la cabeza',
        '¿de qué hablamos ayer?',
        'hola',
      ],
      conversationIds: [],
      anchor: ANCLA,
    });
    expect(d.style.userMessages).toBe(4);
    expect(d.style.withMemoryRequest).toBe(1);
    expect(d.style.withConversationRecall).toBe(1);
    expect(d.style.withTemporalReference).toBe(2);
    // el resultado solo lleva numeros: ninguna frase del usuario viaja en el
    expect(JSON.stringify(d)).not.toContain('faro');
    expect(JSON.stringify(d)).not.toContain('cabeza');
  });

  it('la mediana de longitud sirve con numero par e impar de mensajes', () => {
    const impar = diagnoseMemory({
      episodes: [],
      userMessages: ['a', 'abc', 'abcdefg'],
      conversationIds: [],
      anchor: ANCLA,
    });
    expect(impar.style.medianChars).toBe(3);
    const par = diagnoseMemory({
      episodes: [],
      userMessages: ['ab', 'abcd'],
      conversationIds: [],
      anchor: ANCLA,
    });
    expect(par.style.medianChars).toBe(3);
  });
});
