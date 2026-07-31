// carga util del QR y ciclo de vida de un codigo de emparejamiento.
//
// LO QUE EL QR **NO** LLEVA: ningun secreto permanente. Si alguien fotografia la
// pantalla, lo peor que consigue es intentar un emparejamiento dentro de la
// ventana de tres minutos, y aun asi tendria que superar la confirmacion de
// palabras en las DOS pantallas. El QR es una invitacion, no una llave.
import { z } from 'zod';
import {
  fingerprint,
  fromBase64Url,
  isValidPublicKey,
  toBase64Url,
  type PublicKey,
} from './identity.js';

/** version del formato del QR, para poder cambiarlo sin romper moviles viejos */
export const QR_VERSION = 1;

export const PAIRING_CODE_TTL_MS = 3 * 60 * 1000;
export const PAIRING_CODE_DIGITS = 8;

export const qrPayloadSchema = z.object({
  /** siempre "luxy": si el usuario escanea otro QR cualquiera, se dice claro */
  t: z.literal('luxy'),
  v: z.number().int().min(1).max(1000),
  /** url del gateway al que hablar */
  g: z.string().url().max(300),
  /** codigo de un solo uso */
  c: z.string().regex(/^\d{8}$/),
  /** clave publica del escritorio, base64url */
  k: z.string().min(80).max(100),
  /** cuando caduca, en epoch ms */
  e: z.number().int().positive(),
  /** nombre legible del ordenador, solo para mostrarlo antes de confirmar */
  n: z.string().min(1).max(64),
});

export type QrPayload = z.infer<typeof qrPayloadSchema>;

export interface BuildQrOptions {
  gatewayUrl: string;
  code: string;
  desktopPublicKey: PublicKey;
  desktopName: string;
  now?: number;
  ttlMs?: number;
}

/** construye el texto que va dentro del QR */
export function buildQrPayload(options: BuildQrOptions): string {
  const ahora = options.now ?? Date.now();
  const payload: QrPayload = {
    t: 'luxy',
    v: QR_VERSION,
    g: options.gatewayUrl,
    c: options.code,
    k: toBase64Url(options.desktopPublicKey),
    e: ahora + (options.ttlMs ?? PAIRING_CODE_TTL_MS),
    n: options.desktopName,
  };
  return JSON.stringify(payload);
}

export const QR_REJECTIONS = [
  'not_luxy',
  'unsupported_version',
  'expired',
  'malformed',
  'bad_key',
] as const;
export type QrRejection = (typeof QR_REJECTIONS)[number];

export type QrParseResult =
  | {
      ok: true;
      gatewayUrl: string;
      code: string;
      desktopPublicKey: PublicKey;
      desktopName: string;
      desktopFingerprint: string;
      expiresAt: number;
    }
  | { ok: false; code: QrRejection; detail: string };

/**
 * interpreta el contenido de un QR escaneado.
 *
 * La caducidad se comprueba AQUI, en el movil, ademas de en el gateway. No es
 * redundancia inutil: permite decir "este codigo ha caducado, genera otro" en el
 * acto, en vez de mandar una peticion que sera rechazada. La comprobacion que
 * MANDA sigue siendo la del gateway, porque el reloj del movil lo controla el
 * usuario.
 */
export function parseQrPayload(raw: string, now = Date.now()): QrParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'not_luxy', detail: 'el codigo escaneado no es de Luxy' };
  }

  const forma = qrPayloadSchema.safeParse(parsed);
  if (!forma.success) {
    const esLuxy =
      typeof parsed === 'object' && parsed !== null && (parsed as { t?: unknown }).t === 'luxy';
    return esLuxy
      ? { ok: false, code: 'malformed', detail: 'el codigo de Luxy esta incompleto' }
      : { ok: false, code: 'not_luxy', detail: 'el codigo escaneado no es de Luxy' };
  }

  if (forma.data.v !== QR_VERSION) {
    return {
      ok: false,
      code: 'unsupported_version',
      detail:
        forma.data.v > QR_VERSION
          ? 'este codigo lo genero una version mas nueva de Luxy: actualiza el movil'
          : 'este codigo lo genero una version antigua de Luxy: actualiza el ordenador',
    };
  }

  if (forma.data.e <= now) {
    return {
      ok: false,
      code: 'expired',
      detail: 'el codigo ha caducado. Genera otro en el ordenador',
    };
  }

  let clave: PublicKey;
  try {
    clave = fromBase64Url(forma.data.k);
  } catch {
    return { ok: false, code: 'bad_key', detail: 'la clave del codigo no es valida' };
  }
  // se valida que sea un punto REAL de la curva, no solo que tenga la forma:
  // unos bytes bien formados pero fuera de la curva se guardarian como
  // dispositivo emparejado y luego ninguna firma verificaria contra ellos
  if (!isValidPublicKey(clave)) {
    return { ok: false, code: 'bad_key', detail: 'la clave del codigo no es valida' };
  }

  return {
    ok: true,
    gatewayUrl: forma.data.g,
    code: forma.data.c,
    desktopPublicKey: clave,
    desktopName: forma.data.n,
    desktopFingerprint: fingerprint(clave),
    expiresAt: forma.data.e,
  };
}

/**
 * genera un codigo de emparejamiento.
 *
 * Se toma de un generador criptografico, no de Math.random: un codigo predecible
 * permitiria a alguien reclamar el emparejamiento antes que el movil legitimo.
 */
export function generatePairingCode(random: (bytes: number) => Uint8Array): string {
  const bytes = random(4);
  const valor =
    ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return String(valor % 100_000_000).padStart(PAIRING_CODE_DIGITS, '0');
}

// -----------------------------------------------------------------------------
// estado del codigo, del lado del que lo emitio
// -----------------------------------------------------------------------------

export type PairingState = 'waiting' | 'claimed' | 'confirmed' | 'rejected' | 'expired' | 'used';

export interface PairingRecord {
  code: string;
  state: PairingState;
  expiresAt: number;
  /** clave del movil, una vez reclama */
  claimantPublicKey: string | null;
}

export type ClaimResult =
  | { ok: true; record: PairingRecord }
  | { ok: false; code: 'expired' | 'already_used' | 'not_found' | 'wrong_state'; detail: string };

/**
 * aplica una reclamacion sobre un codigo.
 *
 * UN SOLO USO, y esto es lo que impide que alguien que fotografio el QR se
 * empareje despues de que lo hiciera el movil legitimo: en cuanto el estado sale
 * de `waiting`, cualquier otra reclamacion se rechaza.
 */
export function claimPairingCode(
  record: PairingRecord | null,
  claimantPublicKey: string,
  now = Date.now(),
): ClaimResult {
  if (record === null) {
    return { ok: false, code: 'not_found', detail: 'ese codigo no existe' };
  }
  if (record.expiresAt <= now) {
    return { ok: false, code: 'expired', detail: 'el codigo ha caducado' };
  }
  if (record.state !== 'waiting') {
    return {
      ok: false,
      code: 'already_used',
      detail: 'ese codigo ya se uso. Genera otro en el ordenador',
    };
  }

  return {
    ok: true,
    record: { ...record, state: 'claimed', claimantPublicKey },
  };
}
