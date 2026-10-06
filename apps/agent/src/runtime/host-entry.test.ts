// POR QUE EXISTE: host-entry construye el LocalTurnInput campo a campo, y un
// campo que no se copia no rompe nada visible: simplemente desaparece. Asi se
// perdio `kind`, y con el, el modo tecnico del catalogador — que se ejecutaba
// con el envoltorio de personaje sin que nadie lo notara. Estas pruebas fijan
// que el mensaje del protocolo llega entero al otro lado.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostResponseSchema } from '@luxy/shared';

/** peticiones que recibio el host simulado, en orden */
const recibidos: Array<Record<string, unknown>> = [];

/** si una prueba lo pone, el host simulado devuelve ESTO en vez del turno completado */
let siguienteResultado: Record<string, unknown> | null = null;

vi.mock('./host.js', () => ({
  AgentHost: class {
    subscribe(): void {
      /* el host simulado no emite eventos */
    }
    getStatus(): null {
      return null;
    }
    async runLocalTurn(input: Record<string, unknown>): Promise<Record<string, unknown>> {
      recibidos.push(input);
      if (siguienteResultado !== null) return siguienteResultado;
      return {
        outcome: 'completed',
        text: 'respuesta',
        error: null,
        executedModel: 'un-modelo',
        durationMs: 1,
        inputTokens: null,
        outputTokens: null,
        modelCalls: 1,
        responseOutcome: 'completed',
        memory: {
          version: 1,
          summary: 'lo que va pasando',
          facts: [],
          decisions: [],
          plan: [],
          openQuestions: [],
          lessons: [],
        },
        memoryStatus: 'structured',
      };
    }
  },
}));

/** puerto falso hacia el proceso padre: ni Electron ni utilityProcess */
class FakePort {
  readonly sent: Array<Record<string, unknown>> = [];
  private listener: ((message: { data: unknown }) => void) | null = null;

  on(_event: 'message', listener: (message: { data: unknown }) => void): void {
    this.listener = listener;
  }

  postMessage(message: unknown): void {
    this.sent.push(message as Record<string, unknown>);
  }

  start(): void {
    /* nada que arrancar */
  }

  deliver(data: unknown): void {
    this.listener?.({ data });
  }
}

const TURN_ID = '55555555-5555-4555-8555-555555555555';

/** arranca el punto de entrada con un puerto falso */
async function arrancar(): Promise<FakePort> {
  const { startHostEntry } = await import('./host-entry.js');
  const port = new FakePort();
  startHostEntry(port);
  return port;
}

function peticion(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'run_local_turn',
    requestId: 'r1',
    localTurnId: TURN_ID,
    provider: 'claude',
    model: null,
    projectAlias: 'privado',
    prompt: 'que ves aqui',
    ...extra,
  };
}

