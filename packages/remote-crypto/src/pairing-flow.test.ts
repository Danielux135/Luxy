// pruebas del flujo completo de emparejamiento, con dos dispositivos de verdad
// y claves de verdad, sin red.
//
// El caso central es el recorrido entero: QR -> reclamar -> mismas palabras en
// las dos pantallas -> confirmar en ambas -> emparejado.
import { describe, it, expect } from 'vitest';
import { generateIdentity, sign, toBase64Url } from './identity.js';
import { buildQrPayload, parseQrPayload, PAIRING_CODE_TTL_MS } from './pairing.js';
import {
  startPairing,
  claimPairing,
  confirmPairing,
  sessionWords,
  isPaired,
  pairedDeviceFrom,
  type PairingSession,
} from './pairing-flow.js';

const AHORA = 1_800_000_000_000;
const CODIGO = '12345678';

const pc = generateIdentity();
const movil = generateIdentity();

function nuevaSesion(): PairingSession {
  return startPairing({
    code: CODIGO,
    hostPublicKey: pc.publicKey,
    hostName: 'PC casa',
    now: AHORA,
  });
}

function firmaDe(identidad: typeof movil, codigo = CODIGO): string {
  return toBase64Url(
    sign(identidad.privateKey, 'luxy.pair.claim.v1', [codigo, toBase64Url(identidad.publicKey)]),
  );
}

function reclamar(session: PairingSession | null, identidad = movil, now = AHORA) {
  return claimPairing({
    session,
    claimantPublicKey: toBase64Url(identidad.publicKey),
    claimantName: 'Daniel-phone',
    claimantKind: 'android',
    signature: firmaDe(identidad),
    now,
  });
}

describe('RECORRIDO COMPLETO', () => {
  it('QR -> reclamar -> mismas palabras -> confirmar en ambas -> emparejado', () => {
    // 1. el escritorio genera el codigo y el QR
    const sesion = nuevaSesion();
    const qr = buildQrPayload({
      gatewayUrl: 'https://gateway.ejemplo.workers.dev',
      code: CODIGO,
      desktopPublicKey: pc.publicKey,
      desktopName: 'PC casa',
      now: AHORA,
    });

    // 2. el movil lo escanea
    const escaneado = parseQrPayload(qr, AHORA);
    expect(escaneado.ok).toBe(true);
    if (!escaneado.ok) return;
    expect(escaneado.desktopPublicKey).toEqual(pc.publicKey);

    // 3. el movil reclama, firmando el codigo
    const reclamada = reclamar(sesion);
    expect(reclamada.ok).toBe(true);
    if (!reclamada.ok) return;
    expect(reclamada.value.state).toBe('claimed');

    // 4. LAS DOS PANTALLAS MUESTRAN LO MISMO
    const palabras = sessionWords(reclamada.value);
    expect(palabras).toHaveLength(4);

    // 5. confirma el movil: todavia NO basta
    const soloMovil = confirmPairing({
      session: reclamada.value,
      side: 'claimant',
      accepted: true,
      now: AHORA,
    });
    expect(soloMovil.ok).toBe(true);
    if (!soloMovil.ok) return;
    expect(soloMovil.value.state).toBe('claimed');
    expect(isPaired(soloMovil.value)).toBe(false);

    // 6. confirma el ordenador: ahora si
    const ambas = confirmPairing({
      session: soloMovil.value,
      side: 'host',
      accepted: true,
      now: AHORA,
    });
    expect(ambas.ok).toBe(true);
    if (!ambas.ok) return;
    expect(ambas.value.state).toBe('confirmed');
    expect(isPaired(ambas.value)).toBe(true);

    // 7. el dispositivo queda listo para guardarse
    const dispositivo = pairedDeviceFrom(ambas.value);
    expect(dispositivo?.publicKey).toBe(toBase64Url(movil.publicKey));
    expect(dispositivo?.name).toBe('Daniel-phone');
    expect(dispositivo?.kind).toBe('android');
  });

  it('el orden de las confirmaciones da igual', () => {
    const reclamada = reclamar(nuevaSesion());
    if (!reclamada.ok) throw new Error('deberia reclamar');

    const host = confirmPairing({ session: reclamada.value, side: 'host', accepted: true, now: AHORA });
    if (!host.ok) throw new Error('deberia confirmar');
    const final = confirmPairing({ session: host.value, side: 'claimant', accepted: true, now: AHORA });

    expect(final.ok).toBe(true);
    if (final.ok) expect(final.value.state).toBe('confirmed');
  });
});

