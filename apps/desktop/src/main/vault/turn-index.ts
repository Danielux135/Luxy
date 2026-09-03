// indice de busqueda sobre los turnos de las conversaciones privadas.
//
// Por que existe: los turnos YA estan en disco, cifrados y numerados. El primer
// dia de una conversacion esta ahi palabra por palabra. El problema nunca fue
// guardarlo, sino encontrarlo (`D-058`). Esto es lo que lo encuentra.
//
// Es PURO: recibe turnos ya descifrados y no toca disco, ni red, ni reloj. Toda
// la E/S —abrir la boveda, descifrar, decidir que conversaciones entran— vive
// fuera. Asi cada caso limite se prueba sin montar una boveda, que es donde
// estan los errores de este tipo de codigo.
//
// **Vive en memoria y solo en memoria.** Un indice de terminos en claro escrito
// en disco filtraria el contenido de la boveda con solo mirarlo: se veria de que
// habla cada conversacion sin descifrar nada. Quien lo construya esta obligado a
// llamar a `clear()` al cerrar la boveda; guardarlo seria deshacer la premisa
// entera de la seccion privada.
//
// No usa embeddings a proposito. Calcularlos exige un modelo, y uno remoto
// sacaria el contenido del equipo. El lexico es determinista, se prueba sin red
// y para este volumen sobra: la conversacion mas larga medida son 116 KB.

/** un turno ya descifrado, tal y como entra al indice */
export interface IndexedTurn {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
}

export interface TurnMatch {
  conversationId: string;
  sequence: number;
  /** mayor es mejor; solo tiene sentido comparado con los de la misma busqueda */
  score: number;
}

export interface SearchOptions {
  limit?: number;
  /**
   * conversaciones que pueden salir. `undefined` las admite todas.
   *
   * Lo necesita el alcance por personaje y la exclusion de conversaciones del
   * banco de recuerdos: hay hilos que no deberian volver nunca.
   */
  only?: ReadonlySet<string>;
}

const DEFAULT_LIMIT = 10;

/** por debajo de tres letras casi todo es ruido en español */
const MIN_TERM_LENGTH = 3;

/**
 * palabras vacias del español.
 *
 * No pretende ser exhaustiva: quita lo que aparece en casi todos los turnos y
 * por tanto no distingue ninguno. Una palabra de mas en esta lista solo cuesta
 * un poco de precision; una de menos, un poco de ruido.
 */
const STOPWORDS = new Set([
  'que', 'los', 'las', 'del', 'con', 'por', 'para', 'una', 'uno', 'unos', 'unas',
  'como', 'pero', 'sus', 'sin', 'sobre', 'entre', 'cuando', 'muy', 'mas', 'este',
  'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'algo', 'nada',
  'todo', 'toda', 'todos', 'todas', 'porque', 'donde', 'quien', 'cual', 'ser',
  'estar', 'haber', 'tener', 'hacer', 'era', 'eran', 'fue', 'han', 'has', 'hay',
  'les', 'nos', 'mis', 'tus', 'les', 'ella', 'ellos', 'ellas', 'usted', 'yo',
  'ya', 'asi', 'aun', 'tan', 'tanto', 'solo', 'tambien', 'desde', 'hasta',
  'antes', 'despues', 'ahora', 'siempre', 'nunca', 'otro', 'otra', 'otros',
  'otras', 'mismo', 'misma', 'poco', 'mucho', 'mucha', 'bien', 'vez', 'veces',
]);

/**
 * normaliza una palabra para compararla.
 *
 * Quita acentos, porque «cómo» y «como» son la misma palabra al buscar y nadie
 * escribe las tildes en una caja de busqueda.
 *
 * La eñe se conserva: descomponerla la convertiria en «n» y «año» pasaria a ser
 * «ano», que es otra palabra distinta y bastante desafortunada.
 */
const ENYE_SENTINEL = '';

