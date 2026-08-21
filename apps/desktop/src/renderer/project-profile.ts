// Transformaciones puras de la ficha local de proyecto. Mantenerlas fuera del
// componente evita que guardar datos descriptivos borre permisos o comandos.
import { validateTestCommand } from '@luxy/shared';
import type { ProjectConfig, ProjectType, TestCommand } from '@luxy/shared';

export interface ProjectCheckDraft {
  executable: string;
  argumentsText: string;
}

export interface ProjectDraft {
  displayName: string;
  description: string;
  path: string;
  type: ProjectType;
  stack: string;
  instructions: string;
  checks: ProjectCheckDraft[];
  testTimeoutSeconds: number;
  allowHostChecks: boolean;
  allowEdits: boolean;
  allowCommit: boolean;
  allowPush: boolean;
}

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  node: 'Node / TypeScript',
  flutter: 'Flutter',
  python: 'Python',
  other: 'Otro',
};

export type ProjectProfileUpdate =
  { ok: true; project: ProjectConfig } | { ok: false; error: string };

export function projectToDraft(project: ProjectConfig): ProjectDraft {
  return {
    displayName: project.displayName ?? '',
    description: project.description ?? '',
    path: project.path,
    type: project.type,
    stack: project.stack?.join(', ') ?? '',
    instructions: project.instructions ?? '',
    checks: project.testCommands.map(([executable, args]) => ({
      executable,
      argumentsText: args.join('\n'),
    })),
    testTimeoutSeconds: project.testTimeoutMs / 1000,
    allowHostChecks: project.allowHostChecks,
    allowEdits: project.allowEdits,
    allowCommit: project.allowCommit,
    allowPush: project.allowPush,
  };
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function buildProjectProfileUpdate(
  project: ProjectConfig,
  draft: ProjectDraft,
): ProjectProfileUpdate {
  if (draft.path.length === 0) {
    return { ok: false, error: 'El proyecto necesita una carpeta local.' };
  }

  const stack = [
    ...new Set(
      draft.stack
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  if (stack.length > 16 || stack.some((item) => item.length > 48)) {
    return {
      ok: false,
      error: 'El stack admite hasta 16 elementos de 48 caracteres, separados por comas.',
    };
  }

  if (draft.checks.length > 10) {
    return { ok: false, error: 'Se admiten como máximo 10 comandos de comprobación.' };
  }
  if (
    !Number.isFinite(draft.testTimeoutSeconds) ||
    draft.testTimeoutSeconds < 1 ||
    draft.testTimeoutSeconds > 3600 ||
    !Number.isInteger(draft.testTimeoutSeconds * 1000)
  ) {
    return {
      ok: false,
      error: 'El timeout debe estar entre 1 y 3600 segundos, con precisión de milisegundos.',
    };
  }

  const testCommands: TestCommand[] = [];
  for (const [index, check] of draft.checks.entries()) {
    const executable = check.executable.trim();
    const args = check.argumentsText
      .split('\n')
      .map((argument) => argument.trim())
      .filter(Boolean);
    if (executable.length === 0 || executable.length > 128) {
      return { ok: false, error: `El comando ${index + 1} necesita un ejecutable válido.` };
    }
    if (args.length > 32 || args.some((argument) => argument.length > 512)) {
      return {
        ok: false,
        error: `El comando ${index + 1} admite hasta 32 argumentos de 512 caracteres.`,
      };
    }
    const command: TestCommand = [executable, args];
    const validation = validateTestCommand(command);
    if (!validation.allowed) {
      return {
        ok: false,
        error: `Comando ${index + 1}: ${validation.reason ?? 'no permitido'}.`,
      };
    }
    testCommands.push(command);
  }

  return {
    ok: true,
    project: {
      ...project,
      path: draft.path,
      type: draft.type,
      displayName: optionalText(draft.displayName),
      description: optionalText(draft.description),
      stack: stack.length === 0 ? undefined : stack,
      instructions: optionalText(draft.instructions),
      testCommands,
      testTimeoutMs: Math.round(draft.testTimeoutSeconds * 1000),
      allowHostChecks: draft.allowHostChecks,
      allowEdits: draft.allowEdits,
      allowCommit: draft.allowCommit,
      allowPush: draft.allowPush,
    },
  };
}
