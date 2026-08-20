import { describe, expect, it } from 'vitest';
import type { StudioJob, StudioMachine } from '@luxy/shared';
import {
  historyNeedsScopeFallback,
  jobsForProject,
  preferredMachineForProject,
  projectDisplayLabel,
} from './project-context.js';

const jobs = [
  { id: 'luxy', projectAlias: 'luxy' },
  { id: 'otro', projectAlias: 'otro' },
] as StudioJob[];

const machines = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'sin-luxy',
    projects: ['otro'],
    providers: ['codex'],
    online: true,
    enabled: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'con-luxy',
    projects: ['luxy'],
    providers: ['codex'],
    online: false,
    enabled: true,
  },
] satisfies StudioMachine[];

describe('contexto operativo de proyecto', () => {
  it('nunca mezcla trabajos de otro proyecto en una vista acotada', () => {
    expect(jobsForProject(jobs, 'luxy').map((job) => job.id)).toEqual(['luxy']);
    expect(jobsForProject(jobs, null)).toHaveLength(2);
  });

  it('detecta cuando un Gateway anterior ignora el filtro', () => {
    expect(historyNeedsScopeFallback(jobs, 'luxy')).toBe(true);
    expect(historyNeedsScopeFallback([jobs[0]!], 'luxy')).toBe(false);
    expect(historyNeedsScopeFallback(jobs, null)).toBe(false);
  });

  it('elige una maquina que realmente contiene el proyecto', () => {
    expect(preferredMachineForProject(machines, machines[0]!.id, 'luxy')?.id).toBe(machines[1]!.id);
    expect(preferredMachineForProject(machines, machines[0]!.id, null)?.id).toBe(machines[0]!.id);
  });

  it('mantiene siempre visible el alias estable', () => {
    expect(projectDisplayLabel('luxy', { displayName: 'Luxy' })).toBe('Luxy · luxy');
    expect(projectDisplayLabel('luxy', { displayName: '  ' })).toBe('luxy');
  });
});
