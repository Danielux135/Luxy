// como se ordena la lista de conversaciones privadas.
//
// Una lista plana ordenada por fecha mezcla los hilos de un personaje con los
// de otro y con los que no son de nadie. Con varios personajes en la misma
// boveda eso obliga a abrir conversaciones para saber de quien son, que es
// justo lo que no se quiere de un contenido privado.
//
// Aqui no hay E/S ni React a proposito: es la parte que se puede probar sola.
import type { PrivateConversation } from './useVault.js';

/** conversaciones de un mismo personaje, o las que no son de ninguno */
export interface ConversationGroup {
  /** `null` es el grupo legitimo de «sin personaje», no un error */
  characterId: string | null;
  /** lo que se lee en la cabecera del grupo */
  label: string;
  /** ya ordenadas: la mas reciente primero */
  conversations: PrivateConversation[];
  /** la actividad mas reciente del grupo; ordena los grupos entre si */
  updatedAt: string;
}

/** cabecera de un personaje que ya no esta en la boveda */
export const FORGOTTEN_LABEL = 'Personaje olvidado';

/** cabecera de los hilos que nunca tuvieron personaje */
export const NO_CHARACTER_LABEL = 'Sin personaje';

/**
 * agrupa por personaje y ordena por actividad, dentro y fuera de cada grupo.
 *
 * El grupo con la conversacion mas reciente sale primero: lo que se esta
 * usando queda arriba sin tener que elegir un orden fijo por nombre, que
 * dejaria a Lia debajo de cualquiera que empiece por A.
 */
export function groupConversationsByCharacter(
  conversations: readonly PrivateConversation[],
): ConversationGroup[] {
  const groups = new Map<string, ConversationGroup>();

  for (const conversation of conversations) {
    // el uuid no puede colisionar con esta clave: no lleva dos puntos
    const key = conversation.characterId ?? 'sin:personaje';
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        characterId: conversation.characterId,
        label: labelFor(conversation),
        conversations: [conversation],
        updatedAt: conversation.updatedAt,
      });
      continue;
    }
    existing.conversations.push(conversation);
    if (conversation.updatedAt > existing.updatedAt) existing.updatedAt = conversation.updatedAt;
    // el nombre puede llegar solo en algunos hilos: el personaje se pudo elegir
    // hace tiempo y solo el ultimo turno lo lleva sellado
    if (existing.label === FORGOTTEN_LABEL) existing.label = labelFor(conversation);
  }

  for (const group of groups.values()) {
    group.conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  return [...groups.values()].sort((a, b) => {
    // los hilos sin personaje van al final aunque sean recientes: son el cajon
    // de sastre, y arriba estorban a lo que si tiene dueño
    if (a.characterId === null) return 1;
    if (b.characterId === null) return -1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function labelFor(conversation: PrivateConversation): string {
  if (conversation.characterId === null) return NO_CHARACTER_LABEL;
  const label = conversation.characterLabel?.trim() ?? '';
  return label.length === 0 ? FORGOTTEN_LABEL : label;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * cuando fue, en lenguaje normal.
 *
 * `now` se pasa a proposito en vez de leer el reloj: asi la funcion es pura y
 * se puede probar sin congelar el tiempo. Los dias se cuentan en hora LOCAL,
 * que es la que ve quien lee: comparar instantes UTC diria «ayer» a algo de
 * esta misma tarde para cualquiera que no viva en Greenwich.
 */
export function describeWhen(iso: string, now: Date): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'sin fecha';

  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(when)) / DAY_MS);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? 'hace una semana' : `hace ${weeks} semanas`;
  }
  // a partir de un mes la cuenta atras deja de decir nada util y molesta:
  // «hace 63 días» hay que traducirlo mentalmente a una fecha
  return when.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
