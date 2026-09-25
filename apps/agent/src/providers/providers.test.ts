import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  parseClaudeCapabilities,
  buildClaudeArgs,
  parseClaudeStreamLine,
  buildClaudeError,
  buildClaudeImageInput,
  type ClaudeCapabilities,
} from './claude.js';
import {
  parseCodexCapabilities,
  buildCodexArgs,
  parseCodexStreamLine,
  buildCodexError,
  type CodexCapabilities,
} from './codex.js';
import {
  describeHttpError,
  providerSaid,
  collectRateLimitHeaders,
  parseRetryAfter,
  HttpApiProvider,
  MemoryBudgetStore,
  EXAMPLE_HTTP_PROVIDERS,
  classifyBilledFailure,
  resolveHttpRequestTimeout,
  buildUserContent,
  measurePayload,
  errorCodeOf,
} from './http-provider.js';
import {
  httpProviderConfigSchema,
  modelLimitsSchema,
  RetryError,
  PROVIDER_CALL_LOG_MESSAGE,
  PROVIDER_SILENCE_TIMEOUT_MS,
  SOFT_TERMINAL_GRACE_MS,
  TERMINAL_GRACE_MS,
  type ProviderRunRequest,
  type ProviderCallRecord,
} from '@luxy/shared';
import { isSilenceTimeout, silenceTransportAvailable } from './http-dispatcher.js';
import { helpHasFlag, extractVersion } from '../detect.js';
import { AgentLogger } from '../logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ayuda real recortada de Claude Code 2.1.183
const CLAUDE_HELP = `
Usage: claude [options] [command] [prompt]
Options:
  --add-dir <directories...>   Additional directories
  --allowedTools <tools...>    Comma or space-separated list
  --disallowedTools <tools...> Tools to disallow
  --model <model>              Model for the current session
  --output-format <format>     Output format (only works with --print): text, json, stream-json
  --permission-mode <mode>     Permission mode to use for the session
  -p, --print                  Print response and exit
  --verbose                    Override verbose mode setting
  --max-turns <n>              Limit turns
`;

/**
 * ayuda real recortada de Claude Code 2.1.250, leida del binario instalado el
 * 2026-09-07.
 *
 * Va aparte y no se añade a la de 2.1.183: esa es la ayuda de OTRA version, y
 * retocarla para que pase una prueba seria fingir que una version antigua
 * admite un flag que no tiene. La deteccion de capacidades existe justo para
 * distinguirlas.
 *
 * La linea de `--effort` se añadio el 2026-09-10 releyendo el MISMO binario,
 * que sigue siendo el 2.1.250: estaba recortada, no ausente. No es un retoque
 * para que pase nada — se comprobo antes de escribir la prueba.
 */
const CLAUDE_HELP_2_1_250 = `
Usage: claude [options] [command] [prompt]
Options:
  --disallowedTools <tools...> Tools to disallow
  --model <model>              Model for the current session
  --input-format <format>      Input format (only works with --print): "text" (default), or "stream-json" (realtime streaming input) (choices: "text", "stream-json")
  --restricted                 Restricted mode: removes the built-in tools that run commands or code
  --output-format <format>     Output format (only works with --print): "text", "json", or "stream-json" (choices: "text", "json", "stream-json")
  --permission-mode <mode>     Permission mode to use for the session
  -p, --print                  Print response and exit
  --verbose                    Override verbose mode setting
  --effort <level>             Effort level for the current session (low, medium, high, xhigh, max)
`;

// ayuda real recortada de codex-cli 0.141.0
const CODEX_HELP = `
Run Codex non-interactively
Usage: codex exec [OPTIONS] [PROMPT]
Options:
  -m, --model <MODEL>
  -s, --sandbox <SANDBOX_MODE>   [possible values: read-only, workspace-write, danger-full-access]
  -C, --cd <DIR>
      --skip-git-repo-check
      --json                     Print events to stdout as JSONL
  -o, --output-last-message <FILE>
  -c, --config <key=value>       Override a configuration value
  -i, --image <FILE>...          Optional image(s) to attach to the initial prompt
`;

// ayuda de una version de codex SIN `-c`: el esfuerzo no se puede pedir ahi
const CODEX_HELP_SIN_CONFIG = `
Run Codex non-interactively
Usage: codex exec [OPTIONS] [PROMPT]
Options:
  -m, --model <MODEL>
      --json                     Print events to stdout as JSONL
`;

// -----------------------------------------------------------------------------
// deteccion de capacidades
// -----------------------------------------------------------------------------
describe('helpHasFlag', () => {
  it('detecta un flag presente', () => {
    expect(helpHasFlag(CLAUDE_HELP, '--model')).toBe(true);
    expect(helpHasFlag(CLAUDE_HELP, '--print')).toBe(true);
  });

  it('no detecta un flag ausente', () => {
    expect(helpHasFlag(CLAUDE_HELP, '--inventado')).toBe(false);
  });

  it('no confunde un flag con otro que lo contiene como prefijo', () => {
    expect(helpHasFlag('  --model-name <x>', '--model')).toBe(false);
  });

  it('devuelve false si no hay ayuda', () => {
    expect(helpHasFlag(null, '--model')).toBe(false);
  });
});

