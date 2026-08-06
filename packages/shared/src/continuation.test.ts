// pruebas de la union de una respuesta cortada con su continuacion.
//
// POR QUE EXISTE: pegar el segundo fragmento detras del primero produce texto
// duplicado cuando el modelo repite el ultimo parrafo, y una costura invisible
// cuando no lo repite. Las dos cosas rompen una pagina generada. Aqui se fija
// que solo se descarta texto con evidencia, y que sin evidencia se avisa en vez
// de fingir que la union salio bien.
import { describe, it, expect } from 'vitest';
import {
  joinContinuation,
  continuationTail,
  describeContinuationJoin,
  type ContinuationJoinStrategy,
} from './continuation.js';
import { CONTINUATION_MIN_OVERLAP_CHARS, CONTINUATION_TAIL_CHARS } from './constants.js';

const PARCIAL = [
  '<!doctype html>',
  '<html lang="es">',
  '  <body>',
  '    <h1>Catalogo de productos</h1>',
  '    <p>Listado completo con precios actualizados y disponibilidad.</p>',
  '    <ul>',
  '      <li>Primer producto de la lista</li>',
].join('\n');

describe('joinContinuation', () => {
  it('solapamiento exacto: el modelo repite el final antes de seguir', () => {
    const repetido = '      <li>Primer producto de la lista</li>\n';
    const nuevo = '      <li>Segundo producto de la lista</li>\n    </ul>';
    const join = joinContinuation(`${PARCIAL}\n`, repetido + nuevo);

    expect(join.strategy).toBe('overlap');
    expect(join.needsReview).toBe(false);
    expect(join.overlapChars).toBe(repetido.length);
    expect(join.addedChars).toBe(nuevo.length);
    expect(join.text).toBe(`${PARCIAL}\n${nuevo}`);
    // la prueba que importa: el primer producto aparece UNA vez
    expect(join.text.match(/Primer producto/g)).toHaveLength(1);
  });

  it('solapamiento ignorando el espacio del borde entre dos llamadas', () => {
    const join = joinContinuation(
      `${PARCIAL}\n\n`,
      '\n      <li>Primer producto de la lista</li>\n      <li>Segundo</li>',
    );

    expect(join.strategy).toBe('overlap');
    expect(join.text.match(/Primer producto/g)).toHaveLength(1);
    expect(join.text.endsWith('<li>Segundo</li>')).toBe(true);
  });

  it('resincroniza cuando el modelo escribe una entradilla antes de retomar', () => {
    const entradilla = 'Claro, retomo justo donde se corto:\n\n```html\n';
    const join = joinContinuation(
      PARCIAL,
      `${entradilla}      <li>Primer producto de la lista</li>\n      <li>Segundo producto</li>`,
    );

    expect(join.strategy).toBe('resynced');
    // el ancla mas larga que casa incluye el salto de linea anterior, asi que
    // se descarta la entradilla menos ese caracter
    expect(join.discardedChars).toBe(entradilla.length - 1);
    expect(join.text).toContain('<li>Segundo producto</li>');
    expect(join.text).not.toContain('retomo justo donde se corto');
    expect(join.text.match(/Primer producto/g)).toHaveLength(1);
  });

  it('reinicio: la continuacion rehace la respuesta entera', () => {
    const completa = `${PARCIAL}\n      <li>Segundo</li>\n    </ul>\n  </body>\n</html>`;
    const join = joinContinuation(PARCIAL, completa);

    expect(join.strategy).toBe('restart');
    expect(join.text).toBe(completa);
    expect(join.needsReview).toBe(false);
    expect(join.text.match(/doctype/g)).toHaveLength(1);
  });

  it('duplicado: la continuacion no aporta nada nuevo', () => {
    const join = joinContinuation(PARCIAL, '      <li>Primer producto de la lista</li>');

    expect(join.strategy).toBe('duplicate');
    expect(join.text).toBe(PARCIAL);
    expect(join.addedChars).toBe(0);
  });

  it('sin evidencia de continuidad: pega y marca la costura para revisar', () => {
    const join = joinContinuation('<div class=', '"tarjeta">contenido</div>');

    expect(join.strategy).toBe('appended');
    expect(join.needsReview).toBe(true);
    // no se descarta nada: el corte a mitad de atributo es continuo de verdad
    expect(join.text).toBe('<div class="tarjeta">contenido</div>');
    expect(join.overlapChars).toBe(0);
  });

  it('una coincidencia trivial no cuenta como solapamiento', () => {
    const corto = '>'.padStart(CONTINUATION_MIN_OVERLAP_CHARS - 1, 'x');
    const join = joinContinuation(`inicio ${corto}`, `${corto} final`);

    expect(join.strategy).toBe('appended');
    expect(join.needsReview).toBe(true);
    // se conserva TODO: descartar por una coincidencia trivial perderia texto
    expect(join.text).toBe(`inicio ${corto}${corto} final`);
  });

  it('un bloque repetido mas abajo no se confunde con el punto de corte', () => {
    const previo = 'A'.repeat(200);
    // el ancla aparece, pero fuera de la ventana de resincronizacion
    const lejos = `${'B'.repeat(4000)}${previo.slice(-120)}resto`;
    const join = joinContinuation(previo, lejos);

    expect(join.strategy).toBe('appended');
    expect(join.text).toBe(previo + lejos);
  });

  it('continuacion vacia: se conserva el parcial', () => {
    const join = joinContinuation(PARCIAL, '   \n  ');

    expect(join.strategy).toBe('duplicate');
    expect(join.text).toBe(PARCIAL);
    expect(join.needsReview).toBe(false);
  });

  it('parcial vacio: la continuacion es la respuesta', () => {
    const join = joinContinuation('', 'respuesta entera');

    expect(join.strategy).toBe('restart');
    expect(join.text).toBe('respuesta entera');
    expect(join.addedChars).toBe('respuesta entera'.length);
  });

  it('nunca pierde contenido nuevo, sea cual sea la estrategia', () => {
    const casos: Array<[string, string]> = [
      [PARCIAL, '      <li>Primer producto de la lista</li>\n      <li>Tercero</li>'],
      [PARCIAL, 'Sigo:\n      <li>Primer producto de la lista</li>\n      <li>Tercero</li>'],
      [PARCIAL, '      <li>Tercero</li>'],
      ['', '      <li>Tercero</li>'],
    ];
    for (const [previo, siguiente] of casos) {
      expect(joinContinuation(previo, siguiente).text).toContain('<li>Tercero</li>');
    }
  });

  it('unir tres fragmentos seguidos sigue dando un documento sin repeticiones', () => {
    const primero = joinContinuation(
      PARCIAL,
      '      <li>Primer producto de la lista</li>\n      <li>Segundo</li>',
    );
    const segundo = joinContinuation(primero.text, '      <li>Segundo</li>\n    </ul>');

    expect(segundo.strategy).toBe('overlap');
    expect(segundo.text.match(/<li>Segundo<\/li>/g)).toHaveLength(1);
    expect(segundo.text.endsWith('</ul>')).toBe(true);
  });
});

