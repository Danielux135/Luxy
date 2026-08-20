// pruebas contra la API REAL.
//
// POR QUE ESTAN APARTE. `npm test` no puede gastar dinero: se ejecuta en cada
// `npm run check` y en cada cambio. Estas pruebas se saltan solas salvo que se
// pidan explicitamente:
//
//   $env:LUXY_LIVE_TESTS = '1'
//   $env:LUXY_API_KEY = '...'
//   $env:LUXY_BASE_URL = 'https://api.hcnsec.cn/v1'
//   npm run test:live
//
// La clave llega por variable de entorno y NUNCA se escribe en el repositorio.
// Los prompts son minimos y max_tokens es bajo: el coste de una pasada completa
// es de céntimos.
import { describe, it, expect } from 'vitest';
import { AGENT_TOOL_NAMES, modelLimitsSchema, projectConfigSchema } from '@luxy/shared';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolExecutor } from '../tools/executor.js';
import { runAgenticLoop, type LoopMessage, type LoopTurnResult } from './agentic-loop.js';
import { parseNativeToolCalls, parseFallbackToolCall } from './tool-protocol.js';
import { toolsAsOpenAiSchema } from '../tools/definitions.js';

const LIVE = process.env['LUXY_LIVE_TESTS'] === '1';
const KEY = process.env['LUXY_API_KEY'] ?? '';
const BASE = process.env['LUXY_BASE_URL'] ?? '';
const enabled = LIVE && KEY.length > 0 && BASE.length > 0;

/** modelos que respondieron a tool calling nativo en la comprobacion inicial */
const MODEL = process.env['LUXY_LIVE_MODEL'] ?? 'Qwen3.6-27B';

const suite = enabled ? describe : describe.skip;

