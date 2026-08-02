// renderer oculto dedicado a la captura y a WebRTC.
//
// POR QUE UNA VENTANA OCULTA Y NO utilityProcess:
//
// utilityProcess NO TIENE PILA DE MEDIOS. No hay RTCPeerConnection, no hay
// getDisplayMedia y no hay codificador. Es un proceso de Node, no de Chromium.
// La captura y el encoder tienen que vivir donde vive Chromium, y ademas asi el
// trabajo pesado ocurre en el proceso GPU y no bloquea ni al main ni a la
// interfaz. Ver docs/adr/0005-host-windows.md.
//
// POR QUE SESION PROPIA (partition):
//
// La sesion por defecto de Luxy tiene setPermissionRequestHandler denegando
// TODO, que es lo correcto para la interfaz. Aqui hace falta lo contrario para
// una sola cosa. En vez de relajar la sesion de la interfaz -y abrir camara y
// microfono a toda la aplicacion-, esta ventana usa su propia sesion, donde se
// permite exactamente display-capture y nada mas.
import { app, BrowserWindow, desktopCapturer, screen, session } from 'electron';
import { join } from 'node:path';
import {
  CAPTURE_CHANNEL,
  parseFromCapture,
  type FromCapture,
  type ToCapture,
} from '../../shared/capture-ipc.js';
import {
  correlateDisplays,
  sourceForMonitor,
  type CapturableDisplay,
} from './display-sources.js';

function outDir(...segments: string[]): string {
  return join(app.getAppPath(), 'out', ...segments);
}

export interface CaptureHostOptions {
  /** se invoca con cada mensaje ya validado que manda el renderer oculto */
  onMessage: (message: FromCapture) => void;
  onLog: (message: string, fields?: Record<string, unknown>) => void;
  /** URL del servidor de desarrollo de Vite, si lo hay */
  rendererUrl?: string | undefined;
}

/**
 * dueno del renderer oculto.
 *
 * Solo hay uno vivo a la vez. Dos ventanas de captura significarian dos
 * codificadores compitiendo por la GPU y dos sesiones que el usuario no puede
 * ver ni cortar por separado.
 */
export class CaptureHost {
  private window: BrowserWindow | null = null;
  private displays: CapturableDisplay[] = [];
  /** true entre 'start' y 'stop': evita mandar ordenes a una ventana muerta */
  private activa = false;

  constructor(private readonly options: CaptureHostOptions) {}

