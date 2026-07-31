// pruebas de la identidad y del emparejamiento.
//
// Cada bloque corresponde a un escenario del threat model. Lo que se protege
// aqui no es "que funcione": es que NO funcione cuando no debe.
import { describe, it, expect } from 'vitest';
import {
  generateIdentity,
  publicKeyOf,
  sign,
  verify,
  fingerprint,
  formatFingerprint,
  confirmationWords,
  canonicalMessage,
  generateChallenge,
  toBase64Url,
  fromBase64Url,
  timingSafeEqualBytes,
  CONFIRMATION_WORDS,
  PUBLIC_KEY_BYTES,
  SIGNATURE_BYTES,
  FIELD_SEPARATOR,
} from './identity.js';
import {
  buildQrPayload,
  parseQrPayload,
  generatePairingCode,
  claimPairingCode,
  PAIRING_CODE_TTL_MS,
  type PairingRecord,
} from './pairing.js';

const AHORA = 1_800_000_000_000;

describe('identidad', () => {
  it('genera claves del tamano correcto', () => {
    const { privateKey, publicKey } = generateIdentity();
    expect(privateKey).toHaveLength(32);
    expect(publicKey).toHaveLength(PUBLIC_KEY_BYTES);
    // 0x04 = punto sin comprimir
    expect(publicKey[0]).toBe(0x04);
  });

  it('la publica se deriva siempre igual de la privada', () => {
    const { privateKey, publicKey } = generateIdentity();
    expect(publicKeyOf(privateKey)).toEqual(publicKey);
  });

  it('dos identidades nunca coinciden', () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(toBase64Url(a.publicKey)).not.toBe(toBase64Url(b.publicKey));
  });
});

describe('firma', () => {
  const yo = generateIdentity();
  const otro = generateIdentity();

  it('una firma propia verifica', () => {
    const firma = sign(yo.privateKey, 'luxy.sdp.offer.v1', ['sesion-1', 'sdp-aqui']);
    expect(firma).toHaveLength(SIGNATURE_BYTES);
    expect(verify(yo.publicKey, 'luxy.sdp.offer.v1', ['sesion-1', 'sdp-aqui'], firma)).toBe(true);
  });

  it('la firma de OTRA clave no verifica', () => {
    const firma = sign(otro.privateKey, 'luxy.sdp.offer.v1', ['sesion-1', 'sdp']);
    expect(verify(yo.publicKey, 'luxy.sdp.offer.v1', ['sesion-1', 'sdp'], firma)).toBe(false);
  });

  it('cambiar el SDP invalida la firma', () => {
    // el ataque: un gateway comprometido sustituye la huella DTLS dentro del SDP
    const firma = sign(yo.privateKey, 'luxy.sdp.offer.v1', ['s1', 'huella=AA:BB']);
    expect(verify(yo.publicKey, 'luxy.sdp.offer.v1', ['s1', 'huella=CC:DD'], firma)).toBe(false);
  });

  it('una firma de OTRO CONTEXTO no vale', () => {
    // sin separacion de dominios, la firma del emparejamiento serviria para
    // montar una sesion
    const firma = sign(yo.privateKey, 'luxy.pair.claim.v1', ['12345678']);
    expect(verify(yo.publicKey, 'luxy.session.request.v1', ['12345678'], firma)).toBe(false);
  });

  it('una firma manipulada no verifica', () => {
    const firma = sign(yo.privateKey, 'luxy.auth.challenge.v1', ['reto']);
    firma[0] ^= 0xff;
    expect(verify(yo.publicKey, 'luxy.auth.challenge.v1', ['reto'], firma)).toBe(false);
  });

  it('verify NUNCA lanza, devuelve false', () => {
    // si lanzara, un catch mal puesto se volveria "no se pudo verificar, sigamos"
    const firma = sign(yo.privateKey, 'luxy.auth.challenge.v1', ['x']);
    expect(verify(new Uint8Array(10), 'luxy.auth.challenge.v1', ['x'], firma)).toBe(false);
    expect(verify(yo.publicKey, 'luxy.auth.challenge.v1', ['x'], new Uint8Array(3))).toBe(false);
    expect(verify(new Uint8Array(65), 'luxy.auth.challenge.v1', ['x'], firma)).toBe(false);
  });

  it('el troceado de campos no es ambiguo', () => {
    // ("ab","c") y ("a","bc") tienen que dar mensajes distintos
    const uno = canonicalMessage('luxy.pair.claim.v1', ['ab', 'c']);
    const dos = canonicalMessage('luxy.pair.claim.v1', ['a', 'bc']);
    expect(uno).not.toEqual(dos);
  });

  it('una parte con el separador dentro se rechaza en vez de firmarse', () => {
    expect(() => canonicalMessage('luxy.pair.claim.v1', [`a${FIELD_SEPARATOR}b`])).toThrow();
  });
});

