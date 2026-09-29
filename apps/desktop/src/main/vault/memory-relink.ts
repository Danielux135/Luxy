// quien reescribe con la ficha de su personaje la memoria de una conversacion
// ENGANCHADA (`D-108`).
//
// Claude o Codex con la sesion local, NUNCA una API de pago (`D-087`), por el
// carril que comparten el catalogo, los pendientes y la ficha retroactiva. Lo
// que escribe va a `vault/memory-relink.json`; el `.jsonl` no se toca nunca.
//
// Las reglas de `D-088`, que aqui se cumplen asi:
//
//  - nada de esto puede costar un turno: se lanza sin esperar y no lanza nunca;
//  - si falla, se niega, sale vaga o pierde material, sigue valiendo la de
//    antes. Una negativa pertenece al CLI que la dio;
//  - un cierre de la boveda a mitad no marca nada como fallido (`D-106`);
//  - lo que llega tarde se tira: si mientras el CLI pensaba se ha sellado otra
//    memoria, ha cambiado el enganche o hay un envio en curso, el resultado ya
//    no describe lo que hay.
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AUXILIARY_PROVIDER,
  SEALED_MEMORY_CAPS,
  buildMemoryRelinkPrompt,
  decideRelink,
  isLocalCliProvider,
  memoryRelinkEntrySchema,
  parseMemoryRelinkResponse,
  relinkNeedsRun,
  relinkPhase,
  repairSlicedMemory,
  resolveAuxiliaryTarget,
  textOutsideRelinkBlock,
  type ConversationOwner,
  type LocalCliProvider,
  type MemoryRelinkEntry,
  type MemoryRelinkOutcome,
  type SealedMemoryRef,
} from '@luxy/shared';
import { classifyReply } from '../../shared/refusal.js';
import type { VaultCharacterStore } from './character-store.js';
import type { PrivateConversationStore } from './conversation-store.js';
import type { MemoryPreferences } from './memory-preferences.js';
import type { MemoryRelinkStore } from './memory-relink-store.js';
import type { RecapStore } from './recap-store.js';
import type { AuxiliaryController } from './relation-sync.js';
import type { VaultService } from './vault-service.js';

export interface MemoryRelinkDeps {
  vault: VaultService;
  conversations: Pick<PrivateConversationStore, 'owner' | 'latestMemoryRecord'>;
  relinks: Pick<MemoryRelinkStore, 'forConversation' | 'replace'>;
  /**
   * la ficha retroactiva y el indice: memoria que viaja en una enganchada sin
   * memoria propia y que tambien se escribio sin su ficha (septima ronda)
   */
  recaps: Pick<RecapStore, 'entryFor'>;
  characters: Pick<VaultCharacterStore, 'list'>;
  preferences: Pick<MemoryPreferences, 'auxiliary' | 'excluded'>;
  controller: AuxiliaryController;
  /** el carril que se comparte con el catalogo, los pendientes y la ficha */
  lane: <T>(task: () => Promise<T>) => Promise<T>;
  /** true mientras se le contesta o se le cambia el dueño a esa conversacion */
  isBusy: (conversationId: string) => boolean;
  now: () => string;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

export interface MemoryRelinkRunOptions {
  conversationId: string;
  projectAlias: string;
  /** pedida con el boton: se salta la negativa guardada y el fallo de la sesion */
  force?: boolean;
}

export type { MemoryRelinkOutcome };

/** el registro de la memoria sellada, sin su texto */
function refOf(record: { sequence: number; createdAt: string } | null): SealedMemoryRef | null {
  return record === null ? null : { sequence: record.sequence, createdAt: record.createdAt };
}

function sameRef(a: SealedMemoryRef | null, b: SealedMemoryRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.sequence === b.sequence && a.createdAt === b.createdAt;
}

export class MemoryRelink {
  /**
   * conversaciones cuyo PROCESO fallo en esta sesion, con el CLI con que fallo.
   *
   * Un proceso que no termina no dice nada del contenido y no se persiste; sin
   * esto, cada mensaje de esa conversacion volveria a arrancar el mismo CLI para
   * fallar igual. Se olvida al reiniciar.
   */
  private readonly failures = new Map<string, LocalCliProvider>();
  /**
   * conversaciones que la pasada general ya miro sin nada que hacer mientras la
   * boveda sigue abierta. Sin esto, cada envio volveria a descifrar todas las
   * enganchadas para no hacer nada. Se olvida al cerrar la boveda: al volver,
   * se mira todo otra vez una vez
   */
  private readonly idle = new Set<string>();
  private cancelled = false;

  constructor(private readonly deps: MemoryRelinkDeps) {}