describe('extractVersion', () => {
  it('extrae una version simple', () => {
    expect(extractVersion('2.1.183 (Claude Code)')).toBe('2.1.183 (Claude Code)');
  });

  it('salta las lineas decorativas de un recuadro', () => {
    const salida = '┌────────────────┐\n│ aviso │\n└────────────────┘\nFlutter 3.41.9 • stable';
    expect(extractVersion(salida)).toContain('Flutter 3.41.9');
  });

  it('devuelve null con salida vacia', () => {
    expect(extractVersion('')).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Claude Code
// -----------------------------------------------------------------------------
describe('parseClaudeCapabilities', () => {
  // pasarle un flag que no conoce no lo ignora: aborta la invocacion entera.
  // Sin deteccion, actualizar Luxy romperia Claude en la maquina de quien no
  // hubiera actualizado el CLI
  it('detecta --effort, y no lo asume en la version que no lo traia', () => {
    expect(parseClaudeCapabilities(CLAUDE_HELP_2_1_250).effort).toBe(true);
    expect(parseClaudeCapabilities(CLAUDE_HELP).effort).toBe(false);
  });

  it('detecta las capacidades de la version instalada', () => {
    const caps = parseClaudeCapabilities(CLAUDE_HELP);
    expect(caps).toMatchObject({
      print: true,
      outputFormat: true,
      streamJson: true,
      model: true,
      permissionMode: true,
      verbose: true,
      disallowedTools: true,
    });
  });

  it('sin ayuda no asume ninguna capacidad', () => {
    const caps = parseClaudeCapabilities(null);
    expect(Object.values(caps).every((value) => value === false)).toBe(true);
  });

  it('una version antigua sin stream-json se detecta como tal', () => {
    const caps = parseClaudeCapabilities('  -p, --print\n  --model <model>\n');
    expect(caps.print).toBe(true);
    expect(caps.streamJson).toBe(false);
  });
});

describe('buildClaudeArgs', () => {
  const caps = parseClaudeCapabilities(CLAUDE_HELP);

  it('manda el esfuerzo cuando la version lo admite', () => {
    const nueva = parseClaudeCapabilities(CLAUDE_HELP_2_1_250);
    const args = buildClaudeArgs({ prompt: 'algo', effort: 'low', capabilities: nueva });
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
  });

  // pasarle un flag que no conoce no lo ignora: aborta la invocacion entera
  it('y lo CALLA en la version que no lo admite, en vez de romper la llamada', () => {
    const args = buildClaudeArgs({ prompt: 'algo', effort: 'low', capabilities: caps });
    expect(args).not.toContain('--effort');
  });

  it('sin elegir esfuerzo no se manda nada: manda el suyo', () => {
    const nueva = parseClaudeCapabilities(CLAUDE_HELP_2_1_250);
    expect(buildClaudeArgs({ prompt: 'algo', capabilities: nueva })).not.toContain('--effort');
  });

  it('construye la invocacion no interactiva con modelo y stream-json', () => {
    const args = buildClaudeArgs({ prompt: 'haz algo', model: 'opus', capabilities: caps });
    expect(args).toContain('--print');
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    // stream-json necesita --verbose
    expect(args).toContain('--verbose');
  });

  it('NUNCA incluye --dangerously-skip-permissions', () => {
    const args = buildClaudeArgs({ prompt: 'haz algo', capabilities: caps });
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--allow-dangerously-skip-permissions');
    expect(args.join(' ')).not.toContain('dangerously');
  });

  it('rechaza el modo bypassPermissions aunque se pida', () => {
    const args = buildClaudeArgs({
      prompt: 'haz algo',
      capabilities: caps,
      permissionMode: 'bypassPermissions',
    });
    expect(args).not.toContain('bypassPermissions');
    expect(args).not.toContain('--permission-mode');
  });

  it('prohibe las herramientas peligrosas', () => {
    const args = buildClaudeArgs({ prompt: 'haz algo', capabilities: caps });
    const texto = args.join(' ');
    expect(texto).toContain('--disallowedTools');
    expect(texto).toContain('git push');
  });

  it('en una conversacion bloquea escritura, comandos y red', () => {
    const args = buildClaudeArgs({ prompt: 'hola', capabilities: caps, readOnly: true });
    const texto = args.join(' ');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
    expect(texto).toContain('Bash');
    expect(texto).toContain('Edit');
    expect(texto).toContain('Write');
    expect(texto).toContain('WebFetch');
  });

  it('el prompt NUNCA aparece en los argumentos', () => {
    // antes iba como ultimo posicional, y --disallowedTools -que es variadico-
    // se tragaba sus palabras como reglas de herramienta. Ahora va por stdin.
    const prompt = 'texto --con --pinta --de --flags';
    const args = buildClaudeArgs({ prompt, capabilities: caps });
    expect(args).not.toContain(prompt);
    expect(args.join(' ')).not.toContain('pinta');
  });

  it('se adapta a una version sin --output-format', () => {
    const antigua: ClaudeCapabilities = {
      print: true,
      outputFormat: false,
      streamJson: false,
      model: true,
      permissionMode: false,
      addDir: false,
      verbose: false,
      disallowedTools: false,
      // una version vieja tampoco trae los flags posteriores: si alguno se
      // colara aqui como true, el CLI abortaria en vez de ignorarlo.
      inputFormat: false,
      restricted: false,
      effort: false,
    };
    const args = buildClaudeArgs({ prompt: 'algo', model: 'opus', capabilities: antigua });
    expect(args).not.toContain('--output-format');
    expect(args).not.toContain('--permission-mode');
    // sin prompt: viaja por stdin
    expect(args).toEqual(['--print', '--model', 'opus']);
  });
});

describe('parseClaudeStreamLine', () => {
  it('extrae el identificador de sesion', () => {
    const event = parseClaudeStreamLine('{"type":"system","session_id":"abc-123"}');
    expect(event?.sessionId).toBe('abc-123');
  });

  it('reconoce el evento de resultado final', () => {
    const event = parseClaudeStreamLine('{"type":"result","result":"todo listo"}');
    expect(event?.isResult).toBe(true);
    expect(event?.text).toBe('todo listo');
  });

  it('extrae el texto de los bloques de contenido', () => {
    const linea = '{"type":"assistant","message":{"content":[{"type":"text","text":"hola"}]}}';
    expect(parseClaudeStreamLine(linea)?.text).toBe('hola');
  });

  it('ignora lineas vacias o que no son json', () => {
    expect(parseClaudeStreamLine('')).toBeNull();
    expect(parseClaudeStreamLine('texto suelto')).toBeNull();
    expect(parseClaudeStreamLine('{roto')).toBeNull();
  });

  it('no falla ante un formato desconocido', () => {
    const event = parseClaudeStreamLine('{"algo":"distinto"}');
    expect(event?.type).toBe('unknown');
    expect(event?.text).toBeNull();
  });
});

describe('buildClaudeError', () => {
  it('explica el fallo de sesion en lenguaje claro', () => {
    const mensaje = buildClaudeError(1, 'Error: not logged in');
    expect(mensaje).toContain('sesion iniciada');
    expect(mensaje).toContain('claude');
  });

  it('explica el limite de uso', () => {
    expect(buildClaudeError(1, 'rate limit exceeded')).toContain('limite de uso');
  });

  it('incluye el codigo de salida cuando el error es desconocido', () => {
    expect(buildClaudeError(42, 'algo raro')).toContain('42');
  });
});

// -----------------------------------------------------------------------------
// Codex CLI
// -----------------------------------------------------------------------------
describe('parseCodexCapabilities', () => {
  it('detecta las capacidades reales de codex exec', () => {
    expect(parseCodexCapabilities(CODEX_HELP)).toMatchObject({
      json: true,
      cd: true,
      sandbox: true,
      model: true,
      outputLastMessage: true,
      skipGitRepoCheck: true,
      config: true,
      image: true,
    });
  });

  // Codex VE imagenes. Luxy dijo lo contrario durante un tiempo y era falso
  it('detecta -i/--image: Codex si ve imagenes', () => {
    expect(parseCodexCapabilities(CODEX_HELP).image).toBe(true);
    expect(parseCodexCapabilities(CODEX_HELP_SIN_CONFIG).image).toBe(false);
  });

  // `-c` es la UNICA via para el esfuerzo: codex no tiene flag propio
  it('sin -c no hay por donde pedir el esfuerzo', () => {
    expect(parseCodexCapabilities(CODEX_HELP_SIN_CONFIG).config).toBe(false);
  });

  it('sin ayuda no asume nada', () => {
    const caps = parseCodexCapabilities(null);
    expect(Object.values(caps).every((value) => value === false)).toBe(true);
  });
});

describe('buildCodexArgs', () => {
  const caps = parseCodexCapabilities(CODEX_HELP);

  // codex no tiene flag de esfuerzo: se pisa la clave de su config.toml, y el
  // valor va entrecomillado porque la parte derecha se parsea como TOML
  it('pide el esfuerzo pisando la clave de su config', () => {
    const args = buildCodexArgs({ workingDirectory: 'C:/wt', effort: 'low', capabilities: caps });
    expect(args[args.indexOf('-c') + 1]).toBe('model_reasoning_effort="low"');
  });

  it('y lo calla en una version sin -c, en vez de romper la llamada', () => {
    const vieja = parseCodexCapabilities(CODEX_HELP_SIN_CONFIG);
    const args = buildCodexArgs({ workingDirectory: 'C:/wt', effort: 'low', capabilities: vieja });
    expect(args).not.toContain('-c');
  });

  it('sin elegir esfuerzo no se toca su configuracion', () => {
    const args = buildCodexArgs({ workingDirectory: 'C:/wt', capabilities: caps });
    expect(args.join(' ')).not.toContain('model_reasoning_effort');
  });

  it('adjunta cada imagen por su ruta, con una -i cada una', () => {
    const args = buildCodexArgs({
      workingDirectory: 'C:/wt',
      imagePaths: ['C:/fotos/una.webp', 'C:/fotos/otra.png'],
      capabilities: caps,
    });
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(args[args.indexOf('-i') + 1]).toBe('C:/fotos/una.webp');
    // el prompt sigue yendo por stdin: la imagen no lo mueve de sitio
    expect(args[args.length - 1]).toBe('-');
  });

  it('sin rutas no adjunta nada', () => {
    const args = buildCodexArgs({ workingDirectory: 'C:/wt', imagePaths: [], capabilities: caps });
    expect(args).not.toContain('-i');
  });

  it('usa el subcomando exec con json y directorio de trabajo', () => {
    const args = buildCodexArgs({ workingDirectory: 'C:/wt/lux-1', capabilities: caps });
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--cd');
    expect(args[args.indexOf('--cd') + 1]).toBe('C:/wt/lux-1');
  });

  it('limita el sandbox al espacio de trabajo', () => {
    const args = buildCodexArgs({ workingDirectory: 'C:/wt', capabilities: caps });
    expect(args[args.indexOf('--sandbox') + 1]).toBe('workspace-write');
  });

  it('NUNCA usa danger-full-access ni el bypass de aprobaciones', () => {
    const args = buildCodexArgs({ workingDirectory: 'C:/wt', capabilities: caps });
    const texto = args.join(' ');
    expect(texto).not.toContain('danger-full-access');
    expect(texto).not.toContain('dangerously-bypass');
  });

  it('acepta el modo de solo lectura', () => {
    const args = buildCodexArgs({
      workingDirectory: 'C:/wt',
      capabilities: caps,
      sandboxMode: 'read-only',
    });
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
  });

  it('el prompt NO viaja por argumentos: se envia por stdin', () => {
    const args = buildCodexArgs({ workingDirectory: 'C:/wt', capabilities: caps });
    // "-" indica a codex que lea de stdin
    expect(args[args.length - 1]).toBe('-');
  });

  it('se adapta a una version sin --json', () => {
    const antigua: CodexCapabilities = {
      json: false,
      cd: true,
      sandbox: false,
      model: false,
      outputLastMessage: false,
      skipGitRepoCheck: false,
      // sin `-c` no hay forma de fijar el esfuerzo de razonamiento, que es
      // justo lo que se espera de una version anterior a esa opcion.
      config: false,
      // ni `-i`, asi que esa version no puede ver imagenes. Las de ahora si
      image: false,
      // ni `app-server`: sin el no hay forma de mandarle una imagen en memoria
      appServer: false,
    };
    const args = buildCodexArgs({ workingDirectory: 'C:/wt', capabilities: antigua });
    expect(args).toEqual(['exec', '--cd', 'C:/wt', '-']);
  });
});

describe('parseCodexStreamLine', () => {
  it('extrae texto de los distintos campos posibles', () => {
    expect(parseCodexStreamLine('{"type":"item","text":"hola"}')?.text).toBe('hola');
    expect(parseCodexStreamLine('{"msg":{"type":"agent","message":"eco"}}')?.text).toBe('eco');
  });

  it('ignora lineas que no son json', () => {
    expect(parseCodexStreamLine('no es json')).toBeNull();
    expect(parseCodexStreamLine('')).toBeNull();
  });
});

describe('buildCodexError', () => {
  it('explica el fallo de sesion de ChatGPT', () => {
    const mensaje = buildCodexError(1, 'Error: not logged in');
    expect(mensaje).toContain('sesion iniciada');
    expect(mensaje).toContain('ChatGPT');
  });
});

// -----------------------------------------------------------------------------
// proveedores http
// -----------------------------------------------------------------------------

describe('describeHttpError', () => {
  it('explica una clave rechazada', () => {
    const error = Object.assign(new Error('401'), { status: 401 });
    expect(describeHttpError(error, 'DeepSeek')).toContain('clave de API');
  });

  it('explica el rate limit', () => {
    const error = Object.assign(new Error('429'), { status: 429 });
    expect(describeHttpError(error, 'GLM')).toContain('429');
  });

  // POR QUE EXISTE: la rama del 429 sustituia el cuerpo entero por prosa
  // nuestra —«espera un poco»—. Con Mistral llego un 429 real y esa frase
  // mandaba a esperar sin decir por que, cuando el motivo puede ser una cuenta
  // sin verificar o un plan que no incluye el modelo: ahi esperar no arregla nada
  it('el 429 incluye lo que dijo el proveedor', () => {
    const error = Object.assign(new Error('429: {"message":"cuota agotada en tu plan"}'), {
      status: 429,
    });
    const texto = describeHttpError(error, 'Mistral');
    expect(texto).toContain('cuota agotada en tu plan');
    // y sigue explicando que un 429 no siempre se arregla esperando
    expect(texto).toContain('no tiene cuota');
  });

  it('saca el mensaje del cuerpo aunque venga anidado o suelto', () => {
    expect(providerSaid(new Error('429: {"error":{"message":"needs verification"}}'))).toBe(
      'needs verification',
    );
    expect(providerSaid(new Error('429: {"error":"capacity exceeded"}'))).toBe('capacity exceeded');
    expect(providerSaid(new Error('429: Too Many Requests'))).toBe('Too Many Requests');
  });

  it('sin cuerpo no se inventa un mensaje del proveedor', () => {
    expect(providerSaid(new Error('429: '))).toBeNull();
    expect(providerSaid(undefined)).toBeNull();
  });

  it('explica un error del servidor', () => {
    const error = Object.assign(new Error('500'), { status: 500 });
    expect(describeHttpError(error, 'Qwen')).toContain('error interno');
  });

  // POR QUE EXISTE: estos dos errores llegaron de verdad el 2026-08-05 con
  // KAT Coder Pro v2.5, y al usuario le aparecio el JSON crudo del proveedor,
  // en chino, precedido de "fallo tras 3 intentos".
  it('un limite de plan se explica como tal, no como fallo de Luxy', () => {
    const original = Object.assign(
      new Error(
        '400: {"error":{"message":"Request was rejected due to reason: user is not allowed to access, ' +
          'reason: CustomerId: 0000000000, Action: CodingV1ChatCompletions, Action plan limited.",' +
          '"type":"BadRequest","param":"","code":"UnaccessibleUser"}}',
      ),
      { status: 400 },
    );
    const envuelto = new RetryError('la operacion fallo tras 1 intento', 1, original);

    const mensaje = describeHttpError(envuelto, 'KAT Coder Pro v2.5');
    expect(mensaje).toContain('tu plan no permite usar este modelo');
    expect(mensaje).toContain('Elige otro modelo');
    // nada de volcarle el JSON del proveedor
    expect(mensaje).not.toContain('UnaccessibleUser');
    expect(mensaje).not.toContain('CustomerId');
  });

  it('un 429 envuelto sigue reconociendose, y lo que dijo el proveedor se atribuye bien', () => {
    // el envoltorio del reintento escondia el status y todo acababa en la rama
    // generica. Eso sigue arreglado.
    //
    // Lo que SI cambio, el 2026-09-05 y a proposito: antes se ocultaba el
    // cuerpo de la respuesta. Con Mistral eso dejo a Daniel cuatro intentos a
    // ciegas, porque un 429 no siempre es frecuencia —tambien lo devuelven una
    // cuenta sin verificar o un plan que no incluye el modelo— y el motivo
    // venia justo ahi. Ahora se enseña, DESPUES de la explicacion en español y
    // marcado como suyo.
    const original = Object.assign(new Error('429: 您的请求频率过高'), { status: 429 });
    const envuelto = new RetryError('la operacion fallo tras 3 intentos', 3, original);

    const mensaje = describeHttpError(envuelto, 'KAT Coder Pro v2.5');
    expect(mensaje).toContain('429');
    expect(mensaje).toContain('您的请求频率过高');
    // y NUNCA el texto del envoltorio, que es nuestro: atribuirselo al
    // proveedor es peor que no decir nada
    expect(mensaje).not.toContain('la operacion fallo tras 3 intentos');
  });
});

describe('Retry-After', () => {
  it('separa el socket rechazado de la llamada que ya se pago', () => {
    // el filtro lo comparten AHORA las dos rutas —consulta y bucle de
    // herramientas—, y decide por evidencia, no por «no trae codigo»
    const caida = new TypeError('fetch failed');
    const silencio = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('Headers Timeout Error'), {
        code: 'UND_ERR_HEADERS_TIMEOUT',
      }),
    });

    // sin cabeceras y en milisegundos: no hay llamada que cobrar
    expect(
      classifyBilledFailure(caida, { httpStatus: null, transportEnd: null, elapsedMs: 5 }, 0),
    ).toBe('free_retry');
    // sin cabeceras pero cuatro minutos en vuelo: la pasarela la atendio
    expect(
      classifyBilledFailure(caida, { httpStatus: null, transportEnd: null, elapsedMs: 268_000 }, 0),
    ).toBe('give_up');
    // un silencio hasta el tope no se repite NUNCA: son otros quince minutos
    expect(
      classifyBilledFailure(
        silencio,
        { httpStatus: null, transportEnd: null, elapsedMs: 900_000 },
        0,
      ),
    ).toBe('give_up');
    // socket caido a mitad del envio: UN reintento, el que historicamente
    // devolvia la respuesta, y solo uno
    const cortado = { httpStatus: 200, transportEnd: 'read_error' as const, elapsedMs: 40_000 };
    expect(classifyBilledFailure(caida, cortado, 0)).toBe('retry_once');
    expect(classifyBilledFailure(caida, cortado, 1)).toBe('give_up');
    // cierre limpio sin una palabra: eso si es reintentar a ciegas
    expect(
      classifyBilledFailure(
        caida,
        { httpStatus: 200, transportEnd: 'done_marker', elapsedMs: 3_000 },
        0,
      ),
    ).toBe('give_up');
  });

  it('acepta segundos', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('acepta una fecha HTTP', () => {
    const ahora = Date.parse('2026-08-05T12:00:00Z');
    expect(parseRetryAfter('Wed, 05 Aug 2026 12:00:20 GMT', ahora)).toBe(20_000);
  });

  it('ignora lo que no sirve y lo ya pasado', () => {
    const ahora = Date.parse('2026-08-05T12:00:00Z');
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('   ')).toBeNull();
    expect(parseRetryAfter('pronto')).toBeNull();
    expect(parseRetryAfter('0')).toBeNull();
    expect(parseRetryAfter('Wed, 05 Aug 2026 11:59:00 GMT', ahora)).toBeNull();
  });

  it('no acepta una espera absurda: hay un tope', () => {
    expect(parseRetryAfter('86400')).toBe(60_000);
  });
});

describe('HttpApiProvider', () => {
  const config = EXAMPLE_HTTP_PROVIDERS[0]!;

  it('una conversacion usa un system conversacional, no el de asistente tecnico', async () => {
    let sentBody: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sentBody = JSON.parse(String(init?.body)) as unknown;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'respuesta en personaje' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new HttpApiProvider(
      { ...config, enabled: true, supportsStreaming: false },
      'una-clave',
    );
    const result = await provider.run({
      prompt: 'QUIEN ERES: Lia',
      workingDirectory: 'C:/wt',
      timeoutMs: 1000,
      signal: new AbortController().signal,
      interactionMode: 'conversation',
      onEvent: () => undefined,
    });

    const body = sentBody as { messages: Array<{ role: string; content: string }> } | null;
    expect(result.ok).toBe(true);
    expect(body?.messages[0]?.role).toBe('system');
    expect(body?.messages[0]?.content).toContain('directivas de personaje');
    expect(body?.messages[0]?.content).not.toContain('asistente tecnico');

    // el system decia «participas en una conversacion DE LUXY», y sin personaje
    // definido el modelo leia el nombre del programa como el suyo y se
    // presentaba como Luxy. De ahi salio el primer «me llamo Luxy» de una
    // boveda, que despues la memoria episodica propago fielmente durante dias
    expect(body?.messages[0]?.content).not.toContain('conversacion de Luxy');
    expect(body?.messages[0]?.content).toContain('Luxy es el nombre del programa');
    expect(body?.messages[0]?.content).toContain('NO te inventes un nombre');
  });

  it('un trabajo conserva el system tecnico por defecto', async () => {
    let sentBody: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sentBody = JSON.parse(String(init?.body)) as unknown;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'resultado tecnico' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new HttpApiProvider(
      { ...config, enabled: true, supportsStreaming: false },
      'una-clave',
    );
    const result = await provider.run({
      prompt: 'analiza el codigo',
      workingDirectory: 'C:/wt',
      timeoutMs: 1000,
      signal: new AbortController().signal,
      onEvent: () => undefined,
    });

    const body = sentBody as { messages: Array<{ role: string; content: string }> } | null;
    expect(result.ok).toBe(true);
    expect(body?.messages[0]?.content).toContain('Eres un asistente tecnico');
    expect(body?.messages[0]?.content).not.toContain('directivas de personaje');
  });

  it('no esta disponible sin clave', async () => {
    const provider = new HttpApiProvider({ ...config, enabled: true }, undefined);
    expect((await provider.detect()).available).toBe(false);
  });

  it('no esta disponible si esta deshabilitado aunque tenga clave', async () => {
    const provider = new HttpApiProvider({ ...config, enabled: false }, 'una-clave');
    expect((await provider.detect()).available).toBe(false);
  });

  it('esta disponible cuando esta habilitado y tiene clave', async () => {
    const provider = new HttpApiProvider({ ...config, enabled: true }, 'una-clave');
    expect((await provider.detect()).available).toBe(true);
  });

  it('falla con un mensaje claro y sin consumir red si falta la clave', async () => {
    const provider = new HttpApiProvider({ ...config, enabled: true }, undefined);
    const result = await provider.run({
      prompt: 'hola',
      workingDirectory: 'C:/wt',
      timeoutMs: 1000,
      signal: new AbortController().signal,
      onEvent: () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('DEEPSEEK_API_KEY');
  });

  it('respeta el presupuesto diario sin llamar a la api', async () => {
    const store = new MemoryBudgetStore({
      deepseek: {
        day: new Date().toISOString().slice(0, 10),
        spent: 100,
        inputTokens: 0,
        outputTokens: 0,
        calls: 1,
      },
    });
    const provider = new HttpApiProvider(
      { ...config, enabled: true, dailyBudget: 10 },
      'una-clave',
      store,
    );
    const result = await provider.run({
      prompt: 'hola',
      workingDirectory: 'C:/wt',
      timeoutMs: 1000,
      signal: new AbortController().signal,
      onEvent: () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('presupuesto diario agotado');
  });

  it('termina por usage, conserva tokens y publica una respuesta corta', async () => {
    let streamCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              'data: {"choices":[{"delta":{"content":"Hola, Daniel."}}]}',
              'data: {"choices":[],"usage":{"prompt_tokens":287,"completion_tokens":476}}',
            ].join('\n') + '\n',
          ),
        );
        // reproduce el proxy que ya contabilizo la llamada pero no cierra el
        // cuerpo. Luxy debe usar usage como evidencia final, no un silencio.
      },
      cancel() {
        streamCancelled = true;
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const provider = new HttpApiProvider(
      // el silencio real son 15 s; aqui solo interesa que cierre por si mismo
      { ...config, enabled: true, supportsStreaming: true, softTerminalGraceMs: 50 },
      'una-clave',
    );
    const events: string[] = [];
    const result = await provider.run({
      prompt: 'saludame',
      workingDirectory: 'C:/wt',
      timeoutMs: 5000,
      signal: new AbortController().signal,
      readOnly: true,
      onEvent: (event) => events.push(`${event.type}:${event.message}`),
    });

    expect(result).toMatchObject({
      ok: true,
      finalText: 'Hola, Daniel.',
      usage: { inputTokens: 287, outputTokens: 476 },
      callMetrics: { modelCalls: 1, toolCalls: 0 },
    });
    expect(events).toContain('text:Hola, Daniel.');
    expect(streamCancelled).toBe(true);
  });
});

// POR QUE EXISTE: mandar una imagen obliga a cambiar la forma de `content`, que
// es el campo por el que pasa TODA peticion. Estas pruebas fijan las dos mitades
// del trato: quien no manda imagenes ve exactamente el cuerpo de siempre, y
// quien las manda las ve en el orden y la forma que documenta su proveedor.
describe('HttpApiProvider: imagenes', () => {
  const base = { ...EXAMPLE_HTTP_PROVIDERS[0]!, enabled: true, supportsStreaming: false };

  const IMAGEN_BASE64 = 'AAAABBBB';

  /** captura el cuerpo enviado; no hay red, la respuesta es fija */
  function espiarFetch(): { body: () => Record<string, unknown> | null } {
    let sent: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'lo veo' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    return { body: () => sent };
  }

  function peticion(overrides: Record<string, unknown> = {}) {
    return {
      prompt: 'que ves aqui',
      workingDirectory: 'C:/wt',
      timeoutMs: 1000,
      signal: new AbortController().signal,
      onEvent: () => undefined,
      ...overrides,
    };
  }

  it('sin imagenes el cuerpo lleva content como CADENA, igual que siempre', async () => {
    const espia = espiarFetch();
    const provider = new HttpApiProvider(base, 'una-clave');

    const result = await provider.run(peticion());

    const mensajes = espia.body()?.['messages'] as Array<{ role: string; content: unknown }>;
    expect(result.ok).toBe(true);
    expect(mensajes[1]?.role).toBe('user');
    expect(mensajes[1]?.content).toBe('que ves aqui');
    expect(typeof mensajes[1]?.content).toBe('string');
  });

  it('un array de imagenes vacio se comporta igual que no mandar ninguna', async () => {
    const espia = espiarFetch();
    const provider = new HttpApiProvider(base, 'una-clave');

    await provider.run(peticion({ images: [] }));

    const mensajes = espia.body()?.['messages'] as Array<{ content: unknown }>;
    expect(mensajes[1]?.content).toBe('que ves aqui');
  });

  it('con una imagen el content es un array con el TEXTO primero', async () => {
    const espia = espiarFetch();
    const provider = new HttpApiProvider(base, 'una-clave');

    await provider.run(peticion({ images: [{ mimeType: 'image/webp', base64: IMAGEN_BASE64 }] }));

    const mensajes = espia.body()?.['messages'] as Array<{ content: unknown }>;
    const partes = mensajes[1]?.content as Array<Record<string, unknown>>;
    expect(Array.isArray(partes)).toBe(true);
    expect(partes).toHaveLength(2);
    // el orden no es estetico: OpenRouter documenta el texto delante
    expect(partes[0]).toEqual({ type: 'text', text: 'que ves aqui' });
    expect(partes[1]?.['type']).toBe('image_url');
  });

  it("imageUrlFormat 'object' manda image_url como objeto con url", async () => {
    const espia = espiarFetch();
    const provider = new HttpApiProvider({ ...base, imageUrlFormat: 'object' }, 'una-clave');

    await provider.run(peticion({ images: [{ mimeType: 'image/webp', base64: IMAGEN_BASE64 }] }));

    const mensajes = espia.body()?.['messages'] as Array<{ content: unknown }>;
    const partes = mensajes[1]?.content as Array<Record<string, unknown>>;
    expect(partes[1]?.['image_url']).toEqual({ url: `data:image/webp;base64,${IMAGEN_BASE64}` });
  });

  it("imageUrlFormat 'string' manda image_url como cadena, que es lo que documenta Mistral", async () => {
    const espia = espiarFetch();
    const provider = new HttpApiProvider({ ...base, imageUrlFormat: 'string' }, 'una-clave');

    await provider.run(peticion({ images: [{ mimeType: 'image/jpeg', base64: IMAGEN_BASE64 }] }));

    const mensajes = espia.body()?.['messages'] as Array<{ content: unknown }>;
    const partes = mensajes[1]?.content as Array<Record<string, unknown>>;
    expect(partes[1]?.['image_url']).toBe(`data:image/jpeg;base64,${IMAGEN_BASE64}`);
  });

  it('el data URL se compone con el mimeType que se pasa, no con uno fijo', () => {
    const partes = buildUserContent('mira', [{ mimeType: 'image/png', base64: 'ZZZZ' }], 'string');
    expect(partes).toEqual([
      { type: 'text', text: 'mira' },
      { type: 'image_url', image_url: 'data:image/png;base64,ZZZZ' },
    ]);
  });

  it('sin formato indicado se usa el objeto, que es la forma estandar', () => {
    const partes = buildUserContent('mira', [{ mimeType: 'image/gif', base64: 'YY' }]);
    expect(partes).toEqual([
      { type: 'text', text: 'mira' },
      { type: 'image_url', image_url: { url: 'data:image/gif;base64,YY' } },
    ]);
  });

  it('varias imagenes van todas detras del texto, en orden', () => {
    const partes = buildUserContent(
      'compara',
      [
        { mimeType: 'image/png', base64: 'AA' },
        { mimeType: 'image/png', base64: 'BB' },
      ],
      'string',
    ) as Array<Record<string, unknown>>;
    expect(partes.map((parte) => parte['type'])).toEqual(['text', 'image_url', 'image_url']);
    expect(partes[1]?.['image_url']).toBe('data:image/png;base64,AA');
    expect(partes[2]?.['image_url']).toBe('data:image/png;base64,BB');
  });
});

// POR QUE EXISTE, y es un fallo que estuvo suelto y costo una sesion entera de
// diagnostico equivocado.
//
// El cuerpo del POST siempre llevo el modelo de la peticion. Lo que mentia era
// el INFORME: `usage.model` devolvia el de la conexion, y como `job-runner`
// pisa su `executedModel` con ese campo, el banco de vision enseñaba
// «respondio llama-3.3-70b-versatile» en TODAS las pruebas aunque se hubiera
// elegido otro modelo a mano. Daniel dedujo de ahi que su eleccion no se
// aplicaba, y la unica prueba que tenia era el campo estropeado.
//
// Estas pruebas afirman las DOS mitades sobre la MISMA llamada, que es lo que
// impide que vuelvan a separarse: lo que se manda y lo que se dice que se mando.
describe('HttpApiProvider: que modelo dice que uso', () => {
  const base = { ...EXAMPLE_HTTP_PROVIDERS[0]!, enabled: true, supportsStreaming: false };

  function espiar(): { body: () => Record<string, unknown> | null } {
    let sent: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'lo veo' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    return { body: () => sent };
  }

  const peticion = (overrides: Record<string, unknown> = {}) => ({
    prompt: 'que ves aqui',
    workingDirectory: 'C:/wt',
    timeoutMs: 1000,
    signal: new AbortController().signal,
    onEvent: () => undefined,
    ...overrides,
  });

  const OTRO = 'qwen/qwen3.6-27b';

  it('informa del modelo de la PETICION, que es el que manda en el cuerpo', async () => {
    // si el elegido y el de la conexion fueran iguales, la prueba pasaria sola
    expect(base.model).not.toBe(OTRO);

    const espia = espiar();
    const provider = new HttpApiProvider(base, 'una-clave');

    const result = await provider.run(peticion({ model: OTRO }));

    expect(espia.body()?.['model']).toBe(OTRO);
    expect(result.usage?.model).toBe(OTRO);
  });

  it('sin modelo en la peticion cae al de la conexion, y lo dice igual', async () => {
    const espia = espiar();
    const provider = new HttpApiProvider(base, 'una-clave');

    const result = await provider.run(peticion());

    expect(espia.body()?.['model']).toBe(base.model);
    expect(result.usage?.model).toBe(base.model);
  });
});

// POR QUE EXISTE: una web generada durante 23 minutos acabo a mitad de una
// etiqueta y no se pudo demostrar el motivo. Sin estas señales, "se acabaron
// los tokens", "Luxy corto la conexion" y "el proveedor cerro el socket" son
// indistinguibles, y cada una lleva a tocar una cosa distinta.
describe('HttpApiProvider: diagnostico del final de la respuesta', () => {
  const config = { ...EXAMPLE_HTTP_PROVIDERS[0]!, enabled: true, supportsStreaming: true };

  // tipado con la peticion real: sin ello un `onEvent` sobrescrito aqui pierde
  // el tipo de su evento y se cuela cualquier cosa en los asertos.
  function peticion(overrides: Partial<ProviderRunRequest> = {}): ProviderRunRequest {
    return {
      prompt: 'genera una web completa',
      workingDirectory: 'C:/wt',
      timeoutMs: 60_000,
      signal: new AbortController().signal,
      readOnly: true,
      onEvent: () => undefined,
      ...overrides,
    };
  }

  it('muestra cada reintento cuando el proveedor limita la frecuencia', async () => {
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      if (intentos === 1) {
        return new Response('demasiadas peticiones', {
          status: 429,
          headers: { 'Retry-After': '1' },
        });
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"LISTO"},"finish_reason":"stop"}]}\n',
              ),
            );
          },
          cancel() {
            /* el final fuerte hace que Luxy cierre el stream localmente */
          },
        }),
        { status: 200 },
      );
    });

    const events: string[] = [];
    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(
      peticion({ onEvent: (event) => events.push(`${event.type}:${event.message}`) }),
    );

    expect(result.ok).toBe(true);
    expect(intentos).toBe(2);
    expect(events).toContainEqual(
      expect.stringMatching(/^warning:DeepSeek limita la frecuencia; reintento 2\/3 en [1-3] s\.$/),
    );
  });

  it('explica cuando el razonamiento agota la salida antes de responder', async () => {
    const razonamientoPrivado = 'contenido privado que nunca debe salir';
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              `data: {"choices":[{"delta":{"reasoning_content":${JSON.stringify(razonamientoPrivado)}}}]}`,
              'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
              'data: {"choices":[],"usage":{"prompt_tokens":321,"completion_tokens":8192}}',
              'data: [DONE]',
            ].join('\n') + '\n',
          ),
        );
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion({ maxOutputTokens: 8192 }));

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain(
      'agoto el limite de salida durante el razonamiento antes de producir texto visible',
    );
    expect(result.errorMessage).toContain('8192 tokens de salida consumidos');
    expect(result.errorMessage).not.toContain(razonamientoPrivado);
  });

  it('detecta el limite por consumo aunque el proveedor omita finish_reason', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              'data: {"choices":[],"usage":{"prompt_tokens":321,"completion_tokens":8192}}',
              'data: [DONE]',
            ].join('\n') + '\n',
          ),
        );
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion({ maxOutputTokens: 8192 }));

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain(
      'agoto el limite de salida antes de producir texto visible o pedir una herramienta',
    );
    expect(result.errorMessage).toContain('8192 tokens de salida consumidos');
  });

  it('falla si una consulta sin contrato agentic termina con tool_calls', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"write_file","arguments":"{\\"path\\":\\"index.html\\",\\"content\\":\\"hola\\"}"}}]},"finish_reason":"tool_calls"}]}',
              'data: {"choices":[],"usage":{"prompt_tokens":452,"completion_tokens":2263}}',
              'data: [DONE]',
            ].join('\n') + '\n',
          ),
        );
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion({ model: 'kimi-k3', readOnly: false }));

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('(kimi-k3) pidio 1 herramienta');
    expect(result.errorMessage).toContain('No se ejecuto ninguna herramienta');
    expect(result.termination).toMatchObject({
      finishReason: 'tool_calls',
      inputTokens: 452,
      outputTokens: 2263,
      textLength: 0,
    });
  });

  it('entrega los tool_calls al bucle agentic en vez de rechazarlos como consulta', async () => {
    const responses = [
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"write_file","arguments":"{\\"path\\":\\"kimi-prueba.txt\\",\\"content\\":\\"ok\\"}"}}]},"finish_reason":"tool_calls"}]}\n' +
                  'data: [DONE]\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200 },
      ),
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"listo"},"finish_reason":"stop"}]}\n' +
                  'data: [DONE]\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200 },
      ),
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses.shift()!);
    const runner = { execute: vi.fn(async () => ({ ok: true, content: 'archivo escrito' })) };
    const provider = new HttpApiProvider(config, 'una-clave');

    const result = await provider.run({
      ...peticion({ model: 'kimi-k3', readOnly: false }),
      agentic: {
        runner,
        allowedTools: ['write_file'],
        limits: modelLimitsSchema.parse({}),
        useNativeTools: true,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      finalText: 'listo',
      callMetrics: { modelCalls: 2, toolCalls: 1 },
    });
    expect(runner.execute).toHaveBeenCalledWith('write_file', {
      path: 'kimi-prueba.txt',
      content: 'ok',
    });
  });

  it('reintenta un fetch failed de Kimi sin volver a ejecutar la herramienta anterior', async () => {
    const responses: Array<Response | Error> = [
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"write_file","arguments":"{\\"path\\":\\"kimi-reintento.txt\\",\\"content\\":\\"ok\\"}"}}]},"finish_reason":"tool_calls"}]}\n' +
                  'data: [DONE]\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200 },
      ),
      new TypeError('fetch failed'),
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"terminado tras reintento"},"finish_reason":"stop"}]}\n' +
                  'data: [DONE]\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200 },
      ),
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next!;
    });
    const runner = { execute: vi.fn(async () => ({ ok: true, content: 'archivo escrito' })) };
    const provider = new HttpApiProvider(config, 'una-clave');

    const result = await provider.run({
      ...peticion({ model: 'kimi-k3', readOnly: false }),
      agentic: {
        runner,
        allowedTools: ['write_file'],
        limits: modelLimitsSchema.parse({}),
        useNativeTools: true,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      finalText: 'terminado tras reintento',
      // TRES peticiones salieron de verdad, y eso es lo que cuenta ahora
      // `modelCalls`: antes contaba las vueltas del bucle (2) y un reintento
      // quedaba invisible, que es el agujero entero de este trabajo.
      //
      // `billedCalls` son DOS: el `fetch failed` del medio no llego a conectar
      // —sin cabeceras y sin silencio hasta el tope— y esa es la unica clase de
      // llamada que no se paga.
      callMetrics: { modelCalls: 3, toolCalls: 1, billedCalls: 2 },
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(runner.execute).toHaveBeenCalledTimes(1);
  }, 10_000);

  // POR QUE EXISTE: el arreglo de las llamadas vacias solo se aplico a la ruta
  // de consulta. El bucle de herramientas seguia reintentando a ciegas una
  // llamada ya cobrada —hasta tres por vuelta, y una vuelta puede repetirse
  // cincuenta veces— y anunciandolo como «conexion con el proveedor
  // interrumpida», que culpa a la red de algo que el proveedor SI atendio.
  it('el bucle de herramientas tampoco reintenta una llamada ya cobrada, y avisa', async () => {
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
            controller.close();
          },
        }),
        { status: 200 },
      );
    });

    const events: string[] = [];
    const runner = { execute: vi.fn(async () => ({ ok: true, content: 'nada' })) };
    const provider = new HttpApiProvider(config, 'una-clave');

    const result = await provider.run({
      ...peticion({
        model: 'kimi-k3',
        readOnly: false,
        onEvent: (event) => events.push(`${event.type}:${event.message}`),
      }),
      agentic: {
        runner,
        allowedTools: ['write_file'],
        limits: modelLimitsSchema.parse({}),
        useNativeTools: true,
      },
    });

    expect(intentos).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.callMetrics).toMatchObject({ modelCalls: 1, billedCalls: 1 });
    // un `warning`, no un `phase` de rutina que culpa a la red
    expect(events).toContainEqual(
      expect.stringMatching(
        /^warning:DeepSeek \(kimi-k3\) cerro la respuesta sin enviar ni una palabra\./,
      ),
    );
    expect(events.join('\n')).not.toContain('conexion con el proveedor interrumpida');
  }, 10_000);

  it('conserva finish_reason length y los limites efectivos de una respuesta truncada', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              'data: {"choices":[{"delta":{"content":"<!doctype html><html><bo"}}]}',
              'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
              'data: [DONE]',
            ].join('\n') + '\n',
          ),
        );
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion({ maxOutputTokens: 4096 }));

    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.termination).toMatchObject({
      httpStatus: 200,
      streamed: true,
      transportEnd: 'done_marker',
      finishReason: 'length',
      abortedBy: null,
      maxOutputTokens: 4096,
      effectiveTimeoutMs: 60_000,
    });
    // el tamaño se guarda; el contenido no
    expect(result.termination?.textLength).toBe('<!doctype html><html><bo'.length);
    expect(JSON.stringify(result.termination)).not.toContain('doctype');
  });

  it('distingue el cierre local de Luxy de un cierre del proveedor', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"listo"},"finish_reason":"stop"}]}\n',
          ),
        );
        // el socket sigue abierto: es Luxy quien decide cerrar
      },
      cancel() {
        /* la cancelacion local es la que termina esto */
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion());

    expect(result.ok).toBe(true);
    expect(result.termination).toMatchObject({
      transportEnd: 'local_end',
      finishReason: 'stop',
      abortedBy: 'local_finalization',
    });
  });

  it('el diagnostico sobrevive a un socket que revienta a mitad', async () => {
    // cada intento recibe un cuerpo nuevo: un ReadableStream ya consumido no
    // vuelve a dar bytes, y entonces el diagnostico del reintento diria que no
    // llego nada, que es exactamente lo contrario de lo que paso.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"choices":[{"delta":{"content":"a medias"}}]}\n'),
              );
            },
            pull() {
              throw new Error('socket cerrado por el proveedor');
            },
          }),
          { status: 200 },
        ),
    );

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion());

    expect(result.ok).toBe(false);
    expect(result.termination).toMatchObject({
      transportEnd: 'read_error',
      finishReason: null,
      abortedBy: null,
      textLength: 'a medias'.length,
    });
    // hubo texto: no puede tratarse como una respuesta vacia cualquiera
    expect(result.termination?.bytes).toBeGreaterThan(0);
  });

  // POR QUE EXISTE: reintentar aqui tiraba lo generado y volvia a empezar de
  // cero. En una generacion de 23 minutos eso son tres respuestas perdidas en
  // vez de una parcial que se puede continuar.
  it('NO reintenta un corte que ya habia producido texto, y lo conserva', async () => {
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"<!doctype html><html>"}}]}\n',
              ),
            );
          },
          pull() {
            throw new Error('socket cerrado por el proveedor');
          },
        }),
        { status: 200 },
      );
    });

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion());

    expect(intentos).toBe(1);
    expect(result.ok).toBe(false);
    // lo generado viaja igual: quien decide si se conserva es el ejecutor
    expect(result.finalText).toBe('<!doctype html><html>');
  });

  // POR QUE CAMBIO DE SENTIDO: esta prueba afirmaba lo contrario —«un corte
  // SIN texto si se reintenta: no hay nada que perder»— y era falso. Esta
  // pasarela cobra POR LLAMADA, asi que una llamada que el proveedor atendio
  // (hubo cabeceras) y cerro vacia YA esta pagada: repetirla sola cobraba dos
  // mas sin que nadie se enterara. Del 4 al 14 de septiembre eso fueron 73
  // llamadas para 60 turnos, 90 ¥ de 506 que no compraron una sola palabra.
  it('NO reintenta una llamada que el proveedor ya cobro, y avisa en pantalla', async () => {
    // cierre LIMPIO y sin una palabra: el proveedor descolgo, cerro bien y no
    // dijo nada. Esto es «reintentar a ciegas una respuesta vacia», y es lo que
    // convirtio 60 turnos en 73 llamadas entre el 4 y el 14 de septiembre.
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
            controller.close();
          },
        }),
        { status: 200 },
      );
    });

    const events: string[] = [];
    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(
      peticion({ onEvent: (event) => events.push(`${event.type}:${event.message}`) }),
    );

    expect(intentos).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.finalText).toBe('');
    // la decision vuelve a ser suya, pero solo si la ve
    expect(events).toContainEqual(
      expect.stringMatching(/^warning:DeepSeek cerro la respuesta sin enviar ni una palabra\./),
    );
    // Y TIENE QUE LLEGARLE DONDE ESTA ESPERANDO: la pantalla de Privado no
    // escucha los eventos del agente, solo pinta el mensaje de fallo. Sin esto
    // el aviso se quedaba en la lista de actividad de otra pantalla.
    expect(result.errorMessage).toContain('ya esta pagada');
    // y ni el aviso ni el fallo llevan una palabra de la conversacion
    expect(events.join('\n')).not.toContain('genera una web completa');
    expect(result.errorMessage).not.toContain('genera una web completa');
  });

  // POR QUE UNO Y NO CERO: de las 13 llamadas de mas del historico solo 3
  // encajan con la pared de los 300 s; las otras 10 pasaron en turnos cuyas
  // llamadas duraban entre 29 y 135 segundos, y esos turnos ACABARON
  // contestando. O sea que el reintento los estaba recuperando solo. Quitarlo
  // entero cambiaba una perdida de dinero por una perdida de conversacion; el
  // corte a mitad del envio conserva esa recuperacion y avisa igual.
  it('un corte a mitad del envio se reintenta UNA vez, y solo una', async () => {
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            throw new Error('socket cerrado antes de responder');
          },
        }),
        { status: 200 },
      );
    });

    const events: string[] = [];
    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(
      peticion({ onEvent: (event) => events.push(`${event.type}:${event.message}`) }),
    );

    // dos, no tres: el reintento de cortesia se concede UNA vez por turno
    expect(intentos).toBe(2);
    expect(result.ok).toBe(false);
    expect(events).toContainEqual(
      expect.stringMatching(/^warning:DeepSeek corto el envio a mitad/),
    );
    expect(events.join('\n')).toContain('Lo reintento UNA vez');
  }, 15_000);

  // POR QUE EXISTE: la tercera llamada vacia del 2026-09-14 murio a los 268 s
  // «porque la corto el otro lado». Esta pasarela retiene las cabeceras hasta
  // que el modelo contesta, asi que llego sin codigo de estado y Luxy la
  // trataba igual que un ECONNREFUSED de 5 ms: gratis y reenviable tres veces.
  it('un corte del otro lado tras minutos en vuelo ni es gratis ni se reintenta', async () => {
    // el reloj se adelanta en vez de esperar de verdad: lo que se prueba es que
    // el TIEMPO EN VUELO entra en la decision, no el reloj del ordenador
    const reloj = Date.now.bind(Date);
    let desfase = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => reloj() + desfase);

    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      desfase = 268_000;
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      });
    });

    const events: string[] = [];
    const lineas: ProviderCallRecord[] = [];
    const store = new MemoryBudgetStore();
    const provider = new HttpApiProvider(config, 'una-clave', store, undefined, (record) =>
      lineas.push(record),
    );
    const result = await provider.run(
      peticion({ onEvent: (event) => events.push(`${event.type}:${event.message}`) }),
    );

    expect(intentos).toBe(1);
    expect(result.ok).toBe(false);
    expect(lineas[0]?.ending).toBe('dropped');
    expect(lineas[0]?.billed).toBe(true);
    expect(lineas[0]?.errorCode).toBe('ECONNRESET');
    // y se cuenta: el contador de llamadas es lo unico que ve esta tarifa
    expect(store.read()['deepseek']?.calls).toBe(1);
    expect(events).toContainEqual(expect.stringMatching(/^warning:DeepSeek corto la conexion/));
  }, 15_000);

  // POR QUE EXISTE: el reintento que SI tiene sentido es el que no le ha
  // costado nada. Si la conexion se cae ANTES de que el proveedor conteste, no
  // hay llamada que cobrar y repetirla es gratis; confundir este caso con el de
  // arriba dejaria a Daniel reenviando a mano cortes de red de dos segundos.
  it('una caida de red antes de conectar se sigue reintentando', async () => {
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
          code: 'ECONNREFUSED',
        }),
      });
    });

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion());

    expect(intentos).toBe(3);
    expect(result.ok).toBe(false);
  });

  // POR QUE EXISTE: al cerrar el agujero de las respuestas vacias habia que
  // tocar el mismo filtro que decide los reintentos buenos. Un 5xx es un fallo
  // declarado del proveedor y se repite desde siempre; si esta prueba cae, lo
  // que se ha roto no es el ahorro, es la resistencia.
  it('un 5xx se sigue reintentando hasta que el proveedor responde', async () => {
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      if (intentos === 1) return new Response('boom', { status: 503 });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"LISTO"},"finish_reason":"stop"}]}\n',
              ),
            );
          },
          cancel() {
            /* el final fuerte hace que Luxy cierre el stream localmente */
          },
        }),
        { status: 200 },
      );
    });

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion());

    expect(intentos).toBe(2);
    expect(result.ok).toBe(true);
    expect(result.finalText).toBe('LISTO');
  });

  // POR QUE EXISTE: los dos fallos de silencio del 2026-09-14 murieron a los
  // 302 y 300 segundos justos —el tope de fabrica de Node— y Luxy los reenvio
  // porque llegan SIN codigo de estado. El reintento siguiente contesto a los
  // 304, asi que la espera valia la pena; lo que no valia era pagarla tres
  // veces. Ahora el silencio ni se reintenta ni se disfraza de "fetch failed".
  it('un silencio hasta el tope no se reintenta y se explica como agotado', async () => {
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('Headers Timeout Error'), {
          name: 'HeadersTimeoutError',
          code: 'UND_ERR_HEADERS_TIMEOUT',
        }),
      });
    });

    const events: string[] = [];
    const provider = new HttpApiProvider({ ...config, silenceTimeoutMs: 900_000 }, 'una-clave');
    const result = await provider.run(
      peticion({ onEvent: (event) => events.push(`${event.type}:${event.message}`) }),
    );

    expect(intentos).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toContain('estuvo 900 s sin enviar nada');
    expect(result.errorMessage).not.toContain('fetch failed');
    expect(events).toContainEqual(
      expect.stringMatching(/^warning:DeepSeek estuvo 900 s sin enviar nada\./),
    );
  });

  // POR QUE EXISTE: «no llego a empezar» y «hablo y se callo» son dos cosas y
  // se contaban como una. Con texto delante, decir «estuvo 900 s sin enviar
  // nada» se contradice con lo que Daniel tiene en pantalla —el parcial se
  // conserva— y encima le manda a reenviar el mensaje entero, que es otra
  // llamada de pago, cuando lo que hay se puede continuar.
  it('un silencio DESPUES de empezar a hablar no dice que no llego nada', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      let entregado = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!entregado) {
              entregado = true;
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"Lia se gira despacio"}}]}\n',
                ),
              );
              return;
            }
            controller.error(
              Object.assign(new TypeError('terminated'), {
                cause: Object.assign(new Error('Body Timeout Error'), {
                  name: 'BodyTimeoutError',
                  code: 'UND_ERR_BODY_TIMEOUT',
                }),
              }),
            );
          },
        }),
        { status: 200 },
      );
    });

    const provider = new HttpApiProvider({ ...config, silenceTimeoutMs: 900_000 }, 'una-clave');
    const result = await provider.run(peticion({ readOnly: false }));

    expect(result.ok).toBe(false);
    // lo que escribio se conserva: la invariante de continuacion depende de esto
    expect(result.finalText).toBe('Lia se gira despacio');
    expect(result.errorMessage).toContain('empezo a responder');
    expect(result.errorMessage).toContain('20 caracteres');
    // y NO le dice que no llego nada ni que reenvie el mensaje entero
    expect(result.errorMessage).not.toContain('sin enviar nada');
    expect(result.errorMessage).not.toContain('vuelve a enviar el mensaje');
  }, 15_000);

  // POR QUE EXISTE: el tope de silencio no lo aplica Luxy con un reloj propio,
  // lo aplica la pila HTTP de Node. Si el despachador deja de viajar en la
  // peticion, el tope vuelve a ser el de fabrica —300 s— y nada falla: se
  // pierde el arreglo entero en silencio.
  it('manda su propio tope de silencio en la peticion', async () => {
    const vistos: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      vistos.push((init as { dispatcher?: unknown }).dispatcher);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"LISTO"},"finish_reason":"stop"}]}\n',
              ),
            );
          },
          cancel() {
            /* el final fuerte hace que Luxy cierre el stream localmente */
          },
        }),
        { status: 200 },
      );
    });

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion());

    expect(result.ok).toBe(true);
    // en un Node sin pila configurable el arreglo se degrada a proposito, pero
    // en el Node de Luxy tiene que ir
    expect(silenceTransportAvailable()).toBe(true);
    expect(vistos[0]).toBeDefined();
  });

  it('un timeout con texto parcial lo conserva y se marca como agotado', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit).signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{"content":"parte uno"}}]}\n'),
            );
            // el tope de Luxy aborta la peticion; undici hace fallar el cuerpo
            signal?.addEventListener('abort', () => {
              controller.error(Object.assign(new Error('abortado'), { name: 'AbortError' }));
            });
          },
        }),
        { status: 200 },
      );
    });

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(
      peticion({ timeoutMs: 60_000, requestTimeoutMs: 30, readOnly: false }),
    );

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.finalText).toBe('parte uno');
    expect(result.termination?.abortedBy).toBe('request_timeout');
  });

  it('marca al usuario como origen del aborto cuando cancela', async () => {
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"choices":[{"delta":{"content":"pensando"}}]}\n'),
        );
        // nunca cierra solo: es Detener quien lo termina. Al abortar, undici
        // hace fallar el cuerpo, y el mock tiene que hacer lo mismo o la
        // lectura se queda esperando bytes para siempre.
        abort.signal.addEventListener('abort', () => {
          controller.error(Object.assign(new Error('abortado'), { name: 'AbortError' }));
        });
        setTimeout(() => abort.abort(), 20);
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion({ signal: abort.signal }));

    expect(result.cancelled).toBe(true);
    expect(result.termination?.abortedBy).toBe('user');
  });

  it('registra el codigo HTTP tambien cuando el proveedor rechaza la peticion', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('sin creditos', { status: 402 }));

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion());

    expect(result.ok).toBe(false);
    // un 4xx no se reintenta, asi que no hay flujo que observar; el codigo si
    expect(result.termination).toBeUndefined();
    expect(result.errorMessage).toContain('402');
  });

  it('una respuesta sin streaming tambien deja diagnostico', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'respuesta corta' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        }),
        { status: 200 },
      ),
    );

    const provider = new HttpApiProvider({ ...config, supportsStreaming: false }, 'una-clave');
    const result = await provider.run(peticion());

    expect(result.ok).toBe(true);
    expect(result.termination).toMatchObject({
      streamed: false,
      transportEnd: 'no_stream',
      finishReason: 'stop',
      finalUsageReceived: true,
      inputTokens: 10,
      outputTokens: 4,
    });
  });
});

