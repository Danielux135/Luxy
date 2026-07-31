// pruebas de los hallazgos de la revision de seguridad.
//
// Van en un archivo aparte del recorrido feliz a proposito: aqui todo es
// "esto NO debe poder hacerse", y conviene poder leerlo de un tiron.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  generateIdentity,
  sign,
  signRequest,
  toBase64Url,
  hashBody,
  fingerprint,
  canonicalPublicKey,
  pairStartParts,
  pairConfirmParts,
} from '@luxy/remote-crypto';
import {
  handlePairStart,
  handlePairClaim,
  handlePairConfirm,
  handleListDevices,
  handleUpdateAccess,
  type RemoteDeps,
} from './remote.js';
import { MemoriaRemota } from './remote-memoria.js';

const BASE = 'https://gateway.test';
const pc = generateIdentity();
const movil = generateIdentity();

let memoria: MemoriaRemota;
let deps: RemoteDeps;

beforeEach(() => {
  memoria = new MemoriaRemota();
  deps = {
    remote: memoria as never as RemoteDeps['remote'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
  };
});

function peticion(path: string, body: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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

async function abrirCodigo(): Promise<string> {
  const inicio = await handlePairStart(
    peticion('/api/remote/pair/start', cuerpoStart(pc)),
    deps,
  );
  const cuerpo = (await inicio.json()) as { code?: string };
  if (cuerpo.code === undefined) throw new Error('pair/start fallo');
  return cuerpo.code;
}

async function reclamar(code: string, identidad = movil): Promise<Response> {
  return handlePairClaim(
    peticion('/api/remote/pair/claim', {
      code,
      publicKey: toBase64Url(identidad.publicKey),
      name: 'Daniel-phone',
      kind: 'android',
      signature: toBase64Url(
        sign(identidad.privateKey, 'luxy.pair.claim.v1', [
          code,
          toBase64Url(identidad.publicKey),
        ]),
      ),
    }),
    deps,
  );
}

async function emparejar(): Promise<{ hostId: string; deviceId: string }> {
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
  const datos = (await fin.json()) as { deviceId: string; hostDeviceId: string };
  return { hostId: datos.hostDeviceId, deviceId: datos.deviceId };
}

async function firmada(
  method: string,
  path: string,
  identidad: { privateKey: Uint8Array },
  deviceId: string,
  nonce = `n-${randomUUID()}`,
): Promise<Request> {
  const headers = signRequest({
    privateKey: identidad.privateKey,
    deviceId,
    method,
    path,
    bodyHash: await hashBody(''),
    nonce,
  });
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      'x-luxy-device': headers.deviceId,
      'x-luxy-timestamp': String(headers.timestamp),
      'x-luxy-nonce': headers.nonce,
      'x-luxy-signature': headers.signature,
    },
  });
}

// -----------------------------------------------------------------------------

