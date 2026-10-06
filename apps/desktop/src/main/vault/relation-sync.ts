// quien lee las conversaciones y apunta lo que quedo pendiente entre los dos.
//
// Es la unica via de captura: la misma funcion, el mismo cursor y la misma
// ventana para las conversaciones antiguas y para los turnos nuevos. Una sola
// forma de entrar significa que lo que se prueba aqui vale para las dos.
//
// NUNCA gasta una llamada de pago. El objetivo sale de `resolveAuxiliaryTarget`,
// que solo devuelve Claude o Codex, y ademas se vuelve a comprobar aqui: un
// archivo de preferencias tocado a mano no puede colar una API que se cobra por
// llamada. El turno de roleplay sigue siendo una sola llamada, y esta pasada
// corre aparte, por detras.
//
// Nada de lo que pase aqui puede costarle un turno al usuario: todo lo que se
// dispara solo va sin esperar y con su propio try/catch. Un CLI que se niega, un
// bloqueo de la boveda a mitad o un modelo que contesta cualquier cosa dejan el
// cursor donde estaba, que es lo peor que puede pasar.
//
// Y el fallo de una conversacion se queda EN esa conversacion: se marca, se
// salta el resto de la sesion y la tanda sigue con las demas. Sin eso, una sola
// conversacion ilegible —que ademas falla siempre igual— volvia a ser la primera
// candidata en cada disparo y la pasada no avanzaba nunca.
//
// Salvo que lo que falle sea el PROCESO del CLI (`INV-FONDO-001`): eso no es de
// la conversacion, es del CLI, y se apunta en la espera por proveedor que
// comparten los cuatro trabajos de fondo (`auxiliary-cooldown.ts`). La
// conversacion solo pasa al final de la cola, para que una que falle sola no
// sea siempre la primera; no se bloquea, porque con el CLI arreglado tiene que
// volver a leerse sin reiniciar Studio.
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AUXILIARY_PROVIDER,
  RELATION_CONTEXT_TURNS,
  RELATION_EXTRACTOR_VERSION,
  RELATION_WINDOW_TURNS,
  buildRelationExtractionPrompt,
  countClippedRelationTurns,
  isLocalCliProvider,
  offerOpenRelations,
  parseRelationExtraction,
  redact,
  relationCountersSchema,
  resolveAuxiliaryTarget,
  verifyRelationExtraction,
  type LocalCliProvider,
  type ProviderFailureReason,
  type ReasoningEffort,
  type RelationCounters,
  type RelationCursor,
  type RelationNote,
  type TemporalAnchor,
  type VerifiedRelationExtraction,
} from '@luxy/shared';
import {
  AuxiliaryCooldown,
  LaunchPermit,
  isProcessFailure,
  processFailureLabel,
  processSubject,
  type ProcessFailureLabel,
  type ProcessFailureVerdict,
} from './auxiliary-cooldown.js';
import { RELATION_REFUSAL_VERSION } from './relation-refusal.js';
import { mergeExtraction, type OwnedRelationNote } from './relation.js';
import type { PrivateConversationStore } from './conversation-store.js';
import type { MemoryPreferences } from './memory-preferences.js';
import type { RelationStore } from './relation-store.js';
import type { VaultService } from './vault-service.js';

/** conversaciones por tanda; cada una es una llamada al CLI */
export const RELATION_DEFAULT_LIMIT = 3;

/** el ultimo fallo del proceso de una tanda, para el registro: dos enums */
interface ProcessFailureNote {
  label: ProcessFailureLabel | null;
  verdict: ProcessFailureVerdict | null;
}

/**
 * turnos sin revisar que hacen que una conversacion se mire nada mas contestar.
 *
 * Cuatro, y no uno, para que salga media llamada de suscripcion por turno. No se
 * pierde nada esperando: hasta que se apunta, la promesa sigue literal en los
 * ultimos turnos que ya viajan dentro del prompt.
 */
export const RELATION_IMMEDIATE_TURNS = 4;

/** silencio despues del cual se repasa lo que quedo a medias */
export const RELATION_IDLE_MS = 3 * 60 * 1000;

/** y cuantas OTRAS conversaciones se miran en ese repaso */
export const RELATION_IDLE_OTHERS = 2;

/** ...siempre que lleven este rato sin turnos: no se toca lo que sigue vivo */
export const RELATION_IDLE_QUIET_MS = 10 * 60 * 1000;

/**
 * el dueño de una nota cuya conversacion de origen ya no esta.
 *
 * Un caracter que ningun personaje puede tener en su identificador: asi la nota
 * no se ofrece a nadie —no hay turno contra el que verificar su cita— pero
 * tampoco se confunde con las de los hilos sin personaje, que si son de alguien:
 * de nadie (`D-062`). Se escribe con `fromCharCode` porque un NUL literal dentro
 * de un archivo de codigo lo convierte en binario para media herramienta.
 */
const OWNER_GONE = `${String.fromCharCode(0)}sin-conversacion`;

/** un turno tal y como hace falta para ordenar y para saber que queda por leer */
export interface RelationSyncTurn {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  createdAt: string;
}

/**
 * lo unico que se necesita del controlador del agente.
 *
 * Va como interfaz y no como la clase entera para poder probar la pasada sin
 * arrancar un CLI: lo que hay que comprobar es que se llama con el proveedor
 * correcto y que su respuesta se lee bien, no que Codex funcione.
 */
export interface AuxiliaryController {
  runLocalTurn(input: {
    localTurnId: string;
    provider: string;
    model: string | null;
    projectAlias: string;
    prompt: string;
    kind?: 'conversation' | 'technical';
    effort?: ReasoningEffort;
  }): Promise<{
    outcome: 'completed' | 'failed' | 'cancelled';
    text: string;
    error: string | null;
    executedModel: string | null;
    /**
     * por que fallo el CLI, cuando el agente lo sabe por una señal estructurada.
     * Ausente en un agente anterior: se trata igual que `null`.
     */
    failureReason?: ProviderFailureReason | null;
  }>;
}

