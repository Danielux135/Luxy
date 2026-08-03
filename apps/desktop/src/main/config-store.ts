// lectura y escritura de config.json desde el proceso principal.
//
// misma ubicacion que usa la CLI (%APPDATA%\Luxy\config.json), para que las dos
// vias sigan hablando de la misma maquina.
//
// diferencia con apps/agent/src/config.ts: alli el machineToken es obligatorio
// porque el agente no puede correr sin el. Aqui es opcional, porque Luxy Desktop
// lo mueve a secrets.enc y lo borra del archivo en claro.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { storedAgentConfigSchema } from '@luxy/shared';
import type { StoredAgentConfig } from '@luxy/shared';
import { MACHINE_TOKEN_SECRET, connectionSecretName } from '../shared/channels.js';

function canonicalEndpoint(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

/**
 * secretos que dejan de estar vinculados a su destino original.
 *
 * El renderer puede proponer configuracion, pero no puede conservar una clave
 * de API ni el token de maquina al cambiar el servidor que los recibira.
 */
export function secretsToInvalidateForConfigChange(
  previous: StoredAgentConfig | null,
  next: StoredAgentConfig,
): string[] {
  if (previous === null) return [];
  const nextById = new Map(next.connections.map((connection) => [connection.id, connection]));
  const invalidated: string[] = [];

  if (canonicalEndpoint(previous.gatewayUrl) !== canonicalEndpoint(next.gatewayUrl)) {
    invalidated.push(MACHINE_TOKEN_SECRET);
  }

  for (const connection of previous.connections) {
    const replacement = nextById.get(connection.id);
    if (
      replacement === undefined ||
      replacement.protocol !== connection.protocol ||
      canonicalEndpoint(replacement.baseUrl) !== canonicalEndpoint(connection.baseUrl)
    ) {
      invalidated.push(connectionSecretName(connection.id));
    }
  }
  return invalidated;
}

export class ConfigStoreError extends Error {
  constructor(
    message: string,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = 'ConfigStoreError';
  }
}

export function configFilePathFor(configDirectory: string): string {
  return join(configDirectory, 'config.json');
}

export class ConfigStore {
  constructor(private readonly file: string) {}

  exists(): boolean {
    return existsSync(this.file);
  }

  get path(): string {
    return this.file;
  }

  /** null si la maquina todavia no esta configurada */
  load(): StoredAgentConfig | null {
    if (!this.exists()) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      throw new ConfigStoreError(
        'el archivo de configuracion no es JSON valido',
        `revisa o borra ${this.file} y vuelve a configurar Luxy.`,
      );
    }

    const parsed = storedAgentConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const detalle = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`)
        .join('; ');
      throw new ConfigStoreError(`la configuracion no es valida (${detalle})`, null);
    }
    return parsed.data;
  }

  /**
   * guarda de forma atomica y con el token fuera.
   *
   * aunque quien llame se olvide, aqui se borra: es la ultima barrera para que
   * config.json no acabe con un secreto dentro.
   */
  save(config: StoredAgentConfig): StoredAgentConfig {
    const { machineToken: _descartado, ...sinSecretos } = storedAgentConfigSchema.parse(config);

    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(sinSecretos, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.file);
    return sinSecretos as StoredAgentConfig;
  }
}
