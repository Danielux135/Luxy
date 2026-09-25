// una linea de registro POR LLAMADA al proveedor.
//
// POR QUE EXISTE: hasta el 2026-09-15 Luxy apuntaba una linea por TURNO. Un
// turno puede costar tres llamadas —cada una cobrada entera por una pasarela
// que cobra por llamada y no por palabra— y de las dos que no contestaron no
// quedaba constancia de nada: ni cuando salieron, ni cuanto aguantaron, ni por
// que murieron. El 2026-09-14 eso costo 20,81 ¥ en un solo dia y hubo que
// reconstruirlo cruzando una captura de la factura con el reloj del log.
//
// Y queda una pregunta abierta que solo esto puede contestar: de las 13
// llamadas de mas del historico, 3 encajan con la pared de los 300 s de Node y
// las otras 10 NO —pasaron en turnos cuyas llamadas duraban entre 29 y 135
// segundos—. Hay una segunda causa sin identificar. Los campos de aqui estan
// elegidos para poder reconocerla sin saber todavia cual es: los tres tiempos
// de arranque separados, el silencio mas largo, los topes que gobernaban la
// llamada y el codigo del error.
//
// REGLA ABSOLUTA DE ESTE ARCHIVO: cifras, codigos y tamaños. Ni una palabra del
// prompt ni de la respuesta. Lo que se conversa en la boveda es privado, y un
// registro de diagnostico no es sitio para nada de eso.
//
// No hay esquema Zod a proposito: este registro no cruza ningun borde de
// confianza. Lo construye el proveedor dentro del proceso y lo consume el log
// local del agente; no llega por red ni se parsea de disco.
import { CALL_ATTENDED_AFTER_MS } from './constants.js';
import type { ProviderCallEnding, ResponseAbortSource, StreamTransportEnd } from './types.js';

/**
 * lo observable de una llamada terminada, sin nada del contenido.
 *
 * los nombres de los campos de tokens son `tokensIn`/`tokensOut` y no
 * `inputTokens`: `redactDeep` tapa el valor de cualquier clave que acabe en
 * `Token`/`Tokens`, y hace bien. Son contadores, no secretos, asi que se
 * renombra el campo en vez de aflojar la regla de redaccion.
 */
