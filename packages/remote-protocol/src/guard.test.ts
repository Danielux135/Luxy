// pruebas de la puerta de entrada del protocolo remoto.
//
// Esto es lo que separa "una herramienta de control remoto" de "una puerta
// trasera". Cada prueba de este archivo corresponde a un escenario del threat
// model (docs/threat-model.md).
import { describe, it, expect } from 'vitest';
import { guardControlMessage, type GuardContext } from './guard.js';
import { newReplayWindow, MAX_MESSAGE_BYTES } from './envelope.js';
import { PROTOCOL_VERSION } from './version.js';
import type { Capability } from './capabilities.js';

const SESION = '11111111-1111-4111-8111-111111111111';
const OTRA_SESION = '22222222-2222-4222-8222-222222222222';

function contexto(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    sessionId: SESION,
    granted: ['view', 'control'] as Capability[],
    window: newReplayWindow(),
    active: true,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

function sobre(msg: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    sid: SESION,
    seq: 1,
    ts: 1_700_000_000_000,
    msg,
    ...overrides,
  });
}

const CLIC = { type: 'mouse.button', button: 'left', action: 'down', x: 0.5, y: 0.5 };

describe('camino feliz', () => {
  it('acepta un mensaje bien formado y con permiso', () => {
    const resultado = guardControlMessage(sobre(CLIC), contexto());
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.message.type).toBe('mouse.button');
  });
});

describe('replay: reinyectar un mensaje capturado', () => {
  it('la misma secuencia dos veces se rechaza la segunda', () => {
    // el ataque concreto: grabar el clic sobre "Aceptar" y reenviarlo
    const ctx = contexto();
    const mensaje = sobre(CLIC);

    expect(guardControlMessage(mensaje, ctx).ok).toBe(true);

    const segunda = guardControlMessage(mensaje, ctx);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.code).toBe('replayed');
  });

  it('una secuencia ANTERIOR tampoco vale', () => {
    const ctx = contexto();
    guardControlMessage(sobre(CLIC, { seq: 10 }), ctx);

    const vieja = guardControlMessage(sobre(CLIC, { seq: 5 }), ctx);
    expect(vieja.ok).toBe(false);
    if (!vieja.ok) expect(vieja.code).toBe('replayed');
  });

  it('secuencias crecientes con huecos SI valen: la red pierde paquetes', () => {
    const ctx = contexto();
    expect(guardControlMessage(sobre(CLIC, { seq: 1 }), ctx).ok).toBe(true);
    expect(guardControlMessage(sobre(CLIC, { seq: 7 }), ctx).ok).toBe(true);
  });

  it('un mensaje INVALIDO no mueve la ventana de secuencias', () => {
    // si la moviera, bastaria bombardear con basura de seq alta para dejar fuera
    // al cliente legitimo
    const ctx = contexto();
    guardControlMessage(sobre(CLIC, { seq: 9999, sid: OTRA_SESION }), ctx);

    expect(ctx.window.lastSeq).toBe(-1);
    expect(guardControlMessage(sobre(CLIC, { seq: 1 }), ctx).ok).toBe(true);
  });
});

describe('sesion', () => {
  it('un mensaje de otra sesion se rechaza', () => {
    const resultado = guardControlMessage(sobre(CLIC, { sid: OTRA_SESION }), contexto());
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('wrong_session');
  });

  it('una sesion ya terminada no ejecuta nada, aunque el mensaje sea perfecto', () => {
    const resultado = guardControlMessage(sobre(CLIC), contexto({ active: false }));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('session_closed');
  });
});

describe('permisos: solo visualizacion', () => {
  const soloVer = () => contexto({ granted: ['view'] as Capability[] });

  it('NO deja mover el raton', () => {
    const resultado = guardControlMessage(sobre({ type: 'mouse.move', x: 0.5, y: 0.5 }), soloVer());
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('not_permitted');
  });

  it('NO deja hacer clic', () => {
    expect(guardControlMessage(sobre(CLIC), soloVer()).ok).toBe(false);
  });

  it('NO deja escribir', () => {
    const escribir = sobre({ type: 'key.text', text: 'hola' });
    expect(guardControlMessage(escribir, soloVer()).ok).toBe(false);
  });

  it('NO deja pulsar teclas especiales', () => {
    const tecla = sobre({ type: 'key.press', key: 'enter', modifiers: ['ctrl'] });
    expect(guardControlMessage(tecla, soloVer()).ok).toBe(false);
  });

  it('SI deja cambiar de monitor y bajar la calidad', () => {
    // no modifican el ordenador: quien mira puede elegir que mira
    const monitor = sobre({ type: 'monitor.select', monitorId: 'screen:0:0' });
    const calidad = sobre({ type: 'quality.set', preset: 'saver' }, { seq: 2 });

    expect(guardControlMessage(monitor, soloVer()).ok).toBe(true);
    const ctx = soloVer();
    guardControlMessage(monitor, ctx);
    expect(guardControlMessage(calidad, ctx).ok).toBe(true);
  });

  it('sin ningun permiso no pasa nada', () => {
    const nada = contexto({ granted: [] as Capability[] });
    expect(guardControlMessage(sobre(CLIC), nada).ok).toBe(false);
  });
});

