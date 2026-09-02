import { describe, it, expect } from 'vitest';
import { parseTraits } from './character-traits.js';

describe('rasgos del personaje', () => {
  it('convierte una linea por rasgo', () => {
    expect(parseTraits('pelo: castaño\nojos: verdes')).toEqual({
      pelo: 'castaño',
      ojos: 'verdes',
    });
  });

  it('ignora lo que no encaja en vez de inventarse una clave', () => {
    // un rasgo mal formado viajaria al proveedor tal cual
    expect(parseTraits('sin dos puntos\n: sin clave\nvacio:\npelo: rubio')).toEqual({
      pelo: 'rubio',
    });
  });

  it('un texto vacio no da rasgos', () => {
    expect(parseTraits('')).toEqual({});
  });

  it('acepta finales de linea de Windows', () => {
    expect(parseTraits('pelo: rubio\r\nedad: adulta')).toEqual({
      pelo: 'rubio',
      edad: 'adulta',
    });
  });

  it('recorta claves y valores largos en vez de rechazarlos', () => {
    const parsed = parseTraits(`${'k'.repeat(100)}: ${'v'.repeat(200)}`);
    const [key] = Object.keys(parsed);
    expect(key).toHaveLength(64);
    expect(parsed[key!]).toHaveLength(120);
  });
});
