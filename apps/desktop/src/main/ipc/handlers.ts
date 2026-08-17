// registro de los canales IPC.
//
// cada handler valida sus argumentos con zod antes de tocar nada y devuelve un
// resultado uniforme. Al renderer nunca le llega una traza ni un secreto: solo
// un mensaje pensado para leerse, y una pista de que hacer.
import { type BrowserWindow, dialog, ipcMain, safeStorage, shell, app } from 'electron';
import { readFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { z } from 'zod';
import {
  redact,
  storedAgentConfigSchema,
  secretRegistry,
  buildCatalogSnapshot,
  isPathInside,
} from '@luxy/shared';
import { detectEnvironment } from '@luxy/agent/dist/detect.js';
import { GatewayClient } from '@luxy/agent/dist/gateway-client.js';
import { buildMachineIdentity } from '@luxy/agent/dist/agent.js';
import { worktreesDir } from '@luxy/agent/dist/paths.js';
import type { StoredAgentConfig } from '@luxy/shared';
import {
  IPC_INVOKE,
  artifactOpenFolderArgsSchema,
  catalogRefreshArgsSchema,
  configSaveArgsSchema,
  emptyArgsSchema,
  logsTailArgsSchema,
  migrationDeleteFileArgsSchema,
  migrationImportArgsSchema,
  connectionTestArgsSchema,
  approvalResolveArgsSchema,
  workspacePrepareArgsSchema,
  workspaceOpenArgsSchema,
  studioJobCreateArgsSchema,
  studioJobFeedbackArgsSchema,
  studioJobActionArgsSchema,
  studioJobIdArgsSchema,
  studioJobsListArgsSchema,
  gatewayCheckArgsSchema,
  machineRegisterArgsSchema,
  pickFolderArgsSchema,
  secretDeleteArgsSchema,
  secretSetArgsSchema,
  stopAgentArgsSchema,
  type IpcResult,
} from '../../shared/ipc.js';
import type { AgentController } from '../agent-controller.js';
import { secretsToInvalidateForConfigChange, type ConfigStore } from '../config-store.js';
import type { SecretStore } from '../secure-storage.js';
import { MACHINE_TOKEN_SECRET, connectionSecretName } from '../../shared/ipc.js';
import { deleteMigratedFile, inspectEnvFile, readEnvSecrets } from '../migration.js';
import { readCatalogSnapshot, writeCatalogSnapshot } from '../catalog-store.js';

export interface HandlerContext {
  controller: AgentController;
  configStore: ConfigStore;
  secretStore: SecretStore;
  logsDirectory: string;
  /** raiz de los artefactos generados; se abre, nunca se sirve por HTTP */
  artifactsDirectory: string;
  /** donde se guarda el catalogo real leido de cada pasarela */
  catalogDirectory: string;
  /** archivos en claro donde pueden quedar secretos de versiones anteriores */
  migrationCandidateFiles: string[];
  getMainWindow: () => BrowserWindow | null;
  log: (message: string, fields?: Record<string, unknown>) => void;
  /** vuelve a cargar configuracion y secretos y se los pasa al agente */
  reconfigureAgent: () => Promise<void>;
}

/** convierte cualquier fallo en algo que se puede enseñar sin filtrar nada */
function toFailure(error: unknown): IpcResult<never> {
  const hint =
    typeof error === 'object' && error !== null && 'hint' in error
      ? ((error as { hint?: unknown }).hint ?? null)
      : null;
  return {
    ok: false,
    error: redact(error instanceof Error ? error.message : String(error)),
    hint: typeof hint === 'string' ? redact(hint) : null,
  };
}

/**
 * envuelve un handler con validacion de argumentos.
 *
 * ipcMain.handle sobreescribe silenciosamente un canal ya registrado, asi que
 * se comprueba antes: un canal duplicado seria un bug muy dificil de ver.
 */
function handle<S extends z.ZodTypeAny, T>(
  channel: string,
  schema: S,
  handler: (args: z.infer<S>) => Promise<T> | T,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_event, rawArgs: unknown): Promise<IpcResult<T>> => {
    const parsed = schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return { ok: false, error: 'la peticion no es valida', hint: null };
    }
    try {
      return { ok: true, value: await handler(parsed.data) };
    } catch (error) {
      return toFailure(error);
    }
  });
}

