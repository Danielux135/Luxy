// lectura de flujos SSE de la API de chat.
//
// Estaba incrustado dentro del camino de texto, asi que el camino agentico (el
// que lleva herramientas) no podia transmitir. Aqui vive una sola vez.
import { parseNativeToolCalls, type ToolCall } from './tool-protocol.js';

/**
 * trocea el cuerpo de la respuesta en payloads `data:` completos.
 *
 * un chunk de red no respeta los limites de linea: una linea `data:` puede
 * llegar partida en dos lecturas, asi que lo que queda a medias se guarda para
 * la siguiente vuelta.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      // la ultima puede estar incompleta: se queda para el siguiente chunk
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const parsed = dataPayload(line);
        if (parsed.kind === 'done') return;
        if (parsed.kind === 'data') yield parsed.payload;
      }
    }

    // algunos proveedores no cierran con salto de linea
    const ultimo = dataPayload(buffer);
    if (ultimo.kind === 'data') yield ultimo.payload;
  } finally {
    reader.releaseLock();
  }
}

type LineaSse = { kind: 'data'; payload: string } | { kind: 'done' } | { kind: 'ignorar' };

function dataPayload(line: string): LineaSse {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return { kind: 'ignorar' };
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return { kind: 'done' };
  return payload.length > 0 ? { kind: 'data', payload } : { kind: 'ignorar' };
}

/** lo que hay que reconstruir de una vuelta transmitida */
export interface AssembledTurn {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  finishReason: string | null;
  /**
   * error que el proveedor mando DENTRO del flujo, con HTTP 200.
   *
   * paso de verdad: la respuesta llego con estado 200 y el primer evento era
   * {"error":{"message":"Internal server error","code":500}}. Sin mirar esto, se
   * devolvia texto vacio como si todo hubiera ido bien, y el fallo aparecia
   * mucho despues como "el JSON del modelo no se puede parsear": se culpaba al
   * formato de una respuesta que nunca existio.
   */
  streamError: string | null;
}

/** true si la respuesta se corto por llegar al tope de tokens */
export function wasTruncated(turn: AssembledTurn): boolean {
  return turn.finishReason === 'length';
}

interface PartialCall {
  id: string | null;
  name: string;
  /** los argumentos llegan partidos: se concatenan tal cual y se parsean al final */
  arguments: string;
}

/**
 * acumula los trozos de una respuesta transmitida.
 *
 * LO DELICADO son las llamadas a herramientas: el JSON de los argumentos no
 * llega entero, llega en pedazos que hay que pegar en orden y por indice. Un
 * pedazo suelto no es JSON valido, asi que no se puede parsear al vuelo.
 */
export class TurnAssembler {
  private text = '';
  private readonly calls = new Map<number, PartialCall>();
  private inputTokens = 0;
  private outputTokens = 0;
  private finishReason: string | null = null;
  private streamError: string | null = null;
  private reasoningChars = 0;

  /**
   * consume un payload `data:`.
   * devuelve el texto nuevo de este trozo, para poder mostrar progreso.
   */
  push(payload: string): string | null {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      // un trozo ilegible no debe tumbar la vuelta entera
      return null;
    }

    // un error dentro del flujo NO es una respuesta vacia
    const error = parsed.error as { message?: unknown; code?: unknown } | undefined;
    if (error !== undefined && error !== null) {
      const mensaje = typeof error.message === 'string' ? error.message : 'error sin mensaje';
      const codigo = error.code === undefined ? '' : ` (codigo ${String(error.code)})`;
      this.streamError = `el proveedor devolvio un error en el flujo: ${mensaje}${codigo}`;
      return null;
    }

    const usage = parsed.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | null
      | undefined;
    if (usage) {
      this.inputTokens = usage.prompt_tokens ?? this.inputTokens;
      this.outputTokens = usage.completion_tokens ?? this.outputTokens;
    }

    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const first = choices[0] as
      | {
          delta?: { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown };
          finish_reason?: unknown;
          // algunos proveedores mandan el mensaje completo en el ultimo evento
          message?: { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown };
        }
      | undefined;
    if (!first) return null;

    if (typeof first.finish_reason === 'string') this.finishReason = first.finish_reason;

    const delta = first.delta ?? first.message;
    if (!delta) return null;

    // el razonamiento se cuenta pero NO se acumula en el texto: no es la
    // respuesta, y colarlo dentro romperia el JSON que se le pidio al modelo.
    // Se cuenta porque gasta presupuesto de tokens, y saberlo es lo que explica
    // que una respuesta se corte antes de empezar.
    if (typeof delta.reasoning_content === 'string') {
      this.reasoningChars += delta.reasoning_content.length;
    }

    let nuevo: string | null = null;
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      this.text += delta.content;
      nuevo = delta.content;
    }

    if (Array.isArray(delta.tool_calls)) this.mergeToolCalls(delta.tool_calls);

    return nuevo;
  }

  private mergeToolCalls(raw: unknown[]): void {
    for (const [posicion, entry] of raw.entries()) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as {
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };

      // el indice es quien identifica la llamada entre trozos. Si el proveedor
      // no lo manda, se usa la posicion en el array.
      const index = typeof item.index === 'number' ? item.index : posicion;
      const actual = this.calls.get(index) ?? { id: null, name: '', arguments: '' };

      if (typeof item.id === 'string' && item.id.length > 0) actual.id = item.id;
      // el nombre tambien puede llegar en trozos
      if (typeof item.function?.name === 'string') actual.name += item.function.name;
      if (typeof item.function?.arguments === 'string') {
        actual.arguments += item.function.arguments;
      }

      this.calls.set(index, actual);
    }
  }

  /**
   * cierra la vuelta.
   *
   * los argumentos se entregan como cadena al parser que ya existe, para que el
   * JSON invalido se trate igual que en las respuestas sin transmitir: se le
   * devuelve al modelo para que lo corrija, no se revienta el trabajo.
   */
  result(): AssembledTurn {
    const ordenadas = [...this.calls.entries()].sort(([a], [b]) => a - b);

    return {
      text: this.text,
      toolCalls: parseNativeToolCalls({
        tool_calls: ordenadas.map(([index, call]) => ({
          id: call.id ?? `call_${index}`,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      }),
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      finishReason: this.finishReason,
      streamError: this.streamError,
    };
  }

  /** cuantos caracteres de razonamiento gasto el modelo antes de responder */
  reasoningLength(): number {
    return this.reasoningChars;
  }
}
