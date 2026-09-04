// pruebas del describidor de imagenes.
//
// Lo que se fija aqui es lo que impide que este añadido empeore las cosas: un
// pie de foto inventado, o una negativa guardada como si fuera la descripcion
// de la imagen, entran en el prompt como DATOS y de ahi a la memoria como
// hechos. Es el fallo de `D-061`, y este modulo existe para no repetirlo.
import { describe, it, expect } from 'vitest';
import {
  MAX_CAPTION_CHARS,
  buildDescribePrompt,
  parseDescribeResponse,
} from './vault-describe.js';

describe('lo que se le pide al describidor', () => {
  const prompt = buildDescribePrompt();

  it('prohibe suponer y pide omitir lo dudoso', () => {
    // es la regla que separa un pie de foto util de una alucinacion con formato
    expect(prompt).toContain('SOLO lo que se ve');
    expect(prompt).toContain('NO lo escribas');
  });

  it('pide una descripcion corta', () => {
    // un describidor obligado a rellenar longitud inventa: cuanto mas largo el
    // pie de foto, menos fiable, no mas
    expect(prompt).toContain('Una o dos frases');
  });

  it('prohibe ponerle nombre a nadie', () => {
    // no puede saber quien es, y un nombre inventado se propaga a la memoria
    expect(prompt).toContain('No pongas nombres');
  });

  it('encuadra la tarea como tecnica, para que no opine', () => {
    expect(prompt).toContain('descripcion tecnica');
  });
});

describe('lo que vuelve del describidor', () => {
  it('recorta espacios y saltos: es una linea de una lista', () => {
    // un salto de linea partiria la lista de imagenes que despues lee el modelo
    const { caption } = parseDescribeResponse('  Una mujer\n  sentada en   una cama.  ');
    expect(caption).toBe('Una mujer sentada en una cama.');
  });

  it('una respuesta vacia no se guarda', () => {
    expect(parseDescribeResponse('   ')).toEqual({ caption: null, failure: 'vacio' });
  });

  it('una negativa NO se guarda como pie de foto', () => {
    // guardarla seria lo peor de los dos mundos: el modelo creeria que la imagen
    // ES esa frase, y la reenviaria describiendola asi
    const resultado = parseDescribeResponse('No puedo ayudar con esa imagen.', true);
    expect(resultado.caption).toBeNull();
    expect(resultado.failure).toBe('negativa');
  });

  it('lo vacio manda sobre la negativa: son dos arreglos distintos', () => {
    // «no contesto» se arregla reintentando; «se nego» se arregla cambiando de
    // modelo. Confundirlos manda a la solucion equivocada
    expect(parseDescribeResponse('', true).failure).toBe('vacio');
  });

  it('recorta un pie de foto demasiado largo en vez de rechazarlo', () => {
    const largo = 'a'.repeat(MAX_CAPTION_CHARS + 200);
    const { caption, failure } = parseDescribeResponse(largo);
    expect(failure).toBeNull();
    expect(caption).toHaveLength(MAX_CAPTION_CHARS);
  });
});
