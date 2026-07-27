// deteccion de las herramientas instaladas en esta maquina
import { release, hostname, platform } from 'node:os';
import type { MachineCapabilities, ToolPresence } from '@luxy/shared';
import { runProcess, which } from './process.js';

const ABSENT: ToolPresence = { available: false, version: null, path: null };

// caracteres de dibujo de caja que algunas herramientas usan en sus avisos
const DECORATIVE = /^[\s─-╿|+*=_-]+$/;

/**
 * extrae la version de la salida de `--version`.
 * se salta las lineas decorativas (flutter imprime un recuadro de aviso) y
 * busca la primera linea que contenga algo con forma de numero de version.
 */
export function extractVersion(output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !DECORATIVE.test(line));

  // preferencia: una linea que contenga un numero de version reconocible
  const withVersion = lines.find((line) => /\d+\.\d+(\.\d+)?/.test(line));
  return withVersion ?? lines[0] ?? null;
}

/**
 * detecta una herramienta: primero su ruta, despues su version.
 * si el ejecutable existe pero `--version` falla, se considera no disponible,
 * porque significa que no esta usable.
 */
export async function detectTool(
  executable: string,
  versionArgs: string[] = ['--version'],
  timeoutMs = 30_000,
): Promise<ToolPresence> {
  const path = await which(executable);
  if (!path) return { ...ABSENT };

  try {
    const result = await runProcess({
      executable,
      args: versionArgs,
      cwd: process.cwd(),
      timeoutMs,
    });
    if (result.exitCode !== 0) return { available: false, version: null, path };
    return { available: true, version: extractVersion(result.stdout), path };
  } catch {
    return { available: false, version: null, path };
  }
}

/**
 * consulta la ayuda de una herramienta para saber que flags admite realmente.
 * es la base de la capa de deteccion de capacidades: nunca se asume la sintaxis
 * de otra version.
 */
export async function readHelp(
  executable: string,
  args: string[] = ['--help'],
  timeoutMs = 30_000,
): Promise<string | null> {
  try {
    const result = await runProcess({ executable, args, cwd: process.cwd(), timeoutMs });
    // algunas herramientas escriben la ayuda en stderr y devuelven codigo != 0
    const output = `${result.stdout}\n${result.stderr}`;
    return output.trim().length > 0 ? output : null;
  } catch {
    return null;
  }
}

/** comprueba si un flag aparece literalmente en el texto de ayuda */
export function helpHasFlag(help: string | null, flag: string): boolean {
  if (!help) return false;
  // se exige un limite por la derecha para que --model no case con --model-foo
  return new RegExp(`(^|\\s)${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|=|,|$)`, 'm').test(
    help,
  );
}

export interface DetectionResult {
  capabilities: MachineCapabilities;
  hostname: string;
  platform: string;
  platformVersion: string;
}

/**
 * detecta todo el entorno de la maquina.
 * las detecciones son independientes, asi que se lanzan en paralelo.
 */
export async function detectEnvironment(httpProviders: string[] = []): Promise<DetectionResult> {
  const [git, node, npm, claude, codex, flutter] = await Promise.all([
    detectTool('git'),
    detectTool('node'),
    // npm en windows es un .cmd, por lo que where.exe lo encuentra igualmente
    detectTool('npm'),
    detectTool('claude'),
    detectTool('codex'),
    // flutter tarda mucho la primera vez que se ejecuta
    detectTool('flutter', ['--version'], 120_000),
  ]);

  return {
    capabilities: { git, node, npm, claude, codex, flutter, httpProviders },
    hostname: hostname(),
    platform: platform(),
    platformVersion: release(),
  };
}

/** resumen legible de las capacidades, para el arranque y la interfaz local */
export function describeCapabilities(capabilities: MachineCapabilities): string[] {
  const lines: string[] = [];
  const entries: Array<[string, ToolPresence]> = [
    ['git', capabilities.git],
    ['node', capabilities.node],
    ['npm', capabilities.npm],
    ['claude', capabilities.claude],
    ['codex', capabilities.codex],
    ['flutter', capabilities.flutter],
  ];
  for (const [name, tool] of entries) {
    lines.push(
      tool.available
        ? `  ${name}: ${tool.version ?? 'version desconocida'}`
        : `  ${name}: no disponible`,
    );
  }
  lines.push(
    `  apis http: ${capabilities.httpProviders.length > 0 ? capabilities.httpProviders.join(', ') : 'ninguna'}`,
  );
  return lines;
}
