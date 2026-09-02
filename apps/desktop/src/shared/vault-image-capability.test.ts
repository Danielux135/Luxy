// pruebas de por que una conversacion privada no puede pedir imagenes.
//
// La regla que fijan aqui es la que arregla la averia del 2026-09-02: un
// identificador de personaje que la boveda no conoce ofrecia imagenes igual, y
// el proveedor solo lo desmentia al final del turno, con la respuesta ya
// escrita y la foto ya prometida.
import { describe, it, expect } from 'vitest';
import { IMAGE_BLOCK_REASONS, imageBlockReason } from './vault-image-capability.js';

const CHARACTER = '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d';

describe('capacidad de generar imagenes en una conversacion privada', () => {
  it('deja generar cuando el personaje esta en la boveda y hay clave', () => {
    expect(
      imageBlockReason({ characterId: CHARACTER, characterInVault: true, hasApiKey: true }),
    ).toBeNull();
  });

  it('sin personaje fijado, no se ofrece', () => {
    for (const characterId of [null, '', '   ']) {
      expect(imageBlockReason({ characterId, characterInVault: false, hasApiKey: true })).toBe(
        'sin-personaje',
      );
    }
  });

  it('un identificador que la boveda no conoce se distingue de no tener ninguno', () => {
    // es el caso real: el campo aceptaba cualquier cadena y nadie la comprobaba
    expect(
      imageBlockReason({ characterId: CHARACTER, characterInVault: false, hasApiKey: true }),
    ).toBe('personaje-desconocido');
  });

  it('el personaje desconocido se dice ANTES que la clave que falta', () => {
    // arreglar la clave no arreglaria nada: el orden es el arreglo
    expect(
      imageBlockReason({ characterId: CHARACTER, characterInVault: false, hasApiKey: false }),
    ).toBe('personaje-desconocido');
  });

  it('con el personaje bien, lo que falta es la clave', () => {
    expect(
      imageBlockReason({ characterId: CHARACTER, characterInVault: true, hasApiKey: false }),
    ).toBe('sin-clave');
  });

  it('todo motivo devuelto pertenece al enum cerrado', () => {
    const reason = imageBlockReason({
      characterId: CHARACTER,
      characterInVault: false,
      hasApiKey: false,
    });
    expect(IMAGE_BLOCK_REASONS).toContain(reason);
  });
});
