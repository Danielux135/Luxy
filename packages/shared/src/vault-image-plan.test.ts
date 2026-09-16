import { describe, expect, it } from 'vitest';

import {
  buildHordeRequest,
  composeHordeImagePlan,
  composeXaviraImagePlan,
  computePlanId,
  imageAttemptSchema,
  planFromEdit,
  planToHordeRequest,
  splitJoinedPrompt,
  vaultImagePlanEditSchema,
  vaultImagePlanSchema,
  type HordeImagePlan,
} from './vault-image-plan.js';
import { IMAGE_PLAN_TEXT_LIMITS } from './vault-image-plan-policy.js';
import { hordeRecipeSchema, type HordeRecipe } from './vault-image-provider.js';

/** receta minima valida: cada prueba cambia solo lo que le importa */
function recipe(overrides: Record<string, unknown> = {}): HordeRecipe {
  return hordeRecipeSchema.parse({
    models: ['WAI-NSFW-illustrious-SDXL'],
    appearance: 'light brown hair, blue eyes, slim build',
    ...overrides,
  });
}

describe('composeHordeImagePlan', () => {
  it('reproduce byte a byte el prompt que hoy devuelve buildHordeRequest', () => {
    // la prueba de no-regresion de la extraccion: si esto se separa, el panel
    // enseñaria un texto y el horde recibiria otro
    const casos = [
      { recipe: recipe({ outfit: 'black dress' }), prompt: 'sitting on a bed, warm light' },
      { recipe: recipe({ negative: 'blurry' }), prompt: 'dark hair wild across pillow' },
      {
        recipe: recipe({ outfit: '', negative: 'blurry, 2girls' }),
        prompt: 'petite japanese woman 18, naked',
      },
      { recipe: recipe({ seed: '1080257389', loras: [{ name: '12345' }] }), prompt: 'standing' },
    ];

    for (const caso of casos) {
      const heredado = buildHordeRequest({
        recipe: caso.recipe,
        prompt: caso.prompt,
        extraNegative: 'camera, selfie',
        shared: caso.recipe.shared,
      });
      const plan = composeHordeImagePlan({
        recipe: caso.recipe,
        scene: caso.prompt,
        extraNegative: 'camera, selfie',
      });
      expect(plan.joined).toBe(heredado.prompt);
      expect(planToHordeRequest(plan)).toEqual(heredado);
    }
  });

  it('no añade " ### " cuando no hay ningun negativo', () => {
    const plan = composeHordeImagePlan({
      recipe: recipe(),
      scene: 'standing',
      extraNegative: '   ',
    });
    expect(plan.negative).toBe('');
    expect(plan.joined).not.toContain('###');
    expect(plan.joined).toBe(plan.positive);
  });

  it('guarda la escena pedida y los rasgos que el recorte le quito', () => {
    const plan = composeHordeImagePlan({
      recipe: recipe(),
      scene: 'dark hair wild across pillow',
      extraNegative: '',
    });
    expect(plan.scene).toBe('dark hair wild across pillow');
    expect(plan.dropped).toContain('dark hair');
    expect(plan.positive).toContain('hair wild across pillow');
  });

  it('pasa la receta entera a los parametros, sin perder la semilla', () => {
    const suya = recipe({ seed: '1080257389', width: 832, height: 1216, shared: true });
    const plan = composeHordeImagePlan({ recipe: suya, scene: 'standing', extraNegative: '' });
    expect(plan.params.seed).toBe('1080257389');
    expect(plan.params.width).toBe(832);
    expect(plan.params.shared).toBe(true);
    expect(vaultImagePlanSchema.safeParse(plan).success).toBe(true);
  });
});

describe('planToHordeRequest', () => {
  it('manda plan.joined tal cual, incluso con un " ### " escrito a mano', () => {
    const plan = composeHordeImagePlan({
      recipe: recipe(),
      scene: 'standing',
      extraNegative: 'camera',
    });
    const editado = planFromEdit(plan, {
      provider: 'horde',
      positive: 'from behind ### not a separator ### still mine',
      negative: 'camera',
    });
    expect(editado).not.toBeNull();
    if (editado === null || editado.plan.provider !== 'horde') return;
    const request = planToHordeRequest(editado.plan);
    expect(request.prompt).toBe(editado.plan.joined);
    expect(request.prompt).toBe('from behind ### not a separator ### still mine ### camera');
  });

  it('fija nsfw e img2img y respeta la imagen de partida y el dry run', () => {
    const plan = composeHordeImagePlan({ recipe: recipe(), scene: 'standing', extraNegative: '' });
    const seco = planToHordeRequest(plan, { dryRun: true });
    expect(seco.nsfw).toBe(true);
    expect(seco.sourceProcessing).toBe('img2img');
    expect(seco.sourceImage).toBeNull();
    expect(seco.dryRun).toBe(true);

    const desdeImagen = planToHordeRequest(plan, { sourceImage: 'QUJD' });
    expect(desdeImagen.sourceImage).toBe('QUJD');
    expect(desdeImagen.dryRun).toBeUndefined();
  });
});

