// clasificacion del final de una respuesta.
//
// POR QUE EXISTE: hasta ahora solo habia dos finales, "salio bien" y "fallo".
// Una web generada durante 23 minutos que acaba a mitad de una etiqueta no es
// ninguna de las dos: hay trabajo que conservar y un motivo concreto que
// explicar. Aqui se decide cual de los seis finales fue, a partir de la
// evidencia que recoge el transporte y NUNCA del contenido.
//
// Es logica pura a proposito: se prueba sin red, sin disco y sin proveedor.
import type { ResponseTermination } from './schemas.js';
import type { ResponseOutcome } from './types.js';
import { RECOVERABLE_RESPONSE_OUTCOMES } from './constants.js';

export interface ResponseOutcomeInput {
  /** diagnostico del transporte; null si el proveedor no lo produce todavia */
  termination: ResponseTermination | null;
  /** el usuario pulso Detener */
  cancelled: boolean;
  /** el proveedor devolvio `ok: false` */
  failed: boolean;
  /** cuanto texto util se recupero; es un tamaño, no el contenido */
  textLength: number;
}

/**
 * decide el final real.
 *
 * el orden importa y no es arbitrario:
 *
 * 1. la cancelacion manda sobre todo lo demas: la pidio una persona;
 * 2. `finish_reason: length` es la unica prueba directa del tope de tokens, y
 *    llega incluso cuando el resto de la respuesta parece correcta;
 * 3. un aborto se atribuye a quien lo pidio, no a lo que se ve desde fuera;
 * 4. solo al final se mira si quedo contenido, porque "hay texto parcial" no
 *    explica por que se corto.
 */
export function classifyResponseOutcome(input: ResponseOutcomeInput): ResponseOutcome {
  if (input.cancelled) return 'cancelled';

  const { termination } = input;
  if (termination === null) {
    // sin diagnostico solo se puede distinguir lo evidente. No se inventa un
    // motivo: un proveedor sin instrumentar cae aqui.
    if (input.failed) return input.textLength > 0 ? 'interrupted' : 'failed';
    return 'completed';
  }

  if (termination.finishReason === 'length') return 'truncated';

  switch (termination.abortedBy) {
    case 'user':
      return 'cancelled';
    case 'request_timeout':
      return 'timed_out';
    default:
      break;
  }

  if (termination.transportEnd === 'read_error') {
    // el socket se cayo. Con contenido delante es una interrupcion, y hay algo
    // que salvar; sin contenido no hay respuesta que recuperar.
    return input.textLength > 0 ? 'interrupted' : 'failed';
  }

  if (input.failed) return input.textLength > 0 ? 'interrupted' : 'failed';

  // un cierre normal sin texto tampoco es un exito, aunque nadie lanzara
  return input.textLength > 0 ? 'completed' : 'failed';
}

/** true si el final conserva contenido parcial y admite continuacion */
export function isRecoverableOutcome(outcome: ResponseOutcome): boolean {
  return (RECOVERABLE_RESPONSE_OUTCOMES as readonly ResponseOutcome[]).includes(outcome);
}

/** etiqueta en español para la interfaz y los mensajes */
export const RESPONSE_OUTCOME_LABELS: Record<ResponseOutcome, string> = {
  completed: 'Guardado',
  truncated: 'Truncado',
  interrupted: 'Conexion interrumpida',
  timed_out: 'Tiempo agotado',
  cancelled: 'Cancelado',
  failed: 'Fallo',
};

/**
 * que puede hacer Daniel con este final.
 *
 * el mensaje dice QUE HACER, no vuelca el diagnostico: los numeros ya viajan
 * en la metadata del evento.
 */
export function describeResponseOutcome(outcome: ResponseOutcome): string {
  switch (outcome) {
    case 'completed':
      return 'La respuesta llego completa.';
    case 'truncated':
      return 'El modelo se quedo sin presupuesto de tokens. Se conserva lo generado: puedes continuarla o subir el techo de salida.';
    case 'interrupted':
      return 'La conexion se corto con la respuesta a medias. Se conserva lo generado: puedes continuarla.';
    case 'timed_out':
      return 'Se agoto el tiempo de la peticion. Se conserva lo generado: puedes continuarla o ampliar el tope de tiempo.';
    case 'cancelled':
      return 'La paraste tu. Se conserva lo que se habia generado.';
    case 'failed':
      return 'No se recupero ninguna respuesta utilizable.';
  }
}
