// acceso a datos: traduce entre las filas de postgres y los tipos compartidos
import { generateShortId } from '@luxy/shared';
import type { Job, JobOrigin, JobStatus, Machine, ProviderId } from '@luxy/shared';
import { type SupabaseClient, eq, inList } from './supabase.js';

interface MachineRow {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  platform_version: string;
  agent_version: string;
  capabilities: Machine['capabilities'];
  projects: string[] | null;
  last_seen_at: string | null;
  enabled: boolean;
}

interface JobRow {
  id: string;
  short_id: string;
  created_via: JobOrigin;
  telegram_chat_id: number | null;
  telegram_user_id: number | null;
  target_machine_id: string | null;
  provider: ProviderId;
  model: string | null;
  project_alias: string;
  prompt: string;
  status: JobStatus;
  priority: number;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  cancel_requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  result_summary: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function toMachine(row: MachineRow): Machine {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    platform: row.platform,
    platformVersion: row.platform_version,
    agentVersion: row.agent_version,
    capabilities: row.capabilities,
    projects: row.projects ?? [],
    lastSeenAt: row.last_seen_at,
    enabled: row.enabled,
  };
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    shortId: row.short_id,
    origin: row.created_via,
    telegramChatId: row.telegram_chat_id,
    telegramUserId: row.telegram_user_id,
    targetMachineId: row.target_machine_id,
    provider: row.provider,
    model: row.model,
    projectAlias: row.project_alias,
    prompt: row.prompt,
    status: row.status,
    priority: row.priority,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
    cancelRequestedAt: row.cancel_requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    resultSummary: row.result_summary,
    errorMessage: row.error_message,
    metadata: (row.metadata ?? {}) as Job['metadata'],
    createdAt: row.created_at,
  };
}

const MACHINE_COLUMNS =
  'id,name,hostname,platform,platform_version,agent_version,capabilities,projects,last_seen_at,enabled';
const JOB_COLUMNS =
  'id,short_id,created_via,telegram_chat_id,telegram_user_id,target_machine_id,provider,model,project_alias,' +
  'prompt,status,priority,claimed_by,claimed_at,lease_expires_at,cancel_requested_at,' +
  'started_at,completed_at,result_summary,error_message,metadata,created_at';

export class Repository {
  constructor(private readonly db: SupabaseClient) {}

  // ---------------------------------------------------------------------------
  // idempotencia de telegram
  // ---------------------------------------------------------------------------

  /**
   * registra un update. devuelve false si ese update_id ya se habia recibido,
   * en cuyo caso hay que ignorarlo por completo.
   */
  async registerUpdate(updateId: number): Promise<boolean> {
    return this.db.insertIfAbsent(
      'telegram_updates',
      { update_id: updateId, status: 'received' },
      'update_id',
    );
  }

  async markUpdateProcessed(updateId: number, error?: string): Promise<void> {
    await this.db.update(
      'telegram_updates',
      { update_id: eq(updateId) },
      error ? { status: 'failed', error_message: error.slice(0, 1000) } : { status: 'processed' },
    );
  }

  // ---------------------------------------------------------------------------
  // usuarios
  // ---------------------------------------------------------------------------

  async getUserPreference(telegramUserId: number): Promise<string | null> {
    const row = await this.db.selectOne<{ preferred_machine_id: string | null }>('telegram_users', {
      columns: 'preferred_machine_id',
      filters: { telegram_user_id: eq(telegramUserId) },
    });
    return row?.preferred_machine_id ?? null;
  }

  async setUserPreference(
    telegramUserId: number,
    username: string | null,
    machineId: string | null,
  ): Promise<void> {
    await this.db.upsert(
      'telegram_users',
      {
        telegram_user_id: telegramUserId,
        username,
        authorized: true,
        preferred_machine_id: machineId,
      },
      'telegram_user_id',
    );
  }

  // ---------------------------------------------------------------------------
  // maquinas
  // ---------------------------------------------------------------------------