describe('splitJoinedPrompt', () => {
  it('devuelve las dos mitades que compuso el plan', () => {
    // es lo que lee el visor de un medio ya guardado: alli solo hay el prompt
    // entero, y enseñarlo de una pieza es justo lo que no explica una imagen
    const plan = composeHordeImagePlan({
      recipe: recipe({ outfit: 'black dress' }),
      scene: 'sitting on a bed',
      extraNegative: 'watermark',
    });
    const partido = splitJoinedPrompt(plan.joined);
    expect(partido.positive).toBe(plan.positive);
    expect(partido.negative).toBe(plan.negative);
  });

  it('sin separador no se inventa un negativo vacio', () => {
    // «no se mando ninguno» y «se mando vacio» no son lo mismo, y la pantalla
    // tiene que poder callarse en el primer caso
    const plan = composeHordeImagePlan({
      recipe: recipe({ negative: '' }),
      scene: 'standing',
      extraNegative: '',
    });
    expect(plan.joined).not.toContain(' ### ');
    expect(splitJoinedPrompt(plan.joined)).toEqual({ positive: plan.joined, negative: null });
  });

  it('un separador escrito a mano se queda dentro del negativo', () => {
    // se parte por el PRIMERO, que es el que puso la union: los de sobra
    // viajaron dentro del negativo y ahi se enseñan
    expect(splitJoinedPrompt('from behind ### not a separator ### camera')).toEqual({
      positive: 'from behind',
      negative: 'not a separator ### camera',
    });
  });
});

describe('computePlanId', () => {
  it('no depende del orden en que se escribieron las claves', () => {
    const plan = composeHordeImagePlan({ recipe: recipe(), scene: 'standing', extraNegative: '' });
    const reordenado: HordeImagePlan = {
      planId: plan.planId,
      scene: plan.scene,
      dropped: plan.dropped,
      joined: plan.joined,
      negative: plan.negative,
      positive: plan.positive,
      provider: 'horde',
      params: {
        shared: plan.params.shared,
        denoisingStrength: plan.params.denoisingStrength,
        postProcessing: plan.params.postProcessing,
        hiresFix: plan.params.hiresFix,
        loras: plan.params.loras,
        seed: plan.params.seed,
        clipSkip: plan.params.clipSkip,
        scheduler: plan.params.scheduler,
        samplerName: plan.params.samplerName,
        cfgScale: plan.params.cfgScale,
        steps: plan.params.steps,
        height: plan.params.height,
        width: plan.params.width,
        models: plan.params.models,
      },
    };
    expect(computePlanId(reordenado)).toBe(plan.planId);
  });

  it('cambia si cambia el positivo, el negativo o la semilla', () => {
    const base = composeHordeImagePlan({
      recipe: recipe(),
      scene: 'standing',
      extraNegative: 'camera',
    });
    const otroPositivo = { ...base, positive: `${base.positive}, from behind` };
    const otroNegativo = { ...base, negative: 'camera, selfie' };
    const otraSemilla = { ...base, params: { ...base.params, seed: '42' } };

    expect(computePlanId(otroPositivo)).not.toBe(base.planId);
    expect(computePlanId(otroNegativo)).not.toBe(base.planId);
    expect(computePlanId(otraSemilla)).not.toBe(base.planId);
  });

  it('no mira la escena, lo recortado ni la huella anterior', () => {
    const base = composeHordeImagePlan({ recipe: recipe(), scene: 'standing', extraNegative: '' });
    const disfrazado = {
      ...base,
      scene: 'otra cosa completamente distinta',
      dropped: ['dark hair'],
      planId: '0000000000000000',
    };
    expect(computePlanId(disfrazado)).toBe(base.planId);
  });

  it('devuelve dieciseis digitos hexadecimales', () => {
    const plan = composeHordeImagePlan({ recipe: recipe(), scene: 'standing', extraNegative: '' });
    expect(plan.planId).toMatch(/^[0-9a-f]{16}$/);
    expect(vaultImagePlanSchema.safeParse(plan).success).toBe(true);
  });
});

