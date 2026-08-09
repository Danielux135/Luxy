import {
  TERMINAL_JOB_STATUSES,
  modelEvaluationJobMetadataSchema,
  storedModelEvaluationResultSchema,
} from '@luxy/shared';
import type { JobStatus, StoredModelEvaluationResult, StudioJob } from '@luxy/shared';

export interface ModelEvaluationHistoryEntry {
  jobId: string;
  shortId: string;
  createdAt: string;
  validatedAt: string | null;
  result: StoredModelEvaluationResult;
}

export interface ActiveModelEvaluationEntry {
  jobId: string;
  shortId: string;
  evaluationId: string;
  model: string;
  status: JobStatus;
  createdAt: string;
}

/**
 * Extrae solo evidencia con contrato valido y ligada al mismo snapshot.
 * Metadata es entrada remota: una propiedad con forma parecida no basta.
 */
export function collectModelEvaluationHistory(
  jobs: readonly StudioJob[],
): ModelEvaluationHistoryEntry[] {
  const entries: ModelEvaluationHistoryEntry[] = [];
  for (const job of jobs) {
    if (job.origin !== 'studio' || job.metadata['studioMode'] !== 'evaluation') continue;
    const parsed = storedModelEvaluationResultSchema.safeParse(job.metadata['evaluationResult']);
    if (!parsed.success) continue;
    const result = parsed.data;
    if (
      job.metadata['evaluationId'] !== result.evaluationId ||
      job.metadata['evaluationVersion'] !== result.evaluationVersion ||
      (job.model !== null && job.model !== result.model)
    ) {
      continue;
    }
    const validatedAt = job.metadata['evaluationValidatedAt'];
    entries.push({
      jobId: job.id,
      shortId: job.shortId,
      createdAt: job.createdAt,
      validatedAt:
        typeof validatedAt === 'string' && !Number.isNaN(Date.parse(validatedAt))
          ? validatedAt
          : null,
      result,
    });
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function collectActiveModelEvaluations(
  jobs: readonly StudioJob[],
): ActiveModelEvaluationEntry[] {
  const entries: ActiveModelEvaluationEntry[] = [];
  for (const job of jobs) {
    if ((TERMINAL_JOB_STATUSES as readonly string[]).includes(job.status)) continue;
    const parsed = modelEvaluationJobMetadataSchema.safeParse(job.metadata);
    if (!parsed.success || job.model === null) continue;
    entries.push({
      jobId: job.id,
      shortId: job.shortId,
      evaluationId: parsed.data.evaluationId,
      model: job.model,
      status: job.status,
      createdAt: job.createdAt,
    });
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
