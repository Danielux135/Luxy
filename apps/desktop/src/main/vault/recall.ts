// decide que recuerda el personaje en este turno.
//
// Dos niveles (`D-058`), y el reparto de trabajo es lo importante:
//
//   - las LINEAS de todos los episodios van siempre. Cuestan ~40 tokens cada
//     una y hacen que el personaje SEPA que ocurrio algo aunque la busqueda no
//     acierte. Que la busqueda falle deja de significar que no se acuerda;
//   - un episodio TRANSCRITO va solo cuando de verdad se ha pedido rememorar.
//     Eso es lo caro en contexto, y es justo cuando se ha pedido.
//
// Todo se decide ANTES de la llamada: una sola llamada por turno. Con cobro por
// llamada, una segunda duplicaria la factura de cada mensaje que recuerde algo.
import type {
  VaultRecall,
  RecalledEpisodeLine,
  QuotedEpisode,
  TemporalAnchor,
} from '@luxy/shared';
import { civilDayLabel, resolveTemporalReference } from '@luxy/shared';
import type { PrivateMemory } from './private-memory.js';
import type { VaultService } from './vault-service.js';
import { normalizeTerm } from './turn-index.js';

/**
 * señales de que se esta pidiendo rememorar.
 *
 * No basta con que la frase mire al pasado: «ayer trabaje mucho» no pide ningun
 * recuerdo. Lo que se busca es que interpele a la memoria del personaje.
 */
const MEMORY_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(?:te )?acuerdas\b/,
  /\brecuerdas\b/,
  /\bacuerdate\b/,
  /\brecuerdame\b/,
  /\bte acordabas\b/,
  /\baquell?[ao]s? (?:vez|noche|dia|tarde|momento)\b/,
  /\bla primera vez\b/,
  /\bel primer dia\b/,
  /\bcuando nos (?:conocimos|vimos|presentamos)\b/,
  /\bque te dije\b/,
  /\bque me dijiste\b/,
  /\bhabiamos hablado\b/,
  /\bcomo empezo\b/,
];

/**
 * tope de lineas de indice.
 *
 * Cuarenta episodios son ~1.600 tokens sobre un prompt que ya va por 4.800. Con
 * el coste fuera de la ecuacion, lo que limita esto es no diluir las directivas
 * de personaje entre paginas de indice.
 */
const MAX_EPISODE_LINES = 40;

/** tope del episodio transcrito: mas alla, deja de caber comodamente */
const MAX_QUOTED_TURNS = 12;
const MAX_QUOTED_CHARS = 6000;

