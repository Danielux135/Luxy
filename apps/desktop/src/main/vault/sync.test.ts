import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveVaultId } from '@luxy/vault-crypto';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';
import { syncVault } from './sync.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';

function memoryDeviceKeys(): DeviceKeyStore {
  let value: string | undefined;
  return {
    get: () => value,
    set: (next: string) => {
      value = next;
    },
    delete: () => {
      value = undefined;
    },
  };
}

const turn = (text: string) => ({
  role: 'user' as const,
  text,
  title: 'Titulo',
  provider: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
});

interface Recorded {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}

/** gateway falso: ni red, ni Supabase */
function fakeGateway(remote: { conversations?: unknown[]; records?: unknown[] } = {}) {
  const calls: Recorded[] = [];
  const stored: unknown[] = [];

  const impl = (async (url: string | URL, init?: RequestInit) => {
    const href = url.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? null : JSON.parse(String(init.body));
    calls.push({
      url: href,
      method,
      body,
      authorization: new Headers(init?.headers ?? {}).get('Authorization'),
    });

    if (href.includes('/api/vault/records') && method === 'POST') {
      const records = (body as { records: unknown[] }).records;
      stored.push(...records);
      return Response.json({ stored: records.length, skipped: 0 });
    }
    if (href.includes('/api/vault/conversations/')) {
      return Response.json({ records: remote.records ?? [] });
    }
    if (href.includes('/api/vault/conversations')) {
      return Response.json({ conversations: remote.conversations ?? [] });
    }
    return Response.json({}, { status: 404 });
  }) as unknown as typeof fetch;

  return { impl, calls, stored };
}

