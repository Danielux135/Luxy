// el cursor de pendientes guarda con que dueño se reviso (`D-103`).
//
// Todo simulado: ni CLI, ni red. Lo que importa es la CARRERA que tumbo el diseño
// anterior —una extraccion que empezo antes del enganche y, al terminar,
// reescribia un cursor valido encima del reinicio— y que ya no hay reinicio que
// perder. Todo el texto es inventado.
import { describe, expect, it } from 'vitest';
import {
  RELATION_CLOSE,
  RELATION_EXTRACTOR_VERSION,
  RELATION_OPEN,
  relationCountersSchema,
  type RelationCursor,
  type TemporalAnchor,
} from '@luxy/shared';
import type { PrivateConversationSummary, PrivateTurnView } from './conversation-store.js';
import type { RelationMutator, RelationSnapshot, RelationState } from './relation-store.js';
import type { VaultService } from './vault-service.js';
import {
  RelationSync,
  createAuxiliaryLane,
  cursorMatchesOwner,
  effectiveThrough,
  type RelationSyncDeps,
} from './relation-sync.js';

const CONV = 'aaaaaaaa-1111-4111-8111-111111111111';
const NORA = 'nora-inventada';
const ANCHOR: TemporalAnchor = {
  instant: '2026-09-25T10:00:00.000Z',
  timeZone: 'Europe/Madrid',
  dayStartsAtHour: 5,
};
const VACIO = `${RELATION_OPEN}${JSON.stringify({ new: [], closed: [] })}${RELATION_CLOSE}`;

function conversacion(count: number): PrivateTurnView[] {
  return Array.from({ length: count }, (_unused, index) => ({
    sequence: index,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text: `turno inventado numero ${index}`,
    title: 'titulo',
    createdAt: new Date(Date.UTC(2026, 8, 20, 0, index)).toISOString(),
  }));
}

function cursor(over: Partial<RelationCursor> = {}): RelationCursor {
  return {
    conversationId: CONV,
    through: 3,
    throughAt: new Date(Date.UTC(2026, 8, 20, 0, 3)).toISOString(),
    version: RELATION_EXTRACTOR_VERSION,
    provider: 'codex',
    model: null,
    at: ANCHOR.instant,
    refusedVersion: null,
    refusedAtTurns: null,
    ...over,
  };
}

class FakeRelations {
  state: RelationState = { notes: [], cursors: [], counters: relationCountersSchema.parse({}) };
  async read(_vault: VaultService): Promise<RelationSnapshot> {
    return { ...this.state, droppedOnRead: 0, unreadable: { notes: [], cursors: [] } };
  }
  async apply(_vault: VaultService, mutator: RelationMutator): Promise<RelationState> {
    const next = await mutator(await this.read(_vault));
    this.state = { notes: next.notes, cursors: next.cursors, counters: next.counters };
    return this.state;
  }
}

function montar(opciones: {
  turns: PrivateTurnView[];
  owner: { characterId: string | null; linked: boolean };
  replies?: string[];
  duranteLaLlamada?: () => void;
}) {
  const relations = new FakeRelations();
  const calls: string[] = [];
  const owner = opciones.owner;
  const deps: RelationSyncDeps = {
    vault: { isUnlocked: () => true } as unknown as VaultService,
    conversations: {
      async list(): Promise<PrivateConversationSummary[]> {
        return [
          {
            conversationId: CONV,
            title: 't',
            turns: opciones.turns.length,
            updatedAt: ANCHOR.instant,
            characterId: owner.characterId,
            ownerLinked: owner.linked,
          },
        ];
      },
      async read(): Promise<PrivateTurnView[]> {
        return opciones.turns;
      },
    },
    relations,
    preferences: { auxiliary: () => null, excluded: () => new Set<string>() },
    controller: {
      async runLocalTurn(input) {
        calls.push(input.prompt);
        opciones.duranteLaLlamada?.();
        const reply = opciones.replies?.[calls.length - 1] ?? VACIO;
        return { outcome: 'completed', text: reply, error: null, executedModel: 'cli' };
      },
    },
    timeline: async () =>
      opciones.turns.map((turn) => ({
        conversationId: CONV,
        sequence: turn.sequence,
        role: turn.role,
        createdAt: turn.createdAt,
      })),
    lane: createAuxiliaryLane(),
    isSending: () => false,
    anchor: () => ANCHOR,
    log: () => undefined,
  };
  return { sync: new RelationSync(deps), relations, calls, owner };
}

