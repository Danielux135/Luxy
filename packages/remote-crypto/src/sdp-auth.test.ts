// pruebas de la firma del SDP.
//
// Es el escenario 2 del threat model: un gateway comprometido intentando
// colocarse en medio. WebRTC cifra siempre, asi que el atacante no rompe el
// cifrado: sustituye las huellas DTLS y se convierte en uno de los dos extremos.
import { describe, it, expect } from 'vitest';
import { generateIdentity } from './identity.js';
import {
  signSdp,
  verifySdp,
  extractFingerprints,
  fingerprintsUnchanged,
  MAX_SDP_BYTES,
} from './sdp-auth.js';

const SESION = '55555555-5555-4555-8555-555555555555';
const pc = generateIdentity();
const movil = generateIdentity();

/** SDP minimo pero realista, con huella DTLS */
function sdp(huella = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'): string {
  return [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:F7gI',
    'a=ice-pwd:x9cml/YzichV2+XlhiMu8g',
    `a=fingerprint:sha-256 ${huella}`,
    'a=setup:actpass',
    'a=mid:0',
    'a=rtpmap:96 H264/90000',
  ].join('\r\n');
}

const opciones = { pinnedPublicKey: pc.publicKey, expectedSession: SESION, expectedRole: 'offer' as const };

describe('camino feliz', () => {
  it('una oferta firmada por el par anclado verifica', () => {
    const firmada = signSdp(pc.privateKey, 'offer', SESION, sdp());
    const veredicto = verifySdp(firmada, opciones);

    expect(veredicto.ok).toBe(true);
    if (veredicto.ok) expect(veredicto.fingerprints).toHaveLength(1);
  });

  it('la respuesta usa su propio contexto', () => {
    const firmada = signSdp(movil.privateKey, 'answer', SESION, sdp());
    const veredicto = verifySdp(firmada, {
      pinnedPublicKey: movil.publicKey,
      expectedSession: SESION,
      expectedRole: 'answer',
    });
    expect(veredicto.ok).toBe(true);
  });
});

describe('gateway comprometido intentando colocarse en medio', () => {
  it('SUSTITUIR LA HUELLA DTLS invalida la firma', () => {
    // el ataque real: el atacante no rompe el cifrado, cambia con quien se cifra
    const original = signSdp(pc.privateKey, 'offer', SESION, sdp('AA:AA:AA:AA:AA:AA:AA:AA'));
    const manipulado = {
      ...original,
      sdp: original.sdp.replace('AA:AA:AA:AA:AA:AA:AA:AA', 'BB:BB:BB:BB:BB:BB:BB:BB'),
    };

    const veredicto = verifySdp(manipulado, opciones);
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('bad_signature');
  });

  it('firmar con OTRA clave no vale', () => {
    const atacante = generateIdentity();
    const firmada = signSdp(atacante.privateKey, 'offer', SESION, sdp());

    const veredicto = verifySdp(firmada, opciones);
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('bad_signature');
  });

  it('SIN clave anclada NO se acepta nada', () => {
    // este es el motivo de anclar en disco: si la clave la dictara el gateway,
    // podria dar la del atacante y todas las firmas verificarian
    const firmada = signSdp(pc.privateKey, 'offer', SESION, sdp());
    const veredicto = verifySdp(firmada, { ...opciones, pinnedPublicKey: null });

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('unknown_peer');
  });

  it('una oferta de OTRA sesion no vale aqui', () => {
    const firmada = signSdp(pc.privateKey, 'offer', 'otra-sesion', sdp());
    const veredicto = verifySdp(firmada, opciones);

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('wrong_session');
  });

  it('una RESPUESTA no vale como OFERTA aunque este bien firmada', () => {
    // sin separacion de contextos, capturar una respuesta permitiria inyectarla
    // como oferta en otra negociacion
    const firmada = signSdp(pc.privateKey, 'answer', SESION, sdp());
    const veredicto = verifySdp({ ...firmada, role: 'offer' }, opciones);

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('bad_signature');
  });
});

describe('degradacion del cifrado', () => {
  it('un SDP SIN huella DTLS se rechaza', () => {
    // negociar sin huella significa cifrado sin autenticar: es justo lo que un
    // atacante querria conseguir degradando la negociacion
    const sinHuella = sdp().split('\r\n').filter((l) => !l.startsWith('a=fingerprint')).join('\r\n');
    const firmada = signSdp(pc.privateKey, 'offer', SESION, sinHuella);

    const veredicto = verifySdp(firmada, opciones);
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('no_fingerprint');
  });

  it('la huella se extrae normalizada', () => {
    const huellas = extractFingerprints(sdp('aa:bb:cc:dd'));
    expect(huellas).toEqual(['sha-256 AA:BB:CC:DD']);
  });

  it('un SDP con varias huellas las devuelve todas', () => {
    const doble = `${sdp()}\r\na=fingerprint:sha-1 11:22:33:44`;
    expect(extractFingerprints(doble)).toHaveLength(2);
  });
});

describe('renegociacion', () => {
  it('si la huella CAMBIA a mitad de sesion se detecta', () => {
    // cada SDP se firma por separado, asi que un extremo comprometido podria
    // mandar una renegociacion legitimamente firmada con otra huella
    const antes = extractFingerprints(sdp('AA:AA:AA:AA'));
    const ahora = extractFingerprints(sdp('BB:BB:BB:BB'));
    expect(fingerprintsUnchanged(antes, ahora)).toBe(false);
  });

  it('la misma huella en otro orden sigue siendo la misma', () => {
    expect(fingerprintsUnchanged(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('anadir una huella cuenta como cambio', () => {
    expect(fingerprintsUnchanged(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('limites', () => {
  it('un SDP enorme se rechaza', () => {
    const enorme = `${sdp()}\r\na=x:${'y'.repeat(MAX_SDP_BYTES)}`;
    const firmada = signSdp(pc.privateKey, 'offer', SESION, enorme);

    const veredicto = verifySdp(firmada, opciones);
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('too_large');
  });

  it('un SDP vacio se rechaza', () => {
    const veredicto = verifySdp(
      { role: 'offer', sessionId: SESION, sdp: '', signature: 'x'.repeat(86) },
      opciones,
    );
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.code).toBe('empty');
  });

  it('una firma que no es base64url no revienta', () => {
    const veredicto = verifySdp(
      { role: 'offer', sessionId: SESION, sdp: sdp(), signature: '!!!' },
      opciones,
    );
    expect(veredicto.ok).toBe(false);
  });

  it('ningun rechazo filtra el SDP ni la firma', () => {
    const firmada = signSdp(generateIdentity().privateKey, 'offer', SESION, sdp());
    const veredicto = verifySdp(firmada, opciones);

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) {
      expect(veredicto.detail).not.toContain(firmada.signature);
      expect(veredicto.detail).not.toContain('fingerprint');
    }
  });
});
