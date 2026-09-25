// el medidor de autocopia. Todo el texto es INVENTADO para la prueba: ni una
// frase sale de la boveda.
import { describe, it, expect } from 'vitest';
import {
  measureSelfCopy,
  normalizeForCopy,
  selfCopyReferences,
  SELF_COPY_EDGE_WORDS,
  SELF_COPY_NGRAM,
  type SelfCopyTurn,
} from './self-copy.js';
import { composeVaultPrompt } from './vault-prompt.js';

/** n palabras distintas entre si y de cualquier otra llamada con otro prefijo */
function palabras(prefijo: string, cuantas: number): string {
  return Array.from({ length: cuantas }, (_, i) => `${prefijo}${String(i)}`).join(' ');
}

describe('normalizeForCopy', () => {
  it('quita tildes y mayusculas', () => {
    expect(normalizeForCopy('Él Está AQUÍ, Canción')).toEqual(['el', 'esta', 'aqui', 'cancion']);
  });

  it('la puntuacion de acotacion y dialogo solo separa palabras', () => {
    expect(normalizeForCopy('*se sienta en la silla* «¿Vienes?» ¡Claro!... —dijo_ella 🙂')).toEqual(
      ['se', 'sienta', 'en', 'la', 'silla', 'vienes', 'claro', 'dijo', 'ella'],
    );
  });

  it('colapsa saltos de linea y espacios', () => {
    expect(normalizeForCopy('  hola\n\n  mundo\r\n\tazul  ')).toEqual(['hola', 'mundo', 'azul']);
  });

  it('da lo mismo en NFC que en NFD', () => {
    const nfc = 'canción de mañana';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(normalizeForCopy(nfd)).toEqual(normalizeForCopy(nfc));
  });

  it('conserva la ñ, tambien en mayuscula o descompuesta', () => {
    expect(normalizeForCopy('AÑO año año')).toEqual(['año', 'año', 'año']);
    expect(normalizeForCopy('año')).not.toEqual(normalizeForCopy('ano'));
  });

  it('conserva las cifras', () => {
    expect(normalizeForCopy('a las 10:30')).toEqual(['a', 'las', '10', '30']);
  });
});

