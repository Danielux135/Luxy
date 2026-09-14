// pruebas del catalogo de escenas.
//
// Lo que se fija aqui es sobre todo QUE SE RECHAZA. El catalogador es un modelo
// y puede devolver rangos que no cuadran; aceptarlos produciria episodios que no
// corresponden a lo que dicen sus titulos, que es peor que quedarse con la
// segmentacion por silencios: esa sera tosca, pero nunca miente.
import { describe, it, expect } from 'vitest';
import {
  CATALOG_CLOSE,
  CATALOG_CUT_MARK,
  CATALOG_MAX_TURNS,
  CATALOG_OPEN,
  CATALOG_PROMPT_CHARS,
  CATALOG_TURN_CHARS,
  buildCatalogPrompt,
  clipMiddle,
  describeCatalogFailure,
  detectEvenSplit,
  flattenTurnText,
  parseCatalogResponse,
  turnAllowance,
  type CatalogTurn,
  type CatalogedScene,
} from './vault-catalog.js';

const turn = (sequence: number, text: string, role: 'user' | 'assistant' = 'user'): CatalogTurn => ({
  sequence,
  role,
  text,
});

/** la linea de datos de un turno concreto, sin su prefijo */
const shownText = (prompt: string, sequence: number): string =>
  prompt
    .split('\n')
    .find((line) => line.startsWith(`[${sequence}] `))
    ?.replace(/^\[\d+\] (Usuario|Personaje): /, '') ?? '';

const shownTexts = (prompt: string): string[] =>
  prompt
    .split('\n')
    .filter((line) => /^\[\d+\] (Usuario|Personaje): /.test(line))
    .map((line) => line.replace(/^\[\d+\] (Usuario|Personaje): /, ''));

/** un catalogo con los tamaños dados, seguidos y sin huecos */
const catalogOf = (...sizes: number[]): CatalogedScene[] => {
  let start = 0;
  return sizes.map((size) => {
    const scene: CatalogedScene = {
      from: start,
      to: start + size - 1,
      title: 'una escena',
      tags: [],
      summary: '',
    };
    start += size;
    return scene;
  });
};

const bloque = (json: string): string => `${CATALOG_OPEN}\n${json}\n${CATALOG_CLOSE}`;

const escena = (from: number, to: number, title = 'una escena') =>
  `{"from":${from},"to":${to},"title":"${title}","tags":["algo"],"summary":"pasa algo"}`;

describe('prompt del catalogador', () => {
  const turns = [turn(0, '¿cómo te llamas?'), turn(1, 'Me llamo Luxy', 'assistant')];

  it('no le pide encarnar a nadie: es una tarea tecnica', () => {
    const prompt = buildCatalogPrompt(turns);
    expect(prompt).toContain('No la continues');
    expect(prompt).not.toContain('encarnando');
    expect(prompt).not.toContain('en primera persona');
  });

  it('le da la conversacion como DATOS', () => {
    expect(buildCatalogPrompt(turns)).toContain('CONVERSACION (DATOS):');
  });

  it('dice donde empieza y acaba el tramo, que es lo que luego se comprueba', () => {
    const prompt = buildCatalogPrompt([turn(7, 'hola'), turn(8, 'adios')]);
    expect(prompt).toContain('la primera empieza en 7');
    expect(prompt).toContain('la ultima acaba en 8');
  });

  it('pide etiquetas que NO estan escritas, que es lo que resuelve la parafrasis', () => {
    const prompt = buildCatalogPrompt(turns);
    expect(prompt).toContain('incluidas las que');
    expect(prompt).toContain('primer encuentro');
  });

  it('prohibe partir por longitud, que es justo lo que fallaba', () => {
    expect(buildCatalogPrompt(turns)).toContain('No partas por longitud');
  });

  it('dice que una escena puede durar muchos turnos', () => {
    // sin esto, una conversacion seguida no tiene ningun corte que cumpla los
    // criterios, y el modelo se inventa uno cada pocos turnos
    const prompt = buildCatalogPrompt(turns);
    expect(prompt).toContain('durar MUCHOS turnos');
    expect(prompt).toContain('POCAS escenas largas');
    expect(prompt).toContain('sigue siendo la misma escena');
  });

  it('dice que trozos del mismo tamaño son la señal de haberlo hecho mal', () => {
    // prohibir sin decir la alternativa dejaba el hueco que rellena la costumbre
    expect(buildCatalogPrompt(turns)).toContain('tamaño parecido, lo has hecho mal');
  });

  it('recorta cada turno y acota cuantos enseña', () => {
    const muchos = Array.from({ length: 200 }, (_, index) => turn(index, 'x'.repeat(2000)));
    const prompt = buildCatalogPrompt(muchos);
    expect(prompt).toContain(`[${CATALOG_MAX_TURNS - 1}]`);
    expect(prompt).not.toContain(`[${CATALOG_MAX_TURNS}]`);
    expect(prompt).toContain('…');
  });
});

