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

    return new Promise((resolve, reject) => {
      const env: Record<string, string> = {};
      // se le pasa node.exe explicitamente: dentro de Electron process.execPath
      // es Luxy.exe, y con el no funcionan los shims de claude ni de codex
      if (this.options.nodePath !== null) env['LUXY_NODE_PATH'] = this.options.nodePath;

      const child = utilityProcess.fork(this.options.entryPath, [], {
        serviceName: 'luxy-agent',
        stdio: 'ignore',
        env: { ...process.env, ...env },
      });

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
        this.child = null;
        this.lastStatus = STOPPED_STATUS;
        // nadie va a responder ya a lo que estuviera en vuelo
        for (const [, waiting] of this.pending) {
          clearTimeout(waiting.timer);
          waiting.reject(new AgentControllerError('el proceso del agente termino'));
        }
        this.pending.clear();

        if (!settled) {
          settled = true;
          clearTimeout(readyTimer);
          reject(new AgentControllerError(`el proceso del agente termino con codigo ${code}`));
        } else {
          this.options.onLog('el proceso del agente termino', { code });
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

/** localiza el host-entry compilado del agente, en desarrollo y empaquetado */
export function resolveAgentEntry(options: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string {
  if (options.isPackaged) {
    // se copia como extraResources para que no quede dentro del asar: el
    // utilityProcess necesita un archivo real en disco
    return join(options.resourcesPath, 'agent', 'runtime', 'host-entry.js');
  }
  // en desarrollo appPath es apps/desktop, asi que el agente es su hermano
  return join(options.appPath, '..', 'agent', 'dist', 'runtime', 'host-entry.js');
}
