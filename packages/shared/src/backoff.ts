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
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(message);
    this.name = 'RetryError';
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
    signal?: AbortSignal;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<T> {
  const config = { ...DEFAULT_BACKOFF, ...options };
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? (() => true);
  let lastError: unknown;

  for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw new Error('operacion cancelada');
    try {
      return await operation({ attempt, signal: options.signal });
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt === config.maxAttempts - 1) break;
      const delayMs = computeBackoffDelay(attempt, config, options.random);
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs, options.signal);
    }
  }

  throw new RetryError(
    `la operacion fallo tras ${config.maxAttempts} intentos`,
    config.maxAttempts,
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