describe('hacen falta LAS DOS confirmaciones', () => {
  it('confirmar dos veces el MISMO lado no empareja', () => {
    // sin esto, un gateway malicioso que hubiera sustituido una clave solo
    // necesitaria enganar a un lado
    const reclamada = reclamar(nuevaSesion());
    if (!reclamada.ok) throw new Error('deberia reclamar');

    let sesion = reclamada.value;
    for (let i = 0; i < 5; i += 1) {
      const paso = confirmPairing({ session: sesion, side: 'claimant', accepted: true, now: AHORA });
      if (!paso.ok) throw new Error('deberia confirmar');
      sesion = paso.value;
    }

    expect(sesion.state).toBe('claimed');
    expect(isPaired(sesion)).toBe(false);
  });

  it('un rechazo de cualquiera de los dos mata el codigo', () => {
    const reclamada = reclamar(nuevaSesion());
    if (!reclamada.ok) throw new Error('deberia reclamar');

    const rechazada = confirmPairing({
      session: reclamada.value,
      side: 'host',
      accepted: false,
      now: AHORA,
    });
    expect(rechazada.ok).toBe(true);
    if (!rechazada.ok) return;
    expect(rechazada.value.state).toBe('rejected');
    expect(isPaired(rechazada.value)).toBe(false);
  });

  it('un codigo rechazado no se puede confirmar despues', () => {
    const reclamada = reclamar(nuevaSesion());
    if (!reclamada.ok) throw new Error('deberia reclamar');
    const rechazada = confirmPairing({
      session: reclamada.value,
      side: 'host',
      accepted: false,
      now: AHORA,
    });
    if (!rechazada.ok) return;

    const intento = confirmPairing({
      session: rechazada.value,
      side: 'claimant',
      accepted: true,
      now: AHORA,
    });
    expect(intento.ok).toBe(false);
    if (!intento.ok) expect(intento.code).toBe('wrong_state');
  });
});

describe('el hombre en el medio', () => {
  it('un tercero produce palabras DISTINTAS en cada pantalla', () => {
    // esto es lo que el usuario detecta comparando las dos pantallas
    const atacante = generateIdentity();

    const legitima = reclamar(nuevaSesion());
    const suplantada = reclamar(nuevaSesion(), atacante);
    if (!legitima.ok || !suplantada.ok) throw new Error('deberian reclamar');

    expect(sessionWords(suplantada.value)).not.toEqual(sessionWords(legitima.value));
  });

  it('reclamar con una clave que no se controla NO es posible', () => {
    // el atacante pone la clave publica del movil legitimo pero firma con la suya
    const atacante = generateIdentity();
    const resultado = claimPairing({
      session: nuevaSesion(),
      claimantPublicKey: toBase64Url(movil.publicKey),
      claimantName: 'impostor',
      claimantKind: 'android',
      signature: firmaDe(atacante),
      now: AHORA,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('bad_signature');
  });

  it('una firma de OTRO codigo no vale', () => {
    const resultado = claimPairing({
      session: nuevaSesion(),
      claimantPublicKey: toBase64Url(movil.publicKey),
      claimantName: 'Daniel-phone',
      claimantKind: 'android',
      signature: firmaDe(movil, '87654321'),
      now: AHORA,
    });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('bad_signature');
  });
});

describe('un solo uso y caducidad', () => {
  it('el segundo que reclama llega tarde', () => {
    const atacante = generateIdentity();
    const primera = reclamar(nuevaSesion());
    if (!primera.ok) throw new Error('deberia reclamar');

    const segunda = reclamar(primera.value, atacante);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.code).toBe('already_used');
  });

  it('un codigo caducado no se reclama', () => {
    const resultado = reclamar(nuevaSesion(), movil, AHORA + PAIRING_CODE_TTL_MS + 1);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('expired');
  });

  it('un codigo caducado tampoco se confirma', () => {
    const reclamada = reclamar(nuevaSesion());
    if (!reclamada.ok) throw new Error('deberia reclamar');

    const tarde = confirmPairing({
      session: reclamada.value,
      side: 'host',
      accepted: true,
      now: AHORA + PAIRING_CODE_TTL_MS + 1,
    });
    expect(tarde.ok).toBe(false);
    if (!tarde.ok) expect(tarde.code).toBe('expired');
  });

  it('un codigo inventado no existe', () => {
    const resultado = reclamar(null);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('not_found');
  });
});

describe('claves invalidas', () => {
  it('un dispositivo no se empareja consigo mismo', () => {
    const resultado = claimPairing({
      session: nuevaSesion(),
      claimantPublicKey: toBase64Url(pc.publicKey),
      claimantName: 'yo mismo',
      claimantKind: 'desktop',
      signature: firmaDe(pc),
      now: AHORA,
    });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('same_key');
  });

  it('una clave fuera de la curva se rechaza', () => {
    const bytes = new Uint8Array(65).fill(0x07);
    bytes[0] = 0x04;
    const resultado = claimPairing({
      session: nuevaSesion(),
      claimantPublicKey: toBase64Url(bytes),
      claimantName: 'raro',
      claimantKind: 'android',
      signature: firmaDe(movil),
      now: AHORA,
    });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('bad_key');
  });
});

describe('antes de reclamar', () => {
  it('no hay palabras que comparar todavia', () => {
    expect(sessionWords(nuevaSesion())).toBeNull();
  });

  it('no se puede confirmar lo que nadie ha reclamado', () => {
    const resultado = confirmPairing({
      session: nuevaSesion(),
      side: 'host',
      accepted: true,
      now: AHORA,
    });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('wrong_state');
  });

  it('no hay dispositivo que guardar', () => {
    expect(pairedDeviceFrom(nuevaSesion())).toBeNull();
  });
});