export interface RelationSyncDeps {
  vault: VaultService;
  conversations: Pick<PrivateConversationStore, 'list' | 'read'>;
  relations: Pick<RelationStore, 'read' | 'apply'>;
  preferences: Pick<MemoryPreferences, 'auxiliary' | 'excluded'>;
  controller: AuxiliaryController;
  /**
   * cuando se dijo cada turno, sin su texto.
   *
   * Sirve para ordenar las conversaciones y para saber cuales van por detras sin
   * descifrarlas todas en cada tanda. Solo se lee entera la que se va a revisar.
   */
  timeline: () => Promise<readonly RelationSyncTurn[]>;
  /**
   * el carril que se comparte con el catalogo.
   *
   * Los dos mandan el texto de una conversacion a un CLI local; dos a la vez
   * serian dos procesos pesados peleandose, y ademas el segundo leeria un
   * almacen que el primero esta a punto de cambiar.
   */
  lane: <T>(task: () => Promise<T>) => Promise<T>;
  /** true mientras se le esta contestando a esa conversacion */
  isSending: (conversationId: string) => boolean;
  /** el reloj y la zona, inyectados como en `recall` */
  anchor: () => TemporalAnchor;
  log: (message: string, fields?: Record<string, unknown>) => void;
  /**
   * la espera por proveedor que comparten los cuatro trabajos de fondo.
   *
   * Opcional para las pruebas que no la miran: sin ella, cada pasada tiene la
   * suya. En Studio es UNA para todos, o un CLI roto se probaria una vez por
   * trabajo en cada espera.
   */
  cooldown?: AuxiliaryCooldown;
}

export interface RelationRunOptions {
  projectAlias: string;
  /** solo esta conversacion */
  conversationId?: string;
  limit?: number;
  /** turnos sin revisar que tiene que tener para tocarla; por defecto uno */
  minBehind?: number;
  /** ademas, solo las que lleven este silencio */
  quietForMs?: number;
  /** pedida a mano: se reintenta aunque se negara antes */
  force?: boolean;
  /**
   * la ha pedido Daniel con un boton: puede lanzar el CLI UNA vez aunque este
   * en espera tras un fallo del proceso.
   *
   * Va aparte de `force` porque `force` tambien lo usa la relectura que sigue a
   * un enganche, que es automatica y tiene que respetar la espera.
   */
  retryNow?: boolean;
}

export interface RelationRunResult {
  /** conversaciones cuyo cursor avanzo: es lo que dice si vale la pena seguir */
  reviewed: number;
  /** notas nuevas apuntadas */
  notes: number;
  /** notas que este paso cerro */
  closed: number;
  /** conversaciones que no contestaron con el bloque */
  refused: number;
  failed: { conversationId: string; reason: string }[];
  /**
   * las que siguen por revisar AL TERMINAR la tanda.
   *
   * Se recalcula, no se resta: una conversacion larga gasta una ventana por
   * tanda y sigue teniendo cola, asi que restar las intentadas daba cero con
   * trabajo pendiente.
   */
  pending: number;
  /**
   * candidatas de esta tanda que no se mandaron porque el CLI esta en espera
   * tras un fallo de su proceso. Siguen contando en `pending`: se haran solas
   * cuando acabe la espera.
   */
  waiting: number;
}

/** una conversacion que puede tener algo sin revisar */
interface Candidate {
  conversationId: string;
  characterId: string | null;
  /** tiene algun evento de enganche: un cursor anterior al campo `owner` ya no vale */
  linked: boolean;
  /** createdAt del primer turno: el orden de la pasada */
  startedAt: string;
}

