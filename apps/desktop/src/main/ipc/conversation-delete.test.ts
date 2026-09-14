// borrar una conversacion privada: lo que tiene que pasar aunque algo falle.
//
// El handler toca cuatro sitios —medios, archivo, catalogo y pendientes— y
// termina invalidando la memoria episodica, que es la unica de las cinco cosas
// que guarda los turnos DESCIFRADOS en RAM. Los dos almacenes cifrados pueden
// pararse en seco (el de pendientes lo hace a proposito cuando su archivo no
// abre), asi que lo que se prueba aqui es que ese fallo no deja al personaje
// pudiendo citar lo que Daniel acaba de borrar.
import { describe, it, expect, vi } from 'vitest';

/** canales registrados por `registerIpcHandlers`, para poder invocarlos */
const canales = vi.hoisted(
  () => new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
);

// electron no existe fuera de electron: solo hace falta lo que se toca al
// REGISTRAR, que es el registro de canales
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
const { IPC_INVOKE } = await import('../../shared/channels.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV = '11111111-1111-4111-8111-111111111111';

/** lo que hizo cada pieza, para poder afirmar el orden y lo que se llamo */
interface Huella {
  invalidated: number;
  deleted: string[];
}

function registrar(relations: { removeConversation: () => Promise<void> }): Huella {
  const huella: Huella = { invalidated: 0, deleted: [] };
  const context = {
    // `registerIpcHandlers` engancha el trabajo de fondo al cierre de la boveda
    // nada mas registrar: sin estos dos, el registro ni siquiera llegaria a los
    // handlers que esta prueba quiere invocar
    vault: { isUnlocked: () => true, onLock: () => () => undefined },
    privateMedia: {
      deleteConversation: async (id: string) => {
        huella.deleted.push(`medios:${id}`);
      },
    },
    privateConversations: {
      delete: (id: string) => {
        huella.deleted.push(`archivo:${id}`);
      },
    },
    catalogs: { removeConversation: async () => undefined },
    relations,
    privateMemory: {
      invalidate: () => {
        huella.invalidated += 1;
      },
    },
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return huella;
}

async function borrar(): Promise<{ ok: boolean }> {
  const handler = canales.get(IPC_INVOKE.vaultConversationDelete);
  if (handler === undefined) throw new Error('el canal de borrado no se registro');
  return (await handler(null, { conversationId: CONV })) as { ok: boolean };
}

describe('borrar una conversacion privada', () => {
  it('borra y deja la memoria invalidada', async () => {
    const huella = registrar({ removeConversation: async () => undefined });

    expect(await borrar()).toMatchObject({ ok: true });
    expect(huella.deleted).toEqual([`medios:${CONV}`, `archivo:${CONV}`]);
    expect(huella.invalidated).toBe(1);
  });

  it('SI EL ALMACEN DE PENDIENTES FALLA, la memoria se invalida igual', async () => {
    const huella = registrar({
      removeConversation: async () => {
        // lo que lanza `RelationStore` cuando su archivo no abre: es fail-stop
        // a proposito, para no escribir encima de las decisiones de Daniel
        throw new Error('el indice de pendientes no se puede descifrar');
      },
    });

    // el borrado falla, y eso esta bien: hay que enterarse
    expect(await borrar()).toMatchObject({ ok: false });
    // pero la conversacion ya no esta en disco, asi que el indice con los
    // turnos descifrados no puede seguir sirviendolos como recuerdos
    expect(huella.invalidated).toBe(1);
  });
});
