// ruta del node.exe real con el que relanzar los shims .js.
//
// PROBLEMA: los shims .cmd de npm (npm, claude, codex...) apuntan a un .js que
// hay que ejecutar con node. Hasta ahora se usaba process.execPath, que en un
// proceso node normal es correcto. Pero cuando el agente corre dentro de
// Electron, process.execPath es Luxy.exe, no node.exe: lanzar el shim con el
// binario de Electron rompe claude y codex de forma silenciosa.
//
// SOLUCION: resolver un node.exe de verdad y usar process.execPath solo cuando
// ya es node.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { execPath } from 'node:process';
import { isWindows } from './paths.js';

/** true si este proceso es Electron y no node a secas */
function runningInsideElectron(): boolean {
  return typeof process.versions.electron === 'string' && process.versions.electron.length > 0;
}

/** busca node en el PATH sin pasar por ningun interprete de comandos */
function lookupNodeInPath(): string | null {
  const finder = isWindows ? 'where.exe' : 'which';
  try {
    const result = spawnSync(finder, ['node'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 10_000,
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') return null;
    for (const line of result.stdout.split(/\r?\n/)) {
      const candidate = line.trim();
      // en windows where.exe puede devolver tambien node.cmd; solo sirve el .exe
      if (candidate.length === 0) continue;
      if (isWindows && !candidate.toLowerCase().endsWith('.exe')) continue;
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // sin node en el PATH se cae al ultimo recurso
  }
  return null;
}

let cached: string | null = null;

/**
 * ejecutable de node con el que lanzar scripts .js.
 *
 * `LUXY_NODE_PATH` permite fijarlo explicitamente: es lo que usa el proceso de
 * escritorio cuando ya ha detectado node durante el onboarding.
 */
export function nodeExecutable(env: NodeJS.ProcessEnv = process.env): string {
  if (cached !== null) return cached;

  const configured = env.LUXY_NODE_PATH;
  if (typeof configured === 'string' && configured.length > 0 && existsSync(configured)) {
    cached = configured;
    return cached;
  }

  if (!runningInsideElectron()) {
    cached = execPath;
    return cached;
  }

  // dentro de Electron hay que encontrar node de verdad
  cached = lookupNodeInPath() ?? execPath;
  return cached;
}

/** solo para pruebas: olvida la resolucion cacheada */
export function clearNodeExecutableCache(): void {
  cached = null;
}
