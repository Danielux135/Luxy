// pruebas del catalogo de escenas.
//
// Lo que se fija aqui es sobre todo QUE SE RECHAZA. El catalogador es un modelo
// y puede devolver rangos que no cuadran; aceptarlos produciria episodios que no
// corresponden a lo que dicen sus titulos, que es peor que quedarse con la
// segmentacion por silencios: esa sera tosca, pero nunca miente.
import { describe, it, expect } from 'vitest';
import {
  CATALOG_CLOSE,
  CATALOG_MAX_TURNS,
  CATALOG_OPEN,
  buildCatalogPrompt,
  parseCatalogResponse,
  type CatalogTurn,
} from './vault-catalog.js';

const turn = (sequence: number, text: string, role: 'user' | 'assistant' = 'user'): CatalogTurn => ({
  sequence,
  role,
  text,
});

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
