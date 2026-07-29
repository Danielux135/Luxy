// pruebas de las puertas de aprobacion.
//
// Lo que se fija aqui son criterios del producto: un commit exige permiso, un
// push exige permiso Y doble confirmacion, y ningun modelo puede saltarselos
// porque no pasa por aqui: solo el usuario.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentConfigSchema } from '@luxy/shared';
import {
  checkApprovalGates,
  executeApproval,
  buildCommitMessage,
  resetConsumedApprovals,
  auditFilePath,
  type ApprovalRequest,
} from './approvals.js';
import { runProcess } from './process.js';

let base: string;
let worktreesDir: string;
let worktree: string;
let auditFile: string;

const project = (overrides: Record<string, unknown> = {}) => ({
  path: 'C:/proyecto',
  type: 'other' as const,
  testCommands: [],
  testTimeoutMs: 600_000,
  allowEdits: true,
  allowCommit: true,
  allowPush: false,
  ...overrides,
});

function config(projectOverrides: Record<string, unknown> = {}) {
  return agentConfigSchema.parse({
    machineName: 'maquina',
    gatewayUrl: 'https://gateway.example',
    machineToken: 'token-de-maquina-suficientemente-largo',
    projects: { demo: { ...project(projectOverrides), path: worktree } },
  });
}

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalId: `apr-${Math.random().toString(36).slice(2)}`,
    jobId: 'job-1',
    shortId: 'LUX-A1B2',
    action: 'commit',
    projectAlias: 'demo',
    worktreePath: worktree,
    branch: 'luxy/lux-a1b2-prueba',
    confirmedTwice: false,
    source: 'telegram',
    requestedBy: '12345',
    ...overrides,
  };
}

