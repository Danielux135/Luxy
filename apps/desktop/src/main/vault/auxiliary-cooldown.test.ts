// la espera del trabajo de fondo tras un fallo del PROCESO de un CLI
// (`INV-FONDO-001`). Sin CLI, sin red y sin tokens: solo el reloj.
import { describe, it, expect } from 'vitest';
import { isSecretKeyName } from '@luxy/shared';
import {
  AUXILIARY_BLOCK_MS,
  AUXILIARY_PROCESS_WAIT_MS,
  AuxiliaryCooldown,
  LaunchPermit,
  isProcessFailure,
  noteVisibleTurn,
  processFailureLabel,
  processSubject,
} from './auxiliary-cooldown.js';

function reloj(inicio = Date.parse('2026-10-06T10:00:00.000Z')): {
  now: () => number;
  pasar: (ms: number) => void;
} {
  let ahora = inicio;
  return {
    now: () => ahora,
    pasar: (ms) => {
      ahora += ms;
    },
  };
}

describe('la espera por proveedor', () => {
  it('espera diez minutos tras un fallo y despues deja probar otra vez', () => {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    expect(espera.waiting('claude')).toBe(false);

    espera.noteFailure('claude', 'auth');
    expect(espera.waiting('claude')).toBe(true);
    tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS - 1);
    expect(espera.waiting('claude')).toBe(true);
    tiempo.pasar(1);
    expect(espera.waiting('claude')).toBe(false);
    // pasada la espera, el fallo sigue siendo lo ultimo que se sabe del CLI: la
    // pantalla lo enseña hasta que vuelva a contestar
    expect(espera.lastFailure('claude')).toMatchObject({ provider: 'claude', reason: 'auth' });
  });

  it('es por proveedor: un Claude sin sesion no dice nada de Codex', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('claude', 'auth');
    expect(espera.waiting('codex')).toBe(false);
    expect(espera.lastFailure('codex')).toBeNull();
  });

  it('una respuesta, la que sea, acaba la espera y borra el fallo', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('claude', 'rate_limit');
    espera.noteSuccess('claude');
    expect(espera.waiting('claude')).toBe(false);
    expect(espera.failures()).toEqual([]);
  });

  it('otro fallo rearma la espera desde ese momento', () => {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    espera.noteFailure('claude', 'auth');
    tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS);
    espera.noteFailure('claude', null);
    expect(espera.waiting('claude')).toBe(true);
    expect(espera.lastFailure('claude')).toMatchObject({
      reason: null,
      retryAt: new Date(tiempo.now() + AUXILIARY_PROCESS_WAIT_MS).toISOString(),
    });
  });

  it('lo que ve la pantalla son enums y horas, nada mas', () => {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    espera.noteFailure('claude', 'auth');
    expect(espera.failures()).toEqual([
      {
        provider: 'claude',
        // sin sesion no contesta con ningun modelo: es del CLI entero
        model: null,
        effort: null,
        wholeProvider: true,
        reason: 'auth',
        at: '2026-10-06T10:00:00.000Z',
        retryAt: '2026-10-06T10:10:00.000Z',
      },
    ]);
  });
});

