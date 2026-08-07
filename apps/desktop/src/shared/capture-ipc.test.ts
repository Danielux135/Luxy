// pruebas del contrato con el renderer oculto.
//
// Lo que se protege aqui no es un formato: es que el renderer oculto -el unico
// componente que habla con el exterior- no pueda pedirle al main mas de lo
// previsto.
import { describe, it, expect } from 'vitest';
import {
  DATA_CHANNEL_LABEL,
  MAX_CONTROL_BYTES,
  channelForMessage,
  channelMatches,
  controlBytes,
  fromCaptureSchema,
  parseFromCapture,
  toCaptureSchema,
  withinControlLimit,
} from './capture-ipc.js';

describe('el renderer oculto NO puede pedir acciones', () => {
  it('un mensaje de control solo puede llevar texto sin interpretar', () => {
    // si el contrato aceptara {type:'mouse.move', x, y}, un renderer
    // comprometido moveria el raton saltandose guardControlMessage, que es la
    // puerta unica donde se comprueban permisos, replay y sesion
    const resultado = parseFromCapture({
      type: 'control',
      channel: 'input',
      raw: '{"v":1,"sid":"s","seq":1,"ts":0,"msg":{"type":"mouse.move","x":0.5,"y":0.5}}',
    });

    expect(resultado.ok).toBe(true);
  });

  it('no existe ningun mensaje que despache entrada directamente', () => {
    for (const inventado of [
      { type: 'mouse.move', x: 0.5, y: 0.5 },
      { type: 'dispatch', message: { type: 'mouse.move', x: 0, y: 0 } },
      { type: 'input', button: 'left' },
    ]) {
      expect(parseFromCapture(inventado).ok, JSON.stringify(inventado)).toBe(false);
    }
  });

  it('el renderer tampoco puede elegir QUE pantalla se captura', () => {
    // sourceId solo viaja del main hacia el renderer. Si el renderer pudiera
    // proponerlo, podria capturar un monitor que el usuario no autorizo.
    expect(parseFromCapture({ type: 'offer', sdp: 'v=0', sourceId: 'screen:1:0' }).ok).toBe(true);
    const analizado = fromCaptureSchema.parse({ type: 'offer', sdp: 'v=0', sourceId: 'screen:1:0' });
    expect('sourceId' in analizado).toBe(false);
  });

  it('un mensaje malformado no lanza: se informa', () => {
    // el main sostiene la aplicacion entera; un renderer que mande basura no
    // puede tumbarlo
    const resultado = parseFromCapture({ type: 'state', state: 'inventado' });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.reason).toContain('state');
  });

  it('el motivo del rechazo NO incluye el valor recibido', () => {
    // puede ser texto del portapapeles del usuario, y esto acaba en un log
    const secreto = 'contrasena-del-usuario-12345';
    const resultado = parseFromCapture({
      type: 'control',
      channel: 'input',
      raw: 123,
      extra: secreto,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.reason).not.toContain(secreto);
  });

  it('null y undefined se rechazan sin romper', () => {
    expect(parseFromCapture(null).ok).toBe(false);
    expect(parseFromCapture(undefined).ok).toBe(false);
    expect(parseFromCapture('texto suelto').ok).toBe(false);
  });
});

describe('limite de tamano del control', () => {
  it('se mide en BYTES UTF-8, no en length', () => {
    // un emoji son 4 bytes y length dice 2: contando por length se podria colar
    // el doble o el triple de lo permitido
    expect(controlBytes('🙂')).toBe(4);
    expect('🙂'.length).toBe(2);
    expect(controlBytes('ñ')).toBe(2);
  });

  it('un mensaje justo en el limite pasa y uno por encima no', () => {
    expect(withinControlLimit('a'.repeat(MAX_CONTROL_BYTES))).toBe(true);
    expect(withinControlLimit('a'.repeat(MAX_CONTROL_BYTES + 1))).toBe(false);
  });

  it('el esquema tambien lo corta, aunque alguien se salte la comprobacion', () => {
    expect(
      parseFromCapture({
        type: 'control',
        channel: 'input',
        raw: 'a'.repeat(MAX_CONTROL_BYTES + 1),
      }).ok,
    ).toBe(false);
  });
});

