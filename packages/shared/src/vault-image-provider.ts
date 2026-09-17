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
    /**
     * dona lo generado al conjunto de datos publico de AI Horde, a cambio de
     * kudos.
     *
     * Es de LA RECETA y no de la maquina a proposito: se comparte a un
     * personaje concreto, no todo lo que uno genere. Un personaje puede ser
     * inventado y anodino y otro no.
     *
     * `false` por defecto y siempre: donar contenido de la boveda no puede ser
     * la opcion que viene puesta. Con la clave anonima el servidor lo fuerza a
     * `true` y este campo no lo evita (`D-065`); con una clave propia, que es
     * gratis, manda esto.
     */
    shared: z.boolean().default(false),
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

// `buildHordeRequest` VIVIA AQUI y ahora esta en `vault-image-plan.ts`, donde
// compone el plan y lo transporta con `planToHordeRequest`.
//
// No se quedo aqui porque este archivo tendria que importar de `vault-image-plan.ts`
// —que ya importa de este para recortar rasgos y fundir negativos— y eso es un
// ciclo en tiempo de ejecucion entre dos modulos del mismo paquete. Se sostiene
// mientras nadie llame a nada durante la evaluacion del modulo, y esa es
// exactamente la clase de garantia que se rompe sin que ninguna prueba lo note.
// Quien lo importe desde `@luxy/shared` no ve la diferencia.

/**
 * une los dos negativos sin repetir: repetir un termino no lo refuerza, solo gasta tokens.
 *
 * Se exporta porque el plan de imagen (`vault-image-plan.ts`) compone el mismo
 * texto que acaba saliendo por el transporte, y duplicar esta fusion seria
 * garantizar que un dia los dos caminos digan cosas distintas.
 */
