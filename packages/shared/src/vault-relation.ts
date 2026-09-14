// asuntos pendientes entre los dos: promesas y planes que quedaron sin cumplir.
//
// Por que existe: ella no puede recordarle a el lo que le prometio si nadie lo
// apunta, y el historial reciente solo le enseña los ultimos turnos. Un modelo de
// suscripcion lee la conversacion entre turnos y señala DONDE se prometio algo.
//
// Lo que se guarda es un PUNTERO a un turno real con una cita literal que el
// codigo comprueba, nunca un resumen. La asimetria es la misma que en el
// catalogo: un extractor equivocado puede hacer que una promesa no se apunte
// —molesto—, pero no que ella reclame algo que nunca se dijo, que es lo grave.
// Por eso la cita se verifica letra por letra y el rol se comprueba: sin eso, un
// «me prometiste un collar» que se inventara ella se blanquearia como promesa
// de el.
//
// Modulo PURO: esquemas, el prompt del extractor, la lectura de su respuesta y
// la verificacion contra los turnos. No llama a nadie y no guarda nada.
import { z } from 'zod';
import { LOCAL_CLI_PROVIDERS } from './constants.js';
import {
  CATALOG_CUT_MARK,
  clipMiddle,
  flattenTurnText,
  turnAllowance,
  type CatalogStatus,
} from './vault-catalog.js';
import { civilDayLabel, type TemporalAnchor } from './temporal-reference.js';