describe('planFromEdit', () => {
  it('no vuelve a recortar un color que la persona escribio a proposito', () => {
    const base = composeHordeImagePlan({
      recipe: recipe(),
      scene: 'dark hair wild across pillow',
      extraNegative: '',
    });
    // el recorte automatico se lo habia quitado: la receta dice «light brown hair»
    expect(base.positive).not.toContain('dark hair');

    const editado = planFromEdit(base, {
      provider: 'horde',
      positive: 'dark hair wild across pillow, from behind',
      negative: '',
    });
    expect(editado).not.toBeNull();
    if (editado === null) return;
    expect(editado.plan.provider).toBe('horde');
    if (editado.plan.provider !== 'horde') return;
    expect(editado.plan.positive).toBe('dark hair wild across pillow, from behind');
    expect(editado.plan.joined).toBe('dark hair wild across pillow, from behind');
    expect(editado.source).toBe('editado');
    expect(editado.plan.planId).not.toBe(base.planId);
  });

  it('un plan que vuelve sin tocar sigue siendo compuesto', () => {
    const base = composeHordeImagePlan({
      recipe: recipe(),
      scene: 'standing',
      extraNegative: 'camera',
    });
    const editado = planFromEdit(base, {
      provider: 'horde',
      positive: base.positive,
      negative: base.negative,
    });
    expect(editado?.source).toBe('compuesto');
    expect(editado?.plan.planId).toBe(base.planId);
  });

  it('rechaza una correccion del proveedor equivocado', () => {
    const base = composeHordeImagePlan({ recipe: recipe(), scene: 'standing', extraNegative: '' });
    expect(planFromEdit(base, { provider: 'xavira', prompt: 'standing' })).toBeNull();

    const xavira = composeXaviraImagePlan({ scene: 'standing', extraNegative: 'camera' });
    expect(planFromEdit(xavira, { provider: 'horde', positive: 'a', negative: '' })).toBeNull();
  });

  it('en xavira reescribe el prompt y deja el negativo fijo donde estaba', () => {
    const base = composeXaviraImagePlan({ scene: 'standing', extraNegative: 'camera, selfie' });
    const editado = planFromEdit(base, { provider: 'xavira', prompt: 'from behind' });
    expect(editado).not.toBeNull();
    if (editado === null || editado.plan.provider !== 'xavira') return;
    expect(editado.plan.prompt).toBe('from behind');
    expect(editado.plan.negativeAppend).toBe('camera, selfie');
    expect(editado.source).toBe('editado');
  });
});

describe('composeXaviraImagePlan', () => {
  it('no compone identidad ni texto unido: eso vive en el servidor del proveedor', () => {
    const plan = composeXaviraImagePlan({ scene: 'standing', extraNegative: 'camera' });
    expect(plan.prompt).toBe('standing');
    expect(plan.negativeAppend).toBe('camera');
    expect(Object.keys(plan)).not.toContain('joined');
    expect(Object.keys(plan)).not.toContain('positive');
    expect(vaultImagePlanSchema.safeParse(plan).success).toBe(true);
  });
});

describe('vaultImagePlanSchema', () => {
  it('rechaza un positivo por encima del tope y un lado que no es multiplo de 64', () => {
    const plan = composeHordeImagePlan({ recipe: recipe(), scene: 'standing', extraNegative: '' });
    expect(vaultImagePlanSchema.safeParse({ ...plan, positive: 'a'.repeat(6001) }).success).toBe(
      false,
    );
    expect(
      vaultImagePlanSchema.safeParse({ ...plan, params: { ...plan.params, width: 1000 } }).success,
    ).toBe(false);
  });

  it('el tope del unido cabe todo lo que la correccion puede escribir', () => {
    // el fallo real: `MAX_JOINED` estaba escrito a mano como 8000, pero el
    // esquema de la correccion acepta 6000 de positivo y 2000 de negativo, y la
    // union mete ' ### ' en medio. 8005 > 8000, asi que un texto que el panel
    // daba por bueno lo rechazaba `vaultImagePlanSchema.parse` en el proceso
    // principal, con un volcado de Zod en vez de una frase
    const positive = 'a'.repeat(IMAGE_PLAN_TEXT_LIMITS.positive);
    const negative = 'b'.repeat(IMAGE_PLAN_TEXT_LIMITS.negative);
    const base = composeHordeImagePlan({ recipe: recipe(), scene: 'standing', extraNegative: '' });
    const editado = planFromEdit(base, { provider: 'horde', positive, negative });
    expect(editado).not.toBeNull();
    if (editado === null || editado.plan.provider !== 'horde') return;

    expect(editado.plan.joined.length).toBe(
      IMAGE_PLAN_TEXT_LIMITS.positive + ' ### '.length + IMAGE_PLAN_TEXT_LIMITS.negative,
    );
    expect(vaultImagePlanSchema.safeParse(editado.plan).success).toBe(true);
  });

  it('acepta un positivo largo que el tope de la escena rechazaria', () => {
    const plan = composeHordeImagePlan({
      recipe: recipe({ appearance: 'a'.repeat(1200), outfit: 'b'.repeat(400) }),
      scene: 'c'.repeat(2000),
      extraNegative: '',
    });
    expect(plan.positive.length).toBeGreaterThan(3000);
    expect(vaultImagePlanSchema.safeParse(plan).success).toBe(true);
  });
});

