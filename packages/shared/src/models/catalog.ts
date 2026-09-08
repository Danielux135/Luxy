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

export function buildCatalogForConnection(
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
): ModelDefinition[] {
  const knownByApiModel = new Map(
    buildDefaultCatalog(connectionId).map((model) => [model.apiModel, model]),
  );

  return servedModels.map((servido) => {
    const apiModel = typeof servido === 'string' ? servido : servido.apiModel;
    // lo que la pasarela declara se cree; lo que no declara no se inventa
    const declaradas = mapDeclaredCapabilities(
      typeof servido === 'string' ? [] : (servido.declaredCapabilities ?? []),
    );
    const known = knownByApiModel.get(apiModel);
    // con familia impuesta no vale el catalogo de fabrica: ese modelo puede
    // existir con el mismo nombre en otra conexion y con otra familia
    if (known !== undefined && familyOverride === undefined) {
      // lo declarado se SUMA a la ficha escrita a mano en vez de sustituirla:
      // la pasarela sabe lo que sirve hoy, y la ficha lleva lo que hemos
      // comprobado nosotros. Ninguna de las dos sobra
      if (declaradas.length === 0) return known;
      return modelDefinitionSchema.parse({
        ...known,
        capabilities: [...new Set([...known.capabilities, ...declaradas])].sort(),
      });
    }

    const lower = apiModel.toLowerCase();
    const guessed =
      lower.includes('qwen')
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
    const safeId = lower.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-');

    return modelDefinitionSchema.parse({
      id: safeId.length === 0 ? `model-${servedModels.indexOf(apiModel)}` : safeId,
      apiModel,
      displayName: apiModel,
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
