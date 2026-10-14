import { describe, expect, it } from 'vitest';
import {
  buildCatalogSnapshot,
  connectionProfileSchema,
  httpProviderConfigSchema,
  REASONING_MODES,
  storedAgentConfigSchema,
  type StoredAgentConfig,
} from '@luxy/shared';
import {
  apiKeyNameForProvider,
  buildHttpProvider,
  catalogDateLabel,
  describeEffectiveModelSettings,
  describeProviderModelSettings,
  describeSampling,
  effectiveModelSettingsLine,
  emptyHttpProviderDraft,
  emptyProviderModelDraft,
  emptySamplingDraft,
  httpProviderToDraft,
  hostOfBaseUrl,
  HTTP_PROVIDER_PRESETS,
  isReasoningOrphan,
  providerModelSettings,
  providerModelSettingsToDraft,
  providerModelSuggestions,
  REASONING_OUTPUT_CAP_FLOOR,
  reasoningChoicesFor,
  reasoningModeDraft,
  reasoningModeError,
  reasoningOutputCapIsShort,
  samplingToDraft,
  withModelSampling,
  withProviderModelSampling,
  type HttpProviderConfig,
} from './http-provider-config.js';
import type { StoredCatalog } from './useCatalog.js';

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
    // F36: los modos son siete, y `medium` y `max` pasan a serlo
    expect(reasoningModeDraft('medium')).toBe('medium');
    expect(reasoningModeDraft('max')).toBe('max');
    // `none` es un valor REAL del cuerpo, no un modo: el selector no lo acepta
    expect(reasoningModeDraft('none')).toBe('');
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

// -----------------------------------------------------------------------------
// F36: el razonamiento con lo que DECLARA el catalogo, y los ajustes por modelo
// de un proveedor HTTP. El caso es NanoGPT: un proveedor HTTP que sirve cientos
// de modelos, cada uno con sus niveles, publicados en su propio catalogo.
//
// Sin red: la FORMA de la lista es la de NanoGPT con detalle y los datos estan
// inventados. Nada de esto prueba que NanoGPT acepte un nivel.
// -----------------------------------------------------------------------------

const NANO_URL = 'https://api.nano-gpt.com/api/v1';
const TABLA_URL = 'https://api.example/v1';
const FLASH = 'deepseek/deepseek-v4-flash';
const CYDONIA = 'TheDrummer/Cydonia-24B-v4.3';
const THINKING = 'deepseek/deepseek-v3.2:thinking';
const RARO = 'raro/niveles-que-luxy-no-conoce';
const LEIDO = '2026-10-13T09:30:00.000Z';

function nanogpt(extra: Record<string, unknown> = {}): HttpProviderConfig {
  return httpProviderConfigSchema.parse({
    id: 'nanogpt',
    displayName: 'NanoGPT',
    baseUrl: NANO_URL,
    model: CYDONIA,
    apiKeyEnv: 'LUXY_HTTP_NANOGPT_API_KEY',
    enabled: true,
    maxOutputTokens: 4096,
    ...extra,
  });
}

function leido(detail: 'detailed' | 'basic', modelsPayload: unknown): StoredCatalog {
  return {
    loading: false,
    snapshot: buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: LEIDO,
      modelsPayload,
      pricingPayload: null,
      detail,
    }),
  };
}

const CON_DETALLE = leido('detailed', {
  object: 'list',
  data: [
    {
      id: FLASH,
      capabilities: { reasoning: true },
      reasoning_efforts: ['none', 'high', 'max'],
      max_output_tokens: 384000,
    },
    // el predeterminado de la entrada: la pasarela declara que no razona
    { id: CYDONIA, capabilities: { reasoning: false }, max_output_tokens: null },
    // razona y no declara niveles
    { id: THINKING, capabilities: { reasoning: true }, max_output_tokens: 65536 },
    { id: RARO, capabilities: { reasoning: true }, reasoning_efforts: ['auto', 'turbo'] },
  ],
});
const SIN_DETALLE = leido('basic', { object: 'list', data: [{ id: FLASH }, { id: CYDONIA }] });
const SIN_CATALOGO: StoredCatalog = { snapshot: null, loading: false };
const LEYENDO: StoredCatalog = { snapshot: null, loading: true };

