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

function job(status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' = 'running') {
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
    cancelRequestedAt: status === 'cancelled' ? new Date().toISOString() : null,
    startedAt: new Date().toISOString(),
    completedAt: status === 'running' ? null : new Date().toISOString(),
    resultSummary: null,
    errorMessage: null,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

async function run(
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted',
  extras: Record<string, unknown> = {},
) {
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
        conversationMemory: {
          version: 1,
          summary: 'Memoria de la conversacion.',
          facts: ['El proyecto se llama Luxy.'],
          decisions: [],
          plan: ['Continuar.'],
          openQuestions: [],
          lessons: [],
        },
        ...extras,
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

  it('confirma y descarta un cierre que llego despues de cancelar', async () => {
    const { response, repo } = await run('cancelled');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      duplicate: true,
      ignoredBecause: 'cancelled',
    });
    expect(repo.updateJob).not.toHaveBeenCalled();
  });

  it('un trabajo de Studio se completa sin intentar usar Telegram', async () => {
    const { response, repo, telegram } = await run('running');
    expect(response.status).toBe(200);
    expect(repo.updateJob).toHaveBeenCalledOnce();
    expect(repo.updateJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          conversationMemory: expect.objectContaining({ summary: 'Memoria de la conversacion.' }),
        }),
      }),
    );
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(telegram.editMessageText).not.toHaveBeenCalled();
  });

  // POR QUE EXISTE: el estado del trabajo en Postgres no distingue una
  // respuesta entera de una cortada, y no se toca el enum sin migracion. El
  // motivo real tiene que llegar a Studio por metadata o se pierde.
  it('persiste el final real y su evidencia junto al resultado', async () => {
    const { response, repo } = await run('running', {
      responseOutcome: 'truncated',
      responseTermination: {
        httpStatus: 200,
        streamed: true,
        chunks: 120,
        bytes: 48_000,
        durationMs: 1_423_000,
        transportEnd: 'done_marker',
        finishReason: 'length',
        finalUsageReceived: true,
        abortedBy: null,
        effectiveTimeoutMs: 3_600_000,
        maxOutputTokens: 8192,
        inputTokens: 287,
        outputTokens: 6422,
        textLength: 24_910,
      },
    });

    expect(response.status).toBe(200);
    expect(repo.updateJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        // el estado sigue siendo el del enum: lo que cambia es el detalle
        status: 'completed',
        metadata: expect.objectContaining({
          responseOutcome: 'truncated',
          responseTermination: expect.objectContaining({ finishReason: 'length' }),
        }),
      }),
    );
  });

  // POR QUE EXISTE: la respuesta completa ya se guarda entera, y eso puede ser
  // una pagina web. La tarjeta de Telegram no puede convertirse en veinte
  // mensajes; el resultado completo se lee en Studio.
  it('recorta la tarjeta de Telegram sin tocar lo que se guarda', async () => {
    const respuesta = 'x'.repeat(20_000);
    const repo = {
      getJobById: vi.fn(async () => ({ ...job('running'), telegramChatId: 12345 })),
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

    await handleJobComplete(
      new Request(`https://gateway.test/api/jobs/${JOB_ID}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          summary: respuesta,
          filesChanged: 0,
          testsPassed: 0,
          testsFailed: 0,
          durationMs: 10,
          diffStat: null,
          branch: null,
          worktreePath: null,
          sessionId: null,
          testLogs: [],
        }),
      }),
      deps,
      { jobId: JOB_ID },
    );

    // se guarda entera
    const [, patch] = repo.updateJob.mock.calls[0] as [string, { result_summary: string }];
    expect(patch.result_summary).toHaveLength(20_000);

    // pero la tarjeta va recortada y lo dice
    const enviado = [
      ...telegram.editMessageText.mock.calls,
      ...telegram.sendMessage.mock.calls,
    ]
      .flat()
      .filter((arg): arg is string => typeof arg === 'string')
      .join('\n');
    expect(enviado).toContain('respuesta completa en Luxy Studio');
    expect(enviado.length).toBeLessThan(6000);
  });

  it('un resultado sin final declarado conserva el contrato anterior', async () => {
    const { repo } = await run('running');
    const [, patch] = repo.updateJob.mock.calls[0] as [string, { metadata: Record<string, unknown> }];
    expect(patch.metadata).not.toHaveProperty('responseOutcome');
    expect(patch.metadata).not.toHaveProperty('responseTermination');
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