export function mergeNegatives(recipeNegative: string, extraNegative: string): string {
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
 * las palabras que convierten un origen en una PERSONA y no en un escenario.
 *
 * Vive en una constante y no dentro del patron porque el recorte tiene que
 * poder DECIR a quien calificaba lo que quito: «japanese woman», no «japanese».
 */
const TRAIT_PERSON_WORDS = 'woman|women|girl|lady|man|men|boy|female|male';

/**
 * la COMPLEXION, tercer camino por el que la escena redefine el cuerpo.
 *
 * Visto en prompts reales: la receta fijaba «slim body, slender, small frame» y
 * la escena colaba «small body». Dos tallas en el mismo prompt, y cual gana no
 * lo decide nadie.
 *
 * Lista cerrada y en ingles, por el mismo motivo que la de colores: el prompt
 * del generador siempre va en ingles, y una expresion abierta se comeria media
 * escena.
 */
const TRAIT_BUILD_WORDS = [
  'slim',
  'slender',
  'skinny',
  'thin',
  'lean',
  'petite',
  'small',
  'tiny',
  'little',
  'athletic',
  'toned',
  'fit',
  'muscular',
  'curvy',
  'curvaceous',
  'voluptuous',
  'thick',
  'chubby',
  'plump',
  'stocky',
  'heavy',
  'big',
  'large',
  'huge',
  'delicate',
  'frail',
  'wiry',
];

/**
 * los sustantivos que nombran el cuerpo ENTERO, y solo esos.
 *
 * Aqui esta el cuidado que hay que tener con este recorte: «small breasts» o
 * «wide hips» NO se tocan aunque la receta diga «slim body», porque el aspecto
 * fijo habla de la complexion general y no de esa parte. Quitarlo seria borrar
 * escena de verdad, que es justo lo que este modulo no puede hacer.
 */
const TRAIT_BUILD_NOUNS = ['body', 'frame', 'figure', 'build', 'physique', 'torso', 'silhouette'];

/**
 * el RUBOR, cuarto camino: la receta decia «blush, pink cheeks» y la escena
 * repetia «blushing» por su cuenta.
 *
 * Aqui los calificativos incluyen colores —«red face», «pink cheeks»— porque el
 * rubor es un color puesto sobre la cara. Por eso mismo NUNCA se quitan solos:
 * hace falta que califiquen a una de las partes de `TRAIT_BLUSH_TARGETS`, igual
 * que un origen necesita una persona detras. «blush pink lingerie» y «rosy dawn
 * light» son escena y se quedan.
 */
const TRAIT_BLUSH_WORDS = [
  'blushing',
  'blushed',
  'blush',
  'flushed',
  'flushing',
  'rosy',
  'reddened',
  'red',
  'pink',
  'crimson',
  'ruddy',
  'scarlet',
];

/** lo que el rubor colorea; sin una de estas palabras, «blush» puede ser un color de ropa */
const TRAIT_BLUSH_TARGETS = 'cheeks|cheek|face|skin|complexion|nose|ears';

/**
 * y de esas, las unicas que un COLOR a secas ya solo puede estar ruborizando.
 *
 * La piel, la cara y la nariz tambien son superficie de iluminacion y de clima:
 * «soft red light on skin» es la luz que pidio el usuario y «red nose from the
 * cold» es el invierno, y con un color delante no se distinguen del rubor. Sobre
 * ellas se exige una palabra de `TRAIT_BLUSH_PLAIN`, que ya no tiene otra
 * lectura; «flushed skin» se sigue quitando. Las mejillas se quedan aqui porque
 * un color sobre ellas es rubor y no hay segunda lectura.
 *
 * El daño era peor en el estilo `tags` —«red light on skin, bedroom»—, que es
 * justo el que el bloque obliga a escribir, sin posesivos que separen.
 */
const TRAIT_BLUSH_COLORABLE = 'cheeks|cheek';

/**
 * las formas que no pueden calificar a un objeto: solo se ruboriza alguien.
 *
 * Son las unicas que se quitan SUELTAS, sin exigir una parte de la cara detras,
 * porque el caso observado —«blushing» a secas, entre comas— no la trae.
 */
const TRAIT_BLUSH_VERBS = ['blushing', 'blushes'];

/**
 * lo que ya solo puede significar rubor, sea en la receta o en la escena.
 *
 * Es mas estrecha que `TRAIT_BLUSH_WORDS` porque una receta dice «red hair» sin
 * hablar de rubor, y eso no puede abrir la puerta. Por el mismo motivo es la
 * lista que se exige sobre la piel, la cara y la nariz, donde un color puede ser
 * la luz o el frio.
 */
const TRAIT_BLUSH_PLAIN = [
  'blush',
  'blushing',
  'blushes',
  'blushed',
  'flushed',
  'flushing',
  'rosy',
  'reddened',
];

/**
 * los sustantivos que, solos y sin nada que los califique, ya no dicen nada.
 *
 * En la complexion y en el rubor el rasgo suele ser el elemento ENTERO, asi que
 * el recorte deja un huerfano: «flushed cheeks, breathing hard» se quedaba en
 * «cheeks, breathing hard» y «toned figure, standing» en «figure, standing».
 * Acumulado es peor —«pink cheeks, flushed skin, blushing, on bed» dejaba dos
 * etiquetas muertas de tres— y cada una gasta uno de los OCHO huecos que el
 * bloque de instrucciones presupuesta para la escena.
 *
 * Se sacan del texto, no de `dropped`: lo quitado se sigue pudiendo devolver.
 */
const TRAIT_BARE_NOUNS = new Set<string>([
  'hair',
  'eyes',
  ...TRAIT_BUILD_NOUNS,
  // se parte la misma alternancia para no mantener la lista en dos sitios
  ...TRAIT_BLUSH_TARGETS.split('|'),
]);

/** un termino de varias palabras se escribe con espacio y se compara con espacios flexibles */
function traitAlternation(words: readonly string[]): string {
  return words.map((word) => word.replace(/ /g, '\\s+')).join('|');
}

/**
 * los calificativos encadenados —«long dark messy hair», «small toned body»—
 * hasta el rasgo que describen, que queda FUERA del patron: se quita el
 * calificativo y la frase de la escena se conserva entera.
 *
 * `gap` dice si entre el calificativo y el rasgo cabe otra palabra. En el pelo
 * y los ojos cabe —«dark messy hair»—, porque nada de un dormitorio se llama
 * asi. En la COMPLEXION no: sus sustantivos tambien son muebles, y con hueco
 * «huge bed frame» perdia el «huge», «small window frame» el «small» y «large
 * picture frame» el «large». Son muebles de dormitorio, o sea el decorado exacto
 * de estas escenas.
 */
function qualifierPattern(
  words: readonly string[],
  noun: string,
  flags: string,
  gap: boolean,
): RegExp {
  const hueco = gap ? '\\w*\\s*' : '';
  return new RegExp(`\\b(?:(?:${traitAlternation(words)})\\s+)+(?=${hueco}${noun}\\b)`, flags);
}

/**
 * un calificativo de rubor, y solo si a dos palabras vista hay algo que ruborizar.
 *
 * Son dos puertas y no una, porque no todo lo que el rubor colorea sirve para
 * reconocerlo: un COLOR a secas solo vale sobre las mejillas, y sobre lo demas
 * hace falta una palabra que ya solo signifique rubor.
 */
function blushPattern(flags: string): RegExp {
  const cerca = '(?:\\w+\\s+){0,2}?';
  const color = `(?:${traitAlternation(TRAIT_BLUSH_WORDS)})\\s+(?=${cerca}(?:${TRAIT_BLUSH_COLORABLE})\\b)`;
  const propio = `(?:${traitAlternation(TRAIT_BLUSH_PLAIN)})\\s+(?=${cerca}(?:${TRAIT_BLUSH_TARGETS})\\b)`;
  return new RegExp(`\\b(?:${color}|${propio})`, flags);
}

/** true cuando el aspecto fijo YA fija la complexion; si no, la escena es la unica fuente */
function describesBuild(appearance: string): boolean {
  return TRAIT_BUILD_NOUNS.some((noun) =>
    qualifierPattern(TRAIT_BUILD_WORDS, noun, 'i', false).test(appearance),
  );
}

/** true cuando el aspecto fijo YA fija el rubor, por palabra propia o por «pink cheeks» */
function describesBlush(appearance: string): boolean {
  if (new RegExp(`\\b(?:${TRAIT_BLUSH_PLAIN.join('|')})\\b`, 'i').test(appearance)) return true;
  // «pink cheeks» no trae ninguna palabra de rubor: lo que lo delata es a quien califica
  return blushPattern('i').test(appearance);
}

/** la escena ya limpia, y lo que se le quito por el camino */
export interface StrippedScene {
  text: string;
  /**
   * los fragmentos eliminados, tal y como se leian: «dark hair», «japanese woman».
   *
   * Existe porque el recorte es invisible: se pide «pelo oscuro suelto sobre la
   * almohada», el color desaparece por un motivo bueno y nadie lo cuenta. Con
   * esta lista, el panel de revision puede ofrecer devolver cada fragmento al
   * positivo ANTES de generar, en vez de dejar al usuario adivinando por que su
   * escena llego a medias.
   */
  dropped: string[];
}

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
 *
 * Son cuatro familias, en el orden en que se descubrieron y en el que se
 * recortan: color de pelo y ojos, origen, complexion y rubor. Todas comparten
 * las dos reglas de arriba —solo si la receta ya lo dice, y solo el rasgo, no
 * la frase— y todo lo quitado sale en `dropped`, nunca en silencio.
 *
 * Con una excepcion al «solo el rasgo»: si lo que queda del elemento es el
 * sustantivo pelado —«flushed cheeks» -> «cheeks»— se va entero, porque una
 * etiqueta asi ya no dice nada y gasta uno de los ocho huecos que el bloque de
 * instrucciones presupuesta para la escena.
 */
export function stripConflictingTraitsDetailed(scene: string, appearance: string): StrippedScene {
  const fijo = appearance.toLowerCase();
  const dropped: string[] = [];
  let salida = scene;
  for (const rasgo of ['hair', 'eyes'] as const) {
    if (!fijo.includes(rasgo)) continue;
    // el color puede venir con varias palabras («light brown hair») y a veces
    // encadenado («long dark messy hair»): se repite el grupo hasta el rasgo
    const patron = qualifierPattern(TRAIT_COLORS, rasgo, 'gi', true);
    salida = salida.replace(patron, (match: string) => {
      // se apunta con el rasgo detras porque «dark» a secas no se entiende un
      // mes despues, y lo que el usuario tiene que poder devolver es la frase
      dropped.push(`${match.trim()} ${rasgo}`);
      return '';
    });
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
      `\\b${origen}\\s+(?=(?:\\w+\\s+){0,2}?(?:${TRAIT_PERSON_WORDS})\\b)`,
      'gi',
    );
    salida = salida.replace(patron, (match: string, offset: number, entero: string) => {
      // el patron solo consume el origen: a quien calificaba viene detras, y
      // sin esa palabra el aviso diria «japanese» sin decir japanese QUE.
      //
      // Se apunta el origen y la PERSONA, nunca los adjetivos que hay en medio:
      // esos se quedan escritos, y meterlos en `dropped` haria que devolverlo
      // los duplicase —«young slim girl on bed, asian young slim girl»—.
      const persona = new RegExp(`^(?:\\w+\\s+){0,2}?(${TRAIT_PERSON_WORDS})\\b`, 'i').exec(
        entero.slice(offset + match.length),
      );
      const quien = persona?.[1];
      dropped.push(quien === undefined ? match.trim() : `${match.trim()} ${quien}`);
      return '';
    });
  }

  // TERCER camino: la COMPLEXION. La receta fija «slim body, slender, small
  // frame» y la escena escribe «small body»; el generador recibe dos tallas y
  // elige una. Se quita solo el calificativo —«small body pressed against him»
  // sigue siendo «body pressed against him»— y solo delante de un sustantivo
  // que nombre el cuerpo entero: el pecho, las caderas o las piernas son escena
  // y el aspecto fijo no los ha declarado.
  if (describesBuild(fijo)) {
    for (const noun of TRAIT_BUILD_NOUNS) {
      const patron = qualifierPattern(TRAIT_BUILD_WORDS, noun, 'gi', false);
      salida = salida.replace(patron, (match: string) => {
        // igual que con el color: «small» a secas no se entiende un mes despues
        dropped.push(`${match.trim()} ${noun}`);
        return '';
      });
    }
  }

  // CUARTO camino: el RUBOR. La receta decia «blush, pink cheeks» y la escena
  // repetia «blushing». Se quita con el mismo cuidado que el origen: un color
  // sobre la cara es rubor, el mismo color sobre otra cosa es escena, asi que
  // «blush pink lingerie» y «rosy dawn light» se quedan donde estan.
  if (describesBlush(fijo)) {
    salida = salida.replace(blushPattern('gi'), (match: string, offset: number, entero: string) => {
      // el patron solo consume el calificativo: lo que ruborizaba viene detras.
      //
      // Se apunta el calificativo y ESA palabra, no lo que hubiera en medio, que
      // sigue escrito: apuntar «red glow on skin» cuando solo se quito «red»
      // hacia que devolverlo dejase «glow on skin, night, red glow on skin».
      const objetivo = new RegExp(`^(?:\\w+\\s+){0,2}?(${TRAIT_BLUSH_TARGETS})\\b`, 'i').exec(
        entero.slice(offset + match.length),
      );
      const parte = objetivo?.[1];
      dropped.push(parte === undefined ? match.trim() : `${match.trim()} ${parte}`);
      return '';
    });
    // y las formas que no pueden calificar a un objeto van solas: «naked,
    // blushing, on bed» no trae ninguna parte de la cara detras. Con su adverbio
    // detras si lo trae, porque «blushing furiously» es una sola cosa y dejar el
    // «furiously» suelto convierte la etiqueta en ruido
    const sueltos = new RegExp(`\\b(?:${TRAIT_BLUSH_VERBS.join('|')})(?:\\s+\\w+ly)?\\b`, 'gi');
    salida = salida.replace(sueltos, (match: string) => {
      dropped.push(match.trim());
      return '';
    });
  }

  // los sustantivos que se quedaron solos se van enteros. Solo donde el recorte
  // ha TOCADO: un «cheeks» que la escena escribio sin calificar es suyo y se
  // respeta. El recorte nunca se lleva una coma, asi que los dos textos tienen
  // los mismos elementos y se comparan uno a uno.
  const originales = scene.split(',');
  const elementos = salida.split(',');
  if (originales.length === elementos.length) {
    salida = elementos
      .map((elemento, indice) =>
        elemento !== originales[indice] && TRAIT_BARE_NOUNS.has(elemento.trim().toLowerCase())
          ? ''
          : elemento,
      )
      .join(',');
  }

  // la limpieza puede dejar comas huerfanas o dobles espacios. La coma FINAL
  // aparece desde que hay recortes que se llevan el termino entero: «on bed,
  // blushing» se queda en «on bed,» y esa coma llega al prompt. El espacio ANTES
  // de la coma tambien: «she blushes, looking away» se quedaba en «she ,». Y las
  // comas seguidas pueden ser mas de dos desde que mueren elementos enteros
  const text = salida
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/,\s*$/, '')
    .trim();
  return { text, dropped: dedupeFragments(dropped) };
}

