// geometria de monitores y conversion de coordenadas.
//
// AQUI ES DONDE SE PIERDE EL CURSOR, y por eso esta separado de todo lo demas y
// es codigo puro: se puede probar sin Electron y sin una pantalla.
//
// LA CORRECCION QUE COSTO UNA PRUEBA ROJA:
//
// La primera version calculaba el rectangulo fisico de cada monitor
// multiplicando sus `bounds` de Electron por su propio `scaleFactor`. Parece
// obvio y es FALSO. Electron reporta los bounds en un espacio DIP UNICO para
// todo el escritorio virtual, no en coordenadas propias de cada pantalla.
//
// Con un portatil 4K al 150% (2560x1440 DIP) y un externo 1080p al 100% a su
// derecha (origen DIP x=2560), multiplicar cada origen por su escala da:
//   portatil -> 0..3840 fisico
//   externo  -> 2560..4480 fisico
// Los dos monitores SE SOLAPAN. El escritorio medira 4480 en vez de 5760, y
// todo clic en el monitor secundario cae desplazado mas de mil pixeles.
//
// La disposicion fisica real NO se puede reconstruir desde los DIP: hay que
// pedirsela a Windows. El proceso auxiliar -que si es PerMonitorV2, ver
// docs/adr/0005-host-windows.md- la obtiene con EnumDisplayMonitors y la
// reporta. Mientras ese auxiliar no exista, se usa una aproximacion que SOLO es
// correcta cuando todas las escalas coinciden, y se avisa de ello.

/** rectangulo en pixeles FISICOS */
export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** un monitor tal y como lo describe Electron */
export interface DisplayInfo {
  id: string;
  label: string;
  /** en DIPs, que es lo que devuelve screen.getAllDisplays() */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  primary: boolean;
  rotation: number;
  /**
   * rectangulo FISICO real, tal y como lo ve Windows.
   *
   * Lo aporta el proceso auxiliar PerMonitorV2. Cuando falta, se aproxima desde
   * los DIP, y esa aproximacion SOLO es correcta si todas las escalas coinciden.
   */
  physical?: PhysicalRect;
}

/**
 * rectangulo fisico de un monitor.
 *
 * Si el auxiliar reporto el real, se usa ese. Si no, se APROXIMA escalando los
 * DIP, y hay que saber que esa aproximacion coloca mal los monitores en cuanto
 * hay dos escalas distintas: ver la cabecera del archivo.
 */
