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

/** lo que el proceso principal dice del dueño de la conversacion abierta */
export interface OwnerView {
  source: 'none' | 'turn' | 'link';
  label: string | null;
  signedAfter: number | null;
  linkedAt: string | null;
}

/** lo que la confirmacion necesita, calculado en main antes de enseñarla */
export interface OwnerChangePreview {
  characterLabel: string;
  turns: number;
  instructionsOutcome: 'character' | 'own' | 'none' | 'removed' | 'kept';
  hasOwnMemory: boolean;
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
    const gap = clean.slice(previousEnd, index).trimEnd();
    const sentenceStart =
      gap.length === 0 ? tokens.length === 0 : '.!?¡¿:\n'.includes(gap.slice(-1));
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
 * un resumen corto de cada una (`D-105`, `D-093`; revision del 28/09)
 */
export const RECENT_MEMORIES_CHECKBOX = 'Pasarle un resumen corto de sus dos últimas conversaciones';

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

  if (preview.hasOwnMemory) {
    paragraphs.push(
      `La memoria que se fue escribiendo en esta conversación la escribió el modelo sin su ficha: no tenía la descripción de ${label}. Puedes verla y borrarla en «Lo que recuerda»; borrarla solo afecta a este equipo.`,
    );
  }

  if (preview.excluded) {
    paragraphs.push(
      'Esta conversación está excluida de lo que recuerda: aunque pase a ser suya, desde sus otras conversaciones no la verá ni le llegará su resumen.',
    );
  } else if (preview.recentMemoriesOn && preview.hasOwnMemory) {
    paragraphs.push(
      // «le llegará», no «la recordará»: lo comprobado es que el resumen viaja,
      // y el propio bloque le pide no sacarlo por su cuenta (`D-093`)
      `Desde sus otras conversaciones le llegará un resumen corto de esa memoria, porque tiene encendida «${RECENT_MEMORIES_CHECKBOX}», y solo mientras esta sea una de sus dos conversaciones más recientes: engancharla cuenta como reciente, pero en cuanto haya dos más nuevas sale del resumen. El resumen puede no incluir todo lo que acordasteis.`,
    );
  } else if (preview.recentMemoriesOn) {
    // «si la aprobaste» no bastaba: `chooseConversationMemory` exige ademas que
    // la ficha sea de la version actual y llegue hasta los ultimos mensajes
    paragraphs.push(
      `Esta conversación no tiene todavía memoria propia apuntada. Su resumen solo puede salir de su ficha retroactiva, y solo si está aprobada y al día con los últimos mensajes; si no, de momento no hay resumen que llevarle a sus otras conversaciones. Y aunque lo haya, solo mientras esta sea una de sus dos conversaciones más recientes: en cuanto haya dos más nuevas sale del resumen.`,
    );
  } else {
    // nada de «la vera entre sus momentos»: el indice lleva como mucho 40, los
    // mas recientes y el primero, y los de una conversacion vieja conservan su
    // fecha, asi que pueden quedarse fuera. Y leer un trozo depende de que la
    // busqueda acierte (`D-093`)
    paragraphs.push(
      `Desde sus otras conversaciones no le llegará ningún resumen de esta: su casilla «${RECENT_MEMORIES_CHECKBOX}» está apagada. Lo que el catálogo haya sacado de aquí pasa a ser suyo, pero su índice solo enseña los momentos más recientes, así que si esta conversación es antigua puede que no la vea; si le preguntas por algo concreto de aquí, puede que lo encuentre. La casilla está en su fila de la lista de personajes, dentro de «Generar imagen o vídeo».`,
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
  paragraphs.push(
    'De momento solo vale en este equipo: el enganche se guarda cifrado aquí y «Sincronizar» no lo sube.',
  );
  paragraphs.push('Se deshace con «Soltar», junto al selector de personaje. No se borra nada.');
  return paragraphs;
}

/** lo que pasa al soltar un enganche propio */
export function describeCharacterUnlink(preview: OwnerChangePreview): string[] {
  const label = preview.characterLabel;
  const paragraphs = [
    `Esta conversación deja de ser de ${label}: sale de su grupo, de sus momentos y de su resumen, y desde tu próximo mensaje aquí se responde sin su ficha${
      preview.instructionsOutcome === 'removed'
        ? ', y sin las instrucciones que se cargaron al engancharla.'
        : '; las instrucciones se quedan como están.'
    }`,
  ];
  if (!preview.excluded) {
    paragraphs.push('Lo prometido aquí se revisará otra vez como de nadie.');
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
 * Una respuesta solo lleva el nombre si se escribio con su ficha: desde la
 * posicion del dueño en adelante. Lo de antes de un enganche dice «Respuesta».
 */
export function replySpeaker(
  turn: { role: 'user' | 'assistant'; sequence: number },
  owner: OwnerView | null,
): string {
  if (turn.role === 'user') return 'Tú';
  if (owner === null || owner.label === null || owner.signedAfter === null) return 'Respuesta';
  return turn.sequence > owner.signedAfter ? owner.label : 'Respuesta';
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

/** el separador que se pinta despues del turno del ancla de un enganche */
export function linkSeparator(owner: OwnerView): string | null {
  if (owner.source !== 'link' || owner.label === null || owner.linkedAt === null) return null;
  return `Enganchada a ${owner.label} el ${shortDate(owner.linkedAt)}. Lo de arriba se escribió sin su ficha.`;
}
