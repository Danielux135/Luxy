import { describe, it, expect } from 'vitest';
import { routeProvider } from './router.js';
import {
  selectMachine,
  isMachineOnline,
  machineSupportsProvider,
  machineHasProject,
  isLeaseExpired,
  canReassignJob,
} from './machines.js';
import type { Machine, MachineCapabilities } from './types.js';

const AHORA = new Date('2026-07-27T12:00:00.000Z');

function capacidades(overrides: Partial<MachineCapabilities> = {}): MachineCapabilities {
  const presente = { available: true, version: '1.0', path: 'C:/x' };
  const ausente = { available: false, version: null, path: null };
  return {
    git: presente,
    node: presente,
    npm: presente,
    claude: presente,
    codex: presente,
    flutter: ausente,
    httpProviders: [],
    ...overrides,
  };
}

function maquina(overrides: Partial<Machine> = {}): Machine {
  return {
    id: 'id-casa',
    name: 'casa',
    hostname: 'DESKTOP',
    platform: 'win32',
    platformVersion: '10.0.22631',
    agentVersion: '0.1.0',
    capabilities: capacidades(),
    projects: ['errorlux', 'portfolio'],
    // un heartbeat de hace 5 segundos: online
    lastSeenAt: new Date(AHORA.getTime() - 5000).toISOString(),
    enabled: true,
    ...overrides,
  };
}

describe('isMachineOnline', () => {
  it('considera online una maquina con heartbeat reciente', () => {
    expect(isMachineOnline(maquina(), AHORA, 45)).toBe(true);
  });

  it('considera offline una maquina cuyo heartbeat supero la ventana', () => {
    const vieja = maquina({ lastSeenAt: new Date(AHORA.getTime() - 60_000).toISOString() });
    expect(isMachineOnline(vieja, AHORA, 45)).toBe(false);
  });

  it('respeta una ventana configurable distinta', () => {
    const hace30 = maquina({ lastSeenAt: new Date(AHORA.getTime() - 30_000).toISOString() });
    expect(isMachineOnline(hace30, AHORA, 45)).toBe(true);
    expect(isMachineOnline(hace30, AHORA, 10)).toBe(false);
  });

  it('una maquina deshabilitada nunca esta online', () => {
    expect(isMachineOnline(maquina({ enabled: false }), AHORA, 45)).toBe(false);
  });

  it('una maquina que nunca envio heartbeat esta offline', () => {
    expect(isMachineOnline(maquina({ lastSeenAt: null }), AHORA, 45)).toBe(false);
  });

  it('una fecha invalida se trata como offline', () => {
    expect(isMachineOnline(maquina({ lastSeenAt: 'no-es-fecha' }), AHORA, 45)).toBe(false);
  });
});

describe('machineSupportsProvider y machineHasProject', () => {
  it('detecta claude y codex por sus capacidades', () => {
    expect(machineSupportsProvider(maquina(), 'claude')).toBe(true);
    expect(machineSupportsProvider(maquina(), 'codex')).toBe(true);
  });

  it('detecta los proveedores http por la lista declarada', () => {
    const conHttp = maquina({ capabilities: capacidades({ httpProviders: ['deepseek'] }) });
    expect(machineSupportsProvider(conHttp, 'deepseek')).toBe(true);
    expect(machineSupportsProvider(conHttp, 'glm')).toBe(false);
  });

  it('detecta si un alias esta configurado', () => {
    expect(machineHasProject(maquina(), 'errorlux')).toBe(true);
    expect(machineHasProject(maquina(), 'inexistente')).toBe(false);
  });
});

