// conversaciones privadas en disco, cifradas.
//
// Es almacenamiento local, no sincronizacion: los registros que escribe son
// exactamente los que `F9.15` subira al gateway cuando exista, asi que lo que
// hay aqui no se tira despues, se reutiliza.
//
// Un archivo por conversacion, en formato JSON por lineas. Se elige asi porque
// añadir un turno es escribir una linea al final: no hay que releer ni
// reescribir una conversacion de mil mensajes para añadir uno.
//
// El NOMBRE del archivo es el identificador de la conversacion, que es un uuid
// aleatorio. Nunca el titulo: `%APPDATA%` no puede revelar de que hablas.
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  VAULT_FACT_SEQUENCE_BASE,
  lastForeignSequence,
  privateRecordSchema,
  resolveConversationOwner,
  type ConversationMemory,
  type ConversationOwner,
  type ConversationOwnerEvent,
  type ConversationOwnerSource,
  type OwnerTurnFact,
  type PrivateRecord,
} from '@luxy/shared';
import type { ConversationOwnerStore } from './conversation-owner-store.js';
import { openTurn, sealTurn, type SealTurnInput } from './private-store.js';
import { VaultError, type VaultService } from './vault-service.js';

/** id de conversacion: uuid, y nada mas. evita cualquier travesia de rutas */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function conversationsDirectory(configDirectory: string): string {
  return join(configDirectory, 'vault', 'conversations');
}

function fileFor(directory: string, conversationId: string): string {
  if (!CONVERSATION_ID.test(conversationId)) {
    throw new VaultError('identificador de conversacion no valido');
  }
  return join(directory, `${conversationId}.jsonl`);
}

/**
 * reemplaza el archivo ENTERO de una conversacion sin poder dejarlo a medias.
 *
 * El `rename` solo mueve metadatos, asi que escribir el temporal y renombrarlo
 * sin mas no basta: un corte de luz en medio puede dejar el nombre bueno
 * apuntando a bloques que todavia no se habian escrito, y entonces no queda ni
 * lo nuevo ni lo viejo. Forzar el contenido a disco antes del `rename` es lo
 * unico que lo impide.
 *
 * Aqui importa mas que en ningun otro almacen porque lo que se reescribe son
 * los MENSAJES: una ficha perdida se rehace con una llamada, una conversacion
 * perdida no se rehace. Es el molde de `recap-store.ts` y `relation-store.ts`,
 * que es justo el que la cabecera de aquel echaba en falta en este archivo.
 */
