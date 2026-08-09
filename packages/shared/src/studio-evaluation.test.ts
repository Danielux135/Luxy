import { describe, expect, it } from 'vitest';
import { studioJobCreateRequestSchema } from './schemas.js';

const execution = {
  evaluationId: 'speed-exact-v1',
  evaluationVersion: 1,
  promptVersion: 1,
  fixtureId: null,
  validationMode: 'automatic',
  scoring: 'timing',
  confirmed: true,
} as const;

const base = {
  targetMachineId: '11111111-1111-4111-8111-111111111111',
  provider: 'codex',
  model: 'gpt-evaluado',
  projectAlias: 'demo',
  prompt: '[LUXY_EVALUATION]\nid=speed-exact-v1\nversion=1',
  priority: 0,
  mode: 'evaluation',
} as const;

describe('studioJobCreateRequestSchema para evaluaciones', () => {
  it('acepta solo una definicion versionada, confirmada y con modelo exacto', () => {
    expect(studioJobCreateRequestSchema.safeParse({ ...base, evaluation: execution }).success).toBe(
      true,
    );
  });

  it('rechaza una preparacion que no fue confirmada', () => {
    expect(
      studioJobCreateRequestSchema.safeParse({
        ...base,
        evaluation: { ...execution, confirmed: false },
      }).success,
    ).toBe(false);
  });

  it('rechaza modelo implicito y definicion ausente', () => {
    const result = studioJobCreateRequestSchema.safeParse({ ...base, model: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(['model', 'evaluation']);
    }
  });

  it('no permite adjuntar una evaluacion a una tarea normal', () => {
    expect(
      studioJobCreateRequestSchema.safeParse({
        ...base,
        mode: 'task',
        evaluation: execution,
      }).success,
    ).toBe(false);
  });

  it('exige grupo e indice juntos para una comparacion', () => {
    expect(
      studioJobCreateRequestSchema.safeParse({
        ...base,
        evaluation: {
          ...execution,
          comparisonGroupId: '22222222-2222-4222-8222-222222222222',
        },
      }).success,
    ).toBe(false);
    expect(
      studioJobCreateRequestSchema.safeParse({
        ...base,
        evaluation: {
          ...execution,
          comparisonGroupId: '22222222-2222-4222-8222-222222222222',
          comparisonIndex: 0,
        },
      }).success,
    ).toBe(true);
  });
});