describe('timeout de llamadas HTTP', () => {
  it('deja que una llamada agentic use la hora completa del trabajo', () => {
    expect(resolveHttpRequestTimeout({ timeoutMs: 3_600_000 })).toBe(3_600_000);
  });

  it('conserva el limite especifico de una llamada cuando existe', () => {
    expect(resolveHttpRequestTimeout({ timeoutMs: 3_600_000, requestTimeoutMs: 300_000 })).toBe(
      300_000,
    );
  });
});

describe('margen de cierre por defecto', () => {
  it('una configuracion sin el campo espera 15 s de silencio tras un usage', () => {
    // POR QUE IMPORTA: con un segundo, un `usage` intermedio cortaba una
    // pagina web por la mitad. El valor no puede quedarse sin comprobar.
    const parsed = httpProviderConfigSchema.parse({
      id: 'kimi',
      displayName: 'Kimi',
      baseUrl: 'https://ejemplo.test/v1',
      model: 'Kimi-K2.6',
      apiKeyEnv: 'connection:x',
    });
    expect(parsed.softTerminalGraceMs).toBe(SOFT_TERMINAL_GRACE_MS);
    expect(SOFT_TERMINAL_GRACE_MS).toBeGreaterThan(TERMINAL_GRACE_MS * 5);
  });

  // POR QUE IMPORTA: el tope anterior era el de fabrica de Node, 300.000 ms, y
  // no lo habia elegido nadie. Dos llamadas murieron ahi y el reintento
  // siguiente contesto a los 304 s, asi que el tope tiene que dejar sitio por
  // encima de los cinco minutos con holgura.
  it('una conexion sin el campo aguanta quince minutos de silencio', () => {
    const parsed = httpProviderConfigSchema.parse({
      id: 'kimi',
      displayName: 'Kimi',
      baseUrl: 'https://ejemplo.test/v1',
      model: 'Kimi-K2.6',
      apiKeyEnv: 'connection:x',
    });
    expect(parsed.silenceTimeoutMs).toBe(PROVIDER_SILENCE_TIMEOUT_MS);
    expect(PROVIDER_SILENCE_TIMEOUT_MS).toBeGreaterThan(300_000);
  });

  it('cada conexion puede elegir el suyo', () => {
    const parsed = httpProviderConfigSchema.parse({
      id: 'kimi',
      displayName: 'Kimi',
      baseUrl: 'https://ejemplo.test/v1',
      model: 'Kimi-K2.6',
      apiKeyEnv: 'connection:x',
      silenceTimeoutMs: 120_000,
    });
    expect(parsed.silenceTimeoutMs).toBe(120_000);
  });
});

