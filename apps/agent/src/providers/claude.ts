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
  /**
   * `--input-format`, que es lo unico que permite mandarle una IMAGEN.
   *
   * Comprobado contra el CLI real (2.1.250): con `--input-format stream-json`
   * la entrada estandar admite un mensaje con bloques de contenido, y uno puede
   * ser una imagen en base64. Sin esto la imagen se descartaba en silencio y
   * Claude contestaba «no hay ninguna imagen adjunta».
   *
   * La CLI exige que la salida sea tambien stream-json cuando la entrada lo es.
   */
  inputFormat: boolean;
  /**
   * `--restricted`: quita las herramientas que ejecutan comandos o codigo.
   *
   * Se usa en el turno que DESCRIBE una imagen, en lugar del modo plan. Con
   * `--permission-mode plan` Claude cree que le piden planificar un cambio de
   * codigo y remata la descripcion con «esto no requiere planificacion ni
   * cambios de codigo», que acababa dentro del pie de foto. Comprobado con el
   * binario: con `--restricted` la respuesta es solo la descripcion.
   */
  restricted: boolean;
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
    inputFormat: helpHasFlag(help, '--input-format'),
    restricted: helpHasFlag(help, '--restricted'),
  };
}

export interface ClaudeArgsOptions {
  prompt: string;
  model?: string;
  capabilities: ClaudeCapabilities;
  /** modo de permisos; nunca se acepta bypassPermissions */
  permissionMode?: string;
  /** bloquea todas las herramientas que pueden escribir o ejecutar comandos */
  readOnly?: boolean;
  /**
   * hay imagenes que mandar, asi que la entrada tiene que ser stream-json.
   *
   * Solo cambia el FORMATO de entrada: los bytes van por stdin igual que el
   * prompt, sin escribir ninguna copia sin cifrar en disco. Eso es lo que
   * descarta el `--image <FILE>` de Codex para el contenido de la boveda: ese
   * exige una ruta real en el sistema de ficheros.
   */
  withImages?: boolean;
}

// herramientas que Luxy no permite a Claude bajo ningun concepto
const DISALLOWED_TOOLS = ['Bash(git push:*)', 'Bash(rm -rf:*)', 'WebFetch'];
const READ_ONLY_DISALLOWED_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
];

/**
 * construye los argumentos segun lo que la version instalada soporta.
 * el prompt NUNCA va aqui: viaja por stdin, igual que en codex.
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

  // con imagenes la entrada tiene que ser stream-json: es el unico formato que
  // admite bloques de contenido. La CLI exige ademas que la salida lo sea, y
  // eso ya lo garantiza el bloque de arriba
  if (options.withImages === true && capabilities.inputFormat && capabilities.streamJson) {
    args.push('--input-format', 'stream-json');
  }

  // describir una imagen no es planificar un cambio de codigo.
  //
  // Con `--permission-mode plan`, Claude remataba la descripcion con «esto no
  // requiere planificacion ni cambios de codigo», y esa frase acababa dentro
  // del pie de foto. `--restricted` deja el mismo aislamiento —quita las
  // herramientas que ejecutan comandos o codigo, y encima ignora los archivos
  // de configuracion del usuario— sin ese marco. Las herramientas de escritura
  // siguen bloqueadas aparte por `--disallowedTools`.
  const describiendo = options.withImages === true && capabilities.restricted;
  if (describiendo) args.push('--restricted');

  if (capabilities.permissionMode && !describiendo) {
    const mode = options.readOnly === true ? 'plan' : (options.permissionMode ?? 'acceptEdits');
    // barrera dura: aunque la configuracion lo pidiera, se rechaza el bypass
    if (mode !== 'bypassPermissions') args.push('--permission-mode', mode);
  }

  if (capabilities.disallowedTools) {
    // --disallowedTools es VARIADICO: si el prompt fuera detras, la CLI se
    // tragaria sus palabras como reglas de herramienta. Eso producia errores
    // del tipo 'Permission deny rule "credenciales" matches no known tool' y
    // dejaba a Claude sin prompt. Por eso el prompt va por stdin.
    args.push(
      '--disallowedTools',
      ...(options.readOnly === true ? READ_ONLY_DISALLOWED_TOOLS : DISALLOWED_TOOLS),
    );
  }

  // el prompt NO va como argumento: se envia por stdin (ver run()). Añadirlo
  // aqui volveria a romper el parseo de --disallowedTools.
  return args;
}

/**
 * el mensaje que Claude Code espera por stdin cuando lleva imagenes.
 *
 * Es una linea JSON con bloques de contenido, en el formato de la API de
 * Anthropic. Comprobado contra el CLI real (2.1.250): con un PNG en base64
 * contesto «Dos rectangulos: rojo a la izquierda y azul a la derecha», o sea
 * que la imagen llega de verdad.
 *
 * La imagen viaja en base64 por la ENTRADA ESTANDAR. No se escribe ninguna
 * copia sin cifrar en disco, que es lo que descarta el `--image <FILE>` de
 * Codex para el contenido de la boveda: ese exige una ruta real.
 *
 * `base64` se manda PURO, sin el prefijo `data:`: el bloque ya declara el tipo
 * en `media_type`, y colar el prefijo dentro produce un error de imagen
 * corrupta que no explica nada.
 */
