// intentos de imagen de una conversacion, guardados cifrados.
//
// Apunta lo que hoy se tira por el camino: el texto exacto que salio hacia el
// proveedor, el `rc` del rechazo ('csam' no es lo mismo que 'censored'), los
// avisos del envio, la semilla REAL y el worker que atendio. Sin esto, un fallo
// de generacion deja una frase y nada mas, y una imagen que salio bien no se
// puede repetir porque la semilla la sorteo el servidor.
//
// QUE NO ES: el historial de la conversacion. Es un archivo aparte, no entra en
// ningun prompt, no se le enseña al modelo y no aparece en el hilo. Por eso
// puede llevar el motivo tecnico de un fallo sin contradecir la razon por la
// que `ultimaImagenFallida` vive solo en memoria.
//
// Dos diferencias deliberadas con `catalog-store.ts`, del que copia lo demas
// (esquema del sobre, escritura atomica, `wipe(key)` en el `finally`):
//
// 1) UN ARCHIVO POR CONVERSACION. Es lo que permite que borrar una conversacion
//    borre el archivo entero, en vez de dejar su texto cifrado y huerfano
//    dentro de un archivo comun.
// 2) SUBCLAVE DE CONVERSACION, no de identidad, y CON COMPARTIMENTO PROPIO
//    dentro de ella. Lo que se guarda es texto verbatim de escena, exactamente
//    la misma sensibilidad que los turnos de esa conversacion; el catalogo y
//    `relation.json` guardan resumenes derivados y por eso les basta
//    `identity`. Meter esto ahi seria un compartimento mas debil que el que el
//    proyecto ya aplica a este material.
//
//    El compartimento propio —el sufijo del contexto, ver `attemptKeyContext`—
//    es lo que impide que el sobre de un turno y el de este archivo sean la
//    misma cosa para el criptosistema.
//
// Regla dura: este almacen NUNCA escribe a ningun registro. No recibe logger a
// proposito, para que no se pueda.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { openText, sealText, wipe, type SealedEnvelope } from '@luxy/vault-crypto';
import { imageAttemptSchema, type ImageAttempt, type VaultImageAttemptState } from '@luxy/shared';
import { VaultError, type VaultService } from './vault-service.js';

/** id de conversacion: uuid, y nada mas. evita cualquier travesia de rutas */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * cuantos intentos CON COPIA EN OTRO SITIO se conservan por conversacion.
 *
 * Un intento `ok` tiene su imagen guardada aparte, y el medio lleva dentro el
 * prompt que se mando y el `attemptId` que los enlaza: podar el apunte no borra
 * la unica copia de nada. `discarded` y `superseded` no llegaron a generar y no
 * hay nada que diagnosticar en ellos.
 */
export const IMAGE_ATTEMPT_RING = 50;

/**
 * cuantos intentos SIN COPIA EN NINGUN SITIO se conservan, que son muchos mas.
 *
 * LO OBSERVADO, el 2026-09-17: el usuario fue a mirar un intento que el filtro
 * habia bloqueado y Studio le contesto «ese intento ya no esta en el registro:
 * de cada conversacion se guardan solo los ultimos». Que la causa fuera agotar
 * los 50 en una tarde de pruebas es la explicacion mas probable, pero no se
 * midio: nadie conto los intentos de ese archivo.
 *
 * Lo que si se sigue del diseño, y es el motivo del cupo aparte: al podar por
 * antiguedad sale por la ventana justo lo irrecuperable. Un fallo o un bloqueo
 * solo existe aqui —no hay imagen que lo guarde— y es ademas lo que se va a
 * mirar.
 *
 * 200 porque los fallos son una fraccion de los intentos: cubren varios dias de
 * pruebas como aquella, no unas horas. Y hay tope porque el archivo entero se
 * vuelve a sellar y a escribir en cada apunte; sin limite, una conversacion
 * vieja pagaria esa escritura en cada imagen que se pide.
 */
export const IMAGE_ATTEMPT_DIAGNOSTIC_RING = 200;

