// evidencia local por modelo derivada del historial de trabajos.
//
// no se infiere un modelo a partir del proveedor: una familia puede contener
// varios. Solo cuentan trabajos que guardaron el apiModel exacto.
import { responseOutcomeSchema } from '@luxy/shared';
import type { ResponseOutcome, StudioJob } from '@luxy/shared';

export interface ModelEvidence {
  apiModel: string;
  observations: number;
  completed: number;
  truncated: number;
  interrupted: number;
  timedOut: number;
  failed: number;
  cancelled: number;
  completionRate: number | null;
  medianCompletedMs: number | null;
}

export interface ModelEvidenceHistory {
  jobs: StudioJob[];
  capped: boolean;
  paginationStalled: boolean;
}

export const MODEL_EVIDENCE_PAGE_SIZE = 100;
export const MODEL_EVIDENCE_MAX_JOBS = 1_000;

/**
 * pagina una sola vez el historial y elimina ids repetidos entre paginas.
 *
 * el sondeo no vive aqui: al alcanzar el tope se hace una lectura de un solo
 * trabajo para poder decir con certeza si queda historial fuera de la muestra.
 */
export async function loadModelEvidenceHistory(
  readPage: (offset: number, limit: number) => Promise<readonly StudioJob[]>,
  maxJobs = MODEL_EVIDENCE_MAX_JOBS,
): Promise<ModelEvidenceHistory> {
  const jobs: StudioJob[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (offset < maxJobs) {
    const limit = Math.min(MODEL_EVIDENCE_PAGE_SIZE, maxJobs - offset);
    const page = (await readPage(offset, limit)).slice(0, limit);
    let added = 0;
    for (const job of page) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
      added += 1;
    }
    offset += page.length;
    if (page.length < limit) return { jobs, capped: false, paginationStalled: false };
    // compatibilidad con un gateway anterior que ignora `offset`: no se repite
    // la misma pagina diez veces ni se presenta como historial completo.
    if (added === 0) return { jobs, capped: true, paginationStalled: true };
  }

  const probe = await readPage(offset, 1);
  return { jobs, capped: probe.length > 0, paginationStalled: false };
}

function modelOf(job: StudioJob): string | null {
  if (job.model !== null) return job.model;
  const executed = job.metadata['executedModel'];
  return typeof executed === 'string' && executed.length > 0 && executed.length <= 128
    ? executed
    : null;
}

interface MutableModelEvidence extends Omit<ModelEvidence, 'completionRate' | 'medianCompletedMs'> {
  completedDurations: number[];
}

function outcomeOf(job: StudioJob): ResponseOutcome | null {
  const detailed = responseOutcomeSchema.safeParse(job.metadata['responseOutcome']);
  if (detailed.success) return detailed.data;

  // compatibilidad con trabajos anteriores al contrato de finales detallados.
  if (job.status === 'completed') return 'completed';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'cancelled') return 'cancelled';
  if (job.status === 'interrupted') return 'interrupted';
  return null;
}

function durationOf(job: StudioJob): number | null {
  const stored = job.metadata['durationMs'];
  if (typeof stored === 'number' && Number.isFinite(stored) && stored >= 0) return stored;
  if (job.startedAt === null || job.completedAt === null) return null;

  const started = Date.parse(job.startedAt);
  const completed = Date.parse(job.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return null;
  return completed - started;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] ?? null;
  return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

/** resume los trabajos ya leidos; no realiza red ni ejecuta modelos */
export function summarizeModelEvidence(jobs: readonly StudioJob[]): Map<string, ModelEvidence> {
  const summaries = new Map<string, MutableModelEvidence>();

  for (const job of jobs) {
    const apiModel = modelOf(job);
    if (apiModel === null) continue;
    const outcome = outcomeOf(job);
    if (outcome === null) continue;

    const current = summaries.get(apiModel) ?? {
      apiModel,
      observations: 0,
      completed: 0,
      truncated: 0,
      interrupted: 0,
      timedOut: 0,
      failed: 0,
      cancelled: 0,
      completedDurations: [],
    };

    if (outcome === 'cancelled') {
      current.cancelled += 1;
    } else {
      current.observations += 1;
      if (outcome === 'completed') {
        current.completed += 1;
        const duration = durationOf(job);
        if (duration !== null) current.completedDurations.push(duration);
      } else if (outcome === 'truncated') current.truncated += 1;
      else if (outcome === 'interrupted') current.interrupted += 1;
      else if (outcome === 'timed_out') current.timedOut += 1;
      else current.failed += 1;
    }
    summaries.set(apiModel, current);
  }

  return new Map(
    [...summaries.entries()].map(([apiModel, summary]) => [
      apiModel,
      {
        apiModel,
        observations: summary.observations,
        completed: summary.completed,
        truncated: summary.truncated,
        interrupted: summary.interrupted,
        timedOut: summary.timedOut,
        failed: summary.failed,
        cancelled: summary.cancelled,
        completionRate:
          summary.observations === 0
            ? null
            : Math.round((summary.completed / summary.observations) * 100),
        medianCompletedMs: median(summary.completedDurations),
      },
    ]),
  );
}

function durationLabel(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  return `${(milliseconds / 60_000).toFixed(1)} min`;
}

export function describeModelEvidence(evidence: ModelEvidence): string {
  const parts: string[] = [];
  if (evidence.observations > 0) {
    parts.push(
      `${evidence.completed}/${evidence.observations} completas (${evidence.completionRate ?? 0} %)`,
    );
  } else {
    parts.push('sin finales evaluables');
  }
  if (evidence.medianCompletedMs !== null) {
    parts.push(`mediana ${durationLabel(evidence.medianCompletedMs)}`);
  }
  if (evidence.truncated > 0) parts.push(`${evidence.truncated} truncadas`);
  if (evidence.interrupted > 0) parts.push(`${evidence.interrupted} interrumpidas`);
  if (evidence.timedOut > 0) parts.push(`${evidence.timedOut} con timeout`);
  if (evidence.failed > 0) parts.push(`${evidence.failed} fallidas`);
  if (evidence.cancelled > 0) parts.push(`${evidence.cancelled} canceladas aparte`);
  return parts.join(' · ');
}