/** un turno con su texto, como lo devuelve el almacen de conversaciones */
interface FullTurn {
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

/** lo que se le enseña en una llamada, y hasta donde dejara el cursor */
interface ReviewWindow {
  /** turnos ya revisados que se enseñan marcados, para entender el principio */
  context: FullTurn[];
  /** la PARTE NUEVA: lo unico de donde se puede apuntar o cerrar algo */
  fresh: FullTurn[];
  /** el ultimo turno del personaje de la ventana: hasta ahi llega el cursor */
  last: FullTurn;
}

function zeroCounters(): RelationCounters {
  return relationCountersSchema.parse({});
}

function addCounters(base: RelationCounters, extra: RelationCounters): RelationCounters {
  return {
    proposed: base.proposed + extra.proposed,
    accepted: base.accepted + extra.accepted,
    rejectedShape: base.rejectedShape + extra.rejectedShape,
    rejectedQuote: base.rejectedQuote + extra.rejectedQuote,
    rejectedRole: base.rejectedRole + extra.rejectedRole,
    rejectedWindow: base.rejectedWindow + extra.rejectedWindow,
    rejectedClosure: base.rejectedClosure + extra.rejectedClosure,
    merged: base.merged + extra.merged,
    refused: base.refused + extra.refused,
    clipped: base.clipped + extra.clipped,
  };
}

function withCursor(cursors: readonly RelationCursor[], next: RelationCursor): RelationCursor[] {
  const rest = cursors.filter((cursor) => cursor.conversationId !== next.conversationId);
  return [...rest, next];
}

/** el dueño en vigor de una conversacion, como lo compara un cursor */
export interface ConversationOwnerRef {
  characterId: string | null;
  /** tiene algun evento de enganche, aunque ya se soltara */
  linked: boolean;
}

/**
 * si un cursor se escribio con el dueño que tiene ahora la conversacion.
 *
 * Es una COMPARACION y no un reinicio a proposito: un reinicio lo pisaba una
 * extraccion que ya estaba en marcha, que al terminar escribia un cursor valido
 * de antes del enganche. Asi, esa extraccion escribe un cursor que nace
 * invalido y la siguiente pasada relee.
 *
 * Un cursor SIN el campo es anterior a esta version, cuando no habia eventos:
 * vale solo si la conversacion sigue sin tenerlos. Con eventos se relee, que
 * tambien cubre volver de un Studio anterior que haya quitado el campo al
 * reescribir el archivo.
 */
export function cursorMatchesOwner(
  cursor: Pick<RelationCursor, 'owner'>,
  owner: ConversationOwnerRef,
): boolean {
  if (cursor.owner === undefined) return !owner.linked;
  return cursor.owner === owner.characterId;
}

/**
 * hasta donde se reviso de verdad esta conversacion.
 *
 * Un cursor deja de valer en tres casos, y los tres vuelven a poner la
 * conversacion entera por delante: lo apunto una version anterior del extractor,
 * el turno al que apunta ya no esta, o su fecha no casa porque el numero se
 * reutilizo al retirar un mensaje sin respuesta. Volver a extraer no duplica
 * nada —el id de una nota es determinista—, asi que ante la duda se relee.
 */
export function effectiveThrough(
  cursor: RelationCursor | undefined,
  turns: readonly { sequence: number; createdAt: string }[],
  owner: ConversationOwnerRef,
): number {
  if (cursor === undefined) return -1;
  if (cursor.version < RELATION_EXTRACTOR_VERSION) return -1;
  // lo reviso otro dueño: sus notas se apuntaron con otras abiertas delante y
  // otro personaje como dueño, asi que no cuenta como revisado (`D-103`)
  if (!cursorMatchesOwner(cursor, owner)) return -1;
  if (cursor.through < 0) return -1;

  const turn = turns.find((each) => each.sequence === cursor.through);
  if (turn === undefined) return -1;
  if (cursor.throughAt !== null && cursor.throughAt !== turn.createdAt) return -1;
  return cursor.through;
}

/**
 * true si esa conversacion ya se nego y no ha crecido desde entonces.
 *
 * Una negativa no se reintenta sola: con contenido explicito, el mismo CLI va a
 * volver a negarse y cada intento cuesta el arranque del proceso. Vuelve a
 * entrar cuando hay turnos nuevos o cuando sube la version del extractor.
 *
 * Solo cuentan las apuntadas con `RELATION_REFUSAL_VERSION`: las de antes eran
 * fallos del proceso tomados por negativas (`INV-FONDO-001`) y ya no frenan
 * nada (`relation-refusal.ts`).
 *
 * `provider` es quien haria el trabajo AHORA. Quien se nego fue un CLI concreto,
 * y el otro puede aceptar perfectamente lo que este rechazo: sin este parametro,
 * cambiar el selector del panel no servia de nada y el aviso «prueba con el
 * otro» prometia algo que el codigo no permitia. Sin pasarlo se comporta como
 * antes —da igual quien fuera—, que es lo que quiere el diagnostico cuando
 * cuenta negativas persistidas.
 */
export function refusedStill(
  cursor: RelationCursor | undefined,
  turns: number,
  provider?: LocalCliProvider,
): boolean {
  if (cursor === undefined) return false;
  if (cursor.refusedVersion === null || cursor.refusedVersion < RELATION_REFUSAL_VERSION) {
    return false;
  }
  if (provider !== undefined && cursor.provider !== provider) return false;
  return cursor.refusedAtTurns !== null && turns <= cursor.refusedAtTurns;
}

/** el ultimo turno del personaje, que es lo unico que un cursor puede señalar */
export function lastReviewableOf(
  turns: readonly { sequence: number; role: string }[],
): number | null {
  let last: number | null = null;
  for (const turn of turns) {
    if (turn.role === 'assistant') last = turn.sequence;
  }
  return last;
}

/**
 * la ventana que se le enseña, y hasta donde llegara el cursor.
 *
 * Nunca se lee un mensaje del usuario sin respuesta: el almacen lo retira si el
 * turno falla y reutiliza su numero, asi que darlo por revisado perderia lo que
 * de verdad se diga despues. Por eso la parte nueva termina SIEMPRE en un turno
 * del personaje, y el cursor apunta a ese.
 */
export function relationWindow(turns: readonly FullTurn[], through: number): ReviewWindow | null {
  const ordered = [...turns].sort((a, b) => a.sequence - b.sequence);
  const lastReviewable = lastReviewableOf(ordered);
  if (lastReviewable === null || lastReviewable <= through) return null;

  const candidates = ordered.filter(
    (turn) => turn.sequence > through && turn.sequence <= lastReviewable,
  );
  if (candidates.length === 0) return null;

  let fresh = candidates.slice(0, RELATION_WINDOW_TURNS);
  while (fresh.length > 0 && fresh[fresh.length - 1]!.role !== 'assistant') fresh.pop();
  if (fresh.length === 0) {
    // una tirada de cuarenta mensajes seguidos del usuario: la ventana se alarga
    // hasta la primera respuesta en vez de quedarse sin cursor que avanzar
    const firstReply = candidates.findIndex((turn) => turn.role === 'assistant');
    if (firstReply < 0) return null;
    fresh = candidates.slice(0, firstReply + 1);
  }

  const first = fresh[0]!;
  const startsAt = ordered.findIndex((turn) => turn.sequence === first.sequence);
  const context = ordered.slice(Math.max(0, startsAt - RELATION_CONTEXT_TURNS), startsAt);
  return { context, fresh, last: fresh[fresh.length - 1]! };
}

/**
 * el carril del trabajo de fondo: una tarea cada vez.
 *
 * Lo comparten el catalogo y esto porque los dos arrancan un CLI local con el
 * texto de una conversacion entera. Dos a la vez no solo doblan la memoria y la
 * CPU: el segundo lee un almacen que el primero esta a punto de reescribir, que
 * es como el catalogo llego a catalogar dos veces la misma conversacion.
 *
 * El que llega espera al anterior en vez de rechazarse: quien lo pidio quiere el
 * resultado, y despues del primero la lista de pendientes ya esta al dia.
 */
export function createAuxiliaryLane(): <T>(task: () => Promise<T>) => Promise<T> {
  let inFlight: Promise<unknown> | null = null;

  return async <T>(task: () => Promise<T>): Promise<T> => {
    while (inFlight !== null) await inFlight.catch(() => undefined);
    // entre estas dos lineas no hay ningun `await`, asi que nadie puede colarse
    const run = task();
    inFlight = run;
    try {
      return await run;
    } finally {
      // solo el dueño del carril lo libera: soltarlo a ciegas dejaria pasar a un
      // tercero mientras el segundo sigue dentro
      if (inFlight === run) inFlight = null;
    }
  };
}

function promptTurn(turn: FullTurn): {
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
} {
  return { sequence: turn.sequence, role: turn.role, text: turn.text };
}

/**
 * apunta las promesas y los planes de lo ya hablado.
 *
 * Se construye con todo inyectado —el controlador incluido— porque lo que hay
 * que poder probar es justo lo que no se puede ejecutar en una prueba: que el
 * proveedor nunca es de pago, que el cursor solo avanza cuando la respuesta vale
 * y que una negativa no arrastra a las demas conversaciones.
 */
export class RelationSync {
  /**
   * conversaciones que fallaron en esta sesion, con el CLI con el que fallaron.
   *
   * Igual que `catalogFailures`: sin esto, una que falle siempre se reintenta en
   * cada disparo y se lleva la tanda entera. Se olvida al reiniciar, que es
   * cuando tiene sentido volver a probar.
   *
   * Guarda CON QUE fallo por el mismo motivo que el cursor guarda quien se nego:
   * un Codex que no arranca no dice nada de Claude, y cambiar de CLI en el panel
   * tiene que volver a intentarlo.
   *
   * Un fallo del PROCESO del CLI no entra nunca (decimotercera ronda). Va a la
   * espera por lanzamiento y a `processFailed`, que no bloquea
   * (`INV-FONDO-001`); y si la espera lo atribuye a la conversacion, ella la
   * salta un par de horas (`AuxiliaryCooldown.blocked`), no la sesion: un fallo
   * del CLI entero mal reconocido la dejaba fuera hasta reiniciar.
   */
  private readonly failures = new Map<string, LocalCliProvider>();

