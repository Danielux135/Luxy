// pruebas de la sincronizacion v2 (SYNC-F1-03), con el Worker entero.
//
// Todo pasa por `worker.fetch` —enrutador, autenticacion, manejador,
// repositorio y cliente de Supabase— contra FakeSupabase, que responde como
// PostgREST y Storage: fechas con «+00:00» y la fraccion recortada, INSERT
// atomico con 409 (23505) y alias de columnas. Sin red y sin tokens.
//
// Las tres primeras pruebas reproducen los fallos de SEG-SYNC-001 tal como
// ocurrian. Contra el gateway anterior no podian pasar: la bajada devolvia la
// fecha de Postgres a un esquema que exigia «Z», la segunda subida respondia
// 200 con cero guardados y la bajada no pasaba de 200 (500 como mucho) turnos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VAULT_FACT_SEQUENCE_BASE,
  VAULT_MAX_OBJECT_BYTES,
  VAULT_SYNC_V2_LIMITS,
  VAULT_SYNC_V2_PATHS as PATHS,
  privateRecordSchema,
  vaultSyncV2CapabilitiesSchema,
  vaultV2ConversationListResponseSchema,
  vaultV2ManifestResponseSchema,
  vaultV2MediaListResponseSchema,
  vaultV2NextCursor,
  vaultV2PurgeResponseSchema,
  vaultV2PushRejectedResponseSchema,
  vaultV2PushStoredResponseSchema,
  vaultV2RecordsFetchResponseSchema,
} from '@luxy/shared';
import worker from '../index.js';
import type { Env } from '../env.js';
import { VAULT_STORAGE_DEFAULT_OBJECT_MAX_BYTES } from '../object-store.js';
import { FakeSupabase, fakeEnv, installFakeFetch, seedVaultAccount } from '../fake-supabase.fixture.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'sesion-de-prueba-del-usuario-uno';
const OTHER_TOKEN = 'sesion-de-prueba-del-usuario-dos';
const DIA = 24 * 60 * 60 * 1000;

// ids deterministas, todos con forma de uuid v4. Ninguno puede aparecer en un
// registro del gateway: lo comprueba el afterEach
const conv = (n: number): string => `${n.toString(16).padStart(8, '0')}-c0c0-4000-8000-000000000000`;
const rid = (conversation: number, sequence: number): string =>
  `${sequence.toString(16).padStart(8, '0')}-0000-4000-8000-${conversation.toString(16).padStart(12, '0')}`;
const mid = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-9000-000000000000`;
const okey = (prefix: 'a' | 'b', n: number): string => `${prefix}${n.toString(16).padStart(31, '0')}`;
const ID_EN_REGISTRO = /-c0c0-4000-8000-|-0000-4000-[89]000-|[ab]0{20,}/;

const sobre = (purpose: string, ciphertext: string) => ({
  version: 1,
  purpose,
  nonce: 'QLBVV_RjvTFFlpRx',
  ciphertext,
});

const turno = (conversation: number, sequence: number, overrides: Record<string, unknown> = {}) => ({
  recordId: rid(conversation, sequence),
  conversationId: conv(conversation),
  privacy: 'private',
  sequence,
  content: sobre('vault.conversation', `turno${sequence}`),
  sealedMemory: null,
  createdAt: new Date(Date.UTC(2026, 8, 1, 14, 0, 0, sequence % 1000)).toISOString(),
  ...overrides,
});

const ref = (record: { sequence: number; recordId: string }) => ({
  sequence: record.sequence,
  recordId: record.recordId,
});

const medio = (conversation: number, n: number, overrides: Record<string, unknown> = {}) => ({
  mediaId: mid(n),
  conversationId: conv(conversation),
  objectKey: okey('a', n),
  byteSize: 3,
  content: sobre('vault.media', `medio${n}`),
  thumbnailObjectKey: okey('b', n),
  createdAt: '2026-09-01T14:33:21.073Z',
  ...overrides,
});

let fake: FakeSupabase;
let restore: () => void;
let logs: string[];

beforeEach(async () => {
  fake = new FakeSupabase();
  restore = installFakeFetch(fake);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
  const expiresAt = new Date(Date.now() + 25 * DIA).toISOString();
  await seedVaultAccount(fake, { userId: USER, token: TOKEN, expiresAt });
  await seedVaultAccount(fake, { userId: OTHER, token: OTHER_TOKEN, expiresAt });
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
  // regla del gateway: en los registros, el usuario y recuentos. Nunca un id
  // de conversacion, de turno, de medio ni una clave de objeto
  for (const line of logs) {
    expect(line, line).not.toMatch(ID_EN_REGISTRO);
    expect(() => JSON.parse(line)).not.toThrow();
  }
});

interface CallOptions {
  token?: string | null;
  method?: string;
  headers?: Record<string, string>;
  raw?: BodyInit;
  /** variables del Worker que cambian para esta llamada */
  env?: Partial<Env>;
}

async function call(path: string, body?: unknown, options: CallOptions = {}): Promise<Response> {
  const token = options.token === undefined ? TOKEN : options.token;
  const method = options.method ?? (body === undefined && options.raw === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = {
    ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };
  const init: Record<string, unknown> = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (options.raw !== undefined) {
    init.body = options.raw;
    init.duplex = 'half';
  }
  return worker.fetch(
    new Request(`https://gateway.test${path}`, init as RequestInit),
    { ...fakeEnv(fake), ...options.env },
    {} as never,
  );
}