describe('measureSelfCopy', () => {
  it('una copia entera lo cuenta todo', () => {
    const texto = palabras('w', 20);
    const medida = measureSelfCopy({ reply: texto, window: [texto], control: [] });
    expect(medida).toEqual({
      ngrams: 15,
      window: { replies: 1, copied: 15, longestRun: 20, openings: 1, closings: 1 },
      control: null,
      windowOnly: null,
    });
  });

  it('diez palabras copiadas en medio: cinco grupos y ni apertura ni cierre', () => {
    const copiado = palabras('c', 10);
    const reply = `${palabras('a', 15)} ${copiado} ${palabras('b', 15)}`;
    const anterior = `${palabras('x', 15)} ${copiado} ${palabras('y', 15)}`;
    const medida = measureSelfCopy({ reply, window: [anterior], control: [] });
    expect(medida?.ngrams).toBe(35);
    expect(medida?.window).toEqual({
      replies: 1,
      copied: 5,
      longestRun: 10,
      openings: 0,
      closings: 0,
    });
  });

  it('sin nada en comun, ceros', () => {
    const medida = measureSelfCopy({
      reply: palabras('a', 30),
      window: [palabras('b', 30), palabras('c', 10)],
      control: [palabras('d', 30)],
    });
    expect(medida?.window).toEqual({
      replies: 2,
      copied: 0,
      longestRun: 0,
      openings: 0,
      closings: 0,
    });
    expect(medida?.control).toEqual({
      replies: 1,
      copied: 0,
      longestRun: 0,
      openings: 0,
      closings: 0,
    });
  });

  it('ve la plantilla: misma apertura y mismo cierre con el centro distinto', () => {
    const apertura = 'se queda callada un momento mientras le tiemblan las manos';
    const cierre = 'y se queda mirandote esperando lo que vas a decir';
    const reply = `*${apertura}* ${palabras('nuevo', 25)} *${cierre}*`;
    const medida = measureSelfCopy({
      reply,
      window: [
        `*${apertura}* ${palabras('viejo', 25)} *${cierre}*`,
        // otra con la misma apertura, sin el cierre
        `*${apertura.toUpperCase()}...* ${palabras('otro', 30)}`,
        palabras('nada', 30),
      ],
      control: [],
    });
    expect(medida?.window.openings).toBe(2);
    expect(medida?.window.closings).toBe(1);
    expect(medida?.window.replies).toBe(3);
    // las diez palabras de la apertura dan cinco grupos, y lo mismo el cierre
    expect(medida?.window.copied).toBe(10);
    expect(medida?.window.longestRun).toBe(10);
  });

  // el punto ciego que `D-102` advierte: la nota de forma pide cambiar frases y
  // gestos, y una plantilla rehecha con sinonimos no deja ni un grupo. Si un dia
  // esta prueba falla porque el medidor ya lo ve, hay que reescribir la
  // advertencia, no borrar la prueba.
  it('NO ve la plantilla rehecha con otras palabras: da lo mismo que sin copia', () => {
    const anterior = [
      '*Se queda en silencio un momento, sintiendo como tus palabras le recorren el cuerpo entero.*',
      'Hoy ha llovido toda la tarde y el piso huele a cafe.',
      '*Hace una pausa, se muerde el labio inferior y baja la mirada un segundo.*',
      'Sigue, carino, no te pares ahora.',
      '*Espera tu respuesta con el corazon acelerado y una sonrisa en los labios.*',
    ].join('\n');
    const parafrasis = [
      '*Calla un instante, notando como lo que dices le baja por todo el cuerpo.*',
      'Deja la taza sobre la mesa y se acerca a la ventana.',
      '*Se detiene, se muerde el labio y aparta los ojos un momento.*',
      'Continua, carino, no pares.',
      '*Aguarda tu respuesta con el pulso a mil y sonriendo.*',
    ].join('\n');
    const libre = [
      '*Suelta una carcajada y te tira un cojin a la cara.*',
      'Pues mira, esta noche no salimos, que llueve y estoy a gusto en casa contigo.',
      'Manana te llevo al mercado de los domingos, ya lo he decidido yo.',
      '*Coge las llaves y se las mete en el bolsillo sin darte opcion.*',
    ].join('\n');
    const ventana = [anterior, anterior, anterior];
    const medidaParafrasis = measureSelfCopy({ reply: parafrasis, window: ventana, control: [] });
    const medidaLibre = measureSelfCopy({ reply: libre, window: ventana, control: [] });
    for (const medida of [medidaParafrasis, medidaLibre]) {
      expect(medida?.window.copied).toBe(0);
      expect(medida?.window.openings).toBe(0);
      expect(medida?.window.closings).toBe(0);
    }
    // la racha es lo unico que se mueve, y queda por debajo de un grupo: un
    // indicio que cualquier par de textos puede dar, no una prueba
    expect(medidaParafrasis?.window.longestRun).toBeGreaterThan(
      medidaLibre?.window.longestRun ?? 0,
    );
    expect(medidaParafrasis?.window.longestRun).toBeLessThan(SELF_COPY_NGRAM);
  });

  it('una copia que solo se ve normalizando', () => {
    const anterior =
      '*Se rie bajito, casi sin querer.* ¿De verdad crees que me pongo roja tan facil?';
    const reply = 'se RÍE bajito casi sin querer... de verdad crees que me pongo roja tan fácil';
    const medida = measureSelfCopy({ reply, window: [anterior], control: [] });
    const palabrasReply = normalizeForCopy(reply).length;
    expect(medida?.window.copied).toBe(palabrasReply - SELF_COPY_NGRAM + 1);
    expect(medida?.window.longestRun).toBe(palabrasReply);
  });

  it('una respuesta mas corta que un grupo da null sin lanzar', () => {
    expect(
      measureSelfCopy({
        reply: 'uno dos tres cuatro cinco',
        window: ['uno dos tres'],
        control: [],
      }),
    ).toBeNull();
    expect(measureSelfCopy({ reply: '*...*', window: [], control: [] })).toBeNull();
  });

  it('una referencia corta cuenta como respuesta pero no aporta grupos', () => {
    const reply = palabras('a', 12);
    const corta = palabras('a', 4);
    const medida = measureSelfCopy({ reply, window: [corta], control: [] });
    expect(medida?.window.replies).toBe(1);
    expect(medida?.window.copied).toBe(0);
    expect(medida?.window.openings).toBe(0);
    // la tirada si se ve, aunque no llegue a un grupo: es la cifra continua
    expect(medida?.window.longestRun).toBe(4);
  });

  it('con la ventana vacia mide cero y con el control vacio lo deja en null', () => {
    const medida = measureSelfCopy({ reply: palabras('a', 10), window: [], control: [] });
    expect(medida).toEqual({
      ngrams: 5,
      window: { replies: 0, copied: 0, longestRun: 0, openings: 0, closings: 0 },
      control: null,
      windowOnly: null,
    });
  });

  it('ventana y control se miden por separado, sean del tamaño que sean', () => {
    const copiado = palabras('c', 8);
    const reply = `${palabras('a', 20)} ${copiado}`;
    const medida = measureSelfCopy({
      reply,
      window: [palabras('v', 20)],
      control: [palabras('k', 20), `${copiado} ${palabras('z', 3)}`, palabras('m', 9)],
    });
    expect(medida?.window).toMatchObject({ replies: 1, copied: 0 });
    expect(medida?.control).toMatchObject({ replies: 3, copied: 3, longestRun: 8 });

    const alReves = measureSelfCopy({
      reply,
      window: [palabras('v', 20), `${copiado} ${palabras('z', 3)}`],
      control: [palabras('k', 20)],
    });
    expect(alReves?.window).toMatchObject({ replies: 2, copied: 3, longestRun: 8 });
    expect(alReves?.control).toMatchObject({ replies: 1, copied: 0 });
  });

  // la autocopia observada va en cadena: la plantilla ya estaba en las de antes
  describe('la copia en cadena y el control', () => {
    const apertura = palabras('ap', 10);
    const cierre = palabras('ci', 10);
    const conPlantilla = (cuerpo: string): string => `${apertura} ${cuerpo} ${cierre}`;
    const ventana = [1, 2, 3, 4].map((i) => conPlantilla(palabras(`v${String(i)}x`, 20)));
    const control = [1, 2, 3, 4].map((i) => conPlantilla(palabras(`k${String(i)}x`, 20)));

    it('con la plantilla asentada la ventana la ve entera aunque el control de lo mismo', () => {
      const medida = measureSelfCopy({
        reply: conPlantilla(palabras('nuevo', 20)),
        window: ventana,
        control,
      });
      // la cifra principal: diez de treinta y cinco grupos son copia
      expect(medida?.ngrams).toBe(35);
      expect(medida?.window).toMatchObject({ copied: 10, openings: 4, closings: 4 });
      // restar el control daria cero, que es justo lo que NO hay que leer
      expect(medida?.control).toMatchObject({ copied: 10, openings: 4, closings: 4 });
      // lo copiado es plantilla vieja, nada reciente
      expect(medida?.windowOnly).toBe(0);
    });

    it('separa la copia reciente de la plantilla que ya venia de antes', () => {
      const reciente = palabras('rc', 8);
      const medida = measureSelfCopy({
        reply: conPlantilla(`${palabras('na', 10)} ${reciente} ${palabras('nb', 10)}`),
        window: [
          ...ventana.slice(0, 3),
          conPlantilla(`${palabras('ya', 10)} ${reciente} ${palabras('yb', 10)}`),
        ],
        control,
      });
      // cinco de la apertura, cinco del cierre y tres de lo reciente
      expect(medida?.window.copied).toBe(13);
      expect(medida?.control?.copied).toBe(10);
      expect(medida?.windowOnly).toBe(3);
      // en los dos lados: la plantilla
      expect((medida?.window.copied ?? 0) - (medida?.windowOnly ?? 0)).toBe(10);
    });

    it('lo que solo esta en el control no cuenta como reciente', () => {
      const medida = measureSelfCopy({
        reply: conPlantilla(palabras('nuevo', 20)),
        window: [palabras('libre', 40)],
        control,
      });
      expect(medida?.window.copied).toBe(0);
      expect(medida?.control?.copied).toBe(10);
      expect(medida?.windowOnly).toBe(0);
    });

    it('sin control no separa nada: null, no la copia de la ventana repetida', () => {
      const medida = measureSelfCopy({
        reply: conPlantilla(palabras('nuevo', 20)),
        window: ventana,
        control: [],
      });
      expect(medida?.window.copied).toBe(10);
      expect(medida?.windowOnly).toBeNull();
    });
  });

  it('un grupo repetido dentro de la respuesta cuenta en cada posicion', () => {
    const grupo = palabras('g', SELF_COPY_NGRAM);
    const reply = `${grupo} ${palabras('a', 10)} ${grupo}`;
    const medida = measureSelfCopy({ reply, window: [grupo], control: [] });
    expect(medida?.window.copied).toBe(2);
  });

  it('las opciones cambian el tamaño de grupo y del borde', () => {
    const reply = `${palabras('p', 3)} ${palabras('a', 20)}`;
    const anterior = `${palabras('p', 3)} ${palabras('b', 20)}`;
    expect(measureSelfCopy({ reply, window: [anterior], control: [] })?.window.openings).toBe(0);
    expect(
      measureSelfCopy({ reply, window: [anterior], control: [] }, { n: 3, edgeWords: 5 })?.window
        .openings,
    ).toBe(1);
  });

  it('rechaza opciones que medirian otra cosa', () => {
    const input = { reply: palabras('a', 20), window: [], control: [] };
    expect(() => measureSelfCopy(input, { n: 0 })).toThrow(RangeError);
    expect(() => measureSelfCopy(input, { n: 2.5 })).toThrow(RangeError);
    expect(() => measureSelfCopy(input, { n: 6, edgeWords: 5 })).toThrow(RangeError);
  });

  it('el borde por defecto es mayor que el grupo', () => {
    expect(SELF_COPY_EDGE_WORDS).toBeGreaterThanOrEqual(SELF_COPY_NGRAM);
  });

  it('no toca lo que recibe', () => {
    const window = [palabras('a', 10)];
    const control = [palabras('b', 10)];
    const input = { reply: palabras('a', 10), window, control };
    const copia = structuredClone(input);
    measureSelfCopy(input);
    expect(input).toEqual(copia);
  });
});

