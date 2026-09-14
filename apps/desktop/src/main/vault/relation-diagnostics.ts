// los asuntos pendientes, EN CIFRAS.
//
// Para que existe. El resto de la funcion se juzga por como suena ella, y eso
// no se puede mirar sin leer lo que se dijo. Esto es lo que si se puede mirar:
// cuantas conversaciones quedan por revisar, cuantas citas se rechazaron por no
// casar, en que porcentaje de los mensajes de Daniel saldria el bloque y —lo
// unico que de verdad importa— cuantas veces reclama ella algo que no consta.
//
// Va en un archivo aparte de `memory-diagnostics.ts` a proposito: aquello mide
// si la memoria encuentra lo que se hablo, y esto mide si lo pendiente sale con
// cuentagotas y sin inventar. Son dos preguntas distintas y mezclarlas haria que
// tocar una rompiera las pruebas de la otra.
//
// Todo lo que sale de aqui son ENTEROS y BOOLEANOS. Ni una cita, ni un
// identificador, ni un dia suelto: el resultado cruza el IPC y acaba en el
// registro, y una cita es literalmente lo que se dijo. Hay una prueba que lo
// comprueba serializando el resultado entero.
//
// PURO: recibe lo ya leido y descifrado. Asi se prueba sin montar una boveda.
import {
  ACTIVE_RELATION_KINDS,
  RELATION_EXTRACTOR_VERSION,
  VAULT_RECENT_TURNS,
  civilDayLabel,
  isLocalCliProvider,
  quoteAppearsIn,
  type RelationCounters,
  type RelationCursor,
  type RelationNote,
  type RelationParty,
  type RelationStatus,
  type RelationTurnRef,
  type TemporalAnchor,
} from '@luxy/shared';
import {
  detectClaims,
  matchesStems,
  quoteStems,
  type CharacterReply,
  type OwnedRelationNote,
} from './relation.js';
import {
  DORMANT_AFTER_DAYS,
  DORMANT_QUIET_DAYS,
  MENTION_MIN_GAP_MS,
  selectPendingForTurn,
  type TimelineTurn,
} from './relation-selection.js';
// las mismas reglas que decide la pasada, importadas y no copiadas: un
// diagnostico que dijera «al dia» con otro criterio que el extractor seria peor
// que no tenerlo
import { effectiveThrough, lastReviewableOf, refusedStill } from './relation-sync.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** dos veces la misma promesa dentro de esto es repetirse */
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * un turno con su instante ya leido.
 *
 * Aqui dentro no se vuelve a interpretar ninguna fecha: la simulacion recorre la
 * linea temporal una vez por cada mensaje real de Daniel, y hacerlo con cadenas
 * ISO era un coste que crecia con el producto de mensajes por turnos.
 */
interface DatedTimelineTurn extends TimelineTurn {
  at: number;
}

const activeKinds: readonly string[] = ACTIVE_RELATION_KINDS;

/** una conversacion de la boveda, como la da `PrivateConversationStore.list` */
export interface RelationDiagnosticsConversation {
  conversationId: string;
  characterId: string | null;
}

/** un mensaje del USUARIO, el mismo que ya lee el diagnostico de memoria */
export interface RelationDiagnosticsMessage {
  text: string;
  createdAt: string;
  conversationId: string;
  sequence: number;
}

/**
 * una escena del catalogo, de la que aqui solo interesa con que se hizo.
 *
 * Es la prueba de la guarda: el texto de la boveda va a Claude o a Codex con la
 * sesion local, nunca a una API que se cobra por llamada. `provider` va opcional
 * porque las escenas catalogadas antes de la guarda no lo llevan, y esas cuentan
 * aparte: no dicen que se pagara, pero tampoco que no.
 */
export interface RelationDiagnosticsCatalogEntry {
  conversationId: string;
  provider?: string | null;
}

