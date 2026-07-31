// pruebas de la conversion de coordenadas.
//
// Es el sitio donde se pierde el cursor. Las escalas mixtas son el caso que
// rompe las implementaciones ingenuas, y el que tiene el usuario en cuanto
// conecta un portatil 4K a un monitor externo de 1080p.
import { describe, it, expect } from 'vitest';
import {
  toPhysical,
  virtualDesktop,
  toAbsolute,
  toNormalized,
  resolveMonitor,
  describeMonitors,
  monitorWarnings,
  hasRealGeometry,
  dipApproximationIsSafe,
  SENDINPUT_MAX,
  type DisplayInfo,
} from './monitors.js';

function display(overrides: Partial<DisplayInfo> = {}): DisplayInfo {
  return {
    id: '1',
    label: 'Principal',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    primary: true,
    rotation: 0,
    ...overrides,
  };
}

/**
 * el caso real: portatil 4K al 150% + monitor externo 1080p al 100%.
 *
 * La geometria FISICA la aporta el auxiliar. Es imprescindible: los DIP no
 * permiten reconstruirla, y deducirla de ellos hace que los monitores se
 * solapen. Ver la cabecera de monitors.ts.
 */
const PORTATIL = display({
  id: 'portatil',
  label: 'Portatil 4K',
  // 3840x2160 fisicos al 150% son 2560x1440 en DIPs
  bounds: { x: 0, y: 0, width: 2560, height: 1440 },
  scaleFactor: 1.5,
  primary: true,
  physical: { x: 0, y: 0, width: 3840, height: 2160 },
});

