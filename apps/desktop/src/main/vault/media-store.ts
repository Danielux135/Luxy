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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  assertNoPlaintextLeak,
  privateMediaSchema,
  vaultMediaPayloadSchema,
  type PrivateMedia,
  type VaultMediaPayload,
} from '@luxy/shared';
import { sealText, wipe } from '@luxy/vault-crypto';
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

  /**
   * registros tal cual estan en disco, sin descifrar.
   *
   * Los usa la sincronizacion, que no necesita —ni debe— abrir nada para
   * decidir que falta a cada lado. Es el equivalente de `rawRecords` en las
   * conversaciones.
   */
  rawRecords(conversationId: string): PrivateMedia[] {
    return this.readRecords(conversationId);
  }

  /** conversaciones con medios en este equipo */
  listConversationIds(): string[] {
    if (!existsSync(this.indexDirectory)) return [];
    return readdirSync(this.indexDirectory)
      .filter((entry) => entry.endsWith('.jsonl'))
      .map((entry) => entry.slice(0, -'.jsonl'.length))
      .filter((id) => CONVERSATION_ID.test(id));
  }

  /** bytes cifrados de un objeto, para subirlos tal cual */
  async rawBlob(objectKey: string): Promise<Uint8Array> {
    return this.blobs.get(objectKey);
  }

  async hasBlob(objectKey: string): Promise<boolean> {
    return this.blobs.has(objectKey);
  }

  /**
   * guarda un medio descargado de otro equipo.
   *
   * Se comprueba que los metadatos SE PUEDEN ABRIR antes de escribir nada. Un
   * registro de otra boveda o corrupto que entrase en el indice haria fallar
   * cada lectura posterior sin que se supiera cual es el malo, igual que en las
   * conversaciones.
   *
   * Los bytes primero y el registro despues: un huerfano se limpia, un registro
   * que apunta a bytes que no estan no se detecta hasta que alguien lo abre.
   */
  async acceptRemote(
    vault: VaultService,
    record: PrivateMedia,
    blob: Uint8Array,
    thumbnailBlob: Uint8Array | null,
  ): Promise<void> {
    await openMediaMetadata(vault, record);

    await this.blobs.put(record.objectKey, blob);
    if (thumbnailBlob !== null && record.thumbnailObjectKey !== null) {
      await this.blobs.put(record.thumbnailObjectKey, thumbnailBlob);
    }

    mkdirSync(this.indexDirectory, { recursive: true });
    appendFileSync(
      this.indexFile(record.conversationId),
      `${JSON.stringify(record)}\n`,
      'utf8',
    );
  }

  /**
   * metadatos descifrados de los medios de una conversacion, sin los bytes.
   *
   * SALEN DE LA MAS ANTIGUA A LA MAS RECIENTE, y eso no es el orden del indice.
   * El JSONL se añade al final, asi que localmente coincide, pero la
   * sincronizacion llama a `acceptRemote` en el orden del listado remoto: una
   * foto de ayer traida del portatil queda DESPUES de una hecha hoy aqui.
   *
   * Importa porque el prompt de la conversacion le dice al modelo que la lista
   * va de la mas antigua a la mas reciente —es lo unico que hace resoluble «la
   * ultima», que es una de las formas que mandan reenviar en vez de generar—.
   * Una mentira sobre el orden seria peor que el silencio: resolveria con
   * seguridad a la linea equivocada.
   */
  async list(
    vault: VaultService,
    conversationId: string,
  ): Promise<{ mediaId: string; metadata: VaultMediaPayload; hasThumbnail: boolean }[]> {
    const out: { mediaId: string; metadata: VaultMediaPayload; hasThumbnail: boolean }[] = [];
    for (const record of this.readRecords(conversationId)) {
      out.push({
        mediaId: record.mediaId,
        metadata: await openMediaMetadata(vault, record),
        hasThumbnail: record.thumbnailObjectKey !== null,
      });
    }
    // `createdAt` esta validado como fecha ISO por el esquema, asi que se puede
    // parsear sin comprobarlo otra vez; con la misma fecha el orden del indice
    // decide, porque `sort` es estable
    return out.sort(
      (a, b) => Date.parse(a.metadata.createdAt) - Date.parse(b.metadata.createdAt),
    );
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
   * corrige el pie de foto de un medio ya guardado.
   *
   * Se vuelve a sellar SOLO la metadata. Los bytes siguen donde estan, con su
   * cifrado intacto: descifrarlos para volver a cifrarlos identicos costaria
   * tiempo, obligaria a tener el archivo entero en claro en memoria y podria
   * dejar el objeto a medias. Nada de eso compra nada, porque los bytes no
   * cambian.
   *
   * Del payload anterior se conserva todo, `prompt` incluido. Corregir lo que
   * se VE no puede borrar lo que se PIDIO: es lo unico que explica por que la
   * imagen salio como salio, y no se puede reconstruir despues.
   */
  async setCaption(
    vault: VaultService,
    conversationId: string,
    mediaId: string,
    caption: string | null,
  ): Promise<void> {
    const records = this.readRecords(conversationId);
    const index = records.findIndex((entry) => entry.mediaId === mediaId);
    // un identificador que no esta es un error, no un no-op silencioso: quien
    // corrige el pie de foto del medio equivocado se queda creyendo que lo hizo
    if (index === -1) throw new VaultError('ese archivo no existe en esta conversacion');
    const record = records[index]!;

    const previous = await openMediaMetadata(vault, record);
    const payload = vaultMediaPayloadSchema.parse({ ...previous, caption });

    const key = vault.subkeyFor('media', mediaId);
    try {
      const content = await sealText(key, 'vault.media', JSON.stringify(payload));
      const updated = privateMediaSchema.parse({ ...record, content });
      // el guardian tambien aqui: este registro sale hacia la sincronizacion
      // sin volver a pasar por el sellado de `private-store`
      assertNoPlaintextLeak(updated);
      records[index] = updated;
    } finally {
      wipe(key);
    }

    // escritura atomica: el alta solo añade una linea al final, pero corregir
    // reescribe el indice entero, y un corte a media escritura dejaria ilegible
    // toda la conversacion, no solo el medio que se estaba corrigiendo
    const file = this.indexFile(conversationId);
    const temporary = `${file}.tmp`;
    const lines = records.map((entry) => JSON.stringify(entry));
    writeFileSync(temporary, `${lines.join('\n')}\n`, 'utf8');
    renameSync(temporary, file);
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
