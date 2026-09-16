import type {
  ModelDefinition,
  ModelEvaluationDefinition,
  ProviderId,
  StudioMachine,
} from '@luxy/shared';
import { missingProviderReason, providerForModel } from '../shared/model-selection.js';

/**
 * quien ejecutaria este modelo en la maquina elegida.
 *
 * POR QUE NECESITA LA MAQUINA: antes esto era
 * `providerIdSchema.safeParse(model.family)`, o sea «la familia es el
 * proveedor». Eso tenia dos finales, los dos malos.
 *
 * Bloqueaba lo que no forma una familia nuestra: un modelo de AI Horde sale con
 * familia `other` y uno de `ovh-nemo` con `mistral`, y ninguna de las dos esta
 * en `PROVIDER_IDS`, asi que el enum fallaba y el Laboratorio contestaba «la
 * familia del modelo todavia no tiene proveedor ejecutable» con las cuatro
 * conexiones en marcha.
 *
 * Y cuando la familia adivinada SI era una de las nuestras, no bloqueaba:
 * se equivocaba en silencio. `qwen/qwen3.6-27b` lo sirve Groq y su familia
 * adivinada es `qwen`, que en esta maquina es la conexion agregadora: nada
 * paraba la evaluacion y se ejecutaba contra el endpoint equivocado, pagando
 * la llamada y midiendo la pasarela que no era.
 *
 * La regla unica —y por que la conexion va antes— esta en `model-selection`.
 */
export function evaluationProvider(
  model: ModelDefinition | null,
  registered: readonly ProviderId[],
): ProviderId | null {
  if (model === null) return null;
  const resolved = providerForModel(model, registered);
  // se recupera de `registered` en vez de convertirlo: asi el tipo sale de un
  // identificador ya validado y no hace falta un cast
  return registered.find((id) => id === resolved) ?? null;
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
  // la maquina se comprueba ANTES que el proveedor, y no es cosmetico: quien
  // puede ejecutar un modelo depende de lo que esa maquina tenga en marcha, asi
  // que sin maquina no hay pregunta que hacer
  if (input.machine === null) return 'No hay una maquina disponible.';
  if (!input.machine.enabled || !input.machine.online)
    return 'La maquina seleccionada no esta disponible.';
  // una sola comprobacion donde antes habia dos —«la familia no es proveedor» y
  // «la maquina no ofrece la familia»—, porque son la misma pregunta.
  //
  // `selected` y no `local`: aqui hay un desplegable de maquinas. Daniel puede
  // estar sentado en el PC y tener elegido el portatil, y «esta maquina» le
  // manda a mirar el agente que no es
  const sinProveedor = missingProviderReason(input.model, input.machine.providers, 'selected');
  if (sinProveedor !== null) return sinProveedor;
  if (!input.machine.projects.includes(input.projectAlias)) {
    return 'Selecciona un proyecto disponible en la maquina.';
  }
  if (input.activeEvaluation) return 'Ya hay una evaluacion activa. Espera a que termine.';
  if (input.busy) return 'La solicitud anterior todavia esta en curso.';
  if (!input.confirmed) return 'Confirma el posible consumo de tokens para habilitar el envio.';
  return null;
}

export function evaluationComparisonBlockReason(
  input: Parameters<typeof evaluationExecutionBlockReason>[0] & {
    secondModel: ModelDefinition | null;
  },
): string | null {
  const baseReason = evaluationExecutionBlockReason(input);
  if (baseReason !== null) return baseReason;
  if (input.secondModel === null) return 'Selecciona un segundo modelo compatible.';
  // se compara por `apiModel` y no por ejecucion a proposito, aunque ahora el
  // desplegable pueda enseñar el mismo nombre servido por dos conexiones: el
  // gateway rechaza el par con `first.model === body.model` (`studio.ts`), asi
  // que aflojarlo aqui solo cambiaria un bloqueo explicado por un 409
  if (input.secondModel.apiModel === input.model?.apiModel) {
    return 'La comparacion exige dos modelos exactos distintos.';
  }
  // `machine` ya no puede ser null: `evaluationExecutionBlockReason` devolvio
  // null, y ahi lo primero que se descarta es que falte la maquina
  const sinProveedor = missingProviderReason(
    input.secondModel,
    input.machine!.providers,
    'selected',
  );
  if (sinProveedor !== null) return `El segundo modelo no se puede ejecutar. ${sinProveedor}`;
  return null;
}
