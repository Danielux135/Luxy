// cuando el panel da otra vuelta al trabajo de fondo.
//
// Es una linea de codigo y estuvo mal durante todo el paso 6: cortaba con
// `reviewed === 0`, y una tanda de tres conversaciones negadas —las tres mas
// antiguas, siempre las mismas— no avanza ningun cursor. El resultado era que
// las otras catorce se quedaban sin leer y el panel decia que no habia nada
// pendiente nuevo. Por eso vive fuera del JSX y tiene pruebas.
import { describe, it, expect } from 'vitest';
import {
  CATALOG_RESUME_GAP_MS,
  catalogInterrupted,
  catalogResumeDue,
  catalogRetryNote,
  keepSweepingCatalog,
  keepSweepingRecaps,
  keepSweepingRelations,
  mergeCatalogRound,
  type CatalogRoundResult,
  type CatalogSummary,
  type RecapSweepRound,
} from './vault-sweep.js';

/** una tanda de la pasada general: la que barre la cola, sin conversacion */
const pasadaGeneral = (previous: CatalogSummary | null, round: CatalogRoundResult) =>
  mergeCatalogRound(previous, round, {});

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

// undecima ronda: cada tanda machacaba a la anterior. Con el CLI roto, la vuelta
// 0 fallaba en una y armaba la espera, la vuelta 1 lo encontraba todo esperando
// y volvia con `failed: []`, y el aviso con su boton desaparecia
describe('las tandas del catalogo, juntas', () => {
  const A = 'aaaaaaaa-1111-4111-8111-111111111111';
  const B = 'bbbbbbbb-2222-4222-8222-222222222222';
  const C = 'cccccccc-3333-4333-8333-333333333333';
  const sinSesion = {
    conversationId: A,
    reason: 'Claude Code no tiene la sesion iniciada',
    process: true,
  };
  const vacia = { cataloged: 0, scenes: 0, failed: [], uneven: [] };

  it('una tanda que solo espero no borra el fallo de la anterior, y guarda la espera', () => {
    const vuelta0 = pasadaGeneral(null, {
      ...vacia,
      pending: 3,
      failed: [sinSesion],
      waiting: 2,
      catalogedIds: [],
      provider: 'claude',
    });
    const vuelta1 = pasadaGeneral(vuelta0, { ...vacia, pending: 3, waiting: 3 });
    expect(vuelta1.failed).toEqual([sinSesion]);
    expect(vuelta1).toMatchObject({ pending: 3, waiting: 3, provider: 'claude' });
    expect(catalogInterrupted(vuelta1)).toBe(true);
  });

  it('lo que se ordena sale del aviso; lo que vuelve a fallar, con su motivo nuevo', () => {
    const antes = pasadaGeneral(null, {
      ...vacia,
      pending: 3,
      failed: [sinSesion, { conversationId: B, reason: 'no supo', process: false }],
      uneven: [{ conversationId: C, scenes: 4 }],
      provider: 'claude',
    });
    const despues = pasadaGeneral(antes, {
      cataloged: 2,
      scenes: 9,
      pending: 0,
      failed: [{ conversationId: B, reason: 'otra vez no supo' }],
      uneven: [],
      catalogedIds: [A, C],
      waiting: 0,
    });
    expect(despues.failed).toEqual([{ conversationId: B, reason: 'otra vez no supo' }]);
    expect(despues.uneven).toEqual([]);
    // lo ordenado se suma: «Se han ordenado» no puede decir 0 tras tres tandas
    expect(despues).toMatchObject({ cataloged: 2, scenes: 9, pending: 0, waiting: 0 });
    expect(catalogInterrupted(despues)).toBe(false);
  });

  it('una que se queda fuera por la respuesta no deja la pasada a medias', () => {
    const fuera = pasadaGeneral(null, {
      ...vacia,
      pending: 0,
      failed: [{ conversationId: A, reason: 'no supo' }],
    });
    expect(catalogInterrupted(fuera)).toBe(false);
  });

  it('a medias lo decide la ULTIMA vuelta: un fallo viejo en el aviso no la deja asi para siempre', () => {
    // A fallo por el proceso y despues se excluyo: la pasada ya no la toca, y
    // si su fallo bastara, la pantalla la retomaria cada minuto para nada
    const antes = pasadaGeneral(null, {
      ...vacia,
      pending: 2,
      failed: [sinSesion],
      provider: 'claude',
    });
    expect(catalogInterrupted(antes)).toBe(true);
    const limpia = pasadaGeneral(antes, {
      ...vacia,
      cataloged: 1,
      scenes: 3,
      pending: 0,
      catalogedIds: [B],
      waiting: 0,
    });
    expect(limpia.failed).toEqual([sinSesion]);
    expect(catalogInterrupted(limpia)).toBe(false);
  });
});

