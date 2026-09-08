// que formatos de archivo admite Luxy, y como se llaman.
//
// POR QUE VIVE APARTE Y NO EN `handlers.ts`: porque asi se puede probar. Esto
// era antes un mapa suelto y DOS listas de extensiones escritas a mano en dos
// dialogos distintos del proceso principal, sin una sola prueba entre las tres.
// Se separaron sin que nadie se enterara: un `.avif` no aparecia en ninguno de
// los dos dialogos, asi que la foto sencillamente no estaba en la carpeta.
//
// Y el modo de fallo del mapa era peor que el del dialogo. Una extension
// desconocida devuelve `application/octet-stream`, que no casa con el `^image/`
// del esquema del host: el turno cruzaba el IPC, se descartaba EN SILENCIO al
// otro lado y la ventana se quedaba «Mirando…» hasta agotar el timeout, para
// terminar diciendo «el agente no respondio a tiempo». Un fallo de extension
// disfrazado de fallo del agente.
//
// El modulo es PURO: ni disco, ni Electron. Solo mira el texto de una ruta.

/**
 * extensiones de IMAGEN que se ofrecen al elegir un archivo.
 *
 * `avif` esta porque las camaras de movil y los navegadores ya lo sacan por
 * defecto, y porque es lo que Daniel tenia en el escritorio. Que el proveedor
 * remoto lo acepte es OTRA pregunta y no se responde aqui: se responde
 * probandolo en el banco de vision, que existe justo para eso.
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] as const;

/**
 * extensiones de VIDEO, aparte a proposito.
 *
 * No se unifican con las de imagen: el banco de vision manda UNA imagen y no
 * puede aceptar un mp4, asi que las dos listas difieren por un motivo real.
 * Juntarlas en una sola constante «para no repetir» romperia el banco.
 */
export const VIDEO_EXTENSIONS = ['mp4', 'webm'] as const;

/**
 * tipo declarado por la extension del archivo elegido en el dialogo.
 *
 * Es lo unico que se sabe del archivo: no se leen los bytes ni se comprueba la
 * firma. Basta para no mandar un tipo invalido, que era el fallo; no basta para
 * afirmar que el contenido es de verdad lo que dice la extension.
 */
export function mimeTypeFor(filePath: string): string {
  const extension = filePath.toLowerCase().split('.').pop() ?? '';
  const known: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  return known[extension] ?? 'application/octet-stream';
}

/** true si esa ruta tiene una extension que sabemos nombrar como imagen */
export function isKnownImage(filePath: string): boolean {
  return mimeTypeFor(filePath).startsWith('image/');
}