/**
 * un fragmento repetido se apunta UNA vez.
 *
 * Una escena puede nombrar el mismo rasgo dos veces —«dark hair wet, dark hair
 * over her face»— y el recorte los quita los dos, asi que sin esto `dropped`
 * traeria 'dark hair' duplicado. Eso le da al panel dos botones identicos con
 * la misma `key` de React —aviso en consola— y el segundo no hace nada, porque
 * `restoreDroppedFragment` ya no añade lo que ya esta escrito.
 *
 * Se compara sin distinguir mayusculas, como lo hace esa restauracion, y se
 * conserva el PRIMERO: es el que la escena escribio, y el orden de esta lista
 * es el orden en que se recorto.
 */
function dedupeFragments(fragments: readonly string[]): string[] {
  const vistos = new Set<string>();
  const unicos: string[] = [];
  for (const fragment of fragments) {
    const clave = fragment.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    unicos.push(fragment);
  }
  return unicos;
}

/**
 * la escena limpia y nada mas, que es lo que necesita casi todo el mundo.
 *
 * Se conserva con esta firma porque es la que consumen el resto de llamadores y
 * sus pruebas: la version detallada nacio despues, para el panel de revision.
 */
export function stripConflictingTraits(scene: string, appearance: string): string {
  return stripConflictingTraitsDetailed(scene, appearance).text;
}

