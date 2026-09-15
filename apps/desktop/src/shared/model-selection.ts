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
 * decide. Por eso el desplegable que las usa lleva siempre un «otro…» que
 * devuelve la caja de texto; cerrar la lista dejaria fuera modelos que existen.
 *
 * COMPROBADO contra `claude --help` el 2026-09-10, que dice literalmente:
 * «Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or
 * a model's full name». El «e.g.» es la razon de que esto no sea una lista
 * cerrada, y de ahi sale `fable`, que faltaba.
 *
 * Para Codex sigue sin haber ninguna, y no por descuido: `codex exec --help`
 * declara `-m, --model <MODEL>` y **no enumera un solo valor**. `CLAUDE.md`
 * prohibe inventarse los valores de un CLI sin comprobarlos, asi que su lista
 * lleva solo «por defecto» —que es el `model` de su `config.toml`, o sea lo
 * que el usuario ya tenia puesto—, lo que se haya elegido y «otro…».
 */
export const NATIVE_MODEL_SUGGESTIONS: Readonly<Record<string, readonly string[]>> = {
  claude: ['opus', 'sonnet', 'haiku', 'fable'],
  // COMPROBADO el 2026-09-10 contra el catalogo vivo de la propia instalacion.
  //
  // Y ojo con la fuente, porque hay una trampa: `codex debug models` NO sirve.
  // Devuelve un catalogo empaquetado dentro del binario que va desfasado —se
  // dejaba fuera `gpt-6-astra`, que es el modelo nuevo y el que el usuario
  // tenia puesto— y dos llamadas seguidas daban lo mismo, asi que tampoco es
  // una cache que se refresque. Si alguien propone «mejor preguntarselo al
  // CLI», la respuesta es que ya se probo y miente.
  codex: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
};

/**
 * que esfuerzos acepta cada modelo, y por que no vale una lista sola.
 *
 * El esquema de Codex lo dice con todas las letras: «must be supported by the
 * selected model». Ahi esta el detalle que cuesta dinero — mandarle `ultra` a
 * un modelo que no lo acepta no lo recorta, FALLA, y la llamada se paga igual.
 *
 * Comprobado el 2026-09-10, modelo por modelo:
 *
 * - `gpt-6-astra`, `gpt-5.6-sol` y `gpt-5.6-terra` llegan hasta `ultra`;
 * - `gpt-5.6-luna` se queda en `max`;
 * - `gpt-5.5` y `gpt-5.3-codex-spark` se quedan en `xhigh`;
 * - Claude, de su `--help`: «low, medium, high, xhigh, max».
 */
const CODEX_EFFORTS_ULTRA = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
const HASTA_MAX = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const HASTA_XHIGH = ['low', 'medium', 'high', 'xhigh'] as const;

const MODEL_EFFORTS: Readonly<Record<string, readonly string[]>> = {
  'gpt-6-astra': CODEX_EFFORTS_ULTRA,
  'gpt-5.6-sol': CODEX_EFFORTS_ULTRA,
  'gpt-5.6-terra': CODEX_EFFORTS_ULTRA,
  'gpt-5.6-luna': HASTA_MAX,
  'gpt-5.5': HASTA_XHIGH,
  'gpt-5.3-codex-spark': HASTA_XHIGH,
};

/**
 * el mas alto que se puede ofrecer sin saber que modelo es.
 *
 * Se queda en `xhigh` a proposito, que es el techo del modelo mas modesto de
 * la lista. Un desconocido puede ser cualquier cosa —uno nuevo, uno escrito a
 * mano— y equivocarse hacia arriba cuesta una llamada fallida; equivocarse
 * hacia abajo solo deja una opcion sin ofrecer.
 */
const EFFORTS_DESCONOCIDO = HASTA_XHIGH;

/**
 * los esfuerzos que se le pueden ofrecer al usuario para este proveedor y modelo.
 *
 * Vacio significa «este proveedor no entiende de esfuerzos»: es el caso de las
 * conexiones HTTP, donde el contrato `chat completions` no tiene donde ponerlo
 * y ofrecerlo seria un boton que no hace nada.
 */
export function effortsFor(provider: string, model: string | null): readonly string[] {
  // Claude no varia por modelo: el nivel es de la sesion, no del modelo
  if (provider === 'claude') return HASTA_MAX;
  if (provider !== 'codex') return [];
  if (model === null || model.length === 0) return EFFORTS_DESCONOCIDO;
  return MODEL_EFFORTS[model] ?? EFFORTS_DESCONOCIDO;
}

/** los modelos que ese proveedor sirve de verdad */
export function modelsForProvider(
  models: readonly SelectableModel[],
  provider: string,
): SelectableModel[] {
  const suyos = models.filter(
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

  // el catalogo junto conserva una ficha POR ORIGEN —hace falta para que cada
  // conexion tenga las suyas—, y por la via de la FAMILIA eso puede traer el
  // mismo `apiModel` dos veces. En el desplegable el valor de cada opcion es el
  // `apiModel`: repetido, elegir una opcion deja de decir cual se eligio
  const vistos = new Set<string>();
  return suyos.filter((model) => {
    if (vistos.has(model.apiModel)) return false;
    vistos.add(model.apiModel);
    return true;
  });
}
