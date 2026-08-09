// API de Luxy Studio.
//
// usa el mismo token de maquina que el agente. El renderer nunca lo ve: las
// llamadas salen del proceso principal de Electron.
import {
  PROVIDER_IDS,
  MODEL_EVALUATIONS,
  buildModelEvaluationPrompt,
  isMachineOnline,
  machineHasProject,
  machineSupportsProvider,
  studioJobActionRequestSchema,
  studioJobCreateRequestSchema,
  studioJobFeedbackRequestSchema,
  studioJobListQuerySchema,
} from '@luxy/shared';
import type { Job, Machine, ProviderId, StudioJob, StudioJobCreateRequest } from '@luxy/shared';
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

function evaluationContractError(body: StudioJobCreateRequest): string | null {
  if (body.mode !== 'evaluation') return null;
  const snapshot = body.evaluation!;
  const definition = MODEL_EVALUATIONS.find((item) => item.id === snapshot.evaluationId);
  const prompt = buildModelEvaluationPrompt(snapshot.evaluationId);
  if (definition === undefined || prompt === null) return 'la evaluacion solicitada no existe';
  if (!definition.executionEnabled || definition.validationMode !== 'automatic') {
    return 'esta evaluacion todavia no tiene ejecucion automatica habilitada';
  }
  if (
    snapshot.evaluationVersion !== definition.version ||
    snapshot.fixtureId !== definition.fixtureId ||
    snapshot.validationMode !== definition.validationMode ||
    snapshot.scoring !== definition.scoring ||
    snapshot.promptVersion !== 1
  ) {
    return 'la definicion de la evaluacion no coincide con el catalogo actual';
  }
  if (body.prompt !== prompt.text) {
    return 'el prompt de la evaluacion no coincide con su version reproducible';
  }
  return null;
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

  const evaluationError = evaluationContractError(body.data);
  if (evaluationError !== null) return errorResponse(evaluationError, 422);

  if (body.data.mode === 'evaluation') {
    const activeEvaluation = (await deps.repo.listActiveJobs()).find(
      (job) =>
        job.origin === 'studio' &&
        job.metadata['studioMode'] === 'evaluation' &&
        job.metadata['requestedByMachineId'] === creator.id,
    );
    if (activeEvaluation !== undefined) {
      return errorResponse(`ya hay una evaluacion activa (${activeEvaluation.shortId})`, 409);
    }
  }

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
      ...(body.data.mode === 'conversation'
        ? {
            studioMode: 'conversation',
            conversationId: body.data.conversationId,
            conversationTurnId: body.data.conversationTurnId,
            conversationTitle: body.data.conversationTitle,
            conversationUserMessage: body.data.conversationUserMessage,
            comparisonIndex: body.data.comparisonIndex ?? 0,
            // solo viaja cuando este turno continua una respuesta cortada
            ...(body.data.continuesJobId === undefined
              ? {}
              : { continuesJobId: body.data.continuesJobId }),
          }
        : body.data.mode === 'evaluation'
          ? {
              studioMode: 'evaluation',
              evaluationId: body.data.evaluation!.evaluationId,
              evaluationVersion: body.data.evaluation!.evaluationVersion,
              evaluationPromptVersion: body.data.evaluation!.promptVersion,
              evaluationFixtureId: body.data.evaluation!.fixtureId,
              evaluationValidationMode: body.data.evaluation!.validationMode,
              evaluationScoring: body.data.evaluation!.scoring,
              evaluationConfirmed: true,
            }
          : {}),
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
export const handleStudioJobs = withMachineAuth(async (request, deps, creator) => {
  const url = new URL(request.url);
  const query = studioJobListQuerySchema.safeParse({
    targetMachineId: url.searchParams.get('targetMachineId') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!query.success) return errorResponse('los filtros del historial no son validos', 422);

  const jobs = await deps.repo.listJobs(query.data);

  // Una cancelacion solicitada antes de cerrar Electron podia quedarse en
  // `running`: el agente anterior ya no existia para entregar su resultado
  // final. Las conversaciones son de solo lectura y no tienen worktree, por lo
  // que Studio puede terminar con seguridad esas cancelaciones pendientes.
  for (const [index, job] of jobs.entries()) {
    if (
      job.cancelRequestedAt === null ||
      job.origin !== 'studio' ||
      job.metadata['studioMode'] !== 'conversation' ||
      job.metadata['requestedByMachineId'] !== creator.id ||
      !['queued', 'waiting_for_machine', 'claimed', 'running'].includes(job.status)
    ) {
      continue;
    }
    const recovered = await deps.repo.finishConversationCancellation(job.id);
    if (recovered !== null) jobs[index] = recovered;
  }

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
export const handleStudioJobCancel = withMachineAuth(async (_request, deps, creator, params) => {
  const jobId = params.jobId;
  if (jobId === undefined) return errorResponse('falta el identificador del trabajo', 400);

  const job = await deps.repo.getJobById(jobId);
  if (job === null) return errorResponse('trabajo no encontrado', 404);
  if (job.origin !== 'studio' || job.metadata['requestedByMachineId'] !== creator.id) {
    return errorResponse('ese trabajo no fue creado desde este Studio', 403);
  }
  const status = await deps.repo.requestCancel(jobId);
  if (status === null) return errorResponse('el trabajo ya habia terminado', 409);

  if (job.metadata['studioMode'] === 'conversation' && status !== 'cancelled') {
    const cancelled = await deps.repo.finishConversationCancellation(jobId);
    if (cancelled !== null) return json({ ok: true, status: cancelled.status });

    // La respuesta pudo ganar la carrera entre requestCancel y el update
    // condicional. Se devuelve el estado real en vez de inventar un cancelado.
    const current = await deps.repo.getJobById(jobId);
    return json({ ok: true, status: current?.status ?? status });
  }

  return json({ ok: true, status });
});

/** guarda calidad explicita para que el selector aprenda de resultados reales */
export const handleStudioJobFeedback = withMachineAuth(async (request, deps, creator, params) => {
  const jobId = params.jobId;
  if (jobId === undefined) return errorResponse('falta el identificador del trabajo', 400);

  const body = await readBody(request, studioJobFeedbackRequestSchema);
  if (!body.ok) return body.response;

  const job = await deps.repo.getJobById(jobId);
  if (job === null) return errorResponse('trabajo no encontrado', 404);
  if (
    job.origin !== 'studio' ||
    job.metadata['studioMode'] !== 'conversation' ||
    job.metadata['requestedByMachineId'] !== creator.id
  ) {
    return errorResponse('esa respuesta no pertenece a este Studio', 403);
  }
  if (job.status !== 'completed') {
    return errorResponse('solo se puede valorar una respuesta completada', 409);
  }

  await deps.repo.mergeJobMetadata(job.id, {
    studioFeedback: {
      rating: body.data.rating,
      ratedAt: new Date().toISOString(),
      ratedByMachineId: creator.id,
    },
  });
  const updated = await deps.repo.getJobById(job.id);
  if (updated === null) return errorResponse('no se pudo guardar la valoracion', 409);

  return json({ job: toStudioJob(updated) });
});

/**
 * registra una decision explicita sobre los cambios de un trabajo terminado.
 *
 * el gateway no toca git: deja una aprobacion persistente para que la ejecute
 * la maquina que posee el worktree. Asi Studio tambien funciona al controlar
 * otro ordenador y no depende del proceso local de Electron.
 */
export const handleStudioJobAction = withMachineAuth(async (request, deps, creator, params) => {
  const jobId = params.jobId;
  if (jobId === undefined) return errorResponse('falta el identificador del trabajo', 400);

  const body = await readBody(request, studioJobActionRequestSchema);
  if (!body.ok) return body.response;

  const job = await deps.repo.getJobById(jobId);
  if (job === null) return errorResponse('trabajo no encontrado', 404);
  if (job.origin !== 'studio' || job.metadata['requestedByMachineId'] !== creator.id) {
    return errorResponse('ese trabajo no fue creado desde este Studio', 403);
  }
  if (job.status !== 'completed') {
    return errorResponse('el trabajo no esta listo para decidir sus cambios', 409);
  }

  const worktreePath = job.metadata['worktreePath'];
  const branch = job.metadata['branch'];
  if (typeof worktreePath !== 'string' || typeof branch !== 'string') {
    return errorResponse('el trabajo no conserva un worktree aplicable', 409);
  }

  const previousDecision = job.metadata['studioDecision'];
  if (
    typeof previousDecision === 'object' &&
    previousDecision !== null &&
    'state' in previousDecision &&
    ['pending', 'applied', 'discarded'].includes(String(previousDecision.state))
  ) {
    return errorResponse('los cambios de ese trabajo ya tienen una decision', 409);
  }

  const requestedAt = new Date().toISOString();
  const approval = await deps.repo.createApproval(job.id, body.data.action, {
    source: 'studio',
    requestedBy: creator.id,
    requestedByMachineName: creator.name,
    message: body.data.message,
  });

  // confirmed=true en el contrato representa la pulsacion posterior al dialogo
  // de confirmacion. La orden queda aprobada para el polling del agente.
  const approved = await deps.repo.resolveApproval(approval.id, 'approved', 0);
  if (approved === null) {
    return errorResponse('no se pudo confirmar la decision sobre el trabajo', 409);
  }

  const studioDecision = {
    action: body.data.action,
    state: 'pending',
    message: null,
    requestedAt,
    completedAt: null,
  };
  await deps.repo.mergeJobMetadata(job.id, { studioDecision });
  const waiting = await deps.repo.updateJob(job.id, { status: 'waiting_for_approval' });
  if (waiting === null) return errorResponse('no se pudo actualizar el trabajo', 409);

  deps.logger.info('decision de Studio enviada a la maquina', {
    jobId: job.id,
    approvalId: approval.id,
    action: body.data.action,
  });
  return json({ approvalId: approval.id, job: toStudioJob(waiting) }, 202);
});
