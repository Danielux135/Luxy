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
  composeVaultPrompt,
  estimateTokens,
  measureVaultPrompt,
  VAULT_RECENT_TURNS,
  parseConversationMemoryResponse,
  PROFILE_PHOTO_LABEL,
  imageDescriptionFor,
  imageTransportProblem,
  profilePhotoLine,
  parseVaultImageRequest,
  redact,
  type ConversationMemoryStatus,
  storedAgentConfigSchema,
  secretRegistry,
  buildCatalogSnapshot,
  buildCatalogPrompt,
  describeCatalogFailure,
  parseCatalogResponse,
  detectEvenSplit,
  CATALOG_MAX_TURNS,
  isPathInside,
  VAULT_IMAGE_NEGATIVE,
  buildHordeRequest,
  DESCRIBE_MAX_OUTPUT_TOKENS,
  buildDescribePrompt,
  buildRewriteCaptionPrompt,
  parseDescribeResponse,
  parseRewriteResponse,
  splitReasoning,
  trimWithMark,
  imagePromptStyleFor,
  type HordeRecipe,
  resolveAuxiliaryTarget,
  chooseConversationMemory,
  recapCoverage,
  formatConversationMemory,
  civilDayLabel,
  type ChosenMemory,
  type RecapCoverage,
  type RecapTurnRef,
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
  vaultCatalogSyncArgsSchema,
  vaultCompatibilityArgsSchema,
  VAULT_COMPATIBILITY_REPLY_CHARS,
  VAULT_COMPATIBILITY_TRIM_MARK,
  type vaultCompatibilityReplySchema,
  vaultMemoryExcludeArgsSchema,
  vaultMemoryReadArgsSchema,
  vaultMediaAttachArgsSchema,
  vaultMediaListArgsSchema,
  vaultMediaReadArgsSchema,
  vaultMediaGenerateArgsSchema,
  vaultMediaCaptionArgsSchema,
  vaultMediaDescribeArgsSchema,
  vaultMediaRewriteCaptionArgsSchema,
  vaultMemoryDiagnosticsArgsSchema,
  vaultRelationSyncArgsSchema,
  vaultRelationUpdateArgsSchema,
  vaultRecapSyncArgsSchema,
  vaultRecapUpdateArgsSchema,
  vaultAuxiliaryGetArgsSchema,
  vaultAuxiliarySetArgsSchema,
  vaultVisionProbeArgsSchema,
  vaultCharacterCreateArgsSchema,
  vaultCharacterForgetArgsSchema,
  vaultCharacterImportArgsSchema,
  VAULT_PREVIEW_MAX_BYTES,
  vaultAccountArgsSchema,
  vaultAccountLoginArgsSchema,
  vaultMediaKeyArgsSchema,
  vaultHordeKeyArgsSchema,
  vaultHordeCharacterSaveArgsSchema,
  vaultCharacterProviderArgsSchema,
  vaultDeviceUnlockSetArgsSchema,
  vaultPasswordArgsSchema,
  vaultUnlockArgsSchema,
  type vaultStatusSchema,
  type vaultRecapListResultSchema,
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
  RESERVED_SECRET_NAMES,
  VAULT_HORDE_API_SECRET,
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
import {
  ANONYMOUS_API_KEY,
  HORDE_BASE_URL,
  HordeError,
  awaitImage,
  downloadImage,
  findUser,
  isAnonymousKey,
  listImageModels,
  submitImage,
} from '@luxy/agent/dist/providers/horde.js';
import { deleteMigratedFile, inspectEnvFile, readEnvSecrets } from '../migration.js';
import { readCatalogSnapshot, writeCatalogSnapshot } from '../catalog-store.js';
import { resolveWorktreeDirectory } from '../worktree-directory.js';
import {
  imageBlockReason,
  type ImageBlockReason,
} from '../../shared/vault-image-capability.js';
import { classifyReply } from '../../shared/refusal.js';
import {
  worthReporting,
  type HordeQueueProgress,
} from '../../shared/horde-progress.js';
import { IPC_EVENT } from '../../shared/channels.js';
import { mergeLogLines } from '../../shared/log-merge.js';
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  isKnownImage,
  sniffImageType,
  mimeTypeFor,
} from '../../shared/media-types.js';
import type { PrivateMemory } from '../vault/private-memory.js';
import type { MemoryPreferences } from '../vault/memory-preferences.js';
import type { CatalogStore } from '../vault/catalog-store.js';
import type { RelationStore } from '../vault/relation-store.js';
import type { RecapStore } from '../vault/recap-store.js';
import { RelationSync, createAuxiliaryLane } from '../vault/relation-sync.js';
import { RecapSync } from '../vault/recap-sync.js';
import {
  decideRelation,
  listRelationsForReview,
  type RelationReviewItem,
} from '../vault/relation-review.js';
import { buildRecall } from '../vault/recall.js';
import { diagnoseMemory, type DiagnosticMessage } from '../vault/memory-diagnostics.js';
import { diagnoseRelations } from '../vault/relation-diagnostics.js';
import {
  selectPendingForTurn,
  type PendingSelection,
} from '../vault/relation-selection.js';
import { matchesNote, quoteStems, type CharacterReply } from '../vault/relation.js';
import { memoryOfTurn } from '../vault/turn-memory.js';

/**
 * que decirle al usuario cuando la imagen que pidio el modelo no se puede
 * generar. Cada motivo se arregla en un sitio distinto, asi que cada uno tiene
 * su frase: la anterior mandaba a Conexiones incluso cuando la clave estaba
 * bien y lo que fallaba era el identificador del personaje.
 */
function imageBlockMessage(reason: ImageBlockReason, provider: 'xavira' | 'horde'): string {
  switch (reason) {
    case 'sin-personaje':
      return 'elige un personaje para esta conversacion antes de pedir imagenes';
    case 'personaje-desconocido':
      return 'el personaje de esta conversacion no esta en la boveda de este equipo: dalo de alta con su identificador o elige otro';
    case 'sin-clave':
      // dos proveedores, dos sitios distintos donde arreglarlo. Mandar al de
      // pago a quien usa el gratuito es exactamente el fallo que este mensaje
      // existe para no repetir
      return provider === 'horde'
        ? 'falta la clave de AI Horde: se saca gratis en aihorde.net y se guarda en Privado, en «Proveedor de imagenes»'
        : 'falta la clave del proveedor de imagenes en Conexiones';
  }
}

// las extensiones admitidas y el mapa de tipos viven en `shared/media-types`:
// aqui no se pueden probar, y no probarlas fue justo el fallo

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
  /**
   * memoria episodica: indice de busqueda y episodios sobre esos turnos.
   *
   * Se construye sola en la primera busqueda y se vacia sola al cerrar la
   * boveda; aqui solo se usa y se invalida cuando el historial cambia.
   */
  privateMemory: PrivateMemory;
  /** que conversaciones quedan fuera del banco de recuerdos */
  memoryPreferences: MemoryPreferences;
  /** escenas catalogadas por un modelo, cifradas */
  catalogs: CatalogStore;
  /** promesas y planes pendientes entre los dos, cifrados */
  relations: RelationStore;
  /**
   * memoria acumulativa generada hacia atras, cifrada.
   *
   * Vive FUERA de los `.jsonl` sellados: no hay API para reescribir un registro
   * y una memoria mal escrita ahi dentro apaga la lista entera de Privado. Lo
   * que guarda solo llega a un prompt cuando la conversacion NO tiene memoria
   * propia, porque la sellada gana siempre.
   */
  recaps: RecapStore;
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

/**
 * ultimas lineas del log. ya salen redactadas de los dos loggers.
 *
 * Son DOS archivos y se leen juntos: `luxy.log` lo escribe el agente y
 * `studio.log` el proceso principal. Son las dos mitades de la misma historia
 * —Studio decide si un turno puede ofrecer imagenes, el agente cuenta como
 * termino la llamada— y separarlos fue justo lo que impidio diagnosticar un
 * fallo hoy.
 */
