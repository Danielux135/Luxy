import { describe, expect, it } from 'vitest';
import { MODEL_EVALUATIONS, buildDefaultCatalog, configurableProviderIdSchema } from '@luxy/shared';
import type { ModelDefinition, StudioMachine } from '@luxy/shared';
import {
  evaluationComparisonBlockReason,
  evaluationExecutionBlockReason,
  evaluationProvider,
} from './evaluation-run-policy.js';

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
    // por FAMILIA: `hcnsec` es una conexion agregadora y no se registra con su
    // nombre, asi que quien ejecuta es `deepseek`
    expect(evaluationProvider(model, machine.providers)).toBe('deepseek');
  });

  it('mantiene bloqueados los modos manuales y familias sin proveedor', () => {
    expect(reason({ evaluation: manual })).toContain('runner o una revision');
    const senseNova = buildDefaultCatalog().find((item) => item.family === 'sensenova')!;
    expect(evaluationProvider(senseNova, machine.providers)).toBeNull();
    expect(reason({ model: senseNova })).toContain('familia');
  });

  it('resuelve por CONEXION lo que no tiene familia nuestra', () => {
    // el fallo del 2026-09-15 en el Laboratorio: esto era `family`, asi que un
    // modelo de AI Horde —familia `other`— y uno de Mistral —familia que no
    // esta en PROVIDER_IDS— se declaraban «sin proveedor ejecutable» aunque el
    // agente los tuviera los dos en marcha
    const cydonia: ModelDefinition = {
      ...model,
      id: 'horde-cydonia-v43',
      apiModel: 'aphrodite/TheDrummer/Cydonia-24B-v4.3',
      family: 'other',
      connectionId: 'horde-cydonia',
      // una entrada de `providers.http`: se registra con SU identificador
      origin: 'http',
    };
    // por el esquema y no con un cast: `horde-cydonia` no es una familia
    // conocida, es un identificador externo, y asi es como entra de verdad
    const conHorde: StudioMachine = {
      ...machine,
      providers: ['deepseek', configurableProviderIdSchema.parse('horde-cydonia')],
    };
    expect(evaluationProvider(cydonia, conHorde.providers)).toBe('horde-cydonia');
    expect(reason({ model: cydonia, machine: conHorde })).toBeNull();
  });

  it('exige maquina conectada, proveedor y proyecto', () => {
    expect(reason({ machine: { ...machine, online: false } })).toContain('no esta disponible');
    // sin proveedores en marcha no hay quien lo ejecute, y el aviso nombra los
    // dos candidatos que se han buscado: la conexion y la familia
    const sinNada = reason({ machine: { ...machine, providers: [] } });
    expect(sinNada).toContain('hcnsec');
    expect(sinNada).toContain('deepseek');
    expect(reason({ projectAlias: '' })).toContain('proyecto');
  });

  it('el aviso habla de la maquina SELECCIONADA, no de esta', () => {
    // aqui hay un desplegable de maquinas: Daniel puede estar sentado en el PC
    // con el portatil elegido, y «esta maquina no tiene en marcha X» le manda a
    // mirar el agente equivocado, que es justo el modo de fallo que este
    // trabajo venia a quitar
    const sinNada = reason({ machine: { ...machine, providers: [] } })!;
    expect(sinNada).toContain('La máquina seleccionada');
    expect(sinNada).not.toContain('Esta máquina');
  });

  it('impide concurrencia y exige la confirmacion', () => {
    expect(reason({ activeEvaluation: true })).toContain('evaluacion activa');
    expect(reason({ confirmed: false })).toContain('consumo de tokens');
  });
});

describe('politica de comparacion controlada', () => {
  const secondModel = buildDefaultCatalog().find((item) => item.family === 'qwen')!;

  it('exige otro modelo exacto y ejecutable en la misma maquina', () => {
    expect(
      evaluationComparisonBlockReason({
        evaluation: automatic,
        model,
        secondModel: model,
        machine,
        projectAlias: 'luxy',
        activeEvaluation: false,
        confirmed: true,
        busy: false,
      }),
    ).toContain('distintos');
    expect(
      evaluationComparisonBlockReason({
        evaluation: automatic,
        model,
        secondModel,
        machine,
        projectAlias: 'luxy',
        activeEvaluation: false,
        confirmed: true,
        busy: false,
      }),
    ).toContain('segundo modelo');
    expect(
      evaluationComparisonBlockReason({
        evaluation: automatic,
        model,
        secondModel,
        machine: { ...machine, providers: ['deepseek', 'qwen'] },
        projectAlias: 'luxy',
        activeEvaluation: false,
        confirmed: true,
        busy: false,
      }),
    ).toBeNull();
  });
});
