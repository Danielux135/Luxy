import { describe, expect, it, vi } from 'vitest';
import { hashToken } from '../auth.js';
import { handleJobCancelled, handleJobEvents } from './api.js';

const TOKEN = 'token-cancelled-events-0123456789abcd';
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

describe('eventos tardios despues de cancelar', () => {
  it('los confirma sin revivir el trabajo ni guardarlos', async () => {
    const appendEvents = vi.fn(async () => undefined);
    const updateJob = vi.fn(async () => undefined);
    const renewLease = vi.fn(async () => null);
    const deps = {
      db: await fakeDb(),
      repo: {
        getJobById: vi.fn(async () => ({
          id: JOB_ID,
          claimedBy: MACHINE_ID,
          status: 'cancelled',
          startedAt: null,
          leaseExpiresAt: null,
          metadata: {},
          telegramChatId: null,
        })),
        appendEvents,
        updateJob,
        renewLease,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      telegram: { editMessageText: vi.fn(async () => undefined) },
    } as never as Parameters<typeof handleJobEvents>[1];

    const response = await handleJobEvents(
      new Request(`https://gateway.test/api/jobs/${JOB_ID}/events`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          events: [{ sequence: 1, type: 'provider_output', message: 'fragmento tardio' }],
          renewLeaseSeconds: 120,
        }),
      }),
      deps,
      { jobId: JOB_ID },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ignored: true });
    expect(appendEvents).not.toHaveBeenCalled();
    expect(updateJob).not.toHaveBeenCalled();
    expect(renewLease).not.toHaveBeenCalled();
  });
});

describe('P0.6d - una cancelacion conserva lo generado', () => {
  async function cancelDeps(
    updateJob: ReturnType<typeof vi.fn>,
    overrides: Record<string, unknown> = {},
  ): Promise<unknown> {
    return {
      db: await fakeDb(),
      repo: {
        getJobById: vi.fn(async () => ({
          id: JOB_ID,
          shortId: 'LUX-CANC',
          claimedBy: MACHINE_ID,
          status: 'running',
          projectAlias: 'demo',
          cancelRequestedAt: null,
          completedAt: null,
          metadata: { studioMode: 'conversation' },
          telegramChatId: null,
          model: null,
          ...overrides,
        })),
        updateJob,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      telegram: { editMessageText: vi.fn(async () => undefined) },
    };
  }

  function cancelRequest(body: Record<string, unknown>): Request {
    return new Request(`https://gateway.test/api/jobs/${JOB_ID}/cancelled`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('guarda el texto parcial como resultado y marca el final real', async () => {
    const updateJob = vi.fn(async () => undefined);
    const deps = (await cancelDeps(updateJob)) as never as Parameters<typeof handleJobCancelled>[1];

    const response = await handleJobCancelled(
      cancelRequest({
        modifiedFiles: [],
        worktreePath: null,
        durationMs: 1_420_000,
        partialText: '<html>veintitres minutos de generacion',
        executedModel: 'Kimi-K2.6',
      }),
      deps,
      { jobId: JOB_ID },
    );

    expect(response.status).toBe(200);
    const [, patch] = updateJob.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(patch['status']).toBe('cancelled');
    expect(patch['result_summary']).toBe('<html>veintitres minutos de generacion');
    expect(patch['model']).toBe('Kimi-K2.6');
    expect(patch['metadata']).toMatchObject({
      responseOutcome: 'cancelled',
      executedModel: 'Kimi-K2.6',
    });
  });

  it('sin texto parcial no inventa resultado ni final', async () => {
    const updateJob = vi.fn(async () => undefined);
    const deps = (await cancelDeps(updateJob)) as never as Parameters<typeof handleJobCancelled>[1];

    await handleJobCancelled(
      cancelRequest({ modifiedFiles: [], worktreePath: null, durationMs: 500 }),
      deps,
      { jobId: JOB_ID },
    );

    const [, patch] = updateJob.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(patch).not.toHaveProperty('result_summary');
    expect(patch['metadata']).not.toHaveProperty('responseOutcome');
  });

  it('una evaluacion cancelada queda explicitamente sin puntuar', async () => {
    const updateJob = vi.fn(async () => undefined);
    const deps = (await cancelDeps(updateJob, {
      model: 'DeepSeek-V4-Pro',
      metadata: {
        studioMode: 'evaluation',
        evaluationId: 'speed-exact-v1',
        evaluationVersion: 1,
        evaluationPromptVersion: 1,
        evaluationFixtureId: null,
        evaluationValidationMode: 'automatic',
        evaluationScoring: 'timing',
        evaluationConfirmed: true,
      },
    })) as never as Parameters<typeof handleJobCancelled>[1];

    await handleJobCancelled(
      cancelRequest({ modifiedFiles: [], worktreePath: null, durationMs: 750 }),
      deps,
      { jobId: JOB_ID },
    );

    const [, patch] = updateJob.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(patch['metadata']).toMatchObject({
      responseOutcome: 'cancelled',
      evaluationResult: {
        status: 'not_scored',
        responseOutcome: 'cancelled',
        reason: 'la respuesta no termino de forma completa',
      },
      evaluationValidatedAt: expect.any(String),
    });
    expect(patch).not.toHaveProperty('result_summary');
  });
});
