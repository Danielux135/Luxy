import { describe, expect, it } from 'vitest';
import type { StudioJob } from '@luxy/shared';
import {
  describeModelEvidence,
  loadModelEvidenceHistory,
  summarizeModelEvidence,
} from './model-evidence.js';

function job(overrides: Partial<StudioJob> = {}): StudioJob {
  return {
    id: crypto.randomUUID(),
    shortId: 'LUX-MODEL',
    origin: 'studio',
    targetMachineId: null,
    provider: 'deepseek',
    model: 'DeepSeek-V4-Pro',
    projectAlias: 'luxy',
    prompt: 'prueba',
    status: 'completed',
    priority: 0,
    claimedBy: null,
    startedAt: '2026-08-09T10:00:00.000Z',
    completedAt: '2026-08-09T10:00:10.000Z',
    resultSummary: 'respuesta',
    errorMessage: null,
    metadata: { responseOutcome: 'completed', durationMs: 10_000 },
    createdAt: '2026-08-09T10:00:00.000Z',
    ...overrides,
  };
}

describe('summarizeModelEvidence', () => {
  it('separa finales reales y calcula la mediana de respuestas completas', () => {
    const evidence = summarizeModelEvidence([
      job({ metadata: { responseOutcome: 'completed', durationMs: 10_000 } }),
      job({ metadata: { responseOutcome: 'completed', durationMs: 30_000 } }),
      job({ metadata: { responseOutcome: 'truncated', durationMs: 40_000 } }),
      job({ status: 'failed', metadata: { responseOutcome: 'failed', durationMs: 2_000 } }),
    ]).get('DeepSeek-V4-Pro');

    expect(evidence).toMatchObject({
      observations: 4,
      completed: 2,
      truncated: 1,
      failed: 1,
      completionRate: 50,
      medianCompletedMs: 20_000,
    });
  });

  it('las cancelaciones no empeoran la tasa del modelo', () => {
    const evidence = summarizeModelEvidence([
      job(),
      job({ status: 'cancelled', metadata: { responseOutcome: 'cancelled', durationMs: 500 } }),
    ]).get('DeepSeek-V4-Pro');

    expect(evidence).toMatchObject({ observations: 1, completed: 1, cancelled: 1 });
    expect(evidence?.completionRate).toBe(100);
  });

  it('no atribuye trabajos sin modelo exacto ni trabajos aun vivos', () => {
    const evidence = summarizeModelEvidence([
      job({ model: null }),
      job({ status: 'running', completedAt: null, metadata: {} }),
    ]);
    expect(evidence.size).toBe(0);
  });

  it('usa el modelo efectivo validado como respaldo y prefiere el solicitado', () => {
    const evidence = summarizeModelEvidence([
      job({ model: null, metadata: { responseOutcome: 'completed', executedModel: 'glm-5.2' } }),
      job({ model: 'DeepSeek-V4-Pro', metadata: { executedModel: 'modelo-distinto' } }),
      job({ model: null, metadata: { executedModel: 'x'.repeat(129) } }),
    ]);

    expect(evidence.get('glm-5.2')?.completed).toBe(1);
    expect(evidence.get('DeepSeek-V4-Pro')?.completed).toBe(1);
    expect(evidence.has('modelo-distinto')).toBe(false);
    expect(evidence.size).toBe(2);
  });

  it('acepta trabajos antiguos y calcula la duracion desde sus fechas', () => {
    const evidence = summarizeModelEvidence([job({ metadata: {} })]).get('DeepSeek-V4-Pro');
    expect(evidence?.completed).toBe(1);
    expect(evidence?.medianCompletedMs).toBe(10_000);
  });

  it('mantiene modelos distintos separados sin recortar paginas ya leidas', () => {
    const jobs = Array.from({ length: 101 }, (_, index) =>
      job({ model: index === 100 ? 'glm-5.2' : 'DeepSeek-V4-Pro' }),
    );
    const evidence = summarizeModelEvidence(jobs);
    expect(evidence.get('DeepSeek-V4-Pro')?.observations).toBe(100);
    expect(evidence.get('glm-5.2')?.observations).toBe(1);
  });
});

describe('loadModelEvidenceHistory', () => {
  it('lee paginas hasta completar el historial sin sondeo', async () => {
    const jobs = Array.from({ length: 205 }, () => job());
    const calls: Array<[number, number]> = [];

    const history = await loadModelEvidenceHistory(async (offset, limit) => {
      calls.push([offset, limit]);
      return jobs.slice(offset, offset + limit);
    });

    expect(calls).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
    ]);
    expect(history).toEqual({ jobs, capped: false, paginationStalled: false });
  });

  it('detecta si quedan trabajos fuera del tope explicito', async () => {
    const jobs = Array.from({ length: 1_001 }, () => job());
    const history = await loadModelEvidenceHistory(
      async (offset, limit) => jobs.slice(offset, offset + limit),
      1_000,
    );

    expect(history.jobs).toHaveLength(1_000);
    expect(history.capped).toBe(true);
    expect(history.paginationStalled).toBe(false);
  });

  it('elimina ids repetidos si el historial cambia entre dos paginas', async () => {
    const first = Array.from({ length: 100 }, () => job());
    const extra = job();
    const history = await loadModelEvidenceHistory(async (offset) => {
      if (offset === 0) return first;
      return [first[99]!, extra];
    });

    expect(history.jobs).toHaveLength(101);
    expect(history.jobs.at(-1)).toBe(extra);
    expect(history.capped).toBe(false);
    expect(history.paginationStalled).toBe(false);
  });

  it('se detiene si un gateway anterior repite la misma pagina', async () => {
    const first = Array.from({ length: 100 }, () => job());
    const calls: number[] = [];
    const history = await loadModelEvidenceHistory(async (offset) => {
      calls.push(offset);
      return first;
    });

    expect(calls).toEqual([0, 100]);
    expect(history.jobs).toHaveLength(100);
    expect(history).toMatchObject({ capped: true, paginationStalled: true });
  });
});

describe('describeModelEvidence', () => {
  it('explica tasa, velocidad y problemas sin esconder cancelaciones', () => {
    const evidence = summarizeModelEvidence([
      job(),
      job({ metadata: { responseOutcome: 'timed_out', durationMs: 60_000 } }),
      job({ status: 'cancelled', metadata: { responseOutcome: 'cancelled' } }),
    ]).get('DeepSeek-V4-Pro');

    expect(evidence).toBeDefined();
    const description = describeModelEvidence(evidence!);
    expect(description).toContain('1/2 completas (50 %)');
    expect(description).toContain('mediana 10.0 s');
    expect(description).toContain('1 con timeout');
    expect(description).toContain('1 canceladas aparte');
  });
});
