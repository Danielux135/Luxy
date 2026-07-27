// seleccion de la maquina que debe ejecutar un trabajo
import { DEFAULT_MACHINE_OFFLINE_SECONDS } from './constants.js';
import type { Machine, ProviderId } from './types.js';

/** una maquina esta online si envio un heartbeat dentro de la ventana configurada */
export function isMachineOnline(
  machine: Pick<Machine, 'lastSeenAt' | 'enabled'>,
  now: Date = new Date(),
  offlineAfterSeconds: number = DEFAULT_MACHINE_OFFLINE_SECONDS,
): boolean {
  if (!machine.enabled) return false;
  if (!machine.lastSeenAt) return false;
  const last = Date.parse(machine.lastSeenAt);
  if (Number.isNaN(last)) return false;
  return now.getTime() - last <= offlineAfterSeconds * 1000;
}

/** comprueba si una maquina puede ejecutar un proveedor concreto */
export function machineSupportsProvider(machine: Machine, provider: ProviderId): boolean {
  switch (provider) {
    case 'claude':
      return machine.capabilities.claude.available;
    case 'codex':
      return machine.capabilities.codex.available;
    default:
      return machine.capabilities.httpProviders.includes(provider);
  }
}

/** comprueba si una maquina tiene configurado un alias de proyecto */
export function machineHasProject(machine: Machine, projectAlias: string): boolean {
  return machine.projects.includes(projectAlias);
}

export type MachineSelection =
  | { kind: 'selected'; machine: Machine; reason: string }
  | { kind: 'needs_choice'; candidates: Machine[]; reason: string }
  | { kind: 'queued'; reason: string }
  | { kind: 'unavailable'; reason: string };

export interface SelectMachineInput {
  machines: Machine[];
  provider: ProviderId;
  projectAlias: string;
  /** maquina preferida guardada para el usuario de telegram */
  preferredMachineId: string | null;
  /** maquina forzada por el usuario en el propio comando */
  requestedMachineId?: string | null;
  now?: Date;
  offlineAfterSeconds?: number;
}

/**
 * elige maquina segun las reglas de luxy:
 * - si el usuario fuerza una maquina, se respeta (o se explica el problema).
 * - si solo hay una compatible online, se selecciona sola.
 * - si hay varias, gana la preferida del usuario.
 * - si hay varias y no hay preferida, telegram debe preguntar con botones.
 * - si no hay ninguna online, el trabajo se queda en cola.
 */
export function selectMachine(input: SelectMachineInput): MachineSelection {
  const {
    machines,
    provider,
    projectAlias,
    preferredMachineId,
    requestedMachineId = null,
    now = new Date(),
    offlineAfterSeconds = DEFAULT_MACHINE_OFFLINE_SECONDS,
  } = input;

  // maquinas que declaran el proyecto y saben ejecutar el proveedor pedido
  const compatible = machines.filter(
    (machine) =>
      machine.enabled &&
      machineHasProject(machine, projectAlias) &&
      machineSupportsProvider(machine, provider),
  );

  if (compatible.length === 0) {
    const hasProject = machines.some((machine) => machineHasProject(machine, projectAlias));
    return {
      kind: 'unavailable',
      reason: hasProject
        ? `ninguna maquina tiene disponible el proveedor "${provider}" para "${projectAlias}"`
        : `ninguna maquina tiene configurado el proyecto "${projectAlias}"`,
    };
  }

  const online = compatible.filter((machine) =>
    isMachineOnline(machine, now, offlineAfterSeconds),
  );

  // peticion explicita del usuario: se respeta siempre que sea posible
  if (requestedMachineId) {
    const requested = compatible.find((machine) => machine.id === requestedMachineId);
    if (!requested) {
      return {
        kind: 'unavailable',
        reason: 'la maquina indicada no es compatible con este trabajo',
      };
    }
    if (!isMachineOnline(requested, now, offlineAfterSeconds)) {
      // se encola contra esa maquina en vez de desviar el trabajo a otra
      return {
        kind: 'queued',
        reason: `la maquina "${requested.name}" esta desconectada; el trabajo queda en cola`,
      };
    }
    return { kind: 'selected', machine: requested, reason: 'maquina indicada en el comando' };
  }

  if (online.length === 0) {
    return {
      kind: 'queued',
      reason: 'no hay ninguna maquina conectada; el trabajo queda en cola',
    };
  }

  if (online.length === 1) {
    return {
      kind: 'selected',
      machine: online[0]!,
      reason: 'es la unica maquina conectada compatible',
    };
  }

  const preferred = preferredMachineId
    ? online.find((machine) => machine.id === preferredMachineId)
    : undefined;

  if (preferred) {
    return { kind: 'selected', machine: preferred, reason: 'maquina preferida del usuario' };
  }

  return {
    kind: 'needs_choice',
    candidates: online,
    reason: 'hay varias maquinas conectadas y no hay ninguna preferida',
  };
}

/** indica si un lease ha caducado y el trabajo puede recuperarse */
export function isLeaseExpired(leaseExpiresAt: string | null, now: Date = new Date()): boolean {
  if (!leaseExpiresAt) return true;
  const expires = Date.parse(leaseExpiresAt);
  if (Number.isNaN(expires)) return true;
  return expires <= now.getTime();
}

/**
 * decide si un trabajo con lease caducado puede reasignarse.
 * si la maquina anterior pudo dejar cambios locales sin guardar, no se reasigna:
 * se marca como interrumpido para que el usuario decida.
 */
export function canReassignJob(job: {
  status: string;
  leaseExpiresAt: string | null;
  startedAt: string | null;
}): boolean {
  if (!isLeaseExpired(job.leaseExpiresAt)) return false;
  // un trabajo solo reclamado, que aun no empezo a ejecutarse, es seguro de mover
  if (job.status === 'claimed' && !job.startedAt) return true;
  // en cuanto empieza a ejecutarse puede haber cambios en el worktree
  return false;
}