// duodecima ronda: la espera iba solo por CLI, y con «Automatico» el catalogo
// lanza el modelo y el esfuerzo de la ventana mientras los pendientes, la
// reescritura y el relleno lanzan el CLI a secas. Un modelo que el CLI instalado
// no soporta paraba a los cuatro, y la retoma del catalogo lo rearmaba cada
// diez minutos con el mismo modelo
describe('la espera es de lo que se lanza: CLI, modelo y esfuerzo', () => {
  const ASTRA = { provider: 'codex', model: 'modelo-inventado-a' } as const;
  const X = processSubject('catalog', 'conversacion-x');
  const Y = processSubject('catalog', 'conversacion-y');

  it('un fallo del CLI con el modelo A no frena lo que va con el modelo por defecto', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure(ASTRA, 'api_error', X)).toBe('conversation');
    expect(espera.noteFailure(ASTRA, 'api_error', Y)).toBe('cli');

    expect(new LaunchPermit(espera, false).allows(ASTRA)).toBe(false);
    // los pendientes, con Codex a secas, siguen
    expect(new LaunchPermit(espera, false).allows({ provider: 'codex', model: null })).toBe(true);
    expect(new LaunchPermit(espera, false).allows('codex')).toBe(true);
    expect(espera.waiting('codex')).toBe(false);
  });

  it('y al reves: lo que falla con el modelo por defecto no frena al catalogo con otro', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('codex', 'api_error');
    expect(espera.waiting('codex')).toBe(true);
    expect(espera.waiting(ASTRA)).toBe(false);
  });

  it('el esfuerzo tambien cuenta: el de la ventana no es el de los pendientes', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure({ provider: 'codex', model: null, effort: 'xhigh' }, 'rate_limit');
    expect(espera.waiting({ provider: 'codex', model: null, effort: 'xhigh' })).toBe(true);
    expect(espera.waiting({ provider: 'codex', model: null })).toBe(false);
  });

  it('un modelo vacio es el que trae el CLI, igual que null', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure({ provider: 'claude', model: '' }, 'rate_limit');
    expect(espera.waiting({ provider: 'claude', model: null })).toBe(true);
    expect(espera.waiting('claude')).toBe(true);
  });

  it('sin sesion es del CLI entero: frena cualquier modelo', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure(ASTRA, 'auth', X)).toBe('cli');
    expect(espera.waiting('codex')).toBe(true);
    expect(espera.waiting({ provider: 'codex', model: 'otro', effort: 'low' })).toBe(true);
    // pero no al otro CLI
    expect(espera.waiting('claude')).toBe(false);
  });

  it('contestar con un modelo acaba la espera de la cuenta, no la de otro modelo', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('codex', 'auth');
    espera.noteFailure(ASTRA, 'rate_limit');
    espera.noteSuccess({ provider: 'codex', model: 'otro' });
    // contesto: la cuenta tiene sesion
    expect(espera.waiting('codex')).toBe(false);
    // y el limite de ese modelo puede seguir siendo suyo
    expect(espera.waiting(ASTRA)).toBe(true);
  });

  it('la pantalla ve con que modelo y esfuerzo fallo, para nombrarlo', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure({ ...ASTRA, effort: 'high' }, null);
    expect(espera.failures()).toEqual([
      expect.objectContaining({
        provider: 'codex',
        model: 'modelo-inventado-a',
        effort: 'high',
        wholeProvider: false,
        reason: null,
      }),
    ]);
  });

  it('un nombre de modelo escrito a mano, con cualquier caracter, es solo ese', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure({ provider: 'codex', model: 'x|low', effort: null }, 'rate_limit');
    expect(espera.waiting({ provider: 'codex', model: 'x|low', effort: null })).toBe(true);
    expect(espera.waiting({ provider: 'codex', model: 'x', effort: 'low' })).toBe(false);
  });
});

