// cuenta de bóveda: registro y apertura, sin que la contraseña llegue al servidor.
//
// Compone piezas que ya existen (llave maestra, envoltura por contraseña, hash
// de acceso, identificador de bóveda) en las operaciones que el resto de Luxy
// necesita: crear una cuenta, abrirla con la contraseña y abrirla con la clave
// de recuperación.
//
// La regla que ordena todo esto: al servidor viajan el hash de acceso, la sal,
// el coste de Argon2, el identificador de bóveda y la llave maestra CIFRADA.
// Nunca la contraseña, nunca la clave de recuperación, nunca la llave maestra
// en claro. El servidor puede verificar quién eres y guardar tu bóveda; no
// puede abrirla.
//
// La llave maestra se envuelve DOS veces, con dos secretos independientes y
// dos propósitos distintos: la contraseña y la clave de recuperación. Son la
// misma llave por dos puertas, no dos bóvedas. Por eso olvidar la contraseña
// no pierde nada y por eso la clave de recuperación abre también desde un
// ordenador nuevo (`F9.19`).
import { fromBase64Url, toBase64Url, wipe } from './bytes.js';
import {
  ARGON2_PARAMS,
  RECOVERY_ARGON2_PARAMS,
  SALT_BYTES,
  deriveAuthHash,
  deriveVaultId,
  type Argon2Params,
} from './kdf.js';
import { deriveKeyEncryptionKey } from './kdf.js';
import { generateMasterKey, generateRecoveryKey, isValidRecoveryKey, normalizeRecoveryKey } from './master-key.js';
import { KEY_BYTES, type SealedEnvelope, open, seal } from './envelope.js';
import { randomBytes } from './bytes.js';
import { VaultCryptoError } from './bytes.js';

const WRAP_PURPOSE = 'vault.account.masterkey';

/**
 * propósito distinto para la envoltura de recuperación.
 *
 * No es cosmética: el propósito viaja autenticado (`D-041`), así que un sobre
 * de recuperación no se puede hacer pasar por uno de contraseña ni al revés,
 * aunque alguien los intercambie en la base de datos.
 */
const RECOVERY_WRAP_PURPOSE = 'vault.account.recovery';

/** la misma llave maestra, por la puerta de la clave de recuperación */
export interface AccountRecovery {
  authSalt: string;
  argon2Params: Argon2Params;
  authHash: string;
  wrappedMasterKey: SealedEnvelope;
}

/** lo que el cliente envia al servidor al registrarse. NADA de esto abre nada */
export interface AccountRegistration {
  authSalt: string;
  argon2Params: Argon2Params;
  authHash: string;
  wrappedMasterKey: SealedEnvelope;
  vaultId: string;
  recovery: AccountRecovery;
}

/** la puerta de la contraseña, sin el identificador ni la de recuperacion */
export type AccountPasswordCredentials = Omit<AccountRegistration, 'vaultId' | 'recovery'>;

/** lo que queda tras crear o abrir una cuenta, para usar la boveda */
export interface OpenedAccount {
  /** llave maestra en claro. quien la reciba la borra con wipe() al bloquear */
  masterKey: Uint8Array;
  vaultId: string;
  authHash: string;
}

/**
 * construye el registro de una cuenta para una llave maestra que YA existe.
 *
 * Es la pieza que permite dos cosas con el mismo codigo: crear una cuenta nueva
 * (llave recien generada) y vincular a una cuenta una boveda que ya existe en
 * este equipo, sin recifrar su contenido. La llave maestra entra y no sale:
 * lo que se devuelve es lo que el servidor puede guardar sin poder abrirlo.
 */