function replaceFileAtomically(file: string, contents: string): void {
  const temporary = `${file}.tmp`;
  const descriptor = openSync(temporary, 'w');
  try {
    writeFileSync(descriptor, contents, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
}

/**
 * añade lineas al final del archivo y las fuerza a disco.
 *
 * Dos cosas que `appendFileSync` no hacia y que la sincronizacion necesita:
 *
 *  - si la ultima linea quedo a medias —un corte de luz en mitad de una
 *    escritura—, lo nuevo se pegaba a ella y se perdian las DOS: la lectura
 *    salta la linea que no parsea, y ya no habria forma de separarlas. Con el
 *    salto delante, la rota se queda sola y lo nuevo se lee bien;
 *  - el `fsync`: un turno que se da por guardado, o que la sincronizacion da por
 *    bajado, tiene que estar en disco y no en una cache del sistema.
 *
 * Todo sincrono a proposito: quien llama comprueba justo antes, en el mismo
 * bloque, que nadie mas esta escribiendo en esa conversacion.
 */
function appendLinesDurably(file: string, lines: readonly string[]): void {
  if (lines.length === 0) return;
  const descriptor = openSync(file, 'a+');
  try {
    const size = fstatSync(descriptor).size;
    let prefix = '';
    if (size > 0) {
      const last = new Uint8Array(1);
      readSync(descriptor, last, 0, 1, size - 1);
      if (last[0] !== 0x0a) prefix = '\n';
    }
    writeSync(descriptor, `${prefix}${lines.join('\n')}\n`, null, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * lo que se sabe de un archivo de conversacion sin descifrar nada.
 *
 * Es el diagnostico previo a sincronizar (`SYNC-F1-04`): `appendTurn` numeraba
 * con el numero de lineas, asi que un hueco —una linea rota, o un registro que
 * nunca llego— hacia que el turno siguiente repitiera una secuencia ya usada.
 * Una conversacion asi no puede subirse sin elegir cual de las dos vale, y eso
 * no lo decide la sincronizacion.
 */
export interface ConversationIntegrity {
  /** lineas con algo escrito */
  lines: number;
  /**
   * lineas que no se pueden usar: no son JSON, no validan, dicen ser de otra
   * conversacion o caen en el rango reservado a los hechos
   */
  unreadable: number;
  /** copias exactas de un registro que ya estaba (misma secuencia y mismo recordId) */
  duplicateLines: number;
  /** secuencias ocupadas por mas de un recordId distinto */
  duplicateSequences: number;
  /** secuencias que faltan entre 0 y la mayor */
  holes: number;
  /** el archivo no acaba en salto de linea: la ultima quedo a medias */
  partialTail: boolean;
}

/** un archivo leido linea a linea, con lo que vale y lo que no */
interface ScannedConversation {
  /** registros validos, de esta conversacion y fuera del rango reservado, sin copias exactas */
  records: PrivateRecord[];
  integrity: ConversationIntegrity;
}

/**
 * por que no se pudo añadir un registro que llega del servidor.
 *
 * `occupied` es el que importa: esa secuencia ya la tiene aqui otro registro,
 * asi que la conversacion esta en dos versiones y quien llama la congela. El
 * resto son registros que no deberian haber llegado hasta aqui.
 */
export type RemoteAppendRefusal = 'foreign' | 'reserved' | 'occupied' | 'duplicate-record';

export class RemoteAppendError extends VaultError {
  constructor(
    readonly reason: RemoteAppendRefusal,
    readonly sequence: number,
  ) {
    super(
      reason === 'occupied'
        ? 'esa secuencia ya la tiene otro registro en este equipo'
        : reason === 'foreign'
          ? 'ha llegado un registro de otra conversacion'
          : reason === 'reserved'
            ? 'ha llegado un registro fuera del rango de los turnos'
            : 'ha llegado un registro que ya esta en otra secuencia',
      'no se ha escrito nada de ese lote; lo que habia sigue intacto',
    );
    this.name = 'RemoteAppendError';
  }
}

export interface PrivateTurnView {
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  /** viaja con cada turno para no necesitar un indice aparte */
  title: string | null;
  createdAt: string;
}

export interface PrivateConversationSummary {
  conversationId: string;
  title: string;
  turns: number;
  updatedAt: string;
  /**
   * de quien es la conversacion, para poder separarlas.
   *
   * Es el `characterId` DURABLE de la boveda (`D-068`), no el de ningun
   * proveedor: por eso un hilo de Lia sigue siendo de Lia aunque cambie quien
   * le hace las fotos. `null` cuando nunca se eligio personaje.
   */
  characterId: string | null;
  /**
   * de donde sale ese dueño (`D-103`). Opcionales para no romper los dobles de
   * las pruebas; el almacen real los rellena siempre.
   */
  ownerSource?: ConversationOwnerSource;
  /** la conversacion tiene algun evento de enganche, aunque ya se soltara */
  ownerLinked?: boolean;
  /** cuando se engancho, si el dueño lo puso un enganche */
  linkedAt?: string | null;
  /** la copia del nombre que lleva el enganche ganador */
  ownerLabel?: string | null;
  /**
   * el enganche que gana, si gana uno. La memoria reescrita con la ficha
   * (`D-108`) solo vale atada a el, y asi «Lo que recuerda» lo sabe sin volver
   * a descifrar la conversacion entera.
   */
  ownerEventId?: string | null;
}

/** lo que se le pide al almacen de enganches; una interfaz para poder probar */
export type ConversationOwnerEvents = Pick<ConversationOwnerStore, 'all' | 'forConversation'>;

/**
 * el `recordId` de una linea del archivo, sin descifrar nada.
 *
 * Una linea que no parsea o no valida no tiene identificador: `null`, y quien
 * pregunta por uno concreto no la toma por el suyo.
 */
function recordIdOf(line: string | undefined): string | null {
  if (line === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record = privateRecordSchema.safeParse(parsed);
  return record.success ? record.data.recordId : null;
}

/** los hechos de dueño que sello un turno */
function ownerFact(sequence: number, turn: {
  characterId: string | null;
  characterDescription: string | null;
  instructions: string | null;
}): OwnerTurnFact {
  return {
    sequence,
    characterId: turn.characterId,
    characterDescription: turn.characterDescription,
    instructions: turn.instructions,
  };
}

export class PrivateConversationStore {
  constructor(
    private readonly directory: string,
    /**
     * los enganches (`D-103`). Sin el, ninguna conversacion tiene eventos y el
     * dueño sale solo de los turnos, que es lo que habia antes.
     */
    private readonly owners?: ConversationOwnerEvents,
  ) {}

  /**
   * de quien es la conversacion, con su ficha y sus instrucciones.
   *
   * Es el UNICO sitio que lee el personaje de un turno: todos los lectores —el
   * prompt, el indice, los pendientes, la lista y la pantalla— pasan por aqui o
   * por `list()`, que usa la misma funcion. Una prueba estructural lo vigila.
   *
   * Descifra la conversacion entera. Se usa en operaciones puntuales —leer,
   * enviar, enganchar—; la lista, que se pide mucho, para antes.
   */
  async owner(
    vault: VaultService,
    conversationId: string,
    events?: readonly ConversationOwnerEvent[],
  ): Promise<ConversationOwner> {
    return resolveConversationOwner(await this.ownerFacts(vault, conversationId, events));
  }

  /**
   * el dueño y, para la firma, hasta que secuencia se escribio con OTRO
   * personaje en vigor (`lastForeignSequence`). Una sola pasada de descifrado:
   * es para la pantalla, que ya lee la conversacion entera.
   */
  async ownerWithAuthorship(
    vault: VaultService,
    conversationId: string,
  ): Promise<{ owner: ConversationOwner; foreignUpTo: number | null }> {
    const input = await this.ownerFacts(vault, conversationId);
    const owner = resolveConversationOwner(input);
    return { owner, foreignUpTo: lastForeignSequence(input, owner.characterId) };
  }

  private async ownerFacts(
    vault: VaultService,
    conversationId: string,
    events?: readonly ConversationOwnerEvent[],
  ): Promise<{ turns: OwnerTurnFact[]; events: readonly ConversationOwnerEvent[] }> {
    const known = events ?? (await this.owners?.forConversation(vault, conversationId)) ?? [];
    const facts: OwnerTurnFact[] = [];
    for (const record of this.readRecords(conversationId)) {
      const opened = await openTurn(vault, record);
      facts.push(ownerFact(record.sequence, opened.turn));
    }
    return { turns: facts, events: known };
  }

  /** lee los registros crudos: siguen cifrados, no hace falta la boveda */
  private readRecords(conversationId: string): PrivateRecord[] {
    const file = fileFor(this.directory, conversationId);
    if (!existsSync(file)) return [];

    const records: PrivateRecord[] = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // una linea corrupta no invalida el resto: se salta y se sigue. Es la
        // ventaja de un archivo por lineas frente a un JSON unico.
        continue;
      }
      const record = privateRecordSchema.safeParse(parsed);
      if (record.success) records.push(record.data);
    }
    return records.sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * registros tal y como estan en disco, sin descifrar.
   *
   * Es lo que se sube al servidor: ya viene cifrado y no hace falta abrirlo
   * para transportarlo. La bóveda no interviene aqui.
   */
  rawRecords(conversationId: string): PrivateRecord[] {
    return this.readRecords(conversationId);
  }

  /** identificadores de las conversaciones que existen en este equipo */
  listConversationIds(): string[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((entry) => entry.endsWith('.jsonl'))
      .map((entry) => entry.slice(0, -'.jsonl'.length))
      .filter((id) => CONVERSATION_ID.test(id));
  }

  /**
   * comprueba que un registro descargado se puede abrir con esta boveda.
   *
   * Se llama ANTES de guardarlo. Un registro de otra boveda o corrupto que
   * entrase en el archivo local haria fallar cada lectura posterior sin que se
   * supiera cual es el malo.
   */
  async verifyRecord(vault: VaultService, record: PrivateRecord): Promise<void> {
    await openTurn(vault, record);
  }

  /**
   * el archivo linea a linea, sin descifrar nada.
   *
   * A diferencia de `readRecords`, que es para LEER y se salta en silencio lo que
   * no entiende, esto cuenta cada cosa: es lo que mira la sincronizacion antes
   * de subir y lo que enseña el diagnostico.
   */
  private scan(conversationId: string): ScannedConversation {
    const file = fileFor(this.directory, conversationId);
    const empty: ConversationIntegrity = {
      lines: 0,
      unreadable: 0,
      duplicateLines: 0,
      duplicateSequences: 0,
      holes: 0,
      partialTail: false,
    };
    if (!existsSync(file)) return { records: [], integrity: empty };

    const text = readFileSync(file, 'utf8');
    const integrity = { ...empty, partialTail: text.length > 0 && !text.endsWith('\n') };
    const bySequence = new Map<number, Set<string>>();
    const seen = new Set<string>();
    const records: PrivateRecord[] = [];
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      integrity.lines += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        integrity.unreadable += 1;
        continue;
      }
      const record = privateRecordSchema.safeParse(parsed);
      if (
        !record.success ||
        record.data.conversationId.toLowerCase() !== conversationId.toLowerCase() ||
        record.data.sequence >= VAULT_FACT_SEQUENCE_BASE
      ) {
        integrity.unreadable += 1;
        continue;
      }
      const identity = `${record.data.sequence}:${record.data.recordId}`;
      if (seen.has(identity)) {
        integrity.duplicateLines += 1;
        continue;
      }
      seen.add(identity);
      const ids = bySequence.get(record.data.sequence) ?? new Set<string>();
      ids.add(record.data.recordId);
      bySequence.set(record.data.sequence, ids);
      records.push(record.data);
    }

    let max = -1;
    for (const [sequence, ids] of bySequence) {
      if (ids.size > 1) integrity.duplicateSequences += 1;
      max = Math.max(max, sequence);
    }
    integrity.holes = max + 1 - bySequence.size;
    return { records: records.sort((a, b) => a.sequence - b.sequence), integrity };
  }

  /** el diagnostico de una conversacion: cifras, ni una palabra de dentro */
  scanIntegrity(conversationId: string): ConversationIntegrity {
    return this.scan(conversationId).integrity;
  }

  /**
   * lo que puede viajar de una conversacion, con su diagnostico.
   *
   * Sin copias exactas, sin lineas rotas, sin registros de otra conversacion y
   * sin nada del rango reservado. Si hay secuencias repetidas con distinto
   * `recordId`, quien sincroniza no debe subir nada: el diagnostico lo dice.
   */
  syncView(conversationId: string): ScannedConversation {
    return this.scan(conversationId);
  }

  /**
   * guarda registros ya sellados que vienen del servidor (`SYNC-F1-04`).
   *
   * Lo comprueba todo ANTES de escribir nada, y o entra el lote entero o no
   * entra ninguno: que sea de esta conversacion, que no caiga en el rango de los
   * hechos, que su secuencia este libre aqui y que su `recordId` sea nuevo. Una
   * secuencia ocupada por otro registro es una conversacion en dos versiones, y
   * nada remoto pisa nada local (`D-093`).
   *
   * Sincrono de principio a fin: quien llama comprueba en el mismo bloque que
   * la conversacion no esta ocupada ni borrada, y entre esa comprobacion y la
   * escritura no puede colarse nadie.
   *
   * No abre nada: quien llama ya ha verificado cada registro con la boveda.
   */
  appendRemote(conversationId: string, records: readonly PrivateRecord[]): number {
    if (records.length === 0) return 0;
    const file = fileFor(this.directory, conversationId);
    const current = this.scan(conversationId).records;
    const sequences = new Set(current.map((record) => record.sequence));
    const recordIds = new Set(current.map((record) => record.recordId));

    const lines: string[] = [];
    for (const candidate of records) {
      const record = privateRecordSchema.parse(candidate);
      if (record.conversationId.toLowerCase() !== conversationId.toLowerCase()) {
        throw new RemoteAppendError('foreign', record.sequence);
      }
      if (record.sequence >= VAULT_FACT_SEQUENCE_BASE) {
        throw new RemoteAppendError('reserved', record.sequence);
      }
      if (sequences.has(record.sequence)) throw new RemoteAppendError('occupied', record.sequence);
      if (recordIds.has(record.recordId)) {
        throw new RemoteAppendError('duplicate-record', record.sequence);
      }
      sequences.add(record.sequence);
      recordIds.add(record.recordId);
      lines.push(JSON.stringify(record));
    }

    mkdirSync(this.directory, { recursive: true });
    appendLinesDurably(file, lines);
    return lines.length;
  }

  /**
   * añade un turno ya sellado. la boveda debe estar abierta.
   *
   * La secuencia es la mayor que haya mas uno, no el numero de lineas: con un
   * hueco —una linea rota, o un turno que la sincronizacion aun no ha bajado—
   * contar lineas repetia una secuencia ya usada, y esa conversacion quedaba en
   * dos versiones dentro del propio archivo.
   */
  async appendTurn(
    vault: VaultService,
    conversationId: string,
    turn: SealTurnInput['turn'],
    memory?: SealTurnInput['memory'],
  ): Promise<PrivateRecord> {
    const sequence = this.nextSequence(conversationId);
    const record = await sealTurn(vault, {
      conversationId,
      sequence,
      turn,
      ...(memory === undefined ? {} : { memory }),
    });

    // entre leer y escribir solo hay el sellado, y mientras dura un envio nadie
    // mas escribe en esta conversacion (la sincronizacion la salta). Si aun asi
    // cambio, es mejor fallar que dejar dos turnos con el mismo numero
    if (this.nextSequence(conversationId) !== sequence) {
      throw new VaultError(
        'la conversacion cambio mientras se guardaba el turno',
        'no se ha guardado; vuelve a enviarlo',
      );
    }

    mkdirSync(this.directory, { recursive: true });
    // una linea por turno: añadir no reescribe lo anterior
    appendLinesDurably(fileFor(this.directory, conversationId), [JSON.stringify(record)]);
    return record;
  }

  private nextSequence(conversationId: string): number {
    let max = -1;
    for (const record of this.scan(conversationId).records) max = Math.max(max, record.sequence);
    const next = max + 1;
    if (next >= VAULT_FACT_SEQUENCE_BASE) {
      throw new VaultError('esta conversacion ya no admite mas turnos');
    }
    return next;
  }

  /** descifra una conversacion entera. exige la boveda abierta */
  async read(vault: VaultService, conversationId: string): Promise<PrivateTurnView[]> {
    const records = this.readRecords(conversationId);
    const turns: PrivateTurnView[] = [];
    for (const record of records) {
      const opened = await openTurn(vault, record);
      turns.push({
        sequence: record.sequence,
        role: opened.turn.role,
        text: opened.turn.text,
        title: opened.turn.title,
        createdAt: opened.turn.createdAt,
      });
    }
    return turns;
  }

  /**
   * lista las conversaciones con su titulo.
   *
   * exige la boveda abierta porque el titulo va cifrado. Con la boveda cerrada
   * esto devolveria una lista de uuids sin significado, y por eso ni se ofrece:
   * la interfaz no muestra nada hasta abrirla.
   */
  async list(vault: VaultService): Promise<PrivateConversationSummary[]> {
    if (!existsSync(this.directory)) return [];

    // los enganches se leen UNA vez para toda la lista
    const allEvents = (await this.owners?.all(vault)) ?? new Map<string, ConversationOwnerEvent[]>();

    const summaries: PrivateConversationSummary[] = [];
    for (const entry of readdirSync(this.directory)) {
      if (!entry.endsWith('.jsonl')) continue;
      const conversationId = entry.slice(0, -'.jsonl'.length);
      if (!CONVERSATION_ID.test(conversationId)) continue;

      const records = this.readRecords(conversationId);
      const last = records[records.length - 1];
      if (last === undefined) continue;

      const events = allEvents.get(conversationId) ?? [];
      // hacia atras, y parando en cuanto nada de lo que queda pueda ganar: el
      // primer turno que fijo dueño, o la posicion del ancla mas alta (un turno
      // en esa secuencia o antes pierde contra el evento). Es la misma funcion
      // que `owner()` con un sufijo que basta para el dueño y su ficha; lo fija
      // una prueba en `vault-owner.test.ts`
      const maxAnchor = events.reduce((max, event) => Math.max(max, event.anchorSequence), -1);
      const facts: OwnerTurnFact[] = [];
      let title: string | null = null;
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index]!;
        if (index < records.length - 1 && record.sequence <= maxAnchor) break;
        const opened = await openTurn(vault, record);
        // el titulo se lee del ultimo turno, que es el mas actualizado
        if (index === records.length - 1) title = opened.turn.title;
        if (record.sequence <= maxAnchor) break;
        facts.unshift(ownerFact(record.sequence, opened.turn));
        if (opened.turn.characterId !== null) break;
      }
      const owner = resolveConversationOwner({ turns: facts, events });

      summaries.push({
        conversationId,
        title: title ?? 'Sin titulo',
        turns: records.length,
        updatedAt: last.createdAt,
        characterId: owner.characterId,
        ownerSource: owner.source,
        ownerLinked: owner.events > 0,
        linkedAt: owner.linkedAt,
        ownerLabel: owner.characterLabel,
        ownerEventId: owner.winningEventId,
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * ultima memoria valida de la conversacion.
   *
   * Se busca hacia atras y se devuelve la PRIMERA que haya: si el ultimo turno
   * no aporto memoria valida, la anterior sigue siendo buena. Devolver null
   * porque el ultimo turno fallo seria olvidar toda la conversacion por un
   * tropiezo (`D-019`).
   */
  async latestMemory(
    vault: VaultService,
    conversationId: string,
  ): Promise<ConversationMemory | null> {
    return (await this.latestMemoryRecord(vault, conversationId))?.memory ?? null;
  }

  /**
   * la misma memoria que `latestMemory`, con el registro que la sello.
   *
   * La reescritura con la ficha (`D-108`) solo vale atada a ESTA memoria
   * exacta: la secuencia la identifica, y la fecha del registro —que va en
   * claro— cubre un numero reutilizado al retirar un mensaje sin respuesta.
   */
  async latestMemoryRecord(
    vault: VaultService,
    conversationId: string,
  ): Promise<{ memory: ConversationMemory; sequence: number; createdAt: string } | null> {
    const records = this.readRecords(conversationId);
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]!;
      if (record.sealedMemory === null) continue;
      const opened = await openTurn(vault, record);
      if (opened.memory !== null) {
        return { memory: opened.memory.memory, sequence: record.sequence, createdAt: record.createdAt };
      }
    }
    return null;
  }

  /**
   * proveedor con el que se hablo por ultima vez en esta conversacion.
   *
   * Mismo criterio que los demas `latest*`: hacia atras y vale el primero que
   * aparezca. Existe porque el proveedor vivia solo en memoria de la ventana:
   * al reiniciar Studio volvia al primero de la lista, y una conversacion de
   * roleplay acababa enviada a un modelo que la rechaza. El dato ya se sellaba
   * con cada turno; lo unico que faltaba era leerlo.
   */
  async latestProvider(
    vault: VaultService,
    conversationId: string,
  ): Promise<string | null> {
    const records = this.readRecords(conversationId);
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const opened = await openTurn(vault, records[index]!);
      if (opened.turn.provider === null) continue;
      return opened.turn.provider.length === 0 ? null : opened.turn.provider;
    }
    return null;
  }

  /**
   * modelo con el que se hablo por ultima vez en esta conversacion.
   *
   * Va aparte del proveedor porque son dos cosas: el proveedor dice con QUIEN se
   * habla y el modelo CUAL de los suyos. La conversacion privada nunca elegia
   * modelo —mandaba `null`— y caia siempre en el de la conexion, que suele ser
   * el mas caro y lento de la familia.
   */
  async latestModel(vault: VaultService, conversationId: string): Promise<string | null> {
    const records = this.readRecords(conversationId);
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const opened = await openTurn(vault, records[index]!);
      if (opened.turn.model === null) continue;
      return opened.turn.model.length === 0 ? null : opened.turn.model;
    }
    return null;
  }

  /**
   * retira el ultimo turno.
   *
   * Existe para un caso concreto: el mensaje del usuario se sella ANTES de
   * llamar al modelo —para no perderlo si algo va mal a mitad—, y si la llamada
   * falla sin devolver nada, ese turno se queda sin respuesta. El usuario
   * reescribe lo mismo y acaba con su mensaje dos veces en el historial, que
   * ademas viaja duplicado al modelo en el siguiente prompt.
   *
   * Un turno sin contestacion no es parte de la conversacion: es un intento
   * fallido. Devuelve true si habia algo que retirar.
   *
   * Con `expectedRecordId`, solo retira la ultima linea si ES ese registro. Sin
   * la llave no se puede mirar el rol, pero el `recordId` va en claro: es la
   * unica forma de no llevarse otra linea que haya quedado detras —una respuesta
   * suya si el turno ya se retiro una vez, o un registro que haya bajado la
   * sincronizacion mientras se esperaba la respuesta (revision del 28/09)—. Si
   * no casa no toca nada y devuelve false.
   */
  removeLastTurn(conversationId: string, expectedRecordId?: string): boolean {
    const file = fileFor(this.directory, conversationId);
    if (!existsSync(file)) return false;

    const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) return false;

    if (expectedRecordId !== undefined && recordIdOf(lines[lines.length - 1]) !== expectedRecordId) {
      return false;
    }

    lines.pop();
    // sin turnos, la conversacion deja de existir: una entrada vacia en la
    // lista es peor que ninguna
    if (lines.length === 0) {
      unlinkSync(file);
      return true;
    }

    // escritura atomica y forzada a disco: un corte a medias no puede dejar el
    // historial ilegible
    replaceFileAtomically(file, `${lines.join('\n')}\n`);
    return true;
  }

  /**
   * borra la memoria sellada de una conversacion SIN tocar sus turnos.
   *
   * Por que hace falta. La memoria vive DENTRO de cada registro, en su propio
   * sobre (`sealedMemory`) y con su propia subclave, y `latestMemory` la busca
   * hacia atras hasta dar con la primera que haya: quitarla del ultimo turno no
   * la quita, solo destapa la anterior. Por eso se recorren TODOS.
   *
   * Por que se trabaja sobre las lineas crudas y no sobre `readRecords`. Esa
   * lectura descarta en silencio la linea que no parsea —es lo correcto para
   * leer— y reescribir el archivo desde ahi borraria de verdad esos turnos. Aqui
   * la linea que no se entiende se copia tal cual: lo unico que se cambia es el
   * campo de la memoria, y solo en las lineas que validan y la llevan.
   *
   * El texto del turno (`content`) no se toca ni se descifra: esto no necesita
   * la boveda abierta y no produce ni un byte en claro.
   *
   * Devuelve cuantos registros llevaban memoria. Cero significa que no habia
   * ninguna, que no es un fallo.
   */
  clearMemory(conversationId: string): number {
    const file = fileFor(this.directory, conversationId);
    if (!existsSync(file)) return 0;

    let cleared = 0;
    // se conserva el separador final tal y como estaba: `split`/`join` sobre el
    // mismo caracter devuelve el archivo con su ultima linea vacia incluida
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => {
        if (line.trim().length === 0) return line;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return line;
        }
        const record = privateRecordSchema.safeParse(parsed);
        if (!record.success || record.data.sealedMemory === null) return line;
        cleared += 1;
        // se escribe desde el objeto ORIGINAL y no desde el validado: zod
        // descarta las claves que no conoce, asi que reserializar lo parseado
        // tiraria cualquier campo que una version posterior haya añadido
        return JSON.stringify({ ...(parsed as object), sealedMemory: null });
      });

    if (cleared === 0) return 0;

    // escritura atomica y forzada a disco, como `removeLastTurn`: un corte a
    // mitad no puede dejar el historial ilegible, que aqui seria perder la
    // conversacion entera por haber querido borrar solo su memoria. Sin el
    // `fsync` esa frase era falsa, y es la unica del metodo que no puede serlo
    replaceFileAtomically(file, lines.join('\n'));
    return cleared;
  }

  /** borra una conversacion. no hay papelera: es lo que se espera aqui */
  delete(conversationId: string): void {
    const file = fileFor(this.directory, conversationId);
    if (existsSync(file)) unlinkSync(file);
  }
}
