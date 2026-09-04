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
