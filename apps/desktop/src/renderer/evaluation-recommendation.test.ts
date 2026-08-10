import { describe, expect, it } from 'vitest';
import { MODEL_EVALUATIONS, type StudioJob } from '@luxy/shared';
import type { ModelEvaluationHistoryEntry } from './evaluation-history.js';
import { assessModelEvaluationRecommendation } from './evaluation-recommendation.js';

const evaluation = MODEL_EVALUATIONS.find((item) => item.id === 'speed-exact-v1')!;

function entry(
  model: string,
  status: 'passed' | 'failed' | 'not_scored',
  index: number,
  durationMs = 1000,
): ModelEvaluationHistoryEntry {
  return {
    jobId: `${model}-${index}`,
    shortId: `LUX-${index}`,
    createdAt: `2026-08-09T10:00:0${index}.000Z`,
    validatedAt: null,
    provider: 'deepseek',
    projectAlias: 'luxy',
    targetMachineId: null,
    prompt: 'LISTO',
    response: status === 'not_scored' ? null : 'LISTO',
    result: {
      evaluationId: evaluation.id,
      evaluationVersion: evaluation.version,
      promptVersion: 1,
      fixtureId: null,
      validationMode: 'automatic',
      scoring: 'timing',
      model,
      status,
      checks: status === 'not_scored' ? [] : [{ label: 'exacta', passed: status === 'passed' }],
      reason: status === 'not_scored' ? 'cancelada' : null,
      responseOutcome: status === 'not_scored' ? 'cancelled' : 'completed',
      outputChars: 5,
      durationMs,
      inputTokens: 10,
      outputTokens: 1,
    },
  };
}

function job(model: string, rating: 'helpful' | 'not_helpful'): StudioJob {
  return {
    id: crypto.randomUUID(),
    shortId: 'LUX-FEEDBACK',
    origin: 'studio',
    targetMachineId: null,
    provider: 'deepseek',
    model,
    projectAlias: 'luxy',
    prompt: 'hola',
    status: 'completed',
    priority: 0,
    claimedBy: null,
    startedAt: null,
    completedAt: null,
    resultSummary: 'respuesta',
    errorMessage: null,
    metadata: { studioMode: 'conversation', studioFeedback: { rating } },
    createdAt: '2026-08-09T10:00:00.000Z',
  };
}

function assess(entries: ModelEvaluationHistoryEntry[], jobs: StudioJob[] = []) {
  return assessModelEvaluationRecommendation({
    evaluation,
    entries,
    jobs,
    allowedModels: ['modelo-a', 'modelo-b'],
    projectAlias: 'luxy',
  });
}

describe('recomendacion prudente del Laboratorio', () => {
  it('no recomienda hasta tener dos modelos con tres resultados puntuados', () => {
    expect(
      assess([
        entry('modelo-a', 'passed', 1),
        entry('modelo-a', 'passed', 2),
        entry('modelo-a', 'passed', 3),
        entry('modelo-b', 'passed', 4),
        entry('modelo-b', 'passed', 5),
      ]),
    ).toMatchObject({ status: 'insufficient_samples', recommendation: null });
  });

  it('recomienda provisionalmente la mejor tasa sin contar not_scored', () => {
    const result = assess([
      entry('modelo-a', 'passed', 1),
      entry('modelo-a', 'passed', 2),
      entry('modelo-a', 'passed', 3),
      entry('modelo-a', 'not_scored', 4),
      entry('modelo-b', 'passed', 5),
      entry('modelo-b', 'failed', 6),
      entry('modelo-b', 'failed', 7),
    ]);
    expect(result).toMatchObject({
      status: 'recommended',
      recommendation: { model: 'modelo-a', scored: 3, passRate: 1 },
    });
  });

  it('en rapidez desempata por la menor mediana', () => {
    const result = assess([
      ...[1, 2, 3].map((index) => entry('modelo-a', 'passed', index, 900)),
      ...[4, 5, 6].map((index) => entry('modelo-b', 'passed', index, 1500)),
    ]);
    expect(result.recommendation?.model).toBe('modelo-a');
    expect(result.recommendation?.reason).toContain('900 ms');
  });

  it('no fuerza ganador si la evidencia sigue empatada', () => {
    const entries = [
      ...[1, 2, 3].map((index) => entry('modelo-a', 'passed', index)),
      ...[4, 5, 6].map((index) => entry('modelo-b', 'passed', index)),
    ];
    expect(assess(entries)).toMatchObject({
      status: 'no_clear_difference',
      recommendation: null,
    });
  });

  it('usa feedback repetido sólo para desempatar evidencia equivalente', () => {
    const entries = [
      ...[1, 2, 3].map((index) => entry('modelo-a', 'passed', index)),
      ...[4, 5, 6].map((index) => entry('modelo-b', 'passed', index)),
    ];
    const result = assess(entries, [
      job('modelo-a', 'helpful'),
      job('modelo-a', 'helpful'),
      job('modelo-b', 'helpful'),
      job('modelo-b', 'not_helpful'),
    ]);
    expect(result.recommendation).toMatchObject({ model: 'modelo-a', feedbackSamples: 2 });
  });

  it('ignora feedback de otro proyecto o sin una conversacion completada', () => {
    const entries = [
      ...[1, 2, 3].map((index) => entry('modelo-a', 'passed', index)),
      ...[4, 5, 6].map((index) => entry('modelo-b', 'passed', index)),
    ];
    const foreign = job('modelo-a', 'helpful');
    expect(
      assess(entries, [
        { ...foreign, metadata: { studioMode: 'task', studioFeedback: { rating: 'helpful' } } },
        { ...foreign, id: crypto.randomUUID(), projectAlias: 'otro' },
        { ...foreign, id: crypto.randomUUID(), status: 'running' },
      ]),
    ).toMatchObject({ status: 'no_clear_difference', recommendation: null });
  });
});
