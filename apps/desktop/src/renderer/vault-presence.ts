// hay alguien delante de la pantalla Privado.
//
// Desde `D-106` leer la boveda no la mantiene abierta: la propia pantalla se
// releia sola y la tuvo abierta hora y media sin nadie delante. Lo que cuenta
// ahora es la presencia real —teclado, raton, rueda— y el proceso principal la
// vuelve a comprobar: ventana a la vista y con el foco.
//
// Escuchar teclado y raton no basta con los clics: leer una respuesta larga y
// desplazarse por ella no manda ningun IPC, y la boveda se cerraria mientras el
// lee.
import { useEffect } from 'react';

/**
 * como mucho un aviso cada 20 s.
 *
 * El reloj del cierre mira cada 15 s y el ajuste mas bajo es 1 minuto: veinte
 * segundos de retraso son como mucho un tercio de ese minimo. Y `pointermove`
 * dispara decenas de veces por segundo.
 */
export const VAULT_PRESENCE_INTERVAL_MS = 20_000;

/** lo que cuenta como alguien delante */
export const VAULT_PRESENCE_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;

/**
 * la puerta, sin DOM: decide si un evento se avisa.
 *
 * Avisa con el PRIMER evento y no al final del intervalo, para que volver a la
 * pantalla cuente en el acto. Un evento sintetico (`isTrusted: false`) no lo
 * genera una persona y no cuenta nunca.
 *
 * `inFront` es la misma condicion que vuelve a mirar el proceso principal —la
 * pagina visible y la ventana con el foco—, y se mira ANTES de gastar el
 * intervalo. Si no, pasar el raton por encima de Luxy sin el foco gastaba los
 * 20 s con un aviso que main no contaba, y el clic que le daba el foco podia
 * tardar ese rato en contar.
 */
export function createPresenceGate(options: {
  intervalMs: number;
  now: () => number;
  send: () => void;
  inFront?: () => boolean;
}): (event: { isTrusted: boolean }) => void {
  let lastSentAt: number | null = null;
  return (event) => {
    if (!event.isTrusted) return;
    if (options.inFront !== undefined && !options.inFront()) return;
    const at = options.now();
    if (lastSentAt !== null && at - lastSentAt < options.intervalMs) return;
    lastSentAt = at;
    options.send();
  };
}

/**
 * engancha la puerta a la ventana mientras `enabled` sea cierto.
 *
 * Solo lo monta la pantalla Privado: trabajar en otra seccion con la boveda
 * abierta no la mantiene viva, igual que antes. `mark` tiene que ser estable o
 * se volveria a enganchar en cada render.
 */
export function useVaultPresence(enabled: boolean, mark: () => void): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const gate = createPresenceGate({
      intervalMs: VAULT_PRESENCE_INTERVAL_MS,
      now: () => Date.now(),
      send: mark,
      // una ventana escondida o sin el foco no tiene a nadie delante, aunque le
      // lleguen eventos: el raton puede pasar por encima de camino a otra
      inFront: () => document.visibilityState === 'visible' && document.hasFocus(),
    });
    const listener = (event: Event): void => gate(event);
    for (const type of VAULT_PRESENCE_EVENTS) {
      window.addEventListener(type, listener, { capture: true, passive: true });
    }
    return () => {
      for (const type of VAULT_PRESENCE_EVENTS) {
        window.removeEventListener(type, listener, { capture: true });
      }
    };
  }, [enabled, mark]);
}
