// endpoints de control remoto: emparejamiento y gestion de dispositivos.
//
// TODA peticion autenticada pasa por withDeviceAuth, que es la unica puerta.
// Igual que guardControlMessage en el protocolo: si las comprobaciones se
// repartieran por cada handler, tarde o temprano uno se saltaria alguna.
import { z } from 'zod';
import {
  verifySignedRequest,
  hashBody,
  fromBase64Url,
  generatePairingCode,
  startPairing,
  claimPairing,
  confirmPairing,
  sessionWords,
  isPaired,
  pairedDeviceFrom,
  PAIRING_CODE_TTL_MS,
  AUTH_WINDOW_MS,
  type PairingSession,
} from '@luxy/remote-crypto';
import { CAPABILITIES, validateCapabilitySet, type Capability } from '@luxy/remote-protocol';
import type { RemoteRepository, RemoteDeviceRow, PairingCodeRow } from '../remote-repository.js';
import type { Logger } from '../logger.js';

export interface RemoteDeps {
  remote: RemoteRepository;
  logger: Logger;
}

// -----------------------------------------------------------------------------
// utilidades de respuesta
// -----------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(code: string, detail: string, status: number): Response {
  return json({ error: { code, detail } }, status);
}

/** codigos http por tipo de rechazo, para que el cliente sepa si reintentar */
const AUTH_STATUS: Record<string, number> = {
  malformed: 400,
  stale: 401,
  replayed: 401,
  unknown_device: 401,
  revoked: 403,
  bad_signature: 401,
};

// -----------------------------------------------------------------------------
// la puerta
// -----------------------------------------------------------------------------

export interface AuthenticatedDevice {
  row: RemoteDeviceRow;
  body: string;
}

export type DeviceHandler = (
  request: Request,
  deps: RemoteDeps,
  device: AuthenticatedDevice,
  params: Record<string, string>,
) => Promise<Response>;

/**
 * autentica una peticion firmada.
 *
 * El nonce se registra ANTES de verificar la firma a proposito. Parece al reves,
 * pero es lo correcto: registrar es atomico gracias a la clave primaria, asi que
 * dos peticiones identicas simultaneas no pueden pasar las dos. Si se verificara
 * primero, ambas pasarian la firma y luego competirian por el registro.
 *
 * El coste es que una firma invalida consume un nonce, y eso da igual: el nonce
 * lo elige el cliente y solo se le impide repetirlo.
 */
export function withDeviceAuth(handler: DeviceHandler) {
  return async (
    request: Request,
    deps: RemoteDeps,
    params: Record<string, string> = {},
  ): Promise<Response> => {
    const body = await request.text();
    const url = new URL(request.url);

    const headers = {
      deviceId: request.headers.get('x-luxy-device') ?? '',
      timestamp: Number(request.headers.get('x-luxy-timestamp') ?? '0'),
      nonce: request.headers.get('x-luxy-nonce') ?? '',
      signature: request.headers.get('x-luxy-signature') ?? '',
    };

    // se busca el dispositivo antes: hace falta su clave para verificar
    const row =
      /^[0-9a-f-]{36}$/i.test(headers.deviceId) === true
        ? await deps.remote.getDeviceById(headers.deviceId)
        : null;

    let nonceNuevo = true;
    if (row !== null) {
      nonceNuevo = await deps.remote.registerNonce(
        row.id,
        headers.nonce,
        new Date(Date.now() + AUTH_WINDOW_MS * 2).toISOString(),
      );
    }

    const veredicto = verifySignedRequest({
      headers,
      method: request.method,
      path: url.pathname,
      bodyHash: await hashBody(body),
      publicKey: row === null ? null : fromBase64Url(row.public_key),
      revoked: row?.revoked_at !== null && row?.revoked_at !== undefined,
      nonceSeen: !nonceNuevo,
    });

    if (!veredicto.ok) {
      // NO se dice cual de las comprobaciones fallo mas alla del codigo: un
      // atacante no necesita saber si el dispositivo existe pero la firma falla,
      // o si el dispositivo no existe
      deps.logger.warn('peticion remota rechazada', { code: veredicto.code });
      return fail(veredicto.code, veredicto.detail, AUTH_STATUS[veredicto.code] ?? 401);
    }

    if (row === null) return fail('unknown_device', 'dispositivo desconocido', 401);

    return handler(request, deps, { row, body }, params);
  };
}

// -----------------------------------------------------------------------------
// emparejamiento
//
// pair/start y pair/claim NO llevan autenticacion de dispositivo: son
// precisamente los pasos en los que todavia no hay emparejamiento. Su proteccion
// es otra: el codigo caduca en tres minutos, es de un solo uso, y hay que firmar
// para reclamarlo.
// -----------------------------------------------------------------------------

const startSchema = z.object({
  hostPublicKey: z.string().min(80).max(100),
  hostName: z.string().min(1).max(64),
});

