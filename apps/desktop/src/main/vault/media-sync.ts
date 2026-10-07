// sincronizacion de imagenes y videos entre equipos, protocolo v2 (`SYNC-F1-06`).
//
// Hermana de `sync.ts`, y separada de ella por una razon: un medio son DOS
// cosas —un registro y unos bytes— y eso cambia el orden de todo. Mezclarlas
// habria obligado a poner condicionales dentro de cada paso del otro archivo.
//
// Las reglas que ordenan esto:
//
//   1. **bytes antes que registro**, subiendo y bajando (`D-050`). Si se corta
//      a mitad queda un objeto huerfano, que una limpieza recoge, en vez de un
//      registro que apunta a algo que no existe y que solo se descubre meses
//      despues al intentar abrir la imagen;
//   2. **solo cuenta como subido lo que el gateway confirma** con `stored` o
//      `duplicate`. La v1 contaba cualquier 200, y un «0 guardados» pasaba por
//      subido;
//   3. **cada medio con su propio fallo**, y la lista paginada: un archivo que
//      falla no para los demas, y con mas de 500 no se queda nada sin mirar;
//   4. **lo que llega se comprueba antes de guardarse.** Un registro de otra
//      boveda entraria en el indice y haria fallar cada lectura posterior;
//   5. **un archivo demasiado grande no rompe la sincronizacion.** Se salta, se
//      cuenta y se sigue: perder el resto por un video de 200 MB seria peor;
//   6. los medios de una conversacion con un envio en curso SI viajan; los de
//      una conversacion borrada en este equipo, no;
//   7. antes de cada medio se mira que la boveda siga abierta;
//   8. **sin su conversacion en el servidor, ni un byte.** El medio espera y se
//      cuenta como tal; subir antes los bytes dejaba objetos huerfanos que
//      ninguna purga alcanza (GW-F1-02).
//
// Nada de lo que viaja se descifra aqui. Los bytes salen y entran tal cual.
import {
  VAULT_SYNC_V2_PATHS,
  redact,
  vaultV2MediaListResponseSchema,
  vaultV2MediaPushRejectedResponseSchema,
  vaultV2MediaPushRequestSchema,
  vaultV2MediaPushResponseSchema,
  vaultV2NextCursor,
  type PrivateMedia,
  type VaultSyncV2Limits,
  type VaultV2RemoteMedia,
} from '@luxy/shared';
import type { VaultSyncMediaReport } from '../../shared/ipc.js';
import { VaultError, type VaultService } from './vault-service.js';
import type { PrivateMediaStore } from './media-store.js';
import { SyncFailure, invalidReply, lockedFailure, type SyncHttp } from './sync-http.js';

/** fallos de red seguidos que paran la pasada */
const TRANSPORT_STREAK_LIMIT = 2;

export interface MediaSyncContext {
  vault: VaultService;
  media: PrivateMediaStore;
  http: SyncHttp;
  limits: VaultSyncV2Limits;
  /** borradas en este equipo al empezar la pasada: lo suyo ni sube ni baja */
  deleted: ReadonlySet<string>;
  /** solo estas conversaciones; `null` es todas */
  scope: ReadonlySet<string> | null;
  /** la misma comprobacion, leida del disco justo antes de escribir */
  isDeleted: (conversationId: string) => boolean;
  /** solo un borrado en curso: un envio en curso no frena sus medios */
  isBusy: (conversationId: string) => boolean;
  /**
   * la conversacion ya esta en el servidor. Se mira ANTES de subir los bytes:
   * el alta de un medio exige su conversacion, y sin ella los bytes subian, el
   * alta respondia «conversation-missing» y quedaban en Storage sin fila que
   * los nombre, asi que ninguna purga los alcanzaba. Una conversacion que no
   * llega a subir nunca (turnos repetidos aqui, ninguno que pueda viajar)
   * repetia esa subida inutil en cada pasada (GW-F1-02).
   */
  onServer: (conversationId: string) => Promise<boolean>;
  hold: <T>(conversationId: string, task: () => Promise<T>) => Promise<T>;
  report: VaultSyncMediaReport;
}

export function emptyMediaReport(): VaultSyncMediaReport {
  return {
    reached: false,
    uploaded: 0,
    downloaded: 0,
    alreadyThere: 0,
    skipped: 0,
    waiting: 0,
    failed: 0,
    unopenable: 0,
    notUploadable: 0,
    error: null,
  };
}

