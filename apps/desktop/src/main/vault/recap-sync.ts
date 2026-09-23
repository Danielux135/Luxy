// quien genera HACIA ATRAS la memoria acumulativa de las conversaciones que
// nunca la tuvieron.
//
// Durante meses el bloque de memoria del turno privado no se escribio, y
// diecisiete conversaciones se quedaron sin ninguna. Esto las lee por ventanas
// con un CLI local —Claude o Codex, NUNCA una API de pago— y va acumulando la
// ficha ventana a ventana. No toca ni un byte de los `.jsonl` sellados: lo que
// escribe vive en `recap.json`, aparte, porque una memoria mal escrita dentro de
// un registro apaga la pestaña Privado entera.
//
// Se parece a `relation-sync.ts` en el esqueleto —el mismo carril, la misma
// doble comprobacion del proveedor, el mismo orden cronologico ascendente— y se
// separa de el en lo que el diseño cambia a proposito:
//
//  1. los finales NO se mezclan en un contador unico. Una ficha parcial es un
//     EXITO —el modelo hizo su trabajo y dijo donde no llego—, una negativa de
//     moderacion se arregla cambiando de CLI, un JSON roto se arregla con el
//     mismo, una ficha vaga se arregla cambiando de MODELO y un proceso que no
//     termina no dice nada de ninguna de las tres. Mezclarlos es el defecto que
//     ya tiene la pasada de pendientes;
//  2. una negativa llega como `completed` CON TEXTO, no como error. Se lee
//     PRIMERO el bloque y solo se clasifica si no hay ninguno que valga: a este
//     CLI se le ha pedido describir una escena, asi que una ficha legitima habla
//     de contenido explicito, de limites y de lo que se acordo, que es
//     exactamente el vocabulario con el que `classifyReply` —calibrado para
//     dialogo EN personaje— detecta una negativa. Clasificar antes de leer tiraba
//     fichas buenas y declaraba su tramo como hueco;
//  3. una ventana negada no bloquea la conversacion: se salta, su tramo se
//     DECLARA como hueco y se sigue, porque lo que sirve para retomar es la
//     cola. Con tope, para que un hilo explicito de punta a punta cueste dos
//     llamadas y no ocho.
//
// Y las dos reglas que este repositorio ya ha roto dos veces:
//
//  - el cursor solo avanza sobre lo leido ENTERO. Lo que no se resumio se
//    declara; nada se da por leido en silencio;
//  - una negativa pertenece al CLI que la dio. El otro puede aceptar
//    perfectamente lo que este rechazo, asi que cambiar el selector del panel
//    tiene que volver a intentarlo.
//
// Nada de lo que pase aqui puede costarle un turno al usuario (`D-088`): todo va
// por detras, con su try/catch, y lo peor que puede pasar es que la ficha se
// quede donde estaba.
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AUXILIARY_PROVIDER,
  RECAP_MAX_REFUSED_WINDOWS,
  RECAP_OPEN,
  RECAP_VERSION,
  buildRecapPrompt,
  clampRecapMemory,
  countClippedRecapTurns,
  countKeptEntries,
  deduceRecap,
  formatConversationMemory,
  isLocalCliProvider,
  lastReviewableRecapTurn,
  parseRecapResponse,
  recapAnchorEntry,
  recapCountersSchema,
  recapEntrySchema,
  recapWindow,
  redact,
  refusedStillRecap,
  resolveAuxiliaryTarget,
  restoreRecapAnchor,
  scoreRecapVagueness,
  verifyRecap,
  type ConversationMemory,
  type LocalCliProvider,
  type RecapCatalog,
  type RecapCounters,
  type RecapEntry,
  type RecapGap,
  type RecapGapReason,
  type RecapRefusalKind,
  type RecapTurn,
  type TemporalAnchor,
} from '@luxy/shared';
import { classifyReply } from '../../shared/refusal.js';
import type { CatalogedEpisode, CatalogStore } from './catalog-store.js';
import type { PrivateConversationStore } from './conversation-store.js';
import type { MemoryPreferences } from './memory-preferences.js';
import type { RecapStore } from './recap-store.js';
import type { AuxiliaryController } from './relation-sync.js';
import type { VaultService } from './vault-service.js';

/**
 * conversaciones por tanda.
 *
 * Dos y no tres como los pendientes: aqui una conversacion puede gastar mas de
 * una llamada, y el bucle del panel da doce vueltas.
 */
export const RECAP_DEFAULT_LIMIT = 2;

/**
 * ventanas por conversacion y pasada.
 *
 * El bucle no puede ser infinito —cada ventana deja el cursor mas adelante que
 * la anterior—, pero sin tope una conversacion de trescientos turnos gastaria
 * ocho llamadas seguidas sin que nadie lo pidiera. Con los datos reales la mas
 * larga son 65 turnos, es decir dos ventanas: esto no se alcanza, y si se
 * alcanzara lo que quede sale en la tanda siguiente.
 */
export const RECAP_MAX_WINDOWS = 8;

/**
 * tramos declarados que caben en una entrada.
 *
 * Es el tope del esquema (`recapEntrySchema.gaps.max(20)`) repetido aqui porque
 * quien acumula tiene que respetarlo ANTES de escribir: `checkedForWrite` lanza,
 * y un fallo al guardar perderia tambien la ficha.
 */
const RECAP_MAX_GAPS = 20;

/** un turno tal y como hace falta para ordenar y para saber que queda por leer */
export interface RecapSyncTurn {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  createdAt: string;
}

