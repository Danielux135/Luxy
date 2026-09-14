// cuando merece la pena dar otra vuelta al trabajo de fondo.
//
// El catalogo y los pendientes se hacen en tandas de tres conversaciones, y el
// panel repite la tanda hasta acabar. La pregunta «¿sigo?» parece trivial y no
// lo es: cortar de mas deja conversaciones sin leer y el panel diciendo que ya
// esta todo; cortar de menos arranca el CLI una y otra vez para nada.
//
// Vive aparte de `Vault.tsx` para poder probarla. Dentro del JSX era una linea
// que solo se podia comprobar abriendo la aplicacion, y las dos veces que estuvo
// mal el sintoma fue el mismo: «no queda nada pendiente» con trabajo sin hacer.
//
// PURO: recibe el resultado de una tanda y devuelve si dar otra.

/** lo que hizo una tanda de la pasada de pendientes */
export interface RelationSweepRound {
  /** conversaciones que siguen por revisar al terminar */
  pending: number;
  /** cuyas ventanas avanzaron el cursor */
  reviewed: number;
  /** que no contestaron con el bloque */
  refused: number;
  /** que no se pudieron leer */
  failed: number;
}

/**
 * si dar otra vuelta a la pasada de pendientes.
 *
 * No basta con mirar `reviewed`. Con contenido explicito es normal que un CLI se
 * niegue, y las tres conversaciones de una tanda son SIEMPRE las tres mas
 * antiguas: si las tres se niegan, `reviewed` vale 0 y el bucle cortaba dejando
 * el resto sin leer, aunque la tanda siguiente habria cogido otras tres —las
 * negadas quedan marcadas y se saltan—. Lo que de verdad dice que seguir no
 * sirve es que no pase NADA: ni se revise, ni se niegue, ni falle nada. Eso solo
 * ocurre cuando no hay candidatas que tocar, y entonces la vuelta siguiente
 * seria identica.
 */
export function keepSweepingRelations(round: RelationSweepRound | null): boolean {
  // `null` es un error ya enseñado en pantalla: insistir solo lo repetiria
  if (round === null) return false;
  if (round.pending === 0) return false;
  return round.reviewed > 0 || round.refused > 0 || round.failed > 0;
}

/** lo que hizo una tanda del catalogo */
export interface CatalogSweepRound {
  pending: number;
  cataloged: number;
  failed: number;
}

/**
 * si dar otra vuelta al catalogo.
 *
 * El mismo razonamiento y el mismo defecto que arriba: una negativa entra en
 * `catalogFailures` sin tocar `cataloged`, y esa conversacion queda excluida de
 * la tanda siguiente. Cortar con `cataloged === 0` a secas se comia las que si
 * se habrian catalogado.
 */
export function keepSweepingCatalog(round: CatalogSweepRound | null): boolean {
  if (round === null) return false;
  if (round.pending === 0) return false;
  return round.cataloged > 0 || round.failed > 0;
}
