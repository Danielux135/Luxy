// adaptador de transporte de la API de AI Horde para generar imagenes.
//
// Contrato verificado contra su swagger vivo y su codigo fuente el 2026-09-04:
//
//     POST   /v2/generate/async        202 con { id, kudos, warnings? }
//     GET    /v2/generate/check/{id}   sondeo barato (10/s por IP, cache de 1 s)
//     GET    /v2/generate/status/{id}  resultado completo (10 POR MINUTO)
//     DELETE /v2/generate/status/{id}  unica forma de cancelar
//     GET    /v2/find_user             saldo de kudos
//     GET    /v2/status/models         catalogo real de modelos cargados
//
// La diferencia entre `check` y `status` manda sobre todo el diseño de este
// archivo: `status` admite diez llamadas POR MINUTO, asi que el bucle sondea
// `check` y solo pide `status` UNA vez, cuando `check` dice que ha terminado.
// Sondear `status` seria un 429 asegurado a los pocos segundos.
//
// El horde es una red de voluntarios: una peticion puede ser imposible hoy
// (`is_possible: false`) porque ningun worker conectado tiene ese modelo, y eso
// no mejora esperando. Se aborta pronto y se dice.
//
// Aqui NO se cifra nada ni se escribe en disco: este modulo pide, espera y
// devuelve bytes. Quien los recibe decide que hacer con ellos.
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { computeBackoffDelay, defaultSleep, redact } from '@luxy/shared';
import type { HordeImageRequest, HordeLora } from '@luxy/shared';

export class HordeError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly hint: string | null = null,
    /**
     * `rc` de la API cuando lo trae.
     *
     * Es lo unico estable de un error suyo: el texto de `message` cambia entre
     * versiones del horde, el codigo de retorno no.
     */
    readonly rc: string | null = null,
  ) {
    super(message);
    this.name = 'HordeError';
  }
}

export interface HordeOptions {
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
  /** inyectable para probar sin red */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** tope de una peticion suelta */
  timeoutMs?: number;
  /** identificacion del cliente ante el horde; ver DEFAULT_CLIENT_AGENT */
  clientAgent?: string;
}

/** endpoints publicos del horde. `stablehorde.net` es un alias del mismo servicio */
export const HORDE_BASE_URL = 'https://aihorde.net/api';

/**
 * clave anonima del horde: diez ceros.
 *
 * Funciona sin registrarse, pero con ella el servidor FUERZA `shared: true`, es
 * decir, dona la imagen al conjunto de datos de LAION. Ademas da prioridad casi
 * nula en la cola.
 */
export const ANONYMOUS_API_KEY = '0000000000';

/**
 * el servidor asume «unknown:0:unknown» cuando falta, y su documentacion pide
 * identificarse para poder avisar a un cliente que hace algo mal.
 */
const DEFAULT_CLIENT_AGENT = 'Luxy:1.0:luxy';

const DEFAULT_TIMEOUT_MS = 120_000;

/** el servidor cachea `check` un segundo: sondear mas rapido no aporta nada */
const MIN_POLL_INTERVAL_MS = 1200;
const MAX_POLL_INTERVAL_MS = 8000;

/** el propio horde descarta una peticion async a los 10 minutos */
const DEFAULT_MAX_WAIT_MS = 10 * 60_000;
/**
 * cuanto mas se puede esperar por encima del plazo base, si la cola avanza.
 *
 * Diez minutos mas, o sea veinte en total como techo absoluto. Sale de la
 * espera real de una cuenta con pocos kudos: se han visto colas de 25 minutos
 * estimados que acababan sirviendose.
 */
const DEFAULT_GRACE_MS = 10 * 60_000;
/**
 * plazo que se renueva con cada señal de que la peticion avanza.
 *
 * Dos minutos: mas que de sobra entre dos vueltas del sondeo, que como mucho
 * son 8 segundos, y poco suficiente para que una peticion que se queda parada
 * se rinda enseguida en vez de arrastrar la espera.
 */
const PROGRESS_GRACE_MS = 2 * 60_000;
/**
 * margen POR ENCIMA del techo absoluto mientras un worker la esta dibujando.
 *
 * PASO DE VERDAD (2026-09-15): una imagen de Daniel murio a las 14:52:46 con un
 * worker dibujandola y 38 segundos declarados; el techo de veinte minutos vencia
 * a las 14:52:46 exactas. Llego un segundo tarde. El `Math.min` con el techo
 * hacia que ningun avance pudiera pasar de ahi, asi que cortaba igual en mitad
 * del dibujado que si nadie hubiera tocado la peticion en veinte minutos.
 *
 * «Un worker DIBUJANDOLA» no es lo mismo que «la cola avanza»: lo primero dice
 * que la imagen esta a segundos. Con las colas de mas de cien puestos que tiene
 * el horde, llegar al techo justo cuando te toca no es mala suerte, es lo
 * normal. Tres minutos: un worker que ya ha empezado tarda bastante menos, y
 * puesto asi la espera no se puede alargar sola —el margen se mide desde el
 * techo, no desde cada vuelta del sondeo—.
 */
