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
import type { ConversationMemoryStatus } from '@luxy/shared';

/**
 * la cuenta, tal y como la ve la interfaz.
 *
 * `email` puede existir sin `signedIn`: la bóveda de este equipo pertenece a
 * una cuenta y su sesión ha caducado. Son dos problemas distintos y se
 * arreglan de forma distinta, así que se muestran por separado.
 */
/** un personaje guardado. Crearlo cuesta créditos: por eso se guarda */
export interface VaultCharacterView {
  characterId: string;
  modelId: string;
  description: string;
  label: string;
  avatarObjectKey: string | null;
  createdAt: string;
}

export interface VaultAccountView {
  email: string | null;
  signedIn: boolean;
  expiresAt: string | null;
  /** se entró con la clave de recuperación: toca elegir contraseña nueva */
  openedWithRecoveryKey: boolean;
}

export interface VaultStatusView {
  configured: boolean;
  unlocked: boolean;
  methods: { password: boolean; recovery: boolean; device: boolean };
  /** 0 significa que no se cierra sola */
  autoLockMinutes: number;
  lockingInMs: number | null;
  account: VaultAccountView;
  /** hay clave guardada del proveedor de imágenes; nunca la clave */
  mediaProviderConfigured: boolean;
}

const CLOSED: VaultStatusView = {
  configured: false,
  unlocked: false,
  methods: { password: false, recovery: false, device: false },
  autoLockMinutes: 0,
  lockingInMs: null,
  account: { email: null, signedIn: false, expiresAt: null, openedWithRecoveryKey: false },
  mediaProviderConfigured: false,
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

export interface VaultComposer {
  /** proveedor elegido; `null` mientras no se haya elegido ninguno */
  provider: string | null;
  /**
   * modelo elegido; `null` deja decidir al de la conexion.
   *
   * Mandarlo siempre en `null` era el motivo de que una conversacion privada
   * acabara SIEMPRE en el modelo por defecto de la conexion, sin poder elegir.
   */
  model: string | null;
  /** proyecto elegido; `null` mientras no se haya elegido ninguno */
  project: string | null;
  message: string;
  /** `null` mientras no se editen: enviar sin tocarlas conserva las guardadas */
  instructions: string | null;
  characterId: string | null;
  characterDescription: string | null;
  /** pie de foto que acompañara al proximo adjunto */
  caption: string;
}

/**
 * lo que se borra al cambiar de conversacion.
 *
 * Fuera quedan proveedor, modelo y proyecto: los dos primeros los trae la
 * conversacion que se abre, y el proyecto es preferencia del usuario.
 */
const EMPTY_DRAFT = {
  message: '',
  instructions: null,
  characterId: null,
  characterDescription: null,
  caption: '',
} satisfies Omit<VaultComposer, 'provider' | 'model' | 'project'>;

export interface VaultController {
  status: VaultStatusView;
  loading: boolean;
  busy: boolean;
  error: string | null;
  hint: string | null;
  /** sólo entre crear la boveda y confirmar que se copio */
  recoveryKey: string | null;
  /** crea la cuenta: la bóveda de este equipo nace vinculada a ella */
  registerAccount: (email: string, password: string) => Promise<boolean>;
  /** entra en una cuenta ya existente y trae su llave a este equipo */
  loginAccount: (
    email: string,
    secret: string,
    method?: 'password' | 'recovery',
  ) => Promise<boolean>;
  /** sube a una cuenta nueva la bóveda que ya existía aquí, sin recifrarla */
  linkAccount: (email: string, password: string) => Promise<boolean>;
  logoutAccount: () => Promise<void>;
  /** guarda la clave del proveedor de imágenes; el nombre lo pone el main */
  setMediaKey: (apiKey: string) => Promise<boolean>;
  deleteMediaKey: () => Promise<void>;
  create: (password: string) => Promise<boolean>;
  unlock: (method: 'password' | 'recovery' | 'device', secret?: string) => Promise<boolean>;
  lock: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<boolean>;
  setDeviceUnlock: (enabled: boolean) => Promise<boolean>;
  setAutoLock: (minutes: number) => Promise<boolean>;
  conversations: PrivateConversation[];
  openConversationId: string | null;
  turns: PrivateTurn[];
  /** instrucciones fijas de la conversación abierta; null si no tiene */
  instructions: string | null;
  /** personaje que gobierna las imágenes de la conversación abierta */
  characterId: string | null;
  /** quién es ese personaje, en texto: es lo que lee el modelo */
  characterDescription: string | null;
  /**
   * qué pasó con la imagen del último turno.
   *
   * null si el modelo no pidió ninguna, que es lo normal. Existe para que la
   * interfaz pueda decir por qué no hay imagen: callarse parece un cuelgue.
   */
  lastImage: { mediaId: string | null; costCredits: number | null; error: string | null } | null;
  /**
   * que le paso al bloque de memoria en el ultimo turno.
   *
   * Existe para poder cambiar de modelo con evidencia: un modelo mas pequeño
   * puede escribir bien la escena y mal el bloque, y esa averia es silenciosa.
   */
  lastMemoryStatus: ConversationMemoryStatus | null;
  /**
   * lo que hay escrito y todavia no se ha enviado.
   *
   * Vive AQUI y no en la pantalla a proposito. Estaba en estado del componente,
   * asi que cambiar de pestaña desmontaba la pagina y se perdia todo: las
   * instrucciones a medio escribir desaparecian sin haberse guardado nunca, y
   * el proveedor volvia al primero de la lista, con lo que se acababa enviando
   * a un modelo que no era el elegido.
   */
  composer: VaultComposer;
  setComposer: (patch: Partial<VaultComposer>) => void;
  sending: boolean;
  openConversation: (conversationId: string | null) => Promise<void>;
  send: (input: {
    message: string;
    provider: string;
    /** `null` deja que decida la conexion; con valor, manda este */
    model: string | null;
    projectAlias: string;
    /** null conserva las que hubiera; cadena vacía las borra */
    instructions: string | null;
    characterId: string | null;
    characterDescription: string | null;
  }) => Promise<boolean>;
  removeConversation: (conversationId: string) => Promise<void>;
  media: PrivateMediaItem[];
  attaching: boolean;
  /** el pie de foto es lo unico que el modelo llega a saber del archivo */
  attachMedia: (caption: string) => Promise<void>;
  openMedia: (mediaId: string) => Promise<string | null>;
  generating: boolean;
  /** créditos declarados por el proveedor en la última generación */
  lastCost: number | null;
  generateMedia: (input: {
    characterId: string;
    prompt: string;
    kind: 'image' | 'video';
  }) => Promise<boolean>;
  /**
   * crea un personaje. Con `withReferenceImage`, el proceso principal abre el
   * diálogo, cifra la imagen en la conversación y la envía en el cuerpo de la
   * petición: no se publica en ninguna parte y el renderer nunca ve los bytes.
   */
  /** personajes guardados en la bóveda; la API no sabe listarlos */
  characters: VaultCharacterView[];
  createCharacter: (input: {
    modelId: 'realistic-sharp-v1' | 'anime-pure-v1';
    traits: Record<string, string>;
    scene: string;
    sfw: boolean;
    label: string;
    description: string;
  }) => Promise<string | null>;
  forgetCharacter: (characterId: string) => Promise<void>;
  /** da de alta uno que ya existe en el proveedor; la API no sabe listarlos */
  importCharacter: (input: {
    characterId: string;
    modelId: 'realistic-sharp-v1' | 'anime-pure-v1';
    label: string;
    description: string;
    avatarUrl: string;
  }) => Promise<boolean>;
  /** avatar descifrado como data URL; null si ese personaje no tiene */
  readCharacterAvatar: (characterId: string) => Promise<string | null>;
  syncing: boolean;
  lastSync: {
    uploaded: number;
    downloaded: number;
    mediaUploaded: number;
    mediaDownloaded: number;
    mediaSkipped: number;
  } | null;
  sync: () => Promise<void>;
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
  const [instructions, setInstructions] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [characterDescription, setCharacterDescription] = useState<string | null>(null);
  const [characters, setCharacters] = useState<VaultCharacterView[]>([]);
  const [lastImage, setLastImage] = useState<VaultController['lastImage']>(null);
  const [lastMemoryStatus, setLastMemoryStatus] = useState<ConversationMemoryStatus | null>(null);
  const [sending, setSending] = useState(false);
  const [composer, setComposerState] = useState<VaultComposer>({
    provider: null,
    model: null,
    project: null,
    ...EMPTY_DRAFT,
  });
  const [media, setMedia] = useState<PrivateMediaItem[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<VaultController['lastSync']>(null);
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
        setInstructions(null);
        setOpenConversationId(null);
      }
    }
    setLoading(false);
  }, []);

  const reloadCharacters = useCallback(async (): Promise<void> => {
    const result = await window.luxy.listVaultCharacters();
    if (mounted.current && result.ok) setCharacters(result.value.characters);
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

  const registerAccount = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      const value = await run(() => window.luxy.registerVaultAccount({ email, password }));
      if (value === null) return false;
      setStatus(value.status);
      // se muestra una vez. Si el usuario no la copia, deja de existir.
      setRecoveryKey(value.recoveryKey);
      return true;
    },
    [run],
  );

  const loginAccount = useCallback(
    async (
      email: string,
      secret: string,
      method: 'password' | 'recovery' = 'password',
    ): Promise<boolean> => {
      const value = await run(() => window.luxy.loginVaultAccount({ email, method, secret }));
      if (value === null) return false;
      setStatus(value);
      void reloadConversations();
      void reloadCharacters();
      return true;
    },
    [run, reloadConversations, reloadCharacters],
  );

  const linkAccount = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      const value = await run(() => window.luxy.linkVaultAccount({ email, password }));
      if (value === null) return false;
      setStatus(value.status);
      // la clave nueva se muestra una vez, igual que al crear la cuenta: la
      // anterior ha dejado de valer y hay que decirlo con el papel delante
      setRecoveryKey(value.recoveryKey);
      return true;
    },
    [run],
  );

  const logoutAccount = useCallback(async (): Promise<void> => {
    const value = await run(() => window.luxy.logoutVaultAccount());
    if (value === null) return;
    // salir cierra también la bóveda, y lo descifrado se descarta AQUÍ y no en
    // el próximo refresco: hasta entonces seguiría en memoria del renderer
    setStatus(value);
    setConversations([]);
    setTurns([]);
    setMedia([]);
    setInstructions(null);
    setOpenConversationId(null);
  }, [run]);

  const setMediaKey = useCallback(
    async (apiKey: string): Promise<boolean> => {
      const value = await run(() => window.luxy.setVaultMediaKey({ apiKey }));
      if (value === null) return false;
      setStatus(value);
      setHint('Clave guardada. Ya puedes pedir imágenes dentro de una conversación.');
      return true;
    },
    [run],
  );

  const deleteMediaKey = useCallback(async (): Promise<void> => {
    const value = await run(() => window.luxy.deleteVaultMediaKey());
    if (value !== null) setStatus(value);
  }, [run]);

  const unlock = useCallback(
    async (method: 'password' | 'recovery' | 'device', secret?: string): Promise<boolean> => {
      const value = await run(() =>
        window.luxy.unlockVault(secret === undefined ? { method } : { method, secret }),
      );
      if (value === null) return false;
      setStatus(value);
      void reloadConversations();
      void reloadCharacters();
      return true;
    },
    [run, reloadConversations, reloadCharacters],
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

  const setComposer = useCallback((patch: Partial<VaultComposer>): void => {
    setComposerState((previous) => ({ ...previous, ...patch }));
  }, []);

  const openConversation = useCallback(
    async (conversationId: string | null): Promise<void> => {
      setOpenConversationId(conversationId);
      // los borradores pertenecen a la conversacion en la que se escribieron.
      // El proyecto es preferencia y se conserva; el proveedor lo trae la propia
      // conversacion unas lineas mas abajo, porque pertenece a ella
      setComposerState((previous) => ({ ...previous, ...EMPTY_DRAFT }));
      if (conversationId === null) {
        setTurns([]);
        // una conversación nueva empieza sin instrucciones: arrastrar las de la
        // anterior las aplicaría sin que nadie las haya escrito aquí
        setInstructions(null);
        setCharacterId(null);
        setCharacterDescription(null);
        setLastImage(null);
        setLastMemoryStatus(null);
        return;
      }
      const result = await window.luxy.readVaultConversation(conversationId);
      if (mounted.current && result.ok) {
        setTurns(result.value.turns);
        setInstructions(result.value.instructions);
        setCharacterId(result.value.characterId);
        setCharacterDescription(result.value.characterDescription);
        // el proveedor pertenece a la conversacion, no a la ventana: viene
        // sellado con su ultimo turno y por eso sobrevive a reiniciar Studio.
        // Sin turnos todavia se conserva el que estuviera elegido
        if (result.value.provider !== null) {
          setComposerState((previous) => ({ ...previous, provider: result.value.provider }));
        }
        // el modelo tambien pertenece a la conversacion. `null` no se propaga:
        // una conversacion vieja sin modelo no debe borrar el que este elegido
        if (result.value.model !== null) {
          setComposerState((previous) => ({ ...previous, model: result.value.model }));
        }
      }
      // el resultado de una imagen y el estado de la memoria pertenecen al turno
      // que los produjo, no a la conversacion: al cambiar de hilo dejan de tener
      // sentido
      setLastImage(null);
      setLastMemoryStatus(null);
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

  const attachMedia = useCallback(async (caption: string): Promise<void> => {
    if (openConversationId === null) {
      setError('abre o empieza una conversacion antes de adjuntar');
      return;
    }
    setAttaching(true);
    setError(null);
    try {
      const result = await window.luxy.attachVaultMedia(openConversationId, caption);
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
      instructions: string | null;
      characterId: string | null;
      characterDescription: string | null;
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
        setInstructions(result.value.instructions);
        setCharacterId(result.value.characterId);
        setCharacterDescription(result.value.characterDescription);
        if (result.value.provider !== null) {
          setComposerState((previous) => ({ ...previous, provider: result.value.provider }));
        }
        if (result.value.model !== null) {
          setComposerState((previous) => ({ ...previous, model: result.value.model }));
        }
        setLastMemoryStatus(result.value.memoryStatus);
        setLastImage(result.value.image);
        // lo generado en este turno se guarda contra la conversacion: recargar
        // los medios es lo que hace que la imagen aparezca sin recargar nada
        if (result.value.image?.mediaId != null) await reloadMedia();
        if (result.value.error !== null) setError(result.value.error);
        await reloadConversations();
        return result.value.outcome === 'completed';
      } finally {
        if (mounted.current) setSending(false);
      }
    },
    [openConversationId, reloadConversations, reloadMedia],
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

  /**
   * genera un medio y lo guarda cifrado.
   *
   * Tarda: la generación no es inmediata y el proceso principal sondea al
   * proveedor hasta que termina. `generating` existe para que la interfaz lo
   * diga en vez de parecer colgada.
   */
  const generateMedia = useCallback(
    async (input: {
      characterId: string;
      prompt: string;
      kind: 'image' | 'video';
    }): Promise<boolean> => {
      if (openConversationId === null) {
        setError('abre o empieza una conversacion antes de generar');
        return false;
      }
      setGenerating(true);
      setError(null);
      try {
        const result = await window.luxy.generateVaultMedia({
          conversationId: openConversationId,
          ...input,
        });
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return false;
        }
        setLastCost(result.value.costCredits);
        await reloadMedia();
        return true;
      } finally {
        if (mounted.current) setGenerating(false);
      }
    },
    [openConversationId, reloadMedia],
  );

  const createCharacter = useCallback(
    async (input: {
      modelId: 'realistic-sharp-v1' | 'anime-pure-v1';
      traits: Record<string, string>;
      scene: string;
      sfw: boolean;
      label: string;
      description: string;
    }): Promise<string | null> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.createVaultCharacter(input);
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return null;
      }
      // llega ya guardado: crearlo cuesta créditos y el identificador sólo se
      // devuelve una vez
      setCharacters(result.value.characters);
      return result.value.characterId;
    },
    [],
  );

  const importCharacter = useCallback(
    async (input: {
      characterId: string;
      modelId: 'realistic-sharp-v1' | 'anime-pure-v1';
      label: string;
      description: string;
      avatarUrl: string;
    }): Promise<boolean> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.importVaultCharacter(input);
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return false;
      }
      setCharacters(result.value.characters);
      return true;
    },
    [],
  );

  const readCharacterAvatar = useCallback(async (characterId: string): Promise<string | null> => {
    const result = await window.luxy.readVaultCharacterAvatar({ characterId });
    return result.ok ? result.value.dataUrl : null;
  }, []);

  const forgetCharacter = useCallback(async (characterId: string): Promise<void> => {
    const result = await window.luxy.forgetVaultCharacter({ characterId });
    if (result.ok) setCharacters(result.value.characters);
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    setSyncing(true);
    setError(null);
    setHint(null);
    try {
      const result = await window.luxy.syncVault();
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return;
      }
      setLastSync({
        uploaded: result.value.uploaded,
        downloaded: result.value.downloaded,
        mediaUploaded: result.value.mediaUploaded,
        mediaDownloaded: result.value.mediaDownloaded,
        mediaSkipped: result.value.mediaSkipped,
      });
      // lo descargado puede incluir conversaciones que aqui no existian
      await reloadConversations();
      if (openConversationId !== null) await openConversation(openConversationId);
    } finally {
      if (mounted.current) setSyncing(false);
    }
  }, [reloadConversations, openConversation, openConversationId]);

  return {
    status,
    loading,
    busy,
    error,
    hint,
    recoveryKey,
    registerAccount,
    loginAccount,
    linkAccount,
    logoutAccount,
    setMediaKey,
    deleteMediaKey,
    create,
    unlock,
    lock,
    changePassword,
    setDeviceUnlock,
    setAutoLock,
    conversations,
    openConversationId,
    turns,
    instructions,
    characterId,
    characterDescription,
    characters,
    forgetCharacter,
    importCharacter,
    readCharacterAvatar,
    lastImage,
    sending,
    openConversation,
    send,
    removeConversation,
    media,
    attaching,
    composer,
    setComposer,
    lastMemoryStatus,
    attachMedia,
    openMedia,
    generating,
    lastCost,
    generateMedia,
    createCharacter,
    syncing,
    lastSync,
    sync,
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
