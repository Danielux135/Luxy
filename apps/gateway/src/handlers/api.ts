// api privada que consume el agente local. solo acepta conexiones autenticadas.
import {
  jobAttachmentSchema,
  machineRegisterRequestSchema,
  heartbeatRequestSchema,
  claimRequestSchema,
  jobEventsRequestSchema,
  jobCompleteRequestSchema,
  jobFailRequestSchema,
  jobCancelledRequestSchema,
  approvalResolveRequestSchema,
  renderJobFinished,
  renderJobProgress,
  MIN_PROGRESS_EDIT_INTERVAL_MS,
  TERMINAL_JOB_STATUSES,
} from '@luxy/shared';
import type { Job, JobAttachment, JobStatus, ProviderId } from '@luxy/shared';
import type { GatewayConfig } from '../env.js';
import type { Repository } from '../repository.js';
import type { RemoteRepository } from '../remote-repository.js';
import type { Logger } from '../logger.js';
import { describeError } from '../logger.js';
import { type TelegramClient, buildResultKeyboard } from '../telegram.js';
import {
  AuthError,
  authenticateMachine,
  generateMachineToken,
  hashToken,
  verifyRegistrationSecret,
  type AuthenticatedMachine,
} from '../auth.js';
import { getMachineLimiter } from '../ratelimit.js';
import type { SupabaseClient } from '../supabase.js';

export interface ApiDeps {
  config: GatewayConfig;
  repo: Repository;
  /** tablas de control remoto; separadas de repo por ciclo de vida propio */
  remote: RemoteRepository;
  db: SupabaseClient;
  telegram: TelegramClient;
  logger: Logger;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/** hace idempotentes los reenvios de la cola local de resultados */
function terminalResponse(job: Job, expected: JobStatus): Response | null {
  if (job.status === expected) return json({ ok: true, duplicate: true });
  // interrupted es una conclusion provisional del barrido de leases. Si la
  // misma maquina propietaria vuelve y entrega el resultado durable, ese dato
  // real prevalece sobre la inferencia hecha durante el corte de red.
  if (job.status === 'interrupted') return null;
  if ((TERMINAL_JOB_STATUSES as readonly JobStatus[]).includes(job.status)) {
    return errorResponse(`el trabajo ya termino con estado ${job.status}`, 409);
  }
  return null;
}

/** lee y valida el cuerpo con un esquema zod */
export async function readBody<T>(
  request: Request,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } },
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, response: errorResponse('el cuerpo debe ser json valido', 400) };
  }
  const result = schema.safeParse(payload);
  if (!result.success || result.data === undefined) {
    return { ok: false, response: errorResponse('el cuerpo no cumple el contrato esperado', 422) };
  }
  return { ok: true, data: result.data };
}

// -----------------------------------------------------------------------------
// POST /api/machines/register
// -----------------------------------------------------------------------------
export async function handleRegister(request: Request, deps: ApiDeps): Promise<Response> {
  const body = await readBody(request, machineRegisterRequestSchema);
  if (!body.ok) return body.response;

  if (!verifyRegistrationSecret(body.data.registrationSecret, deps.config)) {
    deps.logger.warn('registro rechazado: secreto invalido', { name: body.data.name });
    return errorResponse('secreto de registro no valido', 401);
  }

  const machine = await deps.repo.upsertMachine({
    name: body.data.name,
    hostname: body.data.hostname,
    platform: body.data.platform,
    platformVersion: body.data.platformVersion,
    agentVersion: body.data.agentVersion,
    capabilities: body.data.capabilities,
    projects: body.data.projects,
  });

  // registrar de nuevo invalida los tokens anteriores de esa maquina
  await deps.repo.revokeMachineTokens(machine.id);
  const token = generateMachineToken();
  await deps.repo.createMachineToken(machine.id, await hashToken(token));

  deps.logger.info('maquina registrada', { machineId: machine.id, name: machine.name });

  // el token en claro se devuelve UNA sola vez: en la base solo queda el hash
  return json({ machineId: machine.id, machineToken: token, name: machine.name });
}

