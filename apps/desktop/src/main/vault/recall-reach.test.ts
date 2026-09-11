// alcance de la memoria: mas alla del indice, el principio y los momentos de un
// mismo dia.
//
// Existe por la primera pasada del diagnostico sobre la boveda real: 40
// momentos con un tope de 40 lineas, y los tres caminos que transcriben solo
// miraban dentro de esas 40. Y «¿como nos conocimos?», que el modulo temporal
// reconocia, no lo recogia nadie.
//
// Las tablas de frases salen de DOS revisiones adversariales que las probaron
// contra el codigo: cada negativa es una frase que disparaba sin deber, y cada
// positiva una que no disparaba. Si se toca un patron, esta tabla es la que dice
// si se ha roto algo que ya funcionaba.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultService, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';
import { PrivateMemory } from './private-memory.js';
import type { CatalogedEpisode } from './catalog-store.js';
import type { Episode } from './episodes.js';
import { FALSOS_POSITIVOS } from './recall-falsos-positivos.fixture.js';
import {
  buildRecall,
  looksLikeConversationRecall,
  looksLikeMemoryRequest,
  looksLikeOriginQuestion,
  looksLikeOriginRecall,
  recallRoute,
} from './recall.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const LIA = '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d';

function memoryDeviceKeys(): DeviceKeyStore {
  let value: string | undefined;
  return {
    get: () => value,
    set: (next: string) => {
      value = next;
    },
    delete: () => {
      value = undefined;
    },
  };
}

const turn = (text: string, role: 'user' | 'assistant') => ({
  role,
  text,
  title: 'Conversacion',
  provider: 'deepseek',
  model: 'pro',
  inputTokens: null,
  outputTokens: null,
});

/** formas de preguntar por el principio: todas tienen que traerlo */
const PREGUNTAS_DEL_PRINCIPIO = [
  '¿cómo nos conocimos?',
  '¿te acuerdas de cómo nos conocimos?',
  '¿te acuerdas de cuándo nos conocimos?',
  '¿te acuerdas del día que nos conocimos?',
  '¿te acuerdas del día en que nos conocimos?',
  '¿cómo fue que nos conocimos?',
  '¿dónde te conocí?',
  '¿nos conocimos en la playa, verdad?',
  'y cómo nos conocimos, eh?',
  'oye como nos conocimos',
  'como nos  conocimos?',
  'cuéntame cómo nos conocimos',
  'dime como nos conocimos 🥺',
  'me cuentas cómo nos conocimos',
  'cómo nos conocimos, cuéntamelo',
  'vuelve a contarme cómo nos conocimos',
  'quiero que me cuentes cómo nos conocimos',
  '¿te acuerdas del primer día?',
  '¿te acuerdas del primer día…?',
  '¿te acuerdas del primer día amor?',
  'te acuerdas del primer dia jajaja',
  '¿te acuerdas del primer día 🥺',
  'oye, el primer día ¿te acuerdas?',
  '¿te acuerdas del primer día de todos?',
  '¿te acuerdas del primer día de nuestra relación?',
  '¿te acuerdas del primer día que hablamos?',
  '¿te acuerdas del primer día que nos vimos?',
  '¿qué te dije el primer día que hablamos?',
  '¿recuerdas la primera vez que hablamos?',
  '¿recuerdas la primera vez que hablamos tú y yo?',
  '¿recuerdas la primera vez que hablamos amor?',
  '¿te acuerdas de la primera vez que hablamos 🥺?',
  '¿recuerdas la primera vez que hablamos *se sonroja*?',
  '¿te acuerdas de cuando nos vimos por primera vez?',
  '¿dónde nos vimos por primera vez?',
  '¿te acuerdas de cuando empezamos?',
  '¿te acuerdas de cuando empezamos amor?',
  '¿te acuerdas de cuando empezamos a salir?',
  '¿recuerdas cuando empezamos a hablar?',
  '¿cómo empezó todo?',
  'Llevo toda la semana pensando en cuando nos conocimos. ¿Te acuerdas de dónde nos conocimos?',
  'Hoy es el aniversario del primer día. ¿Te acuerdas del primer día?',
  '¿Te acuerdas? Del día que nos conocimos.',
];

