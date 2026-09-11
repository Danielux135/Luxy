// pruebas de que recuerda el personaje en un turno.
//
// Contra una boveda de verdad, porque lo que se comprueba es el reparto entre
// los dos niveles: que las lineas van siempre y que la transcripcion solo
// aparece cuando se ha pedido rememorar.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultService, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';
import { PrivateMemory } from './private-memory.js';
import { buildRecall, looksLikeConversationRecall, looksLikeMemoryRequest } from './recall.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';
const LIA = '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d';
const OTRO = '99999999-9999-4999-8999-999999999999';

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

const turn = (text: string, role: 'user' | 'assistant' = 'user') => ({
  role,
  text,
  title: 'Conversacion',
  provider: 'deepseek',
  model: 'pro',
  inputTokens: null,
  outputTokens: null,
});

describe('reconocer que se pide rememorar', () => {
  it('reconoce las formas normales de preguntarlo', () => {
    for (const frase of [
      '¿te acuerdas de cuando nos conocimos?',
      'recuerdas lo de la vainilla',
      '¿qué te dije aquella noche?',
      'acuérdate de lo que hablamos',
      'cómo empezó todo esto',
      'la primera vez que hablamos',
    ]) {
      expect(looksLikeMemoryRequest(frase)).toBe(true);
    }
  });

  it('mirar al pasado NO es pedir un recuerdo', () => {
    // «ayer trabaje mucho» habla del pasado y no interpela a su memoria:
    // transcribir un episodio ahi seria meter historial sin que nadie lo pida
    for (const frase of [
      'ayer trabajé muchísimo, qué cansancio',
      'hoy he estado pensando en ti',
      'me gusta cómo hueles',
      '*le abrazo*',
    ]) {
      expect(looksLikeMemoryRequest(frase)).toBe(false);
    }
  });

  it('las tildes no cambian nada', () => {
    expect(looksLikeMemoryRequest('¿TE ACUERDAS?')).toBe(true);
    expect(looksLikeMemoryRequest('te acuerdas')).toBe(true);
  });
});

