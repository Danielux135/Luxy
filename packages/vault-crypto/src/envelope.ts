// sobre cifrado: la unica forma en que un dato sale de la boveda.
//
// AES-256-GCM con nonce de 96 bits y datos autenticados asociados. GCM es
// cifrado autenticado: si alguien toca un solo bit del texto cifrado, del nonce
// o de los AAD, el descifrado FALLA en vez de devolver basura. De ahi que todo
// el paquete se apoye en el.
import { VaultCryptoError, concat, fromBase64Url, randomBytes, toBase64Url, utf8 } from './bytes.js';

/**
 * version del formato de sobre.
 *
 * viaja dentro de los AAD, asi que no se puede rebajar sin romper la etiqueta:
 * un atacante no puede convencer a una version futura de que un sobre es de la
 * version 1 para que aplique reglas mas debiles.
 */
export const ENVELOPE_VERSION = 1;

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
/** etiqueta de autenticacion de GCM, en bits, como la pide WebCrypto */
const TAG_BITS = 128;

/**
 * un sobre sellado.
 *
 * `purpose` no es decorativo: entra en los AAD, de modo que un sobre de un
 * dominio no se puede reutilizar en otro aunque compartan la llave. Sin esto,
 * el ciphertext de una miniatura valdria como el de un mensaje.
 */
export interface SealedEnvelope {
  version: number;
  purpose: string;
  nonce: string;
  ciphertext: string;
}

const MAX_PURPOSE_LENGTH = 64;

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) {
    throw new VaultCryptoError(`la llave debe tener ${KEY_BYTES} bytes, tiene ${key.length}`);
  }
}

function assertPurpose(purpose: string): void {
  if (purpose.length === 0 || purpose.length > MAX_PURPOSE_LENGTH) {
    throw new VaultCryptoError('el proposito del sobre esta vacio o es demasiado largo');
  }
  if (!/^[a-z0-9.:-]+$/.test(purpose)) {
    throw new VaultCryptoError('el proposito solo admite minusculas, digitos y ".:-"');
  }
}

/**
 * los datos autenticados asociados.
 *
 * no se cifran, pero quedan cubiertos por la etiqueta de GCM. Aqui va todo lo
 * que debe ser imposible de cambiar sin invalidar el sobre.
 */
function associatedData(version: number, purpose: string): Uint8Array {
  return concat(utf8(`luxy.vault.v${version}.`), utf8(purpose));
}

/**
 * los tipos de WebCrypto se deducen de la propia API en vez de declarar `lib:
 * ["DOM"]`. Añadir DOM traeria `window` y `document` a un paquete que no puede
 * tocarlos, y el objetivo aqui es justo lo contrario: que no compile si alguien
 * lo intenta.
 */
type SubtleKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
type SubtleKeyUsage = Parameters<typeof crypto.subtle.importKey>[4][number];

async function importKey(key: Uint8Array, usage: SubtleKeyUsage): Promise<SubtleKey> {
  assertKey(key);
  return crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [usage]);
}

/** cifra `plaintext` y devuelve un sobre transportable */
export async function seal(
  key: Uint8Array,
  purpose: string,
  plaintext: Uint8Array,
): Promise<SealedEnvelope> {
  assertPurpose(purpose);
  const cryptoKey = await importKey(key, 'encrypt');
  // nonce aleatorio por sobre. con 96 bits y llaves que se rotan, la
  // probabilidad de repetirlo es despreciable; repetirlo con la MISMA llave
  // seria catastrofico en GCM, por eso nunca se deriva de un contador aqui.
  const nonce = randomBytes(NONCE_BYTES);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: associatedData(ENVELOPE_VERSION, purpose),
      tagLength: TAG_BITS,
    },
    cryptoKey,
    plaintext,
  );

  return {
    version: ENVELOPE_VERSION,
    purpose,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

/**
 * descifra un sobre.
 *
 * falla si la llave no corresponde, si el proposito no es el esperado, si la
 * version es desconocida o si cualquier byte fue alterado. No distingue entre
 * esos casos en el mensaje: hacerlo daria informacion a quien pruebe llaves.
 */
export async function open(
  key: Uint8Array,
  purpose: string,
  envelope: SealedEnvelope,
): Promise<Uint8Array> {
  assertPurpose(purpose);

  if (envelope.version !== ENVELOPE_VERSION) {
    throw new VaultCryptoError(
      `formato de sobre desconocido (version ${envelope.version})`,
      'este dato lo creo una version mas nueva de Luxy. Actualiza antes de abrirlo.',
    );
  }
  // se comprueba antes de descifrar para no gastar la operacion, pero la
  // proteccion real es que el proposito va en los AAD: aunque alguien reescriba
  // este campo, la etiqueta de GCM no cuadrara.
  if (envelope.purpose !== purpose) {
    throw new VaultCryptoError('no se pudo descifrar el dato');
  }

  const cryptoKey = await importKey(key, 'decrypt');
  const nonce = fromBase64Url(envelope.nonce);
  if (nonce.length !== NONCE_BYTES) throw new VaultCryptoError('no se pudo descifrar el dato');

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: associatedData(envelope.version, envelope.purpose),
        tagLength: TAG_BITS,
      },
      cryptoKey,
      fromBase64Url(envelope.ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch {
    // el error original de WebCrypto no dice nada util y varia por plataforma
    throw new VaultCryptoError(
      'no se pudo descifrar el dato',
      'la llave no corresponde o el dato fue alterado',
    );
  }
}

/** azucar para el caso mas comun: sellar y abrir texto */
export async function sealText(
  key: Uint8Array,
  purpose: string,
  text: string,
): Promise<SealedEnvelope> {
  return seal(key, purpose, utf8(text));
}

export async function openText(
  key: Uint8Array,
  purpose: string,
  envelope: SealedEnvelope,
): Promise<string> {
  return new TextDecoder().decode(await open(key, purpose, envelope));
}
