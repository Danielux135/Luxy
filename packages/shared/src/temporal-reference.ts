// entender a que dia se refiere el usuario cuando dice «el jueves».
//
// PARA QUE EXISTE. La busqueda de recuerdos es lexica: encuentra por las
// palabras que se dijeron. Con eso, «¿te acuerdas de lo que hablamos el
// jueves?» no encuentra nada, porque «jueves» solo aparece si alguien lo
// escribio. Los episodios SI saben cuando ocurrieron —`startedAt`— y nadie
// usaba ese dato para buscar.
//
// SIN MODELO, a proposito. La pasarela cobra POR LLAMADA, asi que resolver la
// fecha con una llamada extra duplicaria el coste de cada mensaje que recuerde
// algo. Esto son patrones y aritmetica: cuesta cero y se prueba entero.
//
// EL RELOJ SE INYECTA, no se lee. Es la unica forma de probar «el jueves dicho
// en jueves» sin esperar a que sea jueves, y ademas la zona horaria tiene que
// ser un dato explicito: el mismo mensaje resuelto en Madrid y en Bogota da
// dias distintos.

/**
 * el momento desde el que se interpreta el mensaje.
 *
 * `dayStartsAtHour` NO es una curiosidad: el dia civil empieza a las 5 de la
 * mañana, no a medianoche. En una conversacion de pareja se habla de noche, y
 * un mensaje del viernes a la 01:30 pertenece coloquialmente a la NOCHE DEL
 * JUEVES. Con el corte en medianoche, «anoche» dicho a las dos de la madrugada
 * apunta al dia entero anterior e ignora la conversacion que se esta teniendo.
 */
export interface TemporalAnchor {
  /** instante actual en ISO */
  instant: string;
  /** zona IANA, por ejemplo `Europe/Madrid` */
  timeZone: string;
  /** hora local a la que empieza el dia civil */
  dayStartsAtHour: number;
}

/** a que se refirio, y con cuanta precision */
export interface TemporalReference {
  /** principio del rango, ISO */
  from: string;
  /** final del rango, ISO, exclusivo */
  to: string;
  /** que se reconocio, para poder explicarlo y para las pruebas */
  kind:
    | 'dia'
    | 'parte-del-dia'
    | 'dia-de-la-semana'
    | 'semana'
    | 'hace-tiempo'
    | 'principio';
  /** el trozo del mensaje que lo disparo */
  matched: string;
}

const DIA_MS = 24 * 60 * 60 * 1000;

const DIAS_SEMANA = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
] as const;

/** partes del dia, en horas locales sobre el dia civil */
const PARTES: Record<string, { desde: number; hasta: number }> = {
  madrugada: { desde: 0, hasta: 5 },
  mañana: { desde: 5, hasta: 12 },
  mediodia: { desde: 12, hasta: 15 },
  tarde: { desde: 15, hasta: 20 },
  noche: { desde: 20, hasta: 29 },
};

/** quita acentos y baja a minusculas, conservando la eñe */
function normaliza(texto: string): string {
  // un caracter que no puede aparecer en un mensaje escrito. Va construido y
  // no escrito literalmente: un caracter de control dentro del fuente es
  // invisible al leerlo y hace que git trate el archivo como binario
  const CENTINELA = String.fromCharCode(1);
  return texto
    .toLowerCase()
    .split('ñ')
    .join(CENTINELA)
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .split(CENTINELA)
    .join('ñ');
}

/** las partes locales de un instante, en la zona del ancla */
function partesLocales(
  instante: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const partes = Object.fromEntries(
    formato.formatToParts(instante).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(partes['year']),
    month: Number(partes['month']),
    day: Number(partes['day']),
    // a medianoche algunos entornos devuelven 24 en vez de 0
    hour: Number(partes['hour']) % 24,
    minute: Number(partes['minute']),
  };
}

/**
 * el instante en que empieza una hora local de un dia local dado.
 *
 * Se busca por aproximacion y se corrige, que es la forma de convertir de local
 * a UTC sin arrastrar una biblioteca de zonas: se parte de la estimacion sin
 * desfase y se ajusta con el desfase real que resulte. Aguanta los cambios de
 * hora, que es donde fallan las conversiones ingenuas.
 */
function instanteLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): Date {
  const supuesto = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  let candidato = new Date(supuesto);
  for (let vuelta = 0; vuelta < 3; vuelta += 1) {
    const local = partesLocales(candidato, timeZone);
    const comoUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const desfase = comoUtc - candidato.getTime();
    const corregido = supuesto - desfase;
    if (corregido === candidato.getTime()) break;
    candidato = new Date(corregido);
  }
  return candidato;
}

/**
 * el DIA CIVIL al que pertenece un instante.
 *
 * Antes de `dayStartsAtHour` se cuenta como el dia anterior: la madrugada del
 * viernes sigue siendo, para quien habla, la noche del jueves.
 */
