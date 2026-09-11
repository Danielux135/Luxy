// ejecucion de un turno privado, sin pasar por la cola de Supabase.
//
// Todo lo demas en Luxy llega por la cola: el gateway reparte, el agente
// reclama, renueva el lease y devuelve el resultado. Un turno privado no puede
// hacer eso, porque encolarlo significaria escribir el prompt en un servidor
// que no debe poder leerlo.
//
// Por eso este modulo existe aparte y no toca NINGUNA de las tres piezas que
// hablan con el gateway:
//
//   - `queue`   (eventos)   -> aqui los eventos van solo a quien llama;
//   - `outcomes`(resultados)-> aqui el resultado se devuelve, no se persiste;
//   - `client`  (adjuntos)  -> aqui descargar un adjunto es un error.
//
// Lo que se pierde a cambio, y hay que asumir: no hay lease, no hay reintento
// tras un corte y no hay historial en el servidor. Si Luxy se cierra a media
// respuesta, esa respuesta se pierde.
import type {
  AgentConfig,
  ClaimedJob,
  ConversationMemory,
  ConversationMemoryStatus,
  ProviderId,
  ProviderImage,
  ReasoningEffort,
} from '@luxy/shared';
import { runJob, type JobOutcome } from './job-runner.js';
import type { AgentLogger } from './logger.js';
import type { ProviderExecution } from '@luxy/shared';

export interface LocalTurnInput {
  localTurnId: string;
  provider: string;
  model: string | null;
  projectAlias: string;
  prompt: string;
  /** `technical` no encarna a nadie; ver el contrato en `host-protocol` */
  kind?: 'conversation' | 'technical';
  /**
   * imagenes del turno, con el base64 PURO.
   *
   * no entran en el trabajo sintetico: van directas al ejecutor. Meterlas en el
   * `ClaimedJob` seria meterlas en el contrato del gateway, y un turno privado
   * existe para que su contenido no llegue a ningun servidor.
   */
  images?: readonly ProviderImage[];

  /**
   * cuanta salida pedir para este turno. Ausente = el tope de la conexion.
   *
   * Lo pone quien sabe cuanto va a conservar. El describidor guarda 1.900
   * caracteres como mucho, y pedir los 8192 de la conexion no era derrochar:
   * Groq rechaza la peticion entera cuando el `max_tokens` pedido supera el
   * limite por minuto del modelo, en vez de recortar.
   */
  maxOutputTokens?: number;

  /**
   * cuanto dejarle pensar en este turno. Ausente = lo que traiga el proveedor.
   *
   * Viaja por el mismo sitio que `maxOutputTokens` y no dentro del trabajo: no
   * es parte del contrato del gateway, es un ajuste de ESTA llamada.
   */
  effort?: ReasoningEffort;
}

export interface LocalTurnResult {
  outcome: 'completed' | 'failed' | 'cancelled';
  text: string;
  error: string | null;
  executedModel: string | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * cuantas veces se llamo al modelo para producir ESTA respuesta.
   *
   * Mas de una significa que hubo un reintento, y con esta pasarela cada
   * reintento se cobra entero aunque no devuelva nada. El contador ya existia
   * en la metadata del trabajo y se perdia aqui, que es justo donde hacia
   * falta: sin el, dos llamadas y una respuesta son indistinguibles de una
   * llamada y una respuesta.
   */
  modelCalls: number | null;
  /** como termino de verdad; `completed` no garantiza respuesta entera */
  responseOutcome: string | null;
  /**
   * la memoria del turno, ya separada de la respuesta por el job-runner.
   *
   * Antes no se devolvia: el texto viajaba SIN el bloque y la memoria no
   * llegaba a ningun sitio. El job-runner solo la incluye si la respuesta
   * termino bien, asi que una cortada trae el estado pero no la memoria.
   */
  memory?: ConversationMemory | null;
  memoryStatus?: ConversationMemoryStatus | null;
}

export interface LocalTurnDeps {
  config: AgentConfig;
  logger: AgentLogger;
  getProvider: (id: ProviderId) => ProviderExecution | null;
  worktreesDirectory: string;
  apiKeyFor: (connectionId: string) => string | undefined;
  /** progreso hacia el proceso principal. NUNCA hacia el gateway */
  onProgress: (type: string, message: string) => void;
}

/**
 * error si algo intenta usar el gateway durante un turno privado.
 *
 * es deliberadamente ruidoso: si esta rama se ejecuta alguna vez, significa que
 * una funcionalidad nueva rompio el aislamiento sin darse cuenta, y es mejor
 * que falle a que suba el contenido en silencio.
 */
export class LocalTurnIsolationError extends Error {
  constructor(what: string) {
    super(`un turno privado no puede ${what}: eso pasaria por el gateway`);
    this.name = 'LocalTurnIsolationError';
  }
}

/**
 * construye el trabajo sintetico que consume el ejecutor de siempre.
 *
 * Se marca como conversacion de Studio a proposito: esa etiqueta es la que
 * activa el camino de SOLO LECTURA en runJob — sin worktree, sin herramientas
 * de escritura, sin comprobaciones en el anfitrion. Un turno privado no debe
 * poder tocar archivos.
 *
 * Las imagenes del turno NO entran aqui: este objeto tiene la forma del
 * contrato del gateway, y lo que quepa en el es lo que algun dia podria
 * acabar viajando por la cola. Van aparte, en las dependencias del ejecutor.
 */
