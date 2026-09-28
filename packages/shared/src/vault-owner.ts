// de quien es una conversacion privada: UNA regla y UN sitio (`D-103`).
//
// Hasta ahora el dueño se leia en tres funciones que miraban hacia atras cada
// una por su cuenta —el identificador, la descripcion y las instrucciones—, y
// de ahi salia un defecto demostrado: soltar un personaje sellando `''` en el
// identificador dejaba en vigor la ficha del anterior, porque la descripcion
// se buscaba aparte y seguia encontrando la vieja.
//
// Aqui hay dos clases de hecho, y los dos se ordenan por POSICION, nunca por
// reloj:
//
//   - un turno que sello algo ocupa `(secuencia, 0, 0, '')`;
//   - un evento de enganche ocupa `(anchorSequence, 1, generation, eventId)`.
//
// Y la regla es la misma para los tres campos: vale el ultimo no nulo por
// posicion. Sin relojes porque el `createdAt` de dos equipos no se puede
// comparar —cada uno tiene la hora que tiene— y porque el orden va DENTRO del
// sobre, donde el servidor no puede tocarlo.
//
// LA CAUSALIDAD. Un evento que sustituye a otro tiene que ganarle SIEMPRE. Con
// un ancla que solo mirase los turnos del equipo que lo crea, un «Soltar» hecho
// en el equipo con menos turnos perdia para siempre contra el enganche que
// acababa de deshacer (refutacion de sincronizacion n.º 1 de `wf_aae72735`).
// `nextOwnerEventPosition` lo cierra por construccion: el ancla nueva hereda la
// mayor de los eventos conocidos y la generacion sube, asi que la posicion del
// nuevo es estrictamente mayor que la de todo lo que cita.
//
// PURO: sin disco, sin red, sin reloj. El unico punto de E/S es
// `PrivateConversationStore.owner()`.
import { z } from 'zod';

/**
 * un enganche o un «soltar», tal y como se guarda y como se subira.
 *
 * Es la carga v1 DEFINITIVA: lo que el servidor sellara despues con la subclave
 * de la conversacion no se rehace, solo se envuelve. Estricto a proposito: un
 * campo que no se conoce no se descarta en silencio.
 */
export const conversationOwnerEventSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('owner'),
    eventId: z.string().uuid(),
    conversationId: z.string().uuid(),
    /** ultima secuencia conocida al crearlo, heredando las anclas conocidas; -1 si ninguna */
    anchorSequence: z.number().int().min(-1),
    /** 1 + la mayor generacion conocida en esa conversacion */
    generation: z.number().int().min(1),
    /** las cabezas que el autor tenia delante */
    supersedes: z.array(z.string().uuid()).max(16),
    /** `null` es soltar */
    characterId: z.string().min(1).max(128).nullable(),
    /** copia del nombre, para el equipo que no tenga el personaje */
    characterLabel: z.string().max(100).nullable(),
    characterDescription: z.string().max(2000).nullable(),
    /** `null` no toca las instrucciones, `''` las quita, texto las pone */
    instructions: z.string().max(8000).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ConversationOwnerEvent = z.infer<typeof conversationOwnerEventSchema>;

/** lo que un turno sello, sacado de su sobre v1 */
export interface OwnerTurnFact {
  sequence: number;
  /** `null` = este turno no lo cambio; `''` = lo quito */
  characterId: string | null;
  characterDescription: string | null;
  instructions: string | null;
}

export type ConversationOwnerSource = 'none' | 'turn' | 'link';

export interface ConversationOwner {
  characterId: string | null;
  characterDescription: string | null;
  instructions: string | null;
  /** la copia del nombre que lleva el evento ganador; `null` si gano un turno */
  characterLabel: string | null;
  /** `none` sin dueño, `turn` si lo fijo un turno (el nacimiento), `link` si un enganche */
  source: ConversationOwnerSource;
  /**
   * las respuestas con secuencia MAYOR que esta se escribieron con su ficha.
   *
   * Es la secuencia del turno que fijo al dueño, o el ancla del enganche. `null`
   * sin dueño: no se firma nada.
   */
  signedAfter: number | null;
  /** cuando se engancho, si gano un enganche */
  linkedAt: string | null;
  /** cuantos eventos tiene la conversacion, incluidos los ya superados */
  events: number;
  winningEventId: string | null;
  /** de donde salen las instrucciones en vigor, para poder deshacer solo lo propio */
  instructionsSource: { kind: 'turn'; sequence: number } | { kind: 'event'; eventId: string } | null;
}

