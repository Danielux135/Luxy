import { describe, expect, it } from 'vitest';
import type { StudioJob, StudioJobCreateRequest } from '@luxy/shared';
import { workspaceBindingMatches } from './useStudio.js';

const request = {
  targetMachineId: '11111111-1111-4111-8111-111111111111',
  provider: 'deepseek',
  model: null,
  projectAlias: 'test',
  prompt: 'continua',
  priority: 0,
  workspacePath: 'C:/Luxy/worktrees/estable',
} satisfies StudioJobCreateRequest;

const created = {
  metadata: {},
} as StudioJob;

describe('confirmacion del espacio de trabajo', () => {
  it('detecta un Gateway antiguo que ha eliminado la ruta', () => {
    expect(workspaceBindingMatches(request, created)).toBe(false);
  });

  it('solo confirma exactamente la ruta solicitada', () => {
    expect(
      workspaceBindingMatches(request, {
        ...created,
        metadata: { resumeWorktreePath: request.workspacePath },
      }),
    ).toBe(true);
    expect(
      workspaceBindingMatches(request, {
        ...created,
        metadata: { resumeWorktreePath: 'C:/Luxy/worktrees/otra' },
      }),
    ).toBe(false);
  });
});
