// tope de SILENCIO de las peticiones HTTP a un proveedor.
//
// POR QUE EXISTE ESTE ARCHIVO: hasta el 2026-09-15 el tope de red de Luxy no lo
// habia elegido nadie. Era el de fabrica de la pila HTTP de Node —300.000 ms de
// `headersTimeout` y otros tantos de `bodyTimeout`— y no habia una sola linea
// en el proyecto que lo cambiara. El 2026-09-14 dos llamadas de DeepSeek
// murieron a los 302 y 300 segundos justos, el reintento siguiente contesto a
// los 304, y la pasarela cobro las tres: cobra POR LLAMADA, asi que un intento
// que devuelve cero tokens cuesta igual que uno bueno.
//
// Lo que se sube es el silencio, no la duracion: cada byte que llega reinicia
// las dos cuentas, asi que una respuesta larga que va llegando nunca muere por
// tardar. Lo que muere es una llamada que lleva quince minutos sin decir nada.
import { PROVIDER_SILENCE_TIMEOUT_MS } from '@luxy/shared';

/**
 * clave con la que undici —la pila HTTP que Node trae DENTRO— publica su
 * despachador global. Es el punto de interoperacion que usan
 * `getGlobalDispatcher` y `setGlobalDispatcher`, y no ha cambiado desde
 * undici 5.
 *
 * Se llega por aqui en vez de importando el paquete `undici` porque ese
 * paquete NO es una dependencia de Luxy: esta en node_modules de rebote
 * (electron, wrangler), asi que importarlo funcionaria en este ordenador y
 * reventaria en una instalacion limpia o empaquetada. Lo que se configura es la
 * pila que Node ya usa.
 */
const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1');

/** lo que `fetch` acepta en `dispatcher`, sea cual sea su forma exacta */
type FetchDispatcher = NonNullable<RequestInit['dispatcher']>;

/**
 * los dos topes que interesan, los dos de SILENCIO:
 * - `headersTimeout`: desde que sale la peticion hasta la primera cabecera,
 *   que es justo «lo que tarda el proveedor en decir la primera palabra»;
 * - `bodyTimeout`: silencio ENTRE trozos del cuerpo, reiniciado en cada uno.
 */
interface SilenceOptions {
  headersTimeout: number;
  bodyTimeout: number;
}

type DispatcherConstructor = new (options: SilenceOptions) => FetchDispatcher;

/** un despachador por tope distinto: crear uno por peticion tiraria el pool */
const dispatchers = new Map<number, FetchDispatcher>();

/** `undefined` = sin resolver todavia; `null` = resuelto y no disponible */
let constructorCache: DispatcherConstructor | null | undefined;

/**
 * la clase del despachador que Node esta usando AHORA.
 *
 * se construye una nueva instancia de LA MISMA clase, no un `Agent` fijo: si
 * Node instalo un despachador con proxy —`NODE_USE_ENV_PROXY`—, el nuestro
 * hereda ese comportamiento y solo le cambia los tiempos. Imponer una clase
 * concreta desviaria el trafico fuera del proxy sin que nadie lo pidiera.
 */
function dispatcherConstructor(): DispatcherConstructor | null {
  if (constructorCache !== undefined) return constructorCache;

  const holder = globalThis as unknown as Record<symbol, unknown>;
  if (holder[UNDICI_GLOBAL_DISPATCHER] === undefined) {
    // el despachador global se crea PEREZOSAMENTE: hasta que algo toca la pila
    // fetch de Node no existe. Crear una cabecera la carga sin abrir un socket
    // ni resolver un nombre; leer `globalThis.fetch` no basta, se comprobo.
    try {
      new Headers();
    } catch {
      /* sin pila fetch no hay nada que configurar */
    }
  }

  const actual = holder[UNDICI_GLOBAL_DISPATCHER] as { constructor?: unknown } | null | undefined;
  const candidato = actual?.constructor;
  constructorCache = typeof candidato === 'function' ? (candidato as DispatcherConstructor) : null;
  return constructorCache;
}

/**
 * las opciones de transporte de un `fetch` con el tope de silencio pedido.
 *
 * Devuelve un objeto VACIO cuando la pila no se deja configurar. Es
 * deliberado: el turno de Daniel es una llamada de pago y una conversacion
 * real, asi que este arreglo puede no aplicarse, pero nunca puede impedir que
 * la peticion salga. Sin despachador se vuelve al tope de fabrica, que es lo
 * que habia antes.
 */
export function silenceTransport(silenceMs: number = PROVIDER_SILENCE_TIMEOUT_MS): {
  dispatcher?: FetchDispatcher;
} {
  const clase = dispatcherConstructor();
  if (clase === null) return {};

  // un tope absurdo hace mas daño que no tener ninguno: por debajo de un
  // segundo ninguna peticion real llega a empezar
  const ms = Math.max(1_000, Math.round(silenceMs));
  const cacheado = dispatchers.get(ms);
  if (cacheado !== undefined) return { dispatcher: cacheado };

  try {
    const despachador = new clase({ headersTimeout: ms, bodyTimeout: ms });
    dispatchers.set(ms, despachador);
    return { dispatcher: despachador };
  } catch {
    // la clase existe pero no acepta estas opciones: mejor el tope de fabrica
    // que una peticion que no sale
    return {};
  }
}

/** true si Luxy pudo instalar su propio tope. Para pruebas y diagnostico. */
export function silenceTransportAvailable(): boolean {
  return dispatcherConstructor() !== null;
}

/**
 * true si el fallo fue un SILENCIO del proveedor, no un rechazo suyo.
 *
 * `fetch` entrega siempre el mismo `TypeError: fetch failed` y esconde el
 * motivo real en `cause`; encima `retryWithBackoff` envuelve el error otra vez
 * en `lastError`. Sin mirar dentro de las dos capas, un silencio de quince
 * minutos y un socket rechazado al conectar son indistinguibles, y piden lo
 * contrario el uno del otro: el silencio YA se ha pagado y no se repite; el
 * socket rechazado no llego a costar nada y si se reintenta.
 */
export function isSilenceTimeout(error: unknown): boolean {
  for (const capa of causeChain(error)) {
    const code = (capa as { code?: unknown }).code;
    if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return true;
    const name = (capa as { name?: unknown }).name;
    if (name === 'HeadersTimeoutError' || name === 'BodyTimeoutError') return true;
  }
  return false;
}

/**
 * el error y todo lo que lleva debajo, sin ciclos ni profundidad infinita.
 *
 * se siguen las DOS envolturas porque cada una la pone una capa distinta:
 * `cause` la pone `fetch` y `lastError` la pone `retryWithBackoff`.
 */
function causeChain(error: unknown): object[] {
  const vistos: object[] = [];
  const pendientes: unknown[] = [error];
  while (pendientes.length > 0 && vistos.length < 8) {
    const actual = pendientes.shift();
    if (typeof actual !== 'object' || actual === null) continue;
    if (vistos.includes(actual)) continue;
    vistos.push(actual);
    const capa = actual as { cause?: unknown; lastError?: unknown };
    pendientes.push(capa.cause, capa.lastError);
  }
  return vistos;
}
