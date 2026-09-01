import { describe, it, expect } from 'vitest';
import { toBase64Url } from '@luxy/vault-crypto';
import {
  changeAccountPassword,
  loginAccount,
  registerAccount,
} from './account-client.js';
import { VaultError } from './vault-service.js';

const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const EMAIL = 'daniel@example.com';
const PASSWORD = 'una frase larga de prueba';

/**
 * gateway falso con memoria: guarda lo que se registra y responde login como lo
 * haria el real. Asi se prueba el flujo completo sin red ni Supabase.
 */
function fakeGateway() {
  const accounts = new Map<string, any>();
  const sessions = new Set<string>();
  const calls: { path: string; body: any }[] = [];

  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(url.toString()).pathname;
    const body = init?.body === undefined ? null : JSON.parse(String(init.body));
    calls.push({ path, body });

    if (path === '/api/vault/register') {
      if (accounts.has(body.email)) return new Response('', { status: 409 });
      accounts.set(body.email, body);
      const token = `session-token-register-${accounts.size}`;
      sessions.add(token);
      return Response.json({
        sessionToken: token,
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        vaultId: body.vaultId,
      });
    }
    if (path === '/api/vault/login/start') {
      const acc = accounts.get(body.email);
      if (acc === undefined) {
        // señuelo: datos plausibles que no abriran nada
        return Response.json({
          authSalt: 'A'.repeat(22),
          argon2Params: { t: 3, m: 65536, p: 1 },
          wrappedMasterKey: {
            version: 1,
            purpose: 'vault.account.masterkey',
            nonce: 'A'.repeat(16),
            ciphertext: 'AAAA',
          },
        });
      }
      return Response.json({
        authSalt: acc.authSalt,
        argon2Params: acc.argon2Params,
        wrappedMasterKey: acc.wrappedMasterKey,
      });
    }
    if (path === '/api/vault/login/finish') {
      const acc = accounts.get(body.email);
      if (acc === undefined || acc.authHash !== body.authHash) {
        return new Response('', { status: 401 });
      }
      const token = `session-token-login-${sessions.size}`;
      sessions.add(token);
      return Response.json({
        sessionToken: token,
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        vaultId: acc.vaultId,
      });
    }
    if (path === '/api/vault/password') {
      const token = init?.headers && new Headers(init.headers as any).get('Authorization');
      if (token === null) return new Response('', { status: 401 });
      // simula el reemplazo de credenciales
      for (const acc of accounts.values()) {
        acc.authHash = body.authHash;
        acc.authSalt = body.authSalt;
        acc.wrappedMasterKey = body.wrappedMasterKey;
      }
      return Response.json({ ok: true });
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;

  return { impl, accounts, calls };
}

const deps = (impl: typeof fetch) => ({ gatewayUrl: 'https://gw.example', fetchImpl: impl });
const fast = (impl: typeof fetch) => ({ ...deps(impl), fetchImpl: impl });

describe('registro de cuenta', () => {
  it('lo que se envia al servidor no lleva la contraseña', async () => {
    const gw = fakeGateway();
    await registerAccount(fast(gw.impl), EMAIL, PASSWORD, FAST);
    const registro = gw.calls.find((c) => c.path === '/api/vault/register');
    expect(JSON.stringify(registro?.body)).not.toContain(PASSWORD);
    // la maestra viaja envuelta, no en claro
    expect(registro?.body.wrappedMasterKey.purpose).toBe('vault.account.masterkey');
  });

  it('devuelve una sesion abierta y la clave de recuperacion', async () => {
    const gw = fakeGateway();
    const { session, recoveryKey } = await registerAccount(fast(gw.impl), EMAIL, PASSWORD, FAST);
    expect(session.sessionToken).toBeTruthy();
    expect(session.masterKey.length).toBe(32);
    expect(recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$/);
  });

  it('rechaza una contraseña corta antes de tocar la red', async () => {
    const gw = fakeGateway();
    await expect(registerAccount(fast(gw.impl), EMAIL, 'corta', FAST)).rejects.toThrow(VaultError);
    expect(gw.calls).toHaveLength(0);
  });

  it('un correo ya registrado falla', async () => {
    const gw = fakeGateway();
    await registerAccount(fast(gw.impl), EMAIL, PASSWORD, FAST);
    await expect(registerAccount(fast(gw.impl), EMAIL, PASSWORD, FAST)).rejects.toThrow(
      'no se pudo crear',
    );
  });
});

describe('inicio de sesion', () => {
  it('la contraseña correcta abre la MISMA boveda', async () => {
    const gw = fakeGateway();
    const registro = await registerAccount(fast(gw.impl), EMAIL, PASSWORD, FAST);
    const login = await loginAccount(fast(gw.impl), EMAIL, PASSWORD);

    // misma llave maestra: es su boveda, abierta desde "otro equipo"
    expect(toBase64Url(login.masterKey)).toBe(toBase64Url(registro.session.masterKey));
    expect(login.vaultId).toBe(registro.session.vaultId);
  });

  it('la contraseña incorrecta no abre y no llega a login/finish', async () => {
    const gw = fakeGateway();
    await registerAccount(fast(gw.impl), EMAIL, PASSWORD, FAST);
    gw.calls.length = 0;

    await expect(loginAccount(fast(gw.impl), EMAIL, 'otra distinta larga')).rejects.toThrow(
      'correo o contraseña incorrectos',
    );
    // la maestra no se abre en local, asi que finish nunca se llama
    expect(gw.calls.some((c) => c.path === '/api/vault/login/finish')).toBe(false);
  });

  it('un correo inexistente falla como una contraseña mala', async () => {
    const gw = fakeGateway();
    // el señuelo devuelve datos que no abren: mismo error, no se revela nada
    await expect(loginAccount(fast(gw.impl), 'nadie@example.com', PASSWORD)).rejects.toThrow(
      'correo o contraseña incorrectos',
    );
  });
});

describe('cambio de contraseña', () => {
  it('reenvia credenciales nuevas y despues abre con la nueva', async () => {
    const gw = fakeGateway();
    const { session } = await registerAccount(fast(gw.impl), EMAIL, PASSWORD, FAST);

    const stored = gw.accounts.get(EMAIL);
    await changeAccountPassword(
      fast(gw.impl),
      session.sessionToken,
      session.masterKey,
      stored.authHash,
      'contraseña nueva larga',
      FAST,
    );

    // la nueva abre
    const login = await loginAccount(fast(gw.impl), EMAIL, 'contraseña nueva larga');
    expect(toBase64Url(login.masterKey)).toBe(toBase64Url(session.masterKey));
  });
});
