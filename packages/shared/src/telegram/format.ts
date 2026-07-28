// construccion y division de los mensajes que luxy envia a telegram
import { TELEGRAM_MAX_MESSAGE_LENGTH } from '../constants.js';
import { redact } from '../redact.js';
import type { JobStatus, ProviderId } from '../types.js';

/** nombre legible de cada proveedor para mostrarlo en telegram */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  deepseek: 'DeepSeek',
  glm: 'GLM',
  qwen: 'Qwen',
  kimi: 'Kimi',
  kat: 'KAT',
  minimax: 'MiniMax',
  step: 'Step',
};

/** texto legible de cada estado */
export const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'en cola',
  waiting_for_machine: 'esperando maquina',
  claimed: 'asignado',
  running: 'ejecutando',
  waiting_for_approval: 'esperando aprobacion',
  completed: 'terminado',
  failed: 'fallido',
  cancelled: 'cancelado',
  interrupted: 'interrumpido',
};

/** formatea una duracion en mm:ss o hh:mm:ss */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** escapa los caracteres reservados de MarkdownV2 de telegram */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (char) => `\\${char}`);
}

/**
 * divide un texto largo en varios mensajes respetando el limite de telegram.
 * intenta cortar por saltos de linea y, si no puede, por espacios.
 * nunca produce un fragmento vacio ni pierde caracteres.
 */
export function splitMessage(
  text: string,
  maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH,
): string[] {
  if (maxLength <= 0) throw new Error('maxLength debe ser positivo');
  const input = typeof text === 'string' ? text : '';
  if (input.length === 0) return [];
  if (input.length <= maxLength) return [input];

  const chunks: string[] = [];
  let rest = input;

  while (rest.length > maxLength) {
    const window = rest.slice(0, maxLength);
    // preferencia: ultimo salto de linea, luego ultimo espacio, luego corte duro
    let cut = window.lastIndexOf('\n');
    if (cut < maxLength * 0.5) cut = window.lastIndexOf(' ');
    if (cut < maxLength * 0.5) cut = maxLength;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^[ \n]/, '');
  }

  if (rest.length > 0) chunks.push(rest);
  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * envuelve texto largo en un bloque de codigo troceado.
 * util para diffs y logs, que siempre superan el limite.
 */
export function splitAsCodeBlocks(
  text: string,
  maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH,
): string[] {
  // se reservan los caracteres de la valla de codigo en cada fragmento
  const fenceOverhead = 8;
  return splitMessage(text, maxLength - fenceOverhead).map((chunk) => `\`\`\`\n${chunk}\n\`\`\``);
}

export interface JobCardData {
  shortId: string;
  machineName: string | null;
  projectAlias: string;
  provider: ProviderId;
  status: JobStatus;
  phase?: string | null;
  durationMs?: number | null;
  routerReason?: string | null;
}

/** tarjeta que se envia al crear un trabajo */
export function renderJobCreated(data: JobCardData): string {
  const lines = [
    'Trabajo creado',
    '',
    `ID: ${data.shortId}`,
    `Maquina: ${data.machineName ?? 'sin asignar'}`,
    `Proyecto: ${data.projectAlias}`,
    `Agente: ${PROVIDER_LABELS[data.provider]}`,
    `Estado: ${STATUS_LABELS[data.status]}`,
  ];
  if (data.routerReason) {
    lines.push('', `Proveedor elegido: ${PROVIDER_LABELS[data.provider]}`, `Motivo: ${data.routerReason}`);
  }
  return redact(lines.join('\n'));
}

/** tarjeta que se edita en el mismo mensaje mientras el trabajo avanza */
export function renderJobProgress(data: JobCardData): string {
  const lines = [
    'Luxy esta trabajando',
    '',
    `ID: ${data.shortId}`,
    `Maquina: ${data.machineName ?? 'sin asignar'}`,
    `Proyecto: ${data.projectAlias}`,
    `Agente: ${PROVIDER_LABELS[data.provider]}`,
  ];
  if (typeof data.durationMs === 'number') {
    lines.push(`Duracion: ${formatDuration(data.durationMs)}`);
  }
  lines.push(`Fase: ${data.phase ?? STATUS_LABELS[data.status]}`);
  return redact(lines.join('\n'));
}

export interface JobFinishedData extends JobCardData {
  filesChanged: number;
  testsPassed: number;
  testsFailed: number;
  summary: string;
}

/** tarjeta final con el resultado verificado */
export function renderJobFinished(data: JobFinishedData): string {
  const lines = [
    data.status === 'completed' ? 'Trabajo terminado' : `Trabajo ${STATUS_LABELS[data.status]}`,
    '',
    `ID: ${data.shortId}`,
    `Maquina: ${data.machineName ?? 'sin asignar'}`,
    `Proyecto: ${data.projectAlias}`,
    `Agente: ${PROVIDER_LABELS[data.provider]}`,
    `Duracion: ${formatDuration(data.durationMs ?? 0)}`,
    '',
    `Archivos modificados: ${data.filesChanged}`,
    `Pruebas superadas: ${data.testsPassed}`,
    `Pruebas fallidas: ${data.testsFailed}`,
    '',
    'Resumen:',
    data.summary,
  ];
  return redact(lines.join('\n'));
}

/** convierte un error interno en un mensaje corto, claro y sin secretos */
export function renderError(message: string, hint?: string): string {
  const lines = [`Error: ${message}`];
  if (hint) lines.push('', hint);
  return redact(lines.join('\n'));
}