  /**
   * conversaciones cuyo ultimo intento en esta sesion acabo en un fallo del
   * PROCESO, con el CLI que fallo.
   *
   * No las bloquea: las pone al final de la cola. Con el CLI roto la espera ya
   * impide lanzarlo, y con una conversacion que falla sola —un tiempo agotado—
   * esto evita que sea siempre la primera y tape a las demas. Se borra en cuanto
   * esa conversacion recibe una respuesta, de la clase que sea.
   */
  private readonly processFailed = new Map<string, LocalCliProvider>();

  private readonly cooldown: AuxiliaryCooldown;

  private idle: ReturnType<typeof setTimeout> | null = null;
  /** la ultima conversacion contestada, para el repaso por silencio */
  private lastConversationId: string | null = null;
  private lastProjectAlias: string | null = null;
  private running = false;

  constructor(private readonly deps: RelationSyncDeps) {
    this.cooldown = deps.cooldown ?? new AuxiliaryCooldown();
  }

  /** true mientras hay una extraccion en curso; para medir, no para decidir */
  get busy(): boolean {
    return this.running;
  }

  /**
   * true si el CLI que hace ahora el trabajo de fondo esta en espera tras un
   * fallo de su proceso. Lo lee el diagnostico: con esto, `quedan` mayor que
   * cero se puede leer como «esperando al CLI» y no como «por leer».
   */
  get waitingForProcess(): boolean {
    return this.cooldown.waiting(this.auxiliary());
  }

  /**
   * cuantas conversaciones fallaron en esta sesion, de cualquier forma.
   *
   * Lo lee el diagnostico: una pasada que se queda por detras y una pasada que
   * ya lo intento y se quedo sin poder se ven igual en `behind`, y solo esta
   * cifra las distingue.
   */
  get failedThisSession(): number {
    return this.failedConversations.size;
  }

  /**
   * cuales son, para que la seleccion no las cuente como desfase.
   *
   * Una conversacion que no se ha podido leer deja turnos sin extraer que no se
   * van a extraer hoy. Si la guarda de desfase los cuenta, TODAS las promesas
   * anteriores se callan durante toda la sesion y lo unico que queda es un
   * contador en otra pantalla. Se trata igual que una negativa persistida, que
   * ya estaba exceptuada por este mismo motivo. Las que fallaron por el
   * proceso del CLI cuentan igual: hasta que el CLI vuelva, tampoco se leen.
   */
  get failedConversations(): ReadonlySet<string> {
    return new Set([...this.failures.keys(), ...this.processFailed.keys()]);
  }

  /**
   * olvida que esa conversacion fallo en esta sesion.
   *
   * Tras cambiar su dueño, el fallo de antes no dice nada: se revisaba con otro
   * personaje. Sin esto, la relectura que el cambio exige se saltaria.
   */
  forgetFailure(conversationId: string): void {
    this.failures.delete(conversationId);
    this.processFailed.delete(conversationId);
  }

  /**
   * relee una conversacion entera, en segundo plano, tras cambiar su dueño.
   *
   * Una tanda revisa una ventana de 40 turnos (`RELATION_WINDOW_TURNS`), asi que
   * una conversacion larga necesita varias: se repite hasta que no avanza o se
   * acaban las vueltas. Devuelve cuantas tandas hizo. No lanza nunca: un fallo
   * del trabajo de fondo no puede llegar a ninguna pantalla (`D-088`).
   */
  async reviewConversation(input: {
    conversationId: string;
    projectAlias: string;
    rounds: number;
  }): Promise<number> {
    let done = 0;
    for (let round = 0; round < Math.max(0, input.rounds); round += 1) {
      if (!this.deps.vault.isUnlocked()) break;
      let reviewed = 0;
      try {
        const result = await this.runOnce({
          projectAlias: input.projectAlias,
          conversationId: input.conversationId,
          limit: 1,
          force: true,
        });
        reviewed = result.reviewed;
      } catch (error) {
        this.deps.log('no se pudieron apuntar los pendientes', {
          motivo: redact(error instanceof Error ? error.message : String(error)),
        });
        break;
      }
      done += 1;
      if (reviewed === 0) break;
    }
    return done;
  }

