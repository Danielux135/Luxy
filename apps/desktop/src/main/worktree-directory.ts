// valida la carpeta antes de delegar en el Explorador de Windows.
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';

export class WorktreeDirectoryError extends Error {}

/** resuelve una carpeta existente sin permitir que un enlace simbolico salga de la raiz */
export function resolveWorktreeDirectory(candidate: string, rootDirectory: string): string {
  if (!existsSync(rootDirectory) || !existsSync(candidate)) {
    throw new WorktreeDirectoryError('la carpeta de trabajo no esta disponible en esta maquina');
  }

  const root = realpathSync(rootDirectory);
  const directory = realpathSync(candidate);
  const relation = relative(root, directory);
  if (relation !== '' && (relation.startsWith('..') || isAbsolute(relation))) {
    throw new WorktreeDirectoryError('la carpeta de trabajo no pertenece a los worktrees de Luxy');
  }

  return directory;
}
