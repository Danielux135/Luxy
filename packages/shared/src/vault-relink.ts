// la memoria de una conversacion ENGANCHADA, reescrita con la ficha de su
// personaje (`D-108`).
//
// Por que existe: el criterio de Daniel es que una conversacion que pasa a ser
// de Lia quede «como si hubiese empezado con ella». Casi todo ya queda igual al
// enganchar —la ficha, las instrucciones, el grupo, los recuerdos—, salvo la
// memoria sellada: la fue escribiendo el modelo SIN la ficha delante, y la
// instruccion de cada turno le pide conservar lo valido de la anterior, asi que
// lo improvisado —otro nombre, «la IA», rasgos que la ficha contradice— se
// arrastra para siempre. Una nacida con ella la escribio con la ficha desde el
// turno 0.
//
// La reescritura la hace Claude Code o Codex con la sesion local, NUNCA una API
// de pago (`D-087`), y vive FUERA del `.jsonl` (`vault/memory-relink.json`): el
// archivo sellado no se toca nunca. Solo vale ATADA a la ultima memoria sellada
// exacta —secuencia y fecha— y al enganche que gana; en cuanto cualquiera de
// las dos cosas cambia, vuelve a valer la sellada. Si falla, se niega o pierde
// material, sigue valiendo la de antes (`D-088`).
//
// Modulo PURO: arma el prompt, lee la respuesta y decide. No llama a nadie, no
// lee disco y no clasifica negativas: `classifyReply` vive en `apps/desktop` y
// este paquete no puede importarlo, asi que quien llama clasifica y pasa aqui
// el resultado ya decidido.
import { z } from 'zod';
import {
  CONVERSATION_MEMORY_ENTRY_CHARS,
  CONVERSATION_MEMORY_SUMMARY_CHARS,
  clipAtWord,
  conversationMemorySchema,
  looksLikeCode,
  type ConversationMemory,
} from './schemas.js';
import { LOCAL_CLI_PROVIDERS } from './constants.js';
import { flattenTurnText } from './vault-catalog.js';
import {
  compareMemoryEntries,
  countedWords,
  sameEntryText,
  scoreRecapVagueness,
  wordsKeptShare,
} from './vault-recap.js';
import type { ConversationOwnerSource } from './vault-owner.js';

/**
 * etiqueta propia, y NO `<LUXY_MEMORY>`: por los mismos dos motivos que
 * `RECAP_OPEN`. El turno tecnico del job-runner prohibe en su `system` escribir
 * un bloque de memoria —pedirselo contradice su propio prompt—, y
 * `parseConversationMemoryResponse` busca el suyo con `lastIndexOf`, asi que una
 * memoria que llevara esa cadena podria secuestrar el parseo del turno vivo.
 */
export const RELINK_OPEN = '<LUXY_RELINK>';
export const RELINK_CLOSE = '</LUXY_RELINK>';

export const MEMORY_RELINK_STATUSES = [
  /** hay que reescribirla y todavia no se ha podido */
  'pending',
  /** al engancharla no habia memoria que reescribir: la siguiente ya nace con la ficha */
  'not-needed',
  /** reescrita y guardada; todavia no la ha usado ningun mensaje */
  'ready',
  /** un mensaje ya la uso: la memoria que selle a partir de ahi sale de ella */
  'applied',
  /** Daniel eligio quedarse con la de antes */
  'discarded',
  /** no salio una reescritura utilizable; sigue valiendo la de antes */
  'failed',
] as const;
export type MemoryRelinkStatus = (typeof MEMORY_RELINK_STATUSES)[number];

/**
 * por que no salio. Cadenas fijas: nunca lo que dijo el modelo.
 *
 * `process` no esta: un proceso que no termina no dice nada del contenido y no
 * se persiste, igual que en la ficha retroactiva; se recuerda en la sesion.
 */
export const MEMORY_RELINK_FAILURES = ['refused', 'invalid', 'vague', 'lossy'] as const;
export type MemoryRelinkFailure = (typeof MEMORY_RELINK_FAILURES)[number];

/**
 * en que acabo una pasada. Cadenas fijas: van al registro y, cuando Daniel la
 * pide con el boton, a la pantalla, que sin esto no podia decir por que no
 * cambio nada (septima ronda).
 */
