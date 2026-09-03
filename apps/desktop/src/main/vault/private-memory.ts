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
import { TurnIndex, type IndexedTurn, type TurnMatch } from './turn-index.js';
import type { CatalogedEpisode } from './catalog-store.js';

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
  private characterOf = new Map<string, string | null>();
  private episodes: Episode[] = [];
  private building: Promise<void> | null = null;

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
    this.characterOf.clear();
    this.episodes = [];
    this.building = null;
  }

  private async build(vault: VaultService): Promise<void> {
    const index = new TurnIndex();
    const scenes = new TurnIndex();
    const episodes: Episode[] = [];
    const excluded = this.options.excluded?.() ?? new Set<string>();
    const cataloged = (await this.options.catalog?.()) ?? [];

    for (const conversation of await this.conversations.list(vault)) {
      if (excluded.has(conversation.conversationId)) continue;

      this.characterOf.set(
        conversation.conversationId,
        await this.conversations.latestCharacterId(vault, conversation.conversationId),
      );

      const turns = await this.conversations.read(vault, conversation.conversationId);
      const withId = turns.map((turn) => ({
        conversationId: conversation.conversationId,
        sequence: turn.sequence,
        role: turn.role,
        text: turn.text,
        createdAt: turn.createdAt,
      }));

      index.addAll(withId);

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

    this.index = index;
    this.scenes = scenes;
    // del mas reciente al mas antiguo: es el orden en que se enseñan y en que
    // se recortan cuando no caben todos
    this.episodes = episodes.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** construye si hace falta; dos llamadas a la vez comparten la misma pasada */
  private async ensureBuilt(vault: VaultService): Promise<void> {
    if (this.index !== null) return;
    this.building ??= this.build(vault).finally(() => {
      this.building = null;
    });
    await this.building;
  }

  /**
   * conversaciones de un personaje.
   *
   * `null` no significa «todas»: significa «las que tampoco tienen personaje».
   * Un hilo sin personaje no hereda la memoria de nadie.
   */
  private conversationsOf(characterId: string | null): ReadonlySet<string> {
    const own = new Set<string>();
    for (const [conversationId, owner] of this.characterOf) {
      if (owner === characterId) own.add(conversationId);
    }
    return own;
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

    const own = this.conversationsOf(characterId);
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
    options: { limit?: number; characterId?: string | null } = {},
  ): Promise<RecalledTurn[]> {
    await this.ensureBuilt(vault);
    if (this.index === null) return [];

    const limit = options.limit ?? 5;
    // sin personaje indicado se busca en todo; con el, solo en lo suyo
    const only =
      options.characterId === undefined ? undefined : this.conversationsOf(options.characterId);
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
  };
}
