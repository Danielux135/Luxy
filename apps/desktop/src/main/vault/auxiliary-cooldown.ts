// la espera del trabajo de fondo cuando el PROCESO de un CLI falla
// (`INV-FONDO-001`).
//
// Los cuatro trabajos de fondo —catalogo, pendientes, memoria de lo ya hablado
// y memoria reescrita con su ficha— comparten un carril y un CLI. Cuando ese
// CLI no puede contestar a nadie —Claude Code sin sesion, un limite de uso, el
// agente parado—, el fallo no es de la conversacion que tocaba: es del CLI. Antes
// cada trabajo lo apuntaba por conversacion y para toda la sesion, asi que con
// el CLI roto se probaba una conversacion distinta en cada disparo (una tanda
// del panel podia arrancarlo treinta y seis veces) y, una vez arreglado con
// `claude auth login`, nada volvia a intentarse hasta reiniciar Studio.
//
// Ahora el fallo del proceso se apunta POR LANZAMIENTO y caduca solo: durante la
// espera ningun trabajo automatico lanza ese CLI con ese modelo, y al acabar el
// siguiente disparo prueba UNA vez. Si contesta, la espera se borra y todo
// sigue; si no, vuelve a empezar. Como el carril ejecuta de uno en uno, eso da
// como mucho un intento por espera aunque los cuatro trabajos lo pidan a la vez.
//
// Por lanzamiento —CLI, modelo y esfuerzo— y no por CLI (duodecima ronda): con
// «Automatico» el catalogo va con el modelo y el esfuerzo de la ventana, y los
// otros tres con el CLI a secas. Un fallo que era solo de ese modelo —uno que el
// Codex instalado no soporta— paraba a los cuatro, y la retoma del catalogo lo
// volvia a armar cada diez minutos con el mismo modelo. Solo una cuenta sin
// sesion (`auth`) es del CLI entero, con cualquier modelo.
//
// Solo cuenta el PROCESO. Una negativa o un bloque roto son una respuesta del
// CLI: dicen que funciona, y se quedan con su semantica de siempre (`D-088`).
// Tampoco sustituye nada: la espera no cambia de CLI ni de modelo, solo deja de
// lanzar el que falla (no hay sustituciones silenciosas de proveedor).
//
// Pero no todo fallo del proceso es del CLI (undecima ronda). `auth` y
// `rate_limit` lo son siempre: el CLI no puede contestar a nadie. Los demas
// —un tiempo agotado, un `api_error` o un `turn.failed` por el contexto o la
// moderacion de UN prompt, un codigo de salida sin explicar— pueden ser de una
// sola conversacion. Tratarlos todos como del CLI dejaba que una conversacion
// que falla siempre rearmase la espera de los cuatro trabajos cada diez
// minutos, para siempre: seis lanzamientos por hora y el resto del trabajo de
// fondo frenado detras de ella. Por eso se atribuyen (`noteFailure`), contando
// en TANDAS: una tanda es lo que pasa entre dos respuestas de ese lanzamiento.
//
//  - el primer fallo dudoso desde la ultima respuesta del CLI no frena a
//    nadie: es de esa conversacion mientras no se demuestre otra cosa, y el
//    trabajo la pasa al final de su cola;
//  - si falla otra conversacion distinta en la misma tanda, es del CLI:
//    espera;
//  - si la misma vuelve a fallar sin que el CLI haya contestado a nadie entre
//    medias, no se puede saber: espera, que es lo que limita los intentos;
//  - si vuelve a fallar DESPUES de que el CLI contestara a otra, y la vez de
//    antes fallo sola, es suya: el trabajo la salta y la espera de los demas
//    no se toca;
//  - si vuelve a fallar con la espera que armo ELLA SOLA —puesta o ya pasada—
//    sin que nadie mas haya fallado, tambien es suya (duodecima ronda). Con una
//    sola conversacion activa, el CLI no podia contestar a otra nunca: la
//    espera impide lanzar a nadie mas, y la regla de arriba no llegaba a
//    cumplirse. Era el mismo bucle de seis lanzamientos por hora;
//  - y si ya fallo en DOS tandas distintas, con el CLI contestando a otras entre
//    una y otra, tambien es suya aunque cada vez fallase otra a la vez
//    (decimotercera ronda). Dos conversaciones que fallan siempre por su cuenta
//    se cubrian la una a la otra: cada tanda parecia un apagon del CLI, la
//    segunda borraba lo apuntado a la primera, ninguna llegaba nunca a ser suya
//    y cada vuelta rearmaba la espera de los cuatro trabajos. En un apagon de
//    verdad todas las caidas comparten tanda, y una tanda cuenta una vez.
//
// «Otra» es otra CONVERSACION, no otro trabajo (decimotercera ronda): el
// catalogo y los pendientes de la misma conversacion fallan por lo mismo —su
// texto—, y contarlos como dos distintas hacia del CLI lo que era de ella. Lo
// que se salta, en cambio, si es por trabajo: un catalogo que agota el tiempo
// no dice nada de los pendientes de esa conversacion.
//
// Saltarla no es para siempre (decimotercera ronda). Pasadas dos horas se
// vuelve a probar una vez; si falla otra vez, se salta otras dos. Un fallo del
// CLI entero que no se reconoce como tal —Codex no dice con un codigo cuando
// llega a su limite de uso— dejaba fuera a la conversacion activa el resto de
// la sesion, sin aviso, aunque el limite se renovara horas despues.
//
// No guarda nada en disco y no lleva texto: proveedor, modelo, motivo y dos
// horas. Los identificadores de las conversaciones que han fallado viven solo
// en memoria y no salen de aqui: ni la pantalla ni el registro los ven.
import {
  isLocalCliProvider,
  type LocalCliProvider,
  type ProviderFailureReason,
  type ReasoningEffort,
} from '@luxy/shared';

