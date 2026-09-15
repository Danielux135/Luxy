// control de presupuesto diario de los proveedores http
import { z } from 'zod';
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

/**
 * el estado tal y como se lee de disco.
 *
 * existe porque un presupuesto que se persiste deja de ser un dato interno: lo
 * que vuelve de un archivo es entrada externa, y un archivo a medio escribir o
 * editado a mano no puede colarse como «llevo gastado 0» ni tumbar el arranque.
 * Se descarta la entrada que no encaje en vez de descartar el archivo entero.
 */
export const budgetEntrySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dia no valido'),
  spent: z.number().min(0).finite(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  calls: z.number().int().min(0),
});

export const budgetStateSchema = z.record(z.string().min(1).max(64), budgetEntrySchema);

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
 * comprueba si un proveedor puede hacer una llamada mas hoy POR NUMERO.
 *
 * POR QUE EXISTE APARTE DE `checkBudget`: el presupuesto de arriba multiplica
 * tokens por precio, y hay pasarelas con tarifa PLANA POR LLAMADA (la de Daniel
 * cobra ~6,935 ¥ por peticion, diga 100 palabras o 10.000). Contra esa tarifa
 * `checkBudget` es ciego por construccion: una llamada que muere en silencio
 * devuelve cero tokens, suma cero al gasto y cuesta exactamente igual que una
 * que contesta. Entre el 4 y el 14 de septiembre eso fueron 13 llamadas de mas
 * —un 18% del gasto— sin que ningun limite llegara a mirarlas.
 *
 * un limite de 0 significa "sin limite configurado" y siempre permite, igual
 * que el presupuesto en dinero.
 */
export function checkCallBudget(
  state: BudgetState,
  providerId: string,
  dailyCallLimit: number,
  now: Date = new Date(),
): BudgetCheck {
  const day = utcDay(now);
  const entry = state[providerId];
  const calls = entry && entry.day === day ? entry.calls : 0;

  if (dailyCallLimit <= 0) {
    return { allowed: true, spent: calls, limit: dailyCallLimit, reason: null };
  }
  if (calls >= dailyCallLimit) {
    return {
      allowed: false,
      spent: calls,
      limit: dailyCallLimit,
      reason:
        `limite diario de llamadas alcanzado para ${providerId}: ${calls} de ${dailyCallLimit}. ` +
        'Cada llamada de esta pasarela se cobra entera, conteste o no. ' +
        'Sube el limite en la conexion si quieres seguir hoy.',
    };
  }
  return { allowed: true, spent: calls, limit: dailyCallLimit, reason: null };
}

/**
 * suma el consumo de una llamada al estado. si cambia el dia utc, reinicia.
 * devuelve un estado nuevo: no muta el recibido.
 *
 * SE LLAMA UNA VEZ POR LLAMADA, no una por turno, y la diferencia es el arreglo
 * entero: un turno con dos reintentos paga tres peticiones, y hasta el
 * 2026-09-15 solo se apuntaba la que salia bien. Luxy creia gastar la tercera
 * parte de lo que gastaba, y `calls` contaba turnos disfrazados de llamadas.
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
