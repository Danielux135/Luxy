// lo que la pantalla dice y sugiere sobre el dueño de una conversacion
// (`D-103`, `D-105`).
//
// PURO: sin React, sin IPC y sin `console`. Los textos salen de aqui porque
// tienen que decir la verdad (`D-093`) y eso solo se puede fijar con pruebas: la
// confirmacion del enganche promete cosas sobre la memoria, los pendientes y el
// otro equipo, y cada frase depende de un dato que calcula el proceso principal.
//
// El aviso «¿Es de Lia?» se calcula aqui y NO se registra en ningun sitio: mira
// solo los mensajes de Daniel y el borrador, y su descarte vive en memoria.
import { RECENT_MEMORY_ENTRY_CHARS, VAULT_RECENT_TURNS } from '@luxy/shared';

/** lo que el proceso principal dice del dueño de la conversacion abierta */
export interface OwnerView {
  source: 'none' | 'turn' | 'link';
  label: string | null;
  signedAfter: number | null;
  linkedAt: string | null;
  /** hasta que secuencia se escribio con OTRO personaje: esas no se firman */
  foreignUpTo?: number;
}

/** lo que la confirmacion necesita, calculado en main antes de enseñarla */
export interface OwnerChangePreview {
  characterLabel: string;
  turns: number;
  instructionsOutcome: 'character' | 'own' | 'none' | 'removed' | 'kept';
  hasOwnMemory: boolean;
  /** sin memoria propia, viaja su ficha retroactiva o su indice, escritos sin la ficha */
  inheritedMemory: boolean;
  recentMemoriesOn: boolean;
  excluded: boolean;
  backgroundCli: 'claude' | 'codex';
  reviewCalls: number;
  profilePhotoStays: boolean;
}

export interface LinkableCharacter {
  characterId: string;
  label: string;
}

// ---------------------------------------------------------------------------
// el aviso por nombre
// ---------------------------------------------------------------------------

/**
 * tildes fuera, por mapa y no por NFD: es lo que ya hace `vault-image-gate.ts`,
 * y un mapa no depende de como venga compuesto el texto.
 */
const ACCENTS: Record<string, string> = {
  á: 'a',
  à: 'a',
  â: 'a',
  ä: 'a',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  í: 'i',
  ì: 'i',
  î: 'i',
  ï: 'i',
  ó: 'o',
  ò: 'o',
  ô: 'o',
  ö: 'o',
  ú: 'u',
  ù: 'u',
  û: 'u',
  ü: 'u',
  ñ: 'n',
  ç: 'c',
};

/**
 * minusculas, sin tildes y con las letras repetidas juntadas («liaaa» es «lia»).
 *
 * Vale para una palabra y para un texto entero, y la criba de
 * `charactersNamedIn` depende de que sea LA MISMA funcion: sin mirar el final de
 * una cadena que crece, que con un mensaje largo costaba mas que trocearlo.
 */
function normalizeToken(text: string): string {
  const parts: string[] = [];
  let last = '';
  for (const char of text.toLocaleLowerCase('es')) {
    const plain = ACCENTS[char] ?? char;
    if (plain === last) continue;
    parts.push(plain);
    last = plain;
  }
  return parts.join('');
}

/**
 * palabras delante del nombre que lo convierten en otra cosa: «se lia», «me
 * lia», «la lia parda». Se acepta el falso negativo de «la Lia», con articulo.
 */
const CLITICS = new Set(['me', 'te', 'se', 'nos', 'os', 'le', 'les', 'lo', 'la', 'los', 'las', 'el', 'un', 'una']);

/**
 * nombres que tambien son palabras corrientes: «camiseta rosa» no habla de Rosa.
 * Solo cuentan en mayuscula a mitad de frase o con el nombre entero.
 */
const COMMON_WORDS = new Set([
  'luz',
  'sol',
  'mar',
  'paz',
  'rosa',
  'flor',
  'alba',
  'cielo',
  'angel',
  'blanca',
  'estrella',
  'perla',
  'dulce',
  'gloria',
  'victoria',
  'pilar',
  'rocio',
  'aurora',
  'sierra',
  'leon',
].map(normalizeToken));

