// lo que la pantalla dice de una sincronizacion (`SYNC-F1-08`).
//
// Vive fuera del JSX por lo mismo que `vault-notice.ts`: cada frase de aqui es
// una promesa sobre lo que ha pasado con la copia de la boveda, y una promesa
// asi no se escribe a mano en tres sitios. La regla que manda (`D-093`):
//
//   **«Sincronizados» solo cuando los turnos y los archivos de este ordenador
//   estan en el servidor.** Una conversacion fallida, congelada, ocupada, sin
//   empezar; un archivo que no subio; una pasada parada a mitad: cualquiera de
//   esas cosas y el titular dice que falta algo, y dice que.
//
// Y el titular dice QUE se sincronizo, nunca «todo» (STUDIO-R2-01): en F1 solo
// viajan turnos y archivos. Los personajes, las fichas de memoria, los
// enganches, la reescrita, el cuaderno, el catalogo y las exclusiones no, y
// «coincidia» a secas hacia creer que la copia del servidor bastaba para
// recuperarlo todo. Cada resumen lo dice en una linea fija (NOT_TRAVELING_YET).
//
// Y dos reglas que salieron de la revision (STUDIO-R1-01 y -02):
//
//   - **en pasado y con hora.** En F1 nada sincroniza solo: en cuanto Daniel
//     escribe, «coincide» deja de ser verdad y la pantalla lo seguia diciendo.
//     Se dice «coincidia a las 10:42», y si desde entonces se escribio o se
//     borro algo aqui, se dice tambien;
//   - **lo que no se miro no se afirma.** «Solo esta conversacion» habla de
//     esa conversacion; nunca de «todo este ordenador».
//
// PURO: recibe el resultado del proceso principal y devuelve texto.
import type {
  VaultSyncConversationReport,
  VaultSyncDiagnosis,
  VaultSyncResult,
  VaultSyncStopReason,
} from '../shared/ipc.js';

export type SyncTone = 'ok' | 'warn' | 'fault' | 'idle';

export interface SyncLine {
  tone: SyncTone;
  text: string;
}

export interface SyncConversationRow {
  conversationId: string;
  title: string;
  tone: SyncTone;
  /** como acabo, en pocas palabras */
  label: string;
  /** turnos aqui frente a turnos en el servidor */
  counts: string;
  /** el porque, si hace falta */
  detail: string | null;
}

export interface SyncSummary {
  headline: SyncLine;
  lines: SyncLine[];
  conversations: SyncConversationRow[];
}

/** lo que se dice al borrar una conversacion mientras no haya papelera (F1) */
export const DELETE_KEEPS_SERVER_COPY =
  'Borrarla la quita de este ordenador; la copia del servidor se borrará con la próxima actualización.';

/** lo que no viaja todavia y la pantalla tiene que decir */
export const CAPTION_DOES_NOT_TRAVEL =
  'Corregir el pie de foto de una imagen todavía no viaja: el otro ordenador ve el que tenía.';

export const REPLICA_NOTICE =
  'Este ordenador es una copia: se estrenó con la bóveda de tu cuenta sin nada propio. Puede leer lo que baja, pero no escribe en Privado hasta que viajen también las fichas, Lía y lo demás (la siguiente versión de la sincronización).';

/**
 * lo que esta version NO copia, dicho siempre junto a cualquier resultado.
 *
 * Sin esta linea, un titular correcto sobre turnos y archivos se leia como
 * «el servidor tiene mi boveda entera» y la copia a mano parecia sobrar
 * (STUDIO-R2-01). Son las piezas que el diseño deja para F2.
 */
export const NOT_TRAVELING_YET =
  'Todavía no viajan Lía y los demás personajes (con sus fotos de perfil), las fichas de memoria, los enganches de una conversación a un personaje, la memoria reescrita, el cuaderno de la relación, el catálogo de escenas ni las conversaciones apartadas de los recuerdos: llegan con la siguiente versión de la sincronización. Hasta entonces, la copia de seguridad a mano de la bóveda sigue haciendo falta.';

/**
 * el titular cuando los turnos y los archivos de este ordenador estaban en el
 * servidor al acabar. Es el UNICO sitio donde se dice; lleva la hora, porque lo
 * que se escriba despues ya no esta alli, y nombra lo que se copio, porque en
 * F1 no es todo (STUDIO-R2-01). Dice «estaban en el servidor» y no
 * «coincidian»: el servidor puede guardar aun conversaciones borradas aqui
 */