describe('retomar sola la pasada del catalogo', () => {
  const ahora = Date.parse('2026-10-06T10:00:00.000Z');
  const aMedias = pasadaGeneral(null, {
    cataloged: 0,
    scenes: 0,
    pending: 3,
    failed: [],
    uneven: [],
    waiting: 3,
    provider: 'claude',
  });
  const fallo = (retryAt: number) => ({
    provider: 'claude',
    model: null,
    effort: null,
    wholeProvider: false,
    retryAt: new Date(retryAt).toISOString(),
  });

  it('mientras su CLI espera, no', () => {
    expect(
      catalogResumeDue({
        summary: aMedias,
        failures: [fallo(ahora + 60_000)],
        now: ahora,
        lastResumeAt: null,
      }),
    ).toBe(false);
  });

  it('cuando otro trabajo lo ve contestar, si: ya no tiene fallo', () => {
    expect(
      catalogResumeDue({ summary: aMedias, failures: [], now: ahora, lastResumeAt: null }),
    ).toBe(true);
  });

  it('cuando pasa su espera, tambien: para probarlo una vez', () => {
    expect(
      catalogResumeDue({
        summary: aMedias,
        failures: [fallo(ahora)],
        now: ahora,
        lastResumeAt: null,
      }),
    ).toBe(true);
  });

  it('la espera de OTRO CLI no la frena', () => {
    expect(
      catalogResumeDue({
        summary: aMedias,
        failures: [{ ...fallo(ahora + 60_000), provider: 'codex' }],
        now: ahora,
        lastResumeAt: null,
      }),
    ).toBe(true);
  });

  // duodecima ronda: la espera es de lo que se lanza, con su modelo y su esfuerzo
  describe('con el modelo de la ventana', () => {
    const conModelo = pasadaGeneral(null, {
      cataloged: 0,
      scenes: 0,
      pending: 3,
      failed: [],
      uneven: [],
      waiting: 3,
      provider: 'codex',
      model: 'modelo-inventado-a',
      effort: 'high',
    });
    const espera = (cambios: object) => ({
      ...fallo(ahora + 60_000),
      provider: 'codex',
      ...cambios,
    });
    const vaciaTanda = { cataloged: 0, scenes: 0, failed: [], uneven: [] };

    it('la tanda guarda con que modelo y esfuerzo se hizo, aunque la siguiente no lo diga', () => {
      expect(conModelo).toMatchObject({ model: 'modelo-inventado-a', effort: 'high' });
      const siguiente = pasadaGeneral(conModelo, { ...vaciaTanda, pending: 3, waiting: 3 });
      expect(siguiente).toMatchObject({
        provider: 'codex',
        model: 'modelo-inventado-a',
        effort: 'high',
      });
    });

    it('su propia espera la frena', () => {
      expect(
        catalogResumeDue({
          summary: conModelo,
          failures: [espera({ model: 'modelo-inventado-a', effort: 'high' })],
          now: ahora,
          lastResumeAt: null,
        }),
      ).toBe(false);
    });

    it('la de otro modelo o la de otro esfuerzo del mismo CLI, no', () => {
      expect(
        catalogResumeDue({
          summary: conModelo,
          failures: [
            espera({ model: null, effort: null }),
            espera({ model: 'modelo-inventado-a', effort: 'low' }),
          ],
          now: ahora,
          lastResumeAt: null,
        }),
      ).toBe(true);
    });

    it('la del CLI entero —una cuenta sin sesion— si', () => {
      expect(
        catalogResumeDue({
          summary: conModelo,
          failures: [espera({ wholeProvider: true })],
          now: ahora,
          lastResumeAt: null,
        }),
      ).toBe(false);
    });
  });

  it('ni lo terminado, ni lo que no se sabe con que CLI se hizo, ni dos seguidas', () => {
    const terminada = pasadaGeneral(null, {
      cataloged: 3,
      scenes: 9,
      pending: 0,
      failed: [],
      uneven: [],
      provider: 'claude',
    });
    expect(
      catalogResumeDue({ summary: terminada, failures: [], now: ahora, lastResumeAt: null }),
    ).toBe(false);
    expect(
      catalogResumeDue({
        summary: { ...aMedias, provider: null },
        failures: [],
        now: ahora,
        lastResumeAt: null,
      }),
    ).toBe(false);
    expect(
      catalogResumeDue({
        summary: aMedias,
        failures: [],
        now: ahora,
        lastResumeAt: ahora - CATALOG_RESUME_GAP_MS + 1,
      }),
    ).toBe(false);
    expect(catalogResumeDue({ summary: null, failures: [], now: ahora, lastResumeAt: null })).toBe(
      false,
    );
  });
});