describe('opciones de razonamiento con lo declarado', () => {
  it('en un host de la tabla sale lo de siempre, y el catalogo no se mira', () => {
    const sin = reasoningChoicesFor('DeepSeek-V4-Flash', TABLA_URL);
    expect(sin.source).toBe('table');
    expect(sin.dialect).toBeNull();
    expect(sin.options).toEqual(['off']);
    expect(sin.manual).toBe(false);
    expect(sin.catalog).toBeNull();
    expect(sin.note).toContain('Sólo se ofrece apagarlo');
    // aunque alguien le pase un catalogo que declara otra cosa, o diga que el
    // valor es del nivel de proveedor: alli manda la tabla
    expect(
      reasoningChoicesFor('DeepSeek-V4-Flash', TABLA_URL, {
        stored: CON_DETALLE,
        providerWide: true,
      }),
    ).toEqual(sin);
    // y un modelo sin regla sigue sin nada, lo declare quien lo declare
    expect(reasoningChoicesFor(FLASH, TABLA_URL, { stored: CON_DETALLE }).options).toEqual([]);
  });

  it('en NanoGPT ofrece los niveles que declara el catalogo, traducidos y en orden', () => {
    const choices = reasoningChoicesFor(FLASH, NANO_URL, { stored: CON_DETALLE });
    expect(choices.source).toBe('levels');
    expect(choices.dialect?.label).toBe('NanoGPT');
    // `none` es «Sin razonar», y el orden es el de menos a mas
    expect(choices.options).toEqual(['off', 'high', 'max']);
    expect(choices.manual).toBe(false);
    // con la fecha y el tope que declara, para decirlos al lado
    expect(choices.catalog).toMatchObject({ state: 'levels', fetchedAt: LEIDO, outputCap: 384000 });
    expect(choices.note).toContain('NanoGPT declara');
  });

  it('el nombre se recorta, pero se busca EXACTO: mayusculas y sufijo cuentan', () => {
    expect(reasoningChoicesFor(`  ${FLASH} `, NANO_URL, { stored: CON_DETALLE }).source).toBe(
      'levels',
    );
    for (const otro of ['deepseek/DeepSeek-V4-Flash', `${FLASH}:thinking`]) {
      const choices = reasoningChoicesFor(otro, NANO_URL, { stored: CON_DETALLE });
      expect(choices.source, otro).toBe('unknown-model');
      expect(choices.options, otro).toEqual([]);
    }
  });

  it('a mano, entre los siete, solo si se leyo sin detalle o el modelo no declara niveles', () => {
    for (const [caso, model, stored, source] of [
      ['sin detalle', FLASH, SIN_DETALLE, 'basic'],
      ['razona sin niveles', THINKING, CON_DETALLE, 'no-levels'],
    ] as const) {
      const choices = reasoningChoicesFor(model, NANO_URL, { stored });
      expect(choices.source, caso).toBe(source);
      expect(choices.manual, caso).toBe(true);
      expect(choices.options, caso).toEqual([...REASONING_MODES]);
      expect(choices.note, caso).toContain('se elige a mano');
    }
  });

  it('sin opciones cuando no hay de donde sacarlas, y cada caso dice cual es', () => {
    for (const [source, model, context] of [
      ['missing', FLASH, { stored: SIN_CATALOGO }],
      ['loading', FLASH, { stored: LEYENDO }],
      ['not-reasoning', CYDONIA, { stored: CON_DETALLE }],
      // declara niveles, pero ninguno que Luxy sepa nombrar
      ['levels', RARO, { stored: CON_DETALLE }],
      // quien llama no tiene catalogo que leer: no es lo mismo que «no hay»
      ['unavailable', FLASH, undefined],
      // el nivel de proveedor no se ofrece aunque el modelo declare niveles
      ['provider-wide', FLASH, { stored: CON_DETALLE, providerWide: true }],
    ] as const) {
      const choices = reasoningChoicesFor(model, NANO_URL, context);
      expect(choices.source, source).toBe(source);
      expect(choices.options, source).toEqual([]);
      expect(choices.manual, source).toBe(false);
      expect(choices.note, source).toBeNull();
      expect(choices.dialect?.family, source).toBe('nanogpt');
    }
  });

  it('un valor guardado no se da por huerfano mientras el catalogo se lee', () => {
    const leyendo = reasoningChoicesFor(FLASH, NANO_URL, { stored: LEYENDO });
    // todavia no se sabe que declara NanoGPT: marcarlo seria afirmarlo
    expect(isReasoningOrphan('high', leyendo)).toBe(false);

    const leidoYa = reasoningChoicesFor(FLASH, NANO_URL, { stored: CON_DETALLE });
    expect(isReasoningOrphan('high', leidoYa)).toBe(false);
    expect(isReasoningOrphan('low', leidoYa)).toBe(true);
    expect(isReasoningOrphan('', leidoYa)).toBe(false);
    // sin catalogo guardado si: no esta entre lo que se ofrece
    expect(
      isReasoningOrphan('high', reasoningChoicesFor(FLASH, NANO_URL, { stored: SIN_CATALOGO })),
    ).toBe(true);
    // y en la tabla, como siempre
    expect(isReasoningOrphan('high', reasoningChoicesFor('DeepSeek-V4-Flash', TABLA_URL))).toBe(
      true,
    );
  });

  it('la fecha del catalogo se dice de una sola manera, o no se dice', () => {
    expect(catalogDateLabel(LEIDO)).toMatch(/^\d{1,2}\/\d{1,2}\/2026$/);
    expect(catalogDateLabel(null)).toBeNull();
    expect(catalogDateLabel(undefined)).toBeNull();
    expect(catalogDateLabel('')).toBeNull();
    expect(catalogDateLabel('ayer por la tarde')).toBeNull();
  });
});

