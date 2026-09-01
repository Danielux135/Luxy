// cuenta de bóveda: registro y apertura, sin que la contraseña llegue al servidor.
//
// Compone piezas que ya existen (llave maestra, envoltura por contraseña, hash
// de acceso, identificador de bóveda) en las dos operaciones que el resto de
// Luxy necesita: crear una cuenta y abrirla.
//
// La regla que ordena todo esto: al servidor viajan el hash de acceso, la sal,
// el coste de Argon2, el identificador de bóveda y la llave maestra CIFRADA.
// Nunca la contraseña, nunca la llave maestra en claro. El servidor puede
// verificar quién eres y guardar tu bóveda; no puede abrirla.
import { fromBase64Url, toBase64Url, wipe } from './bytes.js';
import { ARGON2_PARAMS, SALT_BYTES, deriveAuthHash, deriveVaultId, type Argon2Params } from './kdf.js';
import { deriveKeyEncryptionKey } from './kdf.js';
import { generateMasterKey, generateRecoveryKey } from './master-key.js';
import { KEY_BYTES, type SealedEnvelope, open, seal } from './envelope.js';
import { randomBytes } from './bytes.js';
import { VaultCryptoError } from './bytes.js';

const WRAP_PURPOSE = 'vault.account.masterkey';

/** lo que el cliente envia al servidor al registrarse. NADA de esto abre nada */
export interface AccountRegistration {
  authSalt: string;
  argon2Params: Argon2Params;
  authHash: string;
  wrappedMasterKey: SealedEnvelope;
  vaultId: string;
}

/** lo que queda tras crear o abrir una cuenta, para usar la boveda */
export interface OpenedAccount {
  /** llave maestra en claro. quien la reciba la borra con wipe() al bloquear */
  masterKey: Uint8Array;
  vaultId: string;
  authHash: string;
}

/**
 * crea una cuenta a partir de una contraseña.
 *
 * Genera una llave maestra aleatoria, la envuelve con la contraseña, y produce
 * el hash de acceso y el identificador de bóveda. Devuelve por separado lo que
 * va al servidor (`registration`), lo que se usa localmente (`account`) y la
 * clave de recuperación, que se muestra una vez y no se guarda.
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
  const authSalt = randomBytes(SALT_BYTES);
  let kek: Uint8Array | null = null;
  try {
    kek = await deriveKeyEncryptionKey(password, authSalt, params);
    const wrappedMasterKey = await seal(kek, WRAP_PURPOSE, masterKey);
    const authHash = await deriveAuthHash(masterKey, password, params);
    const vaultId = deriveVaultId(masterKey);

    return {
      registration: {
        authSalt: toBase64Url(authSalt),
        argon2Params: { ...params },
        authHash,
        wrappedMasterKey,
        vaultId,
      },
      // la maestra se devuelve para dejar la boveda abierta tras registrarse
      account: { masterKey, vaultId, authHash },
      recoveryKey: generateRecoveryKey(),
    };
  } catch (error) {
    wipe(masterKey);
    throw error;
  } finally {
    wipe(kek);
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
  const authSalt = fromBase64Url(stored.authSalt);
  if (authSalt.length !== SALT_BYTES) throw new VaultCryptoError('la sal guardada no es valida');

  let kek: Uint8Array | null = null;
  try {
    kek = await deriveKeyEncryptionKey(password, authSalt, stored.argon2Params);
    const masterKey = await open(kek, WRAP_PURPOSE, stored.wrappedMasterKey);
    if (masterKey.length !== KEY_BYTES) throw new VaultCryptoError('la boveda guardada no es valida');

    return {
      masterKey,
      vaultId: deriveVaultId(masterKey),
      authHash: await deriveAuthHash(masterKey, password, stored.argon2Params),
    };
  } finally {
    wipe(kek);
  }
}

/**
 * cambia la contraseña sin recifrar la boveda.
 *
 * Vuelve a envolver la MISMA llave maestra con la contraseña nueva y recalcula
 * el hash de acceso. La boveda en el servidor no se toca: sus registros siguen
 * cifrados con subclaves de la maestra, que no cambia. Solo se sustituye la
 * envoltura y el hash.
 */
export async function rewrapAccountPassword(
  masterKey: Uint8Array,
  newPassword: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<Pick<AccountRegistration, 'authSalt' | 'argon2Params' | 'authHash' | 'wrappedMasterKey'>> {
  if (masterKey.length !== KEY_BYTES) throw new VaultCryptoError('la llave maestra no es valida');
  if (newPassword.length === 0) throw new VaultCryptoError('la contraseña esta vacia');

  const authSalt = randomBytes(SALT_BYTES);
  let kek: Uint8Array | null = null;
  try {
    kek = await deriveKeyEncryptionKey(newPassword, authSalt, params);
    return {
      authSalt: toBase64Url(authSalt),
      argon2Params: { ...params },
      authHash: await deriveAuthHash(masterKey, newPassword, params),
      wrappedMasterKey: await seal(kek, WRAP_PURPOSE, masterKey),
    };
  } finally {
    wipe(kek);
  }
}
