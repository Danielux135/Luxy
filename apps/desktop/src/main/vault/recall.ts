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
import type { VaultRecall, RecalledEpisodeLine, QuotedEpisode } from '@luxy/shared';
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
    date: episode.startedAt.slice(0, 10),
    title: episode.title,
    turns: episode.turns,
  }));

  if (!looksLikeMemoryRequest(message)) return { episodes: lines, quoted: null };

  const matches = await memory.search(vault, message, {
    limit: 5,
    characterId: options.characterId ?? null,
  });
  const already = options.alreadyInPrompt;

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
