import { describe, expect, it } from 'vitest';
import {
  EXECUTABLE_MODEL_EVALUATIONS,
  MODEL_EVALUATIONS,
  MODEL_EVALUATION_CATEGORIES,
  modelDeclaresEvaluationCapabilities,
  modelEvaluationDefinitionSchema,
} from './evaluations.js';
import { modelDefinitionSchema } from './types.js';

describe('catalogo del Laboratorio', () => {
  it('cubre una vez cada area inicial de F4.3', () => {
    expect(MODEL_EVALUATIONS.map((evaluation) => evaluation.category).sort()).toEqual(
      [...MODEL_EVALUATION_CATEGORIES].sort(),
    );
    expect(new Set(MODEL_EVALUATIONS.map((evaluation) => evaluation.id)).size).toBe(
      MODEL_EVALUATIONS.length,
    );
  });

  it('habilita solo las pruebas con validador automatico', () => {
    for (const evaluation of MODEL_EVALUATIONS) {
      expect(modelEvaluationDefinitionSchema.safeParse(evaluation).success).toBe(true);
      expect(evaluation.version).toBe(1);
      expect(evaluation.successCriteria.length).toBeGreaterThan(0);
      expect(evaluation.executionEnabled).toBe(evaluation.validationMode === 'automatic');
    }
    expect(EXECUTABLE_MODEL_EVALUATIONS).toHaveLength(4);
    expect(
      EXECUTABLE_MODEL_EVALUATIONS.every(
        (evaluation) => evaluation.executionEnabled && evaluation.validationMode === 'automatic',
      ),
    ).toBe(true);
  });

  it('las pruebas sensibles declaran sus requisitos y fixtures', () => {
    const context = MODEL_EVALUATIONS.find((item) => item.category === 'long_context');
    const tools = MODEL_EVALUATIONS.find((item) => item.category === 'tool_calling');
    const json = MODEL_EVALUATIONS.find((item) => item.category === 'json');

    expect(context).toMatchObject({
      requiredCapabilities: ['text', 'long_context'],
      fixtureId: 'numbered-context-anchors-v1',
      scoring: 'retrieval',
    });
    expect(tools).toMatchObject({
      requiredCapabilities: ['text', 'agent_tools'],
      fixtureId: 'readonly-project-search-v1',
      scoring: 'tool_trace',
    });
    expect(json).toMatchObject({ fixtureId: 'contact-json-schema-v1', scoring: 'schema' });
  });

  it('filtra solo por capacidades declaradas sin afirmar que esten verificadas', () => {
    const model = modelDefinitionSchema.parse({
      id: 'modelo-prueba',
      apiModel: 'modelo-prueba',
      displayName: 'Modelo prueba',
      family: 'deepseek',
      connectionId: 'test',
      category: 'text',
      capabilities: ['text', 'coding'],
    });
    const coding = MODEL_EVALUATIONS.find((item) => item.category === 'coding')!;
    const tools = MODEL_EVALUATIONS.find((item) => item.category === 'tool_calling')!;

    expect(modelDeclaresEvaluationCapabilities(model, coding)).toBe(true);
    expect(modelDeclaresEvaluationCapabilities(model, tools)).toBe(false);
    expect(modelDeclaresEvaluationCapabilities({ ...model, enabled: false }, coding)).toBe(false);
  });
});
