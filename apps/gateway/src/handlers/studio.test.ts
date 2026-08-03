import { describe, expect, it, vi } from 'vitest';
import { hashToken } from '../auth.js';
import { handleStudioJobAction, handleStudioJobCreate, handleStudioOptions } from './studio.js';

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
    getJobById: vi.fn(async () => currentJob),
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
});
