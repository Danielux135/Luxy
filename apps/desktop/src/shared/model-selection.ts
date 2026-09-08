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

import { isConversationalModel } from '@luxy/shared';

/** lo minimo que hace falta de un modelo del catalogo para elegirlo */
export interface SelectableModel {
  apiModel: string;
  family: string;
  /** de que origen salio: el identificador de la conexion o del proveedor HTTP */
  connectionId: string;
  enabled: boolean;
  /**
   * `text`, `audio`, `image` o `routing`.
   *
   * Hizo falta porque `enabled` no basta: de los 14 modelos que sirve Groq,
   * seis no son de chat —dos whisper, dos orpheus y tres clasificadores— y
   * todos llegaban al desplegable como candidatos para describir una foto.
   */
  category: string;
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
  return models.filter(
    (model) =>
      model.enabled &&
      // y que se pueda HABLAR con el. `enabled` no lo dice: un whisper y un
      // clasificador de seguridad estan perfectamente habilitados y no sirven
      // para lo unico que preguntan los dos selectores que usan esta funcion
      // —con quien hablo, y quien mira la imagen—. Elegir uno gastaba una
      // llamada que no podia funcionar
      isConversationalModel(model) &&
      // por FAMILIA: es como se registran los proveedores derivados de una
      // conexion agregadora, que sirve muchas familias por el mismo endpoint
      (model.family === provider ||
        // o por CONEXION: un proveedor HTTP se registra bajo SU identificador y
        // sirve lo que sirve, sin que sus modelos formen una familia nuestra.
        //
        // Sin esta segunda via, añadir Groq dejaba el selector vacio para
        // siempre: `groq` no esta en `MODEL_FAMILIES` —es una lista cerrada a
        // proposito— asi que sus modelos caian en `qwen` y `other`, y Privado
        // pedia «familia groq» y no encontraba nada. Actualizar el catalogo no
        // lo arreglaba, porque el problema no era la frescura sino el criterio.
        model.connectionId === provider),
  );
}