/**
 * cuanto se espera tras un fallo del proceso antes de volver a lanzar el CLI.
 *
 * Diez minutos. Un intento fallido de Claude Code sin sesion cuesta entre 5 y
 * 13 segundos de un proceso pesado, y los disparos llegan con cada turno —cada
 * uno o dos minutos— y a los tres minutos de silencio: con diez se queda en seis
 * intentos por hora como mucho, en vez de uno por turno. Y es lo bastante corto
 * para que, tras `claude auth login`, el trabajo de fondo se recupere solo en
 * minutos sin reiniciar nada. No crece con los fallos a proposito: una espera
 * que se alarga sola acaba pareciendo que nada se recupera, y aqui cada intento
 * es barato.
 */
export const AUXILIARY_PROCESS_WAIT_MS = 10 * 60 * 1000;

/**
 * cuanto se salta una conversacion cuyo proceso la espera da por suyo.
 *
 * Dos horas (decimotercera ronda). Antes era el resto de la sesion, y Studio
 * pasa dias abierta: un fallo del CLI entero mal reconocido —un limite de uso
 * de Codex, que no lo dice con un codigo— dejaba sin pendientes a la
 * conversacion activa hasta reiniciar. Con dos horas, lo que de verdad es suyo
 * cuesta un intento cada dos horas, y lo que era del CLI se cura solo.
 */
export const AUXILIARY_BLOCK_MS = 2 * 60 * 60 * 1000;

/**
 * lo que se lanza de verdad: el CLI, el modelo y el esfuerzo.
 *
 * `null` (o ausente, el esfuerzo) es «el que traiga el CLI». Es lo mismo que
 * se le pasa al controlador, y por eso la clave de la espera: dos trabajos que
 * lanzan cosas distintas no se frenan entre si.
 */
export interface AuxiliaryLaunch {
  provider: LocalCliProvider;
  model: string | null;
  effort?: ReasoningEffort | null;
}

/** un CLI a secas es ese CLI con su modelo y su esfuerzo por defecto */
export type AuxiliaryLaunchTarget = LocalCliProvider | AuxiliaryLaunch;

/** lo que se sabe del ultimo fallo del proceso de un lanzamiento: enums y horas */
export interface AuxiliaryProcessFailure {
  provider: LocalCliProvider;
  /** el modelo con el que fallo; `null`, el que trae el CLI */
  model: string | null;
  /** el esfuerzo con el que fallo; `null`, el que trae el CLI */
  effort: ReasoningEffort | null;
  /**
   * `true`: la espera es del CLI entero, con cualquier modelo —una cuenta sin
   * sesion—; `model` y `effort` van entonces a `null`
   */
  wholeProvider: boolean;
  /** el motivo estructurado que dio el agente; `null` si no lo dio */
  reason: ProviderFailureReason | null;
  /** cuando fallo, ISO */
  at: string;
  /** desde cuando se vuelve a intentar solo, ISO */
  retryAt: string;
}

