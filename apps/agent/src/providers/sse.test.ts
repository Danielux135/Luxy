// pruebas del lector de flujos SSE y del ensamblador de una vuelta.
//
// POR QUE EXISTE: el camino agentico (el que lleva herramientas) no transmitia,
// asi que una peticion podia pasar minutos sin enviar un byte y el edge del
// proveedor la cortaba con un 524. Eso paso de verdad.
//
// LO DELICADO son las llamadas a herramientas: el JSON de los argumentos NO
// llega entero. Llega en pedazos que hay que pegar por indice, y un pedazo
// suelto no es JSON valido. Si eso se ensambla mal, el modelo parece pedir una
// herramienta con argumentos corruptos y el fallo es dificil de leer.
import { describe, it, expect } from 'vitest';
import { sseData, TurnAssembler, wasTruncated, type SseTransportReport } from './sse.js';

/** convierte lineas en un ReadableStream, troceado como se pida */
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

async function recoger(texto: string, tamanoChunk?: number): Promise<string[]> {
  const salida: string[] = [];
  for await (const payload of sseData(flujo(texto, tamanoChunk))) salida.push(payload);
  return salida;
}

describe('sseData', () => {
  it('extrae los payloads data:', async () => {
    const payloads = await recoger('data: {"a":1}\ndata: {"a":2}\n');
    expect(payloads).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('para en [DONE] y no devuelve lo que venga despues', async () => {
    const payloads = await recoger('data: {"a":1}\ndata: [DONE]\ndata: {"a":2}\n');
    expect(payloads).toEqual(['{"a":1}']);
  });

  it('ignora los comentarios de keep-alive y las lineas vacias', async () => {
    const payloads = await recoger(': keep-alive\n\ndata: {"a":1}\n\n');
    expect(payloads).toEqual(['{"a":1}']);
  });

  it('acepta CRLF', async () => {
    expect(await recoger('data: {"a":1}\r\ndata: {"a":2}\r\n')).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('recompone una linea partida entre dos chunks de red', async () => {
    // esto es lo que rompe los parsers ingenuos: un chunk NO respeta los
    // limites de linea, asi que "data: {"cont" puede llegar solo
    const payloads = await recoger('data: {"choices":[{"delta":{"content":"hola"}}]}\n', 7);
    expect(payloads).toEqual(['{"choices":[{"delta":{"content":"hola"}}]}']);
  });

  it('no pierde la ultima linea si el flujo no acaba en salto', async () => {
    expect(await recoger('data: {"a":1}')).toEqual(['{"a":1}']);
  });

  it('no se queda colgado si el proveedor termina pero omite [DONE]', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"listo"},"finish_reason":"stop"}]}\n',
          ),
        );
        // reproduce el socket que Kimi deja abierto despues del ultimo evento
      },
      cancel() {
        cancelled = true;
      },
    });
    const assembler = new TurnAssembler();

    for await (const payload of sseData(body, {
      isTerminal: () => assembler.result().finishReason !== null,
      terminalGraceMs: 10,
    })) {
      assembler.push(payload);
    }

    expect(assembler.result()).toMatchObject({ text: 'listo', finishReason: 'stop' });
    expect(cancelled).toBe(true);
  });

  it('reconoce finish_reason aunque la ultima linea no tenga salto ni cierre de socket', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"listo"},"finish_reason":"stop"}]}',
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const assembler = new TurnAssembler();

    for await (const payload of sseData(body, {
      isTerminal: () => assembler.result().finishReason !== null,
      terminalGraceMs: 10,
    })) {
      assembler.push(payload);
    }

    expect(assembler.result()).toMatchObject({ text: 'listo', finishReason: 'stop' });
    expect(cancelled).toBe(true);
  });

  it('no confunde una pausa entre fragmentos con el final de la respuesta', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hola "}}]}\n'),
        );
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              [
                'data: {"choices":[{"delta":{"content":"Daniel"}}]}',
                'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":7}}',
              ].join('\n') + '\n',
            ),
          );
        }, 30);
      },
      cancel() {
        cancelled = true;
      },
    });
    const assembler = new TurnAssembler();

    for await (const payload of sseData(body, {
      isTerminal: () => assembler.result().finalUsageReceived,
      terminalGraceMs: 10,
    })) {
      assembler.push(payload);
    }

    expect(assembler.result()).toMatchObject({
      text: 'hola Daniel',
      inputTokens: 12,
      outputTokens: 7,
      finalUsageReceived: true,
    });
    expect(cancelled).toBe(true);
  });

  it('termina aunque la cancelacion del socket nunca resuelva', async () => {
    let cancelRequested = false;
    let transportAborted = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"listo"},"finish_reason":"stop"}]}\n',
          ),
        );
      },
      cancel() {
        cancelRequested = true;
        return new Promise<void>(() => undefined);
      },
    });
    const assembler = new TurnAssembler();

    const completed = (async () => {
      for await (const payload of sseData(body, {
        isTerminal: () => assembler.result().finishReason !== null,
        terminalGraceMs: 10,
        onLocalEnd: () => {
          transportAborted = true;
        },
      })) {
        assembler.push(payload);
      }
      return true;
    })();

    await expect(
      Promise.race([
        completed,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
      ]),
    ).resolves.toBe(true);
    expect(assembler.result().text).toBe('listo');
    expect(cancelRequested).toBe(true);
    expect(transportAborted).toBe(true);
  });

  it('conserva el usage que llega justo despues de finish_reason', async () => {
    const body = flujo(
      [
        'data: {"choices":[{"delta":{"content":"listo"},"finish_reason":"stop"}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":7}}',
      ].join('\n') + '\n',
      90,
    );
    const assembler = new TurnAssembler();

    for await (const payload of sseData(body, {
      isTerminal: () => assembler.result().finishReason !== null,
      terminalGraceMs: 100,
    })) {
      assembler.push(payload);
    }

    expect(assembler.result()).toMatchObject({ inputTokens: 12, outputTokens: 7 });
  });
});