const DRAWING_OVERTIME_MS = 3 * 60_000;

/** tope del horde: mas de cinco LoRAs se rechaza, y cada uno cuesta +3 kudos */
export const MAX_LORAS = 5;

const DIMENSION_STEP = 64;
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 3072;

/**
 * tope propio para la imagen de partida, medido YA DECODIFICADA.
 *
 * El horde no publica un limite exacto, pero el cuerpo entero viaja como JSON:
 * pasado este tamaño la peticion tarda mas en subir que en generarse y algun
 * proxy la corta por el camino con un error que no explica nada.
 */
const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;

/** rango de `denoising_strength` en el swagger: 0.01 minimo, 1.0 maximo */
const MIN_DENOISING_STRENGTH = 0.01;
const MAX_DENOISING_STRENGTH = 1;

/**
 * con la clave anonima el horde ignora `shared: false` y comparte la imagen.
 *
 * Se expone para que la interfaz pueda avisarlo ANTES de generar: es la unica
 * diferencia de la clave anonima que tiene consecuencias sobre el contenido.
 */
export function isAnonymousKey(apiKey: string): boolean {
  return apiKey.trim() === ANONYMOUS_API_KEY;
}

// -----------------------------------------------------------------------------
// contratos de respuesta
//
// todo lo que llega de fuera se valida: una respuesta con otra forma debe
// fallar aqui y no tres capas mas abajo, cuando ya nadie sepa de donde venia.
// -----------------------------------------------------------------------------

/**
 * los contadores se aceptan ausentes y se leen como 0.
 *
 * El horde omite alguno segun el estado, y quedarse sin resultado por un
 * contador informativo seria tirar una imagen ya pagada. Las banderas, en
 * cambio, deciden el flujo entero y se exigen.
 */
const progressSchema = z.object({
  done: z.boolean(),
  faulted: z.boolean(),
  is_possible: z.boolean(),
  waiting: z.number().nullish(),
  processing: z.number().nullish(),
  finished: z.number().nullish(),
  restarted: z.number().nullish(),
  wait_time: z.number().nullish(),
  queue_position: z.number().nullish(),
  kudos: z.number().nullish(),
});

const genMetadataSchema = z.object({
  type: z.string().max(64),
  value: z.string().max(256),
  ref: z.string().max(256).nullish(),
});

const generationSchema = z.object({
  /** URL prefirmada de R2 con `r2: true`, o el .webp en base64 con `r2: false` */
  img: z.string().min(1).max(20_000_000),
  seed: z.string().max(64).nullish(),
  id: z.string().max(128).nullish(),
  model: z.string().max(256).nullish(),
  worker_id: z.string().max(128).nullish(),
  worker_name: z.string().max(256).nullish(),
  censored: z.boolean().nullish(),
  state: z.string().max(64).nullish(),
  gen_metadata: z.array(genMetadataSchema).nullish(),
});

const statusSchema = progressSchema.extend({
  shared: z.boolean().nullish(),
  generations: z.array(generationSchema).nullish(),
});

const submissionSchema = z.object({
  /**
   * identificador del trabajo encolado.
   *
   * Opcional porque una peticion con `dry_run` NO encola nada y por tanto no
   * tiene identificador que devolver: solo responde el precio. Exigirlo aqui
   * hacia que preguntar el coste fallara con «formato inesperado».
   */
  id: z.string().min(1).max(128).nullish(),
  kudos: z.number().nullish(),
  message: z.string().max(2000).nullish(),
  warnings: z
    .array(z.object({ code: z.string().max(64), message: z.string().max(2000) }))
    .nullish(),
});

const userSchema = z.object({
  username: z.string().max(256),
  id: z.number(),
  kudos: z.number(),
  concurrency: z.number().nullish(),
});

const modelSchema = z.object({
  /** string EXACTO que hay que mandar en `models`; cualquier variacion no casa */
  name: z.string().min(1).max(256),
  /** workers que ahora mismo lo tienen cargado. 0 = existe pero hoy no lo sirve nadie */
  count: z.number().nullish(),
  eta: z.number().nullish(),
  jobs: z.number().nullish(),
});

export interface HordeProgress {
  done: boolean;
  faulted: boolean;
  isPossible: boolean;
  waiting: number;
  processing: number;
  finished: number;
  waitTimeSeconds: number;
  queuePosition: number;
  /**
   * `null` cuando el estado no trajo precio, que NO es lo mismo que cero.
   *
   * Es el mismo criterio que `HordeSubmission.kudos`, y aqui importa mas: este
   * es el numero que acaba en `costCredits` y en el campo `kudos` del intento
   * cifrado, o sea el que se lee en el hilo. Un 0 inventado no se distingue de
   * un precio real, y el resto de contadores pueden caer a 0 sin mentir
   * —`waiting: 0` es una cola vacia— pero un coste de cero no existe.
   */
  kudos: number | null;
}