describe('validacion del razonamiento al guardar', () => {
  it('en la tabla, el texto de siempre', () => {
    expect(reasoningModeError('off', 'DeepSeek-V4-Flash', TABLA_URL)).toBeNull();
    expect(reasoningModeError('high', 'DeepSeek-V4-Flash', TABLA_URL)).toBe(
      'Razonamiento: este modelo no lo admite con ese valor. Déjalo en «Lo que traiga el modelo».',
    );
    expect(reasoningModeError('', 'sin-regla', TABLA_URL)).toBeNull();
  });

  it('en NanoGPT acepta lo declarado y rechaza lo demas con la fecha del catalogo', () => {
    const context = { stored: CON_DETALLE };
    expect(reasoningModeError('', FLASH, NANO_URL, context)).toBeNull();
    for (const mode of ['off', 'high', 'max'] as const) {
      expect(reasoningModeError(mode, FLASH, NANO_URL, context), mode).toBeNull();
    }
    const error = reasoningModeError('low', FLASH, NANO_URL, context);
    expect(error).toContain('NanoGPT no declara ese nivel');
    expect(error).toContain(`su catálogo del ${catalogDateLabel(LEIDO)}`);
    // y dice cuales si declara, para no tener que volver al selector
    expect(error).toContain('(sin razonar, más (high), al máximo (max))');
  });

  it('a mano se acepta cualquiera de los siete', () => {
    for (const mode of REASONING_MODES) {
      expect(reasoningModeError(mode, FLASH, NANO_URL, { stored: SIN_DETALLE }), mode).toBeNull();
      expect(
        reasoningModeError(mode, THINKING, NANO_URL, { stored: CON_DETALLE }),
        mode,
      ).toBeNull();
    }
  });

  it('cada motivo dice que hacer, y ninguno afirma lo que el modelo «admite»', () => {
    const casos: [string, string | null, RegExp][] = [
      [
        'sin catalogo guardado',
        reasoningModeError('high', FLASH, NANO_URL, { stored: SIN_CATALOGO }),
        /Pulsa «Actualizar modelos de este proveedor»/,
      ],
      [
        'catalogo sin leer todavia',
        reasoningModeError('high', FLASH, NANO_URL, { stored: LEYENDO }),
        /todavía no ha leído el catálogo guardado de NanoGPT/,
      ],
      [
        'identificador que no esta',
        reasoningModeError('high', 'deepseek/DeepSeek-V4-Flash', NANO_URL, { stored: CON_DETALLE }),
        /no está en el catálogo de NanoGPT del .+ Comprueba las mayúsculas y el sufijo/,
      ],
      [
        'la pasarela declara que no razona',
        reasoningModeError('high', CYDONIA, NANO_URL, { stored: CON_DETALLE }),
        /NanoGPT declara que este modelo no razona, en su catálogo del /,
      ],
      [
        'niveles que Luxy no sabe pedir',
        reasoningModeError('high', RARO, NANO_URL, { stored: CON_DETALLE }),
        /niveles que Luxy no sabe pedir \(auto, turbo\)/,
      ],
      [
        'sin catalogo que leer',
        reasoningModeError('high', FLASH, NANO_URL),
        /sólo lo lee para un proveedor HTTP/,
      ],
      [
        'nivel de proveedor',
        reasoningModeError('high', FLASH, NANO_URL, { stored: CON_DETALLE, providerWide: true }),
        /no se elige para todo el proveedor, sino para cada modelo/,
      ],
    ];
    for (const [caso, error, esperado] of casos) {
      expect(error, caso).toMatch(esperado);
      expect(error, caso).toMatch(/^Razonamiento: /);
      // D-093: se dice lo que la pasarela DECLARA, nunca lo que el modelo hace
      expect(error, caso).not.toMatch(/admite|verificad/i);
    }
  });
});

describe('guardar el proveedor arrastra lo que no esta en su formulario', () => {
  it('los ajustes de muestreo por modelo, con su nivel de razonamiento', () => {
    const ajustes = { [FLASH]: { reasoningMode: 'high', temperature: 0.7 } };
    const existing = nanogpt({ modelSampling: ajustes });
    const result = buildHttpProvider(
      { ...httpProviderToDraft(existing), displayName: 'NanoGPT de pago' },
      existing,
    );
    expect(result.error).toBeNull();
    expect(result.provider?.displayName).toBe('NanoGPT de pago');
    // sin esto, «Guardar proveedor» borraba todos los niveles sin avisar
    expect(result.provider?.modelSampling).toEqual(ajustes);
  });

  it('los topes de salida por modelo, y sin ajustes no gana ninguna clave', () => {
    const existing = nanogpt({ modelOutputCaps: { [FLASH]: 16384 } });
    const result = buildHttpProvider(httpProviderToDraft(existing), existing);
    expect(result.error).toBeNull();
    expect(result.provider?.modelOutputCaps).toEqual({ [FLASH]: 16384 });
    expect('modelSampling' in (result.provider ?? {})).toBe(false);

    // un proveedor guardado antes de F36 sale igual: ni `{}` ni `undefined`
    const antes = nanogpt();
    const sin = buildHttpProvider(httpProviderToDraft(antes), antes).provider;
    expect(sin).toEqual(antes);
    expect('modelSampling' in (sin ?? {})).toBe(false);
    expect('modelOutputCaps' in (sin ?? {})).toBe(false);
  });

  it('la forma de `image_url`, que volvia a la de fabrica al guardar', () => {
    const existing = nanogpt({ imageUrlFormat: 'string' });
    const result = buildHttpProvider(
      { ...httpProviderToDraft(existing), maxOutputTokens: '8192' },
      existing,
    );
    expect(result.provider?.maxOutputTokens).toBe(8192);
    expect(result.provider?.imageUrlFormat).toBe('string');
    // uno nuevo sigue naciendo con la forma estandar
    expect(buildHttpProvider(httpProviderToDraft(existing), null).provider?.imageUrlFormat).toBe(
      'object',
    );
  });
});

