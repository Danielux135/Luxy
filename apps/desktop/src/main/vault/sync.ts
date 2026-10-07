// sincronizacion de la boveda entre equipos, protocolo v2 (`SYNC-F1-06`, `D-110`).
//
// Sube lo que este equipo tiene y no esta en el servidor, y baja lo contrario.
// Todo lo que viaja va ya cifrado: este modulo no descifra nada salvo para
// comprobar que puede ABRIR lo que llega antes de guardarlo.
//
// Se autentica con la SESION DE LA CUENTA, no con el token de maquina: el
// gateway decide de quien es cada registro por el usuario de esa sesion
// (`D-045`, `D-046`).
//
// Por que se reescribio entera. La v1 nunca funciono (SEG-SYNC-001): exigia
// fechas en «Z» y Postgres las devuelve con «+00:00»; tomaba un 409 tragado por
// «0 guardados» y desde la segunda vez no subia nada sin avisar; bajaba 200 de
// cada conversacion y no pedia mas; un fallo en una conversacion lo abortaba
// todo; y con la boveda cerrada a mitad descartaba en silencio lo que bajaba.
//
// Las reglas de esta version, que ordenan el resto:
//
//   1. **Nada remoto pisa nada local sin una regla escrita.** Un turno es
//      inmutable y su identidad es (conversacion, secuencia, recordId). Si la
//      misma secuencia tiene un registro distinto a cada lado, la conversacion
//      esta «en dos versiones» y se CONGELA: ni sube ni baja, no se borra nada
//      de ningun lado y se dice. Separarla es de F3.
//   2. **El manifiesto entero en cada pasada.** No se fia de ningun «hasta aqui»
//      guardado: se compara (secuencia, recordId) de los dos lados. Si el
//      servidor tiene menos turnos de los que ya se le subieron, se avisa y se
//      vuelven a subir.
//   3. **Primero bajar, despues subir**, por lotes y con base: el servidor
//      inserta el lote entero o nada, y solo si su ultimo turno anterior al
//      lote es el que este equipo cree. Lo bajado se abre antes de guardarse.
//   4. **Cada conversacion y cada medio con su propio fallo.** Un 500 en una no
//      para las demas. La sesion caducada, la red caida (dos seguidas) o la
//      boveda cerrada si paran la pasada, y entonces no se da nada por bueno.
//   5. **Trabajo de fondo** (`D-106`): no hay espera del usuario ni `touch()`.
//      Si la boveda se cierra, se para y lo dice.
//   6. **Lo ocupado no se toca**: una conversacion con un envio, un borrado, un
//      cambio de dueño o «borrar su memoria» en curso se salta, y se vuelve a
//      mirar en el mismo bloque sincrono que escribe. Sus MEDIOS si viajan.
import {
  VAULT_FACT_SEQUENCE_BASE,
  VAULT_SYNC_V2_LIMITS,
  VAULT_SYNC_V2_PATHS,
  redact,
  vaultSyncV2CapabilitiesSchema,
  vaultV2ConversationListResponseSchema,
  vaultV2ManifestResponseSchema,
  vaultV2NextCursor,
  vaultV2PushRecordSchema,
  vaultV2PushRejectedResponseSchema,
  vaultV2PushStoredResponseSchema,
  vaultV2RecordsFetchResponseSchema,
  type PrivateRecord,
  type VaultSyncV2Limits,
  type VaultV2ManifestEntry,
  type VaultV2PushRecord,
  type VaultV2RecordRef,
} from '@luxy/shared';
import type {
  VaultSyncConversationReport,
  VaultSyncResult,
  VaultSyncScope,
  VaultSyncStopReason,
} from '../../shared/ipc.js';
import { VaultError, type VaultService } from './vault-service.js';
import { RemoteAppendError, type PrivateConversationStore } from './conversation-store.js';
import type { PrivateMediaStore } from './media-store.js';
import type { SyncDeletedStore } from './sync-deleted-store.js';
import type { SyncConversationState, SyncRole, SyncState, SyncStateStore } from './sync-state-store.js';
import { effectiveSyncRole, type SyncAnchorRead, type SyncAnchorStore } from './sync-anchor-store.js';
import {
  SyncFailure,
  SyncHttp,
  invalidReply,
  lockedFailure,
  type SyncHttpOptions,
} from './sync-http.js';
import { MediaStoreMissing, emptyMediaReport, syncMedia } from './media-sync.js';

export type { VaultSyncResult, VaultSyncScope };

/** que parte de una conversacion se va a tocar: sus turnos o sus medios */
export type SyncPart = 'turns' | 'media';

