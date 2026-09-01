// medios privados: el registro y los bytes, juntos.
//
// `private-store.ts` sella; `blob-store.ts` guarda bytes. Esta pieza los une y
// es la unica que sabe que un medio son DOS cosas que tienen que ir a la vez:
// un registro con los metadatos cifrados y uno o dos archivos.
//
// Importa el orden. Primero los bytes, despues el registro. Si falla a medias,
// queda un archivo huerfano —recuperable con una limpieza— en vez de un
// registro que apunta a algo que no existe, que es un error que solo aparece
// meses despues cuando intentas abrir la imagen.
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { privateMediaSchema, type PrivateMedia, type VaultMediaPayload } from '@luxy/shared';
import { openMedia, openMediaMetadata, openMediaThumbnail, sealMedia } from './private-store.js';
import { VaultError, type VaultService } from './vault-service.js';
import type { BlobStore } from './blob-store.js';

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mediaIndexDirectory(configDirectory: string): string {
  return join(configDirectory, 'vault', 'media-index');
}

export interface StoredMedia {
  mediaId: string;
  byteSize: number;
  hasThumbnail: boolean;
}

export class PrivateMediaStore {
  constructor(
    private readonly indexDirectory: string,
    private readonly blobs: BlobStore,
  ) {}

  private indexFile(conversationId: string): string {
    if (!CONVERSATION_ID.test(conversationId)) {
      throw new VaultError('identificador de conversacion no valido');
    }
    return join(this.indexDirectory, `${conversationId}.jsonl`);
  }

  private readRecords(conversationId: string): PrivateMedia[] {
    const file = this.indexFile(conversationId);
    if (!existsSync(file)) return [];

    const records: PrivateMedia[] = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = privateMediaSchema.safeParse(JSON.parse(line));
        if (parsed.success) records.push(parsed.data);
      } catch {
        // linea corrupta: se salta, igual que en las conversaciones
      }
    }
    return records;
  }

  /**
   * guarda una imagen o un video con sus metadatos.
   *
   * los bytes entran EN CLARO y salen cifrados: el cifrado ocurre aqui dentro,
   * en el proceso principal, antes de tocar el disco. En ningun momento existe
   * una copia sin cifrar del archivo en el sistema de ficheros.
   */
  async add(
    vault: VaultService,
    conversationId: string,
    bytes: Uint8Array,
    metadata: Omit<VaultMediaPayload, 'v' | 'createdAt'>,
    thumbnail?: Uint8Array,
  ): Promise<StoredMedia> {
    const sealed = await sealMedia(vault, {
      conversationId,
      bytes,
      metadata,
      ...(thumbnail === undefined ? {} : { thumbnail }),
    });

    // los bytes primero: un huerfano se limpia, un registro roto no se detecta
    await this.blobs.put(sealed.record.objectKey, sealed.blob);
    if (sealed.thumbnailBlob !== null && sealed.record.thumbnailObjectKey !== null) {
      await this.blobs.put(sealed.record.thumbnailObjectKey, sealed.thumbnailBlob);
    }

    mkdirSync(this.indexDirectory, { recursive: true });
    appendFileSync(
      this.indexFile(conversationId),
      `${JSON.stringify(sealed.record)}\n`,
      'utf8',
    );

    return {
      mediaId: sealed.record.mediaId,
      byteSize: sealed.record.byteSize,
      hasThumbnail: sealed.record.thumbnailObjectKey !== null,
    };
  }

  /** metadatos descifrados de los medios de una conversacion, sin los bytes */
  async list(
    vault: VaultService,
    conversationId: string,
  ): Promise<{ mediaId: string; metadata: VaultMediaPayload; hasThumbnail: boolean }[]> {
    const out = [];
    for (const record of this.readRecords(conversationId)) {
      out.push({
        mediaId: record.mediaId,
        metadata: await openMediaMetadata(vault, record),
        hasThumbnail: record.thumbnailObjectKey !== null,
      });
    }
    return out;
  }

  private find(conversationId: string, mediaId: string): PrivateMedia {
    const record = this.readRecords(conversationId).find((entry) => entry.mediaId === mediaId);
    if (record === undefined) throw new VaultError('ese archivo no existe en esta conversacion');
    return record;
  }

  /**
   * devuelve los bytes descifrados, en memoria.
   *
   * NUNCA se escribe una copia sin cifrar a disco, ni siquiera temporal. Un
   * archivo temporal descifrado es exactamente la fuga que la boveda evita, y
   * ademas sobrevive a un cierre inesperado.
   */
  async read(
    vault: VaultService,
    conversationId: string,
    mediaId: string,
  ): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const record = this.find(conversationId, mediaId);
    const metadata = await openMediaMetadata(vault, record);
    const blob = await this.blobs.get(record.objectKey);
    return { bytes: await openMedia(vault, record, blob), mimeType: metadata.mimeType };
  }

  async readThumbnail(
    vault: VaultService,
    conversationId: string,
    mediaId: string,
  ): Promise<Uint8Array> {
    const record = this.find(conversationId, mediaId);
    if (record.thumbnailObjectKey === null) {
      throw new VaultError('ese archivo no tiene miniatura guardada');
    }
    const blob = await this.blobs.get(record.thumbnailObjectKey);
    return openMediaThumbnail(vault, record, blob);
  }

  /**
   * borra los medios de una conversacion, bytes incluidos.
   *
   * Se llama al borrar la conversacion. Sin esto, borrarla dejaria los archivos
   * cifrados ocupando disco para siempre, sin nada que los referenciara y sin
   * forma de saber a que pertenecian.
   */
  async deleteConversation(conversationId: string): Promise<number> {
    const records = this.readRecords(conversationId);
    for (const record of records) {
      await this.blobs.delete(record.objectKey);
      if (record.thumbnailObjectKey !== null) {
        await this.blobs.delete(record.thumbnailObjectKey);
      }
    }
    const file = this.indexFile(conversationId);
    if (existsSync(file)) unlinkSync(file);
    return records.length;
  }

  /** espacio que ocupan los medios cifrados en este equipo */
  async usedBytes(): Promise<number> {
    return this.blobs.totalBytes();
  }
}
