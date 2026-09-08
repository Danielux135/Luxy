// pruebas del describidor de imagenes.
//
// Lo que se fija aqui es lo que impide que este añadido empeore las cosas: un
// pie de foto inventado, o una negativa guardada como si fuera la descripcion
// de la imagen, entran en el prompt como DATOS y de ahi a la memoria como
// hechos. Es el fallo de `D-061`, y este modulo existe para no repetirlo.
import { describe, it, expect } from 'vitest';
import {
  CAPTION_TRIM_MARK,
  MAX_CAPTION_CHARS,
  buildDescribePrompt,
  MAX_REASONING_CHARS,
  REASONING_TRIM_MARK,
  parseDescribeResponse,
  saysNoImage,
  splitReasoning,
  trimWithMark,
} from './vault-describe.js';

describe('lo que se le pide al describidor', () => {
  const prompt = buildDescribePrompt();

  it('prohibe suponer y pide omitir lo dudoso', () => {
    // es la regla que separa un pie de foto util de una alucinacion con formato
    expect(prompt).toContain('SOLO lo que se ve');
    expect(prompt).toContain('se OMITE, no se estira');
  });

  it('pide DETALLE sin pedir longitud', () => {
    // Daniel pidio que se explayara. El riesgo de aflojar el «corto» es que
    // el modelo rellene, asi que el detalle se dirige por COBERTURA —que
    // puntos recorrer— y no por extension: pedir mas texto invita a inventar,
    // pedir mas campos no.
    expect(prompt).toContain('con detalle');
    expect(prompt).not.toContain('Una o dos frases');
    expect(prompt).toContain('Detallado NO significa largo');
  });

  it('enumera los puntos que hay que recorrer', () => {
    // sin la lista, «con detalle» es una peticion vacia y cada modelo decide
    // otra cosa. Con ella, dos descripciones distintas son comparables
    for (const punto of ['encuadre', 'pelo', 'postura', 'expresion', 'luz']) {
      expect(prompt).toContain(punto);
    }
  });

  it('NO da por hecho que hay una persona', () => {
    // no todo lo que se describe es un personaje: una foto de un paisaje se
    // describe por sus arboles y su luz. Con la lista de rasgos como plantilla
    // obligatoria, el modelo se ponia a buscar pelo y ropa donde no hay nadie
    expect(prompt).toContain('un paisaje');
    expect(prompt).toContain('si hay alguien');
    expect(prompt).toContain('No hay una plantilla que rellenar');
  });

  it('prohibe el eufemismo, porque un pie de foto impreciso no sirve', () => {
    // paso de verdad: ante una figura desnuda escribio «con el torso al
    // descubierto». Eso no es pudor, es un dato falso, y el pie de foto es lo
    // UNICO que se sabra despues de esa imagen
    expect(prompt).toContain('LLAMA A LAS COSAS POR SU NOMBRE');
    expect(prompt).toContain('eufemismos');
  });

  it('pide la misma precision para un cuerpo que para lo demas', () => {
    // el pie de foto es lo unico que identifica ese archivo despues. Quedarse
    // en «desnudo» deja sin identificar una imagen igual que quedarse en
    // «lleva ropa» sin decir cual
    expect(prompt).toContain('MISMA precision');
    expect(prompt).toContain('no te quedes en «desnudo»');
  });

  it('sigue siendo descripcion, no narracion', () => {
    // precision anatomica no es escribir erotica: el destino de este texto es
    // una lista de archivos, y un pie de foto que narra deja de ser util para
    // encontrar la imagen
    expect(prompt).toContain('nada');
    expect(prompt).toContain('de narrar, de insinuar ni de escribir para excitar');
  });

  it('prohibe el bloque de memoria', () => {
    // visto en una descripcion real: el turno tecnico caia en la rama generica
    // de conversacion y el modelo dedicaba media respuesta a un JSON de memoria
    // que nadie iba a guardar
    expect(prompt).toContain('ningun bloque de memoria');
  });

  it('explica PARA QUE sirve, que es lo que justifica el detalle', () => {
    // un modelo que sabe que su texto es lo unico que quedara de la imagen
    // describe distinto que uno al que solo se le pide una frase
    expect(prompt).toContain('lo UNICO que se');
  });

  it('prohibe ponerle nombre a nadie', () => {
    // no puede saber quien es, y un nombre inventado se propaga a la memoria
    expect(prompt).toContain('No pongas nombres');
  });

  it('encuadra la tarea como tecnica, para que no opine', () => {
    expect(prompt).toContain('una tarea');
    expect(prompt).toContain('tecnica sobre un archivo');
  });
});

