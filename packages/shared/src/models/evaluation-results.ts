// Resultado trazable de una evaluacion ya terminada.
//
// Esta logica no ejecuta modelos ni codigo generado. Solo aplica los
// validadores puros existentes a una salida que el gateway ya iba a guardar.
import { z } from 'zod';
import { responseOutcomeSchema } from '../schemas.js';
import { validateModelEvaluationOutput } from './evaluation-fixtures.js';
import {
  MODEL_EVALUATIONS,
  MODEL_EVALUATION_SCORING,
  MODEL_EVALUATION_VALIDATION_MODES,
} from './evaluations.js';

export const modelEvaluationJobMetadataSchema = z.object({
  studioMode: z.literal('evaluation'),
  evaluationId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  evaluationVersion: z.number().int().min(1),
  evaluationPromptVersion: z.literal(1),
  evaluationFixtureId: z.string().min(1).max(80).nullable(),
  evaluationValidationMode: z.enum(MODEL_EVALUATION_VALIDATION_MODES),
  evaluationScoring: z.enum(MODEL_EVALUATION_SCORING),
  evaluationConfirmed: z.literal(true),
});

export const storedModelEvaluationResultSchema = z.object({
  evaluationId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  evaluationVersion: z.number().int().min(1),
  promptVersion: z.literal(1),
  fixtureId: z.string().min(1).max(80).nullable(),
  validationMode: z.enum(MODEL_EVALUATION_VALIDATION_MODES),
  scoring: z.enum(MODEL_EVALUATION_SCORING),
  model: z.string().min(1).max(128),
  status: z.enum(['passed', 'failed', 'not_scored']),
  checks: z.array(z.object({ label: z.string().min(1).max(240), passed: z.boolean() })).max(20),
  reason: z.string().min(1).max(500).nullable(),
  responseOutcome: responseOutcomeSchema.nullable(),
  outputChars: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  inputTokens: z.number().int().min(0).nullable(),
  outputTokens: z.number().int().min(0).nullable(),
});

export type StoredModelEvaluationResult = z.infer<typeof storedModelEvaluationResultSchema>;

export interface ModelEvaluationCompletionInput {
  metadata: Record<string, unknown>;
  output: string;
  responseOutcome: z.infer<typeof responseOutcomeSchema> | null;
  model: string | null;
  durationMs: number;
  usage?: { inputTokens: number; outputTokens: number };
}

export function evaluateModelEvaluationCompletion(
  input: ModelEvaluationCompletionInput,
): StoredModelEvaluationResult | null {
  const parsed = modelEvaluationJobMetadataSchema.safeParse(input.metadata);
  if (!parsed.success) return null;
  const metadata = parsed.data;
  const definition = MODEL_EVALUATIONS.find((item) => item.id === metadata.evaluationId);
  const base = {
    evaluationId: metadata.evaluationId,
    evaluationVersion: metadata.evaluationVersion,
    promptVersion: metadata.evaluationPromptVersion,
    fixtureId: metadata.evaluationFixtureId,
    validationMode: metadata.evaluationValidationMode,
    scoring: metadata.evaluationScoring,
    model: input.model ?? 'modelo efectivo desconocido',
    responseOutcome: input.responseOutcome,
    outputChars: input.output.length,
    durationMs: input.durationMs,
    inputTokens: input.usage?.inputTokens ?? null,
    outputTokens: input.usage?.outputTokens ?? null,
  } as const;

  if (input.model === null) {
    return storedModelEvaluationResultSchema.parse({
      ...base,
      status: 'not_scored',
      checks: [],
      reason: 'no se conoce el modelo efectivo',
    });
  }
  if (
    definition === undefined ||
    definition.version !== metadata.evaluationVersion ||
    definition.fixtureId !== metadata.evaluationFixtureId ||
    definition.validationMode !== metadata.evaluationValidationMode ||
    definition.scoring !== metadata.evaluationScoring
  ) {
    return storedModelEvaluationResultSchema.parse({
      ...base,
      status: 'not_scored',
      checks: [],
      reason: 'el snapshot no coincide con el catalogo actual',
    });
  }
  if (input.responseOutcome !== 'completed') {
    const reasons = {
      truncated: 'la respuesta alcanzo su limite de salida',
      interrupted: 'la respuesta quedo interrumpida',
      timed_out: 'la evaluacion agoto su tiempo disponible',
      cancelled: 'la evaluacion fue cancelada por la persona',
      failed: 'el trabajo fallo antes de producir una respuesta valida',
    } as const;
    return storedModelEvaluationResultSchema.parse({
      ...base,
      status: 'not_scored',
      checks: [],
      reason:
        input.responseOutcome === null
          ? 'el trabajo no declaro como termino la respuesta'
          : reasons[input.responseOutcome],
    });
  }

  const validation = validateModelEvaluationOutput(metadata.evaluationId, input.output);
  return storedModelEvaluationResultSchema.parse({
    ...base,
    status:
      validation.status === 'passed'
        ? 'passed'
        : validation.status === 'failed'
          ? 'failed'
          : 'not_scored',
    checks: validation.checks,
    reason: validation.reason,
  });
}
