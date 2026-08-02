// pruebas del despacho de entrada.
//
// LO QUE MAS IMPORTA: que no quede nada pulsado. SendInput no reinicia el
// teclado, asi que un corte de red con Ctrl hundido deja la tecla pegada y el
// ordenador haciendo cosas raras sin que el usuario sepa por que.
import { describe, it, expect, beforeEach } from 'vitest';
import { InputDispatcher, describeElevatedBlock, type InputBackend } from './input-dispatcher.js';
import { SENDINPUT_MAX, type DisplayInfo } from './monitors.js';
import type { ControlMessage } from '@luxy/remote-protocol';

function display(overrides: Partial<DisplayInfo> = {}): DisplayInfo {
  return {
    id: 'principal',
    label: 'Principal',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    primary: true,
    rotation: 0,
    physical: { x: 0, y: 0, width: 1920, height: 1080 },
    ...overrides,
  };
}

const SEGUNDO = display({
  id: 'segundo',
  primary: false,
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  physical: { x: 1920, y: 0, width: 1920, height: 1080 },
});

/** backend que registra todo lo que se le pide */
function backendFalso(): InputBackend & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    llamadas,
    moveTo: (p) => llamadas.push(`move ${p.dx},${p.dy}`),
    mouseButton: (b, a) => llamadas.push(`${b} ${a}`),
    scroll: (_p, dx, dy) => llamadas.push(`scroll ${dx},${dy}`),
    keyDown: (k) => llamadas.push(`down ${k}`),
    keyUp: (k) => llamadas.push(`up ${k}`),
    typeText: (t) => llamadas.push(`text ${t}`),
  };
}

let backend: ReturnType<typeof backendFalso>;
let dispatcher: InputDispatcher;

beforeEach(() => {
  backend = backendFalso();
  dispatcher = new InputDispatcher(backend, [display(), SEGUNDO]);
});

function mensaje(m: ControlMessage): ControlMessage {
  return m;
}

describe('raton', () => {
  it('mover traduce a coordenadas absolutas', () => {
    dispatcher.dispatch(mensaje({ type: 'mouse.move', x: 0, y: 0 }));
    expect(backend.llamadas[0]).toBe('move 0,0');
  });

  it('un clic completo no deja nada pulsado', () => {
    dispatcher.dispatch(mensaje({ type: 'mouse.button', button: 'left', action: 'down', x: 0.5, y: 0.5 }));
    expect(dispatcher.pressedCount()).toBe(1);

    dispatcher.dispatch(mensaje({ type: 'mouse.button', button: 'left', action: 'up', x: 0.5, y: 0.5 }));
    expect(dispatcher.pressedCount()).toBe(0);
  });

  it('el scroll pasa los dos ejes', () => {
    dispatcher.dispatch(mensaje({ type: 'mouse.scroll', x: 0.5, y: 0.5, dx: 0, dy: -3 }));
    expect(backend.llamadas[0]).toBe('scroll 0,-3');
  });
});

