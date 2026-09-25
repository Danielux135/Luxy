// cuanto de una respuesta suya es copia de sus respuestas anteriores.
//
// Existe para poder MEDIR la autocopia en vez de describirla. Sus ultimas
// respuestas viajan literales en cada prompt (`VAULT_RECENT_TURNS`), y lo
// observado en una conversacion real —aperturas, pausas y cierres identicos
// letra por letra en respuestas separadas por una— solo se explica teniendolas
// delante. Sin una cifra por turno, cualquier cambio contra eso (temperatura,
// una instruccion de forma) se juzgaria leyendo conversaciones a ojo.
//
// PURA y sin E/S, como el resto del paquete. Y sin importar `vault-prompt.js`:
// la cola que viaja se recibe por parametro, para no arrastrar el ciclo del que
// avisa ese archivo con `vault-recap.ts`.
//
// Lo que sale de aqui son CUENTAS y nada mas. Los grupos de palabras viven en un
// `Set` local que muere con la llamada: ni texto ni huellas, porque una huella de
// seis palabras se adivina por diccionario.

/** turno minimo que hace falta para medir; el de la boveda lo cumple */
export interface SelfCopyTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * cuantas palabras forman un grupo.
 *
 * Seis, como pide el encargo del medidor; el plan de `ROLEPLAY-EVOLUCION.md`
 * decia cinco. Cuanto mas largo el grupo, menos coincidencias por pura gramatica
 * entre textos que no se copian, y menos copias vistas cuando cambia una palabra:
 * el reparto entre las dos cosas no se ha medido. Cambiarlo rompe la comparacion
 * con todo lo ya registrado, por eso el registro lleva el valor al lado.
 */
export const SELF_COPY_NGRAM = 6;

/**
 * cuantas palabras cuentan como apertura o como cierre.
 *
 * Doce cubren la acotacion de entrada o de salida tipica —una o dos frases— sin
 * llegar al cuerpo de la respuesta, que es donde la escena si cambia.
 */
export const SELF_COPY_EDGE_WORDS = 12;

/**
 * texto reducido a palabras comparables.
 *
 * Minusculas y sin tildes, y todo lo que no es letra ni cifra pasa a separar
 * palabras: asteriscos de acotacion, comillas, ¿¡, puntos suspensivos, guiones y
 * emojis. Una copia que solo cambia la puntuacion o un acento sigue siendo copia.
 *
 * La ñ se conserva, como en `vault-relation.ts`: «año» y «ano» no son la misma
 * palabra.
 */
export function normalizeForCopy(text: string): string[] {
  const lower = text.normalize('NFC').toLowerCase();
  // se parte por la ñ ANTES de descomponer: NFD la separaria en n + tilde y la
  // tilde se iria con el resto de marcas
  const folded = lower
    .split('ñ')
    .map((part) => part.normalize('NFD').replace(/\p{M}/gu, ''))
    .join('ñ');
  return folded
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((word) => word.length > 0);
}

/** contra que respuestas suyas se mide, y cuantas se apartaron del control */
export interface SelfCopyReferences {
  /** las suyas que viajan literales en el prompt de este turno */
  window: string[];
  /**
   * otras tantas suyas, las inmediatamente anteriores a la ventana.
   *
   * Es lo que el modelo NO tenia delante en este turno. NO es una referencia de
   * «cero copia»: la autocopia observada va en CADENA —cada respuesta copia de
   * las anteriores—, asi que una plantilla asentada esta tambien aqui, en las
   * antepasadas de la ventana. Con ella, ventana y control dan lo mismo justo
   * cuando la copia es maxima, y restarlos diria «no copia». Lo que el control
   * separa es la EDAD de lo copiado: lo que solo esta en la ventana es copia
   * reciente, y lo que esta en los dos, plantilla que ya venia de antes (o
   * estilo, que con 6-gramas no se distingue). Adyacentes y no las mas viejas,
   * para que la distancia en el tiempo pese lo menos posible.
   */
  control: string[];
  /** respuestas saltadas al formar el control porque viajaban citadas */
  excluded: number;
}

