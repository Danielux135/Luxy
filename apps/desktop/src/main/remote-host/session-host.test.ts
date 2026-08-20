import { describe, expect, it, vi } from 'vitest';
import {
  InMemorySignaling,
  SESSION_END_CAUSES,
  nextEnvelope,
  signalingMessage,
  type Capability,
  type ControlMessage,
  type SessionEndCause,
  type SignalingChannel,
} from '@luxy/remote-protocol';
import { generateIdentity, signSdp, verifySdp } from '@luxy/remote-crypto';
import type { ToCapture } from '../../shared/capture-ipc.js';
import type { CapturableDisplay } from './display-sources.js';
import {
  SessionHost,
  SessionHostSlot,
  type CaptureHostPort,
  type InputDispatcherPort,
  type SessionHostOptions,
  type SessionIndicatorPort,
  type SessionScheduler,
} from './session-host.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MOBILE_ID = '33333333-3333-4333-8333-333333333333';
const SDP = 'v=0\r\na=fingerprint:sha-256 AA:BB:CC\r\n';

function display(id = 'monitor-1', sourceId = 'screen:1:0'): CapturableDisplay {
  return {
    id,
    label: id,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    physical: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    primary: true,
    rotation: 0,
    sourceId,
  };
}

class FakeCapture implements CaptureHostPort {
  readonly sent: ToCapture[] = [];
  readonly calls: string[] = [];
  displays: CapturableDisplay[] = [display()];
  selected: (() => string | null) | null = null;

  async refreshDisplays(): Promise<CapturableDisplay[]> {
    this.calls.push('refresh');
    return this.displays;
  }

  resolveSource(monitorId: string | null): CapturableDisplay | null {
    if (monitorId === null) return this.displays.find((entry) => entry.primary) ?? null;
    const found = this.displays.find((entry) => entry.id === monitorId);
    return found?.sourceId === null ? null : found ?? null;
  }

  installDisplayMediaHandler(selected: () => string | null): void {
    this.calls.push('install');
    this.selected = selected;
  }

  async ensureWindow(): Promise<void> {
    this.calls.push('window');
  }

  send(message: ToCapture): void {
    this.calls.push(`send:${message.type}`);
    this.sent.push(message);
  }

  async dispose(_reason: string): Promise<void> {
    this.calls.push('dispose');
  }
}

class FakeDispatcher implements InputDispatcherPort {
  readonly dispatched: ControlMessage[] = [];
  readonly calls: string[] = [];
  displays: readonly CapturableDisplay[] = [];
  monitorId: string | null = null;

  updateDisplays(displays: readonly CapturableDisplay[]): void {
    this.calls.push('update-displays');
    this.displays = displays;
    if (this.monitorId !== null && !displays.some((entry) => entry.id === this.monitorId)) {
      this.monitorId = null;
    }
  }

  currentMonitorId(): string | null {
    return this.monitorId;
  }

  dispatch(message: ControlMessage): { ok: boolean } {
    this.calls.push(`dispatch:${message.type}`);
    this.dispatched.push(message);
    if (message.type === 'monitor.select') this.monitorId = message.monitorId;
    return { ok: true };
  }

  releaseAll(): void {
    this.calls.push('release');
  }
}

class FakeIndicator implements SessionIndicatorPort {
  readonly show = vi.fn();
  readonly update = vi.fn();
  readonly hide = vi.fn();
}

class FakeScheduler implements SessionScheduler {
  handler: (() => void) | null = null;

  setInterval(handler: () => void): unknown {
    this.handler = handler;
    return handler;
  }

  clearInterval(): void {
    this.handler = null;
  }
}

interface Harness {
  host: SessionHost;
  transport: InMemorySignaling;
  mobileChannel: SignalingChannel;
  capture: FakeCapture;
  dispatcher: FakeDispatcher;
  indicator: FakeIndicator;
  scheduler: FakeScheduler;
  mobileIdentity: ReturnType<typeof generateIdentity>;
  hostIdentity: ReturnType<typeof generateIdentity>;
  active: { value: boolean };
  now: { value: number };
  order: string[];
}

