// diagnostico de la memoria del roleplay, EN NUMEROS.
//
// Para que existe. Se pidio que cada mejora incluya las conversaciones ya
// tenidas, y poder probarlas sobre ellas y ver la forma de hablarle. Esas
// conversaciones estan cifradas y tienen que seguir estandolo: copiarlas a
// otro sitio para mirarlas las sacaria de la boveda. Asi que esto corre DENTRO
// de Luxy, con la llave que ya tiene abierta, y devuelve solo cifras. Ni una
// palabra de lo dicho sale de aqui.
//
// Lo que mira, y por que:
//
// 1. COBERTURA. Cuantas conversaciones tienen resumen y etiquetas —las
//    catalogadas— y cuantas solo se trocean por pausas. Las segundas no se
//    encuentran por parafrasis;
// 2. EL INDICE. Cuantos momentos caben en las lineas y cuantos no. La primera
//    pasada sobre la boveda real dio 40 momentos con un tope de 40;
// 3. LA BUSQUEDA POR FECHA, CONTRA FECHAS REALES. Para cada dia en que hubo
//    conversacion se pregunta «¿de que hablamos ayer?» desde el dia siguiente
//    y se comprueba que trae uno de ese dia;
// 4. EL PRINCIPIO. De varias formas corrientes de preguntar como os
//    conocisteis, cuantas lo reconocen. Es una prueba de los patrones, no de los
//    datos: el primer momento es siempre el mas antiguo;
// 5. LOS MENSAJES DE VERDAD. Cada mensaje del usuario se pasa por `recallRoute`
//    con los momentos que existian al escribirlo y la misma ventana de historial
//    que un turno real, y se cuenta que camino habria disparado. Es lo que dice
//    si los patrones casan con como se habla de verdad.
//
// Se mide UN personaje, el que le pasa el handler: un turno real solo ve los
// recuerdos del suyo (`D-058`), y mezclar los de todos daria cifras de una
// memoria que no existe.
//
// PURO: recibe los datos ya leidos. Asi se prueba sin montar una boveda.
import type { TemporalAnchor } from '@luxy/shared';
import { VAULT_RECENT_TURNS, civilDayLabel, resolveTemporalReference } from '@luxy/shared';
import type { Episode } from './episodes.js';
import {
  MAX_EPISODE_LINES,
  looksLikeConversationRecall,
  looksLikeMemoryRequest,
  recallRoute,
  selectEpisodeForDate,
  selectIndexEpisodes,
  selectOriginEpisode,
} from './recall.js';

/** un mensaje del USUARIO: el estilo que interesa es el suyo, no el de ella */
export interface DiagnosticMessage {
  text: string;
  createdAt: string;
  conversationId: string;
  /** su numero de turno: con el se calcula la ventana de historial reciente */
  sequence: number;
}

export interface DiagnosticInput {
  /** los del personaje medido, del mas reciente al mas antiguo */
  episodes: readonly Episode[];
  userMessages: readonly DiagnosticMessage[];
  conversationIds: readonly string[];
  /** la zona y el corte del dia. El instante se ignora: cada prueba pone el suyo */
  anchor: TemporalAnchor;
  /** el tope de lineas; por defecto el de un turno real */
  indexCap?: number;
  /** conversaciones de otros personajes, que no se miden */
  otherConversations?: number;
  /** a quien se mide; `null` si son las conversaciones sin personaje */
  characterName?: string | null;
}