/** historial alterno usuario/asistente, con textos distinguibles */
function historial(turnos: number): SelfCopyTurn[] {
  return Array.from({ length: turnos }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text:
      i % 2 === 0 ? `mensaje de el numero ${String(i)}` : `respuesta de ella numero ${String(i)}`,
  }));
}

describe('selfCopyReferences', () => {
  it('con veinte turnos y una cola de ocho: cuatro en la ventana y las cuatro de antes', () => {
    const refs = selfCopyReferences(historial(20), 8, []);
    expect(refs.window).toEqual(
      [13, 15, 17, 19].map((i) => `respuesta de ella numero ${String(i)}`),
    );
    expect(refs.control).toEqual([5, 7, 9, 11].map((i) => `respuesta de ella numero ${String(i)}`));
    expect(refs.excluded).toBe(0);
  });

  it('con poco historial el control se queda corto o vacio', () => {
    const corto = selfCopyReferences(historial(10), 8, []);
    expect(corto.window).toHaveLength(4);
    expect(corto.control).toEqual(['respuesta de ella numero 1']);

    const entero = selfCopyReferences(historial(6), 8, []);
    expect(entero.window).toHaveLength(3);
    expect(entero.control).toEqual([]);
  });

  it('una cola de cero no deja nada en la ventana, igual que el compositor', () => {
    expect(selfCopyReferences(historial(20), 0, [])).toEqual({
      window: [],
      control: [],
      excluded: 0,
    });
  });

  it('salta del control lo que viaja citado, y lo cuenta', () => {
    const turnos = historial(20);
    // la cita puede llegar con otra puntuacion o mayusculas: se compara normalizada
    const refs = selfCopyReferences(turnos, 8, ['RESPUESTA de ella, numero 9...', '*...*']);
    expect(refs.excluded).toBe(1);
    expect(refs.control).toEqual([3, 5, 7, 11].map((i) => `respuesta de ella numero ${String(i)}`));
    // la ventana viaja entera de todas formas: no se aparta nada de ella
    expect(refs.window).toHaveLength(4);
  });

  it('no toca el historial que recibe', () => {
    const turnos = historial(20);
    const copia = structuredClone(turnos);
    selfCopyReferences(turnos, 8, ['respuesta de ella numero 9']);
    expect(turnos).toEqual(copia);
  });

  // si alguien cambia la cola del compositor, la ventana del medidor tiene que
  // cambiar con ella: si no, se mediria la copia contra algo que no viajaba
  it('la ventana es exactamente lo que el prompt manda como «Asistente:»', () => {
    for (const total of [0, 1, 5, 8, 9, 20]) {
      for (const recent of [0, 3, 8]) {
        const turns = historial(total);
        const bloques = composeVaultPrompt({
          memory: null,
          turns,
          message: 'mensaje nuevo',
          recentTurns: recent,
        });
        const recientes = bloques.find((bloque) => bloque.label === 'turnos-recientes');
        const enPrompt = (recientes?.text ?? '')
          .split('\n')
          .filter((linea) => linea.startsWith('Asistente: '))
          .map((linea) => linea.slice('Asistente: '.length));
        expect(selfCopyReferences(turns, recent, []).window).toEqual(enPrompt);
      }
    }
  });
});