/**
 * separa sus respuestas anteriores en ventana y control.
 *
 * `turns` es el historial SIN el mensaje nuevo, el mismo que recibe el
 * compositor, y `recentTurns` la misma cola: la ventana es exactamente la de
 * `turns.slice(-recentTurns)`, con `recentTurns <= 0` como cola vacia.
 *
 * `quotedTexts` son sus turnos dentro de un recuerdo citado en este prompt. Esos
 * viajan LITERALES aunque sean anteriores a la ventana —un momento que empieza
 * antes y la atraviesa se puede citar entero—, asi que en el control mentirian:
 * serian «lo que no tenia delante» estando delante. Se saltan y se cuentan.
 */
export function selfCopyReferences(
  turns: readonly SelfCopyTurn[],
  recentTurns: number,
  quotedTexts: readonly string[],
): SelfCopyReferences {
  const cut = recentTurns <= 0 ? turns.length : Math.max(0, turns.length - recentTurns);
  const window = turns
    .slice(cut)
    .filter((turn) => turn.role === 'assistant')
    .map((turn) => turn.text);

  const quoted = new Set<string>();
  for (const text of quotedTexts) {
    const key = normalizeForCopy(text).join(' ');
    // una cita vacia tras normalizar no identifica nada: apartaria cualquier
    // respuesta que tambien fuera solo puntuacion
    if (key.length > 0) quoted.add(key);
  }

  const control: string[] = [];
  let excluded = 0;
  for (let index = cut - 1; index >= 0 && control.length < window.length; index -= 1) {
    const turn = turns[index];
    if (turn === undefined || turn.role !== 'assistant') continue;
    if (quoted.has(normalizeForCopy(turn.text).join(' '))) {
      excluded += 1;
      continue;
    }
    control.push(turn.text);
  }
  // en orden de conversacion, como la ventana: no cambia ninguna cifra, pero
  // quien lo lea no tiene que acordarse de que iba al reves
  control.reverse();

  return { window, control, excluded };
}

/** lo copiado de un conjunto de respuestas anteriores */
export interface SelfCopyAgainst {
  /** cuantas respuestas tenia el conjunto */
  replies: number;
  /** posiciones de la respuesta nueva cuyo grupo esta en ALGUNA de ellas */
  copied: number;
  /**
   * la tirada de palabras seguidas mas larga compartida con UNA de ellas.
   *
   * Puede quedar por debajo del tamaño de grupo: es la cifra continua, y cuatro
   * palabras seguidas en comun es normal entre dos textos cualesquiera.
   */
  longestRun: number;
  /** cuantas de ellas comparten al menos un grupo al PRINCIPIO con la nueva */
  openings: number;
  /** cuantas de ellas comparten al menos un grupo al FINAL con la nueva */
  closings: number;
}

export interface SelfCopyMeasure {
  /**
   * cuantas posiciones de grupo tiene la respuesta nueva (palabras - n + 1).
   *
   * Se registran cuentas y no porcentajes porque las cuentas se suman: la tasa de
   * una conversacion entera o de un modelo es Σcopied / Σngrams, sin que las
   * respuestas cortas pesen igual que las largas.
   */
  ngrams: number;
  /**
   * lo copiado de lo que tenia delante. Es la cifra principal: `copied/ngrams`
   * de la ventana, sumado por bloques, es lo que se compara con el interruptor
   * encendido y apagado.
   *
   * Y tiene un punto ciego que el propio tratamiento empuja a usar: la nota de
   * forma pide cambiar frases y gestos, y una plantilla rehecha con sinonimos da
   * cero en `copied`, `openings` y `closings`, lo mismo que una respuesta sin
   * copia. Ninguna medida por palabras lo arregla: el solape de palabras de
   * contenido en los bordes se probo con texto inventado y da lo mismo a la
   * parafrasis que a una respuesta libre que por azar abre y cierra parecido.
   * Con la nota encendida, que baje es necesario pero no basta.
   */
  window: SelfCopyAgainst;
  /** `null` si no hay ninguna respuesta anterior a la ventana */
  control: SelfCopyAgainst | null;
  /**
   * posiciones copiadas de la ventana cuyo grupo NO esta en el control: la
   * copia reciente, sin la plantilla que ya venia de antes.
   *
   * Con las dos cuentas brutas basta para el resto: en los dos lados es
   * `window.copied - windowOnly`, y solo en el control, `control.copied` menos
   * eso. `null` cuando `control` lo es: sin control no hay nada que apartar, y
   * repetir `window.copied` aqui pareceria una separacion que no se hizo.
   */
  windowOnly: number | null;
}

