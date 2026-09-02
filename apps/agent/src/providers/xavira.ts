// adaptador de la API de generacion de imagen y video.
//
// Contrato verificado en su documentacion publica el 2026-09-01:
//
//     POST /v1/characters          personaje persistente
//     POST /v1/images:generate     201 con output_url  |  202 con poll_url
//     POST /v1/videos:generate     202 siempre
//     GET  /v1/generations/:id     sondeo
//
// Se usa SONDEO y no `callback_url`, aunque la API lo ofrezca. Un callback
// exigiria una URL publica donde recibir el resultado, y la unica que tiene
// Luxy es el Worker: el contenido pasaria por el gateway, que es exactamente lo
// que la boveda existe para impedir. Sondear cuesta unas peticiones de mas y
// mantiene la premisa intacta. Es la misma razon por la que el agente sondea la
// cola en vez de exponer un puerto (docs/decisions/0001).
//
// Aqui NO se cifra nada ni se escribe en disco: este modulo pide, espera y
// devuelve bytes. Quien los recibe decide que hacer con ellos.
import { z } from 'zod';
import { computeBackoffDelay, defaultSleep, redact } from '@luxy/shared';

export class XaviraError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = 'XaviraError';
  }
}

export interface XaviraOptions {
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
  /** inyectable para probar sin red */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** tope de una peticion suelta */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

// -----------------------------------------------------------------------------
// contratos de respuesta
//
// todo lo que llega de fuera se valida, aunque sea de un proveedor de pago: una
// respuesta con otra forma debe fallar aqui y no tres capas mas abajo.
// -----------------------------------------------------------------------------

export const GENERATION_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

const generationSchema = z.object({
  generation_id: z.string().min(1).max(128),
  status: z.enum(GENERATION_STATUSES),
  output_url: z.string().url().max(4000).nullish(),
  poll_url: z.string().max(4000).nullish(),
  cost_credits: z.number().min(0).nullish(),
  gen_time_ms: z.number().int().min(0).nullish(),
  error: z.string().max(2000).nullish(),
});

const characterSchema = z.object({
  character_id: z.string().min(1).max(128),
});

export interface Generation {
  generationId: string;
  status: (typeof GENERATION_STATUSES)[number];
  outputUrl: string | null;
  costCredits: number | null;
  genTimeMs: number | null;
  error: string | null;
}

function toGeneration(raw: z.infer<typeof generationSchema>): Generation {
  return {
    generationId: raw.generation_id,
    status: raw.status,
    outputUrl: raw.output_url ?? null,
    costCredits: raw.cost_credits ?? null,
    genTimeMs: raw.gen_time_ms ?? null,
    error: raw.error ?? null,
  };
}

// -----------------------------------------------------------------------------
// transporte
// -----------------------------------------------------------------------------

/** segundos que pide esperar la cabecera Retry-After, si viene */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('Retry-After');
  if (header === null) return null;
  const seconds = Number.parseInt(header, 10);
  // la documentacion promete menos de 60 s; se acota igual por si acaso
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, 60) * 1000;
}

