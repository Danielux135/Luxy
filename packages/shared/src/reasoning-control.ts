// control del razonamiento POR MODELO para las conexiones `chat completions`.
//
// POR QUE EXISTE (D-107): el contrato de OpenAI no tiene un campo comun para
// esto, pero los proveedores si lo documentan, cada uno a su manera: DeepSeek,
// GLM, MiMo y MiniMax con `thinking`, Kimi y GLM-5.3 con `reasoning_effort`,
// Qwen con `enable_thinking` o `chat_template_kwargs`, Groq con
// `reasoning_effort` y `reasoning_format`. Daniel lo pidio PARA PROBARLO, sin
// estar seguro de que la pasarela lo deje pasar; por eso todo lo que se manda
// queda apuntado en el registro y hay un veredicto numerico de si razono.
//
// TRES REGLAS que no se pueden aflojar:
//
// 1. vacio no manda nada: sin `reasoningMode` el cuerpo sale igual que hoy,
//    byte por byte (D-098);
// 2. solo se ofrece lo que la documentacion oficial de ESE modelo admite. Un
//    modelo sin regla no recibe nada aunque alguien escriba el valor a mano en
//    `config.json`: mejor no mandar nada que provocar un 400;
// 3. los nombres casan ENTEROS. Una regla con prefijo atrapaba variantes que la
//    documentacion no cubre —`glm-5.3-air` caia en la regla de los GLM que SI se
//    pueden apagar, y en la serie 5.3 apagarlo da error—, asi que un nombre con
//    sufijo de agregador (`-promo`, `-free`, `-alibaba`) se queda sin regla.
//
// Aqui solo hay Zod y logica pura: lo consumen el agente y el renderer.
import { z } from 'zod';

export const REASONING_MODES = ['off', 'low', 'high'] as const;
export type ReasoningMode = (typeof REASONING_MODES)[number];

export const reasoningModeSchema = z.enum(REASONING_MODES);

/**
 * como se nombra cada valor en pantalla.
 *
 * `low` y `high` llevan el nombre tecnico entre parentesis porque NO son
 * relativos a lo que el modelo hace de fabrica: en Kimi y en GLM-5.3 el nivel
 * de fabrica es `max`, asi que «Razonar mas» tambien es menos que lo de siempre.
 */
export const REASONING_MODE_LABELS: Readonly<Record<ReasoningMode, string>> = {
  off: 'Sin razonar: contesta directamente',
  low: 'Razonar poco (low)',
  high: 'Razonar más (high)',
};

/** resumen corto para la lista de una conexion */
export const REASONING_MODE_SHORT: Readonly<Record<ReasoningMode, string>> = {
  off: 'sin razonar',
  low: 'poco (low)',
  high: 'más (high)',
};

type JsonFields = Readonly<Record<string, unknown>>;

interface ReasoningRule {
  /** identificador estable de la regla; no viaja al cuerpo */
  family: string;
  /** nombre EXACTO del modelo, sin distinguir mayusculas */
  pattern: RegExp;
  /**
   * hosts en los que vale la regla. Sin lista, vale en cualquiera.
   *
   * Existe por los nombres con barra: `openai/gpt-oss-20b` es tambien un nombre
   * de OpenRouter, que tiene su propio dialecto. Si otro servidor usa el mismo
   * nombre, no se le manda el campo de Groq.
   */
  hosts?: readonly string[];
  /** lo que viaja en la RAIZ del cuerpo para cada valor admitido */
  modes: Readonly<Partial<Record<ReasoningMode, JsonFields>>>;
  /** lo que tiene que saber quien lo elige, en castellano llano */
  note: string;
}

const THINKING_OFF: JsonFields = { thinking: { type: 'disabled' } };

