import { describe, expect, it } from 'vitest';
import type { StudioJob } from '@luxy/shared';
import { canDecideStudioJob, parseStudioDecision } from './studio-decision.js';

function job(
  metadata: Record<string, unknown>,
  status: StudioJob['status'] = 'completed',
): StudioJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    shortId: 'LUX-TEST',
    origin: 'studio',
    targetMachineId: '22222222-2222-4222-8222-222222222222',
    provider: 'codex',
    model: null,
    projectAlias: 'demo',
    prompt: 'prueba',
    status,
    priority: 0,
    claimedBy: '22222222-2222-4222-8222-222222222222',
    startedAt: null,
    completedAt: null,
    resultSummary: null,
    errorMessage: null,
    metadata,
    createdAt: new Date(0).toISOString(),
  };
}

describe('decisiones de Studio', () => {
  it('ofrece acciones solo para un diff terminado y conservado', () => {
    expect(
      canDecideStudioJob(
        job({ worktreePath: 'C:\\Temp\\worktree', branch: 'luxy/test', filesChanged: 1 }),
      ),
    ).toBe(true);
    expect(
      canDecideStudioJob(
        job(
          { worktreePath: 'C:\\Temp\\worktree', branch: 'luxy/test', filesChanged: 1 },
          'running',
        ),
      ),
    ).toBe(false);
    expect(canDecideStudioJob(job({ filesChanged: 1 }))).toBe(false);
  });

  it('oculta las acciones tras aplicar o descartar', () => {
    const base = { worktreePath: 'C:\\Temp\\worktree', branch: 'luxy/test', filesChanged: 1 };
    expect(
      canDecideStudioJob(job({ ...base, studioDecision: { action: 'commit', state: 'applied' } })),
    ).toBe(false);
    expect(
      canDecideStudioJob(job({ ...base, studioDecision: { action: 'discard', state: 'failed' } })),
    ).toBe(true);
  });

  it('descarta metadata incompleta en vez de inventar un estado', () => {
    expect(
      parseStudioDecision({ studioDecision: { action: 'push', state: 'applied' } }),
    ).toBeNull();
    expect(parseStudioDecision({ studioDecision: { action: 'commit' } })).toBeNull();
  });
});
