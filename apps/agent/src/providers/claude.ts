// adaptador de Claude Code CLI.
//
// Claude se usa SIEMPRE mediante el CLI con la sesion local de la suscripcion.
// Nunca se usa la API de Anthropic ni ANTHROPIC_API_KEY.
// Nunca se usa --dangerously-skip-permissions.
import type {
  ProviderExecution,
  ProviderFailureReason,
  ProviderRunRequest,
  ProviderRunResult,
  ToolPresence,
} from '@luxy/shared';
import { effortIgnoredWarning } from '@luxy/shared';
import { runProcess, BASE_ENV_ALLOWLIST } from '../process.js';
import { detectTool, readHelp, helpHasFlag } from '../detect.js';

/**
 * lo que se le dice a Daniel cuando Claude Code no tiene sesion.
 *
 * Dice QUE HACER y nada mas. El texto que da el propio CLI no se copia aqui
 * nunca: este mensaje llega a la pantalla y a los registros, y lo que imprime
 * un CLI no lo controla Luxy.
 */
export const CLAUDE_AUTH_MESSAGE =
  'Claude Code no tiene la sesion iniciada en este equipo. Abre una consola y ejecuta: claude auth login. Despues vuelve a intentarlo.';

const CLAUDE_RATE_LIMIT_MESSAGE =
  'Claude Code ha llegado a su limite de uso. Espera a que se renueve, o elige otro proveedor para este turno, y vuelve a intentarlo.';

const CLAUDE_API_ERROR_MESSAGE =
  'Claude Code devolvio un error en lugar de una respuesta. Abre una consola, ejecuta claude y comprueba que contesta; despues vuelve a intentarlo.';

/**
 * tope de la consulta de sesion durante la deteccion.
 *
 * Corto a proposito: es un dato informativo y no puede retrasar el arranque.
 * Medido en este equipo, `claude auth status --json` tarda algo mas de medio
 * segundo; diez dan margen a un arranque en frio sin dejar colgado a nadie.
 */
export const CLAUDE_AUTH_PROBE_TIMEOUT_MS = 10_000;

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
  // aqui vivia `maxTurns`, y se fue el 2026-09-10 al actualizar a 2.1.267.
  //
  // Dos motivos, y el segundo es el bueno: `--max-turns` ya no sale en el
  // `--help` de esa version, y `buildClaudeArgs` NO lo usaba — se detectaba y
  // no lo leia nadie. Una capacidad que se calcula y no se consulta es peor que
  // no tenerla: parece que Luxy soporta algo que nunca ha hecho.
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
  /**
   * `--effort <level>`: cuanto se le deja pensar antes de contestar.
   *
   * Comprobado contra el CLI real el 2026-09-10: «Effort level for the current
   * session (low, medium, high, xhigh, max)».
   *
   * Se detecta en vez de darse por hecho por la misma razon que todo lo demas
   * de esta lista: una version anterior no lo tiene, y pasarle un flag que no
   * conoce no lo ignora —aborta la invocacion entera—. Sin deteccion, actualizar
   * Luxy romperia Claude en la maquina de quien no hubiera actualizado el CLI.
   */
  effort: boolean;
  /**
   * `--no-session-persistence`: que `--print` no guarde la sesion en disco.
   *
   * Sin el, Claude Code escribe la sesion ENTERA —con el prompt dentro— en su
   * carpeta de proyectos, en claro. Para un turno de la boveda eso es una copia
   * sin cifrar de lo que la boveda cifra: el hilo, la memoria y, con `D-105`, el
   * resumen de otras dos conversaciones. Luxy no reanuda nunca una sesion de
   * Claude, asi que no se pierde nada.
   */
  noSessionPersistence: boolean;
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
    inputFormat: helpHasFlag(help, '--input-format'),
    restricted: helpHasFlag(help, '--restricted'),
    effort: helpHasFlag(help, '--effort'),
    noSessionPersistence: helpHasFlag(help, '--no-session-persistence'),
  };
}

export interface ClaudeArgsOptions {
  prompt: string;
  model?: string;
  /** cuanto dejarle pensar; ausente deja el de su sesion */
  effort?: string;
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

