// politica pura de comandos de comprobacion. Studio la usa antes de guardar y
// el agente vuelve a aplicarla justo antes de ejecutar: la UI nunca es frontera
// de seguridad.
import type { TestCommand } from './schemas.js';

export const ALLOWED_TEST_EXECUTABLES: readonly string[] = [
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

const FORBIDDEN_ARG_PATTERNS = [
  // nada que llame al shell o evalúe código arbitrario
  /^-c$/i,
  /^--eval$/i,
  /^-e$/i,
  // nada que publique o despliegue
  /^publish$/i,
  /^deploy$/i,
  /^push$/i,
];

export interface TestCommandValidation {
  allowed: boolean;
  reason: string | null;
}

export function validateTestCommand(command: TestCommand): TestCommandValidation {
  const [executable, args] = command;
  const normalized = executable.toLowerCase().replace(/\.(cmd|bat|exe|ps1)$/, '');

  if (!ALLOWED_TEST_EXECUTABLES.includes(normalized)) {
    return {
      allowed: false,
      reason: `"${executable}" no esta en la lista de ejecutables permitidos`,
    };
  }

  if (/[\\/]/.test(executable)) {
    return { allowed: false, reason: 'el ejecutable no puede incluir una ruta' };
  }

  for (const arg of args) {
    if (FORBIDDEN_ARG_PATTERNS.some((pattern) => pattern.test(arg))) {
      return { allowed: false, reason: `el argumento "${arg}" no esta permitido` };
    }
    // aunque el proceso se lanza sin shell, se rechazan sus metacaracteres para
    // que una futura integración no convierta silenciosamente estos datos.
    if (/[;&|`$><]/.test(arg)) {
      return { allowed: false, reason: `el argumento "${arg}" contiene caracteres no permitidos` };
    }
  }

  return { allowed: true, reason: null };
}
