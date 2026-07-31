// firma y verificacion de la oferta y la respuesta SDP.
//
// ESTA ES LA PIEZA QUE HACE QUE UN GATEWAY COMPROMETIDO NO PUEDA ESCUCHAR.
//
// WebRTC cifra con DTLS-SRTP y no admite modo en claro, asi que nadie puede leer
// la sesion en transito. Pero el cifrado se negocia con las huellas DTLS que
// viajan DENTRO del SDP, y el SDP pasa por el gateway. Quien controle la
// senalizacion puede sustituir esas huellas por las suyas, montar dos sesiones
// -una con cada extremo- y leerlo todo. El transporte seguiria cifrado; el
// atacante seria simplemente uno de los dos extremos.
//
// La defensa: cada lado FIRMA su SDP con la clave privada del dispositivo, y el
// otro verifica contra la clave publica ANCLADA EN DISCO al emparejar. No contra
// la que diga el gateway, que es justo la parte que no es de fiar.
import {
  sign,
  verify,
  fromBase64Url,
  toBase64Url,
  isValidPublicKey,
  type PrivateKey,
  type PublicKey,
} from './identity.js';

/** tope del SDP: uno normal ronda los 4 KB, 64 es holgado y acota el abuso */
export const MAX_SDP_BYTES = 64 * 1024;

export type SdpRole = 'offer' | 'answer';

export interface SignedSdp {
  role: SdpRole;
  sessionId: string;
  sdp: string;
  signature: string;
}

/**
 * extrae las huellas DTLS de un SDP.
 *
 * Se usan para poder ENSENARLAS y compararlas, no solo para firmar el bloque
 * entero. Firmar el SDP completo ya impide la sustitucion, pero tener la huella
 * a mano permite mostrarla en el diagnostico y detectar si algo cambio.
 */
export function extractFingerprints(sdp: string): string[] {
  const encontradas: string[] = [];
  for (const linea of sdp.split(/\r?\n/)) {
    const match = /^a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)\s*$/.exec(linea.trim());
    if (match !== null) encontradas.push(`${match[1]!.toLowerCase()} ${match[2]!.toUpperCase()}`);
  }
  return encontradas;
}

export const SDP_REJECTIONS = [
  'too_large',
  'empty',
  'no_fingerprint',
  'bad_signature',
  'wrong_session',
  'wrong_role',
  'unknown_peer',
] as const;
export type SdpRejection = (typeof SDP_REJECTIONS)[number];

export type SdpVerdict =
  | { ok: true; sdp: string; fingerprints: string[] }
  | { ok: false; code: SdpRejection; detail: string };

/** firma un SDP para enviarlo por la senalizacion */
export function signSdp(
  privateKey: PrivateKey,
  role: SdpRole,
  sessionId: string,
  sdp: string,
): SignedSdp {
  const contexto = role === 'offer' ? 'luxy.sdp.offer.v1' : 'luxy.sdp.answer.v1';
  return {
    role,
    sessionId,
    sdp,
    signature: toBase64Url(sign(privateKey, contexto, [sessionId, sdp])),
  };
}

export interface VerifySdpOptions {
  /** clave ANCLADA EN DISCO del otro extremo. Nunca la que diga el gateway */
  pinnedPublicKey: PublicKey | null;
  expectedSession: string;
  expectedRole: SdpRole;
}

/**
 * verifica un SDP recibido.
 *
 * Exige huella DTLS: un SDP sin ella negociaria sin cifrado extremo a extremo
 * autenticado, que es exactamente lo que un atacante querria conseguir
 * degradando la negociacion.
 */
export function verifySdp(mensaje: SignedSdp, options: VerifySdpOptions): SdpVerdict {
  if (mensaje.sdp.length === 0) {
    return { ok: false, code: 'empty', detail: 'el SDP viene vacio' };
  }
  if (new TextEncoder().encode(mensaje.sdp).length > MAX_SDP_BYTES) {
    return { ok: false, code: 'too_large', detail: 'el SDP es demasiado grande' };
  }
  if (mensaje.role !== options.expectedRole) {
    return {
      ok: false,
      code: 'wrong_role',
      detail: `se esperaba ${options.expectedRole} y llego ${mensaje.role}`,
    };
  }
  if (mensaje.sessionId !== options.expectedSession) {
    return { ok: false, code: 'wrong_session', detail: 'el SDP es de otra sesion' };
  }

  const huellas = extractFingerprints(mensaje.sdp);
  if (huellas.length === 0) {
    return {
      ok: false,
      code: 'no_fingerprint',
      detail: 'el SDP no trae huella DTLS: no se puede autenticar el cifrado',
    };
  }

  if (options.pinnedPublicKey === null || !isValidPublicKey(options.pinnedPublicKey)) {
    return {
      ok: false,
      code: 'unknown_peer',
      detail: 'no hay clave anclada de ese dispositivo en este equipo',
    };
  }

  let firma: Uint8Array;
  try {
    firma = fromBase64Url(mensaje.signature);
  } catch {
    return { ok: false, code: 'bad_signature', detail: 'la firma no es valida' };
  }

  const contexto = mensaje.role === 'offer' ? 'luxy.sdp.offer.v1' : 'luxy.sdp.answer.v1';
  const valida = verify(
    options.pinnedPublicKey,
    contexto,
    [mensaje.sessionId, mensaje.sdp],
    firma,
  );
  if (!valida) {
    return { ok: false, code: 'bad_signature', detail: 'la firma no es valida' };
  }

  return { ok: true, sdp: mensaje.sdp, fingerprints: huellas };
}

/**
 * comprueba que las huellas no han cambiado entre dos SDP de la misma sesion.
 *
 * Hace falta para las renegociaciones: la firma valida cada SDP por separado,
 * pero un extremo comprometido podria enviar una renegociacion legitimamente
 * firmada que cambiara la huella. Si cambia a mitad de sesion, se corta.
 */
export function fingerprintsUnchanged(antes: readonly string[], ahora: readonly string[]): boolean {
  if (antes.length !== ahora.length) return false;
  const ordenadas = [...antes].sort();
  const nuevas = [...ahora].sort();
  return ordenadas.every((valor, indice) => valor === nuevas[indice]);
}
