// pruebas del almacen de pendientes contra una boveda de verdad.
//
// Aqui si se cifra y se descifra, porque lo que se comprueba es justo lo que no
// se puede comprobar sin sellar: que lo guardado vuelve igual, que una nota rota
// no se lleva por delante a las demas y —sobre todo— que un archivo que no se
// puede abrir se queda intacto. Perderlo borraria lo que Daniel dio por
// cumplido o descarto, y eso no se rehace extrayendo otra vez.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openText, sealText, wipe, type SealedEnvelope } from '@luxy/vault-crypto';
import {
  RELATION_EXTRACTOR_VERSION,
  relationCountersSchema,
  type RelationCursor,
  type RelationNote,
} from '@luxy/shared';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import {
  RelationStore,
  relationFilePath,
  type RelationSnapshot,
  type RelationState,
} from './relation-store.js';

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

const CAFES = 'mañana te traigo dos cafés y una tarta de chocolate a la cama';
const MERCADO = 'el sábado vamos juntos al mercado de las flores';

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

function note(over: Partial<RelationNote> & { id: string; quote: string }): RelationNote {
  return {
    kind: 'promise',
    by: 'user',
    origin: {
      conversationId: CONV_A,
      sequence: 4,
      role: 'user',
      at: '2026-09-04T20:00:00.000Z',
    },
    keywords: ['desayuno'],
    status: 'open',
    closure: null,
    source: 'extractor',
    decidedBy: 'extractor',
    reopenedByDaniel: false,
    extractedBy: 'codex',
    extractorVersion: RELATION_EXTRACTOR_VERSION,
    createdAt: '2026-09-04T20:05:00.000Z',
    updatedAt: '2026-09-04T20:05:00.000Z',
    ...over,
  };
}

function cursor(over: Partial<RelationCursor> & { conversationId: string }): RelationCursor {
  return {
    through: 9,
    throughAt: '2026-09-04T21:00:00.000Z',
    version: RELATION_EXTRACTOR_VERSION,
    provider: 'codex',
    model: null,
    at: '2026-09-04T21:01:00.000Z',
    refusedVersion: null,
    refusedAtTurns: null,
    ...over,
  };
}

const state = (over: Partial<RelationState> = {}): RelationState => ({
  notes: over.notes ?? [],
  cursors: over.cursors ?? [],
  counters: over.counters ?? relationCountersSchema.parse({}),
});

