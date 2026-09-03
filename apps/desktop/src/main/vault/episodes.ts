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
   * tope de turnos por episodio. **Por defecto no hay.**
   *
   * Historia, porque cuesta de creer: primero se cortaba por el numero, y
   * partia escenas por la mitad. Se cambio a cortar por la pausa mas larga del
   * tramo, y con conversaciones reales resulto ser PEOR: cuando alguien habla
   * de una sentada, todos los turnos estan a minutos unos de otros y «la pausa
   * mas larga» es donde tardo mas en escribir. Nada que ver con donde cambia la
   * escena. La unica ruptura de verdad de aquel registro —ella se duerme, y
   * luego amanece— era narrativa y ningun reloj la ve.
   *
   * Un corte falso produce un titulo falso, y el titulo es de lo que depende que
   * un recuerdo se encuentre. Asi que ahora un episodio es un tramo continuo y
   * punto: **pocos limites, pero todos ciertos**. Partir por escenas exige leer
   * lo que se dice, y eso es F10.6.
   *
   * Se conserva el parametro para quien quiera un tope duro; sin el, no se
   * parte por numero.
   */
  maxTurns?: number;
}

const DEFAULT_GAP_MS = 6 * 60 * 60 * 1000;
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
  const maxTurns = options.maxTurns;

  const episodes: Episode[] = [];
  let current: EpisodeTurn[] = [];

  const close = (): void => {
    if (current.length === 0) return;
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
 * trocea un tramo si se pidio un tope duro.
 *
 * Sin `maxTurns` no se parte nada: cualquier corte dentro de una conversacion
 * continua seria inventado, y un corte inventado da un titulo que no describe
 * lo que hay dentro.
 */
function splitLongRun(turns: readonly EpisodeTurn[], maxTurns: number | undefined): EpisodeTurn[][] {
  if (maxTurns === undefined || turns.length <= maxTurns) return [[...turns]];
  return [[...turns.slice(0, maxTurns)], ...splitLongRun(turns.slice(maxTurns), maxTurns)];
}

/** milisegundos entre dos marcas, o `null` si alguna no se entiende */
function elapsedMs(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return end - start;
}
