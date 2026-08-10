import { describe, expect, it } from 'vitest';
import {
  evaluateModelEvaluationCompletion,
  modelEvaluationJobMetadataSchema,
} from './evaluation-results.js';

const metadata = {
  studioMode: 'evaluation',
  evaluationId: 'speed-exact-v1',
  evaluationVersion: 1,
  evaluationPromptVersion: 1,
  evaluationFixtureId: null,
  evaluationValidationMode: 'automatic',
  evaluationScoring: 'timing',
  evaluationConfirmed: true,
} as const;

describe('resultado persistible de una evaluacion', () => {
  it('valida una salida completa y conserva evidencia medible', () => {
    expect(
      evaluateModelEvaluationCompletion({
        metadata,
        output: 'LISTO',
        responseOutcome: 'completed',
        model: 'gpt-evaluado',
        durationMs: 1234,
        usage: { inputTokens: 20, outputTokens: 1 },
      }),
    ).toMatchObject({
      status: 'passed',
      model: 'gpt-evaluado',
      outputChars: 5,
      durationMs: 1234,
      inputTokens: 20,
      outputTokens: 1,
      checks: [{ label: 'la salida es exactamente LISTO', passed: true }],
    });
  });

  it('registra un fallo determinista sin convertirlo en una nota subjetiva', () => {
    const result = evaluateModelEvaluationCompletion({
      metadata,
      output: 'Listo.',
      responseOutcome: 'completed',
      model: 'gpt-evaluado',
      durationMs: 900,
    });
    expect(result).toMatchObject({ status: 'failed', inputTokens: null, outputTokens: null });
    expect(result).not.toHaveProperty('score');
  });

  it('no puntua una respuesta parcial', () => {
    expect(
      evaluateModelEvaluationCompletion({
        metadata,
        output: 'LIST',
        responseOutcome: 'truncated',
        model: 'gpt-evaluado',
        durationMs: 900,
      }),
    ).toMatchObject({
      status: 'not_scored',
      checks: [],
      reason: 'la respuesta alcanzo su limite de salida',
    });
  });

  it('distingue cancelacion y fallo sin puntuarlos', () => {
    for (const [responseOutcome, reason] of [
      ['cancelled', 'la evaluacion fue cancelada por la persona'],
      ['failed', 'el trabajo fallo antes de producir una respuesta valida'],
    ] as const) {
      expect(
        evaluateModelEvaluationCompletion({
          metadata,
          output: '',
          responseOutcome,
          model: 'gpt-evaluado',
          durationMs: 500,
        }),
      ).toMatchObject({ status: 'not_scored', reason });
    }
  });

  it('deja sin puntuar los modos que necesitan runner o revision', () => {
    expect(
      evaluateModelEvaluationCompletion({
        metadata: {
          ...metadata,
          evaluationId: 'frontend-accessible-card-v1',
          evaluationFixtureId: 'frontend-profile-card-brief-v1',
          evaluationValidationMode: 'manual',
          evaluationScoring: 'rubric',
        },
        output: '<article>perfil</article>',
        responseOutcome: 'completed',
        model: 'gpt-evaluado',
        durationMs: 900,
      }),
    ).toMatchObject({
      status: 'not_scored',
      reason: 'requiere una rubrica revisada por una persona',
    });
  });

  it('ignora trabajos normales y metadata incompleta', () => {
    expect(
      evaluateModelEvaluationCompletion({
        metadata: { studioMode: 'task' },
        output: 'LISTO',
        responseOutcome: 'completed',
        model: 'gpt-evaluado',
        durationMs: 10,
      }),
    ).toBeNull();
  });

  it('no puntua un snapshot que ya no coincide con el catalogo', () => {
    expect(
      evaluateModelEvaluationCompletion({
        metadata: { ...metadata, evaluationVersion: 99 },
        output: 'LISTO',
        responseOutcome: 'completed',
        model: 'gpt-evaluado',
        durationMs: 10,
      }),
    ).toMatchObject({
      status: 'not_scored',
      reason: 'el snapshot no coincide con el catalogo actual',
    });
  });

  it('valida junta la identidad persistida de una comparacion', () => {
    expect(
      modelEvaluationJobMetadataSchema.safeParse({
        ...metadata,
        evaluationComparisonGroupId: '88888888-8888-4888-8888-888888888888',
      }).success,
    ).toBe(false);
    expect(
      modelEvaluationJobMetadataSchema.safeParse({
        ...metadata,
        evaluationComparisonGroupId: '88888888-8888-4888-8888-888888888888',
        evaluationComparisonIndex: 1,
      }).success,
    ).toBe(true);
  });
});