// POR QUE EXISTE: `fetch` entrega siempre el mismo «fetch failed» y esconde el
// motivo en `cause`; encima el reintento lo envuelve otra vez en `lastError`.
// Si esto deja de mirar dentro de las dos capas, un silencio de quince minutos
// vuelve a parecer una caida de red cualquiera y vuelve a reintentarse.
describe('isSilenceTimeout', () => {
  it('reconoce el tope de cabeceras dentro de cause', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('Headers Timeout Error'), {
        code: 'UND_ERR_HEADERS_TIMEOUT',
      }),
    });
    expect(isSilenceTimeout(error)).toBe(true);
  });

  it('reconoce el tope de cuerpo aunque el reintento ya lo hubiera envuelto', () => {
    const interno = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('Body Timeout Error'), { name: 'BodyTimeoutError' }),
    });
    expect(isSilenceTimeout(new RetryError('fallo tras 1 intento', 1, interno))).toBe(true);
  });

  it('no confunde una caida de red con un silencio', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    });
    expect(isSilenceTimeout(error)).toBe(false);
  });

  it('aguanta un error con ciclos sin quedarse dando vueltas', () => {
    const ciclo = new Error('vuelta') as Error & { cause?: unknown };
    ciclo.cause = ciclo;
    expect(isSilenceTimeout(ciclo)).toBe(false);
  });
});

