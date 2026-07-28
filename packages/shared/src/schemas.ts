// esquemas zod: toda entrada externa (telegram, agente, configuracion) se valida aqui
import { z } from 'zod';
import {
  JOB_STATUSES,
  PROVIDER_IDS,
  JOB_EVENT_TYPES,
  APPROVAL_ACTIONS,
  MAX_PROMPT_LENGTH,
} from './constants.js';
import { connectionProfileSchema } from './models/types.js';

export const jobStatusSchema = z.enum(JOB_STATUSES);
export const providerIdSchema = z.enum(PROVIDER_IDS);
export const jobEventTypeSchema = z.enum(JOB_EVENT_TYPES);
export const approvalActionSchema = z.enum(APPROVAL_ACTIONS);
export const projectTypeSchema = z.enum(['node', 'flutter', 'python', 'other']);

// un alias de proyecto es corto y sin separadores de ruta, para evitar traversal
export const projectAliasSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'el alias solo admite minusculas, digitos, punto, guion y guion bajo');

// nombre de maquina configurable: nunca esta codificado en el repositorio
export const machineNameSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'el nombre de maquina admite minusculas, digitos y guion');

export const promptSchema = z.string().min(1).max(MAX_PROMPT_LENGTH);

export const toolPresenceSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
});

export const machineCapabilitiesSchema = z.object({
  git: toolPresenceSchema,
  node: toolPresenceSchema,
  npm: toolPresenceSchema,
  claude: toolPresenceSchema,
  codex: toolPresenceSchema,
  flutter: toolPresenceSchema,
  httpProviders: z.array(z.string().max(32)).max(64),
});

// -----------------------------------------------------------------------------
// contratos de la api privada gateway <-> agente
// -----------------------------------------------------------------------------

export const machineRegisterRequestSchema = z.object({
  registrationSecret: z.string().min(8).max(512),
  name: machineNameSchema,
  hostname: z.string().min(1).max(128),
  platform: z.string().min(1).max(64),
  platformVersion: z.string().max(64),
  agentVersion: z.string().max(32),
  capabilities: machineCapabilitiesSchema,
  projects: z.array(projectAliasSchema).max(64),
});

export const machineRegisterResponseSchema = z.object({
  machineId: z.string().uuid(),
  machineToken: z.string().min(32),
  name: machineNameSchema,
});

export const heartbeatRequestSchema = z.object({
  capabilities: machineCapabilitiesSchema.optional(),
  projects: z.array(projectAliasSchema).max(64).optional(),
  activeJobId: z.string().uuid().nullable().optional(),
  agentVersion: z.string().max(32).optional(),
});

export const heartbeatResponseSchema = z.object({
  ok: z.literal(true),
  serverTime: z.string(),
  offlineAfterSeconds: z.number().int().positive(),
});

export const claimRequestSchema = z.object({
  // proveedores que esta maquina puede ejecutar ahora mismo
  // el tope de 16 se quedaba corto con un catalogo de modelos configurable:
  // una maquina puede anunciar muchas familias a la vez
  supportedProviders: z.array(providerIdSchema).max(64),
  // alias de proyecto configurados en esta maquina
  projects: z.array(projectAliasSchema).max(64),
  leaseSeconds: z.number().int().min(30).max(3600).optional(),
});

export const claimedJobSchema = z.object({
  id: z.string().uuid(),
  shortId: z.string(),
  provider: providerIdSchema,
  projectAlias: projectAliasSchema,
  prompt: z.string(),
  telegramChatId: z.number().int(),
  telegramUserId: z.number().int(),
  leaseExpiresAt: z.string(),
  metadata: z.record(z.unknown()).default({}),
});

export const claimResponseSchema = z.object({
  job: claimedJobSchema.nullable(),
});

export const jobEventInputSchema = z.object({
  sequence: z.number().int().min(0),
  type: jobEventTypeSchema,
  message: z.string().max(4000),
  metadata: z.record(z.unknown()).optional(),
  // marca temporal del agente, para eventos encolados y reenviados mas tarde
  clientCreatedAt: z.string().optional(),
});

export const jobEventsRequestSchema = z.object({
  events: z.array(jobEventInputSchema).min(1).max(50),
  // renovar el lease al mismo tiempo que se envian eventos
  renewLeaseSeconds: z.number().int().min(30).max(3600).optional(),
});