describe('huella y palabras de confirmacion', () => {
  const desktop = generateIdentity();
  const movil = generateIdentity();

  it('la huella es estable', () => {
    expect(fingerprint(desktop.publicKey)).toBe(fingerprint(desktop.publicKey));
    expect(fingerprint(desktop.publicKey)).toHaveLength(64);
  });

  it('claves distintas dan huellas distintas', () => {
    expect(fingerprint(desktop.publicKey)).not.toBe(fingerprint(movil.publicKey));
  });

  it('la huella se agrupa para poder leerla', () => {
    const formateada = formatFingerprint(fingerprint(desktop.publicKey));
    expect(formateada.split(' ')).toHaveLength(8);
  });

  it('LAS PALABRAS SON LAS MISMAS EN LOS DOS SENTIDOS', () => {
    // el fallo que esto evita: si se derivaran sin ordenar las claves, el
    // escritorio veria hash(desktop‖movil) y el movil hash(movil‖desktop). Cada
    // pantalla mostraria palabras distintas y el usuario no podria confirmar
    // nunca, o peor, se acostumbraria a confirmar sin mirar.
    const enElDesktop = confirmationWords(desktop.publicKey, movil.publicKey);
    const enElMovil = confirmationWords(movil.publicKey, desktop.publicKey);
    expect(enElMovil).toEqual(enElDesktop);
  });

  it('un tercero en medio produce palabras DISTINTAS', () => {
    // esto es lo que el usuario detecta al comparar las dos pantallas
    const atacante = generateIdentity();
    const legitimas = confirmationWords(desktop.publicKey, movil.publicKey);
    const conAtacante = confirmationWords(desktop.publicKey, atacante.publicKey);
    expect(conAtacante).not.toEqual(legitimas);
  });

  it('devuelve cuatro palabras de la lista', () => {
    const palabras = confirmationWords(desktop.publicKey, movil.publicKey);
    expect(palabras).toHaveLength(4);
    for (const palabra of palabras) expect(CONFIRMATION_WORDS).toContain(palabra);
  });

  it('la lista tiene 256 palabras y ninguna repetida', () => {
    expect(CONFIRMATION_WORDS).toHaveLength(256);
    expect(new Set(CONFIRMATION_WORDS).size).toBe(256);
  });
});