describe('forma de image_url por conexion', () => {
  const base = {
    id: 'kimi',
    displayName: 'Kimi',
    baseUrl: 'https://ejemplo.test/v1',
    model: 'Kimi-K2.6',
    apiKeyEnv: 'connection:x',
  };

  it('una conexion antigua se queda con la forma estandar de objeto', () => {
    expect(httpProviderConfigSchema.parse(base).imageUrlFormat).toBe('object');
  });

  // Mistral documenta `image_url` como cadena; el resto, como objeto. La
  // eleccion es explicita justamente porque no hay una respuesta unica
  it('se puede pedir la forma de cadena que documenta Mistral', () => {
    expect(
      httpProviderConfigSchema.parse({ ...base, imageUrlFormat: 'string' }).imageUrlFormat,
    ).toBe('string');
  });

  it('rechaza cualquier otra forma', () => {
    expect(httpProviderConfigSchema.safeParse({ ...base, imageUrlFormat: 'array' }).success).toBe(
      false,
    );
  });
});

describe('configuracion de ejemplo de los proveedores http', () => {
  it('incluye DeepSeek, GLM y Qwen', () => {
    expect(EXAMPLE_HTTP_PROVIDERS.map((p) => p.id)).toEqual(['deepseek', 'glm', 'qwen']);
  });

  it('llegan deshabilitados y con valores marcados como pendientes', () => {
    for (const provider of EXAMPLE_HTTP_PROVIDERS) {
      expect(provider.enabled).toBe(false);
      // no se codifican urls ni modelos reales, que cambian con el tiempo
      expect(provider.baseUrl).toContain('PENDIENTE');
      expect(provider.model).toContain('PENDIENTE');
    }
  });

  it('las claves se leen de variables de entorno, nunca se incrustan', () => {
    for (const provider of EXAMPLE_HTTP_PROVIDERS) {
      expect(provider.apiKeyEnv).toMatch(/^[A-Z]+_API_KEY$/);
    }
  });
});

