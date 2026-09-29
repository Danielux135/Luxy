// lectura de flujos SSE de la API de chat.
//
// Estaba incrustado dentro del camino de texto, asi que el camino agentico (el
// que lleva herramientas) no podia transmitir. Aqui vive una sola vez.
import type { StreamTransportEnd } from '@luxy/shared';
import { SOFT_TERMINAL_GRACE_MS, TERMINAL_GRACE_MS } from '@luxy/shared';
import { parseNativeToolCalls, type ToolCall } from './tool-protocol.js';

/** lo que se sabe del transporte cuando el flujo deja de dar bytes */
export interface SseTransportReport {
  transportEnd: StreamTransportEnd;
  /** trozos de red leidos, no eventos SSE */
  chunks: number;
  bytes: number;
  durationMs: number;
  /**
   * ms desde que empezo la lectura hasta el PRIMER trozo de red.
   *
   * null si no llego ninguno, que es en si mismo el diagnostico: la llamada se
   * pago y no devolvio un solo byte.
   */
  firstChunkMs: number | null;
  /** ms hasta el ULTIMO trozo; con `durationMs` da el silencio final */
  lastChunkMs: number | null;
  /**
   * el hueco mas largo entre dos trozos SEGUIDOS. null con menos de dos.
   *
   * es lo que separa «va lento pero va» de «se quedo mudo»: el tope que mata
   * una llamada es de silencio, no de duracion, y sin esta cifra las dos cosas
   * se ven igual desde fuera.
   */
  longestSilenceMs: number | null;
}

/**
 * trocea el cuerpo de la respuesta en payloads `data:` completos.
 *
 * un chunk de red no respeta los limites de linea: una linea `data:` puede
 * llegar partida en dos lecturas, asi que lo que queda a medias se guarda para
 * la siguiente vuelta.
 */
export interface SseDataOptions {
  /**
   * señal terminal FUERTE: el mensaje termino y lo dice el protocolo.
   *
   * `finish_reason`, o la memoria completa en una conversacion. Algunos
   * proveedores mandan eso pero omiten `[DONE]` y dejan la conexion abierta,
   * asi que el consumidor avisa aqui y se cierra tras un margen corto.
   */
  isTerminal?: () => boolean;
  /** margen para recoger usage o `[DONE]` despues de la respuesta terminal */
  terminalGraceMs?: number;
  /**
   * señal terminal DEBIL: probablemente termino, pero no esta demostrado.
   *
   * el caso real es un `usage` sin `choices`. Suele ser el ultimo evento, pero
   * hay endpoints que lo mandan a mitad de la respuesta. Tratarlo como final
   * corto una pagina web por la mitad con 3.180 tokens de 8.192 disponibles.
   */
  isSoftTerminal?: () => boolean;
  /** silencio exigido tras una señal debil; mucho mayor que el margen fuerte */
  softTerminalGraceMs?: number;
  /** corta tambien el transporte fetch cuando Luxy decide terminar localmente */
  onLocalEnd?: () => void;
  /**
   * se llama exactamente una vez con la ultima señal observada.
   *
   * es la unica forma de distinguir "el proveedor dijo que habia terminado" de
   * "el socket se cayo": desde fuera las dos se ven como un flujo que deja de
   * dar bytes, y llevan a arreglos opuestos.
   */
  onTransportEnd?: (report: SseTransportReport) => void;
}

