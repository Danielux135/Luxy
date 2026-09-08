// como se genera una imagen del mismo personaje sin que el proveedor lo guarde.
//
// El problema que resuelve: Luxy solo sabia generar con un proveedor de pago que
// guarda el PERSONAJE en su servidor y devuelve un identificador. Mandas el id y
// la cara vuelve igual. AI Horde es gratis, pero no tiene personajes: cada
// peticion nace de cero, asi que el mismo personaje sale con otra cara en cada
// imagen y la conversacion deja de sostenerse.
//
// La solucion es mover la identidad aqui: una RECETA local —modelos, aspecto
// fijo, seed, muestreador— que se repite igual en cada generacion. Lo que en el
// proveedor de pago era un identificador remoto, aqui es texto que viaja entero
// en cada peticion.
//
// Modulo PURO: compone una peticion y la devuelve. No genera, no consulta el
// horde y no toca reloj ni red. Asi cada caso limite se prueba sin gastar nada.
import { z } from 'zod';

import type { VaultImagePromptStyle } from './vault-image-request.js';

/** proveedores de imagen que la boveda sabe usar */
export const VAULT_IMAGE_PROVIDERS = ['xavira', 'horde'] as const;
export type VaultImageProvider = (typeof VAULT_IMAGE_PROVIDERS)[number];

/** un LoRA de CivitAI pedido a AI Horde */
export interface HordeLora {
  name: string;
  isVersion: boolean;
  model: number;
  clip: number;
  injectTrigger?: string;
}

/** peticion de imagen a AI Horde, ya resuelta: el adaptador solo la transporta */
export interface HordeImageRequest {
  /** prompt positivo y negativo YA unidos con ' ### ' */
  prompt: string;
  /** nombres exactos de modelo, tal y como los publica /v2/status/models */
  models: string[];
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  samplerName: string;
  scheduler: string;
  clipSkip: number;
  seed: string | null;
  loras: HordeLora[];
  hiresFix: boolean;
  postProcessing: string[];
  /** true = se salta los workers que censuran. Para la boveda va SIEMPRE true */
  nsfw: boolean;
  /**
   * true regala la imagen a LAION. La boveda manda SIEMPRE false; el horde
   * lo fuerza a true con la clave anonima, y eso hay que decirlo, no ocultarlo.
   */
  shared: boolean;
  /**
   * imagen de partida en base64 PURO, sin el prefijo `data:`.
   *
   * Va en la RAIZ del cuerpo, no dentro de `params`. `null` es lo normal: la
   * mayoria de generaciones parten de cero.
   *
   * Lo que esto NO es: una imagen de referencia que transfiera la identidad del
   * personaje a una escena nueva. AI Horde no tiene nada de eso —ni IP-Adapter,
   * ni FaceID, ni un modelo de edicion por instruccion—, y esperarlo de aqui
   * lleva a la decepcion. Esto sirve para VARIAR una imagen que ya salio bien.
   */
  sourceImage: string | null;
  /**
   * que hacer con esa imagen. Enum cerrado de la API.
   *
   * Solo se usa `img2img`: `inpainting` y `outpainting` exigen un modelo de
   * inpainting, y ninguno de los modelos anime SDXL lo es; `remix` es de Stable
   * Cascade, lo sirven dos workers y no conserva la cara.
   */
  sourceProcessing: 'img2img' | 'inpainting' | 'outpainting' | 'remix';
  /**
   * cuanto se aleja el resultado de la imagen de partida. Va DENTRO de `params`.
   *
   * Es el unico mando que importa aqui, y no tiene punto dulce: por debajo de
   * 0,3 devuelve casi la misma imagen y por encima de 0,6 se pierde la cara.
   */
  denoisingStrength: number;
  /** true solo para preguntar el coste en kudos sin generar nada */
  dryRun?: boolean;
}

const MAX_MODELS = 4;
const MAX_LORAS = 5;
const MIN_SIDE = 512;
const MAX_SIDE = 1536;
/** el horde solo acepta lados multiplos de 64: cualquier otro se rechaza entero */
const SIDE_STEP = 64;

const hordeLoraSchema = z.object({
  name: z.string().min(1).max(255),
  /** false = id del LoRA; true = id de UNA version concreta, que es la que fija el estilo */
  isVersion: z.boolean().default(false),
  model: z.number().min(-5).max(5).default(1),
  clip: z.number().min(-5).max(5).default(1),
  injectTrigger: z.string().max(30).optional(),
});