export const MEMORY_RELINK_OUTCOMES = [
  'ready',
  'refused',
  'invalid',
  'vague',
  'lossy',
  'process',
  'cut',
  'stale',
  'skipped',
  'excluded',
  'busy',
  'locked',
  'no-memory',
] as const;
export type MemoryRelinkOutcome = (typeof MEMORY_RELINK_OUTCOMES)[number];

const turnRefSchema = z
  .object({
    sequence: z.number().int().min(0),
    createdAt: z.string().min(1).max(64),
  })
  .strict();

const relinkDriftSchema = z
  .object({
    kept: z.number().int().min(0),
    rewritten: z.number().int().min(0),
    dropped: z.number().int().min(0),
    added: z.number().int().min(0),
    shortened: z.number().int().min(0),
    /**
     * si el resumen cambio. Opcional porque las filas escritas antes de la
     * septima ronda no lo tienen, y ahi la pantalla no puede decir nada
     */
    summaryChanged: z.boolean().optional(),
  })
  .strict();

/**
 * una fila por conversacion: la del enganche que gana. Estricta, como el
 * evento: un campo que no se conoce no se descarta en silencio.
 */
export const memoryRelinkEntrySchema = z
  .object({
    v: z.literal(1),
    conversationId: z.string().uuid(),
    /** el `winningEventId` del enganche al que pertenece */
    ownerEventId: z.string().uuid(),
    characterId: z.string().min(1).max(128),
    status: z.enum(MEMORY_RELINK_STATUSES),
    /** la memoria sellada de la que sale; `null` si no habia ninguna */
    basedOn: turnRefSchema.nullable(),
    /** la reescrita. Solo en `ready`, `applied` y `discarded` */
    memory: conversationMemorySchema.nullable(),
    drift: relinkDriftSchema.nullable(),
    /** con quien se hizo, o se intento por ultima vez */
    provider: z.enum(LOCAL_CLI_PROVIDERS).nullable(),
    model: z.string().max(128).nullable(),
    failure: z.enum(MEMORY_RELINK_FAILURES).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type MemoryRelinkEntry = z.infer<typeof memoryRelinkEntrySchema>;
export type MemoryRelinkDrift = z.infer<typeof relinkDriftSchema>;

/** la memoria sellada tal y como la identifica su registro, sin su texto */
export interface SealedMemoryRef {
  sequence: number;
  createdAt: string;
}

/** lo que hace falta del dueño: sale de `resolveConversationOwner` */
export interface RelinkOwnerRef {
  source: ConversationOwnerSource;
  characterId: string | null;
  winningEventId: string | null;
}

// ---------------------------------------------------------------------------
// cuando vale
// ---------------------------------------------------------------------------

/**
 * la fila sigue atada a lo que hay AHORA: el mismo enganche, el mismo personaje
 * y la misma ultima memoria sellada, en secuencia Y fecha.
 *
 * La fecha cubre un numero de secuencia reutilizado —un mensaje sin respuesta
 * se retira y su numero vuelve a salir—, igual que `coveredAt` en la ficha
 * retroactiva.
 */
export function relinkBound(
  entry: MemoryRelinkEntry,
  owner: RelinkOwnerRef,
  sealed: SealedMemoryRef | null,
): boolean {
  if (owner.source !== 'link' || owner.winningEventId === null) return false;
  if (entry.ownerEventId !== owner.winningEventId) return false;
  if (entry.characterId !== owner.characterId) return false;
  if (sealed === null || entry.basedOn === null) return false;
  return entry.basedOn.sequence === sealed.sequence && entry.basedOn.createdAt === sealed.createdAt;
}

/** si el turno tiene que usar la reescrita en vez de la sellada */
export function relinkApplies(
  entry: MemoryRelinkEntry | null | undefined,
  owner: RelinkOwnerRef,
  sealed: SealedMemoryRef | null,
): boolean {
  if (entry === null || entry === undefined) return false;
  if (entry.status !== 'ready' && entry.status !== 'applied') return false;
  if (entry.memory === null) return false;
  return relinkBound(entry, owner, sealed);
}

/**
 * la memoria sellada EFECTIVA: la reescrita si esta atada, y si no la sellada.
 *
 * Es lo unico que cambia para quien lee la memoria: se le pasa a
 * `chooseConversationMemory` como `sealed`, con `source: 'turn'`, asi que el
 * prompt sale byte a byte igual que el de una conversacion nacida con esa misma
 * memoria. Lo usan TODOS los lectores —el turno, la sonda, el resumen de sus
 * otras conversaciones (`D-105`) y «Lo que recuerda»—, para que ninguno lea una
 * memoria distinta de la que viaja.
 */
export function effectiveSealedMemory(input: {
  sealed: (SealedMemoryRef & { memory: ConversationMemory }) | null;
  relink: MemoryRelinkEntry | null | undefined;
  owner: RelinkOwnerRef;
}): { memory: ConversationMemory | null; rewritten: boolean } {
  const sealed = input.sealed;
  if (sealed === null) return { memory: null, rewritten: false };
  if (relinkApplies(input.relink, input.owner, sealed) && input.relink?.memory) {
    return { memory: input.relink.memory, rewritten: true };
  }
  return { memory: sealed.memory, rewritten: false };
}

/**
 * en que punto esta la reescritura de una conversacion, contado para decidir y
 * para la pantalla.
 *
 * Las dos lecturas que no se ven en `status`: una `ready` que dejo de estar
 * atada nunca se uso —se sello otra memoria entre medias, a partir de la de
 * antes—, asi que vuelve a estar pendiente; y una `applied` desatada ya cumplio,
 * porque la memoria sellada despues se escribio a partir de ella.
 */
export const MEMORY_RELINK_PHASES = [
  'none',
  'not-needed',
  'pending',
  'ready',
  'in-use',
  'done',
  'discarded',
  'failed',
] as const;
export type MemoryRelinkPhase = (typeof MEMORY_RELINK_PHASES)[number];

export function relinkPhase(
  entry: MemoryRelinkEntry | null | undefined,
  owner: RelinkOwnerRef,
  sealed: SealedMemoryRef | null,
): MemoryRelinkPhase {
  if (owner.source !== 'link' || owner.winningEventId === null || owner.characterId === null) {
    return 'none';
  }
  // sin fila de ESTE enganche: los enganchados antes de que esto existiera, o
  // un alta que fallo al enganchar. Sin memoria no hay nada que reescribir
  if (entry === null || entry === undefined || entry.ownerEventId !== owner.winningEventId) {
    return sealed === null ? 'none' : 'pending';
  }
  switch (entry.status) {
    case 'pending':
      return 'pending';
    case 'not-needed':
      return 'not-needed';
    case 'ready':
      return relinkBound(entry, owner, sealed) ? 'ready' : 'pending';
    case 'applied':
      return relinkBound(entry, owner, sealed) ? 'in-use' : 'done';
    case 'discarded':
      return 'discarded';
    case 'failed':
      return 'failed';
  }
}

/**
 * si hay que llamar al CLI.
 *
 * Una negativa, una respuesta rota, una vaga o una que perdia material
 * pertenecen al CLI que las dio (`D-088`): solo se reintentan con el OTRO, o
 * cuando Daniel lo pide con el boton (`force`). Un proceso que no termino no se
 * persiste; se recuerda en la sesion, y con el mismo CLI no se vuelve a probar
 * hasta reiniciar.
 */
export function relinkNeedsRun(input: {
  phase: MemoryRelinkPhase;
  entry: MemoryRelinkEntry | null | undefined;
  provider: (typeof LOCAL_CLI_PROVIDERS)[number];
  force: boolean;
  /** el CLI con el que fallo el proceso en esta sesion, si fallo */
  failedThisSession: (typeof LOCAL_CLI_PROVIDERS)[number] | null;
}): boolean {
  switch (input.phase) {
    case 'pending':
      return input.force || input.failedThisSession !== input.provider;
    case 'failed':
      if (input.force) return true;
      return (
        input.entry !== null &&
        input.entry !== undefined &&
        input.entry.provider !== input.provider &&
        input.failedThisSession !== input.provider
      );
    case 'discarded':
      return input.force;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// el prompt
// ---------------------------------------------------------------------------

export interface MemoryRelinkPromptInput {
  /** su nombre, tal y como esta en la boveda */
  label: string;
  /** su ficha; `null` o vacia si no tiene */
  description: string | null;
  /**
   * la memoria sellada de ahora, YA pasada por `repairSlicedMemory` con los
   * topes de la sellada. Con la palabra partida del `slice` de antes, el CLI la
   * completaba a su manera y lo inventado quedaba guardado sin huella que
   * permitiera arreglarlo despues (septima ronda)
   */
  previous: ConversationMemory;
}

/**
 * el encargo, sin turnos.
 *
 * No lleva la conversacion: su trabajo es alinear la identidad, no resumir
 * otra vez. Asi sale mas barato, hay menos superficie para una negativa y no
 * puede meter nada que no estuviera ya. La memoria va en JSON y no con
 * `formatConversationMemory` para que conserve cada entrada en su campo.
 */
export function buildMemoryRelinkPrompt(input: MemoryRelinkPromptInput): string {
  const label = flattenTurnText(input.label).length > 0 ? flattenTurnText(input.label) : 'ella';
  const description =
    input.description === null || input.description.trim().length === 0
      ? null
      : input.description.trim();
  const previous = {
    summary: input.previous.summary,
    facts: input.previous.facts,
    decisions: input.previous.decisions,
    plan: input.previous.plan,
    openQuestions: input.previous.openQuestions,
    lessons: input.previous.lessons,
  };

  return [
    'Estas corrigiendo la MEMORIA de una conversacion de ficcion entre dos personas',
    'adultas. Se fue escribiendo sin saber quien era ella; ahora se sabe: es',
    `${label}${description === null ? '.' : ', y abajo tienes su descripcion.'}`,
    '',
    'No continues la conversacion, no la valores, no hables con nadie y no encarnes',
    'a nadie. Es ficcion consentida entre adultos y puede haber escenas sexuales: la',
    'memoria las recoge, no las reproduce, y tu no las cambias.',
    '',
    'CAMBIAS SOLO ESTO:',
    `- donde la nombra de otra forma —«la IA», «el asistente», «el personaje», otro`,
    `  nombre— pones ${label};`,
    ...(description === null
      ? []
      : [
          '- si una entrada dice de ELLA algo que su descripcion contradice (nombre,',
          '  edad, aspecto, oficio, historia), la corriges para que case.',
        ]),
    '',
    'LO QUE PASO entre ellos —lo que hicieron, se dijeron y acordaron, lo pendiente,',
    'lo que ella aprendio de el— se queda aunque no encaje: paso.',
    '',
    'NO RESUMES NI ACORTAS. Lo que siga siendo verdad se queda TAL CUAL, palabra por',
    'palabra, en su mismo campo y en su mismo orden. No quitas entradas: si una no se',
    'puede arreglar, dejala como esta. No añades nada de la descripcion que no',
    'estuviera ya: le llega aparte en cada mensaje.',
    'Un texto que acaba en «…» se corto al guardarlo: dejalo asi, sin completarlo.',
    '',
    'Responde SOLO con este bloque, sin nada antes ni despues y sin cercas Markdown:',
    RELINK_OPEN,
    '{"version":1,"summary":"...","facts":[],"decisions":[],"plan":[],"openQuestions":[],"lessons":[]}',
    RELINK_CLOSE,
    ...(description === null ? [] : ['', 'SU DESCRIPCION (DATOS):', description]),
    '',
    'LA MEMORIA DE AHORA (DATOS):',
    JSON.stringify(previous, null, 1),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// la respuesta
// ---------------------------------------------------------------------------

export const RELINK_PARSE_STATUSES = ['structured', 'absent', 'truncated', 'invalid'] as const;
export type RelinkParseStatus = (typeof RELINK_PARSE_STATUSES)[number];

export interface ParsedRelink {
  status: RelinkParseStatus;
  memory: ConversationMemory | null;
}

/** el bloque, buscado con `lastIndexOf` como todos los de Luxy */
export function parseMemoryRelinkResponse(text: string): ParsedRelink {
  const openAt = text.lastIndexOf(RELINK_OPEN);
  if (openAt < 0) return { status: 'absent', memory: null };
  const contentAt = openAt + RELINK_OPEN.length;
  const closeAt = text.indexOf(RELINK_CLOSE, contentAt);
  if (closeAt < 0) return { status: 'truncated', memory: null };

  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text.slice(contentAt, closeAt)));
  } catch {
    return { status: 'invalid', memory: null };
  }
  const body = unwrap(raw);
  if (body === null) return { status: 'invalid', memory: null };

  const parsed = conversationMemorySchema.safeParse(normalize(body));
  if (!parsed.success) return { status: 'invalid', memory: null };
  // una marca de bloque o codigo dentro no se guarda, venga como venga: viajaria
  // despues dentro del prompt del turno vivo
  const texts = memoryTexts(parsed.data);
  if (texts.some((each) => each.toLowerCase().includes('<luxy_'))) {
    return { status: 'invalid', memory: null };
  }
  if (texts.some((each) => looksLikeCode(each))) return { status: 'invalid', memory: null };
  return { status: 'structured', memory: parsed.data };
}

/**
 * lo que el modelo escribio FUERA del bloque: lo unico que se le puede pasar al
 * clasificador de negativas. Dentro va una memoria que puede hablar de la escena.
 */
export function textOutsideRelinkBlock(text: string): string {
  const openAt = text.lastIndexOf(RELINK_OPEN);
  return openAt < 0 ? text : text.slice(0, openAt);
}

function memoryTexts(memory: ConversationMemory): string[] {
  return [
    memory.summary,
    ...memory.facts,
    ...memory.decisions,
    ...memory.plan,
    ...memory.openQuestions,
    ...memory.lessons,
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if ('summary' in raw) return raw;
  for (const value of Object.values(raw)) {
    if (isRecord(value) && 'summary' in value) return value;
  }
  return null;
}

function stripFence(block: string): string {
  const trimmed = block.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```$/, '')
    .trim();
}

/**
 * a los topes de la memoria SELLADA (1.200 y 240, doce por lista), no a los de
 * la ficha retroactiva: recortar a 400/160 perderia material que la sellada si
 * admite. Lo que se pase se corta en palabra, y la guarda de abajo lo ve.
 */
function normalize(body: Record<string, unknown>): unknown {
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => clipAtWord(flattenTurnText(item), CONVERSATION_MEMORY_ENTRY_CHARS))
          .slice(0, 12)
      : [];
  return {
    version: 1,
    summary:
      typeof body.summary === 'string'
        ? clipAtWord(flattenTurnText(body.summary), CONVERSATION_MEMORY_SUMMARY_CHARS)
        : '',
    facts: list(body.facts),
    decisions: list(body.decisions),
    plan: list(body.plan),
    openQuestions: list(body.openQuestions),
    lessons: list(body.lessons),
  };
}

// ---------------------------------------------------------------------------
// la guarda contra perder material
// ---------------------------------------------------------------------------

/**
 * cuanto puede perder una reescritura antes de no aplicarse.
 *
 * Son CRITERIOS, no medidas: nadie ha visto todavia una reescritura real. Se
 * eligen para que corregir nombres pase —«el personaje femenino» por «Lia»
 * quita treinta caracteres— y un resumen rehecho en corto no.
 */
export const RELINK_LIMITS = {
  /** entradas quitadas mas entradas recortadas a menos de la mitad */
  maxLostEntries: 2,
  /**
   * ...y nunca mas de la mitad de las que habia. Sin esto, una memoria corta
   * —la de una conversacion enganchada al poco de empezar, con dos hechos— se
   * quedaba sin ninguno dentro de las «dos permitidas» (septima ronda)
   */
  maxLostShare: 0.5,
  /** el resumen puede quedarse en el 80 %... */
  minSummaryRatio: 0.8,
  /** ...o perder hasta 60 caracteres, lo que deje mas */
  summarySlackChars: 60,
  /** lo mismo para el total de las entradas de las cinco listas */
  minEntriesRatio: 0.8,
  entriesSlackChars: 120,
  /**
   * y ni el resumen ni las entradas pueden bajar de la mitad, holgura o no. Las
   * holguras son para cambiar «el personaje femenino» por un nombre corto; en
   * una memoria de cincuenta caracteres dejaban llevarla a cuatro
   */
  hardMinRatio: 0.5,
  /**
   * del resumen, la mitad de sus palabras tiene que seguir. Medir solo el largo
   * dejaba pasar un resumen que cuenta otra cosa con el mismo tamaño. Solo se
   * mira con al menos `summaryWordsFloor` palabras: en uno de tres, cambiar un
   * nombre ya es un tercio
   */
  minSummaryWordsKept: 0.5,
  summaryWordsFloor: 4,
} as const;

export interface RelinkSizes {
  summaryBefore: number;
  summaryAfter: number;
  entriesBefore: number;
  entriesAfter: number;
}

export type RelinkDecision =
  | { status: 'ready'; memory: ConversationMemory; drift: MemoryRelinkDrift; sizes: RelinkSizes }
  | {
      status: 'failed';
      failure: MemoryRelinkFailure;
      drift: MemoryRelinkDrift | null;
      sizes: RelinkSizes | null;
    };

function entriesChars(memory: ConversationMemory): number {
  return memoryTexts(memory)
    .slice(1)
    .reduce((total, each) => total + each.length, 0);
}

function shrankTooMuch(before: number, after: number, ratio: number, slack: number): boolean {
  if (after >= before) return false;
  if (after < before * RELINK_LIMITS.hardMinRatio) return true;
  return after < before * ratio && before - after > slack;
}

function entryCount(memory: ConversationMemory): number {
  return memoryTexts(memory).length - 1;
}

/**
 * si la reescritura se aplica sola o se queda la de antes.
 *
 * Se aplica SOLA, sin aprobacion como la ficha retroactiva (`D-101`), porque el
 * criterio de Daniel es que no haya diferencia con una nacida, y una nacida no
 * pide aprobar su memoria. Lo que la hace segura es esto: el `.jsonl` no se
 * toca, vuelve a valer la sellada en cuanto algo cambia, se puede volver a la de
 * antes hasta el siguiente mensaje y, sobre todo, lo que PIERDE material no se
 * aplica. No hay estado «a revisar»: uno que caducara con el siguiente mensaje
 * se quedaba sin salida (refutacion de `D-108`).
 *
 * `refused` lo decide quien llama con `classifyReply` sobre el texto de fuera
 * del bloque, y solo importa cuando no hay bloque que valga: una memoria que
 * habla de la escena no es una negativa.
 */
export function decideRelink(input: {
  previous: ConversationMemory;
  parsed: ParsedRelink;
  refused: boolean;
}): RelinkDecision {
  const { previous, parsed } = input;
  if (parsed.status !== 'structured' || parsed.memory === null) {
    return { status: 'failed', failure: input.refused ? 'refused' : 'invalid', drift: null, sizes: null };
  }
  const next = parsed.memory;
  const summaryKept = wordsKeptShare(previous.summary, next.summary);
  const drift: MemoryRelinkDrift = {
    ...compareMemoryEntries(previous, next),
    // la pantalla lo necesita: las cifras de entradas no dicen nada del resumen
    summaryChanged: !sameEntryText(previous.summary, next.summary),
  };
  const sizes: RelinkSizes = {
    summaryBefore: previous.summary.length,
    summaryAfter: next.summary.length,
    entriesBefore: entriesChars(previous),
    entriesAfter: entriesChars(next),
  };

  // vaga solo si la de antes no lo era: una memoria corta de por si no puede
  // dejar de reescribirse por serlo
  if (scoreRecapVagueness(next).vague && !scoreRecapVagueness(previous).vague) {
    return { status: 'failed', failure: 'vague', drift, sizes };
  }

  const lost = drift.dropped + drift.shortened;
  const before = entryCount(previous);
  if (
    lost > RELINK_LIMITS.maxLostEntries ||
    (lost > 0 && lost > before * RELINK_LIMITS.maxLostShare) ||
    (countedWords(previous.summary) >= RELINK_LIMITS.summaryWordsFloor &&
      summaryKept < RELINK_LIMITS.minSummaryWordsKept) ||
    shrankTooMuch(
      sizes.summaryBefore,
      sizes.summaryAfter,
      RELINK_LIMITS.minSummaryRatio,
      RELINK_LIMITS.summarySlackChars,
    ) ||
    shrankTooMuch(
      sizes.entriesBefore,
      sizes.entriesAfter,
      RELINK_LIMITS.minEntriesRatio,
      RELINK_LIMITS.entriesSlackChars,
    )
  ) {
    return { status: 'failed', failure: 'lossy', drift, sizes };
  }

  return { status: 'ready', memory: next, drift, sizes };
}
