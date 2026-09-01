// limitador de peticiones por ventana deslizante.
//
// LIMITACION CONOCIDA: el estado vive en memoria del isolate. cloudflare puede
// tener varios isolates a la vez, asi que el limite es aproximado y por isolate.
// es suficiente como freno contra bucles y abuso accidental. si en el futuro se
// necesita un limite exacto y global, hay que pasarlo a un durable object.

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

export class SlidingWindowRateLimiter {
  // clave -> marcas temporales de las peticiones dentro de la ventana
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly maxKeys = 1000,
  ) {}

  check(key: string, now: number = Date.now()): RateLimitResult {
    const windowStart = now - this.windowMs;
    const previous = this.hits.get(key) ?? [];
    // se descartan las marcas que ya salieron de la ventana
    const current = previous.filter((timestamp) => timestamp > windowStart);

    if (current.length >= this.limit) {
      this.hits.set(key, current);
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: (current[0] ?? now) + this.windowMs,
      };
    }

    current.push(now);
    this.hits.set(key, current);
    this.evictIfNeeded(now);

    return {
      allowed: true,
      remaining: Math.max(0, this.limit - current.length),
      resetAtMs: now + this.windowMs,
    };
  }

  /** evita que el mapa crezca sin limite si aparecen muchas claves distintas */
  private evictIfNeeded(now: number): void {
    if (this.hits.size <= this.maxKeys) return;
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      if (timestamps.every((timestamp) => timestamp <= windowStart)) this.hits.delete(key);
      if (this.hits.size <= this.maxKeys) return;
    }
    // si aun asi sigue lleno, se vacia entero: es un limitador aproximado
    if (this.hits.size > this.maxKeys) this.hits.clear();
  }

  reset(): void {
    this.hits.clear();
  }
}

// limitadores compartidos por isolate
let webhookLimiter: SlidingWindowRateLimiter | null = null;
let machineLimiter: SlidingWindowRateLimiter | null = null;

export function getWebhookLimiter(limitPerMinute: number): SlidingWindowRateLimiter {
  webhookLimiter ??= new SlidingWindowRateLimiter(limitPerMinute, 60_000);
  return webhookLimiter;
}

export function getMachineLimiter(): SlidingWindowRateLimiter {
  // el agente consulta cada 2 segundos: 120 por minuto deja margen sobrado
  machineLimiter ??= new SlidingWindowRateLimiter(240, 60_000);
  return machineLimiter;
}

let vaultAuthLimiter: SlidingWindowRateLimiter | null = null;

/**
 * limita los intentos de registro y login de cuenta.
 *
 * Es el unico endpoint publico y sin sesion, asi que es la superficie de fuerza
 * bruta. 10 por minuto y correo deja usar el login normal y hace inviable
 * probar contraseñas en masa. Aproximado por isolate, como el resto (ver
 * riesgo conocido 1): suficiente contra un bucle, no contra un ataque
 * distribuido, para el que la defensa real es Argon2id.
 */
export function getVaultAuthLimiter(): SlidingWindowRateLimiter {
  vaultAuthLimiter ??= new SlidingWindowRateLimiter(10, 60_000);
  return vaultAuthLimiter;
}

/** solo para tests: reinicia los limitadores compartidos */
export function resetLimiters(): void {
  webhookLimiter?.reset();
  machineLimiter?.reset();
  vaultAuthLimiter?.reset();
  webhookLimiter = null;
  machineLimiter = null;
  vaultAuthLimiter = null;
}
