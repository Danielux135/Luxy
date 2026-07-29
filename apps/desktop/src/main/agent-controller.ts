// control del proceso del agente desde el main de Electron.
//
// el agente vive en un utilityProcess: es node de verdad, lanzado y controlado
// directamente desde aqui, sin PowerShell ni consola. Si se cae, esto lo
// detecta y lo puede relanzar sin arrastrar la ventana ni la bandeja.
import { utilityProcess, type UtilityProcess } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostResponseSchema, redact } from '@luxy/shared';
import type { AgentConfig, AgentEvent, AgentHostStatus, HostRequest } from '@luxy/shared';

const STOPPED_STATUS: AgentHostStatus = { runState: 'stopped', agent: null, lastError: null };

/** cuanto se espera una respuesta del agente antes de darla por perdida */
const REQUEST_TIMEOUT_MS = 30_000;

export interface AgentControllerOptions {
  /** ruta del host-entry.js compilado del agente */
  entryPath: string;
  /** node.exe real, para que los shims .cmd de claude y codex funcionen */
  nodePath: string | null;
  onEvent: (event: AgentEvent) => void;
  onLog: (message: string, fields?: Record<string, unknown>) => void;
}

interface Pending {
  resolve: (status: AgentHostStatus) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentControllerError extends Error {
  constructor(
    message: string,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = 'AgentControllerError';
  }
}

export class AgentController {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, Pending>();
  private lastStatus: AgentHostStatus = STOPPED_STATUS;
  private config: AgentConfig | null = null;
  private providerKeys: Record<string, string> = {};
  /** evita que dos ordenes simultaneas dejen dos procesos vivos */
  private spawning: Promise<void> | null = null;
  /** ultimas lineas de la salida del hijo, para poder explicar un fallo */
  private stderrTail: string[] = [];
  /** huella del bundle del agente que se esta ejecutando de verdad */
  private agentBuild: string | null = null;

  /** identifica el build del agente en marcha, para detectar una instalacion vieja */
  getAgentBuild(): string | null {
    return this.agentBuild;
  }

  /** guarda la salida del hijo, redactada y acotada */
  private rememberStderr(text: string): void {
    for (const line of text.split(/\r?\n/)) {
      const clean = redact(line.trim());
      if (clean.length === 0) continue;
      this.stderrTail.push(clean);
    }
    if (this.stderrTail.length > 40) this.stderrTail = this.stderrTail.slice(-40);
  }

  /** causa concreta del fallo, para enseñarsela al usuario en vez de "codigo 1" */
  private describeFailure(code: number | undefined): string {
    const tail = this.stderrTail.filter((line) => /error|Error|ERR_|throw/.test(line));
    const relevant = (tail.length > 0 ? tail : this.stderrTail).slice(-3).join(' | ');
    if (relevant.length === 0) {
      return `el proceso del agente termino con codigo ${code ?? 'desconocido'}`;
    }
    return `el proceso del agente termino con codigo ${code ?? 'desconocido'}: ${relevant.slice(0, 400)}`;
  }

  constructor(private readonly options: AgentControllerOptions) {}

  getStatus(): AgentHostStatus {
    return this.child === null ? STOPPED_STATUS : this.lastStatus;
  }

  /** guarda la configuracion y la propaga si el proceso ya esta vivo */
  async configure(config: AgentConfig | null, providerKeys: Record<string, string>): Promise<void> {
    this.config = config;
    this.providerKeys = providerKeys;
    if (this.child !== null) {
      await this.request({ type: 'configure', requestId: randomUUID(), config, providerKeys });
    }
  }

  // ---------------------------------------------------------------------------
  // ciclo de vida del proceso hijo
  // ---------------------------------------------------------------------------

  private async ensureChild(): Promise<void> {
    if (this.child !== null) return;
    if (this.spawning !== null) return this.spawning;

    this.spawning = this.spawnChild().finally(() => {
      this.spawning = null;
    });
    return this.spawning;
  }