describe('lo que vuelve del describidor', () => {
  it('recorta espacios y saltos: es una linea de una lista', () => {
    // un salto de linea partiria la lista de imagenes que despues lee el modelo
    const { caption } = parseDescribeResponse('  Una mujer\n  sentada en   una cama.  ');
    expect(caption).toBe('Una mujer sentada en una cama.');
  });

  it('una respuesta vacia no se guarda', () => {
    expect(parseDescribeResponse('   ')).toEqual({
      caption: null,
      failure: 'vacio',
      reasoning: null,
    });
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
    expect(caption?.endsWith(CAPTION_TRIM_MARK)).toBe(true);
  });

  it('el pie de foto SOLO se marca con puntos: lo lee el personaje como contenido', () => {
    // una nota nuestra dentro del pie de foto —«recortado por Luxy»— acabaria
    // leida como algo que se ve en la imagen. Es `D-061` otra vez
    const { caption } = parseDescribeResponse('palabra '.repeat(MAX_CAPTION_CHARS));
    expect(caption).not.toContain('Luxy');
    expect(caption).not.toContain('recortado');
  });

  it('cabe entero y no se le añade nada', () => {
    expect(parseDescribeResponse('Un gato sobre una piedra.').caption).toBe(
      'Un gato sobre una piedra.',
    );
  });
});