// -----------------------------------------------------------------------------
// endpoints autenticados
// -----------------------------------------------------------------------------

type AuthenticatedHandler = (
  request: Request,
  deps: ApiDeps,
  machine: AuthenticatedMachine,
  params: Record<string, string>,
) => Promise<Response>;

/** envuelve un manejador exigiendo token de maquina valido y rate limit */
export function withMachineAuth(handler: AuthenticatedHandler) {
  return async (
    request: Request,
    deps: ApiDeps,
    params: Record<string, string> = {},
  ): Promise<Response> => {
    let machine: AuthenticatedMachine;
    try {
      machine = await authenticateMachine(request, deps.db);
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(error.message, error.status);
      deps.logger.error('fallo autenticando maquina', describeError(error));
      return errorResponse('no se pudo autenticar la maquina', 500);
    }

    const limit = getMachineLimiter().check(machine.id);
    if (!limit.allowed) return errorResponse('demasiadas peticiones', 429);

    return handler(request, deps, machine, params);
  };
}

// -----------------------------------------------------------------------------
// POST /api/machines/heartbeat
// -----------------------------------------------------------------------------
export const handleHeartbeat = withMachineAuth(async (request, deps, machine) => {
  const body = await readBody(request, heartbeatRequestSchema);
  if (!body.ok) return body.response;

  await deps.repo.recordHeartbeat(machine.id, {
    capabilities: body.data.capabilities,
    projects: body.data.projects,
    agentVersion: body.data.agentVersion,
  });

  return json({
    ok: true,
    serverTime: new Date().toISOString(),
    offlineAfterSeconds: deps.config.MACHINE_OFFLINE_SECONDS,
  });
});

// -----------------------------------------------------------------------------
// POST /api/jobs/claim
// -----------------------------------------------------------------------------
export const handleClaim = withMachineAuth(async (request, deps, machine) => {
  const body = await readBody(request, claimRequestSchema);
  if (!body.ok) return body.response;

  const leaseSeconds = body.data.leaseSeconds ?? deps.config.JOB_LEASE_SECONDS;

  // la exclusion mutua la garantiza la funcion postgres, no este codigo
  const claimed = await deps.repo.claimJob(
    machine.id,
    body.data.supportedProviders,
    body.data.projects,
    leaseSeconds,
  );

  if (!claimed) return json({ job: null });

  deps.logger.info('trabajo reclamado', {
    jobId: claimed.id,
    shortId: claimed.short_id,
    machine: machine.name,
  });

  // se avisa por telegram editando el mensaje de progreso ya existente
  const metadata = (claimed.metadata ?? {}) as Record<string, unknown>;
  const progressMessageId = metadata.progressMessageId;
  if (claimed.telegram_chat_id !== null && typeof progressMessageId === 'number') {
    await deps.telegram
      .editMessageText(
        claimed.telegram_chat_id,
        progressMessageId,
        renderJobProgress({
          shortId: claimed.short_id,
          machineName: machine.name,
          projectAlias: claimed.project_alias,
          provider: claimed.provider,
          status: 'claimed',
          phase: 'preparando el entorno',
          durationMs: 0,
        }),
      )
      .catch(() => undefined);
  }

  return json({
    job: {
      id: claimed.id,
      shortId: claimed.short_id,
      provider: claimed.provider,
      model: claimed.model,
      projectAlias: claimed.project_alias,
      prompt: claimed.prompt,
      origin: claimed.created_via,
      telegramChatId: claimed.telegram_chat_id,
      telegramUserId: claimed.telegram_user_id,
      leaseExpiresAt: claimed.lease_expires_at,
      metadata: claimed.metadata ?? {},
      // el adjunto vive en la metadata, pero el agente lo espera como campo
      // propio: sin esto llegaba siempre null y /image_edit pedia una foto que
      // el usuario ya habia enviado
      attachment: attachmentOf(claimed.metadata),
    },
  });
});

