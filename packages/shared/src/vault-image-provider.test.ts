import { describe, expect, it } from 'vitest';

import {
  baselineOf,
  mixedBaselineWarning,
  stripConflictingTraits,
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

// PASO DE VERDAD el 2026-09-08. Daniel marco cuatro modelos —WAI-NSFW-illustrious-SDXL,
// WAI-ANI-NSFW-PONYXL, Grapefruit Hentai y Hentai Diffusion— porque la pantalla anima a
// marcar varios: «suma sus workers y acorta la espera». Los dos ultimos son SD1 y los dos
// primeros SDXL. La imagen que volvio no se parecia en nada a su personaje.
describe('mezclar familias de modelos', () => {
  it('dos SDXL no son una mezcla', () => {
    expect(mixedBaselineWarning(['WAI-NSFW-illustrious-SDXL', 'WAI-ANI-NSFW-PONYXL'])).toBeNull();
  });

  it('dos SD1 tampoco', () => {
    expect(mixedBaselineWarning(['Grapefruit Hentai', 'Hentai Diffusion'])).toBeNull();
  });

  it('la seleccion REAL de Daniel avisa', () => {
    const aviso = mixedBaselineWarning([
      'WAI-NSFW-illustrious-SDXL',
      'WAI-ANI-NSFW-PONYXL',
      'Grapefruit Hentai',
      'Hentai Diffusion',
    ]);
    expect(aviso).not.toBeNull();
    expect(aviso).toContain('SDXL');
    expect(aviso).toContain('SD1');
  });

  it('un solo modelo nunca avisa', () => {
    expect(mixedBaselineWarning(['Grapefruit Hentai'])).toBeNull();
    expect(mixedBaselineWarning([])).toBeNull();
  });

  it('un nombre desconocido no inventa familia ni avisa por su cuenta', () => {
    // la lista del horde cambia sin avisarnos: lo que no conocemos se calla en
    // vez de afirmar que mezcla
    expect(mixedBaselineWarning(['Modelo Que No Existe'])).toBeNull();
    expect(baselineOf('Modelo Que No Existe')).toBeNull();
  });

  it('conoce la familia de los modelos de las dos listas', () => {
    expect(baselineOf('WAI-NSFW-illustrious-SDXL')).toBe('sdxl');
    expect(baselineOf('Grapefruit Hentai')).toBe('sd1');
    expect(baselineOf('Realistic Vision')).toBe('sd1');
  });
});

// PASO DE VERDAD, y es la razon de que esto sea codigo y no una linea de prompt.
// Primero se le PIDIO al modelo que no describiera los rasgos fijos, rasgo por
// rasgo y explicando el motivo. Siguio haciendolo: en una generacion POSTERIOR
// al arreglo, la receta decia «light brown hair, blue eyes» y la escena «dark
// hair wild across pillow». Salio morena.
describe('la escena no puede contradecir el color de pelo ni de ojos', () => {
  const ASPECTO = 'light brown hair, blue eyes, pale skin, slim body';

  it('quita el color y CONSERVA la escena', () => {
    // el pelo revuelto sobre la almohada es escena y es suyo; el color, no
    expect(stripConflictingTraits('dark hair wild across pillow', ASPECTO)).toBe(
      'hair wild across pillow',
    );
  });

  it('tambien con varias palabras de color encadenadas', () => {
    expect(stripConflictingTraits('long dark brown hair, arched back', ASPECTO)).toBe(
      'long hair, arched back',
    );
  });

  it('los ojos igual', () => {
    expect(stripConflictingTraits('golden eyes locked on viewer', ASPECTO)).toBe(
      'eyes locked on viewer',
    );
  });

  it('lo que no es un rasgo NO se toca, aunque lleve un color', () => {
    // este es el riesgo del arreglo: comerse media escena
    const escena = 'tangled white sheets, warm golden bedroom light, red curtains';
    expect(stripConflictingTraits(escena, ASPECTO)).toBe(escena);
  });

  it('si la receta no habla del pelo, la escena manda', () => {
    // sin aspecto fijo que respetar, lo que diga la escena es la unica fuente
    expect(stripConflictingTraits('dark hair wild across pillow', 'blue eyes')).toBe(
      'dark hair wild across pillow',
    );
  });

  it('no deja comas huerfanas ni dobles espacios', () => {
    expect(stripConflictingTraits('naked, black hair, arched back', ASPECTO)).toBe(
      'naked, hair, arched back',
    );
  });

  it('la escena real de Daniel, entera', () => {
    const escena =
      'petite japanese woman 18, naked, legs wrapped around partner, arched back, ' +
      'exposed neck, sweaty flushed skin, dark hair wild across pillow, ' +
      'mouth open in pleasure, glistening eyes locked on viewer';
    const limpia = stripConflictingTraits(escena, ASPECTO);
    expect(limpia).toContain('hair wild across pillow');
    expect(limpia).not.toContain('dark hair');
    // «glistening» no es un color: la escena conserva lo suyo
    expect(limpia).toContain('glistening eyes locked on viewer');
  });

  it('buildHordeRequest lo aplica de verdad', () => {
    const peticion = buildHordeRequest({
      recipe: recipe({ appearance: ASPECTO, outfit: '' }),
      prompt: 'dark hair wild across pillow',
      extraNegative: '',
      shared: false,
    });
    expect(peticion.prompt).toContain('light brown hair');
    expect(peticion.prompt).not.toContain('dark hair');
  });
});

// SEGUNDA VUELTA del mismo fallo. Quitado ya el color, el modelo seguia
// escribiendo «petite japanese woman 18» y el generador devolvia una morena de
// ojos ambar: en estos modelos «japanese» arrastra pelo, ojos y rasgos de golpe.
describe('la escena tampoco puede reasignarle el origen', () => {
  const ASPECTO = 'light brown hair, blue eyes, pale skin, slim body';

  it('quita el origen cuando califica a una persona', () => {
    expect(stripConflictingTraits('petite japanese woman 18, naked', ASPECTO)).toBe(
      'petite woman 18, naked',
    );
  });

  it('lo deja cuando es ESCENARIO, que es el riesgo del arreglo', () => {
    const escena = 'japanese lantern on the wall, japanese garden outside';
    expect(stripConflictingTraits(escena, ASPECTO)).toBe(escena);
  });

  it('si la receta ya lo dice, la escena no lo esta inventando', () => {
    const conOrigen = 'japanese woman, light brown hair, blue eyes';
    expect(stripConflictingTraits('japanese woman kneeling', conOrigen)).toBe(
      'japanese woman kneeling',
    );
  });

  it('alcanza aunque haya adjetivos por medio', () => {
    expect(stripConflictingTraits('asian young slim girl on bed', ASPECTO)).toBe(
      'young slim girl on bed',
    );
  });

  it('la escena real de Daniel, ya sin color y sin origen', () => {
    const escena =
      'petite japanese woman 18, naked, legs wrapped around partner, arched back, ' +
      'sweaty flushed skin, messy hair spread on pillow, glistening eyes locked on viewer';
    const limpia = stripConflictingTraits(escena, ASPECTO);
    expect(limpia).not.toContain('japanese');
    expect(limpia).toContain('messy hair spread on pillow');
    expect(limpia).toContain('legs wrapped around partner');
  });
});