export interface RelationDiagnosticsInput {
  /** todo lo apuntado, tal y como esta en el almacen */
  notes: readonly RelationNote[];
  cursors: readonly RelationCursor[];
  counters: RelationCounters;
  /** notas y cursores que no se pudieron leer; una cifra, nunca lo que decian */
  droppedOnRead: number;
  /** las conversaciones que existen, con su personaje */
  conversations: readonly RelationDiagnosticsConversation[];
  /** las excluidas del banco de recuerdos: ni se revisan ni se ofrecen */
  excluded: ReadonlySet<string>;
  /** la linea temporal de TODOS los personajes, ya sin las excluidas */
  timeline: readonly TimelineTurn[];
  /** los mensajes del usuario sobre los que se simula la dosificacion */
  userMessages: readonly RelationDiagnosticsMessage[];
  /** las respuestas de ella, para contar lo que reclama */
  replies: readonly CharacterReply[];
  catalog: readonly RelationDiagnosticsCatalogEntry[];
  /** el turno de origen tal y como esta AHORA; `null` si ya no esta */
  turnAt: (ref: RelationTurnRef) => { text: string } | null;
  /** conversaciones cuya revision fallo en esta sesion */
  failedThisSession: number;
  /**
   * y cuales son.
   *
   * La simulacion tiene que ver lo mismo que un turno real: una conversacion que
   * no se ha podido leer no cuenta como desfase, igual que una negativa. Sin
   * esto, `blockedStale` saldria alto por un motivo que el turno real ya no
   * aplica.
   */
  failedConversations?: ReadonlySet<string>;
  /** true si Daniel eligio a mano quien hace el trabajo de fondo */
  auxiliaryConfigured: boolean;
  /** la zona, el corte del dia y el instante: los mismos que un turno real */
  anchor: TemporalAnchor;
}

export interface RelationDiagnostics {
  /** la guarda del trabajo auxiliar: `byOther` tiene que ser 0 */
  catalogGuard: {
    entries: number;
    byLocalCli: number;
    byOther: number;
    /** catalogadas antes de la guarda: no dicen con que se hicieron */
    legacyUnknown: number;
  };
  coverage: {
    conversations: number;
    upToDate: number;
    /** tiene que acabar en 0 cuando la pasada termina */
    behind: number;
    turnsBehind: number;
    outdatedVersion: number;
    excludedSkipped: number;
    refusedPersisted: number;
    failedThisSession: number;
    auxiliaryConfigured: boolean;
  };
  /** los contadores acumulados del extractor, con quien reviso cada conversacion */
  extraction: RelationCounters & {
    byProvider: { claude: number; codex: number; other: number };
  };
  notes: {
    total: number;
    byStatus: Record<RelationStatus, number>;
    byKind: { promise: number; plan: number };
    byWho: Record<RelationParty, number>;
    decidedByDaniel: number;
    reopenedByDaniel: number;
    /** abiertas que ya no se ofrecerian por viejas y calladas */
    dormant: number;
  };
  integrity: {
    quoteValid: number;
    /** el turno se retiro o su numero se reutilizo: no se ofrece nunca */
    quoteBroken: number;
    /** cerradas cuya prueba se borro con su conversacion */
    closuresOrphaned: number;
    droppedOnRead: number;
    /** su conversacion de origen ya no esta: no hay personaje que deducir */
    orphanNoCharacter: number;
  };
  /**
   * que habria salido en cada mensaje real de Daniel.
   *
   * Es la cifra que se mira ANTES de encender el bloque:
   * `turnsWithBlock / userTurnsSimulated` es la frecuencia prevista.
   */
  dosing: {
    userTurnsSimulated: number;
    turnsWithBlock: number;
    linesOffered: number;
    touched: number;
    suppressedInScene: number;
    suppressedCooldown: number;
    suppressedWaiting: number;
    dormant: number;
    blockedStale: number;
    quoteBroken: number;
    /** mensajes seguidos en que habria salido la misma: la medida de «pesada» */
    maxConsecutiveOffersSameNote: number;
  };
  /** si ella las saca sola, que es para lo que existe todo esto */
  raising: {
    herMentions: number;
    notesRaisedByHer: number;
    /** la medida exacta de «sin que yo se lo recuerde» */
    notesRaisedByHerBeforeHim: number;
    /** la medida de «lo repite»: tiene que quedarse en 0-1 */
    sameNoteWithin24h: number;
    maxRaisesPerNote: number;
    medianDaysToFirstRaise: number;
  };
  /** lo que reclama ella y cuanto de eso consta; `unbacked` no puede subir */
  inventionGuard: {
    herClaims: number;
    backed: number;
    unbacked: number;
  };
  /** cuantas lineas saldrian si contestara ahora mismo en la ultima conversacion */
  nextTurn: {
    linesForLatestConversation: number;
  };
}

