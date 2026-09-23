// la memoria acumulativa generada hacia atras, cifrada en disco.
//
// Una entrada por conversacion: la ficha, hasta donde cubre, con que CLI se
// escribio, si Daniel la aprobo y como termino el ultimo intento. Vive FUERA de
// los `.jsonl` sellados a proposito: cambiarla obligaria a reescribir el archivo
// entero de la conversacion —cada guardado pondria en juego los mensajes, no la
// ficha—, y una memoria mal escrita dentro de un registro apaga la lista entera
// de Privado.
//
// Esa frase decia ademas «por el unico camino que no hace `fsync`». Ya no: el
// borrado de la memoria propia necesitaba reescribir el `.jsonl`, y al hacerlo
// se llevo el `fsync` a `conversation-store.ts`. El resto del argumento sigue
// en pie, que es lo que mantiene esta ficha aqui fuera.
//
// Se cifra con el dominio `identity` y el contexto `recap`, hermano del
// catalogo y de los pendientes. Deliberadamente NO se usa `subkeyFor('memory',
// …)`: ese es el dominio de la memoria sellada dentro de un registro, y
// compartirlo haria que un sobre de aqui abriera con la misma familia de llaves
// que un `sealedMemory`, invitando a mover uno al sitio del otro. Aqui lo que se
// quiere es que eso sea imposible por construccion.
//
// La LECTURA es la de `relation-store.ts` y no la del catalogo, y la diferencia
// importa: un catalogo ilegible se devuelve vacio porque rehacerlo cuesta una
// llamada, mientras que aqui dentro estan las aprobaciones de Daniel —lo unico
// que decide si una ficha entra en un prompt— y volver a llenarlo son veinte
// llamadas y una revision entera a mano. Por eso una entrada rota se saca de la
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
  recapCountersSchema,
  recapEntrySchema,
  type RecapCounters,
  type RecapEntry,
} from '@luxy/shared';
import { VaultError, type VaultService } from './vault-service.js';

export function recapFilePath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'recap.json');
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
 * La lista entra SIN validar a proposito: validarla aqui haria que una sola
 * entrada rota tirara las demas, que es justo lo que no puede pasar cuando cada
 * una cuesta una llamada a un CLI y una aprobacion. Cada elemento se mira
 * despues por separado.
 */
const payloadSchema = z.object({
  v: z.literal(1),
  entries: z.array(z.unknown()).default([]),
  counters: z.unknown().optional(),
});

/**
 * lo que se escribe; el tipo existe para que persist no pueda olvidar un campo.
 *
 * La lista va sin tipar porque al final viajan tambien las entradas que no se
 * pudieron leer, tal y como estaban. Lo que garantiza que las demas son fichas
 * de verdad es `checkedForWrite`, que valida antes de sellar.
 */
interface StoredPayload {
  v: 1;
  entries: readonly unknown[];
  counters: RecapCounters;
}

/** lo guardado, tal y como se escribe */
export interface RecapState {
  entries: RecapEntry[];
  counters: RecapCounters;
}

/**
 * lo que no valido al leer, guardado tal cual estaba en el archivo.
 *
 * Existe para no borrar lo que no se entiende. Una version posterior puede
 * escribir una entrada con un `refusedKind` o un `source` que esta todavia no
 * conoce; si al guardar se escribiera solo lo validado, volver a una version
 * anterior —abrir Luxy sin actualizar— destruiria esas fichas en la primera
 * escritura, y bastaria con borrar cualquier conversacion para provocarlo. No
 * llega al prompt ni al panel: solo vuelve al disco.
 */
export interface RecapUnreadable {
  entries: readonly unknown[];
}

export interface RecapSnapshot extends RecapState {
  /**
   * cuantas entradas no pasaron la validacion.
   *
   * Va al diagnostico. Una cifra, no una lista: lo que se tiro no se puede
   * enseñar sin enseñar tambien lo que resumia.
   */
  droppedOnRead: number;
  unreadable: RecapUnreadable;
}