export interface HordeGeneration {
  img: string;
  seed: string;
  id: string;
  model: string;
  workerName: string | null;
  censored: boolean;
  metadata: { type: string; value: string; ref: string | null }[];
}

export interface HordeResult extends HordeProgress {
  generations: HordeGeneration[];
}

export interface HordeSubmission {
  id: string;
  /**
   * `null` cuando el servidor no dijo el precio, que NO es lo mismo que cero.
   *
   * Ninguna generacion cuesta cero kudos, asi que devolver 0 en vez del silencio
   * seria enseñar un precio inventado justo en la pantalla que existe para
   * saber lo que va a costar antes de pulsar.
   */
  kudos: number | null;
  warnings: { code: string; message: string }[];
}

/** lo que contesta una peticion en seco: el precio y lo que el servidor objeta */
export interface HordeEstimate {
  kudos: number | null;
  warnings: { code: string; message: string }[];
}

export interface HordeUser {
  username: string;
  id: number;
  kudos: number;
  concurrency: number;
}

export interface HordeModel {
  name: string;
  count: number;
  eta: number;
  jobs: number;
}

function toProgress(raw: z.infer<typeof progressSchema>): HordeProgress {
  return {
    done: raw.done,
    faulted: raw.faulted,
    isPossible: raw.is_possible,
    waiting: raw.waiting ?? 0,
    processing: raw.processing ?? 0,
    finished: raw.finished ?? 0,
    waitTimeSeconds: raw.wait_time ?? 0,
    queuePosition: raw.queue_position ?? 0,
    // el silencio se conserva como silencio: ver `HordeProgress.kudos`
    kudos: raw.kudos ?? null,
  };
}

function toResult(raw: z.infer<typeof statusSchema>): HordeResult {
  return {
    ...toProgress(raw),
    generations: (raw.generations ?? []).map((generation) => ({
      img: generation.img,
      seed: generation.seed ?? '',
      id: generation.id ?? '',
      model: generation.model ?? '',
      workerName: generation.worker_name ?? null,
      censored: generation.censored ?? false,
      metadata: (generation.gen_metadata ?? []).map((entry) => ({
        type: entry.type,
        value: entry.value,
        ref: entry.ref ?? null,
      })),
    })),
  };
}

// -----------------------------------------------------------------------------
// transporte
// -----------------------------------------------------------------------------

/** `listImageModels` es publico, asi que la clave no siempre esta */
type HordeCallOptions = Omit<HordeOptions, 'apiKey'> & { apiKey?: string };

/**
 * cuerpo de error del horde, tal y como lo declara su swagger.
 *
 * `rc` es un codigo de retorno corto (`InvalidAPIKey`, `KudosUpfront`, ...) y es
 * lo unico por lo que se debe decidir; `message` es texto para humanos y cambia.
 */
