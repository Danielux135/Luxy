// la memoria de sus ultimas conversaciones, para que al personaje le LLEGUE desde
// las demas («R1», `D-105`).
//
// Existe por una frase de Daniel: «si Lia no recuerda que es su conversacion, no
// me sirve para nada». Enganchar una conversacion cambia DE QUIEN es; no hace
// que su memoria llegue a ninguna otra. Desde otra conversacion de Lia solo se
// veia una linea de indice. Esto le lleva, en cada turno, la memoria de sus dos
// conversaciones mas recientes.
//
// Lo que se lleva y lo que no (quinta ronda de `D-105`):
//
//   - `summary`, `facts`, `decisions` y `lessons`, ENTEROS y en su orden. Antes
//     viajaban 400 caracteres del resumen y 160 de decisiones, y se caia el 86 %
//     de un resumen largo; Daniel pidio la memoria entera;
//   - NUNCA `plan` ni `openQuestions`: son justamente el canal por el que una
//     promesa se convierte en texto fijo del prompt —es lo que mide
//     `ecoMemoria`—, y lo prometido vuelve por el bloque de pendientes, con su
//     ritmo (`D-104`);
//   - NUNCA los mensajes: solo lo que el modelo apunto.
//
// Las decisiones se etiquetan «apuntadas» y no «lo acordado»: la instruccion de
// memoria de la boveda no define los campos (`schemas.ts`,
// `CONVERSATION_MEMORY_INSTRUCTION`), asi que no esta garantizado que lo
// acordado este ahi. Solo lo define la ficha retroactiva.
//
// PURO: sin disco ni reloj. La seleccion la hace `PrivateMemory` con estos datos.
import { memoryCapsFor, repairSlicedMemory, type ConversationMemory } from './schemas.js';

/**
 * ajuste del personaje que enciende la memoria de otras conversaciones.
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

/**
 * version de lo que viaja, para el registro: 2 es la memoria entera. La corta
 * (400/800/160) no llevaba el campo, y se lee como 1. Sin esto, los turnos de
 * antes y de despues de la quinta ronda de `D-105` no se pueden separar.
 */
export const RECENT_MEMORIES_FORMAT = 2;

/**
 * SALVAGUARDA por conversacion, sin contar la fecha ni el titulo. No es un
 * recorte: con lo medido no salta nunca.
 *
 * El bloque `memoria` mas grande visto en `studio.log` son 4.772 caracteres
 * (n=172, 28/09), y eso ya lleva la regla contra la invencion, `plan` y
 * `openQuestions`, que aqui no viajan. El maximo que admite el esquema con los
 * cuatro campos que si viajan es 1.200 + 36 × 240 = 9.840: sin tope, dos
 * memorias asi meterian unos 20.000 caracteres, lo que duplica un prompt
 * normal. No hay tope de bloque aparte: dos por este ya lo acotan.
 */
export const RECENT_MEMORY_ENTRY_CHARS = 6000;

/** como se rotula cada parte dentro de una entrada */
export const RECENT_SECTION_LABELS = {
  resumen: 'Resumen',
  // sin «de entonces»: aqui van tambien los rasgos que duran —quien es quien,
  // como la llama el— y rotularlos todos como pasados los daria por caducados.
  // Lo que distingue unos de otros es una regla del bloque (`vault-prompt.ts`)
  hechos: 'Hechos',
  decisiones: 'Decisiones apuntadas',
  lecciones: 'Lecciones',
} as const;

/** de que parte de la memoria sale una frase medida */
export const RECENT_PHRASE_FIELDS = ['resumen', 'hechos', 'decisiones', 'lecciones'] as const;
export type RecentPhraseField = (typeof RECENT_PHRASE_FIELDS)[number];

/**
 * una frase que viaja, con la parte de la que sale.
 *
 * La parte existe para MEDIR: la copia de un hecho corto y la de una frase del
 * resumen no se leen igual, y la version corta solo llevaba `resumen` y
 * `decisiones`, asi que esas dos son las comparables con los turnos de antes.
 */
export interface RecentPhrase {
  text: string;
  field: RecentPhraseField;
}

/** una conversacion del personaje, para elegir las mas recientes */
export interface RecentConversationCandidate {
  conversationId: string;
  /** createdAt de su ultimo turno */
  updatedAt: string;
  /** cuando se engancho, si se engancho; `null` si no */
  linkedAt: string | null;
}

/** una entrada ya montada, lista para el prompt */
export interface RecentMemoryEntry {
  /** fecha legible de la conversacion */
  date: string;
  title: string;
  text: string;
}

/** lo que se sabe de una conversacion elegida */
export interface RecentMemoryItem {
  date: string;
  title: string;
  memory: ConversationMemory;
  /**
   * de donde salio: la memoria sellada (`'turn'`) o una ficha aprobada
   * (`'recap'`). Decide que huella del corte de antes se busca: una ficha se
   * guardaba cortada a 400/160 y una memoria sellada a 1.200/240.
   */
  source: 'turn' | 'recap';
  /** tramos declarados que nadie resumio; solo los tiene una ficha */
  gaps?: number;
}

