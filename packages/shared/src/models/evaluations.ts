// catalogo reproducible de pruebas del Laboratorio.
//
// definir una prueba no autoriza a ejecutarla: el runner y su confirmacion
// explicita pertenecen a pasos posteriores de F4.3.
import { z } from 'zod';
import { MODEL_CAPABILITIES } from './types.js';
import type { ModelDefinition } from './types.js';

export const MODEL_EVALUATION_CATEGORIES = [
  'speed',
  'coding',
  'frontend',
  'spanish',
  'instructions',
  'json',
  'long_context',
  'tool_calling',
] as const;

export const MODEL_EVALUATION_SCORING = [
  'timing',
  'tests',
  'rubric',
  'exact',
  'schema',
  'retrieval',
  'tool_trace',
] as const;

export const MODEL_EVALUATION_VALIDATION_MODES = [
  'automatic',
  'manual',
  'sandbox',
  'trace',
] as const;

export const modelEvaluationDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.number().int().min(1),
  category: z.enum(MODEL_EVALUATION_CATEGORIES),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(240),
  prompt: z.string().min(1).max(8_000),
  scoring: z.enum(MODEL_EVALUATION_SCORING),
  validationMode: z.enum(MODEL_EVALUATION_VALIDATION_MODES),
  requiredCapabilities: z.array(z.enum(MODEL_CAPABILITIES)).max(4),
  fixtureId: z.string().min(1).max(80).nullable(),
  successCriteria: z.array(z.string().min(1).max(240)).min(1).max(8),
  executionEnabled: z.boolean(),
});

export type ModelEvaluationDefinition = z.infer<typeof modelEvaluationDefinitionSchema>;

/**
 * Snapshot minimo que acompana una ejecucion confirmada.
 *
 * Se guarda junto al trabajo para que el historial no dependa de que el
 * catalogo actual conserve para siempre la misma version. `confirmed: true`
 * es deliberadamente literal: preparar o previsualizar una prueba no basta.
 */
export const modelEvaluationExecutionSchema = z.object({
  evaluationId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  evaluationVersion: z.number().int().min(1),
  promptVersion: z.literal(1),
  fixtureId: z.string().min(1).max(80).nullable(),
  validationMode: z.enum(MODEL_EVALUATION_VALIDATION_MODES),
  scoring: z.enum(MODEL_EVALUATION_SCORING),
  confirmed: z.literal(true),
});

export type ModelEvaluationExecution = z.infer<typeof modelEvaluationExecutionSchema>;

/** compatibilidad declarada en el catalogo; no equivale a evidencia real */
export function modelDeclaresEvaluationCapabilities(
  model: ModelDefinition,
  evaluation: ModelEvaluationDefinition,
): boolean {
  return (
    model.enabled &&
    evaluation.requiredCapabilities.every((capability) => model.capabilities.includes(capability))
  );
}