export interface RecapSyncDeps {
  vault: VaultService;
  /**
   * `latestMemory` ademas de `read`: una conversacion que ya tiene memoria
   * sellada viva no se rellena, porque la sellada gana siempre y el trabajo se
   * tiraria entero.
   */
  conversations: Pick<PrivateConversationStore, 'read' | 'latestMemory'>;
  recaps: Pick<RecapStore, 'read' | 'apply' | 'markSuperseded'>;
  /** las escenas ya catalogadas: dan los cortes de ventana y el indice deducido */
  catalog: Pick<CatalogStore, 'list'>;
  preferences: Pick<MemoryPreferences, 'auxiliary' | 'excluded'>;
  controller: AuxiliaryController;
  /**
   * cuando se dijo cada turno, sin su texto.
   *
   * El mismo que alimenta la pasada de pendientes. Sirve para ordenar y para
   * saber cuales van por detras sin descifrarlas todas en cada tanda.
   */
  timeline: () => Promise<readonly RecapSyncTurn[]>;
  /** el carril que se comparte con el catalogo y los pendientes */
  lane: <T>(task: () => Promise<T>) => Promise<T>;
  /** true mientras se le esta contestando a esa conversacion */
  isSending: (conversationId: string) => boolean;
  anchor: () => TemporalAnchor;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

export interface RecapRunOptions {
  projectAlias: string;
  /** solo esta conversacion */
  conversationId?: string;
  limit?: number;
  /**
   * pedida a mano: es «Rehacerlo».
   *
   * No solo se salta la negativa persistida: ademas empieza la conversacion
   * DESDE CERO. Sin eso, una conversacion ya cubierta con huecos no se podria
   * reintentar con el otro CLI, que es justo lo que promete el boton del panel.
   */
  force?: boolean;
  /**
   * corre la pasada entera y NO guarda nada.
   *
   * Es lo unico que contesta a la vez «¿se niegan?» y «¿sale bueno?» sin dejar
   * rastro. No hay ningun camino de escritura fuera de `persistEntry`.
   */
  dryRun?: boolean;
}

/** lo que se habria guardado, para poder leerlo antes de decidir */
export interface RecapPreview {
  conversationId: string;
  /** el bloque tal y como viajaria en el prompt. NUNCA va a un registro */
  block: string;
  source: 'cli' | 'index';
  covered: { from: number; to: number };
  gaps: number;
  chars: number;
  refusedKind: RecapRefusalKind | null;
}

export interface RecapRunResult {
  /** conversaciones cuya ficha se escribio o se amplio */
  reviewed: number;
  /** llamadas al CLI: una por ventana */
  windows: number;
  /** ventanas que salieron enteras */
  ok: number;
  /** ventanas que salieron con tramos declarados. Es un EXITO, no un fallo */
  partial: number;
  /** conversaciones que se quedaron en el indice deducido */
  deduced: number;
  /** ventanas en las que el CLI se nego */
  refused: number;
  /** ventanas cuya ficha no decia nada */
  vague: number;
  /** ventanas cuyo bloque no se pudo leer: ausente, cortado o mal formado */
  invalid: number;
  /** conversaciones cuyo proceso no llego a terminar */
  failed: { conversationId: string; reason: string }[];
  /** conversaciones que ya tenian memoria propia */
  superseded: number;
  /** tramos declarados en esta pasada */
  gaps: number;
  /** turnos que no se enseñaron enteros. Con el presupuesto de hoy tiene que ser 0 */
  clipped: number;
  kept: number;
  rewritten: number;
  dropped: number;
  /** entradas que las ventanas encadenadas APORTARON: sin esto una esteril parece perfecta */
  added: number;
  /** suma de los bloques renderizados: lo que se paga en cada turno futuro */
  chars: number;
  /**
   * las que siguen por rellenar AL TERMINAR la tanda.
   *
   * Se recalcula, no se resta: una conversacion larga gasta sus ventanas y
   * puede seguir teniendo cola.
   */
  pending: number;
  provider: LocalCliProvider;
  /** true si la preferencia guardada pedia un proveedor de pago y se sustituyo */
  replaced: boolean;
  /** solo con `dryRun` */
  preview: RecapPreview[];
}

/** a quien se le manda el trabajo, ya comprobado dos veces */
interface Target {
  provider: LocalCliProvider;
  model: string | null;
  replaced: boolean;
}

/** una conversacion que puede tener algo sin resumir */
interface Candidate {
  conversationId: string;
  /** createdAt del primer turno: el orden de la pasada */
  startedAt: string;
  turns: number;
}

/** lo que se comparte entre las conversaciones de una misma tanda */
interface PassState {
  options: RecapRunOptions;
  target: Target;
  result: RecapRunResult;
  /** una por conversacion, la ultima que se habria escrito */
  previews: Map<string, RecapPreview>;
}

/** lo que se va acumulando dentro de UNA conversacion */
interface ConversationState {
  conversationId: string;
  turns: RecapTurn[];
  now: string;
  /**
   * la entrada que ya habia, tal cual se leyo.
   *
   * Se guarda entera porque una pasada que no consigue nada tiene que poder
   * apuntar el fallo SIN tocar lo demas: reescribir la entrada con lo que hay en
   * memoria borraria la aprobacion de Daniel —y con ella la memoria de todos los
   * prompts futuros de ese hilo— sin haber cambiado ni una palabra de la ficha.
   */
  previous: RecapEntry | null;
  /** la ficha acumulada; `null` mientras ninguna ventana haya salido */
  memory: ConversationMemory | null;
  /** hasta donde se ha leido de verdad */
  through: number;
  covered: { from: number; to: number };
  coveredAt: string | null;
  /** el primer turno que llegara a cubrir esta entrada */
  coveredFrom: number | null;
  gaps: RecapGap[];
  refusedKind: RecapRefusalKind | null;
  supersededAt: string | null;
  windows: number;
  /** ventanas negadas seguidas: dos y esta conversacion se deja para otra pasada */
  refusedRun: number;
  /** true en cuanto una ventana sale bien */
  wrote: boolean;
  /**
   * true en cuanto cambia algo de lo que Daniel habria aprobado: la ficha, el
   * tramo cubierto o los huecos. Una ventana negada tambien lo cambia —estira el
   * cubierto y declara un hueco nuevo—, asi que no vale mirar solo `wrote`.
   */
  mutated: boolean;
  /** hay algo que guardar que todavia no se ha guardado */
  dirty: boolean;
  /** contadores aun sin sumar al almacen */
  delta: RecapCounters;
  /** caracteres ya contados en el resultado, para no contarlos dos veces */
  chars: number;
}

type TallyField = Exclude<keyof RecapCounters, 'failed'>;

function zeroCounters(): RecapCounters {
  return recapCountersSchema.parse({});
}

function addCounters(base: RecapCounters, extra: RecapCounters): RecapCounters {
  return {
    windows: base.windows + extra.windows,
    ok: base.ok + extra.ok,
    partial: base.partial + extra.partial,
    deduced: base.deduced + extra.deduced,
    refused: base.refused + extra.refused,
    vague: base.vague + extra.vague,
    invalid: base.invalid + extra.invalid,
    failed: base.failed + extra.failed,
    clipped: base.clipped + extra.clipped,
    kept: base.kept + extra.kept,
    rewritten: base.rewritten + extra.rewritten,
    dropped: base.dropped + extra.dropped,
    added: base.added + extra.added,
  };
}

/**
 * hasta donde se leyo de verdad esta conversacion.
 *
 * Cuatro casos devuelven la conversacion entera por delante, y los cuatro son
 * deliberados: la entrada la escribio otra version del relleno, lo unico que hay
 * es un indice deducido —que no ha leido nada—, lo unico que hay es una
 * negativa, o el turno al que apunta ya no esta o su fecha no casa porque el
 * numero se reutilizo al retirar un mensaje sin respuesta.
 *
 * La version se compara por igualdad y no por «menor que», igual que en
 * `chooseConversationMemory`: una ficha que no es de esta version no se usa en
 * el prompt, asi que tampoco puede servir de punto de partida.
 *
 * Volver a leer no duplica nada: la ficha se reescribe entera.
 */
export function effectiveRecapThrough(
  entry: RecapEntry | undefined,
  turns: readonly { sequence: number; createdAt: string }[],
): number {
  if (entry === undefined) return -1;
  if (entry.version !== RECAP_VERSION) return -1;
  if (entry.source !== 'cli') return -1;
  if (entry.memory === null) return -1;

  const turn = turns.find((each) => each.sequence === entry.covered.to);
  if (turn === undefined) return -1;
  // aqui se exige la fecha, al reves que el cursor de pendientes: la escribe
  // siempre esta misma pasada, asi que su ausencia significa que la entrada la
  // escribio otra cosa y no que sea antigua
  if (entry.coveredAt === null || entry.coveredAt !== turn.createdAt) return -1;
  return entry.covered.to;
}

/**
 * junta los tramos declarados y respeta el tope del esquema.
 *
 * Dos tramos que se tocan son uno solo; si el motivo no coincide se queda
 * «otro», que es el unico que no afirma nada. Lo importante es el final: cuando
 * despues de juntarlos siguen sobrando, los ultimos se funden en UNO que los
 * abarca a todos en vez de tirarlos. Tirar un tramo seria callarse un hueco, que
 * es exactamente lo contrario de para lo que existen.
 */
export function mergeRecapGaps(gaps: readonly RecapGap[]): RecapGap[] {
  const ordered = [...gaps].sort((a, b) => a.from - b.from || a.to - b.to);

  const merged: RecapGap[] = [];
  for (const gap of ordered) {
    const last = merged[merged.length - 1];
    if (last !== undefined && gap.from <= last.to + 1) {
      merged[merged.length - 1] = {
        from: last.from,
        to: Math.max(last.to, gap.to),
        why: last.why === gap.why ? last.why : 'otro',
      };
      continue;
    }
    merged.push({ from: gap.from, to: gap.to, why: gap.why });
  }

  if (merged.length <= RECAP_MAX_GAPS) return merged;
  const head = merged.slice(0, RECAP_MAX_GAPS - 1);
  const tail = merged.slice(RECAP_MAX_GAPS - 1);
  head.push({
    from: tail[0]!.from,
    to: Math.max(...tail.map((gap) => gap.to)),
    why: 'otro',
  });
  return head;
}

/**
 * lo que el modelo escribio FUERA del bloque.
 *
 * Es lo unico que se le puede pasar al clasificador de negativas cuando hay un
 * bloque que no vale: dentro va una ficha que habla de la escena porque es lo
 * que se le ha pedido, y `classifyReply` esta calibrado para dialogo EN
 * personaje, donde nadie dice «contenido sexual» ni «directrices».
 *
 * Sin bloque, el texto entero es el preambulo. Se usa `lastIndexOf` como
 * `parseRecapResponse`, para mirar exactamente el mismo bloque que se intento
 * leer.
 */
function textOutsideRecapBlock(text: string): string {
  const openAt = text.lastIndexOf(RECAP_OPEN);
  return openAt < 0 ? text : text.slice(0, openAt);
}

function previewOf(entry: RecapEntry): RecapPreview {
  return {
    conversationId: entry.conversationId,
    block: entry.memory === null ? '' : formatConversationMemory(entry.memory),
    source: entry.source,
    covered: entry.covered,
    gaps: entry.gaps.length,
    chars: entry.chars,
    refusedKind: entry.refusedKind,
  };
}

/**
 * la entrada inerte de una conversacion que ya tiene memoria propia.
 *
 * Sin ella, esa conversacion volveria a gastar un hueco de cada tanda para
 * siempre: `pending` no puede saber que hay memoria sellada sin descifrarla. Con
 * la memoria en `null` no llega a ningun prompt y no cuenta como cobertura.
 */
function supersededMarker(candidate: Candidate, at: string): RecapEntry {
  return recapEntrySchema.parse({
    conversationId: candidate.conversationId,
    memory: null,
    source: 'cli',
    covered: { from: 0, to: 0 },
    coveredAt: null,
    gaps: [],
    turnsAtRecap: candidate.turns,
    version: RECAP_VERSION,
    provider: null,
    model: null,
    at,
    chars: 0,
    approved: false,
    supersededAt: at,
  });
}

/**
 * rellena hacia atras la memoria de las conversaciones que nunca la tuvieron.
 *
 * Se construye con todo inyectado —el controlador incluido— porque lo que hay
 * que poder probar es justo lo que no se puede ejecutar en una prueba: que el
 * proveedor nunca es de pago, que una ventana negada no se lleva por delante la
 * conversacion entera y que el cursor no avanza sobre lo que nadie leyo.
 */
export class RecapSync {
  /**
   * conversaciones que fallaron en esta sesion, con el CLI con el que fallaron.
   *
   * Sin esto, una que falle siempre se reintenta en cada disparo y se lleva la
   * tanda entera. Se olvida al reiniciar, que es cuando tiene sentido volver a
   * probar. Y guarda CON QUE fallo porque un Codex que no arranca no dice nada
   * de Claude.
   */
  private readonly failures = new Map<string, LocalCliProvider>();

