// pruebas de lo que Registros llega a enseñar de una linea.
//
// Existe por un fallo que costo una tarde: se añadio al registro cuantas veces
// se habia llamado al modelo en un turno privado —el dato que explicaba una
// llamada cobrada de mas— y el panel seguia pintando solo `msg`. El dato estaba
// escrito en disco y era invisible sin abrir el archivo a mano.
import { describe, it, expect } from 'vitest';
import { extraerCampos } from './System.js';

const linea = (fields: Record<string, unknown>): string =>
  JSON.stringify({ ts: '2026-09-04T08:01:00.554Z', level: 'info', ...fields });

describe('campos de una linea del registro', () => {
  it('enseña los contadores, que es para lo que se escriben', () => {
    const campos = extraerCampos(
      linea({ msg: 'turno privado terminado', modelCalls: 3, model: 'DeepSeek-V4-Pro' }),
    );
    expect(campos).toContain('modelCalls=3');
    expect(campos).toContain('model=DeepSeek-V4-Pro');
  });

  it('no repite lo que ya se pinta aparte', () => {
    const campos = extraerCampos(linea({ msg: 'algo', modelCalls: 1 }));
    expect(campos).not.toContain('msg');
    expect(campos).not.toContain('level');
    expect(campos).not.toContain('2026-09-04');
  });

  it('una linea sin nada mas que el mensaje no añade adorno', () => {
    expect(extraerCampos(linea({ msg: 'Luxy arrancando' }))).toBe('');
  });

  it('un campo vacio no ocupa sitio', () => {
    // `modelCalls` es null con los CLI nativos, que no lo reportan
    expect(extraerCampos(linea({ msg: 'x', modelCalls: null, durationMs: 10 }))).toBe(
      'durationMs=10',
    );
  });

  it('una linea que no sea JSON no rompe el panel', () => {
    // el archivo se lee por el final: la primera puede venir cortada
    expect(extraerCampos('{"ts":"2026-09-0')).toBe('');
    expect(extraerCampos('')).toBe('');
  });
});
