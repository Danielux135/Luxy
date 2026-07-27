// ubicaciones locales de luxy en windows (con alternativas en otros sistemas)
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/** carpeta de configuracion: %APPDATA%\Luxy */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const appData = env.APPDATA;
  if (appData) return join(appData, 'Luxy');
  // en linux y macos se usa una ruta equivalente, util para desarrollo
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'luxy');
}

/** carpeta de datos locales: %LOCALAPPDATA%\Luxy */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const localAppData = env.LOCALAPPDATA;
  if (localAppData) return join(localAppData, 'Luxy');
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'luxy');
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'config.json');
}

export function logsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataDir(env), 'logs');
}

export function worktreesDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataDir(env), 'worktrees');
}

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataDir(env), 'state');
}

/** archivo con las claves de las apis http (nunca se versiona) */
export function providersEnvPath(repoRoot: string): string {
  return join(repoRoot, '.env.providers');
}

export const isWindows = platform() === 'win32';