describe('LO QUE NO PUEDE QUEDAR PULSADO', () => {
  it('un arrastre interrumpido deja el boton pulsado... hasta releaseAll', () => {
    // el caso real: se cae el canal a mitad de arrastrar una ventana
    dispatcher.dispatch(mensaje({ type: 'mouse.button', button: 'left', action: 'down', x: 0.2, y: 0.2 }));
    dispatcher.dispatch(mensaje({ type: 'mouse.move', x: 0.5, y: 0.5 }));
    expect(dispatcher.pressedCount()).toBe(1);

    dispatcher.releaseAll();

    expect(dispatcher.pressedCount()).toBe(0);
    expect(backend.llamadas).toContain('left up');
  });

  it('releaseAll NO mueve el cursor: suelta sin punto', () => {
    // soltar a ciegas no sabe donde esta el cursor. Si se pasara {dx:0,dy:0},
    // cortar la sesion con un boton pulsado teletransportaria el cursor del
    // usuario a la esquina superior izquierda de su pantalla.
    const puntos: Array<unknown> = [];
    const espia = backendFalso();
    espia.mouseButton = (_b, _a, p) => puntos.push(p);
    const d = new InputDispatcher(espia, [display()]);

    d.dispatch(mensaje({ type: 'mouse.button', button: 'left', action: 'down', x: 0.5, y: 0.5 }));
    d.releaseAll();

    expect(puntos[puntos.length - 1]).toBeNull();
  });

  it('releaseAll suelta VARIOS botones', () => {
    for (const boton of ['left', 'right', 'middle'] as const) {
      dispatcher.dispatch(mensaje({ type: 'mouse.button', button: boton, action: 'down', x: 0.5, y: 0.5 }));
    }
    expect(dispatcher.pressedCount()).toBe(3);

    dispatcher.releaseAll();
    expect(dispatcher.pressedCount()).toBe(0);
  });

  it('el mensaje input.release_all del cliente tambien suelta', () => {
    dispatcher.dispatch(mensaje({ type: 'mouse.button', button: 'left', action: 'down', x: 0.5, y: 0.5 }));
    dispatcher.dispatch(mensaje({ type: 'input.release_all' }));
    expect(dispatcher.pressedCount()).toBe(0);
  });

  it('si el backend FALLA al soltar, se sigue con lo demas', () => {
    // si lanzara y se cortara, la primera tecla que fallara dejaria las demas
    // pulsadas para siempre
    const roto = backendFalso();
    let intentos = 0;
    roto.mouseButton = () => {
      intentos += 1;
      throw new Error('SendInput fallo');
    };
    const d = new InputDispatcher(roto, [display()]);

    d.dispatch(mensaje({ type: 'mouse.button', button: 'left', action: 'down', x: 0.5, y: 0.5 }));
    d.dispatch(mensaje({ type: 'mouse.button', button: 'right', action: 'down', x: 0.5, y: 0.5 }));

    expect(() => d.releaseAll()).not.toThrow();
    expect(d.pressedCount()).toBe(0);
    // se intento soltar los dos, no solo el primero
    expect(intentos).toBeGreaterThanOrEqual(4);
  });

  it('el estado se registra ANTES de llamar al backend', () => {
    // si la llamada nativa falla, el boton tiene que quedar registrado para que
    // releaseAll lo suelte. Al reves se quedaria pulsado sin que nadie lo supiera.
    const roto = backendFalso();
    roto.mouseButton = () => {
      throw new Error('fallo');
    };
    const d = new InputDispatcher(roto, [display()]);

    const resultado = d.dispatch(
      mensaje({ type: 'mouse.button', button: 'left', action: 'down', x: 0.5, y: 0.5 }),
    );

    expect(resultado.ok).toBe(false);
    expect(d.pressedCount()).toBe(1);
  });

  it('un fallo de la capa nativa NO tumba la sesion: se informa', () => {
    // si dispatch propagara, un solo clic fallido cortaria la conexion por nada
    const roto = backendFalso();
    roto.moveTo = () => {
      throw new Error('SendInput fallo');
    };
    const d = new InputDispatcher(roto, [display()]);

    const resultado = d.dispatch(mensaje({ type: 'mouse.move', x: 0.5, y: 0.5 }));

    expect(resultado.ok).toBe(false);
    expect(resultado.reason).toContain('SendInput');
  });
});

