import type { StudioJob, StudioJobAction } from '@luxy/shared';

export type StudioDecisionState = 'pending' | 'applied' | 'discarded' | 'failed';

export interface StudioDecision {
  action: StudioJobAction;
  state: StudioDecisionState;
  message: string | null;
  requestedAt: string | null;
  completedAt: string | null;
}

const STATES = new Set<StudioDecisionState>(['pending', 'applied', 'discarded', 'failed']);

/** metadata viene del gateway y se trata como entrada no confiable */
export function parseStudioDecision(metadata: Record<string, unknown>): StudioDecision | null {
  const raw = metadata['studioDecision'];
  if (typeof raw !== 'object' || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const action = value['action'];
  const state = value['state'];
  if (action !== 'commit' && action !== 'discard') return null;
  if (typeof state !== 'string' || !STATES.has(state as StudioDecisionState)) return null;

  return {
    action,
    state: state as StudioDecisionState,
    message: typeof value['message'] === 'string' ? value['message'] : null,
    requestedAt: typeof value['requestedAt'] === 'string' ? value['requestedAt'] : null,
    completedAt: typeof value['completedAt'] === 'string' ? value['completedAt'] : null,
  };
}

/** solo se decide un diff real que siga conservado en su worktree */
export function canDecideStudioJob(job: StudioJob): boolean {
  if (job.status !== 'completed') return false;
  if (typeof job.metadata['worktreePath'] !== 'string') return false;
  if (typeof job.metadata['branch'] !== 'string') return false;
  if (typeof job.metadata['filesChanged'] !== 'number' || job.metadata['filesChanged'] <= 0) {
    return false;
  }

  const decision = parseStudioDecision(job.metadata);
  return decision === null || decision.state === 'failed';
}
