// pruebas del almacen de la memoria de lo ya hablado, contra una boveda de verdad.
//
// Aqui si se cifra y se descifra, porque lo que se comprueba es justo lo que no
// se puede comprobar sin sellar: que lo guardado vuelve igual, que una ficha
// rota no se lleva por delante a las demas y —sobre todo— que un archivo que no
// se puede abrir se queda intacto. Perderlo borraria las aprobaciones de Daniel
// y obligaria a volver a mandar las diecisiete conversaciones al CLI.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openText, sealText, wipe, type SealedEnvelope } from '@luxy/vault-crypto';
import {
  RECAP_VERSION,
  recapCountersSchema,
  type ConversationMemory,
  type RecapEntry,
} from '@luxy/shared';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { RecapStore, recapFilePath, type RecapSnapshot, type RecapState } from './recap-store.js';

/**
 * las dos llamadas que hacen durable una escritura, envueltas para ver su ORDEN.
 *
 * Forzar a disco DESPUES del rename no serviria de nada: el rename solo mueve
 * metadatos, y un corte entre los dos dejaria el nombre bueno apuntando a
 * bloques sin escribir. Lo demas de `node:fs` sigue siendo el de verdad.
 */
const fsCalls = vi.hoisted(() => [] as string[]);
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof NodeFs>();
  return {
    ...real,
    default: real,
    fsyncSync: (descriptor: number) => {
      fsCalls.push('fsync');
      real.fsyncSync(descriptor);
    },
    renameSync: (from: NodeFs.PathLike, to: NodeFs.PathLike) => {
      fsCalls.push('rename');
      real.renameSync(from, to);
    },
  };
});

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const CONV_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const CONV_C = 'cccccccc-3333-4333-8333-333333333333';

/** una frase que solo puede venir de la ficha: sirve para mirar el disco en claro */
const COCINA = 'ella cocina descalza en la cocina de el los martes por la noche';
const AZOTEA = 'quedaron en subir a la azotea la proxima vez que llueva';

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

function memory(summary: string, facts: string[] = []): ConversationMemory {
  return { version: 1, summary, facts, decisions: [], plan: [], openQuestions: [], lessons: [] };
}

function entry(over: Partial<RecapEntry> & { conversationId: string }): RecapEntry {
  return {
    memory: memory(COCINA),
    source: 'cli',
    covered: { from: 0, to: 11 },
    coveredAt: '2026-09-04T21:00:00.000Z',
    gaps: [],
    turnsAtRecap: 12,
    version: RECAP_VERSION,
    approvalReset: false,
    provider: 'codex',
    model: null,
    at: '2026-09-04T21:01:00.000Z',
    chars: 420,
    approved: false,
    refusedKind: null,
    refusedAtTurns: null,
    refusedProvider: null,
    supersededAt: null,
    ...over,
  };
}

const state = (over: Partial<RecapState> = {}): RecapState => ({
  entries: over.entries ?? [],
  counters: over.counters ?? recapCountersSchema.parse({}),
});

