// pruebas del catalogo real leido de una pasarela.
//
// POR QUE EXISTE: el catalogo escrito a mano dice 8.192 tokens de salida para
// todos los modelos y nunca se verifico; un trabajo real acabo justo ahi. Esto
// lee lo que la pasarela dice de verdad. Como la respuesta viene de un tercero
// que puede cambiarla sin avisar, lo que se prueba es que un campo raro no tire
// el catalogo entero.
import { describe, it, expect } from 'vitest';
import { reasoningOptionsFor } from '../reasoning-control.js';
import {
  basicCatalogModelsUrl,
  buildCatalogSnapshot,
  catalogModelsUrl,
  catalogReasoningFor,
  catalogSnapshotSchema,
  describeModelBilling,
  describePricingProbes,
  guessDisplayGroup,
  parseProviderModelEntries,
  parseProviderModelReport,
  parseProviderModels,
} from './catalog-fetch.js';

const MODELOS = {
  object: 'list',
  data: [
    { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek' },
    { id: 'Kimi-K2.6', object: 'model' },
    { id: 'glm-5.2', object: 'model', campo_desconocido: 'lo que sea' },
  ],
};

const PRECIOS = {
  success: true,
  data: [
    { model_name: 'deepseek-chat', quota_type: 0, model_ratio: 0.5, completion_ratio: 2 },
    { model_name: 'Kimi-K2.6', quota_type: 1, model_price: 0.03 },
  ],
};

describe('parseProviderModels', () => {
  it('lee los identificadores y conserva los que traen campos de mas', () => {
    expect(parseProviderModels(MODELOS)).toEqual(['deepseek-chat', 'Kimi-K2.6', 'glm-5.2']);
  });

  it('una respuesta rota no revienta: devuelve lista vacia', () => {
    expect(parseProviderModels(null)).toEqual([]);
    expect(parseProviderModels({ error: 'unauthorized' })).toEqual([]);
    expect(parseProviderModels('texto')).toEqual([]);
  });

  it('descarta entradas sin identificador sin perder las buenas', () => {
    const mezcla = { data: [{ id: 'bueno' }, { sin_id: true }, { id: 42 }] };
    expect(parseProviderModels(mezcla)).toEqual(['bueno']);
  });
});

describe('buildCatalogSnapshot', () => {
  const snapshot = buildCatalogSnapshot({
    connectionId: 'hcnsec',
    fetchedAt: '2026-08-06T14:00:00.000Z',
    modelsPayload: MODELOS,
    pricingPayload: PRECIOS,
  });

  it('cruza modelos servidos con sus precios', () => {
    expect(snapshot.models).toHaveLength(3);
    expect(snapshot.pricingAvailable).toBe(true);

    const deepseek = snapshot.models.find((model) => model.apiModel === 'deepseek-chat');
    expect(deepseek?.billing).toBe('token');
    expect(deepseek?.modelRatio).toBe(0.5);
    expect(deepseek?.completionRatio).toBe(2);
  });

  it('distingue el cobro por llamada del cobro por tokens', () => {
    const kimi = snapshot.models.find((model) => model.apiModel === 'Kimi-K2.6');
    expect(kimi?.billing).toBe('call');
    expect(kimi?.perCall).toBe(0.03);
  });

  it('un modelo servido sin precio entra igual, marcado como desconocido', () => {
    const glm = snapshot.models.find((model) => model.apiModel === 'glm-5.2');
    expect(glm?.billing).toBe('unknown');
    expect(glm?.modelRatio).toBeNull();
  });

  it('manda la lista de modelos servidos: un precio suelto no inventa un modelo', () => {
    const conFantasma = buildCatalogSnapshot({
      connectionId: 'hcnsec',
      fetchedAt: '2026-08-06T14:00:00.000Z',
      modelsPayload: { data: [{ id: 'deepseek-chat' }] },
      pricingPayload: {
        data: [{ model_name: 'deepseek-chat' }, { model_name: 'modelo-que-no-sirve' }],
      },
    });
    expect(conFantasma.models.map((model) => model.apiModel)).toEqual(['deepseek-chat']);
  });

  it('sin consultar precios sigue habiendo catalogo', () => {
    const sinPrecios = buildCatalogSnapshot({
      connectionId: 'hcnsec',
      fetchedAt: '2026-08-06T14:00:00.000Z',
      modelsPayload: MODELOS,
      pricingPayload: null,
      notice: 'la pasarela no sirve precios',
    });
    expect(sinPrecios.models).toHaveLength(3);
    expect(sinPrecios.pricingAvailable).toBe(false);
    expect(sinPrecios.notice).toContain('no sirve precios');
    expect(sinPrecios.models.every((model) => model.billing === 'unknown')).toBe(true);
    expect(sinPrecios.pricingProbes).toBeUndefined();
  });

  it('una respuesta de precios con otra forma no rompe nada', () => {
    const raro = buildCatalogSnapshot({
      connectionId: 'hcnsec',
      fetchedAt: '2026-08-06T14:00:00.000Z',
      modelsPayload: MODELOS,
      // la pasarela podria devolver `model` en vez de `model_name`
      pricingPayload: { data: [{ model: 'glm-5.2', quota_type: 0, model_ratio: 1 }] },
    });
    expect(raro.models.find((model) => model.apiModel === 'glm-5.2')?.modelRatio).toBe(1);
    expect(raro.pricingAvailable).toBe(true);
  });

  it('cuenta las filas de /v1/models que ni siquiera se pudieron leer', () => {
    // el aviso de pantalla contaba solo lo que descartaba `buildCatalogReport`,
    // y para entonces esto ya se habia caido en silencio. Sirviendo estas seis
    // entradas el catalogo acababa con dos modelos y el aviso decia que faltaba
    // UNO. Faltaban cuatro
    const sucio = buildCatalogSnapshot({
      connectionId: 'pasarela',
      fetchedAt: '2026-09-15T10:00:00.000Z',
      modelsPayload: {
        data: [
          { id: 'kimi-k3' },
          { id: 'z'.repeat(150) },
          { id: 'z'.repeat(250) },
          { id: 42 },
          'basura-suelta',
          { id: 'glm-5' },
        ],
      },
      pricingPayload: null,
    });
    expect(sucio.models.map((model) => model.apiModel)).toEqual([
      'kimi-k3',
      'z'.repeat(150),
      'glm-5',
    ]);
    expect(sucio.unreadableModels).toBe(3);
  });

  it('un catalogo limpio no lleva el recuento', () => {
    const limpio = buildCatalogSnapshot({
      connectionId: 'hcnsec',
      fetchedAt: '2026-09-15T10:00:00.000Z',
      modelsPayload: MODELOS,
      pricingPayload: null,
    });
    expect(limpio.unreadableModels).toBeUndefined();
  });
});

describe('guessDisplayGroup', () => {
  it('agrupa por nombre, solo para pintar', () => {
    expect(guessDisplayGroup('deepseek-chat')).toBe('deepseek');
    expect(guessDisplayGroup('Kimi-K2.6')).toBe('kimi');
    expect(guessDisplayGroup('moonshot-v1-128k')).toBe('kimi');
    expect(guessDisplayGroup('glm-5.2')).toBe('glm');
    expect(guessDisplayGroup('qwen-max')).toBe('qwen');
    expect(guessDisplayGroup('kat-coder-pro-v2.5')).toBe('kat');
    expect(guessDisplayGroup('claude-sonnet-4')).toBe('claude');
    expect(guessDisplayGroup('gpt-4o')).toBe('openai');
    expect(guessDisplayGroup('algo-raro')).toBe('otros');
  });
});

describe('describeModelBilling', () => {
  const base = {
    apiModel: 'x',
    ownedBy: null,
    modelRatio: null,
    completionRatio: null,
    perCall: null,
    groups: [],
  };

  it('dice como se cobra sin inventar cifras', () => {
    expect(describeModelBilling({ ...base, billing: 'unknown' })).toContain('no declarado');
    expect(describeModelBilling({ ...base, billing: 'call', perCall: 0.03 })).toContain('0.03');
    expect(
      describeModelBilling({ ...base, billing: 'token', modelRatio: 0.5, completionRatio: 2 }),
    ).toContain('x2');
  });
});

describe('diagnostico de precios', () => {
  it('dice que contesto cada ruta, que es lo que faltaba', () => {
    const frase = describePricingProbes([
      { url: '/api/pricing', status: 200, topLevelKeys: ['success', 'data'], entryCount: 0 },
      { url: '/pricing', status: 404, topLevelKeys: [], entryCount: 0 },
      { url: '/api/models', status: null, topLevelKeys: [], entryCount: 0 },
    ]);
    expect(frase).toContain('/api/pricing: 200 con 0 entradas');
    expect(frase).toContain('/pricing: HTTP 404');
    expect(frase).toContain('/api/models: sin respuesta');
  });

  it('el diagnostico viaja con el catalogo', () => {
    const probes = [{ url: '/api/pricing', status: 200, topLevelKeys: ['data'], entryCount: 0 }];
    const snapshot = buildCatalogSnapshot({
      connectionId: 'hcnsec',
      fetchedAt: '2026-08-07T06:08:35.064Z',
      modelsPayload: MODELOS,
      pricingPayload: null,
      pricingProbes: probes,
    });
    expect(snapshot.pricingProbes).toEqual(probes);
  });
});

describe('familias de los 19 modelos actuales', () => {
  it('agrupa los que la primera lectura dejo en "otros"', () => {
    // los 22 de la lectura del 2026-08-07: 14 caian en "otros" porque step,
    // minimax y sensenova no estaban contemplados
    expect(guessDisplayGroup('step-3.7-flash')).toBe('step');
    expect(guessDisplayGroup('step-explore')).toBe('step');
    expect(guessDisplayGroup('stepaudio-2.5-tts')).toBe('step-media');
    expect(guessDisplayGroup('step-image-edit-2')).toBe('step-media');
    expect(guessDisplayGroup('MiniMax-M3')).toBe('minimax');
    expect(guessDisplayGroup('sensenova-u1.5-lite')).toBe('sensenova');
    expect(guessDisplayGroup('auto')).toBe('router');
  });

  it('ningun modelo real acaba en "otros"', () => {
    const REALES = [
      'auto',
      'DeepSeek-V4-Flash',
      'DeepSeek-V4-Pro',
      'glm-4.5-air',
      'kat-coder-pro-v2.5',
      'kimi-k3',
      'MiniMax-M3',
      'Qwen3-Embedding-8B',
      'Qwen3.8-27B',
      'sensenova-6.8-flash-lite',
      'sensenova-u1.5-lite',
      'step-3.7-flash',
      'step-explore',
      'step-image-edit-2',
      'step-router-v1',
      'stepaudio-2.5-asr',
      'stepaudio-2.5-chat',
      'stepaudio-2.5-realtime',
      'stepaudio-2.5-tts',
    ];
    expect(REALES).toHaveLength(19);
    for (const modelo of REALES) {
      expect(guessDisplayGroup(modelo)).not.toBe('otros');
    }
  });
});

describe('familia de Mistral', () => {
  // sin esto sus modelos caian en «otros», y el selector de modelo de Privado
  // salia vacio con Mistral elegido: `mistral` SI es una de nuestras familias,
  // asi que ahi familia e identificador coinciden y la confusion no se notaba
  it('reconoce los nombres reales, no solo los que dicen «mistral»', () => {
    for (const modelo of [
      'mistral-large-latest',
      'mistral-medium-latest',
      'pixtral-12b-2409',
      'pixtral-large-latest',
      'ministral-8b-latest',
      'magistral-medium-latest',
      'codestral-latest',
      'devstral-small-latest',
    ]) {
      expect(guessDisplayGroup(modelo)).toBe('mistral');
    }
  });

  it('no se traga modelos de otra familia', () => {
    expect(guessDisplayGroup('DeepSeek-V4-Pro')).toBe('deepseek');
    expect(guessDisplayGroup('kimi-k3')).toBe('kimi');
  });
});

// F36. POR QUE EXISTEN: para elegir cuanto razona un modelo de NanoGPT hay que
// saber que niveles declara, y eso solo lo trae su lista CON DETALLE. Lo que no
// puede pasar: que a otro host se le pida algo distinto de lo de siempre, que
// un dato raro de un tercero cueste un modelo o el catalogo entero, que un
// catalogo guardado antes deje de leerse, y que «no lo dice» se lea como «no».

// la FORMA es la de `GET /api/v1/models?detailed=true` de NanoGPT, leida el
// 13/10/2026; los textos y las cifras de precio estan inventados
const capacidades = (reasoning: boolean, tools: boolean): Record<string, boolean> => ({
  vision: false,
  video_input: false,
  audio_input: false,
  reasoning,
  tool_calling: tools,
  parallel_tool_calls: false,
  structured_output: tools,
  pdf_upload: false,
  batch_api: true,
});

const comun = {
  object: 'model',
  architecture: {
    modality: 'text->text',
    input_modalities: ['text'],
    output_modalities: ['text'],
  },
  open_weights: true,
  supported_service_tiers: [],
  supported_batch_endpoints: ['/v1/chat/completions'],
  pricing: { prompt: 0.14, completion: 0.28, currency: 'USD', unit: 'per_million_tokens' },
  cost_estimate: 0.0004,
  providers: ['uno', 'otro'],
  subscription: { included: true, inputTokenMultiplier: 1, note: 'Included in subscription' },
};

const DETALLADA = {
  object: 'list',
  data: [
    {
      ...comun,
      id: 'deepseek/deepseek-v4-flash',
      created: 1776988800,
      owned_by: 'deepseek',
      name: 'DeepSeek V4 Flash',
      description: 'Texto de ejemplo.',
      context_length: 1048576,
      max_output_tokens: 384000,
      capabilities: capacidades(true, true),
      reasoning_efforts: ['none', 'high', 'max'],
      icon_url: '/icons/DeepSeek.svg',
    },
    {
      // el predeterminado de la entrada: no razona, sin niveles, tope sin declarar
      ...comun,
      id: 'TheDrummer/Cydonia-24B-v4.3',
      created: 1766620800,
      owned_by: 'mistral',
      name: 'The Drummer Cydonia 24B v4.3',
      description: 'Texto de ejemplo.',
      context_length: 32768,
      max_output_tokens: null,
      capabilities: capacidades(false, false),
      icon_url: '/icons/Mistral.svg',
      category: 'Roleplay/storytelling models',
    },
    {
      // razona y NO declara niveles: hay 155 asi
      ...comun,
      id: 'deepseek/deepseek-v3.2:thinking',
      created: 1764547200,
      owned_by: 'deepseek',
      name: 'DeepSeek V3.2 Thinking',
      description: 'Texto de ejemplo.',
      context_length: 163000,
      max_output_tokens: 65536,
      capabilities: capacidades(true, true),
      icon_url: '/icons/DeepSeek.svg',
      category: 'More',
    },
  ],
};

// la lista simple del mismo host: solo esto por modelo
const SIMPLE = {
  object: 'list',
  data: DETALLADA.data.map((model) => ({
    id: model.id,
    object: 'model',
    created: model.created,
    owned_by: model.owned_by,
  })),
};

const FECHA = '2026-10-13T09:17:00.000Z';

describe('ruta del catalogo', () => {
  it('a NanoGPT se le pide la lista con detalle', () => {
    const detallada = {
      url: 'https://api.nano-gpt.com/api/v1/models?detailed=true',
      detailed: true,
    };
    expect(catalogModelsUrl('https://api.nano-gpt.com/api/v1')).toEqual(detallada);
    // con barra final, o con varias, sale la misma
    expect(catalogModelsUrl('https://api.nano-gpt.com/api/v1/')).toEqual(detallada);
    expect(catalogModelsUrl('https://api.nano-gpt.com/api/v1///')).toEqual(detallada);
    expect(catalogModelsUrl('https://API.Nano-GPT.com:443/api/v1')).toEqual(detallada);
    // el host de la web tiene el mismo dialecto, y se le pregunta a EL
    expect(catalogModelsUrl('https://nano-gpt.com/api/v1')).toEqual({
      url: 'https://nano-gpt.com/api/v1/models?detailed=true',
      detailed: true,
    });
    // solo el literal `true` activa el detalle: sale del dialecto, no de aqui
    expect(new URL(detallada.url).searchParams.get('detailed')).toBe('true');
  });

  it('una base de NanoGPT con consulta propia no se rompe al añadir el detalle', () => {
    // la base de una conexion —no la de un proveedor HTTP— puede traerla, y
    // pegarle `?detailed=true` detras daria `?sort=favorites/models?detailed=true`
    expect(catalogModelsUrl('https://api.nano-gpt.com/api/v1?sort=favorites')).toEqual({
      url: 'https://api.nano-gpt.com/api/v1/models?sort=favorites&detailed=true',
      detailed: true,
    });
    // si ya lo trae con otro valor, se queda el del dialecto y no se repite
    expect(catalogModelsUrl('https://api.nano-gpt.com/api/v1/?detailed=1#ancla').url).toBe(
      'https://api.nano-gpt.com/api/v1/models?detailed=true',
    );
  });

  it('a los demas hosts se les pide exactamente lo de siempre, byte a byte', () => {
    const bases = [
      'https://api.hcnsec.cn/v1',
      'https://api.groq.com/openai/v1/',
      'https://API.Example.com:443/v1//',
      'http://localhost:11434/v1',
      'https://api.mistral.ai/v1',
      'https://ejemplo.test/v1?x=1',
      'no-es-una-url',
      '',
    ];
    for (const base of bases) {
      // la concatenacion que hacia el proceso principal antes de F36
      const deSiempre = `${base.replace(/\/+$/, '')}/models`;
      expect(catalogModelsUrl(base), base).toEqual({ url: deSiempre, detailed: false });
      expect(basicCatalogModelsUrl(base), base).toBe(deSiempre);
    }
    // escrito entero, para que no dependa de repetir la formula: ni se baja la
    // caja del host ni se quita el puerto
    expect(catalogModelsUrl('https://API.Example.com:443/v1//').url).toBe(
      'https://API.Example.com:443/v1/models',
    );
    expect(catalogModelsUrl('https://api.groq.com/openai/v1/').url).toBe(
      'https://api.groq.com/openai/v1/models',
    );
  });

  it('un host que se parece al de NanoGPT no recibe el parametro', () => {
    for (const base of [
      'https://api.nano-gpt.com.example.org/api/v1',
      'https://www.nano-gpt.com/api/v1',
      'https://example.org/api.nano-gpt.com/v1',
      'https://example.org/v1?next=@api.nano-gpt.com',
    ]) {
      const { url, detailed } = catalogModelsUrl(base);
      expect(detailed, base).toBe(false);
      expect(url, base).toBe(basicCatalogModelsUrl(base));
      expect(url, base).not.toContain('detailed');
    }
  });

  it('NanoGPT escrito con el punto final recibe tambien la lista con detalle', () => {
    // es el mismo servidor, y `URL` conserva el punto: el parametro va a ESE
    // host, tal como esta escrito, y no a otro
    expect(catalogModelsUrl('https://api.nano-gpt.com./api/v1')).toEqual({
      url: 'https://api.nano-gpt.com./api/v1/models?detailed=true',
      detailed: true,
    });
  });

  it('el respaldo de NanoGPT es la lista simple, sin parametros', () => {
    expect(basicCatalogModelsUrl('https://api.nano-gpt.com/api/v1/')).toBe(
      'https://api.nano-gpt.com/api/v1/models',
    );
  });
});

describe('lo que declara una entrada detallada', () => {
  it('lee razonamiento, niveles y limites de la forma de NanoGPT', () => {
    // `toStrictEqual`: un modelo solo lleva las claves de las que hay dato
    expect(parseProviderModelEntries(DETALLADA)).toStrictEqual([
      {
        id: 'deepseek/deepseek-v4-flash',
        declaredCapabilities: ['batch_api', 'reasoning', 'structured_output', 'tool_calling'],
        reasoning: true,
        reasoningEfforts: ['none', 'high', 'max'],
        declaredOutputCap: 384000,
        declaredContext: 1048576,
      },
      {
        // `max_output_tokens: null` no es cero: no hay clave
        id: 'TheDrummer/Cydonia-24B-v4.3',
        declaredCapabilities: ['batch_api'],
        reasoning: false,
        declaredContext: 32768,
      },
      {
        id: 'deepseek/deepseek-v3.2:thinking',
        declaredCapabilities: ['batch_api', 'reasoning', 'structured_output', 'tool_calling'],
        reasoning: true,
        declaredOutputCap: 65536,
        declaredContext: 163000,
      },
    ]);
  });

  it('la lista simple no declara nada, y no gana ninguna clave', () => {
    expect(parseProviderModelEntries(SIMPLE)).toStrictEqual(
      DETALLADA.data.map((model) => ({ id: model.id, declaredCapabilities: [] })),
    );
    // contraste: la misma lista con detalle si las trae
    expect(parseProviderModelEntries(DETALLADA)[0]?.reasoningEfforts).toEqual([
      'none',
      'high',
      'max',
    ]);
  });

  it('llega al catalogo, y los precios de la entrada se ignoran', () => {
    const snapshot = buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: FECHA,
      modelsPayload: DETALLADA,
      pricingPayload: null,
      detail: 'detailed',
    });
    expect(snapshot.detail).toBe('detailed');
    expect(snapshot.models).toStrictEqual([
      {
        apiModel: 'deepseek/deepseek-v4-flash',
        ownedBy: null,
        billing: 'unknown',
        modelRatio: null,
        completionRatio: null,
        perCall: null,
        groups: [],
        declaredCapabilities: ['batch_api', 'reasoning', 'structured_output', 'tool_calling'],
        reasoning: true,
        reasoningEfforts: ['none', 'high', 'max'],
        declaredOutputCap: 384000,
        declaredContext: 1048576,
      },
      {
        apiModel: 'TheDrummer/Cydonia-24B-v4.3',
        ownedBy: null,
        billing: 'unknown',
        modelRatio: null,
        completionRatio: null,
        perCall: null,
        groups: [],
        declaredCapabilities: ['batch_api'],
        reasoning: false,
        declaredContext: 32768,
      },
      {
        apiModel: 'deepseek/deepseek-v3.2:thinking',
        ownedBy: null,
        billing: 'unknown',
        modelRatio: null,
        completionRatio: null,
        perCall: null,
        groups: [],
        declaredCapabilities: ['batch_api', 'reasoning', 'structured_output', 'tool_calling'],
        reasoning: true,
        declaredOutputCap: 65536,
        declaredContext: 163000,
      },
    ]);
    // `pricing` y `cost_estimate` vienen en la entrada y no se leen
    expect(snapshot.pricingAvailable).toBe(false);
  });

  it('sin decir con que lista se leyo, el catalogo no lleva la clave', () => {
    const sinDetalle = buildCatalogSnapshot({
      connectionId: 'hcnsec',
      fetchedAt: FECHA,
      modelsPayload: SIMPLE,
      pricingPayload: null,
    });
    expect('detail' in sinDetalle).toBe(false);
    const simple = buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: FECHA,
      modelsPayload: SIMPLE,
      pricingPayload: null,
      detail: 'basic',
    });
    expect(simple.detail).toBe('basic');
  });

  it('un dato raro cuesta el campo, nunca el modelo', () => {
    const raros = {
      data: [
        { id: 'niveles-que-no-son-lista', reasoning_efforts: 'high' },
        { id: 'niveles-objeto', reasoning_efforts: { 0: 'high', length: 1 } },
        {
          id: 'niveles-con-de-todo',
          reasoning_efforts: [
            'low',
            7,
            null,
            { nivel: 'high' },
            ['high'],
            ' max ',
            '',
            '   ',
            'x'.repeat(25),
            'low',
            true,
          ],
        },
        { id: 'niveles-vacios', reasoning_efforts: [] },
        { id: 'niveles-solo-numeros', reasoning_efforts: [1, 2, 3] },
        {
          id: 'niveles-de-sobra',
          reasoning_efforts: Array.from({ length: 40 }, (_, i) => `nivel-${i}`),
        },
        { id: 'tope-null', max_output_tokens: null, context_length: null },
        { id: 'tope-cero', max_output_tokens: 0, context_length: 0 },
        { id: 'tope-negativo', max_output_tokens: -4096, context_length: -1 },
        { id: 'tope-enorme', max_output_tokens: 1e30, context_length: 2 ** 53 + 2 },
        { id: 'tope-infinito', max_output_tokens: Infinity, context_length: Number.NaN },
        { id: 'tope-decimal', max_output_tokens: 4096.5, context_length: '32768' },
        { id: 'tope-grande-de-verdad', max_output_tokens: 1179648, context_length: 1048576 },
        { id: 'razona-texto', capabilities: { reasoning: 'yes', vision: true } },
        { id: 'razona-numero', capabilities: { reasoning: 1 } },
        { id: 'razona-null', capabilities: { reasoning: null } },
      ],
    };
    const { entries, unreadable } = parseProviderModelReport(raros);
    // no se pierde ni uno
    expect(unreadable).toBe(0);
    expect(entries.map((entry) => entry.id)).toEqual(raros.data.map((model) => model.id));

    const de = (id: string): Record<string, unknown> => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry === undefined) throw new Error(`falta ${id}`);
      return { ...entry };
    };
    const sinNada = (id: string): Record<string, unknown> => ({ id, declaredCapabilities: [] });

    for (const id of [
      'niveles-que-no-son-lista',
      'niveles-objeto',
      'niveles-vacios',
      'niveles-solo-numeros',
      'tope-null',
      'tope-cero',
      'tope-negativo',
      'tope-enorme',
      'tope-infinito',
      'tope-decimal',
      'razona-numero',
      'razona-null',
    ]) {
      // ni la clave: `toStrictEqual` distingue ausente de `undefined`
      expect(de(id), id).toStrictEqual(sinNada(id));
    }
    // dentro de una lista se salvan las cadenas, recortadas y sin repetir
    expect(de('niveles-con-de-todo')).toStrictEqual({
      ...sinNada('niveles-con-de-todo'),
      reasoningEfforts: ['low', 'max'],
    });
    // como mucho doce, los primeros
    expect(de('niveles-de-sobra')['reasoningEfforts']).toEqual(
      Array.from({ length: 12 }, (_, i) => `nivel-${i}`),
    );
    // un limite grande de verdad no se confunde con uno imposible
    expect(de('tope-grande-de-verdad')).toStrictEqual({
      ...sinNada('tope-grande-de-verdad'),
      declaredOutputCap: 1179648,
      declaredContext: 1048576,
    });
    // `reasoning: 'yes'` no es un booleano: ni entra como bandera ni como dato
    expect(de('razona-texto')).toStrictEqual({
      id: 'razona-texto',
      declaredCapabilities: ['vision'],
    });

    // y el catalogo entero sale, con todos
    const snapshot = buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: FECHA,
      modelsPayload: raros,
      pricingPayload: null,
      detail: 'detailed',
    });
    expect(snapshot.models).toHaveLength(raros.data.length);
    expect(snapshot.unreadableModels).toBeUndefined();
  });

  it('un `capabilities` que no es un objeto cuesta ese campo, no el modelo', () => {
    // el esquema de la fila lo exigia objeto: con un `null` —lo que manda una
    // pasarela cuando no lo sabe— fallaba la FILA y el modelo desaparecia del
    // catalogo, con sus niveles y sus limites, contado como ilegible
    const resto = {
      reasoning_efforts: ['none', 'high'],
      max_output_tokens: 65536,
      context_length: 163000,
    };
    const raros = {
      data: [
        { id: 'capacidades-null', capabilities: null, ...resto },
        { id: 'capacidades-cadena', capabilities: 'reasoning,vision', ...resto },
        { id: 'capacidades-lista', capabilities: ['reasoning', 'vision'], ...resto },
        { id: 'capacidades-numero', capabilities: 7, ...resto },
        { id: 'capacidades-booleano', capabilities: true, ...resto },
      ],
    };
    const { entries, unreadable } = parseProviderModelReport(raros);
    expect(unreadable).toBe(0);
    // se queda con todo lo demas. De sus capacidades no se sabe nada: ni una
    // bandera, ni la clave `reasoning`, que ausente no es `false`
    expect(entries).toStrictEqual(
      raros.data.map((model) => ({
        id: model.id,
        declaredCapabilities: [],
        reasoningEfforts: ['none', 'high'],
        declaredOutputCap: 65536,
        declaredContext: 163000,
      })),
    );

    // y llega al catalogo: sus niveles se pueden ofrecer
    const snapshot = buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: FECHA,
      modelsPayload: raros,
      pricingPayload: null,
      detail: 'detailed',
    });
    expect(snapshot.models.map((model) => model.apiModel)).toEqual(
      raros.data.map((model) => model.id),
    );
    expect(snapshot.unreadableModels).toBeUndefined();
    for (const model of raros.data) {
      expect(catalogReasoningFor(snapshot, model.id), model.id).toEqual({
        state: 'levels',
        levels: ['none', 'high'],
        fetchedAt: FECHA,
        outputCap: 65536,
      });
    }
  });

  it('un `owned_by` o un `created` raros tampoco cuestan el modelo', () => {
    // son dos campos que Luxy ni siquiera lee, y tumbaban la fila igual: hay
    // pasarelas que mandan `null` en los dos, o la fecha como texto
    const raros = {
      data: [
        { id: 'propietario-null', owned_by: null },
        { id: 'propietario-numero', owned_by: 42 },
        { id: 'propietario-objeto', owned_by: { name: 'deepseek' } },
        { id: 'propietario-largo', owned_by: 'x'.repeat(201) },
        { id: 'fecha-null', created: null },
        { id: 'fecha-texto', created: '2026-10-13T09:17:00Z' },
        { id: 'fecha-objeto', created: { seconds: 1776988800 } },
        {
          id: 'los-dos-y-con-datos',
          owned_by: null,
          created: null,
          capabilities: { reasoning: true, vision: true },
          reasoning_efforts: ['low'],
          max_output_tokens: 4096,
        },
      ],
    };
    const { entries, unreadable } = parseProviderModelReport(raros);
    expect(unreadable).toBe(0);
    expect(entries.map((entry) => entry.id)).toEqual(raros.data.map((model) => model.id));
    // y lo que si se lee de la fila sigue saliendo entero
    expect(entries.find((entry) => entry.id === 'los-dos-y-con-datos')).toStrictEqual({
      id: 'los-dos-y-con-datos',
      declaredCapabilities: ['reasoning', 'vision'],
      reasoning: true,
      reasoningEfforts: ['low'],
      declaredOutputCap: 4096,
    });
  });
});

