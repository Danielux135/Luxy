import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentConfigSchema } from '@luxy/shared';
import { CONVERSATION_MEMORY_CLOSE, CONVERSATION_MEMORY_OPEN } from '@luxy/shared';
import type { ClaimedJob, ProviderExecution, ProviderRunRequest } from '@luxy/shared';
import { buildProviderPrompt, runJob } from './job-runner.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'luxy-conversation-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function conversationJob(): ClaimedJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    shortId: 'LUX-CHAT',
    origin: 'studio',
    provider: 'codex',
    model: null,
    projectAlias: 'demo',
    prompt: 'Usuario:\nExplica este proyecto\n\nAsistente:',
    telegramChatId: null,
    telegramUserId: null,
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    metadata: { studioMode: 'conversation' },
  };
}

describe('trabajo de conversacion', () => {
  it('consulta en solo lectura sin worktree, herramientas, pruebas ni diff', async () => {
    const projectPath = join(root, 'proyecto-sin-git');
    const worktreesPath = join(root, 'worktrees');
    mkdirSync(projectPath);
    mkdirSync(worktreesPath);
    const seen: ProviderRunRequest[] = [];
    const provider: ProviderExecution = {
      id: 'codex',
      displayName: 'Codex simulado',
      detect: vi.fn(async () => ({ available: true, version: 'test', path: 'codex' })),
      run: vi.fn(async (request: ProviderRunRequest) => {
        seen.push(request);
        request.onEvent({
          type: 'text',
          message: `respuesta parcial\n${CONVERSATION_MEMORY_OPEN}`,
        });
        request.onEvent({ type: 'text', message: '{"summary":"privado"}' });
        return {
          ok: true,
          finalText: [
            'respuesta final',
            CONVERSATION_MEMORY_OPEN,
            JSON.stringify({
              version: 1,
              summary: 'El usuario quiere entender el proyecto.',
              facts: ['La conversacion trabaja en solo lectura.'],
              decisions: [],
              plan: ['Responder la siguiente duda con este contexto.'],
              openQuestions: [],
              lessons: [],
            }),
            CONVERSATION_MEMORY_CLOSE,
          ].join('\n'),
          sessionId: null,
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      }),
    };
    const config = agentConfigSchema.parse({
      machineName: 'prueba',
      gatewayUrl: 'https://gateway.example',
      machineToken: 'token-de-prueba-suficientemente-largo',
      projects: {
        demo: {
          path: projectPath,
          type: 'other',
          testCommands: [['npm', ['test']]],
          allowHostChecks: true,
          allowEdits: true,
          allowCommit: true,
          allowPush: false,
        },
      },
    });
    const emitted: string[] = [];

    const outcome = await runJob(conversationJob(), new AbortController().signal, {
      config,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
      getProvider: () => provider,
      emit: (type, message) => emitted.push(`${type}:${message}`),
      worktreesDirectory: worktreesPath,
      downloadAttachment: vi.fn(async () => Buffer.alloc(0)),
      apiKeyFor: () => undefined,
    });

    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.result).toMatchObject({
        summary: 'respuesta final',
        filesChanged: 0,
        testsPassed: 0,
        testsFailed: 0,
        branch: null,
        worktreePath: null,
        conversationMemory: expect.objectContaining({
          summary: 'El usuario quiere entender el proyecto.',
        }),
      });
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.readOnly).toBe(true);
    expect(seen[0]?.agentic).toBeUndefined();
    expect(emitted).not.toContain('phase:creando worktree aislado');
    expect(emitted).toContain('log:conversacion de solo lectura: no se ejecutan comprobaciones');
    expect(emitted).toContain('provider_output:respuesta parcial');
    expect(emitted.join('\n')).not.toContain('privado');
  });

  // POR QUE EXISTE: sin esto, una respuesta cortada llega al historial sin una
  // sola pista de por que se corto, y la unica forma de investigar es repetir
  // una generacion de 20 minutos.
  it('publica el diagnostico del final de la respuesta, sin contenido', async () => {
    const projectPath = join(root, 'proyecto-diagnostico');
    const worktreesPath = join(root, 'worktrees-diagnostico');
    mkdirSync(projectPath);
    mkdirSync(worktreesPath);
    const termination = {
      httpStatus: 200,
      streamed: true,
      chunks: 12,
      bytes: 4096,
      durationMs: 1_423_000,
      transportEnd: 'read_error' as const,
      finishReason: null,
      finalUsageReceived: false,
      abortedBy: null,
      effectiveTimeoutMs: 3_600_000,
      maxOutputTokens: 8192,
      inputTokens: 287,
      outputTokens: 6422,
      textLength: 24_910,
    };
    const provider: ProviderExecution = {
      id: 'codex',
      displayName: 'Codex simulado',
      detect: vi.fn(async () => ({ available: true, version: 'test', path: 'codex' })),
      run: vi.fn(async () => ({
        ok: true,
        finalText: '<!doctype html><html><bo',
        sessionId: null,
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        errorMessage: null,
        termination,
      })),
    };
    const config = agentConfigSchema.parse({
      machineName: 'prueba',
      gatewayUrl: 'https://gateway.example',
      machineToken: 'token-de-prueba-suficientemente-largo',
      projects: {
        demo: { path: projectPath, type: 'other', allowEdits: false },
      },
    });
    const eventos: { type: string; message: string; metadata?: Record<string, unknown> }[] = [];

    await runJob(conversationJob(), new AbortController().signal, {
      config,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
      getProvider: () => provider,
      emit: (type, message, metadata) => eventos.push({ type, message, metadata }),
      worktreesDirectory: worktreesPath,
      downloadAttachment: vi.fn(async () => Buffer.alloc(0)),
      apiKeyFor: () => undefined,
    });

    const diagnostico = eventos.find((evento) => evento.message.startsWith('diagnostico'));
    expect(diagnostico?.type).toBe('log');
    expect(diagnostico?.message).toContain('final=read_error');
    expect(diagnostico?.message).toContain('tokens=287/6422');
    // el diagnostico viaja junto al final que sostiene: un socket caido con
    // texto delante es una interrupcion, no un exito
    expect(diagnostico?.metadata).toEqual({
      responseTermination: termination,
      responseOutcome: 'interrupted',
    });
    // el diagnostico explica el corte sin repetir lo que decia la respuesta
    expect(JSON.stringify(diagnostico)).not.toContain('doctype');
  });

  // POR QUE EXISTE: una respuesta cortada llegaba como fallo y se perdia
  // entera. Con contenido delante hay trabajo que conservar y un motivo
  // concreto que enseñar, y la memoria NO puede quedarse llena de HTML.
  it('conserva una respuesta interrumpida en vez de tirarla, y no escribe memoria', async () => {
    const projectPath = join(root, 'proyecto-interrumpido');
    const worktreesPath = join(root, 'worktrees-interrumpido');
    mkdirSync(projectPath);
    mkdirSync(worktreesPath);
    const provider: ProviderExecution = {
      id: 'codex',
      displayName: 'Codex simulado',
      detect: vi.fn(async () => ({ available: true, version: 'test', path: 'codex' })),
      run: vi.fn(async () => ({
        ok: false,
        finalText: '<!doctype html><html><body><h1>Portada</h1><bo',
        sessionId: null,
        exitCode: null,
        timedOut: false,
        cancelled: false,
        errorMessage: 'la conexion se corto',
        termination: {
          httpStatus: 200,
          streamed: true,
          chunks: 120,
          bytes: 48_000,
          durationMs: 1_423_000,
          transportEnd: 'read_error' as const,
          finishReason: null,
          finalUsageReceived: false,
          abortedBy: null,
          effectiveTimeoutMs: 3_600_000,
          maxOutputTokens: 8192,
          inputTokens: 287,
          outputTokens: 6422,
          textLength: 45,
        },
      })),
    };
    const config = agentConfigSchema.parse({
      machineName: 'prueba',
      gatewayUrl: 'https://gateway.example',
      machineToken: 'token-de-prueba-suficientemente-largo',
      projects: { demo: { path: projectPath, type: 'other', allowEdits: false } },
    });
    const eventos: { type: string; message: string }[] = [];

    const outcome = await runJob(conversationJob(), new AbortController().signal, {
      config,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
      getProvider: () => provider,
      emit: (type, message) => eventos.push({ type, message }),
      worktreesDirectory: worktreesPath,
      downloadAttachment: vi.fn(async () => Buffer.alloc(0)),
      apiKeyFor: () => undefined,
    });

    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.result.responseOutcome).toBe('interrupted');
      expect(outcome.result.responseTermination?.transportEnd).toBe('read_error');
      // lo generado se conserva entero
      expect(outcome.result.summary).toContain('<h1>Portada</h1>');
      // y NO se convierte en memoria: eso es lo que la dejaba llena de codigo
      expect(outcome.result.conversationMemory).toBeUndefined();
      // el corte llego antes del bloque: no hubo memoria que leer
      expect(outcome.result.conversationMemoryStatus).toBe('absent');
    }
    expect(eventos.some((evento) => evento.message.includes('Conexion interrumpida'))).toBe(true);
  });

  // POR QUE EXISTE: el caso medido en LUX-8B8T. El modelo entrego 7.691
  // caracteres con `finish_reason: stop`, la llamada termino bien... y se
  // guardaron 4.000. La pagina parecia cortada por el proveedor y la habiamos
  // cortado nosotros al guardar.
  it('una conversacion guarda la respuesta entera, no un resumen de 4.000', async () => {
    const projectPath = join(root, 'proyecto-largo');
    const worktreesPath = join(root, 'worktrees-largo');
    mkdirSync(projectPath);
    mkdirSync(worktreesPath);
    // una pagina como la real: mas del doble del tope antiguo
    const pagina = `<!DOCTYPE html>\n${'<div class="tarjeta">contenido</div>\n'.repeat(220)}<input type="text">`;
    expect(pagina.length).toBeGreaterThan(7000);

    const provider: ProviderExecution = {
      id: 'codex',
      displayName: 'Codex simulado',
      detect: vi.fn(async () => ({ available: true, version: 'test', path: 'codex' })),
      run: vi.fn(async () => ({
        ok: true,
        finalText: pagina,
        sessionId: null,
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        errorMessage: null,
      })),
    };
    const config = agentConfigSchema.parse({
      machineName: 'prueba',
      gatewayUrl: 'https://gateway.example',
      machineToken: 'token-de-prueba-suficientemente-largo',
      projects: { demo: { path: projectPath, type: 'other', allowEdits: false } },
    });

    const outcome = await runJob(conversationJob(), new AbortController().signal, {
      config,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
      getProvider: () => provider,
      emit: () => undefined,
      worktreesDirectory: worktreesPath,
      downloadAttachment: vi.fn(async () => Buffer.alloc(0)),
      apiKeyFor: () => undefined,
    });

    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.result.summary).toBe(pagina);
      expect(outcome.result.summary.length).toBeGreaterThan(4000);
      expect(outcome.result.summaryTruncated).toBeUndefined();
      // la etiqueta final sobrevive: es lo que se perdia antes
      expect(outcome.result.summary.endsWith('<input type="text">')).toBe(true);
    }
  });

  it('un fallo sin nada que conservar sigue siendo un fallo', async () => {
    const projectPath = join(root, 'proyecto-fallo');
    const worktreesPath = join(root, 'worktrees-fallo');
    mkdirSync(projectPath);
    mkdirSync(worktreesPath);
    const provider: ProviderExecution = {
      id: 'codex',
      displayName: 'Codex simulado',
      detect: vi.fn(async () => ({ available: true, version: 'test', path: 'codex' })),
      run: vi.fn(async () => ({
        ok: false,
        finalText: '',
        sessionId: null,
        exitCode: null,
        timedOut: false,
        cancelled: false,
        errorMessage: 'el proveedor cerro la respuesta sin enviar texto visible',
      })),
    };
    const config = agentConfigSchema.parse({
      machineName: 'prueba',
      gatewayUrl: 'https://gateway.example',
      machineToken: 'token-de-prueba-suficientemente-largo',
      projects: { demo: { path: projectPath, type: 'other', allowEdits: false } },
    });

    const outcome = await runJob(conversationJob(), new AbortController().signal, {
      config,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
      getProvider: () => provider,
      emit: () => undefined,
      worktreesDirectory: worktreesPath,
      downloadAttachment: vi.fn(async () => Buffer.alloc(0)),
      apiKeyFor: () => undefined,
    });

    expect(outcome.kind).toBe('failed');
  });

  it('marca el historial como dato y prohibe modificaciones', () => {
    const prompt = buildProviderPrompt(conversationJob());
    expect(prompt).toContain('<<<CONVERSACION');
    expect(prompt).toContain('no modifiques archivos');
    expect(prompt).toContain(CONVERSATION_MEMORY_OPEN);
    expect(prompt).not.toContain('Trabajas dentro de un worktree');
  });
});
