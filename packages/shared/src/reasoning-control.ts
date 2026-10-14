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
// HAY DOS CAMINOS, y un host va solo por uno de ellos:
//
//  - la TABLA (`RULES`): cada modelo con lo que dice la documentacion de su
//    fabricante. Es el camino de siempre y el de casi todos los hosts;
//  - un DIALECTO DE CATALOGO (`CATALOG_DIALECTS`, F36): una pasarela que publica
//    en su propio catalogo que niveles declara cada modelo y que los pide todos
//    con un unico campo. En esos hosts la tabla NO se consulta.
//
// TRES REGLAS que no se pueden aflojar EN LA TABLA:
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
// EN UN HOST CON DIALECTO DE CATALOGO la regla 1 vale igual y la 2 se SUSTITUYE
// a proposito. Alli hay cientos de modelos que cambian sin avisar, y lo que se
// ofrece sale de lo que DECLARA el catalogo de la pasarela, no de una tabla
// escrita a mano. Pero el agente no conoce el catalogo, asi que no puede
// comprobar el nivel contra el: lo que decide si algo viaja es que el modelo
// tenga su ajuste PROPIO (`modelSampling`). Un nivel desfasado o escrito a mano
// DENTRO de ese ajuste viaja, y decide la pasarela. A cambio:
//
//  - el modo de nivel de proveedor no viaja nunca en esos hosts: vale para
//    todos los modelos de la entrada y nadie lo eligio mirando lo que declara
//    cada uno;
//  - en una LLAMADA cuyo cuerpo lleva `tools` solo viaja «off»: DeepSeek
//    documenta que, razonando y con `tools`, hay que devolverle su razonamiento
//    en cada peticion o contesta 400, y Luxy no lo devuelve (`D-107`). Por una
//    pasarela no esta medido, asi que en esa llamada cualquier otro nivel NO SE
//    ENVIA. Que no es apagarlo: el campo se omite y el modelo hace lo que
//    traiga de fabrica. La compuerta es de la llamada y no del trabajo: con las
//    herramientas como texto (el protocolo de reserva del agente) el cuerpo no
//    lleva `tools`, y el nivel viaja en cada vuelta.
//
// Aqui solo hay Zod y logica pura: lo consumen el agente y el renderer.
import { z } from 'zod';

/**
 * EL ORDEN IMPORTA: es de menos a mas razonamiento, y es el orden en el que
 * salen las opciones del selector y lo que devuelve `reasoningModesFromDeclared`.
 *
 * `off` no se llama `none` a proposito: `none` es un valor REAL del cuerpo
 * (`reasoning_effort: 'none'`), y con el mismo nombre alguien acabaria
 * volcando la eleccion cruda.
 */
export const REASONING_MODES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningMode = (typeof REASONING_MODES)[number];

export const reasoningModeSchema = z.enum(REASONING_MODES);

/**
 * como se nombra cada valor en pantalla.
 *
 * todos menos `off` llevan el nombre tecnico entre parentesis porque NO son
 * relativos a lo que el modelo hace de fabrica: en Kimi y en GLM-5.3 el nivel
 * de fabrica es `max`, asi que «Razonar mas» tambien es menos que lo de siempre.
 *
 * Que un valor este aqui no significa que se le ofrezca a nadie: las reglas de
 * la tabla siguen ofreciendo solo `off`, `low` y `high`, y los otros cuatro
 * solo aparecen donde el catalogo de una pasarela los declara.
 */
export const REASONING_MODE_LABELS: Readonly<Record<ReasoningMode, string>> = {
  off: 'Sin razonar: contesta directamente',
  minimal: 'Razonar lo mínimo (minimal)',
  low: 'Razonar poco (low)',
  medium: 'Razonar a medias (medium)',
  high: 'Razonar más (high)',
  xhigh: 'Razonar mucho (xhigh)',
  max: 'Razonar al máximo (max)',
};

