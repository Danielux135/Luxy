// la memoria acumulativa que se genera HACIA ATRAS, para las conversaciones que
// nunca la tuvieron.
//
// Por que existe: durante meses el bloque de memoria del turno privado no se
// escribio, y diecisiete conversaciones se quedaron sin ninguna. Esto la fabrica
// por ventanas con un CLI local —Claude o Codex, nunca una API de pago— y la
// deja en un almacen aparte, porque el `.jsonl` sellado NO SE TOCA: una memoria
// mal escrita dentro de un registro apaga la pestaña Privado entera.
//
// Modulo PURO: arma un prompt, valida una respuesta y decide que memoria se usa.
// No llama a nadie, no lee disco y no sabe cifrar.
//
// Dos reglas que se rompen solas si no se dicen:
//
// 1. Aqui NO se conserva nunca un extracto de lo que dijo el modelo. Al catalogo
//    se le pide un indice, asi que lo que diga en su lugar es una negativa
//    generica; aqui se le ha pedido DESCRIBIR LA ESCENA, asi que lo que diga en
//    su lugar puede citarla. Los motivos son cadenas fijas escritas aqui, y esa
//    es la unica informacion que sale: la clasificacion, que es justo lo que
//    hace falta para saber que boton pulsar.
// 2. Lo que se declara no cubierto se declara. Un hueco que se traga en silencio
//    marca como leido lo que nadie vio, y esa es la unica forma de que este
//    trabajo empeore las cosas en vez de mejorarlas.
import { z } from 'zod';
import {
  conversationMemorySchema,
  formatConversationMemory,
  looksLikeCode,
  type ConversationMemory,
} from './schemas.js';
import {
  CATALOG_CUT_MARK,
  CATALOG_PROMPT_CHARS,
  clipMiddle,
  detectEvenSplit,
  flattenTurnText,
  turnAllowance,
  type CatalogedScene,
} from './vault-catalog.js';
import { civilDayLabel, type TemporalAnchor } from './temporal-reference.js';
import { LOCAL_CLI_PROVIDERS } from './constants.js';
import { VAULT_RECENT_TURNS } from './vault-prompt.js';
import type { LocalCliProvider } from './auxiliary-target.js';

export const RECAP_VERSION = 1;

/**
 * etiqueta propia, y NO `<LUXY_MEMORY>`.
 *
 * Dos motivos, los dos comprobados en codigo: la rama tecnica del job-runner
 * prohibe expresamente escribir bloques de memoria —pedirlo contradice su
 * propio system prompt—, y `parseConversationMemoryResponse` localiza el suyo
 * con `lastIndexOf`, asi que un recap que contuviera esa cadena podria
 * secuestrar el parseo del turno vivo siguiente.
 */
export const RECAP_OPEN = '<LUXY_RECAP>';
export const RECAP_CLOSE = '</LUXY_RECAP>';

/** parte nueva por llamada */
export const RECAP_WINDOW_TURNS = 40;

/** contexto ya revisado que se enseña marcado, solo para enganchar */
export const RECAP_CONTEXT_TURNS = 3;

/**
 * cuanto se le enseña de cada turno.
 *
 * NO se hereda el tope del catalogo. Al catalogo le sobra con ver como empieza y
 * como acaba cada turno, porque una escena se abre y se cierra en los extremos;
 * a quien tiene que resumir lo que paso no: lo que `clipMiddle` quita es un
 * agujero del que no se puede resumir nada mientras el cursor avanza igual, es
 * decir, un turno dado por leido sin leerse. Es el mismo error que ya se cometio
 * con el extractor de promesas (`D-088`, caso 1) y se arreglo asi.
 *
 * Al valer lo mismo que el presupuesto global, el tope por turno nunca recorta
 * por debajo del reparto.
 */
export const RECAP_TURN_CHARS = CATALOG_PROMPT_CHARS;

/**
 * cuanto de la cola de la ventana vale la pena mirar buscando un corte de escena.
 *
 * Cortar donde ya corto el catalogo evita entregar media escena, y esos cortes
 * ya existen y ya estan pagados. Mas atras de doce turnos el ahorro deja de
 * compensar la ventana que se tira.
 */
export const RECAP_SCENE_TAIL = 12;

/**
 * los topes del RELLENO, mas estrictos que los del esquema a proposito.
 *
 * `conversationMemorySchema` admite ~15.900 caracteres, mas que el prompt
 * privado entero (~14.000 medidos en `D-058`), y lo que produce un turno real
 * son 342 y 382. Cada caracter de aqui se paga en TODOS los turnos futuros de
 * ese hilo y se reescribe en cada respuesta. Se recorta, no se rechaza: esa es
 * la leccion de LUX-8B8T.
 */
export const RECAP_SUMMARY_CHARS = 400;
export const RECAP_ENTRY_CHARS = 160;
export const RECAP_LIST_MAX = 6;

/**
 * tope duro del bloque ya renderizado.
 *
 * 1.800 c ≈ 515 tokens ≈ 13 % del prompt medido. Nada mas abajo recorta el
 * prompt: `measureVaultPrompt` solo mide.
 */
export const RECAP_BLOCK_CHARS = 1800;

/**
 * ventanas negadas seguidas antes de dejar esa conversacion para otra pasada.
 *
 * Una ventana negada no bloquea la conversacion: se salta, su tramo se declara
 * como hueco y se sigue, porque lo que sirve para retomar es la COLA. Pero un
 * hilo explicito de punta a punta tiene que costar dos llamadas y no ocho.
 */
export const RECAP_MAX_REFUSED_WINDOWS = 2;

/**
 * el ancla contra la evaporacion del principio.
 *
 * La primera ventana emite su primera entrada de `facts` con este prefijo; se
 * reinyecta en todas las siguientes y se vuelve a añadir si el modelo la perdio.
 * Es seguro re-añadirla porque esta en pasado: una escena posterior puede
 * mudarlos de sitio, no puede desmentir como empezo.
 */
export const RECAP_ANCHOR_PREFIX = 'Empezo: ';

// ---------------------------------------------------------------------------
// esquemas
// ---------------------------------------------------------------------------

const iso = z.string().datetime();

/**
 * por que el modelo dejo un tramo fuera. ENUM CERRADO, nunca texto libre.
 *
 * Un motivo escrito a mano vuelve describiendo justo lo que el modelo se nego a
 * describir, y eso acabaria en disco y quiza en una pantalla.
 */
export const RECAP_GAP_REASONS = ['explicito', 'confuso', 'otro'] as const;
export type RecapGapReason = (typeof RECAP_GAP_REASONS)[number];
export const recapGapWhySchema = z.enum(RECAP_GAP_REASONS);

export const recapGapSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  why: recapGapWhySchema,
});
export type RecapGap = z.infer<typeof recapGapSchema>;

/** de donde salio la ficha: un CLI la escribio, o se dedujo del catalogo */
export const RECAP_SOURCES = ['cli', 'index'] as const;
export type RecapSource = (typeof RECAP_SOURCES)[number];

/**
 * los cinco finales de una ventana, separados porque el arreglo de cada uno es
 * distinto. Mezclarlos es el defecto que ya tiene la pasada de pendientes.
 */
export const RECAP_REFUSAL_KINDS = ['refused', 'absent', 'truncated', 'invalid', 'vague'] as const;
export type RecapRefusalKind = (typeof RECAP_REFUSAL_KINDS)[number];

