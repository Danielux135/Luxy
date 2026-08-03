// cliente http del gateway. solo conexiones salientes https.
import {
  pendingApprovalsResponseSchema,
  retryWithBackoff,
  machineRegisterResponseSchema,
  claimResponseSchema,
  jobControlResponseSchema,
  heartbeatResponseSchema,
  studioJobActionResponseSchema,
  studioJobResponseSchema,
  studioJobsResponseSchema,
  studioOptionsResponseSchema,
} from '@luxy/shared';
import type {
  PendingApproval,
  ClaimedJob,
  JobControl,
  MachineCapabilities,
  JobEventInput,
  JobCompleteRequest,
  JobFailRequest,
  JobCancelledRequest,
  StudioJob,
  StudioJobActionRequest,
  StudioJobCreateRequest,
  StudioJobEvent,
  StudioMachine,
} from '@luxy/shared';

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * un error merece reintento si es de red o si el servidor esta temporalmente
 * mal. un 401 o un 422 no se reintentan: no van a mejorar solos.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof GatewayError) return error.retryable;
  // fallos de fetch (dns caido, router reiniciando, sin internet)
  return true;
}

export interface GatewayClientOptions {
  gatewayUrl: string;
  machineToken: string;
  /** timeout por peticion */
  timeoutMs?: number;
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: GatewayClientOptions) {
    this.baseUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { auth?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.auth !== false) {
      headers.Authorization = `Bearer ${this.options.machineToken}`;
    }

    // timeout propio combinado con la cancelacion externa
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        // 4xx no se reintenta salvo 408 y 429
        const retryable =
          response.status >= 500 || response.status === 408 || response.status === 429;
        throw new GatewayError(
          `el gateway respondio ${response.status}: ${text.slice(0, 300)}`,
          response.status,
          retryable,
        );
      }

      const text = await response.text();
      return (text.length > 0 ? JSON.parse(text) : undefined) as T;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  /** peticion con reintentos y backoff, para todo lo que tolere esperar */
  private async requestWithRetry<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { auth?: boolean; signal?: AbortSignal; maxAttempts?: number } = {},
  ): Promise<T> {
    return retryWithBackoff(() => this.request<T>(method, path, body, options), {
      maxAttempts: options.maxAttempts ?? 5,
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      shouldRetry: isRetryableError,
      signal: options.signal,
    });
  }

  /** comprueba que el gateway responde antes de intentar nada mas */
  async health(): Promise<{ status: string; configured: boolean }> {
    return this.request('GET', '/health', undefined, { auth: false });
  }

  /** alta de la maquina. devuelve el token, que solo se entrega una vez. */
  static async register(
    gatewayUrl: string,
    payload: {
      registrationSecret: string;
      name: string;
      hostname: string;
      platform: string;
      platformVersion: string;
      agentVersion: string;
      capabilities: MachineCapabilities;
      projects: string[];
    },
  ): Promise<{ machineId: string; machineToken: string; name: string }> {
    const response = await fetch(`${gatewayUrl.replace(/\/+$/, '')}/api/machines/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new GatewayError(
        `el registro fallo con ${response.status}: ${text.slice(0, 300)}`,
        response.status,
        false,
      );
    }
    return machineRegisterResponseSchema.parse(await response.json());
  }

  async heartbeat(payload: {
    capabilities?: MachineCapabilities;
    projects?: string[];
    activeJobId?: string | null;
    agentVersion?: string;
  }): Promise<{ offlineAfterSeconds: number }> {
    const raw = await this.requestWithRetry('POST', '/api/machines/heartbeat', payload, {
      maxAttempts: 3,
    });
    return heartbeatResponseSchema.parse(raw);
  }

  /** intenta reclamar un trabajo. devuelve null si no hay ninguno pendiente. */
  async claimJob(payload: {
    supportedProviders: string[];
    projects: string[];
    leaseSeconds?: number;
  }): Promise<ClaimedJob | null> {
    const raw = await this.request('POST', '/api/jobs/claim', payload);
    return claimResponseSchema.parse(raw).job;
  }

  /** opciones reales de maquina, proyecto y proveedor para Luxy Studio */
  async studioOptions(): Promise<StudioMachine[]> {
    const raw = await this.request('GET', '/api/studio/options');
    return studioOptionsResponseSchema.parse(raw).machines;
  }

  /** crea una tarea desde Studio sin depender de Telegram */
  async createStudioJob(
    payload: StudioJobCreateRequest,
  ): Promise<{ job: StudioJob; events: StudioJobEvent[] }> {
    const raw = await this.request('POST', '/api/studio/jobs', payload);
    return studioJobResponseSchema.parse(raw);
  }

  async listStudioJobs(
    filters: {
      targetMachineId?: string;
      status?: string;
      limit?: number;
    } = {},
  ): Promise<StudioJob[]> {
    const query = new URLSearchParams();
    if (filters.targetMachineId !== undefined) {
      query.set('targetMachineId', filters.targetMachineId);
    }
    if (filters.status !== undefined) query.set('status', filters.status);
    if (filters.limit !== undefined) query.set('limit', String(filters.limit));
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    const raw = await this.request('GET', `/api/studio/jobs${suffix}`);
    return studioJobsResponseSchema.parse(raw).jobs;
  }

  async getStudioJob(jobId: string): Promise<{ job: StudioJob; events: StudioJobEvent[] }> {
    const raw = await this.request('GET', `/api/studio/jobs/${encodeURIComponent(jobId)}`);
    return studioJobResponseSchema.parse(raw);
  }

  async cancelStudioJob(jobId: string): Promise<void> {
    await this.request('POST', `/api/studio/jobs/${encodeURIComponent(jobId)}/cancel`);
  }

  /** aplica o descarta los cambios a traves de la maquina que posee el worktree */
  async requestStudioJobAction(
    jobId: string,
    payload: StudioJobActionRequest,
  ): Promise<{ approvalId: string; job: StudioJob }> {
    const raw = await this.request(
      'POST',
      `/api/studio/jobs/${encodeURIComponent(jobId)}/action`,
      payload,
    );
    return studioJobActionResponseSchema.parse(raw);
  }

  /**
   * descarga el adjunto de un trabajo.
   *
   * el agente no habla con Telegram: se lo pide al gateway, que hace de
   * intermediario y es el unico que tiene el token del bot.
   */
  async downloadAttachment(jobId: string): Promise<Buffer> {
    const response = await fetch(
      `${this.baseUrl}/api/jobs/${encodeURIComponent(jobId)}/attachment`,
      { headers: { Authorization: `Bearer ${this.options.machineToken}` } },
    );
    if (!response.ok) {
      throw new GatewayError(
        `no se pudo descargar el adjunto (${response.status})`,
        response.status,
        response.status >= 500,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** aprobaciones que esta maquina debe ejecutar */
  async listPendingApprovals(): Promise<PendingApproval[]> {
    const raw = await this.request('GET', '/api/approvals/pending');
    return pendingApprovalsResponseSchema.parse(raw).approvals;
  }

  /** informa del resultado real despues de ejecutar una aprobacion */
  async completeApproval(approvalId: string, ok: boolean, message: string): Promise<void> {
    await this.request('POST', `/api/approvals/${encodeURIComponent(approvalId)}/complete`, {
      ok,
      message,
    });
  }

  /**
   * consulta si se pidio cancelar el trabajo y, de paso, renueva el lease.
   *
   * la renovacion va aqui porque esta consulta ocurre cada pocos segundos
   * mientras el trabajo vive. Cuando solo viajaba con los eventos, un modelo
   * lento y callado dejaba caducar el lease y el barrido daba el trabajo por
   * interrumpido mientras seguia ejecutandose.
   */
  async getJobControl(jobId: string, renewLeaseSeconds?: number): Promise<JobControl> {
    const query =
      renewLeaseSeconds === undefined ? '' : `?renewLease=${encodeURIComponent(renewLeaseSeconds)}`;
    const raw = await this.request('GET', `/api/jobs/${encodeURIComponent(jobId)}/control${query}`);
    const parsed = jobControlResponseSchema.parse(raw);
    return {
      status: parsed.status,
      cancelRequested: parsed.cancelRequested,
      leaseExpiresAt: parsed.leaseExpiresAt,
    };
  }

  /** envia eventos y renueva el lease en la misma peticion */
  async sendEvents(
    jobId: string,
    events: JobEventInput[],
    renewLeaseSeconds?: number,
  ): Promise<void> {
    await this.request('POST', `/api/jobs/${encodeURIComponent(jobId)}/events`, {
      events,
      renewLeaseSeconds,
    });
  }

  /**
   * el resultado final se reintenta con mas insistencia: no puede perderse.
   */
  async completeJob(jobId: string, payload: JobCompleteRequest): Promise<void> {
    await this.requestWithRetry(
      'POST',
      `/api/jobs/${encodeURIComponent(jobId)}/complete`,
      payload,
      { maxAttempts: 10 },
    );
  }

  async failJob(jobId: string, payload: JobFailRequest): Promise<void> {
    await this.requestWithRetry('POST', `/api/jobs/${encodeURIComponent(jobId)}/fail`, payload, {
      maxAttempts: 10,
    });
  }

  async reportCancelled(jobId: string, payload: JobCancelledRequest): Promise<void> {
    await this.requestWithRetry(
      'POST',
      `/api/jobs/${encodeURIComponent(jobId)}/cancelled`,
      payload,
      { maxAttempts: 10 },
    );
  }
}
