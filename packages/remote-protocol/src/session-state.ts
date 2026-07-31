// maquina de estados de una sesion remota, del lado del HOST.
//
// POR QUE ESTA AQUI Y NO EN EL GATEWAY: la decision de aceptar una sesion la
// toma el ordenador controlado, no el servidor. El gateway enruta mensajes; si
// pudiera conceder sesiones, comprometerlo bastaria para entrar.
//
// Y POR QUE ES UNA MAQUINA DE ESTADOS EXPLICITA: las transiciones invalidas son
// el sitio donde se cuelan los fallos. "Aceptar una sesion que ya termino",
// "recibir una respuesta SDP antes de haber enviado la oferta", "seguir
// aceptando eventos despues de revocar". Con estados y una tabla, cada una de
// esas es un rechazo en vez de un comportamiento indefinido.
import { z } from 'zod';
import { validateCapabilitySet, type Capability } from './capabilities.js';

export const SESSION_STATES = [
  'requested',
  'awaiting_user',
  'negotiating',
  'active',
  'ended',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const SESSION_END_CAUSES = [
  'user_ended_local',
  'user_ended_remote',
  'user_rejected',
  'timeout_idle',
  'timeout_max_duration',
  'permission_expired',
  'device_revoked',
  'transport_failed',
  'host_shutdown',
  'protocol_error',
] as const;
export type SessionEndCause = (typeof SESSION_END_CAUSES)[number];

/** cuanto puede estar una sesion sin actividad antes de cortarse sola */
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** tope duro de duracion, aunque haya actividad */
export const DEFAULT_MAX_DURATION_MS = 4 * 60 * 60 * 1000;
/** cuanto espera una solicitud atendida antes de darse por rechazada */
export const USER_PROMPT_TIMEOUT_MS = 60 * 1000;

export interface SessionPolicy {
  /** lo que el dispositivo tiene concedido de forma permanente */
  devicePermissions: readonly Capability[];
  /** si puede entrar sin confirmacion local */
  unattended: boolean;
  /** false en cuanto se revoca; se comprueba en cada paso, no solo al abrir */
  deviceActive: boolean;
  idleTimeoutMs?: number;
  maxDurationMs?: number;
}

export interface SessionSnapshot {
  state: SessionState;
  granted: readonly Capability[];
  startedAt: number;
  lastActivityAt: number;
  endedAt: number | null;
  endCause: SessionEndCause | null;
}

export const REQUEST_REJECTIONS = [
  'device_revoked',
  'no_permissions',
  'requested_more_than_granted',
  'incoherent_capabilities',
  'already_active',
] as const;
export type RequestRejection = (typeof REQUEST_REJECTIONS)[number];

export type RequestOutcome =
  | { ok: true; state: 'awaiting_user' | 'negotiating'; granted: Capability[] }
  | { ok: false; code: RequestRejection; detail: string };

/**
 * sesion remota vista desde el ordenador controlado.
 *
 * Nunca concede mas de lo que el dispositivo tiene, y comprueba la revocacion en
 * CADA transicion. Revocar durante una sesion activa la corta.
 */
export class RemoteSession {
  private estado: SessionState = 'requested';
  private concedido: Capability[] = [];
  private inicio = 0;
  private ultimaActividad = 0;
  private fin: number | null = null;
  private causa: SessionEndCause | null = null;
  private huellasDtls: string[] = [];

  constructor(
    readonly sessionId: string,
    readonly deviceId: string,
    private readonly policy: SessionPolicy,
  ) {}

  snapshot(): SessionSnapshot {
    return {
      state: this.estado,
      granted: [...this.concedido],
      startedAt: this.inicio,
      lastActivityAt: this.ultimaActividad,
      endedAt: this.fin,
      endCause: this.causa,
    };
  }

  /**
   * el dispositivo pide sesion.
   *
   * Lo concedido es la INTERSECCION de lo pedido con lo que tiene: pedir mas de
   * lo concedido no es un error del usuario, es lo que haria un cliente
   * comprometido, y se recorta en silencio salvo que no quede nada.
   */
  request(requested: readonly Capability[], now: number): RequestOutcome {
    if (this.estado !== 'requested') {
      return { ok: false, code: 'already_active', detail: 'esa sesion ya se inicio' };
    }
    if (!this.policy.deviceActive) {
      return { ok: false, code: 'device_revoked', detail: 'ese dispositivo fue revocado' };
    }
    if (this.policy.devicePermissions.length === 0) {
      return {
        ok: false,
        code: 'no_permissions',
        detail: 'ese dispositivo no tiene ningun permiso concedido en este ordenador',
      };
    }

    const interseccion = requested.filter((c) => this.policy.devicePermissions.includes(c));
    if (interseccion.length === 0) {
      return {
        ok: false,
        code: 'requested_more_than_granted',
        detail: 'nada de lo que pide esta concedido a ese dispositivo',
      };
    }

    const problema = validateCapabilitySet(interseccion);
    if (problema !== null) {
      return { ok: false, code: 'incoherent_capabilities', detail: problema };
    }

    this.concedido = interseccion;
    this.inicio = now;
    this.ultimaActividad = now;

    // ACCESO DESATENDIDO: es la unica diferencia, y esta aqui a proposito para
    // que se vea de un vistazo. Si no esta activado, la sesion espera a que
    // alguien pulse en el ordenador.
    this.estado = this.policy.unattended ? 'negotiating' : 'awaiting_user';
    return { ok: true, state: this.estado, granted: [...this.concedido] };
  }

  /** el usuario responde al dialogo del modo atendido */
  userDecision(accepted: boolean, granted: readonly Capability[], now: number): boolean {
    if (this.estado !== 'awaiting_user') return false;

    if (!accepted) {
      this.end('user_rejected', now);
      return true;
    }

    // el usuario puede conceder MENOS de lo pedido (por ejemplo, solo ver)
    const recortado = granted.filter((c) => this.concedido.includes(c));
    if (recortado.length === 0 || validateCapabilitySet(recortado) !== null) {
      this.end('user_rejected', now);
      return true;
    }

    this.concedido = recortado;
    this.estado = 'negotiating';
    this.ultimaActividad = now;
    return true;
  }

  /** se anotan las huellas DTLS de la negociacion inicial */
  beginNegotiation(fingerprints: readonly string[], now: number): boolean {
    if (this.estado !== 'negotiating') return false;
    this.huellasDtls = [...fingerprints];
    this.ultimaActividad = now;
    return true;
  }

  fingerprints(): readonly string[] {
    return this.huellasDtls;
  }

  /** la conexion se establecio */
  activate(now: number): boolean {
    if (this.estado !== 'negotiating') return false;
    this.estado = 'active';
    this.ultimaActividad = now;
    return true;
  }

  /**
   * se recibio actividad del cliente.
   *
   * Devuelve false si la sesion ya no acepta nada, y ESO es lo que impide que
   * los mensajes en vuelo se ejecuten despues de cortar.
   */
  touch(now: number): boolean {
    if (this.estado !== 'active') return false;
    this.ultimaActividad = now;
    return true;
  }

  /**
   * comprueba los vencimientos.
   *
   * Se llama desde un temporizador; devuelve la causa si acaba de terminar. La
   * revocacion se mira aqui tambien: revocar durante una sesion activa la corta,
   * en vez de esperar a la siguiente conexion.
   */
  checkExpiry(now: number, deviceStillActive: boolean): SessionEndCause | null {
    if (this.estado === 'ended') return null;

    if (!deviceStillActive) {
      this.end('device_revoked', now);
      return 'device_revoked';
    }
    if (this.estado === 'awaiting_user' && now - this.inicio > USER_PROMPT_TIMEOUT_MS) {
      this.end('user_rejected', now);
      return 'user_rejected';
    }
    if (this.estado !== 'active') return null;

    const idle = this.policy.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (now - this.ultimaActividad > idle) {
      this.end('timeout_idle', now);
      return 'timeout_idle';
    }

    const maxima = this.policy.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    if (now - this.inicio > maxima) {
      this.end('timeout_max_duration', now);
      return 'timeout_max_duration';
    }

    return null;
  }

  end(cause: SessionEndCause, now: number): void {
    if (this.estado === 'ended') return;
    this.estado = 'ended';
    this.causa = cause;
    this.fin = now;
    // se vacian los permisos: aunque alguien conserve una referencia a la
    // sesion, ya no autoriza nada
    this.concedido = [];
  }

  /** lo que puede hacer AHORA MISMO. Vacio si no esta activa */
  activeCapabilities(): readonly Capability[] {
    return this.estado === 'active' ? this.concedido : [];
  }
}

export const sessionRequestPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  requested: z.array(z.string()).min(1).max(8),
});
