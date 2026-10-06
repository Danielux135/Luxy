// cuando merece la pena dar otra vuelta al trabajo de fondo.
//
// El catalogo y los pendientes se hacen en tandas de tres conversaciones, y el
// panel repite la tanda hasta acabar. La pregunta «¿sigo?» parece trivial y no
// lo es: cortar de mas deja conversaciones sin leer y el panel diciendo que ya
// esta todo; cortar de menos arranca el CLI una y otra vez para nada.
//
// Vive aparte de `Vault.tsx` para poder probarla. Dentro del JSX era una linea
// que solo se podia comprobar abriendo la aplicacion, y las dos veces que estuvo
// mal el sintoma fue el mismo: «no queda nada pendiente» con trabajo sin hacer.
//
// PURO: recibe el resultado de una tanda y devuelve si dar otra.

/** lo que hizo una tanda de la pasada de pendientes */
export interface RelationSweepRound {
  /** conversaciones que siguen por revisar al terminar */
  pending: number;
  /** cuyas ventanas avanzaron el cursor */
  reviewed: number;
  /** que no contestaron con el bloque */
  refused: number;
  /** que no se pudieron leer */
  failed: number;
}

/**
 * si dar otra vuelta a la pasada de pendientes.
 *
 * No basta con mirar `reviewed`. Con contenido explicito es normal que un CLI se
 * niegue, y las tres conversaciones de una tanda son SIEMPRE las tres mas
 * antiguas: si las tres se niegan, `reviewed` vale 0 y el bucle cortaba dejando
 * el resto sin leer, aunque la tanda siguiente habria cogido otras tres —las
 * negadas quedan marcadas y se saltan—. Lo que de verdad dice que seguir no
 * sirve es que no pase NADA: ni se revise, ni se niegue, ni falle nada. Eso solo
 * ocurre cuando no hay candidatas que tocar, y entonces la vuelta siguiente
 * seria identica.
 */
export function keepSweepingRelations(round: RelationSweepRound | null): boolean {
  // `null` es un error ya enseñado en pantalla: insistir solo lo repetiria
  if (round === null) return false;
  if (round.pending === 0) return false;
  return round.reviewed > 0 || round.refused > 0 || round.failed > 0;
}

/** lo que hizo una tanda del catalogo */
export interface CatalogSweepRound {
  pending: number;
  cataloged: number;
  failed: number;
}

/**
 * si dar otra vuelta al catalogo.
 *
 * El mismo razonamiento y el mismo defecto que arriba: una negativa entra en
 * `catalogFailures` sin tocar `cataloged`, y esa conversacion queda excluida de
 * la tanda siguiente. Cortar con `cataloged === 0` a secas se comia las que si
 * se habrian catalogado.
 */
export function keepSweepingCatalog(round: CatalogSweepRound | null): boolean {
  if (round === null) return false;
  if (round.pending === 0) return false;
  return round.cataloged > 0 || round.failed > 0;
}

/**
 * una conversacion que no se pudo ordenar. `process`: fallo el CLI, no la
 * respuesta, y se reintenta en minutos; `blocked`: su proceso falla por su
 * cuenta, y se salta un par de horas (decimotercera ronda)
 */
export interface CatalogFailureView {
  conversationId: string;
  reason: string;
  process?: boolean;
  blocked?: boolean;
}

/**
 * cuando se vuelven a intentar las que no se pudieron ordenar, dicho sin
 * prometer lo que no pasa.
 *
 * Son tres casos y no dos (decimotercera ronda). Las que fallaron porque el CLI
 * no pudo contestar las retoma la pantalla pasada la espera, pero solo mientras
 * la boveda siga abierta: el trabajo de fondo no la mantiene abierta
 * (`D-106`), la espera dura mas que el cierre automatico por defecto y el
 * cierre se lleva la retoma; al volver a abrir «Lo que recuerda» se barre otra
 * vez. Las que fallan por su cuenta se saltan un par de horas, y como el
 * catalogo solo lo arranca este panel, despues se prueban al abrirlo. Y las que
 * fallaron por la respuesta —o un repaso pedido a mano de una ya catalogada,
 * que la pasada sola no vuelve a coger— no se reintentan solas en la sesion.
 */