describe('selectMachine', () => {
  const base = {
    provider: 'claude' as const,
    projectAlias: 'errorlux',
    preferredMachineId: null,
    now: AHORA,
    offlineAfterSeconds: 45,
  };

  it('selecciona automaticamente si solo hay una maquina online', () => {
    const result = selectMachine({ ...base, machines: [maquina()] });
    expect(result.kind).toBe('selected');
    if (result.kind === 'selected') expect(result.machine.name).toBe('casa');
  });

  it('usa la maquina preferida cuando hay varias online', () => {
    const casa = maquina();
    const portatil = maquina({ id: 'id-portatil', name: 'portatil' });
    const result = selectMachine({
      ...base,
      machines: [casa, portatil],
      preferredMachineId: 'id-portatil',
    });
    expect(result.kind).toBe('selected');
    if (result.kind === 'selected') expect(result.machine.name).toBe('portatil');
  });

  it('pide elegir con botones si hay varias online y ninguna preferida', () => {
    const result = selectMachine({
      ...base,
      machines: [maquina(), maquina({ id: 'id-portatil', name: 'portatil' })],
    });
    expect(result.kind).toBe('needs_choice');
    if (result.kind === 'needs_choice') expect(result.candidates).toHaveLength(2);
  });

  it('deja el trabajo en cola si no hay ninguna maquina online', () => {
    const offline = maquina({ lastSeenAt: new Date(AHORA.getTime() - 300_000).toISOString() });
    const result = selectMachine({ ...base, machines: [offline] });
    expect(result.kind).toBe('queued');
  });

  it('informa si ninguna maquina tiene el proyecto', () => {
    const result = selectMachine({ ...base, machines: [maquina()], projectAlias: 'inexistente' });
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('inexistente');
  });

  it('informa si el proveedor no esta disponible en ninguna maquina', () => {
    const sinCodex = maquina({
      capabilities: capacidades({ codex: { available: false, version: null, path: null } }),
    });
    const result = selectMachine({ ...base, machines: [sinCodex], provider: 'codex' });
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('codex');
  });

  it('ignora las maquinas deshabilitadas', () => {
    const result = selectMachine({ ...base, machines: [maquina({ enabled: false })] });
    expect(result.kind).toBe('unavailable');
  });

  it('respeta la maquina indicada explicitamente en el comando', () => {
    const result = selectMachine({
      ...base,
      machines: [maquina(), maquina({ id: 'id-portatil', name: 'portatil' })],
      requestedMachineId: 'id-portatil',
    });
    expect(result.kind).toBe('selected');
    if (result.kind === 'selected') expect(result.machine.name).toBe('portatil');
  });

  it('encola contra la maquina pedida si esta desconectada, sin desviar el trabajo', () => {
    const casa = maquina();
    const portatilOffline = maquina({
      id: 'id-portatil',
      name: 'portatil',
      lastSeenAt: new Date(AHORA.getTime() - 300_000).toISOString(),
    });
    const result = selectMachine({
      ...base,
      machines: [casa, portatilOffline],
      requestedMachineId: 'id-portatil',
    });
    // no debe elegir "casa": el usuario pidio el portatil
    expect(result.kind).toBe('queued');
  });

  it('si la maquina preferida esta offline y hay otra online, usa la online', () => {
    const casa = maquina();
    const portatilOffline = maquina({
      id: 'id-portatil',
      name: 'portatil',
      lastSeenAt: new Date(AHORA.getTime() - 300_000).toISOString(),
    });
    const result = selectMachine({
      ...base,
      machines: [casa, portatilOffline],
      preferredMachineId: 'id-portatil',
    });
    expect(result.kind).toBe('selected');
    if (result.kind === 'selected') expect(result.machine.name).toBe('casa');
  });
});

describe('leases', () => {
  it('un lease pasado esta caducado', () => {
    expect(isLeaseExpired(new Date(AHORA.getTime() - 1000).toISOString(), AHORA)).toBe(true);
  });

  it('un lease futuro no esta caducado', () => {
    expect(isLeaseExpired(new Date(AHORA.getTime() + 60_000).toISOString(), AHORA)).toBe(false);
  });

  it('sin lease se considera caducado', () => {
    expect(isLeaseExpired(null, AHORA)).toBe(true);
  });

  it('una fecha invalida se considera caducada', () => {
    expect(isLeaseExpired('no-es-fecha', AHORA)).toBe(true);
  });
});