export const testRunResultSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().min(0),
  timedOut: z.boolean(),
  stdoutTail: z.string().max(8000),
  stderrTail: z.string().max(8000),
  passed: z.boolean(),
});

export const jobCompleteRequestSchema = z.object({
  summary: z.string().max(4000),
  filesChanged: z.number().int().min(0),
  testsPassed: z.number().int().min(0),
  testsFailed: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  diffStat: z.string().max(8000).nullable(),
  branch: z.string().max(256).nullable(),
  worktreePath: z.string().max(1024).nullable(),
  sessionId: z.string().max(128).nullable(),
  testLogs: z.array(testRunResultSchema).max(20).default([]),
  usage: z
    .object({
      provider: z.string(),
      model: z.string(),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      estimatedCost: z.number().min(0),
    })
    .optional(),
});

export const jobFailRequestSchema = z.object({
  errorMessage: z.string().max(4000),
  // si el trabajo dejo cambios locales, no debe reasignarse a otra maquina
  hasLocalChanges: z.boolean().default(false),
  worktreePath: z.string().max(1024).nullable().default(null),
  durationMs: z.number().int().min(0).default(0),
});

export const jobCancelledRequestSchema = z.object({
  // ficheros que quedaron modificados: la cancelacion nunca los borra
  modifiedFiles: z.array(z.string().max(512)).max(200).default([]),
  worktreePath: z.string().max(1024).nullable().default(null),
  durationMs: z.number().int().min(0).default(0),
});

export const jobControlResponseSchema = z.object({
  status: jobStatusSchema,
  cancelRequested: z.boolean(),
  leaseExpiresAt: z.string().nullable(),
});

export const approvalResolveRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
});

/**
 * aprobacion pendiente que el agente debe ejecutar.
 *
 * el gateway solo devuelve las de trabajos reclamados por esa maquina, y el
 * agente vuelve a comprobar las politicas del proyecto antes de hacer nada:
 * que el gateway la envie no significa que se pueda ejecutar.
 */
export const pendingApprovalSchema = z.object({
  approvalId: z.string(),
  jobId: z.string(),
  shortId: z.string(),
  action: approvalActionSchema,
  projectAlias: projectAliasSchema,
  worktreePath: z.string().max(1024),
  branch: z.string().max(256),
  message: z.string().max(500).nullable().default(null),
  /** el usuario confirmo dos veces; imprescindible para el push */
  confirmedTwice: z.boolean().default(false),
  requestedBy: z.string().max(64).default(''),
});

export const pendingApprovalsResponseSchema = z.object({
  approvals: z.array(pendingApprovalSchema).max(20),
});

export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

// -----------------------------------------------------------------------------
// configuracion local de la maquina (%APPDATA%\Luxy\config.json)
// -----------------------------------------------------------------------------

// un comando de comprobacion nunca es una cadena para el shell:
// siempre es ejecutable + lista de argumentos separados
export const testCommandSchema = z.tuple([
  z.string().min(1).max(128),
  z.array(z.string().max(512)).max(32),
]);

export const projectConfigSchema = z.object({
  path: z.string().min(1),
  type: projectTypeSchema.default('other'),
  testCommands: z.array(testCommandSchema).max(10).default([]),
  // tiempo maximo por comando de comprobacion
  testTimeoutMs: z.number().int().min(1000).max(3_600_000).default(600_000),
  // permitir tareas que modifican archivos (requiere que sea repo git)
  allowEdits: z.boolean().default(true),
  // permitir commit tras aprobacion explicita
  allowCommit: z.boolean().default(true),
  // el push esta deshabilitado por defecto y ademas exige doble confirmacion
  allowPush: z.boolean().default(false),
});

export const httpProviderConfigSchema = z.object({
  id: z.string().min(1).max(32),
  displayName: z.string().min(1).max(64),
  baseUrl: z.string().url(),
  model: z.string().min(1).max(128),
  apiKeyEnv: z.string().min(1).max(64),
  enabled: z.boolean().default(false),
  supportsStreaming: z.boolean().default(true),
  maxOutputTokens: z.number().int().min(256).max(200_000).default(8192),
  dailyBudget: z.number().min(0).default(0),
});

