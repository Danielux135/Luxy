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
// Y aqui vive tambien la regla de QUIEN ejecuta un modelo —`providerForModel`—,
// que no es «su familia» aunque durante meses lo pareciera. Ver el comentario
// de `providerCandidatesForModel`, que es donde esta escrita una sola vez.

import { isConversationalModel } from '@luxy/shared';
import type { ModelOrigin } from '@luxy/shared';

/** lo minimo que hace falta de un modelo del catalogo para elegirlo */
export interface SelectableModel {
  apiModel: string;
  family: string;
  /** de que origen salio: el identificador de la conexion o del proveedor HTTP */
  connectionId: string;
  /** y de que CLASE es ese origen, que es lo que decide si su familia ejecuta */
  origin: ModelOrigin;
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

// -----------------------------------------------------------------------------
// quien ejecuta un modelo
// -----------------------------------------------------------------------------

/** lo minimo para saber quien puede ejecutar un modelo */
export type ExecutableModel = Pick<SelectableModel, 'family' | 'connectionId' | 'origin'>;

/**
 * los proveedores que PODRIAN ejecutar este modelo, del mas exacto al menos.
 *
 * La regla esta escrita aqui una sola vez porque estaba repetida a trozos por
 * media aplicacion, y en cada trozo mal de una forma distinta. Sale de las dos
 * —y solo dos— maneras en que `LuxyAgent.initializeProviders` da de alta algo
 * ejecutable, y por eso lo primero que mira es de cual de las dos viene:
 *
 *  1. `origin: 'http'` — cada entrada de `providers.http` se registra con SU
 *     identificador (`mistral`, `groq`, `horde-cydonia`, `ovh-nemo`...), que es
 *     exactamente el `connectionId` con el que sus modelos entran en el
 *     catalogo, y con NINGUN otro. Su `family` es una adivinanza sacada del
 *     nombre del modelo, asi que aqui no es un candidato: cuando Daniel apago
 *     `ovh-nemo`, `Mistral-Nemo-Instruct-2407` caia a su familia adivinada
 *     `mistral`, que en esta maquina es otra pasarela con otra clave. La
 *     pantalla daba luz verde y la llamada se pagaba igual.
 *  2. `origin: 'connection'` — cada conexion registra un proveedor POR FAMILIA,
 *     y solo de las familias que estan en `PROVIDER_IDS`. Nunca registra uno que
 *     se llame como la conexion: los modelos de la conexion `hcnsec` de Daniel
 *     se ejecutan con `deepseek`, `glm`, `kimi` o `qwen`, y `hcnsec` no existe
 *     como proveedor.
 *
 * El `connectionId` sigue yendo primero en el caso 2 porque cuesta nada y hace
 * util el aviso —nombra el origen, que es lo que el usuario busca en
 * Conexiones—; que ademas lo tenga registrado alguien es un choque de nombres
 * que `agentConfigSchema` rechaza.
 */
export function providerCandidatesForModel(model: ExecutableModel): string[] {
  if (model.origin === 'http') return [model.connectionId];
  return model.connectionId === model.family
    ? [model.connectionId]
    : [model.connectionId, model.family];
}

/**
 * el proveedor que ejecuta este modelo en esta maquina, o `null` si ninguno.
 *
 * `registered` son los que el agente ANUNCIA (`status.agent.providers`), no los
 * que hay escritos en la configuracion: una conexion sin clave guardada no
 * registra nada, un `providers.http` deshabilitado tampoco, y una familia que no
 * este en `PROVIDER_IDS` no llega a registrarse aunque la conexion la sirva.
 */
export function providerForModel(
  model: ExecutableModel,
  registered: readonly string[],
): string | null {
  return providerCandidatesForModel(model).find((id) => registered.includes(id)) ?? null;
}

/**
 * de que maquina y de cuantos modelos habla el aviso.
 *
 * `local` es la de Privado, donde los proveedores salen del agente de ESTE
 * ordenador. `selected` es la del Laboratorio, que tiene un desplegable de
 * maquinas: decirle «esta maquina» a alguien que ha elegido el portatil le
 * manda a mirar el agente equivocado, y ahi el mensaje deja de ayudar
 * exactamente igual que ayudaba «el proveedor other no esta disponible».
 *
 * `group` es el mismo aviso hablando de todos los modelos de un origen, que es
 * como se enseña en la sonda para no repetir veintisiete veces lo mismo.
 */
export type MissingProviderScope = 'local' | 'selected' | 'group';

/**
 * por que no hay quien lo ejecute, en una frase que se pueda enseñar.
 *
 * Existe para que se sepa ANTES de gastar el turno. El 2026-09-15 Daniel marco
 * un modelo de AI Horde en la sonda de Privado, pulso «Probar» y espero a que la
 * sonda ejecutara para leer «el proveedor "other" no esta disponible en esta
 * maquina»: el turno se consumio en averiguar algo que ya se sabia al marcar la
 * casilla.
 *
 * No nombra el modelo a proposito: quien enseña esto ya lo tiene al lado, y sin
 * el nombre dos modelos del mismo origen dan la MISMA frase y se pueden juntar
 * en un solo aviso en vez de en veintisiete.
 */
export function missingProviderReason(
  model: ExecutableModel,
  registered: readonly string[],
  scope: MissingProviderScope = 'local',
): string | null {
  if (providerForModel(model, registered) !== null) return null;
  const candidatos = providerCandidatesForModel(model);
  const partes =
    candidatos.length === 1
      ? [`"${candidatos[0]!}"`]
      : [`"${model.connectionId}" (su conexión)`, `"${model.family}" (su familia)`];
  const sujeto = scope === 'selected' ? 'La máquina seleccionada' : 'Esta máquina';
  // el demostrativo tiene que concordar con lo que hay debajo: el aviso
  // agrupado se pinta encima de las veintisiete fichas de un origen, y «ese
  // modelo» en singular no señalaba a ninguna
  const cola =
    scope === 'group'
      ? 'así que sus modelos no se pueden ejecutar aquí'
      : scope === 'selected'
        ? 'así que ese modelo no se puede ejecutar ahí'
        : 'así que ese modelo no se puede ejecutar aquí';
  return `${sujeto} no tiene en marcha ${partes.join(' ni ')}, ${cola}.`;
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
  registered: readonly string[] = [],
): string | null {
  if (chosen === null || chosen.length === 0) return null;

  const known = modelsForProvider(models, provider, registered);
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

/**
 * los modelos que ese proveedor sirve de verdad.
 *
 * `registered` es lo que el agente ANUNCIA, y es lo que convierte esto en el
 * inverso exacto de `providerForModel` en vez de en una aproximacion. Sin ella
 * solo se puede preguntar «¿esta este proveedor entre sus candidatos?», y esa
 * pregunta acepta la via de la FAMILIA aunque haya un proveedor mas exacto en
 * marcha: el selector de `mistral` ofrecia `Mistral-Nemo-Instruct-2407`, que
 * solo sirve `ovh-nemo`, y elegirlo lo mandaba a la pasarela de Mistral. Es el
 * mismo fallo del 2026-09-15 leido al reves, y en la misma pantalla: la sonda
 * lo etiquetaba `ovh-nemo` tres lineas mas arriba.
 *
 * Vacia se acepta a proposito: con el agente parado NADA resuelve, y filtrar
 * ahi dejaria todos los desplegables vacios sin explicar nada.
 */
export function modelsForProvider(
  models: readonly SelectableModel[],
  provider: string,
  registered: readonly string[] = [],
): SelectableModel[] {
  const suyos = models.filter(
    (model) =>
      model.enabled &&
      // y que se pueda HABLAR con el. `enabled` no lo dice: un whisper y un
      // clasificador de seguridad estan perfectamente habilitados y no sirven
      // para lo unico que preguntan los selectores que usan esta funcion —con
      // quien hablo, y quien mira la imagen—. Elegir uno gastaba una llamada
      // que no podia funcionar
      isConversationalModel(model) &&
      (registered.length === 0
        ? // la MISMA regla de `providerCandidatesForModel`, leida al reves.
          //
          // Las dos vias hacen falta. Sin la de la CONEXION, añadir Groq dejaba
          // el selector vacio para siempre: `groq` no esta en `MODEL_FAMILIES`
          // —es una lista cerrada a proposito— asi que sus modelos caian en
          // `qwen` y `other`, y Privado pedia «familia groq» y no encontraba
          // nada. Actualizar el catalogo no lo arreglaba: el problema no era la
          // frescura sino el criterio. Y sin la de la FAMILIA se queda vacio el
          // selector de una conexion agregadora, que sirve muchas familias por
          // un solo endpoint.
          providerCandidatesForModel(model).includes(provider)
        : // con la lista delante ya no hay que conformarse con «podria»: se
          // pregunta quien lo ejecuta, y solo sale en SU selector
          providerForModel(model, registered) === provider),
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

/**
 * una opcion por EJECUCION distinta, no por nombre de modelo.
 *
 * POR QUE EXISTE: el Laboratorio se quedaba con la primera ficha de cada
 * `apiModel` y tiraba el resto, con el comentario «aqui el origen da igual,
 * porque la prueba se ejecuta por FAMILIA». Con la regla nueva el origen ES
 * quien ejecuta, asi que eso elegia en silencio cual de las cuatro conexiones
 * de Daniel a AI Horde pagaba la prueba —cada una con su clave, su tope de
 * tokens y su limite de llamadas— y, si la primera estaba sin clave, declaraba
 * inejecutable un modelo que las otras tres servian.
 *
 * `mergeCatalogs` conserva una ficha por origen precisamente para que esto se
 * pueda elegir; aqui solo se quitan las que no añaden una ejecucion nueva:
 *
 *  - de las que SI se pueden ejecutar se conserva una por proveedor distinto;
 *  - si ninguna se puede, queda una sola para que el bloqueo siga teniendo algo
 *    que explicar.
 *
 * Quien lo pinte tiene que enseñar el proveedor en la opcion: con cuatro fichas
 * del mismo nombre es lo unico que las distingue.
 */
export function executionChoices<T extends ExecutableModel & { apiModel: string }>(
  models: readonly T[],
  registered: readonly string[],
): T[] {
  const ejecutables = new Set(
    models.flatMap((model) =>
      providerForModel(model, registered) === null ? [] : [model.apiModel],
    ),
  );
  const vistos = new Set<string>();
  return models.filter((model) => {
    const provider = providerForModel(model, registered);
    // una ficha sin ejecutor no aporta nada cuando otra del mismo nombre si lo
    // tiene: seria una opcion que solo sirve para equivocarse
    if (provider === null && ejecutables.has(model.apiModel)) return false;
    // la barra vertical separa sin ambiguedad: un identificador de proveedor es
    // `[a-z][a-z0-9_-]*` y no puede llevarla, asi que dos pares distintos nunca
    // dan la misma clave
    const clave = `${provider ?? ''}|${model.apiModel}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}