describe('cambiar la URL base de un proveedor con niveles guardados', () => {
  // un proveedor en un host de la tabla, con un nivel que la tabla admite y otra
  // entrada que solo trae temperatura
  const enTabla = httpProviderConfigSchema.parse({
    id: 'pasarela',
    displayName: 'Pasarela',
    baseUrl: TABLA_URL,
    model: 'kimi-k3',
    apiKeyEnv: 'LUXY_HTTP_PASARELA_API_KEY',
    modelSampling: {
      'kimi-k3': { reasoningMode: 'low' },
      'DeepSeek-V4-Flash': { temperature: 1.1 },
    },
  });

  it('no deja llevarlo a NanoGPT: nadie comprobo esos niveles contra su catalogo', () => {
    const result = buildHttpProvider(
      { ...httpProviderToDraft(enTabla), baseUrl: NANO_URL },
      enTabla,
    );
    expect(result.provider).toBeNull();
    // con el campo nombrado, y diciendo de que modelo es el nivel
    expect(result.error).toMatch(/^URL base: /);
    expect(result.error).toContain('(kimi-k3)');
    expect(result.error).toContain('el catálogo de NanoGPT');
    // la entrada sin razonamiento ni estorba ni se nombra
    expect(result.error).not.toContain('DeepSeek-V4-Flash');
  });

  it('sin ningun nivel guardado si se puede, y los ajustes viajan con el', () => {
    const soloTemperatura = httpProviderConfigSchema.parse({
      ...enTabla,
      modelSampling: { 'DeepSeek-V4-Flash': { temperature: 1.1 } },
    });
    const result = buildHttpProvider(
      { ...httpProviderToDraft(soloTemperatura), baseUrl: NANO_URL },
      soloTemperatura,
    );
    expect(result.error).toBeNull();
    expect(result.provider?.baseUrl).toBe(NANO_URL);
    expect(result.provider?.modelSampling).toEqual({ 'DeepSeek-V4-Flash': { temperature: 1.1 } });
  });

  it('entre los dos hosts de NanoGPT si, y de vuelta a un host de la tabla tambien', () => {
    const enNano = nanogpt({ modelSampling: { [FLASH]: { reasoningMode: 'high' } } });
    for (const baseUrl of ['https://nano-gpt.com/api/v1', TABLA_URL]) {
      const result = buildHttpProvider({ ...httpProviderToDraft(enNano), baseUrl }, enNano);
      expect(result.error, baseUrl).toBeNull();
      expect(result.provider?.baseUrl, baseUrl).toBe(baseUrl);
      expect(result.provider?.modelSampling, baseUrl).toEqual(enNano.modelSampling);
    }
  });

  it('en NanoGPT el nivel de proveedor no se guarda: alli se elige por modelo', () => {
    const draft = { ...httpProviderToDraft(nanogpt()), model: FLASH };
    expect(buildHttpProvider(draft, null).error).toBeNull();
    const result = buildHttpProvider({ ...draft, reasoningMode: 'high' }, null);
    expect(result.provider).toBeNull();
    expect(result.error).toContain('sino para cada modelo');
    expect(result.error).toContain('«Ajustes por modelo»');
  });
});

