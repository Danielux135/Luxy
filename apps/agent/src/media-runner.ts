// ejecucion de trabajos de audio e imagen.
//
// Estos modelos NO pasan por el bucle de herramientas: no editan el proyecto.
// Reciben un adjunto o un texto, llaman a su adaptador y devuelven un medio.
//
// Nunca reciben herramientas de archivos. Un modelo de transcripcion no tiene
// nada que hacer con write_file, y darselo solo ampliaria la superficie.
import type { AgentConfig, ClaimedJob, ModelDefinition } from '@luxy/shared';
import { ModelRegistry, buildDefaultCatalog, redact } from '@luxy/shared';
import {
  ADAPTER_VERIFICATION,
  editImage,
  synthesizeSpeech,
  transcribeAudio,
  MediaAdapterError,
} from './providers/media-adapters.js';

export interface MediaJobResult {
  ok: boolean;
  summary: string;
  media?: {
    kind: 'photo' | 'audio' | 'document';
    url?: string;
    base64?: string;
    fileName?: string;
    caption?: string;
  };
}

export interface MediaJobDeps {
  config: AgentConfig;
  /** descarga el adjunto del trabajo desde el gateway */
  downloadAttachment: () => Promise<Buffer>;
  apiKeyFor: (connectionId: string) => string | undefined;
  signal: AbortSignal;
  emit: (message: string) => void;
}

/** busca en el catalogo el modelo que corresponde a este trabajo */
export function findMediaModel(
  apiModel: string,
  config: AgentConfig,
): { definition: ModelDefinition; connectionId: string } | null {
  for (const connection of config.connections) {
    if (!connection.enabled) continue;
    const registry = new ModelRegistry({
      connections: [connection],
      models: buildDefaultCatalog(connection.id),
    });
    const definition = registry.list().find((model) => model.apiModel === apiModel);
    // solo audio e imagen: los de categoria "routing" no son un destino final,
    // y los de texto van por el bucle de herramientas de siempre
    if (definition !== undefined && (definition.category === 'audio' || definition.category === 'image')) {
      return { definition, connectionId: connection.id };
    }
  }
  return null;
}

/**
 * ejecuta un trabajo de audio o de imagen.
 *
 * nunca lanza: un fallo se devuelve como resultado, con la causa, para que el
 * usuario sepa que paso.
 */
export async function runMediaJob(
  job: ClaimedJob,
  model: { definition: ModelDefinition; connectionId: string },
  deps: MediaJobDeps,
): Promise<MediaJobResult> {
  const connection = deps.config.connections.find((entry) => entry.id === model.connectionId);
  const apiKey = deps.apiKeyFor(model.connectionId);

  if (connection === undefined || apiKey === undefined) {
    return { ok: false, summary: `falta la clave de la conexion "${model.connectionId}"` };
  }

  const options = {
    baseUrl: connection.baseUrl,
    apiKey,
    signal: deps.signal,
    timeoutMs: Math.min(connection.timeoutMs, 300_000),
  };
  const capacidades = model.definition.capabilities;

  // no hay adaptador para estos dos: se dice claro en vez de fallar raro
  if (capacidades.includes('realtime_audio') || capacidades.includes('audio_chat')) {
    return {
      ok: false,
      summary: `"${model.definition.displayName}" es un modelo de conversacion por voz en tiempo real. Luxy todavia no tiene ese canal: por Telegram puedes usar /speak para generar audio.`,
    };
  }

  try {
    // ---- sintesis de voz: solo necesita texto ----
    if (capacidades.includes('text_to_speech')) {
      deps.emit(`sintetizando voz con ${model.definition.displayName}`);
      const result = await synthesizeSpeech(
        { model: model.definition.apiModel, text: job.prompt },
        options,
      );
      return {
        ok: true,
        summary: `Audio generado (${Math.round(result.audio.length / 1024)} KB).`,
        media: {
          kind: 'audio',
          base64: result.audio.toString('base64'),
          fileName: 'luxy.mp3',
          caption: job.prompt.slice(0, 200),
        },
      };
    }

    // ---- lo demas necesita un adjunto ----
    if (job.attachment === null) {
      return {
        ok: false,
        summary: hintForMissingAttachment(model.definition),
      };
    }

    deps.emit('descargando el adjunto');
    const bytes = await deps.downloadAttachment();

    if (capacidades.includes('image_edit')) {
      deps.emit(`editando la imagen con ${model.definition.displayName}`);
      const result = await editImage(
        {
          model: model.definition.apiModel,
          image: bytes,
          prompt: job.prompt,
          fileName: job.attachment.fileName ?? 'entrada.png',
          mimeType: job.attachment.mimeType ?? 'image/jpeg',
        },
        options,
      );
      if (result.url === null && result.base64 === null) {
        return { ok: false, summary: 'la API no devolvio ninguna imagen' };
      }
      return {
        ok: true,
        summary: 'Imagen editada.',
        media: {
          kind: 'photo',
          ...(result.url !== null ? { url: result.url } : {}),
          ...(result.base64 !== null ? { base64: result.base64 } : {}),
          // Telegram necesita una extension reconocible cuando van bytes
          fileName: 'luxy.png',
          caption: job.prompt.slice(0, 200),
        },
      };
    }

    if (capacidades.includes('transcription')) {
      deps.emit(`transcribiendo con ${model.definition.displayName}`);
      const result = await transcribeAudio(
        {
          model: model.definition.apiModel,
          audio: bytes,
          fileName: job.attachment.fileName ?? 'audio.mp3',
          mimeType: job.attachment.mimeType ?? 'audio/mpeg',
        },
        options,
      );
      return { ok: true, summary: result.text };
    }

    return {
      ok: false,
      summary: `el modelo "${model.definition.displayName}" no tiene una capacidad que Luxy sepa ejecutar`,
    };
  } catch (error) {
    // el adaptador de transcripcion no esta verificado: se dice, en vez de
    // dejar al usuario pensando que ha hecho algo mal
    const sinVerificar =
      capacidades.includes('transcription') && !ADAPTER_VERIFICATION.transcription.verified;
    const causa =
      error instanceof MediaAdapterError ? error.message : redact(String(error)).slice(0, 300);

    return {
      ok: false,
      summary: sinVerificar
        ? `${causa}\n\nLa transcripcion no esta verificada contra este proveedor: el endpoint existe pero devuelve 404. Es una limitacion conocida, no un fallo de tu peticion.`
        : causa,
    };
  }
}

/** explica que adjuntar, segun lo que el modelo necesita */
function hintForMissingAttachment(definition: ModelDefinition): string {
  if (definition.capabilities.includes('image_edit')) {
    return 'Este comando necesita una imagen. Envia la foto con la instruccion en el pie, o responde a una foto ya enviada.';
  }
  if (definition.capabilities.includes('transcription')) {
    return 'Este comando necesita un audio. Envia una nota de voz o un archivo de audio, o responde a uno ya enviado.';
  }
  return 'Este comando necesita un archivo adjunto.';
}