export interface RecallOptions {
  maxEpisodeLines?: number;
  maxQuotedTurns?: number;
  /**
   * desde cuando y en que zona se interpreta el mensaje.
   *
   * Hace falta para dos cosas distintas, y las dos estaban rotas:
   *
   * 1. FECHAR BIEN el indice. La linea se construia con
   *    `startedAt.slice(0, 10)`, que es la fecha UTC. Con España en UTC+2, toda
   *    conversacion entre las 22:00 y las 00:00 quedaba fechada el dia ANTERIOR,
   *    y el personaje contradecia una fecha que el usuario recuerda con certeza;
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
  alreadyInPrompt?: { conversationId: string; fromSequence: number };
}

/**
 * señales de que se pregunta por una CONVERSACION, no por un dia cualquiera.
 *
 * Existe por un fallo que se colo al añadir la busqueda por fecha: el modulo
 * temporal lee la referencia, no la intencion, asi que «hoy me duele la cabeza»
 * devuelve el dia de hoy perfectamente. Si una fecha bastara para disparar,
 * decirle eso le haria sacar la transcripcion de una conversacion entera.
 *
 * Con esto, «lo que hablamos el jueves» busca y «hoy me duele la cabeza» no.
 */
const CONVERSATION_RECALL_PATTERNS: readonly RegExp[] = [
  /\bhablamos\b/,
  /\bhablaste\b/,
  /\bhable\b/,
  /\bhablabamos\b/,
  /\bdijiste\b/,
  /\bdije\b/,
  /\bdijimos\b/,
  /\bcontaste\b/,
  /\bconte\b/,
  /\bcomentamos\b/,
  /\bcomentaste\b/,
  /\bpreguntaste\b/,
  /\bmensaje\b/,
  /\bconversacion\b/,
  /\bcharla\b/,
  /\blo de\b/,
  /\beso de\b/,
];

/**
 * true si el mensaje pregunta por lo que se dijo, ademas de nombrar un dia.
 *
 * Una fecha sola NO basta. Se comprueba aparte de `looksLikeMemoryRequest`
 * porque son dos cosas distintas: aquella busca «te acuerdas», y esta busca que
 * se hable de hablar.
 */
export function looksLikeConversationRecall(message: string): boolean {
  const normalized = normalizeTerm(message);
  return CONVERSATION_RECALL_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** true si el mensaje interpela a la memoria del personaje */
export function looksLikeMemoryRequest(message: string): boolean {
  const normalized = normalizeTerm(message);
  return MEMORY_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
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

  const visible = all.slice(0, options.maxEpisodeLines ?? MAX_EPISODE_LINES);
  const lines: RecalledEpisodeLine[] = visible.map((episode, position) => ({
    id: `r${position + 1}`,
    // el dia CIVIL local, no el UTC. Ver `anchor` en RecallOptions: cortar el
    // ISO fechaba mal todo lo hablado despues de las diez de la noche
    date:
      options.anchor === undefined
        ? episode.startedAt.slice(0, 10)
        : civilDayLabel(episode.startedAt, options.anchor),
    title: episode.title,
    turns: episode.turns,
  }));

  // POR FECHA ANTES QUE POR PALABRAS, y el orden importa.
  //
  // «¿te acuerdas de lo que hablamos el jueves?» no tiene ninguna palabra en
  // comun con lo que se dijo ese jueves, asi que la busqueda lexica no
  // encuentra nada: no es que acierte poco, es que no puede acertar. En cambio
  // los episodios SI saben cuando ocurrieron, y ese dato estaba sin usar.
  //
  // Una referencia de fecha ademas es una peticion de recuerdo por si sola: no
  // hace falta que el mensaje diga tambien «te acuerdas».
  const already = options.alreadyInPrompt;
  const cuando =
    options.anchor === undefined ? null : resolveTemporalReference(message, options.anchor);

  // la fecha SOLA no basta: tiene que preguntarse por algo dicho, o por su
  // memoria. Si no, «hoy me duele la cabeza» sacaria la transcripcion de hoy
  const preguntaPorLoDicho =
    looksLikeMemoryRequest(message) || looksLikeConversationRecall(message);

  if (cuando !== null && cuando.kind !== 'principio' && preguntaPorLoDicho) {
    const dentro = visible.filter((episode) => {
      const inicio = episode.startedAt;
      return inicio >= cuando.from && inicio < cuando.to;
    });
    // si el dia tiene varios episodios se cita el mas largo: es el que de
    // verdad se recuerda como «lo que hablamos», no el saludo de dos turnos
    const elegido = [...dentro].sort((a, b) => b.turns - a.turns)[0];
    if (elegido !== undefined) {
      const yaVa =
        already !== undefined &&
        elegido.conversationId === already.conversationId &&
        elegido.from >= already.fromSequence;
      if (!yaVa) {
        const position = visible.findIndex(
          (candidate) =>
            candidate.conversationId === elegido.conversationId &&
            candidate.from === elegido.from,
        );
        if (position >= 0) {
          const turns = await memory.readEpisode(vault, elegido);
          return {
            episodes: lines,
            quoted: {
              ...lines[position]!,
              conversation: capConversation(
                turns.map((turn) => ({ role: turn.role, text: turn.text })),
                options.maxQuotedTurns ?? MAX_QUOTED_TURNS,
              ),
            },
          };
        }
      }
    }
  }

  if (!looksLikeMemoryRequest(message)) return { episodes: lines, quoted: null };

  const matches = await memory.search(vault, message, {
    limit: 5,
    characterId: options.characterId ?? null,
  });

  for (const match of matches) {
    const episode = match.episode;
    if (episode === undefined) continue;
    // lo que ya va como historial reciente no se transcribe otra vez
    if (
      already !== undefined &&
      episode.conversationId === already.conversationId &&
      episode.from >= already.fromSequence
    ) {
      continue;
    }

    const position = visible.findIndex(
      (candidate) =>
        candidate.conversationId === episode.conversationId && candidate.from === episode.from,
    );
    if (position < 0) continue;

    const turns = await memory.readEpisode(vault, episode);
    const quoted: QuotedEpisode = {
      ...lines[position]!,
      conversation: capConversation(
        turns.map((turn) => ({ role: turn.role, text: turn.text })),
        options.maxQuotedTurns ?? MAX_QUOTED_TURNS,
      ),
    };
    return { episodes: lines, quoted };
  }

  return { episodes: lines, quoted: null };
}

/**
 * recorta el episodio transcrito.
 *
 * Se conserva el PRINCIPIO y no el final: cuando alguien pregunta por un
 * momento, quiere como fue, no como acabo.
 */
function capConversation(
  turns: { role: 'user' | 'assistant'; text: string }[],
  maxTurns: number,
): { role: 'user' | 'assistant'; text: string }[] {
  const kept: { role: 'user' | 'assistant'; text: string }[] = [];
  let characters = 0;

  for (const turn of turns.slice(0, maxTurns)) {
    if (characters + turn.text.length > MAX_QUOTED_CHARS) break;
    characters += turn.text.length;
    kept.push(turn);
  }
  return kept;
}
