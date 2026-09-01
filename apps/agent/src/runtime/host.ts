// ciclo de vida del agente, independiente de quien lo controle.
//
// la CLI y el proceso de escritorio usan exactamente este host: uno lo espera
// con waitUntilStopped(), el otro lo maneja desde la bandeja. asi no hay dos
// implementaciones del arranque que puedan divergir.
import type {
  AgentConfig,
  AgentEvent,
  AgentEventSink,
  AgentHostStatus,
  AgentRunState,
} from '@luxy/shared';
import { generateShortId, redact } from '@luxy/shared';
import { randomUUID } from 'node:crypto';
import { LuxyAgent } from '../agent.js';
import { executeApproval, auditFilePath } from '../approvals.js';
import { worktreesDir, logsDir } from '../paths.js';
import { type AgentLogger, describeError } from '../logger.js';
import { createWorktree, ensureGitRepository } from '../git.js';
import type { LocalTurnInput, LocalTurnResult } from '../local-turn.js';

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
  /** una configuracion nueva espera a que termine el trabajo en curso */
  private restartPending = false;
  /** serializa start/stop/restart: sin esto dos clics seguidos se pisan */
  private transition: Promise<void> = Promise.resolve();
  /**
   * turnos privados en curso, para poder cancelarlos.
   *
   * viven aqui y no en LuxyAgent porque no son trabajos de la cola: no tienen
   * lease que renovar ni estado que reportar a nadie.
   */
  private readonly localTurns = new Map<string, AbortController>();

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
    this.publish({
      type: 'status.updated',
      at: new Date().toISOString(),
      status: this.getStatus(),
    });
  }

  getStatus(): AgentHostStatus {
    return {
      runState: this.runState,
      agent: this.agent?.getStatus() ?? null,
      lastError: this.lastError,
    };
  }

  /** sustituye la configuracion sin interrumpir un trabajo que ya esta en curso */
  async updateConfig(
    config: AgentConfig | null,
    providerKeys?: Record<string, string>,
  ): Promise<void> {
    this.config = config;
    if (providerKeys) this.providerKeys = providerKeys;
    if (this.runState === 'starting') {
      this.restartPending = true;
    } else if (this.runState === 'running') {
      if (this.agent?.getStatus().activeJob !== null) {
        this.restartPending = true;
      } else if (config === null) {
        await this.stop('configuracion eliminada');
      } else {
        await this.restart();
      }
    }
    this.publish({
      type: 'status.updated',
      at: new Date().toISOString(),
      status: this.getStatus(),
    });
  }

  /** aplica al quedar libre una configuracion guardada durante un trabajo */
  private restartWhenIdle(): void {
    if (!this.restartPending) return;
    this.restartPending = false;
    const applyConfig =
      this.config === null ? this.stop('configuracion eliminada') : this.restart();
    void applyConfig.catch((error: unknown) => {
      this.lastError = redact(describeError(error).message);
      this.options.logger.error(
        'no se pudo aplicar la configuracion pendiente',
        describeError(error),
      );
    });
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
        onIdle: () => this.restartWhenIdle(),
      });

      try {
        await agent.start();
        this.agent = agent;
        this.setRunState('running');
        this.restartWhenIdle();
      } catch (error) {
        this.agent = null;
        this.lastError = redact(describeError(error).message);
        this.setRunState('stopped');
        throw error;
      }
    });
  }

  async stop(reason = 'peticion de parada'): Promise<void> {
    if (reason !== 'reinicio') this.restartPending = false;
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

  /**
   * ejecuta una aprobacion pedida desde la interfaz de escritorio.
   *
   * mismo camino que las que llegan de Telegram: las mismas puertas, el mismo
   * confinamiento y la misma auditoria. Lo unico que cambia es el origen que se
   * registra, para poder distinguirlos despues.
   */
  async executeApproval(request: {
    jobId: string;
    shortId: string;
    action: 'commit' | 'discard' | 'push';
    projectAlias: string;
    worktreePath: string;
    branch: string;
    message: string | null;
    confirmedTwice: boolean;
  }): Promise<{ ok: boolean; message: string }> {
    if (this.config === null) {
      return { ok: false, message: 'Luxy no esta configurado en esta maquina' };
    }

    const outcome = await executeApproval(
      {
        // sin gateway de por medio no hay id: se genera uno para la auditoria
        approvalId: `desktop-${randomUUID()}`,
        ...request,
        message: request.message ?? undefined,
        source: 'desktop',
        requestedBy: 'interfaz de escritorio',
      },
      {
        config: this.config,
        worktreesDirectory: this.options.worktreesDirectory ?? worktreesDir(),
        auditFile: auditFilePath(logsDir()),
      },
    );

    this.publish({
      type: 'approval.resolved',
      at: new Date().toISOString(),
      jobId: request.jobId,
      shortId: request.shortId,
      action: request.action,
      ok: outcome.ok,
      message: outcome.message,
    });
    return { ok: outcome.ok, message: outcome.message };
  }

  /**
   * ejecuta un turno de conversacion privada.
   *
   * No pasa por la cola de Supabase, y por tanto el gateway no se entera de que
   * existe. El progreso se publica a los suscriptores del host — es decir, al
   * proceso principal de Electron — y el texto vuelve como valor de retorno,
   * nunca como evento persistido.
   */
  async runLocalTurn(
    input: LocalTurnInput,
    onProgress: (type: string, message: string) => void,
  ): Promise<LocalTurnResult> {
    if (this.config === null) throw new AgentNotConfiguredError();
    if (this.agent === null || this.runState !== 'running') {
      throw new Error('el agente no esta en marcha en esta maquina');
    }
    if (this.localTurns.has(input.localTurnId)) {
      throw new Error('ese turno ya se esta ejecutando');
    }

    const abort = new AbortController();
    this.localTurns.set(input.localTurnId, abort);
    try {
      return await this.agent.runPrivateTurn(input, abort.signal, onProgress);
    } finally {
      this.localTurns.delete(input.localTurnId);
    }
  }

  /** cancela un turno privado. conserva lo que el modelo ya habia escrito */
  cancelLocalTurn(localTurnId: string): boolean {
    const abort = this.localTurns.get(localTurnId);
    if (abort === undefined) return false;
    abort.abort();
    return true;
  }

  async prepareWorktree(
    projectAlias: string,
    label: string,
  ): Promise<{ projectAlias: string; path: string; branch: string }> {
    if (this.config === null) throw new AgentNotConfiguredError();
    const project = this.config.projects[projectAlias];
    if (project === undefined) throw new Error('el proyecto no existe en esta maquina');
    if (!project.allowEdits) throw new Error('el proyecto no permite crear espacios editables');
    await ensureGitRepository(project.path);
    const worktree = await createWorktree(
      project.path,
      generateShortId(),
      label,
      this.options.worktreesDirectory ?? worktreesDir(),
    );
    return { projectAlias, path: worktree.path, branch: worktree.branch };
  }

  /** espera hasta que el agente se detenga. lo usa la CLI */
  async waitUntilStopped(): Promise<void> {
    await this.agent?.waitUntilStopped();
  }
}