export interface MemoryDiagnostics {
  scope: {
    /** de otros personajes o sin personaje: quedan fuera, como en un turno real */
    otherConversations: number;
    /** a quien se mide, para que la pantalla lo diga; nunca va al registro */
    characterName: string | null;
  };
  conversations: {
    total: number;
    /** con resumen y etiquetas: se encuentran por parafrasis */
    cataloged: number;
    /** troceadas por pausas: solo se encuentran por las palabras exactas */
    gapOnly: number;
    /** sin ningun episodio, por ejemplo vacias o excluidas */
    withoutEpisodes: number;
  };
  episodes: {
    total: number;
    cataloged: number;
    firstDay: string | null;
    lastDay: string | null;
    distinctDays: number;
  };
  index: {
    cap: number;
    /** momentos que van como linea en cada turno */
    lines: number;
    /** los que no caben: se recuerdan igual por fecha, principio o palabras */
    omitted: number;
    /** el primer momento de todos, que va fijo */
    firstInIndex: boolean;
  };
  dateRecall: {
    tested: number;
    hits: number;
    misses: number;
    /**
     * los dias que fallaron, como `AAAA-MM-DD`.
     *
     * Son metadatos —cuando se hablo, no que se dijo—, y son lo unico que
     * permite ver POR QUE falla: casi siempre es una conversacion de
     * madrugada, que es donde el dia civil y el del calendario no coinciden.
     */
    missedDays: string[];
  };
  origin: {
    /** formas de preguntarlo que se prueban */
    probes: number;
    /** cuantas traen el primer momento */
    found: number;
    /** el dia civil del primer momento, `AAAA-MM-DD` */
    day: string | null;
  };
  style: {
    userMessages: number;
    medianChars: number;
    /** con una fecha de verdad; «cuando nos conocimos» no cuenta como fecha */
    withTemporalReference: number;
    withMemoryRequest: number;
    withConversationRecall: number;
  };
  /**
   * que habria hecho la memoria con cada mensaje, cuando se escribio.
   *
   * Cada mensaje cuenta en un solo sitio, el camino que dispara, como en un
   * turno real.
   */
  triggers: {
    byOrigin: number;
    byDate: number;
    /** buscarian por palabras; si acertarian no se sabe sin leer el contenido */
    byWords: number;
    /** nombraban un dia sin preguntar por lo dicho, y no dispararon nada */
    dateWithoutQuestion: number;
    /** preguntaban por un dia en que no hubo conversacion: ella tiene que decirlo */
    dateWithoutMoment: number;
    /** preguntaban por un dia cuyo momento ya iba entero en el historial reciente */
    dateInHistory: number;
  };
}

/** la pregunta de la prueba: habla de lo dicho Y nombra el dia */
const PREGUNTA_DE_PRUEBA = '¿de qué hablamos ayer?';

/** formas corrientes de preguntar por el principio; todas deberian reconocerse */
const PREGUNTAS_DEL_PRINCIPIO: readonly string[] = [
  '¿cómo nos conocimos?',
  '¿te acuerdas de cómo nos conocimos?',
  '¿te acuerdas del día que nos conocimos?',
  '¿te acuerdas del día en que nos conocimos?',
  '¿cómo fue que nos conocimos?',
  'cuéntame cómo nos conocimos',
  '¿recuerdas la primera vez que hablamos?',
  '¿te acuerdas del primer día?',
  '¿te acuerdas de cuando empezamos?',
  '¿dónde te conocí?',
];

/** siete horas despues del corte del dia son las doce del mediodia local */
const HORAS_HASTA_MEDIODIA = 7;

function esCatalogado(episode: Episode): boolean {
  return typeof episode.catalogedBy === 'string' && episode.catalogedBy.length > 0;
}

function mediana(valores: readonly number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? Math.round(((ordenados[mitad - 1] ?? 0) + (ordenados[mitad] ?? 0)) / 2)
    : (ordenados[mitad] ?? 0);
}

function masAntiguo(episodes: readonly Episode[]): Episode | null {
  let primero: Episode | null = null;
  for (const episode of episodes) {
    if (primero === null || episode.startedAt < primero.startedAt) primero = episode;
  }
  return primero;
}

