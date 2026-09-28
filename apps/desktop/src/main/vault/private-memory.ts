// memoria episodica de las conversaciones privadas.
//
// Junta las dos piezas puras —el indice de busqueda y la segmentacion en
// episodios— y les pone lo unico que no puede ser puro: leer los turnos de la
// boveda y saber cuando dejan de valer.
//
// Se construye PEREZOSAMENTE, en la primera busqueda y no al abrir la boveda.
// Abrirla ya tarda lo suyo por el derivado de la contraseña, y quien nunca
// rememore nada no tiene por que pagar una pasada sobre todo su historial.
//
// Y se vacia sola al cerrar la boveda, escuchando a `VaultService.onLock`: aqui
// dentro hay texto descifrado, y cerrar por inactividad o al salir de la
// aplicacion tiene que limpiarlo igual que cerrar a mano.
import type { PrivateConversationStore } from './conversation-store.js';
import type { VaultService } from './vault-service.js';
import { segmentIntoEpisodes, type Episode, type SegmentOptions } from './episodes.js';
import { TurnIndex, tokenize, type IndexedTurn, type TurnMatch } from './turn-index.js';
import type { CatalogedEpisode } from './catalog-store.js';
import type { TimelineTurn } from './relation-selection.js';
import { pickRecentConversations } from '@luxy/shared';

/**
 * lo que se sabe de una conversacion sin descifrarla otra vez: sale del resumen
 * de `list()`, que ya resuelve el dueño con la misma funcion que `owner()`.
 */
interface ConversationFacts {
  characterId: string | null;
  /** tiene algun evento de enganche, aunque se soltara */
  linked: boolean;
  linkedAt: string | null;
  updatedAt: string;
  title: string;
}

export interface PrivateMemoryOptions extends SegmentOptions {
  /**
   * escenas catalogadas por un modelo, si las hay.
   *
   * Cuando una conversacion tiene catalogo, MANDA sobre la segmentacion por
   * silencios: `D-060` demostro que dentro de una sesion continua el reloj no
   * ve donde cambia la escena, y el catalogo si lo ha leido. Sin catalogo se
   * sigue deduciendo, que es tosco pero nunca miente.
   */
  catalog?: () => Promise<readonly CatalogedEpisode[]>;
  /**
   * conversaciones excluidas del banco de recuerdos.
   *
   * Hay hilos que no deberian volver nunca. Se consulta en cada construccion,
   * no se copia, para que cambiarla no exija reiniciar nada.
   */
  excluded?: () => ReadonlySet<string>;
}

export interface RecalledTurn extends IndexedTurn {
  /** el episodio al que pertenece, si cayo dentro de alguno */
  episode: Episode | undefined;
}

export class PrivateMemory {
  private index: TurnIndex | null = null;
  /**
   * indice aparte para lo que escribio el catalogador.
   *
   * Va separado del de turnos porque su texto NO es lo que se dijo: son
   * titulos, resumenes y sobre todo etiquetas que no aparecen en la escena
   * —«primer encuentro»—, que es justo lo que permite encontrarla preguntando
   * de otra forma. Mezclarlo con los turnos ensuciaria lo que despues se cita.
   */
  private scenes: TurnIndex | null = null;
  /**
   * de quien es cada conversacion.
   *
   * Los recuerdos pertenecen al PERSONAJE, no a la boveda (`D-058`). Sin esto,
   * una conversacion recibia los recuerdos de todas las demas —incluidas las de
   * otro personaje, o las de ninguno—, que es a la vez incoherente y una fuga:
   * un hilo nuevo sin personaje contaba la intimidad de otro.
   */
  private facts = new Map<string, ConversationFacts>();
  private episodes: Episode[] = [];
  /**
   * cuando se dijo cada cosa y con que palabras, sin el texto.
   *
   * La dosificacion de los pendientes es aritmetica sobre esto —cuantos
   * mensajes van desde que se prometio, cuando lo saco ella—, y hacerlo con el
   * indice de busqueda no sirve: el indice contesta «quien habla de esto», no
   * «en que orden pasaron las cosas». Se construye aqui, en la misma pasada que
   * ya descifra todo, porque leer el historial otra vez para esto seria pagarlo
   * dos veces.
   */
  private turns: TimelineTurn[] = [];
  private building: Promise<void> | null = null;
  /**
   * cuantas veces se ha tirado lo construido.
   *
   * Una pasada descifra todo el historial y tarda, y en ese rato Daniel puede
   * excluir una conversacion, borrarla o cerrar la boveda. Sin esto, la pasada
   * que ya iba en camino publicaba igual su foto vieja: lo excluido volvia al
   * indice, y con la boveda cerrada el texto en claro volvia a memoria despues
   * de haberla vaciado. El numero es lo unico que sobrevive a `invalidate()`,
   * asi que es lo que permite reconocer el trabajo que ya no vale.
   */
  private generation = 0;

