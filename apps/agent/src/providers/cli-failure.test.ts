// POR QUE EXISTE: durante mas de una semana Claude Code estuvo sin sesion en el
// equipo de Daniel y Luxy no se entero. El CLI no falla «hacia fuera»: emite un
// `assistant` sintetico con `error: "authentication_failed"` y un `result` con
// `is_error: true` —y `subtype: "success"`— cuyo texto es el mensaje de error,
// y sale con codigo 1. Luxy guardaba ese texto como si fuera la respuesta: el
// turno salia completado y los trabajos de fondo lo contaban como una negativa.
//
// Estas pruebas fijan que ese texto no llega NUNCA a ningun sitio como
// respuesta, que el final es `failed` con `failureReason: 'auth'`, y que la
// deteccion avisa sin quitar a Claude de los disponibles.
//
// Nada de esto lanza el CLI real ni gasta tokens. Las salidas son grabaciones
// SINTETICAS con la forma de las reales (las reales se miraron solo por su
// estructura, sin copiar su contenido), y el «ejecutable» es un script de node
// que responde como el CLI: un proceso de verdad, con su entorno restringido,
// sus trozos de stdout y su codigo de salida.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { agentConfigSchema, hostResponseSchema } from '@luxy/shared';
import type { AgentConfig, ProviderRunRequest, ProviderStreamEvent } from '@luxy/shared';
import {
  CLAUDE_AUTH_MESSAGE,
  ClaudeCodeProvider,
  ClaudeStreamState,
  buildClaudeError,
  claudeAuthStatusSupported,
  classifyClaudeExit,
  parseClaudeAuthStatus,
  parseClaudeStreamLine,
  probeClaudeAuth,
} from './claude.js';
import {
  CODEX_AUTH_MESSAGE,
  CodexCliProvider,
  buildCodexError,
  codexLoginStatusSupported,
  parseCodexStreamLine,
  probeCodexAuth,
} from './codex.js';
import { clearResolutionCache, setCachedResolution } from '../resolve-executable.js';
import { runLocalTurn } from '../local-turn.js';
import { EMPTY_CONVERSATION_REPLY_MESSAGE } from '../job-runner.js';
import type { AgentLogger } from '../logger.js';
import type * as Detect from '../detect.js';

// la deteccion de PRESENCIA pasa por `where.exe`, que no encuentra un script
// de pruebas. Se sustituye solo esa pieza: la ayuda, la consulta de sesion y la
// ejecucion van por el camino real, contra el ejecutable falso
vi.mock('../detect.js', async (importOriginal) => {
  const original = await importOriginal<typeof Detect>();
  return {
    ...original,
    detectTool: async () => ({ available: true, version: '9.9.9 (falso)', path: 'falso' }),
  };
});

// -----------------------------------------------------------------------------
// salidas grabadas, sinteticas
// -----------------------------------------------------------------------------

/** un texto que no puede aparecer por casualidad: si sale en algun sitio, es una fuga */
const TEXTO_DEL_CLI = 'TEXTO-DEL-CLI-7f3a: Not logged in · Please run /login';

const SESION = 'sesion-sintetica-0001';

const INIT = JSON.stringify({ type: 'system', subtype: 'init', session_id: SESION });

/** el `assistant` sintetico que emite el CLI cuando la llamada a la API falla */
function asistenteConError(categoria: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      model: '<synthetic>',
      role: 'assistant',
      content: [{ type: 'text', text: TEXTO_DEL_CLI }],
    },
    session_id: SESION,
    error: categoria,
    is_api_error_message: true,
  });
}

/** el `result` de un fallo: `subtype` dice success y aun asi es un error */
const RESULTADO_CON_ERROR = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  terminal_reason: 'api_error',
  api_error_status: null,
  result: TEXTO_DEL_CLI,
  session_id: SESION,
  num_turns: 1,
});

/** la secuencia sin sesion, tal y como la da el CLI de este equipo */
const SIN_SESION = [INIT, asistenteConError('authentication_failed'), RESULTADO_CON_ERROR];

const RESPUESTA = 'Hola, Daniel. Esto si es una respuesta.';

const NORMAL = [
  INIT,
  JSON.stringify({
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      role: 'assistant',
      content: [{ type: 'text', text: RESPUESTA }],
    },
    session_id: SESION,
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: RESPUESTA,
    session_id: SESION,
  }),
];

/** alimenta el estado con una salida grabada, como hace `run()` linea a linea */
function leer(lineas: readonly string[]): ClaudeStreamState {
  const estado = new ClaudeStreamState();
  for (const linea of lineas) {
    const evento = parseClaudeStreamLine(linea);
    if (evento) estado.accept(evento);
  }
  return estado;
}

// -----------------------------------------------------------------------------
// parseo de la salida grabada
// -----------------------------------------------------------------------------

