// que pendiente, si alguno, se le enseña en ESTE turno.
//
// Por que lo decide el codigo y no ella. Enseñarle todos los pendientes en cada
// mensaje la convertiria en una lista de tareas: los sacaria todos, los repetiria
// y sonaria a formulario. Y pedirle al modelo que elija cuesta otra llamada de
// pago por turno. Asi que la dosificacion es aritmetica sobre datos que ya estan
// en memoria: cuando se prometio, cuando lo saco ella, cuantos mensajes han
// pasado desde entonces.
//
// SIN ESTADO, a proposito. No se guarda «se ofrecio en el turno 12»: todo se
// deduce de la linea temporal, que es la misma que ya existe. Un contador
// persistido se desincroniza en cuanto se borra una conversacion o se reextrae,
// y entonces ella calla lo que deberia decir o repite lo que ya dijo.
//
// PURO y con el reloj y el ancla INYECTADOS, como `recall.ts`: es la unica forma
// de probar «a las 72 horas y un minuto» sin esperar tres dias.
import {
  ACTIVE_RELATION_KINDS,
  RELATION_EXTRACTOR_VERSION,
  civilDayLabel,
  quoteAppearsIn,
  type RelationCursor,
  type RelationNote,
  type RelationParty,
  type RelationTurnRef,
  type TemporalAnchor,
} from '@luxy/shared';
import { MENTION_MIN_SHARED, matchesNote, matchesStems, quoteStems } from './relation.js';
import { tokenize } from './turn-index.js';

/**
 * cuantos caben en un turno.
 *
 * Dos y no mas: el bloque va como dato dentro de un prompt que ya lleva
 * recuerdos, memoria e historial, y tres promesas seguidas dejan de ser algo que
 * se le pasa por la cabeza.
 */
export const PENDING_MAX_LINES = 2;

/** en la MISMA conversacion, antes de esto no es una mencion: es el mismo rato */
export const MENTION_MIN_GAP_MS = 6 * 60 * 60 * 1000;

/** lo que calla una promesa despues de que ella la saque */
export const HER_COOLDOWN_MS = 72 * 60 * 60 * 1000;

/** mensajes del usuario en los que una promesa esta disponible antes de descansar */
export const OFFER_RUN_USER_TURNS = 6;

/** y lo que descansa despues de esa tanda */
export const OFFER_WAIT_MS = 48 * 60 * 60 * 1000;

/** a partir de aqui una promesa puede haberse quedado sin sentido */
export const DORMANT_AFTER_DAYS = 30;

/** ...pero solo si ademas lleva este silencio */
export const DORMANT_QUIET_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** el orden de las voces cuando todo lo demas empata */
const PARTY_ORDER: Record<RelationParty, number> = { user: 0, both: 1, character: 2 };

const activeKinds: readonly string[] = ACTIVE_RELATION_KINDS;

/**
 * una linea del bloque, con los hechos YA calculados.
 *
 * Vive aqui hasta que el bloque entre en `vault-prompt.ts`: lo que se le enseña
 * son cifras y una cita, nunca la nota entera. De cada asunto sabe solo lo que
 * dice su linea, y esa regla empieza por no darle mas.
 */
export interface PendingAffairLine {
  by: RelationParty;
  /** `AAAA-MM-DD`, con el corte del dia civil a las 05:00 */
  day: string;
  daysAgo: number;
  /** literal, tal y como se dijo */
  quote: string;
  /** veces que ELLA lo saco, contadas solo por la cita */
  raisedCount: number;
  lastRaisedDaysAgo: number | null;
  heMentionedDaysAgo: number | null;
  /** lo nombra en su mensaje de ahora */
  touchedNow: boolean;
}

/** un turno del personaje con sus raices ya calculadas, como lo da `timeline()` */
export interface TimelineTurn {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  createdAt: string;
  stems: ReadonlySet<string>;
}

