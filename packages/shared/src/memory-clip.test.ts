// el corte en palabra de la memoria y de las fichas, y el arreglo al presentar lo
// que se guardo con el `slice` de antes (`D-105`, quinta ronda). Todo inventado.
import { describe, expect, it } from 'vitest';
import {
  RECAP_MEMORY_CAPS,
  SEALED_MEMORY_CAPS,
  clipAtWord,
  memoryCapsFor,
  repairSlicedMemory,
  repairSlicedText,
  type ConversationMemory,
} from './schemas.js';

const PALABRAS = new Set(['la', 'llevo', 'a', 'playa', 'inventada', 'de', 'noche']);

describe('clipAtWord', () => {
  it('lo que cabe sale igual, byte a byte', () => {
    expect(clipAtWord('La llevo a la playa.', 20)).toBe('La llevo a la playa.');
    expect(clipAtWord('corto', 400)).toBe('corto');
  });

  it('nunca pasa del tope ni parte una palabra', () => {
    const texto = 'la llevo a la playa inventada de noche '.repeat(20).trim();
    for (let max = 5; max < 120; max += 1) {
      const cortado = clipAtWord(texto, max);
      expect(cortado.length).toBeLessThanOrEqual(max);
      expect(cortado.endsWith('…')).toBe(true);
      const palabras = cortado.slice(0, -1).trim().split(/\s+/u);
      for (const palabra of palabras) expect(PALABRAS.has(palabra)).toBe(true);
    }
  });

  it('si lo primero que se cae es un espacio, la ultima palabra se queda', () => {
    // «la llevo» son 8 y el noveno es el espacio
    expect(clipAtWord('la llevo a la playa', 9)).toBe('la llevo…');
  });

  it('no deja una coma colgando delante de la marca', () => {
    expect(clipAtWord('fue a la playa, y luego al faro', 17)).toBe('fue a la playa…');
  });

  it('detras de una frase entera la marca va separada', () => {
    expect(clipAtWord('Fue a la playa. Luego al faro inventado', 20)).toBe('Fue a la playa. …');
  });

  it('un texto sin espacios se corta donde toca y se marca', () => {
    expect(clipAtWord('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('no parte un emoji por la mitad', () => {
    const cortado = clipAtWord(`${'a'.repeat(8)}😀bbbb`, 10);
    expect(cortado).toBe(`${'a'.repeat(8)}…`);
  });

  it('su resultado nunca tiene la huella del `slice`, asi que no se vuelve a tocar', () => {
    const texto = 'la llevo a la playa inventada de noche '.repeat(40);
    for (const max of [160, 240, 400, 1200]) {
      const cortado = clipAtWord(texto.trim(), max);
      expect(repairSlicedText(cortado, max)).toEqual({ text: cortado, repaired: false });
    }
  });
});

describe('repairSlicedText', () => {
  it('con la huella —el tope justo y acaba en letra— quita la ultima palabra y lo marca', () => {
    const cortado = 'la llevo a la playa inventada de noche '.repeat(10).slice(0, 100);
    expect(cortado.length).toBe(100);
    const arreglado = repairSlicedText(cortado, 100);
    expect(arreglado.repaired).toBe(true);
    expect(arreglado.text.length).toBeLessThan(100);
    expect(arreglado.text.endsWith('…')).toBe(true);
    expect(cortado.startsWith(arreglado.text.slice(0, -1).trim())).toBe(true);
  });

  it('sin la huella no toca nada', () => {
    expect(repairSlicedText('Acaba en punto.', 15).repaired).toBe(false);
    expect(repairSlicedText('mas corto que el tope', 240).repaired).toBe(false);
    expect(repairSlicedText(`${'a'.repeat(98)} …`, 100).repaired).toBe(false);
  });
});

describe('repairSlicedMemory', () => {
  const base: ConversationMemory = {
    version: 1,
    summary: 'Resumen inventado.',
    facts: ['Hecho.'],
    decisions: [],
    plan: [],
    openQuestions: [],
    lessons: [],
  };

  it('sin nada que arreglar devuelve el MISMO objeto', () => {
    const resultado = repairSlicedMemory(base, SEALED_MEMORY_CAPS);
    expect(resultado.repaired).toBe(0);
    expect(resultado.memory).toBe(base);
  });

  it('arregla todas las listas, tambien las que no viajan a otras conversaciones', () => {
    const cortada = 'la llevo a la playa inventada de noche '.repeat(10).slice(0, 160);
    const resultado = repairSlicedMemory(
      { ...base, plan: [cortada], lessons: [cortada] },
      RECAP_MEMORY_CAPS,
    );
    expect(resultado.repaired).toBe(2);
    expect(resultado.memory.plan[0]!.endsWith('…')).toBe(true);
  });

  it('los topes dependen de donde sale la memoria', () => {
    expect(memoryCapsFor('turn')).toEqual({ summary: 1200, entry: 240 });
    expect(memoryCapsFor('recap')).toEqual({ summary: 400, entry: 160 });
    expect(memoryCapsFor('index')).toEqual({ summary: 400, entry: 160 });
  });
});