// undecima ronda: todo fallo del proceso se trataba como del CLI entero, asi que
// una sola conversacion que fallase siempre —un tiempo agotado, un api_error de
// su prompt— rearmaba la espera de los cuatro trabajos cada diez minutos, para
// siempre, y frenaba a todas las de detras
describe('de quien es un fallo del proceso', () => {
  const A = processSubject('relink', 'conversacion-a');
  const B = processSubject('relink', 'conversacion-b');

  it('auth y rate_limit son del CLI siempre, aunque sea la primera vez', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('claude', 'auth', A)).toBe('cli');
    expect(espera.waiting('claude')).toBe(true);
    const otra = new AuxiliaryCooldown();
    expect(otra.noteFailure('claude', 'rate_limit', A)).toBe('cli');
    expect(otra.waiting('claude')).toBe(true);
  });

  it('sin saber con quien fallo, es del CLI', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('claude', 'api_error')).toBe('cli');
    expect(espera.waiting('claude')).toBe(true);
  });

  it('el primer fallo dudoso es de la conversacion: no frena a nadie', () => {
    const espera = new AuxiliaryCooldown();
    for (const motivo of ['api_error', 'exit_code', null] as const) {
      const sujeto = processSubject('catalog', `c-${String(motivo)}`);
      // cada una tras una respuesta del CLI: si no, la segunda ya seria «otra»
      espera.noteSuccess('claude');
      expect(espera.noteFailure('claude', motivo, sujeto)).toBe('conversation');
    }
    expect(espera.waiting('claude')).toBe(false);
    expect(espera.failures()).toEqual([]);
  });

  it('si falla otra antes de que el CLI conteste, es del CLI', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('claude', null, A)).toBe('conversation');
    expect(espera.noteFailure('claude', null, B)).toBe('cli');
    expect(espera.waiting('claude')).toBe(true);
    // y lo de A tambien lo era: con el CLI ya arreglado, el siguiente fallo de A
    // vuelve a ser el primero, no un motivo para dejarla fuera de la sesion
    espera.noteSuccess('claude', B);
    expect(espera.noteFailure('claude', null, A)).toBe('conversation');
  });

  it('la misma dos veces sin que el CLI conteste a nadie: no se sabe, y espera', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('claude', 'api_error', A)).toBe('conversation');
    expect(espera.noteFailure('claude', 'api_error', A)).toBe('cli');
    expect(espera.waiting('claude')).toBe(true);
  });

  it('la misma otra vez DESPUES de que el CLI contestara a otra: es suya, y no rearma la espera', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('claude', 'api_error', A)).toBe('conversation');
    espera.noteSuccess('claude', B);
    expect(espera.noteFailure('claude', 'api_error', A)).toBe('blocked');
    expect(espera.waiting('claude')).toBe(false);
    expect(espera.failures()).toEqual([]);
  });

  it('con la cuenta sin sesion y su espera puesta, lo que falle es lo de esperar', () => {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    espera.noteFailure('claude', 'auth', B);
    // un boton la prueba con la espera aun puesta, y falla sin decir por que: no
    // prueba que la cuenta tenga sesion, asi que no es de esa conversacion
    expect(espera.noteFailure('claude', null, A)).toBe('cli');
    expect(espera.noteFailure('claude', 'exit_code', A)).toBe('cli');
    expect(espera.waiting('claude')).toBe(true);
    expect(espera.failures()).toContainEqual(
      expect.objectContaining({ wholeProvider: true, reason: 'auth' }),
    );
  });

  it('una respuesta a esa misma conversacion borra lo que se le apunto', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('codex', null, A)).toBe('conversation');
    espera.noteSuccess('codex', A);
    espera.noteSuccess('codex', B);
    expect(espera.noteFailure('codex', null, A)).toBe('conversation');
  });

  it('es por CLI: lo apuntado con Claude no cuenta con Codex', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('claude', null, A)).toBe('conversation');
    espera.noteSuccess('codex', B);
    expect(espera.noteFailure('codex', null, A)).toBe('conversation');
  });

  it('cada trabajo tiene lo suyo: el catalogo de una no es su reescritura', () => {
    expect(processSubject('catalog', 'x')).not.toEqual(processSubject('relink', 'x'));
  });
});