export interface VaultSyncStores {
  conversations: PrivateConversationStore;
  /**
   * almacen de medios. Opcional a proposito: sincronizar turnos no depende de
   * tener medios, y quien solo quiera probar la parte de texto no deberia
   * arrastrar el almacen de objetos.
   */
  media?: PrivateMediaStore;
  state: SyncStateStore;
  deleted: SyncDeletedStore;
  /** el papel de este equipo fuera del estado sellado: una replica no se rebaja */
  anchor: SyncAnchorStore;
}

export interface VaultSyncDeps extends SyncHttpOptions {
  /** la caducidad de la sesion, ya renovada por el gateway (`capabilities`) */
  onSessionRenewed?: (expiresAt: string) => void;
  /**
   * la conversacion esta ocupada para esa parte.
   *
   * Para los turnos: un envio, un borrado, un cambio de dueño o «borrar su
   * memoria». Para los medios solo el borrado: los de una conversacion con un
   * envio en curso SI viajan (revision del 28/09).
   */
  isBusy?: (conversationId: string, part: SyncPart) => boolean;
  /**
   * marca la conversacion mientras se toca. Quien la borra, borra su memoria o
   * le cambia el dueño espera a que se suelte.
   */
  hold?: <T>(conversationId: string, task: () => Promise<T>) => Promise<T>;
  /** se ha escrito algo bajado en esa conversacion: lo que este en memoria ya no vale */
  onDownloaded?: (conversationId: string) => void;
  /** cuantas secuencias se piden por llamada; los turnos grandes piden menos */
  fetchChunk?: number;
  /** registro de una linea: solo cifras, nunca ids ni contenido */
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

/** cuantas secuencias se bajan por llamada. Con turnos de hasta 4 MiB, 100 seria mucho */
const DEFAULT_FETCH_CHUNK = 50;
/** vueltas por conversacion cuando el servidor cambia entre el manifiesto y la subida */
const MAX_ROUNDS = 3;
/** fallos de red seguidos que paran la pasada: con la red caida, cada uno tarda 30 s */
const TRANSPORT_STREAK_LIMIT = 2;

/** la pasada entera se para por esto */
export class PassStop extends Error {
  constructor(
    readonly reason: VaultSyncStopReason,
    readonly detail: string | null = null,
  ) {
    super(reason);
    this.name = 'PassStop';
  }
}

interface PassContext {
  vault: VaultService;
  stores: VaultSyncStores;
  deps: VaultSyncDeps;
  http: SyncHttp;
  limits: VaultSyncV2Limits;
  state: SyncState;
  transportStreak: number;
}

/**
 * sincroniza todo, o solo las conversaciones pedidas.
 *
 * Nunca lanza por algo que pase a mitad: el resultado dice que se hizo, que
 * no, y por que se paro si se paro (`D-093`). Solo lanza si no puede ni
 * empezar: la boveda ya estaba cerrada.
 */
export async function syncVault(
  vault: VaultService,
  stores: VaultSyncStores,
  deps: VaultSyncDeps,
  scope: VaultSyncScope = { mode: 'all' },
): Promise<VaultSyncResult> {
  if (!vault.isUnlocked()) {
    throw new VaultError(
      'la boveda esta bloqueada',
      'abrela para sincronizar: sin la llave no se puede comprobar lo que llega',
    );
  }

  const result: VaultSyncResult = {
    protocol: 2,
    scope: scope.mode,
    stopped: null,
    stoppedDetail: null,
    role: null,
    conversations: [],
    deletedStillOnServer: 0,
    uploaded: 0,
    downloaded: 0,
    media: emptyMediaReport(),
    finishedAt: new Date().toISOString(),
  };

  try {
    await runPass(vault, stores, deps, scope, result);
  } catch (error) {
    const stop = stopOf(vault, error);
    result.stopped = stop.reason;
    result.stoppedDetail = stop.detail;
  }

  // la hora de lo que se cuenta: «coincidia a esta hora», no «coincide»
  result.finishedAt = new Date().toISOString();
  result.uploaded = result.conversations.reduce((sum, entry) => sum + entry.uploaded, 0);
  result.downloaded = result.conversations.reduce((sum, entry) => sum + entry.downloaded, 0);

  // solo cifras: ni ids de conversacion ni nada de dentro
  deps.log?.('sincronizacion de la boveda', {
    alcance: scope.mode,
    conversaciones: result.conversations.length,
    subidos: result.uploaded,
    bajados: result.downloaded,
    congeladas: countStatus(result, 'frozen'),
    repetidas: countStatus(result, 'local-duplicates'),
    ocupadas: countStatus(result, 'busy'),
    fallidas: countStatus(result, 'failed'),
    mediosSubidos: result.media.uploaded,
    mediosBajados: result.media.downloaded,
    mediosFallidos: result.media.failed,
    parada: result.stopped,
  });
  return result;
}

function countStatus(result: VaultSyncResult, status: VaultSyncConversationReport['status']): number {
  return result.conversations.filter((entry) => entry.status === status).length;
}

/** por que se paro, a partir de lo que se lanzo */
function stopOf(vault: VaultService, error: unknown): { reason: VaultSyncStopReason; detail: string | null } {
  if (error instanceof PassStop) return { reason: error.reason, detail: error.detail };
  if (!vault.isUnlocked()) return { reason: 'locked', detail: null };
  if (error instanceof SyncFailure) {
    if (error.kind === 'locked') return { reason: 'locked', detail: null };
    if (error.kind === 'session') return { reason: 'session', detail: messageOf(error) };
    if (error.kind === 'transport') return { reason: 'unreachable', detail: messageOf(error) };
  }
  // un 5xx o una respuesta que no cumple donde la pasada no puede seguir sin
  // ella, o un fallo de este equipo (un archivo que no se lee)
  return { reason: 'server-error', detail: messageOf(error) };
}

/**
 * el motivo que puede enseñarse. Solo los errores de Luxy, que se escriben para
 * Daniel; uno del sistema —un `ENOENT`, un `EBUSY`— trae rutas del equipo, y
 * uno de validacion trae trozos de lo que no valido.
 */
function messageOf(error: unknown): string {
  if (error instanceof VaultError) return redact(error.message);
  return 'fallo inesperado leyendo o escribiendo en este equipo';
}

async function runPass(
  vault: VaultService,
  stores: VaultSyncStores,
  deps: VaultSyncDeps,
  scope: VaultSyncScope,
  result: VaultSyncResult,
): Promise<void> {
  const http = new SyncHttp(deps);

  // 1. capacidades: un gateway viejo responde 404 y no se escribe nada
  const limits = await capabilities(http, deps);

  // 2. lapidas: sin ellas volveria lo borrado, asi que si no se leen se para
  let deleted: Set<string>;
  try {
    deleted = stores.deleted.ids();
  } catch (error) {
    throw new PassStop('tombstones-unreadable', messageOf(error));
  }

  const ctx: PassContext = {
    vault,
    stores,
    deps,
    http,
    limits,
    state: await stores.state.read(vault),
    transportStreak: 0,
  };

  // 3. que conversaciones
  const localIds = new Map<string, string>();
  for (const id of stores.conversations.listConversationIds()) {
    if (!deleted.has(id.toLowerCase())) localIds.set(id.toLowerCase(), id);
  }
  let serverIds: Set<string> | null = null;
  let ids: string[];
  if (scope.mode === 'all') {
    serverIds = new Set<string>();
    for (const id of await listServerConversations(ctx)) {
      if (deleted.has(id)) result.deletedStillOnServer += 1;
      else serverIds.add(id);
    }
    const union = new Set<string>([...localIds.keys(), ...serverIds]);
    ids = [...union].sort().map((key) => localIds.get(key) ?? key);
  } else {
    const wanted = scope.conversationId.toLowerCase();
    ids = deleted.has(wanted) ? [] : [localIds.get(wanted) ?? wanted];
  }

  // 4. el papel de este equipo, en su primera pasada
  result.role = await decideRole(ctx, localIds.size, serverIds);

  // 5. turnos, conversacion a conversacion
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]!;
    if (!vault.isUnlocked() || http.aborted) {
      markNotReached(result, ids.slice(index));
      throw new PassStop('locked');
    }
    const serverKnown = serverIds === null ? true : serverIds.has(id.toLowerCase());
    const report = blankReport(id);
    result.conversations.push(report);
    try {
      await syncConversation(ctx, id, serverKnown, report);
      ctx.transportStreak = 0;
    } catch (error) {
      if (!vault.isUnlocked() || (error instanceof SyncFailure && error.kind === 'locked')) {
        report.status = 'interrupted';
        markNotReached(result, ids.slice(index + 1));
        throw new PassStop('locked');
      }
      report.status = 'failed';
      report.error = messageOf(error);
      if (error instanceof SyncFailure && error.kind === 'session') {
        markNotReached(result, ids.slice(index + 1));
        throw error;
      }
      if (error instanceof SyncFailure && error.kind === 'transport') {
        ctx.transportStreak += 1;
        if (ctx.transportStreak >= TRANSPORT_STREAK_LIMIT) {
          markNotReached(result, ids.slice(index + 1));
          throw error;
        }
      } else {
        ctx.transportStreak = 0;
      }
    }
  }

  // 6. medios: despues de los turnos, porque el alta de un medio exige que su
  // conversacion ya este en el servidor
  if (stores.media !== undefined) {
    try {
      await syncMedia({
        vault,
        media: stores.media,
        http,
        limits,
        deleted,
        scope: scope.mode === 'all' ? null : new Set([scope.conversationId.toLowerCase()]),
        isDeleted: (id) => stores.deleted.has(id),
        isBusy: (id) => deps.isBusy?.(id, 'media') === true,
        hold: deps.hold ?? ((_id, task) => task()),
        onServer: serverPresence(ctx, serverIds, result),
        report: result.media,
      });
    } catch (error) {
      if (error instanceof MediaStoreMissing) {
        throw new PassStop(
          'media-store-missing',
          'falta crear el almacen de medios en Supabase; los turnos si se han sincronizado',
        );
      }
      if (!vault.isUnlocked()) throw lockedFailure();
      if (
        error instanceof SyncFailure &&
        (error.kind === 'locked' || error.kind === 'session' || error.kind === 'transport')
      ) {
        throw error;
      }
      // la lista de medios fallo: los turnos ya estan, y esto se dice aparte
      result.media.error = messageOf(error);
    }
  }
}