// -----------------------------------------------------------------------------
// regresion: /deepseek acababa en Claude Code con los argumentos rotos
// -----------------------------------------------------------------------------
describe('claude: el prompt no puede ir en argv', () => {
  const caps = parseClaudeCapabilities(CLAUDE_HELP);

  it('buildClaudeArgs NO incluye el prompt', () => {
    // --disallowedTools es variadico: un prompt detras se convertia en reglas
    // de herramienta y Claude se quedaba sin entrada
    const args = buildClaudeArgs({
      prompt: 'No modifiques credenciales. Haz un poema.',
      capabilities: caps,
      model: 'opus',
    });
    expect(args.join(' ')).not.toContain('poema');
    expect(args.join(' ')).not.toContain('credenciales');
    expect(args.join(' ')).not.toContain('modifiques');
  });

  it('lo ultimo que aparece son las reglas de herramienta, no texto libre', () => {
    const args = buildClaudeArgs({
      prompt: 'texto que no debe aparecer',
      capabilities: caps,
      model: 'opus',
    });
    const indice = args.indexOf('--disallowedTools');
    expect(indice).toBeGreaterThanOrEqual(0);
    // todo lo que sigue a --disallowedTools tiene forma de herramienta
    for (const valor of args.slice(indice + 1)) {
      expect(valor).toMatch(/^(Bash\(|WebFetch|Write|Edit|Read|Task|Glob|Grep)/);
    }
  });

  it('las reglas son una lista fija, nunca derivada del prompt', () => {
    const uno = buildClaudeArgs({ prompt: 'aaa bbb', capabilities: caps, model: 'opus' });
    const dos = buildClaudeArgs({ prompt: 'ccc ddd', capabilities: caps, model: 'opus' });
    // el mismo comando para dos prompts distintos
    expect(uno).toEqual(dos);
  });

  it('sigue usando --print', () => {
    const args = buildClaudeArgs({ prompt: 'x', capabilities: caps, model: 'opus' });
    expect(args).toContain('--print');
  });
});

// -----------------------------------------------------------------------------
// regresion: el error culpaba a un modelo que no se habia usado
// -----------------------------------------------------------------------------
describe('mensajes de error del proveedor http', () => {
  it('un timeout del proxy no se llama "error interno"', () => {
    const err = Object.assign(new Error('524'), { status: 524 });
    const texto = describeHttpError(err, 'DeepSeek (DeepSeek-V4-Flash)');
    expect(texto).toContain('tardo demasiado');
    expect(texto).not.toContain('error interno');
    // y se nombra el modelo que se uso de verdad
    expect(texto).toContain('DeepSeek-V4-Flash');
  });

  it('un 500 de verdad sigue siendo un error interno', () => {
    const err = Object.assign(new Error('500'), { status: 500 });
    expect(describeHttpError(err, 'X')).toContain('error interno');
  });
});

describe('imagenes para Claude Code', () => {
  const caps = parseClaudeCapabilities(CLAUDE_HELP_2_1_250);

  it('detecta --input-format, que es lo unico que permite adjuntarlas', () => {
    expect(caps.inputFormat).toBe(true);
    // la 2.1.183 no lo tenia: por eso la deteccion no se puede dar por hecha
    expect(parseClaudeCapabilities(CLAUDE_HELP).inputFormat).toBe(false);
    expect(parseClaudeCapabilities('  -p, --print\n').inputFormat).toBe(false);
  });

  it('con imagenes pide la entrada en stream-json', () => {
    const args = buildClaudeArgs({ prompt: 'que ves', capabilities: caps, withImages: true });
    expect(args[args.indexOf('--input-format') + 1]).toBe('stream-json');
    // la CLI EXIGE que la salida lo sea tambien: comprobado contra el binario,
    // «--input-format=stream-json requires output-format=stream-json»
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
  });

  it('sin imagenes no cambia el formato de entrada', () => {
    // el camino de texto es el de siempre y no puede romperse por esto
    const args = buildClaudeArgs({ prompt: 'hola', capabilities: caps });
    expect(args).not.toContain('--input-format');
    expect(args).not.toContain('--restricted');
  });

  it('describir usa --restricted en vez del modo plan', () => {
    // con `--permission-mode plan` Claude remataba la descripcion con «esto no
    // requiere planificacion ni cambios de codigo», y esa frase acababa dentro
    // del pie de foto. Comprobado con el binario 2.1.250
    const args = buildClaudeArgs({
      prompt: 'que ves',
      capabilities: caps,
      readOnly: true,
      withImages: true,
    });
    expect(args).toContain('--restricted');
    expect(args).not.toContain('--permission-mode');
    // y las herramientas de escritura siguen bloqueadas aparte
    expect(args.join(' ')).toContain('--disallowedTools');
    expect(args.join(' ')).toContain('Write');
  });

  it('una version sin --restricted conserva el modo plan', () => {
    // no se deja el turno sin aislamiento por no tener el flag nuevo: se
    // prefiere la coletilla a quitarle la barrera
    const sinFlag = { ...caps, restricted: false };
    const args = buildClaudeArgs({
      prompt: 'que ves',
      capabilities: sinFlag,
      readOnly: true,
      withImages: true,
    });
    expect(args).not.toContain('--restricted');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
  });

  it('el mensaje lleva el texto y la imagen como bloques', () => {
    const linea = buildClaudeImageInput('describe esto', [
      { mimeType: 'image/webp', base64: 'AAAA' },
    ]);
    expect(linea.endsWith('\n')).toBe(true);

    const mensaje = JSON.parse(linea) as {
      message: { content: { type: string; text?: string; source?: Record<string, string> }[] };
    };
    expect(mensaje.message.content[0]).toEqual({ type: 'text', text: 'describe esto' });
    expect(mensaje.message.content[1]?.source).toEqual({
      type: 'base64',
      media_type: 'image/webp',
      data: 'AAAA',
    });
  });

  it('quita el prefijo data: del base64', () => {
    // colarlo dentro da un error de «imagen corrupta» que no explica nada:
    // el tipo ya viaja en media_type
    const linea = buildClaudeImageInput('x', [
      { mimeType: 'image/png', base64: 'data:image/png;base64,QUJD' },
    ]);
    const mensaje = JSON.parse(linea) as { message: { content: { source?: { data?: string } }[] } };
    expect(mensaje.message.content[1]?.source?.data).toBe('QUJD');
  });

  it('varias imagenes van como varios bloques, y el texto primero', () => {
    const linea = buildClaudeImageInput('dos', [
      { mimeType: 'image/png', base64: 'AA' },
      { mimeType: 'image/webp', base64: 'BB' },
    ]);
    const mensaje = JSON.parse(linea) as { message: { content: { type: string }[] } };
    expect(mensaje.message.content.map((bloque) => bloque.type)).toEqual([
      'text',
      'image',
      'image',
    ]);
  });
});

describe('cabeceras de limite en un 429', () => {
  // POR QUE: el cuerpo dice «Rate limit exceeded» tanto si vas rapido como si
  // tu cuota es CERO. Los numeros son lo unico que distingue «espera» de
  // «arreglalo en tu cuenta», y los estabamos tirando.
  it('recoge las que hablan de limite, ordenadas', () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'ratelimitbysize-limit': '0',
      'ratelimitbysize-remaining': '0',
      'x-ratelimit-limit-tokens': '500000',
      'retry-after': '30',
    });
    const texto = collectRateLimitHeaders(headers);
    expect(texto).toContain('ratelimitbysize-limit=0');
    expect(texto).toContain('retry-after=30');
    // nada que no sea un limite
    expect(texto).not.toContain('content-type');
  });

  it('sin cabeceras de limite devuelve null, no una cadena vacia', () => {
    expect(collectRateLimitHeaders(new Headers({ 'content-type': 'application/json' }))).toBeNull();
  });

  it('el mensaje del 429 los enseña y explica que significa un cero', () => {
    const error = Object.assign(new Error('429: {"message":"Rate limit exceeded"}'), {
      status: 429,
      rateLimit: 'ratelimitbysize-limit=0 · ratelimitbysize-remaining=0',
    });
    const texto = describeHttpError(error, 'Mistral');
    expect(texto).toContain('ratelimitbysize-limit=0');
    expect(texto).toContain('no tiene cuota');
  });

  it('tambien con el error envuelto por el reintento', () => {
    const original = Object.assign(new Error('429: {"message":"Rate limit exceeded"}'), {
      status: 429,
      rateLimit: 'ratelimitbysize-limit=0',
    });
    const envuelto = new RetryError('la operacion fallo tras 3 intentos', 3, original);
    expect(describeHttpError(envuelto, 'Mistral')).toContain('ratelimitbysize-limit=0');
  });
});

