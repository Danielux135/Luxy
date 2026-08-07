// correlacion entre las fuentes de captura y los monitores de Electron.
//
// POR QUE HACE FALTA CORRELACIONAR NADA:
//
// getDisplayMedia NO acepta un deviceId. La unica forma de elegir QUE monitor se
// captura es que el proceso principal resuelva la peticion con una fuente
// concreta de desktopCapturer. Pero desktopCapturer devuelve fuentes
// ("screen:0:0") y screen.getAllDisplays() devuelve monitores con geometria.
// Son dos listas distintas, y el puente entre ellas es display_id.
//
// VERIFICADO EMPIRICAMENTE en Electron 43 sobre Windows 11: source.display_id
// devuelve exactamente el mismo valor que String(display.id).
//
// Codigo puro y sin Electron a proposito: se puede probar la correlacion, que es
// donde estan los fallos, sin abrir una ventana.
import type { DisplayInfo } from './monitors.js';

/** lo que interesa de desktopCapturer.getSources() */
export interface CaptureSource {
  id: string;
  name: string;
  /** id del monitor como CADENA; screen.getAllDisplays() lo da como numero */
  display_id: string;
}

/** lo que interesa de screen.getAllDisplays() */
export interface ElectronDisplay {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  rotation: number;
  internal: boolean;
}

/** un monitor con la fuente de captura que le corresponde */
export interface CapturableDisplay extends DisplayInfo {
  /**
   * id que hay que pasarle a desktopCapturer. NULL si ese monitor no aparece
   * entre las fuentes: existe y se puede controlar con el raton, pero no se
   * puede capturar. Se distingue en vez de descartarlo para poder explicarlo.
   */
  sourceId: string | null;
}

/**
 * une monitores y fuentes.
 *
 * El recorrido va POR MONITORES, no por fuentes, y eso es deliberado: la lista
 * de monitores es la verdad sobre la geometria, que es lo que decide donde cae
 * el cursor. Si se recorriera al reves, una fuente sin monitor correspondiente
 * -que las hay: capturas de ventanas, pantallas virtuales de escritorio remoto-
 * entraria en la lista sin bounds y romperia la conversion de coordenadas.
 */
export function correlateDisplays(
  displays: readonly ElectronDisplay[],
  sources: readonly CaptureSource[],
  primaryId: number,
): CapturableDisplay[] {
  // se indexa por cadena porque display_id ya viene asi; comparar numero con
  // cadena con === daria siempre false y NINGUN monitor tendria fuente
  const porId = new Map<string, CaptureSource>();
  for (const fuente of sources) {
    if (fuente.display_id.length > 0) porId.set(fuente.display_id, fuente);
  }

  return displays.map((display, indice) => {
    const clave = String(display.id);
    const fuente = porId.get(clave);

    return {
      id: clave,
      label: labelFor(display, fuente, indice),
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      primary: display.id === primaryId,
      rotation: display.rotation,
      sourceId: fuente?.id ?? null,
    };
  });
}

/**
 * nombre que ve el usuario en el selector de monitor del movil.
 *
 * display.label VIENE VACIO en Windows en muchos equipos (comprobado en Electron
 * 43: cadena vacia con un portatil). Sin este respaldo, el selector del movil
 * mostraria botones sin texto y el usuario no sabria cual es cual.
 */
function labelFor(
  display: ElectronDisplay,
  source: CaptureSource | undefined,
  index: number,
): string {
  if (display.label.trim().length > 0) return display.label.trim();
  if (source !== undefined && source.name.trim().length > 0) return source.name.trim();
  if (display.internal) return 'Pantalla del portatil';
  return `Monitor ${index + 1}`;
}

/**
 * monitores que se pueden capturar de verdad.
 *
 * Se usa para no ofrecer al movil un monitor que solo mostraria negro.
 */
export function capturableOnly(displays: readonly CapturableDisplay[]): CapturableDisplay[] {
  return displays.filter((d) => d.sourceId !== null);
}

/**
 * elige la fuente para una peticion de getDisplayMedia.
 *
 * Devuelve null si el monitor pedido no existe o no se puede capturar, y ESO
 * IMPORTA: setDisplayMediaRequestHandler tiene que poder denegar. Si ante un
 * monitor desconocido cayera al primario "por si acaso", un cliente podria
 * pedir un monitor inventado y acabar viendo una pantalla que el usuario no
 * eligio.
 */
export function sourceForMonitor(
  displays: readonly CapturableDisplay[],
  monitorId: string | null,
): CapturableDisplay | null {
  if (monitorId !== null) {
    return displays.find((d) => d.id === monitorId && d.sourceId !== null) ?? null;
  }
  return displays.find((d) => d.primary && d.sourceId !== null) ?? null;
}