/**
 * que conversaciones estan ya en el servidor, para no subir los bytes de un
 * medio cuya alta se va a rechazar (GW-F1-02).
 *
 * Sale de lo que la pasada ya sabe: la lista del servidor (en «todo») y las que
 * la fase de turnos encontro alli o creo. Con «solo esta conversacion» no hay
 * lista; si hace falta, se pide UNA vez y solo entonces.
 */
function serverPresence(
  ctx: PassContext,
  serverIds: ReadonlySet<string> | null,
  result: VaultSyncResult,
): (conversationId: string) => Promise<boolean> {
  const present = new Set<string>(serverIds ?? []);
  for (const entry of result.conversations) {
    if (entry.server !== null && entry.server > 0) present.add(entry.conversationId.toLowerCase());
  }
  let listing: Promise<void> | null = null;
  return async (conversationId) => {
    const key = conversationId.toLowerCase();
    if (present.has(key)) return true;
    if (serverIds === null) {
      listing ??= listServerConversations(ctx).then((ids) => {
        for (const id of ids) present.add(id.toLowerCase());
      });
      await listing;
    }
    return present.has(key);
  };
}

async function capabilities(http: SyncHttp, deps: VaultSyncDeps): Promise<VaultSyncV2Limits> {
  let reply;
  try {
    reply = await http.json('GET', VAULT_SYNC_V2_PATHS.capabilities, undefined);
  } catch (error) {
    if (error instanceof SyncFailure && error.kind === 'http' && error.status === 404) {
      throw new PassStop(
        'gateway-outdated',
        'el servidor todavia no tiene la sincronizacion nueva: hay que actualizarlo antes de sincronizar',
      );
    }
    throw error;
  }
  const parsed = vaultSyncV2CapabilitiesSchema.safeParse(reply.body);
  if (!parsed.success) {
    throw new PassStop(
      'gateway-protocol',
      'el servidor habla una version de la sincronizacion que este Studio no conoce',
    );
  }
  deps.onSessionRenewed?.(parsed.data.sessionExpiresAt);
  // los topes mas estrictos de los dos: ni este Studio ni el servidor se pasan
  const theirs = parsed.data.limits;
  const ours = VAULT_SYNC_V2_LIMITS;
  return {
    pushMaxRecords: Math.min(ours.pushMaxRecords, theirs.pushMaxRecords),
    pushMaxBytes: Math.min(ours.pushMaxBytes, theirs.pushMaxBytes),
    pushSingleRecordMaxBytes: Math.min(ours.pushSingleRecordMaxBytes, theirs.pushSingleRecordMaxBytes),
    fetchMaxSequences: Math.min(ours.fetchMaxSequences, theirs.fetchMaxSequences),
    manifestMaxPage: Math.min(ours.manifestMaxPage, theirs.manifestMaxPage),
    conversationsMaxPage: Math.min(ours.conversationsMaxPage, theirs.conversationsMaxPage),
    mediaMaxPage: Math.min(ours.mediaMaxPage, theirs.mediaMaxPage),
    mediaPushMaxBytes: Math.min(ours.mediaPushMaxBytes, theirs.mediaPushMaxBytes),
    smallRequestMaxBytes: Math.min(ours.smallRequestMaxBytes, theirs.smallRequestMaxBytes),
    purgeBatchMedia: Math.min(ours.purgeBatchMedia, theirs.purgeBatchMedia),
    objectMaxBytes: Math.min(ours.objectMaxBytes, theirs.objectMaxBytes),
  };
}