async function push(
  conversation: number,
  records: unknown[],
  base: { sequence: number; recordId: string } | null,
  token = TOKEN,
): Promise<Response> {
  return call(PATHS.recordsPush, { conversationId: conv(conversation), base, records }, { token });
}

/** sube 0..total-1 en lotes de 40, encadenando la base como hara Studio */
async function pushAll(conversation: number, total: number): Promise<void> {
  let base: { sequence: number; recordId: string } | null = null;
  for (let start = 0; start < total; start += VAULT_SYNC_V2_LIMITS.pushMaxRecords) {
    const end = Math.min(start + VAULT_SYNC_V2_LIMITS.pushMaxRecords, total);
    const records = Array.from({ length: end - start }, (_v, i) => turno(conversation, start + i));
    const response = await push(conversation, records, base);
    expect(response.status, await response.clone().text()).toBe(200);
    base = ref(records[records.length - 1]!);
  }
}

async function manifest(
  conversation: number,
  after = -1,
  limit: number = VAULT_SYNC_V2_LIMITS.manifestMaxPage,
  token = TOKEN,
) {
  const response = await call(PATHS.manifest, { conversationId: conv(conversation), after, limit }, { token });
  expect(response.status).toBe(200);
  return vaultV2ManifestResponseSchema.parse(await response.json());
}

async function uploadBytes(key: string): Promise<void> {
  const bytes = new Uint8Array([1, 2, 3]);
  const response = await call(`/api/vault/media/objects/${key}`, undefined, {
    method: 'PUT',
    raw: bytes,
    headers: { 'Content-Length': String(bytes.byteLength) },
  });
  expect(response.status).toBe(200);
}

const storedSequences = (conversation: number): number[] =>
  fake
    .rows('vault_records')
    .filter((row) => row.conversation_id === conv(conversation))
    .map((row) => row.sequence as number)
    .sort((a, b) => a - b);

// -----------------------------------------------------------------------------
// SEG-SYNC-001: los tres fallos, reproducidos
// -----------------------------------------------------------------------------

describe('SEG-SYNC-001', () => {
  it('fallo 1, fechas: lo que baja con «+00:00» vuelve a ser la cadena exacta que subio', async () => {
    const original = '2026-09-01T14:33:21.120Z';
    expect((await push(1, [turno(1, 0, { createdAt: original })], null)).status).toBe(200);

    const response = await call(PATHS.recordsFetch, { conversationId: conv(1), sequences: [0] });
    const raw = await response.text();
    // asi lo escribe Postgres, y asi llega: el gateway no lo toca
    expect(raw).toContain('"createdAt":"2026-09-01T14:33:21.12+00:00"');

    const [row] = JSON.parse(raw) as Array<Record<string, unknown>>;
    // con el contrato v1 la sincronizacion se cortaba aqui
    expect(privateRecordSchema.safeParse({ ...row, privacy: 'private' }).success).toBe(false);
    // con el v2 sale la cadena original, byte a byte (la atadura de D-108)
    const [record] = vaultV2RecordsFetchResponseSchema.parse(JSON.parse(raw));
    expect(record?.createdAt).toBe(original);
    expect(record?.recordId).toBe(rid(1, 0));
  });

  it('fallo 2, congelacion: la segunda subida no responde 200 con cero guardados', async () => {
    expect((await push(1, [turno(1, 0), turno(1, 1), turno(1, 2)], null)).status).toBe(200);

    // lo que hacia la v1: reenviar todo. Ahora es un 409 que explica cada uno
    const again = await push(1, [0, 1, 2, 3, 4].map((s) => turno(1, s)), null);
    expect(again.status).toBe(409);
    const rejected = vaultV2PushRejectedResponseSchema.parse(await again.json());
    expect(rejected.reason).toBe('records');
    expect(rejected.reason === 'records' && rejected.results.map((r) => r.outcome)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
      'pending',
      'pending',
    ]);
    expect(storedSequences(1)).toEqual([0, 1, 2]);

    // y lo nuevo, con su base, entra
    const rest = await push(1, [turno(1, 3), turno(1, 4)], ref(turno(1, 2)));
    expect(rest.status).toBe(200);
    expect(vaultV2PushStoredResponseSchema.parse(await rest.json()).results).toHaveLength(2);
    expect(storedSequences(1)).toEqual([0, 1, 2, 3, 4]);
  });

  it('fallo 3, el tope de 200: una conversacion de 450 turnos sube y baja entera', async () => {
    await pushAll(1, 450);
    expect(storedSequences(1)).toHaveLength(450);

    const all = await manifest(1);
    expect(all.map((entry) => entry.sequence)).toEqual(Array.from({ length: 450 }, (_v, i) => i));
    expect(all.every((entry) => entry.recordId === rid(1, entry.sequence))).toBe(true);

    // por paginas de 200, con el cursor del contrato: se acaba con la vacia
    const pages: number[] = [];
    let after = -1;
    for (;;) {
      const page = await manifest(1, after, 200);
      pages.push(page.length);
      const next = vaultV2NextCursor(page, (entry) => entry.sequence);
      if (next === null) break;
      after = next;
    }
    expect(pages).toEqual([200, 200, 50, 0]);

    // y los registros, de 100 en 100
    const fetched: string[] = [];
    for (let start = 0; start < 450; start += 100) {
      const sequences = Array.from({ length: Math.min(100, 450 - start) }, (_v, i) => start + i);
      const response = await call(PATHS.recordsFetch, { conversationId: conv(1), sequences });
      expect(response.status).toBe(200);
      for (const record of vaultV2RecordsFetchResponseSchema.parse(await response.json())) {
        fetched.push(record.recordId);
      }
    }
    expect(fetched).toEqual(Array.from({ length: 450 }, (_v, i) => rid(1, i)));
  });

  it('el recorte de «Max rows» no se cuela como manifiesto entero (F1-R1-02)', async () => {
    // PostgREST recorta a su «Max rows» sin avisar y responde 200. Aqui, a 20
    // para no sembrar mil filas: es la misma situacion que una conversacion de
    // 1500 turnos contra los 1000 por defecto de Supabase
    await pushAll(1, 30);
    fake.maxRows = 20;

    const first = await manifest(1);
    // el gateway reenvia lo que le dan: 20, aunque se pidieran 1000
    expect(first).toHaveLength(20);

    // y el cursor del contrato no se para en esa pagina corta
    const all: number[] = [];
    let after = -1;
    for (;;) {
      const page = await manifest(1, after);
      all.push(...page.map((entry) => entry.sequence));
      const next = vaultV2NextCursor(page, (entry) => entry.sequence);
      if (next === null) break;
      after = next;
    }
    expect(all).toEqual(Array.from({ length: 30 }, (_v, i) => i));
  });
});