export const recapEntrySchema = z.object({
  conversationId: z.string().uuid(),
  /** null cuando lo unico que hay de esta conversacion es una negativa */
  memory: conversationMemorySchema.nullable(),
  source: z.enum(RECAP_SOURCES),
  covered: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }),
  /** createdAt del turno `covered.to`: detecta numero de secuencia reutilizado */
  coveredAt: iso.nullable(),
  gaps: z.array(recapGapSchema).max(20).default([]),
  turnsAtRecap: z.number().int().min(0),
  version: z.number().int().min(1),
  provider: z.enum(LOCAL_CLI_PROVIDERS).nullable(),
  model: z.string().max(128).nullable(),
  at: iso,
  /** caracteres del bloque ya renderizado: es lo que se paga en cada turno */
  chars: z.number().int().min(0),
  /** hasta que Daniel no aprueba, no entra en ningun prompt */
  approved: z.boolean().default(false),
  refusedKind: z.enum(RECAP_REFUSAL_KINDS).nullable().default(null),
  refusedAtTurns: z.number().int().min(0).nullable().default(null),
  refusedProvider: z.enum(LOCAL_CLI_PROVIDERS).nullable().default(null),
  /** cuando la conversacion pasa a tener memoria sellada viva */
  supersededAt: iso.nullable().default(null),
});
export type RecapEntry = z.infer<typeof recapEntrySchema>;

export const recapCountersSchema = z.object({
  windows: z.number().int().min(0).default(0),
  ok: z.number().int().min(0).default(0),
  partial: z.number().int().min(0).default(0),
  deduced: z.number().int().min(0).default(0),
  refused: z.number().int().min(0).default(0),
  vague: z.number().int().min(0).default(0),
  invalid: z.number().int().min(0).default(0),
  failed: z.number().int().min(0).default(0),
  clipped: z.number().int().min(0).default(0),
  kept: z.number().int().min(0).default(0),
  rewritten: z.number().int().min(0).default(0),
  dropped: z.number().int().min(0).default(0),
  /**
   * entradas que la ventana APORTO.
   *
   * Sin esto, una ventana encadenada que devuelve las seis viejas intactas y no
   * cabe ni una nueva sale con el marcador perfecto —`kept` lleno, `dropped` a
   * cero— siendo esteril. `kept` solo sabe medir lo que se pierde de lo viejo.
   */
  added: z.number().int().min(0).default(0),
});
export type RecapCounters = z.infer<typeof recapCountersSchema>;

// ---------------------------------------------------------------------------
// el prompt
// ---------------------------------------------------------------------------

/** un turno, tal y como se le enseña al resumidor */
export interface RecapPromptTurn {
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
}

/** un turno con todo lo que hace falta para trocear y para fechar el cursor */
export interface RecapTurn extends RecapPromptTurn {
  createdAt: string;
}

export interface RecapPromptInput {
  /** turnos ya revisados que se enseñan marcados, solo para entender el arranque */
  context: readonly RecapPromptTurn[];
  /** la PARTE NUEVA: lo unico que esta ventana tiene que resumir */
  turns: readonly RecapPromptTurn[];
  /** la ficha de la ventana anterior; `null` en la primera */
  previous: ConversationMemory | null;
  /** la entrada «Empezo: …» de la primera ventana, si ya existe */
  anchor: string | null;
  /**
   * esta ventana empieza en el PRIMER turno de la conversacion.
   *
   * Va aparte de `previous` a proposito. No son lo mismo: tras una ventana
   * negada la ficha sigue en `null` y la siguiente empieza por la mitad, asi que
   * usar «no hay ficha previa» como si fuera «esto es el principio» le pide al
   * modelo que cuente como arranco algo que no ha visto. Y lo que escriba ahi se
   * convierte en el ancla que se reinyecta en todas las ventanas siguientes y
   * que ella lee como primer Hecho para siempre.
   */
  startsAtFirstTurn: boolean;
}

/**
 * su tope por turno: ver `RECAP_TURN_CHARS`. Va aparte y exportada para que
 * quien manda la ventana pueda contar cuantos turnos se han quedado a medias sin
 * volver a armar el prompt.
 */
export function recapTurnAllowance(lengths: readonly number[]): number {
  return turnAllowance(lengths, RECAP_TURN_CHARS);
}

/**
 * cuantos turnos de la PARTE NUEVA no caben enteros.
 *
 * El contexto entra en el reparto —ocupa sitio— pero no en la cuenta: ya se
 * reviso y de ahi no se resume nada. Con las conversaciones reales tiene que
 * salir 0; si sube, hay ventanas cuyo centro nadie ha mirado.
 */
export function countClippedRecapTurns(input: {
  context: readonly { text: string }[];
  turns: readonly { text: string }[];
}): number {
  const context = input.context.map((turn) => flattenTurnText(turn.text).length);
  const fresh = input.turns.map((turn) => flattenTurnText(turn.text).length);
  const allowance = recapTurnAllowance([...context, ...fresh]);
  return fresh.filter((length) => length > allowance).length;
}

/**
 * el prompt del resumidor.
 *
 * NO va en personaje, igual que el del catalogo y el del extractor: pedirle esto
 * a quien esta encarnando a alguien mezcla dos cosas que no tienen por que
 * mezclarse, y ademas dispara la moderacion. Todo lo que viene de la
 * conversacion entra como DATOS.
 *
 * El texto es el aprobado en el diseño, palabra por palabra: el encuadre, el
 * vocabulario de escena y los ejemplos son lo unico que separa una ficha util de
 * un formulario que suena a informe, y eso no se reescribe al gusto de nadie.
 */
