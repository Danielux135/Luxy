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
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
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

  /** guarda un registro ya sellado que viene de otro equipo */
  appendRaw(conversationId: string, record: PrivateRecord): void {
    mkdirSync(this.directory, { recursive: true });
    appendFileSync(fileFor(this.directory, conversationId), `${JSON.stringify(record)}\n`, 'utf8');
  }

  /** añade un turno ya sellado. la boveda debe estar abierta */
  async appendTurn(
    vault: VaultService,
    conversationId: string,
    turn: SealTurnInput['turn'],
    memory?: SealTurnInput['memory'],
  ): Promise<PrivateRecord> {
    const existing = this.readRecords(conversationId);
    const record = await sealTurn(vault, {
      conversationId,
      sequence: existing.length,
      turn,
      ...(memory === undefined ? {} : { memory }),
    });

    mkdirSync(this.directory, { recursive: true });
    // una linea por turno: añadir no reescribe lo anterior
    appendFileSync(fileFor(this.directory, conversationId), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
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
