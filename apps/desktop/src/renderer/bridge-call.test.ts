import { describe, it, expect } from 'vitest';
import { BRIDGE_FAILURE_HINT, BRIDGE_FAILURE_MESSAGE, callBridge } from './bridge-call.js';

describe('llamada al puente', () => {
  it('devuelve tal cual lo que contesta el proceso principal', async () => {
    const bien = await callBridge(async () => ({ ok: true as const, value: { rows: 3 } }));
    expect(bien).toEqual({ ok: true, value: { rows: 3 } });

    const mal = await callBridge(async () => ({
      ok: false as const,
      error: 'la boveda esta cerrada',
      hint: 'abrela con tu contraseña',
    }));
    expect(mal).toEqual({
      ok: false,
      error: 'la boveda esta cerrada',
      hint: 'abrela con tu contraseña',
    });
  });

  it('una promesa rechazada se convierte en un fallo que se puede pintar', async () => {
    const result = await callBridge(() => Promise.reject(new Error('no handler for channel')));
    expect(result).toEqual({
      ok: false,
      error: BRIDGE_FAILURE_MESSAGE,
      hint: BRIDGE_FAILURE_HINT,
    });
  });

  // el puente puede romperse ANTES de devolver la promesa: `window.luxy` sin
  // ese metodo revienta al invocarlo, no al esperarlo
  it('tambien si revienta antes de devolver la promesa', async () => {
    const result = await callBridge(() => {
      throw new Error('luxy.listVaultRecaps is not a function');
    });
    expect(result.ok).toBe(false);
  });

  // no se afirma lo que el codigo no puede garantizar: `invoke` rechaza igual
  // cuando la llamada no llego a entrar que cuando entro, corrio y se rompio al
  // volver. Con un borrado delante, «la operacion no se ha hecho» le decia a
  // Daniel que no se habia borrado nada con el archivo ya reescrito
  it('no afirma que la operacion no se hizo, porque no se sabe', async () => {
    const result = await callBridge(() => Promise.reject(new Error('cualquier cosa')));
    if (result.ok) throw new Error('tenia que haber fallado');
    expect(result.error).not.toContain('no se ha hecho');
    expect(result.error).toContain('no se sabe');
  });

  // privacidad: el motivo NO viaja al mensaje. Un error que viene de fuera puede
  // traer dentro cualquier cosa, y en esta pantalla «cualquier cosa» incluye
  // texto descifrado de la boveda
  it('el motivo no acaba en lo que se enseña', async () => {
    const result = await callBridge(() =>
      Promise.reject(new Error('fallo al validar: <<texto de la boveda>>')),
    );
    if (result.ok) throw new Error('tenia que haber fallado');
    expect(result.error).not.toContain('boveda');
    expect(result.hint).not.toContain('boveda');
  });
});
