import { describe, it, expect } from 'vitest';
import {
  IMAGE_ATTEMPT_STATE_LABELS,
  IMAGE_PLAN_TEXT_LIMITS,
  imagePlanBlockReason,
  imagePlanEditFrom,
  imagePlanEstimateBlockReason,
  isImagePlanEditValid,
  restoreDroppedFragment,
} from './vault-image-plan-policy.js';
import {
  VAULT_IMAGE_ATTEMPT_STATES,
  composeHordeImagePlan,
  composeXaviraImagePlan,
  planFromEdit,
  vaultImagePlanEditSchema,
  vaultImagePlanSchema,
  type VaultImagePlanEdit,
} from './vault-image-plan.js';
import type { HordeRecipe } from './vault-image-provider.js';

const RECIPE: HordeRecipe = {
  models: ['AlbedoBase XL (SDXL)'],
  appearance: 'light brown hair, green eyes',
  outfit: 'white shirt',
  negative: 'blurry',
  width: 896,
  height: 1152,
  steps: 30,
  cfgScale: 7,
  samplerName: 'k_euler_a',
  scheduler: 'karras',
  clipSkip: 2,
  seed: null,
  loras: [],
  hiresFix: false,
  postProcessing: [],
  promptStyle: 'tags',
  denoisingStrength: 0.6,
  shared: false,
};

const HORDE_EDIT: VaultImagePlanEdit = {
  provider: 'horde',
  positive: 'light brown hair, white shirt, sitting by the window',
  negative: 'blurry',
};

describe('lo que se puede mandar de un plan de imagen', () => {
  it('un pendiente con texto y sin nada en curso no tiene motivo de bloqueo', () => {
    expect(imagePlanBlockReason({ state: 'pending', edit: HORDE_EDIT, busy: false })).toBeNull();
  });

  it('un positivo vacio se bloquea aunque el negativo este lleno', () => {
    // vacio no es lo mismo que corto: sin positivo no hay peticion, y el horde
    // la rechazaria DESPUES de encolarla
    const reason = imagePlanBlockReason({
      state: 'pending',
      edit: { provider: 'horde', positive: '   \n  ', negative: 'blurry, extra fingers' },
      busy: false,
    });
    expect(reason).not.toBeNull();
    expect(reason).toContain('positivo está vacío');
  });

  it('un positivo que pasa del tope dice cuanto tiene y cuanto cabe', () => {
    const reason = imagePlanBlockReason({
      state: 'pending',
      edit: {
        provider: 'horde',
        positive: 'a'.repeat(IMAGE_PLAN_TEXT_LIMITS.positive + 5),
        negative: '',
      },
      busy: false,
    });
    // sin las dos cifras no se sabe cuanto sobra, que es lo unico que se puede
    // hacer con el aviso
    expect(reason).toContain(String(IMAGE_PLAN_TEXT_LIMITS.positive + 5));
    expect(reason).toContain(String(IMAGE_PLAN_TEXT_LIMITS.positive));
  });

  it('el negativo tiene su propio tope, mas bajo que el del positivo', () => {
    const reason = imagePlanBlockReason({
      state: 'pending',
      edit: {
        provider: 'horde',
        positive: 'una escena',
        negative: 'b'.repeat(IMAGE_PLAN_TEXT_LIMITS.negative + 1),
      },
      busy: false,
    });
    expect(reason).toContain('negativo');
  });

  it('un pendiente sustituido dice que fue un mensaje nuevo, no «no se puede»', () => {
    // la tarjeta lleva media hora en pantalla: la pregunta ya no es si se puede,
    // es que paso con la foto que ella ofrecio
    const reason = imagePlanBlockReason({ state: 'superseded', edit: HORDE_EDIT, busy: false });
    expect(reason).toContain('otro mensaje');
  });

  it('cada estado que no espera tiene su propia frase', () => {
    const frases = VAULT_IMAGE_ATTEMPT_STATES.filter((state) => state !== 'pending').map((state) =>
      imagePlanBlockReason({ state, edit: HORDE_EDIT, busy: false }),
    );
    expect(frases.every((frase) => frase !== null)).toBe(true);
    // ninguna repetida: si dos estados dijeran lo mismo, distinguirlos no
    // serviria de nada
    expect(new Set(frases).size).toBe(frases.length);
  });

  it('descartada dice que no costo nada, y ya mandada que se pagaria dos veces', () => {
    expect(imagePlanBlockReason({ state: 'discarded', edit: HORDE_EDIT, busy: false })).toContain(
      'no costó nada',
    );
    expect(imagePlanBlockReason({ state: 'sent', edit: HORDE_EDIT, busy: false })).toContain(
      'dos veces',
    );
  });

  it('el estado manda sobre el texto: un sustituido no se explica por estar vacio', () => {
    const reason = imagePlanBlockReason({
      state: 'superseded',
      edit: { provider: 'horde', positive: '', negative: '' },
      busy: false,
    });
    expect(reason).toContain('otro mensaje');
  });

  it('la ocupacion va la ultima, porque es la unica que se arregla esperando', () => {
    expect(imagePlanBlockReason({ state: 'pending', edit: HORDE_EDIT, busy: true })).toContain(
      'Espera',
    );
    // con el texto mal, lo que se dice es el texto: eso si depende de la persona
    expect(
      imagePlanBlockReason({
        state: 'pending',
        edit: { provider: 'horde', positive: '', negative: '' },
        busy: true,
      }),
    ).toContain('vacío');
  });

  it('en xavira la escena vacia se bloquea igual', () => {
    expect(
      imagePlanBlockReason({
        state: 'pending',
        edit: { provider: 'xavira', prompt: '  ' },
        busy: false,
      }),
    ).toContain('escena está vacía');
  });
});

