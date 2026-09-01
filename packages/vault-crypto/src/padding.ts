// relleno para que el tamaño cifrado no revele el tamaño del original.
//
// AES-GCM no rellena: el texto cifrado mide lo mismo que el contenido. Eso
// significa que quien tenga el archivo puede reconstruir la FORMA de una
// conversacion — pregunta corta, respuesta larga, silencio, respuesta muy larga
// — sin descifrar ni una palabra. En un historial de meses, esa forma dice
// bastante.
//
// El relleno redondea al alza en bloques, asi que dos mensajes de 30 y de 200
// caracteres ocupan exactamente lo mismo.
//
// Formato del contenido rellenado:
//
//     [ 'LXP1' : 4 bytes ][ longitud real : 4 bytes BE ][ datos ][ ceros ]
//
// La marca al principio permite distinguir un contenido rellenado de uno
// anterior al relleno, para que lo guardado antes se siga abriendo.
import { VaultCryptoError, concat } from './bytes.js';

/**
 * tamaño de bloque, en bytes.
 *
 * 256 esconde la diferencia entre un "hola" y un parrafo, que es donde mas se
 * nota. Subirlo escondería mas, a costa de espacio en cada mensaje; bajarlo
 * dejaria de servir para los mensajes cortos, que son la mayoria.
 */
export const PADDING_BLOCK = 256;

const MARKER = new Uint8Array([0x4c, 0x58, 0x50, 0x31]); // 'LXP1'
const HEADER_BYTES = MARKER.length + 4;

/** tamaño al que se redondea un contenido de `length` bytes */
export function paddedSize(length: number): number {
  const total = HEADER_BYTES + length;
  return Math.ceil(total / PADDING_BLOCK) * PADDING_BLOCK;
}

/** añade el relleno. el resultado siempre mide un multiplo del bloque */
export function pad(plaintext: Uint8Array): Uint8Array {
  const size = paddedSize(plaintext.length);
  const result = new Uint8Array(size);
  result.set(MARKER, 0);
  // longitud real en big-endian, para poder recortar al abrir
  new DataView(result.buffer).setUint32(MARKER.length, plaintext.length, false);
  result.set(plaintext, HEADER_BYTES);
  return result;
}

function hasMarker(data: Uint8Array): boolean {
  if (data.length < HEADER_BYTES) return false;
  return MARKER.every((byte, index) => data[index] === byte);
}

/**
 * quita el relleno.
 *
 * si el contenido no lleva la marca se devuelve tal cual: es material guardado
 * antes de que existiera el relleno, y tiene que seguir abriendose.
 */
export function unpad(data: Uint8Array): Uint8Array {
  if (!hasMarker(data)) return data;

  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    MARKER.length,
    false,
  );
  if (HEADER_BYTES + length > data.length) {
    // la etiqueta de GCM ya garantiza que nadie altero esto; si aun asi no
    // cuadra, es mejor fallar que devolver bytes de relleno como contenido
    throw new VaultCryptoError('el contenido descifrado tiene un relleno incoherente');
  }
  return data.slice(HEADER_BYTES, HEADER_BYTES + length);
}

/** util para las pruebas y para los avisos de cuota */
export function paddingOverhead(length: number): number {
  return paddedSize(length) - length;
}

export { concat };