/** saca el adjunto de la metadata de un trabajo, o null si no hay o no es valido */
function attachmentOf(metadata: unknown): JobAttachment | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const parsed = jobAttachmentSchema.safeParse((metadata as Record<string, unknown>)['attachment']);
  return parsed.success ? parsed.data : null;
}

// -----------------------------------------------------------------------------
// GET /api/jobs/:jobId/control
// el agente consulta esto para detectar cancelaciones
// -----------------------------------------------------------------------------
export const handleJobControl = withMachineAuth(async (request, deps, machine, params) => {
  const jobId = params.jobId;
  if (!jobId) return errorResponse('falta el identificador del trabajo', 400);

  const job = await deps.repo.getJobById(jobId);
  if (!job) return errorResponse('trabajo no encontrado', 404);
  // una maquina solo puede consultar sus propios trabajos
  if (job.claimedBy !== machine.id) return errorResponse('ese trabajo no es de esta maquina', 403);

  // renovacion del lease.
  //
  // Antes esto SOLO viajaba con los eventos, y la cola no envia nada cuando no
  // hay eventos pendientes. Un modelo que tarda cuatro minutos sin emitir nada
  // dejaba caducar el lease a los dos, y el barrido marcaba el trabajo como
  // interrumpido mientras seguia ejecutandose de verdad.
  //
  // El agente ya consulta este endpoint cada pocos segundos para ver si le han
  // pedido cancelar: que la renovacion viaje aqui la hace independiente de que
  // el modelo tenga algo que contar.
  let leaseExpiresAt = job.leaseExpiresAt;
  const solicitado = new URL(request.url).searchParams.get('renewLease');
  if (solicitado !== null) {
    const seconds = Number(solicitado);
    if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) {
      return errorResponse('renewLease debe ser un entero entre 30 y 3600', 400);
    }
    // un trabajo ya terminado no revive: renovar su lease solo lo dejaria
    // colgado en la cola de barrido
    if (job.status === 'claimed' || job.status === 'running') {
      leaseExpiresAt = await deps.repo.renewLease(jobId, machine.id, seconds);
    }
  }

  return json({
    status: job.status,
    cancelRequested: job.cancelRequestedAt !== null,
    leaseExpiresAt,
  });
});

// -----------------------------------------------------------------------------
// POST /api/jobs/:jobId/events
// -----------------------------------------------------------------------------

// ultimo instante en que se edito el mensaje de cada trabajo, por isolate.
// evita superar los limites de telegram al editar continuamente.
const lastEditAt = new Map<string, number>();

export const handleJobEvents = withMachineAuth(async (request, deps, machine, params) => {
  const jobId = params.jobId;
  if (!jobId) return errorResponse('falta el identificador del trabajo', 400);

  const body = await readBody(request, jobEventsRequestSchema);
  if (!body.ok) return body.response;

  const job = await deps.repo.getJobById(jobId);
  if (!job) return errorResponse('trabajo no encontrado', 404);
  if (job.claimedBy !== machine.id) return errorResponse('ese trabajo no es de esta maquina', 403);

  await deps.repo.appendEvents(jobId, body.data.events);

  // el primer evento marca el inicio real de la ejecucion
  if (!job.startedAt) {
    await deps.repo.updateJob(jobId, { status: 'running', started_at: new Date().toISOString() });
  }

  // renovacion del lease aprovechando la misma peticion
  let leaseExpiresAt = job.leaseExpiresAt;
  if (body.data.renewLeaseSeconds) {
    leaseExpiresAt = await deps.repo.renewLease(jobId, machine.id, body.data.renewLeaseSeconds);
  }

  // se edita el mensaje existente, como maximo cada segundo y medio
  const phaseEvent = [...body.data.events].reverse().find((event) => event.type === 'phase');
  const progressMessageId = job.metadata.progressMessageId;
  const now = Date.now();
  const lastEdit = lastEditAt.get(jobId) ?? 0;

  if (
    phaseEvent &&
    job.telegramChatId !== null &&
    typeof progressMessageId === 'number' &&
    now - lastEdit >= MIN_PROGRESS_EDIT_INTERVAL_MS
  ) {
    lastEditAt.set(jobId, now);
    const startedAt = job.startedAt ? Date.parse(job.startedAt) : now;
    await deps.telegram
      .editMessageText(
        job.telegramChatId,
        progressMessageId,
        renderJobProgress({
          shortId: job.shortId,
          machineName: machine.name,
          projectAlias: job.projectAlias,
          provider: job.provider,
          status: 'running',
          phase: phaseEvent.message,
          durationMs: now - startedAt,
        }),
      )
      .catch(() => undefined);
  }

  return json({ ok: true, leaseExpiresAt });
});

