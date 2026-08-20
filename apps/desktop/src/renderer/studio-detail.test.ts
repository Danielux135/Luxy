import { describe, expect, it } from 'vitest';
import type { StudioJob } from '@luxy/shared';
import { callMetricsOf } from './studio-detail.js';

function job(metadata: Record<string, unknown>): StudioJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    shortId: 'LUX-TEST',
    origin: 'studio',
    targetMachineId: null,
    provider: 'deepseek',
    model: null,
    projectAlias: 'demo',
    prompt: 'prueba',
    status: 'completed',
    priority: 0,
    claimedBy: null,
    startedAt: null,
    completedAt: null,
    resultSummary: null,
    errorMessage: null,
    metadata,
    createdAt: '2026-08-20T08:00:00.000Z',
  };
}

describe('callMetricsOf', () => {
  it('lee las llamadas efectivas al modelo y las herramientas', () => {
    expect(callMetricsOf(job({ callMetrics: { modelCalls: 4, toolCalls: 7 } }))).toEqual({
      modelCalls: 4,
      toolCalls: 7,
    });
  });

  it('no inventa datos para trabajos anteriores o metadatos manipulados', () => {
    expect(callMetricsOf(job({}))).toBeNull();
    expect(callMetricsOf(job({ callMetrics: { modelCalls: -1, toolCalls: 2 } }))).toBeNull();
    expect(callMetricsOf(job({ callMetrics: { modelCalls: 2.5, toolCalls: 2 } }))).toBeNull();
  });
});