// ORDEN: se prueba de arriba abajo y gana la primera. Con los nombres anclados
// no deberia importar, pero las reglas que NO admiten apagar van antes que las
// que si, para que un error futuro en una expresion falle hacia no ofrecerlo.
const RULES: readonly ReasoningRule[] = [
  {
    // https://api-docs.deepseek.com/guides/thinking_mode — `thinking.type`
    // enabled|disabled, activado por defecto con esfuerzo `high`.
    //
    // SOLO APAGAR, y es a proposito. Medido en luxy.log: por la pasarela de
    // Daniel, 38 de 39 llamadas de DeepSeek-V4 no razonaron (3,07-3,61
    // caracteres por token, 0 de razonamiento). Ofrecer low/high lo
    // ENCENDERIA, y la misma pagina dice que con `tools` hay que devolverle
    // `reasoning_content` en cada peticion siguiente o contesta 400; Luxy no lo
    // devuelve. Seria un fallo nuevo en los trabajos con herramientas, ademas
    // de dejar sin efecto la temperatura, que D-102 esta midiendo.
    //
    // Los tres nombres de la tabla de `D-107`, y ninguno mas: la expresion de
    // antes tambien aceptaba `DeepSeek-V4.1-Pro`, que no esta ni en la tabla ni
    // comprobado en la documentacion: el principio de `D-107`, solo lo que la
    // documentacion de ese modelo admite (septima ronda).
    family: 'deepseek',
    pattern: /^deepseek-(v4-(flash|pro)|v4\.1-flash)$/i,
    modes: { off: THINKING_OFF },
    // la medida es de UNA pasarela y de un dia: la regla vale en cualquier host,
    // y no puede afirmarla de una conexion donde no se midio nada
    note:
      'Sólo se ofrece apagarlo. Medido el 28/09 en tu pasarela de entonces: DeepSeek casi nunca ' +
      'razonaba (38 de 39 llamadas); en otra conexión no se ha medido. Pedirle que razone lo ' +
      'encendería, dejaría sin efecto la temperatura y, en los ' +
      'trabajos con herramientas, DeepSeek exige que se le devuelva su razonamiento, cosa que Luxy ' +
      'no hace: fallaría con un error.',
  },
  {
    // https://docs.z.ai/guides/capabilities/thinking — «GLM-5.3 and
    // GLM-5.3-FLASH no longer support disabling thinking (an error will
    // occur...)»; `reasoning_effort` max (defecto), high y low.
    family: 'glm-5.3',
    pattern: /^glm-5\.3(-flash)?$/i,
    modes: { low: { reasoning_effort: 'low' }, high: { reasoning_effort: 'high' } },
    note:
      'Este modelo razona siempre: se puede bajar, no apagar. De fábrica razona al máximo, así ' +
      'que «Razonar más (high)» también es menos que lo de siempre.',
  },
  {
    // misma pagina: GLM-5.2 si se puede apagar, y admite `reasoning_effort`
    // max (defecto), xhigh, high, medium, minimal y none —`low` NO—.
    family: 'glm-5.2',
    pattern: /^glm-5\.2$/i,
    modes: { off: THINKING_OFF, high: { reasoning_effort: 'high' } },
    note:
      'Se puede apagar o fijar en «high». No admite «low». De fábrica razona al máximo, así que ' +
      '«high» también es menos que lo de siempre.',
  },
  {
    // misma pagina: GLM-5.1, GLM-5, GLM-4.6 y GLM-4.5 se pueden apagar con
    // `thinking`, y `reasoning_effort` es solo de la 5.2 en adelante. El `$`
    // es lo que impide que `glm-5.3-lo-que-sea` caiga aqui por el `5`.
    family: 'glm',
    pattern: /^glm-(4\.5|4\.6|5|5\.1)$/i,
    modes: { off: THINKING_OFF },
    note: 'Sólo se puede apagar.',
  },
  {
    // https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model — en
    // kimi-k3 el razonamiento va «always on», no se debe mandar `thinking`, y
    // `reasoning_effort` admite low, high y max (defecto).
    family: 'kimi-k3',
    pattern: /^kimi-k3$/i,
    modes: { low: { reasoning_effort: 'low' }, high: { reasoning_effort: 'high' } },
    note:
      'Este modelo razona siempre: se puede bajar, no apagar. De fábrica razona al máximo, así ' +
      'que «Razonar más (high)» también es menos que lo de siempre.',
  },
  {
    // https://mimo.mi.com/docs/en-US/api/chat/openai-api — `thinking.type`
    // enabled (defecto) o disabled en mimo-v2.6-flash, v2.6-pro,
    // v2.6-pro-ultraspeed, v2.5-pro y v2.5. No documenta `reasoning_effort`.
    family: 'mimo',
    pattern: /^mimo-v2\.(5|5-pro|6-flash|6-pro|6-pro-ultraspeed)$/i,
    modes: { off: THINKING_OFF },
    note:
      'Sólo se puede apagar. Con el razonamiento puesto, MiMo fija la temperatura en 1,0: ' +
      'apagarlo es lo que deja medir la temperatura.',
  },
  {
    // https://platform.minimax.io/docs/api-reference/text-openai-api — en
    // MiniMax-M3 omitir `thinking` lo deja encendido y `{type:'disabled'}` lo
    // apaga. MiniMax-M3.1-Flash-Preview NO se puede apagar (400): por eso el
    // nombre va entero.
    family: 'minimax-m3',
    pattern: /^minimax-m3$/i,
    modes: { off: THINKING_OFF },
    note: 'Sólo se puede apagar.',
  },
  {
    // https://docs.qwencloud.com/developer-guides/text-generation/thinking —
    // `enable_thinking` en la raiz (el `extra_body` del SDK de Python se vuelca
    // ahi). vLLM lo lee de `chat_template_kwargs.enable_thinking`
    // (https://docs.vllm.ai/en/latest/features/reasoning_outputs/). La pasarela
    // no dice que motor hay detras, asi que se mandan LAS DOS formas: pedir una
    // sola y equivocarse da un «apagado» que no apaga nada y que nadie ve; un
    // servidor estricto que rechace la otra contesta un 4xx, que no se reintenta
    // ni se cobra, y el registro lo dice.
    //
    // Solo apagar: en qwen3.8-max la documentacion leida se contradice sobre si
    // viene encendido y su `reasoning_effort` no tiene `high` (low, medium,
    // xhigh), asi que lo unico seguro con los tres es apagarlo. Qwen3.8-Flash-Next
    // NO esta en la documentacion y se queda sin regla.
    family: 'qwen',
    pattern: /^qwen3\.8-(27b|flash|max)$/i,
    modes: {
      off: { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } },
    },
    note:
      'Sólo se puede apagar. Se envían las dos formas que usan los servidores de Qwen. Si la ' +
      'pasarela contesta con un error, vuelve a «Lo que traiga el modelo».',
  },
  {
    // https://console.groq.com/docs/reasoning — Qwen 3.8 27B admite
    // `reasoning_effort` none, default, low, medium y high. Su
    // `reasoning_format` por defecto es `raw`: el razonamiento llega DENTRO de
    // la respuesta, entre <think>. Por eso low y high piden ademas `parsed`, que
    // lo manda aparte en `reasoning`; con `none` no hay razonamiento que apartar.
    family: 'groq-qwen',
    pattern: /^qwen\/qwen3\.8-27b$/i,
    hosts: ['api.groq.com'],
    modes: {
      off: { reasoning_effort: 'none' },
      low: { reasoning_effort: 'low', reasoning_format: 'parsed' },
      high: { reasoning_effort: 'high', reasoning_format: 'parsed' },
    },
    note:
      'En Groq. Con «Razonar poco» o «Razonar más», Luxy pide además que el razonamiento llegue ' +
      'aparte y no mezclado con la respuesta.',
  },
  {
    // misma pagina: gpt-oss admite low, medium y high —ni none ni default—, y
    // no admite `reasoning_format`. Su razonamiento llega en `reasoning`.
    family: 'groq-gpt-oss',
    pattern: /^openai\/gpt-oss-(20b|120b)$/i,
    hosts: ['api.groq.com'],
    modes: { low: { reasoning_effort: 'low' }, high: { reasoning_effort: 'high' } },
    note: 'En Groq. gpt-oss razona siempre: se puede bajar o subir, no apagar.',
  },
];

