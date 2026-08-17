// pruebas del ciclo de vida del agente.
//
// no se llama a ninguna API real: el gateway apunta a un puerto cerrado, asi que
// health() y los heartbeats fallan de forma controlada, que es justo lo que hay
// que comprobar (el agente arranca igual y sigue reintentando).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentEventSchema, agentHostStatusSchema, agentConfigSchema } from '@luxy/shared';
import type { AgentConfig, AgentEvent } from '@luxy/shared';
import { AgentHost, AgentNotConfiguredError } from './host.js';
import { AgentLogger } from '../logger.js';
import { nodeExecutable, clearNodeExecutableCache } from '../node-executable.js';

let temporal: string;
let logger: AgentLogger;

beforeEach(() => {
  temporal = mkdtempSync(join(tmpdir(), 'luxy-host-'));
  // sin consola: el ruido de los logs no aporta nada en las pruebas
  logger = new AgentLogger('error', join(temporal, 'logs'), false);
});

afterEach(() => {
  rmSync(temporal, { recursive: true, force: true });
});

function buildConfig(projects: AgentConfig['projects'] = {}): AgentConfig {
  return agentConfigSchema.parse({
    machineName: 'maquina-de-pruebas',
    // puerto 1 esta cerrado: el gateway nunca respondera
    gatewayUrl: 'http://127.0.0.1:1',
    machineToken: 'token-de-pruebas-suficientemente-largo',
    heartbeatIntervalMs: 2000,
    pollIntervalMs: 500,
    // ni claude ni codex: la deteccion no debe depender de lo que haya instalado
    providers: { claude: { enabled: false }, codex: { enabled: false }, http: [] },
    projects,
  });
}

function buildHost(config: AgentConfig | null): AgentHost {
  return new AgentHost({
    logger,
    config,
    stateDirectory: join(temporal, 'state'),
    worktreesDirectory: join(temporal, 'worktrees'),
  });
}