/**
 * los estados cuyo apunte es la unica copia que queda de ellos.
 *
 * `failed` incluye los bloqueos —`rc` 'csam' o 'censored'—, que es lo que mas se
 * consulta. `malformed` guarda el bloque que el modelo escribio mal, que no esta
 * en ningun otro sitio porque el turno no lo enseña. Y `sent` es una peticion
 * que salio y nunca se cerro —Studio cerrado a mitad—: sin su apunte no queda
 * rastro de que llegase a mandarse.
 */
const DIAGNOSTIC_STATES: ReadonlySet<VaultImageAttemptState> = new Set([
  'failed',
  'malformed',
  'sent',
]);

/**
 * el contexto de la subclave: la conversacion, pero en compartimento propio.
 *
 * Sin el sufijo, este archivo se sella con la MISMA llave y el MISMO proposito
 * que un turno de esa conversacion (`private-store.ts`), y los AAD del sobre
 * solo atan version y proposito: los dos sobres pasan a ser intercambiables
 * para el criptosistema. Un registro de turno copiado con este nombre descifra
 * sin error y solo lo para despues el esquema del payload.
 *
 * Y hay una segunda razon, que llegara antes o despues: la subclave de
 * conversacion es la que `shareGrantSchema.wrappedKey` esta pensada para
 * envolver para un invitado. Compartir una conversacion no puede significar
 * entregar tambien esto, que guarda cosas que el hilo no enseña —el `rc` del
 * servidor, el mensaje de error, el texto reescrito a mano—.
 *
 * El sufijo es la misma tecnica que ya usan `catalog-store` y `character-store`
 * dentro de `identity` ('catalog', 'characters', `avatar:...`), por eso el
 * proposito del sobre no cambia: el compartimento lo hace la llave.
 *
 * El id es un uuid comprobado, asi que no puede llevar ':' y no hay forma de
 * que un identificador se disfrace del contexto de otro.
 *
 * Un archivo escrito antes de este compartimento ya no se abre: `list` devuelve
 * [] y la siguiente escritura lo pisa, que es lo que hace con cualquier archivo
 * ilegible. Lo que se pierde es diagnostico de una funcion que todavia no ha
 * salido de este worktree, no una decision de nadie.
 */
export function attemptKeyContext(conversationId: string): string {
  return `${conversationId}:image-attempts`;
}

export function imageAttemptsDirectory(configDirectory: string): string {
  return join(configDirectory, 'vault', 'image-attempts');
}

const sealedFileSchema = z.object({
  version: z.literal(1),
  content: z.object({
    version: z.number().int(),
    purpose: z.string(),
    nonce: z.string(),
    ciphertext: z.string(),
  }),
});

/**
 * el sobre abierto.
 *
 * La lista entra SIN validar a proposito: un intento escrito por una version
 * posterior no puede tirar a los demas al leerlos. Cada elemento se mira
 * despues por separado.
 */
const payloadSchema = z.object({
  v: z.literal(1),
  attempts: z.array(z.unknown()).default([]),
});

/** lo que se puede cambiar de un intento ya escrito */
export type ImageAttemptPatch = Partial<
  Omit<ImageAttempt, 'attemptId' | 'conversationId' | 'createdAt'>
>;

export class ImageAttemptStore {
  /**
   * un carril por conversacion: cada escritura espera a la anterior.
   *
   * Sin esto, el turno apuntando un `pending` y la decision del panel marcando
   * `sent` a la vez leerian el mismo archivo y el ultimo en escribir borraria lo
   * del otro. Un fallo no envenena el carril: el siguiente entra igual.
   */
  private readonly lanes = new Map<string, Promise<void>>();

  constructor(private readonly directory: string) {}

  fileFor(conversationId: string): string {
    if (!CONVERSATION_ID.test(conversationId)) {
      throw new VaultError('identificador de conversacion no valido');
    }
    return join(this.directory, `${conversationId}.json`);
  }

