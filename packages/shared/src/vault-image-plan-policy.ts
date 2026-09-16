// que se puede mandar de un plan de imagen, y por que no.
//
// Vive fuera del componente por el mismo motivo que `evaluation-run-policy`:
// «no se puede generar» es una respuesta que tiene que decir cual de los cinco
// motivos es, y esos cinco motivos son la parte con casos limite. Dentro de un
// `disabled={...}` no se pueden probar y acaban siendo un boton apagado sin
// explicacion, que en una pantalla donde generar cuesta kudos se lee como una
// averia.
//
// Modulo PURO: recibe el estado del intento y el texto corregido, y devuelve
// una frase. No cifra, no toca disco, no llama a nadie y no mira el reloj.
import {
  vaultImagePlanEditSchema,
  type VaultImageAttemptState,
  type VaultImagePlan,
  type VaultImagePlanEdit,
} from './vault-image-plan.js';

/**
 * los topes del texto que se puede corregir a mano.
 *
 * Estan aqui porque la pantalla necesita el NUMERO para escribir «1.240 de
 * 6.000», no solo para bloquear. Son los mismos que aplica
 * `vaultImagePlanEditSchema`, y eso no se confia a la memoria de nadie: la
 * prueba comprueba que el esquema acepta justo el tope y rechaza uno mas. Si
 * alguien cambia el esquema y no esto, falla.
 */
export const IMAGE_PLAN_TEXT_LIMITS = {
  positive: 6000,
  negative: 2000,
  prompt: 4000,
} as const;

/**
 * por que un intento que ya no espera no se puede mandar.
 *
 * Una frase por estado y no un «no se puede» a secas: la tarjeta puede llevar
 * media hora en pantalla, y entonces la pregunta real no es si se puede, sino
 * que paso con la foto que ella ofrecio —si se mando, si se tiro, o si un
 * mensaje nuevo la dejo sin valor—.
 */
const SETTLED_REASONS: Record<Exclude<VaultImageAttemptState, 'pending'>, string> = {
  superseded:
    'Esa petición dejó de valer: después mandaste otro mensaje. Pídele la foto otra vez si todavía la quieres.',
  discarded: 'Ya descartaste esta imagen. No se generó y no costó nada; pídele otra si la quieres.',
  sent: 'Esta imagen ya se mandó y sigue en curso. Generarla otra vez la pagaría dos veces.',
  ok: 'Esta imagen ya se generó y está guardada en la conversación.',
  failed:
    'Este intento ya se mandó y falló. Está apuntado con su motivo; para volver a intentarlo, pídele la foto otra vez.',
  malformed:
    'El bloque de imagen llegó cortado o mal escrito, así que no hay texto que mandar. Pídele la foto otra vez.',
};

/**
 * el nombre corto de cada estado, para leer el registro.
 *
 * No es lo mismo que `SETTLED_REASONS`: aquellas frases dicen por que NO se
 * puede generar y solo valen mientras hay algo que decidir. Estas etiquetan una
 * fila de historia, donde la pregunta es otra —que fue de aquella foto— y una
 * frase de tres lineas dentro de una tabla no se lee.
 *
 * Es un `Record` completo a proposito: un estado nuevo en el enum no compila
 * hasta que alguien decide como se llama en pantalla.
 */
export const IMAGE_ATTEMPT_STATE_LABELS: Record<VaultImageAttemptState, string> = {
  pending: 'esperando decisión',
  sent: 'mandada, sin respuesta todavía',
  ok: 'generada',
  failed: 'falló',
  discarded: 'descartada',
  superseded: 'sustituida por un mensaje nuevo',
  malformed: 'el bloque llegó roto',
};

/** el texto editable de un plan, tal y como lo espera el panel */
export function imagePlanEditFrom(plan: VaultImagePlan): VaultImagePlanEdit {
  return plan.provider === 'horde'
    ? { provider: 'horde', positive: plan.positive, negative: plan.negative }
    : { provider: 'xavira', prompt: plan.prompt };
}