/**
 * lo que no es texto de Daniel sino direcciones, correos y codigo: se quita
 * antes de partir en palabras, para que «github.com/lia/x» no salte.
 */
function stripNonProse(text: string): string {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/\S*[/\\]\S*/g, ' ')
    .replace(/\S+\.[a-z]{2,}\S*/gi, ' ');
}

interface Token {
  raw: string;
  norm: string;
  /** empieza frase: al principio o tras un signo de final */
  sentenceStart: boolean;
}

/**
 * las palabras de un texto, en una sola pasada.
 *
 * Antes copiaba el texto entero anterior a cada palabra para mirar su ultimo
 * signo: cuadratico, y con una conversacion larga sin dueño se notaba en cada
 * tecla (revision del 28/09). Basta con el hueco desde la palabra anterior: si
 * es solo espacio, lo ultimo antes de esta palabra es una letra de la otra.
 */
function tokenize(text: string): Token[] {
  const clean = stripNonProse(text);
  const tokens: Token[] = [];
  let previousEnd = 0;
  for (const match of clean.matchAll(/\p{L}+/gu)) {
    const index = match.index;
    // solo espacios y tabuladores: `trimEnd()` quitaba tambien el salto de
    // linea, y una linea nueva sin punto delante no contaba como inicio de
    // frase. La raya abre una intervencion de dialogo (revision del 28/09)
    const gap = clean.slice(previousEnd, index).replace(/[ \t]+$/u, '');
    const sentenceStart =
      gap.length === 0 ? tokens.length === 0 : '.!?¡¿:\n—'.includes(gap.slice(-1));
    tokens.push({
      raw: match[0],
      norm: normalizeToken(match[0]),
      sentenceStart,
    });
    previousEnd = index + match[0].length;
  }
  return tokens;
}

