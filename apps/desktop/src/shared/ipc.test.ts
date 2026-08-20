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
  approvalResolveArgsSchema,
  connectionTestArgsSchema,
  worktreeOpenFolderArgsSchema,
  studioJobActionArgsSchema,
  studioJobsListArgsSchema,
  workspaceOpenArgsSchema,
  workspacePrepareArgsSchema,
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

  it('valida la pagina del historial que puede pedir el renderer', () => {
    expect(studioJobsListArgsSchema.parse({ limit: 100, offset: 200 })).toMatchObject({
      limit: 100,
      offset: 200,
    });
    expect(studioJobsListArgsSchema.safeParse({ limit: 101, offset: 0 }).success).toBe(false);
    expect(studioJobsListArgsSchema.safeParse({ limit: 100, offset: -1 }).success).toBe(false);
  });

  it('acota la longitud de los textos que llegan del renderer', () => {
    expect(stopAgentArgsSchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(false);
    expect(pickFolderArgsSchema.safeParse({ title: 'x'.repeat(500) }).success).toBe(false);
  });

  it('valida las rutas cerradas para abrir y preparar worktrees', () => {
    expect(
      worktreeOpenFolderArgsSchema.safeParse({ worktreePath: 'C:/Luxy/worktrees/lux-1' }).success,
    ).toBe(true);
    expect(worktreeOpenFolderArgsSchema.safeParse({ worktreePath: '' }).success).toBe(false);
    expect(worktreeOpenFolderArgsSchema.safeParse({ worktreePath: 'x'.repeat(2000) }).success).toBe(
      false,
    );
    expect(
      workspacePrepareArgsSchema.safeParse({ projectAlias: 'luxy', label: 'mi espacio' }).success,
    ).toBe(true);
    expect(workspacePrepareArgsSchema.safeParse({ projectAlias: '', label: '' }).success).toBe(
      false,
    );
    expect(workspaceOpenArgsSchema.safeParse({ path: 'C:/Luxy/worktrees/uno' }).success).toBe(true);
  });

  it('la prueba de conexion no admite una URL elegida por el renderer', () => {
    expect(connectionTestArgsSchema.safeParse({ connectionId: 'default' }).success).toBe(true);
    expect(
      connectionTestArgsSchema.safeParse({
        connectionId: 'default',
        baseUrl: 'https://atacante.example',
      }).success,
    ).toBe(false);
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
      agentBuild: 'a1b2c3d4e5f6@2026-07-29T11:00',
    });
    expect(typeof info.encryptionAvailable).toBe('boolean');
    // la huella identifica que build del agente corre, no es un secreto
    expect(info.agentBuild).not.toMatch(/sk-|token/i);
  });

  it('expone la huella del agente para detectar una instalacion vieja', () => {
    // se añadio despues de regenerar el instalador sin reinstalarlo: la
    // aplicacion seguia con el agente antiguo y el fallo "arreglado" volvia
    expect(Object.keys(appInfoSchema.shape)).toContain('agentBuild');
    const sinArrancar = appInfoSchema.parse({
      appVersion: '0.1.0',
      electronVersion: '43.2.0',
      nodeVersion: '22.0.0',
      platform: 'win32',
      logsDirectory: 'C:/datos/logs',
      encryptionAvailable: true,
      agentBuild: null,
    });
    expect(sinArrancar.agentBuild).toBeNull();
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

  it('transporta el worktree preparado en el ack correlacionado', () => {
    expect(
      hostResponseSchema.safeParse({
        type: 'ack',
        requestId: 'preparar-1',
        ok: true,
        error: null,
        status: null,
        workspace: {
          projectAlias: 'luxy',
          path: 'C:/Luxy/worktrees/uno',
          branch: 'luxy/lux-abcd-mi-espacio',
        },
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

describe('aprobaciones desde el escritorio', () => {
  it('acepta una peticion bien formada', () => {
    const parsed = approvalResolveArgsSchema.safeParse({
      jobId: 'job-1',
      shortId: 'LUX-A1B2',
      action: 'commit',
      projectAlias: 'demo',
      worktreePath: 'C:/datos/worktrees/lux-a1b2',
      branch: 'luxy/lux-a1b2-x',
    });
    expect(parsed.success).toBe(true);
    // por defecto NO hay doble confirmacion: el push tendra que pedirla
    expect(parsed.data?.confirmedTwice).toBe(false);
  });

  it('rechaza una accion que no existe', () => {
    expect(
      approvalResolveArgsSchema.safeParse({
        jobId: 'j',
        shortId: 's',
        action: 'force_push',
        projectAlias: 'demo',
        worktreePath: 'C:/x',
        branch: 'b',
      }).success,
    ).toBe(false);
  });

  it('acota las rutas y los textos que llegan del renderer', () => {
    const base = {
      jobId: 'j',
      shortId: 's',
      action: 'commit' as const,
      projectAlias: 'demo',
      branch: 'b',
    };
    expect(
      approvalResolveArgsSchema.safeParse({ ...base, worktreePath: 'x'.repeat(2000) }).success,
    ).toBe(false);
    expect(
      approvalResolveArgsSchema.safeParse({
        ...base,
        worktreePath: 'C:/x',
        message: 'y'.repeat(1000),
      }).success,
    ).toBe(false);
  });
});

describe('decisiones desde Studio', () => {
  const jobId = '11111111-1111-4111-8111-111111111111';

  it('exige confirmacion explicita para aplicar o descartar', () => {
    expect(
      studioJobActionArgsSchema.safeParse({ jobId, action: 'commit', confirmed: true }).success,
    ).toBe(true);
    expect(
      studioJobActionArgsSchema.safeParse({ jobId, action: 'discard', confirmed: false }).success,
    ).toBe(false);
  });

  it('no expone push en el contrato de Studio', () => {
    expect(
      studioJobActionArgsSchema.safeParse({ jobId, action: 'push', confirmed: true }).success,
    ).toBe(false);
  });
});

describe('protocolo de aprobacion con el agente', () => {
  it('el mensaje de aprobacion cumple el contrato del host', () => {
    expect(
      hostRequestSchema.safeParse({
        type: 'approval',
        requestId: 'r1',
        approval: {
          jobId: 'j',
          shortId: 'LUX-1',
          action: 'push',
          projectAlias: 'demo',
          worktreePath: 'C:/wt',
          branch: 'luxy/x',
          confirmedTwice: true,
        },
      }).success,
    ).toBe(true);
  });

  it('rechaza una aprobacion sin worktree', () => {
    expect(
      hostRequestSchema.safeParse({
        type: 'approval',
        requestId: 'r1',
        approval: { jobId: 'j', shortId: 's', action: 'commit', projectAlias: 'demo', branch: 'b' },
      }).success,
    ).toBe(false);
  });

  it('el evento de aprobacion resuelta cumple el contrato', () => {
    expect(
      agentEventSchema.safeParse({
        type: 'approval.resolved',
        at: new Date().toISOString(),
        jobId: 'j',
        shortId: 'LUX-1',
        action: 'commit',
        ok: true,
        message: 'commit creado',
      }).success,
    ).toBe(true);
  });

  it('job.completed lleva worktree y rama para poder aprobar', () => {
    // sin ellos, el escritorio no sabria sobre que actuar
    const evento = {
      type: 'job.completed',
      at: new Date().toISOString(),
      jobId: 'j',
      shortId: 'LUX-1',
      summary: 'hecho',
      filesChanged: 2,
      testsPassed: 3,
      testsFailed: 0,
      durationMs: 100,
      worktreePath: 'C:/wt',
      branch: 'luxy/x',
      projectAlias: 'demo',
    };
    expect(agentEventSchema.safeParse(evento).success).toBe(true);
    const { worktreePath: _sin, ...incompleto } = evento;
    expect(agentEventSchema.safeParse(incompleto).success).toBe(false);
  });
});
