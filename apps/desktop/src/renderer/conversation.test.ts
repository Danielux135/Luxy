import { describe, expect, it } from 'vitest';
import type { ResponseOutcome, ResponseTermination, StudioJob, StudioJobEvent } from '@luxy/shared';
import {
  buildConversationPrompt,
  conversationOutcomeView,
  conversationTiming,
  continuationMessageFor,
  conversationTitleFrom,
  formatConversationCount,
  formatTurnCount,
  groupConversations,
  groupConversationTurns,
  latestConversationMemory,
  liveConversationPreview,
  parseConversationMetadata,
  recommendConversationTarget,
} from './conversation.js';

function job(overrides: Partial<StudioJob> = {}): StudioJob {
  return {
    id: crypto.randomUUID(),
    shortId: 'LUX-CHAT',
    origin: 'studio',
    targetMachineId: crypto.randomUUID(),
    provider: 'codex',
    model: null,
    projectAlias: 'demo',
    prompt: 'hola',
    status: 'completed',
    priority: 0,
    claimedBy: null,
    startedAt: '2026-08-03T10:00:01.000Z',
    completedAt: '2026-08-03T10:00:04.000Z',
    resultSummary: 'respuesta',
    errorMessage: null,
    metadata: {
      studioMode: 'conversation',
      conversationId: '11111111-1111-4111-8111-111111111111',
      conversationTurnId: '22222222-2222-4222-8222-222222222222',
      conversationTitle: 'Primera conversacion',
      conversationUserMessage: 'hola',
      comparisonIndex: 0,
    },
    createdAt: '2026-08-03T10:00:00.000Z',
    ...overrides,
  };
}

