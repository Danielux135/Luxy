// pruebas del ajuste «dibujar las escenas en las que salis los dos».
//
// Son TRES piezas y hacen falta las tres: el bloque de instrucciones, el
// negativo y el recorte del `solo`. Con una sola, la foto sigue saliendo con una
// figura.
//
// Y la primera prueba es la que manda: con el ajuste APAGADO nada cambia. Se
// compara contra el VALOR LITERAL y no contra otra llamada a la misma funcion,
// porque comparar una funcion consigo misma pasa igual de bien cuando las dos
// ramas estan rotas.
import { describe, expect, it } from 'vitest';

import {
  buildVaultImageInstruction,
  VAULT_IMAGE_NEGATIVE,
  VAULT_IMAGE_SECOND_PERSON_BANS,
  withoutSecondPersonBans,
} from './vault-image-request.js';
import {
  hordeRecipeSchema,
  sceneIncludesSecondFigure,
  stripSoloTagsDetailed,
  VAULT_IMAGE_SOLO_TAGS,
  type HordeRecipe,
} from './vault-image-provider.js';
import { composeHordeImagePlan, composeXaviraImagePlan } from './vault-image-plan.js';
import { buildVaultPrompt } from './vault-prompt.js';

/** el negativo de hoy, escrito a mano: es el valor contra el que se compara */
const NEGATIVO_DE_HOY =
  '2girls, multiple girls, 2boys, multiple people, another person, camera, holding camera, holding phone, smartphone, selfie, taking a photo';

/** la frase del bloque que hoy manda generar la foto solo con ella */
const FRASE_DE_HOY = 'generala solo contigo, en plano cercano';
/** y la que sale en su lugar con el ajuste encendido */
const FRASE_DE_LOS_DOS = 'describe la escena ENTERA, con los dos';

/** una receta como las de verdad: la apariencia empieza por `solo` */
function receta(overrides: Record<string, unknown> = {}): HordeRecipe {
  return hordeRecipeSchema.parse({
    models: ['WAI-ANI-NSFW-PONYXL'],
    appearance: 'solo, 1girl, light brown hair, blue eyes',
    ...overrides,
  });
}

const ESCENA_DE_UNA = 'on a bed, blue dress, warm light';
const ESCENA_DE_DOS = '1boy, on a bed, blue dress, warm light';

describe('con el ajuste APAGADO no cambia absolutamente nada', () => {
  it('el negativo es el literal de hoy', () => {
    expect(VAULT_IMAGE_NEGATIVE).toBe(NEGATIVO_DE_HOY);
  });

  it('el bloque sigue diciendo que la genere solo con ella', () => {
    // el valor por defecto y el explicito tienen que decir lo mismo: los dos
    // caminos llegan aqui, uno desde un llamador viejo y otro desde el nuevo
    for (const bloque of [
      buildVaultImageInstruction([], 'tags', true),
      buildVaultImageInstruction([], 'tags', true, null, 'character-only'),
    ]) {
      expect(bloque).toContain(FRASE_DE_HOY);
      expect(bloque).not.toContain(FRASE_DE_LOS_DOS);
      expect(bloque).toContain('- Solo aparece EL PERSONAJE, a solas');
    }
  });

  it('el plan compuesto sale con el `solo` y con las tres etiquetas', () => {
    // la escena tiene a los dos y aun asi no se toca nada: el que manda es el
    // ajuste, y esta apagado
    for (const plan of [
      composeHordeImagePlan({
        recipe: receta(),
        scene: ESCENA_DE_DOS,
        extraNegative: VAULT_IMAGE_NEGATIVE,
      }),
      composeHordeImagePlan({
        recipe: receta(),
        scene: ESCENA_DE_DOS,
        extraNegative: VAULT_IMAGE_NEGATIVE,
        cast: 'character-only',
      }),
    ]) {
      expect(plan.positive).toBe('solo, 1girl, light brown hair, blue eyes, 1boy, on a bed, blue dress, warm light');
      expect(plan.negative).toBe(NEGATIVO_DE_HOY);
      expect(plan.dropped).toEqual([]);
    }
  });

  it('y el recorte de rasgos sigue quitando lo mismo que quitaba', () => {
    // el camino de siempre: la escena repite un color que la apariencia ya fija
    const plan = composeHordeImagePlan({
      recipe: receta(),
      scene: 'dark hair wild across pillow',
      extraNegative: VAULT_IMAGE_NEGATIVE,
    });
    expect(plan.positive).toBe(
      'solo, 1girl, light brown hair, blue eyes, hair wild across pillow',
    );
    expect(plan.dropped).toEqual(['dark hair']);
  });

  it('el proveedor de pago tampoco cambia su negativo', () => {
    const plan = composeXaviraImagePlan({
      scene: ESCENA_DE_DOS,
      extraNegative: VAULT_IMAGE_NEGATIVE,
    });
    expect(plan.negativeAppend).toBe(NEGATIVO_DE_HOY);
  });
});