export interface ProviderCallRecord {
  /** cuando SALIO la peticion, en ISO UTC */
  startedAt: string;
  /** conexion o familia que hizo la llamada */
  provider: string;
  /** modelo que viajo de verdad en el cuerpo, no el de la configuracion */
  model: string;
  /** host del endpoint, sin ruta, sin query y sin credenciales */
  host: string | null;
  /** intento dentro del turno: 1 es la primera llamada */
  attempt: number;
  /**
   * ms entre el final de la llamada anterior de este turno y el inicio de esta.
   *
   * es lo que delata un reintento de Luxy: los huecos de la factura del
   * 2026-09-14 eran de 2, 4 y 5 segundos, que es su espera programada.
   */
  gapMs: number | null;
  /** ms hasta las cabeceras: «cuanto tardo en descolgar» */
  headersMs: number | null;
  /** ms hasta el primer byte del cuerpo */
  firstChunkMs: number | null;
  /**
   * ms hasta la PRIMERA PALABRA visible. Es la medida clave y no existia.
   *
   * null significa que no llego ninguna: o murio antes, o el modelo se paso la
   * llamada entera razonando.
   */
  firstTokenMs: number | null;
  /** el silencio mas largo entre dos trozos seguidos; es lo que mata la llamada */
  longestSilenceMs: number | null;
  /**
   * silencio desde el ULTIMO byte recibido hasta que la llamada acabo.
   *
   * es la cifra que explica una llamada que empezo bien y murio: separa «se
   * corto justo despues del ultimo trozo» de «estuvo cuatro minutos mudo antes
   * de que Luxy la diera por perdida». null si no llego a llegar ningun byte.
   */
  tailSilenceMs: number | null;
  /** cuanto duro la llamada entera */
  durationMs: number;
  ending: ProviderCallEnding;
  /** true si la pasarela cobra esta llamada aunque devolviera cero tokens */
  billed: boolean;
  /** codigo HTTP; null si nunca llegaron cabeceras */
  httpStatus: number | null;
  /** se pidio transmision en el cuerpo */
  streamed: boolean;
  /** como dejo de dar bytes el transporte; null si no hubo flujo que leer */
  transportEnd: StreamTransportEnd | null;
  /** exactamente lo que dijo el proveedor: `stop`, `length`, `tool_calls`... */
  finishReason: string | null;
  abortedBy: ResponseAbortSource | null;
  /**
   * codigo o nombre del error, NUNCA su mensaje.
   *
   * `UND_ERR_HEADERS_TIMEOUT`, `ECONNRESET`, `AbortError`. Un mensaje puede
   * llevar dentro lo que devolvio el proveedor; un codigo no.
   */
  errorCode: string | null;
  /** caracteres del prompt enviado: tamaño, jamas contenido */
  promptChars: number;
  /** cuantos mensajes iban en el cuerpo */
  messages: number;
  /** imagenes adjuntas y lo que ocupaban en base64 */
  images: number;
  imageChars: number;
  /** tokens que el proveedor dijo cobrar; 0 significa que no los dijo */
  tokensIn: number;
  tokensOut: number;
  /** caracteres de respuesta visible y de razonamiento: tamaños */
  textChars: number;
  reasoningChars: number;
  /** topes que gobernaban ESTA llamada, para poder culpar al correcto */
  silenceTimeoutMs: number;
  requestTimeoutMs: number;
  /**
   * tope de tokens de SALIDA de esta llamada.
   *
   * se llama `outputCap` y no `maxOutputTokens` por lo mismo que los contadores
   * de arriba: `redactDeep` tapa el valor de cualquier clave que acabe en
   * `Token`/`Tokens`, y `maxOutputTokens` casaba. La linea salia a disco como
   * `"maxOutputTokens":"[REDACTADO]"`, o sea que de los tres topes que hay aqui
   * «para poder culpar al correcto» faltaba justo el unico contra el que se
   * interpretan los finales `output_budget` y `truncated`.
   */
  outputCap: number;
  /** llamadas cobradas hoy a esta conexion, contando esta */
  callsToday: number;
  /** gasto estimado acumulado hoy en esta conexion */
  spentToday: number;
  /**
   * parametros de muestreo que viajaron en ESTE cuerpo, con los nombres del
   * esquema. Cada uno aparece SOLO si se envio: una linea sin muestreo sale
   * igual que antes de que existieran, y la ausencia de la clave significa
   * «no se mando», que es distinto de mandar el neutro.
   *
   * Existen para poder comparar con y sin. Que un valor viajara no dice que el
   * modelo lo aplicara: DeepSeek, por ejemplo, documenta que ignora la
   * temperatura cuando razona, y eso se ve cruzandolo con `reasoningChars`.
   */
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
}

/** lo que hace falta para decidir como acabo una llamada */
export interface ProviderCallEndingInput {
  /** la llamada devolvio resultado en vez de lanzar */
  ok: boolean;
  /** lo paro una persona */
  cancelled: boolean;
  /** murio por el tope de silencio de la conexion */
  silence: boolean;
  /** lo corto el reloj propio de Luxy */
  requestTimeout: boolean;
  /** codigo HTTP recibido; null = nunca llegaron cabeceras */
  httpStatus: number | null;
  /**
   * ms que llevaba la peticion en vuelo cuando acabo.
   *
   * es lo que separa «no se pudo conectar» de «la pasarela la atendio y la
   * corto»: sin cabeceras las dos se ven igual, y un fallo de conexion de
   * verdad ocurre en milisegundos.
   */
  elapsedMs: number;
  /** como dejo de dar bytes el transporte; null = no hubo flujo */
  transportEnd: StreamTransportEnd | null;
  finishReason: string | null;
  /** caracteres de texto visible: tamaño, nunca contenido */
  textChars: number;
  /** el proveedor mando un error DENTRO del flujo, con HTTP 200 */
  streamError: boolean;
  /** agoto el tope de salida antes de escribir nada visible */
  outputBudgetExhausted: boolean;
}

