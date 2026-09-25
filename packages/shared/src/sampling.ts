// parametros de muestreo: los cuatro que Luxy sabe mandar a un servidor que
// habla `chat completions`.
//
// POR QUE VIVEN EN UN ARCHIVO PROPIO: los usan dos esquemas que no pueden
// importarse entre si. `httpProviderConfigSchema` (schemas.ts) los lleva en el
// nivel superior de un proveedor HTTP, y `connectionProfileSchema`
// (models/types.ts) los lleva POR MODELO dentro de una conexion. schemas.ts ya
// importa models/types.ts, asi que ponerlos en cualquiera de los dos dejaria
// una importacion circular. Aqui solo hay Zod y logica pura.
import { z } from 'zod';

/**
 * forma de un nombre de modelo tal y como viaja en el cuerpo (`model`).
 *
 * es la misma que exige `httpProviderConfigSchema.model`, que la toma de aqui:
 * una clave de `modelSampling` que no pudiera ser nunca un `model` valido seria
 * una entrada que no se aplica jamas y que nadie ve por que.
 */
export const API_MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export const samplingParametersShape = {
  /**
   * temperatura del muestreo. SIN valor por defecto.
   *
   * rango 0..2: es el que documenta OpenAI para `temperature` en
   * `/chat/completions`, y es el que replican las pasarelas compatibles. 0 no
   * es determinismo garantizado, solo el extremo mas conservador.
   *
   * POR QUE OPCIONAL Y SIN DEFECTO: ver la nota comun mas abajo, en
   * `repetitionPenalty`.
   */
  temperature: z.number().min(0).max(2).optional(),
  /**
   * penalizacion por FRECUENCIA. SIN valor por defecto.
   *
   * rango -2..2, el documentado por OpenAI. Es ADITIVA y proporcional a las
   * veces que ya salio ese token. En negativo premia repetir.
   */
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  /**
   * penalizacion por PRESENCIA. SIN valor por defecto.
   *
   * mismo rango -2..2 de OpenAI, pero no es el mismo parametro: se aplica una
   * sola vez en cuanto el token ha aparecido, sin mirar cuantas.
   */
  presencePenalty: z.number().min(-2).max(2).optional(),
  /**
   * penalizacion por repeticion. SIN valor por defecto.
   *
   * NO ES DE OPENAI: viene de Hugging Face y lo implementan vLLM, TGI,
   * llama.cpp y OpenRouter, entre otros. Por eso su rango no se parece a los
   * dos anteriores: es MULTIPLICATIVA sobre el logit, el neutro es 1 y el
   * valor tiene que ser estrictamente mayor que 0 —vLLM y TGI lo rechazan si
   * no—. Por encima de 1 desanima repetir; por debajo, lo fomenta. El techo de
   * 2 no es del protocolo: es el limite superior de lo que puede escribirse
   * sin que el texto se vuelva incoherente.
   *
   * POR QUE LOS CUATRO SON OPCIONALES Y NINGUNO TIENE DEFECTO: hay servidores
   * que devuelven 400 ante un parametro que no conocen, asi que una conexion
   * que no los configure tiene que seguir mandando el mismo cuerpo de siempre,
   * campo por campo. Y existen para poder MEDIR con y sin: un valor «razonable»
   * de fabrica dejaria sin nada contra lo que comparar.
   */
  repetitionPenalty: z.number().gt(0).max(2).optional(),
};

export const samplingParametersSchema = z.object(samplingParametersShape);

export type SamplingParameters = z.infer<typeof samplingParametersSchema>;

export const SAMPLING_PARAMETER_KEYS = [
  'temperature',
  'frequencyPenalty',
  'presencePenalty',
  'repetitionPenalty',
] as const;

export type SamplingParameterKey = (typeof SAMPLING_PARAMETER_KEYS)[number];

/** tope de modelos con muestreo propio en una conexion; el catalogo ronda la veintena */
export const MAX_MODEL_SAMPLING_ENTRIES = 32;