// -----------------------------------------------------------------------------
// v1 cerrada, v2 con sesion
// -----------------------------------------------------------------------------

describe('la v1 esta cerrada', () => {
  const v1: Array<[string, string]> = [
    ['POST', '/api/vault/records'],
    ['GET', '/api/vault/conversations'],
    ['GET', `/api/vault/conversations/${conv(1)}`],
    ['GET', '/api/vault/media'],
    ['POST', '/api/vault/media'],
    ['POST', `/api/vault/conversations/${conv(1)}/delete`],
  ];

  it.each(v1)('%s %s responde 426 sin token y sin tocar Supabase', async (method, path) => {
    const response = await call(path, method === 'POST' ? { records: [] } : undefined, { token: null, method });
    expect(response.status).toBe(426);
    expect(fake.log).toHaveLength(0);
  });

  it.each(v1)('%s %s responde 426 tambien con una sesion valida', async (method, path) => {
    const response = await call(path, method === 'POST' ? { records: [turno(1, 0)] } : undefined, { method });
    expect(response.status).toBe(426);
    expect(fake.log).toHaveLength(0);
    expect(fake.rows('vault_records')).toHaveLength(0);
  });

  it('las rutas de objetos siguen como estaban', async () => {
    expect((await call(`/api/vault/media/objects/${okey('a', 1)}`, undefined, { token: null })).status).toBe(401);
  });
});

describe('la v2 exige sesion', () => {
  const v2: Array<[string, string]> = [
    ['GET', PATHS.capabilities],
    ['POST', PATHS.conversationsList],
    ['POST', PATHS.manifest],
    ['POST', PATHS.recordsFetch],
    ['POST', PATHS.recordsPush],
    ['POST', PATHS.mediaList],
    ['POST', PATHS.mediaPush],
    ['POST', PATHS.purge],
  ];

  it.each(v2)('%s %s sin token: 401', async (method, path) => {
    const response = await call(path, method === 'POST' ? {} : undefined, { token: null, method });
    expect(response.status).toBe(401);
  });

  it('capabilities cumple su contrato', async () => {
    const response = await call(PATHS.capabilities);
    expect(response.status).toBe(200);
    const parsed = vaultSyncV2CapabilitiesSchema.parse(await response.json());
    expect(parsed.facts).toBe(false);
    // todos los del protocolo menos el de un archivo, que es el del almacen
    expect(parsed.limits).toEqual({
      ...VAULT_SYNC_V2_LIMITS,
      objectMaxBytes: VAULT_STORAGE_DEFAULT_OBJECT_MAX_BYTES,
    });
  });
});

// -----------------------------------------------------------------------------
// el tope de un archivo es el del almacen (GW-R2-01)
// -----------------------------------------------------------------------------

