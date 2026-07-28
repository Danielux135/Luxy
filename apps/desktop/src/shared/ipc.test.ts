// pruebas del contrato IPC y del protocolo con el proceso del agente.
//
// no arrancan Electron: comprueban las invariantes que se pueden romper sin
// darse cuenta al editar el contrato, que son justo las de seguridad.
import { describe, it, expect } from 'vitest';
import { agentEventSchema, hostRequestSchema, hostResponseSchema } from '@luxy/shared';
import {
  IPC_EVENT,
  IPC_INVOKE,
  appInfoSchema,
  emptyArgsSchema,
  logsTailArgsSchema,
  pickFolderArgsSchema,
  stopAgentArgsSchema,
} from './ipc.js';

describe('canales IPC', () => {
  it('todos los canales llevan el prefijo luxy:', () => {
    for (const channel of [...Object.values(IPC_INVOKE), ...Object.values(IPC_EVENT)]) {
      expect(channel.startsWith('luxy:')).toBe(true);
    }
  });

  it('no hay dos canales con el mismo nombre', () => {
    const todos = [...Object.values(IPC_INVOKE), ...Object.values(IPC_EVENT)];
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('ningun canal expone un verbo abierto', () => {
    // un canal tipo exec/run/eval reintroduciria por IPC lo que el ejecutor de
    // pruebas bloquea con su lista blanca
    const prohibidos = ['exec', 'run', 'eval', 'spawn', 'shell', 'command', 'write-file'];
    for (const channel of Object.values(IPC_INVOKE)) {
      for (const prohibido of prohibidos) {
        expect(channel.toLowerCase()).not.toContain(prohibido);
      }
    }
  });
});

describe('validacion de argumentos', () => {
  it('acepta la ausencia de argumentos donde no hacen falta', () => {
    for (const entrada of [undefined, null, {}]) {
      expect(emptyArgsSchema.safeParse(entrada).success).toBe(true);
    }
  });

  it('rechaza argumentos inesperados en los canales sin parametros', () => {
    expect(emptyArgsSchema.safeParse({ inyectado: true }).success).toBe(false);
  });

  it('aplica valores por defecto sensatos', () => {
    expect(logsTailArgsSchema.parse({}).count).toBe(120);
    expect(stopAgentArgsSchema.parse({}).reason.length).toBeGreaterThan(0);
    expect(pickFolderArgsSchema.parse({}).title.length).toBeGreaterThan(0);
  });

  it('acota el numero de lineas de log que puede pedir el renderer', () => {
    expect(logsTailArgsSchema.safeParse({ count: 0 }).success).toBe(false);
    expect(logsTailArgsSchema.safeParse({ count: 100_000 }).success).toBe(false);
    expect(logsTailArgsSchema.safeParse({ count: 500 }).success).toBe(true);
  });

  it('acota la longitud de los textos que llegan del renderer', () => {
    expect(stopAgentArgsSchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(false);
    expect(pickFolderArgsSchema.safeParse({ title: 'x'.repeat(500) }).success).toBe(false);
  });
});

describe('informacion de la aplicacion', () => {
  it('no incluye ningun campo que pueda contener un secreto', () => {
    const campos = Object.keys(appInfoSchema.shape);
    for (const campo of campos) {
      expect(/key|token|secret|password|clave/i.test(campo)).toBe(false);
    }
  });

  it('solo dice si el cifrado esta disponible, nunca una clave', () => {
    const info = appInfoSchema.parse({
      appVersion: '0.1.0',
      electronVersion: '43.2.0',
      nodeVersion: '22.0.0',
      platform: 'win32',
      logsDirectory: 'C:\\datos\\logs',
      encryptionAvailable: true,
    });
    expect(typeof info.encryptionAvailable).toBe('boolean');
  });
});

describe('protocolo con el proceso del agente', () => {
  it('acepta una orden bien formada', () => {
    expect(hostRequestSchema.safeParse({ type: 'start', requestId: 'abc' }).success).toBe(true);
  });

  it('rechaza una orden desconocida', () => {
    expect(hostRequestSchema.safeParse({ type: 'ejecutar', requestId: 'abc' }).success).toBe(false);
  });

  it('rechaza una orden sin identificador de peticion', () => {
    // sin requestId la respuesta no se podria correlacionar y quedaria colgada
    expect(hostRequestSchema.safeParse({ type: 'start' }).success).toBe(false);
  });

  it('acota el motivo de parada', () => {
    const largo = { type: 'stop', requestId: 'a', reason: 'x'.repeat(500) };
    expect(hostRequestSchema.safeParse(largo).success).toBe(false);
  });

  it('valida las respuestas del agente', () => {
    expect(hostResponseSchema.safeParse({ type: 'ready' }).success).toBe(true);
    expect(
      hostResponseSchema.safeParse({
        type: 'ack',
        requestId: 'a',
        ok: true,
        error: null,
        status: { runState: 'running', agent: null, lastError: null },
      }).success,
    ).toBe(true);
  });

  it('rechaza una respuesta con un estado de ejecucion invalido', () => {
    expect(
      hostResponseSchema.safeParse({
        type: 'ack',
        requestId: 'a',
        ok: true,
        error: null,
        status: { runState: 'explotando', agent: null, lastError: null },
      }).success,
    ).toBe(false);
  });

  it('rechaza un evento que no cumple el contrato', () => {
    expect(hostResponseSchema.safeParse({ type: 'event', event: { type: 'raro' } }).success).toBe(
      false,
    );
  });

  it('deja pasar un evento valido', () => {
    const evento = { type: 'gateway.connected', at: new Date().toISOString() };
    expect(agentEventSchema.safeParse(evento).success).toBe(true);
    expect(hostResponseSchema.safeParse({ type: 'event', event: evento }).success).toBe(true);
  });
});
