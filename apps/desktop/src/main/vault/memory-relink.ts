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
//    no describe lo que hay;
//  - un fallo del PROCESO del CLI no es una respuesta: ni se guarda como
//    `invalid` ni se persiste. Si es del CLI, lo pone en la espera que
//    comparten los cuatro trabajos de fondo (`INV-FONDO-001`); si es de la
//    conversacion, la pasa al final de la cola y, si la espera la da por suya,
//    la salta un par de horas (undecima y decimotercera ronda).
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AUXILIARY_PROVIDER,
  SEALED_MEMORY_CAPS,
  buildMemoryRelinkPrompt,
  decideRelink,
  isLocalCliProvider,
  memoryRelinkEntrySchema,
  parseMemoryRelinkResponse,
  relinkApplies,
  relinkBound,
  relinkNeedsRun,
  relinkPhase,
  repairSlicedMemory,
  resolveAuxiliaryTarget,
  textOutsideRelinkBlock,
  type ConversationOwner,
  type LocalCliProvider,
  type MemoryRelinkEntry,
  type MemoryRelinkOutcome,
  type ProviderFailureReason,
  type RelinkOwnerRef,
  type SealedMemoryRef,
} from '@luxy/shared';
import { classifyReply } from '../../shared/refusal.js';
import {
  AuxiliaryCooldown,
  isProcessFailure,
  processFailureLabel,
  processSubject,
  type ProcessFailureLabel,
  type ProcessFailureVerdict,
} from './auxiliary-cooldown.js';
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
  /**
   * `recoverProcessFailures` es opcional para las pruebas que no lo miran: la
   * recuperacion de las filas que escribio un fallo del proceso
   * (`INV-FONDO-001`) solo existe en el almacen de verdad
   */
  relinks: Pick<MemoryRelinkStore, 'forConversation' | 'replace'> &
    Partial<Pick<MemoryRelinkStore, 'recoverProcessFailures'>>;
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
  /**
   * la espera por proveedor que comparten los cuatro trabajos de fondo. Sin
   * ella —en las pruebas que no la miran— tiene la suya propia
   */
  cooldown?: AuxiliaryCooldown;
}

export interface MemoryRelinkRunOptions {
  conversationId: string;
  projectAlias: string;
  /**
   * pedida con el boton: se salta la negativa guardada y puede lanzar el CLI
   * una vez aunque este en espera tras un fallo de su proceso. Solo la manda el
   * boton de «Lo que recuerda»: nada automatico la usa
   */
  force?: boolean;
}

export type { MemoryRelinkOutcome };

/**
 * en que acabo una pasada, mas dos que no lanzan el CLI: `waiting`, porque
 * esta en espera tras un fallo de su proceso, y `blocked`, porque la espera
 * salta esta conversacion un par de horas —su proceso falla por su cuenta—.
 *
 * `blocked` no es `skipped`: tiene trabajo, y la pasada general no puede darla
 * por vista. Como `skipped` se quedaba fuera de la pasada hasta cerrar la
 * boveda, y pasadas las dos horas nadie la volvia a probar sola, aunque su
 * fila lo prometia.
 *
 * Ninguna de las dos viaja a la pantalla —el boton fuerza, y ni espera ni
 * salta— ni al registro: la espera ya se registro con el fallo que la armo, y
 * una linea por enganchada en cada envio solo seria ruido.
 */
