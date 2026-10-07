// el gateway DE VERDAD, con un Supabase falso, para las pruebas de la
// sincronizacion de Studio (`SYNC-F1-06`).
//
// Por que el Worker entero y no un objeto que imite sus respuestas. Las 84
// pruebas de la v1 pasaban con los tres fallos de SEG-SYNC-001 dentro: el
// gateway falso respondia lo que el cliente esperaba, no lo que respondia el
// real. Aqui cada peticion de Studio entra en `worker.fetch` —enrutador,
// autenticacion, manejadores y repositorio— y acaba en `FakeSupabase`, que se
// comporta como PostgREST: fechas con «+00:00» y la fraccion recortada, INSERT
// atomico con 409 (23505), alias de columnas y paginas con limite. Sin red y
// sin tokens.
//
// Se importa por una ruta en una variable a proposito: el gateway es otro
// paquete, con otro `tsconfig` (Bundler y tipos de Workers), y lo que aqui
// importa es su comportamiento, no sus tipos.
import { vi } from 'vitest';

/** lo que se usa del doble de Supabase del gateway */
interface FakeSupabaseLike {
  fetch: typeof fetch;
  rows(table: string): Record<string, unknown>[];
  seed(table: string, values: Record<string, unknown>[]): void;
  failNext(
    match: (info: { method: string; kind: 'rest' | 'storage'; target: string; url: string }) => boolean,
    status: number,
    body: string,
  ): void;
  readonly objects: Map<string, Uint8Array>;
  /** las filas de cada tabla, para quitar algo a mano como lo perderia el servidor */
  readonly tables: Map<string, Record<string, unknown>[]>;
  /** «Max rows» de PostgREST: ninguna lectura devuelve mas, y no lo dice */
  maxRows: number;
  /** tope de un archivo en Storage; por encima responde «Payload too large» */
  objectSizeLimit: number;
  /** como lo responde: 400 con statusCode "413" (versiones viejas) o 413 */
  oversizeStatus: 400 | 413;
}

interface GatewayFixtureModule {
  FakeSupabase: new () => FakeSupabaseLike;
  fakeEnv(fake: FakeSupabaseLike): unknown;
  seedVaultAccount(
    fake: FakeSupabaseLike,
    options: { userId: string; token: string; expiresAt: string },
  ): Promise<void>;
}

interface WorkerModule {
  default: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
}

const GATEWAY_INDEX = '../../../../gateway/src/index.ts';
const GATEWAY_FIXTURE = '../../../../gateway/src/fake-supabase.fixture.ts';

export const TEST_USER = '7e57a000-0000-4000-8000-000000000001';
export const TEST_TOKEN = 'sesion-de-prueba-de-studio-0001';

export interface GatewayCall {
  method: string;
  path: string;
  body: unknown;
  status: number;
}

/**
 * lo que una prueba puede hacer antes de que el Worker atienda: devolver otra
 * respuesta (un gateway viejo, una caida) o hacer algo a mitad (cerrar la
 * boveda). `undefined` deja pasar la peticion.
 */
export type GatewayInterceptor = (
  path: string,
  body: unknown,
  request: Request,
) => Response | undefined | Promise<Response | undefined>;

export interface TestGateway {
  fetchImpl: typeof fetch;
  calls: GatewayCall[];
  fake: FakeSupabaseLike;
  intercept: GatewayInterceptor | null;
  /** cambia lo que el Worker devolvio, ya leido: para falsear respuestas concretas */
  rewrite: ((path: string, status: number, body: unknown) => unknown) | null;
  /** registros de turnos guardados en el servidor */
  records(): { conversationId: string; sequence: number; recordId: string }[];
  media(): { mediaId: string; conversationId: string }[];
  stop(): void;
}

export async function startTestGateway(): Promise<TestGateway> {
  const fixturePath = GATEWAY_FIXTURE;
  const indexPath = GATEWAY_INDEX;
  const fixtures = (await import(/* @vite-ignore */ fixturePath)) as GatewayFixtureModule;
  const workerModule = (await import(/* @vite-ignore */ indexPath)) as WorkerModule;
  const worker = workerModule.default;

  const fake = new fixtures.FakeSupabase();
  // el Worker habla con Supabase por el `fetch` global; Studio, por el suyo
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  // el gateway registra una linea por peticion: aqui solo seria ruido
  const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  await fixtures.seedVaultAccount(fake, {
    userId: TEST_USER,
    token: TEST_TOKEN,
    expiresAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const env = fixtures.fakeEnv(fake);

  const gateway: TestGateway = {
    calls: [],
    fake,
    intercept: null,
    rewrite: null,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init);
      const path = new URL(request.url).pathname;
      // el cuerpo se guarda para que las pruebas lo miren; uno vacio o que no es
      // JSON se apunta como null y el Worker decide que hacer con el
      let body: unknown = null;
      if (
        request.method !== 'GET' &&
        (request.headers.get('Content-Type') ?? '').includes('application/json')
      ) {
        try {
          body = JSON.parse(await request.clone().text());
        } catch {
          body = null;
        }
      }
      let response = (await gateway.intercept?.(path, body, request)) ?? undefined;
      if (response === undefined) response = await worker.fetch(request, env, {});
      if (gateway.rewrite !== null && (response.headers.get('Content-Type') ?? '').includes('json')) {
        const parsed: unknown = await response.json();
        const status = response.status;
        response = Response.json(gateway.rewrite(path, status, parsed), { status });
      }
      gateway.calls.push({ method: request.method, path, body, status: response.status });
      return response;
    }) as typeof fetch,
    records: () =>
      fake.rows('vault_records').map((row) => ({
        conversationId: String(row.conversation_id),
        sequence: Number(row.sequence),
        recordId: String(row.record_id),
      })),
    media: () =>
      fake.rows('vault_media').map((row) => ({
        mediaId: String(row.media_id),
        conversationId: String(row.conversation_id),
      })),
    stop: () => {
      globalThis.fetch = originalFetch;
      quiet.mockRestore();
    },
  };
  return gateway;
}