describe('continuationTail', () => {
  it('devuelve el texto entero cuando ya cabe', () => {
    expect(continuationTail('corto')).toBe('corto');
  });

  it('acota el final y nunca supera el tope', () => {
    const largo = 'x'.repeat(CONTINUATION_TAIL_CHARS * 3);
    expect(continuationTail(largo).length).toBe(CONTINUATION_TAIL_CHARS);
  });

  it('corta por un salto de linea cercano para no partir una palabra', () => {
    const tail = continuationTail(`${'a'.repeat(100)}\nlinea entera`, 20);
    expect(tail).toBe('linea entera');
  });

  it('un salto lejano no manda: perderia el contexto que hace falta', () => {
    // el salto cae en la segunda mitad del trozo devuelto
    const tail = continuationTail(`${'x'.repeat(50)}\n${'y'.repeat(9)}`, 30);
    expect(tail.length).toBe(30);
    expect(tail).toContain('\n');
  });
});

describe('describeContinuationJoin', () => {
  it('tiene frase para las cinco estrategias', () => {
    const estrategias: ContinuationJoinStrategy[] = [
      'overlap',
      'resynced',
      'restart',
      'duplicate',
      'appended',
    ];
    for (const strategy of estrategias) {
      const frase = describeContinuationJoin({
        text: '',
        strategy,
        overlapChars: 10,
        discardedChars: 5,
        addedChars: 20,
        needsReview: strategy === 'appended',
      });
      expect(frase.length).toBeGreaterThan(0);
    }
  });

  it('avisa explicitamente cuando la costura hay que revisarla', () => {
    const join = joinContinuation('<div class=', '"tarjeta">contenido</div>');
    expect(describeContinuationJoin(join)).toContain('revisar');
  });
});
