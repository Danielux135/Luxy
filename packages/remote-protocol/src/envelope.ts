// sobre comun de todo mensaje del protocolo remoto.
//
// LO QUE PROTEGE ESTE ARCHIVO, y por que cada campo existe:
//
//   v    version, para rechazar limpio en vez de interpretar a medias
//   sid  sesion, para que un mensaje de una sesion muerta no valga en otra
//   seq  secuencia estrictamente creciente: mata la reinyeccion de un mensaje
//        capturado. Sin esto, grabar "clic en Aceptar" y reenviarlo bastaria.
//   ts   marca de tiempo, para descartar lo viejo aunque la secuencia cuadre
//
// El requisito dice: "Nunca aceptes mensajes sin esquema validado, version
// compatible, sesion valida, dispositivo autorizado, limites de tamano, y
// proteccion frente a replay." Aqui estan los cinco primeros; el sexto (el
// dispositivo) lo comprueba el gateway, que es quien conoce el emparejamiento.
import { z } from 'zod';
import { PROTOCOL_VERSION } from './version.js';

/**
 * tope de un mensaje del canal de control.
 *
 * 64 KB es holgado para cualquier evento de entrada y suficiente para un
 * fragmento de portapapeles. Los archivos NO viajan por aqui: van por su propio
 * canal troceado, porque un mensaje de control gigante bloquearia los eventos de
 * raton detras de el.
 */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/**
 * cuanto puede desviarse el reloj del otro extremo.
 *
 * dos minutos es tolerante con moviles que ajustan la hora, y sigue siendo una
 * ventana estrecha para reinyectar algo capturado.
 */
export const MAX_CLOCK_SKEW_MS = 120_000;

export const sessionIdSchema = z.string().uuid();
export const deviceIdSchema = z.string().uuid();

export const envelopeSchema = z.object({
  v: z.number().int().min(1).max(1000),
  sid: sessionIdSchema,
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  ts: z.number().int().positive(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

/** estado que hay que llevar por sesion y por SENTIDO para detectar replays */
export interface ReplayWindow {
  /** ultima secuencia aceptada; -1 si aun no llego ninguna */
  lastSeq: number;
}

export function newReplayWindow(): ReplayWindow {
  return { lastSeq: -1 };
}

export type AcceptResult =
  | { ok: true }
  | { ok: false; code: AcceptRejection; detail: string };

export const ACCEPT_REJECTIONS = [
  'bad_version',
  'wrong_session',
  'replayed',
  'stale',
  'too_large',
  'malformed',
] as const;
export type AcceptRejection = (typeof ACCEPT_REJECTIONS)[number];

export interface AcceptOptions {
  /** sesion que se esperaba; un mensaje de otra sesion se rechaza */
  expectedSession: string;
  window: ReplayWindow;
  /** inyectable para poder probar el desfase de reloj sin esperar */
  now?: number;
  maxSkewMs?: number;
}

/**
 * decide si un sobre es aceptable, y MUTA la ventana si lo es.
 *
 * El orden de las comprobaciones importa: primero lo barato y lo que no depende
 * de estado (version, sesion), y solo despues la secuencia. Asi un atacante que
 * bombardee con basura no consigue mover la ventana.
 */
export function acceptEnvelope(envelope: Envelope, options: AcceptOptions): AcceptResult {
  if (envelope.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'bad_version',
      detail: `version ${envelope.v}, se esperaba ${PROTOCOL_VERSION}`,
    };
  }

  if (envelope.sid !== options.expectedSession) {
    return { ok: false, code: 'wrong_session', detail: 'el mensaje es de otra sesion' };
  }

  const ahora = options.now ?? Date.now();
  const desfase = Math.abs(ahora - envelope.ts);
  const tope = options.maxSkewMs ?? MAX_CLOCK_SKEW_MS;
  if (desfase > tope) {
    return {
      ok: false,
      code: 'stale',
      detail: `el mensaje se desvia ${Math.round(desfase / 1000)} s del reloj local`,
    };
  }

  // estrictamente creciente. Repetir una secuencia ya vista es exactamente lo
  // que hace un replay, asi que el igual tambien se rechaza.
  if (envelope.seq <= options.window.lastSeq) {
    return {
      ok: false,
      code: 'replayed',
      detail: `secuencia ${envelope.seq} ya vista (ultima ${options.window.lastSeq})`,
    };
  }

  options.window.lastSeq = envelope.seq;
  return { ok: true };
}

/**
 * mide el tamano real en bytes, no en caracteres.
 *
 * `length` de una cadena cuenta unidades UTF-16: un emoji cuenta 2 y una tilde
 * 1, cuando en UTF-8 ocupan 4 y 2. Validar por `length` deja pasar mensajes
 * bastante mayores que el tope.
 */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** comprueba el tope de tamano antes de siquiera intentar parsear */
export function withinSizeLimit(raw: string, max = MAX_MESSAGE_BYTES): boolean {
  return byteLength(raw) <= max;
}

/** genera el siguiente sobre para enviar */
export function nextEnvelope(sessionId: string, counter: { seq: number }): Envelope {
  counter.seq += 1;
  return { v: PROTOCOL_VERSION, sid: sessionId, seq: counter.seq, ts: Date.now() };
}
