// si la memoria nueva de una conversacion copia el resumen de OTRAS (`D-105`).
//
// El resumen de las ultimas conversaciones lleva la orden de no copiarse a la
// memoria de esta, pero una orden no es una garantia. Si la copia, lo que paso en
// otra conversacion queda sellado como ocurrido aqui y vuelve en cada turno como
// hecho propio: un blanqueo. Esto no lo impide; lo MIDE, con enteros.
//
// `sinApoyoAqui` es la cifra que importa: entradas de la memoria nueva que casan
// con una frase del resumen cuando ninguna de esas frases aparece en un turno de
// esta conversacion. Si el tema salio aqui de verdad, no es blanqueo.
//
// Mismo comparador que los pendientes (`quoteStems` y `matchesNote`), para que
// las cifras se puedan leer con el mismo criterio que `ecoMemoria`.
import type { ConversationMemory } from '@luxy/shared';
import { matchesNote, quoteStems } from './relation.js';

export interface RecentEcho {
  /** unidades de la memoria nueva: frases del resumen mas entradas de las listas */
  entradas: number;
  /** cuantas casan con alguna frase del resumen de otras conversaciones */
  conFrasesDeRecientes: number;
  /** de esas, cuantas no tienen ningun turno de aqui que las respalde */
  sinApoyoAqui: number;
}

/** frases de un resumen, por signos de final */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map((each) => each.trim())
    .filter((each) => each.length > 0);
}

export function measureRecentEcho(input: {
  memory: ConversationMemory;
  phrases: readonly string[];
  turns: readonly { text: string }[];
}): RecentEcho {
  const units = [
    ...sentences(input.memory.summary),
    ...input.memory.facts,
    ...input.memory.decisions,
    ...input.memory.plan,
    ...input.memory.openQuestions,
    ...input.memory.lessons,
  ];
  const phrases = input.phrases
    .map((phrase) => quoteStems(phrase))
    .filter((stems) => stems.length > 0);

  let conFrasesDeRecientes = 0;
  let sinApoyoAqui = 0;
  for (const unit of units) {
    const matched = phrases.filter((stems) => matchesNote(unit, stems));
    if (matched.length === 0) continue;
    conFrasesDeRecientes += 1;
    const supported = matched.some((stems) =>
      input.turns.some((turn) => matchesNote(turn.text, stems)),
    );
    if (!supported) sinApoyoAqui += 1;
  }
  return { entradas: units.length, conFrasesDeRecientes, sinApoyoAqui };
}
