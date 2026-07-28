// adaptadores de audio, imagen y enrutado.
//
// PROCEDENCIA DE LOS CONTRATOS. No se ha inventado ninguno: se descubrieron
// llamando a la conexion real el 2026-07-28. Lo que respondio cada uno:
//
//   TTS         POST /audio/speech        -> audio/mpeg (30 KB)      VERIFICADO
//   Imagen      POST /images/edits        -> {data:[{url}]}          VERIFICADO
//   Router      POST /chat/completions    -> chat.completion         VERIFICADO
//   Chat audio  POST /chat/completions    -> chat.completion         VERIFICADO
//   ASR         POST /audio/transcriptions -> 404 upstream           NO VERIFICADO
//
// El de ASR se implementa con la forma estandar de OpenAI porque el endpoint
// existe (no devuelve "Invalid URL" como una ruta inexistente), pero la llamada
// al proveedor de arriba falla. Queda marcado como pendiente y la interfaz lo
// muestra asi: NO se presenta como terminado.
import { z } from 'zod';
import { redact } from '@luxy/shared';

export interface MediaAdapterOptions {
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
  timeoutMs?: number;
}

export class MediaAdapterError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'MediaAdapterError';
  }
}

/** estado de verificacion de cada adaptador, para poder mostrarlo sin mentir */
export const ADAPTER_VERIFICATION = {
  speech: { verified: true, checkedAt: '2026-07-28' },
  imageEdit: { verified: true, checkedAt: '2026-07-28' },
  router: { verified: true, checkedAt: '2026-07-28' },
  audioChat: { verified: true, checkedAt: '2026-07-28' },
  transcription: {
    verified: false,
    checkedAt: '2026-07-28',
    note: 'el endpoint existe pero el proveedor de arriba devolvio 404',
  },
} as const;

async function call(
  options: MediaAdapterOptions,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000);
  const onAbort = (): void => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${options.apiKey}`, ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new MediaAdapterError(
        redact(`la API respondio ${response.status}: ${body.slice(0, 300)}`),
        response.status,
      );
    }
    return response;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
  }
}

// -----------------------------------------------------------------------------
// TTS — VERIFICADO
// -----------------------------------------------------------------------------

/**
 * voz por defecto.
 *
 * "alloy" (la de OpenAI) NO existe en este proveedor: devuelve voice_id_invalid.
 * Esta si respondio con audio.
 */
export const DEFAULT_VOICE = 'cixingnansheng';

export interface SpeechRequest {
  model: string;
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'opus';
}

export interface SpeechResult {
  audio: Buffer;
  contentType: string;
}

export async function synthesizeSpeech(
  request: SpeechRequest,
  options: MediaAdapterOptions,
): Promise<SpeechResult> {
  const response = await call(options, '/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: request.model,
      input: request.text,
      voice: request.voice ?? DEFAULT_VOICE,
      ...(request.format === undefined ? {} : { response_format: request.format }),
    }),
  });

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new MediaAdapterError('la API devolvio audio vacio');

  return { audio, contentType: response.headers.get('content-type') ?? 'audio/mpeg' };
}

// -----------------------------------------------------------------------------
// edicion de imagen — VERIFICADO
// -----------------------------------------------------------------------------

const imageResponseSchema = z.object({
  created: z.number().optional(),
  data: z
    .array(z.object({ url: z.string().url().optional(), b64_json: z.string().optional() }))
    .min(1),
});

export interface ImageEditRequest {
  model: string;
  image: Buffer;
  prompt: string;
  fileName?: string;
  mimeType?: string;
}

export interface ImageEditResult {
  /** la API devuelve una URL temporal, no los bytes */
  url: string | null;
  base64: string | null;
}

/** el proveedor rechaza imagenes de menos de 64 px de ancho */
export const MIN_IMAGE_WIDTH = 64;

export async function editImage(
  request: ImageEditRequest,
  options: MediaAdapterOptions,
): Promise<ImageEditResult> {
  const form = new FormData();
  form.append('model', request.model);
  form.append(
    'image',
    new Blob([new Uint8Array(request.image)], { type: request.mimeType ?? 'image/png' }),
    request.fileName ?? 'entrada.png',
  );
  form.append('prompt', request.prompt);

  const response = await call(options, '/images/edits', { method: 'POST', body: form });
  const parsed = imageResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new MediaAdapterError('la respuesta de imagen no tiene el formato esperado');
  }

  const first = parsed.data.data[0]!;
  return { url: first.url ?? null, base64: first.b64_json ?? null };
}

// -----------------------------------------------------------------------------
// transcripcion — NO VERIFICADO
// -----------------------------------------------------------------------------

const transcriptionSchema = z.object({ text: z.string() });

export interface TranscriptionRequest {
  model: string;
  audio: Buffer;
  fileName?: string;
  mimeType?: string;
  language?: string;
}

/**
 * transcribe un audio.
 *
 * ATENCION: este adaptador NO esta verificado. La forma es la estandar de
 * OpenAI (multipart con `file` y `model`), y el endpoint existe, pero en la
 * comprobacion del 2026-07-28 el proveedor de arriba devolvio 404. Puede que
 * haga falta otro plan, otro nombre de campo o que el modelo no este activo.
 *
 * Quien llame debe tratar el fallo como esperado y decirselo al usuario.
 */
export async function transcribeAudio(
  request: TranscriptionRequest,
  options: MediaAdapterOptions,
): Promise<{ text: string }> {
  const form = new FormData();
  form.append('model', request.model);
  form.append(
    'file',
    new Blob([new Uint8Array(request.audio)], { type: request.mimeType ?? 'audio/mpeg' }),
    request.fileName ?? 'audio.mp3',
  );
  if (request.language !== undefined) form.append('language', request.language);

  const response = await call(options, '/audio/transcriptions', { method: 'POST', body: form });
  const parsed = transcriptionSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new MediaAdapterError('la respuesta de transcripcion no tiene el formato esperado');
  }
  return { text: parsed.data.text };
}

// -----------------------------------------------------------------------------
// router remoto — VERIFICADO
// -----------------------------------------------------------------------------

const chatSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

export interface RemoteRouteRequest {
  model: string;
  prompt: string;
  candidates: readonly string[];
}

/**
 * pide al router remoto que elija entre los modelos disponibles.
 *
 * se le dan los candidatos y se comprueba que la respuesta sea uno de ellos: si
 * devuelve cualquier otra cosa, se descarta. El router remoto NUNCA decide algo
 * que Luxy no le haya ofrecido.
 */
export async function routeRemotely(
  request: RemoteRouteRequest,
  options: MediaAdapterOptions,
): Promise<{ model: string | null; raw: string }> {
  const response = await call(options, '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: request.model,
      max_tokens: 60,
      messages: [
        {
          role: 'system',
          content:
            'Elige el modelo mas adecuado para la tarea. Responde SOLO con su nombre exacto, ' +
            `uno de esta lista: ${request.candidates.join(', ')}`,
        },
        { role: 'user', content: request.prompt },
      ],
    }),
  });

  const parsed = chatSchema.safeParse(await response.json());
  if (!parsed.success) throw new MediaAdapterError('la respuesta del router no es valida');

  const raw = (parsed.data.choices[0]!.message.content ?? '').trim();
  // solo vale si es EXACTAMENTE uno de los candidatos que se le ofrecieron
  const chosen = request.candidates.find((candidate) => candidate === raw) ?? null;
  return { model: chosen, raw };
}