export function buildClaudeImageInput(
  prompt: string,
  images: readonly { mimeType: string; base64: string }[],
): string {
  const mensaje = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map((imagen) => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: imagen.mimeType,
            data: imagen.base64.replace(/^data:[^;]+;base64,/, ''),
          },
        })),
      ],
    },
  };
  // una sola linea y salto final: es JSONL, y sin el salto la CLI se queda
  // esperando a que termine el mensaje
  return `${JSON.stringify(mensaje)}\n`;
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
          block &&
          typeof block === 'object' &&
          typeof (block as { text?: unknown }).text === 'string'
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
  /**
   * sí sabe llevarlas, por `--input-format stream-json`.
   *
   * Si la versión instalada no admite ese flag, `run()` lo dice y falla; no se
   * declara aquí en función de las capacidades porque `detect()` corre después
   * de construirse y esto tiene que ser una constante del transporte.
   */
  readonly acceptsImages = true;

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

    if (request.readOnly === true && !this.capabilities.disallowedTools) {
      return {
        ok: false,
        finalText: '',
        sessionId: null,
        exitCode: null,
        timedOut: false,
        cancelled: false,
        errorMessage:
          'esta version de Claude Code no puede bloquear las herramientas de escritura; actualizala antes de usar Conversaciones',
      };
    }

    const imagenes = request.images ?? [];
    // sin `--input-format` no hay forma de mandarle una imagen a esta version:
    // se dice en vez de ejecutar el turno y devolver «no hay ninguna imagen»
    if (imagenes.length > 0 && !(this.capabilities.inputFormat && this.capabilities.streamJson)) {
      return {
        ok: false,
        finalText: '',
        sessionId: null,
        exitCode: null,
        timedOut: false,
        cancelled: false,
        errorMessage:
          'esta version de Claude Code no admite --input-format stream-json, que es lo unico que permite adjuntar una imagen; actualizala',
      };
    }

    const args = buildClaudeArgs({
      prompt: request.prompt,
      model: request.model ?? this.defaultModel,
      capabilities: this.capabilities,
      readOnly: request.readOnly === true,
      withImages: imagenes.length > 0,
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
      // el prompt por stdin: como argumento lo absorbia --disallowedTools.
      // Con imagenes va el mensaje entero en stream-json, que es la unica forma
      // de adjuntarlas: en base64, sin escribir ninguna copia sin cifrar a disco
      stdin: imagenes.length > 0 ? buildClaudeImageInput(request.prompt, imagenes) : request.prompt,
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
        if (message.length > 0)
          request.onEvent({ type: 'warning', message: message.slice(0, 300) });
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
