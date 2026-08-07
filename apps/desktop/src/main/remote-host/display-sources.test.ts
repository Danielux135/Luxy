// pruebas de la correlacion entre fuentes de captura y monitores.
//
// Los datos de partida NO son inventados: salen de una sonda ejecutada dentro de
// Electron 43 en Windows 11, que devolvio display_id "116357464" para la misma
// pantalla cuyo screen.getAllDisplays().id era 116357464 (numero), y label
// VACIA.
import { describe, it, expect } from 'vitest';
import {
  capturableOnly,
  correlateDisplays,
  sourceForMonitor,
  type CaptureSource,
  type ElectronDisplay,
} from './display-sources.js';

function monitor(overrides: Partial<ElectronDisplay> = {}): ElectronDisplay {
  return {
    id: 116357464,
    label: '',
    bounds: { x: 0, y: 0, width: 1536, height: 864 },
    scaleFactor: 1.25,
    rotation: 0,
    internal: true,
    ...overrides,
  };
}

function fuente(overrides: Partial<CaptureSource> = {}): CaptureSource {
  return {
    id: 'screen:0:0',
    name: 'Toda la pantalla',
    display_id: '116357464',
    ...overrides,
  };
}

describe('correlacion', () => {
  it('une el monitor con su fuente pese a que uno es numero y el otro cadena', () => {
    // si se comparara display.id === source.display_id con ===, seria SIEMPRE
    // false y ningun monitor tendria fuente: la pantalla se veria negra y no
    // habria ningun error que lo explicara
    const [resultado] = correlateDisplays([monitor()], [fuente()], 116357464);

    expect(resultado!.sourceId).toBe('screen:0:0');
    expect(resultado!.id).toBe('116357464');
    expect(resultado!.primary).toBe(true);
  });

  it('cada monitor recibe SU fuente, no la primera', () => {
    const displays = [
      monitor({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
      monitor({ id: 2, internal: false, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }),
    ];
    const sources = [
      fuente({ id: 'screen:1:0', display_id: '2' }),
      fuente({ id: 'screen:0:0', display_id: '1' }),
    ];

    const resultado = correlateDisplays(displays, sources, 1);

    // el orden de las dos listas NO coincide: si se emparejaran por indice, el
    // movil pediria el monitor izquierdo y veria el derecho
    expect(resultado[0]!.sourceId).toBe('screen:0:0');
    expect(resultado[1]!.sourceId).toBe('screen:1:0');
  });

  it('un monitor sin fuente se conserva, con sourceId null', () => {
    // existe y se puede controlar con el raton aunque no se pueda capturar; si
    // se descartara, la conversion de coordenadas perderia su geometria y el
    // escritorio virtual mediria menos de lo que mide
    const resultado = correlateDisplays([monitor({ id: 7 })], [], 7);

    expect(resultado).toHaveLength(1);
    expect(resultado[0]!.sourceId).toBeNull();
  });

  it('una fuente que no es un monitor NO entra en la lista', () => {
    // capturas de ventana y pantallas virtuales de escritorio remoto no tienen
    // bounds; si entraran, romperian toda la geometria
    const resultado = correlateDisplays(
      [monitor()],
      [fuente(), fuente({ id: 'window:123:0', name: 'Bloc de notas', display_id: '' })],
      116357464,
    );

    expect(resultado).toHaveLength(1);
  });

  it('la primaria se decide por el id que da Electron, no por el orden', () => {
    const displays = [monitor({ id: 1 }), monitor({ id: 2 })];
    const resultado = correlateDisplays(displays, [], 2);

    expect(resultado[0]!.primary).toBe(false);
    expect(resultado[1]!.primary).toBe(true);
  });
});

describe('nombre del monitor', () => {
  it('con label vacia se usa el nombre de la fuente', () => {
    // en Windows display.label viene vacia en muchos equipos: comprobado en
    // Electron 43. Sin respaldo, el selector del movil saldria sin texto.
    const [resultado] = correlateDisplays([monitor({ label: '' })], [fuente()], 116357464);
    expect(resultado!.label).toBe('Toda la pantalla');
  });

  it('sin label y sin fuente, la pantalla interna se reconoce', () => {
    const [resultado] = correlateDisplays([monitor({ label: '', internal: true })], [], 1);
    expect(resultado!.label).toBe('Pantalla del portatil');
  });

  it('en el ultimo caso queda un numero, nunca una cadena vacia', () => {
    const resultado = correlateDisplays(
      [monitor({ id: 1, label: '', internal: false }), monitor({ id: 2, label: '  ', internal: false })],
      [],
      1,
    );

    expect(resultado[0]!.label).toBe('Monitor 1');
    expect(resultado[1]!.label).toBe('Monitor 2');
    expect(resultado.every((d) => d.label.trim().length > 0)).toBe(true);
  });

  it('la label de verdad gana sobre todo lo demas', () => {
    const [resultado] = correlateDisplays([monitor({ label: 'Dell U2720Q' })], [fuente()], 116357464);
    expect(resultado!.label).toBe('Dell U2720Q');
  });
});

describe('eleccion de la fuente a capturar', () => {
  const displays = correlateDisplays(
    [
      monitor({ id: 1 }),
      monitor({ id: 2, internal: false }),
      monitor({ id: 3, internal: false }),
    ],
    [fuente({ id: 'screen:0:0', display_id: '1' }), fuente({ id: 'screen:1:0', display_id: '2' })],
    1,
  );

  it('sin monitor pedido se captura el primario', () => {
    expect(sourceForMonitor(displays, null)?.sourceId).toBe('screen:0:0');
  });

  it('un monitor pedido se respeta', () => {
    expect(sourceForMonitor(displays, '2')?.sourceId).toBe('screen:1:0');
  });

  it('un monitor INVENTADO se deniega, no cae al primario', () => {
    // si cayera al primario, un cliente podria pedir un monitor que no existe y
    // acabar viendo una pantalla que el usuario no eligio
    expect(sourceForMonitor(displays, 'no-existe')).toBeNull();
  });

  it('un monitor que existe pero no se puede capturar tambien se deniega', () => {
    expect(sourceForMonitor(displays, '3')).toBeNull();
  });

  it('capturableOnly deja fuera lo que solo mostraria negro', () => {
    expect(capturableOnly(displays).map((d) => d.id)).toEqual(['1', '2']);
  });
});