export async function handlePairStart(request: Request, deps: RemoteDeps): Promise<Response> {
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('malformed', 'faltan datos del ordenador', 400);

  let hostKey: Uint8Array;
  try {
    hostKey = fromBase64Url(parsed.data.hostPublicKey);
  } catch {
    return fail('bad_key', 'la clave del ordenador no es valida', 400);
  }

  // el host se registra como dispositivo la primera vez, o se reutiliza
  let host = await deps.remote.getDeviceByPublicKey(parsed.data.hostPublicKey);
  if (host === null) {
    host = await deps.remote.createDevice({
      name: parsed.data.hostName,
      kind: 'desktop',
      publicKey: parsed.data.hostPublicKey,
      fingerprint: '',
      peerDeviceId: null,
      permissions: [],
    });
  }
  if (host.revoked_at !== null) {
    return fail('revoked', 'este ordenador fue revocado', 403);
  }

  const code = generatePairingCode((n) => crypto.getRandomValues(new Uint8Array(n)));
  const sesion = startPairing({ code, hostPublicKey: hostKey, hostName: parsed.data.hostName });

  await deps.remote.createPairingCode({
    code,
    hostDeviceId: host.id,
    expiresAt: new Date(sesion.expiresAt).toISOString(),
  });
  await deps.remote.audit('pair.start', { deviceId: host.id });

  return json({
    code,
    expiresAt: sesion.expiresAt,
    hostDeviceId: host.id,
    ttlMs: PAIRING_CODE_TTL_MS,
  });
}

const claimSchema = z.object({
  code: z.string().regex(/^\d{8}$/),
  publicKey: z.string().min(80).max(100),
  name: z.string().min(1).max(64),
  kind: z.enum(['android', 'desktop']),
  signature: z.string().min(80).max(100),
});

export async function handlePairClaim(request: Request, deps: RemoteDeps): Promise<Response> {
  const parsed = claimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('malformed', 'faltan datos del dispositivo', 400);

  const fila = await deps.remote.getPairingCode(parsed.data.code);
  const host = fila === null ? null : await deps.remote.getDeviceById(fila.host_device_id);
  if (fila === null || host === null) {
    return fail('not_found', 'ese codigo no existe', 404);
  }

  const resultado = claimPairing({
    session: sessionFromRow(fila, host),
    claimantPublicKey: parsed.data.publicKey,
    claimantName: parsed.data.name,
    claimantKind: parsed.data.kind,
    signature: parsed.data.signature,
  });
  if (!resultado.ok) return fail(resultado.code, resultado.detail, 400);

  // la transicion filtra por estado: dos reclamaciones simultaneas no ganan las dos
  const actualizada = await deps.remote.transitionPairingCode(parsed.data.code, 'waiting', {
    state: 'claimed',
    claimant_public_key: parsed.data.publicKey,
    claimant_name: parsed.data.name,
    claimant_kind: parsed.data.kind,
    claimed_at: new Date().toISOString(),
  });
  if (actualizada === null) {
    return fail('already_used', 'ese codigo ya se uso. Genera otro en el ordenador', 409);
  }

  await deps.remote.audit('pair.claim', { deviceId: host.id, detail: { kind: parsed.data.kind } });

  return json({
    words: sessionWords(resultado.value),
    hostName: host.name,
    hostFingerprint: host.fingerprint,
  });
}

const confirmSchema = z.object({
  code: z.string().regex(/^\d{8}$/),
  side: z.enum(['host', 'claimant']),
  accepted: z.boolean(),
});

export async function handlePairConfirm(request: Request, deps: RemoteDeps): Promise<Response> {
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('malformed', 'faltan datos de la confirmacion', 400);

  const fila = await deps.remote.getPairingCode(parsed.data.code);
  const host = fila === null ? null : await deps.remote.getDeviceById(fila.host_device_id);
  if (fila === null || host === null) return fail('not_found', 'ese codigo no existe', 404);

  const sesion = sessionFromRow(fila, host);
  const resultado = confirmPairing({
    session: sesion,
    side: parsed.data.side,
    accepted: parsed.data.accepted,
  });
  if (!resultado.ok) return fail(resultado.code, resultado.detail, 400);

  if (resultado.value.state === 'rejected') {
    await deps.remote.transitionPairingCode(parsed.data.code, 'claimed', {
      state: 'rejected',
      resolved_at: new Date().toISOString(),
    });
    await deps.remote.audit('pair.reject', { deviceId: host.id });
    return json({ state: 'rejected', paired: false });
  }

  if (!isPaired(resultado.value)) {
    // falta la otra confirmacion. El estado de las confirmaciones vive en el
    // codigo mientras tanto; no se crea nada todavia.
    await deps.remote.transitionPairingCode(parsed.data.code, 'claimed', {
      ...(parsed.data.side === 'host'
        ? { host_confirmed: true }
        : { claimant_confirmed: true }),
    });
    return json({ state: 'claimed', paired: false, waitingFor: otroLado(parsed.data.side) });
  }

  const nuevo = pairedDeviceFrom(resultado.value);
  if (nuevo === null) return fail('wrong_state', 'no hay dispositivo que guardar', 400);

  const dispositivo = await deps.remote.createDevice({
    name: nuevo.name,
    kind: nuevo.kind,
    publicKey: nuevo.publicKey,
    fingerprint: nuevo.fingerprint,
    peerDeviceId: host.id,
    // SIN permisos y SIN desatendido: se conceden despues, a mano, desde el
    // ordenador. Emparejar no es autorizar.
    permissions: [],
  });

  await deps.remote.transitionPairingCode(parsed.data.code, 'claimed', {
    state: 'confirmed',
    resolved_at: new Date().toISOString(),
  });
  await deps.remote.audit('pair.confirm', {
    deviceId: dispositivo.id,
    detail: { hostDeviceId: host.id },
  });

  return json({
    state: 'confirmed',
    paired: true,
    deviceId: dispositivo.id,
    hostDeviceId: host.id,
    hostPublicKey: host.public_key,
  });
}