describe('Claude: un resultado de error no es una respuesta', () => {
  it('reconoce el result de error aunque su subtype diga success', () => {
    const evento = parseClaudeStreamLine(RESULTADO_CON_ERROR);
    expect(evento?.isResult).toBe(true);
    expect(evento?.isError).toBe(true);
  });

  it('reconoce el assistant sintetico y su categoria', () => {
    const evento = parseClaudeStreamLine(asistenteConError('authentication_failed'));
    expect(evento?.isError).toBe(true);
    expect(evento?.errorCategory).toBe('authentication_failed');
  });

  it('un assistant normal no es un error', () => {
    const evento = parseClaudeStreamLine(NORMAL[1]!);
    expect(evento?.isError).toBe(false);
    expect(evento?.errorCategory).toBeNull();
  });

  it('una categoria que no tiene forma de enum no se toma por categoria', () => {
    const linea = JSON.stringify({ type: 'assistant', error: 'Algo Raro: con espacios' });
    const evento = parseClaudeStreamLine(linea);
    expect(evento?.isError).toBe(true);
    expect(evento?.errorCategory).toBeNull();
  });

  it('sin sesion: no queda texto y el motivo es auth, salga con 1', () => {
    const estado = leer(SIN_SESION);
    expect(estado.finalText).toBe('');
    expect(estado.failed).toBe(true);
    expect(classifyClaudeExit(estado, 1)).toBe('auth');
  });

  it('sin sesion: el motivo es el mismo si saliera con 0', () => {
    expect(classifyClaudeExit(leer(SIN_SESION), 0)).toBe('auth');
  });

  it('el limite de uso del CLI es rate_limit', () => {
    const estado = leer([INIT, asistenteConError('rate_limit'), RESULTADO_CON_ERROR]);
    expect(classifyClaudeExit(estado, 1)).toBe('rate_limit');
  });

  it('cualquier otra categoria es api_error: no se inventa una accion para cada una', () => {
    for (const categoria of ['overloaded', 'billing_error', 'server_error', 'unknown']) {
      const estado = leer([INIT, asistenteConError(categoria), RESULTADO_CON_ERROR]);
      expect(classifyClaudeExit(estado, 1)).toBe('api_error');
    }
  });

  it('un result de error sin assistant delante es api_error', () => {
    expect(classifyClaudeExit(leer([INIT, RESULTADO_CON_ERROR]), 1)).toBe('api_error');
  });

  it('un codigo distinto de 0 sin ningun result es exit_code', () => {
    expect(classifyClaudeExit(leer([INIT]), 1)).toBe('exit_code');
  });

  it('una respuesta normal sigue funcionando igual', () => {
    const estado = leer(NORMAL);
    expect(estado.finalText).toBe(RESPUESTA);
    expect(estado.sessionId).toBe(SESION);
    expect(classifyClaudeExit(estado, 0)).toBeNull();
  });

  it('un error del que el CLI se recupera no tumba la respuesta que si llego', () => {
    const estado = leer([INIT, asistenteConError('overloaded'), ...NORMAL.slice(1)]);
    expect(classifyClaudeExit(estado, 0)).toBeNull();
    expect(estado.finalText).toBe(RESPUESTA);
  });
});

describe('mensajes de error: dicen que hacer y no copian al CLI', () => {
  // un stderr que no casa con ninguna de las pistas conocidas: es el caso en
  // el que antes se pegaban sus ultimas lineas
  const STDERR_RARO = 'TEXTO-DEL-CLI-7f3a: algo raro que no es ninguna pista conocida';

  it('Claude no pega stderr en el mensaje', () => {
    const mensaje = buildClaudeError(3, STDERR_RARO);
    expect(mensaje).toContain('3');
    expect(mensaje).not.toContain('TEXTO-DEL-CLI');
  });

  it('Codex no pega stderr en el mensaje', () => {
    const mensaje = buildCodexError(3, STDERR_RARO);
    expect(mensaje).toContain('3');
    expect(mensaje).not.toContain('TEXTO-DEL-CLI');
  });

  it('el mensaje de sin sesion dice exactamente que ejecutar', () => {
    expect(CLAUDE_AUTH_MESSAGE).toContain('claude auth login');
  });
});

describe('Codex: el mensaje de un evento de error no es texto de respuesta', () => {
  it('error y turn.failed no aportan texto y dan el turno por perdido', () => {
    const error = parseCodexStreamLine(JSON.stringify({ type: 'error', message: TEXTO_DEL_CLI }));
    expect(error?.text).toBeNull();
    expect(error?.isError).toBe(true);
    expect(error?.isFatal).toBe(true);

    const fallido = parseCodexStreamLine(
      JSON.stringify({ type: 'turn.failed', error: { message: TEXTO_DEL_CLI } }),
    );
    expect(fallido?.text).toBeNull();
    expect(fallido?.isFatal).toBe(true);
  });

  it('el formato antiguo tambien: msg.type error', () => {
    const viejo = parseCodexStreamLine(
      JSON.stringify({ id: '0', msg: { type: 'error', message: TEXTO_DEL_CLI } }),
    );
    expect(viejo?.text).toBeNull();
    expect(viejo?.isFatal).toBe(true);
  });

  it('un reintento anunciado es un error, pero no fatal', () => {
    const reintento = parseCodexStreamLine(
      JSON.stringify({ id: '0', msg: { type: 'stream_error', message: 'reintentando' } }),
    );
    expect(reintento?.isError).toBe(true);
    expect(reintento?.isFatal).toBe(false);
    expect(reintento?.text).toBeNull();
  });

  it('un evento normal sigue dando su texto', () => {
    const normal = parseCodexStreamLine(JSON.stringify({ type: 'item', text: 'hola' }));
    expect(normal?.text).toBe('hola');
    expect(normal?.isError).toBe(false);
  });
});