  private cancelled = false;
  private running = false;

  constructor(private readonly deps: RecapSyncDeps) {}

  /** true mientras hay una pasada en curso; para medir, no para decidir */
  get busy(): boolean {
    return this.running;
  }

  /** cuantas conversaciones se estan saltando por haber fallado en esta sesion */
  get failedThisSession(): number {
    return this.failures.size;
  }

  get failedConversations(): ReadonlySet<string> {
    return new Set(this.failures.keys());
  }

  /**
   * para la pasada en curso. Se engancha a `vault.onLock`.
   *
   * Se mira ENTRE VENTANAS y no solo entre conversaciones: una ventana tarda un
   * minuto y la boveda puede cerrarse dentro. Sin la llave no se puede sellar
   * nada, asi que seguir solo produciria errores.
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * una tanda. Va por el carril compartido, asi que nunca hay dos CLI a la vez.
   *
   * Quien la llama NO debe envolverla otra vez en el carril: se esperaria a si
   * misma.
   */
  async runOnce(options: RecapRunOptions): Promise<RecapRunResult> {
    return this.deps.lane(() => this.review(options));
  }

  private async review(options: RecapRunOptions): Promise<RecapRunResult> {
    const target = this.auxiliary();
    const result: RecapRunResult = {
      reviewed: 0,
      windows: 0,
      ok: 0,
      partial: 0,
      deduced: 0,
      refused: 0,
      vague: 0,
      invalid: 0,
      failed: [],
      superseded: 0,
      gaps: 0,
      clipped: 0,
      kept: 0,
      rewritten: 0,
      dropped: 0,
      added: 0,
      chars: 0,
      pending: 0,
      provider: target.provider,
      replaced: target.replaced,
      preview: [],
    };
    if (!this.deps.vault.isUnlocked()) return result;

    // una peticion nueva no arrastra el «para» de la anterior
    this.cancelled = false;
    this.running = true;
    try {
      return await this.sweep(options, target, result);
    } finally {
      this.running = false;
    }
  }

