import type { IpcResult } from '../shared/ipc.js';

/**
 * el texto que ve el usuario cuando el puente rompe la llamada.
 *
 * Fijo y sin el motivo dentro: aquí no hay forma de saber qué trae un error que
 * viene de fuera, y la regla de la bóveda es que un mensaje de error nunca
 * lleve contenido descifrado.
 *
 * Y dice «no se sabe» en vez de «no se ha hecho», que es lo que decía antes:
 * un rechazo de `invoke` tapa dos casos distintos —la llamada que no llegó a
 * entrar (canal inexistente, argumento no clonable) y la que entró, corrió y se
 * rompió al volver— y desde aquí no se distinguen. Con un borrado delante, la
 * frase categórica le decía a Daniel que no se había borrado nada con el
 * archivo ya reescrito. Un mensaje de error tiene que afirmar sólo lo que el
 * código garantiza.
 */
export const BRIDGE_FAILURE_MESSAGE =
  'no se ha podido hablar con el proceso principal: no se sabe si la operación llegó a hacerse';

/** qué hacer, que es lo único accionable cuando se cae el puente */
export const BRIDGE_FAILURE_HINT =
  'vuelve a mirar cómo quedó antes de repetirlo; si sigue igual, cierra y vuelve a abrir Luxy Studio';

/**
 * llama al puente y convierte una promesa rechazada en un fallo normal.
 *
 * `handle()` envuelve cada manejador del proceso principal, así que lo que se
 * rompe DENTRO llega como `{ ok: false }` y la pantalla lo pinta. Lo que se
 * rompe antes de entrar —un canal que no existe, la ventana recargándose a
 * media llamada, un argumento que no se puede clonar— sale como un rechazo, y
 * un rechazo en esta pantalla no es nada: los manejadores son `void f()` sin
 * `catch`, el botón vuelve a su etiqueta y se ve exactamente lo mismo que si
 * hubiera ido bien. Un fallo que se lee como un éxito es peor que el fallo.
 */
export async function callBridge<T>(
  operation: () => Promise<IpcResult<T>>,
): Promise<IpcResult<T>> {
  try {
    return await operation();
  } catch {
    return { ok: false, error: BRIDGE_FAILURE_MESSAGE, hint: BRIDGE_FAILURE_HINT };
  }
}