/**
 * los modelos de la familia Pony, que piden su propio prefijo de calidad.
 *
 * Se reconocen por el nombre —todos lo llevan— y no por una lista aparte que
 * habria que mantener en dos sitios. `baseline` no sirve: Pony e Illustrious
 * son los dos SDXL, comparten tamaño y clipSkip, y aun asi no se les escribe
 * igual.
 */
export function isPonyModel(model: string): boolean {
  return model.toLowerCase().includes('pony');
}

/** lo que Pony espera al principio del prompt; sin esto rinde de forma erratica */
export const PONY_QUALITY_PREFIX = 'score_9, score_8_up, score_7_up';

/**
 * aviso cuando el aspecto fijo no trae el prefijo que pide el modelo elegido.
 *
 * Es una RECOMENDACION, y el texto lo dice asi a proposito. La documentacion de
 * Pony pide sus `score_`, pero no son obligatorios: hay dos generaciones reales
 * con `WAI-ANI-NSFW-PONYXL` sin ellos, una que ignoro media escena y otra que la
 * cumplio entera. O sea que ayudan y no explican por si solos un mal resultado.
 *
 * La primera version de este aviso decia que sin ellos «devuelve imagenes
 * genericas». Eso era afirmar de mas con dos muestras, y un aviso que exagera
 * se acaba ignorando tambien cuando acierta.
 *
 * Solo avisa cuando hay algo que corregir, y solo si TODOS los modelos elegidos
 * son de la misma familia: con una receta mezclada el aviso que toca es el otro
 * (`mixedBaselineWarning`), porque ningun prefijo puede estar bien para los dos.
 */
export function qualityPrefixWarning(models: readonly string[], appearance: string): string | null {
  if (models.length === 0) return null;
  const pony = models.filter((model) => isPonyModel(model));
  if (pony.length === 0 || pony.length !== models.length) return null;
  if (appearance.toLowerCase().includes('score_')) return null;
  return `${pony[0]} es de la familia Pony y espera empezar por «${PONY_QUALITY_PREFIX}». Sin eso no da error: devuelve imagenes genericas que ignoran media escena. Ponlo al principio del aspecto fijo, o elige un modelo Illustrious, que es el que usa «masterpiece, best quality».`;
}
