#!/usr/bin/env node
// demostracion local: simula un trabajo completo SIN consumir ninguna API,
// sin credenciales y sin tocar ningun servicio externo.
//
// crea un repositorio git temporal, ejecuta un proveedor simulado que edita un
// archivo, lanza las pruebas del proyecto y recoge el diff.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentConfigSchema } from '@luxy/shared';
import type {
  ClaimedJob,
  ProviderExecution,
  ProviderRunRequest,
  ProviderRunResult,
  ToolPresence,
} from '@luxy/shared';
import { runProcess } from '../process.js';
import { runJob } from '../job-runner.js';
import { AgentLogger } from '../logger.js';

/** proveedor simulado: no llama a ningun modelo, solo edita un archivo */
class MockProvider implements ProviderExecution {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude (simulado)';

  async detect(): Promise<ToolPresence> {
    return { available: true, version: 'mock-1.0', path: '(simulado)' };
  }

  async run(request: ProviderRunRequest): Promise<ProviderRunResult> {
    request.onEvent({ type: 'phase', message: 'leyendo el proyecto' });
    await new Promise((resolve) => setTimeout(resolve, 150));

    request.onEvent({ type: 'phase', message: 'aplicando el cambio' });
    // el cambio se hace DENTRO del worktree, nunca en la carpeta principal
    writeFileSync(
      join(request.workingDirectory, 'saludo.txt'),
      'Hola desde Luxy.\nEste archivo lo creo un proveedor simulado.\n',
      'utf8',
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    request.onEvent({ type: 'phase', message: 'verificando' });

    return {
      ok: true,
      finalText:
        'Se creo saludo.txt con un mensaje de prueba. No se modifico ningun otro archivo.',
      sessionId: 'sesion-simulada-0001',
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      errorMessage: null,
    };
  }
}

async function git(args: string[], cwd: string): Promise<void> {
  const result = await runProcess({ executable: 'git', args, cwd, timeoutMs: 60_000 });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} fallo: ${result.stderr || result.stdout}`);
  }
}

async function main(): Promise<void> {
  console.log('');
  console.log('  Luxy - demostracion local con mocks');
  console.log('  ===================================');
  console.log('');
  console.log('  No se usa ninguna API, ninguna credencial ni ningun servicio externo.');
  console.log('');

  const root = mkdtempSync(join(tmpdir(), 'luxy-demo-'));
  const projectPath = join(root, 'proyecto');
  const worktreesPath = join(root, 'worktrees');
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(worktreesPath, { recursive: true });

  try {
    // 1. repositorio git de prueba
    console.log(`  [1/5] creando un repositorio de prueba en ${projectPath}`);
    await git(['init', '--initial-branch=main'], projectPath);
    await git(['config', 'user.email', 'luxy@example.local'], projectPath);
    await git(['config', 'user.name', 'Luxy Demo'], projectPath);
    writeFileSync(join(projectPath, 'README.md'), '# Proyecto de prueba\n', 'utf8');
    // un comando de comprobacion real que siempre pasa, para ver el flujo entero
    writeFileSync(
      join(projectPath, 'package.json'),
      `${JSON.stringify(
        {
          name: 'proyecto-demo',
          version: '1.0.0',
          private: true,
          scripts: { test: 'node -e "console.log(\'pruebas del proyecto: ok\')"' },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await git(['add', '-A'], projectPath);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'estado inicial'], projectPath);

    // 2. configuracion simulada, validada con el mismo esquema zod real
    console.log('  [2/5] validando una configuracion de ejemplo');
    const config = agentConfigSchema.parse({
      machineName: 'demo',
      gatewayUrl: 'https://luxy-gateway.example.workers.dev',
      machineToken: 'token-simulado-para-la-demostracion',
      projects: {
        demo: {
          path: projectPath,
          type: 'node',
          testCommands: [['npm', ['test']]],
          testTimeoutMs: 120_000,
          allowEdits: true,
          allowCommit: true,
          allowPush: false,
        },
      },
    });

    // 3. trabajo simulado, con la misma forma que el que llega del gateway
    const job: ClaimedJob = {
      id: '00000000-0000-4000-8000-000000000001',
      shortId: 'LUX-DEMO',
      provider: 'claude',
      projectAlias: 'demo',
      prompt: 'Crea un archivo saludo.txt con un mensaje de prueba.',
      telegramChatId: 0,
      telegramUserId: 0,
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      attachment: null,
    metadata: {},
    };

    console.log('  [3/5] ejecutando el trabajo completo');
    console.log('');

    const logger = new AgentLogger('warn', join(root, 'logs'), false);
    const mock = new MockProvider();
    const events: string[] = [];

    const outcome = await runJob(job, new AbortController().signal, {
      config,
      logger,
      getProvider: (id) => (id === 'claude' ? mock : null),
      emit: (type, message) => {
        events.push(`[${type}] ${message}`);
        console.log(`      ${type.padEnd(16)} ${message}`);
      },
      worktreesDirectory: worktreesPath,
      downloadAttachment: () => Promise.reject(new Error('la simulacion no descarga adjuntos')),
      apiKeyFor: () => undefined,
    });

    console.log('');
    console.log('  [4/5] resultado');
    console.log('');

    if (outcome.kind !== 'completed') {
      console.error(`  La demostracion no completo el trabajo: ${JSON.stringify(outcome, null, 2)}`);
      process.exitCode = 1;
      return;
    }

    const result = outcome.result;
    console.log('  ------------------------------------------');
    console.log('  Trabajo terminado');
    console.log('');
    console.log(`  ID: ${job.shortId}`);
    console.log(`  Maquina: ${config.machineName}`);
    console.log(`  Proyecto: ${job.projectAlias}`);
    console.log(`  Agente: ${mock.displayName}`);
    console.log(`  Duracion: ${Math.round(result.durationMs / 1000)}s`);
    console.log('');
    console.log(`  Archivos modificados: ${result.filesChanged}`);
    console.log(`  Pruebas superadas: ${result.testsPassed}`);
    console.log(`  Pruebas fallidas: ${result.testsFailed}`);
    console.log(`  Rama: ${result.branch}`);
    console.log('');
    console.log('  Resumen:');
    console.log(`  ${result.summary.split('\n').join('\n  ')}`);
    console.log('');
    console.log('  Diff:');
    console.log(`  ${(result.diffStat ?? '(sin diff)').split('\n').join('\n  ')}`);
    console.log('  ------------------------------------------');
    console.log('');

    // comprobaciones reales del flujo, no solo impresion por pantalla
    console.log('  [5/5] comprobaciones');
    const checks: Array<[string, boolean]> = [
      ['se creo un worktree aislado', result.worktreePath !== null],
      ['la rama sigue el patron luxy/', (result.branch ?? '').startsWith('luxy/')],
      ['se detecto al menos un archivo modificado', result.filesChanged > 0],
      ['se ejecutaron las pruebas del proyecto', result.testLogs.length > 0],
      ['las pruebas pasaron', result.testsFailed === 0],
      ['se emitieron eventos de progreso', events.length > 0],
    ];

    let allOk = true;
    for (const [label, ok] of checks) {
      console.log(`      ${ok ? 'OK   ' : 'FALLO'} ${label}`);
      if (!ok) allOk = false;
    }
    console.log('');

    if (!allOk) {
      console.error('  La demostracion detecto fallos.\n');
      process.exitCode = 1;
      return;
    }

    console.log('  Demostracion completada sin consumir ninguna API.');
    console.log('');
  } finally {
    // limpieza del temporal, incluidos los worktrees creados
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      console.log(`  (no se pudo limpiar ${root}; borralo a mano si quieres)`);
    }
  }
}

main().catch((error) => {
  console.error(`\n  La demostracion fallo: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
