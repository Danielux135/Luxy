// el texto que sale hacia el generador deja de ser un efecto interno y pasa a
// ser un VALOR que se puede enseñar, corregir y comparar.
//
// El problema que resuelve: el prompt final —apariencia, ropa, escena recortada
// y negativo, unidos con ' ### '— solo existia dentro de `buildHordeRequest`,
// como variable local de la funcion que lo mandaba. Si la imagen volvia
// censurada, o con el encuadre que se pidio borrado por el recorte automatico,
// no habia forma de ver que se habia enviado de verdad: el texto moria con la
// llamada. Aqui se compone una vez, se devuelve entero y quien lo manda ya solo
// transporta.
//
// LA REGLA QUE SOSTIENE ESTO: `planToHordeRequest` es la UNICA funcion del
// repositorio que construye un `HordeImageRequest`. El camino compuesto por el
// sistema y el camino corregido a mano entran los dos por aqui, y por eso no
// pueden divergir —ni en el prefijo de calidad, ni en la fusion de negativos,
// ni en `nsfw`—. Si alguien vuelve a construir esa peticion en otro sitio, la
// garantia desaparece sin que nada falle.
//
// Modulo PURO: compone texto y lo devuelve. No cifra, no toca disco, no llama a
// ningun proveedor y no mira el reloj.
import { z } from 'zod';

import {
  mergeNegatives,
  stripConflictingTraitsDetailed,
  type HordeImageRequest,
  type HordeRecipe,
} from './vault-image-provider.js';

/**
 * los topes de texto del plan, que NO son los del bloque que escribe el modelo.
 *
 * `vaultImageRequestSchema.prompt` admite 2000 y ese es el tamaño de la ESCENA.
 * El positivo compuesto le suma la apariencia fija (hasta 1200) y la ropa
 * (hasta 400), asi que con el tope de la escena se rechazaria un plan
 * perfectamente valido antes de mandarlo.
 */
const MAX_POSITIVE = 6000;
const MAX_NEGATIVE = 2000;
/** lo que AI Horde lee como «lo que sigue es el negativo» */
const HORDE_NEGATIVE_SEPARATOR = ' ### ';
/**
 * el tope del texto unido NO es un numero suelto: es lo que cabe de verdad.
 *
 * Se DERIVA de los otros dos y del separador porque escribirlo a mano ya salio
 * mal una vez: con 8000 fijo, un positivo de 6000 y un negativo de 2000 —los
 * dos justo en su tope, los dos aceptados por `vaultImagePlanEditSchema` y por
 * el contador del panel— daban 8005 y `vaultImagePlanSchema.parse` los
 * rechazaba en el proceso principal con un ZodError crudo, despues de que el
 * boton «Generar» se hubiera enseñado encendido. Derivado, el plan acepta por
 * construccion todo lo que la correccion puede escribir.
 */
const MAX_JOINED = MAX_POSITIVE + HORDE_NEGATIVE_SEPARATOR.length + MAX_NEGATIVE;
const MAX_SCENE = 4000;
const MAX_XAVIRA_PROMPT = 4000;

const MAX_MODELS = 4;
const MAX_LORAS = 5;
const MIN_SIDE = 512;
const MAX_SIDE = 1536;
/** el horde solo acepta lados multiplos de 64: cualquier otro se rechaza entero */
const SIDE_STEP = 64;

/**
 * la huella del plan: 16 digitos hexadecimales.
 *
 * Sirve para comparar dos planes, no para firmar ninguno. Nunca se confia en la
 * que llega de fuera: quien recibe un plan editado recalcula la suya.
 */
export const planIdSchema = z
  .string()
  .regex(/^[0-9a-f]{16}$/, 'la huella del plan son 16 digitos hexadecimales');

const planLoraSchema = z.object({
  name: z.string().min(1).max(255),
  isVersion: z.boolean(),
  model: z.number().min(-5).max(5),
  clip: z.number().min(-5).max(5),
  injectTrigger: z.string().max(30).optional(),
});

/**
 * todo lo que viaja con el texto y decide como se dibuja.
 *
 * Se valida con los mismos limites que la receta —incluido el multiplo de 64—
 * porque un plan vuelve del renderer y es entrada externa: un lado invalido lo
 * rechaza el horde DESPUES de encolar, cuando ya no se puede explicar.
 */
