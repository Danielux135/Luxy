// asuntos pendientes entre los dos, cifrados en disco.
//
// Guarda tres cosas: las notas —un puntero a un turno real con su cita—, el
// cursor de cada conversacion (hasta donde se reviso) y los contadores de lo
// que el extractor propuso y de lo que se rechazo.
//
// Se cifra por el mismo motivo que el catalogo, y con mas razon: una cita es
// literalmente lo que se dijo. Usa el dominio `identity`, que ya existe, con el
// contexto `relation` para no compartir llave con el catalogo ni con los
// personajes.
//
// Un archivo unico y escritura atomica, como `catalog-store.ts`. La diferencia
// esta en la LECTURA, y es deliberada: el catalogo que no se entiende se
// devuelve vacio porque rehacerlo solo cuesta una llamada, mientras que aqui
// dentro estan las decisiones de Daniel —lo que dio por cumplido y lo que
// descarto— y eso no se rehace con nada. Por eso una nota rota se tira de la
// lista que se usa y se cuenta, pero VUELVE al archivo tal cual al guardar, y un
// sobre que no se abre detiene el trabajo y no se sobrescribe nunca.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { openText, sealText, wipe, type SealedEnvelope } from '@luxy/vault-crypto';
import {
  relationCountersSchema,
  relationCursorSchema,
  relationNoteSchema,
  type RelationCounters,
  type RelationCursor,
  type RelationNote,
} from '@luxy/shared';
import { VaultError, type VaultService } from './vault-service.js';

export function relationFilePath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'relation.json');
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
 * Las listas entran SIN validar a proposito: validarlas aqui haria que una sola
 * nota rota tirara las demas, que es justo lo que no puede pasar. Cada elemento
 * se mira despues por separado.
 */
const payloadSchema = z.object({
  v: z.literal(1),
  notes: z.array(z.unknown()).default([]),
  cursors: z.array(z.unknown()).default([]),
  counters: z.unknown().optional(),
});

/**
 * lo que se escribe; el tipo existe para que persist no pueda olvidar un campo.
 *
 * Las dos listas van sin tipar porque al final de cada una viajan tambien los
 * elementos que no se pudieron leer, tal y como estaban. Lo que garantiza que
 * las demas son notas y cursores de verdad es `checkedForWrite`, que valida
 * antes de sellar.
 */
interface StoredPayload {
  v: 1;
  notes: readonly unknown[];
  cursors: readonly unknown[];
  counters: RelationCounters;
}

/** lo guardado, tal y como se escribe */
export interface RelationState {
  notes: RelationNote[];
  cursors: RelationCursor[];
  counters: RelationCounters;
}

/**
 * lo que no valido al leer, guardado tal cual estaba en el archivo.
 *
 * Existe para no borrar lo que no se entiende. Una version posterior puede
 * escribir una nota con un `kind` o un `status` que esta todavia no conoce; si
 * al guardar se escribiera solo lo validado, volver a una version anterior
 * —abrir Luxy sin actualizar— destruiria esas notas en la primera escritura, y
 * bastaria con borrar cualquier conversacion para provocarlo. No llega al
 * prompt ni al diagnostico: solo vuelve al disco.
 */
export interface RelationUnreadable {
  notes: readonly unknown[];
  cursors: readonly unknown[];
}

export interface RelationSnapshot extends RelationState {
  /**
   * cuantas notas y cursores no pasaron la validacion.
   *
   * Va en el diagnostico. Una cifra, no una lista: lo que se tiro no se puede
   * enseñar sin enseñar tambien lo que decia.
   */
  droppedOnRead: number;
  unreadable: RelationUnreadable;
}

/**
 * lo que devuelve un mutador.
 *
 * `unreadable` se omite casi siempre: omitirlo CONSERVA lo que habia, que es el
 * lado seguro. Solo quien sabe que algo ya no debe estar —borrar una
 * conversacion— lo recorta.
 */
export interface RelationNextState extends RelationState {
  unreadable?: RelationUnreadable;
}

/**
 * cambia el estado guardado.
 *
 * Recibe lo que hay AHORA —ya releido dentro del carril— y devuelve lo que debe
 * quedar. Lo que el que llama necesite saber de la decision que tomo dentro
 * (cuantas se añadieron, cuales se cerraron) se saca por cierre: aqui solo
 * viaja el estado.
 */