/**
 * la frase que explica por que no se puede generar, o `null` si se puede.
 *
 * El orden importa y esta elegido: primero si el intento sigue vivo —cuando no
 * lo esta, nada de lo demas es la pregunta—, despues si hay texto que mandar, y
 * la ocupacion al final, porque es la unica que se arregla sola esperando.
 */
export function imagePlanBlockReason(input: {
  /** en que esta el intento AHORA, leido del registro y no de lo que se pinto */
  state: VaultImageAttemptState;
  /** el texto que de verdad va a salir, ya con la correccion escrita a mano */
  edit: VaultImagePlanEdit;
  /** hay otra generacion en curso en esta ventana */
  busy: boolean;
}): string | null {
  if (input.state !== 'pending') return SETTLED_REASONS[input.state];

  if (input.edit.provider === 'horde') {
    if (input.edit.positive.trim().length === 0) {
      return 'No hay nada que mandar: el positivo está vacío. Es el único campo obligatorio.';
    }
    const largo = tooLong(input.edit.positive, IMAGE_PLAN_TEXT_LIMITS.positive, 'El positivo');
    if (largo !== null) return largo;
    const negativo = tooLong(input.edit.negative, IMAGE_PLAN_TEXT_LIMITS.negative, 'El negativo');
    if (negativo !== null) return negativo;
  } else {
    if (input.edit.prompt.trim().length === 0) {
      return 'No hay nada que mandar: la escena está vacía.';
    }
    const largo = tooLong(input.edit.prompt, IMAGE_PLAN_TEXT_LIMITS.prompt, 'La escena');
    if (largo !== null) return largo;
  }

  if (input.busy) return 'Ya hay una generación en curso. Espera a que termine.';
  return null;
}

/**
 * por que no se puede preguntar el precio en seco.
 *
 * Es OTRA pregunta que la de generar: el proveedor de pago no tiene forma de
 * decir cuanto costara sin cobrarlo, asi que ahi el boton no puede existir. Lo
 * demas sale del mismo sitio, porque se pregunta por el mismo texto.
 */
export function imagePlanEstimateBlockReason(input: {
  state: VaultImageAttemptState;
  edit: VaultImagePlanEdit;
  busy: boolean;
}): string | null {
  if (input.edit.provider === 'xavira') {
    return 'El proveedor de pago no dice lo que cuesta sin cobrarlo, así que aquí no hay precio que preguntar.';
  }
  return imagePlanBlockReason(input);
}

/**
 * devuelve al positivo un fragmento que el recorte automatico habia quitado.
 *
 * Se añade AL FINAL y no donde estaba: la identidad va delante a proposito, y
 * meter el color de pelo de la escena entre la apariencia y la ropa es
 * exactamente lo que el recorte existe para evitar. Al final contradice igual,
 * pero pesa menos, que es lo que la persona esta pidiendo cuando lo devuelve.
 *
 * No lo añade dos veces: pulsar el boton otra vez no duplica el texto.
 */
export function restoreDroppedFragment(positive: string, fragment: string): string {
  const limpio = fragment.trim();
  if (limpio.length === 0) return positive;
  if (containsFragment(positive, limpio)) return positive;
  const base = positive.trim();
  return base.length === 0 ? limpio : `${base}, ${limpio}`;
}

/** ya esta escrito ahi, sin distinguir mayusculas y como palabras enteras */
function containsFragment(positive: string, fragment: string): boolean {
  const partes = positive
    .toLowerCase()
    .split(',')
    .map((part) => part.trim());
  return partes.includes(fragment.toLowerCase());
}

/** la frase del tope, con las dos cifras: sin el «ahora tiene» no se sabe cuanto sobra */
function tooLong(value: string, max: number, label: string): string | null {
  if (value.length <= max) return null;
  return `${label} pasa del tope: ${value.length} caracteres de ${max}. Recórtalo antes de generar.`;
}

/**
 * la correccion es valida para el contrato que la va a recibir.
 *
 * Es la MISMA validacion que aplica el IPC, no una copia: sin esto, un texto
 * que la pantalla acepta se rechazaria en el proceso principal con un error de
 * esquema, que no dice nada a nadie.
 */
export function isImagePlanEditValid(edit: VaultImagePlanEdit): boolean {
  return vaultImagePlanEditSchema.safeParse(edit).success;
}