// decimotercera ronda: la espera de una cuenta sin sesion contaba mientras su
// entrada siguiera ahi, y no se iba hasta que ese CLI contestase a otro trabajo.
// Tras `claude auth login`, con la ventana en una API de pago y una sola
// conversacion pendiente que falla por su cuenta, cada fallo salia del CLI y
// rearmaba la espera para siempre, con la pantalla pidiendo un login ya hecho
describe('pasada la espera de una cuenta sin sesion', () => {
  const X = processSubject('relation', 'conversacion-x');

  for (const motivo of ['exit_code', 'api_error', null] as const) {
    it(`lo que falla despues con otro motivo se atribuye como siempre (${String(motivo)})`, () => {
      const tiempo = reloj();
      const espera = new AuxiliaryCooldown({ now: tiempo.now });
      espera.noteFailure('claude', 'auth');
      tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS);

      // el disparo de despues de cada turno, cada dos minutos, sobre la unica
      // pendiente; lo que se salta no se lanza
      const veredictos: string[] = [];
      for (let minuto = 0; minuto < 120; minuto += 2) {
        if (!espera.blocked('claude', X) && new LaunchPermit(espera, false).allows('claude')) {
          veredictos.push(espera.noteFailure('claude', motivo, X));
        }
        tiempo.pasar(2 * 60 * 1000);
      }
      expect(veredictos).toEqual(['conversation', 'cli', 'blocked']);
      expect(espera.waiting('claude')).toBe(false);
      // y el aviso de «sin sesion» se va: lo ultimo que se sabe ya no es eso
      expect(espera.failures()).toEqual([]);
    });
  }

  it('un fallo que el CLI clasifica sin decir auth prueba la sesion, aun con la espera puesta', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('claude', 'auth');
    // un boton, justo despues de `claude auth login`: la cuenta ya contesta, y lo
    // que falla es de esa conversacion
    expect(espera.noteFailure('claude', 'api_error', X)).toBe('conversation');
    expect(espera.waiting('claude')).toBe(false);
    expect(espera.failures()).toEqual([]);
  });

  it('otra vez sin sesion vuelve a esperar el CLI entero', () => {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    espera.noteFailure('claude', 'auth');
    tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS);
    expect(espera.noteFailure('claude', 'auth', X)).toBe('cli');
    expect(espera.waiting({ provider: 'claude', model: 'otro', effort: null })).toBe(true);
  });
});

// decimotercera ronda: dos conversaciones que fallan siempre por su cuenta se
// cubrian la una a la otra. Cada vuelta parecia un apagon —fallaban dos
// distintas en la misma tanda—, la segunda borraba lo apuntado a la primera, y
// ninguna llegaba nunca a ser suya aunque el CLI contestara a otra entre vuelta
// y vuelta. Cada vuelta rearmaba la espera de los cuatro trabajos
describe('dos que fallan solas con el CLI contestando entre medias', () => {
  const Z = processSubject('catalog', 'conversacion-z');
  const X = processSubject('catalog', 'conversacion-x');
  const Y = processSubject('catalog', 'conversacion-y');

  function vueltas(contestaEntreMedias: (espera: AuxiliaryCooldown) => void) {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    const veredictos: string[] = [];
    let esperasArmadas = 0;
    for (let vuelta = 0; vuelta < 8; vuelta += 1) {
      contestaEntreMedias(espera);
      for (const sujeto of [X, Y]) {
        if (espera.blocked('codex', sujeto) || !new LaunchPermit(espera, false).allows('codex')) {
          continue;
        }
        const veredicto = espera.noteFailure('codex', 'exit_code', sujeto);
        veredictos.push(`${sujeto.conversationId === X.conversationId ? 'X' : 'Y'}=${veredicto}`);
        if (veredicto === 'cli') esperasArmadas += 1;
      }
      tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS);
    }
    return { espera, veredictos, esperasArmadas };
  }

  it('acaban suyas y dejan de armar la espera de los demas', () => {
    // la conversacion activa, Z, se cataloga bien al principio de cada vuelta
    const { espera, veredictos, esperasArmadas } = vueltas((espera) =>
      espera.noteSuccess('codex', Z),
    );
    expect(veredictos).toEqual([
      'X=conversation',
      'Y=cli',
      'X=conversation',
      'Y=cli',
      'X=blocked',
      'Y=blocked',
    ]);
    expect(esperasArmadas).toBe(2);
    expect(espera.waiting('codex')).toBe(false);
  });

  it('lo mismo si lo que contesta entre medias es un turno de Daniel por ese CLI', () => {
    const { veredictos } = vueltas((espera) =>
      noteVisibleTurn(
        espera,
        { provider: 'codex', model: null, effort: null },
        { outcome: 'completed', failureReason: null },
      ),
    );
    expect(veredictos.slice(-2)).toEqual(['X=blocked', 'Y=blocked']);
  });

  it('en un apagon de verdad, sin nadie que conteste, nadie se queda fuera', () => {
    const { veredictos } = vueltas(() => undefined);
    expect(veredictos.filter((each) => each.endsWith('blocked'))).toEqual([]);
  });

  it('tras un apagon arreglado, el primer fallo de una no la deja fuera', () => {
    // lo que fallo en la tanda del apagon cuenta una vez, no como fallo suyo
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('codex', null, X)).toBe('conversation');
    expect(espera.noteFailure('codex', null, Y)).toBe('cli');
    espera.noteSuccess('codex', Y);
    expect(espera.noteFailure('codex', null, X)).toBe('conversation');
  });
});

