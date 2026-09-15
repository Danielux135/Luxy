// como se enseña lo que escribio cada modelo en la sonda de compatibilidad.
//
// Vive fuera del JSX por lo mismo que `vault-sweep.ts` y `vault-recap-row.ts`:
// dentro era una cadena de ternarios que solo se podia comprobar abriendo la
// aplicacion, y aqui hay tres decisiones que no son estetica.
//
// La primera: **cual de las repeticiones se pinta**. Se guardan todas —las
// repeticiones existen porque la respuesta varia entre intentos, asi que
// enseñar una y un contador escondia justo lo que se mide— pero pintar quince
// textos largos a la vez convierte el panel en un muro y no se compara nada. Se
// pinta UNA por modelo, con el resto a un clic.
//
// La segunda: **cuanto se enseña de la elegida**. Cinco modelos, uno debajo de
// otro, solo se comparan si cada uno ocupa lo mismo y cabe de un vistazo; y
// despues hay que poder leer entera la que interese, que es lo que Daniel
// estaba haciendo a mano con curl.
//
// La tercera: **debajo de que conversacion se puede pintar**. Una tanda se
// genera con el personaje, las instrucciones y la memoria de UNA conversacion,
// asi que pintarla bajo otra seria atribuirle su roleplay a otro personaje. Eso
// lo decide `compatibilityFor`.
//
// Lo que NO decide este modulo es el recorte de seguridad: ese lo hace el
// proceso principal antes de que el texto cruce el IPC
// (`VAULT_COMPATIBILITY_REPLY_CHARS`). Aqui solo se decide cuanto se pinta de lo
// que ya llego.
//
// PURO: recibe una respuesta tal y como llega del proceso principal y devuelve
// como se pinta. No guarda nada y no registra nada: el texto que maneja es
// contenido de la boveda.
import type { ReplyKind } from '../shared/refusal.js';

/** una respuesta, tal y como la devuelve la sonda */
export interface CompatibilityReply {
  attempt: number;
  kind: ReplyKind;
  /** CONTENIDO DE LA BOVEDA: se pinta y se tira */
  text: string;
  /** cuanto escribio de verdad, antes del recorte del proceso principal */
  chars: number;
  /** cuantos caracteres DEL MODELO hay en `text`, ya descontada la marca */
  kept: number;
  clipped: boolean;
}

/**
 * una tanda de la sonda, atada a la conversacion con la que se pidio.
 *
 * Es generico para no importar el tipo del resultado —vive en `useVault`, que a
 * su vez importa este modulo— y porque lo que se decide aqui no mira dentro:
 * solo de QUE conversacion es lo que hay guardado.
 */
export interface CompatibilityRun<T> {
  conversationId: string;
  results: readonly T[];
}

/**
 * que tanda se puede pintar con esta conversacion abierta.
 *
 * Existe porque el resultado de la sonda no es de la ventana, es de la
 * conversacion: se genera con SU personaje, SUS instrucciones y SU memoria. Sin
 * esto, sondear en un hilo y abrir otro dejaba en pantalla el roleplay del
 * primero bajo un encabezado que dice «de esta conversación», y justo lo que se
 * juzga ahi —«¿suena al personaje?»— hace que el error no se note.
 *
 * Se filtra en vez de vaciarse al cambiar de hilo a proposito: la tanda costo
 * llamadas de pago de verdad, asi que mirar otra conversacion y volver no debe
 * obligar a repetirlas. Lo que no se puede es pintarla donde no es.
 */
export function compatibilityFor<T>(
  run: CompatibilityRun<T> | null,
  openConversationId: string | null,
): T[] | null {
  if (run === null || openConversationId === null) return null;
  return run.conversationId === openConversationId ? [...run.results] : null;
}

/**
 * cuanto se pinta mientras esta plegada.
 *
 * Unas cinco lineas: lo justo para ver el tono, la persona verbal y si entra en
 * escena o se pone a explicar. Mas no cabe con cinco modelos en pantalla, y
 * menos no distingue a dos modelos que empiezan igual. El resto esta a un clic.
 */
export const COMPATIBILITY_PREVIEW_CHARS = 320;

/** lo que se pinta detras de lo recortado por la pantalla, que no es un corte del modelo */
export const COMPATIBILITY_PREVIEW_ELLIPSIS = '…';

const KIND_LABELS: Record<ReplyKind, string> = {
  answered: 'contestó',
  refused: 'se negó',
  empty: 'sin respuesta',
};

const KIND_TONES: Record<ReplyKind, 'ok' | 'warn' | 'idle'> = {
  answered: 'ok',
  refused: 'warn',
  empty: 'idle',
};

/**
 * el boton de una repeticion: «2 · se negó».
 *
 * Lleva el veredicto y no solo el numero porque lo interesante de repetir es
 * cuando NO coinciden: un modelo que contesta, se niega y vuelve a contestar es
 * un modelo que no sirve, y con tres botones iguales habria que abrirlos uno a
 * uno para enterarse.
 */