export interface SelfCopyInput {
  reply: string;
  window: readonly string[];
  control: readonly string[];
}

export interface SelfCopyOptions {
  n?: number;
  edgeWords?: number;
}

function ngramsOf(words: readonly string[], n: number): string[] {
  const grams: string[] = [];
  // ninguna palabra lleva espacios tras normalizar, asi que unir con uno no
  // puede hacer que dos grupos distintos den la misma clave
  for (let index = 0; index + n <= words.length; index += 1) {
    grams.push(words.slice(index, index + n).join(' '));
  }
  return grams;
}

/**
 * subcadena comun mas larga, en palabras.
 *
 * Programacion dinamica con dos filas: memoria lineal, y `Int32Array` existe en
 * el Worker y en Node. Con respuestas de unos cientos de palabras son unos
 * cientos de miles de comparaciones por turno, sin E/S.
 */
function longestCommonRun(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Int32Array(b.length + 1);
  let current = new Int32Array(b.length + 1);
  let best = 0;
  for (const wordA of a) {
    for (let j = 0; j < b.length; j += 1) {
      if (wordA === b[j]) {
        const run = (previous[j] ?? 0) + 1;
        current[j + 1] = run;
        if (run > best) best = run;
      } else {
        current[j + 1] = 0;
      }
    }
    [previous, current] = [current, previous];
  }
  return best;
}

function sharesAnyGram(a: readonly string[], b: readonly string[], n: number): boolean {
  const grams = new Set(ngramsOf(a, n));
  return ngramsOf(b, n).some((gram) => grams.has(gram));
}

function measureAgainst(
  replyWords: readonly string[],
  replyGrams: readonly string[],
  references: readonly string[],
  n: number,
  edgeWords: number,
): { measure: SelfCopyAgainst; seen: Set<string> } {
  const seen = new Set<string>();
  let longestRun = 0;
  let openings = 0;
  let closings = 0;
  const head = replyWords.slice(0, edgeWords);
  const tail = replyWords.slice(-edgeWords);

  for (const reference of references) {
    const words = normalizeForCopy(reference);
    for (const gram of ngramsOf(words, n)) seen.add(gram);
    const run = longestCommonRun(replyWords, words);
    if (run > longestRun) longestRun = run;
    if (sharesAnyGram(head, words.slice(0, edgeWords), n)) openings += 1;
    if (sharesAnyGram(tail, words.slice(-edgeWords), n)) closings += 1;
  }

  return {
    measure: {
      replies: references.length,
      // por POSICION: un grupo que la nueva repite dos veces y que ya estaba
      // antes es copia las dos veces
      copied: replyGrams.filter((gram) => seen.has(gram)).length,
      longestRun,
      openings,
      closings,
    },
    // solo para cruzar ventana y control dentro de `measureSelfCopy`: no sale
    seen,
  };
}

/**
 * cuanto de `reply` estaba ya en la ventana y cuanto en el control.
 *
 * Devuelve `null` —nunca lanza— si la respuesta es mas corta que un grupo: no
 * hay nada que medir, y un cero diria «no copio», que es una afirmacion.
 */
export function measureSelfCopy(
  input: SelfCopyInput,
  options: SelfCopyOptions = {},
): SelfCopyMeasure | null {
  const n = options.n ?? SELF_COPY_NGRAM;
  const edgeWords = options.edgeWords ?? SELF_COPY_EDGE_WORDS;
  // error de programacion, no de datos: se dice alto en vez de medir otra cosa
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n tiene que ser un entero positivo');
  if (!Number.isInteger(edgeWords) || edgeWords < n) {
    throw new RangeError('edgeWords tiene que ser un entero no menor que n');
  }

  const replyWords = normalizeForCopy(input.reply);
  if (replyWords.length < n) return null;
  const replyGrams = ngramsOf(replyWords, n);

  const window = measureAgainst(replyWords, replyGrams, input.window, n, edgeWords);
  const control =
    input.control.length === 0
      ? null
      : measureAgainst(replyWords, replyGrams, input.control, n, edgeWords);

  return {
    ngrams: replyGrams.length,
    window: window.measure,
    control: control?.measure ?? null,
    windowOnly:
      control === null
        ? null
        : replyGrams.filter((gram) => window.seen.has(gram) && !control.seen.has(gram)).length,
  };
}