  async listMachines(): Promise<Machine[]> {
    const rows = await this.db.select<MachineRow>('machines', {
      columns: MACHINE_COLUMNS,
      order: 'name.asc',
    });
    return rows.map(toMachine);
  }

  async getMachineByName(name: string): Promise<Machine | null> {
    const row = await this.db.selectOne<MachineRow>('machines', {
      columns: MACHINE_COLUMNS,
      filters: { name: eq(name) },
    });
    return row ? toMachine(row) : null;
  }

  async getMachineById(id: string): Promise<Machine | null> {
    const row = await this.db.selectOne<MachineRow>('machines', {
      columns: MACHINE_COLUMNS,
      filters: { id: eq(id) },
    });
    return row ? toMachine(row) : null;
  }

  /** alta o reactivacion de una maquina: el nombre es la clave estable */
  async upsertMachine(input: {
    name: string;
    hostname: string;
    platform: string;
    platformVersion: string;
    agentVersion: string;
    capabilities: Machine['capabilities'];
    projects: string[];
  }): Promise<Machine> {
    const rows = await this.db.upsert<MachineRow>(
      'machines',
      {
        name: input.name,
        hostname: input.hostname,
        platform: input.platform,
        platform_version: input.platformVersion,
        agent_version: input.agentVersion,
        capabilities: input.capabilities,
        projects: input.projects,
        enabled: true,
        last_seen_at: new Date().toISOString(),
      },
      'name',
    );
    const row = rows[0];
    if (!row) throw new Error('no se pudo registrar la maquina');
    return toMachine(row);
  }

  async createMachineToken(machineId: string, tokenHash: string): Promise<void> {
    await this.db.insert('machine_tokens', { machine_id: machineId, token_hash: tokenHash }, false);
  }

  /** al registrar de nuevo una maquina se revocan sus tokens anteriores */
  async revokeMachineTokens(machineId: string): Promise<void> {
    await this.db.update(
      'machine_tokens',
      { machine_id: eq(machineId), revoked_at: 'is.null' },
      { revoked_at: new Date().toISOString() },
    );
  }

  async recordHeartbeat(
    machineId: string,
    patch: {
      capabilities?: Machine['capabilities'];
      projects?: string[];
      agentVersion?: string;
    },
  ): Promise<void> {
    const values: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
    if (patch.capabilities) values.capabilities = patch.capabilities;
    if (patch.projects) values.projects = patch.projects;
    if (patch.agentVersion) values.agent_version = patch.agentVersion;
    await this.db.update('machines', { id: eq(machineId) }, values);
  }

  // ---------------------------------------------------------------------------
  // trabajos
  // ---------------------------------------------------------------------------

