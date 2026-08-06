// matriz de regresion del final de una respuesta (P0.4).
//
// POR QUE EXISTE: los trece casos que pueden terminar una respuesta estaban
// probados, pero repartidos entre `sse.test.ts`, `providers.test.ts`,
// `conversation-memory.test.ts` y `response-outcome.test.ts`. Repartidos no se
// pueden leer como lo que son: una tabla en la que cada fila debe seguir
// dando el mismo final. Si manana alguien toca el cierre del transporte, aqui
// se ve de un vistazo que fila cambio de color.
//
// Cada fila usa el CODIGO REAL del transporte: el flujo pasa por `sseData` y
// `TurnAssembler`, y de ahi sale el diagnostico que clasifica
// `classifyResponseOutcome`. No se inventan terminaciones a mano, porque
// entonces la prueba solo comprobaria que el clasificador es coherente consigo
// mismo.
//
// Sin red, sin proveedor y sin tokens.
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentConfigSchema,
  classifyResponseOutcome,
  isRecoverableOutcome,
  looksLikeCode,
  parseConversationMemoryResponse,
  CONVERSATION_MEMORY_CLOSE,
  CONVERSATION_MEMORY_OPEN,
} from '@luxy/shared';
import type {
  ClaimedJob,
  ProviderExecution,
  ProviderRunRequest,
  ResponseOutcome,
  ResponseTermination,
} from '@luxy/shared';
import { sseData, TurnAssembler, type SseTransportReport } from './providers/sse.js';
import { runJob } from './job-runner.js';

/** convierte texto en un cuerpo de respuesta, troceado como se pida */
function flujo(texto: string, tamanoChunk = 1024): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(texto);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + tamanoChunk));
      offset += tamanoChunk;
    },
  });
}

/** cuerpo que se cae a mitad de la lectura, como un socket que se corta */
function flujoRoto(texto: string): ReadableStream<Uint8Array> {
  let entregado = false;
  return new ReadableStream({
    pull(controller) {
      if (entregado) {
        controller.error(new Error('socket cerrado por el otro extremo'));
        return;
      }
      entregado = true;
      controller.enqueue(new TextEncoder().encode(texto));
    },
  });
}

interface Recorrido {
  texto: string;
  finishReason: string | null;
  finalUsageReceived: boolean;
  reporte: SseTransportReport;
}

/**
 * pasa un cuerpo por el transporte de verdad y devuelve lo observado.
 *
 * `isTerminal` e `isSoftTerminal` se conectan igual que en el proveedor HTTP:
 * la señal fuerte es `finish_reason` y la debil es el `usage` final sin
 * `choices`. Cambiar eso aqui invalidaria la matriz entera.
 */
async function recorrer(
  body: ReadableStream<Uint8Array>,
  opciones: { terminalGraceMs?: number; softTerminalGraceMs?: number } = {},
): Promise<Recorrido> {
  const assembler = new TurnAssembler();
  let reporte: SseTransportReport = {
    transportEnd: 'body_closed',
    chunks: 0,
    bytes: 0,
    durationMs: 0,
  };

  const iterador = sseData(body, {
    isTerminal: () => assembler.result().finishReason !== null,
    isSoftTerminal: () => assembler.result().finalUsageReceived,
    terminalGraceMs: opciones.terminalGraceMs ?? 5,
    softTerminalGraceMs: opciones.softTerminalGraceMs ?? 40,
    onTransportEnd: (informe) => {
      reporte = informe;
    },
  });

  try {
    for await (const payload of iterador) assembler.push(payload);
  } catch {
    // un socket caido llega hasta aqui; el diagnostico ya quedo en el reporte
  }

  const turno = assembler.result();
  return {
    texto: turno.text,
    finishReason: turno.finishReason,
    finalUsageReceived: turno.finalUsageReceived,
    reporte,
  };
}

