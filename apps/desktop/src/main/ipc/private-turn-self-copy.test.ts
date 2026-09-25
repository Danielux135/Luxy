// la linea 'copia de sus respuestas' del turno privado de pago.
//
// La medida en si es pura y se prueba en `packages/shared/src/self-copy.test.ts`.
// Aqui va lo que solo pasa al cruzar el IPC: que se mide contra lo que de verdad
// viajo, que al registro solo salen cifras, y que un fallo de la medida no
// cuesta el turno. Todo el texto es INVENTADO para la prueba.
import { describe, it, expect, vi } from 'vitest';
import type * as Shared from '@luxy/shared';

/** canales registrados por `registerIpcHandlers`, para poder invocarlos */
const canales = vi.hoisted(
  () => new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
);

/** si la medida tiene que reventar, y con que mensaje */
const fallo = vi.hoisted(() => ({ mensaje: null as string | null }));

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

// solo se sustituye la medida, y solo cuando una prueba lo pide: el resto del
// paquete es el de verdad, incluida la ventana que decide `selfCopyReferences`
vi.mock('@luxy/shared', async (importOriginal) => {
  const real = await importOriginal<typeof Shared>();
  return {
    ...real,
    measureSelfCopy: (...args: Parameters<typeof real.measureSelfCopy>) => {
      if (fallo.mensaje !== null) throw new Error(fallo.mensaje);
      return real.measureSelfCopy(...args);
    },
  };
});

