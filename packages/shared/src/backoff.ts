// reintentos con backoff exponencial y jitter, usados en toda la red saliente

export interface BackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  // factor de jitter entre 0 y 1: 0 desactiva la aleatoriedad (util en tests)
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  maxAttempts: 8,
  jitter: 0.3,
};

/**
 * calcula el retardo del intento indicado (empezando en 0).
 * el jitter evita que varias maquinas reintenten a la vez tras un corte.
 */
export function computeBackoffDelay(
  attempt: number,
  options: Partial<BackoffOptions> = {},
  random: () => number = Math.random,
): number {
  const { baseDelayMs, maxDelayMs, jitter } = { ...DEFAULT_BACKOFF, ...options };
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt));
  if (jitter <= 0) return Math.round(exponential);
  // jitter simetrico alrededor del valor exponencial
  const spread = exponential * jitter;
  const delta = (random() * 2 - 1) * spread;
  return Math.max(0, Math.round(exponential + delta));
}

export class RetryError extends Error {
  /**
   * codigo HTTP del ultimo fallo, si lo habia.
   *
   * sin esto, envolver el error perdia el `status` y quien lo recibia ya no
   * podia distinguir un 429 de un 401: todos acababan como "fallo generico" y
   * al usuario le llegaba el JSON crudo del proveedor en vez de que hacer.
   */
  readonly status?: number;

  constructor(
    message: string,
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(message);
    this.name = 'RetryError';
    const status = (lastError as { status?: unknown } | null)?.status;
    if (typeof status === 'number') this.status = status;
  }
}

export interface RetryContext {
  attempt: number;
  signal?: AbortSignal;
}

/**
 * ejecuta una operacion reintentando con backoff.
 * `shouldRetry` permite no reintentar errores permanentes (por ejemplo un 401).
 */
export async function retryWithBackoff<T>(
  operation: (context: RetryContext) => Promise<T>,
  options: Partial<BackoffOptions> & {
    shouldRetry?: (error: unknown) => boolean;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
    /**
     * espera que pide el propio error, por encima del backoff calculado.
     *
     * un 429 suele traer `Retry-After`: obedecerlo acierta mucho mas que
     * duplicar un retardo a ciegas. Devolver null usa el backoff normal.
     */
    delayForError?: (error: unknown, attempt: number, defaultDelayMs: number) => number | null;
    signal?: AbortSignal;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<T> {
  const config = { ...DEFAULT_BACKOFF, ...options };
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? (() => true);
  let lastError: unknown;
  let attempts = 0;

  for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw new Error('operacion cancelada');
    attempts = attempt + 1;
    try {
      return await operation({ attempt, signal: options.signal });
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt === config.maxAttempts - 1) break;
      const calculado = computeBackoffDelay(attempt, config, options.random);
      const delayMs = options.delayForError?.(error, attempt, calculado) ?? calculado;
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs, options.signal);
    }
  }

  // el motivo real del ultimo intento va en el mensaje: sin el, "fallo tras 3
  // intentos" obliga a mirar los logs para saber que dijo la API.
  //
  // y el numero es el de intentos REALES. Decir "tras 3 intentos" cuando un 400
  // se rechazo a la primera manda a investigar un problema de reintentos que no
  // existe, y esconde el unico dato util: la API dijo que no.
  const detalle =
    lastError instanceof Error && lastError.message.length > 0
      ? `: ${lastError.message.slice(0, 300)}`
      : '';
  throw new RetryError(
    `la operacion fallo tras ${attempts} ${attempts === 1 ? 'intento' : 'intentos'}${detalle}`,
    attempts,
    lastError,
  );
}

/** espera cancelable basada en promesas */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('operacion cancelada'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('operacion cancelada'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