export function buildLocalJob(input: LocalTurnInput): ClaimedJob {
  return {
    id: input.localTurnId,
    shortId: `LOCAL-${input.localTurnId.slice(0, 8)}`,
    provider: input.provider as ProviderId,
    model: input.model,
    projectAlias: input.projectAlias,
    prompt: input.prompt,
    origin: 'studio',
    telegramChatId: null,
    telegramUserId: null,
    // no hay lease porque no hay servidor que lo conceda ni que lo expire
    leaseExpiresAt: new Date(0).toISOString(),
    attachment: null,
    metadata: {
      studioMode: 'conversation',
      // la marca que activa el envoltorio de personaje (`D-055`). Un turno
      // tecnico NO la lleva: catalogar es una tarea sobre un texto, y encarnar
      // a alguien mientras se rellena un JSON estropea las dos cosas
      ...(input.kind === 'technical'
        ? // pero quitar una marca no basta: sin ninguna, el turno caia en la
          // rama GENERICA de conversacion, que le pide al modelo un bloque
          // `<LUXY_MEMORY>`. Visto en una descripcion real: el modelo dedicaba
          // media respuesta a rellenar una memoria que nadie iba a guardar, y
          // ese JSON solo se queda fuera del pie de foto porque lo recorta el
          // job-runner despues. Un turno tecnico se declara como tal
          { luxyTechnicalTurn: true }
        : { luxyPrivateLocalTurn: true }),
    },
  };
}

/** ejecuta el turno y devuelve su resultado sin persistir nada */
export async function runLocalTurn(
  input: LocalTurnInput,
  signal: AbortSignal,
  deps: LocalTurnDeps,
): Promise<LocalTurnResult> {
  const job = buildLocalJob(input);

  const outcome = await runJob(job, signal, {
    config: deps.config,
    logger: deps.logger,
    getProvider: deps.getProvider,
    worktreesDirectory: deps.worktreesDirectory,
    apiKeyFor: deps.apiKeyFor,
    // las imagenes acompañan al prompt y siguen su mismo camino: memoria entre
    // dos procesos de Luxy, nunca la cola
    ...(input.images === undefined ? {} : { images: input.images }),
    ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
    ...(input.effort === undefined ? {} : { effort: input.effort }),
    // el progreso sale solo hacia quien llama. No hay EventQueue de por medio,
    // asi que no existe el camino por el que un evento acabaria en Supabase.
    emit: (type, message) => deps.onProgress(type, message),
    // un turno privado no tiene adjunto que descargar: pedirlo seria hablar con
    // el gateway, que es exactamente lo que este camino evita
    downloadAttachment: () => {
      throw new LocalTurnIsolationError('descargar un adjunto');
    },
  });

  const result = toLocalResult(outcome);

  // una linea por turno privado, con CONTADORES y nada mas: ni prompt, ni
  // respuesta, ni de que conversacion. Existe porque el camino privado no
  // pasa por la cola y por tanto no dejaba rastro de ninguna clase: un
  // reintento silencioso —los unicos que avisan son los 429— gastaba una
  // llamada de pasarela sin que nadie pudiera verlo despues.
  deps.logger.info('turno privado terminado', {
    outcome: result.outcome,
    responseOutcome: result.responseOutcome,
    modelCalls: result.modelCalls,
    durationMs: result.durationMs,
    // `tokensIn` y no `inputTokens` a proposito: la redaccion tapa cualquier
    // clave que acabe en Token(s), y hace bien. Son contadores, no secretos,
    // asi que se renombra el campo en vez de aflojar la regla
    tokensIn: result.inputTokens,
    tokensOut: result.outputTokens,
    model: result.executedModel,
  });

  return result;
}

function toLocalResult(outcome: JobOutcome): LocalTurnResult {
  if (outcome.kind === 'completed') {
    const result = outcome.result;
    return {
      modelCalls: result.callMetrics?.modelCalls ?? null,
      responseOutcome: result.responseOutcome ?? null,
      outcome: 'completed',
      // en una conversacion `summary` no es un resumen: es LA respuesta (D-020)
      text: result.summary,
      error: null,
      executedModel: result.executedModel ?? null,
      durationMs: result.durationMs,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      memory: result.conversationMemory ?? null,
      memoryStatus: result.conversationMemoryStatus ?? null,
    };
  }

  if (outcome.kind === 'cancelled') {
    return {
      // un corte no llega a producir metadata: el trabajo no se completo
      modelCalls: null,
      responseOutcome: 'cancelled',
      outcome: 'cancelled',
      // se conserva lo que el modelo ya habia escrito: tirarlo obligaria a
      // volver a pagar el prompt entero para recuperar lo mismo (D-016)
      text: outcome.partialText ?? '',
      error: null,
      executedModel: outcome.executedModel ?? null,
      durationMs: outcome.durationMs,
      inputTokens: null,
      outputTokens: null,
    };
  }

  return {
    modelCalls: null,
    responseOutcome: 'failed',
    outcome: 'failed',
    text: '',
    error: outcome.errorMessage,
    executedModel: outcome.executedModel ?? null,
    durationMs: outcome.durationMs,
    inputTokens: null,
    outputTokens: null,
  };
}
