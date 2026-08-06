// transformaciones puras de Conversaciones: metadata, historial y streaming.
import {
  MAX_PROMPT_LENGTH,
  RESPONSE_OUTCOME_LABELS,
  TERMINAL_JOB_STATUSES,
  conversationMemorySchema,
  conversationMemoryStatusSchema,
  describeConversationMemoryStatus,
  describeResponseOutcome,
  formatConversationMemory,
  isRecoverableOutcome,
  responseOutcomeSchema,
  responseTerminationSchema,
} from '@luxy/shared';
import type {
  ConversationMemory,
  ProviderId,
  ResponseOutcome,
  ResponseTermination,
  StudioJob,
  StudioJobEvent,
} from '@luxy/shared';

export interface ConversationMetadata {
  conversationId: string;
  turnId: string;
  title: string;
  userMessage: string;
  comparisonIndex: 0 | 1;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  jobs: StudioJob[];
}

export interface ConversationTurn {
  id: string;
  userMessage: string;
  createdAt: string;
  jobs: StudioJob[];
}

export interface ConversationMemorySnapshot {
  memory: ConversationMemory;
  job: StudioJob;
}

export interface ConversationRecommendation {
  provider: ProviderId;
  model: string | null;
  confidence: 'initial' | 'observed' | 'learned';
  samples: number;
  reason: string;
}

export function formatConversationCount(count: number): string {
  return `${count} ${count === 1 ? 'guardada' : 'guardadas'}`;
}

