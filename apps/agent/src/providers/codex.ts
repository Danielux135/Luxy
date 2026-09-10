// adaptador de Codex CLI.
//
// Codex se usa mediante `codex exec` con la sesion local de ChatGPT.
// Nunca se usa la API de OpenAI ni OPENAI_API_KEY.
// Nunca se usa --dangerously-bypass-approvals-and-sandbox.
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ProviderExecution,
  ProviderRunRequest,
  ProviderRunResult,
  ToolPresence,
} from '@luxy/shared';
import { effortIgnoredWarning } from '@luxy/shared';
import { runProcess, BASE_ENV_ALLOWLIST } from '../process.js';
import { detectTool, readHelp, helpHasFlag } from '../detect.js';

/** flags que admite realmente la version instalada de codex exec */
export interface CodexCapabilities {
  json: boolean;
  cd: boolean;
  sandbox: boolean;
  model: boolean;
  outputLastMessage: boolean;
  skipGitRepoCheck: boolean;
  /**
   * `-i, --image <FILE>...`: adjuntar imagenes al prompt inicial.
   *
   * Codex VE imagenes. Durante un tiempo Luxy dijo lo contrario —«su transporte
   * es un CLI local y solo acepta texto»— y era falso; lo desmintio Daniel, que
   * paga la suscripcion y sabia que su modelo mira. Comprobado contra el CLI el
   * 2026-09-10: `codex exec --help` declara `-i, --image <FILE>...`.
   *
   * Lo que no acepta son BYTES: quiere una ruta en el disco. Por eso vale para
   * el banco de pruebas, donde el archivo lo elige el usuario y ya estaba ahi
   * en claro, y no para la boveda, donde la imagen solo existe descifrada en
   * memoria.
   */
  image: boolean;
  /**
   * `-c key=value`, la opcion generica de configuracion.
   *
   * Es la UNICA via para el esfuerzo de razonamiento: Codex no tiene un flag
   * propio. Comprobado contra `codex exec --help` el 2026-09-10 — declara
   * `-c, --config <key=value>` y ningun `--effort` ni `--reasoning`.
   */
  config: boolean;
}

export function parseCodexCapabilities(help: string | null): CodexCapabilities {
  return {
    json: helpHasFlag(help, '--json'),
    cd: helpHasFlag(help, '--cd') || helpHasFlag(help, '-C'),
    sandbox: helpHasFlag(help, '--sandbox') || helpHasFlag(help, '-s'),
    model: helpHasFlag(help, '--model') || helpHasFlag(help, '-m'),
    outputLastMessage: helpHasFlag(help, '--output-last-message') || helpHasFlag(help, '-o'),
    skipGitRepoCheck: helpHasFlag(help, '--skip-git-repo-check'),
    config: helpHasFlag(help, '--config') || helpHasFlag(help, '-c'),
    image: helpHasFlag(help, '--image') || helpHasFlag(help, '-i'),
  };
}

export interface CodexArgsOptions {
  workingDirectory: string;
  model?: string;
  /**
   * rutas de las imagenes a adjuntar, ya en claro en el disco.
   *
   * Nunca son una copia que Luxy haya escrito: son archivos que el usuario ya
   * tenia. Ver `ProviderImage.path`.
   */
  imagePaths?: readonly string[];
  /**
   * cuanto dejarle pensar. Ausente deja lo que diga su `config.toml`.
   *
   * Y ese «lo que diga» es justo el motivo de que esto exista: en el equipo
   * donde se escribio, el `~/.codex/config.toml` del usuario llevaba meses con
   * `model_reasoning_effort = "xhigh"` y cada turno de Luxy salia ahi sin que
   * nada lo dijera. Los modelos traen `medium` o `low` de fabrica.
   */
  effort?: string;
  capabilities: CodexCapabilities;
  /** archivo donde codex escribe su mensaje final */
  lastMessageFile?: string;
  /** modo de sandbox; nunca danger-full-access */
  sandboxMode?: 'read-only' | 'workspace-write';
}

/**
 * construye los argumentos de `codex exec`.
 * el prompt NO va aqui: se envia por stdin, para que ningun texto de telegram
 * pueda interpretarse como un flag.
 */
