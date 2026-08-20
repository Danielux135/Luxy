// contrato IPC entre el proceso principal, el preload y el renderer.
//
// REGLA INNEGOCIABLE: por aqui no pasa ningun secreto hacia el renderer. React
// puede saber si una clave esta configurada, nunca cual es. Los canales son
// verbos cerrados (getStatus, startAgent), jamas algo como exec(comando).
//
// todo argumento que llega al main se valida con zod antes de tocar logica,
// igual que la entrada de telegram en el gateway.
import { z } from 'zod';
import {
  type agentEventSchema,
  agentHostStatusSchema,
  jobStatusSchema,
  studioJobActionRequestSchema,
  studioJobActionResponseSchema,
  studioJobCreateRequestSchema,
  studioJobFeedbackRequestSchema,
  studioJobFeedbackResponseSchema,
  studioJobResponseSchema,
  studioJobsResponseSchema,
  studioOptionsResponseSchema,
} from '@luxy/shared';

// las constantes de canal y de nombre de secreto viven en channels.ts porque
// las necesita el preload, que no puede cargar zod
export * from './channels.js';

// -----------------------------------------------------------------------------
// argumentos de entrada
// -----------------------------------------------------------------------------

export const emptyArgsSchema = z.undefined().or(z.null()).or(z.object({}).strict());

export const stopAgentArgsSchema = z.object({
  reason: z.string().min(1).max(200).default('peticion desde la interfaz'),
});

/**
 * abrir la carpeta de un artefacto.
 *
 * solo viaja el identificador del trabajo, nunca una ruta: la raiz la calcula
 * el proceso principal y el renderer no puede proponer donde mirar.
 */
export const artifactOpenFolderArgsSchema = z.object({
  jobId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, 'identificador de trabajo no valido'),
});

/** la ruta sigue validandose y confinándose en main antes de abrirse */
export const worktreeOpenFolderArgsSchema = z.object({
  worktreePath: z.string().min(1).max(1024),
});

export const logsTailArgsSchema = z.object({
  count: z.number().int().min(1).max(500).default(120),
});

export const pickFolderArgsSchema = z.object({
  title: z.string().min(1).max(120).default('Elige la carpeta del proyecto'),
});

// -----------------------------------------------------------------------------
// respuestas
// -----------------------------------------------------------------------------

/** envoltorio uniforme: el renderer nunca recibe una traza */
export const ipcFailureSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  hint: z.string().nullable(),
});

export function ipcOk<T extends z.ZodTypeAny>(value: T) {
  return z.object({ ok: z.literal(true), value });
}

export const appInfoSchema = z.object({
  appVersion: z.string(),
  electronVersion: z.string(),
  nodeVersion: z.string(),
  platform: z.string(),
  /** carpeta de logs, para el boton "abrir carpeta" */
  logsDirectory: z.string(),
  /** true si safeStorage puede cifrar en este equipo */
  encryptionAvailable: z.boolean(),
  /** huella del bundle del agente en marcha; null si no ha arrancado */
  agentBuild: z.string().nullable(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

export const logsTailResultSchema = z.object({ lines: z.array(z.string()) });

export const pickFolderResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().nullable(),
});

export const agentStatusResultSchema = agentHostStatusSchema;

// -----------------------------------------------------------------------------
// configuracion y secretos
// -----------------------------------------------------------------------------

/**
 * lo que el renderer llega a saber de los secretos: que nombres existen y si
 * estan configurados. NUNCA el valor.
 */
export const secretsSummarySchema = z.object({
  encryptionAvailable: z.boolean(),
  /** nombre del secreto -> configurado */
  configured: z.record(z.string(), z.boolean()),
});

export const configSummarySchema = z.object({
  configured: z.boolean(),
  configPath: z.string(),
  /** la configuracion del disco, siempre sin machineToken */
  config: z.unknown().nullable(),
  secrets: secretsSummarySchema,
});

export const configSaveArgsSchema = z.object({
  /** se valida con storedAgentConfigSchema en el proceso principal */
  config: z.unknown(),
});

/** nombres de secreto admitidos: evita que el renderer escriba claves sueltas */
export const secretNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^(machineToken|connection:[a-z0-9][a-z0-9-]*)$/, 'nombre de secreto no admitido');

export const secretSetArgsSchema = z.object({
  name: secretNameSchema,
  value: z.string().min(1).max(512),
});

export const secretDeleteArgsSchema = z.object({ name: secretNameSchema });

/** un secreto detectado en un archivo en claro; el valor jamas viaja */
export const detectedSecretSchema = z.object({
  name: z.string(),
  preview: z.string(),
  source: z.string(),
});