/** compone el diagnostico tal y como lo arma el proveedor HTTP */
function terminacion(
  recorrido: Recorrido,
  extra: Partial<ResponseTermination> = {},
): ResponseTermination {
  return {
    httpStatus: 200,
    streamed: true,
    chunks: recorrido.reporte.chunks,
    bytes: recorrido.reporte.bytes,
    durationMs: recorrido.reporte.durationMs,
    transportEnd: recorrido.reporte.transportEnd,
    finishReason: recorrido.finishReason,
    finalUsageReceived: recorrido.finalUsageReceived,
    abortedBy: null,
    effectiveTimeoutMs: 3_600_000,
    maxOutputTokens: 8192,
    inputTokens: 0,
    outputTokens: 0,
    textLength: recorrido.texto.length,
    ...extra,
  };
}

function delta(contenido: string, finishReason?: string): string {
  const choice: Record<string, unknown> = { delta: { content: contenido } };
  if (finishReason !== undefined) choice.finish_reason = finishReason;
  return `data: ${JSON.stringify({ choices: [choice] })}\n`;
}

const USAGE_FINAL = `data: ${JSON.stringify({
  choices: [],
  usage: { prompt_tokens: 120, completion_tokens: 900 },
})}\n`;

// ---------------------------------------------------------------------------
// casos 1 a 9: transporte -> diagnostico -> final
// ---------------------------------------------------------------------------

interface CasoTransporte {
  numero: number;
  nombre: string;
  cuerpo: () => ReadableStream<Uint8Array>;
  /** lo que el proveedor añade por su cuenta: aborto, http distinto de 200... */
  extra?: Partial<ResponseTermination>;
  fallo?: boolean;
  esperado: ResponseOutcome;
  /** el final debe conservar texto para poder continuarlo */
  conservaTexto: boolean;
}

const CASOS_TRANSPORTE: CasoTransporte[] = [
  {
    numero: 1,
    nombre: '[DONE] normal',
    cuerpo: () => flujo(`${delta('una respuesta entera')}data: [DONE]\n`),
    esperado: 'completed',
    conservaTexto: true,
  },
  {
    numero: 2,
    nombre: 'finish_reason: stop con el socket todavia abierto',
    // el proveedor dice que termino pero no manda [DONE] ni cierra: sin cierre
    // local el trabajo se quedaria en "Respondiendo" para siempre
    cuerpo: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(delta('listo', 'stop')));
          // nunca se cierra a proposito
        },
      }),
    esperado: 'completed',
    conservaTexto: true,
  },
  {
    numero: 3,
    nombre: 'usage final sin choices y el socket abierto',
    // señal DEBIL: hay endpoints que mandan usage a mitad de la respuesta, asi
    // que exige mucho mas silencio antes de cerrar
    cuerpo: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(delta('parte visible')));
          controller.enqueue(new TextEncoder().encode(USAGE_FINAL));
        },
      }),
    esperado: 'completed',
    conservaTexto: true,
  },
  {
    numero: 4,
    nombre: 'ultimo JSON sin salto de linea final',
    cuerpo: () =>
      flujo(
        `${delta('primero')}data: ${JSON.stringify({ choices: [{ delta: { content: ' y ultimo' } }] })}`,
      ),
    esperado: 'completed',
    conservaTexto: true,
  },
  {
    numero: 5,
    nombre: 'cierre HTTP normal sin [DONE]',
    cuerpo: () => flujo(delta('respuesta sin marcador')),
    esperado: 'completed',
    conservaTexto: true,
  },
  {
    numero: 6,
    nombre: 'pausa larga y despues mas bytes: no se corta',
    // el caso que corto una web por la mitad. Lo que autoriza a cerrar es el
    // SILENCIO tras la señal debil, no el reloj mientras siguen llegando datos
    cuerpo: () =>
      new ReadableStream({
        async pull(controller) {
          controller.enqueue(new TextEncoder().encode(delta('antes de la pausa')));
          controller.enqueue(new TextEncoder().encode(USAGE_FINAL));
          await new Promise((resolve) => setTimeout(resolve, 25));
          controller.enqueue(new TextEncoder().encode(delta(' despues de la pausa')));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
          controller.close();
        },
      }),
    esperado: 'completed',
    conservaTexto: true,
  },
  {
    numero: 7,
    nombre: 'finish_reason: length con texto parcial',
    cuerpo: () => flujo(`${delta('<html><body>a medio escri', 'length')}data: [DONE]\n`),
    esperado: 'truncated',
    conservaTexto: true,
  },
  {
    numero: 8,
    nombre: 'AbortError por timeout con texto parcial',
    cuerpo: () => flujo(delta('lo que dio tiempo a escribir')),
    extra: { transportEnd: 'aborted', abortedBy: 'request_timeout' },
    fallo: true,
    esperado: 'timed_out',
    conservaTexto: true,
  },
  {
    numero: 9,
    nombre: 'error de lectura del socket con texto parcial',
    cuerpo: () => flujoRoto(delta('llego hasta aqui')),
    fallo: true,
    esperado: 'interrupted',
    conservaTexto: true,
  },
];

