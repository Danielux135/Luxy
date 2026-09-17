// que se enseña del saldo de AI Horde y que NO se enseña.
//
// Lo que fijan estas pruebas no es estetica: es la distincion entre «el
// servidor dijo cero» y «el servidor no lo dijo». Lo segundo no puede acabar en
// pantalla como un cero, ni como un hueco, ni como «undefined»: simplemente no
// se pinta. Y fijan hasta donde llega cada frase: el minimo solo se afirma con
// el tipo de cuenta DECLARADO por el servidor, la suma parcial no se llama
// total, y lo que no ha entrado se acota a las casillas que de verdad se miran.
import { describe, it, expect } from 'vitest';
import {
  describeKudosBreakdown,
  type KudosDetailsView,
} from './vault-kudos-breakdown.js';
import type { z } from 'zod';
import type { vaultHordeAccountResultSchema } from '../shared/ipc.js';

type HordeAccount = z.infer<typeof vaultHordeAccountResultSchema>;

/** el desglose entero a cero: la cuenta que nunca ha ingresado nada */
const nada: KudosDetailsView = {
  accumulated: 0,
  gifted: 0,
  donated: 0,
  admin: 0,
  received: 0,
  recurring: 0,
  awarded: 0,
  styled: 0,
};

/** el desglose que el servidor no mando: ocho silencios, ningun cero */
const silencio: KudosDetailsView = {
  accumulated: null,
  gifted: null,
  donated: null,
  admin: null,
  received: null,
  recurring: null,
  awarded: null,
  styled: null,
};

function cuenta(overrides: Partial<HordeAccount> = {}): HordeAccount {
  return {
    username: 'daniel#1',
    kudos: 25,
    concurrency: 5,
    anonymous: false,
    kudosDetails: null,
    // el tipo de cuenta arranca en silencio a proposito: quien lo quiera usar
    // tiene que pasarlo explicitamente, no heredarlo de un valor por defecto
    pseudonymous: null,
    service: null,
    ...overrides,
  };
}

function valorDe(view: ReturnType<typeof describeKudosBreakdown>, label: string): string | undefined {
  return view.rows.find((row) => row.label === label)?.value;
}

