// cuentas de la boveda privada, bytes de sus medios y cierre de la sync v1.
//
// El gateway transporta, almacena y AUTORIZA; nunca lee. La correccion que
// exigio D-045: la propiedad de un registro es por usuario, no por vault_id.
// Cada peticion de contenido pasa por withVaultAuth, que exige una sesion
// valida, y filtra por el usuario de esa sesion. Un token valido de una cuenta
// no da acceso al contenido de otra.
//
// La sincronizacion vive en `vault-sync-v2.ts` (D-110). De la v1 solo queda el
// cierre: sus rutas responden 426 sin autenticar ni tocar la base.
import {
  VAULT_SYNC_PROTOCOL,
  vaultChangePasswordRequestSchema,
  vaultLoginFinishRequestSchema,
  vaultLoginStartRequestSchema,
  vaultRegisterRequestSchema,
} from '@luxy/shared';
import type { ApiDeps } from './api.js';
import { errorResponse, json, readBody } from './api.js';
import { hashToken } from '../auth.js';
import { AuthError } from '../auth.js';
import { describeError } from '../logger.js';
import { getVaultAuthLimiter } from '../ratelimit.js';
import { ObjectStoreError } from '../object-store.js';
import {
  VAULT_SESSION_TTL_MS,
  authenticateVaultUser,
  generateSessionToken,
  verifyAuthHash,
  type AuthenticatedVaultUser,
} from '../vault-auth.js';

// -----------------------------------------------------------------------------
// cuentas
// -----------------------------------------------------------------------------

/**
 * registra una cuenta.
 *
 * NO exige token de maquina: es como se entra la primera vez. Lo que llega no
 * abre nada (D-046), y el correo unico impide registrar dos veces el mismo.
 */
export async function handleVaultRegister(request: Request, deps: ApiDeps): Promise<Response> {
  const body = await readBody(request, vaultRegisterRequestSchema);
  if (!body.ok) return body.response;
  if (!getVaultAuthLimiter().check(body.data.email).allowed) {
    return errorResponse('demasiados intentos; espera un momento', 429);
  }

  const existing = await deps.repo.getVaultUserByEmail(body.data.email);
  if (existing !== null) {
    // no se dice "ya existe" con detalle util: solo que no se pudo. Confirmar
    // que un correo tiene cuenta ya es informacion
    return errorResponse('no se pudo crear la cuenta con esos datos', 409);
  }

  const user = await deps.repo.createVaultUser({
    email: body.data.email,
    authSalt: body.data.authSalt,
    argon2Params: body.data.argon2Params,
    authHash: body.data.authHash,
    wrappedMasterKey: body.data.wrappedMasterKey,
    vaultId: body.data.vaultId,
    recovery: body.data.recovery,
  });

  const session = await issueSession(deps, user.id);
  deps.logger.info('cuenta de boveda creada', { userId: user.id });
  return json({ ...session, vaultId: body.data.vaultId }, 201);
}

/** primer paso del login: entrega sal, coste y llave envuelta para derivar */
export async function handleVaultLoginStart(request: Request, deps: ApiDeps): Promise<Response> {
  const body = await readBody(request, vaultLoginStartRequestSchema);
  if (!body.ok) return body.response;
  if (!getVaultAuthLimiter().check(body.data.email).allowed) {
    return errorResponse('demasiados intentos; espera un momento', 429);
  }

  const user = await deps.repo.getVaultUserByEmail(body.data.email);
  // se responde con datos plausibles aunque el correo no exista, para no
  // revelar que cuentas hay. El login fallara luego en el hash, igual que si la
  // contraseña fuera mala.
  if (user === null || user.disabled) {
    return json(decoyLoginStart(body.data.email));
  }

  return json({
    authSalt: user.auth_salt,
    argon2Params: { t: user.argon2_t, m: user.argon2_m, p: user.argon2_p },
    wrappedMasterKey: user.wrapped_master_key,
    // las dos puertas viajan juntas: pedir la de recuperacion aparte diria al
    // servidor que alguien ha olvidado su contraseña, y no le hace falta saberlo
    recovery: {
      authSalt: user.recovery_salt,
      argon2Params: {
        t: user.recovery_argon2_t,
        m: user.recovery_argon2_m,
        p: user.recovery_argon2_p,
      },
      wrappedMasterKey: user.recovery_wrapped_master_key,
    },
  });
}

