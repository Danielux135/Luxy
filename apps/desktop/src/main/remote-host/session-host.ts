// orquestador de una sesion remota en el host.
//
// Este archivo une la maquina de estados, la captura, la senalizacion y la
// entrada, pero no conoce Electron ni koffi. Las fronteras se inyectan para que
// el orden de las protecciones se pueda probar sin mover el raton de nadie.
import { z } from 'zod';
import {
  RemoteSession,
  acceptSignaling,
  capabilitySchema,
  guardControlMessage,
  newReplayWindow,
  signalingMessage,
  type Capability,
  type ControlMessage,
  type ReplayWindow,
  type SessionEndCause,
  type SessionPolicy,
  type SignalingChannel,
  type SignalingKind,
  type SignalingTransport,
} from '@luxy/remote-protocol';
import {
  fingerprintsUnchanged,
  signSdp,
  verifySdp,
  type PrivateKey,
  type PublicKey,
  type SignedSdp,
} from '@luxy/remote-crypto';
import {
  MAX_CONTROL_BYTES,
  channelMatches,
  withinControlLimit,
  type DataChannelKind,
  type FromCapture,
  type ToCapture,
} from '../../shared/capture-ipc.js';
import type { CapturableDisplay } from './display-sources.js';
import type { DispatchResult } from './input-dispatcher.js';
import { toPhysical } from './monitors.js';
import type { IndicatorState } from './session-indicator.js';

const requestSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  requested: z.array(capabilitySchema).min(1).max(8),
});

const signedSdpSchema = z.object({
  role: z.enum(['offer', 'answer']),
  sessionId: z.string().uuid(),
  sdp: z.string().min(1).max(64 * 1024),
  signature: z.string().min(84).max(90),
});