  private async sweep(
    options: RecapRunOptions,
    target: Target,
    result: RecapRunResult,
  ): Promise<RecapRunResult> {
    const limit = options.limit ?? RECAP_DEFAULT_LIMIT;

    const snapshot = await this.deps.recaps.read(this.deps.vault);
    const entries = new Map(snapshot.entries.map((entry) => [entry.conversationId, entry]));
    const catalogs = await this.catalogs();

    const candidates = this.pending(await this.deps.timeline(), entries, target, options);
    result.pending = Math.max(0, candidates.length - Math.min(candidates.length, limit));

    const pass: PassState = { options, target, result, previews: new Map() };

    for (const candidate of candidates.slice(0, limit)) {
      // entre conversacion y conversacion se vuelve a mirar: cerrar la boveda
      // durante una pasada larga tiene que pararla, no llenar el log de errores
      if (this.stopped()) break;
      try {
        await this.reviewOne(candidate, catalogs.get(candidate.conversationId) ?? null, pass);
      } catch (error) {
        // fuera del try de la llamada quedan descifrar la conversacion, leer el
        // almacen y guardar, y cualquiera de las tres puede fallar SIEMPRE para
        // la misma conversacion. Sin esto la excepcion saldria de la tanda, la
        // conversacion no quedaria marcada y, como el orden es cronologico,
        // volveria a ser la primera candidata en cada disparo
        this.markFailure(candidate.conversationId, target.provider, options);
        result.failed.push({
          conversationId: candidate.conversationId,
          reason: redact(error instanceof Error ? error.message : String(error)),
        });
      }
    }

    result.preview = [...pass.previews.values()];
    if (candidates.length > 0) {
      result.pending = await this.remaining(target, options, result.pending);
    }

    // ni un titulo, ni una entrada, ni una cita, ni el identificador de la
    // conversacion: un identificador mas una marca de tiempo ya es un dato
    // correlacionable. Y nada de lo que dijo el modelo al negarse (§8.3)
    this.deps.log('memoria de lo ya hablado', {
      conversaciones: result.reviewed,
      ventanas: result.windows,
      resumidas: result.ok,
      conHuecos: result.partial,
      deducidas: result.deduced,
      negativas: result.refused,
      vagas: result.vague,
      invalidas: result.invalid,
      fallidas: result.failed.length,
      tramosSaltados: result.gaps,
      recortados: result.clipped,
      conservadas: result.kept,
      reescritas: result.rewritten,
      perdidas: result.dropped,
      aportadas: result.added,
      caracteres: result.chars,
      quedan: result.pending,
      proveedor: target.provider,
      sustituido: target.replaced,
    });
    return result;
  }

  /** la boveda se ha cerrado, o alguien ha pedido parar */
  private stopped(): boolean {
    return this.cancelled || !this.deps.vault.isUnlocked();
  }

  /**
   * apunta que esa conversacion fallo con ese CLI, salvo en el vistazo.
   *
   * `dryRun` promete correr la pasada entera y NO dejar rastro, y esto es
   * rastro aunque no toque el disco: `pending()` salta lo que hay en este mapa
   * durante el resto de la sesion, asi que un CLI que no arrancaba durante la
   * prueba dejaba a esas conversaciones fuera de la pasada de VERDAD, sin
   * contarlas en «quedan» y sin salir en el aviso de fallidas. Un vistazo no
   * puede cambiar lo que hara la pasada de verdad.
   */
  private markFailure(
    conversationId: string,
    provider: LocalCliProvider,
    options: RecapRunOptions,
  ): void {
    if (options.dryRun === true) return;
    this.failures.set(conversationId, provider);
  }

  /**
   * a quien se le manda, comprobado dos veces.
   *
   * `resolveAuxiliaryTarget` se fia del tipo de la preferencia, que es lo
   * correcto en un modulo puro. Aqui no: el archivo esta en disco sin cifrar y
   * se puede tocar a mano, y colar ahi un proveedor de pago costaria una llamada
   * cobrada POR VENTANA, que es justo lo que este camino existe para impedir.
   */
  private auxiliary(): Target {
    const target = resolveAuxiliaryTarget(null, this.deps.preferences.auxiliary());
    if (isLocalCliProvider(target.provider)) {
      return { provider: target.provider, model: target.model, replaced: target.replaced };
    }
    return { provider: DEFAULT_AUXILIARY_PROVIDER, model: null, replaced: true };
  }