  // todo lo de solo lectura —las conversaciones de Studio y TODO lo de la
  // boveda, turnos y trabajo de fondo, que van por `studioMode: conversation`—
  // sin transcripcion en disco. Un trabajo de codigo la conserva: es donde puede
  // servirle a Daniel reabrirla. Sin la capacidad no se pasa: un flag que la
  // version no conoce aborta la invocacion entera
  if (options.readOnly === true && capabilities.noSessionPersistence) {
    args.push('--no-session-persistence');
  }

  if (capabilities.model && options.model) {
    args.push('--model', options.model);
  }

  // el esfuerzo va detras del modelo porque se lee junto con el, no porque el
  // orden importe: son dos opciones con nombre
  if (capabilities.effort && options.effort) {
    args.push('--effort', options.effort);
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
  /**
   * el CLI marco este evento como error: un `result` con `is_error: true` o un
   * `assistant` con `error`. Su texto es el mensaje del CLI y NUNCA la
   * respuesta, aunque llegue en el mismo campo que una respuesta.
   *
   * Por que no basta con `subtype`: sin sesion, el CLI emite un `result` con
   * `subtype: "success"` y `is_error: true` a la vez. Comprobado con el CLI de
   * este equipo el 2026-10-05; la unica señal fiable es `is_error`.
   */
  isError: boolean;
  /**
   * la categoria que pone el CLI en `error` del `assistant` sintetico
   * (`authentication_failed`, `rate_limit`...). Es un enum del CLI, no prosa;
   * aun asi solo sirve para decidir y no se copia a ningun mensaje ni registro.
   */
  errorCategory: string | null;
}

/** forma de un enum del CLI; cualquier otra cosa no se toma por categoria */
const CLI_ENUM = /^[a-z][a-z0-9_]{0,63}$/;

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

  const isResult = type === 'result';
  // el `assistant` sintetico de un fallo de API lleva la categoria arriba del
  // todo, junto a `is_api_error_message`; su `message.model` es "<synthetic>"
  const errorCategory =
    type === 'assistant' && typeof payload.error === 'string' && CLI_ENUM.test(payload.error)
      ? payload.error
      : null;
  const isError = isResult
    ? payload.is_error === true
    : type === 'assistant' &&
      (errorCategory !== null ||
        (typeof payload.error === 'string' && payload.error.length > 0) ||
        payload.is_api_error_message === true);

  return { type, text, sessionId, isResult, isError, errorCategory };
}

/**
 * lo que la salida stream-json deja dicho sobre como acabo el turno.
 *
 * Se separa del proceso para poder probarlo con salidas grabadas, sin lanzar
 * el CLI ni gastar nada.
 */
export class ClaudeStreamState {
  sessionId: string | null = null;
  /** texto del ultimo `result` que NO venia marcado como error */
  finalText = '';
  /** el ultimo `result` llego con `is_error: true` */
  resultIsError = false;
  /**
   * el ultimo `assistant` fue un error del CLI.
   *
   * Se borra si despues llega un `assistant` normal: un fallo intermedio del
   * que el CLI se recupero no convierte en fallo una respuesta que si llego.
   */
  assistantError = false;
  /** categoria de ese error, si el CLI la dio con forma de enum */
  errorCategory: string | null = null;

  accept(event: ClaudeStreamEvent): void {
    if (event.sessionId) this.sessionId = event.sessionId;
    if (event.isResult) {
      this.resultIsError = event.isError;
      // el texto de un resultado de error es el mensaje del CLI: no se guarda
      // ni siquiera aparte, para que ningun camino pueda acabar usandolo
      this.finalText = event.isError ? '' : (event.text ?? '');
      return;
    }
    if (event.type === 'assistant') {
      this.assistantError = event.isError;
      this.errorCategory = event.isError ? event.errorCategory : null;
    }
  }

  /** el CLI dijo, de forma estructurada, que el turno fallo */
  get failed(): boolean {
    return this.resultIsError || this.assistantError;
  }
}

/**
 * traduce la categoria del CLI a la de Luxy.
 *
 * Solo dos categorias tienen traduccion propia, y las dos salen de enums del
 * propio CLI, no de buscar palabras en un texto. `rate_limit` es como el CLI
 * etiqueta un HTTP 429 (visto en su clasificador: `status===429` da
 * `"rate_limit"`). Las demas —`overloaded`, `billing_error`, `server_error`...—
 * se dejan en `api_error`: inventar una accion para cada una seria adivinar.
 */
export function claudeFailureReasonFor(errorCategory: string | null): ProviderFailureReason {
  if (errorCategory === 'authentication_failed') return 'auth';
  if (errorCategory === 'rate_limit') return 'rate_limit';
  return 'api_error';
}