describe('HALLAZGO 1: no se puede emparejar sin humano', () => {
  it('quien tiene la clave PUBLICA del PC no puede pedir codigos en su nombre', async () => {
    // la clave publica va dentro del QR: una foto basta para obtenerla. Sin
    // prueba de posesion, el atacante abria un codigo en nombre del PC de la
    // victima, lo reclamaba con SU clave y enviaba las DOS confirmaciones,
    // porque "side" era un campo del cuerpo. Emparejamiento completo sin humano.
    const now = Date.now();
    const respuesta = await handlePairStart(
      peticion('/api/remote/pair/start', {
        hostPublicKey: toBase64Url(pc.publicKey),
        hostName: 'PC casa',
        timestamp: now,
        signature: toBase64Url(
          sign(
            movil.privateKey,
            'luxy.pair.start.v1',
            pairStartParts(toBase64Url(pc.publicKey), 'PC casa', now),
          ),
        ),
      }),
      deps,
    );

    expect(respuesta.status).toBe(401);
    expect(memoria.codes.size).toBe(0);
  });

  it('el atacante NO puede confirmar por el lado del ordenador', async () => {
    const code = await abrirCodigo();
    await reclamar(code);

    const respuesta = await handlePairConfirm(
      peticion(
        '/api/remote/pair/confirm',
        // dice ser el host pero firma con la clave del movil
        cuerpoConfirm(movil, code, 'host', toBase64Url(pc.publicKey), toBase64Url(movil.publicKey)),
      ),
      deps,
    );

    expect(respuesta.status).toBe(401);
  });

  it('no se puede confirmar un codigo que nadie ha reclamado', async () => {
    const code = await abrirCodigo();
    const hostKey = toBase64Url(pc.publicKey);

    const respuesta = await handlePairConfirm(
      peticion('/api/remote/pair/confirm', cuerpoConfirm(pc, code, 'host', hostKey, hostKey)),
      deps,
    );
    expect(respuesta.status).toBe(400);
  });

  it('la confirmacion va atada a LAS DOS claves que produjeron las palabras', async () => {
    const code = await abrirCodigo();
    await reclamar(code);
    const impostor = generateIdentity();

    const respuesta = await handlePairConfirm(
      peticion(
        '/api/remote/pair/confirm',
        cuerpoConfirm(
          pc,
          code,
          'host',
          toBase64Url(pc.publicKey),
          // clave distinta de la que reclamo: la firma deja de valer
          toBase64Url(impostor.publicKey),
        ),
      ),
      deps,
    );
    expect(respuesta.status).toBe(401);
  });

  it('una peticion de inicio vieja se rechaza', async () => {
    const respuesta = await handlePairStart(
      peticion('/api/remote/pair/start', cuerpoStart(pc, 'PC casa', Date.now() - 600_000)),
      deps,
    );
    expect(respuesta.status).toBe(401);
  });
});

describe('HALLAZGO 2: base64url no canonico', () => {
  /** variante distinta EN TEXTO que decodifica a los MISMOS bytes */
  function variante(canonico: string): string {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') {
      const candidato = canonico.slice(0, -1) + c;
      if (candidato !== canonico && canonicalPublicKey(candidato) === canonico) return candidato;
    }
    throw new Error('no se encontro variante');
  }

  it('existen variantes distintas que son la misma clave', () => {
    // 65 bytes no es multiplo de 3: el ultimo caracter lleva 2 bits sobrantes
    // que atob ignora. Cuatro cadenas para una sola identidad.
    const canonico = toBase64Url(pc.publicKey);
    const otra = variante(canonico);
    expect(otra).not.toBe(canonico);
    expect(canonicalPublicKey(otra)).toBe(canonico);
  });

  it('pair/start RECHAZA una variante: no crea un segundo ordenador', async () => {
    // sin esto, el indice unico -que es sobre TEXTO- no saltaba, y revocar una
    // fila no revocaba las otras tres
    await abrirCodigo();
    expect(memoria.devices.size).toBe(1);

    const otra = variante(toBase64Url(pc.publicKey));
    const now = Date.now();
    const respuesta = await handlePairStart(
      peticion('/api/remote/pair/start', {
        hostPublicKey: otra,
        hostName: 'PC casa',
        timestamp: now,
        signature: toBase64Url(
          sign(pc.privateKey, 'luxy.pair.start.v1', pairStartParts(otra, 'PC casa', now)),
        ),
      }),
      deps,
    );

    expect(respuesta.status).toBe(400);
    expect(memoria.devices.size).toBe(1);
  });

  it('pair/claim RECHAZA una variante: un revocado no vuelve por la puerta de atras', async () => {
    // el ataque concreto: un movil revocado se empareja de nuevo mandando una
    // variante de su propia clave, creando una fila nueva SIN revocar
    const code = await abrirCodigo();
    const otra = variante(toBase64Url(movil.publicKey));

    const respuesta = await handlePairClaim(
      peticion('/api/remote/pair/claim', {
        code,
        publicKey: otra,
        name: 'movil',
        kind: 'android',
        signature: toBase64Url(sign(movil.privateKey, 'luxy.pair.claim.v1', [code, otra])),
      }),
      deps,
    );

    expect(respuesta.status).toBe(400);
    expect(memoria.codes.get(code)?.claimant_public_key).toBeNull();
  });

  it('una clave que no esta en la curva se rechaza', async () => {
    const bytes = new Uint8Array(65).fill(0x07);
    bytes[0] = 0x04;

    const respuesta = await handlePairStart(
      peticion('/api/remote/pair/start', {
        hostPublicKey: toBase64Url(bytes),
        hostName: 'x',
        timestamp: Date.now(),
        signature: toBase64Url(new Uint8Array(64).fill(1)),
      }),
      deps,
    );

    expect(respuesta.status).toBe(400);
    expect(memoria.devices.size).toBe(0);
  });
});

