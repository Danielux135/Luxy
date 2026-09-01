// envoltura de una llave para otra persona.
//
// Esto es lo que permite compartir UNA conversacion sin entregar la boveda:
// se envuelve solo la subclave de esa conversacion, y solo para la clave
// publica del destinatario. El servidor transporta el resultado sin poder
// abrirlo, porque nunca tiene la parte privada de nadie.
//
// El esquema es el clasico "sealed box": clave efimera + ECDH + HKDF + AES-GCM.
// Efimera significa que cada envoltura usa un par nuevo que se tira acto
// seguido; asi dos envolturas al mismo destinatario no se pueden correlacionar
// y comprometer una no descubre las demas.
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { VaultCryptoError, concat, fromBase64Url, toBase64Url, utf8, wipe } from './bytes.js';
import { KEY_BYTES, type SealedEnvelope, open, seal } from './envelope.js';

export const X25519_KEY_BYTES = 32;

const SHARE_PURPOSE = 'vault.share.key';

export interface RecipientKeyPair {
  /** en base64url. es lo unico que se publica */
  publicKey: string;
  /** en base64url. NUNCA sale del equipo de su dueño */
  secretKey: string;
}

/** una llave envuelta para un destinatario concreto */
export interface SealedForRecipient {
  /** clave publica efimera de quien envuelve, en base64url */
  ephemeralPublicKey: string;
  /** clave publica del destinatario, para detectar un sobre mal dirigido */
  recipientPublicKey: string;
  envelope: SealedEnvelope;
}

export function generateRecipientKeyPair(): RecipientKeyPair {
  const secretKey = x25519.utils.randomSecretKey();
  try {
    return {
      publicKey: toBase64Url(x25519.getPublicKey(secretKey)),
      secretKey: toBase64Url(secretKey),
    };
  } finally {
    wipe(secretKey);
  }
}

function decodeKey(value: string, label: string): Uint8Array {
  const bytes = fromBase64Url(value);
  if (bytes.length !== X25519_KEY_BYTES) {
    throw new VaultCryptoError(`la ${label} no tiene el tamaño esperado`);
  }
  return bytes;
}

/**
 * deriva la llave que cifra el sobre a partir del secreto compartido.
 *
 * las dos claves publicas entran en `info`, no solo el secreto ECDH. Sin eso,
 * un sobre podria reenviarse a otro destinatario cambiando solo la etiqueta:
 * atandolo a ambas partes, el sobre queda ligado a esa pareja concreta.
 */
function deriveSharedKey(
  sharedSecret: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): Uint8Array {
  const info = concat(utf8('luxy.vault.share.v1'), ephemeralPublicKey, recipientPublicKey);
  return hkdf(sha256, sharedSecret, undefined, info, KEY_BYTES);
}

/** envuelve `key` de forma que solo el dueño de `recipientPublicKey` la abra */
export async function sealForRecipient(
  key: Uint8Array,
  recipientPublicKey: string,
): Promise<SealedForRecipient> {
  if (key.length !== KEY_BYTES) {
    throw new VaultCryptoError(`la llave a compartir debe tener ${KEY_BYTES} bytes`);
  }
  const recipient = decodeKey(recipientPublicKey, 'clave publica del destinatario');

  const ephemeralSecret = x25519.utils.randomSecretKey();
  let sharedSecret: Uint8Array | null = null;
  let sharedKey: Uint8Array | null = null;
  try {
    const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
    // getSharedSecret rechaza claves de orden bajo, que forzarian un secreto
    // compartido predecible. No hace falta comprobarlo aparte.
    sharedSecret = x25519.getSharedSecret(ephemeralSecret, recipient);
    sharedKey = deriveSharedKey(sharedSecret, ephemeralPublic, recipient);

    return {
      ephemeralPublicKey: toBase64Url(ephemeralPublic),
      recipientPublicKey: toBase64Url(recipient),
      envelope: await seal(sharedKey, SHARE_PURPOSE, key),
    };
  } finally {
    // el secreto efimero se destruye aqui: es lo que da la garantia de que
    // comprometer este equipo mañana no abre los sobres enviados hoy
    wipe(ephemeralSecret, sharedSecret, sharedKey);
  }
}

/** abre una llave que envolvieron para ti */
export async function openFromSender(
  sealed: SealedForRecipient,
  recipientSecretKey: string,
): Promise<Uint8Array> {
  const secret = decodeKey(recipientSecretKey, 'clave privada');
  const ephemeralPublic = decodeKey(sealed.ephemeralPublicKey, 'clave publica efimera');
  const recipientPublic = decodeKey(sealed.recipientPublicKey, 'clave publica del destinatario');

  let sharedSecret: Uint8Array | null = null;
  let sharedKey: Uint8Array | null = null;
  try {
    // si el sobre iba dirigido a otra persona se detecta aqui, con un mensaje
    // util, en vez de fallar mas tarde como "no se pudo descifrar"
    const own = x25519.getPublicKey(secret);
    if (toBase64Url(own) !== sealed.recipientPublicKey) {
      throw new VaultCryptoError(
        'este dato no fue compartido con esta identidad',
        'comprueba que has iniciado sesion con la cuenta a la que se compartio',
      );
    }

    sharedSecret = x25519.getSharedSecret(secret, ephemeralPublic);
    sharedKey = deriveSharedKey(sharedSecret, ephemeralPublic, recipientPublic);

    const key = await open(sharedKey, SHARE_PURPOSE, sealed.envelope);
    if (key.length !== KEY_BYTES) throw new VaultCryptoError('no se pudo descifrar el dato');
    return key;
  } finally {
    wipe(secret, sharedSecret, sharedKey);
  }
}
