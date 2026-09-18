// «de espaldas» deja de depender de que el modelo lo escriba bien.
//
// EL FALLO, medido tres veces con el mismo prompt: se pide la foto de espaldas,
// el modelo escribe «from behind» y la imagen sale de frente o de tres cuartos.
// No es que el generador desobedezca: `from behind` dice DONDE ESTA LA CAMARA,
// no QUE PARTE del cuerpo va hacia el objetivo, y se cumple igual girando a la
// persona —la camara sigue detras—. Las etiquetas que si lo dicen son «ass to
// camera» y «back to camera», y los cuatro prompts que de verdad salieron de
// espaldas llevaban la primera.
//
// POR QUE EN CODIGO Y NO EN EL PROMPT: ya esta en el prompt. El 2026-09-17 se
// añadio al bloque de instrucciones la regla que lo explica con esas mismas
// palabras, y los tres prompts siguientes volvieron a salir con «from behind» a
// secas. Es el patron de `D-090` y el del recorte de rasgos: cuando una
// instruccion se comprueba incumplida, la decision pasa del prompt al codigo.
// El bloque no se toca —sigue donde estaba—; esto lo respalda para los turnos
// en los que el modelo no lo siga.
//
// LO QUE ESTO NO ES: no añade un encuadre que nadie pidio. DESAMBIGUA el que ya
// se pidio, y solo entonces: sin «from behind» en la escena, aqui no hay nada
// que decir. La version inequivoca la elige la POSTURA que la propia escena
// declara, no la imaginacion de esta funcion.
//
// LO QUE APRENDIERON LAS DOS REVISIONES, y es la mitad del modulo: `from behind`
// NO es raro fuera del encuadre. Es la forma normal de escribir la luz —«backlit
// from behind», «warm candlelight coming from behind»—, y el bloque de
// instrucciones pide describir la luz en cada escena, asi que aparece
// constantemente; tambien es preposicion con objeto —«from behind the curtain»—,
// describe contacto —«he kisses her neck from behind»— y hasta un sitio —«from a
// back room»—. En todas, la camara puede estar perfectamente de frente, y la
// primera version llego a escribir `back to camera` al lado de un `facing the
// camera` que ya estaba: dos ordenes opuestas en el mismo prompt.
//
// El primer intento de arreglarlo fue reconocer esos usos con listas de palabras
// —luz, verbos de sujetar, objetos—, y se midio: de 35 frases de dormitorio
// escritas sin mirar las listas, 22 ganaron encuadre igual. Era vocabulario
// cerrado contra lenguaje abierto, y esa carrera se pierde siempre.
//
// LA REGLA QUE SI FUNCIONA es de forma y no de vocabulario: el disparador tiene
// que ser un ELEMENTO ENTERO, entre separadores. Todos los usos que no son
// encuadre lo llevan DENTRO de una frase mas larga; el que si lo es va suelto,
// que es como lo escribe el modelo —«from behind, on all fours, ...»—. El precio
// es no actuar en prosa corrida, y se paga a gusto: `D-085`, precision antes que
// alcance. Pasarse cuesta una generacion contradictoria; quedarse corto deja las
// cosas como ya estaban.
//
// Modulo PURO: recibe texto y devuelve texto. No cifra, no toca disco, no llama
// a nadie y no mira el reloj. Sin expresiones regulares a proposito: todo el
// emparejamiento es sobre una lista de palabras, asi que no hay ni una barra
// invertida que se pueda perder por el camino.

/**
 * la etiqueta para una postura que ya deja el trasero hacia atras.
 *
 * Es la que llevaban los cuatro prompts que salieron de espaldas de verdad. No
 * se inventa nada con ella: la escena ya pidio «desde detras» y ya declaro una
 * postura en la que lo que queda hacia atras es eso.
 */
const REAR_TAG = 'ass to camera';

/**
 * la lectura NEUTRA de «desde detras»: de pie, tumbada o sentada.
 *
 * Misma construccion que la anterior —«X to camera»— porque es la que el
 * generador si obedece, pero sin añadir nada sexual que la escena no implique.
 */
