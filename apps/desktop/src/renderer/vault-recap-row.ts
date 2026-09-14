// como se enseña una ficha de continuidad en el panel.
//
// Vive fuera del JSX por lo mismo que `vault-sweep.ts`: dentro era una cadena de
// ternarios que solo se podia comprobar abriendo la aplicacion, y una de las
// cosas que decide no es estetica, es la regla de la §8.3 del diseño:
//
//   - en pantalla va la CLASIFICACION de lo que paso, NUNCA lo que contesto el
//     modelo. A este CLI se le ha pedido describir la escena, asi que lo que
//     diga en lugar de la ficha puede citarla;
//   - y una conversacion que nadie ha querido resumir NO anuncia de que iba: se
//     enseña el dia, el numero de mensajes y que paso, y el titulo se queda
//     fuera.
//
// La otra cosa que decide es a que CLI apunta «Rehacerlo», que tiene que ser
// SIEMPRE el que no se nego.
//
// PURO: recibe la fila tal y como llega del proceso principal y devuelve como se
// pinta.
import type { LocalCliProvider, RecapRefusalKind } from '@luxy/shared';

export const CLI_LABELS: Record<LocalCliProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/**
 * por que no hubo ficha, en palabras.
 *
 * Cinco estados y no uno, porque el arreglo de cada uno es distinto: una
 * negativa se arregla cambiando de CLI, una ficha vaga cambiando de MODELO, y un
 * bloque cortado o ilegible reintentando con el mismo. Mezclarlos es el defecto
 * que ya tiene la pasada de pendientes.
 */
export const RECAP_REFUSAL_LABELS: Record<RecapRefusalKind, string> = {
  refused: 'se negó a resumirla',
  absent: 'no contestó con la ficha',
  truncated: 'la ficha salió cortada',
  invalid: 'la ficha no se pudo leer',
  vague: 'salió demasiado vaga',
};

/**
 * lo mismo, cuando SI hay ficha y lo que se negó fue un tramo.
 *
 * Es el caso que el diseño llama literalmente ÉXITO: el modelo resumió lo que
 * pudo y dijo dónde no llegó, y esa ficha viaja de verdad en cada turno de ese
 * hilo. Con las palabras de arriba —«se negó a resumirla»— un éxito parcial se
 * leía como fallo total, sin título y en amarillo, y lo que invitaba a pulsar
 * era «Rehacerlo», que puede dejar la conversación sin la única ficha que sí
 * funcionaba.
 */
export const RECAP_PARTIAL_REFUSAL_LABELS: Record<RecapRefusalKind, string> = {
  refused: 'no quiso resumir lo que falta',
  absent: 'no contestó con la ficha de lo que falta',
  truncated: 'dejó cortada la ficha de lo que falta',
  invalid: 'no se pudo leer la ficha de lo que falta',
  vague: 'no dijo nada de lo que falta',
};

/** el otro CLI: el reintento de una negativa apunta al que NO se nego */
export function otherCli(provider: LocalCliProvider): LocalCliProvider {
  return provider === 'claude' ? 'codex' : 'claude';
}

/** lo minimo de una fila que hace falta para decidir como se pinta */
export interface RecapRowView {
  title: string;
  /** `formatConversationMemory` de la ficha; vacio si no hay nada que leer */
  block: string;
  source: 'cli' | 'index';
  approved: boolean;
  /** si HOY viajaria de verdad en el prompt, calculado como lo calcula el turno */
  inPrompt: boolean;
  /** la pasada ya la marco como que tiene memoria propia */
  superseded: boolean;
  /**
   * esa conversacion tiene memoria sellada AHORA MISMO.
   *
   * Llega antes que `superseded`, que es la marca que estampa la pasada
   * siguiente. Entre las dos, contestar un turno de un hilo sin aprobar sella
   * memoria propia y la ficha deja de poder entrar: sin esto la fila decia
   * «aprobada, pero todavia no llega hasta los ultimos turnos», que es un
   * motivo falso.
   */
  sealed: boolean;
  /** excluida a mano del trabajo de fondo: la pasada no la va a tocar */
  excluded: boolean;
  /** hay entrada suya en el almacen; falso mientras nadie la haya leido */
  hasEntry: boolean;
  refusedKind: RecapRefusalKind | null;
  refusedProvider: LocalCliProvider | null;
}

export interface RecapRowLook {
  tone: 'ok' | 'busy' | 'warn' | 'idle';
  /** el estado, en palabras */
  state: string;
  /** el titulo de la conversacion, o `null` cuando NO puede enseñarse */
  title: string | null;
  /** a que CLI apunta «Rehacerlo» */
  retryWith: LocalCliProvider;
  /** el texto del boton: no se «rehace» lo que nadie ha leido todavia */
  redoLabel: string;
  /** hay algo escrito que leer */
  canRead: boolean;
  /** falta la ultima palabra de Daniel para que entre en los prompts */
  canApprove: boolean;
  /** se puede volver a hacer desde cero */
  canRedo: boolean;
}

