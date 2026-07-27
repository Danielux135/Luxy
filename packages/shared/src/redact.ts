// redaccion de secretos: se aplica a TODO lo que sale por logs, telegram o eventos

const PLACEHOLDER = '[REDACTADO]';

// patrones genericos que identifican secretos por su forma
const PATTERNS: Array<{ name: string; regex: RegExp; replacer: (match: string) => string }> = [
  // token de bot de telegram: 1234567890:AA...
  {
    name: 'telegram-bot-token',
    regex: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g,
    replacer: () => PLACEHOLDER,
  },
  // json web token
  {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacer: () => PLACEHOLDER,
  },
  // cabecera de autorizacion tipo bearer
  {
    name: 'bearer',
    regex: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replacer: (match) => `${match.split(/\s+/)[0]} ${PLACEHOLDER}`,
  },
  // credenciales embebidas en una url: https://usuario:clave@host
  {
    name: 'url-credentials',
    regex: /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    replacer: (match) => {
      const parsed = /^([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@$/i.exec(match);
      return parsed ? `${parsed[1]}${parsed[2]}:${PLACEHOLDER}@` : PLACEHOLDER;
    },
  },
  // asignacion de una variable cuyo nombre termina en _KEY, _TOKEN o _SECRET
  {
    name: 'secret-assignment',
    regex: /\b([A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD))\s*[=:]\s*("?)([^\s"']{4,})\2/g,
    replacer: (match) => {
      const name = /^([A-Z0-9_]+)/.exec(match)?.[1] ?? 'SECRET';
      return `${name}=${PLACEHOLDER}`;
    },
  },
  // claves de api con prefijos habituales
  {
    name: 'api-key-prefix',
    regex: /\b(sk|rk|pk|ghp|gho|ghs|github_pat|xoxb|xoxp)[-_][A-Za-z0-9_-]{16,}\b/g,
    replacer: () => PLACEHOLDER,
  },
  // clave privada en formato pem
  {
    name: 'private-key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacer: () => PLACEHOLDER,
  },
];

/**
 * registro de valores literales conocidos (los secretos que el proceso ha cargado).
 * se redactan aunque aparezcan sin ningun contexto reconocible.
 */
export class SecretRegistry {
  private readonly values = new Set<string>();

  /** registra un secreto cargado. los valores muy cortos se ignoran a proposito */
  add(value: string | undefined | null): void {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    // por debajo de 8 caracteres redactar produciria falsos positivos masivos
    if (trimmed.length < 8) return;
    this.values.add(trimmed);
  }

  /** registra todos los valores de un objeto cuyas claves parezcan secretos */
  addFromEnv(env: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(env)) {
      if (/(_KEY|_TOKEN|_SECRET|_PASSWORD)$/.test(key)) this.add(value);
    }
  }

  list(): string[] {
    return [...this.values];
  }

  clear(): void {
    this.values.clear();
  }
}

// registro global compartido por el proceso
export const secretRegistry = new SecretRegistry();

/**
 * redacta secretos de un texto. combina patrones genericos con los valores
 * literales registrados. es idempotente: redactar dos veces da el mismo resultado.
 */
export function redact(input: string, registry: SecretRegistry = secretRegistry): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  let output = input;

  // primero los valores literales conocidos, que son los mas fiables
  for (const secret of registry.list()) {
    output = output.split(secret).join(PLACEHOLDER);
  }

  for (const { regex, replacer } of PATTERNS) {
    output = output.replace(new RegExp(regex.source, regex.flags), (match) => replacer(match));
  }

  return output;
}

/**
 * nombres de propiedad que se consideran secretos por si mismos.
 * hace falta un limite de palabra real para no marcar "monkey" o "keyboard":
 *   - exacto:     key, token, secret...
 *   - snake:      MACHINE_TOKEN, api-key
 *   - camelCase:  machineToken, apiKey (la mayuscula marca el limite)
 */
const SECRET_WORDS = 'key|token|secret|password|credential';
const SECRET_KEY_NAME_PATTERNS = [
  new RegExp(`^(${SECRET_WORDS})s?$`, 'i'),
  new RegExp(`[_-](${SECRET_WORDS})s?$`, 'i'),
  // sensible a mayusculas a proposito: la capital delimita la palabra
  new RegExp(`[a-z0-9](${SECRET_WORDS.replace(/\b\w/g, (c) => c.toUpperCase())})s?$`),
];

/** true si el nombre de una propiedad designa un secreto */
export function isSecretKeyName(name: string): boolean {
  return SECRET_KEY_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/** aplica redaccion recursivamente a cualquier estructura serializable */
export function redactDeep(value: unknown, registry: SecretRegistry = secretRegistry): unknown {
  if (typeof value === 'string') return redact(value, registry);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, registry));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // una clave con nombre de secreto se redacta entera sin mirar su contenido.
      // cubre SCREAMING_SNAKE (MACHINE_TOKEN) y camelCase (machineToken).
      out[key] = isSecretKeyName(key) ? PLACEHOLDER : redactDeep(item, registry);
    }
    return out;
  }
  return value;
}

/**
 * lista de variables de entorno que NUNCA deben llegar a un proceso hijo
 * que ejecuta un modelo, ni aparecer en un prompt.
 */
export const FORBIDDEN_ENV_PATTERNS = [
  /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/i,
  /^AWS_/i,
  /^GITHUB_/i,
  /^GH_/i,
  /^NPM_/i,
  /^SSH_/i,
  /^SUPABASE_/i,
  /^TELEGRAM_/i,
  /^CLOUDFLARE_/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
];

/**
 * construye un entorno minimo para un proceso hijo.
 * nunca se hereda el entorno completo: solo la lista permitida.
 */
export function buildSafeEnv(
  source: Record<string, string | undefined>,
  allowList: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of allowList) {
    const value = source[name];
    if (typeof value !== 'string') continue;
    if (FORBIDDEN_ENV_PATTERNS.some((pattern) => pattern.test(name))) continue;
    out[name] = value;
  }
  return out;
}
