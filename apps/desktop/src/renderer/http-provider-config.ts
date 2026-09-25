import { connectionProfileSchema, httpProviderConfigSchema } from '@luxy/shared';
import type {
  ConnectionProfile,
  SamplingParameterKey,
  SamplingParameters,
  StoredAgentConfig,
} from '@luxy/shared';

export type HttpProviderConfig = StoredAgentConfig['providers']['http'][number];

export interface HttpProviderDraft {
  id: string;
  displayName: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  supportsStreaming: boolean;
  maxOutputTokens: string;
  dailyBudget: string;
  /**
   * parametros de muestreo, como CADENA y con la cadena vacia como «sin poner».
   *
   * son cadenas y no `number | null` porque vienen de un `<input>`: mientras se
   * escribe «1.» o «-» el valor no es un numero todavia, y convertirlo a
   * numero en cada pulsacion borraria lo que el usuario esta tecleando. La
   * conversion se hace una sola vez, en `buildHttpProvider`.
   *
   * vacio significa NO MANDAR el parametro, que es distinto de mandar su valor
   * neutro: hay servidores que devuelven 400 ante un parametro desconocido.
   */
  temperature: string;
  frequencyPenalty: string;
  presencePenalty: string;
  repetitionPenalty: string;
}

export interface HttpProviderBuildResult {
  provider: HttpProviderConfig | null;
  error: string | null;
}

/**
 * proveedores conocidos, para no tener que recordar su URL exacta.
 *
 * Un solo carácter de más en la URL base produce un 404 que no se ve hasta el
 * primer trabajo, porque este camino no tiene botón de «Probar». Estas están
 * comprobadas contra su documentación el 2026-09-04.
 *
 * `nota` no es publicidad: es lo que hay que saber ANTES de gastar la clave.
 */
export const HTTP_PROVIDER_PRESETS: readonly {
  id: string;
  displayName: string;
  baseUrl: string;
  model: string;
  nota: string;
}[] = [
  {
    id: 'cohere',
    displayName: 'Cohere',
    // el host es .ai; la API nativa vive en .com y NO habla este contrato
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    model: 'command-a-03-2025',
    nota: 'Clave de evaluación gratuita: 20 peticiones por minuto y 1.000 llamadas al mes. Su documentación no la permite para producción, y sus términos prohíben contenido pornográfico.',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    nota: 'De pago por uso, sin cuota gratuita renovable. Pon un presupuesto diario distinto de cero.',
  },
  {
    id: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    nota: 'Nivel gratuito por minuto y por día, sin tarjeta. No promete aceptar contenido adulto.',
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    nota: 'Plan gratuito con crédito mensual y sin tarjeta. Su política sobre ficción adulta no es explícita.',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct',
    nota: 'Agregador: la política y la retención dependen del modelo que elijas, no de OpenRouter.',
  },
];

export function emptyHttpProviderDraft(): HttpProviderDraft {
  return {
    id: '',
    displayName: '',
    baseUrl: '',
    model: '',
    enabled: true,
    supportsStreaming: true,
    maxOutputTokens: '8192',
    dailyBudget: '0',
    // vacios A PROPOSITO: una conexion nueva tiene que mandar el mismo cuerpo
    // que mandaba Luxy antes de que estos campos existieran
    temperature: '',
    frequencyPenalty: '',
    presencePenalty: '',
    repetitionPenalty: '',
  };
}