const errorBodySchema = z.object({
  message: z.string().max(2000).optional(),
  rc: z.string().max(64).optional(),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * tapa la clave en cualquier texto antes de que llegue a un error o a un log.
 *
 * `redact()` solo cubre los secretos registrados, y esta llega por parametro sin
 * pasar por el registro. Con la clave anonima da igual; con la del usuario, no.
 */
function stripKey(text: string, apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.length === 0) return text;
  return text.split(apiKey).join('[clave]');
}

const KUDOS_HINT =
  'baja la resolucion o los pasos, o registrate en AI Horde para tener kudos propios';

function hintForStatus(status: number): string | null {
  if (status === 401 || status === 403) return 'comprueba la clave en Conexiones';
  if (status === 404) return 'la peticion pudo caducar: el horde la descarta a los 10 minutos';
  if (status === 429) return 'demasiadas peticiones seguidas; espera un momento';
  if (status === 503) return 'AI Horde esta en mantenimiento; reintenta en unos minutos';
  return null;
}

/**
 * traduce un error del horde a algo que se pueda hacer.
 *
 * Se mapea por `rc`, que es lo estable. Sin codigo conocido se conserva el texto
 * original: un mensaje raro suyo explica mas que un «error» generico.
 */
function describeError(
  status: number,
  rc: string | null,
  apiMessage: string | null,
): { message: string; hint: string | null } {
  switch (rc) {
    case 'MissingPrompt':
      return {
        message: 'la peticion llego sin prompt',
        hint: 'escribe algo que generar antes de pedir la imagen',
      };
    case 'InvalidAPIKey':
      return {
        message: 'la clave de AI Horde no vale',
        hint: `comprueba la clave en Conexiones; con ${ANONYMOUS_API_KEY} se entra como anonimo, pero entonces el horde comparte la imagen`,
      };
    case 'TooManyPrompts':
      return {
        message: 'ya hay demasiadas peticiones tuyas a la vez en AI Horde',
        hint: 'espera a que terminen las que tienes en curso; el limite sube con los kudos de la cuenta',
      };
    case 'MaintenanceMode':
      return {
        message: 'AI Horde esta en mantenimiento y no acepta peticiones nuevas',
        hint: 'no es un fallo tuyo; reintenta en unos minutos',
      };
    case 'RequestNotFound':
      return {
        message: 'esa peticion ya no existe en AI Horde',
        hint: 'un trabajo caduca a los 10 minutos; vuelve a pedir la imagen desde el principio',
      };
    case 'KudosUpfront':
      return { message: 'no hay kudos suficientes para esa peticion', hint: KUDOS_HINT };
    default:
      // sin codigo conocido, un mensaje que hable de kudos sigue siendo
      // accionable: casi siempre se arregla pidiendo menos
      if (apiMessage !== null && /kudos/i.test(apiMessage)) {
        return { message: `AI Horde rechazo la peticion: ${apiMessage}`, hint: KUDOS_HINT };
      }
      return {
        message: `AI Horde respondio ${status}${apiMessage === null ? '' : `: ${apiMessage}`}`,
        hint: hintForStatus(status),
      };
  }
}

async function call(options: HordeCallOptions, path: string, init: RequestInit): Promise<unknown> {
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
        // el horde NO usa `Authorization: Bearer`. La clave va en su propia
        // cabecera `apikey`, en minusculas y con el valor plano
        apikey: options.apiKey ?? ANONYMOUS_API_KEY,
        'Client-Agent': options.clientAgent ?? DEFAULT_CLIENT_AGENT,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const parsed = errorBodySchema.safeParse(parseJson(text));
      const rc = parsed.success ? (parsed.data.rc ?? null) : null;
      const apiMessage = parsed.success ? (parsed.data.message ?? null) : text.slice(0, 300);
      const described = describeError(response.status, rc, apiMessage);

      throw new HordeError(
        // dos capas: la clave propia de esta llamada y el resto de secretos que
        // el proceso tenga registrados
        redact(stripKey(described.message, options.apiKey)),
        response.status,
        described.hint,
        rc,
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof HordeError) throw error;
    if (controller.signal.aborted && !options.signal.aborted) {
      throw new HordeError('AI Horde no respondio a tiempo');
    }
    throw new HordeError(
      redact(stripKey(error instanceof Error ? error.message : String(error), options.apiKey)),
    );
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
  }
}

// -----------------------------------------------------------------------------
// operaciones
// -----------------------------------------------------------------------------

/**
 * el horde solo acepta multiplos de 64 entre 64 y 3072.
 *
 * Se comprueba ANTES de salir a la red: una peticion mal dimensionada no genera
 * nada, y fallar aqui evita ocupar un hueco de la cola para nada.
 */
function assertDimension(value: number, label: string): void {
  if (
    !Number.isInteger(value) ||
    value < MIN_DIMENSION ||
    value > MAX_DIMENSION ||
    value % DIMENSION_STEP !== 0
  ) {
    throw new HordeError(
      `${label} no vale para AI Horde: ${value}`,
      null,
      `tiene que ser un multiplo de ${DIMENSION_STEP} entre ${MIN_DIMENSION} y ${MAX_DIMENSION}`,
    );
  }
}

/**
 * tamaño decodificado de un base64 SIN decodificarlo.
 *
 * Decodificar solo para medir duplicaria en memoria una imagen que a lo mejor
 * se va a rechazar: cada cuatro caracteres son tres bytes, menos el relleno.
 */
