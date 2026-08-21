import { describe, expect, it } from 'vitest';
import { projectConfigSchema } from '@luxy/shared';
import { buildProjectProfileUpdate, projectToDraft } from './project-profile.js';

const project = projectConfigSchema.parse({
  path: 'C:\\proyectos\\luxy',
  type: 'node',
  testCommands: [['npm', ['test']]],
  testTimeoutMs: 120_000,
  allowHostChecks: false,
  allowEdits: true,
  allowCommit: true,
  allowPush: false,
});

describe('ficha local de proyecto', () => {
  it('normaliza la ficha sin perder comandos ni limites existentes', () => {
    const result = buildProjectProfileUpdate(project, {
      ...projectToDraft(project),
      displayName: '  Luxy Studio  ',
      description: '  Control privado de agentes  ',
      stack: 'TypeScript, Electron, TypeScript, React',
      instructions: '  Conserva los documentos de continuidad.  ',
      allowPush: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.displayName).toBe('Luxy Studio');
    expect(result.project.stack).toEqual(['TypeScript', 'Electron', 'React']);
    expect(result.project.instructions).toBe('Conserva los documentos de continuidad.');
    expect(result.project.testCommands).toEqual([['npm', ['test']]]);
    expect(result.project.testTimeoutMs).toBe(120_000);
    expect(result.project.allowPush).toBe(true);
  });

  it('convierte argumentos separados y conserva el orden de los checks', () => {
    const result = buildProjectProfileUpdate(project, {
      ...projectToDraft(project),
      checks: [
        { executable: ' npm.cmd ', argumentsText: 'run\nlint' },
        { executable: 'vitest', argumentsText: 'run\napps/desktop' },
      ],
      testTimeoutSeconds: 90,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.testCommands).toEqual([
      ['npm.cmd', ['run', 'lint']],
      ['vitest', ['run', 'apps/desktop']],
    ]);
    expect(result.project.testTimeoutMs).toBe(90_000);
  });

  it('rechaza comandos fuera de lista y argumentos de shell antes de guardar', () => {
    const baseDraft = projectToDraft(project);
    expect(
      buildProjectProfileUpdate(project, {
        ...baseDraft,
        checks: [{ executable: 'powershell', argumentsText: 'script.ps1' }],
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('lista de ejecutables') });
    expect(
      buildProjectProfileUpdate(project, {
        ...baseDraft,
        checks: [{ executable: 'npm', argumentsText: 'run\nlint;deploy' }],
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('caracteres no permitidos') });
  });

  it('valida el timeout antes de convertirlo a milisegundos', () => {
    expect(
      buildProjectProfileUpdate(project, {
        ...projectToDraft(project),
        testTimeoutSeconds: 0,
      }),
    ).toEqual({
      ok: false,
      error: 'El timeout debe estar entre 1 y 3600 segundos, con precisión de milisegundos.',
    });

    const precise = buildProjectProfileUpdate(project, {
      ...projectToDraft(project),
      testTimeoutSeconds: 1.5,
    });
    expect(precise.ok && precise.project.testTimeoutMs).toBe(1500);
  });

  it('elimina los campos opcionales que se dejan vacios', () => {
    const result = buildProjectProfileUpdate(
      { ...project, displayName: 'Anterior', stack: ['Node'] },
      projectToDraft(project),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.displayName).toBeUndefined();
    expect(result.project.stack).toBeUndefined();
  });

  it('rechaza un stack fuera de los limites antes de guardar', () => {
    const result = buildProjectProfileUpdate(project, {
      ...projectToDraft(project),
      stack: Array.from({ length: 17 }, (_, index) => `lib-${index}`).join(', '),
    });

    expect(result).toEqual({
      ok: false,
      error: 'El stack admite hasta 16 elementos de 48 caracteres, separados por comas.',
    });
  });
});
