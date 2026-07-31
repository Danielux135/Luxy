// transporte de senalizacion.
//
// POR QUE ES UNA INTERFAZ Y NO UNA IMPLEMENTACION DIRECTA:
//
// La senalizacion son literalmente unos pocos mensajes -una oferta, una
// respuesta y unos veinte candidatos ICE- y despues el canal queda ocioso. Por
// eso se eligio Supabase Realtime frente a Durable Objects (ver
// docs/adr/0003-transporte-senalizacion-turn.md): cero infraestructura nueva.
//
// Pero esa decision puede cambiar, y lo que NO puede cambiar es el resto. Con
// una interfaz, cambiar de transporte es escribir otra clase; sin ella, seria
// tocar el emparejamiento, la sesion y el host.
//
// LO QUE ESTE ARCHIVO NO HACE, y es deliberado: no verifica firmas. El
// transporte mueve sobres opacos. Toda la seguridad vive por encima, en
// verifySdp y en la maquina de estados. Un transporte comprometido solo puede
// perder, duplicar o retrasar mensajes; nunca falsificarlos.
import { z } from 'zod';

export const SIGNALING_KINDS = [
  'session.request',
  'session.accept',
  'session.deny',
  'sdp.offer',
  'sdp.answer',
  'ice.candidate',
  'session.end',
] as const;
export type SignalingKind = (typeof SIGNALING_KINDS)[number];

/** tope de un mensaje de senalizacion; el SDP es lo mas grande que cabe */
export const MAX_SIGNALING_BYTES = 96 * 1024;

export const signalingMessageSchema = z.object({
  kind: z.enum(SIGNALING_KINDS),
  sessionId: z.string().uuid(),
  /** quien lo envia, para poder descartar los propios */
  from: z.string().uuid(),
  /** carga util opaca para el transporte */
  payload: z.unknown(),
  ts: z.number().int().positive(),
});

export type SignalingMessage = z.infer<typeof signalingMessageSchema>;

export type SignalingListener = (message: SignalingMessage) => void;

/**
 * canal de senalizacion de UNA sesion.
 *
 * Se abre por sesion, no global: asi cerrar una sesion cierra su canal y no hay
 * forma de que un mensaje tardio de una sesion muerta llegue a otra.
 */
export interface SignalingChannel {
  send(message: SignalingMessage): Promise<void>;
  subscribe(listener: SignalingListener): () => void;
  close(): Promise<void>;
  readonly closed: boolean;
}

export interface SignalingTransport {
  /** abre el canal de una sesion. `self` identifica a quien abre */
  open(sessionId: string, self: string): Promise<SignalingChannel>;
}

// -----------------------------------------------------------------------------
// implementacion en memoria
// -----------------------------------------------------------------------------

/**
 * transporte en memoria para pruebas.
 *
 * NO es un mock trivial: respeta las propiedades que importan del transporte
 * real y que un mock ingenuo se saltaria.
 *
 *   * un mensaje NO le llega a quien lo envio
 *   * un canal cerrado no entrega ni acepta nada
 *   * la entrega es asincrona, asi que el codigo no puede asumir que enviar y
 *     recibir ocurren en el mismo tick
 *
 * Ademas puede simular perdida y duplicacion, que es lo que hace una red de
 * verdad y donde aparecen los fallos de reconexion.
 */
export class InMemorySignaling implements SignalingTransport {
  private readonly salas = new Map<string, Set<InMemoryChannel>>();

  /** de 0 a 1: proporcion de mensajes que se pierden */
  lossRate = 0;
  /** si true, cada mensaje se entrega dos veces */
  duplicate = false;

  async open(sessionId: string, self: string): Promise<SignalingChannel> {
    const sala = this.salas.get(sessionId) ?? new Set<InMemoryChannel>();
    this.salas.set(sessionId, sala);

    const canal = new InMemoryChannel(sessionId, self, sala, this);
    sala.add(canal);
    return canal;
  }

  /** entrega a todos los de la sala MENOS al remitente */
  deliver(sala: Set<InMemoryChannel>, from: InMemoryChannel, message: SignalingMessage): void {
    for (const canal of sala) {
      if (canal === from || canal.closed) continue;
      if (this.lossRate > 0 && Math.random() < this.lossRate) continue;

      // asincrono a proposito: enviar y recibir no ocurren en el mismo tick
      queueMicrotask(() => canal.receive(message));
      if (this.duplicate) queueMicrotask(() => canal.receive(message));
    }
  }

  /** cuantos canales hay abiertos, para comprobar que se cierran */
  openChannels(): number {
    let total = 0;
    for (const sala of this.salas.values()) {
      for (const canal of sala) if (!canal.closed) total += 1;
    }
    return total;
  }
}

class InMemoryChannel implements SignalingChannel {
  private readonly listeners = new Set<SignalingListener>();
  private cerrado = false;

  constructor(
    private readonly sessionId: string,
    private readonly self: string,
    private readonly sala: Set<InMemoryChannel>,
    private readonly transporte: InMemorySignaling,
  ) {}

  get closed(): boolean {
    return this.cerrado;
  }

  async send(message: SignalingMessage): Promise<void> {
    if (this.cerrado) throw new Error('el canal de senalizacion esta cerrado');
    if (message.sessionId !== this.sessionId) {
      throw new Error('ese mensaje es de otra sesion');
    }
    if (message.from !== this.self) {
      throw new Error('no se puede enviar en nombre de otro');
    }
    this.transporte.deliver(this.sala, this, message);
  }

  subscribe(listener: SignalingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(message: SignalingMessage): void {
    if (this.cerrado) return;
    for (const listener of this.listeners) listener(message);
  }

  async close(): Promise<void> {
    this.cerrado = true;
    this.listeners.clear();
    this.sala.delete(this);
  }
}

// -----------------------------------------------------------------------------
// utilidades
// -----------------------------------------------------------------------------

/** construye un mensaje de senalizacion valido */
export function signalingMessage(
  kind: SignalingKind,
  sessionId: string,
  from: string,
  payload: unknown,
): SignalingMessage {
  return { kind, sessionId, from, payload, ts: Date.now() };
}

export type SignalingRejection = 'too_large' | 'malformed' | 'wrong_session' | 'own_message';

export type SignalingVerdict =
  | { ok: true; message: SignalingMessage }
  | { ok: false; code: SignalingRejection; detail: string };

/**
 * valida un mensaje que llega por el transporte.
 *
 * Descartar los propios importa: algunos transportes -Supabase Realtime entre
 * ellos- devuelven al emisor lo que publica. Sin este filtro, un extremo
 * procesaria su propia oferta como si fuera la del otro.
 */
export function acceptSignaling(
  raw: unknown,
  expectedSession: string,
  self: string,
): SignalingVerdict {
  const texto = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (new TextEncoder().encode(texto).length > MAX_SIGNALING_BYTES) {
    return { ok: false, code: 'too_large', detail: 'el mensaje de senalizacion es demasiado grande' };
  }

  const parsed = signalingMessageSchema.safeParse(
    typeof raw === 'string' ? safeJson(raw) : raw,
  );
  if (!parsed.success) {
    return { ok: false, code: 'malformed', detail: 'el mensaje no cumple el esquema' };
  }
  if (parsed.data.sessionId !== expectedSession) {
    return { ok: false, code: 'wrong_session', detail: 'el mensaje es de otra sesion' };
  }
  if (parsed.data.from === self) {
    return { ok: false, code: 'own_message', detail: 'es un eco del propio mensaje' };
  }

  return { ok: true, message: parsed.data };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
