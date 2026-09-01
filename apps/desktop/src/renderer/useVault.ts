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

export interface PrivateTurn {
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface PrivateConversation {
  conversationId: string;
  title: string;
  turns: number;
  updatedAt: string;
}

export interface PrivateMediaItem {
  mediaId: string;
  mimeType: string;
  displayName: string | null;
  hasThumbnail: boolean;
  /** false si es demasiado grande para previsualizar por ahora */
  previewable: boolean;
}

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
  conversations: PrivateConversation[];
  openConversationId: string | null;
  turns: PrivateTurn[];
  sending: boolean;
  openConversation: (conversationId: string | null) => Promise<void>;
  send: (input: {
    message: string;
    provider: string;
    model: string | null;
    projectAlias: string;
  }) => Promise<boolean>;
  removeConversation: (conversationId: string) => Promise<void>;
  media: PrivateMediaItem[];
  attaching: boolean;
  attachMedia: () => Promise<void>;
  openMedia: (mediaId: string) => Promise<string | null>;
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
  const [conversations, setConversations] = useState<PrivateConversation[]>([]);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<PrivateTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [media, setMedia] = useState<PrivateMediaItem[]>([]);
  const [attaching, setAttaching] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.luxy.getVaultStatus();
    if (!mounted.current) return;
    if (result.ok) {
      setStatus(result.value);
      // al cerrarse la boveda se descarta TODO lo descifrado que hubiera en
      // memoria del renderer. No se oculta: deja de existir aqui.
      if (!result.value.unlocked) {
        setConversations([]);
        setTurns([]);
        setMedia([]);
        setOpenConversationId(null);
      }
    }
    setLoading(false);
  }, []);

  const reloadConversations = useCallback(async (): Promise<void> => {
    const result = await window.luxy.listVaultConversations();
    if (mounted.current && result.ok) setConversations(result.value.conversations);
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
      void reloadConversations();
      return true;
    },
    [run, reloadConversations],
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

  const openConversation = useCallback(
    async (conversationId: string | null): Promise<void> => {
      setOpenConversationId(conversationId);
      if (conversationId === null) {
        setTurns([]);
        return;
      }
      const result = await window.luxy.readVaultConversation(conversationId);
      if (mounted.current && result.ok) setTurns(result.value.turns);
      const mediaResult = await window.luxy.listVaultMedia(conversationId);
      if (mounted.current && mediaResult.ok) setMedia(mediaResult.value.media);
    },
    [],
  );

  const reloadMedia = useCallback(async (): Promise<void> => {
    if (openConversationId === null) return;
    const result = await window.luxy.listVaultMedia(openConversationId);
    if (mounted.current && result.ok) setMedia(result.value.media);
  }, [openConversationId]);

  const attachMedia = useCallback(async (): Promise<void> => {
    if (openConversationId === null) {
      setError('abre o empieza una conversacion antes de adjuntar');
      return;
    }
    setAttaching(true);
    setError(null);
    try {
      const result = await window.luxy.attachVaultMedia(openConversationId);
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return;
      }
      await reloadMedia();
    } finally {
      if (mounted.current) setAttaching(false);
    }
  }, [openConversationId, reloadMedia]);

  /**
   * devuelve una data URL con los bytes descifrados, o null si el archivo es
   * demasiado grande para previsualizarlo todavia.
   *
   * No se cachea a proposito: mantener imagenes descifradas en el estado del
   * renderer las dejaria vivas despues de cerrar la boveda.
   */
  const openMedia = useCallback(
    async (mediaId: string): Promise<string | null> => {
      if (openConversationId === null) return null;
      const result = await window.luxy.readVaultMedia({
        conversationId: openConversationId,
        mediaId,
      });
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      return result.value.dataUrl;
    },
    [openConversationId],
  );

  const send = useCallback(
    async (input: {
      message: string;
      provider: string;
      model: string | null;
      projectAlias: string;
    }): Promise<boolean> => {
      setSending(true);
      setError(null);
      try {
        const result = await window.luxy.sendVaultMessage({
          conversationId: openConversationId,
          ...input,
        });
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return false;
        }
        setOpenConversationId(result.value.conversationId);
        setTurns(result.value.turns);
        if (result.value.error !== null) setError(result.value.error);
        await reloadConversations();
        return result.value.outcome === 'completed';
      } finally {
        if (mounted.current) setSending(false);
      }
    },
    [openConversationId, reloadConversations],
  );

  const removeConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      await window.luxy.deleteVaultConversation(conversationId);
      if (openConversationId === conversationId) {
        setOpenConversationId(null);
        setTurns([]);
      }
      await reloadConversations();
    },
    [openConversationId, reloadConversations],
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
    conversations,
    openConversationId,
    turns,
    sending,
    openConversation,
    send,
    removeConversation,
    media,
    attaching,
    attachMedia,
    openMedia,
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
