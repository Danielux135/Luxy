// lectura del catalogo REAL de una conexion: que modelos sirve y a que precio.
//
// POR QUE EXISTE: el catalogo de Luxy esta escrito a mano y usa 8.192 tokens de
// salida para todos los modelos, un numero que nunca se verifico. Un trabajo
// real acabo con `finish_reason: length` exactamente ahi. Los modelos ademas
// cambian: aparecen, desaparecen y cambian de precio sin avisar.
//
// Aqui esta el parseo, que es la parte delicada y la que se puede probar sin
// red. Quien hace la peticion es el proceso principal de Desktop, que es el
// unico que tiene la clave descifrada.
import { z } from 'zod';
import type { ModelCapability } from './types.js';

/**
 * respuesta de `GET /v1/models`, formato OpenAI.
 *
 * `passthrough` a proposito: cada pasarela añade campos suyos y perder la
 * respuesta entera por un campo desconocido seria absurdo. Lo unico obligatorio
 * es el identificador.
 */
export const providerModelEntrySchema = z
  .object({
    id: z.string().min(1).max(200),
    owned_by: z.string().max(200).optional(),
    created: z.number().optional(),
    /**
     * lo que la pasarela dice que ese modelo sabe hacer.
     *
     * No todas lo publican, y las que lo hacen no coinciden en los nombres. Se
     * acepta cualquier objeto de banderas y se guardan **las que vienen a
     * `true`, tal cual las escribe la pasarela**: es un dato suyo, no una
     * deduccion nuestra. Antes se descartaba entero y quedaba solo el nombre,
     * asi que para saber cual sabe mirar una imagen habia que adivinarlo.
     */
    capabilities: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const providerModelsResponseSchema = z
  .object({ data: z.array(z.unknown()).default([]) })
  .passthrough();

/** como se cobra un modelo */
export const BILLING_MODES = ['token', 'call', 'unknown'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export interface CatalogModelPrice {
  apiModel: string;
  ownedBy: string | null;
  billing: BillingMode;
  /** multiplicador del precio de entrada, tal cual lo da la pasarela */
  modelRatio: number | null;
  /** cuanto mas cara es la salida que la entrada */
  completionRatio: number | null;
  /** precio por llamada cuando `billing` es `call`, en la moneda de la pasarela */
  perCall: number | null;
  /** grupos o niveles a los que pertenece, si la pasarela los declara */
  groups: string[];
  /**
   * lo que la pasarela dice que sabe hacer, con SUS nombres y sin traducir.
   *
   * Vacio significa «no lo declara», nunca «no sabe hacer nada». La diferencia
   * importa: una pasarela que no publica capacidades no convierte a sus modelos
   * en incapaces. Ausente en los catalogos guardados antes de esto.
   */
  declaredCapabilities?: string[];
}

/**
 * que contesto cada intento de leer precios.
 *
 * la primera lectura real devolvio 22 modelos y CERO precios, y no habia forma
 * de saber si la ruta no existia, si contesto vacia o si trae otra forma. Esto
 * lo dice, y cabe en una linea de pantalla.
 */
export interface PricingProbe {
  /** ruta probada, sin clave ni parametros */
  url: string;
  /** codigo HTTP, o null si la peticion ni siquiera llego */
  status: number | null;
  /** claves de primer nivel de la respuesta, para reconocer su forma */
  topLevelKeys: string[];
  /** cuantas entradas traia la lista, si traia una */
  entryCount: number;
}

/**
 * de cual de las DOS listas sale este catalogo.
 *
 * `connections` y `providers.http` son listas distintas y sus identificadores
 * viven en el mismo espacio de nombres, asi que el identificador solo no basta
 * para saber a quien hay que preguntarle. Sin esto, una conexion y un proveedor
 * HTTP que se llamen igual comparten catalogo y se pisan.
 */
export type CatalogSource = 'connection' | 'http';

export interface CatalogSnapshot {
  connectionId: string;
  /** ausente en los catalogos guardados antes de que existieran los dos origenes */
  source?: CatalogSource;
  fetchedAt: string;
  /** modelos que la conexion declara servir */
  models: CatalogModelPrice[];
  /** true si la pasarela contesto a la consulta de precios */
  pricingAvailable: boolean;
  /** aviso legible cuando algo no se pudo leer; nunca una traza */
  notice: string | null;
  /** que devolvio cada ruta de precios probada */
  pricingProbes?: PricingProbe[];
  /**
   * cuantas filas de `/v1/models` no se pudieron leer siquiera.
   *
   * POR QUE SE GUARDA: el aviso de «modelos que se quedaron fuera» lo cuenta la
   * pantalla a partir de lo que descarto `buildCatalogReport`, y para entonces
   * `parseProviderModelEntries` ya ha tirado en silencio lo que su esquema no
   * acepta: un `id` que no es cadena, uno de mas de 200 caracteres, una fila
   * suelta. Sirviendo seis entradas raras el catalogo acababa con dos modelos y
   * el aviso decia «un modelo se quedo fuera». Faltaban cuatro. Ausente en los
   * catalogos guardados antes de esto, que es lo mismo que cero.
   */
  unreadableModels?: number;
}

/**
 * entrada de precios del panel *New API*, que es lo que usa esta pasarela.
 *
 * todo es opcional menos el nombre: no se ha visto todavia una respuesta real,
 * asi que el parseo acepta lo que venga y guarda lo que reconozca. Inventar
 * campos obligatorios aqui haria que un cambio menor tirase el catalogo entero.
 */
export const gatewayPricingEntrySchema = z
  .object({
    model_name: z.string().min(1).max(200).optional(),
    model: z.string().min(1).max(200).optional(),
    /** 0 = por token, 1 = por llamada */
    quota_type: z.number().optional(),
    model_ratio: z.number().optional(),
    completion_ratio: z.number().optional(),
    model_price: z.number().optional(),
    owner_by: z.string().max(200).optional(),
    enable_groups: z.array(z.string().max(64)).optional(),
  })
  .passthrough();

export const gatewayPricingResponseSchema = z
  .object({
    data: z.array(z.unknown()).default([]),
    success: z.boolean().optional(),
  })
  .passthrough();

/**
 * capacidades que la pasarela declara **en `true`**, con su nombre original.
 *
 * No se traducen ni se normalizan aqui: lo que dice la pasarela se guarda como
 * lo dice. La traduccion a nuestro vocabulario se hace aparte y a la vista,
 * para que se pueda revisar sin volver a llamar a la red.
 */
export function parseModelCapabilities(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, valor]) => valor === true)
    .map(([nombre]) => nombre)
    .sort();
}

