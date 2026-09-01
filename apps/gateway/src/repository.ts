// acceso a datos: traduce entre las filas de postgres y los tipos compartidos
import { generateShortId } from '@luxy/shared';
import type { Job, JobOrigin, JobStatus, Machine, PrivateRecord, ProviderId } from '@luxy/shared';
import { type SupabaseClient, eq, gte, inList } from './supabase.js';
// una sola definicion de la fila: dos copias se desincronizan en cuanto una
// columna nueva entra por un lado y no por el otro
import type { VaultUserRow } from './vault-auth.js';

const VAULT_USER_COLUMNS =
  'id,email,auth_salt,argon2_t,argon2_m,argon2_p,auth_hash,wrapped_master_key,' +
  'recovery_salt,recovery_argon2_t,recovery_argon2_m,recovery_argon2_p,' +
  'recovery_auth_hash,recovery_wrapped_master_key,vault_id,disabled';

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
      projectAlias?: string;
      status?: JobStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Job[]> {
    const filters: Record<string, string> = {};
    if (options.origin !== undefined) filters.created_via = eq(options.origin);
    if (options.targetMachineId !== undefined) {
      filters.target_machine_id = eq(options.targetMachineId);
    }
    if (options.projectAlias !== undefined) filters.project_alias = eq(options.projectAlias);
    if (options.status !== undefined) filters.status = eq(options.status);

    const rows = await this.db.select<JobRow>('jobs', {
      columns: JOB_COLUMNS,
      filters,
      order: 'created_at.desc',
      limit: options.limit ?? 30,
      offset: options.offset ?? 0,
    });
    return rows.map(toJob);
  }

  async updateJob(jobId: string, values: Record<string, unknown>): Promise<Job | null> {
    const rows = await this.db.update<JobRow>('jobs', { id: eq(jobId) }, values);
    const row = rows[0];
    return row ? toJob(row) : null;
  }

  /**
   * cierra una conversacion cancelada sin esperar a un agente que pudo morir.
   *
   * el filtro de estado hace que una respuesta que termino en paralelo nunca
   * sea sobrescrita por la cancelacion. Solo se usa despues de comprobar en el
   * handler que es una conversacion propia de Studio y, por tanto, sin cambios.
   */
  async finishConversationCancellation(jobId: string): Promise<Job | null> {
    const rows = await this.db.update<JobRow>(
      'jobs',
      {
        id: eq(jobId),
        status: inList(['queued', 'waiting_for_machine', 'claimed', 'running']),
      },
      {
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        lease_expires_at: null,
      },
    );
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
      order: 'requested_at.asc',
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

  /**
   * consume una aprobacion despues de ejecutarla en la maquina.
   *
   * `expired` significa aqui que la orden aprobada ya se consumio. Mantener la
   * fila permite auditarla y, a la vez, evita que vuelva a salir en el polling.
   */
  async completeApproval(
    approvalId: string,
    ok: boolean,
  ): Promise<{ id: string; job_id: string; action: string } | null> {
    const rows = await this.db.update<{ id: string; job_id: string; action: string }>(
      'approvals',
      { id: eq(approvalId), status: eq('approved') },
      {
        status: ok ? 'expired' : 'rejected',
        resolved_at: new Date().toISOString(),
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

  // ---------------------------------------------------------------------------
  // boveda privada
  //
  // Todo lo que pasa por aqui esta cifrado. El repositorio mueve filas; no hay
  // ninguna operacion que pueda leer el contenido, porque no tiene la llave.
  // ---------------------------------------------------------------------------

  // --- cuentas ---

  async getVaultUserByEmail(email: string): Promise<VaultUserRow | null> {
    return this.db.selectOne<VaultUserRow>('vault_users', {
      columns: VAULT_USER_COLUMNS,
      filters: { email: eq(email) },
    });
  }

  async getVaultUserById(id: string): Promise<VaultUserRow | null> {
    return this.db.selectOne<VaultUserRow>('vault_users', {
      columns: VAULT_USER_COLUMNS,
      filters: { id: eq(id) },
    });
  }

  async createVaultUser(input: {
    email: string;
    authSalt: string;
    argon2Params: { t: number; m: number; p: number };
    authHash: string;
    wrappedMasterKey: unknown;
    vaultId: string;
    recovery: {
      authSalt: string;
      argon2Params: { t: number; m: number; p: number };
      authHash: string;
      wrappedMasterKey: unknown;
    };
  }): Promise<{ id: string }> {
    const rows = await this.db.insert<{ id: string }>('vault_users', {
      email: input.email,
      auth_salt: input.authSalt,
      argon2_t: input.argon2Params.t,
      argon2_m: input.argon2Params.m,
      argon2_p: input.argon2Params.p,
      auth_hash: input.authHash,
      wrapped_master_key: input.wrappedMasterKey,
      recovery_salt: input.recovery.authSalt,
      recovery_argon2_t: input.recovery.argon2Params.t,
      recovery_argon2_m: input.recovery.argon2Params.m,
      recovery_argon2_p: input.recovery.argon2Params.p,
      recovery_auth_hash: input.recovery.authHash,
      recovery_wrapped_master_key: input.recovery.wrappedMasterKey,
      vault_id: input.vaultId,
    });
    const created = rows[0];
    if (created === undefined) throw new Error('no se pudo crear la cuenta');
    return created;
  }

  async updateVaultUserCredentials(
    id: string,
    input: {
      authSalt: string;
      argon2Params: { t: number; m: number; p: number };
      authHash: string;
      wrappedMasterKey: unknown;
    },
  ): Promise<void> {
    await this.db.update('vault_users', { id: eq(id) }, {
      auth_salt: input.authSalt,
      argon2_t: input.argon2Params.t,
      argon2_m: input.argon2Params.m,
      argon2_p: input.argon2Params.p,
      auth_hash: input.authHash,
      wrapped_master_key: input.wrappedMasterKey,
    });
  }

  // --- sesiones ---

  async createVaultSession(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.db.insert('vault_sessions', {
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    }, false);
  }

  async revokeVaultSession(tokenHash: string): Promise<void> {
    await this.db.update('vault_sessions', { token_hash: eq(tokenHash) }, {
      revoked_at: new Date().toISOString(),
    });
  }

  /** cierra todas las sesiones del usuario MENOS la actual */
  async revokeOtherVaultSessions(userId: string, keepTokenHash: string): Promise<void> {
    await this.db.update(
      'vault_sessions',
      { user_id: eq(userId), token_hash: `neq.${keepTokenHash}` },
      { revoked_at: new Date().toISOString() },
    );
  }

  // --- sincronizacion (autorizada por owner_user_id) ---

  /** crea la conversacion a nombre del usuario si no existe */
  async ensureVaultConversation(ownerUserId: string, conversationId: string): Promise<void> {
    await this.db.insertIfAbsent(
      'vault_conversations',
      { conversation_id: conversationId, owner_user_id: ownerUserId },
      'conversation_id',
    );
  }

  /**
   * inserta turnos sin duplicar.
   *
   * idempotente por (conversation_id, sequence): reenviar un lote tras un corte
   * de red no crea copias. Devuelve cuantos eran nuevos de verdad.
   */
  async insertVaultRecords(ownerUserId: string, records: PrivateRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const rows = records.map((record) => ({
      record_id: record.recordId,
      owner_user_id: ownerUserId,
      conversation_id: record.conversationId,
      sequence: record.sequence,
      content: record.content,
      sealed_memory: record.sealedMemory,
      created_at: record.createdAt,
    }));

    const inserted = await this.db
      .insert<{ record_id: string }>('vault_records?on_conflict=conversation_id,sequence', rows)
      .catch(() => [] as { record_id: string }[]);
    return inserted.length;
  }

  async listVaultConversations(
    ownerUserId: string,
    query: { since?: string; limit: number },
  ): Promise<{ conversation_id: string; turn_count: number; updated_at: string }[]> {
    return this.db.select('vault_conversations', {
      columns: 'conversation_id,turn_count,updated_at',
      filters: {
        owner_user_id: eq(ownerUserId),
        ...(query.since === undefined ? {} : { updated_at: gte(query.since) }),
      },
      order: 'updated_at.desc',
      limit: query.limit,
    });
  }

  async listVaultRecords(
    ownerUserId: string,
    conversationId: string,
    limit: number,
  ): Promise<
    {
      record_id: string;
      conversation_id: string;
      sequence: number;
      content: unknown;
      sealed_memory: unknown;
      created_at: string;
    }[]
  > {
    return this.db.select('vault_records', {
      columns: 'record_id,conversation_id,sequence,content,sealed_memory,created_at',
      // el filtro por usuario es la autorizacion: un usuario no puede leer los
      // registros de otro aunque conozca el identificador de conversacion
      filters: { owner_user_id: eq(ownerUserId), conversation_id: eq(conversationId) },
      order: 'sequence.asc',
      limit,
    });
  }

  /** borra la conversacion del usuario; la cascada se lleva turnos y medios */
  async deleteVaultConversation(ownerUserId: string, conversationId: string): Promise<boolean> {
    const removed = await this.db.delete('vault_conversations', {
      owner_user_id: eq(ownerUserId),
      conversation_id: eq(conversationId),
    });
    return removed > 0;
  }
}