/** ultimas lineas del log. ya salen redactadas del logger del agente */
function tailLogFile(directory: string, count: number): string[] {
  const file = join(directory, 'luxy.log');
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf8');
  return content
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(-count);
}

/**
 * resumen de secretos que SI puede ver el renderer.
 *
 * solo nombres y booleanos. Esta funcion es la unica puerta por la que el
 * estado de los secretos sale del proceso principal, y no devuelve valores.
 */
function summarizeSecrets(store: SecretStore): {
  encryptionAvailable: boolean;
  configured: Record<string, boolean>;
} {
  const encryptionAvailable = store.isEncryptionAvailable();
  const configured: Record<string, boolean> = {};
  if (encryptionAvailable) {
    for (const name of store.listNames()) configured[name] = true;
  }
  return { encryptionAvailable, configured };
}

/** quita el token de la configuracion antes de enviarla al renderer */
function sanitizeConfig(config: StoredAgentConfig | null): unknown {
  if (config === null) return null;
  const { machineToken: _oculto, ...resto } = config;
  return resto;
}

/** cliente autenticado para Studio; el token nunca sale del proceso principal */
function studioClient(context: HandlerContext): GatewayClient {
  const stored = context.configStore.load();
  if (stored === null) throw new Error('Luxy no esta configurado en esta maquina');

  const token = context.secretStore.get(MACHINE_TOKEN_SECRET) ?? stored.machineToken;
  if (token === undefined) {
    throw new Error('falta el token de maquina; vuelve a registrar esta instalacion');
  }
  return new GatewayClient({ gatewayUrl: stored.gatewayUrl, machineToken: token });
}

