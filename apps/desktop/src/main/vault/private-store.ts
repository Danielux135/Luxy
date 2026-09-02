// cifrado en el cliente: la frontera por la que sale todo lo privado.
//
// Nada de una conversacion privada debe salir del proceso principal sin pasar
// por aqui. Este modulo toma contenido en claro, pide la subclave a la boveda,
// lo sella, y devuelve exactamente los registros que el gateway puede recibir.
//
// Antes de devolver nada ejecuta assertNoPlaintextLeak(). Ese guardian es la
// diferencia entre "el diseño dice que no se envia el titulo" y "el titulo no
// se envia": si un campo prohibido aparece, el registro no sale.
import {
  assertNoPlaintextLeak,
  privateMediaSchema,
  privateRecordSchema,
  vaultMediaPayloadSchema,
  vaultMemoryPayloadSchema,
  vaultTurnPayloadSchema,
  VAULT_PAYLOAD_VERSION,
  type PrivateMedia,
  type PrivateRecord,
  type VaultMediaPayload,
  type VaultMemoryPayload,
  type VaultTurnPayload,
} from '@luxy/shared';
import {
  openBlob,
  openText,
  randomBytes,
  sealBlob,
  sealText,
  wipe,
  type SealedEnvelope,
} from '@luxy/vault-crypto';
import { VaultError, type VaultService } from './vault-service.js';

/**
 * clave con la que un archivo cifrado se guarda en el almacen de objetos.
 *
 * 16 bytes aleatorios en hexadecimal. No se deriva del contenido ni del nombre:
 * una clave derivada del contenido permitiria saber si dos personas guardan el
 * mismo archivo, y una derivada del nombre lo revelaria directamente.
 */
