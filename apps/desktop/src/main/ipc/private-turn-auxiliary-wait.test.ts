// el turno privado que su CLI contesta acaba la espera del trabajo de fondo
// (duodecima ronda, `INV-FONDO-001`).
//
// La espera solo se enteraba de que el CLI contesta cuando le contestaba a OTRO
// trabajo de fondo, y ella misma impide lanzarlo: tras `claude auth login`, el
// aviso de «Claude Code no tiene la sesion iniciada» seguia en pantalla aunque
// Daniel ya estuviera hablando por Claude, y una conversacion que fallaba sola no
// veia nunca al CLI contestar a otra. Aqui se arma la espera por el catalogo, se
// manda un turno por los canales de verdad y se mira el estado que lee la
// pantalla. Sin CLI, sin red y sin tokens. Todo el texto es INVENTADO.
import { describe, it, expect, vi } from 'vitest';

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
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

/** la conversacion en la que escribe Daniel; fuera del trabajo de fondo */
const CONV = 'bbbbbbbb-2222-4222-8222-222222222222';
/** la que cataloga el trabajo de fondo */
const OTRA = 'cccccccc-3333-4333-8333-333333333333';
const LIA = 'c0000000-3333-4333-8333-333333333333';

interface Huella {
  /** como se lanzo cada llamada: `tecnico` es el trabajo de fondo */
  llamadas: { provider: string; tecnico: boolean }[];
}

interface Montaje {
  /** el turno de Daniel sale fallido */
  turnoFallido?: boolean;
}