  constructor(
    private readonly conversations: PrivateConversationStore,
    private readonly options: PrivateMemoryOptions = {},
  ) {}

  /**
   * se engancha al cierre de la boveda. Devuelve la funcion de baja.
   *
   * Quien construya esto esta OBLIGADO a llamarlo. Sin esto, cerrar la boveda
   * dejaria todas las conversaciones descifradas en memoria.
   */
  attachTo(vault: VaultService): () => void {
    return vault.onLock(() => this.invalidate());
  }

  /** true si hay algo construido; para diagnosticar, no para decidir */
  get ready(): boolean {
    return this.index !== null;
  }

  get episodeCount(): number {
    return this.episodes.length;
  }

  /** turnos en la linea temporal; para diagnosticar y para comprobar que se vacia */
  get timelineSize(): number {
    return this.turns.length;
  }

  /**
   * tira lo construido.
   *
   * Se llama al cerrar la boveda y cuando el historial cambia. Reconstruir
   * cuesta una pasada sobre lo ya leido; mantener un indice desfasado cuesta que
   * el personaje recuerde algo que se borro.
   */
  invalidate(): void {
    this.index?.clear();
    this.scenes?.clear();
    this.index = null;
    this.scenes = null;
    this.facts.clear();
    this.episodes = [];
    // las raices tambien salen de lo que se dijo: una boveda cerrada no puede
    // seguir sabiendo de que hablaba cada turno
    this.turns = [];
    this.building = null;
    // lo que se este construyendo AHORA describe un historial que ya no es
    // este: subir el numero es como se le dice que no publique
    this.generation += 1;
  }

