// quien decide cuando corre la sincronizacion y que espera a que (`SYNC-F1-07`).
//
// Tres cosas que antes no hacia nadie, y por las que existe:
//
//  1. **Un solo vuelo.** Dos pasadas a la vez podian bajar el mismo registro
//     dos veces y duplicar lineas. Si llega otra peticion mientras corre una,
//     se hace UNA pasada mas al terminar, y todas las que esperaban reciben su
//     resultado.
//  2. **Marcar la conversacion que se esta tocando.** Borrar una conversacion,
//     borrar su memoria o cambiarle el dueño esperan a que la pasada la suelte;
//     y la pasada no empieza una conversacion que ya tiene uno de esos en curso,
//     ni un envio. Asi lo que baja no cae en un archivo que se esta borrando, y
//     lo borrado no vuelve.
//  3. **La guardia de replica** (`D-110`): un equipo que se estreno con la
//     boveda de la cuenta y sin nada propio no escribe turnos hasta tener los
//     hechos (F2). Sin las fichas, un turno suyo sellaria una memoria pobre que
//     ganaria para siempre. El papel sale del estado sellado Y del ancla sin
//     sellar (`sync-anchor-store.ts`): la replica lo es desde que entra en la
//     cuenta, antes de su primera pasada, y no deja de serlo si el estado
//     sellado se pierde o no se puede leer (F1-R1-01).
//
// Sincronizar es trabajo de fondo (`D-106`): aqui no hay `beginUserWait` ni
// `touch()`. Si la boveda se cierra, lo que este en vuelo se corta y la pasada
// lo dice.
import type { VaultSyncDiagnosis, VaultSyncScope } from '../../shared/ipc.js';
import { VaultError, type VaultService } from './vault-service.js';
import type { PrivateConversationStore } from './conversation-store.js';
import type { PrivateMediaStore } from './media-store.js';
import type { SyncDeletedStore } from './sync-deleted-store.js';
import type { SyncRole, SyncStateStore } from './sync-state-store.js';
import { effectiveSyncRole, type SyncAnchorRead, type SyncAnchorStore } from './sync-anchor-store.js';
import { syncVault, type SyncPart, type VaultSyncResult } from './sync.js';

export interface SyncConnection {
  gatewayUrl: string;
  sessionToken: string;
  onUnauthorized: () => void;
  onSessionRenewed: (expiresAt: string) => void;
}

export interface SyncCoordinatorDeps {
  vault: VaultService;
  conversations: PrivateConversationStore;
  media: PrivateMediaStore;
  state: SyncStateStore;
  deleted: SyncDeletedStore;
  /** el papel de este equipo fuera del estado sellado */
  anchor: SyncAnchorStore;
  /** la conversacion esta ocupada para esa parte (ver `VaultSyncDeps.isBusy`) */
  isBusy: (conversationId: string, part: SyncPart) => boolean;
  /**
   * con que se habla: el gateway y la sesion de la cuenta. Lanza un
   * `VaultError` que explica que hacer si no hay configuracion o sesion.
   */
  connection: () => SyncConnection;
  /** se ha escrito algo bajado: lo que este en memoria ya no vale */
  onDownloaded: () => void;
  log?: (message: string, fields?: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}

/** lo que se le dice a quien intenta escribir en una replica */
export const REPLICA_BLOCKED = {
  message: 'este ordenador es una copia de la bóveda y todavía no puede escribir',
  hint: 'se estrenó con la bóveda de tu cuenta sin nada propio. Hasta que viajen las fichas y lo demás (la siguiente versión de la sincronización), escribir aquí sellaría una memoria incompleta. Sigue la conversación en el ordenador de siempre.',
} as const;

export const DELETED_BLOCKED = {
  message: 'esa conversación se borró en este equipo',
  hint: 'empieza una conversación nueva: la borrada no vuelve',
} as const;

interface Queued {
  all: boolean;
  ids: Set<string>;
  promise: Promise<VaultSyncResult>;
  resolve: (value: VaultSyncResult) => void;
  reject: (reason: unknown) => void;
}

export class SyncCoordinator {
  private running: Promise<VaultSyncResult> | null = null;
  private queued: Queued | null = null;
  private readonly holds = new Map<string, number>();
  private readonly waiters = new Map<string, (() => void)[]>();
  private abort: AbortController | null = null;
  /**
   * lo que dice el estado SELLADO del papel; `undefined` hasta leerlo con la
   * boveda abierta. Solo se guarda una lectura buena: un fallo se vuelve a
   * intentar en el siguiente envio. El ancla no se guarda aqui: se lee cada vez,
   * porque entrar en la cuenta la escribe sin pasar por este objeto
   */
  private sealedGuard: { role: SyncRole | null; factsBootstrapped: boolean } | undefined;