async function harness(
  granted: readonly Capability[] = ['view', 'control'],
  overrides: Partial<SessionHostOptions> = {},
): Promise<Harness> {
  const transport = new InMemorySignaling();
  const mobileChannel = await transport.open(SESSION_ID, MOBILE_ID);
  const hostIdentity = generateIdentity();
  const mobileIdentity = generateIdentity();
  const capture = new FakeCapture();
  const dispatcher = new FakeDispatcher();
  const indicator = new FakeIndicator();
  const scheduler = new FakeScheduler();
  const active = { value: true };
  const now = { value: Date.now() };
  const order: string[] = [];

  const originalRelease = dispatcher.releaseAll.bind(dispatcher);
  dispatcher.releaseAll = () => {
    order.push('release');
    originalRelease();
  };
  const originalDispose = capture.dispose.bind(capture);
  capture.dispose = async (reason: string) => {
    order.push('dispose');
    await originalDispose(reason);
  };

  const host = new SessionHost({
    hostDeviceId: HOST_ID,
    deviceName: 'Pixel de Daniel',
    policy: {
      devicePermissions: granted,
      unattended: true,
      deviceActive: true,
      idleTimeoutMs: 1_000,
    },
    privateKey: hostIdentity.privateKey,
    pinnedPublicKey: mobileIdentity.publicKey,
    signaling: transport,
    captureHost: capture,
    dispatcher,
    indicator,
    askUser: async (_request, available) => ({ accepted: true, granted: available }),
    isDeviceActive: () => active.value,
    now: () => now.value,
    scheduler,
    ...overrides,
  });

  return {
    host,
    transport,
    mobileChannel,
    capture,
    dispatcher,
    indicator,
    scheduler,
    mobileIdentity,
    hostIdentity,
    active,
    now,
    order,
  };
}

async function start(h: Harness, requested: readonly Capability[] = ['view', 'control']): Promise<void> {
  const result = await h.host.start({
    sessionId: SESSION_ID,
    deviceId: MOBILE_ID,
    requested,
  });
  expect(result.ok).toBe(true);
}

async function activate(h: Harness): Promise<void> {
  await start(h);
  await h.host.handleCaptureMessage({ type: 'offer', sdp: SDP });
  const answer = signSdp(h.mobileIdentity.privateKey, 'answer', SESSION_ID, SDP);
  await h.mobileChannel.send(signalingMessage('sdp.answer', SESSION_ID, MOBILE_ID, answer));
  await settle();
  await h.host.handleCaptureMessage({ type: 'state', state: 'connected', detail: '' });
  expect(h.host.snapshot()?.state).toBe('active');
}

