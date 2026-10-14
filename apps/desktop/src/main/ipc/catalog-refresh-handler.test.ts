// el manejador `catalogRefresh`, de punta a punta menos la red.
//
// La orquestacion se prueba en `../catalog-refresh.test.ts`. Lo que solo puede
// romperse AQUI es el envoltorio: que la URL salga de la configuracion guardada
// y la clave del almacen —ninguna de las dos del renderer—, que sin clave no
// salga ninguna peticion, que dos pulsaciones a la vez sobre el mismo origen
// compartan un solo refresco, y que lo que se decide alli llegue de verdad al
// archivo que luego lee la pantalla. Las respuestas son INVENTADAS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatalogSnapshot } from '@luxy/shared';

const canales = vi.hoisted(
  () => new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
);

// electron no existe fuera de electron: solo hace falta lo que se toca al
// REGISTRAR, que es el registro de canales
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0', getPath: () => '' },
  dialog: {},
  shell: {},
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: {
    removeHandler: (channel: string) => {
      canales.delete(channel);
    },
    handle: (channel: string, fn: (event: unknown, args: unknown) => Promise<unknown>) => {
      canales.set(channel, fn);
    },
  },
  BrowserWindow: class {},
}));

const { registerIpcHandlers } = await import('./handlers.js');
const { IPC_INVOKE } = await import('../../shared/ipc.js');
const { readCatalogSnapshot, writeCatalogSnapshot } = await import('../catalog-store.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const NANO_KEY = 'clave-inventada-de-nanogpt-0123456789';
const GATEWAY_KEY = 'clave-inventada-de-la-pasarela-9876543210';

// una conexion y un proveedor HTTP se llaman igual a proposito: comparten
// espacio de nombres y cada uno tiene su URL, su clave y su catalogo
const CONFIG = {
  connections: [{ id: 'gemela', baseUrl: 'https://conexion.example/v1' }],
  providers: {
    http: [
      { id: 'nanogpt', baseUrl: 'https://api.nano-gpt.com/api/v1', apiKeyEnv: 'NANOGPT_API_KEY' },
      { id: 'gemela', baseUrl: 'https://proveedor.example/v1/', apiKeyEnv: 'GEMELA_API_KEY' },
    ],
  },
};

const DETAILED = {
  object: 'list',
  data: [
    {
      id: 'deepseek/deepseek-v4-pro',
      owned_by: 'deepseek',
      context_length: 128000,
      max_output_tokens: 64000,
      capabilities: { reasoning: true },
      reasoning_efforts: ['none', 'high', 'max'],
    },
    { id: 'TheDrummer/Cydonia-24B-v4.3', capabilities: { reasoning: false } },
  ],
};

interface Call {
  url: string;
  authorization: string | undefined;
}

type Result = { ok: true; value: CatalogSnapshot } | { ok: false; error: string };

let directory: string;
let calls: Call[];

/** registra los manejadores con estas claves y contesta la red con `reply` */
function montar(secrets: Record<string, string>, reply: (url: string) => Response): void {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, authorization: init.headers['Authorization'] });
    return reply(url);
  });
  const context = {
    configStore: { load: () => CONFIG },
    secretStore: { get: (name: string) => secrets[name] },
    catalogDirectory: directory,
    vault: {
      isUnlocked: () => false,
      onLock: () => () => undefined,
      beginUserWait: () => () => undefined,
    },
    log: () => undefined,
  } as unknown as HandlerContext;
  registerIpcHandlers(context);
}