  /**
   * lee los intentos de una conversacion.
   *
   * Nunca lanza por un archivo que no se entiende: devuelve []. Es el mismo
   * criterio que el catalogo y por el mismo motivo —un registro ilegible no
   * puede parar un turno—, con la diferencia de que aqui lo peor que se pierde
   * es el diagnostico de generaciones pasadas, no una decision de nadie.
   */
  async list(vault: VaultService, conversationId: string): Promise<ImageAttempt[]> {
    const file = this.fileFor(conversationId);
    if (!existsSync(file)) return [];

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return [];
    }
    const parsed = sealedFileSchema.safeParse(raw);
    if (!parsed.success) return [];

    // la subclave es la de ESTA conversacion y la de ESTE registro: ni el
    // archivo de otra conversacion ni un sobre de turno se abren con ella,
    // aunque alguien los copie con este nombre
    const key = vault.subkeyFor('conversation', attemptKeyContext(conversationId));
    let text: string;
    try {
      text = await openText(key, 'vault.conversation', parsed.data.content as SealedEnvelope);
    } catch {
      return [];
    } finally {
      wipe(key);
    }

    let opened: unknown;
    try {
      opened = JSON.parse(text);
    } catch {
      return [];
    }
    const payload = payloadSchema.safeParse(opened);
    if (!payload.success) return [];

