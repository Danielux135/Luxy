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
import { sseData, TurnAssembler } from './sse.js';

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
    expect(a.result()).toMatchObject({ inputTokens: 10, outputTokens: 20 });
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

describe('TurnAssembler: llamadas a herramientas', () => {
  it('pega los argumentos partidos en varios deltas', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":""}}]}}]}');
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\""}}]}}]}');
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"a.txt\\"}"}}]}}]}');

    const calls = a.result().toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'call_1', name: 'read_file' });
    expect(calls[0]!.arguments).toEqual({ path: 'a.txt' });
  });

  it('mantiene separadas dos herramientas en la misma vuelta, por indice', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"read_file","arguments":"{\\"path\\":\\"uno\\"}"}}]}}]}');
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c1","function":{"name":"list_dir","arguments":"{\\"path\\":\\"dos\\"}"}}]}}]}');

    const calls = a.result().toolCalls;
    expect(calls.map((c) => c.name)).toEqual(['read_file', 'list_dir']);
    expect(calls[0]!.arguments).toEqual({ path: 'uno' });
    expect(calls[1]!.arguments).toEqual({ path: 'dos' });
  });

  it('devuelve las llamadas ordenadas por indice aunque lleguen desordenadas', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c1","function":{"name":"segunda","arguments":"{}"}}]}}]}');
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"primera","arguments":"{}"}}]}}]}');

    expect(a.result().toolCalls.map((c) => c.name)).toEqual(['primera', 'segunda']);
  });

  it('pega tambien un nombre que llega partido', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"read_"}}]}}]}');
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"{}"}}]}}]}');

    expect(a.result().toolCalls[0]?.name).toBe('read_file');
  });

  it('sin indice usa la posicion, en vez de mezclar las dos llamadas', () => {
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"tool_calls":[{"id":"c0","function":{"name":"a","arguments":"{}"}},{"id":"c1","function":{"name":"b","arguments":"{}"}}]}}]}');
    expect(a.result().toolCalls.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('un argumento que nunca llega a ser json valido se le devuelve al modelo, no revienta', () => {
    // asi el modelo recibe el error y puede corregirlo en la vuelta siguiente,
    // que es como se trata ya en las respuestas sin transmitir
    const a = new TurnAssembler();
    a.push('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}');

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
