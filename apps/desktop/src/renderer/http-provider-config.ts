import {
  catalogDialectFor,
  catalogReasoningFor,
  connectionProfileSchema,
  httpProviderConfigSchema,
  REASONING_MODE_SHORT,
  REASONING_MODES,
  reasoningNoteFor,
  reasoningOptionsFor,
} from '@luxy/shared';
import type {
  CatalogDialect,
  CatalogReasoning,
  CatalogReasoningState,
  CatalogSnapshot,
  ConnectionProfile,
  ReasoningMode,
  SamplingParameterKey,
  SamplingParameters,
  StoredAgentConfig,
} from '@luxy/shared';
import { effectiveModelSettings } from '../shared/model-selection.js';
import type { EffectiveModelSettings } from '../shared/model-selection.js';
import type { StoredCatalog } from './useCatalog.js';

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
  /**
   * razonamiento elegido (D-107). La cadena vacia es «lo que traiga el
   * modelo»: no se manda nada, igual que los cuatro de arriba.
   *
   * Este es el del NIVEL DE PROVEEDOR. En un host con dialecto de catalogo
   * (NanoGPT) no se guarda nunca con valor: alli vale para cientos de modelos
   * que declaran niveles distintos, y se elige por modelo (`ProviderModelDraft`).
   */
  reasoningMode: ReasoningModeDraft;
}

/** el valor de un `<select>` de razonamiento: vacio o uno de los modos */
export type ReasoningModeDraft = '' | ReasoningMode;

