// persistencia del catalogo real de una conexion.
//
// POR QUE EXISTE: consultar la pasarela cuesta una peticion y su respuesta no
// cambia cada minuto. Se guarda con fecha para poder decir «esto se leyo el
// dia X» en vez de dar por buena una lista escrita a mano hace semanas.
//
// El archivo NO lleva claves: solo nombres de modelo, multiplicadores y grupos.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogSnapshot } from '@luxy/shared';

/** nombre de archivo seguro por conexion; el identificador se filtra */
function snapshotPath(directory: string, connectionId: string): string {
  const safe = connectionId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  return join(directory, `${safe.length > 0 ? safe : 'conexion'}.json`);
}

export function writeCatalogSnapshot(directory: string, snapshot: CatalogSnapshot): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    snapshotPath(directory, snapshot.connectionId),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  );
}

/**
 * lee el ultimo catalogo guardado.
 *
 * devuelve null si no hay ninguno o si el archivo esta corrupto: un catalogo
 * ilegible se trata como ausente, nunca se propaga a medias.
 */
export function readCatalogSnapshot(
  directory: string,
  connectionId: string,
): CatalogSnapshot | null {
  try {
    const raw = readFileSync(snapshotPath(directory, connectionId), 'utf8');
    return JSON.parse(raw) as CatalogSnapshot;
  } catch {
    return null;
  }
}
