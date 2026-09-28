// que se descarta del renderer cuando la boveda se cierra.
//
// Existe porque la lista estaba escrita DOS veces a mano —en el refresco que
// detecta el cierre y en el cierre de sesion— y las dos copias ya habian
// divergido. El paso de verdad: la sonda de compatibilidad dejo de devolver solo
// cifras y empezo a devolver lo que escribio cada modelo, que es contenido
// descifrado de la boveda; nadie se acordo de añadirlo a ninguna de las dos
// listas, asi que ese texto sobrevivia al bloqueo automatico en memoria de la
// ventana mientras la pantalla prometia, palabra por palabra, que desaparecia.
//
// Ahora la lista es UNA y es un tipo: quien añada un estado nuevo con contenido
// de la boveda y no lo apunte aqui no compila, y quien lo apunte aqui y no lo
// vacie en los dos sitios tampoco. Eso es lo que este modulo compra; no hace
// nada mas.
//
// PURO: no sabe de React ni de la forma de cada estado. Recibe una funcion por
// estado —la que lo devuelve a vacio— y las llama todas.

/**
 * los estados de la ventana que llevan contenido descifrado.
 *
 * El invariante que fija esta lista lo escribio el propio hook: al cerrarse la
 * boveda «se descarta TODO lo descifrado que hubiera en memoria del renderer.
 * No se oculta: deja de existir aqui». No es visibilidad, es existencia — entre
 * otras cosas porque un volcado de fallo del renderer se lleva lo que haya en el
 * monton, y con la boveda cerrada ahi no puede haber nada de dentro.
 *
 * Lo que NO entra aqui: lo que no sale de la boveda descifrado (el estado del
 * candado, el aviso de la cuenta atras, las preferencias del compositor).
 */
export const DECRYPTED_RENDERER_STATE = [
  /** los titulos de las conversaciones, que ya son contenido */
  'conversations',
  'turns',
  /** las imagenes descifradas que se esten mirando */
  'media',
  /** las pruebas de vision no salen de la boveda, pero son imagenes descifradas */
  'probes',
  'instructions',
  /** cual esta abierta: sin esto la pantalla volveria a pedirla al desbloquear */
  'openConversation',
  /** los pendientes llevan la cita LITERAL de un turno */
  'pendingAffairs',
  /** las fichas de continuidad llevan el bloque entero y el titulo */
  'recaps',
  'recapCoverage',
  /** la vista previa de la pasada retroactiva: texto que todavia no se guardo */
  'recapPreview',
  /** lo que escribio cada modelo en la sonda: hasta 120.000 caracteres de roleplay */
  'compatibility',
  /**
   * el plan de imagen que espera decision: es el texto EXACTO que saldria hacia
   * el proveedor —apariencia, ropa y la escena que ella escribio—, descifrado y
   * colgado de la ventana hasta que alguien pulse. En disco vive cifrado con la
   * subclave de su conversacion, asi que dejarlo aqui tras cerrar la boveda
   * seria la unica copia en claro que sobrevive al candado.
   */
  'pendingImagePlan',
  /**
   * el intento que se este mirando: el mismo texto que el pendiente, solo que
   * ya mandado. Es lo que enseñan «ver lo que se mando» y el visor de un medio,
   * y por eso tiene que irse con el candado igual que el que espera decision.
   */
  'openImageAttempt',
  /**
   * la ficha del personaje de la conversacion abierta: es el texto que lee el
   * modelo, descifrado. Faltaba en esta lista y sobrevivia al candado
   */
  'characterDescription',
  /** de quien es la conversacion abierta, con su nombre (`D-103`) */
  'conversationOwner',
  /** la vista previa del enganche lleva el nombre y lo que se sabe de su memoria */
  'ownerPreview',
  /**
   * la galeria de personajes: el nombre, la ficha ENTERA y la receta de cada
   * uno. Es el mismo texto que `characterDescription`, solo que de todos a la
   * vez, y se quedaba fuera. Al abrir se vuelve a pedir (`unlock`, `loginAccount`)
   */
  'characters',
  /**
   * en que conversaciones se dijo «No, esta no» al aviso «¿Es de Lia?». Son
   * identificadores y nada mas, pero salen del contenido descifrado: el aviso
   * solo aparece si sus mensajes nombran a un personaje (revision del 28/09)
   */
  'ownerHintDismissed',
] as const;

export type DecryptedRendererState = (typeof DECRYPTED_RENDERER_STATE)[number];

/** una funcion por estado: la que lo deja vacio */
export type DecryptedStateResetters = Record<DecryptedRendererState, () => void>;

/**
 * vacia todo lo descifrado.
 *
 * Recorre la lista declarada y no las claves del objeto que llega: asi lo que
 * manda es la lista, y un objeto al que le falte una no llega ni a ejecutarse
 * —no compila—, que es justo el fallo que este modulo viene a impedir.
 */
export function discardDecrypted(reset: DecryptedStateResetters): void {
  for (const key of DECRYPTED_RENDERER_STATE) reset[key]();
}