/**
 * muestreo POR MODELO dentro de una conexion.
 *
 * POR QUE POR MODELO Y NO PARA TODA LA CONEXION: una conexion registra a la vez
 * varias familias (deepseek, glm, kimi, qwen...), y cada familia sirve varios
 * modelos, porque el modelo viaja en cada peticion. Esos mismos proveedores
 * ejecutan tambien los trabajos con herramientas de Studio y Telegram. Una
 * temperatura de conexion se la aplicaria a todos; por modelo solo la recibe
 * el modelo que se eligio para eso.
 *
 * Una entrada vacia se RECHAZA: seria una clave muerta en `config.json` que
 * ademas taparia el nivel superior sin mandar nada. Studio no la escribe nunca
 * —quitar el ultimo parametro quita la entrada—, asi que solo puede llegar de
 * una edicion a mano, y ahi conviene el error con su ruta.
 */
export const modelSamplingSchema = z
  .record(
    z.string().regex(API_MODEL_NAME_PATTERN, 'modelo no valido'),
    samplingParametersSchema.refine(
      (value) => SAMPLING_PARAMETER_KEYS.some((key) => value[key] !== undefined),
      'una entrada de muestreo por modelo necesita al menos un parametro',
    ),
  )
  .refine(
    (value) => Object.keys(value).length <= MAX_MODEL_SAMPLING_ENTRIES,
    `como mucho ${MAX_MODEL_SAMPLING_ENTRIES} modelos con muestreo propio por conexion`,
  );

export type ModelSampling = z.infer<typeof modelSamplingSchema>;

/**
 * el muestreo que corresponde a un modelo: su entrada propia si la tiene, o si
 * no el del nivel superior.
 *
 * la entrada del modelo SUSTITUYE ENTERA al nivel superior, no se mezcla con
 * el: si se mezclara, un proveedor con `frequencyPenalty` arriba y un modelo
 * con solo `temperature` mandaria las dos, y la entrada del modelo dejaria de
 * describir por si sola lo que viaja.
 *
 * `Object.hasOwn` y no `modelSampling[model]`: un modelo llamado `toString` o
 * `constructor` devolveria una funcion del prototipo.
 */
export function samplingForModel(
  model: string,
  modelSampling: Readonly<Record<string, SamplingParameters>> | undefined,
  fallback: SamplingParameters,
): SamplingParameters {
  if (modelSampling !== undefined && Object.hasOwn(modelSampling, model)) {
    return modelSampling[model] ?? {};
  }
  return fallback;
}

/**
 * los parametros como van en el CUERPO, y SOLO los que estan puestos.
 *
 * POR QUE DEVUELVE UN OBJETO VACIO CUANDO NO HAY NINGUNO, en vez de mandar
 * valores neutros: hay pasarelas que contestan 400 ante un parametro que no
 * reconocen, asi que sin configurar tiene que salir el cuerpo de siempre, byte
 * por byte. Extendido con `...`, un objeto vacio no añade ni una clave.
 *
 * DONDE VA `repetition_penalty`: en la RAIZ del cuerpo, igual que los otros
 * tres, aunque no sea de OpenAI. Los servidores que lo implementan —vLLM, TGI,
 * llama.cpp, OpenRouter— lo leen de la raiz. `extra_body` NO es un campo del
 * protocolo: es una comodidad del SDK de Python de OpenAI, que vuelca su
 * contenido en la raiz antes de enviar.
 *
 * Los nombres son los del contrato de OpenAI, en snake_case, no los del
 * esquema. Se comprueba `=== undefined` y no la veracidad: un 0 SI se manda.
 */
export function samplingRequestFields(parameters: SamplingParameters): Record<string, number> {
  const { temperature, frequencyPenalty, presencePenalty, repetitionPenalty } = parameters;
  return {
    ...(temperature === undefined ? {} : { temperature }),
    ...(frequencyPenalty === undefined ? {} : { frequency_penalty: frequencyPenalty }),
    ...(presencePenalty === undefined ? {} : { presence_penalty: presencePenalty }),
    ...(repetitionPenalty === undefined ? {} : { repetition_penalty: repetitionPenalty }),
  };
}

/**
 * los mismos parametros para la linea de registro: solo cifras, y solo los que
 * viajaron. Sin ninguno, no añade ninguna clave, asi que una linea sin muestreo
 * sale igual que antes de que esto existiera.
 */
export function samplingLogFields(parameters: SamplingParameters): Partial<SamplingParameters> {
  const out: Partial<Record<SamplingParameterKey, number>> = {};
  for (const key of SAMPLING_PARAMETER_KEYS) {
    const value = parameters[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
