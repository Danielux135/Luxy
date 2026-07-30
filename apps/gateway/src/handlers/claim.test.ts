// pruebas del contrato de POST /api/jobs/claim.
//
// ORIGEN: el agente recibia siempre `attachment: null`, asi que /image_edit
// pedia una foto que el usuario YA habia enviado. El campo estaba en el
// esquema y se guardaba en la metadata del trabajo, pero el unico sitio que
// produce el trabajo reclamado nunca lo rellenaba, y el `.default(null)` del
// esquema convertia ese olvido en un valor valido.
//
// Por eso la prueba se hace contra la RESPUESTA parseada con el esquema real:
// una prueba de la funcion auxiliar no habria detectado nada.
import { describe, it, expect, vi } from 'vitest';
import { claimResponseSchema } from '@luxy/shared';
import { handleClaim } from './api.js';
import { hashToken } from '../auth.js';

const TOKEN = 'token-de-la-maquina-0123456789ab';

const ADJUNTO = {
  fileId: 'AgACAgQAAx',
  kind: 'photo',
  mimeType: 'image/jpeg',
  fileName: 'foto.jpg',
  size: 7_000,
};

async function fakeDb(): Promise<unknown> {
  const tokens = [
    {
      id: 't1',
      machine_id: 'portatil-clase',
      token_hash: await hashToken(TOKEN),
      revoked_at: null,
      expires_at: null,
    },
  ];
  const machines = [{ id: 'portatil-clase', name: 'portatil-clase', enabled: true, projects: ['test'] }];

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

async function claim(metadata: Record<string, unknown>) {
  const deps = {
    db: await fakeDb(),
    config: { JOB_LEASE_SECONDS: 120 },
    repo: {
      claimJob: vi.fn(async () => ({
        id: '33333333-3333-4333-8333-333333333333',
        short_id: 'LUX-E65B',
        provider: 'step',
        project_alias: 'test',
        prompt: 'edita esta foto como quieras',
        telegram_chat_id: 111222333,
        telegram_user_id: 111222333,
        lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
        metadata,
      })),
    },
    telegram: { editMessageText: vi.fn(async () => undefined) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never as Parameters<typeof handleClaim>[1];

  const request = new Request('https://gateway.test/api/jobs/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ supportedProviders: ['step'], projects: ['test'] }),
  });

  const response = await handleClaim(request, deps);
  expect(response.status).toBe(200);
  // se parsea con el esquema REAL: es lo que hace el agente
  return claimResponseSchema.parse(await response.json()).job;
}

describe('POST /api/jobs/claim', () => {
  it('el trabajo reclamado lleva el adjunto que el usuario envio', async () => {
    const job = await claim({ attachment: ADJUNTO });
    expect(job?.attachment).toEqual(ADJUNTO);
  });

  it('un trabajo sin adjunto lo deja en null', async () => {
    const job = await claim({});
    expect(job?.attachment).toBeNull();
  });

  it('una metadata con un adjunto corrupto no rompe el reclamo', async () => {
    // si un adjunto mal formado hiciera fallar el parseo, el trabajo se
    // quedaria atascado sin poder reclamarse nunca
    const job = await claim({ attachment: { fileId: 42 } });
    expect(job?.attachment).toBeNull();
    expect(job?.prompt).toBe('edita esta foto como quieras');
  });

  it('el resto del trabajo sigue llegando entero', async () => {
    const job = await claim({ attachment: ADJUNTO });
    expect(job).toMatchObject({ shortId: 'LUX-E65B', provider: 'step', projectAlias: 'test' });
  });
});