async function listServerConversations(ctx: PassContext): Promise<string[]> {
  const limit = ctx.limits.conversationsMaxPage;
  const ids: string[] = [];
  let after: string | null = null;
  for (;;) {
    const reply = await ctx.http.json('POST', VAULT_SYNC_V2_PATHS.conversationsList, { after, limit });
    const page = vaultV2ConversationListResponseSchema.safeParse(reply.body);
    if (!page.success) throw invalidReply('en la lista de conversaciones');
    ids.push(...page.data.map((entry) => entry.conversationId));
    // se acaba con la pagina vacia: una corta puede ser el recorte de PostgREST
    const next = vaultV2NextCursor(page.data, (entry) => entry.conversationId);
    if (next === null) return ids;
    // una pagina que no avanza seria un bucle sin fin
    if (after !== null && next <= after) throw invalidReply('en la lista de conversaciones');
    after = next;
  }
}

/**
 * el papel de este equipo, decidido UNA vez y apuntado en dos sitios.
 *
 * Primero lo que ya se sabe: el estado sellado y el ancla sin sellar
 * (`sync-anchor-store.ts`). Un equipo que entro en la cuenta con la carpeta
 * vacia llega aqui ya apuntado como replica, tenga lo que tenga en local; y una
 * replica no se rebaja nunca, aunque el estado sellado se haya perdido.
 *
 * Si nadie sabe nada —el ordenador de siempre, o uno que entro en la cuenta con
 * un Studio anterior a F1—: replica si se estrena sin nada propio y el servidor
 * ya tiene algo; origen si tiene conversaciones propias. No se usa «el servidor
 * tiene alguna que aqui no esta», que es la regla literal del diseño: la v1
 * llego a subir conversaciones que despues se borraron aqui, y con esa regla el
 * ordenador de siempre quedaria como replica y Privado dejaria de enviar.
 *
 * El ancla se escribe ANTES que el estado: es la que sobrevive si el estado
 * sellado no se puede leer. Si no se puede escribir, la pasada se para.
 */
