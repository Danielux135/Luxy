import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  parseClaudeCapabilities,
  buildClaudeArgs,
  parseClaudeStreamLine,
  buildClaudeError,
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
  parseRetryAfter,
  HttpApiProvider,
  MemoryBudgetStore,
  EXAMPLE_HTTP_PROVIDERS,
  resolveHttpRequestTimeout,
} from './http-provider.js';
import {
  httpProviderConfigSchema,
  RetryError,
  SOFT_TERMINAL_GRACE_MS,
  TERMINAL_GRACE_MS,
} from '@luxy/shared';
import { helpHasFlag, extractVersion } from '../detect.js';

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
      maxTurns: false,
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
    });
  });

  it('sin ayuda no asume nada', () => {
    const caps = parseCodexCapabilities(null);
    expect(Object.values(caps).every((value) => value === false)).toBe(true);
  });
});

describe('buildCodexArgs', () => {
  const caps = parseCodexCapabilities(CODEX_HELP);

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
    expect(describeHttpError(error, 'GLM')).toContain('limitando');
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

  it('un 429 envuelto sigue reconociendose como limite de frecuencia', () => {
    // el envoltorio del reintento escondia el status y todo acababa en la rama
    // generica, que enseña el cuerpo crudo de la respuesta
    const original = Object.assign(new Error('429: 您的请求频率过高'), { status: 429 });
    const envuelto = new RetryError('la operacion fallo tras 3 intentos', 3, original);

    const mensaje = describeHttpError(envuelto, 'KAT Coder Pro v2.5');
    expect(mensaje).toContain('limitando las peticiones por frecuencia');
    expect(mensaje).not.toContain('您的请求频率过高');
  });
});

describe('Retry-After', () => {
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

// POR QUE EXISTE: una web generada durante 23 minutos acabo a mitad de una
// etiqueta y no se pudo demostrar el motivo. Sin estas señales, "se acabaron
// los tokens", "Luxy corto la conexion" y "el proveedor cerro el socket" son
// indistinguibles, y cada una lleva a tocar una cosa distinta.
describe('HttpApiProvider: diagnostico del final de la respuesta', () => {
  const config = { ...EXAMPLE_HTTP_PROVIDERS[0]!, enabled: true, supportsStreaming: true };

  function peticion(overrides: Record<string, unknown> = {}) {
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
        return new Response('demasiadas peticiones', { status: 429, headers: { 'Retry-After': '1' } });
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
    const result = await provider.run(peticion({ onEvent: (event) => events.push(`${event.type}:${event.message}`) }));

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

  it('un corte SIN texto si se reintenta: no hay nada que perder', async () => {
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

    const provider = new HttpApiProvider(config, 'una-clave');
    const result = await provider.run(peticion());

    expect(intentos).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.finalText).toBe('');
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
    expect(
      resolveHttpRequestTimeout({ timeoutMs: 3_600_000, requestTimeoutMs: 300_000 }),
    ).toBe(300_000);
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
