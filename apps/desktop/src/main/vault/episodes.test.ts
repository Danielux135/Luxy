// pruebas de la segmentacion en episodios.
//
// Puro y sin boveda: la segmentacion solo mira marcas de tiempo y numeros de
// turno, asi que aqui se fija exactamente donde corta y donde no.
import { describe, it, expect } from 'vitest';
import { segmentIntoEpisodes, type EpisodeTurn } from './episodes.js';

const A = 'a1111111-1111-4111-8111-111111111111';

const at = (iso: string, sequence: number, text = 'algo', role: 'user' | 'assistant' = 'user'): EpisodeTurn => ({
  conversationId: A,
  sequence,
  role,
  text,
  createdAt: iso,
});

describe('segmentacion en episodios', () => {
  it('sin turnos no hay episodios', () => {
    expect(segmentIntoEpisodes([])).toEqual([]);
  });

  it('una conversacion seguida es un solo episodio', () => {
    const episodes = segmentIntoEpisodes([
      at('2026-09-01T20:00:00.000Z', 1),
      at('2026-09-01T20:05:00.000Z', 2),
      at('2026-09-01T20:40:00.000Z', 3),
    ]);

    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ from: 1, to: 3, turns: 3 });
  });

  it('un silencio largo abre un episodio nuevo', () => {
    // la conversacion de anoche y la de esta mañana no son la misma escena
    const episodes = segmentIntoEpisodes([
      at('2026-09-01T23:00:00.000Z', 1),
      at('2026-09-01T23:10:00.000Z', 2),
      at('2026-09-02T10:00:00.000Z', 3),
    ]);

    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({ from: 1, to: 2 });
    expect(episodes[1]).toMatchObject({ from: 3, to: 3 });
  });

  it('una pausa para cenar NO abre un episodio nuevo', () => {
    const episodes = segmentIntoEpisodes([
      at('2026-09-01T20:00:00.000Z', 1),
      at('2026-09-01T21:30:00.000Z', 2),
    ]);
    expect(episodes).toHaveLength(1);
  });

  it('una conversacion continua NO se parte, por larga que sea', () => {
    // Lo que enseño la realidad: con conversaciones de una sentada, todos los
    // turnos estan a minutos unos de otros y cualquier corte interno es
    // inventado. Se probo cortar por el numero —partia escenas— y despues por
    // «la pausa mas larga», que resulto ser donde el usuario tardo mas en
    // escribir. Un corte falso da un titulo falso, y el titulo es de lo que
    // depende que un recuerdo se encuentre.
    const turns = Array.from({ length: 95 }, (_, index) =>
      at(new Date(Date.UTC(2026, 8, 1, 20, index)).toISOString(), index + 1),
    );

    const episodes = segmentIntoEpisodes(turns);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ from: 1, to: 95, turns: 95 });
  });

  it('una pausa larga dentro de una sesion tampoco la parte', () => {
    // dos horas de descanso no son una escena nueva: solo un descanso. Lo unico
    // que separa es un silencio de los que dejan pasar la noche
    const turns = Array.from({ length: 50 }, (_, index) => {
      const minutes = index < 30 ? index : index + 120;
      return at(new Date(Date.UTC(2026, 8, 1, 20, minutes)).toISOString(), index + 1);
    });
    expect(segmentIntoEpisodes(turns)).toHaveLength(1);
  });

  it('quien quiera un tope duro puede pedirlo', () => {
    const turns = Array.from({ length: 95 }, (_, index) =>
      at(new Date(Date.UTC(2026, 8, 1, 20, index)).toISOString(), index + 1),
    );

    const episodes = segmentIntoEpisodes(turns, { maxTurns: 40 });
    expect(episodes.map((episode) => episode.turns)).toEqual([40, 40, 15]);
    // sin perder ni repetir ningun turno
    expect(episodes[0]?.from).toBe(1);
    expect(episodes[2]?.to).toBe(95);
  });

  it('el umbral de silencio se puede ajustar', () => {
    const turns = [at('2026-09-01T20:00:00.000Z', 1), at('2026-09-01T20:30:00.000Z', 2)];
    expect(segmentIntoEpisodes(turns, { gapMs: 60_000 })).toHaveLength(2);
    expect(segmentIntoEpisodes(turns, { gapMs: 3_600_000 })).toHaveLength(1);
  });

  it('una fecha ilegible no parte la conversacion en pedazos', () => {
    // ante la duda se mantiene el tramo: es el fallo menos dañino de los dos
    const episodes = segmentIntoEpisodes([
      at('2026-09-01T20:00:00.000Z', 1),
      at('no es una fecha', 2),
      at('2026-09-01T20:10:00.000Z', 3),
    ]);
    expect(episodes).toHaveLength(1);
  });

  it('guarda el rango y las fechas, nunca el texto', () => {
    // el contenido son los turnos: duplicarlo aqui seria empezar a tener dos
    // versiones de lo mismo, y una de las dos acabaria mintiendo
    const [episode] = segmentIntoEpisodes([
      at('2026-09-01T20:00:00.000Z', 4, 'un secreto'),
      at('2026-09-01T20:01:00.000Z', 5, 'otro secreto', 'assistant'),
    ]);

    expect(episode).toMatchObject({
      conversationId: A,
      from: 4,
      to: 5,
      startedAt: '2026-09-01T20:00:00.000Z',
      endedAt: '2026-09-01T20:01:00.000Z',
    });
    expect(JSON.stringify(episode)).not.toContain('otro secreto');
  });
});

describe('titulo provisional, sin modelo', () => {
  it('sale del primer mensaje del usuario, que dice a que vino la escena', () => {
    const [episode] = segmentIntoEpisodes([
      at('2026-09-01T20:00:00.000Z', 1, '*sonrie* Buenas noches', 'assistant'),
      at('2026-09-01T20:01:00.000Z', 2, 'Hola, ¿cómo te llamas?', 'user'),
    ]);
    expect(episode?.title).toBe('Hola, ¿cómo te llamas?');
  });

  it('los asteriscos de la accion no ensucian el titulo', () => {
    const [episode] = segmentIntoEpisodes([
      at('2026-09-01T20:00:00.000Z', 1, '*Le abrazo*   Me quedo contigo'),
    ]);
    expect(episode?.title).toBe('Le abrazo Me quedo contigo');
  });

  it('un mensaje largo se recorta con puntos suspensivos', () => {
    const [episode] = segmentIntoEpisodes([
      at('2026-09-01T20:00:00.000Z', 1, 'palabra '.repeat(40)),
    ]);
    expect(episode!.title.length).toBeLessThanOrEqual(70);
    expect(episode!.title.endsWith('…')).toBe(true);
  });

  it('sin ningun turno del usuario vale el primero que haya', () => {
    const [episode] = segmentIntoEpisodes([
      at('2026-09-01T20:00:00.000Z', 1, 'solo hablo yo', 'assistant'),
    ]);
    expect(episode?.title).toBe('solo hablo yo');
  });

  it('un turno sin texto util no deja el titulo vacio', () => {
    const [episode] = segmentIntoEpisodes([at('2026-09-01T20:00:00.000Z', 1, '***')]);
    expect(episode?.title).toBe('sin contenido');
  });
});