describe('respuesta del catalogador', () => {
  const rango = { from: 0, to: 9 };

  it('acepta un catalogo que cubre el tramo entero', () => {
    const parsed = parseCatalogResponse(
      bloque(`[${escena(0, 4, 'se presentan')},${escena(5, 9, 'se despiden')}]`),
      rango,
    );
    expect(parsed.status).toBe('structured');
    expect(parsed.scenes).toHaveLength(2);
    expect(parsed.scenes[0]?.title).toBe('se presentan');
  });

  it('una sola escena tambien vale', () => {
    const parsed = parseCatalogResponse(bloque(`[${escena(0, 9)}]`), rango);
    expect(parsed.status).toBe('structured');
  });

  it('ordena las escenas aunque lleguen desordenadas', () => {
    const parsed = parseCatalogResponse(
      bloque(`[${escena(5, 9, 'segunda')},${escena(0, 4, 'primera')}]`),
      rango,
    );
    expect(parsed.scenes.map((scene) => scene.title)).toEqual(['primera', 'segunda']);
  });

  it('tolera la cerca Markdown que a veces añade igual', () => {
    const parsed = parseCatalogResponse(
      `${CATALOG_OPEN}\n\`\`\`json\n[${escena(0, 9)}]\n\`\`\`\n${CATALOG_CLOSE}`,
      rango,
    );
    expect(parsed.status).toBe('structured');
  });
});

describe('lo que se rechaza en bloque', () => {
  const rango = { from: 0, to: 9 };

  it('un hueco entre escenas', () => {
    // los turnos del hueco no perteneceran a ningun episodio y desapareceran
    const parsed = parseCatalogResponse(
      bloque(`[${escena(0, 3)},${escena(6, 9)}]`),
      rango,
    );
    expect(parsed.status).toBe('invalid');
    expect(parsed.reason).toContain('hueco');
  });

  it('escenas que se pisan', () => {
    const parsed = parseCatalogResponse(bloque(`[${escena(0, 6)},${escena(4, 9)}]`), rango);
    expect(parsed.status).toBe('invalid');
  });

  it('un catalogo que no llega al final del tramo', () => {
    const parsed = parseCatalogResponse(bloque(`[${escena(0, 5)}]`), rango);
    expect(parsed.status).toBe('invalid');
    expect(parsed.reason).toContain('no acaba donde acaba');
  });

  it('un catalogo que no empieza donde empieza el tramo', () => {
    const parsed = parseCatalogResponse(bloque(`[${escena(2, 9)}]`), rango);
    expect(parsed.status).toBe('invalid');
    expect(parsed.reason).toContain('no empieza donde empieza');
  });

  it('una escena que acaba antes de empezar', () => {
    const parsed = parseCatalogResponse(bloque(`[${escena(0, 9)},${escena(10, 4)}]`), rango);
    expect(parsed.status).toBe('invalid');
  });

  it('un titulo largo se RECORTA, no tira el catalogo entero', () => {
    // la primera version rechazaba por pasarse de 90 caracteres, y dejaba la
    // conversacion sin catalogar por algo cosmetico. Asi fallaron dos de verdad
    const largo = 'x'.repeat(300);
    const parsed = parseCatalogResponse(
      bloque(`[{"from":0,"to":9,"title":"${largo}","tags":[],"summary":""}]`),
      rango,
    );
    expect(parsed.status).toBe('structured');
    expect(parsed.scenes[0]!.title.length).toBeLessThanOrEqual(90);
  });

  it('las etiquetas raras se limpian en vez de tirarlo todo', () => {
    const parsed = parseCatalogResponse(
      bloque(
        `[{"from":0,"to":9,"title":"t","tags":["a","${'y'.repeat(200)}",7,null,"primer encuentro"],"summary":""}]`,
      ),
      rango,
    );
    expect(parsed.status).toBe('structured');
    // se cae la de una letra, se cae lo que no es texto, y la larga se recorta
    expect(parsed.scenes[0]!.tags).toContain('primer encuentro');
    expect(parsed.scenes[0]!.tags.every((tag) => tag.length <= 40)).toBe(true);
  });

  it('acepta la lista envuelta en un objeto', () => {
    // devolver {"escenas": [...]} en vez de la lista pelada es comun, y tirar
    // un catalogo correcto por como viene envuelto no tiene sentido
    const parsed = parseCatalogResponse(bloque(`{"escenas":[${escena(0, 9)}]}`), rango);
    expect(parsed.status).toBe('structured');
  });

  it('cuando se rechaza, dice QUE campo falla', () => {
    // «no tienen la forma esperada» no dejaba arreglar nada
    const parsed = parseCatalogResponse(
      bloque('[{"from":"cero","to":9,"title":"t","tags":[],"summary":""}]'),
      rango,
    );
    expect(parsed.status).toBe('invalid');
    expect(parsed.reason).toContain('from');
  });

  it('un titulo vacio', () => {
    const parsed = parseCatalogResponse(
      bloque('[{"from":0,"to":9,"title":"","tags":[],"summary":""}]'),
      rango,
    );
    expect(parsed.status).toBe('invalid');
  });

  it('una lista vacia no es un catalogo', () => {
    expect(parseCatalogResponse(bloque('[]'), rango).status).toBe('invalid');
  });
});