export function buildCodexArgs(options: CodexArgsOptions): string[] {
  const { capabilities } = options;
  const args: string[] = ['exec'];

  if (capabilities.json) args.push('--json');

  if (capabilities.cd) {
    // el sandbox queda limitado a este directorio, que es el worktree
    args.push('--cd', options.workingDirectory);
  }

  if (capabilities.sandbox) {
    const mode = options.sandboxMode ?? 'workspace-write';
    // barrera dura: danger-full-access no se admite nunca
    args.push('--sandbox', mode === 'read-only' ? 'read-only' : 'workspace-write');
  }

  if (capabilities.model && options.model) {
    args.push('--model', options.model);
  }

  // Codex no tiene flag de esfuerzo: se pisa la clave de su config.toml.
  //
  // El valor va ENTRECOMILLADO porque `-c` parsea la parte derecha como TOML,
  // y asi es como lo documenta su propia ayuda (`-c model="o3"`). Sin comillas
  // tambien cuela —cae al literal cuando el TOML no parsea— pero apoyarse en el
  // camino de respaldo de otro programa es pedir que un dia cambie.
  //
  // No hay shell de por medio: `spawn` recibe los argumentos separados, asi que
  // estas comillas llegan a Codex tal cual, que es lo que se quiere.
  if (capabilities.config && options.effort) {
    args.push('-c', `model_reasoning_effort="${options.effort}"`);
  }

  // una `-i` por imagen aunque el flag sea variadico: repetir la opcion es
  // inequivoco, y una lista variadica pegada a un argumento posicional es la
  // clase de cosa que se rompe cuando alguien añade un flag detras
  if (capabilities.image && options.imagePaths !== undefined) {
    for (const ruta of options.imagePaths) args.push('-i', ruta);
  }

  if (capabilities.outputLastMessage && options.lastMessageFile) {
    args.push('--output-last-message', options.lastMessageFile);
  }

  // "-" indica a codex que lea las instrucciones de stdin
  args.push('-');
  return args;
}

/** interpreta una linea del jsonl de codex */
export function parseCodexStreamLine(
  line: string,
): { type: string; text: string | null; sessionId: string | null } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith('{')) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type =
    typeof payload.type === 'string'
      ? payload.type
      : typeof payload.msg === 'object' && payload.msg !== null
        ? String((payload.msg as { type?: unknown }).type ?? 'unknown')
        : 'unknown';

  const sessionId =
    typeof payload.session_id === 'string'
      ? payload.session_id
      : typeof payload.id === 'string'
        ? payload.id
        : null;

  // el texto aparece en varios campos segun la version
  let text: string | null = null;
  const candidates = [
    payload.text,
    payload.message,
    payload.last_agent_message,
    (payload.msg as { message?: unknown } | undefined)?.message,
    (payload.msg as { text?: unknown } | undefined)?.text,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      text = candidate;
      break;
    }
  }

  return { type, text, sessionId };
}

export class CodexCliProvider implements ProviderExecution {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';
  /**
   * NO acepta los bytes de una imagen, solo su ruta.
   *
   * Los dos campos juntos son la verdad entera: durante un tiempo solo estaba
   * el primero, en `false` por omision, y de ahi salio un error que le decia
   * al usuario que Codex «solo acepta texto». Codex mira igual de bien que
   * cualquiera; lo que no hace es leer de la memoria de otro proceso.
   */
  readonly acceptsImages = false;
  readonly acceptsImagePaths = true;

  private capabilities: CodexCapabilities | null = null;
  private presence: ToolPresence | null = null;

  constructor(private readonly defaultModel?: string) {}

  async detect(): Promise<ToolPresence> {
    if (this.presence) return this.presence;

    const presence = await detectTool('codex', ['--version'], 60_000);
    this.presence = presence;
    if (!presence.available) return presence;

    // la ayuda relevante es la del subcomando exec, no la general
    const help = await readHelp('codex', ['exec', '--help'], 60_000);
    this.capabilities = parseCodexCapabilities(help);

    if (help === null) {
      // sin ayuda no se puede construir la invocacion con garantias
      this.presence = { ...presence, available: false };
    }
    return this.presence;
  }