describe('recortar diciendo quien recorto', () => {
  it('lo que cabe se devuelve tal cual', () => {
    expect(trimWithMark('corto', 10, '…')).toBe('corto');
  });

  it('la marca cabe dentro del tope, no se le suma', () => {
    // si sobresaliera, el tope dejaria de serlo y el esquema de destino podria
    // rechazar el registro entero por pasarse de largo
    expect(trimWithMark('x'.repeat(50), 10, '[mas]')).toHaveLength(10);
  });

  it('corta por la frontera de palabra', () => {
    expect(trimWithMark('uno dos tres cuatro cinco', 16, '…')).toBe('uno dos tres…');
  });

  it('sin espacios cerca del final corta en seco antes que devolver casi nada', () => {
    // un espacio suelto al principio y despues una cadena continua dejaria un
    // resultado inservible si se respetase siempre la frontera de palabra
    const r = trimWithMark(`a ${'x'.repeat(200)}`, 50, '…');
    expect(r).toHaveLength(50);
    expect(r).toContain('xxx');
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
    expect(parseDescribeResponse(respuesta)).toEqual({
      caption: null,
      failure: 'sin-imagen',
      reasoning: null,
    });
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

describe('el modelo que piensa en voz alta', () => {
  // POR QUE, y no es hipotetico: comprobado contra Groq el 2026-09-07 con
  // qwen/qwen3.6-27b. Devolvio parrafos de deliberacion delante de la frase
  // util, y eso guardado como pie de foto convierte el razonamiento en «lo que
  // se ve en la imagen». Pero tirarlo tampoco vale: es lo unico que explica una
  // descripcion rara.
  const RESPUESTA_REAL =
    '\n<think>\nThe user wants a short Spanish sentence describing the provided image. ' +
    'The image displays vertical red and blue bars.\n</think>\n\n' +
    'La imagen muestra barras verticales de colores rojo y azul.';

  it('el pie de foto es SOLO lo visible', () => {
    const { caption } = parseDescribeResponse(RESPUESTA_REAL);
    expect(caption).toBe('La imagen muestra barras verticales de colores rojo y azul.');
    expect(caption).not.toContain('The user wants');
  });

  it('lo pensado se conserva, no se tira', () => {
    const { reasoning } = parseDescribeResponse(RESPUESTA_REAL);
    expect(reasoning).toContain('The user wants a short Spanish sentence');
  });

  it('sin razonamiento el campo es null, no una cadena vacia', () => {
    // «no lo escribio» y «escribio algo vacio» no son lo mismo en pantalla
    expect(parseDescribeResponse('Un gato sobre una piedra.').reasoning).toBeNull();
  });

  it('reconoce las tres etiquetas que se ven de verdad', () => {
    for (const etiqueta of ['think', 'thinking', 'reasoning']) {
      const r = parseDescribeResponse(`<${etiqueta}>dudo</${etiqueta}>Un gato.`);
      expect(r.caption).toBe('Un gato.');
      expect(r.reasoning).toBe('dudo');
    }
  });

  it('un bloque sin cerrar no deja pie de foto, y dice por que', () => {
    // es un modelo cortado a mitad de pensar: quedarse con su deliberacion
    // como descripcion seria lo peor de los dos mundos. Y el motivo es
    // «solo-razono», no «vacio»: contesto, pero nunca llego a la respuesta
    const r = parseDescribeResponse('<think>estoy pensando y me cortaron');
    expect(r.caption).toBeNull();
    expect(r.failure).toBe('solo-razono');
    expect(r.reasoning).toContain('estoy pensando');
  });

  it('varios bloques se juntan y ninguno se cuela en el pie de foto', () => {
    const r = parseDescribeResponse('<think>uno</think>Un gato<think>dos</think> en una piedra.');
    expect(r.caption).toBe('Un gato en una piedra.');
    expect(r.reasoning).toBe('uno\n\ndos');
  });

  it('el razonamiento se recorta: es para leerlo, no para archivarlo', () => {
    const largo = `<think>${'x'.repeat(MAX_REASONING_CHARS + 500)}</think>Un gato.`;
    // el tope sigue siendo un tope: la marca cabe DENTRO, no se le suma
    expect(parseDescribeResponse(largo).reasoning).toHaveLength(MAX_REASONING_CHARS);
  });

  it('un recorte NUESTRO se marca, para no confundirlo con un modelo cortado', () => {
    // es la averia que Daniel vio dos veces: un texto que acaba a mitad de
    // palabra no dice quien lo corto, y las dos causas se arreglan distinto
    const largo = `<think>${'palabra '.repeat(MAX_REASONING_CHARS)}</think>Un gato.`;
    const { reasoning } = parseDescribeResponse(largo);
    expect(reasoning).toContain('recortado por Luxy');
    // y corta por la frontera de palabra: la ultima que queda esta entera
    expect(reasoning?.replace(REASONING_TRIM_MARK, '')).toMatch(/palabra$/);
  });

  it('lo que cabe entero no lleva marca ninguna', () => {
    // la marca es informacion sobre un corte: sin corte, seria ruido
    const r = parseDescribeResponse('<think>lo justo</think>Un gato.');
    expect(r.reasoning).toBe('lo justo');
  });

  it('splitReasoning permite clasificar la negativa sobre lo VISIBLE', () => {
    // un modelo puede sopesar en voz alta si debe negarse y luego contestar con
    // normalidad: mirar el texto entero convertiria ese titubeo en un rechazo
    const { visible, reasoning } = splitReasoning(
      '<think>¿Debería negarme a esto? No, es una descripción técnica.</think>Dos personas en la playa.',
    );
    expect(visible.trim()).toBe('Dos personas en la playa.');
    expect(visible).not.toContain('negarme');
    expect(reasoning).toContain('negarme');
  });

  it('un razonamiento que dice «no hay imagen» no descarta una descripcion buena', () => {
    // el detector de «sin imagen» mira lo visible; si mirara el razonamiento,
    // un modelo que se lo plantea y luego describe quedaria descartado
    const r = parseDescribeResponse(
      '<think>Al principio pensé que no había ninguna imagen adjunta.</think>Un gato atigrado.',
    );
    expect(r.caption).toBe('Un gato atigrado.');
    expect(r.failure).toBeNull();
  });
});

describe('el modelo que se queda pensando y no contesta', () => {
  // PASO DE VERDAD con llama-3.3-70b: analizo la imagen viñeta a viñeta durante
  // miles de tokens, agoto el limite de salida y se corto CITANDO EL PROPIO
  // PROMPT, sin escribir jamas la descripcion.
  //
  // Contarlo como «no contesto nada» mandaba a reintentar y a dudar de si el
  // modelo sabe mirar, cuando su razonamiento demostraba que la habia mirado
  // entera. Son dos averias distintas: una pide otro modelo, la otra mas
  // espacio de salida.
  it('se distingue de no contestar nada', () => {
    const cortado = '<think>Analicemos la imagen. Panel superior: una figura. Panel 2: la cara';
    const r = parseDescribeResponse(cortado);
    expect(r.caption).toBeNull();
    expect(r.failure).toBe('solo-razono');
    expect(r.reasoning).toContain('Panel superior');
  });

  it('sin razonamiento sigue siendo «vacio»', () => {
    // un modelo que devuelve la nada no es lo mismo que uno que se explayo
    expect(parseDescribeResponse('   ').failure).toBe('vacio');
    expect(parseDescribeResponse('   ').reasoning).toBeNull();
  });

  it('con descripcion detras, el razonamiento no lo convierte en fallo', () => {
    const r = parseDescribeResponse('<think>lo pienso</think>Un gato sobre una piedra.');
    expect(r.failure).toBeNull();
    expect(r.caption).toBe('Un gato sobre una piedra.');
  });

  it('el prompt le pide que NO delibere en voz alta', () => {
    // es la causa raiz, no el sintoma: mientras siga narrando su analisis, el
    // presupuesto de salida se lo come el razonamiento
    expect(buildDescribePrompt()).toContain('NO deliberes en voz alta');
  });
});

describe('las costuras del troceado no son contenido', () => {
  // PASO DE VERDAD, y es el fallo mas peligroso visto hasta ahora porque salio
  // en una descripcion que dimos por BUENA: ante una foto de 768x1280 —una sola
  // imagen— el modelo escribio «un plano general y cuatro primeros planos
  // segmentados», y en su razonamiento decia «the seams are visible as white
  // gaps between the sections».
  //
  // No se lo invento de la nada: los modelos de vision trocean la imagen en
  // mosaicos y rellenan los huecos para que cuadre en su rejilla. Estaba
  // describiendo el relleno. Pero como pie de foto es un hecho FALSO sobre el
  // archivo, y de ahi pasa a la memoria: es `D-061` exacto.
  const prompt = buildDescribePrompt();

  it('avisa de que es UNA imagen y de por que aparecen franjas', () => {
    expect(prompt).toContain('Se te manda UNA imagen');
    expect(prompt).toContain('trocean en mosaicos');
  });

  it('prohibe llamarlas viñetas o paneles', () => {
    expect(prompt).toContain('no las describas como viñetas');
  });

  it('deja describir una division que SI es del dibujo', () => {
    // una retícula de comic o un marco trazado son contenido de verdad, y
    // callarlos seria el error contrario
    expect(prompt).toContain('un marco');
    expect(prompt).toContain('retícula de comic');
  });
});
