#!/usr/bin/env node
// punto de entrada del agente local de Luxy.
//
// esta es la herramienta avanzada y de recuperacion. el flujo normal es Luxy
// Desktop, que usa exactamente el mismo AgentHost: lo que cambia es quien lo
// controla, no como arranca.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { AgentHost } from './runtime/host.js';
import { AgentLogger, describeError } from './logger.js';
import { loadConfig, loadProviderKeys, ConfigError } from './config.js';
import { configFilePath, logsDir } from './paths.js';
import { startUiServer } from './ui-server.js';

/** raiz del repositorio, a partir de la ubicacion de este archivo compilado */
function repoRoot(): string {
  // dist/index.js -> apps/agent/dist -> apps/agent -> apps -> raiz
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

async function main(): Promise<void> {
  const logger = new AgentLogger('info', logsDir());

  console.log('');
  console.log('  Luxy - agente local');
  console.log('  ------------------');
  console.log('');

  // 1 y 2. cargar y validar la configuracion con zod
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n  ${error.message}\n`);
      if (error.hint) console.error(`  ${error.hint}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  logger.info(`configuracion cargada desde ${configFilePath()}`);

  // las claves de las apis http se leen del archivo local, nunca del repositorio
  const providerKeys = loadProviderKeys(resolve(repoRoot(), '.env.providers'));
  if (Object.keys(providerKeys).length > 0) {
    logger.info(`claves de API cargadas: ${Object.keys(providerKeys).join(', ')}`);
  }

  const host = new AgentHost({ logger, config, providerKeys });

  // interfaz local opcional, solo si esta habilitada en la configuracion
  let uiServer: Server | null = null;
  if (config.ui.enabled) {
    uiServer = startUiServer({
      host: config.ui.host,
      port: config.ui.port,
      agent: { getStatus: () => host.getStatus().agent },
      logger,
      onStopRequested: () => {
        logger.info('parada solicitada desde la interfaz local');
        void shutdown('interfaz local');
      },
    });
  }

  // 20. cierre limpio con Ctrl+C
  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  deteniendo Luxy (${reason})...`);
    try {
      await host.stop(reason);
      uiServer?.close();
    } catch (error) {
      logger.error('error durante el apagado', describeError(error));
    }
    console.log('  Luxy detenido.\n');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('Ctrl+C'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // en windows Ctrl+C llega tambien por este evento cuando hay consola
  process.on('SIGBREAK', () => void shutdown('SIGBREAK'));

  // un fallo no capturado no debe dejar procesos hijos huerfanos
  process.on('uncaughtException', (error) => {
    logger.error('excepcion no capturada', describeError(error));
    void shutdown('excepcion no capturada');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('promesa rechazada sin capturar', describeError(reason));
  });

  console.log(`  maquina: ${config.machineName}`);
  console.log(`  gateway: ${config.gatewayUrl}`);
  console.log(`  proyectos: ${Object.keys(config.projects).join(', ') || 'ninguno'}`);
  console.log(`  logs: ${logger.logFile}`);
  console.log('');
  console.log('  Pulsa Ctrl+C para detener Luxy.');
  console.log('');

  await host.start();
  // start() ya devuelve el control; la CLI se queda esperando aqui
  await host.waitUntilStopped();
}

main().catch((error) => {
  console.error('\n  Luxy no pudo arrancar:');
  console.error(`  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
