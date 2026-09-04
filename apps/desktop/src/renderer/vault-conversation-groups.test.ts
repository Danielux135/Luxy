import { describe, expect, it } from 'vitest';
import type { PrivateConversation } from './useVault.js';
import {
  FORGOTTEN_LABEL,
  NO_CHARACTER_LABEL,
  describeWhen,
  groupConversationsByCharacter,
} from './vault-conversation-groups.js';

function conversation(overrides: Partial<PrivateConversation> = {}): PrivateConversation {
  return {
    conversationId: 'c-1',
    title: 'Sin titulo',
    turns: 2,
    updatedAt: '2026-09-01T10:00:00.000Z',
    characterId: null,
    characterLabel: null,
    ...overrides,
  };
}

describe('groupConversationsByCharacter', () => {
  it('separa los hilos de cada personaje', () => {
    const grupos = groupConversationsByCharacter([
      conversation({ conversationId: 'a', characterId: 'lia', characterLabel: 'Lía' }),
      conversation({ conversationId: 'b', characterId: 'otro', characterLabel: 'Otro' }),
      conversation({ conversationId: 'c', characterId: 'lia', characterLabel: 'Lía' }),
    ]);

    expect(grupos).toHaveLength(2);
    const lia = grupos.find((grupo) => grupo.characterId === 'lia');
    expect(lia?.label).toBe('Lía');
    expect(lia?.conversations.map((entry) => entry.conversationId)).toEqual(['a', 'c']);
  });

  it('ordena los grupos por su actividad mas reciente', () => {
    const grupos = groupConversationsByCharacter([
      conversation({
        conversationId: 'vieja',
        characterId: 'lia',
        characterLabel: 'Lía',
        updatedAt: '2026-01-01T10:00:00.000Z',
      }),
      conversation({
        conversationId: 'nueva',
        characterId: 'otro',
        characterLabel: 'Otro',
        updatedAt: '2026-09-01T10:00:00.000Z',
      }),
    ]);

    expect(grupos.map((grupo) => grupo.characterId)).toEqual(['otro', 'lia']);
  });

  it('ordena las conversaciones de un grupo con la mas reciente primero', () => {
    const [grupo] = groupConversationsByCharacter([
      conversation({
        conversationId: 'antigua',
        characterId: 'lia',
        characterLabel: 'Lía',
        updatedAt: '2026-02-01T10:00:00.000Z',
      }),
      conversation({
        conversationId: 'reciente',
        characterId: 'lia',
        characterLabel: 'Lía',
        updatedAt: '2026-08-01T10:00:00.000Z',
      }),
    ]);

    expect(grupo?.conversations.map((entry) => entry.conversationId)).toEqual([
      'reciente',
      'antigua',
    ]);
    expect(grupo?.updatedAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('deja los hilos sin personaje al final aunque sean los mas recientes', () => {
    const grupos = groupConversationsByCharacter([
      conversation({ conversationId: 'suelta', updatedAt: '2026-12-01T10:00:00.000Z' }),
      conversation({
        conversationId: 'de-lia',
        characterId: 'lia',
        characterLabel: 'Lía',
        updatedAt: '2026-01-01T10:00:00.000Z',
      }),
    ]);

    expect(grupos.map((grupo) => grupo.label)).toEqual(['Lía', NO_CHARACTER_LABEL]);
  });

  it('agrupa igual un personaje olvidado, sin perder sus hilos', () => {
    const [grupo] = groupConversationsByCharacter([
      conversation({ conversationId: 'a', characterId: 'borrado', characterLabel: null }),
      conversation({ conversationId: 'b', characterId: 'borrado', characterLabel: null }),
    ]);

    expect(grupo?.label).toBe(FORGOTTEN_LABEL);
    expect(grupo?.conversations).toHaveLength(2);
  });

  it('se queda con el nombre aunque solo venga en uno de los hilos', () => {
    const [grupo] = groupConversationsByCharacter([
      conversation({ conversationId: 'a', characterId: 'lia', characterLabel: null }),
      conversation({ conversationId: 'b', characterId: 'lia', characterLabel: 'Lía' }),
    ]);

    expect(grupo?.label).toBe('Lía');
  });

  it('no inventa grupos con una lista vacia', () => {
    expect(groupConversationsByCharacter([])).toEqual([]);
  });
});

describe('describeWhen', () => {
  // fechas locales a proposito: los dias se cuentan como los ve quien lee,
  // no en UTC
  const ahora = new Date(2026, 8, 4, 18, 0, 0);

  it('llama hoy a lo de hoy y ayer a lo de ayer', () => {
    expect(describeWhen(new Date(2026, 8, 4, 9, 0, 0).toISOString(), ahora)).toBe('hoy');
    expect(describeWhen(new Date(2026, 8, 3, 23, 0, 0).toISOString(), ahora)).toBe('ayer');
  });

  it('cuenta dias dentro de la semana', () => {
    expect(describeWhen(new Date(2026, 8, 1, 12, 0, 0).toISOString(), ahora)).toBe('hace 3 días');
  });

  it('cuenta semanas hasta el mes', () => {
    expect(describeWhen(new Date(2026, 7, 26, 12, 0, 0).toISOString(), ahora)).toBe(
      'hace una semana',
    );
    expect(describeWhen(new Date(2026, 7, 14, 12, 0, 0).toISOString(), ahora)).toBe(
      'hace 3 semanas',
    );
  });

  it('a partir del mes da la fecha, que dice mas que la cuenta atras', () => {
    expect(describeWhen(new Date(2026, 2, 12, 12, 0, 0).toISOString(), ahora)).toContain('marzo');
  });

  it('no revienta con una fecha que no lo es', () => {
    expect(describeWhen('no es una fecha', ahora)).toBe('sin fecha');
  });

  it('trata como hoy algo con fecha futura, en vez de decir hace -1 dias', () => {
    expect(describeWhen(new Date(2026, 8, 5, 12, 0, 0).toISOString(), ahora)).toBe('hoy');
  });
});
