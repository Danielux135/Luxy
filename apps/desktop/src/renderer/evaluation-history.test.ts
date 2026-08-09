import { describe, expect, it } from 'vitest';
import type { StudioJob } from '@luxy/shared';
import {
  collectActiveModelEvaluations,
  collectModelEvaluationHistory,
} from './evaluation-history.js';

function job(overrides: Partial<StudioJob> = {}): StudioJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    shortId: 'LUX-EVAL',
    origin: 'studio',
    targetMachineId: '22222222-2222-4222-8222-222222222222',
    provider: 'codex',
    model: 'gpt-evaluado',
    projectAlias: 'luxy',
    prompt: '[LUXY_EVALUATION]',
    status: 'completed',
    priority: 0,
    claimedBy: null,
    startedAt: null,
    completedAt: '2026-08-09T10:01:00.000Z',
    resultSummary: 'LISTO',
    errorMessage: null,
    createdAt: '2026-08-09T10:00:00.000Z',
    metadata: {
      studioMode: 'evaluation',
      evaluationId: 'speed-exact-v1',
      evaluationVersion: 1,
      evaluationValidatedAt: '2026-08-09T10:01:00.000Z',
      evaluationResult: {
        evaluationId: 'speed-exact-v1',
        evaluationVersion: 1,
        promptVersion: 1,
        fixtureId: null,
        validationMode: 'automatic',
        scoring: 'timing',
        model: 'gpt-evaluado',
        status: 'passed',
        checks: [{ label: 'salida exacta', passed: true }],
        reason: null,
        responseOutcome: 'completed',
        outputChars: 5,
        durationMs: 1200,
        inputTokens: 20,
        outputTokens: 1,
      },
    },
    ...overrides,
  };
}

describe('historial local del Laboratorio', () => {
  it('acepta, ordena y conserva resultados validos', () => {
    const older = job({
      id: '33333333-3333-4333-8333-333333333333',
      createdAt: '2026-08-08T10:00:00.000Z',
    });
    const entries = collectModelEvaluationHistory([older, job()]);
    expect(entries.map((entry) => entry.jobId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(entries[0]?.result).toMatchObject({ status: 'passed', durationMs: 1200 });
  });

  it('ignora tareas normales y resultados con forma invalida', () => {
    expect(
      collectModelEvaluationHistory([
        job({ metadata: { studioMode: 'task' } }),
        job({ metadata: { studioMode: 'evaluation', evaluationResult: { status: 'passed' } } }),
      ]),
    ).toEqual([]);
  });

  it('rechaza una identidad, version o modelo que no coincida con el trabajo', () => {
    const base = job();
    expect(
      collectModelEvaluationHistory([
        job({ metadata: { ...base.metadata, evaluationId: 'otra-prueba' } }),
        job({ metadata: { ...base.metadata, evaluationVersion: 2 } }),
        job({ model: 'otro-modelo' }),
      ]),
    ).toEqual([]);
  });

  it('admite fecha de validacion ausente sin inventarla', () => {
    const base = job();
    const entries = collectModelEvaluationHistory([
      job({ metadata: { ...base.metadata, evaluationValidatedAt: 'no-es-fecha' } }),
    ]);
    expect(entries[0]?.validatedAt).toBeNull();
  });

  it('separa evaluaciones activas validando su snapshot', () => {
    const base = job();
    const active = job({
      status: 'running',
      resultSummary: null,
      completedAt: null,
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
    });
    expect(collectActiveModelEvaluations([base, active])).toEqual([
      expect.objectContaining({
        jobId: active.id,
        evaluationId: 'speed-exact-v1',
        status: 'running',
      }),
    ]);
    expect(
      collectActiveModelEvaluations([
        active,
        job({ ...active, model: null }),
        job({ status: 'cancelled' }),
      ]),
    ).toHaveLength(1);
  });
});