// -----------------------------------------------------------------------------
// POST /api/jobs/:jobId/complete
// -----------------------------------------------------------------------------
export const handleJobComplete = withMachineAuth(async (request, deps, machine, params) => {
  const jobId = params.jobId;
  if (!jobId) return errorResponse('falta el identificador del trabajo', 400);

  const body = await readBody(request, jobCompleteRequestSchema);
  if (!body.ok) return body.response;

  const job = await deps.repo.getJobById(jobId);
  if (!job) return errorResponse('trabajo no encontrado', 404);
  if (job.claimedBy !== machine.id) return errorResponse('ese trabajo no es de esta maquina', 403);
  const repeated = terminalResponse(job, 'completed');
  if (repeated !== null) return repeated;

  const result = body.data;
  await deps.repo.updateJob(jobId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    result_summary: result.summary,
    error_message: null,
    model:
      job.model ??
      (typeof job.metadata.model === 'string' ? job.metadata.model.slice(0, 128) : null),
    lease_expires_at: null,
    metadata: {
      ...job.metadata,
      filesChanged: result.filesChanged,
      testsPassed: result.testsPassed,
      testsFailed: result.testsFailed,
      durationMs: result.durationMs,
      diffStat: result.diffStat,
      branch: result.branch,
      worktreePath: result.worktreePath,
      sessionId: result.sessionId,
    },
  });

  if (result.usage) {
    await deps.repo
      .recordProviderUsage({ ...result.usage, jobId })
      .catch((error) => deps.logger.warn('no se pudo registrar el consumo', describeError(error)));
  }

  const text = renderJobFinished({
    shortId: job.shortId,
    machineName: machine.name,
    projectAlias: job.projectAlias,
    provider: job.provider,
    status: 'completed',
    durationMs: result.durationMs,
    filesChanged: result.filesChanged,
    testsPassed: result.testsPassed,
    testsFailed: result.testsFailed,
    summary: result.summary,
  });

  // el resultado final NO puede perderse: si falla la edicion, se envia aparte
  if (job.telegramChatId !== null) {
    await deliverFinalMessage(deps, job.telegramChatId, job.metadata.progressMessageId, text, {
      keyboard: buildResultKeyboard(job.shortId, result.filesChanged > 0),
    });
  }

  // si el trabajo produjo una imagen o un audio, se envia despues del resumen
  if (result.resultMedia && job.telegramChatId !== null) {
    try {
      await deps.telegram.sendMedia(job.telegramChatId, result.resultMedia);
    } catch (error) {
      deps.logger.warn('no se pudo enviar el medio del trabajo', {
        jobId,
        error: String(error),
      });
      await deps.telegram.sendMessage(
        job.telegramChatId,
        'El trabajo genero un archivo pero no se pudo enviar por Telegram.',
      );
    }
  }

  lastEditAt.delete(jobId);
  return json({ ok: true });
});

