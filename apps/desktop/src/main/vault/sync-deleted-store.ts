// conversaciones borradas en ESTE equipo, para que la sincronizacion no las
// resucite (`SYNC-F1-05`).
//
// Borrar una conversacion aqui no la borra del servidor en F1: su copia se queda
// alli hasta F2, que traera la papelera. Sin esta lista, la siguiente pasada
// veria en el servidor una conversacion que aqui no existe y la volveria a
// bajar: justo lo que Daniel acaba de mandar borrar. Con ella, ese id ni sube
// ni baja.
//
// **No va sellado, y es deliberado.** Solo guarda identificadores aleatorios
// —los mismos que ya estaban a la vista como nombres de archivo— y la fecha del
// borrado, como `memory-excluded.json`. Sellarlo lo ataria a la llave: el
// borrado tendria que esperar a la boveda abierta para apuntarse, y si el estado
// sellado no abriera, la conversacion volveria. Se apunta ANTES de borrar nada.
//
// Un archivo que existe y no se entiende NO se da por vacio: eso resucitaria
// todo lo borrado. Se para la sincronizacion y el borrado, y se dice.
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
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { VaultError } from './vault-service.js';

export function syncDeletedFilePath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'sync-deleted.json');
}

const entrySchema = z
  .object({
    conversationId: z.string().uuid(),
    deletedAt: z.string().datetime(),
  })
  .strict();
export type SyncDeletedEntry = z.infer<typeof entrySchema>;

const fileSchema = z
  .object({
    version: z.literal(1),
    deleted: z.array(entrySchema).max(100_000),
  })
  .strict();

export class SyncDeletedStore {
  constructor(private readonly file: string) {}

  /** todas las lapidas. Lanza si el archivo existe y no se entiende */
  list(): SyncDeletedEntry[] {
    if (!existsSync(this.file)) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      throw unreadable();
    }
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) throw unreadable();
    return parsed.data.deleted;
  }

  ids(): Set<string> {
    return new Set(this.list().map((entry) => entry.conversationId.toLowerCase()));
  }

  has(conversationId: string): boolean {
    return this.ids().has(conversationId.toLowerCase());
  }

  /**
   * apunta un borrado. Idempotente, y sin la llave.
   *
   * Temporal, `fsync` y `rename`: la lapida tiene que estar en disco ANTES de
   * que se borre el primer archivo, o un corte en medio dejaria la conversacion
   * borrada aqui y lista para volver con la siguiente pasada.
   */
  add(conversationId: string, now: Date = new Date()): void {
    const id = z.string().uuid().parse(conversationId).toLowerCase();
    const current = this.list();
    if (current.some((entry) => entry.conversationId.toLowerCase() === id)) return;
    const next = fileSchema.parse({
      version: 1,
      deleted: [...current, { conversationId: id, deletedAt: now.toISOString() }],
    });

    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    const descriptor = openSync(temporary, 'w');
    try {
      writeFileSync(descriptor, JSON.stringify(next), 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, this.file);
  }
}

function unreadable(): VaultError {
  return new VaultError(
    'la lista de conversaciones borradas de este equipo no se puede leer',
    'no se ha borrado ni sincronizado nada: sin esa lista volverian conversaciones que borraste. Copia vault/sync-deleted.json y avisa',
  );
}
