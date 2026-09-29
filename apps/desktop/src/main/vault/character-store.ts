// personajes del proveedor de imagenes, guardados en la boveda.
//
// Por que existe este archivo: crear un personaje CUESTA CREDITOS y su
// identificador solo se devuelve una vez. Antes se guardaba unicamente si el
// usuario enviaba un mensaje justo despues, porque viajaba dentro del turno
// cifrado; si cerraba la pantalla, el personaje quedaba pagado y perdido. La
// API no tiene forma de listarlos —solo crear, modificar y generar—, asi que
// un identificador que no se guarde aqui no se recupera de ninguna manera.
//
// Se cifra como todo lo demas: un personaje describe a alguien, y saber que
// existe uno con ciertos rasgos ya dice bastante. Usa el dominio `identity`,
// que es exactamente para esto.
//
// Es LOCAL: todavia no se sincroniza entre equipos. Los personajes de un
// portatil no aparecen en el de sobremesa.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { openBlob, openText, sealBlob, sealText, wipe, type SealedEnvelope } from '@luxy/vault-crypto';
import {
  hordeRecipeSchema,
  VAULT_PENDING_PACINGS,
  VAULT_RECENT_MEMORIES,
  VAULT_REPLY_GUIDANCES,
} from '@luxy/shared';
import { VaultError, type VaultService } from './vault-service.js';
import { randomObjectKey } from './private-store.js';
import type { BlobStore } from './blob-store.js';

export function charactersFilePath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'characters.json');
}

/** su identidad en el proveedor de pago, cuando la tiene */
const xaviraIdentitySchema = z.object({
  /**
   * el identificador que devolvio SU API. No es el de la boveda.
   *
   * Confundirlos era el error de diseño anterior: el de la boveda es nuestro y
   * no cambia nunca, y este pertenece a un servicio que puede dejar de usarse.
   */
  characterId: z.string().min(1).max(128),
  /** modelo con el que se creo alli; no se puede cambiar despues */
  modelId: z.string().min(1).max(64),
});

/** su aspecto en AI Horde, cuando lo tiene */
const hordeIdentitySchema = z.object({
  /**
   * lo que hace que dos imagenes parezcan la misma persona, porque en esa red
   * no hay nada que lo recuerde por nosotros.
   */
  recipe: hordeRecipeSchema,
});

/**
 * lo que se guarda de cada personaje, ya descifrado.
 *
 * REGLA CENTRAL: `characterId` es la identidad DURABLE y no cambia nunca. A el
 * se agarran las conversaciones, los recuerdos y las imagenes ya generadas.
 * De quien vengan las fotos es una propiedad suya que se cambia cuando se
 * quiera, y cambiarla no le quita nada.
 *
 * El diseño anterior ataba el personaje a un proveedor, asi que usarlo en el
 * otro obligaba a crear uno nuevo —identificador nuevo— y ahi se quedaban su
 * historia y sus recuerdos. Ver `D-068`.
 */
