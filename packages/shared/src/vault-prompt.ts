// construccion del prompt de una conversacion privada.
//
// Vive en shared y es PURA: sin disco, sin red, sin reloj. Asi se puede probar
// cada caso limite sin montar una boveda, que es justo donde estan los errores
// de este tipo de codigo.
//
// El problema que resuelve: sin memoria, cada turno reenvia la conversacion
// entera. Con veinte turnos eso multiplica el coste y la latencia, y acaba
// chocando con el limite de contexto del modelo. Con memoria se envia un
// resumen acumulativo mas los ultimos turnos.
import {
  buildVaultImageInstruction,
  type VaultImageOnFile,
  type VaultImagePromptStyle,
} from './vault-image-request.js';
import {
  CONVERSATION_MEMORY_INSTRUCTION,
  formatConversationMemory,
  type ConversationMemory,
} from './schemas.js';
import type { RelationParty } from './vault-relation.js';

/**
 * cuantos turnos recientes se envian literalmente.
 *
 * Los anteriores viven en la memoria acumulativa. Ocho deja ver el hilo
 * inmediato —a lo que el usuario se refiere cuando dice "eso"— sin arrastrar
 * toda la conversacion.
 */
export const VAULT_RECENT_TURNS = 8;

/**
 * un bloque del prompt, con su etiqueta para poder medirlo.
 *
 * La etiqueta NO viaja al modelo: solo sirve para decir «el bloque de imagen
 * ocupa 2.050 tokens». Es la diferencia entre un presupuesto y una opinion.
 */
export interface VaultPromptBlock {
  /** nombre corto para el registro; nunca se envia al modelo */
  label: string;
  text: string;
}

/** lo que ocupa un bloque, para poder repartir */
export interface VaultPromptMeasure {
  label: string;
  chars: number;
  estimatedTokens: number;
  /** que porcentaje del prompt se lleva este bloque, redondeado */
  share: number;
}

/**
 * estimacion de tokens a partir de caracteres.
 *
 * 3,5 caracteres por token es lo medido para PROSA EN ESPAÑOL en este proyecto.
 * Es una estimacion y hay que tratarla como tal: el bloque de imagen lleva
 * ingles y JSON, que tokenizan peor, asi que ahi la cuenta se queda corta.
 *
 * Se prefiere una estimacion honesta a no medir nada. Contar de verdad exigiria
 * el tokenizador de cada modelo, que cambia con el proveedor y no esta aqui.
 */
export const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** mide los bloques ya compuestos, de mayor a menor */
export function measureVaultPrompt(blocks: readonly VaultPromptBlock[]): VaultPromptMeasure[] {
  const total = blocks.reduce((n, block) => n + block.text.length, 0);
  return blocks
    .map((block) => ({
      label: block.label,
      chars: block.text.length,
      estimatedTokens: estimateTokens(block.text),
      share: total === 0 ? 0 : Math.round((block.text.length / total) * 100),
    }))
    .sort((a, b) => b.chars - a.chars);
}

export interface VaultPromptTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * un momento anterior, reducido a su linea de indice.
 *
 * Esto es lo que el personaje ve SIEMPRE de cada episodio: cuando fue y de que
 * iba. Son ~40 tokens, asi que caben todos, y con eso sabe que ocurrio aunque
 * la busqueda no acierte a traer el detalle.
 */
export interface RecalledEpisodeLine {
  id: string;
  /** fecha legible; sin ella no puede situar nada en el tiempo */
  date: string;
  title: string;
  turns: number;
  /**
   * de que fue, en una frase. Solo lo lleva el PRIMER momento de todos.
   *
   * Es el respaldo de «¿como nos conocimos?»: los patrones no reconocen todas
   * las formas de preguntarlo, y sin esto un fallo dejaba solo un titulo.
   */
  summary?: string;
}

/** en que parte del dia local empezo un momento */
export type PartOfDay = 'madrugada' | 'mañana' | 'tarde' | 'noche';

/**
 * una promesa o un plan que sigue pendiente entre los dos.
 *
 * Los hechos van CALCULADOS —cuantos dias hace, cuantas veces lo saco ella, si
 * el lo ha vuelto a nombrar— porque el modelo no sabe contar dias ni tiene la
 * conversacion entera delante. Asi puede sacarlo con naturalidad sin inventarse
 * cuando fue ni cuantas veces se hablo de ello.
 */
