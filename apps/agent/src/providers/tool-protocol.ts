// protocolo de herramientas para las APIs HTTP.
//
// Dos caminos, porque no todos los endpoints admiten lo mismo:
//
//   A. TOOL CALLING NATIVO. El endpoint acepta `tools` al estilo OpenAI y
//      responde con `tool_calls`. Es el preferido.
//   B. PROTOCOLO JSON DE LUXY. El modelo escribe un bloque JSON con la
//      herramienta que quiere. Se usa cuando el endpoint no admite `tools`, o
//      cuando los admite mal.
//
// Todo lo de aqui son funciones puras: se prueban sin red y sin gastar tokens.
import { z } from 'zod';
import type { AgentToolName } from '@luxy/shared';
import { TOOL_DESCRIPTIONS } from '../tools/definitions.js';

export interface ToolCall {
  id: string;
  name: string;
  /** argumentos en crudo; los valida el esquema de la herramienta */
  arguments: unknown;
}

// -----------------------------------------------------------------------------
// A. tool calling nativo
// -----------------------------------------------------------------------------

/**
 * acumulador de tool_calls en streaming.
 *
 * en SSE los argumentos llegan TROCEADOS: cada delta trae un pedazo de la cadena
 * JSON y hay que concatenarlos por indice. El parser anterior los descartaba
 * enteros, por eso el tool calling no funcionaba.
 */
export interface ToolCallAccumulator {
  [index: number]: { id: string; name: string; args: string };
}

export function accumulateToolCallDelta(
  accumulator: ToolCallAccumulator,
  delta: unknown,
): ToolCallAccumulator {
  if (!Array.isArray(delta)) return accumulator;

  for (const entry of delta) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as {
      index?: unknown;
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const index = typeof item.index === 'number' ? item.index : 0;
    const current = accumulator[index] ?? { id: '', name: '', args: '' };

    if (typeof item.id === 'string' && item.id.length > 0) current.id = item.id;
    if (typeof item.function?.name === 'string' && item.function.name.length > 0) {
      current.name = item.function.name;
    }
    if (typeof item.function?.arguments === 'string') {
      current.args += item.function.arguments;
    }
    accumulator[index] = current;
  }
  return accumulator;
}

/** convierte el acumulador en llamadas listas para ejecutar */
export function finalizeToolCalls(accumulator: ToolCallAccumulator): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const [index, entry] of Object.entries(accumulator)) {
    if (entry.name.length === 0) continue;
    calls.push({
      id: entry.id.length > 0 ? entry.id : `call_${index}`,
      name: entry.name,
      arguments: safeParseJson(entry.args),
    });
  }
  return calls;
}

/** lee tool_calls de una respuesta sin streaming */
export function parseNativeToolCalls(message: unknown): ToolCall[] {
  if (typeof message !== 'object' || message === null) return [];
  const raw = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(raw)) return [];

  const calls: ToolCall[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = item.function?.name;
    if (typeof name !== 'string' || name.length === 0) continue;
    calls.push({
      id: typeof item.id === 'string' ? item.id : `call_${index}`,
      name,
      arguments:
        typeof item.function?.arguments === 'string'
          ? safeParseJson(item.function.arguments)
          : (item.function?.arguments ?? {}),
    });
  }
  return calls;
}

function safeParseJson(text: string): unknown {
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    // el modelo mando JSON invalido: se devuelve tal cual para que el esquema
    // de la herramienta lo rechace con un mensaje que pueda corregir
    return { __invalidJson: text.slice(0, 500) };
  }
}

// -----------------------------------------------------------------------------
// B. protocolo JSON de Luxy (fallback)
// -----------------------------------------------------------------------------

const fallbackCallSchema = z.object({
  tool: z.string().min(1).max(64),
  arguments: z.record(z.unknown()).default({}),
});

/**
 * instrucciones del protocolo de reserva.
 *
 * se piden bloques ```json para que el texto normal del modelo no se confunda
 * con una llamada.
 */
export function buildFallbackInstructions(tools: readonly AgentToolName[]): string {
  const catalogo = tools
    .map((name) => `- ${name}: ${TOOL_DESCRIPTIONS[name].description}`)
    .join('\n');

  return [
    'Tienes herramientas para trabajar sobre el proyecto. Para usar una, responde',
    'UNICAMENTE con un bloque de codigo json con esta forma:',
    '',
    '```json',
    '{"tool": "read_file", "arguments": {"path": "src/index.ts"}}',
    '```',
    '',
    'Usa una herramienta por mensaje y espera su resultado antes de continuar.',
    'Cuando hayas terminado, responde con texto normal explicando lo que hiciste,',
    'sin ningun bloque json.',
    '',
    'Herramientas disponibles:',
    catalogo,
  ].join('\n');
}

/**
 * extrae una llamada del texto del modelo.
 *
 * tolerante a propósito: acepta el bloque ```json, un bloque sin etiqueta, y un
 * objeto suelto. Devuelve null si no hay ninguna llamada, que es como se
 * reconoce la respuesta final.
 */
export function parseFallbackToolCall(text: string): ToolCall | null {
  // algunos modelos ignoran el formato pedido y emiten su propio pseudo-XML.
  // step-3.5-flash lo hace: comprobado con una llamada real el 2026-07-28.
  const xml = parseXmlToolCall(text);
  if (xml !== null) return xml;

  for (const candidate of extractJsonCandidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = fallbackCallSchema.safeParse(parsed);
    if (result.success) {
      return { id: `fallback_${result.data.tool}`, name: result.data.tool, arguments: result.data.arguments };
    }
  }
  return null;
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];

  // 1. bloques de codigo con o sin etiqueta de lenguaje
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = match[1]?.trim();
    if (body !== undefined && body.length > 0) candidates.push(body);
  }

  // 2. un objeto suelto que mencione "tool".
  //
  // hace falta contar llaves: {"tool":"x","arguments":{}} tiene un objeto
  // anidado, y una expresion regular perezosa corta en la llave interior y
  // produce JSON invalido.
  const loose = extractBalancedObject(text);
  if (loose !== null) candidates.push(loose);

  return candidates;
}

/** primer objeto JSON balanceado que contenga la clave "tool" */
function extractBalancedObject(text: string): string | null {
  const marker = text.indexOf('"tool"');
  if (marker === -1) return null;

  const start = text.lastIndexOf('{', marker);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * llamada en el pseudo-XML que usan varios modelos chinos:
 *
 *   <tool_call> <function=read_file> <parameter=path> src/index.ts
 *
 * no es XML valido -las etiquetas no siempre cierran-, asi que se extrae con
 * expresiones regulares en vez de intentar parsearlo como documento.
 */
export function parseXmlToolCall(text: string): ToolCall | null {
  if (!/<tool_call>/i.test(text)) return null;

  const fn = /<function\s*=\s*([a-z0-9_]+)\s*>/i.exec(text);
  if (fn === null) return null;

  const args: Record<string, string> = {};
  for (const match of text.matchAll(
    /<parameter\s*=\s*([a-z0-9_]+)\s*>\s*([\s\S]*?)(?=<parameter|<\/|<function|$)/gi,
  )) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) args[name] = value.trim();
  }

  return { id: `xml_${fn[1]!}`, name: fn[1]!, arguments: args };
}

/** true si la respuesta parece final, es decir, sin ninguna llamada */
export function looksFinal(text: string): boolean {
  return parseFallbackToolCall(text) === null;
}
