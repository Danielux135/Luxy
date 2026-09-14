// borrar una conversacion privada: lo que tiene que pasar aunque algo falle.
//
// El handler toca cinco sitios —medios, archivo, catalogo, pendientes y la
// memoria retroactiva— y termina invalidando la memoria episodica, que es la
// unica de las seis cosas que guarda los turnos DESCIFRADOS en RAM. Los tres
// almacenes cifrados pueden pararse en seco (el de pendientes lo hace a
// proposito cuando su archivo no abre), asi que lo que se prueba aqui es que ese
// fallo no deja al personaje pudiendo citar lo que Daniel acaba de borrar.
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

function registrar(
  relations: { removeConversation: () => Promise<void> },
  catalogs: { removeConversation: () => Promise<void> } = {
    removeConversation: async () => undefined,
  },
): Huella {
  const huella: Huella = { invalidated: 0, deleted: [] };
  const context = {
    recaps: {
      removeConversation: async (_vault: unknown, id: string) => {
        huella.deleted.push(`recap:${id}`);
      },
    },
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
    catalogs,
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
    expect(huella.deleted).toEqual([`medios:${CONV}`, `archivo:${CONV}`, `recap:${CONV}`]);
    expect(huella.invalidated).toBe(1);
  });

  it('SE LLEVA TAMBIEN SU MEMORIA RETROACTIVA', async () => {
    // un recap es un resumen de lo que se dijo ahi dentro: dejarlo seria
    // conservar cifrado en disco justo lo que Daniel acaba de mandar borrar, y
    // ademas seguiria viajando en el prompt si la conversacion se recreara con
    // el mismo identificador
    const huella = registrar({ removeConversation: async () => undefined });

    expect(await borrar()).toMatchObject({ ok: true });
    expect(huella.deleted).toContain(`recap:${CONV}`);
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

  it('Y SU MEMORIA RETROACTIVA SE VA IGUAL, aunque los pendientes revienten', async () => {
    // encadenados en un solo `try`, el fallo de uno cancelaba a los que venian
    // detras. Lo que quedaba en disco era el resumen de lo que se dijo en la
    // conversacion que Daniel acaba de mandar borrar, y ademas inalcanzable: sin
    // conversacion no hay fila, y sin fila no hay «Borrarlo»
    const huella = registrar({
      removeConversation: async () => {
        throw new Error('el indice de pendientes no se puede descifrar');
      },
    });

    expect(await borrar()).toMatchObject({ ok: false });
    expect(huella.deleted).toContain(`recap:${CONV}`);
  });

  it('y tambien cuando el que revienta es el CATALOGO', async () => {
    // el catalogo va delante de los otros dos, asi que era el que mas se los
    // llevaba por delante. Y la boveda puede bloquearse sola entre dos `await`,
    // que no necesita ningun archivo corrupto
    const huella = registrar(
      { removeConversation: async () => undefined },
      {
        removeConversation: async () => {
          throw new Error('la boveda esta bloqueada');
        },
      },
    );

    expect(await borrar()).toMatchObject({ ok: false });
    expect(huella.deleted).toContain(`recap:${CONV}`);
    expect(huella.invalidated).toBe(1);
  });
});