describe('ajustes por modelo de un proveedor HTTP', () => {
  const proveedor = nanogpt();
  const con = (fields: Partial<ReturnType<typeof emptyProviderModelDraft>>) => ({
    ...emptyProviderModelDraft(),
    ...fields,
  });

  it('guarda el nivel declarado en la entrada del modelo y el tope en su mapa', () => {
    const result = withProviderModelSampling(
      proveedor,
      ` ${FLASH} `,
      con({ reasoningMode: 'high', outputCap: '16384' }),
      CON_DETALLE,
    );
    expect(result.error).toBeNull();
    expect(result.provider).toEqual({
      ...proveedor,
      modelSampling: { [FLASH]: { reasoningMode: 'high' } },
      modelOutputCaps: { [FLASH]: 16384 },
    });
    // lo que sale es lo que aceptara el proceso principal al guardar
    expect(httpProviderConfigSchema.safeParse(result.provider).success).toBe(true);
    // y vuelve al borrador tal cual al editar
    const fila = providerModelSettings(result.provider!)[0];
    expect(providerModelSettingsToDraft(fila)).toEqual(
      con({ reasoningMode: 'high', outputCap: '16384' }),
    );
  });

  it('solo el tope no crea entrada de muestreo: el modelo conserva el del proveedor', () => {
    // el tope no depende del catalogo: se guarda tambien sin haberlo leido
    const result = withProviderModelSampling(
      proveedor,
      FLASH,
      con({ outputCap: '16384' }),
      LEYENDO,
    );
    expect(result.error).toBeNull();
    expect(result.provider?.modelOutputCaps).toEqual({ [FLASH]: 16384 });
    expect('modelSampling' in (result.provider ?? {})).toBe(false);
  });

  it('vaciar un campo quita solo lo suyo, y vaciarlo todo deja el proveedor como estaba', () => {
    const lleno = withProviderModelSampling(
      proveedor,
      FLASH,
      con({ reasoningMode: 'max', temperature: '0,7', outputCap: '32768' }),
      CON_DETALLE,
    ).provider!;
    expect(lleno.modelSampling).toEqual({ [FLASH]: { reasoningMode: 'max', temperature: 0.7 } });

    const sinTope = withProviderModelSampling(
      lleno,
      FLASH,
      con({ reasoningMode: 'max', temperature: '0,7' }),
      CON_DETALLE,
    ).provider!;
    expect(sinTope.modelSampling).toEqual(lleno.modelSampling);
    expect('modelOutputCaps' in sinTope).toBe(false);

    const sinMuestreo = withProviderModelSampling(
      lleno,
      FLASH,
      con({ outputCap: '32768' }),
      CON_DETALLE,
    ).provider!;
    expect(sinMuestreo.modelOutputCaps).toEqual({ [FLASH]: 32768 });
    expect('modelSampling' in sinMuestreo).toBe(false);

    // «Quitar» es el borrador vacio, y no depende de ningun catalogo: se puede
    // con el catalogo sin leer y sin catalogo
    for (const stored of [LEYENDO, SIN_CATALOGO]) {
      expect(
        withProviderModelSampling(lleno, FLASH, emptyProviderModelDraft(), stored).error,
      ).toBeNull();
    }
    const vacio = withProviderModelSampling(
      lleno,
      FLASH,
      emptyProviderModelDraft(),
      LEYENDO,
    ).provider;
    expect(vacio).toEqual(proveedor);
    expect('modelSampling' in (vacio ?? {})).toBe(false);
    expect('modelOutputCaps' in (vacio ?? {})).toBe(false);
  });

  it('quitar la entrada de un modelo no toca la del vecino', () => {
    const dos = withProviderModelSampling(
      withProviderModelSampling(
        proveedor,
        FLASH,
        con({ reasoningMode: 'high', outputCap: '16384' }),
        CON_DETALLE,
      ).provider!,
      THINKING,
      con({ reasoningMode: 'medium', outputCap: '8192' }),
      CON_DETALLE,
    ).provider!;
    expect(providerModelSettings(dos).map((fila) => fila.apiModel)).toEqual([FLASH, THINKING]);

    const una = withProviderModelSampling(
      dos,
      FLASH,
      emptyProviderModelDraft(),
      CON_DETALLE,
    ).provider!;
    expect(una.modelSampling).toEqual({ [THINKING]: { reasoningMode: 'medium' } });
    expect(una.modelOutputCaps).toEqual({ [THINKING]: 8192 });
  });

  it('rechaza un nivel que NanoGPT no declara para ese modelo', () => {
    const result = withProviderModelSampling(
      proveedor,
      FLASH,
      con({ reasoningMode: 'low' }),
      CON_DETALLE,
    );
    expect(result.provider).toBeNull();
    expect(result.error).toContain('NanoGPT no declara ese nivel');
  });

  it('sin el catalogo leido no se guarda ningun nivel, y lo demas si', () => {
    // alli lo que se guarda VIAJA sin que el agente lo compruebe: sin lo
    // declarado delante no hay con que validarlo
    for (const stored of [LEYENDO, SIN_CATALOGO]) {
      const nivel = withProviderModelSampling(
        proveedor,
        FLASH,
        con({ reasoningMode: 'high' }),
        stored,
      );
      expect(nivel.provider).toBeNull();
      expect(nivel.error).toMatch(/^Razonamiento: /);

      const temperatura = withProviderModelSampling(
        proveedor,
        FLASH,
        con({ temperature: '0,7' }),
        stored,
      );
      expect(temperatura.error).toBeNull();
      expect(temperatura.provider?.modelSampling).toEqual({ [FLASH]: { temperature: 0.7 } });
    }
  });

  it('a mano: con el catalogo sin detalle se guarda el nivel elegido', () => {
    const result = withProviderModelSampling(
      proveedor,
      FLASH,
      con({ reasoningMode: 'xhigh' }),
      SIN_DETALLE,
    );
    expect(result.error).toBeNull();
    expect(result.provider?.modelSampling).toEqual({ [FLASH]: { reasoningMode: 'xhigh' } });
  });

  it('en un host de la tabla valida contra la tabla, sin catalogo', () => {
    const groq = httpProviderConfigSchema.parse({
      id: 'groq',
      displayName: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      apiKeyEnv: 'LUXY_HTTP_GROQ_API_KEY',
    });
    // ni sin catalogo ni con el de otra pasarela: alli no se mira
    const admitido = withProviderModelSampling(
      groq,
      'qwen/qwen3.8-27b',
      con({ reasoningMode: 'low' }),
      SIN_CATALOGO,
    );
    expect(admitido.error).toBeNull();
    expect(admitido.provider?.modelSampling).toEqual({
      'qwen/qwen3.8-27b': { reasoningMode: 'low' },
    });
    // un modelo sin regla no guarda un ajuste que no viajaria nunca
    const sinRegla = withProviderModelSampling(
      groq,
      'llama-3.3-70b-versatile',
      con({ reasoningMode: 'low' }),
      CON_DETALLE,
    );
    expect(sinRegla.provider).toBeNull();
    expect(sinRegla.error).toContain('este modelo no lo admite con ese valor');
  });

  it('un tope que no vale se explica en castellano y no se guarda', () => {
    for (const outputCap of ['100', '200001', '16.384', '16384,5', 'mucho', '-']) {
      const result = withProviderModelSampling(proveedor, FLASH, con({ outputCap }), CON_DETALLE);
      expect(result.provider, outputCap).toBeNull();
      expect(result.error, outputCap).toMatch(/^Máximo de tokens de este modelo: /);
      expect(result.error, outputCap).toContain('entre 256 y 200000');
    }
    // los dos extremos del rango si
    for (const outputCap of ['256', '200000']) {
      expect(
        withProviderModelSampling(proveedor, FLASH, con({ outputCap }), CON_DETALLE).error,
        outputCap,
      ).toBeNull();
    }
  });

  it('el tope se escribe solo con digitos: lo demas no se guarda como otro numero', () => {
    // `Number()` los entiende todos, y por eso se guardaban SIN error con un
    // tope distinto del tecleado: «300.000» y «300,000» como 300, «1e4» como
    // 10000 y «0x1000» como 4096
    for (const outputCap of ['300.000', '300,000', '1e4', '0x1000', '1000.0', '+16384']) {
      const result = withProviderModelSampling(proveedor, FLASH, con({ outputCap }), CON_DETALLE);
      expect(result.provider, outputCap).toBeNull();
      expect(result.error, outputCap).toMatch(/^Máximo de tokens de este modelo: /);
      expect(result.error, outputCap).toContain('sin puntos ni comas');
    }
    // los espacios de alrededor no son parte del numero
    expect(
      withProviderModelSampling(proveedor, FLASH, con({ outputCap: ' 16384 ' }), CON_DETALLE)
        .provider?.modelOutputCaps,
    ).toEqual({ [FLASH]: 16384 });
    // y un campo con solo espacios sigue siendo vacio: sin tope propio
    const enBlanco = withProviderModelSampling(
      proveedor,
      FLASH,
      con({ outputCap: '   ' }),
      CON_DETALLE,
    );
    expect(enBlanco.error).toBeNull();
    expect('modelOutputCaps' in (enBlanco.provider ?? {})).toBe(false);
  });

  it('los fallos de muestreo nombran su campo, y el del modelo se dice una vez', () => {
    const fuera = withProviderModelSampling(
      proveedor,
      FLASH,
      con({ temperature: '2,5' }),
      CON_DETALLE,
    );
    expect(fuera.provider).toBeNull();
    expect(fuera.error).toMatch(/^Temperatura: /);

    expect(
      withProviderModelSampling(proveedor, '   ', emptyProviderModelDraft(), CON_DETALLE).error,
    ).toBe('Elige el modelo.');
    // el nombre falla en los DOS mapas con el mismo texto
    const raro = withProviderModelSampling(
      proveedor,
      'modelo con espacios',
      con({ temperature: '1', outputCap: '16384' }),
      CON_DETALLE,
    );
    expect(raro.provider).toBeNull();
    expect(raro.error).toBe('modelo no valido');
  });

  it('un modelo con nombre del prototipo es una entrada como otra cualquiera', () => {
    const result = withProviderModelSampling(
      proveedor,
      'constructor',
      con({ temperature: '1', outputCap: '8192' }),
      CON_DETALLE,
    );
    expect(result.error).toBeNull();
    expect(Object.keys(result.provider?.modelSampling ?? {})).toEqual(['constructor']);
    expect(providerModelSettings(result.provider!)).toEqual([
      { apiModel: 'constructor', sampling: { temperature: 1 }, outputCap: 8192 },
    ]);
    // y uno que no tiene nada no saca una funcion del prototipo
    expect(providerModelSettings(proveedor)).toEqual([]);
  });

  it('la lista junta los dos mapas: una fila por modelo, con su resumen', () => {
    const filas = providerModelSettings({
      modelSampling: {
        [FLASH]: { reasoningMode: 'high', temperature: 0.7 },
        [RARO]: { temperature: 1 },
      },
      modelOutputCaps: { [THINKING]: 16384, [FLASH]: 32768 },
    });
    // primero los que tienen muestreo, despues los que solo tienen tope
    expect(filas).toEqual([
      { apiModel: FLASH, sampling: { reasoningMode: 'high', temperature: 0.7 }, outputCap: 32768 },
      { apiModel: RARO, sampling: { temperature: 1 }, outputCap: undefined },
      { apiModel: THINKING, sampling: undefined, outputCap: 16384 },
    ]);
    expect(filas.map(describeProviderModelSettings)).toEqual([
      'Temperatura 0,7 · Razonamiento: más (high) · Máximo de tokens 32768',
      'Temperatura 1',
      'Máximo de tokens 16384',
    ]);
    expect(describeProviderModelSettings({ sampling: undefined, outputCap: undefined })).toBe(
      'sin parámetros',
    );
    // un modelo sin nada abre el borrador vacio
    expect(providerModelSettingsToDraft(undefined)).toEqual(emptyProviderModelDraft());
    expect(emptyProviderModelDraft().outputCap).toBe('');
  });

  it('avisa de un tope corto solo cuando el nivel elegido razona', () => {
    expect(REASONING_OUTPUT_CAP_FLOOR).toBe(8192);
    // el tope efectivo es el del proveedor mientras el campo va vacio
    expect(reasoningOutputCapIsShort('high', '', 4096)).toBe(true);
    expect(reasoningOutputCapIsShort('high', '', 8192)).toBe(false);
    // y el del modelo en cuanto trae un numero, hacia arriba y hacia abajo
    expect(reasoningOutputCapIsShort('high', '16384', 4096)).toBe(false);
    expect(reasoningOutputCapIsShort('max', '4096', 16384)).toBe(true);
    // vacio no manda nada y «Sin razonar» no gasta: no hay de que avisar
    expect(reasoningOutputCapIsShort('', '', 4096)).toBe(false);
    expect(reasoningOutputCapIsShort('off', '', 4096)).toBe(false);
    // un numero a medio escribir lo explica el error al guardar, no este aviso
    expect(reasoningOutputCapIsShort('high', '-', 4096)).toBe(false);
  });

  it('no avisa de un tope corto con un texto que el guardado va a rechazar', () => {
    // leidos con `Number()` daban 300, 300, 1000 y 4096: el aviso hablaba de un
    // tope que nunca iba a llegar a `config.json`
    for (const outputCap of ['300.000', '300,000', '1e3', '0x1000']) {
      expect(reasoningOutputCapIsShort('high', outputCap, 16384), outputCap).toBe(false);
    }
    // con espacios alrededor sigue siendo su numero, igual que al guardar
    expect(reasoningOutputCapIsShort('high', ' 4096 ', 16384)).toBe(true);
  });

  it('una conexion en un host con dialecto no guarda niveles: su catalogo no se lee', () => {
    const enNano = connectionProfileSchema.parse({
      id: 'nano',
      displayName: 'Nano',
      baseUrl: NANO_URL,
    });
    const nivel = withModelSampling(enNano, FLASH, {
      ...emptySamplingDraft(),
      reasoningMode: 'high',
    });
    expect(nivel.connection).toBeNull();
    expect(nivel.error).toContain('sólo lo lee para un proveedor HTTP');
    // el resto del muestreo se guarda como en cualquier conexion
    const temperatura = withModelSampling(enNano, FLASH, {
      ...emptySamplingDraft(),
      temperature: '0,9',
    });
    expect(temperatura.connection?.modelSampling).toEqual({ [FLASH]: { temperature: 0.9 } });
  });
});

