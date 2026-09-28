// cuando dos raices son la MISMA palabra aunque el recorte las deje distintas,
// solo para decidir si una respuesta suya saco una promesa (`D-104`).
//
// Por que hace falta. `stem()` recorta sufijos regulares y se queda corto a
// proposito (`turn-index.ts`): «traigo» y «traer», «debo» y «debe», «pongo» y
// «pondria», «prometo» y «prometio» acaban en raices distintas. Para el indice
// eso es lo prudente. Pero la nota de «ya salio» exige tres raices de la cita y
// el 60 %, y cuando ella saca una promesa lo hace con SUS palabras: el verbo
// cambia de persona o de tiempo casi siempre. Con texto inventado, la regla
// estricta reconocia 2 de 9 promesas que ella si sacaba (revision del 28/09).
//
// Por que aqui y no en `stem()`. Cambiar el recorte cambiaria el indice, la
// memoria episodica y la bolsa laxa de «en escena», que el registro midio en 99
// de 111 turnos con abiertas. Esto solo decide cuando dos raices valen igual
// DENTRO de la regla estricta, y la regla sigue exigiendo lo mismo: tres raices,
// el 60 % y que la bolsa de siempre case con las raices exactas.
//
// Tres equivalencias, y ninguna por parecido suelto:
// 1. formas de unos pocos verbos irregulares, y de cuatro regulares de raiz
//    corta, sacadas con el mismo `stem()`;
// 2. terminaciones regulares que el recorte no alcanza (uno o dos pronombres
//    pegados al infinitivo o al gerundio, el condicional);
// 3. una raiz de cinco letras o mas que es el principio de otra a la que le
//    sobran como mucho dos («promet» y «prometi»).
import { normalizeTerm, stem } from './turn-index.js';

/**
 * formas de verbos irregulares frecuentes en una promesa.
 *
 * Solo verbos cuya raiz CAMBIA, que es lo que ningun recorte arregla. Faltan
 * los que valen para todo —ser, estar, tener, hacer, poder, querer, ir—: una
 * cita que los lleve no se distingue de cualquier respuesta por ellos.
 *
 * Fuera las formas cuya RAIZ solo la alcanza otra palabra corriente: «traje» es
 * la ropa (y «trajo» cae en su misma raiz), «vino» es la bebida, «visto» y
 * «vista», «puesto» y «hecho». Un falso aqui solo suma una raiz de tres, pero no
 * hace falta regalarla.
 *
 * El filtro va por raiz, no por palabra, y por eso quedan algunas que tambien
 * son otra cosa (revision del 28/09): «cuenta» (darse cuenta) y «cuento» (el
 * relato) recortan a «cuent», la misma raiz que «cuentas» o «cuente», que son el
 * verbo; quitarlas de la tabla no las sacaria. Lo mismo «sale», «ves», «das» o
 * «vera». Cuestan como mucho una raiz de las tres, y sin ellas «te cuento» y
 * «¿me lo contaras?» no se unirian.
 */
const IRREGULAR_VERBS: readonly (readonly string[])[] = [
  [
    'traer', 'traigo', 'traiga', 'traigas', 'trae', 'traes', 'traere', 'traeras',
    'traera', 'traeria', 'traerias', 'traido', 'traida', 'traerte', 'traerla', 'traerlo',
    'traeme', 'traernos',
  ],
  [
    'poner', 'pongo', 'ponga', 'pongas', 'pone', 'pones', 'ponemos', 'pondre', 'pondras',
    'pondra', 'pondremos', 'pondria', 'pondrias', 'puse', 'pusiste', 'puso', 'ponerme',
    'ponerte', 'ponerla', 'ponerlo', 'ponernos',
  ],
  [
    'contar', 'cuento', 'cuentas', 'cuenta', 'cuente', 'cuentes', 'conte', 'contaste',
    'conto', 'contare', 'contaras', 'contaria', 'contarte', 'contarme',
  ],
  [
    'venir', 'vengo', 'venga', 'vengas', 'vienes', 'viene', 'vendre', 'vendras', 'vendra',
    'vendremos', 'vendria', 'vendrias', 'vine', 'viniste', 'venirte', 'viniera', 'vinieras',
  ],
  [
    'salir', 'salgo', 'salga', 'salgas', 'salgamos', 'sales', 'sale', 'saldre', 'saldras',
    'saldra', 'saldremos', 'saldria', 'salimos', 'sali', 'salio', 'saliera', 'salieras',
  ],
  [
    'volver', 'vuelvo', 'vuelves', 'vuelve', 'vuelva', 'volvere', 'volveras', 'volvera',
    'volveria', 'volvi', 'volviste', 'volvio', 'volvamos',
  ],
  [
    'dormir', 'duermo', 'duermes', 'duerme', 'duerma', 'dormiremos', 'dormiria', 'dormimos',
    'durmamos', 'durmio', 'durmiera',
  ],
  [
    'deber', 'debo', 'debes', 'debe', 'debemos', 'deberia', 'deberias', 'debi', 'debiste',
    'debio', 'debere',
  ],
  [
    'dar', 'doy', 'das', 'dare', 'daras', 'dara', 'daria', 'darias', 'diste', 'dio', 'darte',
    'darle', 'darme', 'darnos',
  ],
  [
    'ver', 'veo', 'ves', 'vere', 'veras', 'vera', 'veria', 'vemos', 'verte', 'verla', 'verlo',
    'verme', 'vernos',
  ],
];

