import { describe, expect, it, vi } from 'vitest';
import { Repository } from './repository.js';

describe('Repository.listJobs', () => {
  it('pasa limite y desplazamiento a PostgREST', async () => {
    const select = vi.fn(async () => []);
    const repo = new Repository({ select } as never);

    await repo.listJobs({ limit: 100, offset: 300 });

    expect(select).toHaveBeenCalledWith(
      'jobs',
      expect.objectContaining({ limit: 100, offset: 300, order: 'created_at.desc' }),
    );
  });
});

describe('Repository.listPendingApprovalsForMachine', () => {
  it('ordena por la fecha real de solicitud de approvals', async () => {
    const select = vi.fn(async () => []);
    const repo = new Repository({ select } as never);

    await repo.listPendingApprovalsForMachine('machine-1');

    expect(select).toHaveBeenCalledWith(
      'approvals',
      expect.objectContaining({
        filters: { status: 'eq.approved' },
        order: 'requested_at.asc',
      }),
    );
  });
});

describe('Repository.completeApproval', () => {
  it('consume solo una aprobacion ya aprobada', async () => {
    const update = vi.fn(async () => [{ id: 'approval-1', job_id: 'job-1', action: 'commit' }]);
    const repo = new Repository({ update } as never);

    await repo.completeApproval('approval-1', true);

    expect(update).toHaveBeenCalledWith(
      'approvals',
      { id: 'eq.approval-1', status: 'eq.approved' },
      expect.objectContaining({ status: 'expired' }),
    );
  });

  it('marca como rechazada una accion que la maquina no pudo ejecutar', async () => {
    const update = vi.fn(async () => [{ id: 'approval-1', job_id: 'job-1', action: 'discard' }]);
    const repo = new Repository({ update } as never);

    await repo.completeApproval('approval-1', false);

    expect(update).toHaveBeenCalledWith(
      'approvals',
      { id: 'eq.approval-1', status: 'eq.approved' },
      expect.objectContaining({ status: 'rejected' }),
    );
  });
});
