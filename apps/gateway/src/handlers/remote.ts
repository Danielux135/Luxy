// endpoints de control remoto: emparejamiento y gestion de dispositivos.
//
// TODA peticion autenticada pasa por withDeviceAuth, que es la unica puerta.
// Igual que guardControlMessage en el protocolo: si las comprobaciones se
// repartieran por cada handler, tarde o temprano uno se saltaria alguna.
import { z } from 'zod';
import {
  AUTH_WINDOW_MS as VENTANA,
  verifySignedRequest,
  hashBody,
  fromBase64Url,
  canonicalPublicKey,
  fingerprint,
  verify,
  pairStartParts,
  pairConfirmParts,
  generatePairingCode,
  startPairing,
  claimPairing,
  confirmPairing,
  isPaired,
  pairedDeviceFrom,
  PAIRING_CODE_TTL_MS,
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

/**
 * respuesta unica para cualquier fallo de autenticacion.
 *
 * NO se distingue "el dispositivo no existe" de "la firma no vale" de "esta
 * revocado". Devolver el codigo real convertia el endpoint en un oraculo: con un
 * deviceId conocido se podia averiguar si existe y si sigue activo. El detalle
 * queda en el log del servidor, que es donde sirve.
 *
 * `malformed` y `stale` SI se distinguen porque no revelan nada del dispositivo
 * y un cliente legitimo con el reloj desajustado necesita saberlo para
 * corregirlo.
 */
function rechazoAuth(code: string, detail: string): Response {
  if (code === 'malformed') return fail('malformed', detail, 400);
  if (code === 'stale') return fail('stale', detail, 401);
  return fail('unauthorized', 'no autorizado', 401);
}

/** UUID v4 de verdad: "------..." tiene 36 caracteres y no es un UUID */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      UUID_RE.test(headers.deviceId)
        ? await deps.remote.getDeviceById(headers.deviceId)
        : null;

    // PRIMERO la firma, DESPUES el nonce.
    //
    // Estaba al reves con el argumento de la atomicidad, y el argumento era
    // flojo: `insertIfAbsent` sigue siendo atomico ejecutandolo despues, y solo
    // lo alcanzan peticiones que ya demostraron ser autenticas. Al reves, se
    // podia escribir en remote_auth_nonces SIN NINGUNA FIRMA VALIDA con solo
    // conocer un deviceId, que no es secreto.
    const veredicto = verifySignedRequest({
      headers,
      method: request.method,
      path: url.pathname,
      bodyHash: await hashBody(body),
      publicKey: row === null ? null : fromBase64Url(row.public_key),
      revoked: row?.revoked_at !== null && row?.revoked_at !== undefined,
      // el replay se comprueba aparte, justo debajo
      nonceSeen: false,
    });

    if (!veredicto.ok) {
      deps.logger.warn('peticion remota rechazada', { code: veredicto.code });
      return rechazoAuth(veredicto.code, veredicto.detail);
    }

    if (row === null) return rechazoAuth('unknown_device', 'dispositivo desconocido');

    // consumir el nonce ES la comprobacion de replay: `insertIfAbsent` devuelve
    // false si ya existia, y eso ocurre en una sola operacion atomica
    const nonceNuevo = await deps.remote.registerNonce(
      row.id,
      headers.nonce,
      new Date(Date.now() + VENTANA * 2).toISOString(),
    );
    if (!nonceNuevo) {
      deps.logger.warn('peticion remota rechazada', { code: 'replayed' });
      return rechazoAuth('replayed', 'esta peticion ya se proceso');
    }

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

const CLAVE_RE = /^[A-Za-z0-9_-]{86,88}$/;

const startSchema = z.object({
  hostPublicKey: z.string().regex(CLAVE_RE),
  hostName: z.string().min(1).max(64),
  /** prueba de posesion: sin esto cualquiera pedia codigos en nombre de otro PC */
  timestamp: z.number().int().positive(),
  signature: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
});

export async function handlePairStart(request: Request, deps: RemoteDeps): Promise<Response> {
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('malformed', 'faltan datos del ordenador', 400);

  // canonicalizar ANTES de tocar la base: cuatro cadenas distintas decodifican a
  // la misma clave, y guardar el texto recibido permitia cuatro filas por
  // identidad, con lo que revocar una no revocaba las demas
  // se EXIGE la forma canonica en vez de normalizar en silencio. Normalizar
  // funcionaria igual de bien contra el ataque, pero un cliente que mandara una
  // variante recibiria despues un fallo de firma incomprensible. Asi el error
  // dice lo que pasa.
  const canonica = canonicalPublicKey(parsed.data.hostPublicKey);
  if (canonica === null || canonica !== parsed.data.hostPublicKey) {
    return fail('bad_key', 'la clave del ordenador no es valida o no esta en forma canonica', 400);
  }
  const hostKey = fromBase64Url(canonica);

  // PRUEBA DE POSESION. Sin esto, quien tuviera la clave publica del ordenador
  // -que va dentro del QR y no es secreta- podia pedir codigos en su nombre.
  if (Math.abs(Date.now() - parsed.data.timestamp) > VENTANA) {
    return fail('stale', 'la peticion esta fuera de la ventana de tiempo', 401);
  }
  const firmaValida = verify(
    hostKey,
    'luxy.pair.start.v1',
    pairStartParts(canonica, parsed.data.hostName, parsed.data.timestamp),
    fromBase64Url(parsed.data.signature),
  );
  if (!firmaValida) {
    return fail('unauthorized', 'no autorizado', 401);
  }

  // el host se registra como dispositivo la primera vez, o se reutiliza
  let host = await deps.remote.getDeviceByPublicKey(canonica);
  if (host === null) {
    host = await deps.remote.createDevice({
      name: parsed.data.hostName,
      kind: 'desktop',
      publicKey: canonica,
      // la huella se calcula de verdad: iba vacia, y el movil la recibia vacia
      fingerprint: fingerprint(hostKey),
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
  publicKey: z.string().regex(CLAVE_RE),
  name: z.string().min(1).max(64),
  kind: z.enum(['android', 'desktop']),
  signature: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
});

export async function handlePairClaim(request: Request, deps: RemoteDeps): Promise<Response> {
  const parsed = claimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('malformed', 'faltan datos del dispositivo', 400);

  const fila = await deps.remote.getPairingCode(parsed.data.code);
  const host = fila === null ? null : await deps.remote.getDeviceById(fila.host_device_id);
  if (fila === null || host === null) {
    return fail('not_found', 'ese codigo no existe', 404);
  }

  const canonica = canonicalPublicKey(parsed.data.publicKey);
  if (canonica === null || canonica !== parsed.data.publicKey) {
    return fail('bad_key', 'la clave del dispositivo no es valida o no esta en forma canonica', 400);
  }

  const resultado = claimPairing({
    session: sessionFromRow(fila, host),
    claimantPublicKey: canonica,
    claimantName: parsed.data.name,
    claimantKind: parsed.data.kind,
    signature: parsed.data.signature,
  });
  if (!resultado.ok) return fail(resultado.code, resultado.detail, 400);

  // la transicion filtra por estado: dos reclamaciones simultaneas no ganan las dos
  const actualizada = await deps.remote.transitionPairingCode(parsed.data.code, 'waiting', {
    state: 'claimed',
    claimant_public_key: canonica,
    claimant_name: parsed.data.name,
    claimant_kind: parsed.data.kind,
    claimed_at: new Date().toISOString(),
  });
  if (actualizada === null) {
    return fail('already_used', 'ese codigo ya se uso. Genera otro en el ordenador', 409);
  }

  await deps.remote.audit('pair.claim', { deviceId: host.id, detail: { kind: parsed.data.kind } });

  // NO se devuelven las palabras. Si el gateway las dictara, uno comprometido
  // podria sustituir una clave y enviar a cada lado las que quisiera: la
  // comparacion del usuario dejaria de detectar nada. Cada lado las calcula con
  // las dos claves publicas que tiene.
  return json({
    state: 'claimed',
    hostName: host.name,
    hostPublicKey: host.public_key,
    hostFingerprint: host.fingerprint,
  });
}

const confirmSchema = z.object({
  code: z.string().regex(/^\d{8}$/),
  side: z.enum(['host', 'claimant']),
  accepted: z.boolean(),
  /**
   * firma del lado que dice ser.
   *
   * SIN ESTO el emparejamiento se completaba sin ningun humano: `side` es un
   * campo del cuerpo, asi que el mismo cliente enviaba las dos confirmaciones y
   * las palabras no llegaban a intervenir. Ahora cada lado tiene que demostrar
   * que posee su clave privada, y la firma incluye LAS DOS claves publicas: eso
   * ata la confirmacion exactamente a lo que el usuario comparo.
   */
  signature: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
});

export async function handlePairConfirm(request: Request, deps: RemoteDeps): Promise<Response> {
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('malformed', 'faltan datos de la confirmacion', 400);

  const fila = await deps.remote.getPairingCode(parsed.data.code);
  const host = fila === null ? null : await deps.remote.getDeviceById(fila.host_device_id);
  if (fila === null || host === null) return fail('not_found', 'ese codigo no existe', 404);

  const sesion = sessionFromRow(fila, host);

  if (fila.claimant_public_key === null) {
    return fail('wrong_state', 'ese codigo todavia no se ha reclamado', 400);
  }

  // quien firma decide el lado, no el cuerpo de la peticion
  const claveDelLado =
    parsed.data.side === 'host' ? host.public_key : fila.claimant_public_key;
  const canonicaLado = canonicalPublicKey(claveDelLado);
  if (canonicaLado === null) return fail('bad_key', 'clave no valida', 400);

  const firmaValida = verify(
    fromBase64Url(canonicaLado),
    'luxy.pair.confirm.v1',
    pairConfirmParts(
      parsed.data.code,
      host.public_key,
      fila.claimant_public_key,
      parsed.data.accepted,
    ),
    fromBase64Url(parsed.data.signature),
  );
  if (!firmaValida) return fail('unauthorized', 'no autorizado', 401);

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

/**
 * estado de un emparejamiento en curso.
 *
 * Devuelve la clave publica del reclamante EN CRUDO para que cada lado calcule
 * sus propias palabras. El gateway no dicta las palabras a nadie: esa es toda la
 * defensa contra una sustitucion de clave hecha por el propio gateway.
 *
 * No lleva autenticacion de dispositivo -todavia no hay emparejamiento- pero el
 * codigo caduca en tres minutos y no revela nada que no vaya ya en el QR.
 */
export async function handlePairState(
  _request: Request,
  deps: RemoteDeps,
  params: Record<string, string>,
): Promise<Response> {
  const code = params.code;
  if (code === undefined || !/^\d{8}$/.test(code)) {
    return fail('malformed', 'codigo no valido', 400);
  }

  const fila = await deps.remote.getPairingCode(code);
  if (fila === null) return fail('not_found', 'ese codigo no existe', 404);

  const caducado = Date.parse(fila.expires_at) <= Date.now();
  const dispositivo =
    fila.state === 'confirmed' && fila.claimant_public_key !== null
      ? await deps.remote.getDeviceByPublicKey(fila.claimant_public_key)
      : null;

  return json({
    state: caducado && fila.state === 'waiting' ? 'expired' : fila.state,
    claimantPublicKey: fila.claimant_public_key,
    claimantName: fila.claimant_name,
    hostConfirmed: fila.host_confirmed,
    claimantConfirmed: fila.claimant_confirmed,
    deviceId: dispositivo?.id ?? null,
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
  if (objetivo === undefined || !UUID_RE.test(objetivo)) {
    return fail('malformed', 'el dispositivo no es valido', 400);
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(device.body.length > 0 ? device.body : '{}');
  } catch {
    return fail('malformed', 'el cuerpo no es JSON valido', 400);
  }
  const parsed = accessSchema.safeParse(crudo);
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
  if (objetivo === undefined || !UUID_RE.test(objetivo)) {
    return fail('malformed', 'el dispositivo no es valido', 400);
  }

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
