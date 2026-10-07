// estado de la sincronizacion de ESTE equipo (`SYNC-F1-05`).
//
// Lo que guarda es lo minimo para no fiarse de nada guardado: cada pasada vuelve
// a pedir el manifiesto entero del servidor, y esto solo sirve para avisar y
// para recordar decisiones de este equipo:
//
//  - `deviceId`: un identificador aleatorio del equipo. En F1 no viaja; F2 lo
//    usara para saber quien hace el trabajo de fondo;
//  - `role`: `origin` o `replica`. Un equipo que se estrena con la boveda de la
//    cuenta y sin nada propio es una replica: hasta tener los hechos (F2) no
//    escribe turnos, porque sin las fichas sellaria una memoria pobre que ganaria
//    para siempre;
//  - `factsBootstrapped` y `autoSync`: siempre `false` en F1;
//  - por conversacion, si esta congelada «en dos versiones» y cuantos turnos
//    sabe este equipo que tiene el servidor, para avisar si el servidor pierde
//    alguno.
//
// SIN CONTENIDO: ni un titulo, ni un texto, ni una fecha de un turno. Aun asi va
// sellado con `identity|sync-state`, como el resto de archivos de la boveda que
// dicen algo de las conversaciones.
//
// Si no abre, se borra y se empieza de cero: todo lo que hace la sincronizacion
// es idempotente, y un estado ilegible no puede dejar a Daniel sin copia. La
// boveda cerrada NO es «no abre», ni un fallo de E/S al leerlo: entonces no se
// toca nada. Y el papel no depende solo de esto: tambien esta en el ancla sin
// sellar (`sync-anchor-store.ts`), asi que empezar de cero no rebaja una
// replica a origen.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { openText, sealText, wipe, type SealedEnvelope } from '@luxy/vault-crypto';
import type { VaultService } from './vault-service.js';

export function syncStateFilePath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'sync-state.json');
}

export const SYNC_ROLES = ['origin', 'replica'] as const;
export type SyncRole = (typeof SYNC_ROLES)[number];

const conversationStateSchema = z
  .object({
    /** en dos versiones: ni sube ni baja hasta que F3 traiga como separarla */
    frozen: z.boolean().default(false),
    /** turnos que este equipo sabe que estan en el servidor */
    uploaded: z.number().int().min(0).default(0),
  })
  .strict();
export type SyncConversationState = z.infer<typeof conversationStateSchema>;

const stateSchema = z
  .object({
    v: z.literal(1),
    deviceId: z.string().uuid(),
    role: z.enum(SYNC_ROLES).nullable().default(null),
    factsBootstrapped: z.boolean().default(false),
    autoSync: z.boolean().default(false),
    conversations: z.record(z.string().uuid(), conversationStateSchema).default({}),
  })
  .strict();
export type SyncState = z.infer<typeof stateSchema>;

const sealedFileSchema = z.object({
  version: z.literal(1),
  content: z.object({
    version: z.number().int(),
    purpose: z.string(),
    nonce: z.string(),
    ciphertext: z.string(),
  }),
});

const SUBKEY_CONTEXT = 'sync-state';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export interface SyncStateStoreOptions {
  /** inyectable para que las pruebas fijen el identificador */
  newDeviceId?: () => string;
  /** se avisa cuando un archivo ilegible se borra para empezar de cero */
  onReset?: () => void;
}

export class SyncStateStore {
  private lane: Promise<void> = Promise.resolve();
  private readonly newDeviceId: () => string;

  constructor(
    private readonly file: string,
    private readonly options: SyncStateStoreOptions = {},
  ) {
    this.newDeviceId = options.newDeviceId ?? (() => randomUUID());
  }

  private fresh(): SyncState {
    return stateSchema.parse({ v: 1, deviceId: this.newDeviceId() });
  }

  /**
   * el estado guardado, o uno nuevo.
   *
   * La llave se pide ANTES de mirar el archivo: con la boveda cerrada lanza y
   * no se borra nada. Solo lo que con la llave en la mano no se entiende se da
   * por perdido.
   */
  private async load(vault: VaultService): Promise<{ state: SyncState; stored: boolean }> {
    const key = vault.subkeyFor('identity', SUBKEY_CONTEXT);
    try {
      let raw: string;
      try {
        raw = readFileSync(this.file, 'utf8');
      } catch (error) {
        if (isMissing(error)) return { state: this.fresh(), stored: false };
        // un fallo de E/S —un EBUSY de un antivirus, un EPERM— NO es «no abre»:
        // se lanza sin borrar nada. Antes se tomaba por ilegible y se borraba,
        // y con el archivo se iba el papel de una replica (F1-R1-01)
        throw error;
      }
      try {
        const sealed = sealedFileSchema.parse(JSON.parse(raw));
        const text = await openText(key, 'vault.identity', sealed.content as SealedEnvelope);
        return { state: stateSchema.parse(JSON.parse(text)), stored: true };
      } catch {
        // ilegible, de otra boveda o de otra version: se empieza de cero. Lo
        // unico que se pierde es lo que se vuelve a calcular en la siguiente
        // pasada; el papel, no, porque tambien esta en el ancla. Si ni siquiera
        // se puede borrar, se lanza: no se finge un estado nuevo encima de uno
        // que sigue ahi
        try {
          unlinkSync(this.file);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        this.options.onReset?.();
        return { state: this.fresh(), stored: false };
      }
    } finally {
      wipe(key);
    }
  }

  async read(vault: VaultService): Promise<SyncState> {
    return this.enqueue(async () => (await this.load(vault)).state);
  }

  /**
   * cambia el estado dentro del carril: leer, modificar y escribir sin que otra
   * escritura se cuele en medio. Devuelve el estado resultante.
   */
  async update(vault: VaultService, mutator: (current: SyncState) => SyncState): Promise<SyncState> {
    return this.enqueue(async () => {
      const { state, stored } = await this.load(vault);
      const next = stateSchema.parse(mutator(state));
      // nada que cambiar y ya guardado: no se reescribe para dejarlo igual
      if (!stored || JSON.stringify(next) !== JSON.stringify(state)) await this.persist(vault, next);
      return next;
    });
  }

  /** se van las entradas de esa conversacion: borrarla no deja rastro aqui */
  async removeConversation(vault: VaultService, conversationId: string): Promise<void> {
    if (!existsSync(this.file)) return;
    await this.update(vault, (current) => {
      if (current.conversations[conversationId] === undefined) return current;
      const conversations = { ...current.conversations };
      delete conversations[conversationId];
      return { ...current, conversations };
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lane.then(task);
    this.lane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persist(vault: VaultService, state: SyncState): Promise<void> {
    const key = vault.subkeyFor('identity', SUBKEY_CONTEXT);
    try {
      const sealed = await sealText(key, 'vault.identity', JSON.stringify(state));
      mkdirSync(dirname(this.file), { recursive: true });
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