// v1 solo produce 'promise' y 'plan'. Los demas reservan la forma para el
// animo (joy/hurt) y para lo que ella sabe de el (taste/person).
export const RELATION_KINDS = ['promise', 'plan', 'joy', 'hurt', 'taste', 'person'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
export const ACTIVE_RELATION_KINDS = ['promise', 'plan'] as const;
export type ActiveRelationKind = (typeof ACTIVE_RELATION_KINDS)[number];

/** quien se compromete; 'both' = plan de los dos */
export const RELATION_PARTIES = ['user', 'character', 'both'] as const;
export type RelationParty = (typeof RELATION_PARTIES)[number];

export const RELATION_STATUSES = ['open', 'fulfilled', 'released', 'dismissed'] as const;
export type RelationStatus = (typeof RELATION_STATUSES)[number];

export const RELATION_EXTRACTOR_VERSION = 1;
export const RELATION_OPEN = '<LUXY_PENDIENTES>';
export const RELATION_CLOSE = '</LUXY_PENDIENTES>';
/** parte nueva por llamada */
export const RELATION_WINDOW_TURNS = 40;
/** contexto ya revisado, marcado */
export const RELATION_CONTEXT_TURNS = 4;
/** abiertas que se le enseñan */
export const RELATION_OPEN_LIST_MAX = 30;
export const QUOTE_MIN_CHARS = 12;
export const QUOTE_MAX_CHARS = 240;
/**
 * el minimo de palabras que ya pide el prompt («de 3 a 30 palabras»).
 *
 * Hace falta ademas del minimo de caracteres porque la cita se compara ya
 * normalizada: doce signos seguidos de un «si» pasan el tope de longitud y,
 * limpios, casarian con casi cualquier turno.
 */
export const QUOTE_MIN_WORDS = 3;

const iso = z.string().datetime();

export const relationTurnRefSchema = z.object({
  conversationId: z.string().uuid(),
  sequence: z.number().int().min(0),
});
export type RelationTurnRef = z.infer<typeof relationTurnRefSchema>;

export const relationNoteSchema = z.object({
  /** sha256 de `${conversationId}#${sequence}#${normalizeQuote(quote)}`, 16 hex */
  id: z.string().regex(/^[0-9a-f]{16}$/),
  kind: z.enum(RELATION_KINDS),
  by: z.enum(RELATION_PARTIES),
  origin: relationTurnRefSchema.extend({
    role: z.enum(['user', 'assistant']),
    // createdAt del turno: ordena sin descifrar
    at: iso,
  }),
  /** LITERAL y verificada contra origin al guardar y al enseñar */
  quote: z.string().min(QUOTE_MIN_CHARS).max(QUOTE_MAX_CHARS),
  /** indice libre del extractor: SOLO sirve para callarla antes, nunca llega al prompt */
  keywords: z.array(z.string().min(2).max(30)).max(5).default([]),
  status: z.enum(RELATION_STATUSES),
  closure: z
    .object({
      how: z.enum(['fulfilled', 'released', 'dismissed']),
      /** turno donde se ve; null si lo cerro Daniel o si su conversacion se borro */
      ref: relationTurnRefSchema
        .extend({ quote: z.string().max(QUOTE_MAX_CHARS), at: iso })
        .nullable(),
      at: iso,
    })
    .nullable(),
  source: z.enum(['extractor', 'manual']).default('extractor'),
  /** quien puso el estado actual: el extractor nunca pisa a 'daniel' */
  decidedBy: z.enum(['extractor', 'daniel']),
  reopenedByDaniel: z.boolean().default(false),
  extractedBy: z.string().max(128).nullable(),
  extractorVersion: z.number().int().min(1),
  createdAt: iso,
  updatedAt: iso,
});
export type RelationNote = z.infer<typeof relationNoteSchema>;

export const relationCursorSchema = z.object({
  conversationId: z.string().uuid(),
  /** ultimo turno del PERSONAJE ya revisado; -1 = nada */
  through: z.number().int().min(-1),
  /** createdAt de ese turno: si no casa, el cursor vuelve a -1 (reextraer es idempotente) */
  throughAt: iso.nullable(),
  version: z.number().int().min(1),
  provider: z.enum(LOCAL_CLI_PROVIDERS),
  model: z.string().max(128).nullable(),
  at: iso,
  /** negativa persistida: no bloquea el desfase y no se reintenta sola si no ha crecido */
  refusedVersion: z.number().int().min(1).nullable().default(null),
  refusedAtTurns: z.number().int().min(0).nullable().default(null),
});
export type RelationCursor = z.infer<typeof relationCursorSchema>;

export const relationCountersSchema = z.object({
  proposed: z.number().int().min(0).default(0),
  accepted: z.number().int().min(0).default(0),
  rejectedShape: z.number().int().min(0).default(0),
  rejectedQuote: z.number().int().min(0).default(0),
  rejectedRole: z.number().int().min(0).default(0),
  rejectedWindow: z.number().int().min(0).default(0),
  rejectedClosure: z.number().int().min(0).default(0),
  merged: z.number().int().min(0).default(0),
  refused: z.number().int().min(0).default(0),
});
export type RelationCounters = z.infer<typeof relationCountersSchema>;

/** respuesta del extractor, tolerante elemento a elemento */
export const relationProposalSchema = z.object({
  turn: z.number().int().min(0),
  by: z.enum(RELATION_PARTIES),
  kind: z.enum(ACTIVE_RELATION_KINDS),
  quote: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(QUOTE_MIN_CHARS).max(QUOTE_MAX_CHARS)),
  keywords: z
    .array(z.unknown())
    .default([])
    .transform((values) =>
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().slice(0, 30))
        .filter((value) => value.length >= 2)
        .slice(0, 5),
    ),
});
export type RelationProposal = z.infer<typeof relationProposalSchema>;

export const relationClosureProposalSchema = z.object({
  // p1..p30
  ref: z.string().min(2).max(8),
  how: z.enum(['fulfilled', 'released']),
  turn: z.number().int().min(0),
  quote: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(QUOTE_MIN_CHARS).max(QUOTE_MAX_CHARS)),
});
export type RelationClosureProposal = z.infer<typeof relationClosureProposalSchema>;

// ---------------------------------------------------------------------------
// la cita
// ---------------------------------------------------------------------------

