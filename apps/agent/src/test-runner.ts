// ejecucion de los comandos de comprobacion de cada proyecto.
// SOLO se ejecutan comandos declarados en config.json: es una lista blanca.
import type { TestCommand, TestRunResult, ProjectConfig } from '@luxy/shared';
import { runProcess, BASE_ENV_ALLOWLIST } from './process.js';

/**
 * ejecutables permitidos. cualquier otro se rechaza aunque aparezca en la
 * configuracion, para que un config.json manipulado no pueda ejecutar
 * cualquier binario del sistema.
 */
export const ALLOWED_TEST_EXECUTABLES = [
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'node',
  'flutter',
  'dart',
  'python',
  'python3',
  'pytest',
  'cargo',
  'go',
  'dotnet',
  'make',
  'tsc',
  'vitest',
  'jest',
  'eslint',
];

/** argumentos que nunca se admiten en un comando de comprobacion */
const FORBIDDEN_ARG_PATTERNS = [
  // nada que llame al shell
  /^-c$/i,
  /^--eval$/i,
  /^-e$/i,
  // nada que publique o despliegue
  /^publish$/i,
  /^deploy$/i,
  /^push$/i,
];

export interface CommandValidation {
  allowed: boolean;
  reason: string | null;
}

/**
 * valida un comando de comprobacion antes de ejecutarlo.
 * comprueba la lista blanca y descarta argumentos peligrosos.
 */
export function validateTestCommand(command: TestCommand): CommandValidation {
  const [executable, args] = command;

  // el ejecutable se compara sin extension, porque en windows npm es npm.cmd
  const normalized = executable.toLowerCase().replace(/\.(cmd|bat|exe|ps1)$/, '');

  if (!ALLOWED_TEST_EXECUTABLES.includes(normalized)) {
    return {
      allowed: false,
      reason: `"${executable}" no esta en la lista de ejecutables permitidos`,
    };
  }

  // una ruta en el ejecutable permitiria saltarse la lista blanca
  if (/[\\/]/.test(executable)) {
    return { allowed: false, reason: 'el ejecutable no puede incluir una ruta' };
  }

  for (const arg of args) {
    if (FORBIDDEN_ARG_PATTERNS.some((pattern) => pattern.test(arg))) {
      return { allowed: false, reason: `el argumento "${arg}" no esta permitido` };
    }
    // se rechaza cualquier metacaracter de shell aunque shell este desactivado
    if (/[;&|`$><]/.test(arg)) {
      return { allowed: false, reason: `el argumento "${arg}" contiene caracteres no permitidos` };
    }
  }

  return { allowed: true, reason: null };
}

/**
 * decide si un comando ha pasado.
 * el codigo de salida es la señal principal; ademas se detecta el caso de
 * `flutter analyze`, que puede devolver 0 con avisos.
 */
export function didCommandPass(exitCode: number | null, timedOut: boolean): boolean {
  if (timedOut) return false;
  return exitCode === 0;
}

/** conserva solo la cola de la salida, que es la parte util para diagnosticar */
function tail(text: string, maxChars = 4000): string {
  return text.length > maxChars ? `[...]\n${text.slice(-maxChars)}` : text;
}

export interface TestRunnerOptions {
  workingDirectory: string;
  project: ProjectConfig;
  signal: AbortSignal;
  onEvent: (message: string, metadata?: Record<string, unknown>) => void;
}

/**
 * ejecuta todos los comandos de comprobacion del proyecto.
 * si uno falla se siguen ejecutando los demas, para dar un informe completo.
 */
export async function runProjectTests(options: TestRunnerOptions): Promise<TestRunResult[]> {
  const results: TestRunResult[] = [];

  for (const command of options.project.testCommands) {
    if (options.signal.aborted) break;

    const [executable, args] = command;
    const validation = validateTestCommand(command);

    if (!validation.allowed) {
      options.onEvent(`comando de comprobacion rechazado: ${validation.reason}`);
      results.push({
        command: executable,
        args,
        exitCode: null,
        durationMs: 0,
        timedOut: false,
        stdoutTail: '',
        stderrTail: validation.reason ?? 'comando no permitido',
        passed: false,
      });
      continue;
    }

    options.onEvent(`ejecutando ${executable} ${args.join(' ')}`);

    try {
      const result = await runProcess({
        executable,
        args,
        cwd: options.workingDirectory,
        timeoutMs: options.project.testTimeoutMs,
        signal: options.signal,
        envAllowList: BASE_ENV_ALLOWLIST,
      });

      const passed = didCommandPass(result.exitCode, result.timedOut);
      results.push({
        command: executable,
        args,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        stdoutTail: tail(result.stdout),
        stderrTail: tail(result.stderr),
        passed,
      });

      options.onEvent(
        `${executable} ${args.join(' ')} -> ${passed ? 'ok' : 'fallo'} (${Math.round(result.durationMs / 1000)}s, codigo ${result.exitCode})`,
        { exitCode: result.exitCode, passed },
      );
    } catch (error) {
      results.push({
        command: executable,
        args,
        exitCode: null,
        durationMs: 0,
        timedOut: false,
        stdoutTail: '',
        stderrTail: String(error).slice(0, 2000),
        passed: false,
      });
      options.onEvent(`no se pudo ejecutar ${executable}: ${String(error).slice(0, 200)}`);
    }
  }

  return results;
}

/** resume los resultados en el formato que espera telegram */
export function summarizeTests(results: TestRunResult[]): {
  passed: number;
  failed: number;
  summary: string;
} {
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const lines = results.map(
    (result) =>
      `${result.passed ? 'OK  ' : 'FALLO'} ${result.command} ${result.args.join(' ')}` +
      ` (${Math.round(result.durationMs / 1000)}s)`,
  );
  return { passed, failed, summary: lines.join('\n') };
}
