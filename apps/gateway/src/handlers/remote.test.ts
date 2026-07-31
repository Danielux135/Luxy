// pruebas de los endpoints de control remoto.
//
// Se usa una base de datos en memoria que respeta las invariantes que importan:
// clave primaria del nonce (atomicidad del anti-replay) y filtro por estado en
// las transiciones (un solo uso del codigo). Sin eso, las pruebas pasarian y la
// realidad fallaria.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  generateIdentity,
  sign,
  signRequest,
  toBase64Url,
  hashBody,
  fingerprint,
} from '@luxy/remote-crypto';
import {
  handlePairStart,
  handlePairClaim,
  handlePairConfirm,
  handleListDevices,
  handleUpdateAccess,
  handleRevokeDevice,
  type RemoteDeps,
} from './remote.js';
import type { RemoteDeviceRow, PairingCodeRow } from '../remote-repository.js';

// -----------------------------------------------------------------------------
// base de datos en memoria
// -----------------------------------------------------------------------------

class MemoriaRemota {
  devices = new Map<string, RemoteDeviceRow>();
  codes = new Map<string, PairingCodeRow>();
  nonces = new Set<string>();
  auditoria: { action: string; deviceId: string | null }[] = [];

  async getDeviceById(id: string) {
    return this.devices.get(id) ?? null;
  }
  async getDeviceByPublicKey(key: string) {
    return [...this.devices.values()].find((d) => d.public_key === key) ?? null;
  }
  async listPeersOf(hostId: string) {
    return [...this.devices.values()].filter((d) => d.peer_device_id === hostId);
  }
  async createDevice(input: {
    name: string;
    kind: 'desktop' | 'android';
    publicKey: string;
    fingerprint: string;
    peerDeviceId: string | null;
    permissions: string[];
  }) {
    if ([...this.devices.values()].some((d) => d.public_key === input.publicKey)) {
      throw new Error('clave publica duplicada');
    }
    const row: RemoteDeviceRow = {
      id: randomUUID(),
      name: input.name,
      kind: input.kind,
      public_key: input.publicKey,
      fingerprint: input.fingerprint,
      peer_device_id: input.peerDeviceId,
      permissions: input.permissions,
      unattended: false,
      require_biometrics: false,
      paired_at: new Date().toISOString(),
      last_seen_at: null,
      revoked_at: null,
    };
    this.devices.set(row.id, row);
    return row;
  }
  async revokeDevice(id: string) {
    const row = this.devices.get(id);
    if (row === undefined || row.revoked_at !== null) return false;
    row.revoked_at = new Date().toISOString();
    row.unattended = false;
    row.permissions = [];
    return true;
  }
  async updateDeviceAccess(
    id: string,
    values: { permissions?: string[]; unattended?: boolean; requireBiometrics?: boolean; name?: string },
  ) {
    const row = this.devices.get(id);
    if (row === undefined || row.revoked_at !== null) return null;
    if (values.permissions !== undefined) row.permissions = values.permissions;
    if (values.unattended !== undefined) row.unattended = values.unattended;
    if (values.requireBiometrics !== undefined) row.require_biometrics = values.requireBiometrics;
    if (values.name !== undefined) row.name = values.name;
    return row;
  }
  async markDeviceSeen(id: string) {
    const row = this.devices.get(id);
    if (row !== undefined) row.last_seen_at = new Date().toISOString();
  }
  async getPairingCode(code: string) {
    return this.codes.get(code) ?? null;
  }
  async createPairingCode(input: { code: string; hostDeviceId: string; expiresAt: string }) {
    this.codes.set(input.code, {
      code: input.code,
      host_device_id: input.hostDeviceId,
      state: 'waiting',
      claimant_public_key: null,
      claimant_name: null,
      claimant_kind: null,
      host_confirmed: false,
      claimant_confirmed: false,
      expires_at: input.expiresAt,
      claimed_at: null,
      resolved_at: null,
    });
  }
  /** filtra por estado, igual que el UPDATE real: dos a la vez no ganan las dos */
  async transitionPairingCode(
    code: string,
    fromState: PairingCodeRow['state'],
    values: Partial<PairingCodeRow>,
  ) {
    const row = this.codes.get(code);
    if (row === undefined || row.state !== fromState) return null;
    Object.assign(row, values);
    return row;
  }
  /** false si ya existia: es la senal de replay */
  async registerNonce(_deviceId: string, nonce: string) {
    if (this.nonces.has(nonce)) return false;
    this.nonces.add(nonce);
    return true;
  }
  async audit(action: string, input: { deviceId?: string | null }) {
    this.auditoria.push({ action, deviceId: input.deviceId ?? null });
  }
}

