import type { StudioJob, StudioMachine } from '@luxy/shared';

export function jobsForProject(
  jobs: readonly StudioJob[],
  projectAlias: string | null,
): StudioJob[] {
  return projectAlias === null
    ? [...jobs]
    : jobs.filter((job) => job.projectAlias === projectAlias);
}

export function historyNeedsScopeFallback(
  jobs: readonly StudioJob[],
  projectAlias: string | null,
): boolean {
  return projectAlias !== null && jobs.some((job) => job.projectAlias !== projectAlias);
}

export function preferredMachineForProject(
  machines: readonly StudioMachine[],
  currentMachineId: string,
  projectAlias: string | null,
): StudioMachine | null {
  const supportsProject = (machine: StudioMachine): boolean =>
    machine.enabled && (projectAlias === null || machine.projects.includes(projectAlias));
  const current = machines.find(
    (machine) => machine.id === currentMachineId && supportsProject(machine),
  );
  if (current !== undefined) return current;

  return (
    machines.find((machine) => supportsProject(machine) && machine.online) ??
    machines.find(supportsProject) ??
    null
  );
}

export function projectDisplayLabel(
  alias: string,
  project: { displayName?: string } | undefined,
): string {
  const displayName = project?.displayName?.trim() ?? '';
  return displayName.length === 0 ? alias : `${displayName} · ${alias}`;
}