export interface PendingSelectionInput {
  /** todas las notas guardadas; el alcance lo pone `conversations` */
  notes: readonly RelationNote[];
  /** para la guarda de desfase */
  cursors: readonly RelationCursor[];
  /** la linea temporal del personaje, ya sin las conversaciones excluidas */
  timeline: readonly TimelineTurn[];
  /** `conversationsFor(characterId)`: con `null` son solo los hilos sin personaje */
  conversations: ReadonlySet<string>;
  /** el turno de origen tal y como esta AHORA; `null` si ya no esta */
  turnAt: (ref: RelationTurnRef) => { text: string } | null;
  current: {
    conversationId: string;
    /** el mensaje que se acaba de escribir */
    sequence: number;
    text: string;
    /** el primer turno que ya viaja como historial reciente; `null` si van todos */
    oldestRecent: number | null;
  };
  /** la zona y el corte del dia: los mismos que usa `buildRecall` */
  anchor: TemporalAnchor;
  /** el reloj, inyectado */
  now: string;
}

/**
 * lo que hizo la seleccion, para el registro.
 *
 * Van en ingles como el resto del codigo; el handler las traduce al escribir
 * «pendientes» en «prompt privado compuesto».
 */
export interface PendingSelectionCounters {
  /** abiertas del personaje que se miraron */
  open: number;
  /** ofrecidas */
  offered: number;
  /** tocadas */
  touched: number;
  /** en escena */
  inScene: number;
  /** en reposo */
  cooling: number;
  /** en espera */
  waiting: number;
  /** dormidas */
  dormant: number;
  /** bloqueadas por desfase */
  blockedStale: number;
  /** cita rota */
  quoteBroken: number;
}

export interface PendingSelection {
  lines: PendingAffairLine[];
  counters: PendingSelectionCounters;
}

/** dias civiles entre dos instantes, con el corte de las 05:00 del ancla */
function civilDaysBetween(from: string, to: string, anchor: TemporalAnchor): number {
  const start = Date.parse(`${civilDayLabel(from, anchor)}T00:00:00.000Z`);
  const end = Date.parse(`${civilDayLabel(to, anchor)}T00:00:00.000Z`);
  return Math.round((end - start) / DAY_MS);
}

function sharesAtLeast(
  turnStems: ReadonlySet<string>,
  stems: readonly string[],
  minimum: number,
): boolean {
  let shared = 0;
  for (const stem of stems) {
    if (!turnStems.has(stem)) continue;
    shared += 1;
    if (shared >= minimum) return true;
  }
  return false;
}

function lastOf(turns: readonly TimelineTurn[]): TimelineTurn | null {
  let latest: TimelineTurn | null = null;
  for (const turn of turns) {
    if (latest === null || Date.parse(turn.createdAt) > Date.parse(latest.createdAt)) latest = turn;
  }
  return latest;
}

/**
 * la linea temporal con el mensaje de ahora dentro y en orden.
 *
 * El mensaje acaba de guardarse y el indice en memoria puede seguir sin el; la
 * tanda cuenta mensajes del usuario, asi que dejarlo fuera correria una posicion
 * la espera de 48 horas. El orden se rehace aqui porque la linea llega agrupada
 * por conversacion y la tanda es una recurrencia cronologica.
 */
function withCurrentMessage(input: PendingSelectionInput): TimelineTurn[] {
  const present = input.timeline.some(
    (turn) =>
      turn.conversationId === input.current.conversationId &&
      turn.sequence === input.current.sequence,
  );
  const turns = present
    ? [...input.timeline]
    : [
        ...input.timeline,
        {
          conversationId: input.current.conversationId,
          sequence: input.current.sequence,
          role: 'user' as const,
          createdAt: input.now,
          stems: new Set(tokenize(input.current.text)),
        },
      ];
  return turns.sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.conversationId.localeCompare(b.conversationId) ||
      a.sequence - b.sequence,
  );
}

/** un pendiente que ha pasado todos los filtros, con lo que hace falta para ordenarlo */
interface Candidate {
  note: RelationNote;
  touched: boolean;
  line: PendingAffairLine;
}

/**
 * elige los pendientes de este turno.
 *
 * Los filtros van en el orden del diseño y cada descarte se cuenta: sin eso, «no
 * saco ninguno» no se distingue de «no habia ninguno», y se arreglan de formas
 * muy distintas.
 */
