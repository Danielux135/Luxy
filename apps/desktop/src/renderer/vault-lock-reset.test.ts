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

  it('el plan de imagen que espera decision tambien, que es texto de escena', () => {
    // el pendiente lleva el prompt ENTERO —apariencia, ropa y lo que ella
    // escribio—, descifrado y colgado de la ventana hasta que alguien pulse.
    // En disco esta cifrado con la subclave de su conversacion; si sobreviviera
    // aqui al candado, seria la unica copia en claro que queda
    expect(DECRYPTED_RENDERER_STATE).toContain('pendingImagePlan');
  });

  it('y el intento que se esta mirando, que es el mismo texto ya mandado', () => {
    // «ver lo que se mando» y el visor de un archivo leen del registro cifrado y
    // dejan el intento colgado de la ventana. Lleva el plan entero: es el mismo
    // material que el pendiente, solo que con la foto ya hecha
    expect(DECRYPTED_RENDERER_STATE).toContain('openImageAttempt');
  });

  it('y la ficha del personaje y lo del enganche (`D-103`)', () => {
    // la ficha es el texto que lee el modelo y faltaba aqui: sobrevivia al
    // candado. El dueño y la vista previa llevan su nombre y lo de su memoria
    expect(DECRYPTED_RENDERER_STATE).toContain('characterDescription');
    expect(DECRYPTED_RENDERER_STATE).toContain('conversationOwner');
    expect(DECRYPTED_RENDERER_STATE).toContain('ownerPreview');
  });

  it('y la galeria de personajes, que lleva la ficha entera de cada uno', () => {
    // se añadio `characterDescription` y se dejo fuera la lista de la que sale
    // ese mismo texto: con la boveda cerrada seguian en memoria el nombre, la
    // ficha y la receta de cada personaje
    expect(DECRYPTED_RENDERER_STATE).toContain('characters');
  });

  it('y los descartes de «¿Es de Lia?», que salen de lo que dicen sus mensajes', () => {
    // son identificadores, pero el aviso solo aparece si el texto descifrado
    // nombra a un personaje: pasaban de una apertura a la siguiente
    expect(DECRYPTED_RENDERER_STATE).toContain('ownerHintDismissed');
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
