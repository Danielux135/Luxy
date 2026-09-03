// nombres de canal y de secreto.
//
// ESTE ARCHIVO NO PUEDE TENER DEPENDENCIAS EN TIEMPO DE EJECUCION.
//
// lo importa el preload, que corre con sandbox:true y por tanto solo dispone de
// contextBridge, ipcRenderer y unos pocos modulos de node. Un `import` de zod
// aqui hace que el preload falle entero con "module not found", y entonces
// window.luxy no existe y el renderer se queda en blanco. Los esquemas zod
// viven en ipc.ts, que solo cargan el main y el renderer.

/** canales de peticion/respuesta (renderer -> main) */
export const IPC_INVOKE = {
  appInfo: 'luxy:app:info',
  agentStatus: 'luxy:agent:status',
  agentStart: 'luxy:agent:start',
  agentStop: 'luxy:agent:stop',
  agentRestart: 'luxy:agent:restart',
  logsTail: 'luxy:logs:tail',
  logsOpenFolder: 'luxy:logs:open-folder',
  artifactOpenFolder: 'luxy:artifact:open-folder',
  worktreeOpenFolder: 'luxy:worktree:open-folder',
  pickFolder: 'luxy:dialog:pick-folder',
  configGet: 'luxy:config:get',
  configSave: 'luxy:config:save',
  secretSet: 'luxy:secret:set',
  secretDelete: 'luxy:secret:delete',
  migrationScan: 'luxy:migration:scan',
  migrationImport: 'luxy:migration:import',
  migrationDeleteFile: 'luxy:migration:delete-file',
  toolsDetect: 'luxy:tools:detect',
  gatewayCheck: 'luxy:gateway:check',
  machineRegister: 'luxy:machine:register',
  connectionTest: 'luxy:connection:test',
  catalogRefresh: 'luxy:catalog:refresh',
  catalogRead: 'luxy:catalog:read',
  approvalResolve: 'luxy:approval:resolve',
  workspacePrepare: 'luxy:workspace:prepare',
  workspaceOpen: 'luxy:workspace:open',
  studioOptions: 'luxy:studio:options',
  studioJobCreate: 'luxy:studio:job:create',
  studioJobsList: 'luxy:studio:jobs:list',
  studioJobGet: 'luxy:studio:job:get',
  studioJobCancel: 'luxy:studio:job:cancel',
  studioJobFeedback: 'luxy:studio:job:feedback',
  studioConversationUpdate: 'luxy:studio:conversation:update',
  studioJobAction: 'luxy:studio:job:action',
  vaultStatus: 'luxy:vault:status',
  vaultAccountRegister: 'luxy:vault:account:register',
  vaultAccountLogin: 'luxy:vault:account:login',
  vaultAccountLink: 'luxy:vault:account:link',
  vaultAccountLogout: 'luxy:vault:account:logout',
  vaultCreate: 'luxy:vault:create',
  vaultUnlock: 'luxy:vault:unlock',
  vaultLock: 'luxy:vault:lock',
  vaultChangePassword: 'luxy:vault:change-password',
  vaultDeviceUnlockSet: 'luxy:vault:device-unlock:set',
  vaultAutoLockSet: 'luxy:vault:auto-lock:set',
  vaultConversationList: 'luxy:vault:conversation:list',
  vaultConversationRead: 'luxy:vault:conversation:read',
  vaultConversationSend: 'luxy:vault:conversation:send',
  vaultConversationDelete: 'luxy:vault:conversation:delete',
  vaultMediaAttach: 'luxy:vault:media:attach',
  vaultCompatibility: 'luxy:vault:compatibility',
  vaultMemoryList: 'luxy:vault:memory:list',
  vaultMemoryRead: 'luxy:vault:memory:read',
  vaultMemoryExclude: 'luxy:vault:memory:exclude',
  vaultCatalogSync: 'luxy:vault:catalog:sync',
  vaultMediaList: 'luxy:vault:media:list',
  vaultMediaRead: 'luxy:vault:media:read',
  vaultMediaGenerate: 'luxy:vault:media:generate',
  vaultCharacterCreate: 'luxy:vault:character:create',
  vaultCharacterList: 'luxy:vault:character:list',
  vaultCharacterForget: 'luxy:vault:character:forget',
  vaultCharacterImport: 'luxy:vault:character:import',
  vaultCharacterAvatar: 'luxy:vault:character:avatar',
  vaultMediaKeySet: 'luxy:vault:media-key:set',
  vaultMediaKeyDelete: 'luxy:vault:media-key:delete',
  vaultSync: 'luxy:vault:sync',
} as const;

/** canales de notificacion (main -> renderer) */
export const IPC_EVENT = {
  agentEvent: 'luxy:agent:event',
  /** la boveda se cerro sola por inactividad. viaja el hecho, nada mas */
  vaultLocked: 'luxy:vault:locked',
} as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE)[keyof typeof IPC_INVOKE];

/**
 * canales del renderer OCULTO de captura.
 *
 * Van aparte de los de la interfaz a proposito: son dos ventanas con permisos
 * muy distintos y cruzar los canales significaria que la interfaz puede mandarle
 * ordenes al motor de captura.
 *
 * Estan aqui, y no en remote-host/capture-ipc.ts, porque los necesita el preload
 * de la ventana oculta y ese archivo importa zod: ver la cabecera de este
 * archivo.
 */
export const CAPTURE_CHANNEL = {
  /** main -> renderer oculto */
  toCapture: 'luxy:capture:to',
  /** renderer oculto -> main */
  fromCapture: 'luxy:capture:from',
} as const;

/**
 * nombres canonicos de los secretos.
 *
 * los usan los tres lados: el almacen cifrado para guardarlos, el main para
 * leerlos y el renderer para saber si estan configurados. El renderer solo
 * maneja el NOMBRE, nunca el valor.
 */
export const MACHINE_TOKEN_SECRET = 'machineToken';

/**
 * llave con la que el sistema operativo custodia la envoltura "recordar en
 * este equipo" de la boveda.
 *
 * Es un secreto que solo escribe y lee el proceso principal. Esta en
 * RESERVED_SECRET_NAMES para que nadie pueda apropiarselo declarando un
 * proveedor HTTP con este mismo apiKeyEnv: sobrescribirlo no lo revelaria,
 * pero dejaria la boveda sin poder abrirse con el desbloqueo rapido.
 */
export const VAULT_DEVICE_SECRET = 'VAULT_DEVICE_KEY';

/**
 * clave del proveedor de generacion de imagen y video.
 *
 * Reservada por el mismo motivo que la del equipo: la gestiona solo el proceso
 * principal, y nadie puede apropiarsela declarando un proveedor http con este
 * apiKeyEnv.
 */
export const VAULT_MEDIA_API_SECRET = 'VAULT_MEDIA_API_KEY';

/**
 * sesion abierta en la cuenta de la boveda.
 *
 * Es una credencial reutilizable contra el gateway, asi que vive en el almacen
 * cifrado del sistema y no en config.json. Reservada por el mismo motivo que
 * las otras dos: nadie puede apropiarsela declarando un proveedor http con este
 * apiKeyEnv.
 */
export const VAULT_SESSION_SECRET = 'VAULT_ACCOUNT_SESSION';

/** nombres que la interfaz no puede fijar ni reutilizar como apiKeyEnv */
export const RESERVED_SECRET_NAMES: readonly string[] = [
  VAULT_DEVICE_SECRET,
  VAULT_MEDIA_API_SECRET,
  VAULT_SESSION_SECRET,
];

export function connectionSecretName(connectionId: string): string {
  return `connection:${connectionId}`;
}
