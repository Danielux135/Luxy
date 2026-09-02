// sincronizacion de imagenes y videos entre equipos.
//
// Hermana de `sync.ts`, y separada de ella por una razon: un medio son DOS
// cosas —un registro y unos bytes— y eso cambia el orden de todo. Mezclarlas
// habria obligado a poner condicionales dentro de cada paso del otro archivo.
//
// Las reglas que ordenan esto:
//
//   1. **bytes antes que registro**, subiendo y bajando. Si se corta a mitad
//      queda un objeto huerfano, que una limpieza recoge, en vez de un registro
//      que apunta a algo que no existe y que solo se descubre meses despues al
//      intentar abrir la imagen;
//   2. **lo que llega se comprueba antes de guardarse.** Un registro de otra
//      boveda entraria en el indice y haria fallar cada lectura posterior sin
//      que se supiera cual es el malo;
//   3. **un archivo demasiado grande no rompe la sincronizacion.** Se salta, se
//      cuenta y se sigue: perder el resto por un video de 200 MB seria peor.
//
// Nada de lo que viaja se descifra aqui. Los bytes salen y entran tal cual.
import { VAULT_MAX_OBJECT_BYTES, vaultMediaListResponseSchema, type PrivateMedia } from '@luxy/shared';
import { VaultError, type VaultService } from './vault-service.js';
import type { PrivateMediaStore } from './media-store.js';
import type { VaultSyncDeps } from './sync.js';

export interface VaultMediaSyncResult {
  uploaded: number;
  downloaded: number;
  /** los que no caben en una peticion; se quedan donde estan */
  skipped: number;
}

class MediaSyncError extends VaultError {}

function baseUrl(deps: VaultSyncDeps): string {
  return deps.gatewayUrl.replace(/\/+$/, '');
}

function headers(deps: VaultSyncDeps): Record<string, string> {
  return { Authorization: `Bearer ${deps.sessionToken}` };
}

/** un fallo de autorizacion se trata igual que en `sync.ts`: se olvida la sesion */
function fail(deps: VaultSyncDeps, status: number): never {
  if (status === 401) {
    deps.onUnauthorized?.();
    throw new MediaSyncError(
      'tu sesion ha caducado',
      'vuelve a entrar con tu correo y contraseña desde Privado',
    );
  }
  throw new MediaSyncError(
    `el gateway respondio ${status}`,
    status === 503
      ? 'falta crear el almacen de medios en Supabase'
      : 'reintenta mas tarde; lo tuyo sigue guardado en este equipo',
  );
}

async function listRemote(deps: VaultSyncDeps): Promise<PrivateMedia[]> {
  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(`${baseUrl(deps)}/api/vault/media`, {
    headers: headers(deps),
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  });
  if (!response.ok) fail(deps, response.status);

  const parsed = vaultMediaListResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new MediaSyncError('el gateway respondio algo inesperado');
  return parsed.data.media;
}

async function putObject(
  deps: VaultSyncDeps,
  objectKey: string,
  bytes: Uint8Array,
): Promise<void> {
  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(`${baseUrl(deps)}/api/vault/media/objects/${objectKey}`, {
    method: 'PUT',
    headers: { ...headers(deps), 'Content-Type': 'application/octet-stream' },
    // se copia a un ArrayBuffer propio: pasar la vista tal cual enviaria el
    // buffer entero si el Uint8Array fuera una ventana sobre uno mayor
    body: bytes.slice().buffer as ArrayBuffer,
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  });
  if (!response.ok) fail(deps, response.status);
}

async function getObject(deps: VaultSyncDeps, objectKey: string): Promise<Uint8Array> {
  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(`${baseUrl(deps)}/api/vault/media/objects/${objectKey}`, {
    headers: headers(deps),
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  });
  if (!response.ok) fail(deps, response.status);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * sube lo que este equipo tiene y baja lo que le falta.
 *
 * La identidad de un medio es su clave de objeto, que es aleatoria y no se
 * deriva del contenido: dos equipos no pueden generar la misma por accidente,
 * asi que comparar claves basta para saber que falta a cada lado.
 */
export async function syncMedia(
  vault: VaultService,
  store: PrivateMediaStore,
  deps: VaultSyncDeps,
): Promise<VaultMediaSyncResult> {
  if (!vault.isUnlocked()) {
    throw new VaultError(
      'la boveda esta bloqueada',
      'abrela para sincronizar: sin la llave no se puede comprobar lo que llega',
    );
  }

  const remote = await listRemote(deps);
  const remoteKeys = new Set(remote.map((entry) => entry.objectKey));

  // 1. subir lo propio que alli no esta
  let uploaded = 0;
  let skipped = 0;
  for (const conversationId of store.listConversationIds()) {
    for (const record of store.rawRecords(conversationId)) {
      if (remoteKeys.has(record.objectKey)) continue;
      if (record.byteSize > VAULT_MAX_OBJECT_BYTES) {
        // saltarlo y seguir: perder el resto de la sincronizacion por un
        // archivo enorme seria un peor negocio que dejarlo en este equipo
        skipped += 1;
        continue;
      }

      await putObject(deps, record.objectKey, await store.rawBlob(record.objectKey));
      if (record.thumbnailObjectKey !== null) {
        await putObject(deps, record.thumbnailObjectKey, await store.rawBlob(record.thumbnailObjectKey));
      }

      // el registro va DESPUES de sus bytes, y el gateway lo rechaza si no
      // estan: asi el otro equipo nunca ve un archivo que no puede abrir
      const doFetch = deps.fetchImpl ?? fetch;
      const response = await doFetch(`${baseUrl(deps)}/api/vault/media`, {
        method: 'POST',
        headers: { ...headers(deps), 'Content-Type': 'application/json' },
        body: JSON.stringify({ media: record }),
        ...(deps.signal === undefined ? {} : { signal: deps.signal }),
      });
      if (!response.ok) fail(deps, response.status);
      uploaded += 1;
    }
  }

  // 2. bajar lo que aqui no esta
  let downloaded = 0;
  const localKeys = new Set(
    store.listConversationIds().flatMap((id) => store.rawRecords(id).map((r) => r.objectKey)),
  );
  for (const record of remote) {
    if (localKeys.has(record.objectKey)) continue;

    const blob = await getObject(deps, record.objectKey);
    const thumbnail =
      record.thumbnailObjectKey === null ? null : await getObject(deps, record.thumbnailObjectKey);

    try {
      await store.acceptRemote(vault, record, blob, thumbnail);
    } catch {
      // no se puede abrir con esta boveda: no entra en el indice. Igual que en
      // las conversaciones, un registro ilegible envenena cada lectura futura
      continue;
    }
    downloaded += 1;
  }

  return { uploaded, downloaded, skipped };
}
