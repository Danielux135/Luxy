// el nucleo local de los asuntos pendientes: identidad, fusion y deteccion.
//
// Por que vive aqui y no en `packages/shared`: el id de una nota es un sha256 y
// `node:crypto` no puede entrar en shared, que tambien lo consume el Worker. Lo
// demas se queda al lado porque comparte las raices de `turn-index.ts`, que es
// lo que decide si dos frases hablan de lo mismo.
//
// PURO: no toca disco, ni red, ni reloj. El instante se inyecta, igual que en
// `recall.ts`, para poder probar la fusion sin esperar a mañana.
//
// La asimetria manda en todas las reglas de aqui: que una promesa no se apunte
// es molesto; que se apunte dos veces, o que una que Daniel descarto vuelva
// sola, es lo que hace que ella suene a formulario o reclame lo que no debe. Por
// eso el id es determinista —reextraer no duplica— y el extractor nunca pisa una
// decision de Daniel.
import { createHash } from 'node:crypto';
import {
  ACTIVE_RELATION_KINDS,
  RELATION_EXTRACTOR_VERSION,
  normalizeQuote,
  type RelationCounters,
  type RelationNote,
  type RelationTurnRef,
  type VerifiedRelationExtraction,
} from '@luxy/shared';
import { tokenize } from './turn-index.js';

/**
 * raices que tiene que compartir un turno para hablar de una nota.
 *
 * Dos y no una: una sola raiz en comun es casi siempre una palabra corriente
 * que sobrevivio a las vacias, y con ella cualquier turno «menciona» cualquier
 * promesa.
 */
export const MENTION_MIN_SHARED = 2;

/** ademas, esa parte de las raices de la nota: dos de cinco no es hablar de ella */
export const MENTION_MIN_RATIO = 0.4;

/**
 * solape que hace que dos citas del MISMO turno sean la misma promesa.
 *
 * Alto a proposito: dentro de un turno se puede prometer mas de una cosa, y
 * juntarlas perderia una.
 */
const SAME_TURN_JACCARD = 0.6;

/**
 * solape que hace que una promesa de OTRO turno sea la de siempre repetida.
 *
 * Mas bajo porque al repetirla nadie usa las mismas palabras: «mañana te traigo
 * el desayuno» y «lo del desayuno te lo traigo mañana» son la misma deuda.
 */
const REPEAT_JACCARD = 0.5;

/** una nota con el dueño que se dedujo de su conversacion de origen (`D-062`) */
export interface OwnedRelationNote {
  note: RelationNote;
  characterId: string | null;
}

/**
 * la clave de una nota.
 *
 * Determinista a proposito: es lo que hace que volver a extraer la misma
 * conversacion —al subir `RELATION_EXTRACTOR_VERSION`, o en otro ordenador— no
 * duplique nada. Depende de la cita YA normalizada, asi que el extractor puede
 * copiarla sin tildes y sale el mismo id.
 */
export function noteId(origin: RelationTurnRef, quote: string): string {
  return createHash('sha256')
    .update(`${origin.conversationId}#${origin.sequence}#${normalizeQuote(quote)}`)
    .digest('hex')
    .slice(0, 16);
}

/** las raices de una cita, sin repetidas: con ellas se reconoce que se habla de ella */
export function quoteStems(quote: string): string[] {
  return [...new Set(tokenize(quote))];
}

function countShared(turnStems: ReadonlySet<string>, noteStems: readonly string[]): number {
  let shared = 0;
  for (const stem of noteStems) {
    if (turnStems.has(stem)) shared += 1;
  }
  return shared;
}

/**
 * si un turno, con sus raices ya calculadas, habla de la nota.
 *
 * Se pide una proporcion ademas de un minimo porque una nota larga comparte dos
 * raices con casi cualquier cosa: sin el porcentaje, «te traigo dos cafes y una
 * tarta de chocolate a la cama» casaria con hablar de cafe.
 */
export function matchesStems(
  turnStems: ReadonlySet<string>,
  noteStems: readonly string[],
): boolean {
  if (noteStems.length === 0) return false;
  const shared = countShared(turnStems, noteStems);
  // con una sola raiz no se pueden exigir dos: se exigen todas, que es lo mas
  // estricto que admite esa nota
  const needed = Math.min(MENTION_MIN_SHARED, noteStems.length);
  if (shared < needed) return false;
  return shared / noteStems.length >= MENTION_MIN_RATIO;
}