describe('HALLAZGO 3: la huella del host es real', () => {
  it('no se guarda vacia', async () => {
    await abrirCodigo();
    const host = [...memoria.devices.values()][0];
    expect(host?.fingerprint).toBe(fingerprint(pc.publicKey));
    expect(host?.fingerprint).toHaveLength(64);
  });
});

describe('HALLAZGO 5: el nonce se consume DESPUES de validar la firma', () => {
  it('una firma invalida NO gasta el nonce del dispositivo legitimo', async () => {
    // antes se podia escribir en la tabla de nonces sin ninguna firma valida,
    // solo conociendo un deviceId, que no es secreto
    const { hostId } = await emparejar();
    const impostor = generateIdentity();
    const nonce = 'nonce-que-usara-la-victima';

    const atacante = await handleListDevices(
      await firmada('GET', '/api/remote/devices', impostor, hostId, nonce),
      deps,
    );
    expect(atacante.status).toBe(401);
    expect(memoria.nonces.has(nonce)).toBe(false);

    const legitimo = await handleListDevices(
      await firmada('GET', '/api/remote/devices', pc, hostId, nonce),
      deps,
    );
    expect(legitimo.status).toBe(200);
  });
});

describe('HALLAZGO 6: no se revela el estado del dispositivo', () => {
  it('firma mala, dispositivo desconocido y revocado dan la MISMA respuesta', async () => {
    const { hostId, deviceId } = await emparejar();
    const impostor = generateIdentity();

    const firmaMala = await handleListDevices(
      await firmada('GET', '/api/remote/devices', impostor, hostId),
      deps,
    );
    const desconocido = await handleListDevices(
      await firmada('GET', '/api/remote/devices', pc, randomUUID()),
      deps,
    );
    await memoria.revokeDevice(deviceId);
    const revocado = await handleListDevices(
      await firmada('GET', '/api/remote/devices', movil, deviceId),
      deps,
    );

    for (const r of [firmaMala, desconocido, revocado]) {
      expect(r.status).toBe(401);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    }
  });
});

describe('HALLAZGO 7: entradas invalidas no tumban el Worker', () => {
  it('un identificador de 36 caracteres que no es UUID se rechaza con 400, sin consultar', async () => {
    const respuesta = await handleListDevices(
      new Request(`${BASE}/api/remote/devices`, {
        method: 'GET',
        headers: {
          'x-luxy-device': '------------------------------------',
          'x-luxy-timestamp': String(Date.now()),
          'x-luxy-nonce': 'nonce-cualquiera-1234',
          'x-luxy-signature': toBase64Url(new Uint8Array(64)),
        },
      }),
      deps,
    );
    // 400 y no 401: las cabeceras estan mal formadas, y eso no revela nada del
    // dispositivo. Un cliente legitimo necesita poder distinguirlo.
    expect(respuesta.status).toBe(400);
  });

  it('un cuerpo que no es JSON devuelve 400, no 500', async () => {
    const { hostId, deviceId } = await emparejar();
    const path = `/api/remote/devices/${deviceId}/access`;
    const headers = signRequest({
      privateKey: pc.privateKey,
      deviceId: hostId,
      method: 'POST',
      path,
      bodyHash: await hashBody('{roto'),
      nonce: `n-${randomUUID()}`,
    });

    const respuesta = await handleUpdateAccess(
      new Request(`${BASE}${path}`, {
        method: 'POST',
        headers: {
          'x-luxy-device': headers.deviceId,
          'x-luxy-timestamp': String(headers.timestamp),
          'x-luxy-nonce': headers.nonce,
          'x-luxy-signature': headers.signature,
        },
        body: '{roto',
      }),
      deps,
      { deviceId },
    );

    expect(respuesta.status).toBe(400);
  });
});