const NEUTRAL_TAG = 'back to camera';

/** las dos etiquetas que esta funcion puede llegar a añadir, para quien las quiera leer */
export const ORIENTATION_TAGS = { rear: REAR_TAG, neutral: NEUTRAL_TAG } as const;

const WORD_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * los caracteres que cierran una clausula y no solo una palabra.
 *
 * Hacen falta porque «warm light from behind» y «warm light, from behind» dicen
 * cosas distintas: en la primera el `from behind` es de la luz y en la segunda
 * es una etiqueta aparte. Sin guardar ese corte, mirar la palabra anterior daria
 * `light` en las dos.
 */
const BREAK_CHARS = ',.;:!?\n\r';

/** el token que marca ese corte; no es una palabra, asi que no casa con nada */
const BREAK = ',';

/**
 * palabras que no cambian lo que se dice y estorban al comparar.
 *
 * Se saltan a los DOS lados. Existe porque en prosa se escribe «her back to the
 * camera» y la lista de frases dice `back to camera`: sin esto, el codigo añadia
 * `back to camera` a una escena que ya lo decia con el articulo puesto, y el
 * prompt salia con la etiqueta dos veces. Normalizarlo aqui es lo que evita que
 * la lista crezca a mano con cada variante.
 */
const ARTICLES: readonly string[] = ['the', 'a', 'an'];

/** un disparador de «desde detras», con lo que hace falta para leerlo bien */
interface BehindTrigger {
  /** tal y como se escribe, para poder localizarlo en el texto ORIGINAL */
  readonly literal: string;
  /** sus palabras sin articulos, que es lo que de verdad se compara */
  readonly words: readonly string[];
  /**
   * es una PREPOSICION, y por tanto puede llevar objeto detras.
   *
   * «from behind the curtain» no pide un encuadre: dice detras de que esta ella.
   * «rear view of her» si lo pide, asi que la misma comprobacion aplicada a un
   * nombre de encuadre se llevaria por delante escenas validas. Por eso la
   * distincion no es decorativa.
   */
  readonly prepositional: boolean;
}

/**
 * las formas de pedir «desde detras» que NO dicen que parte va al objetivo.
 *
 * Todas nombran la posicion de la camara y ninguna la orientacion del cuerpo:
 * son exactamente las ambiguas, que es lo que las convierte en el disparador.
 */
const CAMERA_BEHIND_TRIGGERS: readonly BehindTrigger[] = [
  ...['from behind', 'from the back', 'from the rear', 'seen from back'].map((literal) =>
    behindTrigger(literal, true),
  ),
  ...['rear view', 'back view', 'rear angle'].map((literal) => behindTrigger(literal, false)),
];

/**
 * las formas de decir que la persona YA mira al objetivo.
 *
 * Es la puerta que mas escenas salva de las cinco medidas, y va por delante de
 * todo lo demas: si la escena dice que mira a camara, no hay nada que
 * desambiguar —diga lo que diga el resto— y añadir `back to camera` ahi es
 * escribir dos ordenes opuestas en el mismo prompt.
 *
 * «looking back» NO esta aqui, y tampoco «looking back at viewer»: son la
 * postura de espaldas con la cara girada, que es justo lo que el prompt que
 * fallo tres veces llevaba.
 */
const VIEWER_FACING_PHRASES: readonly (readonly string[])[] = [
  'looking at viewer',
  'looking at camera',
  'looks at viewer',
  'looks at camera',
  'looking at you',
  'facing viewer',
  'facing camera',
  'faces viewer',
  'faces camera',
  'facing forward',
  'front view',
  'frontal view',
  'eye contact',
  'smiling at viewer',
  'smiling at camera',
  'smiles at viewer',
  'smiles at camera',
  'face to camera',
  'face toward camera',
  'face towards camera',
  'face to viewer',
  'face toward viewer',
  'face towards viewer',
].map(toWords);

