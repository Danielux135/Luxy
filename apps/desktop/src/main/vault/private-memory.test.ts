// pruebas de la memoria episodica contra una boveda de verdad.
//
// Aqui si se cifra y se descifra: lo que se comprueba es justo lo que las
// piezas puras no pueden comprobar solas —que se lee lo que hay, que se
// reconstruye cuando cambia, y sobre todo que cerrar la boveda no deja el
// historial descifrado en memoria—.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultService, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';
import { PrivateMemory } from './private-memory.js';
import { tokenize } from './turn-index.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const LIA = '33333333-3333-4333-8333-333333333333';

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

describe('memoria episodica', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;
  let memory: PrivateMemory;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-mem-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    store = new PrivateConversationStore(conversationsDirectory(directory));
    memory = new PrivateMemory(store);
    memory.attachTo(vault);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('encuentra un turno de una conversacion cifrada', async () => {
    await store.appendTurn(vault, A, turn('vengo de un lugar donde huele a vainilla', 'assistant'));
    await store.appendTurn(vault, A, turn('hablamos del tiempo'));

    const found = await memory.search(vault, 'vainilla');
    expect(found).toHaveLength(1);
    expect(found[0]?.text).toContain('vainilla');
    expect(found[0]?.conversationId).toBe(A);
  });

  it('cada turno viene con el episodio al que pertenece', async () => {
    await store.appendTurn(vault, A, turn('¿cómo te llamas?'));
    await store.appendTurn(vault, A, turn('me llamo Luxy', 'assistant'));

    const [found] = await memory.search(vault, 'Luxy');
    // los turnos se numeran desde 0, asi que el primer episodio va de 0 a 1
    expect(found?.episode).toMatchObject({ conversationId: A, from: 0, to: 1 });
    expect(found?.episode?.title).toBe('¿cómo te llamas?');
  });

  it('no se construye hasta que hace falta', async () => {
    await store.appendTurn(vault, A, turn('algo'));
    // abrir la boveda ya tarda por el derivado de la contraseña; quien no
    // rememore nada no debe pagar ademas una pasada sobre su historial
    expect(memory.ready).toBe(false);

    await memory.listEpisodes(vault);
    expect(memory.ready).toBe(true);
  });

  it('CERRAR LA BOVEDA vacia la memoria', async () => {
    await store.appendTurn(vault, A, turn('un secreto que no debe sobrevivir'));
    await memory.search(vault, 'secreto');
    expect(memory.ready).toBe(true);

    vault.lock('manual');

    // esto no es higiene: aqui habia texto descifrado, y una boveda cerrada que
    // conserve su contenido en memoria no esta cerrada
    expect(memory.ready).toBe(false);
    expect(memory.episodeCount).toBe(0);
  });

  it('lo escrito despues de construir aparece al invalidar', async () => {
    await store.appendTurn(vault, A, turn('primero'));
    await memory.search(vault, 'primero');

    await store.appendTurn(vault, A, turn('canela'));
    // sin invalidar, el indice es el de antes: mantenerlo desfasado haria que
    // el personaje recordara algo que ya se borro
    expect(await memory.search(vault, 'canela')).toEqual([]);

    memory.invalidate();
    expect(await memory.search(vault, 'canela')).toHaveLength(1);
  });

  it('una conversacion excluida no vuelve nunca', async () => {
    const excluded = new Set<string>();
    const selective = new PrivateMemory(store, { excluded: () => excluded });

    await store.appendTurn(vault, A, turn('vainilla en la primera'));
    await store.appendTurn(vault, B, turn('vainilla en la segunda'));

    expect(await selective.search(vault, 'vainilla')).toHaveLength(2);

    excluded.add(B);
    selective.invalidate();

    const found = await selective.search(vault, 'vainilla');
    expect(found).toHaveLength(1);
    expect(found[0]?.conversationId).toBe(A);
  });

  it('un episodio se lee entero y en orden, para citarlo tal cual se dijo', async () => {
    await store.appendTurn(vault, A, turn('uno'));
    await store.appendTurn(vault, A, turn('dos', 'assistant'));
    await store.appendTurn(vault, A, turn('tres'));

    const [episode] = await memory.listEpisodes(vault);
    const turns = await memory.readEpisode(vault, episode!);

    expect(turns.map((each) => each.text)).toEqual(['uno', 'dos', 'tres']);
  });

  it('dos busquedas a la vez no construyen el indice dos veces', async () => {
    await store.appendTurn(vault, A, turn('vainilla'));
    const [primera, segunda] = await Promise.all([
      memory.search(vault, 'vainilla'),
      memory.search(vault, 'vainilla'),
    ]);
    expect(primera).toEqual(segunda);
    expect(memory.episodeCount).toBe(1);
  });

  it('las conversaciones SIN PERSONAJE no son «todas»', async () => {
    await store.appendTurn(vault, A, { ...turn('hablamos de lo nuestro'), characterId: LIA });
    await store.appendTurn(vault, B, turn('un hilo suelto, sin personaje'));
    await memory.timeline(vault);

    // un hilo sin personaje no hereda la memoria de nadie (`D-062`): si `null`
    // significara «todas», las promesas de Lia saldrian en una pestaña vacia
    expect([...memory.conversationsFor(null)]).toEqual([B]);
    expect([...memory.conversationsFor(LIA)]).toEqual([A]);
  });

  it('turnAt devuelve el texto SIN volver a descifrar', async () => {
    await store.appendTurn(vault, A, turn('¿cómo te llamas?'));
    await store.appendTurn(vault, A, turn('me llamo Luxy', 'assistant'));
    await memory.timeline(vault);

    expect(memory.turnAt(A, 1)?.text).toBe('me llamo Luxy');
    // un numero que no existe: es el caso de la cita rota, y devolver null es
    // lo que hace que ese pendiente no se ofrezca
    expect(memory.turnAt(A, 9)).toBeNull();

    // la prueba de que sale de memoria y no del disco: sin archivo, contesta
    store.delete(A);
    expect(memory.turnAt(A, 1)?.text).toBe('me llamo Luxy');
  });

  it('la linea temporal lleva createdAt y raices, y CERRAR LA BOVEDA la vacia', async () => {
    await store.appendTurn(vault, A, {
      ...turn('huele a vainilla en toda la cocina', 'assistant'),
      characterId: LIA,
      createdAt: '2026-09-04T20:00:00.000Z',
    });
    await store.appendTurn(vault, B, turn('esto es de otro'));

    const linea = await memory.timeline(vault, LIA);
    expect(linea).toHaveLength(1);
    expect(linea[0]).toMatchObject({
      conversationId: A,
      sequence: 0,
      role: 'assistant',
      createdAt: '2026-09-04T20:00:00.000Z',
    });
    // las raices son lo que permite saber que un turno habla de una promesa
    expect(linea[0]?.stems.has(tokenize('vainilla')[0]!)).toBe(true);
    expect(memory.timelineSize).toBe(2);

    vault.lock('manual');

    // aqui habia raices de lo que se dijo: una boveda cerrada que las conserve
    // no esta cerrada
    expect(memory.timelineSize).toBe(0);
  });

  it('una pasada que quedo OBSOLETA a medias no publica lo suyo', async () => {
    await store.appendTurn(vault, A, { ...turn('hablamos de lo nuestro'), characterId: LIA });
    await store.appendTurn(vault, B, turn('un hilo que Daniel va a excluir'));

    // un conjunto NUEVO en cada cambio, como hace `MemoryPreferences.set`: la
    // pasada que ya iba en camino se queda con la foto anterior
    let excluidas: ReadonlySet<string> = new Set<string>();
    // la puerta se abre a mano: asi la pasada vieja termina DESPUES de la nueva
    // sin depender de ningun reloj
    let abrir!: () => void;
    const puerta = new Promise<void>((resolve) => {
      abrir = resolve;
    });
    let primera = true;
    const lenta = new PrivateMemory(store, {
      excluded: () => excluidas,
      catalog: async () => {
        if (!primera) return [];
        primera = false;
        await puerta;
        return [];
      },
    });

    // arranca con las dos conversaciones dentro y se queda esperando
    const vieja = lenta.timeline(vault);

    excluidas = new Set([B]);
    lenta.invalidate();

    // la pasada nueva ya ve la exclusion y publica sin B
    expect((await lenta.timeline(vault)).map((each) => each.conversationId)).toEqual([A]);

    abrir();
    await vieja;

    // y la vieja, que termina la ultima, no devuelve lo que acaba de salir
    expect(lenta.timelineSize).toBe(1);
    expect([...lenta.conversationsFor(null)]).toEqual([]);
    expect([...lenta.conversationsFor(LIA)]).toEqual([A]);
  });
});