describe('el tope de un archivo', () => {
  const putObject = (bytes: Uint8Array, env?: Partial<Env>, declare = true): Promise<Response> =>
    call(`/api/vault/media/objects/${okey('a', 1)}`, undefined, {
      method: 'PUT',
      raw: bytes,
      headers: declare ? { 'Content-Length': String(bytes.byteLength) } : {},
      ...(env === undefined ? {} : { env }),
    });

  async function announced(env?: Partial<Env>): Promise<number> {
    const response = await call(PATHS.capabilities, undefined, env === undefined ? {} : { env });
    expect(response.status).toBe(200);
    return vaultSyncV2CapabilitiesSchema.parse(await response.json()).limits.objectMaxBytes;
  }

  it.each([400, 413] as const)(
    'Storage lo rechaza por tamaño (%i): 413 y no 502, para que Studio lo salte en vez de reintentarlo siempre',
    async (status) => {
      // el plan gratuito de Supabase no guarda un archivo de mas de 50 MB, y un
      // 502 hacia que Studio lo subiera entero otra vez en cada pasada
      fake.objectSizeLimit = 2;
      fake.oversizeStatus = status;
      const response = await putObject(new Uint8Array([1, 2, 3]));
      expect(response.status).toBe(413);
      expect(await response.text()).not.toContain('Payload too large');
      expect(fake.objects.size).toBe(0);
      expect(logs.some((line) => line.includes('rechazo un objeto de boveda por su tamaño'))).toBe(true);
    },
  );

  it('otro rechazo de Storage sigue siendo un 502', async () => {
    fake.failNext((info) => info.kind === 'storage', 400, JSON.stringify({ statusCode: '500', error: 'x' }));
    expect((await putObject(new Uint8Array([1, 2, 3]))).status).toBe(502);
  });

  it('capabilities anuncia el tope del almacen, no los 90 MiB del protocolo', async () => {
    // sin configurar: los 50 MB del plan gratuito, por debajo de lo que admite
    expect(await announced()).toBe(50_000_000);
    expect(VAULT_STORAGE_DEFAULT_OBJECT_MAX_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);
    expect(await announced({ VAULT_OBJECT_MAX_BYTES: '1000' })).toBe(1000);
    // nunca por encima del cuerpo de un Worker, lo configure quien lo configure
    expect(await announced({ VAULT_OBJECT_MAX_BYTES: String(VAULT_MAX_OBJECT_BYTES * 4) })).toBe(VAULT_MAX_OBJECT_BYTES);
    expect(await announced({ VAULT_OBJECT_MAX_BYTES: 'mucho' })).toBe(VAULT_STORAGE_DEFAULT_OBJECT_MAX_BYTES);
  });

  it('la subida hace cumplir ese mismo tope sin tocar Storage, lo declare o no', async () => {
    const env = { VAULT_OBJECT_MAX_BYTES: '2' };
    expect((await putObject(new Uint8Array([1, 2, 3]), env)).status).toBe(413);
    expect((await putObject(new Uint8Array([1, 2, 3]), env, false)).status).toBe(413);
    expect(fake.log.filter((info) => info.kind === 'storage')).toHaveLength(0);
    expect((await putObject(new Uint8Array([1, 2]), env)).status).toBe(200);
  });
});

// -----------------------------------------------------------------------------
// subida de turnos
// -----------------------------------------------------------------------------

