// los motivos de cierre de la boveda y el aviso de cada uno (`D-106`, `D-093`).
import { describe, it, expect } from 'vitest';
import {
  VAULT_LOCK_NOTICE_UNKNOWN,
  VAULT_LOCK_REASONS,
  lockNoticeFor,
  vaultLockReasonSchema,
} from './vault-lock.js';

describe('el aviso al volver', () => {
  it('dice por que se cerro, solo en los cierres que no pidio el', () => {
    expect(lockNoticeFor('inactividad')).toBe('La bóveda se cerró sola por inactividad.');
    expect(lockNoticeFor('pantalla-bloqueada')).toBe('La bóveda se cerró al bloquear Windows.');
    expect(lockNoticeFor('suspension')).toBe('La bóveda se cerró al suspender el equipo.');
    expect(lockNoticeFor('ventana-cerrada')).toBe('La bóveda se cerró al cerrar la ventana.');
  });

  it('el boton, salir y cerrar la sesion no llevan aviso', () => {
    expect(lockNoticeFor('manual')).toBeNull();
    expect(lockNoticeFor('salida')).toBeNull();
    expect(lockNoticeFor('sesion-cerrada')).toBeNull();
  });

  it('un motivo mal formado no se cree: solo se dice el hecho', () => {
    expect(vaultLockReasonSchema.safeParse('otro').success).toBe(false);
    expect(vaultLockReasonSchema.safeParse(undefined).success).toBe(false);
    expect(vaultLockReasonSchema.safeParse({ reason: 'manual' }).success).toBe(false);
    expect(VAULT_LOCK_NOTICE_UNKNOWN).toBe('La bóveda se cerró.');
  });

  it('todos los motivos de la lista pasan el esquema', () => {
    for (const reason of VAULT_LOCK_REASONS) {
      expect(vaultLockReasonSchema.parse(reason)).toBe(reason);
    }
  });
});