describe('host-entry: el turno privado llega entero', () => {
  const previo = { local: process.env['LOCALAPPDATA'], app: process.env['APPDATA'] };

  beforeAll(() => {
    // los logs y el estado NO deben caer en las carpetas reales de Luxy
    const temporal = mkdtempSync(join(tmpdir(), 'luxy-host-entry-'));
    process.env['LOCALAPPDATA'] = temporal;
    process.env['APPDATA'] = temporal;
  });

  // el proceso de vitest se reutiliza entre archivos: dejar el entorno tocado
  // haria que otra prueba escribiera en un temporal que ya no existe
  afterAll(() => {
    if (previo.local === undefined) delete process.env['LOCALAPPDATA'];
    else process.env['LOCALAPPDATA'] = previo.local;
    if (previo.app === undefined) delete process.env['APPDATA'];
    else process.env['APPDATA'] = previo.app;
  });

  beforeEach(() => {
    recibidos.length = 0;
    siguienteResultado = null;
  });

  it('reenvia kind, que antes se perdia y convertia un turno tecnico en roleplay', async () => {
    const port = await arrancar();

    port.deliver(peticion({ kind: 'technical' }));
    await vi.waitFor(() => expect(recibidos).toHaveLength(1));

    expect(recibidos[0]?.['kind']).toBe('technical');
  });

  it('reenvia las imagenes', async () => {
    const port = await arrancar();

    port.deliver(peticion({ images: [{ mimeType: 'image/webp', base64: 'AAAA' }] }));
    await vi.waitFor(() => expect(recibidos).toHaveLength(1));

    expect(recibidos[0]?.['images']).toEqual([{ mimeType: 'image/webp', base64: 'AAAA' }]);
  });

  it('un turno normal conserva el modo de conversacion por defecto', async () => {
    const port = await arrancar();

    port.deliver(peticion({}));
    await vi.waitFor(() => expect(recibidos).toHaveLength(1));

    expect(recibidos[0]?.['kind']).toBe('conversation');
    expect(recibidos[0]?.['images']).toEqual([]);
  });

  it('el texto de la respuesta vuelve por local_turn, no como evento', async () => {
    const port = await arrancar();

    port.deliver(peticion({}));
    await vi.waitFor(() => expect(port.sent.some((m) => m['type'] === 'local_turn')).toBe(true));

    const respuesta = port.sent.find((m) => m['type'] === 'local_turn');
    expect(respuesta?.['text']).toBe('respuesta');
    expect(port.sent.some((m) => m['type'] === 'event')).toBe(false);
  });

  it('la memoria vuelve aparte, junto al texto', async () => {
    // sin esto, el proceso principal la buscaba en un texto del que el
    // job-runner ya la habia quitado, y no se guardaba nunca
    const port = await arrancar();

    port.deliver(peticion({}));
    await vi.waitFor(() => expect(port.sent.some((m) => m['type'] === 'local_turn')).toBe(true));

    const respuesta = port.sent.find((m) => m['type'] === 'local_turn');
    expect(respuesta?.['memoryStatus']).toBe('structured');
    expect((respuesta?.['memory'] as { summary?: string } | undefined)?.summary).toBe(
      'lo que va pasando',
    );
  });

  it('el motivo de un fallo del CLI llega al proceso principal y el protocolo lo conserva', async () => {
    // sin este campo, el proceso principal solo tenia `error`, que es prosa,
    // para saber si a Claude Code le faltaba la sesion o si se habia negado
    siguienteResultado = {
      outcome: 'failed',
      text: '',
      error: 'Claude Code no tiene la sesion iniciada en este equipo.',
      executedModel: 'opus',
      durationMs: 1,
      inputTokens: null,
      outputTokens: null,
      modelCalls: null,
      responseOutcome: 'failed',
      failureReason: 'auth',
    };
    const port = await arrancar();

    port.deliver(peticion({}));
    await vi.waitFor(() => expect(port.sent.some((m) => m['type'] === 'local_turn')).toBe(true));

    const respuesta = port.sent.find((m) => m['type'] === 'local_turn');
    expect(respuesta?.['failureReason']).toBe('auth');
    // zod quita lo que no conoce: si el esquema no lo declarase, Studio no lo veria
    const parsed = hostResponseSchema.parse(respuesta);
    expect(parsed.type === 'local_turn' && parsed.failureReason).toBe('auth');
  });

  it('un turno sin fallo manda el motivo como null', async () => {
    const port = await arrancar();

    port.deliver(peticion({}));
    await vi.waitFor(() => expect(port.sent.some((m) => m['type'] === 'local_turn')).toBe(true));

    const respuesta = port.sent.find((m) => m['type'] === 'local_turn');
    expect(respuesta?.['failureReason']).toBeNull();
  });

  it('descarta un mensaje que no cumple el protocolo', async () => {
    const port = await arrancar();

    // cinco imagenes pasan del tope: el hijo no se fia del proceso principal
    port.deliver(
      peticion({
        images: Array.from({ length: 5 }, () => ({ mimeType: 'image/webp', base64: 'AAAA' })),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(recibidos).toHaveLength(0);
  });
});