export const hordeImagePlanParamsSchema = z
  .object({
    models: z.array(z.string().min(1).max(120)).min(1).max(MAX_MODELS),
    width: z.number().int().min(MIN_SIDE).max(MAX_SIDE),
    height: z.number().int().min(MIN_SIDE).max(MAX_SIDE),
    steps: z.number().int().min(1).max(60),
    cfgScale: z.number().min(0).max(30),
    samplerName: z.string().min(1).max(60),
    scheduler: z.string().min(1).max(60),
    clipSkip: z.number().int().min(1).max(12),
    /**
     * `null` significa que la sortea el servidor, y eso es media explicacion de
     * por que dos peticiones identicas dan imagenes distintas. El panel lo dice
     * con palabras; aqui basta con que el valor sobreviva al viaje.
     */
    seed: z.string().max(64).nullable(),
    loras: z.array(planLoraSchema).max(MAX_LORAS),
    hiresFix: z.boolean(),
    postProcessing: z.array(z.string().min(1).max(60)).max(2),
    denoisingStrength: z.number().min(0.01).max(1),
    /** dona lo generado a LAION; es del personaje, no de la maquina */
    shared: z.boolean(),
  })
  .superRefine((value, ctx) => {
    for (const side of ['width', 'height'] as const) {
      if (value[side] % SIDE_STEP === 0) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [side],
        message: `debe ser multiplo de ${SIDE_STEP}`,
      });
    }
  });
export type HordeImagePlanParams = z.infer<typeof hordeImagePlanParamsSchema>;

export const hordeImagePlanSchema = z.object({
  provider: z.literal('horde'),
  /** apariencia + ropa + escena ya recortada, en ese orden */
  positive: z.string().max(MAX_POSITIVE),
  /** el negativo de la receta fundido con el de la boveda, sin repetidos */
  negative: z.string().max(MAX_NEGATIVE),
  /**
   * los dos anteriores unidos EXACTAMENTE como saldran.
   *
   * AI Horde no tiene campo de negativo: lo lee del prompt, detras de ' ### '.
   * Se guarda ya unido y no se vuelve a calcular al mandarlo, porque recomponer
   * en el ultimo momento es justo lo que permitiria que lo enseñado y lo
   * enviado dejen de ser lo mismo.
   */
  joined: z.string().max(MAX_JOINED),
  params: hordeImagePlanParamsSchema,
  /**
   * lo que el recorte automatico le quito a la escena, para poder devolverlo.
   *
   * No es decorativo: es la respuesta a «pedi un encuadre y no llego».
   */
  dropped: z.array(z.string().max(200)).max(50),
  /** la escena TAL Y COMO se pidio, antes del recorte */
  scene: z.string().max(MAX_SCENE),
  planId: planIdSchema,
});

export const xaviraImagePlanSchema = z.object({
  provider: z.literal('xavira'),
  /**
   * lo unico que viaja: la escena.
   *
   * Aqui no hay composicion posible. La identidad del personaje vive en el
   * servidor del proveedor, detras de su `character_id`, asi que el texto
   * completo que se ejecuta NO existe en esta maquina y el panel no puede
   * fingir que lo enseña.
   */
  prompt: z.string().max(MAX_XAVIRA_PROMPT),
  /** el negativo fijo de la boveda; alla es un campo aparte, no va en el prompt */
  negativeAppend: z.string().max(MAX_NEGATIVE),
  scene: z.string().max(MAX_SCENE),
  planId: planIdSchema,
});

/** el plan de imagen, con el proveedor mandando: lo que se va a enviar, entero */
export const vaultImagePlanSchema = z.discriminatedUnion('provider', [
  hordeImagePlanSchema,
  xaviraImagePlanSchema,
]);
export type VaultImagePlan = z.infer<typeof vaultImagePlanSchema>;
export type HordeImagePlan = z.infer<typeof hordeImagePlanSchema>;
export type XaviraImagePlan = z.infer<typeof xaviraImagePlanSchema>;

/** un plan al que todavia le falta la huella: es lo que `computePlanId` mide */
export type VaultImagePlanDraft = Omit<HordeImagePlan, 'planId'> | Omit<XaviraImagePlan, 'planId'>;

/** quien escribio el texto que se mando: el sistema o la persona */
export const VAULT_IMAGE_PLAN_SOURCES = ['compuesto', 'editado'] as const;
export type VaultImagePlanSource = (typeof VAULT_IMAGE_PLAN_SOURCES)[number];

