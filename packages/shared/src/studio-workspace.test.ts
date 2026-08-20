import { describe, expect, it } from 'vitest';
import { studioJobCreateRequestSchema } from './schemas.js';

const base = {
  targetMachineId: '11111111-1111-4111-8111-111111111111',
  provider: 'deepseek',
  model: 'DeepSeek-V4-Pro',
  projectAlias: 'luxy',
  prompt: 'continua el trabajo',
  mode: 'task' as const,
};

describe('espacios persistentes de Studio', () => {
  it('permite ligar una tarea normal a un worktree preparado', () => {
    expect(
      studioJobCreateRequestSchema.safeParse({ ...base, workspacePath: 'C:/Luxy/worktrees/a' })
        .success,
    ).toBe(true);
  });

  it('no permite combinar dos fuentes de reanudacion', () => {
    expect(
      studioJobCreateRequestSchema.safeParse({
        ...base,
        workspacePath: 'C:/Luxy/worktrees/a',
        resumeJobId: '22222222-2222-4222-8222-222222222222',
      }).success,
    ).toBe(false);
  });

  it('no permite worktrees en conversaciones o evaluaciones', () => {
    expect(
      studioJobCreateRequestSchema.safeParse({
        ...base,
        mode: 'conversation',
        workspacePath: 'C:/Luxy/worktrees/a',
      }).success,
    ).toBe(false);
  });
});
