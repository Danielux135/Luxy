// entorno del worker y su validacion
import { z } from 'zod';
import { secretRegistry } from '@luxy/shared';

export interface Env {
  // secretos (wrangler secret put)
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_ADMIN_USER_ID: string;
  TELEGRAM_ALLOWED_CHAT_IDS: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MACHINE_REGISTRATION_SECRET: string;
  // variables publicas (wrangler.toml [vars])
  TELEGRAM_BOT_USERNAME?: string;
  MACHINE_OFFLINE_SECONDS?: string;
  JOB_LEASE_SECONDS?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  LOG_LEVEL?: string;
}

// un entero recibido como cadena desde las vars del worker
const numericString = (fallback: number): z.ZodEffects<z.ZodOptional<z.ZodString>, number> =>
  z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number.parseInt(value ?? '', 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    });

export const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, 'falta TELEGRAM_BOT_TOKEN'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8, 'falta TELEGRAM_WEBHOOK_SECRET'),
  TELEGRAM_ADMIN_USER_ID: z.string().min(1, 'falta TELEGRAM_ADMIN_USER_ID'),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().min(1, 'falta TELEGRAM_ALLOWED_CHAT_IDS'),
  SUPABASE_URL: z.string().url('SUPABASE_URL no es una url valida'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'falta SUPABASE_SERVICE_ROLE_KEY'),
  MACHINE_REGISTRATION_SECRET: z.string().min(8, 'falta MACHINE_REGISTRATION_SECRET'),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  MACHINE_OFFLINE_SECONDS: numericString(45),
  JOB_LEASE_SECONDS: numericString(120),
  RATE_LIMIT_PER_MINUTE: numericString(30),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

export interface GatewayConfig extends ValidatedEnv {
  adminUserId: number;
  allowedChatIds: number[];
  botUsername: string | null;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

/**
 * valida el entorno y registra los secretos para que la funcion de redaccion
 * los elimine de cualquier log o mensaje antes de salir del worker.
 */
export function loadConfig(env: Env): GatewayConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // se incluye SIEMPRE el nombre de la variable: es lo unico util para
    // arreglarlo. el valor nunca se incluye, aunque exista.
    const issues = parsed.error.issues
      .map((issue) => {
        const name = issue.path.join('.');
        return name.length > 0 ? `${name}: ${issue.message}` : issue.message;
      })
      .join('; ');
    throw new EnvError(`configuracion del gateway incompleta: ${issues}`);
  }
  const value = parsed.data;

  // en cuanto se conocen los secretos se registran para poder redactarlos
  secretRegistry.add(value.TELEGRAM_BOT_TOKEN);
  secretRegistry.add(value.TELEGRAM_WEBHOOK_SECRET);
  secretRegistry.add(value.SUPABASE_SERVICE_ROLE_KEY);
  secretRegistry.add(value.MACHINE_REGISTRATION_SECRET);

  const adminUserId = Number.parseInt(value.TELEGRAM_ADMIN_USER_ID, 10);
  if (!Number.isFinite(adminUserId)) {
    throw new EnvError('TELEGRAM_ADMIN_USER_ID debe ser un id numerico de telegram');
  }

  const allowedChatIds = value.TELEGRAM_ALLOWED_CHAT_IDS.split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isFinite(id));

  if (allowedChatIds.length === 0) {
    throw new EnvError('TELEGRAM_ALLOWED_CHAT_IDS no contiene ningun id valido');
  }

  return {
    ...value,
    adminUserId,
    allowedChatIds,
    botUsername: value.TELEGRAM_BOT_USERNAME?.replace(/^@/, '') ?? null,
  };
}
