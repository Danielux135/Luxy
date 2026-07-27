import { describe, it, expect } from 'vitest';
import {
  timingSafeEqual,
  hashToken,
  generateMachineToken,
  verifyWebhookSecret,
  isAuthorizedUser,
  isAuthorizedChat,
  extractBearerToken,
  verifyRegistrationSecret,
  authenticateMachine,
  AuthError,
} from './auth.js';
import type { GatewayConfig } from './env.js';

const CONFIG = {
  TELEGRAM_WEBHOOK_SECRET: 'secreto-del-webhook-1234',
  MACHINE_REGISTRATION_SECRET: 'secreto-de-registro-5678',
  adminUserId: 111222333,
  allowedChatIds: [111222333, -1001234567890],
} as unknown as GatewayConfig;

describe('timingSafeEqual', () => {
  it('devuelve true para cadenas iguales', () => {
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
  });

  it('devuelve false para cadenas distintas de la misma longitud', () => {
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
  });

  it('devuelve false para longitudes distintas', () => {
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
  });

  it('maneja cadenas vacias', () => {
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('', 'a')).toBe(false);
  });
});

describe('hashToken', () => {
  it('produce un sha-256 hexadecimal de 64 caracteres', async () => {
    const hash = await hashToken('un-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('es determinista', async () => {
    expect(await hashToken('mismo')).toBe(await hashToken('mismo'));
  });

  it('cambia por completo con una entrada distinta', async () => {
    expect(await hashToken('a')).not.toBe(await hashToken('b'));
  });

  it('nunca devuelve el token original', async () => {
    const token = 'token-en-claro-que-no-debe-aparecer';
    expect(await hashToken(token)).not.toContain(token);
  });
});

describe('generateMachineToken', () => {
  it('genera tokens suficientemente largos y en base64url', () => {
    const token = generateMachineToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('no repite tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateMachineToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('verifyWebhookSecret', () => {
  const build = (headers: Record<string, string>): Request =>
    new Request('https://x/telegram/webhook', { method: 'POST', headers });

  it('acepta la cabecera correcta', () => {
    const request = build({ 'X-Telegram-Bot-Api-Secret-Token': 'secreto-del-webhook-1234' });
    expect(verifyWebhookSecret(request, CONFIG)).toBe(true);
  });

  it('rechaza una cabecera incorrecta', () => {
    const request = build({ 'X-Telegram-Bot-Api-Secret-Token': 'otro-secreto' });
    expect(verifyWebhookSecret(request, CONFIG)).toBe(false);
  });

  it('rechaza si falta la cabecera', () => {
    expect(verifyWebhookSecret(build({}), CONFIG)).toBe(false);
  });
});

describe('autorizacion de usuario y chat', () => {
  it('solo autoriza al usuario administrador', () => {
    expect(isAuthorizedUser(111222333, CONFIG)).toBe(true);
    expect(isAuthorizedUser(999999999, CONFIG)).toBe(false);
  });

  it('rechaza un usuario indefinido', () => {
    expect(isAuthorizedUser(undefined, CONFIG)).toBe(false);
  });

  it('autoriza solo los chats de la lista blanca', () => {
    expect(isAuthorizedChat(111222333, CONFIG)).toBe(true);
    expect(isAuthorizedChat(-1001234567890, CONFIG)).toBe(true);
    expect(isAuthorizedChat(-1009999999999, CONFIG)).toBe(false);
  });

  it('rechaza un chat indefinido', () => {
    expect(isAuthorizedChat(undefined, CONFIG)).toBe(false);
  });
});

describe('verifyRegistrationSecret', () => {
  it('acepta el secreto correcto y rechaza el resto', () => {
    expect(verifyRegistrationSecret('secreto-de-registro-5678', CONFIG)).toBe(true);
    expect(verifyRegistrationSecret('incorrecto', CONFIG)).toBe(false);
  });
});

describe('extractBearerToken', () => {
  const build = (value?: string): Request =>
    new Request('https://x/api', value ? { headers: { Authorization: value } } : {});

  it('extrae el token de una cabecera bearer', () => {
    expect(extractBearerToken(build('Bearer mi-token-123'))).toBe('mi-token-123');
  });

  it('acepta el esquema en cualquier capitalizacion', () => {
    expect(extractBearerToken(build('bearer mi-token-123'))).toBe('mi-token-123');
  });

  it('devuelve null si no hay cabecera o el formato es otro', () => {
    expect(extractBearerToken(build())).toBeNull();
    expect(extractBearerToken(build('Basic abc'))).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// autenticacion de maquina con supabase simulado
// -----------------------------------------------------------------------------
interface FakeRow {
  [key: string]: unknown;
}

/** cliente de supabase falso: nunca hace red */
function fakeDb(tokens: FakeRow[], machines: FakeRow[]): any {
  return {
    async selectOne(table: string, options: { filters?: Record<string, string> }) {
      const filters = options.filters ?? {};
      const rows = table === 'machine_tokens' ? tokens : machines;
      return (
        rows.find((row) =>
          Object.entries(filters).every(([key, value]) => `eq.${row[key]}` === value),
        ) ?? null
      );
    },
  };
}

describe('authenticateMachine', () => {
  const TOKEN = 'token-de-maquina-valido-123456';
  const build = (token?: string): Request =>
    new Request('https://x/api/jobs/claim', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  it('autentica una maquina con token valido', async () => {
    const hash = await hashToken(TOKEN);
    const db = fakeDb(
      [{ id: 't1', machine_id: 'm1', token_hash: hash, revoked_at: null, expires_at: null }],
      [{ id: 'm1', name: 'casa', enabled: true, projects: ['errorlux'] }],
    );
    const machine = await authenticateMachine(build(TOKEN), db);
    expect(machine).toMatchObject({ id: 'm1', name: 'casa', projects: ['errorlux'] });
  });

  it('rechaza si falta el token', async () => {
    await expect(authenticateMachine(build(), fakeDb([], []))).rejects.toThrow(AuthError);
  });

  it('rechaza un token desconocido', async () => {
    await expect(authenticateMachine(build('desconocido'), fakeDb([], []))).rejects.toThrow(
      'token de maquina no valido',
    );
  });

  it('rechaza un token revocado', async () => {
    const hash = await hashToken(TOKEN);
    const db = fakeDb(
      [
        {
          id: 't1',
          machine_id: 'm1',
          token_hash: hash,
          revoked_at: '2026-01-01T00:00:00Z',
          expires_at: null,
        },
      ],
      [{ id: 'm1', name: 'casa', enabled: true, projects: [] }],
    );
    await expect(authenticateMachine(build(TOKEN), db)).rejects.toThrow('revocado');
  });

  it('rechaza un token caducado', async () => {
    const hash = await hashToken(TOKEN);
    const db = fakeDb(
      [
        {
          id: 't1',
          machine_id: 'm1',
          token_hash: hash,
          revoked_at: null,
          expires_at: '2020-01-01T00:00:00Z',
        },
      ],
      [{ id: 'm1', name: 'casa', enabled: true, projects: [] }],
    );
    await expect(authenticateMachine(build(TOKEN), db)).rejects.toThrow('caducado');
  });

  it('rechaza una maquina deshabilitada con codigo 403', async () => {
    const hash = await hashToken(TOKEN);
    const db = fakeDb(
      [{ id: 't1', machine_id: 'm1', token_hash: hash, revoked_at: null, expires_at: null }],
      [{ id: 'm1', name: 'casa', enabled: false, projects: [] }],
    );
    await expect(authenticateMachine(build(TOKEN), db)).rejects.toMatchObject({ status: 403 });
  });

  it('rechaza si la maquina ya no existe', async () => {
    const hash = await hashToken(TOKEN);
    const db = fakeDb(
      [{ id: 't1', machine_id: 'm1', token_hash: hash, revoked_at: null, expires_at: null }],
      [],
    );
    await expect(authenticateMachine(build(TOKEN), db)).rejects.toThrow('ya no existe');
  });
});