/** la pasada entera se para; la recoge `sync.ts` */
export class MediaStoreMissing extends Error {
  constructor() {
    super('media-store-missing');
    this.name = 'MediaStoreMissing';
  }
}

function inScope(ctx: MediaSyncContext, conversationId: string): boolean {
  const id = conversationId.toLowerCase();
  if (ctx.deleted.has(id)) return false;
  return ctx.scope === null || ctx.scope.has(id);
}

async function listRemote(ctx: MediaSyncContext): Promise<VaultV2RemoteMedia[]> {
  const limit = ctx.limits.mediaMaxPage;
  const all: VaultV2RemoteMedia[] = [];
  let after: string | null = null;
  for (;;) {
    const reply = await ctx.http.json('POST', VAULT_SYNC_V2_PATHS.mediaList, { after, limit });
    const page = vaultV2MediaListResponseSchema.safeParse(reply.body);
    if (!page.success) throw invalidReply('en la lista de medios');
    all.push(...page.data);
    // se acaba con la pagina vacia: una corta puede ser el recorte de PostgREST
    const next = vaultV2NextCursor(page.data, (entry) => entry.mediaId);
    if (next === null) return all;
    if (after !== null && next <= after) throw invalidReply('en la lista de medios');
    after = next;
  }
}

/**
 * sube lo que este equipo tiene y baja lo que le falta.
 *
 * La identidad de un medio es su `mediaId` y su clave de objeto, aleatorias y
 * no derivadas del contenido: dos equipos no generan la misma por accidente,
 * asi que basta con unir lo de los dos lados.
 */
export async function syncMedia(ctx: MediaSyncContext): Promise<void> {
  const report = ctx.report;
  report.reached = true;
  const remote = await listRemote(ctx);
  const remoteIds = new Set(remote.map((entry) => entry.mediaId.toLowerCase()));
  const remoteKeys = new Set(remote.map((entry) => entry.objectKey));

  const localIds = new Set<string>();
  const localKeys = new Set<string>();
  const toUpload: PrivateMedia[] = [];
  for (const conversationId of ctx.media.listConversationIds()) {
    for (const record of ctx.media.rawRecords(conversationId)) {
      localIds.add(record.mediaId.toLowerCase());
      localKeys.add(record.objectKey);
      if (!inScope(ctx, conversationId)) continue;
      if (remoteIds.has(record.mediaId.toLowerCase()) || remoteKeys.has(record.objectKey)) continue;
      toUpload.push(record);
    }
  }

  let streak = 0;
  const guard = async (task: () => Promise<void>): Promise<void> => {
    if (!ctx.vault.isUnlocked() || ctx.http.aborted) throw lockedFailure();
    try {
      await task();
      streak = 0;
    } catch (error) {
      if (!ctx.vault.isUnlocked()) throw lockedFailure();
      if (error instanceof SyncFailure) {
        if (error.kind === 'locked' || error.kind === 'session') throw error;
        if (error.kind === 'http' && error.status === 503) throw new MediaStoreMissing();
        if (error.kind === 'transport') {
          streak += 1;
          if (streak >= TRANSPORT_STREAK_LIMIT) throw error;
        }
      }
      report.failed += 1;
      // solo los motivos de Luxy: uno del sistema trae rutas de este equipo
      report.error ??=
        error instanceof VaultError
          ? redact(error.message)
          : 'fallo inesperado leyendo o escribiendo un archivo en este equipo';
    }
  };

  // 1. subir lo propio que alli no esta. Una conversacion que se esta borrando
  // —o que se borro despues de hacer la lista— se salta: sus archivos ya no
  // estan, y eso no es un fallo
  for (const record of toUpload) {
    if (ctx.isBusy(record.conversationId) || ctx.isDeleted(record.conversationId)) continue;
    await guard(async () => {
      // sin su conversacion alli, espera sin gastar la subida: el alta la
      // rechazaria despues de los bytes y estos se quedarian huerfanos
      if (!(await ctx.onServer(record.conversationId))) {
        ctx.report.waiting += 1;
        return;
      }
      await uploadOne(ctx, record);
    });
  }

  // 2. bajar lo que aqui no esta
  for (const entry of remote) {
    if (localIds.has(entry.mediaId.toLowerCase()) || localKeys.has(entry.objectKey)) continue;
    if (!inScope(ctx, entry.conversationId)) continue;
    await guard(() => ctx.hold(entry.conversationId, () => downloadOne(ctx, entry)));
  }
}