/**
 * verbos regulares de raiz CORTA que salen en una promesa.
 *
 * Con tres letras de raiz, `stem()` deja «beso» y «besar» como estan —su suelo
 * es de cuatro— y ninguna regla general puede unirlos sin unir tambien «casa» y
 * «caso» o «peli» y «pelo» (la revision del 28/09 fabrico un falso asi). Por eso
 * van con nombre y apellido, como los irregulares.
 *
 * Fuera los que tambien son otra palabra muy corriente: «mira» (¡mira!), «toca»
 * («hoy toca...»), «pasa», «baño» (el cuarto), «bebe» (bebé), «como».
 */
const SHORT_REGULAR_ROOTS = ['bes', 'cen', 'jur', 'pag'] as const;

/** terminaciones de un verbo en -ar: presente, preterito, futuro, condicional y pronombre */
const AR_ENDINGS = [
  'o', 'a', 'as', 'e', 'es', 'amos', 'ar', 'arte', 'arme', 'arla', 'arlo', 'arle', 'aria',
  'arias', 'aste', 'are', 'aras', 'ara', 'aremos', 'ado', 'ada',
] as const;

const VERB_FORMS: readonly (readonly string[])[] = [
  ...IRREGULAR_VERBS,
  ...SHORT_REGULAR_ROOTS.map((root) => AR_ENDINGS.map((ending) => `${root}${ending}`)),
];

/** raiz, tal y como la deja `stem()`, a su verbo */
const VERB_OF: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  VERB_FORMS.forEach((forms, verb) => {
    for (const form of forms) {
      // con el recorte de verdad: si `stem()` cambia, la tabla cambia con el y
      // no se desincroniza
      const root = stem(normalizeTerm(form));
      // una raiz que dos verbos reclaman no dice de cual es: fuera de los dos
      if (map.has(root) && map.get(root) !== verb) map.set(root, -1);
      else map.set(root, verb);
    }
  });
  return map;
})();

const INFINITIVE_ENDINGS = ['ar', 'er', 'ir'] as const;
const GERUND_ENDINGS = ['ando', 'iendo'] as const;

/**
 * lo que deja `stem()` de los pronombres pegados al verbo, del mas largo al mas
 * corto: «traertelo» queda en «traertel», «traernoslo» en «traernosl»,
 * «llevarnos» en «llevarn» y «llevarla» en «llevarl».
 *
 * El orden importa: con «l» primero, «traertel» dejaria «traerte», que no es
 * un infinitivo, y no se quitaria nada.
 */
const CLITIC_TAILS = ['nosl', 'tel', 'mel', 'sel', 'l', 'm', 't', 'n'] as const;

/** lo que tiene que quedar para quitar un pronombre o una terminacion */
const MIN_REGULAR_ROOT = 4;

/** el prefijo mas corto que vale como la misma palabra, y lo que puede sobrar */
const MIN_PREFIX_ROOT = 5;
const MAX_PREFIX_EXTRA = 2;

function endsWithInfinitive(root: string): boolean {
  return INFINITIVE_ENDINGS.some((ending) => root.endsWith(ending));
}

