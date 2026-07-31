// pruebas del cliente de gateway del escritorio.
//
// Lo que importa aqui: que la clave privada no salga nunca, que las palabras se
// calculen EN LOCAL (no las dicte el gateway), y que las peticiones firmadas
// lleven nonce distinto cada vez.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateIdentity,
  toBase64Url,
  confirmationWords,
  parseQrPayload,
} from '@luxy/remote-crypto';
import {
  RemoteIdentityStore,
  remoteIdentityPath,
  type EncryptionBackend,
} from './remote-identity.js';
import { RemoteClient, RemoteClientError, describeIdentity } from './remote-client.js';

function backendFalso(): EncryptionBackend {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(plain).reverse(),
    decryptString: (enc) => Buffer.from(enc).reverse().toString(),
  };
}

const GATEWAY = 'https://luxy-gateway.ejemplo.workers.dev';
let raiz: string;
let store: RemoteIdentityStore;
let llamadas: { url: string; init: RequestInit }[];

/** fetch falso que devuelve lo que se le diga y registra lo recibido */
function fetchFalso(respuestas: Record<string, unknown>, status = 200): typeof fetch {
  return (async (url: string | URL, init: RequestInit = {}) => {
    const texto = String(url);
    llamadas.push({ url: texto, init });
    const clave = Object.keys(respuestas).find((k) => texto.includes(k));
    const cuerpo = clave === undefined ? {} : respuestas[clave];
    return new Response(JSON.stringify(cuerpo), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'luxy-client-'));
  store = new RemoteIdentityStore(remoteIdentityPath(raiz), backendFalso());
  store.load();
  llamadas = [];
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function cliente(fetchImpl: typeof fetch): RemoteClient {
  return new RemoteClient({
    gatewayUrl: GATEWAY,
    identity: store,
    machineName: 'PC casa',
    fetchImpl,
  });
}

describe('invitacion de emparejamiento', () => {
  it('devuelve un QR que el movil puede leer', async () => {
    const c = cliente(
      fetchFalso({
        'pair/start': { code: '12345678', expiresAt: Date.now() + 180_000, hostDeviceId: 'host-1' },
      }),
    );

    const invitacion = await c.startPairing();
    const leido = parseQrPayload(invitacion.qrPayload);

    expect(leido.ok).toBe(true);
    if (leido.ok) {
      expect(leido.code).toBe('12345678');
      expect(leido.desktopName).toBe('PC casa');
      expect(toBase64Url(leido.desktopPublicKey)).toBe(store.publicKeyBase64());
    }
  });

  it('el QR NO contiene la clave privada', async () => {
    const c = cliente(
      fetchFalso({
        'pair/start': { code: '12345678', expiresAt: Date.now() + 180_000, hostDeviceId: 'host-1' },
      }),
    );

    const invitacion = await c.startPairing();
    expect(invitacion.qrPayload).not.toContain(toBase64Url(store.privateKey()));
  });

  it('la peticion de inicio NO va firmada: aun no hay emparejamiento', async () => {
    const c = cliente(
      fetchFalso({
        'pair/start': { code: '12345678', expiresAt: Date.now() + 180_000, hostDeviceId: 'host-1' },
      }),
    );
    await c.startPairing();

    const cabeceras = llamadas[0]?.init.headers as Record<string, string>;
    expect(cabeceras['x-luxy-signature']).toBeUndefined();
  });
});

describe('palabras de confirmacion', () => {
  it('SE CALCULAN EN LOCAL, no las dicta el gateway', async () => {
    // si el gateway las dictara, podria mandar las mismas a los dos lados tras
    // haber sustituido una clave, y la confirmacion del usuario no valdria nada
    const movil = generateIdentity();
    const c = cliente(
      fetchFalso({
        'pair/start': { code: '12345678', expiresAt: Date.now() + 180_000, hostDeviceId: 'host-1' },
        '/state': {
          state: 'claimed',
          claimantPublicKey: toBase64Url(movil.publicKey),
          claimantName: 'Daniel-phone',
          deviceId: null,
          // el gateway MIENTE con unas palabras cualquiera
          words: ['falsa', 'falsa', 'falsa', 'falsa'],
        },
      }),
    );

    await c.startPairing();
    const progreso = await c.pairingProgress('12345678');

    const esperadas = confirmationWords(store.publicKey(), movil.publicKey);
    expect(progreso.words).toEqual(esperadas);
    expect(progreso.words).not.toContain('falsa');
  });

  it('sin reclamante todavia no hay palabras', async () => {
    const c = cliente(
      fetchFalso({
        'pair/start': { code: '12345678', expiresAt: Date.now() + 180_000, hostDeviceId: 'host-1' },
        '/state': { state: 'waiting', claimantPublicKey: null, claimantName: null, deviceId: null },
      }),
    );
    await c.startPairing();

    const progreso = await c.pairingProgress('12345678');
    expect(progreso.words).toBeNull();
  });

  it('una clave de reclamante corrupta se rechaza en vez de mostrar palabras falsas', async () => {
    const c = cliente(
      fetchFalso({
        'pair/start': { code: '12345678', expiresAt: Date.now() + 180_000, hostDeviceId: 'host-1' },
        '/state': {
          state: 'claimed',
          claimantPublicKey: '!!!no-es-base64!!!',
          claimantName: 'x',
          deviceId: null,
        },
      }),
    );
    await c.startPairing();

    await expect(c.pairingProgress('12345678')).rejects.toThrow(RemoteClientError);
  });
});

describe('peticiones firmadas', () => {
  it('llevan las cuatro cabeceras de firma', async () => {
    const c = cliente(
      fetchFalso({
        'pair/start': { code: '1', expiresAt: Date.now() + 180_000, hostDeviceId: 'host-1' },
        devices: { devices: [] },
      }),
    );
    await c.startPairing();
    await c.listDevices();

    const cabeceras = llamadas[1]?.init.headers as Record<string, string>;
    expect(cabeceras['x-luxy-device']).toBe('host-1');
    expect(cabeceras['x-luxy-signature']).toBeTruthy();
    expect(cabeceras['x-luxy-nonce']).toBeTruthy();
    expect(cabeceras['x-luxy-timestamp']).toBeTruthy();
  });

  it('CADA peticion lleva un nonce distinto', async () => {
    // reutilizarlo haria que la segunda se rechazara como replay
    const c = cliente(
      fetchFalso({
        'pair/start': { code: '1', expiresAt: Date.now() + 180_000, hostDeviceId: 'host-1' },
        devices: { devices: [] },
      }),
    );
    await c.startPairing();
    await c.listDevices();
    await c.listDevices();

    const primera = (llamadas[1]?.init.headers as Record<string, string>)['x-luxy-nonce'];
    const segunda = (llamadas[2]?.init.headers as Record<string, string>)['x-luxy-nonce'];
    expect(primera).not.toBe(segunda);
  });

  it('sin registro previo NO se firma nada: falla claro', async () => {
    const c = cliente(fetchFalso({}));
    await expect(c.listDevices()).rejects.toThrow(/no esta registrado/);
    expect(llamadas).toHaveLength(0);
  });

  it('la clave privada NUNCA viaja en una peticion', async () => {
    const c = cliente(
      fetchFalso({
        'pair/start': { code: '1', expiresAt: Date.now() + 180_000, hostDeviceId: 'host-1' },
        devices: { devices: [] },
        access: { device: {} },
      }),
    );
    await c.startPairing();
    await c.listDevices();
    await c.setAccess('movil-1', { permissions: ['view', 'control'], unattended: true });

    const privada = toBase64Url(store.privateKey());
    for (const llamada of llamadas) {
      expect(JSON.stringify(llamada)).not.toContain(privada);
    }
  });
});

describe('errores del gateway', () => {
  it('un error con codigo se propaga con su codigo', async () => {
    const c = cliente(
      fetchFalso(
        { 'pair/start': { error: { code: 'revoked', detail: 'este ordenador fue revocado' } } },
        403,
      ),
    );

    await expect(c.startPairing()).rejects.toMatchObject({ code: 'revoked', status: 403 });
  });

  it('una respuesta que no es JSON no se traga en silencio', async () => {
    const roto = (async () =>
      new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    const c = cliente(roto);

    await expect(c.startPairing()).rejects.toThrow(/no es JSON/);
  });
});

describe('diagnostico', () => {
  it('describeIdentity NO expone la clave privada', () => {
    const info = describeIdentity(store);
    expect(info.publicKey).toBe(store.publicKeyBase64());
    expect(info.fingerprint).toHaveLength(64);
    expect(JSON.stringify(info)).not.toContain(toBase64Url(store.privateKey()));
  });
});
