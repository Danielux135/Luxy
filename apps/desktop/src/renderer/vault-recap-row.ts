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
import type {
  LocalCliProvider,
  MemoryRelinkFailure,
  MemoryRelinkOutcome,
  MemoryRelinkPhase,
  RecapRefusalKind,
} from '@luxy/shared';

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
  /**
   * la memoria SELLADA de la conversacion; vacia si no la tiene.
   *
   * Es el otro texto, no el mismo: `block` es la ficha retroactiva y esto es lo
   * que ella lee de verdad en ese hilo. Cuando hay memoria propia los dos
   * existen a la vez y solo uno viaja.
   */
  sealedBlock: string;
  source: 'cli' | 'index';
  approved: boolean;
  /** estaba aprobada y el trabajo de fondo la reescribio, asi que dejo de viajar */
  approvalReset: boolean;
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
  /**
   * borrar la memoria propia destaparia su ficha retroactiva.
   *
   * Lo calcula el proceso principal con la misma funcion que decide en el
   * turno: la sellada gana siempre, asi que mientras la haya la ficha es papel
   * muerto, y en cuanto se borra vuelve a ser candidata. Esta aqui porque
   * cambia lo que hay que DECIR antes de pulsar el boton rojo: ahi borrar no
   * limpia, cambia un texto por otro.
   */
  cardRevivesOnForget: boolean;
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
  /** hay FICHA RETROACTIVA escrita que leer; no dice si viaja */
  canRead: boolean;
  /**
   * esa ficha existe y ya no entra en ningun prompt.
   *
   * Es papel muerto: la conversacion sello su propia memoria y la sellada gana
   * siempre. Se marca porque el boton era el mismo «Ver» de una ficha viva y
   * enseñaba la muerta sin decirlo, que es peor que no enseñar nada.
   */
  cardIsStale: boolean;
  /** hay memoria sellada que leer: lo unico que ella lee hoy en ese hilo */
  canReadSealed: boolean;
  /**
   * se puede borrar esa memoria propia, dejando la conversacion intacta.
   *
   * Es la MISMA condicion que leerla y no una distinta: lo que se puede enseñar
   * se puede tirar. Va como campo aparte porque no significa lo mismo —uno abre
   * un recuadro y el otro destruye contenido de Daniel— y porque mañana pueden
   * dejar de coincidir; leerlas de un unico booleano seria darlo por hecho.
   */
  canForgetSealed: boolean;
  /**
   * al borrar esa memoria, la ficha retroactiva EMPEZARIA a viajar.
   *
   * Cambia el texto de la confirmacion y añade una salida: sin esto el dialogo
   * decia «no se toca nada mas» y el acuse «empezara a recordar de nuevo desde
   * estos ultimos», y las dos frases son falsas en ese caso —borrar no deja el
   * hilo a cero, le pone delante un resumen de esa misma conversacion—.
   *
   * Se pide `canForgetSealed` ademas del dato: lo que no se puede borrar no
   * puede destapar nada, y avisar de una consecuencia que no se puede provocar
   * es ruido en un sitio donde todo lo escrito tiene que poder cumplirse.
   */
  forgetRevivesCard: boolean;
  /**
   * borrar esa memoria puede costarle a Daniel la aprobacion de su ficha.
   *
   * Quitar la memoria sellada quita tambien `supersededAt`, y ese campo es el
   * unico filtro que sacaba la conversacion de la cola del trabajo de fondo. Si
   * la pasada la coge y amplia la ficha, la ficha se queda sin aprobar: deja de
   * viajar hasta que Daniel la lea otra vez.
   *
   * Se pide `!forgetRevivesCard` porque son los dos lados de la misma moneda: si
   * la ficha ya cubre hasta el final, empieza a viajar en cuanto se borra la
   * memoria y la pasada no tiene nada que ampliar —de eso avisa el aviso rojo—;
   * si no llega hasta el final, es justo la que la pasada va a reescribir. En
   * esa rama el dialogo decia «la ficha retroactiva se queda donde esta», y eso
   * era verdad del texto y falso de la decision.
   */
  forgetCostsApproval: boolean;
  /** falta la ultima palabra de Daniel para que entre en los prompts */
  canApprove: boolean;
  /**
   * la habia aprobado y ya no lo esta, porque alguien reescribio la ficha.
   *
   * Es lo que separa «todavia no la has mirado» de «tu decision se ha caido».
   * Las dos se veian igual —un «sin aprobar»— y la segunda ademas significa que
   * ese hilo ha dejado de leer una ficha que si leia. Se exige `canApprove`
   * porque avisar de una aprobacion perdida sin ofrecer el boton que la devuelve
   * seria un callejon sin salida.
   */
  approvalLost: boolean;
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
    // leer NO se condiciona a nada mas: es contenido del propio Daniel y verlo
    // no cambia ningun prompt. Lo unico que decide es si hay algo escrito, y
    // por eso son dos preguntas y no una —«¿hay ficha?» y «¿hay memoria
    // sellada?»—: una fila sellada sin ficha previa contestaba que no a la
    // unica pregunta que habia y se quedaba sin un solo boton
    canRead: conFicha,
    cardIsStale: conFicha && propia,
    canReadSealed: row.sealedBlock.length > 0,
    // borrar SOLO se ofrece de lo que se ha podido enseñar. Sin bloque no se
    // sabe si hay memoria —podria haberla y no haber llegado a leerse— y un
    // boton destructivo sobre algo que no se ha visto es lo contrario de lo que
    // pide una accion de este tipo: primero lees, luego decides
    canForgetSealed: row.sealedBlock.length > 0,
    // y con lo que se destaparia al hacerlo: es la diferencia entre «esto
    // limpia» y «esto cambia un texto por otro», y hay que decirla antes
    forgetRevivesCard: row.sealedBlock.length > 0 && row.cardRevivesOnForget,
    forgetCostsApproval:
      row.sealedBlock.length > 0 && !row.cardRevivesOnForget && conFicha && row.approved,
    // aprobar lo que no es una ficha —una negativa sola, o una conversacion que
    // ya tiene memoria propia— dejaria en disco un `approved` que no significa
    // nada y no la haria entrar en ningun prompt
    canApprove: conFicha && !row.approved && !propia,
    // y decir que lo que falta es VOLVER a aprobarla, no aprobarla por primera
    // vez: la ficha que hoy no viaja en ese hilo viajaba ayer
    approvalLost: conFicha && !row.approved && !propia && row.approvalReset,
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

  // ese hilo sello su propia memoria, asi que nada de lo retroactivo le afecta
  // ya: ni aprobar ni rehacer harian nada, y por eso `common` los apaga. Lo que
  // SI queda es leerla, que es lo unico que no depende de que la ficha sirva
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

  // «sin aprobar» a secas es verdad y esconde lo que importa: una ficha que
  // Daniel habia aprobado y que ha dejado de viajar en ese hilo se leia igual
  // que una que nadie ha mirado nunca
  return {
    ...common,
    tone: 'busy',
    state: decorar(common.approvalLost ? 'la aprobaste y se ha reescrito' : 'sin aprobar'),
  };
}

