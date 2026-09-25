// las notas de direccion contra la autocopia (`D-102`) en el turno privado.
//
// Lo que se compone esta probado en `packages/shared/src/vault-reply-guidance.test.ts`.
// Aqui va lo que solo pasa al cruzar el IPC: que el ajuste del PERSONAJE llega
// al prompt, que apagado no cambia nada, y que las dos lineas del registro
// dicen lo que de verdad viajo. Todo el texto es INVENTADO para la prueba.
import { describe, it, expect, vi } from 'vitest';
import {
  VAULT_REPLY_FORM_BODY,
  VAULT_REPLY_FORM_TITLE,
  VAULT_REPLY_INITIATIVE_BODY,
  VAULT_REPLY_INITIATIVE_TITLE,
} from '@luxy/shared';

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
const { vaultCharacterSchema } = await import('../vault/character-store.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV = 'bbbbbbbb-2222-4222-8222-222222222222';
const NORA = 'e0000000-5555-4555-8555-555555555555';

const INICIATIVA = `${VAULT_REPLY_INITIATIVE_TITLE}:\n${VAULT_REPLY_INITIATIVE_BODY}`;
const FORMA = `${VAULT_REPLY_FORM_TITLE}:\n${VAULT_REPLY_FORM_BODY}`;

/** historial alterno usuario/asistente de `total` turnos */
function historial(total: number): { role: 'user' | 'assistant'; text: string }[] {
  return Array.from({ length: total }, (_, i) =>
    i % 2 === 0
      ? { role: 'user' as const, text: `mensaje inventado ${String(i)}` }
      : { role: 'assistant' as const, text: `respuesta inventada ${String(i)} con varias palabras` },
  );
}

/**
 * el personaje tal y como lo devolveria el almacen.
 *
 * `guia` ausente es un registro anterior al campo: pasa por el mismo `parse()`
 * que el almacen y sale con su valor por defecto.
 */
function personaje(guia?: 'none' | 'vary-and-lead'): unknown {
  return vaultCharacterSchema.parse({
    characterId: NORA,
    imageProvider: 'xavira',
    xavira: { characterId: NORA, modelId: 'modelo-inventado' },
    description: 'Te llamas Nora.',
    label: 'Nora',
    avatarObjectKey: null,
    createdAt: '2026-09-04T10:00:00.000Z',
    ...(guia === undefined ? {} : { replyGuidance: guia }),
  });
}

interface Huella {
  prompts: string[];
  campos: (mensaje: string) => Record<string, unknown> | undefined;
}

interface Montaje {
  historia?: { role: 'user' | 'assistant'; text: string }[];
  /** lo que devuelve el almacen de personajes; vacio = el personaje no esta */
  personajes?: unknown[];
}

function montar(montaje: Montaje = {}): Huella {
  const registros: { mensaje: string; campos: Record<string, unknown> | undefined }[] = [];
  const huella: Huella = {
    prompts: [],
    campos: (mensaje) => registros.find((r) => r.mensaje === mensaje)?.campos,
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
        { conversationId: CONV, title: '', turns: turnos.length, updatedAt: '', characterId: NORA },
      ],
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
      latestCharacterId: async () => NORA,
      latestCharacterDescription: async () => 'Te llamas Nora.',
    },
    characters: { list: async () => montaje.personajes ?? [] },
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
      excluded: () => new Set([CONV]),
    },
    controller: {
      runLocalTurn: async (request: { prompt: string }) => {
        huella.prompts.push(request.prompt);
        return {
          outcome: 'completed',
          text: 'una respuesta inventada que no copia nada de lo anterior en absoluto',
          executedModel: 'modelo-inventado',
          inputTokens: 10,
          outputTokens: 20,
          durationMs: 1234,
          error: null,
        };
      },
    },
    log: (mensaje: string, campos?: Record<string, unknown>) => {
      registros.push({ mensaje, campos });
    },
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return huella;
}

async function enviar(mensaje: string): Promise<boolean> {
  const handler = canales.get(IPC_INVOKE.vaultConversationSend);
  if (handler === undefined) throw new Error('el canal de envio no se registro');
  const respuesta = (await handler(null, {
    conversationId: CONV,
    message: mensaje,
    provider: 'conexion-inventada',
    model: 'modelo-inventado',
    projectAlias: 'luxy',
  })) as { ok: boolean };
  return respuesta.ok;
}

describe('las notas de direccion en el turno privado', () => {
  it('un personaje anterior al ajuste no las lleva, y el registro lo dice', async () => {
    const huella = montar({ historia: historial(20), personajes: [personaje()] });

    expect(await enviar('hola')).toBe(true);
    expect(huella.prompts[0]).not.toContain('NOTA DE DIRECCION');
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      notaIniciativa: false,
      notaForma: false,
    });
    expect(huella.campos('copia de sus respuestas')).toMatchObject({ variedad: false });
  });

  it('encendidas viajan las dos, en su sitio, y las dos lineas lo dicen', async () => {
    const huella = montar({ historia: historial(20), personajes: [personaje('vary-and-lead')] });

    expect(await enviar('hola')).toBe(true);
    const prompt = huella.prompts[0] ?? '';
    expect(prompt).toContain(INICIATIVA);
    expect(prompt).toContain(FORMA);
    // la de tu parte detras del mensaje nuevo, la de la forma antes de la
    // instruccion de memoria, que sigue siendo lo ultimo
    expect(prompt.indexOf(INICIATIVA)).toBeGreaterThan(prompt.indexOf('MENSAJE NUEVO DEL USUARIO'));
    expect(prompt.indexOf(FORMA)).toBeGreaterThan(prompt.indexOf(INICIATIVA));
    expect(prompt.indexOf('<LUXY_MEMORY>')).toBeGreaterThan(prompt.indexOf(FORMA));

    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      notaIniciativa: true,
      notaForma: true,
    });
    expect(huella.campos('copia de sus respuestas')).toMatchObject({ variedad: true });
  });

  it('apagadas, el prompt es el mismo que encendidas quitando las dos notas', async () => {
    // demuestra que el handler no toca nada mas del prompt al leer el ajuste
    const apagado = montar({ historia: historial(20), personajes: [personaje('none')] });
    expect(await enviar('hola')).toBe(true);
    const encendido = montar({
      historia: historial(20),
      personajes: [personaje('vary-and-lead')],
    });
    expect(await enviar('hola')).toBe(true);

    const sinNotas = (encendido.prompts[0] ?? '')
      .replace(`\n\n${INICIATIVA}`, '')
      .replace(`\n\n${FORMA}`, '');
    expect(sinNotas).not.toBe(encendido.prompts[0]);
    expect(sinNotas).toBe(apagado.prompts[0]);
  });

  it('en el primer turno solo viaja la de tu parte: no hay respuestas suyas', async () => {
    // el registro sale de lo COMPUESTO, no del ajuste
    const huella = montar({ historia: [], personajes: [personaje('vary-and-lead')] });

    expect(await enviar('hola')).toBe(true);
    expect(huella.prompts[0]).toContain(INICIATIVA);
    expect(huella.prompts[0]).not.toContain(FORMA);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      notaIniciativa: true,
      notaForma: false,
    });
    expect(huella.campos('copia de sus respuestas')).toMatchObject({ variedad: true });
  });

  it('sin el personaje en la boveda no viajan', async () => {
    const huella = montar({ historia: historial(20), personajes: [] });

    expect(await enviar('hola')).toBe(true);
    expect(huella.prompts[0]).not.toContain('NOTA DE DIRECCION');
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      notaIniciativa: false,
      notaForma: false,
    });
  });
});