// decimotercera ronda: «otra» se miraba por trabajo y conversacion. El catalogo
// y los pendientes de la MISMA conversacion contaban como dos distintas: la
// espera quedaba armada «por dos», la regla de la que la armo sola no se
// cumplia nunca y volvia el bucle de seis lanzamientos por hora, con la
// conversacion activa siempre la primera en lanzarse al vencer la espera
describe('dos trabajos de la misma conversacion', () => {
  const RELACION = processSubject('relation', 'conversacion-x');
  const CATALOGO = processSubject('catalog', 'conversacion-x');

  it('no son dos conversaciones: el segundo fallo no es del CLI', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('codex', 'exit_code', RELACION)).toBe('conversation');
    expect(espera.noteFailure('codex', 'exit_code', CATALOGO)).toBe('conversation');
    expect(espera.waiting('codex')).toBe(false);
  });

  it('turnos cada dos minutos alternando los dos trabajos: acaban fuera los dos', () => {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    const veredictos: string[] = [];
    let turno = 0;
    for (let minuto = 0; minuto < 120; minuto += 2) {
      const sujeto = turno % 2 === 0 ? RELACION : CATALOGO;
      turno += 1;
      if (!espera.blocked('codex', sujeto) && new LaunchPermit(espera, false).allows('codex')) {
        veredictos.push(espera.noteFailure('codex', 'exit_code', sujeto));
      }
      tiempo.pasar(2 * 60 * 1000);
    }
    expect(veredictos.filter((each) => each === 'blocked')).toHaveLength(2);
    expect(veredictos.filter((each) => each === 'cli').length).toBeLessThanOrEqual(2);
    expect(espera.waiting('codex')).toBe(false);
    expect(espera.blocked('codex', RELACION)).toBe(true);
    expect(espera.blocked('codex', CATALOGO)).toBe(true);
  });

  it('la que ya salto en un trabajo no hace del CLI el fallo de su otro trabajo', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('codex', 'exit_code', RELACION);
    espera.noteFailure('codex', 'exit_code', RELACION);
    expect(espera.noteFailure('codex', 'exit_code', RELACION)).toBe('blocked');
    // lo apuntado a sus pendientes se queda, pero es de ella, no de «otra»
    expect(espera.noteFailure('codex', 'exit_code', CATALOGO)).toBe('conversation');
    expect(espera.noteFailure('codex', 'exit_code', CATALOGO)).toBe('cli');
    expect(espera.noteFailure('codex', 'exit_code', CATALOGO)).toBe('blocked');
    expect(espera.waiting('codex')).toBe(false);
  });

  it('saltarla en un trabajo no la salta en el otro', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('codex', 'exit_code', RELACION);
    espera.noteSuccess('codex');
    expect(espera.noteFailure('codex', 'exit_code', RELACION)).toBe('blocked');
    expect(espera.blocked('codex', RELACION)).toBe(true);
    expect(espera.blocked('codex', CATALOGO)).toBe(false);
  });
});