/**
 * por que fallo el turno segun la salida y el codigo de salida, o null si no
 * fallo. El orden importa: la señal estructurada del CLI manda sobre el codigo.
 * Hoy un resultado de error sale con codigo 1, pero un `is_error: true` con
 * codigo 0 no seria menos error, y su texto seguiria sin ser una respuesta.
 */
export function classifyClaudeExit(
  stream: ClaudeStreamState,
  exitCode: number | null,
): ProviderFailureReason | null {
  if (stream.failed) return claudeFailureReasonFor(stream.errorCategory);
  if (exitCode !== 0 && stream.finalText.length === 0) return 'exit_code';
  return null;
}

/** el mensaje para Daniel de cada motivo: dice que hacer, no lo que dijo el CLI */
export function describeClaudeFailure(
  reason: ProviderFailureReason,
  exitCode: number | null,
  stderr: string,
): string {
  switch (reason) {
    case 'auth':
      return CLAUDE_AUTH_MESSAGE;
    case 'rate_limit':
      return CLAUDE_RATE_LIMIT_MESSAGE;
    case 'api_error':
      return CLAUDE_API_ERROR_MESSAGE;
    case 'exit_code':
      return buildClaudeError(exitCode, stderr);
  }
}

/**
 * true si esta version tiene `claude auth status --json`.
 *
 * Se exige la linea de uso del subcomando, no solo el flag: una version sin
 * `auth` responde a `claude auth status --help` con la ayuda GENERAL, y
 * lanzar despues `claude auth status --json` en esa version seria lanzar un
 * prompt.
 */
export function claudeAuthStatusSupported(help: string | null): boolean {
  return help !== null && /claude auth status/.test(help) && helpHasFlag(help, '--json');
}

/**
 * lee `loggedIn` de `claude auth status --json`; null si no se puede saber.
 *
 * Sin sesion el CLI sale con codigo 1 y AUN ASI escribe el JSON, asi que el
 * codigo de salida no decide nada. Del objeto solo se mira ese campo: el resto
 * —correo, organizacion— no lo necesita Luxy y no sale de esta funcion.
 */
export function parseClaudeAuthStatus(stdout: string): boolean | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const payload = JSON.parse(stdout.slice(start, end + 1)) as unknown;
    if (typeof payload !== 'object' || payload === null) return null;
    const loggedIn = (payload as { loggedIn?: unknown }).loggedIn;
    return typeof loggedIn === 'boolean' ? loggedIn : null;
  } catch {
    return null;
  }
}

/**
 * pregunta al CLI si tiene sesion: true, false o null (no se sabe).
 *
 * Con el MISMO entorno restringido que las ejecuciones: lo que importa es si
 * la sesion que vera un turno de Luxy existe, no la que veria una consola con
 * todas las variables del usuario. Cualquier fallo, tiempo agotado o version
 * sin el subcomando es null, y null no bloquea nada.
 */