/** un gerundio con raiz de verdad detras: «escribiendo» si, «bando» no */
function endsWithGerund(root: string): boolean {
  return GERUND_ENDINGS.some(
    (ending) => root.endsWith(ending) && root.length - ending.length >= MIN_REGULAR_ROOT,
  );
}

/**
 * si lo que queda al quitar el pronombre es un verbo al que se le pega uno.
 *
 * La «n» de «nos» solo detras de -ar o -ir: detras de -er la dejan tambien
 * «interno», «moderno» o «alterno», que pasarian a ser «interes», «moderar» o
 * «alterar». Los -er de las tablas que la necesitan van escritos en ellas.
 */
function takesClitic(base: string, tail: string): boolean {
  if (base.length <= MIN_REGULAR_ROOT) return false;
  if (endsWithGerund(base)) return true;
  if (tail === 'n') return base.endsWith('ar') || base.endsWith('ir');
  return endsWithInfinitive(base);
}

function withoutClitic(root: string): string {
  for (const tail of CLITIC_TAILS) {
    if (!root.endsWith(tail)) continue;
    const base = root.slice(0, -tail.length);
    if (takesClitic(base, tail)) return base;
  }
  return root;
}

/**
 * la raiz sin lo regular que el recorte no quita.
 *
 * «llevarla» deja «llevarl» y «llevarias» deja «llevar» o «llevari»; los tres
 * son «llev». Lo que queda al quitar el pronombre o el condicional —un
 * infinitivo o un gerundio— se recorta con el MISMO `stem()` que la palabra
 * suelta: «prepararte» tiene que acabar donde «preparar» y «preparo», en
 * «prep», y no en «prepar» por haber quitado el infinitivo una sola vez
 * (revision del 28/09). El suelo es el de `stem()`: con menos de cuatro letras
 * no se recorta, y «martes» —«mart»— no pasa a ser «mar».
 */
export function regularRoot(root: string): string {
  // un pronombre pegado: «llevarl», «contart», «traertel», «escribiendot»
  let current = withoutClitic(root);
  // el condicional: «llevari», «deberi»
  if (current.endsWith('ri') && current.length >= MIN_REGULAR_ROOT + 2) {
    const withoutI = current.slice(0, -1);
    if (endsWithInfinitive(withoutI)) current = withoutI;
  }
  // un infinitivo o un gerundio a la vista se recorta como la palabra suelta
  if (endsWithInfinitive(current) || endsWithGerund(current)) return stem(current);
  return current;
}

/**
 * el verbo de la tabla al que pertenece una raiz, tal cual o sin su pronombre.
 *
 * Sin lo segundo, la tabla solo reconocia los pronombres escritos uno a uno:
 * «traerte» si, pero «traerme», «traertelo» o «ponermelo» no (revision del
 * 28/09). `regularRoot('traerm')` es «traer», que si esta.
 */
function verbOf(root: string): number | undefined {
  return VERB_OF.get(root) ?? VERB_OF.get(regularRoot(root));
}

/**
 * si dos raices son la misma palabra para la regla estricta.
 *
 * Simetrica. Igualdad exacta primero, que es lo de siempre.
 */
export function sameRoot(a: string, b: string): boolean {
  if (a === b) return true;

  const verbA = verbOf(a);
  if (verbA !== undefined && verbA >= 0 && verbA === verbOf(b)) return true;

  const ra = regularRoot(a);
  const rb = regularRoot(b);
  if (ra === rb) return true;

  // no hay regla general para la vocal final de una raiz de cuatro: unia «debo»
  // y «debe», pero tambien «casa» y «caso», «peli» y «pelo», «cara» y «caro»
  // (revision del 28/09). Los verbos que la necesitaban van en las tablas

  // «promet» y «prometi», «prometem». Con cinco letras y dos de sobra como
  // mucho: «compr» no es «compromis»
  const [short, long] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
  return (
    short.length >= MIN_PREFIX_ROOT &&
    long.length - short.length <= MAX_PREFIX_EXTRA &&
    long.startsWith(short)
  );
}

/** si alguna raiz de la respuesta es la misma palabra que esta de la cita */
export function hasSameRoot(turnStems: ReadonlySet<string>, root: string): boolean {
  if (turnStems.has(root)) return true;
  for (const candidate of turnStems) {
    if (sameRoot(root, candidate)) return true;
  }
  return false;
}