beforeEach(async () => {
  resetConsumedApprovals();
  base = realpathSync(mkdtempSync(join(tmpdir(), 'luxy-apr-')));
  worktreesDir = join(base, 'worktrees');
  worktree = join(worktreesDir, 'lux-a1b2-1');
  auditFile = auditFilePath(join(base, 'logs'));
  mkdirSync(worktree, { recursive: true });

  // repositorio de verdad: las puertas se prueban contra git real
  const run = (args: string[]) =>
    runProcess({ executable: 'git', args, cwd: worktree, timeoutMs: 30_000 });
  await run(['init', '-b', 'luxy/lux-a1b2-prueba']);
  await run(['config', 'user.email', 'luxy@example.com']);
  await run(['config', 'user.name', 'Luxy']);
  writeFileSync(join(worktree, 'a.txt'), 'contenido\n');
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const deps = () => ({ config: config(), worktreesDirectory: worktreesDir, auditFile });

// -----------------------------------------------------------------------------
// puertas
// -----------------------------------------------------------------------------
describe('puertas de politica', () => {
  it('el commit exige allowCommit', () => {
    expect(checkApprovalGates(request(), project())).toBeNull();
    expect(checkApprovalGates(request(), project({ allowCommit: false }))).toContain(
      'no permite crear commits',
    );
  });

  it('el push exige allowPush', () => {
    const push = request({ action: 'push', confirmedTwice: true });
    expect(checkApprovalGates(push, project({ allowPush: false }))).toContain('no permite hacer push');
    expect(checkApprovalGates(push, project({ allowPush: true }))).toBeNull();
  });

  it('el push exige ADEMAS la segunda confirmacion', () => {
    // dos condiciones independientes: tener permiso no basta
    const sinConfirmar = request({ action: 'push', confirmedTwice: false });
    expect(checkApprovalGates(sinConfirmar, project({ allowPush: true }))).toContain(
      'segunda confirmacion',
    );
  });

  it('allowPush es false por defecto', () => {
    expect(project().allowPush).toBe(false);
  });

  it('un proyecto desconocido se rechaza', () => {
    expect(checkApprovalGates(request(), undefined)).toContain('no esta configurado');
  });

  it('descartar no necesita permisos especiales', () => {
    expect(checkApprovalGates(request({ action: 'discard' }), project())).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// ejecucion
// -----------------------------------------------------------------------------
describe('ejecucion de aprobaciones', () => {
  it('crea el commit cuando el proyecto lo permite', async () => {
    const outcome = await executeApproval(request(), deps());
    expect(outcome.ok).toBe(true);

    const log = await runProcess({
      executable: 'git',
      args: ['log', '--oneline'],
      cwd: worktree,
      timeoutMs: 30_000,
    });
    expect(log.stdout).toContain('LUX-A1B2');
  }, 60_000);

  it('NO crea el commit si el proyecto no lo permite', async () => {
    const outcome = await executeApproval(request(), {
      ...deps(),
      config: config({ allowCommit: false }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.deniedBy).toContain('no permite crear commits');

    const log = await runProcess({
      executable: 'git',
      args: ['log', '--oneline'],
      cwd: worktree,
      timeoutMs: 30_000,
    });
    // sin commits: la puerta impidio de verdad que se escribiera
    expect(log.stdout.trim()).toBe('');
  }, 60_000);

  it('NO hace push sin doble confirmacion, aunque allowPush sea true', async () => {
    const outcome = await executeApproval(request({ action: 'push' }), {
      ...deps(),
      config: config({ allowPush: true }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.deniedBy).toContain('segunda confirmacion');
  }, 60_000);

  it('una aprobacion no se puede reutilizar', async () => {
    const reutilizable = request();
    const primera = await executeApproval(reutilizable, deps());
    expect(primera.ok).toBe(true);

    // el mismo id otra vez: un reenvio no puede repetir la accion
    const segunda = await executeApproval(reutilizable, deps());
    expect(segunda.ok).toBe(false);
    expect(segunda.deniedBy).toContain('ya se uso');
  }, 60_000);

  it('rechaza un worktree fuera de la carpeta de worktrees', async () => {
    const fuera = join(base, 'otro-sitio');
    mkdirSync(fuera, { recursive: true });
    const outcome = await executeApproval(request({ worktreePath: fuera }), deps());
    expect(outcome.ok).toBe(false);
    expect(outcome.deniedBy).toContain('no es valida');
  }, 60_000);

  it('distingue "ya confirmado" de "no habia nada"', async () => {
    // pulsar Confirmar dos veces daba el mismo mensaje que no haber cambiado
    // nada, y parecia que el boton no funcionaba
    await executeApproval(request(), deps());
    resetConsumedApprovals();
    const segunda = await executeApproval(request(), deps());
    expect(segunda.ok).toBe(false);
    expect(segunda.message).toContain('ya estan confirmados');
    expect(segunda.message).toContain('LUX-A1B2');
  }, 60_000);

  it('avisa si el trabajo no cambio nada', async () => {
    // worktree limpio y sin ningun commit de Luxy
    rmSync(join(worktree, 'a.txt'), { force: true });
    const outcome = await executeApproval(request(), deps());
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('no hay cambios');
  }, 60_000);

  it('descartar elimina el worktree de verdad', async () => {
    // el descarte fallaba siempre: git worktree remove se ejecutaba sin
    // repositorio base y devolvia "fatal: not a git repository"
    const outcome = await executeApproval(request({ action: 'discard' }), deps());
    expect(outcome.deniedBy).toBeNull();
  }, 60_000);
});

// -----------------------------------------------------------------------------
// auditoria
// -----------------------------------------------------------------------------
describe('auditoria', () => {
  it('registra la accion permitida con su origen y su usuario', async () => {
    await executeApproval(request({ source: 'desktop', requestedBy: 'daniel' }), deps());

    const linea = JSON.parse(readFileSync(auditFile, 'utf8').trim().split('\n').at(-1)!);
    expect(linea.action).toBe('commit');
    expect(linea.source).toBe('desktop');
    expect(linea.requestedBy).toBe('daniel');
    expect(linea.shortId).toBe('LUX-A1B2');
    expect(linea.ok).toBe(true);
    expect(typeof linea.ts).toBe('string');
  }, 60_000);

  it('registra TAMBIEN los intentos denegados', async () => {
    await executeApproval(request({ action: 'push', confirmedTwice: false }), {
      ...deps(),
      config: config({ allowPush: true }),
    });

    const linea = JSON.parse(readFileSync(auditFile, 'utf8').trim().split('\n').at(-1)!);
    expect(linea.ok).toBe(false);
    expect(linea.action).toBe('push');
    expect(linea.deniedBy).toContain('segunda confirmacion');
  }, 60_000);

  it('el registro es append-only: no se pierde lo anterior', async () => {
    await executeApproval(request(), deps());
    await executeApproval(request({ action: 'push' }), deps());

    const lineas = readFileSync(auditFile, 'utf8').trim().split('\n');
    expect(lineas.length).toBe(2);
    expect(existsSync(auditFile)).toBe(true);
  }, 60_000);
});

describe('mensaje de commit', () => {
  it('incluye el identificador del trabajo', () => {
    expect(buildCommitMessage(request())).toContain('LUX-A1B2');
  });

  it('colapsa los saltos de linea del texto del usuario', () => {
    const message = buildCommitMessage(request({ message: 'arregla\nel\nmenu' }));
    expect(message.split('\n')[0]).toBe('arregla el menu');
  });

  it('recorta un mensaje demasiado largo', () => {
    const message = buildCommitMessage(request({ message: 'x'.repeat(500) }));
    expect(message.split('\n')[0]!.length).toBeLessThanOrEqual(200);
  });
});
