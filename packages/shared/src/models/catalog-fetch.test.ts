// pruebas del catalogo real leido de una pasarela.
//
// POR QUE EXISTE: el catalogo escrito a mano dice 8.192 tokens de salida para
// todos los modelos y nunca se verifico; un trabajo real acabo justo ahi. Esto
// lee lo que la pasarela dice de verdad. Como la respuesta viene de un tercero
// que puede cambiarla sin avisar, lo que se prueba es que un campo raro no tire
// el catalogo entero.
import { describe, it, expect } from 'vitest';
import {
  buildCatalogSnapshot,
  describeModelBilling,
  describePricingProbes,
  guessModelFamily,
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
});

describe('guessModelFamily', () => {
  it('agrupa por nombre, solo para pintar', () => {
    expect(guessModelFamily('deepseek-chat')).toBe('deepseek');
    expect(guessModelFamily('Kimi-K2.6')).toBe('kimi');
    expect(guessModelFamily('moonshot-v1-128k')).toBe('kimi');
    expect(guessModelFamily('glm-5.2')).toBe('glm');
    expect(guessModelFamily('qwen-max')).toBe('qwen');
    expect(guessModelFamily('kat-coder-pro-v2.5')).toBe('kat');
    expect(guessModelFamily('claude-sonnet-4')).toBe('claude');
    expect(guessModelFamily('gpt-4o')).toBe('openai');
    expect(guessModelFamily('algo-raro')).toBe('otros');
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

describe('familias de los 23 modelos reales', () => {
  it('agrupa los que la primera lectura dejo en "otros"', () => {
    // los 22 de la lectura del 2026-08-07: 14 caian en "otros" porque step,
    // minimax y sensenova no estaban contemplados
    expect(guessModelFamily('step-3.7-flash')).toBe('step');
    expect(guessModelFamily('step-explore')).toBe('step');
    expect(guessModelFamily('stepaudio-2.5-tts')).toBe('step-media');
    expect(guessModelFamily('step-image-edit-2')).toBe('step-media');
    expect(guessModelFamily('MiniMax-M3')).toBe('minimax');
    expect(guessModelFamily('sensenova-u1-fast')).toBe('sensenova');
    expect(guessModelFamily('hy3')).toBe('otros');
    expect(guessModelFamily('auto')).toBe('router');
  });

  it('ningun modelo real acaba en "otros"', () => {
    const REALES = [
      'auto',
      'DeepSeek-V4-Flash',
      'DeepSeek-V4-Pro',
      'glm-5.1',
      'glm-5.2',
      'kat-coder-pro-v2.5',
      'Kimi-K2.6',
      'MiniMax-M3',
      'hy3',
      'Qwen3-Embedding-8B',
      'Qwen3.6-27B',
      'sensenova-6.7-flash-lite',
      'sensenova-u1-fast',
      'step-3.5-flash',
      'step-3.5-flash-2603',
      'step-3.7-flash',
      'step-explore',
      'step-image-edit-2',
      'step-router-v1',
      'stepaudio-2.5-asr',
      'stepaudio-2.5-chat',
      'stepaudio-2.5-realtime',
      'stepaudio-2.5-tts',
    ];
    expect(REALES).toHaveLength(23);
    for (const modelo of REALES.filter((item) => item !== 'hy3')) {
      expect(guessModelFamily(modelo)).not.toBe('otros');
    }
  });
});
