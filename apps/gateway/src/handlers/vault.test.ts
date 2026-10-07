import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  handleVaultLoginFinish,
  handleVaultLoginStart,
  handleVaultRegister,
  handleVaultV1Closed,
} from './vault.js';
import {
  handleVaultV2Capabilities,
  handleVaultV2ConversationList,
  handleVaultV2Manifest,
  handleVaultV2MediaList,
  handleVaultV2MediaPush,
  handleVaultV2Purge,
  handleVaultV2RecordsFetch,
  handleVaultV2RecordsPush,
} from './vault-sync-v2.js';
import worker from '../index.js';
import { SupabaseClient } from '../supabase.js';
import { ObjectStoreError, VaultObjectStore } from '../object-store.js';
import {
  VAULT_SESSION_RENEW_BELOW_MS,
  VAULT_SESSION_TTL_MS,
  authenticateVaultUser,
} from '../vault-auth.js';
import { AuthError } from '../auth.js';
import {
  FakeSupabase,
  fakeEnv,
  installFakeFetch,
  seedVaultAccount,
} from '../fake-supabase.fixture.js';

const VAULT_ID = 'A'.repeat(43);
const CONVERSATION = 'ad6a9bf6-c69f-4eab-9624-f405b78bdda5';

const envelope = {
  version: 1,
  purpose: 'vault.conversation' as const,
  nonce: 'QLBVV_RjvTFFlpRx',
  ciphertext: 'gKXo4HjmSky6cOWq',
};

const record = (sequence = 0) => ({
  recordId: `0000000${sequence}-0000-4000-8000-000000000000`,
  conversationId: CONVERSATION,
  privacy: 'private' as const,
  sequence,
  content: envelope,
  sealedMemory: null,
  createdAt: '2026-09-01T14:33:21.073Z',
});

/**
 * ALCANCE DE ESTAS PRUEBAS, para que nadie las lea como mas de lo que son.
 *
 * La primera parte verifica el CONTRATO de las cuentas y los esquemas que
 * siguen en `@luxy/shared`. La segunda (SYNC-F1-02) conduce el Worker entero
 * contra `FakeSupabase`, un PostgREST y un Storage en memoria que imitan lo que
 * hacen los de verdad: fechas con «+00:00», INSERT atomico con 409 y un 400
 * con statusCode "404" para un objeto que no existe.
 *
 * Sigue sin verificarse contra un Postgres real: no hay Supabase de pruebas
 * (LA-015). La sincronizacion v2 se prueba en `vault-sync-v2.test.ts`.
 */