  /**
   * las escenas ya catalogadas, por conversacion.
   *
   * Un catalogo ilegible no puede parar el relleno: aqui solo sirve para cortar
   * la ventana donde ya se corto antes y para el indice deducido, y las dos
   * cosas tienen alternativa. Se lee una vez por tanda.
   */
  private async catalogs(): Promise<Map<string, RecapCatalog>> {
    const byConversation = new Map<string, RecapCatalog>();
    for (const episode of await this.listCatalog()) {
      const own = byConversation.get(episode.conversationId);
      if (own === undefined) {
        byConversation.set(episode.conversationId, {
          scenes: [episode],
          turnsAtCatalog: episode.turnsAtCatalog,
        });
        continue;
      }
      byConversation.set(episode.conversationId, {
        scenes: [...own.scenes, episode],
        // el mas bajo manda: si una escena se catalogo con la conversacion mas
        // corta, el conjunto no cubre lo que vino despues
        turnsAtCatalog: Math.min(own.turnsAtCatalog, episode.turnsAtCatalog),
      });
    }
    return byConversation;
  }

  private async listCatalog(): Promise<readonly CatalogedEpisode[]> {
    try {
      return await this.deps.catalog.list(this.deps.vault);
    } catch {
      return [];
    }
  }

  /**
   * las conversaciones que pueden tener algo sin resumir, de la mas antigua a la
   * mas nueva.
   *
   * El orden cronologico no es estetico: la ficha se acumula hacia delante, asi
   * que empezar por el final daria una memoria que habla del desenlace antes que
   * del principio.
   */
  private pending(
    timeline: readonly RecapSyncTurn[],
    entries: ReadonlyMap<string, RecapEntry>,
    target: Target,
    options: RecapRunOptions,
  ): Candidate[] {
    const excluded = this.deps.preferences.excluded();

    const grouped = new Map<string, RecapSyncTurn[]>();
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

      const entry = entries.get(conversationId);
      // ya tiene memoria propia. Ni con `force`: la sellada gana siempre, asi
      // que lo que escribiera el CLI no llegaria a ningun prompt
      if (entry !== undefined && entry.supersededAt !== null) continue;

      // haber fallado con un CLI no dice nada del otro, igual que negarse
      if (!options.force && this.failures.get(conversationId) === target.provider) continue;
      if (!options.force && refusedStillRecap(entry, turns.length, target.provider)) continue;

      const ordered = [...turns].sort((a, b) => a.sequence - b.sequence);
      const first = ordered[0];
      if (first === undefined) continue;

      const lastReviewable = lastReviewableRecapTurn(ordered);
      if (lastReviewable === null) continue;

      // «Rehacerlo» empieza de cero: si respetara el cursor, una conversacion ya
      // cubierta con huecos no se podria reintentar con el otro CLI
      const through = options.force === true ? -1 : effectiveRecapThrough(entry, ordered);
      const behind = ordered.filter(
        (turn) => turn.sequence > through && turn.sequence <= lastReviewable,
      ).length;
      if (behind < 1) continue;

      candidates.push({ conversationId, startedAt: first.createdAt, turns: turns.length });
    }

    return candidates.sort(
      (a, b) =>
        a.startedAt.localeCompare(b.startedAt) || a.conversationId.localeCompare(b.conversationId),
    );
  }

  /**
   * lo que queda por rellenar DESPUES de la tanda.
   *
   * No es «las que quedaban menos las que se han intentado»: una conversacion
   * larga puede seguir teniendo cola. Se recalcula con los MISMOS filtros y
   * siempre sin `force`, porque lo que queda es lo que la pasada haria sola.
   *
   * Y sin `conversationId`, por lo mismo: arrastrarlo hacia aqui hacia que
   * «Rehacerlo» de UNA conversacion contestara «quedan 0» con catorce sin
   * tocar, tres parrafos debajo de una linea de cobertura que decia otra cosa.
   * Lo que se anuncia como «lo que queda» es lo que la pasada normal haria
   * sola, no lo que queda de lo que se acaba de pedir.
   */
  private async remaining(
    target: Target,
    options: RecapRunOptions,
    fallback: number,
  ): Promise<number> {
    if (this.stopped()) return fallback;
    try {
      const snapshot = await this.deps.recaps.read(this.deps.vault);
      const entries = new Map(snapshot.entries.map((entry) => [entry.conversationId, entry]));
      return this.pending(await this.deps.timeline(), entries, target, {
        projectAlias: options.projectAlias,
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      }).length;
    } catch {
      return fallback;
    }
  }

  private async reviewOne(
    candidate: Candidate,
    catalog: RecapCatalog | null,
    pass: PassState,
  ): Promise<void> {
    const { conversationId } = candidate;
    const vault = this.deps.vault;
    const now = this.deps.anchor().instant;

    const snapshot = await this.deps.recaps.read(vault);
    const previous = snapshot.entries.find((entry) => entry.conversationId === conversationId);

    // una conversacion que ya tiene memoria sellada viva no se rellena: la
    // sellada gana siempre, asi que el trabajo se tiraria entero
    const sealed = await this.deps.conversations.latestMemory(vault, conversationId);
    if (sealed !== null) {
      await this.markSealed(candidate, previous, now, pass);
      pass.result.superseded += 1;
      return;
    }

    const full = await this.deps.conversations.read(vault, conversationId);
    const turns: RecapTurn[] = full.map((turn) => ({
      sequence: turn.sequence,
      role: turn.role,
      text: turn.text,
      createdAt: turn.createdAt,
    }));

    const state = this.startingState(candidate, turns, previous, now, pass);
    await this.sweepWindows(state, catalog, pass);

    // todas las ventanas fallaron y no habia nada de antes: queda el indice
    // deducido, que no es memoria —solo dice que escenas hubo— pero es cero
    // llamadas e imposible que se niegue. Con la boveda cerrada tampoco, que
    // sellarlo es lo unico que no se puede hacer sin llave.
    //
    // «Y no habia nada de antes» es literal: el indice es la caida de quien NO
    // tiene ficha, nunca el sustituto de una que si se leyo. Sin esa condicion,
    // «Rehacerlo» sobre una ficha aprobada y en uso la cambiaba por un «no se
    // sabe que se dijo dentro» —aprobado ademas sin que nadie lo aprobara— en
    // cuanto el CLI se negaba una vez
    if (
      state.memory === null &&
      state.windows > 0 &&
      !this.stopped() &&
      !this.keepsPrevious(state)
    ) {
      const deduced = this.deduce(state, catalog, pass);
      if (deduced !== null) {
        pass.result.deduced += 1;
        state.delta.deduced += 1;
        await this.persistEntry(deduced, state, pass);
        return;
      }
    }

    if (state.dirty && !this.stopped()) {
      await this.persistEntry(this.entryOf(state, pass), state, pass);
    }
    if (state.wrote) pass.result.reviewed += 1;
  }