// -----------------------------------------------------------------------------
// POST /api/jobs/:jobId/fail
// -----------------------------------------------------------------------------
export const handleJobFail = withMachineAuth(async (request, deps, machine, params) => {
  const jobId = params.jobId;
  if (!jobId) return errorResponse('falta el identificador del trabajo', 400);

  const body = await readBody(request, jobFailRequestSchema);
  if (!body.ok) return body.response;

  const job = await deps.repo.getJobById(jobId);
  if (!job) return errorResponse('trabajo no encontrado', 404);
  if (job.claimedBy !== machine.id) return errorResponse('ese trabajo no es de esta maquina', 403);
  const repeated = terminalResponse(job, 'failed');
  if (repeated !== null) return repeated;

  await deps.repo.updateJob(jobId, {
    status: 'failed',
    completed_at: new Date().toISOString(),
    error_message: body.data.errorMessage,
    lease_expires_at: null,
    metadata: {
      ...job.metadata,
      worktreePath: body.data.worktreePath,
      hasLocalChanges: body.data.hasLocalChanges,
      durationMs: body.data.durationMs,
    },
  });

  const lines = [
    `Trabajo fallido: ${job.shortId}`,
    '',
    `Maquina: ${machine.name}`,
    `Proyecto: ${job.projectAlias}`,
    '',
    'Error:',
    body.data.errorMessage,
  ];
  if (body.data.hasLocalChanges) {
    lines.push('', 'Hay cambios en el worktree. No se han borrado.');
  }

  if (job.telegramChatId !== null) {
    await deliverFinalMessage(
      deps,
      job.telegramChatId,
      job.metadata.progressMessageId,
      lines.join('\n'),
      {},
    );
  }
  lastEditAt.delete(jobId);
  return json({ ok: true });
});

// -----------------------------------------------------------------------------
// POST /api/jobs/:jobId/cancelled
// -----------------------------------------------------------------------------
export const handleJobCancelled = withMachineAuth(async (request, deps, machine, params) => {
  const jobId = params.jobId;
  if (!jobId) return errorResponse('falta el identificador del trabajo', 400);

  const body = await readBody(request, jobCancelledRequestSchema);
  if (!body.ok) return body.response;

  const job = await deps.repo.getJobById(jobId);
  if (!job) return errorResponse('trabajo no encontrado', 404);
  if (job.claimedBy !== machine.id) return errorResponse('ese trabajo no es de esta maquina', 403);
  const repeated = terminalResponse(job, 'cancelled');
  if (repeated !== null) return repeated;

  await deps.repo.updateJob(jobId, {
    status: 'cancelled',
    completed_at: new Date().toISOString(),
    lease_expires_at: null,
    metadata: {
      ...job.metadata,
      worktreePath: body.data.worktreePath,
      modifiedFiles: body.data.modifiedFiles,
      durationMs: body.data.durationMs,
    },
  });

  const lines = [
    `Trabajo cancelado: ${job.shortId}`,
    '',
    `Maquina: ${machine.name}`,
    `Proyecto: ${job.projectAlias}`,
  ];
  if (body.data.modifiedFiles.length > 0) {
    lines.push(
      '',
      `Quedaron ${body.data.modifiedFiles.length} archivos modificados (no se han borrado):`,
      ...body.data.modifiedFiles.slice(0, 20).map((file) => `  ${file}`),
    );
    if (body.data.worktreePath) lines.push('', `Worktree: ${body.data.worktreePath}`);
  } else {
    lines.push('', 'No quedaron archivos modificados.');
  }

  if (job.telegramChatId !== null) {
    await deliverFinalMessage(
      deps,
      job.telegramChatId,
      job.metadata.progressMessageId,
      lines.join('\n'),
      {},
    );
  }
  lastEditAt.delete(jobId);
  return json({ ok: true });
});

// -----------------------------------------------------------------------------
// POST /api/approvals/:approvalId/resolve
// -----------------------------------------------------------------------------
/**
 * sirve el adjunto de un trabajo al agente.
 *
 * el agente no tiene el token del bot ni debe tenerlo, asi que el gateway hace
 * de intermediario. Se comprueba que el trabajo sea de ESA maquina, igual que
 * en el resto de endpoints.
 */