function montar(montaje: Montaje = {}): Huella {
  const huella: Huella = { llamadas: [] };
  const turnos: {
    conversationId: string;
    sequence: number;
    role: 'user' | 'assistant';
    text: string;
    createdAt: string;
  }[] = [];
  const deOtra = [
    {
      conversationId: OTRA,
      sequence: 0,
      role: 'user' as const,
      text: 'hola inventado',
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      conversationId: OTRA,
      sequence: 1,
      role: 'assistant' as const,
      text: 'respuesta',
      createdAt: '2026-09-01T10:01:00.000Z',
    },
  ];

  const context = {
    vault: {
      isUnlocked: () => true,
      onLock: () => () => undefined,
      beginUserWait: () => () => undefined,
      derivationCount: 0,
      status: () => ({
        configured: true,
        unlocked: true,
        methods: { password: true, recovery: true, device: false },
        autoLockMinutes: 15,
        lockingInMs: null,
      }),
    },
    accounts: {
      status: () => ({
        email: null,
        signedIn: false,
        expiresAt: null,
        openedWithRecoveryKey: false,
      }),
    },
    secretStore: { get: () => undefined },
    catalogs: {
      list: async () => [],
      replaceForConversation: async () => undefined,
    },
    privateConversations: {
      list: async () => [
        { conversationId: CONV, title: '', turns: turnos.length, updatedAt: '', characterId: LIA },
        { conversationId: OTRA, title: '', turns: deOtra.length, updatedAt: '', characterId: null },
      ],
      read: async (_vault: unknown, conversationId: string) =>
        conversationId === OTRA
          ? deOtra.map((turno) => ({ ...turno }))
          : turnos.map((turno) => ({ ...turno })),
      appendTurn: async (
        _vault: unknown,
        conversationId: string,
        turno: { role: 'user' | 'assistant'; text: string },
      ) => {
        turnos.push({
          conversationId,
          sequence: turnos.length,
          role: turno.role,
          text: turno.text,
          createdAt: new Date().toISOString(),
        });
        return { recordId: `registro-${turnos.length}` };
      },
      removeLastTurn: () => turnos.pop(),
      latestMemory: async () => null,
      // el dueño se lee SOLO por `owner()` (`D-103`)
      owner: async () => ({
        characterId: LIA,
        characterDescription: 'Lia, inventada',
        instructions: null,
        characterLabel: null,
        source: 'turn' as const,
        signedAfter: 0,
        linkedAt: null,
        events: 0,
        winningEventId: null,
        instructionsSource: null,
      }),
    },
    characters: { list: async () => [] },
    privateMedia: { list: async () => [] },
    relations: {
      read: async () => ({
        notes: [],
        cursors: [],
        counters: {},
        droppedOnRead: 0,
        unreadable: { notes: [], cursors: [] },
      }),
      apply: async () => undefined,
    },
    privateMemory: {
      invalidate: () => undefined,
      search: async () => [],
      listEpisodes: async () => [],
      readEpisode: async () => [],
      timeline: async () => [],
      ownerOf: () => undefined,
      conversationsFor: () => new Set<string>(),
      turnAt: () => null,
    },
    memoryPreferences: {
      // Claude elegido para el trabajo de fondo, como lo tiene Daniel
      auxiliary: () => ({ provider: 'claude', model: null }),
      // la conversacion en la que se escribe no es lo que se mide aqui
      excluded: () => new Set([CONV]),
    },
    controller: {
      runLocalTurn: async (request: { provider: string; kind?: string }) => {
        const tecnico = request.kind === 'technical';
        huella.llamadas.push({ provider: request.provider, tecnico });
        // el trabajo de fondo se encuentra a Claude Code sin sesion
        if (tecnico) {
          return {
            outcome: 'failed',
            text: '',
            error: 'MENSAJE-DEL-AGENTE-INVENTADO: ejecuta claude auth login',
            executedModel: null,
            inputTokens: null,
            outputTokens: null,
            durationMs: 10,
            failureReason: 'auth',
          };
        }
        if (montaje.turnoFallido === true) {
          return {
            outcome: 'failed',
            text: '',
            error: 'MENSAJE-DEL-AGENTE-INVENTADO: no pudo terminar',
            executedModel: null,
            inputTokens: null,
            outputTokens: null,
            durationMs: 10,
            failureReason: 'api_error',
          };
        }
        return {
          outcome: 'completed',
          text: 'una respuesta inventada de Lia',
          executedModel: 'opus',
          inputTokens: 10,
          outputTokens: 20,
          durationMs: 10,
          error: null,
          failureReason: null,
        };
      },
    },
    log: () => undefined,
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return huella;
}

async function invocar<T>(canal: string, args: unknown): Promise<{ ok: boolean; value: T }> {
  const handler = canales.get(canal);
  if (handler === undefined) throw new Error(`el canal ${canal} no se registro`);
  return (await handler(null, args)) as { ok: boolean; value: T };
}

const estado = async () =>
  (await invocar<{ auxiliaryFailures?: unknown[] }>(IPC_INVOKE.vaultStatus, {})).value
    .auxiliaryFailures ?? [];

/** el catalogo de la otra: con Claude Code sin sesion, arma la espera */
const catalogar = () =>
  invocar(IPC_INVOKE.vaultCatalogSync, { provider: 'claude', projectAlias: 'luxy' });

const enviar = (provider: string, model: string | null) =>
  invocar<{ outcome: string }>(IPC_INVOKE.vaultConversationSend, {
    conversationId: CONV,
    message: 'hola, inventado',
    provider,
    model,
    projectAlias: 'luxy',
  });

describe('el turno de Daniel que su CLI contesta', () => {
  it('acaba la espera de una cuenta sin sesion: el aviso se va sin esperar al fondo', async () => {
    const huella = montar();
    await catalogar();
    expect(await estado()).toEqual([
      expect.objectContaining({ provider: 'claude', reason: 'auth', wholeProvider: true }),
    ]);

    // `claude auth login`, y Daniel sigue hablando con Lia por Claude
    const turno = await enviar('claude', 'opus');
    expect(turno.ok).toBe(true);
    expect(turno.value.outcome).toBe('completed');

    expect(await estado()).toEqual([]);
    // y el trabajo de fondo puede volver a probar sin boton
    await catalogar();
    expect(huella.llamadas.filter((each) => each.tecnico)).toHaveLength(2);
  });

  it('un turno por una API de pago no dice nada del CLI', async () => {
    montar();
    await catalogar();
    expect((await enviar('hcnsec', 'deepseek-v4-flash')).ok).toBe(true);
    expect(await estado()).toHaveLength(1);
  });

  it('un turno fallido tampoco: su pantalla ya lo enseña, y aqui no arma nada', async () => {
    montar({ turnoFallido: true });
    await catalogar();
    expect((await enviar('claude', 'opus')).ok).toBe(true);
    expect(await estado()).toEqual([
      expect.objectContaining({ provider: 'claude', reason: 'auth', wholeProvider: true }),
    ]);
  });
});
