// API de Luxy Studio.
//
// usa el mismo token de maquina que el agente. El renderer nunca lo ve: las
// llamadas salen del proceso principal de Electron.
import {
  PROVIDER_IDS,
  isMachineOnline,
  machineHasProject,
  machineSupportsProvider,
  studioJobCreateRequestSchema,
  studioJobListQuerySchema,
} from '@luxy/shared';
import type { Job, Machine, ProviderId, StudioJob } from '@luxy/shared';
import { errorResponse, json, readBody, withMachineAuth } from './api.js';

function toStudioJob(job: Job): StudioJob {
  return {
    id: job.id,
    shortId: job.shortId,
    origin: job.origin,
    targetMachineId: job.targetMachineId,
    provider: job.provider,
    model: job.model,
    projectAlias: job.projectAlias,
    prompt: job.prompt,
    status: job.status,
    priority: job.priority,
    claimedBy: job.claimedBy,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    resultSummary: job.resultSummary,
    errorMessage: job.errorMessage,
    metadata: job.metadata,
    createdAt: job.createdAt,
  };
}

function providersOf(machine: Machine): ProviderId[] {
  return PROVIDER_IDS.filter((provider) => machineSupportsProvider(machine, provider));
}

/** maquinas y capacidades reales para construir los selectores de Studio */
export const handleStudioOptions = withMachineAuth(async (_request, deps) => {
  const machines = await deps.repo.listMachines();
  return json({
    machines: machines.map((machine) => ({
      id: machine.id,
      name: machine.name,
      projects: machine.projects,
      providers: providersOf(machine),
      online: isMachineOnline(machine, new Date(), deps.config.MACHINE_OFFLINE_SECONDS),
      enabled: machine.enabled,
    })),
  });
});

/** crea un trabajo sin ninguna identidad ficticia de Telegram */
export const handleStudioJobCreate = withMachineAuth(async (request, deps, creator) => {
  const body = await readBody(request, studioJobCreateRequestSchema);
  if (!body.ok) return body.response;

  const target = await deps.repo.getMachineById(body.data.targetMachineId);
  if (target === null || !target.enabled) {
    return errorResponse('la maquina elegida no existe o esta deshabilitada', 422);
  }
  if (!machineHasProject(target, body.data.projectAlias)) {
    return errorResponse('la maquina elegida no tiene configurado ese proyecto', 422);
  }
  if (!machineSupportsProvider(target, body.data.provider)) {
    // Studio nunca sustituye silenciosamente el proveedor o el modelo pedido.
    return errorResponse('la maquina elegida no ofrece ese proveedor', 422);
  }

  const job = await deps.repo.createJob({
    origin: 'studio',
    telegramChatId: null,
    telegramUserId: null,
    targetMachineId: target.id,
    provider: body.data.provider,
    model: body.data.model,
    projectAlias: body.data.projectAlias,
    prompt: body.data.prompt,
    status: 'queued',
    priority: body.data.priority,
    metadata: {
      model: body.data.model,
      requestedByMachineId: creator.id,
      requestedByMachineName: creator.name,
    },
  });

  deps.logger.info('trabajo creado desde Studio', {
    jobId: job.id,
    shortId: job.shortId,
    targetMachineId: target.id,
  });
  return json({ job: toStudioJob(job), events: [] }, 201);
});

/** historial real de la cola, no solo lo observado por el renderer */
export const handleStudioJobs = withMachineAuth(async (request, deps) => {
  const url = new URL(request.url);
  const query = studioJobListQuerySchema.safeParse({
    targetMachineId: url.searchParams.get('targetMachineId') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!query.success) return errorResponse('los filtros del historial no son validos', 422);

  const jobs = await deps.repo.listJobs(query.data);
  return json({ jobs: jobs.map(toStudioJob) });
});

/** detalle con eventos, diff y resultados guardados en metadata */
export const handleStudioJobDetail = withMachineAuth(async (_request, deps, _machine, params) => {
  const jobId = params.jobId;
  if (jobId === undefined) return errorResponse('falta el identificador del trabajo', 400);

  const job = await deps.repo.getJobById(jobId);
  if (job === null) return errorResponse('trabajo no encontrado', 404);
  const events = await deps.repo.listEvents(jobId, 100);

  return json({
    job: toStudioJob(job),
    events: events
      .map((event) => ({
        sequence: event.sequence,
        type: event.type,
        message: event.message,
        metadata: event.metadata ?? {},
        createdAt: event.created_at,
      }))
      .reverse(),
  });
});

/** la cancelacion conserva siempre los cambios del worktree */
export const handleStudioJobCancel = withMachineAuth(async (_request, deps, _machine, params) => {
  const jobId = params.jobId;
  if (jobId === undefined) return errorResponse('falta el identificador del trabajo', 400);

  const job = await deps.repo.getJobById(jobId);
  if (job === null) return errorResponse('trabajo no encontrado', 404);
  const status = await deps.repo.requestCancel(jobId);
  if (status === null) return errorResponse('el trabajo ya habia terminado', 409);

  return json({ ok: true, status });
});