  /** cancela el temporizador. Se engancha a `vault.onLock` */
  cancel(): void {
    if (this.idle === null) return;
    clearTimeout(this.idle);
    this.idle = null;
  }

  /**
   * una tanda. Va por el carril compartido, asi que nunca hay dos CLI a la vez.
   *
   * Quien la llama NO debe envolverla otra vez en el carril: se esperaria a si
   * misma.
   */
  async runOnce(options: RelationRunOptions): Promise<RelationRunResult> {
    return this.deps.lane(() => this.review(options));
  }

  /**
   * despues de contestar un turno privado.
   *
   * Primero el temporizador y despues el disparo inmediato: si el orden fuera el
   * otro, una extraccion larga retrasaria el rearme y el repaso por silencio se
   * dispararia tarde. No espera a nada y no lanza nunca.
   */
  async afterTurn(input: {
    conversationId: string;
    projectAlias: string;
    /** sin respuesta escrita no hay nada nuevo que leer */
    wroteReply: boolean;
    /** primera vuelta de una conversacion nueva */
    firstTurn: boolean;
  }): Promise<void> {
    if (!input.wroteReply) return;

    this.lastConversationId = input.conversationId;
    this.lastProjectAlias = input.projectAlias;
    this.restartIdle();

    await this.safely({
      projectAlias: input.projectAlias,
      conversationId: input.conversationId,
      limit: 1,
      minBehind: RELATION_IMMEDIATE_TURNS,
    });

    // al empezar una conversacion nueva, la anterior se quedo a medias y ya no
    // va a recibir mas turnos que la disparen
    if (input.firstTurn) {
      await this.safely({ projectAlias: input.projectAlias, limit: 1 });
    }
  }

  private restartIdle(): void {
    this.cancel();
    const timer = setTimeout(() => {
      this.idle = null;
      void this.onIdle();
    }, RELATION_IDLE_MS);
    // un temporizador de fondo no puede ser el motivo de que el proceso siga
    // vivo. En el navegador `setTimeout` devuelve un numero y no tiene `unref`
    if (typeof timer !== 'number') timer.unref();
    this.idle = timer;
  }

  private async onIdle(): Promise<void> {
    // la boveda puede haberse cerrado en estos tres minutos: sin ella no hay
    // llave con la que sellar, y forzarlo solo produciria un error
    if (!this.deps.vault.isUnlocked()) return;
    const projectAlias = this.lastProjectAlias;
    if (projectAlias === null) return;

    if (this.lastConversationId !== null) {
      await this.safely({ projectAlias, conversationId: this.lastConversationId, limit: 1 });
    }
    await this.safely({
      projectAlias,
      limit: RELATION_IDLE_OTHERS,
      quietForMs: RELATION_IDLE_QUIET_MS,
    });
  }

