// registro de modelos: resuelve alias, familias y disponibilidad real.
//
// la regla que gobierna todo esto: un modelo DECLARADO no es un modelo
// DISPONIBLE. estar en el catalogo solo significa que Luxy sabe como pedirlo;
// para poder usarlo hacen falta ademas conexion habilitada, clave guardada y
// que la conexion confirme que lo sirve.
import { MODEL_FAMILIES } from './types.js';
import type {
  ConnectionProfile,
  ConnectionStatus,
  ModelCapability,
  ModelDefinition,
  ModelFamily,
  ResolvedModel,
} from './types.js';

export class ModelRegistryError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ModelRegistryError';
  }
}

export interface ModelRegistryInput {
  connections: readonly ConnectionProfile[];
  models: readonly ModelDefinition[];
  /** lo que cada conexion respondio la ultima vez que se sincronizo */
  statuses?: readonly ConnectionStatus[];
}

export class ModelRegistry {
  private readonly connections = new Map<string, ConnectionProfile>();
  private readonly models = new Map<string, ModelDefinition>();
  private readonly statuses = new Map<string, ConnectionStatus>();
  /** alias de telegram -> id de modelo */
  private readonly aliases = new Map<string, string>();

  constructor(input: ModelRegistryInput) {
    for (const connection of input.connections) {
      this.connections.set(connection.id, connection);
    }
    for (const status of input.statuses ?? []) {
      this.statuses.set(status.connectionId, status);
    }

    for (const model of input.models) {
      if (this.models.has(model.id)) {
        throw new ModelRegistryError(
          `hay dos modelos con la id "${model.id}"`,
          'las ids de modelo deben ser unicas en todo el catalogo',
        );
      }
      this.models.set(model.id, model);

      for (const alias of model.telegramAliases) {
        const taken = this.aliases.get(alias);
        if (taken !== undefined) {
          throw new ModelRegistryError(
            `el alias "/${alias}" lo reclaman "${taken}" y "${model.id}"`,
            'cada alias de telegram debe apuntar a un unico modelo',
          );
        }
        this.aliases.set(alias, model.id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // consultas basicas
  // ---------------------------------------------------------------------------

  listConnections(): ConnectionProfile[] {
    return [...this.connections.values()];
  }

  getConnection(id: string): ConnectionProfile | null {
    return this.connections.get(id) ?? null;
  }

  getConnectionStatus(id: string): ConnectionStatus | null {
    return this.statuses.get(id) ?? null;
  }

  list(): ModelDefinition[] {
    return [...this.models.values()];
  }

  get(id: string): ModelDefinition | null {
    return this.models.get(id) ?? null;
  }

  /** todos los alias registrados, para construir la ayuda de telegram */
  listAliases(): { alias: string; modelId: string }[] {
    return [...this.aliases.entries()].map(([alias, modelId]) => ({ alias, modelId }));
  }

  listFamilies(): ModelFamily[] {
    const families = new Set<ModelFamily>();
    for (const model of this.models.values()) families.add(model.family);
    return [...families];
  }

  listByFamily(family: ModelFamily): ModelDefinition[] {
    return this.list().filter((model) => model.family === family);
  }

  /**
   * modelo por defecto de una familia. es lo que resuelve /deepseek, /kat o
   * /step sin version: cambiar el predeterminado no cambia el comando.
   */
  defaultForFamily(family: ModelFamily): ModelDefinition | null {
    const candidates = this.listByFamily(family);
    return candidates.find((model) => model.defaultForFamily) ?? candidates[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // resolucion de alias
  // ---------------------------------------------------------------------------

  /**
   * resuelve un comando de telegram a un modelo.
   *
   * se normalizan variantes razonables (mayusculas, guiones en vez de guion
   * bajo, barra inicial), pero los alias canonicos que se muestran al usuario
   * siempre usan guion bajo.
   */
  resolveAlias(raw: string): ModelDefinition | null {
    const alias = normalizeAlias(raw);
    if (alias.length === 0) return null;

    const direct = this.aliases.get(alias);
    if (direct !== undefined) return this.models.get(direct) ?? null;

    // un alias que coincide con el nombre de una familia usa su predeterminado
    if (isModelFamily(alias) && this.listByFamily(alias).length > 0) {
      return this.defaultForFamily(alias);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // disponibilidad
  // ---------------------------------------------------------------------------

  /** cruza el catalogo con el estado real de su conexion */
  resolve(id: string): ResolvedModel | null {
    const definition = this.models.get(id);
    if (definition === undefined) return null;

    const connection = this.connections.get(definition.connectionId) ?? null;
    const status = this.statuses.get(definition.connectionId) ?? null;

    const connectionEnabled = connection !== null && connection.enabled;
    const hasApiKey = status?.hasApiKey ?? false;
    // sin sincronizar no se sabe: null, que no es lo mismo que false.
    //
    // una lista VACIA tambien es "no se sabe". Una conexion que funciona sirve
    // algo, asi que cero modelos significa que nadie ha preguntado todavia.
    // Tratarlo como false hacia que la pantalla de Modelos declarase que la
    // conexion no sirve NINGUNO de los 19 del catalogo, con la clave puesta y
    // trabajos ejecutandose contra ella.
    const servedByConnection =
      status === null || status.availableModels.length === 0
        ? null
        : status.availableModels.includes(definition.apiModel);

    let unavailableReason: string | null = null;
    if (!definition.enabled) {
      unavailableReason = 'el modelo esta desactivado en los ajustes';
    } else if (connection === null) {
      unavailableReason = `su conexion "${definition.connectionId}" no existe`;
    } else if (!connection.enabled) {
      unavailableReason = `la conexion "${connection.displayName}" esta desactivada`;
    } else if (!hasApiKey) {
      unavailableReason = `falta la clave de la conexion "${connection.displayName}"`;
    } else if (servedByConnection === false) {
      unavailableReason = `la conexion "${connection.displayName}" no sirve el modelo "${definition.apiModel}"`;
    }

    return {
      definition,
      connectionEnabled,
      hasApiKey,
      servedByConnection,
      usable: unavailableReason === null,
      unavailableReason,
    };
  }

  /** todos los modelos con su disponibilidad, para pintar la vista de Modelos */
  resolveAll(): ResolvedModel[] {
    return this.list()
      .map((model) => this.resolve(model.id))
      .filter((resolved): resolved is ResolvedModel => resolved !== null);
  }

  /** modelos que se pueden usar ahora mismo */
  listUsable(): ResolvedModel[] {
    return this.resolveAll().filter((resolved) => resolved.usable);
  }

  /**
   * candidatos para un trabajo, filtrados por capacidad.
   *
   * es lo que impide pasarle herramientas de archivos a un modelo de
   * transcripcion o intentar programar con uno de imagen.
   */
  listUsableWithCapability(capability: ModelCapability): ResolvedModel[] {
    return this.listUsable().filter((resolved) =>
      resolved.definition.capabilities.includes(capability),
    );
  }

  /** modelos que pueden ejecutar el bucle de herramientas local */
  listAgentic(): ResolvedModel[] {
    return this.listUsable().filter(
      (resolved) => resolved.definition.agentic && resolved.definition.category === 'text',
    );
  }
}

/** acepta "/Deepseek-Pro" y devuelve "deepseek_pro" */
export function normalizeAlias(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * se deriva de MODEL_FAMILIES en vez de copiarse a mano.
 *
 * la lista duplicada compilaba sin error al añadir una familia nueva, y
 * resolveAlias dejaba de reconocerla en silencio.
 */
function isModelFamily(value: string): value is ModelFamily {
  return (MODEL_FAMILIES as readonly string[]).includes(value);
}