/**
 * lo que se le dice a Daniel DESPUES de borrar la memoria propia de un hilo.
 *
 * Vive aqui, y no suelto en el JSX, porque dos de sus frases eran falsas y solo
 * una prueba las caza:
 *
 *   - «empezara a recordar de nuevo desde estos ultimos» no es verdad cuando al
 *     quitar la sellada queda destapada la ficha retroactiva de esa MISMA
 *     conversacion: entonces el proximo mensaje no va en blanco, va con ESA;
 *   - «Borrado» a secas no es verdad fuera de este equipo. La subida es
 *     idempotente por (boveda, conversacion, secuencia), asi que el registro
 *     que ya esta en el servidor conserva su memoria y el borrado no viaja
 *     (`D-099`). Callarlo seria prometer lo que el codigo no hace.
 */
export function describeForgetAck(input: { turns: number; cardNowInUse: boolean }): string {
  const cuantos =
    input.turns === 0
      ? 'No quedaba ninguna memoria que quitar en este hilo.'
      : input.turns === 1
        ? 'Se ha quitado de 1 mensaje de este hilo.'
        : `Se ha quitado de ${input.turns} mensajes de este hilo.`;

  const siguiente = input.cardNowInUse
    ? 'Los mensajes siguen ahí. Pero ojo: la ficha retroactiva que estaba tapada ha quedado al descubierto, así que desde el próximo mensaje ella leerá ESA, no una memoria en blanco. Si tampoco la quieres, quítala con «Borrarlo».'
    : 'Los mensajes siguen ahí. Si vuelves a escribirle, empezará a recordar de nuevo desde estos últimos.';

  const alcance =
    'Borrado en este equipo: lo que ya se había sincronizado sigue en el servidor, así que en otro ordenador tuyo ella lo seguirá recordando.';

  return `Borrado. ${cuantos} ${siguiente} ${alcance}`;
}

