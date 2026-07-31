// pruebas del coordinador de emparejamiento y del contraste con lo local.
//
// LO QUE SE PROTEGE: que el gateway deje de ser la unica fuente de verdad. Todo
// el diseno declara que el gateway no es de fiar, y sin anclar la clave del par
// en disco esa afirmacion era falsa despues del emparejamiento.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
import {
  PairingCoordinator,
  PairingError,
  compareWithLocal,
  describeDiscrepancy,
  type GatewayDeviceView,
} from './remote-pairing.js';
import type { RemoteClient } from './remote-client.js';

function backendFalso(): EncryptionBackend {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (p) => Buffer.from(p).reverse(),
    decryptString: (e) => Buffer.from(e).reverse().toString(),
  };
}

let raiz: string;
let store: RemoteIdentityStore;
const movil = generateIdentity();
const MOVIL_KEY = toBase64Url(movil.publicKey);
const DEVICE_ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'luxy-pairing-'));
  store = new RemoteIdentityStore(remoteIdentityPath(raiz), backendFalso());
  store.load();
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

/** cliente falso con el flujo completo */
function clienteFalso(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    startPairing: vi.fn(async () => ({
      code: '12345678',
      qrPayload: '{}',
      expiresAt: Date.now() + 180_000,
      hostDeviceId: 'host-1',
    })),
    pairingProgress: vi.fn(async () => ({
      state: 'claimed' as const,
      words: ['gato', 'luna', 'roble', 'sal'],
      claimantName: 'Daniel-phone',
      claimantPublicKey: MOVIL_KEY,
      deviceId: null,
    })),
    confirmPairing: vi.fn(async () => ({ paired: true, deviceId: DEVICE_ID })),
    ...overrides,
  } as unknown as RemoteClient;
}

