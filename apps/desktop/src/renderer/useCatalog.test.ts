import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agentConfigSchema,
  buildCatalogForConnection,
  buildCatalogSnapshot,
  buildDefaultCatalog,
  mergeCatalogs,
  type CatalogSnapshot,
  type StoredAgentConfig,
} from '@luxy/shared';
import {
  catalogOriginKey,
  catalogOriginsOf,
  detectedModelsOf,
  readStoredCatalog,
  storedCatalogView,
} from './useCatalog.js';

function config(overrides: Record<string, unknown> = {}): StoredAgentConfig {
  return agentConfigSchema.parse({
    machineId: '6f34d4b8-5927-43ee-a0d0-360ac54f3c01',
    machineName: 'portatil',
    gatewayUrl: 'https://example.com',
    machineToken: 'PENDIENTE_TOKEN_DE_PRUEBA',
    projects: {},
    ...overrides,
  }) as StoredAgentConfig;
}

describe('catalogOriginsOf', () => {
  it('sin configuracion no hay a quien preguntarle', () => {
    expect(catalogOriginsOf(null)).toEqual([]);
  });

  it('junta las DOS listas: conexiones y proveedores HTTP', () => {
    // el fallo que esto evita: solo se miraba `connections`, asi que Mistral
    // —que vive en `providers.http`— no existia para el catalogo
    const origins = catalogOriginsOf(
      config({
        connections: [
          { id: 'pasarela', displayName: 'Pasarela', baseUrl: 'https://gw.example.com/v1' },
        ],
        providers: {
          http: [
            {
              id: 'mistral',
              displayName: 'Mistral',
              baseUrl: 'https://api.mistral.ai/v1',
              model: 'mistral-large-latest',
              apiKeyEnv: 'MISTRAL_API_KEY',
            },
          ],
        },
      }),
    );

    expect(origins.map((origin) => origin.id)).toEqual(['pasarela', 'mistral']);
    expect(origins.map((origin) => origin.source)).toEqual(['connection', 'http']);
  });

  it('un proveedor HTTP impone su familia; una conexion no', () => {
    // un proveedor HTTP agrupa todos sus modelos bajo SU identificador; una
    // conexion sirve muchas familias y hay que adivinarlas por el nombre.
    //
    // Es para AGRUPAR, no para elegir ejecutor: `buildServedModel` solo acepta
    // el valor si ademas es una familia real, asi que `horde-cydonia` se
    // descarta y cae en `other`. Quien ejecuta lo dice
    // `providerCandidatesForModel` mirando el `origin`
    const origins = catalogOriginsOf(
      config({
        connections: [{ id: 'pasarela', displayName: 'P', baseUrl: 'https://gw.example.com/v1' }],
        providers: {
          http: [
            {
              id: 'mistral',
              displayName: 'Mistral',
              baseUrl: 'https://api.mistral.ai/v1',
              model: 'x',
              apiKeyEnv: 'MISTRAL_API_KEY',
            },
          ],
        },
      }),
    );

    expect(origins.find((origin) => origin.id === 'pasarela')?.family).toBeNull();
    expect(origins.find((origin) => origin.id === 'mistral')?.family).toBe('mistral');
  });

  it('la clave distingue dos origenes que se llaman igual', () => {
    // los identificadores de las dos listas comparten espacio de nombres: sin
    // el origen en la clave compartirian catalogo y se pisarian
    expect(catalogOriginKey({ id: 'mistral', source: 'connection' })).not.toBe(
      catalogOriginKey({ id: 'mistral', source: 'http' }),
    );
  });
});

// lo que sigue se prueba SIN pintar: este repositorio no tiene jsdom ni
// testing-library, asi que de cada gancho se prueba la parte pura que decide.
// Que el efecto de `useStoredCatalog` solo lea con `active` a true, y que
// `useDetectedCatalog` deje de reconstruir en cada tecla, no lo ejecuta ninguna
// prueba: se ve en la ventana.

function lista(connectionId: string, ids: string[]): CatalogSnapshot {
  return buildCatalogSnapshot({
    connectionId,
    source: 'http',
    fetchedAt: '2026-10-13T09:30:00.000Z',
    modelsPayload: { object: 'list', data: ids.map((id) => ({ id })) },
    pricingPayload: null,
  });
}