// decimotercera ronda: saltar una conversacion era para el resto de la sesion.
// Un fallo del CLI entero que no se reconoce como tal —Codex no dice con un
// codigo que ha llegado a su limite de uso— la dejaba fuera aunque el limite se
// renovara horas despues, y Studio pasa dias abierta
describe('lo que es de una conversacion caduca', () => {
  const X = processSubject('relation', 'conversacion-x');

  function suya(tiempo: ReturnType<typeof reloj>): AuxiliaryCooldown {
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    espera.noteFailure('codex', 'api_error', X);
    espera.noteSuccess('codex');
    expect(espera.noteFailure('codex', 'api_error', X)).toBe('blocked');
    return espera;
  }

  it('se salta dos horas y despues se prueba una vez', () => {
    const tiempo = reloj();
    const espera = suya(tiempo);
    expect(espera.blocked('codex', X)).toBe(true);
    tiempo.pasar(AUXILIARY_BLOCK_MS - 1);
    expect(espera.blocked('codex', X)).toBe(true);
    tiempo.pasar(1);
    expect(espera.blocked('codex', X)).toBe(false);
  });

  it('si el intento de prueba vuelve a fallar, otras dos horas, sin frenar a nadie', () => {
    const tiempo = reloj();
    const espera = suya(tiempo);
    tiempo.pasar(AUXILIARY_BLOCK_MS);
    expect(espera.noteFailure('codex', 'api_error', X)).toBe('blocked');
    expect(espera.waiting('codex')).toBe(false);
    expect(espera.blocked('codex', X)).toBe(true);
  });

  it('si contesta, vuelve a ser como las demas', () => {
    const tiempo = reloj();
    const espera = suya(tiempo);
    tiempo.pasar(AUXILIARY_BLOCK_MS);
    espera.noteSuccess('codex', X);
    expect(espera.blocked('codex', X)).toBe(false);
    expect(espera.noteFailure('codex', 'api_error', X)).toBe('conversation');
  });

  it('el limite de uso que llega en el intento de prueba es del CLI, como siempre', () => {
    const tiempo = reloj();
    const espera = suya(tiempo);
    tiempo.pasar(AUXILIARY_BLOCK_MS);
    expect(espera.noteFailure('codex', 'rate_limit', X)).toBe('cli');
    expect(espera.waiting('codex')).toBe(true);
  });

  it('cambiar de dueño olvida lo apuntado a esa conversacion, en todos los trabajos', () => {
    const tiempo = reloj();
    const espera = suya(tiempo);
    const catalogo = processSubject('catalog', 'conversacion-x');
    espera.noteFailure('codex', 'api_error', catalogo);
    espera.forgetConversation('conversacion-x');
    expect(espera.blocked('codex', X)).toBe(false);
    expect(espera.noteFailure('codex', 'api_error', X)).toBe('conversation');
    expect(espera.noteFailure('codex', 'api_error', catalogo)).toBe('conversation');
  });
});