describe('preguntar el precio en seco', () => {
  it('con el proveedor de pago no hay precio que preguntar', () => {
    const reason = imagePlanEstimateBlockReason({
      state: 'pending',
      edit: { provider: 'xavira', prompt: 'sentada junto a la ventana' },
      busy: false,
    });
    expect(reason).toContain('sin cobrarlo');
  });

  it('con AI Horde se pregunta por lo mismo que se mandaria', () => {
    expect(
      imagePlanEstimateBlockReason({ state: 'pending', edit: HORDE_EDIT, busy: false }),
    ).toBeNull();
    expect(
      imagePlanEstimateBlockReason({ state: 'discarded', edit: HORDE_EDIT, busy: false }),
    ).not.toBeNull();
  });
});

describe('los topes son los del contrato, no una copia', () => {
  // la pantalla necesita el numero para escribir «1.240 de 6.000»; esta prueba
  // es lo que impide que ese numero y el que aplica el IPC se separen
  it('el esquema acepta justo el tope y rechaza uno mas', () => {
    const justo: VaultImagePlanEdit = {
      provider: 'horde',
      positive: 'a'.repeat(IMAGE_PLAN_TEXT_LIMITS.positive),
      negative: 'b'.repeat(IMAGE_PLAN_TEXT_LIMITS.negative),
    };
    expect(vaultImagePlanEditSchema.safeParse(justo).success).toBe(true);
    expect(isImagePlanEditValid(justo)).toBe(true);

    expect(
      vaultImagePlanEditSchema.safeParse({
        ...justo,
        positive: 'a'.repeat(IMAGE_PLAN_TEXT_LIMITS.positive + 1),
      }).success,
    ).toBe(false);
    expect(
      vaultImagePlanEditSchema.safeParse({
        ...justo,
        negative: 'b'.repeat(IMAGE_PLAN_TEXT_LIMITS.negative + 1),
      }).success,
    ).toBe(false);

    const escena = 'c'.repeat(IMAGE_PLAN_TEXT_LIMITS.prompt);
    expect(vaultImagePlanEditSchema.safeParse({ provider: 'xavira', prompt: escena }).success).toBe(
      true,
    );
    expect(
      vaultImagePlanEditSchema.safeParse({ provider: 'xavira', prompt: `${escena}c` }).success,
    ).toBe(false);
  });

  it('lo que el panel da por bueno lo acepta tambien el esquema del plan', () => {
    // el fallo que esto caza: con los dos campos JUSTO en su tope el contador
    // decia «6000 de 6000», `imagePlanBlockReason` devolvia null y «Generar»
    // salia encendido, pero el unido —6000 + ' ### ' + 2000 = 8005— pasaba del
    // tope del plan y el rechazo saltaba despues, en el proceso principal, como
    // un volcado de Zod. Un boton encendido tiene que poder pulsarse
    const edit: VaultImagePlanEdit = {
      provider: 'horde',
      positive: 'a'.repeat(IMAGE_PLAN_TEXT_LIMITS.positive),
      negative: 'b'.repeat(IMAGE_PLAN_TEXT_LIMITS.negative),
    };
    expect(imagePlanBlockReason({ state: 'pending', edit, busy: false })).toBeNull();

    const base = composeHordeImagePlan({
      recipe: RECIPE,
      scene: 'sitting by the window',
      extraNegative: '',
    });
    const editado = planFromEdit(base, edit);
    expect(editado).not.toBeNull();
    if (editado === null) return;
    expect(vaultImagePlanSchema.safeParse(editado.plan).success).toBe(true);
  });
});