// -----------------------------------------------------------------------------
// una linea de registro POR LLAMADA
//
// hasta el 2026-09-15 solo habia una linea por TURNO, y un turno puede costar
// tres llamadas de pago. De las tres que murieron vacias el 2026-09-14 no quedo
// constancia de ninguna clase: ni de por que, ni de cuantos tokens se pagaron.
// -----------------------------------------------------------------------------
describe('measurePayload', () => {
  it('cuenta caracteres, no contenido, y separa las imagenes', () => {
    // las imagenes se cuentan aparte porque crecen solas: el bloque de imagen
    // ya ocupa el 38% del prompt de una conversacion de boveda
    const medido = measurePayload([
      { content: 'sistema' },
      {
        content: [
          { type: 'text', text: 'hola' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          { type: 'image_url', image_url: 'data:image/png;base64,BB' },
        ],
      },
    ]);

    expect(medido).toEqual({
      promptChars: 'sistema'.length + 'hola'.length,
      messages: 2,
      images: 2,
      imageChars: 'data:image/png;base64,AAAA'.length + 'data:image/png;base64,BB'.length,
    });
  });
});

describe('errorCodeOf', () => {
  it('saca el codigo de debajo de las dos envolturas', () => {
    // `fetch` entrega siempre `TypeError: fetch failed` y esconde el motivo en
    // `cause`; encima `retryWithBackoff` lo envuelve otra vez. Sin mirar dentro,
    // un silencio de quince minutos y un socket rechazado son indistinguibles.
    const dentro = Object.assign(new Error('Headers Timeout Error'), {
      code: 'UND_ERR_HEADERS_TIMEOUT',
    });
    const fuera = Object.assign(new TypeError('fetch failed'), { cause: dentro });
    expect(errorCodeOf(new RetryError('fallo tras 3 intentos', 3, fuera))).toBe(
      'UND_ERR_HEADERS_TIMEOUT',
    );
  });

  it('usa el nombre cuando no hay codigo, y nunca el mensaje', () => {
    const abortado = Object.assign(new Error('la respuesta llevaba texto privado'), {
      name: 'AbortError',
    });
    expect(errorCodeOf(abortado)).toBe('AbortError');
  });

  it('un Error pelado no aporta codigo: mejor nada que su mensaje', () => {
    expect(errorCodeOf(new Error('texto que podria venir del proveedor'))).toBeNull();
  });
});

describe('HttpApiProvider: una linea de registro por llamada', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const config = { ...EXAMPLE_HTTP_PROVIDERS[0]!, enabled: true, supportsStreaming: true };

  function peticion(overrides: Partial<ProviderRunRequest> = {}): ProviderRunRequest {
    return {
      prompt: 'hola',
      workingDirectory: 'C:/wt',
      timeoutMs: 30_000,
      signal: new AbortController().signal,
      readOnly: true,
      onEvent: () => undefined,
      ...overrides,
    };
  }

  /** un flujo SSE que cierra con `[DONE]`, para que la prueba no espere margen */
  function flujo(lineas: string[], retrasoMs = 0): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const emitir = (): void => {
          for (const linea of lineas) {
            controller.enqueue(new TextEncoder().encode(`${linea}\n`));
          }
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
          controller.close();
        };
        if (retrasoMs === 0) emitir();
        else setTimeout(emitir, retrasoMs);
      },
    });
    return new Response(body, { status: 200 });
  }

  const respuestaBuena = [
    'data: {"choices":[{"delta":{"content":"Hola"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":7601,"completion_tokens":120}}',
  ];

  it('cada intento deja su propia linea, numerada y con el hueco entre ellas', async () => {
    // ESTE es el agujero que se cierra: antes, dos llamadas y una respuesta
    // eran indistinguibles de una llamada y una respuesta.
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      if (intentos === 1) return new Response('se cayo', { status: 503 });
      return flujo(respuestaBuena);
    });

    const lineas: ProviderCallRecord[] = [];
    const provider = new HttpApiProvider(
      config,
      'una-clave',
      new MemoryBudgetStore(),
      undefined,
      (record) => lineas.push(record),
    );

    const result = await provider.run(peticion());

    expect(result.ok).toBe(true);
    expect(lineas.map((l) => l.attempt)).toEqual([1, 2]);
    expect(lineas[0]?.ending).toBe('http_error');
    expect(lineas[0]?.httpStatus).toBe(503);
    expect(lineas[1]?.ending).toBe('answered');
    // el primer intento no tiene con quien compararse; el segundo si, y ese
    // hueco es el que delata un reintento de Luxy en la factura
    expect(lineas[0]?.gapMs).toBeNull();
    expect(lineas[1]?.gapMs).not.toBeNull();
    // y el turno declara lo que costo de verdad
    expect(result.callMetrics).toMatchObject({ modelCalls: 2, billedCalls: 2 });
  }, 15_000);

  it('mide cuanto tardo en decir la primera palabra', async () => {
    // la medida clave del informe, y la que no existia: el tope que mata una
    // llamada cuenta SILENCIO, asi que sin esto una llamada lenta que iba a
    // contestar y una muda se ven exactamente igual desde fuera
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => flujo(respuestaBuena, 80));

    const lineas: ProviderCallRecord[] = [];
    const provider = new HttpApiProvider(
      config,
      'una-clave',
      new MemoryBudgetStore(),
      undefined,
      (record) => lineas.push(record),
    );

    await provider.run(peticion());

    const linea = lineas[0];
    expect(linea?.firstTokenMs).not.toBeNull();
    expect(linea?.firstTokenMs ?? 0).toBeGreaterThanOrEqual(60);
    // descolgar es una cosa y hablar es otra: el hueco entre las dos es
    // justamente lo que el tope de silencio vigila
    expect(linea?.headersMs ?? 0).toBeLessThan(linea?.firstTokenMs ?? 0);
    expect(linea?.durationMs ?? 0).toBeGreaterThanOrEqual(linea?.firstTokenMs ?? 0);
    expect(linea?.tokensIn).toBe(7601);
    expect(linea?.tokensOut).toBe(120);
  }, 15_000);

  it('una llamada que cierra sin una palabra queda registrada, y se cobra', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => flujo([]));

    const lineas: ProviderCallRecord[] = [];
    const store = new MemoryBudgetStore();
    const provider = new HttpApiProvider(config, 'una-clave', store, undefined, (record) =>
      lineas.push(record),
    );

    const result = await provider.run(peticion());

    expect(result.ok).toBe(false);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.ending).toBe('empty');
    expect(lineas[0]?.billed).toBe(true);
    // sin primera palabra: el null NO es un cero, y la diferencia es el dato
    expect(lineas[0]?.firstTokenMs).toBeNull();
    expect(lineas[0]?.textChars).toBe(0);
    // y el presupuesto la cuenta, que es lo que antes no pasaba
    expect(store.read()['deepseek']?.calls).toBe(1);
  }, 15_000);

  it('el registro no lleva ni una palabra del prompt ni de la respuesta', async () => {
    const secretoDelPrompt = 'LIA-SUSURRO-PRIVADO';
    const secretoDeLaRespuesta = 'RESPUESTA-INTIMA-QUE-NO-SALE';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      flujo([
        `data: {"choices":[{"delta":{"content":"${secretoDeLaRespuesta}"}}]}`,
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      ]),
    );

    const lineas: ProviderCallRecord[] = [];
    const provider = new HttpApiProvider(
      config,
      'una-clave',
      new MemoryBudgetStore(),
      undefined,
      (record) => lineas.push(record),
    );

    await provider.run(peticion({ prompt: secretoDelPrompt }));

    const serializado = JSON.stringify(lineas);
    expect(serializado).not.toContain(secretoDelPrompt);
    expect(serializado).not.toContain(secretoDeLaRespuesta);
    expect(serializado).not.toContain('una-clave');
    // lo que si lleva son TAMAÑOS
    expect(lineas[0]?.promptChars).toBeGreaterThan(0);
    expect(lineas[0]?.textChars).toBe(secretoDeLaRespuesta.length);
  }, 15_000);

  it('una llamada que no llega a conectar no se apunta como gasto', async () => {
    // es la unica que sale gratis, y distinguirla es lo que permite seguir
    // reintentando un socket rechazado sin pagar por ello
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });

    const lineas: ProviderCallRecord[] = [];
    const store = new MemoryBudgetStore();
    const provider = new HttpApiProvider(config, 'una-clave', store, undefined, (record) =>
      lineas.push(record),
    );

    await provider.run(peticion());

    expect(lineas.length).toBeGreaterThan(0);
    for (const linea of lineas) {
      expect(linea.ending).toBe('connect_failed');
      expect(linea.billed).toBe(false);
    }
    expect(store.read()['deepseek']).toBeUndefined();
  }, 20_000);

  it('el presupuesto suma TODOS los intentos, no solo el que salio bien', async () => {
    // el turno del informe: tres llamadas cobradas figuraban con los tokens de
    // una, asi que Luxy creia gastar la tercera parte de lo que gastaba
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      if (intentos === 1) return new Response('error interno', { status: 500 });
      return flujo(respuestaBuena);
    });

    const store = new MemoryBudgetStore();
    const provider = new HttpApiProvider(config, 'una-clave', store);

    const result = await provider.run(peticion());

    expect(result.ok).toBe(true);
    const entrada = store.read()['deepseek'];
    expect(entrada?.calls).toBe(2);
    // el 500 no informo tokens, asi que suma cero: el CONTADOR es lo unico que
    // ve una llamada vacia, y por eso protege donde el dinero no llega
    expect(entrada?.inputTokens).toBe(7601);
  }, 15_000);

  it('el limite diario de llamadas frena antes de gastar otra', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const store = new MemoryBudgetStore({
      deepseek: {
        day: new Date().toISOString().slice(0, 10),
        spent: 0,
        inputTokens: 0,
        outputTokens: 0,
        calls: 12,
      },
    });
    const provider = new HttpApiProvider({ ...config, dailyCallLimit: 12 }, 'una-clave', store);

    const result = await provider.run(peticion());

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('limite diario de llamadas');
    // y no se ha llamado a nadie: frenar despues de pagar no frena nada
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // POR QUE NO BASTA LA DE ARRIBA: esa mira el OBJETO que sale del proveedor, y
  // por el tramo que falta —`redactDeep`, el aplanado sobre {ts, level, msg} y
  // la escritura— se colo un campo entero. `maxOutputTokens` acababa en
  // `Tokens`, `redactDeep` tapa el valor de toda clave que acabe asi, y la
  // linea salia a disco con «[REDACTADO]» justo en el unico tope contra el que
  // se interpreta un final `output_budget`. Nada lo cazaba.
  it('la linea que se ESCRIBE conserva todas las cifras y no lleva contenido', async () => {
    const secretoDelPrompt = 'LIA-SUSURRO-PRIVADO';
    const secretoDeLaRespuesta = 'RESPUESTA-INTIMA-QUE-NO-SALE';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      flujo([
        `data: {"choices":[{"delta":{"content":"${secretoDeLaRespuesta}"}}]}`,
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      ]),
    );

    const carpeta = mkdtempSync(join(tmpdir(), 'luxy-registro-'));
    try {
      const logger = new AgentLogger('info', carpeta, false);
      const lineas: ProviderCallRecord[] = [];
      const provider = new HttpApiProvider(
        config,
        'una-clave',
        new MemoryBudgetStore(),
        undefined,
        (record) => {
          lineas.push(record);
          // exactamente como lo escribe el agente: campos SUELTOS
          logger.info(PROVIDER_CALL_LOG_MESSAGE, { ...record });
        },
      );

      await provider.run(peticion({ prompt: secretoDelPrompt, maxOutputTokens: 4096 }));

      const contenido = readFileSync(join(carpeta, 'luxy.log'), 'utf8').trim();
      expect(contenido).not.toContain(secretoDelPrompt);
      expect(contenido).not.toContain(secretoDeLaRespuesta);
      expect(contenido).not.toContain('una-clave');

      const escrita = JSON.parse(contenido.split('\n')[0]!) as Record<string, unknown>;
      expect(escrita['msg']).toBe(PROVIDER_CALL_LOG_MESSAGE);
      // NINGUN campo puede salir tapado ni desaparecer. El barrido va sobre
      // `Object.keys`, no sobre una lista escrita a mano: asi caza tambien el
      // proximo campo que alguien añada con un nombre desafortunado.
      const registro = lineas[0]! as unknown as Record<string, unknown>;
      for (const clave of Object.keys(registro)) {
        expect(escrita[clave]).toBe(registro[clave]);
      }
      expect(escrita['outputCap']).toBe(4096);
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  }, 15_000);

  // el muestreo se apunta para poder comparar con y sin. Ausente = no se mando,
  // que es distinto de mandar el neutro: por eso la clave no aparece.
  it('apunta el muestreo que viajo, y nada si no viajo ninguno', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => flujo(respuestaBuena));
    const conMuestreo = {
      ...config,
      modelSampling: { 'DeepSeek-V4-Flash': { temperature: 1.3 } },
    };

    const lineas: ProviderCallRecord[] = [];
    const provider = new HttpApiProvider(
      conMuestreo,
      'una-clave',
      new MemoryBudgetStore(),
      undefined,
      (record) => lineas.push(record),
    );

    await provider.run(peticion({ model: 'DeepSeek-V4-Flash' }));
    await provider.run(peticion({ model: 'DeepSeek-V4-Pro' }));

    expect(lineas).toHaveLength(2);
    expect(lineas[0]?.temperature).toBe(1.3);
    for (const clave of ['frequencyPenalty', 'presencePenalty', 'repetitionPenalty']) {
      expect(clave in lineas[0]!).toBe(false);
    }
    for (const clave of [
      'temperature',
      'frequencyPenalty',
      'presencePenalty',
      'repetitionPenalty',
    ]) {
      expect(clave in lineas[1]!).toBe(false);
    }
  }, 15_000);

  it('la linea ESCRITA conserva los cuatro de muestreo sin redactar', async () => {
    // mismo barrido que la prueba de arriba, con los cuatro puestos: un nombre
    // de campo desafortunado saldria a disco como «[REDACTADO]»
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => flujo(respuestaBuena));

    const carpeta = mkdtempSync(join(tmpdir(), 'luxy-registro-'));
    try {
      const logger = new AgentLogger('info', carpeta, false);
      const lineas: ProviderCallRecord[] = [];
      const provider = new HttpApiProvider(
        {
          ...config,
          temperature: 1.3,
          frequencyPenalty: 0,
          presencePenalty: -0.5,
          repetitionPenalty: 1.05,
        },
        'una-clave',
        new MemoryBudgetStore(),
        undefined,
        (record) => {
          lineas.push(record);
          logger.info(PROVIDER_CALL_LOG_MESSAGE, { ...record });
        },
      );

      await provider.run(peticion());

      const contenido = readFileSync(join(carpeta, 'luxy.log'), 'utf8').trim();
      const escrita = JSON.parse(contenido.split('\n')[0]!) as Record<string, unknown>;
      const registro = lineas[0]! as unknown as Record<string, unknown>;
      for (const clave of Object.keys(registro)) {
        expect(escrita[clave]).toBe(registro[clave]);
      }
      expect(escrita).toMatchObject({
        temperature: 1.3,
        frequencyPenalty: 0,
        presencePenalty: -0.5,
        repetitionPenalty: 1.05,
      });
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  }, 15_000);

  // POR QUE EXISTE: el cupo se miraba UNA vez, en `run()`, antes de los
  // reintentos y antes de ramificar al bucle de herramientas. Un turno de tres
  // intentos se pasaba del tope por dos; un trabajo agentic, por cuarenta y
  // nueve. El tope existe precisamente porque esta pasarela cobra por llamada.
  it('el limite diario de llamadas frena TAMBIEN entre reintentos', async () => {
    let intentos = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      intentos += 1;
      return new Response('error interno', { status: 500 });
    });

    const store = new MemoryBudgetStore();
    const provider = new HttpApiProvider({ ...config, dailyCallLimit: 2 }, 'una-clave', store);

    const result = await provider.run(peticion());

    expect(result.ok).toBe(false);
    // dos peticiones, no tres: la tercera ya no cabia en el cupo del dia
    expect(intentos).toBe(2);
    expect(result.callMetrics?.modelCalls).toBe(2);
    expect(store.read()['deepseek']?.calls).toBe(2);
    // y el motivo es el de Luxy, sin culpar al proveedor ni añadirle la prosa
    // del envoltorio de reintentos
    expect(result.errorMessage).toContain('limite diario de llamadas');
    expect(result.errorMessage).not.toContain('la operacion fallo tras');
  }, 20_000);

  it('un fallo del registro no puede costar la respuesta', async () => {
    // el turno de Daniel es una llamada de pago y una conversacion real
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => flujo(respuestaBuena));

    const provider = new HttpApiProvider(
      config,
      'una-clave',
      new MemoryBudgetStore(),
      undefined,
      () => {
        throw new Error('el disco de registro esta lleno');
      },
    );

    const result = await provider.run(peticion());

    expect(result.ok).toBe(true);
    expect(result.finalText).toBe('Hola');
  }, 15_000);
});