  async createJob(input: {
    origin?: JobOrigin;
    telegramChatId: number | null;
    telegramUserId: number | null;
    targetMachineId: string | null;
    provider: ProviderId;
    model?: string | null;
    projectAlias: string;
    prompt: string;
    status: JobStatus;
    priority?: number;
    metadata: Record<string, unknown>;
  }): Promise<Job> {
    // se reintenta si el identificador corto colisiona, que es improbable
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const rows = await this.db.insert<JobRow>('jobs', {
          short_id: generateShortId(),
          created_via: input.origin ?? 'telegram',
          telegram_chat_id: input.telegramChatId,
          telegram_user_id: input.telegramUserId,
          target_machine_id: input.targetMachineId,
          provider: input.provider,
          model: input.model ?? null,
          project_alias: input.projectAlias,
          prompt: input.prompt,
          status: input.status,
          priority: input.priority ?? 0,
          metadata: input.metadata,
        });
        const row = rows[0];
        if (row) return toJob(row);
      } catch (error) {
        // 409 significa short_id duplicado: se reintenta con otro
        const status = (error as { status?: number }).status;
        if (status !== 409 || attempt === 4) throw error;
      }
    }
    throw new Error('no se pudo generar un identificador de trabajo unico');
  }

  async getJobByShortId(shortId: string): Promise<Job | null> {
    const row = await this.db.selectOne<JobRow>('jobs', {
      columns: JOB_COLUMNS,
      filters: { short_id: eq(shortId) },
    });
    return row ? toJob(row) : null;
  }

  async getJobById(id: string): Promise<Job | null> {
    const row = await this.db.selectOne<JobRow>('jobs', {
      columns: JOB_COLUMNS,
      filters: { id: eq(id) },
    });
    return row ? toJob(row) : null;
  }

  /** trabajos activos, opcionalmente restringidos a una maquina */
  async listActiveJobs(machineId?: string): Promise<Job[]> {
    const filters: Record<string, string> = {
      status: inList([
        'queued',
        'waiting_for_machine',
        'claimed',
        'running',
        'waiting_for_approval',
      ]),
    };
    if (machineId) filters.claimed_by = eq(machineId);
    const rows = await this.db.select<JobRow>('jobs', {
      columns: JOB_COLUMNS,
      filters,
      order: 'created_at.desc',
      limit: 20,
    });
    return rows.map(toJob);
  }

  /** historial de trabajos para Studio, con filtros cerrados de PostgREST */
  async listJobs(
    options: {
      origin?: JobOrigin;
      targetMachineId?: string;
      status?: JobStatus;
      limit?: number;
    } = {},
  ): Promise<Job[]> {
    const filters: Record<string, string> = {};
    if (options.origin !== undefined) filters.created_via = eq(options.origin);
    if (options.targetMachineId !== undefined) {
      filters.target_machine_id = eq(options.targetMachineId);
    }
    if (options.status !== undefined) filters.status = eq(options.status);

    const rows = await this.db.select<JobRow>('jobs', {
      columns: JOB_COLUMNS,
      filters,
      order: 'created_at.desc',
      limit: options.limit ?? 30,
    });
    return rows.map(toJob);
  }

  async updateJob(jobId: string, values: Record<string, unknown>): Promise<Job | null> {
    const rows = await this.db.update<JobRow>('jobs', { id: eq(jobId) }, values);
    const row = rows[0];
    return row ? toJob(row) : null;
  }

  async mergeJobMetadata(jobId: string, patch: Record<string, unknown>): Promise<void> {
    const job = await this.getJobById(jobId);
    if (!job) return;
    await this.db.update('jobs', { id: eq(jobId) }, { metadata: { ...job.metadata, ...patch } });
  }

  /** reclamacion atomica delegada en la funcion postgres */
  async claimJob(
    machineId: string,
    providers: string[],
    projects: string[],
    leaseSeconds: number,
  ): Promise<{
    id: string;
    short_id: string;
    provider: ProviderId;
    project_alias: string;
    prompt: string;
    telegram_chat_id: number | null;
    telegram_user_id: number | null;
    created_via: JobOrigin;
    model: string | null;
    lease_expires_at: string;
    metadata: Record<string, unknown> | null;
  } | null> {
    const rows = await this.db.rpc<
      Array<{
        id: string;
        short_id: string;
        provider: ProviderId;
        project_alias: string;
        prompt: string;
        model: string | null;
        created_via: JobOrigin;
        telegram_chat_id: number | null;
        telegram_user_id: number | null;
        lease_expires_at: string;
        metadata: Record<string, unknown> | null;
      }>
    >('luxy_claim_job', {
      p_machine_id: machineId,
      p_providers: providers,
      p_projects: projects,
      p_lease_seconds: leaseSeconds,
    });
    return Array.isArray(rows) && rows.length > 0 ? rows[0]! : null;
  }

  async renewLease(jobId: string, machineId: string, leaseSeconds: number): Promise<string | null> {
    return this.db.rpc<string | null>('luxy_renew_lease', {
      p_job_id: jobId,
      p_machine_id: machineId,
      p_lease_seconds: leaseSeconds,
    });
  }

  async expireLeases(): Promise<{ requeued: number; interrupted: number }> {
    const rows =
      await this.db.rpc<Array<{ requeued: number; interrupted: number }>>('luxy_expire_leases');
    return rows?.[0] ?? { requeued: 0, interrupted: 0 };
  }

  async requestCancel(jobId: string): Promise<JobStatus | null> {
    return this.db.rpc<JobStatus | null>('luxy_request_cancel', { p_job_id: jobId });
  }

  // ---------------------------------------------------------------------------
  // eventos
  // ---------------------------------------------------------------------------

  /**
   * inserta eventos ignorando duplicados por (job_id, sequence).
   * asi el reenvio de la cola local del agente es idempotente.
   */
  async appendEvents(
    jobId: string,
    events: Array<{
      sequence: number;
      type: string;
      message: string;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (events.length === 0) return;
    await this.db.insertIfAbsent(
      'job_events',
      events.map((event) => ({
        job_id: jobId,
        sequence: event.sequence,
        type: event.type,
        message: event.message,
        metadata: event.metadata ?? {},
      })),
      'job_id,sequence',
    );
  }

  async listEvents(
    jobId: string,
    limit = 50,
  ): Promise<
    Array<{
      sequence: number;
      type: string;
      message: string;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>
  > {
    return this.db.select('job_events', {
      columns: 'sequence,type,message,metadata,created_at',
      filters: { job_id: eq(jobId) },
      order: 'sequence.desc',
      limit,
    });
  }

  // ---------------------------------------------------------------------------
  // aprobaciones
  // ---------------------------------------------------------------------------

  async createApproval(
    jobId: string,
    action: string,
    metadata: Record<string, unknown> = {},
  ): Promise<{ id: string }> {
    const rows = await this.db.insert<{ id: string }>('approvals', {
      job_id: jobId,
      action,
      status: 'pending',
      metadata,
    });
    const row = rows[0];
    if (!row) throw new Error('no se pudo crear la aprobacion');
    return row;
  }

  /**
   * aprobaciones pendientes de los trabajos reclamados por una maquina.
   *
   * el filtro por maquina se hace aqui, no en el handler: asi ninguna ruta
   * puede olvidarse de aplicarlo.
   */
  async listPendingApprovalsForMachine(
    machineId: string,
  ): Promise<{ id: string; job_id: string; action: string; metadata: Record<string, unknown> }[]> {
    const rows = await this.db.select<{
      id: string;
      job_id: string;
      action: string;
      metadata: Record<string, unknown> | null;
    }>('approvals', {
      columns: 'id,job_id,action,metadata',
      filters: { status: eq('approved') },
      order: 'created_at.asc',
      limit: 20,
    });

    const pending: {
      id: string;
      job_id: string;
      action: string;
      metadata: Record<string, unknown>;
    }[] = [];
    for (const row of rows) {
      const job = await this.getJobById(row.job_id);
      // solo las de trabajos de ESTA maquina
      if (!job || job.claimedBy !== machineId) continue;
      pending.push({ ...row, metadata: row.metadata ?? {} });
    }
    return pending;
  }

  /** lee una aprobacion sin resolverla, para comprobar a quien pertenece */
  async getApproval(
    approvalId: string,
  ): Promise<{ id: string; job_id: string; action: string; status: string } | null> {
    const rows = await this.db.select<{
      id: string;
      job_id: string;
      action: string;
      status: string;
    }>('approvals', {
      columns: 'id,job_id,action,status',
      filters: { id: eq(approvalId) },
      limit: 1,
    });
    return rows[0] ?? null;
  }

  async resolveApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
    telegramUserId: number,
  ): Promise<{ id: string; job_id: string; action: string } | null> {
    const rows = await this.db.update<{ id: string; job_id: string; action: string }>(
      'approvals',
      { id: eq(approvalId), status: eq('pending') },
      {
        status: decision,
        resolved_at: new Date().toISOString(),
        resolved_by_telegram_user_id: telegramUserId,
      },
    );
    return rows[0] ?? null;
  }

  async recordProviderUsage(usage: {
    provider: string;
    model: string;
    jobId: string | null;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  }): Promise<void> {
    await this.db.insert(
      'provider_usage',
      {
        provider: usage.provider,
        model: usage.model,
        job_id: usage.jobId,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        estimated_cost: usage.estimatedCost,
      },
      false,
    );
  }
}