export function normalizeTerm(word: string): string {
  return word
    .toLowerCase()
    // se aparta antes de descomponer y se devuelve despues: `split`/`join` en
    // vez de una expresion regular, que con un caracter de control seria ilegible
    .split('ñ')
    .join(ENYE_SENTINEL)
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .split(ENYE_SENTINEL)
    .join('ñ');
}

/**
 * sufijos que se recortan, del mas largo al mas corto.
 *
 * El orden importa: «presentaciones» debe perder «aciones» entera y no quedarse
 * a medias por haber probado «es» primero.
 */
const SUFFIXES = [
  'amientos', 'imientos', 'amiento', 'imiento',
  'aciones', 'iciones', 'acion', 'icion',
  'adores', 'adoras', 'ador', 'adora',
  'antes', 'entes', 'mente',
  'abamos', 'iamos', 'aremos', 'eremos', 'iremos',
  'aban', 'abas', 'aba', 'ian', 'ias',
  'aron', 'ieron', 'aste', 'iste', 'amos', 'emos', 'imos',
  'ando', 'iendo', 'ados', 'idos', 'ado', 'ido', 'ada', 'ida',
  'ares', 'eres', 'ires', 'ar', 'er', 'ir',
  'dades', 'dad', 'ezas', 'eza',
  'es', 's',
  // las terminaciones de una letra van al final y obligan a la segunda pasada:
  // «presenta» debe llegar a la misma raiz que «presentamos»
  'a', 'o', 'e',
];

/**
 * pasadas de recorte.
 *
 * Dos, y no una: «vainillas» pierde primero la «s» y despues la «a», que es lo
 * que la deja en la misma raiz que «vainilla». Con una sola pasada, el singular
 * y el plural acabarian en raices distintas, que es peor que no recortar nada.
 */
const STEM_PASSES = 2;

/**
 * longitud minima de la raiz que queda tras recortar.
 *
 * Sin este suelo, «mar» y «mares» acabarian en cosas distintas y palabras
 * cortas quedarian irreconocibles. Cuatro deja «conoc», «present» y «vainill»
 * intactos y protege lo demas.
 */
const MIN_STEM_LENGTH = 4;

/**
 * raiz aproximada de una palabra ya normalizada.
 *
 * NO es un stemmer completo del español: es un recorte de sufijos regulares.
 * Cubre la morfologia previsible —«presentamos», «presentacion» y «presentar»
 * caen en la misma raiz— y **no alcanza los verbos irregulares**: «vengo» y
 * «venias» siguen siendo cosas distintas, porque ahi cambia la raiz y no el
 * sufijo. Eso ultimo no lo arregla ningun recorte, y es parte de por que hacen
 * falta etiquetas (`D-058`).
 *
 * Se prefiere quedarse corto a pasarse: una raiz demasiado agresiva junta
 * palabras que no tienen nada que ver y ensucia todas las busquedas.
 */
export function stem(term: string): string {
  let current = term;
  for (let pass = 0; pass < STEM_PASSES; pass += 1) {
    const shorter = stripOnce(current);
    if (shorter === current) break;
    current = shorter;
  }
  return current;
}

function stripOnce(term: string): string {
  for (const suffix of SUFFIXES) {
    if (!term.endsWith(suffix)) continue;
    const root = term.slice(0, term.length - suffix.length);
    if (root.length >= MIN_STEM_LENGTH) return root;
  }
  return term;
}

/**
 * parte un texto en terminos indexables, ya reducidos a su raiz.
 *
 * Los asteriscos de la accion —«*se rie*»— y la puntuacion desaparecen: son
 * separadores, no contenido.
 */
export function tokenize(text: string): string[] {
  const terms: string[] = [];
  for (const raw of normalizeTerm(text).split(/[^a-z0-9ñ]+/)) {
    if (raw.length < MIN_TERM_LENGTH) continue;
    // las vacias se descartan por su forma escrita, antes de recortar: la raiz
    // de una palabra vacia puede coincidir con la de una que si importa
    if (STOPWORDS.has(raw)) continue;
    terms.push(stem(raw));
  }
  return terms;
}

