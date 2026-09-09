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
 * escenario, luz y estilo— una descripcion honesta no cabe en 600 caracteres,
 * y recortarla la dejaba a mitad de frase.
 *
 * De 1.500 a 1.900 por MEDICION, no por si acaso: la primera descripcion buena
 * de verdad —una ilustracion de una figura y su habitacion— ocupo 1.354, el 90%
 * del tope. Una imagen con mas cosas dentro lo pasaba, y pasarlo significa
 * guardar una frase cortada a la mitad como si fuera lo que se ve en el
 * archivo. El limite del esquema del medio son 2.000: quedan 100 de margen.
 *
 * Sigue habiendo tope: un pie de foto que se dispara no es mas informacion, es
 * un modelo rellenando. El recorte es la ultima red, no el criterio: quien
 * evita el relleno es el prompt, que manda OMITIR lo que no se distingue.
 */
export const MAX_CAPTION_CHARS = 1900;

/** lo que se añade a un pie de foto recortado: avisa sin afirmar nada */
export const CAPTION_TRIM_MARK = '…';

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
    'Empieza por lo que ES: un paisaje, un interior, un objeto, un documento,',
    'una escena con personas, un montaje de varias viñetas... y describe lo que',
    'hay DE VERDAD. No hay una plantilla que rellenar: una foto de un bosque se',
    'describe por sus arboles y su luz, no por la ropa que nadie lleva.',
    '',
    'Segun lo que haya, y solo si se distingue:',
    '- encuadre y composicion: plano general o detalle, y cuantas partes tiene',
    '  si es un montaje.',
    '- el sitio: lugar, objetos reconocibles, colores, que hay al fondo.',
    '- si hay alguien: complexion, pelo, ojos, piel, postura, hacia donde mira,',
    '  y la expresion que se le vea en la cara.',
    '- lo que lleva puesto, prenda a prenda, con su color y su estado.',
    '- luz, paleta dominante y estilo (fotografia, anime, ilustracion, render).',
    '',
    'Reglas, y son estrictas:',
    '- SOLO lo que se ve. Nada de suponer, deducir ni completar.',
    '- Se te manda UNA imagen. Si percibes franjas, costuras o bandas de color',
    '  plano que la parten en secciones, son del procesado —las imagenes se',
    '  trocean en mosaicos y se rellenan los huecos antes de llegarte— y NO son',
    '  contenido: no las describas como viñetas, paneles ni recortes. Solo',
    '  menciona una division si es claramente del propio dibujo: un marco, un',
    '  borde trazado, una retícula de comic.',
    '- Detallado NO significa largo: no rellenes. Un punto que no se distingue',
    '  se OMITE, no se estira. Preferimos cinco datos ciertos a diez inventados.',
    '- LLAMA A LAS COSAS POR SU NOMBRE. Nada de eufemismos ni de suavizar: si un',
    '  cuerpo esta desnudo se escribe «desnudo», no «con el torso al descubierto».',
    '  Un pie de foto impreciso no sirve para nada, y aqui describir es una tarea',
    '  tecnica sobre un archivo, no una valoracion de su contenido.',
    '- Un cuerpo se describe con la MISMA precision que cualquier otra cosa. Si',
    '  esta desnudo, no te quedes en «desnudo»: complexion, proporciones, pecho,',
    '  caderas, vello, y lo que se distinga del resto del cuerpo, igual que',
    '  dirias el color del pelo o el de una camisa. Es anatomia visible, y',
    '  omitirla deja el archivo sin identificar. Sigue siendo descripcion: nada',
    '  de narrar, de insinuar ni de escribir para excitar.',
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
    'NO deliberes en voz alta. Nada de analizar la imagen por partes, repasar',
    'estas reglas ni corregirte sobre la marcha antes de contestar: la respuesta',
    'ES la descripcion. Un modelo que se puso a razonar cada viñeta agoto su',
    'limite de salida y se corto sin llegar a escribirla.',
    '',
    'Empieza directamente por la descripcion, sin preambulo.',
  ].join('\n');
}

/** por que no se pudo escribir un pie de foto */
export const DESCRIBE_FAILURES = ['vacio', 'negativa', 'sin-imagen', 'solo-razono'] as const;
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

/**
 * tope de lo que se conserva del razonamiento: es para leerlo, no para archivarlo.
 *
 * Eran 4.000 y se quedaban cortos en el caso que MAS importa. Un modelo que
 * razona en voz alta redacta el borrador entero de la descripcion dentro del
 * bloque y luego la escribe otra vez: el razonamiento acaba siendo mas largo
 * que la respuesta, no mas corto. Con 4.000 se cortaba justo por el borrador,
 * que es la parte que explica de donde sale cada frase.
 *
 * Se sube a 20.000 porque esto NO se archiva: vive en memoria, viaja por IPC
 * una vez y se pinta en un desplegable. El tope existe para que un razonamiento
 * desbocado no crezca sin limite, no para ahorrar sitio.
 */