// POR QUE EXISTE: una pagina web de mas de mil lineas llego cortada a la mitad
// con 3.180 tokens de salida, muy por debajo del tope de 8.192. No fue el
// limite de tokens: fue Luxy, que armaba el cierre local al ver una señal
// terminal y lo ejecutaba un segundo despues AUNQUE el modelo siguiera
// escribiendo. La espera es por silencio, no por reloj.
describe('sseData: no cortar mientras siguen llegando datos', () => {
  /** emite trozos con pausas reales, como haria un modelo lento */
  function flujoLento(pasos: { texto: string; esperaMs: number }[]): ReadableStream<Uint8Array> {
    let indice = 0;
    return new ReadableStream({
      async pull(controller) {
        const paso = pasos[indice];
        indice += 1;
        if (paso === undefined) {
          controller.close();
          return;
        }
        if (paso.esperaMs > 0) await new Promise((listo) => setTimeout(listo, paso.esperaMs));
        controller.enqueue(new TextEncoder().encode(paso.texto));
      },
    });
  }

  it('un usage intermedio no puede cortar una respuesta que continua', async () => {
    // algunos endpoints compatibles mandan consumo parcial en un evento sin
    // choices ANTES de terminar. Tomarlo por final tira el resto de la pagina.
    const assembler = new TurnAssembler();
    const body = flujoLento([
      { texto: 'data: {"choices":[{"delta":{"content":"<html>"}}]}\n', esperaMs: 0 },
      { texto: 'data: {"choices":[],"usage":{"prompt_tokens":753,"completion_tokens":1000}}\n', esperaMs: 0 },
      { texto: 'data: {"choices":[{"delta":{"content":"<body>mucho mas</body>"}}]}\n', esperaMs: 1200 },
      { texto: 'data: {"choices":[],"usage":{"prompt_tokens":753,"completion_tokens":3180}}\n', esperaMs: 0 },
      { texto: 'data: [DONE]\n', esperaMs: 0 },
    ]);

    let final: SseTransportReport | null = null;
    for await (const payload of sseData(body, {
      // el cableado real: finish_reason es señal fuerte, el usage solo debil
      isTerminal: () => assembler.result().finishReason !== null,
      terminalGraceMs: 1000,
      isSoftTerminal: () => assembler.result().finalUsageReceived,
      softTerminalGraceMs: 3000,
      onTransportEnd: (report) => {
        final = report;
      },
    })) {
      assembler.push(payload);
    }

    expect(assembler.result().text).toBe('<html><body>mucho mas</body>');
    expect(assembler.result().outputTokens).toBe(3180);
    expect(final).not.toBeNull();
    expect((final as unknown as SseTransportReport).transportEnd).toBe('done_marker');
  });

  it('un usage sin mas datos si cierra, pero tras un silencio largo', async () => {
    // este es el caso que dejaba el trabajo eternamente en "Respondiendo": un
    // proxy que ya contabilizo la llamada y no cierra el cuerpo.
    const assembler = new TurnAssembler();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              'data: {"choices":[{"delta":{"content":"hola"}}]}',
              'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":7}}',
            ].join('\n') + '\n',
          ),
        );
      },
    });

    let final: SseTransportReport | null = null;
    for await (const payload of sseData(body, {
      isTerminal: () => assembler.result().finishReason !== null,
      isSoftTerminal: () => assembler.result().finalUsageReceived,
      softTerminalGraceMs: 40,
      onTransportEnd: (report) => {
        final = report;
      },
    })) {
      assembler.push(payload);
    }

    expect(assembler.result()).toMatchObject({ text: 'hola', outputTokens: 7 });
    expect((final as unknown as SseTransportReport).transportEnd).toBe('local_end');
  });

  it('pero el silencio tras la señal terminal si cierra', async () => {
    // el socket que se queda abierto despues de finish_reason es el fallo que
    // dejaba el trabajo eternamente en "Respondiendo". Eso no se toca.
    const assembler = new TurnAssembler();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"listo"},"finish_reason":"stop"}]}\n',
          ),
        );
      },
    });

    let final: SseTransportReport | null = null;
    for await (const payload of sseData(body, {
      isTerminal: () => assembler.result().finishReason !== null,
      terminalGraceMs: 30,
      onTransportEnd: (report) => {
        final = report;
      },
    })) {
      assembler.push(payload);
    }

    expect(assembler.result().text).toBe('listo');
    expect((final as unknown as SseTransportReport).transportEnd).toBe('local_end');
  });
});