describe('codificacion', () => {
  it('base64url va y vuelve', () => {
    const { publicKey } = generateIdentity();
    expect(fromBase64Url(toBase64Url(publicKey))).toEqual(publicKey);
  });

  it('base64url no lleva caracteres que rompan una URL o un JSON', () => {
    for (let i = 0; i < 20; i += 1) {
      const texto = toBase64Url(generateIdentity().publicKey);
      expect(texto).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('la comparacion en tiempo constante distingue bien', () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(timingSafeEqualBytes(a, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqualBytes(a, new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqualBytes(a, new Uint8Array([1, 2]))).toBe(false);
  });

  it('los retos son distintos cada vez', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 50; i += 1) vistos.add(toBase64Url(generateChallenge()));
    expect(vistos.size).toBe(50);
  });
});

describe('QR', () => {
  const desktop = generateIdentity();
  const base = {
    gatewayUrl: 'https://luxy-gateway.ejemplo.workers.dev',
    code: '12345678',
    desktopPublicKey: desktop.publicKey,
    desktopName: 'PC casa',
    now: AHORA,
  };

  it('va y vuelve con la misma clave', () => {
    const resultado = parseQrPayload(buildQrPayload(base), AHORA);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.desktopPublicKey).toEqual(desktop.publicKey);
      expect(resultado.code).toBe('12345678');
      expect(resultado.desktopName).toBe('PC casa');
      expect(resultado.desktopFingerprint).toBe(fingerprint(desktop.publicKey));
    }
  });

  it('el QR NO contiene ningun secreto permanente', () => {
    // si alguien fotografia la pantalla, lo peor que consigue es intentar un
    // emparejamiento dentro de la ventana, y aun asi tiene que pasar las palabras
    const texto = buildQrPayload(base);
    expect(texto).not.toContain(toBase64Url(desktop.privateKey));
  });

  it('CADUCA', () => {
    const texto = buildQrPayload(base);
    const tarde = parseQrPayload(texto, AHORA + PAIRING_CODE_TTL_MS + 1);
    expect(tarde.ok).toBe(false);
    if (!tarde.ok) expect(tarde.code).toBe('expired');
  });

  it('justo antes de caducar todavia vale', () => {
    const texto = buildQrPayload(base);
    expect(parseQrPayload(texto, AHORA + PAIRING_CODE_TTL_MS - 1).ok).toBe(true);
  });

  it('un QR de otra app se rechaza con un mensaje util', () => {
    const resultado = parseQrPayload('https://ejemplo.com/algo', AHORA);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.code).toBe('not_luxy');
      expect(resultado.detail).toContain('no es de Luxy');
    }
  });

  it('un QR de Luxy incompleto se distingue de uno ajeno', () => {
    const resultado = parseQrPayload(JSON.stringify({ t: 'luxy', v: 1 }), AHORA);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('malformed');
  });

  it('una version futura dice que actualices el movil', () => {
    const texto = buildQrPayload(base).replace('"v":1', '"v":2');
    const resultado = parseQrPayload(texto, AHORA);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.code).toBe('unsupported_version');
      expect(resultado.detail).toContain('actualiza el movil');
    }
  });

  it('una clave del tamano correcto pero invalida se rechaza', () => {
    // el ataque realista: sustituir la clave por otra del MISMO tamano, para
    // pasar la validacion de forma. Aqui bytes que no son un punto de la curva.
    // 0x04 al principio (forma correcta) pero coordenadas que NO estan en la curva
    const bytes = new Uint8Array(65).fill(0x07);
    bytes[0] = 0x04;
    const falsa = toBase64Url(bytes);
    const roto = buildQrPayload(base).replace(/"k":"[^"]+"/, `"k":"${falsa}"`);
    const resultado = parseQrPayload(roto, AHORA);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('bad_key');
  });

  it('una clave demasiado corta ni siquiera pasa la forma', () => {
    const roto = buildQrPayload(base).replace(/"k":"[^"]+"/, '"k":"AAAA"');
    const resultado = parseQrPayload(roto, AHORA);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('malformed');
  });

  it('el codigo tiene ocho digitos y sale de un generador criptografico', () => {
    const codigo = generatePairingCode((n) => new Uint8Array(n).fill(0xab));
    expect(codigo).toMatch(/^\d{8}$/);
  });
});

describe('un solo uso del codigo', () => {
  const registro = (): PairingRecord => ({
    code: '12345678',
    state: 'waiting',
    expiresAt: AHORA + PAIRING_CODE_TTL_MS,
    claimantPublicKey: null,
  });

  it('la primera reclamacion vale', () => {
    const resultado = claimPairingCode(registro(), 'clave-movil', AHORA);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.record.state).toBe('claimed');
  });

  it('LA SEGUNDA NO', () => {
    // el ataque: alguien fotografio el QR y lo reclama despues del movil legitimo
    const primera = claimPairingCode(registro(), 'movil-legitimo', AHORA);
    expect(primera.ok).toBe(true);
    if (!primera.ok) return;

    const segunda = claimPairingCode(primera.record, 'movil-atacante', AHORA);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.code).toBe('already_used');
  });

  it('un codigo caducado no se puede reclamar', () => {
    const resultado = claimPairingCode(registro(), 'x', AHORA + PAIRING_CODE_TTL_MS + 1);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('expired');
  });

  it('un codigo inventado no existe', () => {
    const resultado = claimPairingCode(null, 'x', AHORA);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('not_found');
  });

  it('un codigo ya confirmado no se re-reclama', () => {
    const confirmado: PairingRecord = { ...registro(), state: 'confirmed' };
    expect(claimPairingCode(confirmado, 'x', AHORA).ok).toBe(false);
  });
});