/**
 * las formas que YA dicen que parte va hacia el objetivo.
 *
 * Con cualquiera de estas presente la escena no es ambigua y no se toca nada:
 * desambiguar lo ya dicho seria repetirse, y repetirse le resta peso al resto.
 *
 * Las de «X hacia el objetivo» se generan cruzando las tres piezas que las
 * forman en vez de escribirse a mano: en prosa aparecen todas las combinaciones
 * —`ass towards the viewer`, `back towards viewer`, `buttocks to the viewer`— y
 * una lista escrita a mano siempre va por detras de la siguiente variante.
 */
const ORIENTATION_STATED_PHRASES: readonly (readonly string[])[] = [
  ...rearFacingCombinations(),
  ...[
    'ass focus',
    'butt focus',
    'back focus',
    'back turned',
    'turns her back',
    'turns his back',
    'turned her back',
    'turned his back',
    'facing away',
    'faces away',
    'turned away',
    'face down',
    'facedown',
  ].map(toWords),
];

/**
 * las posturas en las que lo que queda hacia atras es el trasero.
 *
 * La lista es corta y conservadora a proposito: cada entrada tiene que dejar
 * esa lectura sin discusion. «arched back» se quedo FUERA porque tambien se
 * escribe de pie y boca arriba, y entonces la etiqueta sexual seria inventada.
 * Cuando ninguna casa, la lectura correcta es la neutra, que nunca sobra.
 *
 * Por ese mismo liston salieron despues `kneeling`, `on her knees`, `on his
 * knees`, `leaning over` y `leaning forward`: se escriben igual arrodillada de
 * frente o asomandose a mirar algo. Medido: «1girl, rear view, kneeling,
 * indoors» ganaba `ass to camera` en una escena que no lo implicaba. La regla de
 * trabajo es que esta lista solo se amplia cuando falla una escena real que
 * TENIA que dar `ass to camera`, nunca al reves.
 */
const REAR_PRESENTING_POSTURES: readonly (readonly string[])[] = [
  'on all fours',
  'all fours',
  'hands and knees',
  'doggystyle',
  'doggy style',
  'bent over',
  'bending over',
  'bent forward',
  'ass up',
  'butt up',
  'hips up',
  'top down bottom up',
  'crawling',
].map(toWords);

/** la escena ya desambiguada, y lo que se le añadio por el camino */
export interface OrientedScene {
  text: string;
  /**
   * lo que puso el codigo, tal y como se lee en el positivo.
   *
   * Es el gemelo de `dropped`: aquello existe para que el recorte automatico no
   * sea invisible, y esto para que lo añadido tampoco lo sea. El panel lo
   * recorre y ofrece quitarlo ANTES de generar; sin este campo, la persona
   * veria una etiqueta que ella no escribio y no sabria de donde salio.
   *
   * Hoy nunca trae mas de un elemento. Es una lista igualmente para que el
   * panel trate a los dos campos por el mismo sitio.
   */
  added: string[];
}

/**
 * pone la orientacion cuando la escena pide «desde detras» y no la dice.
 *
 * Cuatro puertas, en este orden:
 *
 * 1. si la escena no pide espaldas —o lo que parecia pedirlo era la luz, un
 *    objeto detras del cual se esta o alguien sujetando—, no hay nada que
 *    desambiguar;
 * 2. si ya dice que mira al objetivo, tampoco: añadir la etiqueta seria mandar
 *    dos ordenes opuestas;
 * 3. si ya dice que parte va al objetivo, tampoco: lo pedido ya es inequivoco;
 * 4. y solo entonces se elige entre las dos lecturas segun la postura que la
 *    escena DECLARA. Si no declara ninguna que deje el trasero hacia atras,
 *    gana la neutra.
 */
export function disambiguateOrientation(scene: string): OrientedScene {
  const tokens = tokenize(scene);

  const disparador = findFramingTrigger(tokens);
  if (disparador === null) return { text: scene, added: [] };

  if (VIEWER_FACING_PHRASES.some((phrase) => hasPhrase(tokens, phrase))) {
    return { text: scene, added: [] };
  }

  if (ORIENTATION_STATED_PHRASES.some((phrase) => hasPhrase(tokens, phrase))) {
    return { text: scene, added: [] };
  }

  const tag = REAR_PRESENTING_POSTURES.some((posture) => hasPhrase(tokens, posture))
    ? REAR_TAG
    : NEUTRAL_TAG;

  return { text: insertAfterTrigger(scene, disparador, tag), added: [tag] };
}

