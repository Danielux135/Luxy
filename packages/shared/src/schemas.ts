// esquemas zod: toda entrada externa (telegram, agente, configuracion) se valida aqui
import { z } from 'zod';
import {
  JOB_STATUSES,
  PROVIDER_IDS,
  JOB_EVENT_TYPES,
  APPROVAL_ACTIONS,
  JOB_ORIGINS,
  MAX_PROMPT_LENGTH,
  STREAM_TRANSPORT_ENDS,
  RESPONSE_ABORT_SOURCES,
  RESPONSE_OUTCOMES,
  SOFT_TERMINAL_GRACE_MS,
  CONVERSATION_MEMORY_STATUSES,
  MAX_CONVERSATION_RESULT_CHARS,
  ARTIFACT_KINDS,
  MAX_ARTIFACT_BYTES,
} from './constants.js';
import { connectionProfileSchema } from './models/types.js';
import { modelEvaluationExecutionSchema } from './models/evaluations.js';

export const jobStatusSchema = z.enum(JOB_STATUSES);
export const providerIdSchema = z.enum(PROVIDER_IDS);
export const jobEventTypeSchema = z.enum(JOB_EVENT_TYPES);
export const approvalActionSchema = z.enum(APPROVAL_ACTIONS);
export const jobOriginSchema = z.enum(JOB_ORIGINS);
export const projectTypeSchema = z.enum(['node', 'flutter', 'python', 'other']);

// un alias de proyecto es corto y sin separadores de ruta, para evitar traversal
export const projectAliasSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    'el alias solo admite minusculas, digitos, punto, guion y guion bajo',
  );

// nombre de maquina configurable: nunca esta codificado en el repositorio
export const machineNameSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'el nombre de maquina admite minusculas, digitos y guion');

export const promptSchema = z.string().min(1).max(MAX_PROMPT_LENGTH);

/**
 * adjunto ya normalizado, tal y como viaja en la metadata del trabajo.
 *
 * NO lleva los bytes: solo el identificador. El agente los pide al gateway,
 * que es el unico que habla con Telegram.
 */
export const jobAttachmentSchema = z.object({
  fileId: z.string().min(1).max(200),
  kind: z.enum(['photo', 'audio', 'voice', 'document']),
  mimeType: z.string().max(100).nullable().default(null),
  fileName: z.string().max(200).nullable().default(null),
  size: z.number().int().min(0).nullable().default(null),
});

export type JobAttachment = z.infer<typeof jobAttachmentSchema>;

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
  model: z.string().max(128).nullable().default(null),
  projectAlias: projectAliasSchema,
  prompt: z.string(),
  origin: jobOriginSchema.default('telegram'),
  telegramChatId: z.number().int().nullable(),
  telegramUserId: z.number().int().nullable(),
  leaseExpiresAt: z.string(),
  /** adjunto que acompaña a la tarea, si lo hay */
  attachment: jobAttachmentSchema.nullable().default(null),
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

export const streamTransportEndSchema = z.enum(STREAM_TRANSPORT_ENDS);
export const responseAbortSourceSchema = z.enum(RESPONSE_ABORT_SOURCES);
export const responseOutcomeSchema = z.enum(RESPONSE_OUTCOMES);

/**
 * por que termino una respuesta, sin una sola letra de su contenido.
 *
 * una generacion de 23 minutos acabo a mitad de una etiqueta HTML y no habia
 * forma de saber si fue el tope de tokens, un timeout, un proxy o un socket
 * caido. Cada hipotesis pedia un arreglo distinto. Esto es lo minimo para
 * distinguirlas: señales, tiempos y contadores; nunca texto, cabeceras ni URLs.
 */
