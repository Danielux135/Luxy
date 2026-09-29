// la medida del blanqueo (`D-105`). Todo el texto es inventado.
import { describe, expect, it } from 'vitest';
import type { ConversationMemory, RecentPhrase } from '@luxy/shared';
import { RECENT_ECHO_FORMAT, measureRecentEcho } from './recent-echo.js';

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

const FRASE: RecentPhrase = {
  text: 'Subieron juntos al faro inventado de la isla de niebla',
  field: 'resumen',
};

/** todas las hojas, a cualquier profundidad */
function hojas(value: unknown): unknown[] {
  if (value === null || typeof value !== 'object') return [value];
  return Object.values(value).flatMap((each) => hojas(each));
}

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

  it('sin nada en comun, todo a cero salvo las entradas y las frases', () => {
    const eco = measureRecentEcho({
      memory: memoria({ summary: 'Pintaron una pared azul.' }),
      phrases: [FRASE],
      turns: [],
    });
    // la forma EXACTA: va al registro, y una clave de mas saldria a disco sin
    // que ninguna prueba lo viera
    expect(eco).toEqual({
      formato: RECENT_ECHO_FORMAT,
      entradas: 1,
      frases: 1,
      frasesDeUnaRaiz: 0,
      raicesComunes: 0,
      conFrasesDeRecientes: 0,
      sinApoyoAqui: 0,
      porCampo: {
        resumen: { frases: 1, con: 0, sinApoyo: 0 },
        hechos: { frases: 0, con: 0, sinApoyo: 0 },
        decisiones: { frases: 0, con: 0, sinApoyo: 0 },
        lecciones: { frases: 0, con: 0, sinApoyo: 0 },
      },
      control: null,
    });
  });

  it('solo devuelve enteros, tambien por campo y en el control', () => {
    const eco = measureRecentEcho({
      memory: memoria(),
      phrases: [FRASE],
      turns: [],
      control: [{ text: 'Cocinaron un guiso de lentejas inventado', field: 'hechos' }],
    });
    expect(eco.control).not.toBeNull();
    const valores = hojas(eco);
    expect(valores.length).toBeGreaterThan(10);
    for (const value of valores) expect(Number.isInteger(value)).toBe(true);
  });

  // quinta ronda de `D-105`: sin el numero de frases, la version corta y la
  // entera no se podian comparar
  it('`frases` cuenta las que viajaron, y `porCampo` dice de donde casa', () => {
    const eco = measureRecentEcho({
      memory: memoria({ facts: ['El la llama capitana inventada del faro'] }),
      phrases: [
        FRASE,
        { text: 'El la llama capitana inventada del faro', field: 'hechos' },
        { text: 'Leccion inventada sobre el te', field: 'lecciones' },
      ],
      turns: [],
    });
    expect(eco.frases).toBe(3);
    expect(eco.porCampo.hechos).toMatchObject({ frases: 1 });
    expect(eco.porCampo.hechos.con).toBeGreaterThanOrEqual(1);
    expect(eco.porCampo.hechos.sinApoyo).toBe(eco.porCampo.hechos.con);
    expect(eco.porCampo.lecciones).toEqual({ frases: 1, con: 0, sinApoyo: 0 });
  });

  it('las frases de una sola raiz se cuentan aparte: casan con una palabra', () => {
    const eco = measureRecentEcho({
      memory: memoria(),
      phrases: [{ text: 'Faro.', field: 'resumen' }, FRASE],
      turns: [],
    });
    expect(eco.frasesDeUnaRaiz).toBe(1);
  });

  it('un control con las mismas frases que viajaron no deja nada con que comparar', () => {
    const frases: RecentPhrase[] = [
      FRASE,
      { text: 'Cenaron sopa de marisco inventada en el puerto', field: 'hechos' },
    ];
    const eco = measureRecentEcho({
      memory: memoria({ facts: ['Cenaron sopa de marisco inventada'] }),
      phrases: frases,
      turns: [],
      // lo mismo, visto como si fuera de la tercera: TODO viajo, asi que nada
      // sirve de control
      control: frases,
    });
    expect(eco.control).toEqual({
      frases: 0,
      excluidas: 2,
      excluidasEnviadas: 2,
      igualadas: 0,
      enviadas: { con: 0, sinApoyo: 0 },
      control: { con: 0, sinApoyo: 0 },
    });
  });

  // la refutacion de la quinta ronda: la primera pudo copiar de la tercera
  // cuando la tercera era de sus recientes, y ese texto ya viajo. Y la de la
  // septima: se quita de LOS DOS lados, o el apodo compartido cuenta en uno solo
  it('lo que comparten la tercera y las que viajaron se quita de los dos lados, y se cuenta', () => {
    const apodo: RecentPhrase = { text: 'El la llama pequeña inventada del faro', field: 'hechos' };
    const eco = measureRecentEcho({
      // sale en esta conversacion: no es copia de nadie
      memory: memoria({ summary: 'Él la llama pequeña inventada del faro.' }),
      phrases: [
        apodo,
        { text: 'Navegaron hasta la cala escondida', field: 'hechos' },
        { text: 'Pintaron la verja del jardin', field: 'hechos' },
      ],
      turns: [],
      control: [
        apodo,
        { text: 'Adoptaron un gato naranja en el mercado', field: 'hechos' },
        { text: 'Hornearon pan de centeno', field: 'hechos' },
      ],
    });
    expect(eco.control).toMatchObject({ frases: 2, excluidas: 1, excluidasEnviadas: 1, igualadas: 2 });
    // el apodo no cuenta en NINGUN lado: las dos cifras miden lo mismo
    expect(eco.control?.enviadas).toEqual({ con: 0, sinApoyo: 0 });
    expect(eco.control?.control).toEqual({ con: 0, sinApoyo: 0 });
    // y la medida principal no cambia: el apodo casa con lo que viajo
    expect(eco.conFrasesDeRecientes).toBe(1);
  });

  it('las dos medidas del control usan el MISMO numero de frases', () => {
    const muchas: RecentPhrase[] = Array.from({ length: 9 }, (_, i) => ({
      text: `Frase inventada numero ${i} sobre barcos distintos del puerto ${i}`,
      field: 'resumen',
    }));
    const eco = measureRecentEcho({
      memory: memoria(),
      phrases: muchas,
      turns: [],
      control: [
        { text: 'Una cometa roja inventada', field: 'hechos' },
        { text: 'Un pastel de limon inventado', field: 'hechos' },
      ],
    });
    expect(eco.frases).toBe(9);
    expect(eco.control?.igualadas).toBe(2);
  });

  // octava ronda: las memorias van en tercera persona y casi todas sus frases
  // nombran a los dos. Con los nombres contando, cualquier par casaba
  it('los nombres no bastan para casar: ni el suyo ni el de Daniel', () => {
    const eco = measureRecentEcho({
      memory: memoria({ summary: 'Lía y Daniel hablaron del viaje a la sierra.' }),
      phrases: [{ text: 'Lía y Daniel cenaron juntos.', field: 'resumen' }],
      turns: [],
      control: [{ text: 'Lía y Daniel se bañaron en el río.', field: 'resumen' }],
      ignoreWords: ['Lía'],
    });
    expect(eco.conFrasesDeRecientes).toBe(0);
    expect(eco.sinApoyoAqui).toBe(0);
    // y el control no se vacia por un «solapamiento» que solo eran los nombres
    expect(eco.control).toMatchObject({ excluidas: 0, excluidasEnviadas: 0, igualadas: 1 });
    expect(eco.raicesComunes).toBe(1);
  });

  it('el nombre propio que sale en casi todas no cuenta; uno de pasada si', () => {
    const enviadas: RecentPhrase[] = [
      { text: 'Lía y Daniel cenaron juntos en la terraza.', field: 'resumen' },
      { text: 'Ella le dijo a Daniel que odia madrugar.', field: 'hechos' },
      { text: 'Lía le regaló a Daniel un libro de poemas.', field: 'hechos' },
      { text: 'Prometieron volver a Toledo en otoño.', field: 'decisiones' },
    ];
    const eco = measureRecentEcho({
      // comparte con la primera solo los nombres y «juntos»: no es copia
      memory: memoria({ summary: 'Lía y Daniel pasearon juntos por el parque.' }),
      phrases: enviadas,
      turns: [],
      ignoreWords: ['Lía'],
    });
    expect(eco.conFrasesDeRecientes).toBe(0);
    // «lia» por la ficha y «daniel» por salir en tres de cuatro; «Toledo» sale
    // en una sola y sigue contando
    expect(eco.raicesComunes).toBe(2);
    const toledo = measureRecentEcho({
      memory: memoria({ summary: 'Quedaron en volver a Toledo en otoño.' }),
      phrases: enviadas,
      turns: [],
      ignoreWords: ['Lía'],
    });
    expect(toledo.conFrasesDeRecientes).toBe(1);
  });

  it('sin tercera, el control es null', () => {
    const eco = measureRecentEcho({
      memory: memoria(),
      phrases: [FRASE],
      turns: [],
      control: null,
    });
    expect(eco.control).toBeNull();
  });
});
