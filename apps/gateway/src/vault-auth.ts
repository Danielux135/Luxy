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

export interface VaultUserRow {
  id: string;
  email: string;
  auth_salt: string;
  argon2_t: number;
  argon2_m: number;
  argon2_p: number;
  auth_hash: string;
  wrapped_master_key: unknown;
  vault_id: string;
  disabled: boolean;
}

export interface AuthenticatedVaultUser {
  id: string;
  vaultId: string;
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
 */
export async function authenticateVaultUser(
  request: Request,
  supabase: SupabaseClient,
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
  if (Date.parse(session.expires_at) <= Date.now()) {
    throw new AuthError('la sesion ha caducado; vuelve a entrar', 401);
  }

  const user = await supabase.selectOne<{ id: string; vault_id: string; disabled: boolean }>(
    'vault_users',
    { columns: 'id,vault_id,disabled', filters: { id: eq(session.user_id) } },
  );
  if (!user) throw new AuthError('la cuenta ya no existe', 401);
  if (user.disabled) throw new AuthError('esta cuenta esta deshabilitada', 403);

  return { id: user.id, vaultId: user.vault_id };
}