describe('el motivo que se le enseña a una persona', () => {
  const rango = { from: 0, to: 9 };

  it('cuando no escribe el bloque, dice QUE dijo en su lugar', () => {
    // «absent» no es un mensaje, es el nombre de un estado. Y sin saber que
    // contesto no se distingue «no supo» de «se nego a catalogarlo», que se
    // arreglan de formas muy distintas
    const said = 'Lo siento, pero no puedo ayudarte a catalogar ese contenido.';
    const parsed = parseCatalogResponse(said, rango);

    const motivo = describeCatalogFailure(parsed, said);
    expect(motivo).toContain('no escribio el bloque');
    expect(motivo).toContain('no puedo ayudarte');
  });

  it('recorta lo que dijo: es una pista, no un volcado', () => {
    const said = 'x'.repeat(5000);
    expect(describeCatalogFailure(parseCatalogResponse(said, rango), said).length).toBeLessThan(250);
  });

  it('un bloque cortado se explica como lo que es', () => {
    const said = `${CATALOG_OPEN}
[{"from":0`;
    expect(describeCatalogFailure(parseCatalogResponse(said, rango), said)).toContain(
      'se corto a medias',
    );
  });

  it('un bloque invalido conserva el campo que falla', () => {
    const said = bloque('[{"from":"cero","to":9,"title":"t","tags":[],"summary":""}]');
    expect(describeCatalogFailure(parseCatalogResponse(said, rango), said)).toContain('from');
  });

  it('sin respuesta ninguna tambien se entiende', () => {
    expect(describeCatalogFailure(parseCatalogResponse('', rango), '')).toContain('no dijo nada');
  });
});

describe('respuestas que no llegaron a serlo', () => {
  const rango = { from: 0, to: 9 };

  it('sin bloque no hay catalogo, y no es un fallo', () => {
    expect(parseCatalogResponse('no me apetece', rango).status).toBe('absent');
  });

  it('un bloque cortado se distingue de uno que no vino', () => {
    // «se corto» avisa de que la respuesta se quedo sin sitio; «no vino» no
    const parsed = parseCatalogResponse(`${CATALOG_OPEN}\n[{"from":0`, rango);
    expect(parsed.status).toBe('truncated_block');
  });

  it('un bloque que no es JSON', () => {
    const parsed = parseCatalogResponse(bloque('esto no es json'), rango);
    expect(parsed.status).toBe('invalid');
    expect(parsed.reason).toContain('JSON');
  });

  it('nada de esto lanza: un catalogo malo no puede tumbar un turno', () => {
    for (const entrada of ['', CATALOG_OPEN, CATALOG_CLOSE, bloque('null'), bloque('{}')]) {
      expect(() => parseCatalogResponse(entrada, rango)).not.toThrow();
    }
  });
});

