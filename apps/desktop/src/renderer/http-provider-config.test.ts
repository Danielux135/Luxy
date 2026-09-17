import { describe, expect, it } from 'vitest';
import {
  apiKeyNameForProvider,
  buildHttpProvider,
  emptyHttpProviderDraft,
  httpProviderToDraft,
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
      // volcar el proveedor guardado en el borrador es justo lo que hace
      // `httpProviderToDraft`; esparcirlo a mano mezclaba numeros en campos que
      // el formulario maneja como texto
      { ...httpProviderToDraft(existing), maxOutputTokens: '8192', dailyBudget: '0' },
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

  it('un formulario recien abierto no trae ningun parametro de muestreo', () => {
    // el defecto es NO MANDAR NADA: con un valor «razonable» de fabrica no
    // habria un «sin» contra el que comparar, que es para lo que se añadieron
    const draft = emptyHttpProviderDraft();
    expect(draft.temperature).toBe('');
    expect(draft.frequencyPenalty).toBe('');
    expect(draft.presencePenalty).toBe('');
    expect(draft.repetitionPenalty).toBe('');

    const result = buildHttpProvider(
      { ...draft, id: 'vacio', displayName: 'Vacio', baseUrl: 'https://api.example/v1', model: 'm' },
      null,
    );
    expect(result.error).toBeNull();
    // la clave se omite entera, no se guarda a `undefined`: asi no viaja basura
    // hasta config.json
    expect(Object.keys(result.provider ?? {})).not.toContain('temperature');
    expect(Object.keys(result.provider ?? {})).not.toContain('frequencyPenalty');
    expect(Object.keys(result.provider ?? {})).not.toContain('presencePenalty');
    expect(Object.keys(result.provider ?? {})).not.toContain('repetitionPenalty');
  });

  it('guarda los parametros de muestreo que si se rellenan, incluido el cero', () => {
    const result = buildHttpProvider(
      {
        ...emptyHttpProviderDraft(),
        id: 'medido',
        displayName: 'Medido',
        baseUrl: 'https://api.example/v1',
        model: 'm',
        temperature: '0',
        frequencyPenalty: ' 0.3 ',
        presencePenalty: '',
        repetitionPenalty: '1.05',
      },
      null,
    );

    expect(result.error).toBeNull();
    expect(result.provider).toMatchObject({
      temperature: 0,
      frequencyPenalty: 0.3,
      repetitionPenalty: 1.05,
    });
    // el que se dejo vacio sigue sin existir aunque los otros tres esten
    expect(Object.keys(result.provider ?? {})).not.toContain('presencePenalty');
  });

  it('rechaza un valor fuera del rango de SU parametro', () => {
    const base = {
      ...emptyHttpProviderDraft(),
      id: 'fuera',
      displayName: 'Fuera',
      baseUrl: 'https://api.example/v1',
      model: 'm',
    };
    // los rangos no son iguales: -1 vale como penalizacion de frecuencia y no
    // vale como penalizacion por repeticion, que es multiplicativa
    expect(buildHttpProvider({ ...base, frequencyPenalty: '-1' }, null).provider).not.toBeNull();
    expect(buildHttpProvider({ ...base, repetitionPenalty: '-1' }, null).provider).toBeNull();
    expect(buildHttpProvider({ ...base, temperature: '3' }, null).provider).toBeNull();
    // un numero a medio escribir se rechaza con mensaje, no se descarta en
    // silencio: descartarlo guardaria la conexion sin el parametro y quien lo
    // escribio creeria que se aplico
    expect(buildHttpProvider({ ...base, temperature: 'x' }, null).provider).toBeNull();
  });

  // el teclado espanol escribe «1,5». Con el campo numerico de HTML eso llegaba
  // como cadena vacia —el navegador descarta lo que no sea un decimal con
  // punto— y la conexion se guardaba SIN el parametro, sin ningun aviso
  it('acepta la coma decimal, que es la que sale de un teclado espanol', () => {
    const base = {
      ...emptyHttpProviderDraft(),
      id: 'coma',
      displayName: 'Coma',
      baseUrl: 'https://api.example/v1',
      model: 'm',
    };
    const conComa = buildHttpProvider({ ...base, temperature: '1,5' }, null).provider;
    expect(conComa?.temperature).toBe(1.5);

    const conPunto = buildHttpProvider({ ...base, temperature: '1.5' }, null).provider;
    expect(conPunto?.temperature).toBe(1.5);
  });

  it('y la coma tambien en las penalizaciones, incluida la negativa', () => {
    const base = {
      ...emptyHttpProviderDraft(),
      id: 'coma2',
      displayName: 'Coma2',
      baseUrl: 'https://api.example/v1',
      model: 'm',
    };
    const provider = buildHttpProvider(
      { ...base, frequencyPenalty: '-0,5', repetitionPenalty: '1,08' },
      null,
    ).provider;
    expect(provider?.frequencyPenalty).toBe(-0.5);
    expect(provider?.repetitionPenalty).toBe(1.08);
  });

  it('editar una conexion conserva sus parametros de muestreo', () => {
    const guardado = buildHttpProvider(
      {
        ...emptyHttpProviderDraft(),
        id: 'ida-vuelta',
        displayName: 'Ida y vuelta',
        baseUrl: 'https://api.example/v1',
        model: 'm',
        temperature: '0.8',
        repetitionPenalty: '1.1',
      },
      null,
    ).provider!;

    const draft = httpProviderToDraft(guardado);
    expect(draft.temperature).toBe('0.8');
    expect(draft.frequencyPenalty).toBe('');
    expect(draft.repetitionPenalty).toBe('1.1');

    const reconstruido = buildHttpProvider(draft, guardado).provider;
    expect(reconstruido).toMatchObject({ temperature: 0.8, repetitionPenalty: 1.1 });
    expect(Object.keys(reconstruido ?? {})).not.toContain('frequencyPenalty');
  });

  it('no hay dos proveedores conocidos con el mismo identificador', () => {
    // dos con el mismo id chocarian al guardar, porque el id debe ser unico
    const ids = HTTP_PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