/** lo que hace falta de una fila para saber si la lista ha cambiado */
export interface RecapRowStamp {
  conversationId: string;
  at: string;
  chars: number;
  covered: number;
  turns: number;
  gaps: number;
  block: string;
  sealedBlock: string;
  source: 'cli' | 'index';
  approved: boolean;
  /** entra porque una aprobacion perdida es un cambio, y de los que hay que ver */
  approvalReset: boolean;
  inPrompt: boolean;
  sealed: boolean;
  superseded: boolean;
  excluded: boolean;
  hasEntry: boolean;
  /** entra porque cambia lo que dice la confirmacion del boton rojo */
  cardRevivesOnForget: boolean;
  refusedKind: RecapRefusalKind | null;
  /** la reescritura con su ficha termina en segundo plano: eso tambien es un cambio */
  relink?: { phase: MemoryRelinkPhase } | null;
}

/**
 * una firma de la lista, para contestar «¿ha cambiado algo?».
 *
 * Existe porque «repasar lo que hay» no tenia forma de decir que se habia
 * ejecutado: cuando lo releido coincide con lo que ya estaba, la pantalla se
 * queda exactamente igual y una espera de varios segundos se lee como un boton
 * roto. Comparando esto, el panel puede escribir «sigue igual», que es lo que
 * de verdad ha pasado.
 *
 * NO entra ni una palabra del contenido: de los dos bloques solo se mide el
 * largo. Es suficiente —una ficha reescrita cambia tambien su fecha, su tamaño o
 * su estado— y evita quedarse con una segunda copia de texto descifrado
 * colgando de un `ref` durante toda la sesion.
 */