export function catalogRetryNote(failed: readonly CatalogFailureView[]): string {
  const process = failed.filter((each) => each.process === true).length;
  const blocked = failed.filter((each) => each.process !== true && each.blocked === true).length;
  const answer = failed.length - process - blocked;
  const minutos =
    'pasados unos minutos, en cuanto el CLI pueda contestar, sin reiniciar, mientras la bóveda siga abierta; si se cierra antes, al volver a abrir «Lo que recuerda»';
  const horas = 'dentro de un par de horas, la próxima vez que abras «Lo que recuerda»';
  if (process === failed.length) return `Se vuelven a intentar solas ${minutos}.`;
  if (blocked === failed.length) {
    return `Vuelven a fallar por algo suyo aunque el CLI conteste a las otras, así que se prueban otra vez ${horas}; puedes pedirlo tú antes.`;
  }
  if (answer === failed.length) {
    return 'No se reintentan solas en esta sesión —fallaron por la respuesta, o eran un repaso que pediste tú—, para no gastar una llamada en cada apertura; puedes pedirlo tú con el botón.';
  }
  return [
    ...(process > 0
      ? [`Las que fallaron porque el CLI no pudo contestar se vuelven a intentar solas ${minutos}.`]
      : []),
    ...(blocked > 0
      ? [`Las que vuelven a fallar por algo suyo se prueban otra vez ${horas}.`]
      : []),
    ...(answer > 0
      ? [
          'Las demás —fallaron por la respuesta, o eran un repaso que pediste tú— no se reintentan solas en esta sesión, para no gastar una llamada en cada apertura.',
        ]
      : []),
  ].join(' ');
}

/** un catalogo de escenas del mismo tamaño */
export interface CatalogUnevenView {
  conversationId: string;
  scenes: number;
}

/** una tanda del catalogo, tal y como la devuelve el proceso principal */
export interface CatalogRoundResult {
  cataloged: number;
  scenes: number;
  pending: number;
  failed: readonly CatalogFailureView[];
  uneven: readonly CatalogUnevenView[];
  waiting?: number;
  catalogedIds?: readonly string[];
  provider?: 'claude' | 'codex' | null;
  /** con que modelo y esfuerzo; `null`, los que trae el CLI */
  model?: string | null;
  effort?: string | null;
}

/** lo que la pantalla enseña del catalogo: las vueltas, juntas */
export interface CatalogSummary {
  cataloged: number;
  scenes: number;
  /** la cola entera tras la ultima vuelta */
  pending: number;
  failed: CatalogFailureView[];
  uneven: CatalogUnevenView[];
  /** de la ultima vuelta, las que no se mandaron porque el CLI espera */
  waiting: number;
  /**
   * si la ULTIMA vuelta se quedo a medias por el CLI: dejo algo esperando o
   * fallo por el proceso en algo que se reintenta solo. Solo la ultima: un
   * fallo viejo que se queda en el aviso —una conversacion que despues se
   * excluyo, por ejemplo— no puede tener la pasada «a medias» para siempre.
   *
   * Una tanda de UNA conversacion no la acaba: no mira la cola, y si la pasada
   * general estaba a medias y aun queda cola, lo sigue estando
   */
  interrupted: boolean;
  /** el CLI que lo hizo; `null` si no se sabe */
  provider: 'claude' | 'codex' | null;
  /**
   * y con que modelo y esfuerzo, que van con el CLI: la espera es de ese
   * lanzamiento y no de todo el CLI (duodecima ronda). `null`, los que trae
   */
  model: string | null;
  effort: string | null;
}

/** una espera del proceso principal, tal y como llega con el estado */
export interface AuxiliaryWaitView {
  provider: string;
  model: string | null;
  effort: string | null;
  /** del CLI entero, con cualquier modelo: una cuenta sin sesion */
  wholeProvider: boolean;
  retryAt: string;
}

/** un modelo vacio es el que trae el CLI, como `null`: asi lo cuenta la espera */
function modelOf(model: string | null | undefined): string | null {
  return model !== null && model !== undefined && model.length > 0 ? model : null;
}

/** si esa espera frena lo que lanzo la pasada */
function waitApplies(
  wait: AuxiliaryWaitView,
  launch: { provider: string; model: string | null; effort: string | null },
): boolean {
  if (wait.provider !== launch.provider) return false;
  if (wait.wholeProvider) return true;
  return modelOf(wait.model) === modelOf(launch.model) && (wait.effort ?? null) === launch.effort;
}

/** lo que pidio la pantalla en esa tanda */
export interface CatalogRoundRequest {
  /** una sola, desde un boton; sin ella, la pasada general */
  conversationId?: string;
}

