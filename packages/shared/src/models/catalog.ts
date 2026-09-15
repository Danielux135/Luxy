// catalogo inicial de modelos.
//
// PROCEDENCIA: Daniel reviso el catalogo activo de la conexion el 2026-08-31.
// Solo contiene los 19 identificadores mostrados entonces. La lista de pantalla
// no verifica herramientas, limites ni otras capacidades: esos contratos se
// marcan aparte y no se deducen de la ficha comercial.
//
// El campo apiModel es EXACTO: no se normaliza ni se corrigen mayusculas.
import {
  AGENT_TOOL_NAMES,
  MODEL_FAMILIES,
  connectionProfileSchema,
  modelDefinitionSchema,
  type ConnectionProfile,
  type ModelCapability,
  type ModelDefinition,
} from './types.js';
import { MISTRAL_NAMES, mapDeclaredCapabilities } from './catalog-fetch.js';

/** id de la conexion que se crea durante el onboarding */
export const DEFAULT_CONNECTION_ID = 'hcnsec';

export const DEFAULT_CONNECTIONS: readonly ConnectionProfile[] = [
  connectionProfileSchema.parse({
    id: DEFAULT_CONNECTION_ID,
    displayName: 'API China',
    baseUrl: 'https://api.hcnsec.cn/v1',
    protocol: 'openai',
  }),
];

/** un modelo de codigo puede usar todas las herramientas del ejecutor local */
const ALL_TOOLS = [...AGENT_TOOL_NAMES];

/**
 * marca lo que todavia no se ha podido comprobar contra la API real.
 * la interfaz lo muestra y la documentacion lo repite: no es una integracion
 * terminada, es un contrato con mocks.
 */
const UNVERIFIED = { contractVerified: false, note: 'PENDIENTE_VERIFICAR_CONTRATO' } as const;

/**
 * comprobado con una llamada real el 2026-07-28: el endpoint devolvio
 * tool_calls y finish_reason=tool_calls.
 */
const TOOLS_OK = { contractVerified: true, toolCallingCheckedAt: '2026-07-28' } as const;

/**
 * responde y admite tool calling, pero MUY despacio.
 *
 * medido el 2026-07-28: varios modelos de la conexion tardaban 120-240 s en una
 * peticion trivial. No estan caidos; hay que darles margen. Una primera
 * comprobacion con 45 s los dio por muertos, que era un error de la medida.
 */
const TOOLS_OK_SLOW = {
  contractVerified: true,
  toolCallingCheckedAt: '2026-07-28',
  slowResponse: true,
} as const;