export function selectPendingForTurn(input: PendingSelectionInput): PendingSelection {
  const counters: PendingSelectionCounters = {
    open: 0,
    offered: 0,
    touched: 0,
    inScene: 0,
    cooling: 0,
    waiting: 0,
    dormant: 0,
    blockedStale: 0,
    quoteBroken: 0,
  };

  const now = Date.parse(input.now);
  const timeline = withCurrentMessage(input);
  const userMessages = timeline.filter((turn) => turn.role === 'user');

  const through = new Map<string, number>();
  const refused = new Set<string>();
  for (const cursor of input.cursors) {
    through.set(cursor.conversationId, cursor.through);
    // una negativa persistida no silencia al personaje para siempre: esa
    // conversacion deja de contar como hueco hasta que crezca
    if (cursor.refusedVersion === RELATION_EXTRACTOR_VERSION) {
      refused.add(cursor.conversationId);
    }
  }

  const isCurrentMessage = (ref: { conversationId: string; sequence: number }): boolean =>
    ref.conversationId === input.current.conversationId &&
    ref.sequence === input.current.sequence;

  // los turnos que ya viajan como historial reciente: lo que cae ahi ya lo tiene
  // delante y recordarselo seria repetirselo
  const inRecentWindow = (ref: { conversationId: string; sequence: number }): boolean =>
    ref.conversationId === input.current.conversationId &&
    (input.current.oldestRecent === null || ref.sequence >= input.current.oldestRecent);

  const candidates: Candidate[] = [];

  for (const note of input.notes) {
    if (note.status !== 'open') continue;
    if (!activeKinds.includes(note.kind)) continue;
    // el alcance es del PERSONAJE, no de la boveda: un hilo sin personaje no
    // hereda las promesas de nadie (`D-062`)
    if (!input.conversations.has(note.origin.conversationId)) continue;
    counters.open += 1;

    const origin = input.turnAt(note.origin);
    // si el turno se retiro o su numero se reutilizo, la cita ya no consta: sin
    // respaldo literal no se le enseña nada
    if (origin === null || !quoteAppearsIn(note.quote, origin.text)) {
      counters.quoteBroken += 1;
      continue;
    }

    const stems = quoteStems(note.quote);
    const keywordStems = [...new Set(note.keywords.flatMap((word) => tokenize(word)))];
    const originAt = Date.parse(note.origin.at);

    const herByQuote: TimelineTurn[] = [];
    const herByAnything: TimelineTurn[] = [];
    const hisByQuote: TimelineTurn[] = [];
    const anyByQuote: TimelineTurn[] = [];
    const anyByAnything: TimelineTurn[] = [];

    for (const turn of timeline) {
      // el mensaje de ahora no es una mencion: es «tocada», que se decide aparte
      if (isCurrentMessage(turn)) continue;
      if (
        turn.conversationId === note.origin.conversationId &&
        turn.sequence === note.origin.sequence
      ) {
        continue;
      }
      // lo dicho ANTES de la promesa no es haberla sacado. El tema puede venir de
      // lejos —se habla de tartas mucho antes de prometer una—, pero contarlo
      // pondria en su linea «lo sacaste hace 7 dias» de algo que aun no existia,
      // y «volver a nombrarlo» exige que lo de antes fuera despues. Ademas la
      // sacaria del grupo «nunca sacadas por ella» y la callaria 72 h por algo
      // anterior a ella misma
      if (Date.parse(turn.createdAt) <= originAt) continue;
      // en la misma conversacion y a menos de seis horas todavia se esta
      // hablando de lo mismo: no es que se haya vuelto a sacar
      if (
        turn.conversationId === note.origin.conversationId &&
        Math.abs(Date.parse(turn.createdAt) - originAt) < MENTION_MIN_GAP_MS
      ) {
        continue;
      }

      const byQuote = matchesStems(turn.stems, stems);
      // las keywords solo sirven para CALLARLA antes: nunca cuentan para las
      // cifras que se le enseñan ni para «el lo nombro»
      const byAnything = byQuote || sharesAtLeast(turn.stems, keywordStems, MENTION_MIN_SHARED);
      if (byAnything) anyByAnything.push(turn);
      if (!byQuote) continue;
      anyByQuote.push(turn);
      if (turn.role === 'assistant') herByQuote.push(turn);
      else hisByQuote.push(turn);
    }
    for (const turn of anyByAnything) {
      if (turn.role === 'assistant') herByAnything.push(turn);
    }

    if (inRecentWindow(note.origin) || anyByAnything.some((turn) => inRecentWindow(turn))) {
      counters.inScene += 1;
      continue;
    }

    // lo nombra en su mensaje de ahora: eso manda sobre cualquier descanso,
    // porque callarse justo cuando el lo saca seria lo mas raro de todo
    const touched = matchesNote(input.current.text, stems);
    if (touched) counters.touched += 1;

    if (!touched) {
      const lastRaised = lastOf(herByAnything);
      if (lastRaised !== null && now - Date.parse(lastRaised.createdAt) < HER_COOLDOWN_MS) {
        counters.cooling += 1;
        continue;
      }

      const lastMention = lastOf(anyByQuote);
      const quietSince = lastMention === null ? originAt : Date.parse(lastMention.createdAt);
      if (
        now - originAt > DORMANT_AFTER_DAYS * DAY_MS &&
        now - quietSince >= DORMANT_QUIET_DAYS * DAY_MS
      ) {
        counters.dormant += 1;
        continue;
      }

      if (!availableInRun(userMessages, originAt, lastOf(herByAnything), isCurrentMessage)) {
        counters.waiting += 1;
        continue;
      }

      const stale = timeline.some(
        (turn) =>
          input.conversations.has(turn.conversationId) &&
          !refused.has(turn.conversationId) &&
          turn.sequence > (through.get(turn.conversationId) ?? -1) &&
          Date.parse(turn.createdAt) > originAt &&
          !inRecentWindow(turn),
      );
      if (stale) {
        counters.blockedStale += 1;
        continue;
      }
    }

    const lastRaisedByQuote = lastOf(herByQuote);
    const lastHisMention = lastOf(hisByQuote);
    candidates.push({
      note,
      touched,
      line: {
        by: note.by,
        day: civilDayLabel(note.origin.at, input.anchor),
        daysAgo: civilDaysBetween(note.origin.at, input.now, input.anchor),
        quote: note.quote,
        raisedCount: herByQuote.length,
        lastRaisedDaysAgo:
          lastRaisedByQuote === null
            ? null
            : civilDaysBetween(lastRaisedByQuote.createdAt, input.now, input.anchor),
        heMentionedDaysAgo:
          lastHisMention === null
            ? null
            : civilDaysBetween(lastHisMention.createdAt, input.now, input.anchor),
        touchedNow: touched,
      },
    });
  }

  const chosen = candidates
    .sort(
      (a, b) =>
        Number(b.touched) - Number(a.touched) ||
        // las que nunca saco ella van antes: es lo que hace que no repita
        Number(a.line.raisedCount > 0) - Number(b.line.raisedCount > 0) ||
        PARTY_ORDER[a.note.by] - PARTY_ORDER[b.note.by] ||
        Date.parse(a.note.origin.at) - Date.parse(b.note.origin.at) ||
        a.note.id.localeCompare(b.note.id),
    )
    .slice(0, PENDING_MAX_LINES);

  counters.offered = chosen.length;
  return { lines: chosen.map((candidate) => candidate.line), counters };
}