/**
 * la correccion que llega del panel.
 *
 * Solo texto: los parametros no se editan a mano. `clipSkip` lo fija el modelo
 * a proposito y un tamaño mal puesto se rechaza despues de encolar, cuando ya
 * no hay a quien explicarselo.
 *
 * Las dos ramas van `.strict()` justamente por eso: sin el, un `seed` o un
 * `width` colados en la correccion se tirarian EN SILENCIO y la imagen saldria
 * con otra semilla sin que nada lo dijera. Que un campo que el contrato no
 * admite se rechace en voz alta es la unica forma de que «solo texto» signifique
 * algo.
 */
export const vaultImagePlanEditSchema = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('horde'),
      positive: z.string().max(MAX_POSITIVE),
      negative: z.string().max(MAX_NEGATIVE),
    })
    .strict(),
  z.object({ provider: z.literal('xavira'), prompt: z.string().max(MAX_XAVIRA_PROMPT) }).strict(),
]);
export type VaultImagePlanEdit = z.infer<typeof vaultImagePlanEditSchema>;

/**
 * une positivo y negativo como los espera AI Horde.
 *
 * Sin negativo NO se pone el separador: un ' ### ' vacio al final se lee como
 * un negativo literal, y entonces el generador intenta no dibujar «###».
 */
function joinHordePrompt(positive: string, negative: string): string {
  return negative.length === 0 ? positive : `${positive}${HORDE_NEGATIVE_SEPARATOR}${negative}`;
}

/**
 * deshace `joinHordePrompt` sobre un prompt ya guardado.
 *
 * Hace falta para LEER historia: el sobre del medio guarda el prompt entero tal
 * y como salio —positivo y negativo pegados—, asi que la pantalla que lo enseña
 * tenia que partirlo. Vive aqui y no en el componente porque la union vive aqui:
 * si un dia cambia el separador, las dos mitades cambian juntas o ninguna.
 *
 * Se parte por el PRIMER separador, que es el que puso la union. Un texto
 * escrito a mano puede llevar mas, y entonces los de sobra se quedan dentro del
 * negativo: es donde viajaron de verdad, y recomponerlos de otra forma seria
 * enseñar algo que nunca se mando.
 *
 * `negative` es `null` cuando no habia separador, que no es lo mismo que un
 * negativo vacio: uno significa «no se mando ninguno» y el otro «se mando
 * vacio».
 */
export function splitJoinedPrompt(joined: string): { positive: string; negative: string | null } {
  const at = joined.indexOf(HORDE_NEGATIVE_SEPARATOR);
  if (at === -1) return { positive: joined, negative: null };
  return {
    positive: joined.slice(0, at),
    negative: joined.slice(at + HORDE_NEGATIVE_SEPARATOR.length),
  };
}

/**
 * compone el plan de AI Horde con la receta del personaje y la escena pedida.
 *
 * La identidad va PRIMERO: los primeros tokens pesan mas, y si la escena se
 * adelanta, el aspecto fijo se diluye y la cara deja de repetirse. Y ademas se
 * le quita a la escena el color de pelo y de ojos, porque ir primero no basta:
 * con «light brown hair» delante y «dark hair» detras salio una morena.
 *
 * Lo que se quito viaja en `dropped` en vez de perderse, que es la diferencia
 * entre un recorte que se puede discutir y uno que solo se sufre.
 */
export function composeHordeImagePlan(input: {
  recipe: HordeRecipe;
  scene: string;
  extraNegative: string;
}): HordeImagePlan {
  const { recipe } = input;
  const escena = stripConflictingTraitsDetailed(input.scene, recipe.appearance);
  const positive = [recipe.appearance, recipe.outfit, escena.text]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');
  const negative = mergeNegatives(recipe.negative, input.extraNegative);

  return sealPlan({
    provider: 'horde',
    positive,
    negative,
    joined: joinHordePrompt(positive, negative),
    params: {
      models: [...recipe.models],
      width: recipe.width,
      height: recipe.height,
      steps: recipe.steps,
      cfgScale: recipe.cfgScale,
      samplerName: recipe.samplerName,
      scheduler: recipe.scheduler,
      clipSkip: recipe.clipSkip,
      seed: recipe.seed,
      loras: recipe.loras.map((lora) => ({ ...lora })),
      hiresFix: recipe.hiresFix,
      postProcessing: [...recipe.postProcessing],
      denoisingStrength: recipe.denoisingStrength,
      shared: recipe.shared,
    },
    dropped: escena.dropped,
    scene: input.scene,
  });
}

