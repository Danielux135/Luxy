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
  ProviderFailureReason,
  ProviderRunRequest,
  ProviderRunResult,
  ToolPresence,
} from '@luxy/shared';
import { effortIgnoredWarning } from '@luxy/shared';
import { runCodexAppServerTurn } from './codex-app-server.js';
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
   * el subcomando `app-server`, que habla el protocolo por tuberia.
   *
   * Es lo unico que permite mandarle una imagen SIN escribir una copia en el
   * disco, asi que sin el no se pueden describir fotos de la boveda. Se detecta
   * de la ayuda GENERAL, no la de `exec`: es un subcomando hermano suyo.
   */
  appServer: boolean;
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
  /**
   * `--ephemeral`: que `codex exec` no guarde la sesion en disco.
   *
   * Comprobado contra `codex exec --help` de codex-cli 0.154.0 el 2026-09-28:
   * «Run without persisting session files to disk». Sin el, cada turno de la
   * boveda que va por Codex deja la sesion entera, con el prompt, en claro en su
   * carpeta de sesiones. El app-server ya pedia `ephemeral: true`; `exec` no.
   */
  ephemeral: boolean;
}

export function parseCodexCapabilities(
  help: string | null,
  generalHelp: string | null = null,
): CodexCapabilities {
  return {
    json: helpHasFlag(help, '--json'),
    cd: helpHasFlag(help, '--cd') || helpHasFlag(help, '-C'),
    sandbox: helpHasFlag(help, '--sandbox') || helpHasFlag(help, '-s'),
    model: helpHasFlag(help, '--model') || helpHasFlag(help, '-m'),
    outputLastMessage: helpHasFlag(help, '--output-last-message') || helpHasFlag(help, '-o'),
    skipGitRepoCheck: helpHasFlag(help, '--skip-git-repo-check'),
    config: helpHasFlag(help, '--config') || helpHasFlag(help, '-c'),
    image: helpHasFlag(help, '--image') || helpHasFlag(help, '-i'),
    ephemeral: helpHasFlag(help, '--ephemeral'),
    // `app-server` es un subcomando, no un flag: se busca en la ayuda general
    appServer: generalHelp !== null && generalHelp.includes('app-server'),
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

  // lo de solo lectura —conversaciones de Studio y todo lo de la boveda— sin
  // sesion en disco. Un trabajo de codigo la conserva. Sin la capacidad no se
  // pasa: un flag desconocido aborta la invocacion
  if (options.sandboxMode === 'read-only' && capabilities.ephemeral) {
    args.push('--ephemeral');
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

/**
 * tipos de evento con los que `codex exec --json` declara un fallo.
 *
 * `error` y `turn.failed` son los del formato actual; `stream_error` es el
 * aviso de reintento del formato antiguo (`{"msg":{"type":...}}`). En los tres
 * el texto es un mensaje del CLI o del servidor, nunca la respuesta.
 */
const CODEX_ERROR_EVENT_TYPES = new Set(['error', 'turn.failed', 'stream_error']);

/** de esos, los que dan el turno por perdido; un reintento anunciado no */
const CODEX_FATAL_EVENT_TYPES = new Set(['error', 'turn.failed']);

const CODEX_API_ERROR_MESSAGE =
  'Codex devolvio un error en lugar de una respuesta. Abre una consola, ejecuta codex y comprueba que contesta; despues vuelve a intentarlo.';

/**
 * lo que se le dice a Daniel cuando Codex no tiene sesion. Como el de Claude:
 * dice QUE HACER, y lo que imprime el CLI no se copia nunca
 */
export const CODEX_AUTH_MESSAGE =
  'Codex no tiene la sesion iniciada en este equipo. Abre una consola y ejecuta: codex login. Despues vuelve a intentarlo.';

/**
 * tope de la consulta de sesion tras un fallo. Lee la sesion guardada en este
 * equipo y no sale a la red; diez segundos dan margen a un arranque en frio
 */
export const CODEX_AUTH_PROBE_TIMEOUT_MS = 10_000;

/**
 * true si esta version tiene `codex login status`.
 *
 * Se exige la linea de uso del subcomando, no solo `login`: en una version sin
 * `status`, lanzar `codex login status` podria acabar en `codex login`, que
 * abre un inicio de sesion. Comprobado contra codex-cli 0.154.0 el 2026-10-06:
 * `codex login status --help` dice «Usage: codex login status [OPTIONS]».
 */
export function codexLoginStatusSupported(help: string | null): boolean {
  return help !== null && help.includes('codex login status');
}

/**
 * pregunta a Codex si tiene sesion: true, false o null (no se sabe).
 *
 * Existe porque `codex exec --json` no dice con un codigo POR QUE fallo un
 * turno: su evento de error solo trae un mensaje, y clasificar ese mensaje
 * seria adivinar (decimotercera ronda). Sin esto, un Codex sin sesion salia
 * como `api_error` o `exit_code`, que pueden ser de una sola conversacion, y
 * la espera del trabajo de fondo acababa saltando la conversacion activa en
 * vez de esperar al CLI entero y decir que faltaba iniciar sesion.
 *
 * Solo se mira el codigo de salida —0 con sesion, otro sin ella o sin poder
 * leerla, que para un turno es lo mismo—: lo que imprime puede llevar un trozo
 * de una clave, y no sale de aqui. Con el MISMO entorno restringido que las
 * ejecuciones, como `probeClaudeAuth`. Cualquier fallo, tiempo agotado o
 * version sin el subcomando es null, y null no cambia nada.
 */
export async function probeCodexAuth(
  executable = 'codex',
  timeoutMs = CODEX_AUTH_PROBE_TIMEOUT_MS,
): Promise<boolean | null> {
  const help = await readHelp(executable, ['login', 'status', '--help'], timeoutMs);
  if (!codexLoginStatusSupported(help)) return null;
  try {
    const result = await runProcess({
      executable,
      args: ['login', 'status'],
      cwd: process.cwd(),
      timeoutMs,
      envAllowList: BASE_ENV_ALLOWLIST,
    });
    if (result.timedOut || result.cancelled || result.exitCode === null) return null;
    return result.exitCode === 0;
  } catch {
    return null;
  }
}

/** interpreta una linea del jsonl de codex */
export function parseCodexStreamLine(line: string): {
  type: string;
  text: string | null;
  sessionId: string | null;
  /**
   * el evento es un error del CLI. Su texto NO es la respuesta.
   *
   * Antes `{"type":"error","message":...}` aportaba su `message` como texto y
   * acababa siendo `finalText`: con codigo distinto de 0 eso era una respuesta
   * «interrumpida» que se conservaba, con el error del CLI dentro.
   */
  isError: boolean;
  /** el error da el turno por perdido (no es un reintento anunciado) */
  isFatal: boolean;
} | null {
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

  const isError = CODEX_ERROR_EVENT_TYPES.has(type);
  const isFatal = CODEX_FATAL_EVENT_TYPES.has(type);
  // el texto de un error no se extrae siquiera: es la unica forma de que
  // ningun camino posterior pueda confundirlo con la respuesta
  if (isError) return { type, text: null, sessionId, isError, isFatal };

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

  return { type, text, sessionId, isError, isFatal };
}

export class CodexCliProvider implements ProviderExecution {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';
  /**
   * acepta imagenes de las dos formas, cada una por su transporte.
   *
   * Por RUTA con `codex exec -i`, y por BYTES con `app-server`, que las lleva
   * en linea dentro del mensaje. Estuvo en `false` un tiempo y de ahi salio un
   * error que le decia al usuario que Codex «solo acepta texto», lo cual era
   * falso: Codex mira igual de bien que cualquiera.
   *
   * Se declara `true` aunque el app-server pueda faltar en una version vieja.
   * El guardia de `job-runner` solo evita GASTAR una llamada imposible, y aqui
   * no se gasta ninguna: si falta, `run()` devuelve el motivo exacto sin salir
   * a la red. Declararlo `false` daria un mensaje generico y peor.
   */
  readonly acceptsImages = true;
  readonly acceptsImagePaths = true;

  private capabilities: CodexCapabilities | null = null;
  private presence: ToolPresence | null = null;
  private readonly probeAuth: () => Promise<boolean | null>;

  constructor(
    private readonly defaultModel?: string,
    options: {
      /** la consulta de sesion tras un fallo; por defecto, `probeCodexAuth` */
      probeAuth?: () => Promise<boolean | null>;
    } = {},
  ) {
    this.probeAuth = options.probeAuth ?? (() => probeCodexAuth());
  }

  async detect(): Promise<ToolPresence> {
    if (this.presence) return this.presence;

    const presence = await detectTool('codex', ['--version'], 60_000);
    this.presence = presence;
    if (!presence.available) return presence;

    // la ayuda relevante es la del subcomando exec, no la general...
    const help = await readHelp('codex', ['exec', '--help'], 60_000);
    // ...salvo para saber si existe `app-server`, que es hermano de `exec` y
    // solo aparece en la lista de subcomandos de la ayuda general
    const generalHelp = await readHelp('codex', ['--help'], 60_000);
    this.capabilities = parseCodexCapabilities(help, generalHelp);

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

    // EL DESVIO: una imagen sin ruta solo puede ir por el app-server.
    //
    // `codex exec` quiere un fichero, y para el contenido de la boveda no hay
    // ninguno —existe descifrado en memoria y nada mas—. Escribir una copia en
    // claro para que pudiera abrirla romperia lo unico que hace privada a la
    // boveda, asi que se cambia de transporte en vez de cambiar de principio.
    //
    // Se desvia SOLO en este caso, a proposito: el app-server es
    // `[experimental]` segun su propio CLI y su protocolo puede cambiar. Si se
    // rompe, se pierde describir fotos de la boveda con Codex, no Codex.
    const enMemoria = (request.images ?? []).filter(
      (image) => image.path === undefined || image.path.length === 0,
    );
    if (enMemoria.length > 0) {
      if (!this.capabilities.appServer) {
        return {
          ok: false,
          finalText: '',
          sessionId: null,
          exitCode: null,
          timedOut: false,
          cancelled: false,
          errorMessage:
            'esta version de Codex no trae "app-server", que es lo unico que permite mandarle una imagen sin escribir una copia sin cifrar en el disco. Actualiza Codex, o elige otro proveedor para describir esta foto.',
        };
      }
      const porTuberia = await runCodexAppServerTurn({
        prompt: request.prompt,
        images: request.images ?? [],
        cwd: request.workingDirectory,
        model: request.model ?? this.defaultModel,
        effort: request.effort,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        onPhase: (message) => request.onEvent({ type: 'phase', message }),
        onText: (message) => request.onEvent({ type: 'text', message }),
      });
      return {
        ok: porTuberia.ok,
        finalText: porTuberia.finalText,
        sessionId: porTuberia.sessionId,
        exitCode: null,
        timedOut: porTuberia.timedOut,
        cancelled: porTuberia.cancelled,
        errorMessage: porTuberia.errorMessage,
        termination: porTuberia.termination,
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
    // el CLI declaro el turno perdido. Solo es un dato: el texto de ese evento
    // no se guarda en ningun sitio
    let fatalError = false;

    const handleLine = (line: string): void => {
      if (!this.capabilities?.json) {
        if (line.trim().length > 0) request.onEvent({ type: 'text', message: line.trim() });
        return;
      }
      const event = parseCodexStreamLine(line);
      if (!event) return;
      if (event.sessionId) sessionId ??= event.sessionId;
      if (event.isError) {
        if (event.isFatal) fatalError = true;
        // el TIPO del evento es un enum del CLI; su mensaje no sale de aqui
        request.onEvent({ type: 'tool', message: `Codex: ${event.type}` });
        return;
      }
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
      // sin respuesta del modelo y con el turno declarado perdido o con un
      // codigo distinto de 0: es un FALLO, sin texto. Asi el final es `failed`
      // y no una respuesta «interrumpida» que se conserva.
      //
      // Con texto del modelo delante se mantiene lo de siempre —se entrega como
      // parcial—: ese texto si es del modelo, porque el de un error ya no
      // llega a `finalText`.
      if (finalText.length === 0 && (fatalError || result.exitCode !== 0)) {
        // Codex no dice con un codigo si le falta la sesion: se le pregunta.
        // Sin sesion no contesta a nadie, y el trabajo de fondo tiene que
        // esperar al CLI entero en vez de culpar a una conversacion
        // (decimotercera ronda). Su limite de uso no tiene consulta ni codigo,
        // y no se adivina por el texto: lo cubre que lo que se salta caduca
        const failureReason: ProviderFailureReason =
          (await this.probeAuth()) === false ? 'auth' : fatalError ? 'api_error' : 'exit_code';
        return {
          ok: false,
          finalText: '',
          sessionId,
          exitCode: result.exitCode,
          timedOut: false,
          cancelled: false,
          errorMessage:
            failureReason === 'auth'
              ? CODEX_AUTH_MESSAGE
              : failureReason === 'api_error'
                ? CODEX_API_ERROR_MESSAGE
                : buildCodexError(result.exitCode, result.stderr),
          failureReason,
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

      // sin `--json` la salida ES la respuesta en texto plano. Con `--json` son
      // eventos JSONL: su cola no es nada que haya escrito el modelo, y antes se
      // entregaba como respuesta cuando el turno acababa sin mensaje final
      // (duodecima ronda). Vacio se queda vacio, y el job-runner lo da por
      // fallido en una conversacion
      if (finalText.length === 0 && !this.capabilities.json) {
        finalText = result.stdout.trim().slice(-4000);
      }

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

/**
 * traduce un codigo de salida a un mensaje que se entiende en telegram.
 *
 * Como en Claude: stderr se LEE para elegir el mensaje y no se copia, porque
 * lo que imprime un CLI no lo controla Luxy y este texto acaba en pantalla y
 * en los registros. stderr ya llega aparte, como aviso de progreso.
 */
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
  return `Codex termino con codigo ${exitCode ?? 'desconocido'} sin dar una respuesta. Abre una consola y ejecuta codex para ver que le pasa; despues vuelve a intentarlo.`;
}