describe('teclado', () => {
  it('una combinacion pulsa y suelta todo', () => {
    dispatcher.dispatch(mensaje({ type: 'key.press', key: 'f4', modifiers: ['alt'] }));

    expect(backend.llamadas).toEqual(['down alt', 'down f4', 'up f4', 'up alt']);
    expect(dispatcher.pressedCount()).toBe(0);
  });

  it('los modificadores se sueltan en ORDEN INVERSO', () => {
    // es lo que hace un teclado real; soltarlos en el mismo orden deja
    // combinaciones intermedias que algunas aplicaciones interpretan
    dispatcher.dispatch(mensaje({ type: 'key.press', key: 't', modifiers: ['ctrl', 'shift'] } as never));

    const soltados = backend.llamadas.filter((l) => l.startsWith('up '));
    expect(soltados).toEqual(['up t', 'up shift', 'up ctrl']);
  });

  it('el texto va por su propio camino', () => {
    // KEYEVENTF_UNICODE, que no sirve para modificadores ni atajos
    dispatcher.dispatch(mensaje({ type: 'key.text', text: 'año 🙂' }));
    expect(backend.llamadas[0]).toBe('text año 🙂');
  });
});

describe('monitores', () => {
  it('cambiar de monitor mueve el origen de las coordenadas', () => {
    const antes = dispatcher.dispatch(mensaje({ type: 'mouse.move', x: 0, y: 0 }));
    expect(antes.ok).toBe(true);
    expect(backend.llamadas[0]).toBe('move 0,0');

    dispatcher.dispatch(mensaje({ type: 'monitor.select', monitorId: 'segundo' }));
    dispatcher.dispatch(mensaje({ type: 'mouse.move', x: 0, y: 0 }));

    // la esquina del segundo monitor NO es 0: esta a la derecha
    const ultima = backend.llamadas[backend.llamadas.length - 1]!;
    const dx = Number(ultima.replace('move ', '').split(',')[0]);
    expect(dx).toBeGreaterThan(SENDINPUT_MAX * 0.4);
  });

  it('elegir un monitor que no existe se rechaza', () => {
    const resultado = dispatcher.dispatch(mensaje({ type: 'monitor.select', monitorId: 'no-existe' }));
    expect(resultado.ok).toBe(false);
    expect(resultado.reason).toContain('ya no existe');
  });

  it('si el monitor elegido DESAPARECE se vuelve al primario', () => {
    // desconectar un monitor a mitad de sesion no debe dejar el cursor apuntando
    // a la nada
    dispatcher.dispatch(mensaje({ type: 'monitor.select', monitorId: 'segundo' }));
    expect(dispatcher.currentMonitorId()).toBe('segundo');

    dispatcher.updateDisplays([display()]);

    expect(dispatcher.currentMonitorId()).toBeNull();
    expect(dispatcher.dispatch(mensaje({ type: 'mouse.move', x: 0, y: 0 })).ok).toBe(true);
  });

  it('sin monitores no se despacha nada', () => {
    dispatcher.updateDisplays([]);
    const resultado = dispatcher.dispatch(mensaje({ type: 'mouse.move', x: 0.5, y: 0.5 }));

    expect(resultado.ok).toBe(false);
    expect(resultado.reason).toContain('monitor');
  });
});

describe('el fallo silencioso de UIPI', () => {
  it('una ventana elevada se explica, en vez de parecer que Luxy no funciona', () => {
    // SendInput devuelve exito y no pasa nada. La documentacion de Microsoft:
    // "neither GetLastError nor the return value will indicate the failure"
    const aviso = describeElevatedBlock({ title: 'Administrador de tareas', elevated: true });

    expect(aviso).not.toBeNull();
    expect(aviso).toContain('Administrador de tareas');
    expect(aviso).toContain('administrador');
    // y se dice que NO es culpa de Luxy
    expect(aviso).toContain('No es un fallo de Luxy');
  });

  it('una ventana normal no genera aviso', () => {
    expect(describeElevatedBlock({ title: 'Bloc de notas', elevated: false })).toBeNull();
    expect(describeElevatedBlock(null)).toBeNull();
  });

  it('sin titulo el aviso sigue siendo util', () => {
    const aviso = describeElevatedBlock({ title: '   ', elevated: true });
    expect(aviso).toContain('la ventana activa');
  });
});
