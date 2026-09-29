// si la memoria nueva de una conversacion copia la memoria de OTRAS (`D-105`).
//
// La memoria de las ultimas conversaciones lleva la orden de no copiarse a la
// de esta, pero una orden no es una garantia. Si la copia, lo que paso en otra
// conversacion queda sellado como ocurrido aqui y vuelve en cada turno como
// hecho propio: un blanqueo. Esto no lo impide; lo MIDE, con enteros.
//
// `sinApoyoAqui` es la cifra que importa: entradas de la memoria nueva que casan
// con una frase que viajo cuando ninguna de esas frases aparece en un turno de
// esta conversacion. Si el tema salio aqui de verdad, no es blanqueo.
//
// Mismo comparador que los pendientes (`quoteStems` y `matchesStems`), para que
// las cifras se puedan leer con el mismo criterio que `ecoMemoria`. Ojo con el:
// pide dos raices en comun y el 40 %, SALVO con una frase de una sola raiz, que
// casa con una sola palabra. Por eso se cuentan aparte (`frasesDeUnaRaiz`).
//
// Formato 2 (quinta ronda de `D-105`, la memoria entera). Lo que lo hace
// comparable con el formato 1, la version corta:
//
//   - `frases`: cuantas viajaron. Con mas frases hay mas ocasiones de casar
//     aunque no haya copia; en el formato 1 la cifra esta en `ecoOtras.frases`
//     del «prompt privado compuesto» del mismo turno;
//   - `porCampo`: la version corta solo llevaba `resumen` y `decisiones`, asi
//     que esas dos son las que se comparan con los turnos de antes;
//   - `control`: la tercera conversacion mas reciente, que NO viaja, medida con
//     el mismo comparador y con el mismo numero de frases. Lo que casa con ella
//     es lo que se parece por ser suyas las dos, no copia.
//
// Lo que comparten la tercera y las que viajaron —un apodo, un sitio de
// siempre— se quita de LOS DOS lados antes de comparar. Quitarlo solo del
// control (septima ronda) dejaba el apodo contando del lado enviado y no del
// otro, y esa diferencia parecia copia sin serlo. Asi las dos cifras miden lo
// mismo: frases que solo tiene su lado.
//
// Y los nombres no cuentan (octava ronda): su nombre por la ficha y, como el
// de Daniel no esta guardado, el nombre propio que sale en el 30 % de las
// frases o mas (`raicesComunes`). Con ellos, dos frases cualesquiera que
// nombraran a los dos casaban, y el control se vaciaba por «solapamientos» que
// no lo eran.
//
// Novena ronda, dos arreglos de eso mismo:
//
//   - los nombres de la cifra principal se buscan SOLO en las frases que
//     viajaron. Se buscaban tambien en las del control, y la cifra que importa
//     cambiaba segun hubiera tercera o no, y segun lo que dijera, aunque la
//     tercera no viaja. El control usa su propia lista, de los dos lados;
//   - quitar un nombre nunca hace casar lo que sin quitarlo no casaba (`casa`).
//     El comparador pide min(2, n) raices: «Trabaja con Daniel» sin el nombre
//     se quedaba en una y casaba con cualquier entrada que dijera «trabaja».
//
// Decima ronda: `casa` es el lado prudente SOLO para decir que una entrada
// copia. Para el apoyo en los turnos de aqui va al reves (`supportedHere`), asi
// que el apoyo mira solo las raices que cuentan. Por eso el formato 2 da como
// mucho las coincidencias que daria el 1, pero no como mucho sus `sinApoyo`.
// Y las frases que viajaron y no se pueden medir se cuentan (`frasesSinMedir`).
import {
  sentencesOf,
  type ConversationMemory,
  type RecentPhrase,
  type RecentPhraseField,
} from '@luxy/shared';
import { MENTION_MIN_SHARED, matchesStems, quoteStems } from './relation.js';

/** version de esta medida; el formato 1, sin campo, es el de la version corta */
export const RECENT_ECHO_FORMAT = 2;

/** lo que casa, y lo que casa sin apoyo aqui */
export interface EchoCount {
  con: number;
  sinApoyo: number;
}

