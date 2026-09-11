import { describe, expect, it } from 'vitest';
import type { TemporalAnchor } from '@luxy/shared';
import type { Episode } from './episodes.js';
import { diagnoseMemory, type DiagnosticMessage } from './memory-diagnostics.js';

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

function dice(
  text: string,
  createdAt = '2026-09-11T10:00:00Z',
  conversationId = 'otra',
  sequence = 1,
): DiagnosticMessage {
  return { text, createdAt, conversationId, sequence };
}

const SIN_DISPAROS = {
  byOrigin: 0,
  byDate: 0,
  byWords: 0,
  dateWithoutQuestion: 0,
  dateWithoutMoment: 0,
  dateInHistory: 0,
};

describe('diagnoseMemory', () => {
  it('sin nada que mirar devuelve ceros, no revienta', () => {
    const d = diagnoseMemory({ episodes: [], userMessages: [], conversationIds: [], anchor: ANCLA });
    expect(d.scope).toEqual({ otherConversations: 0, characterName: null });
    expect(d.conversations).toEqual({ total: 0, cataloged: 0, gapOnly: 0, withoutEpisodes: 0 });
    expect(d.episodes).toEqual({
      total: 0,
      cataloged: 0,
      firstDay: null,
      lastDay: null,
      distinctDays: 0,
    });
    expect(d.index).toEqual({ cap: 40, lines: 0, omitted: 0, firstInIndex: false });
    expect(d.dateRecall).toEqual({ tested: 0, hits: 0, misses: 0, missedDays: [] });
    expect(d.origin.found).toBe(0);
    expect(d.origin.day).toBeNull();
    expect(d.triggers).toEqual(SIN_DISPAROS);
    expect(d.style.medianChars).toBe(0);
  });

  it('separa las catalogadas de las que solo se trocean por pausas', () => {
    const d = diagnoseMemory({
      episodes: [
        episodio({ conversationId: 'c2', startedAt: '2026-09-09T18:00:00Z' }),
        episodio({ conversationId: 'c1', startedAt: '2026-09-08T18:00:00Z', catalogedBy: 'codex' }),
        episodio({ conversationId: 'c1', startedAt: '2026-09-07T18:00:00Z', catalogedBy: 'codex' }),
      ],
      userMessages: [],
      // c3 no tiene episodios: vacia, o de otro personaje
      conversationIds: ['c1', 'c2', 'c3'],
      anchor: ANCLA,
      otherConversations: 2,
      characterName: 'Lía',
    });
    expect(d.scope).toEqual({ otherConversations: 2, characterName: 'Lía' });
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
        // 04:30 del jueves en Madrid: todavia es la noche del miercoles
        episodio({ conversationId: 'c2', startedAt: '2026-09-10T02:30:00Z' }),
        // 20:00 del miercoles en Madrid
        episodio({ conversationId: 'c1', startedAt: '2026-09-09T18:00:00Z' }),
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
        // dos el mismo dia: se elige el mas largo y sigue siendo ese dia
        episodio({ conversationId: 'c3', startedAt: '2026-09-10T16:00:00Z', from: 5, to: 30, turns: 26 }),
        episodio({ conversationId: 'c3', startedAt: '2026-09-10T08:00:00Z', turns: 2 }),
        // pasada la medianoche UTC y la local, antes de las cinco
        episodio({ conversationId: 'c2', startedAt: '2026-09-09T01:00:00Z' }),
        episodio({ conversationId: 'c1', startedAt: '2026-09-07T18:00:00Z' }),
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

  it('pasado el tope, el primero de todos sigue en el indice', () => {
    const d = diagnoseMemory({
      episodes: [
        episodio({ conversationId: 'c3', startedAt: '2026-09-09T18:00:00Z' }),
        episodio({ conversationId: 'c2', startedAt: '2026-09-08T18:00:00Z' }),
        episodio({ conversationId: 'c1', startedAt: '2026-09-07T18:00:00Z' }),
      ],
      userMessages: [],
      conversationIds: ['c1', 'c2', 'c3'],
      anchor: ANCLA,
      indexCap: 2,
    });
    expect(d.index).toEqual({ cap: 2, lines: 2, omitted: 1, firstInIndex: true });
  });

  it('todas las formas corrientes de preguntar por el principio lo reconocen', () => {
    const d = diagnoseMemory({
      episodes: [
        episodio({ conversationId: 'c2', startedAt: '2026-09-09T18:00:00Z' }),
        episodio({ conversationId: 'c1', startedAt: '2026-09-07T18:00:00Z' }),
      ],
      userMessages: [],
      conversationIds: ['c1', 'c2'],
      anchor: ANCLA,
    });
    expect(d.origin.found).toBe(d.origin.probes);
    expect(d.origin.probes).toBeGreaterThanOrEqual(10);
    expect(d.origin.day).toBe('2026-09-07');
  });

  it('el estilo cuenta patrones, no guarda frases', () => {
    const d = diagnoseMemory({
      episodes: [],
      userMessages: [
        dice('¿te acuerdas del faro?'),
        dice('hoy me duele la cabeza'),
        dice('¿de qué hablamos ayer?'),
        // el principio no es una fecha: no cuenta en withTemporalReference
        dice('¿te acuerdas de cuando nos conocimos?'),
        dice('hola'),
      ],
      conversationIds: [],
      anchor: ANCLA,
    });
    expect(d.style.userMessages).toBe(5);
    expect(d.style.withMemoryRequest).toBe(2);
    expect(d.style.withConversationRecall).toBe(1);
    expect(d.style.withTemporalReference).toBe(2);
    // el resultado solo lleva numeros: ninguna frase del usuario viaja en el
    expect(JSON.stringify(d)).not.toContain('faro');
    expect(JSON.stringify(d)).not.toContain('cabeza');
  });

  it('la mediana de longitud sirve con numero par e impar de mensajes', () => {
    const impar = diagnoseMemory({
      episodes: [],
      userMessages: [dice('a'), dice('abc'), dice('abcdefg')],
      conversationIds: [],
      anchor: ANCLA,
    });
    expect(impar.style.medianChars).toBe(3);
    const par = diagnoseMemory({
      episodes: [],
      userMessages: [dice('ab'), dice('abcd')],
      conversationIds: [],
      anchor: ANCLA,
    });
    expect(par.style.medianChars).toBe(3);
  });

  it('cada mensaje real se pasa por la memoria tal y como estaba al escribirlo', () => {
    const d = diagnoseMemory({
      episodes: [
        episodio({ conversationId: 'c2', startedAt: '2026-09-09T18:00:00Z' }),
        episodio({ conversationId: 'c1', startedAt: '2026-09-07T18:00:00Z' }),
      ],
      userMessages: [
        // el jueves 10: «ayer» es el miercoles 9, que tuvo conversacion
        dice('¿de qué hablamos ayer?', '2026-09-10T10:00:00Z', 'c3', 1),
        dice('¿te acuerdas de cómo nos conocimos?', '2026-09-10T10:05:00Z', 'c3', 3),
        dice('¿te acuerdas del faro?', '2026-09-10T10:10:00Z', 'c3', 5),
        // una fecha sin preguntar nada: no dispara, y es lo correcto
        dice('hoy estoy cansado', '2026-09-10T10:15:00Z', 'c3', 7),
        // el sabado 12: «ayer» es el viernes 11, en el que no se hablo
        dice('¿de qué hablamos ayer?', '2026-09-12T10:00:00Z', 'c3', 9),
      ],
      conversationIds: ['c1', 'c2', 'c3'],
      anchor: ANCLA,
    });
    expect(d.triggers).toEqual({
      byOrigin: 1,
      byDate: 1,
      byWords: 1,
      dateWithoutQuestion: 1,
      dateWithoutMoment: 1,
      dateInHistory: 0,
    });
  });

  it('lo que ya va como historial reciente no cuenta, con la misma ventana que un turno', () => {
    const d = diagnoseMemory({
      episodes: [
        episodio({
          conversationId: 'c1',
          startedAt: '2026-09-10T08:00:00Z',
          endedAt: '2026-09-10T09:00:00Z',
          from: 1,
          to: 4,
        }),
      ],
      userMessages: [
        // turno 3 de esa misma conversacion: su momento va entero en el prompt
        dice('¿de qué hablamos hoy?', '2026-09-10T08:30:00Z', 'c1', 3),
        // desde otra, mas tarde: ahi si hay algo que traer
        dice('¿de qué hablamos hoy?', '2026-09-10T15:00:00Z', 'c2', 1),
      ],
      conversationIds: ['c1', 'c2'],
      anchor: ANCLA,
    });
    expect(d.triggers.byDate).toBe(1);
    // el primero NO es un dia sin conversacion: lo de hoy ya iba en el prompt
    expect(d.triggers.dateInHistory).toBe(1);
    expect(d.triggers.dateWithoutMoment).toBe(0);
  });

  it('un momento largo que empezo antes de la ventana SI se puede traer', () => {
    // el turno 30 de una conversacion cuyo primer momento empezo en el turno 1:
    // la ventana son los ocho ultimos, asi que ese momento ya no esta en el prompt
    const d = diagnoseMemory({
      episodes: [
        episodio({
          conversationId: 'c1',
          startedAt: '2026-09-10T08:00:00Z',
          endedAt: '2026-09-10T12:00:00Z',
          from: 1,
          to: 20,
          turns: 20,
        }),
      ],
      userMessages: [dice('¿de qué hablamos esta mañana?', '2026-09-10T18:00:00Z', 'c1', 30)],
      conversationIds: ['c1'],
      anchor: ANCLA,
    });
    expect(d.triggers.byDate).toBe(1);
  });
});
