// los enganches de conversacion a personaje, cifrados y SOLO en este equipo
// (`D-103`).
//
// Cada fila es `{event, uploadedAt: null}`, y `event` es ya la carga v1
// definitiva (`conversationOwnerEventSchema`): el eventId, el ancla, la
// generacion, lo que sustituye y los tres campos del personaje. Cuando exista el
// servidor, subirla sera sellar cada `event` con la subclave de su conversacion y
// marcar `uploadedAt`, sin rehacer nada de lo que se guarda hoy. Hoy no sube
// nada: `uploadedAt` es siempre `null`, y la pantalla lo dice.
//
// El archivo entero va sellado con la subclave `identity|conversation-owners`:
// sin eso, el disco diria que conversaciones tienen dueño cambiado.
//
// Calcado de `relation-store.ts`: un carril para leer, modificar y escribir;
// temporal sellado, `fsync` y `rename`; un archivo que existe y no abre detiene
// el trabajo y NO se sobrescribe nunca; y lo que no valida se conserva tal cual,
// porque puede haberlo escrito un Studio mas nuevo.
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
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { openText, sealText, wipe, type SealedEnvelope } from '@luxy/vault-crypto';
import {
  conversationOwnerEventSchema,
  nextOwnerEventPosition,
  type ConversationOwnerEvent,
} from '@luxy/shared';
import { VaultError, type VaultService } from './vault-service.js';

export function conversationOwnersFilePath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'conversation-owners.json');
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

/** las filas entran sin validar: una rota no puede tirar las demas */
const payloadSchema = z.object({
  v: z.literal(1),
  rows: z.array(z.unknown()).default([]),
});

const rowSchema = z
  .object({
    event: conversationOwnerEventSchema,
    /** `null` = no subido. Hoy siempre: no hay servidor para esto */
    uploadedAt: z.string().datetime().nullable(),
  })
  .strict();
type OwnerRow = z.infer<typeof rowSchema>;

interface OwnerSnapshot {
  rows: OwnerRow[];
  unreadable: unknown[];
}

/** lo que el que engancha aporta; la posicion la calcula el almacen */
export interface OwnerEventInput {
  /** ultima secuencia de turno que hay en este equipo; -1 si ninguna */
  lastSequence: number;
  characterId: string | null;
  characterLabel: string | null;
  characterDescription: string | null;
  instructions: string | null;
  now: string;
}

/** true si una fila que no se pudo leer dice ser de esa conversacion */
function rawBelongsTo(raw: unknown, conversationId: string): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const event = (raw as { event?: unknown }).event;
  if (typeof event !== 'object' || event === null) return false;
  return (event as { conversationId?: unknown }).conversationId === conversationId;
}

export class ConversationOwnerStore {
  private lane: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async read(vault: VaultService): Promise<OwnerSnapshot> {
    if (!existsSync(this.file)) return { rows: [], unreadable: [] };

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      throw new VaultError(
        'el registro de personajes de las conversaciones no se puede leer',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    }
    const parsed = sealedFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VaultError(
        'el registro de personajes de las conversaciones no tiene el formato esperado',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    }

    const key = vault.subkeyFor('identity', 'conversation-owners');
    let text: string;
    try {
      text = await openText(key, 'vault.identity', parsed.data.content as SealedEnvelope);
    } catch {
      throw new VaultError(
        'el registro de personajes de las conversaciones no se puede descifrar',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    } finally {
      wipe(key);
    }

    let payload: z.infer<typeof payloadSchema>;
    try {
      payload = payloadSchema.parse(JSON.parse(text));
    } catch {
      throw new VaultError(
        'el registro de personajes de las conversaciones es de otra version',
        'no se ha tocado el archivo; actualiza Luxy antes de seguir',
      );
    }

    const rows: OwnerRow[] = [];
    const unreadable: unknown[] = [];
    for (const candidate of payload.rows) {
      const row = rowSchema.safeParse(candidate);
      if (row.success) rows.push(row.data);
      else unreadable.push(candidate);
    }
    return { rows, unreadable };
  }

  /** los eventos de todas las conversaciones, agrupados */
  async all(vault: VaultService): Promise<Map<string, ConversationOwnerEvent[]>> {
    const { rows } = await this.read(vault);
    const grouped = new Map<string, ConversationOwnerEvent[]>();
    for (const row of rows) {
      const own = grouped.get(row.event.conversationId);
      if (own === undefined) grouped.set(row.event.conversationId, [row.event]);
      else own.push(row.event);
    }
    return grouped;
  }

  async forConversation(
    vault: VaultService,
    conversationId: string,
  ): Promise<ConversationOwnerEvent[]> {
    return (await this.all(vault)).get(conversationId) ?? [];
  }

  /**
   * añade un evento. La posicion se calcula DENTRO del carril: dos pulsaciones
   * seguidas no pueden repetir generacion ni dejar de citarse.
   */
  async append(
    vault: VaultService,
    conversationId: string,
    input: OwnerEventInput,
  ): Promise<ConversationOwnerEvent> {
    let created: ConversationOwnerEvent | null = null;
    await this.mutate(vault, (current) => {
      const known = current.rows
        .filter((row) => row.event.conversationId === conversationId)
        .map((row) => row.event);
      const position = nextOwnerEventPosition(known, input.lastSequence);
      const event = conversationOwnerEventSchema.parse({
        v: 1,
        kind: 'owner',
        eventId: randomUUID(),
        conversationId,
        anchorSequence: position.anchorSequence,
        generation: position.generation,
        supersedes: position.supersedes,
        characterId: input.characterId,
        characterLabel: input.characterLabel,
        characterDescription: input.characterDescription,
        instructions: input.instructions,
        createdAt: input.now,
      });
      created = event;
      return { rows: [...current.rows, { event, uploadedAt: null }], unreadable: current.unreadable };
    });
    return created!;
  }

  /**
   * al borrar una conversacion se van sus eventos, incluidos los ilegibles que
   * digan ser suyos: conservarlos dejaria en disco la ficha de quien fue.
   */
  async removeConversation(vault: VaultService, conversationId: string): Promise<void> {
    if (!existsSync(this.file)) return;
    await this.mutate(vault, (current) => ({
      rows: current.rows.filter((row) => row.event.conversationId !== conversationId),
      unreadable: current.unreadable.filter((raw) => !rawBelongsTo(raw, conversationId)),
    }));
  }

  private mutate(
    vault: VaultService,
    mutator: (current: OwnerSnapshot) => OwnerSnapshot,
  ): Promise<void> {
    const run = this.lane.then(async () => {
      const current = await this.read(vault);
      await this.persist(vault, mutator(current));
    });
    this.lane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persist(vault: VaultService, state: OwnerSnapshot): Promise<void> {
    const rows = z.array(rowSchema).safeParse(state.rows);
    if (!rows.success) {
      throw new VaultError(
        'se ha intentado guardar un registro de personajes que no es valido',
        'no se ha escrito nada y lo guardado sigue intacto; es un fallo de Luxy, avisa',
      );
    }
    const key = vault.subkeyFor('identity', 'conversation-owners');
    try {
      const sealed = await sealText(
        key,
        'vault.identity',
        JSON.stringify({ v: 1, rows: [...rows.data, ...state.unreadable] }),
      );
      mkdirSync(join(this.file, '..'), { recursive: true });
      // sellado tambien el temporal, y forzado a disco antes del rename: el
      // molde de `relation-store.ts`
      const temporary = `${this.file}.tmp`;
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
