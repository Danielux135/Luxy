// creacion de la ventana principal y barreras de seguridad del renderer.
import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'node:path';

/**
 * raiz de la aplicacion. se usa app.getAppPath() y no import.meta.url ni
 * __dirname porque el main se empaqueta como CommonJS y, una vez dentro del
 * asar, las rutas relativas al archivo dejan de ser fiables. getAppPath()
 * apunta a apps/desktop en desarrollo y a la raiz del asar empaquetado, y en
 * ambos casos "out" cuelga de ahi.
 */
function outDir(...segments: string[]): string {
  return join(app.getAppPath(), 'out', ...segments);
}

/**
 * CSP estricta. sin 'unsafe-inline' en script-src: el renderer se sirve desde
 * archivos propios y no ejecuta nada que venga de fuera.
 *
 * en desarrollo Vite necesita conectarse a su servidor para el HMR, y por eso
 * la politica se relaja SOLO ahi. En produccion no hay origenes remotos.
 */
function buildCsp(isDev: boolean): string {
  const connect = isDev ? "'self' ws://localhost:* http://localhost:*" : "'self'";
  const script = isDev ? "'self' 'unsafe-inline'" : "'self'";
  return [
    "default-src 'self'",
    `script-src ${script}`,
    // los estilos en linea los genera el propio bundle de la interfaz
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** aplica la CSP a todas las respuestas de la sesion por defecto */
export function applyContentSecurityPolicy(isDev: boolean): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp(isDev)],
      },
    });
  });

  // ningun permiso del navegador tiene sentido aqui: se deniegan todos
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

export interface MainWindowOptions {
  isDev: boolean;
  rendererUrl: string | undefined;
  /** true cuando Luxy arranca con Windows: se queda solo en la bandeja */
  startHidden: boolean;
  /** se invoca al cerrar la ventana; devuelve true si hay que ocultarla */
  onCloseRequested: () => boolean;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    title: 'Luxy',
    autoHideMenuBar: true,
    webPreferences: {
      preload: outDir('preload', 'index.cjs'),
      // las tres barreras que no se negocian
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });

  // nunca se navega fuera de la propia interfaz
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = options.rendererUrl !== undefined && url.startsWith(options.rendererUrl);
    if (!allowed) event.preventDefault();
  });

  // los enlaces externos se abren en el navegador del sistema, no dentro de Luxy
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // un renderer no puede pedir permisos ni adjuntar webviews
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  window.on('close', (event) => {
    if (options.onCloseRequested()) {
      // cerrar la ventana solo la oculta: Luxy sigue en la bandeja
      event.preventDefault();
      window.hide();
    }
  });

  window.once('ready-to-show', () => {
    if (!options.startHidden) window.show();
  });

  if (options.rendererUrl !== undefined) {
    void window.loadURL(options.rendererUrl);
  } else {
    void window.loadFile(outDir('renderer', 'index.html'));
  }

  return window;
}

/** trae la ventana al frente aunque estuviera minimizada u oculta */
export function revealWindow(window: BrowserWindow | null): void {
  if (window === null) return;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}
