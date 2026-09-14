// el vistazo sin guardar, visto desde el IPC.
//
// `recap-sync.test.ts` ya comprueba que la pasada con `dryRun` no escribe. Lo
// que se comprueba AQUI es la costura, que es lo unico que puede romperse sin
// que aquella prueba se entere: que los argumentos tal y como llegan del
// renderer —parseados por `vaultRecapSyncArgsSchema`, con sus valores por
// defecto— siguen llevando la bandera hasta la pasada, y que el resultado que
// devuelve la pasada de verdad encaja en el esquema que viaja de vuelta.
//
// Un `.strip()` de mas, un `default(true)` mal escrito o un campo que se
// renombra en `RecapRunResult` y no en el esquema no los caza ninguna de las
// dos pruebas por separado: el relleno escribiria diecisiete fichas creyendo
// que solo estaba mirando.
//
// Ni un CLI, ni red, ni tokens. Ni una sola cadena de aqui sale de la boveda de
// nadie: los turnos y las fichas estan escritos en este archivo.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  RECAP_CLOSE,
  RECAP_OPEN,
  recapCountersSchema,
  recapEntrySchema,
  type ConversationMemory,
  type TemporalAnchor,
} from '@luxy/shared';
import { vaultRecapSyncArgsSchema, vaultRecapSyncResultSchema } from '../../shared/ipc.js';
import type { CatalogedEpisode } from './catalog-store.js';
import type { PrivateTurnView } from './conversation-store.js';
import type { RecapMutator, RecapSnapshot, RecapState } from './recap-store.js';
import type { VaultService } from './vault-service.js';
import { createAuxiliaryLane, type AuxiliaryController } from './relation-sync.js';
import { RecapSync, type RecapSyncDeps } from './recap-sync.js';

const CONV = 'aaaaaaaa-1111-4111-8111-111111111111';

const ANCHOR: TemporalAnchor = {
  instant: '2026-09-14T10:00:00.000Z',
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};

/** una ficha concreta y con sustancia: pasa el detector de vaguedad */
const RESUMEN =
  'Ella y el siguen donde lo dejaron: el la espera despierto en su casa y ella le escribe desde la cocina, descalza y con la luz apagada, contandole como le ha ido el dia.';

const FICHA = `${RECAP_OPEN}${JSON.stringify({
  version: 1,
  summary: RESUMEN,
  facts: ['Empezo: se conocieron una noche de agosto escribiendose desde dos ciudades'],
  decisions: ['Quedaron en que ella escribe primero por las mañanas'],
  plan: [],
  openQuestions: [],
  lessons: [],
  covered: { from: 0, to: 3 },
  skipped: [],
})}${RECAP_CLOSE}`;

/** cuatro turnos alternos: cabe en una sola ventana */
function conversacion(): PrivateTurnView[] {
  return Array.from({ length: 4 }, (_unused, index) => ({
    sequence: index,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text: `turno numero ${index} de aquella noche`,
    title: 'titulo',
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
  }));
}

/**
 * el almacen, en memoria y validando igual que `checkedForWrite`.
 *
 * `writes` cuenta TODA escritura, incluida la de `markSuperseded`: dejar fuera
 * esa haria que «no escribe nada» significara «no escribe fichas», que es otra
 * cosa.
 */
class FakeRecaps {
  state: RecapState = { entries: [], counters: recapCountersSchema.parse({}) };
  writes = 0;

  async read(_vault: VaultService): Promise<RecapSnapshot> {
    return { ...this.state, droppedOnRead: 0, unreadable: { entries: [] } };
  }

  async apply(vault: VaultService, mutator: RecapMutator): Promise<RecapState> {
    const next = await mutator(await this.read(vault));
    this.state = {
      entries: z.array(recapEntrySchema).parse(next.entries),
      counters: recapCountersSchema.parse(next.counters),
    };
    this.writes += 1;
    return this.state;
  }

  async markSuperseded(vault: VaultService, conversationId: string, at: string): Promise<void> {
    await this.apply(vault, (current) => ({
      counters: current.counters,
      entries: current.entries.map((entry) =>
        entry.conversationId === conversationId && entry.supersededAt === null
          ? { ...entry, supersededAt: at }
          : entry,
      ),
    }));
  }
}

interface Montaje {
  sync: RecapSync;
  recaps: FakeRecaps;
  /** cuantas veces se llamo al CLI simulado */
  calls: { count: number };
  logs: { message: string; fields?: Record<string, unknown> }[];
}

