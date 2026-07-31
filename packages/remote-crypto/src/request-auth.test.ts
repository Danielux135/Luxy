// pruebas de la autenticacion por firma.
//
// Escenarios del threat model: token robado, replay, dispositivo revocado,
// dispositivo desconocido, firma manipulada.
import { describe, it, expect } from 'vitest';
import { generateIdentity, toBase64Url } from './identity.js';
import {
  signRequest,
  verifySignedRequest,
  hashBody,
  AUTH_WINDOW_MS,
  type VerifyRequestOptions,
} from './request-auth.js';

const AHORA = 1_800_000_000_000;
const movil = generateIdentity();
const otro = generateIdentity();
const DEVICE = '33333333-3333-4333-8333-333333333333';

const CUERPO_VACIO = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function firmar(overrides: Partial<Parameters<typeof signRequest>[0]> = {}) {
  return signRequest({
    privateKey: movil.privateKey,
    deviceId: DEVICE,
    method: 'POST',
    path: '/api/remote/session/start',
    bodyHash: CUERPO_VACIO,
    nonce: 'nonce-de-prueba-0001',
    now: AHORA,
    ...overrides,
  });
}

function verificar(overrides: Partial<VerifyRequestOptions> = {}) {
  return verifySignedRequest({
    headers: firmar(),
    method: 'POST',
    path: '/api/remote/session/start',
    bodyHash: CUERPO_VACIO,
    publicKey: movil.publicKey,
    revoked: false,
    nonceSeen: false,
    now: AHORA,
    ...overrides,
  });
}

describe('camino feliz', () => {
  it('una peticion firmada por el dispositivo emparejado se acepta', () => {
    const resultado = verificar();
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.deviceId).toBe(DEVICE);
  });
});

describe('token robado: por que no basta con copiar un archivo', () => {
  it('la firma de OTRA clave no vale, aunque el deviceId sea correcto', () => {
    const headers = signRequest({
      privateKey: otro.privateKey,
      deviceId: DEVICE,
      method: 'POST',
      path: '/api/remote/session/start',
      bodyHash: CUERPO_VACIO,
      nonce: 'nonce-alternativo-01',
      now: AHORA,
    });
    const resultado = verificar({ headers });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('bad_signature');
  });
});

describe('replay', () => {
  it('un nonce ya visto se rechaza', () => {
    const resultado = verificar({ nonceSeen: true });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('replayed');
  });

  it('una peticion vieja se rechaza aunque el nonce sea nuevo', () => {
    const resultado = verificar({ now: AHORA + AUTH_WINDOW_MS + 1 });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('stale');
  });

  it('una peticion del futuro tambien', () => {
    const resultado = verificar({ now: AHORA - AUTH_WINDOW_MS - 1 });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('stale');
  });
});

describe('la firma ata el metodo, la ruta y el cuerpo', () => {
  it('la firma de un GET no vale para un POST', () => {
    // sin esto, capturar la firma de una consulta inocua permitiria disparar
    // una accion destructiva en otra ruta
    const headers = firmar({ method: 'GET' });
    const resultado = verificar({ headers });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('bad_signature');
  });

  it('la firma de una ruta no vale para otra', () => {
    const headers = firmar({ path: '/api/remote/devices' });
    const resultado = verificar({ headers });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('bad_signature');
  });

  it('cambiar el cuerpo invalida la firma', () => {
    const resultado = verificar({ bodyHash: 'otro-hash-distinto' });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('bad_signature');
  });
});

describe('estado del dispositivo', () => {
  it('un dispositivo REVOCADO no puede autenticarse', () => {
    const resultado = verificar({ revoked: true });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('revoked');
  });

  it('un dispositivo desconocido tampoco', () => {
    const resultado = verificar({ publicKey: null });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('unknown_device');
  });

  it('se comprueba la revocacion ANTES de gastar una verificacion de firma', () => {
    // un dispositivo revocado que bombardee no debe costar criptografia
    const headers = signRequest({
      privateKey: otro.privateKey,
      deviceId: DEVICE,
      method: 'POST',
      path: '/api/remote/session/start',
      bodyHash: CUERPO_VACIO,
      nonce: 'nonce-alternativo-02',
      now: AHORA,
    });
    const resultado = verificar({ headers, revoked: true });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('revoked');
  });
});

describe('cabeceras mal formadas', () => {
  it('sin cabeceras se rechaza', () => {
    const resultado = verificar({ headers: {} });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('malformed');
  });

  it('un deviceId que no es UUID se rechaza', () => {
    const resultado = verificar({ headers: { ...firmar(), deviceId: 'no-soy-uuid' } });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('malformed');
  });

  it('un nonce demasiado corto se rechaza', () => {
    const resultado = verificar({ headers: { ...firmar(), nonce: 'ab' } });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('malformed');
  });

  it('una firma que no es base64url se rechaza', () => {
    const resultado = verificar({ headers: { ...firmar(), signature: '!!!!' } });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('malformed');
  });
});

describe('hash del cuerpo', () => {
  it('un cuerpo vacio tiene su propio hash', async () => {
    // asi una peticion sin cuerpo no puede volverse una con cuerpo
    const vacio = await hashBody('');
    const conDatos = await hashBody('{"a":1}');
    expect(vacio).not.toBe(conDatos);
  });

  it('el mismo cuerpo da siempre el mismo hash', async () => {
    expect(await hashBody('{"a":1}')).toBe(await hashBody('{"a":1}'));
  });

  it('el hash sale en base64url', async () => {
    expect(await hashBody('x')).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('no se filtra material sensible', () => {
  it('ningun mensaje de rechazo contiene la clave ni la firma', () => {
    const headers = firmar();
    const casos = [
      verificar({ revoked: true }),
      verificar({ publicKey: null }),
      verificar({ nonceSeen: true }),
      verificar({ bodyHash: 'x' }),
    ];
    for (const caso of casos) {
      expect(caso.ok).toBe(false);
      if (!caso.ok) {
        expect(caso.detail).not.toContain(headers.signature);
        expect(caso.detail).not.toContain(toBase64Url(movil.privateKey));
      }
    }
  });
});
