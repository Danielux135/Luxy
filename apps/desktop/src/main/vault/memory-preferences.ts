// preferencias del banco de recuerdos: que conversaciones quedan fuera, y quien
// hace el trabajo de fondo.
//
// Hay hilos que no deberian volver nunca: una prueba, una conversacion de otra
// epoca, algo que se prefiere no arrastrar. Excluir uno no lo borra —los turnos
// siguen ahi y la conversacion se abre igual—, solo lo saca de lo que el
// personaje puede recordar en otra parte.
//
// **Esto NO se cifra, y es deliberado.** Lo unico que guarda son identificadores
// de conversacion —que ya estan a la vista como nombres de archivo en
// `vault/conversations/`— y el nombre de un CLI local. Cifrarlo no ocultaria
// nada, y a cambio obligaria a tener la boveda abierta para saber que excluir:
// justo cuando se construye el indice. Ni un titulo, ni un texto, ni una fecha
// entran aqui.
//
// El archivo conserva su nombre, `memory-excluded.json`, aunque ya guarde mas:
// cambiarlo perderia las exclusiones que ya existen.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { LOCAL_CLI_PROVIDERS, type AuxiliaryChoice } from '@luxy/shared';

export function memoryPreferencesPath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'memory-excluded.json');
}

const fileSchema = z.object({
  version: z.literal(1),
  /** identificadores de conversacion, nada mas */
  excluded: z.array(z.string().uuid()).max(1000).default([]),
  /**
   * quien hace el trabajo de fondo —catalogar escenas— si se eligio en el panel.
   *
   * Solo Claude o Codex: el esquema no admite otro, asi que un archivo tocado a
   * mano no puede colar una API de pago. Un valor invalido se descarta y las
   * exclusiones se conservan.
   */
  auxiliary: z
    .object({ provider: z.enum(LOCAL_CLI_PROVIDERS), model: z.string().max(128).nullable() })
    .nullable()
    .default(null)
    .catch(null),
});

interface Stored {
  excluded: Set<string>;
  auxiliary: AuxiliaryChoice | null;
}

export class MemoryPreferences {
  /** cache en memoria: esto se consulta en cada construccion del indice */
  private cached: Stored | null = null;

  constructor(private readonly file: string) {}

  excluded(): ReadonlySet<string> {
    return this.stored().excluded;
  }

  /** quien hace el trabajo de fondo; `null` es automatico */
  auxiliary(): AuxiliaryChoice | null {
    return this.stored().auxiliary;
  }

  private stored(): Stored {
    if (this.cached !== null) return this.cached;
    this.cached = this.load();
    return this.cached;
  }

  private load(): Stored {
    const vacio: Stored = { excluded: new Set(), auxiliary: null };
    if (!existsSync(this.file)) return vacio;
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      // un archivo ilegible no debe impedir usar la aplicacion: lo peor que
      // pasa es que vuelva a recordarse algo que se habia excluido, y eso se
      // arregla volviendo a excluirlo
      return parsed.success
        ? { excluded: new Set(parsed.data.excluded), auxiliary: parsed.data.auxiliary }
        : vacio;
    } catch {
      return vacio;
    }
  }

  /**
   * olvida lo leido: la siguiente consulta vuelve al disco. Lo usa apartar la
   * boveda local (`SYNC-F1-07`): lo que habia en memoria era de la apartada.
   */
  reload(): void {
    this.cached = null;
  }

  isExcluded(conversationId: string): boolean {
    return this.excluded().has(conversationId);
  }

  /** devuelve la lista resultante, para que la interfaz no tenga que releer */
  set(conversationId: string, excluded: boolean): string[] {
    const next = new Set(this.excluded());
    if (excluded) next.add(conversationId);
    else next.delete(conversationId);

    const state = { ...this.stored(), excluded: next };
    this.persist(state);
    this.cached = state;
    return [...next];
  }

  /** elige quien hace el trabajo de fondo; `null` vuelve a lo automatico */
  setAuxiliary(choice: AuxiliaryChoice | null): AuxiliaryChoice | null {
    const state = { ...this.stored(), auxiliary: choice };
    this.persist(state);
    this.cached = state;
    return choice;
  }

  private persist(state: Stored): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const payload = {
      version: 1 as const,
      excluded: [...state.excluded],
      auxiliary: state.auxiliary,
    };

    // escritura atomica, como el resto de la boveda: un corte a medias no puede
    // dejar el archivo ilegible
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(payload), 'utf8');
    renameSync(temporary, this.file);
  }
}