  private startingState(
    candidate: Candidate,
    turns: RecapTurn[],
    previous: RecapEntry | undefined,
    now: string,
    pass: PassState,
  ): ConversationState {
    const resumed = this.resumable(previous, turns, pass);

    return {
      conversationId: candidate.conversationId,
      turns,
      now,
      previous: previous ?? null,
      memory: resumed?.memory ?? null,
      through: resumed === null ? -1 : resumed.covered.to,
      covered: resumed?.covered ?? { from: 0, to: 0 },
      coveredAt: resumed?.coveredAt ?? null,
      coveredFrom: resumed?.covered.from ?? null,
      gaps: resumed === null ? [] : [...resumed.gaps],
      refusedKind: null,
      supersededAt: previous?.supersededAt ?? null,
      windows: 0,
      refusedRun: 0,
      wrote: false,
      mutated: false,
      dirty: false,
      delta: zeroCounters(),
      chars: 0,
    };
  }

  /**
   * la ficha de la que se puede seguir, si la hay.
   *
   * «Rehacerlo» empieza de cero a proposito. Y un indice deducido tampoco sirve
   * de semilla: ampliarlo convertiria en ficha unos resumenes de escena que
   * nadie escribio para eso, y ademas la marcaria como escrita por un CLI.
   */
  private resumable(
    previous: RecapEntry | undefined,
    turns: readonly RecapTurn[],
    pass: PassState,
  ): RecapEntry | null {
    if (pass.options.force === true) return null;
    if (previous === undefined) return null;
    if (previous.source !== 'cli') return null;
    if (previous.memory === null) return null;
    if (effectiveRecapThrough(previous, turns) < 0) return null;
    return previous;
  }

  /**
   * el bucle de ventanas de UNA conversacion.
   *
   * Cada vuelta encadena: la ventana N recibe la ficha de la N−1 y la orden no
   * es «resume», es «devuelvela entera, corregida y ampliada». El ancla del
   * principio viaja aparte y se vuelve a poner si el modelo la perdio.
   */
  private async sweepWindows(
    state: ConversationState,
    catalog: RecapCatalog | null,
    pass: PassState,
  ): Promise<void> {
    // el primer turno de la conversacion, para saber si una ventana es de verdad
    // el principio. No basta con «no hay ficha previa»: tras una ventana negada
    // la ficha sigue en null y la siguiente empieza por la mitad
    const firstSequence = state.turns.reduce(
      (lowest, turn) => Math.min(lowest, turn.sequence),
      Number.POSITIVE_INFINITY,
    );

    while (state.windows < RECAP_MAX_WINDOWS) {
      // ENTRE VENTANAS, no solo entre conversaciones: una ventana tarda un
      // minuto y la boveda puede cerrarse dentro
      if (this.stopped()) return;
      // y si ha empezado a contestarse, sus turnos estan cambiando debajo
      if (this.deps.isSending(state.conversationId)) return;

      const window = recapWindow(state.turns, state.through, catalog);
      if (window === null) return;

      const expected = { from: window.fresh[0]!.sequence, to: window.last.sequence };
      const prompt = buildRecapPrompt({
        context: window.context,
        turns: window.fresh,
        previous: state.memory,
        anchor: recapAnchorEntry(state.memory),
        startsAtFirstTurn: expected.from === firstSequence,
      });

      state.windows += 1;
      this.tally(state, pass, 'windows');

      let text: string;
      try {
        const run = await this.deps.controller.runLocalTurn({
          localTurnId: randomUUID(),
          provider: pass.target.provider,
          model: pass.target.model,
          projectAlias: pass.options.projectAlias,
          prompt,
          // resumir es una tarea SOBRE un texto: no encarna a nadie. Pedirselo a
          // quien esta encarnando a alguien dispara la moderacion
          kind: 'technical',
        });
        if (run.outcome !== 'completed') {
          throw new Error(run.error ?? 'el trabajo de fondo no llego a terminar');
        }
        text = run.text;
      } catch (error) {
        // el proceso no termino. No dice nada del contenido, asi que no se
        // persiste como negativa: se marca en la sesion y se deja para otro rato
        this.markFailure(state.conversationId, pass.target.provider, pass.options);
        pass.result.failed.push({
          conversationId: state.conversationId,
          reason: redact(error instanceof Error ? error.message : String(error)),
        });
        state.delta.failed += 1;
        return;
      }

      // PRIMERO se intenta leer el bloque. Si trae una ficha que vale, el modelo
      // no se nego: lo diga como lo diga. Clasificar antes tiraba fichas buenas,
      // porque a este CLI se le ha pedido describir la escena y hablar de
      // contenido explicito o de lo que ella no consiente es hacer el trabajo
      const parsed = parseRecapResponse(text, expected);
      const verified =
        parsed.status === 'structured'
          ? verifyRecap(parsed, { expected, chained: state.memory !== null })
          : null;

      if (verified === null || !verified.ok) {
        // aqui no hay ficha, asi que aqui SI importa distinguir «se nego» de «se
        // rompio»: cambia el boton que hay que pulsar. Y se clasifica lo de
        // FUERA del bloque, nunca el JSON de una ficha
        if (classifyReply(textOutsideRecapBlock(text)).kind === 'refused') {
          this.tally(state, pass, 'refused');
          state.refusedKind = 'refused';
          state.refusedRun += 1;
          // el tramo se DECLARA y se sigue. Saltar hacia delante es legitimo
          // mientras el hueco se diga, y lo que sirve para retomar es la cola
          this.declareGap(state, pass, expected, 'explicito');
          this.advance(state, expected, window.last);
          if (state.refusedRun >= RECAP_MAX_REFUSED_WINDOWS) return;
          continue;
        }

        // ausente, cortado o mal formado: el arreglo es el mismo CLI otra vez o
        // una ventana mas corta, asi que el cursor NO avanza y aqui se para
        state.refusedKind = parsed.status === 'structured' ? 'invalid' : parsed.status;
        this.tally(state, pass, 'invalid');
        state.dirty = true;
        return;
      }
      state.refusedRun = 0;

      // el caso peor no es que se nieguen: es que obedezcan y saneen. Una ficha
      // que no dice que paso apagaria el aviso de turnos omitidos y se
      // convertiria en la semilla que el modelo de pago arrastra para siempre
      if (scoreRecapVagueness(verified.recap.memory).vague) {
        state.refusedKind = 'vague';
        this.tally(state, pass, 'vague');
        state.dirty = true;
        return;
      }

      this.accept(state, pass, window, expected, verified.recap);
      // la boveda ha podido cerrarse durante la llamada, que es lo que mas
      // tarda. Sin llave no se puede sellar, asi que esta ventana se queda sin
      // escribir: es mejor perder una llamada que dejar el archivo a medias
      if (this.stopped()) return;
      await this.persistEntry(this.entryOf(state, pass), state, pass);
    }
  }