export function toPhysical(display: DisplayInfo): PhysicalRect {
  if (display.physical !== undefined) return display.physical;

  return {
    x: Math.round(display.bounds.x * display.scaleFactor),
    y: Math.round(display.bounds.y * display.scaleFactor),
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
}

/** true si la geometria de TODOS los monitores es real, no aproximada */
export function hasRealGeometry(displays: readonly DisplayInfo[]): boolean {
  return displays.every((d) => d.physical !== undefined);
}

/**
 * true si la aproximacion desde DIP es fiable para este conjunto.
 *
 * Lo es cuando todas las escalas coinciden: en ese caso el espacio DIP y el
 * fisico son proporcionales y multiplicar conserva la disposicion.
 */
export function dipApproximationIsSafe(displays: readonly DisplayInfo[]): boolean {
  return new Set(displays.map((d) => d.scaleFactor)).size <= 1;
}

/**
 * escritorio virtual que abarca todos los monitores, en pixeles fisicos.
 *
 * Se calcula sumando, NO se pide al sistema: si el proceso no fuera
 * PerMonitorV2, GetSystemMetrics devolveria valores virtualizados a la escala
 * del monitor primario y estarian mal. Calcularlo aqui a partir de datos que ya
 * vienen con su scaleFactor evita depender de eso.
 */
export function virtualDesktop(displays: readonly DisplayInfo[]): PhysicalRect {
  if (displays.length === 0) return { x: 0, y: 0, width: 1, height: 1 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const display of displays) {
    const fisico = toPhysical(display);
    minX = Math.min(minX, fisico.x);
    minY = Math.min(minY, fisico.y);
    maxX = Math.max(maxX, fisico.x + fisico.width);
    maxY = Math.max(maxY, fisico.y + fisico.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** coordenada tal y como la espera SendInput */
export interface AbsolutePoint {
  /** 0..65535 sobre el escritorio virtual */
  dx: number;
  dy: number;
}

export const SENDINPUT_MAX = 65535;

/**
 * convierte una coordenada normalizada del protocolo a la de SendInput.
 *
 * EL DIVISOR ES (ancho - 1), NO ancho. La documentacion de Microsoft dice que
 * 65535 mapea a la esquina inferior derecha, es decir al ULTIMO PIXEL. Dividir
 * entre el ancho produce un error de aproximadamente un pixel que se nota en los
 * bordes y crece con el tamano de la pantalla.
 */
export function toAbsolute(
  normalizedX: number,
  normalizedY: number,
  monitor: DisplayInfo,
  displays: readonly DisplayInfo[],
): AbsolutePoint {
  const fisico = toPhysical(monitor);
  const virtual = virtualDesktop(displays);

  // se acota antes de convertir: un cliente comprometido podria mandar 5.0 y
  // sacar el cursor del escritorio
  const x = Math.min(Math.max(normalizedX, 0), 1);
  const y = Math.min(Math.max(normalizedY, 0), 1);

  // punto dentro del monitor, en fisico
  const puntoX = fisico.x + x * (fisico.width - 1);
  const puntoY = fisico.y + y * (fisico.height - 1);

  // y ese punto expresado sobre el escritorio virtual
  const anchoUtil = Math.max(virtual.width - 1, 1);
  const altoUtil = Math.max(virtual.height - 1, 1);

  return {
    dx: Math.round(((puntoX - virtual.x) * SENDINPUT_MAX) / anchoUtil),
    dy: Math.round(((puntoY - virtual.y) * SENDINPUT_MAX) / altoUtil),
  };
}

/**
 * el camino inverso: de un punto fisico a la normalizada de un monitor.
 * Sirve para el diagnostico y para pruebas de ida y vuelta.
 */
export function toNormalized(
  physicalX: number,
  physicalY: number,
  monitor: DisplayInfo,
): { x: number; y: number } {
  const fisico = toPhysical(monitor);
  return {
    x: (physicalX - fisico.x) / Math.max(fisico.width - 1, 1),
    y: (physicalY - fisico.y) / Math.max(fisico.height - 1, 1),
  };
}

/** elige el monitor por id, o el primario si no existe */
export function resolveMonitor(
  displays: readonly DisplayInfo[],
  monitorId: string | null,
): DisplayInfo | null {
  if (displays.length === 0) return null;
  if (monitorId !== null) {
    const encontrado = displays.find((d) => d.id === monitorId);
    if (encontrado !== undefined) return encontrado;
  }
  return displays.find((d) => d.primary) ?? displays[0] ?? null;
}

/**
 * descripcion de los monitores para el cliente.
 *
 * Se manda el tamano FISICO, no el DIP: el movil lo usa para saber la relacion
 * de aspecto real y para mostrarla en el diagnostico. El scaleFactor va aparte y
 * es solo informativo; el cliente NO lo usa para calcular coordenadas, porque si
 * lo hiciera volveriamos a tener la conversion repartida en dos sitios.
 */
export function describeMonitors(
  displays: readonly DisplayInfo[],
): Array<{
  id: string;
  label: string;
  width: number;
  height: number;
  primary: boolean;
  scale: number;
}> {
  return displays.map((display) => {
    const fisico = toPhysical(display);
    return {
      id: display.id,
      label: display.label.length > 0 ? display.label : `Monitor ${display.id}`,
      width: fisico.width,
      height: fisico.height,
      primary: display.primary,
      scale: display.scaleFactor,
    };
  });
}

/**
 * avisa de situaciones que degradan la experiencia sin ser errores.
 *
 * Se muestran en el diagnostico. Un usuario con monitores a escalas distintas
 * que ve el cursor "raro" merece saber que eso es conocido y por que.
 */
export function monitorWarnings(displays: readonly DisplayInfo[]): string[] {
  const avisos: string[] = [];

  const escalas = new Set(displays.map((d) => d.scaleFactor));
  if (escalas.size > 1 && !hasRealGeometry(displays)) {
    // esto NO es un "puede que": con escalas mixtas y geometria aproximada, el
    // cursor CAE MAL en el monitor secundario, y por bastante
    avisos.push(
      `Tienes monitores con escalas distintas (${[...escalas]
        .map((e) => `${Math.round(e * 100)}%`)
        .join(', ')}) y Luxy todavia no puede leer su disposicion real. ` +
        'El cursor caera desplazado en el monitor secundario. Iguala las escalas ' +
        'en Windows mientras tanto.',
    );
  }

  if (displays.some((d) => d.rotation !== 0)) {
    avisos.push('Hay algun monitor rotado. La captura se envia sin rotar.');
  }

  return avisos;
}
