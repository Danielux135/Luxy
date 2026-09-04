import { describe, expect, it } from 'vitest';
import { buildCatalogForConnection } from './catalog.js';

describe('catalogo de un origen que impone su familia', () => {
  // un proveedor HTTP se registra bajo SU identificador, y el identificador de
  // proveedor ES la familia con la que el agente lo ejecuta. Adivinarla por el
  // nombre del modelo dejaba a Mistral en «other» y su selector vacio
  it('pone la familia impuesta en todos sus modelos', () => {
    const modelos = buildCatalogForConnection(
      'mistral',
      ['pixtral-12b-2409', 'un-nombre-que-no-dice-nada'],
      'mistral',
    );

    expect(modelos.map((modelo) => modelo.family)).toEqual(['mistral', 'mistral']);
  });

  it('sin familia impuesta la sigue adivinando por el nombre', () => {
    const modelos = buildCatalogForConnection('pasarela', ['DeepSeek-V4-Pro', 'kimi-k3']);
    expect(modelos.map((modelo) => modelo.family)).toEqual(['deepseek', 'kimi']);
  });

  it('una familia que no existe NO tumba el catalogo', () => {
    // `family` es un enum cerrado: meter ahi el identificador de un proveedor
    // cualquiera haria saltar el esquema y dejaria la pantalla sin catalogo.
    // Se prefiere agrupar peor a no tener nada
    const modelos = buildCatalogForConnection('lo-que-sea', ['kimi-k3'], 'lo-que-sea');
    expect(modelos).toHaveLength(1);
    expect(modelos[0]?.family).toBe('kimi');
  });

  it('la categoria se deduce del nombre aunque la familia venga impuesta', () => {
    // un proveedor puede servir texto, audio e imagen a la vez: si la categoria
    // saliera de la familia, sus modelos de audio pasarian por texto
    const modelos = buildCatalogForConnection(
      'mistral',
      ['stepaudio-2.5-tts', 'mistral-large-latest'],
      'mistral',
    );

    expect(modelos.map((modelo) => modelo.category)).toEqual(['audio', 'text']);
  });

  it('con familia impuesta no se hereda la ficha de fabrica', () => {
    // el mismo nombre puede existir en otra pasarela con otra familia y otros
    // alias de telegram: heredarla mezclaria dos modelos distintos
    const modelos = buildCatalogForConnection('mistral', ['kimi-k3'], 'mistral');
    expect(modelos[0]?.connectionId).toBe('mistral');
    expect(modelos[0]?.telegramAliases).toEqual([]);
  });
});
