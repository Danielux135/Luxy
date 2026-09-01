// proceso principal de Luxy Desktop.
//
// orden de arranque: instancia unica -> app lista -> CSP -> agente -> ventana y
// bandeja. Nada de esto abre una consola: cerrar la ventana deja Luxy en la
// bandeja y solo "Salir completamente" termina de verdad.
import { app, BrowserWindow, Notification, ipcMain, safeStorage, screen, shell } from 'electron';
import { shouldShowDesktopNotification } from './notification-policy.js';
import { join } from 'node:path';
import { resolveStoredConfig } from '@luxy/shared';
import { AgentController, resolveAgentEntry } from './agent-controller.js';
import { ConfigStore, configFilePathFor } from './config-store.js';
import { MACHINE_TOKEN_SECRET, SecretStore, createSafeStorageBackend } from './secure-storage.js';
import { VaultService } from './vault/vault-service.js';
import { VaultAccountManager } from './vault/account-manager.js';
import { vaultFilePathFor } from './vault/key-file.js';
import {
  PrivateConversationStore,
  conversationsDirectory,
} from './vault/conversation-store.js';
import { PrivateMediaStore, mediaIndexDirectory } from './vault/media-store.js';
import { LocalBlobStore, mediaDirectory } from './vault/blob-store.js';
import { VAULT_DEVICE_SECRET, VAULT_SESSION_SECRET } from '../shared/channels.js';
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc/handlers.js';
import { LuxyTray } from './tray.js';
import { applyContentSecurityPolicy, createMainWindow, revealWindow } from './windows.js';
import { IPC_EVENT } from '../shared/ipc.js';
import { CaptureHost } from './remote-host/capture-window.js';
import { SessionHostSlot } from './remote-host/session-host.js';
import type { AgentEvent, AgentHostStatus } from '@luxy/shared';

const isDev = !app.isPackaged;
/** electron-vite publica aqui la URL del servidor de desarrollo */
const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
/** el autoarranque con Windows pasa este argumento: solo bandeja, sin ventana */
const startHidden = process.argv.includes('--hidden');

let mainWindow: BrowserWindow | null = null;
let tray: LuxyTray | null = null;
let controller: AgentController | null = null;
let configStore: ConfigStore | null = null;
let secretStore: SecretStore | null = null;
let vault: VaultService | null = null;
let vaultAccounts: VaultAccountManager | null = null;
let privateConversations: PrivateConversationStore | null = null;
let privateMedia: PrivateMediaStore | null = null;
let autoLockTimer: NodeJS.Timeout | null = null;
let captureHost: CaptureHost | null = null;
const remoteSessions = new SessionHostSlot();
/** distingue ocultar la ventana de salir de verdad */
let quitting = false;

const onDisplaysChanged = (): void => {
  void remoteSessions.displaysChanged().catch((error: unknown) => {
    log('no se pudieron actualizar los monitores de la sesion remota', {
      error: String(error),
    });
  });
};

// una sola instancia: dos agentes de la misma maquina se pisarian los worktrees
// y competirian por los mismos trabajos
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => revealWindow(mainWindow));
  void bootstrap();
}

/** carpeta de datos de Luxy, la misma que usa la CLI */
function luxyDataDir(): string {
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData !== undefined && localAppData.length > 0) return join(localAppData, 'Luxy');
  return join(app.getPath('userData'), 'data');
}

function logsDirectory(): string {
  return join(luxyDataDir(), 'logs');
}

/** la misma raiz que usa el agente para escribir artefactos */
function artifactsDirectory(): string {
  return join(luxyDataDir(), 'artifacts');
}

/** la misma raiz que usa el agente para crear worktrees aislados */
function worktreesDirectory(): string {
  return join(luxyDataDir(), 'worktrees');
}

/** catalogos reales leidos de cada pasarela, con su fecha */
function catalogDirectory(): string {
  return join(luxyDataDir(), 'catalog');
}

/** carpeta de configuracion: la misma que usa la CLI */
function luxyConfigDir(): string {
  const appData = process.env['APPDATA'];
  if (appData !== undefined && appData.length > 0) return join(appData, 'Luxy');
  return app.getPath('userData');
}

/**
 * archivos en claro que pueden contener secretos de versiones anteriores.
 *
 * la lista es cerrada a proposito: el canal de borrado solo acepta rutas que
 * esten aqui, para que el renderer no pueda pedir borrar un archivo cualquiera.
 */
function migrationCandidateFiles(): string[] {
  const candidates = [join(app.getAppPath(), '..', '..', '..', '.env.providers')];
  const home = app.getPath('home');
  candidates.push(join(home, '.luxy', '.env.providers'));
  return candidates;
}

/**
 * carga configuracion y secretos y se los pasa al agente.
 *
 * es lo que hace que el proceso del agente exista de verdad: sin esto el
 * controlador nunca tendria configuracion que darle.
 */