/**
 * lo que nuestro vocabulario entiende de una capacidad declarada por la pasarela.
 *
 * Solo se traduce lo que se reconoce con certeza. Una bandera desconocida se
 * conserva en `declared` pero NO se convierte en una capacidad nuestra:
 * afirmar que un modelo sabe hacer algo sin que nadie lo haya dicho es
 * exactamente el error que esto viene a evitar.
 */
const CAPABILITY_ALIASES: Readonly<Record<string, ModelCapability>> = {
  vision: 'image_input',
  image_input: 'image_input',
  multimodal: 'image_input',
  audio: 'audio_input',
  audio_input: 'audio_input',
  transcription: 'transcription',
  function_calling: 'agent_tools',
  tools: 'agent_tools',
  tool_use: 'agent_tools',
  reasoning: 'reasoning',
};

/** las nuestras que corresponden a lo declarado; sin inventar ninguna */
export function mapDeclaredCapabilities(declared: readonly string[]): ModelCapability[] {
  const nuestras = new Set<ModelCapability>();
  for (const nombre of declared) {
    const propia = CAPABILITY_ALIASES[nombre.toLowerCase()];
    if (propia !== undefined) nuestras.add(propia);
  }
  return [...nuestras].sort();
}

/** un modelo servido, con lo que la pasarela declara de el */
export interface ProviderModelEntry {
  id: string;
  /** las banderas que vienen a `true`, con el nombre que les da la pasarela */
  declaredCapabilities: string[];
}

/**
 * lo que declara `/v1/models`, con la cuenta de lo que no se pudo leer.
 *
 * El recuento existe para que el aviso de pantalla no mienta: lo que se cae
 * aqui no llega a `buildCatalogReport` y por tanto no aparece en su `skipped`.
 */
export function parseProviderModelReport(payload: unknown): {
  entries: ProviderModelEntry[];
  unreadable: number;
} {
  const parsed = providerModelsResponseSchema.safeParse(payload);
  if (!parsed.success) return { entries: [], unreadable: 0 };
  const entries: ProviderModelEntry[] = [];
  let unreadable = 0;
  for (const entry of parsed.data.data) {
    const model = providerModelEntrySchema.safeParse(entry);
    if (!model.success) {
      unreadable += 1;
      continue;
    }
    entries.push({
      id: model.data.id,
      declaredCapabilities: parseModelCapabilities(model.data.capabilities),
    });
  }
  return { entries, unreadable };
}

/** lo que declara `/v1/models`, ya parseado */
export function parseProviderModelEntries(payload: unknown): ProviderModelEntry[] {
  return parseProviderModelReport(payload).entries;
}

/** identificadores de modelo que declara `/v1/models` */
export function parseProviderModels(payload: unknown): string[] {
  return parseProviderModelEntries(payload).map((entry) => entry.id);
}

