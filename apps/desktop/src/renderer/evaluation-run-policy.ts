import { providerIdSchema } from '@luxy/shared';
import type {
  ModelDefinition,
  ModelEvaluationDefinition,
  ProviderId,
  StudioMachine,
} from '@luxy/shared';

export function evaluationProvider(model: ModelDefinition | null): ProviderId | null {
  if (model === null) return null;
  const parsed = providerIdSchema.safeParse(model.family);
  return parsed.success ? parsed.data : null;
}

export function evaluationExecutionBlockReason(input: {
  evaluation: ModelEvaluationDefinition;
  model: ModelDefinition | null;
  machine: StudioMachine | null;
  projectAlias: string;
  activeEvaluation: boolean;
  confirmed: boolean;
  busy: boolean;
}): string | null {
  if (!input.evaluation.executionEnabled || input.evaluation.validationMode !== 'automatic') {
    return 'Esta prueba necesita un runner o una revision que todavia no estan habilitados.';
  }
  if (input.model === null) return 'No hay un modelo compatible seleccionado.';
  const provider = evaluationProvider(input.model);
  if (provider === null) return 'La familia del modelo todavia no tiene proveedor ejecutable.';
  if (input.machine === null) return 'No hay una maquina disponible.';
  if (!input.machine.enabled || !input.machine.online)
    return 'La maquina seleccionada no esta disponible.';
  if (!input.machine.providers.includes(provider)) {
    return 'La maquina seleccionada no ofrece la familia del modelo.';
  }
  if (!input.machine.projects.includes(input.projectAlias)) {
    return 'Selecciona un proyecto disponible en la maquina.';
  }
  if (input.activeEvaluation) return 'Ya hay una evaluacion activa. Espera a que termine.';
  if (input.busy) return 'La solicitud anterior todavia esta en curso.';
  if (!input.confirmed) return 'Confirma el posible consumo de tokens para habilitar el envio.';
  return null;
}