/**
 * compone el plan del proveedor de pago, que es casi no componer nada.
 *
 * No hay receta que anteponer ni rasgos que recortar: alli la identidad la
 * guarda el servidor. Existe igual para que el panel, el registro de intentos y
 * el envio traten a los dos proveedores por el mismo sitio.
 */
export function composeXaviraImagePlan(input: {
  scene: string;
  extraNegative: string;
}): XaviraImagePlan {
  return sealPlan({
    provider: 'xavira',
    prompt: input.scene,
    negativeAppend: input.extraNegative,
    scene: input.scene,
  });
}

/**
 * la UNICA funcion que construye una peticion para AI Horde.
 *
 * Toma `plan.joined` tal cual: no vuelve a unir, no vuelve a recortar y no
 * vuelve a mirar la receta. Lo que se enseño es lo que sale.
 */
export function planToHordeRequest(
  plan: HordeImagePlan,
  options: { sourceImage?: string | null; dryRun?: boolean } = {},
): HordeImageRequest {
  const { params } = plan;
  return {
    prompt: plan.joined,
    models: [...params.models],
    width: params.width,
    height: params.height,
    steps: params.steps,
    cfgScale: params.cfgScale,
    samplerName: params.samplerName,
    scheduler: params.scheduler,
    clipSkip: params.clipSkip,
    seed: params.seed,
    loras: params.loras.map((lora) => ({ ...lora })),
    hiresFix: params.hiresFix,
    postProcessing: [...params.postProcessing],
    // no significa «genera porno»: le dice al horde que no mande el trabajo a
    // los workers que censuran, que son los que devuelven una imagen negra sin
    // avisar cuando el prompt les parece dudoso
    nsfw: true,
    shared: params.shared,
    sourceImage: options.sourceImage ?? null,
    // solo `img2img`: es el unico de los cuatro que sirve para lo que se usa
    // esto, y los otros tres exigen modelos que estos personajes no usan
    sourceProcessing: 'img2img',
    denoisingStrength: params.denoisingStrength,
    dryRun: options.dryRun,
  };
}

/**
 * arma la peticion final con la receta y la escena que escribe el modelo.
 *
 * Es el camino de antes, conservado con su firma exacta para que ningun
 * llamador cambie, pero YA NO COMPONE NADA: pasa por el plan y por
 * `planToHordeRequest` como todo lo demas. Ese es el punto del cambio —mientras
 * hubo dos funciones construyendo un `HordeImageRequest`, nada impedia que una
 * ganara un prefijo o un negativo que la otra no tuviera, y el fallo no lo
 * habria notado ninguna prueba.
 *
 * `shared` sigue llegando por argumento y no de `recipe.shared` porque asi era
 * antes; el unico llamador de produccion le pasa justo `recipe.shared`.
 */
export function buildHordeRequest(input: {
  recipe: HordeRecipe;
  prompt: string;
  extraNegative: string;
  shared: boolean;
  /**
   * imagen de partida en base64 PURO, sin prefijo `data:`.
   *
   * Cuando la hay, `denoisingStrength` de la receta pasa a mandar y el horde
   * cobra un 30 % mas de kudos. Sin ella, ninguno de los dos campos viaja.
   */
  sourceImage?: string | null;
  dryRun?: boolean;
}): HordeImageRequest {
  const plan = composeHordeImagePlan({
    recipe: input.recipe,
    scene: input.prompt,
    extraNegative: input.extraNegative,
  });
  const request = planToHordeRequest(plan, {
    sourceImage: input.sourceImage ?? null,
    dryRun: input.dryRun,
  });
  return { ...request, shared: input.shared };
}

/**
 * aplica sobre un plan el texto que la persona corrigio.
 *
 * NO vuelve a pasar por el recorte de rasgos ni por la receta: lo que se
 * escribio a mano se manda tal cual, aunque contradiga la apariencia fija. Esa
 * es la unica forma de que «quitale el recorte y pon esto» signifique algo, y
 * tambien el motivo de que el intento guarde `source`: dentro de un mes hay que
 * poder distinguir una generacion compuesta por el sistema de una reescrita.
 *
 * Devuelve `null` cuando la correccion es de OTRO proveedor. No lanza porque
 * este modulo no conoce los errores de la aplicacion; quien llama decide como
 * se cuenta.
 */