/** nombran el principio o una primera vez, pero NO preguntan por el */
const NO_PREGUNTAN_POR_EL_PRINCIPIO = [
  // lo cuentan, o cuentan algo a partir de el
  'desde que nos conocimos, ¿sabes?',
  'desde el primer día supe que me gustabas',
  'nos conocimos hace poco',
  'me encanta cómo nos conocimos, ¿a ti no?',
  'Desde que te conocí no duermo bien, ¿qué me has hecho?',
  'desde que nos conocimos pienso en ti, ¿quieres ser mi novia?',
  '¿sabes que desde que te conocí soy más feliz?',
  '¿sabías que desde que nos conocimos no he dejado de pensar en ti?',
  'desde que nos conocimos te quiero, ¿lo sabías?',
  'Desde que nos conocimos, ¿me has echado de menos alguna vez?',
  'desde que nos conocimos ¿sabes lo que pienso?',
  'desde el primer día hubo química, ¿no?',
  'dime que me quieres desde que nos conocimos',
  'cuéntame qué tal tu día, desde que nos conocimos no paro de pensar en ti',
  // preguntan por algo POSTERIOR al principio
  '¿te acuerdas de lo que me regalaste al mes de conocernos?',
  '¿te acuerdas del regalo que me hiciste después de que nos conocimos?',
  '¿te acuerdas de lo que pasó a los dos días de conocernos?',
  // la pregunta es de OTRA oracion
  'nos conocimos en un bar. ¿Quieres un café?',
  // el primer dia o la primera vez de OTRA cosa
  '¿Qué tal el primer día?',
  '*le quita la chaqueta* ¿Cómo te fue el primer día?',
  '¿nerviosa por el primer día?',
  'mañana empiezo en el curro nuevo, ¿estarás nerviosa el primer día?',
  'mañana es el primer día que libro, ¿quedamos?',
  '¿te acuerdas del primer día que fuimos a la playa?',
  '¿te acuerdas del primer día del viaje?',
  '¿te acuerdas del primer día en el trabajo nuevo?',
  '¿te acuerdas del primer día de clase?',
  '¿te acuerdas de la primera vez que hablamos de mudarnos?',
  '¿recuerdas la primera vez que te vi llorar?',
  'la primera vez que me besaste',
  // empezar OTRA cosa
  '¿cuándo empezamos?',
  '¿cuándo empezamos la peli?',
  'Vale, sacamos las cartas. Dime, ¿cómo empezamos?',
  'al principio no me gustaba',
];

describe('reconocer que se PREGUNTA por el principio', () => {
  it('todas las formas corrientes de preguntarlo', () => {
    for (const frase of PREGUNTAS_DEL_PRINCIPIO) {
      expect(looksLikeOriginQuestion(frase), frase).toBe(true);
    }
  });

  it('nombrarlo, contarlo o preguntar por otra cosa no lo pide', () => {
    for (const frase of NO_PREGUNTAN_POR_EL_PRINCIPIO) {
      expect(looksLikeOriginQuestion(frase), frase).toBe(false);
    }
  });

  it('la primera vez o el primer dia de OTRA cosa ni siquiera nombra el principio', () => {
    for (const frase of [
      'la primera vez que me besaste',
      'el primer día de trabajo fue horrible',
      '¿te acuerdas del primer día de clase?',
      '¿te acuerdas del primer día del viaje?',
      '¿te acuerdas de la primera vez que hablamos de mudarnos?',
      '¿recuerdas la primera vez que te vi llorar?',
      '¿cuándo empezamos la peli?',
    ]) {
      expect(looksLikeOriginRecall(frase), frase).toBe(false);
    }
  });
});