function decodedBase64Bytes(base64: string): number {
  // un base64 pegado de otro sitio puede traer saltos de linea; no son datos
  const compact = base64.replace(/\s+/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

/**
 * comprueba la imagen de partida ANTES de salir a la red.
 *
 * Los tres fallos que cubre se manifiestan tarde y mal: el servidor hace
 * `b64decode` directo sobre lo que le llegue, asi que un prefijo `data:` no
 * revienta al validar sino mucho despues, dentro del worker, y vuelve como un
 * error opaco con los kudos ya comprometidos.
 */
function assertSourceImage(sourceImage: string, denoisingStrength: number): void {
  if (/^data:/i.test(sourceImage)) {
    throw new HordeError(
      'la imagen de partida lleva el prefijo `data:` y AI Horde espera base64 a secas',
      null,
      'manda solo lo que hay detras de la coma, sin `data:image/...;base64,`',
    );
  }

  const bytes = decodedBase64Bytes(sourceImage);
  if (bytes > MAX_SOURCE_IMAGE_BYTES) {
    const megas = (bytes / (1024 * 1024)).toFixed(1);
    throw new HordeError(
      `la imagen de partida ocupa ${megas} MB y es demasiado grande para AI Horde`,
      null,
      `usa una mas pequeña: el limite son ${MAX_SOURCE_IMAGE_BYTES / (1024 * 1024)} MB ya decodificados`,
    );
  }

  if (
    !Number.isFinite(denoisingStrength) ||
    denoisingStrength < MIN_DENOISING_STRENGTH ||
    denoisingStrength > MAX_DENOISING_STRENGTH
  ) {
    throw new HordeError(
      `el parecido con la imagen de partida no vale para AI Horde: ${denoisingStrength}`,
      null,
      `tiene que estar entre ${MIN_DENOISING_STRENGTH} y ${MAX_DENOISING_STRENGTH}`,
    );
  }
}

function toLoraPayload(lora: HordeLora): Record<string, unknown> {
  return {
    // con `is_version: true` el horde exige que `name` sea el id NUMERICO de la
    // version en CivitAI, no el nombre del LoRA
    name: lora.name,
    is_version: lora.isVersion,
    model: lora.model,
    clip: lora.clip,
    ...(lora.injectTrigger === undefined ? {} : { inject_trigger: lora.injectTrigger }),
  };
}

function buildBody(request: HordeImageRequest): Record<string, unknown> {
  assertDimension(request.width, 'la anchura');
  assertDimension(request.height, 'la altura');
  // mandar imagen de partida multiplica el coste en kudos x1,3, asi que una
  // peticion que iba a entrar con lo justo puede rechazarse solo por llevarla
  if (request.sourceImage !== null) {
    assertSourceImage(request.sourceImage, request.denoisingStrength);
  }
  if (request.loras.length > MAX_LORAS) {
    throw new HordeError(
      `AI Horde admite ${MAX_LORAS} LoRAs como maximo y se pidieron ${request.loras.length}`,
      null,
      `quita ${request.loras.length - MAX_LORAS}; ademas cada LoRA cuesta 3 kudos de mas`,
    );
  }

  return {
    // el prompt negativo NO es un campo de la API: viaja dentro de `prompt`
    // detras de ' ### '. Aqui llega ya unido; este modulo no lo compone
    prompt: request.prompt,
    params: {
      steps: request.steps,
      n: 1,
      ...(request.seed === null ? {} : { seed: request.seed }),
      sampler_name: request.samplerName,
      cfg_scale: request.cfgScale,
      height: request.height,
      width: request.width,
      scheduler: request.scheduler,
      hires_fix: request.hiresFix,
      clip_skip: request.clipSkip,
      ...(request.postProcessing.length === 0 ? {} : { post_processing: request.postProcessing }),
      ...(request.loras.length === 0 ? {} : { loras: request.loras.map(toLoraPayload) }),
      // `denoising_strength` es lo unico de img2img que va DENTRO de `params`,
      // porque es un parametro del muestreo y no del trabajo. Sin imagen no
      // significa nada, y dejarlo puesto confunde al releer un registro
      ...(request.sourceImage === null
        ? {}
        : { denoising_strength: request.denoisingStrength }),
    },
    nsfw: request.nsfw,
    // se manda SIEMPRE explicito aunque parezca redundante: su swagger dice que
    // el valor por defecto es false, pero el parser del servidor lo declara
    // True. Omitirlo puede devolver la imagen censurada en negro
    censor_nsfw: false,
    models: request.models,
    // devuelve una URL prefirmada en vez de base64; evita respuestas JSON de
    // varios megas por imagen
    r2: true,
    shared: request.shared,
    trusted_workers: false,
    // se queda en true (su valor por defecto). Ponerlo en false multiplica el
    // coste x1.2 Y exige kudos por adelantado siempre, asi que con pocos kudos
    // rechaza hasta un 512x512
    slow_workers: true,
    // gratis: amplia el pool de workers y no aparece en la formula de kudos
    extra_slow_workers: true,
    replacement_filter: true,
    // degrada pasos y resolucion en vez de fallar cuando faltan kudos
    allow_downgrade: true,
    // `source_image` y `source_processing` van en la RAIZ, hermanos de `models`
    // y `r2`, NO dentro de `params`: son propiedades del trabajo, no del
    // muestreo. Metidos en `params` el servidor los ignora en silencio y
    // devuelve una imagen generada de cero, sin ningun error que lo explique
    ...(request.sourceImage === null
      ? {}
      : {
          // base64 PURO, sin prefijo `data:`: la API lo documenta como webp
          source_image: request.sourceImage,
          source_processing: request.sourceProcessing,
        }),
    ...(request.dryRun === undefined ? {} : { dry_run: request.dryRun }),
  };
}

/** encola una imagen y devuelve su identificador y lo que va a costar */
export async function submitImage(
  request: HordeImageRequest,
  options: HordeOptions,
): Promise<HordeSubmission> {
  const body = await call(options, '/v2/generate/async', {
    method: 'POST',
    body: JSON.stringify(buildBody(request)),
  });

  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) throw new HordeError('la respuesta de AI Horde no tiene el formato esperado');

  const warnings = (parsed.data.warnings ?? []).map((warning) => ({
    code: warning.code,
    message: warning.message,
  }));

  // con la clave anonima el horde ignora `shared: false` y dona la imagen a
  // LAION. Callarlo seria mentir sobre donde acaba el contenido
  if (!request.shared && isAnonymousKey(options.apiKey)) {
    warnings.push({
      code: 'AnonymousKeySharesImage',
      message:
        'con la clave anonima AI Horde comparte la imagen con LAION aunque se pida lo contrario',
    });
  }

  // sin `dry_run` el identificador SI es obligatorio: sin el no hay nada que
  // sondear y la peticion se quedaria generando sin que nadie la recoja
  if (request.dryRun !== true && (parsed.data.id === undefined || parsed.data.id === null)) {
    throw new HordeError('AI Horde acepto la peticion sin devolver su identificador');
  }

  return { id: parsed.data.id ?? '', kudos: parsed.data.kudos ?? null, warnings };
}

/**
 * sondeo barato. Es EL endpoint del bucle.
 *
 * Admite 10 por segundo y por IP, y el servidor cachea la respuesta un segundo.
 */
export async function checkImage(id: string, options: HordeOptions): Promise<HordeProgress> {
  const body = await call(options, `/v2/generate/check/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
  const parsed = progressSchema.safeParse(body);
  if (!parsed.success) throw new HordeError('el estado de AI Horde no tiene el formato esperado');
  return toProgress(parsed.data);
}

/**
 * el filtro anti-CSAM de la red no es un fallo tecnico y no se reintenta.
 *
 * El horde lo marca en `gen_metadata` y devuelve la peticion como terminada, asi
 * que sin esta comprobacion pasaria por una generacion normal.
 */
function assertNotCensored(result: HordeResult): void {
  for (const generation of result.generations) {
    const censorship = generation.metadata.find(
      (entry) => entry.type === 'censorship' && entry.value === 'csam',
    );
    if (censorship !== undefined) {
      throw new HordeError(
        'el filtro anti-CSAM de AI Horde bloqueo esta imagen',
        null,
        'no es un fallo tecnico y no se reintenta: cambia el prompt',
        'csam',
      );
    }
    // el filtro PROPIO de un worker no deja metadato: solo marca `censored` y
    // devuelve una imagen negra. Sin esto se cifraba y se guardaba como la foto
    // del personaje, con los kudos ya gastados y sin ninguna explicacion, que es
    // exactamente lo que `nsfw: true` intenta evitar y no siempre consigue
    if (generation.censored) {
      throw new HordeError(
        'el worker que atendio la peticion censuro la imagen',
        null,
        'ese worker aplica su propio filtro aunque se le pida lo contrario; vuelve a intentarlo para que la coja otro, o marca otros modelos',
        'censored',
      );
    }
  }
}

/**
 * resultado completo. LIMITE DE 10 POR MINUTO: se llama UNA sola vez, cuando
 * `check` dice que ha terminado. Nunca en bucle.
 */
export async function readImageStatus(id: string, options: HordeOptions): Promise<HordeResult> {
  const body = await call(options, `/v2/generate/status/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) throw new HordeError('el resultado de AI Horde no tiene el formato esperado');

  const result = toResult(parsed.data);
  assertNotCensored(result);
  return result;
}

/**
 * cancela la peticion y devuelve lo que ya se hubiera generado.
 *
 * Es la UNICA forma de cancelar en el horde: sin esto la peticion sigue viva
 * hasta caducar y sigue ocupando a los workers.
 */
export async function cancelImage(id: string, options: HordeOptions): Promise<HordeResult> {
  const body = await call(options, `/v2/generate/status/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    throw new HordeError('la cancelacion de AI Horde no tiene el formato esperado');
  }
  // aqui NO se aplica el filtro de censura: cancelar devuelve lo que hubiera y
  // quien cancela ya no espera una imagen
  return toResult(parsed.data);
}

export interface AwaitImageOptions {
  /** plazo BASE. Se estira mientras la cola avance, hasta `graceMs` mas */
  maxWaitMs?: number;
  /**
   * cuanto se puede estirar el plazo por encima del base, como maximo.
   *
   * Existe para que una cola que avanza muy despacio no deje la espera abierta
   * para siempre: por muchas señales de vida que haya, el techo no se pasa.
   */
  graceMs?: number;
  onProgress?: (progress: HordeProgress) => void;
  /**
   * el reloj, por parametro.
   *
   * No es un lujo de diseño: las pruebas del plazo que se estira necesitan que
   * el tiempo CORRA —con un `sleep` instantaneo el plazo base nunca vence
   * dentro del bucle y no hay nada que estirar— y la primera version dormia de
   * verdad 40 ms contra un plazo de 60. Paso lo que tenia que pasar: con la
   * suite entera en paralelo una siesta se fue de 60 ms y la prueba fallo sola,
   * sin que nada estuviera roto. Una prueba que falla por la carga de la
   * maquina es peor que no tenerla, porque enseña a ignorar los fallos.
   *
   * Con el reloj falso la prueba es instantanea y da igual como ande el equipo.
   */
  now?: () => number;
}

/**
 * espera a que la imagen este lista.
 *
 * Sondea `check` con un intervalo minimo de 1200 ms —el servidor cachea un
 * segundo, sondear mas rapido solo gasta cuota— que sube hasta 8 s, y pide
 * `status` una sola vez al terminar.
 */
export async function awaitImage(
  id: string,
  options: HordeOptions & AwaitImageOptions,
): Promise<HordeResult> {
  try {
    return await pollImage(id, options);
  } catch (error) {
    // abandonar sin decirlo deja la peticion viva hasta que caduca, diez
    // minutos ocupando un hueco de concurrencia y, si un worker la coge, unos
    // kudos por una imagen que ya nadie va a descargar.
    //
    // No se cancela lo que ya termino: una imagen censurada llega con la
    // peticion cumplida, y el DELETE solo gastaria cuota del limite de diez por
    // minuto que comparte con `status`.
    const finished = error instanceof HordeError && (error.rc === 'csam' || error.rc === 'censored');
    if (!finished) {
      // señal propia: si el usuario cancelo, la suya ya esta abortada y el
      // DELETE no llegaria a salir, que es justo cuando mas falta hace
      const cancelSignal = new AbortController().signal;
      // es mejor esfuerzo: si la cancelacion tambien falla, manda el error
      // original, que es el que explica lo que paso
      const rescatado = await cancelImage(id, { ...options, signal: cancelSignal }).catch(
        () => null,
      );

      // LA CANCELACION DEVUELVE LO QUE HUBIERA, y hasta ahora se tiraba.
      //
      // El sondeo espacia sus vueltas hasta 8 s, asi que entre la ultima y el
      // vencimiento hay una ventana real en la que un worker puede terminar. Si
      // eso pasa, la imagen viene DENTRO de la respuesta del DELETE: estaba
      // hecha, pagada con kudos, y se descartaba para lanzar «no estuvo lista a
      // tiempo». Daniel vio una de esas terminada en la web del horde mientras
      // Luxy le decia que no habia llegado.
      //
      // Se comprueba la censura igual que en el camino normal: una imagen
      // censurada es un rectangulo negro, y entregarla como si fuera la foto es
      // peor que decir que no llego.
      if (rescatado !== null && rescatado.generations.length > 0) {
        assertNotCensored(rescatado);
        return rescatado;
      }
    }
    throw error;
  }
}

async function pollImage(
  id: string,
  options: HordeOptions & AwaitImageOptions,
): Promise<HordeResult> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  // EL PLAZO SE ESTIRA MIENTRAS LA COLA AVANCE, y esto no es generosidad.
  //
  // Paso de verdad: al vencer los diez minutos la peticion estaba en el PUESTO
  // 18 con 56 segundos estimados, y se tiro. El horde no la habia descartado
  // —seguia viva y subiendo puestos—; el que perdia la imagen era este plazo.
  //
  // Se estira solo con evidencia de que llega: un worker ya la esta dibujando,
  // o la cola se ha movido hacia delante desde la vuelta anterior. Una peticion
  // parada no estira nada y se rinde a su hora, que es lo que evita esperar
  // diez minutos a algo que no va a salir.
  const hardDeadline =
    now() + (options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS) + (options.graceMs ?? DEFAULT_GRACE_MS);
  // el techo se estira SOLO mientras alguien la dibuja, y no un segundo mas:
  // sigue siendo un techo, no una espera abierta
  const drawingDeadline = hardDeadline + DRAWING_OVERTIME_MS;
  let deadline = now() + (options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
  let lastPosition: number | null = null;
  let attempt = 0;

  while (now() < deadline) {
    if (options.signal.aborted) throw new HordeError('generacion cancelada');

    const delay = Math.max(
      MIN_POLL_INTERVAL_MS,
      computeBackoffDelay(attempt, {
        baseDelayMs: MIN_POLL_INTERVAL_MS,
        maxDelayMs: MAX_POLL_INTERVAL_MS,
      }),
    );
    await sleep(delay, options.signal);
    attempt += 1;

    const progress = await checkImage(id, options);
    options.onProgress?.(progress);

    // ¿hay señales de que esto llega? Un worker dibujandola cuenta, y subir
    // puestos tambien. Con cualquiera de las dos se renueva el plazo, siempre
    // por debajo del techo absoluto
    const dibujandola = progress.processing > 0;
    const avanza =
      dibujandola ||
      (lastPosition !== null && progress.queuePosition > 0 && progress.queuePosition < lastPosition);
    lastPosition = progress.queuePosition;
    if (avanza) {
      // el techo que aplica depende de si la estan DIBUJANDO: subir puestos en
      // la cola no promete nada, pero un worker con la peticion en las manos si
      deadline = Math.min(dibujandola ? drawingDeadline : hardDeadline, now() + PROGRESS_GRACE_MS);
    }

    if (progress.faulted) {
      throw new HordeError(
        'AI Horde no pudo generar la imagen',
        null,
        'el fallo es de la red de workers, no de la peticion; vuelve a intentarlo',
      );
    }
    // esperar diez minutos a algo que hoy no puede salir no sirve de nada
    if (!progress.isPossible) {
      throw new HordeError(
        'ahora mismo ningun worker conectado a AI Horde puede generar eso',
        null,
        'prueba con otro modelo, menos pasos o una resolucion mas baja',
      );
    }
    if (progress.done) return await readImageStatus(id, options);
  }

  throw new HordeError(
    'la imagen no estuvo lista a tiempo',
    null,
    'AI Horde descarta la peticion a los 10 minutos; vuelve a pedirla',
  );
}

/**
 * pregunta el coste en kudos sin generar nada.
 *
 * `dry_run` recorre el mismo camino de validacion y devuelve el precio, pero no
 * encola trabajo para ningun worker.
 *
 * Devuelve TAMBIEN los avisos, que es la mitad util de una peticion en seco: el
 * precio dice lo que cuesta y los avisos dicen por que va a tardar —«ningun
 * worker sirve ese modelo»— o donde acaba la imagen. Quedarse solo con el numero
 * tiraba lo segundo, que es lo unico que el dry run puede adelantar de verdad.
 */
export async function estimateKudos(
  request: HordeImageRequest,
  options: HordeOptions,
): Promise<HordeEstimate> {
  const submission = await submitImage({ ...request, dryRun: true }, options);
  return { kudos: submission.kudos, warnings: submission.warnings };
}

/**
 * convierte el campo `img` en bytes.
 *
 * Admite las dos formas del horde: con `r2: true` es una URL prefirmada de
 * Cloudflare R2 que CADUCA A LOS 1800 s, y con `r2: false` es el .webp en base64
 * sin prefijo `data:`. Se distinguen por el prefijo, como hace su propio cliente.
 */
export async function downloadImage(
  imgField: string,
  options: HordeOptions,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!/^https?:/i.test(imgField)) {
    // el horde solo produce webp, asi que el tipo no hay que adivinarlo
    const bytes = new Uint8Array(Buffer.from(imgField, 'base64'));
    if (bytes.length === 0) throw new HordeError('AI Horde devolvio una imagen vacia');
    return { bytes, mimeType: 'image/webp' };
  }

  let url: URL;
  try {
    url = new URL(imgField);
  } catch {
    throw new HordeError('la URL de la imagen no es valida');
  }
  // seria contenido privado viajando en claro por la red
  if (url.protocol !== 'https:') {
    throw new HordeError('la imagen no se descarga por una conexion insegura');
  }

  const doFetch = options.fetchImpl ?? fetch;
  // sin la cabecera `apikey`: R2 no la necesita y mandarla la expondria a un
  // tercero que ya no es el horde
  const response = await doFetch(url.toString(), {
    signal: options.signal,
    headers: { 'Client-Agent': options.clientAgent ?? DEFAULT_CLIENT_AGENT },
  });
  if (!response.ok) {
    throw new HordeError(
      `no se pudo descargar la imagen (${response.status})`,
      response.status,
      // la URL prefirmada caduca a los 1800 s: es el fallo tipico si se tarda
      'el enlace de AI Horde caduca a la media hora; vuelve a pedir el resultado',
    );
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get('Content-Type') ?? 'image/webp',
  };
}

/** lee la cuenta detras de la clave; sirve para enseñar el saldo de kudos */
export async function findUser(options: HordeOptions): Promise<HordeUser> {
  const body = await call(options, '/v2/find_user', { method: 'GET' });
  const parsed = userSchema.safeParse(body);
  if (!parsed.success) throw new HordeError('la cuenta de AI Horde no tiene el formato esperado');
  return {
    username: parsed.data.username,
    id: parsed.data.id,
    kudos: parsed.data.kudos,
    concurrency: parsed.data.concurrency ?? 0,
  };
}

/**
 * catalogo real de modelos de imagen.
 *
 * Es publico: no exige clave. `name` es el string exacto que hay que mandar en
 * `models`, y `count` son los workers que lo tienen cargado ahora mismo.
 */
export async function listImageModels(
  options: Omit<HordeOptions, 'apiKey'> & { apiKey?: string },
): Promise<HordeModel[]> {
  const body = await call(options, '/v2/status/models?type=image', { method: 'GET' });
  const parsed = z.array(modelSchema).safeParse(body);
  if (!parsed.success) {
    throw new HordeError('el catalogo de AI Horde no tiene el formato esperado');
  }
  return parsed.data.map((model) => ({
    name: model.name,
    count: model.count ?? 0,
    eta: model.eta ?? 0,
    jobs: model.jobs ?? 0,
  }));
}
