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
//
// Encima de la dosificacion por nota hay un tope para el bloque entero
// (`D-104`), opcional y tambien sin estado: se deduce del numero de orden del
// mensaje de el en la conversacion, que ya existe. Hacia falta porque cada nota
// descansa por su cuenta, pero con diez abiertas que se turnan casi siempre
// habia alguna disponible y el bloque viajaba en el 71 % de los prompts.
import {
  ACTIVE_RELATION_KINDS,
  RELATION_EXTRACTOR_VERSION,
  civilDayLabel,
  quoteAppearsIn,
  type RelationCursor,
  type RelationNote,
  type PendingAffairLine,
  type RelationParty,
  type RelationTurnRef,
  type TemporalAnchor,
} from '@luxy/shared';
import { MENTION_MIN_SHARED, matchesNote, matchesStems, quoteStems } from './relation.js';
import { hasSameRoot } from './raise-roots.js';
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

/**
 * con el modo esporadico, el bloque de pendientes entra en uno de cada tantos
 * mensajes de el (`D-104`).
 *
 * Cuatro y no tres por la ventana: viajan `VAULT_RECENT_TURNS` = 8 turnos, que
 * son cuatro respuestas suyas. Con el bloque en los mensajes 1, 5, 9... cualquier
 * ventana contiene exactamente UNA respuesta escrita justo despues de un prompt
 * con bloque; con tres pueden coincidir dos, y esas dos se copian entre si, que
 * es la autocopia que ya se mide. Y no mas de cuatro porque la tanda de una nota
 * dura `OFFER_RUN_USER_TURNS` = 6 mensajes: con cuatro, en una conversacion
 * seguida toda tanda tiene al menos un mensaje abierto y ninguna nota se queda
 * sin ocasion. Si la tanda salta de conversacion, la cuenta es aproximada. Una prueba fija
 * las dos relaciones, para que cambiar la ventana obligue a revisar esto.
 */
export const PENDING_BLOCK_EVERY = 4;

/**
 * cuanto tiene que parecerse una respuesta suya a una cita para decir que la
 * saco ELLA (`D-104`).
 *
 * Mas estricto que `matchesStems` —dos raices y el 40 %— a proposito. Esa bolsa
 * decide cosas donde equivocarse cuesta poco (callar una nota un rato); esta
 * decide si se le dice «ya salio algo», y medido en el registro la regla laxa
 * marcaba «en escena» 99 de cada 111 turnos con abiertas: con ella la nota
 * viajaria casi siempre y casi siempre en falso. Con texto inventado, la laxa
 * casaba 3 de 8 respuestas que no hablaban de ninguna promesa y esta 1 de 8; la
 * muestra es minima y sirve de orientacion, no de medida.
 *
 * Los umbrales no se tocaron en la tercera revision (28/09): lo que cambio es
 * que dos formas del mismo verbo cuentan como la misma raiz (`raise-roots.ts`).
 * Sin eso la regla casi nunca se disparaba, porque ella saca una promesa con
 * sus palabras y el verbo cambia de persona o de tiempo.
 */
export const RAISED_MIN_SHARED = 3;
export const RAISED_MIN_RATIO = 0.6;

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
// la linea la define el paquete compartido, que es quien arma el prompt: tenerla
// en dos sitios garantizaba que un dia dejaran de coincidir
export type { PendingAffairLine };

/** un turno del personaje con sus raices ya calculadas, como lo da `timeline()` */
export interface TimelineTurn {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  createdAt: string;
  stems: ReadonlySet<string>;
  /**
   * el instante ya leido, si quien lo construyo lo tenia.
   *
   * Opcional porque la linea temporal de la boveda guarda fechas ISO. Volver a
   * leerlas en cada comparacion es lo que hacia que el diagnostico tardara
   * segundos: son dos por comparacion del orden y otras tantas por nota y turno.
   * Quien vaya a llamar muchas veces —la simulacion de la dosificacion— lo
   * calcula una vez y lo pasa hecho.
   */
  at?: number;
}

