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

export interface CatalogSnapshot {
  connectionId: string;
  fetchedAt: string;
  /** modelos que la conexion declara servir */
  models: CatalogModelPrice[];
  /** true si la pasarela contesto a la consulta de precios */
  pricingAvailable: boolean;
  /** aviso legible cuando algo no se pudo leer; nunca una traza */
  notice: string | null;
  /** que devolvio cada ruta de precios probada */
  pricingProbes?: PricingProbe[];
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

/** identificadores de modelo que declara `/v1/models` */
export function parseProviderModels(payload: unknown): string[] {
  const parsed = providerModelsResponseSchema.safeParse(payload);
  if (!parsed.success) return [];
  const ids: string[] = [];
  for (const entry of parsed.data.data) {
    const model = providerModelEntrySchema.safeParse(entry);
    if (model.success) ids.push(model.data.id);
  }
  return ids;
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
  fetchedAt: string;
  modelsPayload: unknown;
  pricingPayload: unknown | null;
  notice?: string | null;
  pricingProbes?: PricingProbe[];
}): CatalogSnapshot {
  const served = parseProviderModels(input.modelsPayload);

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

  const models = served.map(
    (apiModel) =>
      prices.get(apiModel) ?? {
        apiModel,
        ownedBy: null,
        billing: 'unknown' as BillingMode,
        modelRatio: null,
        completionRatio: null,
        perCall: null,
        groups: [],
      },
  );

  return {
    connectionId: input.connectionId,
    fetchedAt: input.fetchedAt,
    models,
    pricingAvailable: pricing.success && prices.size > 0,
    notice: input.notice ?? null,
    ...(input.pricingProbes === undefined ? {} : { pricingProbes: input.pricingProbes }),
  };
}

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
 * familia a la que pertenece un identificador de modelo.
 *
 * es una heuristica sobre el nombre y se usa solo para agrupar en pantalla.
 * NO decide con que proveedor se ejecuta: eso lo sigue diciendo el catalogo.
 */
export function guessModelFamily(apiModel: string): string {
  const name = apiModel.toLowerCase();
  if (name.includes('deepseek')) return 'deepseek';
  if (name.includes('kimi') || name.includes('moonshot')) return 'kimi';
  if (name.includes('glm') || name.includes('chatglm')) return 'glm';
  if (name.includes('qwen') || name.includes('qwq')) return 'qwen';
  if (name.includes('claude')) return 'claude';
  if (name.includes('gpt') || name.includes('o1') || name.includes('o3')) return 'openai';
  if (name.includes('gemini')) return 'gemini';
  if (name.includes('kat')) return 'kat';
  // familias adicionales observadas en las lecturas reales de la conexion
  if (name.startsWith('stepaudio') || name.startsWith('step-image')) return 'step-media';
  if (name.includes('step')) return 'step';
  if (name.includes('minimax')) return 'minimax';
  if (name.includes('sensenova')) return 'sensenova';
  if (name === 'hy3' || name.includes('hunyuan')) return 'hunyuan';
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