export interface RecentEchoControl {
  /** frases de la tercera que quedaron despues de quitar las que viajaron */
  frases: number;
  /**
   * frases de la tercera que casan con alguna que SI viajo.
   *
   * La memoria de la primera o de la segunda pudo copiar de la tercera cuando la
   * tercera estaba entre sus recientes. Esas frases viajaron por ese camino, asi
   * que no sirven de control: se quitan y se cuentan.
   */
  excluidas: number;
  /**
   * frases de las que viajaron que casan con alguna de la tercera: la otra
   * mitad del mismo solapamiento, que tambien se quita del lado enviado
   */
  excluidasEnviadas: number;
  /** cuantas frases se usan en cada lado para comparar: las mismas en los dos */
  igualadas: number;
  /** la medida con `igualadas` frases de las que viajaron y no comparte la tercera */
  enviadas: EchoCount;
  /** la misma medida con `igualadas` frases del control */
  control: EchoCount;
}

export interface RecentEcho {
  formato: number;
  /** unidades de la memoria nueva: frases del resumen mas entradas de las listas */
  entradas: number;
  /** frases que viajaron */
  frases: number;
  /**
   * de ellas, las de una sola raiz: casan con una sola palabra en comun. Una
   * que se queda en una raiz al quitarle un nombre no cuenta: ya no casa
   */
  frasesDeUnaRaiz: number;
  /**
   * frases que viajaron y no se miden: se quedan en menos de min(2, n) raices
   * que cuenten al quitar los nombres, o no tenian ninguna. Estan en `frases`
   * y no pueden casar, asi que `conFrasesDeRecientes` no dice nada de ellas: una
   * copia literal de un hecho corto con nombre sale a cero. Sin esta cifra, la
   * medida aparentaba cubrir mas de lo que cubre
   */
  frasesSinMedir: number;
  /**
   * raices que no cuentan para casar en la medida principal: el nombre del
   * personaje y los nombres propios que salen en al menos el 30 % de las frases
   * que viajaron (el de Daniel, casi siempre). No depende del control. Solo la
   * cifra, nunca cuales
   */
  raicesComunes: number;
  /** cuantas unidades casan con alguna frase que viajo */
  conFrasesDeRecientes: number;
  /** de esas, cuantas no tienen ningun turno de aqui que las respalde */
  sinApoyoAqui: number;
  /**
   * lo mismo, por la parte de la que sale la frase. Una unidad que casa con
   * frases de dos partes cuenta en las dos, asi que la suma puede pasar del total
   */
  porCampo: Record<RecentPhraseField, { frases: number; con: number; sinApoyo: number }>;
  /** `null` sin tercera conversacion con memoria, o si no se pudo leer */
  control: RecentEchoControl | null;
}

interface StemmedPhrase {
  /** todas sus raices, nombres incluidos: lo que miraba el formato 1 */
  all: string[];
  /** las que cuentan: sin las raices que se ignoran */
  stems: string[];
  field: RecentPhraseField;
}

/**
 * las frases con sus raices, sin las que ya no pueden casar.
 *
 * Una frase que tenia dos raices o mas y se queda con menos de dos al quitar
 * los nombres no puede casar por lo que dice —`casa` le pide dos que cuenten—,
 * asi que se deja fuera, como antes las que se quedaban sin ninguna. Y como
 * sale de la lista, tampoco cuenta en `frasesDeUnaRaiz`: esas son solo las que
 * de verdad casan con una palabra. Las que se dejan fuera van a `frasesSinMedir`.
 */
function stemmed(phrases: readonly RecentPhrase[], ignored: ReadonlySet<string>): StemmedPhrase[] {
  return phrases
    .map((phrase) => {
      const all = quoteStems(phrase.text);
      return { all, stems: all.filter((stem) => !ignored.has(stem)), field: phrase.field };
    })
    .filter(
      (phrase) =>
        phrase.stems.length > 0 &&
        phrase.stems.length >= Math.min(MENTION_MIN_SHARED, phrase.all.length),
    );
}

/**
 * si un texto, con sus raices ya calculadas, habla de la frase.
 *
 * Tiene que casar con las raices que cuentan Y con todas. Solo con las que
 * cuentan, quitar un nombre podia hacer casar de mas por dos caminos: la frase
 * pasaba a pedir una raiz en comun en vez de dos, o el 40 % se calculaba sobre
 * menos raices. Con las dos condiciones, quitar nombres solo puede hacer que
 * casen MENOS que con el comparador sin quitar nada, el del formato 1. Es para
 * decir que una entrada casa con una frase, no para el apoyo aqui.
 */
function casa(textStems: ReadonlySet<string>, phrase: StemmedPhrase): boolean {
  return matchesStems(textStems, phrase.all) && matchesStems(textStems, phrase.stems);
}