/** dias civiles entre dos instantes, con el corte de las 05:00 del ancla */
function civilDaysBetween(from: string, to: string, anchor: TemporalAnchor): number {
  const start = Date.parse(`${civilDayLabel(from, anchor)}T00:00:00.000Z`);
  const end = Date.parse(`${civilDayLabel(to, anchor)}T00:00:00.000Z`);
  return Math.round((end - start) / DAY_MS);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[half - 1] ?? 0) + (sorted[half] ?? 0)) / 2)
    : (sorted[half] ?? 0);
}

/** la nota con su dueño y sus raices, que es lo que hace falta para todo lo demas */
interface PooledNote extends OwnedRelationNote {
  stems: string[];
  originAt: number;
}

/**
 * los turnos que hablan de una nota, separados por quien lo dijo.
 *
 * Las mismas reglas que la seleccion, y por el mismo motivo: lo dicho antes de
 * la promesa no es haberla sacado, y seguir hablando de ella en el mismo rato
 * tampoco es volver a sacarla.
 */
interface NoteMentions {
  hers: DatedTimelineTurn[];
  his: DatedTimelineTurn[];
  any: DatedTimelineTurn[];
}

function mentionsOf(
  note: PooledNote,
  timeline: readonly DatedTimelineTurn[],
  scope: ReadonlySet<string>,
): NoteMentions {
  const found: NoteMentions = { hers: [], his: [], any: [] };
  if (note.stems.length === 0) return found;

  for (const turn of timeline) {
    if (!scope.has(turn.conversationId)) continue;
    if (
      turn.conversationId === note.note.origin.conversationId &&
      turn.sequence === note.note.origin.sequence
    ) {
      continue;
    }
    if (turn.at <= note.originAt) continue;
    if (
      turn.conversationId === note.note.origin.conversationId &&
      turn.at - note.originAt < MENTION_MIN_GAP_MS
    ) {
      continue;
    }
    if (!matchesStems(turn.stems, note.stems)) continue;

    found.any.push(turn);
    if (turn.role === 'assistant') found.hers.push(turn);
    else found.his.push(turn);
  }

  const chronological = (a: DatedTimelineTurn, b: DatedTimelineTurn): number => a.at - b.at;
  found.hers.sort(chronological);
  found.his.sort(chronological);
  found.any.sort(chronological);
  return found;
}

/**
 * el diagnostico entero.
 *
 * El orden de los grupos es el del diseño y tambien el de la lectura: primero
 * si el trabajo de fondo va donde debe, luego cuanto queda por revisar, luego
 * que se apunto, y al final las dos cifras que deciden si se enciende el bloque
 * —cada cuanto saldria y cuanto se inventa ella hoy—.
 */
