// que modelo se manda de verdad con un proveedor.
//
// Por que existe: el modelo elegido se recuerda por conversacion y sobrevive a
// cambiar de proveedor. Un modelo de otra familia NO existe para el proveedor
// nuevo, y mandarlo igual devuelve `unrecognized_model` —gastando la llamada,
// porque la pasarela cobra por llamada y no por token—.
//
// Paso de verdad: con el proveedor cambiado a Claude y el modelo aun en
// `DeepSeek-V4-Pro`, cinco llamadas seguidas fallaron asi.
//
// El id de proveedor ES la familia del modelo: asi los registra el agente.

/** lo minimo que hace falta de un modelo del catalogo para elegirlo */
export interface SelectableModel {
  apiModel: string;
  family: string;
  enabled: boolean;
}

/**
 * el modelo que debe viajar, o `null` para dejarlo al de la conexion.
 *
 * `null` no es un fallo: es el comportamiento por defecto de siempre, y es la
 * respuesta correcta cuando lo elegido no encaja con el proveedor actual.
 */
export function modelForProvider(
  models: readonly SelectableModel[],
  provider: string,
  chosen: string | null,
): string | null {
  if (chosen === null || chosen.length === 0) return null;

  const known = modelsForProvider(models, provider);
  // sin catalogo para esa familia no hay con que comparar: es el caso de los
  // CLI nativos. Bloquear ahi seria impedir elegir nada, que es justo el
  // problema que esto viene a resolver. La proteccion contra mandar el modelo
  // de otra familia la da soltarlo al cambiar de proveedor
  if (known.length === 0) return chosen;

  return known.some((model) => model.apiModel === chosen) ? chosen : null;
}

/**
 * modelos que se sugieren para los proveedores NATIVOS.
 *
 * Claude y Codex no son conexiones HTTP: son CLIs locales, asi que no salen en
 * el catalogo que devuelve `/v1/models` y su selector quedaba vacio. Sin
 * selector se usaba siempre el `defaultModel` del adaptador, que en Claude es
 * `opus`.
 *
 * Son SUGERENCIAS y no una lista cerrada: el valor se manda exacto y el CLI
 * decide. Para Codex no se pone ninguna porque no se han comprobado sus valores
 * contra su `--help`, y `CLAUDE.md` prohibe expresamente inventarse los flags o
 * los valores de un CLI.
 */
export const NATIVE_MODEL_SUGGESTIONS: Readonly<Record<string, readonly string[]>> = {
  claude: ['opus', 'sonnet', 'haiku'],
};

/** los modelos que ese proveedor sirve de verdad */
export function modelsForProvider(
  models: readonly SelectableModel[],
  provider: string,
): SelectableModel[] {
  return models.filter((model) => model.enabled && model.family === provider);
}
