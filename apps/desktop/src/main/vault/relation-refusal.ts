// que negativas apuntadas en un cursor de pendientes siguen valiendo.
//
// Hasta `INV-FONDO-001` un fallo del PROCESO del CLI —Claude Code sin sesion—
// llegaba como una respuesta sin bloque y se apuntaba como negativa, con
// `refusedVersion: 1`. Todas las que hay en disco de entonces son falsas: el
// registro no tiene ni una negativa de verdad desde que existe el extractor.
//
// La recuperacion es no reescribir nada. Las negativas pasan a apuntarse con su
// propia version, una por delante de la del extractor, y solo cuentan las que la
// alcanzan. Las de antes se quedan en el archivo tal cual, sin efecto:
//
//  - `through` y `version` no se tocan, asi que no se relee nada de lo ya leido;
//  - no hay escritura, asi que no hay nada que pueda salir mal en el archivo
//    donde estan las decisiones de Daniel;
//  - ocurre una sola vez por construccion: toda negativa nueva nace con la
//    version de ahora y sigue valiendo hasta que crezca la conversacion, como
//    siempre (`D-088`);
//  - un Studio anterior que lea el archivo sigue tomandolas por negativas
//    (`2 < 1` es falso), que es lo seguro.
//
// Modulo sin E/S: lo leen la pasada, la seleccion de cada turno y el
// diagnostico.
import { RELATION_EXTRACTOR_VERSION, type RelationCursor } from '@luxy/shared';

/**
 * la version con la que se apunta una negativa en `refusedVersion`.
 *
 * Va una por delante de la del extractor y sube sola con ella: una version nueva
 * del extractor sigue reintentando lo que negaba la anterior, como antes.
 */
export const RELATION_REFUSAL_VERSION = RELATION_EXTRACTOR_VERSION + 1;

/** true si el cursor lleva una negativa que todavia cuenta, haya crecido o no */
export function isCurrentRefusal(cursor: Pick<RelationCursor, 'refusedVersion'>): boolean {
  return cursor.refusedVersion !== null && cursor.refusedVersion >= RELATION_REFUSAL_VERSION;
}

/**
 * true si el cursor lleva una negativa de antes de esta version, que ya no
 * cuenta. Solo para el diagnostico: que se vea cuantas habia y que no bloquean.
 */
export function isLegacyRefusal(cursor: Pick<RelationCursor, 'refusedVersion'>): boolean {
  return cursor.refusedVersion !== null && cursor.refusedVersion < RELATION_REFUSAL_VERSION;
}
