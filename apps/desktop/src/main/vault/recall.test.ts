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
import { buildRecall, looksLikeMemoryRequest } from './recall.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';

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

    await store.appendTurn(vault, A, turn('¿cómo te llamas? ¿de dónde eres?'));
    await store.appendTurn(
      vault,
      A,
      turn('Me llamo Luxy. Vengo de un lugar donde huele a vainilla.', 'assistant'),
    );
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('las lineas van SIEMPRE, se pida o no rememorar', () => {
    // es lo que hace que sepa que ocurrio aunque la busqueda no acierte
    return buildRecall(memory, vault, 'hola, ¿qué tal?').then((recall) => {
      expect(recall.episodes).toHaveLength(1);
      expect(recall.episodes[0]).toMatchObject({ id: 'r1', title: '¿cómo te llamas? ¿de dónde eres?' });
      expect(recall.quoted).toBeNull();
    });
  });

  it('la linea lleva fecha, para poder situarlo en el tiempo', async () => {
    const recall = await buildRecall(memory, vault, 'hola');
    expect(recall.episodes[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('el identificador que ve el modelo es corto, no un uuid', async () => {
    // el prompt no tiene por que llevar identificadores internos
    const recall = await buildRecall(memory, vault, 'hola');
    expect(JSON.stringify(recall)).not.toContain(A);
  });

  it('pidiendo rememorar Y acertando, se transcribe el momento', async () => {
    const recall = await buildRecall(memory, vault, '¿te acuerdas de lo de la vainilla?');
    expect(recall.quoted).not.toBeNull();
    // texto real, no un resumen: por eso suena a recordar
    expect(recall.quoted?.conversation.map((each) => each.text)).toContain(
      'Me llamo Luxy. Vengo de un lugar donde huele a vainilla.',
    );
  });

  it('pidiendo rememorar pero sin acertar, no se inventa un momento', async () => {
    // traer un episodio cualquiera seria peor que no traer ninguno
    const recall = await buildRecall(memory, vault, '¿te acuerdas del submarino amarillo?');
    expect(recall.quoted).toBeNull();
    expect(recall.episodes).toHaveLength(1);
  });

  it('no transcribe lo que ya viaja como historial reciente', async () => {
    // preguntar «¿te acuerdas de lo que acabas de decir?» no debe repetir turnos
    // que estan tres bloques mas abajo en el mismo prompt
    const recall = await buildRecall(memory, vault, '¿te acuerdas de la vainilla?', {
      alreadyInPrompt: { conversationId: A, fromSequence: 0 },
    });
    expect(recall.quoted).toBeNull();
  });

  it('respeta el tope de lineas', async () => {
    const recall = await buildRecall(memory, vault, 'hola', { maxEpisodeLines: 0 });
    expect(recall.episodes).toEqual([]);
  });

  it('recorta el momento transcrito por el principio, no por el final', async () => {
    // quien pregunta por un momento quiere como fue, no como acabo
    const recall = await buildRecall(memory, vault, '¿te acuerdas de la vainilla?', {
      maxQuotedTurns: 1,
    });
    expect(recall.quoted?.conversation).toHaveLength(1);
    expect(recall.quoted?.conversation[0]?.text).toBe('¿cómo te llamas? ¿de dónde eres?');
  });

  it('sin nada en la boveda no recuerda nada, y no es un error', async () => {
    const empty = new PrivateMemory(store, { excluded: () => new Set([A]) });
    const recall = await buildRecall(empty, vault, '¿te acuerdas?');
    expect(recall).toEqual({ episodes: [], quoted: null });
  });
});