/**
 * junta una tanda del catalogo con lo que ya enseñaba la pantalla.
 *
 * Antes cada tanda MACHACABA a la anterior, y con el CLI roto eso borraba el
 * aviso: la vuelta 0 fallaba en una conversacion y armaba la espera, la vuelta
 * 1 encontraba todo esperando y volvia con `failed: []`, y el aviso con su
 * boton «Reintentar» desaparecia dejando solo «Quedan N sin ordenar», sin
 * decir por que ni como seguir. Lo mismo hacia el bucle de ese boton: la
 * primera conversacion fallaba otra vez, las demas esperaban, y la ultima
 * llamada borraba el fallo (undecima ronda).
 *
 * Lo que se ha intentado en esta tanda manda sobre lo de antes: una que se
 * ordena sale del aviso, una que vuelve a fallar se queda con su motivo nuevo,
 * y una que no se ha tocado —porque esperaba— conserva el suyo. Las cifras de
 * lo ordenado se suman; lo que queda y lo que espera son de la ultima tanda,
 * que es lo que hay ahora.
 *
 * `request` es obligatorio a proposito: si la tanda era de una conversacion
 * cambia lo que dice de la pasada general (`interrupted`), y olvidarlo en quien
 * llama no puede compilar.
 */
export function mergeCatalogRound(
  previous: CatalogSummary | null,
  round: CatalogRoundResult,
  request: CatalogRoundRequest,
): CatalogSummary {
  const roundInterrupted =
    (round.waiting ?? 0) > 0 || round.failed.some((each) => each.process === true);
  // una tanda de UNA conversacion —«Repasar sus momentos», «Reintentar»,
  // «Repetir»— no ha mirado la cola. Daba la pasada general por acabada si
  // salia bien: la retoma no llegaba nunca, el aviso «Probar ahora» se iba, y
  // la nota seguia prometiendo que las que fallaron se reintentaban solas.
  // Con la cola vacia ya no queda nada que retomar
  const sweepInterrupted =
    request.conversationId !== undefined && previous?.interrupted === true && round.pending > 0;
  const ordered = new Set(round.catalogedIds ?? []);
  const touched = new Set([...ordered, ...round.failed.map((each) => each.conversationId)]);
  const reshaped = new Set([...ordered, ...round.uneven.map((each) => each.conversationId)]);
  // el modelo y el esfuerzo van con su CLI: de la misma tanda que el, o de la
  // de antes si esta no lo dice
  const launched = (round.provider ?? null) !== null;
  return {
    cataloged: (previous?.cataloged ?? 0) + round.cataloged,
    scenes: (previous?.scenes ?? 0) + round.scenes,
    pending: round.pending,
    failed: [
      ...(previous?.failed ?? []).filter((each) => !touched.has(each.conversationId)),
      ...round.failed,
    ],
    uneven: [
      ...(previous?.uneven ?? []).filter((each) => !reshaped.has(each.conversationId)),
      ...round.uneven,
    ],
    waiting: round.waiting ?? 0,
    interrupted: roundInterrupted || sweepInterrupted,
    provider: launched ? (round.provider ?? null) : (previous?.provider ?? null),
    model: launched ? modelOf(round.model) : (previous?.model ?? null),
    effort: launched ? (round.effort ?? null) : (previous?.effort ?? null),
  };
}

/**
 * si el catalogo se quedo a medias por el CLI: en su ultima vuelta hubo
 * conversaciones que esperaban a que volviera, o que fallaron por el proceso y
 * se reintentan solas.
 */
export function catalogInterrupted(summary: CatalogSummary | null): boolean {
  return summary !== null && summary.interrupted;
}

/**
 * el minimo entre dos retomas automaticas. La espera del proceso principal ya
 * limita los intentos al CLI; esto solo impide que un error que la pantalla no
 * ve venir —la boveda que se cierra a mitad, por ejemplo— se repita en cada
 * refresco del estado.
 */
export const CATALOG_RESUME_GAP_MS = 60_000;

/**
 * si retomar sola una pasada del catalogo que se quedo a medias por el CLI.
 *
 * Solo el panel arranca el catalogo, una vez por sesion de Studio: con el CLI
 * roto, nada lo volvia a lanzar despues de `claude auth login`, y lo que quedo
 * esperando seguia «partido por silencios» hasta reiniciar. La pantalla decia
 * que se reintentaba solo, y no era verdad (undecima ronda).
 *
 * Se retoma cuando ese CLI ya no tiene un fallo sin superar —otro trabajo de
 * fondo lo vio contestar— o cuando su espera ha pasado, para probarlo UNA vez.
 * La tanda respeta la espera del proceso principal, asi que esto no lanza el
 * CLI mas de lo que ya permite: como mucho una vez por espera. Sin saber con
 * que CLI se hizo, no se retoma: no hay espera que mirar.
 *
 * Solo cuentan las esperas de LO QUE LANZO la pasada —su CLI con su modelo y su
 * esfuerzo— y la del CLI entero: la de otro modelo del mismo CLI no dice nada de
 * esta, igual que en el proceso principal (duodecima ronda).
 */