export type RelationMutator = (
  current: RelationSnapshot,
) => RelationNextState | Promise<RelationNextState>;

function emptyState(): RelationState {
  return { notes: [], cursors: [], counters: relationCountersSchema.parse({}) };
}

function nothingUnreadable(): RelationUnreadable {
  return { notes: [], cursors: [] };
}

/**
 * valida lo que se va a escribir ANTES de sellarlo.
 *
 * La lectura tira lo que no entiende, asi que una nota mal formada que llegara
 * hasta aqui se destruiria sola en la siguiente lectura y en silencio: quien la
 * escribio creeria que se guardo. Parar convierte un fallo del lado que escribe
 * en un error visible, que es lo que hace `checkpoint.ts` con sus lotes. El
 * mensaje lleva cifras y nunca lo que decia la nota.
 */
function checkedForWrite(state: RelationState): RelationState {
  const notes = z.array(relationNoteSchema).safeParse(state.notes);
  const cursors = z.array(relationCursorSchema).safeParse(state.cursors);
  const counters = relationCountersSchema.safeParse(state.counters);
  if (!notes.success || !cursors.success || !counters.success) {
    throw new VaultError(
      'se ha intentado guardar un indice de pendientes que no es valido',
      'no se ha escrito nada y lo guardado sigue intacto; es un fallo de Luxy, avisa',
    );
  }
  return { notes: notes.data, cursors: cursors.data, counters: counters.data };
}

/**
 * true si un elemento que no se pudo leer dice ser de esta conversacion.
 *
 * Es a ojo, y tiene que serlo: lo que no valido puede tener cualquier forma.
 * Ante la duda se CONSERVA —tirarlo seria perder lo que escribio una version
 * mas nueva—, pero lo que si se reconoce se va, porque borrar una conversacion
 * tiene que llevarse tambien las citas que nacieron dentro de ella.
 */
function rawBelongsTo(raw: unknown, conversationId: string): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const record = raw as { conversationId?: unknown; origin?: unknown };
  if (record.conversationId === conversationId) return true;

  const origin = record.origin;
  if (typeof origin !== 'object' || origin === null) return false;
  return (origin as { conversationId?: unknown }).conversationId === conversationId;
}

