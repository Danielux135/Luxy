import { describe, expect, it, vi } from 'vitest';
import { hashToken } from '../auth.js';
import { handleJobEvents } from './api.js';

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