export const migrationScanResultSchema = z.object({
  candidates: z.array(z.object({ file: z.string(), secrets: z.array(detectedSecretSchema) })),
});

export const migrationImportArgsSchema = z.object({
  file: z.string().min(1).max(500),
  /** nombres a importar; el valor lo lee el proceso principal, no el renderer */
  names: z.array(z.string().min(1).max(80)).min(1).max(32),
  /** id de conexion a la que asociar la clave, si aplica */
  connectionId: z.string().max(32).nullable().default(null),
});

export const migrationDeleteFileArgsSchema = z.object({ file: z.string().min(1).max(500) });

// -----------------------------------------------------------------------------
// onboarding
// -----------------------------------------------------------------------------

export const toolPresenceSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
});

export const toolsDetectResultSchema = z.object({
  tools: z.record(z.string(), toolPresenceSchema),
});

export const gatewayCheckArgsSchema = z.object({
  gatewayUrl: z.string().url().max(300),
});

export const gatewayCheckResultSchema = z.object({
  reachable: z.boolean(),
  configured: z.boolean().nullable(),
  error: z.string().nullable(),
});

export const machineRegisterArgsSchema = z.object({
  gatewayUrl: z.string().url().max(300),
  machineName: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'el nombre admite minusculas, digitos y guion'),
  /** secreto de registro: se usa una vez y NO se guarda en ningun sitio */
  registrationSecret: z.string().min(8).max(200),
});

export const machineRegisterResultSchema = z.object({
  registered: z.boolean(),
  machineId: z.string().nullable(),
});

export const connectionTestArgsSchema = z
  .object({
    connectionId: z.string().min(1).max(32),
  })
  .strict();

export const connectionTestResultSchema = z.object({
  reachable: z.boolean(),
  /** apiModel que la conexion declara servir */
  models: z.array(z.string()),
  error: z.string().nullable(),
});

/**
 * refrescar el catalogo real de una conexion.
 *
 * igual que la prueba de conexion, el renderer solo manda el identificador: la
 * URL sale de la configuracion guardada y la clave nunca cruza el IPC.
 */
export const catalogRefreshArgsSchema = z.object({
  connectionId: z.string().min(1).max(64),
});

export const catalogModelSchema = z.object({
  apiModel: z.string(),
  ownedBy: z.string().nullable(),
  billing: z.enum(['token', 'call', 'unknown']),
  modelRatio: z.number().nullable(),
  completionRatio: z.number().nullable(),
  perCall: z.number().nullable(),
  groups: z.array(z.string()),
});

export const catalogSnapshotSchema = z.object({
  connectionId: z.string(),
  fetchedAt: z.string(),
  models: z.array(catalogModelSchema),
  pricingAvailable: z.boolean(),
  notice: z.string().nullable(),
  /** que contesto cada ruta de precios probada */
  pricingProbes: z
    .array(
      z.object({
        url: z.string(),
        status: z.number().nullable(),
        topLevelKeys: z.array(z.string()),
        entryCount: z.number(),
      }),
    )
    .optional(),
});

export const approvalResolveArgsSchema = z.object({
  jobId: z.string().min(1).max(64),
  shortId: z.string().min(1).max(32),
  action: z.enum(['commit', 'discard', 'push']),
  projectAlias: z.string().min(1).max(64),
  worktreePath: z.string().min(1).max(1024),
  branch: z.string().min(1).max(256),
  message: z.string().max(500).nullable().default(null),
  /** el push exige que la interfaz pida confirmacion DOS veces */
  confirmedTwice: z.boolean().default(false),
});

export const approvalResolveResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export const workspacePrepareArgsSchema = z.object({
  projectAlias: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(120),
});

export const workspaceResultSchema = z.object({
  projectAlias: z.string().min(1).max(64),
  path: z.string().min(1).max(1024),
  branch: z.string().min(1).max(256),
});
export const workspaceOpenArgsSchema = z.object({ path: z.string().min(1).max(1024) });

// -----------------------------------------------------------------------------
// Luxy Studio
// -----------------------------------------------------------------------------

export const studioJobCreateArgsSchema = studioJobCreateRequestSchema;
export const studioJobsListArgsSchema = z.object({
  targetMachineId: z.string().uuid().optional(),
  status: jobStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().min(0).max(100_000).optional(),
});
export const studioJobIdArgsSchema = z.object({ jobId: z.string().uuid() });
export const studioJobActionArgsSchema = studioJobActionRequestSchema.extend({
  jobId: z.string().uuid(),
});
export const studioJobFeedbackArgsSchema = studioJobFeedbackRequestSchema.extend({
  jobId: z.string().uuid(),
});