// duodecima ronda: con UNA sola conversacion activa, la que falla siempre por su
// cuenta no llegaba nunca a `blocked`. La primera vez era suya, la segunda —sin
// respuesta del CLI entre medias— armaba la espera, y desde ahi todo fallo era
// del CLI y la rearmaba: `blocked` exigia que el CLI contestase antes a OTRA, y
// la espera impedia lanzar a nadie mas. Seis lanzamientos por hora, para siempre,
// y el resto del trabajo de fondo esperando detras
describe('una sola conversacion que falla siempre por su cuenta', () => {
  const X = processSubject('relation', 'conversacion-x');
  const Y = processSubject('relation', 'conversacion-y');

  /**
   * tres horas de turnos cada dos minutos, como el disparo de despues de cada
   * turno, sobre la unica conversacion activa. Lo que se salta no se lanza,
   * como hacen los cuatro trabajos (`blocked`)
   */
  function tresHoras(motivo: 'api_error' | 'exit_code' | null) {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    const veredictos: string[] = [];
    for (let minuto = 0; minuto < 180; minuto += 2) {
      if (!espera.blocked('codex', X) && new LaunchPermit(espera, false).allows('codex')) {
        veredictos.push(espera.noteFailure('codex', motivo, X));
      }
      tiempo.pasar(2 * 60 * 1000);
    }
    return { espera, veredictos };
  }

  for (const motivo of ['api_error', 'exit_code', null] as const) {
    it(`acaba suya y suelta la espera (${String(motivo)})`, () => {
      const { espera, veredictos } = tresHoras(motivo);
      // la primera suya, la segunda no se sabe y espera, y la tercera —con la
      // espera que armo ella sola— es suya. Dos horas despues se prueba una vez
      // y, como vuelve a fallar, sigue siendo suya sin rearmar la espera
      expect(veredictos).toEqual(['conversation', 'cli', 'blocked', 'blocked']);
      expect(espera.waiting('codex')).toBe(false);
      expect(espera.failures()).toEqual([]);
    });
  }

  it('aunque la pruebe un boton con la espera aun puesta', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('codex', 'api_error', X);
    espera.noteFailure('codex', 'api_error', X);
    expect(espera.waiting('codex')).toBe(true);
    expect(espera.noteFailure('codex', 'api_error', X)).toBe('blocked');
    expect(espera.waiting('codex')).toBe(false);
  });

  it('si despues falla OTRA sin que el CLI conteste a nadie, era el CLI: vuelve a esperar', () => {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    espera.noteFailure('codex', null, X);
    espera.noteFailure('codex', null, X);
    tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS);
    expect(espera.noteFailure('codex', null, X)).toBe('blocked');
    // con el CLI roto de verdad, la siguiente tambien falla: dos distintas
    expect(espera.noteFailure('codex', null, Y)).toBe('cli');
    expect(espera.waiting('codex')).toBe(true);
    // y esa espera ya no es de una sola: pasada, otro fallo de Y la rearma
    tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS);
    expect(espera.noteFailure('codex', null, Y)).toBe('cli');
    expect(espera.waiting('codex')).toBe(true);
  });

  it('con dos que fallan en la misma tanda, la espera sigue siendo del CLI', () => {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    expect(espera.noteFailure('codex', null, X)).toBe('conversation');
    expect(espera.noteFailure('codex', null, Y)).toBe('cli');
    tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS);
    expect(espera.noteFailure('codex', null, X)).toBe('cli');
    expect(espera.waiting('codex')).toBe(true);
  });

  it('tras un limite de uso, lo que falla despues por otra cosa se cuenta de nuevo', () => {
    const tiempo = reloj();
    const espera = new AuxiliaryCooldown({ now: tiempo.now });
    expect(espera.noteFailure('codex', 'rate_limit', X)).toBe('cli');
    tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS);
    expect(espera.noteFailure('codex', 'api_error', X)).toBe('cli');
    tiempo.pasar(AUXILIARY_PROCESS_WAIT_MS);
    expect(espera.noteFailure('codex', 'api_error', X)).toBe('blocked');
    expect(espera.waiting('codex')).toBe(false);
  });

  it('un limite de uso no deja a nadie fuera: sigue siendo del CLI', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('codex', 'api_error', X);
    espera.noteFailure('codex', 'api_error', X);
    expect(espera.noteFailure('codex', 'rate_limit', X)).toBe('cli');
    expect(espera.waiting('codex')).toBe(true);
  });
});