/**
 * el primer «desde detras» que de verdad pide un encuadre.
 *
 * No basta con que las palabras esten: las mismas palabras son la luz, una
 * preposicion con objeto o alguien sujetando a otra persona, y en esos tres
 * casos la camara puede estar de frente. Por eso cada aparicion se mira con lo
 * que tiene al lado antes de darla por buena.
 */
function findFramingTrigger(tokens: readonly string[]): BehindTrigger | null {
  for (const trigger of CAMERA_BEHIND_TRIGGERS) {
    for (let at = 0; at < tokens.length; at += 1) {
      const end = matchFrom(tokens, at, trigger.words);
      if (end === -1) continue;
      if (isFramingUse(tokens, at, end)) return trigger;
    }
  }
  return null;
}

/**
 * esta aparicion pide un encuadre, y no es luz, ni contacto, ni un mueble.
 *
 * LA REGLA ES QUE SEA UN ELEMENTO ENTERO, entre separadores. Nada mas. La
 * version anterior intentaba reconocer los usos que NO son encuadre con listas
 * de palabras —luz, verbos de sujetar, objetos detras de los que uno se
 * esconde— y era vocabulario cerrado contra lenguaje abierto: al medirlo con 35
 * frases de dormitorio escritas sin mirar las listas, 22 ganaron un encuadre
 * que nadie habia pedido. Se escapaban `candlelight`, `firelight`, `neon`,
 * `kisses`, `presses`, y cualquier luz nombrada a mas de tres palabras.
 *
 * Y no hacia falta ninguna lista, porque TODOS los falsos positivos comparten
 * una forma: «from behind» va DENTRO de una frase mas larga —«backlit from
 * behind», «he kisses her neck from behind», «peeks from behind the curtain»,
 * «from a back room»—. Cuando de verdad pide el encuadre, va suelto entre
 * comas, que es como lo escribe el modelo: «from behind, on all fours, ...».
 *
 * El precio es no actuar en prosa corrida, y se paga a gusto: `D-085`, la
 * precision antes que el alcance. Aqui pasarse cuesta una generacion con dos
 * ordenes de encuadre opuestas; quedarse corto cuesta lo de siempre, que es lo
 * que ya habia.
 */
function isFramingUse(tokens: readonly string[], start: number, end: number): boolean {
  const before = start === 0 ? BREAK : tokens[start - 1];
  const after = end >= tokens.length ? BREAK : tokens[end];
  return before === BREAK && after === BREAK;
}

/**
 * la etiqueta va pegada al «from behind» que desambigua, no al final del todo.
 *
 * El orden pesa —el bloque de instrucciones lo dice con estas palabras: «el
 * PRIMERO es el que mas pesa»— y los prompts que si salieron de espaldas
 * llevaban las dos etiquetas juntas, en ese orden. Se hace por corte y pegado
 * sobre el texto original y no partiendo la escena en comas: asi todo lo demas
 * llega al generador caracter por caracter como lo escribio el modelo.
 *
 * Se busca con el articulo y sin el —la comparacion se lo salta, asi que la
 * escena pudo casar por cualquiera de las dos formas—. Cuando aun asi no se
 * puede localizar sin reescribir el resto —lo escrito con espacios raros o
 * partido por un salto de linea— la etiqueta se va al final. Vale menos, pero
 * sigue diciendo lo que faltaba, y es preferible a tocar un texto que no se
 * entiende del todo. Por el mismo motivo se pega en la PRIMERA aparicion:
 * cuando hay dos y la buena es la segunda, la etiqueta queda antes de tiempo,
 * que sigue siendo un prompt correcto.
 */