/** el mismo turno con el instante ya resuelto: dentro de aqui no se reparsea */
interface DatedTurn extends TimelineTurn {
  at: number;
}

export interface PendingSelectionInput {
  /** todas las notas guardadas; el alcance lo pone `conversations` */
  notes: readonly RelationNote[];
  /** para la guarda de desfase */
  cursors: readonly RelationCursor[];
  /**
   * conversaciones que no se han podido leer en esta sesion.
   *
   * Igual que una negativa persistida, un fallo del CLI —que no arranca, que se
   * queda sin tiempo, un modelo que no existe— deja turnos sin extraer que no
   * son culpa de nadie y que no se van a extraer hoy. Sin esto, esos turnos
   * hacen `stale` a TODAS las notas anteriores y el personaje se queda mudo toda
   * la sesion, sin mas rastro que un contador en otra pantalla.
   */
  failed?: ReadonlySet<string>;
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
  /**
   * el tope del bloque entero, solo con el modo esporadico (`D-104`).
   *
   * `userTurn` es el numero de orden del mensaje de ahora entre los de el en
   * ESTA conversacion, empezando en 1. Sale del historial de la conversacion y
   * no de la linea temporal, que excluye conversaciones: en un hilo excluido
   * daria siempre 1 y el tope estaria siempre abierto. Ausente, la seleccion es
   * exactamente la de antes; el diagnostico no lo pasa.
   */
  cadence?: { every: number; userTurn: number };
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
  /**
   * candidatas que se quedaron fuera porque el tope estaba cerrado (`D-104`).
   *
   * Es la que dice si el tope actuo: con el tope cerrado y cero aqui, no habia
   * nada que frenar.
   */
  heldByCadence: number;
  /**
   * notas en escena porque la saco ELLA en la ventana, con la regla estricta, y
   * que el no ha retomado (`D-104`).
   *
   * Se calcula siempre, tambien con el modo apagado: no cambia el prompt y da la
   * linea base de cuantos turnos habrian llevado la nota de «ya salio».
   */
  raisedByHer: number;
}

export interface PendingSelection {
  lines: PendingAffairLine[];
  counters: PendingSelectionCounters;
  /** el tope del bloque estaba cerrado en este mensaje; `false` sin tope */
  cadenceClosed: boolean;
}

/**
 * si en este mensaje se abre el tope del bloque.
 *
 * El primero de la conversacion abre: es el reencuentro, el momento natural de
 * «oye, ¿y lo de...?», y con la ventana vacia no hay nada que copiar. Un numero
 * que no sea un entero positivo deja el tope abierto, que es fallar hacia lo de
 * antes y no hacia callarlo todo.
 */
export function cadenceOpens(userTurn: number, every: number): boolean {
  if (!Number.isInteger(userTurn) || userTurn < 1) return true;
  if (!Number.isInteger(every) || every < 1) return true;
  return (userTurn - 1) % every === 0;
}

/**
 * si una respuesta saca una cita con claridad, con la regla estricta.
 *
 * Nunca por palabras clave: con ellas cualquier respuesta sobre el mismo tema
 * contaria, y una nota que diga «ya salio» cuando no salio le quita la palabra
 * sobre algo que nunca dijo. Todo lo que acepta lo acepta tambien
 * `matchesStems`, asi que una nota contada aqui esta siempre en escena: se
 * comprueba primero, con las raices exactas.
 *
 * Una cita de menos de `RAISED_MIN_SHARED` raices no cuenta NUNCA (revision del
 * 28/09). Con una o dos, «estricta» valia lo mismo que la bolsa laxa —todas las
 * raices y el 100 %— y eso es exactamente contar por palabra clave: «cafe» en
 * cualquier respuesta. Mejor que la nota no salga para esas que decirle «ya
 * salio» por una palabra suelta.
 */
