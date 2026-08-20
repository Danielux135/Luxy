// modelo de datos del catalogo de modelos y de las conexiones de API.
//
// separa tres conceptos que hasta ahora estaban colapsados en PROVIDER_IDS:
//
//   conexion  -> un endpoint con su clave y su dialecto (api.hcnsec.cn/v1)
//   modelo    -> un apiModel concreto servido por esa conexion
//   alias     -> el comando de telegram con el que lo pides
//
// una conexion sirve muchos modelos, y un modelo puede tener varios alias.
import { z } from 'zod';

// -----------------------------------------------------------------------------
// conexiones
// -----------------------------------------------------------------------------

/** dialectos de API soportados. no se inventa ninguno: se añaden al implementarlos */
export const CONNECTION_PROTOCOLS = ['openai'] as const;
export type ConnectionProtocol = (typeof CONNECTION_PROTOCOLS)[number];

/**
 * perfil de conexion.
 *
 * NUNCA contiene la clave. la clave vive cifrada en secrets.enc bajo la misma
 * id de conexion, y el renderer solo llega a saber si esta configurada o no.
 */
export const connectionProfileSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'la id de conexion admite minusculas, digitos y guion'),
  displayName: z.string().min(1).max(64),
  baseUrl: z.string().url(),
  protocol: z.enum(CONNECTION_PROTOCOLS).default('openai'),
  /** cabeceras adicionales; nunca se aceptan aqui cabeceras de autorizacion */
  headers: z.record(z.string().max(64), z.string().max(512)).default({}),
  timeoutMs: z.number().int().min(1000).max(3_600_000).default(120_000),
  enabled: z.boolean().default(true),
});

export type ConnectionProfile = z.infer<typeof connectionProfileSchema>;

/** estado observado de una conexion. no se persiste: se recalcula */
export const connectionStatusSchema = z.object({
  connectionId: z.string(),
  /** hay clave guardada en secrets.enc */
  hasApiKey: z.boolean(),
  reachable: z.boolean().nullable(),
  checkedAt: z.string().nullable(),
  /** apiModel que la conexion declara servir, tal cual los devuelve /v1/models */
  availableModels: z.array(z.string()),
  error: z.string().nullable(),
});

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

// -----------------------------------------------------------------------------
// modelos
// -----------------------------------------------------------------------------

export const MODEL_CATEGORIES = ['text', 'audio', 'image', 'routing'] as const;
export type ModelCategory = (typeof MODEL_CATEGORIES)[number];

/**
 * capacidades. son valores iniciales editables por el usuario: no se afirma que
 * un modelo tenga una capacidad concreta sin haberla comprobado.
 */
export const MODEL_CAPABILITIES = [
  // texto y codigo
  'text',
  'reasoning',
  'coding',
  'long_context',
  'fast',
  'agent_tools',
  'documentation',
  'log_analysis',
  // audio
  'audio_chat',
  'audio_input',
  'audio_output',
  'transcription',
  'realtime_audio',
  'desktop_voice',
  'text_to_speech',
  // imagen
  'image_input',
  'image_edit',
  'image_output',
  // enrutado
  'routing',
  'model_selection',
] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

/** familias, para agrupar en la interfaz y resolver el alias sin version */
export const MODEL_FAMILIES = [
  'deepseek',
  'glm',
  'hunyuan',
  'kat',
  'kimi',
  'minimax',
  'other',
  'qwen',
  'sensenova',
  'step',
  'stepaudio',
  'stepimage',
  'router',
] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/** herramientas del ejecutor local. la shell arbitraria no esta y no es un olvido */
export const AGENT_TOOL_NAMES = [
  'list_files',
  'read_file',
  'search_files',
  'search_text',
  'write_file',
  'apply_patch',
  'delete_file',
  'git_status',
  'git_diff',
  'run_tests',
  'run_lint',
  'run_build',
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/** herramientas de solo lectura: seguras aunque el proyecto no permita edicion */
export const READ_ONLY_TOOLS: readonly AgentToolName[] = [
  'list_files',
  'read_file',
  'search_files',
  'search_text',
  'git_status',
  'git_diff',
];

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  baseDelayMs: z.number().int().min(100).max(60_000).default(2000),
  maxDelayMs: z.number().int().min(100).max(300_000).default(20_000),
});