  /** una ventana que salio bien: se acumula y el cursor avanza hasta su final */
  private accept(
    state: ConversationState,
    pass: PassState,
    window: { context: RecapTurn[]; fresh: RecapTurn[]; last: RecapTurn },
    expected: { from: number; to: number },
    recap: { memory: ConversationMemory; covered: { from: number; to: number }; gaps: RecapGap[] },
  ): void {
    const chained = state.memory !== null;
    const merged = clampRecapMemory(
      restoreRecapAnchor(recap.memory, recapAnchorEntry(state.memory)),
      { chained },
    );

    // la orden «devuelvela entera, palabra por palabra» no se puede comprobar
    // con otro modelo sin pagarlo; esto la mide sin modelo. Si `dropped` sube,
    // el prompt esta derivando y a la tercera vuelta el principio habra
    // desaparecido
    const drift = countKeptEntries(state.memory, merged);
    this.tally(state, pass, 'kept', drift.kept);
    this.tally(state, pass, 'rewritten', drift.rewritten);
    this.tally(state, pass, 'dropped', drift.dropped);
    // y lo que esta ventana APORTA. Una encadenada que devuelve las seis viejas
    // intactas y no mete ni una nueva sale con pleno en los otros tres
    this.tally(state, pass, 'added', drift.added);
    this.tally(
      state,
      pass,
      'clipped',
      countClippedRecapTurns({ context: window.context, turns: window.fresh }),
    );

    state.memory = merged;
    state.wrote = true;
    state.mutated = true;
    // la ultima ventana ha salido bien: esta conversacion ya no esta negada, y
    // dejarlo puesto haria que la pasada siguiente se la saltara entera con
    // ventanas todavia por delante, y que el panel señalara a un CLI que no se
    // nego a nada
    state.refusedKind = null;

    for (const gap of recap.gaps) this.declareGap(state, pass, gap, gap.why);

    // y lo que se le enseño y dice NO haber tenido en cuenta, POR LAS DOS
    // PUNTAS. El cursor avanza hasta el final de la ventana, asi que lo que se
    // quede fuera tiene que quedar declarado: es la diferencia entre un hueco
    // dicho y un turno dado por leido sin leerse.
    //
    // La cabecera importa tanto como la cola y era la que faltaba: el prompt
    // define `covered` como «el primer y el ultimo turno que has tenido en
    // cuenta», asi que un modelo que se salta el arranque de la ventana lo dice
    // estrechando el `from`, y eso se tragaba entero. Un `from` MENOR que el de
    // la ventana —una ficha encadenada que arrastra el tramo acumulado— no
    // declara nada: de esos turnos ya respondio la ventana anterior
    const head = Math.min(Math.max(recap.covered.from, expected.from), expected.to + 1);
    if (head > expected.from) {
      this.declareGap(state, pass, { from: expected.from, to: head - 1 }, 'otro');
    }

    const read = Math.min(Math.max(recap.covered.to, expected.from - 1), expected.to);
    if (read < expected.to) {
      this.declareGap(state, pass, { from: read + 1, to: expected.to }, 'otro');
    }

    // una ficha con tramos declarados es un EXITO: el modelo hizo su trabajo y
    // dijo donde no llego. Se cuenta aparte para poder verlo, no para castigarlo
    const partial = recap.gaps.length > 0 || read < expected.to || head > expected.from;
    this.tally(state, pass, partial ? 'partial' : 'ok');
    this.advance(state, expected, window.last);
  }

  /** el cursor y el tramo cubierto se mueven juntos, nunca por separado */
  private advance(
    state: ConversationState,
    expected: { from: number; to: number },
    last: RecapTurn,
  ): void {
    state.coveredFrom = state.coveredFrom ?? expected.from;
    state.covered = { from: state.coveredFrom, to: last.sequence };
    state.coveredAt = last.createdAt;
    state.through = last.sequence;
    state.mutated = true;
    state.dirty = true;
  }

  private declareGap(
    state: ConversationState,
    pass: PassState,
    range: { from: number; to: number },
    why: RecapGapReason,
  ): void {
    state.gaps = mergeRecapGaps([...state.gaps, { from: range.from, to: range.to, why }]);
    pass.result.gaps += 1;
    state.mutated = true;
    state.dirty = true;
  }

  private tally(state: ConversationState, pass: PassState, field: TallyField, amount = 1): void {
    if (amount === 0) return;
    state.delta[field] = state.delta[field] + amount;
    pass.result[field] = pass.result[field] + amount;
  }

  /**
   * true cuando esta pasada se va de vacio y lo que ya habia SI valia.
   *
   * Es la otra mitad de la regla de la §16. La primera mitad —«si la pasada no
   * cambia nada, la entrada anterior se conserva entera»— miraba `mutated`, y
   * una negativa SI muta el estado: declara su hueco y mueve el cursor. Eso
   * bastaba mientras el estado partiera de la ficha anterior, porque entonces
   * `state.memory` seguia llena; con «Rehacerlo» se parte de cero a proposito,
   * asi que una sola negativa dejaba `memory` en `null` con `mutated` en true y
   * la entrada se reescribia vacia. Perdido el texto que Daniel habia leido y
   * aprobado, y `recap.json` es la unica copia.
   *
   * Un indice deducido no cuenta: ese si puede sustituirse por otro indice o
   * por una ficha de verdad, porque no lo escribio nadie leyendo la
   * conversacion.
   */
  private keepsPrevious(state: ConversationState): boolean {
    if (state.memory !== null) return false;
    const previous = state.previous;
    return previous !== null && previous.memory !== null && previous.source === 'cli';
  }

