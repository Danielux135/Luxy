// registro de los canales IPC.
//
// cada handler valida sus argumentos con zod antes de tocar nada y devuelve un
// resultado uniforme. Al renderer nunca le llega una traza ni un secreto: solo
// un mensaje pensado para leerse, y una pista de que hacer.
import { type BrowserWindow, dialog, ipcMain, safeStorage, shell, app } from 'electron';
import { readFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { z } from 'zod';
import {
  buildVaultPrompt,
  parseConversationMemoryResponse,
  parseVaultImageRequest,
  redact,
  storedAgentConfigSchema,
  secretRegistry,
  buildCatalogSnapshot,
  isPathInside,
  VAULT_IMAGE_NEGATIVE,
} from '@luxy/shared';
import { detectEnvironment } from '@luxy/agent/dist/detect.js';
import { GatewayClient } from '@luxy/agent/dist/gateway-client.js';
import { buildMachineIdentity } from '@luxy/agent/dist/agent.js';
import { worktreesDir } from '@luxy/agent/dist/paths.js';
import type { StoredAgentConfig } from '@luxy/shared';
import {
  IPC_INVOKE,
  artifactOpenFolderArgsSchema,
  worktreeOpenFolderArgsSchema,
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
  studioConversationUpdateArgsSchema,
  studioJobActionArgsSchema,
  studioJobIdArgsSchema,
  studioJobsListArgsSchema,
  gatewayCheckArgsSchema,
  machineRegisterArgsSchema,
  pickFolderArgsSchema,
  secretDeleteArgsSchema,
  secretSetArgsSchema,
  stopAgentArgsSchema,
  vaultChangePasswordArgsSchema,
  vaultAutoLockSetArgsSchema,
  vaultConversationIdArgsSchema,
  vaultConversationSendArgsSchema,
  vaultMediaAttachArgsSchema,
  vaultMediaListArgsSchema,
  vaultMediaReadArgsSchema,
  vaultMediaGenerateArgsSchema,
  vaultCharacterCreateArgsSchema,
  vaultCharacterForgetArgsSchema,
  vaultCharacterImportArgsSchema,
  VAULT_PREVIEW_MAX_BYTES,
  vaultAccountArgsSchema,
  vaultAccountLoginArgsSchema,
  vaultMediaKeyArgsSchema,
  vaultDeviceUnlockSetArgsSchema,
  vaultPasswordArgsSchema,
  vaultUnlockArgsSchema,
  type vaultStatusSchema,
  type IpcResult,
} from '../../shared/ipc.js';
import type { AgentController } from '../agent-controller.js';
import {
  isSecretNameAllowedForConfig,
  secretsToInvalidateForConfigChange,
  type ConfigStore,
} from '../config-store.js';
import type { SecretStore } from '../secure-storage.js';
import { VaultError, type VaultService } from '../vault/vault-service.js';
import type { VaultAccountManager } from '../vault/account-manager.js';
import type { VaultCharacterStore } from '../vault/character-store.js';
import type { PrivateConversationStore } from '../vault/conversation-store.js';
import type { PrivateMediaStore } from '../vault/media-store.js';
import { syncVault } from '../vault/sync.js';
import { randomUUID } from 'node:crypto';
import {
  MACHINE_TOKEN_SECRET,
  VAULT_MEDIA_API_SECRET,
  connectionSecretName,
} from '../../shared/ipc.js';
import {
  XaviraError,
  awaitGeneration,
  createCharacter,
  downloadOutput,
  generateImage,
  generateVideo,
} from '@luxy/agent/dist/providers/xavira.js';
import { deleteMigratedFile, inspectEnvFile, readEnvSecrets } from '../migration.js';
import { readCatalogSnapshot, writeCatalogSnapshot } from '../catalog-store.js';
import { resolveWorktreeDirectory } from '../worktree-directory.js';
import {
  imageBlockReason,
  type ImageBlockReason,
} from '../../shared/vault-image-capability.js';

/**
 * que decirle al usuario cuando la imagen que pidio el modelo no se puede
 * generar. Cada motivo se arregla en un sitio distinto, asi que cada uno tiene
 * su frase: la anterior mandaba a Conexiones incluso cuando la clave estaba
 * bien y lo que fallaba era el identificador del personaje.
 */
const IMAGE_BLOCK_MESSAGES: Record<ImageBlockReason, string> = {
  'sin-personaje': 'elige un personaje para esta conversacion antes de pedir imagenes',
  'personaje-desconocido':
    'el personaje de esta conversacion no esta en la boveda de este equipo: dalo de alta con su identificador o elige otro',
  'sin-clave': 'falta la clave del proveedor de imagenes en Conexiones',
};

/** tipo declarado por la extension del archivo elegido en el dialogo */
function mimeTypeFor(filePath: string): string {
  const extension = filePath.toLowerCase().split('.').pop() ?? '';
  const known: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  return known[extension] ?? 'application/octet-stream';
}

export interface HandlerContext {
  controller: AgentController;
  configStore: ConfigStore;
  secretStore: SecretStore;
  logsDirectory: string;
  /**
   * boveda privada.
   *
   * el contexto guarda el SERVICIO, no la llave. Ningun handler puede sacar
   * material criptografico: lo unico que devuelven es `status()`.
   */
  vault: VaultService;
  /**
   * cuenta de la boveda: sesion contra el gateway y origen de la llave maestra
   * en un equipo nuevo. Guarda el token de sesion; no lo entrega al renderer.
   */
  accounts: VaultAccountManager;
  /**
   * personajes del proveedor de imagenes.
   *
   * Crear uno cuesta creditos y su identificador solo se devuelve una vez: se
   * guarda aqui en cuanto llega, porque la API no tiene forma de listarlos.
   */
  characters: VaultCharacterStore;
  /** conversaciones privadas cifradas en disco */
  privateConversations: PrivateConversationStore;
  /** imagenes y videos privados, cifrados en disco */
  privateMedia: PrivateMediaStore;
  /** raiz de los artefactos generados; se abre, nunca se sirve por HTTP */
  artifactsDirectory: string;
  /** raiz local a la que deben pertenecer los worktrees que se abran */
  worktreesDirectory: string;
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
    hostname: buildMachineIdentity().hostname,
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

  handle(IPC_INVOKE.worktreeOpenFolder, worktreeOpenFolderArgsSchema, async (args) => {
    // la ruta procede del trabajo persistido, pero sigue siendo entrada no
    // confiable: resolver el enlace antes impide abrir fuera de Luxy.
    const directory = resolveWorktreeDirectory(args.worktreePath, context.worktreesDirectory);
    const error = await shell.openPath(directory);
    if (error.length > 0) throw new Error(`no se pudo abrir la carpeta de trabajo: ${error}`);
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

    if (
      args.providerSecret !== undefined &&
      !parsed.data.providers.http.some(
        (provider) => provider.apiKeyEnv === args.providerSecret?.name,
      )
    ) {
      throw new Error('la clave no pertenece a ningun proveedor HTTP configurado');
    }

    // una clave queda ligada al endpoint que estaba guardado cuando se
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
    if (args.providerSecret !== undefined) {
      context.secretStore.set(args.providerSecret.name, args.providerSecret.value);
      context.log('clave de proveedor HTTP guardada', { name: args.providerSecret.name });
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
    if (!isSecretNameAllowedForConfig(args.name, context.configStore.load())) {
      throw new Error('el secreto no pertenece a la configuracion actual');
    }
    context.secretStore.set(args.name, args.value);
    // no se registra el nombre con su valor en ningun log
    context.log('secreto guardado', { name: args.name });
    await context.reconfigureAgent();
    return summarizeSecrets(context.secretStore);
  });

  handle(IPC_INVOKE.secretDelete, secretDeleteArgsSchema, async (args) => {
    if (!isSecretNameAllowedForConfig(args.name, context.configStore.load())) {
      throw new Error('el secreto no pertenece a la configuracion actual');
    }
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

  handle(IPC_INVOKE.studioConversationUpdate, studioConversationUpdateArgsSchema, async (args) => ({
    job: await studioClient(context).updateStudioConversation(args.jobId, {
      conversationId: args.conversationId,
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.archived === undefined ? {} : { archived: args.archived }),
    }),
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

  // ---------------------------------------------------------------------------
  // boveda privada
  //
  // ningun handler de este bloque devuelve una llave, una sal ni un sobre. La
  // unica excepcion es la clave de recuperacion al crear, que se muestra una
  // vez y no se guarda.
  // ---------------------------------------------------------------------------

  /**
   * estado de la boveda mas el de la cuenta, en una sola respuesta.
   *
   * van juntos porque la interfaz los necesita a la vez —«cerrada» y «sin
   * sesion» son dos cosas distintas y se arreglan de forma distinta— y porque
   * asi el refresco periodico del renderer no dobla las llamadas.
   */
  const vaultStatus = (): z.infer<typeof vaultStatusSchema> => ({
    ...context.vault.status(),
    account: context.accounts.status(),
    mediaProviderConfigured: context.secretStore.get(VAULT_MEDIA_API_SECRET) !== undefined,
  });

  handle(IPC_INVOKE.vaultStatus, emptyArgsSchema, () => vaultStatus());

  handle(IPC_INVOKE.vaultAccountRegister, vaultAccountArgsSchema, async (args) => {
    const { recoveryKey } = await context.accounts.register(args.email, args.password);
    context.log('cuenta de boveda creada');
    return { status: vaultStatus(), recoveryKey };
  });

  handle(IPC_INVOKE.vaultAccountLogin, vaultAccountLoginArgsSchema, async (args) => {
    await context.accounts.login(args.email, args.secret, args.method);
    // se registra por que puerta se entro, sin el secreto: una entrada con
    // clave de recuperacion es justo lo que conviene poder ver despues
    context.log('sesion de boveda iniciada', { method: args.method });
    return vaultStatus();
  });

  /** sube a una cuenta nueva la boveda que ya existia en este equipo */
  handle(IPC_INVOKE.vaultAccountLink, vaultAccountArgsSchema, async (args) => {
    const { recoveryKey } = await context.accounts.link(args.email, args.password);
    context.log('boveda local vinculada a una cuenta');
    return { status: vaultStatus(), recoveryKey };
  });

  handle(IPC_INVOKE.vaultAccountLogout, emptyArgsSchema, async () => {
    await context.accounts.logout();
    return vaultStatus();
  });

  /**
   * guarda la clave del proveedor de imagenes.
   *
   * No pasa por `secretSet` porque ese canal exige que el nombre pertenezca a
   * la configuracion, y este secreto esta RESERVADO justo para que nadie se lo
   * apropie declarando un proveedor con ese `apiKeyEnv`. Aqui el nombre no
   * viaja por el IPC: lo pone esta linea, asi que el renderer no puede elegir
   * que secreto escribe.
   */
  handle(IPC_INVOKE.vaultMediaKeySet, vaultMediaKeyArgsSchema, async (args) => {
    context.secretStore.set(VAULT_MEDIA_API_SECRET, args.apiKey);
    // el nombre si, el valor nunca
    context.log('clave del proveedor de imagenes guardada');
    await context.reconfigureAgent();
    return vaultStatus();
  });

  handle(IPC_INVOKE.vaultMediaKeyDelete, emptyArgsSchema, async () => {
    context.secretStore.delete(VAULT_MEDIA_API_SECRET);
    context.log('clave del proveedor de imagenes borrada');
    await context.reconfigureAgent();
    return vaultStatus();
  });

  handle(IPC_INVOKE.vaultCreate, vaultPasswordArgsSchema, async (args) => {
    const { recoveryKey } = await context.vault.create(args.password);
    return { status: vaultStatus(), recoveryKey };
  });

  handle(IPC_INVOKE.vaultUnlock, vaultUnlockArgsSchema, async (args) => {
    if (args.method === 'device') {
      await context.vault.unlockWithDevice();
    } else {
      if (args.secret === undefined) {
        throw new VaultError('falta la contraseña o la clave de recuperacion');
      }
      if (args.method === 'password') await context.vault.unlock(args.secret);
      else await context.vault.unlockWithRecoveryKey(args.secret);
    }
    return vaultStatus();
  });

  handle(IPC_INVOKE.vaultLock, emptyArgsSchema, () => {
    context.vault.lock();
    return vaultStatus();
  });

  /**
   * cambia la contraseña por el camino que corresponda.
   *
   * Con la boveda vinculada a una cuenta, cambiarla solo aqui dejaria este
   * equipo abriendo con una contraseña que ningun otro reconoce: pasa por el
   * servidor y despues se rehace la envoltura local.
   */
  handle(IPC_INVOKE.vaultChangePassword, vaultChangePasswordArgsSchema, async (args) => {
    if (context.vault.boundAccount() === null) {
      await context.vault.changePassword(args.currentPassword, args.newPassword);
    } else {
      await context.accounts.changePassword(args.currentPassword, args.newPassword);
    }
    return vaultStatus();
  });

  handle(IPC_INVOKE.vaultDeviceUnlockSet, vaultDeviceUnlockSetArgsSchema, async (args) => {
    if (args.enabled) await context.vault.enableDeviceUnlock();
    else context.vault.disableDeviceUnlock();
    return vaultStatus();
  });

  handle(IPC_INVOKE.vaultAutoLockSet, vaultAutoLockSetArgsSchema, (args) => {
    context.vault.setAutoLockMinutes(args.minutes);
    return vaultStatus();
  });

  // ---------------------------------------------------------------------------
  // conversaciones privadas
  //
  // Todas exigen la boveda abierta. No es una comprobacion de interfaz: sin la
  // llave, el proceso principal literalmente no puede descifrar los archivos.
  // ---------------------------------------------------------------------------

  handle(IPC_INVOKE.vaultConversationList, emptyArgsSchema, async () => ({
    conversations: await context.privateConversations.list(context.vault),
  }));

  handle(IPC_INVOKE.vaultConversationRead, vaultConversationIdArgsSchema, async (args) => ({
    instructions: await context.privateConversations.latestInstructions(
      context.vault,
      args.conversationId,
    ),
    characterId: await context.privateConversations.latestCharacterId(
      context.vault,
      args.conversationId,
    ),
    characterDescription: await context.privateConversations.latestCharacterDescription(
      context.vault,
      args.conversationId,
    ),
    conversationId: args.conversationId,
    turns: await context.privateConversations.read(context.vault, args.conversationId),
    provider: await context.privateConversations.latestProvider(
      context.vault,
      args.conversationId,
    ),
  }));

  handle(IPC_INVOKE.vaultConversationDelete, vaultConversationIdArgsSchema, async (args) => {
    // los medios primero: si solo se borrara la conversacion, sus archivos
    // cifrados quedarian ocupando disco sin nada que los referenciara
    await context.privateMedia.deleteConversation(args.conversationId);
    context.privateConversations.delete(args.conversationId);
    return { deleted: true };
  });

  // ---------------------------------------------------------------------------
  // medios privados
  // ---------------------------------------------------------------------------

  /**
   * adjunta archivos a una conversacion privada.
   *
   * La RUTA la elige el usuario en un dialogo nativo del proceso principal; el
   * renderer no propone ninguna. Si pudiera, tendria una via para leer
   * cualquier archivo del equipo a traves de Luxy.
   */
  handle(IPC_INVOKE.vaultMediaAttach, vaultMediaAttachArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) {
      throw new VaultError('la boveda esta bloqueada');
    }
    const window = context.getMainWindow();
    if (window === null) throw new VaultError('no hay ventana desde la que elegir un archivo');

    const picked = await dialog.showOpenDialog(window, {
      title: 'Elige imagenes o videos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Imagenes y videos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm'] },
      ],
    });
    if (picked.canceled) return { attached: 0 };

    let attached = 0;
    for (const filePath of picked.filePaths) {
      const bytes = new Uint8Array(readFileSync(filePath));
      const caption = args.caption.trim();
      await context.privateMedia.add(context.vault, args.conversationId, bytes, {
        mimeType: mimeTypeFor(filePath),
        displayName: basename(filePath),
        // el pie de foto es lo unico que el modelo puede saber de un archivo
        // que no ha generado el: no lo ve, no lo abre y no tiene ojos
        prompt: caption.length === 0 ? null : caption,
        width: null,
        height: null,
        durationMs: null,
        characterId: null,
        provider: null,
        model: null,
      });
      attached += 1;
    }
    return { attached };
  });

  handle(IPC_INVOKE.vaultMediaList, vaultMediaListArgsSchema, async (args) => {
    const items = await context.privateMedia.list(context.vault, args.conversationId);
    return {
      media: items.map((item) => ({
        mediaId: item.mediaId,
        mimeType: item.metadata.mimeType,
        displayName: item.metadata.displayName,
        byteSize: 0,
        hasThumbnail: item.hasThumbnail,
        previewable: true,
      })),
    };
  });

  /**
   * opciones del proveedor de generacion.
   *
   * La clave sale de `SecretStore` y NUNCA pasa por el renderer, igual que las
   * demas. La llamada la hace el proceso principal, que ya tiene red: no hace
   * falta pasar por el agente, cuya razon de ser es lanzar procesos y manejar
   * worktrees, nada de lo cual interviene aqui.
   */
  const mediaProviderOptions = (signal: AbortSignal) => {
    const apiKey = context.secretStore.get(VAULT_MEDIA_API_SECRET);
    if (apiKey === undefined) {
      throw new VaultError(
        'no hay clave del proveedor de imagenes guardada en este equipo',
        'guardala en Conexiones antes de generar',
      );
    }
    return { baseUrl: 'https://api.xavira.ai', apiKey, signal };
  };

  /**
   * sincroniza la boveda con el gateway.
   *
   * Sube ciphertext y baja ciphertext. El identificador de boveda se deriva
   * aqui, en el proceso principal: el renderer no lo ve, porque aunque no
   * revele la llave sigue siendo un dato que agrupa todo lo tuyo.
   */
  handle(IPC_INVOKE.vaultSync, emptyArgsSchema, async () => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');
    const stored = context.configStore.load();
    if (stored === null) throw new VaultError('Luxy no esta configurado en esta maquina');

    // autoriza la SESION DE LA CUENTA, no el token de maquina: el gateway
    // decide de quien es cada registro por el usuario de esa sesion, y dos
    // personas pueden compartir una maquina sin compartir boveda (D-045)
    return syncVault(
      context.vault,
      context.privateConversations,
      {
        gatewayUrl: stored.gatewayUrl,
        sessionToken: context.accounts.sessionToken(),
        onUnauthorized: () => context.accounts.forgetSession(),
      },
      context.privateMedia,
    );
  });

  /**
   * crea un personaje a partir de una combinacion de rasgos.
   *
   * El proveedor NO admite fotos de referencia: las retiro a proposito, y su
   * documentacion explica por que —subir fotos para generar contenido adulto
   * crea una exposicion legal que no aceptan—. Toda la identidad sale de los
   * rasgos y de `scene`, y no hay forma de rodearlo ni se va a buscar.
   */
  handle(IPC_INVOKE.vaultCharacterCreate, vaultCharacterCreateArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const controller = new AbortController();
    try {
      const created = await createCharacter(
        {
          modelId: args.modelId,
          traits: args.traits,
          ...(args.scene.trim().length === 0 ? {} : { scene: args.scene.trim() }),
          sfw: args.sfw,
          ...(args.label.trim().length === 0 ? {} : { name: args.label.trim() }),
        },
        mediaProviderOptions(controller.signal),
      );

      // el avatar se pago con la creacion y es lo unico visual que identifica al
      // personaje. Se descarga y se cifra aqui; si falla, no se pierde el
      // personaje por ello: se guarda igual sin avatar
      let avatarObjectKey: string | null = null;
      if (created.avatarUrl !== null) {
        try {
          const avatar = await downloadOutput(
            created.avatarUrl,
            mediaProviderOptions(controller.signal),
          );
          avatarObjectKey = await context.characters.saveAvatar(context.vault, avatar.bytes);
        } catch {
          // un avatar que no se pudo bajar no vale perder el identificador
        }
      }

      // se guarda AQUI MISMO, antes de devolver nada. Crear un personaje cuesta
      // creditos, su identificador solo llega una vez y la API no sabe
      // listarlos: si no se guarda en este instante, se paga y se pierde
      const characters = await context.characters.add(context.vault, {
        characterId: created.characterId,
        modelId: args.modelId,
        description: args.description,
        label: args.label.trim(),
        avatarObjectKey,
        createdAt: new Date().toISOString(),
      });

      // los rasgos elegidos no se registran: describen a una persona
      context.log('personaje creado', { modelId: args.modelId });
      return { characterId: created.characterId, characters };
    } catch (error) {
      if (error instanceof XaviraError) throw new VaultError(error.message, error.hint);
      throw error;
    }
  });

  /**
   * da de alta un personaje que YA existe en el proveedor.
   *
   * Hace falta porque la API no sabe listarlos: quien tenga un identificador de
   * antes —o lo recupere de la URL de su avatar— no tiene otra via de meterlo
   * en Luxy, y crear otro cuesta creditos.
   *
   * Si se aporta la URL del avatar, se descarga y se cifra aqui. La URL es
   * publica y ya existia; lo que hace Luxy es traerse una copia propia.
   */
  handle(IPC_INVOKE.vaultCharacterImport, vaultCharacterImportArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    let avatarObjectKey: string | null = null;
    if (args.avatarUrl.length > 0) {
      const controller = new AbortController();
      try {
        const avatar = await downloadOutput(
          args.avatarUrl,
          mediaProviderOptions(controller.signal),
        );
        avatarObjectKey = await context.characters.saveAvatar(context.vault, avatar.bytes);
      } catch (error) {
        // se dice, no se traga: el usuario pego una URL y espera saber si valio
        if (error instanceof XaviraError) throw new VaultError(error.message, error.hint);
        throw error;
      }
    }

    const characters = await context.characters.add(context.vault, {
      characterId: args.characterId.trim(),
      modelId: args.modelId,
      description: args.description,
      label: args.label.trim(),
      avatarObjectKey,
      createdAt: new Date().toISOString(),
    });
    context.log('personaje dado de alta', { modelId: args.modelId });
    return { characters };
  });

  /** avatar descifrado, para enseñarlo. Nunca se escribe sin cifrar en disco */
  handle(IPC_INVOKE.vaultCharacterAvatar, vaultCharacterForgetArgsSchema, async (args) => {
    const character = (await context.characters.list(context.vault)).find(
      (entry) => entry.characterId === args.characterId,
    );
    if (character?.avatarObjectKey == null) return { dataUrl: null };

    const bytes = await context.characters.readAvatar(context.vault, character.avatarObjectKey);
    return {
      dataUrl: `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`,
    };
  });

  handle(IPC_INVOKE.vaultCharacterList, emptyArgsSchema, async () => ({
    characters: await context.characters.list(context.vault),
  }));

  /** olvida un personaje aqui. En el proveedor sigue existiendo */
  handle(IPC_INVOKE.vaultCharacterForget, vaultCharacterForgetArgsSchema, async (args) => ({
    characters: await context.characters.remove(context.vault, args.characterId),
  }));

  /**
   * genera un medio y lo guarda cifrado en la conversacion.
   *
   * La usan DOS caminos: el panel manual y la peticion que el modelo hace
   * dentro de una conversacion. Es la misma operacion, y tenerla dos veces
   * garantizaria que una de las dos se olvide de cifrar o de sondear.
   */
  const generatePrivateMedia = async (input: {
    conversationId: string;
    characterId: string;
    prompt: string;
    kind: 'image' | 'video';
    fromGenerationId?: string;
  }): Promise<{
    mediaId: string;
    mimeType: string;
    byteSize: number;
    costCredits: number | null;
  }> => {
    const controller = new AbortController();
    const options = mediaProviderOptions(controller.signal);
    const args = input;

    try {
      const started =
        args.kind === 'image'
          ? await generateImage(
              {
                characterId: args.characterId,
                prompt: args.prompt,
                // lo que NO debe salir. Va aqui y nunca en el prompt: el
                // positivo no tiene el concepto de «no» y nombrar algo para
                // negarlo lo invoca
                negativePromptAppend: VAULT_IMAGE_NEGATIVE,
              },
              options,
            )
          : await generateVideo(
              {
                characterId: args.characterId,
                prompt: args.prompt,
                negativePromptAppend: VAULT_IMAGE_NEGATIVE,
                ...(args.fromGenerationId === undefined
                  ? {}
                  : { fromGenerationId: args.fromGenerationId }),
              },
              options,
            );

      // sondeo, nunca callback: un callback exigiria una URL publica y el
      // contenido pasaria por el gateway (D-042)
      const finished = await awaitGeneration(started, options);
      if (finished.outputUrl === null) {
        throw new VaultError('el proveedor no devolvio ningun resultado');
      }

      const { bytes, mimeType } = await downloadOutput(finished.outputUrl, options);

      // se cifra ANTES de tocar el disco: los bytes descargados no llegan a
      // existir sin cifrar en el sistema de ficheros en ningun momento
      const stored = await context.privateMedia.add(context.vault, args.conversationId, bytes, {
        mimeType,
        displayName: null,
        prompt: args.prompt,
        width: null,
        height: null,
        durationMs: null,
        characterId: args.characterId,
        provider: 'xavira',
        model: null,
      });

      // ni el prompt, ni la conversacion, ni la URL del resultado
      context.log('medio privado generado', { kind: args.kind, byteSize: stored.byteSize });

      return {
        mediaId: stored.mediaId,
        mimeType,
        byteSize: stored.byteSize,
        costCredits: finished.costCredits,
      };
    } catch (error) {
      if (error instanceof XaviraError) throw new VaultError(error.message, error.hint);
      throw error;
    }
  };

  handle(IPC_INVOKE.vaultMediaGenerate, vaultMediaGenerateArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');
    return generatePrivateMedia({
      conversationId: args.conversationId,
      characterId: args.characterId,
      prompt: args.prompt,
      kind: args.kind,
      ...(args.fromGenerationId === undefined ? {} : { fromGenerationId: args.fromGenerationId }),
    });
  });

  handle(IPC_INVOKE.vaultMediaRead, vaultMediaReadArgsSchema, async (args) => {
    const { bytes, mimeType } = await context.privateMedia.read(
      context.vault,
      args.conversationId,
      args.mediaId,
    );

    if (bytes.length > VAULT_PREVIEW_MAX_BYTES) {
      // se devuelve el tipo pero no el contenido: mandar cientos de megas en
      // base64 por el IPC congela la ventana
      return { mediaId: args.mediaId, mimeType, dataUrl: null };
    }

    return {
      mediaId: args.mediaId,
      mimeType,
      // los bytes descifrados solo viven en memoria: nunca se escribe una copia
      // en claro a disco, ni siquiera temporal
      dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
    };
  });

  handle(IPC_INVOKE.vaultConversationSend, vaultConversationSendArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) {
      throw new VaultError(
        'la boveda esta bloqueada',
        'abrela para poder escribir en una conversacion privada',
      );
    }
    const conversationId = args.conversationId ?? randomUUID();
    const store = context.privateConversations;

    // el titulo sale del primer mensaje y viaja cifrado con cada turno
    const existing = await store.read(context.vault, conversationId);
    const title =
      existing[0]?.title ??
      args.message.slice(0, 60).replace(/\s+/g, ' ').trim();

    // instrucciones fijas: `null` significa «no las toques» y conserva las que
    // hubiera; una cadena vacia si las borra. Se sellan con el turno del
    // usuario, asi que el historial guarda cuales regian cada respuesta.
    const previousInstructions = await store.latestInstructions(context.vault, conversationId);
    const instructions = args.instructions === null ? previousInstructions : args.instructions;
    const changed = args.instructions !== null && args.instructions !== (previousInstructions ?? '');

    // el personaje sigue la misma regla que las instrucciones: pertenece a la
    // conversacion, no a un campo que haya que rescribir en cada mensaje
    const previousCharacter = await store.latestCharacterId(context.vault, conversationId);
    const characterId = args.characterId === null ? previousCharacter : args.characterId;
    const characterChanged =
      args.characterId !== null && args.characterId !== (previousCharacter ?? '');

    // quien es el personaje, para el MODELO. El identificador de arriba solo le
    // sirve al proveedor de imagenes; el modelo no ve ninguna imagen
    const previousDescription = await store.latestCharacterDescription(
      context.vault,
      conversationId,
    );
    const characterDescription =
      args.characterDescription === null ? previousDescription : args.characterDescription;
    const descriptionChanged =
      args.characterDescription !== null &&
      args.characterDescription !== (previousDescription ?? '');

    // el avatar del personaje se copia a la conversacion la primera vez que se
    // usa aqui. Vive en la ficha del personaje, que es de otro sitio: sin esta
    // copia, «pasame tu foto de perfil» no tenia NADA que reenviar, y el modelo
    // respondia —con razon— que no podia recuperar ninguna.
    // el personaje tiene que estar EN LA BOVEDA, no solo escrito en el campo.
    // El identificador lo teclea el usuario y nadie lo comprobaba: uno que no
    // esta aqui no tiene avatar que reenviar, no sirve para generar y el
    // proveedor solo lo desmiente al final, cuando ella ya prometio la foto.
    const character =
      characterId === null || characterId.length === 0
        ? undefined
        : (await context.characters.list(context.vault)).find(
            (entry) => entry.characterId === characterId,
          );

    if (character !== undefined && character.avatarObjectKey !== null) {
      const known = await context.privateMedia.list(context.vault, conversationId);
      const yaEsta = known.some((item) => item.metadata.characterId === character.characterId);
      if (!yaEsta) {
        try {
          const bytes = await context.characters.readAvatar(
            context.vault,
            character.avatarObjectKey,
          );
          await context.privateMedia.add(context.vault, conversationId, bytes, {
            mimeType: 'image/webp',
            displayName: 'foto de perfil',
            prompt: 'su foto de perfil',
            width: null,
            height: null,
            durationMs: null,
            characterId: character.characterId,
            provider: 'xavira',
            model: null,
          });
        } catch {
          // sin avatar se sigue: no vale perder el turno por una foto
        }
      }
    }

    // solo se le ofrece generar si de verdad se puede: sin personaje conocido o
    // sin clave, ofrecerselo garantiza una promesa incumplida en cada turno
    const imageBlock = imageBlockReason({
      characterId,
      characterInVault: character !== undefined,
      hasApiKey: context.secretStore.get(VAULT_MEDIA_API_SECRET) !== undefined,
    });
    const canGenerateImage = imageBlock === null;

    await store.appendTurn(context.vault, conversationId, {
      role: 'user',
      text: args.message,
      title,
      provider: args.provider,
      model: args.model,
      inputTokens: null,
      outputTokens: null,
      // solo se vuelven a sellar cuando cambian: repetirlas en cada turno
      // engordaria el archivo sin decir nada nuevo
      ...(changed ? { instructions: args.instructions } : {}),
      ...(characterChanged ? { characterId: args.characterId } : {}),
      ...(descriptionChanged ? { characterDescription: args.characterDescription } : {}),
    });

    // el prompt se arma con la memoria acumulativa mas los ultimos turnos, no
    // con el hilo entero. Si no, cada mensaje de una conversacion larga volveria
    // a enviarlo todo y el coste y la latencia crecerian sin techo hasta chocar
    // con el limite de contexto del modelo.
    const history = await store.read(context.vault, conversationId);
    const memory = await store.latestMemory(context.vault, conversationId);

    // sin esta lista el modelo no puede reenviar nada: no sabe que hay, asi que
    // genera otra —pagando— cada vez que le piden «la de antes»
    const existingImages = canGenerateImage
      ? (await context.privateMedia.list(context.vault, conversationId)).map((item) => ({
          mediaId: item.mediaId,
          description: item.metadata.prompt ?? item.metadata.displayName ?? '',
        }))
      : [];
    const prompt = buildVaultPrompt({
      memory,
      // el ultimo es el que se acaba de guardar: va aparte como mensaje nuevo
      turns: history.slice(0, -1).map((turn) => ({ role: turn.role, text: turn.text })),
      message: args.message,
      instructions: instructions === null || instructions.length === 0 ? null : instructions,
      character:
        characterDescription === null || characterDescription.length === 0
          ? null
          : characterDescription,
      canGenerateImage,
      existingImages,
      // los modelos de anime rinden peor con prosa y los realistas peor con
      // etiquetas sueltas: lo dice la documentacion del proveedor
      imagePromptStyle: character?.modelId === 'anime-pure-v1' ? 'tags' : 'prose',
    });

    // ni el texto ni los rasgos: solo si el turno pudo ofrecer imagenes y
    // cuantas habia para reenviar. Sin esto habia que adivinar por que el
    // modelo decia que no podia
    context.log('turno privado', {
      conPersonaje: characterId !== null && characterId.length > 0,
      // la diferencia entre estos dos es exactamente el fallo que costo una
      // tarde: un personaje fijado que la boveda no conoce
      personajeEnBoveda: character !== undefined,
      puedeGenerar: canGenerateImage,
      imagenesDisponibles: existingImages.length,
    });

    const result = await context.controller.runLocalTurn({
      localTurnId: randomUUID(),
      provider: args.provider,
      model: args.model,
      projectAlias: args.projectAlias,
      prompt,
    });

    // lo que el modelo pidio generar, y como acabo. Se devuelve a la interfaz
    // para que pueda decir «no habia clave» o «el proveedor fallo» en vez de
    // callarse: una imagen que no aparece sin explicacion parece un cuelgue
    let image: {
      mediaId: string | null;
      costCredits: number | null;
      error: string | null;
    } | null = null;

    if (result.outcome !== 'failed' && result.text.length > 0) {
      // la memoria viaja DENTRO de la respuesta y se separa aqui: lo que se
      // guarda como turno es solo el texto visible, sin el bloque tecnico
      const parsed = parseConversationMemoryResponse(result.text);
      // y despues la peticion de imagen, sobre lo que quedo. El orden es el
      // inverso al del prompt: la memoria va la ultima, asi que sale la primera
      const imageRequest = parseVaultImageRequest(parsed.visibleText);

      if (imageRequest.request?.mediaId !== undefined) {
        // reenviar lo que ya existe: gratis e inmediato. Se comprueba que sea
        // de ESTA conversacion, porque el identificador lo escribe el modelo y
        // podria inventarse uno de otra
        const known = await context.privateMedia.list(context.vault, conversationId);
        const found = known.find((item) => item.mediaId === imageRequest.request?.mediaId);
        image =
          found === undefined
            ? { mediaId: null, costCredits: null, error: 'esa imagen no existe en esta conversacion' }
            : { mediaId: found.mediaId, costCredits: null, error: null };
      } else if (
        imageRequest.request?.prompt !== undefined &&
        canGenerateImage &&
        character !== undefined
      ) {
        try {
          const generated = await generatePrivateMedia({
            conversationId,
            characterId: character.characterId,
            prompt: imageRequest.request.prompt,
            kind: imageRequest.request.kind,
          });
          image = {
            mediaId: generated.mediaId,
            costCredits: generated.costCredits,
            error: null,
          };
        } catch (error) {
          // una generacion fallida NO tira la respuesta de texto: lo escrito
          // sigue valiendo y se guarda igual, con el fallo al lado
          image = {
            mediaId: null,
            costCredits: null,
            error: redact(error instanceof Error ? error.message : String(error)),
          };
        }
      } else if (imageRequest.request !== null) {
        image = {
          mediaId: null,
          costCredits: null,
          // tres motivos distintos con tres arreglos distintos: mezclarlos
          // mandaba a mirar la clave cuando el problema era el identificador
          error: IMAGE_BLOCK_MESSAGES[imageBlock ?? 'sin-personaje'],
        };
      }

      await store.appendTurn(
        context.vault,
        conversationId,
        {
          role: 'assistant',
          text: imageRequest.visibleText,
          title,
          provider: args.provider,
          model: result.executedModel ?? args.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
        // sin memoria valida no se guarda ninguna: se conserva la anterior, que
        // sigue siendo buena. Un turno malo no borra la conversacion (D-019)
        parsed.memory === null ? undefined : { memory: parsed.memory },
      );
    }

    return {
      conversationId,
      outcome: result.outcome,
      turns: await store.read(context.vault, conversationId),
      instructions: await store.latestInstructions(context.vault, conversationId),
      characterId: await store.latestCharacterId(context.vault, conversationId),
      characterDescription: await store.latestCharacterDescription(context.vault, conversationId),
      provider: args.provider,
      image,
      error: result.error,
    };
  });
}

/** se llama al cerrar: sin esto, un reinicio de la ventana duplicaria handlers */
export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_INVOKE)) {
    ipcMain.removeHandler(channel);
  }
}
