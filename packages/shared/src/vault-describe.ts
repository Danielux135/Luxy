// como se le pide a un modelo que describa una imagen guardada.
//
// Para que existe: el pie de foto es LO UNICO que el modelo de la conversacion
// sabe de una imagen que ya esta en la boveda. Con el elige cual reenviar en vez
// de pagar una generacion nueva. Hoy, para un adjunto es lo que tecleara el
// usuario y para el avatar copiado es la cadena fija «su foto de perfil», que no
// dice nada: el modelo elige a ciegas.
//
// Este modulo es PURO. Ni red, ni disco, ni reloj: compone el texto que se
// manda y limpia el que vuelve, para que cada caso limite se pruebe sin gastar
// una llamada.
//
// EL RIESGO QUE GOBIERNA ESTE PROMPT, y no es teorico. `D-061`: un pie de foto
// que decia el color de una gata acabo con el personaje describiendo una oreja
// doblada que nadie habia visto, y ese detalle entro en la memoria acumulativa
// como un hecho. Un describidor automatico puede mover ese fallo una capa antes
// y ademas repetirlo cada vez. De ahi las tres reglas del prompt: SOLO lo que se
// ve, CORTO, y lo dudoso se calla en vez de completarse.

/**
 * tope de lo que se acepta como pie de foto.
 *
 * Eran 600, pensados para «una o dos frases». Daniel pidio que se explayara:
 * con el detalle que ahora se le pide —encuadre, rasgos, ropa, postura,
 * escenario, luz y estilo— una descripcion honesta de una imagen con varias
 * viñetas no cabe en 600 caracteres, y recortarla la dejaba a mitad de frase.
 *
 * Sigue habiendo tope, y por debajo de los 2.000 que admite el esquema del
 * medio: un pie de foto que se dispara no es mas informacion, es un modelo
 * rellenando. El recorte es la ultima red, no el criterio: quien evita el
 * relleno es el prompt, que manda OMITIR lo que no se distingue.
 */
export const MAX_CAPTION_CHARS = 1500;

/**
 * que se le pide al describidor.
 *
 * Va en español porque el pie de foto lo leen dos: el modelo de la conversacion
 * —que habla español— y el usuario, que tiene que poder corregirlo.
 */
export function buildDescribePrompt(): string {
  return [
    'Describe con detalle lo que se ve en esta imagen.',
    '',
    'Recorre estos puntos, y escribe SOLO los que se distingan de verdad:',
    '- encuadre y composicion: plano general o primer plano, cuantas viñetas o',
    '  recortes hay si es un montaje, y como estan dispuestos.',
    '- la persona o personaje, si lo hay: pelo (color, largo, peinado), ojos,',
    '  tono de piel, complexion, edad aparente solo si es evidente.',
    '- ropa: cada prenda, su color y su estado. Si no lleva, dilo con',
    '  naturalidad y sin rodeos: es una descripcion tecnica.',
    '- postura, encuadre del cuerpo y hacia donde mira.',
    '- expresion de la cara, solo lo que se ve en los rasgos.',
    '- escenario y objetos reconocibles, con sus colores.',
    '- luz, paleta dominante y estilo (anime, fotografico, ilustracion).',
    '',
    'Reglas, y son estrictas:',
    '- SOLO lo que se ve. Nada de suponer, deducir ni completar.',
    '- Detallado NO significa largo: no rellenes. Un punto que no se distingue',
    '  se OMITE, no se estira. Preferimos cinco datos ciertos a diez inventados.',
    '- En español, en prosa seguida. Sin listas ni encabezados.',
    '- No pongas nombres a nadie ni digas quien es: no puedes saberlo.',
    '- No cuentes que pasa antes ni despues, ni que siente nadie por dentro.',
    '- No opines sobre la imagen ni sobre si deberia existir.',
    '- No escribas ningun bloque de memoria ni JSON: esto no es una',
    '  conversacion, es una descripcion que se guarda tal cual.',
    '',
    'Para que sirve, y por eso importa el detalle: este texto es lo UNICO que se',
    'sabra despues de esta imagen. Con el hay que poder reconocerla entre muchas',
    'parecidas sin volver a mirarla.',
    '',
    'Empieza directamente por la descripcion, sin preambulo.',
  ].join('\n');
}

/** por que no se pudo escribir un pie de foto */
export const DESCRIBE_FAILURES = ['vacio', 'negativa', 'sin-imagen'] as const;
export type DescribeFailure = (typeof DESCRIBE_FAILURES)[number];

/**
 * el modelo contesta que NO le ha llegado ninguna imagen.
 *
 * No es una negativa ni una respuesta vacia: es una respuesta perfectamente
 * formada que dice que no hay nada que mirar, y por eso se colaba como pie de
 * foto valido. Paso de verdad: Claude Code descarta las imagenes en silencio
 * —su transporte es un CLI y no tiene por donde mandarlas— y contesto «No hay
 * ninguna imagen adjunta en esta conversacion». Eso se habria guardado como lo
 * que SE VE en una foto de la boveda, que es exactamente `D-061` una capa antes.
 *
 * Se comprueba sobre el texto normalizado y sin acentos: un modelo escribe
 * «imagen adjunta» o «imagen adjunta» segun le da.
 */
