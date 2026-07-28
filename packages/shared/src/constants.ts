// constantes compartidas entre el gateway y el agente local

// nombre visible del agente en mensajes, logs, ramas e interfaz
export const LUXY_NAME = 'Luxy';

// prefijo de los identificadores cortos que se ven en telegram
export const JOB_SHORT_ID_PREFIX = 'LUX-';

// prefijo de las ramas de git que crea luxy en los worktrees
export const LUXY_BRANCH_PREFIX = 'luxy/';

// limite duro de caracteres de un mensaje de telegram
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// limite de longitud del prompt aceptado desde telegram
export const MAX_PROMPT_LENGTH = 8000;

// segundos sin heartbeat tras los que una maquina se considera desconectada
export const DEFAULT_MACHINE_OFFLINE_SECONDS = 45;

// segundos que dura el lease de un trabajo antes de poder recuperarse
export const DEFAULT_JOB_LEASE_SECONDS = 120;

// intervalo minimo entre ediciones del mensaje de progreso en telegram
export const MIN_PROGRESS_EDIT_INTERVAL_MS = 1500;

// version del protocolo entre agente y gateway
export const LUXY_PROTOCOL_VERSION = 1;

// estados posibles de un trabajo
export const JOB_STATUSES = [
  'queued',
  'waiting_for_machine',
  'claimed',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

// estados en los que un trabajo ya no avanza
export const TERMINAL_JOB_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

// proveedores conocidos por luxy
// un "proveedor" es una FAMILIA de modelos, no un modelo concreto.
//
// el modelo exacto vive en el catalogo (packages/shared/src/models) y viaja en
// la metadata del trabajo. Esta lista solo sirve para decidir que maquina puede
// ejecutar que, y para el enum del contrato con el gateway.
export const PROVIDER_IDS = [
  'claude',
  'codex',
  'deepseek',
  'glm',
  'qwen',
  // familias añadidas con el catalogo verificado contra la conexion
  'kimi',
  'kat',
  'minimax',
  'step',
] as const;

// proveedores que se ejecutan mediante un cli local con sesion autenticada
export const LOCAL_CLI_PROVIDERS = ['claude', 'codex'] as const;

// proveedores que se consumen por http con clave propia
export const HTTP_API_PROVIDERS = [
  'deepseek',
  'glm',
  'qwen',
  'kimi',
  'kat',
  'minimax',
  'step',
] as const;

// tipos de evento que el agente envia al gateway
export const JOB_EVENT_TYPES = [
  'phase',
  'log',
  'provider_output',
  'test_result',
  'diff_summary',
  'warning',
  'error',
] as const;

// acciones que requieren aprobacion explicita del usuario
export const APPROVAL_ACTIONS = ['commit', 'discard', 'push'] as const;