describe('encendido, pero con una escena de una sola persona', () => {
  it('conserva el negativo entero y el `solo`', () => {
    // el ajuste dice que se PUEDE dibujar a los dos, no que haya dos. Una foto
    // de ella sola conserva las defensas que la protegen de gente de mas
    const plan = composeHordeImagePlan({
      recipe: receta(),
      scene: ESCENA_DE_UNA,
      extraNegative: VAULT_IMAGE_NEGATIVE,
      cast: 'both',
    });
    expect(plan.negative).toBe(NEGATIVO_DE_HOY);
    expect(plan.positive).toContain('solo,');
    expect(plan.dropped).toEqual([]);
  });

  it('un pronombre o la camisa de el no cuentan como una segunda figura', () => {
    // «wearing his shirt» es una escena de ella sola: si los pronombres
    // contaran, esa foto perderia sus defensas sin que salga nadie
    for (const escena of [
      'wearing his shirt, on a bed',
      'a woman looking away',
      'female, heterochromia, standing',
    ]) {
      expect(sceneIncludesSecondFigure(escena)).toBe(false);
    }
  });

  it('nombrar al otro si cuenta, en etiquetas y en prosa', () => {
    for (const escena of [
      '1girl, 1boy, on a bed',
      'a man holding her from behind',
      '2boys, standing',
      'hetero, on a bed',
    ]) {
      expect(sceneIncludesSecondFigure(escena)).toBe(true);
    }
  });
});

describe('encendido y con una escena de dos', () => {
  const plan = composeHordeImagePlan({
    recipe: receta(),
    scene: ESCENA_DE_DOS,
    extraNegative: VAULT_IMAGE_NEGATIVE,
    cast: 'both',
  });

  it('el bloque de instrucciones es el otro', () => {
    const bloque = buildVaultImageInstruction([], 'tags', true, null, 'both');
    expect(bloque).toContain(FRASE_DE_LOS_DOS);
    expect(bloque).not.toContain(FRASE_DE_HOY);
    // la otra mitad, sin la cual la primera no sirve: aqui es donde se prohibia
    // nombrar al usuario, que es lo unico que hace que salga
    expect(bloque).not.toContain('- Solo aparece EL PERSONAJE, a solas');
    expect(bloque).toContain('Si estais los dos, nombralo');
  });

  it('el bloque encendido no es mas largo que el de siempre', () => {
    // las dos redacciones son excluyentes, asi que solo viaja una. El tope de
    // 6.500 tiene poquisimo margen: si la rama nueva creciera, lo rompe ella
    for (const style of ['prose', 'tags'] as const) {
      const apagado = buildVaultImageInstruction([], style, true, null, 'character-only');
      const encendido = buildVaultImageInstruction([], style, true, null, 'both');
      expect(encendido.length).toBeLessThanOrEqual(apagado.length);
      expect(encendido.length).toBeLessThan(6500);
    }
  });

  it('el negativo pierde las tres etiquetas y conserva `2girls`', () => {
    for (const prohibida of VAULT_IMAGE_SECOND_PERSON_BANS) {
      expect(plan.negative).not.toContain(prohibida);
    }
    // el fallo real que hizo nacer esta lista fue una segunda MUJER que nadie
    // pidio, y eso sigue siendo un fallo aunque en la escena salgan los dos
    expect(plan.negative).toBe(
      '2girls, multiple girls, 2boys, camera, holding camera, holding phone, smartphone, selfie, taking a photo',
    );
  });

  it('`solo` sale del positivo y aparece en lo que se enseña como quitado', () => {
    expect(plan.positive).toBe('1girl, light brown hair, blue eyes, 1boy, on a bed, blue dress, warm light');
    expect(plan.dropped).toContain('solo');
  });

  it('el negativo de la receta tambien pierde la prohibicion', () => {
    // si la receta repite «2boys» por su cuenta, el ajuste que el usuario acaba
    // de encender no serviria de nada
    const plan = composeHordeImagePlan({
      recipe: receta({ negative: 'blurry, 2boys' }),
      scene: ESCENA_DE_DOS,
      extraNegative: VAULT_IMAGE_NEGATIVE,
      cast: 'both',
    });
    expect(plan.negative).toBe(
      'blurry, 2boys, 2girls, multiple girls, camera, holding camera, holding phone, smartphone, selfie, taking a photo',
    );
  });

  it('el proveedor de pago pierde las mismas tres', () => {
    const plan = composeXaviraImagePlan({
      scene: ESCENA_DE_DOS,
      extraNegative: VAULT_IMAGE_NEGATIVE,
      cast: 'both',
    });
    expect(plan.negativeAppend).toBe(
      '2girls, multiple girls, 2boys, camera, holding camera, holding phone, smartphone, selfie, taking a photo',
    );
  });
});