const RAW_CATALOG = [
  // ---------------------------------------------------------------------------
  // texto y codigo: los unicos que pueden ejecutar herramientas
  // ---------------------------------------------------------------------------
  {
    id: 'deepseek-v4-pro',
    supportsNativeTools: true,
    // medido el 2026-07-29: ~206 s para una respuesta trivial. No esta caido,
    // es lento. Si prefieres rapidez, marca DeepSeek-V4-Flash como
    // predeterminado de la familia y /deepseek lo usara sin cambiar el comando.
    metadata: { ...TOOLS_OK_SLOW, observedLatencyMs: 206_000 },
    apiModel: 'DeepSeek-V4-Pro',
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    category: 'text',
    capabilities: ['text', 'reasoning', 'coding', 'long_context', 'agent_tools'],
    telegramAliases: ['deepseek', 'deepseek_pro'],
    defaultForFamily: true,
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'deepseek-v4-flash',
    supportsNativeTools: true,
    metadata: TOOLS_OK,
    apiModel: 'DeepSeek-V4-Flash',
    displayName: 'DeepSeek V4 Flash',
    family: 'deepseek',
    category: 'text',
    capabilities: ['text', 'coding', 'fast', 'agent_tools'],
    telegramAliases: ['deepseek_flash'],
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'glm-4.5-air',
    metadata: UNVERIFIED,
    apiModel: 'glm-4.5-air',
    displayName: 'GLM 4.5 Air',
    family: 'glm',
    category: 'text',
    capabilities: ['text'],
    telegramAliases: ['glm', 'glm_45_air'],
    defaultForFamily: true,
  },
  {
    id: 'kat-coder-pro-v2.5',
    metadata: UNVERIFIED,
    apiModel: 'kat-coder-pro-v2.5',
    displayName: 'KAT Coder Pro v2.5',
    family: 'kat',
    category: 'text',
    capabilities: ['text'],
    telegramAliases: ['kat', 'kat_v25'],
    defaultForFamily: true,
  },
  {
    id: 'kimi-k3',
    // LUX-A9K9 (2026-08-31) recibio un tool_calls nativo de Kimi K3. Daniel
    // pidio probarlo de forma controlada: se le concede el ejecutor confinado
    // del worktree, pero el contrato sigue marcado experimental hasta que una
    // tarea real complete al menos una llamada valida de principio a fin.
    supportsNativeTools: true,
    metadata: {
      ...UNVERIFIED,
      note: 'EXPERIMENTAL_TOOL_CALLING_2026-08-31',
      toolCallingCheckedAt: '2026-08-31',
    },
    apiModel: 'kimi-k3',
    displayName: 'Kimi K3',
    family: 'kimi',
    category: 'text',
    capabilities: ['text', 'coding', 'agent_tools'],
    telegramAliases: ['kimi', 'kimi_k3'],
    defaultForFamily: true,
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'minimax-m3',
    supportsNativeTools: true,
    // el mas lento del catalogo: hasta 240 s con herramientas
    metadata: { ...TOOLS_OK_SLOW, observedLatencyMs: 240_000 },
    apiModel: 'MiniMax-M3',
    displayName: 'MiniMax M3',
    family: 'minimax',
    category: 'text',
    capabilities: ['text', 'coding', 'agent_tools'],
    telegramAliases: ['minimax', 'minimax_m3'],
    defaultForFamily: true,
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'qwen3-embedding-8b',
    metadata: {
      ...UNVERIFIED,
      note: 'servido por la conexion el 2026-08-11; capacidades pendientes',
    },
    apiModel: 'Qwen3-Embedding-8B',
    displayName: 'Qwen3 Embedding 8B',
    family: 'qwen',
    category: 'text',
    capabilities: ['text'],
    telegramAliases: [],
  },
  {
    id: 'qwen3.8-27b',
    metadata: {
      ...UNVERIFIED,
      note: 'servido por la conexion el 2026-08-11; capacidades pendientes',
    },
    apiModel: 'Qwen3.8-27B',
    displayName: 'Qwen3.8 27B',
    family: 'qwen',
    category: 'text',
    capabilities: ['text'],
    telegramAliases: ['qwen', 'qwen_38'],
    defaultForFamily: true,
  },
  {
    id: 'step-3.7-flash',
    supportsNativeTools: true,
    metadata: TOOLS_OK,
    apiModel: 'step-3.7-flash',
    displayName: 'Step 3.7 Flash',
    family: 'step',
    category: 'text',
    capabilities: ['text', 'coding', 'fast', 'agent_tools'],
    telegramAliases: ['step', 'step_37'],
    defaultForFamily: true,
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'step-explore',
    apiModel: 'step-explore',
    displayName: 'Step Explore',
    family: 'step',
    category: 'text',
    capabilities: ['text'],
    telegramAliases: [],
    metadata: {
      ...UNVERIFIED,
      note: 'servido por la conexion el 2026-08-07; capacidades pendientes',
    },
  },
  {
    id: 'sensenova-6.8-flash-lite',
    apiModel: 'sensenova-6.8-flash-lite',
    displayName: 'SenseNova 6.8 Flash Lite',
    family: 'sensenova',
    category: 'text',
    capabilities: ['text'],
    telegramAliases: [],
    metadata: {
      ...UNVERIFIED,
      note: 'servido por la conexion el 2026-08-07; capacidades pendientes',
    },
  },
  {
    id: 'sensenova-u1.5-lite',
    apiModel: 'sensenova-u1.5-lite',
    displayName: 'SenseNova U1.5 Lite',
    family: 'sensenova',
    category: 'image',
    capabilities: [],
    telegramAliases: [],
    metadata: {
      ...UNVERIFIED,
      note: 'servido por la conexion el 2026-08-07; capacidades pendientes',
    },
  },

  // ---------------------------------------------------------------------------
  // audio: contrato sin verificar. nunca reciben herramientas de archivos.
  // ---------------------------------------------------------------------------
  {
    id: 'stepaudio-2.5-chat',
    apiModel: 'stepaudio-2.5-chat',
    displayName: 'StepAudio 2.5 Chat',
    family: 'stepaudio',
    category: 'audio',
    capabilities: ['audio_chat', 'audio_input', 'audio_output'],
    telegramAliases: ['audio_chat'],
    defaultForFamily: true,
    metadata: UNVERIFIED,
  },
  {
    id: 'stepaudio-2.5-asr',
    apiModel: 'stepaudio-2.5-asr',
    displayName: 'StepAudio 2.5 ASR',
    family: 'stepaudio',
    category: 'audio',
    capabilities: ['transcription', 'audio_input'],
    telegramAliases: ['transcribe'],
    supportsStreaming: false,
    metadata: UNVERIFIED,
  },
  {
    id: 'stepaudio-2.5-realtime',
    apiModel: 'stepaudio-2.5-realtime',
    displayName: 'StepAudio 2.5 Realtime',
    family: 'stepaudio',
    category: 'audio',
    capabilities: ['realtime_audio', 'desktop_voice'],
    telegramAliases: ['voice'],
    metadata: UNVERIFIED,
  },
  {
    id: 'stepaudio-2.5-tts',
    apiModel: 'stepaudio-2.5-tts',
    displayName: 'StepAudio 2.5 TTS',
    family: 'stepaudio',
    category: 'audio',
    capabilities: ['text_to_speech', 'audio_output'],
    telegramAliases: ['speak'],
    supportsStreaming: false,
    metadata: UNVERIFIED,
  },

  // ---------------------------------------------------------------------------
  // imagen: contrato sin verificar
  // ---------------------------------------------------------------------------
  {
    id: 'step-image-edit-2',
    apiModel: 'step-image-edit-2',
    displayName: 'Step Image Edit 2',
    family: 'stepimage',
    category: 'image',
    capabilities: ['image_input', 'image_edit', 'image_output'],
    telegramAliases: ['image_edit'],
    defaultForFamily: true,
    supportsStreaming: false,
    metadata: UNVERIFIED,
  },

  // ---------------------------------------------------------------------------
  // enrutado: nunca se exponen como agente. sin alias de telegram a proposito.
  // desactivados por defecto: /auto usa el router determinista local salvo que
  // el usuario habilite uno de estos explicitamente.
  // ---------------------------------------------------------------------------
  {
    id: 'step-router-v1',
    apiModel: 'step-router-v1',
    displayName: 'Step Router v1',
    family: 'router',
    category: 'routing',
    capabilities: ['routing', 'model_selection'],
    telegramAliases: [],
    enabled: false,
    supportsStreaming: false,
    metadata: UNVERIFIED,
  },
  {
    id: 'newapi-auto',
    apiModel: 'auto',
    displayName: 'Router de la conexion',
    family: 'router',
    category: 'routing',
    capabilities: ['routing', 'model_selection'],
    telegramAliases: [],
    enabled: false,
    supportsStreaming: false,
    metadata: {
      ...UNVERIFIED,
      note: 'router propio del gateway New API; no es un modelo concreto',
    },
  },
] as const;