// las sugerencias del campo «Modelo» al añadir un ajuste: salen del catalogo
// guardado del proveedor, que en un agregador trae cientos de nombres
describe('sugerencias de modelo sacadas del catalogo guardado', () => {
  it('pone primero los que declaran niveles, y respeta el orden del catalogo en cada grupo', () => {
    // en el catalogo van FLASH, CYDONIA, THINKING y RARO: declaran niveles el
    // primero y el ultimo
    expect(providerModelSuggestions(CON_DETALLE.snapshot, [])).toEqual([
      FLASH,
      RARO,
      CYDONIA,
      THINKING,
    ]);
    // leido sin detalle nadie declara nada: queda el orden del catalogo
    expect(providerModelSuggestions(SIN_DETALLE.snapshot, [])).toEqual([FLASH, CYDONIA]);
  });

  it('no sugiere los que ya tienen ajuste: escribirlos otra vez pisaria el que hay', () => {
    expect(providerModelSuggestions(CON_DETALLE.snapshot, [FLASH, THINKING])).toEqual([
      RARO,
      CYDONIA,
    ]);
  });

  it('un nombre repetido en el catalogo sale una sola vez, y sin catalogo no sale nada', () => {
    const snapshot = CON_DETALLE.snapshot!;
    const repetido = { ...snapshot, models: [...snapshot.models, ...snapshot.models] };
    expect(providerModelSuggestions(repetido, [])).toEqual([FLASH, RARO, CYDONIA, THINKING]);
    expect(providerModelSuggestions(null, [])).toEqual([]);
  });
});