function montar(sealed?: ConversationMemory): Montaje {
  const recaps = new FakeRecaps();
  const logs: Montaje['logs'] = [];
  const calls = { count: 0 };
  const turns = conversacion();

  const controller: AuxiliaryController = {
    async runLocalTurn() {
      calls.count += 1;
      return { outcome: 'completed', text: FICHA, error: null, executedModel: 'codex-cli' };
    },
  };

  const deps: RecapSyncDeps = {
    vault: { isUnlocked: () => true } as unknown as VaultService,
    conversations: {
      async read(): Promise<PrivateTurnView[]> {
        return turns;
      },
      async latestMemory(): Promise<ConversationMemory | null> {
        return sealed ?? null;
      },
    },
    recaps,
    catalog: {
      async list(): Promise<CatalogedEpisode[]> {
        return [];
      },
    },
    preferences: {
      auxiliary: () => null,
      excluded: () => new Set<string>(),
    },
    controller,
    timeline: async () =>
      turns.map((turn) => ({
        conversationId: CONV,
        sequence: turn.sequence,
        role: turn.role,
        createdAt: turn.createdAt,
      })),
    lane: createAuxiliaryLane(),
    isSending: () => false,
    anchor: () => ANCHOR,
    log: (message, fields) => {
      logs.push({ message, ...(fields === undefined ? {} : { fields }) });
    },
  };

  return { sync: new RecapSync(deps), recaps, calls, logs };
}

describe('el vistazo sin guardar, cruzando el IPC', () => {
  it('con `dryRun: true` corre la pasada entera y NO escribe nada en el almacen', async () => {
    const montaje = montar();

    const args = vaultRecapSyncArgsSchema.parse({ projectAlias: 'luxy', dryRun: true });
    expect(args.dryRun).toBe(true);

    const result = await montaje.sync.runOnce(args);

    // la pasada corrio de verdad: se llamo al CLI y salio una ficha
    expect(montaje.calls.count).toBe(1);
    expect(result.windows).toBe(1);
    expect(result.ok).toBe(1);
    // y el disco quedo intacto: ni una escritura, ni una entrada
    expect(montaje.recaps.writes).toBe(0);
    expect(montaje.recaps.state.entries).toEqual([]);
    // el trabajo sigue pendiente, porque de verdad lo sigue estando
    expect(result.pending).toBe(1);
  });

  it('devuelve el texto que escribiria, que es lo que hay que poder leer antes', async () => {
    const montaje = montar();

    const result = await montaje.sync.runOnce(
      vaultRecapSyncArgsSchema.parse({ projectAlias: 'luxy', dryRun: true }),
    );

    expect(result.preview).toHaveLength(1);
    expect(result.preview[0]!.conversationId).toBe(CONV);
    expect(result.preview[0]!.block).toContain(RESUMEN);
    expect(result.preview[0]!.source).toBe('cli');
    expect(result.preview[0]!.chars).toBeGreaterThan(0);
  });

  it('tampoco marca la que ya tiene memoria propia', async () => {
    // `markSuperseded` tambien escribe: un vistazo que la marcara dejaria rastro
    const montaje = montar({
      version: 1,
      summary: 'lo que ya recordaba de antes',
      facts: [],
      decisions: [],
      plan: [],
      openQuestions: [],
      lessons: [],
    });

    const result = await montaje.sync.runOnce(
      vaultRecapSyncArgsSchema.parse({ projectAlias: 'luxy', dryRun: true }),
    );

    expect(result.superseded).toBe(1);
    expect(montaje.calls.count).toBe(0);
    expect(montaje.recaps.writes).toBe(0);
  });

  it('sin pedirlo se guarda: el valor por defecto no puede ser mirar y tirar', async () => {
    // si `dryRun` llegara siempre a true, el panel diria que ha rellenado
    // diecisiete conversaciones y no habria ni una ficha en disco
    const montaje = montar();

    const args = vaultRecapSyncArgsSchema.parse({ projectAlias: 'luxy' });
    expect(args.dryRun).toBe(false);

    const result = await montaje.sync.runOnce(args);

    expect(montaje.recaps.writes).toBe(1);
    expect(montaje.recaps.state.entries).toHaveLength(1);
    expect(result.preview).toEqual([]);
  });

  it('el texto que vuelve por el IPC no se queda de camino en ningun registro', async () => {
    // el bloque es contenido de la boveda: viaja al renderer como cualquier
    // turno, y a ningun archivo de log. Ni el identificador de la conversacion,
    // que con una marca de tiempo al lado ya es un dato correlacionable
    const montaje = montar();

    await montaje.sync.runOnce(
      vaultRecapSyncArgsSchema.parse({ projectAlias: 'luxy', dryRun: true }),
    );

    expect(montaje.logs).toHaveLength(1);
    const volcado = JSON.stringify(montaje.logs[0]);
    expect(volcado).not.toContain(CONV);
    expect(volcado).not.toContain(RESUMEN);
    expect(volcado).not.toContain('cocina');
  });

  it('lo que devuelve la pasada de verdad encaja en el esquema que cruza el IPC', async () => {
    // sin esto, renombrar un contador en `RecapRunResult` deja el panel leyendo
    // `undefined` y enseñando ceros donde hubo negativas
    const montaje = montar();

    const result = await montaje.sync.runOnce(
      vaultRecapSyncArgsSchema.parse({ projectAlias: 'luxy', dryRun: true }),
    );

    const parsed = vaultRecapSyncResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.preview[0]!.block).toContain(RESUMEN);
  });
});
