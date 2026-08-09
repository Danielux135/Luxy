import type { StudioJobCreateRequest } from '@luxy/shared';

type CreateResult =
  | { ok: true; value: { job: { shortId: string } } }
  | { ok: false; error: string; hint: string | null };

export interface EvaluationPairCreation {
  status: 'none_created' | 'partial' | 'complete';
  shortIds: string[];
  error: string | null;
}

/** Envia siempre en orden; nunca intenta el segundo si el primero fue rechazado. */
export async function createControlledEvaluationPair(
  createJob: (request: StudioJobCreateRequest) => Promise<CreateResult>,
  first: StudioJobCreateRequest,
  second: StudioJobCreateRequest,
): Promise<EvaluationPairCreation> {
  const firstResult = await createJob(first);
  if (!firstResult.ok) {
    return { status: 'none_created', shortIds: [], error: firstResult.error };
  }

  const secondResult = await createJob(second);
  if (!secondResult.ok) {
    return {
      status: 'partial',
      shortIds: [firstResult.value.job.shortId],
      error: `Se creo ${firstResult.value.job.shortId}, pero el segundo miembro fue rechazado: ${secondResult.error}`,
    };
  }

  return {
    status: 'complete',
    shortIds: [firstResult.value.job.shortId, secondResult.value.job.shortId],
    error: null,
  };
}