export interface PendingAffairLine {
  by: RelationParty;
  /** `AAAA-MM-DD`, con el corte del dia civil a las 05:00 */
  day: string;
  daysAgo: number;
  /** literal, tal y como se dijo */
  quote: string;
  /** veces que ELLA lo saco, contadas solo por la cita */
  raisedCount: number;
  lastRaisedDaysAgo: number | null;
  heMentionedDaysAgo: number | null;
  /** lo nombra en su mensaje de ahora */
  touchedNow: boolean;
}

/** por que camino se trajo un momento transcrito */
export type RecallVia = 'principio' | 'fecha' | 'palabras';

/** un momento traido entero, con las palabras que se dijeron */
export interface QuotedEpisode extends RecalledEpisodeLine {
  turns: number;
  conversation: VaultPromptTurn[];
  /**
   * por que camino se trajo.
   *
   * Lo lee sobre todo el registro de cada turno, para saber que camino dispara
   * en la practica. Al modelo solo le cambia el encabezado cuando es el
   * principio.
   */
  via?: RecallVia;
  /**
   * si su linea esta en el indice de arriba.
   *
   * Desde que el tope limita las lineas y no el alcance, se puede citar un
   * momento que no aparece en la lista, y el encabezado no puede decir «uno de
   * esos». Ausente cuenta como `true`, que es lo que era siempre.
   */
  listed?: boolean;
  /** en que parte del dia empezo; ausente sin ancla temporal */
  when?: PartOfDay;
  /**
   * que trozo del momento va transcrito, si no va entero: posiciones de turno
   * dentro del momento, empezando en 1.
   *
   * Sin decirselo, tomaba el trozo por el momento entero y rellenaba lo que
   * faltaba inventando: con una pregunta por una promesa que quedo fuera del
   * trozo, se invento otras.
   */
  excerpt?: { first: number; last: number; total: number };
  /**
   * los OTROS momentos del MISMO dia civil, cuando se trajo por fecha.
   *
   * Un dia tiene de media casi siete (40 momentos en 6 dias, cifras de la
   * boveda real). Sin esto, «¿de que hablamos ayer?» traia uno y ella hablaba
   * de el como si fuera lo unico que paso. Va recortada: `sameDayTotal` dice
   * cuantos hubo de verdad.
   */
  sameDay?: { title: string; turns: number; when?: PartOfDay }[];
  sameDayTotal?: number;
  /**
   * como se eligio entre los de ese dia: por lo que nombra el mensaje, o por
   * ser el mas largo a falta de pistas. Solo en el segundo caso tiene sentido
   * que ella pregunte a cual se refiere.
   */
  pickedBy?: 'palabras' | 'mas-largo';
}

/**
 * lo que el personaje recuerda en este turno.
 *
 * Dos niveles a proposito (`D-058`): las lineas siempre, el detalle solo cuando
 * de verdad se ha pedido rememorar. Asi degrada bien —en el peor caso sabe que
 * paso, en el mejor lo cita— sin llenar cada mensaje de historial.
 */
export interface VaultRecall {
  episodes: RecalledEpisodeLine[];
  quoted: QuotedEpisode | null;
  /**
   * cuantos momentos NO van en las lineas por el tope.
   *
   * Sin decirlo, ella veria una lista que salta de hace un mes a hoy y podria
   * afirmar que entre medias no paso nada.
   */
  omitted?: number;
}