  private entryOf(state: ConversationState, pass: PassState): RecapEntry {
    const memory = state.memory;

    // dos casos en los que lo que habia se conserva ENTERO y lo unico que se
    // apunta es que el CLI no dio nada: que esta pasada no haya cambiado NADA
    // —ni la ficha, ni el tramo cubierto, ni los huecos—, y que se haya ido de
    // vacio habiendo una ficha de CLI detras. Reescribir la entrada borraria la
    // aprobacion de Daniel, y con ella la memoria de todos los prompts futuros
    // de ese hilo, por un fallo del trabajo de fondo: justo lo que `D-088`
    // prohibe. Y el motivo si se estampa, para que el panel pueda decir a que
    // CLI cambiar
    if (state.previous !== null && (!state.mutated || this.keepsPrevious(state))) {
      return recapEntrySchema.parse({
        ...state.previous,
        refusedKind: state.refusedKind,
        refusedAtTurns: state.refusedKind === null ? null : state.turns.length,
        refusedProvider: state.refusedKind === null ? null : pass.target.provider,
        supersededAt: state.supersededAt,
      });
    }

    return recapEntrySchema.parse({
      conversationId: state.conversationId,
      memory,
      source: 'cli',
      covered: state.covered,
      coveredAt: state.coveredAt,
      gaps: state.gaps,
      turnsAtRecap: state.turns.length,
      version: RECAP_VERSION,
      provider: pass.target.provider,
      model: pass.target.model,
      at: state.now,
      chars: memory === null ? 0 : formatConversationMemory(memory).length,
      // una ficha recien escrita NO entra en ningun prompt hasta que Daniel la
      // lee y la aprueba. Se reescribe el texto, se reescribe la aprobacion
      approved: false,
      refusedKind: state.refusedKind,
      refusedAtTurns: state.refusedKind === null ? null : state.turns.length,
      refusedProvider: state.refusedKind === null ? null : pass.target.provider,
      supersededAt: state.supersededAt,
    });
  }

  /**
   * el indice deducido, cuando no hubo manera.
   *
   * Conserva la negativa: el panel tiene que poder decir con cual se nego y a
   * cual cambiar, y sin eso la pasada siguiente volveria a intentarlo sola con
   * el mismo CLI para recibir lo mismo.
   */
  private deduce(
    state: ConversationState,
    catalog: RecapCatalog | null,
    pass: PassState,
  ): RecapEntry | null {
    if (catalog === null || catalog.scenes.length === 0) return null;
    const first = state.turns[0];
    const last = state.turns[state.turns.length - 1];
    if (first === undefined || last === undefined) return null;

    const deduced = deduceRecap({
      conversationId: state.conversationId,
      scenes: catalog.scenes,
      first: { sequence: first.sequence, createdAt: first.createdAt },
      last: { sequence: last.sequence, createdAt: last.createdAt },
      turnsAtRecap: state.turns.length,
      anchor: this.deps.anchor(),
      at: state.now,
    });
    if (deduced === null) return null;

    return recapEntrySchema.parse({
      ...deduced,
      refusedKind: state.refusedKind,
      refusedAtTurns: state.refusedKind === null ? null : state.turns.length,
      refusedProvider: state.refusedKind === null ? null : pass.target.provider,
      supersededAt: state.supersededAt,
    });
  }

  /**
   * el UNICO camino de escritura.
   *
   * Con `dryRun` se queda en el vistazo y no toca el disco: por eso basta con no
   * llamar a `apply` para que la pasada entera no deje rastro. Los contadores se
   * suman aqui, dentro del mismo `apply`, para que no se pierdan si la tanda se
   * corta despues.
   */
  private async persistEntry(
    written: RecapEntry,
    state: ConversationState,
    pass: PassState,
  ): Promise<void> {
    /**
     * una aprobacion de Daniel no se cae en silencio.
     *
     * Reescribir una ficha le quita la aprobacion a proposito —el texto es otro,
     * y `approved` existe para que nada que el no haya leido entre en un prompt—,
     * pero el efecto de eso es que la ficha DEJA de viajar en ese hilo. Sin esta
     * marca no quedaba ni rastro de la decision que se ha perdido: en la pantalla
     * salia un «sin aprobar» igual que el de una ficha recien escrita.
     *
     * El disparador que lo hizo visible no es el trabajo de fondo haciendo su
     * trabajo, sino borrar la memoria sellada de un hilo: eso quita
     * `supersededAt`, la conversacion vuelve a la cola y la pasada amplia una
     * ficha que Daniel ya habia aprobado. Aqui se apunta el hecho; el panel lo
     * dice y «Aprobar» lo apaga.
     *
     * Va en el UNICO camino de escritura para que ninguna rama nueva se lo salte.
     */
    const entry = recapEntrySchema.parse({
      ...written,
      approvalReset: written.approved
        ? false
        : state.previous?.approved === true || state.previous?.approvalReset === true,
    });

    const delta = state.delta;
    state.delta = zeroCounters();
    state.dirty = false;

    // lo que se paga en cada turno futuro, sin contar dos veces la conversacion
    // que ha escrito dos ventanas
    pass.result.chars += entry.chars - state.chars;
    state.chars = entry.chars;

    if (pass.options.dryRun === true) {
      // el texto de la ficha es contenido de la boveda: va al panel para poder
      // leerlo antes de decidir, y a ningun registro
      pass.previews.set(entry.conversationId, previewOf(entry));
      return;
    }

    await this.deps.recaps.apply(this.deps.vault, (current) => ({
      counters: addCounters(current.counters, delta),
      // el resto de entradas salen de lo que hay AHORA, no del vistazo con el
      // que empezo la tanda: Daniel ha podido aprobar otra desde el panel
      entries: [
        ...current.entries.filter((each) => each.conversationId !== entry.conversationId),
        entry,
      ],
    }));
  }

  private async markSealed(
    candidate: Candidate,
    previous: RecapEntry | undefined,
    now: string,
    pass: PassState,
  ): Promise<void> {
    if (pass.options.dryRun === true) return;
    if (previous !== undefined) {
      await this.deps.recaps.markSuperseded(this.deps.vault, candidate.conversationId, now);
      return;
    }
    // sin entrada no hay nada que marcar, y sin marca esta conversacion gastaria
    // un hueco de cada tanda para siempre
    await this.deps.recaps.apply(this.deps.vault, (current) => ({
      counters: current.counters,
      entries: [...current.entries, supersededMarker(candidate, now)],
    }));
  }
}
