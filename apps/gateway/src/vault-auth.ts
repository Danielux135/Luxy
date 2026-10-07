// autenticacion de las cuentas de boveda en el gateway.
//
// Distinta de la de maquinas: una maquina se identifica con su token; una
// persona, con una sesion que obtiene tras probar su hash de acceso. El
// gateway verifica ese hash y no puede derivar nada de cifrado de el.
//
// Todo lo que compara con un valor guardado usa comparacion en tiempo
// constante, para no filtrar por el tiempo de respuesta si un hash o un token
// es casi correcto.
import { hashToken, timingSafeEqual, extractBearerToken } from './auth.js';
import type { SupabaseClient } from './supabase.js';
import { eq } from './supabase.js';
import { AuthError } from './auth.js';

/** duracion de una sesion. corta a proposito: se renueva al usarla */
export const VAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * por debajo de esto, usar la sesion la alarga otros VAULT_SESSION_TTL_MS.
 *
 * El comentario de arriba prometia la renovacion y nada la hacia: la sesion
 * caducaba a los 30 dias de entrar aunque se usara cada dia. No se renueva en
 * cada peticion porque escribir en cada lectura no aporta nada: con 15 dias de
 * margen basta una escritura cada quincena.
 */
export const VAULT_SESSION_RENEW_BELOW_MS = 15 * 24 * 60 * 60 * 1000;

export interface VaultUserRow {
  id: string;
  email: string;
  auth_salt: string;
  argon2_t: number;
  argon2_m: number;
  argon2_p: number;
  auth_hash: string;
  wrapped_master_key: unknown;
  /** la otra puerta: misma llave, cerrada con la clave de recuperacion */
  recovery_salt: string;
  recovery_argon2_t: number;
  recovery_argon2_m: number;
  recovery_argon2_p: number;
  recovery_auth_hash: string;
  recovery_wrapped_master_key: unknown;
  vault_id: string;
  disabled: boolean;
}

export interface AuthenticatedVaultUser {
  id: string;
  vaultId: string;
  /** caducidad vigente de la sesion, ya renovada si tocaba, en forma canonica */
  sessionExpiresAt: string;
  /**
   * que paso con la renovacion. `failed` no tumba la peticion —la sesion sigue
   * valida hasta su caducidad de antes— pero quien autentica lo registra.
   */
  sessionRenewal: 'not-needed' | 'renewed' | 'failed';
}

/** token de sesion aleatorio de 256 bits, en base64url */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * comprueba el hash de acceso contra el guardado.
 *
 * En tiempo constante: un hash casi correcto no debe tardar distinto de uno
 * completamente equivocado.
 */
export function verifyAuthHash(provided: string, stored: string): boolean {
  return timingSafeEqual(provided, stored);
}

interface VaultSessionRow {
  id: string;
  user_id: string;
  revoked_at: string | null;
  expires_at: string;
}

/**
 * autentica una peticion de boveda por su token de sesion.
 *
 * comprueba hash, revocacion y caducidad, y que la cuenta siga activa. Devuelve
 * el usuario para que el manejador filtre por `owner_user_id`: esa es la
 * autorizacion que `D-045` exigia y que el `vault_id` no daba.
 *
 * Si a la sesion le quedan menos de VAULT_SESSION_RENEW_BELOW_MS, la alarga a
 * ahora + VAULT_SESSION_TTL_MS. Solo despues de comprobar la cuenta: una cuenta
 * deshabilitada no gana dias.
 */
export async function authenticateVaultUser(
  request: Request,
  supabase: SupabaseClient,
  now: number = Date.now(),
): Promise<AuthenticatedVaultUser> {
  const token = extractBearerToken(request);
  if (!token) throw new AuthError('falta la sesion de la cuenta', 401);

  const tokenHash = await hashToken(token);
  const session = await supabase.selectOne<VaultSessionRow>('vault_sessions', {
    columns: 'id,user_id,revoked_at,expires_at',
    filters: { token_hash: eq(tokenHash) },
  });

  if (!session) throw new AuthError('sesion no valida', 401);
  if (session.revoked_at) throw new AuthError('esta sesion fue cerrada', 401);
  const expiresAt = Date.parse(session.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new AuthError('la sesion ha caducado; vuelve a entrar', 401);
  }

  const user = await supabase.selectOne<{ id: string; vault_id: string; disabled: boolean }>(
    'vault_users',
    { columns: 'id,vault_id,disabled', filters: { id: eq(session.user_id) } },
  );
  if (!user) throw new AuthError('la cuenta ya no existe', 401);
  if (user.disabled) throw new AuthError('esta cuenta esta deshabilitada', 403);

  // Postgres la devuelve con «+00:00»; hacia fuera siempre va canonica
  const current = new Date(expiresAt).toISOString();
  if (expiresAt - now >= VAULT_SESSION_RENEW_BELOW_MS) {
    return { id: user.id, vaultId: user.vault_id, sessionExpiresAt: current, sessionRenewal: 'not-needed' };
  }

  const renewed = new Date(now + VAULT_SESSION_TTL_MS).toISOString();
  let rows: unknown[];
  try {
    // revoked_at is null: un cierre de sesion que llegue a la vez gana, y no
    // se le dan treinta dias mas a una sesion ya cerrada
    rows = await supabase.update<unknown>(
      'vault_sessions',
      { id: eq(session.id), revoked_at: 'is.null' },
      { expires_at: renewed },
    );
  } catch {
    // la sesion sigue valida hasta su caducidad de antes; quien autentica lo
    // registra. Tumbar una sincronizacion por no poder alargar la sesion
    // castigaria al usuario por un fallo que no le afecta todavia
    return { id: user.id, vaultId: user.vault_id, sessionExpiresAt: current, sessionRenewal: 'failed' };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AuthError('esta sesion fue cerrada', 401);
  }
  return { id: user.id, vaultId: user.vault_id, sessionExpiresAt: renewed, sessionRenewal: 'renewed' };
}