/**
 * si la promesa sigue dentro de su tanda en el mensaje de ahora.
 *
 * Es una recurrencia sobre los mensajes del usuario, no un contador guardado:
 * desde que se prometio —o desde que ella la saco, mas el reposo— se cuentan
 * seis mensajes; en el sexto empieza una espera de 48 horas y despues arranca
 * otra tanda. Asi una promesa vieja no desaparece, pero tampoco esta disponible
 * en todos los mensajes de una tarde larga.
 */
function availableInRun(
  userMessages: readonly TimelineTurn[],
  originAt: number,
  lastRaised: TimelineTurn | null,
  isCurrentMessage: (ref: { conversationId: string; sequence: number }) => boolean,
): boolean {
  const runStart =
    lastRaised === null
      ? originAt
      : Math.max(originAt, Date.parse(lastRaised.createdAt) + HER_COOLDOWN_MS);

  let count = 0;
  let waitingUntil: number | null = null;

  for (const message of userMessages) {
    const at = Date.parse(message.createdAt);
    if (at < runStart) continue;

    const held = waitingUntil !== null && at < waitingUntil;
    if (!held) {
      if (waitingUntil !== null) {
        waitingUntil = null;
        count = 0;
      }
      count += 1;
      if (count >= OFFER_RUN_USER_TURNS) waitingUntil = at + OFFER_WAIT_MS;
    }
    if (isCurrentMessage(message)) return !held;
  }
  return true;
}
