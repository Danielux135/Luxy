// estado de la boveda en el renderer.
//
// Este modulo NUNCA guarda material criptografico. Lo que maneja es:
//
//   - el estado que devuelve el proceso principal (si existe, si esta abierta);
//   - la contraseña, el tiempo justo que tarda en cruzar el IPC;
//   - la clave de recuperacion, sólo en el momento de crear la boveda y hasta
//     que el usuario confirma que la ha guardado.
//
// Nada de eso se persiste en localStorage, ni en un estado global, ni se envia
// a ningun sitio.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface VaultStatusView {
  configured: boolean;
  unlocked: boolean;
  methods: { password: boolean; recovery: boolean; device: boolean };
  /** 0 significa que no se cierra sola */
  autoLockMinutes: number;
  lockingInMs: number | null;
}

const CLOSED: VaultStatusView = {
  configured: false,
  unlocked: false,
  methods: { password: false, recovery: false, device: false },
  autoLockMinutes: 0,
  lockingInMs: null,
};

/** cada cuanto se refresca la cuenta atras del bloqueo automatico */
const TICK_MS = 5000;

export interface VaultController {
  status: VaultStatusView;
  loading: boolean;
  busy: boolean;
  error: string | null;
  hint: string | null;
  /** sólo entre crear la boveda y confirmar que se copio */
  recoveryKey: string | null;
  create: (password: string) => Promise<boolean>;
  unlock: (method: 'password' | 'recovery' | 'device', secret?: string) => Promise<boolean>;
  lock: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<boolean>;
  setDeviceUnlock: (enabled: boolean) => Promise<boolean>;
  setAutoLock: (minutes: number) => Promise<boolean>;
  acknowledgeRecoveryKey: () => void;
  clearError: () => void;
}

export function useVault(): VaultController {
  const [status, setStatus] = useState<VaultStatusView>(CLOSED);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.luxy.getVaultStatus();
    if (!mounted.current) return;
    if (result.ok) setStatus(result.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    // el bloqueo automatico ocurre en el proceso principal; aqui solo se
    // refresca la cuenta atras para que la interfaz no mienta
    const timer = setInterval(() => void refresh(), TICK_MS);
    const unsubscribe = window.luxy.onVaultLocked(() => {
      void refresh();
      setHint('La bóveda se cerró sola por inactividad.');
    });
    return () => {
      mounted.current = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [refresh]);

  /** envuelve una operacion: un solo sitio decide como se ven los errores */
  const run = useCallback(
    async <T>(operation: () => Promise<{ ok: true; value: T } | { ok: false; error: string; hint: string | null }>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      setHint(null);
      try {
        const result = await operation();
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return null;
        }
        return result.value;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [],
  );

  const create = useCallback(
    async (password: string): Promise<boolean> => {
      const value = await run(() => window.luxy.createVault(password));
      if (value === null) return false;
      setStatus(value.status);
      // se muestra una vez. Si el usuario no la copia, deja de existir.
      setRecoveryKey(value.recoveryKey);
      return true;
    },
    [run],
  );

  const unlock = useCallback(
    async (method: 'password' | 'recovery' | 'device', secret?: string): Promise<boolean> => {
      const value = await run(() =>
        window.luxy.unlockVault(secret === undefined ? { method } : { method, secret }),
      );
      if (value === null) return false;
      setStatus(value);
      return true;
    },
    [run],
  );

  const lock = useCallback(async (): Promise<void> => {
    const value = await run(() => window.luxy.lockVault());
    if (value !== null) setStatus(value);
  }, [run]);

  const changePassword = useCallback(
    async (current: string, next: string): Promise<boolean> => {
      const value = await run(() =>
        window.luxy.changeVaultPassword({ currentPassword: current, newPassword: next }),
      );
      if (value === null) return false;
      setStatus(value);
      setHint('Contraseña cambiada. Tu clave de recuperación sigue siendo válida.');
      return true;
    },
    [run],
  );

  const setDeviceUnlock = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      const value = await run(() => window.luxy.setVaultDeviceUnlock(enabled));
      if (value === null) return false;
      setStatus(value);
      return true;
    },
    [run],
  );

  const setAutoLock = useCallback(
    async (minutes: number): Promise<boolean> => {
      const value = await run(() => window.luxy.setVaultAutoLock(minutes));
      if (value === null) return false;
      setStatus(value);
      return true;
    },
    [run],
  );

  return {
    status,
    loading,
    busy,
    error,
    hint,
    recoveryKey,
    create,
    unlock,
    lock,
    changePassword,
    setDeviceUnlock,
    setAutoLock,
    acknowledgeRecoveryKey: () => setRecoveryKey(null),
    clearError: () => setError(null),
  };
}

/** etiqueta legible de cada opcion de bloqueo automatico */
export function formatAutoLockOption(minutes: number): string {
  if (minutes === 0) return 'No cerrarla sola';
  if (minutes < 60) return `${minutes} minutos de inactividad`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hora de inactividad' : `${hours} horas de inactividad`;
}

/** texto del tiempo restante antes del bloqueo automatico */
export function formatLockCountdown(lockingInMs: number | null): string | null {
  if (lockingInMs === null) return null;
  const minutes = Math.floor(lockingInMs / 60_000);
  if (minutes >= 1) return `se cerrará sola en ${minutes} min`;
  const seconds = Math.max(0, Math.floor(lockingInMs / 1000));
  return `se cerrará sola en ${seconds} s`;
}
