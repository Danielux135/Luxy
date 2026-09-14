// cuando el panel da otra vuelta al trabajo de fondo.
//
// Es una linea de codigo y estuvo mal durante todo el paso 6: cortaba con
// `reviewed === 0`, y una tanda de tres conversaciones negadas —las tres mas
// antiguas, siempre las mismas— no avanza ningun cursor. El resultado era que
// las otras catorce se quedaban sin leer y el panel decia que no habia nada
// pendiente nuevo. Por eso vive fuera del JSX y tiene pruebas.
import { describe, it, expect } from 'vitest';
import {
  keepSweepingCatalog,
  keepSweepingRecaps,
  keepSweepingRelations,
  type RecapSweepRound,
} from './vault-sweep.js';

describe('otra vuelta a la pasada de pendientes', () => {
  it('sigue mientras queden y algo avance', () => {
    expect(
      keepSweepingRelations({ pending: 14, reviewed: 3, refused: 0, failed: 0 }),
    ).toBe(true);
  });

  it('una tanda entera negada NO la para: la siguiente coge otras tres', () => {
    // con contenido explicito es lo normal. Las negadas quedan marcadas en el
    // almacen y se saltan, asi que la vuelta siguiente mira conversaciones
    // distintas y el CLI puede aceptarlas perfectamente
    expect(
      keepSweepingRelations({ pending: 14, reviewed: 0, refused: 3, failed: 0 }),
    ).toBe(true);
  });

  it('ni una tanda entera fallida', () => {
    expect(
      keepSweepingRelations({ pending: 14, reviewed: 0, refused: 0, failed: 3 }),
    ).toBe(true);
  });

  it('para cuando no queda ninguna por revisar', () => {
    expect(
      keepSweepingRelations({ pending: 0, reviewed: 3, refused: 0, failed: 0 }),
    ).toBe(false);
  });

  it('y para cuando no pasa absolutamente nada, que es el unico bucle infinito posible', () => {
    // ni revisadas, ni negativas, ni fallos: no habia candidatas que tocar y la
    // vuelta siguiente seria identica
    expect(
      keepSweepingRelations({ pending: 5, reviewed: 0, refused: 0, failed: 0 }),
    ).toBe(false);
  });

  it('un error ya enseñado en pantalla no se reintenta', () => {
    expect(keepSweepingRelations(null)).toBe(false);
  });
});

describe('otra vuelta al catalogo', () => {
  it('sigue mientras queden y algo avance', () => {
    expect(keepSweepingCatalog({ pending: 7, cataloged: 3, failed: 0 })).toBe(true);
  });

  it('una tanda entera negada no la para, por el mismo motivo', () => {
    // `catalogFailures` las excluye de la tanda siguiente, igual que alli
    expect(keepSweepingCatalog({ pending: 7, cataloged: 0, failed: 3 })).toBe(true);
  });

  it('pero una tanda que no cataloga ni falla nada si', () => {
    expect(keepSweepingCatalog({ pending: 7, cataloged: 0, failed: 0 })).toBe(false);
  });

  it('y cuando no queda nada sin ordenar', () => {
    expect(keepSweepingCatalog({ pending: 0, cataloged: 3, failed: 0 })).toBe(false);
  });

  it('un error ya enseñado en pantalla no se reintenta', () => {
    expect(keepSweepingCatalog(null)).toBe(false);
  });
});

describe('otra vuelta al relleno de la memoria de lo ya hablado', () => {
  /** una tanda en la que no paso absolutamente nada */
  const quieta: RecapSweepRound = {
    pending: 15,
    reviewed: 0,
    refused: 0,
    vague: 0,
    invalid: 0,
    failed: 0,
    deduced: 0,
    superseded: 0,
  };

  it('sigue mientras queden y alguna ficha se escriba', () => {
    expect(keepSweepingRecaps({ ...quieta, reviewed: 2 })).toBe(true);
  });

  it('una tanda entera negada NO la para: la siguiente coge otras dos', () => {
    // es EL fallo que este repositorio ya ha entregado dos veces. Las dos
    // conversaciones de una tanda son siempre las dos mas antiguas, que son las
    // que llevan mas tiempo sin leerse; si se niegan, `reviewed` vale 0 y cortar
    // ahi deja las quince restantes sin mirar. La negativa queda persistida con
    // su CLI, asi que la vuelta siguiente mira conversaciones distintas
    expect(keepSweepingRecaps({ ...quieta, refused: 2 })).toBe(true);
  });

  it('ni una tanda entera que salio vaga', () => {
    // obedecieron y sanearon: se persiste como negativa con `refusedKind` y esa
    // conversacion se salta hasta que se cambie de CLI
    expect(keepSweepingRecaps({ ...quieta, vague: 2 })).toBe(true);
  });

  it('ni una tanda cuyos bloques no se pudieron leer', () => {
    expect(keepSweepingRecaps({ ...quieta, invalid: 3 })).toBe(true);
  });

  it('ni una tanda entera fallida', () => {
    expect(keepSweepingRecaps({ ...quieta, failed: 2 })).toBe(true);
  });

  it('ni una que solo dejo indices deducidos', () => {
    // no es memoria y no cuenta como cobertura, pero la entrada se escribe con
    // el motivo por el que no hubo ficha y la conversacion deja de ser candidata
    expect(keepSweepingRecaps({ ...quieta, deduced: 2 })).toBe(true);
  });

  it('ni una en la que las dos ya tenian memoria propia', () => {
    // sin esto, dos conversaciones selladas seguidas —que no gastan ni una
    // llamada— pararian la pasada entera antes de tocar las que si hacen falta
    expect(keepSweepingRecaps({ ...quieta, superseded: 2 })).toBe(true);
  });

  it('para cuando no queda ninguna por rellenar', () => {
    expect(keepSweepingRecaps({ ...quieta, pending: 0, reviewed: 2 })).toBe(false);
  });

  it('y para cuando no pasa absolutamente nada, que es el unico bucle infinito posible', () => {
    // ni fichas, ni negativas, ni vagas, ni ilegibles, ni fallos, ni indices, ni
    // selladas: no habia candidatas que tocar y la vuelta siguiente seria igual
    expect(keepSweepingRecaps(quieta)).toBe(false);
  });

  it('un error ya enseñado en pantalla, o una pasada ya en marcha, no se reintenta', () => {
    expect(keepSweepingRecaps(null)).toBe(false);
  });
});
