import { describe, expect, it } from 'vitest';
import type { StudioJob } from '@luxy/shared';
import {
  replaceConversationDetail,
  replaceConversationJob,
  type ConversationDetail,
} from './useConversations.js';

function job(overrides: Partial<StudioJob> = {}): StudioJob {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    shortId: 'LUX-CHAT',
    origin: 'studio',
    targetMachineId: '11111111-1111-4111-8111-111111111111',
    provider: 'kimi',
    model: null,
    projectAlias: 'demo',
    prompt: 'hola',
    status: 'completed',
    priority: 0,
    claimedBy: null,
    startedAt: '2026-08-04T10:00:01.000Z',
    completedAt: '2026-08-04T10:00:04.000Z',
    resultSummary: 'respuesta',
    errorMessage: null,
    metadata: {
      studioMode: 'conversation',
      conversationId: '44444444-4444-4444-8444-444444444444',
      conversationTurnId: '55555555-5555-4555-8555-555555555555',
      conversationTitle: 'Prueba de feedback',
      conversationUserMessage: 'hola',
      comparisonIndex: 0,
    },
    createdAt: '2026-08-04T10:00:00.000Z',
    ...overrides,
  };
}

describe('estado local de feedback de Conversaciones', () => {
  it('refleja el trabajo confirmado por el gateway sin esperar otra recarga', () => {
    const original = job();
    const updated = job({
      metadata: {
        ...original.metadata,
        studioFeedback: {
          rating: 'helpful',
          ratedAt: '2026-08-04T10:01:00.000Z',
        },
      },
    });
    const detail: ConversationDetail = { job: original, events: [] };

    expect(replaceConversationJob([original], updated)[0]).toBe(updated);
    expect(replaceConversationDetail({ [original.id]: detail }, updated)[original.id]?.job).toBe(
      updated,
    );
  });
});
