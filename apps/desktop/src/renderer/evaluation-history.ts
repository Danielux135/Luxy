import {
  TERMINAL_JOB_STATUSES,
  buildModelEvaluationPrompt,
  modelEvaluationJobMetadataSchema,
  storedModelEvaluationResultSchema,
} from '@luxy/shared';
import type { JobStatus, StoredModelEvaluationResult, StudioJob } from '@luxy/shared';

export interface ModelEvaluationHistoryEntry {
  jobId: string;
  shortId: string;
  createdAt: string;
  validatedAt: string | null;
  provider: string;
  projectAlias: string;
  targetMachineId: string | null;
  prompt: string;
  response: string | null;
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

export interface UnscoredTerminalEvaluationEntry {
  jobId: string;
  shortId: string;
  evaluationId: string;
  model: string;
  status: JobStatus;
  createdAt: string;
  reason: string;
}

export interface ModelEvaluationComparisonMember {
  jobId: string;
  shortId: string;
  index: 0 | 1;
  model: string;
  status: JobStatus;
  createdAt: string;
  result: StoredModelEvaluationResult | null;
}

export interface ModelEvaluationComparison {
  groupId: string;
  evaluationId: string;
  evaluationVersion: number;
  members: ModelEvaluationComparisonMember[];
  issue: string | null;
  createdAt: string;
}

export const MIN_EVALUATION_EVIDENCE_SAMPLES = 3;

export interface ModelEvaluationEvidenceSummary {
  evaluationId: string;
  evaluationVersion: number;
  model: string;
  samples: number;
  scored: number;
  passed: number;
  failed: number;
  notScored: number;
  passRate: number | null;
  medianDurationMs: number | null;
  medianOutputTokens: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** resumen descriptivo; con menos de tres resultados no publica una tasa */
export function aggregateModelEvaluationEvidence(
  entries: readonly ModelEvaluationHistoryEntry[],
): ModelEvaluationEvidenceSummary[] {
  const groups = new Map<string, ModelEvaluationHistoryEntry[]>();
  for (const entry of entries) {
    const { evaluationId, evaluationVersion, model } = entry.result;
    const key = `${evaluationId}\u0000${evaluationVersion}\u0000${model}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()]
    .map((group) => {
      const first = group[0]!.result;
      const scored = group.filter((entry) => entry.result.status !== 'not_scored');
      const passed = scored.filter((entry) => entry.result.status === 'passed').length;
      const failed = scored.length - passed;
      return {
        evaluationId: first.evaluationId,
        evaluationVersion: first.evaluationVersion,
        model: first.model,
        samples: group.length,
        scored: scored.length,
        passed,
        failed,
        notScored: group.length - scored.length,
        passRate: scored.length < MIN_EVALUATION_EVIDENCE_SAMPLES ? null : passed / scored.length,
        medianDurationMs: median(scored.map((entry) => entry.result.durationMs)),
        medianOutputTokens: median(
          scored.flatMap((entry) =>
            entry.result.outputTokens === null ? [] : [entry.result.outputTokens],
          ),
        ),
      };
    })
    .sort(
      (a, b) =>
        a.evaluationId.localeCompare(b.evaluationId) ||
        a.evaluationVersion - b.evaluationVersion ||
        a.model.localeCompare(b.model),
    );
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
    const metadata = modelEvaluationJobMetadataSchema.safeParse(job.metadata);
    if (!metadata.success) continue;
    const parsed = storedModelEvaluationResultSchema.safeParse(job.metadata['evaluationResult']);
    if (!parsed.success) continue;
    const result = parsed.data;
    const expectedPrompt = buildModelEvaluationPrompt(result.evaluationId);
    if (
      metadata.data.evaluationId !== result.evaluationId ||
      metadata.data.evaluationVersion !== result.evaluationVersion ||
      metadata.data.evaluationPromptVersion !== result.promptVersion ||
      metadata.data.evaluationFixtureId !== result.fixtureId ||
      metadata.data.evaluationValidationMode !== result.validationMode ||
      metadata.data.evaluationScoring !== result.scoring ||
      expectedPrompt === null ||
      job.prompt !== expectedPrompt.text ||
      (job.model !== null && job.model !== result.model)
    ) {
      continue;
    }
    const validatedAt = job.metadata['evaluationValidatedAt'];
    entries.push({
      jobId: job.id,
      shortId: job.shortId,
      createdAt: job.createdAt,
      provider: job.provider,
      projectAlias: job.projectAlias,
      targetMachineId: job.targetMachineId,
      prompt: job.prompt,
      response: job.resultSummary,
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

/** trabajos terminales de un Gateway anterior o cerrados por el barrido de lease */
export function collectUnscoredTerminalEvaluations(
  jobs: readonly StudioJob[],
): UnscoredTerminalEvaluationEntry[] {
  const reasons: Partial<Record<JobStatus, string>> = {
    completed: 'termino sin un resultado validado; puede proceder de un Gateway anterior',
    failed: 'fallo antes de que el Gateway guardara un resultado de evaluacion',
    cancelled: 'fue cancelada sin un resultado de evaluacion persistido',
    interrupted: 'el lease expiro antes de guardar un resultado final',
  };
  const entries: UnscoredTerminalEvaluationEntry[] = [];
  for (const job of jobs) {
    if (!(TERMINAL_JOB_STATUSES as readonly string[]).includes(job.status)) continue;
    const metadata = modelEvaluationJobMetadataSchema.safeParse(job.metadata);
    if (!metadata.success || job.model === null) continue;
    if (storedModelEvaluationResultSchema.safeParse(job.metadata['evaluationResult']).success) {
      continue;
    }
    const reason = reasons[job.status];
    if (reason === undefined) continue;
    entries.push({
      jobId: job.id,
      shortId: job.shortId,
      evaluationId: metadata.data.evaluationId,
      model: job.model,
      status: job.status,
      createdAt: job.createdAt,
      reason,
    });
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** reconstruye pares solo desde UUID/indice validados; nunca empareja por proximidad */
export function collectModelEvaluationComparisons(
  jobs: readonly StudioJob[],
): ModelEvaluationComparison[] {
  const groups = new Map<
    string,
    {
      evaluationId: string;
      evaluationVersion: number;
      identityMismatch: boolean;
      contractKey: string;
      contractMismatch: boolean;
      members: ModelEvaluationComparisonMember[];
    }
  >();
  for (const job of jobs) {
    const metadata = modelEvaluationJobMetadataSchema.safeParse(job.metadata);
    if (
      !metadata.success ||
      metadata.data.evaluationComparisonGroupId === undefined ||
      metadata.data.evaluationComparisonIndex === undefined ||
      job.model === null
    ) {
      continue;
    }
    const parsedResult = storedModelEvaluationResultSchema.safeParse(
      job.metadata['evaluationResult'],
    );
    const result =
      parsedResult.success &&
      parsedResult.data.evaluationId === metadata.data.evaluationId &&
      parsedResult.data.evaluationVersion === metadata.data.evaluationVersion &&
      parsedResult.data.model === job.model
        ? parsedResult.data
        : null;
    const contractKey = JSON.stringify([
      metadata.data.evaluationPromptVersion,
      metadata.data.evaluationFixtureId,
      metadata.data.evaluationValidationMode,
      metadata.data.evaluationScoring,
      job.prompt,
      job.targetMachineId,
      job.projectAlias,
    ]);
    const group = groups.get(metadata.data.evaluationComparisonGroupId) ?? {
      evaluationId: metadata.data.evaluationId,
      evaluationVersion: metadata.data.evaluationVersion,
      identityMismatch: false,
      contractKey,
      contractMismatch: false,
      members: [],
    };
    if (
      group.evaluationId !== metadata.data.evaluationId ||
      group.evaluationVersion !== metadata.data.evaluationVersion
    ) {
      group.identityMismatch = true;
    }
    if (group.contractKey !== contractKey) group.contractMismatch = true;
    group.members.push({
      jobId: job.id,
      shortId: job.shortId,
      index: metadata.data.evaluationComparisonIndex,
      model: job.model,
      status: job.status,
      createdAt: job.createdAt,
      result,
    });
    groups.set(metadata.data.evaluationComparisonGroupId, group);
  }

  return [...groups.entries()]
    .map(([groupId, group]) => {
      const members = [...group.members].sort(
        (a, b) => a.index - b.index || a.createdAt.localeCompare(b.createdAt),
      );
      const indexes = members.map((member) => member.index);
      const issue = group.identityMismatch
        ? 'Grupo invalido: mezcla pruebas o versiones distintas.'
        : group.contractMismatch
          ? 'Grupo invalido: mezcla snapshots, prompts, maquinas o proyectos.'
          : members.length !== new Set(indexes).size
            ? 'Grupo ambiguo: hay indices de miembro repetidos.'
            : !indexes.includes(0)
              ? 'Comparacion parcial: falta el modelo A.'
              : !indexes.includes(1)
                ? 'Comparacion parcial: falta el modelo B.'
                : members[0]!.model === members[1]!.model
                  ? 'Grupo invalido: ambos miembros usan el mismo modelo exacto.'
                  : null;
      return {
        groupId,
        evaluationId: group.evaluationId,
        evaluationVersion: group.evaluationVersion,
        members,
        issue,
        createdAt: members.reduce(
          (latest, member) => (member.createdAt > latest ? member.createdAt : latest),
          members[0]!.createdAt,
        ),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
