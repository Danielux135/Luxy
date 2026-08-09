import { describe, expect, it, vi } from 'vitest';
import type { StudioJobCreateRequest } from '@luxy/shared';
import { createControlledEvaluationPair } from './evaluation-comparison.js';

const first = { model: 'modelo-a' } as StudioJobCreateRequest;
const second = { model: 'modelo-b' } as StudioJobCreateRequest;

describe('orquestacion de una comparacion controlada', () => {
  it('crea los dos miembros en orden', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { job: { shortId: 'LUX-A' } } })
      .mockResolvedValueOnce({ ok: true, value: { job: { shortId: 'LUX-B' } } });

    await expect(createControlledEvaluationPair(create, first, second)).resolves.toEqual({
      status: 'complete',
      shortIds: ['LUX-A', 'LUX-B'],
      error: null,
    });
    expect(create.mock.calls.map(([request]) => request.model)).toEqual(['modelo-a', 'modelo-b']);
  });

  it('no envia el segundo si el primero falla', async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: 'conflicto', hint: null });

    await expect(createControlledEvaluationPair(create, first, second)).resolves.toEqual({
      status: 'none_created',
      shortIds: [],
      error: 'conflicto',
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('expone una aceptacion parcial sin reintentar', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { job: { shortId: 'LUX-A' } } })
      .mockResolvedValueOnce({ ok: false, error: 'segundo incompatible', hint: null });

    const result = await createControlledEvaluationPair(create, first, second);
    expect(result).toMatchObject({ status: 'partial', shortIds: ['LUX-A'] });
    expect(result.error).toContain('segundo miembro fue rechazado');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
