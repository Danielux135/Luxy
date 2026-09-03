// episodios: tramos de conversacion que se pueden rememorar.
//
// Un episodio es un rango contiguo de turnos de UNA conversacion. No guarda
// texto: guarda donde esta el texto. El contenido son los turnos, que ya viven
// cifrados y numerados (`D-058`).
//
// **No se persisten.** El plan original hablaba de un almacen cifrado propio, y
// sobra: un episodio se deduce por completo de los turnos, que ya estan en
// disco. Guardarlo añadiria un esquema, una migracion y la posibilidad de que
// el almacen y los turnos se separen; recalcularlo al abrir la boveda cuesta
// una pasada sobre una lista que ya se ha leido entera. Lo unico que si habra
// que guardar algun dia son los titulos y etiquetas que escriba un modelo
// (F10.6), porque eso no se deduce de nada.
//
// La segmentacion es DETERMINISTA y sin modelo: corta donde la propia
// conversacion se corta. Asi las conversaciones que ya existen entran solas, sin
// pedirle permiso a nadie ni gastar una llamada.

/** lo que hace falta de un turno para agruparlo; es lo que ya devuelve el almacen */
export interface EpisodeTurn {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface Episode {
  conversationId: string;
  /** primer y ultimo `sequence` del tramo, ambos incluidos */
  from: number;
  to: number;
  startedAt: string;
  endedAt: string;
  turns: number;
  /**
   * titulo provisional, deducido sin modelo del primer mensaje del usuario.
   *
   * Es lo que se puede saber sin gastar una llamada. Sirve para reconocer un
   * episodio en una lista; no sirve para encontrarlo por parafrasis, que es
   * justo lo que añadiria F10.6.
   */
  title: string;
}

export interface SegmentOptions {
  /**
   * silencio que separa dos escenas.
   *
   * Seis horas: separa la conversacion de anoche de la de esta mañana sin
   * partir una tarde larga. Una pausa para cenar no abre un episodio nuevo.
   */
  gapMs?: number;
  /**
   * tope de turnos por episodio.
   *
   * NO existe para que quepa en el prompt —de eso se encarga el recorte al
   * citar—, sino para no perder granularidad: una sesion de un dia entero
   * seria un solo episodio con un titulo que solo describe su principio.
   *
   * Cuando se supera, el corte cae en la PAUSA MAS LARGA del tramo y no en el
   * turno que hace el numero. Cortar por el numero partia una escena por la
   * mitad y separaba el principio de su continuacion.
   */
  maxTurns?: number;
}

const DEFAULT_GAP_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_TURNS = 40;

/**
 * turnos minimos a cada lado de un corte por pausa.
 *
 * Sin esto, una pausa larga en el segundo turno dejaria un episodio de uno, que
 * no es un momento que nadie quiera recordar.
 */
const MIN_EPISODE_TURNS = 4;
const MAX_TITLE_LENGTH = 70;

/**
 * titulo a partir del primer mensaje del usuario del tramo.
 *
 * El del usuario y no el de la respuesta: dice a que vino la escena, y ademas es
 * corto. Si el tramo no tiene ninguno, se cae al primer turno que haya.
 */
function deriveTitle(turns: readonly EpisodeTurn[]): string {
  const source = turns.find((turn) => turn.role === 'user') ?? turns[0];
  if (source === undefined) return 'sin contenido';

  // los asteriscos de la accion no aportan nada a un titulo de una linea
  const flat = source.text.replace(/[*_`]/g, ' ').replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return 'sin contenido';
  if (flat.length <= MAX_TITLE_LENGTH) return flat;
  return `${flat.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * parte los turnos de UNA conversacion en episodios.
 *
 * Espera los turnos en orden y de la misma conversacion; agrupar por
 * conversacion es del que llama, que es quien las tiene.
 */
export function segmentIntoEpisodes(
  turns: readonly EpisodeTurn[],
  options: SegmentOptions = {},
): Episode[] {
  if (turns.length === 0) return [];

  const gapMs = options.gapMs ?? DEFAULT_GAP_MS;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

  const episodes: Episode[] = [];
  let current: EpisodeTurn[] = [];

  const close = (): void => {
    if (current.length === 0) return;
    // un tramo largo se trocea por sus pausas, no por el numero de turnos
    for (const piece of splitLongRun(current, maxTurns)) {
      const first = piece[0]!;
      const last = piece[piece.length - 1]!;
      episodes.push({
        conversationId: first.conversationId,
        from: first.sequence,
        to: last.sequence,
        startedAt: first.createdAt,
        endedAt: last.createdAt,
        turns: piece.length,
        title: deriveTitle(piece),
      });
    }
    current = [];
  };

  for (const turn of turns) {
    const previous = current[current.length - 1];
    if (previous !== undefined) {
      const silence = elapsedMs(previous.createdAt, turn.createdAt);
      // una fecha ilegible no debe partir la conversacion en pedazos: ante la
      // duda se mantiene el tramo, que es el fallo menos dañino
      if (silence !== null && silence >= gapMs) close();
    }
    current.push(turn);
  }
  close();

  return episodes;
}

/**
 * parte un tramo demasiado largo por su pausa mas marcada.
 *
 * El tramo ya no tiene ningun silencio de los que separan escenas —eso lo
 * decidio la pasada anterior—, pero dentro sigue habiendo pausas relativas, y
 * una de ellas es la costura mas probable. Cortar ahi se parece a donde lo
 * cortaria una persona; cortar en el turno que hace el numero, no.
 */
function splitLongRun(turns: readonly EpisodeTurn[], maxTurns: number): EpisodeTurn[][] {
  if (turns.length <= maxTurns) return [[...turns]];

  const at = largestGapIndex(turns);
  if (at === null) {
    // ni una pausa: no hay costura, asi que se corta por el tope. Ultimo recurso
    return [
      [...turns.slice(0, maxTurns)],
      ...splitLongRun(turns.slice(maxTurns), maxTurns),
    ];
  }
  return [...splitLongRun(turns.slice(0, at), maxTurns), ...splitLongRun(turns.slice(at), maxTurns)];
}

/**
 * cuanto tiene que destacar una pausa para valer como costura.
 *
 * Sin este listón, un tramo de ritmo constante —un turno por minuto durante una
 * hora— tendria «una pausa mas larga» que no significa nada, y el corte caeria
 * en el primer sitio permitido. Peor que cortar por el numero.
 */
const GAP_STANDOUT_FACTOR = 3;

/**
 * indice donde empieza el tramo siguiente, o `null` si no hay costura.
 *
 * `null` no es un fallo: significa que la conversacion fue seguida y no hay
 * ningun sitio mejor que otro para partirla.
 */
function largestGapIndex(turns: readonly EpisodeTurn[]): number | null {
  const gaps: { index: number; silence: number }[] = [];
  for (let index = 1; index < turns.length; index += 1) {
    const silence = elapsedMs(turns[index - 1]!.createdAt, turns[index]!.createdAt);
    if (silence !== null && silence > 0) gaps.push({ index, silence });
  }
  if (gaps.length === 0) return null;

  const typical = median(gaps.map((gap) => gap.silence));
  let best: { index: number; silence: number } | null = null;

  for (const gap of gaps) {
    // los extremos no valen: una pausa en el segundo turno dejaria un episodio
    // de uno, que no es un momento que nadie quiera recordar
    if (gap.index < MIN_EPISODE_TURNS) continue;
    if (gap.index > turns.length - MIN_EPISODE_TURNS) continue;
    if (gap.silence < typical * GAP_STANDOUT_FACTOR) continue;
    if (best === null || gap.silence > best.silence) best = gap;
  }
  return best?.index ?? null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

/** milisegundos entre dos marcas, o `null` si alguna no se entiende */
function elapsedMs(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return end - start;
}