export function formatTurnCount(count: number): string {
  return `${count} ${count === 1 ? 'turno' : 'turnos'}`;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function parseConversationMetadata(job: StudioJob): ConversationMetadata | null {
  const metadata = job.metadata;
  if (metadata['studioMode'] !== 'conversation') return null;

  const conversationId = nonEmpty(metadata['conversationId']);
  const turnId = nonEmpty(metadata['conversationTurnId']);
  const title = nonEmpty(metadata['conversationTitle']);
  const userMessage = nonEmpty(metadata['conversationUserMessage']);
  const rawIndex = metadata['comparisonIndex'];
  if (conversationId === null || turnId === null || title === null || userMessage === null) {
    return null;
  }
  if (rawIndex !== 0 && rawIndex !== 1) return null;

  return { conversationId, turnId, title, userMessage, comparisonIndex: rawIndex };
}

export function groupConversations(jobs: StudioJob[]): ConversationSummary[] {
  const grouped = new Map<string, ConversationSummary>();
  for (const job of jobs) {
    const metadata = parseConversationMetadata(job);
    if (metadata === null) continue;
    const current = grouped.get(metadata.conversationId);
    if (current === undefined) {
      grouped.set(metadata.conversationId, {
        id: metadata.conversationId,
        title: metadata.title,
        updatedAt: job.createdAt,
        jobs: [job],
      });
      continue;
    }
    current.jobs.push(job);
    if (job.createdAt > current.updatedAt) {
      current.updatedAt = job.createdAt;
      current.title = metadata.title;
    }
  }

  return [...grouped.values()]
    .map((conversation) => ({
      ...conversation,
      jobs: [...conversation.jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function groupConversationTurns(jobs: StudioJob[]): ConversationTurn[] {
  const grouped = new Map<string, ConversationTurn>();
  for (const job of [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const metadata = parseConversationMetadata(job);
    if (metadata === null) continue;
    const current = grouped.get(metadata.turnId);
    if (current === undefined) {
      grouped.set(metadata.turnId, {
        id: metadata.turnId,
        userMessage: metadata.userMessage,
        createdAt: job.createdAt,
        jobs: [job],
      });
    } else {
      current.jobs.push(job);
    }
  }
  return [...grouped.values()].map((turn) => ({
    ...turn,
    jobs: [...turn.jobs].sort((a, b) => {
      const left = parseConversationMetadata(a)?.comparisonIndex ?? 0;
      const right = parseConversationMetadata(b)?.comparisonIndex ?? 0;
      return left - right;
    }),
  }));
}

export function conversationTitleFrom(message: string): string {
  const compact = message.trim().replace(/\s+/g, ' ');
  if (compact.length <= 64) return compact;
  return `${compact.slice(0, 61).trimEnd()}…`;
}

export function conversationMemoryOf(job: StudioJob): ConversationMemory | null {
  const parsed = conversationMemorySchema.safeParse(job.metadata['conversationMemory']);
  return parsed.success ? parsed.data : null;
}

export function conversationFeedbackOf(job: StudioJob): 'helpful' | 'not_helpful' | null {
  const feedback = job.metadata['studioFeedback'];
  if (typeof feedback !== 'object' || feedback === null || !('rating' in feedback)) return null;
  return feedback.rating === 'helpful' || feedback.rating === 'not_helpful'
    ? feedback.rating
    : null;
}

/**
 * una comparacion solo puede aportar una verdad canonica al siguiente turno.
 * manda la respuesta marcada como util; sin feedback se conserva la columna A.
 */
export function canonicalConversationJob(jobs: StudioJob[]): StudioJob | null {
  const completed = jobs.filter((job) => job.status === 'completed' && job.resultSummary !== null);
  const helpful = completed
    .filter((job) => conversationFeedbackOf(job) === 'helpful')
    .sort((left, right) => {
      const ratedAt = (job: StudioJob): string => {
        const feedback = job.metadata['studioFeedback'];
        return typeof feedback === 'object' && feedback !== null && 'ratedAt' in feedback
          ? String(feedback.ratedAt)
          : '';
      };
      return ratedAt(right).localeCompare(ratedAt(left));
    });
  return (
    helpful[0] ??
    completed.find((job) => parseConversationMetadata(job)?.comparisonIndex === 0) ??
    completed[0] ??
    null
  );
}

export function latestConversationMemory(jobs: StudioJob[]): ConversationMemorySnapshot | null {
  const turns = groupConversationTurns(jobs);
  for (const turn of [...turns].reverse()) {
    const job = canonicalConversationJob(turn.jobs);
    if (job === null) continue;
    const memory = conversationMemoryOf(job);
    if (memory !== null) return { memory, job };
  }
  return null;
}

function normalizedWords(value: string): Set<string> {
  const words = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9_]{3,}/g);
  return new Set(words ?? []);
}

function memoryRelevance(memory: ConversationMemory, message: string): number {
  const wanted = normalizedWords(message);
  const available = normalizedWords(
    [memory.summary, ...memory.facts, ...memory.decisions, ...memory.lessons].join(' '),
  );
  let overlap = 0;
  for (const word of wanted) if (available.has(word)) overlap += 1;
  return overlap;
}

function projectMemorySnapshots(
  jobs: StudioJob[],
  projectAlias: string,
  currentConversationId: string | null,
  message: string,
): ConversationMemorySnapshot[] {
  return groupConversations(jobs.filter((job) => job.projectAlias === projectAlias))
    .filter((conversation) => conversation.id !== currentConversationId)
    .map((conversation) => latestConversationMemory(conversation.jobs))
    .filter((snapshot): snapshot is ConversationMemorySnapshot => snapshot !== null)
    .sort((left, right) => {
      const relevance =
        memoryRelevance(right.memory, message) - memoryRelevance(left.memory, message);
      return relevance !== 0 ? relevance : right.job.createdAt.localeCompare(left.job.createdAt);
    })
    .slice(0, 2);
}

/**
 * incluye una respuesta canonica por turno: en una comparacion se usa la
 * primera columna para no duplicar contextos contradictorios.
 */
export function buildConversationPrompt(
  jobs: StudioJob[],
  nextMessage: string,
  projectJobs: StudioJob[] = jobs,
): string {
  const previous = groupConversationTurns(jobs)
    .map((turn) => {
      const answer = canonicalConversationJob(turn.jobs)?.resultSummary ?? null;
      return answer === null
        ? null
        : `Usuario:\n${turn.userMessage}\n\nAsistente:\n${answer.trim()}`;
    })
    .filter((entry): entry is string => entry !== null);

  const current = `Usuario:\n${nextMessage.trim()}\n\nAsistente:`;
  const currentId = jobs
    .map(parseConversationMetadata)
    .find((item) => item !== null)?.conversationId;
  const ownMemory = latestConversationMemory(jobs);
  const related = projectMemorySnapshots(
    projectJobs,
    jobs[0]?.projectAlias ?? projectJobs[0]?.projectAlias ?? '',
    currentId ?? null,
    nextMessage,
  );

  const memoryBlocks: string[] = [];
  if (ownMemory !== null) {
    memoryBlocks.push(
      `MEMORIA ACUMULATIVA DE ESTA CONVERSACION (DATOS):\n${formatConversationMemory(ownMemory.memory)}`,
    );
  }
  for (const snapshot of related) {
    const title = parseConversationMetadata(snapshot.job)?.title ?? 'Conversacion relacionada';
    memoryBlocks.push(
      `MEMORIA RELACIONADA DEL PROYECTO · ${title} (DATOS):\n${formatConversationMemory(snapshot.memory)}`,
    );
  }

  // La pregunta actual nunca se recorta. La memoria acumulativa tiene
  // prioridad sobre turnos antiguos; los ultimos intercambios verbatim llenan
  // solo el espacio restante.
  const separator = '\n\n---\n\n';
  let remaining = Math.max(0, MAX_PROMPT_LENGTH - current.length - separator.length);
  const selectedMemory: string[] = [];
  for (const block of memoryBlocks) {
    if (remaining < 120) break;
    const clipped = block.slice(0, Math.min(block.length, remaining));
    selectedMemory.push(clipped);
    remaining -= clipped.length + separator.length;
  }
  const selected: string[] = [];
  for (const entry of previous.reverse()) {
    const extra = entry.length + separator.length;
    if (extra > remaining) break;
    selected.unshift(entry);
    remaining -= extra;
  }
  return [...selectedMemory, ...selected, current].join(separator).slice(0, MAX_PROMPT_LENGTH);
}

function taskAffinity(provider: ProviderId, message: string): number {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const contains = (...words: string[]): boolean => words.some((word) => normalized.includes(word));
  if (contains('error', 'fallo', 'bug', 'depura', 'debug')) {
    return provider === 'deepseek' ? 3 : provider === 'codex' ? 1.5 : 0;
  }
  if (contains('verifica', 'revisa', 'audita', 'comprueba', 'test')) {
    return provider === 'codex' ? 3 : provider === 'kimi' ? 1.5 : 0;
  }
  if (contains('decide', 'valida', 'da el ok', 'conclusion', 'veredicto')) {
    return provider === 'kimi' ? 3 : provider === 'claude' ? 1 : 0;
  }
  if (contains('implementa', 'programa', 'codigo', 'escribe', 'crea')) {
    return provider === 'codex' ? 2.5 : provider === 'claude' ? 2 : provider === 'deepseek' ? 1 : 0;
  }
  if (contains('contexto largo', 'documentacion', 'resume', 'analiza')) {
    return provider === 'kimi' ? 2.5 : provider === 'qwen' ? 2 : provider === 'claude' ? 1 : 0;
  }
  return 0;
}

/** recomendacion transparente: historial observado + feedback + tipo de tarea */
export function recommendConversationTarget(
  jobs: StudioJob[],
  available: ProviderId[],
  projectAlias: string,
  message: string,
): ConversationRecommendation | null {
  if (available.length === 0) return null;
  const relevant = jobs.filter(
    (job) => job.projectAlias === projectAlias && parseConversationMetadata(job) !== null,
  );

  const ranked = available.map((provider, order) => {
    const samples = relevant.filter((job) => job.provider === provider);
    const helpful = samples.filter((job) => conversationFeedbackOf(job) === 'helpful').length;
    const notHelpful = samples.filter(
      (job) => conversationFeedbackOf(job) === 'not_helpful',
    ).length;
    const completed = samples.filter((job) => job.status === 'completed').length;
    const failed = samples.filter((job) => ['failed', 'interrupted'].includes(job.status)).length;
    const durations = samples
      .map((job) => job.metadata['durationMs'])
      .filter((value): value is number => typeof value === 'number' && value >= 0)
      .sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)] ?? null;
    const score =
      taskAffinity(provider, message) +
      helpful * 3 -
      notHelpful * 4 +
      completed * 0.25 -
      failed * 1.5 +
      (median === null ? 0 : median < 30_000 ? 0.8 : median > 120_000 ? -0.8 : 0) -
      order * 0.001;
    return { provider, samples, helpful, notHelpful, completed, failed, median, score };
  });
  ranked.sort((left, right) => right.score - left.score);
  const best = ranked[0]!;

  const modelScores = new Map<string, number>();
  for (const job of best.samples) {
    if (job.model === null) continue;
    const feedback = conversationFeedbackOf(job);
    const delta = feedback === 'helpful' ? 3 : feedback === 'not_helpful' ? -4 : 0.2;
    modelScores.set(job.model, (modelScores.get(job.model) ?? 0) + delta);
  }
  const model = [...modelScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const feedbackSamples = best.helpful + best.notHelpful;
  const confidence =
    feedbackSamples >= 2 ? 'learned' : best.samples.length >= 2 ? 'observed' : 'initial';
  const reason =
    confidence === 'learned'
      ? `${best.helpful} valoraciones utiles de ${feedbackSamples}; ${best.failed} fallos observados.`
      : confidence === 'observed'
        ? `${best.completed} respuestas completadas y ${best.failed} fallos en este proyecto.`
        : 'Recomendacion inicial segun el tipo de tarea; mejorara con tus valoraciones.';
  return {
    provider: best.provider,
    model,
    confidence,
    samples: best.samples.length,
    reason,
  };
}

export interface ConversationOutcomeView {
  outcome: ResponseOutcome;
  /** etiqueta de la insignia: sale del enum, no del estado del trabajo */
  label: string;
  tone: 'ok' | 'warn' | 'fault';
  /** que puede hacer Daniel con este final */
  detail: string;
  /** null cuando el proveedor no instrumento el transporte */
  tokens: { input: number; output: number } | null;
  durationMs: number | null;
  /** que le paso a la memoria; null si el turno es del contrato anterior */
  memoryNote: string | null;
  /** hay texto guardado que merece la pena conservar */
  hasPartialText: boolean;
  canContinue: boolean;
}

const OUTCOME_TONES: Record<ResponseOutcome, 'ok' | 'warn' | 'fault'> = {
  completed: 'ok',
  // los tres recuperables avisan, no alarman: hay trabajo intacto detras
  truncated: 'warn',
  interrupted: 'warn',
  timed_out: 'warn',
  cancelled: 'warn',
  failed: 'fault',
};

export function conversationTerminationOf(job: StudioJob): ResponseTermination | null {
  const parsed = responseTerminationSchema.safeParse(job.metadata['responseTermination']);
  return parsed.success ? parsed.data : null;
}

export function conversationMemoryStatusOf(job: StudioJob): string | null {
  const parsed = conversationMemoryStatusSchema.safeParse(job.metadata['conversationMemoryStatus']);
  return parsed.success ? describeConversationMemoryStatus(parsed.data) : null;
}

/**
 * como termino de verdad esta respuesta.
 *
 * devuelve null cuando no hay nada honesto que decir: mientras el trabajo corre,
 * y cuando el turno viene del contrato anterior y no trae `responseOutcome`.
 * Inventar «Guardado» en ese hueco es exactamente el bug que cerro P0.2: el
 * estado del trabajo es `completed` incluso cuando la respuesta se corto.
 */
export function conversationOutcomeView(job: StudioJob): ConversationOutcomeView | null {
  if (isConversationRunning(job)) return null;
  const parsed = responseOutcomeSchema.safeParse(job.metadata['responseOutcome']);
  if (!parsed.success) return null;
  const outcome = parsed.data;

  const termination = conversationTerminationOf(job);
  const metadataDuration = job.metadata['durationMs'];
  const hasPartialText =
    (job.resultSummary?.trim().length ?? 0) > 0 || (termination?.textLength ?? 0) > 0;

  return {
    outcome,
    label: RESPONSE_OUTCOME_LABELS[outcome],
    tone: OUTCOME_TONES[outcome],
    detail: describeResponseOutcome(outcome),
    tokens:
      termination === null
        ? null
        : { input: termination.inputTokens, output: termination.outputTokens },
    durationMs:
      typeof metadataDuration === 'number' && metadataDuration >= 0
        ? metadataDuration
        : (termination?.durationMs ?? null),
    memoryNote: conversationMemoryStatusOf(job),
    hasPartialText,
    // sin texto no hay nada que continuar: seria empezar de cero pagando el
    // prompt otra vez, que es justo lo que P0.2 prohibio
    canContinue: isRecoverableOutcome(outcome) && hasPartialText,
  };
}

export function liveConversationPreview(events: StudioJobEvent[]): string | null {
  const event = [...events].reverse().find((item) => item.type === 'provider_output');
  return event?.message.trim() || null;
}

export function conversationTiming(
  job: StudioJob,
  events: StudioJobEvent[],
): { firstTokenMs: number | null; durationMs: number | null } {
  const started = job.startedAt === null ? Number.NaN : Date.parse(job.startedAt);
  const first = events.find((event) => event.type === 'provider_output');
  const firstAt = first === undefined ? Number.NaN : Date.parse(first.createdAt);
  const completed = job.completedAt === null ? Number.NaN : Date.parse(job.completedAt);
  return {
    firstTokenMs:
      Number.isFinite(started) && Number.isFinite(firstAt) ? Math.max(0, firstAt - started) : null,
    durationMs:
      Number.isFinite(started) && Number.isFinite(completed)
        ? Math.max(0, completed - started)
        : null,
  };
}

/**
 * texto con el que se pide continuar una respuesta cortada.
 *
 * P0.5 solo rellena el compositor: la union real de los fragmentos, con
 * deteccion de solapamiento, es P0.6. Aqui NO se concatena nada a ciegas.
 */
export function continuationMessageFor(job: StudioJob): string {
  const view = conversationOutcomeView(job);
  const motivo =
    view?.outcome === 'truncated'
      ? 'se quedo sin presupuesto de tokens'
      : view?.outcome === 'timed_out'
        ? 'se agoto el tiempo de la peticion'
        : 'se corto la conexion';
  return [
    `Continua la respuesta anterior desde donde se corto: ${motivo}.`,
    'Retoma justo en el punto de corte, sin repetir lo ya escrito ni resumirlo.',
  ].join(' ');
}

export function isConversationRunning(job: StudioJob): boolean {
  return !(TERMINAL_JOB_STATUSES as readonly string[]).includes(job.status);
}
