import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from './repository.js';
import { SupabaseClient, SupabaseError } from './supabase.js';
import { FakeSupabase, installFakeFetch } from './fake-supabase.fixture.js';

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

  it('aplica el proyecto en PostgREST antes del limite', async () => {
    const select = vi.fn(async () => []);
    const repo = new Repository({ select } as never);

    await repo.listJobs({ projectAlias: 'luxy', limit: 30 });

    expect(select).toHaveBeenCalledWith(
      'jobs',
      expect.objectContaining({ filters: { project_alias: 'eq.luxy' }, limit: 30 }),
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

// -----------------------------------------------------------------------------
// boveda: SEG-SYNC-001 y SYNC-F1-02, contra un PostgREST falso fiel
//
// Estas pruebas fallan con el repositorio anterior: alli un 409 o un 500 de
// Supabase se convertian en «0 guardados» con un `.catch(() => [])`, la
// conversacion de otro se daba por buena y una miniatura no autorizaba nada.
// -----------------------------------------------------------------------------

const USER = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const CONV = 'ad6a9bf6-c69f-4eab-9624-f405b78bdda5';
const sobre = (purpose: string) => ({ version: 1, purpose, nonce: 'QLBVV_RjvTFFlpRx', ciphertext: 'gKXo4HjmSky6cOWq' });
const turno = (sequence: number, recordId = `0000000${sequence}-0000-4000-8000-000000000000`) => ({
  recordId,
  conversationId: CONV,
  privacy: 'private' as const,
  sequence,
  content: sobre('vault.conversation') as never,
  sealedMemory: null,
  createdAt: '2026-09-01T14:33:21.073Z',
});
const medio = (overrides: Record<string, unknown> = {}) => ({
  mediaId: '33333333-3333-4333-8333-333333333333',
  conversationId: CONV,
  objectKey: 'a'.repeat(32),
  byteSize: 10,
  content: sobre('vault.media') as never,
  thumbnailObjectKey: 'b'.repeat(32),
  createdAt: '2026-09-01T14:33:21.073Z',
  ...overrides,
});

describe('Repository: boveda contra PostgREST', () => {
  let fake: FakeSupabase;
  let restore: () => void;
  let repo: Repository;

  beforeEach(() => {
    fake = new FakeSupabase();
    restore = installFakeFetch(fake);
    repo = new Repository(new SupabaseClient({ SUPABASE_URL: fake.baseUrl, SUPABASE_SERVICE_ROLE_KEY: fake.serviceKey }));
    fake.seed('vault_users', [
      { id: USER, email: 'yo@prueba.test', vault_id: 'A'.repeat(43) },
      { id: OTRO, email: 'otro@prueba.test', vault_id: 'B'.repeat(43) },
    ]);
    fake.seed('vault_conversations', [{ conversation_id: CONV, owner_user_id: USER }]);
  });

  afterEach(() => restore());

  it('un 409 al insertar turnos llega como error, no como 0 (la congelacion)', async () => {
    await repo.insertVaultRecords(USER, [turno(0)]);
    // la misma secuencia con otro registro: Postgres responde 23505
    const intento = repo.insertVaultRecords(USER, [turno(0, '99999999-0000-4000-8000-000000000000'), turno(1)]);
    await expect(intento).rejects.toBeInstanceOf(SupabaseError);
    await intento.catch((error: SupabaseError) => {
      expect(error.status).toBe(409);
      expect(error.code).toBe('23505');
      expect(error.isUniqueViolation).toBe(true);
    });
    // y el lote no entro a medias: el turno 1 tampoco esta
    expect(fake.rows('vault_records').map((row) => row.sequence)).toEqual([0]);
  });

  it('un 500 al insertar turnos llega como error', async () => {
    fake.failNext((info) => info.target === 'vault_records', 500, '{"message":"caido"}');
    await expect(repo.insertVaultRecords(USER, [turno(0)])).rejects.toBeInstanceOf(SupabaseError);
  });

  it('un 500 al dar de alta un medio llega como error, no como 0', async () => {
    fake.failNext((info) => info.target.startsWith('vault_media'), 500, '{"message":"caido"}');
    await expect(repo.insertVaultMedia(USER, medio())).rejects.toBeInstanceOf(SupabaseError);
  });

  it('el alta de un medio distingue nuevo, repetido y en conflicto', async () => {
    expect(await repo.insertVaultMedia(USER, medio())).toBe('stored');
    expect(await repo.insertVaultMedia(USER, medio())).toBe('duplicate');
    // la misma clave de objeto con otro mediaId no es «el mismo medio»
    expect(await repo.insertVaultMedia(USER, medio({ mediaId: '44444444-4444-4444-8444-444444444444' }))).toBe('conflict');
    // y el mismo mediaId con otra clave choca con la clave primaria: tampoco
    expect(await repo.insertVaultMedia(USER, medio({ objectKey: 'c'.repeat(32), thumbnailObjectKey: null }))).toBe('conflict');
    expect(fake.rows('vault_media')).toHaveLength(1);
  });

  it('una conversacion ajena se niega y no se le inserta nada', async () => {
    expect(await repo.ensureVaultConversation(OTRO, CONV)).toBe('foreign');
    expect(await repo.ensureVaultConversation(USER, CONV)).toBe('owned');
    const nueva = '55555555-5555-4555-8555-555555555555';
    expect(await repo.ensureVaultConversation(USER, nueva)).toBe('created');
    expect(fake.rows('vault_conversations').map((row) => row.owner_user_id)).toEqual([USER, USER]);
  });

  it('una miniatura autoriza su propia descarga', async () => {
    await repo.insertVaultMedia(USER, medio());
    expect(await repo.findVaultMediaObject(USER, 'a'.repeat(32))).not.toBeNull();
    expect(await repo.findVaultMediaObject(USER, 'b'.repeat(32))).not.toBeNull();
    // y la de otra cuenta no
    expect(await repo.findVaultMediaObject(OTRO, 'b'.repeat(32))).toBeNull();
  });
});
