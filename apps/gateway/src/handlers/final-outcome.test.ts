import { describe, expect, it, vi } from 'vitest';
import { hashToken } from '../auth.js';
import { handleJobComplete } from './api.js';

const TOKEN = 'token-final-0123456789abcdefghijkl';
const MACHINE_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

async function fakeDb(): Promise<unknown> {
  return {
    async selectOne(table: string) {
      if (table === 'machine_tokens') {
        return {
          id: 'token-1',
          machine_id: MACHINE_ID,
          token_hash: await hashToken(TOKEN),
          revoked_at: null,
          expires_at: null,
        };
      }
      return { id: MACHINE_ID, name: 'pc-casa', enabled: true };
    },
  };
}

function job(status: 'running' | 'completed' | 'failed' | 'interrupted' = 'running') {
  return {
    id: JOB_ID,
    shortId: 'LUX-FINAL',
    origin: 'studio',
    telegramChatId: null,
    telegramUserId: null,
    targetMachineId: MACHINE_ID,
    provider: 'deepseek',
    model: null,
    projectAlias: 'luxy',
    prompt: 'termina',
    status,
    priority: 0,
    claimedBy: MACHINE_ID,
    claimedAt: new Date().toISOString(),
    leaseExpiresAt: new Date().toISOString(),
    cancelRequestedAt: null,
    startedAt: new Date().toISOString(),
    completedAt: status === 'running' ? null : new Date().toISOString(),
    resultSummary: null,
    errorMessage: null,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

async function run(status: 'running' | 'completed' | 'failed' | 'interrupted') {
  const repo = {
    getJobById: vi.fn(async () => job(status)),
    updateJob: vi.fn(async () => job('completed')),
    recordProviderUsage: vi.fn(async () => undefined),
  };
  const telegram = {
    editMessageText: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
    sendMedia: vi.fn(async () => undefined),
  };
  const deps = {
    db: await fakeDb(),
    repo,
    telegram,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never as Parameters<typeof handleJobComplete>[1];

  const response = await handleJobComplete(
    new Request(`https://gateway.test/api/jobs/${JOB_ID}/complete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: 'listo',
        filesChanged: 1,
        testsPassed: 0,
        testsFailed: 0,
        durationMs: 10,
        diffStat: '1 file changed',
        branch: 'luxy/test',
        worktreePath: 'C:\\Temp\\worktree',
        sessionId: null,
        testLogs: [],
      }),
    }),
    deps,
    { jobId: JOB_ID },
  );
  return { response, repo, telegram };
}

describe('resultado final idempotente', () => {
  it('un reenvio completado no repite efectos', async () => {
    const { response, repo, telegram } = await run('completed');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, duplicate: true });
    expect(repo.updateJob).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('rechaza un cierre incompatible', async () => {
    const { response, repo } = await run('failed');
    expect(response.status).toBe(409);
    expect(repo.updateJob).not.toHaveBeenCalled();
  });

  it('un trabajo de Studio se completa sin intentar usar Telegram', async () => {
    const { response, repo, telegram } = await run('running');
    expect(response.status).toBe(200);
    expect(repo.updateJob).toHaveBeenCalledOnce();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(telegram.editMessageText).not.toHaveBeenCalled();
  });

  it('el resultado real sustituye una interrupcion provisional del lease', async () => {
    const { response, repo } = await run('interrupted');
    expect(response.status).toBe(200);
    expect(repo.updateJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: 'completed', error_message: null }),
    );
  });
});