/**
 * lo que devuelve un mutador.
 *
 * `unreadable` se omite casi siempre: omitirlo CONSERVA lo que habia, que es el
 * lado seguro. Solo quien sabe que algo ya no debe estar —borrar una
 * conversacion— lo recorta.
 */
export interface RecapNextState extends RecapState {
  unreadable?: RecapUnreadable;
}

/**
 * cambia el estado guardado.
 *
 * Recibe lo que hay AHORA —ya releido dentro del carril— y devuelve lo que debe
 * quedar. Lo que el que llama necesite saber de la decision que tomo dentro
 * (cuantas ventanas salieron, cual se nego) se saca por cierre: aqui solo viaja
 * el estado.
 */
export type RecapMutator = (current: RecapSnapshot) => RecapNextState | Promise<RecapNextState>;

function emptyState(): RecapState {
  return { entries: [], counters: recapCountersSchema.parse({}) };
}

function nothingUnreadable(): RecapUnreadable {
  return { entries: [] };
}

/**
 * valida lo que se va a escribir ANTES de sellarlo.
 *
 * La lectura tira lo que no entiende, asi que una ficha mal formada que llegara
 * hasta aqui se destruiria sola en la siguiente lectura y en silencio: quien la
 * escribio creeria que se guardo, y la conversacion se quedaria sin memoria sin
 * que nadie lo dijera. Parar convierte un fallo del lado que escribe en un error
 * visible. El mensaje lleva cifras y nunca lo que decia la ficha.
 */
function checkedForWrite(state: RecapState): RecapState {
  const entries = z.array(recapEntrySchema).safeParse(state.entries);
  const counters = recapCountersSchema.safeParse(state.counters);
  if (!entries.success || !counters.success) {
    throw new VaultError(
      'se ha intentado guardar una memoria de lo ya hablado que no es valida',
      'no se ha escrito nada y lo guardado sigue intacto; es un fallo de Luxy, avisa',
    );
  }
  return { entries: entries.data, counters: counters.data };
}

/**
 * true si una entrada que no se pudo leer dice ser de esta conversacion.
 *
 * Es a ojo, y tiene que serlo: lo que no valido puede tener cualquier forma.
 * Ante la duda se CONSERVA —tirarlo seria perder lo que escribio una version mas
 * nueva—, pero lo que si se reconoce se va, porque borrar una conversacion tiene
 * que llevarse tambien el resumen de lo que pasaba dentro de ella.
 */
function rawBelongsTo(raw: unknown, conversationId: string): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  return (raw as { conversationId?: unknown }).conversationId === conversationId;
}

