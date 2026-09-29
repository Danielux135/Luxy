import { describe, expect, it } from 'vitest';
import { connectionProfileSchema } from '@luxy/shared';
import {
  apiKeyNameForProvider,
  buildHttpProvider,
  describeSampling,
  emptyHttpProviderDraft,
  emptySamplingDraft,
  httpProviderToDraft,
  hostOfBaseUrl,
  HTTP_PROVIDER_PRESETS,
  reasoningModeDraft,
  samplingToDraft,
  withModelSampling,
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

  it('Groq en providers.http guarda el razonamiento arriba, y vacio no gana la clave', () => {
    const base = {
      ...emptyHttpProviderDraft(),
      id: 'groq',
      displayName: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'qwen/qwen3.8-27b',
    };
    expect(emptyHttpProviderDraft().reasoningMode).toBe('');
    expect(Object.keys(buildHttpProvider(base, null).provider ?? {})).not.toContain(
      'reasoningMode',
    );

    const guardado = buildHttpProvider({ ...base, reasoningMode: 'low' }, null).provider;
    expect(guardado?.reasoningMode).toBe('low');
    // y vuelve al formulario al editar
    expect(httpProviderToDraft(guardado!).reasoningMode).toBe('low');

    // el mismo modelo en otro host no tiene regla: no se guarda un ajuste muerto
    const fuera = buildHttpProvider(
      { ...base, baseUrl: 'https://openrouter.ai/api/v1', reasoningMode: 'low' },
      null,
    );
    expect(fuera.provider).toBeNull();
    expect(fuera.error).toContain('Razonamiento');
    expect(hostOfBaseUrl('https://api.groq.com/openai/v1')).toBe('api.groq.com');
    expect(hostOfBaseUrl('a medio escribir')).toBeNull();
  });

  it('no hay dos proveedores conocidos con el mismo identificador', () => {
    // dos con el mismo id chocarian al guardar, porque el id debe ser unico
    const ids = HTTP_PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// el formulario de muestreo POR MODELO de una conexion. Mismo molde que el de
// un proveedor HTTP —coma decimal, vacio = no se envia, NaN no se descarta—,
// mas una regla propia: vaciarlo tiene que dejar la conexion como estaba.
describe('muestreo por modelo de una conexion', () => {
  const conexion = connectionProfileSchema.parse({
    id: 'hcnsec',
    displayName: 'Pasarela',
    baseUrl: 'https://api.example/v1',
  });

  it('la coma decimal llega como numero y los vacios se omiten', () => {
    const result = withModelSampling(conexion, 'DeepSeek-V4-Flash', {
      ...emptySamplingDraft(),
      temperature: '1,3',
    });
    expect(result.error).toBeNull();
    expect(result.connection?.modelSampling).toEqual({ 'DeepSeek-V4-Flash': { temperature: 1.3 } });
  });

  it('un borrador vacio quita la entrada, y la ultima se lleva la clave entera', () => {
    const conDos = withModelSampling(
      withModelSampling(conexion, 'DeepSeek-V4-Flash', {
        ...emptySamplingDraft(),
        temperature: '1,3',
      }).connection!,
      'DeepSeek-V4-Pro',
      { ...emptySamplingDraft(), temperature: '0,9' },
    ).connection!;
    expect(Object.keys(conDos.modelSampling ?? {})).toHaveLength(2);

    const conUna = withModelSampling(conDos, 'DeepSeek-V4-Pro', emptySamplingDraft()).connection!;
    expect(conUna.modelSampling).toEqual({ 'DeepSeek-V4-Flash': { temperature: 1.3 } });

    const sinNinguna = withModelSampling(
      conUna,
      'DeepSeek-V4-Flash',
      emptySamplingDraft(),
    ).connection!;
    // la conexion vuelve a ser la de antes, sin un `{}` muerto
    expect('modelSampling' in sinNinguna).toBe(false);
    expect(sinNinguna).toEqual(conexion);
  });

  it('editar sustituye la entrada del modelo entera', () => {
    const antes = withModelSampling(conexion, 'DeepSeek-V4-Flash', {
      ...emptySamplingDraft(),
      temperature: '1,3',
      frequencyPenalty: '0,2',
    }).connection!;
    const despues = withModelSampling(antes, 'DeepSeek-V4-Flash', {
      ...samplingToDraft(antes.modelSampling?.['DeepSeek-V4-Flash']),
      frequencyPenalty: '',
    }).connection!;
    expect(despues.modelSampling).toEqual({ 'DeepSeek-V4-Flash': { temperature: 1.3 } });
  });

  it('un «-» a medio escribir da error y no se descarta en silencio', () => {
    // «-» y no «1.»: `Number('1.')` es 1, asi que ese no llega a ser NaN
    const result = withModelSampling(conexion, 'DeepSeek-V4-Flash', {
      ...emptySamplingDraft(),
      temperature: '-',
    });
    expect(result.connection).toBeNull();
    expect(result.error).toContain('Temperatura');
  });

  it('fuera de rango y sin modelo tambien se explican', () => {
    const fuera = withModelSampling(conexion, 'DeepSeek-V4-Flash', {
      ...emptySamplingDraft(),
      temperature: '2,5',
    });
    expect(fuera.connection).toBeNull();
    expect(fuera.error).toContain('Temperatura');

    expect(withModelSampling(conexion, '  ', emptySamplingDraft()).error).toBe('Elige el modelo.');
    expect(
      withModelSampling(conexion, 'modelo con espacios', {
        ...emptySamplingDraft(),
        temperature: '1',
      }).connection,
    ).toBeNull();
  });

  // D-107: el razonamiento va en la misma entrada, vacio no escribe nada, y
  // solo se guarda un valor que ESE modelo admite
  it('una entrada con solo el razonamiento se crea, y vaciarla la quita', () => {
    const con = withModelSampling(conexion, 'DeepSeek-V4-Flash', {
      ...emptySamplingDraft(),
      reasoningMode: 'off',
    });
    expect(con.error).toBeNull();
    expect(con.connection?.modelSampling).toEqual({
      'DeepSeek-V4-Flash': { reasoningMode: 'off' },
    });
    const guardada = con.connection?.modelSampling?.['DeepSeek-V4-Flash'];
    expect(samplingToDraft(guardada).reasoningMode).toBe('off');

    const sin = withModelSampling(con.connection!, 'DeepSeek-V4-Flash', emptySamplingDraft());
    expect(sin.connection).toEqual(conexion);
  });

  it('rechaza un valor que el modelo no admite, con el campo nombrado', () => {
    // encender DeepSeek romperia los trabajos con herramientas; apagar GLM-5.3 da error
    for (const [model, mode] of [
      ['DeepSeek-V4-Flash', 'high'],
      ['glm-5.3', 'off'],
      ['step-5-preview', 'off'],
    ] as const) {
      const result = withModelSampling(conexion, model, {
        ...emptySamplingDraft(),
        reasoningMode: mode,
      });
      expect(result.connection, `${model} ${mode}`).toBeNull();
      expect(result.error).toContain('Razonamiento');
    }
  });

  it('el valor del selector no se fia de lo que llega', () => {
    expect(reasoningModeDraft('off')).toBe('off');
    expect(reasoningModeDraft('medium')).toBe('');
    expect(reasoningModeDraft('')).toBe('');
  });

  it('el resumen de la lista nombra el razonamiento', () => {
    expect(describeSampling({ reasoningMode: 'off' })).toBe('Razonamiento: sin razonar');
    expect(describeSampling({ temperature: 1.3, reasoningMode: 'low' })).toBe(
      'Temperatura 1,3 · Razonamiento: poco (low)',
    );
  });

  it('el resumen de la lista usa coma decimal', () => {
    expect(describeSampling({ temperature: 1.3 })).toBe('Temperatura 1,3');
    expect(describeSampling({ temperature: 0, repetitionPenalty: 1.05 })).toBe(
      'Temperatura 0 · Penalización por repetición 1,05',
    );
  });
});