/**
 * desde cuantas frases se buscan los nombres que salen en casi todas, y en que
 * parte de ellas tiene que salir uno para no contar.
 *
 * Las memorias van en tercera persona y casi todas sus frases llevan «Lía» y
 * «Daniel»: con la regla de dos raices y el 40 %, una frase de cuatro o cinco
 * raices casaba con cualquier otra que nombrara a los dos, sin ninguna copia
 * (octava ronda). El nombre de ella se quita por su ficha; el de Daniel no
 * esta guardado en ningun sitio, asi que se quita el NOMBRE PROPIO —una palabra
 * con mayuscula en mitad de una frase— que sale en al menos esa parte de las
 * frases. Un sitio nombrado de pasada («Madrid» en una de veinte) no llega y
 * sigue contando. Para casar, quitar una raiz solo puede hacer que casen MENOS
 * porque `casa` pide tambien el comparador sin quitar nada; para el apoyo aqui
 * se miran solo las raices que cuentan (`supportedHere`). Los dos numeros son
 * un criterio, no una medida.
 */
export const RECENT_ECHO_COMMON_MIN_PHRASES = 4;
export const RECENT_ECHO_COMMON_SHARE = 0.3;

/** palabras con mayuscula que no abren frase: nombres propios, casi siempre */
function properNames(text: string): string[] {
  const out: string[] = [];
  // una palabra y lo que va justo delante; se mira a mano para no depender de
  // clases de caracter con barras invertidas
  const words = text.split(' ');
  let previous = '';
  for (const word of words) {
    const clean = word.replace(/^[«"'(¿¡—-]+/u, '');
    const first = clean.charAt(0);
    const opens = previous.length === 0 || /[.!?…:]$/u.test(previous);
    if (!opens && first.length > 0 && first !== first.toLocaleLowerCase('es')) out.push(clean);
    if (word.length > 0) previous = word;
  }
  return out;
}

/** las raices del nombre dado y de los nombres propios que salen en casi todas */
function ubiquitousStems(
  pools: readonly (readonly RecentPhrase[])[],
  ignoreWords: readonly string[],
): Set<string> {
  const out = new Set(ignoreWords.flatMap((word) => quoteStems(word)));
  const all = pools.flat();
  if (all.length < RECENT_ECHO_COMMON_MIN_PHRASES) return out;
  const names = new Set(all.flatMap((phrase) => properNames(phrase.text).flatMap(quoteStems)));
  if (names.size === 0) return out;
  const seen = new Map<string, number>();
  for (const phrase of all) {
    for (const stem of quoteStems(phrase.text)) {
      if (names.has(stem)) seen.set(stem, (seen.get(stem) ?? 0) + 1);
    }
  }
  for (const [stem, count] of seen) {
    if (count / all.length >= RECENT_ECHO_COMMON_SHARE) out.add(stem);
  }
  return out;
}

/** `k` elementos repartidos por toda la lista, siempre los mismos */
function evenly<T>(items: readonly T[], k: number): T[] {
  if (k >= items.length) return [...items];
  const out: T[] = [];
  for (let index = 0; index < k; index += 1) {
    out.push(items[Math.floor((index * items.length) / k)]!);
  }
  return out;
}

/**
 * si algun turno de aqui habla de la frase.
 *
 * Aqui NO vale `casa`: pedir tambien las raices con nombres es prudente para
 * decir que una entrada copia (casan menos), pero en el apoyo va al reves. Los
 * turnos de aqui son dialogo («pintamos la verja») y casi nunca nombran a los
 * dos; con los nombres en el 40 %, un turno que hablaba del tema de verdad
 * dejaba de respaldar la frase y la entrada pasaba a `sinApoyoAqui`: un
 * blanqueo que no existe. Solo con las raices que cuentan, que `stemmed` ya
 * deja en min(2, n) o mas, no se vuelve a casar con una sola palabra.
 */
function supportedHere(phrase: StemmedPhrase, turns: readonly ReadonlySet<string>[]): boolean {
  return turns.some((turn) => matchesStems(turn, phrase.stems));
}

function countEcho(
  units: readonly ReadonlySet<string>[],
  phrases: readonly StemmedPhrase[],
  turns: readonly ReadonlySet<string>[],
): EchoCount & { matchedBy: StemmedPhrase[][] } {
  let con = 0;
  let sinApoyo = 0;
  const matchedBy: StemmedPhrase[][] = [];
  for (const unit of units) {
    const matched = phrases.filter((phrase) => casa(unit, phrase));
    matchedBy.push(matched);
    if (matched.length === 0) continue;
    con += 1;
    if (!matched.some((phrase) => supportedHere(phrase, turns))) sinApoyo += 1;
  }
  return { con, sinApoyo, matchedBy };
}

export function measureRecentEcho(input: {
  memory: ConversationMemory;
  phrases: readonly RecentPhrase[];
  turns: readonly { text: string }[];
  /**
   * las frases de la tercera conversacion mas reciente, montadas igual que las
   * que viajaron y NO enviadas. Ausente o `null`, sin control.
   */
  control?: readonly RecentPhrase[] | null;
  /** el nombre del personaje: sale en casi todo y no dice de que se habla */
  ignoreWords?: readonly string[];
}): RecentEcho {
  const units = [
    ...sentencesOf(input.memory.summary),
    ...input.memory.facts,
    ...input.memory.decisions,
    ...input.memory.plan,
    ...input.memory.openQuestions,
    ...input.memory.lessons,
  ].map((unit) => new Set(quoteStems(unit)));
  const turns = input.turns.map((turn) => new Set(quoteStems(turn.text)));
  const ignoreWords = input.ignoreWords ?? [];
  // la cifra principal solo mira lo que viajo: con el control dentro, cambiaba
  // segun hubiera tercera y segun lo que dijera, y la tercera no viaja
  const ignored = ubiquitousStems([input.phrases], ignoreWords);
  const phrases = stemmed(input.phrases, ignored);
  const main = countEcho(units, phrases, turns);

  const porCampo = {
    resumen: { frases: 0, con: 0, sinApoyo: 0 },
    hechos: { frases: 0, con: 0, sinApoyo: 0 },
    decisiones: { frases: 0, con: 0, sinApoyo: 0 },
    lecciones: { frases: 0, con: 0, sinApoyo: 0 },
  } satisfies RecentEcho['porCampo'];
  for (const phrase of input.phrases) porCampo[phrase.field].frases += 1;
  main.matchedBy.forEach((matched) => {
    const fields = new Set(matched.map((phrase) => phrase.field));
    for (const field of fields) {
      porCampo[field].con += 1;
      const supported = matched
        .filter((phrase) => phrase.field === field)
        .some((phrase) => supportedHere(phrase, turns));
      if (!supported) porCampo[field].sinApoyo += 1;
    }
  });

  let control: RecentEchoControl | null = null;
  if (input.control !== undefined && input.control !== null) {
    // aqui los nombres si se buscan en las dos listas juntas: si se decidiera
    // por separado, una raiz podria contar en un lado y no en el otro. Por eso
    // el lado enviado del control se vuelve a montar con esta lista
    const shared = ubiquitousStems([input.phrases, input.control], ignoreWords);
    const sent = stemmed(input.phrases, shared);
    const all = stemmed(input.control, shared);
    // una frase del control que habla de una que viajo, o al reves, viajo de
    // hecho: por la memoria de otra que la copio. Y el mismo solapamiento se
    // quita tambien del lado enviado, o solo contaria en uno
    const overlaps = (a: StemmedPhrase, b: StemmedPhrase): boolean =>
      casa(new Set(a.all), b) || casa(new Set(b.all), a);
    const clean = all.filter((candidate) => !sent.some((each) => overlaps(each, candidate)));
    const sentClean = sent.filter((each) => !all.some((candidate) => overlaps(each, candidate)));
    const igualadas = Math.min(clean.length, sentClean.length);
    const enviadas = countEcho(units, evenly(sentClean, igualadas), turns);
    const delControl = countEcho(units, evenly(clean, igualadas), turns);
    control = {
      frases: clean.length,
      excluidas: all.length - clean.length,
      excluidasEnviadas: sent.length - sentClean.length,
      igualadas,
      enviadas: { con: enviadas.con, sinApoyo: enviadas.sinApoyo },
      control: { con: delControl.con, sinApoyo: delControl.sinApoyo },
    };
  }

  return {
    formato: RECENT_ECHO_FORMAT,
    entradas: units.length,
    frases: input.phrases.length,
    frasesDeUnaRaiz: phrases.filter((phrase) => phrase.stems.length === 1).length,
    frasesSinMedir: input.phrases.length - phrases.length,
    raicesComunes: ignored.size,
    conFrasesDeRecientes: main.con,
    sinApoyoAqui: main.sinApoyo,
    porCampo,
    control,
  };
}