// -----------------------------------------------------------------------------
// gestion de dispositivos (autenticada)
// -----------------------------------------------------------------------------

export const handleListDevices = withDeviceAuth(async (_request, deps, device) => {
  const peers = await deps.remote.listPeersOf(device.row.id);
  await deps.remote.markDeviceSeen(device.row.id);

  return json({
    self: publicView(device.row),
    devices: peers.map(publicView),
  });
});

const accessSchema = z.object({
  permissions: z.array(z.enum(CAPABILITIES)).max(8).optional(),
  unattended: z.boolean().optional(),
  requireBiometrics: z.boolean().optional(),
  name: z.string().min(1).max(64).optional(),
});

/**
 * cambia permisos y acceso desatendido de un dispositivo emparejado.
 *
 * Solo el HOST puede hacerlo sobre SUS dispositivos. Un movil no puede
 * concederse permisos a si mismo, que seria el agujero evidente.
 */
export const handleUpdateAccess = withDeviceAuth(async (_request, deps, device, params) => {
  const objetivo = params.deviceId;
  if (objetivo === undefined) return fail('malformed', 'falta el dispositivo', 400);

  const parsed = accessSchema.safeParse(JSON.parse(device.body || '{}'));
  if (!parsed.success) return fail('malformed', 'datos de acceso invalidos', 400);

  const fila = await deps.remote.getDeviceById(objetivo);
  if (fila === null) return fail('not_found', 'ese dispositivo no existe', 404);

  if (fila.peer_device_id !== device.row.id) {
    return fail('forbidden', 'ese dispositivo no esta emparejado contigo', 403);
  }
  if (fila.revoked_at !== null) {
    return fail('revoked', 'ese dispositivo fue revocado: vuelve a emparejarlo', 403);
  }

  if (parsed.data.permissions !== undefined) {
    const problema = validateCapabilitySet(parsed.data.permissions as Capability[]);
    if (problema !== null) return fail('invalid_permissions', problema, 400);
  }

  const actualizado = await deps.remote.updateDeviceAccess(objetivo, parsed.data);
  if (actualizado === null) return fail('not_found', 'no se pudo actualizar', 404);

  await deps.remote.audit('device.access', {
    deviceId: objetivo,
    detail: {
      permissions: parsed.data.permissions ?? null,
      unattended: parsed.data.unattended ?? null,
    },
  });

  return json({ device: publicView(actualizado) });
});

export const handleRevokeDevice = withDeviceAuth(async (_request, deps, device, params) => {
  const objetivo = params.deviceId;
  if (objetivo === undefined) return fail('malformed', 'falta el dispositivo', 400);

  const fila = await deps.remote.getDeviceById(objetivo);
  if (fila === null) return fail('not_found', 'ese dispositivo no existe', 404);
  if (fila.peer_device_id !== device.row.id) {
    return fail('forbidden', 'ese dispositivo no esta emparejado contigo', 403);
  }

  const revocado = await deps.remote.revokeDevice(objetivo);
  if (!revocado) return json({ revoked: false, alreadyRevoked: true });

  await deps.remote.audit('device.revoke', { deviceId: objetivo });
  return json({ revoked: true });
});

// -----------------------------------------------------------------------------
// auxiliares
// -----------------------------------------------------------------------------

/**
 * vista publica de un dispositivo.
 *
 * La clave publica SI sale (no es secreta y el otro extremo la necesita para
 * verificar firmas). Lo que no sale nunca es nada derivado de la privada.
 */
function publicView(row: RemoteDeviceRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    publicKey: row.public_key,
    fingerprint: row.fingerprint,
    permissions: row.permissions,
    unattended: row.unattended,
    requireBiometrics: row.require_biometrics,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
    revoked: row.revoked_at !== null,
  };
}

/** reconstruye la sesion de emparejamiento desde la fila */
function sessionFromRow(row: PairingCodeRow, host: RemoteDeviceRow): PairingSession {
  return {
    code: row.code,
    state: row.state,
    expiresAt: Date.parse(row.expires_at),
    hostPublicKey: host.public_key,
    hostName: host.name,
    claimantPublicKey: row.claimant_public_key,
    claimantName: row.claimant_name,
    claimantKind: row.claimant_kind,
    hostConfirmed: row.host_confirmed,
    claimantConfirmed: row.claimant_confirmed,
  };
}

function otroLado(side: 'host' | 'claimant'): string {
  return side === 'host' ? 'el movil' : 'el ordenador';
}