export function recapSignature(rows: readonly RecapRowStamp[]): string {
  return rows
    .map((row) =>
      [
        row.conversationId,
        row.at,
        row.chars,
        row.covered,
        row.turns,
        row.gaps,
        row.block.length,
        row.sealedBlock.length,
        row.source,
        row.approved,
        row.approvalReset,
        row.inPrompt,
        row.sealed,
        row.superseded,
        row.excluded,
        row.hasEntry,
        row.cardRevivesOnForget,
        row.refusedKind ?? '-',
        row.relink?.phase ?? '-',
      ].join('|'),
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// la memoria reescrita con su ficha (`D-108`)
// ---------------------------------------------------------------------------

/** lo que llega del proceso principal sobre la reescritura de una fila */
export interface RelinkRowView {
  phase: MemoryRelinkPhase;
  provider: LocalCliProvider | null;
  failure: MemoryRelinkFailure | null;
  drift: {
    kept: number;
    rewritten: number;
    dropped: number;
    shortened: number;
    added: number;
    /** ausente en las filas de antes de la septima ronda */
    summaryChanged?: boolean;
  } | null;
  /** la memoria de antes; solo llega mientras se puede volver a ella */
  previousBlock: string;
  holdsRewrite: boolean;
  /** si tiene memoria sellada: sin ella viaja su ficha retroactiva o su indice */
  hasMemory: boolean;
  /** el ultimo intento no termino y no se repite solo hasta reiniciar */
  stalled: boolean;
}

export interface RelinkRowLook {
  tone: 'ok' | 'busy' | 'warn' | 'idle';
  text: string;
  /** «Volver a la de antes» */
  canKeepOld: boolean;
  /** «Reescribir con su ficha» */
  canRetry: boolean;
  /** «Ver la de antes» */
  canReadPrevious: boolean;
}

/**
 * «4 entradas igual, 1 corregida, 1 quitada y 2 añadidas; el resumen también
 * cambió».
 *
 * Las AÑADIDAS y el resumen van a la vista: la guarda solo rechaza lo que se
 * pierde, asi que lo que el CLI meta de mas —datos de su ficha que el encargo
 * le prohibe añadir— se aplica igual, y viaja en cada mensaje y a sus otras
 * conversaciones. Sin esto, «4 igual y 1 corregida» se leia como «no cambio
 * nada mas» (septima ronda, `D-093`).
 */
function driftWords(drift: NonNullable<RelinkRowView['drift']>): string {
  // las recortadas son corregidas que perdieron mas de la mitad: van DENTRO de
  // `rewritten` (`compareMemoryEntries`). Contarlas como otro grupo se leia como
  // una entrada de mas y dos tocadas (octava ronda)
  const recortadas =
    drift.shortened > 0 ? ` (${drift.shortened === 1 ? '1 de ellas recortada' : `${drift.shortened} de ellas recortadas`})` : '';
  const partes = [
    `${drift.kept} ${drift.kept === 1 ? 'entrada igual' : 'entradas igual'}`,
    `${drift.rewritten} ${drift.rewritten === 1 ? 'corregida' : 'corregidas'}${recortadas}`,
  ];
  if (drift.dropped > 0) partes.push(`${drift.dropped} ${drift.dropped === 1 ? 'quitada' : 'quitadas'}`);
  if (drift.added > 0) partes.push(`${drift.added} ${drift.added === 1 ? 'añadida' : 'añadidas'}`);
  const ultima = partes.pop()!;
  const entradas = partes.length === 0 ? ultima : `${partes.join(', ')} y ${ultima}`;
  return drift.summaryChanged === true ? `${entradas}; el resumen también cambió` : entradas;
}

/**
 * como se dice en «Lo que recuerda» en que punto esta la reescritura.
 *
 * Todo en condicional o en pasado comprobado (`D-093`): lo que se sabe es que
 * se le PIDIO al CLI corregir solo el nombre y lo que su ficha contradiga, no
 * que lo haya hecho. Por eso las cifras van a la vista y la de antes se puede
 * leer mientras se puede volver a ella. Sin nada que decir, `null`.
 */
export function describeRelink(
  relink: RelinkRowView | null | undefined,
  /** fuera del trabajo de fondo: ahi no se reescribe nada, ni pulsando */
  excluded: boolean,
): RelinkRowLook | null {
  if (relink === null || relink === undefined) return null;
  const quien = relink.provider === null ? 'el CLI' : CLI_LABELS[relink.provider];
  const base = { canKeepOld: false, canRetry: false, canReadPrevious: false };
  switch (relink.phase) {
    case 'none':
    case 'not-needed':
      return null;
    case 'pending':
      // sin memoria propia: lo que puede viajar es su ficha retroactiva o el
      // indice, que tampoco la llevaban, y no hay nada que reescribir hasta que
      // se selle la primera. Sin boton: pulsarlo no tendria sobre que trabajar.
      //
      // «puede»: la ficha retroactiva solo viaja aprobada y al dia con los
      // ultimos mensajes (`chooseConversationMemory`), y esto afirmaba que le
      // llegaba sin condiciones (`D-093`). La fila no sabe si lo esta; la
      // suya, justo al lado, si lo dice
      if (!relink.hasMemory) {
        const puede =
          'Aquí todavía no tiene memoria propia. Lo que puede llegarle de esta conversación es el índice de sus escenas o su ficha retroactiva, esta solo si está aprobada y al día con los últimos mensajes, y los dos se escribieron sin su ficha.';
        return {
          ...base,
          tone: 'idle',
          text: excluded
            ? `${puede} La conversación está fuera del trabajo de fondo, así que no se va a reescribir.`
            : `${puede} Cuando una respuesta suya aquí guarde memoria, esa se reescribirá con su ficha en segundo plano.`,
        };
      }
      if (excluded) {
        return {
          ...base,
          tone: 'idle',
          text: 'Esta memoria se escribió sin su ficha y no se va a reescribir: la conversación está fuera del trabajo de fondo.',
        };
      }
      // el intento no llego a terminar y con ese CLI no se repite solo hasta
      // reiniciar: decir «en segundo plano» prometeria un trabajo que no va a
      // ocurrir (septima ronda, `D-093`)
      if (relink.stalled) {
        return {
          ...base,
          tone: 'warn',
          text: 'Esta memoria se escribió sin su ficha. El último intento de reescribirla no llegó a terminar y no se volverá a intentar solo hasta que reinicies Studio; puedes pedirlo tú. Mientras tanto viaja la de antes.',
          canRetry: true,
        };
      }
      // «en segundo plano» a secas prometia un trabajo que podia no llegar:
      // la pasada solo se lanza tras un envio (octava ronda, `D-093`)
      return {
        ...base,
        tone: 'busy',
        text: 'Esta memoria se escribió sin su ficha y está pendiente de reescribirse con ella: se intentará en segundo plano después de tu próximo mensaje en Privado, o ahora si pulsas «Reescribir con su ficha». Mientras tanto viaja la de antes.',
        canRetry: true,
      };
    case 'ready':
      return {
        ...base,
        tone: 'ok',
        // excluida no viaja a sus otras conversaciones (`D-105` se las salta):
        // decirlo era prometer un viaje que no ocurre (`D-093`)
        text: `Reescrita con su ficha por ${quien}${
          relink.drift === null ? '' : `: ${driftWords(relink.drift)}`
        }. ${
          excluded
            ? 'Es la que viaja desde tu próximo mensaje aquí; a sus otras conversaciones no, porque esta está fuera de lo que recuerda'
            : 'Es la que viaja desde tu próximo mensaje, aquí o, si tiene encendida «Pasarle la memoria de sus dos últimas conversaciones», en sus otras conversaciones'
        }; hasta que un mensaje aquí guarde memoria nueva puedes volver a la de antes.`,
        canKeepOld: true,
        canReadPrevious: relink.previousBlock.length > 0,
      };
    case 'in-use':
      return {
        ...base,
        tone: 'ok',
        text: 'Reescrita con su ficha, y ya en uso. Hasta que un mensaje aquí guarde memoria nueva todavía puedes volver a la de antes; lo que otra conversación ya se haya llevado de ella se queda allí.',
        canKeepOld: true,
        canReadPrevious: relink.previousBlock.length > 0,
      };
    case 'done':
      return {
        ...base,
        tone: 'idle',
        text: 'Reescrita con su ficha: la memoria de ahora ya se escribió a partir de ella.',
      };
    case 'discarded':
      return {
        ...base,
        tone: 'idle',
        text: 'Te quedaste con la de antes: la reescrita con su ficha no se usa.',
        canRetry: !excluded,
      };
    case 'failed':
      return {
        ...base,
        tone: 'warn',
        text: failureText(relink.failure, quien, excluded, relink.drift),
        canRetry: !excluded,
      };
  }
}

/**
 * excluida no hay boton ni pasada que lo intente (`relinkOne` devuelve
 * `excluded`): ofrecer «pedírselo otra vez» o el otro CLI eran dos salidas que
 * no existian (`D-093`).
 *
 * Lo que la guarda rechazo va con sus cifras: la confirmacion del enganche
 * promete que aqui se ve cuantas entradas dejo igual, corrigio, quito o añadio
 * tambien si no se aplico, y la fila solo lo decia de una aplicada (decima
 * ronda). Sin cifras guardadas, la frase de siempre.
 */
function failureText(
  failure: MemoryRelinkFailure | null,
  quien: string,
  excluded: boolean,
  drift: RelinkRowView['drift'],
): string {
  const sigue = 'sigue valiendo la de antes, escrita sin su ficha.';
  const salida = excluded
    ? ' La conversación está fuera del trabajo de fondo, así que no se vuelve a intentar.'
    : ' Puedes pedírselo otra vez o probar con el otro en «Quién hace el trabajo de fondo».';
  const cifras = drift === null ? '' : ` (${driftWords(drift)})`;
  switch (failure) {
    case 'refused':
      return `${quien} no quiso reescribirla con su ficha, así que ${sigue}${salida}`;
    case 'lossy':
      return `La reescritura con su ficha quitaba o recortaba demasiado${cifras} y no se ha aplicado: ${sigue}`;
    case 'vague':
      return `La reescritura con su ficha ya no decía qué pasó${cifras} y no se ha aplicado: ${sigue}`;
    case 'invalid':
    case null:
      return `La reescritura con su ficha no salió bien y no se ha aplicado: ${sigue}`;
  }
}

/**
 * en que acabo «Reescribir con su ficha», en una linea.
 *
 * Existe porque el boton no decia nada: un CLI que no arranca, una respuesta
 * que llega tarde o una conversacion ocupada dejaban la fila exactamente igual,
 * y la pantalla solo se ponia gris un rato (septima ronda). Solo la
 * clasificacion: nunca lo que dijo el modelo. `quien` es el CLI al que se le
 * pidio.
 */
export function describeRelinkOutcome(
  outcome: MemoryRelinkOutcome,
  quien: string,
): { tone: 'ok' | 'warn' | 'idle'; text: string } {
  const nada = 'No ha cambiado nada.';
  switch (outcome) {
    case 'ready':
      return { tone: 'ok', text: `${quien} la ha reescrito: mira las cifras en la fila.` };
    case 'refused':
      return { tone: 'warn', text: `${quien} no quiso reescribirla. ${nada}` };
    case 'invalid':
      return { tone: 'warn', text: `La respuesta de ${quien} no se pudo usar. ${nada}` };
    case 'vague':
      return {
        tone: 'warn',
        text: `La reescritura de ${quien} ya no decía qué pasó y no se ha aplicado. ${nada}`,
      };
    case 'lossy':
      return {
        tone: 'warn',
        text: `La reescritura de ${quien} quitaba o recortaba demasiado y no se ha aplicado. ${nada}`,
      };
    case 'process':
      return {
        tone: 'warn',
        text: `${quien} no llegó a terminar: puede que su sesión haya caducado o que no arranque. ${nada} Puedes volver a intentarlo o cambiar de CLI en «Quién hace el trabajo de fondo».`,
      };
    case 'cut':
      return { tone: 'idle', text: 'La bóveda se cerró a mitad y no se ha guardado nada.' };
    case 'stale':
      return {
        tone: 'idle',
        text: `Mientras ${quien} la reescribía, la conversación cambió —un mensaje, un enganche o una decisión tuya— y el resultado se ha tirado. Vuelve a intentarlo.`,
      };
    case 'busy':
      return {
        tone: 'idle',
        text: `La conversación estaba contestando, cambiando de personaje o borrando algo. ${nada} Vuelve a intentarlo en un momento.`,
      };
    case 'excluded':
      return { tone: 'idle', text: `La conversación está fuera del trabajo de fondo. ${nada}` };
    case 'locked':
      return { tone: 'idle', text: `La bóveda está cerrada. ${nada}` };
    case 'no-memory':
      return { tone: 'idle', text: `Aquí todavía no tiene memoria propia que reescribir. ${nada}` };
    case 'skipped':
      return {
        tone: 'warn',
        text: 'No se ha hecho nada: o ya no hacía falta, o no se pudo leer o guardar el registro de memorias reescritas.',
      };
  }
}