/**
 * los puntos suspensivos, cuando la cita los trae.
 *
 * Un caracter de uso privado: no puede venir en un texto real y la limpieza no
 * lo toca, porque no pasa por ella. Sirve para que una elision («te traigo…
 * a la cama») no se convierta en un espacio y case como si fuera literal.
 */
const ELLIPSIS_TOKEN = String.fromCharCode(0xe000);

/** asteriscos y comillas se QUITAN, no se cambian por espacio */
const QUOTE_MARKS = /^[*«»"“”'‘’„]$/u;

const HAS_ELLIPSIS = /…|\.\./u;

/** la marca del recorte tal y como aparece en un turno recortado */
const CUT_MARK_TEXT = CATALOG_CUT_MARK.trim();

/** un texto normalizado que recuerda de donde salio cada caracter */
interface MappedText {
  /** el texto ya normalizado */
  text: string;
  /** el original en NFC: los indices de abajo apuntan aqui */
  source: string;
  /** de cada unidad de `text`, donde empieza y acaba en `source` */
  starts: number[];
  ends: number[];
}

/**
 * lo que queda de un caracter al normalizarlo.
 *
 * Minusculas y sin tildes, pero la ñ se conserva: «año» y «ano» no son la misma
 * palabra, y confundirlas daria por literal una cita que no lo es.
 */
function foldChar(char: string): string {
  if (/^[a-z0-9 ]$/.test(char)) return char;
  if (QUOTE_MARKS.test(char)) return '';
  const lower = char.toLowerCase();
  // el texto ya llega en NFC, asi que la ñ viene entera y se aparta antes de
  // quitar las marcas: NFD la partiria en n + tilde y la tilde se iria con ellas
  if (lower === 'ñ') return lower;
  return lower
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, ' ');
}

function isEllipsisAt(source: string, index: number): boolean {
  const char = source[index];
  return char === '…' || (char === '.' && source[index + 1] === '.');
}

/**
 * normaliza caracter a caracter guardando la posicion original.
 *
 * Se hace asi, y no con un par de `replace`, para poder devolver el trozo
 * LITERAL del turno que casa: el extractor puede escribir la cita sin tildes, y
 * lo que luego se le enseña a ella entre comillas tiene que ser lo que se dijo.
 */
function normalizeMapped(input: string, keepEllipsis: boolean): MappedText {
  const source = input.normalize('NFC');
  const out: MappedText = { text: '', source, starts: [], ends: [] };

  const emit = (chunk: string, start: number, end: number): void => {
    for (const unit of chunk.split('')) {
      if (unit === ' ' && (out.text.length === 0 || out.text.endsWith(' '))) continue;
      out.text += unit;
      out.starts.push(start);
      out.ends.push(end);
    }
  };

  let index = 0;
  while (index < source.length) {
    const char = String.fromCodePoint(source.codePointAt(index)!);
    let next = index + char.length;
    if (keepEllipsis && isEllipsisAt(source, index)) {
      while (next < source.length && (source[next] === '.' || source[next] === '…')) next += 1;
      emit(` ${ELLIPSIS_TOKEN} `, index, next);
    } else {
      emit(foldChar(char), index, next);
    }
    index = next;
  }

  if (out.text.endsWith(' ')) {
    out.text = out.text.slice(0, -1);
    out.starts.pop();
    out.ends.pop();
  }
  return out;
}

/**
 * la forma con la que se comparan las citas.
 *
 * Minusculas; sin tildes pero con la ñ; sin asteriscos ni comillas; la
 * puntuacion pasa a espacio y los espacios se colapsan. Asi una cita copiada
 * sin tildes o sin las acotaciones entre asteriscos sigue casando, y una
 * parafrasis («2 cafés» por «dos cafés») no.
 *
 * Tambien es la base del id de una nota, asi que cambiarla cambia los ids.
 */
export function normalizeQuote(text: string): string {
  return normalizeMapped(text, false).text;
}

