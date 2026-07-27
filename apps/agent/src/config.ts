// carga y validacion de la configuracion local de la maquina
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { agentConfigSchema, validateProjectPath, secretRegistry } from '@luxy/shared';
import type { AgentConfig } from '@luxy/shared';
import { configFilePath } from './paths.js';

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * lee y valida config.json.
 * el archivo vive fuera del repositorio a proposito: las rutas locales de una
 * maquina nunca deben versionarse.
 */
export function loadConfig(path: string = configFilePath()): AgentConfig {
  if (!existsSync(path)) {
    throw new ConfigError(
      `no existe la configuracion en ${path}`,
      'ejecuta: npm run setup:machine',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(
      `la configuracion no es json valido: ${String(error)}`,
      `revisa ${path} o vuelve a ejecutar npm run setup:machine`,
    );
  }

  const parsed = agentConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n  ');
    throw new ConfigError(`la configuracion no es valida:\n  ${issues}`, `archivo: ${path}`);
  }

  const config = parsed.data;

  // el token de maquina se registra para que nunca aparezca en un log
  secretRegistry.add(config.machineToken);

  // las rutas se validan aunque zod ya haya pasado: zod no mira el disco
  const problems: string[] = [];
  for (const [alias, project] of Object.entries(config.projects)) {
    for (const issue of validateProjectPath(project.path)) {
      problems.push(`proyecto "${alias}": ${issue}`);
    }
    if (!existsSync(project.path)) {
      problems.push(`proyecto "${alias}": la ruta ${project.path} no existe en esta maquina`);
    }
  }
  if (problems.length > 0) {
    throw new ConfigError(
      `hay problemas en las rutas de los proyectos:\n  ${problems.join('\n  ')}`,
      'corrige las rutas con npm run setup:machine',
    );
  }

  return config;
}

/** guarda la configuracion creando la carpeta si hace falta */
export function saveConfig(config: AgentConfig, path: string = configFilePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  // se escribe con indentacion para que puedas editarlo a mano si lo necesitas
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function configExists(path: string = configFilePath()): boolean {
  return existsSync(path);
}

/**
 * carga las claves de las apis http desde un archivo .env.providers.
 * formato simple CLAVE=valor. las claves se registran para redactarlas.
 * este archivo NUNCA se versiona.
 */
export function loadProviderKeys(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  const content = readFileSync(path, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    // se admiten valores entrecomillados
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // los marcadores de pendiente no cuentan como clave configurada
    if (value.length === 0 || value.startsWith('PENDIENTE')) continue;
    out[key] = value;
    secretRegistry.add(value);
  }
  return out;
}

/**
 * devuelve los proveedores http realmente utilizables:
 * habilitados en la configuracion y con su clave presente.
 */
export function resolveEnabledHttpProviders(
  config: AgentConfig,
  keys: Record<string, string>,
): string[] {
  return config.providers.http
    .filter((provider) => provider.enabled && typeof keys[provider.apiKeyEnv] === 'string')
    .map((provider) => provider.id);
}

/** resuelve la ruta de un proyecto de forma absoluta y normalizada */
export function resolveProjectPath(config: AgentConfig, alias: string): string | null {
  const project = config.projects[alias];
  if (!project) return null;
  return resolve(project.path);
}