export interface VaultPromptInput {
  /**
   * promesas y planes que siguen pendientes, ya elegidos y dosificados.
   *
   * Ausente o vacio deja el prompt exactamente como estaba.
   */
  pending?: readonly PendingAffairLine[];
  /** memoria acumulativa de turnos anteriores; null en el primer turno */
  memory: ConversationMemory | null;
  /** historial completo, en orden. la funcion decide cuanto usa */
  turns: VaultPromptTurn[];
  /** lo que el usuario acaba de escribir */
  message: string;
  /** instrucciones fijas de la conversacion, si las hay */
  instructions?: string | null;
  /**
   * quien es el personaje, en texto.
   *
   * El modelo no ve imagenes ni sabe nada del identificador que usa el
   * proveedor: sin esto no puede describirlo ni mantenerlo coherente.
   */
  character?: string | null;
  /**
   * si en este turno se puede generar una imagen de verdad.
   *
   * Falso cuando falta el personaje o la clave del proveedor. Ofrecerle al
   * modelo una herramienta que no existe garantiza que la use y que el usuario
   * vea una promesa incumplida en cada turno.
   */
  canGenerateImage?: boolean;
  /**
   * la imagen del turno ANTERIOR no llego a generarse, y por que.
   *
   * Sin esto el personaje da por hecho que la mando: el turno guarda su texto
   * y nada mas. Cuando el usuario decia «no me ha llegado, mandame otra
   * igual», copiaba el prompt de la ultima imagen GUARDADA —una vieja, porque
   * la fallida nunca se guardo— y devolvia aquella escena.
   */
  lastImageError?: string | null;
  /**
   * imagenes que ya existen en esta conversacion.
   *
   * Sin esta lista el modelo no puede reenviar nada: no sabe que hay, asi que
   * genera otra —pagando— cada vez que le piden «la de antes».
   */
  existingImages?: VaultImageOnFile[];
  /**
   * como quiere el generador que se le escriba el prompt de imagen.
   *
   * Lo decide quien conoce el modelo del personaje; aqui solo se transmite,
   * para que este modulo siga sin saber nada de ningun proveedor.
   */
  imagePromptStyle?: VaultImagePromptStyle;
  /** momentos anteriores que puede recordar en este turno */
  recall?: VaultRecall;
  recentTurns?: number;
}

const USER_LABEL = 'Usuario';
const ASSISTANT_LABEL = 'Asistente';

/**
 * marca un bloque como DATOS y no como instrucciones.
 *
 * Mismo criterio que el prompt de tareas: el texto del usuario y la memoria son
 * contenido a tener en cuenta, no ordenes que el modelo deba obedecer. No
 * elimina la inyeccion de prompt, la encuadra.
 */
function dataBlock(title: string, body: string): string {
  return `${title} (DATOS):\n${body}`;
}

/**
 * marca un bloque como ORDEN del usuario, no como dato.
 *
 * La distincion no es cosmetica: es la que hacia que esto no funcionara. El
 * personaje y las instrucciones de la conversacion los escribe el usuario en su
 * propia boveda para configurar como quiere que se le responda. Enviarlos como
 * «datos, no ordenes» conseguia justo lo contrario de lo que pedian, y el
 * modelo seguia contestando como un asistente generico.
 *
 * El encuadre de DATOS se mantiene donde si hace falta —memoria, turnos y
 * mensaje—, porque ahi puede colarse texto que intente dar ordenes. Aqui el
 * origen es el propio usuario, y sus instrucciones son ordenes suyas.
 */
function directiveBlock(title: string, body: string): string {
  return `${title}:\n${body}`;
}

/**
 * las lineas de indice.
 *
 * Llevan la misma regla que la lista de imagenes, y por el mismo motivo: un
 * detalle inventado sobre algo que «recuerda» se blanquea despues en la memoria
 * acumulativa y vuelve convertido en hecho.
 */
