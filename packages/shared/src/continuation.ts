// union de una respuesta cortada con su continuacion.
//
// POR QUE EXISTE: cuando un turno acaba `truncated`, `interrupted` o
// `timed_out` se conserva lo generado (`D-017`) y Studio ofrece continuarlo.
// Pegar el segundo fragmento detras del primero a ciegas produce dos cosas
// igual de malas: texto duplicado (el modelo suele repetir el ultimo parrafo
// para "coger carrerilla") o una costura invisible en mitad de una etiqueta.
//
// Aqui se decide donde empieza de verdad lo nuevo, con evidencia, y se dice
// SIEMPRE con que estrategia se llego: si no hay prueba de continuidad, el
// resultado queda marcado para que la interfaz avise en vez de fingir que la
// union es correcta.
//
// Es logica pura a proposito: se prueba sin red, sin disco y sin proveedor.
import {
  CONTINUATION_ANCHOR_CHARS,
  CONTINUATION_MAX_OVERLAP_CHARS,
  CONTINUATION_MIN_OVERLAP_CHARS,
  CONTINUATION_RESYNC_WINDOW_CHARS,
  CONTINUATION_TAIL_CHARS,
} from './constants.js';

/** como se decidio donde empieza lo nuevo */
export type ContinuationJoinStrategy =
  // el principio de la continuacion repetia el final del parcial
  | 'overlap'
  // el modelo escribio algo antes de retomar (prosa, cerca de codigo); se
  // encontro el punto de corte mas adelante y se descarto lo de en medio
  | 'resynced'
  // la continuacion rehizo la respuesta entera desde el principio
  | 'restart'
  // la continuacion no aporta nada nuevo
  | 'duplicate'
  // no hay ninguna prueba de continuidad: se pega, pero se avisa
  | 'appended';

export interface ContinuationJoin {
  /** texto unido */
  text: string;
  strategy: ContinuationJoinStrategy;
  /** caracteres del inicio de la continuacion descartados por repetidos */
  overlapChars: number;
  /** caracteres descartados por delante del punto de corte al resincronizar */
  discardedChars: number;
  /** caracteres realmente añadidos por la continuacion */
  addedChars: number;
  /**
   * true cuando no se pudo demostrar que los dos fragmentos encajan.
   *
   * no es un error: es lo que separa "unido con evidencia" de "pegado". Quien
   * lo pinte debe decirlo; quien lo guarde como artefacto, tambien.
   */
  needsReview: boolean;
}

/**
 * el trozo final del parcial que se le enseña al modelo para que retome.
 *
 * se corta por un salto de linea cuando hay uno cerca: partir a mitad de
 * palabra invita a repetirla. Nunca crece mas de `maxChars`, porque esto viaja
 * dentro del prompt y compite con la memoria acumulativa.
 */
export function continuationTail(text: string, maxChars: number = CONTINUATION_TAIL_CHARS): string {
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars);
  const newline = tail.indexOf('\n');
  // solo se respeta el salto si esta en la primera mitad: mas alla, cortar por
  // el perderia justo el contexto que hace falta para empalmar.
  if (newline > 0 && newline < maxChars / 2) return tail.slice(newline + 1);
  return tail;
}

/** longitud del sufijo de `previous` que la continuacion vuelve a escribir */
function longestOverlap(previous: string, continuation: string): number {
  const max = Math.min(CONTINUATION_MAX_OVERLAP_CHARS, previous.length, continuation.length);
  for (let size = max; size >= CONTINUATION_MIN_OVERLAP_CHARS; size -= 1) {
    if (previous.endsWith(continuation.slice(0, size))) return size;
  }
  return 0;
}

/**
 * une un fragmento parcial con su continuacion.
 *
 * el orden de las comprobaciones no es arbitrario:
 *
 * 1. los casos vacios primero, para no inventar estrategias sobre nada;
 * 2. reinicio completo antes que solapamiento: si la continuacion contiene el
 *    parcial entero, quedarse con el solapamiento duplicaria la respuesta;
 * 3. solapamiento exacto sobre el texto crudo, y despues ignorando el espacio
 *    en blanco del borde, que es la diferencia mas comun entre dos llamadas;
 * 4. resincronizacion solo si el ancla del final del parcial aparece dentro de
 *    una ventana acotada al principio de la continuacion. Buscarla en todo el
 *    texto encontraria repeticiones legitimas mas abajo y borraria contenido;
 * 5. si nada de eso encaja, se pega y se marca `needsReview`. NUNCA se
 *    descarta texto sin evidencia.
 */