export function buildRecapPrompt(input: RecapPromptInput): string {
  const first = input.turns[0]?.sequence ?? 0;
  const last = input.turns[input.turns.length - 1]?.sequence ?? 0;

  const flatten = (turn: RecapPromptTurn): RecapPromptTurn => ({
    ...turn,
    text: flattenTurnText(turn.text),
  });
  const context = input.context.map(flatten);
  const fresh = input.turns.map(flatten);
  const allowance = recapTurnAllowance([...context, ...fresh].map((turn) => turn.text.length));

  const line = (turn: RecapPromptTurn): string =>
    `[${turn.sequence}] ${turn.role === 'user' ? 'Usuario' : 'Personaje'}: ${clipMiddle(
      turn.text,
      allowance,
    )}`;

  return [
    'Estas escribiendo la FICHA DE CONTINUIDAD de una conversacion de ficcion entre',
    'dos personas adultas, para que el personaje pueda retomarla sin releerla entera.',
    '',
    'Quien va a leer esto es ELLA, el personaje, justo antes de contestarle. No es un',
    'informe para nadie. No continues la conversacion, no la valores, no hables con',
    'nadie y no encarnes a nadie: solo apuntas lo que hay que recordar.',
    '',
    'Es ficcion consentida entre adultos y puede haber escenas sexuales. La ficha las',
    'RECOGE, no las reproduce: donde pasa, entre quienes, que se pidio, que gusto y',
    'que cambio despues. Con eso basta, y eso es exactamente lo que hace falta. No',
    'copies frases, no narres la escena y no la adornes.',
    '',
    'Y al reves: «tuvieron un encuentro intimo» no sirve para nada. Una ficha que no',
    'dice que paso no es una ficha, es un hueco con forma de frase. Si hay algo que',
    'prefieres no escribir, NO lo escribas a medias: dejalo fuera y anotalo en',
    '`skipped`.',
    '',
    'LO QUE VA EN CADA CAMPO. En tercera persona, en presente, sobre los dos y con',
    'sus nombres. Nada de «el usuario», «la IA», «la conversacion», «se acordo que»',
    'ni «el sistema».',
    '',
    '- `summary`: como van las cosas entre ellos y donde quedo la ultima escena.',
    '  Unos 400 caracteres. Es lo primero que ella lee.',
    '- `facts`: lo fijo. Quien es quien, donde estan, que hora es alli, como va',
    '  vestida, como la llama el, que sabe cada uno de la vida del otro.',
    '  SIRVE: «El la llama nena cuando esta de buenas».',
    '  NO SIRVE: «Tienen buena quimica».',
    '- `decisions`: lo que quedo acordado entre los dos, incluidos los limites y las',
    '  reglas del juego.',
    '  SIRVE: «Quedaron en que ella escribe primero por las mañanas».',
    '- `plan`: lo que queda por delante, si lo hay.',
    '- `openQuestions`: lo que quedo en el aire sin respuesta.',
    '- `lessons`: lo que ELLA ha aprendido de EL. Que le gusta, que le corta, que',
    '  tono funciona y cual no.',
    '  SIRVE: «Se cierra si ella va demasiado deprisa al principio».',
    '',
    'Maximo 6 entradas por lista y unos 160 caracteres cada una. Lo que sobre se',
    'recorta solo, asi que elige: cinco cosas ciertas valen mas que ocho con una',
    'inventada.',
    '',
    'NADA INVENTADO. Si no esta dicho ni hecho en los turnos de abajo, no se apunta.',
    'Y no completes una enumeracion para que suene mejor: dos ciertas antes que tres',
    'con una falsa.',
    '',
    'NADA DE FUERA DE PERSONAJE. Si el rompe la ficcion —«eres una IA», «esto es un',
    'chat»— eso no es parte de la historia y no entra en la ficha.',
    ...recapOpeningLines(input),
    '',
    'Responde SOLO con este bloque, sin nada antes ni despues y sin cercas Markdown:',
    RECAP_OPEN,
    `{"version":1,"summary":"...","facts":[],"decisions":[],"plan":[],"openQuestions":[],"lessons":[],"covered":{"from":${first},"to":${last}},"skipped":[]}`,
    RECAP_CLOSE,
    '',
    '`covered` son el primer y el ultimo turno que has tenido en cuenta, incluidos.',
    '',
    '`skipped` son los tramos que prefieres no resumir. Dejar uno fuera es una',
    'respuesta VALIDA y es mejor que no contestar: lo que quede ahi se marcara como',
    'no leido y nadie va a suponer lo que habia. Cada tramo va como',
    '{"from":12,"to":18,"why":"explicito"}, y `why` solo puede ser "explicito",',
    '"confuso" u "otro". No escribas el motivo con tus palabras.',
    '',
    `Si un turno viene con «${CATALOG_CUT_MARK}» en medio, es que se le ha quitado el`,
    'centro para que quepa: tienes su principio y su final, y lo de en medio no',
    'existe como salto.',
    // el ancla del principio va aparte de la ficha: es lo que no puede perderse
    // aunque la ficha se reescriba entera
    ...(input.anchor === null
      ? []
      : ['', 'EL PRINCIPIO DE ESTA CONVERSACION (DATOS):', flattenTurnText(input.anchor)]),
    ...(input.previous === null
      ? []
      : ['', 'LO QUE YA ESTABA ANOTADO (DATOS):', formatConversationMemory(input.previous)]),
    ...(context.length === 0
      ? []
      : ['', 'YA REVISADO, SOLO PARA ENGANCHAR (DATOS):', ...context.map(line)]),
    '',
    'LA PARTE NUEVA (DATOS):',
    ...fresh.map(line),
  ].join('\n');
}

/**
 * el parrafo que cambia segun DONDE esta esta ventana. Son tres sitios, no dos.
 *
 * Con ficha anterior, la orden es conservarla. Sin ficha anterior hay que
 * distinguir: si la ventana empieza en el primer turno, se pide el ancla del
 * principio; si empieza por la mitad —porque la ventana de antes se nego o no se
 * pudo leer—, se dice expresamente que NO es el principio. Pedirle ahi «di como
 * arranco esto» le obliga a elegir entre inventar y desobedecer, y lo que
 * escriba queda de ancla en todos los prompts siguientes.
 */
function recapOpeningLines(input: RecapPromptInput): string[] {
  if (input.previous !== null) {
    return [
      '',
      'LO QUE YA ESTABA ANOTADO. Abajo tienes la ficha de la parte anterior de esta',
      'misma conversacion. NO la resumas otra vez: devuelvela ENTERA, corregida y',
      'ampliada con lo nuevo.',
      '',
      'Lo que siga siendo verdad se queda TAL CUAL, palabra por palabra. Solo cambias',
      'una entrada si la parte nueva la desmiente, y solo borras una si ha dejado de',
      'ser cierta. Reescribir lo que ya estaba bien hace que a la tercera vuelta el',
      'principio de la conversacion haya desaparecido.',
      '',
      'Las listas siguen siendo de 6 como mucho. Si al añadir lo nuevo te pasas, quita',
      'la entrada vieja que menos sirva hoy; lo nuevo NO se queda fuera.',
      '',
      'La entrada de `facts` que empieza por «Empezo:» va SIEMPRE, tal cual.',
    ];
  }

  if (input.startsAtFirstTurn) {
    return [
      '',
      'Esta es la PRIMERA parte de la conversacion. La primera entrada de `facts` tiene',
      'que empezar por «Empezo: » y decir como arranco esto y que son el uno del otro.',
      'Se conservara tal cual en las fichas siguientes.',
    ];
  }

  return [
    '',
    'Esto NO es el principio de la conversacion, y de la parte anterior no ha quedado',
    'ficha. Apunta solo lo que se ve en los turnos de abajo. Como empezo esto no lo',
    'sabes: no lo cuentes, no lo supongas y no abras `facts` con «Empezo: ».',
  ];
}

// ---------------------------------------------------------------------------
// lo que devuelve el resumidor
// ---------------------------------------------------------------------------

/**
 * los cuatro finales del bloque.
 *
 * `truncated` y no `truncated_block` como el catalogo: es el mismo nombre que
 * usa `refusedKind` en la entrada, y traducirlo de un sitio a otro es una
 * ocasion mas de equivocarse.
 */
export const RECAP_STATUSES = ['structured', 'absent', 'truncated', 'invalid'] as const;
export type RecapStatus = (typeof RECAP_STATUSES)[number];

/** un tramo saltado tal y como vino: el `why` se valida en `verifyRecap` */
export interface RawRecapGap {
  from: number;
  to: number;
  why: string;
}

export interface RecapReply {
  memory: ConversationMemory;
  covered: { from: number; to: number };
  skipped: RawRecapGap[];
}

export interface ParsedRecap {
  status: RecapStatus;
  reply: RecapReply | null;
  /** por que se rechazo. Cadena FIJA: nunca lleva nada de la boveda */
  reason: string | null;
}

const nothingParsed = (status: RecapStatus, reason: string | null): ParsedRecap => ({
  status,
  reply: null,
  reason,
});

/**
 * lee la respuesta del resumidor.
 *
 * Tolerante con lo cosmetico —recorta lo que se pasa de largo en vez de tirar la
 * ficha entera— y duro con lo que puede perder material en silencio: un tramo
 * saltado que no se entiende invalida la respuesta, porque darlo por bueno
 * marcaria como resumido lo que el modelo dijo que no resumia.
 */
