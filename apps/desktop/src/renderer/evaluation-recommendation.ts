import type { ModelEvaluationDefinition, StudioJob } from '@luxy/shared';
import {
  MIN_EVALUATION_EVIDENCE_SAMPLES,
  aggregateModelEvaluationEvidence,
  type ModelEvaluationHistoryEntry,
} from './evaluation-history.js';

export interface ModelEvaluationRecommendation {
  model: string;
  scored: number;
  passRate: number;
  medianDurationMs: number | null;
  feedbackSamples: number;
  reason: string;
}

export interface ModelEvaluationRecommendationAssessment {
  status: 'recommended' | 'insufficient_samples' | 'no_clear_difference';
  eligibleModels: number;
  recommendation: ModelEvaluationRecommendation | null;
}

function feedbackForModel(jobs: readonly StudioJob[], model: string, projectAlias: string) {
  let helpful = 0;
  let notHelpful = 0;
  for (const job of jobs) {
    if (
      job.model !== model ||
      job.projectAlias !== projectAlias ||
      job.status !== 'completed' ||
      job.metadata['studioMode'] !== 'conversation'
    ) {
      continue;
    }
    const feedback = job.metadata['studioFeedback'];
    if (typeof feedback !== 'object' || feedback === null || !('rating' in feedback)) continue;
    if (feedback.rating === 'helpful') helpful += 1;
    if (feedback.rating === 'not_helpful') notHelpful += 1;
  }
  return {
    helpful,
    notHelpful,
    samples: helpful + notHelpful,
    score: helpful + notHelpful >= 2 ? helpful - notHelpful : 0,
  };
}

/** recomendacion provisional: misma prueba/version y al menos dos candidatos maduros */
export function assessModelEvaluationRecommendation(input: {
  evaluation: ModelEvaluationDefinition;
  entries: readonly ModelEvaluationHistoryEntry[];
  jobs: readonly StudioJob[];
  allowedModels: readonly string[];
  projectAlias: string;
}): ModelEvaluationRecommendationAssessment {
  const allowed = new Set(input.allowedModels);
  const candidates = aggregateModelEvaluationEvidence(input.entries)
    .filter(
      (summary) =>
        summary.evaluationId === input.evaluation.id &&
        summary.evaluationVersion === input.evaluation.version &&
        summary.scored >= MIN_EVALUATION_EVIDENCE_SAMPLES &&
        summary.passRate !== null &&
        allowed.has(summary.model),
    )
    .map((summary) => ({
      ...summary,
      feedback: feedbackForModel(input.jobs, summary.model, input.projectAlias),
    }));

  if (candidates.length < 2) {
    return {
      status: 'insufficient_samples',
      eligibleModels: candidates.length,
      recommendation: null,
    };
  }

  candidates.sort((left, right) => {
    const quality = right.passRate! - left.passRate!;
    if (quality !== 0) return quality;
    if (input.evaluation.scoring === 'timing') {
      const leftDuration = left.medianDurationMs ?? Number.POSITIVE_INFINITY;
      const rightDuration = right.medianDurationMs ?? Number.POSITIVE_INFINITY;
      if (leftDuration !== rightDuration) return leftDuration - rightDuration;
    }
    return right.feedback.score - left.feedback.score;
  });
  const best = candidates[0]!;
  const second = candidates[1]!;
  const sameQuality = best.passRate === second.passRate;
  const sameTiming =
    input.evaluation.scoring !== 'timing' || best.medianDurationMs === second.medianDurationMs;
  const sameFeedback = best.feedback.score === second.feedback.score;
  if (sameQuality && sameTiming && sameFeedback) {
    return {
      status: 'no_clear_difference',
      eligibleModels: candidates.length,
      recommendation: null,
    };
  }

  const details = [`${Math.round(best.passRate! * 100)}% validado (${best.passed}/${best.scored})`];
  if (input.evaluation.scoring === 'timing' && best.medianDurationMs !== null) {
    details.push(`mediana ${best.medianDurationMs.toLocaleString('es-ES')} ms`);
  }
  if (best.feedback.samples >= 2) {
    details.push(`${best.feedback.helpful}/${best.feedback.samples} valoraciones útiles en Studio`);
  }
  return {
    status: 'recommended',
    eligibleModels: candidates.length,
    recommendation: {
      model: best.model,
      scored: best.scored,
      passRate: best.passRate!,
      medianDurationMs: best.medianDurationMs,
      feedbackSamples: best.feedback.samples,
      reason: details.join(' · '),
    },
  };
}
