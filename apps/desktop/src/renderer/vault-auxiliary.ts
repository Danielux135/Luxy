// a quien va cada trabajo de fondo de la boveda, y como se llama en pantalla.
//
// Vive fuera del JSX por el mismo motivo que `vault-sweep.ts` y
// `vault-recap-row.ts`: dentro era una linea que solo se podia comprobar
// abriendo la aplicacion, y lo que decide no es estetico.
//
// Los tres trabajos de fondo NO se resuelven igual, y esa es toda la historia:
//
//   - el catalogo SI manda el proveedor de la ventana, asi que su destino se
//     calcula con el `pedido` (`handlers.ts`, `catalogOnce`);
//   - la pasada de pendientes y la del relleno llaman con `null` y se quedan con
//     lo elegido en el panel, o con Codex (`relation-sync.ts`, `recap-sync.ts`).
//
// El panel los calculaba todos con el `pedido`. Con «Automatico» y la ventana
// hablando por Claude —que es el estado inicial de la aplicacion— el panel decia
// Claude y el trabajo salia por Codex: «Rehacerlo con Claude» se lo volvia a
// mandar al mismo CLI que acababa de negarse, y sin decirlo.
//
// PURO: recibe la preferencia guardada y devuelve a donde va de verdad.
import { resolveAuxiliaryTarget, type AuxiliaryChoice, type AuxiliaryTarget } from '@luxy/shared';

/**
 * a donde va lo que corre POR DETRAS: los pendientes y la memoria de lo ya
 * hablado.
 *
 * Es literalmente la misma llamada que hacen las dos pasadas en el proceso
 * principal. No se le pasa nunca el proveedor de la ventana: si lo hiciera,
 * volveria la divergencia que esto existe para cerrar.
 */
export function backgroundAuxiliary(preference: AuxiliaryChoice | null): AuxiliaryTarget {
  return resolveAuxiliaryTarget(null, preference);
}

/** como se le llama en pantalla: el modelo si lo hay, y si no el CLI */
export function auxiliaryName(target: { provider: string; model: string | null }): string {
  return target.model ?? (target.provider === 'codex' ? 'Codex' : 'Claude');
}
