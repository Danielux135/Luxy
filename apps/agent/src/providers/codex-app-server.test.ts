// pruebas del transporte de Codex por app-server.
//
// Lo que se fija aqui son las decisiones que NO se ven al leer el codigo y que
// costaron encontrar leyendo el protocolo:
//
// - el fracaso NO llega en una notificacion propia: viaja dentro de
//   `turn/completed`, y buscar un `turn/failed` que no existe deja al
//   transporte esperando para siempre;
// - el servidor PREGUNTA, con mensajes que llevan `id` y esperan respuesta. Si
//   nadie contesta, el turno se cuelga hasta el timeout y parece que el modelo
//   no responde;
// - `interrupted` no es un fallo: es lo que devuelve al pulsar Detener.
//
// No se lanza ningun proceso ni se gasta ninguna llamada: todo lo de aqui es
// puro, que es justo por lo que estas partes se separaron del spawn.
import { describe, it, expect } from 'vitest';
import {
  buildTurnInput,
  classifyIncoming,
  describeCodexErrorInfo,
  interpretTurn,
} from './codex-app-server.js';

describe('el mensaje que se le manda a Codex', () => {
  it('mete la imagen EN LINEA, como data URI', () => {
    // esta es la razon de existir del transporte entero: sin esto habria que
    // escribir una copia sin cifrar en el disco
    const entrada = buildTurnInput('describe esto', [
      { mimeType: 'image/webp', base64: 'QUJD' },
    ]);
    expect(entrada[0]).toEqual({ type: 'image', url: 'data:image/webp;base64,QUJD' });
  });

  it('el texto va detras de las imagenes, y siempre va', () => {
    const entrada = buildTurnInput('describe esto', [
      { mimeType: 'image/png', base64: 'AAA' },
      { mimeType: 'image/png', base64: 'BBB' },
    ]);
    expect(entrada).toHaveLength(3);
    expect(entrada[2]).toEqual({ type: 'text', text: 'describe esto' });
  });

  it('sin imagenes sigue siendo un turno valido', () => {
    expect(buildTurnInput('hola')).toEqual([{ type: 'text', text: 'hola' }]);
  });

  it('el base64 viaja SIN prefijo por dentro y se le pone aqui', () => {
    // por el resto de Luxy va puro porque cada proveedor lo quiere a su manera;
    // colar el prefijo dos veces da un «imagen corrupta» que no explica nada
    const [imagen] = buildTurnInput('x', [{ mimeType: 'image/jpeg', base64: 'ZZZ' }]);
    expect(imagen).toEqual({ type: 'image', url: 'data:image/jpeg;base64,ZZZ' });
  });
});

describe('clasificar lo que llega por la tuberia', () => {
  it('distingue una PREGUNTA del servidor de un aviso', () => {
    // la distincion que evita que el turno se cuelgue: con `id` hay que
    // contestar, sin `id` no
    expect(classifyIncoming({ id: 7, method: 'item/tool/call' })).toEqual({
      kind: 'request',
      id: 7,
      method: 'item/tool/call',
    });
    expect(classifyIncoming({ method: 'turn/started', params: { a: 1 } })).toEqual({
      kind: 'notification',
      method: 'turn/started',
      params: { a: 1 },
    });
  });

  it('una respuesta y un error se reconocen por su id', () => {
    expect(classifyIncoming({ id: 3, result: { ok: true } })).toEqual({
      kind: 'response',
      id: 3,
      result: { ok: true },
    });
    expect(classifyIncoming({ id: 4, error: { code: -1, message: 'no' } })).toEqual({
      kind: 'error',
      id: 4,
      message: 'no',
    });
  });

  it('NO usa `jsonrpc` para decidir: el protocolo ni lo declara', () => {
    const sinCampo = classifyIncoming({ method: 'warning', params: {} });
    const conCampo = classifyIncoming({ jsonrpc: '2.0', method: 'warning', params: {} });
    expect(conCampo).toEqual(sinCampo);
  });

  it('una notificacion sin params se trata como si los tuviera vacios', () => {
    // asi quien la lee no tiene que comprobar si existen antes de mirarlos
    expect(classifyIncoming({ method: 'initialized' })).toEqual({
      kind: 'notification',
      method: 'initialized',
      params: {},
    });
  });

  it('lo que no encaja se ignora en vez de romper el turno', () => {
    expect(classifyIncoming(null).kind).toBe('ignored');
    expect(classifyIncoming('una linea suelta').kind).toBe('ignored');
    expect(classifyIncoming({ nada: 1 }).kind).toBe('ignored');
  });
});

describe('como acabo el turno', () => {
  it('completado es exito', () => {
    expect(interpretTurn({ status: 'completed' })).toMatchObject({
      ok: true,
      errorMessage: null,
    });
  });

  it('INTERRUMPIDO no es un fallo: es que alguien pulso Detener', () => {
    // contarlo como error haria que la pantalla pidiera reintentar algo que el
    // usuario acababa de parar a proposito
    const salida = interpretTurn({ status: 'interrupted' });
    expect(salida.ok).toBe(false);
    expect(salida.errorMessage).toBeNull();
  });

  it('el fracaso viaja DENTRO del turno, no en una notificacion aparte', () => {
    const salida = interpretTurn({
      status: 'failed',
      error: { message: 'algo paso', codexErrorInfo: 'usageLimitExceeded' },
    });
    expect(salida.ok).toBe(false);
    // el motivo traducido Y el original: uno dice que hacer, el otro es la
    // prueba de lo que dijo el servidor
    expect(salida.errorMessage).toContain('limite de uso');
    expect(salida.errorMessage).toContain('algo paso');
  });

  it('un turno sin status reconocible se cuenta como fallo, no como exito', () => {
    // ante la duda, lo caro es dar por buena una respuesta que no lo era
    expect(interpretTurn({}).ok).toBe(false);
    expect(interpretTurn(null).ok).toBe(false);
  });

  it('nunca devuelve contenido en el motivo de final: solo el estado', () => {
    // `finishReason` acaba en los registros, y ahi no puede ir texto del modelo
    expect(interpretTurn({ status: 'completed' }).finishReason).toBe('completed');
    expect(interpretTurn({ status: 'interrupted' }).finishReason).toBe('interrupted');
  });
});

describe('traducir el codigo de error de Codex', () => {
  it('dice QUE HACER, no solo que paso', () => {
    expect(describeCodexErrorInfo('unauthorized')).toContain('codex');
    expect(describeCodexErrorInfo('usageLimitExceeded')).toContain('espera');
  });

  it('entiende tambien la forma de objeto', () => {
    // el corte del flujo a mitad de turno es el caso que NO se debe reintentar
    // si ya habia texto: repetirlo tira lo generado y vuelve a pagar el prompt
    expect(describeCodexErrorInfo({ responseStreamDisconnected: {} })).toContain('se corto');
  });

  it('un codigo que no conoce no se inventa una traduccion', () => {
    expect(describeCodexErrorInfo('algoNuevoQueNoExistia')).toBeNull();
    expect(describeCodexErrorInfo(undefined)).toBeNull();
  });
});