describe('el catalogo guardado, con lo declarado', () => {
  const detallado = buildCatalogSnapshot({
    connectionId: 'nanogpt',
    source: 'http',
    fetchedAt: FECHA,
    modelsPayload: DETALLADA,
    pricingPayload: null,
    notice: 'Luxy no lee los precios de esta lista.',
    detail: 'detailed',
  });

  it('va y vuelve del disco entero', () => {
    const leido = catalogSnapshotSchema.parse(JSON.parse(JSON.stringify(detallado)));
    expect(leido).toStrictEqual(detallado);
    expect(leido.detail).toBe('detailed');
    expect(leido.models[0]?.reasoningEfforts).toEqual(['none', 'high', 'max']);
    expect(leido.models[1]?.reasoning).toBe(false);
  });

  it('uno guardado ANTES de F36 se lee igual y no gana ninguna clave', () => {
    // lo que escribia el proceso principal: sin `detail` y sin nada declarado
    const anterior = {
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: '2026-10-01T10:00:00.000Z',
      models: [
        {
          apiModel: 'TheDrummer/Cydonia-24B-v4.3',
          ownedBy: null,
          billing: 'unknown',
          modelRatio: null,
          completionRatio: null,
          perCall: null,
          groups: [],
          declaredCapabilities: [],
        },
        {
          // y uno todavia mas viejo, de antes de leer las capacidades
          apiModel: 'deepseek/deepseek-v4-flash',
          ownedBy: null,
          billing: 'unknown',
          modelRatio: null,
          completionRatio: null,
          perCall: null,
          groups: [],
        },
      ],
      pricingAvailable: false,
      notice: 'Esta conexion no publica precios por API; Luxy no los consulta.',
    };
    const leido = catalogSnapshotSchema.parse(JSON.parse(JSON.stringify(anterior)));
    expect(leido).toStrictEqual(anterior);
    expect('detail' in leido).toBe(false);
    for (const model of leido.models) {
      for (const key of ['reasoning', 'reasoningEfforts', 'declaredOutputCap', 'declaredContext']) {
        expect(key in model, `${model.apiModel} ${key}`).toBe(false);
      }
    }
    // y no pasa por detallado: de ese catalogo no se puede decir que un modelo
    // no declare niveles
    expect(catalogReasoningFor(leido, 'deepseek/deepseek-v4-flash')).toEqual({
      state: 'basic',
      levels: [],
      fetchedAt: '2026-10-01T10:00:00.000Z',
      outputCap: null,
    });
  });

  it('un campo declarado que no casa en el disco cuesta ese campo, no el catalogo', () => {
    const sucio = JSON.parse(JSON.stringify(detallado)) as {
      detail: unknown;
      models: Record<string, unknown>[];
    };
    sucio.detail = 'completisimo';
    Object.assign(sucio.models[0] ?? {}, {
      reasoning: 'si',
      reasoningEfforts: 'high',
      declaredOutputCap: -5,
      declaredContext: 1.5,
    });
    Object.assign(sucio.models[2] ?? {}, {
      reasoningEfforts: ['high', 7],
      declaredOutputCap: 1e30,
    });

    const leido = catalogSnapshotSchema.safeParse(sucio);
    expect(leido.success).toBe(true);
    if (!leido.success) return;
    expect(leido.data.models).toHaveLength(3);
    // un `detail` desconocido se lee como «no se sabe», que no es detallado
    expect(leido.data.detail).toBeUndefined();
    const [primero, segundo, tercero] = leido.data.models;
    expect(primero?.apiModel).toBe('deepseek/deepseek-v4-flash');
    expect(primero?.reasoning).toBeUndefined();
    expect(primero?.reasoningEfforts).toBeUndefined();
    expect(primero?.declaredOutputCap).toBeUndefined();
    expect(primero?.declaredContext).toBeUndefined();
    // el de al lado, que estaba bien, no paga por el
    expect(segundo).toStrictEqual(detallado.models[1]);
    // y dentro de un modelo, el campo bueno se queda
    expect(tercero?.reasoning).toBe(true);
    expect(tercero?.declaredContext).toBe(163000);
    expect(tercero?.reasoningEfforts).toBeUndefined();
    expect(tercero?.declaredOutputCap).toBeUndefined();

    // la tolerancia es de los campos nuevos, no del esquema entero: lo que ya
    // rompia el catalogo lo sigue rompiendo
    const sinModelo = JSON.parse(JSON.stringify(detallado)) as { models: unknown };
    sinModelo.models = [{ reasoning: true }];
    expect(catalogSnapshotSchema.safeParse(sinModelo).success).toBe(false);
  });
});