describe('lo que se ve de cada turno', () => {
  it('un turno largo conserva su principio Y su final', () => {
    // recortar por el final dejaba el arranque de todos los turnos, que se
    // parecen entre si, y perdia justo donde una escena se cierra o gira
    const prompt = buildCatalogPrompt([
      turn(0, `EMPIEZA_AQUI ${'x'.repeat(4000)} ACABA_AQUI`),
    ]);
    const shown = shownText(prompt, 0);

    expect(shown.startsWith('EMPIEZA_AQUI')).toBe(true);
    expect(shown.endsWith('ACABA_AQUI')).toBe(true);
    expect(shown).toContain('[…recorte…]');
    expect(shown.length).toBeLessThanOrEqual(CATALOG_TURN_CHARS);
  });

  it('un turno que cabe no se toca', () => {
    const texto = 'me quedé dormida en el sofá y me despertaste tú';
    expect(shownText(buildCatalogPrompt([turn(0, texto)]), 0)).toBe(texto);
  });

  it('el presupuesto global se respeta aunque todos los turnos sean largos', () => {
    const muchos = Array.from({ length: CATALOG_MAX_TURNS }, (_, index) =>
      turn(index, 'x'.repeat(5000)),
    );
    const textos = shownTexts(buildCatalogPrompt(muchos));

    expect(textos).toHaveLength(CATALOG_MAX_TURNS);
    expect(textos.reduce((total, texto) => total + texto.length, 0)).toBeLessThanOrEqual(
      CATALOG_PROMPT_CHARS,
    );
    // y aun asi cada uno ve mas de lo que veia antes cualquiera (600)
    expect(Math.min(...textos.map((texto) => texto.length))).toBeGreaterThan(600);
  });

  it('un turno largo entre muchos cortos se lleva el tope, no la parte igual', () => {
    // lo que no gastan los cortos se lo quedan los largos: son los unicos a los
    // que recortar les quita algo
    const cortos = Array.from({ length: CATALOG_MAX_TURNS - 1 }, (_, index) =>
      turn(index, 'vale'),
    );
    const prompt = buildCatalogPrompt([
      ...cortos,
      turn(CATALOG_MAX_TURNS - 1, 'y'.repeat(9000), 'assistant'),
    ]);

    expect(shownText(prompt, CATALOG_MAX_TURNS - 1).length).toBe(CATALOG_TURN_CHARS);
  });
});

describe('reparto uniforme', () => {
  it('marca 4+4+4+4+4+2, que es el caso real', () => {
    // 22 turnos partidos en seis trozos iguales con el resto al final: eso no lo
    // decide lo que pasa en la conversacion, lo decide contar turnos
    const signal = detectEvenSplit(catalogOf(4, 4, 4, 4, 4, 2));
    expect(signal.even).toBe(true);
    expect(signal.scenes).toBe(6);
  });

  it('no marca 9+3+10, que es un reparto sano', () => {
    expect(detectEvenSplit(catalogOf(9, 3, 10)).even).toBe(false);
  });

  it('no marca un catalogo de una sola escena ni de dos', () => {
    // coincidir de tamaño con una o dos escenas es casualidad, no evidencia
    expect(detectEvenSplit(catalogOf(22)).even).toBe(false);
    expect(detectEvenSplit(catalogOf(4, 5)).even).toBe(false);
    expect(detectEvenSplit(catalogOf(11, 11)).even).toBe(false);
  });

  it('un turno de diferencia sigue siendo el mismo tamaño', () => {
    expect(detectEvenSplit(catalogOf(4, 5, 4, 5)).even).toBe(true);
  });

  it('no marca un reparto desigual aunque acabe en un trozo corto', () => {
    expect(detectEvenSplit(catalogOf(12, 3, 7, 1)).even).toBe(false);
  });

  it('cuenta las escenas y sus extremos para poder decirlo', () => {
    const signal = detectEvenSplit(catalogOf(9, 3, 10));
    expect(signal).toEqual({ even: false, scenes: 3, shortest: 3, longest: 10 });
  });

  it('un catalogo vacio no rompe nada', () => {
    expect(detectEvenSplit([])).toEqual({ even: false, scenes: 0, shortest: 0, longest: 0 });
  });

  it('lee lo que devuelve el parser, no una lista inventada', () => {
    const parsed = parseCatalogResponse(
      `${CATALOG_OPEN}[${escena(0, 3)},${escena(4, 7)},${escena(8, 11)},${escena(12, 13)}]${CATALOG_CLOSE}`,
      { from: 0, to: 13 },
    );
    expect(parsed.status).toBe('structured');
    expect(detectEvenSplit(parsed.scenes).even).toBe(true);
  });
});

