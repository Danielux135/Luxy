// lectura defensiva de metadatos que llegan del gateway al detalle de Studio.
import type { StudioJob } from '@luxy/shared';

export interface StudioCallMetrics {
  modelCalls: number;
  toolCalls: number;
}

/** los trabajos anteriores al contador conservan el detalle sin inventar una cifra */
export function callMetricsOf(job: StudioJob): StudioCallMetrics | null {
  const raw = job.metadata['callMetrics'];
  if (typeof raw !== 'object' || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const modelCalls = value['modelCalls'];
  const toolCalls = value['toolCalls'];
  if (
    typeof modelCalls !== 'number' ||
    typeof toolCalls !== 'number' ||
    !Number.isInteger(modelCalls) ||
    !Number.isInteger(toolCalls) ||
    modelCalls < 0 ||
    toolCalls < 0
  ) {
    return null;
  }

  return { modelCalls, toolCalls };
}
