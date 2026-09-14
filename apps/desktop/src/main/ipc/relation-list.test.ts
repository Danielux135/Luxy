// los dos handlers de la lista para corregir: listar y decidir.
//
// Lo que se prueba aqui no es la proyeccion —eso es puro y va en
// `relation-review.test.ts`— sino lo que solo pasa al cruzar el IPC: que la
// cita se comprueba contra el turno REAL, que la decision se escribe por el
// carril del almacen y se devuelve ya aplicada, que un identificador que ya no
// existe no escribe nada, y que el registro no se lleva ni una palabra de lo
// que se dijo.
import { describe, it, expect, vi } from 'vitest';
import { RELATION_EXTRACTOR_VERSION, type RelationNote } from '@luxy/shared';

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
const { IPC_INVOKE, vaultRelationListResultSchema } = await import('../../shared/ipc.js');
const { noteId } = await import('../vault/relation.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const LIA = 'c0000000-3333-4333-8333-333333333333';

const CAFES = 'mañana te traigo dos cafés y una tarta de chocolate a la cama';

/** el texto de cada turno, tal y como esta hoy en la boveda */
const TURNOS: Record<string, { sequence: number; role: 'user' | 'assistant'; text: string }[]> = {
  [CONV_A]: [
    { sequence: 3, role: 'assistant', text: '¿y mañana que?' },
    { sequence: 4, role: 'user', text: `*sonrie* ${CAFES}, te lo juro` },
  ],
  // esta no tiene ninguna nota: si se descifra, es que se estan leyendo todas
  [CONV_B]: [{ sequence: 0, role: 'user', text: 'hola' }],
};

function stored(over: Partial<RelationNote> & { quote: string }): RelationNote {
  const origin = over.origin ?? {
    conversationId: CONV_A,
    sequence: 4,
    role: 'user' as const,
    at: '2026-09-04T20:00:00.000Z',
  };
  return {
    id: noteId(origin, over.quote),
    kind: 'promise',
    by: 'user',
    keywords: [],
    status: 'open',
    closure: null,
    source: 'extractor',
    decidedBy: 'extractor',
    reopenedByDaniel: false,
    extractedBy: 'codex',
    extractorVersion: RELATION_EXTRACTOR_VERSION,
    createdAt: '2026-09-04T20:05:00.000Z',
    updatedAt: '2026-09-04T20:05:00.000Z',
    ...over,
    origin,
  };
}

interface Huella {
  /** de que conversaciones se pidieron los turnos descifrados */
  leidas: string[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  notas: () => RelationNote[];
}

function registrar(notes: RelationNote[], unlocked = true): Huella {
  let guardadas = [...notes];
  const huella: Huella = {
    leidas: [],
    registros: [],
    notas: () => guardadas,
  };

  const context = {
    // `registerIpcHandlers` engancha el trabajo de fondo al cierre de la boveda
    // nada mas registrar
    vault: { isUnlocked: () => unlocked, onLock: () => () => undefined },
    privateConversations: {
      list: async () => [
        { conversationId: CONV_A, title: '', turns: 2, updatedAt: '', characterId: LIA },
        { conversationId: CONV_B, title: '', turns: 1, updatedAt: '', characterId: null },
      ],
      read: async (_vault: unknown, conversationId: string) => {
        huella.leidas.push(conversationId);
        return TURNOS[conversationId] ?? [];
      },
    },
    relations: {
      read: async () => ({
        notes: guardadas,
        cursors: [],
        counters: {},
        droppedOnRead: 0,
        unreadable: { notes: [], cursors: [] },
      }),
      apply: async (
        _vault: unknown,
        mutator: (current: { notes: RelationNote[]; cursors: unknown[]; counters: unknown }) => {
          notes: RelationNote[];
        },
      ) => {
        const next = mutator({ notes: guardadas, cursors: [], counters: {} });
        guardadas = next.notes;
        return next;
      },
    },
    privateMemory: { timeline: async () => [], invalidate: () => undefined },
    memoryPreferences: { auxiliary: () => null },
    controller: {},
    log: (mensaje: string, campos?: Record<string, unknown>) => {
      huella.registros.push({ mensaje, campos });
    },
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return huella;
}

type Respuesta = { ok: true; value: { notes: { id: string }[] } } | { ok: false; error: string };

async function invocar(channel: string, args: unknown): Promise<Respuesta> {
  const handler = canales.get(channel);
  if (handler === undefined) throw new Error(`el canal ${channel} no se registro`);
  return (await handler(null, args)) as Respuesta;
}

const listar = (): Promise<Respuesta> => invocar(IPC_INVOKE.vaultRelationList, {});
const decidir = (id: string, status: string): Promise<Respuesta> =>
  invocar(IPC_INVOKE.vaultRelationUpdate, { id, status });

describe('listar lo que quedo pendiente', () => {
  it('devuelve la cita literal y solo descifra las conversaciones que tienen algo', async () => {
    const huella = registrar([stored({ quote: CAFES })]);

    const respuesta = await listar();
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;

    expect(respuesta.value.notes).toHaveLength(1);
    expect(respuesta.value.notes[0]).toMatchObject({
      characterId: LIA,
      quote: CAFES,
      day: '2026-09-04',
      status: 'open',
      quoteBroken: false,
    });
    // la que no tiene notas no se descifra: leerlas todas costaria la boveda
    // entera en cada pulsacion de un boton
    expect(huella.leidas).toEqual([CONV_A]);
  });

  it('lo que sale cumple el contrato que el renderer da por hecho', async () => {
    // el handler no se comprueba contra su esquema en tiempo de ejecucion: es
    // un tipo, y un tipo no falla en produccion. Aqui si, porque la pantalla
    // lee `z.infer` de este esquema y un campo que faltara llegaria como
    // `undefined` sin que nadie se enterara
    registrar([
      stored({ quote: CAFES }),
      stored({
        quote: 'el sábado vamos juntos al mercado de las flores',
        by: 'both',
        kind: 'plan',
        status: 'fulfilled',
        closure: { how: 'fulfilled', ref: null, at: '2026-09-10T08:00:00.000Z' },
        decidedBy: 'daniel',
        reopenedByDaniel: true,
        extractedBy: null,
        origin: {
          conversationId: CONV_B,
          sequence: 0,
          role: 'user',
          at: '2026-09-06T12:00:00.000Z',
        },
      }),
    ]);

    const respuesta = await listar();
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    // sin esto la comprobacion pasaria con la lista vacia, que es justo lo que
    // no prueba nada
    expect(respuesta.value.notes).toHaveLength(2);
    expect(() => vaultRelationListResultSchema.parse(respuesta.value)).not.toThrow();
  });

  it('avisa de una cita que ya no esta en su turno', async () => {
    // el numero del turno se reutilizo: el mensaje de ahora dice otra cosa
    const huella = registrar([
      stored({
        quote: CAFES,
        origin: {
          conversationId: CONV_A,
          sequence: 3,
          role: 'user',
          at: '2026-09-04T20:00:00.000Z',
        },
      }),
    ]);

    const respuesta = await listar();
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    expect(respuesta.value.notes[0]).toMatchObject({ quoteBroken: true });
    expect(huella.leidas).toEqual([CONV_A]);
  });

  it('con la boveda cerrada no devuelve nada', async () => {
    registrar([stored({ quote: CAFES })], false);

    const respuesta = await listar();
    expect(respuesta.ok).toBe(false);
  });
});

describe('decidir sobre un pendiente', () => {
  it('lo deja cerrado, marcado como suyo, y devuelve la lista ya aplicada', async () => {
    const nota = stored({ quote: CAFES });
    const huella = registrar([nota]);

    const respuesta = await decidir(nota.id, 'fulfilled');
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;

    expect(respuesta.value.notes[0]).toMatchObject({
      status: 'fulfilled',
      decidedBy: 'daniel',
    });
    // y queda escrito, no solo devuelto
    expect(huella.notas()[0]).toMatchObject({ status: 'fulfilled', decidedBy: 'daniel' });
  });

  it('un identificador que ya no existe falla y no escribe nada', async () => {
    const nota = stored({ quote: CAFES });
    const huella = registrar([nota]);

    const respuesta = await decidir('0000000000000000', 'dismissed');
    expect(respuesta.ok).toBe(false);
    expect(huella.notas()[0]).toMatchObject({ status: 'open', decidedBy: 'extractor' });
  });

  it('rechaza un estado inventado antes de tocar el almacen', async () => {
    const nota = stored({ quote: CAFES });
    const huella = registrar([nota]);

    const respuesta = await decidir(nota.id, 'cumplida');
    expect(respuesta.ok).toBe(false);
    expect(huella.notas()[0]).toMatchObject({ status: 'open' });
  });

  it('con la boveda cerrada no escribe', async () => {
    const nota = stored({ quote: CAFES });
    const huella = registrar([nota], false);

    expect((await decidir(nota.id, 'fulfilled')).ok).toBe(false);
    expect(huella.notas()[0]).toMatchObject({ status: 'open' });
  });

  it('el registro no lleva la cita, ni el identificador, ni la conversacion', async () => {
    const nota = stored({ quote: CAFES, keywords: ['TARTA_SENTINEL'] });
    const huella = registrar([nota]);

    await decidir(nota.id, 'dismissed');

    const escrito = JSON.stringify(huella.registros);
    expect(escrito).toContain('pendiente corregido');
    expect(escrito).not.toContain('TARTA_SENTINEL');
    expect(escrito).not.toContain('cafés');
    expect(escrito).not.toContain(nota.id);
    expect(escrito).not.toContain(CONV_A);
  });
});