/** segundo paso: el cliente prueba su hash de acceso y recibe una sesion */
export async function handleVaultLoginFinish(request: Request, deps: ApiDeps): Promise<Response> {
  const body = await readBody(request, vaultLoginFinishRequestSchema);
  if (!body.ok) return body.response;
  if (!getVaultAuthLimiter().check(body.data.email).allowed) {
    return errorResponse('demasiados intentos; espera un momento', 429);
  }

  const user = await deps.repo.getVaultUserByEmail(body.data.email);
  // las dos puertas prueban lo mismo: que quien llama puede abrir la boveda. La
  // de recuperacion es la que hace utilizable un «he olvidado la contraseña»
  // desde un ordenador nuevo
  const proves =
    user !== null &&
    (verifyAuthHash(body.data.authHash, user.auth_hash) ||
      verifyAuthHash(body.data.authHash, user.recovery_auth_hash));
  if (user === null || user.disabled || !proves) {
    // mismo mensaje para "no existe" y "hash incorrecto": no se distingue
    return errorResponse('correo o contraseña incorrectos', 401);
  }

  const session = await issueSession(deps, user.id);
  deps.logger.info('sesion de boveda iniciada', { userId: user.id });
  return json({ ...session, vaultId: user.vault_id });
}

/** cierra la sesion actual */
export const handleVaultLogout = withVaultAuth(async (request, deps) => {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  await deps.repo.revokeVaultSession(await hashToken(token));
  return json({ ok: true });
});

/** cambia la contraseña: reenvuelve la maestra, no recifra la boveda */
export const handleVaultChangePassword = withVaultAuth(async (request, deps, user) => {
  const body = await readBody(request, vaultChangePasswordRequestSchema);
  if (!body.ok) return body.response;

  const stored = await deps.repo.getVaultUserById(user.id);
  if (stored === null) return errorResponse('la cuenta ya no existe', 401);
  // vale la contraseña actual o la clave de recuperacion: sin esto, quien entra
  // con la clave tendria acceso pero no podria elegir una contraseña nueva, que
  // es justo lo que va a querer hacer
  const proves =
    verifyAuthHash(body.data.currentAuthHash, stored.auth_hash) ||
    verifyAuthHash(body.data.currentAuthHash, stored.recovery_auth_hash);
  if (!proves) {
    return errorResponse('la contraseña actual no es correcta', 403);
  }

  await deps.repo.updateVaultUserCredentials(user.id, {
    authSalt: body.data.authSalt,
    argon2Params: body.data.argon2Params,
    authHash: body.data.authHash,
    wrappedMasterKey: body.data.wrappedMasterKey,
  });
  // las demas sesiones se cierran: cambiar la contraseña echa a los otros
  // equipos, que es lo que se espera de un cambio de contraseña
  await deps.repo.revokeOtherVaultSessions(user.id, await currentSessionHash(request));
  return json({ ok: true });
});

// -----------------------------------------------------------------------------
// autorizacion
// -----------------------------------------------------------------------------

export type VaultHandler = (
  request: Request,
  deps: ApiDeps,
  user: AuthenticatedVaultUser,
  params: Record<string, string>,
) => Promise<Response>;

/** exige una sesion de cuenta valida y pasa el usuario al manejador */
export function withVaultAuth(handler: VaultHandler) {
  return async (
    request: Request,
    deps: ApiDeps,
    params: Record<string, string> = {},
  ): Promise<Response> => {
    let user: AuthenticatedVaultUser;
    try {
      user = await authenticateVaultUser(request, deps.db);
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(error.message, error.status);
      deps.logger.error('fallo autenticando cuenta de boveda', describeError(error));
      return errorResponse('no se pudo autenticar la cuenta', 500);
    }
    if (user.sessionRenewal === 'failed') {
      // la peticion sigue: la sesion vale hasta su caducidad de antes. Pero si
      // se repite, la sesion caducara en uso y esto es lo que lo explica
      deps.logger.warn('no se pudo renovar la sesion de boveda', { userId: user.id });
    }
    return handler(request, deps, user, params);
  };
}

// -----------------------------------------------------------------------------
// sincronizacion v1: cerrada
// -----------------------------------------------------------------------------

/**
 * responde 426 a cualquier ruta de sincronizacion v1, ANTES de autenticar.
 *
 * La v1 nunca funciono (SEG-SYNC-001) y un Studio que la hable no sabe de dos
 * versiones, de bases ni de lapidas: dejarle escribir mezclaria historias o
 * resucitaria lo borrado. Antes de autenticar porque no hay nada que proteger
 * con la sesion: la respuesta es la misma para todos y no toca la base.
 */
export async function handleVaultV1Closed(): Promise<Response> {
  return json(
    {
      error:
        'actualiza Luxy Studio: este servidor ya no admite la sincronizacion antigua ' +
        'y lo de este equipo sigue a salvo',
      protocol: VAULT_SYNC_PROTOCOL,
    },
    426,
  );
}

// -----------------------------------------------------------------------------
// medios: los metadatos van a la tabla, los bytes al almacen de objetos
// -----------------------------------------------------------------------------

/**
 * sube los BYTES de un objeto.
 *
 * Va antes que el registro y por separado a proposito: si se corta aqui queda
 * un huerfano que una limpieza recoge, en vez de una fila que apunta a algo que
 * no existe y que solo se descubre meses despues al abrir la imagen.
 *
 * El cuerpo es opaco para el gateway. No se valida su contenido porque no se
 * puede: es ciphertext.
 */
