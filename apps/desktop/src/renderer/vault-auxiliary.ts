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

/**
 * el ultimo fallo del PROCESO de un CLI del trabajo de fondo, tal y como llega
 * con el estado de la boveda (`INV-FONDO-001`). Solo enums y horas.
 */
export interface AuxiliaryFailureNotice {
  provider: 'claude' | 'codex';
  reason: 'auth' | 'rate_limit' | 'api_error' | 'exit_code' | null;
  /**
   * con que modelo y esfuerzo fallo; `null` o ausente, los que trae el CLI. La
   * espera es de ese lanzamiento (duodecima ronda)
   */
  model?: string | null;
  effort?: string | null;
  /** la espera es del CLI entero: una cuenta sin sesion */
  wholeProvider?: boolean;
}

/**
 * el CLI con lo que lo hace distinto de los demas lanzamientos, si lo hay.
 *
 * Una espera de un modelo solo frena lo que va con ese modelo: el aviso tiene
 * que decir cual, o Daniel culparia al CLI entero.
 */
function launchLabel(failure: AuxiliaryFailureNotice, label: string): string {
  if (failure.wholeProvider === true) return label;
  const model = failure.model ?? null;
  const effort = failure.effort ?? null;
  const detalle = [
    ...(model !== null && model.length > 0 ? [`modelo ${model}`] : []),
    ...(effort !== null ? [`esfuerzo ${effort}`] : []),
  ];
  return detalle.length === 0 ? label : `${label} (${detalle.join(', ')})`;
}

/** el CLI con su nombre de programa, que es lo que Daniel escribe en la consola */
const CLI_PROGRAM: Record<
  AuxiliaryFailureNotice['provider'],
  { label: string; login: string; run: string }
> = {
  claude: { label: 'Claude Code', login: 'claude auth login', run: 'claude' },
  codex: { label: 'Codex', login: 'codex login', run: 'codex' },
};

/**
 * que decirle a Daniel cuando el CLI del trabajo de fondo no puede contestar.
 *
 * Existe porque durante una semana Claude Code estuvo sin sesion y la pantalla
 * no dijo nada: los trabajos de fondo contaban negativas que no existian. El
 * texto dice QUE HACER y no culpa al contenido. No cambia de CLI por su cuenta
 * (no hay sustituciones silenciosas): como mucho recuerda que el otro esta
 * arriba, en el mismo desplegable. Decide por el enum del agente, nunca por un
 * mensaje: el mensaje es prosa y puede cambiar.
 */
export function describeAuxiliaryFailure(failure: AuxiliaryFailureNotice): {
  tone: 'warn' | 'idle';
  text: string;
} {
  const cli = CLI_PROGRAM[failure.provider];
  const otro = failure.provider === 'claude' ? 'Codex' : 'Claude';
  const solo = 'No hace falta reiniciar Luxy: se vuelve a intentar solo pasados unos minutos';
  const lanzado = launchLabel(failure, cli.label);
  // con un modelo o un esfuerzo concretos, lo demas del trabajo de fondo sigue:
  // se dice, para que no parezca que esta todo parado
  const soloEse = lanzado === cli.label ? '' : ' Solo espera lo que va con eso; lo demás sigue.';
  switch (failure.reason) {
    case 'auth':
      return {
        tone: 'warn',
        text: `${cli.label} no tiene la sesión iniciada en este equipo, así que el trabajo de fondo con él está parado. Abre una consola y ejecuta: ${cli.login}. ${solo}, o al momento si pulsas «Buscar lo pendiente en lo ya hablado». Si lo prefieres, mientras tanto puedes elegir ${otro} aquí arriba.`,
      };
    case 'rate_limit':
      return {
        tone: 'idle',
        text: `${lanzado} ha llegado a su límite de uso, así que el trabajo de fondo con él espera.${soloEse} ${solo}; no tienes que hacer nada. Si lo prefieres, mientras tanto puedes elegir ${otro} aquí arriba.`,
      };
    case 'api_error':
    case 'exit_code':
    case null:
      return {
        tone: 'warn',
        text: `El último intento del trabajo de fondo con ${lanzado} no llegó a terminar.${soloEse} ${solo}. Si se repite, abre una consola y ejecuta ${cli.run} para ver qué le pasa.`,
      };
  }
}
