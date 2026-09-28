// el resumen de sus ultimas conversaciones, para que el personaje RECUERDE desde
// las demas («R1», `D-105`).
//
// Existe por una frase de Daniel: «si Lia no recuerda que es su conversacion, no
// me sirve para nada». Enganchar una conversacion cambia DE QUIEN es; no hace
// que su memoria llegue a ninguna otra. Desde otra conversacion de Lia solo se
// veia una linea de indice. Esto le lleva, en cada turno, un resumen corto de
// sus dos conversaciones mas recientes.
//
// Lo que se lleva y lo que no:
//
//   - `summary` y `decisions`, y NADA mas. `plan` y `openQuestions` son
//     justamente el canal por el que una promesa se convierte en texto fijo del
//     prompt —es lo que mide `ecoMemoria`— y ya los cubre el bloque de
//     pendientes. `facts` y `lessons` son el estado de ESA conversacion, no lo
//     que paso en ella;
//   - con tope: unos 400 caracteres por conversacion y 800 en total.
//
// Las decisiones se etiquetan «apuntadas» y no «lo acordado»: la instruccion de
// memoria de la boveda no define los campos (`schemas.ts`,
// `CONVERSATION_MEMORY_INSTRUCTION`), asi que no esta garantizado que lo
// acordado este ahi. Solo lo define la ficha retroactiva.
//
// PURO: sin disco ni reloj. La seleccion la hace `PrivateMemory` con estos datos.
import type { ConversationMemory } from './schemas.js';

/**
 * ajuste del personaje que enciende el resumen.
 *
 * Es un enum y no un booleano por lo mismo que `imageCast`. Pero si un dia se
 * quieren separar partes, se hace con un CAMPO nuevo y no con valores nuevos
 * aqui: un Studio mas antiguo que lea un valor que no conoce descarta la lista
 * entera de personajes, y al guardar cualquiera los borra todos. Un campo
 * desconocido, en cambio, se ignora al leer sin romper nada.
 */
export const VAULT_RECENT_MEMORIES = ['off', 'recent-two'] as const;
export type VaultRecentMemories = (typeof VAULT_RECENT_MEMORIES)[number];

/** cuantas conversaciones entran: las dos mas recientes, sin la de ahora */
export const RECENT_MEMORIES_COUNT = 2;
/** tope por conversacion, sin contar la fecha ni el titulo */
export const RECENT_MEMORY_ENTRY_CHARS = 400;
/** tope del cuerpo entero del bloque */
export const RECENT_MEMORIES_BLOCK_CHARS = 800;

/**
 * lo que se reserva para las decisiones dentro de cada conversacion.
 *
 * Eran 240, y con la guia de campos de `D-105` —que manda a "decisions" tambien
 * los limites y las reglas del juego— la reserva se llenaba y al resumen le
 * quedaban unos 159 caracteres: una frase (revision del 28/09). Con 160 le
 * quedan al menos 239.
 */
export const RECENT_DECISIONS_CHARS = 160;

/** lo que marca, dentro de un resumen recortado, que falta un tramo del medio */
export const RECENT_SUMMARY_GAP = ' … ';

/** lo que precede a las decisiones dentro de una entrada */
export const RECENT_DECISIONS_LABEL = 'Decisiones apuntadas: ';

/** una conversacion del personaje, para elegir las mas recientes */
export interface RecentConversationCandidate {
  conversationId: string;
  /** createdAt de su ultimo turno */
  updatedAt: string;
  /** cuando se engancho, si se engancho; `null` si no */
  linkedAt: string | null;
}

/** una entrada ya recortada, lista para el prompt */
export interface RecentMemoryEntry {
  /** fecha legible de la conversacion */
  date: string;
  title: string;
  text: string;
}

export interface CondensedRecentMemories {
  entries: RecentMemoryEntry[];
  /**
   * las frases que viajan, para MEDIR si la memoria nueva las copia.
   *
   * Nunca van a un registro: son contenido de la boveda.
   */
  phrases: string[];
  stats: {
    /** decisiones que entraron */
    decisiones: number;
    /** caracteres de texto que entraron */
    caracteres: number;
    /** entradas en las que se quito algo */
    recortadas: number;
    /** caracteres de los resumenes que se quedaron fuera, sumados */
    fuera: number;
  };
}

/** lo que cuenta como reciente: el ultimo turno o el enganche, lo que sea mas tarde */
function recency(candidate: RecentConversationCandidate): string {
  const linked = candidate.linkedAt ?? '';
  return linked > candidate.updatedAt ? linked : candidate.updatedAt;
}

/**
 * las `count` conversaciones mas recientes, sin la actual.
 *
 * El enganche cuenta como reciente a proposito: una conversacion enganchada
 * cuyo ultimo turno es viejo quedaria fuera justo en el momento de engancharla,
 * que es cuando Daniel espera que ella la recuerde.
 */
export function pickRecentConversations<T extends RecentConversationCandidate>(
  candidates: readonly T[],
  excludeId: string | null,
  count: number = RECENT_MEMORIES_COUNT,
): T[] {
  return candidates
    .filter((candidate) => candidate.conversationId !== excludeId)
    .sort((a, b) => {
      const byRecency = recency(b).localeCompare(recency(a));
      if (byRecency !== 0) return byRecency;
      return a.conversationId.localeCompare(b.conversationId);
    })
    .slice(0, Math.max(0, count));
}

