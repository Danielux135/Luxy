// lo que tiene que dejar de existir cuando la boveda se cierra.
//
// Esta prueba existe por una omision concreta: la sonda de compatibilidad
// empezo a devolver lo que escribio cada modelo —contenido descifrado— y nadie
// lo añadio a la purga del bloqueo, asi que ese texto sobrevivia en memoria de
// la ventana mientras la pantalla prometia que desaparecia. No habia ninguna
// prueba que mirase esa lista, asi que la siguiente omision tampoco habria
// saltado.
import { describe, it, expect } from 'vitest';
import {
  DECRYPTED_RENDERER_STATE,
  discardDecrypted,
  type DecryptedRendererState,
  type DecryptedStateResetters,
} from './vault-lock-reset.js';

/** un objeto con todas las claves declaradas, cada una apuntando lo que se llamo */
function espias(): { reset: DecryptedStateResetters; llamadas: DecryptedRendererState[] } {
  const llamadas: DecryptedRendererState[] = [];
  const reset = {} as DecryptedStateResetters;
  for (const key of DECRYPTED_RENDERER_STATE) {
    reset[key] = (): void => {
      llamadas.push(key);
    };
  }
  return { reset, llamadas };
}

describe('la purga del cierre de la boveda', () => {
  it('vacia TODO lo declarado, sin saltarse nada', () => {
    // «se descarta TODO lo descifrado que hubiera en memoria del renderer. No se
    // oculta: deja de existir aqui» — lo dice el propio hook, y esto lo fija
    const { reset, llamadas } = espias();
    discardDecrypted(reset);
    expect(llamadas).toEqual([...DECRYPTED_RENDERER_STATE]);
  });

  it('recorre la lista declarada y no las claves que le pasen', () => {
    // asi lo que manda es la lista: un objeto con una clave de mas no añade una
    // llamada, y uno al que le falte una no compila
    const { reset, llamadas } = espias();
    const conUnaDeMas = {
      ...reset,
      deMas: (): void => {
        llamadas.push('turns');
      },
    };
    discardDecrypted(conUnaDeMas);
    expect(llamadas).toHaveLength(DECRYPTED_RENDERER_STATE.length);
  });

  it('el texto de la sonda esta en la lista, que es por lo que existe', () => {
    // hasta que la sonda devolvio texto solo llevaba enteros; desde entonces son
    // hasta 120.000 caracteres de roleplay descifrado colgados de la ventana
    expect(DECRYPTED_RENDERER_STATE).toContain('compatibility');
  });

  it('y lo demas que ya llevaba contenido descifrado sigue estando', () => {
    // la lista se junto de dos copias escritas a mano que habian divergido: el
    // cierre de sesion vaciaba seis cosas y el bloqueo diez
    for (const estado of [
      'conversations',
      'turns',
      'media',
      'probes',
      'instructions',
      'pendingAffairs',
      'recaps',
      'recapCoverage',
      'recapPreview',
    ]) {
      expect(DECRYPTED_RENDERER_STATE).toContain(estado);
    }
  });

  it('ninguna clave repetida: una purga que se llama dos veces tapa un olvido', () => {
    expect(new Set(DECRYPTED_RENDERER_STATE).size).toBe(DECRYPTED_RENDERER_STATE.length);
  });
});