/** catalogo inicial, validado en tiempo de carga contra el esquema */
export function buildDefaultCatalog(connectionId = DEFAULT_CONNECTION_ID): ModelDefinition[] {
  return RAW_CATALOG.map((entry) => modelDefinitionSchema.parse({ ...entry, connectionId }));
}

/**
 * Convierte la última lectura real en el catálogo operativo. Los modelos ya
 * conocidos conservan su contrato; los nuevos reciben la categoría más segura
 * que permiten sus identificadores, sin herramientas ni capacidades inventadas.
 */
/**
 * un modelo servido, tal y como llega del catalogo leido.
 *
 * Acepta el nombre suelto o el registro entero: lo primero es lo que habia y
 * sigue valiendo; lo segundo trae ademas lo que la pasarela dice que sabe
 * hacer, que es lo que permite marcar cual acepta imagenes en vez de deducirlo
 * del nombre.
 */
export type ServedModel = string | { apiModel: string; declaredCapabilities?: readonly string[] };

/**
 * topes del esquema de `modelDefinitionSchema`, repetidos aqui para poder
 * decidir ANTES de llamar al parse.
 *
 * Si algun dia se separan, lo que ocurre es que un modelo se omite con
 * `invalid-definition` en vez de con su motivo exacto. Es un diagnostico peor,
 * no una caida: el parse sigue yendo dentro de un try.
 */
const MODEL_ID_MAX = 64;
const API_MODEL_MAX = 128;
const DISPLAY_NAME_MAX = 64;

