// tipos derivados de las constantes y modelos de dominio
import type { ModelLimits } from './models/types.js';
import type { SamplingParameters } from './sampling.js';
import type { ReasoningMode } from './reasoning-control.js';
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
  PROVIDER_CALL_ENDINGS,
} from './constants.js';
import type { ReasoningEffort } from './constants.js';

export type JobStatus = (typeof JOB_STATUSES)[number];
export type StreamTransportEnd = (typeof STREAM_TRANSPORT_ENDS)[number];
export type ResponseOutcome = (typeof RESPONSE_OUTCOMES)[number];
/** como acabo UNA llamada; el final del TURNO es `ResponseOutcome` */
export type ProviderCallEnding = (typeof PROVIDER_CALL_ENDINGS)[number];
export type ResponseAbortSource = (typeof RESPONSE_ABORT_SOURCES)[number];
export type KnownProviderId = (typeof PROVIDER_IDS)[number];
/** identificador externo validado en los bordes del sistema */
export type ConfigurableProviderId = string & { readonly __providerId: unique symbol };
export type ProviderId = KnownProviderId | ConfigurableProviderId;
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
   * tope de LLAMADAS al dia. 0 = sin limite, que es lo de siempre.
   *
   * POR QUE HACE FALTA ADEMAS DE `dailyBudget`: el presupuesto multiplica
   * tokens por precio, y hay pasarelas que cobran una tarifa plana POR LLAMADA
   * —6,935 ¥ digas 100 palabras o 10.000—. Contra esa tarifa el presupuesto por
   * tokens es ciego por construccion: una llamada que devuelve cero tokens
   * suma cero al gasto y cuesta lo mismo que una buena. Lo unico que protege
   * ahi es contar llamadas.
   */
  dailyCallLimit?: number;
  /**
   * silencio exigido tras una señal terminal debil antes de cerrar el flujo.
   *
   * opcional para no romper una configuracion anterior: sin valor se usa
   * `SOFT_TERMINAL_GRACE_MS`.
   */
  softTerminalGraceMs?: number;
  /**
   * silencio que aguanta una llamada antes de darse por muerta.
   *
   * tiempo SIN RECIBIR NADA, no duracion total. Opcional para no romper una
   * configuracion anterior: sin valor se usa `PROVIDER_SILENCE_TIMEOUT_MS`,
   * que es lo unico que ha elegido alguien a proposito. Lo que habia antes era
   * el valor de fabrica de Node, 300.000 ms, y ese mataba llamadas que iban a
   * contestar.
   */
  silenceTimeoutMs?: number;
  /**
   * forma en la que esta conexion espera `image_url` dentro de una parte de
   * imagen.
   *
   * la forma estandar de OpenAI es un objeto (`image_url: { url }`), pero
   * Mistral la documenta como CADENA (`image_url: "data:..."`). La de objeto
   * probablemente tambien le valga, pero no lo dice en ninguna parte, asi que
   * la eleccion es por conexion en vez de una suposicion global.
   *
   * opcional para no romper una configuracion anterior: sin valor se usa la
   * forma estandar de objeto.
   */
  imageUrlFormat?: 'object' | 'string';
  /**
   * parametros de muestreo. Los CUATRO son opcionales y NINGUNO tiene valor
   * por defecto, a proposito.
   *
   * POR QUE NO HAY DEFECTO: (a) hay pasarelas que devuelven 400 ante un
   * parametro que no conocen, asi que una conexion sin configurar tiene que
   * seguir mandando exactamente el mismo cuerpo que mandaba antes de que estos
   * campos existieran; (b) existen para poder MEDIR con y sin, y un valor «de
   * fabrica» dejaria sin nada contra lo que comparar.
   *
   * Los rangos NO son iguales entre ellos; cada uno esta acotado en
   * `httpProviderConfigSchema`, con la fuente de la que sale.
   */
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  /**
   * cuanto razona el modelo (D-107), en el nivel superior: es el camino de
   * `providers.http` —Groq y compañia—, que no tiene `modelSampling`. Vacio no
   * manda nada. Lo que viaja lo decide `reasoningRequestFields` segun el
   * modelo y el host; un modelo sin regla no recibe nada.
   */
  reasoningMode?: ReasoningMode;
  /**
   * muestreo POR MODELO, con el `model` que viaja en el cuerpo como clave.
   *
   * Lo rellena el agente con `ConnectionProfile.modelSampling` al construir los
   * proveedores de familia; `providers.http` no lo usa.
   *
   * PRECEDENCIA: si el modelo de la peticion tiene entrada, se usa SOLO esa y
   * sustituye entera a los cuatro de arriba, sin mezclarse. Si no la tiene, se
   * usan los de arriba, como siempre.
   */
  modelSampling?: Readonly<Record<string, SamplingParameters>>;
}

/**
 * una imagen que acompaña al prompt en una peticion multimodal.
 *
 * el base64 va PURO, sin el prefijo `data:`. El prefijo lo compone quien
 * construye la peticion, porque cada proveedor lo quiere a su manera; guardarlo
 * ya compuesto obligaria a deshacerlo para el que no lo use igual.
 */
