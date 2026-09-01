// cliente de cuentas de boveda contra el gateway.
//
// Es lo que une el vault local con el servidor. Registra y abre una cuenta sin
// que la contraseña salga del equipo: toda la criptografia ocurre aqui, en el
// proceso principal, y al gateway solo viajan el hash de acceso y la llave
// envuelta (D-046).
//
// Mantiene el token de sesion en memoria y lo entrega a la sincronizacion. El
// token no cruza el IPC: el renderer no lo necesita y darselo seria darle una
// credencial reutilizable.
import {
  createAccount,
  openAccount,
  rewrapAccountPassword,
  type Argon2Params,
  type OpenedAccount,
  type SealedEnvelope,
} from '@luxy/vault-crypto';
import {
  vaultSessionResponseSchema,
  vaultLoginStartResponseSchema,
  VAULT_MIN_PASSWORD_LENGTH,
} from '@luxy/shared';
import { VaultError } from './vault-service.js';

export interface AccountClientDeps {
  gatewayUrl: string;
  fetchImpl?: typeof fetch;
}

export interface AccountSession {
  sessionToken: string;
  expiresAt: string;
  vaultId: string;
  /** llave maestra abierta; quien la reciba la borra al bloquear */
  masterKey: Uint8Array;
}

class AccountError extends VaultError {}

async function post(deps: AccountClientDeps, path: string, body: unknown): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(`${deps.gatewayUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new AccountError('demasiados intentos; espera un momento');
    }
    if (response.status === 401) {
      throw new AccountError('correo o contraseña incorrectos');
    }
    if (response.status === 409) {
      throw new AccountError('no se pudo crear la cuenta con esos datos');
    }
    throw new AccountError(`el gateway respondio ${response.status}`);
  }
  return response.json();
}

/**
 * crea una cuenta nueva.
 *
 * La contraseña se convierte en llave maestra, hash de acceso y llave envuelta
 * ANTES de tocar la red. Al servidor va lo que no abre nada. Devuelve la clave
 * de recuperacion, que se muestra una vez.
 */
export async function registerAccount(
  deps: AccountClientDeps,
  email: string,
  password: string,
  params?: Argon2Params,
): Promise<{ session: AccountSession; recoveryKey: string }> {
  assertPassword(password);

  const { registration, account, recoveryKey } = await createAccount(password, params);
  const raw = await post(deps, '/api/vault/register', { email: normalizeEmail(email), ...registration });

  const parsed = vaultSessionResponseSchema.safeParse(raw);
  if (!parsed.success) throw new AccountError('el gateway respondio algo inesperado al registrar');

  return {
    session: {
      sessionToken: parsed.data.sessionToken,
      expiresAt: parsed.data.expiresAt,
      vaultId: parsed.data.vaultId,
      masterKey: account.masterKey,
    },
    recoveryKey,
  };
}

/**
 * inicia sesion en dos pasos.
 *
 *   1. pide sal, coste y llave envuelta;
 *   2. deriva la maestra en local, calcula el hash de acceso y lo prueba.
 *
 * La contraseña nunca sale. Si es incorrecta, la apertura del sobre en local
 * falla antes de llegar al segundo paso, asi que el servidor ni se entera del
 * intento fallido salvo por el rate limit.
 */
export async function loginAccount(
  deps: AccountClientDeps,
  email: string,
  password: string,
): Promise<AccountSession> {
  const normalized = normalizeEmail(email);

  const startRaw = await post(deps, '/api/vault/login/start', { email: normalized });
  const start = vaultLoginStartResponseSchema.safeParse(startRaw);
  if (!start.success) throw new AccountError('el gateway respondio algo inesperado');

  let account: OpenedAccount;
  try {
    account = await openAccount(password, {
      authSalt: start.data.authSalt,
      argon2Params: start.data.argon2Params,
      wrappedMasterKey: start.data.wrappedMasterKey as SealedEnvelope,
    });
  } catch {
    // incluye el caso del señuelo: un correo inexistente da datos que no abren
    throw new AccountError('correo o contraseña incorrectos');
  }

  const raw = await post(deps, '/api/vault/login/finish', {
    email: normalized,
    authHash: account.authHash,
  });
  const parsed = vaultSessionResponseSchema.safeParse(raw);
  if (!parsed.success) throw new AccountError('el gateway respondio algo inesperado');

  // el cliente comprueba que le dieron SU cuenta: si el vaultId no cuadra con
  // el que derivo, algo va mal y no se sigue
  if (parsed.data.vaultId !== account.vaultId) {
    throw new AccountError('la cuenta recibida no coincide con la contraseña');
  }

  return {
    sessionToken: parsed.data.sessionToken,
    expiresAt: parsed.data.expiresAt,
    vaultId: account.vaultId,
    masterKey: account.masterKey,
  };
}

/** cierra la sesion en el servidor. no lanza si ya no era valida */
export async function logoutAccount(deps: AccountClientDeps, sessionToken: string): Promise<void> {
  const doFetch = deps.fetchImpl ?? fetch;
  await doFetch(`${deps.gatewayUrl.replace(/\/+$/, '')}/api/vault/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  }).catch(() => undefined);
}

/**
 * cambia la contraseña de la cuenta.
 *
 * Reenvuelve la maestra en local y envia la envoltura nueva mas la prueba de la
 * actual. El servidor no recifra la boveda: solo sustituye credenciales.
 */
export async function changeAccountPassword(
  deps: AccountClientDeps,
  sessionToken: string,
  masterKey: Uint8Array,
  currentAuthHash: string,
  newPassword: string,
  params?: Argon2Params,
): Promise<void> {
  assertPassword(newPassword);
  const renewed = await rewrapAccountPassword(masterKey, newPassword, params);

  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(`${deps.gatewayUrl.replace(/\/+$/, '')}/api/vault/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ currentAuthHash, ...renewed }),
  });
  if (!response.ok) {
    if (response.status === 403) throw new AccountError('la contraseña actual no es correcta');
    throw new AccountError(`el gateway respondio ${response.status}`);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertPassword(password: string): void {
  if (password.length < VAULT_MIN_PASSWORD_LENGTH) {
    throw new AccountError(
      `la contraseña debe tener al menos ${VAULT_MIN_PASSWORD_LENGTH} caracteres`,
      'una frase de varias palabras es mas facil de recordar y mas dificil de adivinar',
    );
  }
}