export function civilDay(
  instante: Date,
  anchor: TemporalAnchor,
): { year: number; month: number; day: number } {
  const desplazado = new Date(instante.getTime() - anchor.dayStartsAtHour * 60 * 60 * 1000);
  const local = partesLocales(desplazado, anchor.timeZone);
  return { year: local.year, month: local.month, day: local.day };
}

/** el rango completo de un dia civil, desplazado `offset` dias */
function rangoDeDia(
  anchor: TemporalAnchor,
  offset: number,
): { from: Date; to: Date; base: { year: number; month: number; day: number } } {
  const hoy = civilDay(new Date(anchor.instant), anchor);
  const inicioHoy = instanteLocal(
    hoy.year,
    hoy.month,
    hoy.day,
    anchor.dayStartsAtHour,
    anchor.timeZone,
  );
  const from = new Date(inicioHoy.getTime() + offset * DIA_MS);
  const base = civilDay(new Date(from.getTime() + 60 * 60 * 1000), anchor);
  return { from, to: new Date(from.getTime() + DIA_MS), base };
}

/** el rango de una parte del dia civil desplazado `offset` dias */
function rangoDeParte(
  anchor: TemporalAnchor,
  offset: number,
  parte: string,
): { from: Date; to: Date } | null {
  const tramo = PARTES[parte];
  if (tramo === undefined) return null;
  const { base } = rangoDeDia(anchor, offset);
  const from = instanteLocal(base.year, base.month, base.day, tramo.desde, anchor.timeZone);
  // las horas por encima de 24 son la madrugada del dia siguiente: es como se
  // representa que la noche cruza la medianoche
  const to =
    tramo.hasta <= 24
      ? instanteLocal(base.year, base.month, base.day, tramo.hasta, anchor.timeZone)
      : new Date(
          instanteLocal(base.year, base.month, base.day, 24, anchor.timeZone).getTime() +
            (tramo.hasta - 24) * 60 * 60 * 1000,
        );
  return { from, to };
}

function referencia(
  rango: { from: Date; to: Date },
  kind: TemporalReference['kind'],
  matched: string,
): TemporalReference {
  return { from: rango.from.toISOString(), to: rango.to.toISOString(), kind, matched };
}

/**
 * lee una referencia temporal del mensaje, o `null` si no la hay.
 *
 * Devuelve `null` tambien para el FUTURO —«mañana hablamos»— porque no hay
 * ningun recuerdo que traer de ahi, y buscarlo solo produciria ruido.
 */
