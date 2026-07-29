// catalogo inicial de modelos.
//
// PROCEDENCIA: la lista se verifico contra GET /v1/models de la conexion el
// 2026-07-28. Solo contiene modelos que la conexion sirve de verdad. Cuatro
// modelos de la especificacion original (kat-coder-pro-v2, MiniMax-M2.7,
// sensenova-6.7-flash-lite y sensenova-u1-fast) no los sirve esta conexion y por
// eso no estan aqui. Se volveran a añadir cuando alguna conexion los ofrezca.
//
// El campo apiModel es EXACTO: no se normaliza ni se corrigen mayusculas.
import {
  AGENT_TOOL_NAMES,
  connectionProfileSchema,
  modelDefinitionSchema,
  type ConnectionProfile,
  type ModelDefinition,
} from './types.js';

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
 * medido el 2026-07-28: glm-5.2 ~120 s y MiniMax-M3 ~150-240 s para una
 * peticion trivial. No estan caidos; hay que darles margen. Una primera
 * comprobacion con 45 s los dio por muertos, que era un error de la medida.
 */
const TOOLS_OK_SLOW = {
  contractVerified: true,
  toolCallingCheckedAt: '2026-07-28',
  slowResponse: true,
} as const;

/**
 * la cuenta no tiene acceso a este modelo.
 * comprobado dos veces el 2026-07-28: HTTP 400 en menos de 1 s, no es lentitud.
 */
const NO_ACCESS = {
  contractVerified: false,
  note: 'la conexion rechazo el acceso el 2026-07-28',
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
    id: 'glm-5.2',
    supportsNativeTools: true,
    // tarda unos 120 s en responder: es lento, no esta caido
    metadata: { ...TOOLS_OK_SLOW, observedLatencyMs: 120_000 },
    apiModel: 'glm-5.2',
    displayName: 'GLM 5.2',
    family: 'glm',
    category: 'text',
    capabilities: ['text', 'reasoning', 'coding', 'agent_tools'],
    telegramAliases: ['glm', 'glm_52'],
    defaultForFamily: true,
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'glm-5.1',
    supportsNativeTools: true,
    metadata: TOOLS_OK,
    apiModel: 'glm-5.1',
    displayName: 'GLM 5.1',
    family: 'glm',
    category: 'text',
    capabilities: ['text', 'coding', 'agent_tools'],
    telegramAliases: ['glm_51'],
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'kat-coder-pro-v2.5',
    metadata: NO_ACCESS,
    apiModel: 'kat-coder-pro-v2.5',
    displayName: 'KAT Coder Pro v2.5',
    family: 'kat',
    category: 'text',
    capabilities: ['text', 'coding', 'agent_tools'],
    telegramAliases: ['kat', 'kat_v25'],
    defaultForFamily: true,
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'kimi-k2.6',
    supportsNativeTools: true,
    metadata: TOOLS_OK,
    apiModel: 'Kimi-K2.6',
    displayName: 'Kimi K2.6',
    family: 'kimi',
    category: 'text',
    capabilities: ['text', 'reasoning', 'coding', 'long_context', 'agent_tools'],
    telegramAliases: ['kimi', 'kimi_k26'],
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
    id: 'qwen3.5-397b-a17b',
    supportsNativeTools: true,
    metadata: TOOLS_OK,
    apiModel: 'Qwen3.5-397B-A17B',
    displayName: 'Qwen3.5 397B A17B',
    family: 'qwen',
    category: 'text',
    capabilities: ['text', 'reasoning', 'coding', 'long_context', 'agent_tools'],
    telegramAliases: ['qwen', 'qwen_397b'],
    defaultForFamily: true,
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'qwen3.6-35b-a3b',
    supportsNativeTools: true,
    metadata: TOOLS_OK,
    apiModel: 'Qwen3.6-35B-A3B',
    displayName: 'Qwen3.6 35B A3B',
    family: 'qwen',
    category: 'text',
    capabilities: ['text', 'coding', 'fast', 'agent_tools'],
    telegramAliases: ['qwen_35b', 'qwen_36'],
    agentic: true,
    allowedTools: ALL_TOOLS,
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
    id: 'step-3.5-flash',
    // comprobado: no devuelve tool_calls, emite <tool_call> en el texto
    supportsNativeTools: false,
    metadata: { contractVerified: true, toolCallingCheckedAt: '2026-07-28', toolStyle: 'xml' },
    apiModel: 'step-3.5-flash',
    displayName: 'Step 3.5 Flash',
    family: 'step',
    category: 'text',
    capabilities: ['text', 'fast', 'documentation'],
    telegramAliases: ['step_35'],
    agentic: true,
    allowedTools: ALL_TOOLS,
  },
  {
    id: 'step-3.5-flash-2603',
    supportsNativeTools: true,
    metadata: TOOLS_OK,
    apiModel: 'step-3.5-flash-2603',
    displayName: 'Step 3.5 Flash 2603',
    family: 'step',
    category: 'text',
    capabilities: ['text', 'fast', 'documentation'],
    telegramAliases: ['step_35_2603'],
    agentic: true,
    allowedTools: ALL_TOOLS,
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