/** frases de un texto, por signos de final */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (char === '.' || char === '!' || char === '?' || char === '…' || char === '\n') {
      const trimmed = current.trim();
      if (trimmed.length > 0) out.push(trimmed);
      current = '';
    }
  }
  const rest = current.trim();
  if (rest.length > 0) out.push(rest);
  return out;
}

/**
 * corta en final de frase si se puede, y si no en un espacio con «…».
 *
 * Una frase entera vale mas que dos a medias: el modelo rellena lo que falta.
 *
 * Se queda con la PRIMERA frase y con las ULTIMAS que quepan, con «…» en medio.
 * Antes iba sumando desde la primera y cortaba al pasarse, y de un resumen
 * acumulativo lo ultimo que paso suele ir al final: era justo lo que se caia
 * (revision del 28/09). No esta medido que el modelo escriba esos resumenes en
 * orden, y por eso no se tira la primera, que suele decir de que va todo.
 */
function cutText(text: string, max: number): { text: string; cut: boolean } {
  const clean = text.trim();
  if (clean.length <= max) return { text: clean, cut: false };
  if (max <= 1) return { text: '', cut: true };

  const sentences = sentencesOf(clean);
  // las ultimas frases que quepan detras de `head`, desde el final
  const withTail = (head: string | null, from: number): string => {
    let tail: string[] = [];
    for (let index = sentences.length - 1; index >= from; index -= 1) {
      const next = [sentences[index]!, ...tail];
      // si la cola llega pegada a la cabeza no falta nada en medio
      const joiner = index === from ? ' ' : RECENT_SUMMARY_GAP;
      const candidate = head === null ? next.join(' ') : `${head}${joiner}${next.join(' ')}`;
      if (candidate.length > max) break;
      tail = next;
    }
    if (tail.length === 0) return head ?? '';
    const joiner = sentences.length - tail.length === from ? ' ' : RECENT_SUMMARY_GAP;
    return head === null ? tail.join(' ') : `${head}${joiner}${tail.join(' ')}`;
  };

  const first = sentences[0] ?? '';
  if (sentences.length > 1 && first.length <= max) {
    const both = withTail(first, 1);
    // con la primera y al menos una del final
    if (both.length > first.length) return { text: both, cut: true };
  }
  // la primera no deja sitio: lo mas reciente antes que el principio
  const tailOnly = withTail(null, 0);
  if (tailOnly.length > 0) return { text: tailOnly, cut: true };
  if (first.length > 0 && first.length <= max) return { text: first, cut: true };

  // ni una frase cabe: se corta en el ultimo espacio y se marca
  const room = clean.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  const base = (space > 0 ? room.slice(0, space) : room).trimEnd();
  return { text: base.length === 0 ? '' : `${base}…`, cut: true };
}

/** decisiones enteras, desde la ultima hacia atras, sin pasar del tope */
function pickDecisions(decisions: readonly string[], max: number): string[] {
  const picked: string[] = [];
  let used = RECENT_DECISIONS_LABEL.length;
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index]!.trim();
    if (decision.length === 0) continue;
    const cost = decision.length + (picked.length === 0 ? 0 : 2);
    if (used + cost > max) break;
    picked.unshift(decision);
    used += cost;
  }
  return picked;
}

/**
 * lo que viaja de cada conversacion, recortado.
 *
 * Solo lee `summary` y `decisions`. El orden de `items` se respeta: quien llama
 * ya los paso de la mas reciente a la mas antigua.
 */
export function condenseRecentMemories(
  items: readonly { date: string; title: string; memory: ConversationMemory }[],
): CondensedRecentMemories {
  const entries: RecentMemoryEntry[] = [];
  const phrases: string[] = [];
  const stats = { decisiones: 0, caracteres: 0, recortadas: 0, fuera: 0 };
  let blockLeft = RECENT_MEMORIES_BLOCK_CHARS;

  for (const item of items) {
    const entryMax = Math.min(RECENT_MEMORY_ENTRY_CHARS, blockLeft);
    if (entryMax <= 0) break;

    const allDecisions = item.memory.decisions.filter((each) => each.trim().length > 0);
    const decisions = pickDecisions(allDecisions, Math.min(RECENT_DECISIONS_CHARS, entryMax));
    const decisionsText =
      decisions.length === 0 ? '' : `${RECENT_DECISIONS_LABEL}${decisions.join('; ')}`;
    // el salto de linea entre las dos partes tambien cuenta
    const summaryRoom = entryMax - decisionsText.length - (decisionsText.length > 0 ? 1 : 0);
    const summary = cutText(item.memory.summary, summaryRoom);

    const text = [summary.text, decisionsText].filter((part) => part.length > 0).join('\n');
    if (text.length === 0) continue;

    entries.push({ date: item.date, title: item.title, text });
    // la marca del hueco no es una frase del resumen: no se mide como copiada
    phrases.push(
      ...summary.text
        .split(RECENT_SUMMARY_GAP)
        .flatMap((part) => sentencesOf(part)),
      ...decisions,
    );
    stats.fuera += Math.max(0, item.memory.summary.trim().length - summary.text.length);
    stats.decisiones += decisions.length;
    stats.caracteres += text.length;
    if (summary.cut || decisions.length < allDecisions.length) stats.recortadas += 1;
    blockLeft -= text.length;
  }

  return { entries, phrases, stats };
}