describe('almacen de la memoria de lo ya hablado', () => {
  let directory: string;
  let vault: VaultService;
  let file: string;
  let store: RecapStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-recap-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    file = recapFilePath(directory);
    store = new RecapStore(file);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /** escribe un contenido cualquiera con el sello de verdad, para poder romperlo */
  async function sealPayload(payload: unknown): Promise<void> {
    const key = vault.subkeyFor('identity', 'recap');
    try {
      const sealed = await sealText(key, 'vault.identity', JSON.stringify(payload));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ version: 1, content: sealed }), 'utf8');
    } finally {
      wipe(key);
    }
  }

  /** abre el archivo a mano: lo que se comprueba es lo que QUEDO en disco */
  async function openPayload(): Promise<{ entries: unknown[]; counters: unknown }> {
    const envelope = JSON.parse(readFileSync(file, 'utf8')) as { content: SealedEnvelope };
    const key = vault.subkeyFor('identity', 'recap');
    try {
      const text = await openText(key, 'vault.identity', envelope.content);
      return JSON.parse(text) as { entries: unknown[]; counters: unknown };
    } finally {
      wipe(key);
    }
  }

  it('el archivo vive en vault/recap.json, hermano del catalogo', () => {
    expect(recapFilePath(directory)).toBe(join(directory, 'vault', 'recap.json'));
  });

  it('lo guardado vuelve igual, y en disco no se lee la ficha', async () => {
    await store.apply(vault, () =>
      state({
        entries: [entry({ conversationId: CONV_A, approved: true })],
        counters: recapCountersSchema.parse({ windows: 3, ok: 2, partial: 1 }),
      }),
    );

    // otra instancia: lo que vuelve sale del archivo, no de nada en memoria
    const leido = await new RecapStore(file).read(vault);
    expect(leido.entries).toHaveLength(1);
    expect(leido.entries[0]?.memory?.summary).toBe(COCINA);
    expect(leido.entries[0]?.conversationId).toBe(CONV_A);
    expect(leido.entries[0]?.approved).toBe(true);
    expect(leido.counters.windows).toBe(3);
    expect(leido.counters.ok).toBe(2);
    expect(leido.droppedOnRead).toBe(0);

    expect(readFileSync(file, 'utf8')).not.toContain('descalza');
  });

  it('la llave NO es la del catalogo ni la de los pendientes', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));

    const envelope = JSON.parse(readFileSync(file, 'utf8')) as { content: SealedEnvelope };
    // si `recap` compartiera subclave con cualquiera de los otros dos, un sobre
    // de aqui abriria alli y se podria mover de sitio; eso es justo lo que el
    // contexto propio impide
    for (const context of ['catalog', 'relation', 'characters']) {
      const key = vault.subkeyFor('identity', context);
      try {
        await expect(openText(key, 'vault.identity', envelope.content)).rejects.toBeTruthy();
      } finally {
        wipe(key);
      }
    }
  });

  it('una ficha de una version futura se cuenta y las demas siguen', async () => {
    await sealPayload({
      v: 1,
      entries: [
        entry({ conversationId: CONV_A }),
        // lo que escribiria una version posterior con un `source` nuevo
        { ...entry({ conversationId: CONV_B }), source: 'hibrido' },
      ],
      counters: recapCountersSchema.parse({}),
    });

    const leido = await store.read(vault);
    expect(leido.entries.map((each) => each.conversationId)).toEqual([CONV_A]);
    expect(leido.droppedOnRead).toBe(1);
  });

  it('LO QUE NO SE PUDO LEER vuelve al archivo en vez de borrarse', async () => {
    // lo que escribiria una version posterior: un `refusedKind` que esta no conoce
    const futura = { ...entry({ conversationId: CONV_B }), refusedKind: 'moderado' };
    await sealPayload({
      v: 1,
      entries: [entry({ conversationId: CONV_A }), futura],
      counters: recapCountersSchema.parse({}),
    });

    // una escritura cualquiera: borrar una conversacion que no es de ninguna
    await store.removeConversation(vault, CONV_C);

    const guardado = await openPayload();
    expect(guardado.entries).toHaveLength(2);
    expect(guardado.entries).toContainEqual(futura);
    // y se sigue contando como lo que es: algo que esta version no entiende
    expect((await store.read(vault)).droppedOnRead).toBe(1);
  });

  it('con TODAS las fichas rotas, guardar NO deja el archivo vacio', async () => {
    const rotas = [
      { ...entry({ conversationId: CONV_A }), source: 'hibrido' },
      { ...entry({ conversationId: CONV_B }), covered: { from: 0, to: -3 } },
    ];
    await sealPayload({ v: 1, entries: rotas, counters: recapCountersSchema.parse({}) });

    const leido = await store.read(vault);
    expect(leido.entries).toHaveLength(0);
    expect(leido.droppedOnRead).toBe(2);

    // sin suelo, esta llamada dejaba `entries: []` sin error y sin aviso
    await store.removeConversation(vault, CONV_C);

    expect((await openPayload()).entries).toEqual(rotas);
  });

  it('los contadores rotos vuelven a cero sin tirar las fichas', async () => {
    await sealPayload({
      v: 1,
      entries: [entry({ conversationId: CONV_A })],
      counters: { windows: 'tres' },
    });

    const leido = await store.read(vault);
    expect(leido.entries).toHaveLength(1);
    expect(leido.counters.windows).toBe(0);
    // no son la decision de nadie: no cuentan como algo perdido
    expect(leido.droppedOnRead).toBe(0);
  });

  it('una ficha mal formada NO llega al disco: el guardado para en seco', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));
    const antes = readFileSync(file, 'utf8');

    // lo que puede colar el lado que escribe sin que TypeScript lo vea: para el
    // compilador `coveredAt` es un string cualquiera
    await expect(
      store.apply(vault, (current) => ({
        counters: current.counters,
        entries: [
          ...current.entries,
          entry({ conversationId: CONV_B, coveredAt: 'ayer por la noche' }),
        ],
      })),
    ).rejects.toBeInstanceOf(VaultError);

    // si se hubiera escrito, se destruiria sola en la siguiente lectura
    expect(readFileSync(file, 'utf8')).toBe(antes);
  });

  it('los datos se fuerzan a disco ANTES de renombrar', async () => {
    fsCalls.length = 0;

    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));

    expect(fsCalls).toEqual(['fsync', 'rename']);
  });

  it('UN SOBRE QUE NO SE ABRE detiene el trabajo y deja el archivo intacto', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));

    // se rompe el cifrado sin tocar la forma del archivo: es lo que pasaria con
    // un archivo de otra boveda o con un bit cambiado en el disco
    const envelope = JSON.parse(readFileSync(file, 'utf8')) as {
      version: number;
      content: { ciphertext: string };
    };
    const first = envelope.content.ciphertext.slice(0, 1);
    envelope.content.ciphertext = `${first === 'A' ? 'B' : 'A'}${envelope.content.ciphertext.slice(1)}`;
    writeFileSync(file, JSON.stringify(envelope), 'utf8');
    const roto = readFileSync(file, 'utf8');

    await expect(store.read(vault)).rejects.toBeInstanceOf(VaultError);
    // y sobre todo: intentar escribir tampoco lo pisa
    await expect(store.apply(vault, () => state())).rejects.toBeInstanceOf(VaultError);
    expect(readFileSync(file, 'utf8')).toBe(roto);
  });

  it('un archivo con otra forma tampoco se pisa', async () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 9, cosas: [] }), 'utf8');
    const raro = readFileSync(file, 'utf8');

    await expect(store.read(vault)).rejects.toBeInstanceOf(VaultError);
    await expect(store.apply(vault, () => state())).rejects.toBeInstanceOf(VaultError);
    expect(readFileSync(file, 'utf8')).toBe(raro);
  });

  it('no deja el temporal detras', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));

    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('DOS CAMBIOS A LA VEZ no se pisan', async () => {
    const lento =
      (added: RecapEntry) =>
      async (current: RecapSnapshot): Promise<RecapState> => {
        // el hueco entre leer y escribir, que es donde se perdia una
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { entries: [...current.entries, added], counters: current.counters };
      };

    await Promise.all([
      store.apply(vault, lento(entry({ conversationId: CONV_A }))),
      store.apply(vault, lento(entry({ conversationId: CONV_B }))),
    ]);

    const leido = await store.read(vault);
    expect(leido.entries.map((each) => each.conversationId).sort()).toEqual([CONV_A, CONV_B]);
  });

  it('un fallo no envenena el carril: el siguiente cambio entra igual', async () => {
    await expect(
      store.apply(vault, () => {
        throw new Error('el mutador se rompio');
      }),
    ).rejects.toThrow('el mutador se rompio');

    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));
    expect((await store.read(vault)).entries).toHaveLength(1);
  });

  it('entryFor devuelve la ficha de esa conversacion y nada mas', async () => {
    await store.apply(vault, () =>
      state({
        entries: [
          entry({ conversationId: CONV_A, memory: memory(COCINA) }),
          entry({ conversationId: CONV_B, memory: memory(AZOTEA) }),
        ],
      }),
    );

    expect((await store.entryFor(vault, CONV_B))?.memory?.summary).toBe(AZOTEA);
    expect(await store.entryFor(vault, CONV_C)).toBeUndefined();
  });

  it('borrar una conversacion se lleva su ficha y deja las demas', async () => {
    await store.apply(vault, () =>
      state({
        entries: [
          entry({ conversationId: CONV_A }),
          entry({ conversationId: CONV_B, memory: memory(AZOTEA) }),
        ],
        counters: recapCountersSchema.parse({ windows: 2 }),
      }),
    );

    await store.removeConversation(vault, CONV_A);

    const leido = await store.read(vault);
    expect(leido.entries.map((each) => each.conversationId)).toEqual([CONV_B]);
    // los contadores son de la pasada, no de la conversacion: no se tocan
    expect(leido.counters.windows).toBe(2);
    // y el resumen de lo que pasaba dentro no se queda en disco
    expect(readFileSync(file, 'utf8')).not.toContain('descalza');
  });

  it('borrar una conversacion SE LLEVA TAMBIEN lo que no se entiende de ella', async () => {
    const suya = { ...entry({ conversationId: CONV_A }), source: 'hibrido' };
    const ajena = { ...entry({ conversationId: CONV_B }), source: 'hibrido' };
    await sealPayload({ v: 1, entries: [suya, ajena], counters: recapCountersSchema.parse({}) });

    await store.removeConversation(vault, CONV_A);

    // conservarla dejaria en disco el resumen de una conversacion recien borrada
    expect((await openPayload()).entries).toEqual([ajena]);
  });

  it('markSuperseded marca la conversacion con memoria propia y no toca las otras', async () => {
    await store.apply(vault, () =>
      state({
        entries: [entry({ conversationId: CONV_A }), entry({ conversationId: CONV_B })],
      }),
    );

    await store.markSuperseded(vault, CONV_A, '2026-09-14T10:00:00.000Z');

    const leido = await store.read(vault);
    const marcada = leido.entries.find((each) => each.conversationId === CONV_A);
    const intacta = leido.entries.find((each) => each.conversationId === CONV_B);
    expect(marcada?.supersededAt).toBe('2026-09-14T10:00:00.000Z');
    // la ficha se conserva: la sellada gana igual, y borrarla haria que la
    // pasada la volviera a generar si esa memoria sellada desapareciera
    expect(marcada?.memory?.summary).toBe(COCINA);
    expect(intacta?.supersededAt).toBeNull();
  });

  it('markSuperseded conserva la PRIMERA fecha en la segunda pasada', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));

    await store.markSuperseded(vault, CONV_A, '2026-09-14T10:00:00.000Z');
    await store.markSuperseded(vault, CONV_A, '2026-09-15T10:00:00.000Z');

    // si se reestampara seria «cuando se miro por ultima vez», que no es lo que
    // dice el nombre
    expect((await store.entryFor(vault, CONV_A))?.supersededAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('markSuperseded de una conversacion sin ficha no inventa ninguna', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));

    await store.markSuperseded(vault, CONV_C, '2026-09-14T10:00:00.000Z');

    expect((await store.read(vault)).entries).toHaveLength(1);
  });

  it('clearSuperseded quita la marca y deja la ficha entera', async () => {
    await store.apply(vault, () =>
      state({
        entries: [entry({ conversationId: CONV_A }), entry({ conversationId: CONV_B })],
      }),
    );
    await store.markSuperseded(vault, CONV_A, '2026-09-14T10:00:00.000Z');
    await store.markSuperseded(vault, CONV_B, '2026-09-14T10:00:00.000Z');

    await store.clearSuperseded(vault, CONV_A);

    const leido = await store.read(vault);
    const limpia = leido.entries.find((each) => each.conversationId === CONV_A);
    const intacta = leido.entries.find((each) => each.conversationId === CONV_B);
    expect(limpia?.supersededAt).toBeNull();
    // el texto de la ficha NO es lo que quita esta operacion: eso lo hace
    // `removeConversation`, y aqui quitarlo seria borrar dos cosas por una
    expect(limpia?.memory?.summary).toBe(COCINA);
    expect(intacta?.supersededAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('clearSuperseded sobre una que no estaba marcada no cambia nada', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));

    await store.clearSuperseded(vault, CONV_A);

    const leido = await store.read(vault);
    expect(leido.entries).toHaveLength(1);
    expect(leido.entries[0]?.supersededAt).toBeNull();
  });

  it('clearSuperseded de una conversacion sin ficha no inventa ninguna', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));

    await store.clearSuperseded(vault, CONV_C);

    expect((await store.read(vault)).entries).toHaveLength(1);
  });

  it('SIN MARCA NO ESCRIBE: sin archivo, no lo crea', async () => {
    // el borrado de la memoria sellada llama a esto primero, y la fila que hizo
    // falta hacer visible —excluida del trabajo de fondo, sellada, sin ficha— no
    // tiene nada que quitar aqui. Escribir igualmente ataba ese borrado a poder
    // reescribir `recap.json`, y encima creaba de la nada un archivo que no
    // existia
    const quito = await store.clearSuperseded(vault, CONV_C);

    expect(existsSync(file)).toBe(false);
    expect(quito).toBe(false);
  });

  it('SIN MARCA NO ESCRIBE: el archivo se queda byte a byte igual', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));
    const antes = readFileSync(file);

    const quito = await store.clearSuperseded(vault, CONV_A);

    // byte a byte y no «las fichas siguen»: cada guardado sella con un nonce
    // nuevo, asi que si hubiera reescrito, el archivo seria otro
    expect(readFileSync(file).equals(antes)).toBe(true);
    expect(quito).toBe(false);
  });

  it('con marca SI escribe, y lo dice', async () => {
    await store.apply(vault, () => state({ entries: [entry({ conversationId: CONV_A })] }));
    await store.markSuperseded(vault, CONV_A, '2026-09-14T10:00:00.000Z');

    const quito = await store.clearSuperseded(vault, CONV_A);

    expect(quito).toBe(true);
    expect((await store.read(vault)).entries[0]?.supersededAt).toBeNull();
  });

  it('sin archivo, leer devuelve vacio en vez de lanzar', async () => {
    const leido = await store.read(vault);
    expect(leido.entries).toEqual([]);
    expect(leido.counters.windows).toBe(0);
    expect(leido.droppedOnRead).toBe(0);
    expect(existsSync(file)).toBe(false);
  });
});