describe('detectedModelsOf', () => {
  const configurado = config({
    connections: [
      { id: 'pasarela', displayName: 'Pasarela', baseUrl: 'https://gw.example.com/v1' },
    ],
    providers: {
      http: [
        {
          id: 'nanogpt',
          displayName: 'NanoGPT',
          baseUrl: 'https://api.nano-gpt.com/api/v1',
          model: 'TheDrummer/Cydonia-24B-v4.3',
          apiKeyEnv: 'LUXY_HTTP_NANOGPT_API_KEY',
        },
        {
          id: 'mistral',
          displayName: 'Mistral',
          baseUrl: 'https://api.mistral.ai/v1',
          model: 'mistral-large-latest',
          apiKeyEnv: 'MISTRAL_API_KEY',
        },
      ],
    },
  });
  const origins = catalogOriginsOf(configurado);
  const servidos = ['TheDrummer/Cydonia-24B-v4.3', 'deepseek/deepseek-v4-flash'];
  const leidos = (): Map<string, CatalogSnapshot | null> =>
    new Map<string, CatalogSnapshot | null>([
      // la conexion no tiene catalogo leido, el de Mistral se leyo y no existe
      ['http:nanogpt', lista('nanogpt', servidos)],
      ['http:mistral', null],
    ]);

  it('da lo mismo que la cuenta que vivia en el gancho', () => {
    const snapshots = leidos();
    // la de antes, escrita otra vez: memoizar no puede cambiar ni un modelo
    const deSiempre = mergeCatalogs(
      origins.flatMap((origin) => {
        const snapshot = snapshots.get(catalogOriginKey(origin));
        if (snapshot == null) {
          return origin.source === 'connection' ? buildDefaultCatalog(origin.id) : [];
        }
        return buildCatalogForConnection(origin.id, snapshot.models, origin.family ?? undefined);
      }),
    );
    const models = detectedModelsOf(origins, snapshots);
    expect(models).toEqual(deSiempre);

    // una conexion sin catalogo leido usa el de fabrica; un proveedor HTTP, nada
    expect(models.filter((model) => model.connectionId === 'pasarela')).toEqual(
      buildDefaultCatalog('pasarela'),
    );
    expect(models.filter((model) => model.connectionId === 'mistral')).toEqual([]);
    expect(
      models.filter((model) => model.connectionId === 'nanogpt').map((model) => model.apiModel),
    ).toEqual(servidos);
  });

  it('con la misma lectura y los mismos origenes devuelve la MISMA lista', () => {
    const snapshots = leidos();
    const primera = detectedModelsOf(origins, snapshots);
    // `toBe`: no una lista igual, la misma. Es lo que evita reconstruir los 644
    // modelos de NanoGPT en cada tecla escrita en Privado
    expect(detectedModelsOf(origins, snapshots)).toBe(primera);
    // la lista de origenes nace nueva en cada render, con el mismo contenido
    expect(detectedModelsOf(catalogOriginsOf(configurado), snapshots)).toBe(primera);
  });

  it('otra lectura, u otros origenes, si la reconstruyen', () => {
    const snapshots = leidos();
    const primera = detectedModelsOf(origins, snapshots);

    // otra lectura es OTRO mapa, aunque traiga lo mismo
    const releida = detectedModelsOf(origins, leidos());
    expect(releida).not.toBe(primera);
    expect(releida).toEqual(primera);
    // y si trae otra cosa, se ve
    const cambiados = leidos().set('http:nanogpt', lista('nanogpt', ['zai/glm-5.2']));
    expect(
      detectedModelsOf(origins, cambiados)
        .filter((model) => model.connectionId === 'nanogpt')
        .map((model) => model.apiModel),
    ).toEqual(['zai/glm-5.2']);

    // con el mismo mapa pero un origen menos no vale lo recordado
    const sinNano = origins.filter((origin) => origin.id !== 'nanogpt');
    expect(
      detectedModelsOf(sinNano, snapshots).some((model) => model.connectionId === 'nanogpt'),
    ).toBe(false);
    // y al volver los origenes de antes vuelve la lista entera, no la recortada
    expect(detectedModelsOf(origins, snapshots)).toEqual(primera);
  });
});

describe('storedCatalogView', () => {
  const snapshot = lista('nanogpt', ['deepseek/deepseek-v4-flash']);

  it('sin nada leido sigue leyendo: no da por inexistente lo que no ha mirado', () => {
    expect(storedCatalogView(null, 'http:nanogpt')).toEqual({ snapshot: null, loading: true });
  });

  it('la lectura de OTRO origen no vale para este', () => {
    // enseñarla pondria los niveles de una pasarela bajo el nombre de otra
    expect(storedCatalogView({ key: 'http:mistral', snapshot }, 'http:nanogpt')).toEqual({
      snapshot: null,
      loading: true,
    });
  });

  it('una vez leido deja de leer, haya catalogo o no', () => {
    const conCatalogo = storedCatalogView({ key: 'http:nanogpt', snapshot }, 'http:nanogpt');
    expect(conCatalogo.loading).toBe(false);
    expect(conCatalogo.snapshot).toBe(snapshot);
    // «no hay catalogo» solo se puede decir despues de haber mirado
    expect(storedCatalogView({ key: 'http:nanogpt', snapshot: null }, 'http:nanogpt')).toEqual({
      snapshot: null,
      loading: false,
    });
  });
});

describe('readStoredCatalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide el catalogo de ESE origen y devuelve lo guardado', async () => {
    const snapshot = lista('nanogpt', ['deepseek/deepseek-v4-flash']);
    const readCatalog = vi.fn(async () => ({ ok: true, value: { snapshot } }));
    vi.stubGlobal('window', { luxy: { readCatalog } });

    await expect(readStoredCatalog('nanogpt', 'http')).resolves.toBe(snapshot);
    expect(readCatalog).toHaveBeenCalledTimes(1);
    expect(readCatalog).toHaveBeenCalledWith({ connectionId: 'nanogpt', source: 'http' });
  });

  it('sin catalogo, con un fallo o con el puente roto no hay nada que enseñar', async () => {
    // el rechazo importa: sin atraparlo la pantalla se quedaria «leyendo» para
    // siempre, con el guardado de niveles bloqueado y sin decir por que
    const respuestas: (() => unknown)[] = [
      async () => ({ ok: true, value: { snapshot: null } }),
      async () => ({ ok: false, error: 'no se pudo leer el catalogo', hint: null }),
      async () => {
        throw new Error('canal cerrado');
      },
      () => {
        throw new Error('window.luxy sin puente');
      },
    ];
    for (const readCatalog of respuestas) {
      vi.stubGlobal('window', { luxy: { readCatalog } });
      await expect(readStoredCatalog('nanogpt', 'http')).resolves.toBeNull();
    }
  });
});