/** lo que se recorto es nuestro, asi que se marca (`D-072`) */
const NAME_TRIM_MARK = '…';

/**
 * lo que no se pudo convertir en un modelo del catalogo, y por que.
 *
 * Existe porque el 2026-09-15 la pantalla de Modelos se quedo EN NEGRO: AI
 * Horde sirve `koboldcpp/llama-3.2-3b-instruct-q4_k_m` y
 * `koboldcpp/Llama-3.2-3B-Instruct-Q4_K_M`, que solo se diferencian en las
 * mayusculas, la derivacion de la id pasaba las dos por `toLowerCase()` y de
 * 27 modelos salian 26 ids. `ModelRegistry` lanzaba, y lanzaba DENTRO del
 * render de `ModelsPage`, asi que se llevo por delante el arbol de React
 * entero y hubo que cerrar Luxy desde la bandeja.
 *
 * La regla que queda escrita, que es la de `D-088`: lo que sirve un tercero es
 * dato, y un dato raro puede costar un modelo o un aviso, **nunca** la
 * aplicacion. Aqui ya se aplicaba para una familia desconocida —«se prefiere
 * agrupar peor a no tener catalogo»—; ahora vale para la funcion entera.
 */
export interface SkippedModel {
  /** el nombre tal y como lo sirvio la pasarela, sin normalizar; vacio si no traia */
  apiModel: string;
  reason:
    | 'empty-name'
    | 'name-too-long'
    /** la pasarela sirvio el mismo nombre dos veces */
    | 'duplicate-name'
    /** su id ya la tiene otro modelo y desambiguarla tampoco la libera */
    | 'duplicate-id'
    /** la entrada ni siquiera traia un nombre legible: null, numero, fila suelta */
    | 'invalid-entry'
    | 'invalid-definition';
}

export interface CatalogBuildReport {
  models: ModelDefinition[];
  /** en el orden en que llegaron; vacio en el caso normal */
  skipped: SkippedModel[];
}

/**
 * sufijo estable a partir del nombre servido.
 *
 * La desambiguacion sale del NOMBRE y no de la posicion en la lista a
 * proposito: un `-1`, `-2` por orden de llegada se reparte distinto en cuanto
 * la pasarela reordena su catalogo, y no lo controlamos —el de AI Horde es la
 * lista de workers vivos en ese instante—. Ojo con leer esto como una promesa
 * mas fuerte de la que es: una id DERIVADA no sobrevive a un cambio del nombre
 * servido ni a la aparicion de un hermano que comparta slug. La garantia real,
 * con su consecuencia, esta escrita en `modelDefinitionSchema.id`.
 * FNV-1a de 32 bits escrito a mano porque `packages/shared` es
 * logica pura: no puede importar `node:crypto`, y el `crypto.subtle` que si
 * existe en los dos entornos es asincrono.
 */
function stableSuffix(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // `Math.imul` mantiene la multiplicacion en 32 bits; con `*` el doble de
    // JS pierde los bits bajos y el hash deja de ser el de FNV
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * el nombre servido, reducido al alfabeto que admite una id de modelo.
 *
 * Es la derivacion de siempre —minusculas, y todo lo que no quepa a guion— con
 * una sola adicion: se quitan los separadores del PRINCIPIO, porque el esquema
 * exige empezar por letra o digito y un `_foo` hacia saltar el parse. Los del
 * final no se tocan, para no cambiar ninguna id que hoy ya sea valida.
 */
function modelSlug(apiModel: string): string {
  return apiModel
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+/, '');
}

/**
 * id para un nombre que no puede quedarse con su slug: o lo reclama otro, o no
 * cabe, o no queda nada de el.
 */
function disambiguatedId(slug: string, apiModel: string): string {
  const suffix = stableSuffix(apiModel);
  const stem = slug.slice(0, MODEL_ID_MAX - suffix.length - 1).replace(/[._-]+$/, '');
  return stem.length === 0 ? `model-${suffix}` : `${stem}-${suffix}`;
}

