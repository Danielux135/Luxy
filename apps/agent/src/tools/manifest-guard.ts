// proteccion del vector "npm run".
//
// EL PROBLEMA. Los comandos de comprobacion salen de config.json y pasan por una
// lista blanca, asi que el modelo no puede inventarse un comando. Pero se
// ejecutan con cwd = el worktree que el modelo acaba de editar, y `npm test`
// ejecuta lo que ponga package.json:scripts. Escribiendo un archivo, el modelo
// consigue ejecucion de codigo nativo en cuanto corren las pruebas.
//
// Lo mismo vale para Makefile (make), build.rs (cargo), conftest.py (pytest) y
// pyproject.toml.
//
// LA MITIGACION. Se toma huella de esos archivos ANTES de que el modelo trabaje.
// Si alguno cambio, los comandos de comprobacion no se ejecutan solos: hacen
// falta ojos humanos. No se bloquea la edicion -cambiar package.json es
// legitimo-, se bloquea ejecutarlo sin que nadie lo haya visto.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** archivos cuyo contenido acaba ejecutandose al lanzar una comprobacion */
export const EXECUTABLE_MANIFESTS = [
  'package.json',
  'Makefile',
  'makefile',
  'build.rs',
  'conftest.py',
  'pyproject.toml',
  'Cargo.toml',
  'pubspec.yaml',
  'vitest.config.ts',
  'vitest.workspace.ts',
  'jest.config.js',
  'jest.config.ts',
  'vite.config.ts',
  'playwright.config.ts',
  'tox.ini',
  'setup.py',
] as const;

export type ManifestSnapshot = Record<string, string>;

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** huella de los manifiestos ejecutables de un worktree */
export function snapshotManifests(root: string): ManifestSnapshot {
  const snapshot: ManifestSnapshot = {};
  for (const name of EXECUTABLE_MANIFESTS) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    try {
      snapshot[name] = hash(readFileSync(file, 'utf8'));
    } catch {
      // si no se puede leer se omite: la comparacion posterior lo detectara
      // como aparicion nueva, que tambien exige revision
    }
  }
  return snapshot;
}

export interface ManifestChange {
  file: string;
  kind: 'modificado' | 'creado' | 'borrado';
}

/** compara la huella inicial con el estado actual */
export function detectManifestChanges(root: string, before: ManifestSnapshot): ManifestChange[] {
  const after = snapshotManifests(root);
  const changes: ManifestChange[] = [];

  for (const [file, digest] of Object.entries(before)) {
    const current = after[file];
    if (current === undefined) changes.push({ file, kind: 'borrado' });
    else if (current !== digest) changes.push({ file, kind: 'modificado' });
  }
  for (const file of Object.keys(after)) {
    if (!(file in before)) changes.push({ file, kind: 'creado' });
  }
  return changes;
}

/** mensaje para el modelo y para el usuario cuando hay cambios */
export function describeManifestChanges(changes: readonly ManifestChange[]): string {
  const detalle = changes.map((change) => `${change.file} (${change.kind})`).join(', ');
  return (
    `no se ejecutan las comprobaciones porque han cambiado archivos que definen que se ejecuta: ${detalle}. ` +
    'Revisa el diff y lanza las pruebas tu mismo si el cambio es correcto.'
  );
}