/**
 * el trozo literal del turno donde aparece la cita, o `null`.
 *
 * Se busca contra el texto COMPLETO del turno, nunca contra el recortado que se
 * le enseño al extractor: una cita que cruce «[…recorte…]» junta dos trozos que
 * no estan seguidos, asi que no aparece. Y casa por palabras enteras, no por
 * trozos de palabra.
 *
 * Unos puntos suspensivos en la cita tienen que estar tambien en el turno, en
 * el mismo sitio: si no, son una elision y la cita ya no es literal.
 */
export function locateQuote(quote: string, turnText: string): string | null {
  if (quote.includes(CUT_MARK_TEXT)) return null;

  const keepEllipsis = HAS_ELLIPSIS.test(quote);
  const needle = normalizeMapped(quote, keepEllipsis).text;
  if (!/[\p{L}\p{N}]/u.test(needle)) return null;

  const haystack = normalizeMapped(turnText, keepEllipsis);
  const found = ` ${haystack.text} `.indexOf(` ${needle} `);
  if (found < 0) return null;

  const start = haystack.starts[found];
  const end = haystack.ends[found + needle.length - 1];
  if (start === undefined || end === undefined) return null;
  return haystack.source.slice(start, end);
}

/** si la cita aparece literal, una vez normalizada, en el texto completo del turno */
export function quoteAppearsIn(quote: string, turnText: string): boolean {
  return locateQuote(quote, turnText) !== null;
}

function quoteWords(quote: string): number {
  const normalized = normalizeQuote(quote);
  return normalized.length === 0 ? 0 : normalized.split(' ').length;
}

/**
 * la cita que se guarda: el trozo del turno, no lo que escribio el extractor.
 *
 * Si el trozo literal se sale de los topes —quitarle los signos del principio y
 * del final puede dejarlo por debajo del minimo— se queda la del extractor, que
 * ya se ha comprobado igual y que el esquema de la nota admite.
 */
function verifiedQuote(proposed: string, turnText: string): string | null {
  if (quoteWords(proposed) < QUOTE_MIN_WORDS) return null;
  const located = locateQuote(proposed, turnText);
  if (located === null) return null;
  const literal = flattenTurnText(located);
  return literal.length >= QUOTE_MIN_CHARS && literal.length <= QUOTE_MAX_CHARS
    ? literal
    : proposed;
}

// ---------------------------------------------------------------------------
// lo que se le enseña al extractor
// ---------------------------------------------------------------------------

/** un turno tal y como se le enseña al extractor */
export interface RelationPromptTurn {
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
}

/** una nota abierta ofrecida al extractor para que pueda cerrarla */
export interface RelationOpenOffer {
  /** identificador POSICIONAL que se le enseña: p1, p2... */
  ref: string;
  noteId: string;
  by: RelationParty;
  quote: string;
  origin: { conversationId: string; sequence: number; at: string };
  /** dueño de la nota, deducido de su conversacion de origen */
  characterId: string | null;
}

/**
 * las abiertas que se le ofrecen, con sus refs.
 *
 * Solo las del MISMO personaje y anteriores al primer turno de la ventana: una
 * ventana antigua, procesada fuera de orden en un reintento, no puede ver ni
 * cerrar una promesa que todavia no se habia hecho. De esas, las mas recientes,
 * y luego en orden cronologico para que p1 sea la mas antigua.
 *
 * Las refs son posicionales a proposito: un id de 16 hex se copia mal, y un
 * error de copia cerraria otra nota.
 */
