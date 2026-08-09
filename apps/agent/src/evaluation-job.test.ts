import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentConfigSchema } from '@luxy/shared';
import type { ClaimedJob, ProviderExecution, ProviderRunRequest } from '@luxy/shared';
import { buildProviderPrompt, isStudioEvaluation, runJob } from './job-runner.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'luxy-evaluation-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function evaluationJob(): ClaimedJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    shortId: 'LUX-EVAL',
    origin: 'studio',
    provider: 'codex',
    model: 'gpt-evaluado',
    projectAlias: 'demo',
    prompt: '[LUXY_EVALUATION]\nid=speed-exact-v1\nversion=1\n\n[INSTRUCCIONES]\nLISTO',
    telegramChatId: null,
    telegramUserId: null,
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    metadata: { studioMode: 'evaluation', evaluationConfirmed: true },
  };
}

describe('trabajo de evaluacion', () => {
  it('se ejecuta en solo lectura, sin worktree, herramientas, memoria ni comprobaciones', async () => {
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
        return {
          ok: true,
          finalText: 'LISTO',
          sessionId: null,
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          errorMessage: null,
          usage: {
            provider: 'codex',
            model: 'gpt-evaluado',
            inputTokens: 20,
            outputTokens: 1,
            estimatedCost: 0,
          },
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

    const outcome = await runJob(evaluationJob(), new AbortController().signal, {
      config,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
      getProvider: () => provider,
      emit: (type, message) => emitted.push(`${type}:${message}`),
      worktreesDirectory: worktreesPath,
      downloadAttachment: vi.fn(async () => Buffer.alloc(0)),
      apiKeyFor: () => undefined,
    });

    expect(isStudioEvaluation(evaluationJob())).toBe(true);
    expect(buildProviderPrompt(evaluationJob())).toContain('no uses herramientas');
    expect(outcome.kind).toBe('completed');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ readOnly: true, model: 'gpt-evaluado' });
    expect(seen[0]?.agentic).toBeUndefined();
    expect(emitted).not.toContain('phase:creando worktree aislado');
    expect(emitted.some((event) => event.includes('ejecutando comprobaciones'))).toBe(false);
    if (outcome.kind === 'completed') {
      expect(outcome.result).toMatchObject({
        summary: 'LISTO',
        filesChanged: 0,
        testsPassed: 0,
        testsFailed: 0,
        branch: null,
        worktreePath: null,
        executedModel: 'gpt-evaluado',
      });
      expect(outcome.result).not.toHaveProperty('conversationMemory');
    }
  });
});