async function refrescar(args: Record<string, unknown>): Promise<Result> {
  const handler = canales.get(IPC_INVOKE.catalogRefresh);
  if (handler === undefined) throw new Error('el canal del catalogo no se registro');
  return (await handler(null, args)) as Result;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'luxy-catalog-refresh-'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

describe('el manejador catalogRefresh', () => {
  it('pide a la URL guardada con la clave del almacen, y lo declarado llega al disco', async () => {
    montar({ NANOGPT_API_KEY: NANO_KEY }, () => json(200, DETAILED));

    // el renderer solo manda el identificador. Una URL o una clave coladas en
    // los argumentos no pueden elegir a quien entrega main la clave descifrada
    const result = await refrescar({
      connectionId: 'nanogpt',
      source: 'http',
      baseUrl: 'https://atacante.example/v1',
      apiKey: 'clave-del-renderer',
    });

    expect(calls).toEqual([
      {
        url: 'https://api.nano-gpt.com/api/v1/models?detailed=true',
        authorization: `Bearer ${NANO_KEY}`,
      },
    ]);
    expect(result.ok).toBe(true);
    // la clave no vuelve por el IPC ni se queda en el archivo
    expect(JSON.stringify(result)).not.toContain(NANO_KEY);
    expect(readFileSync(join(directory, 'http-nanogpt.json'), 'utf8')).not.toContain(NANO_KEY);

    // lo que lee la pantalla despues es el archivo, no el objeto en memoria:
    // un campo que el esquema de lectura no conociera se veria al pulsar el
    // boton y desapareceria al reabrir
    const saved = readCatalogSnapshot(directory, 'nanogpt', 'http');
    expect(saved?.detail).toBe('detailed');
    expect(saved?.notice).toBe('Luxy no lee los precios de NanoGPT.');
    expect(saved?.models[0]).toMatchObject({
      apiModel: 'deepseek/deepseek-v4-pro',
      reasoning: true,
      reasoningEfforts: ['none', 'high', 'max'],
      declaredOutputCap: 64000,
      declaredContext: 128000,
    });
    expect(saved?.models[1]).toMatchObject({ reasoning: false });
    expect(result.ok && result.value).toEqual(saved);
  });

  it('sin proveedor o sin clave no sale ninguna peticion, y un fallo llega con su codigo', async () => {
    montar({ GEMELA_API_KEY: GATEWAY_KEY }, () => json(429, { error: 'inventado' }));

    expect(await refrescar({ connectionId: 'no-existe', source: 'http' })).toMatchObject({
      ok: false,
      error: 'ese proveedor HTTP no esta configurado',
    });
    expect(await refrescar({ connectionId: 'no-existe' })).toMatchObject({
      ok: false,
      error: 'esa conexion no esta configurada',
    });
    // el catalogo de NanoGPT es publico, pero el manejador sigue exigiendo la
    // clave guardada: sin ella no se le pregunta a nadie
    expect(await refrescar({ connectionId: 'nanogpt', source: 'http' })).toMatchObject({
      ok: false,
      error: 'no hay clave guardada para esta conexion',
    });
    expect(calls).toEqual([]);

    // y con clave, lo que contesta la pasarela llega con su codigo y sin ella
    const result = await refrescar({ connectionId: 'gemela', source: 'http' });
    expect(calls).toEqual([
      { url: 'https://proveedor.example/v1/models', authorization: `Bearer ${GATEWAY_KEY}` },
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(
      'el proveedor no devolvió la lista de modelos (HTTP 429)',
    );
    expect(JSON.stringify(result)).not.toContain(GATEWAY_KEY);
  });

  it('la conexion y el proveedor que se llaman igual tienen cada uno su URL, su clave y su catalogo', async () => {
    let body: unknown = { data: [{ id: 'un-modelo' }] };
    montar({ 'connection:gemela': GATEWAY_KEY, GEMELA_API_KEY: NANO_KEY }, () => json(200, body));

    // sin `source`, el valor por defecto es la lista de conexiones
    const connection = await refrescar({ connectionId: 'gemela' });
    const provider = await refrescar({ connectionId: 'gemela', source: 'http' });

    expect(calls).toEqual([
      { url: 'https://conexion.example/v1/models', authorization: `Bearer ${GATEWAY_KEY}` },
      { url: 'https://proveedor.example/v1/models', authorization: `Bearer ${NANO_KEY}` },
    ]);
    // un host sin dialecto no dice con que lista se leyo, ni en memoria ni en disco
    expect(connection.ok && 'detail' in connection.value).toBe(false);
    expect(provider.ok && 'detail' in provider.value).toBe(false);
    expect(readCatalogSnapshot(directory, 'gemela', 'connection')?.source).toBe('connection');
    expect(readCatalogSnapshot(directory, 'gemela', 'http')?.source).toBe('http');
    expect(readCatalogSnapshot(directory, 'gemela', 'http')?.notice).toBe(
      'Esta conexion no publica precios por API; Luxy no los consulta.',
    );

    // el proveedor pasa a contestar un 200 con otra forma. Lo que se compara es
    // SU catalogo guardado, no el de la conexion que se llama igual: el suyo no
    // se pisa con uno vacio
    body = { data: 'otra forma' };
    const again = await refrescar({ connectionId: 'gemela', source: 'http' });
    expect(again.ok).toBe(false);
    expect(again.ok ? '' : again.error).toContain(
      'el proveedor no devolvió la lista de modelos (HTTP 200 sin ningún modelo que Luxy pueda leer). Se conserva el catálogo anterior, con 1 modelo.',
    );
    expect(readCatalogSnapshot(directory, 'gemela', 'http')?.models).toHaveLength(1);
    expect(readCatalogSnapshot(directory, 'gemela', 'connection')?.models).toHaveLength(1);
  });

  it('un 200 sin modelos no pisa el catalogo detallado que ya estaba en disco', async () => {
    const before: CatalogSnapshot = {
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: '2026-10-01T08:00:00.000Z',
      models: [
        {
          apiModel: 'deepseek/deepseek-v4-pro',
          ownedBy: null,
          billing: 'unknown',
          modelRatio: null,
          completionRatio: null,
          perCall: null,
          groups: [],
          declaredCapabilities: ['reasoning'],
          reasoning: true,
          reasoningEfforts: ['none', 'high', 'max'],
        },
      ],
      pricingAvailable: false,
      notice: null,
      detail: 'detailed',
    };
    writeCatalogSnapshot(directory, before);
    const file = join(directory, 'http-nanogpt.json');
    const bytes = readFileSync(file, 'utf8');

    // antes esto era un catalogo vacio escrito encima del bueno, y sin error
    montar({ NANOGPT_API_KEY: NANO_KEY }, () => json(200, { object: 'error' }));
    const result = await refrescar({ connectionId: 'nanogpt', source: 'http' });

    // ni se pide la simple: lo guardado tiene los niveles y ella no los trae
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.nano-gpt.com/api/v1/models?detailed=true',
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(
      'NanoGPT no devolvió la lista de modelos con detalle (HTTP 200 sin ningún modelo que Luxy pueda leer)',
    );
    expect(result.ok ? '' : result.error).toContain(
      'Se conserva el catálogo anterior, con 1 modelo',
    );
    expect(readFileSync(file, 'utf8')).toBe(bytes);
  });

  it('dos pulsaciones a la vez sobre el mismo proveedor son un solo refresco', async () => {
    // la pantalla tiene dos botones que actualizan el mismo proveedor —el de
    // «Ajustes por modelo» y el del catalogo real—, cada uno con su propio
    // «Actualizando…». Aqui la primera peticion con detalle falla y las demas
    // aciertan: con dos refrescos en curso, uno guardaba la lista con detalle y
    // el otro, que ya habia decidido caer a la simple, la pisaba al llegar
    const detailedUrl = 'https://api.nano-gpt.com/api/v1/models?detailed=true';
    let detailedAsked = 0;
    montar({ NANOGPT_API_KEY: NANO_KEY }, (url) => {
      if (url !== detailedUrl) return json(200, { data: [{ id: 'deepseek/deepseek-v4-pro' }] });
      detailedAsked += 1;
      return detailedAsked === 1 ? json(429, { error: 'inventado' }) : json(200, DETAILED);
    });
    const press = (): Promise<Result> => refrescar({ connectionId: 'nanogpt', source: 'http' });

    const [first, second] = await Promise.all([press(), press()]);

    // una sola tanda de peticiones, y las dos reciben lo que quedo en el disco
    expect(calls.map((call) => call.url)).toEqual([
      detailedUrl,
      'https://api.nano-gpt.com/api/v1/models',
    ]);
    expect(first.ok && first.value.detail).toBe('basic');
    expect(second).toEqual(first);
    expect(first.ok && first.value).toEqual(readCatalogSnapshot(directory, 'nanogpt', 'http'));

    // al terminar el hueco queda libre: la siguiente pulsacion vuelve a pedir,
    // y ahora si llega la lista con detalle
    const third = await press();
    expect(calls).toHaveLength(3);
    expect(third.ok && third.value.detail).toBe('detailed');
    expect(readCatalogSnapshot(directory, 'nanogpt', 'http')?.detail).toBe('detailed');
  });
});