describe('la caza de falsos positivos: frases que NO piden recordar', () => {
  // dos momentos por dia, del 1 al 10 de septiembre: cualquier fecha que nombre
  // una frase tiene algo que traer, asi que si no dispara es por la frase
  const EPISODIOS: Episode[] = Array.from({ length: 10 }, (_v, i) => String(i + 1).padStart(2, '0'))
    .flatMap((dia) => [
      {
        conversationId: `c${dia}a`,
        from: 1,
        to: 6,
        startedAt: `2026-09-${dia}T08:00:00Z`,
        endedAt: `2026-09-${dia}T09:00:00Z`,
        turns: 6,
        title: 'por la mañana',
      },
      {
        conversationId: `c${dia}b`,
        from: 1,
        to: 6,
        startedAt: `2026-09-${dia}T19:00:00Z`,
        endedAt: `2026-09-${dia}T20:00:00Z`,
        turns: 6,
        title: 'por la noche',
      },
    ])
    .reverse();
  const ANCLA = {
    instant: '2026-09-11T10:00:00Z',
    timeZone: 'Europe/Madrid',
    dayStartsAtHour: 5,
  };

  it('la tabla sigue entera: no se quita una frase para que pase', () => {
    expect(FALSOS_POSITIVOS.length).toBeGreaterThanOrEqual(140);
  });

  it.each(FALSOS_POSITIVOS)('«$mensaje» ($estilo, antes por $camino)', ({ mensaje }) => {
    expect(recallRoute(EPISODIOS, mensaje, ANCLA, undefined).kind).toBe('ninguno');
  });
});

describe('pedir un recuerdo, y preguntar por lo vivido', () => {
  it('«el primer dia» o «la primera vez» contados no piden recordar nada', () => {
    for (const frase of [
      'desde el primer día supe que me gustabas',
      'la primera vez que fui a París me perdí',
      '¿Qué tal el primer día?',
    ]) {
      expect(looksLikeMemoryRequest(frase), frase).toBe(false);
    }
  });

  it('preguntar por lo que hicisteis o hablasteis es preguntar por lo vivido', () => {
    for (const frase of [
      '¿qué hicimos ayer?',
      '¿qué nos pasó ayer?',
      '¿de qué estábamos hablando anoche?',
      '¿qué me contabas anoche?',
      '¿qué me decías ayer?',
    ]) {
      expect(looksLikeConversationRecall(frase), frase).toBe(true);
    }
  });

  it('empezar a contar algo no es preguntar por lo vivido', () => {
    for (const frase of [
      'ayer estuve con mi madre y no sabes lo que pasó',
      '¿a que no sabes qué pasó ayer?',
      'no sabes lo que hicimos ayer mis amigos y yo',
      'mira lo que pasó ayer, flipas',
      'hoy me pasó algo raro',
    ]) {
      expect(looksLikeConversationRecall(frase), frase).toBe(false);
    }
  });
});

