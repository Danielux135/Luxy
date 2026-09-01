// la llave maestra y las envolturas que la abren.
//
// La contraseña NO cifra los datos. Cifra una llave maestra aleatoria, y es esa
// la que cifra todo lo demas. La diferencia importa por dos motivos:
//
//   1. cambiar la contraseña solo reescribe una envoltura de 60 bytes, en vez
//      de recifrar toda la boveda;
//   2. puede haber VARIAS envolturas de la misma llave maestra, cada una con su
//      forma de abrirse: contraseña, clave de recuperacion o el almacen del
//      sistema operativo. Todas dan la misma llave, ninguna revela a las otras.
import { VaultCryptoError, fromBase64Url, randomBytes, toBase64Url, wipe } from './bytes.js';
import { KEY_BYTES, type SealedEnvelope, open, seal } from './envelope.js';
import {
  ARGON2_PARAMS,
  SALT_BYTES,
  type Argon2Params,
  assertArgon2Params,
  deriveKeyEncryptionKey,
} from './kdf.js';

/** como se abre una envoltura concreta */
export type WrapMethod = 'password' | 'recovery' | 'device';

/**
 * una envoltura de la llave maestra.
 *
 * se guarda en claro: no contiene la llave, sino la llave cifrada. Los
 * parametros de Argon2 viajan con ella a proposito, para que una boveda creada
 * hoy se siga abriendo si mañana se sube el coste por defecto.
 */
export interface KeyWrap {
  method: WrapMethod;
  /** sal de Argon2id en base64url. ausente en 'device': ahi no hay contraseña */
  salt: string | null;
  params: Argon2Params | null;
  envelope: SealedEnvelope;
  createdAt: string;
}

const WRAP_PURPOSE: Record<WrapMethod, string> = {
  password: 'vault.masterkey.password',
  recovery: 'vault.masterkey.recovery',
  device: 'vault.masterkey.device',
};

/** genera una llave maestra nueva. es lo unico que cifra de verdad */
export function generateMasterKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

/**
 * clave de recuperacion legible: 8 grupos de 4 caracteres.
 *
 * el alfabeto excluye I, L, O, U, 0 y 1 para que no se confundan al copiarla a
 * mano de un papel, que es exactamente para lo que sirve.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const RECOVERY_GROUPS = 8;
const RECOVERY_GROUP_SIZE = 4;

export function generateRecoveryKey(): string {
  const total = RECOVERY_GROUPS * RECOVERY_GROUP_SIZE;
  const groups: string[] = [];
  let current = '';

  // rechazo de modulo: se descartan los bytes que no caen en un multiplo exacto
  // del alfabeto, para que las 30 letras sean equiprobables de verdad
  const limit = Math.floor(256 / RECOVERY_ALPHABET.length) * RECOVERY_ALPHABET.length;
  while (groups.length * RECOVERY_GROUP_SIZE + current.length < total) {
    for (const byte of randomBytes(32)) {
      if (byte >= limit) continue;
      current += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
      if (current.length === RECOVERY_GROUP_SIZE) {
        groups.push(current);
        current = '';
      }
      if (groups.length === RECOVERY_GROUPS) break;
    }
  }
  return groups.join('-');
}

/** normaliza lo que teclee el usuario: mayusculas y sin guiones ni espacios */
export function normalizeRecoveryKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidRecoveryKey(value: string): boolean {
  const normalized = normalizeRecoveryKey(value);
  if (normalized.length !== RECOVERY_GROUPS * RECOVERY_GROUP_SIZE) return false;
  return [...normalized].every((character) => RECOVERY_ALPHABET.includes(character));
}

/**
 * envuelve la llave maestra con una contraseña o una clave de recuperacion.
 *
 * la llave maestra entra por parametro y NO se borra aqui: quien la creo decide
 * cuando dejar de usarla, porque normalmente hace falta para varias envolturas
 * seguidas.
 */