describe('el texto editable de un plan', () => {
  it('de un plan de horde salen el positivo y el negativo, no el unido', () => {
    const plan = composeHordeImagePlan({
      recipe: RECIPE,
      scene: 'sitting by the window',
      extraNegative: 'extra fingers',
    });
    const edit = imagePlanEditFrom(plan);
    expect(edit).toEqual({ provider: 'horde', positive: plan.positive, negative: plan.negative });
    // el unido NO se edita: se recalcula al aplicar la correccion, que es lo que
    // impide que lo enseñado y lo enviado dejen de ser lo mismo
    expect(edit).not.toHaveProperty('joined');
  });

  it('de un plan de xavira sale solo la escena', () => {
    const plan = composeXaviraImagePlan({ scene: 'junto a la ventana', extraNegative: 'borroso' });
    expect(imagePlanEditFrom(plan)).toEqual({ provider: 'xavira', prompt: plan.prompt });
  });
});

describe('devolver al positivo lo que el recorte quito', () => {
  it('se añade al final, detras de la identidad', () => {
    // delante contradiria la apariencia fija con mas peso, que es justo lo que
    // el recorte existe para evitar
    expect(restoreDroppedFragment('light brown hair, white shirt', 'dark hair')).toBe(
      'light brown hair, white shirt, dark hair',
    );
  });

  it('pulsarlo dos veces no lo duplica', () => {
    const una = restoreDroppedFragment('white shirt', 'dark hair');
    expect(restoreDroppedFragment(una, 'dark hair')).toBe(una);
    // ni aunque se escribiera con otras mayusculas
    expect(restoreDroppedFragment(una, 'Dark Hair')).toBe(una);
  });

  it('un fragmento que solo aparece dentro de otro trozo si se devuelve', () => {
    // 'hair' no esta suelto ahi: esta dentro de 'dark hair'. Si se comparase por
    // subcadena, el boton no haria nada y pareceria roto
    expect(restoreDroppedFragment('dark hair', 'hair')).toBe('dark hair, hair');
  });

  it('sobre un positivo vacio no deja una coma suelta delante', () => {
    expect(restoreDroppedFragment('', 'golden eyes')).toBe('golden eyes');
    expect(restoreDroppedFragment('   ', 'golden eyes')).toBe('golden eyes');
  });

  it('un fragmento en blanco no cambia nada', () => {
    expect(restoreDroppedFragment('white shirt', '  ')).toBe('white shirt');
  });
});

describe('como se llama cada estado en el registro', () => {
  it('tiene nombre para todos los estados que existen', () => {
    // el `Record` ya lo obliga al compilar; esto lo comprueba tambien en
    // ejecucion, que es lo que caza un estado añadido al enum desde otro sitio
    for (const state of VAULT_IMAGE_ATTEMPT_STATES) {
      expect(IMAGE_ATTEMPT_STATE_LABELS[state]).toBeTypeOf('string');
      expect(IMAGE_ATTEMPT_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });

  it('no repite ninguno: dos estados con el mismo nombre no se distinguen', () => {
    const nombres = Object.values(IMAGE_ATTEMPT_STATE_LABELS);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it('son etiquetas cortas, no las frases de por que no se puede generar', () => {
    // una frase de tres lineas dentro de una tabla de historia no se lee, y esa
    // es justo la diferencia con `SETTLED_REASONS`
    for (const nombre of Object.values(IMAGE_ATTEMPT_STATE_LABELS)) {
      expect(nombre.length).toBeLessThan(40);
    }
  });
});