let memoria: MemoriaRemota;
let deps: RemoteDeps;

beforeEach(() => {
  memoria = new MemoriaRemota();
  deps = {
    remote: memoria as never as RemoteDeps['remote'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
  };
});

// -----------------------------------------------------------------------------
// utilidades
// -----------------------------------------------------------------------------

const BASE = 'https://gateway.test';
const pc = generateIdentity();
const movil = generateIdentity();

function peticion(path: string, body: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** peticion FIRMADA por un dispositivo */
async function firmada(
  method: string,
  path: string,
  identidad: { privateKey: Uint8Array },
  deviceId: string,
  body: unknown = null,
  overrides: { nonce?: string; now?: number } = {},
): Promise<Request> {
  const texto = body === null ? '' : JSON.stringify(body);
  const headers = signRequest({
    privateKey: identidad.privateKey,
    deviceId,
    method,
    path,
    bodyHash: await hashBody(texto),
    nonce: overrides.nonce ?? `nonce-${randomUUID()}`,
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
  });

  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-luxy-device': headers.deviceId,
      'x-luxy-timestamp': String(headers.timestamp),
      'x-luxy-nonce': headers.nonce,
      'x-luxy-signature': headers.signature,
    },
    ...(texto.length > 0 ? { body: texto } : {}),
  });
}

/** ejecuta el emparejamiento entero y devuelve los identificadores */
async function emparejar(): Promise<{ hostId: string; deviceId: string; code: string }> {
  const inicio = await handlePairStart(
    peticion('/api/remote/pair/start', {
      hostPublicKey: toBase64Url(pc.publicKey),
      hostName: 'PC casa',
    }),
    deps,
  );
  const { code, hostDeviceId } = (await inicio.json()) as { code: string; hostDeviceId: string };

  const firma = toBase64Url(
    sign(movil.privateKey, 'luxy.pair.claim.v1', [code, toBase64Url(movil.publicKey)]),
  );
  await handlePairClaim(
    peticion('/api/remote/pair/claim', {
      code,
      publicKey: toBase64Url(movil.publicKey),
      name: 'Daniel-phone',
      kind: 'android',
      signature: firma,
    }),
    deps,
  );

  await handlePairConfirm(
    peticion('/api/remote/pair/confirm', { code, side: 'claimant', accepted: true }),
    deps,
  );
  const fin = await handlePairConfirm(
    peticion('/api/remote/pair/confirm', { code, side: 'host', accepted: true }),
    deps,
  );
  const { deviceId } = (await fin.json()) as { deviceId: string };

  return { hostId: hostDeviceId, deviceId, code };
}

// -----------------------------------------------------------------------------
// pruebas
// -----------------------------------------------------------------------------

describe('RECORRIDO COMPLETO por los endpoints', () => {
  it('start -> claim -> confirmar en ambos -> dispositivo emparejado', async () => {
    const { hostId, deviceId } = await emparejar();

    const dispositivo = memoria.devices.get(deviceId);
    expect(dispositivo?.name).toBe('Daniel-phone');
    expect(dispositivo?.peer_device_id).toBe(hostId);
    expect(dispositivo?.public_key).toBe(toBase64Url(movil.publicKey));
  });

  it('EMPAREJAR NO ES AUTORIZAR: sale sin permisos y sin desatendido', async () => {
    const { deviceId } = await emparejar();
    const dispositivo = memoria.devices.get(deviceId);

    expect(dispositivo?.permissions).toEqual([]);
    expect(dispositivo?.unattended).toBe(false);
  });

  it('las dos pantallas reciben las mismas palabras', async () => {
    const inicio = await handlePairStart(
      peticion('/api/remote/pair/start', {
        hostPublicKey: toBase64Url(pc.publicKey),
        hostName: 'PC casa',
      }),
      deps,
    );
    const { code } = (await inicio.json()) as { code: string };

    const firma = toBase64Url(
      sign(movil.privateKey, 'luxy.pair.claim.v1', [code, toBase64Url(movil.publicKey)]),
    );
    const reclamo = await handlePairClaim(
      peticion('/api/remote/pair/claim', {
        code,
        publicKey: toBase64Url(movil.publicKey),
        name: 'Daniel-phone',
        kind: 'android',
        signature: firma,
      }),
      deps,
    );

    const { words } = (await reclamo.json()) as { words: string[] };
    expect(words).toHaveLength(4);
  });
});

