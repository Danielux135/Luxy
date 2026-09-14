// a quien se manda el trabajo de FONDO de la boveda: catalogar escenas y, mas
// adelante, apuntar promesas y pendientes.
//
// Por que existe. Catalogar usaba el proveedor de la ventana de conversacion, y
// con DeepSeek elegido, abrir «Lo que recuerda» costaba una llamada de pago por
// conversacion pendiente, en tandas. El trabajo de fondo no necesita la API de
// pago: Claude Code y Codex van con la sesion local y no se cobran por llamada.
// Asi que solo va por ellos, pase lo que pase en la ventana.
import { LOCAL_CLI_PROVIDERS, type ReasoningEffort } from './constants.js';

export type LocalCliProvider = (typeof LOCAL_CLI_PROVIDERS)[number];

/** el que se usa si nadie ha elegido y la ventana tiene un proveedor de pago */
export const DEFAULT_AUXILIARY_PROVIDER: LocalCliProvider = 'codex';

/** lo que se elige en el panel para el trabajo de fondo */
export interface AuxiliaryChoice {
  provider: LocalCliProvider;
  /** `null` es el modelo que traiga el CLI */
  model: string | null;
}

export interface AuxiliaryTarget extends AuxiliaryChoice {
  effort: ReasoningEffort | null;
  /** true si lo pedido era un proveedor de pago y se sustituyo */
  replaced: boolean;
}

export function isLocalCliProvider(provider: string): provider is LocalCliProvider {
  return (LOCAL_CLI_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * el objetivo real del trabajo de fondo.
 *
 * Manda lo que se eligio en el panel. Sin eleccion, el proveedor de la ventana
 * si es Claude o Codex —asi no cambia nada para quien ya hablaba con ellos— y si
 * no, Codex. Un proveedor de pago NUNCA pasa: se sustituye, y su modelo y su
 * esfuerzo se descartan, porque no son de ninguno de los dos.
 */
export function resolveAuxiliaryTarget(
  requested: { provider: string; model: string | null; effort: ReasoningEffort | null } | null,
  preferred: AuxiliaryChoice | null,
): AuxiliaryTarget {
  const pago = requested !== null && !isLocalCliProvider(requested.provider);

  if (preferred !== null) {
    return {
      provider: preferred.provider,
      model: preferred.model,
      // el esfuerzo de la ventana solo vale si es el mismo proveedor
      effort:
        requested !== null && requested.provider === preferred.provider ? requested.effort : null,
      replaced: pago,
    };
  }

  if (requested !== null && isLocalCliProvider(requested.provider)) {
    return {
      provider: requested.provider,
      model: requested.model,
      effort: requested.effort,
      replaced: false,
    };
  }

  return { provider: DEFAULT_AUXILIARY_PROVIDER, model: null, effort: null, replaced: pago };
}
