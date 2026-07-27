// control de presupuesto diario de los proveedores http
import type { ProviderUsage } from './types.js';

export interface BudgetEntry {
  // dia en formato YYYY-MM-DD segun utc, para que el corte sea determinista
  day: string;
  spent: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export type BudgetState = Record<string, BudgetEntry>;

/** devuelve el dia utc de una fecha, que es la unidad de corte del presupuesto */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export interface BudgetCheck {
  allowed: boolean;
  spent: number;
  limit: number;
  reason: string | null;
}

/**
 * comprueba si un proveedor puede hacer una llamada mas hoy.
 * un limite de 0 significa "sin limite configurado" y siempre permite.
 */
export function checkBudget(
  state: BudgetState,
  providerId: string,
  dailyBudget: number,
  now: Date = new Date(),
): BudgetCheck {
  const day = utcDay(now);
  const entry = state[providerId];
  const spent = entry && entry.day === day ? entry.spent : 0;

  if (dailyBudget <= 0) {
    return { allowed: true, spent, limit: dailyBudget, reason: null };
  }
  if (spent >= dailyBudget) {
    return {
      allowed: false,
      spent,
      limit: dailyBudget,
      reason: `presupuesto diario agotado para ${providerId}: ${spent.toFixed(4)} de ${dailyBudget}`,
    };
  }
  return { allowed: true, spent, limit: dailyBudget, reason: null };
}

/**
 * suma el consumo de una llamada al estado. si cambia el dia utc, reinicia.
 * devuelve un estado nuevo: no muta el recibido.
 */
export function recordUsage(
  state: BudgetState,
  usage: ProviderUsage,
  now: Date = new Date(),
): BudgetState {
  const day = utcDay(now);
  const previous = state[usage.provider];
  const base: BudgetEntry =
    previous && previous.day === day
      ? previous
      : { day, spent: 0, inputTokens: 0, outputTokens: 0, calls: 0 };

  return {
    ...state,
    [usage.provider]: {
      day,
      spent: base.spent + usage.estimatedCost,
      inputTokens: base.inputTokens + usage.inputTokens,
      outputTokens: base.outputTokens + usage.outputTokens,
      calls: base.calls + 1,
    },
  };
}

/**
 * estima el coste de una llamada. los precios reales cambian y dependen del
 * proveedor, asi que se configuran fuera; si no hay precio, el coste es 0 y el
 * presupuesto se controla por numero de llamadas mediante `dailyBudget`.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  pricePerMillionInput = 0,
  pricePerMillionOutput = 0,
): number {
  const cost =
    (inputTokens / 1_000_000) * pricePerMillionInput +
    (outputTokens / 1_000_000) * pricePerMillionOutput;
  // se redondea a 6 decimales para que el estado persistido sea estable
  return Math.round(cost * 1e6) / 1e6;
}
