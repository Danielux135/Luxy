// que se fija aqui: que «el jueves» significa un RANGO DE FECHAS concreto.
//
// La busqueda de recuerdos es lexica, asi que sin esto una pregunta por una
// fecha —la forma mas natural de pedir un recuerdo— no encuentra nada. Lo que
// convierte la frase en fechas es este modulo, y estas pruebas son la unica
// forma de saber que acierta: probarlo a mano exigiria esperar a que fuera
// jueves, y de madrugada.
//
// Por eso el reloj se inyecta. Todas las pruebas parten del mismo instante
// —jueves 10 de septiembre de 2026, 17:00 en Madrid— y las que hablan de la
// madrugada usan un ancla distinta, nunca el reloj real.
//
// Las comprobaciones se escriben en HORA LOCAL y no en ISO: un rango que
// empieza a las 05:00 y termina a las 05:00 del dia siguiente se lee de un
// vistazo, y en UTC no. La conversion la hace `local()`, que solo formatea.

import { describe, it, expect } from 'vitest';
import {
  civilDay,
  civilDayLabel,
  resolveTemporalReference,
  type TemporalAnchor,
  type TemporalReference,
} from './temporal-reference.js';

/** jueves 2026-09-10, 17:00 en Madrid. La prueba de abajo comprueba que lo es */
const ANCLA: TemporalAnchor = {
  instant: '2026-09-10T15:00:00Z',
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

/** el mismo dia civil, pero dicho a la 01:30 del viernes */
const ANCLA_MADRUGADA: TemporalAnchor = {
  instant: '2026-09-10T23:30:00Z',
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: ANCLA.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** un instante ISO escrito como hora de pared en Madrid */
function local(iso: string): string {
  const partes = new Map(FORMATO.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const numero = (tipo: Intl.DateTimeFormatPartTypes): number => Number(partes.get(tipo) ?? '0');
  const dos = (n: number): string => String(n).padStart(2, '0');
  // algunos entornos devuelven la hora 24 en vez de la 0 a medianoche
  return `${String(numero('year'))}-${dos(numero('month'))}-${dos(numero('day'))} ${dos(
    numero('hour') % 24,
  )}:${dos(numero('minute'))}`;
}

/** el rango resuelto, legible. Devuelve un texto tambien cuando no hay nada */
function rango(referencia: TemporalReference | null): string {
  if (referencia === null) return 'sin referencia';
  return `${local(referencia.from)} -> ${local(referencia.to)}`;
}

function resuelve(mensaje: string, anchor: TemporalAnchor = ANCLA): TemporalReference | null {
  return resolveTemporalReference(mensaje, anchor);
}

// -----------------------------------------------------------------------------

describe('el ancla de las pruebas', () => {
  it('el instante elegido es JUEVES en Madrid', () => {
    // si esto no fuera jueves, la mitad de las pruebas de abajo mentirian sin
    // fallar: comprobarian un calculo correcto contra un dia equivocado
    const diaSemana = new Intl.DateTimeFormat('en-US', {
      timeZone: ANCLA.timeZone,
      weekday: 'long',
    }).format(new Date(ANCLA.instant));

    expect(diaSemana).toBe('Thursday');
    expect(local(ANCLA.instant)).toBe('2026-09-10 17:00');
  });

  it('la zona horaria es un dato, no una suposicion', () => {
    // el mismo instante, dos husos: en Madrid son las 11:00 del jueves y en
    // Bogota las 04:00, que todavia pertenecen al dia civil del miercoles
    const bogota: TemporalAnchor = {
      instant: '2026-09-10T09:00:00Z',
      timeZone: 'America/Bogota',
      dayStartsAtHour: 5,
    };

    expect(civilDayLabel('2026-09-10T09:00:00Z', ANCLA)).toBe('2026-09-10');
    expect(civilDayLabel('2026-09-10T09:00:00Z', bogota)).toBe('2026-09-09');
  });
});

describe('el dia civil empieza a las cinco', () => {
  it('la 01:30 del viernes pertenece todavia al jueves', () => {
    // quien escribe a esa hora no ha dormido: sigue en la noche del jueves, y
    // fecharlo el viernes rompe cualquier pregunta posterior sobre «el jueves»
    expect(civilDay(new Date('2026-09-10T23:30:00Z'), ANCLA)).toEqual({
      year: 2026,
      month: 9,
      day: 10,
    });
  });

  it('el corte es limpio: a las 04:59 sigue siendo jueves y a las 05:00 ya es viernes', () => {
    expect(civilDayLabel('2026-09-11T02:59:00Z', ANCLA)).toBe('2026-09-10');
    expect(civilDayLabel('2026-09-11T03:00:00Z', ANCLA)).toBe('2026-09-11');
  });

  it('«esta noche» dicho a la 01:30 incluye el momento en que se dice', () => {
    // la noche que se esta viviendo no es «anoche»: empezo a las 20:00 del
    // jueves y no termina hasta las 05:00 del viernes
    const referencia = resuelve('esta noche estas rara', ANCLA_MADRUGADA);

    expect(rango(referencia)).toBe('2026-09-10 20:00 -> 2026-09-11 05:00');
    const desde = new Date(referencia?.from ?? 0).getTime();
    const hasta = new Date(referencia?.to ?? 0).getTime();
    const ahora = new Date(ANCLA_MADRUGADA.instant).getTime();
    expect(desde <= ahora && ahora < hasta).toBe(true);
  });

  it('«anoche» dicho de madrugada es la noche ANTERIOR, no la que sigue abierta', () => {
    // consecuencia directa de lo anterior: a la 01:30 del viernes, «anoche» es
    // la noche del miercoles al jueves
    expect(rango(resuelve('anoche me dijiste algo', ANCLA_MADRUGADA))).toBe(
      '2026-09-09 20:00 -> 2026-09-10 05:00',
    );
  });

  it('«hoy» dicho de madrugada sigue siendo el jueves', () => {
    expect(rango(resuelve('hoy has estado callada', ANCLA_MADRUGADA))).toBe(
      '2026-09-10 05:00 -> 2026-09-11 05:00',
    );
  });
});

describe('dias relativos', () => {
  it('«hoy» es el dia civil entero, de cinco a cinco', () => {
    const referencia = resuelve('de que hemos hablado hoy');
    expect(referencia?.kind).toBe('dia');
    expect(rango(referencia)).toBe('2026-09-10 05:00 -> 2026-09-11 05:00');
  });

  it('«ayer» es el miercoles', () => {
    expect(rango(resuelve('ayer me contaste una cosa'))).toBe(
      '2026-09-09 05:00 -> 2026-09-10 05:00',
    );
  });

  it('«anteayer» es el martes', () => {
    expect(rango(resuelve('anteayer estabas de mejor humor'))).toBe(
      '2026-09-08 05:00 -> 2026-09-09 05:00',
    );
  });

  it('«antes de ayer» no se lee como «ayer»', () => {
    // el orden de los patrones es lo unico que lo impide: «ayer» esta dentro
    const referencia = resuelve('antes de ayer hablamos de tu familia');
    expect(referencia?.matched).toBe('antes de ayer');
    expect(rango(referencia)).toBe('2026-09-08 05:00 -> 2026-09-09 05:00');
  });
});

describe('partes del dia', () => {
  it('«esta mañana» es de cinco a doce del jueves', () => {
    const referencia = resuelve('de que hablamos esta mañana');
    expect(referencia?.kind).toBe('parte-del-dia');
    expect(rango(referencia)).toBe('2026-09-10 05:00 -> 2026-09-10 12:00');
  });

  it('«esta tarde» es de tres a ocho', () => {
    expect(rango(resuelve('esta tarde te has puesto seria'))).toBe(
      '2026-09-10 15:00 -> 2026-09-10 20:00',
    );
  });

  it('«anoche» cruza la medianoche: de las ocho del miercoles a las cinco del jueves', () => {
    // una parte del dia que termina antes de empezar seria un rango vacio: la
    // noche se representa con horas mayores que 24 justo para evitarlo
    const referencia = resuelve('anoche me quede pensando');
    expect(referencia?.kind).toBe('parte-del-dia');
    expect(rango(referencia)).toBe('2026-09-09 20:00 -> 2026-09-10 05:00');
  });

  it('«ayer por la mañana» gana a «ayer» a secas', () => {
    const referencia = resuelve('ayer por la mañana estabas contenta');
    expect(referencia?.kind).toBe('parte-del-dia');
    expect(rango(referencia)).toBe('2026-09-09 05:00 -> 2026-09-09 12:00');
  });

  it('«hoy por la mañana» es media mañana, no el dia entero', () => {
    const referencia = resuelve('hoy por la mañana me escribiste');
    expect(referencia?.kind).toBe('parte-del-dia');
    expect(rango(referencia)).toBe('2026-09-10 05:00 -> 2026-09-10 12:00');
  });

  it('«mañana» es la parte del dia solo cuando lleva delante «esta» o «por la»', () => {
    // la palabra es ambigua en español y la ambiguedad se resuelve por el
    // acompañamiento: sola significa el dia siguiente, y del futuro no hay
    // recuerdos que traer
    expect(resuelve('esta mañana')?.kind).toBe('parte-del-dia');
    expect(resuelve('mañana hablamos')).toBeNull();
  });
});

describe('dias de la semana', () => {
  it('«el jueves» dicho EN jueves es HOY, no el jueves anterior', () => {
    // el caso que motivo el modulo. Si acierta hoy y se queria el de la semana
    // pasada, el indice enseña los dos; al reves se pierde la conversacion que
    // se esta teniendo, que es justo la que se preguntaba
    const referencia = resuelve('te acuerdas de lo que hablamos el jueves');
    expect(referencia?.kind).toBe('dia-de-la-semana');
    expect(referencia?.matched).toBe('el jueves');
    expect(rango(referencia)).toBe('2026-09-10 05:00 -> 2026-09-11 05:00');
  });

  it('«el jueves pasado» dicho en jueves SI es el de hace siete dias', () => {
    const referencia = resuelve('lo del jueves pasado me dolio');
    expect(rango(referencia)).toBe('2026-09-03 05:00 -> 2026-09-04 05:00');
  });

  it('«el pasado jueves» tambien retrocede una semana', () => {
    expect(rango(resuelve('el pasado jueves estabas rara'))).toBe(
      '2026-09-03 05:00 -> 2026-09-04 05:00',
    );
  });

  it.each([
    ['lunes', '2026-09-07', '2026-09-08'],
    ['martes', '2026-09-08', '2026-09-09'],
    ['miercoles', '2026-09-09', '2026-09-10'],
    ['jueves', '2026-09-10', '2026-09-11'],
    ['viernes', '2026-09-04', '2026-09-05'],
    ['sabado', '2026-09-05', '2026-09-06'],
    ['domingo', '2026-09-06', '2026-09-07'],
  ])('«el %s» es el %s, el mas reciente hacia atras', (nombre, desde, hasta) => {
    // siempre hacia atras y nunca mas de siete dias: un dia de la semana sin
    // mas contexto es el que acaba de pasar
    const referencia = resuelve(`que me contaste el ${nombre}`);
    expect(referencia?.kind).toBe('dia-de-la-semana');
    expect(rango(referencia)).toBe(`${desde} 05:00 -> ${hasta} 05:00`);
  });

  it('los acentos no cambian nada: «miércoles» y «sábado» se reconocen igual', () => {
    expect(rango(resuelve('lo que dijiste el miércoles'))).toBe(
      '2026-09-09 05:00 -> 2026-09-10 05:00',
    );
    expect(rango(resuelve('lo que dijiste el sábado'))).toBe(
      '2026-09-05 05:00 -> 2026-09-06 05:00',
    );
  });
});

describe('hace tanto tiempo', () => {
  it('«hace tres dias» admite un dia a cada lado', () => {
    // quien lo dice no tiene el calendario delante: exigir el dia exacto haria
    // fallar la busqueda justo cuando el recuerdo existe
    const referencia = resuelve('hace tres dias me prometiste una cosa');
    expect(referencia?.kind).toBe('hace-tiempo');
    expect(rango(referencia)).toBe('2026-09-06 05:00 -> 2026-09-09 05:00');
  });

  it('«hace dos semanas» cuenta catorce dias y cruza de mes', () => {
    expect(rango(resuelve('hace dos semanas hablamos de esto'))).toBe(
      '2026-08-26 05:00 -> 2026-08-29 05:00',
    );
  });

  it('el numero puede venir en cifras', () => {
    expect(rango(resuelve('hace 2 dias'))).toBe('2026-09-07 05:00 -> 2026-09-10 05:00');
  });

  it('«la semana pasada» es una semana entera, no un dia', () => {
    const referencia = resuelve('la semana pasada estuviste distinta');
    expect(referencia?.kind).toBe('semana');
    expect(referencia?.matched).toBe('la semana pasada');
    expect(rango(referencia)).toBe('2026-08-28 05:00 -> 2026-09-04 05:00');
  });
});

describe('el principio de todo', () => {
  it('«cuando nos conocimos» abre el rango hasta el origen', () => {
    // no hay fecha que calcular: quien llame decide cual es el episodio mas
    // antiguo, y por eso el rango llega hasta la epoca
    const referencia = resuelve('te acuerdas de cuando nos conocimos');
    expect(referencia?.kind).toBe('principio');
    expect(referencia?.from).toBe(new Date(0).toISOString());
    expect(referencia?.to).toBe('2026-09-10T15:00:00.000Z');
  });

  it('«el primer dia» es lo mismo', () => {
    expect(resuelve('cuentame el primer dia que hablamos')?.kind).toBe('principio');
  });

  it('«la primera vez que» y «cuando empezamos» tambien', () => {
    expect(resuelve('la primera vez que te vi')?.kind).toBe('principio');
    expect(resuelve('cuando empezamos con esto')?.kind).toBe('principio');
  });
});

describe('lo que no dispara', () => {
  it('un mensaje sin ninguna referencia temporal devuelve null', () => {
    expect(resuelve('te quiero mucho')).toBeNull();
    expect(resuelve('cuentame algo bonito')).toBeNull();
  });

  it('el futuro no se busca: «mañana hablamos» no tiene recuerdos', () => {
    expect(resuelve('mañana hablamos de eso')).toBeNull();
    expect(resuelve('nos vemos pasado mañana')).toBeNull();
  });

  it('un dia de la semana en FUTURO tampoco: «el proximo jueves» no es un recuerdo', () => {
    // esto fue una limitacion real y la encontro esta misma suite: el prefijo
    // «el proximo » lo consumia el patron de dias de la semana y el calculo
    // seguia hacia atras, asi que una frase de futuro acababa devolviendo el
    // jueves de hoy. Una referencia al futuro trayendo un recuerdo del pasado
    // es de los fallos que nadie se cree cuando los ve
    expect(resuelve('el proximo jueves te cuento')).toBeNull();
    expect(resuelve('el jueves que viene')).toBeNull();
    expect(resuelve('la proxima semana')).toBeNull();
  });

  it('LIMITACION CONOCIDA: dispara aunque la frase no pida ningun recuerdo', () => {
    // el modulo lee la referencia, no la intencion. Decidir si toca buscar es
    // de quien lo llama; aqui «hoy» es «hoy» aunque nadie pregunte nada
    expect(resuelve('hoy me duele la cabeza')?.kind).toBe('dia');
  });
});

describe('civilDayLabel', () => {
  it('las 23:30 de un jueves se fechan el jueves, no el viernes ni el miercoles', () => {
    // el indice cortaba el ISO con slice(0, 10), que es UTC: en España, en
    // horario de verano, eso desplaza la fecha de las conversaciones de noche
    expect(civilDayLabel('2026-09-10T21:30:00Z', ANCLA)).toBe('2026-09-10');
  });

  it('las 00:30 del viernes siguen fechandose el jueves', () => {
    expect(civilDayLabel('2026-09-10T22:30:00Z', ANCLA)).toBe('2026-09-10');
  });

  it('donde el corte en UTC se equivocaba, este acierta', () => {
    // 03:00 del jueves en Madrid: para el usuario es la madrugada del
    // miercoles, y el ISO en UTC decia jueves
    const iso = '2026-09-10T01:00:00Z';
    expect(iso.slice(0, 10)).toBe('2026-09-10');
    expect(civilDayLabel(iso, ANCLA)).toBe('2026-09-09');
  });

  it('el formato lleva siempre dos digitos', () => {
    const invierno: TemporalAnchor = { ...ANCLA, instant: '2026-01-05T12:00:00Z' };
    expect(civilDayLabel('2026-01-05T12:00:00Z', invierno)).toBe('2026-01-05');
  });
});