async function decideRole(
  ctx: PassContext,
  localCount: number,
  serverIds: Set<string> | null,
): Promise<SyncRole | null> {
  const anchor = readAnchor(ctx.stores.anchor);
  let role = effectiveSyncRole(ctx.state.role, anchor);
  if (role === null) {
    if (localCount > 0) role = 'origin';
    else if (serverIds !== null && serverIds.size > 0) role = 'replica';
  }
  if (role === null) return null;
  const decided = role;
  if (!(anchor.kind === 'role' && anchor.role === decided)) {
    ctx.stores.anchor.record(decided, 'sync-pass');
  }
  if (ctx.state.role !== decided) {
    ctx.state = await ctx.stores.state.update(ctx.vault, (current) =>
      current.role === 'replica' ? current : { ...current, role: decided },
    );
  }
  return effectiveSyncRole(ctx.state.role, readAnchor(ctx.stores.anchor));
}

/** el ancla; un fallo al leerla cuenta como ilegible, que es lo prudente */
function readAnchor(anchor: SyncAnchorStore): SyncAnchorRead {
  try {
    return anchor.read();
  } catch {
    return { kind: 'unreadable' };
  }
}

function blankReport(conversationId: string): VaultSyncConversationReport {
  return {
    conversationId,
    status: 'not-reached',
    local: 0,
    server: null,
    uploaded: 0,
    downloaded: 0,
    unreadable: 0,
    duplicateSequences: 0,
    serverLost: 0,
    notUploadable: 0,
    unopenable: 0,
    error: null,
  };
}

function markNotReached(result: VaultSyncResult, ids: readonly string[]): void {
  for (const id of ids) {
    const report = blankReport(id);
    result.conversations.push(report);
  }
}

function busy(ctx: PassContext, conversationId: string): boolean {
  return ctx.deps.isBusy?.(conversationId, 'turns') === true;
}

async function syncConversation(
  ctx: PassContext,
  conversationId: string,
  serverKnown: boolean,
  report: VaultSyncConversationReport,
): Promise<void> {
  const view = ctx.stores.conversations.syncView(conversationId);
  fillLocal(report, view);

  // congelada: hasta F3 no sube ni baja nada de ella
  if (ctx.state.conversations[conversationId]?.frozen === true) {
    report.status = 'frozen';
    return;
  }
  // secuencias repetidas aqui: no se sube sin decidir cual vale
  if (view.integrity.duplicateSequences > 0) {
    report.status = 'local-duplicates';
    return;
  }

  const hold = ctx.deps.hold ?? (<T>(_id: string, task: () => Promise<T>) => task());
  await hold(conversationId, async () => {
    if (busy(ctx, conversationId)) {
      report.status = 'busy';
      return;
    }
    let askServer = serverKnown;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const outcome = await syncRound(ctx, conversationId, report, askServer, round === 0);
      if (outcome === 'done') return;
      // el servidor cambio desde el manifiesto: se vuelve a pedir
      askServer = true;
    }
    report.status = 'failed';
    report.error = 'el servidor cambio varias veces mientras se sincronizaba; vuelve a intentarlo';
  });
}

