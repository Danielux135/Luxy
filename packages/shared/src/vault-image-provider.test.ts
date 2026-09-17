import { describe, expect, it } from 'vitest';

import {
  baselineOf,
  isPonyModel,
  mergeNegatives,
  mixedBaselineWarning,
  qualityPrefixWarning,
  stripConflictingTraits,
  stripConflictingTraitsDetailed,
  describeHordeCharacter,
  HORDE_ANIME_MODELS,
  HORDE_REALISTIC_MODELS,
  hordeRecipeSchema,
  imagePromptStyleFor,
  recipeDefaultsFor,
  type HordeRecipe,
} from './vault-image-provider.js';
// `buildHordeRequest` se mudo a `vault-image-plan.ts` al dejar de componer por
// su cuenta: aqui se sigue probando su comportamiento, que no ha cambiado
import { buildHordeRequest, composeHordeImagePlan } from './vault-image-plan.js';

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

  it('ya no compone por su cuenta: el texto sale del plan', () => {
    // la invariante que sostiene todo esto es que exista UNA sola funcion que
    // construya un HordeImageRequest. Con dos, nada impide que una gane un
    // prefijo o un negativo que la otra no tenga: el panel enseñaria un texto,
    // el horde recibiria otro y ninguna prueba fallaria
    const receta = recipe({ outfit: 'black dress', negative: 'blurry' });
    const escena = 'dark hair wild across pillow';
    const request = buildHordeRequest({
      recipe: receta,
      prompt: escena,
      extraNegative: 'camera, selfie',
      shared: receta.shared,
      sourceImage: 'ZmFrZQ==',
    });
    const plan = composeHordeImagePlan({
      recipe: receta,
      scene: escena,
      extraNegative: 'camera, selfie',
    });
    expect(request.prompt).toBe(plan.joined);
    // y el recorte que hoy es invisible ya viene contado con el plan
    expect(plan.dropped).toEqual(['dark hair']);
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
    // el elemento se queda en «hair» pelado, que ya no dice nada y gasta uno de
    // los ocho huecos que el bloque presupuesta: se va entero
    expect(stripConflictingTraits('naked, black hair, arched back', ASPECTO)).toBe(
      'naked, arched back',
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

  it('apunta el origen y la persona, no los adjetivos que se quedan escritos', () => {
    // devolver el fragmento lo añade al final: con «asian young slim girl», el
    // positivo acabaria con «young slim girl» dos veces
    expect(
      stripConflictingTraitsDetailed('asian young slim girl on bed', ASPECTO).dropped,
    ).toEqual(['asian girl']);
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

// El recorte era INVISIBLE, y esa es la mitad del problema: se pide «pelo oscuro
// suelto sobre la almohada», el color desaparece por un motivo bueno, y quien lo
// pidio solo ve que su escena llego a medias. Lo que se quita tiene que poder
// decirse, para que el panel de revision ofrezca devolverlo ANTES de generar.
describe('stripConflictingTraitsDetailed dice lo que quito', () => {
  const ASPECTO = 'light brown hair, blue eyes, pale skin, slim body';

  it('apunta el color con el rasgo que calificaba, no la palabra suelta', () => {
    const { text, dropped } = stripConflictingTraitsDetailed(
      'dark hair wild across pillow',
      ASPECTO,
    );
    expect(text).toBe('hair wild across pillow');
    // «dark» a secas no se entiende un mes despues, y lo que hay que poder
    // devolver al positivo es la frase entera
    expect(dropped).toEqual(['dark hair']);
  });

  it('el color encadenado sale entero, no troceado', () => {
    expect(
      stripConflictingTraitsDetailed('long dark brown hair, arched back', ASPECTO).dropped,
    ).toEqual(['dark brown hair']);
  });

  it('los ojos se apuntan igual que el pelo', () => {
    expect(stripConflictingTraitsDetailed('golden eyes locked on viewer', ASPECTO).dropped).toEqual(
      ['golden eyes'],
    );
  });

  it('si la receta no habla del pelo, no quita nada y no apunta nada', () => {
    const { text, dropped } = stripConflictingTraitsDetailed(
      'dark hair wild across pillow',
      'blue eyes',
    );
    expect(text).toBe('dark hair wild across pillow');
    expect(dropped).toEqual([]);
  });

  it('un color que no califica a un rasgo no se apunta porque no se quita', () => {
    const escena = 'tangled white sheets, warm golden bedroom light, red curtains';
    expect(stripConflictingTraitsDetailed(escena, ASPECTO).dropped).toEqual([]);
  });

  it('el origen se apunta con la persona a la que calificaba', () => {
    expect(
      stripConflictingTraitsDetailed('petite japanese woman 18, naked', ASPECTO).dropped,
    ).toEqual(['japanese woman']);
  });

  it('el origen que es ESCENARIO no se apunta, porque tampoco se quita', () => {
    const escena = 'japanese lantern on the wall, japanese garden outside';
    const { text, dropped } = stripConflictingTraitsDetailed(escena, ASPECTO);
    expect(text).toBe(escena);
    expect(dropped).toEqual([]);
  });

  it('la escena real de Daniel apunta las dos cosas', () => {
    const escena =
      'petite japanese woman 18, naked, legs wrapped around partner, arched back, ' +
      'exposed neck, sweaty flushed skin, dark hair wild across pillow, ' +
      'mouth open in pleasure, glistening eyes locked on viewer';
    // el color primero y el origen despues: es el orden en que se recorta
    expect(stripConflictingTraitsDetailed(escena, ASPECTO).dropped).toEqual([
      'dark hair',
      'japanese woman',
    ]);
  });

  it('el mismo fragmento repetido en la escena se apunta una sola vez', () => {
    // el panel recorre `dropped` con `key={fragment}`: repetido es una key
    // duplicada de React —aviso en consola— y dos botones identicos, de los
    // cuales el segundo no hace nada porque `restoreDroppedFragment` ya no
    // vuelve a añadir lo que ya esta escrito
    const { text, dropped } = stripConflictingTraitsDetailed(
      'dark hair wet, dark hair over her face',
      ASPECTO,
    );
    expect(dropped).toEqual(['dark hair']);
    // y el recorte sigue quitando las DOS apariciones: deduplicar es del aviso,
    // no del texto
    expect(text).toBe('hair wet, hair over her face');
  });

  it('deduplica sin distinguir mayusculas y conserva como se escribio la primera', () => {
    expect(
      stripConflictingTraitsDetailed('Dark hair wet, dark hair over her face', ASPECTO).dropped,
    ).toEqual(['Dark hair']);
  });

  it('el plan compuesto tampoco trae el fragmento repetido', () => {
    const plan = composeHordeImagePlan({
      recipe: recipe({ appearance: ASPECTO }),
      scene: 'dark hair wet, dark hair over her face',
      extraNegative: '',
    });
    expect(plan.dropped).toEqual(['dark hair']);
    expect(new Set(plan.dropped).size).toBe(plan.dropped.length);
  });

  it('el envoltorio antiguo devuelve exactamente el texto de la version detallada', () => {
    // esta es la prueba de que la extraccion no cambio el recorte: si los dos se
    // separasen, las pruebas de arriba estarian midiendo otra funcion
    const casos: [string, string][] = [
      ['dark hair wild across pillow', ASPECTO],
      ['long dark brown hair, arched back', ASPECTO],
      ['golden eyes locked on viewer', ASPECTO],
      ['tangled white sheets, warm golden bedroom light, red curtains', ASPECTO],
      ['naked, black hair, arched back', ASPECTO],
      ['petite japanese woman 18, naked', ASPECTO],
      ['japanese lantern on the wall, japanese garden outside', ASPECTO],
      ['asian young slim girl on bed', ASPECTO],
      ['japanese woman kneeling', 'japanese woman, light brown hair, blue eyes'],
      ['dark hair wild across pillow', 'blue eyes'],
      ['small body pressed against him', 'slim body, slender, small frame'],
      ['small breasts, wide hips', 'slim body, slender, small frame'],
      ['naked, blushing, on bed', 'blush, pink cheeks'],
      ['blush pink lingerie on the chair', 'blush, pink cheeks'],
    ];
    for (const [escena, aspecto] of casos) {
      expect(stripConflictingTraits(escena, aspecto)).toBe(
        stripConflictingTraitsDetailed(escena, aspecto).text,
      );
    }
  });
});

// TERCERA VUELTA del mismo fallo, vista generando de verdad: el bloque de
// instrucciones PROHIBE al modelo describir como es ella, y aun asi se colaba
// «small body» con la receta diciendo «slim body, slender, small frame». Dos
// tallas en el mismo prompt, y el generador elige una sin preguntar.
describe('la escena tampoco puede cambiarle la complexion', () => {
  const ASPECTO = 'light brown hair, blue eyes, pale skin, slim body, slender, small frame';

  it('quita el calificativo y CONSERVA la frase', () => {
    expect(stripConflictingTraits('small body pressed against him', ASPECTO)).toBe(
      'body pressed against him',
    );
  });

  it('tambien encadenado', () => {
    expect(stripConflictingTraits('tiny toned body on the bed', ASPECTO)).toBe('body on the bed');
  });

  it('alcanza a los otros nombres del mismo rasgo', () => {
    expect(stripConflictingTraits('slender figure against the window', ASPECTO)).toBe(
      'figure against the window',
    );
  });

  it('si la receta no habla de complexion, la escena manda', () => {
    expect(stripConflictingTraits('small body pressed against him', 'blue eyes')).toBe(
      'small body pressed against him',
    );
  });

  it('las partes que el aspecto fijo NO declara se quedan, que es el riesgo del arreglo', () => {
    // «slim body» habla del cuerpo entero, no del pecho ni de las caderas:
    // quitarlo aqui seria borrar escena de verdad
    const escena = 'small breasts, wide hips, thighs pressed together';
    expect(stripConflictingTraits(escena, ASPECTO)).toBe(escena);
  });

  it('un calificativo que no califica al cuerpo NO se toca', () => {
    const escena = 'thin sheets, small lamp, big window, heavy curtains';
    expect(stripConflictingTraits(escena, ASPECTO)).toBe(escena);
  });

  it('los muebles que se llaman «frame» conservan su adjetivo', () => {
    // el somier, el marco de la ventana y el del cuadro son decorado de
    // dormitorio, que es justo donde pasan estas escenas: con una palabra de
    // hueco entre el adjetivo y el sustantivo, los tres perdian el suyo
    expect(stripConflictingTraits('huge bed frame, lying on it', ASPECTO)).toBe(
      'huge bed frame, lying on it',
    );
    expect(stripConflictingTraits('small window frame, morning light', ASPECTO)).toBe(
      'small window frame, morning light',
    );
    expect(stripConflictingTraits('large picture frame behind her', ASPECTO)).toBe(
      'large picture frame behind her',
    );
  });

  it('y el «small frame» de la receta, que es el caso real, se sigue quitando', () => {
    const { text, dropped } = stripConflictingTraitsDetailed(
      'small frame pressed against him',
      ASPECTO,
    );
    expect(text).toBe('frame pressed against him');
    expect(dropped).toEqual(['small frame']);
  });

  it('el sustantivo que se queda solo se va entero', () => {
    const { text, dropped } = stripConflictingTraitsDetailed('toned figure, standing', ASPECTO);
    expect(text).toBe('standing');
    // lo quitado se sigue pudiendo devolver: el huerfano sale del texto, no del aviso
    expect(dropped).toEqual(['toned figure']);
  });

  it('lo quitado se apunta con el sustantivo que calificaba', () => {
    const { text, dropped } = stripConflictingTraitsDetailed('small body on the bed', ASPECTO);
    expect(text).toBe('body on the bed');
    // «small» a secas no se entiende un mes despues, igual que con el color
    expect(dropped).toEqual(['small body']);
  });

  it('no apunta nada cuando no quita nada', () => {
    expect(stripConflictingTraitsDetailed('small breasts, thin sheets', ASPECTO).dropped).toEqual(
      [],
    );
  });

  it('el recorte llega de verdad al prompt que se manda', () => {
    const peticion = buildHordeRequest({
      recipe: recipe({ appearance: ASPECTO, outfit: '' }),
      prompt: 'small body pressed against him',
      extraNegative: '',
      shared: false,
    });
    expect(peticion.prompt).toContain('slim body');
    expect(peticion.prompt).not.toContain('small body');
  });
});

// CUARTA VUELTA: la receta decia «blush, pink cheeks» y la escena repetia
// «blushing». El riesgo aqui no es quitar de menos sino de mas, porque los
// mismos colores visten la escena: «blush pink lingerie» no es su cara.
describe('la escena tampoco puede repetirle el rubor', () => {
  const ASPECTO = 'light brown hair, blue eyes, blush, pink cheeks';

  it('quita el rubor suelto y deja la escena limpia', () => {
    expect(stripConflictingTraits('naked, blushing, on bed', ASPECTO)).toBe('naked, on bed');
  });

  it('quita el elemento entero cuando el rasgo ERA el elemento', () => {
    // «cheeks» solo no describe nada y el aspecto fijo ya dice como son
    expect(stripConflictingTraits('flushed cheeks, mouth open', ASPECTO)).toBe('mouth open');
  });

  it('alcanza aunque haya una palabra por medio', () => {
    expect(stripConflictingTraits('sweaty flushed skin, arched back', ASPECTO)).toBe(
      'sweaty skin, arched back',
    );
  });

  it('el mismo color sobre otra cosa se queda, que es el riesgo del arreglo', () => {
    const escena = 'blush pink lingerie on the chair, rosy dawn light, red curtains';
    expect(stripConflictingTraits(escena, ASPECTO)).toBe(escena);
  });

  it('si la receta no habla de rubor, la escena manda', () => {
    const sinRubor = 'light brown hair, blue eyes, pale skin';
    expect(stripConflictingTraits('naked, blushing, on bed', sinRubor)).toBe(
      'naked, blushing, on bed',
    );
  });

  it('«pink cheeks» abre la puerta aunque la receta no diga «blush»', () => {
    // el aspecto fijo puede describir el rubor sin nombrarlo
    expect(stripConflictingTraits('blushing, looking away', 'light brown hair, pink cheeks')).toBe(
      'looking away',
    );
  });

  it('la escena que repite el rubor tal cual lo dice la receta', () => {
    const { text, dropped } = stripConflictingTraitsDetailed('pink cheeks, looking away', ASPECTO);
    expect(text).toBe('looking away');
    expect(dropped).toEqual(['pink cheeks']);
  });

  it('no deja la coma final que antes llegaba al prompt', () => {
    // el recorte del rubor se lleva el termino entero, y hasta ahora eso dejaba
    // «on bed,» tal cual en el positivo
    expect(stripConflictingTraits('legs open, on bed, blushing', ASPECTO)).toBe(
      'legs open, on bed',
    );
  });

  it('lo quitado se apunta con lo que ruborizaba', () => {
    expect(stripConflictingTraitsDetailed('sweaty flushed skin', ASPECTO).dropped).toEqual([
      'flushed skin',
    ]);
  });

  it('no apunta nada cuando no quita nada', () => {
    const escena = 'blush pink lingerie on the chair, rosy dawn light';
    expect(stripConflictingTraitsDetailed(escena, ASPECTO).dropped).toEqual([]);
  });

  it('un color sobre la piel o la nariz es la LUZ o el frio, y se queda', () => {
    // la piel, la cara y la nariz tambien son superficie de iluminacion y de
    // clima: con un color delante no se distinguen del rubor, y quitarlo se
    // llevaba por delante la luz que pidio el usuario
    expect(stripConflictingTraits('red nose from the cold, scarf, snow', ASPECTO)).toBe(
      'red nose from the cold, scarf, snow',
    );
    expect(stripConflictingTraits('soft red light on skin, bedroom', ASPECTO)).toBe(
      'soft red light on skin, bedroom',
    );
  });

  it('pero una palabra que ya solo significa rubor si las alcanza', () => {
    expect(stripConflictingTraits('flushed skin, arched back', ASPECTO)).toBe('arched back');
  });

  it('el adverbio se va con el verbo', () => {
    const { text, dropped } = stripConflictingTraitsDetailed(
      'blushing furiously, hands over face',
      ASPECTO,
    );
    // dejar «furiously» suelto convierte la etiqueta en ruido
    expect(text).toBe('hands over face');
    expect(dropped).toEqual(['blushing furiously']);
  });

  it('no deja el espacio que quedaba delante de la coma', () => {
    expect(stripConflictingTraits('she blushes, looking away', ASPECTO)).toBe('she, looking away');
  });

  it('acumulado no deja dos etiquetas muertas de tres', () => {
    expect(stripConflictingTraits('pink cheeks, flushed skin, blushing, on bed', ASPECTO)).toBe(
      'on bed',
    );
  });

  it('un sustantivo que la escena ya escribio solo NO se toca', () => {
    // el huerfano se quita donde el recorte ha tocado; ahi no ha tocado nada
    expect(stripConflictingTraits('cheeks, lips parted', ASPECTO)).toBe('cheeks, lips parted');
  });

  it('apunta lo que quito, no lo que sigue escrito', () => {
    // devolver un fragmento lo añade al final: si el fragmento arrastrase las
    // palabras que se quedaron, el positivo las tendria dos veces
    const { text, dropped } = stripConflictingTraitsDetailed('flushed warm skin, night', ASPECTO);
    expect(text).toBe('warm skin, night');
    expect(dropped).toEqual(['flushed skin']);
  });

  it('y lo que no quita no lo apunta: «red glow on skin»', () => {
    const { text, dropped } = stripConflictingTraitsDetailed('red glow on skin, night', ASPECTO);
    expect(text).toBe('red glow on skin, night');
    expect(dropped).toEqual([]);
  });

  it('el rubor repetido se apunta una sola vez', () => {
    const { text, dropped } = stripConflictingTraitsDetailed(
      'blushing hard, lips parted, blushing again',
      ASPECTO,
    );
    expect(dropped).toEqual(['blushing']);
    expect(text).toBe('hard, lips parted, again');
  });
});

// Las cuatro familias en la misma escena, que es como llegan de verdad.
describe('las cuatro familias se recortan juntas y por orden', () => {
  const ASPECTO = 'light brown hair, blue eyes, pale skin, slim body, blush';

  it('color, origen, complexion y rubor, y la escena sobrevive entera', () => {
    const escena = 'petite japanese woman 18, small body, blushing, dark hair wild across pillow';
    const { text, dropped } = stripConflictingTraitsDetailed(escena, ASPECTO);
    // «body» se queda solo y se va entero; «hair wild across pillow» no, porque
    // lo que sigue detras es escena
    expect(text).toBe('petite woman 18, hair wild across pillow');
    // el orden es el orden en que se recorta, y es el que ve el panel
    expect(dropped).toEqual(['dark hair', 'japanese woman', 'small body', 'blushing']);
  });

  it('el plan compuesto arrastra los cuatro avisos', () => {
    const plan = composeHordeImagePlan({
      recipe: recipe({ appearance: ASPECTO }),
      scene: 'petite japanese woman 18, small body, blushing, dark hair wild across pillow',
      extraNegative: '',
    });
    expect(plan.dropped).toEqual(['dark hair', 'japanese woman', 'small body', 'blushing']);
  });
});

// Se exporta desde que el plan de imagen compone el mismo texto que sale por el
// transporte: duplicar esta fusion seria garantizar que un dia los dos caminos
// digan cosas distintas.
describe('mergeNegatives', () => {
  it('funde sin repetir, y la receta va primero', () => {
    expect(mergeNegatives('blurry, 2girls', 'BLURRY, watermark')).toBe('blurry, 2girls, watermark');
  });

  it('un negativo vacio no deja separadores sueltos', () => {
    // importa porque un negativo de un solo espacio acabaria en un ' ### ' vacio,
    // y el generador intentaria no dibujar «###»
    expect(mergeNegatives('', '   ')).toBe('');
    expect(mergeNegatives('blurry', '')).toBe('blurry');
    expect(mergeNegatives('', 'blurry')).toBe('blurry');
  });
});

// Daniel: «la idea es ganar kudos, me da igual que se comparta la foto de Lia».
// Con una cuenta nueva los kudos SON el puesto en la cola —el suyo era el 151 de
// 400 segundos— y compartir es la unica palanca que no pide dinero ni una GPU.
// Estaba fijado a `false` en el codigo y no habia forma de tocarlo.
describe('donar las imagenes a cambio de kudos', () => {
  it('por defecto NO se comparte', () => {
    // donar contenido de la boveda no puede ser lo que viene puesto
    expect(recipe().shared).toBe(false);
  });

  it('se puede activar, y es de la receta: por personaje', () => {
    // uno puede ser anodino y otro no; no es una decision de la maquina
    expect(recipe({ shared: true }).shared).toBe(true);
  });

  it('lo que diga la receta llega a la peticion', () => {
    const compartida = buildHordeRequest({
      recipe: recipe({ shared: true }),
      prompt: 'sitting on a bed',
      extraNegative: '',
      shared: recipe({ shared: true }).shared,
    });
    expect(compartida.shared).toBe(true);

    const privada = buildHordeRequest({
      recipe: recipe(),
      prompt: 'sitting on a bed',
      extraNegative: '',
      shared: recipe().shared,
    });
    expect(privada.shared).toBe(false);
  });

  it('una receta guardada antes de este campo se abre sin compartir', () => {
    // `default(false)` y no `optional()`: lo que ya esta en disco no puede
    // volverse compartido por un cambio de esquema
    const vieja = hordeRecipeSchema.parse({
      models: ['WAI-NSFW-illustrious-SDXL'],
      appearance: 'brown hair, blue eyes',
    });
    expect(vieja.shared).toBe(false);
  });
});

// PASO DE VERDAD: con WAI-ANI-NSFW-PONYXL y un aspecto que empezaba por
// «masterpiece, best quality» —el prefijo de Illustrious—, una escena de baño y
// desnudo devolvio un retrato de busto, vestida y sobre fondo blanco. Pony sin
// sus `score_` no falla con un error: devuelve algo generico que ignora media
// peticion, y eso se confunde con «no se entendio el prompt».
describe('el prefijo de calidad que pide cada familia', () => {
  const ILUSTRIOUS = 'masterpiece, best quality, brown hair, blue eyes';

  it('reconoce los Pony por el nombre', () => {
    expect(isPonyModel('WAI-ANI-NSFW-PONYXL')).toBe(true);
    expect(isPonyModel('Prefect Pony')).toBe(true);
    expect(isPonyModel('CyberRealistic Pony')).toBe(true);
    expect(isPonyModel('WAI-NSFW-illustrious-SDXL')).toBe(false);
  });

  it('avisa con un Pony y el prefijo de Illustrious', () => {
    const aviso = qualityPrefixWarning(['WAI-ANI-NSFW-PONYXL'], ILUSTRIOUS);
    expect(aviso).not.toBeNull();
    expect(aviso).toContain('score_9');
  });

  it('no avisa si el aspecto ya trae los score_', () => {
    expect(
      qualityPrefixWarning(['WAI-ANI-NSFW-PONYXL'], 'score_9, score_8_up, brown hair'),
    ).toBeNull();
  });

  it('no avisa con un Illustrious, que es el que usa masterpiece', () => {
    expect(qualityPrefixWarning(['WAI-NSFW-illustrious-SDXL'], ILUSTRIOUS)).toBeNull();
  });

  it('con la receta MEZCLADA se calla: ahi el aviso que toca es el otro', () => {
    // ningun prefijo puede estar bien para las dos familias, asi que decir
    // «pon score_» seria un consejo equivocado
    expect(
      qualityPrefixWarning(['WAI-ANI-NSFW-PONYXL', 'WAI-NSFW-illustrious-SDXL'], ILUSTRIOUS),
    ).toBeNull();
  });

  it('sin modelos no avisa de nada', () => {
    expect(qualityPrefixWarning([], ILUSTRIOUS)).toBeNull();
  });
});
