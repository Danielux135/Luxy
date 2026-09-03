// conversaciones excluidas del banco de recuerdos.
//
// Hay hilos que no deberian volver nunca: una prueba, una conversacion de otra
// epoca, algo que se prefiere no arrastrar. Excluir uno no lo borra —los turnos
// siguen ahi y la conversacion se abre igual—, solo lo saca de lo que el
// personaje puede recordar en otra parte.
//
// **Esto NO se cifra, y es deliberado.** Lo unico que guarda son identificadores
// de conversacion, que ya estan a la vista como nombres de archivo en
// `vault/conversations/`. Cifrarlo no ocultaria nada que no este ya expuesto, y
// a cambio obligaria a tener la boveda abierta para saber que excluir: justo
// cuando se construye el indice. Ni un titulo, ni un texto, ni una fecha entran
// aqui.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export function memoryPreferencesPath(configDirectory: string): string {
  return join(configDirectory, 'vault', 'memory-excluded.json');
}

const fileSchema = z.object({
  version: z.literal(1),
  /** identificadores de conversacion, nada mas */
  excluded: z.array(z.string().uuid()).max(1000).default([]),
});

export class MemoryPreferences {
  /** cache en memoria: esto se consulta en cada construccion del indice */
  private cached: Set<string> | null = null;

  constructor(private readonly file: string) {}

  excluded(): ReadonlySet<string> {
    if (this.cached !== null) return this.cached;
    this.cached = this.load();
    return this.cached;
  }

  private load(): Set<string> {
    if (!existsSync(this.file)) return new Set();
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      // un archivo ilegible no debe impedir usar la aplicacion: lo peor que
      // pasa es que vuelva a recordarse algo que se habia excluido, y eso se
      // arregla volviendo a excluirlo
      return parsed.success ? new Set(parsed.data.excluded) : new Set();
    } catch {
      return new Set();
    }
  }

  isExcluded(conversationId: string): boolean {
    return this.excluded().has(conversationId);
  }

  /** devuelve la lista resultante, para que la interfaz no tenga que releer */
  set(conversationId: string, excluded: boolean): string[] {
    const next = new Set(this.excluded());
    if (excluded) next.add(conversationId);
    else next.delete(conversationId);

    this.persist(next);
    this.cached = next;
    return [...next];
  }

  private persist(values: ReadonlySet<string>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const payload = { version: 1 as const, excluded: [...values] };

    // escritura atomica, como el resto de la boveda: un corte a medias no puede
    // dejar el archivo ilegible
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(payload), 'utf8');
    renameSync(temporary, this.file);
  }
}