export function offerOpenRelations(
  notes: readonly { note: RelationNote; characterId: string | null }[],
  scope: { characterId: string | null; before: string },
): RelationOpenOffer[] {
  const before = Date.parse(scope.before);
  const activeKinds: readonly string[] = ACTIVE_RELATION_KINDS;

  const candidates = notes.filter(
    ({ note, characterId }) =>
      characterId === scope.characterId &&
      note.status === 'open' &&
      activeKinds.includes(note.kind) &&
      Date.parse(note.origin.at) < before,
  );

  const newestFirst = [...candidates].sort(
    (a, b) =>
      Date.parse(b.note.origin.at) - Date.parse(a.note.origin.at) ||
      a.note.origin.conversationId.localeCompare(b.note.origin.conversationId) ||
      b.note.origin.sequence - a.note.origin.sequence,
  );

  return newestFirst
    .slice(0, RELATION_OPEN_LIST_MAX)
    .reverse()
    .map(({ note, characterId }, index) => ({
      ref: `p${index + 1}`,
      noteId: note.id,
      by: note.by,
      quote: note.quote,
      origin: {
        conversationId: note.origin.conversationId,
        sequence: note.origin.sequence,
        at: note.origin.at,
      },
      characterId,
    }));
}

export interface RelationExtractionPromptInput {
  /** turnos ya revisados: solo para entender el principio de la parte nueva */
  context: readonly RelationPromptTurn[];
  /** la PARTE NUEVA: lo unico donde se puede apuntar o cerrar algo */
  turns: readonly RelationPromptTurn[];
  open: readonly RelationOpenOffer[];
  /** para escribir el dia de cada pendiente con el mismo corte de las 05:00 */
  anchor: TemporalAnchor;
}

const WHO_PROMISED: Record<RelationParty, string> = {
  user: 'prometio el Usuario',
  character: 'prometio el Personaje',
  both: 'lo quedaron los dos',
};

/**
 * el prompt del extractor.
 *
 * NO va en personaje, igual que el del catalogo: es una tarea tecnica sobre un
 * texto. Todo lo que viene de la conversacion va como DATOS.
 *
 * Los turnos se recortan con las MISMAS piezas que el catalogo —por el medio y
 * con el mismo tope global—, contando juntos el contexto y la parte nueva. La
 * ventana la decide quien llama: aqui no se descarta ningun turno, porque un
 * turno que no se enseña y aun asi se da por revisado es una promesa perdida.
 */
