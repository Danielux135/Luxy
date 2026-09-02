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
import { buildVaultImageInstruction, type VaultImageOnFile } from './vault-image-request.js';
import {
  CONVERSATION_MEMORY_INSTRUCTION,
  formatConversationMemory,
  type ConversationMemory,
} from './schemas.js';

/**
 * cuantos turnos recientes se envian literalmente.
 *
 * Los anteriores viven en la memoria acumulativa. Ocho deja ver el hilo
 * inmediato —a lo que el usuario se refiere cuando dice "eso"— sin arrastrar
 * toda la conversacion.
 */
export const VAULT_RECENT_TURNS = 8;

export interface VaultPromptTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface VaultPromptInput {
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
   * imagenes que ya existen en esta conversacion.
   *
   * Sin esta lista el modelo no puede reenviar nada: no sabe que hay, asi que
   * genera otra —pagando— cada vez que le piden «la de antes».
   */
  existingImages?: VaultImageOnFile[];
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

export function buildVaultPrompt(input: VaultPromptInput): string {
  const recent = input.recentTurns ?? VAULT_RECENT_TURNS;
  const blocks: string[] = [];

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
    blocks.push(
      [
        'Estas manteniendo una conversacion privada encarnando al personaje descrito abajo.',
        'Responde SIEMPRE como ese personaje, en primera persona y con su voz.',
        'Este espacio es para roleplay ficticio y consentido entre adultos: todos los personajes',
        'y participantes de la escena son personas adultas (18+). El tono puede ser adulto o intimo',
        'cuando el usuario y las instrucciones de la conversacion lo establezcan.',
        'No te presentes como asistente, modelo ni IA, y no expliques limitaciones tecnicas,',
        'salvo que el usuario pregunte por ellas de forma directa.',
        'Manten sus rasgos, su forma de hablar y lo que ya haya dicho de si mismo.',
        'Trata como canon los hechos que el usuario establece sobre la escena y la apariencia actual',
        'si no contradicen una directiva fija. No inventes otra ropa, postura o situacion para negarlos.',
        'Conserva los limites expresos del personaje, pero no inventes una negativa fuera de rol.',
      ].join('\n'),
    );
  }

  if (character !== null) blocks.push(directiveBlock('QUIEN ERES', character));

  if (instructions !== null) {
    blocks.push(directiveBlock('COMO DEBES COMPORTARTE EN ESTA CONVERSACION', instructions));
  }

  if (input.memory !== null) {
    blocks.push(
      dataBlock('MEMORIA ACUMULATIVA DE ESTA CONVERSACION', formatConversationMemory(input.memory)),
    );
  }

  // los `recent` ultimos turnos, en orden. Si hay memoria, lo anterior ya esta
  // resumido ahi; si no la hay, se envia lo que quepa y se avisa abajo.
  const tail = recent <= 0 ? [] : input.turns.slice(-recent);
  const omitted = input.turns.length - tail.length;

  if (omitted > 0 && input.memory === null) {
    // decirlo importa: un modelo que no sabe que le falta contexto se inventa
    // la parte que falta con toda naturalidad
    blocks.push(
      `NOTA: se omiten ${omitted} turnos anteriores y todavia no hay memoria acumulativa. Si necesitas algo de esa parte, pidelo en vez de suponerlo.`,
    );
  }

  if (tail.length > 0) {
    blocks.push(
      dataBlock(
        'ULTIMOS TURNOS',
        tail
          .map((turn) => `${turn.role === 'user' ? USER_LABEL : ASSISTANT_LABEL}: ${turn.text}`)
          .join('\n\n'),
      ),
    );
  }

  blocks.push(dataBlock('MENSAJE NUEVO DEL USUARIO', input.message));

  // el orden importa: la imagen ANTES que la memoria, porque la instruccion de
  // memoria dice que no se escriba nada despues de su bloque. Al separarlos se
  // quita primero el de memoria y luego el de imagen, en el orden inverso
  if (input.canGenerateImage === true) {
    blocks.push(buildVaultImageInstruction(input.existingImages ?? []));
  }
  blocks.push(CONVERSATION_MEMORY_INSTRUCTION);

  return blocks.join('\n\n');
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