/** un numero opcional que viene de un `<input>`: vacio significa «sin poner» */
function draftNumber(value: string): number | undefined {
  // LA COMA, que es lo que sale de un teclado espanol. El campo es de texto
  // justamente por esto: con `type="number"` el navegador devuelve la cadena
  // VACIA ante cualquier cosa que no sea un decimal con punto, asi que «1,5» se
  // guardaba como «sin poner», sin un solo aviso, y quien lo escribio creia
  // estar midiendo con temperatura 1,5
  const trimmed = value.trim().replace(',', '.');
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  // NaN llega aqui con «1.» o «-» a medio escribir. Se devuelve para que lo
  // rechace Zod con su mensaje, en vez de descartarlo en silencio: descartarlo
  // guardaria la conexion sin el parametro y el usuario creeria que se aplico
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

/** vuelca un numero opcional al borrador sin inventarse un valor por defecto */
function numberToDraft(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/**
 * clave de muestreo para el objeto que valida Zod, o nada si el campo va vacio.
 *
 * la clave se omite entera en vez de ponerla a `undefined` para que el objeto
 * guardado no arrastre claves muertas hasta `config.json`.
 */
function sampling(key: SamplingParameterKey, value: string): Record<string, number> {
  const parsed = draftNumber(value);
  return parsed === undefined ? {} : { [key]: parsed };
}

/**
 * los cuatro campos de muestreo de un formulario, en el MISMO molde que los de
 * un proveedor HTTP: cadenas, con la vacia como «sin poner». Lo comparten el
 * formulario de proveedor y el de muestreo por modelo de una conexion, para
 * que la coma, el vacio y el NaN a medio escribir se traten igual en los dos.
 */
export type SamplingDraft = Pick<HttpProviderDraft, SamplingParameterKey>;

export function emptySamplingDraft(): SamplingDraft {
  return { temperature: '', frequencyPenalty: '', presencePenalty: '', repetitionPenalty: '' };
}

export function samplingToDraft(parameters: SamplingParameters | undefined): SamplingDraft {
  return {
    temperature: numberToDraft(parameters?.temperature),
    frequencyPenalty: numberToDraft(parameters?.frequencyPenalty),
    presencePenalty: numberToDraft(parameters?.presencePenalty),
    repetitionPenalty: numberToDraft(parameters?.repetitionPenalty),
  };
}

/** los campos rellenos, listos para Zod; los vacios se omiten enteros */
function samplingDraftFields(draft: SamplingDraft): Record<string, number> {
  return {
    ...sampling('temperature', draft.temperature),
    ...sampling('frequencyPenalty', draft.frequencyPenalty),
    ...sampling('presencePenalty', draft.presencePenalty),
    ...sampling('repetitionPenalty', draft.repetitionPenalty),
  };
}

const SAMPLING_FIELD_LABELS: Record<SamplingParameterKey, string> = {
  temperature: 'Temperatura',
  frequencyPenalty: 'Penalización por frecuencia',
  presencePenalty: 'Penalización por presencia',
  repetitionPenalty: 'Penalización por repetición',
};

/**
 * resumen de una entrada para la lista de la conexion, con coma decimal: es lo
 * que se escribio en el campo, y leerlo con punto haria dudar de si se guardo
 */
export function describeSampling(parameters: SamplingParameters): string {
  const partes: string[] = [];
  for (const [key, label] of Object.entries(SAMPLING_FIELD_LABELS) as [
    SamplingParameterKey,
    string,
  ][]) {
    const value = parameters[key];
    if (value !== undefined) partes.push(`${label} ${String(value).replace('.', ',')}`);
  }
  return partes.length === 0 ? 'sin parámetros' : partes.join(' · ');
}

export interface ModelSamplingResult {
  connection: ConnectionProfile | null;
  error: string | null;
}

/**
 * pone, cambia o quita el muestreo de UN modelo dentro de una conexion.
 *
 * Un borrador con los cuatro campos vacios QUITA la entrada del modelo, y si
 * era la ultima quita tambien la clave `modelSampling`: vacio tiene que volver
 * a ser exactamente lo de antes, sin dejar un `{}` en `config.json` —que el
 * esquema, ademas, rechaza—.
 *
 * Valida con el MISMO esquema que aplicara el proceso principal al guardar, asi
 * que un «1.» a medio escribir o un 2,5 de temperatura se explican aqui, junto
 * al campo, y no como un fallo generico de configuracion.
 */
export function withModelSampling(
  connection: ConnectionProfile,
  apiModel: string,
  draft: SamplingDraft,
): ModelSamplingResult {
  const model = apiModel.trim();
  if (model.length === 0) return { connection: null, error: 'Elige el modelo.' };

  // se filtra por clave en vez de indexar: un modelo llamado `toString` no
  // puede tocar el prototipo
  const rest = Object.fromEntries(
    Object.entries(connection.modelSampling ?? {}).filter(([key]) => key !== model),
  );
  const fields = samplingDraftFields(draft);
  const entries = Object.keys(fields).length === 0 ? rest : { ...rest, [model]: fields };
  const { modelSampling: _previous, ...base } = connection;
  const next: ConnectionProfile =
    Object.keys(entries).length === 0 ? base : { ...base, modelSampling: entries };

  const parsed = connectionProfileSchema.safeParse(next);
  if (parsed.success) return { connection: next, error: null };

  return {
    connection: null,
    error: parsed.error.issues
      .slice(0, 3)
      .map((issue) => {
        // la ruta es [modelSampling, <modelo>, <campo>]: se nombra el campo en
        // castellano para que se sepa cual de los cuatro esta mal
        const field = issue.path[2];
        const label =
          typeof field === 'string' && field in SAMPLING_FIELD_LABELS
            ? SAMPLING_FIELD_LABELS[field as SamplingParameterKey]
            : null;
        return label === null ? issue.message : `${label}: ${issue.message}`;
      })
      .join('; '),
  };
}

export function httpProviderToDraft(provider: HttpProviderConfig): HttpProviderDraft {
  return {
    id: provider.id,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    model: provider.model,
    enabled: provider.enabled,
    supportsStreaming: provider.supportsStreaming,
    maxOutputTokens: String(provider.maxOutputTokens),
    dailyBudget: String(provider.dailyBudget),
    ...samplingToDraft(provider),
  };
}

/** el nombre interno no lo decide el renderer ni se muestra como campo libre */
export function apiKeyNameForProvider(id: string): string {
  return `LUXY_HTTP_${id.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

export function buildHttpProvider(
  draft: HttpProviderDraft,
  existing: HttpProviderConfig | null,
): HttpProviderBuildResult {
  const id = draft.id.trim().toLowerCase();
  const parsed = httpProviderConfigSchema.safeParse({
    id,
    displayName: draft.displayName.trim(),
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
    model: draft.model.trim(),
    apiKeyEnv: existing?.apiKeyEnv ?? apiKeyNameForProvider(id),
    enabled: draft.enabled,
    supportsStreaming: draft.supportsStreaming,
    maxOutputTokens: Number(draft.maxOutputTokens),
    dailyBudget: Number(draft.dailyBudget),
    // los cuatro de muestreo se OMITEN si el campo esta vacio. Omitir no es lo
    // mismo que mandar el valor neutro: una conexion sin configurar tiene que
    // seguir mandando el mismo cuerpo de siempre
    ...samplingDraftFields(draft),
    ...(existing?.softTerminalGraceMs === undefined
      ? {}
      : { softTerminalGraceMs: existing.softTerminalGraceMs }),
    // el tope de silencio no tiene campo en el formulario todavia: si no se
    // arrastra aqui, editar el modelo de una conexion le devolveria el valor
    // por defecto y se perderia el ajuste sin avisar
    ...(existing?.silenceTimeoutMs === undefined
      ? {}
      : { silenceTimeoutMs: existing.silenceTimeoutMs }),
    // lo mismo con el tope de llamadas diarias: es una proteccion, y una
    // proteccion que se apaga sola al editar otra cosa es peor que no tenerla
    ...(existing?.dailyCallLimit === undefined
      ? {}
      : { dailyCallLimit: existing.dailyCallLimit }),
  });
  if (parsed.success) return { provider: parsed.data, error: null };

  return {
    provider: null,
    error: parsed.error.issues
      .slice(0, 3)
      .map((issue) => issue.message)
      .join('; '),
  };
}