export function planFromEdit(
  base: VaultImagePlan,
  edited: VaultImagePlanEdit,
): { plan: VaultImagePlan; source: VaultImagePlanSource } | null {
  if (base.provider !== edited.provider) return null;

  if (base.provider === 'horde' && edited.provider === 'horde') {
    // la huella anterior se descarta a proposito: la que vale es la del texto
    // que de verdad va a salir, y se recalcula al sellar
    const { planId: _anterior, ...resto } = base;
    const plan = sealPlan({
      ...resto,
      positive: edited.positive,
      negative: edited.negative,
      joined: joinHordePrompt(edited.positive, edited.negative),
    });
    return { plan, source: sourceOf(base, plan) };
  }

  if (base.provider === 'xavira' && edited.provider === 'xavira') {
    const { planId: _anterior, ...resto } = base;
    const plan = sealPlan({ ...resto, prompt: edited.prompt });
    return { plan, source: sourceOf(base, plan) };
  }

  return null;
}

/**
 * un plan que vuelve del panel sin tocar no es «editado».
 *
 * Importa porque `source` es lo que despues explica una imagen que no se parece
 * al personaje, y si todo lo que pasa por el panel se marca a mano, deja de
 * distinguir nada.
 */
function sourceOf(base: VaultImagePlan, plan: VaultImagePlan): VaultImagePlanSource {
  return base.planId === plan.planId ? 'compuesto' : 'editado';
}

/** calcula la huella de un borrador y lo devuelve ya sellado */
function sealPlan<T extends VaultImagePlanDraft>(draft: T): T & { planId: string } {
  return { ...draft, planId: computePlanId(draft) };
}

/**
 * la huella de lo que de verdad se va a enviar.
 *
 * Mide SOLO el texto y los parametros, nunca `scene`, `dropped` ni una huella
 * anterior: dos planes que manden exactamente lo mismo tienen que coincidir
 * aunque uno venga compuesto y el otro corregido a mano.
 *
 * Es FNV-1a de 64 bits escrito aqui, y no un hash criptografico, por dos
 * motivos: `packages/shared` no puede importar `node:crypto`, y `crypto.subtle`
 * es asincrono, lo que convertiria en `async` a todo el que quiera comparar dos
 * planes. Esto no firma nada —no protege de nadie que quiera colar un plan—:
 * compara. Por eso quien recibe un plan de fuera lo revalida entero y recalcula
 * la huella en vez de creerse la que venga escrita.
 */
export function computePlanId(plan: VaultImagePlanDraft): string {
  const material =
    plan.provider === 'horde'
      ? {
          provider: plan.provider,
          positive: plan.positive,
          negative: plan.negative,
          params: plan.params,
        }
      : {
          provider: plan.provider,
          prompt: plan.prompt,
          negativeAppend: plan.negativeAppend,
        };
  return fnv1a64(canonicalize(material));
}

/**
 * serializa con las claves ORDENADAS.
 *
 * `JSON.stringify` conserva el orden de insercion, asi que el mismo plan
 * construido en otro orden daria otra huella y dos textos identicos pareceria
 * que no lo son.
 */
function canonicalize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * FNV-1a de 64 bits sobre las unidades UTF-16 de la cadena.
 *
 * Se recorren los dos bytes de cada unidad por separado para que dos textos que
 * solo se diferencian en un acento no acaben en la misma huella. No se usa
 * `TextEncoder` a proposito: existe en los dos entornos, pero la huella no
 * necesita ser la de los bytes UTF-8 de nadie —solo estable— y asi este modulo
 * no depende de ningun global.
 */
