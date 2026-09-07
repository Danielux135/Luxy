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
  saysNoImage,
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

describe('una respuesta que dice que no hay imagen', () => {
  // POR QUE EXISTE, y no es hipotetico: Claude Code descarta las imagenes en
  // silencio —su transporte es un CLI— y contesto «No hay ninguna imagen
  // adjunta en esta conversacion, asi que no puedo describirla». Eso es una
  // respuesta bien formada, asi que pasaba por pie de foto valido y se habria
  // guardado como lo que SE VE en una foto de la boveda. Es `D-061` una capa
  // antes y repetido en cada imagen.
  it('no se acepta como pie de foto', () => {
    const respuesta =
      'No hay ninguna imagen adjunta en esta conversación, así que no puedo describirla. ' +
      'Si la envías de nuevo, redacto el pie de foto siguiendo las reglas indicadas.';
    expect(parseDescribeResponse(respuesta)).toEqual({ caption: null, failure: 'sin-imagen' });
  });

  it('reconoce las formas habituales, con y sin acentos, en dos idiomas', () => {
    for (const texto of [
      'No hay ninguna imagen adjunta',
      'No veo ninguna imagen en esta conversacion',
      'No he recibido ninguna imagen',
      'No puedo ver la imagen que mencionas',
      'There is no image attached to this conversation',
      "I don't see an image here",
    ]) {
      expect(saysNoImage(texto)).toBe(true);
    }
  });

  it('NO confunde una descripcion normal que menciona imagenes', () => {
    // el falso positivo que importa: una descripcion legitima no puede
    // descartarse por nombrar la palabra
    for (const texto of [
      'Un gato atigrado sentado sobre una piedra, con ramas secas al fondo.',
      'Una imagen de estilo anime: chica de pelo castano en primer plano.',
      'Dos personas de espaldas frente al mar al atardecer.',
      'Captura de pantalla de un editor de codigo con texto en varias lineas.',
    ]) {
      expect(saysNoImage(texto)).toBe(false);
      expect(parseDescribeResponse(texto).caption).not.toBeNull();
    }
  });

  it('una negativa sigue siendo una negativa, no «sin imagen»', () => {
    // se arreglan distinto: una negativa pide cambiar de modelo; «sin imagen»
    // pide cambiar de PROVEEDOR, porque el transporte no la lleva
    expect(parseDescribeResponse('No puedo ayudarte con eso.', true).failure).toBe('negativa');
  });
});
