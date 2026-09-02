// sincronizacion de la boveda entre equipos.
//
// Sube lo que este equipo tiene y no esta en el servidor, y baja lo contrario.
// Todo lo que viaja va ya cifrado: este modulo no descifra nada; solo comprueba
// que puede abrir lo que llega antes de guardarlo.
//
// Se autentica con la SESION DE LA CUENTA, no con el token de maquina. El
// gateway decide de quien es cada registro por el usuario de esa sesion, asi
// que el identificador de boveda ya no viaja: agrupaba, nunca autorizo, y
// enviarlo invitaba a confundir una cosa con la otra (D-045, D-046).
//
// Dos decisiones que ordenan el resto:
//
//   1. NO hay resolucion de conflictos, y no hace falta. Un turno es inmutable
//      y su identidad es (conversacion, secuencia): dos equipos no pueden
//      escribir cosas distintas en la misma ranura sin que uno sea mas nuevo.
//      Lo peor que puede pasar es que dos equipos generen el turno 5 a la vez,
//      y entonces el servidor se queda con el primero por su clave unica.
//
//   2. Se sube ANTES de bajar. Si el proceso se corta a medias, lo que se
//      pierde es trabajo ajeno que se volvera a bajar despues, no trabajo
//      propio que solo existia aqui.
import {
  vaultSyncListResponseSchema,
  vaultSyncPullResponseSchema,
  vaultSyncPushResponseSchema,
  type PrivateRecord,
} from '@luxy/shared';
import { VaultError, type VaultService } from './vault-service.js';
import type { PrivateConversationStore } from './conversation-store.js';
import type { PrivateMediaStore } from './media-store.js';
import { syncMedia } from './media-sync.js';

export interface VaultSyncDeps {
  gatewayUrl: string;
  /** sesion de la cuenta; caduca, y su caducidad es la que echa a este equipo */
  sessionToken: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** se llama al recibir un 401, para que la sesion guardada deje de usarse */
  onUnauthorized?: () => void;
}

export interface VaultSyncResult {
  uploaded: number;
  downloaded: number;
  conversations: number;
  /** imagenes y videos, contados aparte: son otro tipo de trabajo y otro coste */
  mediaUploaded: number;
  mediaDownloaded: number;
  /** medios que no caben en una peticion y se quedan en su equipo */
  mediaSkipped: number;
}

class SyncError extends VaultError {}

async function call(
  deps: VaultSyncDeps,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(`${deps.gatewayUrl.replace(/\/+$/, '')}${path}`, {
    ...init,
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    headers: {
      Authorization: `Bearer ${deps.sessionToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // la sesion ya no vale: se olvida aqui para que la siguiente accion pida
      // entrar en vez de volver a fallar con el mismo token
      deps.onUnauthorized?.();
      throw new SyncError(
        'tu sesion ha caducado',
        'vuelve a entrar con tu correo y contraseña desde Privado',
      );
    }
    throw new SyncError(
      `el gateway respondio ${response.status}`,
      'reintenta mas tarde; lo tuyo sigue guardado en este equipo',
    );
  }
  return response.json();
}

/**
 * sincroniza una conversacion concreta.
 *
 * Se hace por conversacion y no de golpe para que un fallo a mitad deje el
 * resto sincronizado, en vez de dejarlo todo a medias sin saber por donde iba.
 */
export async function syncConversation(
  vault: VaultService,
  store: PrivateConversationStore,
  conversationId: string,
  deps: VaultSyncDeps,
): Promise<{ uploaded: number; downloaded: number }> {
  const local = store.rawRecords(conversationId);

  // 1. subir. Es idempotente por (vault, conversacion, secuencia), asi que
  // reenviar lo que ya estaba no duplica: el servidor devuelve cuantos eran
  // nuevos de verdad.
  let uploaded = 0;
  if (local.length > 0) {
    const body = await call(deps, '/api/vault/records', {
      method: 'POST',
      body: JSON.stringify({ conversationId, records: local }),
    });
    const parsed = vaultSyncPushResponseSchema.safeParse(body);
    if (!parsed.success) throw new SyncError('el gateway respondio algo inesperado al subir');
    uploaded = parsed.data.stored;
  }

  // 2. bajar lo que este equipo no tiene
  const remoteBody = await call(deps, `/api/vault/conversations/${conversationId}`);
  const remote = vaultSyncPullResponseSchema.safeParse(remoteBody);
  if (!remote.success) throw new SyncError('el gateway respondio algo inesperado al descargar');

  const known = new Set(local.map((record) => record.sequence));
  const missing = remote.data.records.filter((record) => !known.has(record.sequence));

  let downloaded = 0;
  for (const record of missing) {
    // se comprueba que se puede ABRIR antes de guardarlo. Un registro de otra
    // boveda, o corrupto, no debe entrar en el archivo local: si entra, cada
    // lectura posterior fallara sin que se sepa cual es el malo.
    try {
      await store.verifyRecord(vault, record);
    } catch {
      continue;
    }
    store.appendRaw(conversationId, record);
    downloaded += 1;
  }

  return { uploaded, downloaded };
}

/** sincroniza todas las conversaciones, locales y remotas */
export async function syncVault(
  vault: VaultService,
  store: PrivateConversationStore,
  deps: VaultSyncDeps,
  /**
   * almacen de medios. Opcional a proposito: sincronizar turnos no depende de
   * tener medios, y quien solo quiera probar la parte de texto no deberia
   * arrastrar el almacen de objetos.
   */
  media?: PrivateMediaStore,
): Promise<VaultSyncResult> {
  if (!vault.isUnlocked()) {
    throw new VaultError(
      'la boveda esta bloqueada',
      'abrela para sincronizar: sin la llave no se puede comprobar lo que llega',
    );
  }

  const remoteBody = await call(deps, '/api/vault/conversations');
  const remote = vaultSyncListResponseSchema.safeParse(remoteBody);
  if (!remote.success) throw new SyncError('el gateway respondio algo inesperado');

  // la union de lo de aqui y lo de alli: sin esto, una conversacion creada en
  // el otro equipo no se descargaria nunca porque aqui no existe
  const ids = new Set<string>([
    ...store.listConversationIds(),
    ...remote.data.conversations.map((entry) => entry.conversationId),
  ]);

  let uploaded = 0;
  let downloaded = 0;
  for (const conversationId of ids) {
    const result = await syncConversation(vault, store, conversationId, deps);
    uploaded += result.uploaded;
    downloaded += result.downloaded;
  }

  // los medios van DESPUES de los turnos: si algo falla aqui, lo que ya se
  // subio de la conversacion sigue subido y el reintento solo repite esto
  const mediaResult =
    media === undefined
      ? { uploaded: 0, downloaded: 0, skipped: 0 }
      : await syncMedia(vault, media, deps);

  return {
    uploaded,
    downloaded,
    conversations: ids.size,
    mediaUploaded: mediaResult.uploaded,
    mediaDownloaded: mediaResult.downloaded,
    mediaSkipped: mediaResult.skipped,
  };
}

export type { PrivateRecord };