export async function wrapMasterKey(
  masterKey: Uint8Array,
  secret: string,
  method: Exclude<WrapMethod, 'device'>,
  params: Argon2Params = ARGON2_PARAMS,
  onProgress?: (fraction: number) => void,
): Promise<KeyWrap> {
  if (masterKey.length !== KEY_BYTES) {
    throw new VaultCryptoError(`la llave maestra debe tener ${KEY_BYTES} bytes`);
  }
  assertArgon2Params(params);

  const normalized = method === 'recovery' ? normalizeRecoveryKey(secret) : secret;
  if (method === 'recovery' && !isValidRecoveryKey(normalized)) {
    throw new VaultCryptoError('la clave de recuperacion no tiene el formato esperado');
  }

  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKeyEncryptionKey(normalized, salt, params, onProgress);
  try {
    return {
      method,
      salt: toBase64Url(salt),
      params: { ...params },
      envelope: await seal(kek, WRAP_PURPOSE[method], masterKey),
      createdAt: new Date().toISOString(),
    };
  } finally {
    // la KEK ya no hace falta: solo servia para este sobre
    wipe(kek);
  }
}

/**
 * abre una envoltura y devuelve la llave maestra.
 *
 * quien llama es responsable de borrarla con `wipe()` al bloquear la boveda.
 */
export async function unwrapMasterKey(
  wrap: KeyWrap,
  secret: string,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  if (wrap.method === 'device') {
    throw new VaultCryptoError(
      'esta envoltura la abre el sistema operativo, no una contraseña',
      'usa la envoltura de contraseña o la clave de recuperacion',
    );
  }
  if (wrap.salt === null || wrap.params === null) {
    throw new VaultCryptoError('la envoltura guardada esta incompleta');
  }
  assertArgon2Params(wrap.params);

  const salt = fromBase64Url(wrap.salt);
  if (salt.length !== SALT_BYTES) throw new VaultCryptoError('la envoltura guardada esta incompleta');

  const normalized = wrap.method === 'recovery' ? normalizeRecoveryKey(secret) : secret;
  // se derivan los parametros GUARDADOS, no los actuales por defecto
  const kek = await deriveKeyEncryptionKey(normalized, salt, wrap.params, onProgress);
  try {
    const masterKey = await open(kek, WRAP_PURPOSE[wrap.method], wrap.envelope);
    if (masterKey.length !== KEY_BYTES) {
      throw new VaultCryptoError('no se pudo descifrar el dato');
    }
    return masterKey;
  } finally {
    wipe(kek);
  }
}

/**
 * envuelve la llave maestra para el almacen del sistema operativo.
 *
 * aqui no hay Argon2: la llave que protege esta envoltura ya es aleatoria y la
 * custodia Windows (DPAPI, atado a la cuenta). Es la envoltura del "recordar en
 * este equipo", y por eso es la unica que se puede borrar sin perder nada.
 */
export async function wrapMasterKeyForDevice(
  masterKey: Uint8Array,
  deviceKey: Uint8Array,
): Promise<KeyWrap> {
  return {
    method: 'device',
    salt: null,
    params: null,
    envelope: await seal(deviceKey, WRAP_PURPOSE.device, masterKey),
    createdAt: new Date().toISOString(),
  };
}

export async function unwrapMasterKeyFromDevice(
  wrap: KeyWrap,
  deviceKey: Uint8Array,
): Promise<Uint8Array> {
  if (wrap.method !== 'device') {
    throw new VaultCryptoError('esta envoltura no es la de este equipo');
  }
  const masterKey = await open(deviceKey, WRAP_PURPOSE.device, wrap.envelope);
  if (masterKey.length !== KEY_BYTES) throw new VaultCryptoError('no se pudo descifrar el dato');
  return masterKey;
}

/**
 * cambia la contraseña sin recifrar la boveda.
 *
 * abre con la antigua y vuelve a envolver con la nueva. Las demas envolturas
 * (recuperacion, equipo) no se tocan y siguen abriendo la misma llave maestra.
 */
export async function rewrapWithNewPassword(
  wrap: KeyWrap,
  currentPassword: string,
  newPassword: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<KeyWrap> {
  const masterKey = await unwrapMasterKey(wrap, currentPassword);
  try {
    return await wrapMasterKey(masterKey, newPassword, 'password', params);
  } finally {
    wipe(masterKey);
  }
}