function insertAfterTrigger(scene: string, trigger: BehindTrigger, tag: string): string {
  const bajado = scene.toLowerCase();
  const forma = [trigger.literal, trigger.words.join(' ')].find((form) => bajado.includes(form));
  if (forma === undefined) return appendTag(scene, tag);
  const at = bajado.indexOf(forma);
  const comma = scene.indexOf(',', at + forma.length);
  if (comma === -1) return appendTag(scene, tag);
  // esa coma era la ultima y no separaba nada: pegar ahi dejaria una coma
  // colgando al final, que el generador lee como una etiqueta vacia
  if (trimTrailingSeparators(scene.slice(comma)).length === 0) return appendTag(scene, tag);
  return `${scene.slice(0, comma)}, ${tag}${scene.slice(comma)}`;
}

/** al final, y sin dejar dos comas seguidas si la escena ya terminaba en una */
function appendTag(scene: string, tag: string): string {
  const base = trimTrailingSeparators(scene);
  return base.length === 0 ? tag : `${base}, ${tag}`;
}

/** quita espacios y comas del final, que es lo unico que estorba para pegar detras */
function trimTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 0) {
    const char = value.charAt(end - 1);
    if (char === ',' || char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      end -= 1;
      continue;
    }
    break;
  }
  return value.slice(0, end);
}

/** un disparador con sus palabras ya preparadas para comparar */
function behindTrigger(literal: string, prepositional: boolean): BehindTrigger {
  return { literal, words: toWords(literal), prepositional };
}

/**
 * las tres piezas de «X hacia el objetivo», cruzadas.
 *
 * Se genera en vez de escribirse porque las tres listas son cerradas y su cruce
 * son treinta y seis frases: escritas a mano, la que falte sera siempre la que
 * la persona acabe usando.
 */
function rearFacingCombinations(): (readonly string[])[] {
  const nouns = ['ass', 'butt', 'buttocks', 'backside', 'back', 'rear'];
  const towards = ['to', 'toward', 'towards'];
  const targets = ['camera', 'viewer'];
  const phrases: (readonly string[])[] = [];
  for (const noun of nouns) {
    for (const toward of towards) {
      for (const target of targets) {
        phrases.push([noun, toward, target]);
      }
    }
  }
  return phrases;
}

/**
 * parte la escena en palabras en minusculas, con la coma guardada aparte.
 *
 * Trabajar con la lista de palabras —y no con la cadena— es lo que permite
 * mirar la palabra anterior y la siguiente a un disparador, que es de donde sale
 * saber si «from behind» era la luz o el encuadre.
 */
function tokenize(scene: string): string[] {
  const tokens: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };
  for (const char of scene.toLowerCase()) {
    if (WORD_CHARS.includes(char)) {
      current += char;
      continue;
    }
    flush();
    // dos comas seguidas, o una coma y un punto, cortan lo mismo que una
    if (BREAK_CHARS.includes(char) && tokens[tokens.length - 1] !== BREAK) tokens.push(BREAK);
  }
  flush();
  return tokens;
}

/** las palabras de una frase de las listas, sin los articulos que se saltan al comparar */
function toWords(phrase: string): readonly string[] {
  return tokenize(phrase).filter((word) => !ARTICLES.includes(word));
}

/**
 * casa `words` a partir de `start`, saltandose los articulos que haya en medio.
 *
 * Devuelve el indice del token siguiente al ultimo casado —que es lo que hace
 * falta para mirar lo que va detras— o -1 si no casa.
 */
function matchFrom(tokens: readonly string[], start: number, words: readonly string[]): number {
  let at = start;
  for (const word of words) {
    while (at < tokens.length && tokens[at] !== word && isArticle(tokens[at])) at += 1;
    if (tokens[at] !== word) return -1;
    at += 1;
  }
  return at;
}

/** la frase esta en la escena, como palabras enteras y sin que le estorben los articulos */
function hasPhrase(tokens: readonly string[], words: readonly string[]): boolean {
  for (let at = 0; at < tokens.length; at += 1) {
    if (matchFrom(tokens, at, words) !== -1) return true;
  }
  return false;
}

function isArticle(word: string | undefined): boolean {
  return word !== undefined && ARTICLES.includes(word);
}