describe('las piezas de recorte exportadas', () => {
  // el extractor de pendientes recorta con estas mismas piezas, y exportarlas no
  // puede cambiar ni un caracter del prompt del catalogo. Las huellas de abajo se
  // tomaron con el codigo de ANTES de exportarlas, sobre estos mismos turnos
  const PALABRAS = ['hola', 'mañana', 'te', 'traigo', 'cafés', 'y', 'una', 'tarta', 'de', 'chocolate', '*sonríe*', '«vale»'];

  function textoDe(semilla: number, palabras: number): string {
    const trozos: string[] = [];
    for (let i = 0; i < palabras; i += 1) {
      trozos.push(PALABRAS[(semilla * 7 + i * 3) % PALABRAS.length]!);
      if (i % 17 === 16) trozos.push('\n\n');
      else if (i % 11 === 10) trozos.push('\t');
    }
    return `  ${trozos.join(' ')}  `;
  }

  const turno = (sequence: number, text: string): CatalogTurn => ({
    sequence,
    role: sequence % 2 === 0 ? 'user' : 'assistant',
    text,
  });

  // cortos: todo cabe. mezclados: 70 turnos (se enseñan 60) y el presupuesto
  // global deja cada turno por debajo de 1.400. enorme: un solo turno recortado
  const FIJOS: Record<string, CatalogTurn[]> = {
    cortos: Array.from({ length: 8 }, (_, i) => turno(i, textoDe(i, 5 + i))),
    mezclados: Array.from({ length: 70 }, (_, i) =>
      turno(i + 3, textoDe(i, i % 6 === 0 ? 12 : i % 6 === 3 ? 150 : 900)),
    ),
    enorme: [turno(0, textoDe(1, 20)), turno(1, textoDe(2, 4000)), turno(2, textoDe(3, 3))],
  };

  /** FNV-1a de 32 bits: basta para notar un caracter distinto, sin importar node:crypto */
  function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  it('el prompt del catalogo sale identico al de antes de exportarlas', () => {
    const huellas = Object.fromEntries(
      Object.entries(FIJOS).map(([nombre, turnos]) => {
        const prompt = buildCatalogPrompt(turnos);
        return [nombre, `${prompt.length}:${fnv1a(prompt)}`];
      }),
    );
    expect(huellas).toEqual({
      cortos: '2489:dbace8f4',
      mezclados: '62915:1855ad7f',
      enorme: '3575:94cfe7a7',
    });
  });

  it('las lineas de datos son exactamente las piezas exportadas', () => {
    // si el catalogo dejara de usarlas, el extractor recortaria distinto sin que
    // nada lo avisara
    for (const turnos of Object.values(FIJOS)) {
      const shown = turnos.slice(0, CATALOG_MAX_TURNS);
      const planos = shown.map((t) => flattenTurnText(t.text));
      const allowance = turnAllowance(planos.map((plano) => plano.length));
      const esperado = shown.map(
        (t, i) =>
          `[${t.sequence}] ${t.role === 'user' ? 'Usuario' : 'Personaje'}: ${clipMiddle(planos[i]!, allowance)}`,
      );
      expect(buildCatalogPrompt(turnos).endsWith(`CONVERSACION (DATOS):\n${esperado.join('\n')}`)).toBe(
        true,
      );
    }
    expect(CATALOG_CUT_MARK).toBe(' […recorte…] ');
  });

  it('el tope por turno es un parametro, y sin pasarlo el catalogo no cambia', () => {
    // el extractor de pendientes pasa uno mas alto: a una escena le basta con
    // ver como empieza y como acaba un turno, pero una promesa se dice donde se
    // diga y el centro que se quita es un agujero. Lo que no puede es cambiarle
    // el reparto al catalogo, que es lo que fija esta prueba
    // caben de sobra en los 60.000, y aun asi el catalogo los recorta a 1.400
    const caben = [4_000, 5_000, 6_000];
    // y estos no caben: hay que repartir
    const nocaben = [30_000, 40_000, 50_000];
    expect(turnAllowance(caben)).toBe(1400);
    expect(turnAllowance(nocaben)).toBe(1400);
    // con un tope alto se lleva lo que le toca del reparto, sin techo encima
    expect(turnAllowance(nocaben, 60_000)).toBe(20_000);
    // y si caben todos enteros, el tope que se pase es el que manda: con 60.000
    // ningun turno real se recorta
    expect(turnAllowance(caben, 60_000)).toBe(60_000);
  });
});