function tailLogFile(directory: string, count: number): string[] {
  const leer = (name: string): string[] => {
    const file = join(directory, name);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0);
  };
  return mergeLogLines([leer('luxy.log'), leer('studio.log')], count);
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

    // un proveedor HTTP no puede apropiarse de un secreto reservado.
    //
    // Es la unica comprobacion que faltaba para que esa reserva significara
    // algo: `secretSet` y `secretDelete` si la hacian, pero por aqui bastaba
    // declarar un proveedor con `apiKeyEnv: 'VAULT_HORDE_API_KEY'` para (a)
    // pisar la clave de la boveda y (b) —peor— conseguir que `reconfigureAgent`
    // se la entregara al agente, que la mandaria como `Authorization` al
    // endpoint declarado en ese mismo proveedor. Se rechaza la configuracion
    // entera antes de escribir nada.
    const secuestrado = parsed.data.providers.http.find((provider) =>
      RESERVED_SECRET_NAMES.includes(provider.apiKeyEnv),
    );
    if (secuestrado !== undefined) {
      throw new Error(
        `el nombre de clave ${secuestrado.apiKeyEnv} esta reservado y no puede usarlo un proveedor HTTP`,
      );
    }
    if (args.providerSecret !== undefined && RESERVED_SECRET_NAMES.includes(args.providerSecret.name)) {
      throw new Error(`el nombre de clave ${args.providerSecret.name} esta reservado`);
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
    snapshot: readCatalogSnapshot(context.catalogDirectory, args.connectionId, args.source),
  }));

  handle(IPC_INVOKE.catalogRefresh, catalogRefreshArgsSchema, async (args) => {
    // misma regla que la prueba de conexion: la URL sale de la configuracion
    // guardada, nunca del renderer, y la clave no cruza el IPC
    const config = context.configStore.load();
    // las dos listas son distintas y hay que buscar en la que toca. Antes solo
    // se miraba `connections`, asi que a un proveedor HTTP —donde vive
    // Mistral— no habia forma de preguntarle que sirve
    const stored =
      args.source === 'http'
        ? config?.providers.http.find((provider) => provider.id === args.connectionId)
        : config?.connections.find((connection) => connection.id === args.connectionId);
    if (stored === undefined) {
      throw new Error(
        args.source === 'http'
          ? 'ese proveedor HTTP no esta configurado'
          : 'esa conexion no esta configurada',
      );
    }

    // cada lista guarda su clave con un nombre distinto: la del proveedor HTTP
    // es la suya propia, no `connection:<id>`
    const secretName =
      args.source === 'http'
        ? (stored as { apiKeyEnv: string }).apiKeyEnv
        : connectionSecretName(args.connectionId);
    const apiKey = context.secretStore.get(secretName);
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
      source: args.source,
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
  const vaultStatus = (): z.infer<typeof vaultStatusSchema> => {
    const hordeKey = context.secretStore.get(VAULT_HORDE_API_SECRET);
    return {
      ...context.vault.status(),
      account: context.accounts.status(),
      mediaProviderConfigured: context.secretStore.get(VAULT_MEDIA_API_SECRET) !== undefined,
      hordeConfigured: hordeKey !== undefined,
      // el hecho, no la clave: la pantalla necesita poder avisar de que con la
      // anonima el horde comparte lo que genera
      hordeAnonymous: hordeKey !== undefined && isAnonymousKey(hordeKey),
    };
  };

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

  /**
   * clave de AI Horde.
   *
   * Mismo criterio que la anterior: el nombre del secreto lo pone esta linea y
   * no viaja por el IPC. Se registra ademas si la clave guardada es la anonima,
   * porque eso cambia lo que le pasa al contenido —el horde lo comparte— y es
   * el tipo de cosa que nadie deberia descubrir despues.
   */
  handle(IPC_INVOKE.vaultHordeKeySet, vaultHordeKeyArgsSchema, async (args) => {
    context.secretStore.set(VAULT_HORDE_API_SECRET, args.apiKey.trim());
    context.log('clave de AI Horde guardada', { anonima: isAnonymousKey(args.apiKey.trim()) });
    await context.reconfigureAgent();
    return vaultStatus();
  });

  handle(IPC_INVOKE.vaultHordeKeyDelete, emptyArgsSchema, async () => {
    context.secretStore.delete(VAULT_HORDE_API_SECRET);
    context.log('clave de AI Horde borrada');
    await context.reconfigureAgent();
    return vaultStatus();
  });

  /**
   * saldo de kudos de la cuenta del horde.
   *
   * Los kudos NO son dinero y no se compran: deciden la posicion en la cola. Es
   * la unica explicacion honesta de por que una imagen tarda veinte segundos y
   * la siguiente cuatro minutos, asi que se enseña en vez de dejarlo a la
   * imaginacion.
   */
  handle(IPC_INVOKE.vaultHordeAccount, emptyArgsSchema, async () => {
    const controller = new AbortController();
    const options = hordeOptions(controller.signal);
    try {
      const user = await findUser(options);
      return {
        username: user.username,
        kudos: user.kudos,
        concurrency: user.concurrency,
        anonymous: isAnonymousKey(options.apiKey),
      };
    } catch (error) {
      if (error instanceof HordeError) throw new VaultError(error.message, error.hint);
      throw error;
    }
  });

  /**
   * modelos que el horde sirve AHORA.
   *
   * La lista curada del catalogo dice cuales sirven para lo que se quiere; esta
   * dice cuales tienen workers en este momento. Las dos hacen falta: un nombre
   * correcto sin workers deja la peticion en cola hasta que caduca.
   */
  handle(IPC_INVOKE.vaultHordeModels, emptyArgsSchema, async () => {
    const controller = new AbortController();
    try {
      // sin clave a proposito: el catalogo es publico y consultarlo no deberia
      // exigir tener la cuenta puesta todavia
      const models = await listImageModels({
        baseUrl: HORDE_BASE_URL,
        signal: controller.signal,
      });
      return { models };
    } catch (error) {
      if (error instanceof HordeError) throw new VaultError(error.message, error.hint);
      throw error;
    }
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

  handle(IPC_INVOKE.vaultConversationList, emptyArgsSchema, async () => {
    const conversations = await context.privateConversations.list(context.vault);
    // el nombre se resuelve aqui y no en el renderer: alli solo llegaria un
    // uuid, y agrupar los hilos por «83cc7f03…» no separa nada
    const characters = await context.characters.list(context.vault);
    const labels = new Map(characters.map((entry) => [entry.characterId, entry.label]));
    return {
      conversations: conversations.map((conversation) => ({
        ...conversation,
        // un personaje olvidado deja huerfanos sus hilos, y siguen siendo
        // suyos: se agrupan igual, sin nombre, en vez de desaparecer
        characterLabel:
          conversation.characterId === null
            ? null
            : (labels.get(conversation.characterId) ?? null),
      })),
    };
  });

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
    model: await context.privateConversations.latestModel(context.vault, args.conversationId),
  }));

  handle(IPC_INVOKE.vaultConversationDelete, vaultConversationIdArgsSchema, async (args) => {
    // los medios primero: si solo se borrara la conversacion, sus archivos
    // cifrados quedarian ocupando disco sin nada que los referenciara
    await context.privateMedia.deleteConversation(args.conversationId);
    context.privateConversations.delete(args.conversationId);

    /**
     * cada almacen, con su propio `try`.
     *
     * Encadenados en uno solo, el fallo del primero cancelaba a los otros dos:
     * `RelationStore` se para en seco a proposito cuando su archivo no abre, y
     * la boveda puede bloquearse sola entre dos `await`. Lo que quedaba en
     * disco era contenido de una conversacion que Daniel acaba de mandar
     * borrar —el resumen de lo que se dijo, las citas literales de lo apuntado,
     * el resumen de cada escena— y ademas INALCANZABLE: la lista descarta lo
     * que ya no tiene conversacion, asi que no habia fila desde la que
     * quitarlo. Ahora el que falla se deja a si mismo sin limpiar y nada mas, y
     * el primer error sale al final para que el borrado siga contando como
     * fallido.
     */
    const fallos: unknown[] = [];
    const intentar = async (task: () => Promise<void>): Promise<void> => {
      try {
        await task();
      } catch (error) {
        fallos.push(error);
      }
    };

    try {
      // el recap PRIMERO: es el almacen con mas texto de la conversacion dentro
      // —resumen, hechos, acuerdos y lecciones—, asi que es el que menos puede
      // depender de que los otros dos hayan ido bien
      await intentar(() =>
        context.recaps.removeConversation(context.vault, args.conversationId),
      );
      // sin esto, el personaje seguiria recordando una conversacion borrada
      await intentar(() =>
        context.catalogs.removeConversation(context.vault, args.conversationId),
      );
      // y sin esto reclamaria una promesa cuyo turno ya no existe: sin cita que
      // verificar, la nota no tiene respaldo. Los cierres que ocurrieron aqui se
      // conservan sin turno, que es el lado seguro
      await intentar(() =>
        context.relations.removeConversation(context.vault, args.conversationId),
      );
    } finally {
      // pase lo que pase con los tres almacenes. El indice guarda los turnos ya
      // DESCIFRADOS: si un almacen se para en seco —el de pendientes lo hace a
      // proposito cuando su archivo no abre— y esto quedara fuera, la
      // conversacion ya no estaria en disco pero el personaje podria seguir
      // citandola en el turno siguiente
      context.privateMemory.invalidate();
    }

    // se devuelve el primero y se pierde el resto a proposito: lo que hace
    // falta saber es que el borrado no se completo, y el motivo de un almacen
    // cifrado puede traer dentro lo que no validaba
    if (fallos.length > 0) throw fallos[0];
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
        { name: 'Imagenes y videos', extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] },
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
        // que no ha generado el: no lo ve, no lo abre y no tiene ojos.
        //
        // Va en `caption` y no en `prompt`: `prompt` es lo que se PIDIO al
        // generar, y un adjunto no se genero. Meterlo ahi era el tercer
        // significado del mismo campo, que es exactamente el error que el
        // esquema dice haber corregido al separarlos.
        prompt: null,
        caption: caption.length === 0 ? null : caption,
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

  /**
   * comprueba que modelos sirven para una conversacion.
   *
   * SOLO LECTURA: no añade turnos, no toca la memoria y no gasta nada del
   * proveedor de imagenes. La sonda es el ultimo mensaje del usuario de esa
   * conversacion, replicando un turno real —con sus instrucciones y su
   * personaje—, porque lo que importa no es si un modelo acepta un texto de
   * muestra sino si acepta LO SUYO.
   */
  handle(IPC_INVOKE.vaultCompatibility, vaultCompatibilityArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const store = context.privateConversations;
    const history = await store.read(context.vault, args.conversationId);
    const lastUser = [...history].reverse().find((turn) => turn.role === 'user');
    if (lastUser === undefined) {
      throw new VaultError('esta conversacion no tiene ningun mensaje tuyo con el que probar');
    }

    const before = history.filter((turn) => turn.sequence < lastUser.sequence);

    // la misma eleccion que hace el turno de verdad, y por el mismo camino: una
    // sonda que midiera sobre un prompt sin el bloque de memoria estaria midiendo
    // otra cosa. Tambien dentro de un `try`: aqui no hay turno que perder, pero
    // un almacen ilegible no puede dejar sin comprobacion a los demas modelos
    const sealedMemory = await store.latestMemory(context.vault, args.conversationId);
    let memoria: ChosenMemory = { memory: sealedMemory, source: 'turn', gaps: 0 };
    try {
      memoria = chooseConversationMemory({
        sealed: sealedMemory,
        entry: await context.recaps.entryFor(context.vault, args.conversationId),
        turns: history,
      });
    } catch {
      // el motivo no se registra: traeria dentro la ficha que no valido
      memoria = { memory: sealedMemory, source: 'turn', gaps: 0 };
    }

    const prompt = buildVaultPrompt({
      memory: memoria.memory,
      memorySource: memoria.source,
      memoryGaps: memoria.gaps,
      turns: before.map((turn) => ({ role: turn.role, text: turn.text })),
      message: lastUser.text,
      instructions: await store.latestInstructions(context.vault, args.conversationId),
      character: await store.latestCharacterDescription(context.vault, args.conversationId),
      // no se ofrece generar: esto comprueba el texto, y prometer una imagen
      // aqui gastaria creditos del proveedor de medios sin motivo
      canGenerateImage: false,
    });

    const results = [];
    for (const target of args.targets) {
      const tally = { answered: 0, refused: 0, empty: 0, memoryOk: 0 };
      const signals = new Set<string>();
      /**
       * lo que escribio cada intento. CONTENIDO DE LA BOVEDA.
       *
       * Sale por el IPC como cualquier turno y NO entra en ningun registro: la
       * linea de abajo sigue llevando solo cifras. Que exista esta variable no
       * cambia nada de lo que se guarda —aqui no se guardaba nada y se sigue sin
       * guardar—, solo deja de tirar lo que ya habia vuelto.
       */
      const replies: z.infer<typeof vaultCompatibilityReplySchema>[] = [];
      let error: string | null = null;

      for (let attempt = 0; attempt < args.repetitions; attempt += 1) {
        try {
          const run = await context.controller.runLocalTurn({
            localTurnId: randomUUID(),
            provider: target.provider,
            model: target.model,
            // del candidato, no del panel: aqui se estan COMPARANDO
            // configuraciones, y el esfuerzo es parte de lo que se compara
            ...(target.effort === null ? {} : { effort: target.effort }),
            projectAlias: args.projectAlias,
            prompt,
          });

          const parsed = parseConversationMemoryResponse(run.text);
          const verdict = classifyReply(parsed.visibleText);
          tally[verdict.kind] += 1;
          for (const signal of verdict.signals) signals.add(signal);
          // mismo fallo que el turno: sin el estado del agente, siempre 0
          if (memoryOfTurn(run, parsed).status === 'structured') tally.memoryOk += 1;

          // y se conserva EXACTAMENTE el texto que se acaba de clasificar, no
          // una version limpia aparte. Si se enseñara una cosa y se contara
          // otra, un veredicto raro —un modelo que razona en voz alta y suena a
          // negativa— no se podria revisar leyendo lo que hay al lado, que es
          // justo para lo que sirve enseñarlo. El bloque de memoria ya viene
          // apartado por `parseConversationMemoryResponse`, igual que en el
          // turno de verdad
          const visible = parsed.visibleText.trim();
          // un turno que vuelve sin texto y con un final que no es `completed`
          // no es una respuesta en blanco del modelo: es una llamada que se
          // rompio —401, modelo inexistente, limite— y el agente la resuelve en
          // vez de lanzar, asi que sin esto quedaba una fila muda con «0
          // caracteres» y `error: null`. No deja entrada, igual que el `catch`
          if (visible.length === 0 && run.outcome !== 'completed') {
            error = redact(run.error ?? `la llamada termino como ${run.outcome}`);
            continue;
          }

          const text = trimWithMark(
            visible,
            VAULT_COMPATIBILITY_REPLY_CHARS,
            VAULT_COMPATIBILITY_TRIM_MARK,
          );
          const clipped = visible.length > VAULT_COMPATIBILITY_REPLY_CHARS;
          replies.push({
            attempt: attempt + 1,
            kind: verdict.kind,
            text,
            chars: visible.length,
            // la marca ocupa sitio DENTRO del tope, asi que lo que queda del
            // modelo es lo guardado menos la marca. Se resta aqui, donde se sabe
            // cual es la marca, y no en la pantalla
            kept: clipped ? text.length - VAULT_COMPATIBILITY_TRIM_MARK.length : text.length,
            clipped,
          });
        } catch (failure) {
          // un modelo caido no debe tumbar la comprobacion de los demas, y «no
          // estaba disponible» no es «se nego»: la pasarela avisa de que los
          // modelos buenos escasean para cuentas gratuitas.
          //
          // Este intento no deja entrada en `replies`: no hubo texto que leer, y
          // fabricar una vacia lo haria pasar por una respuesta en blanco del
          // modelo, que es otra cosa
          tally.empty += 1;
          error = redact(failure instanceof Error ? failure.message : String(failure));
        }
      }

      results.push({
        provider: target.provider,
        model: target.model,
        ...tally,
        signals: [...signals],
        error,
        replies,
      });
    }

    // ni el prompt, ni el texto, ni que conversacion: solo cuantos y como.
    //
    // Sigue igual DESPUES de que la sonda devuelva las respuestas, y es la
    // invariante que no se puede relajar: lo que se escribe aqui son enteros.
    // `conversation-recap.test.ts` lo fija con un centinela —una frase que solo
    // existe en la prueba— y comprueba que no aparece en ninguna linea escrita.
    context.log('compatibilidad comprobada', {
      modelos: args.targets.length,
      repeticiones: args.repetitions,
      // cuantas respuestas se devuelven, que es una cifra y no un texto: sin
      // ella no habria forma de ver desde el registro si la sonda esta
      // conservando lo que vuelve o tirandolo otra vez
      respuestas: results.reduce((total, each) => total + each.replies.length, 0),
    });
    return { results };
  });

  /**
   * los recuerdos del personaje, para poder mirarlos.
   *
   * Sirve para diagnosticar: cuando no se acuerde de algo, aqui se ve si el
   * episodio existe y con que titulo quedo. No sirve para crearlos.
   */
  handle(IPC_INVOKE.vaultMemoryList, emptyArgsSchema, async () => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const episodes = await context.privateMemory.listEpisodes(context.vault);
    return {
      episodes: episodes.map((episode, position) => ({
        id: `r${position + 1}`,
        conversationId: episode.conversationId,
        from: episode.from,
        to: episode.to,
        date: episode.startedAt.slice(0, 10),
        title: episode.title,
        turns: episode.turns,
        catalogedBy: episode.catalogedBy ?? null,
      })),
      excluded: [...context.memoryPreferences.excluded()],
    };
  });

  /** los turnos de un episodio, para ver que hay dentro exactamente */
  handle(IPC_INVOKE.vaultMemoryRead, vaultMemoryReadArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const turns = await context.privateConversations.read(context.vault, args.conversationId);
    return {
      turns: turns
        .filter((turn) => turn.sequence >= args.from && turn.sequence <= args.to)
        .map((turn) => ({ role: turn.role, text: turn.text })),
    };
  });

  /**
   * saca una conversacion del banco de recuerdos, o la devuelve.
   *
   * No la borra: los turnos siguen ahi y la conversacion se abre igual. Lo que
   * cambia es si el personaje puede recordarla desde otro sitio.
   */
  handle(IPC_INVOKE.vaultMemoryExclude, vaultMemoryExcludeArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const excluded = context.memoryPreferences.set(args.conversationId, args.excluded);
    // el indice se construyo con la lista anterior
    context.privateMemory.invalidate();

    const episodes = await context.privateMemory.listEpisodes(context.vault);
    context.log('banco de recuerdos actualizado', { excluidas: excluded.length });
    return {
      episodes: episodes.map((episode, position) => ({
        id: `r${position + 1}`,
        conversationId: episode.conversationId,
        from: episode.from,
        to: episode.to,
        date: episode.startedAt.slice(0, 10),
        title: episode.title,
        turns: episode.turns,
        catalogedBy: episode.catalogedBy ?? null,
      })),
      excluded,
    };
  });

  /**
   * cataloga en escenas las conversaciones que lo necesiten.
   *
   * Automatico y no a golpe de boton: lo dispara la pantalla al abrirse. Una
   * llamada por conversacion sin catalogar —no por turno—, en modo TECNICO: el
   * catalogador no encarna a nadie, solo lee y parte.
   *
   * Si el modelo devuelve un catalogo que no cuadra, se descarta entero y esa
   * conversacion se queda con la segmentacion por silencios (`D-060`), que sera
   * tosca pero no miente.
   */
  /**
   * conversaciones cuyo catalogo fallo en esta ejecucion.
   *
   * Sin esto, una que falle siempre —porque el modelo devuelve algo que no
   * cuadra— vuelve a intentarse en CADA apertura del panel, gastando una
   * llamada cada vez y pareciendo que el programa recataloga lo ya hecho. Se
   * olvida al reiniciar, que es cuando tiene sentido volver a probar.
   */
  const catalogFailures = new Set<string>();

  /**
   * el carril del trabajo de fondo: catalogar y apuntar pendientes lo comparten.
   *
   * La guarda va AQUI y no solo en la pantalla porque el fallo no era un doble
   * clic: es una carrera. Dos syncs simultaneos leen la misma lista de
   * pendientes —ninguno ha escrito todavia el catalogo— y catalogan las mismas
   * conversaciones. Se vio en los registros de la pasarela: dos llamadas con
   * los mismos tokens de entrada, a cuatro segundos, las dos con respuesta.
   *
   * Y lo comparte con la extraccion de pendientes porque las dos arrancan un CLI
   * local con una conversacion entera: dos a la vez se pelean por la maquina y,
   * peor, la segunda lee un almacen que la primera esta a punto de reescribir.
   */
  const runOnAuxiliaryLane = createAuxiliaryLane();

  /**
   * conversaciones a las que se les esta contestando ahora mismo.
   *
   * Mientras una este aqui, ningun trabajo de fondo la lee: un mensaje del
   * usuario que todavia no tiene respuesta puede retirarse y su numero
   * reutilizarse, asi que darlo por revisado perderia lo que de verdad se diga.
   */
  const sendInFlight = new Set<string>();

  handle(IPC_INVOKE.vaultCatalogSync, vaultCatalogSyncArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');
    return runOnAuxiliaryLane(() => catalogOnce(args));
  });

  /**
   * apunta las promesas y los planes de lo que ya se hablo.
   *
   * Va por el mismo carril que el catalogo y al mismo sitio: Claude o Codex con
   * la sesion local, nunca una API de pago. Lo dispara el panel al abrirse, el
   * boton «Buscar lo pendiente en lo ya hablado» y, por detras, el final de cada
   * turno privado.
   */
  const relationSync = new RelationSync({
    vault: context.vault,
    conversations: context.privateConversations,
    relations: context.relations,
    preferences: context.memoryPreferences,
    controller: context.controller,
    // la misma linea temporal que ya construye la memoria episodica: leer otra
    // vez todo el historial para esto seria descifrarlo dos veces
    timeline: () => context.privateMemory.timeline(context.vault),
    lane: runOnAuxiliaryLane,
    isSending: (conversationId) => sendInFlight.has(conversationId),
    anchor: () => ({
      instant: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dayStartsAtHour: 5,
    }),
    log: context.log,
  });

  // sin boveda no hay llave con la que sellar: un temporizador que salte despues
  // solo produciria errores
  context.vault.onLock(() => relationSync.cancel());

  /**
   * rellena hacia atras la memoria de las conversaciones que nunca la tuvieron.
   *
   * MISMO carril que el catalogo y los pendientes, y a proposito: los tres
   * arrancan un CLI local con una conversacion entera dentro, asi que dos a la
   * vez se pelean por la maquina y el segundo lee un almacen que el primero esta
   * a punto de reescribir. Y el mismo `isSending`: una conversacion a la que se
   * le esta contestando tiene turnos que aun pueden retirarse, asi que darlos por
   * leidos perderia lo que de verdad se diga ahi.
   *
   * A diferencia de los pendientes, esto NO se dispara al abrir el panel ni al
   * terminar un turno: solo desde su boton. Abrir «Lo que recuerda» no puede
   * convertirse en media hora de proceso arrancando.
   */
  const recapSync = new RecapSync({
    vault: context.vault,
    conversations: context.privateConversations,
    recaps: context.recaps,
    // las escenas ya catalogadas dan los cortes de ventana y el indice deducido
    catalog: context.catalogs,
    preferences: context.memoryPreferences,
    controller: context.controller,
    timeline: () => context.privateMemory.timeline(context.vault),
    lane: runOnAuxiliaryLane,
    isSending: (conversationId) => sendInFlight.has(conversationId),
    anchor: () => ({
      instant: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dayStartsAtHour: 5,
    }),
    log: context.log,
  });

  // la pasada se mira entre VENTANA y ventana, no solo entre conversaciones: una
  // ventana tarda un minuto y la boveda puede cerrarse dentro
  context.vault.onLock(() => recapSync.cancel());

  handle(IPC_INVOKE.vaultRelationSync, vaultRelationSyncArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');
    return relationSync.runOnce({
      projectAlias: args.projectAlias,
      limit: args.limit,
      // pedirla expresamente reintenta aunque se hubiera negado antes, tanto una
      // conversacion concreta como la pasada entera desde el boton
      force: args.force || args.conversationId !== undefined,
      ...(args.conversationId === undefined ? {} : { conversationId: args.conversationId }),
    });
  });

  /**
   * lo apuntado, con la cita literal y si sigue apareciendo en su turno.
   *
   * Se comprueba la cita AQUI y no al enseñarla: la seleccion ya descarta una
   * nota cuyo turno se retiro, asi que sin esto un pendiente podria estar en la
   * lista sin salir jamas y sin que se pudiera saber por que.
   *
   * Se descifran solo las conversaciones que tienen algo apuntado. Leerlas
   * todas costaria la boveda entera en cada pulsacion de un boton, y lo que
   * hace falta es el texto de un puñado de turnos.
   */
  const readRelationList = async (): Promise<{ notes: RelationReviewItem[] }> => {
    const snapshot = await context.relations.read(context.vault);
    const summaries = await context.privateConversations.list(context.vault);
    const owners = new Map(summaries.map((each) => [each.conversationId, each.characterId]));

    const texts = new Map<string, Map<number, string>>();
    for (const conversationId of new Set(
      snapshot.notes.map((note) => note.origin.conversationId),
    )) {
      if (!owners.has(conversationId)) continue;
      const turns = await context.privateConversations.read(context.vault, conversationId);
      texts.set(conversationId, new Map(turns.map((turn) => [turn.sequence, turn.text])));
    }

    return {
      notes: listRelationsForReview({
        notes: snapshot.notes,
        owners,
        turnAt: (ref) => {
          const text = texts.get(ref.conversationId)?.get(ref.sequence);
          return text === undefined ? null : { text };
        },
        anchor: {
          instant: new Date().toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          // el mismo corte que el resto de la boveda: de madrugada se sigue
          // hablando de «esta noche», no de la noche de ayer
          dayStartsAtHour: 5,
        },
      }),
    };
  };

  handle(IPC_INVOKE.vaultRelationList, emptyArgsSchema, async () => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');
    return readRelationList();
  });

  /**
   * la ultima palabra de Daniel.
   *
   * Va por el carril del almacen —`apply` relee dentro—, asi que pulsar un
   * boton mientras el extractor termina una ventana no pierde ninguna de las
   * dos cosas. Y lo que deja escrito es `decidedBy: 'daniel'`, que
   * `mergeExtraction` no toca: sin eso, descartar un falso positivo duraria
   * hasta la siguiente pasada.
   */
  handle(IPC_INVOKE.vaultRelationUpdate, vaultRelationUpdateArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const now = new Date().toISOString();
    await context.relations.apply(context.vault, (current) => {
      if (!current.notes.some((note) => note.id === args.id)) {
        throw new VaultError(
          'ese pendiente ya no esta',
          'vuelve a abrir la lista: puede que se borrara su conversacion',
        );
      }
      return {
        counters: current.counters,
        cursors: current.cursors,
        notes: current.notes.map((note) =>
          note.id === args.id ? decideRelation(note, args.status, now) : note,
        ),
      };
    });

    // ni la cita, ni de quien es, ni a que turno apunta: solo que se decidio
    context.log('pendiente corregido', { estado: args.status, decidido: 'daniel' });
    return readRelationList();
  });

  handle(IPC_INVOKE.vaultRecapSync, vaultRecapSyncArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');
    return recapSync.runOnce({
      projectAlias: args.projectAlias,
      limit: args.limit,
      // `force` NO se deduce de que venga una conversacion, al reves que en los
      // pendientes: aqui significa «empezar esa conversacion DESDE CERO», asi
      // que deducirlo tiraria lo ya resumido cada vez que se pidiera continuar
      // una sola. Quien quiere rehacerla manda las dos cosas
      force: args.force,
      dryRun: args.dryRun,
      ...(args.conversationId === undefined ? {} : { conversationId: args.conversationId }),
    });
  });

  /**
   * lo rellenado, con su ficha entera y la linea de cobertura.
   *
   * Lleva el bloque COMPLETO a proposito, igual que los pendientes llevan la
   * cita: hoy no hay ni una pantalla en todo Luxy donde se pueda leer la memoria
   * de una conversacion, y desde el primer turno nuevo el modelo de pago va a
   * arrastrar lo que aqui ponga para siempre. Lo que NUNCA sale de aqui es lo
   * que dijo el CLI cuando se nego a escribirla: de eso viaja la clasificacion.
   */
  const readRecapList = async (): Promise<z.infer<typeof vaultRecapListResultSchema>> => {
    const snapshot = await context.recaps.read(context.vault);
    const summaries = await context.privateConversations.list(context.vault);
    const excluded = context.memoryPreferences.excluded();
    const anchor = {
      instant: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // el mismo corte que el resto de la boveda: de madrugada se sigue hablando
      // de «esta noche», no de la noche de ayer
      dayStartsAtHour: 5,
    };

    // del indice que ya esta construido: descifrar otra vez el historial entero
    // en cada pulsacion de un boton costaria la boveda completa
    const turnsOf = new Map<string, RecapTurnRef[]>();
    for (const turn of await context.privateMemory.timeline(context.vault)) {
      const ref = { sequence: turn.sequence, createdAt: turn.createdAt };
      const own = turnsOf.get(turn.conversationId);
      if (own === undefined) turnsOf.set(turn.conversationId, [ref]);
      else own.push(ref);
    }

    /**
     * los turnos de una conversacion, midiendo lo MISMO que mide el turno.
     *
     * El indice episodico no sirve solo: se salta las excluidas, y una
     * construccion abortada por un `invalidate` a la vez lo deja vacio entero.
     * Con esa lista, `chooseConversationMemory` contestaba «no llega hasta los
     * ultimos turnos» de una ficha que el turno SI estaba metiendo en el
     * prompt, porque el camino del turno lee el historial de verdad y no
     * consulta las exclusiones. El panel decia entonces «cubre 0 de 18» de algo
     * en uso.
     *
     * Asi que cuando el indice no puede medir una conversacion que si tiene
     * turnos, se descifra esa y solo esa. Son las excluidas, que son pocas, y
     * el caso raro de la carrera; el camino normal sigue saliendo del indice.
     */
    const turnRefs = async (summary: {
      conversationId: string;
      turns: number;
    }): Promise<RecapTurnRef[]> => {
      const known = turnsOf.get(summary.conversationId);
      if (known !== undefined && known.length > 0) return known;
      if (summary.turns === 0) return [];
      const full = await context.privateConversations.read(
        context.vault,
        summary.conversationId,
      );
      const refs = full.map((turn) => ({
        sequence: turn.sequence,
        createdAt: turn.createdAt,
      }));
      turnsOf.set(summary.conversationId, refs);
      return refs;
    };

    // la sellada gana siempre. Sin mirarla, el panel diria «resumida» de una
    // conversacion cuyo relleno el turno ni llega a mirar
    const sealed = new Set<string>();
    for (const summary of summaries) {
      const memory = await context.privateConversations.latestMemory(
        context.vault,
        summary.conversationId,
      );
      if (memory !== null) sealed.add(summary.conversationId);
    }

    const byEntry = new Map(snapshot.entries.map((entry) => [entry.conversationId, entry]));
    for (const summary of summaries) {
      // solo hace falta medir las que se van a juzgar: una sin entrada y sin
      // ficha no necesita sus turnos para nada
      if (byEntry.has(summary.conversationId)) await turnRefs(summary);
    }

    const coverage = recapCoverage({
      conversations: summaries.map((summary) => ({
        conversationId: summary.conversationId,
        sealed: sealed.has(summary.conversationId),
        excluded: excluded.has(summary.conversationId),
        turns: turnsOf.get(summary.conversationId) ?? [],
      })),
      entries: snapshot.entries,
    });

    /**
     * una fila por CONVERSACION rellenable, no por entrada del almacen.
     *
     * Las que todavia no tienen entrada salen igual, vacias. Hacen dos cosas
     * que antes no hacia nadie: contestar «¿cuales quedaron sin resumir?»
     * —antes solo existia como numero— y dar un «Rehacerlo» a la conversacion
     * que ni se pudo leer ni se pudo guardar, que es la que el aviso mandaba
     * reintentar desde un boton que no existia.
     *
     * Una entrada cuya conversacion ya no esta no produce fila: sin titulo ni
     * turnos no hay nada que juzgar, y de quitarla se encarga el borrado.
     */
    const rows: z.infer<typeof vaultRecapListResultSchema>['rows'] = [];
    for (const summary of summaries) {
      const entry = byEntry.get(summary.conversationId);
      const esSellada = sealed.has(summary.conversationId);
      const esExcluida = excluded.has(summary.conversationId);
      // sin entrada, solo sale lo que la pasada podria coger algun dia
      if (entry === undefined && (esExcluida || summary.turns === 0)) continue;

      const turns = turnsOf.get(summary.conversationId) ?? [];
      // la MISMA funcion que decide en el turno, con la sellada tratada aparte
      // exactamente como hace `recapCoverage`: si el panel y el prompt pudieran
      // discrepar, «resumida» dejaria de significar nada
      const chosen =
        entry === undefined || esSellada
          ? null
          : chooseConversationMemory({ sealed: null, entry, turns });

      rows.push({
        conversationId: summary.conversationId,
        title: summary.title,
        day: civilDayLabel(summary.updatedAt, anchor),
        // turnos de VERDAD dentro del tramo, no `to - from`: un numero de
        // secuencia retirado dejaria un hueco que inflaria la cuenta y haria
        // decir «cubre 41 de 40»
        covered:
          entry === undefined || entry.memory === null
            ? 0
            : turns.filter(
                (turn) =>
                  turn.sequence >= entry.covered.from && turn.sequence <= entry.covered.to,
              ).length,
        turns: summary.turns,
        block:
          entry === undefined || entry.memory === null
            ? ''
            : formatConversationMemory(entry.memory),
        chars: entry?.chars ?? 0,
        source: entry?.source ?? 'cli',
        gaps: entry?.gaps.length ?? 0,
        approved: entry?.approved ?? false,
        provider: entry?.provider ?? null,
        model: entry?.model ?? null,
        at: entry?.at ?? summary.updatedAt,
        refusedKind: entry?.refusedKind ?? null,
        refusedProvider: entry?.refusedProvider ?? null,
        superseded: entry !== undefined && entry.supersededAt !== null,
        sealed: esSellada,
        excluded: esExcluida,
        hasEntry: entry !== undefined,
        inPrompt: chosen !== null && chosen.memory !== null && chosen.source !== 'turn',
      });
    }

    return { rows, coverage };
  };

  handle(IPC_INVOKE.vaultRecapList, emptyArgsSchema, async () => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');
    return readRecapList();
  });

  /**
   * la ultima palabra de Daniel sobre una ficha retroactiva.
   *
   * Tres verbos y ninguna edicion libre. Por defecto una ficha escrita por un
   * CLI NO entra en ningun prompt hasta que la aprueba, porque lo que ponga ahi
   * se propaga a todos los turnos futuros de ese hilo; «olvidar» la quita y
   * devuelve esa conversacion a su aviso de turnos omitidos, que es el estado
   * seguro. Eso hace el trabajo entero reversible.
   */
  handle(IPC_INVOKE.vaultRecapUpdate, vaultRecapUpdateArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    if (args.action === 'forget') {
      const entry = await context.recaps.entryFor(context.vault, args.conversationId);
      if (entry === undefined) {
        throw new VaultError(
          'esa ficha ya no esta',
          'vuelve a abrir la lista: puede que se borrara su conversacion',
        );
      }
      await context.recaps.removeConversation(context.vault, args.conversationId);
      // ni el titulo, ni una entrada, ni de que conversacion: una cifra
      context.log('memoria de lo ya hablado corregida', { accion: 'olvidar', fichas: 1 });
      return readRecapList();
    }

    // se saca del `args` aqui y no dentro del mutador: el estrechamiento de una
    // union discriminada no sobrevive a entrar en otra funcion
    const only = args.action === 'approve' ? args.conversationId : null;
    let aprobadas = 0;
    await context.recaps.apply(context.vault, (current) => {
      if (only !== null && !current.entries.some((each) => each.conversationId === only)) {
        throw new VaultError(
          'esa ficha ya no esta',
          'vuelve a abrir la lista: puede que se borrara su conversacion',
        );
      }
      return {
        counters: current.counters,
        entries: current.entries.map((entry) => {
          if (only !== null && entry.conversationId !== only) return entry;
          // aprobar lo que no es una ficha —una negativa, o una conversacion que
          // ya tiene memoria propia— no la haria entrar en ningun prompt y
          // dejaria en disco un `approved` que no significa nada
          if (entry.memory === null || entry.supersededAt !== null) return entry;
          if (entry.approved) return entry;
          aprobadas += 1;
          return { ...entry, approved: true };
        }),
      };
    });

    context.log('memoria de lo ya hablado corregida', {
      accion: only === null ? 'aprobar-todas' : 'aprobar',
      fichas: aprobadas,
    });
    return readRecapList();
  });

  /**
   * quien hace el trabajo de fondo: lo elegido, o `null` si es automatico.
   *
   * No exige la boveda abierta: es el nombre de un CLI, nada de la boveda.
   */
  handle(IPC_INVOKE.vaultAuxiliaryGet, vaultAuxiliaryGetArgsSchema, async () =>
    context.memoryPreferences.auxiliary(),
  );

  handle(IPC_INVOKE.vaultAuxiliarySet, vaultAuxiliarySetArgsSchema, async (args) => {
    const elegido = context.memoryPreferences.setAuxiliary(args.choice);
    context.log('trabajo de fondo elegido', { proveedor: elegido?.provider ?? 'automatico' });
    return elegido;
  });

  /** una tanda de catalogado. La serializacion la pone quien la llama */
  const catalogOnce = async (args: z.infer<typeof vaultCatalogSyncArgsSchema>) => {

    // el trabajo de fondo NUNCA va a la API de pago de la ventana: con DeepSeek
    // elegido, abrir «Lo que recuerda» costaba una llamada por conversacion
    // pendiente. Va a Claude o Codex, con la sesion local
    const destino = resolveAuxiliaryTarget(
      { provider: args.provider, model: args.model, effort: args.effort },
      context.memoryPreferences.auxiliary(),
    );

    const existing = await context.catalogs.list(context.vault);
    const conversations = await context.privateConversations.list(context.vault);
    const excluded = context.memoryPreferences.excluded();

    const pending = conversations.filter((conversation) => {
      if (excluded.has(conversation.conversationId)) return false;
      if (args.conversationId !== undefined) {
        // pedirla expresamente reintenta aunque haya fallado antes
        return conversation.conversationId === args.conversationId;
      }
      if (catalogFailures.has(conversation.conversationId)) return false;
      const own = existing.filter((scene) => scene.conversationId === conversation.conversationId);
      if (own.length === 0) return true;
      // un catalogo se queda corto en cuanto la conversacion crece: hay escenas
      // nuevas que nadie ha leido
      return own.every((scene) => scene.turnsAtCatalog < conversation.turns);
    });

    let cataloged = 0;
    let scenes = 0;
    const failed: { conversationId: string; reason: string }[] = [];
    const uneven: { conversationId: string; scenes: number }[] = [];

    for (const conversation of pending.slice(0, args.limit)) {
      const turns = await context.privateConversations.read(
        context.vault,
        conversation.conversationId,
      );
      if (turns.length === 0) continue;

      const shown = turns.slice(0, CATALOG_MAX_TURNS);
      const range = {
        from: shown[0]!.sequence,
        to: shown[shown.length - 1]!.sequence,
      };

      try {
        const run = await context.controller.runLocalTurn({
          localTurnId: randomUUID(),
          provider: destino.provider,
          model: destino.model,
          // se multiplica por la tanda: esto no es una llamada, son `limit`
          ...(destino.effort === null ? {} : { effort: destino.effort }),
          projectAlias: args.projectAlias,
          prompt: buildCatalogPrompt(
            shown.map((turn) => ({
              sequence: turn.sequence,
              role: turn.role,
              text: turn.text,
            })),
          ),
          // catalogar es una tarea sobre un texto: nada de encarnar a nadie
          kind: 'technical',
        });

        const parsed = parseCatalogResponse(run.text, range);
        if (parsed.status !== 'structured') {
          catalogFailures.add(conversation.conversationId);
          failed.push({
            conversationId: conversation.conversationId,
            // con lo que dijo en su lugar: es lo unico que distingue «no supo»
            // de «se nego». Pasa por redact como todo lo que sale de un modelo
            reason: redact(describeCatalogFailure(parsed, run.text)),
          });
          continue;
        }

        await context.catalogs.replaceForConversation(
          context.vault,
          conversation.conversationId,
          parsed.scenes.map((scene) => ({
            ...scene,
            conversationId: conversation.conversationId,
            model: run.executedModel ?? destino.model,
            catalogedAt: new Date().toISOString(),
            turnsAtCatalog: turns.length,
          })),
        );
        // si venia marcada como fallida, deja de estarlo: se acaba de lograr
        catalogFailures.delete(conversation.conversationId);
        cataloged += 1;
        scenes += parsed.scenes.length;

        // todas las escenas del mismo tamaño no es como fue la conversacion:
        // es que no encontro donde cortar y repartio. El catalogo se conserva
        // —uno tosco es mejor que ninguno— y solo se avisa
        const reparto = detectEvenSplit(parsed.scenes);
        if (reparto.even) {
          uneven.push({
            conversationId: conversation.conversationId,
            scenes: reparto.scenes,
          });
        }
      } catch (error) {
        catalogFailures.add(conversation.conversationId);
        failed.push({
          conversationId: conversation.conversationId,
          reason: redact(error instanceof Error ? error.message : String(error)),
        });
      }
    }

    if (cataloged > 0) context.privateMemory.invalidate();
    // ni un titulo, ni una etiqueta, ni de que conversacion: solo cuantas
    context.log('escenas catalogadas', {
      conversaciones: cataloged,
      escenas: scenes,
      fallidas: failed.length,
      // quien lo hizo, y si se sustituyo un proveedor de pago
      proveedor: destino.provider,
      sustituido: destino.replaced,
    });
    return {
      cataloged,
      scenes,
      failed,
      uneven,
      // las que quedaban menos las que se han hecho o descartado en esta tanda
      pending: Math.max(0, pending.length - Math.min(pending.length, args.limit)),
    };
  };

  /**
   * la ultima imagen de esta conversacion que NO llego a generarse.
   *
   * El personaje no se enteraba de que su imagen habia fallado: el turno
   * guarda el texto y nada mas, asi que en el turno siguiente daba por hecho
   * que la mando. Cuando el usuario decia «no me ha llegado, mandame otra
   * igual», ella copiaba el prompt de la ultima imagen GUARDADA —que era una
   * vieja, porque la fallida nunca se guardo— y devolvia aquella escena.
   *
   * Vive en memoria y no en la boveda: es informacion de un turno para el
   * siguiente, y perderla al reiniciar no rompe nada. Guardar el motivo en el
   * historial cifrado seria escribir un fallo tecnico dentro de una
   * conversacion, que es justo lo que `D-020` separa.
   */
  const ultimaImagenFallida = new Map<string, string>();

  /** la lista tal y como la ve el renderer; la usan el listado y las correcciones */
  const listMediaForRenderer = async (conversationId: string) => {
    const items = await context.privateMedia.list(context.vault, conversationId);
    return items.map((item) => ({
      mediaId: item.mediaId,
      mimeType: item.metadata.mimeType,
      displayName: item.metadata.displayName,
      byteSize: 0,
      hasThumbnail: item.hasThumbnail,
      previewable: true,
      caption: item.metadata.caption ?? null,
      prompt: item.metadata.prompt,
      // QUIEN la dibujo, que no es el primero de la lista de la receta: se
      // mandan varios modelos para que la coja el que este libre, y cada uno
      // da una cara distinta. Estaba guardado y no se veia en ningun sitio,
      // asi que dos imagenes de la misma semilla salian distintas sin que
      // hubiera forma de saber por que
      model: item.metadata.model,
    }));
  };

  handle(IPC_INVOKE.vaultMediaList, vaultMediaListArgsSchema, async (args) => ({
    media: await listMediaForRenderer(args.conversationId),
  }));

  /**
   * corrige a mano el pie de foto de un medio.
   *
   * Es lo UNICO que el modelo sabe de una imagen guardada, y con ello decide
   * cual reenviarte en vez de pagar otra generacion. Hasta ahora no se podia ni
   * ver ni corregir: elegia a partir de una linea invisible, y en el avatar
   * copiado esa linea era siempre «su foto de perfil».
   */
  handle(IPC_INVOKE.vaultMediaCaption, vaultMediaCaptionArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');
    const limpio = args.caption.trim();
    await context.privateMedia.setCaption(
      context.vault,
      args.conversationId,
      args.mediaId,
      // vaciarlo lo deja SIN pie de foto, que es distinto de no tocarlo: es la
      // unica forma de retirar una descripcion equivocada
      limpio.length === 0 ? null : limpio,
    );
    // ni el texto ni de que imagen es
    context.log('pie de foto corregido');
    return { media: await listMediaForRenderer(args.conversationId) };
  });

  /**
   * le pide a un modelo con vista que describa una imagen.
   *
   * Gasta una llamada, asi que lo dispara el usuario. Va en modo TECNICO: es
   * una descripcion de un archivo, no una escena, y pedirsela a quien esta
   * encarnando a alguien mezcla dos cosas distintas (`D-055`).
   *
   * Una negativa NO se guarda como pie de foto. Guardarla seria lo peor de los
   * dos mundos: el modelo creeria que la imagen ES esa frase y la reenviaria
   * describiendola asi.
   */
  handle(IPC_INVOKE.vaultMediaDescribe, vaultMediaDescribeArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const { bytes, mimeType } = await context.privateMedia.read(
      context.vault,
      args.conversationId,
      args.mediaId,
    );
    if (!mimeType.startsWith('image/')) {
      throw new VaultError(
        'solo se pueden describir imagenes',
        'un video no se puede mirar de una sola vez; describelo a mano',
      );
    }
    // y aunque sea una imagen, puede ser de un formato que ningun proveedor
    // sepa leer. Se para aqui, sin gastar la llamada: el mismo caso en el banco
    // costo una peticion para recibir «invalid image data»
    const transporte = imageTransportProblem(mimeType);
    if (transporte !== null) {
      throw new VaultError('ese formato de imagen no se puede mandar', transporte);
    }

    const run = await context.controller.runLocalTurn({
      localTurnId: randomUUID(),
      provider: args.provider,
      model: args.model,
      projectAlias: args.projectAlias,
      prompt: buildDescribePrompt(),
      // su propio presupuesto de salida, no el 8192 de la conexion: se
      // guardan 1.900 caracteres como mucho, y pedir de mas hace que Groq
      // rechace la peticion entera cuando supera el limite del modelo
      maxOutputTokens: DESCRIBE_MAX_OUTPUT_TOKENS,
      // el de VISION, que va con el modelo que mira. Describir bien una foto es
      // justo donde pensar mas puede valer la pena, y donde mas caro sale
      // hacerlo sin querer
      ...(args.effort === null ? {} : { effort: args.effort }),
      kind: 'technical',
      // base64 PURO: el prefijo `data:` lo compone el proveedor, que lo quiere
      // a su manera segun con quien hable
      images: [{ mimeType, base64: Buffer.from(bytes).toString('base64') }],
    });

    // un turno que FALLA no es un modelo que no contesta: contarlo igual pedia
    // repetir algo que no puede funcionar y escondia el motivo
    if (run.outcome !== 'completed') {
      throw new VaultError(
        run.error ?? `la llamada termino como ${run.outcome}`,
        'no es que el modelo no supiera describirla: la llamada no llego a completarse',
      );
    }

    // una negativa llega como un turno normal y parece una descripcion rara
    // se clasifica lo VISIBLE, no el razonamiento: un modelo puede sopesar en
    // voz alta si debe negarse y luego contestar con normalidad, y mirar el
    // texto entero convertiria ese titubeo en un rechazo que nunca ocurrio
    const refused = classifyReply(splitReasoning(run.text).visible).kind === 'refused';
    const described = parseDescribeResponse(run.text, refused);
    if (described.caption === null) {
      return { caption: null, failure: described.failure, reasoning: described.reasoning };
    }

    await context.privateMedia.setCaption(
      context.vault,
      args.conversationId,
      args.mediaId,
      described.caption,
    );
    // ni la descripcion ni de que imagen es: solo que se pudo
    context.log('imagen descrita por un modelo');
    return { caption: described.caption, failure: null, reasoning: described.reasoning };
  });

  /**
   * reescribe un pie de foto en español correcto sin cambiar lo que dice.
   *
   * Existe porque los modelos con vista que hay ven bien y redactan mal:
   * «figura femenina de proporcionadas masculinas adultas». Ese texto es el que
   * despues lee el personaje como un hecho sobre la imagen, y corregirlo a mano
   * carácter a carácter es justo lo que nadie hace.
   *
   * TRES COSAS QUE NO HACE, y las tres a proposito:
   *
   * 1. **no toca la boveda.** Ni lee el medio ni escribe el pie de foto. Entra
   *    texto y sale texto, asi que vale igual para lo que se esta escribiendo
   *    sin guardar, y la reformulacion vuelve al recuadro para aceptarla o
   *    tirarla. Un boton que escribiera directamente cambiaria un texto
   *    verdadero por otro que nadie ha leido;
   * 2. **no manda la imagen.** El modelo solo ve el texto, asi que cualquier
   *    detalle nuevo seria inventado por definicion. De ahi que el prompt
   *    prohiba añadir: un reformulador que «mejora» produce `D-061`, un dato
   *    falso sobre una imagen que nadie va a volver a mirar;
   * 3. **no exige un modelo con vista.** Es texto plano: sirve cualquiera, y
   *    conviene que sea uno que escriba bien en español, no uno que mire bien.
   *
   * En modo TECNICO, como el describidor: es una correccion de estilo sobre un
   * archivo, no una escena (`D-055`).
   */
  handle(IPC_INVOKE.vaultMediaRewriteCaption, vaultMediaRewriteCaptionArgsSchema, async (args) => {
    // el texto es contenido de la boveda aunque llegue por parametro
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const run = await context.controller.runLocalTurn({
      localTurnId: randomUUID(),
      provider: args.provider,
      model: args.model,
      projectAlias: args.projectAlias,
      prompt: buildRewriteCaptionPrompt(args.caption),
      ...(args.effort === null ? {} : { effort: args.effort }),
      // el mismo presupuesto que el describidor y por el mismo motivo: la
      // salida es del mismo tamaño —un pie de foto— y pedir de mas hace que
      // Groq rechace la peticion entera en vez de recortarla
      maxOutputTokens: DESCRIBE_MAX_OUTPUT_TOKENS,
      kind: 'technical',
    });

    if (run.outcome !== 'completed') {
      throw new VaultError(
        run.error ?? `la llamada termino como ${run.outcome}`,
        'no es que el modelo no supiera reescribirlo: la llamada no llego a completarse',
      );
    }

    // un pie de foto explicito puede hacer que un modelo se niegue a tocarlo, y
    // esa negativa parece una reformulacion cortisima. Se clasifica lo VISIBLE,
    // no el razonamiento
    const refused = classifyReply(splitReasoning(run.text).visible).kind === 'refused';
    const rewritten = parseRewriteResponse(run.text, refused);
    // ni el texto de antes ni el de despues: solo que se pudo
    context.log('pie de foto reescrito por un modelo');
    return rewritten;
  });

  /**
   * diagnostico de la memoria sobre TODAS las conversaciones, en cifras.
   *
   * Lo pidio Daniel: que cada mejora incluya lo ya hablado y poder comprobarlo
   * sobre ello, y ver su forma de hablarle. Leerlas desde fuera las sacaria de
   * la boveda —copiarlas a una conversacion con un asistente las dejaria en
   * claro en el disco—, asi que corre AQUI, con la llave abierta, y solo
   * devuelve numeros.
   *
   * Sin llamadas a ningun modelo: todo es local y cuesta lo que leer los
   * turnos, que ya se leen para construir el indice.
   */
  handle(IPC_INVOKE.vaultMemoryDiagnostics, vaultMemoryDiagnosticsArgsSchema, async () => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const store = context.privateConversations;
    const todas = await store.list(context.vault);
    // un turno real solo ve los recuerdos de SU personaje (`D-058`): mezclar los
    // de todos daria cifras de una memoria que no existe. Se mide el personaje
    // con mas conversaciones, que es con quien se habla
    const cuantas = new Map<string | null, number>();
    for (const conversacion of todas) {
      cuantas.set(conversacion.characterId, (cuantas.get(conversacion.characterId) ?? 0) + 1);
    }
    // `null` —sin personaje— solo cuenta si no hay ninguna con personaje: unas
    // pruebas sin personaje podian ser mayoria y dejar fuera a quien importa
    const conPersonaje = [...cuantas.entries()].filter(([id]) => id !== null);
    const principal =
      (conPersonaje.length > 0 ? conPersonaje : [...cuantas.entries()]).sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0] ?? null;
    // para que la pantalla diga a quien ha medido; al registro no va
    const nombre =
      principal === null
        ? null
        : ((await context.characters.list(context.vault)).find(
            (entry) => entry.characterId === principal,
          )?.label ?? null);
    const conversaciones = todas.filter((conversacion) => conversacion.characterId === principal);

    // con su hora, su conversacion y su numero de turno: el diagnostico pasa cada
    // mensaje por la memoria tal y como estaba cuando se escribio, con la misma
    // ventana de historial reciente que un turno real
    const userMessages: DiagnosticMessage[] = [];
    // y las suyas, que son donde se mira si reclama algo que no consta
    const replies: CharacterReply[] = [];
    for (const conversacion of conversaciones) {
      const turnos = await store.read(context.vault, conversacion.conversationId);
      for (const turno of turnos) {
        if (turno.role === 'user') {
          userMessages.push({
            text: turno.text,
            createdAt: turno.createdAt,
            conversationId: conversacion.conversationId,
            sequence: turno.sequence,
          });
        } else {
          replies.push({
            text: turno.text,
            createdAt: turno.createdAt,
            characterId: conversacion.characterId,
          });
        }
      }
    }

    // el mismo ancla que un turno real, o la prueba mediria otra cosa. Se saca
    // fuera para que los dos diagnosticos usen el mismo instante: con dos
    // relojes, «hace 30 dias» podria caer a un lado en uno y al otro en el otro
    const anchor = {
      instant: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dayStartsAtHour: 5,
    };

    const diagnostico = diagnoseMemory({
      episodes: await context.privateMemory.listEpisodes(context.vault, principal),
      userMessages,
      conversationIds: conversaciones.map((conversacion) => conversacion.conversationId),
      otherConversations: todas.length - conversaciones.length,
      characterName: nombre,
      anchor,
    });

    // los pendientes van aparte y NO pueden tumbar el resto: un almacen que no
    // se abre es justo lo que hay que poder ver, y perder tambien las cifras de
    // la memoria por eso dejaria a Daniel sin nada que mirar
    let relations: ReturnType<typeof diagnoseRelations> | undefined;
    try {
      const apuntado = await context.relations.read(context.vault);
      relations = diagnoseRelations({
        notes: apuntado.notes,
        cursors: apuntado.cursors,
        counters: apuntado.counters,
        droppedOnRead: apuntado.droppedOnRead,
        conversations: todas.map((conversacion) => ({
          conversationId: conversacion.conversationId,
          characterId: conversacion.characterId,
        })),
        excluded: context.memoryPreferences.excluded(),
        // la de TODOS los personajes: las notas se reparten por su conversacion
        // de origen, no por quien se este midiendo
        timeline: await context.privateMemory.timeline(context.vault),
        userMessages,
        replies,
        catalog: await context.catalogs.list(context.vault),
        // del indice que ya esta construido: sin descifrar nada otra vez
        turnAt: (ref) => context.privateMemory.turnAt(ref.conversationId, ref.sequence),
        failedThisSession: relationSync.failedThisSession,
        // las que no se han podido leer no cuentan como desfase: la misma regla
        // que en un turno real, o la simulacion mediria otra cosa
        failedConversations: relationSync.failedConversations,
        auxiliaryConfigured: context.memoryPreferences.auxiliary() !== null,
        anchor,
      });
    } catch (error) {
      // el motivo NO se escribe, igual que en el camino del turno. Aqui se
      // descifran el historial, el catalogo y el almacen de pendientes: un error
      // de ruta trae el uuid de la conversacion y uno de validacion trae dentro
      // el dato que no valido, que es una cita. `redact` tapa secretos, no la
      // boveda. Lo unico que hace falta saber es que no se pudo, y eso ya se ve
      // en que el resultado sale sin `relations`
      context.log('diagnostico de pendientes fallido', {
        leido: false,
        // de donde vino, sin decir que decia: una boveda cerrada se arregla de
        // una forma y un archivo roto de otra
        causa: error instanceof VaultError ? 'boveda' : 'otro',
      });
    }

    // cuantas conversaciones tienen memoria de lo ya hablado, y de que clase.
    //
    // Hasta ahora el diagnostico media catalogo, fechas, estilo y disparos y NO
    // media esto: cuantas conversaciones pueden retomarse. Va aparte y en su
    // propio `try` por el mismo motivo que los pendientes, y sus cinco numeros
    // SUMAN —`total − excluded`—; si no cuadran es un fallo, no un redondeo.
    let recaps: RecapCoverage | undefined;
    try {
      const guardado = await context.recaps.read(context.vault);
      const turnosDe = new Map<string, RecapTurnRef[]>();
      for (const turno of await context.privateMemory.timeline(context.vault)) {
        const ref = { sequence: turno.sequence, createdAt: turno.createdAt };
        const propios = turnosDe.get(turno.conversationId);
        if (propios === undefined) turnosDe.set(turno.conversationId, [ref]);
        else propios.push(ref);
      }
      // y las que el indice no puede medir —las excluidas, y todas si una
      // construccion se abortó a medias— se descifran una a una. Sin esto, el
      // diagnostico contaba «sin nada» una conversacion cuya ficha el turno si
      // esta usando, que es justo la cifra por la que existe esta linea
      for (const conversacion of todas) {
        const conEntrada = guardado.entries.some(
          (entrada) => entrada.conversationId === conversacion.conversationId,
        );
        if (!conEntrada) continue;
        const propios = turnosDe.get(conversacion.conversationId);
        if (propios !== undefined && propios.length > 0) continue;
        const completa = await store.read(context.vault, conversacion.conversationId);
        turnosDe.set(
          conversacion.conversationId,
          completa.map((turno) => ({ sequence: turno.sequence, createdAt: turno.createdAt })),
        );
      }
      const conSellada = new Set<string>();
      for (const conversacion of todas) {
        const sellada = await store.latestMemory(context.vault, conversacion.conversationId);
        if (sellada !== null) conSellada.add(conversacion.conversationId);
      }
      const excluidas = context.memoryPreferences.excluded();
      recaps = recapCoverage({
        conversations: todas.map((conversacion) => ({
          conversationId: conversacion.conversationId,
          sealed: conSellada.has(conversacion.conversationId),
          excluded: excluidas.has(conversacion.conversationId),
          turns: turnosDe.get(conversacion.conversationId) ?? [],
        })),
        entries: guardado.entries,
      });
    } catch (error) {
      // el motivo NO se escribe: un error de validacion trae dentro la ficha que
      // no valido, y esa ficha es un resumen de la conversacion
      context.log('diagnostico de memoria retroactiva fallido', {
        leido: false,
        causa: error instanceof VaultError ? 'boveda' : 'otro',
      });
    }

    // CIFRAS, nunca texto. Los dias fallidos son cuando se hablo, no que se
    // dijo, y el registro ya lleva la hora de cada turno
    context.log('diagnostico de memoria', {
      conversaciones: diagnostico.conversations,
      // el nombre del personaje NO: el registro lleva cifras
      alcance: { otrasConversaciones: diagnostico.scope.otherConversations },
      episodios: diagnostico.episodes,
      indice: diagnostico.index,
      busquedaPorFecha: diagnostico.dateRecall,
      principio: diagnostico.origin,
      estilo: diagnostico.style,
      disparos: diagnostico.triggers,
      // enteros y booleanos, como todo lo demas: ni una cita ni un identificador
      ...(relations === undefined ? {} : { relaciones: relations }),
      // cinco cifras que suman: es la linea de cobertura del panel, medida aqui
      ...(recaps === undefined ? {} : { memoriaRetroactiva: recaps }),
    });
    return {
      ...diagnostico,
      ...(relations === undefined ? {} : { relations }),
      ...(recaps === undefined ? {} : { recaps }),
    };
  });

  /**
   * prueba de vision: una imagen del disco, un modelo, y la descripcion.
   *
   * **No escribe NADA.** Ni en la boveda, ni en la conversacion, ni en el pie
   * de foto de nada. Existe por dos motivos concretos:
   *
   * 1. saber si un modelo sabe mirar ANTES de confiarle una imagen privada. Con
   *    46 modelos en el catalogo, averiguarlo gastando llamadas sobre contenido
   *    de la boveda es lo que no se quiere hacer;
   * 2. no obligar a crear una conversacion solo para probarlo: adjuntar exige
   *    una conversacion porque los medios cuelgan de ella, y para una prueba eso
   *    deja basura dentro.
   *
   * El archivo lo elige el usuario en su disco y los bytes NO cruzan el IPC de
   * ida: los lee el proceso principal. Solo vuelve una copia para verla al lado
   * del texto, y solo si es pequeña.
   */
  handle(IPC_INVOKE.vaultVisionProbe, vaultVisionProbeArgsSchema, async (args) => {
    const window = context.getMainWindow();
    if (window === null) throw new VaultError('no hay ventana desde la que elegir un archivo');

    const picked = await dialog.showOpenDialog(window, {
      title: 'Elige una imagen para la prueba',
      properties: ['openFile'],
      filters: [{ name: 'Imagenes', extensions: [...IMAGE_EXTENSIONS] }],
    });
    const filePath = picked.filePaths[0];
    if (picked.canceled || filePath === undefined) {
      return {
        cancelled: true,
        fileName: null,
        mimeType: null,
        byteSize: 0,
        dataUrl: null,
        caption: null,
        failure: null,
        reasoning: null,
        error: null,
        executedModel: null,
      };
    }

    const bytes = new Uint8Array(readFileSync(filePath));
    const mimeType = mimeTypeFor(filePath);

    // un formato que no sabemos nombrar se para AQUI, y no en el limite entre
    // procesos.
    //
    // Sin esta guarda el turno cruzaba el IPC con `application/octet-stream`,
    // el esquema del host lo rechazaba por no casar con `^image/` y
    // `host-entry` lo DESCARTABA EN SILENCIO, sin contestar nada: la ventana se
    // quedaba en «Mirando…» hasta agotar el timeout del turno y entonces decia
    // «el agente no respondio a tiempo», que señala al agente cuando el
    // problema era la extension del archivo. La misma guarda ya existe en
    // `vaultMediaDescribe`; aqui faltaba.
    // dos muros distintos, y el segundo lo aprendimos pagando una llamada:
    // que Luxy sepa NOMBRAR el formato no significa que el proveedor sepa
    // LEERLO. Groq devolvio «invalid image data» con un avif perfectamente
    // etiquetado. Los dos se comprueban aqui, antes de gastar nada
    const problema = !isKnownImage(filePath)
      ? `Luxy no sabe que tipo de imagen es un .${basename(filePath).split('.').pop() ?? ''}, asi que no puede mandarlo. Conviertelo a png, jpg o webp.`
      : imageTransportProblem(mimeType);
    if (problema !== null) {
      return {
        cancelled: false,
        fileName: basename(filePath),
        mimeType,
        byteSize: bytes.length,
        // la vista previa SI se enseña: Chromium sabe pintarla, y verla al lado
        // del motivo es lo que hace evidente que el archivo esta bien y lo que
        // falla es el formato
        dataUrl:
          bytes.length > VAULT_PREVIEW_MAX_BYTES
            ? null
            : `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
        caption: null,
        reasoning: null,
        failure: 'fallo' as const,
        error: problema,
        executedModel: null,
      };
    }

    const run = await context.controller.runLocalTurn({
      localTurnId: randomUUID(),
      provider: args.provider,
      model: args.model,
      projectAlias: args.projectAlias,
      prompt: buildDescribePrompt(),
      // su propio presupuesto de salida, no el 8192 de la conexion: se
      // guardan 1.900 caracteres como mucho, y pedir de mas hace que Groq
      // rechace la peticion entera cuando supera el limite del modelo
      maxOutputTokens: DESCRIBE_MAX_OUTPUT_TOKENS,
      // el banco existe para COMPARAR modelos, y el esfuerzo cambia lo que dice
      // uno tanto como cambiarlo de modelo: sin poder fijarlo, la comparacion
      // mezcla dos variables y no dice nada de ninguna
      ...(args.effort === null ? {} : { effort: args.effort }),
      // modo TECNICO: es una descripcion de un archivo, no una escena, y
      // pedirsela a quien esta encarnando a alguien mezcla dos cosas (`D-055`)
      kind: 'technical',
      // la RUTA va con los bytes, y solo aqui: este archivo lo eligio el
      // usuario en un dialogo y ya estaba en su disco, sin cifrar. Es lo que
      // permite que Codex mire —ve imagenes, pero por ruta, no por bytes—.
      //
      // La misma linea de la boveda NO la lleva, y no es un olvido: alli la
      // imagen solo existe descifrada en memoria, y escribir una copia en
      // claro para que Codex pudiera leerla romperia la boveda entera.
      images: [{ mimeType, base64: Buffer.from(bytes).toString('base64'), path: filePath }],
    });

    const preview =
      bytes.length > VAULT_PREVIEW_MAX_BYTES
        ? null
        : `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;

    // un turno que FALLA no es un modelo que no contesta.
    //
    // Se estaba contando igual, y con eso la pantalla decia «no contesto nada,
    // vuelve a intentarlo» ante un error de la llamada —clave, red, un 400 del
    // proveedor—: pedia repetir algo que no puede funcionar y escondia el
    // motivo, que es lo unico que permite arreglarlo.
    if (run.outcome !== 'completed') {
      context.log('prueba de vision fallida', { outcome: run.outcome });
      return {
        cancelled: false,
        fileName: basename(filePath),
        mimeType,
        byteSize: bytes.length,
        dataUrl: preview,
        caption: null,
        reasoning: null,
        failure: 'fallo' as const,
        // el mensaje del proveedor ya pasa por `redact` aguas arriba
        error: run.error ?? `el turno termino como ${run.outcome}`,
        executedModel: run.executedModel ?? args.model,
      };
    }

    // se clasifica lo VISIBLE, no el razonamiento: un modelo puede sopesar en
    // voz alta si debe negarse y luego contestar con normalidad, y mirar el
    // texto entero convertiria ese titubeo en un rechazo que nunca ocurrio
    const refused = classifyReply(splitReasoning(run.text).visible).kind === 'refused';
    const described = parseDescribeResponse(run.text, refused);

    // ni el nombre del archivo ni lo que se vio: solo que se pudo probar
    context.log('prueba de vision', { pudo: described.caption !== null });
    return {
      cancelled: false,
      fileName: basename(filePath),
      mimeType,
      byteSize: bytes.length,
      dataUrl: preview,
      caption: described.caption,
      failure: described.failure,
      // se enseña, no se guarda: explica la descripcion sin ser la descripcion
      reasoning: described.reasoning,
      error: null,
      executedModel: run.executedModel ?? args.model,
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
   * opciones de AI Horde.
   *
   * Va aparte y no hereda de la anterior: son dos cuentas distintas y la
   * cabecera tambien lo es (`apikey`, no `Authorization`). La clave anonima
   * FUNCIONA, pero no se pone sola: con ella el horde fuerza `shared`, o sea que
   * dona las imagenes a un conjunto de datos publico, y eso en una boveda
   * privada tiene que ser una decision escrita, no un valor por defecto.
   */
  const hordeOptions = (signal: AbortSignal): { baseUrl: string; apiKey: string; signal: AbortSignal } => {
    const apiKey = context.secretStore.get(VAULT_HORDE_API_SECRET);
    if (apiKey === undefined) {
      throw new VaultError(
        'no hay clave de AI Horde guardada en este equipo',
        `sacala gratis en aihorde.net —no pide tarjeta— y guardala en Privado. La clave anonima ${ANONYMOUS_API_KEY} tambien vale, pero comparte lo que generes`,
      );
    }
    return { baseUrl: HORDE_BASE_URL, apiKey, signal };
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
        // la clave de la boveda de un personaje nuevo la pone su proveedor
        // porque es la unica que hay; a partir de aqui es NUESTRA y no cambia,
        // aunque despues se le añada un aspecto en el horde
        characterId: created.characterId,
        imageProvider: 'xavira',
        xavira: { characterId: created.characterId, modelId: args.modelId },
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
      imageProvider: 'xavira',
      xavira: { characterId: args.characterId.trim(), modelId: args.modelId },
      description: args.description,
      label: args.label.trim(),
      avatarObjectKey,
      createdAt: new Date().toISOString(),
    });
    context.log('personaje dado de alta', { modelId: args.modelId });
    return { characters };
  });

  /**
   * da a un personaje su aspecto en AI Horde, o lo corrige.
   *
   * No llama a ninguna API y no cuesta nada, porque en el horde un personaje NO
   * existe fuera de aqui: es su receta. Eso cambia una cosa importante respecto
   * a Xavira, donde equivocarse cuesta creditos y el aspecto no se puede
   * cambiar: aqui se edita hasta que la cara salga bien.
   *
   * Y sirve para un personaje QUE YA EXISTE, aunque naciera en Xavira. Ese es
   * el punto de `D-068`: darle un aspecto en el horde no crea a nadie nuevo, le
   * añade una segunda forma de hacerle fotos. Conserva su `characterId`, y con
   * el sus conversaciones, sus recuerdos y sus imagenes.
   */
  handle(IPC_INVOKE.vaultHordeCharacterSave, vaultHordeCharacterSaveArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const existing = (await context.characters.list(context.vault)).find(
      (entry) => entry.characterId === args.characterId,
    );
    if (args.characterId.length > 0 && existing === undefined) {
      throw new VaultError('ese personaje ya no esta en la boveda');
    }
    const characterId = existing?.characterId ?? randomUUID();
    const characters = await context.characters.add(context.vault, {
      characterId,
      // estrenar el aspecto lo activa; corregirlo despues NO cambia de quien
      // vienen las fotos, que es una decision aparte y del usuario
      imageProvider: existing?.horde == null ? 'horde' : existing.imageProvider,
      // lo que tuviera en Xavira se conserva intacto: es la otra mitad de la
      // misma persona, no algo que este reemplazando
      xavira: existing?.xavira ?? null,
      horde: { recipe: args.recipe },
      description: args.description,
      label: args.label.trim(),
      avatarObjectKey: existing?.avatarObjectKey ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });

    // ni el aspecto ni la etiqueta: describen a una persona
    context.log('personaje de AI Horde guardado', { modelos: args.recipe.models.length });
    return { characterId, characters };
  });

  /**
   * cambia quien le hace las fotos a un personaje.
   *
   * Es lo unico que hace: no toca su nombre, ni su descripcion, ni su avatar, y
   * sobre todo no toca su `characterId`, que es a lo que se agarran sus
   * conversaciones, sus recuerdos y las imagenes que ya tiene. Cambiar de
   * proveedor no es cambiar de persona (`D-068`).
   *
   * Se exige que la identidad de destino EXISTA. Poner `horde` sin receta
   * dejaria al personaje sin poder generar nada, y el fallo aparecería un turno
   * despues, con la foto ya prometida.
   */
  handle(
    IPC_INVOKE.vaultCharacterImageProvider,
    vaultCharacterProviderArgsSchema,
    async (args) => {
      if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

      const existing = (await context.characters.list(context.vault)).find(
        (entry) => entry.characterId === args.characterId,
      );
      if (existing === undefined) throw new VaultError('ese personaje no esta en la boveda');

      if (args.provider === 'horde' && existing.horde === null) {
        throw new VaultError(
          'ese personaje todavia no tiene aspecto en AI Horde',
          'creale uno con «Darle aspecto en AI Horde» y podras cambiar cuando quieras',
        );
      }
      if (args.provider === 'xavira' && existing.xavira === null) {
        throw new VaultError(
          'ese personaje no existe en Xavira',
          'nacio en AI Horde; crearlo en Xavira cuesta creditos y le da otra cara',
        );
      }

      const characters = await context.characters.add(context.vault, {
        ...existing,
        imageProvider: args.provider,
      });
      context.log('proveedor de imagen cambiado', { proveedor: args.provider });
      return { characters };
    },
  );

  /**
   * las ultimas instrucciones que se usaron con este personaje.
   *
   * La personalidad es del personaje, no del hilo: escribirla otra vez en cada
   * conversacion nueva es trabajo repetido y ademas produce personajes que se
   * comportan distinto segun donde se hable con ellos.
   *
   * Se busca en la conversacion mas reciente que fuera suya. Devuelve `null` si
   * nunca se le pusieron ningunas, que no es un error.
   */
  handle(IPC_INVOKE.vaultCharacterInstructions, vaultCharacterForgetArgsSchema, async (args) => {
    if (!context.vault.isUnlocked()) throw new VaultError('la boveda esta bloqueada');

    const store = context.privateConversations;
    // `list` viene de la mas reciente a la mas antigua: la primera que sea suya
    // y tenga instrucciones es la que vale
    for (const conversation of await store.list(context.vault)) {
      const owner = await store.latestCharacterId(context.vault, conversation.conversationId);
      if (owner !== args.characterId) continue;

      const instructions = await store.latestInstructions(
        context.vault,
        conversation.conversationId,
      );
      if (instructions !== null && instructions.length > 0) return { instructions };
    }
    return { instructions: null };
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
  /**
   * genera con AI Horde, que es gratis y no guarda personajes.
   *
   * La diferencia de fondo con el proveedor de pago: alli la identidad vive en
   * su servidor detras de un identificador, y aqui vive en la receta local. Por
   * eso esta rama compone el prompt entero —aspecto, ropa y escena— en vez de
   * mandar solo la escena.
   *
   * No hay video: el horde no genera video. Se dice en vez de intentarlo.
   */
  /**
   * lee una imagen ya guardada de la conversacion para partir de ella.
   *
   * Los bytes se descifran en memoria y viajan en el CUERPO de la peticion:
   * nunca se publica una URL, que es la misma razon por la que se sondea en vez
   * de usar un callback (`D-042`).
   *
   * Solo webp: es lo que documenta la API del horde y es lo que ella misma
   * devuelve, asi que partir de una imagen suya funciona siempre. Un adjunto en
   * PNG se rechaza con su motivo en vez de mandarlo y esperar a ver.
   */
  const readSourceImage = async (conversationId: string, mediaId: string): Promise<string> => {
    const { bytes, mimeType } = await context.privateMedia.read(
      context.vault,
      conversationId,
      mediaId,
    );
    if (mimeType !== 'image/webp') {
      throw new VaultError(
        `AI Horde solo admite webp como imagen de partida, y esa es ${mimeType}`,
        'usa una imagen generada aqui: todas las del horde son webp',
      );
    }
    // base64 PURO: con el prefijo `data:` el servidor lo decodifica igual y
    // falla mucho despues con un error que no explica nada
    return Buffer.from(bytes).toString('base64');
  };

  const generateHordeImage = async (input: {
    conversationId: string;
    prompt: string;
    kind: 'image' | 'video';
    character: { characterId: string; recipe: HordeRecipe | null };
    /** identificador LOCAL de un medio de esta conversacion, para img2img */
    fromMediaId?: string;
  }): Promise<{
    mediaId: string;
    mimeType: string;
    byteSize: number;
    costCredits: number | null;
    costUnit: "creditos" | "kudos";
  }> => {
    if (input.kind === 'video') {
      throw new VaultError(
        'AI Horde no genera video',
        'para video hace falta el proveedor de pago; este personaje solo hace imagenes',
      );
    }
    const recipe = input.character.recipe;
    if (recipe === null) {
      throw new VaultError(
        'ese personaje no tiene receta guardada',
        'en AI Horde la apariencia vive en la receta: editalo en Privado y elige modelo y aspecto',
      );
    }

    const controller = new AbortController();
    const options = hordeOptions(controller.signal);
    const sourceImage =
      input.fromMediaId === undefined
        ? null
        : await readSourceImage(input.conversationId, input.fromMediaId);
    // con la clave anonima el horde ignora este campo y comparte igual; con una
    // clave propia, que es gratis, no comparte nada
    const request = buildHordeRequest({
      recipe,
      prompt: input.prompt,
      extraNegative: VAULT_IMAGE_NEGATIVE,
      // lo decide la receta del personaje, no una constante. Compartir da
      // kudos, y con una cuenta nueva los kudos SON el puesto en la cola: es la
      // unica forma de acortar la espera sin poner dinero ni una GPU
      shared: recipe.shared,
      sourceImage,
    });

    // como va la cola, hacia la ventana y hacia el log.
    //
    // El sondeo da unas ochenta vueltas en diez minutos y hasta ahora se tiraban
    // todas: la pantalla se quedaba en blanco y al final decia «no estuvo lista
    // a tiempo», que no distingue «estabas el 300º de la cola» de «ningun worker
    // sirve tus modelos». Solo viajan contadores; ni el prompt ni la imagen.
    let ultimo: HordeQueueProgress | null = null;
    const onProgress = (progress: {
      queuePosition: number;
      waitTimeSeconds: number;
      waiting: number;
      processing: number;
      finished: number;
    }): void => {
      const actual: HordeQueueProgress = {
        queuePosition: progress.queuePosition,
        waitTimeSeconds: progress.waitTimeSeconds,
        waiting: progress.waiting,
        processing: progress.processing,
        finished: progress.finished,
      };
      // la ventana recibe TODAS: es un contador en pantalla y tiene que bajar
      const window = context.getMainWindow();
      if (window !== null && !window.isDestroyed()) {
        window.webContents.send(IPC_EVENT.hordeProgress, actual);
      }
      // el log solo las que dicen algo nuevo: ochenta lineas identicas esconden
      // justo el momento en que la peticion avanza
      if (worthReporting(ultimo, actual)) {
        context.log('cola de AI Horde', actual);
      }
      ultimo = actual;
    };

    try {
      const submission = await submitImage(request, options);
      const result = await awaitImage(submission.id, { ...options, onProgress });
      const [generation] = result.generations;
      if (generation === undefined) {
        throw new VaultError('AI Horde termino sin devolver ninguna imagen');
      }

      const { bytes, mimeType } = await downloadImage(generation.img, options);

      // se cifra ANTES de tocar el disco, igual que en el otro proveedor
      const stored = await context.privateMedia.add(context.vault, input.conversationId, bytes, {
        mimeType,
        displayName: null,
        // LO QUE SE MANDO DE VERDAD, no solo la escena.
        //
        // El esquema define este campo como «lo que se PIDIO al generar, tal y
        // como se le mando al proveedor», y se guardaba unicamente el trozo que
        // escribe el modelo de la conversacion. El aspecto fijo del personaje y
        // su ropa —que van DELANTE y son los que deciden si la cara es la
        // suya— no quedaban en ningun sitio.
        //
        // Consecuencia: cuando una imagen no se parecia al personaje no habia
        // forma de saber si la receta habia llegado o no. Se discutio a ciegas
        // dos veces. Esto ya esta cifrado con la imagen, asi que guardarlo
        // entero no expone nada nuevo.
        prompt: request.prompt,
        width: recipe.width,
        height: recipe.height,
        durationMs: null,
        characterId: input.character.characterId,
        provider: 'horde',
        // el modelo que de verdad la genero, que puede no ser el primero de la
        // lista: se mandan varios justo para que lo coja el que este libre
        model: generation.model,
      });

      context.log('medio privado generado', {
        proveedor: 'horde',
        kind: input.kind,
        byteSize: stored.byteSize,
        // el modelo que la cogio de verdad. Sin esto, «la misma semilla da
        // caras distintas» no se puede ni empezar a diagnosticar
        modelo: generation.model,
        // y QUIEN lo ejecuto. Dos workers con el mismo modelo pueden dar
        // resultados distintos: version del fichero, backend y retoques son
        // suyos, no del horde. Ya venia en la respuesta y se tiraba
        worker: generation.workerName,
      });

      return {
        mediaId: stored.mediaId,
        mimeType,
        byteSize: stored.byteSize,
        // kudos, no dinero: no se compran y no se gastan de una cartera. Se
        // enseñan igual porque son lo que decide la espera del proximo turno, y
        // la unidad viaja con el numero para que la pantalla no los llame
        // creditos, que es lo que cobra el OTRO proveedor
        costCredits: result.kudos,
        costUnit: 'kudos',
      };
    } catch (error) {
      if (error instanceof HordeError) throw new VaultError(error.message, error.hint);
      throw error;
    }
  };

  const generatePrivateMedia = async (input: {
    conversationId: string;
    characterId: string;
    prompt: string;
    kind: 'image' | 'video';
    fromGenerationId?: string;
    /**
     * imagen de ESTA conversacion de la que partir (img2img).
     *
     * Solo la entiende AI Horde. El proveedor de pago mantiene la identidad con
     * su propio personaje y no necesita ninguna imagen de entrada; ademas la
     * retiro a proposito.
     */
    fromMediaId?: string;
  }): Promise<{
    mediaId: string;
    mimeType: string;
    byteSize: number;
    costCredits: number | null;
    costUnit: "creditos" | "kudos";
  }> => {
    const character = (await context.characters.list(context.vault)).find(
      (entry) => entry.characterId === input.characterId,
    );
    // el proveedor es del PERSONAJE y no de la conversacion: dos personajes de
    // la misma boveda pueden generarse en sitios distintos, y mezclarlos
    // significaria mandar la receta de uno a la API del otro
    if (character?.imageProvider === 'horde') {
      return generateHordeImage({
        ...input,
        character: { characterId: character.characterId, recipe: character.horde?.recipe ?? null },
      });
    }

    const controller = new AbortController();
    const options = mediaProviderOptions(controller.signal);
    // el identificador que entiende SU API vive en `xavira`, no en la clave de
    // la boveda. En un personaje anterior a `D-068` coinciden; en uno nacido en
    // el horde al que se le añade Xavira despues, no
    const args = {
      ...input,
      characterId: character?.xavira?.characterId ?? input.characterId,
    };

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
        costUnit: 'creditos',
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
      ...(args.fromMediaId === undefined ? {} : { fromMediaId: args.fromMediaId }),
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

  /**
   * un turno privado de principio a fin.
   *
   * Va aparte del handler para que el envio pueda marcarse en curso ANTES de
   * empezar y borrarse pase lo que pase: mientras dure, el trabajo de fondo no
   * puede leer esta conversacion, porque sus turnos estan cambiando.
   */
  const runPrivateTurn = async (
    args: z.infer<typeof vaultConversationSendArgsSchema>,
    conversationId: string,
  ) => {
    if (!context.vault.isUnlocked()) {
      throw new VaultError(
        'la boveda esta bloqueada',
        'abrela para poder escribir en una conversacion privada',
      );
    }
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
            // el tipo REAL, leido de los bytes. Estaba escrito 'image/webp' a
            // pelo, fuera lo que fuera: eso derrota la guarda de AI Horde para
            // img2img, que mira el tipo declarado, y convierte un rechazo claro
            // en un fallo dentro del worker. Si no se reconoce la firma se dice
            // que no se sabe, en vez de inventarlo
            mimeType: sniffImageType(bytes) ?? 'application/octet-stream',
            displayName: 'foto de perfil',
            // el avatar no se genero aqui, asi que no tiene `prompt`. Y «su
            // foto de perfil» es un marcador, no una descripcion: no dice nada
            // de lo que se ve, asi que el modelo elige a ciegas si le piden
            // «una foto». Va en `caption` para que describirla con un modelo
            // con vista lo SUSTITUYA por algo util
            prompt: null,
            caption: PROFILE_PHOTO_LABEL,
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

    // la clave que hace falta es la del proveedor de ESTE personaje. Preguntar
    // siempre por la de pago dejaba sin imagenes a un personaje del horde que
    // estaba perfectamente configurado
    const imageProvider = character?.imageProvider ?? 'xavira';
    const providerSecret =
      imageProvider === 'horde' ? VAULT_HORDE_API_SECRET : VAULT_MEDIA_API_SECRET;

    // solo se le ofrece generar si de verdad se puede: sin personaje conocido o
    // sin clave, ofrecerselo garantiza una promesa incumplida en cada turno
    const imageBlock = imageBlockReason({
      characterId,
      characterInVault: character !== undefined,
      hasApiKey: context.secretStore.get(providerSecret) !== undefined,
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
    const sealedMemory = await store.latestMemory(context.vault, conversationId);

    // de donde sale la memoria de esta conversacion.
    //
    // La SELLADA gana siempre: `chooseConversationMemory` solo mira el relleno
    // retroactivo cuando no hay ninguna, asi que una conversacion con memoria
    // propia sale de aqui exactamente igual que antes de que esto existiera.
    //
    // Y va entero dentro de un `try`, como los pendientes y por lo mismo: leer el
    // almacen descifra un archivo de disco y eso puede fallar. Un fallo del
    // trabajo de fondo NO puede costar un turno de pago (`D-088`); sin relleno
    // el prompt queda con la memoria de siempre —o sin ninguna, con su aviso de
    // turnos omitidos—, que es el lado seguro.
    let memoriaElegida: ChosenMemory = { memory: sealedMemory, source: 'turn', gaps: 0 };
    try {
      memoriaElegida = chooseConversationMemory({
        sealed: sealedMemory,
        entry: await context.recaps.entryFor(context.vault, conversationId),
        // el historial ENTERO, con el mensaje que se acaba de guardar: la
        // invariante de cobertura se mide contra la cola literal que viaja en
        // este prompt, no contra la que viajaba cuando se escribio la ficha
        turns: history,
      });
    } catch {
      // el motivo NO se registra. Un error de validacion trae dentro el dato que
      // no valido, y ese dato es la ficha de la conversacion: contarlo aqui seria
      // sacar al log justo lo que este archivo nunca escribe
      memoriaElegida = { memory: sealedMemory, source: 'turn', gaps: 0 };
    }

    // sin esta lista el modelo no puede reenviar nada: no sabe que hay, asi que
    // genera otra —pagando— cada vez que le piden «la de antes»
    const existingImages = (await context.privateMedia.list(context.vault, conversationId)).map(
      (item) => {
        // el orden lo decide `imageDescriptionFor`, que vive en shared con sus
        // pruebas: aqui se leia `prompt` y nunca `caption`, asi que describir
        // una imagen era decorativo
        const description = imageDescriptionFor(item.metadata);
        // la foto de perfil se anuncia COMO TAL, y ademas con lo que se ve en
        // ella. El personaje tiene que saber que ese retrato suyo existe aunque
        // ya no se enseñe siempre en pantalla
        const esAvatar =
          character !== undefined && item.metadata.characterId === character.characterId;
        return {
          mediaId: item.mediaId,
          description: esAvatar ? profilePhotoLine(description) : description,
        };
      },
    );
    // los turnos que ya viajan como historial reciente no se transcriben otra
    // vez: estarian dos veces en el mismo prompt
    const oldestRecent = history.slice(-1 - VAULT_RECENT_TURNS)[0]?.sequence;

    // el reloj y la zona se leen AQUI y se pasan como dato: lo que fecha el
    // turno —los recuerdos y los pendientes— es puro en esa parte, y asi se
    // puede probar «el jueves dicho en jueves» sin esperar a que sea jueves.
    //
    // La zona sale del sistema porque es donde vive quien escribe: una
    // conversacion de las once de la noche tiene que fecharse en SU dia, no en
    // el UTC, que iba un dia por detras a partir de las diez.
    //
    // Y es UNO para todo el turno. Con dos relojes, «hace 7 dias» podria salir
    // en el recuerdo y «hace 8» en la promesa del mismo dia, que es exactamente
    // la clase de contradiccion que delata a una maquina.
    const anchor = {
      instant: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // el dia civil empieza a las cinco: de madrugada se sigue hablando de
      // «esta noche», no de la noche de ayer
      dayStartsAtHour: 5,
    };

    const recall = await buildRecall(context.privateMemory, context.vault, args.message, {
      anchor,
      // los recuerdos son del personaje: un hilo sin personaje no hereda los de
      // nadie, y uno con otro personaje tampoco ve los de este
      characterId,
      // su nombre sale en muchos momentos: no sirve para elegir entre ellos
      ignoreWords: character === undefined ? [] : [character.label],
      ...(oldestRecent === undefined
        ? {}
        : { alreadyInPrompt: { conversationId, fromSequence: oldestRecent } }),
    });

    // lo que quedo pendiente entre los dos y toca sacar HOY, si toca alguno.
    //
    // Va entero dentro de un `try`. El almacen se lee de disco y se abre con la
    // boveda, la linea temporal descifra el historial y la seleccion es
    // aritmetica sobre las dos: cualquiera de esas tres cosas puede fallar, y
    // ninguna vale un turno de pago perdido. Sin pendientes el prompt queda
    // exactamente como estaba, que es el lado seguro.
    let pendientes: PendingSelection | null = null;
    try {
      const apuntado = await context.relations.read(context.vault);
      // primero la linea temporal, que es la que construye el indice si aun no
      // esta: `conversationsFor` y `turnAt` leen lo ya construido y sin esto
      // devolverian el conjunto vacio y `null`, es decir, ningun pendiente
      const linea = await context.privateMemory.timeline(context.vault, characterId);
      pendientes = selectPendingForTurn({
        notes: apuntado.notes,
        cursors: apuntado.cursors,
        // una conversacion que no se ha podido leer en esta sesion deja turnos
        // sin extraer que hoy no se van a extraer. Contarlos como desfase
        // callaba TODAS las promesas del personaje sin mas aviso que un contador
        // en otra pantalla
        failed: relationSync.failedConversations,
        timeline: linea,
        // el alcance es del PERSONAJE: un hilo sin personaje no hereda las
        // promesas de nadie (`D-062`), igual que no hereda sus recuerdos
        conversations: context.privateMemory.conversationsFor(characterId),
        turnAt: (ref) => context.privateMemory.turnAt(ref.conversationId, ref.sequence),
        current: {
          conversationId,
          // el mensaje que se acaba de guardar: es el ultimo del historial
          sequence: history[history.length - 1]?.sequence ?? 0,
          text: args.message,
          oldestRecent: oldestRecent ?? null,
        },
        anchor,
        now: anchor.instant,
      });
    } catch {
      // el motivo NO se registra. Un error de validacion trae dentro el dato que
      // no valido, y ese dato es una cita de la boveda: contarlo aqui seria
      // sacar al log justo lo que este archivo nunca escribe
      pendientes = null;
    }

    const bloques = composeVaultPrompt({
      memory: memoriaElegida.memory,
      // los tres origenes NO valen lo mismo y el prompt tiene que decirlo: un
      // relleno puede traer tramos que nadie resumio y un indice no sabe QUE se
      // dijo dentro de ninguna escena. Sin esto, la mera presencia del bloque le
      // quitaria la orden de preguntar justo cuando menos sabe
      memorySource: memoriaElegida.source,
      memoryGaps: memoriaElegida.gaps,
      recall,
      // ya elegidos y dosificados: el modelo no decide cual sale, porque
      // preguntarselo costaria otra llamada de pago por turno
      pending: pendientes?.lines ?? [],
      // el ultimo es el que se acaba de guardar: va aparte como mensaje nuevo
      turns: history.slice(0, -1).map((turn) => ({ role: turn.role, text: turn.text })),
      message: args.message,
      instructions: instructions === null || instructions.length === 0 ? null : instructions,
      character:
        characterDescription === null || characterDescription.length === 0
          ? null
          : characterDescription,
      canGenerateImage,
      // y si la imagen del turno anterior no llego a salir. Se consume aqui:
      // es informacion para ESTE turno, no un estado que se arrastre
      lastImageError: ultimaImagenFallida.get(conversationId) ?? null,
      existingImages,
      // los modelos de anime rinden peor con prosa y los realistas peor con
      // etiquetas sueltas: lo dice la documentacion del proveedor
      imagePromptStyle: imagePromptStyleFor(imageProvider, {
        xaviraModelId: character?.xavira?.modelId ?? null,
        recipe: character?.horde?.recipe ?? null,
      }),
    });

    // el TAMAÑO de cada bloque, nunca su contenido. Sin esto, «el bloque de
    // imagen se lleva 2.050 tokens» era una estimacion de sobremesa; con esto es
    // un dato de cada turno real, y sin sacar una palabra de la boveda al log
    const prompt = bloques.map((bloque) => bloque.text).join('\n\n');
    const medidas = measureVaultPrompt(bloques);
    context.log('prompt privado compuesto', {
      caracteres: prompt.length,
      tokensEstimados: estimateTokens(prompt),
      // de mayor a menor: lo primero de la lista es lo que hay que mirar
      bloques: medidas.map((m) => m.label + ' ' + String(m.chars) + 'c ' + String(m.share) + '%'),
      // que camino trajo un recuerdo, si alguno: es lo que dice en la practica
      // cual dispara y cual no. El camino, nunca lo que se cito
      recuerdo: recall.quoted?.via ?? 'ninguno',
      // posiciones de turno, nunca texto: dice si lo buscado pudo entrar
      recuerdoTrozo:
        recall.quoted == null
          ? null
          : recall.quoted.excerpt === undefined
            ? 'entero'
            : `${recall.quoted.excerpt.first}-${recall.quoted.excerpt.last}/${recall.quoted.excerpt.total}`,
      lineasIndice: recall.episodes.length,
      fueraDelIndice: recall.omitted ?? 0,
      // de donde salio la memoria y cuantos tramos declarados lleva. Es una
      // CLASIFICACION y una cifra: sin esto, «memoria 380c» no distingue una
      // ficha que vivio la conversacion de un indice que solo sabe los titulos
      memoriaOrigen: memoriaElegida.memory === null ? 'ninguna' : memoriaElegida.source,
      memoriaHuecos: memoriaElegida.gaps,
      // por que NO salio ninguna promesa, que es la pregunta que se hace
      // siempre. «Cero ofrecidas» no dice nada; «cuatro abiertas, tres en
      // reposo y una bloqueada por desfase» se arregla en sitios distintos.
      // Enteros, nunca la cita ni de que iba
      pendientes:
        pendientes === null
          ? null
          : {
              abiertas: pendientes.counters.open,
              ofrecidas: pendientes.counters.offered,
              tocadas: pendientes.counters.touched,
              enEscena: pendientes.counters.inScene,
              enReposo: pendientes.counters.cooling,
              enEspera: pendientes.counters.waiting,
              dormidas: pendientes.counters.dormant,
              bloqueadasPorDesfase: pendientes.counters.blockedStale,
              citaRota: pendientes.counters.quoteBroken,
            },
      // y si no salio ninguna porque la seleccion se cayo. Sin distinguirlo,
      // un almacen ilegible se lee igual que «hoy no tocaba»
      pendientesError: pendientes === null,
    });

    // dicho ya, se olvida: si no, el personaje seguiria disculpandose por una
    // imagen fallida tres turnos despues
    ultimaImagenFallida.delete(conversationId);

    // ni el texto ni los rasgos: solo si el turno pudo ofrecer imagenes y
    // cuantas habia para reenviar. Sin esto habia que adivinar por que el
    // modelo decia que no podia
    context.log('turno privado', {
      conPersonaje: characterId !== null && characterId.length > 0,
      // la diferencia entre estos dos es exactamente el fallo que costo una
      // tarde: un personaje fijado que la boveda no conoce
      personajeEnBoveda: character !== undefined,
      puedeGenerar: canGenerateImage,
      // el MOTIVO, no solo el booleano: los tres se arreglan en sitios
      // distintos —el identificador, la lista de personajes, o la clave— y
      // saber cual era habria ahorrado dos diagnosticos equivocados
      motivoBloqueo: imageBlock,
      // y de quien seria la clave que falta: un personaje del horde sin clave
      // del horde no se distingue de uno de Xavira sin la suya
      proveedorImagen: imageProvider,
      imagenesDisponibles: existingImages.length,
    });

    const result = await context.controller.runLocalTurn({
      localTurnId: randomUUID(),
      provider: args.provider,
      model: args.model,
      projectAlias: args.projectAlias,
      prompt,
      // lo que elija el usuario en la ventana. Sin esta linea el selector
      // existiria y no haria nada, que es como se perdio el modelo una vez
      ...(args.effort === null ? {} : { effort: args.effort }),
    });

    // lo que el modelo pidio generar, y como acabo. Se devuelve a la interfaz
    // para que pueda decir «no habia clave» o «el proveedor fallo» en vez de
    // callarse: una imagen que no aparece sin explicacion parece un cuelgue
    let image: {
      mediaId: string | null;
      costCredits: number | null;
      costUnit: "creditos" | "kudos" | null;
      error: string | null;
    } | null = null;

    // se calculaba y se tiraba. Un modelo que escribe mal el bloque deja de
    // actualizar la memoria sin que nadie lo vea: la conversacion sigue
    // funcionando y solo semanas despues parece que «se le olvidan cosas»
    // `null` cuando la llamada ni siquiera llego a completarse.
    //
    // Antes se quedaba en `absent`, y la pantalla lo enseñaba como «este turno
    // no aporto memoria nueva; si se repite, ese modelo no esta escribiendo
    // bien el bloque». Con un 429 del proveedor eso culpa al modelo de algo que
    // nunca ocurrio, y encima al lado del error de verdad.
    let memoryStatus: ConversationMemoryStatus | null =
      result.outcome === 'failed' ? null : 'absent';

    let wroteReply = false;
    // lo que de verdad leyo el usuario, sin el bloque de memoria ni la peticion
    // de imagen. Es contra esto —y no contra la respuesta cruda— contra lo que
    // se mira si ella saco alguna de las promesas que se le enseñaron
    let respuestaVisible = '';
    if (result.outcome !== 'failed' && result.text.length > 0) {
      wroteReply = true;
      // la memoria viaja DENTRO de la respuesta y se separa aqui: lo que se
      // guarda como turno es solo el texto visible, sin el bloque tecnico
      const parsed = parseConversationMemoryResponse(result.text);
      // la memoria la separa el agente y la manda aparte: el texto ya no lleva el
      // bloque, y buscarlo solo ahi daba `absent` en TODOS los turnos, asi que
      // la memoria acumulativa de Privado no se guardaba nunca
      const memoria = memoryOfTurn(result, parsed);
      memoryStatus = memoria.status;
      // y despues la peticion de imagen, sobre lo que quedo. El orden es el
      // inverso al del prompt: la memoria va la ultima, asi que sale la primera
      const imageRequest = parseVaultImageRequest(parsed.visibleText);
      respuestaVisible = imageRequest.visibleText;

      if (imageRequest.request?.mediaId !== undefined) {
        // reenviar lo que ya existe: gratis e inmediato. Se comprueba que sea
        // de ESTA conversacion, porque el identificador lo escribe el modelo y
        // podria inventarse uno de otra
        const known = await context.privateMedia.list(context.vault, conversationId);
        const found = known.find((item) => item.mediaId === imageRequest.request?.mediaId);
        image =
          found === undefined
            ? {
                mediaId: null,
                costCredits: null,
                costUnit: null,
                error: 'esa imagen no existe en esta conversacion',
              }
            : { mediaId: found.mediaId, costCredits: null, costUnit: null, error: null };
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
            costUnit: generated.costUnit,
            error: null,
          };
        } catch (error) {
          // una generacion fallida NO tira la respuesta de texto: lo escrito
          // sigue valiendo y se guarda igual, con el fallo al lado.
          //
          // Y se apunta para el turno siguiente: sin esto el personaje cree
          // que la mando
          ultimaImagenFallida.set(
            conversationId,
            redact(error instanceof Error ? error.message : String(error)),
          );
          image = {
            mediaId: null,
            costCredits: null,
            costUnit: null,
            error: redact(error instanceof Error ? error.message : String(error)),
          };
        }
      } else if (imageRequest.request !== null) {
        image = {
          mediaId: null,
          costCredits: null,
          costUnit: null,
          // tres motivos distintos con tres arreglos distintos: mezclarlos
          // mandaba a mirar la clave cuando el problema era el identificador
          error: imageBlockMessage(imageBlock ?? 'sin-personaje', imageProvider),
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
        memoria.memory === null ? undefined : { memory: memoria.memory },
      );
    }

    // si no llego a escribirse ninguna respuesta, el mensaje del usuario queda
    // huerfano. Se retira: un turno sin contestacion no es parte de la
    // conversacion, es un intento fallido, y dejarlo hace que el usuario
    // reescriba lo mismo y acabe con su mensaje dos veces —en pantalla y en el
    // proximo prompt—
    const userTurnKept = wroteReply;
    if (!userTurnKept) store.removeLastTurn(conversationId);

    // el historial ha cambiado: el indice de la memoria episodica deja de estar
    // al dia. Se reconstruye solo, y perezosamente, en la siguiente busqueda
    context.privateMemory.invalidate();

    // si de lo que se le enseño acabo saliendo algo. Es la unica medida de que
    // el bloque sirve para algo: se le pueden estar ofreciendo dos promesas en
    // cada turno y no sacar ninguna nunca, y desde fuera eso se ve igual que no
    // haberselas enseñado. Se compara con las mismas raices que usa la
    // seleccion, asi que cuenta tambien si lo dijo con otras palabras.
    //
    // Solo cuando hubo algo que enseñar y algo que leer: un «mostrados: 0» en
    // cada turno seria ruido en el unico sitio donde se mira lo que paso, y un
    // turno que no llego a contestar contaria como que ella lo ignoro, que es
    // exactamente lo contrario de lo que paso
    if (wroteReply && pendientes !== null && pendientes.lines.length > 0) {
      context.log('pendientes en la respuesta', {
        mostrados: pendientes.lines.length,
        aludidos: pendientes.lines.filter((linea) =>
          matchesNote(respuestaVisible, quoteStems(linea.quote)),
        ).length,
      });
    }

    // cuanto tardo el turno de pago y si habia una extraccion corriendo por
    // detras. Son las dos cifras con las que se decide si el disparo inmediato
    // se queda o se deja solo el de inactividad: sin medirlo seria una opinion
    context.log('turno privado terminado', {
      duracionMs: result.durationMs,
      extraccionEnCurso: relationSync.busy,
      final: result.outcome,
    });

    return {
      conversationId,
      outcome: result.outcome,
      turns: await store.read(context.vault, conversationId),
      instructions: await store.latestInstructions(context.vault, conversationId),
      characterId: await store.latestCharacterId(context.vault, conversationId),
      characterDescription: await store.latestCharacterDescription(context.vault, conversationId),
      provider: args.provider,
      model: result.executedModel ?? args.model,
      memoryStatus,
      userTurnKept,
      image,
      error: result.error,
    };
  };

  handle(IPC_INVOKE.vaultConversationSend, vaultConversationSendArgsSchema, async (args) => {
    const conversationId = args.conversationId ?? randomUUID();
    // mientras dure el envio, esta conversacion no se le manda a ningun CLI de
    // fondo: sus turnos estan cambiando, y uno del usuario sin respuesta puede
    // retirarse y reutilizar su numero
    sendInFlight.add(conversationId);
    let turn: Awaited<ReturnType<typeof runPrivateTurn>>;
    try {
      turn = await runPrivateTurn(args, conversationId);
    } finally {
      sendInFlight.delete(conversationId);
    }

    // y con el envio ya cerrado se apunta lo que se haya prometido. Sin esperar:
    // la respuesta de Lia no puede depender de que Codex arranque, y un fallo de
    // fondo no puede costar un turno
    void relationSync.afterTurn({
      conversationId,
      projectAlias: args.projectAlias,
      wroteReply: turn.userTurnKept,
      // una conversacion recien empezada tiene exactamente los dos turnos de
      // ahora: el suyo y el de ella
      firstTurn: turn.turns.length <= 2,
    });

    return turn;
  });
}

/** se llama al cerrar: sin esto, un reinicio de la ventana duplicaria handlers */
export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_INVOKE)) {
    ipcMain.removeHandler(channel);
  }
}