export function catalogResumeDue(input: {
  summary: CatalogSummary | null;
  failures: readonly AuxiliaryWaitView[];
  now: number;
  lastResumeAt: number | null;
}): boolean {
  const summary = input.summary;
  if (summary === null || !catalogInterrupted(summary)) return false;
  const provider = summary.provider;
  if (provider === null) return false;
  if (input.lastResumeAt !== null && input.now - input.lastResumeAt < CATALOG_RESUME_GAP_MS) {
    return false;
  }
  const launch = { provider, model: summary.model, effort: summary.effort };
  return input.failures
    .filter((each) => waitApplies(each, launch))
    .every((each) => {
      const retryAt = Date.parse(each.retryAt);
      return Number.isFinite(retryAt) && retryAt <= input.now;
    });
}

/**
 * lo que hizo una tanda del relleno de la memoria de lo ya hablado.
 *
 * Son siete formas de «ha pasado algo» y no una, porque aqui una tanda puede
 * gastar varias llamadas sin escribir ni una ficha y aun asi haber avanzado la
 * cola: la conversacion queda marcada y la vuelta siguiente coge otra.
 */
export interface RecapSweepRound {
  /** conversaciones que siguen por rellenar AL TERMINAR, recalculado */
  pending: number;
  /** conversaciones cuya ficha se escribio o se amplio */
  reviewed: number;
  /** ventanas en las que el CLI se nego */
  refused: number;
  /** ventanas que obedecieron y sanearon: valida, pero no dice nada */
  vague: number;
  /** ventanas cuyo bloque no se pudo leer: ausente, cortado o mal formado */
  invalid: number;
  /** conversaciones que no se pudieron ni leer ni guardar */
  failed: number;
  /** conversaciones que se quedaron en el indice deducido */
  deduced: number;
  /** conversaciones que ya tenian memoria propia: la sellada gana siempre */
  superseded: number;
}

/**
 * si dar otra vuelta al relleno de la memoria de lo ya hablado.
 *
 * Mismo razonamiento que los dos de arriba y el mismo defecto que este
 * repositorio ya ha entregado DOS veces, pero aqui es mas facil de cometer
 * porque hay muchas mas maneras de terminar sin escribir nada. Las dos
 * conversaciones de una tanda son SIEMPRE las dos mas antiguas, que son
 * justamente las que llevan mas tiempo sin leerse; si se niegan, cortar con
 * `reviewed === 0` deja las quince restantes sin mirar y el panel diciendo que
 * ya no queda nada.
 *
 * Por eso cuenta como progreso todo lo que deja la conversacion marcada y hace
 * que la vuelta siguiente coja OTRA:
 *
 *   - `refused`, `vague` e `invalid` se persisten en la entrada con su CLI, asi
 *     que `refusedStillRecap` las salta hasta que cambie el CLI, crezca la
 *     conversacion o Daniel pulse «Rehacerlo»;
 *   - `failed` queda en los fallos de sesion de ese CLI;
 *   - `deduced` escribe el indice y conserva el motivo por el que no hubo ficha;
 *   - `superseded` marca la que ya tiene memoria sellada, que no se rellena
 *     nunca —y sin contarla, una tanda de dos conversaciones ya selladas
 *     pararia la pasada entera antes de empezar—.
 *
 * Lo unico que dice de verdad que seguir no sirve es que no pase NADA de nada:
 * eso solo ocurre cuando no habia candidatas que tocar, y entonces la vuelta
 * siguiente seria identica.
 */
export function keepSweepingRecaps(round: RecapSweepRound | null): boolean {
  // `null` es un error ya enseñado en pantalla, o una pasada que ya estaba en
  // marcha: insistir solo lo repetiria
  if (round === null) return false;
  if (round.pending === 0) return false;
  return (
    round.reviewed > 0 ||
    round.refused > 0 ||
    round.vague > 0 ||
    round.invalid > 0 ||
    round.failed > 0 ||
    round.deduced > 0 ||
    round.superseded > 0
  );
}
