// bucle principal del agente: heartbeats, polling, ejecucion y cancelacion
import { mkdirSync } from 'node:fs';
import { hostname, platform, release } from 'node:os';
import type {
  AgentConfig,
  AgentEvent,
  AgentEventSink,
  AgentStatus,
  ClaimedJob,
  ProviderExecution,
  ProviderId,
  MachineCapabilities,
} from '@luxy/shared';
import {
  defaultSleep,
  computeBackoffDelay,
  isMachineOnline,
  redact,
  LOCAL_CLI_PROVIDERS,
  buildDefaultCatalog,
  ModelRegistry,
  PROVIDER_IDS,
} from '@luxy/shared';
import { GatewayClient } from './gateway-client.js';
import { EventQueue } from './event-queue.js';
import { OutcomeQueue } from './outcome-queue.js';
import { type AgentLogger, describeError } from './logger.js';
import { detectEnvironment, describeCapabilities } from './detect.js';
import { ClaudeCodeProvider } from './providers/claude.js';
import { CodexCliProvider } from './providers/codex.js';
import { HttpApiProvider, MemoryBudgetStore } from './providers/http-provider.js';
import { runLocalTurn, type LocalTurnInput, type LocalTurnResult } from './local-turn.js';
import { runJob } from './job-runner.js';
import { worktreesDir, stateDir, logsDir } from './paths.js';
import { executeApproval, auditFilePath } from './approvals.js';

export const AGENT_VERSION = '0.1.0';

/** techo de espera del apagado: ni se cuelga ni corta el trabajo de inmediato */
const STOP_GRACE_MS = 15_000;