export function syncAllGood(time: string): string {
  return `Turnos y archivos sincronizados a las ${time}: en ese momento, los de este ordenador estaban también en el servidor.`;
}

/** el titular de «solo esta conversacion» cuando quedo copiada */
export function conversationCopied(time: string, local: number, server: number): string {
  return `Los turnos y archivos de esta conversación quedaron copiados a las ${time}: ${plural(local, 'turno', 'turnos')} aquí, ${server} en el servidor. Las demás no se han mirado.`;
}

/** lo que se añade cuando solo se ha mirado una conversacion */
export const ONLY_THIS_CONVERSATION =
  'Solo se ha mirado esta conversación: las demás no se han comparado con el servidor.';

/** «HH:MM» en la hora de este ordenador */
export function localTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export interface SummarizeSyncOptions {
  /**
   * desde la pasada se ha escrito o borrado algo en este ordenador: eso no esta
   * en el servidor, y la pantalla no puede seguir diciendo que coincidia todo
   */
  changedSince?: boolean;
  /** como se escribe la hora; las pruebas la fijan */
  timeOf?: (iso: string) => string;
}

/** por que se paro la pasada, dicho para Daniel */
export function describeStop(reason: VaultSyncStopReason): string {
  switch (reason) {
    case 'locked':
      return 'La bóveda se cerró a mitad: la sincronización se ha interrumpido y no se da nada por bueno. Ábrela y vuelve a sincronizar; sigue donde se quedó.';
    case 'session':
      return 'Tu sesión ha caducado: vuelve a entrar en tu cuenta para sincronizar. Lo tuyo sigue en este ordenador.';
    case 'gateway-outdated':
      return 'El servidor todavía no tiene la sincronización nueva: hay que actualizarlo. No se ha subido ni bajado nada.';
    case 'gateway-protocol':
      return 'El servidor habla otra versión de la sincronización: actualiza Luxy Studio. No se ha tocado nada.';
    case 'unreachable':
      return 'No se ha podido hablar con el servidor. Lo tuyo sigue en este ordenador; vuelve a intentarlo con conexión.';
    case 'server-error':
      return 'El servidor ha fallado antes de poder seguir. Lo tuyo sigue en este ordenador; vuelve a intentarlo más tarde.';
    case 'tombstones-unreadable':
      return 'La lista de conversaciones borradas de este ordenador no se puede leer. No se ha sincronizado nada: sin ella volverían conversaciones que borraste.';
    case 'media-store-missing':
      return 'Falta el almacén de archivos en el servidor: los turnos se han sincronizado, las imágenes y los vídeos no.';
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function row(report: VaultSyncConversationReport, title: string): SyncConversationRow {
  const counts =
    report.server === null
      ? `${report.local} aquí`
      : `${report.local} aquí · ${report.server} en el servidor`;
  const base = { conversationId: report.conversationId, title, counts };
  switch (report.status) {
    case 'ok':
      return {
        ...base,
        tone: report.local === report.server ? 'ok' : 'warn',
        label: report.local === report.server ? 'al día' : 'copiada, con diferencias',
        detail:
          report.local === report.server
            ? null
            : 'lo que hay aquí y lo que hay en el servidor no suman lo mismo: mira los avisos de abajo',
      };
    case 'frozen':
      return {
        ...base,
        tone: 'fault',
        label: 'en dos versiones: no se copia',
        detail:
          'la misma parte de la conversación es distinta aquí y en el servidor. No se ha borrado nada de ningún lado. Puedes seguir escribiendo aquí, pero esta conversación no se copia hasta que se pueda separar en dos.',
      };
    case 'local-duplicates':
      return {
        ...base,
        tone: 'fault',
        label: 'con turnos repetidos aquí: no se sube',
        detail: `${plural(report.duplicateSequences, 'posición tiene', 'posiciones tienen')} dos turnos distintos en este ordenador. No se sube hasta decidir cuál vale; no se ha tocado nada.`,
      };
    case 'busy':
      return {
        ...base,
        tone: 'warn',
        label: 'ocupada: va en la siguiente',
        detail: 'estaba contestando, borrándose o cambiando de personaje. Sus archivos sí han viajado.',
      };
    case 'failed':
      return {
        ...base,
        tone: 'fault',
        label: 'falló',
        detail: report.error ?? 'falló sin motivo conocido',
      };
    case 'interrupted':
      return {
        ...base,
        tone: 'fault',
        label: 'interrumpida',
        detail: 'la bóveda se cerró mientras se copiaba; no se da por buena',
      };
    case 'not-reached':
      return { ...base, tone: 'idle', label: 'sin empezar', detail: null };
  }
}

/**
 * el resumen de una pasada: titular, avisos y una fila por conversacion.
 *
 * `titleOf` pone nombre a cada conversacion con lo que la pantalla ya tiene
 * descifrado; lo que no conoce sale como «conversación sin abrir aquí».
 */
export function summarizeSync(
  result: VaultSyncResult,
  titleOf: (conversationId: string) => string | null,
  options: SummarizeSyncOptions = {},
): SyncSummary {
  const time = (options.timeOf ?? localTime)(result.finishedAt);
  const lines: SyncLine[] = [];
  const conversations = result.conversations.map((report) =>
    row(report, titleOf(report.conversationId) ?? 'conversación sin abrir aquí'),
  );

  const count = (status: VaultSyncConversationReport['status']): number =>
    result.conversations.filter((report) => report.status === status).length;
  const sum = (field: 'serverLost' | 'notUploadable' | 'unopenable' | 'unreadable'): number =>
    result.conversations.reduce((total, report) => total + report[field], 0);
  const mismatched = result.conversations.filter(
    (report) => report.status === 'ok' && report.local !== report.server,
  ).length;

  if (result.stopped !== null) {
    lines.push({ tone: 'fault', text: describeStop(result.stopped) });
  }
  if (options.changedSince === true) {
    lines.push({
      tone: 'warn',
      text: `Desde la sincronización de las ${time} has escrito o borrado algo en este ordenador: eso todavía no está en el servidor. Vuelve a sincronizar para copiarlo.`,
    });
  }
  if (result.scope === 'conversation') lines.push({ tone: 'idle', text: ONLY_THIS_CONVERSATION });
  if (result.role === 'replica') lines.push({ tone: 'warn', text: REPLICA_NOTICE });

  lines.push({
    tone: 'idle',
    text: `Turnos: ${result.uploaded} subidos, ${result.downloaded} bajados. Lo que viaja va cifrado; el servidor no puede leerlo.`,
  });

  const failed = count('failed');
  const frozen = count('frozen');
  const duplicates = count('local-duplicates');
  const busy = count('busy');
  const interrupted = count('interrupted');
  const notReached = count('not-reached');
  if (failed > 0) {
    lines.push({
      tone: 'fault',
      text: `${plural(failed, 'conversación ha fallado', 'conversaciones han fallado')}; las demás han seguido. Vuelve a sincronizar para reintentarlo.`,
    });
  }
  if (frozen > 0) {
    lines.push({
      tone: 'fault',
      text: `${plural(frozen, 'conversación está', 'conversaciones están')} en dos versiones y no se ${frozen === 1 ? 'copia' : 'copian'}. No se ha borrado nada.`,
    });
  }
  if (duplicates > 0) {
    lines.push({
      tone: 'fault',
      text: `${plural(duplicates, 'conversación tiene', 'conversaciones tienen')} turnos repetidos en este ordenador y no se ${duplicates === 1 ? 'sube' : 'suben'}.`,
    });
  }
  if (busy > 0) {
    lines.push({
      tone: 'warn',
      text: `${plural(busy, 'conversación estaba ocupada', 'conversaciones estaban ocupadas')}: ${busy === 1 ? 'va' : 'van'} en la siguiente.`,
    });
  }
  if (interrupted + notReached > 0 && result.stopped !== null) {
    lines.push({
      tone: 'warn',
      text: `${plural(interrupted + notReached, 'conversación se ha quedado', 'conversaciones se han quedado')} sin copiar en esta pasada.`,
    });
  }
  if (mismatched > 0) {
    lines.push({
      tone: 'warn',
      text: `En ${plural(mismatched, 'conversación', 'conversaciones')} lo de aquí y lo del servidor no suman lo mismo.`,
    });
  }

  const lost = sum('serverLost');
  if (lost > 0) {
    lines.push({
      tone: 'warn',
      text: `El servidor había perdido ${plural(lost, 'turno', 'turnos')} que ya tenía; se ${lost === 1 ? 'ha' : 'han'} vuelto a subir.`,
    });
  }
  const notUploadable = sum('notUploadable');
  if (notUploadable > 0) {
    lines.push({
      tone: 'warn',
      text: `${plural(notUploadable, 'turno no puede', 'turnos no pueden')} viajar (de más de 4 MiB o con una forma que el servidor no admite) y se ${notUploadable === 1 ? 'queda' : 'quedan'} solo aquí.`,
    });
  }
  const unopenable = sum('unopenable');
  if (unopenable > 0) {
    lines.push({
      tone: 'fault',
      text: `${plural(unopenable, 'turno del servidor no se abre', 'turnos del servidor no se abren')} con esta bóveda y no se ${unopenable === 1 ? 'ha' : 'han'} guardado.`,
    });
  }
  const unreadable = sum('unreadable');
  if (unreadable > 0) {
    lines.push({
      tone: 'warn',
      text: `${plural(unreadable, 'línea de este ordenador no se puede', 'líneas de este ordenador no se pueden')} leer y no ${unreadable === 1 ? 'viaja' : 'viajan'}.`,
    });
  }

  const media = result.media;
  if (media.reached) {
    lines.push({
      tone: 'idle',
      text: `Archivos: ${media.uploaded} subidos, ${media.downloaded} bajados${media.alreadyThere > 0 ? `, ${media.alreadyThere} ya estaban` : ''}.`,
    });
    if (media.skipped > 0) {
      lines.push({
        tone: 'warn',
        text: `${plural(media.skipped, 'archivo es demasiado grande', 'archivos son demasiado grandes')} para sincronizar y se ${media.skipped === 1 ? 'queda' : 'quedan'} en el ordenador donde se ${media.skipped === 1 ? 'creó' : 'crearon'}. El resto sí ha viajado.`,
      });
    }
    if (media.waiting > 0) {
      lines.push({
        tone: 'warn',
        text: `${plural(media.waiting, 'archivo espera', 'archivos esperan')} a que suba su conversación: ${media.waiting === 1 ? 'irá' : 'irán'} en la siguiente.`,
      });
    }
    if (media.failed > 0) {
      lines.push({
        tone: 'fault',
        text: `${plural(media.failed, 'archivo ha fallado', 'archivos han fallado')}${media.error === null ? '' : `: ${media.error}`}.`,
      });
    } else if (media.error !== null) {
      lines.push({ tone: 'fault', text: `Los archivos no se han podido sincronizar: ${media.error}.` });
    }
    if (media.unopenable > 0) {
      lines.push({
        tone: 'fault',
        text: `${plural(media.unopenable, 'archivo del servidor no se abre', 'archivos del servidor no se abren')} con esta bóveda y no se ${media.unopenable === 1 ? 'ha' : 'han'} guardado.`,
      });
    }
    if (media.notUploadable > 0) {
      lines.push({
        tone: 'warn',
        text: `${plural(media.notUploadable, 'archivo tiene', 'archivos tienen')} una forma que el servidor no admite y no ${media.notUploadable === 1 ? 'viaja' : 'viajan'}.`,
      });
    }
  }

  if (result.deletedStillOnServer > 0) {
    lines.push({
      tone: 'idle',
      text: `${plural(result.deletedStillOnServer, 'conversación borrada aquí sigue', 'conversaciones borradas aquí siguen')} en el servidor: su copia se borrará con la próxima actualización. No vuelve${result.deletedStillOnServer === 1 ? '' : 'n'} a este ordenador.`,
    });
  }

  // siempre, y no solo en una replica: el titular habla de turnos y archivos,
  // y esto es lo que se queda fuera de el (STUDIO-R2-01)
  lines.push({ tone: 'idle', text: NOT_TRAVELING_YET });

  return { headline: headlineOf(result, lines, time), lines, conversations };
}

/**
 * el titular: «sincronizados» SOLO si no hay ni un aviso de nada, en pasado,
 * con la hora y diciendo que se copio. Con «solo esta conversacion» habla de
 * esa y de nada mas
 */
function headlineOf(result: VaultSyncResult, lines: readonly SyncLine[], time: string): SyncLine {
  if (result.stopped !== null) {
    return {
      tone: 'fault',
      text:
        result.stopped === 'locked'
          ? 'Sincronización interrumpida: no se da nada por bueno.'
          : 'La sincronización se ha parado antes de terminar.',
    };
  }
  const faults = lines.filter((line) => line.tone === 'fault').length;
  const warnings = lines.filter((line) => line.tone === 'warn').length;
  if (faults > 0) {
    return { tone: 'fault', text: 'Sincronización incompleta: hay cosas que no se han copiado.' };
  }
  if (warnings > 0) {
    return { tone: 'warn', text: 'Sincronización con avisos: mira qué falta por copiar.' };
  }
  if (result.scope === 'conversation') {
    const [only] = result.conversations;
    // sin fila: la conversacion pedida se habia borrado en este ordenador
    if (only === undefined) {
      return {
        tone: 'warn',
        text: 'No se ha copiado nada: esa conversación se borró en este ordenador.',
      };
    }
    return { tone: 'ok', text: conversationCopied(time, only.local, only.server ?? 0) };
  }
  if (result.conversations.length === 0 && !result.media.reached) {
    return { tone: 'idle', text: 'No había nada que sincronizar.' };
  }
  return { tone: 'ok', text: syncAllGood(time) };
}

export interface DiagnosisSummary {
  headline: SyncLine;
  lines: SyncLine[];
}

/**
 * el diagnostico local, antes de subir nada: cuantas conversaciones hay y
 * cuales tienen secuencias repetidas. Cifras y titulos, nada de dentro.
 */
export function summarizeDiagnosis(
  diagnosis: VaultSyncDiagnosis,
  titleOf: (conversationId: string) => string | null,
): DiagnosisSummary {
  const total = diagnosis.conversations.length;
  const turns = diagnosis.conversations.reduce((sum, entry) => sum + entry.turns, 0);
  const lines: SyncLine[] = [];

  const repeated = diagnosis.conversations.filter((entry) => entry.duplicateSequences > 0);
  for (const entry of repeated) {
    lines.push({
      tone: 'fault',
      text: `«${titleOf(entry.conversationId) ?? 'conversación sin abrir aquí'}»: ${plural(entry.duplicateSequences, 'posición repetida', 'posiciones repetidas')} con turnos distintos. No se subirá.`,
    });
  }
  const unreadable = diagnosis.conversations.reduce((sum, entry) => sum + entry.unreadable, 0);
  if (unreadable > 0) {
    lines.push({
      tone: 'warn',
      text: `${plural(unreadable, 'línea no se puede', 'líneas no se pueden')} leer y no ${unreadable === 1 ? 'viajará' : 'viajarán'}.`,
    });
  }
  const copies = diagnosis.conversations.reduce((sum, entry) => sum + entry.duplicateLines, 0);
  if (copies > 0) {
    lines.push({
      tone: 'idle',
      text: `${plural(copies, 'línea es una copia exacta', 'líneas son copias exactas')} de otra: viaja una sola vez.`,
    });
  }
  const holes = diagnosis.conversations.reduce((sum, entry) => sum + entry.holes, 0);
  if (holes > 0) {
    lines.push({
      tone: 'idle',
      text: `Faltan ${plural(holes, 'turno', 'turnos')} en medio de alguna conversación; si el servidor los tiene, se bajarán.`,
    });
  }
  const partial = diagnosis.conversations.filter((entry) => entry.partialTail).length;
  if (partial > 0) {
    lines.push({
      tone: 'warn',
      text: `${plural(partial, 'conversación acaba', 'conversaciones acaban')} en una línea a medias; lo siguiente se escribirá detrás sin pisarla.`,
    });
  }
  if (diagnosis.deleted === null) {
    lines.push({
      tone: 'fault',
      text: 'La lista de conversaciones borradas de este ordenador no se puede leer: no se podrá sincronizar hasta arreglarla.',
    });
  } else if (diagnosis.deleted > 0) {
    lines.push({
      tone: 'idle',
      text: `${plural(diagnosis.deleted, 'conversación borrada', 'conversaciones borradas')} en este ordenador no ${diagnosis.deleted === 1 ? 'viajará' : 'viajarán'}.`,
    });
  }

  return {
    headline: {
      tone: repeated.length > 0 || diagnosis.deleted === null ? 'fault' : 'idle',
      text: `En este ordenador: ${plural(total, 'conversación', 'conversaciones')} con ${plural(turns, 'turno', 'turnos')}${repeated.length > 0 ? `; ${plural(repeated.length, 'tiene', 'tienen')} turnos repetidos` : ''}.`,
    },
    lines,
  };
}