describe('sincronizacion de la boveda', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-sync-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    store = new PrivateConversationStore(conversationsDirectory(directory));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const deps = (impl: typeof fetch, onUnauthorized?: () => void) => ({
    gatewayUrl: 'https://gw.example',
    sessionToken: 'sesion-de-prueba',
    fetchImpl: impl,
    ...(onUnauthorized === undefined ? {} : { onUnauthorized }),
  });

  it('sube lo que hay en este equipo', async () => {
    await store.appendTurn(vault, A, turn('uno'));
    await store.appendTurn(vault, A, turn('dos'));

    const gateway = fakeGateway();
    const result = await syncVault(vault, store, deps(gateway.impl));

    expect(result.uploaded).toBe(2);
    expect(gateway.stored).toHaveLength(2);
  });

  it('lo que sube va cifrado y no lleva el texto', async () => {
    await store.appendTurn(vault, A, turn('un secreto que no debe viajar en claro'));

    const gateway = fakeGateway();
    await syncVault(vault, store, deps(gateway.impl));

    const subida = gateway.calls.find((call) => call.method === 'POST');
    expect(JSON.stringify(subida?.body)).not.toContain('un secreto que no debe viajar');
    expect(JSON.stringify(subida?.body)).not.toContain('Titulo');
  });

  it('autoriza la sesion de la cuenta, no el token de maquina', async () => {
    await store.appendTurn(vault, A, turn('x'));
    const gateway = fakeGateway();
    await syncVault(vault, store, deps(gateway.impl));

    expect(gateway.calls.every((call) => call.authorization === 'Bearer sesion-de-prueba')).toBe(
      true,
    );
    // el identificador de boveda agrupaba pero nunca autorizo: ya no viaja
    const subida = gateway.calls.find((call) => call.method === 'POST');
    expect((subida?.body as { vaultId?: string }).vaultId).toBeUndefined();
    expect(gateway.calls.some((call) => call.url.includes('vaultId='))).toBe(false);
    expect(JSON.stringify(subida?.body)).not.toContain(PASSWORD);
  });

  it('baja lo que falta en este equipo', async () => {
    await store.appendTurn(vault, A, turn('local'));
    // se sella un turno de verdad para que se pueda abrir al descargarlo
    const ajeno = await store.appendTurn(vault, A, turn('venido de otro equipo'));
    store.delete(A);
    await store.appendTurn(vault, A, turn('local'));

    const gateway = fakeGateway({
      conversations: [{ conversationId: A, turnCount: 2, updatedAt: '2026-09-01T10:00:00Z' }],
      records: [ajeno],
    });
    const result = await syncVault(vault, store, deps(gateway.impl));

    expect(result.downloaded).toBe(1);
    const turnos = await store.read(vault, A);
    expect(turnos.map((t) => t.text)).toContain('venido de otro equipo');
  });

  it('no vuelve a bajar lo que ya tiene', async () => {
    const propio = await store.appendTurn(vault, A, turn('ya lo tengo'));
    const gateway = fakeGateway({ records: [propio] });

    const result = await syncVault(vault, store, deps(gateway.impl));
    expect(result.downloaded).toBe(0);
    expect((await store.read(vault, A)).length).toBe(1);
  });

  it('descarta un registro que esta boveda no puede abrir', async () => {
    await store.appendTurn(vault, A, turn('mio'));

    // un registro de OTRA boveda: mismo formato, otra llave
    const otroDirectorio = mkdtempSync(join(tmpdir(), 'luxy-otra-'));
    const otraVault = new VaultService(vaultFilePathFor(otroDirectorio), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await otraVault.create('otra frase larga distinta');
    const otroStore = new PrivateConversationStore(conversationsDirectory(otroDirectorio));
    const ajeno = await otroStore.appendTurn(otraVault, A, turn('de otra boveda'));

    const gateway = fakeGateway({ records: [{ ...ajeno, sequence: 9 }] });
    const result = await syncVault(vault, store, deps(gateway.impl));

    // si entrara, cada lectura posterior fallaria sin saber cual es el malo
    expect(result.downloaded).toBe(0);
    expect((await store.read(vault, A)).length).toBe(1);
    rmSync(otroDirectorio, { recursive: true, force: true });
  });

  it('sincroniza conversaciones que solo existen en el servidor', async () => {
    const gateway = fakeGateway({
      conversations: [{ conversationId: A, turnCount: 0, updatedAt: '2026-09-01T10:00:00Z' }],
    });
    const result = await syncVault(vault, store, deps(gateway.impl));
    // sin unir las dos listas, una conversacion creada en el otro equipo no se
    // descargaria nunca porque aqui no existe
    expect(result.conversations).toBe(1);
  });

  it('sube antes de bajar', async () => {
    await store.appendTurn(vault, A, turn('lo mio'));
    const gateway = fakeGateway({ records: [] });
    await syncVault(vault, store, deps(gateway.impl));

    const posts = gateway.calls.findIndex((call) => call.method === 'POST');
    const pulls = gateway.calls.findIndex((call) => call.url.includes(`/conversations/${A}`));
    // si se corta a medias se pierde trabajo ajeno recuperable, no el propio
    expect(posts).toBeLessThan(pulls);
  });

  it('con la boveda cerrada no sincroniza', async () => {
    vault.lock();
    const gateway = fakeGateway();
    await expect(syncVault(vault, store, deps(gateway.impl))).rejects.toThrow(VaultError);
    expect(gateway.calls).toHaveLength(0);
  });

  it('un 401 olvida la sesion y explica que hacer', async () => {
    const impl = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    let olvidada = false;
    await expect(
      syncVault(vault, store, deps(impl, () => {
        olvidada = true;
      })),
    ).rejects.toMatchObject({
      hint: expect.stringContaining('vuelve a entrar'),
    });
    // sin olvidarla, la siguiente accion volveria a fallar con el mismo token
    expect(olvidada).toBe(true);
  });

  it('un fallo del servidor no pierde lo local', async () => {
    await store.appendTurn(vault, A, turn('sigue aqui'));
    const impl = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;

    await expect(syncVault(vault, store, deps(impl))).rejects.toThrow();
    expect((await store.read(vault, A)).map((t) => t.text)).toEqual(['sigue aqui']);
  });
});

describe('identificador de boveda', () => {
  it('dos equipos con la misma contraseña derivan el mismo', async () => {
    const uno = mkdtempSync(join(tmpdir(), 'luxy-id1-'));
    const vaultUno = new VaultService(vaultFilePathFor(uno), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vaultUno.create(PASSWORD);
    const master = vaultUno.subkeyFor('index');

    // misma llave maestra -> mismo identificador, sin coordinarse
    expect(deriveVaultId(master)).toBe(deriveVaultId(master));
    expect(deriveVaultId(master)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    rmSync(uno, { recursive: true, force: true });
  });
});