/** espera a la promesa con un techo. devuelve true si termino a tiempo */
async function withTimeout(promise: Promise<void> | null, ms: number): Promise<boolean> {
  if (promise === null) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolveExpired) => {
    timer = setTimeout(() => resolveExpired(false), ms);
    timer.unref?.();
  });
  try {
    // un rechazo tambien cuenta como "termino": lo relevante es que ya no corre
    return await Promise.race([promise.then(() => true).catch(() => true), expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// el tipo vive en shared porque cruza IPC hasta el renderer; se reexporta para
// no romper a quien ya lo importaba desde aqui
export type { AgentStatus } from '@luxy/shared';

/**
 * dependencias inyectables del agente.
 *
 * las carpetas son parametrizables porque el proceso de escritorio usa las rutas
 * de Electron, que no son las mismas que %LOCALAPPDATA%\Luxy.
 */
export interface LuxyAgentOptions {
  stateDirectory?: string;
  worktreesDirectory?: string;
  /** receptor de eventos en el proceso local; nunca debe lanzar */
  onEvent?: AgentEventSink;
  /** avisa cuando el trabajo actual ya libero por completo el agente */
  onIdle?: () => void;
}

/**
 * el agente. solo hace conexiones salientes https: no abre puertos ni expone
 * nada a internet.
 */
export class LuxyAgent {
  private readonly client: GatewayClient;
  private readonly queue: EventQueue;
  private readonly outcomes: OutcomeQueue;
  private readonly providers = new Map<ProviderId, ProviderExecution>();
  private readonly startedAt = new Date().toISOString();

  private readonly worktreesDirectory: string;
  private readonly emitEvent: AgentEventSink;
  private readonly notifyIdle: () => void;

  private running = false;
  private stopping = false;
  private lastHeartbeatAt: string | null = null;
  private gatewayConnected = false;
  private activeJob: ClaimedJob | null = null;
  private activeJobStartedAt: string | null = null;
  private activeAbort: AbortController | null = null;
  private availableProviders: ProviderId[] = [];
  /**
   * capacidades detectadas al arrancar.
   *
   * se reanuncian en cada latido: antes solo se enviaban al REGISTRAR la
   * maquina, asi que el gateway seguia creyendo lo que era cierto ese dia. Si
   * despues configurabas una conexion de API, el gateway no se enteraba nunca y
   * rechazaba /deepseek por "no disponible", sustituyendolo por claude.
   */
  private capabilities: MachineCapabilities | null = null;
  /** promesa de los tres bucles; permite esperar el apagado de verdad */
  private loops: Promise<void> | null = null;
  /** promesa del trabajo en curso; stop() la espera en vez de dormir a ciegas */
  private activeJobPromise: Promise<void> | null = null;
  /**
   * resultados de aprobaciones pendientes de confirmar al gateway.
   *
   * si la accion local termina pero se corta la red, no se ejecuta otra vez:
   * se reenvia el mismo resultado hasta que el gateway lo consume.
   */
  private readonly approvalOutcomes = new Map<string, { ok: boolean; message: string }>();

  constructor(
    private readonly config: AgentConfig,
    private readonly logger: AgentLogger,
    private readonly providerKeys: Record<string, string> = {},
    options: LuxyAgentOptions = {},
  ) {
    this.client = new GatewayClient({
      gatewayUrl: config.gatewayUrl,
      machineToken: config.machineToken,
    });
    const stateDirectory = options.stateDirectory ?? stateDir();
    this.queue = new EventQueue(this.client, {
      directory: stateDirectory,
      renewLeaseSeconds: config.leaseSeconds,
      onError: (error) => this.logger.debug('no se pudieron enviar eventos', describeError(error)),
    });
    this.outcomes = new OutcomeQueue(this.client, {
      directory: stateDirectory,
      onError: (error) =>
        this.logger.debug('no se pudo entregar un resultado final', describeError(error)),
    });
    this.worktreesDirectory = options.worktreesDirectory ?? worktreesDir();
    this.emitEvent = options.onEvent ?? ((): void => undefined);
    this.notifyIdle = options.onIdle ?? ((): void => undefined);
    mkdirSync(this.worktreesDirectory, { recursive: true });
  }

  /**
   * un receptor de eventos que lance no puede tumbar el agente: el consumidor
   * es la interfaz, y la interfaz no manda sobre la ejecucion de un trabajo.
   */
  private emit(event: AgentEvent): void {
    try {
      this.emitEvent(event);
    } catch {
      /* un consumidor roto no interrumpe el trabajo */
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  /**
   * arranca los bucles y devuelve el control en cuanto el agente esta corriendo.
   *
   * antes esta funcion no volvia nunca. el proceso de escritorio necesita
   * recuperar el control para pintar el estado, y la CLI espera con
   * waitUntilStopped().
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;

    this.logger.info(`Luxy arrancando como maquina "${this.config.machineName}"`);

    try {
      // 1. detectar herramientas y construir los proveedores
      await this.initializeProviders();

      // 2. comprobar que el gateway responde antes de nada
      await this.verifyGateway();
    } catch (error) {
      this.running = false;
      this.emit({
        type: 'agent.error',
        at: this.now(),
        message: redact(describeError(error).message),
      });
      throw error;
    }

    // 3. bucles independientes que se ejecutan en paralelo
    this.loops = Promise.all([
      this.heartbeatLoop(),
      this.pollLoop(),
      this.flushLoop(),
      this.approvalLoop(),
    ]).then(() => undefined);
    // un fallo de un bucle no debe quedar como rechazo sin capturar
    this.loops.catch((error) => {
      this.logger.error('un bucle del agente termino con error', describeError(error));
      this.emit({
        type: 'agent.error',
        at: this.now(),
        message: redact(describeError(error).message),
      });
    });

    this.emit({ type: 'agent.started', at: this.now() });
  }

  /** espera hasta que el agente se detenga. es lo que usa la CLI */
  async waitUntilStopped(): Promise<void> {
    await this.loops?.catch(() => undefined);
  }

  /**
   * ejecuta un turno privado en esta maquina, sin cola y sin gateway.
   *
   * Es el unico trabajo que no se reclama: llega por memoria desde el proceso
   * principal. Usa los mismos proveedores ya detectados y las mismas claves,
   * pero ni encola eventos ni persiste el resultado, asi que nada de este turno
   * llega a Supabase. Ver local-turn.ts.
   *
   * Exige el agente en marcha porque los proveedores se construyen al arrancar.
   */
  async runPrivateTurn(
    input: LocalTurnInput,
    signal: AbortSignal,
    onProgress: (type: string, message: string) => void,
  ): Promise<LocalTurnResult> {
    if (this.providers.size === 0) {
      throw new Error('el agente no tiene proveedores disponibles en esta maquina');
    }
    return runLocalTurn(input, signal, {
      config: this.config,
      logger: this.logger,
      getProvider: (id) => this.providers.get(id) ?? null,
      worktreesDirectory: this.worktreesDirectory,
      apiKeyFor: (connectionId) => this.providerKeys[`connection:${connectionId}`],
      onProgress,
    });
  }

  private async initializeProviders(): Promise<void> {
    this.logger.info('detectando herramientas locales');

    const enabledHttp = this.config.providers.http.filter(
      (provider) => provider.enabled && typeof this.providerKeys[provider.apiKeyEnv] === 'string',
    );

    const detection = await detectEnvironment(enabledHttp.map((provider) => provider.id));
    this.capabilities = detection.capabilities;
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

    // una conexion sirve muchas familias: se registra un proveedor por familia
    // apuntando al mismo endpoint. El modelo concreto lo fija cada trabajo, asi
    // que basta con el predeterminado de la familia como valor de partida.
    for (const family of this.buildFamilyProviders(budgetStore)) {
      if (!this.providers.has(family.id)) this.providers.set(family.id, family.provider);
    }

    // solo se anuncian los proveedores que realmente respondieron a la deteccion
    const confirmed: ProviderId[] = [];
    for (const [id, provider] of this.providers) {
      const presence = await provider.detect();
      if (presence.available) confirmed.push(id);
      else this.logger.warn(`el proveedor "${id}" no quedo disponible`);
    }
    this.availableProviders = confirmed;

    // lo que se anuncia es lo que de verdad respondio a la deteccion, no lo que
    // habia escrito en la configuracion
    if (this.capabilities !== null) {
      this.capabilities = {
        ...this.capabilities,
        httpProviders: confirmed.filter(
          (id) => !LOCAL_CLI_PROVIDERS.includes(id as (typeof LOCAL_CLI_PROVIDERS)[number]),
        ),
      };
    }

    this.logger.info(
      `proveedores disponibles: ${confirmed.length > 0 ? confirmed.join(', ') : 'ninguno'}`,
    );
    if (confirmed.length === 0) {
      this.logger.warn(
        'ningun proveedor disponible: Luxy aceptara trabajos pero no podra ejecutarlos',
      );
    }
  }

  /**
   * proveedores derivados del catalogo de modelos.
   *
   * antes solo existian los tres de providers.http, escritos a mano en la
   * configuracion. Ahora cada familia del catalogo que tenga conexion con clave
   * se registra sola, que es lo que hace que /kimi o /kat lleguen a ejecutarse.
   */
  private buildFamilyProviders(
    budget: MemoryBudgetStore,
  ): { id: ProviderId; provider: HttpApiProvider }[] {
    const built: { id: ProviderId; provider: HttpApiProvider }[] = [];

    for (const connection of this.config.connections) {
      if (!connection.enabled) continue;
      const apiKey = this.providerKeys[`connection:${connection.id}`];
      if (typeof apiKey !== 'string' || apiKey.length === 0) continue;

      const registry = new ModelRegistry({
        connections: [connection],
        models: buildDefaultCatalog(connection.id),
      });

      for (const family of registry.listFamilies()) {
        // solo familias que son proveedores ejecutables del contrato
        if (!(PROVIDER_IDS as readonly string[]).includes(family)) continue;
        const preferred = registry.defaultForFamily(family);
        if (preferred === null || !preferred.enabled) continue;

        built.push({
          id: family as ProviderId,
          provider: new HttpApiProvider(
            {
              id: family,
              displayName: preferred.displayName,
              baseUrl: connection.baseUrl,
              model: preferred.apiModel,
              // la clave ya viene del almacen cifrado, no de una variable
              apiKeyEnv: `connection:${connection.id}`,
              enabled: true,
              supportsStreaming: preferred.supportsStreaming,
              maxOutputTokens: preferred.maxOutputTokens,
              dailyBudget: preferred.limits.dailyBudget,
            },
            apiKey,
            budget,
          ),
        });
      }
    }
    return built;
  }

  private async verifyGateway(): Promise<void> {
    try {
      const health = await this.client.health();
      this.gatewayConnected = true;
      this.logger.info(`gateway accesible (configurado: ${health.configured})`);
      this.emit({ type: 'gateway.connected', at: this.now() });
    } catch (error) {
      this.gatewayConnected = false;
      this.logger.warn('no se pudo contactar con el gateway al arrancar', describeError(error));
      this.logger.warn('Luxy seguira reintentando en segundo plano');
      this.emit({
        type: 'gateway.disconnected',
        at: this.now(),
        message: redact(describeError(error).message),
      });
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
          // sin esto el gateway se queda con las capacidades del registro y
          // nunca se entera de las conexiones que configures despues
          ...(this.capabilities === null ? {} : { capabilities: this.capabilities }),
        });
        this.lastHeartbeatAt = new Date().toISOString();
        if (!this.gatewayConnected) {
          this.logger.info('conexion con el gateway restablecida');
          this.emit({ type: 'gateway.connected', at: this.now() });
        }
        this.gatewayConnected = true;
        failures = 0;
        this.emit({ type: 'heartbeat.updated', at: this.lastHeartbeatAt });
      } catch (error) {
        const wasConnected = this.gatewayConnected;
        this.gatewayConnected = false;
        failures += 1;

        // un 401 no es un corte de red: el token no vale, y reintentar en bucle
        // solo esconde el problema. Se dice lo que hay que hacer.
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 403) {
          const message =
            'El token de la maquina no es valido o no se ha cargado. Vuelve a registrar la maquina.';
          this.logger.error(message, { status });
          this.emit({ type: 'agent.error', at: this.now(), message });
          this.stopping = true;
          break;
        }

        // solo se avisa las primeras veces, para no llenar el log en un corte largo
        if (failures <= 3) this.logger.warn('fallo el heartbeat', describeError(error));
        if (wasConnected) {
          this.emit({
            type: 'gateway.disconnected',
            at: this.now(),
            message: redact(describeError(error).message),
          });
        }
      }

      const delay =
        failures > 0
          ? computeBackoffDelay(failures - 1, {
              baseDelayMs: this.config.heartbeatIntervalMs,
              maxDelayMs: 60_000,
            })
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
          // se guarda la promesa para que stop() pueda esperarla de verdad
          this.activeJobPromise = this.executeJob(job);
          try {
            await this.activeJobPromise;
          } finally {
            this.activeJobPromise = null;
          }
        } else {
          await this.sleep(this.config.pollIntervalMs);
        }
      } catch (error) {
        failures += 1;

        // un 422 al reclamar no es un corte de red: el gateway no entiende lo
        // que le mandamos, casi siempre porque esta desplegada una version
        // anterior que no conoce las familias de modelos nuevas. Reintentar en
        // bucle cada pocos segundos solo esconde el problema.
        const status = (error as { status?: number }).status;
        if (status === 422 && failures === 1) {
          const message =
            'El gateway rechaza la peticion del agente. Suele significar que el gateway ' +
            'desplegado es de una version anterior y no reconoce alguna familia de modelos. ' +
            'Vuelve a desplegar el gateway y aplica las migraciones pendientes.';
          this.logger.error(message, { status, providers: this.availableProviders.join(', ') });
          this.emit({ type: 'agent.error', at: this.now(), message });
        } else if (failures <= 3) {
          this.logger.warn('fallo consultando trabajos', describeError(error));
        }
        await this.sleep(
          computeBackoffDelay(failures - 1, {
            baseDelayMs: this.config.pollIntervalMs,
            maxDelayMs: 60_000,
          }),
        );
      }
    }
  }

  /**
   * ejecuta las aprobaciones que el usuario haya confirmado.
   *
   * el gateway solo devuelve las de trabajos de esta maquina, pero eso no
   * basta: las politicas del proyecto se vuelven a comprobar en executeApproval
   * antes de tocar nada. Que llegue una orden no significa que se pueda hacer.
   */
  private async approvalLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        const pending = await this.client.listPendingApprovals();
        const visible = new Set(pending.map((approval) => approval.approvalId));
        for (const approvalId of this.approvalOutcomes.keys()) {
          if (!visible.has(approvalId)) this.approvalOutcomes.delete(approvalId);
        }
        for (const approval of pending) {
          if (this.stopping) break;

          let cached = this.approvalOutcomes.get(approval.approvalId);
          if (cached === undefined) {
            const outcome = await executeApproval(
              {
                approvalId: approval.approvalId,
                jobId: approval.jobId,
                shortId: approval.shortId,
                action: approval.action,
                projectAlias: approval.projectAlias,
                worktreePath: approval.worktreePath,
                branch: approval.branch,
                message: approval.message ?? undefined,
                confirmedTwice: approval.confirmedTwice,
                source: approval.source,
                requestedBy: approval.requestedBy,
              },
              {
                config: this.config,
                worktreesDirectory: this.worktreesDirectory,
                auditFile: auditFilePath(logsDir()),
              },
            );

            cached = {
              ok: outcome.ok,
              message: outcome.message,
            };
            this.approvalOutcomes.set(approval.approvalId, cached);
            this.logger.info(`aprobacion ${approval.action} de ${approval.shortId}`, {
              ok: outcome.ok,
              deniedBy: outcome.deniedBy,
            });
            this.queue.push(
              approval.jobId,
              outcome.ok ? 'phase' : 'warning',
              `${approval.action}: ${outcome.message}`,
            );
            void this.queue.flush().catch(() => undefined);
            this.emit({
              type: 'approval.resolved',
              at: this.now(),
              jobId: approval.jobId,
              shortId: approval.shortId,
              action: approval.action,
              ok: outcome.ok,
              message: outcome.message,
            });
          }

          try {
            await this.client.completeApproval(approval.approvalId, cached.ok, cached.message);
            this.approvalOutcomes.delete(approval.approvalId);
          } catch {
            // la accion ya ocurrio: el siguiente polling reenvia el resultado,
            // nunca vuelve a tocar git ni convierte un exito en un rechazo
          }
        }
      } catch (error) {
        this.logger.debug('no se pudieron consultar las aprobaciones', describeError(error));
      }
      await this.sleep(5000);
    }
  }

  /** reenvia los eventos que quedaron pendientes por un corte de red */
  private async flushLoop(): Promise<void> {
    while (!this.stopping) {
      if (this.queue.size > 0) {
        await this.queue.flush().catch(() => undefined);
      }
      if (this.outcomes.size > 0) {
        await this.outcomes.flush().catch(() => undefined);
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
    this.emit({
      type: 'job.claimed',
      at: this.activeJobStartedAt,
      jobId: job.id,
      shortId: job.shortId,
      provider: job.provider,
      projectAlias: job.projectAlias,
    });

    // vigilancia de cancelacion y renovacion del lease en paralelo
    const watcher = this.watchForCancellation(job, abort);

    try {
      const outcome = await runJob(job, abort.signal, {
        config: this.config,
        logger: this.logger,
        getProvider: (id) => this.providers.get(id) ?? null,
        emit: (type, message, metadata) => {
          this.queue.push(job.id, type, message, metadata);
          // los eventos se envian en cuanto se puede, sin bloquear la ejecucion
          void this.queue.flush().catch(() => undefined);
          // el mismo evento alimenta la interfaz local sin pasar por la red
          this.emitJobProgress(job, type, message);
        },
        worktreesDirectory: this.worktreesDirectory,
        downloadAttachment: () => this.client.downloadAttachment(job.id),
        apiKeyFor: (connectionId) => this.providerKeys[`connection:${connectionId}`],
      });

      // se vacia la cola antes de cerrar, para que el orden sea correcto
      await this.queue.flush().catch(() => undefined);

      switch (outcome.kind) {
        case 'completed':
          // se persiste ANTES de llamar al gateway. Si la red cae o el proceso
          // termina, flushLoop lo reenvia al volver a arrancar.
          this.outcomes.pushCompleted(job.id, outcome.result);
          await this.outcomes.flush();
          this.logger.info(`${job.shortId} terminado`, {
            filesChanged: outcome.result.filesChanged,
            testsFailed: outcome.result.testsFailed,
          });
          this.emit({
            type: 'job.completed',
            at: this.now(),
            jobId: job.id,
            shortId: job.shortId,
            summary: outcome.result.summary,
            filesChanged: outcome.result.filesChanged,
            testsPassed: outcome.result.testsPassed,
            testsFailed: outcome.result.testsFailed,
            durationMs: outcome.result.durationMs,
            worktreePath: outcome.result.worktreePath,
            branch: outcome.result.branch,
            projectAlias: job.projectAlias,
          });
          break;
        case 'failed': {
          const payload = {
            errorMessage: outcome.errorMessage,
            hasLocalChanges: outcome.hasLocalChanges,
            worktreePath: outcome.worktreePath,
            durationMs: outcome.durationMs,
            ...(outcome.executedModel === undefined
              ? {}
              : { executedModel: outcome.executedModel }),
          };
          this.outcomes.pushFailed(job.id, payload);
          await this.outcomes.flush();
          this.logger.warn(`${job.shortId} fallido`, { error: outcome.errorMessage });
          this.emit({
            type: 'job.failed',
            at: this.now(),
            jobId: job.id,
            shortId: job.shortId,
            errorMessage: outcome.errorMessage,
            worktreePath: outcome.worktreePath ?? null,
          });
          break;
        }
        case 'cancelled': {
          const payload = {
            modifiedFiles: outcome.modifiedFiles,
            worktreePath: outcome.worktreePath,
            durationMs: outcome.durationMs,
            // lo generado antes de parar viaja con la cancelacion (`P0.6d`)
            ...(outcome.partialText === undefined ? {} : { partialText: outcome.partialText }),
            ...(outcome.responseTermination === undefined
              ? {}
              : { responseTermination: outcome.responseTermination }),
            ...(outcome.executedModel === undefined
              ? {}
              : { executedModel: outcome.executedModel }),
          };
          this.outcomes.pushCancelled(job.id, payload);
          await this.outcomes.flush();
          this.logger.info(`${job.shortId} cancelado`, {
            modifiedFiles: outcome.modifiedFiles.length,
          });
          this.emit({
            type: 'job.cancelled',
            at: this.now(),
            jobId: job.id,
            shortId: job.shortId,
            modifiedFiles: outcome.modifiedFiles.length,
            worktreePath: outcome.worktreePath ?? null,
          });
          break;
        }
      }

      if (this.outcomes.has(job.id)) {
        this.logger.warn('el resultado final queda pendiente de reenvio', { jobId: job.id });
      }
      this.queue.forget(job.id);
    } catch (error) {
      this.logger.error('no se pudo cerrar el trabajo en el gateway', {
        jobId: job.id,
        ...describeError(error),
      });
    } finally {
      watcher.stop();
      this.activeJob = null;
      this.activeJobStartedAt = null;
      this.activeAbort = null;
      try {
        this.notifyIdle();
      } catch {
        /* una notificacion local rota no altera el resultado del trabajo */
      }
    }
  }

  /** traduce los eventos del runner al contrato que consume la interfaz local */
  private emitJobProgress(
    job: ClaimedJob,
    type: 'phase' | 'log' | 'provider_output' | 'test_result' | 'warning',
    message: string,
  ): void {
    const common = { at: this.now(), jobId: job.id, shortId: job.shortId, message };
    switch (type) {
      case 'phase':
        this.emit({ type: 'job.phase', ...common });
        break;
      case 'test_result':
        this.emit({ type: 'job.tests', ...common });
        break;
      case 'warning':
        this.emit({ type: 'job.warning', ...common });
        break;
      default:
        this.emit({ type: 'job.output', ...common });
        break;
    }
  }

  /**
   * consulta periodicamente si se pidio cancelar Y renueva el lease.
   *
   * la renovacion tiene que estar aqui, no en la cola de eventos: la cola no
   * envia nada cuando no hay eventos pendientes, asi que un modelo que tarda
   * minutos sin decir nada dejaba caducar el lease y el barrido del gateway
   * marcaba el trabajo como interrumpido mientras seguia vivo.
   */
  private watchForCancellation(job: ClaimedJob, abort: AbortController): { stop: () => void } {
    let stopped = false;

    const tick = async (): Promise<void> => {
      while (!stopped && !abort.signal.aborted && !this.stopping) {
        await defaultSleep(3000).catch(() => undefined);
        if (stopped) return;

        try {
          const control = await this.client.getJobControl(job.id, this.config.leaseSeconds);
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
      // los cierres pendientes tambien son entregas de red; se muestran en el
      // mismo contador para que nunca queden invisibles en la interfaz.
      pendingEvents: this.queue.size + this.outcomes.size,
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
  async stop(reason = 'peticion de parada'): Promise<void> {
    if (this.stopping || !this.running) return;
    this.stopping = true;
    this.logger.info('deteniendo Luxy');

    if (this.activeAbort && this.activeJob) {
      this.logger.info(`interrumpiendo ${this.activeJob.shortId}; los cambios se conservan`);
      this.activeAbort.abort();
    }

    // se espera al trabajo en curso de verdad, con un techo para no colgar el
    // apagado si el proveedor ignora la cancelacion
    await withTimeout(this.activeJobPromise, STOP_GRACE_MS);
    // y despues a que los tres bucles vean stopping y salgan
    const loopsFinished = await withTimeout(this.loops, STOP_GRACE_MS);

    await this.queue.flush().catch(() => undefined);
    await this.outcomes.flush().catch(() => undefined);

    if (this.queue.size > 0 || this.outcomes.size > 0) {
      this.logger.warn(
        `quedan ${this.queue.size} eventos y ${this.outcomes.size} resultados sin enviar; ` +
          'se reenviaran al arrancar',
      );
    }

    this.running = false;
    if (loopsFinished) {
      this.loops = null;
      // stopping solo vuelve a false cuando los bucles han salido de verdad:
      // si se reseteara antes, un bucle superviviente seguiria girando. esto es
      // lo que permite "reiniciar agente" desde la bandeja.
      this.stopping = false;
    } else {
      this.logger.warn('los bucles no terminaron a tiempo; no se puede reutilizar esta instancia');
    }
    this.emit({ type: 'agent.stopped', at: this.now(), reason });
  }

  /** true si los bucles estan corriendo */
  get isRunning(): boolean {
    return this.running;
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
