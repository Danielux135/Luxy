// resolucion de ejecutables en windows.
//
// PROBLEMA: muchas herramientas (npm, claude, codex, flutter) se instalan como
// shims .cmd. Node prohibe lanzar un .cmd con spawn cuando shell es false
// (devuelve EINVAL), y Luxy nunca usa shell porque seria una via de command
// injection.
//
// SOLUCION: se lee el .cmd y se extrae a que apunta realmente:
//   * un .exe  -> se ejecuta ese .exe directamente
//   * un .js   -> se ejecuta "node ese.js"
// Asi no interviene ningun interprete de comandos en ningun momento.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { isWindows } from './paths.js';
import { nodeExecutable } from './node-executable.js';

export interface ResolvedExecutable {
  /** ejecutable real que se pasa a spawn */
  command: string;
  /** argumentos que hay que anteponer a los del usuario */
  prefixArgs: string[];
  /** ruta del shim original, util para diagnosticar */
  source: string;
  /**
   * true si el destino es un .bat que NO se puede desreferenciar (por ejemplo
   * flutter.bat, que es un script de arranque completo). En ese caso hay que
   * pasar por cmd.exe, y entonces los argumentos se validan de forma estricta.
   */
  requiresCmd?: boolean;
}

/**
 * caracteres que cmd.exe interpreta y que permitirian escapar del comando.
 * cuando hay que usar cmd.exe, un argumento que los contenga se rechaza.
 * esta es la mitigacion de la clase de fallos tipo "BatBadBut".
 */
const CMD_UNSAFE = /["&|<>^%!`\r\n]/;

export class UnsafeArgumentError extends Error {
  constructor(argument: string) {
    super(
      `el argumento ${JSON.stringify(argument)} contiene caracteres que cmd.exe interpreta y no se permite`,
    );
    this.name = 'UnsafeArgumentError';
  }
}

/** valida los argumentos que van a pasar por cmd.exe */
export function assertSafeForCmd(args: string[]): void {
  for (const argument of args) {
    if (CMD_UNSAFE.test(argument)) throw new UnsafeArgumentError(argument);
  }
}

/** ruta absoluta de cmd.exe, sin depender del PATH */
export function cmdExePath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
  return join(root, 'System32', 'cmd.exe');
}

/**
 * extrae de un shim .cmd la ruta del destino.
 * los shims de npm usan %dp0% para referirse a su propia carpeta.
 */
export function parseCmdShim(content: string, shimDirectory: string): ResolvedExecutable | null {
  // se buscan rutas entrecomilladas que terminen en .exe o .js
  const matches = [...content.matchAll(/"([^"\n]*\.(?:exe|js))"/gi)].map((match) => match[1]!);

  const expand = (raw: string): string =>
    raw
      // %dp0% ya incluye la barra final, por eso se admite una barra opcional
      .replace(/%dp0%[\\/]?/gi, `${shimDirectory}\\`)
      .replace(/%~dp0[\\/]?/gi, `${shimDirectory}\\`)
      .replace(/[\\/]{2,}/g, '\\');

  // primero un .exe que no sea el propio node
  for (const raw of matches) {
    if (extname(raw).toLowerCase() !== '.exe') continue;
    const expanded = expand(raw);
    if (basename(expanded).toLowerCase() === 'node.exe') continue;
    if (existsSync(expanded)) {
      return { command: expanded, prefixArgs: [], source: shimDirectory };
    }
  }

  // si no, un .js que se ejecuta con el node actual
  for (const raw of matches) {
    if (extname(raw).toLowerCase() !== '.js') continue;
    const expanded = expand(raw);
    if (existsSync(expanded)) {
      return { command: nodeExecutable(), prefixArgs: [expanded], source: shimDirectory };
    }
  }

  return null;
}

/** rutas conocidas del cli de npm junto a su shim */
function resolveNpmFamily(name: string, shimPath: string): ResolvedExecutable | null {
  const directory = dirname(shimPath);
  const candidates = [
    join(directory, 'node_modules', 'npm', 'bin', `${name}-cli.js`),
    join(directory, '..', 'node_modules', 'npm', 'bin', `${name}-cli.js`),
    join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { command: nodeExecutable(), prefixArgs: [candidate], source: shimPath };
    }
  }
  return null;
}

/**
 * resuelve un nombre de ejecutable a algo que spawn pueda lanzar sin shell.
 * `candidates` son las rutas que devolvio where.exe, en orden.
 */
export function resolveFromCandidates(
  name: string,
  candidates: string[],
): ResolvedExecutable | null {
  if (candidates.length === 0) return null;

  // en sistemas posix la primera ruta ya es ejecutable
  if (!isWindows) {
    return { command: candidates[0]!, prefixArgs: [], source: candidates[0]! };
  }

  // 1. si hay un .exe autentico, es la opcion mas limpia
  const exe = candidates.find((path) => extname(path).toLowerCase() === '.exe');
  if (exe && existsSync(exe)) {
    return { command: exe, prefixArgs: [], source: exe };
  }

  // 2. desreferenciar un shim .cmd o .bat
  const shim = candidates.find((path) => ['.cmd', '.bat'].includes(extname(path).toLowerCase()));
  if (shim && existsSync(shim)) {
    try {
      const resolved = parseCmdShim(readFileSync(shim, 'utf8'), dirname(shim));
      if (resolved) return resolved;
    } catch {
      // si no se puede leer el shim se prueban las alternativas siguientes
    }

    // npm y npx tienen una estructura conocida que el shim no siempre revela
    if (name === 'npm' || name === 'npx') {
      const npmResolved = resolveNpmFamily(name, shim);
      if (npmResolved) return npmResolved;
    }

    // ultimo recurso para scripts .bat reales (por ejemplo flutter.bat):
    // se ejecuta por cmd.exe, y quien llame debe validar los argumentos.
    return {
      command: cmdExePath(),
      // /d omite autorun del registro, /s normaliza comillas, /c ejecuta y sale
      prefixArgs: ['/d', '/s', '/c', shim],
      source: shim,
      requiresCmd: true,
    };
  }

  // 3. un archivo sin extension junto al shim puede ser un script de node
  const bare = candidates.find((path) => extname(path) === '');
  if (bare && existsSync(bare)) {
    try {
      const content = readFileSync(bare, 'utf8');
      // los shims de npm para bash tambien mencionan el .js de destino
      const resolved = parseCmdShim(content, dirname(bare));
      if (resolved) return resolved;
    } catch {
      /* se continua con el ultimo recurso */
    }
  }

  return null;
}

// cache por proceso: resolver implica leer disco y no cambia durante la ejecucion
const cache = new Map<string, ResolvedExecutable | null>();

export function getCachedResolution(name: string): ResolvedExecutable | null | undefined {
  return cache.get(name);
}

export function setCachedResolution(name: string, value: ResolvedExecutable | null): void {
  cache.set(name, value);
}

export function clearResolutionCache(): void {
  cache.clear();
}