export const studioOptionsResultSchema = studioOptionsResponseSchema;
export const studioJobsListResultSchema = studioJobsResponseSchema;
export const studioJobResultSchema = studioJobResponseSchema;
export const studioJobActionResultSchema = studioJobActionResponseSchema;
export const studioJobFeedbackResultSchema = studioJobFeedbackResponseSchema;

// -----------------------------------------------------------------------------
// API que el preload expone en window.luxy
// -----------------------------------------------------------------------------

export type IpcResult<T> =
  { ok: true; value: T } | { ok: false; error: string; hint: string | null };

export interface LuxyBridge {
  getAppInfo(): Promise<IpcResult<AppInfo>>;
  getAgentStatus(): Promise<IpcResult<z.infer<typeof agentStatusResultSchema>>>;
  startAgent(): Promise<IpcResult<z.infer<typeof agentStatusResultSchema>>>;
  stopAgent(reason?: string): Promise<IpcResult<z.infer<typeof agentStatusResultSchema>>>;
  restartAgent(): Promise<IpcResult<z.infer<typeof agentStatusResultSchema>>>;
  tailLogs(count?: number): Promise<IpcResult<{ lines: string[] }>>;
  openLogsFolder(): Promise<IpcResult<{ opened: boolean }>>;
  openArtifactFolder(jobId: string): Promise<IpcResult<{ opened: boolean }>>;
  openWorktreeFolder(worktreePath: string): Promise<IpcResult<{ opened: boolean }>>;
  pickFolder(title?: string): Promise<IpcResult<{ canceled: boolean; path: string | null }>>;
  getConfig(): Promise<IpcResult<z.infer<typeof configSummarySchema>>>;
  saveConfig(config: unknown): Promise<IpcResult<z.infer<typeof configSummarySchema>>>;
  setSecret(name: string, value: string): Promise<IpcResult<z.infer<typeof secretsSummarySchema>>>;
  deleteSecret(name: string): Promise<IpcResult<z.infer<typeof secretsSummarySchema>>>;
  scanForSecrets(): Promise<IpcResult<z.infer<typeof migrationScanResultSchema>>>;
  importSecrets(
    file: string,
    names: string[],
    connectionId?: string | null,
  ): Promise<IpcResult<z.infer<typeof secretsSummarySchema>>>;
  deleteMigratedFile(file: string): Promise<IpcResult<{ deleted: boolean }>>;
  detectTools(): Promise<IpcResult<z.infer<typeof toolsDetectResultSchema>>>;
  checkGateway(gatewayUrl: string): Promise<IpcResult<z.infer<typeof gatewayCheckResultSchema>>>;
  registerMachine(
    args: z.infer<typeof machineRegisterArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof machineRegisterResultSchema>>>;
  testConnection(
    connectionId: string,
  ): Promise<IpcResult<z.infer<typeof connectionTestResultSchema>>>;
  refreshCatalog(connectionId: string): Promise<IpcResult<z.infer<typeof catalogSnapshotSchema>>>;
  readCatalog(
    connectionId: string,
  ): Promise<IpcResult<{ snapshot: z.infer<typeof catalogSnapshotSchema> | null }>>;
  resolveApproval(
    args: z.infer<typeof approvalResolveArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof approvalResolveResultSchema>>>;
  prepareWorkspace(
    projectAlias: string,
    label: string,
  ): Promise<IpcResult<z.infer<typeof workspaceResultSchema>>>;
  openWorkspaceFolder(path: string): Promise<IpcResult<{ opened: boolean }>>;
  getStudioOptions(): Promise<IpcResult<z.infer<typeof studioOptionsResultSchema>>>;
  createStudioJob(
    args: z.infer<typeof studioJobCreateArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof studioJobResultSchema>>>;
  listStudioJobs(
    args?: z.infer<typeof studioJobsListArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof studioJobsListResultSchema>>>;
  getStudioJob(jobId: string): Promise<IpcResult<z.infer<typeof studioJobResultSchema>>>;
  cancelStudioJob(jobId: string): Promise<IpcResult<{ cancelled: boolean }>>;
  rateStudioJob(
    args: z.infer<typeof studioJobFeedbackArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof studioJobFeedbackResultSchema>>>;
  requestStudioJobAction(
    args: z.infer<typeof studioJobActionArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof studioJobActionResultSchema>>>;
  /** devuelve la funcion de baja; sin ella se acumulan listeners al navegar */
  onAgentEvent(listener: (event: z.infer<typeof agentEventSchema>) => void): () => void;
}

declare global {
  interface Window {
    luxy: LuxyBridge;
  }
}