export function diagnoseRelations(input: RelationDiagnosticsInput): RelationDiagnostics {
  const anchorNow = input.anchor.instant;
  const now = Date.parse(anchorNow);

  // --- quien es quien -----------------------------------------------------
  // solo las que siguen existiendo y no estan excluidas: es el mismo alcance
  // que `PrivateMemory.conversationsFor`, que es quien manda en un turno real
  const ownerOf = new Map<string, string | null>();
  for (const conversation of input.conversations) {
    if (input.excluded.has(conversation.conversationId)) continue;
    ownerOf.set(conversation.conversationId, conversation.characterId);
  }
  const scopeOf = new Map<string | null, Set<string>>();
  for (const [conversationId, characterId] of ownerOf) {
    const own = scopeOf.get(characterId);
    if (own === undefined) scopeOf.set(characterId, new Set([conversationId]));
    else own.add(conversationId);
  }
  const scopeFor = (characterId: string | null): ReadonlySet<string> =>
    scopeOf.get(characterId) ?? new Set<string>();

  // --- la guarda del catalogo ---------------------------------------------
  const catalogGuard = { entries: input.catalog.length, byLocalCli: 0, byOther: 0, legacyUnknown: 0 };
  for (const entry of input.catalog) {
    const provider = entry.provider ?? null;
    if (provider === null || provider.length === 0) catalogGuard.legacyUnknown += 1;
    else if (isLocalCliProvider(provider)) catalogGuard.byLocalCli += 1;
    else catalogGuard.byOther += 1;
  }

  // --- cobertura de la pasada ---------------------------------------------
  const grouped = new Map<string, TimelineTurn[]>();
  for (const turn of input.timeline) {
    const own = grouped.get(turn.conversationId);
    if (own === undefined) grouped.set(turn.conversationId, [turn]);
    else own.push(turn);
  }
  const cursorOf = new Map(input.cursors.map((cursor) => [cursor.conversationId, cursor]));

  let upToDate = 0;
  let behind = 0;
  let turnsBehind = 0;
  let outdatedVersion = 0;
  let refusedPersisted = 0;
  for (const conversationId of ownerOf.keys()) {
    const cursor = cursorOf.get(conversationId);
    if (cursor !== undefined && cursor.version < RELATION_EXTRACTOR_VERSION) outdatedVersion += 1;

    const turns = [...(grouped.get(conversationId) ?? [])].sort((a, b) => a.sequence - b.sequence);
    if (refusedStill(cursor, turns.length)) refusedPersisted += 1;

    const lastReviewable = lastReviewableOf(turns);
    // sin una sola respuesta no hay nada que un cursor pueda señalar: no esta
    // por detras, es que no hay por donde empezar
    if (lastReviewable === null) {
      upToDate += 1;
      continue;
    }
    const through = effectiveThrough(cursor, turns);
    const pending = turns.filter(
      (turn) => turn.sequence > through && turn.sequence <= lastReviewable,
    ).length;
    if (pending === 0) upToDate += 1;
    else {
      behind += 1;
      turnsBehind += pending;
    }
  }

  const byProvider = { claude: 0, codex: 0, other: 0 };
  for (const cursor of input.cursors) {
    if (cursor.provider === 'claude') byProvider.claude += 1;
    else if (cursor.provider === 'codex') byProvider.codex += 1;
    // un cursor con otro proveedor solo puede venir de un archivo tocado a
    // mano; esta aqui porque es justo lo que habria que ver
    else byProvider.other += 1;
  }

  // --- lo apuntado ---------------------------------------------------------
  const byStatus: Record<RelationStatus, number> = {
    open: 0,
    fulfilled: 0,
    released: 0,
    dismissed: 0,
  };
  const byKind = { promise: 0, plan: 0 };
  const byWho: Record<RelationParty, number> = { user: 0, character: 0, both: 0 };
  let decidedByDaniel = 0;
  let reopenedByDaniel = 0;
  let quoteValid = 0;
  let quoteBroken = 0;
  let closuresOrphaned = 0;
  let orphanNoCharacter = 0;

  const pooled: PooledNote[] = [];
  for (const note of input.notes) {
    byStatus[note.status] += 1;
    byWho[note.by] += 1;
    if (note.kind === 'promise') byKind.promise += 1;
    else if (note.kind === 'plan') byKind.plan += 1;
    if (note.decidedBy === 'daniel') decidedByDaniel += 1;
    if (note.reopenedByDaniel) reopenedByDaniel += 1;
    if (note.closure !== null && note.closure.ref === null) closuresOrphaned += 1;

    const origin = input.turnAt(note.origin);
    if (origin !== null && quoteAppearsIn(note.quote, origin.text)) quoteValid += 1;
    else quoteBroken += 1;

    const known = ownerOf.has(note.origin.conversationId);
    if (!known) orphanNoCharacter += 1;
    if (!known || !activeKinds.includes(note.kind)) continue;

    pooled.push({
      note,
      characterId: ownerOf.get(note.origin.conversationId) ?? null,
      stems: quoteStems(note.quote),
      originAt: Date.parse(note.origin.at),
    });
  }

  // --- si las saca ella, y si se repite ------------------------------------
  // la fecha se lee UNA vez por turno y viaja ya resuelta. La simulacion de la
  // dosificacion llama a la seleccion una vez por mensaje real —137 hoy— y cada
  // llamada recorria la linea entera varias veces interpretando cadenas ISO: eran
  // millones de `Date.parse` en un proceso principal que es de un solo hilo, y
  // mientras tanto ningun otro IPC se atendia. Lo que queda es el cotejo de
  // raices, que es el trabajo de verdad y no se puede ahorrar.
  //
  // Ademas llega ya ORDENADA, y la seleccion se salta su ordenacion cuando lo
  // detecta: son 137 ordenaciones de la linea entera que no se hacen
  const sortedTimeline: DatedTimelineTurn[] = input.timeline
    .map((turn) => ({ ...turn, at: turn.at ?? Date.parse(turn.createdAt) }))
    .sort(
      (a, b) =>
        a.at - b.at ||
        a.conversationId.localeCompare(b.conversationId) ||
        a.sequence - b.sequence,
    );

  let herMentions = 0;
  let notesRaisedByHer = 0;
  let notesRaisedByHerBeforeHim = 0;
  let sameNoteWithin24h = 0;
  let maxRaisesPerNote = 0;
  let dormant = 0;
  const daysToFirstRaise: number[] = [];

  for (const note of pooled) {
    const mentions = mentionsOf(note, sortedTimeline, scopeFor(note.characterId));
    herMentions += mentions.hers.length;
    maxRaisesPerNote = Math.max(maxRaisesPerNote, mentions.hers.length);

    const first = mentions.hers[0];
    if (first !== undefined) {
      notesRaisedByHer += 1;
      daysToFirstRaise.push(civilDaysBetween(note.note.origin.at, first.createdAt, input.anchor));
      const firstHis = mentions.his[0];
      if (firstHis === undefined || first.at < firstHis.at) {
        notesRaisedByHerBeforeHim += 1;
      }
    }
    for (let index = 1; index < mentions.hers.length; index += 1) {
      const previous = mentions.hers[index - 1];
      const current = mentions.hers[index];
      if (previous === undefined || current === undefined) continue;
      if (current.at - previous.at < REPEAT_WINDOW_MS) {
        sameNoteWithin24h += 1;
      }
    }

    // las mismas dos condiciones que la seleccion: vieja Y callada. Solo cuenta
    // para las abiertas, que son las unicas que podrian salir
    if (note.note.status === 'open') {
      const last = mentions.any[mentions.any.length - 1];
      const quietSince = last === undefined ? note.originAt : last.at;
      if (
        now - note.originAt > DORMANT_AFTER_DAYS * DAY_MS &&
        now - quietSince >= DORMANT_QUIET_DAYS * DAY_MS
      ) {
        dormant += 1;
      }
    }
  }

  return {
    catalogGuard,
    coverage: {
      conversations: input.conversations.length,
      upToDate,
      behind,
      turnsBehind,
      outdatedVersion,
      excludedSkipped: input.conversations.filter((conversation) =>
        input.excluded.has(conversation.conversationId),
      ).length,
      refusedPersisted,
      failedThisSession: input.failedThisSession,
      auxiliaryConfigured: input.auxiliaryConfigured,
    },
    extraction: { ...input.counters, byProvider },
    notes: {
      total: input.notes.length,
      byStatus,
      byKind,
      byWho,
      decidedByDaniel,
      reopenedByDaniel,
      dormant,
    },
    integrity: {
      quoteValid,
      quoteBroken,
      closuresOrphaned,
      droppedOnRead: input.droppedOnRead,
      orphanNoCharacter,
    },
    dosing: simulateDosing(input, sortedTimeline, ownerOf, scopeFor),
    raising: {
      herMentions,
      notesRaisedByHer,
      notesRaisedByHerBeforeHim,
      sameNoteWithin24h,
      maxRaisesPerNote,
      medianDaysToFirstRaise: median(daysToFirstRaise),
    },
    inventionGuard: detectClaims(
      input.replies,
      pooled.map((note) => ({ note: note.note, characterId: note.characterId })),
    ),
    nextTurn: {
      linesForLatestConversation: linesForLatest(input, sortedTimeline, ownerOf, scopeFor),
    },
  };
}