export class RecapStore {
  /**
   * el carril: cada `apply` espera al anterior.
   *
   * Sin esto, la pasada cerrando una ventana y Daniel pulsando «Aprobar» a la
   * vez leerian los dos el mismo archivo y el ultimo en escribir borraria lo del
   * otro. Un fallo no envenena el carril: el siguiente entra igual.
   */
  private lane: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  /**
   * lee lo guardado, tirando solo lo que este roto.
   *
   * Lanza `VaultError` si el archivo existe y no se puede abrir. Es el caso en
   * el que hay que parar: seguir como si estuviera vacio y escribir encima
   * borraria las aprobaciones de Daniel sin que nadie se entere, y ademas
   * volveria a mandar las diecisiete conversaciones al CLI.
   */
  async read(vault: VaultService): Promise<RecapSnapshot> {
    if (!existsSync(this.file)) {
      return { ...emptyState(), droppedOnRead: 0, unreadable: nothingUnreadable() };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      throw new VaultError(
        'la memoria de lo ya hablado no se puede leer',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    }

    const parsed = sealedFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VaultError(
        'la memoria de lo ya hablado no tiene el formato esperado',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    }

    const key = vault.subkeyFor('identity', 'recap');
    let text: string;
    try {
      text = await openText(key, 'vault.identity', parsed.data.content as SealedEnvelope);
    } catch {
      throw new VaultError(
        'la memoria de lo ya hablado no se puede descifrar',
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
        'la memoria de lo ya hablado es de otra version',
        'no se ha tocado el archivo; actualiza Luxy antes de seguir',
      );
    }

    const entries: RecapEntry[] = [];
    const unreadableEntries: unknown[] = [];
    for (const candidate of payload.entries) {
      const entry = recapEntrySchema.safeParse(candidate);
      if (entry.success) entries.push(entry.data);
      else unreadableEntries.push(candidate);
    }

    // los contadores no son una decision de nadie: si vienen rotos se vuelve a
    // cero y se sigue, en vez de contarlos como algo perdido
    const counters = recapCountersSchema.safeParse(payload.counters ?? {});

    return {
      entries,
      counters: counters.success ? counters.data : recapCountersSchema.parse({}),
      droppedOnRead: unreadableEntries.length,
      unreadable: { entries: unreadableEntries },
    };
  }

  /**
   * la ficha de una conversacion, o `undefined` si no hay.
   *
   * Devuelve la ULTIMA que coincide, no la primera, para no discrepar del turno
   * vivo: `recapCoverage` mete las entradas en un `Map`, donde gana la ultima. Un
   * archivo no deberia tener dos de la misma conversacion, pero si alguna vez
   * las tiene, el panel y el prompt tienen que estar enseñando la misma.
   */
  async entryFor(vault: VaultService, conversationId: string): Promise<RecapEntry | undefined> {
    const { entries } = await this.read(vault);
    let found: RecapEntry | undefined;
    for (const entry of entries) {
      if (entry.conversationId === conversationId) found = entry;
    }
    return found;
  }

  /** cambia lo guardado sin que dos cambios a la vez se pisen */
  async apply(vault: VaultService, mutator: RecapMutator): Promise<RecapState> {
    return this.queue(() => this.mutate(vault, mutator));
  }

  /**
   * el carril, suelto de lo que se hace dentro.
   *
   * Se separa de `apply` porque hay una operacion que necesita el carril y NO
   * necesita escribir: `clearSuperseded`. Serializarla igual importa —lee para
   * decidir si hay algo que quitar, y la pasada puede estar escribiendo a la
   * vez—, pero obligarla a pasar por `mutate` la obligaba a reescribir el
   * archivo entero siempre.
   */
  private queue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lane.then(task);
    // el carril sigue vivo pase lo que pase, y ademas asi la rama que espera al
    // anterior nunca queda sin manejar
    this.lane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * al borrar una conversacion, su ficha deja de tener a que referirse.
   *
   * Y se va entera, sin matices: un recap es un resumen de lo que se dijo ahi
   * dentro, asi que dejarlo seria conservar en disco justo lo que Daniel acaba
   * de mandar borrar. La conversacion no existe, luego no hay nada que retomar.
   */
  async removeConversation(vault: VaultService, conversationId: string): Promise<void> {
    await this.apply(vault, (current) => ({
      counters: current.counters,
      entries: current.entries.filter((entry) => entry.conversationId !== conversationId),
      // el unico sitio donde lo que no se entiende SI se tira, por lo mismo
      unreadable: {
        entries: current.unreadable.entries.filter((raw) => !rawBelongsTo(raw, conversationId)),
      },
    }));
  }

  /**
   * la conversacion ya tiene memoria sellada viva: el relleno sobra.
   *
   * No se borra la ficha: la sellada gana siempre en `chooseConversationMemory`,
   * asi que dejarla no cambia ni un byte del prompt, y conservarla evita que la
   * pasada la vuelva a generar si esa memoria sellada desapareciera.
   *
   * La fecha es la de la PRIMERA vez. Volver a estamparla en cada pasada la
   * convertiria en «cuando se miro por ultima vez», que no es lo que dice el
   * nombre ni sirve para nada.
   */
  async markSuperseded(vault: VaultService, conversationId: string, at: string): Promise<void> {
    await this.apply(vault, (current) => ({
      counters: current.counters,
      entries: current.entries.map((entry) => {
        if (entry.conversationId !== conversationId) return entry;
        if (entry.supersededAt !== null) return entry;
        return { ...entry, supersededAt: at };
      }),
    }));
  }

  /**
   * la marca de arriba deja de ser cierta: esa memoria sellada ya no esta.
   *
   * Es el reverso exacto de `markSuperseded` y existe porque la marca es el
   * apunte de un HECHO —«esta conversacion tiene memoria propia»—, no una
   * decision de nadie. Cuando Daniel borra esa memoria, el hecho se acaba, y una
   * marca que le sobrevive miente dos veces: el panel sigue diciendo «ya tiene
   * memoria propia» de una conversacion que ya no la tiene, y la pasada de
   * relleno la salta para siempre, con lo cual el borrado dejaria esa
   * conversacion sin memoria y sin forma de volver a tenerla.
   *
   * No toca nada mas de la ficha: el texto retroactivo tiene su propio boton.
   *
   * SIN MARCA NO ESCRIBE, y devuelve si llego a quitar algo. El borrado de la
   * memoria sellada llama a esto primero —ver el orden razonado en su handler—,
   * asi que escribir siempre ataba ese borrado a poder reescribir `recap.json`
   * incluso cuando esa conversacion no tiene ficha ninguna: es justo el caso de
   * una conversacion de prueba, excluida del trabajo de fondo y por tanto sin
   * entrada, donde ademas se CREABA un `recap.json` vacio que no existia. El
   * orden no cambia; lo que se quita es el paso cuando no hay nada que hacer.
   *
   * Lo que sigue siendo obligatorio es la LECTURA: sin abrir el archivo no se
   * puede saber si hay marca, y darla por ausente dejaria en pie la unica
   * combinacion irrecuperable —memoria borrada con la marca viva—.
   */
  async clearSuperseded(vault: VaultService, conversationId: string): Promise<boolean> {
    return this.queue(async () => {
      const current = await this.read(vault);
      const marcada = current.entries.some(
        (entry) => entry.conversationId === conversationId && entry.supersededAt !== null,
      );
      if (!marcada) return false;

      await this.persist(
        vault,
        {
          counters: current.counters,
          entries: current.entries.map((entry) => {
            if (entry.conversationId !== conversationId) return entry;
            return { ...entry, supersededAt: null };
          }),
        },
        current.unreadable,
      );
      return true;
    });
  }

  private async mutate(vault: VaultService, mutator: RecapMutator): Promise<RecapState> {
    const current = await this.read(vault);
    const next = await mutator(current);
    await this.persist(vault, next, next.unreadable ?? current.unreadable);
    return next;
  }

  private async persist(
    vault: VaultService,
    state: RecapState,
    unreadable: RecapUnreadable,
  ): Promise<void> {
    const checked = checkedForWrite(state);
    const key = vault.subkeyFor('identity', 'recap');
    try {
      const sealed = await sealText(
        key,
        'vault.identity',
        JSON.stringify({
          v: 1,
          // lo que no se pudo leer vuelve al final, tal cual: no se sabe donde
          // estaba y el orden de la lista no significa nada
          entries: [...checked.entries, ...unreadable.entries],
          counters: checked.counters,
        } satisfies StoredPayload),
      );
      mkdirSync(join(this.file, '..'), { recursive: true });

      // el temporal va sellado igual que el definitivo: un `.tmp` en claro
      // dejaria en disco el resumen de lo que pasa en cada conversacion cada vez
      // que se guarda
      const temporary = `${this.file}.tmp`;
      // y se fuerza a disco ANTES de renombrar, como `relation-store.ts` y
      // `checkpoint.ts`: el rename solo mueve metadatos, asi que un corte de luz
      // entre las dos cosas puede dejar el nombre apuntando a bloques que aun no
      // se escribieron. Entonces no quedaria ni lo nuevo ni lo viejo. El
      // catalogo se salta este paso porque rehacerlo cuesta una llamada; aqui
      // cuesta veinte y una revision a mano.
      //
      // No se guarda copia anterior a proposito: dejar el vivo a un lado abre un
      // rato en el que `recap.json` no existe, y un archivo que falta se lee como
      // vacio, que es justo la perdida silenciosa de la que este almacen se
      // defiende.
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
