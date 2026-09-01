// sobre binario, para imagenes y videos.
//
// El sobre de envelope.ts viaja como JSON con base64, que infla un 33%. Da
// igual en un mensaje de texto; en un video de 50 MB son 17 MB de mas en disco,
// en la subida y en la descarga.
//
// Aqui el resultado son bytes crudos:
//
//     [ version : 1 byte ][ nonce : 12 bytes ][ ciphertext + etiqueta GCM ]
//
// El proposito NO se guarda en el blob. Lo aporta quien abre y entra en los
// datos autenticados, asi que no hay ningun campo que reetiquetar: si no
// coincide, el descifrado falla. Es mas estrecho que el sobre JSON, no menos.
import { VaultCryptoError, concat, randomBytes, utf8 } from './bytes.js';
import { ENVELOPE_VERSION, KEY_BYTES, NONCE_BYTES } from './envelope.js';

const TAG_BITS = 128;
/** version (1) + nonce (12); el resto es texto cifrado con su etiqueta */
export const BLOB_HEADER_BYTES = 1 + NONCE_BYTES;

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) {
    throw new VaultCryptoError(`la llave debe tener ${KEY_BYTES} bytes, tiene ${key.length}`);
  }
}

/**
 * mismos datos autenticados que el sobre JSON.
 *
 * comparten funcion a proposito: los dos formatos son dos codificaciones del
 * mismo esquema, no dos esquemas distintos que puedan divergir.
 */
function associatedData(version: number, purpose: string): Uint8Array {
  return concat(utf8(`luxy.vault.v${version}.`), utf8(purpose));
}

type SubtleKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
type SubtleKeyUsage = Parameters<typeof crypto.subtle.importKey>[4][number];

async function importKey(key: Uint8Array, usage: SubtleKeyUsage): Promise<SubtleKey> {
  assertKey(key);
  return crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [usage]);
}

function assertPurpose(purpose: string): void {
  if (purpose.length === 0 || purpose.length > 64 || !/^[a-z0-9.:-]+$/.test(purpose)) {
    throw new VaultCryptoError('el proposito del blob no es valido');
  }
}

/** cifra bytes y devuelve un blob autocontenido */
export async function sealBlob(
  key: Uint8Array,
  purpose: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  assertPurpose(purpose);
  const cryptoKey = await importKey(key, 'encrypt');
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

  return concat(new Uint8Array([ENVELOPE_VERSION]), nonce, new Uint8Array(ciphertext));
}

/** descifra un blob. falla si la llave, el proposito o los bytes no cuadran */
export async function openBlob(
  key: Uint8Array,
  purpose: string,
  blob: Uint8Array,
): Promise<Uint8Array> {
  assertPurpose(purpose);
  if (blob.length <= BLOB_HEADER_BYTES) {
    throw new VaultCryptoError('el archivo cifrado esta incompleto');
  }

  const version = blob[0]!;
  if (version !== ENVELOPE_VERSION) {
    throw new VaultCryptoError(
      `formato de archivo desconocido (version ${version})`,
      'este archivo lo creo una version mas nueva de Luxy. Actualiza antes de abrirlo.',
    );
  }

  const cryptoKey = await importKey(key, 'decrypt');
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: blob.subarray(1, BLOB_HEADER_BYTES),
        additionalData: associatedData(version, purpose),
        tagLength: TAG_BITS,
      },
      cryptoKey,
      blob.subarray(BLOB_HEADER_BYTES),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new VaultCryptoError(
      'no se pudo descifrar el archivo',
      'la llave no corresponde o el archivo fue alterado',
    );
  }
}

/**
 * tamaño que ocupara un contenido de `byteSize` bytes una vez cifrado.
 *
 * sirve para cuotas y avisos antes de subir, sin tener que cifrar primero.
 */
export function sealedBlobSize(byteSize: number): number {
  // cabecera + los mismos bytes (GCM no rellena) + la etiqueta de 16
  return BLOB_HEADER_BYTES + byteSize + TAG_BITS / 8;
}