async function reconfigureAgent(): Promise<void> {
  if (controller === null || configStore === null || secretStore === null) return;

  let stored;
  try {
    stored = configStore.load();
  } catch (error) {
    log('no se pudo leer la configuracion', { error: String(error) });
    return;
  }
  if (stored === null) {
    await controller.configure(null, {});
    return;
  }

  // el token puede venir del almacen cifrado o, en una instalacion antigua,
  // todavia del propio config.json
  let token: string | undefined;
  let secrets: Record<string, string> = {};
  try {
    if (secretStore.isEncryptionAvailable()) {
      secrets = secretStore.getAll();
      token = secrets[MACHINE_TOKEN_SECRET];
    }
  } catch (error) {
    log('no se pudieron leer los secretos', { error: String(error) });
  }

  // migracion silenciosa del token: si seguia en claro, se cifra y se borra
  if (token === undefined && stored.machineToken !== undefined) {
    try {
      secretStore.set(MACHINE_TOKEN_SECRET, stored.machineToken);
      configStore.save(stored);
      token = stored.machineToken;
      secrets = secretStore.getAll();
      log('el token de maquina se ha movido a secrets.enc');
    } catch (error) {
      // sin cifrado disponible se sigue usando el token en claro, pero se avisa
      token = stored.machineToken;
      log('no se pudo cifrar el token de maquina', { error: String(error) });
    }
  }

  const resolved = resolveStoredConfig(stored, token);
  await controller.configure(resolved, secrets);
}

function log(message: string, fields: Record<string, unknown> = {}): void {
  // en una app de Windows sin consola esto no se ve, pero sigue siendo util
  // durante el desarrollo. el log real lo escribe el agente en su archivo.
  if (isDev) console.log(`[luxy] ${message}`, fields);
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  if (
    mainWindow !== null &&
    !mainWindow.isDestroyed() &&
    !shouldShowDesktopNotification({
      windowVisible: mainWindow.isVisible(),
      windowFocused: mainWindow.isFocused(),
    })
  ) {
    return;
  }
  new Notification({ title, body, silent: false }).show();
}

/** reenvia un evento al renderer, si hay ventana viva */
function forwardToRenderer(event: AgentEvent): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_EVENT.agentEvent, event);
}

function onAgentEvent(event: AgentEvent): void {
  forwardToRenderer(event);

  switch (event.type) {
    case 'job.completed':
      notify('Trabajo terminado', `${event.shortId}: ${event.filesChanged} archivos modificados`);
      break;
    case 'job.failed':
      notify('Trabajo fallido', `${event.shortId}: ${event.errorMessage}`);
      break;
    case 'approval.pending':
      notify('Aprobacion pendiente', `${event.shortId} espera tu confirmacion (${event.action})`);
      break;
    case 'agent.error':
      notify('Error del agente', event.message);
      break;
    case 'status.updated':
      tray?.update(event.status);
      break;
    default:
      break;
  }
}

function refreshTray(status: AgentHostStatus): void {
  tray?.update(status);
}

/** cada cuanto se comprueba la inactividad de la boveda */
const VAULT_TICK_MS = 15_000;

/**
 * avisa al renderer de que la boveda se cerro sola.
 *
 * viaja el hecho, nunca el motivo detallado ni nada de su contenido: la
 * interfaz solo necesita saber que debe volver a la pantalla de desbloqueo.
 */
function forwardVaultLock(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_EVENT.vaultLocked);
}