export const handleJobAttachment = withMachineAuth(async (_request, deps, machine, params) => {
  const jobId = params.jobId;
  if (!jobId) return errorResponse('falta el identificador del trabajo', 400);

  const job = await deps.repo.getJobById(jobId);
  if (!job) return errorResponse('el trabajo no existe', 404);
  if (job.claimedBy !== machine.id) {
    return errorResponse('ese trabajo no es de esta maquina', 403);
  }

  const attachment = attachmentOf(job.metadata);
  if (attachment === null) return errorResponse('el trabajo no tiene ningun adjunto', 404);

  try {
    const file = await deps.telegram.downloadFile(attachment.fileId);
    return new Response(file.bytes, {
      status: 200,
      headers: {
        'Content-Type': attachment.mimeType ?? file.mimeType,
        'Content-Disposition': `attachment; filename="${attachment.fileName ?? 'adjunto'}"`,
      },
    });
  } catch (error) {
    deps.logger.warn('no se pudo servir el adjunto', { jobId, error: String(error) });
    return errorResponse('no se pudo descargar el adjunto de Telegram', 502);
  }
});

/** aprobaciones que esta maquina debe ejecutar */
export const handleApprovalsPending = withMachineAuth(async (_request, deps, machine) => {
  const rows = await deps.repo.listPendingApprovalsForMachine(machine.id);

  const approvals = [];
  for (const row of rows) {
    const job = await deps.repo.getJobById(row.job_id);
    if (!job) continue;
    const metadata = job.metadata as Record<string, unknown>;
    approvals.push({
      approvalId: row.id,
      jobId: row.job_id,
      shortId: job.shortId,
      action: row.action,
      projectAlias: job.projectAlias,
      worktreePath: typeof metadata['worktreePath'] === 'string' ? metadata['worktreePath'] : '',
      branch: typeof metadata['branch'] === 'string' ? metadata['branch'] : '',
      message: typeof row.metadata['message'] === 'string' ? row.metadata['message'] : null,
      // solo el flujo de doble confirmacion pone esta marca
      confirmedTwice: row.metadata['confirmedTwice'] === true,
      requestedBy: String(row.metadata['requestedBy'] ?? ''),
    });
  }

  return json({ approvals });
});

export const handleApprovalResolve = withMachineAuth(async (request, deps, machine, params) => {
  const approvalId = params.approvalId;
  if (!approvalId) return errorResponse('falta el identificador de la aprobacion', 400);

  const body = await readBody(request, approvalResolveRequestSchema);
  if (!body.ok) return body.response;

  // una maquina solo puede resolver aprobaciones de SUS trabajos. Sin esta
  // comprobacion, cualquier maquina registrada podia resolver las de otra,
  // igual que ya se comprueba en los demas endpoints de trabajo.
  const approval = await deps.repo.getApproval(approvalId);
  if (!approval) return errorResponse('la aprobacion no existe', 404);

  const job = await deps.repo.getJobById(approval.job_id);
  if (!job || job.claimedBy !== machine.id) {
    return errorResponse('esa aprobacion no pertenece a un trabajo de esta maquina', 403);
  }

  const resolved = await deps.repo.resolveApproval(approvalId, body.data.decision, 0);
  if (!resolved) return errorResponse('la aprobacion no existe o ya estaba resuelta', 409);

  return json({ ok: true, action: resolved.action, jobId: resolved.job_id });
});

/**
 * entrega el mensaje final sin perderlo nunca.
 * primero intenta editar el mensaje de progreso; si no puede, envia uno nuevo.
 */
async function deliverFinalMessage(
  deps: ApiDeps,
  chatId: number,
  progressMessageId: unknown,
  text: string,
  options: { keyboard?: ReturnType<typeof buildResultKeyboard> },
): Promise<void> {
  if (typeof progressMessageId === 'number') {
    try {
      await deps.telegram.editMessageText(chatId, progressMessageId, text, options.keyboard);
      return;
    } catch (error) {
      deps.logger.warn(
        'no se pudo editar el mensaje final, se envia uno nuevo',
        describeError(error),
      );
    }
  }
  try {
    await deps.telegram.sendMessage(chatId, text, { replyMarkup: options.keyboard });
  } catch (error) {
    // el resultado ya esta persistido en supabase: /job <id> lo recupera
    deps.logger.error('no se pudo entregar el mensaje final a telegram', describeError(error));
  }
}

/** exportado para tests: limpia el estado de ediciones */
export function resetEditThrottle(): void {
  lastEditAt.clear();
}

export type { ProviderId };