// la linea de SOLO LECTURA de Privado, bajo «Modelo»: con que nivel y con que
// tope va a contestar ese modelo, y donde se cambian. Sale de la configuracion,
// y tiene que decir lo que Luxy PIDE, no lo que el modelo hace (`D-093`).
describe('la linea de Privado con el nivel y el tope de un proveedor HTTP', () => {
  function configCon(http: HttpProviderConfig[]): StoredAgentConfig {
    return storedAgentConfigSchema.parse({
      machineName: 'portatil',
      gatewayUrl: 'https://example.com',
      providers: { http },
    });
  }

  const DONDE =
    'Se cambian en Conexiones, en la tarjeta de NanoGPT: «Ajustes por modelo» para este modelo, ' +
    '«Editar» para todo el proveedor.';

  // lo unico que el renderer sabe de las claves: que nombres estan guardados
  const CON_CLAVE = { LUXY_HTTP_NANOGPT_API_KEY: true, LUXY_HTTP_GROQ_API_KEY: true };

  it('con ajuste propio dice el nivel que Luxy pide, el tope del modelo y donde se cambian', () => {
    const config = configCon([
      nanogpt({
        modelSampling: { [FLASH]: { reasoningMode: 'high' } },
        modelOutputCaps: { [FLASH]: 16384 },
      }),
    ]);
    expect(effectiveModelSettingsLine(config, 'nanogpt', FLASH, CON_CLAVE)).toBe(
      `${FLASH}: Luxy pide el nivel de razonamiento «más (high)», el de su ajuste propio; el ` +
        `máximo de salida es de 16384 tokens, el de este modelo. ${DONDE}`,
    );
  });

  it('sin elegir modelo habla del predeterminado, y sin nivel dice que no se envia ninguno', () => {
    const config = configCon([nanogpt()]);
    const esperado =
      `${CYDONIA} (el modelo por defecto de NanoGPT): Luxy no envía ningún nivel de ` +
      `razonamiento; el máximo de salida es de 4096 tokens, el del proveedor. ${DONDE}`;
    expect(effectiveModelSettingsLine(config, 'nanogpt', null, CON_CLAVE)).toBe(esperado);
    // la cadena vacia del selector es lo mismo que no haber elegido
    expect(effectiveModelSettingsLine(config, 'nanogpt', '', CON_CLAVE)).toBe(esperado);
  });

  it('un nivel guardado que NO viaja se dice como guardado y sin enviar, nunca como pedido', () => {
    // el nivel de proveedor en NanoGPT: el agente no lo manda
    const config = configCon([nanogpt({ reasoningMode: 'high' })]);
    const linea = effectiveModelSettingsLine(config, 'nanogpt', FLASH, CON_CLAVE);
    expect(linea).toContain(
      'tiene guardado el nivel de razonamiento «más (high)» en el proveedor, pero Luxy no lo ' +
        'envía con este modelo',
    );
    expect(linea).not.toContain('Luxy pide');
  });

  it('un nivel del proveedor que SI viaja se dice de quien es', () => {
    const config = configCon([
      httpProviderConfigSchema.parse({
        id: 'groq',
        displayName: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'qwen/qwen3.8-27b',
        apiKeyEnv: 'LUXY_HTTP_GROQ_API_KEY',
        enabled: true,
        reasoningMode: 'low',
      }),
    ]);
    const linea = effectiveModelSettingsLine(config, 'groq', null, CON_CLAVE);
    expect(linea).toContain('Luxy pide el nivel de razonamiento «poco (low)», el del proveedor');
    expect(linea).toContain('en la tarjeta de Groq');
  });

  it('no pinta nada para lo que no es una entrada de providers.http', () => {
    const config = configCon([nanogpt()]);
    expect(effectiveModelSettingsLine(null, 'nanogpt', FLASH, CON_CLAVE)).toBeNull();
    // los CLI y las familias de una conexion no guardan estos ajustes ahi
    expect(effectiveModelSettingsLine(config, 'claude', 'opus', CON_CLAVE)).toBeNull();
    expect(
      effectiveModelSettingsLine(config, 'deepseek', 'DeepSeek-V4-Flash', CON_CLAVE),
    ).toBeNull();
  });

  it('no pinta nada si la entrada esta apagada o no tiene su clave guardada', () => {
    // el agente no registra esa entrada, y entonces ese mismo id puede servirlo
    // la familia de una conexion, con otra URL y otro tope: la linea describiria
    // una entrada que no es la que ejecuta
    const ajustes = {
      modelSampling: { [FLASH]: { reasoningMode: 'high' } },
      modelOutputCaps: { [FLASH]: 16384 },
    };
    const apagada = configCon([nanogpt({ ...ajustes, enabled: false })]);
    expect(effectiveModelSettingsLine(apagada, 'nanogpt', FLASH, CON_CLAVE)).toBeNull();

    const encendida = configCon([nanogpt(ajustes)]);
    expect(effectiveModelSettingsLine(encendida, 'nanogpt', FLASH, {})).toBeNull();
    // la clave de OTRA entrada no vale por la suya, y un `false` no es tenerla
    expect(
      effectiveModelSettingsLine(encendida, 'nanogpt', FLASH, { LUXY_HTTP_GROQ_API_KEY: true }),
    ).toBeNull();
    expect(
      effectiveModelSettingsLine(encendida, 'nanogpt', FLASH, { LUXY_HTTP_NANOGPT_API_KEY: false }),
    ).toBeNull();
    // encendida y con su clave, la linea de siempre
    expect(effectiveModelSettingsLine(encendida, 'nanogpt', FLASH, CON_CLAVE)).toContain(
      'Luxy pide el nivel de razonamiento «más (high)», el de su ajuste propio',
    );
  });

  it('no afirma que el modelo razone, que lo admita ni que nada este comprobado', () => {
    const config = configCon([
      nanogpt({ reasoningMode: 'low', modelSampling: { [FLASH]: { reasoningMode: 'max' } } }),
    ]);
    for (const model of [FLASH, CYDONIA, null]) {
      const linea = effectiveModelSettingsLine(config, 'nanogpt', model, CON_CLAVE) ?? '';
      expect(linea, String(model)).not.toMatch(/admit|verificad|comprobad|\brazona\b/i);
    }
  });

  it('sin nombre visible que decir usa el que se le da', () => {
    expect(
      describeEffectiveModelSettings(
        {
          model: 'm',
          usesProviderDefault: false,
          reasoningMode: 'off',
          reasoningSource: 'model',
          reasoningTravels: true,
          outputCap: 8192,
          outputCapSource: 'provider',
        },
        'Mi proveedor',
      ),
    ).toBe(
      'm: Luxy pide el nivel de razonamiento «sin razonar», el de su ajuste propio; el máximo ' +
        'de salida es de 8192 tokens, el del proveedor. Se cambian en Conexiones, en la tarjeta ' +
        'de Mi proveedor: «Ajustes por modelo» para este modelo, «Editar» para todo el proveedor.',
    );
  });
});