describe('coordinador', () => {
  it('ANCLA la clave del movil en disco al confirmar', async () => {
    // sin esto, la unica fuente sobre "con quien estoy emparejado" era el
    // gateway, al que el diseno declara no confiable
    const coord = new PairingCoordinator(clienteFalso(), store);
    await coord.invite();
    await coord.poll();

    const resultado = await coord.confirm(true);

    expect(resultado.paired).toBe(true);
    const guardado = store.findDevice(DEVICE_ID);
    expect(guardado?.publicKey).toBe(MOVIL_KEY);
    expect(guardado?.fingerprint).toBe(fingerprint(movil.publicKey));
  });

  it('el anclaje SOBREVIVE al reinicio', async () => {
    const coord = new PairingCoordinator(clienteFalso(), store);
    await coord.invite();
    await coord.poll();
    await coord.confirm(true);

    const otro = new RemoteIdentityStore(remoteIdentityPath(raiz), backendFalso());
    otro.load();
    expect(otro.findDevice(DEVICE_ID)?.publicKey).toBe(MOVIL_KEY);
  });

  it('emparejar NO concede permisos ni desatendido', async () => {
    const coord = new PairingCoordinator(clienteFalso(), store);
    await coord.invite();
    await coord.poll();
    await coord.confirm(true);

    const guardado = store.findDevice(DEVICE_ID);
    expect(guardado?.permissions).toEqual([]);
    expect(guardado?.unattended).toBe(false);
  });

  it('rechazar NO ancla nada', async () => {
    const coord = new PairingCoordinator(
      clienteFalso({ confirmPairing: vi.fn(async () => ({ paired: false, deviceId: null })) }),
      store,
    );
    await coord.invite();
    await coord.poll();

    const resultado = await coord.confirm(false);
    expect(resultado.paired).toBe(false);
    expect(store.listDevices()).toHaveLength(0);
  });

  it('si el gateway falla al confirmar, NO queda nada anclado', async () => {
    // al reves quedaria un dispositivo local que el gateway no reconoce, y el
    // usuario lo veria en su lista sin poder conectarse nunca
    const coord = new PairingCoordinator(
      clienteFalso({
        confirmPairing: vi.fn(async () => {
          throw new Error('el gateway respondio 500');
        }),
      }),
      store,
    );
    await coord.invite();
    await coord.poll();

    await expect(coord.confirm(true)).rejects.toThrow();
    expect(store.listDevices()).toHaveLength(0);
  });

  it('no se puede confirmar sin que nadie haya reclamado', async () => {
    const coord = new PairingCoordinator(
      clienteFalso({
        pairingProgress: vi.fn(async () => ({
          state: 'waiting' as const,
          words: null,
          claimantName: null,
          claimantPublicKey: null,
          deviceId: null,
        })),
      }),
      store,
    );
    await coord.invite();
    await coord.poll();

    await expect(coord.confirm(true)).rejects.toThrow(PairingError);
  });

  it('no se puede confirmar sin invitacion abierta', async () => {
    const coord = new PairingCoordinator(clienteFalso(), store);
    await expect(coord.confirm(true)).rejects.toThrow(/no hay ningun emparejamiento/);
  });

  it('una clave de movil no canonica se rechaza en vez de anclarse', async () => {
    const coord = new PairingCoordinator(
      clienteFalso({
        pairingProgress: vi.fn(async () => ({
          state: 'claimed' as const,
          words: ['a', 'b', 'c', 'd'],
          claimantName: 'raro',
          claimantPublicKey: 'no-es-una-clave',
          deviceId: null,
        })),
      }),
      store,
    );
    await coord.invite();
    await coord.poll();

    await expect(coord.confirm(true)).rejects.toThrow(PairingError);
    expect(store.listDevices()).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------

describe('contraste con lo anclado en local', () => {
  function local(overrides: Partial<PairedDevice> = {}): PairedDevice {
    return {
      id: DEVICE_ID,
      name: 'Daniel-phone',
      kind: 'android',
      publicKey: MOVIL_KEY,
      fingerprint: fingerprint(movil.publicKey),
      pairedAt: new Date().toISOString(),
      lastSeenAt: null,
      permissions: ['view'],
      unattended: false,
      requireBiometrics: false,
      revokedAt: null,
      ...overrides,
    };
  }

  function remoto(overrides: Partial<GatewayDeviceView> = {}): GatewayDeviceView {
    return { id: DEVICE_ID, name: 'Daniel-phone', publicKey: MOVIL_KEY, revoked: false, ...overrides };
  }

  it('sin discrepancias no dice nada', () => {
    expect(compareWithLocal([remoto()], [local()])).toEqual([]);
  });

  it('DETECTA un dispositivo que el gateway se inventa', () => {
    // un gateway comprometido anuncia un movil que este ordenador nunca confirmo
    const discrepancias = compareWithLocal([remoto({ id: randomUUID(), name: 'no soy yo' })], []);
    expect(discrepancias).toHaveLength(1);
    expect(discrepancias[0]?.kind).toBe('unknown_device');
  });

  it('DETECTA que el gateway cambio la clave de un dispositivo real', () => {
    // el ataque directo contra el modelo: sustituir la identidad del movil por
    // una que controle el atacante, conservando el nombre y el id
    const impostor = generateIdentity();
    const discrepancias = compareWithLocal(
      [remoto({ publicKey: toBase64Url(impostor.publicKey) })],
      [local()],
    );

    expect(discrepancias).toHaveLength(1);
    expect(discrepancias[0]?.kind).toBe('key_mismatch');
    expect(describeDiscrepancy(discrepancias[0]!)).toContain('No te conectes');
  });

  it('DETECTA que el gateway resucita un dispositivo revocado aqui', () => {
    const discrepancias = compareWithLocal(
      [remoto({ revoked: false })],
      [local({ revokedAt: new Date().toISOString() })],
    );
    expect(discrepancias[0]?.kind).toBe('revoked_locally');
  });

  it('DETECTA que el gateway hizo desaparecer un dispositivo', () => {
    const discrepancias = compareWithLocal([], [local()]);
    expect(discrepancias[0]?.kind).toBe('missing_locally');
  });

  it('un revocado que el gateway tampoco menciona no es discrepancia', () => {
    const discrepancias = compareWithLocal([], [local({ revokedAt: new Date().toISOString() })]);
    expect(discrepancias).toEqual([]);
  });

  it('cada discrepancia dice QUE HACER, no solo que pasa', () => {
    const casos = [
      compareWithLocal([remoto({ id: randomUUID() })], []),
      compareWithLocal([remoto({ publicKey: toBase64Url(generateIdentity().publicKey) })], [local()]),
      compareWithLocal([remoto()], [local({ revokedAt: new Date().toISOString() })]),
      compareWithLocal([], [local()]),
    ].flat();

    for (const caso of casos) {
      const texto = describeDiscrepancy(caso);
      expect(texto.length).toBeGreaterThan(40);
      expect(/revoca|vuelve a emparejar|no te conectes/i.test(texto)).toBe(true);
    }
  });
});
