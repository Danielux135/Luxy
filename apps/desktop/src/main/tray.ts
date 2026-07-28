// icono de bandeja: es la forma normal de tener Luxy funcionando todo el dia.
import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import type { AgentHostStatus } from '@luxy/shared';

export interface TrayActions {
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenLogs: () => void;
  onQuit: () => void;
}

/**
 * icono generado en memoria.
 *
 * evita depender de un archivo en disco, que es la causa habitual de que la
 * bandeja quede vacia en un build empaquetado. Es un cuadrado con la marca de
 * Luxy; el .ico de la aplicacion se usa para la ventana y el instalador.
 */
function buildTrayIcon(connected: boolean): NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  // BGRA. verde cuando el gateway responde, ambar cuando no
  const [b, g, r] = connected ? [120, 200, 90] : [60, 160, 230];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const alpha = border ? 0 : 255;
      buffer[offset] = b;
      buffer[offset + 1] = g;
      buffer[offset + 2] = r;
      buffer[offset + 3] = alpha;
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function describeStatus(status: AgentHostStatus): string {
  switch (status.runState) {
    case 'running':
      return status.agent?.gatewayConnected === true
        ? 'Agente en marcha, gateway conectado'
        : 'Agente en marcha, sin gateway';
    case 'starting':
      return 'Arrancando el agente...';
    case 'stopping':
      return 'Deteniendo el agente...';
    default:
      return 'Agente detenido';
  }
}

function describeActiveJob(status: AgentHostStatus): string {
  const job = status.agent?.activeJob;
  if (job === null || job === undefined) return 'Sin trabajo activo';
  return `Trabajo ${job.shortId} (${job.projectAlias})`;
}

export class LuxyTray {
  private tray: Tray | null = null;
  private status: AgentHostStatus = { runState: 'stopped', agent: null, lastError: null };

  constructor(private readonly actions: TrayActions) {}

  create(): void {
    // se guarda en la instancia: si el recolector se lleva el Tray, el icono
    // desaparece de la bandeja sin mas explicacion
    this.tray = new Tray(buildTrayIcon(false));
    this.tray.setToolTip('Luxy');
    this.tray.on('double-click', () => this.actions.onOpen());
    this.render();
  }

  update(status: AgentHostStatus): void {
    this.status = status;
    this.render();
  }

  private render(): void {
    const tray = this.tray;
    if (tray === null) return;

    const running = this.status.runState === 'running';
    const busy = this.status.runState === 'starting' || this.status.runState === 'stopping';
    const connected = this.status.agent?.gatewayConnected ?? false;

    tray.setImage(buildTrayIcon(running && connected));
    tray.setToolTip(`Luxy - ${describeStatus(this.status)}`);

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Luxy', click: () => this.actions.onOpen() },
        { type: 'separator' },
        { label: describeStatus(this.status), enabled: false },
        { label: describeActiveJob(this.status), enabled: false },
        { type: 'separator' },
        { label: 'Iniciar agente', enabled: !running && !busy, click: () => this.actions.onStart() },
        { label: 'Detener agente', enabled: running && !busy, click: () => this.actions.onStop() },
        { label: 'Reiniciar agente', enabled: running && !busy, click: () => this.actions.onRestart() },
        { type: 'separator' },
        { label: 'Abrir carpeta de registros', click: () => this.actions.onOpenLogs() },
        { type: 'separator' },
        { label: 'Salir completamente', click: () => this.actions.onQuit() },
      ]),
    );
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