/**
 * cfgScale con mas de dos decimales lo rechaza la API con `BadCFGDecimals`, y
 * ese error llega despues de encolar. Se corta aqui, donde todavia se puede
 * explicar.
 */
const cfgScaleSchema = z
  .number()
  .min(0)
  .max(30)
  .refine((value) => Number(value.toFixed(2)) === value, {
    message: 'cfgScale admite como mucho dos decimales',
  });

/**
 * la identidad visual de un personaje, entera y en local.
 *
 * Todo lo que aqui se fija es lo que hace que dos imagenes distintas parezcan la
 * misma persona. Si un campo cambia entre generaciones, la cara cambia con el.
 */
export const hordeRecipeSchema = z
  .object({
    /**
     * varios modelos a la vez no cuesta kudos extra: el horde suma los workers
     * de todos y reparte, asi que la peticion no se queda esperando a que se
     * libere el modelo estrella.
     */
    models: z.array(z.string().min(1).max(120)).min(1).max(MAX_MODELS),
    /**
     * la identidad visual FIJA, en INGLES: pelo, ojos, complexion, rasgos.
     * Es lo unico que se repite palabra por palabra en cada imagen.
     */
    appearance: z.string().max(1200),
    /** la ropa habitual va aparte porque cambia mucho mas a menudo que la cara */
    outfit: z.string().max(400).default(''),
    negative: z.string().max(1000).default(''),
    /** con la misma seed y el mismo prompt, la cara se repite mucho mejor */
    seed: z.string().max(64).nullable().default(null),
    width: z.number().int().min(MIN_SIDE).max(MAX_SIDE).default(1024),
    height: z.number().int().min(MIN_SIDE).max(MAX_SIDE).default(1024),
    steps: z.number().int().min(1).max(60).default(30),
    cfgScale: cfgScaleSchema.default(7),
    samplerName: z.string().min(1).max(60).default('k_euler_a'),
    scheduler: z.string().min(1).max(60).default('karras'),
    /**
     * Pony, Illustrious y NoobAI se entrenaron con clipSkip 2 y rinden
     * notablemente peor con 1: caras planas y anatomia peor resuelta.
     */
    clipSkip: z.number().int().min(1).max(12).default(2),
    loras: z.array(hordeLoraSchema).max(MAX_LORAS).default([]),
    hiresFix: z.boolean().default(false),
    postProcessing: z.array(z.string().min(1).max(60)).max(2).default([]),
    promptStyle: z.enum(['tags', 'prose']).default('tags'),
    /**
     * cuanto se aleja de la imagen de partida cuando la haya.
     *
     * Vive en la receta y no en cada peticion porque es una preferencia del
     * personaje: cuanto se le permite cambiar. La IMAGEN no vive aqui —la
     * receta se guarda cifrada y con cada edicion crece— y viaja aparte.
     */
    denoisingStrength: z.number().min(0.01).max(1).default(0.45),
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
export type HordeRecipe = z.infer<typeof hordeRecipeSchema>;

/**
 * modelos de anime verificados contra /v2/status/models el 2026-09-04.
 *
 * Los nombres van EXACTOS, byte a byte: el horde no busca por parecido, asi que
 * un solo caracter distinto —o un espacio de mas— deja la peticion en cola para
 * siempre, sin error y sin imagen.
 *
 * `workers` es una FOTO de ese dia y sirve solo para ordenar la lista en
 * pantalla; el numero real se consulta en vivo y cambia cada pocas horas.
 */
export const HORDE_ANIME_MODELS = [
  { name: 'WAI-NSFW-illustrious-SDXL', workers: 10, baseline: 'sdxl' },
  { name: 'WAI-ANI-NSFW-PONYXL', workers: 6, baseline: 'sdxl' },
  { name: 'Prefect Pony', workers: 6, baseline: 'sdxl' },
  { name: 'WAI-CUTE Pony', workers: 6, baseline: 'sdxl' },
  { name: 'AMPonyXL', workers: 6, baseline: 'sdxl' },
  { name: 'NTR MIX IL-Noob XL', workers: 5, baseline: 'sdxl' },
  { name: 'Pony Diffusion XL', workers: 5, baseline: 'sdxl' },
  { name: 'Hassaku XL', workers: 4, baseline: 'sdxl' },
  { name: 'Nova Anime XL', workers: 4, baseline: 'sdxl' },
  { name: 'Grapefruit Hentai', workers: 5, baseline: 'sd1' },
  { name: 'AbyssOrangeMix-AfterDark', workers: 5, baseline: 'sd1' },
  { name: 'Hentai Diffusion', workers: 5, baseline: 'sd1' },
] as const;

/**
 * modelos realistas verificados el mismo dia y con las mismas reglas.
 *
 * La trampa mas facil de todas esta aqui: 'AlbedoBase XL (SDXL)' NO es el mismo
 * modelo que 'AlbedoBase XL 3.1'. Se parecen en el nombre y no en lo que hacen,
 * porque el primero NO admite NSFW y devuelve otra cosa sin explicar por que.
 */
export const HORDE_REALISTIC_MODELS = [
  { name: 'AlbedoBase XL 3.1', workers: 8, baseline: 'sdxl' },
  { name: 'Juggernaut XL', workers: 6, baseline: 'sdxl' },
  { name: 'CyberRealistic Pony', workers: 6, baseline: 'sdxl' },
  { name: 'Pony Realism', workers: 6, baseline: 'sdxl' },
  { name: 'SwamPonyXL', workers: 5, baseline: 'sdxl' },
  { name: 'BigASP', workers: 4, baseline: 'sdxl' },
  { name: 'PerfectDeliberate', workers: 4, baseline: 'sdxl' },
  { name: 'Realistic Vision', workers: 5, baseline: 'sd1' },
  { name: 'Edge Of Realism', workers: 5, baseline: 'sd1' },
  { name: 'Analog Madness', workers: 5, baseline: 'sd1' },
  { name: 'Deliberate', workers: 6, baseline: 'sd1' },
  { name: 'URPM', workers: 4, baseline: 'sd1' },
] as const;

/** la familia del modelo, que es lo que decide tamaño y clipSkip */
export type HordeBaseline = 'sdxl' | 'sd1';

/**
 * valores de partida segun la familia del modelo.
 *
 * No es una preferencia estetica: SD1 se entreno a 512, y pedirle 1024 produce
 * cuerpos deformes y personajes duplicados. Ademas cuesta mas kudos, que se
 * cobran por pixel. SDXL al reves: a 512 pierde detalle.
 */
export function recipeDefaultsFor(
  baseline: HordeBaseline,
): Pick<HordeRecipe, 'width' | 'height' | 'steps' | 'cfgScale' | 'clipSkip'> {
  if (baseline === 'sd1') {
    // retrato, que es el encuadre util para un personaje
    return { width: 512, height: 768, steps: 30, cfgScale: 7, clipSkip: 1 };
  }
  return { width: 1024, height: 1024, steps: 30, cfgScale: 7, clipSkip: 2 };
}

/**
 * arma la peticion final con la receta y la escena que escribe el modelo.
 *
 * Es PURA y no valida nada de red: lo que devuelve es exactamente lo que el
 * adaptador tiene que transportar.
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
  const { recipe } = input;
  // la identidad va PRIMERO: los primeros tokens pesan mas, y si la escena se
  // adelanta, el aspecto fijo se diluye y la cara deja de repetirse.
  //
  // Y ademas se le quita a la escena el color de pelo y de ojos, porque ir
  // primero NO basta: comprobado con un prompt real, «light brown hair» delante
  // y «dark hair» detras produjo una morena. Pedirselo al modelo tampoco basta;
  // se le pidio y lo siguio haciendo.
  const escena = stripConflictingTraits(input.prompt, recipe.appearance);
  const positive = [recipe.appearance, recipe.outfit, escena]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');

  const negative = mergeNegatives(recipe.negative, input.extraNegative);
  // AI Horde NO tiene campo de negativo: lo lee del propio prompt, detras de
  // ' ### '. Sin negativo no se pone el separador, porque un ' ### ' vacio al
  // final se interpreta como un negativo literal
  const prompt = negative.length === 0 ? positive : `${positive} ### ${negative}`;

  return {
    prompt,
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
    // no significa «genera porno»: le dice al horde que no mande el trabajo a
    // los workers que censuran, que son los que devuelven una imagen negra sin
    // avisar cuando el prompt les parece dudoso
    nsfw: true,
    shared: input.shared,
    sourceImage: input.sourceImage ?? null,
    // solo `img2img`: es el unico de los cuatro que sirve para lo que se usa
    // esto, y los otros tres exigen modelos que estos personajes no usan
    sourceProcessing: 'img2img',
    denoisingStrength: recipe.denoisingStrength,
    dryRun: input.dryRun,
  };
}

/** une los dos negativos sin repetir: repetir un termino no lo refuerza, solo gasta tokens */
function mergeNegatives(recipeNegative: string, extraNegative: string): string {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const source of [recipeNegative, extraNegative]) {
    for (const raw of source.split(',')) {
      const term = raw.trim();
      if (term.length === 0) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
  }
  return terms.join(', ');
}

/**
 * describe al personaje en texto, para el MODELO DE TEXTO.
 *
 * La receta le sirve al generador de imagenes, no a quien escribe: el modelo no
 * ve ninguna imagen, asi que sin esto no sabe a quien encarna y responde como un
 * asistente generico. El nombre va primero porque es lo primero que se le
 * olvida, y en cuanto se lo inventa la conversacion siguiente ya no cuadra.
 */
export function describeHordeCharacter(label: string, recipe: HordeRecipe): string {
  const name = label.trim();
  const partes: string[] = [];
  if (name.length > 0) partes.push(`Te llamas ${name}.`);
  const appearance = recipe.appearance.trim();
  if (appearance.length > 0) partes.push(`Tu aspecto: ${appearance}.`);
  const outfit = recipe.outfit.trim();
  if (outfit.length > 0) partes.push(`Sueles vestir: ${outfit}.`);
  return partes.join(' ');
}

/**
 * como hay que escribirle el prompt al generador que toque.
 *
 * La regla estaba suelta en el proceso principal como una comparacion con un
 * identificador de modelo concreto, y cada proveedor nuevo la duplicaba un poco
 * peor. Aqui hay un solo sitio donde mirarla.
 */
export function imagePromptStyleFor(
  provider: VaultImageProvider,
  options: { xaviraModelId?: string | null; recipe?: HordeRecipe | null },
): VaultImagePromptStyle {
  if (provider === 'horde') {
    // en el horde lo decide el modelo elegido, y eso ya esta guardado en la receta
    return options.recipe?.promptStyle ?? 'tags';
  }
  // el unico modelo de anime del proveedor de pago; el resto son realistas
  return options.xaviraModelId === 'anime-pure-v1' ? 'tags' : 'prose';
}

/** la familia de un modelo conocido, por nombre EXACTO. `null` si no esta en las listas */
export function baselineOf(model: string): HordeBaseline | null {
  for (const entry of [...HORDE_ANIME_MODELS, ...HORDE_REALISTIC_MODELS]) {
    if (entry.name === model) return entry.baseline;
  }
  return null;
}

/**
 * aviso cuando los modelos elegidos NO son de la misma familia.
 *
 * PASO DE VERDAD, y produjo una imagen que no se parecia en nada al personaje.
 * Daniel marco cuatro modelos —dos SDXL y dos SD1— porque la propia pantalla
 * anima a marcar varios: «suma sus workers y acorta la espera». Lo que no decia
 * es que la receta tiene UN tamaño y UN clipSkip, y que esos valores solo
 * pueden estar bien para una familia.
 *
 * Marcar varios sigue siendo buena idea: es gratis y acorta la cola. Pero
 * dentro de la misma familia. Repartir el trabajo entre un SDXL y un SD1
 * significa que la mitad de las veces se le pide a un modelo entrenado a 512
 * que dibuje a 1024, y eso devuelve cuerpos deformes, personajes duplicados y
 * un aspecto que no es el del personaje.
 *
 * Es un AVISO y no un bloqueo: quien sepa lo que hace puede querer mezclar, y
 * la lista de modelos del horde cambia sin avisarnos.
 */
export function mixedBaselineWarning(models: readonly string[]): string | null {
  const familias = new Set<HordeBaseline>();
  for (const model of models) {
    const baseline = baselineOf(model);
    if (baseline !== null) familias.add(baseline);
  }
  if (familias.size < 2) return null;
  return 'Has marcado modelos SDXL y SD1 a la vez, y la receta solo tiene un tamaño y un clipSkip: no pueden estar bien para los dos. Cuando al horde le toque un SD1 con medidas de SDXL, devolvera cuerpos deformes y una cara que no es la suya. Marca varios de la MISMA familia: suma sus workers igual.';
}

/**
 * colores de pelo y de ojos que un modelo escribe sin pensarlo.
 *
 * Lista cerrada y en ingles: el prompt del generador SIEMPRE va en ingles, y
 * una lista corta que se queda corta es mejor que una expresion que se coma
 * media escena.
 */
const TRAIT_COLORS = [
  'black',
  'dark',
  'darker',
  'blonde',
  'blond',
  'brown',
  'light brown',
  'dark brown',
  'auburn',
  'ginger',
  'red',
  'redhead',
  'orange',
  'silver',
  'white',
  'grey',
  'gray',
  'pink',
  'blue',
  'green',
  'purple',
  'violet',
  'golden',
  'amber',
  'hazel',
  'crimson',
];

/**
 * origenes que en estos modelos arrastran un aspecto entero.
 *
 * No es una lista de nacionalidades: es una lista de etiquetas que en un modelo
 * de anime cambian pelo, ojos y rasgos de golpe. «japanese» es la que se vio
 * ganandole a `light brown hair, blue eyes` con el color ya limpiado.
 */
const TRAIT_ORIGINS = [
  'japanese',
  'chinese',
  'korean',
  'asian',
  'african',
  'indian',
  'latina',
  'hispanic',
  'nordic',
  'scandinavian',
  'russian',
  'caucasian',
  'european',
];

/**
 * quita de la ESCENA el color de pelo y de ojos cuando la receta ya lo dice.
 *
 * POR QUE EN CODIGO Y NO EN EL PROMPT, que es lo que se intento primero: se le
 * pidio al modelo que no describiera los rasgos fijos, rasgo por rasgo y
 * explicando el motivo, y lo siguió haciendo. Comprobado con el prompt guardado
 * de una generacion POSTERIOR al arreglo: la receta decia «light brown hair,
 * blue eyes» y la escena «dark hair wild across pillow». Salio morena.
 *
 * Los dos textos van al mismo prompt y compiten; gana cualquiera. Como la
 * identidad es de la receta por definicion, el desempate no es una opinion y no
 * hace falta que lo acierte un modelo.
 *
 * SE QUITA SOLO EL COLOR, no la frase: «dark hair wild across pillow» pasa a
 * «hair wild across pillow». El pelo revuelto sobre la almohada es la escena y
 * es suyo; de que color es, no.
 *
 * Y solo cuando la receta habla de eso: si el aspecto fijo no dice nada del
 * pelo, lo que diga la escena es la unica fuente que hay y se respeta.
 */
export function stripConflictingTraits(scene: string, appearance: string): string {
  const fijo = appearance.toLowerCase();
  const partes = TRAIT_COLORS.map((color) => color.replace(/ /g, '\\s+')).join('|');
  let salida = scene;
  for (const rasgo of ['hair', 'eyes'] as const) {
    if (!fijo.includes(rasgo)) continue;
    // el color puede venir con varias palabras («light brown hair») y a veces
    // encadenado («long dark messy hair»): se repite el grupo hasta el rasgo
    const patron = new RegExp(`\\b(?:(?:${partes})\\s+)+(?=\\w*\\s*${rasgo}\\b)`, 'gi');
    salida = salida.replace(patron, '');
  }

  // la NACIONALIDAD es el otro camino por el que la escena redefine la cara, y
  // no lo cierra quitar colores: quitado «dark hair», el modelo seguia
  // escribiendo «petite japanese woman 18» y el generador dibujaba una morena
  // de ojos ambar igual, porque en estos modelos «japanese» arrastra un aspecto
  // entero.
  //
  // Solo cuando califica a una PERSONA: «japanese lantern» y «japanese garden»
  // son escenario y se quedan. Y solo si la receta no lo dice ya: si el aspecto
  // fijo la declara, la escena no la esta inventando.
  for (const origen of TRAIT_ORIGINS) {
    if (fijo.includes(origen)) continue;
    const patron = new RegExp(
      `\\b${origen}\\s+(?=(?:\\w+\\s+){0,2}?(?:woman|women|girl|lady|man|men|boy|female|male)\\b)`,
      'gi',
    );
    salida = salida.replace(patron, '');
  }
  // la limpieza puede dejar comas huerfanas o dobles espacios
  return salida
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*/, '')
    .trim();
}