describe('consulta de sesion: parseo', () => {
  // la linea de uso real de `claude auth status --help` en este equipo
  const AYUDA_AUTH = [
    'Usage: claude auth status [options]',
    '',
    'Show authentication status',
    '',
    'Options:',
    '  -h, --help  Display help for command',
    '  --json      Output as JSON (default)',
    '  --text      Output as human-readable text',
  ].join('\n');

  it('reconoce la ayuda del subcomando', () => {
    expect(claudeAuthStatusSupported(AYUDA_AUTH)).toBe(true);
  });

  it('la ayuda GENERAL no cuenta aunque mencione json', () => {
    // una version sin `auth` contesta con la general; ahi `--json-schema` no
    // es `--json`, y lanzar despues `auth status --json` seria lanzar un prompt
    const general = 'Usage: claude [options] [command] [prompt]\n  --json-schema <schema>  JSON';
    expect(claudeAuthStatusSupported(general)).toBe(false);
    expect(claudeAuthStatusSupported(null)).toBe(false);
  });

  it('lee loggedIn y nada mas', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":false,"authMethod":"none"}')).toBe(false);
    expect(parseClaudeAuthStatus('{"loggedIn":true}\n')).toBe(true);
    expect(parseClaudeAuthStatus('no es json')).toBeNull();
    expect(parseClaudeAuthStatus('{"otra":1}')).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// ejecutable falso: un proceso de verdad que responde como el CLI
// -----------------------------------------------------------------------------

interface ComportamientoFalso {
  /** ayuda general (`--help`) */
  help: string;
  /** ayuda por subcomando: clave = argumentos antes de `--help` */
  subHelp: Record<string, string>;
  /** lo que imprime `auth status --json` y con que codigo sale */
  authStdout: string;
  authCode: number;
  /** `auth status --json` se queda colgado */
  authHang: boolean;
  /** con que codigo sale `codex login status`: 0 con sesion */
  loginCode: number;
  /** lo que imprime una ejecucion de verdad, linea a linea */
  runLines: string[];
  runCode: number;
  /** contenido de `--output-last-message`, si se pasa; null = no lo escribe */
  lastMessage: string | null;
}

const AYUDA_CLAUDE = [
  'Usage: claude [options] [command] [prompt]',
  'Options:',
  '  -p, --print                  Print response and exit',
  '  --output-format <format>     "text", "json", or "stream-json"',
  '  --input-format <format>      "text" or "stream-json"',
  '  --verbose                    Verbose',
  '  --model <model>              Model',
  '  --effort <level>             Effort',
  '  --permission-mode <mode>     Permission mode',
  '  --disallowedTools <tools...> Tools to disallow',
  '  --no-session-persistence     Do not save the session',
  'Commands:',
  '  auth                         Manage authentication',
].join('\n');

const AYUDA_AUTH_STATUS = [
  'Usage: claude auth status [options]',
  'Options:',
  '  --json      Output as JSON (default)',
  '  --text      Output as human-readable text',
].join('\n');

const AYUDA_CODEX_EXEC = [
  'Usage: codex exec [OPTIONS] [PROMPT]',
  '  --json                       Print events as JSONL',
  '  -C, --cd <DIR>               Working directory',
  '  -s, --sandbox <MODE>         Sandbox',
  '  -m, --model <MODEL>          Model',
  '  -o, --output-last-message <FILE>  Last message',
  '  --skip-git-repo-check        Skip',
  '  --ephemeral                  Run without persisting session files to disk',
].join('\n');

/** la linea de uso real de `codex login status --help` (codex-cli 0.154.0) */
const AYUDA_CODEX_LOGIN_STATUS = [
  'Show login status',
  '',
  'Usage: codex login status [OPTIONS]',
  '',
  'Options:',
  '  -h, --help  Print help',
].join('\n');

const BASE: ComportamientoFalso = {
  help: AYUDA_CLAUDE,
  subHelp: { 'auth status': AYUDA_AUTH_STATUS },
  authStdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }),
  authCode: 1,
  authHang: false,
  loginCode: 1,
  runLines: [],
  runCode: 0,
  lastMessage: null,
};

/**
 * el script que hace de CLI.
 *
 * Se escribe sin barras invertidas a proposito: los saltos de linea salen de
 * `os.EOL` y los datos van como JSON. La variable LUXY_SONDA_FUERA_DE_LISTA la
 * pone la prueba en SU entorno; si el hijo la ve, es que el entorno no se
 * restringio, y entonces contesta «con sesion» para que la prueba lo note.
 */
function guionFalso(comportamiento: ComportamientoFalso): string {
  return [
    "'use strict';",
    `const config = ${JSON.stringify(comportamiento)};`,
    "const os = require('node:os');",
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    'const tiene = (a) => args.includes(a);',
    'function salir(texto, codigo) { process.stdout.write(texto); process.exitCode = codigo; }',
    "if (tiene('--version')) {",
    "  salir('9.9.9 (falso)' + os.EOL, 0);",
    "} else if (tiene('--help')) {",
    "  const clave = args.slice(0, args.indexOf('--help')).join(' ');",
    '  salir(config.subHelp[clave] !== undefined ? config.subHelp[clave] : config.help, 0);',
    "} else if (args[0] === 'auth' && args[1] === 'status' && tiene('--json')) {",
    '  if (config.authHang) {',
    '    setTimeout(() => undefined, 60000);',
    '  } else if (process.env.LUXY_SONDA_FUERA_DE_LISTA !== undefined) {',
    '    salir(JSON.stringify({ loggedIn: true }), 0);',
    '  } else {',
    '    salir(config.authStdout, config.authCode);',
    '  }',
    "} else if (args[0] === 'login' && args[1] === 'status') {",
    "  salir('', process.env.LUXY_SONDA_FUERA_DE_LISTA !== undefined ? 0 : config.loginCode);",
    '} else {',
    '  process.stdin.resume();',
    '  process.stdin.on("data", () => undefined);',
    '  process.stdin.on("end", () => {',
    "    const i = args.indexOf('--output-last-message');",
    '    if (config.lastMessage !== null && i >= 0) fs.writeFileSync(args[i + 1], config.lastMessage);',
    "    salir(config.runLines.map((l) => l + os.EOL).join(''), config.runCode);",
    '  });',
    '}',
  ].join('\n');
}

let carpeta = '';
let contador = 0;

/** instala el script como el ejecutable `nombre` para todo este archivo */
function instalar(nombre: string, cambios: Partial<ComportamientoFalso>): void {
  contador += 1;
  const ruta = join(carpeta, `${nombre}-${contador}.cjs`);
  writeFileSync(ruta, guionFalso({ ...BASE, ...cambios }), 'utf8');
  // la resolucion de ejecutables ya cachea por nombre: se le da la respuesta
  // hecha, con node delante, igual que hace con un shim .cmd que apunta a un .js
  setCachedResolution(nombre, { command: process.execPath, prefixArgs: [ruta], source: ruta });
}

beforeAll(() => {
  carpeta = mkdtempSync(join(tmpdir(), 'luxy-cli-falso-'));
  process.env['LUXY_SONDA_FUERA_DE_LISTA'] = '1';
});

afterEach(() => {
  clearResolutionCache();
});

afterAll(() => {
  delete process.env['LUXY_SONDA_FUERA_DE_LISTA'];
  rmSync(carpeta, { recursive: true, force: true });
});

/** una peticion de turno de solo lectura, como la de la boveda */
function peticion(eventos: ProviderStreamEvent[]): ProviderRunRequest {
  return {
    prompt: 'un prompt privado que no debe salir',
    workingDirectory: carpeta,
    timeoutMs: 30_000,
    signal: new AbortController().signal,
    readOnly: true,
    interactionMode: 'conversation',
    onEvent: (evento) => eventos.push(evento),
  };
}

const PROCESO_LENTO = 60_000;

describe('consulta de sesion con un ejecutable falso', () => {
  it(
    'sin sesion da false, aunque el CLI salga con 1',
    async () => {
      instalar('claude-sonda', {});
      await expect(probeClaudeAuth('claude-sonda')).resolves.toBe(false);
    },
    PROCESO_LENTO,
  );

  it(
    'va con el entorno restringido: una variable fuera de la lista no llega',
    async () => {
      // el falso contesta «con sesion» si ve la variable; false demuestra que
      // no la vio
      instalar('claude-sonda', { authStdout: JSON.stringify({ loggedIn: false }) });
      await expect(probeClaudeAuth('claude-sonda')).resolves.toBe(false);
    },
    PROCESO_LENTO,
  );

  it(
    'con sesion da true',
    async () => {
      instalar('claude-sonda', { authStdout: JSON.stringify({ loggedIn: true }), authCode: 0 });
      await expect(probeClaudeAuth('claude-sonda')).resolves.toBe(true);
    },
    PROCESO_LENTO,
  );

  it(
    'una version sin el subcomando es desconocido y no se le pregunta',
    async () => {
      // si se lanzara `auth status --json`, contestaria false: null prueba que no
      instalar('claude-sonda', { subHelp: {} });
      await expect(probeClaudeAuth('claude-sonda')).resolves.toBeNull();
    },
    PROCESO_LENTO,
  );

  it(
    'si tarda, es desconocido y no espera mas de su tope',
    async () => {
      instalar('claude-sonda', { authHang: true });
      const inicio = Date.now();
      // el tope cubre tambien la ayuda, que tiene que arrancar node: holgado
      await expect(probeClaudeAuth('claude-sonda', 4_000)).resolves.toBeNull();
      expect(Date.now() - inicio).toBeLessThan(PROCESO_LENTO);
    },
    PROCESO_LENTO,
  );

  it(
    'una salida que no es JSON es desconocido',
    async () => {
      instalar('claude-sonda', { authStdout: 'no se', authCode: 1 });
      await expect(probeClaudeAuth('claude-sonda')).resolves.toBeNull();
    },
    PROCESO_LENTO,
  );
});

describe('ClaudeCodeProvider con un ejecutable falso', () => {
  it(
    'sin sesion sigue disponible y lo dice como dato',
    async () => {
      instalar('claude', {});
      const proveedor = new ClaudeCodeProvider();
      const presencia = await proveedor.detect();
      expect(presencia.available).toBe(true);
      expect(proveedor.getAuthenticated()).toBe(false);
    },
    PROCESO_LENTO,
  );

  it(
    'una version sin la consulta deja la sesion como desconocida',
    async () => {
      instalar('claude', { subHelp: {} });
      const proveedor = new ClaudeCodeProvider();
      expect((await proveedor.detect()).available).toBe(true);
      expect(proveedor.getAuthenticated()).toBeNull();
    },
    PROCESO_LENTO,
  );

  for (const codigo of [1, 0]) {
    it(
      `sin sesion y codigo ${codigo}: fallo de verdad, sin texto y con motivo auth`,
      async () => {
        instalar('claude', { runLines: SIN_SESION, runCode: codigo });
        const eventos: ProviderStreamEvent[] = [];
        const resultado = await new ClaudeCodeProvider().run(peticion(eventos));

        expect(resultado.ok).toBe(false);
        expect(resultado.finalText).toBe('');
        expect(resultado.failureReason).toBe('auth');
        expect(resultado.errorMessage).toBe(CLAUDE_AUTH_MESSAGE);
        expect(resultado.exitCode).toBe(codigo);
        // ni como respuesta, ni como mensaje, ni como progreso
        expect(JSON.stringify({ resultado, eventos })).not.toContain('TEXTO-DEL-CLI');
      },
      PROCESO_LENTO,
    );
  }

  it(
    'una respuesta normal sigue funcionando igual',
    async () => {
      instalar('claude', { runLines: NORMAL, runCode: 0 });
      const resultado = await new ClaudeCodeProvider().run(peticion([]));
      expect(resultado.ok).toBe(true);
      expect(resultado.finalText).toBe(RESPUESTA);
      expect(resultado.sessionId).toBe(SESION);
      expect(resultado.failureReason).toBeUndefined();
    },
    PROCESO_LENTO,
  );
});

describe('CodexCliProvider con un ejecutable falso', () => {
  const ERROR_CODEX = [
    JSON.stringify({ type: 'thread.started', thread_id: 'hilo-sintetico' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'error', message: TEXTO_DEL_CLI }),
    JSON.stringify({ type: 'turn.failed', error: { message: TEXTO_DEL_CLI } }),
  ];
  const codex = { help: 'Usage: codex [OPTIONS]', subHelp: { exec: AYUDA_CODEX_EXEC } };

  for (const codigo of [1, 0]) {
    it(
      `un error del CLI con codigo ${codigo} es un fallo sin texto, no una respuesta`,
      async () => {
        instalar('codex', { ...codex, runLines: ERROR_CODEX, runCode: codigo });
        const eventos: ProviderStreamEvent[] = [];
        const resultado = await new CodexCliProvider().run(peticion(eventos));

        expect(resultado.ok).toBe(false);
        expect(resultado.finalText).toBe('');
        expect(resultado.failureReason).toBe('api_error');
        expect(JSON.stringify({ resultado, eventos })).not.toContain('TEXTO-DEL-CLI');
      },
      PROCESO_LENTO,
    );
  }

  it(
    'un codigo distinto de 0 sin evento de error es exit_code',
    async () => {
      instalar('codex', { ...codex, runLines: [], runCode: 2 });
      const resultado = await new CodexCliProvider().run(peticion([]));
      expect(resultado.ok).toBe(false);
      expect(resultado.failureReason).toBe('exit_code');
    },
    PROCESO_LENTO,
  );

  it(
    'una respuesta normal sigue llegando por el archivo del ultimo mensaje',
    async () => {
      instalar('codex', {
        ...codex,
        runLines: [JSON.stringify({ type: 'turn.completed' })],
        runCode: 0,
        lastMessage: RESPUESTA,
      });
      const resultado = await new CodexCliProvider().run(peticion([]));
      expect(resultado.ok).toBe(true);
      expect(resultado.finalText).toBe(RESPUESTA);
      expect(resultado.failureReason).toBeUndefined();
    },
    PROCESO_LENTO,
  );

  // decimotercera ronda: Codex no dice con un codigo por que fallo un turno, y
  // sin sesion salia como `api_error` o `exit_code`. La espera del trabajo de
  // fondo lo tomaba por un fallo de UNA conversacion y acababa saltando la
  // activa, en vez de esperar al CLI entero y pedir que se iniciara sesion
  const conConsulta = {
    ...codex,
    subHelp: { ...codex.subHelp, 'login status': AYUDA_CODEX_LOGIN_STATUS },
  };

  for (const [lineas, codigo] of [
    [ERROR_CODEX, 1],
    [[], 2],
  ] as const) {
    it(
      `sin sesion es auth, con su mensaje (${lineas.length > 0 ? 'evento de error' : 'codigo ' + codigo})`,
      async () => {
        instalar('codex', { ...conConsulta, runLines: [...lineas], runCode: codigo, loginCode: 1 });
        const eventos: ProviderStreamEvent[] = [];
        const resultado = await new CodexCliProvider().run(peticion(eventos));

        expect(resultado.ok).toBe(false);
        expect(resultado.finalText).toBe('');
        expect(resultado.failureReason).toBe('auth');
        expect(resultado.errorMessage).toBe(CODEX_AUTH_MESSAGE);
        expect(JSON.stringify({ resultado, eventos })).not.toContain('TEXTO-DEL-CLI');
      },
      PROCESO_LENTO,
    );
  }

  it(
    'con sesion, el fallo sigue siendo el que era',
    async () => {
      instalar('codex', { ...conConsulta, runLines: ERROR_CODEX, runCode: 1, loginCode: 0 });
      const resultado = await new CodexCliProvider().run(peticion([]));
      expect(resultado.failureReason).toBe('api_error');
    },
    PROCESO_LENTO,
  );

  it(
    'una respuesta normal no pregunta por la sesion',
    async () => {
      let preguntas = 0;
      instalar('codex', {
        ...conConsulta,
        runLines: [JSON.stringify({ type: 'turn.completed' })],
        runCode: 0,
        lastMessage: RESPUESTA,
        loginCode: 1,
      });
      const resultado = await new CodexCliProvider(undefined, {
        probeAuth: async () => {
          preguntas += 1;
          return false;
        },
      }).run(peticion([]));
      expect(resultado.ok).toBe(true);
      expect(preguntas).toBe(0);
    },
    PROCESO_LENTO,
  );
});

describe('consulta de sesion de Codex', () => {
  it('reconoce la ayuda del subcomando, y solo esa', () => {
    expect(codexLoginStatusSupported(AYUDA_CODEX_LOGIN_STATUS)).toBe(true);
    // una version sin `status`: lanzarlo podria acabar en `codex login`
    expect(codexLoginStatusSupported('Usage: codex login [OPTIONS] [COMMAND]')).toBe(false);
    expect(codexLoginStatusSupported(null)).toBe(false);
  });

  it(
    'sin sesion da false; con ella, true',
    async () => {
      const ayuda = { subHelp: { 'login status': AYUDA_CODEX_LOGIN_STATUS } };
      instalar('codex-sonda', { ...ayuda, loginCode: 1 });
      await expect(probeCodexAuth('codex-sonda')).resolves.toBe(false);
      instalar('codex-sonda', { ...ayuda, loginCode: 0 });
      await expect(probeCodexAuth('codex-sonda')).resolves.toBe(true);
    },
    PROCESO_LENTO,
  );

  it(
    'va con el entorno restringido: una variable fuera de la lista no llega',
    async () => {
      // el falso sale con 0 si ve la variable; false demuestra que no la vio
      instalar('codex-sonda', {
        subHelp: { 'login status': AYUDA_CODEX_LOGIN_STATUS },
        loginCode: 1,
      });
      await expect(probeCodexAuth('codex-sonda')).resolves.toBe(false);
    },
    PROCESO_LENTO,
  );

  it(
    'una version sin el subcomando es desconocido y no se le pregunta',
    async () => {
      // si se lanzara `login status`, saldria con 1 y daria false
      instalar('codex-sonda', { subHelp: {}, help: 'Usage: codex [OPTIONS]', loginCode: 1 });
      await expect(probeCodexAuth('codex-sonda')).resolves.toBeNull();
    },
    PROCESO_LENTO,
  );
});

// -----------------------------------------------------------------------------
// el camino entero: proveedor real, ejecutable falso, turno privado
// -----------------------------------------------------------------------------

function configuracion(): AgentConfig {
  return agentConfigSchema.parse({
    machineName: 'equipo-de-pruebas',
    gatewayUrl: 'https://gateway.example',
    machineToken: 'x'.repeat(32),
    projects: {
      privado: { path: carpeta, type: 'other', allowEdits: false },
    },
  });
}

interface Linea {
  nivel: string;
  message: string;
  fields: Record<string, unknown>;
}

function registroEspia(lineas: Linea[]): AgentLogger {
  const anotar =
    (nivel: string) =>
    (message: string, fields: Record<string, unknown> = {}): void => {
      lineas.push({ nivel, message, fields });
    };
  return {
    info: anotar('info'),
    warn: anotar('warn'),
    error: anotar('error'),
    debug: anotar('debug'),
  } as unknown as AgentLogger;
}

describe('turno privado con Claude sin sesion', () => {
  const TURNO = '66666666-6666-4666-8666-666666666666';

  async function turno(cambios: Partial<ComportamientoFalso>, lineas: Linea[], progreso: string[]) {
    instalar('claude', cambios);
    const proveedor = new ClaudeCodeProvider();
    return runLocalTurn(
      {
        localTurnId: TURNO,
        provider: 'claude',
        model: null,
        projectAlias: 'privado',
        prompt: 'un mensaje privado de la boveda',
      },
      new AbortController().signal,
      {
        config: configuracion(),
        logger: registroEspia(lineas),
        getProvider: () => proveedor,
        worktreesDirectory: carpeta,
        apiKeyFor: () => undefined,
        onProgress: (_type, message) => progreso.push(message),
      },
    );
  }

  it(
    'sale failed, sin texto, con motivo auth, y el registro lo dice sin el texto del CLI',
    async () => {
      const lineas: Linea[] = [];
      const progreso: string[] = [];
      const resultado = await turno({ runLines: SIN_SESION, runCode: 1 }, lineas, progreso);

      expect(resultado.outcome).toBe('failed');
      expect(resultado.responseOutcome).toBe('failed');
      expect(resultado.text).toBe('');
      expect(resultado.failureReason).toBe('auth');
      expect(resultado.error).toBe(CLAUDE_AUTH_MESSAGE);
      expect(resultado.memory ?? null).toBeNull();

      const terminado = lineas.find((linea) => linea.message === 'turno privado terminado');
      expect(terminado?.fields['motivoFallo']).toBe('auth');
      expect(terminado?.fields['outcome']).toBe('failed');

      // lo importante es lo que NO aparece en ningun sitio
      const todo = JSON.stringify({ resultado, lineas, progreso });
      expect(todo).not.toContain('TEXTO-DEL-CLI');
      expect(todo).not.toContain('un mensaje privado de la boveda');
    },
    PROCESO_LENTO,
  );

  it(
    'el motivo sobrevive al protocolo del host hacia Studio',
    async () => {
      const resultado = await turno({ runLines: SIN_SESION, runCode: 1 }, [], []);
      const mensaje = hostResponseSchema.parse({
        type: 'local_turn',
        requestId: 'r1',
        localTurnId: TURNO,
        outcome: resultado.outcome,
        text: resultado.text,
        error: resultado.error,
        executedModel: resultado.executedModel,
        durationMs: resultado.durationMs,
        inputTokens: resultado.inputTokens,
        outputTokens: resultado.outputTokens,
        failureReason: resultado.failureReason ?? null,
      });
      expect(mensaje.type === 'local_turn' && mensaje.failureReason).toBe('auth');
    },
    PROCESO_LENTO,
  );

  it(
    'una respuesta normal sigue saliendo completada y sin motivo',
    async () => {
      const lineas: Linea[] = [];
      const resultado = await turno({ runLines: NORMAL, runCode: 0 }, lineas, []);
      expect(resultado.outcome).toBe('completed');
      expect(resultado.responseOutcome).toBe('completed');
      expect(resultado.text).toContain(RESPUESTA);
      expect(resultado.failureReason ?? null).toBeNull();
      const terminado = lineas.find((linea) => linea.message === 'turno privado terminado');
      expect(terminado?.fields['motivoFallo']).toBeNull();
    },
    PROCESO_LENTO,
  );
});

// -----------------------------------------------------------------------------
// duodecima ronda: un final que «sale bien» pero vacio tampoco es una respuesta
// -----------------------------------------------------------------------------

/** un `assistant` que solo trae razonamiento: ningun bloque de texto */
function soloRazonamiento(): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'PENSAMIENTO-INVENTADO', signature: 'firma' }],
    },
    session_id: SESION,
  });
}