/** convierte el valor del `<select>` sin fiarse de el: lo que no es un modo es vacio */
export function reasoningModeDraft(value: string): ReasoningModeDraft {
  return (REASONING_MODES as readonly string[]).includes(value) ? (value as ReasoningMode) : '';
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
    reasoningMode: '',
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
 * formulario de proveedor, el de muestreo por modelo de una conexion y el de
 * ajustes por modelo de un proveedor HTTP (`ProviderModelDraft`), para que la
 * coma, el vacio y el NaN a medio escribir se traten igual en los tres.
 */
export type SamplingDraft = Pick<HttpProviderDraft, SamplingParameterKey | 'reasoningMode'>;

export function emptySamplingDraft(): SamplingDraft {
  return {
    temperature: '',
    frequencyPenalty: '',
    presencePenalty: '',
    repetitionPenalty: '',
    reasoningMode: '',
  };
}

export function samplingToDraft(parameters: SamplingParameters | undefined): SamplingDraft {
  return {
    temperature: numberToDraft(parameters?.temperature),
    frequencyPenalty: numberToDraft(parameters?.frequencyPenalty),
    presencePenalty: numberToDraft(parameters?.presencePenalty),
    repetitionPenalty: numberToDraft(parameters?.repetitionPenalty),
    reasoningMode: parameters?.reasoningMode ?? '',
  };
}

/** los campos rellenos, listos para Zod; los vacios se omiten enteros */
function samplingDraftFields(draft: SamplingDraft): Record<string, number | string> {
  return {
    ...sampling('temperature', draft.temperature),
    ...sampling('frequencyPenalty', draft.frequencyPenalty),
    ...sampling('presencePenalty', draft.presencePenalty),
    ...sampling('repetitionPenalty', draft.repetitionPenalty),
    // vacio se OMITE, como los numeros: la clave no llega a config.json
    ...(draft.reasoningMode === '' ? {} : { reasoningMode: draft.reasoningMode }),
  };
}

const SAMPLING_FIELD_LABELS: Record<SamplingParameterKey | 'reasoningMode', string> = {
  temperature: 'Temperatura',
  frequencyPenalty: 'Penalización por frecuencia',
  presencePenalty: 'Penalización por presencia',
  repetitionPenalty: 'Penalización por repetición',
  reasoningMode: 'Razonamiento',
};

/**
 * el host de una URL base, o null si todavia no es una URL.
 *
 * Hace falta porque dos reglas de razonamiento —las de Groq— solo valen en su
 * host: el mismo nombre de modelo en OpenRouter tiene otro dialecto. Y porque
 * un host con dialecto de catalogo (NanoGPT) no va por la tabla.
 */
export function hostOfBaseUrl(baseUrl: string): string | null {
  try {
    return new URL(baseUrl.trim()).host;
  } catch {
    return null;
  }
}

/**
 * la fecha de un catalogo guardado tal y como se dice en pantalla, o null si no
 * hay fecha que decir.
 *
 * Existe porque en un host con dialecto de catalogo todo lo que se afirma es
 * «la pasarela declara, en su catalogo de tal dia» (`D-093`): la fecha va
 * siempre al lado, y tiene que decirse igual en los errores y en las pistas.
 */
export function catalogDateLabel(fetchedAt: string | null | undefined): string | null {
  if (fetchedAt === null || fetchedAt === undefined) return null;
  const date = new Date(fetchedAt);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('es-ES');
}

/**
 * lo que la pantalla sabe al OFRECER o VALIDAR un nivel de razonamiento.
 *
 * Solo cuenta en un host con dialecto de catalogo. En los demas manda la tabla
 * de `D-107` y nada de esto se mira.
 */
export interface ReasoningChoiceContext {
  /**
   * el valor va al nivel SUPERIOR de un proveedor HTTP, no a la entrada de un
   * modelo. En un host con dialecto ese nivel ni se ofrece ni se guarda
   */
  providerWide?: boolean;
  /**
   * el catalogo guardado del origen, tal y como lo devuelve `useStoredCatalog`.
   *
   * AUSENTE no es «no hay catalogo»: es que quien llama no tiene ninguno que
   * leer, como el muestreo por modelo de una conexion. Para poder decir que no
   * hay catalogo guardado hay que haberlo leido: `{ snapshot: null, loading: false }`
   */
  stored?: StoredCatalog;
}

/**
 * de donde salen las opciones de un selector de razonamiento.
 *
 *  - `table`: host sin dialecto de catalogo; manda la tabla de `D-107`;
 *  - `provider-wide`: host con dialecto y valor de nivel de proveedor. Alli se
 *    elige por modelo y no se ofrece nada;
 *  - `unavailable`: host con dialecto y quien llama no tiene catalogo que leer;
 *  - `loading`: el catalogo guardado todavia no se ha leido. NO es «no hay»;
 *  - el resto son los seis estados de `catalogReasoningFor`. De ellos solo
 *    ofrecen algo `levels` (lo declarado) y `basic` y `no-levels` (a mano, los
 *    siete).
 */
export type ReasoningChoiceSource =
  'table' | 'provider-wide' | 'unavailable' | 'loading' | CatalogReasoningState;

export interface ReasoningChoices {
  source: ReasoningChoiceSource;
  /** el dialecto de catalogo del host, o null si va por la tabla */
  dialect: CatalogDialect | null;
  /** lo que se puede elegir, en orden. Vacio = el selector no ofrece nada */
  options: readonly ReasoningMode[];
  /** lo que hay que saber antes de elegir (`reasoningNoteFor`), o null */
  note: string | null;
  /**
   * se elige A MANO entre los siete y decide la pasarela: el catalogo se leyo
   * sin detalle, o el modelo no declara niveles
   */
  manual: boolean;
  /**
   * lo que el catalogo guardado dice de ESE modelo, con su fecha y el tope de
   * salida que declara; null si no hay catalogo leido que mirar
   */
  catalog: CatalogReasoning | null;
}

/**
 * las opciones de razonamiento de un modelo en un host, con lo declarado.
 *
 * ES EL UNICO SITIO DEL RENDERER QUE LAS CALCULA. Las piden tres puntos —el
 * selector, la validacion al guardar y el aviso de DeepSeek— y los tres tienen
 * que ver lo mismo: si el selector ofreciera un nivel que la validacion
 * rechaza, o el aviso hablara de una tabla que en ese host no se consulta, la
 * pantalla se contradiria a si misma.
 *
 * El modelo se busca en el catalogo EXACTO, despues de recortar los espacios:
 * es el mismo nombre que acaba de clave en `modelSampling`.
 */
export function reasoningChoicesFor(
  model: string,
  baseUrl: string,
  context?: ReasoningChoiceContext,
): ReasoningChoices {
  const name = model.trim();
  const host = hostOfBaseUrl(baseUrl);
  const dialect = catalogDialectFor(host);
  if (dialect === null) {
    return {
      source: 'table',
      dialect: null,
      options: reasoningOptionsFor(name, host),
      note: reasoningNoteFor(name, host),
      manual: false,
      catalog: null,
    };
  }
  const nothing = { dialect, options: [], note: null, manual: false, catalog: null } as const;
  if (context?.providerWide === true) return { source: 'provider-wide', ...nothing };
  const stored = context?.stored;
  if (stored === undefined) return { source: 'unavailable', ...nothing };
  if (stored.loading) return { source: 'loading', ...nothing };
  const catalog = catalogReasoningFor(stored.snapshot, name);
  const manual = catalog.state === 'basic' || catalog.state === 'no-levels';
  const declared = { declared: catalog.state === 'levels' ? catalog.levels : null, manual };
  return {
    source: catalog.state,
    dialect,
    options: reasoningOptionsFor(name, host, declared),
    note: reasoningNoteFor(name, host, declared),
    manual,
    catalog,
  };
}

/**
 * si un valor guardado ya NO esta entre lo que se ofrece.
 *
 * Mientras el catalogo se esta leyendo no se da por huerfano nada: todavia no
 * se sabe que declara la pasarela, y marcarlo seria afirmarlo.
 */
export function isReasoningOrphan(value: ReasoningModeDraft, choices: ReasoningChoices): boolean {
  if (value === '' || choices.source === 'loading') return false;
  return !choices.options.includes(value);
}

/**
 * por que no se puede guardar ese razonamiento, o null si se puede.
 *
 * Se comprueba al guardar, y no solo en el `<select>`: si alguien cambia el
 * modelo despues de elegir, el valor ya no vale para el nuevo. En un host de la
 * tabla, guardarlo seria un ajuste que se ve en la lista y que no viaja nunca
 * (`not_sent`).
 *
 * En un host con dialecto de catalogo es al reves, y por eso importa mas: alli
 * el agente NO vuelve a comprobar el nivel —no conoce el catalogo—, asi que lo
 * que se guarde en la entrada de un modelo VIAJA. Esta es la unica barrera, y
 * solo deja pasar lo que se ofrece: lo declarado, o los siete cuando se elige a
 * mano. El nivel de proveedor se rechaza siempre: valdria para todos sus
 * modelos sin que nadie mirase que declara cada uno, y el agente no lo manda.
 *
 * Los textos de esos hosts dicen lo que la pasarela DECLARA, con la fecha del
 * catalogo, y nunca lo que el modelo «admite» (`D-093`).
 */
export function reasoningModeError(
  mode: ReasoningModeDraft,
  model: string,
  baseUrl: string,
  context?: ReasoningChoiceContext,
): string | null {
  if (mode === '') return null;
  const choices = reasoningChoicesFor(model, baseUrl, context);
  if (choices.options.includes(mode)) return null;
  const label = choices.dialect?.label;
  if (label === undefined) {
    return 'Razonamiento: este modelo no lo admite con ese valor. Déjalo en «Lo que traiga el modelo».';
  }
  const date = catalogDateLabel(choices.catalog?.fetchedAt);
  const theirCatalog = date === null ? 'su catálogo guardado' : `su catálogo del ${date}`;
  switch (choices.source) {
    case 'provider-wide':
      return (
        `Razonamiento: en ${label} el nivel no se elige para todo el proveedor, sino para cada ` +
        'modelo. Déjalo aquí en «Lo que traiga el modelo» y elígelo en «Ajustes por modelo», en ' +
        'la tarjeta de este proveedor.'
      );
    case 'unavailable':
      return (
        `Razonamiento: en ${label} los niveles salen de su catálogo, y Luxy sólo lo lee para un ` +
        'proveedor HTTP, en sus «Ajustes por modelo». Aquí déjalo en «Lo que traiga el modelo».'
      );
    case 'loading':
      return (
        `Razonamiento: Luxy todavía no ha leído el catálogo guardado de ${label} y no puede ` +
        'comprobar ese nivel. Espera un momento y vuelve a guardar.'
      );
    case 'missing':
      return (
        `Razonamiento: no hay ningún catálogo de ${label} guardado, y los niveles salen de él. ` +
        'Pulsa «Actualizar modelos de este proveedor» y vuelve a elegirlo, o déjalo en «Lo que ' +
        'traiga el modelo».'
      );
    case 'unknown-model':
      return (
        `Razonamiento: este identificador no está en el catálogo de ${label}` +
        `${date === null ? '' : ` del ${date}`}. Comprueba las mayúsculas y el sufijo, o pulsa ` +
        '«Actualizar modelos de este proveedor»; mientras tanto, déjalo en «Lo que traiga el ' +
        'modelo».'
      );
    case 'not-reasoning':
      return (
        `Razonamiento: ${label} declara que este modelo no razona, en ${theirCatalog}. Déjalo ` +
        'en «Lo que traiga el modelo».'
      );
    case 'levels':
      // niveles declarados que Luxy no sabe nombrar: no hay ninguno que ofrecer
      if (choices.options.length === 0) {
        return (
          `Razonamiento: ${label} declara para este modelo, en ${theirCatalog}, niveles que ` +
          `Luxy no sabe pedir (${(choices.catalog?.levels ?? []).join(', ')}). Déjalo en «Lo ` +
          'que traiga el modelo».'
        );
      }
      return (
        `Razonamiento: ${label} no declara ese nivel para este modelo en ${theirCatalog}. Elige ` +
        `uno de los que declara (${choices.options
          .map((option) => REASONING_MODE_SHORT[option])
          .join(', ')}) o déjalo en «Lo que traiga el modelo».`
      );
    default:
      // `basic` y `no-levels` ofrecen los siete: aqui solo llega un valor que no
      // es un modo, escrito a mano
      return 'Razonamiento: ese valor no se puede elegir. Déjalo en «Lo que traiga el modelo».';
  }
}

/**
 * resumen de una entrada para la lista de la conexion, con coma decimal: es lo
 * que se escribio en el campo, y leerlo con punto haria dudar de si se guardo
 */
export function describeSampling(parameters: SamplingParameters): string {
  const partes = samplingSummaryParts(parameters);
  return partes.length === 0 ? 'sin parámetros' : partes.join(' · ');
}

/** las piezas del resumen, para que la lista de un proveedor HTTP añada su tope */
function samplingSummaryParts(parameters: SamplingParameters): string[] {
  const partes: string[] = [];
  for (const [key, label] of Object.entries(SAMPLING_FIELD_LABELS) as [
    SamplingParameterKey | 'reasoningMode',
    string,
  ][]) {
    if (key === 'reasoningMode') continue;
    const value = parameters[key];
    if (value !== undefined) partes.push(`${label} ${String(value).replace('.', ',')}`);
  }
  if (parameters.reasoningMode !== undefined) {
    partes.push(`Razonamiento: ${REASONING_MODE_SHORT[parameters.reasoningMode]}`);
  }
  return partes;
}

/**
 * las entradas de muestreo que quedan despues de poner, cambiar o quitar la de
 * UN modelo. Sin ninguna, un objeto vacio: quien llama quita entonces la clave.
 *
 * ES EL NUCLEO COMUN de una conexion y de un proveedor HTTP. Los dos guardan
 * `modelSampling` con el mismo esquema, asi que los dos tienen que tratar igual
 * el borrador vacio —que QUITA la entrada—, la coma decimal y los nombres raros.
 * Lo que cambia de uno a otro es solo el dueño y con que esquema se valida.
 */
function modelSamplingAfter(
  current: Readonly<Record<string, SamplingParameters>> | undefined,
  model: string,
  draft: SamplingDraft,
): Record<string, SamplingParameters | Record<string, number | string>> {
  // se filtra por clave en vez de indexar: un modelo llamado `toString` no
  // puede tocar el prototipo
  const rest = Object.fromEntries(Object.entries(current ?? {}).filter(([key]) => key !== model));
  const fields = samplingDraftFields(draft);
  return Object.keys(fields).length === 0 ? rest : { ...rest, [model]: fields };
}

/** lo minimo de un fallo de Zod que hace falta para explicarlo */
interface SchemaIssue {
  path: readonly (string | number)[];
  message: string;
  code: string;
}

/**
 * un fallo del esquema con el campo nombrado en castellano.
 *
 * La ruta de un fallo de muestreo es [modelSampling, <modelo>, <campo>] tanto en
 * una conexion como en un proveedor HTTP: es el mismo esquema. Se nombra el
 * campo para que se sepa cual de los cuatro esta mal.
 */
function describeSamplingIssue(issue: SchemaIssue): string {
  const field = issue.path[2];
  const label =
    typeof field === 'string' && Object.hasOwn(SAMPLING_FIELD_LABELS, field)
      ? SAMPLING_FIELD_LABELS[field as SamplingParameterKey | 'reasoningMode']
      : null;
  return label === null ? issue.message : `${label}: ${issue.message}`;
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
 *
 * NO recibe ningun catalogo: el razonamiento de una conexion se valida contra
 * la tabla de `D-107`, como siempre. Si su URL es la de un host con dialecto de
 * catalogo, no hay nada que ofrecer aqui y cualquier nivel se rechaza: lo
 * declarado solo se lee para un proveedor HTTP (`withProviderModelSampling`).
 */
export function withModelSampling(
  connection: ConnectionProfile,
  apiModel: string,
  draft: SamplingDraft,
): ModelSamplingResult {
  const model = apiModel.trim();
  if (model.length === 0) return { connection: null, error: 'Elige el modelo.' };
  const razonamiento = reasoningModeError(draft.reasoningMode, model, connection.baseUrl);
  if (razonamiento !== null) return { connection: null, error: razonamiento };

  const entries = modelSamplingAfter(connection.modelSampling, model, draft);
  const { modelSampling: _previous, ...base } = connection;
  const next: ConnectionProfile =
    Object.keys(entries).length === 0 ? base : { ...base, modelSampling: entries };

  const parsed = connectionProfileSchema.safeParse(next);
  if (parsed.success) return { connection: next, error: null };

  return {
    connection: null,
    error: parsed.error.issues.slice(0, 3).map(describeSamplingIssue).join('; '),
  };
}

// -----------------------------------------------------------------------------
// ajustes por modelo de un proveedor HTTP (F36)
// -----------------------------------------------------------------------------

/**
 * el borrador de los ajustes de UN modelo de un proveedor HTTP: el muestreo de
 * siempre y, aparte, su tope de salida.
 *
 * `outputCap` NO se llama `maxOutputTokens` a proposito: ese nombre es el del
 * tope del PROVEEDOR en `HttpProviderDraft`, y con el mismo nombre acabaria
 * dentro de los campos de muestreo. Se guarda en otro sitio —el mapa hermano
 * `modelOutputCaps`, no la entrada de `modelSampling`— porque poner solo el
 * tope no puede taparle al modelo la temperatura del proveedor.
 */
export interface ProviderModelDraft extends SamplingDraft {
  /** cadena, como los demas: vacia = el tope del proveedor, y no se escribe nada */
  outputCap: string;
}

export function emptyProviderModelDraft(): ProviderModelDraft {
  return { ...emptySamplingDraft(), outputCap: '' };
}

/** lo que un proveedor HTTP tiene guardado para UN modelo, en sus dos mapas */
export interface ProviderModelSettings {
  apiModel: string;
  /** su entrada de `modelSampling`, si la tiene */
  sampling: SamplingParameters | undefined;
  /** su tope en `modelOutputCaps`, si lo tiene */
  outputCap: number | undefined;
}

/**
 * los modelos con algun ajuste propio en un proveedor HTTP, uno por fila.
 *
 * Junta los dos mapas porque en pantalla son UNA lista: un modelo puede tener
 * solo muestreo, solo tope o las dos cosas, y enseñarlo en dos listas haria
 * creer que son dos ajustes de modelos distintos. Primero los que tienen
 * muestreo, en su orden, y despues los que solo tienen tope.
 */
export function providerModelSettings(
  provider: Pick<HttpProviderConfig, 'modelSampling' | 'modelOutputCaps'>,
): ProviderModelSettings[] {
  // `Object.entries` y `Map`, no indices: un modelo llamado `toString` no puede
  // sacar nada del prototipo
  const caps = new Map(Object.entries(provider.modelOutputCaps ?? {}));
  const rows: ProviderModelSettings[] = Object.entries(provider.modelSampling ?? {}).map(
    ([apiModel, sampling]) => ({ apiModel, sampling, outputCap: caps.get(apiModel) }),
  );
  const seen = new Set(rows.map((row) => row.apiModel));
  for (const [apiModel, outputCap] of caps) {
    if (!seen.has(apiModel)) rows.push({ apiModel, sampling: undefined, outputCap });
  }
  return rows;
}

/**
 * los modelos que se SUGIEREN al añadir un ajuste por modelo, sacados del
 * catalogo guardado del proveedor.
 *
 * Primero los que declaran niveles de razonamiento: son los que casi siempre se
 * vienen a buscar aqui, y entre los cientos de un agregador quedarian perdidos.
 * Dentro de cada grupo se respeta el orden del catalogo. Los que ya tienen
 * ajuste no se sugieren: escribir su nombre otra vez pisaria el que hay.
 *
 * Son sugerencias, no una lista cerrada: el nombre es texto libre, y sin
 * catalogo guardado no se sugiere nada —de un proveedor HTTP no se sabe que
 * sirve hasta preguntarle—.
 */
export function providerModelSuggestions(
  snapshot: CatalogSnapshot | null,
  taken: readonly string[],
): string[] {
  if (snapshot === null) return [];
  const seen = new Set(taken);
  const withLevels: string[] = [];
  const rest: string[] = [];
  for (const model of snapshot.models) {
    // el catalogo lo sirve un tercero: un nombre repetido saldria dos veces
    if (seen.has(model.apiModel)) continue;
    seen.add(model.apiModel);
    ((model.reasoningEfforts?.length ?? 0) > 0 ? withLevels : rest).push(model.apiModel);
  }
  return [...withLevels, ...rest];
}

export function providerModelSettingsToDraft(
  settings: Pick<ProviderModelSettings, 'sampling' | 'outputCap'> | undefined,
): ProviderModelDraft {
  return {
    ...samplingToDraft(settings?.sampling),
    outputCap: numberToDraft(settings?.outputCap),
  };
}

/**
 * resumen de una fila de «Ajustes por modelo», con el tope al final.
 *
 * El tope sale tal y como se escribio, sin separador de miles: leer «16.384»
 * despues de teclear «16384» haria dudar de que se guardo.
 */
export function describeProviderModelSettings(
  settings: Pick<ProviderModelSettings, 'sampling' | 'outputCap'>,
): string {
  const partes = settings.sampling === undefined ? [] : samplingSummaryParts(settings.sampling);
  if (settings.outputCap !== undefined) partes.push(`Máximo de tokens ${settings.outputCap}`);
  return partes.length === 0 ? 'sin parámetros' : partes.join(' · ');
}

/**
 * si el tope de un borrador esta escrito de una forma que NO se va a guardar:
 * ni vacio ni solo digitos.
 *
 * POR QUE NO BASTA `draftNumber`: esta hecho para decimales —cambia la coma por
 * punto y pasa por `Number()`—, y `Number()` entiende mas de lo que aqui se
 * pide. «300.000» y «300,000» salian como 300, «1e4» como 10000 y «0x1000» como
 * 4096: enteros dentro del rango, asi que el esquema los daba por buenos y se
 * guardaba, sin un aviso, un tope distinto del tecleado, con la ayuda al lado
 * diciendo «sin puntos ni comas».
 *
 * Lo comparten el guardado y el aviso de tope corto, para que el aviso no hable
 * de un numero que luego no llega a `config.json`.
 */
function outputCapIsMalformed(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/^[0-9]+$/.test(trimmed);
}

/**
 * por debajo de este tope de salida conviene avisar a quien elige un nivel que
 * razona. Es el tope por defecto de un proveedor HTTP (`httpProviderConfigSchema`),
 * no una medida: el razonamiento se cobra como salida y gasta del MISMO
 * `max_tokens` que la respuesta, y con menos sitio es facil que lo agote antes
 * de escribir una palabra —una llamada pagada que acaba en error—.
 */
export const REASONING_OUTPUT_CAP_FLOOR = 8192;

/**
 * si hay que avisar de que el tope efectivo es corto para ese nivel.
 *
 * El tope EFECTIVO es el del modelo si el campo trae un numero, y si no el del
 * proveedor. Con el campo vacio o con «Sin razonar» no se avisa: vacio no manda
 * nada y apagado no gasta. Un numero a medio escribir tampoco avisa, ni uno
 * escrito con puntos, comas o exponente: eso lo explica el error al guardar.
 */
export function reasoningOutputCapIsShort(
  mode: ReasoningModeDraft,
  outputCap: string,
  providerMaxOutputTokens: number,
): boolean {
  if (mode === '' || mode === 'off') return false;
  // antes de `draftNumber`, que leeria «300.000» como 300 y avisaria de un tope
  // corto que el guardado va a rechazar
  if (outputCapIsMalformed(outputCap)) return false;
  const own = draftNumber(outputCap);
  const effective = own === undefined ? providerMaxOutputTokens : own;
  return Number.isFinite(effective) && effective < REASONING_OUTPUT_CAP_FLOOR;
}

export interface ProviderModelSamplingResult {
  provider: HttpProviderConfig | null;
  error: string | null;
}

const OUTPUT_CAP_ERROR =
  'Máximo de tokens de este modelo: tiene que ser un número entero entre 256 y 200000, sin ' +
  'puntos ni comas. Déjalo vacío para usar el del proveedor.';

/**
 * un fallo del esquema de un proveedor HTTP, explicado.
 *
 * Los del tope vienen con la ruta [modelOutputCaps, <modelo>] y el mensaje de
 * Zod en ingles: se cambian por uno que dice que escribir. El fallo de la CLAVE
 * —un nombre de modelo que no vale— llega con esa misma ruta, pero es de otro
 * tipo (`invalid_string`) y se deja como esta: no es culpa del tope.
 */
function describeProviderIssue(issue: SchemaIssue): string {
  if (
    issue.path[0] === 'modelOutputCaps' &&
    issue.path.length === 2 &&
    issue.code !== 'invalid_string'
  ) {
    return OUTPUT_CAP_ERROR;
  }
  return describeSamplingIssue(issue);
}

/**
 * pone, cambia o quita los ajustes de UN modelo en un proveedor HTTP: su
 * muestreo (`modelSampling`) y su tope de salida (`modelOutputCaps`).
 *
 * Es la variante de `withModelSampling` para `providers.http`, con las mismas
 * reglas y dos cosas mas:
 *
 *  - el TOPE va en su propio mapa. Un borrador con el muestreo vacio y el tope
 *    puesto escribe solo el tope, y el modelo sigue recibiendo la temperatura
 *    del proveedor; con todo vacio se quitan las dos entradas, y la ultima se
 *    lleva su clave: el proveedor vuelve a ser exactamente el de antes;
 *  - el razonamiento se valida con LO DECLARADO. `stored` es el catalogo
 *    guardado de ese proveedor (`useStoredCatalog`); en un host con dialecto de
 *    catalogo, mientras no se haya leido o si no existe no se puede guardar
 *    ningun nivel, porque alli lo que se guarda viaja sin que el agente lo
 *    vuelva a comprobar. Es OBLIGATORIO pasarlo, aunque en un host de la tabla
 *    no se mire: opcional, bastaria olvidarlo para que NanoGPT rechazase todos
 *    los niveles con un texto que habla de otra cosa.
 *
 * Quitar una entrada no depende del catalogo: un borrador vacio pasa siempre.
 */
export function withProviderModelSampling(
  provider: HttpProviderConfig,
  apiModel: string,
  draft: ProviderModelDraft,
  stored: StoredCatalog,
): ProviderModelSamplingResult {
  const model = apiModel.trim();
  if (model.length === 0) return { provider: null, error: 'Elige el modelo.' };
  const razonamiento = reasoningModeError(draft.reasoningMode, model, provider.baseUrl, {
    stored,
  });
  if (razonamiento !== null) return { provider: null, error: razonamiento };

  const sampling = modelSamplingAfter(provider.modelSampling, model, draft);
  const otherCaps = Object.fromEntries(
    Object.entries(provider.modelOutputCaps ?? {}).filter(([key]) => key !== model),
  );
  // antes de `draftNumber`: lo que no son solo digitos NO se convierte, porque
  // de «300.000» saldria un 300 que el esquema acepta (`outputCapIsMalformed`)
  if (outputCapIsMalformed(draft.outputCap)) return { provider: null, error: OUTPUT_CAP_ERROR };
  const cap = draftNumber(draft.outputCap);
  const caps = cap === undefined ? otherCaps : { ...otherCaps, [model]: cap };
  const { modelSampling: _sampling, modelOutputCaps: _caps, ...base } = provider;
  const next: HttpProviderConfig = {
    ...base,
    // las dos claves se OMITEN cuando no queda nada: ni `{}` ni `undefined`
    // llegan a `config.json`
    ...(Object.keys(sampling).length === 0 ? {} : { modelSampling: sampling }),
    ...(Object.keys(caps).length === 0 ? {} : { modelOutputCaps: caps }),
  };

  const parsed = httpProviderConfigSchema.safeParse(next);
  if (parsed.success) return { provider: next, error: null };

  // un nombre de modelo que no vale falla en los DOS mapas con el mismo texto:
  // dicho una vez basta
  const messages = new Set(parsed.error.issues.slice(0, 3).map(describeProviderIssue));
  return { provider: null, error: [...messages].join('; ') };
}

/**
 * lo que un proveedor HTTP le aplica a un modelo, dicho en una linea.
 *
 * Es la linea de SOLO LECTURA de Privado: alli se elige el modelo, pero el
 * nivel y el tope se guardan en Conexiones, y sin esto se conversaba sin saber
 * con que nivel iba a contestar ni cuanto sitio tenia para hacerlo.
 *
 * Dice lo que Luxy PIDE, no lo que el modelo hace: si razono solo lo dice el
 * registro (`D-093`). Y un nivel guardado que no llega al cuerpo se dice como
 * lo que es —guardado y sin enviar—, porque nombrarlo a secas prometeria un
 * efecto que no llega. El tope sale sin separador de miles, igual que en la
 * lista de «Ajustes por modelo»: es lo que se tecleo.
 */
export function describeEffectiveModelSettings(
  settings: EffectiveModelSettings,
  providerName: string,
): string {
  const model = settings.usesProviderDefault
    ? `${settings.model} (el modelo por defecto de ${providerName})`
    : settings.model;
  const fromProvider = settings.reasoningSource === 'provider';
  const reasoning =
    settings.reasoningMode === null
      ? 'Luxy no envía ningún nivel de razonamiento'
      : settings.reasoningTravels
        ? `Luxy pide el nivel de razonamiento «${REASONING_MODE_SHORT[settings.reasoningMode]}»` +
          (fromProvider ? ', el del proveedor' : ', el de su ajuste propio')
        : 'tiene guardado el nivel de razonamiento ' +
          `«${REASONING_MODE_SHORT[settings.reasoningMode]}»${fromProvider ? ' en el proveedor' : ''}` +
          ', pero Luxy no lo envía con este modelo';
  const cap =
    `el máximo de salida es de ${settings.outputCap} tokens, ` +
    (settings.outputCapSource === 'model' ? 'el de este modelo' : 'el del proveedor');
  return (
    `${model}: ${reasoning}; ${cap}. Se cambian en Conexiones, en la tarjeta de ` +
    `${providerName}: «Ajustes por modelo» para este modelo, «Editar» para todo el proveedor.`
  );
}

/**
 * esa misma linea a partir de la configuracion, o null si no hay nada que decir.
 *
 * `null` para todo lo que no sea una entrada de `providers.http`: los CLI y las
 * familias de una conexion no guardan estos ajustes ahi, y pintarles la linea
 * seria hablar de un tope que no es el suyo.
 *
 * Y `null` tambien para una entrada que el agente NO registra: la apagada —la
 * corta `effectiveModelSettings`— y la que no tiene su clave guardada, que se
 * mira aqui. Sin registrar, ese mismo id puede servirlo la familia de una
 * conexion, con otra URL y otro tope, y la linea describiria una entrada que no
 * es la que ejecuta.
 *
 * `configuredSecrets` es el mapa nombre -> guardada que el renderer ya tiene
 * (`secrets.configured`); de una clave no sabe nada mas. Es OBLIGATORIO pasarlo:
 * opcional, bastaria olvidarlo para volver a pintar la linea de una entrada sin
 * clave.
 *
 * `model` es el que VIAJA: null o vacio es «el del proveedor».
 */
export function effectiveModelSettingsLine(
  config: StoredAgentConfig | null,
  providerId: string,
  model: string | null,
  configuredSecrets: Readonly<Record<string, boolean>>,
): string | null {
  const settings = effectiveModelSettings(config, providerId, model);
  if (settings === null) return null;
  const entry = config?.providers.http.find((candidate) => candidate.id === providerId);
  // `=== true`, como en Conexiones: un nombre que falta da `undefined`
  if (entry === undefined || configuredSecrets[entry.apiKeyEnv] !== true) return null;
  return describeEffectiveModelSettings(settings, entry.displayName);
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

/**
 * por que no se puede llevar este proveedor a esa URL base, o null si se puede.
 *
 * `buildHttpProvider` ARRASTRA los ajustes por modelo de `existing` sin volver
 * a mirarlos. Con la tabla eso era inocuo: el agente vuelve a comprobar cada
 * modo contra el modelo y el host. En un host con dialecto de catalogo NO: alli
 * un nivel guardado en la entrada de un modelo viaja tal cual. Asi que cambiar
 * la URL hacia uno de esos hosts con niveles ya guardados dejaria viajando algo
 * que nadie comprobo contra el catalogo de ESA pasarela.
 *
 * Solo se rechaza el cambio HACIA un host con dialecto distinto del que tenia;
 * entre dos hosts del mismo dialecto no, y hacia un host de la tabla tampoco
 * —alli manda otra vez la tabla—. Las entradas sin razonamiento no estorban.
 */
function carriedReasoningUrlError(
  baseUrl: string,
  existing: HttpProviderConfig | null,
): string | null {
  if (existing === null) return null;
  const next = catalogDialectFor(hostOfBaseUrl(baseUrl));
  if (next === null) return null;
  const previous = catalogDialectFor(hostOfBaseUrl(existing.baseUrl));
  if (previous !== null && previous.family === next.family) return null;
  const models = Object.entries(existing.modelSampling ?? {})
    .filter(([, parameters]) => parameters.reasoningMode !== undefined)
    .map(([model]) => model);
  if (models.length === 0) return null;
  const named = models.slice(0, 3).join(', ');
  const others = models.length > 3 ? ` y ${models.length - 3} más` : '';
  return (
    'URL base: este proveedor tiene un nivel de razonamiento guardado en «Ajustes por modelo» ' +
    `(${named}${others}) que nadie comprobó contra el catálogo de ${next.label}, y ahí viajaría ` +
    `tal cual. Quita antes ese nivel de ${models.length === 1 ? 'ese modelo' : 'esos modelos'}, ` +
    `o crea otro proveedor para ${next.label}.`
  );
}

export function buildHttpProvider(
  draft: HttpProviderDraft,
  existing: HttpProviderConfig | null,
): HttpProviderBuildResult {
  const id = draft.id.trim().toLowerCase();
  // el del formulario es el nivel de PROVEEDOR: en un host con dialecto de
  // catalogo no se guarda nunca con valor
  const razonamiento = reasoningModeError(draft.reasoningMode, draft.model, draft.baseUrl, {
    providerWide: true,
  });
  if (razonamiento !== null) return { provider: null, error: razonamiento };
  const traslado = carriedReasoningUrlError(draft.baseUrl, existing);
  if (traslado !== null) return { provider: null, error: traslado };
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
    // los cuatro de muestreo, y el razonamiento, se OMITEN si el campo esta
    // vacio. Omitir no es lo mismo que mandar el valor neutro: una conexion sin
    // configurar tiene que seguir mandando el mismo cuerpo de siempre
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
    // tampoco tiene campo: sin arrastrarlo, guardar cualquier otra cosa le
    // devolvia la forma por defecto (`object`) a un proveedor configurado para
    // mandar la imagen como cadena, y nadie lo habia decidido
    ...(existing?.imageUrlFormat === undefined ? {} : { imageUrlFormat: existing.imageUrlFormat }),
    // los ajustes POR MODELO se editan en su propia seccion, no en este
    // formulario: si no se arrastran, pulsar «Guardar proveedor» los borra
    // todos —niveles de razonamiento y topes— sin un solo aviso. Sin ellos no
    // se añade ninguna clave
    ...(existing?.modelSampling === undefined ? {} : { modelSampling: existing.modelSampling }),
    ...(existing?.modelOutputCaps === undefined
      ? {}
      : { modelOutputCaps: existing.modelOutputCaps }),
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