function fillLocal(
  report: VaultSyncConversationReport,
  view: ReturnType<PrivateConversationStore['syncView']>,
): void {
  report.local = view.records.length;
  report.unreadable = view.integrity.unreadable;
  report.duplicateSequences = view.integrity.duplicateSequences;
}

async function syncRound(
  ctx: PassContext,
  conversationId: string,
  report: VaultSyncConversationReport,
  askServer: boolean,
  firstRound: boolean,
): Promise<'done' | 'retry'> {
  const manifest = askServer ? await fetchManifest(ctx, conversationId) : [];
  report.server = manifest.length;

  let view = ctx.stores.conversations.syncView(conversationId);
  fillLocal(report, view);
  if (view.integrity.duplicateSequences > 0) {
    report.status = 'local-duplicates';
    return 'done';
  }
  if (twoVersions(view.records, manifest)) {
    await freeze(ctx, conversationId, report);
    return 'done';
  }

  // el servidor tuvo mas de lo que tiene: se avisa, y lo que falte se vuelve a
  // subir mas abajo, como cualquier otro turno que alli no esta
  if (firstRound) {
    const known = ctx.state.conversations[conversationId]?.uploaded ?? 0;
    if (manifest.length < known) report.serverLost = known - manifest.length;
  }

  const server = new Map<number, string>(
    manifest.map((entry) => [entry.sequence, entry.recordId.toLowerCase()]),
  );

  // primero bajar
  const local = new Set(view.records.map((record) => record.sequence));
  const missing = manifest.filter((entry) => !local.has(entry.sequence));
  if (!(await download(ctx, conversationId, report, missing))) return 'done';

  // despues subir, sobre lo que hay ya en disco
  view = ctx.stores.conversations.syncView(conversationId);
  fillLocal(report, view);
  return upload(ctx, conversationId, report, view.records, server);
}

async function fetchManifest(ctx: PassContext, conversationId: string): Promise<VaultV2ManifestEntry[]> {
  const limit = ctx.limits.manifestMaxPage;
  const entries: VaultV2ManifestEntry[] = [];
  let after = -1;
  for (;;) {
    const reply = await ctx.http.json('POST', VAULT_SYNC_V2_PATHS.manifest, {
      conversationId,
      after,
      limit,
    });
    const page = vaultV2ManifestResponseSchema.safeParse(reply.body);
    if (!page.success) throw invalidReply('en el manifiesto');
    for (const entry of page.data) {
      // ascendente y sin repetidos: si no, la comparacion no significaria nada.
      // Tambien impide un bucle: una pagina que no avanza no pasa de aqui
      if (entry.sequence <= after) throw invalidReply('en el manifiesto');
      after = entry.sequence;
      entries.push(entry);
    }
    // hasta la pagina VACIA. PostgREST recorta a su «Max rows» sin avisar, y
    // parar en la primera corta daba por entero un manifiesto a medias: una
    // copia «al dia» con turnos de menos, y el origen volviendo a subir lo que
    // no veia y avisando de un «el servidor perdio turnos» falso (F1-R1-02)
    if (vaultV2NextCursor(page.data, (entry) => entry.sequence) === null) return entries;
  }
}

/**
 * la misma secuencia con otro registro, o el mismo registro en otra secuencia.
 * Las dos cosas son una conversacion en dos versiones.
 */
function twoVersions(records: readonly PrivateRecord[], manifest: readonly VaultV2ManifestEntry[]): boolean {
  const bySequence = new Map(manifest.map((entry) => [entry.sequence, entry.recordId.toLowerCase()]));
  const byRecord = new Map(manifest.map((entry) => [entry.recordId.toLowerCase(), entry.sequence]));
  for (const record of records) {
    const recordId = record.recordId.toLowerCase();
    const there = bySequence.get(record.sequence);
    if (there !== undefined && there !== recordId) return true;
    const sequence = byRecord.get(recordId);
    if (sequence !== undefined && sequence !== record.sequence) return true;
  }
  return false;
}

async function freeze(
  ctx: PassContext,
  conversationId: string,
  report: VaultSyncConversationReport,
): Promise<void> {
  report.status = 'frozen';
  await persistConversation(ctx, conversationId, {
    frozen: true,
    uploaded: ctx.state.conversations[conversationId]?.uploaded ?? 0,
  });
}

async function persistConversation(
  ctx: PassContext,
  conversationId: string,
  entry: SyncConversationState,
): Promise<void> {
  ctx.state = await ctx.stores.state.update(ctx.vault, (current) => ({
    ...current,
    conversations: { ...current.conversations, [conversationId]: entry },
  }));
}