  private spawnChild(): Promise<void> {
    if (!existsSync(this.options.entryPath)) {
      return Promise.reject(
        new AgentControllerError(
          'no se encuentra el proceso del agente',
          `falta ${this.options.entryPath}. Ejecuta "npm run build" en la raiz del proyecto.`,
        ),
      );
    }

    this.stderrTail = [];

    return new Promise((resolve, reject) => {
      const env: Record<string, string> = {};
      // se le pasa node.exe explicitamente: dentro de Electron process.execPath
      // es Luxy.exe, y con el no funcionan los shims de claude ni de codex
      if (this.options.nodePath !== null) env['LUXY_NODE_PATH'] = this.options.nodePath;

      const child = utilityProcess.fork(this.options.entryPath, [], {
        serviceName: 'luxy-agent',
        // 'ignore' tiraba la salida del hijo, y con ella la causa de cualquier
        // fallo de arranque: el usuario solo veia "codigo 1". Ahora se captura.
        stdio: 'pipe',
        env: { ...process.env, ...env },
      });

      child.stderr?.on('data', (chunk: Buffer) => this.rememberStderr(chunk.toString('utf8')));
      child.stdout?.on('data', (chunk: Buffer) => this.rememberStderr(chunk.toString('utf8')));

      let settled = false;
      const readyTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(
          new AgentControllerError(
            'el proceso del agente no respondio al arrancar',
            'revisa los registros de Luxy para ver el motivo.',
          ),
        );
      }, REQUEST_TIMEOUT_MS);

      child.on('message', (message: unknown) => {
        const parsed = hostResponseSchema.safeParse(message);
        if (!parsed.success) {
          this.options.onLog('mensaje del agente descartado por no cumplir el protocolo');
          return;
        }

        switch (parsed.data.type) {
          case 'ready':
            this.agentBuild = parsed.data.build ?? null;
            this.options.onLog('agente listo', { build: this.agentBuild });
            if (!settled) {
              settled = true;
              clearTimeout(readyTimer);
              this.child = child;
              resolve();
            }
            break;
          case 'ack': {
            const waiting = this.pending.get(parsed.data.requestId);
            if (waiting === undefined) break;
            this.pending.delete(parsed.data.requestId);
            clearTimeout(waiting.timer);
            if (parsed.data.status !== null) this.lastStatus = parsed.data.status;
            if (parsed.data.ok) waiting.resolve(this.lastStatus);
            else waiting.reject(new AgentControllerError(parsed.data.error ?? 'error desconocido'));
            break;
          }
          case 'event':
            if (parsed.data.event.type === 'status.updated') {
              this.lastStatus = parsed.data.event.status;
            }
            this.options.onEvent(parsed.data.event);
            break;
        }
      });

      child.on('exit', (code) => {
        // si ya hay otro hijo vivo, este exit es de una instancia anterior y no
        // debe tocar el estado actual
        if (this.child !== null && this.child !== child) {
          this.options.onLog('exit de una instancia anterior del agente, ignorado', { code });
          return;
        }
        this.child = null;
        this.lastStatus = STOPPED_STATUS;
        // nadie va a responder ya a lo que estuviera en vuelo
        const cause = this.describeFailure(code ?? undefined);
        for (const [, waiting] of this.pending) {
          clearTimeout(waiting.timer);
          waiting.reject(new AgentControllerError(cause, hintForFailure(this.stderrTail)));
        }
        this.pending.clear();

        if (!settled) {
          settled = true;
          clearTimeout(readyTimer);
          reject(new AgentControllerError(this.describeFailure(code ?? undefined), hintForFailure(this.stderrTail)));
        } else {
          this.options.onLog('el proceso del agente termino', { code, causa: this.describeFailure(code ?? undefined) });
        }
      });
    });
  }

  private request(message: HostRequest): Promise<AgentHostStatus> {
    const child = this.child;
    if (child === null) {
      return Promise.reject(new AgentControllerError('el proceso del agente no esta arrancado'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        reject(new AgentControllerError('el agente no respondio a tiempo'));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(message.requestId, { resolve, reject, timer });
      child.postMessage(message);
    });
  }

  // ---------------------------------------------------------------------------
  // ordenes
  // ---------------------------------------------------------------------------

  async start(): Promise<AgentHostStatus> {
    if (this.config === null) {
      throw new AgentControllerError(
        'Luxy todavia no esta configurado en esta maquina',
        'completa el asistente de configuracion antes de arrancar el agente.',
      );
    }
    await this.ensureChild();
    await this.request({
      type: 'configure',
      requestId: randomUUID(),
      config: this.config,
      providerKeys: this.providerKeys,
    });
    return this.request({ type: 'start', requestId: randomUUID() });
  }

  async stop(reason = 'peticion desde la interfaz'): Promise<AgentHostStatus> {
    if (this.child === null) return STOPPED_STATUS;
    return this.request({ type: 'stop', requestId: randomUUID(), reason });
  }

  async restart(): Promise<AgentHostStatus> {
    if (this.child === null) return this.start();
    await this.request({ type: 'restart', requestId: randomUUID() });
    return this.getStatus();
  }

  /**
   * pide al agente que ejecute una aprobacion.
   *
   * el proceso principal NO comprueba las politicas: eso lo hace el agente, que
   * es quien tiene la configuracion del proyecto y el worktree. Aqui solo se
   * transporta la peticion.
   */
  async executeApproval(approval: {
    jobId: string;
    shortId: string;
    action: 'commit' | 'discard' | 'push';
    projectAlias: string;
    worktreePath: string;
    branch: string;
    message: string | null;
    confirmedTwice: boolean;
  }): Promise<AgentHostStatus> {
    if (this.child === null) {
      throw new AgentControllerError(
        'el agente no esta arrancado',
        'arranca el agente antes de aprobar cambios.',
      );
    }
    return this.request({ type: 'approval', requestId: randomUUID(), approval });
  }

  /** apagado definitivo: para el agente y termina el proceso hijo */
  async shutdown(): Promise<void> {
    const child = this.child;
    if (child === null) return;
    try {
      await this.request({ type: 'shutdown', requestId: randomUUID() });
    } catch (error) {
      this.options.onLog('el agente no confirmo el apagado', {
        error: redact(error instanceof Error ? error.message : String(error)),
      });
    } finally {
      this.child = null;
      child.kill();
    }
  }
}

/** traduce los fallos conocidos a algo que el usuario pueda hacer */
function hintForFailure(stderr: readonly string[]): string | null {
  const text = stderr.join('\n');
  if (text.includes('ERR_MODULE_NOT_FOUND')) {
    return 'la instalacion de Luxy esta incompleta: falta el paquete del agente. Reinstala la aplicacion.';
  }
  if (text.includes('EADDRINUSE')) {
    return 'el puerto de la interfaz local ya esta ocupado. Cierra la otra instancia de Luxy o desactiva la interfaz local en Ajustes.';
  }
  if (text.includes('ERR_UNHANDLED_REJECTION')) {
    return 'revisa los registros de Luxy para ver el detalle.';
  }
  return null;
}

/** localiza el host-entry compilado del agente, en desarrollo y empaquetado */
export function resolveAgentEntry(options: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string {
  if (options.isPackaged) {
    // se copia como extraResources para que no quede dentro del asar: el
    // utilityProcess necesita un archivo real en disco
    return join(options.resourcesPath, 'agent', 'host-entry.js');
  }
  // en desarrollo se usa el mismo bundle que en produccion, para que lo que se
  // prueba sea lo que se instala
  return join(options.appPath, 'out', 'agent', 'host-entry.js');
}