export const responseTerminationSchema = z.object({
  /** codigo HTTP de la respuesta; null si la peticion nunca llego a responder */
  httpStatus: z.number().int().min(0).max(599).nullable(),
  streamed: z.boolean(),
  /** trozos de red leidos, no eventos SSE */
  chunks: z.number().int().min(0),
  bytes: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  transportEnd: streamTransportEndSchema,
  /** exactamente lo que dijo el proveedor: `stop`, `length`, `tool_calls`... */
  finishReason: z.string().max(64).nullable(),
  /** llego el bloque final de consumo, el que va sin `choices` */
  finalUsageReceived: z.boolean(),
  abortedBy: responseAbortSourceSchema.nullable(),
  /** tope de tiempo que se aplico de verdad a esta peticion */
  effectiveTimeoutMs: z.number().int().min(0),
  /** `max_tokens` que se envio de verdad */
  maxOutputTokens: z.number().int().min(0).nullable(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** caracteres de texto visible acumulados: tamaño, no contenido */
  textLength: z.number().int().min(0),
});

export type ResponseTermination = z.infer<typeof responseTerminationSchema>;

/** linea de log legible; por construccion no puede llevar contenido */
export function formatResponseTermination(termination: ResponseTermination): string {
  const partes = [
    `final=${termination.transportEnd}`,
    `http=${termination.httpStatus ?? 'ninguno'}`,
    `stream=${termination.streamed ? 'si' : 'no'}`,
    `finishReason=${termination.finishReason ?? 'ninguno'}`,
    `usageFinal=${termination.finalUsageReceived ? 'si' : 'no'}`,
    `aborto=${termination.abortedBy ?? 'ninguno'}`,
    `duracion=${termination.durationMs}ms`,
    `timeout=${termination.effectiveTimeoutMs}ms`,
    `maxTokens=${termination.maxOutputTokens ?? 'sin tope'}`,
    `tokens=${termination.inputTokens}/${termination.outputTokens}`,
    `bytes=${termination.bytes}`,
    `chunks=${termination.chunks}`,
    `caracteres=${termination.textLength}`,
  ];
  return `diagnostico de la respuesta: ${partes.join(' ')}`;
}

const conversationMemoryEntrySchema = z.string().trim().min(1).max(240);

/**
 * resumen acumulativo que un proveedor devuelve junto a una conversacion.
 *
 * no es una "memoria" propia del modelo: Luxy la valida, la persiste con el
 * trabajo que la origino y la vuelve a enviar en las llamadas posteriores.
 */
export const conversationMemorySchema = z.object({
  version: z.literal(1),
  summary: z.string().trim().min(1).max(1200),
  facts: z.array(conversationMemoryEntrySchema).max(12).default([]),
  decisions: z.array(conversationMemoryEntrySchema).max(12).default([]),
  plan: z.array(conversationMemoryEntrySchema).max(12).default([]),
  openQuestions: z.array(conversationMemoryEntrySchema).max(12).default([]),
  lessons: z.array(conversationMemoryEntrySchema).max(12).default([]),
});

export type ConversationMemory = z.infer<typeof conversationMemorySchema>;

export const CONVERSATION_MEMORY_OPEN = '<LUXY_MEMORY>';
export const CONVERSATION_MEMORY_CLOSE = '</LUXY_MEMORY>';

export const CONVERSATION_MEMORY_INSTRUCTION = [
  'Al final de tu respuesta añade una memoria acumulativa para Luxy.',
  'Conserva lo valido de la memoria anterior y aplica correcciones del usuario.',
  'Incluye solo hechos expresos u observados; no conviertas suposiciones en hechos.',
  'No pongas este bloque dentro de una cerca Markdown ni escribas nada despues.',
  CONVERSATION_MEMORY_OPEN,
  '{"version":1,"summary":"resumen acumulativo breve","facts":[],"decisions":[],"plan":[],"openQuestions":[],"lessons":[]}',
  CONVERSATION_MEMORY_CLOSE,
].join('\n');

export const conversationMemoryStatusSchema = z.enum(CONVERSATION_MEMORY_STATUSES);
export type ConversationMemoryStatus = z.infer<typeof conversationMemoryStatusSchema>;

/**
 * que le paso a la memoria en este turno, dicho para una persona.
 *
 * los tres estados que no son `structured` acaban igual por dentro (se conserva
 * la anterior) pero NO significan lo mismo, y confundirlos es justo lo que hace
 * pensar que Luxy ha olvidado algo: «no habia bloque» es normal, «el bloque se
 * corto» avisa de que la respuesta se quedo sin sitio.
 */
export function describeConversationMemoryStatus(status: ConversationMemoryStatus): string {
  switch (status) {
    case 'structured':
      return 'Memoria actualizada con este turno.';
    case 'absent':
      return 'Este turno no aporto memoria nueva. Se conserva la anterior.';
    case 'truncated_block':
      return 'La respuesta se corto dentro del bloque de memoria. Se conserva la anterior.';
    case 'invalid':
      return 'La memoria de este turno no era valida. Se conserva la anterior.';
    case 'rejected_code':
      return 'La memoria de este turno llevaba codigo dentro y se descarto. Se conserva la anterior.';
  }
}

export interface ParsedConversationMemoryResponse {
  visibleText: string;
  /**
   * memoria válida, o null.
   *
   * null NO significa «sin memoria en la conversación»: significa que este
   * turno no aporta ninguna. Quien lo consuma debe conservar la anterior.
   */
  memory: ConversationMemory | null;
  status: ConversationMemoryStatus;
}

/**
 * true si esto parece codigo o datos, no un resumen en prosa.
 *
 * POR QUE EXISTE: el fallback anterior resumia los primeros 1.200 caracteres de
 * la respuesta visible. Cuando la respuesta era una web, la memoria acababa
 * llena de HTML, CSS y JavaScript, ilegible e inutil como contexto. El modelo
 * tambien puede equivocarse y meter codigo dentro de un bloque bien formado,
 * asi que esto se comprueba SIEMPRE, no solo en el camino de reserva.
 */
export function looksLikeCode(value: string): boolean {
  const text = value.trim();
  if (text.length === 0) return false;

  // cercas de Markdown: la señal mas explicita
  if (/```/.test(text)) return true;

  const patrones = [
    /<!doctype\s+html/i,
    /<\/?(?:html|head|body|div|span|script|style|section|header|footer|canvas|meta|link)\b/i,
    // reglas CSS: selector seguido de declaraciones
    /[.#]?[\w-]+\s*\{[^}]*:[^}]*[;}]/,
    /@(?:import|media|keyframes|font-face)\b/i,
    /\b(?:function|const|let|var|class|return|=>)\b[^\n]*[;{]/,
    /\b(?:document|window)\.\w+/,
    /^\s*[{[][\s\S]*[}\]]\s*$/,
  ];
  if (patrones.some((patron) => patron.test(text))) return true;

  // ultima defensa: densidad de simbolos tipica de codigo, no de prosa
  const simbolos = (text.match(/[{}<>;=()[\]]/g) ?? []).length;
  return text.length >= 120 && simbolos / text.length > 0.06;
}

function stripOptionalJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

/**
 * ajusta un bloque a los limites en vez de rechazarlo entero.
 *
 * POR QUE EXISTE: en LUX-8B8T el modelo SI devolvio su memoria, pero se paso de
 * largo y el bloque entero se descarto: Daniel se quedo sin panel de memoria por
 * un resumen demasiado largo. Un texto largo no esta contaminado, sobra. Lo que
 * si se rechaza sin contemplaciones es el codigo, y eso se comprueba despues.
 */
function normalizeConversationMemory(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const entrada = raw as Record<string, unknown>;
  const lista = (valor: unknown): string[] =>
    Array.isArray(valor)
      ? valor
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim().slice(0, 240))
          .slice(0, 12)
      : [];

  return {
    ...entrada,
    version: 1,
    summary: typeof entrada.summary === 'string' ? entrada.summary.trim().slice(0, 1200) : '',
    facts: lista(entrada.facts),
    decisions: lista(entrada.decisions),
    plan: lista(entrada.plan),
    openQuestions: lista(entrada.openQuestions),
    lessons: lista(entrada.lessons),
  };
}

/** una memoria con codigo dentro no es memoria: es la respuesta colada */
function memoryCarriesCode(memory: ConversationMemory): boolean {
  const entradas = [
    memory.summary,
    ...memory.facts,
    ...memory.decisions,
    ...memory.plan,
    ...memory.openQuestions,
    ...memory.lessons,
  ];
  return entradas.some((entrada) => looksLikeCode(entrada));
}

/**
 * separa la respuesta visible del bloque privado y valida todos sus limites.
 *
 * NO inventa una memoria de reserva. Un turno sin bloque valido devuelve null y
 * quien lo consuma conserva la memoria anterior: una respuesta cortada no puede
 * sustituir un contexto que si era correcto.
 */
export function parseConversationMemoryResponse(text: string): ParsedConversationMemoryResponse {
  const openAt = text.lastIndexOf(CONVERSATION_MEMORY_OPEN);
  if (openAt < 0) {
    return { visibleText: text.trim(), memory: null, status: 'absent' };
  }

  const contentAt = openAt + CONVERSATION_MEMORY_OPEN.length;
  const closeAt = text.indexOf(CONVERSATION_MEMORY_CLOSE, contentAt);
  const before = text.slice(0, openAt).trim();
  // el bloque empezo pero no se cerro: la respuesta se corto dentro de el
  if (closeAt < 0) return { visibleText: before, memory: null, status: 'truncated_block' };

  const after = text.slice(closeAt + CONVERSATION_MEMORY_CLOSE.length).trim();
  const visibleText = [before, after].filter((part) => part.length > 0).join('\n\n');
  try {
    const raw = JSON.parse(stripOptionalJsonFence(text.slice(contentAt, closeAt))) as unknown;
    const parsed = conversationMemorySchema.safeParse(normalizeConversationMemory(raw));
    if (parsed.success) {
      if (memoryCarriesCode(parsed.data)) {
        return { visibleText, memory: null, status: 'rejected_code' };
      }
      return { visibleText, memory: parsed.data, status: 'structured' };
    }
  } catch {
    // una memoria mal formada no puede romper ni ocultar la respuesta util
  }

  return { visibleText, memory: null, status: 'invalid' };
}

/** representacion compacta que vuelve a viajar como DATO en la siguiente llamada */
export function formatConversationMemory(memory: ConversationMemory): string {
  const sections: Array<[string, string[]]> = [
    ['Hechos', memory.facts],
    ['Decisiones', memory.decisions],
    ['Plan', memory.plan],
    ['Preguntas abiertas', memory.openQuestions],
    ['Lecciones', memory.lessons],
  ];
  const lines = [`Resumen: ${memory.summary}`];
  for (const [title, entries] of sections) {
    if (entries.length === 0) continue;
    lines.push(`${title}:`, ...entries.map((entry) => `- ${entry}`));
  }
  return lines.join('\n');
}

/**
 * referencia a un archivo escrito por el agente, nunca su contenido.
 *
 * el archivo vive en la máquina que lo generó (`%LOCALAPPDATA%\Luxy\artifacts`)
 * y aquí sólo viaja lo necesario para encontrarlo y comprobar que es el mismo:
 * el nombre lo construye Luxy, no el modelo.
 */
export const jobArtifactSchema = z.object({
  fileName: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'el nombre del artefacto no es seguro'),
  kind: z.enum(ARTIFACT_KINDS),
  bytes: z.number().int().min(0).max(MAX_ARTIFACT_BYTES),
  /** sha-256 del contenido, para saber si el archivo del disco sigue siendo ése */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string(),
});

export type JobArtifact = z.infer<typeof jobArtifactSchema>;

export const jobCompleteRequestSchema = z.object({
  /**
   * en una tarea es un resumen; en una conversación es LA respuesta.
   *
   * el tope era 4.000 para todo, y eso cortaba por la mitad una respuesta que
   * había llegado entera: 7.691 caracteres recibidos, 4.000 guardados. Quien
   * decide el tope real es el agente según el tipo de trabajo; aquí sólo está
   * el límite duro que evita guardar un documento entero por accidente.
   */
  summary: z.string().max(MAX_CONVERSATION_RESULT_CHARS),
  /** true si ni siquiera con el tope de conversación cupo todo */
  summaryTruncated: z.boolean().optional(),
  /** archivo escrito en la máquina que generó la salida (`D-013`) */
  artifact: jobArtifactSchema.optional(),
  filesChanged: z.number().int().min(0),
  testsPassed: z.number().int().min(0),
  testsFailed: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  diffStat: z.string().max(8000).nullable(),
  branch: z.string().max(256).nullable(),
  worktreePath: z.string().max(1024).nullable(),
  sessionId: z.string().max(128).nullable(),
  testLogs: z.array(testRunResultSchema).max(20).default([]),
  /**
   * solo aparece en respuestas de Conversaciones y nunca se muestra en bruto.
   *
   * ausente NO es «esta conversación no tiene memoria»: es «este turno no
   * aporta una válida». Studio conserva entonces la última buena.
   */
  conversationMemory: conversationMemorySchema.optional(),
  /** por qué este turno aportó memoria o por qué no */
  conversationMemoryStatus: conversationMemoryStatusSchema.optional(),
  /**
   * como termino de verdad la respuesta.
   *
   * el estado del trabajo en Postgres sigue siendo `completed`: una salida
   * parcial no se pierde por no caber en el enum. El detalle viaja aqui y
   * Studio muestra el motivo real. Ausente = contrato anterior.
   */
  responseOutcome: responseOutcomeSchema.optional(),
  /** evidencia del transporte que sostiene ese resultado, sin contenido */
  responseTermination: responseTerminationSchema.optional(),
  /** apiModel que el agente resolvio y envio realmente al proveedor */
  executedModel: z.string().min(1).max(128).optional(),
  /**
   * medio producido por el trabajo: una imagen editada, un audio sintetizado.
   *
   * o una URL que devuelve el proveedor, o los bytes en base64 cuando el
   * adaptador los genera. El gateway se encarga de enviarlo a Telegram.
   */
  resultMedia: z
    .object({
      kind: z.enum(['photo', 'audio', 'document']),
      url: z.string().url().max(2000).optional(),
      base64: z.string().max(12_000_000).optional(),
      fileName: z.string().max(200).optional(),
      caption: z.string().max(1000).optional(),
    })
    .optional(),
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
  /** ausente si el fallo ocurrio antes de invocar al proveedor */
  executedModel: z.string().min(1).max(128).optional(),
});

export const jobCancelledRequestSchema = z.object({
  // ficheros que quedaron modificados: la cancelacion nunca los borra
  modifiedFiles: z.array(z.string().max(512)).max(200).default([]),
  worktreePath: z.string().max(1024).nullable().default(null),
  durationMs: z.number().int().min(0).default(0),
  /**
   * lo que el modelo ya habia escrito cuando se pulso Detener.
   *
   * es opcional para no romper a un agente anterior. Pararla no puede costar
   * veinte minutos de generacion: el texto se conserva igual que en un corte
   * (`D-017`), con la diferencia de que un `cancelled` no ofrece continuar,
   * porque lo paro una persona y sabe por que.
   */
  partialText: z.string().max(MAX_CONVERSATION_RESULT_CHARS).optional(),
  responseTermination: responseTerminationSchema.optional(),
  /** ausente si se cancelo antes de invocar al proveedor */
  executedModel: z.string().min(1).max(128).optional(),
});

export const jobControlResponseSchema = z.object({
  status: jobStatusSchema,
  cancelRequested: z.boolean(),
  leaseExpiresAt: z.string().nullable(),
});

export const approvalResolveRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
});

/** resultado real despues de ejecutar una aprobacion en la maquina */
export const approvalCompleteRequestSchema = z.object({
  ok: z.boolean(),
  message: z.string().min(1).max(500),
});

// -----------------------------------------------------------------------------
// contratos de Studio: Desktop -> main -> gateway
// -----------------------------------------------------------------------------

export const studioJobCreateRequestSchema = z
  .object({
    targetMachineId: z.string().uuid(),
    provider: providerIdSchema,
    model: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/)
      .nullable()
      .default(null),
    projectAlias: projectAliasSchema,
    prompt: promptSchema,
    priority: z.number().int().min(-100).max(100).default(0),
    /** ausente conserva el contrato anterior de tareas */
    mode: z.enum(['task', 'conversation', 'evaluation']).optional(),
    conversationId: z.string().uuid().optional(),
    conversationTurnId: z.string().uuid().optional(),
    conversationTitle: z.string().trim().min(1).max(120).optional(),
    conversationUserMessage: z.string().min(1).max(MAX_PROMPT_LENGTH).optional(),
    comparisonIndex: z.number().int().min(0).max(1).optional(),
    /**
     * trabajo cuya respuesta parcial continua este turno.
     *
     * es opcional a proposito: un turno normal no continua nada, y un agente o
     * un Studio antiguo que no lo mande sigue funcionando. Sin este enlace la
     * union de fragmentos no sobrevive a una recarga, porque nadie sabria que
     * dos respuestas son el mismo documento.
     */
    continuesJobId: z.string().uuid().optional(),
    /** snapshot versionado; solo se acepta con una confirmacion explicita */
    evaluation: modelEvaluationExecutionSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === 'conversation') {
      for (const field of [
        'conversationId',
        'conversationTurnId',
        'conversationTitle',
        'conversationUserMessage',
      ] as const) {
        if (value[field] !== undefined) continue;
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'es obligatorio en una conversacion',
        });
      }
      return;
    }

    if (value.mode === 'evaluation') {
      if (value.model === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['model'],
          message: 'una evaluacion exige un modelo exacto',
        });
      }
      if (value.evaluation === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['evaluation'],
          message: 'falta la definicion confirmada de la evaluacion',
        });
      }
      return;
    }

    if (value.evaluation !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evaluation'],
        message: 'la definicion de evaluacion solo se admite en modo evaluation',
      });
    }
  });

export const studioJobListQuerySchema = z.object({
  targetMachineId: z.string().uuid().optional(),
  status: jobStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * decisiones que Studio puede pedir sobre un worktree terminado.
 *
 * aplicar se representa como commit porque conserva el aislamiento: los
 * cambios quedan confirmados en la rama de Luxy sin tocar la rama principal.
 */
export const studioJobActionSchema = z.enum(['commit', 'discard']);

export const studioJobActionRequestSchema = z.object({
  action: studioJobActionSchema,
  // ambas acciones alteran el worktree; el renderer debe confirmarlas primero
  confirmed: z.literal(true),
  message: z.string().max(500).nullable().default(null),
});

/** valoracion explicita que alimenta la recomendacion de modelos */
export const studioJobFeedbackRequestSchema = z.object({
  rating: z.enum(['helpful', 'not_helpful']),
});

export const studioJobSchema = z.object({
  id: z.string().uuid(),
  shortId: z.string().min(1).max(32),
  origin: jobOriginSchema,
  targetMachineId: z.string().uuid().nullable(),
  provider: providerIdSchema,
  model: z.string().max(128).nullable(),
  projectAlias: projectAliasSchema,
  prompt: promptSchema,
  status: jobStatusSchema,
  priority: z.number().int(),
  claimedBy: z.string().uuid().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  resultSummary: z.string().nullable(),
  errorMessage: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});

export const studioJobEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  type: jobEventTypeSchema,
  message: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
});

export const studioMachineSchema = z.object({
  id: z.string().uuid(),
  name: machineNameSchema,
  projects: z.array(projectAliasSchema),
  providers: z.array(providerIdSchema),
  online: z.boolean(),
  enabled: z.boolean(),
});

export const studioOptionsResponseSchema = z.object({
  machines: z.array(studioMachineSchema),
});

export const studioJobsResponseSchema = z.object({ jobs: z.array(studioJobSchema) });
export const studioJobResponseSchema = z.object({
  job: studioJobSchema,
  events: z.array(studioJobEventSchema).default([]),
});

export const studioJobActionResponseSchema = z.object({
  approvalId: z.string().uuid(),
  job: studioJobSchema,
});

export const studioJobFeedbackResponseSchema = z.object({ job: studioJobSchema });

export type StudioJobCreateRequest = z.infer<typeof studioJobCreateRequestSchema>;
export type StudioJobAction = z.infer<typeof studioJobActionSchema>;
export type StudioJobActionRequest = z.infer<typeof studioJobActionRequestSchema>;
export type StudioJobFeedbackRequest = z.infer<typeof studioJobFeedbackRequestSchema>;
export type StudioJob = z.infer<typeof studioJobSchema>;
export type StudioJobEvent = z.infer<typeof studioJobEventSchema>;
export type StudioMachine = z.infer<typeof studioMachineSchema>;

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
  source: z.enum(['telegram', 'desktop']).default('telegram'),
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
  // ejecutar comprobaciones en el host es una capacidad peligrosa: un modelo
  // puede cambiar codigo que esas pruebas importan. Se habilita por proyecto y
  // nunca por defecto hasta que exista un sandbox de sistema operativo.
  allowHostChecks: z.boolean().default(false),
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
  /**
   * silencio que hay que ver tras una señal DEBIL antes de cerrar el flujo.
   *
   * un `usage` sin `choices` suele ser el ultimo evento, pero no lo demuestra:
   * hay endpoints que lo mandan a mitad. Cerrar al segundo corto una pagina web
   * por la mitad. Con una señal fuerte (`finish_reason` o memoria completa) el
   * margen sigue siendo corto, porque ahi el mensaje SI termino.
   */
  softTerminalGraceMs: z.number().int().min(1).max(120_000).default(SOFT_TERMINAL_GRACE_MS),
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

/** foto de Telegram: llega en varios tamaños y se elige el mayor */
export const telegramPhotoSizeSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  file_size: z.number().int().optional(),
});

export const telegramFileSchema = z.object({
  file_id: z.string(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  file_size: z.number().int().optional(),
});

export const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  date: z.number().int().optional(),
  text: z.string().optional(),
  // pie de foto: cuando se manda una imagen, la instruccion viene aqui
  caption: z.string().optional(),
  photo: z.array(telegramPhotoSizeSchema).optional(),
  document: telegramFileSchema.optional(),
  voice: telegramFileSchema.optional(),
  audio: telegramFileSchema.optional(),
  entities: z.array(telegramMessageEntitySchema).optional(),
  reply_to_message: z
    .object({
      message_id: z.number().int(),
      from: telegramUserSchema.optional(),
      text: z.string().optional(),
      caption: z.string().optional(),
      photo: z.array(telegramPhotoSizeSchema).optional(),
      document: telegramFileSchema.optional(),
      voice: telegramFileSchema.optional(),
      audio: telegramFileSchema.optional(),
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
