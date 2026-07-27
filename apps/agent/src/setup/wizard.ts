#!/usr/bin/env node
// asistente de configuracion de una maquina: npm run setup:machine
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  machineNameSchema,
  projectAliasSchema,
  validateProjectPath,
  agentConfigSchema,
} from '@luxy/shared';
import type { AgentConfig, ProjectConfig, ProjectType, TestCommand } from '@luxy/shared';
import { detectEnvironment, describeCapabilities } from '../detect.js';
import { GatewayClient } from '../gateway-client.js';
import { saveConfig, loadProviderKeys, configExists } from '../config.js';
import { configFilePath } from '../paths.js';
import { buildMachineIdentity } from '../agent.js';
import { EXAMPLE_HTTP_PROVIDERS } from '../providers/http-provider.js';
import { isGitRepository } from '../git.js';

/** comandos de comprobacion sugeridos segun el tipo de proyecto */
const DEFAULT_TEST_COMMANDS: Record<ProjectType, TestCommand[]> = {
  flutter: [
    ['flutter', ['analyze']],
    ['flutter', ['test']],
  ],
  node: [
    ['npm', ['run', 'lint']],
    ['npm', ['test']],
    ['npm', ['run', 'build']],
  ],
  python: [['pytest', []]],
  other: [],
};

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  const ask = async (question: string, fallback = ''): Promise<string> => {
    const suffix = fallback ? ` [${fallback}]` : '';
    const answer = (await rl.question(`  ${question}${suffix}: `)).trim();
    return answer.length > 0 ? answer : fallback;
  };

  const askYesNo = async (question: string, fallback: boolean): Promise<boolean> => {
    const answer = (await ask(`${question} (s/n)`, fallback ? 's' : 'n')).toLowerCase();
    return answer.startsWith('s') || answer.startsWith('y');
  };

  try {
    console.log('');
    console.log('  Configuracion de Luxy en esta maquina');
    console.log('  =====================================');
    console.log('');

    if (configExists()) {
      console.log(`  Ya existe configuracion en ${configFilePath()}`);
      if (!(await askYesNo('Quieres sobrescribirla?', false))) {
        console.log('\n  Configuracion cancelada. No se ha cambiado nada.\n');
        return;
      }
      console.log('');
    }

    // -------------------------------------------------------------------------
    // 1. deteccion de herramientas
    // -------------------------------------------------------------------------
    console.log('  Detectando herramientas instaladas...');
    const detection = await detectEnvironment();
    for (const line of describeCapabilities(detection.capabilities)) console.log(line);
    console.log('');

    if (!detection.capabilities.git.available) {
      console.error('  Git no esta disponible. Luxy lo necesita para los worktrees.');
      console.error('  Instalalo desde https://git-scm.com/download/win y vuelve a ejecutar esto.\n');
      process.exitCode = 1;
      return;
    }

    // -------------------------------------------------------------------------
    // 2. identidad de la maquina
    // -------------------------------------------------------------------------
    let machineName = '';
    for (;;) {
      machineName = (await ask('Nombre de esta maquina (casa, portatil, clase...)', 'casa'))
        .toLowerCase();
      const parsed = machineNameSchema.safeParse(machineName);
      if (parsed.success) break;
      console.log(`  ${parsed.error.issues[0]?.message ?? 'nombre no valido'}`);
    }

    const gatewayUrl = await ask('URL del gateway (https://...workers.dev)');
    if (!/^https:\/\//.test(gatewayUrl)) {
      console.error('\n  La URL del gateway debe empezar por https://\n');
      process.exitCode = 1;
      return;
    }

    // -------------------------------------------------------------------------
    // 3. comprobar que el gateway responde ANTES de pedir el secreto
    // -------------------------------------------------------------------------
    console.log('\n  Comprobando el gateway...');
    try {
      const probe = new GatewayClient({ gatewayUrl, machineToken: 'sin-token-todavia' });
      const health = await probe.health();
      console.log(`  Gateway accesible. Configurado: ${health.configured}`);
      if (!health.configured) {
        console.log('  Aviso: al gateway le faltan secretos. Revisa docs/CLOUDFLARE.md.');
      }
    } catch (error) {
      console.error(`  No se pudo contactar con el gateway: ${String(error).slice(0, 200)}`);
      if (!(await askYesNo('Quieres continuar de todas formas?', false))) {
        process.exitCode = 1;
        return;
      }
    }
    console.log('');

    const registrationSecret = await ask('Secreto temporal de registro (MACHINE_REGISTRATION_SECRET)');
    if (registrationSecret.length < 8) {
      console.error('\n  El secreto de registro es demasiado corto.\n');
      process.exitCode = 1;
      return;
    }

    // -------------------------------------------------------------------------
    // 4. proyectos
    // -------------------------------------------------------------------------
    console.log('\n  Proyectos');
    console.log('  ---------');
    console.log('  Cada alias apunta a una ruta LOCAL de este ordenador.');
    console.log('  El PC y el portatil pueden usar rutas distintas para el mismo alias.');
    console.log('  Las rutas no se guardan nunca en el repositorio.\n');

    const projects: Record<string, ProjectConfig> = {};
    for (;;) {
      const alias = (await ask('Alias del proyecto (vacio para terminar)')).toLowerCase();
      if (alias.length === 0) break;

      const aliasParsed = projectAliasSchema.safeParse(alias);
      if (!aliasParsed.success) {
        console.log(`  ${aliasParsed.error.issues[0]?.message ?? 'alias no valido'}\n`);
        continue;
      }

      const path = await ask(`Ruta absoluta de "${alias}"`);
      const problems = validateProjectPath(path);
      if (problems.length > 0) {
        console.log(`  ${problems.join('; ')}\n`);
        continue;
      }
      if (!existsSync(path) || !statSync(path).isDirectory()) {
        console.log(`  La carpeta ${path} no existe en esta maquina.\n`);
        continue;
      }

      const isRepo = await isGitRepository(path);
      if (!isRepo) {
        console.log('  Aviso: no es un repositorio git. Solo se permitiran tareas de lectura.');
        console.log('  Para permitir ediciones: git init && git add -A && git commit -m "inicial"');
      }

      const typeAnswer = (await ask('Tipo (node/flutter/python/other)', 'node')).toLowerCase();
      const type: ProjectType = (['node', 'flutter', 'python', 'other'] as ProjectType[]).includes(
        typeAnswer as ProjectType,
      )
        ? (typeAnswer as ProjectType)
        : 'other';

      const suggested = DEFAULT_TEST_COMMANDS[type];
      console.log(
        `  Comandos de comprobacion sugeridos: ${
          suggested.map(([exe, args]) => `${exe} ${args.join(' ')}`).join(', ') || 'ninguno'
        }`,
      );
      const useSuggested = suggested.length > 0 && (await askYesNo('Usar estos comandos?', true));

      let testCommands: TestCommand[] = useSuggested ? suggested : [];
      if (!useSuggested) {
        console.log('  Introduce los comandos uno a uno (vacio para terminar).');
        console.log('  Ejemplo: npm run build');
        for (;;) {
          const line = await ask('Comando');
          if (line.length === 0) break;
          // se parte por espacios para guardar ejecutable y argumentos separados
          const parts = line.split(/\s+/).filter((part) => part.length > 0);
          const executable = parts.shift();
          if (!executable) continue;
          testCommands = [...testCommands, [executable, parts]];
        }
      }

      const allowEdits = isRepo ? await askYesNo('Permitir que Luxy modifique archivos?', true) : false;
      const allowCommit = allowEdits ? await askYesNo('Permitir commits tras aprobacion?', true) : false;
      // el push esta deshabilitado por defecto, como exige el diseño
      const allowPush = allowCommit
        ? await askYesNo('Permitir push (requiere doble confirmacion)?', false)
        : false;

      projects[alias] = {
        path: resolve(path),
        type,
        testCommands,
        testTimeoutMs: 600_000,
        allowEdits,
        allowCommit,
        allowPush,
      };
      console.log(`  Proyecto "${alias}" configurado.\n`);
    }

    if (Object.keys(projects).length === 0) {
      console.log('  Aviso: no has configurado ningun proyecto. Luxy no podra ejecutar tareas.\n');
    }

    // -------------------------------------------------------------------------
    // 5. proveedores
    // -------------------------------------------------------------------------
    console.log('  Proveedores');
    console.log('  -----------');

    const claudeAvailable = detection.capabilities.claude.available;
    console.log(
      claudeAvailable
        ? `  Claude Code detectado: ${detection.capabilities.claude.version}`
        : '  Claude Code no detectado.',
    );
    const claudeEnabled = claudeAvailable && (await askYesNo('Habilitar Claude Code?', true));
    if (claudeEnabled) {
      console.log('  Recuerda: Claude Code usa la sesion local de tu suscripcion.');
      console.log('  Si nunca has iniciado sesion en este equipo, ejecuta "claude" una vez.');
    }

    const codexAvailable = detection.capabilities.codex.available;
    console.log(
      codexAvailable
        ? `  Codex CLI detectado: ${detection.capabilities.codex.version}`
        : '  Codex CLI no detectado.',
    );
    const codexEnabled = codexAvailable && (await askYesNo('Habilitar Codex CLI?', true));
    if (codexEnabled) {
      console.log('  Recuerda: Codex usa la sesion local de tu cuenta de ChatGPT.');
      console.log('  Si nunca has iniciado sesion en este equipo, ejecuta "codex" una vez.');
    }

    console.log('\n  APIs http (DeepSeek, GLM, Qwen)');
    const keys = loadProviderKeys(resolve(repoRoot(), '.env.providers'));
    const httpProviders = EXAMPLE_HTTP_PROVIDERS.map((provider) => {
      const hasKey = typeof keys[provider.apiKeyEnv] === 'string';
      console.log(
        `  ${provider.displayName}: ${hasKey ? 'clave encontrada' : `sin clave (${provider.apiKeyEnv})`}`,
      );
      return { ...provider, enabled: hasKey };
    });
    console.log('  Las URLs y modelos son PENDIENTES: edita config.json antes de usarlos.');

    const uiEnabled = await askYesNo('\n  Habilitar la interfaz local en 127.0.0.1?', false);

    // -------------------------------------------------------------------------
    // 6. registro de la maquina
    // -------------------------------------------------------------------------
    console.log('\n  Registrando la maquina en el gateway...');
    const identity = buildMachineIdentity();
    let machineToken: string;
    let machineId: string;

    try {
      const registration = await GatewayClient.register(gatewayUrl, {
        registrationSecret,
        name: machineName,
        hostname: identity.hostname,
        platform: identity.platform,
        platformVersion: identity.platformVersion,
        agentVersion: identity.agentVersion,
        capabilities: {
          ...detection.capabilities,
          httpProviders: httpProviders.filter((p) => p.enabled).map((p) => p.id),
        },
        projects: Object.keys(projects),
      });
      machineToken = registration.machineToken;
      machineId = registration.machineId;
      console.log(`  Maquina registrada correctamente como "${registration.name}".`);
    } catch (error) {
      console.error(`\n  El registro fallo: ${String(error).slice(0, 300)}`);
      console.error('  Comprueba el secreto de registro y la URL del gateway.\n');
      process.exitCode = 1;
      return;
    }

    // -------------------------------------------------------------------------
    // 7. guardar
    // -------------------------------------------------------------------------
    const draft: AgentConfig = agentConfigSchema.parse({
      machineName,
      gatewayUrl,
      machineToken,
      machineId,
      pollIntervalMs: 2000,
      heartbeatIntervalMs: 10_000,
      maxConcurrentJobs: 1,
      jobTimeoutMs: 3_600_000,
      leaseSeconds: 120,
      projects,
      providers: {
        claude: { enabled: claudeEnabled, model: 'opus' },
        codex: { enabled: codexEnabled },
        http: httpProviders,
      },
      ui: { enabled: uiEnabled, host: '127.0.0.1', port: 4319 },
    });

    saveConfig(draft);

    console.log('');
    console.log(`  Configuracion guardada en ${configFilePath()}`);
    console.log('  Ese archivo contiene el token de esta maquina: no lo compartas.');
    console.log('');
    console.log('  Siguiente paso: arranca Luxy con');
    console.log('    .\\scripts\\start-luxy.ps1');
    console.log('  o haciendo doble clic en scripts\\start-luxy.cmd');
    console.log('');
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`\n  El asistente fallo: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