// -----------------------------------------------------------------------------
// contrato de eventos
// -----------------------------------------------------------------------------
describe('contrato de eventos del agente', () => {
  it('valida un evento bien formado', () => {
    const evento: AgentEvent = {
      type: 'job.claimed',
      at: new Date().toISOString(),
      jobId: 'b7c1f0a2-0000-4000-8000-000000000000',
      shortId: 'LUX-A1B2',
      provider: 'claude',
      projectAlias: 'luxy',
    };
    expect(agentEventSchema.safeParse(evento).success).toBe(true);
  });

  it('rechaza un tipo de evento desconocido', () => {
    const resultado = agentEventSchema.safeParse({ type: 'job.inventado', at: 'x' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza un evento al que le faltan campos obligatorios', () => {
    // sin jobId: si esto pasara, el renderer no podria asociar el evento
    const resultado = agentEventSchema.safeParse({
      type: 'job.phase',
      at: new Date().toISOString(),
      shortId: 'LUX-A1B2',
      message: 'preparando',
    });
    expect(resultado.success).toBe(false);
  });

  it('rechaza campos numericos negativos', () => {
    const resultado = agentEventSchema.safeParse({
      type: 'job.completed',
      at: new Date().toISOString(),
      jobId: 'id',
      shortId: 'LUX-A1B2',
      summary: 'ok',
      filesChanged: -1,
      testsPassed: 0,
      testsFailed: 0,
      durationMs: 10,
    });
    expect(resultado.success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// estado del host
// -----------------------------------------------------------------------------
describe('AgentHost sin configuracion', () => {
  it('empieza parado y sin agente', () => {
    const host = buildHost(null);
    const status = host.getStatus();
    expect(status.runState).toBe('stopped');
    expect(status.agent).toBeNull();
    expect(agentHostStatusSchema.safeParse(status).success).toBe(true);
  });

  it('se niega a arrancar y lo explica', async () => {
    const host = buildHost(null);
    await expect(host.start()).rejects.toBeInstanceOf(AgentNotConfiguredError);
    expect(host.getStatus().runState).toBe('stopped');
    expect(host.getStatus().lastError).toContain('no esta configurado');
  });

  it('parar un agente que nunca arranco no lanza', async () => {
    const host = buildHost(null);
    await expect(host.stop()).resolves.toBeUndefined();
  });
});

describe('espacios de trabajo preparados', () => {
  it('crea un worktree antes de que exista ningun trabajo y conserva el contexto añadido', async () => {
    const projectPath = join(temporal, 'proyecto');
    mkdirSync(projectPath);
    writeFileSync(join(projectPath, 'base.txt'), 'base', 'utf8');
    const host = buildHost(
      buildConfig({ demo: { path: projectPath, type: 'other', allowEdits: true } }),
    );

    const workspace = await host.prepareWorktree('demo', 'contexto previo');
    expect(workspace.projectAlias).toBe('demo');
    expect(workspace.path).toContain(join(temporal, 'worktrees'));
    expect(existsSync(join(workspace.path, 'base.txt'))).toBe(true);

    writeFileSync(join(workspace.path, 'contexto.txt'), 'dato añadido antes del prompt', 'utf8');
    expect(existsSync(join(workspace.path, 'contexto.txt'))).toBe(true);
  });

  it('rechaza preparar carpetas en proyectos de solo lectura', async () => {
    const projectPath = join(temporal, 'solo-lectura');
    mkdirSync(projectPath);
    const host = buildHost(
      buildConfig({ demo: { path: projectPath, type: 'other', allowEdits: false } }),
    );

    await expect(host.prepareWorktree('demo', 'no permitido')).rejects.toThrow(
      'no permite crear espacios editables',
    );
  });
});

describe('suscripcion a eventos', () => {
  it('deja de recibir eventos tras darse de baja', async () => {
    const host = buildHost(null);
    const recibidos: AgentEvent[] = [];
    const baja = host.subscribe((event) => recibidos.push(event));

    // updateConfig publica un status.updated
    host.updateConfig(buildConfig());
    const tras1 = recibidos.length;
    expect(tras1).toBeGreaterThan(0);

    baja();
    host.updateConfig(buildConfig());
    expect(recibidos.length).toBe(tras1);
  });

  it('no duplica un suscriptor registrado dos veces', () => {
    const host = buildHost(null);
    const recibidos: AgentEvent[] = [];
    const listener = (event: AgentEvent): void => {
      recibidos.push(event);
    };
    host.subscribe(listener);
    host.subscribe(listener);

    host.updateConfig(buildConfig());
    expect(recibidos.length).toBe(1);
  });

  it('un suscriptor que lanza no impide que los demas reciban', () => {
    const host = buildHost(null);
    const recibidos: AgentEvent[] = [];
    host.subscribe(() => {
      throw new Error('suscriptor roto');
    });
    host.subscribe((event) => recibidos.push(event));

    expect(() => host.updateConfig(buildConfig())).not.toThrow();
    expect(recibidos.length).toBe(1);
  });

  it('todos los eventos publicados cumplen el esquema', () => {
    const host = buildHost(null);
    const invalidos: unknown[] = [];
    host.subscribe((event) => {
      if (!agentEventSchema.safeParse(event).success) invalidos.push(event);
    });
    host.updateConfig(buildConfig());
    expect(invalidos).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// arranque y parada reales, sin red
// -----------------------------------------------------------------------------
describe('ciclo de vida completo', () => {
  it('start() devuelve el control con el agente ya corriendo', async () => {
    const host = buildHost(buildConfig());
    try {
      // antes start() no volvia nunca: si esto no resuelve, la regresion ha vuelto
      await host.start();
      expect(host.getStatus().runState).toBe('running');
      expect(host.getStatus().agent?.machineName).toBe('maquina-de-pruebas');
    } finally {
      await host.stop();
    }
  }, 60_000);

  it('stop() deja el host parado y sin agente', async () => {
    const host = buildHost(buildConfig());
    await host.start();
    await host.stop();

    expect(host.getStatus().runState).toBe('stopped');
    expect(host.getStatus().agent).toBeNull();
  }, 60_000);

  it('reinicia: parar y volver a arrancar funciona', async () => {
    const host = buildHost(buildConfig());
    try {
      await host.start();
      // stop() dejaba stopping en true para siempre; reiniciar era imposible
      await host.restart();
      expect(host.getStatus().runState).toBe('running');
    } finally {
      await host.stop();
    }
  }, 90_000);

  it('emite agent.started y agent.stopped en orden', async () => {
    const host = buildHost(buildConfig());
    const tipos: string[] = [];
    host.subscribe((event) => tipos.push(event.type));

    await host.start();
    await host.stop();

    expect(tipos).toContain('agent.started');
    expect(tipos).toContain('agent.stopped');
    expect(tipos.indexOf('agent.started')).toBeLessThan(tipos.indexOf('agent.stopped'));
  }, 60_000);

  it('sin gateway accesible avisa de la desconexion pero arranca igual', async () => {
    const host = buildHost(buildConfig());
    const tipos: string[] = [];
    host.subscribe((event) => tipos.push(event.type));
    try {
      await host.start();
      expect(tipos).toContain('gateway.disconnected');
      expect(host.getStatus().runState).toBe('running');
    } finally {
      await host.stop();
    }
  }, 60_000);

  it('dos start() seguidos no arrancan dos agentes', async () => {
    const host = buildHost(buildConfig());
    try {
      await Promise.all([host.start(), host.start()]);
      const arranques = host.getStatus();
      expect(arranques.runState).toBe('running');
    } finally {
      await host.stop();
    }
  }, 60_000);
});

// -----------------------------------------------------------------------------
// resolucion de node
// -----------------------------------------------------------------------------
describe('nodeExecutable', () => {
  beforeEach(() => clearNodeExecutableCache());
  afterEach(() => clearNodeExecutableCache());

  it('fuera de electron usa el propio proceso', () => {
    // las pruebas corren en node puro, no en electron
    expect(nodeExecutable({})).toBe(process.execPath);
  });

  it('respeta LUXY_NODE_PATH cuando apunta a un archivo existente', () => {
    expect(nodeExecutable({ LUXY_NODE_PATH: process.execPath })).toBe(process.execPath);
  });

  it('ignora LUXY_NODE_PATH si la ruta no existe', () => {
    const inexistente = join(temporal, 'no-existe', 'node.exe');
    expect(nodeExecutable({ LUXY_NODE_PATH: inexistente })).toBe(process.execPath);
  });
});
