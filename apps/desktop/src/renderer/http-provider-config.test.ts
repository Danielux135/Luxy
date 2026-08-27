import { describe, expect, it } from 'vitest';
import {
  apiKeyNameForProvider,
  buildHttpProvider,
  emptyHttpProviderDraft,
} from './http-provider-config.js';

describe('configuracion de proveedores HTTP', () => {
  it('construye un proveedor compatible y deriva un nombre de clave cerrado', () => {
    const result = buildHttpProvider(
      {
        ...emptyHttpProviderDraft(),
        id: 'mi-proveedor',
        displayName: 'Mi proveedor',
        baseUrl: 'https://api.example/v1/',
        model: 'modelo/texto-v2',
        maxOutputTokens: '4096',
        dailyBudget: '12.5',
      },
      null,
    );

    expect(result.error).toBeNull();
    expect(result.provider).toMatchObject({
      id: 'mi-proveedor',
      baseUrl: 'https://api.example/v1',
      apiKeyEnv: 'LUXY_HTTP_MI_PROVEEDOR_API_KEY',
      maxOutputTokens: 4096,
      dailyBudget: 12.5,
    });
  });

  it('rechaza HTTP remoto y los proveedores prohibidos', () => {
    const base = {
      ...emptyHttpProviderDraft(),
      id: 'externo',
      displayName: 'Externo',
      model: 'modelo',
    };
    expect(buildHttpProvider({ ...base, baseUrl: 'http://api.example/v1' }, null).provider).toBeNull();
    expect(buildHttpProvider({ ...base, baseUrl: 'https://api.openai.com/v1' }, null).provider).toBeNull();
    expect(buildHttpProvider({ ...base, baseUrl: 'https://api.anthropic.com/v1' }, null).provider).toBeNull();
  });

  it('devuelve un error de formulario para una URL incompleta', () => {
    expect(() => buildHttpProvider(emptyHttpProviderDraft(), null)).not.toThrow();
    expect(buildHttpProvider(emptyHttpProviderDraft(), null).provider).toBeNull();
  });

  it('admite HTTP solo para una API local', () => {
    const result = buildHttpProvider(
      {
        ...emptyHttpProviderDraft(),
        id: 'local',
        displayName: 'Local',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'modelo-local',
      },
      null,
    );
    expect(result.error).toBeNull();
  });

  it('conserva el nombre de clave al editar un proveedor', () => {
    expect(apiKeyNameForProvider('mi-api')).toBe('LUXY_HTTP_MI_API_API_KEY');
    const existing = buildHttpProvider(
      {
        ...emptyHttpProviderDraft(),
        id: 'mi-api',
        displayName: 'Mi API',
        baseUrl: 'https://api.example/v1',
        model: 'modelo',
      },
      null,
    ).provider!;
    const edited = buildHttpProvider(
      { ...emptyHttpProviderDraft(), ...existing, maxOutputTokens: '8192', dailyBudget: '0' },
      { ...existing, apiKeyEnv: 'CLAVE_EXISTENTE' },
    );
    expect(edited.provider?.apiKeyEnv).toBe('CLAVE_EXISTENTE');
  });
});