/**
 * lo que estaba apuntado y abierto en un instante dado.
 *
 * Se reconstruye a partir del cierre y no se guarda un historial: una nota que
 * Daniel dio por cumplida el jueves seguia abierta el martes, y simularlo con su
 * estado de hoy diria que nunca habria salido. `origin.at` anterior es lo que
 * significa «suponer el extractor al dia»: la promesa se apunta en cuanto se
 * dice, no cuando el CLI pasa por ahi.
 */
function notesAt(
  pooled: readonly { note: RelationNote; characterId: string | null }[],
  characterId: string | null,
  at: number,
): RelationNote[] {
  const open: RelationNote[] = [];
  for (const { note, characterId: owner } of pooled) {
    if (owner !== characterId) continue;
    if (Date.parse(note.origin.at) >= at) continue;
    if (note.closure !== null && Date.parse(note.closure.at) <= at) continue;
    open.push(note.closure === null ? note : { ...note, status: 'open', closure: null });
  }
  return open;
}

/**
 * los ultimos turnos que ya viajan dentro del prompt.
 *
 * La misma cuenta que hace el turno real: sin esto, la simulacion ofreceria
 * promesas que en la conversacion de verdad se callan porque ya las tiene
 * delante, y la frecuencia prevista saldria mas alta de lo que seria.
 */