    const attempts: ImageAttempt[] = [];
    for (const candidate of payload.data.attempts) {
      const attempt = imageAttemptSchema.safeParse(candidate);
      if (attempt.success) attempts.push(attempt.data);
    }
    return attempts;
  }

  /**
   * el ultimo intento que sigue esperando una decision.
   *
   * El ultimo y no el primero: si por lo que sea quedaron dos sin decidir, el
   * que vale es el que pidio ella la ultima vez.
   */
  async pending(
    vault: VaultService,
    conversationId: string,
  ): Promise<ImageAttempt | undefined> {
    const attempts = await this.list(vault, conversationId);
    let found: ImageAttempt | undefined;
    for (const attempt of attempts) {
      if (attempt.state === 'pending') found = attempt;
    }
    return found;
  }

  /** añade un intento al final y devuelve lo que quedo escrito */
  async append(
    vault: VaultService,
    conversationId: string,
    entry: ImageAttempt,
  ): Promise<ImageAttempt> {
    const checked = imageAttemptSchema.safeParse(entry);
    if (!checked.success) {
      // el mensaje lleva la forma, nunca lo que decia el intento
      throw new VaultError('se ha intentado apuntar un intento de imagen que no es valido');
    }
    const attempt = checked.data;

    await this.apply(vault, conversationId, (current) => [...current, attempt]);
    return attempt;
  }

  /**
   * cambia un intento ya escrito.
   *
   * Devuelve el intento actualizado, o `undefined` si ese `attemptId` ya no
   * esta: un pendiente podado o de una conversacion borrada no es un error.
   */
  async update(
    vault: VaultService,
    conversationId: string,
    attemptId: string,
    patch: ImageAttemptPatch,
  ): Promise<ImageAttempt | undefined> {
    let updated: ImageAttempt | undefined;
    await this.apply(vault, conversationId, (current) =>
      current.map((attempt) => {
        if (attempt.attemptId !== attemptId) return attempt;
        // ni `attemptId` ni `conversationId` ni `createdAt` se tocan: el patch
        // no los trae y el orden deja claro que un patch con basura no los pisa
        const next = { ...attempt, ...patch, attemptId, conversationId, createdAt: attempt.createdAt };
        const checked = imageAttemptSchema.safeParse(next);
        if (!checked.success) {
          throw new VaultError('se ha intentado cambiar un intento de imagen a un estado no valido');
        }
        updated = checked.data;
        return checked.data;
      }),
    );
    return updated;
  }

  /**
   * al borrar una conversacion, su registro de intentos se va con ella.
   *
   * Es la razon de que haya un archivo por conversacion: sin esto, el texto mas
   * intimo del sistema sobreviviria cifrado y huerfano a un borrado.
   *
   * No hace falta abrir la boveda para borrar un archivo, pero la boveda va en
   * la firma igual que en los otros tres almacenes: el handler de borrado los
   * llama a los cuatro seguidos y una firma distinta invita a olvidarse de este.
   */
  async removeConversation(_vault: VaultService, conversationId: string): Promise<void> {
    const file = this.fileFor(conversationId);
    await this.lane(conversationId, () => {
      if (existsSync(file)) unlinkSync(file);
      // el temporal de una escritura interrumpida lleva lo mismo dentro
      const temporary = `${file}.tmp`;
      if (existsSync(temporary)) unlinkSync(temporary);
      return Promise.resolve();
    });
  }

  /**
   * anillo por conversacion, con DOS CUPOS que se cuentan por separado.
   *
   * Podar solo por antiguedad tiraba antes lo que menos se podia tirar: los
   * intentos que salieron bien tienen su imagen guardada aparte, y los que
   * fallaron no tienen copia en ningun sitio. Cincuenta apuntes se gastan en una
   * tarde de pruebas, casi todos correctos, y el fallo que se iba a mirar salia
   * de la ventana empujado por ellos. Con cupos separados, una racha de imagenes
   * buenas ya no borra el bloqueo de hace dos dias.
   *
   * Los `pending` NO se podan aunque caigan fuera de su ventana: son la peticion
   * que todavia espera una decision, y perderla dejaria una tarjeta en la
   * pantalla apuntando a un intento que ya no existe.
   */
  async prune(
    vault: VaultService,
    conversationId: string,
    max: number = IMAGE_ATTEMPT_RING,
    diagnosticMax: number = IMAGE_ATTEMPT_DIAGNOSTIC_RING,
  ): Promise<void> {
    await this.apply(vault, conversationId, (current) => {
      // se guardan REFERENCIAS: cada elemento que sale de `list` es un objeto
      // propio, asi que dos intentos iguales campo a campo no se confunden
      const kept = new Set<ImageAttempt>();
      const keepLast = (pool: readonly ImageAttempt[], limit: number): void => {
        for (const attempt of pool.slice(Math.max(0, pool.length - limit))) kept.add(attempt);
      };
      keepLast(
        current.filter((attempt) => DIAGNOSTIC_STATES.has(attempt.state)),
        diagnosticMax,
      );
      keepLast(
        current.filter((attempt) => !DIAGNOSTIC_STATES.has(attempt.state)),
        max,
      );
      // el orden original se conserva: la poda decide QUE se queda, nunca en que
      // orden, y la pantalla lee el ultimo pendiente de esta lista
      return current.filter((attempt) => kept.has(attempt) || attempt.state === 'pending');
    });
  }

  private async apply(
    vault: VaultService,
    conversationId: string,
    mutator: (current: readonly ImageAttempt[]) => ImageAttempt[],
  ): Promise<void> {
    await this.lane(conversationId, async () => {
      const current = await this.list(vault, conversationId);
      await this.persist(vault, conversationId, mutator(current));
    });
  }

  private async lane(conversationId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.lanes.get(conversationId) ?? Promise.resolve();
    const run = previous.then(work);
    this.lanes.set(
      conversationId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async persist(
    vault: VaultService,
    conversationId: string,
    attempts: readonly ImageAttempt[],
  ): Promise<void> {
    const file = this.fileFor(conversationId);
    const key = vault.subkeyFor('conversation', attemptKeyContext(conversationId));
    try {
      const sealed = await sealText(
        key,
        'vault.conversation',
        JSON.stringify({ v: 1, attempts: [...attempts] } satisfies z.input<typeof payloadSchema>),
      );
      mkdirSync(this.directory, { recursive: true });

      // el temporal va sellado igual que el definitivo: un `.tmp` en claro
      // dejaria el prompt legible en disco en cada escritura
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, content: sealed }), 'utf8');
      renameSync(temporary, file);
    } finally {
      wipe(key);
    }
  }
}
