// pruebas del endpoint que sirve el adjunto de un trabajo.
//
// POR QUE EXISTE ESTE ENDPOINT: el agente NUNCA habla con Telegram y no tiene
// el token del bot, asi que no puede descargar la foto por su cuenta. El
// gateway hace de intermediario.
//
// La invariante que se protege aqui es la de siempre en ese patron: quien pide
// el archivo tiene que ser la maquina que reclamo ese trabajo. Si no, un token
// de maquina cualquiera podria leer los adjuntos de todos los usuarios.
import { describe, it, expect, vi } from 'vitest';
import { handleJobAttachment } from './api.js';
import { hashToken } from '../auth.js';

const TOKEN_A = 'token-de-la-maquina-a-0123456789';
const TOKEN_B = 'token-de-la-maquina-b-0123456789';

const JOB_ID = '22222222-2222-4222-8222-222222222222';

async function fakeDb(): Promise<unknown> {
  const tokens = [
    { id: 't-a', machine_id: 'maquina-a', token_hash: await hashToken(TOKEN_A), revoked_at: null, expires_at: null },
    { id: 't-b', machine_id: 'maquina-b', token_hash: await hashToken(TOKEN_B), revoked_at: null, expires_at: null },
  ];
  const machines = [
    { id: 'maquina-a', name: 'A', enabled: true, projects: ['test'] },
    { id: 'maquina-b', name: 'B', enabled: true, projects: ['test'] },
  ];

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

function deps(overrides: { job?: unknown; download?: unknown } = {}) {
  return {
    db: overrides as never,
    repo: {
      getJobById: vi.fn(async () =>
        'job' in overrides
          ? overrides.job
          : {
              id: JOB_ID,
              claimedBy: 'maquina-a',
              metadata: {
                attachment: {
                  fileId: 'FID',
                  kind: 'photo',
                  mimeType: 'image/jpeg',
                  fileName: 'foto.jpg',
                  size: 1024,
                },
              },
            },
      ),
    },
    telegram: {
      downloadFile:
        overrides.download ??
        vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' })),
    },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  };
}

async function call(token: string, extra: Parameters<typeof deps>[0] = {}) {
  const d = deps(extra) as never as Parameters<typeof handleJobAttachment>[1];
  (d as { db: unknown }).db = await fakeDb();
  const request = new Request('https://gateway.test/api/jobs/x/attachment', {
    headers: { authorization: `Bearer ${token}` },
  });
  return { response: await handleJobAttachment(request, d, { jobId: JOB_ID }), deps: d };
}

describe('GET /api/jobs/:jobId/attachment', () => {
  it('la maquina que reclamo el trabajo recibe los bytes', async () => {
    const { response } = await call(TOKEN_A);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('OTRA maquina no puede leer el adjunto, aunque su token sea valido', async () => {
    const { response, deps: d } = await call(TOKEN_B);
    expect(response.status).toBe(403);
    // y sobre todo: nunca se llego a pedir el archivo a Telegram
    expect((d.telegram as { downloadFile: ReturnType<typeof vi.fn> }).downloadFile)
      .not.toHaveBeenCalled();
  });

  it('sin token no se sirve nada', async () => {
    const { response } = await call('');
    expect(response.status).toBe(401);
  });

  it('un trabajo que no existe da 404', async () => {
    const { response } = await call(TOKEN_A, { job: null });
    expect(response.status).toBe(404);
  });

  it('un trabajo sin adjunto da 404, no un error opaco', async () => {
    const { response } = await call(TOKEN_A, {
      job: { id: JOB_ID, claimedBy: 'maquina-a', metadata: {} },
    });
    expect(response.status).toBe(404);
  });

  it('si Telegram falla se devuelve 502 y no se filtra el detalle', async () => {
    const { response } = await call(TOKEN_A, {
      download: vi.fn(async () => {
        throw new Error('bot token 12345:AAA rechazado');
      }),
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('12345');
  });
});