/**
 * el motivo tal y como va al registro: el enum del agente, o `sin-motivo`
 * cuando el proceso fallo sin decir por que (el agente parado, un tiempo
 * agotado). `null` es que no hubo fallo del proceso.
 */
export type ProcessFailureLabel = ProviderFailureReason | 'sin-motivo';

/** lo que hace falta de una respuesta del controlador para juzgar el proceso */
export interface AuxiliaryRunVerdict {
  outcome: 'completed' | 'failed' | 'cancelled';
  failureReason?: ProviderFailureReason | null;
}

/**
 * true si el PROCESO no termino bien.
 *
 * `failureReason` manda aunque el final dijera otra cosa: el agente solo lo
 * rellena con una señal estructurada del CLI, y un texto que llega con ella es
 * el mensaje del error, no una respuesta.
 */
export function isProcessFailure(run: AuxiliaryRunVerdict): boolean {
  return run.outcome !== 'completed' || (run.failureReason ?? null) !== null;
}

/** el motivo para el registro: nunca texto, solo el enum */
export function processFailureLabel(
  reason: ProviderFailureReason | null | undefined,
): ProcessFailureLabel {
  return reason ?? 'sin-motivo';
}

/**
 * de quien es un fallo del proceso, segun lo que se sabe del CLI.
 *
 *  - `cli`: del CLI. Se arma la espera de los cuatro trabajos, y la
 *    conversacion pasa al final de la cola del suyo, sin bloquearse;
 *  - `conversation`: el primer fallo dudoso desde la ultima respuesta del CLI.
 *    No frena a nadie: la conversacion pasa al final de la cola;
 *  - `blocked`: es de esa conversacion (las reglas, arriba). El trabajo la salta
 *    `AUXILIARY_BLOCK_MS` y despues la prueba una vez (`blocked()`).
 *
 * Va al registro tal cual: es un enum.
 */
export type ProcessFailureVerdict = 'cli' | 'conversation' | 'blocked';

/** los cuatro trabajos que comparten la espera */
export type AuxiliaryJob = 'catalog' | 'relation' | 'recap' | 'relink';

/**
 * a quien se le apunta un fallo: el trabajo y la conversacion.
 *
 * Con el trabajo dentro porque el mismo texto falla distinto segun lo que se le
 * pida: un catalogo que agota el tiempo no dice nada de los pendientes de esa
 * conversacion, y saltar uno no salta el otro. Pero para decidir si el fallo es
 * del CLI solo cuenta la conversacion: dos trabajos de la misma no son «otra»
 * (decimotercera ronda). Solo vive en memoria, dentro de la espera.
 */
export interface ProcessSubject {
  job: AuxiliaryJob;
  conversationId: string;
}

export function processSubject(job: AuxiliaryJob, conversationId: string): ProcessSubject {
  return { job, conversationId };
}

/** la clave de un sujeto. En JSON por lo mismo que la del lanzamiento */
function subjectKey(subject: ProcessSubject): string {
  return JSON.stringify([subject.job, subject.conversationId]);
}

/** los motivos que dicen por si solos que el CLI no puede contestar a nadie */
function cliWide(reason: ProviderFailureReason | null | undefined): boolean {
  return reason === 'auth' || reason === 'rate_limit';
}

/**
 * los motivos que prueban que el CLI paso la comprobacion de la sesion: el
 * propio CLI clasifico el fallo y no dijo `auth`. Un codigo de salida o un
 * fallo sin motivo no prueban nada: Claude Code sin `stream-json` sale sin
 * sesion con un codigo a secas
 */
function provesSession(reason: ProviderFailureReason | null | undefined): boolean {
  return reason === 'api_error' || reason === 'rate_limit';
}

/** un lanzamiento con todo explicito, para comparar y para enseñarlo */
export interface Launch {
  provider: LocalCliProvider;
  model: string | null;
  effort: ReasoningEffort | null;
}

/**
 * el lanzamiento tal y como lo cuenta la espera. Quien enseñe a la pantalla con
 * que se lanzo tiene que pasar por aqui, o lo que diga no casara con la espera
 */