describe('matriz de finales de respuesta — transporte', () => {
  for (const caso of CASOS_TRANSPORTE) {
    it(`caso ${caso.numero}: ${caso.nombre} → ${caso.esperado}`, async () => {
      const recorrido = await recorrer(caso.cuerpo());
      const diagnostico = terminacion(recorrido, caso.extra ?? {});

      const final = classifyResponseOutcome({
        termination: diagnostico,
        cancelled: false,
        failed: caso.fallo === true,
        textLength: recorrido.texto.length,
      });

      expect(final).toBe(caso.esperado);
      if (caso.conservaTexto) expect(recorrido.texto.length).toBeGreaterThan(0);
    });
  }

  it('caso 6: la pausa no pierde el texto posterior', async () => {
    const caso = CASOS_TRANSPORTE.find((entrada) => entrada.numero === 6);
    const recorrido = await recorrer(caso!.cuerpo());
    // si el cierre debil se ejecutara con el reloj en vez de con el silencio,
    // esta segunda mitad no estaria
    expect(recorrido.texto).toContain('despues de la pausa');
  });

  it('solo truncated, interrupted y timed_out ofrecen continuar', () => {
    const recuperables = CASOS_TRANSPORTE.filter((caso) => isRecoverableOutcome(caso.esperado));
    expect(recuperables.map((caso) => caso.numero)).toEqual([7, 8, 9]);
  });
});

// ---------------------------------------------------------------------------
// caso 10: cancelacion manual, de punta a punta
// ---------------------------------------------------------------------------

function trabajoDeConversacion(): ClaimedJob {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    shortId: 'LUX-STOP',
    origin: 'studio',
    provider: 'codex',
    model: null,
    projectAlias: 'demo',
    prompt: 'Usuario:\nGenerame una web larga\n\nAsistente:',
    telegramChatId: null,
    telegramUserId: null,
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    metadata: { studioMode: 'conversation' },
  };
}