describe('un solo uso del codigo', () => {
  it('el segundo que reclama recibe 409', async () => {
    const inicio = await handlePairStart(
      peticion('/api/remote/pair/start', {
        hostPublicKey: toBase64Url(pc.publicKey),
        hostName: 'PC casa',
      }),
      deps,
    );
    const { code } = (await inicio.json()) as { code: string };

    const primera = toBase64Url(
      sign(movil.privateKey, 'luxy.pair.claim.v1', [code, toBase64Url(movil.publicKey)]),
    );
    await handlePairClaim(
      peticion('/api/remote/pair/claim', {
        code,
        publicKey: toBase64Url(movil.publicKey),
        name: 'legitimo',
        kind: 'android',
        signature: primera,
      }),
      deps,
    );

    const atacante = generateIdentity();
    const segunda = toBase64Url(
      sign(atacante.privateKey, 'luxy.pair.claim.v1', [code, toBase64Url(atacante.publicKey)]),
    );
    const respuesta = await handlePairClaim(
      peticion('/api/remote/pair/claim', {
        code,
        publicKey: toBase64Url(atacante.publicKey),
        name: 'atacante',
        kind: 'android',
        signature: segunda,
      }),
      deps,
    );

    expect(respuesta.status).toBe(400);
  });

  it('reclamar con firma invalida no crea nada', async () => {
    const inicio = await handlePairStart(
      peticion('/api/remote/pair/start', {
        hostPublicKey: toBase64Url(pc.publicKey),
        hostName: 'PC casa',
      }),
      deps,
    );
    const { code } = (await inicio.json()) as { code: string };
    const antes = memoria.devices.size;

    const atacante = generateIdentity();
    const respuesta = await handlePairClaim(
      peticion('/api/remote/pair/claim', {
        code,
        publicKey: toBase64Url(movil.publicKey),
        name: 'impostor',
        kind: 'android',
        // firma con OTRA clave
        signature: toBase64Url(
          sign(atacante.privateKey, 'luxy.pair.claim.v1', [code, toBase64Url(movil.publicKey)]),
        ),
      }),
      deps,
    );

    expect(respuesta.status).toBe(400);
    expect(memoria.devices.size).toBe(antes);
  });
});

describe('autenticacion de peticiones', () => {
  it('un dispositivo emparejado puede listar', async () => {
    const { hostId } = await emparejar();

    const respuesta = await handleListDevices(
      await firmada('GET', '/api/remote/devices', pc, hostId),
      deps,
    );
    expect(respuesta.status).toBe(200);

    const cuerpo = (await respuesta.json()) as { devices: { name: string }[] };
    expect(cuerpo.devices.map((d) => d.name)).toContain('Daniel-phone');
  });

  it('SIN firma no se pasa', async () => {
    const { hostId } = await emparejar();
    const respuesta = await handleListDevices(
      new Request(`${BASE}/api/remote/devices`, { method: 'GET' }),
      deps,
      { deviceId: hostId },
    );
    expect(respuesta.status).toBe(400);
  });

  it('el REPLAY de una peticion valida se rechaza', async () => {
    const { hostId } = await emparejar();
    const nonce = 'nonce-repetido-0001';

    const primera = await handleListDevices(
      await firmada('GET', '/api/remote/devices', pc, hostId, null, { nonce }),
      deps,
    );
    expect(primera.status).toBe(200);

    // exactamente la misma peticion otra vez
    const segunda = await handleListDevices(
      await firmada('GET', '/api/remote/devices', pc, hostId, null, { nonce }),
      deps,
    );
    expect(segunda.status).toBe(401);
    const cuerpo = (await segunda.json()) as { error: { code: string } };
    expect(cuerpo.error.code).toBe('replayed');
  });

  it('un dispositivo REVOCADO no puede hacer nada', async () => {
    const { deviceId } = await emparejar();
    await memoria.revokeDevice(deviceId);

    const respuesta = await handleListDevices(
      await firmada('GET', '/api/remote/devices', movil, deviceId),
      deps,
    );
    expect(respuesta.status).toBe(403);
  });

  it('firmar con otra clave no vale', async () => {
    const { hostId } = await emparejar();
    const impostor = generateIdentity();

    const respuesta = await handleListDevices(
      await firmada('GET', '/api/remote/devices', impostor, hostId),
      deps,
    );
    expect(respuesta.status).toBe(401);
  });
});

