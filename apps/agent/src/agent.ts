// bucle principal del agente: heartbeats, polling, ejecucion y cancelacion
import { mkdirSync } from 'node:fs';
import { hostname, platform, release } from 'node:os';
import type { AgentConfig, ClaimedJob, ProviderExecution, ProviderId } from '@luxy/shared';
import { defaultSleep, computeBackoffDelay, isMachineOnline } from '@luxy/shared';
import { GatewayClient } from './gateway-client.js';
import { EventQueue } from './event-queue.js';
import { type AgentLogger, describeError } from './logger.js';
import { detectEnvironment, describeCapabilities } from './detect.js';
import { ClaudeCodeProvider } from './providers/claude.js';
import { CodexCliProvider } from './providers/codex.js';
import { HttpApiProvider, MemoryBudgetStore } from './providers/http-provider.js';
import { runJob } from './job-runner.js';
import { worktreesDir, stateDir } from './paths.js';

export const AGENT_VERSION = '0.1.0';

export interface AgentStatus {
  machineName: string;
  gatewayConnected: boolean;
  lastHeartbeatAt: string | null;
  activeJob: { shortId: string; provider: ProviderId; projectAlias: string; startedAt: string } | null;
  projects: string[];
  providers: string[];
  pendingEvents: number;
  startedAt: string;
}

/**
 * el agente. solo hace conexiones salientes https: no abre puertos ni expone
 * nada a internet.
 */
export class LuxyAgent {
  private readonly client: GatewayClient;
  private readonly queue: EventQueue;
  private readonly providers = new Map<ProviderId, ProviderExecution>();
  private readonly startedAt = new Date().toISOString();

  private running = false;
  private stopping = false;
  private lastHeartbeatAt: string | null = null;
  private gatewayConnected = false;
  private activeJob: ClaimedJob | null = null;
  private activeJobStartedAt: string | null = null;
  private activeAbort: AbortController | null = null;
  private availableProviders: ProviderId[] = [];

  constructor(
    private readonly config: AgentConfig,
    private readonly logger: AgentLogger,
    private readonly providerKeys: Record<string, string> = {},
  ) {
    this.client = new GatewayClient({
      gatewayUrl: config.gatewayUrl,
      machineToken: config.machineToken,
    });
    this.queue = new EventQueue(this.client, {
      directory: stateDir(),
      renewLeaseSeconds: config.leaseSeconds,
      onError: (error) => this.logger.debug('no se pudieron enviar eventos', describeError(error)),
    });
    mkdirSync(worktreesDir(), { recursive: true });
  }

  /** arranca todos los bucles y no vuelve hasta que se detiene el agente */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.logger.info(`Luxy arrancando como maquina "${this.config.machineName}"`);

    // 1. detectar herramientas y construir los proveedores
    await this.initializeProviders();

    // 2. comprobar que el gateway responde antes de nada
    await this.verifyGateway();

