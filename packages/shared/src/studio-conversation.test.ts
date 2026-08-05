import { describe, expect, it } from 'vitest';
import { studioJobCreateRequestSchema } from './schemas.js';

const base = {
  targetMachineId: '11111111-1111-4111-8111-111111111111',
  provider: 'codex',
  model: null,
  projectAlias: 'demo',
  prompt: 'Usuario:\nhola\n\nAsistente:',
  priority: 0,
} as const;

describe('studioJobCreateRequestSchema para conversaciones', () => {
  it('mantiene compatibles las tareas anteriores', () => {
    expect(studioJobCreateRequestSchema.safeParse(base).success).toBe(true);
  });

  it('exige identidad, turno, titulo y mensaje en una conversacion', () => {
    const result = studioJobCreateRequestSchema.safeParse({ ...base, mode: 'conversation' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
        'conversationId',
        'conversationTurnId',
        'conversationTitle',
        'conversationUserMessage',
      ]);
    }
  });

  it('acepta una comparacion identificada', () => {
    expect(
      studioJobCreateRequestSchema.safeParse({
        ...base,
        mode: 'conversation',
        conversationId: '22222222-2222-4222-8222-222222222222',
        conversationTurnId: '33333333-3333-4333-8333-333333333333',
        conversationTitle: 'Prueba',
        conversationUserMessage: 'hola',
        comparisonIndex: 1,
      }).success,
    ).toBe(true);
  });
});