/** una posicion comparable: turno o evento */
interface Position {
  sequence: number;
  kind: 0 | 1;
  generation: number;
  eventId: string;
}

function comparePositions(a: Position, b: Position): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  if (a.kind !== b.kind) return a.kind - b.kind;
  if (a.generation !== b.generation) return a.generation - b.generation;
  // desempate determinista entre dos eventos concurrentes. Arbitrario, pero
  // los dos equipos calculan lo mismo
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

type Fact =
  | { position: Position; kind: 'turn'; turn: OwnerTurnFact }
  | { position: Position; kind: 'event'; event: ConversationOwnerEvent };

function turnPosition(turn: OwnerTurnFact): Position {
  return { sequence: turn.sequence, kind: 0, generation: 0, eventId: '' };
}

function eventPosition(event: ConversationOwnerEvent): Position {
  return {
    sequence: event.anchorSequence,
    kind: 1,
    generation: event.generation,
    eventId: event.eventId,
  };
}

/** `''` y `null` son lo mismo al leer: nada */
function orNull(value: string | null): string | null {
  return value === null || value.length === 0 ? null : value;
}

/**
 * la ficha anterior a un turno ganador que no trajo la suya.
 *
 * Solo vale una ficha sellada mientras el dueño era ESE mismo personaje o no
 * habia ninguno, y ningun otro personaje fue dueño entre ella y el ganador. Asi
 * «Lia, soltar, Lia otra vez» conserva la ficha de Lia, y «Lia, Nora» nunca le
 * pone a Nora la de Lia, que era el defecto que esta funcion vino a cerrar.
 */
function inheritedDescription(
  facts: readonly Fact[],
  winnerPosition: Position,
  characterId: string,
): string | null {
  let current: string | null = null;
  let candidate: string | null = null;
  for (const fact of facts) {
    if (comparePositions(fact.position, winnerPosition) >= 0) break;
    const setsOwner = fact.kind === 'event' || fact.turn.characterId !== null;
    if (setsOwner) {
      current = orNull(fact.kind === 'event' ? fact.event.characterId : fact.turn.characterId);
      // otro personaje fue dueño en medio: lo de antes ya no es de este
      if (current !== null && current !== characterId) candidate = null;
    }
    const description =
      fact.kind === 'event' ? fact.event.characterDescription : fact.turn.characterDescription;
    if (description === null) continue;
    if (current === null || current === characterId) candidate = description;
  }
  return candidate === null ? null : orNull(candidate);
}

/**
 * el dueño en vigor, con su ficha y sus instrucciones.
 *
 * Tres reglas, las tres «ultimo no nulo por posicion»:
 *
 *   - el DUEÑO es el del ultimo hecho que lo fijo (turno con `characterId` no
 *     nulo, o cualquier evento);
 *   - la DESCRIPCION cuenta desde la posicion de ese hecho en adelante. Una
 *     sellada con OTRO dueño no se hereda nunca: eso arregla por lectura, sin
 *     reescribir nada, el soltar que dejaba la ficha de Lia en vigor. Si gano un
 *     turno sin ficha, vale la ultima sellada con ese mismo dueño o sin ninguno
 *     (`inheritedDescription`);
 *   - las INSTRUCCIONES son de la conversacion, no del dueño: vale la ultima no
 *     nula entre turnos y eventos, con `''` como «ninguna».
 */
