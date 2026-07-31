// pruebas del almacen de identidad remota.
//
// Lo que se protege: que el emparejamiento SOBREVIVA a reinicios (es el
// requisito central: escanear el QR una sola vez), que la clave privada nunca
// se escriba en claro, y que revocar sea efectivo e irreversible.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateIdentity, toBase64Url, fingerprint } from '@luxy/remote-crypto';
import {
  RemoteIdentityStore,
  remoteIdentityPath,
  type EncryptionBackend,
  type PairedDevice,
} from './remote-identity.js';

/**
 * cifrado falso pero REVERSIBLE y distinguible del texto plano.
 *
 * Invierte los bytes y antepone una marca. Asi una prueba puede comprobar que lo
 * escrito en disco NO es la clave en claro, cosa que un mock identidad no
 * permitiria detectar.
 */
function backendFalso(disponible = true): EncryptionBackend {
  return {
    isEncryptionAvailable: () => disponible,
    encryptString: (plain) => Buffer.concat([Buffer.from('DPAPI:'), Buffer.from(plain).reverse()]),
    decryptString: (encrypted) =>
      Buffer.from(encrypted.subarray('DPAPI:'.length)).reverse().toString(),
  };
}

let raiz: string;
let ruta: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'luxy-identidad-'));
  ruta = remoteIdentityPath(raiz);
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function dispositivo(overrides: Partial<PairedDevice> = {}): PairedDevice {
  const { publicKey } = generateIdentity();
  return {
    id: randomUUID(),
    name: 'Daniel-phone',
    kind: 'android',
    publicKey: toBase64Url(publicKey),
    fingerprint: fingerprint(publicKey),
    pairedAt: new Date().toISOString(),
    lastSeenAt: null,
    permissions: ['view', 'control'],
    unattended: false,
    requireBiometrics: false,
    revokedAt: null,
    ...overrides,
  };
}

describe('creacion', () => {
  it('crea una identidad la primera vez', () => {
    const store = new RemoteIdentityStore(ruta, backendFalso());
    store.load();

    expect(store.publicKey()).toHaveLength(65);
    expect(store.fingerprint()).toHaveLength(64);
  });

  it('SIN cifrado del sistema NO guarda nada en claro: falla', () => {
    // una clave privada de control remoto en texto plano en el disco es peor que
    // no tener control remoto
    const store = new RemoteIdentityStore(ruta, backendFalso(false));
    expect(() => store.load()).toThrow(/no la guardara en claro/);
  });

  it('la clave privada NO aparece en claro en el archivo', () => {
    const store = new RemoteIdentityStore(ruta, backendFalso());
    store.load();

    const contenido = readFileSync(ruta, 'utf8');
    expect(contenido).not.toContain(toBase64Url(store.privateKey()));
    expect(contenido).toContain('encryptedPrivateKey');
  });
});

describe('persistencia entre reinicios', () => {
  it('LA IDENTIDAD ES LA MISMA tras reiniciar', () => {
    // es el requisito central: escanear el QR una sola vez
    const primero = new RemoteIdentityStore(ruta, backendFalso());
    primero.load();
    const huella = primero.fingerprint();

    const segundo = new RemoteIdentityStore(ruta, backendFalso());
    segundo.load();

    expect(segundo.fingerprint()).toBe(huella);
    expect(segundo.privateKey()).toEqual(primero.privateKey());
  });

  it('LOS DISPOSITIVOS SOBREVIVEN al reinicio', () => {
    const primero = new RemoteIdentityStore(ruta, backendFalso());
    primero.load();
    const movil = dispositivo();
    primero.addDevice(movil);
    primero.setUnattended(movil.id, true);

    const segundo = new RemoteIdentityStore(ruta, backendFalso());
    segundo.load();

    const guardado = segundo.findDevice(movil.id);
    expect(guardado).not.toBeNull();
    expect(guardado?.name).toBe('Daniel-phone');
    expect(guardado?.unattended).toBe(true);
    expect(guardado?.publicKey).toBe(movil.publicKey);
  });

  it('un archivo manipulado se rechaza en vez de usarse', () => {
    const store = new RemoteIdentityStore(ruta, backendFalso());
    store.load();

    // se cambia la clave publica por la de otro: seguir adelante significaria
    // anunciar una identidad que no se puede firmar
    const datos = JSON.parse(readFileSync(ruta, 'utf8'));
    datos.publicKey = toBase64Url(generateIdentity().publicKey);
    writeFileSync(ruta, JSON.stringify(datos), 'utf8');

    const otro = new RemoteIdentityStore(ruta, backendFalso());
    expect(() => otro.load()).toThrow(/manipulado/);
  });

  it('un archivo corrupto se rechaza', () => {
    writeFileSync(ruta, '{"version":99}', 'utf8');
    const store = new RemoteIdentityStore(ruta, backendFalso());
    expect(() => store.load()).toThrow(/corrupto/);
  });
});

