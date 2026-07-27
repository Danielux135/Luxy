// parser de comandos y menciones de telegram.
// todo lo que entra por aqui es dato NO CONFIABLE: solo se extraen campos, nunca
// se interpretan instrucciones que cambien las politicas de luxy.
import { MAX_PROMPT_LENGTH, PROVIDER_IDS } from '../constants.js';
import type { ProviderId } from '../types.js';

// comandos que no llevan proveedor asociado
export const CONTROL_COMMANDS = [
  'start',
  'help',
  'status',
  'machines',
  'use',
  'projects',
  'providers',
  'cancel',
  'job',
  'logs',
] as const;

export type ControlCommand = (typeof CONTROL_COMMANDS)[number];

// comandos que lanzan un trabajo: los proveedores mas "auto"
export const TASK_COMMANDS = [...PROVIDER_IDS, 'auto'] as const;
export type TaskCommand = (typeof TASK_COMMANDS)[number];

export type ParsedCommand =
  | { kind: 'control'; command: ControlCommand; argument: string | null }
  | {
      kind: 'task';
      command: TaskCommand;
      provider: ProviderId | null; // null significa modo automatico
      projectAlias: string;
      prompt: string;
    }
  | { kind: 'unknown'; command: string }
  | { kind: 'none' };

export class CommandParseError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CommandParseError';
  }
}

/** separa "/comando@BotName resto" en sus partes */
function splitCommand(text: string): { command: string; botName: string | null; rest: string } | null {
  const match = /^\/([a-zA-Z0-9_]{1,32})(?:@([a-zA-Z0-9_]{1,32}))?(?:\s+([\s\S]*))?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  return {
    command: match[1]!.toLowerCase(),
    botName: match[2] ?? null,
    rest: (match[3] ?? '').trim(),
  };
}

function isControlCommand(value: string): value is ControlCommand {
  return (CONTROL_COMMANDS as readonly string[]).includes(value);
}

function isTaskCommand(value: string): value is TaskCommand {
  return (TASK_COMMANDS as readonly string[]).includes(value);
}

/** valida y recorta el prompt que el usuario envio */
function normalizePrompt(raw: string): string {
  const prompt = raw.trim();
  if (prompt.length === 0) {
    throw new CommandParseError(
      'falta la descripcion de la tarea',
      'formato: /claude <proyecto> <tarea>',
    );
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new CommandParseError(
      `la tarea supera el limite de ${MAX_PROMPT_LENGTH} caracteres`,
      'resume la peticion o adjunta el contexto por partes',
    );
  }
  return prompt;
}

/** valida el alias de proyecto sin depender de zod, para dar un error legible */
function normalizeAlias(raw: string): string {
  const alias = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(alias)) {
    throw new CommandParseError(
      `"${raw}" no es un alias de proyecto valido`,
      'usa /projects para ver los alias configurados',
    );
  }
  return alias;
}

export interface ParseOptions {
  /** username del bot sin arroba, para aceptar /comando@LuxyBot */
  botUsername?: string;
}

/**
 * analiza un texto que empieza por barra.
 * devuelve `none` si el texto no es un comando.
 */
export function parseCommand(text: string, options: ParseOptions = {}): ParsedCommand {
  if (typeof text !== 'string' || !text.trim().startsWith('/')) return { kind: 'none' };

  const parts = splitCommand(text);
  if (!parts) return { kind: 'none' };

  // en grupos telegram añade @BotName: si no es este bot, se ignora
  if (parts.botName && options.botUsername) {
    if (parts.botName.toLowerCase() !== options.botUsername.toLowerCase()) {
      return { kind: 'none' };
    }
  }

  if (isControlCommand(parts.command)) {
    return {
      kind: 'control',
      command: parts.command,
      argument: parts.rest.length > 0 ? parts.rest : null,
    };
  }

  if (isTaskCommand(parts.command)) {
    // el primer token es el alias del proyecto, el resto es la tarea
    const separatorIndex = parts.rest.search(/\s/);
    if (separatorIndex === -1) {
      throw new CommandParseError(
        'falta la descripcion de la tarea',
        `formato: /${parts.command} <proyecto> <tarea>`,
      );
    }
    const alias = normalizeAlias(parts.rest.slice(0, separatorIndex));
    const prompt = normalizePrompt(parts.rest.slice(separatorIndex));
    return {
      kind: 'task',
      command: parts.command,
      provider: parts.command === 'auto' ? null : (parts.command as ProviderId),
      projectAlias: alias,
      prompt,
    };
  }

  return { kind: 'unknown', command: parts.command };
}

// -----------------------------------------------------------------------------
// menciones naturales en grupos
// -----------------------------------------------------------------------------

export interface MentionExtraction {
  /** true si el mensaje menciona al bot o responde a un mensaje suyo */
  mentioned: boolean;
  /** texto sin la mencion, listo para interpretarse */
  text: string;
  /** proveedor detectado por nombre dentro del texto libre */
  provider: ProviderId | null;
}

// nombres con los que el usuario puede referirse a cada proveedor en lenguaje natural
const PROVIDER_ALIASES: Record<ProviderId, string[]> = {
  claude: ['claude', 'opus', 'sonnet'],
  codex: ['codex', 'chatgpt', 'gpt'],
  deepseek: ['deepseek', 'deep seek'],
  glm: ['glm', 'zhipu'],
  qwen: ['qwen', 'tongyi'],
};

/**
 * detecta si el bot fue mencionado y limpia el texto.
 * en grupos, un mensaje sin mencion y sin respuesta al bot se ignora entero.
 */
export function extractMention(
  text: string,
  options: { botUsername?: string; isReplyToBot?: boolean; isPrivateChat?: boolean } = {},
): MentionExtraction {
  const raw = typeof text === 'string' ? text : '';
  let cleaned = raw.trim();
  let mentioned = false;

  if (options.botUsername) {
    const mentionPattern = new RegExp(`@${escapeRegExp(options.botUsername)}\\b`, 'gi');
    if (mentionPattern.test(cleaned)) {
      mentioned = true;
      cleaned = cleaned.replace(mentionPattern, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // en privado no hace falta mencionar; una respuesta directa al bot tambien cuenta
  if (options.isPrivateChat || options.isReplyToBot) mentioned = true;

  return { mentioned, text: cleaned, provider: detectProvider(cleaned) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** busca el nombre de un proveedor dentro de texto libre */
export function detectProvider(text: string): ProviderId | null {
  const lower = text.toLowerCase();
  for (const providerId of PROVIDER_IDS) {
    for (const alias of PROVIDER_ALIASES[providerId]) {
      // limites de palabra para no confundir "gpt" dentro de otra palabra
      if (new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(lower)) return providerId;
    }
  }
  return null;
}

/**
 * intenta interpretar una mencion natural como un trabajo.
 * necesita la lista de alias configurados porque el texto es libre.
 */
export function parseNaturalMention(
  text: string,
  knownAliases: string[],
): { provider: ProviderId | null; projectAlias: string | null; prompt: string } {
  const provider = detectProvider(text);
  const lower = text.toLowerCase();

  // se busca el alias mas largo que aparezca, para que "portfolio-v2" gane a "portfolio"
  const found = knownAliases
    .filter((alias) => new RegExp(`\\b${escapeRegExp(alias.toLowerCase())}\\b`).test(lower))
    .sort((a, b) => b.length - a.length);

  return {
    provider,
    projectAlias: found[0] ?? null,
    prompt: text.trim(),
  };
}