/**
 * el nombre de una entrada servida, o null si la entrada no trae ninguno.
 *
 * POR QUE ACEPTA `unknown` TENIENDO UN TIPO AL LADO: `ServedModel[]` describe
 * lo que DEBERIA llegar, y en runtime no lo comprueba nadie. La lista sale de
 * `/v1/models` de un tercero o del catalogo guardado en disco, que se leia con
 * un cast. Con una entrada `null`, un `id` numerico o una fila sin `apiModel`,
 * el `servido.apiModel` de antes lanzaba «Cannot read properties of null», y
 * esta funcion corre en la raiz del arbol de React: la ventana se quedaba en
 * negro desde el arranque y ninguna seccion era alcanzable. Es la misma regla
 * `D-088` de mas arriba, aplicada tambien a la PRIMERA pasada.
 */
function servedModelName(servido: unknown): string | null {
  if (typeof servido === 'string') return servido;
  if (typeof servido !== 'object' || servido === null) return null;
  const apiModel = (servido as { apiModel?: unknown }).apiModel;
  return typeof apiModel === 'string' ? apiModel : null;
}

/** las capacidades que declara una entrada servida, quedandose solo con las cadenas */
function servedDeclaredNames(servido: unknown): string[] {
  if (typeof servido !== 'object' || servido === null) return [];
  const declaradas = (servido as { declaredCapabilities?: unknown }).declaredCapabilities;
  if (!Array.isArray(declaradas)) return [];
  return declaradas.filter((nombre): nombre is string => typeof nombre === 'string');
}

/**
 * catalogo de un origen, con la lista de lo que se quedo fuera.
 *
 * `buildCatalogForConnection` es esta misma funcion quedandose solo con los
 * modelos; quien quiera avisar en pantalla de lo omitido llama a esta.
 */