describe('matriz de finales de respuesta — caso 10: cancelacion manual', () => {
  it('conserva lo emitido, marca cancelled y no ejecuta comprobaciones', async () => {
    const root = mkdtempSync(join(tmpdir(), 'luxy-matriz-'));
    try {
      const projectPath = join(root, 'proyecto');
      const worktreesPath = join(root, 'worktrees');
      mkdirSync(projectPath);
      mkdirSync(worktreesPath);

      const abort = new AbortController();
      const provider: ProviderExecution = {
        id: 'codex',
        displayName: 'Codex simulado',
        detect: vi.fn(async () => ({ available: true, version: 'test', path: 'codex' })),
        run: vi.fn(async (request: ProviderRunRequest) => {
          request.onEvent({ type: 'text', message: '<html><body>lo que dio tiempo' });
          // Daniel pulsa Detener aqui: el proveedor deja de escribir y devuelve
          // lo generado con cancelled, que es como se comporta el real
          abort.abort();
          return {
            ok: false,
            finalText: '<html><body>lo que dio tiempo',
            sessionId: null,
            exitCode: null,
            timedOut: false,
            cancelled: true,
            errorMessage: 'cancelado por el usuario',
            termination: {
              httpStatus: 200,
              streamed: true,
              chunks: 3,
              bytes: 512,
              durationMs: 1200,
              transportEnd: 'aborted' as const,
              finishReason: null,
              finalUsageReceived: false,
              abortedBy: 'user' as const,
              effectiveTimeoutMs: 3_600_000,
              maxOutputTokens: 8192,
              inputTokens: 40,
              outputTokens: 300,
              textLength: 29,
            },
          };
        }),
      };

      const config = agentConfigSchema.parse({
        machineName: 'prueba',
        gatewayUrl: 'https://gateway.example',
        machineToken: 'token-de-prueba-suficientemente-largo',
        projects: {
          demo: {
            path: projectPath,
            type: 'other',
            testCommands: [['npm', ['test']]],
            allowHostChecks: true,
            allowEdits: true,
            allowCommit: true,
            allowPush: false,
          },
        },
      });

      const eventos: { type: string; message: string }[] = [];
      const outcome = await runJob(trabajoDeConversacion(), abort.signal, {
        config,
        logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
        getProvider: () => provider,
        emit: (type: string, message: string) => eventos.push({ type, message }),
        worktreesDirectory: worktreesPath,
        downloadAttachment: vi.fn(async () => Buffer.alloc(0)),
        apiKeyFor: () => undefined,
      });

      // 1. el final es cancelacion, no fallo: lo pidio una persona
      expect(outcome.kind).toBe('cancelled');

      // 2. lo generado antes de parar si llego a Studio como evento
      const emitido = eventos.map((evento) => evento.message).join('\n');
      expect(emitido).toContain('lo que dio tiempo');

      // 3. el diagnostico se emite tambien al cancelar, que es justo cuando
      //    hace falta saber por que se paro
      const diagnostico = eventos.find(
        (evento) => evento.type === 'log' && evento.message.includes('cancelled'),
      );
      expect(diagnostico).toBeDefined();
      expect(diagnostico?.message).toContain('final=aborted');

      // 4. una conversacion cancelada no ejecuta pruebas ni toca el proyecto
      expect(emitido).not.toContain('npm test');
      if (outcome.kind === 'cancelled') expect(outcome.worktreePath).toBeNull();

      // 5. `P0.6d`: lo generado se conserva en el resultado, no solo en un
      //    evento. Pulsar Detener no puede costar la generacion entera.
      if (outcome.kind === 'cancelled') {
        expect(outcome.partialText).toContain('lo que dio tiempo');
        expect(outcome.responseTermination?.abortedBy).toBe('user');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('la cancelacion manda sobre cualquier diagnostico del transporte', () => {
    // aunque el transporte diga "length", si el usuario pulso Detener el final
    // es cancelled: no se le atribuye al modelo algo que hizo una persona
    const final = classifyResponseOutcome({
      termination: terminacion(
        {
          texto: 'parcial',
          finishReason: 'length',
          finalUsageReceived: false,
          reporte: { transportEnd: 'aborted', chunks: 1, bytes: 10, durationMs: 5 },
        },
        { abortedBy: 'user' },
      ),
      cancelled: true,
      failed: true,
      textLength: 7,
    });
    expect(final).toBe('cancelled');
    // y cancelled no ofrece continuar: no hay nada roto que reparar
    expect(isRecoverableOutcome(final)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// casos 11 a 13: la memoria estructurada
// ---------------------------------------------------------------------------

const MEMORIA_VALIDA = {
  version: 1,
  summary: 'Daniel quiere una web de una pagina para el restaurante.',
  facts: ['El restaurante se llama Luxy.'],
  decisions: ['Se usa una sola pagina sin framework.'],
  plan: ['Escribir la seccion de contacto.'],
  openQuestions: [],
  lessons: [],
};

function conBloque(visible: string, bloque: string): string {
  return [visible, CONVERSATION_MEMORY_OPEN, bloque, CONVERSATION_MEMORY_CLOSE].join('\n');
}

describe('matriz de finales de respuesta — memoria', () => {
  it('caso 11: bloque completo y valido sustituye la memoria anterior', () => {
    const parsed = parseConversationMemoryResponse(
      conBloque('Aqui tienes la web.', JSON.stringify(MEMORIA_VALIDA)),
    );
    expect(parsed.status).toBe('structured');
    expect(parsed.memory?.summary).toBe(MEMORIA_VALIDA.summary);
    // el bloque no puede quedarse en lo que ve Daniel
    expect(parsed.visibleText).toBe('Aqui tienes la web.');
    expect(parsed.visibleText).not.toContain(CONVERSATION_MEMORY_OPEN);
  });

  it('caso 12a: bloque ausente conserva la memoria anterior', () => {
    const parsed = parseConversationMemoryResponse('Una respuesta normal sin bloque.');
    expect(parsed.status).toBe('absent');
    expect(parsed.memory).toBeNull();
  });

  it('caso 12b: bloque cortado en mitad no sustituye nada', () => {
    // la respuesta se corto dentro del bloque: es exactamente el caso de una
    // generacion truncada, y lo que NO puede hacer es pisar un contexto bueno
    const parsed = parseConversationMemoryResponse(
      `Aqui tienes la web.\n${CONVERSATION_MEMORY_OPEN}\n{"version":1,"summary":"a medio`,
    );
    expect(parsed.status).toBe('truncated_block');
    expect(parsed.memory).toBeNull();
    expect(parsed.visibleText).toBe('Aqui tienes la web.');
  });

  it('caso 12c: bloque malformado no sustituye nada', () => {
    const parsed = parseConversationMemoryResponse(conBloque('Hecho.', '{esto no es json}'));
    expect(parsed.status).not.toBe('structured');
    expect(parsed.memory).toBeNull();
  });

  it('caso 13: una respuesta de HTML/CSS/JS no acaba dentro de la memoria', () => {
    const web = [
      '```html',
      '<!doctype html>',
      '<html><head><style>body { margin: 0; }</style></head>',
      '<body><script>const x = 1;</script></body></html>',
      '```',
    ].join('\n');

    // sin bloque, una respuesta asi conserva la memoria anterior en vez de
    // resumir el codigo: es el fallback que se elimino en P0.3
    const parsed = parseConversationMemoryResponse(web);
    expect(parsed.status).toBe('absent');
    expect(parsed.memory).toBeNull();

    // y si el modelo mete codigo dentro del bloque, se detecta y se rechaza
    expect(looksLikeCode(web)).toBe(true);
    const conCodigo = parseConversationMemoryResponse(
      conBloque('Aqui tienes la web.', JSON.stringify({ ...MEMORIA_VALIDA, summary: web })),
    );
    expect(conCodigo.memory).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// la matriz debe estar entera
// ---------------------------------------------------------------------------

describe('cobertura de la matriz', () => {
  it('los trece casos de P0.4 tienen prueba', () => {
    const transporte = CASOS_TRANSPORTE.map((caso) => caso.numero);
    expect(transporte).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 10 vive en su propio describe porque necesita el trabajo entero;
    // 11, 12 y 13 en el de memoria. Si alguien añade un caso a la matriz de
    // P0.4 y no lo prueba, esta cuenta deja de cuadrar.
    expect(transporte.length + 1 + 3).toBe(13);
  });
});