/**
 * limites por modelo. son el techo duro del bucle agentic: cuando se alcanza
 * uno, el trabajo termina con explicacion en vez de seguir gastando.
 */
export const modelLimitsSchema = z.object({
  maxToolSteps: z.number().int().min(1).max(200).default(40),
  maxApiCalls: z.number().int().min(1).max(200).default(50),
  maxFilesRead: z.number().int().min(1).max(2000).default(200),
  maxBytesRead: z.number().int().min(1024).max(200_000_000).default(20_000_000),
  maxFilesChanged: z.number().int().min(0).max(1000).default(60),
  maxCommandDurationMs: z.number().int().min(1000).max(3_600_000).default(600_000),
  maxTotalDurationMs: z.number().int().min(1000).max(21_600_000).default(3_600_000),
  /** limite de gasto diario en la moneda del proveedor. 0 = sin limite */
  dailyBudget: z.number().min(0).default(0),
  retryPolicy: retryPolicySchema.default({}),
});

export type ModelLimits = z.infer<typeof modelLimitsSchema>;

export const modelDefinitionSchema = z.object({
  /** id interno estable: sobrevive a cambios de apiModel y de nombre visible */
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      'la id de modelo admite minusculas, digitos, punto, guion y guion bajo',
    ),
  /**
   * identificador EXACTO que espera la API. no se normaliza, no se pasa a
   * minusculas y no se le tocan puntos ni guiones.
   */
  apiModel: z.string().min(1).max(128),
  displayName: z.string().min(1).max(64),
  family: z.enum(MODEL_FAMILIES),
  connectionId: z.string().min(1).max(32),
  category: z.enum(MODEL_CATEGORIES),
  capabilities: z.array(z.enum(MODEL_CAPABILITIES)).max(24).default([]),
  /** comandos de telegram, siempre en minusculas y con guion bajo, sin la barra */
  telegramAliases: z
    .array(
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9_]*$/, 'un alias solo admite minusculas, digitos y guion bajo'),
    )
    .max(8)
    .default([]),
  enabled: z.boolean().default(true),
  /** resuelve el alias sin version de la familia (/deepseek, /kat, /step...) */
  defaultForFamily: z.boolean().default(false),
  /** puede usar el ejecutor de herramientas local */
  agentic: z.boolean().default(false),
  supportsStreaming: z.boolean().default(true),
  /**
   * si el endpoint acepta tool calling nativo de OpenAI. null = sin comprobar,
   * y en ese caso el bucle usa el protocolo JSON de Luxy como fallback.
   */
  supportsNativeTools: z.boolean().nullable().default(null),
  maxOutputTokens: z.number().int().min(256).max(200_000).default(8192),
  limits: modelLimitsSchema.default({}),
  allowedTools: z.array(z.enum(AGENT_TOOL_NAMES)).max(32).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;

/** un modelo junto con lo que se sabe de su disponibilidad real */
export interface ResolvedModel {
  definition: ModelDefinition;
  /** la conexion existe y esta habilitada */
  connectionEnabled: boolean;
  /** hay clave guardada para su conexion */
  hasApiKey: boolean;
  /**
   * la conexion confirmo que sirve este apiModel.
   * null = todavia no se ha sincronizado con /v1/models.
   */
  servedByConnection: boolean | null;
  /** utilizable ahora mismo para un trabajo */
  usable: boolean;
  /** por que no es utilizable, para poder decirselo al usuario */
  unavailableReason: string | null;
}