describe('subida de turnos', () => {
  it('un lote con un conflicto no inserta nada y clasifica cada registro', async () => {
    await pushAll(1, 5);
    const lote = [
      turno(1, 3), // ya esta igual
      turno(1, 4, { recordId: rid(9, 4) }), // la secuencia la tiene otro registro
      turno(1, 5), // habria entrado
      turno(1, 6, { recordId: rid(1, 1) }), // ese recordId ya esta en la secuencia 1
    ];
    const response = await push(1, lote, ref(turno(1, 2)));
    expect(response.status).toBe(409);
    const body = vaultV2PushRejectedResponseSchema.parse(await response.json());
    expect(body.reason === 'records' && body.results).toEqual([
      { recordId: rid(1, 3), sequence: 3, outcome: 'duplicate' },
      { recordId: rid(9, 4), sequence: 4, outcome: 'conflict' },
      { recordId: rid(1, 5), sequence: 5, outcome: 'pending' },
      { recordId: rid(1, 1), sequence: 6, outcome: 'conflict' },
    ]);
    // nada del lote entro: ni el 5, que no chocaba
    expect(storedSequences(1)).toEqual([0, 1, 2, 3, 4]);
  });

  it('una base distinta de la del servidor: 409 sin insertar', async () => {
    await pushAll(1, 5);
    // el que precede al 5 en el servidor es el 4, no el 3
    const response = await push(1, [turno(1, 5)], ref(turno(1, 3)));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { reason: string }).reason).toBe('base-mismatch');
    // y sin base, cuando el servidor si tiene algo delante, tampoco
    const sinBase = await push(1, [turno(1, 5)], null);
    expect(((await sinBase.json()) as { reason: string }).reason).toBe('base-mismatch');
    expect(storedSequences(1)).toEqual([0, 1, 2, 3, 4]);
  });

  it('una base con el mismo numero pero otro registro tampoco casa', async () => {
    await pushAll(1, 3);
    const response = await push(1, [turno(1, 3)], { sequence: 2, recordId: rid(9, 2) });
    expect(((await response.json()) as { reason: string }).reason).toBe('base-mismatch');
  });

  it('rellenar un hueco es legitimo: la base es la que precede al hueco', async () => {
    await pushAll(1, 3);
    expect((await push(1, [turno(1, 5), turno(1, 6)], ref(turno(1, 2)))).status).toBe(200);
    expect((await push(1, [turno(1, 3), turno(1, 4)], ref(turno(1, 2)))).status).toBe(200);
    expect(storedSequences(1)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('una conversacion que no existe con base no nula: 409 y no se crea', async () => {
    const response = await push(2, [turno(2, 5)], ref(turno(2, 4)));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { reason: string }).reason).toBe('conversation-missing');
    expect(fake.rows('vault_conversations')).toHaveLength(0);
    expect(fake.rows('vault_records')).toHaveLength(0);
  });

  it('subir turnos a un espacio de hechos: 409', async () => {
    fake.seed('vault_conversations', [{ conversation_id: conv(3), owner_user_id: USER }]);
    fake.seed('vault_records', [
      {
        record_id: rid(3, 7),
        owner_user_id: USER,
        conversation_id: conv(3),
        sequence: VAULT_FACT_SEQUENCE_BASE,
        content: sobre('vault.conversation', 'hecho'),
      },
    ]);
    const response = await push(3, [turno(3, 0)], null);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { reason: string }).reason).toBe('space');
    expect(storedSequences(3)).toEqual([VAULT_FACT_SEQUENCE_BASE]);
  });

  it('la conversacion de otro usuario: 404 sin insertar nada', async () => {
    await pushAll(1, 2);
    const ajena = await push(1, [turno(1, 2, { recordId: rid(5, 2) })], ref(turno(1, 1)), OTHER_TOKEN);
    expect(ajena.status).toBe(404);
    const sinBase = await push(1, [turno(1, 0, { recordId: rid(5, 0) })], null, OTHER_TOKEN);
    expect(sinBase.status).toBe(404);
    expect(storedSequences(1)).toEqual([0, 1]);
    expect(fake.rows('vault_conversations').map((row) => row.owner_user_id)).toEqual([USER]);
  });

  it('el rango reservado, un proposito ajeno o un campo en claro: 422', async () => {
    const reservado = await push(1, [turno(1, VAULT_FACT_SEQUENCE_BASE, { recordId: rid(1, 1) })], null);
    expect(reservado.status).toBe(422);
    const proposito = await push(1, [turno(1, 0, { content: sobre('vault.media', 'x') })], null);
    expect(proposito.status).toBe(422);
    const titulo = await push(1, [turno(1, 0, { title: 'revelador' })], null);
    expect(titulo.status).toBe(422);
    expect(((await titulo.json()) as { error: string }).error).toContain('title');
    expect(fake.rows('vault_records')).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// topes por bytes
// -----------------------------------------------------------------------------

describe('topes', () => {
  it('Content-Length de mas: 413 sin leer el cuerpo', async () => {
    const response = await call(PATHS.recordsPush, { conversationId: conv(1), base: null, records: [turno(1, 0)] }, {
      headers: { 'Content-Length': String(VAULT_SYNC_V2_LIMITS.pushSingleRecordMaxBytes + 1) },
    });
    expect(response.status).toBe(413);
    expect(fake.rows('vault_records')).toHaveLength(0);
  });

  it('un cuerpo sin Content-Length que se pasa se corta: 413', async () => {
    const trozo = new TextEncoder().encode('x'.repeat(64 * 1024));
    let enviados = 0;
    const flujo = new ReadableStream<Uint8Array>({
      pull(controller) {
        // 5 MiB en trozos: el gateway tiene que cortar antes del final
        if (enviados >= 80) {
          controller.close();
          return;
        }
        enviados += 1;
        controller.enqueue(trozo);
      },
    });
    const response = await call(PATHS.recordsPush, undefined, { method: 'POST', raw: flujo });
    expect(response.status).toBe(413);
    expect(enviados).toBeLessThan(80);
  });

  it('un lote de varios registros pasa de 512 KiB: 413', async () => {
    const grande = 'A'.repeat(300 * 1024);
    const response = await push(
      1,
      [turno(1, 0, { content: sobre('vault.conversation', grande) }), turno(1, 1, { content: sobre('vault.conversation', grande) })],
      null,
    );
    expect(response.status).toBe(413);
    expect(fake.rows('vault_records')).toHaveLength(0);
  });

  it('un registro solo de 3 MiB entra', async () => {
    const response = await push(1, [turno(1, 0, { content: sobre('vault.conversation', 'A'.repeat(3 * 1024 * 1024)) })], null);
    expect(response.status).toBe(200);
    expect(storedSequences(1)).toEqual([0]);
  });

  it('las peticiones pequeñas tienen su propio tope', async () => {
    const response = await call(PATHS.manifest, { conversationId: conv(1), relleno: 'x'.repeat(20 * 1024) });
    expect(response.status).toBe(413);
  });

  it('un limite por encima del maximo se rechaza, no se recorta', async () => {
    expect((await call(PATHS.manifest, { conversationId: conv(1), limit: 2001 })).status).toBe(422);
    expect((await call(PATHS.conversationsList, { limit: 501 })).status).toBe(422);
    expect((await call(PATHS.mediaList, { limit: 501 })).status).toBe(422);
    expect((await call(PATHS.recordsFetch, { conversationId: conv(1), sequences: Array.from({ length: 101 }, (_v, i) => i) })).status).toBe(422);
  });
});

// -----------------------------------------------------------------------------
// lecturas
// -----------------------------------------------------------------------------

describe('lecturas', () => {
  it('devuelven el cuerpo de Supabase byte a byte', async () => {
    await pushAll(1, 3);
    fake.seed('vault_media', [
      {
        media_id: mid(1),
        owner_user_id: USER,
        conversation_id: conv(1),
        object_key: okey('a', 1),
        byte_size: 3,
        content: sobre('vault.media', 'm'),
        thumbnail_object_key: null,
      },
    ]);
    const lecturas: Array<[string, unknown]> = [
      [PATHS.conversationsList, {}],
      [PATHS.manifest, { conversationId: conv(1) }],
      [PATHS.recordsFetch, { conversationId: conv(1), sequences: [0, 1, 2] }],
      [PATHS.mediaList, {}],
    ];
    for (const [path, body] of lecturas) {
      const response = await call(path, body);
      expect(response.status, path).toBe(200);
      const text = await response.text();
      expect(text, path).toBe(fake.readBodies[fake.readBodies.length - 1]);
      expect(text.length, path).toBeGreaterThan(2);
    }
    // y la prueba tiene dientes: el texto de PostgREST (json_agg, jsonb con
    // espacios) no es el que saldria de analizar y volver a serializar
    const fetched = await (await call(PATHS.recordsFetch, { conversationId: conv(1), sequences: [0, 1] })).text();
    expect(fetched).toContain(', \n ');
    expect(fetched).toContain('"nonce": ');
    expect(JSON.stringify(JSON.parse(fetched))).not.toBe(fetched);
  });

  it('cada lectura cumple su contrato', async () => {
    await pushAll(1, 2);
    const list = vaultV2ConversationListResponseSchema.parse(await (await call(PATHS.conversationsList, {})).json());
    expect(list).toEqual([
      expect.objectContaining({ conversationId: conv(1), turnCount: 2 }),
    ]);
    expect(list[0]!.updatedAt.endsWith('Z')).toBe(true);
  });

  it('la lista de conversaciones pagina por id', async () => {
    for (const n of [3, 1, 2]) await pushAll(n, 1);
    const first = vaultV2ConversationListResponseSchema.parse(
      await (await call(PATHS.conversationsList, { limit: 2 })).json(),
    );
    expect(first.map((entry) => entry.conversationId)).toEqual([conv(1), conv(2)]);
    const after = vaultV2NextCursor(first, (entry) => entry.conversationId);
    const second = vaultV2ConversationListResponseSchema.parse(
      await (await call(PATHS.conversationsList, { after, limit: 2 })).json(),
    );
    expect(second.map((entry) => entry.conversationId)).toEqual([conv(3)]);
    const third = vaultV2ConversationListResponseSchema.parse(
      await (
        await call(PATHS.conversationsList, {
          after: vaultV2NextCursor(second, (entry) => entry.conversationId),
          limit: 2,
        })
      ).json(),
    );
    expect(vaultV2NextCursor(third, (entry) => entry.conversationId)).toBeNull();
  });

  it('el manifiesto no ensena el rango reservado', async () => {
    await pushAll(1, 2);
    fake.seed('vault_records', [
      {
        record_id: rid(1, 99),
        owner_user_id: USER,
        conversation_id: conv(1),
        sequence: VAULT_FACT_SEQUENCE_BASE + 1,
        content: sobre('vault.conversation', 'hecho'),
      },
    ]);
    expect((await manifest(1)).map((entry) => entry.sequence)).toEqual([0, 1]);
    // y pedirlo por secuencia no es un turno: el contrato lo rechaza
    expect((await call(PATHS.recordsFetch, { conversationId: conv(1), sequences: [VAULT_FACT_SEQUENCE_BASE + 1] })).status).toBe(422);
  });

  it('lo de otra cuenta sale vacio, sin decir si existe', async () => {
    await pushAll(1, 2);
    expect(await manifest(1, -1, VAULT_SYNC_V2_LIMITS.manifestMaxPage, OTHER_TOKEN)).toEqual([]);
    const fetched = await call(PATHS.recordsFetch, { conversationId: conv(1), sequences: [0, 1] }, { token: OTHER_TOKEN });
    expect(await fetched.text()).toBe('[]');
    expect(await (await call(PATHS.conversationsList, {}, { token: OTHER_TOKEN })).text()).toBe('[]');
  });

  it('la lista de medios solo enseña los de la cuenta de la sesion (T2R-03)', async () => {
    // la unica barrera de esa ruta es el filtro por dueño del repositorio: sin
    // el, cualquier sesion veia los medios de todas las cuentas
    fake.seed('vault_conversations', [
      { conversation_id: conv(1), owner_user_id: USER },
      { conversation_id: conv(2), owner_user_id: OTHER },
    ]);
    const fila = (n: number, owner: string, conversation: number) => ({
      media_id: mid(n),
      owner_user_id: owner,
      conversation_id: conv(conversation),
      object_key: okey('a', n),
      byte_size: 3,
      content: sobre('vault.media', `m${n}`),
      thumbnail_object_key: null,
    });
    fake.seed('vault_media', [fila(1, USER, 1), fila(2, OTHER, 2)]);

    const visto = async (token: string): Promise<string[]> => {
      const response = await call(PATHS.mediaList, {}, { token });
      expect(response.status).toBe(200);
      return vaultV2MediaListResponseSchema.parse(await response.json()).map((entry) => entry.mediaId);
    };
    expect(await visto(TOKEN)).toEqual([mid(1)]);
    expect(await visto(OTHER_TOKEN)).toEqual([mid(2)]);
    // y paginando desde el principio tampoco se cuela la otra
    const after = await call(PATHS.mediaList, { after: mid(0) }, { token: OTHER_TOKEN });
    expect(vaultV2MediaListResponseSchema.parse(await after.json()).map((entry) => entry.mediaId)).toEqual([mid(2)]);
  });

  it('un uuid en mayusculas se rechaza: Postgres lo devolveria distinto', async () => {
    const response = await call(PATHS.manifest, { conversationId: conv(10).toUpperCase() });
    expect(response.status).toBe(422);
  });
});

// -----------------------------------------------------------------------------
// fallos reales
// -----------------------------------------------------------------------------

describe('un fallo real', () => {
  const SECRETO = 'detalle-interno-del-servidor-que-no-debe-salir';

  it('en una lectura da 502 sin el cuerpo de Supabase', async () => {
    await pushAll(1, 1);
    fake.failNext(
      (info) => info.method === 'GET' && info.target === 'vault_records',
      500,
      JSON.stringify({ code: 'XX000', message: SECRETO, details: `Key (conversation_id)=(${conv(1)})` }),
    );
    const response = await call(PATHS.manifest, { conversationId: conv(1) });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain(SECRETO);
    expect(text).not.toContain(conv(1));
    expect(logs.join('\n')).not.toContain(SECRETO);
    expect(logs.some((line) => line.includes('"supabaseCode":"XX000"'))).toBe(true);
  });

  it('en la subida da 502, no un 200 con cero', async () => {
    fake.failNext((info) => info.method === 'POST' && info.target === 'vault_records', 500, SECRETO);
    const response = await push(1, [turno(1, 0)], null);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(SECRETO);
    expect(storedSequences(1)).toEqual([]);
  });

  it('del almacen al dar de alta un medio da 502', async () => {
    await pushAll(1, 1);
    fake.failNext((info) => info.kind === 'storage', 500, SECRETO);
    const response = await call(PATHS.mediaPush, { media: medio(1, 1) });
    expect(response.status).toBe(502);
    expect(fake.rows('vault_media')).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// medios
// -----------------------------------------------------------------------------

describe('medios', () => {
  it('alta: stored, despues duplicate, y sin leer los bytes para comprobarlos', async () => {
    await pushAll(1, 1);
    await uploadBytes(okey('a', 1));
    await uploadBytes(okey('b', 1));
    const first = await call(PATHS.mediaPush, { media: medio(1, 1) });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ outcome: 'stored' });
    const again = await call(PATHS.mediaPush, { media: medio(1, 1) });
    expect(await again.json()).toEqual({ outcome: 'duplicate' });
    expect(fake.objectBodyReads).toBe(0);
  });

  it('sin los bytes del original o de la miniatura: 409 object-missing', async () => {
    await pushAll(1, 1);
    const sinNada = await call(PATHS.mediaPush, { media: medio(1, 1) });
    expect(sinNada.status).toBe(409);
    expect(((await sinNada.json()) as { reason: string }).reason).toBe('object-missing');
    await uploadBytes(okey('a', 1));
    const sinMiniatura = await call(PATHS.mediaPush, { media: medio(1, 1) });
    expect(((await sinMiniatura.json()) as { reason: string }).reason).toBe('object-missing');
    expect(fake.rows('vault_media')).toHaveLength(0);
  });

  it('no crea la conversacion, no entra en la de otro ni en un espacio', async () => {
    await uploadBytes(okey('a', 1));
    await uploadBytes(okey('b', 1));
    const sinConversacion = await call(PATHS.mediaPush, { media: medio(1, 1) });
    expect(((await sinConversacion.json()) as { reason: string }).reason).toBe('conversation-missing');
    expect(fake.rows('vault_conversations')).toHaveLength(0);

    await pushAll(1, 1);
    expect((await call(PATHS.mediaPush, { media: medio(1, 1) }, { token: OTHER_TOKEN })).status).toBe(404);

    fake.seed('vault_records', [
      {
        record_id: rid(1, 50),
        owner_user_id: USER,
        conversation_id: conv(1),
        sequence: VAULT_FACT_SEQUENCE_BASE,
        content: sobre('vault.conversation', 'hecho'),
      },
    ]);
    const espacio = await call(PATHS.mediaPush, { media: medio(1, 1) });
    expect(((await espacio.json()) as { reason: string }).reason).toBe('space');
    expect(fake.rows('vault_media')).toHaveLength(0);
  });

  it('la misma clave con otro medio es un conflicto, no un «ya estaba»', async () => {
    await pushAll(1, 1);
    await uploadBytes(okey('a', 1));
    await uploadBytes(okey('b', 1));
    expect((await call(PATHS.mediaPush, { media: medio(1, 1) })).status).toBe(200);
    const otro = await call(PATHS.mediaPush, { media: medio(1, 2, { objectKey: okey('a', 1), thumbnailObjectKey: okey('b', 1) }) });
    expect(otro.status).toBe(409);
    expect(((await otro.json()) as { reason: string }).reason).toBe('conflict');
  });

  it('solo admite el proposito de medio', async () => {
    await pushAll(1, 1);
    const response = await call(PATHS.mediaPush, { media: medio(1, 1, { content: sobre('vault.conversation', 'x') }) });
    expect(response.status).toBe(422);
  });

  it('la lista pagina por mediaId pasando de 500', async () => {
    fake.seed('vault_conversations', [{ conversation_id: conv(1), owner_user_id: USER }]);
    fake.seed(
      'vault_media',
      Array.from({ length: 520 }, (_v, n) => ({
        media_id: mid(n),
        owner_user_id: USER,
        conversation_id: conv(1),
        object_key: okey('a', n),
        byte_size: 3,
        content: sobre('vault.media', `m${n}`),
        thumbnail_object_key: null,
      })),
    );
    const first = vaultV2MediaListResponseSchema.parse(await (await call(PATHS.mediaList, {})).json());
    expect(first).toHaveLength(500);
    const after = vaultV2NextCursor(first, (entry) => entry.mediaId);
    const second = vaultV2MediaListResponseSchema.parse(await (await call(PATHS.mediaList, { after })).json());
    expect(second.map((entry) => entry.mediaId)).toEqual(Array.from({ length: 20 }, (_v, i) => mid(500 + i)));
    expect(second[0]!.createdAt.endsWith('Z')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// purga
// -----------------------------------------------------------------------------

describe('purga por tandas', () => {
  async function seedConversationWithMedia(conversation: number, count: number): Promise<void> {
    await pushAll(conversation, 3);
    fake.seed(
      'vault_media',
      Array.from({ length: count }, (_v, n) => ({
        media_id: mid(n),
        owner_user_id: USER,
        conversation_id: conv(conversation),
        object_key: okey('a', n),
        byte_size: 3,
        content: sobre('vault.media', `m${n}`),
        thumbnail_object_key: okey('b', n),
      })),
    );
    for (let n = 0; n < count; n += 1) {
      fake.objects.set(`${USER}/${okey('a', n)}`, new Uint8Array([n]));
      fake.objects.set(`${USER}/${okey('b', n)}`, new Uint8Array([n]));
    }
  }

  it('avanza de 20 en 20 medios, deja la fila para el final y es idempotente', async () => {
    await seedConversationWithMedia(1, 45);
    const calls: Array<{ done: boolean; deletedObjects: number; subrequests: number }> = [];
    let after: string | null = null;
    for (;;) {
      const before = fake.log.length;
      const response = await call(PATHS.purge, { conversationId: conv(1), after });
      expect(response.status).toBe(200);
      const body = vaultV2PurgeResponseSchema.parse(await response.json());
      calls.push({ done: body.done, deletedObjects: body.deletedObjects, subrequests: fake.log.length - before });
      if (body.done) break;
      // mientras no termina, la conversacion sigue ahi
      expect(fake.rows('vault_conversations')).toHaveLength(1);
      after = body.after;
    }
    expect(calls.map((c) => [c.done, c.deletedObjects])).toEqual([
      [false, 40],
      [false, 40],
      [true, 10],
    ]);
    // por debajo de las 50 subpeticiones de un Worker, contando la autenticacion
    expect(Math.max(...calls.map((c) => c.subrequests))).toBeLessThanOrEqual(48);
    expect(fake.objects.size).toBe(0);
    expect(fake.rows('vault_conversations')).toHaveLength(0);
    expect(fake.rows('vault_records')).toHaveLength(0);
    expect(fake.rows('vault_media')).toHaveLength(0);

    const again = await call(PATHS.purge, { conversationId: conv(1), after: null });
    expect(vaultV2PurgeResponseSchema.parse(await again.json())).toEqual({ done: true, after: null, deletedObjects: 0 });
  });

  it('un objeto que ya no estaba no la detiene', async () => {
    await seedConversationWithMedia(1, 2);
    fake.objects.delete(`${USER}/${okey('a', 0)}`);
    const response = await call(PATHS.purge, { conversationId: conv(1), after: null });
    expect(vaultV2PurgeResponseSchema.parse(await response.json())).toEqual({ done: true, after: null, deletedObjects: 3 });
  });

  it('un fallo del almacen no avanza el cursor ni borra la fila', async () => {
    await seedConversationWithMedia(1, 2);
    fake.failNext((info) => info.kind === 'storage' && info.method === 'DELETE', 500, 'caido');
    const response = await call(PATHS.purge, { conversationId: conv(1), after: null });
    expect(response.status).toBe(502);
    expect(fake.rows('vault_conversations')).toHaveLength(1);
  });

  it('la de otro: 404; un espacio: 409', async () => {
    await seedConversationWithMedia(1, 1);
    expect((await call(PATHS.purge, { conversationId: conv(1) }, { token: OTHER_TOKEN })).status).toBe(404);
    expect(fake.objects.size).toBe(2);

    fake.seed('vault_records', [
      {
        record_id: rid(1, 77),
        owner_user_id: USER,
        conversation_id: conv(1),
        sequence: VAULT_FACT_SEQUENCE_BASE,
        content: sobre('vault.conversation', 'hecho'),
      },
    ]);
    const espacio = await call(PATHS.purge, { conversationId: conv(1) });
    expect(espacio.status).toBe(409);
    expect(fake.rows('vault_conversations')).toHaveLength(1);
  });
});