// un boton de una conversacion —«Repasar sus momentos», «Reintentar»,
// «Repetir»— que salia bien ponia `interrupted` a false: la pasada general que
// esperaba al CLI no se retomaba nunca, «Probar ahora» se iba y la nota seguia
// diciendo que las que fallaron se reintentaban solas
describe('un boton de una conversacion no acaba la pasada general', () => {
  const ahora = Date.parse('2026-10-06T10:00:00.000Z');
  const A = 'aaaaaaaa-1111-4111-8111-111111111111';
  const X = 'dddddddd-4444-4444-8444-444444444444';
  const sinSesion = {
    conversationId: A,
    reason: 'Claude Code no tiene la sesion iniciada',
    process: true,
  };
  const vacia = { cataloged: 0, scenes: 0, failed: [], uneven: [] };
  // la pasada general: A falla por el proceso, las otras dos se quedan
  // esperando, y la vuelta siguiente lo encuentra todo esperando
  const general = pasadaGeneral(
    pasadaGeneral(null, {
      ...vacia,
      pending: 3,
      failed: [sinSesion],
      waiting: 2,
      provider: 'claude',
    }),
    { ...vacia, pending: 3, waiting: 3, provider: 'claude' },
  );
  /** «Repasar sus momentos» en X, ya catalogada: el CLI contesta */
  const repasoBien = {
    ...vacia,
    cataloged: 1,
    scenes: 4,
    pending: 3,
    waiting: 0,
    catalogedIds: [X],
    provider: 'claude' as const,
  };

  it('uno que sale bien no la da por acabada: la retoma sigue en pie', () => {
    expect(catalogInterrupted(general)).toBe(true);
    const boton = mergeCatalogRound(general, repasoBien, { conversationId: X });
    expect(boton.failed).toEqual([sinSesion]);
    expect(catalogInterrupted(boton)).toBe(true);
    // contestar acabo con la espera: ya no hay ninguna que mirar
    expect(
      catalogResumeDue({ summary: boton, failures: [], now: ahora, lastResumeAt: null }),
    ).toBe(true);
  });

  it('ni uno que vuelve a fallar sin prometer nada: la retoma espera a su CLI', () => {
    // un repaso de una ya catalogada no lo coge la pasada sola: su fallo no
    // lleva `process`, pero el de una cuenta sin sesion arma la espera
    const boton = mergeCatalogRound(
      general,
      {
        ...vacia,
        pending: 3,
        failed: [{ conversationId: X, reason: 'r' }],
        waiting: 0,
        provider: 'claude',
      },
      { conversationId: X },
    );
    expect(catalogInterrupted(boton)).toBe(true);
    const espera = {
      provider: 'claude',
      model: null,
      effort: null,
      wholeProvider: true,
      retryAt: new Date(ahora + 60_000).toISOString(),
    };
    expect(
      catalogResumeDue({ summary: boton, failures: [espera], now: ahora, lastResumeAt: null }),
    ).toBe(false);
    expect(
      catalogResumeDue({
        summary: boton,
        failures: [espera],
        now: ahora + 60_000,
        lastResumeAt: null,
      }),
    ).toBe(true);
  });

  it('con la cola vacia ya no queda nada que retomar', () => {
    // «Reintentar» ordena A, y no queda ninguna otra
    const boton = mergeCatalogRound(
      general,
      {
        ...vacia,
        cataloged: 1,
        scenes: 3,
        pending: 0,
        waiting: 0,
        catalogedIds: [A],
        provider: 'claude',
      },
      { conversationId: A },
    );
    expect(boton.failed).toEqual([]);
    expect(catalogInterrupted(boton)).toBe(false);
  });

  it('la pasada general sigue decidiendo sola, y un boton no deja a medias lo que no lo estaba', () => {
    const boton = mergeCatalogRound(general, repasoBien, { conversationId: X });
    const acabada = pasadaGeneral(boton, {
      ...vacia,
      cataloged: 3,
      scenes: 9,
      pending: 0,
      waiting: 0,
      catalogedIds: [A, 'b', 'c'],
      provider: 'claude',
    });
    expect(catalogInterrupted(acabada)).toBe(false);
    const tranquila = pasadaGeneral(null, { ...vacia, pending: 2, provider: 'claude' });
    expect(catalogInterrupted(tranquila)).toBe(false);
    expect(
      catalogInterrupted(mergeCatalogRound(tranquila, repasoBien, { conversationId: X })),
    ).toBe(false);
  });
});