export function diagnoseMemory(input: DiagnosticInput): MemoryDiagnostics {
  const { episodes, userMessages, conversationIds, anchor } = input;
  const cap = input.indexCap ?? MAX_EPISODE_LINES;

  // --- cobertura -------------------------------------------------------------
  const catalogadas = new Set<string>();
  const conEpisodios = new Set<string>();
  for (const episode of episodes) {
    conEpisodios.add(episode.conversationId);
    if (esCatalogado(episode)) catalogadas.add(episode.conversationId);
  }
  const soloPausas = [...conEpisodios].filter((id) => !catalogadas.has(id)).length;

  // --- dias en que se hablo ----------------------------------------------------
  // un episodio representante por dia civil: el que sirve de ancla a la prueba
  const porDia = new Map<string, Episode>();
  for (const episode of episodes) {
    const dia = civilDayLabel(episode.startedAt, anchor);
    if (!porDia.has(dia)) porDia.set(dia, episode);
  }
  const dias = [...porDia.keys()].sort();

  // --- el indice y el principio ----------------------------------------------------
  const { visible, omitted } = selectIndexEpisodes(episodes, cap);
  const primero = masAntiguo(episodes);
  const reconocidas = PREGUNTAS_DEL_PRINCIPIO.filter(
    (pregunta) => primero !== null && selectOriginEpisode(episodes, pregunta) === primero,
  ).length;

  // --- la prueba por fecha ------------------------------------------------------
  const fallidos: string[] = [];
  for (const [dia, representante] of porDia) {
    // el rango de ESE dia, tomando como ancla el propio episodio: si fue de
    // madrugada, «hoy» ya resuelve al dia civil anterior, que es el caso que se
    // quiere ejercitar
    const hoy = resolveTemporalReference('hoy', { ...anchor, instant: representante.startedAt });
    if (hoy === null) {
      fallidos.push(dia);
      continue;
    }
    // y la pregunta, hecha desde el mediodia del dia siguiente
    const mediodiaSiguiente = new Date(
      new Date(hoy.to).getTime() + HORAS_HASTA_MEDIODIA * 60 * 60 * 1000,
    ).toISOString();
    const elegido = selectEpisodeForDate(episodes, PREGUNTA_DE_PRUEBA, {
      ...anchor,
      instant: mediodiaSiguiente,
    });
    const acierta = elegido !== null && civilDayLabel(elegido.startedAt, anchor) === dia;
    if (!acierta) fallidos.push(dia);
  }

  // --- estilo, y que habria disparado cada mensaje -------------------------------
  let conFecha = 0;
  let conRecuerdo = 0;
  let conLoDicho = 0;
  const disparos = {
    byOrigin: 0,
    byDate: 0,
    byWords: 0,
    dateWithoutQuestion: 0,
    dateWithoutMoment: 0,
    dateInHistory: 0,
  };
  for (const mensaje of userMessages) {
    // el ancla es el momento en que se escribio: «ayer» es el ayer de entonces
    const ancla: TemporalAnchor = { ...anchor, instant: mensaje.createdAt };
    const referencia = resolveTemporalReference(mensaje.text, ancla);
    const fecha = referencia !== null && referencia.kind !== 'principio';
    const recuerdo = looksLikeMemoryRequest(mensaje.text);
    const loDicho = looksLikeConversationRecall(mensaje.text);
    if (fecha) conFecha += 1;
    if (recuerdo) conRecuerdo += 1;
    if (loDicho) conLoDicho += 1;

    // los momentos que existian al escribirlo, y la MISMA ventana de historial
    // que calcula el turno real: los ultimos VAULT_RECENT_TURNS antes de este
    const conocidos = episodes.filter((episode) => episode.startedAt <= mensaje.createdAt);
    const camino = recallRoute(conocidos, mensaje.text, ancla, {
      conversationId: mensaje.conversationId,
      fromSequence: mensaje.sequence - VAULT_RECENT_TURNS,
    });
    if (camino.kind === 'principio') disparos.byOrigin += 1;
    else if (camino.kind === 'fecha') disparos.byDate += 1;
    else if (camino.kind === 'palabras') disparos.byWords += 1;
    // no disparo nada, y nombraba un dia. Tres casos distintos: no preguntaba,
    // que es lo correcto; preguntaba por un dia cuyo momento ya iba entero en el
    // historial; o preguntaba por un dia en que no hablasteis
    else if (fecha && (recuerdo || loDicho)) {
      if (selectEpisodeForDate(conocidos, mensaje.text, ancla) !== null) {
        disparos.dateInHistory += 1;
      } else {
        disparos.dateWithoutMoment += 1;
      }
    } else if (fecha) disparos.dateWithoutQuestion += 1;
  }

  return {
    scope: {
      otherConversations: input.otherConversations ?? 0,
      characterName: input.characterName ?? null,
    },
    conversations: {
      total: conversationIds.length,
      cataloged: catalogadas.size,
      gapOnly: soloPausas,
      withoutEpisodes: conversationIds.filter((id) => !conEpisodios.has(id)).length,
    },
    episodes: {
      total: episodes.length,
      cataloged: episodes.filter(esCatalogado).length,
      firstDay: dias[0] ?? null,
      lastDay: dias[dias.length - 1] ?? null,
      distinctDays: dias.length,
    },
    index: {
      cap,
      lines: visible.length,
      omitted,
      firstInIndex: primero !== null && visible.includes(primero),
    },
    dateRecall: {
      tested: porDia.size,
      hits: porDia.size - fallidos.length,
      misses: fallidos.length,
      missedDays: fallidos.sort(),
    },
    origin: {
      probes: PREGUNTAS_DEL_PRINCIPIO.length,
      found: reconocidas,
      day: primero === null ? null : civilDayLabel(primero.startedAt, anchor),
    },
    style: {
      userMessages: userMessages.length,
      medianChars: mediana(userMessages.map((mensaje) => mensaje.text.length)),
      withTemporalReference: conFecha,
      withMemoryRequest: conRecuerdo,
      withConversationRecall: conLoDicho,
    },
    triggers: disparos,
  };
}
