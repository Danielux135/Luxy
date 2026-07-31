// autenticacion de peticiones al gateway mediante firma.
//
// POR QUE NO UN TOKEN PORTADOR (bearer):
//
// Un token robado de una copia de seguridad o de un log bastaria para suplantar
// al movil. Aqui cada peticion se FIRMA con la clave privada del dispositivo,
// que en Android vive en Keystore y no se puede exportar. Copiar un archivo no
// sirve de nada sin el hardware.
//
// POR QUE NO RETO-RESPUESTA:
//
// Un reto exige una vuelta extra y estado en el servidor. Aqui la frescura la da
// la marca de tiempo y la unicidad la da el nonce, que el gateway recuerda solo
// durante la ventana de validez. Menos estado y una vuelta menos.
import { z } from 'zod';
import {
  sign,
  verify,
  toBase64Url,
  fromBase64Url,
  isValidPublicKey,
  type PrivateKey,
  type PublicKey,
} from './identity.js';

/** cuanto se tolera de desfase de reloj entre el movil y el gateway */
export const AUTH_WINDOW_MS = 120_000;

export const signedRequestHeadersSchema = z.object({
  deviceId: z.string().uuid(),
  timestamp: z.number().int().positive(),
  nonce: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  signature: z.string().min(80).max(100).regex(/^[A-Za-z0-9_-]+$/),
});

export type SignedRequestHeaders = z.infer<typeof signedRequestHeadersSchema>;

/**
 * lo que se firma de una peticion.
 *
 * El METODO y la RUTA van dentro a proposito: sin ellos, una firma capturada de
 * un GET inocuo valdria para un POST destructivo en otra ruta. El hash del
 * cuerpo tambien, para que nadie pueda cambiar el contenido conservando la firma.
 */
export function requestParts(
  method: string,
  path: string,
  bodyHash: string,
  headers: Pick<SignedRequestHeaders, 'deviceId' | 'timestamp' | 'nonce'>,
): string[] {
  return [
    method.toUpperCase(),
    path,
    bodyHash,
    headers.deviceId,
    String(headers.timestamp),
    headers.nonce,
  ];
}

export interface SignRequestOptions {
  privateKey: PrivateKey;
  deviceId: string;
  method: string;
  path: string;
  bodyHash: string;
  nonce: string;
  now?: number;
}

export function signRequest(options: SignRequestOptions): SignedRequestHeaders {
  const cabeceras = {
    deviceId: options.deviceId,
    timestamp: options.now ?? Date.now(),
    nonce: options.nonce,
  };
  const firma = sign(
    options.privateKey,
    'luxy.auth.challenge.v1',
    requestParts(options.method, options.path, options.bodyHash, cabeceras),
  );
  return { ...cabeceras, signature: toBase64Url(firma) };
}

export const AUTH_REJECTIONS = [
  'missing_headers',
  'malformed',
  'stale',
  'replayed',
  'unknown_device',
  'revoked',
  'bad_signature',
] as const;
export type AuthRejection = (typeof AUTH_REJECTIONS)[number];

export type VerifyRequestResult =
  | { ok: true; deviceId: string }
  | { ok: false; code: AuthRejection; detail: string };

export interface VerifyRequestOptions {
  headers: unknown;
  method: string;
  path: string;
  bodyHash: string;
  /** clave publica guardada del dispositivo; null si no existe */
  publicKey: PublicKey | null;
  /** si el dispositivo esta revocado */
  revoked: boolean;
  /** true si el nonce ya se vio dentro de la ventana */
  nonceSeen: boolean;
  now?: number;
  windowMs?: number;
}

/**
 * verifica una peticion firmada.
 *
 * ORDEN DELIBERADO: lo que no depende de la clave va primero, para no gastar una
 * verificacion de curva en basura. Y la firma se comprueba SIEMPRE la ultima,
 * porque es lo unico caro.
 */
export function verifySignedRequest(options: VerifyRequestOptions): VerifyRequestResult {
  const forma = signedRequestHeadersSchema.safeParse(options.headers);
  if (!forma.success) {
    return { ok: false, code: 'malformed', detail: 'faltan cabeceras de firma o estan mal' };
  }
  const cabeceras = forma.data;

  const ahora = options.now ?? Date.now();
  const ventana = options.windowMs ?? AUTH_WINDOW_MS;
  if (Math.abs(ahora - cabeceras.timestamp) > ventana) {
    return {
      ok: false,
      code: 'stale',
      detail: 'la peticion esta fuera de la ventana de tiempo',
    };
  }

  // el nonce impide reinyectar una peticion capturada DENTRO de la ventana
  if (options.nonceSeen) {
    return { ok: false, code: 'replayed', detail: 'esta peticion ya se proceso' };
  }

  if (options.publicKey === null) {
    return { ok: false, code: 'unknown_device', detail: 'ese dispositivo no esta emparejado' };
  }
  if (options.revoked) {
    return { ok: false, code: 'revoked', detail: 'ese dispositivo fue revocado' };
  }
  if (!isValidPublicKey(options.publicKey)) {
    return { ok: false, code: 'unknown_device', detail: 'ese dispositivo no esta emparejado' };
  }

  let firma: Uint8Array;
  try {
    firma = fromBase64Url(cabeceras.signature);
  } catch {
    return { ok: false, code: 'malformed', detail: 'la firma no es base64url' };
  }

  const valida = verify(
    options.publicKey,
    'luxy.auth.challenge.v1',
    requestParts(options.method, options.path, options.bodyHash, cabeceras),
    firma,
  );
  if (!valida) {
    return { ok: false, code: 'bad_signature', detail: 'la firma no es valida' };
  }

  return { ok: true, deviceId: cabeceras.deviceId };
}

/**
 * hash del cuerpo, para incluirlo en la firma.
 *
 * Un cuerpo vacio tiene su propio hash: asi una peticion sin cuerpo no puede
 * convertirse en una con cuerpo conservando la firma.
 */
export async function hashBody(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toBase64Url(new Uint8Array(digest));
}