/** host sin puerto y en minusculas; acepta tambien una URL entera */
function bareHost(host: string | null | undefined): string | null {
  if (host === null || host === undefined || host.length === 0) return null;
  let value = host.trim().toLowerCase();
  const scheme = value.indexOf('://');
  if (scheme >= 0) value = value.slice(scheme + 3);
  const slash = value.indexOf('/');
  if (slash >= 0) value = value.slice(0, slash);
  const at = value.lastIndexOf('@');
  if (at >= 0) value = value.slice(at + 1);
  const colon = value.indexOf(':');
  if (colon >= 0) value = value.slice(0, colon);
  return value.length === 0 ? null : value;
}

function ruleFor(model: string, host: string | null | undefined): ReasoningRule | null {
  const name = model.trim();
  if (name.length === 0) return null;
  const bare = bareHost(host);
  for (const rule of RULES) {
    if (!rule.pattern.test(name)) continue;
    if (rule.hosts !== undefined && (bare === null || !rule.hosts.includes(bare))) continue;
    return rule;
  }
  return null;
}

/**
 * los valores que se pueden ofrecer para este modelo en este host, en orden.
 * Vacio = no hay regla y el selector no ofrece nada.
 */
export function reasoningOptionsFor(
  model: string,
  host: string | null | undefined,
): readonly ReasoningMode[] {
  const rule = ruleFor(model, host);
  if (rule === null) return [];
  return REASONING_MODES.filter((mode) => Object.hasOwn(rule.modes, mode));
}

