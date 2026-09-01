// preload minimo.
//
// se ejecuta con sandbox:true, asi que solo puede usar contextBridge e
// ipcRenderer: nada de fs, path ni child_process. Eso es intencionado.
//
// no se expone ipcRenderer crudo: si el renderer pudiera llamar a cualquier
// canal, la superficie de ataque seria todo el main. Solo salen de aqui los
// verbos concretos del contrato.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_EVENT, IPC_INVOKE } from '../shared/channels.js';
import type { LuxyBridge } from '../shared/ipc.js';

const bridge: LuxyBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC_INVOKE.appInfo),
  getAgentStatus: () => ipcRenderer.invoke(IPC_INVOKE.agentStatus),
  startAgent: () => ipcRenderer.invoke(IPC_INVOKE.agentStart),
  stopAgent: (reason?: string) => ipcRenderer.invoke(IPC_INVOKE.agentStop, { reason }),
  restartAgent: () => ipcRenderer.invoke(IPC_INVOKE.agentRestart),
  tailLogs: (count?: number) => ipcRenderer.invoke(IPC_INVOKE.logsTail, { count }),
  openLogsFolder: () => ipcRenderer.invoke(IPC_INVOKE.logsOpenFolder),
  openArtifactFolder: (jobId: string) =>
    ipcRenderer.invoke(IPC_INVOKE.artifactOpenFolder, { jobId }),
  openWorktreeFolder: (worktreePath: string) =>
    ipcRenderer.invoke(IPC_INVOKE.worktreeOpenFolder, { worktreePath }),
  pickFolder: (title?: string) => ipcRenderer.invoke(IPC_INVOKE.pickFolder, { title }),

  getConfig: () => ipcRenderer.invoke(IPC_INVOKE.configGet),
  saveConfig: (config: unknown, providerSecret?: { name: string; value: string }) =>
    ipcRenderer.invoke(IPC_INVOKE.configSave, { config, providerSecret }),
  setSecret: (name: string, value: string) =>
    ipcRenderer.invoke(IPC_INVOKE.secretSet, { name, value }),
  deleteSecret: (name: string) => ipcRenderer.invoke(IPC_INVOKE.secretDelete, { name }),
  scanForSecrets: () => ipcRenderer.invoke(IPC_INVOKE.migrationScan),
  importSecrets: (file: string, names: string[], connectionId?: string | null) =>
    ipcRenderer.invoke(IPC_INVOKE.migrationImport, {
      file,
      names,
      connectionId: connectionId ?? null,
    }),
  deleteMigratedFile: (file: string) =>
    ipcRenderer.invoke(IPC_INVOKE.migrationDeleteFile, { file }),

  detectTools: () => ipcRenderer.invoke(IPC_INVOKE.toolsDetect),
  checkGateway: (gatewayUrl: string) => ipcRenderer.invoke(IPC_INVOKE.gatewayCheck, { gatewayUrl }),
  registerMachine: (args: unknown) => ipcRenderer.invoke(IPC_INVOKE.machineRegister, args),
  testConnection: (connectionId: string) =>
    ipcRenderer.invoke(IPC_INVOKE.connectionTest, { connectionId }),
  refreshCatalog: (connectionId: string) =>
    ipcRenderer.invoke(IPC_INVOKE.catalogRefresh, { connectionId }),
  readCatalog: (connectionId: string) =>
    ipcRenderer.invoke(IPC_INVOKE.catalogRead, { connectionId }),
  resolveApproval: (args: unknown) => ipcRenderer.invoke(IPC_INVOKE.approvalResolve, args),
  prepareWorkspace: (projectAlias: string, label: string) =>
    ipcRenderer.invoke(IPC_INVOKE.workspacePrepare, { projectAlias, label }),
  openWorkspaceFolder: (path: string) => ipcRenderer.invoke(IPC_INVOKE.workspaceOpen, { path }),
  getStudioOptions: () => ipcRenderer.invoke(IPC_INVOKE.studioOptions),
  createStudioJob: (args: unknown) => ipcRenderer.invoke(IPC_INVOKE.studioJobCreate, args),
  listStudioJobs: (args = { limit: 30 }) => ipcRenderer.invoke(IPC_INVOKE.studioJobsList, args),
  getStudioJob: (jobId: string) => ipcRenderer.invoke(IPC_INVOKE.studioJobGet, { jobId }),
  cancelStudioJob: (jobId: string) => ipcRenderer.invoke(IPC_INVOKE.studioJobCancel, { jobId }),
  rateStudioJob: (args: unknown) => ipcRenderer.invoke(IPC_INVOKE.studioJobFeedback, args),
  requestStudioJobAction: (args: unknown) => ipcRenderer.invoke(IPC_INVOKE.studioJobAction, args),

  getVaultStatus: () => ipcRenderer.invoke(IPC_INVOKE.vaultStatus),
  createVault: (password: string) => ipcRenderer.invoke(IPC_INVOKE.vaultCreate, { password }),
  unlockVault: (args: unknown) => ipcRenderer.invoke(IPC_INVOKE.vaultUnlock, args),
  lockVault: () => ipcRenderer.invoke(IPC_INVOKE.vaultLock),
  changeVaultPassword: (args: unknown) =>
    ipcRenderer.invoke(IPC_INVOKE.vaultChangePassword, args),
  setVaultDeviceUnlock: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_INVOKE.vaultDeviceUnlockSet, { enabled }),
  onVaultLocked: (listener: () => void) => {
    const handler = (): void => listener();
    ipcRenderer.on(IPC_EVENT.vaultLocked, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT.vaultLocked, handler);
  },

  onAgentEvent: (listener) => {
    // el listener del renderer nunca ve el objeto IpcRendererEvent: solo el dato
    const handler = (_event: unknown, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(IPC_EVENT.agentEvent, handler);
    return () => {
      ipcRenderer.off(IPC_EVENT.agentEvent, handler);
    };
  },
};

contextBridge.exposeInMainWorld('luxy', bridge);
