import { describe, it, expect } from 'vitest';
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
  parseSseLine,
  describeHttpError,
  HttpApiProvider,
  MemoryBudgetStore,
  EXAMPLE_HTTP_PROVIDERS,
} from './http-provider.js';
import { helpHasFlag, extractVersion } from '../detect.js';

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

  it('el prompt es siempre el ultimo argumento, sin concatenar', () => {
    const prompt = 'texto --con --pinta --de --flags';
    const args = buildClaudeArgs({ prompt, capabilities: caps });
    expect(args[args.length - 1]).toBe(prompt);
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
    expect(args).toEqual(['--print', '--model', 'opus', 'algo']);
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
describe('parseSseLine', () => {
  it('extrae el fragmento de texto', () => {
    const parsed = parseSseLine('data: {"choices":[{"delta":{"content":"hola"}}]}');
    expect(parsed?.text).toBe('hola');
    expect(parsed?.done).toBe(false);
  });

  it('reconoce el fin del flujo', () => {
    expect(parseSseLine('data: [DONE]')?.done).toBe(true);
  });

  it('extrae el consumo de tokens', () => {
    const parsed = parseSseLine(
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}',
    );
    expect(parsed?.usage).toEqual({ input: 10, output: 20 });
  });

  it('ignora lineas que no son data', () => {
    expect(parseSseLine(': keep-alive')).toBeNull();
    expect(parseSseLine('')).toBeNull();
  });

  it('ignora un data con json roto', () => {
    expect(parseSseLine('data: {roto')).toBeNull();
  });
});

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
});

describe('HttpApiProvider', () => {
  const config = EXAMPLE_HTTP_PROVIDERS[0]!;

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