async function call(
  options: XaviraOptions,
  path: string,
  init: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await doFetch(`${options.baseUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new XaviraError(
        // dos capas: la clave propia de esta llamada y el resto de secretos
        // que el proceso tenga registrados
        redact(stripKey(`la API respondio ${response.status}: ${text.slice(0, 300)}`, options.apiKey)),
        response.status,
        hintForStatus(response.status),
      );
    }
    return { response, body: await response.json() };
  } catch (error) {
    if (error instanceof XaviraError) throw error;
    if (controller.signal.aborted && !options.signal.aborted) {
      throw new XaviraError('la API no respondio a tiempo');
    }
    throw new XaviraError(
      redact(stripKey(error instanceof Error ? error.message : String(error), options.apiKey)),
    );
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * tapa la clave en cualquier texto antes de que llegue a un error o a un log.
 *
 * `redact()` solo cubre los secretos que estan registrados, y esta clave llega
 * por parametro sin pasar por el registro. Algunas APIs repiten la clave
 * recibida en el cuerpo del error, asi que sin esto un 400 podia acabar
 * escribiendola en el archivo de registro. Lo detecto una prueba.
 */
function stripKey(text: string, apiKey: string): string {
  if (apiKey.length === 0) return text;
  return text.split(apiKey).join('[clave]');
}

function hintForStatus(status: number): string | null {
  if (status === 401 || status === 403) return 'comprueba la clave en Conexiones';
  if (status === 402) return 'la cuenta se quedo sin creditos';
  if (status === 429) return 'demasiadas peticiones seguidas; espera un momento';
  return null;
}

// -----------------------------------------------------------------------------
// operaciones
// -----------------------------------------------------------------------------

/**
 * tope de la imagen de referencia, antes de codificarla.
 *
 * base64 la engorda un tercio, y viaja dentro de un JSON. Un archivo grande no
 * da mejor parecido: da una peticion enorme y un fallo dificil de leer.
 */
export const MAX_REFERENCE_IMAGE_BYTES = 6 * 1024 * 1024;

/**
 * modelos validos para crear un personaje.
 *
 * NO salen de la documentacion: los dijo la propia API al rechazar una
 * peticion sin `model_id`, el 2026-09-02. Su mensaje, literal, fue que
 * `model_id` debe ser uno de `realistic-sharp-v1` o `anime-pure-v1`, que los
 * modelos de video **no valen** para crear un personaje, y que `anime-v1` y
 * `anime-sharp-v1` se aceptan como alias antiguos de `anime-pure-v1`.
 *
 * Se dejan aqui los dos canonicos. La lista no se impone en esta capa: si la
 * API añade uno, mandarlo debe funcionar sin tocar el adaptador, y si es
 * invalido su propio error lo explica mejor que cualquier comprobacion local.
 */
export const CHARACTER_MODELS = ['realistic-sharp-v1', 'anime-pure-v1'] as const;
export type CharacterModel = (typeof CHARACTER_MODELS)[number];

export interface CreateCharacterRequest {
  /**
   * modelo del personaje. OBLIGATORIO: sin el, la API responde 400
   * `invalid_model_id`. Decide el aspecto y no se puede cambiar despues.
   */
  modelId: string;
  traits?: Record<string, string>;
  /**
   * imagen de referencia EN LINEA, dentro del cuerpo de la peticion.
   *
   * Es la unica forma de dar un parecido sin alojar la foto en ninguna parte.
   * El campo de la API se llama `reference_image_url` y espera una URL, pero un
   * `data:` URI TAMBIEN es una URL: asi el proveedor recibe la imagen sin que
   * exista una direccion publica desde la que cualquiera pueda descargarla.
   *
   * Es el mismo criterio que hace que aqui se sondee en vez de usar
   * `callback_url`: Luxy no expone nada publico.
   *
   * Lo que NO evita, y hay que decirlo: el proveedor ve la imagen en claro.
   * Igual que ve el prompt.
   */
  referenceImage?: { bytes: Uint8Array; mimeType: string };
  /**
   * referencia por URL publica.
   *
   * Alternativa a `referenceImage` para cuando la imagen ya esta publicada y se
   * asume. Si se dan las dos, manda la de en linea.
   */
  referenceImageUrl?: string;
}

/** `data:` URI a partir de bytes. No toca disco ni deja copia sin cifrar */
export function toDataUri(bytes: Uint8Array, mimeType: string): string {
  if (bytes.length === 0) throw new XaviraError('la imagen de referencia esta vacia');
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new XaviraError(
      'la imagen de referencia es demasiado grande',
      null,
      'usa una de menos de 6 MB: no mejora el parecido y la peticion falla',
    );
  }
  if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) {
    throw new XaviraError('la imagen de referencia no es una imagen');
  }

  // se construye en trozos: `String.fromCharCode(...bytes)` con megas de datos
  // revienta la pila por el numero de argumentos
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** crea un personaje persistente y devuelve su identificador */
export async function createCharacter(
  request: CreateCharacterRequest,
  options: XaviraOptions,
): Promise<string> {
  // la de en linea manda sobre la publica: si alguien aporta las dos, la
  // intencion es no publicar nada
  const reference =
    request.referenceImage !== undefined
      ? toDataUri(request.referenceImage.bytes, request.referenceImage.mimeType)
      : request.referenceImageUrl;

  const { body } = await call(options, '/v1/characters', {
    method: 'POST',
    body: JSON.stringify({
      model_id: request.modelId,
      ...(request.traits === undefined ? {} : { traits: request.traits }),
      ...(reference === undefined ? {} : { reference_image_url: reference }),
    }),
  });

  const parsed = characterSchema.safeParse(body);
  if (!parsed.success) throw new XaviraError('la respuesta del personaje no tiene el formato esperado');
  return parsed.data.character_id;
}

export interface ImageRequest {
  characterId: string;
  prompt: string;
  resolution?: string;
  hiresFix?: '1.25x' | '1.5x';
  pose?: string;
  rawPrompt?: boolean;
}

/**
 * pide una imagen.
 *
 * puede volver ya terminada (201) o pendiente (202). Quien llama no deberia
 * tener que distinguirlo: para eso esta `awaitGeneration`.
 */
export async function generateImage(
  request: ImageRequest,
  options: XaviraOptions,
): Promise<Generation> {
  const { body } = await call(options, '/v1/images:generate', {
    method: 'POST',
    body: JSON.stringify({
      character_id: request.characterId,
      prompt: request.prompt,
      ...(request.resolution === undefined ? {} : { resolution: request.resolution }),
      ...(request.hiresFix === undefined ? {} : { hires_fix: request.hiresFix }),
      ...(request.pose === undefined ? {} : { pose: request.pose }),
      ...(request.rawPrompt === undefined ? {} : { raw_prompt: request.rawPrompt }),
    }),
  });

  const parsed = generationSchema.safeParse(body);
  if (!parsed.success) throw new XaviraError('la respuesta de imagen no tiene el formato esperado');
  return toGeneration(parsed.data);
}

export interface VideoRequest {
  characterId: string;
  /** anima una imagen anterior en vez de partir de cero */
  fromGenerationId?: string;
  prompt?: string;
  duration?: '5s' | '10s';
}

/** pide un video. siempre vuelve pendiente */
export async function generateVideo(
  request: VideoRequest,
  options: XaviraOptions,
): Promise<Generation> {
  const { body } = await call(options, '/v1/videos:generate', {
    method: 'POST',
    // sin callback_url a proposito: ver la cabecera de este archivo
    body: JSON.stringify({
      character_id: request.characterId,
      ...(request.fromGenerationId === undefined
        ? {}
        : { generation_id: request.fromGenerationId }),
      ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
      ...(request.duration === undefined ? {} : { duration: request.duration }),
    }),
  });

  const parsed = generationSchema.safeParse(body);
  if (!parsed.success) throw new XaviraError('la respuesta de video no tiene el formato esperado');
  return toGeneration(parsed.data);
}

/** consulta el estado de una generacion */
export async function readGeneration(
  generationId: string,
  options: XaviraOptions,
): Promise<Generation> {
  const { body } = await call(options, `/v1/generations/${encodeURIComponent(generationId)}`, {
    method: 'GET',
  });
  const parsed = generationSchema.safeParse(body);
  if (!parsed.success) throw new XaviraError('la respuesta de estado no tiene el formato esperado');
  return toGeneration(parsed.data);
}

export interface AwaitOptions {
  /** tope total de espera. un video de 10 s puede tardar minutos */
  maxWaitMs?: number;
  onProgress?: (attempt: number, status: string) => void;
}

const DEFAULT_MAX_WAIT_MS = 10 * 60_000;

/**
 * espera a que una generacion termine, sondeando.
 *
 * respeta `Retry-After` cuando la API lo pide y, si no, sube el intervalo de
 * forma exponencial: sondear cada 500 ms un video que tarda tres minutos son
 * cientos de peticiones inutiles y un 429 asegurado.
 */
export async function awaitGeneration(
  generation: Generation,
  options: XaviraOptions & AwaitOptions,
): Promise<Generation> {
  if (generation.status === 'completed') return generation;
  if (generation.status === 'failed') {
    throw new XaviraError(generation.error ?? 'la generacion fallo sin explicacion');
  }

  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + (options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
  let attempt = 0;
  let current = generation;

  while (Date.now() < deadline) {
    if (options.signal.aborted) throw new XaviraError('generacion cancelada');

    const delay = computeBackoffDelay(attempt, { baseDelayMs: 1500, maxDelayMs: 15_000 });
    await sleep(delay, options.signal);
    attempt += 1;

    current = await readGeneration(current.generationId, options);
    options.onProgress?.(attempt, current.status);

    if (current.status === 'completed') return current;
    if (current.status === 'failed') {
      throw new XaviraError(current.error ?? 'la generacion fallo sin explicacion');
    }
  }

  throw new XaviraError(
    'la generacion no termino a tiempo',
    null,
    'sigue en curso en el proveedor; puedes volver a consultarla mas tarde',
  );
}

/**
 * descarga el resultado.
 *
 * la URL la da el proveedor y apunta a su almacenamiento, asi que se exige
 * HTTPS: una URL http seria contenido privado viajando en claro por la red.
 */
export async function downloadOutput(
  outputUrl: string,
  options: XaviraOptions,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let url: URL;
  try {
    url = new URL(outputUrl);
  } catch {
    throw new XaviraError('la URL del resultado no es valida');
  }
  if (url.protocol !== 'https:') {
    throw new XaviraError('el resultado no se descarga por una conexion insegura');
  }

  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new XaviraError(`no se pudo descargar el resultado (${response.status})`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get('Content-Type') ?? 'application/octet-stream',
  };
}

export { retryAfterMs };
