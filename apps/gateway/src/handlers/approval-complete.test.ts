import { describe, expect, it, vi } from 'vitest';
import { hashToken } from '../auth.js';
import { handleApprovalComplete } from './api.js';

const TOKEN = 'token-approval-0123456789abcdefghijkl';
const MACHINE_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const APPROVAL_ID = '33333333-3333-4333-8333-333333333333';

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

function job(claimedBy = MACHINE_ID) {
  return {
    id: JOB_ID,
    shortId: 'LUX-APPLY',
    origin: 'studio',
    telegramChatId: null,
    telegramUserId: null,
    targetMachineId: MACHINE_ID,
    provider: 'codex',
    model: null,
    projectAlias: 'luxy',
    prompt: 'aplica',
    status: 'waiting_for_approval',
    priority: 0,
    claimedBy,
    claimedAt: new Date().toISOString(),
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    resultSummary: 'listo',
    errorMessage: null,
    metadata: {
      studioDecision: {
        action: 'commit',
        state: 'pending',
        requestedAt: '2026-08-03T10:00:00.000Z',
      },
    },
    createdAt: new Date().toISOString(),
  };
}

async function deps(status = 'approved', claimedBy = MACHINE_ID) {
  const repo = {
    getApproval: vi.fn(async () => ({
      id: APPROVAL_ID,
      job_id: JOB_ID,
      action: 'commit',
      status,
    })),
    getJobById: vi.fn(async () => job(claimedBy)),
    mergeJobMetadata: vi.fn(async () => undefined),
    updateJob: vi.fn(async () => job()),
    completeApproval: vi.fn(async () => ({
      id: APPROVAL_ID,
      job_id: JOB_ID,
      action: 'commit',
    })),
  };
  return {
    db: await fakeDb(),
    repo,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never as Parameters<typeof handleApprovalComplete>[1];
}

function request(ok = true): Request {
  return new Request(`https://gateway.test/api/approvals/${APPROVAL_ID}/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok, message: ok ? 'commit creado' : 'permiso denegado' }),
  });
}

describe('resultado de aprobaciones', () => {
  it('consume la orden y devuelve el trabajo de Studio a completado', async () => {
    const context = await deps();
    const response = await handleApprovalComplete(request(), context, { approvalId: APPROVAL_ID });

    expect(response.status).toBe(200);
    expect(context.repo.mergeJobMetadata).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        studioDecision: expect.objectContaining({
          action: 'commit',
          state: 'applied',
          message: 'commit creado',
        }),
      }),
    );
    expect(context.repo.updateJob).toHaveBeenCalledWith(JOB_ID, { status: 'completed' });
    expect(context.repo.completeApproval).toHaveBeenCalledWith(APPROVAL_ID, true);
  });

  it('acepta idempotentemente el reenvio de una orden ya consumida', async () => {
    const context = await deps('expired');
    const response = await handleApprovalComplete(request(), context, { approvalId: APPROVAL_ID });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(context.repo.completeApproval).not.toHaveBeenCalled();
    expect(context.repo.updateJob).not.toHaveBeenCalled();
  });

  it('rechaza el resultado enviado por otra maquina', async () => {
    const context = await deps('approved', '44444444-4444-4444-8444-444444444444');
    const response = await handleApprovalComplete(request(), context, { approvalId: APPROVAL_ID });

    expect(response.status).toBe(403);
    expect(context.repo.completeApproval).not.toHaveBeenCalled();
  });
});