const DEFINITIONS = [
  {
    id: 'speed-exact-v1',
    version: 1,
    category: 'speed',
    title: 'Rapidez de respuesta corta',
    summary: 'Mide primer texto y duracion total con una salida exacta y minima.',
    prompt: 'Responde unicamente con la palabra LISTO, en mayusculas y sin puntuacion.',
    scoring: 'timing',
    validationMode: 'automatic',
    requiredCapabilities: ['text'],
    fixtureId: null,
    successCriteria: ['Final completed.', 'Texto visible exactamente igual a LISTO.'],
    executionEnabled: true,
  },
  {
    id: 'coding-pure-function-v1',
    version: 1,
    category: 'coding',
    title: 'Codigo TypeScript verificable',
    summary: 'Evalua una correccion pequena mediante tests deterministas sin red.',
    prompt:
      'Corrige la funcion TypeScript de la fixture para que agrupe enteros consecutivos. Devuelve solo el archivo completo, sin Markdown.',
    scoring: 'tests',
    validationMode: 'sandbox',
    requiredCapabilities: ['text', 'coding'],
    fixtureId: 'typescript-consecutive-ranges-v1',
    successCriteria: ['Compila con TypeScript estricto.', 'Pasan todos los tests de la fixture.'],
    executionEnabled: false,
  },
  {
    id: 'frontend-accessible-card-v1',
    version: 1,
    category: 'frontend',
    title: 'Frontend accesible autocontenido',
    summary: 'Compara estructura, accesibilidad y fidelidad a restricciones visuales.',
    prompt:
      'Crea una tarjeta de perfil en un unico HTML autocontenido. Sin dependencias externas, con foco visible, contraste legible y diseño responsive.',
    scoring: 'rubric',
    validationMode: 'manual',
    requiredCapabilities: ['text', 'coding'],
    fixtureId: 'frontend-profile-card-brief-v1',
    successCriteria: [
      'HTML valido y autocontenido.',
      'Navegable con teclado y foco visible.',
      'Sin recursos de red.',
    ],
    executionEnabled: false,
  },
  {
    id: 'spanish-editing-v1',
    version: 1,
    category: 'spanish',
    title: 'Edicion en español',
    summary: 'Evalua correccion, claridad y conservacion del significado original.',
    prompt:
      'Corrige el texto de la fixture en español de España. Conserva hechos y tono; no añadas informacion ni explicaciones.',
    scoring: 'rubric',
    validationMode: 'manual',
    requiredCapabilities: ['text'],
    fixtureId: 'spanish-editing-sample-v1',
    successCriteria: [
      'Sin errores ortograficos.',
      'No altera hechos.',
      'Mantiene el tono solicitado.',
    ],
    executionEnabled: false,
  },
  {
    id: 'instructions-constraints-v1',
    version: 1,
    category: 'instructions',
    title: 'Seguimiento de instrucciones',
    summary: 'Comprueba cinco restricciones simultaneas con una salida exacta.',
    prompt:
      'Escribe exactamente tres lineas. Cada linea debe tener cuatro palabras, empezar por A, B y C respectivamente, no usar numeros y terminar sin punto.',
    scoring: 'exact',
    validationMode: 'automatic',
    requiredCapabilities: ['text'],
    fixtureId: null,
    successCriteria: [
      'Tres lineas.',
      'Cuatro palabras por linea.',
      'Cumple iniciales y prohibiciones.',
    ],
    executionEnabled: true,
  },
  {
    id: 'json-schema-v1',
    version: 1,
    category: 'json',
    title: 'JSON sujeto a esquema',
    summary: 'Valida formato estricto, tipos y ausencia de propiedades inventadas.',
    prompt:
      'Extrae los datos de la fixture y devuelve unicamente JSON valido que cumpla el esquema indicado. No uses Markdown.',
    scoring: 'schema',
    validationMode: 'automatic',
    requiredCapabilities: ['text'],
    fixtureId: 'contact-json-schema-v1',
    successCriteria: [
      'JSON parseable.',
      'Valido contra el esquema.',
      'Sin propiedades adicionales.',
    ],
    executionEnabled: true,
  },
  {
    id: 'long-context-retrieval-v1',
    version: 1,
    category: 'long_context',
    title: 'Recuperacion en contexto largo',
    summary: 'Mide si recupera claves distribuidas sin resumir ni completar por intuicion.',
    prompt:
      'Lee la fixture completa y devuelve los codigos de ALFA, BRAVO, CHARLIE y DELTA, en ese orden y uno por linea. Si falta uno, escribe AUSENTE en su linea.',
    scoring: 'retrieval',
    validationMode: 'automatic',
    requiredCapabilities: ['text', 'long_context'],
    fixtureId: 'numbered-context-anchors-v1',
    successCriteria: [
      'Cuatro respuestas en orden.',
      'Coincidencia exacta con las anclas.',
      'No inventa ausentes.',
    ],
    executionEnabled: true,
  },
  {
    id: 'tool-calling-readonly-v1',
    version: 1,
    category: 'tool_calling',
    title: 'Tool calling de solo lectura',
    summary: 'Comprueba seleccion de herramienta, argumentos y respuesta final trazable.',
    prompt:
      'Busca en la fixture el valor solicitado usando solo herramientas de lectura y responde con el valor y el archivo de procedencia.',
    scoring: 'tool_trace',
    validationMode: 'trace',
    requiredCapabilities: ['text', 'agent_tools'],
    fixtureId: 'readonly-project-search-v1',
    successCriteria: [
      'No intenta escribir.',
      'Usa una herramienta permitida.',
      'Cita el archivo correcto.',
    ],
    executionEnabled: false,
  },
] as const;

export const MODEL_EVALUATIONS: readonly ModelEvaluationDefinition[] = z
  .array(modelEvaluationDefinitionSchema)
  .length(MODEL_EVALUATION_CATEGORIES.length)
  .parse(DEFINITIONS);