describe('los dos canales de datos', () => {
  it('solo el raton y la rueda van por el canal NO FIABLE', () => {
    // son los unicos cuya perdida no cambia el resultado: la siguiente posicion
    // absoluta corrige cualquier hueco
    expect(channelForMessage('mouse.move')).toBe('input');
    expect(channelForMessage('mouse.scroll')).toBe('input');
  });

  it('las teclas y los botones van por el canal FIABLE', () => {
    // un canal no ordenado entrega fuera de orden, y acceptEnvelope exige
    // secuencia estrictamente creciente: si llegan 5, 7 y 6, el 6 se rechaza
    // como "replayed". Para un movimiento da igual; para una tecla significa que
    // al usuario le faltan letras, de forma intermitente y solo con mala red.
    for (const tipo of ['key.press', 'key.text', 'mouse.button', 'input.release_all']) {
      expect(channelForMessage(tipo), tipo).toBe('control');
    }
  });

  it('lo que cambia estado NUNCA cae en el canal no fiable', () => {
    for (const tipo of ['monitor.select', 'quality.set', 'algo.futuro']) {
      expect(channelForMessage(tipo), tipo).toBe('control');
    }
  });

  it('un mensaje por el canal equivocado se detecta', () => {
    // que falle en el desarrollo del cliente movil, y no de forma intermitente
    // en produccion con mala red
    expect(channelMatches('key.press', 'input')).toBe(false);
    expect(channelMatches('key.press', 'control')).toBe(true);
    expect(channelMatches('mouse.move', 'input')).toBe(true);
  });

  it('las etiquetas de los dos canales son distintas', () => {
    // si coincidieran, el movil no podria distinguirlos al recibir ondatachannel
    expect(DATA_CHANNEL_LABEL.input).not.toBe(DATA_CHANNEL_LABEL.control);
  });

  it('un canal inventado se rechaza en el contrato', () => {
    expect(parseFromCapture({ type: 'control', channel: 'otro', raw: '{}' }).ok).toBe(false);
    expect(parseFromCapture({ type: 'control', raw: '{}' }).ok).toBe(false);
  });
});

describe('ordenes del main al renderer', () => {
  it('start exige una fuente concreta: no hay "captura lo que quieras"', () => {
    const orden = toCaptureSchema.parse({
      type: 'start',
      sessionId: 'sesion-1',
      sourceId: 'screen:0:0',
      monitorId: '116357464',
      sourceHeight: 1080,
      quality: { preset: 'balanced' },
    });

    expect(orden.type).toBe('start');
    expect(toCaptureSchema.safeParse({ type: 'start', sessionId: 's' }).success).toBe(false);
  });

  it('el audio del sistema esta APAGADO si no se pide', () => {
    // capturar el sonido del equipo sin que el usuario lo haya pedido es una
    // sorpresa desagradable, y en Windows ademas se lleva todo lo que suene
    const orden = toCaptureSchema.parse({
      type: 'start',
      sessionId: 's',
      sourceId: 'screen:0:0',
      monitorId: '1',
      sourceHeight: 1080,
      quality: { preset: 'auto' },
    });

    expect(orden.type === 'start' && orden.audio).toBe(false);
  });

  it('sin servidores ICE la lista queda vacia, no undefined', () => {
    const orden = toCaptureSchema.parse({
      type: 'start',
      sessionId: 's',
      sourceId: 'screen:0:0',
      monitorId: '1',
      sourceHeight: 1080,
      quality: { preset: 'auto' },
    });
    expect(orden.type === 'start' && orden.iceServers).toEqual([]);
  });

  it('un SDP desmesurado se rechaza', () => {
    expect(
      toCaptureSchema.safeParse({ type: 'answer', sdp: 'v'.repeat(64 * 1024 + 1) }).success,
    ).toBe(false);
  });
});
