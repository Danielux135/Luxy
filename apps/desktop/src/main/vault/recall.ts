// decide que recuerda el personaje en este turno.
//
// Dos niveles (`D-058`), y el reparto de trabajo es lo importante:
//
//   - las LINEAS de los episodios van siempre. Cuestan ~40 tokens cada una y
//     hacen que el personaje SEPA que ocurrio algo aunque la busqueda no
//     acierte. Que la busqueda falle deja de significar que no se acuerda;
//   - un episodio TRANSCRITO va solo cuando de verdad se ha pedido rememorar.
//     Eso es lo caro en contexto, y es justo cuando se ha pedido.
//
// El tope de lineas limita lo que ve SIEMPRE, no lo que puede recordar: los
// tres caminos que transcriben —el principio, la fecha y las palabras— buscan
// en TODOS los episodios del personaje, esten o no en el indice.
//
// PRECISION ANTES QUE ALCANCE (`D-085`). Si no se reconoce una peticion, ella
// sigue teniendo las lineas —y la del primer momento lleva su resumen— y
// contesta con lo que sabe. Si se reconoce mal, transcribe un momento que nadie
// pidio y lo recita. Por eso lo que decide es la CONSTRUCCION de la frase, no
// una palabra suelta: ver «la gramatica de pedir un recuerdo», mas abajo.
//
// Que camino dispara lo decide `recallRoute`, que es pura: la usan el turno
// real y el diagnostico, asi que el diagnostico mide lo mismo que pasa.
//
// Todo se decide ANTES de la llamada: una sola llamada por turno. Con cobro por
// llamada, una segunda duplicaria la factura de cada mensaje que recuerde algo.
import type {
  VaultRecall,
  RecalledEpisodeLine,
  QuotedEpisode,
  RecallVia,
  PartOfDay,
  TemporalAnchor,
  TemporalReference,
} from '@luxy/shared';
import { civilDayLabel, resolveTemporalReference } from '@luxy/shared';
import type { PrivateMemory } from './private-memory.js';
import type { VaultService } from './vault-service.js';
import { normalizeTerm } from './turn-index.js';
import type { Episode } from './episodes.js';

/**
 * tope de lineas de indice.
 *
 * Cuarenta episodios son ~1.600 tokens sobre un prompt que ya va por 4.800. Con
 * el coste fuera de la ecuacion, lo que limita esto es no diluir las directivas
 * de personaje entre paginas de indice.
 *
 * Exportado para que el diagnostico mida con el MISMO tope que un turno real.
 */
export const MAX_EPISODE_LINES = 40;

/** tope del episodio transcrito: mas alla, deja de caber comodamente */
const MAX_QUOTED_TURNS = 12;
const MAX_QUOTED_CHARS = 6000;

/** de los otros momentos del mismo dia se nombran como mucho estos */
const MAX_SAME_DAY = 6;

/**
 * resultados que se piden para elegir entre los momentos de un dia.
 *
 * Muchos a proposito: una conversacion larga tiene momentos de varios dias, y
 * con pocos resultados los de OTROS dias llenaban la lista antes de llegar al
 * que se buscaba.
 */
const PREFERENCE_SEARCH_LIMIT = 200;

/** lo que ya viaja en el prompt como historial reciente */
export interface RecentWindow {
  conversationId: string;
  fromSequence: number;
}

export interface RecallOptions {
  maxEpisodeLines?: number;
  maxQuotedTurns?: number;
  /**
   * desde cuando y en que zona se interpreta el mensaje.
   *
   * Hace falta para dos cosas distintas, y las dos estaban rotas:
   *
   * 1. FECHAR BIEN el indice. La linea se construia con
   *    `startedAt.slice(0, 10)`, que es la fecha UTC. Con España en UTC+2, las
   *    conversaciones de madrugada quedaban fechadas en un dia que no era el
   *    suyo, y el personaje contradecia una fecha que el usuario recuerda con
   *    certeza;
   * 2. ENTENDER «el jueves». Sin ancla no se puede resolver ninguna referencia
   *    relativa, y el reloj no se lee aqui dentro para poder probarlo.
   *
   * Ausente, se conserva el comportamiento de antes: fecha UTC y sin busqueda
   * por fecha. Asi ninguna prueba vieja cambia de significado sin querer.
   */
  anchor?: TemporalAnchor;
  /**
   * de quien son los recuerdos que puede traer.
   *
   * Obligatorio en un turno real: los recuerdos pertenecen al personaje
   * (`D-058`). `null` significa «esta conversacion no tiene personaje», y
   * entonces solo alcanza a otras que tampoco lo tengan; NO a las de todos.
   */
  characterId?: string | null;
  /**
   * lo que ya viaja en el prompt como historial reciente.
   *
   * Sin esto, preguntar «¿te acuerdas de lo que acabas de decir?» transcribiria
   * otra vez turnos que estan tres bloques mas abajo.
   */
  alreadyInPrompt?: RecentWindow;
  /**
   * palabras que no sirven para elegir momento: el nombre del personaje.
   *
   * Sale en muchos momentos —«*Lia sonrie*»—, asi que «Lia, ¿de que hablamos
   * ayer?» elegia el que la nombraba en vez del que tocaba.
   */
  ignoreWords?: readonly string[];
}

// ---------------------------------------------------------------------------
// el mensaje, preparado para los patrones

/**
 * minusculas, sin tildes, sin acciones entre asteriscos ni emojis, con los
 * espacios colapsados y las abreviaturas de chat escritas enteras. Los saltos
 * de linea se conservan: separan frases.
 *
 * Las acciones son de la escena, no de la pregunta; los emojis rompian los
 * finales de frase («¿te acuerdas del primer dia 🥺?»); y «desde q te conoci»
 * se saltaba la exclusion de «desde que» por la «q».
 */