// POR QUE EXISTE: desde fuera, "el proveedor dijo que habia terminado" y "el
// socket se cayo a mitad" se ven igual: un flujo que deja de dar bytes. Llevan
// a arreglos opuestos, asi que el transporte tiene que decir cual fue.
describe('sseData: ultima señal observada', () => {
  async function consumir(
    body: ReadableStream<Uint8Array>,
    options: Parameters<typeof sseData>[1] = {},
  ): Promise<{ report: SseTransportReport | null; error: unknown }> {
    const observado: { report: SseTransportReport | null } = { report: null };
    let error: unknown = null;
    try {
      for await (const _payload of sseData(body, {
        ...options,
        onTransportEnd: (report) => {
          observado.report = report;
        },
      })) {
        // el reporte no depende de lo que se haga con los payloads
      }
    } catch (capturado) {
      error = capturado;
    }
    return { report: observado.report, error };
  }

  it('informa de done_marker y cuenta bytes y chunks', async () => {
    const texto = 'data: {"a":1}\ndata: [DONE]\n';
    const { report } = await consumir(flujo(texto, 8));

    expect(report?.transportEnd).toBe('done_marker');
    expect(report?.bytes).toBe(new TextEncoder().encode(texto).length);
    expect(report?.chunks).toBeGreaterThan(1);
    expect(report?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('informa de body_closed cuando el cuerpo se cierra sin marcador', async () => {
    const { report } = await consumir(flujo('data: {"a":1}\n'));
    expect(report?.transportEnd).toBe('body_closed');
  });

  it('informa de local_end cuando Luxy cierra tras una señal terminal', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"listo"},"finish_reason":"stop"}]}\n',
          ),
        );
        // el socket se queda abierto, como hacen algunos endpoints compatibles
      },
    });

    const { report } = await consumir(body, { isTerminal: () => true, terminalGraceMs: 10 });
    expect(report?.transportEnd).toBe('local_end');
  });

  it('informa de read_error cuando la lectura revienta, y propaga el fallo', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}\n'));
      },
      pull() {
        throw new Error('socket cerrado por el proveedor');
      },
    });

    const { report, error } = await consumir(body);
    expect(report?.transportEnd).toBe('read_error');
    // los bytes ya recibidos se conservan: son la prueba de que hubo respuesta
    expect(report?.bytes).toBeGreaterThan(0);
    expect((error as Error).message).toContain('socket cerrado');
  });
});

