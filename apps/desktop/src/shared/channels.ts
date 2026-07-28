// nombres de canal y de secreto.
//
// ESTE ARCHIVO NO PUEDE TENER DEPENDENCIAS EN TIEMPO DE EJECUCION.
//
// lo importa el preload, que corre con sandbox:true y por tanto solo dispone de
// contextBridge, ipcRenderer y unos pocos modulos de node. Un `import` de zod
// aqui hace que el preload falle entero con "module not found", y entonces
// window.luxy no existe y el renderer se queda en blanco. Los esquemas zod
// viven en ipc.ts, que solo cargan el main y el renderer.

/** canales de peticion/respuesta (renderer -> main) */
export const IPC_INVOKE = {
  appInfo: 'luxy:app:info',
  agentStatus: 'luxy:agent:status',
  agentStart: 'luxy:agent:start',
  agentStop: 'luxy:agent:stop',
  agentRestart: 'luxy:agent:restart',
  logsTail: 'luxy:logs:tail',
  logsOpenFolder: 'luxy:logs:open-folder',
  pickFolder: 'luxy:dialog:pick-folder',
  configGet: 'luxy:config:get',
  configSave: 'luxy:config:save',
  secretSet: 'luxy:secret:set',
  secretDelete: 'luxy:secret:delete',
  migrationScan: 'luxy:migration:scan',
  migrationImport: 'luxy:migration:import',
  migrationDeleteFile: 'luxy:migration:delete-file',
  toolsDetect: 'luxy:tools:detect',
  gatewayCheck: 'luxy:gateway:check',
  machineRegister: 'luxy:machine:register',
  connectionTest: 'luxy:connection:test',
} as const;

/** canales de notificacion (main -> renderer) */
export const IPC_EVENT = {
  agentEvent: 'luxy:agent:event',
} as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE)[keyof typeof IPC_INVOKE];

/**
 * nombres canonicos de los secretos.
 *
 * los usan los tres lados: el almacen cifrado para guardarlos, el main para
 * leerlos y el renderer para saber si estan configurados. El renderer solo
 * maneja el NOMBRE, nunca el valor.
 */
export const MACHINE_TOKEN_SECRET = 'machineToken';

export function connectionSecretName(connectionId: string): string {
  return `connection:${connectionId}`;
}