export const vaultCharacterSchema = z.object({
  /**
   * clave durable, nuestra y solo nuestra. NO es la de ningun proveedor.
   *
   * En los personajes creados antes de `D-068` coincide con la de Xavira,
   * porque entonces eran lo mismo. Se conserva tal cual a proposito: cambiarla
   * dejaria sus conversaciones y sus recuerdos apuntando a nadie.
   */
  characterId: z.string().min(1).max(128),
  /** quien da las fotos AHORA. Se cambia sin tocar nada mas del personaje */
  imageProvider: z.enum(['xavira', 'horde']).default('xavira'),
  /**
   * si hay que ENSEÑAR el texto antes de generar, o mandarlo de una vez.
   *
   * Es del personaje y no de la maquina porque lo que se revisa depende de el:
   * en AI Horde el texto se compone a partir de SU receta —y un rasgo mal
   * recortado devuelve a otra persona—, mientras que en Xavira la identidad
   * vive en el servidor del proveedor y aqui apenas hay nada que corregir.
   *
   * Nace en 'siempre' porque lo que se pidio fue ver el texto ANTES de pagar
   * una generacion; 'nunca' devuelve el comportamiento anterior en una sola
   * pulsacion. Dos valores y no tres: un tercero solo aplazaria la decision.
   *
   * CUIDADO, y esta escrito porque no da ningun error: `add()` reescribe la
   * lista ENTERA (`list()` -> `parse()` -> `write()`), asi que un Studio
   * anterior a este campo lo borraria en silencio al tocar cualquier otro
   * personaje. Es la misma trampa que `setCaption` con el sobre de un medio.
   * No se pierde nada que no se pueda volver a poner —el campo renace con su
   * valor por defecto y el registro de intentos no depende de el—, pero pasa
   * sin aviso.
   */
  imageReview: z.enum(['siempre', 'nunca']).default('siempre'),
  /**
   * en una escena donde salen LOS DOS, que se dibuja: solo el personaje o la
   * escena entera.
   *
   * Es del personaje y no de la maquina por lo mismo que `imageReview`: con
   * quien salga bien acompañado se deja entero, y con quien no, no. Estos
   * modelos encajan mal dos figuras —anatomias cruzadas, miembros de mas—, asi
   * que la decision tiene que poder deshacerse en una pulsacion.
   *
   * Nace en `character-only`, que es EXACTAMENTE lo que se venia haciendo: el
   * bloque de instrucciones pide plano cercano de ella sola y el negativo
   * prohibe una segunda persona. Mientras valga `character-only` no cambia ni
   * un byte de lo que se manda.
   *
   * Los valores van en ingles a proposito. `imageReview` los guarda en
   * castellano y eso contradice la regla de identificadores de `CLAUDE.md`; se
   * anoto como deuda al escribirlo y no se repite aqui.
   *
   * MISMA TRAMPA que `imageReview`, y no da ningun error: `add()` reescribe la
   * lista ENTERA, asi que un Studio anterior a este campo lo devolveria a su
   * valor por defecto al tocar cualquier otro personaje.
   */
  imageCast: z.enum(['character-only', 'both']).default('character-only'),
  /**
   * si su prompt lleva las dos notas de direccion contra la autocopia y la
   * pasividad (`D-102`): no reutilizar la forma de sus respuestas anteriores y
   * poner su parte en la escena en vez de devolver la decision.
   *
   * Del personaje y no de la maquina, como `imageCast`: es como escribe ESE
   * personaje, y tiene que poder compararse con y sin en una pulsacion. Nace en
   * `none`, que no añade nada: esta casilla, apagada, no cambia ni un byte del
   * prompt.
   *
   * MISMA TRAMPA que los dos de arriba: `add()` reescribe la lista ENTERA, asi
   * que un Studio anterior a este campo lo devolveria a `none` al tocar
   * cualquier otro personaje. Y por eso mismo, si un dia se separan las dos
   * notas, se hace con un campo nuevo y no con valores nuevos del enum: un
   * valor que un Studio antiguo no conoce hace que `list()` descarte la lista
   * entera, y el siguiente `add()` la borraria.
   */
  replyGuidance: z.enum(VAULT_REPLY_GUIDANCES).default('none'),
  /**
   * si sus pendientes van en modo esporadico (`D-104`): el bloque solo entra en
   * uno de cada varios mensajes, le pide sacarlos solo si la escena los trae y
   * le avisa, sin decir cual, cuando ya saco uno.
   *
   * Del personaje, como `replyGuidance`, y con la misma idea: compararlo con y
   * sin en una pulsacion. Nace en `per-note`, que es la dosificacion de siempre:
   * apagada, esta casilla no cambia ni un byte del prompt. Ojo: con
   * `recentMemories` encendido la regla del bloque de pendientes SI cambia
   * (`pendingNotListedRule`), por esa otra casilla y no por esta.
   *
   * MISMA TRAMPA que los de arriba: `add()` reescribe la lista ENTERA, asi que un
   * Studio anterior a este campo lo devolveria a `per-note` al tocar cualquier
   * otro personaje. Y si un dia se separan los tres cambios, se hace con campos
   * nuevos y no con valores nuevos del enum: un valor que un Studio antiguo no
   * conoce hace que `list()` descarte la lista entera, y el siguiente `add()` la
   * borraria.
   */
  pendingPacing: z.enum(VAULT_PENDING_PACINGS).default('per-note'),
  /**
   * si en cada turno le llega la memoria de sus dos conversaciones mas
   * recientes, entera y sin `plan` ni `openQuestions` (`D-105`, quinta ronda),
   * y con ella la guia de que va en cada campo de la memoria.
   *
   * Del personaje, como los de arriba. Nace en `off`, que no añade nada: esta
   * casilla, apagada, no cambia ni un byte del prompt.
   *
   * MISMA TRAMPA que los de arriba: `add()` reescribe la lista ENTERA, asi que un
   * Studio anterior a este campo lo devolveria a `off` al tocar cualquier otro
   * personaje. Y si un dia se separan el resumen y la guia, se hace con un campo
   * nuevo y no con valores nuevos del enum, por lo mismo.
   */
  recentMemories: z.enum(VAULT_RECENT_MEMORIES).default('off'),
  xavira: xaviraIdentitySchema.nullable().default(null),
  horde: hordeIdentitySchema.nullable().default(null),
  /** quien es, en texto, para el modelo que escribe */
  description: z.string().max(2000),
  /** etiqueta que pone el usuario para reconocerlo */
  label: z.string().max(100),
  /**
   * avatar base, cifrado en el almacen de objetos.
   *
   * Se guarda porque se pago con la creacion y es lo unico visual que la
   * identifica: sin el habia que generar otra imagen para ver a quien acabas de
   * crear. `null` si no se pudo descargar.
   */
  avatarObjectKey: z.string().regex(/^[0-9a-f]{32}$/).nullable().default(null),
  createdAt: z.string().datetime(),
});
export type VaultCharacter = z.infer<typeof vaultCharacterSchema>;

