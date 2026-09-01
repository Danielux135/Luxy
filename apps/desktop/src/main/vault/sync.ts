// sincronizacion de la boveda entre equipos.
//
// Sube lo que este equipo tiene y no esta en el servidor, y baja lo contrario.
// Todo lo que viaja va ya cifrado: este modulo no descifra nada salvo para
// derivar el identificador de boveda, que necesita la llave maestra.
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

export interface VaultSyncDeps {
  gatewayUrl: string;
  machineToken: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface VaultSyncResult {
  uploaded: number;
  downloaded: number;
  conversations: number;
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
      Authorization: `Bearer ${deps.machineToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new SyncError(
      `el gateway respondio ${response.status}`,
      response.status === 401
        ? 'vuelve a registrar esta maquina desde Ajustes'
        : 'reintenta mas tarde; lo tuyo sigue guardado en este equipo',
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
  vaultId: string,
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
      body: JSON.stringify({ vaultId, conversationId, records: local }),
    });
    const parsed = vaultSyncPushResponseSchema.safeParse(body);
    if (!parsed.success) throw new SyncError('el gateway respondio algo inesperado al subir');
    uploaded = parsed.data.stored;
  }

  // 2. bajar lo que este equipo no tiene
  const remoteBody = await call(
    deps,
    `/api/vault/conversations/${conversationId}?vaultId=${encodeURIComponent(vaultId)}`,
  );
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
  vaultId: string,
  deps: VaultSyncDeps,
): Promise<VaultSyncResult> {
  if (!vault.isUnlocked()) {
    throw new VaultError(
      'la boveda esta bloqueada',
      'abrela para sincronizar: sin la llave no se puede comprobar lo que llega',
    );
  }

  const remoteBody = await call(
    deps,
    `/api/vault/conversations?vaultId=${encodeURIComponent(vaultId)}`,
  );
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
    const result = await syncConversation(vault, store, vaultId, conversationId, deps);
    uploaded += result.uploaded;
    downloaded += result.downloaded;
  }

  return { uploaded, downloaded, conversations: ids.size };
}

export type { PrivateRecord };
