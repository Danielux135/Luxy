import { describe, expect, it } from 'vitest';

import {
  buildHordeRequest,
  describeHordeCharacter,
  HORDE_ANIME_MODELS,
  HORDE_REALISTIC_MODELS,
  hordeRecipeSchema,
  imagePromptStyleFor,
  recipeDefaultsFor,
  type HordeRecipe,
} from './vault-image-provider.js';

/** receta minima valida: cada prueba cambia solo lo que le importa */
function recipe(overrides: Record<string, unknown> = {}): HordeRecipe {
  return hordeRecipeSchema.parse({
    models: ['WAI-NSFW-illustrious-SDXL'],
    appearance: 'silver hair, green eyes, slim build',
    ...overrides,
  });
}

describe('hordeRecipeSchema', () => {
  it('rechaza una anchura que no es multiplo de 64 y lo dice en español', () => {
    const parsed = hordeRecipeSchema.safeParse({
      models: ['Prefect Pony'],
      appearance: 'silver hair',
      width: 1000,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues.find((entry) => entry.path[0] === 'width');
    expect(issue?.message).toBe('debe ser multiplo de 64');
  });

  it('rechaza mas de cinco loras', () => {
    const loras = Array.from({ length: 6 }, (_unused, index) => ({ name: `lora-${index}` }));
    expect(
      hordeRecipeSchema.safeParse({ models: ['Deliberate'], appearance: 'a', loras }).success,
    ).toBe(false);
    // cinco si entran: el limite es del horde, no una manía nuestra
    expect(
      hordeRecipeSchema.safeParse({
        models: ['Deliberate'],
        appearance: 'a',
        loras: loras.slice(0, 5),
      }).success,
    ).toBe(true);
  });

  it('rechaza mas de cuatro modelos y tambien ninguno', () => {
    const models = ['Prefect Pony', 'AMPonyXL', 'Hassaku XL', 'Nova Anime XL', 'Deliberate'];
    expect(hordeRecipeSchema.safeParse({ models, appearance: 'a' }).success).toBe(false);
    expect(hordeRecipeSchema.safeParse({ models: [], appearance: 'a' }).success).toBe(false);
    expect(
      hordeRecipeSchema.safeParse({ models: models.slice(0, 4), appearance: 'a' }).success,
    ).toBe(true);
  });

  it('rechaza un cfgScale con tres decimales', () => {
    const base = { models: ['Deliberate'], appearance: 'a' };
    expect(hordeRecipeSchema.safeParse({ ...base, cfgScale: 7.125 }).success).toBe(false);
    expect(hordeRecipeSchema.safeParse({ ...base, cfgScale: 7.12 }).success).toBe(true);
  });
});

describe('buildHordeRequest', () => {
  it('pone la identidad antes que la escena', () => {
    const request = buildHordeRequest({
      recipe: recipe({ outfit: 'black dress' }),
      prompt: 'sitting on a bed, warm light',
      extraNegative: '',
      shared: false,
    });
    expect(request.prompt.indexOf('silver hair')).toBeLessThan(
      request.prompt.indexOf('black dress'),
    );
    expect(request.prompt.indexOf('black dress')).toBeLessThan(
      request.prompt.indexOf('sitting on a bed'),
    );
  });

  it('manda el negativo detras de " ### " y no como campo aparte', () => {
    const request = buildHordeRequest({
      recipe: recipe({ negative: 'blurry' }),
      prompt: 'standing',
      extraNegative: 'extra fingers',
      shared: false,
    });
    expect(request.prompt).toBe(
      'silver hair, green eyes, slim build, standing ### blurry, extra fingers',
    );
    expect(Object.keys(request)).not.toContain('negativePrompt');
  });

  it('no añade " ### " cuando no hay ningun negativo', () => {
    const request = buildHordeRequest({
      recipe: recipe(),
      prompt: 'standing',
      extraNegative: '   ',
      shared: false,
    });
    expect(request.prompt).not.toContain('###');
  });

  it('no repite un termino que esta en los dos negativos', () => {
    const request = buildHordeRequest({
      recipe: recipe({ negative: 'blurry, 2girls' }),
      prompt: 'standing',
      extraNegative: 'BLURRY, watermark',
      shared: false,
    });
    const negative = request.prompt.split(' ### ')[1] ?? '';
    expect(negative).toBe('blurry, 2girls, watermark');
    expect(negative.toLowerCase().split('blurry').length - 1).toBe(1);
  });

  it('manda nsfw siempre y shared solo si se le pide', () => {
    const base = { recipe: recipe(), prompt: 'standing', extraNegative: '' };
    expect(buildHordeRequest({ ...base, shared: false }).nsfw).toBe(true);
    expect(buildHordeRequest({ ...base, shared: true }).nsfw).toBe(true);
    expect(buildHordeRequest({ ...base, shared: false }).shared).toBe(false);
    expect(buildHordeRequest({ ...base, shared: true }).shared).toBe(true);
    expect(buildHordeRequest({ ...base, shared: false, dryRun: true }).dryRun).toBe(true);
  });

  it('sin imagen de partida deja sourceImage en null', () => {
    const request = buildHordeRequest({
      recipe: recipe(),
      prompt: 'standing',
      extraNegative: '',
      shared: false,
    });
    // null explicito y no undefined: el adaptador decide por el si los campos
    // de img2img viajan o no, y ahi «ausente» y «vacio» no son lo mismo
    expect(request.sourceImage).toBeNull();
  });

  it('propaga la imagen de partida tal cual y siempre como img2img', () => {
    const request = buildHordeRequest({
      recipe: recipe(),
      prompt: 'standing',
      extraNegative: '',
      shared: false,
      sourceImage: 'ZmFrZQ==',
    });
    expect(request.sourceImage).toBe('ZmFrZQ==');
    // los otros tres valores del enum exigen modelos que estos personajes no usan
    expect(request.sourceProcessing).toBe('img2img');
  });

  it('el parecido sale de la receta, no de la peticion', () => {
    expect(
      buildHordeRequest({
        recipe: recipe(),
        prompt: 'standing',
        extraNegative: '',
        shared: false,
      }).denoisingStrength,
    ).toBe(0.45);

    expect(
      buildHordeRequest({
        recipe: recipe({ denoisingStrength: 0.2 }),
        prompt: 'standing',
        extraNegative: '',
        shared: false,
        sourceImage: 'ZmFrZQ==',
      }).denoisingStrength,
    ).toBe(0.2);
  });
});

describe('recipeDefaultsFor', () => {
  it('da retrato de 512x768 y clipSkip 1 a un modelo SD1', () => {
    expect(recipeDefaultsFor('sd1')).toMatchObject({ width: 512, height: 768, clipSkip: 1 });
  });

  it('da 1024x1024 y clipSkip 2 a un modelo SDXL', () => {
    expect(recipeDefaultsFor('sdxl')).toMatchObject({ width: 1024, height: 1024, clipSkip: 2 });
  });
});

describe('describeHordeCharacter', () => {
  it('empieza por el nombre', () => {
    const text = describeHordeCharacter('Lia', recipe({ outfit: 'black dress' }));
    expect(text.startsWith('Te llamas Lia.')).toBe(true);
    expect(text.indexOf('Lia')).toBeLessThan(text.indexOf('silver hair'));
  });
});

describe('imagePromptStyleFor', () => {
  it('usa etiquetas para el modelo de anime de xavira y prosa para el resto', () => {
    expect(imagePromptStyleFor('xavira', { xaviraModelId: 'anime-pure-v1' })).toBe('tags');
    expect(imagePromptStyleFor('xavira', { xaviraModelId: 'realistic-sharp-v1' })).toBe('prose');
    expect(imagePromptStyleFor('xavira', { xaviraModelId: null })).toBe('prose');
  });

  it('respeta el promptStyle de la receta en el horde', () => {
    expect(imagePromptStyleFor('horde', { recipe: recipe({ promptStyle: 'prose' }) })).toBe(
      'prose',
    );
    expect(imagePromptStyleFor('horde', { recipe: recipe() })).toBe('tags');
    expect(imagePromptStyleFor('horde', { recipe: null })).toBe('tags');
  });
});

describe('catalogos de modelos', () => {
  it('no repite ningun nombre y ninguno lleva espacios sobrantes', () => {
    const names = [...HORDE_ANIME_MODELS, ...HORDE_REALISTIC_MODELS].map((model) => model.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toBe(name.trim());
  });
});
