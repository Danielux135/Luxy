import { describe, it, expect } from 'vitest';
import { formatAutoLockOption, formatLockCountdown } from './useVault.js';
import {
  vaultChangePasswordArgsSchema,
  vaultCreateResultSchema,
  vaultStatusSchema,
  vaultUnlockArgsSchema,
} from '../shared/ipc.js';

describe('cuenta atras del bloqueo', () => {
  it('en minutos cuando falta mas de uno', () => {
    expect(formatLockCountdown(5 * 60_000)).toBe('se cerrará sola en 5 min');
    expect(formatLockCountdown(61_000)).toBe('se cerrará sola en 1 min');
  });

  it('en segundos en el ultimo minuto', () => {
    expect(formatLockCountdown(45_000)).toBe('se cerrará sola en 45 s');
    expect(formatLockCountdown(0)).toBe('se cerrará sola en 0 s');
  });

  it('no dice nada si la boveda esta cerrada', () => {
    expect(formatLockCountdown(null)).toBeNull();
  });
});

describe('etiquetas del bloqueo automatico', () => {
  it('minutos, horas y desactivado', () => {
    expect(formatAutoLockOption(1)).toBe('1 minutos de inactividad');
    expect(formatAutoLockOption(30)).toBe('30 minutos de inactividad');
    expect(formatAutoLockOption(60)).toBe('1 hora de inactividad');
    expect(formatAutoLockOption(240)).toBe('4 horas de inactividad');
    // el 0 no se muestra como "0 minutos", que seria justo lo contrario
    expect(formatAutoLockOption(0)).toBe('No cerrarla sola');
  });
});

describe('contrato IPC de la boveda', () => {
  it('el estado no admite material criptografico', () => {
    const parsed = vaultStatusSchema.parse({
      configured: true,
      unlocked: true,
      methods: { password: true, recovery: true, device: false },
      autoLockMinutes: 5,
      lockingInMs: 120_000,
      account: {
        email: 'daniel@example.com',
        signedIn: true,
        expiresAt: null,
        openedWithRecoveryKey: false,
      },
      mediaProviderConfigured: true,
      // lo que alguien pudiera intentar colar de vuelta al renderer
      masterKey: 'AAAA',
      salt: 'BBBB',
      sessionToken: 'CCCC',
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('AAAA');
    expect(serialized).not.toContain('BBBB');
    // el token de sesion es una credencial reutilizable: tampoco cruza el IPC
    expect(serialized).not.toContain('CCCC');
    expect(Object.keys(parsed).sort()).toEqual([
      'account',
      'autoLockMinutes',
      'configured',
      'lockingInMs',
      'mediaProviderConfigured',
      'methods',
      'unlocked',
    ]);
  });

  it('desbloquear con el equipo no necesita secreto', () => {
    expect(vaultUnlockArgsSchema.safeParse({ method: 'device' }).success).toBe(true);
  });

  it('desbloquear con contraseña acepta el secreto', () => {
    expect(
      vaultUnlockArgsSchema.safeParse({ method: 'password', secret: 'una frase larga' }).success,
    ).toBe(true);
  });

  it('rechaza un metodo inventado', () => {
    expect(vaultUnlockArgsSchema.safeParse({ method: 'huella', secret: 'x' }).success).toBe(false);
  });

  it('rechaza un secreto vacio', () => {
    expect(vaultUnlockArgsSchema.safeParse({ method: 'password', secret: '' }).success).toBe(false);
  });

  it('cambiar contraseña exige las dos', () => {
    expect(
      vaultChangePasswordArgsSchema.safeParse({ currentPassword: 'a', newPassword: 'b' }).success,
    ).toBe(true);
    expect(vaultChangePasswordArgsSchema.safeParse({ newPassword: 'b' }).success).toBe(false);
  });

  it('la clave de recuperacion solo aparece al crear', () => {
    const parsed = vaultCreateResultSchema.parse({
      status: {
        configured: true,
        unlocked: true,
        methods: { password: true, recovery: true, device: false },
        autoLockMinutes: 5,
        lockingInMs: 300_000,
        account: {
          email: null,
          signedIn: false,
          expiresAt: null,
          openedWithRecoveryKey: false,
        },
        mediaProviderConfigured: false,
      },
      recoveryKey: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ23-4567-89AB',
    });
    expect(parsed.recoveryKey).toContain('ABCD');
    // y no esta en el esquema de estado, que es el que se pide continuamente
    expect(vaultStatusSchema.safeParse(parsed).success).toBe(false);
  });
});
