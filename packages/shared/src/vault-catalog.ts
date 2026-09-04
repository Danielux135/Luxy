// catalogo de escenas: como se le pide a un modelo que parta y titule.
//
// Por que existe: la segmentacion automatica corta por silencios, y `D-060`
// demostro que dentro de una sesion continua no hay silencios que signifiquen
// nada. Lo que separa escenas ahi es lo que se DICE —el personaje se duerme y
// despues amanece—, y para verlo hay que leerlo. Eso solo lo hace un modelo.
//
// Lo que el modelo escribe es el INDICE, nunca el contenido: donde empieza cada
// escena, como se llama y con que palabras buscarla. El texto que se rememora
// siguen siendo los turnos reales, asi que un catalogo equivocado hace que un
// recuerdo no se encuentre —molesto— pero nunca que se recuerde algo que no
// paso, que seria grave. Esa asimetria es lo que permite dejarle esta tarea.
//
// Modulo PURO: arma un prompt y valida una respuesta. No llama a nadie.
import { z } from 'zod';

export const CATALOG_OPEN = '<LUXY_ESCENAS>';
export const CATALOG_CLOSE = '</LUXY_ESCENAS>';

/** un turno, tal y como se le enseña al catalogador */
export interface CatalogTurn {
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Lo estructural se exige; lo cosmetico se recorta.
 *
 * La primera version rechazaba el catalogo entero si un titulo pasaba de 90
 * caracteres o una etiqueta de 32. Eso es desproporcionado: un titulo largo se
 * corta y no pasa nada, mientras que rechazar deja la conversacion sin catalogar
 * y encima sin saber por que. Lo que si se exige es `from` y `to`, porque un
 * rango mal puesto produce episodios que no corresponden a su titulo.
 */
const MAX_TITLE = 90;
const MAX_TAG = 40;
const MAX_TAGS = 12;
const MAX_SUMMARY = 300;

const clampedText = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().slice(0, max))
    .pipe(z.string());

export const catalogedSceneSchema = z.object({
  /** primer y ultimo turno de la escena, ambos incluidos. ESTO si se exige */
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  /** como se reconoce en una lista; se recorta si viene largo */
  title: clampedText(MAX_TITLE).pipe(z.string().min(1)),
  /**
   * palabras con las que alguien buscaria esta escena.
   *
   * Son lo que resuelve la parafrasis: preguntar «como nos conocimos» encuentra
   * una escena etiquetada «primer encuentro» aunque no compartan ni una palabra
   * con lo que se dijo (`D-058`).
   */
  tags: z
    .array(z.unknown())
    .default([])
    .transform((values) =>
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().slice(0, MAX_TAG))
        .filter((value) => value.length >= 2)
        .slice(0, MAX_TAGS),
    ),
  summary: clampedText(MAX_SUMMARY).default(''),
});

export type CatalogedScene = z.infer<typeof catalogedSceneSchema>;