/**
 * lo que hace falta aportar para guardar uno.
 *
 * Es la ENTRADA del esquema, no la salida: los campos con valor por defecto no
 * hay que escribirlos. Sin esta distincion, añadir un campo con default
 * obligaria a tocar todas las llamadas que ya existen, que es justo lo que el
 * default esta evitando.
 */
export type VaultCharacterInput = z.input<typeof vaultCharacterSchema>;

/**
 * lo que puede haber ESCRITO en disco, incluido lo anterior a `D-068`.
 *
 * Antes un personaje era de un proveedor: llevaba `provider`, `modelId` y, si
 * era del horde, `recipe`. Aqui eso se traduce a la forma nueva **al leer**, sin
 * reescribir el archivo y sin tocar `characterId`, que es lo unico que no se
 * puede mover: sus conversaciones y sus recuerdos apuntan a el.
 *
 * En un personaje de Xavira anterior, la clave de la boveda ERA la de su API.
 * La migracion la copia dentro de `xavira` y a partir de ahi el codigo usa esa
 * y nunca la de la boveda, que es lo que permite que el mismo personaje exista
 * tambien en el horde.
 */
export const storedCharacterSchema = vaultCharacterSchema
  .extend({
    provider: z.enum(['xavira', 'horde']).optional(),
    modelId: z.string().min(1).max(64).optional(),
    recipe: hordeRecipeSchema.nullable().optional(),
  })
  .transform((raw): VaultCharacter => {
    const { provider, modelId, recipe, ...rest } = raw;
    // ya esta en la forma nueva: no hay nada que traducir
    if (rest.xavira !== null || rest.horde !== null) return rest;

    const legacy = provider ?? 'xavira';
    return {
      ...rest,
      imageProvider: legacy,
      xavira:
        legacy === 'xavira'
          ? { characterId: rest.characterId, modelId: modelId ?? 'realistic-sharp-v1' }
          : null,
      horde: legacy === 'horde' && recipe != null ? { recipe } : null,
    };
  });

const sealedFileSchema = z.object({
  version: z.literal(1),
  /** un unico sobre con la lista entera: son pocos y se leen de golpe */
  content: z.object({
    version: z.number().int(),
    purpose: z.string(),
    nonce: z.string(),
    ciphertext: z.string(),
  }),
});