export function randomObjectKey(): string {
  return [...randomBytes(16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * ejecuta el guardian y devuelve el registro.
 *
 * se llama SIEMPRE justo antes de entregar algo destinado al gateway. Que sea
 * el ultimo paso es intencionado: da igual como se construyera el objeto.
 */
function guard<T>(record: T): T {
  assertNoPlaintextLeak(record);
  return record;
}

export interface SealTurnInput {
  conversationId: string;
  sequence: number;
  /**
   * `instructions` es opcional aqui aunque el payload lo exija: un turno sin
   * instrucciones fijas es lo normal, y obligar a escribir `instructions: null`
   * en cada llamada solo conseguiria que alguien lo rellene por costumbre.
   */
  turn: Omit<VaultTurnPayload, 'v' | 'createdAt' | 'instructions'> & {
    createdAt?: string;
    instructions?: string | null;
  };
  memory?: Omit<VaultMemoryPayload, 'v'>;
}

/** sella un turno y devuelve el registro que el gateway puede almacenar */
export async function sealTurn(vault: VaultService, input: SealTurnInput): Promise<PrivateRecord> {
  const key = vault.subkeyFor('conversation', input.conversationId);
  let memoryKey: Uint8Array | null = null;
  try {
    const payload = vaultTurnPayloadSchema.parse({
      ...input.turn,
      v: VAULT_PAYLOAD_VERSION,
      createdAt: input.turn.createdAt ?? nowIso(),
    });
    const content = await sealText(key, 'vault.conversation', JSON.stringify(payload));

    let sealedMemory: SealedEnvelope | null = null;
    if (input.memory !== undefined) {
      // la memoria usa su propia subclave: abrir el historial de una
      // conversacion no obliga a poder abrir su memoria, ni al reves
      memoryKey = vault.subkeyFor('memory', input.conversationId);
      const memoryPayload = vaultMemoryPayloadSchema.parse({
        ...input.memory,
        v: VAULT_PAYLOAD_VERSION,
      });
      sealedMemory = await sealText(memoryKey, 'vault.memory', JSON.stringify(memoryPayload));
    }

    return guard(
      privateRecordSchema.parse({
        recordId: crypto.randomUUID(),
        conversationId: input.conversationId,
        privacy: 'private',
        sequence: input.sequence,
        content,
        sealedMemory,
        createdAt: nowIso(),
      }),
    );
  } finally {
    wipe(key, memoryKey);
  }
}

export interface OpenedTurn {
  turn: VaultTurnPayload;
  memory: VaultMemoryPayload | null;
}

/** abre un registro. valida lo descifrado antes de devolverlo */
export async function openTurn(vault: VaultService, record: PrivateRecord): Promise<OpenedTurn> {
  const key = vault.subkeyFor('conversation', record.conversationId);
  let memoryKey: Uint8Array | null = null;
  try {
    const raw = await openText(key, 'vault.conversation', record.content);
    const turn = vaultTurnPayloadSchema.parse(parseJson(raw));

    let memory: VaultMemoryPayload | null = null;
    if (record.sealedMemory !== null) {
      memoryKey = vault.subkeyFor('memory', record.conversationId);
      const rawMemory = await openText(memoryKey, 'vault.memory', record.sealedMemory);
      memory = vaultMemoryPayloadSchema.parse(parseJson(rawMemory));
    }
    return { turn, memory };
  } finally {
    wipe(key, memoryKey);
  }
}

export interface SealMediaInput {
  conversationId: string;
  bytes: Uint8Array;
  metadata: Omit<VaultMediaPayload, 'v' | 'createdAt'> & { createdAt?: string };
  /** miniatura ya generada. si falta, no se guarda ninguna */
  thumbnail?: Uint8Array;
}

export interface SealedMedia {
  record: PrivateMedia;
  /** bytes cifrados del original, listos para el almacen de objetos */
  blob: Uint8Array;
  /** bytes cifrados de la miniatura; null si no habia */
  thumbnailBlob: Uint8Array | null;
}

/**
 * sella una imagen o un video con su miniatura.
 *
 * La miniatura se cifra igual que el original y con su propia subclave. Es el
 * fallo clasico: se cifra `video.mp4` con esmero y se deja un `preview.jpg`
 * legible al lado, que revela lo mismo con menos trabajo.
 */
export async function sealMedia(
  vault: VaultService,
  input: SealMediaInput,
): Promise<SealedMedia> {
  if (input.bytes.length === 0) throw new VaultError('el archivo esta vacio');

  const mediaId = crypto.randomUUID();
  const mediaKey = vault.subkeyFor('media', mediaId);
  let thumbnailKey: Uint8Array | null = null;
  try {
    const payload = vaultMediaPayloadSchema.parse({
      ...input.metadata,
      v: VAULT_PAYLOAD_VERSION,
      createdAt: input.metadata.createdAt ?? nowIso(),
    });

    const blob = await sealBlob(mediaKey, 'vault.media', input.bytes);
    const content = await sealText(mediaKey, 'vault.media', JSON.stringify(payload));

    let thumbnailBlob: Uint8Array | null = null;
    let thumbnailObjectKey: string | null = null;
    if (input.thumbnail !== undefined && input.thumbnail.length > 0) {
      thumbnailKey = vault.subkeyFor('thumbnail', mediaId);
      thumbnailBlob = await sealBlob(thumbnailKey, 'vault.thumbnail', input.thumbnail);
      thumbnailObjectKey = randomObjectKey();
    }

    return {
      record: guard(
        privateMediaSchema.parse({
          mediaId,
          conversationId: input.conversationId,
          objectKey: randomObjectKey(),
          byteSize: blob.length,
          content,
          thumbnailObjectKey,
          createdAt: nowIso(),
        }),
      ),
      blob,
      thumbnailBlob,
    };
  } finally {
    wipe(mediaKey, thumbnailKey);
  }
}

/** lee los metadatos de un medio sin descargar el archivo entero */
export async function openMediaMetadata(
  vault: VaultService,
  record: PrivateMedia,
): Promise<VaultMediaPayload> {
  const key = vault.subkeyFor('media', record.mediaId);
  try {
    return vaultMediaPayloadSchema.parse(
      parseJson(await openText(key, 'vault.media', record.content)),
    );
  } finally {
    wipe(key);
  }
}

/** descifra el archivo original. los bytes se devuelven en memoria, no a disco */
export async function openMedia(
  vault: VaultService,
  record: PrivateMedia,
  blob: Uint8Array,
): Promise<Uint8Array> {
  const key = vault.subkeyFor('media', record.mediaId);
  try {
    return await openBlob(key, 'vault.media', blob);
  } finally {
    wipe(key);
  }
}

export async function openMediaThumbnail(
  vault: VaultService,
  record: PrivateMedia,
  blob: Uint8Array,
): Promise<Uint8Array> {
  if (record.thumbnailObjectKey === null) {
    throw new VaultError('este archivo no tiene miniatura guardada');
  }
  const key = vault.subkeyFor('thumbnail', record.mediaId);
  try {
    return await openBlob(key, 'vault.thumbnail', blob);
  } finally {
    wipe(key);
  }
}

/** un JSON descifrado sigue siendo entrada: se parsea con cuidado */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new VaultError(
      'el contenido descifrado no se puede leer',
      'puede haberse guardado con una version distinta de Luxy',
    );
  }
}
