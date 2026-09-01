import { describe, it, expect, vi } from 'vitest';
import { agentConfigSchema, hostRequestSchema, hostResponseSchema } from '@luxy/shared';
import type { AgentConfig, ProviderExecution } from '@luxy/shared';
import { buildLocalJob, runLocalTurn, LocalTurnIsolationError } from './local-turn.js';
import type { AgentLogger } from './logger.js';

const TURN_ID = '44444444-4444-4444-8444-444444444444';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as AgentLogger;

function config(): AgentConfig {
  return agentConfigSchema.parse({
    machineName: 'equipo-de-pruebas',
    gatewayUrl: 'https://gateway.example',
    machineToken: 'x'.repeat(32),
    projects: {
      privado: { path: 'C:/no/existe/privado', type: 'other', allowEdits: false },
    },
  });
}

/**
 * proveedor falso: no hay red, no hay CLI, no hay tokens gastados.
 *
 * cumple ProviderRunResult al completo. El campo del texto es `finalText`, no
 * `text`: devolver la forma equivocada hacia fallar el turno con un
 * "Cannot read properties of undefined", que es justo lo que paso al escribirlo.
 */
function fakeProvider(text: string): ProviderExecution {
  return {
    id: 'claude',
    displayName: 'Proveedor de prueba',
    detect: async () => ({ available: true, version: 'falso' }),
    run: async () => ({
      ok: true,
      finalText: text,
      sessionId: null,
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      errorMessage: null,
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
  } as unknown as ProviderExecution;
}

describe('protocolo del turno privado', () => {
  it('acepta una peticion bien formada', () => {
    const parsed = hostRequestSchema.safeParse({
      type: 'run_local_turn',
      requestId: 'r1',
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'hola',
    });
    expect(parsed.success).toBe(true);
  });

  it('rechaza un identificador que no sea uuid', () => {
    const parsed = hostRequestSchema.safeParse({
      type: 'run_local_turn',
      requestId: 'r1',
      localTurnId: 'no-es-uuid',
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'hola',
    });
    expect(parsed.success).toBe(false);
  });

  it('rechaza un prompt vacio', () => {
    const parsed = hostRequestSchema.safeParse({
      type: 'run_local_turn',
      requestId: 'r1',
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('la respuesta lleva el texto y su final', () => {
    const parsed = hostResponseSchema.safeParse({
      type: 'local_turn',
      requestId: 'r1',
      localTurnId: TURN_ID,
      outcome: 'completed',
      text: 'la respuesta',
      error: null,
      executedModel: 'un-modelo',
      durationMs: 120,
      inputTokens: 10,
      outputTokens: 20,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('trabajo sintetico', () => {
  it('se marca como conversacion de solo lectura', () => {
    const job = buildLocalJob({
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'hola',
    });
    // esta etiqueta es la que impide worktree, escritura y comprobaciones
    expect(job.metadata['studioMode']).toBe('conversation');
    expect(job.metadata['luxyPrivateLocalTurn']).toBe(true);
  });

  it('no lleva identidad de telegram ni adjunto', () => {
    const job = buildLocalJob({
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'hola',
    });
    expect(job.telegramChatId).toBeNull();
    expect(job.telegramUserId).toBeNull();
    expect(job.attachment).toBeNull();
  });
});

describe('aislamiento del gateway', () => {
  const input = {
    localTurnId: TURN_ID,
    provider: 'claude',
    model: null,
    projectAlias: 'privado',
    prompt: 'un mensaje privado',
  };

  it('ejecuta el turno y devuelve la respuesta', async () => {
    const result = await runLocalTurn(input, new AbortController().signal, {
      config: config(),
      logger,
      getProvider: () => fakeProvider('respuesta del modelo'),
      worktreesDirectory: 'C:/no/se/usa',
      apiKeyFor: () => undefined,
      onProgress: () => undefined,
    });

    expect(result.outcome).toBe('completed');
    expect(result.text).toContain('respuesta del modelo');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(20);
  });

  it('no hace ni una sola peticion de red', async () => {
    // si algo intentara hablar con el gateway, pasaria por aqui
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await runLocalTurn(input, new AbortController().signal, {
        config: config(),
        logger,
        getProvider: () => fakeProvider('sin red'),
        worktreesDirectory: 'C:/no/se/usa',
        apiKeyFor: () => undefined,
        onProgress: () => undefined,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('el progreso llega a quien llama, no a una cola', async () => {
    const progreso: string[] = [];
    await runLocalTurn(input, new AbortController().signal, {
      config: config(),
      logger,
      getProvider: () => fakeProvider('con progreso'),
      worktreesDirectory: 'C:/no/se/usa',
      apiKeyFor: () => undefined,
      onProgress: (type) => progreso.push(type),
    });
    expect(progreso.length).toBeGreaterThan(0);
  });

  it('descargar un adjunto es un error explicito, no una llamada silenciosa', () => {
    const error = new LocalTurnIsolationError('descargar un adjunto');
    // si esta rama se ejecuta alguna vez, es que alguien rompio el aislamiento
    expect(error.message).toContain('pasaria por el gateway');
  });

  it('un proveedor ausente falla sin contactar con nadie', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const result = await runLocalTurn(input, new AbortController().signal, {
        config: config(),
        logger,
        getProvider: () => null,
        worktreesDirectory: 'C:/no/se/usa',
        apiKeyFor: () => undefined,
        onProgress: () => undefined,
      });
      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('no esta disponible');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('un proyecto que esta maquina no tiene falla igual', async () => {
    const result = await runLocalTurn(
      { ...input, projectAlias: 'inexistente' },
      new AbortController().signal,
      {
        config: config(),
        logger,
        getProvider: () => fakeProvider('nunca'),
        worktreesDirectory: 'C:/no/se/usa',
        apiKeyFor: () => undefined,
        onProgress: () => undefined,
      },
    );
    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('no tiene configurado el proyecto');
  });
});