export function buildCatalogReport(
  connectionId: string,
  servedModels: readonly ServedModel[],
  /**
   * familia a la que pertenece TODO lo que sirve este origen.
   *
   * Una conexion agregadora sirve muchas familias y hay que adivinarlas por el
   * nombre. Un proveedor HTTP no: el agente lo registra bajo SU identificador,
   * y el identificador de proveedor ES la familia. Adivinar ahi es lo que hacia
   * que los modelos de Mistral cayeran en «otros» y su selector saliera vacio.
   */
  familyOverride?: string,
): CatalogBuildReport {
  const knownByApiModel = new Map(
    buildDefaultCatalog(connectionId).map((model) => [model.apiModel, model]),
  );

  const skipped: SkippedModel[] = [];
  const entries: {
    apiModel: string;
    declaradas: ModelCapability[];
    known: ModelDefinition | null;
  }[] = [];
  const names = new Set<string>();

  // el tipo dice `readonly ServedModel[]` y en runtime no lo garantiza nadie:
  // esta lista viene del JSON del disco o de la respuesta de una pasarela. Sin
  // esto, un `models` que no sea lista lanza «servedModels is not iterable»
  // ANTES de entrar al bucle, fuera del alcance de cualquier try de dentro
  if (!Array.isArray(servedModels)) return { models: [], skipped: [] };

  for (const servido of servedModels as readonly unknown[]) {
    const apiModel = servedModelName(servido);
    if (apiModel === null) {
      // sin nombre no hay nada que pedirle a la pasarela ni nada que enseñar.
      // Se cuenta aparte de `empty-name` porque diagnostica otra cosa: no es
      // un nombre vacio, es una entrada que no tiene la forma acordada
      skipped.push({ apiModel: '', reason: 'invalid-entry' });
      continue;
    }
    if (apiModel.trim().length === 0) {
      skipped.push({ apiModel, reason: 'empty-name' });
      continue;
    }
    // el nombre NO se recorta nunca: es lo que se le manda a la pasarela, y
    // uno recortado pide un modelo que no existe. Si no cabe, sobra el modelo
    if (apiModel.length > API_MODEL_MAX) {
      skipped.push({ apiModel, reason: 'name-too-long' });
      continue;
    }
    if (names.has(apiModel)) {
      // el mismo nombre dos veces da la misma id por construccion, asi que
      // esto no lo arregla ninguna desambiguacion: es una entrada de sobra
      skipped.push({ apiModel, reason: 'duplicate-name' });
      continue;
    }
    names.add(apiModel);
    entries.push({
      apiModel,
      // lo que la pasarela declara se cree; lo que no declara no se inventa.
      // Solo las cadenas: `mapDeclaredCapabilities` hace `nombre.toLowerCase()`
      // y una lista con un numero dentro lanzaba aqui, en la primera pasada
      declaradas: mapDeclaredCapabilities(servedDeclaredNames(servido)),
      // con familia impuesta no vale el catalogo de fabrica: ese modelo puede
      // existir con el mismo nombre en otra conexion y con otra familia
      known: familyOverride === undefined ? (knownByApiModel.get(apiModel) ?? null) : null,
    });
  }

  // quien reclama cada id. La de fabrica manda sobre una derivada del nombre:
  // es la que llevan los alias de telegram y el predeterminado de familia, asi
  // que moverla romperia /deepseek, no un renglon de una lista
  const reserved = new Set(
    entries.flatMap((entry) => (entry.known === null ? [] : [entry.known.id])),
  );
  const derived = new Map<string, number>();
  for (const entry of entries) {
    if (entry.known !== null) continue;
    const slug = modelSlug(entry.apiModel);
    derived.set(slug, (derived.get(slug) ?? 0) + 1);
  }

  // la id que reclama cada entrada, antes de repartir. Se calcula entera y
  // aparte para poder resolver los empates mirando el CONJUNTO, no la llegada
  const candidates = entries.map((entry) => {
    if (entry.known !== null) return { entry, id: entry.known.id };
    const slug = modelSlug(entry.apiModel);
    // se queda con su slug quien no lo comparte con nadie: asi la id de un
    // modelo que no colisiona es la MISMA de siempre y los catalogos ya
    // guardados en disco siguen valiendo.
    //
    // OJO AL PRECIO DE ESTA SIMETRIA: cuando dos nombres comparten slug no se
    // lo queda ninguno, asi que la id de un modelo depende del catalogo ENTERO
    // de esa lectura y no solo de su nombre. En AI Horde el catalogo son los
    // workers vivos: apagar el gemelo en minusculas devuelve el slug desnudo al
    // otro. Por eso una id derivada no se persiste nunca —se persiste el
    // `apiModel`—; esta escrito tambien en `modelDefinitionSchema.id`
    const libre =
      slug.length > 0 &&
      slug.length <= MODEL_ID_MAX &&
      !reserved.has(slug) &&
      (derived.get(slug) ?? 0) === 1;
    return { entry, id: libre ? slug : disambiguatedId(slug, entry.apiModel) };
  });

  // dos entradas pueden acabar reclamando la misma id: hace falta una colision
  // de FNV entre dos nombres del mismo catalogo, o —mas facil— que la pasarela
  // sirva un nombre con la forma exacta `<slug>-<8 hex>`.
  //
  // Quien sobrevive se decide por el NOMBRE, no por el orden de llegada. Con
  // «gana el primero» el mismo catalogo daba un modelo u otro segun como lo
  // devolviera la pasarela, y la id quedaba ligada a un `apiModel` distinto en
  // cada lectura: no es que faltase un modelo, es que el elegido cambiaba. Una
  // ficha de fabrica gana siempre a una derivada, porque su id lleva los alias
  // de telegram. `localeCompare` no vale aqui: depende del idioma del sistema
  const winners = new Map<string, { apiModel: string; known: boolean }>();
  for (const { entry, id } of candidates) {
    const rival = winners.get(id);
    const known = entry.known !== null;
    if (
      rival === undefined ||
      (known && !rival.known) ||
      (known === rival.known && entry.apiModel < rival.apiModel)
    ) {
      winners.set(id, { apiModel: entry.apiModel, known });
    }
  }

  const models: ModelDefinition[] = [];

  for (const { entry, id } of candidates) {
    const { apiModel, declaradas, known } = entry;
    // el nombre es unico entre las entradas, asi que esto identifica a una sola
    if (winners.get(id)?.apiModel !== apiModel) {
      skipped.push({ apiModel, reason: 'duplicate-id' });
      continue;
    }
    try {
      if (known !== null) {
        // lo declarado se SUMA a la ficha escrita a mano en vez de
        // sustituirla: la pasarela sabe lo que sirve hoy, y la ficha lleva lo
        // que hemos comprobado nosotros. Ninguna de las dos sobra
        const modelo =
          declaradas.length === 0
            ? known
            : modelDefinitionSchema.parse({
                ...known,
                capabilities: [...new Set([...known.capabilities, ...declaradas])].sort(),
              });
        models.push(modelo);
        continue;
      }

      models.push(buildServedModel({ id, apiModel, connectionId, declaradas, familyOverride }));
    } catch {
      // ultima red: cualquier cosa que el esquema no acepte cuesta un modelo,
      // nunca la pantalla. El motivo exacto no se puede sacar del error sin
      // volcar su traza, y una traza no es un aviso para el usuario
      skipped.push({ apiModel, reason: 'invalid-definition' });
    }
  }

  return { models, skipped };
}