/**
 * la rama del CLI que reintenta una vez un final solo de razonamiento y despues
 * lo deja pasar: el `result` sale con `subtype: "success"`, SIN `is_error`, con
 * `result: ""` y codigo 0. Sintetico, con la forma de esa rama
 */
const SOLO_RAZONAMIENTO = [
  INIT,
  soloRazonamiento(),
  JSON.stringify({
    type: 'user',
    isMeta: true,
    message: { role: 'user', content: [{ type: 'text', text: 'AVISO-INVENTADO: sigue' }] },
    session_id: SESION,
  }),
  soloRazonamiento(),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '',
    session_id: SESION,
    num_turns: 2,
  }),
];

/** Codex con `--json` que acaba bien sin ningun mensaje del agente */
const CODEX_SIN_MENSAJE = [
  JSON.stringify({ type: 'thread.started', thread_id: 'hilo-sintetico' }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 0 } }),
];

describe('un final vacio que el CLI da por bueno', () => {
  const TURNO = '77777777-7777-4777-8777-777777777777';
  const codex = { help: 'Usage: codex [OPTIONS]', subHelp: { exec: AYUDA_CODEX_EXEC } };

  async function turnoCon(
    proveedor: 'claude' | 'codex',
    cambios: Partial<ComportamientoFalso>,
    kind: 'conversation' | 'technical' | undefined,
    lineas: Linea[],
  ) {
    instalar(proveedor, cambios);
    const ejecutor = proveedor === 'claude' ? new ClaudeCodeProvider() : new CodexCliProvider();
    return runLocalTurn(
      {
        localTurnId: TURNO,
        provider: proveedor,
        model: null,
        projectAlias: 'privado',
        prompt: 'un mensaje privado de la boveda',
        ...(kind === undefined ? {} : { kind }),
      },
      new AbortController().signal,
      {
        config: configuracion(),
        logger: registroEspia(lineas),
        getProvider: () => ejecutor,
        worktreesDirectory: carpeta,
        apiKeyFor: () => undefined,
        onProgress: () => undefined,
      },
    );
  }

  it('Claude solo con razonamiento: el proceso sale bien y sin texto', () => {
    // es la salida que el CLI da por buena: lo que la convierte en fallo es
    // que una conversacion sin nada visible no es una respuesta
    const estado = leer(SOLO_RAZONAMIENTO);
    expect(estado.failed).toBe(false);
    expect(estado.finalText).toBe('');
    expect(classifyClaudeExit(estado, 0)).toBeNull();
  });

  for (const kind of [undefined, 'technical'] as const) {
    it(
      `Claude solo con razonamiento (${kind ?? 'turno privado'}): failed, sin frase de relleno`,
      async () => {
        const lineas: Linea[] = [];
        const resultado = await turnoCon(
          'claude',
          { runLines: SOLO_RAZONAMIENTO, runCode: 0 },
          kind,
          lineas,
        );

        expect(resultado.outcome).toBe('failed');
        expect(resultado.responseOutcome).toBe('failed');
        expect(resultado.text).toBe('');
        expect(resultado.error).toBe(EMPTY_CONVERSATION_REPLY_MESSAGE);
        // sin motivo estructurado: no lo dijo el CLI
        expect(resultado.failureReason ?? null).toBeNull();
        expect(resultado.memory ?? null).toBeNull();
        // la frase que antes se guardaba como respuesta del personaje y que los
        // trabajos de fondo contaban como negativa
        expect(JSON.stringify(resultado)).not.toContain('no devolvio resumen');
        const terminado = lineas.find((linea) => linea.message === 'turno privado terminado');
        expect(terminado?.fields['outcome']).toBe('failed');
        expect(JSON.stringify({ resultado, lineas })).not.toContain('PENSAMIENTO-INVENTADO');
      },
      PROCESO_LENTO,
    );
  }

  it(
    'Codex con --json y sin mensaje final: la cola del JSONL no es una respuesta',
    async () => {
      instalar('codex', { ...codex, runLines: CODEX_SIN_MENSAJE, runCode: 0, lastMessage: null });
      const resultado = await new CodexCliProvider().run(peticion([]));
      expect(resultado.finalText).toBe('');
      expect(resultado.finalText).not.toContain('turn.completed');
    },
    PROCESO_LENTO,
  );

  it(
    'Codex con --json y sin mensaje final, en un turno tecnico: failed',
    async () => {
      const resultado = await turnoCon(
        'codex',
        { ...codex, runLines: CODEX_SIN_MENSAJE, runCode: 0, lastMessage: null },
        'technical',
        [],
      );
      expect(resultado.outcome).toBe('failed');
      expect(resultado.text).toBe('');
      expect(resultado.error).toBe(EMPTY_CONVERSATION_REPLY_MESSAGE);
      expect(JSON.stringify(resultado)).not.toContain('thread.started');
    },
    PROCESO_LENTO,
  );

  it(
    'una respuesta normal de Codex sigue completada',
    async () => {
      const resultado = await turnoCon(
        'codex',
        {
          ...codex,
          runLines: [JSON.stringify({ type: 'turn.completed' })],
          runCode: 0,
          lastMessage: RESPUESTA,
        },
        'technical',
        [],
      );
      expect(resultado.outcome).toBe('completed');
      expect(resultado.text).toContain(RESPUESTA);
    },
    PROCESO_LENTO,
  );
});
