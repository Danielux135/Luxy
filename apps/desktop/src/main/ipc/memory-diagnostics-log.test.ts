// lo que «Comprobar la memoria» escribe en el registro.
//
// El turno privado se guarda a proposito de registrar POR QUE fallo la seleccion
// de pendientes: un error de validacion trae dentro el dato que no valido, y ese
// dato es una cita de la boveda. El diagnostico hacia lo contrario —escribia
// `String(error)` entero— sobre las mismas tres lecturas que descifran: el
// almacen de pendientes, el historial y el catalogo. `redact` tapa secretos, no
// la boveda, asi que una cita o el uuid de una conversacion acababan en
// `studio.log` con solo pulsar un boton.
//
// Aqui se mide eso y nada mas: que el registro dice que no se pudo y no que
// decia, y que el resto del diagnostico sale igual.
import { describe, it, expect, vi } from 'vitest';

/** canales registrados por `registerIpcHandlers`, para poder invocarlos */
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
const { tokenize } = await import('../vault/turn-index.js');
const { VaultError } = await import('../vault/vault-service.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV = 'aaaaaaaa-1111-4111-8111-111111111111';
const LIA = 'c0000000-3333-4333-8333-333333333333';
const AYER = '2026-09-13T18:00:00.000Z';

const TURNOS = [
  {
    conversationId: CONV,
    sequence: 0,
    role: 'user' as const,
    text: 'mañana te traigo dos cafés y una TARTA_SENTINEL de chocolate a la cama',
    createdAt: AYER,
  },
  {
    conversationId: CONV,
    sequence: 1,
    role: 'assistant' as const,
    text: 'mas te vale',
    createdAt: '2026-09-13T18:01:00.000Z',
  },
];

interface Registro {
  mensaje: string;
  campos: Record<string, unknown> | undefined;
}

function montar(fallo?: Error): { registros: Registro[] } {
  const registros: Registro[] = [];

  const context = {
    vault: { isUnlocked: () => true, onLock: () => () => undefined },
    privateConversations: {
      list: async () => [
        { conversationId: CONV, title: '', turns: 2, updatedAt: AYER, characterId: LIA },
      ],
      read: async () => TURNOS,
      latestMemory: async () => null,
      latestInstructions: async () => null,
      latestCharacterId: async () => LIA,
      latestCharacterDescription: async () => null,
    },
    characters: { list: async () => [{ characterId: LIA, label: 'Lía' }] },
    privateMedia: { list: async () => [] },
    secretStore: { get: () => undefined },
    catalogs: { list: async () => [] },
    relations: {
      read: async () => {
        if (fallo !== undefined) throw fallo;
        return {
          notes: [],
          cursors: [],
          counters: {},
          droppedOnRead: 0,
          unreadable: { notes: [], cursors: [] },
        };
      },
      apply: async () => undefined,
    },
    privateMemory: {
      invalidate: () => undefined,
      search: async () => [],
      listEpisodes: async () => [],
      readEpisode: async () => [],
      timeline: async () =>
        TURNOS.map((turno) => ({
          conversationId: turno.conversationId,
          sequence: turno.sequence,
          role: turno.role,
          createdAt: turno.createdAt,
          stems: new Set(tokenize(turno.text)),
        })),
      conversationsFor: () => new Set([CONV]),
      turnAt: (conversationId: string, sequence: number) =>
        TURNOS.find(
          (turno) => turno.conversationId === conversationId && turno.sequence === sequence,
        ) ?? null,
    },
    memoryPreferences: { auxiliary: () => null, excluded: () => new Set<string>() },
    controller: { runLocalTurn: async () => ({ outcome: 'completed', text: '' }) },
    log: (mensaje: string, campos?: Record<string, unknown>) => {
      registros.push({ mensaje, campos });
    },
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return { registros };
}

type Respuesta = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

async function comprobar(): Promise<Respuesta> {
  const handler = canales.get(IPC_INVOKE.vaultMemoryDiagnostics);
  if (handler === undefined) throw new Error('el canal del diagnostico no se registro');
  return (await handler(null, {})) as Respuesta;
}

describe('«Comprobar la memoria» y el registro', () => {
  it('si el almacen de pendientes no se abre, se dice QUE fallo y no que decia', async () => {
    const { registros } = montar(new Error('nota invalida: «TARTA_SENTINEL de chocolate»'));

    const respuesta = await comprobar();
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    // el resto del diagnostico sale igual: perder tambien las cifras de la
    // memoria dejaria a Daniel sin nada que mirar
    expect(respuesta.value.relations).toBeUndefined();
    expect(respuesta.value.conversations).toBeDefined();

    const escrito = JSON.stringify(registros);
    expect(escrito).toContain('diagnostico de pendientes fallido');
    expect(escrito).not.toContain('TARTA_SENTINEL');
    expect(escrito).not.toContain('chocolate');
    expect(escrito).not.toContain(CONV);

    const campos = registros.find((r) => r.mensaje === 'diagnostico de pendientes fallido')?.campos;
    expect(campos).toEqual({ leido: false, causa: 'otro' });
  });

  it('y se distingue la boveda cerrada de un archivo roto, sin decir mas', async () => {
    const { registros } = montar(new VaultError('la boveda esta bloqueada'));

    expect((await comprobar()).ok).toBe(true);
    expect(
      registros.find((r) => r.mensaje === 'diagnostico de pendientes fallido')?.campos,
    ).toEqual({ leido: false, causa: 'boveda' });
  });

  it('cuando si se abre, las cifras van al registro y no hay linea de fallo', async () => {
    // sin esto la prueba de arriba pasaria tambien con el diagnostico apagado
    const { registros } = montar();

    const respuesta = await comprobar();
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    expect(respuesta.value.relations).toBeDefined();

    expect(registros.some((r) => r.mensaje === 'diagnostico de pendientes fallido')).toBe(false);
    const memoria = registros.find((r) => r.mensaje === 'diagnostico de memoria')?.campos;
    expect(memoria?.relaciones).toBeDefined();
    // y siguen siendo cifras: ni la cita del turno ni el uuid
    expect(JSON.stringify(memoria?.relaciones)).not.toContain('TARTA_SENTINEL');
    expect(JSON.stringify(memoria?.relaciones)).not.toContain(CONV);
  });
});