export async function probeClaudeAuth(
  executable = 'claude',
  timeoutMs = CLAUDE_AUTH_PROBE_TIMEOUT_MS,
): Promise<boolean | null> {
  const help = await readHelp(executable, ['auth', 'status', '--help'], timeoutMs);
  if (!claudeAuthStatusSupported(help)) return null;
  try {
    const result = await runProcess({
      executable,
      args: ['auth', 'status', '--json'],
      cwd: process.cwd(),
      timeoutMs,
      envAllowList: BASE_ENV_ALLOWLIST,
    });
    if (result.timedOut || result.cancelled) return null;
    return parseClaudeAuthStatus(result.stdout);
  } catch {
    return null;
  }
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
  private authenticated: boolean | null = null;

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
      return this.presence;
    }

    // la sesion se consulta, pero NO decide la disponibilidad.
    //
    // Durante mas de una semana el CLI de este equipo estuvo sin sesion y Luxy
    // no lo supo: la deteccion solo miraba `--version` y `--help`. Ahora se
    // mira, y se deja como dato. Quitar Claude de los disponibles por esto seria peor:
    // la consulta puede equivocarse o no existir en otra version, y entonces
    // Claude desapareceria sin que nadie entendiera por que. El turno que falle
    // por falta de sesion ya lo dice el solo (`failureReason: 'auth'`).
    this.authenticated = await probeClaudeAuth();
    return this.presence;
  }

  getCapabilities(): ClaudeCapabilities | null {
    return this.capabilities;
  }

  /**
   * si el CLI tenia sesion al detectarlo: true, false o null si no se sabe.
   *
   * Es una foto del arranque, no un estado vivo: si Daniel inicia sesion
   * despues, esto no cambia hasta la siguiente deteccion. Por eso no bloquea
   * nada y solo sirve para avisar.
   */
  getAuthenticated(): boolean | null {
    return this.authenticated;
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
      // sin esto el selector de la pantalla no haria nada, que es exactamente
      // lo que ya paso una vez con el modelo (ver `job-runner.ts`: «solo se le
      // pasaba a claude, asi que codex y las APIs http usaban siempre su modelo
      // por defecto»)
      ...(request.effort === undefined ? {} : { effort: request.effort }),
      capabilities: this.capabilities,
      readOnly: request.readOnly === true,
      withImages: imagenes.length > 0,
    });

    // un ajuste que se cae en silencio es peor que no tenerlo: el usuario cree
    // que esta gastando menos y no lo esta
    const avisoEsfuerzo = effortIgnoredWarning(request.effort, this.capabilities.effort, this.displayName);
    if (avisoEsfuerzo !== null) request.onEvent({ type: 'warning', message: avisoEsfuerzo });

    request.onEvent({ type: 'phase', message: 'lanzando Claude Code' });

    const stream = new ClaudeStreamState();
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
      stream.accept(event);
      // el resultado es la respuesta entera y vuelve aparte. Un error del CLI
      // no se enseña como progreso: en un trabajo de la cola, `text` acaba en
      // la salida visible del modelo, y ese texto no es del modelo
      if (event.isResult || event.isError) return;
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

    const sessionId = stream.sessionId;
    // solo el texto de un `result` que NO era error: el de un error es el
    // mensaje del CLI y ni siquiera llega a esta variable
    let finalText = stream.finalText;

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
    // un fallo que el CLI declara es un FALLO, con cualquier codigo de salida.
    //
    // Sin sesion, Claude Code emite un `result` con `is_error: true` cuyo
    // texto es el mensaje de error, y sale con codigo 1. Antes ese texto se
    // devolvia como `finalText` junto a `ok: false`, y aguas abajo eso es una
    // respuesta «interrumpida» que se conserva: el turno salia completado con
    // el error dentro, y los trabajos de fondo lo contaban como una negativa
    // de Claude. Ahora no hay texto, asi que el final es `failed` de verdad.
    const failureReason = useStreamJson
      ? classifyClaudeExit(stream, result.exitCode)
      : result.exitCode !== 0
        ? 'exit_code'
        : null;
    if (failureReason !== null) {
      return {
        ok: false,
        finalText: '',
        sessionId,
        exitCode: result.exitCode,
        timedOut: false,
        cancelled: false,
        errorMessage: describeClaudeFailure(failureReason, result.exitCode, result.stderr),
        failureReason,
      };
    }
    if (result.exitCode !== 0) {
      // codigo distinto de 0 DESPUES de un resultado que no era error: lo que
      // llego si es del modelo, y se entrega como parcial, igual que antes
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

/**
 * traduce un codigo de salida a un mensaje que se entiende en telegram.
 *
 * stderr se LEE para elegir el mensaje, pero no se copia: lo que imprime un
 * CLI no lo controla Luxy, y este mensaje acaba en la pantalla y en los
 * registros. Antes se pegaban sus tres ultimas lineas; ahora se dice que hacer
 * para verlo uno mismo. stderr ya llega aparte, como aviso de progreso.
 */
export function buildClaudeError(exitCode: number | null, stderr: string): string {
  const text = stderr.toLowerCase();
  if (/not logged in|unauthorized|authentication|login/.test(text)) {
    return CLAUDE_AUTH_MESSAGE;
  }
  if (/rate limit|quota|usage limit/.test(text)) {
    return CLAUDE_RATE_LIMIT_MESSAGE;
  }
  if (/enoent|not recognized|no se reconoce/.test(text)) {
    return 'No se encontro el ejecutable de Claude Code en el PATH de esta maquina.';
  }
  return `Claude Code termino con codigo ${exitCode ?? 'desconocido'} sin dar una respuesta. Abre una consola y ejecuta claude para ver que le pasa; despues vuelve a intentarlo.`;
}
