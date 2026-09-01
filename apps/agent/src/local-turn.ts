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
import type { AgentConfig, ClaimedJob, ProviderId } from '@luxy/shared';
import { runJob, type JobOutcome } from './job-runner.js';
import type { AgentLogger } from './logger.js';
import type { ProviderExecution } from '@luxy/shared';

export interface LocalTurnInput {
  localTurnId: string;
  provider: string;
  model: string | null;
  projectAlias: string;
  prompt: string;
}

export interface LocalTurnResult {
  outcome: 'completed' | 'failed' | 'cancelled';
  text: string;
  error: string | null;
  executedModel: string | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
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
      // marca explicita para que cualquier rama futura pueda distinguirlo
      luxyPrivateLocalTurn: true,
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
    // el progreso sale solo hacia quien llama. No hay EventQueue de por medio,
    // asi que no existe el camino por el que un evento acabaria en Supabase.
    emit: (type, message) => deps.onProgress(type, message),
    // un turno privado no tiene adjunto que descargar: pedirlo seria hablar con
    // el gateway, que es exactamente lo que este camino evita
    downloadAttachment: () => {
      throw new LocalTurnIsolationError('descargar un adjunto');
    },
  });

  return toLocalResult(outcome);
}

function toLocalResult(outcome: JobOutcome): LocalTurnResult {
  if (outcome.kind === 'completed') {
    const result = outcome.result;
    return {
      outcome: 'completed',
      // en una conversacion `summary` no es un resumen: es LA respuesta (D-020)
      text: result.summary,
      error: null,
      executedModel: result.executedModel ?? null,
      durationMs: result.durationMs,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
    };
  }

  if (outcome.kind === 'cancelled') {
    return {
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
    outcome: 'failed',
    text: '',
    error: outcome.errorMessage,
    executedModel: outcome.executedModel ?? null,
    durationMs: outcome.durationMs,
    inputTokens: null,
    outputTokens: null,
  };
}
