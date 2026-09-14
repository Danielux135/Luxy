// cuando el panel da otra vuelta al trabajo de fondo.
//
// Es una linea de codigo y estuvo mal durante todo el paso 6: cortaba con
// `reviewed === 0`, y una tanda de tres conversaciones negadas —las tres mas
// antiguas, siempre las mismas— no avanza ningun cursor. El resultado era que
// las otras catorce se quedaban sin leer y el panel decia que no habia nada
// pendiente nuevo. Por eso vive fuera del JSX y tiene pruebas.
import { describe, it, expect } from 'vitest';
import { keepSweepingCatalog, keepSweepingRelations } from './vault-sweep.js';

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
