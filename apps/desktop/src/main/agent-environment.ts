// entorno minimo del utility process del agente.
//
// el proceso principal puede contener variables de desarrollo, tokens de CI o
// credenciales de otras herramientas. Ninguna debe llegar al agente: el agente
// recibe su configuracion y sus claves por el canal IPC cifrado.
import { buildSafeEnv } from '@luxy/shared';

/** variables del sistema necesarias para resolver binarios y perfiles locales */
export const AGENT_ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'LANG',
  'HOME',
  'SHELL',
  'USER',
] as const;

/** construye el entorno cerrado que recibe el proceso del agente */
export function buildAgentProcessEnv(
  source: NodeJS.ProcessEnv,
  nodePath: string | null,
): Record<string, string> {
  const env = buildSafeEnv(source, [...AGENT_ENV_ALLOWLIST]);
  if (nodePath !== null) env['LUXY_NODE_PATH'] = nodePath;
  return env;
}