export function normalizeLaunch(target: AuxiliaryLaunchTarget): Launch {
  if (typeof target === 'string') return { provider: target, model: null, effort: null };
  return {
    provider: target.provider,
    // un modelo vacio es «el que traiga el CLI», igual que `null`: si contaran
    // distinto, el mismo lanzamiento tendria dos esperas
    model: target.model !== null && target.model.length > 0 ? target.model : null,
    effort: target.effort ?? null,
  };
}

/**
 * la clave de un lanzamiento. En JSON y no con un separador: el nombre de un
 * modelo lo puede escribir Daniel a mano y llevar cualquier caracter
 */
function launchKey(launch: Launch): string {
  return JSON.stringify(['launch', launch.provider, launch.model, launch.effort]);
}

/** la clave de la espera del CLI entero: la de una cuenta sin sesion */
function accountKey(provider: LocalCliProvider): string {
  return JSON.stringify(['account', provider]);
}

interface Entry {
  launch: Launch;
  wholeProvider: boolean;
  reason: ProviderFailureReason | null;
  at: number;
  until: number;
  /**
   * las CONVERSACIONES que han fallado con esta espera desde la ultima
   * respuesta, o `null` si la armo un fallo que es del CLI por si solo
   * (`auth`, `rate_limit`, uno sin saber con quien, o mientras la cuenta
   * esperaba). Es lo que deja ver que una espera la armo UNA conversacion sola
   */
  armedBy: Set<string> | null;
}

/** lo apuntado a un sujeto: en que tandas fallo y en cuales fallo sola */
interface Strike {
  conversationId: string;
  /** las tandas —cuantas respuestas llevaba el lanzamiento— en que fallo */
  epochs: Set<number>;
  /**
   * de esas, en las que ninguna otra conversacion fallo con ella. Una tanda en
   * la que fallaron dos es un apagon mientras no se demuestre otra cosa, y no
   * basta por si sola para dejarla fuera
   */
  alone: Set<number>;
}

/** una conversacion saltada en un trabajo: hasta cuando, y de quien es */
interface Block {
  conversationId: string;
  until: number;
}

export interface AuxiliaryCooldownOptions {
  now?: () => number;
  waitMs?: number;
  blockMs?: number;
}

export class AuxiliaryCooldown {
  /** por lanzamiento (`launchKey`) y, la de una cuenta sin sesion, por CLI (`accountKey`) */
  private readonly entries = new Map<string, Entry>();
  /**
   * cuantas respuestas lleva cada lanzamiento. No es una estadistica: separa
   * las tandas, que es lo que decide de quien es un fallo repetido
   */
  private readonly answers = new Map<string, number>();
  /** por lanzamiento y sujeto, lo apuntado. Solo en memoria */
  private readonly strikes = new Map<string, Map<string, Strike>>();
  /**
   * por lanzamiento y sujeto, lo que se salta. Se queda pasada la hora, a
   * proposito: la que vuelve a fallar en su intento de prueba sigue siendo
   * suya, sin rearmar la espera de nadie. Se borra al contestarle
   */
  private readonly blocks = new Map<string, Map<string, Block>>();
  private readonly now: () => number;
  private readonly waitMs: number;
  private readonly blockMs: number;

  constructor(options: AuxiliaryCooldownOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.waitMs = options.waitMs ?? AUXILIARY_PROCESS_WAIT_MS;
    this.blockMs = options.blockMs ?? AUXILIARY_BLOCK_MS;
  }

  /**
   * true mientras ese lanzamiento esta en espera tras un fallo de su proceso: el
   * suyo, o el del CLI entero si la cuenta no tiene sesion
   */
  waiting(target: AuxiliaryLaunchTarget): boolean {
    const launch = normalizeLaunch(target);
    const now = this.now();
    return [
      this.entries.get(launchKey(launch)),
      this.entries.get(accountKey(launch.provider)),
    ].some((entry) => entry !== undefined && now < entry.until);
  }

  /**
   * true mientras ese trabajo salta esa conversacion con ese lanzamiento: su
   * proceso fallo por su cuenta (`blocked`). Pasadas `AUXILIARY_BLOCK_MS`, deja
   * probarla una vez. El boton de Daniel (`force`) la prueba igual
   */
  blocked(target: AuxiliaryLaunchTarget, subject: ProcessSubject): boolean {
    const block = this.blocks.get(launchKey(normalizeLaunch(target)))?.get(subjectKey(subject));
    return block !== undefined && this.now() < block.until;
  }