const EXTERNO = display({
  id: 'externo',
  label: 'Monitor externo',
  // a la derecha del portatil: en DIP empieza en 2560, en FISICO en 3840
  bounds: { x: 2560, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  primary: false,
  physical: { x: 3840, y: 0, width: 1920, height: 1080 },
});

describe('DIPs a pixeles fisicos', () => {
  it('un monitor al 100% no cambia', () => {
    expect(toPhysical(display())).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('si hay geometria real, se usa esa', () => {
    expect(toPhysical(PORTATIL)).toEqual({ x: 0, y: 0, width: 3840, height: 2160 });
    expect(toPhysical(EXTERNO).x).toBe(3840);
  });

  it('sin geometria real se aproxima desde los DIP', () => {
    const sinReal = display({ bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 });
    expect(toPhysical(sinReal)).toEqual({ x: 0, y: 0, width: 3840, height: 2160 });
  });
});

describe('POR QUE LA APROXIMACION NO VALE CON ESCALAS MIXTAS', () => {
  // esto fijo un fallo REAL de la primera version, que deducia el rectangulo
  // fisico multiplicando los DIP por la escala de cada monitor
  const aproximados = [
    display({
      id: 'portatil',
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      scaleFactor: 1.5,
      primary: true,
    }),
    display({
      id: 'externo',
      bounds: { x: 2560, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      primary: false,
    }),
  ];

  it('los monitores SE SOLAPAN al deducirlos de los DIP', () => {
    const portatil = toPhysical(aproximados[0]!);
    const externo = toPhysical(aproximados[1]!);

    // el portatil acaba en 3840 y el externo empieza en 2560: se pisan
    expect(portatil.x + portatil.width).toBe(3840);
    expect(externo.x).toBe(2560);
    expect(externo.x).toBeLessThan(portatil.x + portatil.width);
  });

  it('y el escritorio virtual sale mas estrecho de lo que es', () => {
    // 4480 en vez de 5760: todo clic en el secundario cae mas de mil px desviado
    expect(virtualDesktop(aproximados).width).toBe(4480);
    expect(virtualDesktop([PORTATIL, EXTERNO]).width).toBe(5760);
  });

  it('se puede saber si la aproximacion es fiable', () => {
    expect(dipApproximationIsSafe(aproximados)).toBe(false);
    expect(dipApproximationIsSafe([display({ id: 'a' }), display({ id: 'b' })])).toBe(true);
  });

  it('se puede saber si la geometria es real', () => {
    expect(hasRealGeometry([PORTATIL, EXTERNO])).toBe(true);
    expect(hasRealGeometry(aproximados)).toBe(false);
  });
});

describe('escritorio virtual', () => {
  it('con un solo monitor es ese monitor', () => {
    expect(virtualDesktop([display()])).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('con dos monitores abarca los dos, en FISICO', () => {
    // 3840 del portatil + 1920 del externo, no 2560 + 1920
    const virtual = virtualDesktop([PORTATIL, EXTERNO]);
    expect(virtual.width).toBe(3840 + 1920);
    expect(virtual.height).toBe(2160);
  });

  it('un monitor a la IZQUIERDA da origen negativo', () => {
    const izquierda = display({
      id: 'izq',
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      primary: false,
    });
    const virtual = virtualDesktop([display(), izquierda]);

    expect(virtual.x).toBe(-1920);
    expect(virtual.width).toBe(3840);
  });

  it('sin monitores no revienta', () => {
    expect(virtualDesktop([])).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('normalizada a SendInput', () => {
  it('la esquina superior izquierda del primario es 0,0', () => {
    expect(toAbsolute(0, 0, display(), [display()])).toEqual({ dx: 0, dy: 0 });
  });

  it('la esquina inferior derecha es 65535', () => {
    // el divisor es (ancho - 1): 65535 mapea al ULTIMO PIXEL, no a "ancho"
    expect(toAbsolute(1, 1, display(), [display()])).toEqual({
      dx: SENDINPUT_MAX,
      dy: SENDINPUT_MAX,
    });
  });

  it('el centro cae en el centro', () => {
    const punto = toAbsolute(0.5, 0.5, display(), [display()]);
    expect(punto.dx).toBeCloseTo(SENDINPUT_MAX / 2, -1);
  });
});

describe('EL CASO QUE ROMPE TODO: escalas mixtas', () => {
  const pantallas = [PORTATIL, EXTERNO];

  it('el centro del PORTATIL cae dentro del portatil, no en el externo', () => {
    const punto = toAbsolute(0.5, 0.5, PORTATIL, pantallas);
    // el portatil ocupa la mitad izquierda de 5760 px fisicos -> su centro
    // esta sobre 1920, que es 1920/5759 del total
    const esperado = Math.round((1920 * SENDINPUT_MAX) / (5760 - 1));
    expect(punto.dx).toBeCloseTo(esperado, -2);
    // y desde luego, por debajo de la mitad del escritorio virtual
    expect(punto.dx).toBeLessThan(SENDINPUT_MAX / 2);
  });

  it('el centro del EXTERNO cae en el externo', () => {
    const punto = toAbsolute(0.5, 0.5, EXTERNO, pantallas);
    // el externo empieza en 3840 fisico y mide 1920 -> su centro esta en 4800
    const esperado = Math.round((4800 * SENDINPUT_MAX) / (5760 - 1));
    expect(punto.dx).toBeCloseTo(esperado, -2);
    expect(punto.dx).toBeGreaterThan(SENDINPUT_MAX / 2);
  });

  it('la esquina izquierda del EXTERNO no es 0: no se solapa con el portatil', () => {
    // el fallo clasico: tratar cada monitor como si empezara en 0
    const punto = toAbsolute(0, 0, EXTERNO, pantallas);
    expect(punto.dx).toBeGreaterThan(SENDINPUT_MAX * 0.6);
  });

  it('la esquina derecha del PORTATIL no llega al final del escritorio', () => {
    const punto = toAbsolute(1, 0, PORTATIL, pantallas);
    expect(punto.dx).toBeLessThan(SENDINPUT_MAX * 0.7);
  });

  it('el portatil ocupa DOS TERCIOS del ancho virtual, no la mitad', () => {
    // en DIPs pareceria 2560 de 4480 (57%). En fisico es 3840 de 5760 (67%).
    // Confundirlos es exactamente el fallo que produce el desplazamiento.
    const derechaPortatil = toAbsolute(1, 0, PORTATIL, pantallas);
    const proporcion = derechaPortatil.dx / SENDINPUT_MAX;
    expect(proporcion).toBeGreaterThan(0.65);
    expect(proporcion).toBeLessThan(0.68);
  });
});

describe('ida y vuelta', () => {
  it('normalizar y desnormalizar devuelve lo mismo', () => {
    for (const valor of [0, 0.25, 0.5, 0.75, 1]) {
      const fisico = toPhysical(PORTATIL);
      const px = fisico.x + valor * (fisico.width - 1);
      const vuelta = toNormalized(px, fisico.y, PORTATIL);
      expect(vuelta.x).toBeCloseTo(valor, 5);
    }
  });
});

describe('entradas hostiles', () => {
  it('una coordenada fuera de rango se acota, no saca el cursor', () => {
    // un cliente comprometido mandaria 5.0 para sacar el cursor del escritorio
    const punto = toAbsolute(5, -3, display(), [display()]);
    expect(punto.dx).toBe(SENDINPUT_MAX);
    expect(punto.dy).toBe(0);
  });

  it('un monitor de 1x1 no divide entre cero', () => {
    const diminuto = display({ bounds: { x: 0, y: 0, width: 1, height: 1 } });
    const punto = toAbsolute(0.5, 0.5, diminuto, [diminuto]);
    expect(Number.isFinite(punto.dx)).toBe(true);
  });
});

describe('eleccion de monitor', () => {
  it('devuelve el pedido', () => {
    expect(resolveMonitor([PORTATIL, EXTERNO], 'externo')?.id).toBe('externo');
  });

  it('un id inventado cae al primario en vez de fallar', () => {
    expect(resolveMonitor([PORTATIL, EXTERNO], 'no-existe')?.id).toBe('portatil');
  });

  it('sin monitores devuelve null', () => {
    expect(resolveMonitor([], null)).toBeNull();
  });

  it('sin primario marcado coge el primero', () => {
    const sinPrimario = [display({ id: 'a', primary: false }), display({ id: 'b', primary: false })];
    expect(resolveMonitor(sinPrimario, null)?.id).toBe('a');
  });
});

describe('descripcion para el cliente', () => {
  it('manda el tamano FISICO, no el DIP', () => {
    // si mandara DIPs, el movil dibujaria una relacion de aspecto que no es
    const descrito = describeMonitors([PORTATIL]);
    expect(descrito[0]).toMatchObject({ width: 3840, height: 2160, scale: 1.5 });
  });

  it('un monitor sin nombre recibe uno', () => {
    const descrito = describeMonitors([display({ label: '' })]);
    expect(descrito[0]?.label).toContain('Monitor');
  });
});

describe('avisos', () => {
  it('avisa de escalas mixtas SIN geometria real, y dice que el cursor caera mal', () => {
    const aproximados = [
      display({ id: 'a', scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 2560, height: 1440 } }),
      display({ id: 'b', scaleFactor: 1, primary: false }),
    ];
    const avisos = monitorWarnings(aproximados);

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('150%');
    // no vale un "puede que": con geometria aproximada, cae mal seguro
    expect(avisos[0]).toContain('caera desplazado');
  });

  it('CON geometria real no avisa de las escalas: ya no importan', () => {
    expect(monitorWarnings([PORTATIL, EXTERNO])).toEqual([]);
  });

  it('no avisa si todas las escalas son iguales', () => {
    expect(monitorWarnings([display({ id: 'a' }), display({ id: 'b' })])).toEqual([]);
  });

  it('avisa de un monitor rotado', () => {
    const avisos = monitorWarnings([display({ rotation: 90 })]);
    expect(avisos.some((a) => a.includes('rotado'))).toBe(true);
  });
});