// decimotercera ronda: el aviso prometia «sin reiniciar» a secas, y la retoma
// vive en la ventana: el cierre de la boveda —que el trabajo de fondo no
// impide, y que por defecto llega antes de que acabe la espera— se la llevaba.
// Y a lo que falla por su cuenta le decia «hasta que reinicies», cuando ahora
// se vuelve a probar pasado un par de horas
describe('cuando se vuelven a intentar las que no se ordenaron', () => {
  const proceso = { conversationId: 'a', reason: 'r', process: true };
  const suya = { conversationId: 'b', reason: 'r', blocked: true };
  const respuesta = { conversationId: 'c', reason: 'r' };

  it('las del CLI: en minutos, pero solo con la boveda abierta', () => {
    const dicho = catalogRetryNote([proceso]);
    expect(dicho).toContain('unos minutos');
    expect(dicho).toContain('mientras la bóveda siga abierta');
    expect(dicho).toContain('al volver a abrir «Lo que recuerda»');
    expect(dicho).not.toContain('reinicies');
  });

  it('las que fallan por su cuenta: un par de horas, no hasta reiniciar', () => {
    const dicho = catalogRetryNote([suya]);
    expect(dicho).toContain('un par de horas');
    expect(dicho).not.toContain('reinicies');
    expect(dicho).not.toContain('unos minutos');
  });

  it('las de la respuesta: no solas en esta sesion', () => {
    const dicho = catalogRetryNote([respuesta]);
    expect(dicho).toContain('No se reintentan solas en esta sesión');
    expect(dicho).not.toContain('unos minutos');
  });

  it('mezcladas, dice cada caso una vez', () => {
    const dicho = catalogRetryNote([proceso, suya, respuesta]);
    expect(dicho).toContain('unos minutos');
    expect(dicho).toContain('un par de horas');
    expect(dicho).toContain('no se reintentan solas en esta sesión');
    // `blocked` sin `process`: si llegaran las dos, manda la promesa de minutos
    expect(catalogRetryNote([{ ...suya, process: true }])).toContain('unos minutos');
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
