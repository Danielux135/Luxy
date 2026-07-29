// alias de telegram derivados del catalogo.
//
// hasta ahora TASK_COMMANDS se derivaba de PROVIDER_IDS, asi que solo existian
// los comandos de familia (/deepseek, /qwen...). Los alias por modelo
// (/qwen_36, /kat_v25, /step_35_2603) estaban definidos en el catalogo pero no
// llegaban al parser, de modo que Telegram los rechazaba.
//
// este modulo es la unica fuente de esa correspondencia, y es dato puro: lo
// consumen el gateway (para parsear) y el escritorio (para mostrar la ayuda).
import { buildDefaultCatalog } from './catalog.js';
import type { ModelCategory, ModelDefinition, ModelFamily } from './types.js';
import type { ProviderId } from '../types.js';
import { PROVIDER_IDS } from '../constants.js';

export interface ModelAlias {
  /** comando sin la barra, en minusculas y con guion bajo */
  alias: string;
  modelId: string;
  /** identificador EXACTO que espera la API */
  apiModel: string;
  displayName: string;
  family: ModelFamily;
  /** familia como proveedor del contrato, si esa familia es ejecutable */
  provider: ProviderId | null;
  /** el alias apunta al predeterminado de su familia */
  isFamilyDefault: boolean;
}

function toProviderId(family: ModelFamily): ProviderId | null {
  return (PROVIDER_IDS as readonly string[]).includes(family) ? (family as ProviderId) : null;
}

/** construye el mapa alias -> modelo a partir de un catalogo */
export function buildAliasMap(models: readonly ModelDefinition[]): Map<string, ModelAlias> {
  const map = new Map<string, ModelAlias>();
  for (const model of models) {
    // los modelos desactivados no aportan comandos: /auto y los routers quedan
    // fuera a proposito
    if (!model.enabled) continue;
    for (const alias of model.telegramAliases) {
      map.set(alias, {
        alias,
        modelId: model.id,
        apiModel: model.apiModel,
        displayName: model.displayName,
        family: model.family,
        provider: toProviderId(model.family),
        isFamilyDefault: model.defaultForFamily,
      });
    }
  }
  return map;
}

/** mapa del catalogo por defecto, que es el que conoce el gateway */
export const DEFAULT_MODEL_ALIASES: ReadonlyMap<string, ModelAlias> = buildAliasMap(
  buildDefaultCatalog(),
);

/** catalogo por defecto, sin conexion asociada: solo para consultar metadatos */
const DEFAULT_CATALOG = buildDefaultCatalog();

/** comandos de tarea que aportan los modelos del catalogo */
export const MODEL_TASK_COMMANDS: readonly string[] = [...DEFAULT_MODEL_ALIASES.keys()].sort();

/** resuelve un comando a un modelo concreto, o null si no es un alias */
export function resolveModelAlias(command: string): ModelAlias | null {
  return DEFAULT_MODEL_ALIASES.get(command.toLowerCase()) ?? null;
}

/**
 * categoria del catalogo a la que apunta un apiModel, o null si no se conoce.
 *
 * el gateway la necesita para no mandar una foto a un modelo de codigo: eso
 * gastaba el turno del usuario y devolvia una respuesta absurda.
 */
export function categoryOfApiModel(apiModel: string): ModelCategory | null {
  for (const model of DEFAULT_CATALOG) {
    if (model.apiModel === apiModel) return model.category;
  }
  return null;
}

/** comando que si sabe tratar este tipo de adjunto */
export function commandForAttachment(kind: 'photo' | 'voice' | 'audio' | 'document'): string | null {
  if (kind === 'photo') return '/image_edit';
  if (kind === 'voice' || kind === 'audio') return '/transcribe';
  return null;
}