/**
 * decide como acabo una llamada.
 *
 * el orden importa y no es arbitrario:
 *
 * 1. lo que pidio una persona manda sobre cualquier lectura tecnica;
 * 2. el SILENCIO va antes que «no hubo cabeceras», porque los dos se ven igual
 *    desde fuera —no llego respuesta— y piden lo contrario: el silencio ya se
 *    ha pagado y no se repite, un socket rechazado no costo nada y si;
 * 3. lo que dijo el proveedor (codigo, error en el flujo, tope de salida) va
 *    antes que lo que se deduce del transporte;
 * 4. solo al final se mira si quedo texto, porque «hay texto» no explica nada
 *    por si solo.
 */
export function classifyProviderCallEnding(input: ProviderCallEndingInput): ProviderCallEnding {
  if (input.cancelled) return 'cancelled';
  if (input.silence) return 'silence';
  if (input.requestTimeout) return 'timed_out';
  // fallo sin cabeceras y sin silencio. Aqui NO basta con mirar el codigo: esta
  // pasarela retiene las cabeceras hasta que el modelo empieza a contestar, asi
  // que «sin codigo» abarca tanto un socket rechazado en 5 ms como una llamada
  // que estuvo cuatro minutos y medio en vuelo antes de que la cortaran. La
  // segunda se cobra; la primera no. Lo unico que las distingue es el reloj.
  if (!input.ok && input.httpStatus === null) {
    return input.elapsedMs >= CALL_ATTENDED_AFTER_MS ? 'dropped' : 'connect_failed';
  }
  if (input.httpStatus !== null && input.httpStatus >= 400) return 'http_error';
  if (input.streamError) return 'stream_error';
  if (input.outputBudgetExhausted) return 'output_budget';
  if (input.finishReason === 'length' && input.textChars > 0) return 'truncated';
  // el socket se cayo a mitad. Con texto delante sigue siendo un corte del otro
  // lado: lo que se quiere saber aqui es COMO acabo, no cuanto se salvo
  if (input.transportEnd === 'read_error') return 'remote_close';
  if (input.textChars > 0) return 'answered';
  return 'empty';
}

/**
 * true si la pasarela cobra esta llamada.
 *
 * es la distincion que costo 90 ¥ de 506 entre el 4 y el 14 de septiembre: una
 * llamada atendida se paga aunque devuelva cero tokens.
 *
 * Lo que sale GRATIS son dos cosas, no una:
 *
 * 1. la que no llego a conectar (`connect_failed`): no hubo peticion que servir;
 * 2. la que el borde RECHAZO con un 4xx —401 por clave caducada, 400 por cuerpo
 *    mal formado, 429 por frecuencia—. Esas se paran antes de la inferencia y
 *    ninguna pasarela las cobra. Contarlas era peligroso por el otro lado: una
 *    racha de 401 al caducar una clave consumia el `dailyCallLimit` del dia, y
 *    como el contador se persiste, seguia rechazando turnos legitimos hasta la
 *    medianoche UTC con la clave ya arreglada. Eso es perder turnos por
 *    llamadas que nadie cobro.
 *
 * Los 5xx SI se siguen contando: ahi el borde pudo haber llegado al modelo, y
 * entre equivocarse contando de mas y equivocarse frenando un turno de pago, la
 * eleccion conservadora es contar.
 */
export function isBilledCallEnding(
  ending: ProviderCallEnding,
  httpStatus: number | null = null,
): boolean {
  if (ending === 'connect_failed') return false;
  if (ending === 'http_error' && httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
    return false;
  }
  return true;
}

/**
 * el mensaje con el que se apunta una llamada en el log.
 *
 * es una constante y no una frase compuesta a mano en cada sitio porque el
 * valor de este registro esta en poder filtrarlo despues: la pregunta que hay
 * que contestar —cual es la segunda causa de las 10 llamadas de mas que no
 * encajan con la pared de los 300 s— se responde recogiendo TODAS las lineas de
 * llamada de una semana, y para eso el mensaje tiene que ser literal y estable.
 *
 * El detalle va en los campos del registro, no aqui: son cifras con nombre y se
 * leen igual de bien en el archivo que en la pantalla de Sistema de Studio.
 */
export const PROVIDER_CALL_LOG_MESSAGE = 'llamada al proveedor';