describe('el ajuste llega hasta el prompt de verdad', () => {
  // el bloque se construye dentro de `composeVaultPrompt`: sin este cable, las
  // dos redacciones existirian y el modelo no veria nunca la segunda
  const base = { memory: null, turns: [], message: 'hola', canGenerateImage: true };

  it('sin decir nada, el prompt lleva la redaccion de siempre', () => {
    expect(buildVaultPrompt(base)).toContain(FRASE_DE_HOY);
  });

  it('con el ajuste encendido, lleva la otra', () => {
    const prompt = buildVaultPrompt({ ...base, imageCast: 'both' });
    expect(prompt).toContain(FRASE_DE_LOS_DOS);
    expect(prompt).not.toContain(FRASE_DE_HOY);
  });
});

describe('las piezas sueltas', () => {
  it('`withoutSecondPersonBans` solo se lleva esas tres', () => {
    // `2boys` NO se retira: la instruccion encendida nombra al otro en
    // singular, asi que prohibir el plural no contradice nada de lo pedido
    expect(withoutSecondPersonBans('2girls, 2boys, camera')).toBe('2girls, 2boys, camera');
    expect(withoutSecondPersonBans('2girls, another person, camera')).toBe('2girls, camera');
    // sin nada que quitar, devuelve lo mismo ya normalizado
    expect(withoutSecondPersonBans('2girls, camera')).toBe('2girls, camera');
    expect(withoutSecondPersonBans('')).toBe('');
  });

  it('el recorte del `solo` exige el elemento ENTERO', () => {
    // «solo lit by the window» es escena y se queda: `solo` no califica a nada
    const quedan = stripSoloTagsDetailed('solo lit by the window, 1girl');
    expect(quedan.text).toBe('solo lit by the window, 1girl');
    expect(quedan.dropped).toEqual([]);
  });

  it('se lleva las dos etiquetas y no deja comas huerfanas', () => {
    const limpio = stripSoloTagsDetailed('solo, solo focus, 1girl, on a bed');
    expect(limpio.text).toBe('1girl, on a bed');
    expect(limpio.dropped).toEqual([...VAULT_IMAGE_SOLO_TAGS]);
  });

  it('un `solo` repetido se apunta una vez', () => {
    // dos botones con la misma `key` en el panel avisan en consola y el segundo
    // no hace nada
    const limpio = stripSoloTagsDetailed('solo, 1girl, solo');
    expect(limpio.dropped).toEqual(['solo']);
  });
});