export function buildRelationExtractionPrompt(input: RelationExtractionPromptInput): string {
  const first = input.turns[0]?.sequence ?? 0;
  const last = input.turns[input.turns.length - 1]?.sequence ?? 0;

  const flatten = (turn: RelationPromptTurn): RelationPromptTurn => ({
    ...turn,
    text: flattenTurnText(turn.text),
  });
  const context = input.context.map(flatten);
  const fresh = input.turns.map(flatten);
  const allowance = turnAllowance([...context, ...fresh].map((turn) => turn.text.length));

  const line = (turn: RelationPromptTurn): string =>
    `[${turn.sequence}] ${turn.role === 'user' ? 'Usuario' : 'Personaje'}: ${clipMiddle(
      turn.text,
      allowance,
    )}`;

  const offer = (item: RelationOpenOffer): string =>
    `- [${item.ref}] ${civilDayLabel(item.origin.at, input.anchor)} · ${WHO_PROMISED[item.by]}: «${flattenTurnText(item.quote)}»`;

  return [
    'Estas revisando una conversacion de roleplay para apuntar en un indice las PROMESAS y los',
    'PLANES que quedan pendientes entre los dos. No la continues, no la valores y no hables con',
    'nadie: solo señalas donde estan, para poder recordarlos despues.',
    '',
    'Que cuenta:',
    '- una PROMESA: uno de los dos se compromete a hacer, dar, traer o enseñar algo al otro MAS',
    '  ADELANTE, dentro de la historia, en serio o medio en broma. Por ejemplo «mañana te traigo el',
    '  desayuno», «te debo una cena», «te lo compensare el sabado».',
    '- un PLAN: los dos quedan en hacer algo juntos mas adelante. Por ejemplo «el domingo vamos al',
    '  mercado».',
    'Que NO cuenta: un deseo sin compromiso («ojala algun dia te llevara a Paris»), una hipotesis',
    '(«si me tocara la loteria...»), lo que se hace en ese mismo momento o en el turno siguiente, lo',
    'que se promete y ya se cumple dentro de la PARTE NUEVA, lo que alguien cuenta que le prometio a',
    'otra persona, y lo que se dice fuera de la historia hablando de la aplicacion, de la IA o del',
    'propio roleplay.',
    '',
    `1. NUEVOS, solo en los turnos [${first}] a [${last}] (la PARTE NUEVA). De cada uno das:`,
    '   - `turn`: el numero del turno donde se promete o se queda.',
    '   - `by`: "user" si se compromete el Usuario, "character" si se compromete el Personaje,',
    '     "both" si es un plan de los dos.',
    '   - `kind`: "promise" o "plan".',
    '   - `quote`: un trozo COPIADO LETRA POR LETRA de ese turno, de 3 a 30 palabras, que diga que se',
    '     promete; no vale solo «te lo prometo». Sin resumir, sin corregir y sin puntos suspensivos:',
    '     se comprueba contra el texto y, si no aparece tal cual, se descarta.',
    '   - `keywords`: de 1 a 5 palabras con las que se volveria a hablar de ello, aunque no esten en',
    '     la cita.',
    '   Si una promesa de la PARTE NUEVA es la misma que una de los PENDIENTES ABIERTOS, no la',
    '   apuntes como nueva.',
    '2. CIERRES de los PENDIENTES ABIERTOS de abajo, solo si pasan en la PARTE NUEVA:',
    '   - `ref`: su identificador (p1, p2...).',
    '   - `how`: "fulfilled" si de verdad se hace en la escena; "released" si quien lo esperaba lo',
    '     perdona o lo anula, o si quien lo prometio se desdice y el otro lo acepta.',
    '   - `turn` y `quote`: donde se ve, con la misma regla de la cita copiada letra por letra.',
    '   Que alguien lo recuerde, lo reclame o lo repita («mañana sin falta») NO lo cierra: eso no se',
    '   apunta.',
    `Mejor ninguno que uno dudoso. Si un turno viene con «${CUT_MARK_TEXT}» en medio, se le ha quitado el`,
    'centro para que quepa: una cita no puede cruzar esa marca.',
    '',
    'Si no hay nada, devuelve las dos listas vacias. Responde SOLO con este bloque, sin nada antes',
    'ni despues y sin cercas Markdown:',
    RELATION_OPEN,
    '{"new":[{"turn":12,"by":"user","kind":"promise","quote":"...","keywords":["..."]}],"closed":[{"ref":"p1","how":"fulfilled","turn":30,"quote":"..."}]}',
    RELATION_CLOSE,
    '',
    'PENDIENTES ABIERTOS (DATOS):',
    ...(input.open.length === 0 ? ['- ninguno'] : input.open.map(offer)),
    // sin nada revisado antes no hay contexto que marcar: la seccion sobra
    ...(context.length === 0
      ? []
      : ['', 'CONTEXTO YA REVISADO (DATOS; no apuntes nada de aqui):', ...context.map(line)]),
    '',
    'PARTE NUEVA (DATOS):',
    ...fresh.map(line),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// lo que devuelve el extractor
// ---------------------------------------------------------------------------

/** los mismos cuatro finales que el catalogo, con el mismo significado */
export type RelationExtractionStatus = CatalogStatus;

export interface ParsedRelationExtraction {
  status: RelationExtractionStatus;
  proposals: RelationProposal[];
  closures: RelationClosureProposal[];
  /** elementos que no tenian la forma pedida: se tiran de uno en uno */
  malformed: number;
  /** por que se rechazo, cuando se rechaza. Para poder arreglarlo, no para el usuario */
  reason: string | null;
}

const nothingParsed = (
  status: RelationExtractionStatus,
  reason: string | null,
  malformed = 0,
): ParsedRelationExtraction => ({ status, proposals: [], closures: [], malformed, reason });

/**
 * lee la respuesta del extractor.
 *
 * Al reves que el catalogo, NO rechaza en bloque por un elemento malo: cada
 * propuesta es independiente de las demas, asi que una mal formada se cuenta y
 * se tira, y las otras siguen. Lo que si se exige es el sobre: sin bloque, o
 * con un bloque que no se lee, no hay nada que apuntar y el cursor no avanza.
 *
 * Un bloque donde NINGUN elemento tiene la forma se da por invalido y no por
 * vacio: darlo por bueno avanzaria el cursor y perderia para siempre lo que el
 * extractor intento señalar con otro formato.
 */
export function parseRelationExtraction(text: string): ParsedRelationExtraction {
  const openAt = text.lastIndexOf(RELATION_OPEN);
  if (openAt < 0) return nothingParsed('absent', null);

  const contentAt = openAt + RELATION_OPEN.length;
  const closeAt = text.indexOf(RELATION_CLOSE, contentAt);
  if (closeAt < 0) return nothingParsed('truncated_block', null);

  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text.slice(contentAt, closeAt)));
  } catch {
    return nothingParsed('invalid', 'el bloque no es JSON');
  }

  const body = unwrapExtraction(raw);
  if (body === null) return nothingParsed('invalid', 'el bloque no trae las listas «new» y «closed»');

  const fresh = listAt(body, 'new');
  const closed = listAt(body, 'closed');
  if (fresh === null || closed === null) {
    return nothingParsed('invalid', '«new» o «closed» no es una lista');
  }

  const proposals: RelationProposal[] = [];
  const closures: RelationClosureProposal[] = [];
  let malformed = 0;

  for (const item of fresh) {
    const parsed = relationProposalSchema.safeParse(item);
    if (parsed.success) proposals.push(parsed.data);
    else malformed += 1;
  }
  for (const item of closed) {
    const parsed = relationClosureProposalSchema.safeParse(item);
    if (parsed.success) closures.push(parsed.data);
    else malformed += 1;
  }

  if (malformed > 0 && proposals.length === 0 && closures.length === 0) {
    return nothingParsed('invalid', 'ninguna propuesta tiene la forma pedida', malformed);
  }
  return { status: 'structured', proposals, closures, malformed, reason: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasLists(value: Record<string, unknown>): boolean {
  return 'new' in value || 'closed' in value;
}

/**
 * el modelo a veces devuelve `{"pendientes": {...}}` en vez del objeto pelado.
 *
 * Rechazarlo por eso seria tirar una extraccion correcta por como viene envuelta.
 */
function unwrapExtraction(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (hasLists(raw)) return raw;
  for (const value of Object.values(raw)) {
    if (isRecord(value) && hasLists(value)) return value;
  }
  return null;
}

/** una lista que falta o viene a `null` es una lista vacia; otra cosa no es una lista */
function listAt(body: Record<string, unknown>, key: string): unknown[] | null {
  const value = body[key];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : null;
}

/** el modelo a veces envuelve el JSON en una cerca Markdown aunque se le pida que no */
function stripFence(block: string): string {
  const trimmed = block.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```$/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// verificacion contra los turnos
// ---------------------------------------------------------------------------

/** un turno de la parte nueva, con su texto COMPLETO: contra el se comprueban las citas */
export interface RelationWindowTurn extends RelationPromptTurn {
  createdAt: string;
}

export interface RelationVerificationContext {
  conversationId: string;
  /** personaje de esta conversacion; `null` para los hilos sin personaje */
  characterId: string | null;
  /** la PARTE NUEVA; el contexto no va aqui porque de el no se apunta nada */
  turns: readonly RelationWindowTurn[];
  /** lo mismo que se le ofrecio en el prompt */
  open: readonly RelationOpenOffer[];
}

/** una nota nueva ya comprobada; el id y las fechas los pone quien la guarda */
export interface VerifiedRelationNote {
  kind: ActiveRelationKind;
  by: RelationParty;
  origin: { conversationId: string; sequence: number; role: 'user' | 'assistant'; at: string };
  /** el trozo literal del turno */
  quote: string;
  keywords: string[];
}

/** un cierre ya comprobado de una nota ofrecida */
export interface VerifiedRelationClosure {
  noteId: string;
  how: 'fulfilled' | 'released';
  ref: { conversationId: string; sequence: number; quote: string; at: string };
}

export interface VerifiedRelationExtraction {
  notes: VerifiedRelationNote[];
  closures: VerifiedRelationClosure[];
  /** lo de esta llamada; `merged` y `refused` los pone quien fusiona y quien llama */
  counters: RelationCounters;
}

/**
 * `by` tiene que casar con quien dice la cita.
 *
 * Es lo que impide el blanqueo: si ella se inventa «me prometiste un collar», la
 * cita esta en un turno del personaje y no puede apuntarse como promesa de el.
 * Un plan de los dos puede quedarse en boca de cualquiera.
 */
function roleMatches(by: RelationParty, role: 'user' | 'assistant'): boolean {
  if (by === 'both') return true;
  return by === 'user' ? role === 'user' : role === 'assistant';
}

/** «[p1]», «P1» o « p1 » son la misma ref: el modelo la copia de una lista con corchetes */
function normalizeRef(ref: string): string {
  return ref.replace(/[[\]\s]/g, '').toLowerCase();
}

/**
 * comprueba cada propuesta contra los turnos reales y descarta de una en una.
 *
 * Cada descarte se cuenta con su motivo —el primero que falla—, porque sin eso
 * «no apunto nada» y «apunto mucho y se tiro todo» no se distinguen, y se
 * arreglan de formas muy distintas.
 */
export function verifyRelationExtraction(
  parsed: ParsedRelationExtraction,
  ctx: RelationVerificationContext,
): VerifiedRelationExtraction {
  const counters = relationCountersSchema.parse({});
  counters.proposed = parsed.proposals.length + parsed.closures.length + parsed.malformed;
  counters.rejectedShape = parsed.malformed;

  const turns = new Map(ctx.turns.map((turn) => [turn.sequence, turn]));
  const notes: VerifiedRelationNote[] = [];
  const closures: VerifiedRelationClosure[] = [];

  for (const proposal of parsed.proposals) {
    const turn = turns.get(proposal.turn);
    if (turn === undefined) {
      counters.rejectedWindow += 1;
      continue;
    }
    if (!roleMatches(proposal.by, turn.role)) {
      counters.rejectedRole += 1;
      continue;
    }
    const quote = verifiedQuote(proposal.quote, turn.text);
    if (quote === null) {
      counters.rejectedQuote += 1;
      continue;
    }
    notes.push({
      kind: proposal.kind,
      by: proposal.by,
      origin: {
        conversationId: ctx.conversationId,
        sequence: turn.sequence,
        role: turn.role,
        at: turn.createdAt,
      },
      quote,
      keywords: proposal.keywords,
    });
    counters.accepted += 1;
  }

  const offers = new Map(ctx.open.map((item) => [normalizeRef(item.ref), item]));
  for (const closure of parsed.closures) {
    const offered = offers.get(normalizeRef(closure.ref));
    const turn = turns.get(closure.turn);
    // sin ref ofrecida, fuera de la parte nueva, de otro personaje o no
    // posterior al origen, no es un cierre de ESA promesa
    if (
      offered === undefined ||
      turn === undefined ||
      offered.characterId !== ctx.characterId ||
      !(Date.parse(turn.createdAt) > Date.parse(offered.origin.at))
    ) {
      counters.rejectedClosure += 1;
      continue;
    }
    const quote = verifiedQuote(closure.quote, turn.text);
    if (quote === null) {
      counters.rejectedQuote += 1;
      continue;
    }
    closures.push({
      noteId: offered.noteId,
      how: closure.how,
      ref: {
        conversationId: ctx.conversationId,
        sequence: turn.sequence,
        quote,
        at: turn.createdAt,
      },
    });
    counters.accepted += 1;
  }

  return { notes, closures, counters };
}