describe('TurnAssembler: texto', () => {
  it('concatena los deltas en orden y devuelve cada trozo nuevo', () => {
    const a = new TurnAssembler();
    expect(a.push('{"choices":[{"delta":{"content":"ho"}}]}')).toBe('ho');
    expect(a.push('{"choices":[{"delta":{"content":"la"}}]}')).toBe('la');
    expect(a.result().text).toBe('hola');
  });

  it('recoge el consumo de tokens', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}');
    expect(a.result()).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      finalUsageReceived: true,
    });
  });

  it('acepta nombres de usage y bloques de contenido compatibles', () => {
    const a = new TurnAssembler();
    a.push(
      '{"choices":[{"delta":{"content":[{"type":"text","text":"hola "},{"type":"output_text","text":"Daniel"}]}}]}',
    );
    a.push('{"choices":[],"usage":{"input_tokens":287,"output_tokens":476}}');

    expect(a.result()).toMatchObject({
      text: 'hola Daniel',
      inputTokens: 287,
      outputTokens: 476,
      finalUsageReceived: true,
    });
  });

  it('no trata como final el usage parcial que acompaña a un delta', () => {
    const a = new TurnAssembler();
    a.push(
      '{"choices":[{"delta":{"content":"hola"}}],"usage":{"prompt_tokens":10,"completion_tokens":1}}',
    );

    expect(a.result()).toMatchObject({
      text: 'hola',
      inputTokens: 10,
      outputTokens: 1,
      finalUsageReceived: false,
    });
  });

  it('un trozo con json roto no tumba la vuelta', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"content":"antes"}}]}');
    expect(a.push('{roto')).toBeNull();
    a.push('{"choices":[{"delta":{"content":"despues"}}]}');
    expect(a.result().text).toBe('antesdespues');
  });

  it('recoge el motivo de terminacion', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{},"finish_reason":"stop"}]}');
    expect(a.result().finishReason).toBe('stop');
  });

  it('acepta el mensaje completo si el proveedor no manda deltas', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"message":{"content":"entero"}}]}');
    expect(a.result().text).toBe('entero');
  });
});

describe('un error dentro del flujo NO es una respuesta vacia', () => {
  it('detecta el error que llega con HTTP 200', () => {
    // PASO DE VERDAD: la respuesta venia con estado 200 y el primer evento era
    // este. Sin mirarlo, se devolvia texto vacio como si todo hubiera ido bien,
    // y el fallo aparecia mucho despues como "el JSON no se puede parsear": se
    // culpaba al formato de una respuesta que nunca existio.
    const a = new TurnAssembler();
    a.push(
      '{"error":{"message":"Internal server error","type":"internal_server_error","code":500}}',
    );

    expect(a.result().streamError).toContain('Internal server error');
    expect(a.result().streamError).toContain('500');
  });

  it('un error sin mensaje tampoco pasa desapercibido', () => {
    const a = new TurnAssembler();
    a.push('{"error":{}}');
    expect(a.result().streamError).not.toBeNull();
  });

  it('una respuesta normal no inventa error', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"content":"hola"}}]}');
    expect(a.result().streamError).toBeNull();
  });
});

