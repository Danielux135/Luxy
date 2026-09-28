// por que se cierra la boveda, y como se abrio.
//
// Vive en `shared` porque lo usan los dos lados: el proceso principal lo escribe
// en el registro y lo manda a la pantalla, y la pantalla lo valida antes de
// elegir el aviso. Son enumerados cerrados a proposito: por aqui no puede
// viajar nada que no este en la lista, y menos contenido de la boveda.
import { z } from 'zod';

/**
 * los motivos de un cierre.
 *
 * En español porque es lo que Daniel lee en `studio.log`, y el registro es la
 * unica forma de saber despues por que se cerro (`D-106`).
 */
export const VAULT_LOCK_REASONS = [
  'manual',
  'inactividad',
  'pantalla-bloqueada',
  'suspension',
  'ventana-cerrada',
  'salida',
  'sesion-cerrada',
] as const;
export type VaultLockReason = (typeof VAULT_LOCK_REASONS)[number];
export const vaultLockReasonSchema = z.enum(VAULT_LOCK_REASONS);

/** por donde se abrio: la llave es la misma, la puerta no */
export const VAULT_UNLOCK_VIAS = ['password', 'recovery', 'device', 'create', 'account'] as const;
export type VaultUnlockVia = (typeof VAULT_UNLOCK_VIAS)[number];

/**
 * el aviso que ve Daniel al volver, o `null` si no hace falta ninguno.
 *
 * Cada texto dice lo que YA ha pasado, no lo que se espera que pase (`D-093`):
 * solo sale cuando el aviso de ese motivo ha llegado de verdad. Cerrar con el
 * boton, salir de Luxy o cerrar la sesion de la cuenta no llevan aviso: los ha
 * pedido el mismo.
 */
export function lockNoticeFor(reason: VaultLockReason): string | null {
  switch (reason) {
    case 'inactividad':
      return 'La bóveda se cerró sola por inactividad.';
    case 'pantalla-bloqueada':
      return 'La bóveda se cerró al bloquear Windows.';
    case 'suspension':
      return 'La bóveda se cerró al suspender el equipo.';
    case 'ventana-cerrada':
      return 'La bóveda se cerró al cerrar la ventana.';
    case 'manual':
    case 'salida':
    case 'sesion-cerrada':
      return null;
  }
}

/** el aviso cuando el motivo llega mal formado: se dice el hecho y nada mas */
export const VAULT_LOCK_NOTICE_UNKNOWN = 'La bóveda se cerró.';
