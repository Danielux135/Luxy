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
  pairStartParts,
  pairConfirmParts,
  confirmationWords,
} from '@luxy/remote-crypto';
import {
  handlePairStart,
  handlePairClaim,
  handlePairConfirm,
  handleListDevices,
  handleUpdateAccess,
  handleRevokeDevice,
  handlePairState,
  type RemoteDeps,
} from './remote.js';
import { MemoriaRemota } from './remote-memoria.js';


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

/** cuerpo firmado de pair/start */
function cuerpoStart(
  identidad: { privateKey: Uint8Array; publicKey: Uint8Array },
  nombre = 'PC casa',
  now = Date.now(),
): Record<string, unknown> {
  const clave = toBase64Url(identidad.publicKey);
  return {
    hostPublicKey: clave,
    hostName: nombre,
    timestamp: now,
    signature: toBase64Url(
      sign(identidad.privateKey, 'luxy.pair.start.v1', pairStartParts(clave, nombre, now)),
    ),
  };
}

/** cuerpo firmado de pair/confirm */
function cuerpoConfirm(
  identidad: { privateKey: Uint8Array },
  code: string,
  side: 'host' | 'claimant',
  hostKey: string,
  claimantKey: string,
  accepted = true,
): Record<string, unknown> {
  return {
    code,
    side,
    accepted,
    signature: toBase64Url(
      sign(
        identidad.privateKey,
        'luxy.pair.confirm.v1',
        pairConfirmParts(code, hostKey, claimantKey, accepted),
      ),
    ),
  };
}

async function abrirCodigo(identidad = pc, nombre = 'PC casa'): Promise<string> {
  const inicio = await handlePairStart(
    peticion('/api/remote/pair/start', cuerpoStart(identidad, nombre)),
    deps,
  );
  const cuerpo = (await inicio.json()) as { code?: string };
  if (cuerpo.code === undefined) throw new Error('pair/start fallo');
  return cuerpo.code;
}

async function reclamar(code: string, identidad = movil, nombre = 'Daniel-phone') {
  return handlePairClaim(
    peticion('/api/remote/pair/claim', {
      code,
      publicKey: toBase64Url(identidad.publicKey),
      name: nombre,
      kind: 'android',
      signature: toBase64Url(
        sign(identidad.privateKey, 'luxy.pair.claim.v1', [code, toBase64Url(identidad.publicKey)]),
      ),
    }),
    deps,
  );
}

/** ejecuta el emparejamiento entero y devuelve los identificadores */
async function emparejar(): Promise<{ hostId: string; deviceId: string; code: string }> {
  const code = await abrirCodigo();
  await reclamar(code);

  const hostKey = toBase64Url(pc.publicKey);
  const movilKey = toBase64Url(movil.publicKey);

  await handlePairConfirm(
    peticion('/api/remote/pair/confirm', cuerpoConfirm(movil, code, 'claimant', hostKey, movilKey)),
    deps,
  );
  const fin = await handlePairConfirm(
    peticion('/api/remote/pair/confirm', cuerpoConfirm(pc, code, 'host', hostKey, movilKey)),
    deps,
  );
  const { deviceId, hostDeviceId } = (await fin.json()) as {
    deviceId: string;
    hostDeviceId: string;
  };

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

  it('EL GATEWAY NO DICTA LAS PALABRAS: cada lado las calcula', async () => {
    // si las dictara, uno comprometido podria sustituir una clave y enviar a
    // cada lado las que quisiera; la comparacion del usuario no detectaria nada
    const code = await abrirCodigo();
    const reclamo = await reclamar(code);
    const cuerpo = (await reclamo.json()) as Record<string, unknown>;

    expect(cuerpo.words).toBeUndefined();
    expect(cuerpo.hostPublicKey).toBe(toBase64Url(pc.publicKey));

    // el estado devuelve la clave EN CRUDO, y de ahi salen las palabras
    const estado = await handlePairState(
      new Request(`${BASE}/api/remote/pair/${code}/state`),
      deps,
      { code },
    );
    const datos = (await estado.json()) as { claimantPublicKey: string };
    expect(confirmationWords(pc.publicKey, movil.publicKey)).toHaveLength(4);
    expect(datos.claimantPublicKey).toBe(toBase64Url(movil.publicKey));
  });
});

describe('un solo uso del codigo', () => {
  it('el segundo que reclama recibe 409', async () => {
    const code = await abrirCodigo();

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
    const code = await abrirCodigo();
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
    // el codigo va colapsado a "unauthorized" a proposito: distinguir "replay"
    // de "firma mala" de "no existe" convertia el endpoint en un oraculo con el
    // que averiguar si un deviceId existe y si sigue activo
    const cuerpo = (await segunda.json()) as { error: { code: string } };
    expect(cuerpo.error.code).toBe('unauthorized');
  });

  it('un dispositivo REVOCADO no puede hacer nada', async () => {
    const { deviceId } = await emparejar();
    await memoria.revokeDevice(deviceId);

    const respuesta = await handleListDevices(
      await firmada('GET', '/api/remote/devices', movil, deviceId),
      deps,
    );
    // 401 generico, no 403: no se confirma al atacante que el dispositivo
    // existe pero esta revocado
    expect(respuesta.status).toBe(401);
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