export async function* sseData(
  body: ReadableStream<Uint8Array>,
  options: SseDataOptions = {},
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminalDeadline: number | null = null;
  const startedAt = Date.now();
  let chunks = 0;
  let bytes = 0;
  // los tiempos de arranque y de silencio del transporte. Son cifras: cuando
  // llego el primer byte, cuando el ultimo y cuanto callo entre medias.
  let firstChunkAt: number | null = null;
  let lastChunkAt: number | null = null;
  let longestSilenceMs: number | null = null;
  // si nadie lo cambia es que el cuerpo se cerro solo, sin marcador ni error
  let transportEnd: StreamTransportEnd = 'body_closed';

  /**
   * decide si toca esperar un cierre local, y hasta cuando.
   *
   * el margen se cuenta desde el ULTIMO evento, no desde la primera señal
   * terminal. La diferencia no es cosmetica: una pagina web de mas de mil
   * lineas llego cortada por la mitad con 3.180 tokens de salida y un tope de
   * 8.192, porque un `usage` intermedio armaba el cierre y este se ejecutaba un
   * segundo despues aunque el modelo siguiera escribiendo. Lo que autoriza a
   * cerrar es el SILENCIO tras la señal, nunca el reloj mientras llegan datos.
   */
  const updateDeadlines = (): void => {
    const fuerte = options.isTerminal?.() === true;
    const debil = !fuerte && options.isSoftTerminal?.() === true;
    if (!fuerte && !debil) {
      terminalDeadline = null;
      return;
    }
    const margen = fuerte
      ? (options.terminalGraceMs ?? TERMINAL_GRACE_MS)
      : (options.softTerminalGraceMs ?? SOFT_TERMINAL_GRACE_MS);
    terminalDeadline = Date.now() + Math.max(0, margen);
  };

  const readNext = async () => {
    if (terminalDeadline === null) return reader.read();

    const remaining = terminalDeadline - Date.now();
    if (remaining <= 0) {
      transportEnd = 'local_end';
      options.onLocalEnd?.();
      // No se espera esta promesa. En un ReadableStream de pruebas `cancel()`
      // suele resolver de inmediato, pero el cuerpo real de undici puede
      // conservarla pendiente mientras el servidor mantiene el socket vivo.
      // Esperarla aqui vuelve a dejar el trabajo eternamente en "Respondiendo".
      void reader.cancel('respuesta SSE terminada localmente').catch(() => undefined);
      return null;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const result = await Promise.race([
      reader
        .read()
        .then((value) => ({ kind: 'read' as const, value }))
        .catch((error: unknown) => ({ kind: 'error' as const, error })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), remaining);
      }),
    ]);
    if (timer !== null) clearTimeout(timer);

    if (result.kind === 'timeout') {
      transportEnd = 'local_end';
      options.onLocalEnd?.();
      void reader.cancel('respuesta SSE terminada localmente').catch(() => undefined);
      return null;
    }
    if (result.kind === 'error') throw result.error;
    return result.value;
  };

  try {
    for (;;) {
      const next = await readNext();
      if (next === null) break;
      const { done, value } = next;
      if (done) break;
      chunks += 1;
      bytes += value.byteLength;
      const ahora = Date.now();
      if (lastChunkAt !== null) {
        const hueco = ahora - lastChunkAt;
        if (longestSilenceMs === null || hueco > longestSilenceMs) longestSilenceMs = hueco;
      }
      firstChunkAt ??= ahora;
      lastChunkAt = ahora;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      // la ultima puede estar incompleta: se queda para el siguiente chunk
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const parsed = dataPayload(line);
        if (parsed.kind === 'done') {
          transportEnd = 'done_marker';
          return;
        }
        if (parsed.kind === 'data') {
          yield parsed.payload;
          updateDeadlines();
        }
      }

      // Kimi y otros endpoints compatibles pueden mandar el ultimo evento
      // completo sin salto de linea y dejar el socket abierto. Si el JSON ya
      // es valido, esperar otro byte impide ver `finish_reason` para siempre.
      const pending = completeBufferedPayload(buffer);
      if (pending !== null) {
        buffer = '';
        if (pending.kind === 'done') {
          transportEnd = 'done_marker';
          return;
        }
        yield pending.payload;
        updateDeadlines();
      }
    }

    // algunos proveedores no cierran con salto de linea
    const ultimo = dataPayload(buffer);
    if (ultimo.kind === 'data') yield ultimo.payload;
  } catch (error) {
    // el socket se cayo, el aborto llego o la lectura fallo. No es lo mismo que
    // un cierre normal, y confundirlos es lo que hace irrecuperable una
    // respuesta larga: se marca antes de propagar.
    transportEnd = 'read_error';
    throw error;
  } finally {
    options.onTransportEnd?.({
      transportEnd,
      chunks,
      bytes,
      durationMs: Date.now() - startedAt,
      firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startedAt,
      lastChunkMs: lastChunkAt === null ? null : lastChunkAt - startedAt,
      longestSilenceMs,
    });
    // Tras un cierre local puede quedar un read pendiente durante un instante.
    // Liberar un lector en ese estado lanza; el transporte ya esta abortado y
    // el objeto puede recogerse cuando se resuelva la cancelacion.
    try {
      reader.releaseLock();
    } catch {
      /* la cancelacion local ya posee el cierre del transporte */
    }
  }
}