export const agentConfigSchema = z.object({
  machineName: machineNameSchema,
  gatewayUrl: z.string().url(),
  // el token que necesita el agente en ejecucion. en el archivo de disco es
  // opcional (ver storedAgentConfigSchema): Luxy Desktop lo guarda cifrado.
  machineToken: z.string().min(16),
  machineId: z.string().uuid().optional(),
  pollIntervalMs: z.number().int().min(500).max(60_000).default(2000),
  heartbeatIntervalMs: z.number().int().min(2000).max(120_000).default(10_000),
  maxConcurrentJobs: z.number().int().min(1).max(4).default(1),
  jobTimeoutMs: z.number().int().min(60_000).max(21_600_000).default(3_600_000),
  leaseSeconds: z.number().int().min(30).max(3600).default(120),
  projects: z.record(projectAliasSchema, projectConfigSchema).default({}),
  /** perfiles de conexion de API; las claves viven aparte, cifradas */
  connections: z.array(connectionProfileSchema).max(16).default([]),
  providers: z
    .object({
      claude: z
        .object({
          enabled: z.boolean().default(true),
          model: z.string().max(64).default('opus'),
        })
        .default({ enabled: true, model: 'opus' }),
      codex: z
        .object({
          enabled: z.boolean().default(true),
          model: z.string().max(64).optional(),
        })
        .default({ enabled: true }),
      http: z.array(httpProviderConfigSchema).default([]),
    })
    .default({ claude: { enabled: true, model: 'opus' }, codex: { enabled: true }, http: [] }),
  ui: z
    .object({
      enabled: z.boolean().default(false),
      // la interfaz local solo escucha en loopback, nunca en la red
      host: z.literal('127.0.0.1').default('127.0.0.1'),
      port: z.number().int().min(1024).max(65535).default(4319),
    })
    .default({ enabled: false, host: '127.0.0.1', port: 4319 }),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * la configuracion tal y como vive en config.json.
 *
 * el machineToken es OPCIONAL aqui a proposito: Luxy Desktop lo guarda cifrado
 * en secrets.enc y lo borra del archivo en claro. agentConfigSchema sigue
 * exigiendolo porque el agente en ejecucion no puede funcionar sin el; la pieza
 * que une ambos mundos es resolveStoredConfig().
 *
 * config.json NO debe contener ninguna otra clave, nunca.
 */
export const storedAgentConfigSchema = agentConfigSchema.extend({
  machineToken: z.string().min(16).optional(),
});

export type StoredAgentConfig = z.infer<typeof storedAgentConfigSchema>;

/** une la configuracion del disco con el token recuperado del almacen cifrado */
export function resolveStoredConfig(
  stored: StoredAgentConfig,
  machineToken: string | undefined,
): AgentConfig | null {
  const token = stored.machineToken ?? machineToken;
  if (token === undefined || token.length < 16) return null;
  return agentConfigSchema.parse({ ...stored, machineToken: token });
}

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type TestCommand = z.infer<typeof testCommandSchema>;
export type MachineRegisterRequest = z.infer<typeof machineRegisterRequestSchema>;
export type MachineRegisterResponse = z.infer<typeof machineRegisterResponseSchema>;
export type ClaimRequest = z.infer<typeof claimRequestSchema>;
export type ClaimedJob = z.infer<typeof claimedJobSchema>;
export type JobEventInput = z.infer<typeof jobEventInputSchema>;
export type JobCompleteRequest = z.infer<typeof jobCompleteRequestSchema>;
export type JobFailRequest = z.infer<typeof jobFailRequestSchema>;
export type JobCancelledRequest = z.infer<typeof jobCancelledRequestSchema>;

// -----------------------------------------------------------------------------
// telegram: solo los campos que luxy necesita, el resto se descarta
// -----------------------------------------------------------------------------

export const telegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
});

export const telegramChatSchema = z.object({
  id: z.number().int(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
  title: z.string().optional(),
});

export const telegramMessageEntitySchema = z.object({
  type: z.string(),
  offset: z.number().int().min(0),
  length: z.number().int().min(0),
});

export const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  date: z.number().int().optional(),
  text: z.string().optional(),
  entities: z.array(telegramMessageEntitySchema).optional(),
  reply_to_message: z
    .object({
      message_id: z.number().int(),
      from: telegramUserSchema.optional(),
      text: z.string().optional(),
    })
    .optional(),
});

export const telegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: telegramUserSchema,
  data: z.string().max(64).optional(),
  message: telegramMessageSchema.optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: telegramMessageSchema.optional(),
  edited_message: telegramMessageSchema.optional(),
  callback_query: telegramCallbackQuerySchema.optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