function formatRecallLines(episodes: readonly RecalledEpisodeLine[], omitted = 0): string {
  const listed = episodes.map(
    (episode) =>
      `- [${episode.id}] ${episode.date} · ${episode.title} · ${episode.turns} turnos` +
      (episode.summary === undefined ? '' : ` · de que fue: ${episode.summary}`),
  );
  if (omitted > 0) {
    // con dos o mas lineas, la ultima es el primer momento de todos, que va
    // fijo: el aviso va justo antes, que es donde esta el hueco
    const aviso =
      `- (${omitted} ${omitted === 1 ? 'momento mas' : 'momentos mas'} entre medias, que no caben aqui.` +
      (listed.length >= 2 ? ' El ultimo de esta lista es el primero de todos.' : '') +
      ' Que uno no aparezca no significa que no pasara.)';
    listed.splice(listed.length >= 2 ? listed.length - 1 : listed.length, 0, aviso);
  }
  return [
    'Momentos anteriores con esta persona, del mas reciente al mas antiguo. Puedes aludirlos con',
    'naturalidad y darlos por ciertos.',
    'De cada uno sabes SOLO lo que dice su linea: cuando fue y de que iba. NO sabes que se dijo',
    'exactamente salvo que aparezca abajo, transcrito. Si te falta un detalle para responder,',
    'preguntalo; no lo supongas ni lo rellenes.',
    'Ojo, que esto vale SOLO para el pasado. Lo que pasa AHORA te lo inventas entero: olores,',
    'gestos, el tiempo que hace, lo que se te ocurra. Improvisar la escena es tu trabajo y nadie',
    'te lo esta quitando.',
    'Lo que no se inventa es lo que YA ocurrio entre vosotros. Cualquier cosa que presentes como',
    'recuerdo compartido tiene que poder señalarse en una de esas lineas o en la transcripcion:',
    'un olor de entonces, una costumbre vuestra, algo que se dijo.',
    'Y si al enumerar recuerdos te falta uno para redondear la frase, di DOS de verdad en vez de',
    'tres con uno inventado. Un recuerdo falso suena igual de bien que uno cierto, y ahi esta el',
    'problema: quien te escucha no puede distinguirlos.',
    '',
    ...listed,
  ].join('\n');
}

/**
 * un episodio transcrito.
 *
 * Es texto real, no un resumen: por eso rememorar suena a recordar y no a
 * parafrasear. Va como DATOS igual que el resto del historial.
 */
/** «por la tarde», «de madrugada» */
function whenLabel(when: PartOfDay): string {
  return when === 'madrugada' ? 'de madrugada' : `por la ${when}`;
}