/**
 * Convierte la última lectura real en el catálogo operativo. Los modelos ya
 * conocidos conservan su contrato; los nuevos reciben la categoría más segura
 * que permiten sus identificadores, sin herramientas ni capacidades inventadas.
 */
export function buildCatalogForConnection(
  connectionId: string,
  servedModels: readonly ServedModel[],
  familyOverride?: string,
): ModelDefinition[] {
  return buildCatalogReport(connectionId, servedModels, familyOverride).models;
}

/**
 * junta los catalogos de VARIOS origenes en una lista con ids unicas.
 *
 * POR QUE EXISTE: `buildCatalogReport` garantiza ids unicas dentro de un
 * origen y no puede hacer mas, porque no ve a los demas. Daniel tiene cuatro
 * conexiones a AI Horde apuntando a la MISMA pasarela, asi que `/v1/models` les
 * devuelve los mismos 27 nombres y las cuatro derivan las mismas 27 ids. Quien
 * las juntaba se quedaba con la primera de cada id y tiraba el resto; como
 * `modelsForProvider` empareja por `connectionId`, tres de las cuatro
 * conexiones se quedaban con el desplegable vacio sin una palabra que lo
 * explicara —el mismo sintoma que ya costo el selector de Groq—.
 *
 * Lo que NO se hace es descartar: la segunda conexion que reclama una id recibe
 * una derivada de SU origen y su nombre. Asi la primera conserva la id de
 * siempre —incluidas las del catalogo de fabrica, que llevan los alias de
 * telegram— y los catalogos ya guardados siguen valiendo.
 *
 * «La primera» es el orden de la configuracion, que lo pone el usuario y no
 * cambia solo; lo que un tercero reordene no mueve ninguna id.
 */
export function mergeCatalogs(models: readonly ModelDefinition[]): ModelDefinition[] {
  if (!Array.isArray(models)) return [];

  const merged: ModelDefinition[] = [];
  const taken = new Set<string>();
  const vistos = new Set<string>();

  for (const model of models) {
    // el MISMO origen sirviendo dos veces la misma id si es una entrada de
    // sobra: no hay nada que distinguir, y renombrarla inventaria un modelo
    const propio = `${model.connectionId}/${model.id}`;
    if (vistos.has(propio)) continue;
    vistos.add(propio);

    if (!taken.has(model.id)) {
      taken.add(model.id);
      merged.push(model);
      continue;
    }

    // el origen entra en el sufijo: dos pasarelas distintas que sirven el mismo
    // nombre son dos ejecuciones distintas y hay que poder elegir cual
    const id = disambiguatedId(model.id, `${model.connectionId}/${model.apiModel}`);
    // solo con una colision de FNV, y aqui si se prefiere perder la fila a
    // repetir una id: quien consume la usa como clave de React y como valor de
    // un desplegable, donde repetida deja de identificar un modelo
    if (taken.has(id)) continue;
    taken.add(id);
    merged.push({ ...model, id });
  }

  return merged;
}