  /** lo que se dispara solo: un fallo aqui no puede llegar a ninguna pantalla */
  private async safely(options: RelationRunOptions): Promise<void> {
    try {
      await this.runOnce(options);
    } catch (error) {
      this.deps.log('no se pudieron apuntar los pendientes', {
        motivo: redact(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  private async review(options: RelationRunOptions): Promise<RelationRunResult> {
    const result: RelationRunResult = {
      reviewed: 0,
      notes: 0,
      closed: 0,
      refused: 0,
      failed: [],
      pending: 0,
      waiting: 0,
    };
    if (!this.deps.vault.isUnlocked()) return result;

    this.running = true;
    try {
      return await this.sweep(options, result);
    } finally {
      this.running = false;
    }
  }

  private async sweep(
    options: RelationRunOptions,
    result: RelationRunResult,
  ): Promise<RelationRunResult> {
    const limit = options.limit ?? RELATION_DEFAULT_LIMIT;
    const target = this.auxiliary();

    const snapshot = await this.deps.relations.read(this.deps.vault);
    const summaries = await this.deps.conversations.list(this.deps.vault);
    const owners = new Map(summaries.map((each) => [each.conversationId, each.characterId]));
    const linked = new Set(
      summaries.filter((each) => each.ownerLinked === true).map((each) => each.conversationId),
    );
    const cursors = new Map(snapshot.cursors.map((cursor) => [cursor.conversationId, cursor]));

    const candidates = this.pending(
      await this.deps.timeline(),
      owners,
      linked,
      cursors,
      target,
      options,
    );
    result.pending = Math.max(0, candidates.length - Math.min(candidates.length, limit));

    const permit = new LaunchPermit(this.cooldown, options.retryNow === true);
    // el motivo del ultimo fallo del proceso de esta tanda, y de quien era, para
    // el registro
    const processFailure: ProcessFailureNote = { label: null, verdict: null };
    const batch = candidates.slice(0, limit);
    for (const [index, candidate] of batch.entries()) {
      // entre conversacion y conversacion se vuelve a mirar: cerrar la boveda
      // durante una pasada larga tiene que pararla, no llenar el log de errores
      if (!this.deps.vault.isUnlocked()) break;
      // el CLI en espera tras un fallo de su proceso: ni se descifra la
      // conversacion. Las que quedan de la tanda tampoco irian, asi que se
      // cuentan y se para (`INV-FONDO-001`)
      if (!permit.allows(target)) {
        result.waiting += batch.length - index;
        break;
      }
      try {
        await this.reviewOne(candidate, owners, target, options, result, permit, processFailure);
      } catch (error) {
        // el try de dentro solo cubre la llamada al CLI. Fuera quedan descifrar
        // la conversacion, leer el almacen y guardar, y cualquiera de esas tres
        // puede fallar SIEMPRE para la misma conversacion: un turno que no se
        // abre, un sobre corrupto. Sin esto, la excepcion salia de la tanda
        // entera, la conversacion no quedaba marcada y, como el orden es
        // cronologico, volvia a ser la primera candidata en cada disparo: la
        // pasada no avanzaba nunca y reiniciar no lo arreglaba.
        //
        // Salvo que el fallo sea que la boveda se cerro a mitad: eso no es culpa
        // de la conversacion, y marcarla la dejaba fuera de las pasadas hasta
        // reiniciar. Leer ya no mantiene viva la boveda (`D-106`), asi que pasa.
        // El cursor no ha avanzado —lo que lanza es el guardado— (`D-088`)
        if (!this.deps.vault.isUnlocked()) break;
        this.failures.set(candidate.conversationId, target.provider);
        result.failed.push({
          conversationId: candidate.conversationId,
          reason: redact(error instanceof Error ? error.message : String(error)),
        });
      }
    }

    // sin candidatas no hay nada que recalcular, y el caso corriente —el disparo
    // despues de cada turno, que casi siempre no toca nada— no paga otra lectura
    // del almacen
    if (candidates.length > 0) {
      result.pending = await this.remaining(owners, linked, target, options, result.pending);
    }

    // ni una cita, ni una palabra clave, ni de que conversacion: solo cuantas
    this.deps.log('pendientes extraidos', {
      conversaciones: result.reviewed,
      apuntados: result.notes,
      cerrados: result.closed,
      negativas: result.refused,
      fallidas: result.failed.length,
      quedan: result.pending,
      // las que no se mandaron porque el CLI espera tras un fallo de su
      // proceso: sin esto, `quedan` no dice si es cola o espera
      enEspera: result.waiting,
      // el enum del agente, nunca su mensaje; `null` sin fallo del proceso
      motivoFallo: processFailure.label,
      // de quien era ese fallo: del CLI, de la conversacion o ya repetido
      atribucion: processFailure.verdict,
      proveedor: target.provider,
      // el total de subclaves derivadas desde que se abrio la boveda: restando
      // lineas seguidas se ve cuanto cuesta cada pasada (`INV-LLAVE-001`)
      derivaciones: this.deps.vault.derivationCount,
    });
    return result;
  }

  /**
   * lo que queda por revisar DESPUES de la tanda.
   *
   * No es «las que quedaban menos las que se han intentado». Una conversacion de
   * mas de 40 turnos gasta una ventana por tanda y sigue teniendo cola, asi que
   * la cuenta de antes daba cero con trabajo sin hacer: el bucle del panel
   * cortaba, el mensaje decia que no quedaba nada y esos turnos sin extraer
   * bloqueaban por desfase todas las promesas del personaje.
   *
   * Se recalcula con los MISMOS filtros que eligieron las candidatas —lo
   * excluido, lo que se esta contestando, lo fallido y lo negado—, porque
   * contar turnos por detras a secas dejaria una conversacion rota en la cuenta
   * para siempre y el panel quemaria sus doce vueltas arrancando el CLI.
   */
  private async remaining(
    owners: ReadonlyMap<string, string | null>,
    linked: ReadonlySet<string>,
    target: { provider: LocalCliProvider; model: string | null },
    options: RelationRunOptions,
    fallback: number,
  ): Promise<number> {
    // la boveda puede haberse cerrado a mitad: entonces no hay con que leer el
    // almacen y la estimacion de antes es lo unico que se puede decir
    if (!this.deps.vault.isUnlocked()) return fallback;
    try {
      const snapshot = await this.deps.relations.read(this.deps.vault);
      const cursors = new Map(snapshot.cursors.map((cursor) => [cursor.conversationId, cursor]));
      // siempre SIN `force`: lo que queda es lo que la pasada va a hacer sola.
      // Contando lo que se acaba de negar, una tanda pedida a mano diria que
      // sigue quedando trabajo y el panel daria una vuelta de mas
      return this.pending(await this.deps.timeline(), owners, linked, cursors, target, {
        ...options,
        force: false,
      }).length;
    } catch {
      return fallback;
    }
  }

  /**
   * a quien se le manda, comprobado dos veces.
   *
   * `resolveAuxiliaryTarget` se fia del tipo de la preferencia, que es lo
   * correcto en un modulo puro. Aqui no: el archivo esta en disco y se puede
   * tocar a mano, y colar ahi «deepseek» costaria una llamada de pago por
   * conversacion, que es justo lo que este camino existe para impedir.
   */
  private auxiliary(): { provider: LocalCliProvider; model: string | null } {
    const target = resolveAuxiliaryTarget(null, this.deps.preferences.auxiliary());
    if (isLocalCliProvider(target.provider)) {
      return { provider: target.provider, model: target.model };
    }
    return { provider: DEFAULT_AUXILIARY_PROVIDER, model: null };
  }

  /**
   * las conversaciones que pueden tener algo sin revisar, de la mas antigua a la
   * mas nueva.
   *
   * El orden cronologico importa: al llegar a la conversacion del dia 4 ya existe
   * la promesa del dia 1, asi que se puede cerrar. Y como las abiertas que se
   * ofrecen se filtran ademas por fecha, una ventana antigua procesada fuera de
   * orden en un reintento tampoco puede cerrar una promesa del futuro.
   */
  private pending(
    timeline: readonly RelationSyncTurn[],
    owners: ReadonlyMap<string, string | null>,
    linked: ReadonlySet<string>,
    cursors: ReadonlyMap<string, RelationCursor>,
    target: { provider: LocalCliProvider; model: string | null },
    options: RelationRunOptions,
  ): Candidate[] {
    const excluded = this.deps.preferences.excluded();
    const minBehind = options.minBehind ?? 1;
    const now = Date.parse(this.deps.anchor().instant);

    const grouped = new Map<string, RelationSyncTurn[]>();
    for (const turn of timeline) {
      const own = grouped.get(turn.conversationId);
      if (own === undefined) grouped.set(turn.conversationId, [turn]);
      else own.push(turn);
    }

    const candidates: Candidate[] = [];
    for (const [conversationId, turns] of grouped) {
      if (options.conversationId !== undefined && conversationId !== options.conversationId) {
        continue;
      }
      if (excluded.has(conversationId)) continue;
      // una conversacion con un envio en curso se queda para la vuelta
      // siguiente: sus turnos estan cambiando mientras se lee
      if (this.deps.isSending(conversationId)) continue;
      // haber fallado con un CLI no dice nada del otro: cambiar el selector del
      // panel tiene que volver a intentarlo, igual que con una negativa
      if (!options.force && this.failures.get(conversationId) === target.provider) continue;
      // su proceso falla por su cuenta: se salta un rato y despues se prueba
      // una vez (decimotercera ronda). El boton la prueba igual
      const subject = processSubject('relation', conversationId);
      if (!options.force && this.cooldown.blocked(target, subject)) continue;

      const cursor = cursors.get(conversationId);
      if (!options.force && refusedStill(cursor, turns.length, target.provider)) continue;

      const ordered = [...turns].sort((a, b) => a.sequence - b.sequence);
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      if (first === undefined || last === undefined) continue;

      const lastReviewable = lastReviewableOf(ordered);
      if (lastReviewable === null) continue;

      const owner = {
        characterId: owners.get(conversationId) ?? null,
        linked: linked.has(conversationId),
      };
      const through = effectiveThrough(cursor, ordered, owner);
      const behind = ordered.filter(
        (turn) => turn.sequence > through && turn.sequence <= lastReviewable,
      ).length;
      if (behind < minBehind) continue;

      if (
        options.quietForMs !== undefined &&
        now - Date.parse(last.createdAt) < options.quietForMs
      ) {
        continue;
      }

      candidates.push({
        conversationId,
        characterId: owner.characterId,
        linked: owner.linked,
        startedAt: first.createdAt,
      });
    }

    // las que acaban de fallar por el proceso con este CLI, al final: sin
    // bloquearlas, una que falla sola —un tiempo agotado— no tapa a las demas
    // en cada espera. Entre ellas, el mismo orden cronologico
    const lastly = (id: string): number => (this.processFailed.get(id) === target.provider ? 1 : 0);
    return candidates.sort(
      (a, b) =>
        lastly(a.conversationId) - lastly(b.conversationId) ||
        a.startedAt.localeCompare(b.startedAt) ||
        a.conversationId.localeCompare(b.conversationId),
    );
  }

  private async reviewOne(
    candidate: Candidate,
    owners: ReadonlyMap<string, string | null>,
    target: { provider: LocalCliProvider; model: string | null },
    options: RelationRunOptions,
    result: RelationRunResult,
    permit: LaunchPermit,
    processFailure: ProcessFailureNote,
  ): Promise<void> {
    const { conversationId, characterId } = candidate;

    // la linea temporal puede ir un turno por detras de lo que hay en disco: lo
    // que manda es lo que se acaba de leer, que ademas es lo que trae el texto
    const full = await this.deps.conversations.read(this.deps.vault, conversationId);
    const turns: FullTurn[] = full.map((turn) => ({
      sequence: turn.sequence,
      role: turn.role,
      text: turn.text,
      createdAt: turn.createdAt,
    }));

    const snapshot = await this.deps.relations.read(this.deps.vault);
    const cursor = snapshot.cursors.find((each) => each.conversationId === conversationId);
    const window = relationWindow(
      turns,
      effectiveThrough(cursor, turns, {
        characterId: candidate.characterId,
        linked: candidate.linked,
      }),
    );
    if (window === null) return;

    const anchor = this.deps.anchor();
    const open = offerOpenRelations(this.owned(snapshot.notes, owners), {
      characterId,
      before: window.fresh[0]!.createdAt,
    });

    const prompt = buildRelationExtractionPrompt({
      context: window.context.map(promptTurn),
      turns: window.fresh.map(promptTurn),
      open,
      anchor,
    });

    // la espera puede haber empezado mientras se descifraba: otro trabajo del
    // carril no, pero una tanda anterior de esta misma si
    if (!permit.allows(target)) {
      result.waiting += 1;
      return;
    }
    permit.spend();

    let text: string;
    let executedModel: string | null;
    let failureReason: ProviderFailureReason | null = null;
    try {
      const run = await this.deps.controller.runLocalTurn({
        localTurnId: randomUUID(),
        provider: target.provider,
        model: target.model,
        projectAlias: options.projectAlias,
        prompt,
        // apuntar promesas es una tarea SOBRE un texto: no encarna a nadie
        kind: 'technical',
      });
      if (isProcessFailure(run)) {
        failureReason = run.failureReason ?? null;
        // el mensaje es el del agente, que dice que hacer y nunca copia lo que
        // escribio el CLI. El texto de `run.text` no se mira: con un fallo no
        // es una respuesta, y antes acababa contado como negativa
        throw new Error(run.error ?? 'el trabajo de fondo no llego a terminar');
      }
      text = run.text;
      executedModel = run.executedModel;
    } catch (error) {
      // la boveda se cerro mientras el CLI pensaba: no es culpa del CLI ni de la
      // conversacion, y no se marca nada (`D-106`, `D-088`). La pasada
      // siguiente la vuelve a pedir
      if (!this.deps.vault.isUnlocked()) return;
      // un fallo del PROCESO: ni negativa ni cursor. Si es del CLI, espera; si
      // es de la conversacion, pasa al final de la cola, y si la espera la da
      // por suya se salta un par de horas sin rearmar la espera de nadie
      // (undecima y decimotercera ronda)
      const verdict = this.cooldown.noteFailure(
        target,
        failureReason,
        processSubject('relation', conversationId),
      );
      processFailure.label = processFailureLabel(failureReason);
      processFailure.verdict = verdict;
      // tambien la que es suya: la salta la espera (`blocked`) un par de horas y
      // no la sesion, y cuando vuelva a probarse tiene que ir al final
      this.processFailed.set(conversationId, target.provider);
      result.failed.push({
        conversationId,
        reason: redact(error instanceof Error ? error.message : String(error)),
      });
      return;
    }

    // contesto, con lo que sea: el proceso funciona y la espera se acaba
    this.cooldown.noteSuccess(target, processSubject('relation', conversationId));
    this.processFailed.delete(conversationId);

    const parsed = parseRelationExtraction(text);
    if (parsed.status !== 'structured') {
      await this.persistRefusal(candidate, target, turns.length, anchor.instant);
      result.refused += 1;
      this.failures.set(conversationId, target.provider);
      return;
    }

    const verified = verifyRelationExtraction(parsed, {
      conversationId,
      characterId,
      turns: window.fresh,
      open,
    });

    await this.persist({
      candidate,
      owners,
      verified,
      target,
      executedModel,
      last: window.last,
      now: anchor.instant,
      // cuantos turnos de la ventana no se le enseñaron enteros. Tiene que ser 0
      // con el presupuesto de hoy; si sube, el cursor esta avanzando sobre texto
      // que nadie ha visto y una promesa dicha ahi se pierde en silencio
      clipped: countClippedRelationTurns({ context: window.context, turns: window.fresh }),
      result,
    });
    this.failures.delete(conversationId);
    result.reviewed += 1;
  }

  /**
   * guarda notas, cursor y contadores de una vez.
   *
   * Todo dentro del mismo `apply`, que relee antes de escribir: entre la llamada
   * al CLI y este momento Daniel ha podido dar una promesa por cumplida desde el
   * panel, y `mergeExtraction` respeta lo que el decidio.
   */
  private async persist(input: {
    candidate: Candidate;
    owners: ReadonlyMap<string, string | null>;
    verified: VerifiedRelationExtraction;
    target: { provider: LocalCliProvider; model: string | null };
    executedModel: string | null;
    last: FullTurn;
    now: string;
    /** turnos de la ventana que no cupieron enteros */
    clipped: number;
    result: RelationRunResult;
  }): Promise<void> {
    const { candidate, target } = input;
    await this.deps.relations.apply(this.deps.vault, (current) => {
      const merged = mergeExtraction({
        existing: this.owned(current.notes, input.owners),
        verified: input.verified,
        scope: {
          conversationId: candidate.conversationId,
          characterId: candidate.characterId,
        },
        // lo que despues se enseña como «revisado con Codex»
        extractedBy: (input.executedModel ?? target.provider).slice(0, 128),
        now: input.now,
      });

      input.result.notes += merged.added.length;
      input.result.closed += merged.closed.length;

      return {
        notes: merged.notes,
        cursors: withCursor(current.cursors, {
          conversationId: candidate.conversationId,
          through: input.last.sequence,
          throughAt: input.last.createdAt,
          version: RELATION_EXTRACTOR_VERSION,
          provider: target.provider,
          model: target.model,
          at: input.now,
          // salio bien: si venia de una negativa, deja de estar marcada
          refusedVersion: null,
          refusedAtTurns: null,
          // el dueño con el que se REVISO, capturado al empezar la pasada, no
          // el de ahora: si cambio entre medias, este cursor nace invalido
          owner: candidate.characterId,
        }),
        counters: addCounters(current.counters, {
          ...merged.counters,
          clipped: merged.counters.clipped + input.clipped,
        }),
      };
    });
  }

  /**
   * una respuesta sin bloque: se apunta y el cursor NO avanza.
   *
   * Lo que se guarda es cuantos turnos tenia cuando paso, para no volver a
   * intentarlo hasta que crezca. No hay caida automatica al otro CLI: quien
   * elige quien hace el trabajo de fondo es Daniel, en el panel.
   */
  private async persistRefusal(
    candidate: Candidate,
    target: { provider: LocalCliProvider; model: string | null },
    turns: number,
    now: string,
  ): Promise<void> {
    await this.deps.relations.apply(this.deps.vault, (current) => {
      const previous = current.cursors.find(
        (cursor) => cursor.conversationId === candidate.conversationId,
      );
      return {
        notes: current.notes,
        cursors: withCursor(current.cursors, {
          conversationId: candidate.conversationId,
          // lo ya revisado sigue revisado: negarse ahora no lo borra
          through: previous?.through ?? -1,
          throughAt: previous?.throughAt ?? null,
          version: previous?.version ?? RELATION_EXTRACTOR_VERSION,
          provider: target.provider,
          model: target.model,
          at: now,
          // la version de las NEGATIVAS, no la del extractor: las apuntadas
          // antes eran fallos del proceso y ya no cuentan (`relation-refusal.ts`)
          refusedVersion: RELATION_REFUSAL_VERSION,
          refusedAtTurns: turns,
          // una negativa no reviso nada: no puede certificar con que dueño se
          // reviso `through`, asi que conserva lo que hubiera
          ...(previous?.owner === undefined ? {} : { owner: previous.owner }),
        }),
        counters: addCounters(current.counters, { ...zeroCounters(), refused: 1 }),
      };
    });
  }

  /**
   * cada nota con el dueño que se deduce de su conversacion de origen.
   *
   * Se mapean TODAS, incluidas las de una conversacion que ya no existe: la
   * lista que sale de aqui es la que `mergeExtraction` devuelve como almacen, y
   * quitar una seria borrarla.
   */
  private owned(
    notes: readonly RelationNote[],
    owners: ReadonlyMap<string, string | null>,
  ): OwnedRelationNote[] {
    return notes.map((note) => ({
      note,
      characterId: owners.has(note.origin.conversationId)
        ? (owners.get(note.origin.conversationId) ?? null)
        : OWNER_GONE,
    }));
  }
}