  /**
   * el proceso de ese lanzamiento fallo con `subject` (`processSubject`): decide
   * de quien es y, si es del CLI, hasta dentro de `waitMs` no se lanza solo.
   *
   * Sin `subject` no se sabe con quien fallo, y se trata como del CLI. Mientras
   * la espera de una cuenta sin sesion siga puesta, tambien. Un CLI que ya
   * estaba fallando en esta tanda tambien, salvo que esa espera la armara la
   * misma conversacion sola: entonces es suya. El orden de las preguntas
   * importa: que haya fallado OTRA en esta tanda se mira antes que lo de las
   * tandas anteriores, para no dejar fuera a una conversacion por un fallo que
   * fue del CLI.
   *
   * Lo llama quien lanzo el CLI, ya dentro del carril. Un cierre de la boveda a
   * mitad no es culpa del CLI y NO debe llegar aqui (`D-106`).
   */
  noteFailure(
    target: AuxiliaryLaunchTarget,
    reason: ProviderFailureReason | null | undefined,
    subject?: ProcessSubject,
  ): ProcessFailureVerdict {
    const launch = normalizeLaunch(target);
    const key = launchKey(launch);
    const at = this.now();
    const answered = this.answers.get(key) ?? 0;
    const strikes = this.strikesOf(key);
    const own = this.entries.get(key);
    const accountDown = this.accountDown(launch.provider, reason, at);
    // las conversaciones que ya han fallado en esta tanda, sin contar esta
    const others = new Set(
      [...strikes.values()]
        .filter(
          (strike) =>
            strike.epochs.has(answered) && strike.conversationId !== subject?.conversationId,
        )
        .map((strike) => strike.conversationId),
    );
    const dubious = subject !== undefined && !cliWide(reason) && !accountDown;
    if (dubious) {
      const id = subjectKey(subject);
      const mine = strikes.get(id);
      if (this.blocks.get(key)?.has(id) === true) {
        // ya era suya y vuelve a fallar —en su intento de prueba, o pedida a
        // mano—: sigue siendo suya, otras dos horas, sin frenar a nadie
        this.block(key, subject, at);
        return 'blocked';
      }
      if (own !== undefined) {
        if (
          own.armedBy !== null &&
          own.armedBy.size === 1 &&
          own.armedBy.has(subject.conversationId)
        ) {
          // la espera la armo ella sola —dos fallos seguidos—, nadie mas ha
          // fallado desde entonces y vuelve a fallar: es suya. Se quita la
          // espera que solo puso ella, y el siguiente disparo prueba con otra.
          // Se le deja lo apuntado a proposito: si esa otra tambien falla antes
          // de que el CLI conteste a nadie, son dos distintas y es del CLI
          this.entries.delete(key);
          this.block(key, subject, at);
          return 'blocked';
        }
      } else if (others.size === 0) {
        const before = mine === undefined ? [] : [...mine.epochs].filter((e) => e < answered);
        const aloneBefore = mine !== undefined && [...mine.alone].some((e) => e < answered);
        // fallo sola, el CLI contesto a otra y ha vuelto a fallar; o ya fallo en
        // dos tandas distintas con respuestas entre medias: es suya
        if (aloneBefore || before.length >= 2) {
          strikes.delete(id);
          this.block(key, subject, at);
          return 'blocked';
        }
        if (mine === undefined || !mine.epochs.has(answered)) {
          this.record(strikes, subject, answered, true);
          return 'conversation';
        }
        // dos veces en la misma tanda sin que el CLI conteste a nadie: no se
        // sabe de quien es, y lo que limita los intentos es la espera
      }
    }
    // del CLI. Lo que fallo en esta tanda deja de contar como fallo «a solas»:
    // salvo que sea la misma conversacion repitiendo, lo era de todos. Pero se
    // queda apuntado: si alguna vuelve a fallar en otra tanda, con el CLI
    // contestando a otras entre medias, cuenta (decimotercera ronda)
    if (!dubious || others.size > 0) {
      for (const strike of strikes.values()) strike.alone.delete(answered);
    }
    if (dubious) this.record(strikes, subject, answered, others.size === 0);
    if (reason === 'auth') {
      // sin sesion no contesta con ningun modelo: espera el CLI entero
      this.entries.set(accountKey(launch.provider), {
        launch: { provider: launch.provider, model: null, effort: null },
        wholeProvider: true,
        reason,
        at,
        until: at + this.waitMs,
        armedBy: null,
      });
      return 'cli';
    }
    // una espera que armo un fallo del CLI por si solo —un limite de uso— no
    // dice nada de quien falla DESPUES con otro motivo: se empieza a contar de
    // nuevo. Si no, tras un limite de uso una conversacion que falla sola
    // volveria a rearmarla cada diez minutos, para siempre
    const armedBy = dubious
      ? new Set([...(own?.armedBy ?? []), ...others, subject.conversationId])
      : null;
    this.entries.set(key, {
      launch,
      wholeProvider: false,
      reason: reason ?? null,
      at,
      until: at + this.waitMs,
      armedBy,
    });
    return 'cli';
  }

