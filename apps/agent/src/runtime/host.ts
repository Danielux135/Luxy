// ciclo de vida del agente, independiente de quien lo controle.
//
// la CLI y el proceso de escritorio usan exactamente este host: uno lo espera
// con waitUntilStopped(), el otro lo maneja desde la bandeja. asi no hay dos
// implementaciones del arranque que puedan divergir.
import type { AgentConfig, AgentEvent, AgentEventSink, AgentHostStatus, AgentRunState } from '@luxy/shared';
import { redact } from '@luxy/shared';
import { LuxyAgent } from '../agent.js';
import { type AgentLogger, describeError } from '../logger.js';

export interface AgentHostOptions {
  logger: AgentLogger;
  /** configuracion ya validada; null si la maquina aun no esta configurada */
  config: AgentConfig | null;
  providerKeys?: Record<string, string>;
  stateDirectory?: string;
  worktreesDirectory?: string;
}

export class AgentNotConfiguredError extends Error {
  constructor() {
    super('Luxy no esta configurado todavia en esta maquina');
    this.name = 'AgentNotConfiguredError';
  }
}

/**
 * controla una instancia de LuxyAgent: arrancar, parar, reiniciar y observar.
 *
 * el reinicio crea una instancia nueva a proposito. LuxyAgent guarda estado de
 * proveedores y de cola, y reutilizar una instancia que ya se apago fue una de
 * las fuentes de error detectadas en la auditoria.
 */
export class AgentHost {
  private agent: LuxyAgent | null = null;
  private runState: AgentRunState = 'stopped';
  private lastError: string | null = null;
  private config: AgentConfig | null;
  private providerKeys: Record<string, string>;
  private readonly listeners = new Set<AgentEventSink>();
  /** serializa start/stop/restart: sin esto dos clics seguidos se pisan */
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly options: AgentHostOptions) {
    this.config = options.config;
    this.providerKeys = options.providerKeys ?? {};
  }

  /** se suscribe a los eventos del agente. devuelve la funcion de baja */
  subscribe(listener: AgentEventSink): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* un suscriptor roto no afecta a los demas ni al agente */
      }
    }
  }

  private setRunState(next: AgentRunState): void {
    this.runState = next;
    this.publish({ type: 'status.updated', at: new Date().toISOString(), status: this.getStatus() });
  }

  getStatus(): AgentHostStatus {
    return {
      runState: this.runState,
      agent: this.agent?.getStatus() ?? null,
      lastError: this.lastError,
    };
  }

  /** sustituye la configuracion. surte efecto en el siguiente arranque */
  updateConfig(config: AgentConfig | null, providerKeys?: Record<string, string>): void {
    this.config = config;
    if (providerKeys) this.providerKeys = providerKeys;
    this.publish({ type: 'status.updated', at: new Date().toISOString(), status: this.getStatus() });
  }

  /** encola una transicion para que no se solapen dos ordenes */
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.transition = this.transition.then(work, work);
    return this.transition;
  }

  async start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.runState === 'running' || this.runState === 'starting') return;
      if (this.config === null) {
        this.lastError = 'Luxy no esta configurado todavia en esta maquina';
        this.setRunState('stopped');
        throw new AgentNotConfiguredError();
      }

      this.lastError = null;
      this.setRunState('starting');

      const agent = new LuxyAgent(this.config, this.options.logger, this.providerKeys, {
        stateDirectory: this.options.stateDirectory,
        worktreesDirectory: this.options.worktreesDirectory,
        onEvent: (event) => this.publish(event),
      });

      try {
        await agent.start();
        this.agent = agent;
        this.setRunState('running');
      } catch (error) {
        this.agent = null;
        this.lastError = redact(describeError(error).message);
        this.setRunState('stopped');
        throw error;
      }
    });
  }

  async stop(reason = 'peticion de parada'): Promise<void> {
    return this.enqueue(async () => {
      const agent = this.agent;
      if (agent === null) {
        this.setRunState('stopped');
        return;
      }
      this.setRunState('stopping');
      try {
        await agent.stop(reason);
      } catch (error) {
        this.lastError = redact(describeError(error).message);
        this.options.logger.error('error deteniendo el agente', describeError(error));
      } finally {
        this.agent = null;
        this.setRunState('stopped');
      }
    });
  }

  async restart(): Promise<void> {
    await this.stop('reinicio');
    await this.start();
  }

  /** espera hasta que el agente se detenga. lo usa la CLI */
  async waitUntilStopped(): Promise<void> {
    await this.agent?.waitUntilStopped();
  }
}
