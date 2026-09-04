import { describe, expect, it } from 'vitest';
import { agentConfigSchema, type StoredAgentConfig } from '@luxy/shared';
import { catalogOriginKey, catalogOriginsOf } from './useCatalog.js';

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
    // el agente registra un proveedor HTTP bajo SU identificador, y el
    // identificador de proveedor ES la familia. Una conexion sirve muchas
    // familias y hay que adivinarlas por el nombre del modelo
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