export interface CondensedRecentMemories {
  entries: RecentMemoryEntry[];
  /**
   * las frases que viajan, para MEDIR si la memoria nueva las copia.
   *
   * Nunca van a un registro: son contenido de la boveda.
   */
  phrases: RecentPhrase[];
  stats: {
    /** hechos que viajaron */
    hechos: number;
    /** decisiones que viajaron */
    decisiones: number;
    /** lecciones que viajaron */
    lecciones: number;
    /** caracteres de texto que viajaron */
    caracteres: number;
    /** conversaciones en las que la salvaguarda quito algo */
    recortadas: number;
    /** caracteres de las entradas que quito la salvaguarda, sumados */
    fuera: number;
    /** textos con la huella del `slice` de antes, arreglados al presentarlos */
    cortadasAlGuardar: number;
    /** tramos sin resumir declarados en lo que viajo, sumados */
    huecos: number;
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

/**
 * tratamientos que acaban en punto sin acabar la frase. En minusculas y sin el
 * punto
 */
const ABBREVIATIONS = new Set(['sr', 'sra', 'srta', 'dr', 'dra', 'd', 'dña', 'ud', 'uds', 'vd', 'vds']);

/**
 * frases de un texto, por signos de final; lo que no lleva ni una letra no es
 * frase.
 *
 * Un signo solo cierra frase si detras viene un espacio o se acaba el texto:
 * «3.30» o «1.200» partian en dos, y «Sr. Pérez» dejaba «Sr.» como una frase
 * enviada que contaba en `ecoRecientes` (octava ronda). Solo sirve para medir:
 * el bloque que se envia no pasa por aqui. `ecoRecientes` parte con ella
 * tambien el resumen de la memoria nueva: con dos criterios, una copia literal
 * podia quedar en dos trozos que ya no casaban (novena ronda).
 */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let current = '';
  const push = (): void => {
    const trimmed = current.trim();
    if (/[\p{L}\p{N}]/u.test(trimmed)) out.push(trimmed);
    current = '';
  };
  const chars = [...text];
  chars.forEach((char, index) => {
    current += char;
    if (char === '\n') {
      push();
      return;
    }
    if (char !== '.' && char !== '!' && char !== '?' && char !== '…') return;
    const next = chars[index + 1];
    if (next !== undefined && next.trim().length > 0) return;
    if (char === '.') {
      const lastWord = current.slice(0, -1).trim().split(' ').pop() ?? '';
      if (ABBREVIATIONS.has(lastWord.toLocaleLowerCase('es'))) return;
    }
    push();
  });
  push();
  return out;
}

/**
 * el aviso de los tramos que nadie resumio.
 *
 * Es el mismo que lleva el bloque `memoria` de esa conversacion al reabrirla
 * (`formatMemoryGaps`): una ficha que se salto escenas no puede viajar como si
 * lo contara todo. Va el PRIMERO de la entrada y la salvaguarda no lo quita.
 */
function formatRecentGaps(gaps: number): string {
  const uno = gaps === 1;
  return `De esa conversacion hay ${gaps} ${uno ? 'tramo que no se pudo' : 'tramos que no se pudieron'} resumir: de ${uno ? 'ese tramo' : 'esos tramos'} no sabes nada; si hace falta algo de ahi, preguntalo en vez de suponerlo.`;
}

interface EntryParts {
  gapsLine: string | null;
  summary: string;
  hechos: string[];
  decisiones: string[];
  lecciones: string[];
}

function renderEntry(parts: EntryParts): string {
  const lines: string[] = [];
  if (parts.gapsLine !== null) lines.push(parts.gapsLine);
  if (parts.summary.length > 0) lines.push(`${RECENT_SECTION_LABELS.resumen}: ${parts.summary}`);
  const sections: Array<[string, string[]]> = [
    [RECENT_SECTION_LABELS.hechos, parts.hechos],
    [RECENT_SECTION_LABELS.decisiones, parts.decisiones],
    [RECENT_SECTION_LABELS.lecciones, parts.lecciones],
  ];
  for (const [label, entries] of sections) {
    if (entries.length === 0) continue;
    lines.push(`${label}:`, ...entries.map((entry) => `- ${entry}`));
  }
  return lines.join('\n');
}

/**
 * el orden en que la salvaguarda sacrifica listas cuando empatan.
 *
 * El mismo que `clampRecapMemory`: `facts` y `decisions` se defienden los
 * ultimos porque son el estado y los acuerdos.
 */
const SAFEGUARD_ORDER = ['lecciones', 'decisiones', 'hechos'] as const;

/**
 * quita entradas ENTERAS hasta que la entrada quepa, empezando por lo MAS VIEJO.
 *
 * En una memoria acumulativa y en una ficha encadenada lo nuevo se añade al
 * final (`RecapClampOptions`), asi que lo viejo es el principio de cada lista.
 * Entre listas se mira la posicion RELATIVA —la primera de doce es tan vieja
 * como la primera de dos, y la sexta de doce mas que la segunda de dos—, y a
 * igualdad, el orden de `SAFEGUARD_ORDER`. Es la leccion de la segunda ronda de
 * `D-105`: recortar por el final tiraba justo lo ultimo que paso. Que el modelo
 * escriba en orden no esta medido.
 */
function applySafeguard(parts: EntryParts, max: number): { removedChars: number; cut: boolean } {
  let removedChars = 0;
  let cut = false;
  const removed: Record<(typeof SAFEGUARD_ORDER)[number], number> = {
    lecciones: 0,
    decisiones: 0,
    hechos: 0,
  };
  const total: Record<(typeof SAFEGUARD_ORDER)[number], number> = {
    lecciones: parts.lecciones.length,
    decisiones: parts.decisiones.length,
    hechos: parts.hechos.length,
  };

  while (renderEntry(parts).length > max) {
    let pick: (typeof SAFEGUARD_ORDER)[number] | null = null;
    let pickAge = Number.POSITIVE_INFINITY;
    for (const name of SAFEGUARD_ORDER) {
      if (parts[name].length === 0) continue;
      const age = removed[name] / total[name];
      if (age < pickAge) {
        pick = name;
        pickAge = age;
      }
    }
    if (pick === null) break;
    const dropped = parts[pick].shift()!;
    removed[pick] += 1;
    removedChars += dropped.length;
    cut = true;
  }

  // solo quedan el aviso y el resumen. El esquema no deja que pase (1.200), pero
  // si pasara se queda lo del FINAL del resumen, que es lo ultimo que paso
  const over = renderEntry(parts).length - max;
  if (over > 0 && parts.summary.length > 0) {
    const keep = Math.max(0, parts.summary.length - over - 1);
    const tail = parts.summary.slice(parts.summary.length - keep);
    const firstSpace = tail.search(/\s/u);
    const clean = (firstSpace >= 0 ? tail.slice(firstSpace) : tail).trim();
    removedChars += parts.summary.length - clean.length;
    parts.summary = clean.length > 0 ? `…${clean}` : '';
    cut = true;
  }
  return { removedChars, cut };
}

const nonEmpty = (entries: readonly string[]): string[] =>
  entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

/**
 * lo que viaja de cada conversacion: la memoria entera sin `plan` ni
 * `openQuestions`.
 *
 * Lo guardado con el `slice` de antes se arregla aqui, al presentarlo
 * (`repairSlicedMemory`). El orden de `items` se respeta: quien llama ya los
 * paso de la mas reciente a la mas antigua.
 */
export function condenseRecentMemories(
  items: readonly RecentMemoryItem[],
): CondensedRecentMemories {
  const entries: RecentMemoryEntry[] = [];
  const phrases: RecentPhrase[] = [];
  const stats = {
    hechos: 0,
    decisiones: 0,
    lecciones: 0,
    caracteres: 0,
    recortadas: 0,
    fuera: 0,
    cortadasAlGuardar: 0,
    huecos: 0,
  };

  for (const item of items) {
    // sin `plan` ni `openQuestions` desde el principio: ni viajan ni cuentan
    // como arreglados
    const repaired = repairSlicedMemory(
      { ...item.memory, plan: [], openQuestions: [] },
      memoryCapsFor(item.source),
    );
    const memory = repaired.memory;
    const gaps =
      typeof item.gaps === 'number' && Number.isFinite(item.gaps)
        ? Math.max(0, Math.trunc(item.gaps))
        : 0;
    const parts: EntryParts = {
      gapsLine: gaps > 0 ? formatRecentGaps(gaps) : null,
      summary: memory.summary.trim(),
      hechos: nonEmpty(memory.facts),
      decisiones: nonEmpty(memory.decisions),
      lecciones: nonEmpty(memory.lessons),
    };
    // sin nada de la memoria no hay entrada, aunque haya aviso de tramos: un
    // aviso suelto diria que hay una conversacion de la que no le llega nada
    if (
      parts.summary.length === 0 &&
      parts.hechos.length + parts.decisiones.length + parts.lecciones.length === 0
    ) {
      continue;
    }

    const safeguard = applySafeguard(parts, RECENT_MEMORY_ENTRY_CHARS);
    const text = renderEntry(parts);
    entries.push({ date: item.date, title: item.title, text });

    phrases.push(
      ...sentencesOf(parts.summary).map((each) => ({ text: each, field: 'resumen' as const })),
      ...parts.hechos.map((each) => ({ text: each, field: 'hechos' as const })),
      ...parts.decisiones.map((each) => ({ text: each, field: 'decisiones' as const })),
      ...parts.lecciones.map((each) => ({ text: each, field: 'lecciones' as const })),
    );
    stats.hechos += parts.hechos.length;
    stats.decisiones += parts.decisiones.length;
    stats.lecciones += parts.lecciones.length;
    stats.caracteres += text.length;
    stats.fuera += safeguard.removedChars;
    stats.cortadasAlGuardar += repaired.repaired;
    stats.huecos += gaps;
    if (safeguard.cut) stats.recortadas += 1;
  }

  return { entries, phrases, stats };
}