describe('tamano', () => {
  it('rechaza un mensaje gigante ANTES de parsearlo', () => {
    const enorme = JSON.stringify({
      v: PROTOCOL_VERSION,
      sid: SESION,
      seq: 1,
      ts: 1_700_000_000_000,
      msg: { type: 'key.text', text: 'x'.repeat(MAX_MESSAGE_BYTES) },
    });
    const resultado = guardControlMessage(enorme, contexto());
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('too_large');
  });

  it('mide BYTES, no caracteres', () => {
    // "length" cuenta unidades UTF-16: un emoji cuenta 2 pero ocupa 4 bytes.
    // Validar por length dejaria pasar mensajes bastante mayores que el tope.
    const emojis = '🙂'.repeat(20_000); // 40.000 en length, 80.000 en bytes
    const mensaje = JSON.stringify({
      v: PROTOCOL_VERSION,
      sid: SESION,
      seq: 1,
      ts: 1_700_000_000_000,
      msg: { type: 'key.text', text: emojis },
    });

    expect(mensaje.length).toBeLessThan(MAX_MESSAGE_BYTES * 1.5);
    const resultado = guardControlMessage(mensaje, contexto());
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('too_large');
  });
});

describe('version', () => {
  it('rechaza otra version del protocolo', () => {
    const resultado = guardControlMessage(sobre(CLIC, { v: PROTOCOL_VERSION + 1 }), contexto());
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('bad_version');
  });
});

describe('reloj', () => {
  it('rechaza un mensaje demasiado viejo', () => {
    // capturado hace una hora y reenviado
    const resultado = guardControlMessage(
      sobre(CLIC, { ts: 1_700_000_000_000 - 3_600_000 }),
      contexto(),
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('stale');
  });

  it('rechaza un mensaje del futuro', () => {
    const resultado = guardControlMessage(
      sobre(CLIC, { ts: 1_700_000_000_000 + 3_600_000 }),
      contexto(),
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('stale');
  });

  it('tolera un desfase pequeno: los relojes de los moviles se ajustan', () => {
    const resultado = guardControlMessage(
      sobre(CLIC, { ts: 1_700_000_000_000 - 30_000 }),
      contexto(),
    );
    expect(resultado.ok).toBe(true);
  });
});

describe('forma', () => {
  it('rechaza lo que no es JSON', () => {
    const resultado = guardControlMessage('{roto', contexto());
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('malformed');
  });

  it('rechaza un tipo de mensaje que no existe', () => {
    const inventado = sobre({ type: 'shell.exec', command: 'format c:' });
    const resultado = guardControlMessage(inventado, contexto());
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('malformed');
  });

  it('rechaza coordenadas fuera de rango', () => {
    const fuera = sobre({ type: 'mouse.move', x: 5, y: -2 });
    expect(guardControlMessage(fuera, contexto()).ok).toBe(false);
  });

  it('rechaza un sobre sin secuencia', () => {
    const sin = JSON.stringify({ v: PROTOCOL_VERSION, sid: SESION, ts: 1, msg: CLIC });
    expect(guardControlMessage(sin, contexto()).ok).toBe(false);
  });

  it('el mensaje de error NO filtra el contenido rechazado', () => {
    // zod incluye el valor recibido en algunos errores, y ese valor puede ser
    // texto del portapapeles. Solo debe salir la ruta del campo.
    const secreto = sobre({ type: 'key.text', text: 12345, contrasena: 'hunter2' });
    const resultado = guardControlMessage(secreto, contexto());

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.detail).not.toContain('hunter2');
      expect(resultado.detail).not.toContain('12345');
    }
  });
});