export async function registrationForMasterKey(
  masterKey: Uint8Array,
  password: string,
  recoveryKey: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<AccountRegistration> {
  return {
    ...(await passwordCredentialsForMasterKey(masterKey, password, params)),
    vaultId: deriveVaultId(masterKey),
    recovery: await recoveryForMasterKey(masterKey, recoveryKey),
  };
}

/**
 * la puerta de la contraseña, sola.
 *
 * La usa cambiar la contraseña: sustituye esas cuatro cosas y **no toca la
 * copia de recuperación**, que sigue abriendo con la clave de siempre. Es lo
 * que hace que cambiar la contraseña no invalide el papel que el usuario
 * guardó en un cajón.
 */
export async function passwordCredentialsForMasterKey(
  masterKey: Uint8Array,
  password: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<AccountPasswordCredentials> {
  if (masterKey.length !== KEY_BYTES) throw new VaultCryptoError('la llave maestra no es valida');
  if (password.length === 0) throw new VaultCryptoError('la contraseña esta vacia');

  const authSalt = randomBytes(SALT_BYTES);
  let kek: Uint8Array | null = null;
  try {
    kek = await deriveKeyEncryptionKey(password, authSalt, params);
    return {
      authSalt: toBase64Url(authSalt),
      argon2Params: { ...params },
      authHash: await deriveAuthHash(masterKey, password, params),
      wrappedMasterKey: await seal(kek, WRAP_PURPOSE, masterKey),
    };
  } finally {
    wipe(kek);
  }
}

/**
 * envuelve la llave maestra con la clave de recuperación, para el servidor.
 *
 * El coste de Argon2id es el bajo (`RECOVERY_ARGON2_PARAMS`) porque la clave de
 * recuperación no es una contraseña: son ~157 bits al azar y no hay diccionario
 * que probar. Ver `D-049`.
 */
export async function recoveryForMasterKey(
  masterKey: Uint8Array,
  recoveryKey: string,
  params: Argon2Params = RECOVERY_ARGON2_PARAMS,
): Promise<AccountRecovery> {
  if (masterKey.length !== KEY_BYTES) throw new VaultCryptoError('la llave maestra no es valida');
  const normalized = normalizeRecoveryKey(recoveryKey);
  if (!isValidRecoveryKey(normalized)) {
    throw new VaultCryptoError('la clave de recuperacion no tiene el formato esperado');
  }

  const authSalt = randomBytes(SALT_BYTES);
  let kek: Uint8Array | null = null;
  try {
    kek = await deriveKeyEncryptionKey(normalized, authSalt, params);
    return {
      authSalt: toBase64Url(authSalt),
      argon2Params: { ...params },
      authHash: await deriveAuthHash(masterKey, normalized, params),
      wrappedMasterKey: await seal(kek, RECOVERY_WRAP_PURPOSE, masterKey),
    };
  } finally {
    wipe(kek);
  }
}

/**
 * crea una cuenta a partir de una contraseña.
 *
 * Genera una llave maestra aleatoria, la envuelve con la contraseña y con una
 * clave de recuperación nueva, y produce el hash de acceso y el identificador
 * de bóveda. Devuelve por separado lo que va al servidor (`registration`), lo
 * que se usa localmente (`account`) y la clave de recuperación, que se muestra
 * una vez y no se guarda.
 */
export async function createAccount(
  password: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<{
  registration: AccountRegistration;
  account: OpenedAccount;
  recoveryKey: string;
}> {
  if (password.length === 0) throw new VaultCryptoError('la contraseña esta vacia');

  const masterKey = generateMasterKey();
  const recoveryKey = generateRecoveryKey();
  try {
    const registration = await registrationForMasterKey(masterKey, password, recoveryKey, params);
    return {
      registration,
      // la maestra se devuelve para dejar la boveda abierta tras registrarse
      account: { masterKey, vaultId: registration.vaultId, authHash: registration.authHash },
      recoveryKey,
    };
  } catch (error) {
    wipe(masterKey);
    throw error;
  }
}

/**
 * abre una cuenta con la contraseña y la bóveda envuelta que devuelve el
 * servidor.
 *
 * El servidor entrega la sal, el coste y la llave envuelta; el cliente deriva
 * la KEK, abre la maestra y calcula el hash de acceso para probarlo. Si la
 * contraseña es incorrecta, la apertura del sobre falla por la etiqueta GCM: no
 * hace falta —ni conviene— distinguir «contraseña mala» de «datos alterados».
 */
export async function openAccount(
  password: string,
  stored: {
    authSalt: string;
    argon2Params: Argon2Params;
    wrappedMasterKey: SealedEnvelope;
  },
): Promise<OpenedAccount> {
  return openWith(password, stored, WRAP_PURPOSE);
}

/**
 * abre una cuenta con la clave de recuperación.
 *
 * Es la misma operación por la otra puerta, y es lo que hace que olvidar la
 * contraseña no pierda la bóveda **ni siquiera desde un ordenador nuevo**: la
 * copia de recuperación vive en el servidor, cerrada con una clave que el
 * servidor tampoco tiene.
 *
 * Acepta la clave escrita de forma descuidada —minúsculas, sin guiones— porque
 * se copia a mano de un papel.
 */
export async function openAccountWithRecoveryKey(
  recoveryKey: string,
  stored: {
    authSalt: string;
    argon2Params: Argon2Params;
    wrappedMasterKey: SealedEnvelope;
  },
): Promise<OpenedAccount> {
  const normalized = normalizeRecoveryKey(recoveryKey);
  if (!isValidRecoveryKey(normalized)) {
    throw new VaultCryptoError('la clave de recuperacion no tiene el formato esperado');
  }
  return openWith(normalized, stored, RECOVERY_WRAP_PURPOSE);
}

async function openWith(
  secret: string,
  stored: {
    authSalt: string;
    argon2Params: Argon2Params;
    wrappedMasterKey: SealedEnvelope;
  },
  purpose: string,
): Promise<OpenedAccount> {
  const authSalt = fromBase64Url(stored.authSalt);
  if (authSalt.length !== SALT_BYTES) throw new VaultCryptoError('la sal guardada no es valida');

  let kek: Uint8Array | null = null;
  try {
    kek = await deriveKeyEncryptionKey(secret, authSalt, stored.argon2Params);
    const masterKey = await open(kek, purpose, stored.wrappedMasterKey);
    if (masterKey.length !== KEY_BYTES) throw new VaultCryptoError('la boveda guardada no es valida');

    return {
      masterKey,
      vaultId: deriveVaultId(masterKey),
      authHash: await deriveAuthHash(masterKey, secret, stored.argon2Params),
    };
  } finally {
    wipe(kek);
  }
}