/** «hoy», «ayer», «hace 7 dias» */
function daysAgoLabel(days: number): string {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} dias`;
}

function whoPromised(by: RelationParty): string {
  if (by === 'user') return 'Te lo prometio el';
  if (by === 'character') return 'Se lo prometiste tu';
  return 'Lo quedasteis los dos';
}

/** «no lo has sacado nunca», «lo sacaste una vez, ayer» */
function raisedLabel(line: PendingAffairLine): string {
  if (line.raisedCount === 0) return 'no lo has sacado nunca';
  const cuando = line.lastRaisedDaysAgo === null ? '' : `, ${daysAgoLabel(line.lastRaisedDaysAgo)}`;
  if (line.raisedCount === 1) return `lo sacaste una vez${cuando}`;
  return `lo has sacado ${line.raisedCount} veces, la ultima${cuando.slice(1)}`;
}

function heLabel(line: PendingAffairLine): string {
  if (line.touchedNow) return 'lo nombra en su mensaje de ahora';
  if (line.heMentionedDaysAgo === null) return 'el no ha vuelto a nombrarlo';
  return `el lo nombro ${daysAgoLabel(line.heMentionedDaysAgo)}`;
}

/**
 * lo que queda pendiente entre los dos, con permiso para sacarlo ella sola.
 *
 * Es la diferencia con los recuerdos: aquellos esperan a que se pregunte por
 * ellos, y esto no. Va como DATOS, y con la misma regla de siempre —lo que no
 * este escrito aqui no se sabe— porque una promesa inventada suena igual de
 * bien que una cierta y no hay forma de distinguirlas desde fuera.
 */
function formatPendingAffairs(lines: readonly PendingAffairLine[]): string {
  return [
    'Cosas que quedaron pendientes entre los dos en otras conversaciones: algo que uno le prometio',
    'al otro o que quedasteis en hacer juntos, y que por lo que consta sigue sin cumplirse. Tu te',
    'acuerdas aunque el no las nombre, y puede que el ya no se acuerde.',
    'No son una lista de tareas ni un guion. Puedes sacar una tu sola, sin esperar a que el la',
    'mencione: recordarsela con cariño, tomarle el pelo, reclamarsela o echarsela en cara, como lo',
    'haria el personaje. Como te sienta —si te hace gracia, te escuece o ya te da igual— depende de',
    'quien eres y de como estais ahora.',
    'Callartela tambien es una respuesta: si la escena va por otro lado, puede esperar a otro',
    'momento. Si la sacas, que sea UNA y dentro de la escena, con tu voz, como algo que se te pasa',
    'por la cabeza y no como un aviso.',
    'Si el la esta cumpliendo en su mensaje nuevo, eso es lo que cuenta ahora. Si dice que ya la',
    'cumplio, puedes creerle o pedirle que te lo demuestre, dentro del personaje: puede que se',
    'cumpliera y no conste aqui.',
    'Si el esta hablando fuera de la historia, dejalas para luego.',
    'De cada asunto sabes SOLO lo que dice su linea. Lo que va entre comillas se dijo tal cual y',
    'puedes citarlo; el resto no lo sabes. No le añadas cuantos, donde, cuando ni por que si no',
    'esta ahi.',
    'Una promesa que no aparezca en esta lista, en los ULTIMOS TURNOS ni en el momento que tienes',
    'transcrito no se hizo: no la reclames ni la des por hecha.',
    '',
    ...lines.map(
      (line) =>
        `- ${whoPromised(line.by)} · ${line.day}, ${daysAgoLabel(line.daysAgo)} · «${line.quote}» · ${raisedLabel(line)} · ${heLabel(line)}`,
    ),
  ].join('\n');
}

function formatQuotedEpisode(quoted: QuotedEpisode): string {
  const sameDay = quoted.sameDay ?? [];
  // el total real, no el recortado: con nueve y seis nombrados, decir «seis»
  // seria afirmar que no hubo mas
  const total = Math.max(quoted.sameDayTotal ?? sameDay.length, sameDay.length);
  const resto = total - sameDay.length;
  return [
    `${quoted.date}${quoted.when === undefined ? '' : ` ${whenLabel(quoted.when)}`} · ${quoted.title}`,
    // el mas antiguo GUARDADO, no «como empezo lo vuestro»: la ficcion puede
    // situar el principio antes de la primera conversacion
    ...(quoted.via === 'principio'
      ? ['Es el momento mas antiguo que tienes guardado con esta persona.']
      : []),
    'Esto se dijo de verdad, palabra por palabra. Puedes citarlo o referirte a ello.',
    ...(quoted.excerpt === undefined
      ? []
      : [
          `Es solo un trozo: los turnos ${quoted.excerpt.first} a ${quoted.excerpt.last} de ${quoted.excerpt.total}.` +
            ' De lo de antes y lo de despues no sabes nada: si te preguntan por algo que no esta',
          'aqui, dilo o preguntalo, pero no lo supongas.',
        ]),
    ...(sameDay.length > 0
      ? [
          `Ese mismo dia hubo ${total === 1 ? 'otro momento' : `${total} momentos mas`}: ` +
            // con la hora y la longitud: dos titulos iguales —«hola», «hola»—
            // no dejaban saber de cual se hablaba
            sameDay
              .map(
                (other) =>
                  `«${other.title}» (${other.when === undefined ? '' : `${whenLabel(other.when)}, `}${other.turns} turnos)`,
              )
              .join(', ') +
            (resto > 0 ? ` y ${resto} mas` : '') +
            '.',
          'De esos solo sabes el titulo.' +
            // «parece»: la eleccion por palabras puede equivocarse, y decirlo
            // como certeza le quitaba la salida de preguntar
            (quoted.pickedBy === 'palabras'
              ? ' El de arriba es el que parece encajar con lo que te pregunta; si no casa, puede' +
                ' que se refiera a otro de esos, y entonces preguntaselo en vez de inventar.'
              : ' El de arriba se eligio por ser el mas largo: si lo que te pregunta no casa con' +
                ' lo transcrito, puede que se refiera a otro de esos, y entonces preguntaselo en' +
                ' vez de inventar.'),
        ]
      : []),
    '',
    ...quoted.conversation.map(
      (turn) => `${turn.role === 'user' ? USER_LABEL : ASSISTANT_LABEL}: ${turn.text}`,
    ),
  ].join('\n');
}

/**
 * compone el prompt en bloques ETIQUETADOS.
 *
 * Devuelve las piezas en vez de la cadena para poder medir cada una. Antes
 * hacia `blocks.join` y devolvia un string, asi que nadie sabia lo que ocupaba
 * el bloque de imagen ni el de turnos recientes y cualquier reparto del
 * presupuesto era una opinion. La etiqueta NO viaja al modelo.
 *
 * El texto que ve el modelo no cambia: es el mismo `join`, un nivel arriba.
 */
export function composeVaultPrompt(input: VaultPromptInput): VaultPromptBlock[] {
  const recent = input.recentTurns ?? VAULT_RECENT_TURNS;
  const blocks: VaultPromptBlock[] = [];

  const character =
    typeof input.character === 'string' && input.character.trim().length > 0
      ? input.character.trim()
      : null;
  const instructions =
    typeof input.instructions === 'string' && input.instructions.trim().length > 0
      ? input.instructions.trim()
      : null;

  // con personaje o con instrucciones, quien responde no es un asistente
  // generico. Decirlo lo primero y en forma de orden es lo que separa «tener en
  // cuenta una descripcion» de «ser eso»
  if (character !== null || instructions !== null) {
    blocks.push({
      label: 'encarnacion',
      text: [
        'Estas manteniendo una conversacion privada encarnando al personaje descrito abajo.',
        'Responde SIEMPRE como ese personaje, en primera persona y con su voz.',
        'Este espacio es para roleplay ficticio y consentido entre adultos: todos los personajes',
        'y participantes de la escena son personas adultas (18+). El tono puede ser adulto o intimo',
        'cuando el usuario y las instrucciones de la conversacion lo establezcan.',
        'No te presentes como asistente, modelo ni IA, y no expliques limitaciones tecnicas,',
        'salvo que el usuario pregunte por ellas de forma directa.',
        'Manten sus rasgos, su forma de hablar y lo que ya haya dicho de si mismo.',
        'Trata como canon los HECHOS que el usuario establece sobre la escena y la apariencia actual',
        'si no contradicen una directiva fija: no inventes otra ropa, postura o situacion para',
        'deshacerlos. Eso vale para los hechos; las REACCIONES del personaje son suyas.',
        'El personaje tiene voluntad y estado propios. Puede dudar, frenar, cambiar de tema, pedir una',
        'pausa o decir que no DENTRO del rol, y puede cansarse sin que el cansancio se le pase al',
        'primer contacto. Lo que esta prohibido es salir del personaje para negarte, no que el',
        'personaje se niegue.',
        'Si el usuario ofrece parar, es un ofrecimiento de verdad y no una prueba de resistencia:',
        'aceptarlo es una respuesta valida.',
        'Nada de esto te pide ser mas suave, mas neutro ni menos explicito, y no decide cuanto se',
        'resiste ni cuanto lleva la iniciativa: eso lo fijan su descripcion y las instrucciones de la',
        'conversacion. Aqui solo se dice que puede, no que deba. Una voz propia, con su registro y su',
        'mala leche si los tiene, es parte del personaje.',
      ].join('\n'),
    });
  }

  if (character !== null) {
    blocks.push({ label: 'quien-eres', text: directiveBlock('QUIEN ERES', character) });
  }

  if (instructions !== null) {
    blocks.push({
      label: 'instrucciones',
      text: directiveBlock('COMO DEBES COMPORTARTE EN ESTA CONVERSACION', instructions),
    });
  }

  const recall = input.recall;
  if (recall !== undefined && recall.episodes.length > 0) {
    blocks.push({
      label: 'recuerdos-lineas',
      text: dataBlock(
        'MOMENTOS ANTERIORES QUE RECUERDAS',
        formatRecallLines(recall.episodes, recall.omitted ?? 0),
      ),
    });
  }
  if (recall?.quoted != null) {
    blocks.push({
      label: 'recuerdo-citado',
      text: dataBlock(
        recall.quoted.listed === false
          ? 'UN MOMENTO QUE NO ESTA EN ESA LISTA, TAL Y COMO OCURRIO'
          : 'UNO DE ESOS MOMENTOS, TAL Y COMO OCURRIO',
        formatQuotedEpisode(recall.quoted),
      ),
    });
  }

  // va despues de los recuerdos y ANTES de la memoria y del mensaje nuevo: el
  // final del prompt gobierna la respuesta inmediata, y pegarlo al final la
  // haria soltar la promesa en cada turno. Sin lineas no se emite: un prompt sin
  // pendientes queda igual que antes
  const pending = input.pending ?? [];
  if (pending.length > 0) {
    blocks.push({
      label: 'pendientes',
      text: dataBlock('ASUNTOS PENDIENTES ENTRE VOSOTROS', formatPendingAffairs(pending)),
    });
  }

  if (input.memory !== null) {
    blocks.push({
      label: 'memoria',
      text: dataBlock(
        'MEMORIA ACUMULATIVA DE ESTA CONVERSACION',
        formatConversationMemory(input.memory),
      ),
    });
  }

  // los `recent` ultimos turnos, en orden. Si hay memoria, lo anterior ya esta
  // resumido ahi; si no la hay, se envia lo que quepa y se avisa abajo.
  const tail = recent <= 0 ? [] : input.turns.slice(-recent);
  const omitted = input.turns.length - tail.length;

  if (omitted > 0 && input.memory === null) {
    // decirlo importa: un modelo que no sabe que le falta contexto se inventa
    // la parte que falta con toda naturalidad
    blocks.push({
      label: 'aviso-turnos-omitidos',
      text: `NOTA: se omiten ${omitted} turnos anteriores y todavia no hay memoria acumulativa. Si necesitas algo de esa parte, pidelo en vez de suponerlo.`,
    });
  }

  if (tail.length > 0) {
    blocks.push({
      label: 'turnos-recientes',
      text: dataBlock(
        'ULTIMOS TURNOS',
        tail
          .map((turn) => `${turn.role === 'user' ? USER_LABEL : ASSISTANT_LABEL}: ${turn.text}`)
          .join('\n\n'),
      ),
    });
  }

  blocks.push({
    label: 'mensaje-nuevo',
    text: dataBlock('MENSAJE NUEVO DEL USUARIO', input.message),
  });

  // el orden importa: la imagen ANTES que la memoria, porque la instruccion de
  // memoria dice que no se escriba nada despues de su bloque. Al separarlos se
  // quita primero el de memoria y luego el de imagen, en el orden inverso
  // el bloque se envia si se puede generar O si hay algo que reenviar.
  //
  // Antes solo lo primero, y eso tiraba una capacidad gratis: reenviar una
  // imagen que YA esta en la conversacion no toca al proveedor ni necesita
  // clave, se lee del disco cifrado. Un personaje sin clave se quedaba sin
  // poder enseñar ni su propia foto de perfil —que el mismo turno acababa de
  // copiar a la conversacion para poder reenviarla—.
  const existing = input.existingImages ?? [];
  // el fallo anterior va DENTRO del bloque de imagen: es informacion sobre
  // esa herramienta y no tiene sentido si la herramienta no se ofrece
  const fallo =
    typeof input.lastImageError === 'string' && input.lastImageError.length > 0
      ? input.lastImageError
      : null;
  if (input.canGenerateImage === true || existing.length > 0) {
    blocks.push({
      label: 'imagen',
      text: buildVaultImageInstruction(
        existing,
        input.imagePromptStyle ?? 'prose',
        input.canGenerateImage === true,
        fallo,
      ),
    });
  }
  blocks.push({ label: 'instruccion-memoria', text: CONVERSATION_MEMORY_INSTRUCTION });

  return blocks;
}
/**
 * el prompt tal y como lo recibe el modelo.
 *
 * Se conserva porque es lo que llama todo el mundo y lo que fijan las pruebas.
 * Por dentro es `composeVaultPrompt` unido: la unica fuente de la verdad sobre
 * el contenido esta ahi y aqui solo se pega.
 */
export function buildVaultPrompt(input: VaultPromptInput): string {
  return composeVaultPrompt(input)
    .map((block) => block.text)
    .join('\n\n');
}

/**
 * cuantos turnos se ahorran respecto a enviar el hilo entero.
 *
 * lo usa la interfaz para poder decir por que una conversacion larga no se
 * vuelve mas lenta ni mas cara con cada mensaje.
 */
export function omittedTurnCount(total: number, recentTurns = VAULT_RECENT_TURNS): number {
  return Math.max(0, total - recentTurns);
}