const { registerIpcHandlers } = await import('./handlers.js');
const { IPC_INVOKE } = await import('../../shared/ipc.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV = 'bbbbbbbb-2222-4222-8222-222222222222';
const LIA = 'c0000000-3333-4333-8333-333333333333';

/** n palabras inventadas, distintas de las de cualquier otro prefijo */
function palabras(prefijo: string, cuantas: number): string {
  return Array.from({ length: cuantas }, (_, i) => `${prefijo}${String(i)}`).join(' ');
}

/** su respuesta numero `i` del historial falso */
function suya(i: number): string {
  return `*HISTORIAL_SENTINEL* ${palabras(`r${String(i)}x`, 10)}`;
}

/** historial alterno usuario/asistente de `total` turnos */
function historial(total: number): { role: 'user' | 'assistant'; text: string }[] {
  return Array.from({ length: total }, (_, i) =>
    i % 2 === 0
      ? { role: 'user' as const, text: `mensaje ${String(i)}` }
      : { role: 'assistant' as const, text: suya(i) },
  );
}

interface Huella {
  prompts: string[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  campos: (mensaje: string) => Record<string, unknown> | undefined;
}

interface Montaje {
  historia?: { role: 'user' | 'assistant'; text: string }[];
  respuesta?: string;
  turnoFallido?: boolean;
}

function montar(montaje: Montaje = {}): Huella {
  const huella: Huella = {
    prompts: [],
    registros: [],
    campos: (mensaje) => huella.registros.find((r) => r.mensaje === mensaje)?.campos,
  };
  const turnos = (montaje.historia ?? []).map((turno, sequence) => ({
    conversationId: CONV,
    sequence,
    role: turno.role,
    text: turno.text,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  }));

  const context = {
    vault: { isUnlocked: () => true, onLock: () => () => undefined },
    privateConversations: {
      list: async () => [
        { conversationId: CONV, title: '', turns: turnos.length, updatedAt: '', characterId: LIA },
      ],
      // copia nueva en cada lectura, como el almacen de verdad
      read: async () => turnos.map((turno) => ({ ...turno })),
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
      },
      removeLastTurn: () => turnos.pop(),
      latestMemory: async () => null,
      latestInstructions: async () => null,
      latestCharacterId: async () => LIA,
      latestCharacterDescription: async () => 'Lia, veinticuatro años',
    },
    characters: { list: async () => [] },
    privateMedia: { list: async () => [] },
    secretStore: { get: () => undefined },
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
      conversationsFor: () => new Set<string>(),
      turnAt: () => null,
    },
    memoryPreferences: {
      auxiliary: () => null,
      // el trabajo de fondo no es lo que se mide aqui
      excluded: () => new Set([CONV]),
    },
    controller: {
      runLocalTurn: async (request: { prompt: string }) => {
        huella.prompts.push(request.prompt);
        if (montaje.turnoFallido === true) {
          return {
            outcome: 'failed',
            text: '',
            executedModel: null,
            inputTokens: null,
            outputTokens: null,
            durationMs: 1234,
            error: 'el proveedor devolvio 429',
          };
        }
        return {
          outcome: 'completed',
          text: montaje.respuesta ?? palabras('nueva', 20),
          executedModel: 'deepseek-v4-flash',
          inputTokens: 10,
          outputTokens: 20,
          durationMs: 1234,
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

type Respuesta =
  | { ok: true; value: { outcome: string; userTurnKept: boolean; turns: unknown[] } }
  | { ok: false; error: string };

async function enviar(mensaje: string): Promise<Respuesta> {
  const handler = canales.get(IPC_INVOKE.vaultConversationSend);
  if (handler === undefined) throw new Error('el canal de envio no se registro');
  return (await handler(null, {
    conversationId: CONV,
    message: mensaje,
    provider: 'hcnsec',
    model: 'deepseek-v4-flash',
    projectAlias: 'luxy',
  })) as Respuesta;
}

describe('la copia de sus respuestas en el turno privado', () => {
  it('registra cuanto copio de la ventana y del control, con proveedor y modelo', async () => {
    // veinte turnos: la cola de ocho lleva sus respuestas 13, 15, 17 y 19, y el
    // control son las cuatro de antes. La nueva copia diez palabras de la 19
    const huella = montar({
      historia: historial(20),
      respuesta: `${palabras('r19x', 10)} ${palabras('nueva', 10)}`,
    });
    fallo.mensaje = null;

    expect((await enviar('sigue')).ok).toBe(true);
    expect(huella.campos('copia de sus respuestas')).toEqual({
      conversacion: CONV,
      proveedor: 'hcnsec',
      modelo: 'deepseek-v4-flash',
      final: 'completed',
      variedad: false,
      palabrasPorGrupo: 6,
      grupos: 15,
      ventana: { respuestas: 4, copiados: 5, racha: 10, aperturas: 1, cierres: 0 },
      control: {
        respuestas: 4,
        copiados: 0,
        racha: 0,
        aperturas: 0,
        cierres: 0,
        excluidas: 0,
      },
      // las diez palabras de la 19 no estaban en las de antes: copia reciente
      soloVentana: 5,
      copiaError: false,
    });
  });

  it('se mide contra lo que viajo: lo copiado del control cuenta en el control', async () => {
    // la 5 es del control (anterior a la cola de ocho), no de la ventana
    const huella = montar({
      historia: historial(20),
      respuesta: `${palabras('nueva', 10)} ${palabras('r5x', 10)}`,
    });
    fallo.mensaje = null;

    expect((await enviar('sigue')).ok).toBe(true);
    expect(huella.campos('copia de sus respuestas')).toMatchObject({
      ventana: { copiados: 0, cierres: 0 },
      control: { copiados: 5, racha: 10, cierres: 1 },
      soloVentana: 0,
    });
  });

  it('en el primer turno no hay control, y la ventana esta vacia', async () => {
    const huella = montar({ historia: [] });
    fallo.mensaje = null;

    expect((await enviar('hola')).ok).toBe(true);
    expect(huella.campos('copia de sus respuestas')).toMatchObject({
      grupos: 15,
      ventana: { respuestas: 0, copiados: 0 },
      control: null,
      soloVentana: null,
      copiaError: false,
    });
  });

  it('ni una palabra del historial ni de la respuesta llega al registro', async () => {
    const huella = montar({
      historia: historial(20),
      // el centinela al FINAL: al principio, su «sentinel» casaria con el del
      // historial —el guion bajo separa palabras— y sumaria un grupo mas
      respuesta: `${palabras('r19x', 10)} ${palabras('nueva', 10)} *RESPUESTA_SENTINEL*`,
    });
    fallo.mensaje = null;

    expect((await enviar('MENSAJE_SENTINEL')).ok).toBe(true);
    // sin esto la comprobacion pasaria con todo apagado: el historial TIENE que
    // haber viajado, y la medida tiene que haber contado de verdad
    expect(huella.prompts[0] ?? '').toContain('HISTORIAL_SENTINEL');
    expect(huella.campos('copia de sus respuestas')).toMatchObject({
      ventana: { copiados: 5 },
    });

    const escrito = JSON.stringify(huella.registros);
    for (const centinela of [
      'HISTORIAL_SENTINEL',
      'RESPUESTA_SENTINEL',
      'MENSAJE_SENTINEL',
      'r19x0',
      'nueva0',
    ]) {
      expect(escrito).not.toContain(centinela);
    }
  });

  it('una respuesta mas corta que un grupo deja las cifras en null, no en cero', async () => {
    const huella = montar({ historia: historial(20), respuesta: 'vale, te espero' });
    fallo.mensaje = null;

    expect((await enviar('sigue')).ok).toBe(true);
    expect(huella.campos('copia de sus respuestas')).toMatchObject({
      grupos: null,
      ventana: null,
      control: null,
      soloVentana: null,
      copiaError: false,
    });
  });

  it('una llamada fallida no escribe la linea', async () => {
    const huella = montar({ historia: historial(20), turnoFallido: true });
    fallo.mensaje = null;

    expect((await enviar('sigue')).ok).toBe(true);
    // el turno terminado si consta: lo que falta es solo la medida
    expect(huella.campos('turno privado terminado')).toBeDefined();
    expect(huella.campos('copia de sus respuestas')).toBeUndefined();
  });

  it('si la medida revienta el turno sale entero y solo consta que fallo', async () => {
    const huella = montar({ historia: historial(4), respuesta: palabras('nueva', 20) });
    fallo.mensaje = 'no se pudo medir «FALLO_SENTINEL»';

    try {
      const respuesta = await enviar('sigue');
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(respuesta.value.outcome).toBe('completed');
      expect(respuesta.value.userTurnKept).toBe(true);
      // cuatro de antes, el mensaje y la respuesta
      expect(respuesta.value.turns).toHaveLength(6);
    } finally {
      fallo.mensaje = null;
    }

    expect(huella.campos('copia de sus respuestas')).toMatchObject({
      grupos: null,
      ventana: null,
      control: null,
      soloVentana: null,
      copiaError: true,
    });
    // el motivo no se registra: podria llevar dentro lo que se estaba midiendo
    expect(JSON.stringify(huella.registros)).not.toContain('FALLO_SENTINEL');
  });
});