/** las dos claves de un nombre: el de pila y la secuencia entera */
function labelKeys(label: string): { first: string | null; sequence: string[] } {
  const all = label.split(/[^\p{L}]+/u).filter((part) => part.length > 0).map(normalizeToken);
  const head = label.split(/[([\-—–,·|:]/u)[0] ?? '';
  const firstRaw = head.split(/[^\p{L}]+/u).find((part) => part.length > 0) ?? null;
  return {
    first: firstRaw === null ? null : normalizeToken(firstRaw),
    sequence: all.length >= 1 && all.length <= 4 ? all : [],
  };
}

function mentions(tokens: readonly Token[], label: string): boolean {
  const { first, sequence } = labelKeys(label);
  // la secuencia entera de dos o mas palabras vale siempre: «Lia Martin» no es
  // una palabra corriente ni un clitico
  if (sequence.length >= 2) {
    for (let index = 0; index + sequence.length <= tokens.length; index += 1) {
      if (sequence.every((part, offset) => tokens[index + offset]!.norm === part)) return true;
    }
  }
  // un nombre de pila de dos letras casa con demasiadas cosas —«al», «su»—: solo
  // vale el nombre entero, que ya se ha mirado arriba
  if (first === null || first.length < 3) return false;
  const common = COMMON_WORDS.has(first);
  return tokens.some((token, index) => {
    if (token.norm !== first) return false;
    if (CLITICS.has(tokens[index - 1]?.norm ?? '')) return false;
    if (!common) return true;
    const capitalized = token.raw[0] !== undefined && token.raw[0] !== token.raw[0].toLocaleLowerCase('es');
    return capitalized && !token.sentenceStart;
  });
}

/**
 * a quien nombra Daniel en una conversacion que no es de nadie.
 *
 * Solo sus mensajes y el borrador: lo que escribio el modelo no cuenta. Sin
 * dueño y sin descarte; si casan varios, los devuelve todos y no elige.
 */
export function suggestCharacters(input: {
  userTexts: readonly string[];
  draft: string;
  characters: readonly LinkableCharacter[];
  ownerId: string | null;
  dismissed: boolean;
}): string[] {
  if (input.ownerId !== null || input.dismissed) return [];
  return suggestWithHistory({
    namedInHistory: charactersNamedIn(input.userTexts, input.characters),
    draft: input.draft,
    characters: input.characters,
    ownerId: input.ownerId,
    dismissed: input.dismissed,
  });
}

/**
 * a quien nombran unos textos, en el orden de la lista de personajes.
 *
 * Es la parte cara del aviso: trocea todo lo que escribio Daniel. Va aparte
 * para que la pantalla la memoice con los turnos y no la repita en cada tecla
 * del borrador ni en cada latido del estado (revision del 28/09).
 */
export function charactersNamedIn(
  texts: readonly string[],
  characters: readonly LinkableCharacter[],
): string[] {
  const named = characters.filter((character) => character.label.trim().length > 0);
  if (named.length === 0 || texts.length === 0) return [];
  // criba antes de trocear: casi ningun mensaje lleva el nombre, y partir en
  // palabras es lo caro. `normalizeToken` sobre el texto entero deja cada
  // palabra normalizada tal cual dentro —entre dos palabras siempre hay algo
  // que no es letra, asi que nada se junta entre ellas—: si la clave no esta
  // ahi, ninguna palabra puede casar. Solo descarta, nunca decide
  const keys = named.flatMap((character) => searchKeysOf(character.label));
  if (keys.length === 0) return [];
  const candidates = texts.filter((text) => {
    const flat = normalizeToken(text);
    return keys.some((key) => flat.includes(key));
  });
  if (candidates.length === 0) return [];
  const tokenized = candidates.map(tokenize);
  return named
    .filter((character) => tokenized.some((tokens) => mentions(tokens, character.label)))
    .map((character) => character.characterId);
}

/**
 * lo que tiene que aparecer para que `mentions` pueda casar por cada una de sus
 * dos vias: la primera palabra de la secuencia entera y el nombre de pila. Las
 * mismas condiciones que alli; vacio si no puede casar por ninguna.
 */
function searchKeysOf(label: string): string[] {
  const { first, sequence } = labelKeys(label);
  const keys: string[] = [];
  if (sequence.length >= 2) keys.push(sequence[0]!);
  if (first !== null && first.length >= 3) keys.push(first);
  return keys;
}

/**
 * el aviso con lo del historial ya calculado: solo se trocea el borrador.
 *
 * Da lo mismo que `suggestCharacters` con esos textos; `namedInHistory` tiene
 * que venir de `charactersNamedIn` con la MISMA lista de personajes.
 */
export function suggestWithHistory(input: {
  namedInHistory: readonly string[];
  draft: string;
  characters: readonly LinkableCharacter[];
  ownerId: string | null;
  dismissed: boolean;
}): string[] {
  if (input.ownerId !== null || input.dismissed) return [];
  const named = new Set([...input.namedInHistory, ...charactersNamedIn([input.draft], input.characters)]);
  return input.characters
    .filter((character) => named.has(character.characterId))
    .map((character) => character.characterId);
}

/** los textos de Daniel de una conversacion */
export function userTextsOf(turns: readonly { role: 'user' | 'assistant'; text: string }[]): string[] {
  return turns.filter((turn) => turn.role === 'user').map((turn) => turn.text);
}

/** «¿Es de Lia?», «¿Es de Lia o de Nora?» */
export function ownerHintQuestion(labels: readonly string[]): string {
  if (labels.length <= 1) return `¿Es de ${labels[0] ?? 'este personaje'}?`;
  const last = labels[labels.length - 1]!;
  return `¿Es de ${labels.slice(0, -1).join(', de ')} o de ${last}?`;
}

// ---------------------------------------------------------------------------
// los textos de la confirmacion
// ---------------------------------------------------------------------------

const CLI_NAMES: Record<OwnerChangePreview['backgroundCli'], string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/**
 * la frase de la casilla, tal y como sale en la ficha.
 *
 * Decia «Recordar sus dos últimas conversaciones», y no las recuerda: le llega
 * lo que se apuntó de cada una (`D-105`, `D-093`). Fue «un resumen corto»
 * mientras viajaban 400 caracteres; desde la quinta ronda le llega la memoria
 * entera, sin el plan ni las preguntas en el aire
 */
export const RECENT_MEMORIES_CHECKBOX = 'Pasarle la memoria de sus dos últimas conversaciones';

/**
 * lo que pasa al enganchar, un parrafo por elemento.
 *
 * Todo sale del `preview` que calcula main: ninguna frase afirma algo que no
 * dependa de un dato comprobado alli.
 */
export function describeCharacterLink(
  preview: OwnerChangePreview,
  /**
   * si su ficha tiene texto. Sale de la lista de personajes que ya tiene la
   * pantalla —la misma boveda de la que main la sella— porque la vista previa
   * no lo trae, y con la ficha vacia «te responde con su ficha» era falso: main
   * sella el enganche sin ficha y el prompt sale sin «QUIEN ERES» (`D-093`)
   */
  character: { hasDescription: boolean },
): string[] {
  const label = preview.characterLabel;
  const paragraphs: string[] = [];

  const instructions =
    preview.instructionsOutcome === 'character'
      ? ' y con sus instrucciones.'
      : preview.instructionsOutcome === 'own'
        ? '; se quedan las instrucciones que ya tenía esta conversación, las suyas no se cargan.'
        : `. ${label} no tiene instrucciones guardadas.`;
  paragraphs.push(
    character.hasDescription
      ? `Desde ya, esta conversación es de ${label}, entera: también sus ${preview.turns} mensajes anteriores, que se escribieron sin su ficha. Sale en su grupo, y desde tu próximo mensaje aquí te responde con su ficha${instructions}`
      : // main toma la ficha EDITADA en el turno siguiente a rellenarla, asi
        // que la salida es escribirla, no volver a enganchar
        `Desde ya, esta conversación es de ${label}, entera: también sus ${preview.turns} mensajes anteriores. Sale en su grupo, pero su ficha está vacía: desde tu próximo mensaje aquí se responde sin ninguna descripción de quién es${instructions} Si rellenas su ficha, le llega desde el mensaje siguiente.`,
  );

  // la memoria sellada se escribio sin la ficha: es la diferencia que la
  // reescritura cierra (`D-108`). Lo que se le PIDE al CLI y lo que hace el
  // codigo si no sale bien, no lo que el modelo vaya a hacer (`D-093`)
  if (preview.hasOwnMemory && !preview.excluded) {
    // con la ficha vacia el encargo no lleva descripcion (`buildMemoryRelinkPrompt`):
    // solo se puede corregir el nombre, y decir «con su ficha» seria prometer mas
    const encargo = character.hasDescription
      ? 'Se va a reescribir con su ficha'
      : 'Se va a reescribir con su nombre (su ficha está vacía)';
    const cambios = character.hasDescription
      ? 'que solo cambie cómo se la nombra y lo que su ficha contradiga'
      : 'que solo cambie cómo se la nombra';
    paragraphs.push(
      `La memoria que se fue escribiendo en esta conversación la escribió el modelo sin la ficha de ${label}. ${encargo}, en segundo plano, con ${CLI_NAMES[preview.backgroundCli]} y tu sesión: una llamada más, en la misma cola que los pendientes. Se le pide ${cambios}, y que deje igual lo que pasó entre vosotros. Si ${CLI_NAMES[preview.backgroundCli]} se niega, o la reescrita quita o recorta más de dos entradas o más de la mitad de las que había, o deja el resumen o el resto en menos de la mitad, o acorta mucho el resumen o el resto, o cambia la mayor parte de las palabras del resumen, no se aplica y sigue valiendo la de ahora. Si quita o recorta una o dos, sin pasar de la mitad, se aplica igual: eso deja de viajar. Lo que añada también se aplica, y en «Lo que recuerda» se cuenta. Hasta que esté lista, sigue valiendo la de ahora. En «Lo que recuerda» verás en qué quedó, y podrás volver a la de antes hasta que un mensaje tuyo aquí guarde memoria nueva.`,
    );
  } else if (preview.hasOwnMemory) {
    paragraphs.push(
      `La memoria que se fue escribiendo en esta conversación la escribió el modelo sin la ficha de ${label}, y no se va a reescribir con ella: esta conversación está fuera del trabajo de fondo. Puedes verla y borrarla en «Lo que recuerda»; borrarla solo afecta a este ordenador.`,
    );
  } else if (preview.inheritedMemory && !preview.excluded) {
    // sin memoria sellada viaja la ficha retroactiva o el indice, escritos por
    // un CLI que no veia la ficha de nadie, y no hay nada que reescribir hasta
    // que se selle la primera: esa es la que se reescribe (septima ronda)
    paragraphs.push(
      `Esta conversación no tiene todavía memoria propia: lo que le llega de ella es su ficha retroactiva o el índice de sus escenas, que escribió un CLI sin la ficha de ${label}, y así será también en tu próximo mensaje aquí. La memoria que guarde esa respuesta sale de ahí, y es esa la que se reescribirá con su ficha después, en segundo plano, con ${CLI_NAMES[preview.backgroundCli]} y tu sesión: una llamada más.`,
    );
  }

  // lo que NO se puede igualar: la cola literal viaja tal cual en cada prompt, y
  // esos mensajes se escribieron sin la ficha. Con `VAULT_RECENT_TURNS` turnos,
  // el primero de los de antes sale de la ventana en el mensaje numero
  // `VAULT_RECENT_TURNS / 2 + 1` de el.
  //
  // Y salir de la ventana no es dejar de leerlos: `buildRecall` transcribe
  // momentos enteros cuando el mensaje evoca uno —«¿te acuerdas de…?», una
  // fecha—, y el indice pasa a ser suyo, asi que tambien desde sus otras
  // conversaciones; lo mismo el titulo y el «de que fue» de sus escenas.
  // Decia que los dejaria de leer, y era falso (septima ronda, `D-093`)
  paragraphs.push(
    `Lo que no cambia: sus últimos mensajes de aquí (hasta ${VAULT_RECENT_TURNS}, tuyos y suyos) le siguen llegando tal cual en cada respuesta, y se escribieron sin su ficha. Si en ellos se la llamaba de otra forma o hablaba como otra, lo leerá tal cual hasta que tus próximos ${VAULT_RECENT_TURNS / 2} mensajes los dejen atrás. Y aun después pueden volver: cuando algo que escribas le recuerde un momento de antes del enganche —«¿te acuerdas de cuando…?», una fecha—, se le pueden transcribir trozos de esos mensajes, aquí y en sus otras conversaciones, igual que el título de esas escenas y lo que el catálogo apuntó de ellas. Eso no se reescribe.`,
  );

  if (preview.excluded) {
    paragraphs.push(
      'Esta conversación está excluida de lo que recuerda: aunque pase a ser suya, desde sus otras conversaciones no la verá ni le llegará su memoria.',
    );
  } else if (preview.recentMemoriesOn && preview.hasOwnMemory) {
    paragraphs.push(
      // «le llegará», no «la recordará»: lo comprobado es que la memoria viaja,
      // y el propio bloque le pide no sacarla por su cuenta (`D-093`).
      //
      // CUAL de las dos: la reescrita se lleva fuera en cuanto esta lista (se
      // apunta como usada antes, octava ronda); hasta entonces, la de ahora. Y
      // «entera» con su salvedad: la salvaguarda quita entradas viejas por
      // encima de `RECENT_MEMORY_ENTRY_CHARS`, y el esquema admite mas
      `Desde sus otras conversaciones le llegará esa memoria entera —la de ahora mientras la reescrita no esté lista, y la reescrita cuando lo esté—, salvo el plan y las preguntas que quedaron en el aire, porque tiene encendida «${RECENT_MEMORIES_CHECKBOX}», y solo mientras esta sea una de sus dos conversaciones más recientes: engancharla cuenta como reciente, pero en cuanto haya dos más nuevas deja de llegarle. Si pasara de ${thousands(RECENT_MEMORY_ENTRY_CHARS)} caracteres, se le quitarían primero las entradas más viejas. No le llegan los mensajes por esta vía, solo lo que apuntó el modelo, que puede no incluir todo lo que acordasteis; los trozos que se le pueden transcribir van aparte, como dice arriba.`,
    );
  } else if (preview.recentMemoriesOn) {
    // «si la aprobaste» no bastaba: `chooseConversationMemory` exige ademas que
    // la ficha sea de la version actual y llegue hasta los ultimos mensajes
    paragraphs.push(
      `Esta conversación no tiene todavía memoria propia apuntada. Lo que le llegue de ella a sus otras conversaciones solo puede salir de su ficha retroactiva, y solo si está aprobada y al día con los últimos mensajes; si no, de momento no hay nada que llevarle. Y aunque lo haya, solo mientras esta sea una de sus dos conversaciones más recientes: en cuanto haya dos más nuevas deja de llegarle.`,
    );
  } else {
    // nada de «la vera entre sus momentos»: el indice lleva como mucho 40, los
    // mas recientes y el primero, y los de una conversacion vieja conservan su
    // fecha, asi que pueden quedarse fuera. Y leer un trozo depende de que la
    // busqueda acierte (`D-093`)
    paragraphs.push(
      `Desde sus otras conversaciones no le llegará la memoria de esta: su casilla «${RECENT_MEMORIES_CHECKBOX}» está apagada. Lo que el catálogo haya sacado de aquí pasa a ser suyo, pero su índice solo enseña los momentos más recientes, así que si esta conversación es antigua puede que no la vea; si le preguntas por algo concreto de aquí, puede que lo encuentre. La casilla está en su fila de la lista de personajes, dentro de «Generar imagen o vídeo».`,
    );
  }

  paragraphs.push(
    preview.excluded
      ? 'Esta conversación está fuera del trabajo de fondo, así que sus promesas no se revisan.'
      : // hasta que esa pasada termine, sus turnos cuentan como sin revisar y la
        // guarda de desfase calla las promesas de ella anteriores a ellos, en
        // TODAS sus conversaciones: es el lado seguro, pero hay que decirlo
        `Lo prometido aquí se volverá a revisar como suyo, en segundo plano, con ${CLI_NAMES[preview.backgroundCli]} y tu sesión: ${preview.reviewCalls <= 1 ? 'una llamada' : `unas ${preview.reviewCalls} llamadas`}. Hasta que termine, puede que sus pendientes anteriores no le lleguen en ninguna de sus conversaciones.`,
  );
  // «solo en este equipo» no se entendia. Y no puede dar a entender que lo
  // demas si viaja: la sincronizacion no se ha usado nunca y tiene fallos
  // abiertos (`SEG-SYNC-001`). Cuando se arregle, esta frase cambia
  paragraphs.push(syncParagraph(label));
  paragraphs.push('Se deshace con «Soltar», junto al selector de personaje. No se borra nada.');
  return paragraphs;
}

/**
 * lo que se dice del enganche y la sincronizacion, en la confirmacion.
 *
 * Verdad de hoy en el codigo: el enganche y la memoria reescrita viven en
 * archivos de este ordenador que «Sincronizar» no sube, y «Sincronizar» tiene
 * fallos sin arreglar (`SEG-SYNC-001`).
 */
export function syncParagraph(label: string): string {
  return `El enganche, y la memoria reescrita con su ficha, se guardan solo en este ordenador: «Sincronizar» no los sube, así que en otro ordenador esta conversación seguiría sin ser de ${label}. Y no cuentes con «Sincronizar» como copia de nada de la bóveda: hoy tiene fallos sin arreglar.`;
}

/**
 * la pista del selector en una conversacion enganchada.
 *
 * Sustituye a «Solo en este equipo», que Daniel no entendio. Dice lo mismo sin
 * abreviar y sin sugerir que el resto de la boveda si viaja (`SEG-SYNC-001`).
 */
export function linkedOwnerHint(label: string, linkedAt: string | null): string {
  const cuando = linkedAt === null ? '' : ` el ${shortDate(linkedAt)}`;
  return `Enganchada a ${label}${cuando}. El enganche se guarda solo en este ordenador: «Sincronizar» no lo sube, y hoy no sirve de copia de nada de la bóveda.`;
}

/** lo que pasa al soltar un enganche propio */
export function describeCharacterUnlink(preview: OwnerChangePreview): string[] {
  const label = preview.characterLabel;
  const paragraphs = [
    `Esta conversación deja de ser de ${label}: sale de su grupo, de sus momentos y de la memoria que les llega a sus otras conversaciones, y desde tu próximo mensaje aquí se responde sin su ficha${
      preview.instructionsOutcome === 'removed'
        ? ', y sin las instrucciones que se cargaron al engancharla.'
        : '; las instrucciones se quedan como están.'
    }`,
  ];
  if (!preview.excluded) {
    paragraphs.push('Lo prometido aquí se revisará otra vez como de nadie.');
  }
  if (preview.recentMemoriesOn && !preview.excluded) {
    // lo sabido y no arreglado de `D-105`: la memoria de otra conversacion es de
    // aquella, y soltar esta no la toca. Con la memoria entera pesa mas
    paragraphs.push(
      'Si alguna de sus otras conversaciones ya apuntó en su propia memoria algo de lo que le llegó de aquí, eso se queda: esa memoria es de aquella conversación.',
    );
  }
  if (preview.hasOwnMemory) {
    // la reescrita era de ESE enganche y se va con el (`D-108`); lo que ya se
    // sello a partir de ella es memoria de la conversacion y se queda
    paragraphs.push(
      'Si su memoria se había reescrito con su ficha, la reescrita se quita: vuelve a valer la última guardada en la conversación, que será la de antes si ningún mensaje la ha sustituido todavía.',
    );
  }
  if (preview.profilePhotoStays) {
    paragraphs.push('Su foto de perfil, que se copió a esta conversación, se queda entre sus imágenes.');
  }
  paragraphs.push('No se borra nada, y puedes volver a engancharla.');
  return paragraphs;
}

// ---------------------------------------------------------------------------
// titulo, firma y separador
// ---------------------------------------------------------------------------

/** «Conversación privada · Lia», «· sin personaje» */
export function ownerTitle(owner: OwnerView | null, draftLabel: string | null): string {
  if (owner === null) {
    return draftLabel === null ? 'Conversación privada' : `Conversación privada · ${draftLabel}`;
  }
  if (owner.source === 'none') return 'Conversación privada · sin personaje';
  return `Conversación privada · ${owner.label ?? 'personaje que ya no está'}`;
}

/**
 * quien firma un turno.
 *
 * En una ENGANCHADA, sus respuestas llevan su nombre tambien antes del ancla
 * (`D-108`): el criterio de Daniel es que una conversacion que pasa a ser suya
 * quede como si hubiera empezado con ella, y lo de antes se escribio sin la
 * ficha de nadie. Salvo lo escrito con la ficha de OTRO personaje
 * (`foreignUpTo`): una conversacion de Lía que se solto y se engancho a Nora
 * no firma «Nora» lo que escribio Lía (octava ronda, `D-093`).
 *
 * Con dueño por un turno —las del Studio anterior, que fijaba el personaje en
 * cualquier mensaje— se firma como en `a45953b`: solo lo de despues de ese
 * turno. Nadie las engancho, y lo de antes pudo escribirse con otra ficha.
 * Sin dueño, «Respuesta».
 */
export function replySpeaker(
  turn: { role: 'user' | 'assistant'; sequence: number },
  owner: OwnerView | null,
): string {
  if (turn.role === 'user') return 'Tú';
  if (owner === null || owner.label === null) return 'Respuesta';
  if (owner.source === 'link') {
    return owner.foreignUpTo !== undefined && turn.sequence <= owner.foreignUpTo
      ? 'Respuesta'
      : owner.label;
  }
  if (owner.signedAfter === null) return 'Respuesta';
  return turn.sequence > owner.signedAfter ? owner.label : 'Respuesta';
}

/** «6.000»: con punto de miles desde el millar, como se escribe en la pantalla */
function thousands(value: number): string {
  return String(Math.trunc(value)).replace(/(?<=[0-9])(?=(?:[0-9]{3})+$)/g, '.');
}

/** una fecha corta y local: «25/09, 10:30» */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * el separador que se pinta despues del turno del ancla de un enganche.
 *
 * Solo la fecha: ya no dice «lo de arriba se escribio sin su ficha», porque la
 * conversacion entera es suya y firma con su nombre (`D-108`). Lo que si sigue
 * siendo distinto —que esos mensajes viajan tal cual— lo dice la confirmacion
 * antes de enganchar.
 */
export function linkSeparator(owner: OwnerView): string | null {
  if (owner.source !== 'link' || owner.label === null || owner.linkedAt === null) return null;
  return `Enganchada a ${owner.label} el ${shortDate(owner.linkedAt)}.`;
}