describe('lo que recuerda en un turno', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;
  let memory: PrivateMemory;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-recall-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    store = new PrivateConversationStore(conversationsDirectory(directory));
    memory = new PrivateMemory(store);
    memory.attachTo(vault);

    await store.appendTurn(vault, A, {
      ...turn('¿cómo te llamas? ¿de dónde eres?'),
      characterId: LIA,
    });
    await store.appendTurn(vault, A, {
      ...turn('Me llamo Luxy. Vengo de un lugar donde huele a vainilla.', 'assistant'),
      characterId: LIA,
    });
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('las lineas van SIEMPRE, se pida o no rememorar', () => {
    // es lo que hace que sepa que ocurrio aunque la busqueda no acierte
    return buildRecall(memory, vault, 'hola, ¿qué tal?', { characterId: LIA }).then((recall) => {
      expect(recall.episodes).toHaveLength(1);
      expect(recall.episodes[0]).toMatchObject({ id: 'r1', title: '¿cómo te llamas? ¿de dónde eres?' });
      expect(recall.quoted).toBeNull();
    });
  });

  it('la linea lleva fecha, para poder situarlo en el tiempo', async () => {
    const recall = await buildRecall(memory, vault, 'hola', { characterId: LIA });
    expect(recall.episodes[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('el identificador que ve el modelo es corto, no un uuid', async () => {
    // el prompt no tiene por que llevar identificadores internos
    const recall = await buildRecall(memory, vault, 'hola', { characterId: LIA });
    expect(JSON.stringify(recall)).not.toContain(A);
  });

  it('pidiendo rememorar Y acertando, se transcribe el momento', async () => {
    const recall = await buildRecall(memory, vault, '¿te acuerdas de lo de la vainilla?', { characterId: LIA });
    expect(recall.quoted).not.toBeNull();
    // texto real, no un resumen: por eso suena a recordar
    expect(recall.quoted?.conversation.map((each) => each.text)).toContain(
      'Me llamo Luxy. Vengo de un lugar donde huele a vainilla.',
    );
  });

  it('pidiendo rememorar pero sin acertar, no se inventa un momento', async () => {
    // traer un episodio cualquiera seria peor que no traer ninguno
    const recall = await buildRecall(memory, vault, '¿te acuerdas del submarino amarillo?', { characterId: LIA });
    expect(recall.quoted).toBeNull();
    expect(recall.episodes).toHaveLength(1);
  });

  it('no transcribe lo que ya viaja como historial reciente', async () => {
    // preguntar «¿te acuerdas de lo que acabas de decir?» no debe repetir turnos
    // que estan tres bloques mas abajo en el mismo prompt
    const recall = await buildRecall(memory, vault, '¿te acuerdas de la vainilla?', {
      characterId: LIA,
      alreadyInPrompt: { conversationId: A, fromSequence: 0 },
    });
    expect(recall.quoted).toBeNull();
  });

  it('respeta el tope de lineas', async () => {
    const recall = await buildRecall(memory, vault, 'hola', { characterId: LIA, maxEpisodeLines: 0 });
    expect(recall.episodes).toEqual([]);
  });

  it('recorta el momento transcrito por el principio, no por el final', async () => {
    // quien pregunta por un momento quiere como fue, no como acabo
    const recall = await buildRecall(memory, vault, '¿te acuerdas de la vainilla?', {
      characterId: LIA,
      maxQuotedTurns: 1,
    });
    expect(recall.quoted?.conversation).toHaveLength(1);
    expect(recall.quoted?.conversation[0]?.text).toBe('¿cómo te llamas? ¿de dónde eres?');
  });

  it('un hilo SIN personaje no hereda los recuerdos de nadie', async () => {
    // el fallo que encontro Daniel: abrio una conversacion nueva sin elegir
    // personaje y le hablo con los recuerdos de Lía. `D-058` decia que los
    // recuerdos son del personaje y el alcance nunca se llego a implementar
    const recall = await buildRecall(memory, vault, 'hola', { characterId: LIA });
    expect(recall.episodes.length).toBeGreaterThan(0);

    const huerfano = await buildRecall(memory, vault, 'hola', { characterId: null });
    expect(huerfano.episodes).toEqual([]);
  });

  it('un personaje no ve los recuerdos de otro', async () => {
    const otra = await buildRecall(memory, vault, '¿te acuerdas de la vainilla?', {
      characterId: OTRO,
    });
    expect(otra.episodes).toEqual([]);
    expect(otra.quoted).toBeNull();
  });

  it('sin indicar personaje se sigue viendo todo, para la pantalla de diagnostico', async () => {
    // esa pantalla existe para ver QUE hay, incluido lo de otros
    expect((await memory.listEpisodes(vault)).length).toBeGreaterThan(0);
  });

  it('sin nada en la boveda no recuerda nada, y no es un error', async () => {
    const empty = new PrivateMemory(store, { excluded: () => new Set([A]) });
    const recall = await buildRecall(empty, vault, '¿te acuerdas?', { characterId: LIA });
    expect(recall).toEqual({ episodes: [], quoted: null });
  });
});

// -----------------------------------------------------------------------------
// recordar por fecha
// -----------------------------------------------------------------------------

/**
 * Lo que pidio Daniel, con sus palabras: «si le digo ¿te acuerdas de lo que
 * hablamos el jueves? (o sea, hoy), que sea capaz de reconocer la conversacion
 * de hoy y rememorarla».
 *
 * La busqueda lexica no podia: «jueves» no aparece en lo que se dijo ese
 * jueves. Estas pruebas van contra una boveda de verdad y con fechas FIJADAS,
 * porque lo que se comprueba es que la fecha del disco y la del mensaje se
 * encuentran.
 */
describe('reconocer que se pregunta por algo dicho', () => {
  it('hablar de hablar es preguntar por una conversacion', () => {
    for (const frase of [
      '¿de qué hablamos el jueves?',
      'lo que me dijiste ayer',
      'aquello que te conté anoche',
      'lo de esta mañana',
    ]) {
      expect(looksLikeConversationRecall(frase)).toBe(true);
    }
  });

  it('nombrar un dia NO es preguntar por lo que se dijo', () => {
    // el fallo que motivo esto: una fecha sola disparaba la transcripcion, y
    // «hoy me duele la cabeza» sacaba la conversacion entera de hoy
    for (const frase of ['hoy me duele la cabeza', 'el jueves fui al médico', 'ayer llovió']) {
      expect(looksLikeConversationRecall(frase)).toBe(false);
    }
  });
});

describe('recordar por fecha, contra una boveda de verdad', () => {
  const JUEVES = '22222222-2222-4222-8222-222222222222';
  const LUNES = '33333333-3333-4333-8333-333333333333';
  // jueves 2026-09-10 a las 17:00 en Madrid: el caso exacto que se pidio
  const ANCLA = {
    instant: '2026-09-10T15:00:00Z',
    timeZone: 'Europe/Madrid',
    dayStartsAtHour: 5,
  };

  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;
  let memory: PrivateMemory;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-recall-fecha-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    store = new PrivateConversationStore(conversationsDirectory(directory));
    memory = new PrivateMemory(store);
    memory.attachTo(vault);

    // la conversacion del jueves por la mañana (10:00 en Madrid)
    await store.appendTurn(vault, JUEVES, {
      ...turn('buenos días, ¿qué tal has dormido?'),
      characterId: LIA,
      createdAt: '2026-09-10T08:00:00Z',
    });
    await store.appendTurn(vault, JUEVES, {
      ...turn('Soñé con el faro de la costa, el de las luces verdes.', 'assistant'),
      characterId: LIA,
      createdAt: '2026-09-10T08:05:00Z',
    });

    // y otra del lunes por la noche (20:00 en Madrid)
    await store.appendTurn(vault, LUNES, {
      ...turn('¿me cuentas algo antes de dormir?'),
      characterId: LIA,
      createdAt: '2026-09-07T18:00:00Z',
    });
    await store.appendTurn(vault, LUNES, {
      ...turn('Te cuento lo del gato que se colaba en la biblioteca.', 'assistant'),
      characterId: LIA,
      createdAt: '2026-09-07T18:05:00Z',
    });
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const textos = (recall: Awaited<ReturnType<typeof buildRecall>>): string[] =>
    recall.quoted?.conversation.map((each) => each.text) ?? [];

  it('«el jueves» dicho en jueves trae la conversacion de HOY', async () => {
    // ninguna palabra en comun con lo que se dijo: sin la fecha no habia forma
    const recall = await buildRecall(memory, vault, '¿de qué hablamos el jueves?', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(textos(recall)).toContain('Soñé con el faro de la costa, el de las luces verdes.');
  });

  it('un dia de la semana pasado trae SU conversacion, no la de hoy', async () => {
    const recall = await buildRecall(memory, vault, 'lo que me dijiste el lunes', {
      characterId: LIA,
      anchor: ANCLA,
    });
    const dicho = textos(recall);
    expect(dicho).toContain('Te cuento lo del gato que se colaba en la biblioteca.');
    expect(dicho).not.toContain('Soñé con el faro de la costa, el de las luces verdes.');
  });

  it('una fecha sin preguntar por lo dicho NO transcribe nada', async () => {
    // el fallo que se colo al añadir esto: una fecha sola bastaba para disparar
    const recall = await buildRecall(memory, vault, 'hoy me duele la cabeza', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(recall.quoted).toBeNull();
    // las lineas SI siguen ahi: saber que ocurrio no depende de preguntar
    expect(recall.episodes.length).toBeGreaterThan(0);
  });

  it('un dia sin conversaciones no se inventa una', async () => {
    // el martes no hubo nada; traer otro dia seria mentir con una fecha
    const recall = await buildRecall(memory, vault, '¿de qué hablamos el martes?', {
      characterId: LIA,
      anchor: ANCLA,
    });
    expect(textos(recall)).not.toContain('Soñé con el faro de la costa, el de las luces verdes.');
    expect(textos(recall)).not.toContain('Te cuento lo del gato que se colaba en la biblioteca.');
  });

  it('con ancla, la linea del indice lleva el dia LOCAL', async () => {
    const recall = await buildRecall(memory, vault, 'hola', { characterId: LIA, anchor: ANCLA });
    const fechas = recall.episodes.map((episode) => episode.date);
    expect(fechas).toContain('2026-09-10');
    expect(fechas).toContain('2026-09-07');
  });

  it('sin ancla se conserva el comportamiento de antes', async () => {
    // ninguna prueba vieja cambia de significado sin querer
    const recall = await buildRecall(memory, vault, '¿de qué hablamos el jueves?', {
      characterId: LIA,
    });
    expect(textos(recall)).not.toContain('Soñé con el faro de la costa, el de las luces verdes.');
  });
});