export class RelationStore {
  /**
   * el carril: cada `apply` espera al anterior.
   *
   * Sin esto, el extractor terminando una ventana y Daniel pulsando «Cumplida»
   * a la vez leerian los dos el mismo archivo y el ultimo en escribir borraria
   * lo del otro. Un fallo no envenena el carril: el siguiente entra igual.
   */
  private lane: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  /**
   * lee lo guardado, tirando solo lo que este roto.
   *
   * Lanza `VaultError` si el archivo existe y no se puede abrir. Es el caso en
   * el que hay que parar: seguir como si estuviera vacio y escribir encima
   * borraria las decisiones de Daniel sin que nadie se entere.
   */
  async read(vault: VaultService): Promise<RelationSnapshot> {
    if (!existsSync(this.file)) {
      return { ...emptyState(), droppedOnRead: 0, unreadable: nothingUnreadable() };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      throw new VaultError(
        'el indice de pendientes no se puede leer',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    }

    const parsed = sealedFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VaultError(
        'el indice de pendientes no tiene el formato esperado',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    }

    const key = vault.subkeyFor('identity', 'relation');
    let text: string;
    try {
      text = await openText(key, 'vault.identity', parsed.data.content as SealedEnvelope);
    } catch {
      throw new VaultError(
        'el indice de pendientes no se puede descifrar',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    } finally {
      wipe(key);
    }

    let payload: z.infer<typeof payloadSchema>;
    try {
      payload = payloadSchema.parse(JSON.parse(text));
    } catch {
      // el sobre se abrio, asi que es nuestro; que no se entienda significa que
      // lo escribio una version distinta, y pisarlo perderia lo suyo
      throw new VaultError(
        'el indice de pendientes es de otra version',
        'no se ha tocado el archivo; actualiza Luxy antes de seguir',
      );
    }

    const notes: RelationNote[] = [];
    const unreadableNotes: unknown[] = [];
    for (const candidate of payload.notes) {
      const note = relationNoteSchema.safeParse(candidate);
      if (note.success) notes.push(note.data);
      else unreadableNotes.push(candidate);
    }

    const cursors: RelationCursor[] = [];
    const unreadableCursors: unknown[] = [];
    for (const candidate of payload.cursors) {
      const cursor = relationCursorSchema.safeParse(candidate);
      if (cursor.success) cursors.push(cursor.data);
      else unreadableCursors.push(candidate);
    }

    // los contadores no son una decision de nadie: si vienen rotos se vuelve a
    // cero y se sigue, en vez de contarlos como algo perdido
    const counters = relationCountersSchema.safeParse(payload.counters ?? {});

    return {
      notes,
      cursors,
      counters: counters.success ? counters.data : relationCountersSchema.parse({}),
      droppedOnRead: unreadableNotes.length + unreadableCursors.length,
      unreadable: { notes: unreadableNotes, cursors: unreadableCursors },
    };
  }

  /** cambia lo guardado sin que dos cambios a la vez se pisen */
  async apply(vault: VaultService, mutator: RelationMutator): Promise<RelationState> {
    const run = this.lane.then(() => this.mutate(vault, mutator));
    // el carril sigue vivo pase lo que pase, y ademas asi la rama que espera al
    // anterior nunca queda sin manejar
    this.lane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * al borrar una conversacion, sus pendientes dejan de tener a que apuntar.
   *
   * Los que NACIERON ahi se van con ella: sin turno no hay cita que verificar.
   * Los que solo se CERRARON ahi se quedan cerrados con `ref: null`. Reabrirlos
   * haria que ella reclamase algo que ya se cumplio, y ante la duda el lado
   * seguro es que calle.
   */
  async removeConversation(vault: VaultService, conversationId: string): Promise<void> {
    await this.apply(vault, (current) => ({
      counters: current.counters,
      cursors: current.cursors.filter((cursor) => cursor.conversationId !== conversationId),
      notes: current.notes
        .filter((note) => note.origin.conversationId !== conversationId)
        .map((note) => {
          const closure = note.closure;
          if (closure === null || closure.ref === null) return note;
          if (closure.ref.conversationId !== conversationId) return note;
          return { ...note, closure: { ...closure, ref: null } };
        }),
      // el unico sitio donde lo que no se entiende SI se tira: conservarlo
      // dejaria en disco la cita de una conversacion que Daniel acaba de borrar
      unreadable: {
        notes: current.unreadable.notes.filter((raw) => !rawBelongsTo(raw, conversationId)),
        cursors: current.unreadable.cursors.filter((raw) => !rawBelongsTo(raw, conversationId)),
      },
    }));
  }

  private async mutate(vault: VaultService, mutator: RelationMutator): Promise<RelationState> {
    const current = await this.read(vault);
    const next = await mutator(current);
    await this.persist(vault, next, next.unreadable ?? current.unreadable);
    return next;
  }

  private async persist(
    vault: VaultService,
    state: RelationState,
    unreadable: RelationUnreadable,
  ): Promise<void> {
    const checked = checkedForWrite(state);
    const key = vault.subkeyFor('identity', 'relation');
    try {
      const sealed = await sealText(
        key,
        'vault.identity',
        JSON.stringify({
          v: 1,
          // lo que no se pudo leer vuelve al final, tal cual: no se sabe donde
          // estaba y el orden de la lista no significa nada
          notes: [...checked.notes, ...unreadable.notes],
          cursors: [...checked.cursors, ...unreadable.cursors],
          counters: checked.counters,
        } satisfies StoredPayload),
      );
      mkdirSync(join(this.file, '..'), { recursive: true });

      // el temporal va sellado igual que el definitivo: un `.tmp` en claro
      // dejaria las citas legibles en disco cada vez que se guarda
      const temporary = `${this.file}.tmp`;
      // y se fuerza a disco ANTES de renombrar, como en `checkpoint.ts`: el
      // rename solo mueve metadatos, asi que un corte de luz entre las dos
      // cosas puede dejar el nombre apuntando a bloques que aun no se
      // escribieron. Entonces no quedaria ni lo nuevo ni lo viejo, y aqui lo
      // viejo son las decisiones de Daniel.
      //
      // No se guarda copia anterior a proposito: dejar el vivo a un lado abre
      // un rato en el que `relation.json` no existe, y un archivo que falta se
      // lee como vacio, que es justo la perdida silenciosa de la que este
      // almacen se defiende.
      const descriptor = openSync(temporary, 'w');
      try {
        writeFileSync(descriptor, JSON.stringify({ version: 1, content: sealed }), 'utf8');
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporary, this.file);
    } finally {
      wipe(key);
    }
  }
}