/** lo que hay que saber de la regla de este modelo, o null si no la tiene */
export function reasoningNoteFor(model: string, host: string | null | undefined): string | null {
  return ruleFor(model, host)?.note ?? null;
}

/**
 * los campos que viajan en la RAIZ del cuerpo, y nada si no hay que mandar nada.
 *
 * Sin modo, sin regla o con un valor que la regla no admite, devuelve `{}`: el
 * cuerpo sale como hoy. Devuelve una COPIA: el cuerpo se serializa despues y
 * nadie debe poder tocar la tabla por accidente.
 */
export function reasoningRequestFields(
  model: string,
  host: string | null | undefined,
  mode: ReasoningMode | undefined,
): Record<string, unknown> {
  if (mode === undefined) return {};
  const rule = ruleFor(model, host);
  if (rule === null || !Object.hasOwn(rule.modes, mode)) return {};
  const fields = rule.modes[mode];
  return fields === undefined
    ? {}
    : (JSON.parse(JSON.stringify(fields)) as Record<string, unknown>);
}

/** valor de `reasoningSent` cuando se eligio un modo y no viajo nada */
export const REASONING_NOT_SENT = 'not_sent';

/**
 * lo que se eligio y lo que viajo, para la linea de registro.
 *
 * SIN modo no añade ninguna clave: la linea sale como antes. Con modo, apunta
 * el elegido y las CLAVES de primer nivel que viajaron unidas con «+», o
 * `not_sent` si no viajo ninguna. Nunca valores de texto libre.
 */
export function reasoningLogFields(
  model: string,
  host: string | null | undefined,
  mode: ReasoningMode | undefined,
): { reasoningMode?: ReasoningMode; reasoningSent?: string } {
  if (mode === undefined) return {};
  const keys = Object.keys(reasoningRequestFields(model, host, mode));
  return {
    reasoningMode: mode,
    reasoningSent: keys.length === 0 ? REASONING_NOT_SENT : keys.join('+'),
  };
}

/**
 * bloques de razonamiento dentro del propio `content`.
 *
 * Es la misma forma que aparta `splitReasoning` en vault-describe.ts: `<think>`
 * (Qwen, DeepSeek, MiniMax sin `reasoning_split`, Groq con `raw`), y
 * `<thinking>` o `<reasoning>` en otros. El cierre es opcional: un modelo
 * cortado a mitad deja el bloque abierto.
 */
