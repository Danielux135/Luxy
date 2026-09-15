// persistencia del catalogo real de una conexion.
//
// POR QUE EXISTE: consultar la pasarela cuesta una peticion y su respuesta no
// cambia cada minuto. Se guarda con fecha para poder decir «esto se leyo el
// dia X» en vez de dar por buena una lista escrita a mano hace semanas.
//
// El archivo NO lleva claves: solo nombres de modelo, multiplicadores y grupos.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogSnapshotSchema, type CatalogSnapshot, type CatalogSource } from '@luxy/shared';

/**
 * nombre de archivo seguro por origen; el identificador se filtra.
 *
 * Los de `connections` conservan el nombre de siempre, sin prefijo: cambiarlo
 * dejaria huerfanos los catalogos ya leidos y la pantalla diria «sin consultar
 * todavia» sobre una conexion que si se consulto. Los de `providers.http`
 * llevan prefijo porque las dos listas comparten espacio de nombres y una
 * conexion y un proveedor pueden llamarse igual.
 */
function snapshotPath(directory: string, connectionId: string, source: CatalogSource): string {
  const safe = connectionId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  const nombre = safe.length > 0 ? safe : 'conexion';
  return join(directory, source === 'http' ? `http-${nombre}.json` : `${nombre}.json`);
}

export function writeCatalogSnapshot(directory: string, snapshot: CatalogSnapshot): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    snapshotPath(directory, snapshot.connectionId, snapshot.source ?? 'connection'),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  );
}

/**
 * lee el ultimo catalogo guardado.
 *
 * devuelve null si no hay ninguno o si el archivo esta corrupto: un catalogo
 * ilegible se trata como ausente, nunca se propaga a medias.
 *
 * COMPROBAR LA FORMA Y NO SOLO EL JSON: esto era `JSON.parse(raw) as
 * CatalogSnapshot`, un cast. El try de alrededor solo atrapaba el JSON
 * ilegible, asi que un JSON perfectamente valido con otra forma pasaba entero
 * —`models` sin `apiModel`, o `models` que ni siquiera es una lista— y viajaba
 * por IPC hasta el renderer, donde el catalogo se construye en el CUERPO del
 * render de la raiz del arbol: ventana en negro desde el arranque, y sin nada
 * en pantalla que dijera que archivo borrar. Es el unico sitio por el que entra
 * un dato sin comprobar a una API que asume `apiModel: string`.
 */
export function readCatalogSnapshot(
  directory: string,
  connectionId: string,
  source: CatalogSource = 'connection',
): CatalogSnapshot | null {
  try {
    const raw = readFileSync(snapshotPath(directory, connectionId, source), 'utf8');
    // un archivo escrito antes de que existieran los dos origenes no lleva
    // `source`, y sin esto el renderer no podria emparejarlo con lo que pidio.
    // El valor por defecto del esquema no basta: el que toca es el PEDIDO
    const parsed = catalogSnapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return { ...parsed.data, source: parsed.data.source ?? source };
  } catch {
    return null;
  }
}
