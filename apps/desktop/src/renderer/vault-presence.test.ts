// la puerta de la presencia: cuando un evento de teclado o raton se avisa al
// proceso principal (`D-106`). Sin DOM: el reloj va inyectado.
import { describe, it, expect } from 'vitest';
import {
  VAULT_PRESENCE_EVENTS,
  VAULT_PRESENCE_INTERVAL_MS,
  createPresenceGate,
} from './vault-presence.js';

function puerta(): { gate: (event: { isTrusted: boolean }) => void; sent: number[]; at: { now: number } } {
  const at = { now: 1_000 };
  const sent: number[] = [];
  const gate = createPresenceGate({
    intervalMs: VAULT_PRESENCE_INTERVAL_MS,
    now: () => at.now,
    send: () => sent.push(at.now),
  });
  return { gate, sent, at };
}

describe('la presencia en Privado', () => {
  it('el primer evento del sistema se avisa en el acto', () => {
    const { gate, sent } = puerta();
    gate({ isTrusted: true });
    expect(sent).toEqual([1_000]);
  });

  it('como mucho uno cada 20 s, aunque el raton se mueva sin parar', () => {
    const { gate, sent, at } = puerta();
    gate({ isTrusted: true });
    for (let paso = 1; paso < 20; paso += 1) {
      at.now = 1_000 + paso * 1_000 - 1;
      gate({ isTrusted: true });
    }
    expect(sent).toHaveLength(1);
    at.now = 1_000 + VAULT_PRESENCE_INTERVAL_MS;
    gate({ isTrusted: true });
    expect(sent).toEqual([1_000, 21_000]);
  });

  it('un evento sintetico no cuenta nunca: no lo ha generado nadie', () => {
    const { gate, sent, at } = puerta();
    gate({ isTrusted: false });
    at.now += 60_000;
    gate({ isTrusted: false });
    expect(sent).toEqual([]);
  });

  it('sin la ventana delante no gasta el intervalo: el clic que le da el foco cuenta en el acto', () => {
    const at = { now: 1_000 };
    const delante = { ahora: false };
    const sent: number[] = [];
    const gate = createPresenceGate({
      intervalMs: VAULT_PRESENCE_INTERVAL_MS,
      now: () => at.now,
      send: () => sent.push(at.now),
      inFront: () => delante.ahora,
    });
    // el raton pasa por encima sin el foco
    gate({ isTrusted: true });
    expect(sent).toEqual([]);
    // un segundo despues hace clic y la ventana ya tiene el foco
    at.now += 1_000;
    delante.ahora = true;
    gate({ isTrusted: true });
    expect(sent).toEqual([2_000]);
  });

  it('20 s es como mucho un tercio del ajuste mas bajo, que es 1 minuto', () => {
    expect(VAULT_PRESENCE_INTERVAL_MS).toBe(20_000);
    expect(VAULT_PRESENCE_INTERVAL_MS * 3).toBeLessThanOrEqual(60_000);
  });

  it('escucha teclado, clics, movimiento y rueda', () => {
    expect([...VAULT_PRESENCE_EVENTS]).toEqual(['keydown', 'pointerdown', 'pointermove', 'wheel']);
  });
});