  getCapabilities(): CodexCapabilities | null {
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
          'Codex CLI no esta disponible en esta maquina. Instalalo y ejecuta "codex" una vez para iniciar sesion con ChatGPT.',
      };
    }

    if (request.readOnly === true && !this.capabilities.sandbox) {
      return {
        ok: false,
        finalText: '',
        sessionId: null,
        exitCode: null,
        timedOut: false,
        cancelled: false,
        errorMessage:
          'esta version de Codex no ofrece un sandbox de solo lectura; actualizala antes de usar Conversaciones',
      };
    }

    // archivo temporal donde codex deja su mensaje final
    let temporaryDir: string | null = null;
    let lastMessageFile: string | undefined;
    if (this.capabilities.outputLastMessage) {
      temporaryDir = mkdtempSync(join(tmpdir(), 'luxy-codex-'));
      lastMessageFile = join(temporaryDir, 'last-message.txt');
    }

    const args = buildCodexArgs({
      workingDirectory: request.workingDirectory,
      model: request.model ?? this.defaultModel,
      ...(request.effort === undefined ? {} : { effort: request.effort }),
      // solo las que tienen ruta. Una imagen de la boveda no la tiene, y el
      // guardia de `job-runner` ya lo ha rechazado antes de llegar aqui
      imagePaths: (request.images ?? [])
        .map((image) => image.path)
        .filter((ruta): ruta is string => ruta !== undefined && ruta.length > 0),
      capabilities: this.capabilities,
      lastMessageFile,
      sandboxMode: request.readOnly === true ? 'read-only' : 'workspace-write',
    });

    // un ajuste que se cae en silencio es peor que no tenerlo: el usuario cree
    // que esta gastando menos y no lo esta
    const avisoEsfuerzo = effortIgnoredWarning(request.effort, this.capabilities.config, this.displayName);
    if (avisoEsfuerzo !== null) request.onEvent({ type: 'warning', message: avisoEsfuerzo });

    request.onEvent({ type: 'phase', message: 'lanzando Codex CLI' });

    let sessionId: string | null = null;
    let finalText = '';
    let buffer = '';

    const handleLine = (line: string): void => {
      if (!this.capabilities?.json) {
        if (line.trim().length > 0) request.onEvent({ type: 'text', message: line.trim() });
        return;
      }
      const event = parseCodexStreamLine(line);
      if (!event) return;
      if (event.sessionId) sessionId ??= event.sessionId;
      if (event.text) {
        finalText = event.text;
        request.onEvent({ type: 'text', message: event.text.slice(0, 500) });
      } else {
        request.onEvent({ type: 'tool', message: `Codex: ${event.type}` });
      }
    };

    try {
      const result = await runProcess({
        executable: 'codex',
        args,
        cwd: request.workingDirectory,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        envAllowList: BASE_ENV_ALLOWLIST,
        // el prompt viaja por stdin: nunca puede confundirse con un flag
        stdin: request.prompt,
        onStdout: (chunk) => {
          buffer += chunk;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) handleLine(line);
        },
        onStderr: (chunk) => {
          const message = chunk.trim();
          if (message.length > 0) {
            request.onEvent({ type: 'warning', message: message.slice(0, 300) });
          }
        },
      });

      if (buffer.trim().length > 0) handleLine(buffer);

      // el mensaje final del archivo es mas fiable que el del stream
      if (lastMessageFile && existsSync(lastMessageFile)) {
        const fromFile = readFileSync(lastMessageFile, 'utf8').trim();
        if (fromFile.length > 0) finalText = fromFile;
      }

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
          errorMessage: `Codex supero el tiempo maximo de ${Math.round(request.timeoutMs / 1000)}s`,
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
          errorMessage: buildCodexError(result.exitCode, result.stderr),
        };
      }

      if (finalText.length === 0) finalText = result.stdout.trim().slice(-4000);

      return {
        ok: true,
        finalText,
        sessionId,
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        errorMessage: null,
      };
    } finally {
      if (temporaryDir) {
        try {
          rmSync(temporaryDir, { recursive: true, force: true });
        } catch {
          /* el temporal se limpiara con el sistema */
        }
      }
    }
  }
}

export function buildCodexError(exitCode: number | null, stderr: string): string {
  const text = stderr.toLowerCase();
  if (/not logged in|unauthorized|authentication|sign in|login/.test(text)) {
    return 'Codex CLI no tiene sesion iniciada en esta maquina. Ejecuta "codex" en una terminal y autentica tu cuenta de ChatGPT.';
  }
  if (/rate limit|quota|usage limit/.test(text)) {
    return 'Codex ha alcanzado el limite de uso de tu suscripcion. Intentalo mas tarde.';
  }
  if (/not a git repository/.test(text)) {
    return 'Codex requiere un repositorio git. El worktree deberia serlo: revisa el estado del proyecto.';
  }
  const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 300);
  return `Codex termino con codigo ${exitCode ?? 'desconocido'}${detail ? `: ${detail}` : ''}`;
}
