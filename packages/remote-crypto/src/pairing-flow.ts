// maquina de estados del emparejamiento, completa y sin transporte.
//
// POR QUE VIVE AQUI Y NO EN EL GATEWAY:
//
// El emparejamiento tiene ocho transiciones y cada una puede fallar de varias
// formas. Metido dentro de handlers HTTP, probarlo exige levantar un Worker, y
// en la practica eso significa que los casos raros no se prueban. Aqui es una
// funcion pura: el gateway solo persiste el resultado.
//
// Ademas permite ejecutar el flujo ENTERO en una prueba, con dos dispositivos de
// verdad y claves de verdad, sin red.
import {
  confirmationWords,
  fingerprint,
  fromBase64Url,
  isValidPublicKey,
  toBase64Url,
  verify,
  type PublicKey,
} from './identity.js';
import { PAIRING_CODE_TTL_MS, type PairingState } from './pairing.js';

export interface PairingSession {
  code: string;
  state: PairingState;
  expiresAt: number;

  hostPublicKey: string;
  hostName: string;

  claimantPublicKey: string | null;
  claimantName: string | null;
  claimantKind: 'android' | 'desktop' | null;

  /** confirmaciones recibidas; hacen falta LAS DOS */
  hostConfirmed: boolean;
  claimantConfirmed: boolean;
}

export const PAIRING_ERRORS = [
  'not_found',
  'expired',
  'already_used',
  'wrong_state',
  'bad_key',
  'bad_signature',
  'same_key',
] as const;
export type PairingError = (typeof PAIRING_ERRORS)[number];

export type PairingOutcome<T> = { ok: true; value: T } | { ok: false; code: PairingError; detail: string };

export interface StartOptions {
  code: string;
  hostPublicKey: PublicKey;
  hostName: string;
  now?: number;
  ttlMs?: number;
}

export function startPairing(options: StartOptions): PairingSession {
  const ahora = options.now ?? Date.now();
  return {
    code: options.code,
    state: 'waiting',
    expiresAt: ahora + (options.ttlMs ?? PAIRING_CODE_TTL_MS),
    hostPublicKey: toBase64Url(options.hostPublicKey),
    hostName: options.hostName,
    claimantPublicKey: null,
    claimantName: null,
    claimantKind: null,
    hostConfirmed: false,
    claimantConfirmed: false,
  };
}

export interface ClaimOptions {
  session: PairingSession | null;
  claimantPublicKey: string;
  claimantName: string;
  claimantKind: 'android' | 'desktop';
  /** firma del codigo con la privada del que reclama, en base64url */
  signature: string;
  now?: number;
}

/**
 * el movil reclama el codigo.
 *
 * Se exige FIRMA del codigo. Sin ella, cualquiera que viera el QR podria
 * reclamar con una clave publica que no controla, y el emparejamiento quedaria
 * atado a una clave sin dueno: despues ninguna sesion podria autenticarse y no
 * habria forma de entender por que.
 */
export function claimPairing(options: ClaimOptions): PairingOutcome<PairingSession> {
  const sesion = options.session;
  const ahora = options.now ?? Date.now();

  if (sesion === null) return fallo('not_found', 'ese codigo no existe');
  if (sesion.expiresAt <= ahora) return fallo('expired', 'el codigo ha caducado');
  if (sesion.state !== 'waiting') {
    return fallo('already_used', 'ese codigo ya se uso. Genera otro en el ordenador');
  }

  let clave: PublicKey;
  try {
    clave = fromBase64Url(options.claimantPublicKey);
  } catch {
    return fallo('bad_key', 'la clave del dispositivo no es valida');
  }
  if (!isValidPublicKey(clave)) return fallo('bad_key', 'la clave del dispositivo no es valida');

  // un dispositivo no se empareja consigo mismo: seria una identidad circular
  if (options.claimantPublicKey === sesion.hostPublicKey) {
    return fallo('same_key', 'ese dispositivo es este mismo ordenador');
  }

  let firma: Uint8Array;
  try {
    firma = fromBase64Url(options.signature);
  } catch {
    return fallo('bad_signature', 'la firma no es valida');
  }
  if (!verify(clave, 'luxy.pair.claim.v1', [sesion.code, options.claimantPublicKey], firma)) {
    return fallo('bad_signature', 'la firma no es valida');
  }

  return {
    ok: true,
    value: {
      ...sesion,
      state: 'claimed',
      claimantPublicKey: options.claimantPublicKey,
      claimantName: options.claimantName,
      claimantKind: options.claimantKind,
    },
  };
}

/**
 * palabras que las DOS pantallas deben mostrar.
 *
 * Solo existen una vez el movil ha reclamado: antes no hay dos claves que
 * comparar.
 */
export function sessionWords(session: PairingSession): string[] | null {
  if (session.claimantPublicKey === null) return null;
  return confirmationWords(
    fromBase64Url(session.hostPublicKey),
    fromBase64Url(session.claimantPublicKey),
  );
}

export interface ConfirmOptions {
  session: PairingSession | null;
  side: 'host' | 'claimant';
  accepted: boolean;
  now?: number;
}

/**
 * una de las dos partes confirma o rechaza.
 *
 * HACEN FALTA LAS DOS. Con una sola, un gateway malicioso que hubiera sustituido
 * una clave solo necesitaria enganar a un lado. Exigiendo las dos, el usuario
 * tiene que haber comparado las dos pantallas.
 *
 * Un rechazo de cualquiera de los dos mata el codigo inmediatamente.
 */
export function confirmPairing(options: ConfirmOptions): PairingOutcome<PairingSession> {
  const sesion = options.session;
  const ahora = options.now ?? Date.now();

  if (sesion === null) return fallo('not_found', 'ese codigo no existe');
  if (sesion.expiresAt <= ahora) return fallo('expired', 'el codigo ha caducado');
  if (sesion.state !== 'claimed') {
    return fallo('wrong_state', 'todavia no hay nada que confirmar');
  }

  if (!options.accepted) {
    return { ok: true, value: { ...sesion, state: 'rejected' } };
  }

  const actualizada: PairingSession = {
    ...sesion,
    hostConfirmed: sesion.hostConfirmed || options.side === 'host',
    claimantConfirmed: sesion.claimantConfirmed || options.side === 'claimant',
  };

  return {
    ok: true,
    value:
      actualizada.hostConfirmed && actualizada.claimantConfirmed
        ? { ...actualizada, state: 'confirmed' }
        : actualizada,
  };
}

/** true si el emparejamiento ya se puede guardar como permanente */
export function isPaired(session: PairingSession): boolean {
  return session.state === 'confirmed' && session.claimantPublicKey !== null;
}

/** datos del dispositivo resultante, listos para persistir */
export function pairedDeviceFrom(
  session: PairingSession,
): { publicKey: string; fingerprint: string; name: string; kind: 'android' | 'desktop' } | null {
  if (!isPaired(session) || session.claimantPublicKey === null) return null;
  return {
    publicKey: session.claimantPublicKey,
    fingerprint: fingerprint(fromBase64Url(session.claimantPublicKey)),
    name: session.claimantName ?? 'dispositivo',
    kind: session.claimantKind ?? 'android',
  };
}

function fallo(code: PairingError, detail: string): { ok: false; code: PairingError; detail: string } {
  return { ok: false, code, detail };
}