export function clearlyRaises(
  turnStems: ReadonlySet<string>,
  noteStems: readonly string[],
): boolean {
  if (noteStems.length < RAISED_MIN_SHARED) return false;
  // la bolsa de siempre, con las raices EXACTAS, tiene que casar antes. Es lo
  // que garantiza que una nota contada aqui esta siempre en escena: si esta
  // regla aceptara algo que la laxa no, `raisedByHer` no lo contaria (solo se
  // cuenta en escena) y la nota saldria en el bloque justo despues de sacarla
  if (!matchesStems(turnStems, noteStems)) return false;
  let shared = 0;
  for (const stem of noteStems) {
    // «traigo» y «traer» son la misma raiz aqui, y SOLO aqui (`raise-roots.ts`)
    if (hasSameRoot(turnStems, stem)) shared += 1;
  }
  if (shared < RAISED_MIN_SHARED) return false;
  return shared / noteStems.length >= RAISED_MIN_RATIO;
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

function lastOf(turns: readonly DatedTurn[]): DatedTurn | null {
  let latest: DatedTurn | null = null;
  for (const turn of turns) {
    if (latest === null || turn.at > latest.at) latest = turn;
  }
  return latest;
}

/** el orden de la linea temporal: cronologico y estable */
function chronological(a: DatedTurn, b: DatedTurn): number {
  return (
    a.at - b.at || a.conversationId.localeCompare(b.conversationId) || a.sequence - b.sequence
  );
}

/**
 * la linea temporal con el mensaje de ahora dentro y en orden.
 *
 * El mensaje acaba de guardarse y el indice en memoria puede seguir sin el; la
 * tanda cuenta mensajes del usuario, asi que dejarlo fuera correria una posicion
 * la espera de 48 horas. El orden se rehace aqui porque la linea llega agrupada
 * por conversacion y la tanda es una recurrencia cronologica.
 *
 * Las fechas se leen UNA vez, aqui: a partir de este punto nadie vuelve a
 * interpretar una cadena ISO, ni al ordenar ni al recorrer las notas. Y si la
 * linea ya llega ordenada —el diagnostico la pasa asi, y son 137 llamadas
 * seguidas— se salta la ordenacion entera.
 */
function withCurrentMessage(input: PendingSelectionInput): DatedTurn[] {
  const present = input.timeline.some(
    (turn) =>
      turn.conversationId === input.current.conversationId &&
      turn.sequence === input.current.sequence,
  );
  const turns: DatedTurn[] = input.timeline.map((turn) => ({
    ...turn,
    at: turn.at ?? Date.parse(turn.createdAt),
  }));
  if (!present) {
    turns.push({
      conversationId: input.current.conversationId,
      sequence: input.current.sequence,
      role: 'user',
      createdAt: input.now,
      stems: new Set(tokenize(input.current.text)),
      at: Date.parse(input.now),
    });
  }

  for (let index = 1; index < turns.length; index += 1) {
    if (chronological(turns[index - 1]!, turns[index]!) > 0) return turns.sort(chronological);
  }
  return turns;
}

/**
 * la secuencia a partir de la cual una respuesta suya cuenta para «ya salio».
 *
 * Solo en un mensaje con el tope abierto y con una apertura anterior: entonces
 * es la del primer mensaje de el DESPUES de aquella apertura, y lo que ella
 * escribio antes —la respuesta al prompt que si llevaba el bloque— no cuenta.
 * En cualquier otro caso, -1: cuentan todas, como antes. Sale de la linea
 * temporal porque es ahi donde estan los turnos que se comparan; en un hilo
 * excluido no hay ninguno y el resultado da igual.
 */
function previousOpenBoundary(input: PendingSelectionInput, timeline: readonly DatedTurn[]): number {
  if (input.cadence === undefined) return -1;
  if (!cadenceOpens(input.cadence.userTurn, input.cadence.every)) return -1;
  const own = timeline
    .filter((turn) => turn.conversationId === input.current.conversationId && turn.role === 'user')
    .map((turn) => turn.sequence)
    .sort((a, b) => a - b);
  // own[k] es el mensaje siguiente a la apertura anterior, que fue own[k - 1]
  const k = own.length - input.cadence.every;
  if (k < 1) return -1;
  return own[k] ?? -1;
}

/** un pendiente que ha pasado todos los filtros, con lo que hace falta para ordenarlo */
interface Candidate {
  note: RelationNote;
  touched: boolean;
  line: PendingAffairLine;
}

/**
 * si una nota entra en el alcance de la dosificacion de este turno.
 *
 * Vive aqui, y no copiada en el handler, porque el registro cuenta cuantas de
 * ESTAS MISMAS promesas vuelven solas por la memoria acumulativa o por el
 * historial. En cuanto las dos listas dejen de ser la misma, esa cifra y
 * `open` hablarian de conjuntos distintos y el diagnostico mentiria sin avisar.
 *
 * El alcance es del PERSONAJE, no de la boveda: un hilo sin personaje no hereda
 * las promesas de nadie (`D-062`).
 */
export function isLiveNote(note: RelationNote, conversations: ReadonlySet<string>): boolean {
  return (
    note.status === 'open' &&
    activeKinds.includes(note.kind) &&
    conversations.has(note.origin.conversationId)
  );
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
    heldByCadence: 0,
    raisedByHer: 0,
  };

  const now = Date.parse(input.now);
  const timeline = withCurrentMessage(input);
  const userMessages = timeline.filter((turn) => turn.role === 'user');

  const through = new Map<string, number>();
  // conversaciones cuyo hueco NO cuenta como desfase. Son dos casos con el mismo
  // efecto y ningun remedio dentro del turno: el CLI se nego, o no se pudo leer.
  // Contarlas dejaria al personaje mudo sobre todo lo demas por algo que no va a
  // arreglarse hablando
  const unreadable = new Set<string>(input.failed ?? []);
  for (const cursor of input.cursors) {
    through.set(cursor.conversationId, cursor.through);
    // una negativa persistida no silencia al personaje para siempre: esa
    // conversacion deja de contar como hueco hasta que crezca
    if (cursor.refusedVersion === RELATION_EXTRACTOR_VERSION) {
      unreadable.add(cursor.conversationId);
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

  // en un mensaje con el tope ABIERTO, la respuesta que ella escribio tras la
  // apertura anterior no cuenta para «ya salio». Con `PENDING_BLOCK_EVERY * 2 ===
  // VAULT_RECENT_TURNS` esa respuesta es siempre la mas antigua de la ventana: si
  // saco la promesa que se le permitio, la nota «no saques otro todavia» viajaba
  // en CADA apertura junto al bloque que le ofrece otra, se contradecian, y el
  // ritmo real pasaba a una cada ocho mensajes. Solo cuentan sus respuestas desde
  // el primer mensaje de el despues de aquella apertura
  const herRaisedAfter = previousOpenBoundary(input, timeline);

  const candidates: Candidate[] = [];

  for (const note of input.notes) {
    if (!isLiveNote(note, input.conversations)) continue;
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

    const herByQuote: DatedTurn[] = [];
    const herByAnything: DatedTurn[] = [];
    const hisByQuote: DatedTurn[] = [];
    const anyByQuote: DatedTurn[] = [];
    const anyByAnything: DatedTurn[] = [];
    // solo para la nota de «ya salio» (`D-104`): si una respuesta suya de la
    // ventana la saca con la regla estricta, y si el la retomo en la ventana
    let herClearInWindow = false;
    let hisInWindow = false;

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
      if (turn.at <= originAt) continue;

      // en la misma conversacion y a menos de seis horas todavia se esta
      // hablando de lo mismo: no es que se haya vuelto a sacar
      const sameRun =
        turn.conversationId === note.origin.conversationId &&
        turn.at - originAt < MENTION_MIN_GAP_MS;
      // ...pero si ese rato es el de AHORA, el hueco de seis horas ciega
      // justamente las dos cosas para las que existe el filtro: si ella ya lo
      // tiene delante y si acaba de decirlo. En una sesion seguida eso hacia que
      // una promesa de hace veinte minutos se ofreciera como asunto antiguo, y
      // que se le volviera a ofrecer el turno siguiente a sacarla. Cuenta para
      // callarla; para las cifras que se le enseñan, sigue sin contar
      if (sameRun && turn.conversationId !== input.current.conversationId) continue;

      const byQuote = matchesStems(turn.stems, stems);
      // las keywords solo sirven para CALLARLA antes: nunca cuentan para las
      // cifras que se le enseñan ni para «el lo nombro»
      const byAnything = byQuote || sharesAtLeast(turn.stems, keywordStems, MENTION_MIN_SHARED);
      if (byAnything) {
        anyByAnything.push(turn);
        if (turn.role === 'assistant') herByAnything.push(turn);
      }
      if (inRecentWindow(turn)) {
        if (turn.role === 'assistant') {
          if (turn.sequence > herRaisedAfter && clearlyRaises(turn.stems, stems)) {
            herClearInWindow = true;
          }
        } else if (byAnything) {
          // para el, la regla mas ancha: equivocarse aqui solo quita la nota,
          // y si el la retomo ya es un hilo de los dos, no algo que saco ella
          hisInWindow = true;
        }
      }
      if (sameRun) continue;
      if (!byQuote) continue;
      anyByQuote.push(turn);
      if (turn.role === 'assistant') herByQuote.push(turn);
      else hisByQuote.push(turn);
    }

    // lo nombra en su mensaje de ahora: eso manda sobre cualquier descanso,
    // porque callarse justo cuando el lo saca seria lo mas raro de todo. Se
    // calcula antes de «en escena» porque la nota de «ya salio» lo necesita,
    // pero se sigue CONTANDO donde siempre: una nota en escena no suma tocadas
    const touched = matchesNote(input.current.text, stems);

    if (inRecentWindow(note.origin) || anyByAnything.some((turn) => inRecentWindow(turn))) {
      counters.inScene += 1;
      // la saco ELLA y el no la ha retomado. Si la promesa se hizo dentro de la
      // ventana, se esta viviendo ahora y no es algo que «ya salio»: soltarla
      // ahi la haria parecer fria
      if (!inRecentWindow(note.origin) && !touched && herClearInWindow && !hisInWindow) {
        counters.raisedByHer += 1;
      }
      continue;
    }

    if (touched) counters.touched += 1;

    if (!touched) {
      const lastRaised = lastOf(herByAnything);
      if (lastRaised !== null && now - lastRaised.at < HER_COOLDOWN_MS) {
        counters.cooling += 1;
        continue;
      }

      const lastMention = lastOf(anyByQuote);
      const quietSince = lastMention === null ? originAt : lastMention.at;
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
          !unreadable.has(turn.conversationId) &&
          turn.sequence > (through.get(turn.conversationId) ?? -1) &&
          turn.at > originAt &&
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

  // el tope del bloque entero (`D-104`), despues de todos los filtros por nota:
  // asi `heldByCadence` cuenta solo lo que de verdad habria podido salir. Una
  // nota tocada lo salta siempre, porque si el la saca ella tiene que poder
  // contestar. Las demas no se cuelan en ese mensaje: ir fuera del mensaje
  // abierto seria justo la invitacion que el tope quita
  const cadenceClosed =
    input.cadence !== undefined && !cadenceOpens(input.cadence.userTurn, input.cadence.every);
  const eligible = cadenceClosed
    ? candidates.filter((candidate) => candidate.touched)
    : candidates;
  counters.heldByCadence = candidates.length - eligible.length;

  const chosen = eligible
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
  return { lines: chosen.map((candidate) => candidate.line), counters, cadenceClosed };
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
  userMessages: readonly DatedTurn[],
  originAt: number,
  lastRaised: DatedTurn | null,
  isCurrentMessage: (ref: { conversationId: string; sequence: number }) => boolean,
): boolean {
  const runStart =
    lastRaised === null ? originAt : Math.max(originAt, lastRaised.at + HER_COOLDOWN_MS);

  let count = 0;
  let waitingUntil: number | null = null;

  for (const message of userMessages) {
    const at = message.at;
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
