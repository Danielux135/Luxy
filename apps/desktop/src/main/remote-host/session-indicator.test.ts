// pruebas del texto del indicador.
//
// La ventana no se puede probar sin Electron, pero lo que DICE si, y es lo que
// decide si el usuario entiende que le estan viendo la pantalla.
import { describe, it, expect } from 'vitest';
import { indicatorLabel } from './session-indicator.js';

const AHORA = 1_700_000_000_000;

describe('texto del indicador', () => {
  it('distingue MIRAR de CONTROLAR', () => {
    // son cosas muy distintas para quien esta delante del ordenador, y una
    // sesion de solo visualizacion es lo normal al conectar: si las dos dijeran
    // lo mismo, el usuario dejaria de leer el aviso
    const viendo = indicatorLabel(
      { controlling: false, deviceName: 'Pixel de Daniel', since: AHORA },
      AHORA,
    );
    const controlando = indicatorLabel(
      { controlling: true, deviceName: 'Pixel de Daniel', since: AHORA },
      AHORA,
    );

    expect(viendo).not.toBe(controlando);
    expect(viendo).toContain('viendo');
    expect(controlando).toContain('controla');
  });

  it('siempre dice QUE dispositivo es', () => {
    const texto = indicatorLabel(
      { controlling: true, deviceName: 'Pixel de Daniel', since: AHORA },
      AHORA,
    );
    expect(texto).toContain('Pixel de Daniel');
  });

  it('sin nombre no se queda en blanco', () => {
    // un aviso vacio es peor que no tenerlo: parece un fallo de la interfaz y se
    // ignora
    const texto = indicatorLabel({ controlling: true, deviceName: '   ', since: AHORA }, AHORA);
    expect(texto).toContain('dispositivo emparejado');
    expect(texto.trim().length).toBeGreaterThan(10);
  });

  it('un nombre larguisimo se acota', () => {
    // si no, desbordaria el indicador y taparia el boton de cortar, que es lo
    // unico que no puede dejar de verse
    const texto = indicatorLabel(
      { controlling: true, deviceName: 'A'.repeat(500), since: AHORA },
      AHORA,
    );
    expect(texto.length).toBeLessThan(120);
  });

  it('dice cuanto lleva la sesion abierta', () => {
    const recien = indicatorLabel({ controlling: true, deviceName: 'Movil', since: AHORA }, AHORA);
    const rato = indicatorLabel(
      { controlling: true, deviceName: 'Movil', since: AHORA - 25 * 60_000 },
      AHORA,
    );

    expect(recien).toContain('menos de un minuto');
    expect(rato).toContain('25 min');
  });

  it('un reloj que va hacia atras no produce tiempos negativos', () => {
    const texto = indicatorLabel(
      { controlling: true, deviceName: 'Movil', since: AHORA + 60_000 },
      AHORA,
    );
    expect(texto).not.toContain('-');
    expect(texto).toContain('menos de un minuto');
  });
});