describe('canReassignJob', () => {
  const caducado = new Date(Date.now() - 60_000).toISOString();

  it('permite reasignar un trabajo reclamado que nunca empezo', () => {
    expect(canReassignJob({ status: 'claimed', leaseExpiresAt: caducado, startedAt: null })).toBe(
      true,
    );
  });

  it('NO reasigna un trabajo que ya habia empezado, para no perder cambios locales', () => {
    expect(
      canReassignJob({
        status: 'claimed',
        leaseExpiresAt: caducado,
        startedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });

  it('NO reasigna un trabajo en ejecucion', () => {
    expect(
      canReassignJob({ status: 'running', leaseExpiresAt: caducado, startedAt: caducado }),
    ).toBe(false);
  });

  it('NO reasigna si el lease sigue vivo', () => {
    const vivo = new Date(Date.now() + 60_000).toISOString();
    expect(canReassignJob({ status: 'claimed', leaseExpiresAt: vivo, startedAt: null })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// regresion: /deepseek acababa en Claude porque el gateway no sabia que la
// maquina tenia esa conexion configurada
// -----------------------------------------------------------------------------
describe('capacidades anunciadas y enrutado explicito', () => {
  const maquina = (httpProviders: string[]): Machine =>
    ({
      id: 'm1',
      name: 'portatil-clase',
      hostname: 'pc',
      platform: 'win32',
      platformVersion: '10',
      agentVersion: '0.1.0',
      lastSeenAt: new Date().toISOString(),
      enabled: true,
      projects: ['test'],
      capabilities: {
        git: { available: true, version: null, path: null },
        node: { available: true, version: null, path: null },
        npm: { available: true, version: null, path: null },
        claude: { available: true, version: null, path: null },
        codex: { available: true, version: null, path: null },
        flutter: { available: false, version: null, path: null },
        httpProviders,
      },
    }) as Machine;

  it('sin capacidades anunciadas, deepseek NO figura como disponible', () => {
    // este era el estado real: registro antiguo, conexion configurada despues
    expect(machineSupportsProvider(maquina([]), 'deepseek')).toBe(false);
  });

  it('anunciando la conexion, deepseek SI figura', () => {
    expect(machineSupportsProvider(maquina(['deepseek']), 'deepseek')).toBe(true);
  });

  it('reconoce tambien las familias nuevas', () => {
    const m = maquina(['deepseek', 'kimi', 'kat', 'minimax', 'step']);
    for (const familia of ['kimi', 'kat', 'minimax', 'step'] as const) {
      expect(machineSupportsProvider(m, familia)).toBe(true);
    }
  });

  it('claude y codex no dependen de httpProviders', () => {
    expect(machineSupportsProvider(maquina([]), 'claude')).toBe(true);
    expect(machineSupportsProvider(maquina([]), 'codex')).toBe(true);
  });
});

describe('sustitucion de un proveedor pedido explicitamente', () => {
  it('si esta disponible, se respeta', () => {
    const d = routeProvider({
      prompt: 'haz un poema',
      availableProviders: ['claude', 'deepseek'],
      explicitProvider: 'deepseek',
    });
    expect(d.provider).toBe('deepseek');
  });

  it('si NO esta disponible, sustituye pero lo marca como no disponible', () => {
    // esto es lo que pasaba con /deepseek: caia en claude
    const d = routeProvider({
      prompt: 'haz un poema',
      availableProviders: ['claude', 'codex'],
      explicitProvider: 'deepseek',
    });
    expect(d.provider).not.toBe('deepseek');
    // la sustitucion tiene que ser detectable por quien llama
    expect(d.unavailable).toContain('deepseek');
    expect(d.reason).toContain('deepseek');
  });
});