  /**
   * el CLI contesto, con lo que fuera: se acaba la espera de ese lanzamiento y
   * se olvida el fallo. La del CLI entero tambien: contestar prueba que la
   * cuenta tiene sesion. La de OTRO modelo no: puede ser solo de ese modelo.
   *
   * Una negativa tambien cuenta: es una respuesta, y prueba que el proceso
   * funciona. Es lo que hace que el aviso de la pantalla se vaya solo en cuanto
   * Daniel inicia sesion. Con `subject`, ademas, lo que se le apunto a ese se
   * olvida, y deja de saltarse: le ha contestado.
   */
  noteSuccess(target: AuxiliaryLaunchTarget, subject?: ProcessSubject): void {
    const launch = normalizeLaunch(target);
    const key = launchKey(launch);
    this.entries.delete(key);
    this.entries.delete(accountKey(launch.provider));
    this.answers.set(key, (this.answers.get(key) ?? 0) + 1);
    if (subject !== undefined) {
      this.strikesOf(key).delete(subjectKey(subject));
      this.blocks.get(key)?.delete(subjectKey(subject));
    }
  }

  /**
   * olvida todo lo apuntado a una conversacion, en todos los trabajos y
   * lanzamientos. Tras cambiar su dueño, lo que fallo antes se pedia con otro
   * personaje y no dice nada de lo que se pedira ahora
   */
  forgetConversation(conversationId: string): void {
    for (const strikes of this.strikes.values()) {
      for (const [id, strike] of strikes) {
        if (strike.conversationId === conversationId) strikes.delete(id);
      }
    }
    for (const blocks of this.blocks.values()) {
      for (const [id, block] of blocks) {
        if (block.conversationId === conversationId) blocks.delete(id);
      }
    }
  }

  /**
   * true si la cuenta de ese CLI esta sin sesion y su espera sigue puesta.
   *
   * La espera de la cuenta manda solo mientras dura (decimotercera ronda): antes
   * bastaba con que la entrada siguiera ahi, y no se iba hasta que ese CLI
   * contestase a otro trabajo. Tras `claude auth login`, con la ventana en una
   * API de pago y una sola conversacion pendiente que falla por su cuenta, cada
   * fallo salia del CLI y rearmaba la espera para siempre, con la pantalla
   * pidiendo un `claude auth login` ya hecho.
   *
   * De paso se quita cuando el fallo dice que ya no es lo que pasa: el propio
   * CLI clasifico el fallo sin decir `auth` (`provesSession`), o la espera ya
   * paso y ha fallado por otra cosa, que es ahora lo ultimo que se sabe de el.
   */
  private accountDown(
    provider: LocalCliProvider,
    reason: ProviderFailureReason | null | undefined,
    now: number,
  ): boolean {
    const key = accountKey(provider);
    const account = this.entries.get(key);
    if (account === undefined) return false;
    if (reason !== 'auth' && (provesSession(reason) || now >= account.until)) {
      this.entries.delete(key);
      return false;
    }
    return now < account.until;
  }

