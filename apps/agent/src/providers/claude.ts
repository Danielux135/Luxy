// adaptador de Claude Code CLI.
//
// Claude se usa SIEMPRE mediante el CLI con la sesion local de la suscripcion.
// Nunca se usa la API de Anthropic ni ANTHROPIC_API_KEY.
// Nunca se usa --dangerously-skip-permissions.
import type {
  ProviderExecution,
  ProviderRunRequest,
  ProviderRunResult,
  ToolPresence,
} from '@luxy/shared';
import { runProcess, BASE_ENV_ALLOWLIST } from '../process.js';
import { detectTool, readHelp, helpHasFlag } from '../detect.js';

/** flags que la version instalada admite realmente */
export interface ClaudeCapabilities {
  print: boolean;
  outputFormat: boolean;
  streamJson: boolean;
  model: boolean;
  permissionMode: boolean;
  addDir: boolean;
  verbose: boolean;
  disallowedTools: boolean;
  maxTurns: boolean;
}

/** analiza `claude --help` para saber que se puede usar en esta maquina */
export function parseClaudeCapabilities(help: string | null): ClaudeCapabilities {
  return {
    print: helpHasFlag(help, '--print') || helpHasFlag(help, '-p'),
    outputFormat: helpHasFlag(help, '--output-format'),
    // stream-json solo se ofrece si la ayuda lo menciona explicitamente
    streamJson: Boolean(help && /stream-json/.test(help)),
    model: helpHasFlag(help, '--model'),
    permissionMode: helpHasFlag(help, '--permission-mode'),
    addDir: helpHasFlag(help, '--add-dir'),
    verbose: helpHasFlag(help, '--verbose'),
    disallowedTools:
      helpHasFlag(help, '--disallowedTools') || helpHasFlag(help, '--disallowed-tools'),
    maxTurns: helpHasFlag(help, '--max-turns'),
  };
}

export interface ClaudeArgsOptions {
  prompt: string;
  model?: string;
  capabilities: ClaudeCapabilities;
  /** modo de permisos; nunca se acepta bypassPermissions */
  permissionMode?: string;
}

// herramientas que Luxy no permite a Claude bajo ningun concepto
const DISALLOWED_TOOLS = ['Bash(git push:*)', 'Bash(rm -rf:*)', 'WebFetch'];

/**
 * construye los argumentos segun lo que la version instalada soporta.
 * el prompt va SIEMPRE como argumento separado, nunca concatenado.
 */
export function buildClaudeArgs(options: ClaudeArgsOptions): string[] {
  const { capabilities } = options;
  const args: string[] = [];

  // ejecucion no interactiva
  if (capabilities.print) args.push('--print');

  if (capabilities.model && options.model) {
    args.push('--model', options.model);
  }

  // salida estructurada solo si esta version la ofrece
  if (capabilities.outputFormat && capabilities.streamJson) {
    args.push('--output-format', 'stream-json');
    // stream-json exige --verbose en las versiones que lo soportan
    if (capabilities.verbose) args.push('--verbose');
  }

  if (capabilities.permissionMode) {
    const mode = options.permissionMode ?? 'acceptEdits';
    // barrera dura: aunque la configuracion lo pidiera, se rechaza el bypass
    if (mode !== 'bypassPermissions') args.push('--permission-mode', mode);
  }

  if (capabilities.disallowedTools) {
    args.push('--disallowedTools', ...DISALLOWED_TOOLS);
  }

  // el prompt es el ultimo argumento posicional
  args.push(options.prompt);
  return args;
}

/** un evento de la salida stream-json, normalizado */
export interface ClaudeStreamEvent {
  type: string;
  text: string | null;
  sessionId: string | null;
  isResult: boolean;
}

/** interpreta una linea de stream-json sin fallar si el formato cambia */
export function parseClaudeStreamLine(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith('{')) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = typeof payload.type === 'string' ? payload.type : 'unknown';
  const sessionId =
    typeof payload.session_id === 'string'
      ? payload.session_id
      : typeof payload.sessionId === 'string'
        ? payload.sessionId
        : null;

  // el texto puede venir en varias formas segun el tipo de evento
  let text: string | null = null;
  if (typeof payload.result === 'string') {
    text = payload.result;
  } else if (payload.message && typeof payload.message === 'object') {
    const content = (payload.message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      text = content
        .map((block) =>
          block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
            ? (block as { text: string }).text
            : '',
        )
        .filter((value) => value.length > 0)
        .join('');
      if (text.length === 0) text = null;
    }
  }

  return { type, text, sessionId, isResult: type === 'result' };
}

export class ClaudeCodeProvider implements ProviderExecution {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude';

  private capabilities: ClaudeCapabilities | null = null;
  private presence: ToolPresence | null = null;

  constructor(private readonly defaultModel = 'opus') {}