function billingModeOf(quotaType: number | undefined): BillingMode {
  if (quotaType === 0) return 'token';
  if (quotaType === 1) return 'call';
  return 'unknown';
}

/**
 * combina modelos y precios en un catalogo.
 *
 * manda la lista de `/v1/models`: es la que dice que se puede pedir de verdad.
 * Un modelo con precio pero que no se sirve no entra; uno servido sin precio
 * entra con `billing: unknown`, porque no saber lo que cuesta no es motivo para
 * esconderlo.
 */
export function buildCatalogSnapshot(input: {
  connectionId: string;
  source?: CatalogSource;
  fetchedAt: string;
  modelsPayload: unknown;
  pricingPayload: unknown | null;
  notice?: string | null;
  pricingProbes?: PricingProbe[];
}): CatalogSnapshot {
  const { entries: served, unreadable } = parseProviderModelReport(input.modelsPayload);

  const prices = new Map<string, CatalogModelPrice>();
  const pricing = gatewayPricingResponseSchema.safeParse(input.pricingPayload ?? undefined);
  if (pricing.success) {
    for (const entry of pricing.data.data) {
      const row = gatewayPricingEntrySchema.safeParse(entry);
      if (!row.success) continue;
      const name = row.data.model_name ?? row.data.model;
      if (name === undefined) continue;
      prices.set(name, {
        apiModel: name,
        ownedBy: row.data.owner_by ?? null,
        billing: billingModeOf(row.data.quota_type),
        modelRatio: row.data.model_ratio ?? null,
        completionRatio: row.data.completion_ratio ?? null,
        perCall: row.data.model_price ?? null,
        groups: row.data.enable_groups ?? [],
      });
    }
  }

  // el precio y las capacidades vienen de sitios distintos —la tabla de precios
  // y `/v1/models`— y se juntan aqui: quien manda sobre que EXISTE es la lista
  // de servidos, y las capacidades acompañan siempre a su modelo
  const models = served.map((entry) => ({
    ...(prices.get(entry.id) ?? {
      apiModel: entry.id,
      ownedBy: null,
      billing: 'unknown' as BillingMode,
      modelRatio: null,
      completionRatio: null,
      perCall: null,
      groups: [],
    }),
    declaredCapabilities: entry.declaredCapabilities,
  }));

  return {
    connectionId: input.connectionId,
    source: input.source ?? 'connection',
    fetchedAt: input.fetchedAt,
    models,
    pricingAvailable: pricing.success && prices.size > 0,
    notice: input.notice ?? null,
    ...(input.pricingProbes === undefined ? {} : { pricingProbes: input.pricingProbes }),
    // cero no se guarda: es el caso normal y el campo es opcional
    ...(unreadable === 0 ? {} : { unreadableModels: unreadable }),
  };
}

/**
 * la forma de un catalogo guardado, para poder COMPROBARLA al leerlo.
 *
 * POR QUE VIVE AQUI Y NO EN EL CONTRATO IPC: el que habia alli estaba escrito y
 * no se ejecutaba nunca —sus dos usos eran `z.infer`, o sea posiciones de
 * tipo—, mientras el lector de disco hacia `JSON.parse(raw) as CatalogSnapshot`
 * y se fiaba. Un archivo ilegible se trataba como ausente, pero uno con JSON
 * valido y otra forma pasaba entero: `models` sin `apiModel`, o `models` que ni
 * siquiera es una lista. Eso viajaba al renderer y tumbaba la ventana desde el
 * arranque. Aqui esta al lado del tipo que describe, que es lo unico que impide
 * que los dos se separen otra vez.
 */
export const catalogModelPriceSchema = z.object({
  apiModel: z.string(),
  ownedBy: z.string().nullable(),
  billing: z.enum(BILLING_MODES),
  modelRatio: z.number().nullable(),
  completionRatio: z.number().nullable(),
  perCall: z.number().nullable(),
  groups: z.array(z.string()),
  /** ausente en los catalogos guardados antes de que se leyeran las capacidades */
  declaredCapabilities: z.array(z.string()).optional(),
});

export const pricingProbeSchema = z.object({
  url: z.string(),
  status: z.number().nullable(),
  topLevelKeys: z.array(z.string()),
  entryCount: z.number(),
});

export const catalogSnapshotSchema = z.object({
  connectionId: z.string(),
  /**
   * un catalogo guardado antes de que existieran los dos origenes no lo lleva.
   *
   * Opcional y SIN valor por defecto a proposito: con un `.default('connection')`
   * un archivo viejo de un proveedor HTTP se leeria como de `connections` y
   * quedaria huerfano. Quien lo lee sabe cual pidio y rellena con ese.
   */
  source: z.enum(['connection', 'http']).optional(),
  fetchedAt: z.string(),
  models: z.array(catalogModelPriceSchema),
  pricingAvailable: z.boolean(),
  notice: z.string().nullable(),
  /** que contesto cada ruta de precios probada */
  pricingProbes: z.array(pricingProbeSchema).optional(),
  /** filas de `/v1/models` que no se pudieron leer */
  unreadableModels: z.number().int().min(0).optional(),
});