/** los bytes cifrados de un objeto de este equipo; si faltan, se dice sin la ruta */
async function readBlob(ctx: MediaSyncContext, objectKey: string): Promise<Uint8Array> {
  try {
    return await ctx.media.rawBlob(objectKey);
  } catch {
    throw new VaultError(
      'falta en este equipo el archivo cifrado de un medio',
      'ese medio no puede subir; los demas siguen',
    );
  }
}

async function uploadOne(ctx: MediaSyncContext, record: PrivateMedia): Promise<void> {
  const report = ctx.report;
  if (record.byteSize > ctx.limits.objectMaxBytes) {
    // saltarlo y seguir: perder el resto por un archivo enorme seria peor
    report.skipped += 1;
    return;
  }
  // la forma exacta del contrato antes de gastar una subida de bytes
  const request = vaultV2MediaPushRequestSchema.safeParse({ media: record });
  if (!request.success) {
    report.notUploadable += 1;
    return;
  }

  try {
    await ctx.http.putObject(record.objectKey, await readBlob(ctx, record.objectKey));
    if (record.thumbnailObjectKey !== null) {
      await ctx.http.putObject(record.thumbnailObjectKey, await readBlob(ctx, record.thumbnailObjectKey));
    }
  } catch (error) {
    if (error instanceof SyncFailure && error.kind === 'http' && error.status === 413) {
      report.skipped += 1;
      return;
    }
    throw error;
  }

  // el registro DESPUES de sus bytes: el gateway lo rechaza si no estan, y asi
  // el otro equipo nunca ve un archivo que no puede abrir
  const reply = await ctx.http.json('POST', VAULT_SYNC_V2_PATHS.mediaPush, request.data, [
    200, 404, 409, 413,
  ]);
  if (reply.status === 200) {
    const parsed = vaultV2MediaPushResponseSchema.safeParse(reply.body);
    if (!parsed.success) throw invalidReply('al subir un medio');
    if (parsed.data.outcome === 'stored') report.uploaded += 1;
    else report.alreadyThere += 1;
    return;
  }
  if (reply.status === 413) {
    report.skipped += 1;
    return;
  }
  if (reply.status === 404) {
    report.failed += 1;
    report.error ??= 'el servidor dice que la conversacion de un medio es de otra cuenta';
    return;
  }
  const rejected = vaultV2MediaPushRejectedResponseSchema.safeParse(reply.body);
  if (!rejected.success) throw invalidReply('al subir un medio');
  switch (rejected.data.reason) {
    case 'conversation-missing':
      // sus turnos aun no estan alli (se saltaron, fallaron o estan congelados):
      // va cuando suban
      report.waiting += 1;
      return;
    case 'object-missing':
      report.failed += 1;
      report.error ??= 'el servidor no encuentra los bytes de un medio recien subidos';
      return;
    case 'conflict':
      report.failed += 1;
      report.error ??= 'la clave de un medio ya la usa otro en el servidor';
      return;
    case 'space':
      report.failed += 1;
      report.error ??= 'el servidor guarda otra cosa con el identificador de una conversacion';
      return;
  }
}

async function downloadOne(ctx: MediaSyncContext, entry: VaultV2RemoteMedia): Promise<void> {
  const report = ctx.report;
  // con un borrado de esa conversacion en marcha, lo que bajara la resucitaria
  if (ctx.isBusy(entry.conversationId)) return;

  const blob = await ctx.http.getObject(entry.objectKey);
  const thumbnail =
    entry.thumbnailObjectKey === null ? null : await ctx.http.getObject(entry.thumbnailObjectKey);

  if (!ctx.vault.isUnlocked() || ctx.http.aborted) throw lockedFailure();
  if (ctx.isBusy(entry.conversationId) || ctx.isDeleted(entry.conversationId)) return;

  const record: PrivateMedia = {
    mediaId: entry.mediaId,
    conversationId: entry.conversationId,
    objectKey: entry.objectKey,
    byteSize: entry.byteSize,
    content: entry.content,
    thumbnailObjectKey: entry.thumbnailObjectKey,
    createdAt: entry.createdAt,
  };
  try {
    await ctx.media.acceptRemote(ctx.vault, record, blob, thumbnail);
  } catch {
    if (!ctx.vault.isUnlocked()) throw lockedFailure();
    // no se abre con esta boveda: no entra en el indice. Un registro ilegible
    // envenenaria cada lectura futura
    report.unopenable += 1;
    return;
  }
  report.downloaded += 1;
}