/** lo mismo, a partir del texto en claro */
export function matchesNote(text: string, noteStems: readonly string[]): boolean {
  return matchesStems(new Set(tokenize(text)), noteStems);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const stem of a) {
    if (b.has(stem)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

/** si una cita normalizada contiene a la otra, por palabras enteras */
function contains(outer: string, inner: string): boolean {
  return ` ${outer} `.includes(` ${inner} `);
}

// ---------------------------------------------------------------------------
// fusion con lo que ya hay guardado
// ---------------------------------------------------------------------------

/** una nota del almacen con lo que hace falta para compararla con otra */
interface PooledNote extends OwnedRelationNote {
  stems: Set<string>;
  normalized: string;
}

function pool(owned: OwnedRelationNote): PooledNote {
  return {
    ...owned,
    stems: new Set(quoteStems(owned.note.quote)),
    normalized: normalizeQuote(owned.note.quote),
  };
}

/**
 * si dos notas son la misma promesa.
 *
 * Tres reglas, porque son tres casos distintos. En el MISMO turno, dos citas que
 * se solapan son el mismo compromiso dicho con mas o menos palabras, pase lo que
 * pase con el estado: apuntarlas dos veces la haria reclamar lo mismo dos veces.
 * Fuera de ese turno, una LAPIDA bloquea por cita y personaje y nada mas: el
 * mismo trato contado desde el otro lado —«te debo una cena» y «quedamos en la
 * cena»— sigue siendo lo que Daniel enterro, y `by` es justo lo que el extractor
 * puede reclasificar al reformularlo, asi que atar la lapida a el la abriria
 * sola. Para las demas si cuenta: ahi es una repeticion, y solo estorban las que
 * siguen vivas, porque una promesa que YA se cumplio y se vuelve a hacer semanas
 * despues es una promesa nueva de verdad.
 */
function collides(existing: PooledNote, candidate: PooledNote): boolean {
  if (existing.characterId !== candidate.characterId) return false;

  const sameTurn =
    existing.note.origin.conversationId === candidate.note.origin.conversationId &&
    existing.note.origin.sequence === candidate.note.origin.sequence;

  if (sameTurn) {
    return (
      contains(existing.normalized, candidate.normalized) ||
      contains(candidate.normalized, existing.normalized) ||
      jaccard(existing.stems, candidate.stems) >= SAME_TURN_JACCARD
    );
  }

  if (existing.note.status === 'dismissed') {
    return jaccard(existing.stems, candidate.stems) >= REPEAT_JACCARD;
  }

  if (existing.note.status !== 'open') return false;
  return (
    existing.note.by === candidate.note.by &&
    jaccard(existing.stems, candidate.stems) >= REPEAT_JACCARD
  );
}

export interface RelationMergeInput {
  /** lo que ya hay guardado, con el dueño de cada nota */
  existing: readonly OwnedRelationNote[];
  /** lo que acaba de comprobarse contra los turnos */
  verified: VerifiedRelationExtraction;
  /** de que conversacion y de que personaje es la ventana revisada */
  scope: { conversationId: string; characterId: string | null };
  /** quien la reviso, para poder decir «revisado con Codex» */
  extractedBy: string | null;
  /** el reloj, inyectado */
  now: string;
}

export interface RelationMergeResult {
  /** el almacen resultante, en el mismo orden en que entro */
  notes: RelationNote[];
  /** las que se apuntaron de verdad */
  added: RelationNote[];
  /** las que este paso cerro */
  closed: RelationNote[];
  counters: RelationCounters;
}

/**
 * mete lo verificado en lo que ya hay.
 *
 * Idempotente: aplicar dos veces la misma extraccion deja el mismo almacen. Es
 * el requisito que permite reextraer las conversaciones antiguas tantas veces
 * como haga falta sin mirar antes que hay.
 *
 * Los contadores se ajustan aqui: lo que verifico como aceptado pero acaba
 * fusionado pasa de `accepted` a `merged`, para que `accepted` signifique
 * siempre «lo que de verdad se guardo» y no «lo que parecia bueno».
 */
export function mergeExtraction(input: RelationMergeInput): RelationMergeResult {
  const counters: RelationCounters = { ...input.verified.counters };
  const order: string[] = [];
  const byId = new Map<string, RelationNote>();
  const pooled: PooledNote[] = [];

  for (const owned of input.existing) {
    order.push(owned.note.id);
    byId.set(owned.note.id, owned.note);
    pooled.push(pool(owned));
  }

  const added: RelationNote[] = [];
  for (const verified of input.verified.notes) {
    const id = noteId(verified.origin, verified.quote);
    const candidate: RelationNote = {
      id,
      kind: verified.kind,
      by: verified.by,
      origin: verified.origin,
      quote: verified.quote,
      keywords: verified.keywords,
      status: 'open',
      closure: null,
      source: 'extractor',
      decidedBy: 'extractor',
      reopenedByDaniel: false,
      extractedBy: input.extractedBy,
      extractorVersion: RELATION_EXTRACTOR_VERSION,
      createdAt: input.now,
      updatedAt: input.now,
    };

    const owned: PooledNote = pool({ note: candidate, characterId: input.scope.characterId });
    // el mismo id ya es la misma nota: reextraer no la vuelve a apuntar ni le
    // cambia la fecha, que es lo que hace la idempotencia visible en el panel
    const repeated =
      byId.has(id) || pooled.some((existing) => collides(existing, owned));
    if (repeated) {
      counters.merged += 1;
      counters.accepted = Math.max(0, counters.accepted - 1);
      continue;
    }

    order.push(id);
    byId.set(id, candidate);
    pooled.push(owned);
    added.push(candidate);
  }

  const closed: RelationNote[] = [];
  for (const closure of input.verified.closures) {
    const note = byId.get(closure.noteId);
    // sin nota, ya decidida por Daniel, ya cerrada o con el cierre ANTES del
    // origen, no se toca: el extractor no reabre nada y no puede cerrar una
    // promesa con algo que se dijo antes de hacerla
    if (
      note === undefined ||
      note.decidedBy === 'daniel' ||
      note.status !== 'open' ||
      Date.parse(closure.ref.at) <= Date.parse(note.origin.at)
    ) {
      counters.rejectedClosure += 1;
      counters.accepted = Math.max(0, counters.accepted - 1);
      continue;
    }

    const next: RelationNote = {
      ...note,
      status: closure.how,
      closure: { how: closure.how, ref: closure.ref, at: input.now },
      decidedBy: 'extractor',
      updatedAt: input.now,
    };
    byId.set(next.id, next);
    closed.push(next);
  }

  return {
    notes: order.flatMap((id) => {
      const note = byId.get(id);
      return note === undefined ? [] : [note];
    }),
    added,
    closed,
    counters,
  };
}

// ---------------------------------------------------------------------------
// reclamaciones sin respaldo
// ---------------------------------------------------------------------------

/**
 * como empieza ella a reclamar algo.
 *
 * Son subcadenas y no expresiones regulares a proposito: sobre el texto ya
 * normalizado una subcadena basta, se lee de un vistazo y no puede traer una
 * sorpresa de retroceso con un turno largo.
 */
const CLAIM_PHRASES = [
  'me prometiste',
  'me lo prometiste',
  'me debes',
  'quedamos en',
  'prometiste que',
  'dijiste que me ibas a',
] as const;

/** cuanto texto alrededor se mira para ver de que promesa habla */
const CLAIM_CONTEXT_CHARS = 120;

/** una respuesta de ella, ya descifrada */
export interface CharacterReply {
  text: string;
  createdAt: string;
  /** dueño de la conversacion, deducido igual que el de las notas */
  characterId: string | null;
}

export interface ClaimCounts {
  /** veces que reclama algo */
  herClaims: number;
  /** las que apuntan a una promesa que consta */
  backed: number;
  /** las que no: la cifra que NO puede subir al encender el bloque */
  unbacked: number;
}

const activeKinds: readonly string[] = ACTIVE_RELATION_KINDS;

/**
 * cuenta lo que ella reclama y cuanto de eso consta.
 *
 * Es la unica medida del riesgo grave: que reclame algo que nunca se dijo. La
 * linea base se toma ANTES de extraer nada y antes de encender el bloque, y
 * despues `unbacked` no puede subir. Si sube, el bloque esta inventando.
 *
 * Solo respalda una nota del MISMO personaje y de origen ANTERIOR: una promesa
 * posterior no puede justificar un reproche que ya se habia hecho.
 */
export function detectClaims(
  replies: readonly CharacterReply[],
  notes: readonly OwnedRelationNote[],
): ClaimCounts {
  const indexed = notes
    .filter(({ note }) => activeKinds.includes(note.kind))
    .map((owned) => ({
      characterId: owned.characterId,
      at: Date.parse(owned.note.origin.at),
      stems: quoteStems(owned.note.quote),
    }));

  const counts: ClaimCounts = { herClaims: 0, backed: 0, unbacked: 0 };

  for (const reply of replies) {
    const text = normalizeQuote(reply.text);
    const at = Date.parse(reply.createdAt);

    for (const span of claimSpans(text)) {
      counts.herClaims += 1;
      const around = new Set(
        tokenize(
          text.slice(
            Math.max(0, span.start - CLAIM_CONTEXT_CHARS),
            span.end + CLAIM_CONTEXT_CHARS,
          ),
        ),
      );
      const backed = indexed.some(
        (note) =>
          note.characterId === reply.characterId &&
          note.at < at &&
          countShared(around, note.stems) >= MENTION_MIN_SHARED,
      );
      if (backed) counts.backed += 1;
      else counts.unbacked += 1;
    }
  }

  return counts;
}

/**
 * donde reclama, sin contar dos veces la misma frase.
 *
 * «me prometiste que» dispara dos formulas a la vez; contarla dos veces
 * inflaria la cifra justo en el caso mas corriente.
 */
function claimSpans(text: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  for (const phrase of CLAIM_PHRASES) {
    let from = 0;
    for (;;) {
      const start = text.indexOf(phrase, from);
      if (start < 0) break;
      found.push({ start, end: start + phrase.length });
      from = start + 1;
    }
  }

  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const spans: { start: number; end: number }[] = [];
  for (const span of found) {
    const previous = spans[spans.length - 1];
    if (previous !== undefined && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
      continue;
    }
    spans.push({ ...span });
  }
  return spans;
}
