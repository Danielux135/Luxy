// aviso visible mientras alguien esta viendo o controlando el ordenador.
//
// POR QUE ESTO NO ES OPCIONAL NI CONFIGURABLE:
//
// Un programa que puede ver tu pantalla y mover tu raton sin que se note es,
// tecnicamente, lo mismo que un troyano. La unica diferencia entre Luxy Remote y
// uno es que aqui SIEMPRE se ve que hay una sesion y SIEMPRE se puede cortar
// desde el propio ordenador, sin depender del movil ni de la red.
//
// Por eso no hay ninguna opcion para ocultarlo. Si la hubiera, alguien con
// acceso momentaneo al PC podria dejarla activada.
//
// El texto y los datos se calculan en indicatorLabel, que es puro y tiene
// pruebas; aqui solo queda la ventana.
import { BrowserWindow, screen } from 'electron';

export interface IndicatorState {
  /** true si el remoto puede mover raton y teclado; false si solo mira */
  controlling: boolean;
  deviceName: string;
  since: number;
}

/**
 * texto del indicador.
 *
 * Se distingue mirar de controlar porque son cosas muy distintas para quien esta
 * delante del ordenador, y porque una sesion de solo visualizacion es lo normal
 * al conectar: si las dos dijeran lo mismo, el usuario dejaria de leerlo.
 */
export function indicatorLabel(state: IndicatorState, now: number): string {
  const minutos = Math.max(0, Math.floor((now - state.since) / 60_000));
  const tiempo = minutos < 1 ? 'hace menos de un minuto' : `desde hace ${minutos} min`;
  const verbo = state.controlling ? 'controla este equipo' : 'esta viendo esta pantalla';

  // el nombre del dispositivo lo eligio el usuario al emparejar, pero se acota:
  // un nombre larguisimo desbordaria el indicador y taparia el boton de cortar
  const nombre = state.deviceName.trim().slice(0, 32) || 'Un dispositivo emparejado';

  return `${nombre} ${verbo} ${tiempo}`;
}

const ANCHO = 340;
const ALTO = 52;
const MARGEN = 16;

/**
 * ventanita siempre visible con el aviso y el boton de cortar.
 *
 * alwaysOnTop con nivel 'screen-saver' y visibleOnAllWorkspaces: si una
 * aplicacion a pantalla completa lo tapara, el aviso dejaria de cumplir su
 * unica funcion.
 */
export class SessionIndicator {
  private window: BrowserWindow | null = null;

  constructor(private readonly onCut: () => void) {}

  show(state: IndicatorState): void {
    if (this.window === null || this.window.isDestroyed()) this.crear();
    this.update(state);
    this.window?.showInactive();
  }

  update(state: IndicatorState): void {
    if (this.window === null || this.window.isDestroyed()) return;

    const texto = indicatorLabel(state, Date.now());
    // se pasa por JSON.stringify y no por interpolacion directa: el nombre del
    // dispositivo lo controla quien empareja, y sin escapar podria inyectar
    // codigo en esta ventana, que es privilegiada
    const carga = JSON.stringify({ texto, controlando: state.controlling });
    void this.window.webContents.executeJavaScript(
      `window.luxyIndicador && window.luxyIndicador(${carga});`,
    );
  }

  hide(): void {
    if (this.window === null || this.window.isDestroyed()) return;
    this.window.destroy();
    this.window = null;
  }

  private crear(): void {
    const zona = screen.getPrimaryDisplay().workArea;

    const ventana = new BrowserWindow({
      width: ANCHO,
      height: ALTO,
      // arriba a la derecha: es donde Windows pone sus propios avisos de
      // grabacion y donde el usuario ya mira
      x: zona.x + zona.width - ANCHO - MARGEN,
      y: zona.y + MARGEN,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      webPreferences: {
        // sin preload y sin node: esta ventana no necesita hablar con nada. El
        // boton se comunica cambiando el hash de la URL, que el main observa.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    ventana.setAlwaysOnTop(true, 'screen-saver');
    ventana.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // no debe robar el foco al usuario que esta trabajando
    ventana.setFocusable(false);

    // el boton navega a #cortar; interceptarlo aqui evita tener otro canal IPC
    // privilegiado abierto solo para esto
    ventana.webContents.on('will-navigate', (evento, url) => {
      evento.preventDefault();
      if (url.endsWith('#cortar')) this.onCut();
    });

    void ventana.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
    this.window = ventana;
  }
}

/**
 * la ventana entera, en linea.
 *
 * Va como data: URL y no como archivo porque no tiene que existir en disco ni
 * pasar por el empaquetado: es un aviso de cincuenta lineas y asi no puede
 * faltar en una instalacion.
 */
const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;font-family:"Segoe UI",system-ui,sans-serif;
    -webkit-user-select:none;user-select:none;background:transparent}
  #caja{display:flex;align-items:center;gap:10px;height:100%;box-sizing:border-box;
    padding:0 12px;border-radius:10px;background:#101319f2;color:#e8ecf4;
    border:1px solid #2a3040;box-shadow:0 6px 20px #0009;-webkit-app-region:drag}
  #punto{width:9px;height:9px;border-radius:50%;background:#3fb950;flex:0 0 auto;
    animation:latir 2s ease-in-out infinite}
  #caja.controlando #punto{background:#f85149}
  @keyframes latir{0%,100%{opacity:1}50%{opacity:.35}}
  #texto{flex:1;font-size:12px;line-height:1.25;overflow:hidden}
  #cortar{-webkit-app-region:no-drag;flex:0 0 auto;font-size:12px;font-weight:600;
    color:#fff;background:#a1242c;border:0;border-radius:6px;padding:6px 10px;
    cursor:pointer;text-decoration:none}
  #cortar:hover{background:#c9333c}
</style></head><body>
<div id="caja"><span id="punto"></span><span id="texto">Sesion remota activa</span>
<a id="cortar" href="#cortar">Cortar</a></div>
<script>
  window.luxyIndicador = function (datos) {
    document.getElementById('texto').textContent = datos.texto;
    document.getElementById('caja').classList.toggle('controlando', datos.controlando);
  };
</script></body></html>`;
