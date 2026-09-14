// pruebas de como se lee y se corrige la lista de pendientes.
//
// Sin React: lo que se prueba es lo que decide la pantalla —de quien es cada
// promesa, que botones tienen sentido y como se llama cada cosa—, que es
// exactamente lo que no se puede comprobar mirando una captura.
import { describe, it, expect } from 'vitest';
import type { PendingAffair } from './useVault.js';
import { FORGOTTEN_LABEL, NO_CHARACTER_LABEL } from './vault-conversation-groups.js';
import {
  PENDING_PARTY_LABELS,
  groupPendingByCharacter,
  pendingDecisionsFor,
} from './vault-pending.js';

const LIA = 'c0000000-3333-4333-8333-333333333333';
const OTRA = 'd0000000-4444-4444-8444-444444444444';

function affair(over: Partial<PendingAffair> = {}): PendingAffair {
  return {
    id: '0123456789abcdef',
    characterId: LIA,
    kind: 'promise',
    by: 'user',
    quote: 'mañana te traigo dos cafés y una tarta de chocolate a la cama',
    day: '2026-09-04',
    status: 'open',
    decidedBy: 'extractor',
    reopenedByDaniel: false,
    extractedBy: 'codex',
    origin: { conversationId: 'aaaaaaaa-1111-4111-8111-111111111111', sequence: 4 },
    quoteBroken: false,
    closedDay: null,
    ...over,
  };
}

const labels = new Map([
  [LIA, 'Lía'],
  [OTRA, 'Otra'],
]);

describe('groupPendingByCharacter', () => {
  it('separa lo que le debe a cada personaje', () => {
    const grupos = groupPendingByCharacter(
      [
        affair({ id: 'a0000000000000a1', characterId: LIA }),
        affair({ id: 'b0000000000000b1', characterId: OTRA, day: '2026-09-08' }),
        affair({ id: 'a0000000000000a2', characterId: LIA }),
      ],
      labels,
    );

    expect(grupos).toHaveLength(2);
    const lia = grupos.find((grupo) => grupo.characterId === LIA);
    expect(lia?.label).toBe('Lía');
    expect(lia?.pending.map((each) => each.id)).toEqual(['a0000000000000a1', 'a0000000000000a2']);
  });

  it('cuenta solo lo abierto: es lo unico que ella puede sacar', () => {
    const grupos = groupPendingByCharacter(
      [
        affair({ id: 'a0000000000000a1', status: 'open' }),
        affair({ id: 'a0000000000000a2', status: 'fulfilled', closedDay: '2026-09-10' }),
        affair({ id: 'a0000000000000a3', status: 'dismissed', closedDay: '2026-09-11' }),
      ],
      labels,
    );

    expect(grupos[0]?.open).toBe(1);
    // lo cerrado NO desaparece: una lapida que no se ve no se puede reabrir
    // cuando el que se equivoco fue Daniel
    expect(grupos[0]?.pending).toHaveLength(3);
  });

  it('los hilos sin personaje van al final, por recientes que sean', () => {
    const grupos = groupPendingByCharacter(
      [
        affair({ id: 'n0000000000000n1', characterId: null, day: '2026-09-12' }),
        affair({ id: 'a0000000000000a1', characterId: LIA, day: '2026-09-01' }),
      ],
      labels,
    );

    expect(grupos.map((grupo) => grupo.label)).toEqual(['Lía', NO_CHARACTER_LABEL]);
  });

  it('ordena los grupos por su pendiente mas reciente', () => {
    const grupos = groupPendingByCharacter(
      [
        affair({ id: 'a0000000000000a1', characterId: LIA, day: '2026-09-01' }),
        affair({ id: 'b0000000000000b1', characterId: OTRA, day: '2026-09-09' }),
      ],
      labels,
    );

    expect(grupos.map((grupo) => grupo.characterId)).toEqual([OTRA, LIA]);
  });

  it('un personaje olvidado conserva sus promesas y se puede repasar igual', () => {
    const grupos = groupPendingByCharacter(
      [affair({ characterId: 'e0000000-5555-4555-8555-555555555555' })],
      labels,
    );

    expect(grupos[0]?.label).toBe(FORGOTTEN_LABEL);
  });
});

describe('los botones de cada pendiente', () => {
  it('lo abierto se puede cerrar de tres formas, y no «reabrir»', () => {
    expect(pendingDecisionsFor('open')).toEqual(['fulfilled', 'released', 'dismissed']);
  });

  it('lo cerrado siempre se puede reabrir', () => {
    // el que se equivoca tambien puede ser Daniel: dar por cumplida la que no
    // era deja a ella callada para siempre sobre algo que el sigue debiendo
    for (const status of ['fulfilled', 'released', 'dismissed'] as const) {
      expect(pendingDecisionsFor(status)).toContain('open');
      expect(pendingDecisionsFor(status)).not.toContain(status);
      expect(pendingDecisionsFor(status)).toHaveLength(3);
    }
  });
});

describe('quien se comprometio', () => {
  it('se dice desde el lado de Daniel, al reves que en el bloque del prompt', () => {
    // en el prompt lo lee ELLA, y alli `user` es «te lo prometio el». Aqui lo
    // lee el: confundirlo pondria cada promesa en la boca contraria
    expect(PENDING_PARTY_LABELS.user).toBe('Lo prometiste tú');
    expect(PENDING_PARTY_LABELS.character).toBe('Te lo prometió ella');
    expect(PENDING_PARTY_LABELS.both).toBe('Lo quedasteis los dos');
  });
});
