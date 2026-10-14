import { describe, expect, it } from 'vitest';
import {
  buildCatalogSnapshot,
  mapDeclaredCapabilities,
  parseModelCapabilities,
  parseProviderModelEntries,
} from './catalog-fetch.js';
import { buildCatalogForConnection } from './catalog.js';

describe('capacidades que declara la pasarela', () => {
  // POR QUE: Luxy se quedaba solo con el nombre del modelo y tiraba el resto de
  // la respuesta, asi que para saber cual sabe mirar una imagen habia que
  // deducirlo del nombre. Con 46 modelos de Mistral en pantalla, eso no es una
  // molestia: es no poder elegir.
  it('guarda solo las banderas que vienen a true', () => {
    expect(
      parseModelCapabilities({ vision: true, function_calling: true, fine_tuning: false }),
    ).toEqual(['function_calling', 'vision']);
  });

  it('una pasarela que no las declara deja la lista vacia, no un error', () => {
    for (const raro of [undefined, null, 'texto', 42, []]) {
      expect(parseModelCapabilities(raro)).toEqual([]);
    }
  });

  it('traduce a nuestro vocabulario solo lo que reconoce', () => {
    expect(mapDeclaredCapabilities(['vision', 'function_calling'])).toEqual([
      'agent_tools',
      'image_input',
    ]);
  });

  it('una bandera desconocida NO se convierte en capacidad nuestra', () => {
    // afirmar que un modelo sabe hacer algo que nadie ha dicho es exactamente
    // el error que esto viene a evitar
    expect(mapDeclaredCapabilities(['telepatia', 'cocinar'])).toEqual([]);
  });

  it('llegan desde /v1/models hasta el catalogo guardado', () => {
    const snapshot = buildCatalogSnapshot({
      connectionId: 'mistral',
      source: 'http',
      fetchedAt: '2026-09-04T16:00:00.000Z',
      modelsPayload: {
        data: [
          { id: 'mistral-medium-latest', capabilities: { vision: true, completion_chat: true } },
          { id: 'codestral-latest', capabilities: { vision: false } },
          { id: 'sin-capacidades' },
        ],
      },
      pricingPayload: null,
    });

    expect(snapshot.models.map((m) => [m.apiModel, m.declaredCapabilities])).toEqual([
      ['mistral-medium-latest', ['completion_chat', 'vision']],
      ['codestral-latest', []],
      ['sin-capacidades', []],
    ]);
  });

  it('un modelo con vision declarada acaba con image_input en el catalogo', () => {
    const modelos = buildCatalogForConnection(
      'mistral',
      [
        { apiModel: 'mistral-medium-latest', declaredCapabilities: ['vision'] },
        { apiModel: 'codestral-latest', declaredCapabilities: [] },
      ],
      'mistral',
    );

    expect(modelos[0]?.capabilities).toContain('image_input');
    expect(modelos[1]?.capabilities).not.toContain('image_input');
  });

  it('lo declarado se SUMA a la ficha escrita a mano, no la sustituye', () => {
    // la pasarela sabe lo que sirve hoy; la ficha lleva lo que hemos comprobado
    // nosotros. Perder lo segundo por leer lo primero seria un retroceso
    const [modelo] = buildCatalogForConnection('hcnsec', [
      { apiModel: 'DeepSeek-V4-Pro', declaredCapabilities: ['vision'] },
    ]);

    expect(modelo?.capabilities).toContain('image_input');
    expect(modelo?.capabilities).toContain('agent_tools');
    expect(modelo?.telegramAliases).toContain('deepseek');
  });

  it('sigue admitiendo una lista de nombres sueltos', () => {
    // es como llamaba todo el mundo antes; romperlo obligaria a tocar cada sitio
    const modelos = buildCatalogForConnection('hcnsec', ['kimi-k3']);
    expect(modelos[0]?.apiModel).toBe('kimi-k3');
  });

  it('parseProviderModelEntries no se traga una respuesta con basura', () => {
    const entries = parseProviderModelEntries({
      data: [{ id: 'bueno', capabilities: { vision: true } }, { sin: 'id' }, 'ni siquiera un objeto'],
    });
    expect(entries).toEqual([{ id: 'bueno', declaredCapabilities: ['vision'] }]);
  });
});