describe('que se sabe del razonamiento de un modelo', () => {
  const detallado = buildCatalogSnapshot({
    connectionId: 'nanogpt',
    source: 'http',
    fetchedAt: FECHA,
    modelsPayload: DETALLADA,
    pricingPayload: null,
    detail: 'detailed',
  });

  it('sin catalogo: missing', () => {
    for (const nada of [null, undefined]) {
      expect(catalogReasoningFor(nada, 'deepseek/deepseek-v4-flash')).toEqual({
        state: 'missing',
        levels: [],
        fetchedAt: null,
        outputCap: null,
      });
    }
  });

  it('catalogo leido sin detalle: basic, aunque el modelo este', () => {
    const simple = buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: FECHA,
      modelsPayload: SIMPLE,
      pricingPayload: null,
      detail: 'basic',
    });
    for (const model of ['deepseek/deepseek-v4-flash', 'no-esta-en-la-lista']) {
      expect(catalogReasoningFor(simple, model), model).toEqual({
        state: 'basic',
        levels: [],
        fetchedAt: FECHA,
        outputCap: null,
      });
    }
    // sin la marca tampoco es detallado, traiga lo que traiga
    const sinMarca = { ...detallado };
    delete sinMarca.detail;
    expect(catalogReasoningFor(sinMarca, 'deepseek/deepseek-v4-flash')).toEqual({
      state: 'basic',
      levels: [],
      fetchedAt: FECHA,
      outputCap: 384000,
    });
  });

  it('el identificador no esta: unknown-model, comparado exacto', () => {
    for (const model of [
      'deepseek/DeepSeek-V4-Flash',
      'deepseek/deepseek-v4-flash:thinking',
      'deepseek-v4-flash',
      ' deepseek/deepseek-v4-flash',
      'toString',
      '',
    ]) {
      expect(catalogReasoningFor(detallado, model), model).toEqual({
        state: 'unknown-model',
        levels: [],
        fetchedAt: FECHA,
        outputCap: null,
      });
    }
  });

  it('declara que no razona y ningun nivel: not-reasoning', () => {
    expect(catalogReasoningFor(detallado, 'TheDrummer/Cydonia-24B-v4.3')).toEqual({
      state: 'not-reasoning',
      levels: [],
      fetchedAt: FECHA,
      // `max_output_tokens: null`: no declara tope, que no es cero
      outputCap: null,
    });
  });

  it('razona, o no lo dice, y no declara niveles: no-levels', () => {
    expect(catalogReasoningFor(detallado, 'deepseek/deepseek-v3.2:thinking')).toEqual({
      state: 'no-levels',
      levels: [],
      fetchedAt: FECHA,
      outputCap: 65536,
    });
    // ausente no es `false`: de un modelo del que la pasarela no dice nada no
    // se puede afirmar que no razone
    const callado = buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: FECHA,
      modelsPayload: { data: [{ id: 'sin-capacidades' }] },
      pricingPayload: null,
      detail: 'detailed',
    });
    expect(catalogReasoningFor(callado, 'sin-capacidades').state).toBe('no-levels');
  });

  it('declara niveles: levels, con las cadenas crudas', () => {
    const declarado = catalogReasoningFor(detallado, 'deepseek/deepseek-v4-flash');
    expect(declarado).toEqual({
      state: 'levels',
      levels: ['none', 'high', 'max'],
      fetchedAt: FECHA,
      outputCap: 384000,
    });
    // son las que espera el selector, que las traduce con el dialecto del host
    expect(
      reasoningOptionsFor('deepseek/deepseek-v4-flash', 'https://api.nano-gpt.com/api/v1', {
        declared: declarado.levels,
      }),
    ).toEqual(['off', 'high', 'max']);
    // y es una copia: tocarla no toca el catalogo
    (declarado.levels as string[]).length = 0;
    expect(catalogReasoningFor(detallado, 'deepseek/deepseek-v4-flash').levels).toEqual([
      'none',
      'high',
      'max',
    ]);
  });

  it('si declara niveles manda eso, aunque diga que no razona', () => {
    const contradictorio = buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: FECHA,
      modelsPayload: {
        data: [
          { id: 'raro', capabilities: { reasoning: false }, reasoning_efforts: ['low', 'high'] },
        ],
      },
      pricingPayload: null,
      detail: 'detailed',
    });
    expect(catalogReasoningFor(contradictorio, 'raro')).toMatchObject({
      state: 'levels',
      levels: ['low', 'high'],
    });
  });
});