/** resumen corto para la lista de una conexion o de un proveedor */
export const REASONING_MODE_SHORT: Readonly<Record<ReasoningMode, string>> = {
  off: 'sin razonar',
  minimal: 'lo mínimo (minimal)',
  low: 'poco (low)',
  medium: 'a medias (medium)',
  high: 'más (high)',
  xhigh: 'mucho (xhigh)',
  max: 'al máximo (max)',
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
    // occur...)»; y https://docs.z.ai/api-reference/llm/chat-completion: en
    // `GLM-5.3` y `GLM-5.3-FLASH` «only the `low` / `high` / `max` levels are
    // supported», con `max` de fabrica. Releido el 29/09.
    family: 'glm-5.3',
    pattern: /^glm-5\.3(-flash)?$/i,
    modes: { low: { reasoning_effort: 'low' }, high: { reasoning_effort: 'high' } },
    note:
      'Este modelo razona siempre: se puede bajar, no apagar. De fábrica razona al máximo, así ' +
      'que «Razonar más (high)» también es menos que lo de siempre.',
  },
  {
    // las dos paginas de arriba: GLM-5.2 se puede apagar —el ejemplo de
    // «Disable deep thinking» de la guia es justo `glm-5.2` con
    // `thinking:{type:'disabled'}`— y su `reasoning_effort` acepta max
    // (defecto), xhigh, high, medium, low, minimal y none, pero «`low` and
    // `medium` will be mapped to `high`; `xhigh` will be mapped to `max`». Asi
    // que `low` SI se acepta y no se ofrece: «Razonar poco» prometeria menos de
    // lo que hace, que es lo mismo que «high» (`D-093`, novena ronda; antes la
    // nota decia que no lo admitia, y es falso).
    family: 'glm-5.2',
    pattern: /^glm-5\.2$/i,
    modes: { off: THINKING_OFF, high: { reasoning_effort: 'high' } },
    note:
      'Se puede apagar o fijar en «high». «Razonar poco (low)» no se ofrece porque Z.AI lo trata ' +
      'igual que «high». De fábrica razona al máximo, así que «high» también es menos que lo ' +
      'de siempre.',
  },
  {
    // La documentacion de Z.AI SE CONTRADICE aqui, y la regla se queda por lo
    // que dice la de ESE modelo (el principio de `D-107`), con la contradiccion
    // escrita en la nota (novena ronda):
    //
    //  - en contra: el encabezado de https://docs.z.ai/guides/capabilities/thinking
    //    es «Disable deep thinking (GLM-5.3 is no longer supported, only GLM-5.2
    //    supports it)», y de estos cuatro solo dice que deciden solos si razonan;
    //  - a favor, la pagina de cada modelo: https://docs.z.ai/guides/llm/glm-4.5
    //    dice que el modo de razonamiento se puede «enable or disable by setting
    //    the `thinking.type` parameter»; https://docs.z.ai/guides/llm/glm-4.6,
    //    https://docs.z.ai/guides/llm/glm-5 y https://docs.z.ai/guides/llm/glm-5.1
    //    llevan, con su propio nombre de modelo, `thinking` con el comentario
    //    «Optional: "disabled" or "enabled", default is "enabled"»;
    //  - y https://docs.z.ai/api-reference/llm/chat-completion: `thinking.type`
    //    es `enabled` o `disabled`, y la unica serie que «can only be enabled»
    //    es la 5.3.
    //
    // Tres fuentes, dos de ellas del propio modelo, contra un encabezado que
    // parece hablar de la ultima generacion. Si aun asi la pasarela contesta un
    // 4xx, no se reintenta ni se cobra, el registro lo dice y la nota dice como
    // volver. `reasoning_effort` es solo de la 5.2 en adelante. El `$` es lo que
    // impide que `glm-5.3-lo-que-sea` caiga aqui por el `5`.
    family: 'glm',
    pattern: /^glm-(4\.5|4\.6|5|5\.1)$/i,
    modes: { off: THINKING_OFF },
    note:
      'Sólo se puede apagar. La página de este modelo en Z.AI lo admite, aunque su guía de ' +
      'razonamiento solo lo nombra para GLM-5.2. Si la pasarela contesta con un error, vuelve a ' +
      '«Lo que traiga el modelo».',
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

/**
 * host sin puerto y en minusculas; acepta tambien una URL entera.
 *
 * SE EXPORTA porque de aqui sale que camino le toca a un host —la tabla o un
 * dialecto de catalogo—, y quien pide el catalogo, quien pinta el selector y
 * quien compone el cuerpo tienen que estar mirando el mismo host.
 *
 * La autoridad de una URL acaba en la primera `/`, `?` o `#`, y los navegadores
 * tratan `\` como `/`. Antes solo se cortaba en `/`; como lo que va detras de
 * la ultima `@` se toma por host, `https://otro.example?x=@api.nano-gpt.com`
 * salia como si fuera la pasarela.
 *
 * El esquema solo se reconoce al PRINCIPIO. Antes valia el primer `://` de
 * cualquier parte, y donde la cadena no empieza por `esquema://` —un host a
 * secas, o `https:otro.example`, que `URL` acepta sin las barras— el de la
 * consulta se tomaba por el suyo: `otro.example?next=https://api.nano-gpt.com`
 * salia como la pasarela. Lo que no empieza por un esquema se lee desde su
 * primer caracter, asi que nada de lo que va detras de la primera `/`, `?` o
 * `#` puede salir como host. Es hacia donde hay que fallar: una cadena que no
 * se sabe leer puede quedarse sin casar con ningun host —y entonces no viaja
 * nada—, pero no casar con la pasarela por lo que lleve detras.
 *
 * Y se quita UN punto final: `api.nano-gpt.com.` es el mismo servidor con el
 * nombre escrito entero, y `URL` conserva ese punto en `host`. Uno solo: con
 * dos ya no es un nombre de host, y se queda sin casar.
 */
export function bareHost(host: string | null | undefined): string | null {
  if (host === null || host === undefined || host.length === 0) return null;
  let value = host.trim().toLowerCase();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//.exec(value);
  if (scheme !== null) value = value.slice(scheme[0].length);
  const end = value.search(/[/\\?#]/);
  if (end >= 0) value = value.slice(0, end);
  const at = value.lastIndexOf('@');
  if (at >= 0) value = value.slice(at + 1);
  const colon = value.indexOf(':');
  if (colon >= 0) value = value.slice(0, colon);
  if (value.endsWith('.')) value = value.slice(0, -1);
  return value.length === 0 ? null : value;
}

/**
 * una pasarela cuyo CATALOGO dice que niveles declara cada modelo, y que los
 * pide todos con un unico campo.
 *
 * POR QUE NO ES UNA REGLA MAS DE LA TABLA: la tabla nombra modelos uno a uno
 * con la documentacion de su fabricante. Una pasarela de cientos de modelos,
 * que entran y salen sin avisar, no cabe ahi; pero publica ella misma lo que
 * declara de cada uno, y eso es un dato suyo, con su fecha, no una deduccion
 * nuestra. Lo que se guarda aqui es solo COMO se le pide.
 */
export interface CatalogDialect {
  /** identificador estable; no viaja al cuerpo */
  family: string;
  /** como se la nombra en los textos de pantalla */
  label: string;
  /**
   * hosts EXACTOS en los que vale. Sin comodines ni sufijos: un host parecido
   * (`api.nano-gpt.com.otro.example`) no es la pasarela.
   */
  hosts: readonly string[];
  /** nombre del campo, en la RAIZ del cuerpo */
  field: string;
  /**
   * lo que viaja en ese campo para cada modo, que es tambien como lo escribe su
   * catalogo: con esto se traduce en los dos sentidos
   */
  values: Readonly<Record<ReasoningMode, string>>;
  /** parametros de consulta con los que su lista de modelos trae el detalle */
  catalogQuery: Readonly<Record<string, string>>;
}

const CATALOG_DIALECTS: readonly CatalogDialect[] = [
  {
    // https://docs.nano-gpt.com/api-reference/miscellaneous/extended-thinking.md
    // (leido el 13/10/2026): «NanoGPT accepts `none`, `minimal`, `low`,
    // `medium`, `high`, `xhigh`, and `max`. Not every model supports every
    // level; some routes map an accepted level to the nearest supported
    // effort», y si llegan los dos, «top-level `reasoning_effort` is
    // authoritative». `max` esta en esa pagina y en el catalogo, no en el
    // esquema publicado de su API.
    //
    // Los dos hosts salen de .../miscellaneous/api-hosts.md: el directo para
    // las claves de API y el de la web, con la misma ruta `/api/v1`.
    //
    // El detalle del catalogo se pide con `detailed=true`
    // (.../endpoint/models.md). La lectura previa de F36 apunto, medido ese
    // dia contra la lista publica, que solo vale ese literal: `detailed=1` y
    // `detailed=TRUE` devolvian la simple. Los niveles por modelo vienen en
    // `reasoning_efforts`, un campo que esa pagina NO documenta: puede faltar o
    // cambiar, y por eso todo lo que lo lee aguanta que no este.
    //
    // NADA de esto esta comprobado con una llamada de inferencia.
    family: 'nanogpt',
    label: 'NanoGPT',
    hosts: ['api.nano-gpt.com', 'nano-gpt.com'],
    field: 'reasoning_effort',
    values: {
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    },
    catalogQuery: { detailed: 'true' },
  },
];

/** el dialecto de catalogo de este host, o null si va por la tabla */
export function catalogDialectFor(host: string | null | undefined): CatalogDialect | null {
  const bare = bareHost(host);
  if (bare === null) return null;
  return CATALOG_DIALECTS.find((dialect) => dialect.hosts.includes(bare)) ?? null;
}

/**
 * los modos que corresponden a lo que DECLARA el catalogo, en el orden de
 * `REASONING_MODES` y sin repetidos.
 *
 * `declared` son las cadenas CRUDAS de la pasarela, quiza releidas del disco:
 * se tratan como dato de un tercero, no como el tipo que dicen ser. Lo que no
 * sea una cadena o no sea un valor del dialecto se ignora —un nivel que Luxy no
 * sabe nombrar no se puede ofrecer—, y nunca cuesta los demas.
 */
export function reasoningModesFromDeclared(
  dialect: CatalogDialect,
  declared: readonly string[],
): readonly ReasoningMode[] {
  const raw: readonly unknown[] = Array.isArray(declared) ? declared : [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value === 'string') seen.add(value.trim().toLowerCase());
  }
  return REASONING_MODES.filter((mode) => seen.has(dialect.values[mode].toLowerCase()));
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
 * lo que la PANTALLA sabe del modelo en un host con dialecto de catalogo.
 *
 * En los demas hosts no se mira: la tabla no depende de ningun catalogo.
 */
export interface ReasoningOptionsContext {
  /**
   * las cadenas crudas que el catalogo declara para este modelo. `null` o
   * ausente = la pantalla no tiene niveles de el, que NO es «no razona»
   */
  declared?: readonly string[] | null;
  /**
   * se puede elegir a mano entre los siete: el catalogo se leyo sin detalle o
   * el modelo razona sin declarar niveles. Decide la pasarela
   */
  manual?: boolean;
}

/**
 * los valores que se pueden ofrecer para este modelo en este host, en orden.
 * Vacio = el selector no ofrece nada.
 *
 * En un host con dialecto de catalogo la tabla no se consulta: sin `context`
 * no hay nada que ofrecer, porque alli solo se ofrece lo declarado.
 */
export function reasoningOptionsFor(
  model: string,
  host: string | null | undefined,
  context?: ReasoningOptionsContext,
): readonly ReasoningMode[] {
  const dialect = catalogDialectFor(host);
  if (dialect !== null) {
    if (model.trim().length === 0) return [];
    if (context?.manual === true) return [...REASONING_MODES];
    const declared = context?.declared;
    if (declared === null || declared === undefined) return [];
    return reasoningModesFromDeclared(dialect, declared);
  }
  const rule = ruleFor(model, host);
  if (rule === null) return [];
  return REASONING_MODES.filter((mode) => Object.hasOwn(rule.modes, mode));
}

/**
 * lo que hay que saber antes de elegir, o null si no hay nada que elegir.
 *
 * En un host con dialecto de catalogo no afirma nada del modelo: dice lo que la
 * pasarela DECLARA y quien decide al final (`D-093`). La fecha del catalogo la
 * pone la pantalla, que es quien la tiene.
 */
export function reasoningNoteFor(
  model: string,
  host: string | null | undefined,
  context?: ReasoningOptionsContext,
): string | null {
  const dialect = catalogDialectFor(host);
  if (dialect !== null) {
    if (reasoningOptionsFor(model, host, context).length === 0) return null;
    return context?.manual === true
      ? `Luxy no tiene niveles declarados por ${dialect.label} para este modelo: el nivel se ` +
          `elige a mano y decide ${dialect.label}, que puede ajustarlo o contestar con un error.`
      : `${dialect.label} declara estos niveles para este modelo en su catálogo; no está ` +
          `comprobado con ninguna llamada. Lo que eliges es lo que Luxy pide: si la ruta que ` +
          `atiende la petición no tiene ese nivel, ${dialect.label} puede ajustarlo al más ` +
          `cercano o contestar con un error.`;
  }
  return ruleFor(model, host)?.note ?? null;
}

/**
 * lo que el AGENTE sabe de la llamada en un host con dialecto de catalogo.
 *
 * El cuerpo y la linea de registro tienen que recibir el MISMO: si uno lo
 * calcula distinto, el registro deja de decir lo que viajo.
 */
export interface ReasoningRequestContext {
  /**
   * el modelo tiene su ajuste PROPIO en `modelSampling`. Sin el, el modo viene
   * del nivel de proveedor y en estos hosts no viaja
   */
  ownEntry?: boolean;
  /**
   * el CUERPO de esta llamada lleva `tools`: solo puede viajar «off», y
   * cualquier otro nivel no se envia —el campo se omite; no apaga nada—. Es de
   * la llamada y no del trabajo: con las herramientas como texto el cuerpo no
   * lleva `tools` y esto es `false`
   */
  withTools?: boolean;
}

/**
 * los campos que viajan en la RAIZ del cuerpo, y nada si no hay que mandar nada.
 *
 * Sin modo, sin regla o con un valor que la regla no admite, devuelve `{}`: el
 * cuerpo sale como hoy. Devuelve una COPIA: el cuerpo se serializa despues y
 * nadie debe poder tocar la tabla por accidente.
 *
 * En un host con dialecto de catalogo no hay regla que consultar: viaja el
 * campo de la pasarela SOLO si el modo sale del ajuste propio del modelo, y con
 * `tools` en el cuerpo solo «off». El agente no conoce el catalogo, asi que no
 * comprueba el nivel: eso lo decide la pasarela.
 */
export function reasoningRequestFields(
  model: string,
  host: string | null | undefined,
  mode: ReasoningMode | undefined,
  context?: ReasoningRequestContext,
): Record<string, unknown> {
  if (mode === undefined) return {};
  const dialect = catalogDialectFor(host);
  if (dialect !== null) {
    if (context?.ownEntry !== true || model.trim().length === 0) return {};
    if (context.withTools === true && mode !== 'off') return {};
    // `hasOwn` y no el indice a secas: un valor escrito a mano que no sea un
    // modo (`toString`) sacaria una funcion del prototipo
    if (!Object.hasOwn(dialect.values, mode)) return {};
    return { [dialect.field]: dialect.values[mode] };
  }
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
 *
 * `context` tiene que ser el mismo que recibio `reasoningRequestFields` para
 * esa llamada: de el depende lo que viajo en un host con dialecto de catalogo.
 */
export function reasoningLogFields(
  model: string,
  host: string | null | undefined,
  mode: ReasoningMode | undefined,
  context?: ReasoningRequestContext,
): { reasoningMode?: ReasoningMode; reasoningSent?: string } {
  if (mode === undefined) return {};
  const keys = Object.keys(reasoningRequestFields(model, host, mode, context));
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
  /**
   * el proveedor declaro tokens de razonamiento y NO llego ninguno que se vea:
   * razono sin enseñarlo, y no es deduccion. Cuantos, en
   * `reasoningTokensReported`: la pantalla manda a mirar la cifra porque un
   * recuento minimo no es lo mismo que cientos de tokens, y no hay umbral medido
   * para separarlos
   */
  | 'counted'
  /**
   * llego razonamiento que se ve: en un campo aparte o entre etiquetas. Gana a
   * `counted`: si ademas vino el recuento, sigue en `reasoningTokensReported`
   */
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
  // lo VISIBLE va antes que lo declarado: con el recuento primero, «razono y se
  // ve» y «razono y la pasarela no lo deja pasar» salian los dos `counted`, y
  // eso es justo lo que `D-107` quiere averiguar de la pasarela (novena ronda)
  if (input.reasoningChars > 0 || input.reasoningTagChars > 0) {
    return { reasoningVerdict: 'visible', charsPerOutput: ratio };
  }
  if (input.reasoningTokensReported > 0)
    return { reasoningVerdict: 'counted', charsPerOutput: ratio };
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
