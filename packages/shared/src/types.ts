// tipos derivados de las constantes y modelos de dominio
import type { ModelLimits } from './models/types.js';
import type { ResponseTermination } from './schemas.js';
import type {
  JOB_STATUSES,
  PROVIDER_IDS,
  JOB_EVENT_TYPES,
  APPROVAL_ACTIONS,
  JOB_ORIGINS,
  STREAM_TRANSPORT_ENDS,
  RESPONSE_ABORT_SOURCES,
  RESPONSE_OUTCOMES,
} from './constants.js';

export type JobStatus = (typeof JOB_STATUSES)[number];
export type StreamTransportEnd = (typeof STREAM_TRANSPORT_ENDS)[number];
export type ResponseOutcome = (typeof RESPONSE_OUTCOMES)[number];
export type ResponseAbortSource = (typeof RESPONSE_ABORT_SOURCES)[number];
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export type JobOrigin = (typeof JOB_ORIGINS)[number];

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
  origin: JobOrigin;
  telegramChatId: number | null;
  telegramUserId: number | null;
  targetMachineId: string | null;
  provider: ProviderId;
  model: string | null;
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
  /**
   * silencio exigido tras una señal terminal debil antes de cerrar el flujo.
   *
   * opcional para no romper una configuracion anterior: sin valor se usa
   * `SOFT_TERMINAL_GRACE_MS`.
   */
  softTerminalGraceMs?: number;
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

/** contadores observables de una ejecucion del proveedor, sin texto ni secretos */
export interface ProviderCallMetrics {
  /** peticiones enviadas realmente al modelo durante este trabajo */
  modelCalls: number;
  /** herramientas locales que el modelo llego a ejecutar */
  toolCalls: number;
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
  /** impide que una conversacion pueda modificar el proyecto asociado */
  readOnly?: boolean;
  /** callback incremental para reportar progreso al gateway */
  onEvent: (event: ProviderStreamEvent) => void;
  /** identificador de modelo opcional que sobrescribe el de la configuracion */
  model?: string;
  /** si viene, el proveedor ejecuta el bucle de herramientas */
  agentic?: AgenticContext;
  /**
   * techo de tokens de salida para ESTA peticion, por encima del de la
   * configuracion.
   *
   * hace falta porque los modelos que razonan gastan el presupuesto pensando
   * ANTES de responder: medido en Kimi K2.6, 10.110 caracteres de razonamiento
   * frente a 4.947 de respuesta. Con el techo de 8192 del catalogo, un lote de
   * 25 registros salia cortado unas veces y entero otras.
   */
  maxOutputTokens?: number;
  /**
   * tope de tiempo de ESTA peticion, por encima del tope general.
   *
   * los trabajos con herramientas usan un tope conservador por llamada. Las
   * conversaciones terminan por señal de protocolo y conservan el timeout
   * general configurable, porque una pausa larga no demuestra que el modelo se
   * haya colgado. Para los lotes este campo permite ampliar el margen: medido,
   * Kimi K2.6 hace 200 registros en 117 s y 400 no caben en 300 s.
   */
  requestTimeoutMs?: number;
}

export interface ProviderStreamEvent {
  type: 'phase' | 'text' | 'tool' | 'warning' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderRunResult {
  ok: boolean;
  finalText: string;
  /**
   * true si el modelo se quedo sin presupuesto de tokens a mitad de la
   * respuesta (finish_reason: length).
   *
   * se distingue de un fallo cualquiera porque la accion es distinta y
   * concreta: reducir el tamano del lote o subir el techo. Sin esto, una
   * respuesta cortada llegaba como "el JSON no se puede parsear", que manda a
   * buscar el problema donde no esta.
   */
  truncated?: boolean;
  sessionId: string | null;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  errorMessage: string | null;
  usage?: ProviderUsage;
  /** solo lo rellenan los proveedores que pueden medir las llamadas con precision */
  callMetrics?: ProviderCallMetrics;
  /**
   * por que termino de verdad la ultima peticion al proveedor.
   *
   * viaja tanto en exito como en fallo: cuando una respuesta sale cortada, el
   * motivo esta justo aqui y no en el texto. Los proveedores que aun no lo
   * rellenan lo dejan sin definir.
   */
  termination?: ResponseTermination;
}
