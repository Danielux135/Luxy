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

async function deps(jobOverrides: Record<string, unknown> = {}) {
  const target = machine();
  let currentJob = completedJob(jobOverrides);
  const repo = {
    getMachineById: vi.fn(async () => target),
    listMachines: vi.fn(async () => [machine(CREATOR_ID), target]),
    listJobs: vi.fn(async () => [currentJob]),
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

    expect(response.status).toBe(201);
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
