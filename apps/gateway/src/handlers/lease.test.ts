// pruebas de la renovacion del lease en GET /api/jobs/:jobId/control.
//
// ORIGEN: los trabajos de mas de dos minutos "se quedaban pillados". No estaban
// colgados: seguian ejecutandose y terminaban bien en la maquina. Lo que pasaba
// es que la renovacion del lease viajaba SOLO junto a los eventos, y la cola de
// eventos no envia ninguna peticion cuando no hay nada pendiente. Un modelo que
// tarda cuatro minutos sin emitir nada dejaba caducar el lease de 120 s, y el
// barrido periodico marcaba el trabajo como "interrupted" mientras seguia vivo.
//
// El agente ya consultaba este endpoint cada 3 s para ver si le habian pedido
// cancelar: la renovacion va ahi, para que no dependa de que el modelo hable.
import { describe, it, expect, vi } from 'vitest';
import { handleJobControl } from './api.js';
import { hashToken } from '../auth.js';

const TOKEN = 'token-de-la-maquina-0123456789ab';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

async function fakeDb(): Promise<unknown> {
  const tokens = [
    { id: 't1', machine_id: 'portatil', token_hash: await hashToken(TOKEN), revoked_at: null, expires_at: null },
  ];
  const machines = [{ id: 'portatil', name: 'portatil', enabled: true, projects: ['test'] }];
  return {
    async selectOne(table: string, options: { filters?: Record<string, string> }) {
      const filters = options.filters ?? {};
      const rows = table === 'machine_tokens' ? tokens : machines;
      return (
        rows.find((row) =>
          Object.entries(filters).every(([key, value]) => `eq.${(row as never)[key]}` === value),
        ) ?? null
      );
    },
  };
}

async function control(query: string, jobOverrides: Record<string, unknown> = {}) {
  const renewLease = vi.fn(async () => '2026-07-30T09:00:00.000Z');
  const deps = {
    db: await fakeDb(),
    repo: {
      getJobById: vi.fn(async () => ({
        id: JOB_ID,
        claimedBy: 'portatil',
        status: 'running',
        cancelRequestedAt: null,
        leaseExpiresAt: '2026-07-30T08:00:00.000Z',
        ...jobOverrides,
      })),
      renewLease,
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never as Parameters<typeof handleJobControl>[1];

  const request = new Request(`https://gateway.test/api/jobs/${JOB_ID}/control${query}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const response = await handleJobControl(request, deps, { jobId: JOB_ID });
  return { response, renewLease, body: response.status === 200 ? await response.json() : null };
}

describe('renovacion del lease', () => {
  it('con renewLease se renueva y se devuelve el nuevo vencimiento', async () => {
    const { response, renewLease, body } = await control('?renewLease=120');

    expect(response.status).toBe(200);
    expect(renewLease).toHaveBeenCalledWith(JOB_ID, 'portatil', 120);
    expect((body as { leaseExpiresAt: string }).leaseExpiresAt).toBe('2026-07-30T09:00:00.000Z');
  });

  it('sin renewLease la consulta no toca nada', async () => {
    const { response, renewLease, body } = await control('');

    expect(response.status).toBe(200);
    expect(renewLease).not.toHaveBeenCalled();
    // se devuelve el vencimiento que ya tenia, no uno inventado
    expect((body as { leaseExpiresAt: string }).leaseExpiresAt).toBe('2026-07-30T08:00:00.000Z');
  });

  it('un trabajo ya terminado no revive', async () => {
    const { renewLease } = await control('?renewLease=120', { status: 'completed' });
    expect(renewLease).not.toHaveBeenCalled();
  });

  it('un valor fuera de rango se rechaza en vez de renovar a lo loco', async () => {
    for (const malo of ['0', '10', '99999', 'abc', '120.5', '-120']) {
      const { response, renewLease } = await control(`?renewLease=${malo}`);
      expect(response.status, `renewLease=${malo}`).toBe(400);
      expect(renewLease).not.toHaveBeenCalled();
    }
  });

  it('otra maquina no puede renovar el lease de un trabajo ajeno', async () => {
    const { response, renewLease } = await control('?renewLease=120', { claimedBy: 'otra' });
    expect(response.status).toBe(403);
    expect(renewLease).not.toHaveBeenCalled();
  });
});