describe('almacen de pendientes', () => {
  let directory: string;
  let vault: VaultService;
  let file: string;
  let store: RelationStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-rel-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    file = relationFilePath(directory);
    store = new RelationStore(file);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /** escribe un contenido cualquiera con el sello de verdad, para poder romperlo */
  async function sealPayload(payload: unknown): Promise<void> {
    const key = vault.subkeyFor('identity', 'relation');
    try {
      const sealed = await sealText(key, 'vault.identity', JSON.stringify(payload));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ version: 1, content: sealed }), 'utf8');
    } finally {
      wipe(key);
    }
  }

  /** abre el archivo a mano: lo que se comprueba es lo que QUEDO en disco */
  async function openPayload(): Promise<{ notes: unknown[]; cursors: unknown[] }> {
    const envelope = JSON.parse(readFileSync(file, 'utf8')) as { content: SealedEnvelope };
    const key = vault.subkeyFor('identity', 'relation');
    try {
      const text = await openText(key, 'vault.identity', envelope.content);
      return JSON.parse(text) as { notes: unknown[]; cursors: unknown[] };
    } finally {
      wipe(key);
    }
  }

  it('lo guardado vuelve igual, y en disco no se lee la cita', async () => {
    await store.apply(vault, () =>
      state({
        notes: [note({ id: '0123456789abcdef', quote: CAFES })],
        cursors: [cursor({ conversationId: CONV_A })],
        counters: relationCountersSchema.parse({ proposed: 3, accepted: 1 }),
      }),
    );

    // otra instancia: lo que vuelve sale del archivo, no de nada en memoria
    const leido = await new RelationStore(file).read(vault);
    expect(leido.notes).toHaveLength(1);
    expect(leido.notes[0]?.quote).toBe(CAFES);
    expect(leido.cursors[0]?.conversationId).toBe(CONV_A);
    expect(leido.counters.proposed).toBe(3);
    expect(leido.droppedOnRead).toBe(0);

    expect(readFileSync(file, 'utf8')).not.toContain('chocolate');
  });

  it('una nota de un tipo futuro se cuenta y las demas siguen', async () => {
    await sealPayload({
      v: 1,
      notes: [
        note({ id: '0123456789abcdef', quote: CAFES }),
        // lo que escribiria una version posterior con `kind` nuevo
        { ...note({ id: 'fedcba9876543210', quote: MERCADO }), kind: 'grudge' },
      ],
      cursors: [cursor({ conversationId: CONV_A }), { conversationId: CONV_A, through: 'ayer' }],
      counters: relationCountersSchema.parse({}),
    });

    const leido = await store.read(vault);
    expect(leido.notes.map((each) => each.quote)).toEqual([CAFES]);
    expect(leido.cursors).toHaveLength(1);
    expect(leido.droppedOnRead).toBe(2);
  });

  it('LO QUE NO SE PUDO LEER vuelve al archivo en vez de borrarse', async () => {
    // lo que escribiria una version posterior: un `kind` que esta no conoce
    const futura = { ...note({ id: 'fedcba9876543210', quote: MERCADO }), kind: 'grudge' };
    const cursorFuturo = { conversationId: CONV_B, through: 3, cuando: 'ayer' };
    await sealPayload({
      v: 1,
      notes: [note({ id: '0123456789abcdef', quote: CAFES }), futura],
      cursors: [cursor({ conversationId: CONV_A }), cursorFuturo],
      counters: relationCountersSchema.parse({}),
    });

    // una escritura cualquiera: borrar una conversacion que no es de ninguna
    await store.removeConversation(vault, 'cccccccc-3333-4333-8333-333333333333');

    const guardado = await openPayload();
    expect(guardado.notes).toHaveLength(2);
    expect(guardado.notes).toContainEqual(futura);
    expect(guardado.cursors).toContainEqual(cursorFuturo);
    // y se siguen contando como lo que son: algo que esta version no entiende
    expect((await store.read(vault)).droppedOnRead).toBe(2);
  });

  it('con TODAS las notas rotas, guardar NO deja el archivo vacio', async () => {
    const rotas = [
      { ...note({ id: '0123456789abcdef', quote: CAFES }), kind: 'grudge' },
      { ...note({ id: 'fedcba9876543210', quote: MERCADO }), status: 'superseded' },
    ];
    await sealPayload({ v: 1, notes: rotas, cursors: [], counters: relationCountersSchema.parse({}) });

    const leido = await store.read(vault);
    expect(leido.notes).toHaveLength(0);
    expect(leido.droppedOnRead).toBe(2);

    // sin suelo, esta llamada dejaba `notes: []` sin error y sin aviso
    await store.removeConversation(vault, CONV_B);

    expect((await openPayload()).notes).toEqual(rotas);
  });

  it('borrar una conversacion SE LLEVA TAMBIEN lo que no se entiende de ella', async () => {
    const suya = { ...note({ id: '0123456789abcdef', quote: CAFES }), kind: 'grudge' };
    const ajena = {
      ...note({
        id: 'fedcba9876543210',
        quote: MERCADO,
        origin: {
          conversationId: CONV_B,
          sequence: 2,
          role: 'assistant',
          at: '2026-09-05T10:00:00.000Z',
        },
      }),
      kind: 'grudge',
    };
    await sealPayload({
      v: 1,
      notes: [suya, ajena],
      cursors: [{ conversationId: CONV_A, through: 'ayer' }],
      counters: relationCountersSchema.parse({}),
    });

    await store.removeConversation(vault, CONV_A);

    // conservarla dejaria en disco la cita de una conversacion recien borrada
    const guardado = await openPayload();
    expect(guardado.notes).toEqual([ajena]);
    expect(guardado.cursors).toEqual([]);
  });

  it('una nota mal formada NO llega al disco: el guardado para en seco', async () => {
    await store.apply(vault, () =>
      state({ notes: [note({ id: '0123456789abcdef', quote: CAFES })] }),
    );
    const antes = readFileSync(file, 'utf8');

    // lo que puede colar el lado que escribe sin que TypeScript lo vea: para el
    // compilador `updatedAt` es un string cualquiera
    await expect(
      store.apply(vault, (current) => ({
        counters: current.counters,
        cursors: current.cursors,
        notes: [
          ...current.notes,
          note({ id: 'fedcba9876543210', quote: MERCADO, updatedAt: 'ayer por la noche' }),
        ],
      })),
    ).rejects.toBeInstanceOf(VaultError);

    // si se hubiera escrito, se destruiria sola en la siguiente lectura
    expect(readFileSync(file, 'utf8')).toBe(antes);
  });

  it('los datos se fuerzan a disco ANTES de renombrar', async () => {
    fsCalls.length = 0;

    await store.apply(vault, () =>
      state({ notes: [note({ id: '0123456789abcdef', quote: CAFES })] }),
    );

    expect(fsCalls).toEqual(['fsync', 'rename']);
  });

  it('UN SOBRE QUE NO SE ABRE detiene el trabajo y deja el archivo intacto', async () => {
    await store.apply(vault, () =>
      state({ notes: [note({ id: '0123456789abcdef', quote: CAFES })] }),
    );

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

  it('no deja el temporal detras', async () => {
    await store.apply(vault, () =>
      state({ notes: [note({ id: '0123456789abcdef', quote: CAFES })] }),
    );

    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('DOS CAMBIOS A LA VEZ no se pisan', async () => {
    const lento =
      (added: RelationNote) =>
      async (current: RelationSnapshot): Promise<RelationState> => {
        // el hueco entre leer y escribir, que es donde se perdia una
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          notes: [...current.notes, added],
          cursors: current.cursors,
          counters: current.counters,
        };
      };

    await Promise.all([
      store.apply(vault, lento(note({ id: '0123456789abcdef', quote: CAFES }))),
      store.apply(vault, lento(note({ id: 'fedcba9876543210', quote: MERCADO }))),
    ]);

    const leido = await store.read(vault);
    expect(leido.notes.map((each) => each.id).sort()).toEqual([
      '0123456789abcdef',
      'fedcba9876543210',
    ]);
  });

  it('borrar una conversacion se lleva sus origenes y deja los cierres sin turno', async () => {
    const cerradaAlli: RelationNote = note({
      id: 'fedcba9876543210',
      quote: MERCADO,
      origin: {
        conversationId: CONV_B,
        sequence: 2,
        role: 'assistant',
        at: '2026-09-05T10:00:00.000Z',
      },
      status: 'fulfilled',
      closure: {
        how: 'fulfilled',
        ref: {
          conversationId: CONV_A,
          sequence: 8,
          quote: 'aqui tienes las flores',
          at: '2026-09-06T10:00:00.000Z',
        },
        at: '2026-09-06T10:05:00.000Z',
      },
    });

    await store.apply(vault, () =>
      state({
        notes: [note({ id: '0123456789abcdef', quote: CAFES }), cerradaAlli],
        cursors: [cursor({ conversationId: CONV_A }), cursor({ conversationId: CONV_B })],
      }),
    );

    await store.removeConversation(vault, CONV_A);

    const leido = await store.read(vault);
    expect(leido.notes.map((each) => each.id)).toEqual(['fedcba9876543210']);
    // el cierre se conserva: reabrirlo haria que ella reclamase algo ya cumplido
    expect(leido.notes[0]?.status).toBe('fulfilled');
    expect(leido.notes[0]?.closure?.how).toBe('fulfilled');
    expect(leido.notes[0]?.closure?.ref).toBeNull();
    expect(leido.cursors.map((each) => each.conversationId)).toEqual([CONV_B]);
  });
});