async function bootstrap(): Promise<void> {
  // necesario en Windows para que las notificaciones se atribuyan a Luxy
  app.setAppUserModelId('com.luxy.desktop');

  /**
   * los volcados de fallo se quedan dentro de Luxy y no se envian a nadie.
   *
   * Un volcado del renderer contiene su memoria, y con la boveda abierta eso
   * incluye conversaciones descifradas. Chromium los escribe aunque no se active
   * el informador de fallos, asi que al menos acaban en una carpeta conocida,
   * bajo la cuenta del usuario, y no en una ruta compartida del sistema.
   *
   * NO se llama a crashReporter.start(): sin el no se sube nada a ningun
   * servidor. Un volcado que viajase seria contenido privado saliendo del PC.
   */
  app.setPath('crashDumps', join(luxyDataDir(), 'crash'));

  await app.whenReady();
  applyContentSecurityPolicy(isDev);

  // CaptureHost vive con la aplicacion, pero no crea la ventana ni concede el
  // permiso hasta que SessionHost acepta una sesion. El transporte real de
  // Supabase adoptara esa sesion en remoteSessions cuando exista.
  captureHost = new CaptureHost({
    onMessage: (message) => void remoteSessions.handleCaptureMessage(message),
    onLog: log,
    rendererUrl,
  });
  captureHost.attachListener(ipcMain);
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  // safeStorage solo responde de forma fiable despues de whenReady()
  configStore = new ConfigStore(configFilePathFor(luxyConfigDir()));
  secretStore = new SecretStore(
    SecretStore.defaultPath(luxyConfigDir()),
    createSafeStorageBackend(safeStorage),
  );

  // la boveda guarda su llave de equipo en el mismo almacen cifrado que el resto
  // de secretos: en Windows eso es DPAPI, atado a esta cuenta.
  const store = secretStore;
  vault = new VaultService(vaultFilePathFor(luxyConfigDir()), {
    get: () => store.get(VAULT_DEVICE_SECRET),
    set: (value) => store.set(VAULT_DEVICE_SECRET, value),
    delete: () => store.delete(VAULT_DEVICE_SECRET),
  });

  // la cuenta es el otro origen de la misma llave maestra: en un equipo nuevo
  // la trae el servidor envuelta, y aqui la abre la contraseña. El token de
  // sesion se guarda cifrado, como el de maquina.
  vaultAccounts = new VaultAccountManager(
    vault,
    {
      get: () => store.get(VAULT_SESSION_SECRET),
      set: (value) => store.set(VAULT_SESSION_SECRET, value),
      delete: () => store.delete(VAULT_SESSION_SECRET),
    },
    { gatewayUrl: () => configStore?.load()?.gatewayUrl ?? null },
  );

  privateConversations = new PrivateConversationStore(conversationsDirectory(luxyConfigDir()));
  privateMedia = new PrivateMediaStore(
    mediaIndexDirectory(luxyConfigDir()),
    new LocalBlobStore(mediaDirectory(luxyConfigDir())),
  );

  // el bloqueo automatico se comprueba por reloj, no con un temporizador que
  // se dispare una vez: asi una suspension larga del equipo aparece bloqueada
  // al volver, en vez de dejar la boveda abierta toda la noche.
  autoLockTimer = setInterval(() => {
    if (vault?.tickAutoLock() === true) {
      log('boveda bloqueada por inactividad');
      forwardVaultLock();
    }
  }, VAULT_TICK_MS);

  controller = new AgentController({
    entryPath: resolveAgentEntry({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
    }),
    // se resolvera de verdad en el onboarding; por ahora que lo busque el agente
    nodePath: null,
    onEvent: onAgentEvent,
    onLog: log,
  });

  registerIpcHandlers({
    controller,
    configStore,
    secretStore,
    vault,
    accounts: vaultAccounts,
    privateConversations,
    privateMedia,
    logsDirectory: logsDirectory(),
    artifactsDirectory: artifactsDirectory(),
    worktreesDirectory: worktreesDirectory(),
    catalogDirectory: catalogDirectory(),
    migrationCandidateFiles: migrationCandidateFiles(),
    getMainWindow: () => mainWindow,
    log,
    reconfigureAgent,
  });

  tray = new LuxyTray({
    onOpen: () => {
      if (mainWindow === null || mainWindow.isDestroyed()) openMainWindow();
      else revealWindow(mainWindow);
    },
    onStart: () => void runTrayAction(() => controller?.start()),
    onStop: () => void runTrayAction(() => controller?.stop('peticion desde la bandeja')),
    onRestart: () => void runTrayAction(() => controller?.restart()),
    onOpenLogs: () => void shell.openPath(logsDirectory()),
    onQuit: () => void quitCompletely(),
  });
  tray.create();

  openMainWindow();

  // la configuracion se carga despues de abrir la ventana para que el arranque
  // se vea de inmediato; si esta configurada, el agente arranca solo
  await reconfigureAgent();
  if (configStore.exists()) {
    try {
      const status = await controller.start();
      refreshTray(status);
    } catch (error) {
      log('el agente no pudo arrancar automaticamente', { error: String(error) });
    }
  }

  // en macos reabrir desde el dock; en windows no estorba
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
}

async function runTrayAction(action: () => Promise<AgentHostStatus> | undefined): Promise<void> {
  try {
    const status = await action();
    if (status !== undefined) refreshTray(status);
  } catch (error) {
    notify('Luxy', error instanceof Error ? error.message : 'no se pudo completar la accion');
  }
}

function openMainWindow(): void {
  mainWindow = createMainWindow({
    isDev,
    rendererUrl,
    startHidden,
    // cerrar solo oculta, salvo que se este saliendo de verdad
    onCloseRequested: () => !quitting,
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function quitCompletely(): Promise<void> {
  if (autoLockTimer !== null) {
    clearInterval(autoLockTimer);
    autoLockTimer = null;
  }
  // al salir se cierra la boveda explicitamente: no se deja la llave viva en
  // memoria esperando a que el proceso termine de morir
  vault?.lock();
  if (quitting) return;
  quitting = true;
  try {
    screen.off('display-added', onDisplaysChanged);
    screen.off('display-removed', onDisplaysChanged);
    screen.off('display-metrics-changed', onDisplaysChanged);
    await remoteSessions.end('host_shutdown');
    await captureHost?.dispose('host_shutdown');
    captureHost = null;
    await controller?.shutdown();
  } finally {
    unregisterIpcHandlers();
    tray?.destroy();
    tray = null;
    app.quit();
  }
}

// cerrar todas las ventanas NO termina Luxy: sigue en la bandeja
app.on('window-all-closed', () => {
  // se deja vacio a proposito
});

app.on('before-quit', (event) => {
  if (quitting) return;
  // alguien pidio salir por otra via (menu del sistema, cierre de sesion)
  event.preventDefault();
  void quitCompletely();
});