  private async build(vault: VaultService, generation: number): Promise<void> {
    const index = new TurnIndex();
    const scenes = new TurnIndex();
    const episodes: Episode[] = [];
    const timeline: TimelineTurn[] = [];
    /**
     * el dueño de cada conversacion, LOCAL y publicado al final como todo lo
     * demas. Escribirlo sobre la instancia dentro del bucle dejaba el conjunto
     * que decide el alcance del personaje describiendo una pasada distinta de
     * la del indice: o con conversaciones que ya no estan, o vacio mientras el
     * indice si tenia turnos, que callaba los recuerdos del personaje entero.
     */
    const facts = new Map<string, ConversationFacts>();
    const excluded = this.options.excluded?.() ?? new Set<string>();
    const cataloged = (await this.options.catalog?.()) ?? [];

    for (const conversation of await this.conversations.list(vault)) {
      if (excluded.has(conversation.conversationId)) continue;

      // del resumen, que ya trae el dueño resuelto: antes se volvia a descifrar
      // la conversacion hacia atras solo para esto
      facts.set(conversation.conversationId, {
        characterId: conversation.characterId,
        linked: conversation.ownerLinked === true,
        linkedAt: conversation.linkedAt ?? null,
        updatedAt: conversation.updatedAt,
        title: conversation.title,
      });

      const turns = await this.conversations.read(vault, conversation.conversationId);
      const withId = turns.map((turn) => ({
        conversationId: conversation.conversationId,
        sequence: turn.sequence,
        role: turn.role,
        text: turn.text,
        createdAt: turn.createdAt,
      }));

      index.addAll(withId);

      for (const turn of withId) {
        timeline.push({
          conversationId: turn.conversationId,
          sequence: turn.sequence,
          role: turn.role,
          createdAt: turn.createdAt,
          // sin repetidas: lo que se compara es si se habla de algo, no cuanto
          stems: new Set(tokenize(turn.text)),
        });
      }

      const own = cataloged.filter(
        (scene) => scene.conversationId === conversation.conversationId,
      );
      if (own.length > 0) {
        for (const scene of own) {
          episodes.push(fromCatalog(scene, withId));
          // lo que hace encontrable una escena por parafrasis: el titulo, el
          // resumen y las etiquetas que NO estan escritas dentro de ella
          scenes.add({
            conversationId: scene.conversationId,
            sequence: scene.from,
            role: 'assistant',
            text: `${scene.title} ${scene.tags.join(' ')} ${scene.summary}`,
          });
        }
      } else {
        episodes.push(...segmentIntoEpisodes(withId, this.options));
      }
    }

    // mientras se descifraba, alguien tiro lo construido. Publicar ahora
    // devolveria lo que acababa de salir —una conversacion excluida o borrada—
    // y, si lo que paso fue cerrar la boveda, dejaria el texto en claro dentro
    // de una boveda cerrada. Quien esperaba esta pasada se queda sin indice,
    // que es el lado seguro que ya asumen `search` y `listEpisodes`: no ofrecer
    // nada.
    if (generation !== this.generation) {
      index.clear();
      scenes.clear();
      return;
    }

    this.index = index;
    this.scenes = scenes;
    this.facts = facts;
    // agrupada por conversacion, que es como se leyo. Quien necesite orden
    // cronologico lo rehace: mezclar aqui costaria una ordenacion en cada
    // arranque que casi nadie usa
    this.turns = timeline;
    // del mas reciente al mas antiguo: es el orden en que se enseñan y en que
    // se recortan cuando no caben todos
    this.episodes = episodes.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** construye si hace falta; dos llamadas a la vez comparten la misma pasada */
  private async ensureBuilt(vault: VaultService): Promise<void> {
    if (this.index !== null) return;
    if (this.building === null) {
      const generation = this.generation;
      this.building = this.build(vault, generation).finally(() => {
        // solo la pasada vigente borra la marca: una tardia que la borrara
        // dejaria sin dueño a la que corre ahora, y la siguiente busqueda
        // arrancaria una tercera en paralelo sobre el mismo historial
        if (generation === this.generation) this.building = null;
      });
    }
    await this.building;
  }

  /**
   * conversaciones de un personaje.
   *
   * `null` no significa «todas»: significa «las que tampoco tienen personaje».
   * Un hilo sin personaje no hereda la memoria de nadie.
   *
   * Lee lo ya construido, asi que antes hay que haber pedido algo que
   * construya —`timeline`, `search` o `listEpisodes`—. Sin eso devuelve el
   * conjunto vacio, que es el lado seguro: no ofrecer nada.
   */
  conversationsFor(characterId: string | null): ReadonlySet<string> {
    const own = new Set<string>();
    for (const [conversationId, facts] of this.facts) {
      if (facts.characterId === characterId) own.add(conversationId);
    }
    return own;
  }

  /**
   * el dueño de una conversacion segun lo construido; `undefined` si no esta
   * (excluida, borrada o sin construir todavia).
   */
  ownerOf(conversationId: string): { characterId: string | null; linked: boolean } | undefined {
    const facts = this.facts.get(conversationId);
    return facts === undefined
      ? undefined
      : { characterId: facts.characterId, linked: facts.linked };
  }

  /**
   * si hay indice construido.
   *
   * `timeline()` devuelve `[]` tanto cuando no hay nada como cuando otra cosa
   * invalido el indice a mitad de construirlo, y los lectores de lo construido
   * —`recentFor`, `conversationsFor`— se quedan vacios igual. Para ELEGIR, los
   * dos casos valen lo mismo (no ofrecer nada); para MEDIR no: sin esto la cifra
   * de `D-105` daba por bueno un turno en el que no llego nada.
   */
  isBuilt(): boolean {
    return this.index !== null;
  }

  /**
   * sus conversaciones mas recientes, sin la actual (`D-105`).
   *
   * Las excluidas no estan en el mapa, asi que no salen. Recencia es el ultimo
   * turno o el enganche, lo mas tarde: una recien enganchada entra desde el
   * momento de engancharla. Lee lo ya construido, como `conversationsFor`.
   */
  recentFor(
    characterId: string,
    excludeId: string,
    count: number,
  ): { conversationId: string; title: string; updatedAt: string; linkedAt: string | null }[] {
    const candidates = [...this.facts]
      .filter(([, facts]) => facts.characterId === characterId)
      .map(([conversationId, facts]) => ({
        conversationId,
        title: facts.title,
        updatedAt: facts.updatedAt,
        linkedAt: facts.linkedAt,
      }));
    return pickRecentConversations(candidates, excludeId, count);
  }

  /**
   * un turno tal y como esta AHORA, sin volver a descifrar nada.
   *
   * Es lo que permite comprobar que la cita de un pendiente sigue apareciendo
   * en su turno antes de enseñarla. Devuelve `null` si el turno se retiro o si
   * su numero se reutilizo, que es exactamente el caso en el que la nota deja de
   * tener respaldo y no debe ofrecerse.
   */
  turnAt(conversationId: string, sequence: number): IndexedTurn | null {
    return this.index?.get(conversationId, sequence) ?? null;
  }

  /**
   * cuando se dijo cada turno del personaje y con que raices.
   *
   * Sin `characterId` van todos, como en `listEpisodes`: lo usa el diagnostico.
   * Va agrupada por conversacion y no en orden cronologico; quien cuente
   * mensajes seguidos la reordena.
   */
  async timeline(vault: VaultService, characterId?: string | null): Promise<TimelineTurn[]> {
    await this.ensureBuilt(vault);
    if (characterId === undefined) return [...this.turns];

    const own = this.conversationsFor(characterId);
    return this.turns.filter((turn) => own.has(turn.conversationId));
  }

  /**
   * episodios del personaje indicado, del mas reciente al mas antiguo.
   *
   * Sin `characterId` devuelve todos: lo usa la pantalla de diagnostico, que
   * existe para ver que hay. Un turno SIEMPRE pasa el suyo.
   */
  async listEpisodes(vault: VaultService, characterId?: string | null): Promise<Episode[]> {
    await this.ensureBuilt(vault);
    if (characterId === undefined) return this.episodes;

    const own = this.conversationsFor(characterId);
    return this.episodes.filter((episode) => own.has(episode.conversationId));
  }

  /**
   * turnos que mejor encajan con la consulta, con su episodio al lado.
   *
   * Devuelve turnos y no episodios a proposito: el que llama decide cuanto
   * contexto cita alrededor, que es lo que separa «sabe que ocurrio» de
   * «lo recuerda con sus palabras».
   */
  async search(
    vault: VaultService,
    query: string,
    options: {
      limit?: number;
      characterId?: string | null;
      /**
       * ademas, SOLO en estas conversaciones.
       *
       * Para elegir entre los momentos de un dia: buscando en toda la memoria,
       * una palabra que sale mucho en otros dias se llevaba los resultados.
       */
      conversationIds?: ReadonlySet<string>;
    } = {},
  ): Promise<RecalledTurn[]> {
    await this.ensureBuilt(vault);
    if (this.index === null) return [];

    const limit = options.limit ?? 5;
    // sin personaje indicado se busca en todo; con el, solo en lo suyo
    const delPersonaje =
      options.characterId === undefined ? undefined : this.conversationsFor(options.characterId);
    const pedidas = options.conversationIds;
    const only =
      pedidas === undefined
        ? delPersonaje
        : new Set([...pedidas].filter((id) => delPersonaje === undefined || delPersonaje.has(id)));
    // las dos busquedas se mezclan: una acierta por lo que se dijo y la otra
    // por como se llama. Una escena encontrada por su etiqueta apunta a su
    // primer turno real, que es lo que despues se cita
    const found = new Map<string, TurnMatch>();
    for (const match of [
      ...this.index.search(query, { limit, ...(only === undefined ? {} : { only }) }),
      ...(this.scenes?.search(query, { limit, ...(only === undefined ? {} : { only }) }) ?? []),
    ]) {
      const key = `${match.conversationId}#${match.sequence}`;
      const previous = found.get(key);
      if (previous === undefined || match.score > previous.score) found.set(key, match);
    }

    return [...found.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .flatMap((match) => {
        const turn = this.index!.get(match.conversationId, match.sequence);
        if (turn === undefined) return [];
        return [{ ...turn, episode: this.episodeFor(match.conversationId, match.sequence) }];
      });
  }

  /** los turnos de un episodio, en orden, para citarlos tal y como se dijeron */
  async readEpisode(vault: VaultService, episode: Episode): Promise<IndexedTurn[]> {
    await this.ensureBuilt(vault);
    if (this.index === null) return [];

    const turns: IndexedTurn[] = [];
    for (let sequence = episode.from; sequence <= episode.to; sequence += 1) {
      const turn = this.index.get(episode.conversationId, sequence);
      if (turn !== undefined) turns.push(turn);
    }
    return turns;
  }

  private episodeFor(conversationId: string, sequence: number): Episode | undefined {
    return this.episodes.find(
      (episode) =>
        episode.conversationId === conversationId &&
        sequence >= episode.from &&
        sequence <= episode.to,
    );
  }
}

/** un episodio a partir de una escena catalogada, con sus fechas reales */
function fromCatalog(scene: CatalogedEpisode, turns: readonly IndexedTurn[]): Episode {
  const inside = turns.filter(
    (turn) => turn.sequence >= scene.from && turn.sequence <= scene.to,
  ) as (IndexedTurn & { createdAt?: string })[];

  return {
    conversationId: scene.conversationId,
    from: scene.from,
    to: scene.to,
    startedAt: inside[0]?.createdAt ?? scene.catalogedAt,
    endedAt: inside[inside.length - 1]?.createdAt ?? scene.catalogedAt,
    turns: inside.length,
    title: scene.title,
    catalogedBy: scene.model,
    ...(scene.summary.length > 0 ? { summary: scene.summary } : {}),
  };
}