export const MAX_REASONING_CHARS = 20000;

/** lo que se añade a un razonamiento recortado, para que se sepa quien lo corto */
export const REASONING_TRIM_MARK = '\n\n[…recortado por Luxy: el razonamiento seguía]';

/**
 * recorta marcando el corte, y por la ultima frontera de palabra.
 *
 * La marca no es decoracion. Un texto cortado en seco es INDISTINGUIBLE de un
 * modelo que se quedo sin espacio de salida, y son dos averias distintas que se
 * arreglan distinto: una pide subir un tope nuestro, la otra cambiar de modelo
 * o darle mas salida. Paso de verdad las dos veces —primero con una descripcion
 * que nunca llego a escribirse, despues con un razonamiento truncado que
 * parecia haberse cortado solo— asi que la regla es: si el corte es nuestro, se
 * dice.
 *
 * La marca cabe DENTRO del tope; si sobresaliera, el tope no seria un tope.
 */
export function trimWithMark(text: string, limit: number, mark: string): string {
  if (text.length <= limit) return text;
  const room = limit - mark.length;
  const cortado = text.slice(0, room);
  // por la ultima frontera de palabra, para no partir una a la mitad, pero sin
  // tirar mas de la mitad de lo que cabia: un texto casi sin espacios —una
  // cadena larga de datos, un base64— dejaria si no un resultado inservible, y
  // ahi vale mas un corte feo que un resultado vacio
  const espacio = cortado.lastIndexOf(' ');
  const util = espacio >= room / 2 ? cortado.slice(0, espacio) : cortado;
  return util.trimEnd() + mark;
}

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
    reasoning:
      reasoning.length === 0
        ? null
        : trimWithMark(reasoning, MAX_REASONING_CHARS, REASONING_TRIM_MARK),
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

  // sin nada visible no hay descripcion, pero HABER RAZONADO cambia el motivo.
  //
  // Paso de verdad con llama-3.3-70b: analizo la imagen viñeta a viñeta durante
  // miles de tokens, agoto el limite de salida y se corto citando el propio
  // prompt, sin escribir jamas la descripcion. Contarlo como «no contesto nada»
  // mandaba a reintentar y a dudar de si el modelo sabe mirar, cuando se veia
  // en su razonamiento que la habia mirado entera. Son dos averias distintas y
  // se arreglan distinto: una pide otro modelo, la otra mas espacio de salida.
  if (limpio.length === 0) {
    return {
      caption: null,
      failure: reasoning === null ? 'vacio' : 'solo-razono',
      reasoning,
    };
  }
  if (refused) return { caption: null, failure: 'negativa', reasoning };
  // una respuesta que dice que no hay imagen NO es un pie de foto, por muy bien
  // escrita que este. Guardarla haria creer al personaje que la foto ES esa frase
  if (saysNoImage(limpio)) return { caption: null, failure: 'sin-imagen', reasoning };
  // el pie de foto se recorta con puntos suspensivos y nada mas. Este texto SI
  // se guarda y lo lee despues el personaje como «lo que se ve en la imagen»:
  // una nota nuestra metida ahi la leeria como contenido. Los puntos avisan de
  // que la descripcion no termino sin afirmar nada falso sobre el archivo
  return {
    caption: trimWithMark(limpio, MAX_CAPTION_CHARS, CAPTION_TRIM_MARK),
    failure: null,
    reasoning,
  };
}

/**
 * cuanta salida se le pide al describidor.
 *
 * NO es el tope de la conexion, y esa era la averia. Un turno de descripcion
 * pedia los 8192 por defecto de la conexion para guardar como mucho 1.900
 * caracteres, y eso no es solo derrochar: Groq RECHAZA la peticion entera
 * cuando el `max_tokens` pedido supera el limite por minuto del modelo, en vez
 * de recortar. Un limite holgado se convertia en un 429 seco.
 *
 * QUE NO ES: un margen para esquivar el 429 de Groq. Se bajo a 1.500 y luego a
 * 900 creyendo que su «OTPM: Limit 1000» era un tope por peticion, y es FALSO:
 * el registro tiene una peticion de `qwen/qwen3.6-27b` servida con 1.500 tokens
 * de salida. Es un presupuesto POR MINUTO que se agota describiendo varias
 * seguidas, y encogerlo no lo evita —solo trunca la descripcion—. El propio
 * mensaje de error de Luxy ya lo decia: si el limite es mayor que cero, es
 * frecuencia; se espera y se repite.
 *
 * 2.000 sale de lo que hace falta para responder: 1.900 caracteres de español
 * son unos 540 tokens, y el resto es sitio para que un modelo que razona en voz
 * alta llegue a escribir la descripcion. Con 900 no llegaba: agotaba el
 * presupuesto pensando y devolvia `solo-razono`.
 *
 * Sigue siendo un maximo, no una reserva: se paga lo que se use.
 */
export const DESCRIBE_MAX_OUTPUT_TOKENS = 2000;