describe('dispositivos', () => {
  let store: RemoteIdentityStore;

  beforeEach(() => {
    store = new RemoteIdentityStore(ruta, backendFalso());
    store.load();
  });

  it('rechaza una clave publica que no esta en la curva', () => {
    const bytes = new Uint8Array(65).fill(0x07);
    bytes[0] = 0x04;
    expect(() => store.addDevice(dispositivo({ publicKey: toBase64Url(bytes) }))).toThrow(
      /no es valida/,
    );
  });

  it('no empareja dos veces la misma clave', () => {
    const movil = dispositivo();
    store.addDevice(movil);
    expect(() => store.addDevice(dispositivo({ publicKey: movil.publicKey }))).toThrow(/ya esta/);
  });

  it('el acceso desatendido esta DESACTIVADO por defecto', () => {
    const movil = dispositivo();
    store.addDevice(movil);
    expect(store.findDevice(movil.id)?.unattended).toBe(false);
  });
});

describe('revocacion', () => {
  let store: RemoteIdentityStore;

  beforeEach(() => {
    store = new RemoteIdentityStore(ruta, backendFalso());
    store.load();
  });

  it('un dispositivo revocado deja de estar activo', () => {
    const movil = dispositivo();
    store.addDevice(movil);
    expect(store.activeDevices()).toHaveLength(1);

    expect(store.revokeDevice(movil.id)).toBe(true);
    expect(store.activeDevices()).toHaveLength(0);
  });

  it('revocar QUITA el desatendido y los permisos', () => {
    const movil = dispositivo();
    store.addDevice(movil);
    store.setUnattended(movil.id, true);

    store.revokeDevice(movil.id);

    const revocado = store.findDevice(movil.id);
    expect(revocado?.unattended).toBe(false);
    expect(revocado?.permissions).toEqual([]);
  });

  it('un dispositivo revocado NO puede recuperar permisos ni desatendido', () => {
    // hay que volver a emparejarlo: es la unica forma de que el usuario tenga
    // que estar delante del ordenador otra vez
    const movil = dispositivo();
    store.addDevice(movil);
    store.revokeDevice(movil.id);

    expect(store.setUnattended(movil.id, true)).toBe(false);
    expect(store.setPermissions(movil.id, ['view'])).toBe(false);
    expect(store.findDevice(movil.id)?.unattended).toBe(false);
  });

  it('la revocacion SOBREVIVE al reinicio', () => {
    const movil = dispositivo();
    store.addDevice(movil);
    store.revokeDevice(movil.id);

    const otro = new RemoteIdentityStore(ruta, backendFalso());
    otro.load();
    expect(otro.activeDevices()).toHaveLength(0);
    expect(otro.findDevice(movil.id)?.revokedAt).not.toBeNull();
  });

  it('NO borra la fila: queda el rastro de quien tuvo acceso', () => {
    const movil = dispositivo();
    store.addDevice(movil);
    store.revokeDevice(movil.id);

    expect(store.listDevices()).toHaveLength(1);
    expect(store.findDevice(movil.id)?.revokedAt).toBeTruthy();
  });

  it('revocar dos veces no hace nada la segunda', () => {
    const movil = dispositivo();
    store.addDevice(movil);
    expect(store.revokeDevice(movil.id)).toBe(true);
    expect(store.revokeDevice(movil.id)).toBe(false);
  });
});