/**
 * baja lo que solo tiene el servidor, por tandas de secuencias concretas.
 *
 * Cada registro se abre ANTES de guardarse, y tiene que ser de esta
 * conversacion y el mismo que anuncio el manifiesto. El primero que falla
 * detiene la conversacion: lo anterior se guarda y lo de detras no, para no
 * dejar un hueco en medio. Devuelve si se puede seguir con la subida.
 */
async function download(
  ctx: PassContext,
  conversationId: string,
  report: VaultSyncConversationReport,
  missing: readonly VaultV2ManifestEntry[],
): Promise<boolean> {
  const chunk = Math.max(
    1,
    Math.min(ctx.deps.fetchChunk ?? DEFAULT_FETCH_CHUNK, ctx.limits.fetchMaxSequences),
  );
  for (let start = 0; start < missing.length; start += chunk) {
    const slice = missing.slice(start, start + chunk);
    const reply = await ctx.http.json('POST', VAULT_SYNC_V2_PATHS.recordsFetch, {
      conversationId,
      sequences: slice.map((entry) => entry.sequence),
    });
    const parsed = vaultV2RecordsFetchResponseSchema.safeParse(reply.body);
    if (!parsed.success) throw invalidReply('al bajar turnos');
    const bySequence = new Map(parsed.data.map((record) => [record.sequence, record]));

    const verified: PrivateRecord[] = [];
    let problem: string | null = null;
    for (const entry of slice) {
      const record = bySequence.get(entry.sequence);
      if (record === undefined) {
        problem = 'el servidor ya no tiene un turno que acababa de anunciar';
        break;
      }
      if (record.conversationId.toLowerCase() !== conversationId.toLowerCase()) {
        problem = 'el servidor ha devuelto un turno de otra conversacion; no se ha guardado';
        break;
      }
      if (record.recordId.toLowerCase() !== entry.recordId.toLowerCase()) {
        problem = 'el servidor ha cambiado un turno mientras se bajaba';
        break;
      }
      if (record.sequence >= VAULT_FACT_SEQUENCE_BASE) {
        problem = 'el servidor ha devuelto un registro fuera del rango de los turnos';
        break;
      }
      try {
        await ctx.stores.conversations.verifyRecord(ctx.vault, record);
      } catch {
        if (!ctx.vault.isUnlocked()) throw lockedFailure();
        report.unopenable += 1;
        problem = 'un turno del servidor no se puede abrir con esta boveda; no se ha guardado';
        break;
      }
      verified.push(record);
    }

    if (!(await write(ctx, conversationId, report, verified))) return false;
    if (problem !== null) {
      report.status = 'failed';
      report.error = problem;
      return false;
    }
  }
  return true;
}

/**
 * escribe lo bajado.
 *
 * De la comprobacion a la escritura no hay ningun `await`: nadie puede empezar
 * un envio ni un borrado entre medias. O el envio aun no ha leido el archivo y
 * vera estos registros, o ya esta en marcha y esto no escribe.
 */
async function write(
  ctx: PassContext,
  conversationId: string,
  report: VaultSyncConversationReport,
  verified: readonly PrivateRecord[],
): Promise<boolean> {
  if (verified.length === 0) return true;
  if (!ctx.vault.isUnlocked() || ctx.http.aborted) throw lockedFailure();
  if (busy(ctx, conversationId) || ctx.stores.deleted.has(conversationId)) {
    report.status = 'busy';
    return false;
  }
  let written: number;
  try {
    written = ctx.stores.conversations.appendRemote(conversationId, verified);
  } catch (error) {
    if (error instanceof RemoteAppendError && error.reason === 'occupied') {
      // aqui se escribio esa secuencia con otro registro: dos versiones. Lo de
      // disco no se toca
      await freeze(ctx, conversationId, report);
      return false;
    }
    throw error;
  }
  report.downloaded += written;
  ctx.deps.onDownloaded?.(conversationId);
  return true;
}