export function joinContinuation(previous: string, continuation: string): ContinuationJoin {
  const base = previous;
  const next = continuation;

  if (next.trim().length === 0) {
    return {
      text: base,
      strategy: 'duplicate',
      overlapChars: 0,
      discardedChars: 0,
      addedChars: 0,
      needsReview: false,
    };
  }
  if (base.trim().length === 0) {
    return {
      text: next,
      strategy: 'restart',
      overlapChars: 0,
      discardedChars: 0,
      addedChars: next.length,
      needsReview: false,
    };
  }

  // el modelo rehizo la respuesta entera: el parcial esta contenido en ella
  if (next.length >= base.length && next.includes(base.trimEnd())) {
    return {
      text: next,
      strategy: 'restart',
      overlapChars: 0,
      discardedChars: 0,
      addedChars: next.length - base.length,
      needsReview: false,
    };
  }

  // la continuacion no aporta nada: ya estaba escrita al final del parcial.
  // El minimo evita que una linea corta ("</div>") se declare duplicada solo
  // porque coincide con el final del parcial.
  if (
    next.trim().length >= CONTINUATION_MIN_OVERLAP_CHARS &&
    base.trimEnd().endsWith(next.trim())
  ) {
    return {
      text: base,
      strategy: 'duplicate',
      overlapChars: next.length,
      discardedChars: 0,
      addedChars: 0,
      needsReview: false,
    };
  }

  const exact = longestOverlap(base, next);
  if (exact > 0) {
    const added = next.slice(exact);
    return {
      text: base + added,
      strategy: 'overlap',
      overlapChars: exact,
      discardedChars: 0,
      addedChars: added.length,
      needsReview: false,
    };
  }

  // mismo intento ignorando el espacio del borde: un salto de linea de mas o de
  // menos entre dos llamadas no es una discontinuidad
  const trimmedBase = base.trimEnd();
  const leadingSpace = next.length - next.trimStart().length;
  const trimmedNext = next.trimStart();
  const loose = longestOverlap(trimmedBase, trimmedNext);
  if (loose > 0) {
    const added = trimmedNext.slice(loose);
    return {
      text: trimmedBase + added,
      strategy: 'overlap',
      overlapChars: loose + leadingSpace,
      discardedChars: base.length - trimmedBase.length,
      addedChars: added.length,
      needsReview: false,
    };
  }

  // el modelo escribio una entradilla antes de retomar: se busca el ancla del
  // final del parcial dentro de una ventana corta al principio. Se prueba de la
  // mas larga a la mas corta porque el modelo rara vez repite 120 caracteres:
  // lo normal es que reescriba la ultima linea.
  const window = next.slice(0, CONTINUATION_RESYNC_WINDOW_CHARS);
  const maxAnchor = Math.min(CONTINUATION_ANCHOR_CHARS, trimmedBase.length);
  for (let size = maxAnchor; size >= CONTINUATION_MIN_OVERLAP_CHARS; size -= 1) {
    const anchor = trimmedBase.slice(-size);
    const at = window.indexOf(anchor);
    if (at > 0) {
      const added = next.slice(at + anchor.length);
      return {
        text: trimmedBase + added,
        strategy: 'resynced',
        overlapChars: anchor.length,
        discardedChars: at,
        addedChars: added.length,
        needsReview: false,
      };
    }
  }

  return {
    text: base + next,
    strategy: 'appended',
    overlapChars: 0,
    discardedChars: 0,
    addedChars: next.length,
    needsReview: true,
  };
}

/** frase para la interfaz: que se hizo al unir y si hay que revisarlo */
export function describeContinuationJoin(join: ContinuationJoin): string {
  switch (join.strategy) {
    case 'overlap':
      return `Continuacion unida: se descartaron ${join.overlapChars} caracteres repetidos y se añadieron ${join.addedChars}.`;
    case 'resynced':
      return `Continuacion unida tras el punto de corte: se descartaron ${join.discardedChars} caracteres previos y se añadieron ${join.addedChars}.`;
    case 'restart':
      return 'El modelo rehizo la respuesta entera; se conserva la version nueva.';
    case 'duplicate':
      return 'La continuacion no añadio nada nuevo: se conserva el texto anterior.';
    case 'appended':
      return `Sin solapamiento demostrable: los ${join.addedChars} caracteres nuevos se pegaron al final y la costura hay que revisarla.`;
  }
}
