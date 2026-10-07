// el papel de ESTE equipo, apuntado fuera del estado sellado (`SYNC-F1-07`,
// revision F1-R1-01).
//
// Por que existe. La guardia de replica dependia solo de `sync-state.json`, y
// eso dejaba tres caminos para que un ordenador nuevo escribiera turnos sin las
// fichas —el fallo FATAL que la guardia viene a cerrar—:
//
//  1. hasta su primera pasada el papel era `null`, y `null` dejaba escribir:
//     entrar en la cuenta, escribir en Privado y sincronizar despues lo dejaba
//     como origen, con las conversaciones del otro equipo bajadas y abiertas;
//  2. el papel se decidia mirando si habia conversaciones aqui, y una sola
//     escrita antes de sincronizar bastaba para ser origen;
//  3. si el estado sellado no se podia leer, se borraba y se volvia a decidir:
//     una replica que ya habia bajado conversaciones pasaba a origen.
//
// Lo que guarda este archivo es la señal que no depende de ninguno de esos: un
// equipo que ENTRA en una cuenta con la carpeta de la boveda vacia es una
// replica desde ese momento —se apunta en `adoptAccountKey`, antes de escribir
// vault.json—, y el papel que decide una pasada se copia aqui. Una replica no se
// rebaja nunca a origen: ni por un reinicio del estado ni por nada que se haga
// en este equipo. Hasta tener los hechos (F2) no escribe turnos.
//
// **No va sellado, y es deliberado**, como `sync-deleted.json`: no lleva ni un
// identificador, solo el papel, de donde salio y cuando. Sellarlo lo ataria a la
// llave, y al entrar en la cuenta hay que apuntarlo ANTES de tener la boveda
// abierta con ella.
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { SYNC_ROLES, type SyncRole } from './sync-state-store.js';

export function syncAnchorFilePath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'sync-anchor.json');
}

/** de donde salio el papel apuntado */
export const SYNC_ANCHOR_SOURCES = ['account-login', 'sync-pass'] as const;
export type SyncAnchorSource = (typeof SYNC_ANCHOR_SOURCES)[number];

const fileSchema = z
  .object({
    version: z.literal(1),
    role: z.enum(SYNC_ROLES),
    /**
     * `account-login`: entro en la cuenta con la carpeta vacia. `sync-pass`: lo
     * decidio una pasada y se copio aqui
     */
    source: z.enum(SYNC_ANCHOR_SOURCES),
    at: z.string().datetime(),
  })
  .strict();

/**
 * lo que dice el ancla.
 *
 * `unreadable` es un archivo que existe y no se entiende: no se da por vacio,
 * porque eso dejaria escribir a una replica cuyo ancla se estropeo.
 */
export type SyncAnchorRead =
  | { kind: 'none' }
  | { kind: 'role'; role: SyncRole }
  | { kind: 'unreadable' };

/**
 * el papel que vale, juntando el estado sellado y el ancla.
 *
 * Replica gana siempre: si cualquiera de los dos lo dice, lo es. Un ancla que
 * existe y no se entiende, sin nada en el estado, cuenta como replica: no se
 * sabe como llego este equipo, y lo prudente es no escribir. `null` es un
 * equipo del que nadie sabe nada todavia: el de siempre antes de su primera
 * pasada, que tiene que poder seguir escribiendo.
 */
export function effectiveSyncRole(stateRole: SyncRole | null, anchor: SyncAnchorRead): SyncRole | null {
  if (stateRole === 'replica') return 'replica';
  if (anchor.kind === 'role' && anchor.role === 'replica') return 'replica';
  if (stateRole === 'origin') return 'origin';
  if (anchor.kind === 'role') return anchor.role;
  if (anchor.kind === 'unreadable') return 'replica';
  return null;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export class SyncAnchorStore {
  constructor(private readonly file: string) {}

  /**
   * lo apuntado. Sin la llave.
   *
   * Lanza SOLO por un fallo de E/S que no sea «no existe» —un EBUSY de un
   * antivirus, un EPERM—: eso no dice nada del papel, y quien lee decide lo
   * prudente en vez de tomarlo por «nada apuntado».
   */
  read(): SyncAnchorRead {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch (error) {
      if (isMissing(error)) return { kind: 'none' };
      throw error;
    }
    try {
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      return parsed.success ? { kind: 'role', role: parsed.data.role } : { kind: 'unreadable' };
    } catch {
      return { kind: 'unreadable' };
    }
  }

  /**
   * apunta el papel. Una replica legible no se rebaja: apuntar `origin` encima
   * no hace nada. Lo mismo no se reescribe.
   *
   * Temporal, `fsync` y `rename`, como la lapida: tiene que estar en disco
   * antes de que nada dependa de el.
   */
  record(role: SyncRole, source: SyncAnchorSource, now: Date = new Date()): void {
    const current = this.read();
    if (current.kind === 'role' && (current.role === 'replica' || current.role === role)) return;
    const next = fileSchema.parse({ version: 1, role, source, at: now.toISOString() });

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

  /**
   * quita el ancla. SOLO para deshacer la que acaba de apuntar una entrada en
   * la cuenta que no llego a escribir vault.json: nada mas la quita, porque
   * quitarla seria justo lo que rebaja una replica. Un fallo se ignora: deja
   * el ancla, que es lo prudente.
   */
  remove(): void {
    try {
      unlinkSync(this.file);
    } catch {
      // ya no estaba, o no se puede quitar: queda como replica
    }
  }
}