    // 3. bucles independientes que se ejecutan en paralelo
    await Promise.all([this.heartbeatLoop(), this.pollLoop(), this.flushLoop()]);
  }

  private async initializeProviders(): Promise<void> {
    this.logger.info('detectando herramientas locales');

    const enabledHttp = this.config.providers.http.filter(
      (provider) => provider.enabled && typeof this.providerKeys[provider.apiKeyEnv] === 'string',
    );

    const detection = await detectEnvironment(enabledHttp.map((provider) => provider.id));
    for (const line of describeCapabilities(detection.capabilities)) {
      this.logger.info(line);
    }

    // claude y codex usan la sesion local: nunca una api key
    if (this.config.providers.claude.enabled && detection.capabilities.claude.available) {
      const claude = new ClaudeCodeProvider(this.config.providers.claude.model);
      await claude.detect();
      this.providers.set('claude', claude);
    }
    if (this.config.providers.codex.enabled && detection.capabilities.codex.available) {
      const codex = new CodexCliProvider(this.config.providers.codex.model);
      await codex.detect();
      this.providers.set('codex', codex);
    }

    const budgetStore = new MemoryBudgetStore();
    for (const providerConfig of enabledHttp) {
      this.providers.set(
        providerConfig.id as ProviderId,
        new HttpApiProvider(
          providerConfig,
          this.providerKeys[providerConfig.apiKeyEnv],
          budgetStore,
        ),
      );
    }

    // solo se anuncian los proveedores que realmente respondieron a la deteccion
    const confirmed: ProviderId[] = [];
    for (const [id, provider] of this.providers) {
      const presence = await provider.detect();
      if (presence.available) confirmed.push(id);
      else this.logger.warn(`el proveedor "${id}" no quedo disponible`);
    }
    this.availableProviders = confirmed;

    this.logger.info(
      `proveedores disponibles: ${confirmed.length > 0 ? confirmed.join(', ') : 'ninguno'}`,
    );
    if (confirmed.length === 0) {
      this.logger.warn(
        'ningun proveedor disponible: Luxy aceptara trabajos pero no podra ejecutarlos',
      );
    }
  }

  private async verifyGateway(): Promise<void> {
    try {
      const health = await this.client.health();
      this.gatewayConnected = true;
      this.logger.info(`gateway accesible (configurado: ${health.configured})`);
    } catch (error) {
      this.gatewayConnected = false;
      this.logger.warn('no se pudo contactar con el gateway al arrancar', describeError(error));
      this.logger.warn('Luxy seguira reintentando en segundo plano');
    }
  }

  // ---------------------------------------------------------------------------
  // bucles
  // ---------------------------------------------------------------------------

  /** heartbeats periodicos: es lo que marca la maquina como conectada */
  private async heartbeatLoop(): Promise<void> {
    let failures = 0;
    while (!this.stopping) {
      try {
        await this.client.heartbeat({
          activeJobId: this.activeJob?.id ?? null,
          agentVersion: AGENT_VERSION,
          projects: Object.keys(this.config.projects),
        });
        this.lastHeartbeatAt = new Date().toISOString();
        if (!this.gatewayConnected) this.logger.info('conexion con el gateway restablecida');
        this.gatewayConnected = true;
        failures = 0;
      } catch (error) {
        this.gatewayConnected = false;
        failures += 1;
        // solo se avisa las primeras veces, para no llenar el log en un corte largo
        if (failures <= 3) this.logger.warn('fallo el heartbeat', describeError(error));
      }

      const delay =
        failures > 0
          ? computeBackoffDelay(failures - 1, { baseDelayMs: this.config.heartbeatIntervalMs, maxDelayMs: 60_000 })
          : this.config.heartbeatIntervalMs;
      await this.sleep(delay);
    }
  }

  /** polling de trabajos. una maquina ejecuta como maximo maxConcurrentJobs */
  private async pollLoop(): Promise<void> {
    let failures = 0;
    while (!this.stopping) {
      // con un trabajo en curso no se reclama otro
      if (this.activeJob !== null) {
        await this.sleep(this.config.pollIntervalMs);
        continue;
      }
      if (this.availableProviders.length === 0) {
        await this.sleep(5000);
        continue;
      }

      try {
        const job = await this.client.claimJob({
          supportedProviders: this.availableProviders,
          projects: Object.keys(this.config.projects),
          leaseSeconds: this.config.leaseSeconds,
        });
        failures = 0;

        if (job) {
          await this.executeJob(job);
        } else {
          await this.sleep(this.config.pollIntervalMs);
        }
      } catch (error) {
        failures += 1;
        if (failures <= 3) this.logger.warn('fallo consultando trabajos', describeError(error));
        await this.sleep(
          computeBackoffDelay(failures - 1, {
            baseDelayMs: this.config.pollIntervalMs,
            maxDelayMs: 60_000,
          }),
        );
      }
    }
  }

  /** reenvia los eventos que quedaron pendientes por un corte de red */
  private async flushLoop(): Promise<void> {
    while (!this.stopping) {
      if (this.queue.size > 0) {
        await this.queue.flush().catch(() => undefined);
      }
      await this.sleep(2000);
    }
  }

  // ---------------------------------------------------------------------------
  // ejecucion de un trabajo
  // ---------------------------------------------------------------------------

  private async executeJob(job: ClaimedJob): Promise<void> {
    this.activeJob = job;
    this.activeJobStartedAt = new Date().toISOString();
    const abort = new AbortController();
    this.activeAbort = abort;

    this.logger.info(`ejecutando ${job.shortId}`, {
      provider: job.provider,
      project: job.projectAlias,
    });

    // vigilancia de cancelacion y renovacion del lease en paralelo
    const watcher = this.watchForCancellation(job, abort);

    try {
      const outcome = await runJob(job, abort.signal, {
        config: this.config,
        logger: this.logger,
        getProvider: (id) => this.providers.get(id) ?? null,
        emit: (type, message) => {
          this.queue.push(job.id, type, message);
          // los eventos se envian en cuanto se puede, sin bloquear la ejecucion
          void this.queue.flush().catch(() => undefined);
        },
        worktreesDirectory: worktreesDir(),
      });

      // se vacia la cola antes de cerrar, para que el orden sea correcto
      await this.queue.flush().catch(() => undefined);

      switch (outcome.kind) {
        case 'completed':
          await this.client.completeJob(job.id, outcome.result);
          this.logger.info(`${job.shortId} terminado`, {
            filesChanged: outcome.result.filesChanged,
            testsFailed: outcome.result.testsFailed,
          });
          break;
        case 'failed':
          await this.client.failJob(job.id, {
            errorMessage: outcome.errorMessage,
            hasLocalChanges: outcome.hasLocalChanges,
            worktreePath: outcome.worktreePath,
            durationMs: outcome.durationMs,
          });
          this.logger.warn(`${job.shortId} fallido`, { error: outcome.errorMessage });
          break;
        case 'cancelled':
          await this.client.reportCancelled(job.id, {
            modifiedFiles: outcome.modifiedFiles,
            worktreePath: outcome.worktreePath,
            durationMs: outcome.durationMs,
          });
          this.logger.info(`${job.shortId} cancelado`, {
            modifiedFiles: outcome.modifiedFiles.length,
          });
          break;
      }

      this.queue.forget(job.id);
    } catch (error) {
      // el resultado no se pudo entregar pese a los reintentos.
      // queda persistido en el gateway o se recupera con /job <id>.
      this.logger.error('no se pudo cerrar el trabajo en el gateway', {
        jobId: job.id,
        ...describeError(error),
      });
    } finally {
      watcher.stop();
      this.activeJob = null;
      this.activeJobStartedAt = null;
      this.activeAbort = null;
    }
  }

  /**
   * consulta periodicamente si se pidio cancelar y renueva el lease.
   * si el gateway dice que el trabajo ya no es nuestro, se aborta.
   */
  private watchForCancellation(job: ClaimedJob, abort: AbortController): { stop: () => void } {
    let stopped = false;

    const tick = async (): Promise<void> => {
      while (!stopped && !abort.signal.aborted && !this.stopping) {
        await defaultSleep(3000).catch(() => undefined);
        if (stopped) return;

        try {
          const control = await this.client.getJobControl(job.id);
          if (control.cancelRequested) {
            this.logger.info(`cancelacion recibida para ${job.shortId}`);
            // esto propaga el AbortSignal y mata el arbol de procesos
            abort.abort();
            return;
          }
        } catch (error) {
          // un corte de red no debe cancelar el trabajo en curso
          this.logger.debug('no se pudo consultar el control del trabajo', describeError(error));
        }
      }
    };

    void tick();
    return {
      stop: () => {
        stopped = true;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // estado y apagado
  // ---------------------------------------------------------------------------

  getStatus(): AgentStatus {
    return {
      machineName: this.config.machineName,
      gatewayConnected: this.gatewayConnected,
      lastHeartbeatAt: this.lastHeartbeatAt,
      activeJob: this.activeJob
        ? {
            shortId: this.activeJob.shortId,
            provider: this.activeJob.provider,
            projectAlias: this.activeJob.projectAlias,
            startedAt: this.activeJobStartedAt ?? this.startedAt,
          }
        : null,
      projects: Object.keys(this.config.projects),
      providers: this.availableProviders,
      pendingEvents: this.queue.size,
      startedAt: this.startedAt,
    };
  }

  /** true si la maquina se considera conectada segun su ultimo heartbeat */
  isOnline(): boolean {
    return isMachineOnline({ lastSeenAt: this.lastHeartbeatAt, enabled: true });
  }

  /**
   * apagado limpio: cancela el trabajo activo conservando los cambios y
   * vacia la cola de eventos antes de salir.
   */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.logger.info('deteniendo Luxy');

    if (this.activeAbort && this.activeJob) {
      this.logger.info(`interrumpiendo ${this.activeJob.shortId}; los cambios se conservan`);
      this.activeAbort.abort();
    }

    // margen para que el trabajo activo cierre y reporte su estado
    await defaultSleep(1500).catch(() => undefined);
    await this.queue.flush().catch(() => undefined);

    if (this.queue.size > 0) {
      this.logger.warn(`quedan ${this.queue.size} eventos sin enviar; se reenviaran al arrancar`);
    }
    this.running = false;
  }

  /** espera interrumpible por el apagado */
  private async sleep(ms: number): Promise<void> {
    const step = 250;
    let waited = 0;
    while (waited < ms && !this.stopping) {
      await defaultSleep(Math.min(step, ms - waited)).catch(() => undefined);
      waited += step;
    }
  }
}

/** datos de la maquina para el registro */
export function buildMachineIdentity(): {
  hostname: string;
  platform: string;
  platformVersion: string;
  agentVersion: string;
} {
  return {
    hostname: hostname(),
    platform: platform(),
    platformVersion: release(),
    agentVersion: AGENT_VERSION,
  };
}
