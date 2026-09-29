// cuando dos raices valen igual para la regla estricta de «ya salio» (`D-104`).
//
// Todo el texto es INVENTADO. Lo que se fija aqui es que las formas del mismo
// verbo casan y que las palabras parecidas que NO son el mismo verbo no.
import { describe, it, expect } from 'vitest';
import { hasSameRoot, regularRoot, sameRoot } from './raise-roots.js';
import { normalizeTerm, stem } from './turn-index.js';

/** la raiz de una palabra, con el recorte de verdad */
const raiz = (palabra: string): string => stem(normalizeTerm(palabra));
const iguales = (a: string, b: string): boolean => sameRoot(raiz(a), raiz(b));

describe('raices equivalentes para la regla estricta', () => {
  it('une las formas de los verbos irregulares de la tabla', () => {
    expect(iguales('traigo', 'traer')).toBe(true);
    expect(iguales('traes', 'traeria')).toBe(true);
    expect(iguales('pongo', 'pondria')).toBe(true);
    expect(iguales('cuento', 'conte')).toBe(true);
    expect(iguales('vengo', 'vendras')).toBe(true);
    expect(iguales('vuelvo', 'volviste')).toBe(true);
    expect(iguales('duermo', 'dormiremos')).toBe(true);
    expect(iguales('doy', 'daras')).toBe(true);
    expect(iguales('ver', 'verlo')).toBe(true);
  });

  it('une los verbos regulares de raiz corta de la tabla', () => {
    // el suelo de cuatro letras de `stem()` los deja enteros: sin la tabla,
    // «beso» y «besarte» eran dos palabras (revision del 28/09)
    expect(iguales('beso', 'besarte')).toBe(true);
    expect(iguales('beso', 'besaria')).toBe(true);
    expect(iguales('ceno', 'cenarias')).toBe(true);
    expect(iguales('juro', 'juraste')).toBe(true);
    expect(iguales('pago', 'pagar')).toBe(true);
    expect(iguales('pago', 'pagas')).toBe(true);
  });

  it('une las terminaciones regulares que el recorte no alcanza', () => {
    // la vocal final de «deber», que ahora da su tabla y no una regla general
    expect(iguales('debo', 'debe')).toBe(true);
    // el preterito y el pronombre pegado
    expect(iguales('prometo', 'prometio')).toBe(true);
    expect(iguales('prometo', 'prometeme')).toBe(true);
    // el infinitivo con pronombre y el condicional
    expect(iguales('llevo', 'llevarla')).toBe(true);
    expect(iguales('llevo', 'llevaria')).toBe(true);
    expect(iguales('cocino', 'cocinarte')).toBe(true);
    expect(regularRoot(raiz('llevarla'))).toBe('llev');
  });

  it('une los pronombres pegados que la tabla no escribe uno a uno', () => {
    // la tabla se consultaba con la raiz tal cual: «traerme» no llegaba a
    // «traer» (cuarta revision del 28/09)
    expect(iguales('traigo', 'traerme')).toBe(true);
    expect(iguales('traigo', 'traernos')).toBe(true);
    expect(iguales('traigo', 'traértelo')).toBe(true);
    expect(iguales('traigo', 'traérnoslo')).toBe(true);
    expect(iguales('pongo', 'ponérmelo')).toBe(true);
    expect(iguales('cuento', 'contármelo')).toBe(true);
    // y los regulares con «nos», detras de -ar o -ir
    expect(iguales('llevo', 'llevarnos')).toBe(true);
    expect(iguales('duermo', 'dormirnos')).toBe(true);
  });

  it('recorta el infinitivo sin pronombre como la palabra suelta', () => {
    // `stem()` deja «preparo» en «prep» y quitar el infinitivo una sola vez
    // dejaba «prepararte» en «prepar»: no se unian (cuarta revision del 28/09)
    expect(iguales('preparo', 'prepararte')).toBe(true);
    expect(iguales('preparo', 'prepararía')).toBe(true);
    expect(iguales('preparo', 'preparármelo')).toBe(true);
    expect(regularRoot(raiz('prepararte'))).toBe(raiz('preparar'));
    expect(regularRoot(raiz('prepararía'))).toBe(raiz('preparo'));
    // lo de antes sigue igual
    expect(regularRoot(raiz('llevarla'))).toBe('llev');
  });

  it('une el gerundio con pronombre', () => {
    expect(iguales('escribo', 'escribiéndote')).toBe(true);
    expect(iguales('llevo', 'llevándote')).toBe(true);
    expect(iguales('cuento', 'contándote')).toBe(true);
    expect(iguales('prometo', 'prometiéndome')).toBe(true);
  });

  it('une los preteritos y subjuntivos irregulares añadidos a la tabla', () => {
    expect(iguales('vengo', 'viniera')).toBe(true);
    expect(iguales('salgo', 'saliera')).toBe(true);
    expect(iguales('duermo', 'durmamos')).toBe(true);
    expect(iguales('veo', 'vernos')).toBe(true);
    expect(iguales('doy', 'darme')).toBe(true);
  });

  it('quitar pronombres no une palabras que no son un verbo con pronombre', () => {
    // la «n» de «nos» detras de -er la dejan tambien estas palabras: no se toca.
    // (Con «interes» o «moderar» las une igual la regla del prefijo, que ya lo
    // hacia antes; lo que se fija aqui es que el pronombre no las recorta mas)
    for (const palabra of ['interno', 'moderno', 'alterno', 'invierno', 'cuaderno']) {
      expect(regularRoot(raiz(palabra)), palabra).toBe(raiz(palabra));
    }
    // un «gerundio» sin raiz detras
    expect(iguales('bandolero', 'banda')).toBe(false);
    // la «tel», «mel» y «sel» de palabras corrientes
    expect(iguales('cartel', 'carta')).toBe(false);
    expect(iguales('caramelo', 'cara')).toBe(false);
    for (const palabra of ['cartel', 'cuartel', 'pastel', 'caramelo', 'carrusel']) {
      expect(regularRoot(raiz(palabra)), palabra).toBe(raiz(palabra));
    }
    // y la ropa sigue fuera: «trajera» cae en la raiz de «traje»
    expect(iguales('traigo', 'trajera')).toBe(false);
  });

  it('no une palabras parecidas que no son el mismo verbo', () => {
    // «traje» es la ropa: fuera de la tabla a proposito
    expect(iguales('traigo', 'traje')).toBe(false);
    // el suelo de cuatro letras: «martes» no es «mar»
    expect(iguales('mar', 'martes')).toBe(false);
    // un prefijo con demasiado de sobra
    expect(iguales('compro', 'compromiso')).toBe(false);
    // raices cortas distintas
    expect(iguales('cama', 'casa')).toBe(false);
    expect(iguales('playa', 'plato')).toBe(false);
    // dos verbos de la tabla no se unen entre si
    expect(iguales('traigo', 'pongo')).toBe(false);
    expect(iguales('vengo', 'vuelvo')).toBe(false);
    // ni un prefijo corto: «tra» no es nada
    expect(iguales('traer', 'trabajo')).toBe(false);
    expect(iguales('traer', 'tranquila')).toBe(false);
  });

  it('no une palabras de cuatro letras que solo cambian en la vocal final', () => {
    // la regla general de la vocal final las unia, y con dos de ellas se fabrico
    // una «ya salio» falsa (revision del 28/09)
    const pares: [string, string][] = [
      ['casa', 'caso'],
      ['peli', 'pelo'],
      ['cara', 'caro'],
      ['mesa', 'meses'],
      ['moda', 'modo'],
      ['rato', 'rata'],
      ['vela', 'velo'],
      ['bola', 'bolo'],
    ];
    for (const [a, b] of pares) expect(iguales(a, b)).toBe(false);
    // ni los verbos de raiz corta que se dejaron fuera a proposito
    expect(iguales('mira', 'mirar')).toBe(false);
    expect(iguales('bebe', 'beber')).toBe(false);
  });

  it('une la primera persona del preterito de los verbos en -car, -gar y -zar', () => {
    // la letra cambia delante de «e» y el recorte las dejaba en «llegu», «busqu»
    // y «empec»: justo como ella diria que lo cumplio (revision del 28/09)
    expect(iguales('llegué', 'llego')).toBe(true);
    expect(iguales('llegué', 'llegar')).toBe(true);
    expect(iguales('busqué', 'busco')).toBe(true);
    expect(iguales('expliqué', 'explicarte')).toBe(true);
    expect(iguales('empecé', 'empezar')).toBe(true);
    expect(iguales('almorcé', 'almorzaremos')).toBe(true);
    // «pagar» va en la tabla de raiz corta: «pague» y «pagué», no «page»
    expect(iguales('pagué', 'pago')).toBe(true);
    expect(iguales('pague', 'pagar')).toBe(true);
    expect(iguales('pagues', 'pagaras')).toBe(true);
  });

  it('el cambio de letra no une palabras cortas ni distintas', () => {
    // el suelo de cuatro letras: «sigue» y «cruz» no se tocan
    expect(regularRoot(raiz('sigue'))).toBe(raiz('sigue'));
    expect(regularRoot(raiz('cruz'))).toBe(raiz('cruz'));
    expect(iguales('llegué', 'lleno')).toBe(false);
    expect(iguales('busqué', 'bus')).toBe(false);
  });

  it('une las formas de «leer»', () => {
    // cuatro letras de raiz y una «y» en medio: sin tabla no se unia ninguna
    expect(iguales('leo', 'leeré')).toBe(true);
    expect(iguales('leo', 'leyéndote')).toBe(true);
    expect(iguales('leí', 'leerte')).toBe(true);
    expect(iguales('leo', 'ley')).toBe(false);
  });

  it('en un verbo de la tabla no vale el prefijo: «te cuento» no es «cuentame»', () => {
    // el prefijo unia «cuent» con «cuentam»: ella pidiendole a el que cuente
    // salia como que ella habia cumplido (revision del 28/09)
    expect(iguales('cuento', 'cuéntame')).toBe(false);
    // la tabla sigue uniendo lo suyo
    expect(iguales('cuento', 'contármelo')).toBe(true);
    // y fuera de la tabla el prefijo sigue igual
    expect(iguales('prometo', 'prométeme')).toBe(true);
  });

  it('es simetrica', () => {
    const pares: [string, string][] = [
      ['traigo', 'traer'],
      ['debo', 'debe'],
      ['prometo', 'prometio'],
      ['llevo', 'llevarla'],
      ['mar', 'martes'],
      ['traigo', 'traje'],
      ['llegué', 'llego'],
      ['empecé', 'empezar'],
      ['cuento', 'cuéntame'],
      ['leo', 'leyéndote'],
    ];
    for (const [a, b] of pares) {
      expect(sameRoot(raiz(a), raiz(b))).toBe(sameRoot(raiz(b), raiz(a)));
    }
  });

  it('busca en todas las raices de la respuesta', () => {
    const respuesta = new Set(['desayun', raiz('traer'), 'cama']);
    expect(hasSameRoot(respuesta, raiz('traigo'))).toBe(true);
    expect(hasSameRoot(respuesta, 'desayun')).toBe(true);
    expect(hasSameRoot(respuesta, raiz('masaje'))).toBe(false);
    expect(hasSameRoot(new Set(), 'desayun')).toBe(false);
  });
});