export function registerIpcHandlers(context: HandlerContext): void {
  handle(IPC_INVOKE.appInfo, emptyArgsSchema, () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'desconocida',
    nodeVersion: process.versions.node,
    platform: process.platform,
    logsDirectory: context.logsDirectory,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    agentBuild: context.controller.getAgentBuild(),
  }));

  handle(IPC_INVOKE.agentStatus, emptyArgsSchema, () => context.controller.getStatus());

  handle(IPC_INVOKE.agentStart, emptyArgsSchema, async () => {
    context.log('arranque del agente solicitado desde la interfaz');
    return context.controller.start();
  });

  handle(IPC_INVOKE.agentStop, stopAgentArgsSchema, async (args) => {
    context.log('parada del agente solicitada desde la interfaz');
    return context.controller.stop(args.reason);
  });

  handle(IPC_INVOKE.agentRestart, emptyArgsSchema, async () => {
    context.log('reinicio del agente solicitado desde la interfaz');
    return context.controller.restart();
  });

  handle(IPC_INVOKE.logsTail, logsTailArgsSchema, (args) => ({
    lines: tailLogFile(context.logsDirectory, args.count),
  }));

  handle(IPC_INVOKE.logsOpenFolder, emptyArgsSchema, async () => {
    mkdirSync(context.logsDirectory, { recursive: true });
    const error = await shell.openPath(context.logsDirectory);
    if (error.length > 0) throw new Error(`no se pudo abrir la carpeta de registros: ${error}`);
    return { opened: true };
  });

  handle(IPC_INVOKE.artifactOpenFolder, artifactOpenFolderArgsSchema, async (args) => {
    // la raiz la pone el proceso principal y el identificador ya viene validado
    // por el esquema: el renderer no puede pedir que se abra una ruta suya
    const directory = join(context.artifactsDirectory, args.jobId);
    if (!existsSync(directory)) {
      throw new Error('ese trabajo no dejo ningun archivo en esta maquina');
    }
    const error = await shell.openPath(directory);
    if (error.length > 0) throw new Error(`no se pudo abrir la carpeta: ${error}`);
    return { opened: true };
  });

  handle(IPC_INVOKE.pickFolder, pickFolderArgsSchema, async (args) => {
    const window = context.getMainWindow();
    const options = {
      title: args.title,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] as const,
    };
    const result =
      window === null
        ? await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
        : await dialog.showOpenDialog(window, { ...options, properties: [...options.properties] });

    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null),
    };
  });

  // ---------------------------------------------------------------------------
  // configuracion y secretos
  // ---------------------------------------------------------------------------

  handle(IPC_INVOKE.configGet, emptyArgsSchema, () => ({
    configured: context.configStore.exists(),
    configPath: context.configStore.path,
    config: sanitizeConfig(context.configStore.load()),
    secrets: summarizeSecrets(context.secretStore),
  }));

  handle(IPC_INVOKE.configSave, configSaveArgsSchema, async (args) => {
    // el renderer envia un objeto cualquiera: se valida antes de escribirlo
    const parsed = storedAgentConfigSchema.safeParse(args.config);
    if (!parsed.success) {
      const detalle = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`)
        .join('; ');
      throw new Error(`la configuracion no es valida (${detalle})`);
    }

    // Una clave queda ligada al endpoint que estaba guardado cuando se
    // introdujo. Si el renderer cambia el servidor conservando el mismo id, se
    // elimina ANTES de guardar la configuracion nueva para impedir exfiltrarla.
    const previous = context.configStore.load();
    for (const secretName of secretsToInvalidateForConfigChange(previous, parsed.data)) {
      context.secretStore.delete(secretName);
      context.log('secreto invalidado por cambio de endpoint', { name: secretName });
    }

    // si trae un token (por ejemplo recien registrado), va al almacen cifrado y
    // NO al archivo: ConfigStore.save lo elimina de todas formas
    if (parsed.data.machineToken !== undefined) {
      context.secretStore.set(MACHINE_TOKEN_SECRET, parsed.data.machineToken);
    }

    context.configStore.save(parsed.data);
    await context.reconfigureAgent();

    return {
      configured: true,
      configPath: context.configStore.path,
      config: sanitizeConfig(context.configStore.load()),
      secrets: summarizeSecrets(context.secretStore),
    };
  });

  handle(IPC_INVOKE.secretSet, secretSetArgsSchema, async (args) => {
    context.secretStore.set(args.name, args.value);
    // no se registra el nombre con su valor en ningun log
    context.log('secreto guardado', { name: args.name });
    await context.reconfigureAgent();
    return summarizeSecrets(context.secretStore);
  });

  handle(IPC_INVOKE.secretDelete, secretDeleteArgsSchema, async (args) => {
    context.secretStore.delete(args.name);
    context.log('secreto eliminado', { name: args.name });
    await context.reconfigureAgent();
    return summarizeSecrets(context.secretStore);
  });

  // ---------------------------------------------------------------------------
  // migracion de secretos en claro
  // ---------------------------------------------------------------------------

  handle(IPC_INVOKE.migrationScan, emptyArgsSchema, () => {
    const candidates = context.migrationCandidateFiles
      .map((file) => inspectEnvFile(file))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
    return { candidates };
  });

  handle(IPC_INVOKE.migrationImport, migrationImportArgsSchema, async (args) => {
    // el archivo TIENE que ser uno de los que Luxy propuso. Sin esto, el
    // renderer podria pedir la importacion de cualquier archivo del disco con
    // forma CLAVE=valor y despues exfiltrarlo probando la conexion.
    if (!context.migrationCandidateFiles.includes(args.file)) {
      throw new Error('ese archivo no esta en la lista de candidatos de migracion');
    }
    // el valor se lee AQUI, en el proceso principal: nunca pasa por el renderer
    const values = readEnvSecrets(args.file, args.names);
    if (Object.keys(values).length === 0) {
      throw new Error('no se encontro ninguna de las claves indicadas en ese archivo');
    }

    for (const [name, value] of Object.entries(values)) {
      // una clave de API se guarda bajo su conexion; el resto, con su nombre
      const target = args.connectionId === null ? name : connectionSecretName(args.connectionId);
      context.secretStore.set(target, value);
    }
    context.log('claves importadas al almacen cifrado', { total: Object.keys(values).length });
    await context.reconfigureAgent();
    return summarizeSecrets(context.secretStore);
  });

  handle(IPC_INVOKE.migrationDeleteFile, migrationDeleteFileArgsSchema, (args) => {
    // solo se borra un archivo que Luxy propuso: nunca una ruta arbitraria
    if (!context.migrationCandidateFiles.includes(args.file)) {
      throw new Error('ese archivo no esta en la lista de candidatos de migracion');
    }
    // y solo si de verdad hay algo guardado en el almacen cifrado
    const deleted = deleteMigratedFile(args.file, () => context.secretStore.listNames().length > 0);
    return { deleted };
  });

  // ---------------------------------------------------------------------------
  // onboarding
  // ---------------------------------------------------------------------------

  handle(IPC_INVOKE.toolsDetect, emptyArgsSchema, async () => {
    // se reutiliza la deteccion del agente: una sola definicion de "disponible"
    const detection = await detectEnvironment([]);
    return { tools: detection.capabilities as unknown as Record<string, unknown> };
  });

  handle(IPC_INVOKE.gatewayCheck, gatewayCheckArgsSchema, async (args) => {
    try {
      const client = new GatewayClient({ gatewayUrl: args.gatewayUrl, machineToken: '' });
      const health = await client.health();
      return { reachable: true, configured: health.configured, error: null };
    } catch (error) {
      return {
        reachable: false,
        configured: null,
        error: redact(error instanceof Error ? error.message : String(error)),
      };
    }
  });

  handle(IPC_INVOKE.machineRegister, machineRegisterArgsSchema, async (args) => {
    // el secreto de registro se usa aqui y se descarta: no se guarda en
    // config.json ni en secrets.enc, porque solo sirve una vez
    secretRegistry.add(args.registrationSecret);

    // se anuncian las herramientas realmente detectadas, no una lista fija
    const detection = await detectEnvironment([]);
    const response = await GatewayClient.register(args.gatewayUrl, {
      registrationSecret: args.registrationSecret,
      name: args.machineName,
      ...buildMachineIdentity(),
      capabilities: detection.capabilities,
      projects: Object.keys(context.configStore.load()?.projects ?? {}),
    });

    // el token SI se guarda, y solo cifrado
    context.secretStore.set(MACHINE_TOKEN_SECRET, response.machineToken);
    context.log('maquina registrada en el gateway', { machine: args.machineName });
    await context.reconfigureAgent();

    return { registered: true, machineId: response.machineId ?? null };
  });

  handle(IPC_INVOKE.approvalResolve, approvalResolveArgsSchema, async (args) => {
    context.log('aprobacion solicitada desde la interfaz', {
      action: args.action,
      shortId: args.shortId,
    });
    // el resultado real lo decide el agente: puede denegarla por politica
    await context.controller.executeApproval(args);
    return { ok: true, message: 'peticion enviada al agente' };
  });

  handle(IPC_INVOKE.workspacePrepare, workspacePrepareArgsSchema, async (args) => {
    const workspace = await context.controller.prepareWorktree(args.projectAlias, args.label);
    context.log('espacio de trabajo preparado', {
      projectAlias: workspace.projectAlias,
      branch: workspace.branch,
    });
    return workspace;
  });

  handle(IPC_INVOKE.workspaceOpen, workspaceOpenArgsSchema, async (args) => {
    const root = realpathSync(resolve(worktreesDir()));
    const candidate = realpathSync(resolve(args.path));
    if (!isPathInside(candidate, root) || candidate === root) {
      throw new Error('la ruta no pertenece a un espacio de trabajo de Luxy');
    }
    const error = await shell.openPath(candidate);
    if (error.length > 0) throw new Error(`no se pudo abrir el espacio: ${error}`);
    return { opened: true };
  });

  // ---------------------------------------------------------------------------
  // Luxy Studio
  // ---------------------------------------------------------------------------

  handle(IPC_INVOKE.studioOptions, emptyArgsSchema, async () => ({
    machines: await studioClient(context).studioOptions(),
  }));

  handle(IPC_INVOKE.studioJobCreate, studioJobCreateArgsSchema, async (args) =>
    studioClient(context).createStudioJob(args),
  );

  handle(IPC_INVOKE.studioJobsList, studioJobsListArgsSchema, async (args) => ({
    jobs: await studioClient(context).listStudioJobs(args),
  }));

  handle(IPC_INVOKE.studioJobGet, studioJobIdArgsSchema, async (args) =>
    studioClient(context).getStudioJob(args.jobId),
  );

  handle(IPC_INVOKE.studioJobCancel, studioJobIdArgsSchema, async (args) => {
    await studioClient(context).cancelStudioJob(args.jobId);
    return { cancelled: true };
  });

  handle(IPC_INVOKE.studioJobFeedback, studioJobFeedbackArgsSchema, async (args) => ({
    job: await studioClient(context).rateStudioJob(args.jobId, { rating: args.rating }),
  }));

  handle(IPC_INVOKE.studioJobAction, studioJobActionArgsSchema, async (args) =>
    studioClient(context).requestStudioJobAction(args.jobId, {
      action: args.action,
      confirmed: args.confirmed,
      message: args.message,
    }),
  );

  handle(IPC_INVOKE.catalogRead, catalogRefreshArgsSchema, (args) => ({
    snapshot: readCatalogSnapshot(context.catalogDirectory, args.connectionId),
  }));

  handle(IPC_INVOKE.catalogRefresh, catalogRefreshArgsSchema, async (args) => {
    // misma regla que la prueba de conexion: la URL sale de la configuracion
    // guardada, nunca del renderer, y la clave no cruza el IPC
    const stored = context.configStore
      .load()
      ?.connections.find((connection) => connection.id === args.connectionId);
    if (stored === undefined) throw new Error('esa conexion no esta configurada');

    const apiKey = context.secretStore.get(connectionSecretName(args.connectionId));
    if (apiKey === undefined) throw new Error('no hay clave guardada para esta conexion');

    const base = stored.baseUrl.replace(/\/+$/, '');
    const pedir = async (url: string): Promise<unknown | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        if (!response.ok) return null;
        return (await response.json()) as unknown;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    const models = await pedir(`${base}/models`);
    if (models === null) throw new Error('la conexion no devolvio la lista de modelos');

    const snapshot = buildCatalogSnapshot({
      connectionId: args.connectionId,
      fetchedAt: new Date().toISOString(),
      modelsPayload: models,
      pricingPayload: null,
      notice: 'Esta conexion no publica precios por API; Luxy no los consulta.',
    });
    writeCatalogSnapshot(context.catalogDirectory, snapshot);
    return snapshot;
  });

  handle(IPC_INVOKE.connectionTest, connectionTestArgsSchema, async (args) => {
    // la URL la decide la configuracion guardada, NO el renderer. El contrato
    // IPC ni siquiera admite una URL: un renderer comprometido no puede elegir
    // a que servidor entrega main la clave descifrada.
    const stored = context.configStore
      .load()
      ?.connections.find((connection) => connection.id === args.connectionId);
    if (stored === undefined) {
      return { reachable: false, models: [], error: 'esa conexion no esta configurada' };
    }
    const baseUrl = stored.baseUrl;

    const apiKey = context.secretStore.get(connectionSecretName(args.connectionId));
    if (apiKey === undefined) {
      return { reachable: false, models: [], error: 'no hay clave guardada para esta conexion' };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!response.ok) {
        return {
          reachable: false,
          models: [],
          error: `la conexion respondio ${response.status}`,
        };
      }

      const body = (await response.json()) as { data?: { id?: unknown }[] };
      const models = (body.data ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === 'string');
      return { reachable: true, models, error: null };
    } catch (error) {
      return {
        reachable: false,
        models: [],
        // redact por si la URL llevara credenciales incrustadas
        error: redact(error instanceof Error ? error.message : String(error)),
      };
    }
  });
}

/** se llama al cerrar: sin esto, un reinicio de la ventana duplicaria handlers */
export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_INVOKE)) {
    ipcMain.removeHandler(channel);
  }
}