export function parseRecapResponse(
  text: string,
  expected: { from: number; to: number },
): ParsedRecap {
  const openAt = text.lastIndexOf(RECAP_OPEN);
  if (openAt < 0) return nothingParsed('absent', null);

  const contentAt = openAt + RECAP_OPEN.length;
  const closeAt = text.indexOf(RECAP_CLOSE, contentAt);
  if (closeAt < 0) return nothingParsed('truncated', null);

  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text.slice(contentAt, closeAt)));
  } catch {
    return nothingParsed('invalid', 'el bloque no es JSON');
  }

  const body = unwrapRecap(raw);
  if (body === null) return nothingParsed('invalid', 'el bloque no trae la ficha');

  const parsed = conversationMemorySchema.safeParse(normalizeRecapMemory(body));
  if (!parsed.success) {
    const donde = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`)
      .join(', ');
    return nothingParsed('invalid', `la ficha no encaja (${donde})`);
  }

  const skipped = readGaps(body.skipped);
  if (skipped === null) {
    return nothingParsed('invalid', 'los tramos saltados no tienen la forma pedida');
  }

  const covered = readRange(body.covered);
  if (covered === null) {
    // sin tramos saltados, un `covered` ausente no pierde nada: la ventana es la
    // que se le enseño. Con tramos saltados si, porque no habria donde colocarlos
    if (skipped.length > 0) {
      return nothingParsed('invalid', 'dice saltarse tramos pero no dice que ha cubierto');
    }
    return {
      status: 'structured',
      reply: { memory: parsed.data, covered: expected, skipped },
      reason: null,
    };
  }

  return { status: 'structured', reply: { memory: parsed.data, covered, skipped }, reason: null };
}

/** ajusta a los limites del ESQUEMA para que valide; el recorte del relleno va aparte */
function normalizeRecapMemory(body: Record<string, unknown>): unknown {
  const lista = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => flattenTurnText(item).slice(0, 240))
          .slice(0, 12)
      : [];

  return {
    version: 1,
    summary: typeof body.summary === 'string' ? flattenTurnText(body.summary).slice(0, 1200) : '',
    facts: lista(body.facts),
    decisions: lista(body.decisions),
    plan: lista(body.plan),
    openQuestions: lista(body.openQuestions),
    lessons: lista(body.lessons),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** el modelo a veces devuelve `{"ficha": {...}}` en vez del objeto pelado */
function unwrapRecap(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if ('summary' in raw) return raw;
  for (const value of Object.values(raw)) {
    if (isRecord(value) && 'summary' in value) return value;
  }
  return null;
}

function readRange(value: unknown): { from: number; to: number } | null {
  if (!isRecord(value)) return null;
  const from = value.from;
  const to = value.to;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) return null;
  if (typeof to !== 'number' || !Number.isInteger(to) || to < 0) return null;
  return { from, to };
}

/**
 * los tramos saltados, sin validar el motivo todavia.
 *
 * `null` significa «esto no se puede leer», y quien llama lo convierte en un
 * rechazo entero: un tramo que se tira de uno en uno es material que se da por
 * resumido sin estarlo.
 */
function readGaps(value: unknown): RawRecapGap[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > 20) return null;

  const gaps: RawRecapGap[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const range = readRange(item);
    if (range === null) return null;
    gaps.push({ ...range, why: typeof item.why === 'string' ? item.why.trim() : '' });
  }
  return gaps;
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
// verificacion
// ---------------------------------------------------------------------------

export interface VerifiedRecap {
  /** ya recortada a los topes del relleno */
  memory: ConversationMemory;
  covered: { from: number; to: number };
  gaps: RecapGap[];
  /** caracteres del bloque renderizado: es lo que se paga en cada turno */
  chars: number;
}

export type RecapVerification = { ok: true; recap: VerifiedRecap } | { ok: false; reason: string };

export interface RecapVerificationContext {
  /** la PARTE NUEVA que se le enseño: nadie puede decir que cubrio mas */
  expected: { from: number; to: number };
  /**
   * la ventana llevaba una ficha anterior.
   *
   * Solo cambia por donde se recorta cuando no caben todas las entradas: ver
   * `clampRecapMemory`.
   */
  chained?: boolean;
}

/**
 * comprueba la ficha contra la ventana que se le enseño.
 *
 * Aqui se rechaza en bloque y no elemento a elemento, al reves que el extractor
 * de pendientes: una ficha es una sola cosa, y quedarse con media —sin los
 * tramos que el modelo dijo que no habia resumido— es exactamente el fallo que
 * este trabajo no puede cometer.
 *
 * Todos los motivos son cadenas fijas de este archivo. Ninguno lleva nada de lo
 * que dijo el modelo (§8.3 del diseño): al haberle pedido describir la escena,
 * lo que diga en su lugar puede citarla.
 */
export function verifyRecap(parsed: ParsedRecap, ctx: RecapVerificationContext): RecapVerification {
  if (parsed.status !== 'structured' || parsed.reply === null) {
    return { ok: false, reason: 'no hay ficha que comprobar' };
  }
  const { memory, covered, skipped } = parsed.reply;

  if (covered.to < covered.from) {
    return { ok: false, reason: 'el tramo cubierto acaba antes de empezar' };
  }
  if (covered.to > ctx.expected.to) {
    return { ok: false, reason: 'dice cubrir turnos que no se le enseñaron' };
  }
  if (carriesBlockMark(memory)) {
    return { ok: false, reason: 'la ficha lleva dentro una marca de bloque de Luxy' };
  }
  if (carriesCode(memory)) {
    return { ok: false, reason: 'la ficha lleva codigo dentro' };
  }

  const gaps: RecapGap[] = [];
  for (const gap of skipped) {
    const why = recapGapWhySchema.safeParse(gap.why);
    if (!why.success) {
      return { ok: false, reason: 'un tramo saltado trae un motivo que no esta en la lista' };
    }
    if (gap.to < gap.from) {
      return { ok: false, reason: 'un tramo saltado acaba antes de empezar' };
    }
    // contra la VENTANA, no contra el `covered` que el propio modelo dice.
    //
    // Comparar contra `covered` premiaba la respuesta silenciosa y castigaba la
    // honesta: quien estrecha `covered` por el principio y NO dice nada se
    // llevaba el tramo por delante en silencio, y quien estrecha `covered` y
    // ADEMAS declara el tramo que se ha saltado invalidaba su propia ficha, con
    // lo que la conversacion se paraba. Lo que nadie puede hacer es hablar de
    // turnos que no se le enseñaron.
    if (gap.from < ctx.expected.from || gap.to > ctx.expected.to) {
      return { ok: false, reason: 'un tramo saltado cae fuera de lo cubierto' };
    }
    gaps.push({ from: gap.from, to: gap.to, why: why.data });
  }

  const clamped = clampRecapMemory(memory, { chained: ctx.chained === true });
  return {
    ok: true,
    recap: {
      memory: clamped,
      covered,
      gaps,
      chars: formatConversationMemory(clamped).length,
    },
  };
}

/** todo el texto de una ficha, para las comprobaciones que miran el conjunto */
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

/**
 * una ficha con `<LUXY_` dentro no se guarda, venga como venga.
 *
 * Cualquiera de esas marcas viaja despues dentro de otro prompt, y ahi la busca
 * un `lastIndexOf` que no distingue la que puso Luxy de la que copio el modelo:
 * el turno vivo siguiente leeria como memoria suya lo que en realidad es texto
 * de esta ficha.
 */
function carriesBlockMark(memory: ConversationMemory): boolean {
  return memoryTexts(memory).some((text) => text.toLowerCase().includes('<luxy_'));
}

/** una ficha con codigo dentro no es una ficha: es la respuesta colada */
function carriesCode(memory: ConversationMemory): boolean {
  return memoryTexts(memory).some((text) => looksLikeCode(text));
}

// ---------------------------------------------------------------------------
// el recorte del relleno
// ---------------------------------------------------------------------------

const CLAMP_ORDER = ['lessons', 'openQuestions', 'plan', 'decisions', 'facts'] as const;

export interface RecapClampOptions {
  /**
   * la ficha viene de una ventana ENCADENADA.
   *
   * Cambia por que extremo se recorta, y no es un detalle: al modelo se le pide
   * que devuelva la ficha anterior entera y le añada lo nuevo, asi que lo nuevo
   * llega SIEMPRE al final. Recortar por el final en una ficha encadenada tira
   * justo lo que esta ventana ha aportado y la deja esteril —con el marcador
   * perfecto, ademas—, que es lo que le pasaria a la segunda mitad de las dos
   * conversaciones mas largas, que es la parte que sirve para retomar.
   */
  chained?: boolean;
}

/**
 * ajusta la ficha a los topes del relleno y al tope duro del bloque.
 *
 * Recorta y no rechaza (LUX-8B8T). Cuando aun asi el bloque no cabe, se quitan
 * entradas en este orden de listas: `lessons`, `openQuestions`, `plan`,
 * `decisions`, `facts`. `facts` y `decisions` se defienden las ultimas porque
 * son el estado y los acuerdos, que es de lo unico que no se puede prescindir
 * para retomar.
 *
 * Dentro de cada lista, el sacrificio se decide AQUI y en un solo sitio: sin
 * ficha anterior sobra lo ultimo; con ficha anterior sobra lo mas viejo, salvo
 * el ancla del principio, que no se va nunca.
 */
export function clampRecapMemory(
  memory: ConversationMemory,
  options: RecapClampOptions = {},
): ConversationMemory {
  const chained = options.chained === true;
  const lista = (entries: readonly string[]): string[] => {
    const cleaned = entries
      .map((entry) => flattenTurnText(entry).slice(0, RECAP_ENTRY_CHARS).trim())
      .filter((entry) => entry.length > 0);
    return cleaned.length <= RECAP_LIST_MAX ? cleaned : trimRecapList(cleaned, chained);
  };

  const clamped: ConversationMemory = {
    version: 1,
    summary: flattenTurnText(memory.summary).slice(0, RECAP_SUMMARY_CHARS).trim(),
    facts: lista(memory.facts),
    decisions: lista(memory.decisions),
    plan: lista(memory.plan),
    openQuestions: lista(memory.openQuestions),
    lessons: lista(memory.lessons),
  };

  while (formatConversationMemory(clamped).length > RECAP_BLOCK_CHARS) {
    const list = CLAMP_ORDER.find((name) => clamped[name].length > 0);
    // solo queda el resumen, que ya esta en su tope: no hay nada mas que quitar
    if (list === undefined) break;
    clamped[list] = dropOneRecapEntry(clamped[list], chained);
  }
  return clamped;
}

/** las seis que se quedan cuando hay mas de seis */
function trimRecapList(entries: readonly string[], chained: boolean): string[] {
  if (!chained) return entries.slice(0, RECAP_LIST_MAX);

  const anchor = entries.find((entry) => isAnchorEntry(entry));
  const rest = entries.filter((entry) => !isAnchorEntry(entry));
  if (anchor === undefined) return rest.slice(-RECAP_LIST_MAX);
  return [anchor, ...rest.slice(-(RECAP_LIST_MAX - 1))];
}

/** la que sobra cuando el bloque renderizado sigue sin caber */
function dropOneRecapEntry(entries: readonly string[], chained: boolean): string[] {
  if (!chained) return entries.slice(0, -1);

  const oldest = entries.findIndex((entry) => !isAnchorEntry(entry));
  // solo queda el ancla: entonces tambien se va, o el bucle no termina
  if (oldest < 0) return entries.slice(0, -1);
  return [...entries.slice(0, oldest), ...entries.slice(oldest + 1)];
}

// ---------------------------------------------------------------------------
// el ancla del principio
// ---------------------------------------------------------------------------

/** la entrada «Empezo: …» de una ficha, si la tiene */
export function recapAnchorEntry(memory: ConversationMemory | null): string | null {
  if (memory === null) return null;
  return memory.facts.find((entry) => isAnchorEntry(entry)) ?? null;
}

/**
 * vuelve a poner el ancla si el modelo la perdio.
 *
 * Solo se re-añade cuando falta: si el modelo la reescribio, se respeta lo que
 * escribio y el cambio sale contado en `countKeptEntries`. Re-añadirla es seguro
 * porque esta en pasado; sobrescribir una version corregida no lo seria.
 */
export function restoreRecapAnchor(
  memory: ConversationMemory,
  anchor: string | null,
): ConversationMemory {
  if (anchor === null) return memory;
  if (memory.facts.some((entry) => isAnchorEntry(entry))) return memory;

  // si la lista ya estaba llena, la que sobra es la MAS VIEJA y no la ultima: la
  // ultima es lo que acaba de ver esta ventana, y tirarlo para hacerle sitio al
  // ancla dejaria la ventana sin aportar nada
  const facts = [
    flattenTurnText(anchor).slice(0, RECAP_ENTRY_CHARS),
    ...memory.facts.slice(-(RECAP_LIST_MAX - 1)),
  ];
  return { ...memory, facts };
}

/**
 * el ancla se reconoce sin acentos y sin mayusculas.
 *
 * El prompt la pide sin acento —va escrito asi entero—, pero el modelo escribe
 * en español y la devuelve tan a menudo como «Empezó:». Comparar en crudo haria
 * que se re-añadiera una segunda copia encima de la que ya estaba.
 */
function isAnchorEntry(entry: string): boolean {
  return fold(entry).trimStart().startsWith(fold(RECAP_ANCHOR_PREFIX).trim());
}

/** primera y ultima marca diacritica combinante de Unicode */
const COMBINING_FIRST = 0x300;
const COMBINING_LAST = 0x36f;

/**
 * sin acentos y en minusculas: lo que escriba el modelo no tiene por que coincidir.
 *
 * Se recorre caracter a caracter en vez de con una clase de caracteres porque un
 * rango escrito con secuencias de escape es justo lo que se pierde al pasar por
 * una consola: llega sin las barras, compila igual y no casa con nada
 * (`CLAUDE.md`, regla 2 bis).
 */
function fold(text: string): string {
  let folded = '';
  for (const char of text.normalize('NFD')) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= COMBINING_FIRST && code <= COMBINING_LAST) continue;
    folded += char;
  }
  return folded.toLowerCase();
}

// ---------------------------------------------------------------------------
// la vaguedad
// ---------------------------------------------------------------------------

/**
 * los comodines. LISTA CERRADA, sin acentos y en minusculas.
 *
 * No es una heuristica general de «suena vago»: son las formulas concretas con
 * las que un modelo obediente sanea una escena sexual sin negarse. Una lista
 * cerrada se puede leer entera y se sabe exactamente que caza y que no.
 */
const VAGUE_MARKERS = [
  'momento intimo',
  'encuentro intimo',
  'contenido explicito',
  'de naturaleza personal',
  'cierto momento',
  'sin entrar en detalles',
  'no puedo detallar',
  'no es apropiado',
  'no procede describir',
] as const;

/** por debajo de esto, una ficha no dice nada aunque no use ningun comodin */
const VAGUE_HARD_CHARS = 150;

/** y por debajo de esto solo si ademas hay un comodin */
const VAGUE_THIN_CHARS = 320;

export interface RecapVagueness {
  vague: boolean;
  /** caracteres de la ficha: resumen mas todas las entradas */
  chars: number;
  /** entradas de las cinco listas */
  entries: number;
  /** el comodin que salto, o `null`. Es de la lista cerrada: no es texto de la boveda */
  marker: string | null;
}

/**
 * el caso peor no es que se nieguen: es que obedezcan y saneen.
 *
 * «Tuvieron un encuentro intimo y acordaron verse el sabado» valida contra el
 * esquema, pasa el clasificador de negativas, avanza el cursor, apaga el aviso
 * de turnos omitidos y —porque la memoria siguiente conserva lo valido de la
 * anterior— se convierte en la semilla permanente que el modelo de pago arrastra
 * en cada turno de ese hilo.
 *
 * Se marca solo cuando coinciden POCA SUSTANCIA y un COMODIN, con el mismo sesgo
 * conservador que el clasificador de negativas: mas vale dejar pasar una mala
 * que tirar una buena, porque una buena tirada cuesta otra llamada y otra
 * negativa posible.
 */
export function scoreRecapVagueness(memory: ConversationMemory): RecapVagueness {
  const texts = memoryTexts(memory);
  const chars = texts.reduce((total, text) => total + text.trim().length, 0);
  const entries = texts.length - 1;
  const folded = fold(texts.join(' '));
  const marker = VAGUE_MARKERS.find((each) => folded.includes(each)) ?? null;

  // señal independiente y suficiente: esto no es una ficha, es un titular
  if (chars < VAGUE_HARD_CHARS) return { vague: true, chars, entries, marker };

  const thin = chars < VAGUE_THIN_CHARS || entries === 0;
  return { vague: thin && marker !== null, chars, entries, marker };
}

// ---------------------------------------------------------------------------
// el troceado
// ---------------------------------------------------------------------------

export interface RecapWindow {
  /** turnos ya revisados que se enseñan marcados, para entender el principio */
  context: RecapTurn[];
  /** la PARTE NUEVA: lo unico que esta ventana resume */
  fresh: RecapTurn[];
  /** el ultimo turno del personaje de la ventana: hasta ahi llega el cursor */
  last: RecapTurn;
}

/** el catalogo de esa conversacion, con lo que hace falta para saber si vale */
export interface RecapCatalog {
  scenes: readonly CatalogedScene[];
  /** cuantos turnos tenia la conversacion cuando se catalogo */
  turnsAtCatalog: number;
}

/** el ultimo turno del personaje, que es lo unico que un cursor puede señalar */
export function lastReviewableRecapTurn(
  turns: readonly { sequence: number; role: string }[],
): number | null {
  let last: number | null = null;
  for (const turn of turns) {
    if (turn.role === 'assistant') last = turn.sequence;
  }
  return last;
}

/**
 * la ventana que se le enseña, y hasta donde llegara el cursor.
 *
 * Regla heredada del extractor de pendientes: nunca se da por leido un mensaje
 * del usuario sin respuesta, porque el almacen lo retira si el turno falla y
 * reutiliza su numero. Por eso la parte nueva termina SIEMPRE en un turno del
 * personaje.
 *
 * Lo propio de aqui es la preferencia de escena: si el catalogo de esa
 * conversacion es fiable y hay un corte suyo cerca del final de la ventana, se
 * corta ahi. Entregar media escena le da al resumidor media escena, y esos
 * cortes ya existen y ya estan pagados.
 */
export function recapWindow(
  turns: readonly RecapTurn[],
  through: number,
  catalog?: RecapCatalog | null,
): RecapWindow | null {
  const ordered = [...turns].sort((a, b) => a.sequence - b.sequence);
  const lastReviewable = lastReviewableRecapTurn(ordered);
  if (lastReviewable === null || lastReviewable <= through) return null;

  const candidates = ordered.filter(
    (turn) => turn.sequence > through && turn.sequence <= lastReviewable,
  );
  if (candidates.length === 0) return null;

  let fresh = candidates.slice(0, RECAP_WINDOW_TURNS);

  const cut = sceneCut(fresh, ordered.length, catalog);
  if (cut !== null) fresh = fresh.filter((turn) => turn.sequence <= cut);

  // el corte de escena no exime de la regla: un `to` que cayera en un turno del
  // usuario dejaria el cursor sobre un numero reutilizable
  while (fresh.length > 0 && fresh[fresh.length - 1]!.role !== 'assistant') fresh.pop();
  if (fresh.length === 0) {
    // una tirada de cuarenta mensajes seguidos del usuario: la ventana se alarga
    // hasta la primera respuesta en vez de quedarse sin cursor que avanzar
    const firstReply = candidates.findIndex((turn) => turn.role === 'assistant');
    if (firstReply < 0) return null;
    fresh = candidates.slice(0, firstReply + 1);
  }

  const first = fresh[0]!;
  const startsAt = ordered.findIndex((turn) => turn.sequence === first.sequence);
  const context = ordered.slice(Math.max(0, startsAt - RECAP_CONTEXT_TURNS), startsAt);
  return { context, fresh, last: fresh[fresh.length - 1]! };
}

/**
 * donde cortaria el catalogo, si es que se puede usar.
 *
 * Se exigen las tres cosas: que exista, que se catalogara con la conversacion ya
 * entera —uno a medias tiene rangos que no llegan al final— y que no sea un
 * reparto uniforme, que es la huella de haber partido por longitud y no por lo
 * que pasa. Un catalogo asi no señala escenas: señala trozos iguales.
 */
function sceneCut(
  fresh: readonly RecapTurn[],
  turns: number,
  catalog: RecapCatalog | null | undefined,
): number | null {
  if (catalog === null || catalog === undefined) return null;
  if (catalog.scenes.length === 0) return null;
  if (catalog.turnsAtCatalog < turns) return null;
  if (detectEvenSplit(catalog.scenes).even) return null;

  const tail = fresh.slice(-RECAP_SCENE_TAIL).map((turn) => turn.sequence);
  if (tail.length === 0) return null;

  let best: number | null = null;
  for (const scene of catalog.scenes) {
    if (!tail.includes(scene.to)) continue;
    if (best === null || scene.to > best) best = scene.to;
  }
  return best;
}

// ---------------------------------------------------------------------------
// la deriva entre ventanas
// ---------------------------------------------------------------------------

export interface RecapDrift {
  /** entradas de la ficha anterior que siguen ahi tal cual */
  kept: number;
  /** entradas que siguen ahi pero dichas de otra forma */
  rewritten: number;
  /** entradas que ya no estan */
  dropped: number;
  /**
   * entradas de la ficha nueva que no venian de la anterior.
   *
   * Es lo que esta ventana APORTA, y hace falta porque los otros tres no lo
   * saben medir: una ventana que devuelve las seis viejas intactas y no mete ni
   * una nueva sale con `kept` lleno y `dropped` a cero, es decir con el marcador
   * perfecto, siendo esteril.
   */
  added: number;
}

/** por debajo de esta coincidencia de palabras, dos entradas no son la misma */
const REWRITE_SIMILARITY = 0.6;

/**
 * cuanto conservo la ventana nueva de la anterior.
 *
 * Existe porque la orden «devuelvela entera, palabra por palabra» no se puede
 * comprobar con otro modelo sin pagarlo. Esto se mide sin modelo: si `dropped`
 * sube, el prompt esta derivando y a la tercera vuelta el principio de la
 * conversacion habra desaparecido. Sale en el panel para que se vea en vez de
 * descubrirse leyendo.
 *
 * Solo cuenta las ENTRADAS de las cinco listas. El resumen se reescribe siempre
 * —tiene que hablar de la ultima escena— y contarlo como perdida seria ruido.
 */
export function countKeptEntries(
  previous: ConversationMemory | null,
  next: ConversationMemory,
): RecapDrift {
  // sin ficha anterior no hay nada que comparar, y todo lo de la nueva es nuevo
  // por definicion: contarlo como aportado seria ruido
  const drift: RecapDrift = { kept: 0, rewritten: 0, dropped: 0, added: 0 };
  if (previous === null) return drift;

  const lists = ['facts', 'decisions', 'plan', 'openQuestions', 'lessons'] as const;
  for (const list of lists) {
    const remaining = next[list].map((entry) => ({ entry, taken: false }));

    for (const before of previous[list]) {
      const normalized = normalizeEntry(before);
      const exact = remaining.find(
        (each) => !each.taken && normalizeEntry(each.entry) === normalized,
      );
      if (exact !== undefined) {
        exact.taken = true;
        drift.kept += 1;
        continue;
      }

      let best: { slot: (typeof remaining)[number]; score: number } | null = null;
      for (const slot of remaining) {
        if (slot.taken) continue;
        const score = similarity(normalized, normalizeEntry(slot.entry));
        if (best === null || score > best.score) best = { slot, score };
      }
      if (best !== null && best.score >= REWRITE_SIMILARITY) {
        best.slot.taken = true;
        drift.rewritten += 1;
        continue;
      }
      drift.dropped += 1;
    }

    drift.added += remaining.filter((slot) => !slot.taken).length;
  }
  return drift;
}

/** sin acentos, sin signos y sin dobles espacios: «El la llama nena.» y «el la llama nena» son la misma */
function normalizeEntry(entry: string): string {
  return fold(entry)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

/**
 * cuanto de la entrada mas corta esta dentro de la otra.
 *
 * NO se comparan palabras compartidas sobre palabras totales: la forma normal de
 * corregir una entrada es AMPLIARLA —«El la llama nena» pasa a «El la llama nena
 * cuando esta de buenas»—, y esa medida la contaria como perdida solo por haber
 * crecido. Lo que este contador tiene que distinguir es «crecio» de
 * «desaparecio», que son dos problemas distintos.
 *
 * Las palabras de menos de tres letras no cuentan: articulos y preposiciones
 * emparejarian cualquier cosa con cualquier cosa.
 */
function similarity(left: string, right: string): number {
  const words = (text: string): Set<string> =>
    new Set(text.split(' ').filter((word) => word.length >= 3));
  const a = words(left);
  const b = words(right);
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

// ---------------------------------------------------------------------------
// el indice deducido
// ---------------------------------------------------------------------------

/** el turno al que apunta algo: su numero y cuando se dijo */
export interface RecapTurnRef {
  sequence: number;
  createdAt: string;
}

export interface DeduceRecapInput {
  conversationId: string;
  scenes: readonly CatalogedScene[];
  /** primer turno de la conversacion: da el dia de inicio */
  first: RecapTurnRef;
  /** ultimo turno: da el dia final y, si casa con `covered.to`, el `coveredAt` */
  last: RecapTurnRef;
  /** cuantos turnos tenia la conversacion al deducirla */
  turnsAtRecap: number;
  anchor: TemporalAnchor;
  /** el reloj, inyectado: este paquete es determinista */
  at: string;
}

/**
 * el nivel sin modelo. Cero llamadas, imposible que se niegue.
 *
 * Solo lleva LO QUE EL PROMPT NO LLEVA YA. El prompt privado emite en cada turno
 * una linea de indice por episodio —fecha, titulo y numero de turnos—, asi que
 * un «resumen» que repitiera fechas y titulos seria relleno puro. Lo unico que
 * el catalogo aporta y el prompt no lleva es el `summary` de cada escena.
 *
 * Por eso `decisions`, `plan`, `openQuestions` y `lessons` van VACIAS: un indice
 * no sabe que se decidio ni que quedo en el aire, y rellenarlas seria inventar.
 * Y por eso se presenta como indice y no como memoria, y no cuenta como
 * cobertura.
 *
 * Sin escenas, o con todas sin resumen, no se crea entrada: vale mas el aviso de
 * turnos omitidos que un bloque hueco que lo apaga.
 */
export function deduceRecap(input: DeduceRecapInput): RecapEntry | null {
  const usable = input.scenes.filter((scene) => scene.summary.trim().length > 0);
  if (usable.length === 0) return null;

  const chosen = pickScenes(usable);
  const facts = chosen.map((scene) =>
    `«${flattenTurnText(scene.title)}»: ${flattenTurnText(scene.summary)}`.slice(
      0,
      RECAP_ENTRY_CHARS,
    ),
  );

  const desde = civilDayLabel(input.first.createdAt, input.anchor);
  const hasta = civilDayLabel(input.last.createdAt, input.anchor);
  // las dos cifras cuando no caben todas, como hace el bloque de recuerdos con
  // los momentos que no caben. Decir «las 6 escenas» teniendo 9 catalogadas es
  // una afirmacion falsa sobre la conversacion, y callar las tres que faltan es
  // justo lo contrario de lo que hace este nivel en todo lo demas: declarar lo
  // que no sabe para que ella pregunte en vez de suponerlo
  const cuantas =
    chosen.length === usable.length
      ? `las ${usable.length} escenas`
      : `${chosen.length} de las ${usable.length} escenas`;
  const falta =
    chosen.length === usable.length
      ? ''
      : ' Y que una no aparezca aqui no significa que no pasara.';
  const summary = `Indice de ${cuantas} de esta conversacion, del ${desde} al ${hasta}. No se sabe que se dijo dentro de ellas.${falta}`;

  const memory = clampRecapMemory({
    version: 1,
    summary: summary.slice(0, RECAP_SUMMARY_CHARS),
    facts,
    decisions: [],
    plan: [],
    openQuestions: [],
    lessons: [],
  });

  const covered = {
    from: Math.min(...usable.map((scene) => scene.from)),
    to: Math.max(...usable.map((scene) => scene.to)),
  };

  return recapEntrySchema.parse({
    conversationId: input.conversationId,
    memory,
    source: 'index',
    covered,
    // solo se puede fechar el corte si el ultimo turno es ese; si no, se dice que
    // no se sabe en vez de estampar una fecha que no corresponde
    coveredAt: input.last.sequence === covered.to ? input.last.createdAt : null,
    gaps: [],
    turnsAtRecap: input.turnsAtRecap,
    version: RECAP_VERSION,
    provider: null,
    model: null,
    at: input.at,
    chars: formatConversationMemory(memory).length,
    // no lleva ni una palabra escrita por un modelo nuevo: solo resumenes que ya
    // estaban en la boveda, asi que no hay nada que aprobar
    approved: true,
  });
}

/** con mas de seis: la primera, la ultima, y las cuatro de resumen mas largo */
function pickScenes(scenes: readonly CatalogedScene[]): CatalogedScene[] {
  const ordered = [...scenes].sort((a, b) => a.from - b.from);
  if (ordered.length <= RECAP_LIST_MAX) return ordered;

  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const middle = ordered.slice(1, -1);
  const longest = [...middle]
    .sort((a, b) => b.summary.length - a.summary.length || a.from - b.from)
    .slice(0, RECAP_LIST_MAX - 2);

  return [first, ...longest, last].sort((a, b) => a.from - b.from);
}

// ---------------------------------------------------------------------------
// que memoria se usa en el turno
// ---------------------------------------------------------------------------

export type MemorySource = 'turn' | 'recap' | 'index';

export interface ChosenMemory {
  memory: ConversationMemory | null;
  source: MemorySource;
  /** tramos declarados que nadie resumio */
  gaps: number;
}

/**
 * de donde sale la memoria de esta conversacion. Cambio de LECTURA, no de
 * escritura: `conversation-store.ts` no se toca.
 *
 * La sellada gana SIEMPRE y sin excepciones. No se mezcla con el relleno: serian
 * dos memorias escritas por modelos distintos sin ningun criterio de desempate,
 * es decir, un modo de fallo nuevo a cambio de nada.
 *
 * Y sin nada que usar, se devuelve `null` con `source: 'turn'`: el
 * comportamiento de hoy, byte a byte, con su aviso de turnos omitidos.
 */
export function chooseConversationMemory(input: {
  sealed: ConversationMemory | null;
  entry: RecapEntry | undefined;
  /** secuencia y createdAt de todos los turnos */
  turns: readonly RecapTurnRef[];
  recentTurns?: number;
}): ChosenMemory {
  if (input.sealed !== null) return { memory: input.sealed, source: 'turn', gaps: 0 };

  const entry = input.entry;
  if (entry === undefined || entry.memory === null) {
    return { memory: null, source: 'turn', gaps: 0 };
  }

  if (entry.source === 'index') {
    return { memory: entry.memory, source: 'index', gaps: 0 };
  }

  if (!entry.approved) return { memory: null, source: 'turn', gaps: 0 };
  if (entry.version !== RECAP_VERSION) return { memory: null, source: 'turn', gaps: 0 };
  if (!recapCoversTail(entry, input.turns, input.recentTurns)) {
    return { memory: null, source: 'turn', gaps: 0 };
  }

  return { memory: entry.memory, source: 'recap', gaps: entry.gaps.length };
}

/**
 * la invariante de cobertura, que es lo que hace imposible por construccion el
 * peor fallo de este trabajo.
 *
 * Dos cosas: que `coveredAt` case con el turno al que dice llegar —si no casa,
 * el numero de secuencia se reutilizo y el recap habla de otros turnos—, y que
 * llegue al menos hasta el primer turno de la cola literal, que son los ultimos
 * que viajan enteros dentro del prompt.
 *
 * Si no llega ahi hay un tramo que nadie ha declarado: no es un hueco dicho, es
 * «la pasada no ha terminado». Y una memoria a medias apaga el aviso de turnos
 * omitidos, con lo cual el personaje dejaria de preguntar justo cuando mas le
 * falta. Antes eso que esto: la conversacion se queda como hoy.
 */
function recapCoversTail(
  entry: RecapEntry,
  turns: readonly RecapTurnRef[],
  recentTurns: number = VAULT_RECENT_TURNS,
): boolean {
  const ordered = [...turns].sort((a, b) => a.sequence - b.sequence);
  if (ordered.length === 0) return false;

  const turn = ordered.find((each) => each.sequence === entry.covered.to);
  if (turn === undefined) return false;
  if (entry.coveredAt === null || entry.coveredAt !== turn.createdAt) return false;

  const tail = ordered.slice(Math.max(0, ordered.length - recentTurns));
  const tailFirst = tail[0]!.sequence;
  return entry.covered.to >= tailFirst - 1;
}

// ---------------------------------------------------------------------------
// negativas persistidas
// ---------------------------------------------------------------------------

/**
 * true si esa conversacion ya se nego y no ha cambiado nada desde entonces.
 *
 * Calcado de `refusedStill`, y por el mismo motivo: con contenido explicito el
 * mismo CLI va a volver a negarse y cada intento cuesta el arranque de un
 * proceso. Se persiste en la entrada y no en un `Set` de sesion como hace el
 * catalogo, porque ese se pierde al reiniciar y hace que cada arranque mande
 * otra vez las mismas conversaciones al mismo CLI para recibir la misma
 * negativa.
 *
 * Vuelve a entrar cuando la conversacion crece, cuando sube `RECAP_VERSION`,
 * cuando cambia el CLI —quien se nego fue uno concreto, y el otro puede aceptar
 * perfectamente lo que este rechazo— o cuando Daniel lo pide a mano.
 */
export function refusedStillRecap(
  entry: RecapEntry | undefined,
  turns: number,
  provider?: LocalCliProvider,
): boolean {
  if (entry === undefined) return false;
  if (entry.refusedKind === null) return false;
  if (entry.version < RECAP_VERSION) return false;
  if (provider !== undefined && entry.refusedProvider !== provider) return false;
  return entry.refusedAtTurns !== null && turns <= entry.refusedAtTurns;
}

// ---------------------------------------------------------------------------
// la cobertura, para el panel
// ---------------------------------------------------------------------------

export interface RecapCoverageConversation {
  conversationId: string;
  /** ya tiene memoria sellada viva: el relleno no la toca */
  sealed: boolean;
  /** excluida a mano del trabajo de fondo */
  excluded: boolean;
  turns: readonly RecapTurnRef[];
}

export interface RecapCoverage {
  total: number;
  excluded: number;
  /** con ficha completa de un CLI, aprobada y al dia */
  summarized: number;
  /** con ficha, pero con tramos declarados que nadie resumio */
  withGaps: number;
  /** solo el indice deducido: NO cuenta como cobertura */
  indexOnly: number;
  /** sin nada; conserva el aviso de turnos omitidos, que es el estado seguro */
  missing: number;
  /** las que ya tenian memoria propia */
  sealed: number;
}

/**
 * los numeros de la linea del panel, y SUMAN.
 *
 * `summarized + withGaps + indexOnly + missing + sealed === total - excluded`.
 * Si no cuadra es un fallo, no un redondeo: es el equivalente al
 * `coverage.behind === 0` de los pendientes, que hoy no existe para la memoria.
 *
 * Se calcula con la MISMA funcion que decide que memoria viaja en el turno. Sin
 * eso, el panel podria decir «resumida» de una conversacion cuyo recap el turno
 * esta descartando por la invariante de cobertura, que es justo la clase de
 * mentira que este bloque existe para evitar.
 */
export function recapCoverage(input: {
  conversations: readonly RecapCoverageConversation[];
  entries: readonly RecapEntry[];
  recentTurns?: number;
}): RecapCoverage {
  const byConversation = new Map(input.entries.map((entry) => [entry.conversationId, entry]));
  const coverage: RecapCoverage = {
    total: input.conversations.length,
    excluded: 0,
    summarized: 0,
    withGaps: 0,
    indexOnly: 0,
    missing: 0,
    sealed: 0,
  };

  for (const conversation of input.conversations) {
    if (conversation.excluded) {
      coverage.excluded += 1;
      continue;
    }
    if (conversation.sealed) {
      coverage.sealed += 1;
      continue;
    }

    const chosen = chooseConversationMemory({
      sealed: null,
      entry: byConversation.get(conversation.conversationId),
      turns: conversation.turns,
      recentTurns: input.recentTurns,
    });

    if (chosen.memory === null) coverage.missing += 1;
    else if (chosen.source === 'index') coverage.indexOnly += 1;
    else if (chosen.gaps > 0) coverage.withGaps += 1;
    else coverage.summarized += 1;
  }

  return coverage;
}
