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
 * cuantos turnos se le enseñan de una vez.
 *
 * Un tope alto no cuesta dinero —se cobra por llamada— pero si contexto y
 * atencion: partir bien cien turnos es mas dificil que partir bien treinta.
 */
export const CATALOG_MAX_TURNS = 60;

/** recorte de cada turno dentro del prompt del catalogador */
const CATALOG_TURN_CHARS = 600;

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

  return [
    'Estas catalogando una conversacion para un indice de busqueda. No la continues, no la',
    'valores y no hables con nadie: solo describes lo que hay para poder encontrarlo despues.',
    '',
    'Parte la conversacion en ESCENAS. Una escena cambia cuando cambia lo que esta pasando: el',
    'sitio, el momento, el asunto, o porque alguien se despide, se duerme o vuelve mas tarde.',
    'No partas por longitud: dos escenas seguidas pueden ser muy desiguales, y una conversacion',
    'corta puede ser una sola escena.',
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
    ...shown.map(
      (turn) =>
        `[${turn.sequence}] ${turn.role === 'user' ? 'Usuario' : 'Personaje'}: ${trim(turn.text)}`,
    ),
  ].join('\n');
}

function trim(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= CATALOG_TURN_CHARS ? flat : `${flat.slice(0, CATALOG_TURN_CHARS)}…`;
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
