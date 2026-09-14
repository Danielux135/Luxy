// como se lee y se corrige la lista de lo que quedo pendiente entre los dos.
//
// Por que hace falta corregirla. Que una promesa no se apunte solo es molesto;
// que se apunte una que no existia acaba en un reproche de ella por algo que
// nadie dijo. El codigo verifica la cita y el rol, pero la INTENCION no se
// puede verificar: una frase de coqueteo puede parecer un compromiso. Asi que
// Daniel repasa esta lista y tiene la ultima palabra.
//
// Aqui no hay E/S ni React a proposito, como en `vault-conversation-groups.ts`:
// es la parte que se puede probar sola.
import type { RelationParty, RelationStatus } from '@luxy/shared';
import type { PendingAffair } from './useVault.js';
import type { Tone } from './ui/primitives.js';
import { FORGOTTEN_LABEL, NO_CHARACTER_LABEL } from './vault-conversation-groups.js';

/** pendientes de un mismo personaje, o los de los hilos que no son de nadie */
export interface PendingGroup {
  /** `null` es el grupo legitimo de «sin personaje», no un error */
  characterId: string | null;
  label: string;
  /** en el orden en que llegaron: lo abierto primero y lo reciente antes */
  pending: PendingAffair[];
  /** cuantos siguen abiertos: es lo unico que ella puede sacar */
  open: number;
  /** el dia mas reciente del grupo; ordena los grupos entre si */
  day: string;
}

/**
 * quien se comprometio, dicho para DANIEL.
 *
 * Es al reves que en el bloque del prompt, y tiene que serlo: alli lo lee ella,
 * y «te lo prometio el» significa que se lo prometio Daniel. Aqui lo lee el.
 */
export const PENDING_PARTY_LABELS: Record<RelationParty, string> = {
  user: 'Lo prometiste tú',
  character: 'Te lo prometió ella',
  both: 'Lo quedasteis los dos',
};

export const PENDING_STATUS_LABELS: Record<RelationStatus, string> = {
  open: 'pendiente',
  fulfilled: 'cumplida',
  released: 'ya no vale',
  dismissed: 'no era una promesa',
};

/**
 * el color de cada estado.
 *
 * Solo lo abierto destaca: es lo unico que ella puede sacar, y por tanto lo
 * unico que corre prisa repasar. Lo cerrado se queda apagado, pero visible.
 */
export const PENDING_STATUS_TONES: Record<RelationStatus, Tone> = {
  open: 'busy',
  fulfilled: 'ok',
  released: 'idle',
  dismissed: 'idle',
};

/** el texto del boton que lleva a cada estado */
export const PENDING_DECISION_LABELS: Record<RelationStatus, string> = {
  open: 'Reabrir',
  fulfilled: 'Cumplida',
  released: 'Ya no vale',
  dismissed: 'No era una promesa',
};

/** por que sirve cada boton, para el `title` */
export const PENDING_DECISION_HINTS: Record<RelationStatus, string> = {
  open: 'Vuelve a contar como pendiente; ella podrá sacarlo otra vez',
  fulfilled: 'Ya se hizo: deja de contar como pendiente',
  released: 'Sigue sin hacerse, pero ya da igual: deja de contar',
  dismissed: 'No era una promesa: además, no se volverá a apuntar',
};

const ALL_DECISIONS: readonly RelationStatus[] = ['open', 'fulfilled', 'released', 'dismissed'];

/**
 * los botones que tienen sentido en un pendiente.
 *
 * Todos menos el estado en el que ya esta. Daniel puede hacer TODAS las
 * transiciones —incluida la de vuelta— porque el que se equivoca tambien puede
 * ser el: dar por cumplida la que no era deja a ella callada para siempre sobre
 * algo que el sigue debiendo.
 */
export function pendingDecisionsFor(status: RelationStatus): RelationStatus[] {
  return ALL_DECISIONS.filter((decision) => decision !== status);
}

/**
 * agrupa por personaje, como la lista de conversaciones.
 *
 * Una lista plana mezcla lo que le debe a un personaje con lo que le debe a
 * otro, y con varios en la misma boveda eso obliga a abrir turnos para saber de
 * quien es cada promesa: justo lo que no se quiere de un contenido privado.
 */
export function groupPendingByCharacter(
  pending: readonly PendingAffair[],
  labels: ReadonlyMap<string, string>,
): PendingGroup[] {
  const groups = new Map<string, PendingGroup>();

  for (const affair of pending) {
    // el identificador no puede colisionar con esta clave: no lleva dos puntos
    const key = affair.characterId ?? 'sin:personaje';
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        characterId: affair.characterId,
        label: labelFor(affair.characterId, labels),
        pending: [affair],
        open: affair.status === 'open' ? 1 : 0,
        day: affair.day,
      });
      continue;
    }
    existing.pending.push(affair);
    if (affair.status === 'open') existing.open += 1;
    if (affair.day > existing.day) existing.day = affair.day;
  }

  return [...groups.values()].sort((a, b) => {
    // los hilos sin personaje van al final aunque sean recientes: son el cajon
    // de sastre, y arriba estorban a lo que si tiene dueño
    if (a.characterId === null) return 1;
    if (b.characterId === null) return -1;
    return b.day.localeCompare(a.day);
  });
}

function labelFor(characterId: string | null, labels: ReadonlyMap<string, string>): string {
  if (characterId === null) return NO_CHARACTER_LABEL;
  const label = labels.get(characterId)?.trim() ?? '';
  // el personaje pudo olvidarse de la boveda; sus promesas siguen apuntadas y
  // tienen que poder repasarse igual
  return label.length === 0 ? FORGOTTEN_LABEL : label;
}
