// escenas catalogadas por un modelo, guardadas cifradas.
//
// Es lo UNICO de la memoria episodica que hay que persistir. Los episodios
// deducidos salen de los turnos y se recalculan (`D-058`); un titulo y unas
// etiquetas escritas por un modelo no salen de ningun sitio, asi que si no se
// guardan se pagan otra vez en cada arranque.
//
// Se cifra como todo lo demas y por el mismo motivo que los personajes: un
// titulo describe lo que paso, y saber que existe una escena llamada de cierta
// forma ya dice bastante. Usa el dominio `identity`.
//
// Un archivo unico, como los personajes: son pocos, se leen de golpe y se
// reescriben al catalogar. Lo que si se conserva es la escritura atomica.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { openText, sealText, wipe, type SealedEnvelope } from '@luxy/vault-crypto';
import { catalogedSceneSchema } from '@luxy/shared';
import { VaultError, type VaultService } from './vault-service.js';

export function catalogFilePath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'catalog.json');
}

export const catalogedEpisodeSchema = catalogedSceneSchema.extend({
  conversationId: z.string().uuid(),
  /** con que modelo se catalogo; sirve para decidir si merece rehacerse */
  model: z.string().max(128).nullable().default(null),
  catalogedAt: z.string().datetime(),
  /**
   * turnos que tenia la conversacion al catalogarla.
   *
   * Es lo que permite saber que un catalogo se ha quedado corto sin volver a
   * leerlo entero: si la conversacion ha crecido, hay escenas nuevas sin
   * catalogar.
   */
  turnsAtCatalog: z.number().int().min(0),
});

export type CatalogedEpisode = z.infer<typeof catalogedEpisodeSchema>;

const sealedFileSchema = z.object({
  version: z.literal(1),
  content: z.object({
    version: z.number().int(),
    purpose: z.string(),
    nonce: z.string(),
    ciphertext: z.string(),
  }),
});

const payloadSchema = z.object({
  v: z.literal(1),
  episodes: z.array(catalogedEpisodeSchema),
});

export class CatalogStore {
  constructor(private readonly file: string) {}

  async list(vault: VaultService): Promise<CatalogedEpisode[]> {
    if (!existsSync(this.file)) return [];

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      throw new VaultError('el catalogo de escenas no se puede leer');
    }
    const parsed = sealedFileSchema.safeParse(raw);
    if (!parsed.success) throw new VaultError('el catalogo de escenas no tiene el formato esperado');

    const key = vault.subkeyFor('identity', 'catalog');
    try {
      const text = await openText(key, 'vault.identity', parsed.data.content as SealedEnvelope);
      const payload = payloadSchema.safeParse(JSON.parse(text));
      // un catalogo ilegible NO es un error que deba parar nada: lo peor que
      // pasa es volver a la segmentacion por silencios y catalogar otra vez
      return payload.success ? payload.data.episodes : [];
    } finally {
      wipe(key);
    }
  }

  /**
   * sustituye el catalogo de UNA conversacion.
   *
   * Sustituye y no añade: recatalogar produce escenas nuevas para el mismo
   * tramo, y conservar las viejas dejaria dos versiones del mismo momento
   * compitiendo en la misma lista.
   */
  async replaceForConversation(
    vault: VaultService,
    conversationId: string,
    episodes: readonly CatalogedEpisode[],
  ): Promise<CatalogedEpisode[]> {
    const others = (await this.list(vault)).filter(
      (episode) => episode.conversationId !== conversationId,
    );
    const next = [...others, ...episodes];
    await this.persist(vault, next);
    return next;
  }

  /** al borrar una conversacion, su catalogo deja de tener a que referirse */
  async removeConversation(vault: VaultService, conversationId: string): Promise<void> {
    const remaining = (await this.list(vault)).filter(
      (episode) => episode.conversationId !== conversationId,
    );
    await this.persist(vault, remaining);
  }

  private async persist(vault: VaultService, episodes: readonly CatalogedEpisode[]): Promise<void> {
    const key = vault.subkeyFor('identity', 'catalog');
    try {
      const sealed = await sealText(
        key,
        'vault.identity',
        JSON.stringify({ v: 1, episodes: [...episodes] } satisfies z.infer<typeof payloadSchema>),
      );
      mkdirSync(join(this.file, '..'), { recursive: true });

      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, content: sealed }), 'utf8');
      renameSync(temporary, this.file);
    } finally {
      wipe(key);
    }
  }
}