  /** detecta el ejecutable y, si existe, lee sus capacidades reales */
  async detect(): Promise<ToolPresence> {
    if (this.presence) return this.presence;

    const presence = await detectTool('claude', ['--version'], 60_000);
    this.presence = presence;
    if (!presence.available) return presence;

    const help = await readHelp('claude', ['--help'], 60_000);
    this.capabilities = parseClaudeCapabilities(help);

    // sin modo no interactivo el proveedor no sirve para luxy
    if (!this.capabilities.print) {
      this.presence = { ...presence, available: false };
    }
    return this.presence;
  }

  getCapabilities(): ClaudeCapabilities | null {
    return this.capabilities;
  }

  async run(request: ProviderRunRequest): Promise<ProviderRunResult> {
    const presence = await this.detect();
    if (!presence.available || !this.capabilities) {
      return {
        ok: false,
        finalText: '',
        sessionId: null,
        exitCode: null,
        timedOut: false,
        cancelled: false,
        errorMessage:
          'Claude Code no esta disponible en esta maquina. Instalalo y ejecuta "claude" una vez para iniciar sesion.',
      };
    }

    const args = buildClaudeArgs({
      prompt: request.prompt,
      model: request.model ?? this.defaultModel,
      capabilities: this.capabilities,
    });

    request.onEvent({ type: 'phase', message: 'lanzando Claude Code' });

    let sessionId: string | null = null;
    let finalText = '';
    // stdout llega por trozos: hay que reconstruir las lineas
    let buffer = '';
    const useStreamJson = this.capabilities.outputFormat && this.capabilities.streamJson;

    const handleLine = (line: string): void => {
      if (!useStreamJson) {
        // sin stream-json la salida es texto plano
        if (line.trim().length > 0) request.onEvent({ type: 'text', message: line.trim() });
        return;
      }
      const event = parseClaudeStreamLine(line);
      if (!event) return;
      if (event.sessionId) sessionId = event.sessionId;
      if (event.isResult && event.text) {
        finalText = event.text;
        return;
      }
      if (event.text) {
        request.onEvent({ type: 'text', message: event.text.slice(0, 500) });
      } else if (event.type === 'assistant' || event.type === 'user') {
        request.onEvent({ type: 'tool', message: `Claude: ${event.type}` });
      }
    };

    const result = await runProcess({
      executable: 'claude',
      args,
      cwd: request.workingDirectory,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      // el entorno se restringe: Claude usa su sesion local, no variables
      envAllowList: BASE_ENV_ALLOWLIST,
      onStdout: (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        // el ultimo trozo puede estar incompleto: se guarda para la proxima vez
        buffer = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      },
      onStderr: (chunk) => {
        const message = chunk.trim();
        if (message.length > 0) request.onEvent({ type: 'warning', message: message.slice(0, 300) });
      },
    });

    // se procesa lo que quedara en el buffer
    if (buffer.trim().length > 0) handleLine(buffer);

    if (result.cancelled) {
      return {
        ok: false,
        finalText,
        sessionId,
        exitCode: result.exitCode,
        timedOut: false,
        cancelled: true,
        errorMessage: 'la ejecucion se cancelo desde Telegram',
      };
    }
    if (result.timedOut) {
      return {
        ok: false,
        finalText,
        sessionId,
        exitCode: result.exitCode,
        timedOut: true,
        cancelled: false,
        errorMessage: `Claude Code supero el tiempo maximo de ${Math.round(request.timeoutMs / 1000)}s`,
      };
    }
    if (result.exitCode !== 0) {
      return {
        ok: false,
        finalText,
        sessionId,
        exitCode: result.exitCode,
        timedOut: false,
        cancelled: false,
        errorMessage: buildClaudeError(result.exitCode, result.stderr),
      };
    }

    // sin stream-json el resultado es todo el stdout
    if (!useStreamJson) finalText = result.stdout.trim();

    return {
      ok: true,
      finalText,
      sessionId,
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      errorMessage: null,
    };
  }
}

/** traduce los fallos habituales a un mensaje que se entiende en telegram */
export function buildClaudeError(exitCode: number | null, stderr: string): string {
  const text = stderr.toLowerCase();
  if (/not logged in|unauthorized|authentication|login/.test(text)) {
    return 'Claude Code no tiene sesion iniciada en esta maquina. Ejecuta "claude" en una terminal y autentica tu suscripcion.';
  }
  if (/rate limit|quota|usage limit/.test(text)) {
    return 'Claude Code ha alcanzado el limite de uso de tu suscripcion. Intentalo mas tarde.';
  }
  if (/enoent|not recognized|no se reconoce/.test(text)) {
    return 'No se encontro el ejecutable de Claude Code en el PATH de esta maquina.';
  }
  const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 300);
  return `Claude Code termino con codigo ${exitCode ?? 'desconocido'}${detail ? `: ${detail}` : ''}`;
}