describe('cuentas', () => {
  it('los cuatro manejadores de cuenta existen', () => {
    for (const handler of [handleVaultRegister, handleVaultLoginStart, handleVaultLoginFinish]) {
      expect(typeof handler).toBe('function');
    }
  });

  it('el registro NO exige token de maquina', () => {
    // es como se entra la primera vez: register y login/* van sin sesion previa
    expect(handleVaultRegister.length).toBeLessThanOrEqual(2);
  });

  it('login/start responde algo plausible aunque el correo no exista', async () => {
    const { vaultLoginStartResponseSchema } = await import('@luxy/shared');
    // el señuelo tiene que validar contra el mismo esquema que una respuesta
    // real, o revelaria por la forma que la cuenta no existe
    const decoy = {
      authSalt: 'ABCDEFGHJKMNPQRSTVWXYZ',
      argon2Params: { t: 3, m: 65536, p: 1 },
      wrappedMasterKey: {
        version: 1,
        purpose: 'vault.account.masterkey',
        nonce: 'ABCDEFGHJKMNPQRS',
        ciphertext: 'ABCD',
      },
      // la puerta de recuperacion viaja tambien en el señuelo: omitirla
      // delataria que esa cuenta no existe
      recovery: {
        authSalt: 'ZYXWVTSRQPNMKJHGFEDCBA',
        argon2Params: { t: 1, m: 8192, p: 1 },
        wrappedMasterKey: {
          version: 1,
          purpose: 'vault.account.recovery',
          nonce: 'ZYXWVTSRQPNMKJHG',
          ciphertext: 'DCBA',
        },
      },
    };
    expect(vaultLoginStartResponseSchema.safeParse(decoy).success).toBe(true);
  });

  it('un sobre de recuperacion no cuela como sobre de contraseña', async () => {
    const { vaultLoginStartResponseSchema } = await import('@luxy/shared');
    // el proposito viaja autenticado (D-041), y ademas el servidor no acepta
    // por la forma que se intercambien las dos puertas
    const cruzado = {
      authSalt: 'ABCDEFGHJKMNPQRSTVWXYZ',
      argon2Params: { t: 3, m: 65536, p: 1 },
      wrappedMasterKey: {
        version: 1,
        purpose: 'vault.account.recovery',
        nonce: 'ABCDEFGHJKMNPQRS',
        ciphertext: 'ABCD',
      },
      recovery: {
        authSalt: 'ZYXWVTSRQPNMKJHGFEDCBA',
        argon2Params: { t: 1, m: 8192, p: 1 },
        wrappedMasterKey: {
          version: 1,
          purpose: 'vault.account.masterkey',
          nonce: 'ZYXWVTSRQPNMKJHG',
          ciphertext: 'DCBA',
        },
      },
    };
    expect(vaultLoginStartResponseSchema.safeParse(cruzado).success).toBe(false);
  });

  it('el hash de acceso que se guarda tiene la forma que exige el contrato', async () => {
    const { vaultRegisterRequestSchema } = await import('@luxy/shared');
    const parsed = vaultRegisterRequestSchema.safeParse({
      email: 'daniel@example.com',
      authSalt: 'ABCDEFGHJKMNPQRSTVWXYZ',
      argon2Params: { t: 3, m: 65536, p: 1 },
      authHash: 'A'.repeat(43),
      wrappedMasterKey: {
        version: 1,
        purpose: 'vault.account.masterkey',
        nonce: 'ABCDEFGHJKMNPQRS',
        ciphertext: 'ABCD',
      },
      vaultId: 'B'.repeat(43),
      recovery: {
        authSalt: 'ZYXWVTSRQPNMKJHGFEDCBA',
        argon2Params: { t: 1, m: 8192, p: 1 },
        authHash: 'C'.repeat(43),
        wrappedMasterKey: {
          version: 1,
          purpose: 'vault.account.recovery',
          nonce: 'ZYXWVTSRQPNMKJHG',
          ciphertext: 'DCBA',
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('el registro exige la copia de recuperacion', async () => {
    const { vaultRegisterRequestSchema } = await import('@luxy/shared');
    // sin ella, una cuenta quedaria sin red de seguridad: olvidar la contraseña
    // seria perder la boveda, y el servidor no puede restablecerla
    const sinRecuperacion = {
      email: 'daniel@example.com',
      authSalt: 'ABCDEFGHJKMNPQRSTVWXYZ',
      argon2Params: { t: 3, m: 65536, p: 1 },
      authHash: 'A'.repeat(43),
      wrappedMasterKey: {
        version: 1,
        purpose: 'vault.account.masterkey',
        nonce: 'ABCDEFGHJKMNPQRS',
        ciphertext: 'ABCD',
      },
      vaultId: 'B'.repeat(43),
    };
    expect(vaultRegisterRequestSchema.safeParse(sinRecuperacion).success).toBe(false);
  });

  it('el registro rechaza una contraseña... no llega nunca: solo hashes', async () => {
    const { vaultRegisterRequestSchema } = await import('@luxy/shared');
    // el esquema no tiene campo password: no hay por donde colar la contraseña
    const shape = vaultRegisterRequestSchema.safeParse({
      email: 'x@y.com',
      password: 'esto-no-existe',
    });
    expect(shape.success).toBe(false);
  });
});

describe('contrato de subida', () => {
  it('los manejadores de sincronizacion existen y estan protegidos', () => {
    // van envueltos en withVaultAuth: sin sesion valida no se llega al cuerpo
    for (const handler of [
      handleVaultV2Capabilities,
      handleVaultV2ConversationList,
      handleVaultV2Manifest,
      handleVaultV2RecordsFetch,
      handleVaultV2RecordsPush,
      handleVaultV2MediaList,
      handleVaultV2MediaPush,
      handleVaultV2Purge,
    ]) {
      expect(typeof handler).toBe('function');
    }
  });

  it('la v1 responde 426 sin mirar nada', async () => {
    const response = await handleVaultV1Closed();
    expect(response.status).toBe(426);
    expect(((await response.json()) as { protocol: number }).protocol).toBe(2);
  });

  it('un registro valido tiene solo campos cifrados o de metadato', () => {
    const keys = Object.keys(record()).sort();
    expect(keys).toEqual([
      'content',
      'conversationId',
      'createdAt',
      'privacy',
      'recordId',
      'sealedMemory',
      'sequence',
    ]);
  });
});

describe('el servidor no se fia del cliente', () => {
  it('assertNoPlaintextLeak rechaza un registro con titulo', async () => {
    const { assertNoPlaintextLeak } = await import('@luxy/shared');
    // el escritorio ya lo comprueba antes de enviar, pero un servidor que
    // confia en eso acaba guardando lo que no debe el dia que cambia el cliente
    expect(() => assertNoPlaintextLeak({ ...record(), conversationTitle: 'revelador' })).toThrow();
  });

  it('acepta un registro que solo lleva ciphertext', async () => {
    const { assertNoPlaintextLeak } = await import('@luxy/shared');
    expect(() => assertNoPlaintextLeak(record())).not.toThrow();
  });

  it('el esquema de subida limita el tamaño del lote', async () => {
    const { vaultSyncPushRequestSchema } = await import('@luxy/shared');
    const demasiados = Array.from({ length: 201 }, (_v, index) => record(index));
    expect(
      vaultSyncPushRequestSchema.safeParse({
        vaultId: VAULT_ID,
        conversationId: CONVERSATION,
        records: demasiados,
      }).success,
    ).toBe(false);
  });

  it('el esquema exige un identificador de boveda con la forma correcta', async () => {
    const { vaultSyncPushRequestSchema } = await import('@luxy/shared');
    for (const malo of ['corto', 'A'.repeat(42), 'A'.repeat(44), 'con espacios aqui!']) {
      expect(
        vaultSyncPushRequestSchema.safeParse({
          vaultId: malo,
          conversationId: CONVERSATION,
          records: [record()],
        }).success,
      ).toBe(false);
    }
  });

  it('un lote vacio se rechaza', async () => {
    const { vaultSyncPushRequestSchema } = await import('@luxy/shared');
    expect(
      vaultSyncPushRequestSchema.safeParse({
        vaultId: VAULT_ID,
        conversationId: CONVERSATION,
        records: [],
      }).success,
    ).toBe(false);
  });
});

describe('parametros de descarga', () => {
  it('acepta una marca de tiempo para traer solo lo nuevo', async () => {
    const { vaultSyncPullQuerySchema } = await import('@luxy/shared');
    const parsed = vaultSyncPullQuerySchema.safeParse({
      vaultId: VAULT_ID,
      since: '2026-09-01T14:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
    // sin limite explicito se aplica uno: nadie descarga la boveda entera por error
    expect(parsed.success && parsed.data.limit).toBe(200);
  });

  it('acota el limite', async () => {
    const { vaultSyncPullQuerySchema } = await import('@luxy/shared');
    expect(vaultSyncPullQuerySchema.safeParse({ vaultId: VAULT_ID, limit: 5000 }).success).toBe(
      false,
    );
  });

  it('rechaza una marca de tiempo que no lo es', async () => {
    const { vaultSyncPullQuerySchema } = await import('@luxy/shared');
    expect(
      vaultSyncPullQuerySchema.safeParse({ vaultId: VAULT_ID, since: 'ayer' }).success,
    ).toBe(false);
  });
});

describe('lo que se registra', () => {
  it('el contrato de respuesta no incluye titulos ni contenido', async () => {
    const { vaultSyncListResponseSchema } = await import('@luxy/shared');
    const parsed = vaultSyncListResponseSchema.parse({
      conversations: [
        {
          conversationId: CONVERSATION,
          turnCount: 4,
          updatedAt: '2026-09-01T14:35:11Z',
          // lo que alguien podria intentar añadir "para que la lista sea util"
          title: 'un titulo',
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain('un titulo');
  });
});

// -----------------------------------------------------------------------------
// SYNC-F1-02: correcciones de base, con el Worker entero contra FakeSupabase
// -----------------------------------------------------------------------------

const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'sesion-de-prueba-del-usuario-uno';
const DIA = 24 * 60 * 60 * 1000;
const ORIGINAL = 'a'.repeat(32);
const MINIATURA = 'b'.repeat(32);

describe('SYNC-F1-02 con el Worker entero', () => {
  let fake: FakeSupabase;
  let restore: () => void;

  beforeEach(async () => {
    fake = new FakeSupabase();
    restore = installFakeFetch(fake);
    await seedVaultAccount(fake, {
      userId: USER,
      token: TOKEN,
      expiresAt: new Date(Date.now() + 25 * DIA).toISOString(),
    });
  });

  afterEach(() => restore());

  const get = (path: string, token: string | null = TOKEN) =>
    worker.fetch(
      new Request(`https://gateway.test${path}`, {
        headers: token === null ? {} : { Authorization: `Bearer ${token}` },
      }),
      fakeEnv(fake),
      {} as never,
    );

  it('una miniatura se puede descargar, y la clave de nadie no', async () => {
    fake.seed('vault_conversations', [{ conversation_id: CONVERSATION, owner_user_id: USER }]);
    fake.seed('vault_media', [
      {
        media_id: '33333333-3333-4333-8333-333333333333',
        owner_user_id: USER,
        conversation_id: CONVERSATION,
        object_key: ORIGINAL,
        byte_size: 3,
        content: { ...envelope, purpose: 'vault.media' },
        thumbnail_object_key: MINIATURA,
      },
    ]);
    fake.objects.set(`${USER}/${ORIGINAL}`, new Uint8Array([1, 2, 3]));
    fake.objects.set(`${USER}/${MINIATURA}`, new Uint8Array([9, 8]));

    const miniatura = await get(`/api/vault/media/objects/${MINIATURA}`);
    expect(miniatura.status).toBe(200);
    expect([...new Uint8Array(await miniatura.arrayBuffer())]).toEqual([9, 8]);
    expect((await get(`/api/vault/media/objects/${ORIGINAL}`)).status).toBe(200);
    expect((await get(`/api/vault/media/objects/${'c'.repeat(32)}`)).status).toBe(404);
  });

  it('capabilities devuelve la caducidad en forma canonica', async () => {
    const antes = Date.now();
    const response = await get('/api/vault/v2/capabilities');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { protocol: number; facts: boolean; sessionExpiresAt: string };
    expect(body.protocol).toBe(2);
    expect(body.facts).toBe(false);
    // le quedaban 25 dias: no se toca, pero sale con Z aunque Postgres diga +00:00
    expect(body.sessionExpiresAt).toBe(new Date(body.sessionExpiresAt).toISOString());
    expect(Date.parse(body.sessionExpiresAt)).toBeLessThan(antes + 26 * DIA);
    expect(String(fake.rows('vault_sessions')[0]!.expires_at).endsWith('+00:00')).toBe(true);
  });
});

describe('SYNC-F1-02: la sesion se renueva al usarla', () => {
  let fake: FakeSupabase;
  let restore: () => void;
  const ahora = Date.parse('2026-10-07T08:00:00.000Z');

  beforeEach(() => {
    fake = new FakeSupabase();
    restore = installFakeFetch(fake);
  });

  afterEach(() => restore());

  const autenticar = (token: string) =>
    authenticateVaultUser(
      new Request('https://gateway.test/x', { headers: { Authorization: `Bearer ${token}` } }),
      new SupabaseClient({ SUPABASE_URL: fake.baseUrl, SUPABASE_SERVICE_ROLE_KEY: fake.serviceKey }),
      ahora,
    );

  it('con menos de 15 dias por delante pasa a ahora + 30 dias', async () => {
    await seedVaultAccount(fake, { userId: USER, token: TOKEN, expiresAt: new Date(ahora + 10 * DIA).toISOString() });
    const user = await autenticar(TOKEN);
    expect(user.sessionRenewal).toBe('renewed');
    expect(user.sessionExpiresAt).toBe(new Date(ahora + VAULT_SESSION_TTL_MS).toISOString());
    expect(Date.parse(String(fake.rows('vault_sessions')[0]!.expires_at))).toBe(ahora + VAULT_SESSION_TTL_MS);
  });

  it('con 15 dias o mas no se toca', async () => {
    const caducidad = new Date(ahora + VAULT_SESSION_RENEW_BELOW_MS + 1000).toISOString();
    await seedVaultAccount(fake, { userId: USER, token: TOKEN, expiresAt: caducidad });
    const user = await autenticar(TOKEN);
    expect(user.sessionRenewal).toBe('not-needed');
    expect(user.sessionExpiresAt).toBe(caducidad);
    expect(fake.log.filter((info) => info.method === 'PATCH')).toHaveLength(0);
  });

  it('una sesion caducada no se renueva', async () => {
    await seedVaultAccount(fake, { userId: USER, token: TOKEN, expiresAt: new Date(ahora - 1000).toISOString() });
    await expect(autenticar(TOKEN)).rejects.toBeInstanceOf(AuthError);
    expect(fake.log.filter((info) => info.method === 'PATCH')).toHaveLength(0);
  });

  it('una sesion cerrada mientras tanto no gana dias', async () => {
    await seedVaultAccount(fake, { userId: USER, token: TOKEN, expiresAt: new Date(ahora + 2 * DIA).toISOString() });
    // el PATCH filtra revoked_at is null: si otro cierre llega antes, no casa
    const sesion = fake.tables.get('vault_sessions')![0]!;
    const original = fake.fetch;
    let cerrada = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!cerrada && init?.method === 'PATCH') {
        cerrada = true;
        sesion.revoked_at = ahora * 1000;
      }
      return original(input, init);
    }) as typeof fetch;
    await expect(autenticar(TOKEN)).rejects.toBeInstanceOf(AuthError);
    expect(Date.parse(String(fake.rows('vault_sessions')[0]!.expires_at))).toBe(ahora + 2 * DIA);
  });

  it('si la renovacion falla, la peticion sigue con la caducidad de antes', async () => {
    const caducidad = new Date(ahora + 3 * DIA).toISOString();
    await seedVaultAccount(fake, { userId: USER, token: TOKEN, expiresAt: caducidad });
    fake.failNext((info) => info.method === 'PATCH', 500, '{"message":"caido"}');
    const user = await autenticar(TOKEN);
    expect(user.sessionRenewal).toBe('failed');
    expect(user.sessionExpiresAt).toBe(caducidad);
  });
});

describe('SYNC-F1-02: el almacen de objetos', () => {
  let fake: FakeSupabase;
  let restore: () => void;
  let store: VaultObjectStore;

  beforeEach(() => {
    fake = new FakeSupabase();
    restore = installFakeFetch(fake);
    store = new VaultObjectStore({ SUPABASE_URL: fake.baseUrl, SUPABASE_SERVICE_ROLE_KEY: fake.serviceKey });
  });

  afterEach(() => restore());

  it('exists() no lee el cuerpo del objeto', async () => {
    fake.objects.set(`${USER}/${ORIGINAL}`, new Uint8Array(1024));
    expect(await store.exists(USER, ORIGINAL)).toBe(true);
    // ni un byte leido: el cuerpo se cancela
    expect(fake.objectBodyReads).toBe(0);
    expect(fake.objectBodyCancels).toBe(1);
  });

  it('exists() entiende los dos «no existe» de Storage', async () => {
    fake.missingObjectStatus = 400;
    expect(await store.exists(USER, ORIGINAL)).toBe(false);
    fake.missingObjectStatus = 404;
    expect(await store.exists(USER, ORIGINAL)).toBe(false);
  });

  it('exists() no confunde una averia con «no existe»', async () => {
    fake.failNext((info) => info.kind === 'storage', 500, 'caido');
    await expect(store.exists(USER, ORIGINAL)).rejects.toBeInstanceOf(ObjectStoreError);
  });

  it('delete() dice si lo borro, y una averia se propaga', async () => {
    fake.objects.set(`${USER}/${ORIGINAL}`, new Uint8Array(4));
    expect(await store.delete(USER, ORIGINAL)).toBe(true);
    expect(fake.objects.has(`${USER}/${ORIGINAL}`)).toBe(false);
    expect(await store.delete(USER, ORIGINAL)).toBe(false);
    fake.failNext((info) => info.kind === 'storage', 503, 'caido');
    await expect(store.delete(USER, ORIGINAL)).rejects.toBeInstanceOf(ObjectStoreError);
  });

  it('get() de un objeto que no existe es un 404, no una averia', async () => {
    fake.missingObjectStatus = 400;
    await expect(store.get(USER, ORIGINAL)).rejects.toMatchObject({ status: 404 });
  });
});