  /** para la pasada en curso. Se engancha a `vault.onLock` */
  cancel(): void {
    this.cancelled = true;
    this.idle.clear();
  }

  /**
   * la pasada general: una tras otra, las enganchadas que pueden tener algo
   * pendiente (octava ronda).
   *
   * Antes solo se reintentaba sola una enganchada tras un envio EN ELLA: una
   * pasada cortada por un cierre de la boveda —lo normal con `D-106`—, un
   * reinicio de Studio o un fallo local la dejaban «pendiente… en segundo
   * plano» para siempre en una conversacion que Daniel no sigue, y sus otras
   * conversaciones recibian la memoria escrita sin su ficha (`D-105`). Se
   * lanza tras cada envio, en cualquier conversacion, y casi siempre vuelve sin
   * llamar a nadie. Para al cerrarse la boveda. No lanza nunca.
   */
  async sweep(projectAlias: string, candidates: readonly string[]): Promise<void> {
    for (const conversationId of candidates) {
      if (this.stopped()) return;
      if (this.idle.has(conversationId)) continue;
      const outcome = await this.run({ conversationId, projectAlias });
      if (outcome === 'cut' || outcome === 'locked') return;
    }
  }

  /**
   * apunta el enganche nuevo: pendiente si hay memoria que reescribir y, si no,
   * que no hace falta.
   *
   * Lo segundo importa: sin la fila, la primera memoria que se sellara DESPUES
   * de enganchar —escrita ya con la ficha— pareceria pendiente y se reescribiria
   * gastando una llamada para nada. Se llama justo despues de escribir el evento
   * y NO lanza: si falla, `relinkPhase` trata a una enganchada con memoria y sin
   * fila como pendiente, que es lo seguro.
   *
   * «Hay memoria» no es solo la sellada: sin ella, lo que viaja es la ficha
   * retroactiva o el indice del catalogo, escritos por un CLI que no veia la
   * ficha de nadie, y la primera memoria que se selle despues sale de ahi y
   * arrastra lo improvisado. Entonces se queda pendiente SIN memoria sellada:
   * no hay nada que reescribir todavia, y la primera que se selle es la que se
   * reescribe (septima ronda).
   */
  async noteLink(conversationId: string): Promise<void> {
    const vault = this.deps.vault;
    try {
      const owner = await this.deps.conversations.owner(vault, conversationId);
      if (owner.source !== 'link' || owner.winningEventId === null || owner.characterId === null) {
        return;
      }
      const sealed = refOf(await this.deps.conversations.latestMemoryRecord(vault, conversationId));
      const inherits = sealed !== null || (await this.inheritsUnsheetedMemory(conversationId));
      const current = await this.deps.relinks.forConversation(vault, conversationId);
      const now = this.deps.now();
      await this.deps.relinks.replace(
        vault,
        conversationId,
        current,
        memoryRelinkEntrySchema.parse({
          v: 1,
          conversationId,
          ownerEventId: owner.winningEventId,
          characterId: owner.characterId,
          status: inherits ? 'pending' : 'not-needed',
          basedOn: sealed,
          memory: null,
          drift: null,
          provider: null,
          model: null,
          failure: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
    } catch {
      // el motivo no se registra: podria traer dentro lo que no valido
      this.deps.log('memoria reescrita con su ficha', { resultado: 'sin-apuntar' });
    }
  }

  /**
   * si la conversacion tiene ficha retroactiva o indice con memoria: lo que
   * viajaria sin memoria sellada. Sin poder leerlo se contesta que si: lo peor
   * es una llamada de mas, y lo otro es dejar lo improvisado sin reescribir.
   *
   * No mira si la ficha esta aprobada: una sin aprobar puede aprobarse despues.
   */
  async inheritsUnsheetedMemory(conversationId: string): Promise<boolean> {
    try {
      const entry = await this.deps.recaps.entryFor(this.deps.vault, conversationId);
      return entry !== undefined && entry.memory !== null;
    } catch {
      return true;
    }
  }

  /**
   * true si el ultimo PROCESO de esta conversacion fallo en esta sesion con el
   * CLI que toca ahora: ahi no se vuelve a intentar sola hasta reiniciar, y la
   * pantalla no puede decir «en segundo plano» (septima ronda).
   */
  stalledThisSession(conversationId: string): boolean {
    const failed = this.failures.get(conversationId);
    return failed !== undefined && failed === this.auxiliary().provider;
  }

  /**
   * una pasada sobre UNA conversacion, por el carril. No lanza nunca.
   *
   * Quien la llama NO debe envolverla otra vez en el carril: se esperaria a si
   * misma.
   */
  async run(options: MemoryRelinkRunOptions): Promise<MemoryRelinkOutcome> {
    return this.deps.lane(async () => {
      this.cancelled = false;
      let outcome: MemoryRelinkOutcome;
      try {
        outcome = await this.relinkOne(options);
      } catch {
        // leer o guardar pueden fallar —un almacen que no abre, la boveda que
        // se cierra entre dos `await`—. No es culpa del CLI ni de la
        // conversacion: no se marca nada, y la pasada general lo vuelve a mirar
        if (this.stopped()) return 'cut';
        this.deps.log('memoria reescrita con su ficha', { resultado: 'fallo-local' });
        return 'skipped';
      }
      // lo que no tiene nada que hacer no se vuelve a mirar en la pasada general
      // hasta que se cierre la boveda; lo demas si
      if (outcome === 'skipped' || outcome === 'no-memory' || outcome === 'excluded') {
        this.idle.add(options.conversationId);
      } else {
        this.idle.delete(options.conversationId);
      }
      return outcome;
    });
  }

  private stopped(): boolean {
    return this.cancelled || !this.deps.vault.isUnlocked();
  }

  /**
   * a quien se le manda, comprobado dos veces, como en la ficha retroactiva: la
   * preferencia esta en disco sin cifrar y colar ahi un proveedor de pago
   * costaria una llamada cobrada.
   */
  private auxiliary(): { provider: LocalCliProvider; model: string | null } {
    const target = resolveAuxiliaryTarget(null, this.deps.preferences.auxiliary());
    if (isLocalCliProvider(target.provider)) return { provider: target.provider, model: target.model };
    return { provider: DEFAULT_AUXILIARY_PROVIDER, model: null };
  }

  private async relinkOne(options: MemoryRelinkRunOptions): Promise<MemoryRelinkOutcome> {
    const { vault, conversations, relinks } = this.deps;
    const id = options.conversationId;
    if (!vault.isUnlocked()) return 'locked';
    // fuera del trabajo de fondo, como la ficha retroactiva y los pendientes
    if (this.deps.preferences.excluded().has(id)) return 'excluded';
    if (this.deps.isBusy(id)) return 'busy';

    const openVault = vault;
    const target = this.auxiliary();
    const force = options.force === true;
    // lo barato primero: se dispara tras CADA envio de una enganchada, y sin esto
    // cada uno descifraria la conversacion entera para no hacer nada
    //
    // Una `applied` que aun guarda su texto NO se salta: puede haber cumplido
    // ya —la memoria sellada despues salio de ella— y entonces ese texto esta
    // en disco sin que nada lo lea. Se mira una vez y se borra (octava ronda)
    const early = await relinks.forConversation(openVault, id);
    if (!force && early !== undefined) {
      if (
        (early.status === 'applied' && early.memory === null) ||
        early.status === 'not-needed' ||
        early.status === 'discarded'
      ) {
        return 'skipped';
      }
      if (early.status === 'failed' && early.provider === target.provider) return 'skipped';
    }
    const owner: ConversationOwner = await conversations.owner(openVault, id);
    const sealed = await conversations.latestMemoryRecord(openVault, id);
    const entry = await relinks.forConversation(openVault, id);
    const phase = relinkPhase(entry, owner, refOf(sealed));
    if (phase === 'done' && entry !== undefined && entry.memory !== null) {
      // compare-and-set: si algo la cambio entre medias, se deja y ya se
      // mirara otra vez
      await relinks.replace(openVault, id, entry, {
        ...entry,
        memory: null,
        updatedAt: this.deps.now(),
      });
      return 'skipped';
    }
    if (
      !relinkNeedsRun({
        phase,
        entry,
        provider: target.provider,
        force,
        failedThisSession: force ? null : (this.failures.get(id) ?? null),
      })
    ) {
      return 'skipped';
    }
    if (sealed === null || owner.winningEventId === null || owner.characterId === null) {
      return 'no-memory';
    }

    // la ficha de la boveda si tiene texto; si no, la que sello el enganche. Es
    // la misma regla con la que main decide cual viaja en el turno
    const character = (await this.deps.characters.list(openVault)).find(
      (each) => each.characterId === owner.characterId,
    );
    const vaultDescription = character?.description ?? '';
    const description =
      vaultDescription.trim().length > 0 ? vaultDescription : owner.characterDescription;
    const label =
      character !== undefined && character.label.length > 0
        ? character.label
        : (owner.characterLabel ?? '');

    // con la palabra partida del `slice` de antes arreglada, que es como la lee
    // el turno: si no, el CLI la completa a su manera y lo inventado se guarda
    // sin la huella que permitiria arreglarlo despues (septima ronda)
    const previous = repairSlicedMemory(sealed.memory, SEALED_MEMORY_CAPS).memory;
    const prompt = buildMemoryRelinkPrompt({ label, description, previous });
    const started = Date.now();
    let text: string;
    try {
      const turn = await this.deps.controller.runLocalTurn({
        localTurnId: randomUUID(),
        provider: target.provider,
        model: target.model,
        projectAlias: options.projectAlias,
        prompt,
        // corregir una memoria es una tarea SOBRE un texto: no encarna a nadie
        kind: 'technical',
      });
      if (turn.outcome !== 'completed') throw new Error('sin terminar');
      text = turn.text;
    } catch {
      if (this.stopped()) {
        this.logOutcome('cut', target.provider, null, started, force);
        return 'cut';
      }
      this.failures.set(id, target.provider);
      this.logOutcome('process', target.provider, null, started, force);
      return 'process';
    }

    const parsed = parseMemoryRelinkResponse(text);
    // se clasifica SOLO sin bloque que valga, y solo lo de fuera del bloque: una
    // memoria que habla de la escena no es una negativa
    const refused =
      parsed.status !== 'structured' &&
      classifyReply(textOutsideRelinkBlock(text)).kind === 'refused';
    const decision = decideRelink({ previous, parsed, refused });

    // la llamada es lo que mas tarda: aqui dentro cabe un cierre, un envio y un
    // «soltar». Lo que ya no describe lo que hay se tira
    if (this.stopped()) {
      this.logOutcome('cut', target.provider, decision, started, force);
      return 'cut';
    }
    if (this.deps.isBusy(id)) {
      this.logOutcome('stale', target.provider, decision, started, force);
      return 'stale';
    }
    const ownerNow = await conversations.owner(openVault, id);
    const sealedNow = refOf(await conversations.latestMemoryRecord(openVault, id));
    if (ownerNow.winningEventId !== owner.winningEventId || !sameRef(sealedNow, refOf(sealed))) {
      this.logOutcome('stale', target.provider, decision, started, force);
      return 'stale';
    }

    const now = this.deps.now();
    const next: MemoryRelinkEntry = memoryRelinkEntrySchema.parse({
      v: 1,
      conversationId: id,
      ownerEventId: owner.winningEventId,
      characterId: owner.characterId,
      status: decision.status,
      basedOn: refOf(sealed),
      memory: decision.status === 'ready' ? decision.memory : null,
      drift: decision.drift,
      provider: target.provider,
      model: target.model,
      failure: decision.status === 'failed' ? decision.failure : null,
      createdAt:
        entry !== undefined && entry.ownerEventId === owner.winningEventId ? entry.createdAt : now,
      updatedAt: now,
    });
    const written = await relinks.replace(openVault, id, entry, next);
    if (!written) {
      // Daniel decidio algo mientras tanto: su decision gana
      this.logOutcome('stale', target.provider, decision, started, force);
      return 'stale';
    }
    if (decision.status === 'ready') this.failures.delete(id);
    const outcome: MemoryRelinkOutcome = decision.status === 'ready' ? 'ready' : decision.failure;
    this.logOutcome(outcome, target.provider, decision, started, force);
    return outcome;
  }

  /**
   * una linea, solo con enteros y clasificaciones: ni la conversacion, ni el
   * personaje, ni una palabra de ninguna memoria, ni lo que dijo el CLI al
   * negarse. Los nombres se han mirado contra `redact()`.
   */
  private logOutcome(
    outcome: MemoryRelinkOutcome,
    provider: LocalCliProvider,
    decision: ReturnType<typeof decideRelink> | null,
    started: number,
    force: boolean,
  ): void {
    this.deps.log('memoria reescrita con su ficha', {
      resultado: outcome,
      proveedor: provider,
      forzada: force,
      conservadas: decision?.drift?.kept ?? null,
      corregidas: decision?.drift?.rewritten ?? null,
      quitadas: decision?.drift?.dropped ?? null,
      recortadas: decision?.drift?.shortened ?? null,
      aportadas: decision?.drift?.added ?? null,
      resumenCambiado: decision?.drift?.summaryChanged ?? null,
      resumenAntes: decision?.sizes?.summaryBefore ?? null,
      resumenDespues: decision?.sizes?.summaryAfter ?? null,
      entradasAntes: decision?.sizes?.entriesBefore ?? null,
      entradasDespues: decision?.sizes?.entriesAfter ?? null,
      duracionMs: Date.now() - started,
    });
  }
}
