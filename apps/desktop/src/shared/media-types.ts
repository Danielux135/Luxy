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

/**
 * el tipo REAL de una imagen, leido de sus primeros bytes.
 *
 * La extension miente y el tipo escrito a mano miente mas. La copia del avatar
 * de un personaje se guardaba con `mimeType: 'image/webp'` a pelo, fuera lo que
 * fuera de verdad, y eso derrota la unica guarda que impide mandarle a AI Horde
 * un formato que no admite: su comprobacion mira el tipo declarado, asi que un
 * PNG etiquetado como webp pasa y falla despues, dentro del worker.
 *
 * `null` cuando no reconoce la firma: no se inventa un tipo, que es justo lo
 * que hacia el codigo anterior.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const empieza = (...firma: number[]): boolean =>
    firma.every((byte, index) => bytes[index] === byte);
  // PNG: \x89PNG\r\n\x1a\n
  if (empieza(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  // JPEG: cualquier variante empieza por FF D8 FF
  if (empieza(0xff, 0xd8, 0xff)) return 'image/jpeg';
  // GIF87a / GIF89a
  if (empieza(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  // WEBP: «RIFF» + 4 bytes de tamaño + «WEBP». Los cuatro del medio se saltan
  // a proposito: son la longitud del archivo y cambian con cada imagen
  const texto = (offset: number, valor: string): boolean =>
    [...valor].every((letra, index) => bytes[offset + index] === letra.charCodeAt(0));
  if (texto(0, 'RIFF') && texto(8, 'WEBP')) return 'image/webp';
  // AVIF y demas cajas ISO-BMFF: «ftyp» en el byte 4 y la marca detras
  if (texto(4, 'ftyp') && texto(8, 'avif')) return 'image/avif';
  return null;
}
