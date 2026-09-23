// pruebas de a que recuadro va cada aviso de la boveda.
//
// Lo que se fija aqui es lo que se rompio dos veces seguidas: que un fallo no se
// repita en cinco paneles, y —lo nuevo— que la PISTA no se quede sola en un
// recuadro distinto del de su error. La pista es la unica frase que dice como
// salir del fallo, y estaba saliendo varios paneles mas abajo y en verde.
import { describe, it, expect } from 'vitest';
import { vaultNoticeFor, type VaultNoticeState } from './vault-notice.js';

const NADA: VaultNoticeState = { error: null, errorArea: null, hint: null };

describe('el aviso de una seccion', () => {
  const memoria: VaultNoticeState = {
    error: 'esa conversacion esta contestando ahora mismo',
    errorArea: 'memoria',
    hint: 'espera a que llegue la respuesta y vuelve a borrar',
  };

  it('LA PISTA VA CON SU ERROR, no en otro panel', () => {
    const aviso = vaultNoticeFor(memoria, ['memoria']);
    expect(aviso).toEqual({
      tone: 'fault',
      error: 'esa conversacion esta contestando ahora mismo',
      hint: 'espera a que llegue la respuesta y vuelve a borrar',
    });
  });

  it('y por tanto el aviso general NO se queda con la pista suelta', () => {
    // es el fallo literal: el motivo se pintaba en «Memoria de lo ya hablado» y
    // la salida en «Boveda abierta», con el tono de «Clave guardada»
    expect(vaultNoticeFor(memoria, null)).toBeNull();
  });

  it('una seccion no pinta el fallo de otra', () => {
    expect(vaultNoticeFor(memoria, ['personajes'])).toBeNull();
    expect(vaultNoticeFor(memoria, ['trabajo-de-fondo'])).toBeNull();
  });

  it('un recuadro puede hacerse cargo de dos areas', () => {
    // el de personajes recoge ademas «Ver disponibilidad» cuando su formulario
    // esta plegado: si no, el motivo se quedaria dentro de un panel cerrado
    const disponibilidad: VaultNoticeState = {
      error: 'AI Horde no contesta',
      errorArea: 'disponibilidad',
      hint: null,
    };
    expect(vaultNoticeFor(disponibilidad, ['personajes'])).toBeNull();
    expect(vaultNoticeFor(disponibilidad, ['personajes', 'disponibilidad'])?.error).toBe(
      'AI Horde no contesta',
    );
  });

  it('un fallo sin dueño es del aviso general y de nadie mas', () => {
    const suelto: VaultNoticeState = {
      error: 'no se pudo sincronizar',
      errorArea: null,
      hint: 'vuelve a intentarlo cuando haya red',
    };
    expect(vaultNoticeFor(suelto, null)).toEqual({
      tone: 'fault',
      error: 'no se pudo sincronizar',
      hint: 'vuelve a intentarlo cuando haya red',
    });
    expect(vaultNoticeFor(suelto, ['memoria'])).toBeNull();
  });
});

describe('un acuse de algo que salio bien', () => {
  const guardada: VaultNoticeState = {
    error: null,
    errorArea: null,
    hint: 'Clave guardada. Ya puedes pedir imagenes dentro de una conversacion.',
  };

  it('se queda en el aviso general, en verde y sin motivo', () => {
    expect(vaultNoticeFor(guardada, null)).toEqual({
      tone: 'ok',
      error: null,
      hint: guardada.hint,
    });
  });

  it('y NO se cuela en ninguna seccion: un acuse no es de nadie', () => {
    expect(vaultNoticeFor(guardada, ['memoria'])).toBeNull();
  });

  it('sin nada que decir no se pinta ningun recuadro', () => {
    expect(vaultNoticeFor(NADA, null)).toBeNull();
    expect(vaultNoticeFor(NADA, ['memoria'])).toBeNull();
  });
});
