// cuentas y sincronizacion de la boveda privada.
//
// El gateway transporta, almacena y AUTORIZA; nunca lee. La correccion que
// exigio D-045: la propiedad de un registro es por usuario, no por vault_id.
// Cada peticion de contenido pasa por withVaultAuth, que exige una sesion
// valida, y filtra por el usuario de esa sesion. Un token valido de una cuenta
// no da acceso al contenido de otra.
//
// Ademas de validar con Zod, el push ejecuta assertNoPlaintextLeak sobre cada
// registro: un servidor que confia en que el cliente hizo los deberes acaba
// guardando lo que no debe el dia que alguien cambia el cliente.
import {
  assertNoPlaintextLeak,
  vaultChangePasswordRequestSchema,
  vaultLoginFinishRequestSchema,
  vaultLoginStartRequestSchema,
  vaultRegisterRequestSchema,
  vaultSyncPullQuerySchema,
  vaultSyncPushRequestSchema,
  type PrivateRecord,
} from '@luxy/shared';
import type { ApiDeps } from './api.js';
import { errorResponse, json, readBody } from './api.js';
import { hashToken } from '../auth.js';
import { AuthError } from '../auth.js';
import { describeError } from '../logger.js';
import { getVaultAuthLimiter } from '../ratelimit.js';
import {
  VAULT_SESSION_TTL_MS,
  authenticateVaultUser,
  generateSessionToken,
  verifyAuthHash,
  type AuthenticatedVaultUser,
} from '../vault-auth.js';

interface VaultRecordRow {
  record_id: string;
  conversation_id: string;
  sequence: number;
  content: unknown;
  sealed_memory: unknown;
  created_at: string;
}

function toPrivateRecord(row: VaultRecordRow): PrivateRecord {
  return {
    recordId: row.record_id,
    conversationId: row.conversation_id,
    privacy: 'private',
    sequence: row.sequence,
    content: row.content as PrivateRecord['content'],
    sealedMemory: (row.sealed_memory ?? null) as PrivateRecord['sealedMemory'],
    createdAt: row.created_at,
  };
}

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

type VaultHandler = (
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
    return handler(request, deps, user, params);
  };
}

// -----------------------------------------------------------------------------
// sincronizacion (autorizada por usuario, ya no por vault_id)
// -----------------------------------------------------------------------------

export const handleVaultPush = withVaultAuth(async (request, deps, user) => {
  const body = await readBody(request, vaultSyncPushRequestSchema);
  if (!body.ok) return body.response;

  for (const record of body.data.records) {
    try {
      assertNoPlaintextLeak(record);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : 'el registro lleva contenido en claro',
        422,
      );
    }
    if (record.conversationId !== body.data.conversationId) {
      return errorResponse('un registro no pertenece a la conversacion indicada', 422);
    }
  }

  // la conversacion se crea a nombre del usuario de la sesion: nadie puede
  // subir a la conversacion de otro
  await deps.repo.ensureVaultConversation(user.id, body.data.conversationId);
  const stored = await deps.repo.insertVaultRecords(user.id, body.data.records);

  // ni la conversacion ni nada del contenido; solo cuantos y de quien
  deps.logger.info('registros de boveda almacenados', {
    userId: user.id,
    stored,
    received: body.data.records.length,
  });
  return json({ stored, skipped: body.data.records.length - stored });
});

export const handleVaultConversations = withVaultAuth(async (request, deps, user) => {
  const url = new URL(request.url);
  // el vaultId ya no viaja: la autorizacion es el usuario de la sesion, y la
  // consulta se hace siempre sobre lo suyo. Un cliente viejo puede seguir
  // mandandolo; se ignora a proposito en vez de rechazarlo.
  const query = vaultSyncPullQuerySchema.safeParse({
    since: url.searchParams.get('since') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!query.success) return errorResponse('los parametros de sincronizacion no son validos', 422);

  const rows = await deps.repo.listVaultConversations(user.id, query.data);
  return json({
    conversations: rows.map((row) => ({
      conversationId: row.conversation_id,
      turnCount: row.turn_count,
      updatedAt: row.updated_at,
    })),
  });
});

export const handleVaultPull = withVaultAuth(async (request, deps, user, params) => {
  const conversationId = params.conversationId;
  if (conversationId === undefined) return errorResponse('falta la conversacion', 400);

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 200 : Math.min(500, Math.max(1, Number.parseInt(limitRaw, 10) || 200));

  const rows = await deps.repo.listVaultRecords(user.id, conversationId, limit);
  return json({ records: rows.map(toPrivateRecord) });
});

export const handleVaultDelete = withVaultAuth(async (_request, deps, user, params) => {
  const conversationId = params.conversationId;
  if (conversationId === undefined) return errorResponse('falta la conversacion', 400);
  const deleted = await deps.repo.deleteVaultConversation(user.id, conversationId);
  return json({ deleted });
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
