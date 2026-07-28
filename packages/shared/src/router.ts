// router determinista del modo automatico.
// no consulta ningun modelo para decidir: es puro texto y reglas.
import type { ProviderId } from './types.js';

export interface RouterInput {
  prompt: string;
  /** proveedores que la maquina elegida puede ejecutar ahora mismo */
  availableProviders: ProviderId[];
  /** proveedor pedido explicitamente por el usuario, si lo hubo */
  explicitProvider?: ProviderId | null;
}

export interface RouterDecision {
  provider: ProviderId;
  reason: string;
  /** proveedores que se descartaron por no estar instalados */
  unavailable: ProviderId[];
}

export class NoProviderAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoProviderAvailableError';
  }
}

// palabras que indican un cambio de codigo amplio en varios archivos
const COMPLEX_CODE_HINTS = [
  'refactor',
  'refactoriza',
  'arquitectura',
  'migra',
  'reescribe',
  'varios archivos',
  'modulo',
  'integra',
  'implementa la funcionalidad',
  'rediseña',
  'redisena',
];

// palabras que indican implementacion concreta y verificable con pruebas
const PRECISE_IMPL_HINTS = [
  'corrige',
  'arregla',
  'bug',
  'error',
  'falla',
  'test',
  'prueba',
  'pruebas',
  'typecheck',
  'lint',
  'compila',
  'excepcion',
];

// palabras que indican analisis de textos o logs largos
const LOG_ANALYSIS_HINTS = [
  'log',
  'logs',
  'traza',
  'stacktrace',
  'analiza',
  'analizar',
  'diagnostica',
  'investiga',
  'por que',
];

// palabras que indican redaccion de documentacion
const DOCS_HINTS = [
  'documenta',
  'documentacion',
  'readme',
  'guia',
  'manual',
  'explica',
  'resume',
  'traduce',
  'changelog',
];

/** cuenta cuantas pistas de una lista aparecen en el texto normalizado */
function countHints(text: string, hints: string[]): number {
  return hints.reduce((total, hint) => (text.includes(hint) ? total + 1 : total), 0);
}

/** normaliza el prompt para comparar sin tildes ni mayusculas */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
}

/** devuelve el primer proveedor disponible de una lista de preferencias */
function firstAvailable(
  preferences: ProviderId[],
  available: ProviderId[],
): ProviderId | undefined {
  return preferences.find((provider) => available.includes(provider));
}

/**
 * elige proveedor de forma determinista y barata.
 * si el usuario pidio uno explicitamente, se respeta siempre que este instalado.
 */
export function routeProvider(input: RouterInput): RouterDecision {
  const available = input.availableProviders;
  if (available.length === 0) {
    throw new NoProviderAvailableError(
      'la maquina seleccionada no tiene ningun proveedor disponible',
    );
  }

  // regla prioritaria: una peticion explicita se respeta siempre
  if (input.explicitProvider) {
    if (available.includes(input.explicitProvider)) {
      return {
        provider: input.explicitProvider,
        reason: 'lo pediste explicitamente',
        unavailable: [],
      };
    }
    // la herramienta pedida no esta instalada: se elige otra y se explica
    const fallback = routeProvider({ ...input, explicitProvider: null });
    return {
      provider: fallback.provider,
      reason: `"${input.explicitProvider}" no esta disponible en esta maquina; ${fallback.reason}`,
      unavailable: [input.explicitProvider, ...fallback.unavailable],
    };
  }

  const text = normalize(input.prompt);
  const scores = {
    complex: countHints(text, COMPLEX_CODE_HINTS),
    precise: countHints(text, PRECISE_IMPL_HINTS),
    logs: countHints(text, LOG_ANALYSIS_HINTS),
    docs: countHints(text, DOCS_HINTS),
  };

  const isLongText = input.prompt.length > 2500;

  // documentacion extensa: modelos http baratos, y claude solo como ultimo recurso
  if (scores.docs > 0 && scores.docs >= scores.complex && scores.docs >= scores.precise) {
    const provider = firstAvailable(['qwen', 'glm', 'deepseek', 'claude', 'codex'], available);
    if (provider) {
      return {
        provider,
        reason: 'la tarea es de redaccion o documentacion, no requiere editar codigo complejo',
        unavailable: [],
      };
    }
  }

  // analisis de logs largos: proveedores http, que son mas economicos
  if ((scores.logs > 0 && isLongText) || (scores.logs >= 2 && scores.complex === 0)) {
    const provider = firstAvailable(['deepseek', 'glm', 'qwen', 'claude', 'codex'], available);
    if (provider) {
      return {
        provider,
        reason: 'la tarea es de analisis o diagnostico sobre texto largo',
        unavailable: [],
      };
    }
  }

  // cambios complejos en varios archivos: claude
  if (scores.complex > 0 && scores.complex >= scores.precise) {
    const provider = firstAvailable(['claude', 'codex', 'deepseek', 'glm', 'qwen'], available);
    if (provider) {
      return {
        provider,
        reason: 'la tarea requiere modificar varios archivos y ejecutar pruebas locales',
        unavailable: [],
      };
    }
  }

  // correccion concreta y verificable: codex
  if (scores.precise > 0) {
    const provider = firstAvailable(['codex', 'claude', 'deepseek', 'glm', 'qwen'], available);
    if (provider) {
      return {
        provider,
        reason: 'la tarea es una correccion concreta que se puede verificar con pruebas',
        unavailable: [],
      };
    }
  }

  // por defecto: claude, que es el mas capaz para trabajo de codigo general
  const provider = firstAvailable(['claude', 'codex', 'deepseek', 'glm', 'qwen'], available)!;
  return {
    provider,
    reason: 'no hay señales claras en la peticion, se usa el proveedor general por defecto',
    unavailable: [],
  };
}

// -----------------------------------------------------------------------------
// interfaces preparadas para ampliaciones futuras.
// no estan implementadas todavia: solo fijan la forma del contrato.
// -----------------------------------------------------------------------------

/** estrategia de enrutado intercambiable (permite sustituir el router por otro) */
export interface RoutingStrategy {
  readonly id: string;
  decide(input: RouterInput): RouterDecision | Promise<RouterDecision>;
}

/** consejo de agentes: varios proveedores responden y se comparan las respuestas */
export interface CouncilStrategy {
  readonly id: string;
  members(input: RouterInput): ProviderId[];
  /** reduce varias respuestas a una sola (votacion, revision cruzada, etc.) */
  reduce(responses: Array<{ provider: ProviderId; text: string }>): {
    text: string;
    rationale: string;
  };
}

/** memoria por proyecto, para reutilizar contexto entre trabajos */
export interface ProjectMemory {
  read(projectAlias: string): Promise<string | null>;
  write(projectAlias: string, content: string): Promise<void>;
}

// estrategia por defecto: el router determinista de arriba
export const defaultRoutingStrategy: RoutingStrategy = {
  id: 'deterministic-v1',
  decide: routeProvider,
};
