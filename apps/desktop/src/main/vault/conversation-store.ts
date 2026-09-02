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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { privateRecordSchema, type ConversationMemory, type PrivateRecord } from '@luxy/shared';
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
}

export class PrivateConversationStore {
  constructor(private readonly directory: string) {}

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

    const summaries: PrivateConversationSummary[] = [];
    for (const entry of readdirSync(this.directory)) {
      if (!entry.endsWith('.jsonl')) continue;
      const conversationId = entry.slice(0, -'.jsonl'.length);
      if (!CONVERSATION_ID.test(conversationId)) continue;

      const records = this.readRecords(conversationId);
      const last = records[records.length - 1];
      if (last === undefined) continue;

      // el titulo se lee del ultimo turno, que es el mas actualizado
      const opened = await openTurn(vault, last);
      summaries.push({
        conversationId,
        title: opened.turn.title ?? 'Sin titulo',
        turns: records.length,
        updatedAt: last.createdAt,
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
    const records = this.readRecords(conversationId);
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]!;
      if (record.sealedMemory === null) continue;
      const opened = await openTurn(vault, record);
      if (opened.memory !== null) return opened.memory.memory;
    }
    return null;
  }

  /**
   * instrucciones fijas en vigor, leidas del ultimo turno que las llevaba.
   *
   * Mismo criterio que `latestMemory`: se busca hacia atras y vale la primera
   * que aparezca. Un turno que no las llevaba no significa que se hayan
   * borrado; significa que ese turno no las cambio.
   *
   * Para quitarlas de verdad se guarda una cadena vacia, que si se distingue de
   * «no las toque». Sin esa distincion no habria forma de volver atras.
   */
  async latestInstructions(
    vault: VaultService,
    conversationId: string,
  ): Promise<string | null> {
    const records = this.readRecords(conversationId);
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]!;
      const opened = await openTurn(vault, record);
      if (opened.turn.instructions === null) continue;
      return opened.turn.instructions.length === 0 ? null : opened.turn.instructions;
    }
    return null;
  }

  /** borra una conversacion. no hay papelera: es lo que se espera aqui */
  delete(conversationId: string): void {
    const file = fileFor(this.directory, conversationId);
    if (existsSync(file)) unlinkSync(file);
  }
}