export interface ProviderImage {
  mimeType: string;
  base64: string;
  /**
   * donde vive el archivo, cuando existe SIN CIFRAR en el disco.
   *
   * Solo lo hay en un caso: el banco de pruebas de vision, donde el usuario
   * elige un archivo suyo en un dialogo. Ese archivo ya estaba ahi, en claro,
   * antes de que Luxy lo tocara.
   *
   * Existe porque Codex SI ve imagenes —`codex exec -i, --image <FILE>...`,
   * comprobado el 2026-09-10— pero solo por RUTA, no por bytes en memoria. Sin
   * este campo, Luxy le decia que no a Codex en todos los casos, incluido este,
   * donde no hay nada que proteger.
   *
   * Ausente para el contenido de la boveda, y ahi no es un detalle pendiente:
   * una imagen privada solo existe descifrada en memoria, y escribir una copia
   * en claro para que Codex pueda leerla romperia lo unico que hace privada a
   * la boveda. Ese caso se queda en los transportes que aceptan bytes.
   */
  path?: string;
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
  /**
   * intentos que la pasarela cobra, aunque no devolvieran ni una palabra.
   *
   * es casi siempre igual que `modelCalls`, y la diferencia es justo la que
   * importa: una llamada que no llego a conectar no cuesta nada, y una que
   * murio en silencio a los 300 s cuesta igual que una que contesto.
   *
   * opcional porque solo lo rellenan los proveedores HTTP: un CLI local con la
   * sesion autenticada no tiene una tarifa por llamada que contar.
   */
  billedCalls?: number;
  /**
   * tokens sumados de TODOS los intentos, no solo del que salio bien.
   *
   * `usage` sigue siendo el del intento que produjo la respuesta —es el tamaño
   * del contexto que se conservo, y hay analisis que dependen de eso—. Esto es
   * otra cosa: lo que de verdad se pago. Un turno de tres llamadas figuraba con
   * 7.601 tokens de entrada cuando se habian pagado 22.835.
   */
  billedInputTokens?: number;
  billedOutputTokens?: number;
}

// interfaz comun de todos los proveedores de ejecucion.
// preparada para ampliaciones futuras (consejo de agentes, revision cruzada).
export interface ProviderExecution {
  readonly id: ProviderId;
  readonly displayName: string;
  /**
   * este transporte sabe llevar imagenes hasta el modelo.
   *
   * Ausente o `false` significa que NO, y hay que creerselo: los CLI locales
   * —Claude Code, Codex— reciben el prompt por stdin y no tienen por donde
   * mandar una imagen, asi que la descartaban en SILENCIO. El turno salia
   * «completado» y el modelo contestaba «no hay ninguna imagen adjunta», que
   * es una respuesta valida y se colaba como pie de foto.
   *
   * Se declara aqui, en el transporte, y no se deduce del identificador del
   * proveedor: el dia que un CLI acepte imagenes, lo dice el.
   */
  readonly acceptsImages?: boolean;
  /**
   * acepta imagenes, pero solo como ARCHIVO en disco.
   *
   * Es el caso de Codex: `codex exec -i, --image <FILE>...` ve imagenes
   * perfectamente, pero quiere una ruta. No es lo mismo que `acceptsImages`
   * —que significa «acepta los bytes que le des»— y confundirlos costo un
   * mensaje de error que decia que Codex «solo acepta texto», lo cual es falso.
   */
  readonly acceptsImagePaths?: boolean;
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
  /**
   * imagenes que viajan con el prompt en una peticion multimodal.
   *
   * es OPCIONAL a proposito: todo lo que ya llama a `run()` manda solo texto, y
   * hacerlo obligatorio obligaria a tocar cada punto de llamada para escribir
   * un array vacio que no aporta nada. Ausente y vacio significan lo mismo:
   * peticion de texto, con `content` como cadena de siempre.
   *
   * El base64 va PURO, sin el prefijo `data:`: el prefijo lo compone quien
   * construye la peticion, porque cada proveedor lo quiere a su manera.
   */
  images?: readonly ProviderImage[];
  workingDirectory: string;
  timeoutMs: number;
  signal: AbortSignal;
  /** impide que una conversacion pueda modificar el proyecto asociado */
  readOnly?: boolean;
  /**
   * contexto que necesita el proveedor para elegir su instruccion de sistema.
   *
   * Una conversacion no es una tarea tecnica: forzar ahi la identidad de
   * "asistente tecnico" contradice cualquier personaje configurado dentro del
   * prompt. Es opcional para que proveedores que no usan system prompts puedan
   * ignorarlo y para conservar compatibilidad con llamadas antiguas.
   */
  interactionMode?: 'technical' | 'conversation';
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
   * cuanto se le deja pensar antes de contestar, en ESTA peticion.
   *
   * Ausente = lo que traiga el proveedor, que es lo de siempre. Existe porque
   * ese «lo de siempre» puede ser carisimo sin que se note: en el equipo donde
   * se escribio esto, el `~/.codex/config.toml` del usuario tenia
   * `model_reasoning_effort = "xhigh"` puesto hacia meses, y cada turno de
   * Luxy salia a xhigh sin que nada lo dijera. Un ajuste heredado de otro
   * programa no puede gobernar en silencio lo que gasta este.
   *
   * Solo lo entienden los CLI nativos —`--effort` en Claude,
   * `-c model_reasoning_effort=` en Codex—. Un proveedor HTTP lo ignora, y eso
   * es correcto: el contrato `chat completions` no tiene donde ponerlo.
   */
  effort?: ReasoningEffort;
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