function controlRaw(
  message: ControlMessage,
  counter: { seq: number },
  now = Date.now(),
): string {
  return JSON.stringify({ ...nextEnvelope(SESSION_ID, counter), ts: now, msg: message });
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('SessionHost', () => {
  it('completa la negociacion firmada y no entrega la respuesta antes de verificarla', async () => {
    const h = await harness();
    const offers: unknown[] = [];
    h.mobileChannel.subscribe((message) => {
      if (message.kind === 'sdp.offer') offers.push(message.payload);
    });

    await start(h);
    expect(h.dispatcher.displays).toBe(h.capture.displays);
    expect(h.capture.calls).toEqual(['refresh', 'install', 'window', 'send:start']);

    await h.host.handleCaptureMessage({ type: 'offer', sdp: SDP });
    await settle();
    const offer = offers[0] as ReturnType<typeof signSdp>;
    expect(verifySdp(offer, {
      pinnedPublicKey: h.hostIdentity.publicKey,
      expectedSession: SESSION_ID,
      expectedRole: 'offer',
    }).ok).toBe(true);

    const badAnswer = signSdp(h.mobileIdentity.privateKey, 'answer', SESSION_ID, `${SDP}a=x:1\r\n`);
    badAnswer.sdp = SDP;
    await h.mobileChannel.send(signalingMessage('sdp.answer', SESSION_ID, MOBILE_ID, badAnswer));
    await settle();

    expect(h.capture.sent.some((message) => message.type === 'answer')).toBe(false);
    expect(h.host.snapshot()?.endCause).toBe('protocol_error');
  });

  it('activa el indicador y mantiene dos ventanas anti-replay independientes', async () => {
    const h = await harness();
    await activate(h);

    const inputCounter = { seq: 9 };
    const controlCounter = { seq: 0 };
    await h.host.handleCaptureMessage({
      type: 'control',
      channel: 'input',
      raw: controlRaw({ type: 'mouse.move', x: 0.25, y: 0.5 }, inputCounter, h.now.value),
    });
    await h.host.handleCaptureMessage({
      type: 'control',
      channel: 'control',
      raw: controlRaw({ type: 'key.press', key: 'enter', modifiers: [] }, controlCounter, h.now.value),
    });

    expect(h.dispatcher.dispatched.map((message) => message.type)).toEqual([
      'mouse.move',
      'key.press',
    ]);
    expect(h.indicator.show).toHaveBeenCalledWith(
      expect.objectContaining({ controlling: true, deviceName: 'Pixel de Daniel' }),
    );
  });

  it('corta si una renegociacion firmada cambia la huella DTLS', async () => {
    const h = await harness();
    await activate(h);
    const changed = signSdp(
      h.mobileIdentity.privateKey,
      'answer',
      SESSION_ID,
      'v=0\r\na=fingerprint:sha-256 DD:EE:FF\r\n',
    );

    await h.mobileChannel.send(signalingMessage('sdp.answer', SESSION_ID, MOBILE_ID, changed));
    await settle();

    expect(h.host.snapshot()?.endCause).toBe('protocol_error');
    expect(h.order).toEqual(['release', 'dispose']);
  });

  it('rechaza el canal equivocado antes de consumir su secuencia', async () => {
    const h = await harness();
    await activate(h);
    const counter = { seq: 0 };

    await h.host.handleCaptureMessage({
      type: 'control',
      channel: 'input',
      raw: controlRaw({ type: 'key.press', key: 'enter', modifiers: [] }, counter, h.now.value),
    });
    counter.seq = 0;
    await h.host.handleCaptureMessage({
      type: 'control',
      channel: 'input',
      raw: controlRaw({ type: 'mouse.move', x: 0.5, y: 0.5 }, counter, h.now.value),
    });

    expect(h.dispatcher.dispatched.map((message) => message.type)).toEqual(['mouse.move']);
  });

  it('una sesion de solo visualizacion no mueve el raton', async () => {
    const h = await harness(['view']);
    await activate(h);
    const counter = { seq: 0 };

    await h.host.handleCaptureMessage({
      type: 'control',
      channel: 'input',
      raw: controlRaw({ type: 'mouse.move', x: 0.5, y: 0.5 }, counter, h.now.value),
    });

    expect(h.dispatcher.dispatched).toEqual([]);
    expect(h.indicator.show).toHaveBeenCalledWith(expect.objectContaining({ controlling: false }));
  });

  it('aplica el limite de control en bytes UTF-8 antes del despacho', async () => {
    const h = await harness();
    await activate(h);
    const raw = JSON.parse(
      controlRaw({ type: 'mouse.move', x: 0.5, y: 0.5 }, { seq: 0 }, h.now.value),
    ) as Record<string, unknown>;
    // Zod elimina campos desconocidos, asi que sin el limite de bytes este
    // relleno cruzaria el IPC y el movimiento acabaria ejecutandose.
    raw['padding'] = '界'.repeat(6_000);

    await h.host.handleCaptureMessage({
      type: 'control',
      channel: 'input',
      raw: JSON.stringify(raw),
    });

    expect(h.dispatcher.dispatched).toEqual([]);
  });

  it('la revocacion en caliente corta una sesion activa', async () => {
    const h = await harness();
    await activate(h);
    h.active.value = false;

    await h.host.checkNow();

    expect(h.host.snapshot()?.endCause).toBe('device_revoked');
    expect(h.order).toEqual(['release', 'dispose']);
    expect(h.transport.openChannels()).toBe(1);
  });

  it('si abrir la senalizacion falla tambien libera antes de disponer captura', async () => {
    const h = await harness(undefined, {
      signaling: {
        open: async () => {
          throw new Error('sin red');
        },
      },
    });

    const result = await h.host.start({
      sessionId: SESSION_ID,
      deviceId: MOBILE_ID,
      requested: ['view'],
    });

    expect(result.ok).toBe(false);
    expect(h.host.snapshot()?.endCause).toBe('transport_failed');
    expect(h.order).toEqual(['release', 'dispose']);
  });

  it.each(SESSION_END_CAUSES)('si termina por %s libera la entrada antes de la captura', async (cause) => {
    const h = await harness();
    await start(h);

    await h.host.end(cause as SessionEndCause);

    expect(h.order).toEqual(['release', 'dispose']);
    expect(h.indicator.hide).toHaveBeenCalledOnce();
  });

  it('al cambiar pantallas vuelve a compartir la misma lista y cambia la captura', async () => {
    const h = await harness();
    await start(h);
    const newDisplays = [display('monitor-2', 'screen:2:0')];
    h.capture.displays = newDisplays;

    await h.host.displaysChanged();

    expect(h.dispatcher.displays).toBe(newDisplays);
    expect(h.capture.sent.at(-1)).toEqual(
      expect.objectContaining({ type: 'switch-monitor', monitorId: 'monitor-2' }),
    );
  });

  it('la ranura de main enruta eventos y corta la sesion al apagar Luxy', async () => {
    const h = await harness();
    const slot = new SessionHostSlot();
    expect(slot.adopt(h.host)).toBe(true);
    await start(h);

    await slot.handleCaptureMessage({ type: 'offer', sdp: SDP });
    await slot.end('host_shutdown');

    expect(h.order).toEqual(['release', 'dispose']);
    expect(h.host.snapshot()?.endCause).toBe('host_shutdown');
  });
});
