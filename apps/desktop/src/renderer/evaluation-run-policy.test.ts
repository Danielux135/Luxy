import { describe, expect, it } from 'vitest';
import { MODEL_EVALUATIONS, buildDefaultCatalog } from '@luxy/shared';
import type { StudioMachine } from '@luxy/shared';
import { evaluationExecutionBlockReason, evaluationProvider } from './evaluation-run-policy.js';

const automatic = MODEL_EVALUATIONS.find((item) => item.id === 'speed-exact-v1')!;
const manual = MODEL_EVALUATIONS.find((item) => item.id === 'spanish-editing-v1')!;
const model = buildDefaultCatalog().find((item) => item.family === 'deepseek')!;
const machine: StudioMachine = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'pc-casa',
  projects: ['luxy'],
  providers: ['deepseek'],
  online: true,
  enabled: true,
};

function reason(overrides: Partial<Parameters<typeof evaluationExecutionBlockReason>[0]> = {}) {
  return evaluationExecutionBlockReason({
    evaluation: automatic,
    model,
    machine,
    projectAlias: 'luxy',
    activeEvaluation: false,
    confirmed: true,
    busy: false,
    ...overrides,
  });
}

describe('politica de primera evaluacion individual', () => {
  it('habilita una prueba automatica confirmada en una maquina compatible', () => {
    expect(reason()).toBeNull();
    expect(evaluationProvider(model)).toBe('deepseek');
  });

  it('mantiene bloqueados los modos manuales y familias sin proveedor', () => {
    expect(reason({ evaluation: manual })).toContain('runner o una revision');
    const senseNova = buildDefaultCatalog().find((item) => item.family === 'sensenova')!;
    expect(evaluationProvider(senseNova)).toBeNull();
    expect(reason({ model: senseNova })).toContain('familia');
  });

  it('exige maquina conectada, proveedor y proyecto', () => {
    expect(reason({ machine: { ...machine, online: false } })).toContain('no esta disponible');
    expect(reason({ machine: { ...machine, providers: [] } })).toContain('no ofrece');
    expect(reason({ projectAlias: '' })).toContain('proyecto');
  });

  it('impide concurrencia y exige la confirmacion', () => {
    expect(reason({ activeEvaluation: true })).toContain('evaluacion activa');
    expect(reason({ confirmed: false })).toContain('consumo de tokens');
  });
});