  constructor(private readonly deps: SyncCoordinatorDeps) {
    // cerrar la boveda corta lo que este en vuelo: la pasada lo ve y se para
    deps.vault.onLock(() => {
      this.abort?.abort();
      this.sealedGuard = undefined;
    });
  }

  /** hay una pasada en marcha */
  get busy(): boolean {
    return this.running !== null;
  }

  /**
   * pide una pasada. Si ya hay una, se hace otra al terminar —una sola, por
   * muchas que se pidan— y se devuelve el resultado de esa.
   */
  request(scope: VaultSyncScope): Promise<VaultSyncResult> {
    if (this.running === null) return this.start(scope);
    if (this.queued === null) {
      let resolve!: (value: VaultSyncResult) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<VaultSyncResult>((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      this.queued = { all: false, ids: new Set(), promise, resolve, reject };
    }
    if (scope.mode === 'all') this.queued.all = true;
    else this.queued.ids.add(scope.conversationId.toLowerCase());
    return this.queued.promise;
  }

  private start(scope: VaultSyncScope): Promise<VaultSyncResult> {
    const run = this.execute(scope);
    this.running = run;
    const next = (): void => {
      this.running = null;
      const queued = this.queued;
      this.queued = null;
      if (queued === null) return;
      const [only] = queued.ids;
      // varias conversaciones distintas pendientes: una pasada de todo las cubre
      const scopeNext: VaultSyncScope =
        queued.all || queued.ids.size !== 1 || only === undefined
          ? { mode: 'all' }
          : { mode: 'conversation', conversationId: only };
      this.start(scopeNext).then(queued.resolve, queued.reject);
    };
    run.then(next, next);
    return run;
  }

  private async execute(scope: VaultSyncScope): Promise<VaultSyncResult> {
    const { vault } = this.deps;
    if (!vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');
    const connection = this.deps.connection();
    const abort = new AbortController();
    this.abort = abort;
    try {
      const result = await syncVault(
        vault,
        {
          conversations: this.deps.conversations,
          media: this.deps.media,
          state: this.deps.state,
          deleted: this.deps.deleted,
          anchor: this.deps.anchor,
        },
        {
          ...connection,
          ...(this.deps.fetchImpl === undefined ? {} : { fetchImpl: this.deps.fetchImpl }),
          signal: abort.signal,
          isBusy: this.deps.isBusy,
          hold: (conversationId, task) => this.hold(conversationId, task),
          onDownloaded: () => this.deps.onDownloaded(),
          ...(this.deps.log === undefined ? {} : { log: this.deps.log }),
        },
        scope,
      );
      // el papel pudo decidirse en esta pasada
      this.sealedGuard = undefined;
      return result;
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  private async hold<T>(conversationId: string, task: () => Promise<T>): Promise<T> {
    const key = conversationId.toLowerCase();
    this.holds.set(key, (this.holds.get(key) ?? 0) + 1);
    try {
      return await task();
    } finally {
      const left = (this.holds.get(key) ?? 1) - 1;
      if (left > 0) {
        this.holds.set(key, left);
      } else {
        this.holds.delete(key);
        const waiting = this.waiters.get(key) ?? [];
        this.waiters.delete(key);
        for (const wake of waiting) wake();
      }
    }
  }

  /** la pasada esta tocando ahora esa conversacion */
  isHolding(conversationId: string): boolean {
    return this.holds.has(conversationId.toLowerCase());
  }

  /**
   * se resuelve cuando la pasada suelta esa conversacion, o enseguida si no la
   * tiene. Quien borra o cambia el dueño se marca ANTES como ocupado: la pasada
   * ya no vuelve a cogerla, asi que esto no espera para siempre.
   */
  settled(conversationId: string): Promise<void> {
    const key = conversationId.toLowerCase();
    if (!this.holds.has(key)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.waiters.get(key) ?? [];
      list.push(resolve);
      this.waiters.set(key, list);
    });
  }

  /**
   * apunta un borrado ANTES de borrar nada: desde aqui ese id ni sube ni baja.
   * Sincrono y sin la llave. Si la lista no se puede escribir, lanza, y quien
   * borra no debe seguir.
   */
  noteDeleted(conversationId: string): void {
    this.deps.deleted.add(conversationId);
  }

  /** se van las entradas de esa conversacion del estado de la sincronizacion */
  async forgetConversation(conversationId: string): Promise<void> {
    await this.deps.state.removeConversation(this.deps.vault, conversationId);
  }

  /**
   * lanza si en esta conversacion no se puede escribir un turno: se borro aqui,
   * o este equipo es una replica sin los hechos.
   */
  async assertMayWrite(conversationId: string): Promise<void> {
    let deleted = false;
    try {
      deleted = this.deps.deleted.has(conversationId);
    } catch {
      // una lista que no se lee para la sincronizacion, no los envios
      deleted = false;
    }
    if (deleted) throw new VaultError(DELETED_BLOCKED.message, DELETED_BLOCKED.hint);

    const guard = await this.readGuard();
    if (guard.role === 'replica' && !guard.factsBootstrapped) {
      throw new VaultError(REPLICA_BLOCKED.message, REPLICA_BLOCKED.hint);
    }
  }

  /** el papel de este equipo, para la pantalla; `null` si aun no se decidio */
  async role(): Promise<SyncRole | null> {
    return (await this.readGuard()).role;
  }

  /**
   * el papel que vale ahora: el estado sellado y el ancla, juntos.
   *
   * Si el estado sellado no se puede leer —la boveda cerrada, un EBUSY de un
   * antivirus—, manda el ancla. Antes eso devolvia «sin papel» y dejaba
   * escribir a una replica; ahora una replica sigue siendolo aunque su estado
   * no abra, y el de siempre, que no tiene ancla de replica, sigue escribiendo.
   */
  private async readGuard(): Promise<{ role: SyncRole | null; factsBootstrapped: boolean }> {
    let sealed = this.sealedGuard;
    if (sealed === undefined) {
      try {
        const state = await this.deps.state.read(this.deps.vault);
        sealed = { role: state.role, factsBootstrapped: state.factsBootstrapped };
        this.sealedGuard = sealed;
      } catch {
        sealed = { role: null, factsBootstrapped: false };
      }
    }
    let anchor: SyncAnchorRead;
    try {
      anchor = this.deps.anchor.read();
    } catch {
      // un fallo al leerla no dice nada del papel: lo prudente
      anchor = { kind: 'unreadable' };
    }
    return { role: effectiveSyncRole(sealed.role, anchor), factsBootstrapped: sealed.factsBootstrapped };
  }

  /** el diagnostico local, sin descifrar nada */
  diagnose(): VaultSyncDiagnosis {
    let deletedIds: Set<string> | null;
    try {
      deletedIds = this.deps.deleted.ids();
    } catch {
      deletedIds = null;
    }
    const conversations = this.deps.conversations
      .listConversationIds()
      .filter((id) => deletedIds === null || !deletedIds.has(id.toLowerCase()))
      .sort()
      .map((conversationId) => {
        const view = this.deps.conversations.syncView(conversationId);
        return {
          conversationId,
          lines: view.integrity.lines,
          turns: view.records.length,
          unreadable: view.integrity.unreadable,
          duplicateLines: view.integrity.duplicateLines,
          duplicateSequences: view.integrity.duplicateSequences,
          holes: view.integrity.holes,
          partialTail: view.integrity.partialTail,
        };
      });
    return { conversations, deleted: deletedIds === null ? null : deletedIds.size };
  }
}