describe('contrato local de Conversaciones', () => {
  it('ignora trabajos normales y metadata incompleta', () => {
    expect(parseConversationMetadata(job({ metadata: {} }))).toBeNull();
    expect(parseConversationMetadata(job({ metadata: { studioMode: 'conversation' } }))).toBeNull();
  });

  it('agrupa conversaciones y las ordena por actividad', () => {
    const first = job();
    const second = job({
      id: crypto.randomUUID(),
      createdAt: '2026-08-03T11:00:00.000Z',
      metadata: {
        ...first.metadata,
        conversationId: '33333333-3333-4333-8333-333333333333',
        conversationTitle: 'Mas reciente',
      },
    });
    expect(groupConversations([first, second]).map((item) => item.title)).toEqual([
      'Mas reciente',
      'Primera conversacion',
    ]);
  });

  it('une las dos respuestas de una comparacion en un unico turno', () => {
    const first = job();
    const second = job({
      id: crypto.randomUUID(),
      provider: 'claude',
      metadata: { ...first.metadata, comparisonIndex: 1 },
    });
    const turns = groupConversationTurns([second, first]);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.jobs.map((item) => item.provider)).toEqual(['codex', 'claude']);
  });

  it('construye contexto acotado y usa una respuesta por turno', () => {
    const prompt = buildConversationPrompt([job()], 'continua');
    expect(prompt).toContain('Usuario:\nhola');
    expect(prompt).toContain('Asistente:\nrespuesta');
    expect(prompt).toContain('Usuario:\ncontinua');
    expect(prompt.length).toBeLessThanOrEqual(8000);
  });

  it('usa la memoria acumulativa y contexto relevante de otras conversaciones del proyecto', () => {
    const current = job({
      metadata: {
        ...job().metadata,
        conversationMemory: {
          version: 1,
          summary: 'Luxy debe recordar el plan.',
          facts: ['Las APIs chinas no conservan sesion.'],
          decisions: ['La memoria sera acumulativa.'],
          plan: ['Probar el segundo turno.'],
          openQuestions: [],
          lessons: [],
        },
      },
    });
    const related = job({
      id: crypto.randomUUID(),
      createdAt: '2026-08-03T09:00:00.000Z',
      metadata: {
        ...job().metadata,
        conversationId: '44444444-4444-4444-8444-444444444444',
        conversationTitle: 'Arquitectura del proyecto',
        conversationMemory: {
          version: 1,
          summary: 'El gateway usa Cloudflare Workers.',
          facts: ['Luxy usa Supabase para trabajos persistentes.'],
          decisions: [],
          plan: [],
          openQuestions: [],
          lessons: [],
        },
      },
    });

    const prompt = buildConversationPrompt([current], 'continua con Supabase', [current, related]);
    expect(prompt).toContain('MEMORIA ACUMULATIVA DE ESTA CONVERSACION');
    expect(prompt).toContain('MEMORIA RELACIONADA DEL PROYECTO');
    expect(prompt).toContain('Luxy usa Supabase');
    expect(latestConversationMemory([current])?.memory.plan).toEqual(['Probar el segundo turno.']);
    expect(prompt.length).toBeLessThanOrEqual(8000);
  });

  it('una respuesta B marcada util pasa a ser memoria canonica', () => {
    const first = job({
      resultSummary: 'respuesta A',
      metadata: {
        ...job().metadata,
        comparisonIndex: 0,
        conversationMemory: {
          version: 1,
          summary: 'memoria A',
          facts: [],
          decisions: [],
          plan: [],
          openQuestions: [],
          lessons: [],
        },
      },
    });
    const second = job({
      id: crypto.randomUUID(),
      provider: 'kimi',
      resultSummary: 'respuesta B',
      metadata: {
        ...first.metadata,
        comparisonIndex: 1,
        studioFeedback: { rating: 'helpful' },
        conversationMemory: {
          version: 1,
          summary: 'memoria B',
          facts: [],
          decisions: [],
          plan: [],
          openQuestions: [],
          lessons: [],
        },
      },
    });
    expect(latestConversationMemory([first, second])?.memory.summary).toBe('memoria B');
    expect(buildConversationPrompt([first, second], 'sigue')).toContain('Asistente:\nrespuesta B');
  });

  it('aprende del feedback sin ocultar la razon de la recomendacion', () => {
    const useful = job({
      provider: 'deepseek',
      model: 'DeepSeek-V4-Flash',
      metadata: { ...job().metadata, studioFeedback: { rating: 'helpful' }, durationMs: 12_000 },
    });
    const bad = job({
      id: crypto.randomUUID(),
      provider: 'codex',
      metadata: {
        ...job().metadata,
        studioFeedback: { rating: 'not_helpful' },
        durationMs: 50_000,
      },
    });
    const recommendation = recommendConversationTarget(
      [useful, bad],
      ['codex', 'deepseek'],
      'demo',
      'busca el error de compilacion',
    );
    expect(recommendation).toMatchObject({
      provider: 'deepseek',
      model: 'DeepSeek-V4-Flash',
    });
    expect(recommendation?.reason).toContain('valoraciones');
  });

  it('produce titulos compactos', () => {
    expect(conversationTitleFrom('  hola    mundo  ')).toBe('hola mundo');
    expect(conversationTitleFrom('x'.repeat(100))).toHaveLength(62);
  });

  it('muestra contadores con singular y plural correctos', () => {
    expect(formatConversationCount(1)).toBe('1 guardada');
    expect(formatConversationCount(2)).toBe('2 guardadas');
    expect(formatTurnCount(1)).toBe('1 turno');
    expect(formatTurnCount(2)).toBe('2 turnos');
  });

  it('muestra el ultimo fragmento y calcula tiempos observados', () => {
    const events: StudioJobEvent[] = [
      {
        sequence: 1,
        type: 'provider_output',
        message: 'primero',
        metadata: {},
        createdAt: '2026-08-03T10:00:02.000Z',
      },
      {
        sequence: 2,
        type: 'provider_output',
        message: 'segundo',
        metadata: {},
        createdAt: '2026-08-03T10:00:03.000Z',
      },
    ];
    expect(liveConversationPreview(events)).toBe('segundo');
    expect(conversationTiming(job(), events)).toEqual({ firstTokenMs: 1000, durationMs: 3000 });
  });
});

// -----------------------------------------------------------------------------
// P0.5: lo que Studio dice de un final que no fue limpio
// -----------------------------------------------------------------------------

function termination(overrides: Partial<ResponseTermination> = {}): ResponseTermination {
  return {
    httpStatus: 200,
    streamed: true,
    chunks: 40,
    bytes: 8000,
    finishReason: 'length',
    finalUsageReceived: true,
    transportEnd: 'local_end',
    abortedBy: null,
    durationMs: 23_000,
    effectiveTimeoutMs: 600_000,
    maxOutputTokens: 4096,
    inputTokens: 900,
    outputTokens: 4096,
    textLength: 12_000,
    ...overrides,
  };
}