/** un modelo que no esta en el catalogo de fabrica: todo se deduce del nombre */
function buildServedModel(input: {
  id: string;
  apiModel: string;
  connectionId: string;
  declaradas: readonly ModelCapability[];
  familyOverride: string | undefined;
}): ModelDefinition {
  const { id, apiModel, connectionId, declaradas, familyOverride } = input;
  const lower = apiModel.toLowerCase();
  const guessed = lower.includes('qwen')
    ? 'qwen'
    : lower.includes('glm')
      ? 'glm'
      : lower.includes('deepseek')
        ? 'deepseek'
        : lower.includes('kimi')
          ? 'kimi'
          : lower.includes('kat')
            ? 'kat'
            : lower.includes('minimax')
              ? 'minimax'
              : lower.includes('sensenova')
                ? 'sensenova'
                : lower.startsWith('stepaudio')
                  ? 'stepaudio'
                  : lower.startsWith('step-image')
                    ? 'stepimage'
                    : lower.startsWith('step')
                      ? 'step'
                      : lower === 'auto' || lower.includes('router')
                        ? 'router'
                        : MISTRAL_NAMES.some((parte) => lower.includes(parte))
                          ? 'mistral'
                          : 'other';
  // la categoria se sigue deduciendo del nombre aunque la familia venga
  // impuesta: un proveedor puede servir texto, audio e imagen a la vez
  // el override solo vale si es una familia REAL. Un proveedor HTTP puede
  // llamarse como quiera, y meter su identificador tal cual en el esquema
  // haria saltar el enum y tumbar el catalogo entero por una errata: se
  // prefiere agrupar peor a no tener catalogo
  const family =
    familyOverride !== undefined && (MODEL_FAMILIES as readonly string[]).includes(familyOverride)
      ? familyOverride
      : guessed;
  const category =
    guessed === 'router'
      ? 'routing'
      : guessed === 'stepaudio' || isAudioModel(apiModel)
        ? 'audio'
        : guessed === 'stepimage'
          ? 'image'
          : 'text';

  return modelDefinitionSchema.parse({
    id,
    apiModel,
    // el nombre visible SI se puede recortar —solo se lee— y el del esquema
    // tiene tope propio. El `apiModel` de al lado sigue entero: es el que viaja
    displayName:
      apiModel.length <= DISPLAY_NAME_MAX
        ? apiModel
        : apiModel.slice(0, DISPLAY_NAME_MAX - NAME_TRIM_MARK.length) + NAME_TRIM_MARK,
    family,
    connectionId,
    category,
    capabilities:
      // lo que la pasarela declara se añade a la lectura del nombre: sin
      // ella no habia forma de saber cual acepta imagenes, y con ella no
      // hace falta adivinarlo
      [
        ...new Set([
          ...(category === 'text'
            ? ['text']
            : category === 'routing'
              ? ['routing', 'model_selection']
              : []),
          ...declaradas,
        ]),
      ].sort(),
    telegramAliases: [],
    enabled: category !== 'routing',
    supportsStreaming: category === 'text',
    metadata: {
      contractVerified: false,
      note: `servido por la conexion; capacidades pendientes (${apiModel})`,
    },
  });
}

/**
 * el nombre del modelo, sin el vendor que lleve delante.
 *
 * Groq sirve `canopylabs/orpheus-v1-english` y `meta-llama/llama-prompt-guard-2-86m`:
 * mirar el principio de la cadena no vale, porque lo que dice que es el modelo
 * viene DESPUES de la ultima barra.
 */
function modelBaseName(apiModel: string): string {
  const lower = apiModel.toLowerCase();
  return lower.slice(lower.lastIndexOf('/') + 1);
}

/**
 * hace audio, no conversacion.
 *
 * Comprobado contra el catalogo real de Groq: `whisper-large-v3`,
 * `whisper-large-v3-turbo`, `canopylabs/orpheus-v1-english` y
 * `canopylabs/orpheus-arabic-saudi`. Los cuatro caian en `text` y se ofrecian
 * como candidatos para describir una imagen, y elegir uno gasta una llamada que
 * no puede funcionar.
 */
export function isAudioModel(apiModel: string): boolean {
  const nombre = modelBaseName(apiModel);
  return (
    nombre.startsWith('whisper') ||
    nombre.startsWith('orpheus') ||
    nombre.startsWith('tts-') ||
    nombre.endsWith('-tts')
  );
}

/**
 * es un clasificador, no alguien con quien se pueda hablar.
 *
 * Groq sirve tres: `openai/gpt-oss-safeguard-20b` y los dos
 * `meta-llama/llama-prompt-guard-2-*`. Entran texto y sale una etiqueta, asi
 * que su categoria SI es `text` y decir otra cosa seria mentir. Lo que no son
 * es conversacionales, y esa es una pregunta distinta de la categoria: por eso
 * se responde aparte y no forzando el enum.
 */
export function isClassifierModel(apiModel: string): boolean {
  const nombre = modelBaseName(apiModel);
  return nombre.includes('prompt-guard') || nombre.includes('safeguard') || nombre.includes('guard-');
}

/**
 * se puede elegir para hablar o para mirar una imagen.
 *
 * Es lo que de verdad pregunta un selector de modelo, y no coincide con la
 * categoria: un clasificador es `text` y no sirve. Vive aqui, junto a las dos
 * heuristicas que lo alimentan, para que no acaben tres listas separadas como
 * paso con las extensiones de archivo (`D-074`).
 */
export function isConversationalModel(model: { apiModel: string; category: string }): boolean {
  if (model.category !== 'text') return false;
  return !isClassifierModel(model.apiModel);
}