describe('desglose de kudos', () => {
  it('sin desglose no inventa filas, pero el minimo sigue explicandose', () => {
    const view = describeKudosBreakdown(cuenta({ pseudonymous: false }));
    expect(view.rows).toEqual([]);
    expect(view.income).toBeNull();
    expect(view.spending).toBeNull();
    expect(view.floor).toContain('25');
  });

  it('un desglose de puros nulos no pinta ni un cero', () => {
    const view = describeKudosBreakdown(cuenta({ kudosDetails: silencio }));
    expect(view.rows).toEqual([]);
    expect(view.income).toBeNull();
    expect(view.spending).toBeNull();
    // ninguna fila puede salir con un valor vacio o con «undefined»
    for (const row of view.rows) expect(row.value).not.toMatch(/undefined|^$/);
  });

  it('todo a cero se acota a las cinco casillas que de verdad mira', () => {
    const view = describeKudosBreakdown(cuenta({ kudosDetails: nada }));
    expect(valorDe(view, 'Kudos que han entrado')).toBe('ninguno');
    // ni «nunca», ni «ninguna via»: el alcance es el de las cinco casillas
    expect(view.income).toContain('Ni un kudos por premios');
    expect(view.income).not.toMatch(/[Nn]unca/);
    // y las cinco se enumeran enteras, administradores incluidos
    expect(view.income).toContain('administradores');
    // lo que cae en `accumulated` queda declarado fuera de esa cuenta
    expect(view.income).toContain('prestar la GPU');
  });

  it('`accumulated` no se vende como contador de gasto', () => {
    const view = describeKudosBreakdown(
      cuenta({ pseudonymous: false, kudosDetails: { ...nada, accumulated: -842 } }),
    );
    expect(valorDe(view, 'Acumulado o gastado')).toBe('-842');
    // lo unico verificado de esa casilla: va en crudo, y no es solo gasto
    expect(view.spending).toContain('sin recortar al mínimo');
    expect(view.spending).toContain('no es sólo gasto');
    expect(view.floor).toContain('no baja');
  });

  it('si ha entrado algo, lo suma y detalla solo las vias con algo', () => {
    const view = describeKudosBreakdown(
      cuenta({ kudos: 130, kudosDetails: { ...nada, awarded: 20, received: 100 } }),
    );
    expect(valorDe(view, 'Kudos que han entrado')).toBe('120');
    expect(valorDe(view, 'Premios recibidos')).toBe('20');
    expect(valorDe(view, 'Regalos de otras personas')).toBe('100');
    // las vias a cero no ensucian el recuadro cuando ya hay algo que enseñar
    expect(valorDe(view, 'Por estilizar peticiones de otros')).toBeUndefined();
    expect(view.income).toContain('120');
  });

  it('una suma a la que le falta una casilla no se llama total', () => {
    const view = describeKudosBreakdown(
      cuenta({ kudos: 130, kudosDetails: { ...nada, awarded: 20, received: null } }),
    );
    expect(view.income).toContain('20');
    expect(view.income).not.toMatch(/en total|cinco casillas/);
    expect(view.income).toContain('las demás no las ha mandado');
  });

  it('una via en silencio no se suma ni se pinta, y lo dicho se matiza', () => {
    const view = describeKudosBreakdown(
      cuenta({ kudosDetails: { ...nada, awarded: null } }),
    );
    expect(valorDe(view, 'Kudos que han entrado')).toBe('ninguno');
    expect(valorDe(view, 'Premios recibidos')).toBeUndefined();
    expect(view.income).toBe('De las casillas que el servidor ha contado no ha entrado ni un kudos.');
  });

  it('dos vias que se compensan no se leen como «no entro nada»', () => {
    // la suma da cero, pero una casilla movida SI afirma que entro algo: decir
    // «ninguno» ahi seria exactamente el tipo de afirmacion que esto corrige
    const view = describeKudosBreakdown(
      cuenta({ kudosDetails: { ...nada, awarded: 10, received: -10 } }),
    );
    expect(valorDe(view, 'Kudos que han entrado')).toBe('0');
    expect(valorDe(view, 'Premios recibidos')).toBe('10');
    expect(view.income).not.toContain('Ni un kudos');
  });

  it('lo regalado a otros solo aparece cuando de verdad se regalo algo', () => {
    const limpio = describeKudosBreakdown(cuenta({ kudosDetails: nada }));
    expect(valorDe(limpio, 'Regalados a otras personas')).toBeUndefined();

    const regalado = describeKudosBreakdown(
      cuenta({ kudosDetails: { ...nada, gifted: 30 } }),
    );
    expect(valorDe(regalado, 'Regalados a otras personas')).toBe('30');
  });

  it('el tipo de cuenta lo dice el servidor, no el numero del saldo', () => {
    const conPass = describeKudosBreakdown(cuenta({ pseudonymous: true, kudos: 14 }));
    expect(conPass.floor).toContain('usuario y contraseña');

    const conOauth = describeKudosBreakdown(cuenta({ pseudonymous: false, kudos: 25 }));
    expect(conOauth.floor).toContain('servicio externo');
    // ningun campo de la respuesta dice CUAL, asi que no se nombra ninguno
    expect(conOauth.floor).not.toMatch(/Google|Discord|GitHub/);
  });

  it('sin tipo declarado no se afirma ningun minimo, solo lo que se ve', () => {
    const view = describeKudosBreakdown(
      cuenta({ kudos: 25, kudosDetails: { ...nada, accumulated: -842 } }),
    );
    expect(view.floor).toContain('no está comprobado');
    expect(view.floor).not.toContain('mínimo de una cuenta');
    // y sin nada observado tampoco se dice nada
    expect(describeKudosBreakdown(cuenta({ kudos: 25 })).floor).toBeNull();
  });

  it('`service` no decide el tipo de cuenta: es una cuenta de proxy', () => {
    const view = describeKudosBreakdown(cuenta({ service: true, kudos: 25 }));
    expect(view.floor).toBeNull();
  });

  it('un saldo que no esta en su minimo no se explica', () => {
    expect(describeKudosBreakdown(cuenta({ pseudonymous: false, kudos: 312 })).floor).toBeNull();
  });

  it('la clave anonima tiene su propio minimo', () => {
    const view = describeKudosBreakdown(cuenta({ anonymous: true, kudos: -50 }));
    expect(view.floor).toContain('clave anónima');
    expect(describeKudosBreakdown(cuenta({ anonymous: true, kudos: 25 })).floor).toBeNull();
  });
});
