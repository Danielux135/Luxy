import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobCancelledRequest, JobCompleteRequest, JobFailRequest } from '@luxy/shared';
import { OutcomeQueue, type OutcomeSender } from './outcome-queue.js';

let directory: string;

class SenderFalso implements OutcomeSender {
  fail = false;
  delivered: string[] = [];
  completedPayloads: JobCompleteRequest[] = [];

  private send(jobId: string): void {
    if (this.fail) throw new Error('sin conexion');
    this.delivered.push(jobId);
  }

  async completeJob(jobId: string, payload: JobCompleteRequest): Promise<void> {
    this.send(jobId);
    this.completedPayloads.push(payload);
  }

  async failJob(jobId: string, _payload: JobFailRequest): Promise<void> {
    this.send(jobId);
  }

  async reportCancelled(jobId: string, _payload: JobCancelledRequest): Promise<void> {
    this.send(jobId);
  }
}

const completed: JobCompleteRequest = {
  summary: 'terminado',
  filesChanged: 1,
  testsPassed: 0,
  testsFailed: 0,
  durationMs: 100,
  diffStat: '1 file changed',
  branch: 'luxy/test',
  worktreePath: 'C:\\Temp\\worktree',
  sessionId: null,
  testLogs: [],
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'luxy-outcomes-'));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('OutcomeQueue', () => {
  it('persiste antes de entregar y borra solo tras confirmacion', async () => {
    const sender = new SenderFalso();
    sender.fail = true;
    const queue = new OutcomeQueue(sender, { directory, onError: () => undefined });
    queue.pushCompleted('job-1', completed);

    expect(existsSync(join(directory, 'pending-outcomes.json'))).toBe(true);
    expect(await queue.flush()).toBe(false);
    expect(queue.has('job-1')).toBe(true);

    sender.fail = false;
    expect(await queue.flush()).toBe(true);
    expect(sender.delivered).toEqual(['job-1']);
    expect(queue.size).toBe(0);
  });

  it('recupera el cierre despues de reiniciar', async () => {
    const sender = new SenderFalso();
    sender.fail = true;
    const first = new OutcomeQueue(sender, { directory, onError: () => undefined });
    first.pushCompleted('job-2', completed);
    await first.flush();

    const second = new OutcomeQueue(sender, { directory, onError: () => undefined });
    expect(second.has('job-2')).toBe(true);
    sender.fail = false;
    expect(await second.flush()).toBe(true);
  });

  it('redacta secretos antes de escribirlos', () => {
    const queue = new OutcomeQueue(new SenderFalso(), { directory });
    queue.pushCompleted('job-3', {
      ...completed,
      summary: 'Bearer secret-test-value-abcdefghijklmnopqrstuvwxyz',
    });

    const saved = readFileSync(join(directory, 'pending-outcomes.json'), 'utf8');
    expect(saved).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('conserva los contadores de tokens al persistir una conversacion', async () => {
    const sender = new SenderFalso();
    const queue = new OutcomeQueue(sender, { directory });

    expect(() =>
      queue.pushCompleted('job-kimi', {
        ...completed,
        conversationMemory: {
          version: 1,
          summary: 'Kimi saludo al usuario.',
          facts: [],
          decisions: [],
          plan: [],
          openQuestions: [],
          lessons: [],
        },
        usage: {
          provider: 'kimi',
          model: 'Kimi-K2.6',
          inputTokens: 287,
          outputTokens: 476,
          estimatedCost: 0,
        },
      }),
    ).not.toThrow();

    expect(await queue.flush()).toBe(true);
    expect(sender.completedPayloads[0]?.usage).toMatchObject({
      inputTokens: 287,
      outputTokens: 476,
    });
  });

  it('descarta un archivo corrupto sin ejecutarlo', () => {
    writeFileSync(join(directory, 'pending-outcomes.json'), '{no es json', 'utf8');
    const queue = new OutcomeQueue(new SenderFalso(), { directory });
    expect(queue.size).toBe(0);
  });
});