  private record(
    strikes: Map<string, Strike>,
    subject: ProcessSubject,
    epoch: number,
    alone: boolean,
  ): void {
    const id = subjectKey(subject);
    const strike = strikes.get(id) ?? {
      conversationId: subject.conversationId,
      epochs: new Set<number>(),
      alone: new Set<number>(),
    };
    strike.epochs.add(epoch);
    if (alone) strike.alone.add(epoch);
    else strike.alone.delete(epoch);
    strikes.set(id, strike);
  }

  private block(key: string, subject: ProcessSubject, now: number): void {
    const blocks = this.blocks.get(key) ?? new Map<string, Block>();
    blocks.set(subjectKey(subject), {
      conversationId: subject.conversationId,
      until: now + this.blockMs,
    });
    this.blocks.set(key, blocks);
  }

  private strikesOf(key: string): Map<string, Strike> {
    const own = this.strikes.get(key);
    if (own !== undefined) return own;
    const created = new Map<string, Strike>();
    this.strikes.set(key, created);
    return created;
  }

  /**
   * el ultimo fallo sin superar que frena ese lanzamiento, o `null`: el suyo, y
   * si no tiene, el del CLI entero
   */
  lastFailure(target: AuxiliaryLaunchTarget): AuxiliaryProcessFailure | null {
    const launch = normalizeLaunch(target);
    const entry =
      this.entries.get(launchKey(launch)) ?? this.entries.get(accountKey(launch.provider));
    return entry === undefined ? null : view(entry);
  }

  /**
   * todos los fallos sin superar, para la pantalla.
   *
   * Siguen aqui aunque la espera ya haya pasado: hasta que el CLI conteste, lo
   * ultimo que se sabe de el es que fallo, y eso es lo que tiene que leer Daniel.
   */
  failures(): AuxiliaryProcessFailure[] {
    return [...this.entries.values()].map(view);
  }
}

function view(entry: Entry): AuxiliaryProcessFailure {
  return {
    provider: entry.launch.provider,
    model: entry.launch.model,
    effort: entry.launch.effort,
    wholeProvider: entry.wholeProvider,
    reason: entry.reason,
    at: new Date(entry.at).toISOString(),
    retryAt: new Date(entry.until).toISOString(),
  };
}

/**
 * el permiso de UNA tanda para lanzar el CLI.
 *
 * `retryNow` es un boton de Daniel: puede probar una vez aunque la espera siga,
 * que es lo que hace falta justo despues de `claude auth login`. Se gasta en la
 * primera llamada de verdad; si esa vuelve a fallar, la espera se rearma y el
 * resto de la tanda —y las vueltas siguientes del panel— ya no lo lanzan.
 */
export class LaunchPermit {
  private bypass: boolean;

  constructor(
    private readonly cooldown: AuxiliaryCooldown,
    retryNow: boolean,
  ) {
    this.bypass = retryNow;
  }

  /** si se puede lanzar eso ahora, sin gastar el permiso */
  allows(target: AuxiliaryLaunchTarget): boolean {
    return this.bypass || !this.cooldown.waiting(target);
  }

  /** se va a lanzar de verdad: el permiso del boton ya no vale para la siguiente */
  spend(): void {
    this.bypass = false;
  }
}

/**
 * un turno de Daniel que su CLI contesta: la prueba de que ese CLI, con ese
 * modelo y ese esfuerzo, funciona (duodecima ronda).
 *
 * Sin esto, la espera solo se enteraba de que el CLI contesta cuando le
 * contestaba a OTRO trabajo de fondo, y la espera misma impide lanzarlo: tras
 * `claude auth login` el aviso seguia hasta el siguiente intento de fondo,
 * aunque Daniel ya estuviera hablando por Claude, y una conversacion que fallaba
 * sola no veia nunca al CLI contestar a otra. Solo cuenta una respuesta: un
 * fallo del turno de Daniel no arma nada aqui, que su pantalla ya lo enseña.
 * Devuelve si conto. Un proveedor que no es un CLI local no tiene espera.
 */
export function noteVisibleTurn(
  cooldown: AuxiliaryCooldown,
  launch: { provider: string; model: string | null; effort: ReasoningEffort | null },
  run: AuxiliaryRunVerdict,
): boolean {
  if (!isLocalCliProvider(launch.provider) || isProcessFailure(run)) return false;
  cooldown.noteSuccess({ provider: launch.provider, model: launch.model, effort: launch.effort });
  return true;
}