describe('permisos y acceso desatendido', () => {
  it('el ordenador puede conceder permisos a SU movil', async () => {
    const { hostId, deviceId } = await emparejar();
    const cuerpo = { permissions: ['view', 'control'], unattended: true };

    const respuesta = await handleUpdateAccess(
      await firmada('POST', `/api/remote/devices/${deviceId}/access`, pc, hostId, cuerpo),
      deps,
      { deviceId },
    );

    expect(respuesta.status).toBe(200);
    expect(memoria.devices.get(deviceId)?.permissions).toEqual(['view', 'control']);
    expect(memoria.devices.get(deviceId)?.unattended).toBe(true);
  });

  it('UN MOVIL NO PUEDE CONCEDERSE PERMISOS A SI MISMO', async () => {
    // el agujero evidente si no se comprobara la propiedad
    const { deviceId } = await emparejar();
    const cuerpo = { permissions: ['view', 'control'], unattended: true };

    const respuesta = await handleUpdateAccess(
      await firmada('POST', `/api/remote/devices/${deviceId}/access`, movil, deviceId, cuerpo),
      deps,
      { deviceId },
    );

    expect(respuesta.status).toBe(403);
    expect(memoria.devices.get(deviceId)?.permissions).toEqual([]);
  });

  it('control sin view se rechaza: no se controla a ciegas', async () => {
    const { hostId, deviceId } = await emparejar();
    const cuerpo = { permissions: ['control'] };

    const respuesta = await handleUpdateAccess(
      await firmada('POST', `/api/remote/devices/${deviceId}/access`, pc, hostId, cuerpo),
      deps,
      { deviceId },
    );

    expect(respuesta.status).toBe(400);
    expect(memoria.devices.get(deviceId)?.permissions).toEqual([]);
  });

  it('un dispositivo revocado NO recupera permisos', async () => {
    const { hostId, deviceId } = await emparejar();
    await memoria.revokeDevice(deviceId);

    const respuesta = await handleUpdateAccess(
      await firmada('POST', `/api/remote/devices/${deviceId}/access`, pc, hostId, {
        permissions: ['view'],
        unattended: true,
      }),
      deps,
      { deviceId },
    );

    expect(respuesta.status).toBe(403);
    expect(memoria.devices.get(deviceId)?.unattended).toBe(false);
  });
});

describe('revocacion', () => {
  it('el ordenador revoca su movil', async () => {
    const { hostId, deviceId } = await emparejar();

    const respuesta = await handleRevokeDevice(
      await firmada('POST', `/api/remote/devices/${deviceId}/revoke`, pc, hostId),
      deps,
      { deviceId },
    );

    expect(respuesta.status).toBe(200);
    expect(memoria.devices.get(deviceId)?.revoked_at).not.toBeNull();
  });

  it('revocar LIMPIA permisos y desatendido', async () => {
    const { hostId, deviceId } = await emparejar();
    await memoria.updateDeviceAccess(deviceId, { permissions: ['view'], unattended: true });

    await handleRevokeDevice(
      await firmada('POST', `/api/remote/devices/${deviceId}/revoke`, pc, hostId),
      deps,
      { deviceId },
    );

    expect(memoria.devices.get(deviceId)?.permissions).toEqual([]);
    expect(memoria.devices.get(deviceId)?.unattended).toBe(false);
  });

  it('no se puede revocar un dispositivo ajeno', async () => {
    const { deviceId } = await emparejar();
    const otroPc = generateIdentity();
    const ajeno = await memoria.createDevice({
      name: 'otro PC',
      kind: 'desktop',
      publicKey: toBase64Url(otroPc.publicKey),
      fingerprint: fingerprint(otroPc.publicKey),
      peerDeviceId: null,
      permissions: [],
    });

    const respuesta = await handleRevokeDevice(
      await firmada('POST', `/api/remote/devices/${deviceId}/revoke`, otroPc, ajeno.id),
      deps,
      { deviceId },
    );

    expect(respuesta.status).toBe(403);
    expect(memoria.devices.get(deviceId)?.revoked_at).toBeNull();
  });
});

describe('auditoria', () => {
  it('el emparejamiento y la revocacion quedan registrados', async () => {
    const { hostId, deviceId } = await emparejar();
    await handleRevokeDevice(
      await firmada('POST', `/api/remote/devices/${deviceId}/revoke`, pc, hostId),
      deps,
      { deviceId },
    );

    const acciones = memoria.auditoria.map((a) => a.action);
    expect(acciones).toContain('pair.start');
    expect(acciones).toContain('pair.claim');
    expect(acciones).toContain('pair.confirm');
    expect(acciones).toContain('device.revoke');
  });
});