export const handleVaultMediaUpload = withVaultAuth(async (request, deps, user, params) => {
  const objectKey = params.objectKey;
  if (objectKey === undefined || !/^[0-9a-f]{32}$/.test(objectKey)) {
    return errorResponse('la clave del objeto no es valida', 422);
  }

  // el tope del almacen de este despliegue, el mismo que anuncia capabilities
  // y nunca mas de 90 MiB. Antes se miraban los 90 MiB del protocolo, y un
  // archivo por encima del tope de Storage se leia entero en el Worker para
  // que Storage lo rechazara despues (GW-R2-01)
  const maxBytes = deps.config.VAULT_OBJECT_MAX_BYTES;
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) {
    return errorResponse('ese archivo es demasiado grande para sincronizarlo', 413);
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return errorResponse('el archivo esta vacio', 422);
  if (bytes.byteLength > maxBytes) {
    return errorResponse('ese archivo es demasiado grande para sincronizarlo', 413);
  }

  try {
    await deps.objects.put(user.id, objectKey, bytes);
  } catch (error) {
    if (error instanceof ObjectStoreError) {
      // el almacen admite menos de lo configurado: se dice para ajustarlo. Solo
      // el usuario, ni la clave ni el tamaño
      if (error.status === 413) {
        deps.logger.warn('el almacen rechazo un objeto de boveda por su tamaño', { userId: user.id });
      }
      return errorResponse(error.message, error.status);
    }
    deps.logger.error('fallo guardando un objeto de boveda', describeError(error));
    return errorResponse('no se pudo guardar el archivo', 502);
  }

  // ni la clave ni el tamaño exacto: solo que hubo una subida y de quien
  deps.logger.info('objeto de boveda almacenado', { userId: user.id });
  return json({ stored: true });
});

/**
 * descarga los bytes de un objeto propio.
 *
 * Vale para el original y para la miniatura: la tabla autoriza los dos. Antes
 * solo el original, y la miniatura que pide el otro equipo daba 404.
 */
export const handleVaultMediaDownload = withVaultAuth(async (_request, deps, user, params) => {
  const objectKey = params.objectKey;
  if (objectKey === undefined || !/^[0-9a-f]{32}$/.test(objectKey)) {
    return errorResponse('la clave del objeto no es valida', 422);
  }

  // se comprueba en la TABLA que el objeto es suyo antes de tocar el almacen:
  // la ruta ya separa por usuario, pero la autorizacion se decide donde esta
  // registrada la propiedad, no en como se construye una ruta
  const owned = await deps.repo.findVaultMediaObject(user.id, objectKey);
  if (owned === null) return errorResponse('ese archivo no existe', 404);

  try {
    const bytes = await deps.objects.get(user.id, objectKey);
    return new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  } catch (error) {
    if (error instanceof ObjectStoreError) return errorResponse(error.message, error.status);
    deps.logger.error('fallo leyendo un objeto de boveda', describeError(error));
    return errorResponse('no se pudo leer el archivo', 502);
  }
});

// -----------------------------------------------------------------------------
// utilidades internas
// -----------------------------------------------------------------------------

async function issueSession(
  deps: ApiDeps,
  userId: string,
): Promise<{ sessionToken: string; expiresAt: string }> {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + VAULT_SESSION_TTL_MS).toISOString();
  await deps.repo.createVaultSession(userId, await hashToken(sessionToken), expiresAt);
  return { sessionToken, expiresAt };
}

async function currentSessionHash(request: Request): Promise<string> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  return hashToken(token);
}

/**
 * respuesta señuelo para un correo que no existe.
 *
 * derivada del propio correo para que sea estable: el mismo correo inexistente
 * da siempre los mismos datos, asi que probar dos veces no delata que no hay
 * cuenta. Es plausible, no valida: el login fallara igual en el hash.
 */
function decoyLoginStart(email: string): unknown {
  // sal derivada del correo, deterministica dentro de esta respuesta
  const seed = [...email].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1_000_000, 7);
  const filler = (n: number, len: number): string =>
    Array.from({ length: len }, (_v, i) => 'ABCDEFGHJKMNPQRSTVWXYZ23456789'[(seed + i * n) % 30]).join('');
  return {
    authSalt: filler(3, 22),
    argon2Params: { t: 3, m: 64 * 1024, p: 1 },
    wrappedMasterKey: {
      version: 1,
      purpose: 'vault.account.masterkey',
      nonce: filler(5, 16),
      ciphertext: filler(7, 64),
    },
    // el señuelo tambien trae la puerta de recuperacion: omitirla diria que
    // esa cuenta no existe, que es justo lo que el señuelo evita decir
    recovery: {
      authSalt: filler(11, 22),
      argon2Params: { t: 1, m: 8 * 1024, p: 1 },
      wrappedMasterKey: {
        version: 1,
        purpose: 'vault.account.recovery',
        nonce: filler(13, 16),
        ciphertext: filler(17, 64),
      },
    },
  };
}