export function resolveTemporalReference(
  message: string,
  anchor: TemporalAnchor,
): TemporalReference | null {
  const texto = normaliza(message);

  // --- el principio de todo -------------------------------------------------
  // va primero porque es lo que mas se pide y no depende del calendario
  if (
    /\b(?:la primera vez que|el primer dia|cuando nos conocimos|cuando empezamos|al principio de todo)\b/u.test(
      texto,
    )
  ) {
    // sin rango: quien llame decide que es «el principio» mirando el episodio
    // mas antiguo. Se marca el tipo y se deja el rango abierto por delante
    const fin = new Date(anchor.instant);
    return {
      from: new Date(0).toISOString(),
      to: fin.toISOString(),
      kind: 'principio',
      matched: 'el principio',
    };
  }

  // --- partes del dia, con su dia ------------------------------------------
  // «anoche» antes que «noche» para que no gane la generica
  const partesFijas: [RegExp, number, string][] = [
    [/\banteanoche\b|\bantenoche\b/u, -2, 'noche'],
    [/\banoche\b|\bayer (?:por la )?noche\b|\bla noche de ayer\b/u, -1, 'noche'],
    [/\besta madrugada\b|\bde madrugada\b/u, 0, 'madrugada'],
    [/\besta mañana\b|\bhoy por la mañana\b/u, 0, 'mañana'],
    [/\beste mediodia\b|\ba mediodia\b/u, 0, 'mediodia'],
    [/\besta tarde\b|\bhoy por la tarde\b/u, 0, 'tarde'],
    [/\besta noche\b/u, 0, 'noche'],
    [/\bayer por la mañana\b/u, -1, 'mañana'],
    [/\bayer por la tarde\b/u, -1, 'tarde'],
  ];
  for (const [patron, offset, parte] of partesFijas) {
    const encontrado = patron.exec(texto);
    if (encontrado === null) continue;
    const rango = rangoDeParte(anchor, offset, parte);
    if (rango !== null) return referencia(rango, 'parte-del-dia', encontrado[0]);
  }

  // --- dias relativos -------------------------------------------------------
  const diasRelativos: [RegExp, number][] = [
    [/\banteayer\b|\bantes de ayer\b|\bantier\b/u, -2],
    [/\bayer\b/u, -1],
    [/\bhoy\b/u, 0],
  ];
  for (const [patron, offset] of diasRelativos) {
    const encontrado = patron.exec(texto);
    if (encontrado === null) continue;
    return referencia(rangoDeDia(anchor, offset), 'dia', encontrado[0]);
  }

  // --- «hace N dias / semanas» ---------------------------------------------
  const hace = /\bhace\s+(un|una|dos|tres|cuatro|cinco|seis|siete|\d{1,2})\s+(dias?|semanas?)\b/u.exec(
    texto,
  );
  if (hace !== null) {
    const palabras: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7 };
    const cuenta = palabras[hace[1] ?? ''] ?? Number(hace[1]);
    if (Number.isFinite(cuenta) && cuenta > 0) {
      const semanas = (hace[2] ?? '').startsWith('semana');
      const dias = semanas ? cuenta * 7 : cuenta;
      // difuso a proposito: quien dice «hace tres dias» no cuenta con el
      // calendario delante, asi que se admite un dia a cada lado
      const centro = rangoDeDia(anchor, -dias);
      return referencia(
        { from: new Date(centro.from.getTime() - DIA_MS), to: new Date(centro.to.getTime() + DIA_MS) },
        'hace-tiempo',
        hace[0],
      );
    }
  }

  // --- la semana pasada -----------------------------------------------------
  if (/\bla semana pasada\b|\bla pasada semana\b/u.test(texto)) {
    const inicio = rangoDeDia(anchor, -13);
    const fin = rangoDeDia(anchor, -7);
    return referencia({ from: inicio.from, to: fin.to }, 'semana', 'la semana pasada');
  }

  // --- dias de la semana ----------------------------------------------------
  // el FUTURO no trae recuerdos, y se descarta ANTES de resolver el dia: si no,
  // «el proximo jueves» se colaba por el prefijo del patron y acababa
  // resolviendo al jueves de hoy. Una referencia al futuro devolviendo un
  // recuerdo del pasado es de los fallos que nadie se cree cuando los ve
  if (/\b(?:proximo|proxima|que viene|siguiente)\b/u.test(texto)) return null;

  const dia = /\b(?:el |este |la )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(\s+pasado)?\b/u.exec(
    texto,
  );
  if (dia !== null) {
    const nombre = dia[1] ?? '';
    const quierePasado = dia[2] !== undefined || /\b(?:el )?pasado\s+/u.test(texto);
    const objetivo = DIAS_SEMANA.indexOf(nombre as (typeof DIAS_SEMANA)[number]);
    if (objetivo >= 0) {
      // el mediodia del dia civil: cualquier hora dentro del dia vale, y el
      // mediodia es la que no se cae por un cambio de hora
      const hoyBase = rangoDeDia(anchor, 0);
      const hoyDia = indiceDeDia(
        new Date(hoyBase.from.getTime() + 12 * 60 * 60 * 1000),
        anchor.timeZone,
      );
      // hacia atras: 0 significa HOY, y ese es el caso que mas importa.
      //
      // «el jueves» dicho en jueves gana HOY, no el jueves anterior. No es una
      // preferencia linguistica sino de asimetria del error: si acierta hoy y
      // se queria el anterior, el indice sigue enseñando los dos y el personaje
      // puede matizar; al reves se pierde la conversacion en curso, que es
      // justo la que se estaba pidiendo.
      let atras = (hoyDia - objetivo + 7) % 7;
      // «el jueves pasado» dicho en jueves NO es hoy: es el de hace siete dias
      if (quierePasado && atras === 0) atras = 7;
      return referencia(rangoDeDia(anchor, -atras), 'dia-de-la-semana', dia[0]);
    }
  }

  return null;
}

/** el indice 0-6 del dia de la semana en la zona indicada, con domingo en 0 */
function indiceDeDia(instante: Date, timeZone: string): number {
  const corto = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instante);
  const tabla: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return tabla[corto] ?? 0;
}

/**
 * el dia civil de un instante, en formato `AAAA-MM-DD` y en hora LOCAL.
 *
 * Existe porque el indice de recuerdos cortaba la fecha del ISO
 * (`startedAt.slice(0, 10)`), que es UTC. Con España en UTC+2, toda
 * conversacion entre las 22:00 y las 00:00 quedaba fechada el dia ANTERIOR: el
 * personaje contradecia una fecha que el usuario recuerda con certeza.
 */
export function civilDayLabel(iso: string, anchor: TemporalAnchor): string {
  const { year, month, day } = civilDay(new Date(iso), anchor);
  const dosDigitos = (n: number): string => String(n).padStart(2, '0');
  return `${String(year)}-${dosDigitos(month)}-${dosDigitos(day)}`;
}