export type MemoryRelinkRunOutcome = MemoryRelinkOutcome | 'waiting' | 'blocked';

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
   * la espera del CLI tras un fallo de su proceso.
   *
   * Un proceso que no termina no dice nada del contenido y no se persiste.
   * Apuntarlo SIEMPRE por conversacion y hasta reiniciar dejaba sin reescribir
   * lo pendiente aunque el CLI ya funcionara (`INV-FONDO-001`); apuntarlo
   * siempre al CLI dejaba que una sola conversacion rota frenara a todas
   * (undecima ronda). La espera decide de quien es (`noteFailure`).
   */
  private readonly cooldown: AuxiliaryCooldown;
  // las conversaciones cuyo proceso falla por su cuenta ya no se apuntan aqui
  // hasta reiniciar: las salta la espera un par de horas
  // (`AuxiliaryCooldown.blocked`, decimotercera ronda). Sin saltarlas, cada
  // pasada volvia a lanzarlas —hasta media hora de carril con un tiempo
  // agotado— y, como fallo del CLI, rearmaban la espera de los cuatro trabajos;
  // y saltandolas la sesion entera, un fallo del CLI entero mal reconocido
  // dejaba sin reescribir su memoria hasta reiniciar
  /**
   * conversaciones cuyo ultimo intento fue un fallo del proceso, con el CLI.
   *
   * No las bloquea: las pone al final de la pasada general, como `processFailed`
   * en los pendientes y la ficha retroactiva. La pasada recorre las filas en el
   * orden del archivo, y un fallo del proceso no escribe nada: sin esto, la que
   * falla iba SIEMPRE primera, volvia a armar la espera y todas las de detras
   * se quedaban en `waiting` la sesion entera (undecima ronda)
   */
  private readonly processFailed = new Map<string, LocalCliProvider>();
  /**
   * si la recuperacion de las filas que escribio un fallo del proceso ya se
   * comprobo en esta apertura. El almacen la sella en disco y solo la hace una
   * vez; esto solo evita releer el archivo para nada en cada pasada.
   */
  private recoveryChecked = false;
  /**
   * conversaciones que la pasada general ya miro sin nada que hacer mientras la
   * boveda sigue abierta. Sin esto, cada envio volveria a descifrar todas las
   * enganchadas para no hacer nada. Se olvida al cerrar la boveda: al volver,
   * se mira todo otra vez una vez
   */
  private readonly idle = new Set<string>();
  /**
   * conversaciones cuyo turno partio de lo heredado y no pudo apuntarlo, con el
   * enganche de entonces.
   *
   * Si el apunte fallaba, la fila se quedaba en «no hace falta»; los turnos
   * siguientes ya van con la sellada y no lo vuelven a intentar, asi que la
   * memoria que salio de lo heredado no se reescribia nunca. La pasada lo
   * reintenta antes de decidir. Se olvida al reiniciar.
   */
  private readonly inheritedUnnoted = new Map<string, string>();
  /**
   * cuantas veces se ha parado. Cada pasada —la general y la de una
   * conversacion— se queda con el valor con el que empezo y para en cuanto
   * cambia: un cierre corta la que estaba en curso, y solo esa.
   *
   * Era un `cancelled` que solo volvia a `false` al empezar `run()`, y `sweep()`
   * miraba si parar ANTES de llamarlo: tras el primer cierre de la boveda, la
   * pasada general no hacia nada hasta que algo llamara a `run()` directamente
   * —un envio en una enganchada, enganchar o el boton—, y lo pendiente, lo que
   * esperaba y lo que la espera habia saltado no se reintentaba solo.
   */
  private generation = 0;

  constructor(private readonly deps: MemoryRelinkDeps) {
    this.cooldown = deps.cooldown ?? new AuxiliaryCooldown();
  }

  /** para la pasada en curso. Se engancha a `vault.onLock` */
  cancel(): void {
    this.generation += 1;
    this.idle.clear();
    // otra apertura puede ser otra cuenta: se vuelve a mirar una vez
    this.recoveryChecked = false;
  }

  /**
   * una vez por archivo: las filas `failed` que solo pudo escribir un fallo del
   * proceso tomado por respuesta vuelven a pendientes (`INV-FONDO-001`).
   *
   * Lo hace el almacen, que lo sella dentro del mismo archivo cifrado; aqui solo
   * se pide una vez por apertura, dentro del carril. Si falla no pasa nada: las
   * filas siguen como estaban y se vuelve a intentar en la pasada siguiente.
   */
  private async recoverFalseFailures(): Promise<void> {
    if (this.recoveryChecked || !this.deps.vault.isUnlocked()) return;
    try {
      const recovered = await this.deps.relinks.recoverProcessFailures?.(
        this.deps.vault,
        this.deps.now(),
      );
      this.recoveryChecked = true;
      if (recovered !== undefined && recovered > 0) {
        // lo dado por visto se vuelve a mirar: ahora hay pendientes nuevas
        this.idle.clear();
        this.deps.log('memoria reescrita con su ficha', {
          resultado: 'recuperadas',
          filas: recovered,
        });
      }
    } catch {
      // el motivo no se registra: podria traer dentro lo que no valido
      this.deps.log('memoria reescrita con su ficha', { resultado: 'sin-recuperar' });
    }
  }

  /**
   * vuelve a mirar en la pasada general lo que se dio por visto: una
   * conversacion, o todas sin argumento.
   *
   * Lo visto sin nada que hacer se saltaba hasta cerrar la boveda, y dos cosas
   * de Daniel lo cambian antes: quitar una conversacion de las excluidas y
   * cambiar de CLI en «Quién hace el trabajo de fondo» —una negativa de uno
   * la puede intentar el otro—. Mientras tanto la fila ya decia «después de tu
   * próximo mensaje en Privado», y no era verdad (`D-093`).
   */
  recheck(conversationId?: string): void {
    if (conversationId === undefined) this.idle.clear();
    else this.idle.delete(conversationId);
  }

  /**
   * el turno de una enganchada va a partir de su ficha retroactiva o de su
   * indice: la memoria que selle saldra de ahi, escrita sin su ficha, y hay que
   * reescribirla.
   *
   * `noteLink` solo ve lo que hay AL ENGANCHAR. Si la ficha retroactiva o el
   * indice aparecen despues —se resume, se cataloga o se aprueba luego—, la fila
   * se quedaba en «no hace falta», que la pasada salta siempre, y esa memoria
   * no se reescribia nunca ni habia boton para pedirlo. Aqui se mira en el
   * momento en que de verdad se usa, que es el unico que importa. Es tambien
   * lo UNICO que la pone pendiente sin memoria sellada: `noteLink` y el borrado
   * de la memoria la dejan en «no hace falta», porque una ficha retroactiva sin
   * aprobar o que no llega a los ultimos mensajes no viaja, y la memoria que se
   * selle entonces nace ya con su ficha (decima ronda).
   *
   * Lo heredado solo viaja SIN memoria sellada (`chooseConversationMemory`), asi
   * que cualquier otro estado de la fila habla de una sellada que ya no esta
   * —un «Borrar su memoria» que no pudo apuntarla al final— y tambien pasa a
   * pendiente: si no, una `applied` desatada se leia «cumplida» y la memoria
   * que saliera de lo heredado no se reescribia nunca. No lanza: si falla, el
   * turno sigue igual y la pasada lo reintenta.
   */
  async noteInheritedMemoryUsed(conversationId: string, owner: RelinkOwnerRef): Promise<void> {
    if (owner.source !== 'link' || owner.winningEventId === null || owner.characterId === null) return;
    try {
      if (await this.markInheritedPending(conversationId, owner)) {
        this.inheritedUnnoted.delete(conversationId);
        return;
      }
    } catch {
      // el motivo no se registra: podria traer dentro lo que no valido
    }
    this.inheritedUnnoted.set(conversationId, owner.winningEventId);
    this.deps.log('memoria reescrita con su ficha', { resultado: 'sin-apuntar', paso: 'heredada' });
  }

  /**
   * la fila de ESE enganche, pendiente y sin texto. `true` si ya lo estaba, si
   * no hay fila de ese enganche —sin ella, `relinkPhase` ya lee pendiente en
   * cuanto hay sellada—, si esta atada a la sellada de ahora —esa vale y no se
   * toca— o si se escribio. Relee y reintenta si otro la cambio entre medias.
   * Lanza si no puede leer o escribir.
   */
  private async markInheritedPending(
    conversationId: string,
    owner: RelinkOwnerRef,
  ): Promise<boolean> {
    const sealed = refOf(
      await this.deps.conversations.latestMemoryRecord(this.deps.vault, conversationId),
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.deps.relinks.forConversation(this.deps.vault, conversationId);
      if (current === undefined || current.ownerEventId !== owner.winningEventId) return true;
      if (current.status === 'pending' && current.memory === null) return true;
      if (relinkBound(current, owner, sealed)) return true;
      const written = await this.deps.relinks.replace(this.deps.vault, conversationId, current, {
        ...current,
        status: 'pending',
        basedOn: null,
        memory: null,
        drift: null,
        failure: null,
        updatedAt: this.deps.now(),
      });
      if (written) {
        this.idle.delete(conversationId);
        return true;
      }
    }
    return false;
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
   *
   * Las que acaban de fallar por el proceso con este CLI van al final: sin
   * bloquearlas, una que falla sola no tapa a las demas (undecima ronda). Entre
   * si, el orden de siempre (`sort` es estable).
   */
  async sweep(projectAlias: string, candidates: readonly string[]): Promise<void> {
    // la de antes de un cierre se para; esta empieza con la boveda abierta
    const generation = this.generation;
    const target = this.auxiliary();
    const lastly = (id: string): number => (this.processFailed.get(id) === target.provider ? 1 : 0);
    const ordered = [...candidates].sort((a, b) => lastly(a) - lastly(b));
    for (const conversationId of ordered) {
      if (this.stopped(generation)) return;
      if (this.idle.has(conversationId)) continue;
      // la espera la salta un par de horas: tampoco se descifra para nada, como
      // lo visto. Pero no se da por vista: en cuanto deje de saltarla, esta
      // misma pregunta la deja pasar
      if (this.cooldown.blocked(target, processSubject('relink', conversationId))) continue;
      const outcome = await this.run({ conversationId, projectAlias });
      if (outcome === 'cut' || outcome === 'locked') return;
      // el CLI esta en espera: las demas tampoco irian, y descifrarlas para
      // nada es justo el coste que la espera existe para ahorrar
      if (outcome === 'waiting') return;
    }
  }

  /**
   * apunta el enganche nuevo: pendiente si hay memoria sellada que reescribir
   * y, si no, que no hace falta.
   *
   * Lo segundo importa: sin la fila, la primera memoria que se sellara DESPUES
   * de enganchar —escrita ya con la ficha— pareceria pendiente y se reescribiria
   * gastando una llamada para nada. Se llama justo despues de escribir el evento
   * y NO lanza: si falla, `relinkPhase` trata a una enganchada con memoria y sin
   * fila como pendiente, que es lo seguro.
   *
   * Sin memoria sellada puede viajar la ficha retroactiva o el indice, escritos
   * por un CLI que no veia la ficha de nadie, y la memoria que se selle despues
   * sale de ahi. La septima ronda la dejaba pendiente ya aqui si habia cualquiera
   * de los dos, y una ficha retroactiva sin aprobar no viaja: la memoria
   * siguiente nacia con su ficha, se reescribia igual —una llamada que la
   * confirmacion decia que no habria— y la fila afirmaba que se escribio sin
   * ella (`D-093`). Ahora lo decide el turno, cuando de verdad parte de lo
   * heredado (`noteInheritedMemoryUsed`, decima ronda).
   */
  async noteLink(conversationId: string): Promise<void> {
    const vault = this.deps.vault;
    try {
      const owner = await this.deps.conversations.owner(vault, conversationId);
      if (owner.source !== 'link' || owner.winningEventId === null || owner.characterId === null) {
        return;
      }
      const sealed = refOf(await this.deps.conversations.latestMemoryRecord(vault, conversationId));
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
          status: sealed !== null ? 'pending' : 'not-needed',
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
   * PODRIA viajar sin memoria sellada. Solo para la confirmacion del enganche;
   * no decide el estado de la fila, que lo apunta el turno si de verdad viaja.
   *
   * No mira si la ficha esta aprobada: una sin aprobar puede aprobarse despues.
   * Si viaja ya lo dice `inheritedTravels`, en la vista previa.
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
   * true si el CLI que toca ahora esta en espera tras un fallo de su proceso.
   *
   * La pantalla no puede decir entonces «en segundo plano después de tu
   * próximo mensaje» a secas: ese mensaje no lo lanzara hasta que acabe la
   * espera (septima ronda, `INV-FONDO-001`). Ya no es «hasta reiniciar».
   */
  waitingForProcess(): boolean {
    return this.cooldown.waiting(this.auxiliary());
  }

  /**
   * true mientras se salta esta conversacion con el CLI que toca ahora: la
   * espera dio su fallo del proceso por suyo. No se reintenta sola en un par de
   * horas, y la pantalla no puede prometer «unos minutos» (undecima y
   * decimotercera ronda).
   */
  blockedThisSession(conversationId: string): boolean {
    return this.cooldown.blocked(this.auxiliary(), processSubject('relink', conversationId));
  }

  /**
   * una pasada sobre UNA conversacion, por el carril. No lanza nunca.
   *
   * Quien la llama NO debe envolverla otra vez en el carril: se esperaria a si
   * misma.
   */
  async run(options: MemoryRelinkRunOptions): Promise<MemoryRelinkRunOutcome> {
    return this.deps.lane(async () => {
      // empieza aqui, dentro del carril: un cierre de ANTES ya no la para
      const generation = this.generation;
      await this.recoverFalseFailures();
      let outcome: MemoryRelinkRunOutcome;
      try {
        outcome = await this.relinkOne(options, generation);
      } catch {
        // leer o guardar pueden fallar —un almacen que no abre, la boveda que
        // se cierra entre dos `await`—. No es culpa del CLI ni de la
        // conversacion: no se marca nada, y la pasada general lo vuelve a mirar
        if (this.stopped(generation)) return 'cut';
        this.deps.log('memoria reescrita con su ficha', { resultado: 'fallo-local' });
        return 'skipped';
      }
      // lo que no tiene nada que hacer no se vuelve a mirar en la pasada general
      // hasta que se cierre la boveda; lo demas si. `waiting` y `blocked` NO:
      // tienen trabajo, y en cuanto acabe la espera —la del CLI, o la que salta
      // esta conversacion— hay que volver a mirarlas. Tambien cuando las lanzo
      // un envio en ellas y no la pasada
      if (outcome === 'skipped' || outcome === 'no-memory' || outcome === 'excluded') {
        this.idle.add(options.conversationId);
      } else {
        this.idle.delete(options.conversationId);
      }
      return outcome;
    });
  }

  /** si la pasada que empezo con `generation` tiene que parar */
  private stopped(generation: number): boolean {
    return generation !== this.generation || !this.deps.vault.isUnlocked();
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

  private async relinkOne(
    options: MemoryRelinkRunOptions,
    generation: number,
  ): Promise<MemoryRelinkRunOutcome> {
    const { vault, conversations, relinks } = this.deps;
    const id = options.conversationId;
    if (!vault.isUnlocked()) return 'locked';
    const openVault = vault;
    // fuera del trabajo de fondo, como la ficha retroactiva y los pendientes: no
    // se llama a ningun CLI. Pero un texto reescrito que ya no vale se suelta
    // igual (abajo), que no llama a nadie: con el `return` delante, el resto de
    // un «Soltar» que no pudo quitar la fila se quedaba en disco mientras la
    // conversacion siguiera excluida (decima ronda)
    const excluded = this.deps.preferences.excluded().has(id);
    const unnoted = this.inheritedUnnoted.has(id);
    const early = await relinks.forConversation(openVault, id);
    if (excluded && !unnoted && (early === undefined || early.memory === null)) return 'excluded';
    if (this.deps.isBusy(id)) return 'busy';

    const target = this.auxiliary();
    const subject = processSubject('relink', id);
    const force = options.force === true;
    // lo barato primero: se dispara tras CADA envio de una enganchada, y sin esto
    // cada uno descifraria la conversacion entera para no hacer nada
    //
    // Una `applied` que aun guarda su texto NO se salta: puede haber cumplido
    // ya —la memoria sellada despues salio de ella— y entonces ese texto esta
    // en disco sin que nada lo lea. Se mira una vez y se borra (octava ronda).
    // Una `ready` tampoco se salta nunca, y por lo mismo puede ser un resto
    // (abajo). Ni una fila cuyo turno partio de lo heredado sin poder apuntarlo
    if (!force && !excluded && !unnoted && early !== undefined) {
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
    // el turno partio de lo heredado y no pudo apuntarlo: se apunta ahora, antes
    // de decidir. Con otro enganche ya no dice nada de este
    const unnotedFor = this.inheritedUnnoted.get(id);
    if (unnotedFor !== undefined) {
      try {
        if (unnotedFor !== owner.winningEventId || (await this.markInheritedPending(id, owner))) {
          this.inheritedUnnoted.delete(id);
        }
      } catch {
        // se queda apuntado para la pasada siguiente; lo demas sigue igual
      }
    }
    let entry = await relinks.forConversation(openVault, id);
    // un texto reescrito que ya no puede valer —desatado de la sellada o de un
    // enganche que ya no gana— esta en disco sin que nada lo lea. Tres caminos
    // llegan aqui: una `applied` ya cumplida (octava ronda), un «Soltar» que no
    // pudo quitar la fila y un «Borrar su memoria» que choco con una reescritura
    // recien terminada y no pudo apuntar la fila al final. Tambien en una
    // excluida: soltar no llama a nadie (decima ronda). Atado otra vez ya no puede quedar: la sellada solo avanza y el
    // enganche no vuelve. Se suelta y se sigue, porque una `ready` desatada aun
    // puede tener que reescribirse sobre la sellada nueva
    if (entry !== undefined && entry.memory !== null && !relinkApplies(entry, owner, refOf(sealed))) {
      const cleared: MemoryRelinkEntry = { ...entry, memory: null, updatedAt: this.deps.now() };
      // compare-and-set: si algo la cambio entre medias, ya se mirara otra vez
      if (!(await relinks.replace(openVault, id, entry, cleared))) return 'stale';
      entry = cleared;
    }
    if (excluded) return 'excluded';
    const phase = relinkPhase(entry, owner, refOf(sealed));
    // solo lo que la espera atribuyo a la conversacion, y solo mientras la
    // salta: un fallo del CLI no la deja fuera, lo frena la espera, aqui abajo
    // (`INV-FONDO-001`); y lo suyo se vuelve a probar pasado un par de horas,
    // no al reiniciar (decimotercera ronda)
    const blocked = this.cooldown.blocked(target, subject);
    const needsRun = (failedThisSession: LocalCliProvider | null): boolean =>
      relinkNeedsRun({ phase, entry, provider: target.provider, force, failedThisSession });
    if (!needsRun(blocked ? target.provider : null)) {
      // saltada SOLO por la espera no es lo mismo que nada que hacer: `skipped`
      // la daba por vista hasta cerrar la boveda, y nadie la volvia a probar
      // pasadas las dos horas
      return blocked && needsRun(null) ? 'blocked' : 'skipped';
    }
    if (sealed === null || owner.winningEventId === null || owner.characterId === null) {
      return 'no-memory';
    }
    // el CLI espera tras un fallo de su proceso: no se lanza, y la fila sigue
    // pendiente para cuando acabe. El boton (`force`) puede probar una vez
    if (!force && this.cooldown.waiting(target)) return 'waiting';

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
    let failureReason: ProviderFailureReason | null = null;
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
      // con un fallo del proceso, `text` es como mucho el mensaje del error:
      // leerlo como respuesta lo daba por `invalid` y lo guardaba como tal
      if (isProcessFailure(turn)) {
        failureReason = turn.failureReason ?? null;
        throw new Error('sin terminar');
      }
      text = turn.text;
    } catch {
      if (this.stopped(generation)) {
        this.logOutcome('cut', target.provider, null, started, force);
        return 'cut';
      }
      // nada en disco: ni fila `failed` ni `invalid`. De quien es lo decide la
      // espera: del CLI, espera; de la conversacion, va al final de la cola; y
      // si la espera la da por suya, la salta un par de horas sin frenar a
      // nadie (`AuxiliaryCooldown.blocked`), y al volver a probarse va al final
      const verdict = this.cooldown.noteFailure(target, failureReason, subject);
      this.processFailed.set(id, target.provider);
      this.logOutcome('process', target.provider, null, started, force, {
        label: processFailureLabel(failureReason),
        verdict,
      });
      return 'process';
    }
    // contesto, con lo que sea: el proceso funciona y la espera se acaba
    this.cooldown.noteSuccess(target, subject);
    this.processFailed.delete(id);

    const parsed = parseMemoryRelinkResponse(text);
    // se clasifica SOLO sin bloque que valga, y solo lo de fuera del bloque: una
    // memoria que habla de la escena no es una negativa
    const refused =
      parsed.status !== 'structured' &&
      classifyReply(textOutsideRelinkBlock(text)).kind === 'refused';
    const decision = decideRelink({ previous, parsed, refused });

    // la llamada es lo que mas tarda: aqui dentro cabe un cierre, un envio y un
    // «soltar». Lo que ya no describe lo que hay se tira
    if (this.stopped(generation)) {
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
    failure: { label: ProcessFailureLabel; verdict: ProcessFailureVerdict } | null = null,
  ): void {
    this.deps.log('memoria reescrita con su ficha', {
      resultado: outcome,
      proveedor: provider,
      forzada: force,
      // solo con `process`: el enum del agente, nunca lo que escribio el CLI
      motivoFallo: failure?.label ?? null,
      // solo con `process`: de quien era el fallo, tambien un enum
      atribucion: failure?.verdict ?? null,
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
      // el total de subclaves derivadas desde que se abrio (`INV-LLAVE-001`)
      derivaciones: this.deps.vault.derivationCount,
    });
  }
}
