// autenticacion del webhook y de las maquinas
import type { GatewayConfig } from './env.js';
import type { SupabaseClient } from './supabase.js';
import { eq } from './supabase.js';

/**
 * comparacion en tiempo constante, para no filtrar informacion por el tiempo
 * de respuesta al comparar tokens.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  // se comparan siempre todos los bytes de la longitud mayor
  const length = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

/**
 * hash sha-256 en hexadecimal. los tokens de maquina se guardan asi:
 * nunca en texto plano.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** genera un token de maquina aleatorio de 256 bits en base64url */
export function generateMachineToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** valida la cabecera secreta que telegram añade a cada webhook */
export function verifyWebhookSecret(request: Request, config: GatewayConfig): boolean {
  const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!header) return false;
  return timingSafeEqual(header, config.TELEGRAM_WEBHOOK_SECRET);
}

/** comprueba que el usuario de telegram esta autorizado */
export function isAuthorizedUser(userId: number | undefined, config: GatewayConfig): boolean {
  if (typeof userId !== 'number') return false;
  return userId === config.adminUserId;
}

/** comprueba que el chat esta en la lista blanca */
export function isAuthorizedChat(chatId: number | undefined, config: GatewayConfig): boolean {
  if (typeof chatId !== 'number') return false;
  return config.allowedChatIds.includes(chatId);
}

export interface AuthenticatedMachine {
  id: string;
  name: string;
  enabled: boolean;
  projects: string[];
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

interface MachineTokenRow {
  id: string;
  machine_id: string;
  revoked_at: string | null;
  expires_at: string | null;
}

interface MachineRow {
  id: string;
  name: string;
  enabled: boolean;
  projects: string[];
}

/** extrae el token bearer de la cabecera de autorizacion */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * autentica una maquina por su token.
 * comprueba hash, revocacion, caducidad y que la maquina siga habilitada.
 */
export async function authenticateMachine(
  request: Request,
  supabase: SupabaseClient,
): Promise<AuthenticatedMachine> {
  const token = extractBearerToken(request);
  if (!token) throw new AuthError('falta el token de maquina', 401);

  const tokenHash = await hashToken(token);
  const row = await supabase.selectOne<MachineTokenRow>('machine_tokens', {
    columns: 'id,machine_id,revoked_at,expires_at',
    filters: { token_hash: eq(tokenHash) },
  });

  if (!row) throw new AuthError('token de maquina no valido', 401);
  if (row.revoked_at) throw new AuthError('el token de esta maquina fue revocado', 401);
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    throw new AuthError('el token de esta maquina ha caducado', 401);
  }

  const machine = await supabase.selectOne<MachineRow>('machines', {
    columns: 'id,name,enabled,projects',
    filters: { id: eq(row.machine_id) },
  });

  if (!machine) throw new AuthError('la maquina ya no existe', 401);
  if (!machine.enabled) throw new AuthError('esta maquina esta deshabilitada', 403);

  return {
    id: machine.id,
    name: machine.name,
    enabled: machine.enabled,
    projects: machine.projects ?? [],
  };
}

/** valida el secreto temporal usado para dar de alta una maquina nueva */
export function verifyRegistrationSecret(provided: string, config: GatewayConfig): boolean {
  return timingSafeEqual(provided, config.MACHINE_REGISTRATION_SECRET);
}