/** el ultimo turno del servidor anterior a esa secuencia, o null si no hay */
function baseFor(server: ReadonlyMap<number, string>, sequence: number): VaultV2RecordRef | null {
  let best: VaultV2RecordRef | null = null;
  for (const [candidate, recordId] of server) {
    if (candidate < sequence && (best === null || candidate > best.sequence)) {
      best = { sequence: candidate, recordId };
    }
  }
  return best;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * reparte lo que hay que subir en lotes que el gateway acepta: como mucho 40
 * registros y 512 KiB, o un registro suelto de hasta 4 MiB. Uno mas grande no
 * puede viajar y se cuenta aparte.
 */
function planBatches(
  conversationId: string,
  records: readonly VaultV2PushRecord[],
  limits: VaultSyncV2Limits,
): { batches: VaultV2PushRecord[][]; tooLarge: number } {
  const overhead = byteLength(
    JSON.stringify({
      conversationId,
      base: { sequence: VAULT_FACT_SEQUENCE_BASE - 1, recordId: conversationId },
      records: [],
    }),
  );
  const batches: VaultV2PushRecord[][] = [];
  let tooLarge = 0;
  let current: VaultV2PushRecord[] = [];
  let currentBytes = overhead;
  for (const record of records) {
    const size = byteLength(JSON.stringify(record)) + 1;
    if (overhead + size > limits.pushSingleRecordMaxBytes) {
      tooLarge += 1;
      continue;
    }
    if (
      current.length > 0 &&
      (current.length >= limits.pushMaxRecords || currentBytes + size > limits.pushMaxBytes)
    ) {
      batches.push(current);
      current = [];
      currentBytes = overhead;
    }
    current.push(record);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);
  return { batches, tooLarge };
}

/**
 * sube lo que solo hay aqui, por lotes y con base.
 *
 * `server` es lo que el servidor tiene segun el manifiesto, y crece con cada
 * lote que entra. Devuelve `retry` si el servidor cambio y hay que releer el
 * manifiesto antes de seguir.
 */
async function upload(
  ctx: PassContext,
  conversationId: string,
  report: VaultSyncConversationReport,
  records: readonly PrivateRecord[],
  server: Map<number, string>,
): Promise<'done' | 'retry'> {
  const ready: VaultV2PushRecord[] = [];
  for (const record of records) {
    if (server.has(record.sequence)) continue;
    // la forma exacta del contrato: fecha canonica, uuid en minusculas y los
    // propositos de turno. Lo que no la cumple no puede viajar, y se dice
    const parsed = vaultV2PushRecordSchema.safeParse(record);
    if (parsed.success) ready.push(parsed.data);
    else report.notUploadable += 1;
  }

  const { batches, tooLarge } = planBatches(conversationId, ready, ctx.limits);
  report.notUploadable += tooLarge;

  const queue = [...batches];
  while (queue.length > 0) {
    const batch = queue.shift()!;
    if (!ctx.vault.isUnlocked() || ctx.http.aborted) throw lockedFailure();
    if (busy(ctx, conversationId)) {
      report.status = 'busy';
      report.server = server.size;
      return 'done';
    }

    const reply = await ctx.http.json(
      'POST',
      VAULT_SYNC_V2_PATHS.recordsPush,
      { conversationId, base: baseFor(server, batch[0]!.sequence), records: batch },
      [200, 404, 409, 413],
    );

    if (reply.status === 200) {
      if (!vaultV2PushStoredResponseSchema.safeParse(reply.body).success) {
        throw invalidReply('al subir turnos');
      }
      for (const record of batch) server.set(record.sequence, record.recordId.toLowerCase());
      report.uploaded += batch.length;
      report.server = server.size;
      continue;
    }
    if (reply.status === 413) {
      // el calculo de bytes se quedo corto: en dos mitades, y uno solo que no
      // cabe ni asi no puede viajar
      if (batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        queue.unshift(batch.slice(0, half), batch.slice(half));
      } else {
        report.notUploadable += 1;
      }
      continue;
    }
    if (reply.status === 404) {
      report.status = 'failed';
      report.error = 'el servidor dice que esta conversacion es de otra cuenta; no se ha subido nada';
      return 'done';
    }

    const rejected = vaultV2PushRejectedResponseSchema.safeParse(reply.body);
    if (!rejected.success) throw invalidReply('al subir turnos');
    switch (rejected.data.reason) {
      case 'records': {
        let retry = false;
        for (const item of rejected.data.results) {
          if (item.outcome === 'conflict') {
            await freeze(ctx, conversationId, report);
            report.server = server.size;
            return 'done';
          }
          // ya estaba igual: cuenta como copiado, no como subido
          if (item.outcome === 'duplicate') server.set(item.sequence, item.recordId.toLowerCase());
          if (item.outcome === 'pending') retry = true;
        }
        if (retry) return 'retry';
        report.server = server.size;
        continue;
      }
      case 'base-mismatch':
        return 'retry';
      case 'conversation-missing':
        // la conversacion desaparecio del servidor entre el manifiesto y la
        // subida. No se vuelve a crear en esta misma pasada: podria ser una
        // purga, y un equipo desfasado no la resucita
        report.status = 'failed';
        report.error = 'la conversacion ya no esta en el servidor; no se ha vuelto a crear';
        report.server = 0;
        return 'done';
      case 'space':
        report.status = 'failed';
        report.error = 'el servidor guarda otra cosa con este identificador; no se ha subido nada';
        return 'done';
    }
  }

  report.status = 'ok';
  report.server = server.size;
  await persistConversation(ctx, conversationId, { frozen: false, uploaded: server.size });
  return 'done';
}