// el turno de Daniel que su CLI contesta es la prueba de que contesta
describe('un turno visible contestado', () => {
  const X = processSubject('relink', 'conversacion-x');
  const completado = { outcome: 'completed', failureReason: null } as const;

  it('acaba la espera de una cuenta sin sesion en cuanto Daniel habla por ese CLI', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('claude', 'auth', X);
    expect(
      noteVisibleTurn(espera, { provider: 'claude', model: 'opus', effort: null }, completado),
    ).toBe(true);
    expect(espera.waiting('claude')).toBe(false);
    expect(espera.failures()).toEqual([]);
  });

  it('cuenta como respuesta: la que fallo sola y vuelve a fallar es suya', () => {
    const espera = new AuxiliaryCooldown();
    expect(espera.noteFailure('codex', 'api_error', X)).toBe('conversation');
    noteVisibleTurn(espera, { provider: 'codex', model: null, effort: null }, completado);
    expect(espera.noteFailure('codex', 'api_error', X)).toBe('blocked');
    expect(espera.waiting('codex')).toBe(false);
  });

  it('un turno fallido, cortado o de una API de pago no dice nada', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('claude', 'auth');
    const lanzado = { provider: 'claude', model: null, effort: null } as const;
    expect(noteVisibleTurn(espera, lanzado, { outcome: 'failed', failureReason: 'auth' })).toBe(
      false,
    );
    expect(noteVisibleTurn(espera, lanzado, { outcome: 'cancelled' })).toBe(false);
    // un texto que llega con un motivo es el mensaje del error, no una respuesta
    expect(noteVisibleTurn(espera, lanzado, { outcome: 'completed', failureReason: 'auth' })).toBe(
      false,
    );
    expect(
      noteVisibleTurn(espera, { provider: 'deepseek', model: null, effort: null }, completado),
    ).toBe(false);
    expect(espera.waiting('claude')).toBe(true);
  });
});

describe('el permiso de una tanda', () => {
  it('sin boton respeta la espera', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('claude', 'auth');
    expect(new LaunchPermit(espera, false).allows('claude')).toBe(false);
  });

  it('el boton prueba UNA vez: gastado, vuelve a mandar la espera', () => {
    const espera = new AuxiliaryCooldown();
    espera.noteFailure('claude', 'auth');
    const permiso = new LaunchPermit(espera, true);
    expect(permiso.allows('claude')).toBe(true);
    permiso.spend();
    expect(permiso.allows('claude')).toBe(false);
  });

  it('sin espera, deja pasar siempre', () => {
    const permiso = new LaunchPermit(new AuxiliaryCooldown(), false);
    permiso.spend();
    expect(permiso.allows('codex')).toBe(true);
  });
});

describe('que es un fallo del proceso', () => {
  it('cualquier final distinto de completed, o un motivo estructurado', () => {
    expect(isProcessFailure({ outcome: 'completed' })).toBe(false);
    expect(isProcessFailure({ outcome: 'completed', failureReason: null })).toBe(false);
    expect(isProcessFailure({ outcome: 'failed' })).toBe(true);
    expect(isProcessFailure({ outcome: 'cancelled' })).toBe(true);
    // el motivo manda: con el, el texto es el mensaje del error, no una respuesta
    expect(isProcessFailure({ outcome: 'completed', failureReason: 'auth' })).toBe(true);
  });

  it('el motivo para el registro es siempre un enum', () => {
    expect(processFailureLabel('auth')).toBe('auth');
    expect(processFailureLabel(null)).toBe('sin-motivo');
    expect(processFailureLabel(undefined)).toBe('sin-motivo');
  });

  it('los campos nuevos del registro no se tapan como si fueran secretos', () => {
    // `redact` tapa cualquier campo que acabe en key, token, secret, password o
    // credential: un nombre asi saldria como [REDACTADO] y el dato se perderia
    for (const campo of ['motivoFallo', 'enEspera', 'derivaciones', 'filas', 'atribucion']) {
      expect(isSecretKeyName(campo)).toBe(false);
    }
  });
});