const SIN_IMAGEN = [
  /no (hay|veo|se) (ninguna |nada de |)imagen/,
  /no (he |)recib\w* (ninguna |)imagen/,
  /no (puedo|logro) ver (ninguna |la |)imagen/,
  /ninguna imagen (adjunta|adjuntada|en esta conversacion)/,
  /no (hay|se ha) (adjuntado|adjunto)/,
  /(there is |i see |)no image (attached|provided|in this)/,
  /i (don't|do not|cannot|can't) see (an |any |the )?image/,
];

/** true si la respuesta dice que no le llego ninguna imagen */
export function saysNoImage(text: string): boolean {
  const plano = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return SIN_IMAGEN.some((patron) => patron.test(plano));
}

export interface DescribeResult {
  caption: string | null;
  failure: DescribeFailure | null;
  /**
   * lo que el modelo razono ANTES de contestar, cuando lo escribe.
   *
   * Se separa y se conserva, no se tira: es lo unico que explica por que dijo
   * lo que dijo, y con una descripcion rara es justo lo que hay que leer. Pero
   * NO es la descripcion: guardarlo como pie de foto haria creer al personaje
   * que la imagen ES el razonamiento.
   *
   * `null` cuando el modelo no razona en voz alta, que es lo normal.
   */
  reasoning: string | null;
}

/** tope de lo que se conserva del razonamiento: es para leerlo, no para archivarlo */
export const MAX_REASONING_CHARS = 4000;

/**
 * bloques de razonamiento en voz alta, con las etiquetas que se ven de verdad.
 *
 * `<think>` es la de Qwen y DeepSeek —comprobada contra Groq el 2026-09-07, que
 * devolvio el razonamiento entero delante de la frase util—. `<thinking>` la
 * usan otros. La etiqueta de cierre es opcional a proposito: un modelo cortado
 * a mitad deja el bloque abierto, y entonces NO hay respuesta visible.
 */
const REASONING = /<(think|thinking|reasoning)>([\s\S]*?)(?:<\/\1>|$)/gi;

/**
 * parte la respuesta en lo que el modelo penso y lo que contesto.
 *
 * Se exporta porque quien clasifica una negativa tiene que mirar la parte
 * VISIBLE: un modelo puede sopesar en voz alta si debe negarse y luego
 * contestar con normalidad, y clasificar sobre el texto entero convertiria ese
 * titubeo en un rechazo que nunca ocurrio.
 */
export function splitReasoning(text: string): { visible: string; reasoning: string | null } {
  const trozos: string[] = [];
  const visible = text.replace(REASONING, (_entero, _etiqueta: string, dentro: string) => {
    trozos.push(dentro.trim());
    return ' ';
  });
  const reasoning = trozos.filter((t) => t.length > 0).join('\n\n');
  return {
    visible,
    reasoning: reasoning.length === 0 ? null : reasoning.slice(0, MAX_REASONING_CHARS),
  };
}

/**
 * limpia la respuesta del describidor.
 *
 * `refused` lo decide quien llama, con el clasificador de negativas que ya
 * existe: aqui solo se recibe el veredicto. Guardar una negativa como pie de
 * foto seria lo peor de los dos mundos —el modelo creeria que la imagen ES esa
 * frase— asi que se rechaza en vez de guardarse.
 */
export function parseDescribeResponse(text: string, refused = false): DescribeResult {
  // lo que el modelo penso se aparta ANTES de nada. Se conserva para poder
  // leerlo, pero no entra en el pie de foto: comprobado con Groq, un modelo que
  // razona en voz alta devuelve parrafos de deliberacion delante de la frase
  // util, y eso guardado como pie de foto convierte el razonamiento en «lo que
  // se ve en la imagen»
  const { visible, reasoning } = splitReasoning(text);

  // los saltos de linea sobran: es una linea en una lista, y uno partiria la
  // lista que despues lee el modelo
  const limpio = visible.replace(/\s+/g, ' ').trim();

  // sin nada visible no hay descripcion, aunque haya razonamiento de sobra: un
  // bloque abierto y sin cerrar es un modelo cortado a mitad de pensar
  if (limpio.length === 0) return { caption: null, failure: 'vacio', reasoning };
  if (refused) return { caption: null, failure: 'negativa', reasoning };
  // una respuesta que dice que no hay imagen NO es un pie de foto, por muy bien
  // escrita que este. Guardarla haria creer al personaje que la foto ES esa frase
  if (saysNoImage(limpio)) return { caption: null, failure: 'sin-imagen', reasoning };
  return { caption: limpio.slice(0, MAX_CAPTION_CHARS), failure: null, reasoning };
}