function keyOf(conversationId: string, sequence: number): string {
  return `${conversationId}#${sequence}`;
}

/**
 * indice invertido de termino a turnos.
 *
 * La puntuacion es un TF-IDF corto: un termino que aparece en pocos turnos vale
 * mas que uno que aparece en todos. Es lo que hace que «conocimos» pese y
 * «quiero» no, sin mantener a mano una lista de palabras importantes.
 */
export class TurnIndex {
  /** termino -> (clave de turno -> veces que aparece) */
  private readonly postings = new Map<string, Map<string, number>>();
  private readonly turns = new Map<string, IndexedTurn>();

  get size(): number {
    return this.turns.size;
  }

  /** terminos distintos indexados; util para diagnosticar, no para buscar */
  get termCount(): number {
    return this.postings.size;
  }

  add(turn: IndexedTurn): void {
    const key = keyOf(turn.conversationId, turn.sequence);
    // reindexar el mismo turno no debe duplicar sus apariciones
    if (this.turns.has(key)) this.remove(turn.conversationId, turn.sequence);
    this.turns.set(key, turn);

    for (const term of tokenize(turn.text)) {
      let posting = this.postings.get(term);
      if (posting === undefined) {
        posting = new Map();
        this.postings.set(term, posting);
      }
      posting.set(key, (posting.get(key) ?? 0) + 1);
    }
  }

  addAll(turns: readonly IndexedTurn[]): void {
    for (const turn of turns) this.add(turn);
  }

  remove(conversationId: string, sequence: number): void {
    const key = keyOf(conversationId, sequence);
    if (!this.turns.delete(key)) return;
    for (const [term, posting] of this.postings) {
      posting.delete(key);
      if (posting.size === 0) this.postings.delete(term);
    }
  }

  /** quita una conversacion entera. La usa borrar una conversacion */
  removeConversation(conversationId: string): void {
    for (const turn of [...this.turns.values()]) {
      if (turn.conversationId === conversationId) this.remove(conversationId, turn.sequence);
    }
  }

  /**
   * vacia el indice.
   *
   * OBLIGATORIO al cerrar la boveda: aqui dentro hay texto en claro, y una
   * boveda cerrada que siga teniendo su contenido accesible en memoria no esta
   * cerrada.
   */
  clear(): void {
    this.postings.clear();
    this.turns.clear();
  }

  /** el turno indexado, si sigue estando */
  get(conversationId: string, sequence: number): IndexedTurn | undefined {
    return this.turns.get(keyOf(conversationId, sequence));
  }

  search(query: string, options: SearchOptions = {}): TurnMatch[] {
    const terms = new Set(tokenize(query));
    if (terms.size === 0 || this.turns.size === 0) return [];

    const total = this.turns.size;
    const scores = new Map<string, number>();

    for (const term of terms) {
      const posting = this.postings.get(term);
      if (posting === undefined) continue;
      // un termino que sale en todos los turnos no distingue ninguno: su idf
      // tiende a cero y deja de puntuar solo, sin necesidad de listarlo
      const idf = Math.log(1 + total / posting.size);
      if (idf <= 0) continue;

      for (const [key, frequency] of posting) {
        const turn = this.turns.get(key);
        if (turn === undefined) continue;
        if (options.only !== undefined && !options.only.has(turn.conversationId)) continue;
        // repetir una palabra suma, pero cada vez menos: un turno que la dice
        // veinte veces no vale veinte veces mas que uno que la dice una
        scores.set(key, (scores.get(key) ?? 0) + idf * (1 + Math.log(frequency)));
      }
    }

    return [...scores.entries()]
      .map(([key, score]) => {
        const turn = this.turns.get(key)!;
        return { conversationId: turn.conversationId, sequence: turn.sequence, score };
      })
      // a igualdad de puntuacion, el turno mas antiguo primero: al rememorar
      // interesa el origen de algo, no su ultima mencion
      .sort((a, b) => b.score - a.score || a.sequence - b.sequence)
      .slice(0, options.limit ?? DEFAULT_LIMIT);
  }
}