describe('vaultImagePlanEditSchema', () => {
  it('rechaza un campo que el contrato no admite en vez de tirarlo en silencio', () => {
    // sin `.strict()`, un `seed` colado en la correccion pasaba la validacion,
    // se descartaba sin ruido y la imagen salia con la semilla de la receta —o
    // con una sorteada— sin que nada lo dijera. El objeto que la envuelve en el
    // IPC si es estricto: dentro de `edit` tambien tiene que serlo
    expect(
      vaultImagePlanEditSchema.safeParse({
        provider: 'horde',
        positive: 'standing',
        negative: '',
        seed: '1080257389',
      }).success,
    ).toBe(false);

    expect(
      vaultImagePlanEditSchema.safeParse({
        provider: 'xavira',
        prompt: 'standing',
        negativeAppend: 'camera',
      }).success,
    ).toBe(false);

    // y lo que si admite sigue pasando
    expect(
      vaultImagePlanEditSchema.safeParse({ provider: 'horde', positive: 'standing', negative: '' })
        .success,
    ).toBe(true);
    expect(
      vaultImagePlanEditSchema.safeParse({ provider: 'xavira', prompt: 'standing' }).success,
    ).toBe(true);
  });
});

describe('imageAttemptSchema', () => {
  it('rellena lo que no se sabe todavia en un intento recien creado', () => {
    const plan = composeHordeImagePlan({ recipe: recipe(), scene: 'standing', extraNegative: '' });
    const parsed = imageAttemptSchema.parse({
      attemptId: '0b4d5a2e-2f3a-4c5b-8d6e-7f8091a2b3c4',
      conversationId: 'conv-1',
      createdAt: '2026-09-16T10:00:00.000Z',
      state: 'pending',
      plan,
      planId: plan.planId,
    });
    expect(parsed.source).toBe('compuesto');
    expect(parsed.mediaId).toBeNull();
    expect(parsed.seed).toBeNull();
    expect(parsed.rc).toBeNull();
    expect(parsed.warnings).toEqual([]);
    expect(parsed.malformedReason).toBeNull();
    expect(parsed.characterId).toBeNull();
  });

  it('guarda el rc y los avisos del envio, que hoy se pierden', () => {
    const parsed = imageAttemptSchema.parse({
      attemptId: '0b4d5a2e-2f3a-4c5b-8d6e-7f8091a2b3c4',
      conversationId: 'conv-1',
      createdAt: '2026-09-16T10:00:00.000Z',
      state: 'failed',
      planId: '0000000000000000',
      rc: 'csam',
      errorMessage: 'la peticion se rechazo',
      warnings: [{ code: 'AnonymousKeySharesImage', message: 'con la clave anonima se comparte' }],
    });
    expect(parsed.rc).toBe('csam');
    expect(parsed.plan).toBeNull();
    expect(parsed.warnings[0]?.code).toBe('AnonymousKeySharesImage');
  });

  it('rechaza un estado que no existe y un identificador que no es uuid', () => {
    const base = {
      attemptId: '0b4d5a2e-2f3a-4c5b-8d6e-7f8091a2b3c4',
      conversationId: 'conv-1',
      createdAt: '2026-09-16T10:00:00.000Z',
      state: 'pending',
      planId: '0000000000000000',
    };
    expect(imageAttemptSchema.safeParse({ ...base, state: 'censurado' }).success).toBe(false);
    expect(imageAttemptSchema.safeParse({ ...base, attemptId: 'no-es-uuid' }).success).toBe(false);
  });
});
