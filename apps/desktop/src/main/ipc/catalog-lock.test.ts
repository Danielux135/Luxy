// una tanda de catalogo que la boveda corta al cerrarse (`D-106`, `D-088`).
//
// Leer ya no mantiene viva la boveda, asi que cerrarse a mitad de una pasada de
// fondo pasa a ser lo normal. Antes la conversacion quedaba marcada como
// fallida y fuera de las pasadas automaticas hasta reiniciar Studio, sin que
// ella tuviera culpa de nada. Todo el texto es INVENTADO.
import { describe, it, expect, vi } from 'vitest';
import { CATALOG_CLOSE, CATALOG_OPEN } from '@luxy/shared';

const canales = vi.hoisted(
  () => new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
);

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0', getPath: () => '' },
  dialog: {},
  shell: {},
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: {
    removeHandler: (channel: string) => {
      canales.delete(channel);
    },
    handle: (channel: string, fn: (event: unknown, args: unknown) => Promise<unknown>) => {
      canales.set(channel, fn);
    },
  },
  BrowserWindow: class {},
}));

const { registerIpcHandlers } = await import('./handlers.js');
const { IPC_INVOKE } = await import('../../shared/ipc.js');
const { VaultError } = await import('../vault/vault-service.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const PRIMERA = 'aaaaaaaa-1111-4111-8111-111111111111';
const SEGUNDA = 'bbbbbbbb-2222-4222-8222-222222222222';

const TEXTO: Record<string, string> = {
  [PRIMERA]: 'PRIMERA_CONVERSACION_INVENTADA',
  [SEGUNDA]: 'SEGUNDA_CONVERSACION_INVENTADA',
};

const escenas = `${CATALOG_OPEN}\n[{"from":0,"to":1,"title":"una escena","tags":["algo"],"summary":"pasa algo"}]\n${CATALOG_CLOSE}`;

interface Huella {
  boveda: { abierta: boolean };
  /** cerrar la boveda en la proxima llamada al CLI */
  cerrarEnLaLlamada: { valor: boolean };
  prompts: string[];
  guardadas: string[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
}

function montar(): Huella {
  const huella: Huella = {
    boveda: { abierta: true },
    cerrarEnLaLlamada: { valor: false },
    prompts: [],
    guardadas: [],
    registros: [],
  };
  const llave = (): void => {
    if (!huella.boveda.abierta) throw new VaultError('la boveda esta bloqueada');
  };
  const turnos = (conversationId: string) => [
    { conversationId, sequence: 0, role: 'user', text: TEXTO[conversationId], createdAt: '' },
    { conversationId, sequence: 1, role: 'assistant', text: 'respuesta', createdAt: '' },
  ];

  const context = {
    vault: {
      isUnlocked: () => huella.boveda.abierta,
      onLock: () => () => undefined,
      beginUserWait: () => () => undefined,
    },
    catalogs: {
      list: async () => {
        llave();
        return [];
      },
      replaceForConversation: async (_vault: unknown, conversationId: string) => {
        llave();
        huella.guardadas.push(conversationId);
      },
    },
    privateConversations: {
      list: async () => {
        llave();
        return [PRIMERA, SEGUNDA].map((conversationId) => ({
          conversationId,
          title: '',
          turns: 2,
          updatedAt: '',
          characterId: null,
        }));
      },
      read: async (_vault: unknown, conversationId: string) => {
        llave();
        return turnos(conversationId);
      },
    },
    memoryPreferences: {
      auxiliary: () => null,
      excluded: () => new Set<string>(),
    },
    privateMemory: { invalidate: () => undefined },
    controller: {
      runLocalTurn: async (request: { prompt: string }) => {
        huella.prompts.push(request.prompt);
        // Win+L o la X mientras el CLI cataloga
        if (huella.cerrarEnLaLlamada.valor) {
          huella.cerrarEnLaLlamada.valor = false;
          huella.boveda.abierta = false;
        }
        return {
          outcome: 'completed',
          text: escenas,
          executedModel: 'modelo-inventado',
          inputTokens: 1,
          outputTokens: 1,
          durationMs: 10,
          error: null,
        };
      },
    },
    log: (mensaje: string, campos?: Record<string, unknown>) => {
      huella.registros.push({ mensaje, campos });
    },
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return huella;
}

async function catalogar(): Promise<{ ok: boolean; value?: { cataloged: number; failed: unknown[] } }> {
  const handler = canales.get(IPC_INVOKE.vaultCatalogSync);
  if (handler === undefined) throw new Error('el canal del catalogo no se registro');
  return (await handler(null, { provider: 'codex', projectAlias: 'luxy' })) as {
    ok: boolean;
    value?: { cataloged: number; failed: unknown[] };
  };
}

describe('el catalogo cortado por el cierre de la boveda', () => {
  it('no lanza, no marca la conversacion y la vuelve a pedir al reabrir', async () => {
    const huella = montar();
    huella.cerrarEnLaLlamada.valor = true;

    const primera = await catalogar();
    expect(primera.ok).toBe(true);
    expect(primera.value).toMatchObject({ cataloged: 0, failed: [] });
    // se paro en la primera: la segunda no se le mando a nadie
    expect(huella.prompts).toHaveLength(1);
    expect(huella.prompts[0]).toContain(TEXTO[PRIMERA]);
    const linea = huella.registros.find((r) => r.mensaje === 'escenas catalogadas')?.campos;
    expect(linea).toMatchObject({ fallidas: 0, cortadaPorCierre: true });

    // al reabrir, la pasada automatica la vuelve a incluir: no quedo marcada
    huella.boveda.abierta = true;
    const segunda = await catalogar();
    expect(segunda.value).toMatchObject({ cataloged: 2, failed: [] });
    expect(huella.guardadas).toEqual([PRIMERA, SEGUNDA]);
    expect(huella.prompts[1]).toContain(TEXTO[PRIMERA]);
    const ultima = huella.registros.filter((r) => r.mensaje === 'escenas catalogadas').at(-1);
    expect(ultima?.campos).toMatchObject({ cortadaPorCierre: false });
  });

  it('sin cierre, la linea lo dice', async () => {
    const huella = montar();
    await catalogar();
    const linea = huella.registros.find((r) => r.mensaje === 'escenas catalogadas')?.campos;
    expect(linea).toMatchObject({ conversaciones: 2, cortadaPorCierre: false });
    // el texto de las conversaciones no llega al registro
    expect(JSON.stringify(huella.registros)).not.toContain('CONVERSACION_INVENTADA');
  });
});