describe('razonamiento que declara la pasarela', () => {
  // POR QUE (F36): `declaredCapabilities` guarda solo lo que viene a `true`, asi
  // que «declara false» y «no lo declara» dan la misma lista vacia (ver arriba,
  // `codestral-latest` y `sin-capacidades`). Para las demas banderas da igual;
  // para el razonamiento no: de un modelo del que la pasarela no dice nada no se
  // puede afirmar que no razone. Por eso va en un dato aparte, con tres estados.
  it('tiene tres estados: si, no y no lo dice', () => {
    const entries = parseProviderModelEntries({
      data: [
        { id: 'razona', capabilities: { reasoning: true, vision: false } },
        { id: 'no-razona', capabilities: { reasoning: false } },
        { id: 'no-lo-dice', capabilities: { vision: false } },
        { id: 'sin-capacidades' },
      ],
    });
    // `toStrictEqual`: en los dos ultimos la clave NO existe, que no es lo
    // mismo que valer `false`
    expect(entries).toStrictEqual([
      { id: 'razona', declaredCapabilities: ['reasoning'], reasoning: true },
      { id: 'no-razona', declaredCapabilities: [], reasoning: false },
      { id: 'no-lo-dice', declaredCapabilities: [] },
      { id: 'sin-capacidades', declaredCapabilities: [] },
    ]);
  });

  it('acompaña a su modelo hasta el catalogo guardado, con sus niveles', () => {
    const snapshot = buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: '2026-10-13T09:17:00.000Z',
      modelsPayload: {
        data: [
          {
            id: 'deepseek/deepseek-v4-flash',
            capabilities: { reasoning: true },
            reasoning_efforts: ['none', 'high', 'max'],
          },
          { id: 'TheDrummer/Cydonia-24B-v4.3', capabilities: { reasoning: false } },
          { id: 'sin-capacidades' },
        ],
      },
      pricingPayload: null,
      detail: 'detailed',
    });

    expect(snapshot.models.map((m) => [m.apiModel, m.reasoning, m.reasoningEfforts])).toEqual([
      ['deepseek/deepseek-v4-flash', true, ['none', 'high', 'max']],
      ['TheDrummer/Cydonia-24B-v4.3', false, undefined],
      ['sin-capacidades', undefined, undefined],
    ]);
    // el modelo del que no se dice nada sale como salia antes: sin claves nuevas
    expect(snapshot.models[2]).toStrictEqual({
      apiModel: 'sin-capacidades',
      ownedBy: null,
      billing: 'unknown',
      modelRatio: null,
      completionRatio: null,
      perCall: null,
      groups: [],
      declaredCapabilities: [],
    });
  });

  it('de las banderas de una entrada detallada solo se traduce lo que ya se traducia', () => {
    const [entry] = parseProviderModelEntries({
      data: [
        {
          id: 'deepseek/deepseek-v4-flash',
          capabilities: {
            reasoning: true,
            tool_calling: true,
            structured_output: true,
            batch_api: true,
          },
          reasoning_efforts: ['none', 'max'],
        },
      ],
    });
    expect(entry?.reasoning).toBe(true);
    expect(entry?.reasoningEfforts).toEqual(['none', 'max']);
    // `tool_calling` se guarda como lo dice la pasarela, pero NO pasa a ser
    // herramientas nativas: daria trabajos con herramientas a modelos que
    // razonan, y Luxy no les devuelve el razonamiento. Queda fuera de F36
    expect(entry?.declaredCapabilities).toContain('tool_calling');
    expect(mapDeclaredCapabilities(entry?.declaredCapabilities ?? [])).toEqual(['reasoning']);
  });
});