export function resolveConversationOwner(input: {
  turns: readonly OwnerTurnFact[];
  events: readonly ConversationOwnerEvent[];
}): ConversationOwner {
  const facts: Fact[] = [
    ...input.turns.map((turn): Fact => ({ position: turnPosition(turn), kind: 'turn', turn })),
    ...input.events.map(
      (event): Fact => ({ position: eventPosition(event), kind: 'event', event }),
    ),
  ].sort((a, b) => comparePositions(a.position, b.position));

  // el dueño: el ultimo hecho que lo fija. Se recorre de atras hacia delante
  let winner: Fact | null = null;
  for (let index = facts.length - 1; index >= 0; index -= 1) {
    const fact = facts[index]!;
    if (fact.kind === 'event' || fact.turn.characterId !== null) {
      winner = fact;
      break;
    }
  }

  const characterId =
    winner === null
      ? null
      : orNull(winner.kind === 'event' ? winner.event.characterId : winner.turn.characterId);

  // la descripcion, primero desde la posicion del ganador en adelante
  let characterDescription: string | null = null;
  let foundFromWinner = false;
  if (characterId !== null && winner !== null) {
    for (let index = facts.length - 1; index >= 0; index -= 1) {
      const fact = facts[index]!;
      if (comparePositions(fact.position, winner.position) < 0) break;
      const description =
        fact.kind === 'event' ? fact.event.characterDescription : fact.turn.characterDescription;
      if (description === null) continue;
      characterDescription = orNull(description);
      foundFromWinner = true;
      break;
    }
  }
  // ...y si gano un TURNO que no la trajo, la de antes que fuera de ESE mismo
  // dueño. Es el caso de los datos del Studio anterior: soltar sellaba `''` y
  // volver a elegir a la misma Lia sellaba solo el id, porque la ficha era igual
  // a la anterior y no se repetia. Sin esto esas conversaciones perdian su ficha
  // sin que nadie la hubiera quitado. Un evento no entra aqui: lleva los tres
  // campos juntos y lo que dice es lo que vale
  if (characterId !== null && winner !== null && winner.kind === 'turn' && !foundFromWinner) {
    characterDescription = inheritedDescription(facts, winner.position, characterId);
  }

  // las instrucciones, sin limite de posicion
  let instructions: string | null = null;
  let instructionsSource: ConversationOwner['instructionsSource'] = null;
  for (let index = facts.length - 1; index >= 0; index -= 1) {
    const fact = facts[index]!;
    const value = fact.kind === 'event' ? fact.event.instructions : fact.turn.instructions;
    if (value === null) continue;
    instructions = orNull(value);
    instructionsSource =
      fact.kind === 'event'
        ? { kind: 'event', eventId: fact.event.eventId }
        : { kind: 'turn', sequence: fact.turn.sequence };
    break;
  }

  const linked = winner?.kind === 'event' ? winner.event : null;
  const source: ConversationOwnerSource =
    characterId === null ? 'none' : linked !== null ? 'link' : 'turn';

  return {
    characterId,
    characterDescription,
    instructions,
    characterLabel: characterId === null ? null : (linked?.characterLabel ?? null),
    source,
    signedAfter:
      characterId === null || winner === null
        ? null
        : winner.kind === 'event'
          ? winner.event.anchorSequence
          : winner.turn.sequence,
    linkedAt: source === 'link' ? (linked?.createdAt ?? null) : null,
    events: input.events.length,
    winningEventId: linked?.eventId ?? null,
    instructionsSource,
  };
}

/**
 * la posicion de un evento NUEVO.
 *
 * `lastSequence` es la ultima secuencia de turno que tiene este equipo (-1 si
 * ninguna). El ancla hereda la mayor de los eventos conocidos: sin eso, un
 * evento creado en el equipo con menos turnos quedaria DEBAJO del que sustituye
 * y perderia contra el para siempre. La generacion sube por encima de todas, y
 * `supersedes` cita las cabezas —los que nadie cita todavia— para que un
 * conflicto entre dos equipos se pueda detectar despues.
 */
export function nextOwnerEventPosition(
  known: readonly ConversationOwnerEvent[],
  lastSequence: number,
): { anchorSequence: number; generation: number; supersedes: string[] } {
  let anchorSequence = Math.max(-1, Math.trunc(lastSequence));
  let generation = 0;
  const cited = new Set<string>();
  for (const event of known) {
    anchorSequence = Math.max(anchorSequence, event.anchorSequence);
    generation = Math.max(generation, event.generation);
    for (const id of event.supersedes) cited.add(id);
  }
  const heads = known
    .filter((event) => !cited.has(event.eventId))
    .sort((a, b) => comparePositions(eventPosition(a), eventPosition(b)))
    .map((event) => event.eventId);
  // el esquema admite 16; en un solo equipo hay una cabeza. Si algun dia hay
  // mas, se citan las 16 de posicion mas alta, que son las que deciden
  return { anchorSequence, generation: generation + 1, supersedes: heads.slice(-16) };
}