export function replyTabLabel(reply: CompatibilityReply): string {
  return `${reply.attempt} · ${KIND_LABELS[reply.kind]}`;
}

export function replyTone(kind: ReplyKind): 'ok' | 'warn' | 'idle' {
  return KIND_TONES[kind];
}

/**
 * cual se pinta.
 *
 * `attempt` es lo que el usuario haya pulsado. Se cae a la primera —y no a
 * ninguna— porque la lista puede no empezar en 1: un intento que revienta antes
 * de escribir nada no deja entrada, y entonces el numero guardado de la tanda
 * anterior no existe en esta.
 */
export function replyAt(
  replies: readonly CompatibilityReply[],
  attempt: number | null,
): CompatibilityReply | null {
  if (replies.length === 0) return null;
  const elegida = attempt === null ? undefined : replies.find((each) => each.attempt === attempt);
  return elegida ?? replies[0] ?? null;
}

export interface ReplyLook {
  tone: 'ok' | 'warn' | 'idle';
  /**
   * el texto que se pinta AHORA, plegado o entero.
   *
   * Vacio significa que no hay nada que pintar, y entonces la caja NO se dibuja:
   * un recuadro con borde y cero letras dentro se lee como un fallo de la
   * pantalla, no como «este modelo no escribio nada», que es lo que pasa. Lo
   * dice la nota, que si se pinta siempre.
   */
  body: string;
  /** cuantos caracteres quedan sin pintar mientras esta plegada; 0 si se ve todo */
  hidden: number;
  /** hay algo que desplegar: sin esto el boton saldria sin nada que hacer */
  expandable: boolean;
  /**
   * el rotulo del boton de desplegar.
   *
   * Vive aqui y no en el JSX porque no puede prometer mas de lo que hay: en una
   * respuesta recortada por nosotros, desplegar enseña LO GUARDADO y no la
   * respuesta entera —lo que tiro el proceso principal no llego nunca a la
   * ventana—, y decir «entera» al lado de una marca de recorte es contradecirse.
   */
  expandLabel: string;
  /**
   * la nota de debajo, siempre en cifras.
   *
   * Dice cuanto escribio DE VERDAD, que es medio criterio para elegir: un
   * modelo que despacha el turno en 200 caracteres y otro que suelta 4.000 no se
   * distinguen por el trozo que cabe en pantalla.
   */
  meta: string;
}

/**
 * como se pinta una respuesta.
 *
 * `expanded` es lo que haya pulsado el usuario en esa fila. El recorte va por
 * frontera de palabra: cortar «pr» a mitad de una palabra hace que se lea como
 * si el modelo se hubiera cortado, que es la averia que se esta buscando.
 */
export function describeReply(reply: CompatibilityReply, expanded: boolean): ReplyLook {
  const texto = reply.text.trim();
  const largo = texto.length > COMPATIBILITY_PREVIEW_CHARS;

  let body = texto;
  let hidden = 0;
  if (largo && !expanded) {
    const cortado = texto.slice(0, COMPATIBILITY_PREVIEW_CHARS);
    const espacio = cortado.lastIndexOf(' ');
    // sin tirar mas de la mitad de lo que cabia: un texto casi sin espacios
    // dejaria si no un trozo inservible. Misma regla que `trimWithMark`
    const util = espacio >= COMPATIBILITY_PREVIEW_CHARS / 2 ? cortado.slice(0, espacio) : cortado;
    body = util.trimEnd() + COMPATIBILITY_PREVIEW_ELLIPSIS;
    hidden = texto.length - util.trimEnd().length;
  }

  let expandLabel = 'Plegar';
  if (!expanded) {
    expandLabel = reply.clipped
      ? `Leer lo guardado (${hidden} más)`
      : `Leer entera (${hidden} más)`;
  }

  // un turno que vuelve en blanco se dice con palabras. «0 caracteres» debajo de
  // un hueco no distingue «el modelo no escribio nada» de «aqui falta algo»
  const partes = texto.length === 0 ? ['el modelo no escribió nada'] : [`${reply.chars} caracteres`];
  // el recorte del proceso principal se dice SIEMPRE, tambien desplegada: ahi
  // no hay nada mas que desplegar y callarlo haria pasar nuestro corte por el
  // final de la respuesta. La cifra es `kept`, lo que queda DEL MODELO: la
  // marca va dentro del tope y contarla seria apuntarnos sus caracteres
  if (reply.clipped) partes.push(`Luxy guardó los primeros ${reply.kept}`);

  return {
    tone: KIND_TONES[reply.kind],
    body,
    hidden,
    expandable: largo,
    expandLabel,
    meta: partes.join(' · '),
  };
}