describe('mas alla del indice, el principio y los momentos de un mismo dia', () => {
  const PRIMERA = '44444444-4444-4444-8444-444444444444';
  const MERCADO = '55555555-5555-4555-8555-555555555555';
  const FARO = '66666666-6666-4666-8666-666666666666';
  const CAJA = '77777777-7777-4777-8777-777777777777';
  const DOMINGO = '88888888-8888-4888-8888-888888888888';
  const LARGA = '99999999-9999-4999-8999-999999999991';
  const DORMIDA = '99999999-9999-4999-8999-999999999992';
  // viernes 2026-09-11 a las 12:00 en Madrid: «ayer» es el jueves 10
  const ANCLA = {
    instant: '2026-09-11T10:00:00Z',
    timeZone: 'Europe/Madrid',
    dayStartsAtHour: 5,
  };

  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;
  let memory: PrivateMemory;

  const decir = (
    conversationId: string,
    text: string,
    role: 'user' | 'assistant',
    createdAt: string,
  ) => store.appendTurn(vault, conversationId, { ...turn(text, role), characterId: LIA, createdAt });

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-recall-alcance-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    store = new PrivateConversationStore(conversationsDirectory(directory));
    memory = new PrivateMemory(store);
    memory.attachTo(vault);

    // el primer dia de todos, el martes 1
    await decir(PRIMERA, 'hola, ¿eres nueva por aquí?', 'user', '2026-09-01T18:00:00Z');
    await decir(
      PRIMERA,
      'Acabo de llegar a la ciudad y me perdí buscando la estación.',
      'assistant',
      '2026-09-01T18:02:00Z',
    );
    // el sabado 5
    await decir(MERCADO, '¿vamos al mercado?', 'user', '2026-09-05T09:00:00Z');
    await decir(MERCADO, 'Compramos higos y una bufanda roja.', 'assistant', '2026-09-05T09:03:00Z');
    // dos momentos el jueves 10: uno corto por la mañana (10:00 en Madrid) y otro
    // mas largo por la tarde (18:00)
    await decir(FARO, 'buenos días', 'user', '2026-09-10T08:00:00Z');
    await decir(
      FARO,
      'Soñé con el faro de la costa, el de las luces verdes.',
      'assistant',
      '2026-09-10T08:05:00Z',
    );
    await decir(CAJA, 'te traje algo', 'user', '2026-09-10T16:00:00Z');
    await decir(
      CAJA,
      'Una caja de música con una bailarina que gira.',
      'assistant',
      '2026-09-10T16:02:00Z',
    );
    await decir(CAJA, 'me encanta verte sonreír', 'user', '2026-09-10T16:04:00Z');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const textos = (recall: Awaited<ReturnType<typeof buildRecall>>): string[] =>
    recall.quoted?.conversation.map((each) => each.text) ?? [];

  it('pasado el tope, el primero de todos sigue en las lineas y se dice cuantos faltan', async () => {
    const recall = await buildRecall(memory, vault, 'hola', {
      characterId: LIA,
      anchor: ANCLA,
      maxEpisodeLines: 2,
    });
    expect(recall.episodes.map((line) => line.title)).toEqual([
      'te traje algo',
      'hola, ¿eres nueva por aquí?',
    ]);
    expect(recall.omitted).toBe(2);
  });

  it('dentro del tope no hay hueco que avisar', async () => {
    const recall = await buildRecall(memory, vault, 'hola', { characterId: LIA, anchor: ANCLA });
    expect(recall.episodes).toHaveLength(4);
    expect(recall.omitted).toBeUndefined();
  });

  it('«¿cómo nos conocimos?» trae el primero aunque no este en las lineas', async () => {
    const recall = await buildRecall(memory, vault, '¿te acuerdas del día que nos conocimos?', {
      characterId: LIA,
      anchor: ANCLA,
      maxEpisodeLines: 1,
    });
    expect(recall.quoted?.via).toBe('principio');
    expect(recall.quoted?.listed).toBe(false);
    expect(recall.quoted?.when).toBe('tarde');
    expect(textos(recall)).toContain('Acabo de llegar a la ciudad y me perdí buscando la estación.');
  });

  it('pedirlo sin interrogacion tambien lo trae', async () => {
    const recall = await buildRecall(memory, vault, 'cuéntame cómo nos conocimos', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(recall.quoted?.via).toBe('principio');
  });

  it('contarlo no es preguntarlo: no transcribe NADA, ni siquiera por palabras', async () => {
    // un momento con las mismas palabras: si el camino por palabras se colara,
    // lo transcribiria. Antes esta prueba pasaba solo porque no habia ninguno
    await decir(DOMINGO, 'me gustabas desde antes, tonta', 'assistant', '2026-09-06T10:00:00Z');
    const recall = await buildRecall(memory, vault, 'desde el primer día supe que me gustabas', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(recall.quoted).toBeNull();
  });

  it('nombrar el principio sin preguntarlo no tapa otra peticion del mismo mensaje', async () => {
    const recall = await buildRecall(
      memory,
      vault,
      'desde que nos conocimos pienso en ti. ¿te acuerdas de los higos?',
      { characterId: LIA, anchor: ANCLA },
    );
    expect(recall.quoted?.via).toBe('palabras');
    expect(textos(recall)).toContain('Compramos higos y una bufanda roja.');
  });

  it('si el primero ya va en el prompt, no cita otro momento cualquiera', async () => {
    const recall = await buildRecall(memory, vault, '¿te acuerdas de cómo nos conocimos?', {
      characterId: LIA,
      anchor: ANCLA,
      alreadyInPrompt: { conversationId: PRIMERA, fromSequence: 0 },
    });
    expect(recall.quoted).toBeNull();
  });

  it('...pero una fecha en el mismo mensaje sigue valiendo', async () => {
    const recall = await buildRecall(
      memory,
      vault,
      '¿te acuerdas de cómo nos conocimos? ¿y de qué hablamos ayer?',
      {
        characterId: LIA,
        anchor: ANCLA,
        alreadyInPrompt: { conversationId: PRIMERA, fromSequence: 0 },
      },
    );
    expect(recall.quoted?.via).toBe('fecha');
  });

  it('la primera vez de OTRA cosa no trae el principio', async () => {
    const recall = await buildRecall(
      memory,
      vault,
      '¿te acuerdas de la primera vez que me regalaste algo?',
      { characterId: LIA, anchor: ANCLA },
    );
    expect(recall.quoted?.via).not.toBe('principio');
  });

  it('«¿cuándo empezamos?» es una pregunta corriente, no un recuerdo', async () => {
    const recall = await buildRecall(memory, vault, '¿cuándo empezamos?', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(recall.quoted).toBeNull();
  });

  it('por fecha alcanza un momento que no esta en las lineas', async () => {
    const recall = await buildRecall(memory, vault, '¿de qué hablamos el sábado?', {
      characterId: LIA,
      anchor: ANCLA,
      maxEpisodeLines: 1,
    });
    expect(recall.quoted?.via).toBe('fecha');
    expect(recall.quoted?.listed).toBe(false);
    expect(textos(recall)).toContain('Compramos higos y una bufanda roja.');
  });

  it('por palabras transcribe ALREDEDOR del turno que casa, no el principio del momento', async () => {
    // paso de verdad: el momento se encontro, pero se transcribian sus doce
    // primeros turnos y lo que se buscaba iba mas adelante. Ella no lo vio
    const LARGA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    for (let i = 0; i < 20; i += 1) {
      const texto = i === 17 ? 'Te lo debo desde lo del baño de la facultad.' : `turno de relleno ${i}`;
      const minuto = String(i).padStart(2, '0');
      await decir(LARGA, texto, i % 2 === 0 ? 'user' : 'assistant', `2026-09-08T10:${minuto}:00Z`);
    }

    const recall = await buildRecall(memory, vault, '¿te acuerdas de lo del baño de la facultad?', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(recall.quoted?.via).toBe('palabras');
    expect(textos(recall)).toContain('Te lo debo desde lo del baño de la facultad.');
    // con tres de contexto delante: el trozo empieza en el 15 de 20
    expect(recall.quoted?.excerpt).toEqual({ first: 15, last: 20, total: 20 });
  });

  it('por palabras alcanza un momento que no esta en las lineas', async () => {
    const recall = await buildRecall(memory, vault, '¿te acuerdas de los higos?', {
      characterId: LIA,
      anchor: ANCLA,
      maxEpisodeLines: 1,
    });
    expect(recall.quoted?.via).toBe('palabras');
    expect(recall.quoted?.listed).toBe(false);
    expect(textos(recall)).toContain('Compramos higos y una bufanda roja.');
  });

  it('«¿qué hicimos ayer?» tambien pregunta por lo vivido', async () => {
    const recall = await buildRecall(memory, vault, '¿qué hicimos ayer?', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(recall.quoted?.via).toBe('fecha');
    expect(recall.quoted?.listed).toBe(true);
  });

  it('«no sabes lo que pasó ayer» va a contar algo: no transcribe lo de ayer', async () => {
    const recall = await buildRecall(memory, vault, 'ayer estuve con mi madre y no sabes lo que pasó', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(recall.quoted).toBeNull();
  });

  it('de un dia con varios, sin mas pistas trae el mas largo y nombra los otros con su hora', async () => {
    const recall = await buildRecall(memory, vault, '¿de qué hablamos ayer?', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(textos(recall)).toContain('Una caja de música con una bailarina que gira.');
    expect(recall.quoted?.when).toBe('tarde');
    expect(recall.quoted?.sameDay).toEqual([{ title: 'buenos días', turns: 2, when: 'mañana' }]);
    expect(recall.quoted?.sameDayTotal).toBe(1);
    expect(recall.quoted?.pickedBy).toBe('mas-largo');
  });

  it('si el mensaje nombra algo de ese dia, trae ese aunque sea el corto', async () => {
    const recall = await buildRecall(
      memory,
      vault,
      '¿te acuerdas de lo del faro que hablamos ayer?',
      { characterId: LIA, anchor: ANCLA },
    );
    expect(textos(recall)).toContain('Soñé con el faro de la costa, el de las luces verdes.');
    expect(textos(recall)).not.toContain('Una caja de música con una bailarina que gira.');
    expect(recall.quoted?.pickedBy).toBe('palabras');
  });

  it('el momento de ayer dentro de una conversacion larga de varios dias tambien se encuentra', async () => {
    // el lunes nombra el faro de pasada; el jueves, en la MISMA conversacion y
    // mas de seis horas despues, habla de el en los dos turnos. Antes, los
    // turnos del lunes llenaban los resultados y el del jueves no llegaba
    await decir(LARGA, 'hola', 'user', '2026-09-07T10:00:00Z');
    await decir(LARGA, 'Hoy vi el faro desde lejos.', 'assistant', '2026-09-07T10:02:00Z');
    await decir(LARGA, '¿otra vez el faro?', 'user', '2026-09-10T12:00:00Z');
    await decir(
      LARGA,
      'El faro de noche es otra cosa, con sus luces.',
      'assistant',
      '2026-09-10T12:02:00Z',
    );

    const recall = await buildRecall(
      memory,
      vault,
      '¿te acuerdas de lo del faro que hablamos ayer?',
      { characterId: LIA, anchor: ANCLA },
    );
    expect(textos(recall)).toContain('El faro de noche es otra cosa, con sus luces.');
    expect(recall.quoted?.pickedBy).toBe('palabras');
  });

  it('las acciones, los apelativos, las risas y su nombre no eligen momento', async () => {
    // un momento corto el mismo dia que la nombra y lleva muletillas
    await decir(DORMIDA, '*Lía sonríe medio dormida*', 'user', '2026-09-10T21:00:00Z');
    await decir(DORMIDA, 'jajaj corazón, qué sueño', 'assistant', '2026-09-10T21:01:00Z');

    for (const frase of [
      'Lía, ¿de qué hablamos ayer?',
      '*te abrazo* ¿de qué hablamos ayer, corazón? jajaj',
    ]) {
      const recall = await buildRecall(memory, vault, frase, {
        characterId: LIA,
        anchor: ANCLA,
        ignoreWords: ['Lía'],
      });
      expect(textos(recall), frase).toContain('Una caja de música con una bailarina que gira.');
      expect(recall.quoted?.pickedBy, frase).toBe('mas-largo');
    }
  });

  it('lo que ya va en el prompt se salta y trae el otro momento de ese dia', async () => {
    const recall = await buildRecall(memory, vault, '¿de qué hablamos ayer?', {
      characterId: LIA,
      anchor: ANCLA,
      alreadyInPrompt: { conversationId: CAJA, fromSequence: 0 },
    });
    expect(textos(recall)).toContain('Soñé con el faro de la costa, el de las luces verdes.');
  });

  it('con un rango de varios dias, «ese mismo dia» no mezcla dias distintos', async () => {
    // el domingo 6, un dia despues del mercado: «hace cinco dias» abarca los dos
    await decir(DOMINGO, '¿paseamos por el río?', 'user', '2026-09-06T10:00:00Z');
    await decir(DOMINGO, 'Vimos patos y un barco pequeño.', 'assistant', '2026-09-06T10:03:00Z');
    await decir(DOMINGO, 'qué frío hacía', 'user', '2026-09-06T10:05:00Z');

    const recall = await buildRecall(memory, vault, '¿de qué hablamos hace cinco días?', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(recall.quoted?.via).toBe('fecha');
    expect(textos(recall)).toContain('Vimos patos y un barco pequeño.');
    expect(recall.quoted?.sameDay).toBeUndefined();
  });

  it('«ayer por la tarde» nombra tambien el de la mañana: ese mismo dia es el dia entero', async () => {
    const recall = await buildRecall(memory, vault, '¿de qué hablamos ayer por la tarde?', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(textos(recall)).toContain('Una caja de música con una bailarina que gira.');
    expect(recall.quoted?.sameDay?.map((other) => other.title)).toEqual(['buenos días']);
  });
});

describe('el primer momento lleva su resumen', () => {
  const PRIMERA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const OTRA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const ANCLA = {
    instant: '2026-09-11T10:00:00Z',
    timeZone: 'Europe/Madrid',
    dayStartsAtHour: 5,
  };

  let directory: string;

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const escena = (conversationId: string, title: string, summary: string): CatalogedEpisode => ({
    conversationId,
    // de sobra: cubre todos los turnos de la conversacion, empiece en 0 o en 1
    from: 0,
    to: 10,
    title,
    tags: ['prueba'],
    summary,
    model: 'codex',
    catalogedAt: '2026-09-11T00:00:00Z',
    turnsAtCatalog: 2,
  });

  it('la linea del primero dice de que fue; las demas no, que costaria tokens sin motivo', async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-recall-resumen-'));
    const vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    const store = new PrivateConversationStore(conversationsDirectory(directory));
    const decir = (id: string, text: string, role: 'user' | 'assistant', createdAt: string) =>
      store.appendTurn(vault, id, { ...turn(text, role), characterId: LIA, createdAt });

    await decir(PRIMERA, 'hola, ¿eres nueva por aquí?', 'user', '2026-09-01T18:00:00Z');
    await decir(PRIMERA, 'Me he perdido buscando la estación.', 'assistant', '2026-09-01T18:02:00Z');
    await decir(OTRA, 'buenos días', 'user', '2026-09-10T08:00:00Z');
    await decir(OTRA, 'Soñé con el faro.', 'assistant', '2026-09-10T08:02:00Z');

    const memory = new PrivateMemory(store, {
      catalog: async () => [
        escena(PRIMERA, 'se conocen en la estacion', 'ella se ha perdido y el la ayuda'),
        escena(OTRA, 'el sueño del faro', 'ella le cuenta un sueño'),
      ],
    });
    memory.attachTo(vault);

    const recall = await buildRecall(memory, vault, 'hola', { characterId: LIA, anchor: ANCLA });
    // del mas reciente al mas antiguo: el ultimo es el primero de todos
    expect(recall.episodes.map((line) => line.summary)).toEqual([
      undefined,
      'ella se ha perdido y el la ayuda',
    ]);
  });
});