const REASONING_TAG = /<(think|thinking|reasoning)>([\s\S]*?)(?:<\/\1>|$)/gi;
const REASONING_OPEN = /<(think|thinking|reasoning)>/i;
const REASONING_CLOSE = /<\/(think|thinking|reasoning)>/i;
/** un bloque de codigo cerrado, y un fragmento de codigo en la misma linea */
const CODE_FENCE = /```[\s\S]*?```/g;
const CODE_SPAN = /`[^`\n]*`/g;

/**
 * caracteres que hay DENTRO de esos bloques, sin contar espacios ni saltos de
 * los extremos. Solo cuenta: no guarda nada.
 *
 * Dos formas que antes salian al reves (septima ronda):
 *
 *  - un bloque VACIO —`<think>\n\n</think>`, lo que deja un Qwen3 hibrido con
 *    el razonamiento apagado cuando el servidor no lo aparta— no es razonamiento
 *    y no puede dar `visible`;
 *  - una respuesta que trae el CIERRE sin la apertura, porque la plantilla puso
 *    `<think>` en el prompt (familia R1, QwQ, variantes «Thinking»): todo lo de
 *    antes del cierre es razonamiento, y contarlo como texto subia el cociente
 *    hasta `not_seen`.
 */
export function countReasoningTagChars(original: string): number {
  // una etiqueta CITADA no es razonamiento: una respuesta que explica el
  // formato, o un trabajo sobre el propio repositorio de Luxy, que las nombra
  // en su codigo, salia con `think` y `visible` sin haber razonado (octava
  // ronda). Lo que se cita va entre acentos graves; lo de dentro de un bloque
  // de codigo o de un `span` no se mira
  const text = original.replace(CODE_FENCE, ' ').replace(CODE_SPAN, ' ');
  let total = 0;
  const close = REASONING_CLOSE.exec(text);
  const open = REASONING_OPEN.exec(text);
  let rest = text;
  if (close !== null && (open === null || open.index > close.index)) {
    total += text.slice(0, close.index).trim().length;
    rest = text.slice(close.index + close[0].length);
  }
  for (const match of rest.matchAll(REASONING_TAG)) total += (match[2] ?? '').trim().length;
  return total;
}

/**
 * umbrales del cociente caracteres visibles / tokens de salida.
 *
 * Salen de lo medido en luxy.log el 2026-09-28: sin razonar, la prosa en
 * español da de 3,07 a 3,77 caracteres por token (unas 40 llamadas de
 * DeepSeek-V4 por la pasarela y de Qwen por Groq); con razonamiento que no
 * llega, Qwen3.8-27B por la pasarela da de 0,10 a 1,68 y gpt-oss por Groq de
 * 0,23 a 1,48; kimi-k3, con muy poco razonamiento visible, de 2,83 a 3,15.
 * Entre los dos umbrales no se puede decir.
 */
export const HIDDEN_REASONING_MAX_RATIO = 2.0;
export const NO_HIDDEN_REASONING_MIN_RATIO = 2.8;

/**
 * por debajo de esta prosa, una vuelta que pide herramientas no se puede juzgar.
 *
 * Los tokens de una llamada a herramienta incluyen su ENVOLTURA —en DeepSeek
 * `<｜tool▁calls▁begin｜>…<｜tool▁call▁end｜>`, en gpt-oss el canal `commentary`
 * con `<|call|>`—, que no llega en `name + arguments`, y la pasarela suele
 * volver a serializar los argumentos mas compactos. Con una llamada corta el
 * cociente cae por debajo de 2,0 sin que nadie haya razonado: un falso
 * `hidden`. Con prosa de sobra alrededor, la envoltura pesa poco. NO esta
 * medido: `luxy.log` no tenia ninguna llamada con `tool_calls` (septima ronda).
 */
export const TOOL_TURN_PROSE_MIN_CHARS = 400;

/**
 * por debajo de estos tokens de salida, el cociente no se juzga.
 *
 * Con una salida corta —«Hecho.», «Listo», un JSON breve— el token de fin y
 * como se trocea una palabra suelta pesan mas que la prosa: 6 caracteres en 4
 * tokens dan 1,5 y salian `hidden` sin que nadie hubiera razonado (octava
 * ronda). Los umbrales de arriba se midieron con respuestas largas. Un
 * razonamiento oculto de verdad gasta cientos de tokens, asi que por encima de
 * este suelo se sigue viendo. Es un CRITERIO, no una medida.
 */
export const REASONING_JUDGE_MIN_OUTPUT = 64;

export type ReasoningVerdict =
  /** el proveedor dijo cuantos tokens razono */
  | 'counted'
  /** llego razonamiento que se ve: en un campo aparte o entre etiquetas */
  | 'visible'
  /** sin consumo final o sin tokens de salida: no hay contra que medir */
  | 'no_data'
  /**
   * muchos mas tokens que caracteres, con salida de sobra para medir:
   * probablemente razono sin enseñarlo. Es una deduccion del cociente
   */
  | 'hidden'
  /**
   * entre los dos umbrales, una vuelta que pide herramientas con poca prosa
   * —ahi la envoltura de la llamada gasta tokens que no se ven— o una salida de
   * menos de `REASONING_JUDGE_MIN_OUTPUT` tokens
   */
  | 'unclear'
  /**
   * cociente de prosa normal. NO significa «no razono»: un razonamiento de
   * menos del 15-20 % de la salida no se distingue.
   */
  | 'not_seen';

export interface ReasoningEvidenceInput {
  outputTokens: number;
  /** llego el consumo final: sin el, `outputTokens` puede ser parcial */
  finalUsageReceived: boolean;
  /** caracteres de `content`, etiquetas incluidas */
  textChars: number;
  /** caracteres de nombres y argumentos de herramientas pedidas */
  toolArgChars: number;
  /** caracteres de `reasoning_content` y `reasoning` */
  reasoningChars: number;
  /** caracteres dentro de <think> y compañia en `content` */
  reasoningTagChars: number;
  /** `completion_tokens_details.reasoning_tokens`, 0 si no vino */
  reasoningTokensReported: number;
}

export interface ReasoningEvidence {
  reasoningVerdict: ReasoningVerdict;
  /**
   * (texto + argumentos de herramientas) / tokens de salida, con dos decimales,
   * o null si no hay contra que medir.
   *
   * Se llama asi y no `visiblePorToken`: `redactDeep` tapa cualquier clave que
   * acabe en `Token`/`Tokens`, y la unica cifra de la prueba saldria a disco
   * como «[REDACTADO]».
   *
   * LOS ARGUMENTOS DE HERRAMIENTAS CUENTAN porque tambien son salida. Pero
   * contarlos NO basta para evitar el falso «oculto» en una vuelta que solo pide
   * una herramienta: su envoltura gasta tokens que no llegan como texto. Por eso
   * esa vuelta, con menos de `TOOL_TURN_PROSE_MIN_CHARS` de prosa, sale
   * `unclear` (septima ronda).
   */
  charsPerOutput: number | null;
}

export function classifyReasoningEvidence(input: ReasoningEvidenceInput): ReasoningEvidence {
  const tokens = input.outputTokens;
  const ratio =
    input.finalUsageReceived && tokens > 0
      ? Math.round(((input.textChars + input.toolArgChars) / tokens) * 100) / 100
      : null;
  if (input.reasoningTokensReported > 0)
    return { reasoningVerdict: 'counted', charsPerOutput: ratio };
  if (input.reasoningChars > 0 || input.reasoningTagChars > 0) {
    return { reasoningVerdict: 'visible', charsPerOutput: ratio };
  }
  if (ratio === null) return { reasoningVerdict: 'no_data', charsPerOutput: null };
  if (input.toolArgChars > 0 && input.textChars < TOOL_TURN_PROSE_MIN_CHARS) {
    return { reasoningVerdict: 'unclear', charsPerOutput: ratio };
  }
  if (tokens < REASONING_JUDGE_MIN_OUTPUT) {
    return { reasoningVerdict: 'unclear', charsPerOutput: ratio };
  }
  if (ratio <= HIDDEN_REASONING_MAX_RATIO)
    return { reasoningVerdict: 'hidden', charsPerOutput: ratio };
  if (ratio >= NO_HIDDEN_REASONING_MIN_RATIO) {
    return { reasoningVerdict: 'not_seen', charsPerOutput: ratio };
  }
  return { reasoningVerdict: 'unclear', charsPerOutput: ratio };
}
