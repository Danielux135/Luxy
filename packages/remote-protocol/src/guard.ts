// puerta unica de entrada de todo mensaje de control.
//
// POR QUE ESTA TODO EN UNA FUNCION Y NO REPARTIDO:
//
// El requisito dice que nunca se acepte un mensaje sin esquema validado, version
// compatible, sesion valida, dispositivo autorizado, limite de tamano y
// proteccion de replay. Seis comprobaciones.
//
// Repartidas por el codigo, tarde o temprano aparece un camino que se salta una.
// Ya paso en este proyecto con las herramientas del agente: la barrera estaba en
// un sitio y habia tres caminos paralelos abiertos. Aqui hay UNA puerta, y el
// host no tiene otra forma de convertir bytes en un mensaje ejecutable.
import type { z } from 'zod';
import type { Capability } from './capabilities.js';
import { controlMessageSchema, requiredCapability, type ControlMessage } from './control.js';
import {
  acceptEnvelope,
  envelopeSchema,
  withinSizeLimit,
  MAX_MESSAGE_BYTES,
  type ReplayWindow,
} from './envelope.js';

/** el sobre y el contenido viajan juntos en el mismo objeto JSON */
const framedSchema = envelopeSchema.extend({ msg: controlMessageSchema });

export const REJECTIONS = [
  'too_large',
  'malformed',
  'bad_version',
  'wrong_session',
  'replayed',
  'stale',
  'not_permitted',
  'session_closed',
] as const;
export type Rejection = (typeof REJECTIONS)[number];

export type GuardResult =
  | { ok: true; message: ControlMessage; seq: number }
  | { ok: false; code: Rejection; detail: string };

export interface GuardContext {
  /** sesion que se espera; si no coincide, se rechaza */
  sessionId: string;
  /** lo que el host concedio DE VERDAD en esta sesion */
  granted: readonly Capability[];
  /** estado de replay de ESTE sentido de la conversacion */
  window: ReplayWindow;
  /** false en cuanto la sesion termina: los mensajes en vuelo no valen */
  active: boolean;
  now?: number;
  maxBytes?: number;
}

/**
 * convierte bytes recibidos en un mensaje ejecutable, o explica por que no.
 *
 * ORDEN DELIBERADO. Lo barato primero, y sobre todo: **nada muta el estado hasta
 * que todo lo demas ha pasado**. Un atacante que bombardee con basura no debe
 * poder mover la ventana de secuencias, porque eso dejaria fuera al cliente
 * legitimo.
 */
export function guardControlMessage(raw: string, context: GuardContext): GuardResult {
  // 1. tamano, ANTES de parsear. Parsear 10 MB de JSON para luego rechazarlo ya
  //    es haber hecho el trabajo que el atacante queria.
  if (!withinSizeLimit(raw, context.maxBytes ?? MAX_MESSAGE_BYTES)) {
    return {
      ok: false,
      code: 'too_large',
      detail: `el mensaje supera ${context.maxBytes ?? MAX_MESSAGE_BYTES} bytes`,
    };
  }

  // 2. sesion viva. Un mensaje que llega despues de cerrar no se ejecuta.
  if (!context.active) {
    return { ok: false, code: 'session_closed', detail: 'la sesion ya termino' };
  }

  // 3. forma
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'malformed', detail: 'no es JSON valido' };
  }

  const framed = framedSchema.safeParse(parsed);
  if (!framed.success) {
    return {
      ok: false,
      code: 'malformed',
      detail: describeZodError(framed.error),
    };
  }

  // 4. version, sesion, reloj y replay. Aqui SI se muta la ventana, pero solo
  //    cuando el mensaje ya demostro ser autentico en forma y sesion.
  const veredicto = acceptEnvelope(
    { v: framed.data.v, sid: framed.data.sid, seq: framed.data.seq, ts: framed.data.ts },
    {
      expectedSession: context.sessionId,
      window: context.window,
      ...(context.now === undefined ? {} : { now: context.now }),
    },
  );
  if (!veredicto.ok) return { ok: false, code: veredicto.code, detail: veredicto.detail };

  // 5. permiso. Se comprueba contra lo concedido EN ESTA SESION, no contra lo que
  //    el host sabria hacer: una sesion de solo visualizacion no mueve el raton
  //    aunque el ordenador pueda.
  const necesaria = requiredCapability(framed.data.msg);
  if (!context.granted.includes(necesaria)) {
    return {
      ok: false,
      code: 'not_permitted',
      detail: `"${framed.data.msg.type}" necesita el permiso "${necesaria}", que no se concedio`,
    };
  }

  return { ok: true, message: framed.data.msg, seq: framed.data.seq };
}

/**
 * describe un fallo de esquema sin filtrar el contenido.
 *
 * zod incluye el valor recibido en algunos errores, y ese valor puede ser texto
 * del portapapeles o parte de un archivo. Aqui solo sale la RUTA del campo y el
 * tipo de problema, nunca el dato.
 */
function describeZodError(error: z.ZodError): string {
  const primero = error.issues[0];
  if (primero === undefined) return 'no cumple el esquema';
  const ruta = primero.path.join('.');
  return ruta.length > 0 ? `campo "${ruta}": ${primero.code}` : primero.code;
}
