import { describe, expect, it } from 'vitest';
import {
  storedAgentConfigSchema,
  studioJobCreateRequestSchema,
  studioJobSchema,
} from './schemas.js';

describe('trabajos de Studio persistidos', () => {
  it('conserva un proveedor externo historico sin bloquear el historial', () => {
    // la disponibilidad actual se valida al crear o ejecutar. Leer un trabajo
    // guardado no puede depender del catalogo compilado en esta version.
    expect(studioJobSchema.pick({ provider: true }).parse({ provider: 'mi-api-privada' })).toEqual({
      provider: 'mi-api-privada',
    });
  });

  it('rechaza identificadores que no son seguros para el contrato', () => {
    expect(
      studioJobSchema.pick({ provider: true }).safeParse({ provider: '../salida' }).success,
    ).toBe(false);
  });
});

describe('proveedores HTTP configurables', () => {
  const provider = {
    id: 'mi-api-privada',
    displayName: 'Mi API privada',
    baseUrl: 'https://api.example/v1',
    model: 'modelo/texto-v2',
    apiKeyEnv: 'LUXY_HTTP_MI_API_PRIVADA_API_KEY',
    enabled: true,
  };

  it('admite el identificador dinamico al crear un trabajo de Studio', () => {
    const result = studioJobCreateRequestSchema.safeParse({
      targetMachineId: 'd7f7725c-bc2f-4df5-9513-af893fc8d8b1',
      provider: provider.id,
      projectAlias: 'luxy',
      prompt: 'prueba',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza ids repetidos y nombres de clave compartidos', () => {
    const base = {
      machineName: 'portatil',
      gatewayUrl: 'https://gateway.example',
      providers: { http: [provider, { ...provider, displayName: 'Duplicado' }] },
    };
    expect(storedAgentConfigSchema.safeParse(base).success).toBe(false);
    expect(
      storedAgentConfigSchema.safeParse({
        ...base,
        providers: {
          http: [provider, { ...provider, id: 'otro-proveedor' }],
        },
      }).success,
    ).toBe(false);
  });

  it('conserva el nombre interno de las conexiones HTTP adaptadas', () => {
    expect(
      storedAgentConfigSchema.safeParse({
        machineName: 'portatil',
        gatewayUrl: 'https://gateway.example',
        providers: { http: [{ ...provider, apiKeyEnv: 'connection:pasarela-local' }] },
      }).success,
    ).toBe(true);
  });

  it('bloquea HTTP remoto, credenciales en URL y APIs prohibidas', () => {
    const parseUrl = (baseUrl: string): boolean =>
      storedAgentConfigSchema.safeParse({
        machineName: 'portatil',
        gatewayUrl: 'https://gateway.example',
        providers: { http: [{ ...provider, baseUrl }] },
      }).success;

    expect(parseUrl('http://api.example/v1')).toBe(false);
    expect(parseUrl('https://user:secret@api.example/v1')).toBe(false);
    expect(parseUrl('https://api.openai.com/v1')).toBe(false);
    expect(parseUrl('https://api.anthropic.com/v1')).toBe(false);
    expect(parseUrl('http://localhost:11434/v1')).toBe(true);
  });
});
