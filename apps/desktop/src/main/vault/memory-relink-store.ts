// la memoria de las conversaciones enganchadas, reescrita con la ficha de su
// personaje (`D-108`), cifrada y SOLO en este equipo.
//
// Vive aparte del `.jsonl` a proposito: el archivo sellado no se reescribe
// nunca, y si esto falla, se niega o Daniel se queda con la de antes, la
// memoria de siempre sigue ahi intacta. Una fila por conversacion: la del
// enganche que gana. Un enganche nuevo sustituye la fila del anterior.
//
// Calcado de `conversation-owner-store.ts`: un carril para leer, modificar y
// escribir; temporal sellado, `fsync` y `rename`; un archivo que existe y no
// abre detiene el trabajo y NO se sobrescribe nunca; y lo que no valida se
// conserva tal cual, porque puede haberlo escrito un Studio mas nuevo.
//
// El archivo entero va sellado con la subclave `identity|memory-relink`: dentro
// hay memoria de conversaciones, la misma sensibilidad que `recap.json`.
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
import { memoryRelinkEntrySchema, type MemoryRelinkEntry } from '@luxy/shared';
import { VaultError, type VaultService } from './vault-service.js';

export function memoryRelinkFilePath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'memory-relink.json');
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

interface RelinkSnapshot {
  rows: MemoryRelinkEntry[];
  unreadable: unknown[];
}

/** true si una fila que no se pudo leer dice ser de esa conversacion */
function rawBelongsTo(raw: unknown, conversationId: string): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  return (raw as { conversationId?: unknown }).conversationId === conversationId;
}

export class MemoryRelinkStore {
  private lane: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async read(vault: VaultService): Promise<RelinkSnapshot> {
    if (!existsSync(this.file)) return { rows: [], unreadable: [] };

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      throw new VaultError(
        'el registro de memorias reescritas no se puede leer',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    }
    const parsed = sealedFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VaultError(
        'el registro de memorias reescritas no tiene el formato esperado',
        'no se ha tocado el archivo; copialo antes de seguir y avisa',
      );
    }

    const key = vault.subkeyFor('identity', 'memory-relink');
    let text: string;
    try {
      text = await openText(key, 'vault.identity', parsed.data.content as SealedEnvelope);
    } catch {
      throw new VaultError(
        'el registro de memorias reescritas no se puede descifrar',
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
        'el registro de memorias reescritas es de otra version',
        'no se ha tocado el archivo; actualiza Luxy antes de seguir',
      );
    }

    const rows: MemoryRelinkEntry[] = [];
    const unreadable: unknown[] = [];
    for (const candidate of payload.rows) {
      const row = memoryRelinkEntrySchema.safeParse(candidate);
      if (row.success) rows.push(row.data);
      else unreadable.push(candidate);
    }
    return { rows, unreadable };
  }

  /** todas, por conversacion. Lo usa quien lee muchas a la vez */
  async all(vault: VaultService): Promise<Map<string, MemoryRelinkEntry>> {
    const { rows } = await this.read(vault);
    return new Map(rows.map((row) => [row.conversationId, row]));
  }

  async forConversation(
    vault: VaultService,
    conversationId: string,
  ): Promise<MemoryRelinkEntry | undefined> {
    return (await this.all(vault)).get(conversationId);
  }

  /**
   * cambia la fila de una conversacion SOLO si sigue siendo la que se leyo.
   *
   * `expected` es la fila tal y como estaba al empezar —`undefined` si no
   * habia—, comparada por `ownerEventId`, `status` y `updatedAt`. Entre leerla y
   * escribirla cabe una llamada al CLI de un minuto, y en ese rato Daniel puede
   * haber pulsado «Volver a la de antes» o haber soltado la conversacion: lo que
   * llega tarde se tira, no pisa lo que el decidio. Devuelve si escribio.
   */
  async replace(
    vault: VaultService,
    conversationId: string,
    expected: MemoryRelinkEntry | undefined,
    next: MemoryRelinkEntry,
  ): Promise<boolean> {
    const checked = memoryRelinkEntrySchema.parse(next);
    if (checked.conversationId !== conversationId) {
      throw new VaultError(
        'se ha intentado guardar la memoria reescrita de otra conversacion',
        'no se ha escrito nada; es un fallo de Luxy, avisa',
      );
    }
    let written = false;
    await this.mutate(vault, (current) => {
      const now = current.rows.find((row) => row.conversationId === conversationId);
      if (!sameRow(now, expected)) return current;
      written = true;
      return {
        rows: [...current.rows.filter((row) => row.conversationId !== conversationId), checked],
        unreadable: current.unreadable.filter((raw) => !rawBelongsTo(raw, conversationId)),
      };
    });
    return written;
  }

  /**
   * se va la de esa conversacion, incluidas las ilegibles que digan ser suyas:
   * dentro hay memoria de la conversacion, y conservarla seria dejarla en disco
   * sin nada que la use.
   */
  async removeConversation(vault: VaultService, conversationId: string): Promise<void> {
    if (!existsSync(this.file)) return;
    await this.mutate(vault, (current) => {
      // sin nada suyo se devuelve el MISMO objeto: `mutate` compara por
      // identidad, y cada borrado de memoria o de conversacion volvia a sellar
      // y reescribir el archivo para dejarlo igual (septima ronda)
      const mine =
        current.rows.some((row) => row.conversationId === conversationId) ||
        current.unreadable.some((raw) => rawBelongsTo(raw, conversationId));
      if (!mine) return current;
      return {
        rows: current.rows.filter((row) => row.conversationId !== conversationId),
        unreadable: current.unreadable.filter((raw) => !rawBelongsTo(raw, conversationId)),
      };
    });
  }

  private mutate(
    vault: VaultService,
    mutator: (current: RelinkSnapshot) => RelinkSnapshot,
  ): Promise<void> {
    const run = this.lane.then(async () => {
      const current = await this.read(vault);
      const next = mutator(current);
      // nada que cambiar: no se reescribe un archivo para dejarlo igual
      if (next === current) return;
      await this.persist(vault, next);
    });
    this.lane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persist(vault: VaultService, state: RelinkSnapshot): Promise<void> {
    const rows = z.array(memoryRelinkEntrySchema).safeParse(state.rows);
    if (!rows.success) {
      throw new VaultError(
        'se ha intentado guardar una memoria reescrita que no es valida',
        'no se ha escrito nada y lo guardado sigue intacto; es un fallo de Luxy, avisa',
      );
    }
    const key = vault.subkeyFor('identity', 'memory-relink');
    try {
      const sealed = await sealText(
        key,
        'vault.identity',
        JSON.stringify({ v: 1, rows: [...rows.data, ...state.unreadable] }),
      );
      mkdirSync(join(this.file, '..'), { recursive: true });
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

function sameRow(now: MemoryRelinkEntry | undefined, expected: MemoryRelinkEntry | undefined): boolean {
  if (now === undefined || expected === undefined) return now === expected;
  return (
    now.ownerEventId === expected.ownerEventId &&
    now.status === expected.status &&
    now.updatedAt === expected.updatedAt
  );
}