function oldestRecentOf(turns: readonly DatedTimelineTurn[], before: number): number | null {
  const previous = turns.filter((turn) => turn.sequence < before);
  return previous.slice(-(1 + VAULT_RECENT_TURNS))[0]?.sequence ?? null;
}

function simulateDosing(
  input: RelationDiagnosticsInput,
  timeline: readonly DatedTimelineTurn[],
  ownerOf: ReadonlyMap<string, string | null>,
  scopeFor: (characterId: string | null) => ReadonlySet<string>,
): RelationDiagnostics['dosing'] {
  const dosing = {
    userTurnsSimulated: 0,
    turnsWithBlock: 0,
    linesOffered: 0,
    touched: 0,
    suppressedInScene: 0,
    suppressedCooldown: 0,
    suppressedWaiting: 0,
    dormant: 0,
    blockedStale: 0,
    quoteBroken: 0,
    maxConsecutiveOffersSameNote: 0,
  };

  const owned = input.notes
    .filter(
      (note) => activeKinds.includes(note.kind) && ownerOf.has(note.origin.conversationId),
    )
    .map((note) => ({
      note,
      characterId: ownerOf.get(note.origin.conversationId) ?? null,
    }));

  const messages = [...input.userMessages]
    .filter((message) => ownerOf.has(message.conversationId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sequence - b.sequence);

  // en que mensajes seguidos habria salido la misma. La cita hace de clave y no
  // sale de aqui: lo que se devuelve es cuantas veces seguidas, nunca cual
  let previous = new Set<string>();
  let runs = new Map<string, number>();

  for (const message of messages) {
    const characterId = ownerOf.get(message.conversationId) ?? null;
    const at = Date.parse(message.createdAt);
    const scope = scopeFor(characterId);
    // la foto de entonces: lo posterior no existia, y el mismo hilo no habia
    // pasado de este mensaje
    const past = timeline.filter(
      (turn) =>
        scope.has(turn.conversationId) &&
        turn.at <= at &&
        !(turn.conversationId === message.conversationId && turn.sequence > message.sequence),
    );

    const selection = selectPendingForTurn({
      notes: notesAt(owned, characterId, at),
      // los cursores de HOY sobre una foto de entonces: eso es «suponer el
      // extractor al dia». Si la pasada aun no ha terminado, el desfase sale en
      // `blockedStale` en vez de esconderse
      cursors: input.cursors,
      ...(input.failedConversations === undefined
        ? {}
        : { failed: input.failedConversations }),
      timeline: past,
      conversations: scope,
      turnAt: input.turnAt,
      current: {
        conversationId: message.conversationId,
        sequence: message.sequence,
        text: message.text,
        oldestRecent: oldestRecentOf(
          past.filter((turn) => turn.conversationId === message.conversationId),
          message.sequence,
        ),
      },
      anchor: { ...input.anchor, instant: message.createdAt },
      now: message.createdAt,
    });

    dosing.userTurnsSimulated += 1;
    if (selection.lines.length > 0) dosing.turnsWithBlock += 1;
    dosing.linesOffered += selection.lines.length;
    dosing.touched += selection.counters.touched;
    dosing.suppressedInScene += selection.counters.inScene;
    dosing.suppressedCooldown += selection.counters.cooling;
    dosing.suppressedWaiting += selection.counters.waiting;
    dosing.dormant += selection.counters.dormant;
    dosing.blockedStale += selection.counters.blockedStale;
    dosing.quoteBroken += selection.counters.quoteBroken;

    const current = new Set(selection.lines.map((line) => line.quote));
    const next = new Map<string, number>();
    for (const quote of current) {
      const run = (previous.has(quote) ? (runs.get(quote) ?? 0) : 0) + 1;
      next.set(quote, run);
      dosing.maxConsecutiveOffersSameNote = Math.max(dosing.maxConsecutiveOffersSameNote, run);
    }
    previous = current;
    runs = next;
  }

  return dosing;
}

/**
 * cuantas lineas saldrian si contestara ahora mismo.
 *
 * Sobre la conversacion que se habla ultimamente y con un mensaje vacio: lo que
 * mide es lo que ella sacaria SOLA, sin que el nombre nada. Es la unica cifra
 * del diagnostico que mira al futuro y no a lo ya hablado.
 */
function linesForLatest(
  input: RelationDiagnosticsInput,
  timeline: readonly DatedTimelineTurn[],
  ownerOf: ReadonlyMap<string, string | null>,
  scopeFor: (characterId: string | null) => ReadonlySet<string>,
): number {
  let latest: DatedTimelineTurn | null = null;
  for (const turn of timeline) {
    if (!ownerOf.has(turn.conversationId)) continue;
    if (latest === null || turn.at >= latest.at) latest = turn;
  }
  if (latest === null) return 0;

  // a una constante antes de usarla dentro de un filtro: el analisis de flujo no
  // conserva el estrechamiento de un `let` capturado por una funcion
  const last = latest;
  const characterId = ownerOf.get(last.conversationId) ?? null;
  const scope = scopeFor(characterId);
  const own = timeline.filter((turn) => turn.conversationId === last.conversationId);
  const sequence = own.reduce((highest, turn) => Math.max(highest, turn.sequence), -1) + 1;

  return selectPendingForTurn({
    notes: input.notes.filter((note) => scope.has(note.origin.conversationId)),
    cursors: input.cursors,
    ...(input.failedConversations === undefined ? {} : { failed: input.failedConversations }),
    timeline: timeline.filter((turn) => scope.has(turn.conversationId)),
    conversations: scope,
    turnAt: input.turnAt,
    current: {
      conversationId: last.conversationId,
      sequence,
      // vacio a proposito: sin mensaje no hay «tocada», asi que lo que salga es
      // lo que sacaria ella por su cuenta
      text: '',
      oldestRecent: oldestRecentOf(own, sequence),
    },
    anchor: input.anchor,
    now: input.anchor.instant,
  }).lines.length;
}