/**
 * como se pinta una fila.
 *
 * `current` es el CLI elegido ahora mismo para el trabajo de fondo: es a donde
 * apunta «Rehacerlo» cuando no hubo ninguna negativa.
 */
export function describeRecapRow(row: RecapRowView, current: LocalCliProvider): RecapRowLook {
  const kind = row.refusedKind;
  const negada = kind !== null;
  const conFicha = row.block.length > 0;
  const propia = row.sealed || row.superseded;

  /**
   * hay ficha de un CLI Y ademas algo se nego: es un EXITO parcial.
   *
   * No es una negativa y no se pinta como tal. Esa ficha esta viajando en cada
   * turno de ese hilo, asi que decir «Codex se nego a resumirla» —en amarillo y
   * sin titulo, para siempre— es el error inverso al que la §8.3 evita: leer un
   * exito como un fallo, y empujar a rehacerlo, que es lo unico que si puede
   * dejar esa conversacion sin nada.
   *
   * El indice deducido queda fuera a proposito: ahi de verdad no hay resumen de
   * lo que se dijo, y el diseño le da su propia frase.
   */
  const parcial = negada && conFicha && row.source === 'cli';

  // el titulo NO acompaña nunca a una negativa sin ficha: si nadie ha querido
  // resumir esa conversacion, decir de que iba en la misma linea es justo lo que
  // se estaba evitando. Con ficha si sale, porque el bloque entero se lee a un
  // clic con «Ver» y ocultar el titulo ahi no protege nada
  const title = (negada && !parcial) || !conFicha ? null : row.title;

  // quien se nego elige a donde apunta el boton; sin negativa, el elegido arriba
  const retryWith =
    row.refusedKind === null ? current : otherCli(row.refusedProvider ?? current);

  const common = {
    title,
    retryWith,
    // lo que nadie ha leido todavia no se «rehace»
    redoLabel: `${row.hasEntry ? 'Rehacerlo' : 'Leerla'} con ${CLI_LABELS[retryWith]}`,
    canRead: conFicha,
    // aprobar lo que no es una ficha —una negativa sola, o una conversacion que
    // ya tiene memoria propia— dejaria en disco un `approved` que no significa
    // nada y no la haria entrar en ningun prompt
    canApprove: conFicha && !row.approved && !propia,
    // la sellada gana siempre, asi que rehacer la suya seria tirar el trabajo; y
    // una excluida no la coge la pasada, asi que el boton no haria nada
    canRedo: !propia && !row.excluded,
  };

  /** lo que matiza al estado sin cambiarlo, en orden de importancia */
  const decorar = (base: string): string => {
    const partes = [base];
    if (parcial && kind !== null) {
      const quien = CLI_LABELS[row.refusedProvider ?? current];
      partes.push(`${quien} ${RECAP_PARTIAL_REFUSAL_LABELS[kind]}`);
    }
    // sin esto, una excluida ofrecia «Rehacerlo» y la pasada la saltaba sin
    // decir por que
    if (row.excluded) partes.push('excluida del trabajo de fondo');
    return partes.join(' · ');
  };

  if (propia) {
    return { ...common, tone: 'idle', state: 'ya tiene memoria propia' };
  }

  // nadie la ha leido todavia. Existe como fila para poder contestar «¿cuales
  // faltan?» y para que la que ni se pudo leer ni se pudo guardar tenga desde
  // donde reintentarse
  if (!row.hasEntry) {
    return { ...common, tone: 'idle', state: decorar('sin leer todavía') };
  }

  if (kind !== null && !parcial) {
    const quien = CLI_LABELS[row.refusedProvider ?? current];
    return {
      ...common,
      tone: 'warn',
      // «solo indice» delante porque cambia lo que significa lo que hay: no es
      // una ficha a medias, es que no hay ficha y queda el indice de sus escenas
      state: decorar(
        row.source === 'index'
          ? `sólo índice: ${quien} ${RECAP_REFUSAL_LABELS[kind]}`
          : `${quien} ${RECAP_REFUSAL_LABELS[kind]}`,
      ),
    };
  }

  if (row.inPrompt) {
    return {
      ...common,
      tone: 'ok',
      state: decorar(row.source === 'index' ? 'sólo índice, en uso' : 'en uso'),
    };
  }

  // aprobada y aun asi no viaja: le falta llegar hasta los ultimos turnos, que
  // es la invariante de cobertura. Callarlo dejaria una fila que dice «aprobada»
  // de algo que el turno esta descartando
  if (row.approved) {
    return {
      ...common,
      tone: 'busy',
      state: decorar('aprobada, pero todavía no llega hasta los últimos turnos'),
    };
  }

  return { ...common, tone: 'busy', state: decorar('sin aprobar') };
}
