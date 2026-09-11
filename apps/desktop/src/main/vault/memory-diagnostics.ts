// diagnostico de la memoria del roleplay, EN NUMEROS.
//
// Para que existe. Daniel pidio que cada mejora incluya las conversaciones ya
// tenidas, y poder probarlas sobre ellas y ver su forma de hablarle. Esas
// conversaciones estan cifradas y tienen que seguir estandolo: copiarlas a
// otro sitio para mirarlas las sacaria de la boveda. Asi que esto corre DENTRO
// de Luxy, con la llave que ya tiene abierta, y devuelve solo cifras. Ni una
// palabra de lo dicho sale de aqui.
//
// Tres preguntas, y cada una tiene su motivo:
//
// 1. COBERTURA. Cuantas conversaciones tienen resumen y etiquetas —las
//    catalogadas— y cuantas solo se trocean por pausas. Las segundas no se
//    encuentran por parafrasis, y el catalogo esta cifrado: sin esto no se
//    sabe cuantas quedan por pasar;
// 2. LA BUSQUEDA POR FECHA, CONTRA FECHAS REALES. Para cada dia en que hubo
//    conversacion se pregunta en falso «¿de que hablamos ayer?» desde el dia
//    siguiente, y se comprueba que trae una de ese dia. Usa
//    `selectEpisodeForDate`, el MISMO camino que un turno real: una copia de la
//    logica podria dar verde mientras la de verdad falla;
// 3. EL ESTILO, EN CIFRAS. Cuanto escribe y con que frecuencia usa fechas,
//    pide recuerdos o habla de lo que se dijeron. Solo porcentajes de patrones.
//
// PURO: recibe los datos ya leidos. Asi se prueba sin montar una boveda.
import type { TemporalAnchor } from '@luxy/shared';
import { civilDayLabel, resolveTemporalReference } from '@luxy/shared';
import type { Episode } from './episodes.js';
import {
  looksLikeConversationRecall,
  looksLikeMemoryRequest,
  selectEpisodeForDate,
} from './recall.js';

export interface DiagnosticInput {
  episodes: readonly Episode[];
  /** solo los del USUARIO: el estilo que interesa es el suyo, no el de ella */
  userMessages: readonly string[];
  conversationIds: readonly string[];
  /** la zona y el corte del dia. El instante se ignora: cada prueba pone el suyo */
  anchor: TemporalAnchor;
}

export interface MemoryDiagnostics {
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
  style: {
    userMessages: number;
    medianChars: number;
    withTemporalReference: number;
    withMemoryRequest: number;
    withConversationRecall: number;
  };
}

/** la pregunta de la prueba: habla de lo dicho Y nombra el dia */
const PREGUNTA_DE_PRUEBA = '¿de qué hablamos ayer?';

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

export function diagnoseMemory(input: DiagnosticInput): MemoryDiagnostics {
  const { episodes, userMessages, conversationIds, anchor } = input;

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

  // --- estilo -------------------------------------------------------------------
  let conFecha = 0;
  let conRecuerdo = 0;
  let conLoDicho = 0;
  for (const mensaje of userMessages) {
    if (resolveTemporalReference(mensaje, anchor) !== null) conFecha += 1;
    if (looksLikeMemoryRequest(mensaje)) conRecuerdo += 1;
    if (looksLikeConversationRecall(mensaje)) conLoDicho += 1;
  }

  return {
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
    dateRecall: {
      tested: porDia.size,
      hits: porDia.size - fallidos.length,
      misses: fallidos.length,
      missedDays: fallidos.sort(),
    },
    style: {
      userMessages: userMessages.length,
      medianChars: mediana(userMessages.map((mensaje) => mensaje.length)),
      withTemporalReference: conFecha,
      withMemoryRequest: conRecuerdo,
      withConversationRecall: conLoDicho,
    },
  };
}
