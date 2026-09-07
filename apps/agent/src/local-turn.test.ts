import { describe, it, expect, vi } from 'vitest';
import { agentConfigSchema, hostRequestSchema, hostResponseSchema } from '@luxy/shared';
import type { AgentConfig, ProviderExecution, ProviderRunRequest } from '@luxy/shared';
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
function fakeProvider(text: string, modelCalls = 1): ProviderExecution {
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
      callMetrics: { modelCalls, toolCalls: 0 },
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

  // el tope no es decorativo: cada imagen paga tokens de entrada en cada vuelta
  // y el mensaje cruza dos procesos por memoria
  it('acepta cuatro imagenes, que es el tope', () => {
    const parsed = hostRequestSchema.safeParse({
      type: 'run_local_turn',
      requestId: 'r1',
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'que ves',
      images: Array.from({ length: 4 }, () => ({ mimeType: 'image/webp', base64: 'AAAA' })),
    });
    expect(parsed.success).toBe(true);
  });

  it('rechaza cinco imagenes', () => {
    const parsed = hostRequestSchema.safeParse({
      type: 'run_local_turn',
      requestId: 'r1',
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'que ves',
      images: Array.from({ length: 5 }, () => ({ mimeType: 'image/webp', base64: 'AAAA' })),
    });
    expect(parsed.success).toBe(false);
  });

  it('sin imagenes el campo llega como lista vacia', () => {
    const parsed = hostRequestSchema.safeParse({
      type: 'run_local_turn',
      requestId: 'r1',
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'hola',
    });
    expect(parsed.success && parsed.data.type === 'run_local_turn' && parsed.data.images).toEqual(
      [],
    );
  });

  // si el prefijo entrase aqui, quien compone la peticion generaria
  // `data:...;base64,data:...` y el proveedor devolveria un 400 opaco
  it('rechaza un base64 que ya trae el prefijo data:', () => {
    const parsed = hostRequestSchema.safeParse({
      type: 'run_local_turn',
      requestId: 'r1',
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'que ves',
      images: [{ mimeType: 'image/png', base64: 'data:image/png;base64,AAAA' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rechaza un tipo que no sea de imagen', () => {
    const parsed = hostRequestSchema.safeParse({
      type: 'run_local_turn',
      requestId: 'r1',
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'que ves',
      images: [{ mimeType: 'application/pdf', base64: 'AAAA' }],
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

describe('imagenes del turno privado', () => {
  /** proveedor que guarda la peticion recibida; sigue sin red y sin CLI */
  function spyProvider(capturado: { request: ProviderRunRequest | null }): ProviderExecution {
    return {
      id: 'claude',
      displayName: 'Proveedor de prueba',
      // declara que su transporte lleva imagenes, como el de chat completions.
      // Sin esto el turno se rechaza antes de gastar la llamada, que es justo
      // lo que comprueba la prueba de mas abajo
      acceptsImages: true,
      detect: async () => ({ available: true, version: 'falso' }),
      run: async (request: ProviderRunRequest) => {
        capturado.request = request;
        return {
          ok: true,
          finalText: 'lo veo',
          sessionId: null,
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          errorMessage: null,
          usage: { inputTokens: 1, outputTokens: 1 },
          callMetrics: { modelCalls: 1, toolCalls: 0 },
        };
      },
    } as unknown as ProviderExecution;
  }

  it('las imagenes llegan hasta el proveedor', async () => {
    const capturado: { request: ProviderRunRequest | null } = { request: null };

    await runLocalTurn(
      {
        localTurnId: TURN_ID,
        provider: 'claude',
        model: null,
        projectAlias: 'privado',
        prompt: 'que ves',
        images: [{ mimeType: 'image/webp', base64: 'AAAA' }],
      },
      new AbortController().signal,
      {
        config: config(),
        logger,
        getProvider: () => spyProvider(capturado),
        worktreesDirectory: 'C:/no/se/usa',
        apiKeyFor: () => undefined,
        onProgress: () => undefined,
      },
    );

    expect(capturado.request?.images).toEqual([{ mimeType: 'image/webp', base64: 'AAAA' }]);
  });

  it('un proveedor que no lleva imagenes falla ANTES de gastar la llamada', async () => {
    // POR QUE, y paso de verdad: Claude Code y Codex reciben el prompt por
    // stdin y no tienen por donde mandar una imagen, asi que la descartaban en
    // SILENCIO. El turno salia «completado» y el modelo contestaba «no hay
    // ninguna imagen adjunta»; esa frase se guardaba como pie de foto de una
    // imagen de la boveda, y el personaje creia que la foto ES esa frase.
    const capturado: { request: ProviderRunRequest | null } = { request: null };
    const sinImagenes = {
      ...spyProvider(capturado),
      acceptsImages: false,
    } as unknown as ProviderExecution;

    const resultado = await runLocalTurn(
      {
        localTurnId: TURN_ID,
        provider: 'claude',
        model: null,
        projectAlias: 'privado',
        prompt: 'que ves',
        images: [{ mimeType: 'image/webp', base64: 'AAAA' }],
      },
      new AbortController().signal,
      {
        config: config(),
        logger,
        getProvider: () => sinImagenes,
        worktreesDirectory: 'C:/no/se/usa',
        apiKeyFor: () => undefined,
        onProgress: () => undefined,
      },
    );

    expect(resultado.outcome).toBe('failed');
    expect(resultado.error).toContain('no puede recibir imagenes');
    // y la llamada NO se hizo: es la mitad del arreglo
    expect(capturado.request).toBeNull();
  });

  it('un turno SIN imagenes funciona con ese mismo proveedor', async () => {
    // no se puede romper el camino normal por arreglar el de las imagenes:
    // Claude y Codex siguen siendo los proveedores de texto de siempre
    const capturado: { request: ProviderRunRequest | null } = { request: null };
    const sinImagenes = {
      ...spyProvider(capturado),
      acceptsImages: false,
    } as unknown as ProviderExecution;

    const resultado = await runLocalTurn(
      {
        localTurnId: TURN_ID,
        provider: 'claude',
        model: null,
        projectAlias: 'privado',
        prompt: 'hola',
      },
      new AbortController().signal,
      {
        config: config(),
        logger,
        getProvider: () => sinImagenes,
        worktreesDirectory: 'C:/no/se/usa',
        apiKeyFor: () => undefined,
        onProgress: () => undefined,
      },
    );

    expect(resultado.outcome).toBe('completed');
    expect(capturado.request).not.toBeNull();
  });

  it('un turno sin imagenes no manda el campo', async () => {
    const capturado: { request: ProviderRunRequest | null } = { request: null };

    await runLocalTurn(
      {
        localTurnId: TURN_ID,
        provider: 'claude',
        model: null,
        projectAlias: 'privado',
        prompt: 'hola',
      },
      new AbortController().signal,
      {
        config: config(),
        logger,
        getProvider: () => spyProvider(capturado),
        worktreesDirectory: 'C:/no/se/usa',
        apiKeyFor: () => undefined,
        onProgress: () => undefined,
      },
    );

    expect(capturado.request?.images).toBeUndefined();
  });

  // el trabajo sintetico tiene la forma del contrato del gateway: lo que quepa
  // ahi es lo que algun dia podria acabar viajando por la cola
  it('las imagenes NO entran en el trabajo sintetico', () => {
    const job = buildLocalJob({
      localTurnId: TURN_ID,
      provider: 'claude',
      model: null,
      projectAlias: 'privado',
      prompt: 'que ves',
      images: [{ mimeType: 'image/webp', base64: 'UNBASE64RECONOCIBLE' }],
    });
    expect(JSON.stringify(job)).not.toContain('UNBASE64RECONOCIBLE');
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

  it('dice cuantas veces se llamo al modelo, no solo que respondio', async () => {
    // con esta pasarela cada intento se cobra entero aunque devuelva vacio, y
    // el unico reintento que avisa es el de un 429. Sin este contador, dos
    // llamadas cobradas y una son indistinguibles desde Luxy
    const result = await runLocalTurn(input, new AbortController().signal, {
      config: config(),
      logger,
      getProvider: () => fakeProvider('respondio al segundo intento', 2),
      worktreesDirectory: 'C:/no/se/usa',
      apiKeyFor: () => undefined,
      onProgress: () => undefined,
    });

    expect(result.modelCalls).toBe(2);
  });

  it('deja una linea en el registro con contadores y sin contenido', async () => {
    // el camino privado no pasa por la cola, asi que no dejaba NINGUN rastro:
    // preguntar «por que se gasto esa llamada» no tenia donde mirarse
    const lineas: { message: string; fields: Record<string, unknown> }[] = [];
    const espia = {
      info: (message: string, fields: Record<string, unknown> = {}) =>
        lineas.push({ message, fields }),
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as AgentLogger;

    await runLocalTurn(
      { ...input, prompt: 'un secreto que no debe salir' },
      new AbortController().signal,
      {
        config: config(),
        logger: espia,
        getProvider: () => fakeProvider('una respuesta que tampoco', 2),
        worktreesDirectory: 'C:/no/se/usa',
        apiKeyFor: () => undefined,
        onProgress: () => undefined,
      },
    );

    const turno = lineas.find((linea) => linea.message === 'turno privado terminado');
    expect(turno).toBeDefined();
    expect(turno!.fields['modelCalls']).toBe(2);
    expect(turno!.fields['outcome']).toBe('completed');

    // lo importante del registro es lo que NO lleva
    const volcado = JSON.stringify(lineas);
    expect(volcado).not.toContain('un secreto que no debe salir');
    expect(volcado).not.toContain('una respuesta que tampoco');
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