const iceSchema = z.object({
  candidate: z.string().max(1024),
  sdpMid: z.string().max(64).nullable(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable(),
});

// Solo clasifica el mensaje para elegir canal. La unica funcion que lo convierte
// en una orden ejecutable sigue siendo guardControlMessage.
const controlTypeSchema = z.object({ msg: z.object({ type: z.string() }) });

export type SessionHostRequest = z.infer<typeof requestSchema>;

export interface SessionDecision {
  accepted: boolean;
  granted: readonly Capability[];
}

export interface CaptureHostPort {
  refreshDisplays(): Promise<CapturableDisplay[]>;
  resolveSource(monitorId: string | null): CapturableDisplay | null;
  installDisplayMediaHandler(getSelectedMonitorId: () => string | null): void;
  ensureWindow(): Promise<unknown>;
  send(message: ToCapture): void;
  dispose(reason: string): Promise<void>;
}

export interface InputDispatcherPort {
  updateDisplays(displays: readonly CapturableDisplay[]): void;
  currentMonitorId(): string | null;
  dispatch(message: ControlMessage): DispatchResult;
  releaseAll(): void;
}

export interface SessionIndicatorPort {
  show(state: IndicatorState): void;
  update(state: IndicatorState): void;
  hide(): void;
}

export interface SessionScheduler {
  setInterval(handler: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SessionHostOptions {
  hostDeviceId: string;
  deviceName: string;
  policy: SessionPolicy;
  privateKey: PrivateKey;
  pinnedPublicKey: PublicKey;
  signaling: SignalingTransport;
  captureHost: CaptureHostPort;
  dispatcher: InputDispatcherPort;
  indicator: SessionIndicatorPort;
  askUser: (
    request: SessionHostRequest,
    available: readonly Capability[],
  ) => Promise<SessionDecision>;
  isDeviceActive: () => boolean;
  now?: () => number;
  scheduler?: SessionScheduler;
  quality?: Extract<ToCapture, { type: 'start' }>['quality'];
  iceServers?: Extract<ToCapture, { type: 'start' }>['iceServers'];
  audio?: boolean;
  onLog?: (message: string, fields?: Record<string, unknown>) => void;
}

export type SessionStartResult =
  | { ok: true; granted: readonly Capability[] }
  | { ok: false; reason: string };

const defaultScheduler: SessionScheduler = {
  setInterval: (handler, milliseconds) => setInterval(handler, milliseconds),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class SessionHost {
  private session: RemoteSession | null = null;
  private channel: SignalingChannel | null = null;
  private unsubscribe: (() => void) | null = null;
  private ticker: unknown = null;
  private ending: Promise<void> | null = null;
  private captureStarted = false;
  private nextIndicatorUpdate = 0;
  private signalingQueue: Promise<void> = Promise.resolve();
  private readonly windows: Record<DataChannelKind, ReplayWindow> = {
    // Compartir una ventana hace que un movimiento adelantado invalide una tecla
    // fiable con el mismo numero de secuencia.
    input: newReplayWindow(),
    control: newReplayWindow(),
  };
  private readonly now: () => number;
  private readonly scheduler: SessionScheduler;

  constructor(private readonly options: SessionHostOptions) {
    this.now = options.now ?? Date.now;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  async start(rawRequest: unknown): Promise<SessionStartResult> {
    if (this.session !== null) return { ok: false, reason: 'este host ya recibio una solicitud' };

    const parsed = requestSchema.safeParse(rawRequest);
    if (!parsed.success) return { ok: false, reason: 'la solicitud de sesion no cumple el esquema' };
    const request = parsed.data;

    this.session = new RemoteSession(request.sessionId, request.deviceId, this.options.policy);
    try {
      this.channel = await this.options.signaling.open(request.sessionId, this.options.hostDeviceId);
    } catch (error) {
      this.log('no se pudo abrir el transporte de senalizacion', { error: String(error) });
      await this.end('transport_failed');
      return { ok: false, reason: 'no se pudo abrir el transporte de senalizacion' };
    }
    this.unsubscribe = this.channel.subscribe((message) => {
      // La cola conserva el orden incluso si el transporte entrega callbacks sin
      // esperar a que termine la verificacion criptografica anterior.
      this.signalingQueue = this.signalingQueue
        .then(() => this.handleSignaling(message))
        .catch((error: unknown) => this.failTransport(error));
    });

    const requested = this.session.request(request.requested, this.now());
    if (!requested.ok) {
      await this.send('session.deny', { reason: requested.code });
      await this.end('protocol_error');
      return { ok: false, reason: requested.detail };
    }

    this.startTicker();
    if (requested.state === 'awaiting_user') {
      let decision: SessionDecision;
      try {
        decision = await this.options.askUser(request, requested.granted);
      } catch (error) {
        this.log('no se pudo pedir la decision local', { error: String(error) });
        await this.end('protocol_error');
        return { ok: false, reason: 'no se pudo pedir la decision local' };
      }
      if (!this.session.userDecision(decision.accepted, decision.granted, this.now())) {
        await this.end('protocol_error');
        return { ok: false, reason: 'la sesion dejo de esperar la decision local' };
      }
      if (this.session.snapshot().state === 'ended') {
        await this.send('session.deny', { reason: 'user_rejected' });
        await this.end('user_rejected');
        return { ok: false, reason: 'el usuario rechazo la sesion' };
      }
    }

    const granted = this.session.snapshot().granted;
    if (!(await this.send('session.accept', { granted }))) {
      return { ok: false, reason: 'fallo el transporte de senalizacion' };
    }

    try {
      await this.prepareCapture(request.sessionId);
    } catch (error) {
      this.log('no se pudo preparar la captura', { error: String(error) });
      await this.end('protocol_error');
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }

    return { ok: true, granted: [...granted] };
  }

  /** entrada unica de los mensajes ya validados por CaptureHost */
  async handleCaptureMessage(message: FromCapture): Promise<void> {
    const session = this.session;
    if (session === null || session.snapshot().state === 'ended') return;

    switch (message.type) {
      case 'offer': {
        const signed = signSdp(
          this.options.privateKey,
          'offer',
          session.sessionId,
          message.sdp,
        );
        await this.send('sdp.offer', signed);
        return;
      }
      case 'ice':
        await this.send('ice.candidate', {
          candidate: message.candidate,
          sdpMid: message.sdpMid,
          sdpMLineIndex: message.sdpMLineIndex,
        });
        return;
      case 'state':
        if (message.state === 'connected') this.activate();
        else if (message.state === 'failed' || message.state === 'closed') {
          await this.end('transport_failed');
        }
        return;
      case 'control':
        this.handleControl(message.channel, message.raw);
        return;
      case 'error':
        this.log('el renderer de captura informo de un error', {
          code: message.code,
          detail: message.detail,
        });
        await this.end('transport_failed');
        return;
      case 'stats':
        return;
    }
  }

  /** se llama desde los tres eventos de screen de Electron */
  async displaysChanged(): Promise<void> {
    if (this.session === null || this.session.snapshot().state === 'ended') return;
    const displays = await this.options.captureHost.refreshDisplays();
    // La MISMA instancia de lista alimenta captura y entrada: dos lecturas
    // separadas pueden observar disposiciones distintas durante un hot-plug.
    this.options.dispatcher.updateDisplays(displays);

    if (!this.captureStarted) return;
    const source = this.options.captureHost.resolveSource(this.options.dispatcher.currentMonitorId());
    if (source === null || source.sourceId === null) {
      await this.end('protocol_error');
      return;
    }
    this.options.captureHost.send(this.switchMessage(source));
  }

  async checkNow(): Promise<void> {
    const session = this.session;
    if (session === null) return;
    const cause = session.checkExpiry(this.now(), this.options.isDeviceActive());
    if (cause !== null) await this.end(cause);
  }

  async end(cause: SessionEndCause): Promise<void> {
    if (this.ending !== null) return this.ending;
    this.session?.end(cause, this.now());
    this.ending = this.cleanup(cause);
    return this.ending;
  }

  snapshot(): ReturnType<RemoteSession['snapshot']> | null {
    return this.session?.snapshot() ?? null;
  }

  private async prepareCapture(sessionId: string): Promise<void> {
    const displays = await this.options.captureHost.refreshDisplays();
    this.options.dispatcher.updateDisplays(displays);
    this.options.captureHost.installDisplayMediaHandler(() =>
      this.options.dispatcher.currentMonitorId(),
    );

    const source = this.options.captureHost.resolveSource(this.options.dispatcher.currentMonitorId());
    if (source === null || source.sourceId === null) {
      throw new Error('no hay ningun monitor que se pueda capturar');
    }

    await this.options.captureHost.ensureWindow();
    this.options.captureHost.send({
      type: 'start',
      sessionId,
      sourceId: source.sourceId,
      monitorId: source.id,
      sourceHeight: toPhysical(source).height,
      quality: this.options.quality ?? { preset: 'auto' },
      iceServers: this.options.iceServers ?? [],
      audio: this.options.audio ?? false,
    });
    this.captureStarted = true;
  }

  private async handleSignaling(raw: unknown): Promise<void> {
    const session = this.session;
    if (session === null) return;
    const verdict = acceptSignaling(raw, session.sessionId, this.options.hostDeviceId);
    if (!verdict.ok) {
      this.log('mensaje de senalizacion rechazado', { code: verdict.code });
      return;
    }

    const message = verdict.message;
    switch (message.kind) {
      case 'sdp.answer': {
        const parsed = signedSdpSchema.safeParse(message.payload);
        if (!parsed.success) {
          await this.end('protocol_error');
          return;
        }
        // verifySdp autentica antes de extraer la huella o entregar el SDP al
        // renderer. El gateway nunca decide que clave se usa aqui.
        const verified = verifySdp(parsed.data as SignedSdp, {
          pinnedPublicKey: this.options.pinnedPublicKey,
          expectedSession: session.sessionId,
          expectedRole: 'answer',
        });
        if (!verified.ok) {
          await this.end('protocol_error');
          return;
        }

        const previous = session.fingerprints();
        if (previous.length === 0) {
          if (!session.beginNegotiation(verified.fingerprints, this.now())) {
            await this.end('protocol_error');
            return;
          }
        } else if (!fingerprintsUnchanged(previous, verified.fingerprints)) {
          await this.end('protocol_error');
          return;
        }
        this.options.captureHost.send({ type: 'answer', sdp: verified.sdp });
        return;
      }
      case 'ice.candidate': {
        const candidate = iceSchema.safeParse(message.payload);
        if (!candidate.success) {
          await this.end('protocol_error');
          return;
        }
        this.options.captureHost.send({ type: 'ice', ...candidate.data });
        return;
      }
      case 'session.end':
        await this.end('user_ended_remote');
        return;
      case 'session.request':
      case 'session.accept':
      case 'session.deny':
      case 'sdp.offer':
        await this.end('protocol_error');
        return;
    }
  }

  private handleControl(channel: DataChannelKind, raw: string): void {
    const session = this.session;
    if (session === null) return;

    const type = controlType(raw);
    if (type !== null && !channelMatches(type, channel)) {
      this.log('mensaje de control recibido por el canal equivocado', { type, channel });
      return;
    }

    const guarded = guardControlMessage(raw, {
      sessionId: session.sessionId,
      granted: session.activeCapabilities(),
      window: this.windows[channel],
      active: session.snapshot().state === 'active',
      now: this.now(),
      maxBytes: MAX_CONTROL_BYTES,
    });
    if (!guarded.ok) {
      this.log('mensaje de control rechazado', { code: guarded.code, channel });
      return;
    }
    // Se repite con el tipo ya validado. Esto defiende incluso si el clasificador
    // previo no reconociera una ampliacion futura del protocolo.
    if (!channelMatches(guarded.message.type, channel)) return;

    if (guarded.message.type === 'monitor.select') {
      const source = this.options.captureHost.resolveSource(guarded.message.monitorId);
      if (source === null || source.sourceId === null) return;
    }

    const dispatched = this.options.dispatcher.dispatch(guarded.message);
    if (!dispatched.ok) {
      this.log('la entrada autorizada no se pudo ejecutar', { reason: dispatched.reason });
    } else if (guarded.message.type === 'monitor.select') {
      const source = this.options.captureHost.resolveSource(guarded.message.monitorId);
      if (source !== null && source.sourceId !== null) {
        this.options.captureHost.send(this.switchMessage(source));
      }
    } else if (guarded.message.type === 'quality.set') {
      this.options.captureHost.send({
        type: 'quality',
        quality: {
          preset: guarded.message.preset,
          ...(guarded.message.maxFps === undefined ? {} : { maxFps: guarded.message.maxFps }),
          ...(guarded.message.maxBitrateKbps === undefined
            ? {}
            : { maxBitrateKbps: guarded.message.maxBitrateKbps }),
          ...(guarded.message.maxHeight === undefined
            ? {}
            : { maxHeight: guarded.message.maxHeight }),
        },
      });
    }
    session.touch(this.now());
  }

  private activate(): void {
    const session = this.session;
    if (session === null) return;
    if (session.snapshot().state === 'active') return;
    if (!session.activate(this.now())) {
      void this.end('protocol_error');
      return;
    }
    this.nextIndicatorUpdate = this.now() + 60_000;
    this.options.indicator.show(this.indicatorState());
  }

  private startTicker(): void {
    if (this.ticker !== null) return;
    this.ticker = this.scheduler.setInterval(() => {
      void this.checkNow();
      if (this.session?.snapshot().state === 'active' && this.now() >= this.nextIndicatorUpdate) {
        this.options.indicator.update(this.indicatorState());
        this.nextIndicatorUpdate = this.now() + 60_000;
      }
    }, 1_000);
  }

  private indicatorState(): IndicatorState {
    const session = this.session;
    if (session === null) throw new Error('no hay sesion para mostrar');
    return {
      controlling: session.activeCapabilities().includes('control'),
      deviceName: this.options.deviceName,
      since: session.snapshot().startedAt,
    };
  }

  private switchMessage(source: CapturableDisplay): Extract<ToCapture, { type: 'switch-monitor' }> {
    if (source.sourceId === null) throw new Error('esa pantalla no tiene fuente de captura');
    return {
      type: 'switch-monitor',
      sourceId: source.sourceId,
      monitorId: source.id,
      sourceHeight: toPhysical(source).height,
    };
  }

  private async send(kind: SignalingKind, payload: unknown): Promise<boolean> {
    const session = this.session;
    const channel = this.channel;
    if (session === null || channel === null || channel.closed) return false;
    try {
      await channel.send(
        signalingMessage(kind, session.sessionId, this.options.hostDeviceId, payload),
      );
      return true;
    } catch (error) {
      await this.failTransport(error);
      return false;
    }
  }

  private async failTransport(error: unknown): Promise<void> {
    this.log('fallo el transporte de senalizacion', { error: String(error) });
    await this.end('transport_failed');
  }

  private async cleanup(cause: SessionEndCause): Promise<void> {
    if (this.ticker !== null) {
      this.scheduler.clearInterval(this.ticker);
      this.ticker = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;

    const channel = this.channel;

    // ESTE ORDEN ES UNA PROTECCION: SendInput no reinicia el teclado. Ni una red
    // colgada ni un dispose que falle pueden retrasar que Ctrl vuelva a subir.
    try {
      this.options.dispatcher.releaseAll();
    } catch (error) {
      this.log('no se pudo liberar toda la entrada', { error: String(error) });
    }
    try {
      this.options.indicator.hide();
    } catch (error) {
      this.log('no se pudo ocultar el indicador remoto', { error: String(error) });
    }
    try {
      await this.options.captureHost.dispose(cause);
    } catch (error) {
      this.log('no se pudo disponer la captura remota', { error: String(error) });
    }

    if (
      channel !== null &&
      !channel.closed &&
      cause !== 'user_ended_remote' &&
      cause !== 'transport_failed'
    ) {
      try {
        await channel.send(
          signalingMessage('session.end', this.session!.sessionId, this.options.hostDeviceId, {
            cause,
          }),
        );
      } catch {
        // El cierre local no se bloquea porque la red ya no responda.
      }
    }
    if (channel !== null && !channel.closed) {
      try {
        await channel.close();
      } catch (error) {
        this.log('no se pudo cerrar el transporte remoto', { error: String(error) });
      }
    }
    this.channel = null;
    this.captureStarted = false;
  }

  private log(message: string, fields: Record<string, unknown> = {}): void {
    this.options.onLog?.(message, fields);
  }
}

/**
 * ranura del proceso principal para la unica sesion remota activa.
 *
 * CaptureHost y los eventos de screen viven durante toda la aplicacion, mientras
 * que SessionHost vive solo durante una conexion. Esta ranura evita que esos
 * callbacks conserven una sesion ya cerrada o que dos sesiones compitan por la
 * misma pantalla y el mismo teclado.
 */
export class SessionHostSlot {
  private active: SessionHost | null = null;

  adopt(host: SessionHost): boolean {
    if (this.active?.snapshot()?.state !== 'ended' && this.active !== null) return false;
    this.active = host;
    return true;
  }

  async handleCaptureMessage(message: FromCapture): Promise<void> {
    await this.active?.handleCaptureMessage(message);
  }

  async displaysChanged(): Promise<void> {
    await this.active?.displaysChanged();
  }

  async end(cause: SessionEndCause): Promise<void> {
    const active = this.active;
    this.active = null;
    await active?.end(cause);
  }
}

function controlType(raw: string): string | null {
  if (!withinControlLimit(raw)) return null;
  try {
    const parsed = controlTypeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.msg.type : null;
  } catch {
    return null;
  }
}