describe('effectiveThrough con dueño', () => {
  const turns = conversacion(6);

  it('el mismo dueño conserva lo revisado', () => {
    expect(effectiveThrough(cursor({ owner: NORA }), turns, { characterId: NORA, linked: true })).toBe(3);
    expect(effectiveThrough(cursor({ owner: null }), turns, { characterId: null, linked: false })).toBe(3);
  });

  it('otro dueño lo invalida', () => {
    expect(effectiveThrough(cursor({ owner: null }), turns, { characterId: NORA, linked: true })).toBe(-1);
    expect(effectiveThrough(cursor({ owner: NORA }), turns, { characterId: null, linked: true })).toBe(-1);
  });

  it('un cursor anterior al campo vale sin enganches y no vale con ellos', () => {
    const antiguo = cursor();
    expect(antiguo.owner).toBeUndefined();
    expect(effectiveThrough(antiguo, turns, { characterId: NORA, linked: false })).toBe(3);
    expect(effectiveThrough(antiguo, turns, { characterId: NORA, linked: true })).toBe(-1);
    expect(cursorMatchesOwner(antiguo, { characterId: null, linked: true })).toBe(false);
  });
});

describe('la carrera con una extraccion en curso', () => {
  it('lo escrito por una pasada que empezo sin dueño nace invalido y la siguiente relee desde 0', async () => {
    const turns = conversacion(6);
    const montaje = montar({
      turns,
      owner: { characterId: null, linked: false },
      // mientras el CLI piensa, Daniel engancha la conversacion a Nora
      duranteLaLlamada: () => {
        if (montaje.calls.length === 1) {
          montaje.owner.characterId = NORA;
          montaje.owner.linked = true;
        }
      },
    });

    const primera = await montaje.sync.runOnce({ projectAlias: 'p', conversationId: CONV, limit: 1 });
    expect(primera.reviewed).toBe(1);
    const escrito = montaje.relations.state.cursors[0]!;
    // se sello con el dueño con el que SE REVISO, no con el de ahora
    expect(escrito.owner).toBeNull();
    expect(escrito.through).toBe(5);

    const segunda = await montaje.sync.runOnce({ projectAlias: 'p', conversationId: CONV, limit: 1 });
    expect(segunda.reviewed).toBe(1);
    expect(montaje.calls).toHaveLength(2);
    // la segunda leyo la conversacion entera otra vez: el primer turno esta en su prompt
    expect(montaje.calls[1]).toContain('turno inventado numero 0');
    expect(montaje.relations.state.cursors[0]!.owner).toBe(NORA);
  });

  it('una negativa conserva el dueño del cursor anterior', async () => {
    const turns = conversacion(6);
    const montaje = montar({
      turns,
      owner: { characterId: NORA, linked: true },
      replies: ['no puedo con esto'],
    });
    montaje.relations.state.cursors = [cursor({ owner: NORA, through: 1, throughAt: turns[1]!.createdAt })];
    const resultado = await montaje.sync.runOnce({
      projectAlias: 'p',
      conversationId: CONV,
      limit: 1,
      force: true,
    });
    expect(resultado.refused).toBe(1);
    expect(montaje.relations.state.cursors[0]!.owner).toBe(NORA);
    expect(montaje.relations.state.cursors[0]!.refusedVersion).toBe(RELATION_EXTRACTOR_VERSION);
  });
});

describe('releer tras cambiar el dueño', () => {
  it('hace como mucho `rounds` tandas y para cuando no avanza', async () => {
    // 90 registros: tres ventanas de 40
    const montaje = montar({ turns: conversacion(90), owner: { characterId: NORA, linked: true } });
    const hechas = await montaje.sync.reviewConversation({
      conversationId: CONV,
      projectAlias: 'p',
      rounds: 2,
    });
    expect(hechas).toBe(2);
    expect(montaje.calls).toHaveLength(2);

    const otra = montar({ turns: conversacion(6), owner: { characterId: NORA, linked: true } });
    const pocas = await otra.sync.reviewConversation({
      conversationId: CONV,
      projectAlias: 'p',
      rounds: 5,
    });
    // una tanda que revisa y una que ya no encuentra nada, sin llamar al CLI
    expect(pocas).toBe(2);
    expect(otra.calls).toHaveLength(1);
  });

  it('forgetFailure vuelve a dejar pasar una conversacion que fallo', async () => {
    const montaje = montar({ turns: conversacion(6), owner: { characterId: NORA, linked: true } });
    (montaje.sync as unknown as { failures: Map<string, string> }).failures.set(CONV, 'codex');
    expect(montaje.sync.failedConversations.has(CONV)).toBe(true);
    montaje.sync.forgetFailure(CONV);
    expect(montaje.sync.failedConversations.has(CONV)).toBe(false);
  });
});