/** reconoce una linea `data:` completa aunque el proveedor omita su salto final */
function completeBufferedPayload(buffer: string): Exclude<LineaSse, { kind: 'ignorar' }> | null {
  const parsed = dataPayload(buffer);
  if (parsed.kind === 'done') return parsed;
  if (parsed.kind !== 'data') return null;
  try {
    JSON.parse(parsed.payload);
    return parsed;
  } catch {
    return null;
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
  /** el proveedor envio el bloque final de consumo, ya sin choices */
  finalUsageReceived: boolean;
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
  private finalUsageReceived = false;
  private streamError: string | null = null;
  private reasoningChars = 0;
  /** campos por los que llego razonamiento; solo sus NOMBRES */
  private readonly reasoningSources = new Set<ReasoningSource>();
  /** `completion_tokens_details.reasoning_tokens`, si el proveedor lo dijo */
  private reasoningTokens = 0;

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

    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const usage = parsed.usage;
    if (typeof usage === 'object' && usage !== null) {
      // Con `include_usage`, el ultimo chunk compatible con OpenAI lleva
      // choices vacio. Algunos proxies adjuntan consumo parcial a cada delta;
      // ese consumo NO es una señal de final y no debe cortar modelos lentos.
      this.finalUsageReceived ||= choices.length === 0;
      const compatible = usage as {
        prompt_tokens?: number;
        completion_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      };
      this.inputTokens = compatible.prompt_tokens ?? compatible.input_tokens ?? this.inputTokens;
      this.outputTokens =
        compatible.completion_tokens ?? compatible.output_tokens ?? this.outputTokens;
    }

    if (typeof usage === 'object' && usage !== null) {
      // el recuento de razonamiento puede venir en el ultimo bloque o repetido
      // en cada uno: se queda el mayor, que es el acumulado
      this.reasoningTokens = Math.max(this.reasoningTokens, usageReasoningTokens(usage));
    }

    const first = choices[0] as
      | {
          delta?: ReasoningCarrier & { content?: unknown; tool_calls?: unknown };
          finish_reason?: unknown;
          // algunos proveedores mandan el mensaje completo en el ultimo evento
          message?: ReasoningCarrier & { content?: unknown; tool_calls?: unknown };
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
    //
    // Y se cuenta en LOS DOS campos (D-107): hasta entonces solo se miraba
    // `reasoning_content`, y vLLM y Groq lo mandan en `reasoning`. Las 9
    // llamadas a gpt-oss por Groq tenian 0 caracteres de razonamiento con un
    // cociente de 0,23 a 1,48: no era que no razonara, era que Luxy no lo leia.
    const visto = reasoningOf(delta);
    this.reasoningChars += visto.chars;
    for (const source of visto.sources) this.reasoningSources.add(source);

    let nuevo: string | null = null;
    const content = contentText(delta.content);
    if (content.length > 0) {
      this.text += content;
      nuevo = content;
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
      finalUsageReceived: this.finalUsageReceived,
      streamError: this.streamError,
    };
  }

  /** cuantos caracteres de razonamiento gasto el modelo antes de responder */
  reasoningLength(): number {
    return this.reasoningChars;
  }

  /** por que campos llego razonamiento, sin su contenido */
  reasoningSourcesSeen(): ReadonlySet<ReasoningSource> {
    return this.reasoningSources;
  }

  /** tokens de razonamiento que declaro el proveedor; 0 si no lo dijo */
  reportedReasoningTokens(): number {
    return this.reasoningTokens;
  }

  /**
   * caracteres de nombres y argumentos de las herramientas pedidas.
   *
   * son salida del modelo igual que el texto: sin contarlos, una vuelta que
   * solo pide una herramienta parece haber gastado sus tokens en nada.
   */
  toolArgumentLength(): number {
    let total = 0;
    for (const call of this.calls.values()) total += call.name.length + call.arguments.length;
    return total;
  }
}

/** campos por los que puede llegar razonamiento visible */
export type ReasoningSource = 'reasoning_content' | 'reasoning' | 'think';

/** lo que puede traer razonamiento: un `delta` o un `message` */
export interface ReasoningCarrier {
  reasoning_content?: unknown;
  reasoning?: unknown;
}

/**
 * cuanto razonamiento visible trae un `delta` o un `message`, y por donde.
 *
 * Solo cadenas: OpenRouter manda ademas `reasoning_details` como lista de
 * objetos, y eso no se cuenta para no contar dos veces lo mismo.
 */
export function reasoningOf(carrier: ReasoningCarrier): {
  chars: number;
  sources: ReasoningSource[];
} {
  const sources: ReasoningSource[] = [];
  let chars = 0;
  if (typeof carrier.reasoning_content === 'string' && carrier.reasoning_content.length > 0) {
    chars += carrier.reasoning_content.length;
    sources.push('reasoning_content');
  }
  if (typeof carrier.reasoning === 'string' && carrier.reasoning.length > 0) {
    // vLLM, desde que renombro el campo, copia `reasoning` en
    // `reasoning_content` por compatibilidad y manda los dos con el MISMO
    // texto: sumarlos contaba dos veces el mismo razonamiento (octava ronda).
    // Es de memoria, no visto en una respuesta real; con textos distintos se
    // siguen sumando
    if (carrier.reasoning !== carrier.reasoning_content) chars += carrier.reasoning.length;
    sources.push('reasoning');
  }
  return { chars, sources };
}

/**
 * `completion_tokens_details.reasoning_tokens` (OpenAI, DeepSeek, MiMo, Qwen, y
 * el DTO de NewAPI), o `output_tokens_details.reasoning_tokens`. 0 si no viene.
 */
export function usageReasoningTokens(usage: unknown): number {
  if (typeof usage !== 'object' || usage === null) return 0;
  const compatible = usage as {
    completion_tokens_details?: { reasoning_tokens?: unknown } | null;
    output_tokens_details?: { reasoning_tokens?: unknown } | null;
  };
  const value =
    compatible.completion_tokens_details?.reasoning_tokens ??
    compatible.output_tokens_details?.reasoning_tokens;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** caracteres de nombres y argumentos de un `tool_calls` sin transmitir */
export function rawToolCallChars(toolCalls: unknown): number {
  if (!Array.isArray(toolCalls)) return 0;
  let total = 0;
  for (const entry of toolCalls) {
    if (typeof entry !== 'object' || entry === null) continue;
    const fn = (entry as { function?: { name?: unknown; arguments?: unknown } }).function;
    if (typeof fn?.name === 'string') total += fn.name.length;
    if (typeof fn?.arguments === 'string') total += fn.arguments.length;
  }
  return total;
}

/** los campos vistos, en un orden estable y unidos con «+»; null si ninguno */
export function reasoningFieldLabel(sources: Iterable<ReasoningSource>): string | null {
  const vistos = new Set(sources);
  const orden: ReasoningSource[] = ['reasoning_content', 'reasoning', 'think'];
  const presentes = orden.filter((source) => vistos.has(source));
  return presentes.length === 0 ? null : presentes.join('+');
}

/**
 * contenido compatible con OpenAI clasico y con endpoints que usan bloques.
 * El razonamiento nunca pasa por aqui: solo se aceptan campos de texto visible.
 */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (typeof block !== 'object' || block === null) return '';
      const item = block as { type?: unknown; text?: unknown };
      if (item.type !== undefined && item.type !== 'text' && item.type !== 'output_text') return '';
      return typeof item.text === 'string' ? item.text : '';
    })
    .join('');
}
