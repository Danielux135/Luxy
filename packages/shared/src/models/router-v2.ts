// router determinista sobre el catalogo de modelos.
//
// el router v1 (router.ts) decide entre cinco proveedores con listas de
// preferencia escritas a mano. Eso no escala a un catalogo configurable, asi que
// v2 puntua sobre las capacidades DECLARADAS de cada modelo.
//
// v1 no se toca: sigue siendo el que resuelve /auto cuando no hay catalogo, y
// sus pruebas siguen valiendo.
//
// REGLA: este router nunca elige un modelo que no sea utilizable. "Declarado" no
// basta; hace falta conexion activa, clave guardada y que la conexion lo sirva.
import type { ModelCapability, ResolvedModel } from './types.js';
import type { ModelRegistry } from './registry.js';
// misma normalizacion que el router v1: no hay dos definiciones de "acentos"
import { normalize } from '../router.js';

export interface ModelRouteInput {
  prompt: string;
  /** modelo pedido explicitamente, por alias de Telegram */
  explicitAlias?: string | null;
  /** el trabajo va a modificar archivos */
  needsEditing?: boolean;
}

export interface ModelRouteDecision {
  model: ResolvedModel | null;
  reason: string;
  /** otros candidatos que se consideraron, del mejor al peor */
  alternatives: { id: string; score: number }[];
  /** modelo pedido que no se pudo usar, con su motivo */
  substituted: { requested: string; because: string } | null;
}

/**
 * señales de la tarea.
 *
 * se comparan con limites de palabra, no con includes: el v1 hacia substring y
 * "log" casaba dentro de "logica".
 */
const SIGNALS: { capability: ModelCapability; weight: number; hints: string[] }[] = [
  {
    capability: 'coding',
    weight: 3,
    hints: ['codigo', 'refactor', 'refactoriza', 'implementa', 'funcion', 'clase', 'modulo', 'bug', 'arregla', 'corrige', 'compila', 'tests', 'test', 'lint'],
  },
  {
    capability: 'reasoning',
    weight: 2,
    hints: ['arquitectura', 'diseña', 'disena', 'analiza', 'investiga', 'compara', 'decide', 'evalua', 'por que'],
  },
  {
    capability: 'log_analysis',
    weight: 2,
    hints: ['log', 'logs', 'traza', 'stacktrace', 'excepcion', 'diagnostica', 'error'],
  },
  {
    capability: 'documentation',
    weight: 2,
    hints: ['documenta', 'documentacion', 'readme', 'guia', 'manual', 'explica', 'resume', 'changelog', 'traduce'],
  },
  {
    capability: 'long_context',
    weight: 2,
    hints: ['todo el proyecto', 'varios archivos', 'repositorio completo', 'auditoria'],
  },
  {
    capability: 'fast',
    weight: 1,
    hints: ['rapido', 'rapida', 'deprisa', 'sencillo', 'simple', 'trivial'],
  },
];

function countHints(text: string, hints: string[]): number {
  let total = 0;
  for (const hint of hints) {
    // limite de palabra en ambos extremos: evita el falso positivo de substring
    const pattern = new RegExp(`(^|\\W)${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`);
    if (pattern.test(text)) total += 1;
  }
  return total;
}

export function routeModel(registry: ModelRegistry, input: ModelRouteInput): ModelRouteDecision {
  const needsEditing = input.needsEditing ?? false;

  // 1. peticion explicita: se respeta salvo que no se pueda usar
  if (input.explicitAlias != null && input.explicitAlias.length > 0) {
    const requested = registry.resolveAlias(input.explicitAlias);
    if (requested !== null) {
      const resolved = registry.resolve(requested.id);
      if (resolved !== null && resolved.usable) {
        return {
          model: resolved,
          reason: 'lo pediste explicitamente',
          alternatives: [],
          substituted: null,
        };
      }
      // se sustituye, pero SIEMPRE se explica por que
      const fallback = routeModel(registry, { ...input, explicitAlias: null });
      return {
        ...fallback,
        substituted: {
          requested: requested.displayName,
          because: resolved?.unavailableReason ?? 'no esta disponible en esta maquina',
        },
      };
    }
  }

  // 2. candidatos: solo utilizables, y si hay que editar solo los que pueden
  const candidates = needsEditing ? registry.listAgentic() : registry.listUsable().filter(esTexto);

  if (candidates.length === 0) {
    return {
      model: null,
      reason: needsEditing
        ? 'no hay ningun modelo disponible que pueda editar archivos'
        : 'no hay ningun modelo de texto disponible',
      alternatives: [],
      substituted: null,
    };
  }

  const text = normalize(input.prompt);
  const isLong = input.prompt.length > 2500;

  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreModel(candidate, text, isLong, needsEditing) }))
    // desempate estable por id: el mismo prompt da siempre el mismo modelo
    .sort((a, b) => b.score - a.score || a.candidate.definition.id.localeCompare(b.candidate.definition.id));

  const best = scored[0]!;
  return {
    model: best.candidate,
    reason: explain(best.candidate, text, needsEditing),
    alternatives: scored.slice(1, 4).map((entry) => ({
      id: entry.candidate.definition.id,
      score: entry.score,
    })),
    substituted: null,
  };
}

function esTexto(model: ResolvedModel): boolean {
  return model.definition.category === 'text';
}

function scoreModel(model: ResolvedModel, text: string, isLong: boolean, needsEditing: boolean): number {
  const capabilities = model.definition.capabilities;
  let score = 0;

  for (const signal of SIGNALS) {
    const hits = countHints(text, signal.hints);
    if (hits > 0 && capabilities.includes(signal.capability)) {
      score += signal.weight * Math.min(hits, 3);
    }
  }

  // un texto largo pide contexto largo aunque no lo diga
  if (isLong && capabilities.includes('long_context')) score += 3;
  // editar exige herramientas de verdad
  if (needsEditing && capabilities.includes('agent_tools')) score += 2;
  // ante igualdad, el predeterminado de su familia
  if (model.definition.defaultForFamily) score += 1;

  return score;
}

function explain(model: ResolvedModel, text: string, needsEditing: boolean): string {
  const matched = SIGNALS.filter(
    (signal) =>
      countHints(text, signal.hints) > 0 && model.definition.capabilities.includes(signal.capability),
  ).map((signal) => signal.capability);

  if (matched.length > 0) {
    return `encaja con la tarea (${matched.join(', ')})`;
  }
  if (needsEditing) return 'puede editar archivos y esta disponible';
  return model.definition.defaultForFamily
    ? 'predeterminado de su familia y disponible'
    : 'es el mejor disponible para esta tarea';
}