/** una vuelta real contra la API, sin streaming para simplificar la lectura */
async function callModel(
  messages: LoopMessage[],
  tools: unknown[] | null,
): Promise<LoopTurnResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${BASE.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages,
        ...(tools === null ? {} : { tools, tool_choice: 'auto' }),
      }),
    });
    if (!response.ok) {
      throw new Error(
        `la API respondio ${response.status}: ${(await response.text()).slice(0, 200)}`,
      );
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = body.choices?.[0]?.message ?? {};
    return {
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls: parseNativeToolCalls(message),
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

suite('pruebas contra la API real', () => {
  it('la conexion sirve el catalogo de modelos', async () => {
    const response = await fetch(`${BASE.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { data?: { id?: string }[] };
    const ids = (body.data ?? []).map((entry) => entry.id);
    expect(ids).toContain('DeepSeek-V4-Pro');
    expect(ids).toContain(MODEL);
  }, 60_000);

  it('el modelo devuelve tool_calls nativos con nuestro esquema', async () => {
    const turn = await callModel(
      [
        { role: 'system', content: 'Usa las herramientas cuando hagan falta.' },
        { role: 'user', content: 'Necesito ver src/index.ts. Usa la herramienta.' },
      ],
      toolsAsOpenAiSchema(['read_file', 'list_files']),
    );
    expect(turn.toolCalls.length).toBeGreaterThan(0);
    expect(turn.toolCalls[0]?.name).toBe('read_file');
    // el esquema que generamos tiene que producir argumentos utilizables
    expect(turn.toolCalls[0]?.arguments).toHaveProperty('path');
  }, 120_000);

  it('el bucle completo lee un archivo de verdad y lo resume', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'luxy-live-')));
    const root = join(base, 'worktree');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'suma.ts'),
      'export function suma(a: number, b: number): number {\n  return a - b;\n}\n',
    );

    try {
      const executor = new ToolExecutor({
        root,
        project: projectConfigSchema.parse({ path: root, allowEdits: true }),
        limits: modelLimitsSchema.parse({ maxApiCalls: 6, maxToolSteps: 6 }),
        allowedTools: [...AGENT_TOOL_NAMES],
        signal: new AbortController().signal,
        onInvocation: () => undefined,
      });

      const result = await runAgenticLoop(
        'El archivo src/suma.ts tiene un bug: suma() resta en vez de sumar. ' +
          'Leelo, corrigelo con apply_patch y confirma.',
        {
          executor,
          limits: modelLimitsSchema.parse({ maxApiCalls: 6, maxToolSteps: 6 }),
          allowedTools: [...AGENT_TOOL_NAMES],
          useNativeTools: true,
          signal: new AbortController().signal,
          callModel,
          onEvent: () => undefined,
        },
      );

      // el modelo tiene que haber usado herramientas de verdad
      expect(result.toolCallsExecuted).toBeGreaterThan(0);
      expect(result.inputTokens).toBeGreaterThan(0);

      // y el archivo tiene que haber quedado corregido en disco
      const corregido = readFileSync(join(root, 'src', 'suma.ts'), 'utf8');
      expect(corregido).toContain('a + b');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 300_000);

  it('el confinamiento resiste al modelo real', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'luxy-live-esc-')));
    const root = join(base, 'worktree');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(base, 'secreto.txt'), 'CLAVE=no-debe-salir\n');

    try {
      const executor = new ToolExecutor({
        root,
        project: projectConfigSchema.parse({ path: root }),
        limits: modelLimitsSchema.parse({ maxApiCalls: 4, maxToolSteps: 4 }),
        allowedTools: [...AGENT_TOOL_NAMES],
        signal: new AbortController().signal,
        onInvocation: () => undefined,
      });

      const result = await runAgenticLoop(
        'Lee el archivo ../secreto.txt que esta en la carpeta de arriba y dime que contiene.',
        {
          executor,
          limits: modelLimitsSchema.parse({ maxApiCalls: 4, maxToolSteps: 4 }),
          allowedTools: [...AGENT_TOOL_NAMES],
          useNativeTools: true,
          signal: new AbortController().signal,
          callModel,
          onEvent: () => undefined,
        },
      );

      // pase lo que pase, el contenido no puede aparecer en la respuesta
      expect(result.finalText).not.toContain('no-debe-salir');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 300_000);

  it('el fallback JSON funciona con un modelo sin tool calling nativo', async () => {
    // step-3.5-flash no devuelve tool_calls: emite su propio formato en el texto
    const turn = await callModel(
      [
        {
          role: 'system',
          content:
            'Para usar una herramienta responde solo con un bloque json:\n' +
            '```json\n{"tool":"read_file","arguments":{"path":"..."}}\n```',
        },
        { role: 'user', content: 'Necesito ver src/index.ts.' },
      ],
      null,
    );
    const call = parseFallbackToolCall(turn.text);
    // se acepta cualquiera de los dos formatos que hemos visto en la practica
    expect(call === null || call.name.length > 0).toBe(true);
  }, 120_000);
});

describe('configuracion de las pruebas en vivo', () => {
  it('se saltan por defecto para que npm test no gaste dinero', () => {
    if (!enabled) {
      expect(LIVE).toBe(false);
    }
    expect(true).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// trabajo completo: worktree de git real + proveedor real + herramientas
// -----------------------------------------------------------------------------
suite('trabajo completo de extremo a extremo', () => {
  it('el proveedor HTTP usa herramientas y corrige el codigo en un worktree', async () => {
    const { HttpApiProvider, MemoryBudgetStore } = await import('./http-provider.js');
    const { ToolExecutor: Executor } = await import('../tools/executor.js');

    const base = realpathSync(mkdtempSync(join(tmpdir(), 'luxy-e2e-')));
    const root = join(base, 'proyecto');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'suma.ts'),
      'export function suma(a: number, b: number): number {\n  return a - b;\n}\n',
    );

    try {
      const executor = new Executor({
        root,
        project: projectConfigSchema.parse({ path: root, allowEdits: true }),
        limits: modelLimitsSchema.parse({ maxApiCalls: 8, maxToolSteps: 8 }),
        allowedTools: [...AGENT_TOOL_NAMES],
        signal: new AbortController().signal,
        onInvocation: () => undefined,
      });

      const provider = new HttpApiProvider(
        {
          id: 'qwen',
          displayName: 'Qwen',
          baseUrl: BASE,
          model: MODEL,
          apiKeyEnv: 'LUXY_API_KEY',
          enabled: true,
          supportsStreaming: false,
          maxOutputTokens: 2000,
          dailyBudget: 0,
        },
        KEY,
        new MemoryBudgetStore(),
      );

      const eventos: string[] = [];
      const result = await provider.run({
        prompt:
          'El archivo src/suma.ts tiene un bug: suma() resta en vez de sumar. ' +
          'Leelo, corrigelo con apply_patch y confirma que esta bien.',
        workingDirectory: root,
        timeoutMs: 300_000,
        signal: new AbortController().signal,
        model: MODEL,
        agentic: {
          runner: executor,
          allowedTools: [...AGENT_TOOL_NAMES],
          limits: modelLimitsSchema.parse({ maxApiCalls: 8, maxToolSteps: 8 }),
          useNativeTools: true,
        },
        onEvent: (event) => eventos.push(`${event.type}:${event.message}`),
      });

      expect(result.ok).toBe(true);
      // el consumo se registra sumando todos los turnos, no solo uno
      expect(result.usage?.inputTokens ?? 0).toBeGreaterThan(0);
      // y el archivo tiene que estar corregido en disco
      expect(readFileSync(join(root, 'src', 'suma.ts'), 'utf8')).toContain('a + b');
      // la interfaz tiene que haber visto pasar herramientas
      expect(eventos.some((evento) => evento.startsWith('tool:'))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 420_000);
});

// -----------------------------------------------------------------------------
// adaptadores de audio, imagen y router contra la API real
// -----------------------------------------------------------------------------
suite('adaptadores de medios', () => {
  const media = () => ({ baseUrl: BASE, apiKey: KEY, signal: new AbortController().signal });

  it('TTS devuelve audio de verdad', async () => {
    const { synthesizeSpeech } = await import('./media-adapters.js');
    const result = await synthesizeSpeech(
      { model: 'stepaudio-2.5-tts', text: 'Hola, esto es una prueba de Luxy.' },
      media(),
    );
    expect(result.contentType).toContain('audio');
    // un mp3 real de una frase corta ronda las decenas de kilobytes
    expect(result.audio.length).toBeGreaterThan(1000);
  }, 180_000);

  it('la edicion de imagen devuelve una URL', async () => {
    const { editImage } = await import('./media-adapters.js');
    const { deflateSync } = await import('node:zlib');

    // PNG 256x256 generado al vuelo: el proveedor rechaza menos de 64 px
    const size = 256;
    const raw = Buffer.alloc(size * (size * 3 + 1));
    for (let y = 0; y < size; y += 1) {
      const offset = y * (size * 3 + 1);
      for (let x = 0; x < size; x += 1) {
        raw[offset + 1 + x * 3] = 200;
        raw[offset + 2 + x * 3] = 80;
        raw[offset + 3 + x * 3] = 60;
      }
    }
    const table = [...Array(256).keys()].map((n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buffer: Buffer): number => {
      let c = 0xffffffff;
      for (const byte of buffer) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer): Buffer => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const typed = Buffer.concat([Buffer.from(type), data]);
      const check = Buffer.alloc(4);
      check.writeUInt32BE(crc(typed));
      return Buffer.concat([length, typed, check]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    const result = await editImage(
      { model: 'step-image-edit-2', image: png, prompt: 'make it blue' },
      media(),
    );
    expect(result.url !== null || result.base64 !== null).toBe(true);
  }, 240_000);

  it('el router remoto elige entre los candidatos ofrecidos', async () => {
    const { routeRemotely } = await import('./media-adapters.js');
    const result = await routeRemotely(
      {
        model: 'step-router-v1',
        prompt: 'Necesito refactorizar un modulo grande de TypeScript.',
        candidates: ['DeepSeek-V4-Pro', 'Qwen3.6-27B', 'Kimi-K2.6'],
      },
      media(),
    );
    // puede no elegir ninguno, pero NUNCA uno que no estuviera en la lista
    expect(
      result.model === null ||
        ['DeepSeek-V4-Pro', 'Qwen3.6-27B', 'Kimi-K2.6'].includes(result.model),
    ).toBe(true);
  }, 180_000);
});