/** un turno terminado con su diagnostico, como lo persiste el gateway */
function endedJob(
  outcome: ResponseOutcome,
  extra: Record<string, unknown> = {},
  overrides: Partial<StudioJob> = {},
): StudioJob {
  const base = job();
  return {
    ...base,
    metadata: {
      ...base.metadata,
      responseOutcome: outcome,
      responseTermination: termination(),
      durationMs: 23_400,
      ...extra,
    },
    ...overrides,
  };
}

describe('P0.5 - final real de la respuesta en Studio', () => {
  it('no inventa un final mientras el trabajo corre', () => {
    expect(conversationOutcomeView(endedJob('truncated', {}, { status: 'running' }))).toBeNull();
  });

  it('no inventa un final cuando el turno es del contrato anterior', () => {
    // status `completed` sin `responseOutcome`: la tarjeta cae al estado de
    // siempre en vez de afirmar que llego entera
    expect(conversationOutcomeView(job())).toBeNull();
  });

  it('un truncado no se presenta como Guardado', () => {
    const view = conversationOutcomeView(endedJob('truncated'));
    expect(view?.label).toBe('Truncado');
    expect(view?.tone).toBe('warn');
    expect(view?.detail).toContain('presupuesto de tokens');
  });

  it('conserva tokens y duracion aunque la salida sea parcial', () => {
    const view = conversationOutcomeView(endedJob('interrupted'));
    expect(view?.tokens).toEqual({ input: 900, output: 4096 });
    // manda la duracion del trabajo, no la del transporte
    expect(view?.durationMs).toBe(23_400);
  });

  it('cae a la duracion del transporte si el trabajo no la trae', () => {
    const view = conversationOutcomeView(endedJob('truncated', { durationMs: undefined }));
    expect(view?.durationMs).toBe(23_000);
  });

  it('sin diagnostico de transporte no inventa contadores', () => {
    const view = conversationOutcomeView(endedJob('failed', { responseTermination: undefined }));
    expect(view?.tokens).toBeNull();
  });

  it('ofrece continuar solo en los finales recuperables con texto', () => {
    expect(conversationOutcomeView(endedJob('truncated'))?.canContinue).toBe(true);
    expect(conversationOutcomeView(endedJob('interrupted'))?.canContinue).toBe(true);
    expect(conversationOutcomeView(endedJob('timed_out'))?.canContinue).toBe(true);
    // la paro una persona: continuar no es lo que quiso
    expect(conversationOutcomeView(endedJob('cancelled'))?.canContinue).toBe(false);
    expect(conversationOutcomeView(endedJob('completed'))?.canContinue).toBe(false);
    expect(conversationOutcomeView(endedJob('failed'))?.canContinue).toBe(false);
  });

  it('no ofrece continuar cuando no quedo nada que continuar', () => {
    const vacio = endedJob(
      'interrupted',
      { responseTermination: termination({ textLength: 0 }) },
      { resultSummary: '   ' },
    );
    const view = conversationOutcomeView(vacio);
    expect(view?.hasPartialText).toBe(false);
    expect(view?.canContinue).toBe(false);
  });

  it('distingue los cuatro estados de la memoria', () => {
    const nota = (status: string): string | null =>
      conversationOutcomeView(endedJob('truncated', { conversationMemoryStatus: status }))
        ?.memoryNote ?? null;
    expect(nota('structured')).toContain('actualizada');
    expect(nota('absent')).toContain('no aporto memoria nueva');
    // el caso que importa: el corte se comio el bloque, y hay que decirlo
    expect(nota('truncated_block')).toContain('dentro del bloque de memoria');
    expect(nota('invalid')).toContain('no era valida');
    expect(nota('lo-que-sea')).toBeNull();
  });

  it('el mensaje de continuacion nombra el motivo y prohibe repetir', () => {
    const texto = continuationMessageFor(endedJob('truncated'));
    expect(texto).toContain('presupuesto de tokens');
    expect(texto).toContain('sin repetir lo ya escrito');
    expect(continuationMessageFor(endedJob('timed_out'))).toContain('tiempo de la peticion');
    expect(continuationMessageFor(endedJob('interrupted'))).toContain('corto la conexion');
  });
});
