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

/** tope de lo que se acepta como pie de foto; el esquema del medio admite mas */
export const MAX_CAPTION_CHARS = 600;

/**
 * que se le pide al describidor.
 *
 * Va en español porque el pie de foto lo leen dos: el modelo de la conversacion
 * —que habla español— y el usuario, que tiene que poder corregirlo.
 */
export function buildDescribePrompt(): string {
  return [
    'Describe lo que se ve en esta imagen.',
    '',
    'Reglas, y son estrictas:',
    '- SOLO lo que se ve. Nada de suponer, deducir ni completar.',
    '- Una o dos frases. Cortas. Un pie de foto, no un relato.',
    '- En español.',
    '- Si un detalle no se distingue con seguridad, NO lo escribas. Omitirlo es',
    '  correcto; inventarlo no.',
    '- No pongas nombres a nadie ni digas quien es: no puedes saberlo.',
    '- No cuentes que pasa antes ni despues, ni que siente nadie.',
    '- No opines sobre la imagen ni sobre si deberia existir. Esto es una',
    '  descripcion tecnica para poder encontrarla despues entre otras.',
    '',
    'Empieza directamente por la descripcion, sin preambulo.',
  ].join('\n');
}

/** por que no se pudo escribir un pie de foto */
export const DESCRIBE_FAILURES = ['vacio', 'negativa'] as const;
export type DescribeFailure = (typeof DESCRIBE_FAILURES)[number];

export interface DescribeResult {
  caption: string | null;
  failure: DescribeFailure | null;
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
  // los saltos de linea sobran: es una linea en una lista, y uno partiria la
  // lista que despues lee el modelo
  const limpio = text.replace(/\s+/g, ' ').trim();
  if (limpio.length === 0) return { caption: null, failure: 'vacio' };
  if (refused) return { caption: null, failure: 'negativa' };
  return { caption: limpio.slice(0, MAX_CAPTION_CHARS), failure: null };
}