// POR QUE EXISTEN ESTAS PRUEBAS: los parametros de muestreo se añadieron para
// poder MEDIR con y sin, no para dejarlos puestos. Si una conexion que no los
// configura empezara a mandar valores «neutros», pasarian dos cosas: ya no
// habria un «sin» contra el que comparar, y las pasarelas que devuelven 400
// ante un parametro que no conocen dejarian de responder sin que nadie hubiera
// tocado su configuracion. La primera prueba fija el cuerpo ENTERO por eso.
describe('HttpApiProvider: parametros de muestreo', () => {
  const base = { ...EXAMPLE_HTTP_PROVIDERS[0]!, enabled: true, supportsStreaming: false };

  /** captura el cuerpo enviado; no hay red, la respuesta es fija */
  function espiar(): { body: () => Record<string, unknown> | null } {
    let sent: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'listo' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    return { body: () => sent };
  }

  const peticion = (overrides: Record<string, unknown> = {}) => ({
    prompt: 'hola',
    workingDirectory: 'C:/wt',
    timeoutMs: 1000,
    signal: new AbortController().signal,
    onEvent: () => undefined,
    ...overrides,
  });

  it('sin configurar, el cuerpo sale identico al de siempre', async () => {
    const espia = espiar();
    const provider = new HttpApiProvider(base, 'una-clave');

    expect((await provider.run(peticion())).ok).toBe(true);
    // no se comprueban solo los cuatro nombres: se fija el cuerpo COMPLETO, que
    // es la unica forma de cazar una clave nueva colada sin querer
    expect(Object.keys(espia.body() ?? {}).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'stream',
    ]);
  });

  it('sin configurar tampoco añade nada por el camino con herramientas', async () => {
    // son DOS sitios distintos que componen el cuerpo, y el del bucle de
    // herramientas es el que no se ve en una conversacion normal
    const espia = espiar();
    const provider = new HttpApiProvider(base, 'una-clave');

    const result = await provider.run({
      ...peticion({ readOnly: false }),
      agentic: {
        runner: { execute: vi.fn(async () => ({ ok: true, content: 'ok' })) },
        allowedTools: ['write_file'],
        limits: modelLimitsSchema.parse({}),
        useNativeTools: true,
      },
    });

    expect(result.ok).toBe(true);
    expect(Object.keys(espia.body() ?? {}).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'tool_choice',
      'tools',
    ]);
  });

  it('manda solo los puestos, y con los nombres del contrato', async () => {
    const espia = espiar();
    const provider = new HttpApiProvider({ ...base, frequencyPenalty: 0.3 }, 'una-clave');

    expect((await provider.run(peticion())).ok).toBe(true);
    const body = espia.body() ?? {};
    // snake_case, no el nombre del esquema
    expect(body['frequency_penalty']).toBe(0.3);
    expect(body['frequencyPenalty']).toBeUndefined();
    expect('temperature' in body).toBe(false);
    expect('presence_penalty' in body).toBe(false);
    expect('repetition_penalty' in body).toBe(false);
  });

  it('manda los cuatro cuando estan los cuatro', async () => {
    const espia = espiar();
    const provider = new HttpApiProvider(
      {
        ...base,
        temperature: 0.8,
        frequencyPenalty: 0.2,
        presencePenalty: -0.1,
        // no es de OpenAI y va igualmente en la RAIZ: es de ahi de donde lo
        // leen vLLM, TGI, llama.cpp y OpenRouter
        repetitionPenalty: 1.05,
      },
      'una-clave',
    );

    expect((await provider.run(peticion())).ok).toBe(true);
    expect(espia.body()).toMatchObject({
      temperature: 0.8,
      frequency_penalty: 0.2,
      presence_penalty: -0.1,
      repetition_penalty: 1.05,
    });
    expect(espia.body()?.['extra_body']).toBeUndefined();
  });

  it('un cero SI se manda: cero no es lo mismo que vacio', async () => {
    // con `!temperature` o `temperature > 0` este caso se perderia en silencio,
    // y temperatura 0 es precisamente uno de los extremos que se quiere medir
    const espia = espiar();
    const provider = new HttpApiProvider(
      { ...base, temperature: 0, frequencyPenalty: 0 },
      'una-clave',
    );

    expect((await provider.run(peticion())).ok).toBe(true);
    expect(espia.body()?.['temperature']).toBe(0);
    expect(espia.body()?.['frequency_penalty']).toBe(0);
  });

  // POR MODELO: un proveedor de familia sirve varios modelos, porque el modelo
  // viaja en cada peticion. Lo que se fija aqui es que la temperatura puesta a
  // UNO no se le cuele a los demas, ni por el camino con herramientas.
  describe('por modelo (familias de una conexion)', () => {
    const porModelo = { ...base, modelSampling: { 'DeepSeek-V4-Flash': { temperature: 1.3 } } };

    it('otro modelo del mismo proveedor manda el cuerpo de siempre', async () => {
      const espia = espiar();
      const provider = new HttpApiProvider(porModelo, 'una-clave');

      expect((await provider.run(peticion({ model: 'DeepSeek-V4-Pro' }))).ok).toBe(true);
      expect(Object.keys(espia.body() ?? {}).sort()).toEqual([
        'max_tokens',
        'messages',
        'model',
        'stream',
      ]);
    });

    it('el modelo con entrada recibe SOLO lo suyo', async () => {
      const espia = espiar();
      const provider = new HttpApiProvider(porModelo, 'una-clave');

      expect((await provider.run(peticion({ model: 'DeepSeek-V4-Flash' }))).ok).toBe(true);
      expect(Object.keys(espia.body() ?? {}).sort()).toEqual([
        'max_tokens',
        'messages',
        'model',
        'stream',
        'temperature',
      ]);
      expect(espia.body()?.['temperature']).toBe(1.3);
      expect(espia.body()?.['model']).toBe('DeepSeek-V4-Flash');
    });

    it('sin modelo en la peticion se mira el de la configuracion', async () => {
      const espia = espiar();
      const provider = new HttpApiProvider(
        { ...porModelo, model: 'DeepSeek-V4-Flash' },
        'una-clave',
      );

      expect((await provider.run(peticion())).ok).toBe(true);
      expect(espia.body()?.['temperature']).toBe(1.3);
    });

    it('la entrada del modelo sustituye al nivel superior, no se mezcla', async () => {
      const espia = espiar();
      const provider = new HttpApiProvider({ ...porModelo, frequencyPenalty: 0.4 }, 'una-clave');

      expect((await provider.run(peticion({ model: 'DeepSeek-V4-Flash' }))).ok).toBe(true);
      expect(espia.body()?.['temperature']).toBe(1.3);
      expect('frequency_penalty' in (espia.body() ?? {})).toBe(false);
    });

    it('un modelo llamado como el prototipo no saca nada de ahi', async () => {
      for (const model of ['toString', 'constructor']) {
        const espia = espiar();
        const provider = new HttpApiProvider(porModelo, 'una-clave');
        expect((await provider.run(peticion({ model }))).ok).toBe(true);
        expect(Object.keys(espia.body() ?? {}).sort()).toEqual([
          'max_tokens',
          'messages',
          'model',
          'stream',
        ]);
      }
    });

    it('tambien por el camino con herramientas, y solo para su modelo', async () => {
      const conHerramientas = (model: string) => ({
        ...peticion({ readOnly: false, model }),
        agentic: {
          runner: { execute: vi.fn(async () => ({ ok: true, content: 'ok' })) },
          allowedTools: ['write_file' as const],
          limits: modelLimitsSchema.parse({}),
          useNativeTools: true,
        },
      });

      const otro = espiar();
      expect(
        (await new HttpApiProvider(porModelo, 'una-clave').run(conHerramientas('DeepSeek-V4-Pro')))
          .ok,
      ).toBe(true);
      expect(Object.keys(otro.body() ?? {}).sort()).toEqual([
        'max_tokens',
        'messages',
        'model',
        'tool_choice',
        'tools',
      ]);

      const suyo = espiar();
      expect(
        (
          await new HttpApiProvider(porModelo, 'una-clave').run(
            conHerramientas('DeepSeek-V4-Flash'),
          )
        ).ok,
      ).toBe(true);
      expect(suyo.body()?.['temperature']).toBe(1.3);
    });
  });
});

// los cuatro rangos son DISTINTOS, y confundirlos manda a la pasarela un valor
// que rechaza. Cada uno se fija en sus dos extremos y en lo que hay justo fuera.
describe('rangos de los parametros de muestreo', () => {
  const base = {
    id: 'kimi',
    displayName: 'Kimi',
    baseUrl: 'https://ejemplo.test/v1',
    model: 'Kimi-K2.6',
    apiKeyEnv: 'connection:x',
  };

  const acepta = (extra: Record<string, number>): boolean =>
    httpProviderConfigSchema.safeParse({ ...base, ...extra }).success;

  it('una conexion antigua no tiene ninguno, y eso es lo correcto', () => {
    const parsed = httpProviderConfigSchema.parse(base);
    expect(parsed.temperature).toBeUndefined();
    expect(parsed.frequencyPenalty).toBeUndefined();
    expect(parsed.presencePenalty).toBeUndefined();
    expect(parsed.repetitionPenalty).toBeUndefined();
  });

  it('temperatura: 0..2, el rango que documenta OpenAI', () => {
    expect(acepta({ temperature: 0 })).toBe(true);
    expect(acepta({ temperature: 2 })).toBe(true);
    expect(acepta({ temperature: -0.1 })).toBe(false);
    expect(acepta({ temperature: 2.1 })).toBe(false);
  });

  it('frecuencia y presencia: -2..2, y el negativo es valido', () => {
    for (const key of ['frequencyPenalty', 'presencePenalty'] as const) {
      expect(acepta({ [key]: -2 })).toBe(true);
      expect(acepta({ [key]: 2 })).toBe(true);
      expect(acepta({ [key]: -2.1 })).toBe(false);
      expect(acepta({ [key]: 2.1 })).toBe(false);
    }
  });

  it('repeticion: mayor que 0, no desde 0, porque es multiplicativa', () => {
    // vLLM y TGI rechazan el 0: dividir por el neutro no tiene sentido ahi
    expect(acepta({ repetitionPenalty: 0 })).toBe(false);
    expect(acepta({ repetitionPenalty: 0.01 })).toBe(true);
    expect(acepta({ repetitionPenalty: 1 })).toBe(true);
    expect(acepta({ repetitionPenalty: 2 })).toBe(true);
    expect(acepta({ repetitionPenalty: 2.1 })).toBe(false);
    // y su rango NO es el de las otras dos penalizaciones
    expect(acepta({ repetitionPenalty: -1 })).toBe(false);
  });
});
