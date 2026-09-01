// almacen de archivos cifrados de la boveda.
//
// Guarda los bytes que `sealMedia` ya devolvio cifrados. Este modulo NO cifra:
// si alguna vez lo hiciera, habria dos sitios que deciden como se protege un
// archivo y acabarian discrepando.
//
// La interfaz existe porque habra dos implementaciones. Hoy sólo la local; la
// remota (`F9.16` completo) subira exactamente estos mismos bytes a un almacen
// de objetos. Que el contenido ya viaje cifrado es lo que hace que la segunda
// sea un cambio de transporte y no un rediseño.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VaultError } from './vault-service.js';

/** clave de objeto: 32 hex y nada mas. sin nombre, sin extension, sin rutas */
const OBJECT_KEY = /^[0-9a-f]{32}$/;

export interface BlobStore {
  put(objectKey: string, bytes: Uint8Array): Promise<void>;
  get(objectKey: string): Promise<Uint8Array>;
  has(objectKey: string): Promise<boolean>;
  delete(objectKey: string): Promise<void>;
  /** bytes ocupados, para cuotas y para avisar antes de que se llene el disco */
  totalBytes(): Promise<number>;
}

export function mediaDirectory(configDirectory: string): string {
  return join(configDirectory, 'vault', 'media');
}

/**
 * almacen en disco.
 *
 * Un archivo por objeto, nombrado por su clave opaca. La extension es `.bin`
 * para todos: un `.mp4` junto a un `.png` ya diria que hay video, y el
 * explorador de Windows generaria miniaturas de ambos.
 */
export class LocalBlobStore implements BlobStore {
  constructor(private readonly directory: string) {}

  private fileFor(objectKey: string): string {
    if (!OBJECT_KEY.test(objectKey)) {
      // la clave viene de `randomObjectKey`, pero tambien podria venir de un
      // registro sincronizado desde otro equipo: se valida igual
      throw new VaultError('clave de objeto no valida');
    }
    return join(this.directory, `${objectKey}.bin`);
  }

  async put(objectKey: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) throw new VaultError('no se guarda un archivo vacio');
    const file = this.fileFor(objectKey);
    mkdirSync(this.directory, { recursive: true });

    // escritura atomica, como el resto de la boveda: un corte a media escritura
    // no puede dejar un archivo a medias que luego falle al descifrar sin que
    // se sepa por que
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, file);
  }

  async get(objectKey: string): Promise<Uint8Array> {
    const file = this.fileFor(objectKey);
    if (!existsSync(file)) {
      throw new VaultError(
        'ese archivo no esta en este equipo',
        'puede estar en otro de tus equipos y todavia sin sincronizar',
      );
    }
    return new Uint8Array(readFileSync(file));
  }

  async has(objectKey: string): Promise<boolean> {
    return existsSync(this.fileFor(objectKey));
  }

  async delete(objectKey: string): Promise<void> {
    const file = this.fileFor(objectKey);
    if (existsSync(file)) unlinkSync(file);
  }

  async totalBytes(): Promise<number> {
    if (!existsSync(this.directory)) return 0;
    const { readdirSync } = await import('node:fs');
    let total = 0;
    for (const entry of readdirSync(this.directory)) {
      if (!entry.endsWith('.bin')) continue;
      try {
        total += statSync(join(this.directory, entry)).size;
      } catch {
        // un archivo que desaparece entre listar y medir no es un error
      }
    }
    return total;
  }
}
