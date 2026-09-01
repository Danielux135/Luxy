// utilidades de bytes de la boveda.
//
// no hay nada criptografico aqui, pero si dos reglas que el resto del paquete
// da por hechas: todo lo que viaja como texto va en base64url sin relleno, y
// todo material sensible se borra en cuanto deja de hacer falta.

/** error de cualquier operacion de la boveda. nunca lleva material secreto */
export class VaultCryptoError extends Error {
  constructor(
    message: string,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = 'VaultCryptoError';
  }
}

/**
 * tope de `crypto.getRandomValues` por llamada, fijado por la especificacion.
 * pedir mas lanza QuotaExceededError, asi que se rellena por trozos.
 */
const RANDOM_CHUNK = 65_536;

/** bytes aleatorios del generador del sistema */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new VaultCryptoError('la longitud debe ser un entero positivo');
  }
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += RANDOM_CHUNK) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + RANDOM_CHUNK, length)));
  }
  return bytes;
}

/**
 * sobreescribe un buffer con ceros.
 *
 * no es una garantia: el recolector de basura de V8 puede haber copiado el
 * buffer antes. Reduce la ventana en la que una llave sigue legible en un
 * volcado de memoria, que es lo unico que se puede prometer desde JavaScript.
 */
export function wipe(...buffers: (Uint8Array | null | undefined)[]): void {
  for (const buffer of buffers) {
    if (buffer instanceof Uint8Array) buffer.fill(0);
  }
}

/** comparacion en tiempo constante: no filtra en que byte difieren */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // la longitud si se filtra, y es aceptable: nunca es secreta en este paquete
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // por trozos, porque String.fromCharCode(...bytes) desborda la pila con
  // entradas grandes y por aqui pueden pasar bloques de imagen o video
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new VaultCryptoError('el valor no esta en base64url');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** concatena varios buffers en uno nuevo */
export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