/**
 * al LEER se admite tambien la forma anterior a `D-068`, que se traduce sola.
 *
 * Al escribir se usa siempre la nueva: `write()` guarda lo que devuelve esta
 * lectura, asi que el archivo se pone al dia solo la proxima vez que se añada o
 * se quite un personaje. Mientras tanto se sigue leyendo igual de bien.
 */
const listPayloadSchema = z.object({
  v: z.literal(1),
  characters: z.array(storedCharacterSchema),
});

/**
 * lista de personajes, cifrada en un solo archivo.
 *
 * Un archivo por linea como en las conversaciones no aporta aqui: son pocos,
 * se leen enteros y se reescriben al añadir. Lo que si se conserva es la
 * escritura atomica, para que un corte no deje la lista ilegible.
 */
export class VaultCharacterStore {
  constructor(
    private readonly file: string,
    private readonly blobs: BlobStore,
  ) {}

  /**
   * guarda el avatar cifrado y devuelve su clave opaca.
   *
   * Los bytes entran en claro y salen cifrados aqui dentro, como en el almacen
   * de medios: en ningun momento existe una copia sin cifrar en disco.
   */
  async saveAvatar(vault: VaultService, bytes: Uint8Array): Promise<string> {
    if (bytes.length === 0) throw new VaultError('el avatar esta vacio');
    const objectKey = randomObjectKey();
    const key = vault.subkeyFor('identity', `avatar:${objectKey}`);
    try {
      await this.blobs.put(objectKey, await sealBlob(key, 'vault.identity', bytes));
      return objectKey;
    } finally {
      wipe(key);
    }
  }

  /** devuelve los bytes descifrados del avatar, en memoria */
  async readAvatar(vault: VaultService, objectKey: string): Promise<Uint8Array> {
    const key = vault.subkeyFor('identity', `avatar:${objectKey}`);
    try {
      return await openBlob(key, 'vault.identity', await this.blobs.get(objectKey));
    } finally {
      wipe(key);
    }
  }

  async list(vault: VaultService): Promise<VaultCharacter[]> {
    if (!existsSync(this.file)) return [];

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      throw new VaultError('el archivo de personajes no se puede leer');
    }
    const parsed = sealedFileSchema.safeParse(raw);
    if (!parsed.success) throw new VaultError('el archivo de personajes no tiene el formato esperado');

    const key = vault.subkeyFor('identity', 'characters');
    try {
      const text = await openText(key, 'vault.identity', parsed.data.content as SealedEnvelope);
      const payload = listPayloadSchema.safeParse(JSON.parse(text));
      return payload.success ? payload.data.characters : [];
    } finally {
      wipe(key);
    }
  }

  /**
   * guarda un personaje recien creado.
   *
   * Se llama INMEDIATAMENTE despues de que la API lo devuelva, antes de que el
   * usuario pueda hacer cualquier otra cosa: es lo unico que impide pagar por
   * un identificador y perderlo.
   */
  async add(vault: VaultService, character: VaultCharacterInput): Promise<VaultCharacter[]> {
    const existing = await this.list(vault);
    // reescribir el mismo identificador actualiza en vez de duplicar
    const characters = [
      ...existing.filter((entry) => entry.characterId !== character.characterId),
      vaultCharacterSchema.parse(character),
    ];
    await this.write(vault, characters);
    return characters;
  }

  /** olvida un personaje. No lo borra en el proveedor: alli sigue existiendo */
  async remove(vault: VaultService, characterId: string): Promise<VaultCharacter[]> {
    const characters = (await this.list(vault)).filter(
      (entry) => entry.characterId !== characterId,
    );
    await this.write(vault, characters);
    return characters;
  }

  private async write(vault: VaultService, characters: VaultCharacter[]): Promise<void> {
    const key = vault.subkeyFor('identity', 'characters');
    try {
      const content = await sealText(
        key,
        'vault.identity',
        JSON.stringify({ v: 1, characters } satisfies z.infer<typeof listPayloadSchema>),
      );
      mkdirSync(join(this.file, '..'), { recursive: true });
      // atomica: un corte a medias no puede dejar la lista ilegible, que aqui
      // significaria perder identificadores pagados
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, content }, null, 2), 'utf8');
      renameSync(temporary, this.file);
    } finally {
      wipe(key);
    }
  }
}
