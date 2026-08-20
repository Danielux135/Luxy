import { describe, expect, it, vi } from 'vitest';
import { hashToken } from '../auth.js';
import {
  handleStudioJobAction,
  handleStudioJobCancel,
  handleStudioJobCreate,
  handleStudioJobFeedback,
  handleStudioJobs,
  handleStudioOptions,
} from './studio.js';

const TOKEN = 'token-studio-0123456789abcdefghijkl';
const CREATOR_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const COMPARISON_GROUP_ID = '88888888-8888-4888-8888-888888888888';
const EVALUATION_PROMPT = [
  '[LUXY_EVALUATION]',
  'id=speed-exact-v1',
  'version=1',
  '',
  '[INSTRUCCIONES]',
  'Responde unicamente con la palabra LISTO, en mayusculas y sin puntuacion.',
].join('\n');

function capabilities(httpProviders: string[] = ['deepseek']) {
  const missing = { available: false, version: null, path: null };
  return {
    git: { available: true, version: '2', path: 'git' },
    node: missing,
    npm: missing,
    claude: missing,
    codex: missing,
    flutter: missing,
    httpProviders,
  };
}

async function fakeDb(): Promise<unknown> {
  const tokenHash = await hashToken(TOKEN);
  return {
    async selectOne(table: string) {
      if (table === 'machine_tokens') {
        return {
          id: 'token-1',
          machine_id: CREATOR_ID,
          token_hash: tokenHash,
          revoked_at: null,
          expires_at: null,
        };
      }
      if (table === 'machines') {
        return { id: CREATOR_ID, name: 'pc-casa', enabled: true };
      }
      return null;
    },
  };
}

function machine(id = TARGET_ID) {
  return {
    id,
    name: id === CREATOR_ID ? 'pc-casa' : 'portatil',
    hostname: 'host',
    platform: 'win32',
    platformVersion: '11',
    agentVersion: '0.1.0',
    capabilities: capabilities(),
    projects: ['luxy'],
    lastSeenAt: new Date().toISOString(),
    enabled: true,
  };
}

function completedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    shortId: 'LUX-STUDIO',
    origin: 'studio',
    telegramChatId: null,
    telegramUserId: null,
    targetMachineId: TARGET_ID,
    provider: 'deepseek',
    model: null,
    projectAlias: 'luxy',
    prompt: 'revisa el proyecto',
    status: 'completed',
    priority: 0,
    claimedBy: TARGET_ID,
    claimedAt: new Date().toISOString(),
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    resultSummary: 'listo',
    errorMessage: null,
    metadata: {
      requestedByMachineId: CREATOR_ID,
      worktreePath: 'C:\\Temp\\luxy-worktree',
      branch: 'luxy/studio-prueba',
      filesChanged: 1,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function deps(jobOverrides: Record<string, unknown> = {}, targetId = TARGET_ID) {
  const target = machine(targetId);
  let currentJob = completedJob(jobOverrides);
  const repo = {
    getMachineById: vi.fn(async () => target),
    listMachines: vi.fn(async () => [machine(CREATOR_ID), target]),
    listJobs: vi.fn(async () => [currentJob]),
    listActiveJobs: vi.fn(async () => []),
    getJobById: vi.fn(async () => currentJob),
    requestCancel: vi.fn(async () => {
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(String(currentJob.status))) {
        return null;
      }
      currentJob = { ...currentJob, cancelRequestedAt: new Date().toISOString() };
      return currentJob.status;
    }),
    finishConversationCancellation: vi.fn(async () => {
      if (
        !['queued', 'waiting_for_machine', 'claimed', 'running'].includes(String(currentJob.status))
      ) {
        return null;
      }
      currentJob = {
        ...currentJob,
        status: 'cancelled',
        completedAt: new Date().toISOString(),
        leaseExpiresAt: null,
      };
      return currentJob;
    }),
    createApproval: vi.fn(async () => ({ id: '44444444-4444-4444-8444-444444444444' })),
    resolveApproval: vi.fn(async () => ({
      id: '44444444-4444-4444-8444-444444444444',
      job_id: currentJob.id,
      action: 'commit',
    })),
    mergeJobMetadata: vi.fn(async (_jobId: string, patch: Record<string, unknown>) => {
      currentJob = { ...currentJob, metadata: { ...currentJob.metadata, ...patch } };
    }),
    updateJob: vi.fn(async (_jobId: string, values: Record<string, unknown>) => {
      currentJob = { ...currentJob, ...values };
      return currentJob;
    }),
    createJob: vi.fn(async (input: Record<string, unknown>) => ({
      id: '33333333-3333-4333-8333-333333333333',
      shortId: 'LUX-STUDIO',
      origin: input['origin'],
      telegramChatId: input['telegramChatId'],
      telegramUserId: input['telegramUserId'],
      targetMachineId: input['targetMachineId'],
      provider: input['provider'],
      model: input['model'],
      projectAlias: input['projectAlias'],
      prompt: input['prompt'],
      status: input['status'],
      priority: input['priority'],
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      cancelRequestedAt: null,
      startedAt: null,
      completedAt: null,
      resultSummary: null,
      errorMessage: null,
      metadata: input['metadata'],
      createdAt: new Date().toISOString(),
    })),
  };
  return {
    db: await fakeDb(),
    repo,
    config: { MACHINE_OFFLINE_SECONDS: 45 },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never as Parameters<typeof handleStudioJobCreate>[1];
}

function request(body: unknown): Request {
  return new Request('https://gateway.test/api/studio/jobs', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function evaluationRequestBody(overrides: Record<string, unknown> = {}) {
  const evaluationOverrides = (overrides['evaluation'] ?? {}) as Record<string, unknown>;
  return {
    targetMachineId: TARGET_ID,
    provider: 'deepseek',
    model: 'DeepSeek-V4-Pro',
    projectAlias: 'luxy',
    prompt: EVALUATION_PROMPT,
    mode: 'evaluation',
    ...overrides,
    evaluation: {
      evaluationId: 'speed-exact-v1',
      evaluationVersion: 1,
      promptVersion: 1,
      fixtureId: null,
      validationMode: 'automatic',
      scoring: 'timing',
      confirmed: true,
      ...evaluationOverrides,
    },
  };
}

function actionRequest(body: unknown): Request {
  return new Request(
    'https://gateway.test/api/studio/jobs/33333333-3333-4333-8333-333333333333/action',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function feedbackRequest(body: unknown): Request {
  return new Request(
    'https://gateway.test/api/studio/jobs/33333333-3333-4333-8333-333333333333/feedback',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function cancelRequest(): Request {
  return new Request(
    'https://gateway.test/api/studio/jobs/33333333-3333-4333-8333-333333333333/cancel',
    { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } },
  );
}

function listRequest(): Request {
  return new Request('https://gateway.test/api/studio/jobs?limit=30', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
}

describe('Luxy Studio API', () => {
  it('valida y entrega la pagina pedida al repositorio', async () => {
    const context = await deps();
    const response = await handleStudioJobs(
      new Request('https://gateway.test/api/studio/jobs?limit=80&offset=160', {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(context.repo.listJobs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 80, offset: 160 }),
    );
  });

  it('filtra el historial por proyecto antes de paginar', async () => {
    const context = await deps();
    const response = await handleStudioJobs(
      new Request('https://gateway.test/api/studio/jobs?projectAlias=luxy&limit=30', {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(context.repo.listJobs).toHaveBeenCalledWith(
      expect.objectContaining({ projectAlias: 'luxy', limit: 30 }),
    );
  });

  it('crea un trabajo sin ids ficticios de Telegram', async () => {
    const context = await deps();
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: 'revisa el proyecto',
        priority: 0,
      }),
      context,
    );

    expect(response.status, await response.clone().text()).toBe(201);
    expect(context.repo.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'studio',
        telegramChatId: null,
        telegramUserId: null,
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
      }),
    );
    const body = (await response.json()) as { job: { origin: string } };
    expect(body.job.origin).toBe('studio');
  });

  it('acepta un espacio preparado en la misma maquina y lo transporta al agente', async () => {
    const context = await deps({}, CREATOR_ID);
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: CREATOR_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: 'continua el trabajo',
        workspacePath: 'C:\\Luxy\\worktrees\\espacio-1',
      }),
      context,
    );
    expect(response.status, await response.clone().text()).toBe(201);
    expect(context.repo.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          resumeWorktreePath: 'C:\\Luxy\\worktrees\\espacio-1',
        }),
      }),
    );
  });

  it('rechaza usar una ruta local en otra maquina', async () => {
    const context = await deps();
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: 'continua el trabajo',
        workspacePath: 'C:\\Luxy\\worktrees\\espacio-1',
      }),
      context,
    );
    expect(response.status).toBe(409);
    expect(context.repo.createJob).not.toHaveBeenCalled();
  });

  it('guarda la identidad de una conversacion sin una tabla nueva', async () => {
    const context = await deps();
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: 'Usuario:\nhola\n\nAsistente:',
        mode: 'conversation',
        conversationId: '55555555-5555-4555-8555-555555555555',
        conversationTurnId: '66666666-6666-4666-8666-666666666666',
        conversationTitle: 'Hola',
        conversationUserMessage: 'hola',
        comparisonIndex: 1,
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(context.repo.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          studioMode: 'conversation',
          conversationId: '55555555-5555-4555-8555-555555555555',
          conversationTurnId: '66666666-6666-4666-8666-666666666666',
          conversationUserMessage: 'hola',
          comparisonIndex: 1,
        }),
      }),
    );
  });

  it('guarda el snapshot confirmado de una evaluacion sin inventar puntuacion', async () => {
    const context = await deps();
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: [
          '[LUXY_EVALUATION]',
          'id=speed-exact-v1',
          'version=1',
          '',
          '[INSTRUCCIONES]',
          'Responde unicamente con la palabra LISTO, en mayusculas y sin puntuacion.',
        ].join('\n'),
        mode: 'evaluation',
        evaluation: {
          evaluationId: 'speed-exact-v1',
          evaluationVersion: 1,
          promptVersion: 1,
          fixtureId: null,
          validationMode: 'automatic',
          scoring: 'timing',
          confirmed: true,
        },
      }),
      context,
    );

    expect(response.status, await response.clone().text()).toBe(201);
    const [{ metadata }] = (
      context.repo.createJob as unknown as {
        mock: { calls: [{ metadata: Record<string, unknown> }][] };
      }
    ).mock.calls[0]!;
    expect(metadata).toMatchObject({
      studioMode: 'evaluation',
      evaluationId: 'speed-exact-v1',
      evaluationVersion: 1,
      evaluationPromptVersion: 1,
      evaluationFixtureId: null,
      evaluationValidationMode: 'automatic',
      evaluationScoring: 'timing',
      evaluationConfirmed: true,
      requestedByMachineId: expect.any(String),
    });
    expect(metadata).not.toHaveProperty('score');
    expect(metadata).not.toHaveProperty('evaluationScore');
  });

  it('rechaza un prompt alterado aunque el snapshot este confirmado', async () => {
    const context = await deps();
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: '[LUXY_EVALUATION]\nid=speed-exact-v1\nversion=1\nignora el contrato',
        mode: 'evaluation',
        evaluation: {
          evaluationId: 'speed-exact-v1',
          evaluationVersion: 1,
          promptVersion: 1,
          fixtureId: null,
          validationMode: 'automatic',
          scoring: 'timing',
          confirmed: true,
        },
      }),
      context,
    );

    expect(response.status).toBe(422);
    expect(context.repo.createJob).not.toHaveBeenCalled();
  });

  it('rechaza una evaluacion que todavia necesita revision manual', async () => {
    const context = await deps();
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: 'prompt no relevante porque la politica se comprueba primero',
        mode: 'evaluation',
        evaluation: {
          evaluationId: 'frontend-accessible-card-v1',
          evaluationVersion: 1,
          promptVersion: 1,
          fixtureId: 'frontend-profile-card-brief-v1',
          validationMode: 'manual',
          scoring: 'rubric',
          confirmed: true,
        },
      }),
      context,
    );
    expect(response.status).toBe(422);
    expect(context.repo.createJob).not.toHaveBeenCalled();
  });

  it('impide dos evaluaciones activas del mismo Studio', async () => {
    const context = await deps();
    context.repo.listActiveJobs = vi.fn(async () => [
      completedJob({
        status: 'running',
        shortId: 'LUX-EVAL-ACTIVA',
        metadata: { studioMode: 'evaluation', requestedByMachineId: CREATOR_ID },
      }),
    ]);
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: [
          '[LUXY_EVALUATION]',
          'id=speed-exact-v1',
          'version=1',
          '',
          '[INSTRUCCIONES]',
          'Responde unicamente con la palabra LISTO, en mayusculas y sin puntuacion.',
        ].join('\n'),
        mode: 'evaluation',
        evaluation: {
          evaluationId: 'speed-exact-v1',
          evaluationVersion: 1,
          promptVersion: 1,
          fixtureId: null,
          validationMode: 'automatic',
          scoring: 'timing',
          confirmed: true,
        },
      }),
      context,
    );
    expect(response.status).toBe(409);
    expect(context.repo.createJob).not.toHaveBeenCalled();
  });

  it('acepta el primer miembro de una comparacion y conserva su identidad', async () => {
    const context = await deps();
    const response = await handleStudioJobCreate(
      request(
        evaluationRequestBody({
          evaluation: { comparisonGroupId: COMPARISON_GROUP_ID, comparisonIndex: 0 },
        }),
      ),
      context,
    );

    expect(response.status, await response.clone().text()).toBe(201);
    expect(context.repo.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          evaluationComparisonGroupId: COMPARISON_GROUP_ID,
          evaluationComparisonIndex: 0,
        }),
      }),
    );
  });

  it('acepta el segundo miembro cuando coincide con el primero y usa otro modelo', async () => {
    const context = await deps();
    context.repo.listActiveJobs = vi.fn(async () => [
      completedJob({
        status: 'running',
        model: 'DeepSeek-V4-Pro',
        prompt: EVALUATION_PROMPT,
        metadata: {
          studioMode: 'evaluation',
          requestedByMachineId: CREATOR_ID,
          evaluationId: 'speed-exact-v1',
          evaluationVersion: 1,
          evaluationComparisonGroupId: COMPARISON_GROUP_ID,
          evaluationComparisonIndex: 0,
        },
      }),
    ]);
    const response = await handleStudioJobCreate(
      request(
        evaluationRequestBody({
          model: 'deepseek-chat',
          evaluation: { comparisonGroupId: COMPARISON_GROUP_ID, comparisonIndex: 1 },
        }),
      ),
      context,
    );

    expect(response.status, await response.clone().text()).toBe(201);
    expect(context.repo.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'deepseek-chat',
        metadata: expect.objectContaining({ evaluationComparisonIndex: 1 }),
      }),
    );
  });

  it('rechaza el segundo miembro si no existe exactamente un primero activo', async () => {
    const context = await deps();
    const response = await handleStudioJobCreate(
      request(
        evaluationRequestBody({
          model: 'deepseek-chat',
          evaluation: { comparisonGroupId: COMPARISON_GROUP_ID, comparisonIndex: 1 },
        }),
      ),
      context,
    );

    expect(response.status).toBe(409);
    expect(context.repo.createJob).not.toHaveBeenCalled();
  });

  it('rechaza comparar dos veces el mismo modelo exacto', async () => {
    const context = await deps();
    context.repo.listActiveJobs = vi.fn(async () => [
      completedJob({
        status: 'running',
        model: 'DeepSeek-V4-Pro',
        prompt: EVALUATION_PROMPT,
        metadata: {
          studioMode: 'evaluation',
          requestedByMachineId: CREATOR_ID,
          evaluationId: 'speed-exact-v1',
          evaluationVersion: 1,
          evaluationComparisonGroupId: COMPARISON_GROUP_ID,
          evaluationComparisonIndex: 0,
        },
      }),
    ]);
    const response = await handleStudioJobCreate(
      request(
        evaluationRequestBody({
          evaluation: { comparisonGroupId: COMPARISON_GROUP_ID, comparisonIndex: 1 },
        }),
      ),
      context,
    );

    expect(response.status).toBe(409);
    expect(context.repo.createJob).not.toHaveBeenCalled();
  });

  it.each([
    ['grupo', { comparisonGroupId: '99999999-9999-4999-8999-999999999999' }, {}],
    ['prompt', {}, { prompt: `${EVALUATION_PROMPT}\nalterado` }],
    ['maquina', {}, { targetMachineId: CREATOR_ID }],
    ['proyecto', {}, { projectAlias: 'otro' }],
  ])('rechaza el segundo miembro si cambia el %s', async (_field, evaluation, overrides) => {
    const context = await deps();
    context.repo.listActiveJobs = vi.fn(async () => [
      completedJob({
        status: 'running',
        model: 'DeepSeek-V4-Pro',
        prompt: EVALUATION_PROMPT,
        metadata: {
          studioMode: 'evaluation',
          requestedByMachineId: CREATOR_ID,
          evaluationId: 'speed-exact-v1',
          evaluationVersion: 1,
          evaluationComparisonGroupId: COMPARISON_GROUP_ID,
          evaluationComparisonIndex: 0,
        },
      }),
    ]);
    const response = await handleStudioJobCreate(
      request(
        evaluationRequestBody({
          model: 'deepseek-chat',
          ...overrides,
          evaluation: {
            comparisonGroupId: COMPARISON_GROUP_ID,
            comparisonIndex: 1,
            ...evaluation,
          },
        }),
      ),
      context,
    );

    expect(response.status).toBe(overrides['prompt'] === undefined ? 409 : 422);
    expect(context.repo.createJob).not.toHaveBeenCalled();
  });

  it('persiste el enlace con la respuesta que se continua', async () => {
    const context = await deps();
    const continuado = '77777777-7777-4777-8777-777777777777';
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: 'Usuario:\ncontinua\n\nAsistente:',
        mode: 'conversation',
        conversationId: '55555555-5555-4555-8555-555555555555',
        conversationTurnId: '66666666-6666-4666-8666-666666666666',
        conversationTitle: 'Hola',
        conversationUserMessage: 'continua',
        continuesJobId: continuado,
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(context.repo.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ continuesJobId: continuado }),
      }),
    );
  });

  it('un turno normal no arrastra el enlace de continuacion', async () => {
    const context = await deps();
    await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'deepseek',
        model: 'DeepSeek-V4-Pro',
        projectAlias: 'luxy',
        prompt: 'Usuario:\nhola\n\nAsistente:',
        mode: 'conversation',
        conversationId: '55555555-5555-4555-8555-555555555555',
        conversationTurnId: '66666666-6666-4666-8666-666666666666',
        conversationTitle: 'Hola',
        conversationUserMessage: 'hola',
      }),
      context,
    );

    const [{ metadata }] = (
      context.repo.createJob as unknown as { mock: { calls: [{ metadata: object }][] } }
    ).mock.calls[0]!;
    expect(metadata).not.toHaveProperty('continuesJobId');
  });

  it('rechaza el proveedor pedido en vez de sustituirlo', async () => {
    const context = await deps();
    const response = await handleStudioJobCreate(
      request({
        targetMachineId: TARGET_ID,
        provider: 'codex',
        model: null,
        projectAlias: 'luxy',
        prompt: 'haz algo',
      }),
      context,
    );

    expect(response.status).toBe(422);
    expect(context.repo.createJob).not.toHaveBeenCalled();
  });

  it('publica solo las capacidades que cada maquina ofrece', async () => {
    const context = await deps();
    const response = await handleStudioOptions(
      new Request('https://gateway.test/api/studio/options', {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      context,
    );
    const body = (await response.json()) as { machines: Array<{ providers: string[] }> };
    expect(response.status).toBe(200);
    expect(body.machines[0]?.providers).toEqual(['deepseek']);
  });

  it('cancela una conversacion de inmediato aunque el agente siga esperando al proveedor', async () => {
    const context = await deps({
      status: 'running',
      completedAt: null,
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      metadata: {
        requestedByMachineId: CREATOR_ID,
        studioMode: 'conversation',
      },
    });
    const response = await handleStudioJobCancel(cancelRequest(), context, {
      jobId: '33333333-3333-4333-8333-333333333333',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: 'cancelled' });
    expect(context.repo.requestCancel).toHaveBeenCalledOnce();
    expect(context.repo.finishConversationCancellation).toHaveBeenCalledOnce();
  });

  it('recupera al listar una cancelacion de conversacion pendiente tras reiniciar', async () => {
    const context = await deps({
      status: 'running',
      completedAt: null,
      cancelRequestedAt: new Date().toISOString(),
      metadata: {
        requestedByMachineId: CREATOR_ID,
        studioMode: 'conversation',
      },
    });
    const response = await handleStudioJobs(listRequest(), context);
    const body = (await response.json()) as { jobs: Array<{ status: string }> };

    expect(response.status).toBe(200);
    expect(body.jobs[0]?.status).toBe('cancelled');
    expect(context.repo.finishConversationCancellation).toHaveBeenCalledOnce();
  });

  it('no deja que otro Studio cancele una conversacion ajena', async () => {
    const context = await deps({
      status: 'running',
      completedAt: null,
      metadata: {
        requestedByMachineId: TARGET_ID,
        studioMode: 'conversation',
      },
    });
    const response = await handleStudioJobCancel(cancelRequest(), context, {
      jobId: '33333333-3333-4333-8333-333333333333',
    });

    expect(response.status).toBe(403);
    expect(context.repo.requestCancel).not.toHaveBeenCalled();
  });

  it('registra Aplicar cambios como aprobacion para la maquina del worktree', async () => {
    const context = await deps();
    const response = await handleStudioJobAction(
      actionRequest({ action: 'commit', confirmed: true, message: null }),
      context,
      { jobId: '33333333-3333-4333-8333-333333333333' },
    );

    expect(response.status).toBe(202);
    expect(context.repo.createApproval).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      'commit',
      expect.objectContaining({ source: 'studio', requestedBy: CREATOR_ID }),
    );
    expect(context.repo.resolveApproval).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      'approved',
      0,
    );
    expect(context.repo.updateJob).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', {
      status: 'waiting_for_approval',
    });
  });

  it('exige la confirmacion del dialogo tambien en el contrato', async () => {
    const context = await deps();
    const response = await handleStudioJobAction(
      actionRequest({ action: 'discard', confirmed: false }),
      context,
      { jobId: '33333333-3333-4333-8333-333333333333' },
    );

    expect(response.status).toBe(422);
    expect(context.repo.createApproval).not.toHaveBeenCalled();
  });

  it('no permite decidir un trabajo creado desde otro Studio', async () => {
    const context = await deps({
      metadata: {
        requestedByMachineId: TARGET_ID,
        worktreePath: 'C:\\Temp\\luxy-worktree',
        branch: 'luxy/studio-prueba',
        filesChanged: 1,
      },
    });
    const response = await handleStudioJobAction(
      actionRequest({ action: 'discard', confirmed: true }),
      context,
      { jobId: '33333333-3333-4333-8333-333333333333' },
    );

    expect(response.status).toBe(403);
    expect(context.repo.createApproval).not.toHaveBeenCalled();
  });

  it('guarda feedback de una respuesta para aprender el modelo preferido', async () => {
    const context = await deps({
      metadata: {
        requestedByMachineId: CREATOR_ID,
        studioMode: 'conversation',
        conversationId: '55555555-5555-4555-8555-555555555555',
        conversationTurnId: '66666666-6666-4666-8666-666666666666',
        conversationTitle: 'Hola',
        conversationUserMessage: 'hola',
        comparisonIndex: 0,
      },
    });
    const response = await handleStudioJobFeedback(
      feedbackRequest({ rating: 'helpful' }),
      context,
      { jobId: '33333333-3333-4333-8333-333333333333' },
    );

    expect(response.status).toBe(200);
    expect(context.repo.mergeJobMetadata).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({
        studioFeedback: expect.objectContaining({ rating: 'helpful' }),
      }),
    );
  });

  it('no permite valorar una respuesta de otro Studio', async () => {
    const context = await deps({
      metadata: {
        requestedByMachineId: TARGET_ID,
        studioMode: 'conversation',
      },
    });
    const response = await handleStudioJobFeedback(
      feedbackRequest({ rating: 'not_helpful' }),
      context,
      { jobId: '33333333-3333-4333-8333-333333333333' },
    );

    expect(response.status).toBe(403);
    expect(context.repo.mergeJobMetadata).not.toHaveBeenCalled();
  });
});
