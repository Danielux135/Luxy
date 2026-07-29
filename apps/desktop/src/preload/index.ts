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
  pickFolder: (title?: string) => ipcRenderer.invoke(IPC_INVOKE.pickFolder, { title }),

  getConfig: () => ipcRenderer.invoke(IPC_INVOKE.configGet),
  saveConfig: (config: unknown) => ipcRenderer.invoke(IPC_INVOKE.configSave, { config }),
  setSecret: (name: string, value: string) =>
    ipcRenderer.invoke(IPC_INVOKE.secretSet, { name, value }),
  deleteSecret: (name: string) => ipcRenderer.invoke(IPC_INVOKE.secretDelete, { name }),
  scanForSecrets: () => ipcRenderer.invoke(IPC_INVOKE.migrationScan),
  importSecrets: (file: string, names: string[], connectionId?: string | null) =>
    ipcRenderer.invoke(IPC_INVOKE.migrationImport, { file, names, connectionId: connectionId ?? null }),
  deleteMigratedFile: (file: string) =>
    ipcRenderer.invoke(IPC_INVOKE.migrationDeleteFile, { file }),

  detectTools: () => ipcRenderer.invoke(IPC_INVOKE.toolsDetect),
  checkGateway: (gatewayUrl: string) =>
    ipcRenderer.invoke(IPC_INVOKE.gatewayCheck, { gatewayUrl }),
  registerMachine: (args: unknown) => ipcRenderer.invoke(IPC_INVOKE.machineRegister, args),
  testConnection: (connectionId: string, baseUrl: string) =>
    ipcRenderer.invoke(IPC_INVOKE.connectionTest, { connectionId, baseUrl }),
  resolveApproval: (args: unknown) => ipcRenderer.invoke(IPC_INVOKE.approvalResolve, args),

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
