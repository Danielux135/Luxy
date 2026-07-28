// tipos derivados de las constantes y modelos de dominio
import type { ModelLimits } from './models/types.js';
import type {
  JOB_STATUSES,
  PROVIDER_IDS,
  JOB_EVENT_TYPES,
  APPROVAL_ACTIONS,
} from './constants.js';

export type JobStatus = (typeof JOB_STATUSES)[number];
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

// tipo de proyecto: determina los comandos de comprobacion por defecto
export type ProjectType = 'node' | 'flutter' | 'python' | 'other';

// una maquina registrada tal y como la ve el gateway
export interface Machine {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  platformVersion: string;
  agentVersion: string;
  capabilities: MachineCapabilities;
  projects: string[];
  lastSeenAt: string | null;
  enabled: boolean;
}

// que herramientas tiene realmente instaladas una maquina
export interface MachineCapabilities {
  git: ToolPresence;
  node: ToolPresence;
  npm: ToolPresence;
  claude: ToolPresence;
  codex: ToolPresence;
  flutter: ToolPresence;
  // proveedores http habilitados en esa maquina
  httpProviders: string[];
}

export interface ToolPresence {
  available: boolean;
  version: string | null;
  path: string | null;
}

// un trabajo tal y como circula entre gateway y agente
export interface Job {
  id: string;
  shortId: string;
  telegramChatId: number;
  telegramUserId: number;
  targetMachineId: string | null;
  provider: ProviderId;
  projectAlias: string;
  prompt: string;
  status: JobStatus;
  priority: number;
  claimedBy: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  metadata: JobMetadata;
  createdAt: string;
}

// metadatos libres pero tipados de un trabajo
export interface JobMetadata {
  // id del mensaje de telegram que se va editando con el progreso
  progressMessageId?: number;
  // motivo por el que el router automatico eligio este proveedor
  routerReason?: string;
  // si el usuario pidio el proveedor explicitamente
  providerExplicit?: boolean;
  // rama y worktree creados por el agente
  branch?: string;
  worktreePath?: string;
  // resumen de la ejecucion
  filesChanged?: number;
  testsPassed?: number;
  testsFailed?: number;
  durationMs?: number;
  sessionId?: string;
  // texto citado incluido a proposito por el usuario, marcado como no confiable
  quotedText?: string;
  [key: string]: unknown;
}

// evento incremental de progreso
export interface JobEvent {
  jobId: string;
  sequence: number;
  type: JobEventType;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// resultado final que el agente devuelve al gateway
export interface JobResult {
  summary: string;
  filesChanged: number;
  testsPassed: number;
  testsFailed: number;
  durationMs: number;
  diffStat: string | null;
  branch: string | null;
  worktreePath: string | null;
  sessionId: string | null;
  testLogs: TestRunResult[];
}

// resultado de un unico comando de comprobacion
export interface TestRunResult {
  command: string;
  args: string[];
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
  passed: boolean;
}

// senal de control que el agente consulta durante la ejecucion
export interface JobControl {
  status: JobStatus;
  cancelRequested: boolean;
  leaseExpiresAt: string | null;
}

// definicion de un proveedor http compatible con apis tipo openai
export interface HttpProviderConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  enabled: boolean;
  supportsStreaming: boolean;
  maxOutputTokens: number;
  dailyBudget: number;
}

// uso de tokens registrado tras una llamada http
export interface ProviderUsage {
  provider: string;
  model: string;
  jobId: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

// interfaz comun de todos los proveedores de ejecucion.
// preparada para ampliaciones futuras (consejo de agentes, revision cruzada).
export interface ProviderExecution {
  readonly id: ProviderId;
  readonly displayName: string;
  /** comprueba si el proveedor puede usarse en esta maquina */
  detect(): Promise<ToolPresence>;
  /** ejecuta la tarea dentro de un directorio de trabajo aislado */
  run(request: ProviderRunRequest): Promise<ProviderRunResult>;
}

/**
 * ejecutor de herramientas visto desde el proveedor.
 *
 * la implementacion real vive en apps/agent (necesita disco y procesos); aqui
 * solo esta la forma, para que shared siga sin depender de node.
 */
export interface ToolRunner {
  execute(name: string, args: unknown): Promise<{ ok: boolean; content: string }>;
}

/**
 * contexto que convierte una llamada de chat en un bucle de agente.
 *
 * si viene presente, el proveedor ejecuta el bucle de herramientas en vez de
 * una sola llamada. Si no, se comporta como siempre.
 */
export interface AgenticContext {
  runner: ToolRunner;
  allowedTools: readonly string[];
  limits: ModelLimits;
  /** false obliga al protocolo JSON de reserva */
  useNativeTools: boolean;
}

export interface ProviderRunRequest {
  prompt: string;
  workingDirectory: string;
  timeoutMs: number;
  signal: AbortSignal;
  /** callback incremental para reportar progreso al gateway */
  onEvent: (event: ProviderStreamEvent) => void;
  /** identificador de modelo opcional que sobrescribe el de la configuracion */
  model?: string;
  /** si viene, el proveedor ejecuta el bucle de herramientas */
  agentic?: AgenticContext;
}

export interface ProviderStreamEvent {
  type: 'phase' | 'text' | 'tool' | 'warning' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderRunResult {
  ok: boolean;
  finalText: string;
  sessionId: string | null;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  errorMessage: string | null;
  usage?: ProviderUsage;
}