describe('truncamiento y razonamiento', () => {
  it('finish_reason length se reconoce como corte', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"content":"a medi"},"finish_reason":"length"}]}');
    expect(wasTruncated(a.result())).toBe(true);
  });

  it('finish_reason stop no es un corte', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"content":"entero"},"finish_reason":"stop"}]}');
    expect(wasTruncated(a.result())).toBe(false);
  });

  it('el razonamiento se cuenta pero NO entra en el texto', () => {
    // si se colara dentro, romperia el JSON que se le pidio al modelo.
    // Medido en Kimi K2.6: 10.110 caracteres razonando y 4.947 respondiendo,
    // los dos del mismo presupuesto de tokens
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"reasoning_content":"a ver, el usuario quiere..."}}]}');
    a.push('{"choices":[{"delta":{"content":"{\\"results\\":[]}"}}]}');

    expect(a.result().text).toBe('{"results":[]}');
    expect(a.reasoningLength()).toBe('a ver, el usuario quiere...'.length);
  });

  it('un delta de solo razonamiento no cuenta como texto nuevo', () => {
    const a = new TurnAssembler();
    expect(a.push('{"choices":[{"delta":{"reasoning_content":"pensando"}}]}')).toBeNull();
  });
});

describe('TurnAssembler: llamadas a herramientas', () => {
  it('pega los argumentos partidos en varios deltas', () => {
    const a = new TurnAssembler();
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":""}}]}}]}',
    );
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\""}}]}}]}',
    );
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"a.txt\\"}"}}]}}]}',
    );

    const calls = a.result().toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'call_1', name: 'read_file' });
    expect(calls[0]!.arguments).toEqual({ path: 'a.txt' });
  });

  it('mantiene separadas dos herramientas en la misma vuelta, por indice', () => {
    const a = new TurnAssembler();
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"read_file","arguments":"{\\"path\\":\\"uno\\"}"}}]}}]}',
    );
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c1","function":{"name":"list_dir","arguments":"{\\"path\\":\\"dos\\"}"}}]}}]}',
    );

    const calls = a.result().toolCalls;
    expect(calls.map((c) => c.name)).toEqual(['read_file', 'list_dir']);
    expect(calls[0]!.arguments).toEqual({ path: 'uno' });
    expect(calls[1]!.arguments).toEqual({ path: 'dos' });
  });

  it('devuelve las llamadas ordenadas por indice aunque lleguen desordenadas', () => {
    const a = new TurnAssembler();
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c1","function":{"name":"segunda","arguments":"{}"}}]}}]}',
    );
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"primera","arguments":"{}"}}]}}]}',
    );

    expect(a.result().toolCalls.map((c) => c.name)).toEqual(['primera', 'segunda']);
  });

  it('pega tambien un nombre que llega partido', () => {
    const a = new TurnAssembler();
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"read_"}}]}}]}',
    );
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"{}"}}]}}]}',
    );

    expect(a.result().toolCalls[0]?.name).toBe('read_file');
  });

  it('sin indice usa la posicion, en vez de mezclar las dos llamadas', () => {
    const a = new TurnAssembler();
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"id":"c0","function":{"name":"a","arguments":"{}"}},{"id":"c1","function":{"name":"b","arguments":"{}"}}]}}]}',
    );
    expect(a.result().toolCalls.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('un argumento que nunca llega a ser json valido se le devuelve al modelo, no revienta', () => {
    // asi el modelo recibe el error y puede corregirlo en la vuelta siguiente,
    // que es como se trata ya en las respuestas sin transmitir
    const a = new TurnAssembler();
    a.push(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}',
    );

    const calls = a.result().toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.arguments).toHaveProperty('__invalidJson');
  });

  it('una vuelta de solo texto no inventa llamadas', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"content":"solo texto"}}]}');
    expect(a.result().toolCalls).toEqual([]);
  });
});
