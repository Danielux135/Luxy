// que recuadro de la boveda pinta un aviso, y con que dentro.
//
// Vive fuera del JSX por lo mismo que `vault-recap-row.ts`: dentro era una
// condicion distinta escrita a mano en cada panel, y las condiciones escritas a
// mano en cinco sitios se separan. Ya se separaron dos veces:
//
//   - el mismo error se pintaba en cuatro o cinco recuadros a la vez, uno de
//     ellos dentro de un panel que nadie habia tocado. Se arreglo dandole dueño
//     al error (`errorArea`);
//   - y al hacerlo, la PISTA se quedo sin dueño. `hint` es la mitad accionable
//     del fallo —dice que hacer—, y seguia pintandose siempre en «Boveda
//     abierta», en el mismo hueco y con el mismo tono con el que se dice «Clave
//     guardada», mientras el motivo aparecia varios paneles mas arriba. Quien
//     leia el error no leia la salida.
//
// La regla, en una frase: la pista va DONDE VA SU ERROR. Sola —sin error— solo
// puede ser un acuse de algo que salio bien, y esos no son de ninguna seccion.
//
// PURO: recibe el estado del controlador y devuelve lo que hay que pintar.
import type { VaultErrorArea } from './useVault.js';

/** el estado del controlador que decide un aviso */
export interface VaultNoticeState {
  error: string | null;
  errorArea: VaultErrorArea | null;
  hint: string | null;
}

export interface VaultNotice {
  /** `fault` cuando hay motivo; `ok` cuando lo unico que hay es un acuse */
  tone: 'fault' | 'ok';
  error: string | null;
  /** que hacer. Nunca viaja sin su error, salvo cuando es el acuse entero */
  hint: string | null;
}

/**
 * lo que pinta un recuadro concreto, o `null` si no le toca nada.
 *
 * `slots` son las areas de las que ese recuadro se hace cargo; `null` es el
 * aviso general de la pagina, que es el unico que no puede quedar plegado ni
 * fuera de pantalla y por eso recoge lo que no es de nadie.
 *
 * Un recuadro de seccion nunca pinta un acuse de exito: los acuses no tienen
 * seccion y se quedan en el general.
 */
export function vaultNoticeFor(
  state: VaultNoticeState,
  slots: readonly VaultErrorArea[] | null,
): VaultNotice | null {
  if (state.error !== null) {
    const suyo =
      slots === null
        ? state.errorArea === null
        : state.errorArea !== null && slots.includes(state.errorArea);
    if (!suyo) return null;
    return { tone: 'fault', error: state.error, hint: state.hint };
  }

  // sin error, lo unico que puede quedar es un acuse —«Clave guardada»—, y esos
  // no pertenecen a ninguna seccion
  if (slots !== null || state.hint === null) return null;
  return { tone: 'ok', error: null, hint: state.hint };
}