  /**
   * lee los monitores y sus fuentes de captura.
   *
   * thumbnailSize a cero: la miniatura de cada pantalla se genera capturando un
   * fotograma completo y escalandolo. Pedirla cuando no se va a mostrar cuesta
   * una captura entera de cada monitor cada vez que se consulta la lista, y esta
   * lista se consulta al conectar y en cada cambio de monitores.
   */
  async refreshDisplays(): Promise<CapturableDisplay[]> {
    const fuentes = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });

    this.displays = correlateDisplays(
      screen.getAllDisplays().map((d) => ({
        id: d.id,
        label: d.label,
        bounds: d.bounds,
        scaleFactor: d.scaleFactor,
        rotation: d.rotation,
        internal: d.internal,
      })),
      fuentes.map((f) => ({ id: f.id, name: f.name, display_id: f.display_id })),
      screen.getPrimaryDisplay().id,
    );

    return this.displays;
  }

  currentDisplays(): readonly CapturableDisplay[] {
    return this.displays;
  }

  /** la fuente que corresponde a un monitor, o null si no se puede capturar */
  resolveSource(monitorId: string | null): CapturableDisplay | null {
    return sourceForMonitor(this.displays, monitorId);
  }

  /**
   * crea la ventana oculta si no existe.
   *
   * show:false y skipTaskbar: el usuario no debe ver una ventana vacia ni
   * encontrarsela en la barra de tareas. El aviso de que hay una sesion activa
   * lo da el indicador, que es visible a proposito: ver session-indicator.ts.
   */
  async ensureWindow(): Promise<BrowserWindow> {
    if (this.window !== null && !this.window.isDestroyed()) return this.window;

    const particion = session.fromPartition('luxy-capture');
    this.configurarSesion(particion);

    const ventana = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      // 1x1 en vez de 0: una ventana de tamano cero puede hacer que Chromium
      // suspenda su compositor, y con el suspendido el codificador se queda sin
      // fotogramas
      width: 1,
      height: 1,
      webPreferences: {
        preload: outDir('preload', 'capture.cjs'),
        session: particion,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        // el trabajo real ocurre aqui aunque la ventana no se vea: sin esto
        // Chromium reduce los temporizadores de las ventanas ocultas y la
        // captura baja a unos pocos fotogramas por segundo
        backgroundThrottling: false,
      },
    });

    // esta ventana no navega a ningun sitio, nunca
    ventana.webContents.on('will-navigate', (event) => event.preventDefault());
    ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ventana.webContents.on('will-attach-webview', (event) => event.preventDefault());

    ventana.on('closed', () => {
      this.window = null;
      this.activa = false;
    });

    if (this.options.rendererUrl !== undefined) {
      await ventana.loadURL(`${this.options.rendererUrl}/capture.html`);
    } else {
      await ventana.loadFile(outDir('renderer', 'capture.html'));
    }

    this.window = ventana;
    return ventana;
  }

  /**
   * permisos de la sesion de captura.
   *
   * Se permite SOLO display-capture, y solo mientras haya una sesion activa. La
   * bandera importa: si la ventana quedara viva despues de cortar, una peticion
   * tardia no debe poder empezar a capturar de nuevo.
   */
  private configurarSesion(particion: Electron.Session): void {
    particion.setPermissionRequestHandler((_contents, permiso, callback) => {
      callback(this.activa && permiso === 'display-capture');
    });
    // setPermissionCheckHandler recibe una lista de permisos MAS CORTA que la
    // del manejador de peticiones: 'display-capture' no esta en ella porque la
    // captura de pantalla nunca se consulta de forma sincrona, siempre se pide.
    // Aqui se deniega todo lo demas, que es lo unico que puede llegar.
    particion.setPermissionCheckHandler(() => false);
  }

  /**
   * resuelve getDisplayMedia con una fuente concreta.
   *
   * AQUI ES DONDE SE ELIGE EL MONITOR. getDisplayMedia no acepta un deviceId:
   * el renderer pide "una pantalla" y es este manejador, en el main, quien
   * decide cual. Por eso el renderer oculto no puede capturar un monitor que el
   * usuario no haya autorizado, aunque estuviera comprometido.
   *
   * getSelectedMonitorId lo aporta el llamante para que la eleccion siga
   * viviendo en el estado de la sesion y no aqui.
   */
  installDisplayMediaHandler(getSelectedMonitorId: () => string | null): void {
    const particion = session.fromPartition('luxy-capture');

    particion.setDisplayMediaRequestHandler(
      (_request, callback) => {
        if (!this.activa) {
          // callback sin argumentos = denegado. Es la unica forma de rechazar.
          callback({});
          return;
        }

        const elegido = this.resolveSource(getSelectedMonitorId());
        if (elegido === null || elegido.sourceId === null) {
          this.options.onLog('peticion de captura denegada: el monitor no existe o no se puede capturar');
          callback({});
          return;
        }

        void desktopCapturer
          .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
          .then((fuentes) => {
            const fuente = fuentes.find((f) => f.id === elegido.sourceId);
            if (fuente === undefined) {
              callback({});
              return;
            }
            // el audio se decide en el renderer con audio:'loopback' en la
            // peticion; aqui solo se concede la pantalla
            callback({ video: fuente });
          })
          .catch((error: unknown) => {
            this.options.onLog('no se pudieron leer las fuentes de captura', {
              error: String(error),
            });
            callback({});
          });
      },
      // useSystemPicker false: el selector nativo de Windows lo elegiria el
      // usuario del PC, y aqui quien elige el monitor es el movil
      { useSystemPicker: false },
    );
  }

  /** escucha lo que manda el renderer oculto, validandolo antes de nada */
  attachListener(ipcMain: Electron.IpcMain): void {
    ipcMain.on(CAPTURE_CHANNEL.fromCapture, (event, payload: unknown) => {
      // solo se acepta lo que venga de NUESTRA ventana: cualquier otro renderer
      // que conociera el nombre del canal podria hacerse pasar por ella
      if (this.window === null || event.sender !== this.window.webContents) return;

      const resultado = parseFromCapture(payload);
      if (!resultado.ok) {
        this.options.onLog('mensaje invalido del renderer de captura', {
          reason: resultado.reason,
        });
        return;
      }

      this.options.onMessage(resultado.message);
    });
  }

  /** manda una orden al renderer oculto */
  send(message: ToCapture): void {
    if (this.window === null || this.window.isDestroyed()) return;
    if (message.type === 'start') this.activa = true;
    this.window.webContents.send(CAPTURE_CHANNEL.toCapture, message);
    if (message.type === 'stop') this.activa = false;
  }

  isActive(): boolean {
    return this.activa;
  }

  /**
   * cierra la captura y destruye la ventana.
   *
   * El orden importa: primero se avisa al renderer para que pare las pistas -si
   * se destruyera la ventana sin mas, Windows puede tardar en soltar la captura
   * y el indicador de grabacion del sistema se queda encendido- y despues se
   * destruye.
   */
  async dispose(reason: string): Promise<void> {
    if (this.window !== null && !this.window.isDestroyed()) {
      this.send({ type: 'stop', reason });
      // margen para que el renderer suelte las pistas antes de morir
      await new Promise((resolver) => setTimeout(resolver, 150));
      if (this.window !== null && !this.window.isDestroyed()) this.window.destroy();
    }
    this.window = null;
    this.activa = false;
  }
}
