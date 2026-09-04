import { describe, expect, it } from 'vitest';
import {
  apiKeyNameForProvider,
  buildHttpProvider,
  emptyHttpProviderDraft,
  HTTP_PROVIDER_PRESETS,
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

  it('todos los proveedores conocidos construyen una configuracion valida', () => {
    // un preset que no valide seria un boton que no hace nada, y el error solo
    // se veria al pulsarlo. Aqui se ve al escribirlo
    for (const preset of HTTP_PROVIDER_PRESETS) {
      const result = buildHttpProvider(
        {
          ...emptyHttpProviderDraft(),
          id: preset.id,
          displayName: preset.displayName,
          baseUrl: preset.baseUrl,
          model: preset.model,
        },
        null,
      );
      expect(result.error, `${preset.id}: ${result.error ?? ''}`).toBeNull();
      // la URL base es lo unico que este camino no puede comprobar contra la
      // red: Luxy le pega /chat/completions y no hay boton de «Probar»
      expect(preset.baseUrl.endsWith('/')).toBe(false);
      expect(preset.baseUrl.startsWith('https://')).toBe(true);
    }
  });

  it('no hay dos proveedores conocidos con el mismo identificador', () => {
    // dos con el mismo id chocarian al guardar, porque el id debe ser unico
    const ids = HTTP_PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
