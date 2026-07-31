// negociacion completa entre dos pares, con TODA la pila puesta.
//
// Las pruebas anteriores comprueban cada pieza por separado. Esta comprueba que
// encajan: emparejamiento -> sesion -> SDP firmado -> ICE -> activa -> un evento
// de control pasando por la puerta. Es donde aparecen los fallos de integracion,
// que son los que sobreviven a las pruebas unitarias.
import { describe, it, expect, beforeEach } from 'vitest';
import { generateIdentity, signSdp, verifySdp } from '@luxy/remote-crypto';
import {
  InMemorySignaling,
  signalingMessage,
  acceptSignaling,
  type SignalingChannel,
} from './signaling.js';
import { RemoteSession } from './session-state.js';
import { guardControlMessage } from './guard.js';
import { newReplayWindow } from './envelope.js';
import { PROTOCOL_VERSION } from './version.js';
import type { Capability } from './capabilities.js';

const SESION = '88888888-8888-4888-8888-888888888888';
const HOST_ID = '11111111-1111-4111-8111-111111111111';
const MOVIL_ID = '22222222-2222-4222-8222-222222222222';
const T0 = 1_800_000_000_000;

const pc = generateIdentity();
const movil = generateIdentity();

function sdpDe(quien: string): string {
  return [
    'v=0',
    `o=- 1 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    // hexadecimal de verdad: una huella DTLS no puede llevar letras fuera de A-F
    `a=fingerprint:sha-256 ${quien === 'host' ? 'AA' : 'BE'}:BB:CC:DD:EE:FF`,
    'a=setup:actpass',
  ].join('\r\n');
}

let transporte: InMemorySignaling;
let canalHost: SignalingChannel;
let canalMovil: SignalingChannel;

beforeEach(async () => {
  transporte = new InMemorySignaling();
  canalHost = await transporte.open(SESION, HOST_ID);
  canalMovil = await transporte.open(SESION, MOVIL_ID);
});

/** espera a que llegue un mensaje del tipo pedido, o falla por timeout */
function esperar(canal: SignalingChannel, kind: string, self: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`no llego ${kind}`)), 1000);
    const cancelar = canal.subscribe((mensaje) => {
      const veredicto = acceptSignaling(mensaje, SESION, self);
      if (!veredicto.ok || veredicto.message.kind !== kind) return;
      clearTimeout(timeout);
      cancelar();
      resolve(veredicto.message.payload);
    });
  });
}

describe('negociacion completa', () => {
  it('de la peticion al primer clic, con acceso desatendido', async () => {
    // ---- 1. el host tiene al movil emparejado y con desatendido activo ----
    const sesion = new RemoteSession(SESION, MOVIL_ID, {
      devicePermissions: ['view', 'control'] as Capability[],
      unattended: true,
      deviceActive: true,
    });

    // ---- 2. el movil pide sesion ----
    const peticion = sesion.request(['view', 'control'], T0);
    expect(peticion.ok).toBe(true);
    if (!peticion.ok) return;
    // desatendido: no espera a nadie
    expect(peticion.state).toBe('negotiating');

    // ---- 3. el host manda la oferta FIRMADA ----
    const ofertaEsperada = esperar(canalMovil, 'sdp.offer', MOVIL_ID);
    const oferta = signSdp(pc.privateKey, 'offer', SESION, sdpDe('host'));
    await canalHost.send(signalingMessage('sdp.offer', SESION, HOST_ID, oferta));

    // ---- 4. el movil la verifica CONTRA LA CLAVE ANCLADA ----
    const recibida = (await ofertaEsperada) as typeof oferta;
    const veredicto = verifySdp(recibida, {
      pinnedPublicKey: pc.publicKey,
      expectedSession: SESION,
      expectedRole: 'offer',
    });
    expect(veredicto.ok).toBe(true);
    if (!veredicto.ok) return;

    // ---- 5. el movil responde, tambien firmado ----
    const respuestaEsperada = esperar(canalHost, 'sdp.answer', HOST_ID);
    const respuesta = signSdp(movil.privateKey, 'answer', SESION, sdpDe('movil'));
    await canalMovil.send(signalingMessage('sdp.answer', SESION, MOVIL_ID, respuesta));

    const devuelta = (await respuestaEsperada) as typeof respuesta;
    const veredictoRespuesta = verifySdp(devuelta, {
      pinnedPublicKey: movil.publicKey,
      expectedSession: SESION,
      expectedRole: 'answer',
    });
    expect(veredictoRespuesta.ok).toBe(true);
    if (!veredictoRespuesta.ok) return;

    // ---- 6. se anotan las huellas y la sesion pasa a activa ----
    sesion.beginNegotiation(veredictoRespuesta.fingerprints, T0 + 500);
    expect(sesion.activate(T0 + 1000)).toBe(true);
    expect(sesion.activeCapabilities()).toEqual(['view', 'control']);

    // ---- 7. UN CLIC, pasando por la puerta ----
    const ventana = newReplayWindow();
    const clic = JSON.stringify({
      v: PROTOCOL_VERSION,
      sid: SESION,
      seq: 1,
      ts: T0 + 1100,
      msg: { type: 'mouse.button', button: 'left', action: 'down', x: 0.5, y: 0.5 },
    });

    const resultado = guardControlMessage(clic, {
      sessionId: SESION,
      granted: sesion.activeCapabilities(),
      window: ventana,
      active: true,
      now: T0 + 1100,
    });

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.message.type).toBe('mouse.button');
  });

  it('en modo atendido, sin confirmar nadie NO se llega a negociar', async () => {
    const sesion = new RemoteSession(SESION, MOVIL_ID, {
      devicePermissions: ['view', 'control'] as Capability[],
      unattended: false,
      deviceActive: true,
    });

    const peticion = sesion.request(['view', 'control'], T0);
    if (!peticion.ok) return;
    expect(peticion.state).toBe('awaiting_user');

    // aunque llegara una oferta, la sesion no la puede aceptar
    expect(sesion.beginNegotiation(['sha-256 AA'], T0 + 100)).toBe(false);
    expect(sesion.activeCapabilities()).toEqual([]);
  });
});

describe('el transporte no puede falsificar nada', () => {
  it('un transporte que ALTERA la oferta se detecta al verificar', async () => {
    // el transporte mueve sobres opacos; toda la seguridad vive por encima
    const oferta = signSdp(pc.privateKey, 'offer', SESION, sdpDe('host'));
    const alterada = {
      ...oferta,
      sdp: oferta.sdp.replace('a=setup:actpass', 'a=setup:passive'),
    };

    const veredicto = verifySdp(alterada, {
      pinnedPublicKey: pc.publicKey,
      expectedSession: SESION,
      expectedRole: 'offer',
    });

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('bad_signature');
  });

  it('un transporte que INVENTA una oferta se detecta', async () => {
    const atacante = generateIdentity();
    const falsa = signSdp(atacante.privateKey, 'offer', SESION, sdpDe('falso'));

    const veredicto = verifySdp(falsa, {
      pinnedPublicKey: pc.publicKey,
      expectedSession: SESION,
      expectedRole: 'offer',
    });
    expect(veredicto.ok).toBe(false);
  });
});

describe('propiedades del transporte', () => {
  it('un mensaje NO le vuelve a quien lo envio', async () => {
    // Supabase Realtime devuelve al emisor lo que publica; sin filtrar, un
    // extremo procesaria su propia oferta como si fuera la del otro
    let propios = 0;
    canalHost.subscribe((m) => {
      if (acceptSignaling(m, SESION, HOST_ID).ok) propios += 1;
    });

    await canalHost.send(signalingMessage('sdp.offer', SESION, HOST_ID, {}));
    await new Promise((r) => setTimeout(r, 20));

    expect(propios).toBe(0);
  });

  it('el eco del propio mensaje se descarta explicitamente', () => {
    const propio = signalingMessage('sdp.offer', SESION, HOST_ID, {});
    const veredicto = acceptSignaling(propio, SESION, HOST_ID);

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('own_message');
  });

  it('un canal CERRADO no entrega nada', async () => {
    let recibidos = 0;
    canalMovil.subscribe(() => (recibidos += 1));
    await canalMovil.close();

    await canalHost.send(signalingMessage('ice.candidate', SESION, HOST_ID, {}));
    await new Promise((r) => setTimeout(r, 20));

    expect(recibidos).toBe(0);
  });

  it('un canal cerrado tampoco acepta envios', async () => {
    await canalHost.close();
    await expect(
      canalHost.send(signalingMessage('ice.candidate', SESION, HOST_ID, {})),
    ).rejects.toThrow(/cerrado/);
  });

  it('no se puede enviar en nombre de otro', async () => {
    await expect(
      canalHost.send(signalingMessage('sdp.offer', SESION, MOVIL_ID, {})),
    ).rejects.toThrow(/en nombre de otro/);
  });

  it('un mensaje de otra sesion se rechaza', () => {
    const ajeno = signalingMessage('sdp.offer', SESION, MOVIL_ID, {});
    const veredicto = acceptSignaling({ ...ajeno, sessionId: SESION }, 'otra', HOST_ID);

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('wrong_session');
  });

  it('cerrar libera el canal', async () => {
    expect(transporte.openChannels()).toBe(2);
    await canalHost.close();
    await canalMovil.close();
    expect(transporte.openChannels()).toBe(0);
  });
});

describe('red poco fiable', () => {
  it('la DUPLICACION de un candidato no rompe nada', async () => {
    // una red real duplica; el codigo no puede asumir entrega exactamente-una-vez
    transporte.duplicate = true;
    const recibidos: unknown[] = [];
    canalMovil.subscribe((m) => {
      const v = acceptSignaling(m, SESION, MOVIL_ID);
      if (v.ok) recibidos.push(v.message.payload);
    });

    await canalHost.send(signalingMessage('ice.candidate', SESION, HOST_ID, { candidate: 'a' }));
    await new Promise((r) => setTimeout(r, 20));

    // llegan dos: quien consuma debe ser idempotente, y esta prueba lo deja
    // documentado en vez de que se descubra en produccion
    expect(recibidos).toHaveLength(2);
    expect(recibidos[0]).toEqual(recibidos[1]);
  });

  it('con perdida total no llega nada, y no se cuelga', async () => {
    transporte.lossRate = 1;
    let recibidos = 0;
    canalMovil.subscribe(() => (recibidos += 1));

    await canalHost.send(signalingMessage('sdp.offer', SESION, HOST_ID, {}));
    await new Promise((r) => setTimeout(r, 20));

    expect(recibidos).toBe(0);
  });
});

describe('limites', () => {
  it('un mensaje enorme se rechaza', () => {
    const enorme = signalingMessage('sdp.offer', SESION, MOVIL_ID, {
      sdp: 'x'.repeat(200_000),
    });
    const veredicto = acceptSignaling(enorme, SESION, HOST_ID);

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('too_large');
  });

  it('un mensaje con forma invalida se rechaza', () => {
    const veredicto = acceptSignaling({ kind: 'inventado' }, SESION, HOST_ID);
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('malformed');
  });

  it('texto que no es JSON se rechaza sin reventar', () => {
    const veredicto = acceptSignaling('{roto', SESION, HOST_ID);
    expect(veredicto.ok).toBe(false);
  });
});

describe('cierre de sesion', () => {
  it('tras cerrar, un evento de control ya no pasa la puerta', () => {
    const sesion = new RemoteSession(SESION, MOVIL_ID, {
      devicePermissions: ['view', 'control'] as Capability[],
      unattended: true,
      deviceActive: true,
    });
    sesion.request(['view', 'control'], T0);
    sesion.beginNegotiation([], T0 + 100);
    sesion.activate(T0 + 200);
    sesion.end('user_ended_local', T0 + 1000);

    const clic = JSON.stringify({
      v: PROTOCOL_VERSION,
      sid: SESION,
      seq: 1,
      ts: T0 + 1100,
      msg: { type: 'mouse.move', x: 0.5, y: 0.5 },
    });

    const resultado = guardControlMessage(clic, {
      sessionId: SESION,
      granted: sesion.activeCapabilities(),
      window: newReplayWindow(),
      active: false,
      now: T0 + 1100,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('session_closed');
  });
});