/** una linea que explica por que no hay precios, con lo que contesto cada ruta */
export function describePricingProbes(probes: PricingProbe[]): string {
  if (probes.length === 0) return 'No se probo ninguna ruta de precios.';
  return probes
    .map((probe) => {
      if (probe.status === null) return `${probe.url}: sin respuesta`;
      if (probe.status !== 200) return `${probe.url}: HTTP ${probe.status}`;
      const claves = probe.topLevelKeys.length === 0 ? 'sin claves' : probe.topLevelKeys.join(', ');
      return `${probe.url}: 200 con ${probe.entryCount} entradas (${claves})`;
    })
    .join(' · ');
}

/**
 * como se llaman de verdad los modelos de Mistral.
 *
 * Se comparte con `buildCatalogForConnection` para que agrupar en pantalla y
 * decidir la familia operativa no discrepen EN ESTOS NOMBRES: si un sitio dice
 * «mistral» y el otro «otros», el selector de Privado se queda vacio sin
 * explicar nada.
 *
 * Es lo unico que comparten. El resto de la cascada esta escrita dos veces y
 * responde distinto a proposito: ver `guessDisplayGroup`.
 */
export const MISTRAL_NAMES = [
  'mistral',
  'pixtral',
  'ministral',
  'magistral',
  'codestral',
  'devstral',
] as const;

/**
 * el grupo con el que se AGRUPA un modelo en el panel de catalogo real.
 *
 * NO es la familia operativa y no puede usarse para nada que se ejecute: es una
 * heuristica de pantalla y devuelve valores que el sistema no acepta como
 * familia (`claude`, `openai`, `gemini`, `otros`, `step-media`), ninguno en
 * `MODEL_FAMILIES`. La familia de verdad la fija `buildServedModel`, y quien
 * ejecuta un modelo lo decide `providerCandidatesForModel`.
 *
 * POR QUE NO SE UNIFICAN, que es lo que uno intenta al ver las dos cascadas:
 * aqui agrupar por MARCA informa —`claude`, `openai` y `gemini` son tres grupos
 * utiles en una lista de precios— y alli hundirlos todos en `other` es lo
 * correcto, porque no son familias ejecutables. Son dos preguntas distintas con
 * la misma pinta. El nombre lleva «grupo» y no «familia» precisamente para que
 * el parecido no invite a usar esta donde hace falta la otra: se llamaba
 * `guessModelFamily`, y su aviso estaba en un bloque de comentario huerfano que
 * el editor ni siquiera enseñaba al pasar el raton.
 */
export function guessDisplayGroup(apiModel: string): string {
  const name = apiModel.toLowerCase();
  if (name.includes('deepseek')) return 'deepseek';
  if (name.includes('kimi') || name.includes('moonshot')) return 'kimi';
  if (name.includes('glm') || name.includes('chatglm')) return 'glm';
  if (name.includes('qwen') || name.includes('qwq')) return 'qwen';
  if (name.includes('claude')) return 'claude';
  if (name.includes('gpt') || name.includes('o1') || name.includes('o3')) return 'openai';
  if (name.includes('gemini')) return 'gemini';
  if (name.includes('kat')) return 'kat';
  // la familia de Mistral no se llama siempre «mistral»: sus modelos con vista
  // son «pixtral», y los pequeños «ministral». Sin esto caian todos en «otros»
  if (MISTRAL_NAMES.some((parte) => name.includes(parte))) return 'mistral';
  // la familia "otros" conserva modelos reales sin familia operativa propia.
  if (name.startsWith('stepaudio') || name.startsWith('step-image')) return 'step-media';
  if (name.includes('step')) return 'step';
  if (name.includes('minimax')) return 'minimax';
  if (name.includes('sensenova')) return 'sensenova';
  if (name === 'auto') return 'router';
  return 'otros';
}

/** texto corto para la interfaz: como se cobra este modelo */
export function describeModelBilling(model: CatalogModelPrice): string {
  if (model.billing === 'call') {
    return model.perCall === null ? 'por llamada' : `por llamada · ${model.perCall} por peticion`;
  }
  if (model.billing === 'token') {
    const salida =
      model.completionRatio === null ? '' : ` · salida x${model.completionRatio} sobre entrada`;
    return model.modelRatio === null
      ? 'por tokens'
      : `por tokens · multiplicador ${model.modelRatio}${salida}`;
  }
  return 'precio no declarado';
}