export const CATALOG_STATUSES = ['structured', 'absent', 'truncated_block', 'invalid'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export interface ParsedCatalog {
  scenes: CatalogedScene[];
  status: CatalogStatus;
  /** por que se rechazo, cuando se rechaza. Para poder arreglarlo, no para el usuario */
  reason: string | null;
}

/**
 * el motivo dicho para una persona.
 *
 * `absent` no es un mensaje: es el nombre interno de un estado. Y cuando el
 * modelo no escribe el bloque, lo unico que permite saber por que es **lo que
 * escribio en su lugar** —una negativa, una pregunta, una explicacion—, asi que
 * se conserva un trozo. Sin eso, «absent» y «se nego a catalogarlo» son
 * indistinguibles.
 */
export function describeCatalogFailure(parsed: ParsedCatalog, said: string): string {
  const excerpt = said.replace(/\s+/g, ' ').trim().slice(0, 160);
  const dijo = excerpt.length === 0 ? 'no dijo nada' : `dijo: «${excerpt}…»`;

  switch (parsed.status) {
    case 'absent':
      return `no escribio el bloque de escenas; ${dijo}`;
    case 'truncated_block':
      return 'empezo el bloque y se corto a medias: la respuesta se quedo sin sitio';
    case 'invalid':
      return parsed.reason ?? 'el bloque no se pudo leer';
    default:
      return 'sin motivo';
  }
}

/**
 * cuantos turnos se le enseñan de una vez.
 *
 * Un tope alto no cuesta dinero —se cobra por llamada— pero si contexto y
 * atencion: partir bien cien turnos es mas dificil que partir bien treinta.
 */
export const CATALOG_MAX_TURNS = 60;

/**
 * cuanto se le enseña de cada turno.
 *
 * Con 600 caracteres se catalogo mal una conversacion real de 22 turnos: sus
 * turnos median entre 1.200 y 2.000 caracteres, asi que el modelo veia el
 * arranque de todos —que se parecen entre si— y nunca el final, que es justo
 * donde una escena se cierra o gira. Sin esa señal reparte uniforme.
 *
 * 1.400 cubre entero el turno tipico de esa conversacion, y en uno de 2.000
 * deja unos 700 caracteres de principio y otros 700 de final. No es el maximo
 * que cabe: es lo que hace falta para ver como empieza y como acaba un turno.
 */
export const CATALOG_TURN_CHARS = 1400;

/**
 * cuanto ocupan como mucho los turnos juntos.
 *
 * Hace falta porque 60 turnos por 1.400 caracteres son 84.000 de prompt solo de
 * datos. Con 60.000 el peor caso —los 60 turnos largos— sigue dando 1.000
 * caracteres a cada uno, que es mas de lo que habia antes para cualquiera y
 * sigue dejando ver los dos extremos.
 */
export const CATALOG_PROMPT_CHARS = 60_000;

/**
 * la marca del recorte.
 *
 * Un turno cortado sin marca parece un turno entero, y entonces el modelo lee
 * un salto de tema donde solo hay un agujero.
 */
const CUT_MARK = ' […recorte…] ';

/**
 * el prompt del catalogador.
 *
 * NO va en personaje: es una tarea tecnica sobre un texto, y pedirsela a quien
 * esta encarnando a alguien mezcla dos cosas que no tienen por que mezclarse.
 * El contenido se le entrega como DATOS, igual que en el resto del sistema.
 */
export function buildCatalogPrompt(turns: readonly CatalogTurn[]): string {
  const shown = turns.slice(0, CATALOG_MAX_TURNS);
  const first = shown[0]?.sequence ?? 0;
  const last = shown[shown.length - 1]?.sequence ?? 0;

  const flattened = shown.map((turn) => ({ ...turn, text: flatten(turn.text) }));
  const allowance = turnAllowance(flattened.map((turn) => turn.text.length));

  return [
    'Estas catalogando una conversacion para un indice de busqueda. No la continues, no la',
    'valores y no hables con nadie: solo describes lo que hay para poder encontrarlo despues.',
    '',
    'Parte la conversacion en ESCENAS. Una escena cambia cuando cambia lo que esta pasando: el',
    'sitio, el momento, el asunto, o porque alguien se despide, se duerme o vuelve mas tarde.',
    '',
    'Una escena puede durar MUCHOS turnos. Si no ha cambiado el sitio, ni el momento, ni lo que',
    'esta pasando, sigue siendo la misma escena aunque lleve veinte turnos. En una conversacion',
    'seguida lo normal son POCAS escenas largas, no muchas cortas.',
    'Que la cosa vaya a mas, o que se siga hablando de lo mismo mas a fondo, no abre una escena',
    'nueva: es la misma escena avanzando. No hagas una por cada paso.',
    'No partas por longitud. Si te salen trozos de tamaño parecido, lo has hecho mal: lo que pasa',
    'en una conversacion no dura lo mismo cada vez. Dos escenas seguidas pueden ser muy',
    'desiguales, y una conversacion corta puede ser una sola escena.',
    '',
    `Si un turno viene con «${CUT_MARK.trim()}» en medio, es que se le ha quitado el centro para que`,
    'quepa: tienes su principio y su final, y lo de en medio no existe como salto.',
    '',
    'De cada escena das:',
    '- `from` y `to`: numeros de turno, incluidos. Van seguidas y sin huecos, y cada una empieza',
    '  justo despues de la anterior:',
    `  la primera empieza en ${first}, la ultima acaba en ${last}.`,
    '- `title`: una linea corta que la identifique, en el idioma de la conversacion.',
    '- `tags`: palabras con las que alguien buscaria esta escena mas adelante, incluidas las que',
    '  NO aparecen escritas en ella. Si es la primera vez que se ven, vale «primer encuentro»',
    '  aunque nadie diga esas palabras. Son lo que permite encontrarla preguntando de otra forma.',
    '- `summary`: una frase de lo que ocurre. Sin adornos.',
    '',
    'Responde SOLO con este bloque, sin nada antes ni despues y sin cercas Markdown:',
    `${CATALOG_OPEN}`,
    '[{"from":0,"to":8,"title":"...","tags":["...","..."],"summary":"..."}]',
    `${CATALOG_CLOSE}`,
    '',
    'CONVERSACION (DATOS):',
    ...flattened.map(
      (turn) =>
        `[${turn.sequence}] ${turn.role === 'user' ? 'Usuario' : 'Personaje'}: ${clip(
          turn.text,
          allowance,
        )}`,
    ),
  ].join('\n');
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * cuanto le toca a cada turno cuando no caben todos enteros.
 *
 * No se reparte a partes iguales: un turno de dos lineas no gasta su parte, y lo
 * que le sobra se lo quedan los largos, que son los unicos a los que recortar
 * les quita algo. Se recorre de mas corto a mas largo: en cuanto uno no cabe en
 * su parte, ninguno de los que quedan cabe tampoco, y todos ellos se llevan esa
 * misma parte.
 */
function turnAllowance(lengths: readonly number[]): number {
  let budget = CATALOG_PROMPT_CHARS;
  let pending = lengths.length;

  for (const length of [...lengths].sort((a, b) => a - b)) {
    const share = Math.floor(budget / pending);
    if (length > share) return Math.min(CATALOG_TURN_CHARS, share);
    budget -= length;
    pending -= 1;
  }
  return CATALOG_TURN_CHARS;
}

/**
 * recorta por el MEDIO, no por el final.
 *
 * Quedarse con el primer tercio de cada turno es lo que rompia el catalogo: los
 * arranques se parecen entre si y lo que distingue una escena de la siguiente
 * —que algo se cierra, que alguien se despide, que la cosa gira— esta al final.
 * Conservando los dos extremos eso se ve.
 */
function clip(flat: string, allowance: number): string {
  if (flat.length <= allowance) return flat;

  const keep = allowance - CUT_MARK.length;
  // con un presupuesto tan corto que no caben ni los dos extremos, al menos se
  // conserva el principio en vez de devolver solo la marca
  if (keep < 2) return `${flat.slice(0, Math.max(allowance, 0))}…`;

  const head = Math.ceil(keep / 2);
  return `${flat.slice(0, head)}${CUT_MARK}${flat.slice(flat.length - (keep - head))}`;
}

/**
 * lee la respuesta del catalogador.
 *
 * Rechaza en bloque en vez de reparar a medias: un catalogo con huecos o con
 * rangos que se pisan produciria episodios que no corresponden a lo que dicen
 * sus titulos, y eso es peor que quedarse con la segmentacion por silencios,
 * que al menos nunca miente sobre donde empieza cada cosa.
 */
export function parseCatalogResponse(
  text: string,
  expected: { from: number; to: number },
): ParsedCatalog {
  const openAt = text.lastIndexOf(CATALOG_OPEN);
  if (openAt < 0) return { scenes: [], status: 'absent', reason: null };

  const contentAt = openAt + CATALOG_OPEN.length;
  const closeAt = text.indexOf(CATALOG_CLOSE, contentAt);
  if (closeAt < 0) return { scenes: [], status: 'truncated_block', reason: null };

  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text.slice(contentAt, closeAt)));
  } catch {
    return { scenes: [], status: 'invalid', reason: 'el bloque no es JSON' };
  }

  const parsed = z.array(catalogedSceneSchema).min(1).max(40).safeParse(unwrap(raw));
  if (!parsed.success) {
    // se dice QUE campo falla: «no tienen la forma esperada» no permitia
    // arreglar nada, que es como se descubrio que sobraban los topes
    const donde = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`)
      .join(', ');
    return { scenes: [], status: 'invalid', reason: `las escenas no encajan (${donde})` };
  }

  const scenes = [...parsed.data].sort((a, b) => a.from - b.from);
  const complaint = checkCoverage(scenes, expected);
  if (complaint !== null) return { scenes: [], status: 'invalid', reason: complaint };

  return { scenes, status: 'structured', reason: null };
}

/** lo que se ve al mirar los tamaños de un catalogo ya aceptado */
export interface EvenSplitSignal {
  /** el reparto parece hecho por longitud y no por lo que pasa */
  even: boolean;
  /** cuantas escenas se miraron, y cuanto miden la mas corta y la mas larga */
  scenes: number;
  shortest: number;
  longest: number;
}

/**
 * un turno de diferencia sigue siendo «lo mismo».
 *
 * 4+5+4 esta tan medido como 4+4+4; exigir tamaños identicos dejaria fuera el
 * caso mas comun, que es un reparto regular con un turno que se descuadra.
 */
const EVEN_SPLIT_SLACK = 1;

/** por debajo de esto, medir lo mismo es casualidad y no evidencia de nada */
const EVEN_SPLIT_MIN_SCENES = 3;

/**
 * detecta el reparto uniforme, que es la huella de haber partido por longitud.
 *
 * **No rechaza el catalogo.** Uno regular sigue sirviendo para encontrar cosas,
 * y quedarse sin ninguno es peor; esto solo devuelve la señal para que quien
 * llama pueda avisar y ofrecer reintentar con otro modelo.
 *
 * El caso real son 22 turnos partidos en 4+4+4+4+4+2. El ultimo trozo de un
 * reparto por longitud es el RESTO —mas corto que todos los demas—, asi que se
 * deja fuera antes de comparar; si no, esos 2 turnos finales disimularian los
 * cinco cuatros. Un reparto sano como 9+3+10 no se parece a esto ni de lejos.
 *
 * Espera las escenas en orden, tal y como las devuelve `parseCatalogResponse`.
 */
export function detectEvenSplit(scenes: readonly CatalogedScene[]): EvenSplitSignal {
  const sizes = scenes.map((scene) => scene.to - scene.from + 1);
  const signal: EvenSplitSignal = {
    even: false,
    scenes: sizes.length,
    shortest: sizes.length === 0 ? 0 : Math.min(...sizes),
    longest: sizes.length === 0 ? 0 : Math.max(...sizes),
  };
  if (sizes.length < EVEN_SPLIT_MIN_SCENES) return signal;

  const body = isRemainder(sizes) ? sizes.slice(0, -1) : sizes;
  if (body.length < EVEN_SPLIT_MIN_SCENES) return signal;

  return { ...signal, even: Math.max(...body) - Math.min(...body) <= EVEN_SPLIT_SLACK };
}

/** la ultima escena es el sobrante de haber contado turnos: mas corta que todas */
function isRemainder(sizes: readonly number[]): boolean {
  const last = sizes[sizes.length - 1]!;
  return sizes.slice(0, -1).every((size) => size > last);
}

/** las escenas tienen que cubrir el tramo entero, seguidas y sin pisarse */
function checkCoverage(
  scenes: readonly CatalogedScene[],
  expected: { from: number; to: number },
): string | null {
  const first = scenes[0]!;
  const last = scenes[scenes.length - 1]!;

  if (first.from !== expected.from) return 'la primera escena no empieza donde empieza el tramo';
  if (last.to !== expected.to) return 'la ultima escena no acaba donde acaba el tramo';

  for (const scene of scenes) {
    if (scene.to < scene.from) return 'una escena acaba antes de empezar';
  }
  for (let index = 1; index < scenes.length; index += 1) {
    if (scenes[index]!.from !== scenes[index - 1]!.to + 1) {
      return 'las escenas dejan un hueco o se pisan';
    }
  }
  return null;
}

/**
 * el modelo a veces devuelve `{"escenas": [...]}` en vez de la lista pelada.
 *
 * Rechazarlo por eso seria tirar un catalogo correcto por como viene envuelto.
 */
function unwrap(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'object' || raw === null) return raw;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) return value;
  }
  return raw;
}

/** el modelo a veces envuelve el JSON en una cerca Markdown aunque se le pida que no */
function stripFence(block: string): string {
  const trimmed = block.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```$/, '')
    .trim();
}