function forPatterns(message: string): string {
  return normalizeTerm(message)
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[^\p{L}\p{N}\s¿?¡!.,;:'"«»()-]/gu, ' ')
    .replace(/\b(?:q|k)\b/g, 'que')
    .replace(/\b(?:pq|xq|porq|porke)\b/g, 'por que')
    .replace(/\bpa\b/g, 'para')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}

const TERMINA = (ch: string | undefined): boolean =>
  ch === '.' || ch === '!' || ch === '?' || ch === '\n';

/** limites de la oracion que contiene [inicio, fin), con su puntuacion final */
function sentenceBounds(text: string, start: number, end: number): { from: number; to: number } {
  let from = 0;
  for (let i = start - 1; i >= 0; i -= 1) {
    if (TERMINA(text[i])) {
      from = i + 1;
      break;
    }
  }
  let to = text.length;
  for (let i = end; i < text.length; i += 1) {
    if (TERMINA(text[i])) {
      to = i + 1;
      break;
    }
  }
  return { from, to };
}

/** la oracion que acaba justo antes de `from`, o cadena vacia */
function previousSentence(text: string, from: number): string {
  let end = from - 1;
  while (end >= 0 && (text[end] === ' ' || text[end] === '\n')) end -= 1;
  if (end < 0) return '';
  let start = 0;
  for (let i = end - 1; i >= 0; i -= 1) {
    if (TERMINA(text[i])) {
      start = i + 1;
      break;
    }
  }
  return text.slice(start, end + 1);
}

/** lo que va delante DENTRO de la clausula: desde la ultima coma o punto y coma */
function clauseLead(antes: string): string {
  const corte = Math.max(antes.lastIndexOf(','), antes.lastIndexOf(';'), antes.lastIndexOf(':'));
  return antes.slice(corte + 1);
}

/** muletillas y apelativos con los que arranca una pregunta, sin cambiarla */
const LEADING_FILLER =
  /^[\s¿¡]*(?:(?:oye|y|pero|bueno|a ver|amor|cariño|carino|corazon|cielo|venga|eh|entonces|vale)\s*,?\s*)*¿?\s*/;

/** «¿sabes que...?» cuenta algo; no pregunta */
const RHETORICAL_OPENER = /¿\s*(?:sabes|sabias|a que no sabes|a que no sabias|ves) que\b/;

/**
 * coletillas que llevan «?» sin preguntar por lo nombrado.
 *
 * «¿no?», «¿verdad?» y «eh?» NO estan: piden confirmar, y para confirmar un
 * recuerdo hay que traerlo.
 */
const RHETORICAL_TAG =
  /(?:,\s*)?¿?\s*\b(?:sabes|ves|entiendes|me entiendes|me explico|lo sabias|a ti no|no crees)\s*\?/g;

/** coletilla que pide confirmar lo dicho: pregunta de verdad */
const CONFIRMATION_TAG = /^\s*,\s*¿?\s*(?:no|verdad|eh|a que si|cierto)\s*\?/;

/**
 * true si la clausula de lo encontrado es una pregunta.
 *
 * Abierta con «¿» despues de la ultima coma, o cerrada con «?» sin otra
 * clausula ni otra pregunta de por medio, o con una coletilla de confirmar.
 * «me encanta como nos conocimos, ¿a ti no?» lleva «?», pero pregunta otra cosa.
 */
function isQuestionClause(oracion: string, antes: string, despues: string): boolean {
  if (RHETORICAL_OPENER.test(oracion)) return false;
  const apertura = antes.lastIndexOf('¿');
  const corte = Math.max(antes.lastIndexOf(','), antes.lastIndexOf(';'), antes.lastIndexOf(':'));
  if (apertura > corte) return true;
  const resto = despues.replace(RHETORICAL_TAG, ' ');
  return /^[^,;:¿]*\?/.test(resto) || CONFIRMATION_TAG.test(resto);
}

// ---------------------------------------------------------------------------
// la gramatica de pedir un recuerdo
//
// Tres revisiones adversariales —la ultima probo 287 frases de chat y encontro
// 141 falsos positivos— enseñaron lo mismo: buscar palabras sueltas como
// «hablamos», «te acuerdas» o «el primer dia» dispara con frases que las usan
// para OTRA cosa. «el sabado hablamos con calma», «acuerdate de comprar pan»,
// «me recuerdas a mi abuela», «nuestro primer dia juntos en Paris». Lo que
// distingue una peticion de recuerdo es la construccion:
//
//   1. un verbo de recordar que PREGUNTA —«¿te acuerdas de...?»— con un objeto
//      que es un recuerdo y no un recado («de comprar el vino»), un mimo («que
//      te quiero») o un parecido («me recuerdas a»);
//   2. un imperativo de recordar con un objeto de recuerdo: «acuerdate de
//      cuando...», «recuerdame lo que...», no «recuerdame que mañana...»;
//   3. una pregunta que EMPIEZA por un interrogativo pegado a un verbo de
//      NOSOTROS o de TI A MI: «¿de que hablamos?», «¿que me dijiste?». No «¿que
//      dijiste en la entrevista?», que es de ella con otros;
//   4. «lo que» o «aquello que» con uno de esos verbos: «lo que me dijiste el
//      lunes»; y «lo de» con una referencia de tiempo: «lo de esta mañana».

/** verbos de recordar que preguntan: segunda persona */
const REMEMBER_ASK = /\b(?:te acuerdas|acuerdas|recuerdas|te acordabas)\b/g;

/** imperativos de recordar */
const REMEMBER_IMPERATIVE = /\b(?:acuerdate|recuerdame)\b/g;

/** verbos que piden contar */
const REQUEST_VERB =
  /\b(?:cuentame|cuentamelo|me cuentas|contarme|me cuentes|dime|hablame|explicame|recuerdame)\b/g;

/**
 * detras de un verbo de recordar que pregunta: lo que NO es un recuerdo.
 *
 * Un parecido («me recuerdas a un osito»), un recado («te acuerdas de comprar
 * el vino?», con infinitivo, tambien con pronombre: «llamarme») o un mimo en
 * presente («te acuerdas que te quiero, no?»).
 */
const NOT_A_MEMORY_OBJECT =
  /^\s*(?:a\s|de\s+[a-zñ]+(?:ar|er|ir)(?:me|te|se|lo|la|le|nos|les)?\b|que\s+(?:te quiero|te amo|te adoro|eres|soy|estoy|me gustas|me encantas|te necesito|te echo))/;

/** lo que va detras de un imperativo o un «cuentame» cuando pide un RECUERDO */
const IMPERATIVE_OBJECT =
  /^\s*(?:,\s*)?(?:otra vez\s+)?(?:de\s+)?(?:cuando|como|donde|lo que|aquel|aquella|aquello|la vez|el dia|del dia|la primera vez|el primer dia|del primer dia|que (?:hablamos|dijimos|hicimos|me dijiste|te dije|me contaste|te conte|nos paso))\b/;

/** lo que puede haber entre el verbo que pide y lo pedido: «cuentame [de] como...» */
const REQUEST_BRIDGE =
  /^\s*(?:otra vez\s+)?(?:de\s+)?(?:como|cuando|donde|lo de|el dia|la primera vez)?(?:\s+fue\s+que)?\s*$/;

/**
 * true si el verbo de recordar que empieza en `inicio` PREGUNTA por un recuerdo.
 *
 * «si te acuerdas, compra helado» es una condicion; «siempre te acuerdas de mi
 * cumple» es un halago; «me recuerdas...» es pedir que le recuerde algo, y solo
 * cuenta si lo que pide es un recuerdo.
 */
function rememberAsks(text: string, inicio: number, fin: number): boolean {
  const { from, to } = sentenceBounds(text, inicio, fin);
  const lead = clauseLead(text.slice(from, inicio));
  if (/(?:^|\s)si\s+(?:\S+\s+){0,2}$/.test(lead)) return false;
  if (/\b(?:siempre|nunca|jamas|tampoco)\s+(?:te\s+)?$/.test(lead)) return false;
  const objeto = text.slice(fin, to);
  if (/(?:^|\s)me\s+$/.test(lead)) return IMPERATIVE_OBJECT.test(objeto);
  return !NOT_A_MEMORY_OBJECT.test(objeto);
}

/** verbos de NOSOTROS o de TI A MI: los que hablan de lo vivido juntos */
const US_VERBS =
  '(?:hablamos|hablabamos|estabamos hablando|dijimos|nos dijimos|comentamos|hicimos|estuvimos haciendo|estuvimos|nos paso|te dije|te conte|te comente|te pregunte|te escribi|me dijiste|me contaste|me comentaste|me preguntaste|me escribiste|me decias|me contabas|me hablaste)';

/** «¿de que hablamos...?», «¿que me dijiste...?»: interrogativo y verbo juntos */
const CONVERSATION_QUESTION = new RegExp(
  `\\b(?:de que|sobre que|que|donde|como)\\s+${US_VERBS}\\b`,
  'g',
);

/**
 * «lo que me dijiste el lunes», «aquello que te conte anoche».
 *
 * Sin «hicimos» ni «estuvimos»: «no sabes lo que hicimos ayer mis amigos y yo»
 * es un nosotros sin ella.
 */
const CONVERSATION_REFERENCE =
  /\b(?:lo|aquello|eso) que\s+(?:hablamos|dijimos|nos dijimos|comentamos|te dije|te conte|te comente|me dijiste|me contaste|me comentaste|me decias|me contabas)\b/g;

/** «lo de esta mañana»: una cosa nombrada por CUANDO se hablo */
const THING_BY_TIME =
  /\blo (?:de|del) (?:esta mañana|esta tarde|esta noche|anoche|ayer|anteayer|antier|hoy|el otro dia|la otra noche|la otra tarde|aquel dia|aquella noche|aquella vez)\b/;

/** delante de «lo que», lo convierte en un relato: «no sabes lo que...» */
const TELLING_LEAD = /\b(?:sabes|sabias|imaginas|mira|fijate|adivina)\s+$/;

/** un verbo que pide contar, al principio de la clausula: «dime de que hablamos» */
const LEADING_REQUEST = /^(?:dime|cuentame|recuerdame|me dices|me cuentas)\s+/;

function conversationQuestionAt(text: string, inicio: number, fin: number): boolean {
  const { from, to } = sentenceBounds(text, inicio, fin);
  const oracion = text.slice(from, to);
  const antes = text.slice(from, inicio);
  const despues = text.slice(fin, to);
  const arranque = clauseLead(antes).replace(LEADING_FILLER, '');
  if (LEADING_REQUEST.test(arranque) && arranque.replace(LEADING_REQUEST, '') === '') return true;
  return arranque === '' && isQuestionClause(oracion, antes, despues);
}

/** true si el mensaje pregunta por lo que se dijo o se hizo juntos */
export function looksLikeConversationRecall(message: string): boolean {
  const texto = forPatterns(message);
  for (const hallado of texto.matchAll(CONVERSATION_QUESTION)) {
    const inicio = hallado.index ?? 0;
    if (conversationQuestionAt(texto, inicio, inicio + hallado[0].length)) return true;
  }
  for (const hallado of texto.matchAll(CONVERSATION_REFERENCE)) {
    const inicio = hallado.index ?? 0;
    const { from } = sentenceBounds(texto, inicio, inicio + hallado[0].length);
    if (!TELLING_LEAD.test(clauseLead(texto.slice(from, inicio)))) return true;
  }
  return THING_BY_TIME.test(texto);
}

/** true si el mensaje interpela a la memoria del personaje */
export function looksLikeMemoryRequest(message: string): boolean {
  const texto = forPatterns(message);
  for (const hallado of texto.matchAll(REMEMBER_ASK)) {
    const inicio = hallado.index ?? 0;
    if (rememberAsks(texto, inicio, inicio + hallado[0].length)) return true;
  }
  for (const hallado of texto.matchAll(REMEMBER_IMPERATIVE)) {
    const fin = (hallado.index ?? 0) + hallado[0].length;
    const { to } = sentenceBounds(texto, hallado.index ?? 0, fin);
    if (IMPERATIVE_OBJECT.test(texto.slice(fin, to))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// el principio

/**
 * lo que situa algo a partir o despues del principio: cuenta otra cosa.
 *
 * «desde que nos conocimos pienso en ti, ¿quieres ser mi novia?» y «¿te
 * acuerdas de lo que me regalaste al mes de conocernos?» nombran el principio
 * sin preguntar por el.
 */
const AFTER_ORIGIN =
  /(?:desde|despues de|antes de|al mes de|a la semana de|a los? (?:[a-z0-9]+ )?(?:dias|semanas|meses|años) de|(?:una|la|un|el) (?:semana|mes|dia) despues de|meses despues de)\s+(?:que\s+)?$/;

/** «¿Te acuerdas? Del dia que nos conocimos.»: la pregunta va sola delante */
const SOLO_RECORDAR = /^\s*¿?\s*(?:y\s+)?(?:te\s+)?(?:acuerdas|recuerdas)\s*\?\s*$/;

/** «oye, el primer dia ¿te acuerdas?»: la pregunta va detras, como coletilla */
const TRAILING_REMEMBER = /^[\s,]*¿?\s*(?:y\s+)?(?:te acuerdas|recuerdas|te acordabas)\s*\?/;

/** entre el verbo de recordar y lo nombrado, como mucho estas palabras */
const MAX_WORDS_BETWEEN = 8;

/** una frase del principio, y si solo cuenta con un verbo de recordar */
interface OriginPattern {
  /** con la bandera `g`: se miran TODAS las veces que aparece */
  pattern: RegExp;
  /**
   * solo cuenta con un verbo de recordar.
   *
   * Para frases que tambien son preguntas corrientes: «¿que tal el primer
   * dia?» del trabajo nuevo, o «¿cuando empezamos?» la peli.
   */
  soloConRecordar: boolean;
}

/**
 * frases que nombran el PRINCIPIO de lo vuestro.
 *
 * Existe porque se pidio con esas palabras —«si nombro algo de como nos
 * conocimos, que sea capaz de sacarlo exacto»—. Cada exclusion sale de una
 * frase real que disparaba sin deber:
 *
 * - «la primera vez que hablamos DE mudarnos» o «que te vi LLORAR» son la
 *   primera vez de otra cosa;
 * - «el primer dia» a secas es tambien el del trabajo nuevo, y «nuestro primer
 *   dia juntos en Paris» es un plan: sin verbo de recordar no cuentan;
 * - «como empezo todo EN la serie» es otra historia.
 */
const ORIGIN_PATTERNS: readonly OriginPattern[] = [
  { pattern: /\b(?:nos conocimos|te conoci|me conociste)\b/g, soloConRecordar: false },
  // sin el «de» delante: si lo tragaba el patron, la exclusion de «al mes de»
  // ya no lo veia y «¿te acuerdas de lo que me regalaste al mes de conocernos?»
  // traia el principio
  { pattern: /\bconocernos\b/g, soloConRecordar: true },
  {
    pattern:
      /\bla primera vez que (?:nos vimos|nos hablamos|hablamos|te vi|me hablaste|te hable|te escribi|me escribiste|nos conocimos|te conoci)\b(?!\s+(?:de|del|sobre|con|en)\b)(?!\s+[a-zñ]+(?:ar|er|ir)\b)/g,
    soloConRecordar: false,
  },
  {
    pattern:
      /\b(?:nos vimos|hablamos|nos hablamos|te vi|te conoci) por primera vez\b(?!\s+(?:de|del|sobre|con|en)\b)/g,
    soloConRecordar: false,
  },
  {
    pattern:
      /\b(?:el|del) primer dia (?:de todos|de nuestra relacion|de lo nuestro|que (?:nos conocimos|hablamos|nos vimos|te vi|te conoci|me hablaste|te hable|nos hablamos))\b/g,
    soloConRecordar: false,
  },
  {
    pattern: /\b(?:el|del|nuestro) primer dia\b(?!\s+(?:de|del|en|con|a|al|para|por|sin|que)\b)/g,
    soloConRecordar: true,
  },
  { pattern: /\bnuestra primera (?:conversacion|charla)\b/g, soloConRecordar: true },
  {
    pattern: /\bcomo empezo (?:todo|lo nuestro)(?=\s*(?:[,.;:!?)»"]|$))/g,
    soloConRecordar: false,
  },
  {
    pattern: /\b(?:como|cuando) empezamos a (?:salir|hablar|vernos|quedar)\b/g,
    soloConRecordar: true,
  },
  {
    pattern: /\b(?:como|cuando) empezamos\b(?!\s+(?:a|la|el|los|las|un|una|con|por|de)\b)/g,
    soloConRecordar: true,
  },
];

/** true si antes de lo nombrado, en la misma oracion, un verbo de recordar lo pide */
function rememberGoverns(text: string, from: number, start: number): boolean {
  const antes = text.slice(from, start);
  const cerca = (fin: number): boolean => {
    const entre = text.slice(fin, start);
    return !entre.includes('¿') && entre.trim().split(/\s+/).filter(Boolean).length <= MAX_WORDS_BETWEEN;
  };
  for (const verbo of antes.matchAll(REMEMBER_ASK)) {
    const inicio = from + (verbo.index ?? 0);
    const fin = inicio + verbo[0].length;
    if (cerca(fin) && rememberAsks(text, inicio, fin)) return true;
  }
  for (const verbo of antes.matchAll(REMEMBER_IMPERATIVE)) {
    const fin = from + (verbo.index ?? 0) + verbo[0].length;
    if (cerca(fin) && IMPERATIVE_OBJECT.test(text.slice(fin))) return true;
  }
  return false;
}

/**
 * true si lo que hay en [inicio, fin) —una frase del principio— esta PEDIDO.
 *
 * Por construccion, no por proximidad: un verbo de recordar que lo gobierna, un
 * «¿te acuerdas?» suelto, un «cuentame» pegado, o una pregunta que empieza por
 * «como», «cuando» o «donde» justo delante —o por la propia frase—. Mirar si
 * habia un «?» en la oracion dejaba pasar «pq no te conoci antes?» y «¿vamos al
 * bar donde nos conocimos?».
 */
function originAsked(text: string, start: number, end: number, soloConRecordar: boolean): boolean {
  const { from, to } = sentenceBounds(text, start, end);
  const oracion = text.slice(from, to);
  const antes = text.slice(from, start);
  const despues = text.slice(end, to);

  if (AFTER_ORIGIN.test(antes)) return false;
  if (rememberGoverns(text, from, start)) return true;
  if (TRAILING_REMEMBER.test(despues)) return true;
  if (SOLO_RECORDAR.test(previousSentence(text, from))) return true;
  if (soloConRecordar) return false;

  for (const verbo of antes.matchAll(REQUEST_VERB)) {
    const fin = from + (verbo.index ?? 0) + verbo[0].length;
    if (REQUEST_BRIDGE.test(text.slice(fin, start))) return true;
  }
  if (/^\s*,?\s*(?:cuentamelo|cuentame|dimelo|recuerdamelo)\b/.test(despues)) return true;

  const arranque = clauseLead(antes).replace(LEADING_FILLER, '');
  const interrogativo = /^(?:como|cuando|donde)(?:\s+fue\s+que)?\s+$/.test(arranque);
  if (interrogativo && /^[\s.!]*$/.test(despues)) return true;
  if ((interrogativo || arranque === '') && isQuestionClause(oracion, antes, despues)) return true;

  // «¿que te dije el primer dia que hablamos?»: una pregunta por lo dicho aquel dia
  for (const hallado of oracion.matchAll(CONVERSATION_QUESTION)) {
    const inicio = from + (hallado.index ?? 0);
    if (conversationQuestionAt(text, inicio, inicio + hallado[0].length)) return true;
  }
  return false;
}

/** true si el mensaje NOMBRA como empezo lo vuestro, pregunte o no */
export function looksLikeOriginRecall(message: string): boolean {
  const texto = forPatterns(message);
  return ORIGIN_PATTERNS.some(({ pattern }) => [...texto.matchAll(pattern)].length > 0);
}

/**
 * true si el mensaje PREGUNTA o PIDE como empezo lo vuestro.
 *
 * Nombrarlo no basta: «desde el primer dia supe que me gustabas» lo cuenta, no
 * lo pide. Ver `originAsked`.
 */
export function looksLikeOriginQuestion(message: string): boolean {
  const texto = forPatterns(message);
  return ORIGIN_PATTERNS.some(({ pattern, soloConRecordar }) => {
    for (const hallado of texto.matchAll(pattern)) {
      const inicio = hallado.index ?? 0;
      if (originAsked(texto, inicio, inicio + hallado[0].length, soloConRecordar)) return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// elegir entre momentos

/**
 * palabras que no dicen DE QUE se hablo.
 *
 * Para elegir entre los momentos de un dia se buscan las palabras del mensaje,
 * pero sin estas: «¿de que hablamos ayer?» contiene «hablamos» y «ayer», y
 * buscarlas preferiria el momento en que alguien dijo «ayer» sobre el mas largo.
 * Tampoco apelativos ni muletillas: «amor» o «corazon» salen en todos.
 */
const NOT_CONTENT = new Set([
  'que', 'del', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'con', 'por', 'para',
  'sobre', 'nos', 'mis', 'tus', 'sus', 'mia', 'mio', 'muy', 'tan', 'mas', 'esto',
  'eso', 'esa', 'ese', 'esas', 'esos', 'esta', 'este', 'estas', 'estos', 'aquello',
  'aquel', 'aquella', 'algo', 'todo', 'nada', 'otro', 'otra', 'cuando', 'como',
  'donde', 'hablamos', 'hablaste', 'hable', 'hablo', 'hablabamos', 'hablando',
  'hablado', 'dijiste', 'dije', 'dijo', 'dijimos', 'dicho', 'decias', 'contaste',
  'conte', 'contabas', 'contado', 'comentamos', 'comentaste', 'preguntaste',
  'pregunte', 'pregunta', 'preguntas', 'preguntar', 'mensaje', 'conversacion',
  'charla', 'acuerdas', 'acuerda', 'acuerdo', 'recuerdas', 'recuerda', 'recuerdo',
  'acuerdate', 'recuerdame', 'acordabas', 'acordar', 'recordar', 'cuentame', 'dime',
  'hablame', 'sabes', 'oye', 'mira', 'pues', 'venga', 'hola', 'buenas', 'estabamos',
  'estaba', 'estuve', 'estuvimos', 'hicimos', 'fuimos', 'paso', 'pasa', 'final',
  'ayer', 'anteayer', 'antier', 'hoy', 'anoche', 'anteanoche', 'antenoche', 'mañana',
  'tarde', 'noche', 'madrugada', 'mediodia', 'finde', 'semana', 'pasado', 'pasada',
  'ultimo', 'ultima', 'dia', 'dias', 'lunes', 'martes', 'miercoles', 'jueves',
  'viernes', 'sabado', 'domingo', 'hace', 'antes', 'despues', 'luego', 'ahora',
  'siempre', 'nunca', 'tambien', 'solo', 'vez', 'entonces', 'dos', 'tres', 'cuatro',
  'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'amor', 'cariño', 'carino',
  'corazon', 'cielo', 'vida', 'guapa', 'guapo', 'nena', 'nene', 'bebe', 'tonta',
  'tonto', 'princesa', 'reina', 'rey', 'bonita', 'bonito', 'preciosa', 'precioso',
  'porfa', 'vale', 'bueno',
]);

/** risas escritas: «jajaja», «jajaj», «ajaja», «jejeje», «haha» */
const RISA = /^(?:(?:j+[aeiou]+)+j*|a(?:j+a+)+j*|(?:h+[aeiou]+){2,}h*)$/;

/** clave estable de un episodio: su conversacion y su primer turno */
function episodeKey(episode: Episode): string {
  return `${episode.conversationId}#${episode.from}`;
}

/** true si el episodio ya viaja en el prompt como historial reciente */
export function isAlreadyInPrompt(episode: Episode, window: RecentWindow | undefined): boolean {
  return (
    window !== undefined &&
    episode.conversationId === window.conversationId &&
    episode.from >= window.fromSequence
  );
}

function oldestOf(episodes: readonly Episode[]): Episode | null {
  // no se da por hecho el orden de la lista: se busca el mas antiguo
  let primero: Episode | null = null;
  for (const episode of episodes) {
    if (primero === null || episode.startedAt < primero.startedAt) primero = episode;
  }
  return primero;
}

/** en que parte del dia local empezo un momento */
function partOfDay(iso: string, timeZone: string): PartOfDay {
  const hora = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(iso),
    ),
  );
  if (hora < 6) return 'madrugada';
  if (hora < 13) return 'mañana';
  if (hora < 21) return 'tarde';
  return 'noche';
}

/**
 * el dia por el que se pregunta, si se pregunta por lo que se dijo en el.
 *
 * Una fecha SOLA no basta: tiene que preguntarse por algo dicho, o por su
 * memoria. Si no, «hoy me duele la cabeza» sacaria la transcripcion de hoy.
 */
function dateReferenceFor(message: string, anchor: TemporalAnchor): TemporalReference | null {
  const preguntaPorLoDicho =
    looksLikeMemoryRequest(message) || looksLikeConversationRecall(message);
  if (!preguntaPorLoDicho) return null;
  const cuando = resolveTemporalReference(message, anchor);
  // «cuando nos conocimos» tambien es una referencia temporal, pero sin dia: la
  // recoge el camino del principio
  if (cuando === null || cuando.kind === 'principio') return null;
  return cuando;
}

function episodesWithin(episodes: readonly Episode[], cuando: TemporalReference): Episode[] {
  return episodes.filter(
    (episode) => episode.startedAt >= cuando.from && episode.startedAt < cuando.to,
  );
}

/**
 * de varios candidatos, el que señalan las palabras del mensaje; si no señalan
 * ninguno con claridad, el mas largo.
 *
 * El diagnostico sobre la boveda real dio 40 momentos en 6 dias: casi siete por
 * dia. «¿de que hablamos ayer?» no dice cual, y el mas largo es la mejor
 * apuesta; «lo del faro que hablamos ayer» si lo dice.
 */
function pickPreferred(
  candidates: readonly Episode[],
  preference: ReadonlyMap<string, number>,
): Episode | null {
  const ordenados = [...candidates].sort((a, b) => {
    const porPalabras =
      (preference.get(episodeKey(b)) ?? 0) - (preference.get(episodeKey(a)) ?? 0);
    return porPalabras !== 0 ? porPalabras : b.turns - a.turns;
  });
  return ordenados[0] ?? null;
}

// ---------------------------------------------------------------------------
// los caminos

/** que camino recoge el mensaje, y con que */
export type RecallRoute =
  | { kind: 'principio'; episode: Episode }
  | { kind: 'fecha'; candidates: Episode[] }
  | { kind: 'palabras' }
  | { kind: 'ninguno' };

/**
 * decide que camino transcribe, sin tocar la boveda.
 *
 * Pura para que el diagnostico la ejerza TAL CUAL: una copia de la logica podria
 * dar verde mientras la de verdad falla. El orden importa:
 *
 * 1. EL PRINCIPIO, antes que la fecha porque «cuando nos conocimos» no tiene dia
 *    que buscar, y antes que las palabras porque «conocimos» no aparece en lo
 *    que se dijo aquel dia. Si el primero ya va en el prompt, no se cae a las
 *    palabras —citarian un momento cualquiera—, pero una fecha del mismo
 *    mensaje sigue valiendo;
 * 2. LA FECHA, antes que las palabras: «¿de que hablamos el jueves?» no tiene
 *    ninguna palabra en comun con lo que se dijo ese jueves. Lo que ya va en el
 *    prompt se descarta ANTES de elegir: si hoy hubo otro momento, «¿de que
 *    hablamos hoy?» trae ese;
 * 3. LAS PALABRAS, solo si se pide rememorar.
 */
export function recallRoute(
  all: readonly Episode[],
  message: string,
  anchor: TemporalAnchor | undefined,
  window: RecentWindow | undefined,
): RecallRoute {
  let sinPalabras = false;
  if (looksLikeOriginQuestion(message)) {
    const primero = oldestOf(all);
    if (primero !== null && !isAlreadyInPrompt(primero, window)) {
      return { kind: 'principio', episode: primero };
    }
    sinPalabras = true;
  }

  const cuando = anchor === undefined ? null : dateReferenceFor(message, anchor);
  if (cuando !== null) {
    const candidates = episodesWithin(all, cuando).filter(
      (episode) => !isAlreadyInPrompt(episode, window),
    );
    if (candidates.length > 0) return { kind: 'fecha', candidates };
  }

  if (!sinPalabras && looksLikeMemoryRequest(message)) return { kind: 'palabras' };
  return { kind: 'ninguno' };
}

/**
 * el episodio del dia al que se refiere el mensaje, o null.
 *
 * La usa el diagnostico para su prueba por fecha. Compone las mismas piezas que
 * el camino real —dateReferenceFor, episodesWithin y pickPreferred— sobre TODOS
 * los episodios, no solo los del indice. `preference` puntua episodios por las
 * palabras del mensaje; sin ella gana el mas largo.
 */
export function selectEpisodeForDate(
  episodes: readonly Episode[],
  message: string,
  anchor: TemporalAnchor,
  preference: ReadonlyMap<string, number> = new Map(),
): Episode | null {
  const cuando = dateReferenceFor(message, anchor);
  if (cuando === null) return null;
  return pickPreferred(episodesWithin(episodes, cuando), preference);
}

/** el primer episodio de todos, si el mensaje pregunta por como empezo */
export function selectOriginEpisode(episodes: readonly Episode[], message: string): Episode | null {
  return looksLikeOriginQuestion(message) ? oldestOf(episodes) : null;
}

/**
 * los episodios que van como LINEAS de indice, y cuantos se quedan fuera.
 *
 * Los mas recientes, y el PRIMERO siempre. El diagnostico sobre la boveda real
 * dio 40 momentos con un tope de 40: la conversacion siguiente habria sacado del
 * indice el dia en que se conocieron, que es justo lo que mas se pregunta.
 * Fijarlo cuesta una linea.
 *
 * `all` va del mas reciente al mas antiguo, como lo devuelve `listEpisodes`.
 */
export function selectIndexEpisodes(
  all: readonly Episode[],
  cap: number,
): { visible: Episode[]; omitted: number } {
  if (cap <= 0) return { visible: [], omitted: all.length };
  if (all.length <= cap) return { visible: [...all], omitted: 0 };
  if (cap === 1) return { visible: all.slice(0, 1), omitted: all.length - 1 };
  return {
    visible: [...all.slice(0, cap - 1), ...all.slice(-1)],
    omitted: all.length - cap,
  };
}

/** las palabras sueltas de un texto, ya normalizadas */
function wordsOf(text: string): string[] {
  return forPatterns(text)
    .split(/[^a-z0-9ñ]+/u)
    .filter((word) => word.length > 0);
}

/** lo que queda del mensaje al quitarle lo que no dice de que se hablo */
function contentQuery(message: string, ignore: ReadonlySet<string>): string {
  return wordsOf(message)
    .filter(
      (word) =>
        word.length >= 3 && !NOT_CONTENT.has(word) && !ignore.has(word) && !RISA.test(word),
    )
    .join(' ');
}

/**
 * puntua los CANDIDATOS por cuantos de sus turnos casan con las palabras con
 * contenido del mensaje.
 *
 * Se cuentan turnos, no posiciones: el momento que habla del faro en tres
 * turnos gana al que lo nombra una vez de pasada. Y solo decide si hay un
 * ganador claro; con un empate arriba no dice nada y gana el mas largo.
 */
async function lexicalPreference(
  memory: PrivateMemory,
  vault: VaultService,
  message: string,
  characterId: string | null,
  candidates: readonly Episode[],
  ignore: ReadonlySet<string>,
): Promise<Map<string, number>> {
  const query = contentQuery(message, ignore);
  if (query.length === 0) return new Map();

  const keys = new Set(candidates.map(episodeKey));
  const matches = await memory.search(vault, query, {
    limit: PREFERENCE_SEARCH_LIMIT,
    characterId,
    conversationIds: new Set(candidates.map((candidate) => candidate.conversationId)),
  });
  const cuenta = new Map<string, number>();
  for (const match of matches) {
    if (match.episode === undefined) continue;
    const key = episodeKey(match.episode);
    if (!keys.has(key)) continue;
    cuenta.set(key, (cuenta.get(key) ?? 0) + 1);
  }

  const puntos = candidates
    .map((candidate) => cuenta.get(episodeKey(candidate)) ?? 0)
    .sort((a, b) => b - a);
  const [primero = 0, segundo = 0] = puntos;
  return primero > segundo ? cuenta : new Map();
}

/**
 * arma lo que el personaje recuerda en este turno.
 *
 * El identificador que ve el modelo es corto y posicional (`r1`, `r2`): no hace
 * falta que vea un uuid de conversacion, y asi el prompt no lleva nada que no
 * necesite.
 */
export async function buildRecall(
  memory: PrivateMemory,
  vault: VaultService,
  message: string,
  options: RecallOptions = {},
): Promise<VaultRecall> {
  const all = await memory.listEpisodes(vault, options.characterId ?? null);
  if (all.length === 0) return { episodes: [], quoted: null };

  const anchor = options.anchor;
  const window = options.alreadyInPrompt;
  const ignore = new Set((options.ignoreWords ?? []).flatMap((word) => wordsOf(word)));
  const { visible, omitted } = selectIndexEpisodes(
    all,
    options.maxEpisodeLines ?? MAX_EPISODE_LINES,
  );
  const primero = oldestOf(all);

  // el dia CIVIL local, no el UTC. Ver `anchor` en RecallOptions: cortar el ISO
  // fechaba mal todo lo hablado de madrugada
  const dayOf = (episode: Episode): string =>
    anchor === undefined ? episode.startedAt.slice(0, 10) : civilDayLabel(episode.startedAt, anchor);
  const whenOf = (episode: Episode): PartOfDay | undefined =>
    anchor === undefined ? undefined : partOfDay(episode.startedAt, anchor.timeZone);
  const lineFor = (episode: Episode, id: string): RecalledEpisodeLine => ({
    id,
    date: dayOf(episode),
    title: episode.title,
    turns: episode.turns,
    // el primero lleva su resumen: cualquier forma de preguntar como os
    // conocisteis tiene respuesta aunque ningun patron la reconozca
    ...(primero !== null &&
    episodeKey(episode) === episodeKey(primero) &&
    episode.summary !== undefined &&
    episode.summary.length > 0
      ? { summary: episode.summary }
      : {}),
  });
  const lines = visible.map((episode, position) => lineFor(episode, `r${position + 1}`));
  const base: VaultRecall =
    omitted > 0 ? { episodes: lines, quoted: null, omitted } : { episodes: lines, quoted: null };

  // se cita aunque su linea no este en el indice: el tope limita lo que ve
  // siempre, no lo que puede recordar
  const quote = async (
    episode: Episode,
    via: RecallVia,
    extra: Pick<QuotedEpisode, 'sameDay' | 'sameDayTotal' | 'pickedBy'> = {},
    /** el turno que se buscaba, si se sabe: la transcripcion va alrededor de el */
    anchorSequence?: number,
  ): Promise<VaultRecall> => {
    const position = visible.findIndex((candidate) => episodeKey(candidate) === episodeKey(episode));
    const listed = position >= 0;
    const line = listed ? lines[position]! : lineFor(episode, `r${lines.length + 1}`);
    const turns = await memory.readEpisode(vault, episode);
    const when = whenOf(episode);
    const trozo = quoteWindow(turns, anchorSequence, options.maxQuotedTurns ?? MAX_QUOTED_TURNS);
    const entero = trozo.first === 1 && trozo.last >= turns.length;
    const quoted: QuotedEpisode = {
      ...line,
      via,
      listed,
      ...(when === undefined ? {} : { when }),
      conversation: trozo.kept,
      // si no va entero se le dice: sin saberlo, tomaba el trozo por el momento
      // y rellenaba lo que faltaba
      ...(entero ? {} : { excerpt: { first: trozo.first, last: trozo.last, total: turns.length } }),
      ...extra,
    };
    return { ...base, quoted };
  };

  const route = recallRoute(all, message, anchor, window);

  if (route.kind === 'principio') return quote(route.episode, 'principio');

  if (route.kind === 'fecha') {
    const preference =
      route.candidates.length > 1
        ? await lexicalPreference(
            memory,
            vault,
            message,
            options.characterId ?? null,
            route.candidates,
            ignore,
          )
        : new Map<string, number>();
    const elegido = pickPreferred(route.candidates, preference);
    if (elegido === null) return base;
    // «ese mismo dia» es el dia civil ENTERO, no solo los candidatos: con «ayer
    // por la tarde» los candidatos son los de la tarde, y decir que no hubo mas
    // olvidaria el de la mañana que el indice si enseña
    const hermanos = all
      .filter(
        (episode) =>
          episodeKey(episode) !== episodeKey(elegido) &&
          dayOf(episode) === dayOf(elegido) &&
          !isAlreadyInPrompt(episode, window),
      )
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    if (hermanos.length === 0) return quote(elegido, 'fecha');
    return quote(elegido, 'fecha', {
      sameDay: hermanos.slice(0, MAX_SAME_DAY).map((other) => {
        const when = whenOf(other);
        return {
          title: other.title,
          turns: other.turns,
          ...(when === undefined ? {} : { when }),
        };
      }),
      sameDayTotal: hermanos.length,
      pickedBy: preference.has(episodeKey(elegido)) ? 'palabras' : 'mas-largo',
    });
  }

  if (route.kind === 'palabras') {
    const matches = await memory.search(vault, message, {
      limit: 5,
      characterId: options.characterId ?? null,
    });
    for (const match of matches) {
      const episode = match.episode;
      // lo que ya va como historial reciente no se transcribe otra vez
      if (episode === undefined || isAlreadyInPrompt(episode, window)) continue;
      // alrededor del turno que caso, no desde el principio del momento
      return quote(episode, 'palabras', {}, match.sequence);
    }
  }

  return base;
}

/** turnos de contexto que se transcriben antes del que se buscaba */
const CONTEXT_BEFORE = 3;

/**
 * el trozo del episodio que se transcribe, y donde cae dentro de el.
 *
 * Por el PRINCIPIO —quien pregunta por un momento quiere como fue, no como
 * acabo—, salvo que se sepa que turno se buscaba: entonces alrededor de ESE
 * turno, con unos pocos de antes. Paso de verdad: «¿de verdad no te acuerdas de
 * lo del baño de la facultad?» encontro el momento, pero se transcribian sus
 * doce primeros turnos y lo que se buscaba estaba mas adelante. Ella no lo vio y
 * relleno el hueco inventando.
 *
 * Siempre entra al menos un turno, aunque pase del tope de caracteres: si no, un
 * turno muy largo dejaba la transcripcion vacia justo cuando era el buscado.
 */
function quoteWindow(
  turns: readonly { sequence: number; role: 'user' | 'assistant'; text: string }[],
  anchorSequence: number | undefined,
  maxTurns: number,
): { kept: { role: 'user' | 'assistant'; text: string }[]; first: number; last: number } {
  const collect = (start: number): { role: 'user' | 'assistant'; text: string }[] => {
    const kept: { role: 'user' | 'assistant'; text: string }[] = [];
    let characters = 0;
    for (const turn of turns.slice(start, start + maxTurns)) {
      if (kept.length > 0 && characters + turn.text.length > MAX_QUOTED_CHARS) break;
      characters += turn.text.length;
      kept.push({ role: turn.role, text: turn.text });
    }
    return kept;
  };

  const buscado =
    anchorSequence === undefined ? -1 : turns.findIndex((turn) => turn.sequence === anchorSequence);
  let start = buscado < 0 ? 0 : Math.max(0, buscado - CONTEXT_BEFORE);
  let kept = collect(start);
  if (buscado >= 0 && start + kept.length <= buscado) {
    // con los de antes no cabia: se empieza en el mismo turno buscado
    start = buscado;
    kept = collect(start);
  }
  return { kept, first: start + 1, last: start + kept.length };
}