function fnv1a64(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    for (const byte of [unit >> 8, unit & 0xff]) {
      hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

/** en que acabo un intento de imagen */
export const VAULT_IMAGE_ATTEMPT_STATES = [
  /** compuesto y esperando a que una persona lo apruebe */
  'pending',
  /** ya mandado al proveedor; todavia sin respuesta */
  'sent',
  'ok',
  'failed',
  /** la persona dijo que no: no se genero y no se cobro */
  'discarded',
  /** llego un mensaje nuevo y la peticion anterior dejo de valer */
  'superseded',
  /** ella pidio una imagen pero el bloque llego cortado o mal escrito */
  'malformed',
] as const;
export type VaultImageAttemptState = (typeof VAULT_IMAGE_ATTEMPT_STATES)[number];

/** por que el bloque de imagen no se pudo leer. Son los dos estados que hoy nadie mira */
export const VAULT_IMAGE_MALFORMED_REASONS = ['truncated_block', 'invalid'] as const;
export type VaultImageMalformedReason = (typeof VAULT_IMAGE_MALFORMED_REASONS)[number];

/** un aviso del proveedor, tal y como lo devuelve el envio */
export const imageAttemptWarningSchema = z.object({
  code: z.string().max(120),
  message: z.string().max(600),
});
export type ImageAttemptWarning = z.infer<typeof imageAttemptWarningSchema>;

/**
 * un intento de imagen, con todo lo que hoy se tira por el camino.
 *
 * Vive en este paquete —y no en el escritorio— porque lo escriben el proceso
 * principal y lo leen la pantalla y sus pruebas, y una forma escrita dos veces
 * se separa a la segunda semana.
 *
 * QUE NO ES: el historial de la conversacion. Esto se guarda en un archivo
 * aparte, no entra en ningun prompt, no se le enseña al modelo y no aparece en
 * el hilo. Por eso puede llevar el `rc` del servidor y el mensaje de error sin
 * contradecir la razon por la que `ultimaImagenFallida` vive en memoria.
 */
export const imageAttemptSchema = z.object({
  attemptId: z.string().uuid(),
  conversationId: z.string().min(1).max(128),
  /**
   * nullable porque un intento `malformed` puede nacer en una conversacion sin
   * personaje: el bloque se corto antes de que nada eligiera quien lo pedia.
   */
  characterId: z.string().max(128).nullable().default(null),
  createdAt: z.string().datetime(),
  state: z.enum(VAULT_IMAGE_ATTEMPT_STATES),
  source: z.enum(VAULT_IMAGE_PLAN_SOURCES).default('compuesto'),
  /**
   * foto o video, tal y como lo pidio el modelo.
   *
   * Se guarda porque el intento es lo UNICO que sobrevive entre componer el
   * plan y aprobarlo: sin el campo, la decision tenia que suponer 'image' y un
   * video pedido se generaba como foto fija, cobrando lo mismo por otra cosa.
   * Con `.default('image')` un intento escrito antes de este campo sigue
   * leyendose, y describe lo que de verdad era: el camino de video no existia.
   */
  kind: z.enum(['image', 'video']).default('image'),
  /** el texto exacto que se iba a mandar. `null` solo cuando no llego a componerse */
  plan: vaultImagePlanSchema.nullable().default(null),
  planId: z.string().max(64),
  /** el medio que salio de aqui, cuando salio alguno */
  mediaId: z.string().max(128).nullable().default(null),
  /**
   * la semilla REAL que uso el servidor.
   *
   * Con `params.seed` a null la sortea el, asi que esta es la unica forma de
   * repetir una imagen que salio bien.
   */
  seed: z.string().max(64).nullable().default(null),
  model: z.string().max(128).nullable().default(null),
  worker: z.string().max(160).nullable().default(null),
  kudos: z.number().nullable().default(null),
  /**
   * si el servidor COMPARTIO la imagen, no si se pidio compartirla.
   *
   * Lo que se PIDIO ya esta guardado, y no se toca: vive en
   * `plan.params.shared`. Esto es la otra mitad, la que faltaba: lo que el
   * proveedor contesta en el estado del trabajo, que puede no coincidir con lo
   * pedido porque la decision es suya. Con los dos al lado, cada imagen dice
   * que se pidio y que paso, en vez de dejarlo a la suposicion.
   *
   * `null` es «no se sabe» —el proveedor no lo dijo, o el intento no llego a
   * terminar—, y no se lee como un no.
   */
  sharedByServer: z.boolean().nullable().default(null),
  /**
   * el codigo del rechazo, tal cual lo devuelve el servidor.
   *
   * Es la diferencia entre 'csam' y 'censored', que hoy se aplana al convertir
   * el error del proveedor en uno de la boveda y deja al usuario sin saber cual
   * de las dos cosas le paso.
   */
  rc: z.string().max(64).nullable().default(null),
  errorMessage: z.string().max(1000).nullable().default(null),
  warnings: z.array(imageAttemptWarningSchema).max(20).default([]),
  malformedReason: z.enum(VAULT_IMAGE_MALFORMED_REASONS).nullable().default(null),
});
export type ImageAttempt = z.infer<typeof imageAttemptSchema>;
