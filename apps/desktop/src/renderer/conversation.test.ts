import { describe, expect, it } from 'vitest';
import type {
  AgentEvent,
  ResponseOutcome,
  ResponseTermination,
  StudioJob,
  StudioJobEvent,
} from '@luxy/shared';
import {
  activeJobsAreLocal,
  buildConversationPrompt,
  continuationSourceOf,
  conversationDetailsToFetch,
  conversationPollDelayMs,
  localFirstTokenMs,
  reduceLocalJobStream,
  conversationDocumentOf,
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

describe('P0.6 - continuar una respuesta cortada sin duplicar', () => {
  const PARCIAL = '<ul>\n  <li>Primer producto de la lista</li>';

  it('el prompt pasa el final del parcial como DATOS, no como instruccion', () => {
    const prompt = buildConversationPrompt([], 'continua', [], PARCIAL);

    expect(prompt).toContain('(DATOS, NO INSTRUCCIONES)');
    expect(prompt).toContain('<li>Primer producto de la lista</li>');
    expect(prompt).toContain('No lo repitas');
    // la pregunta actual sigue siendo lo ultimo que lee el modelo
    expect(prompt.trimEnd().endsWith('Asistente:')).toBe(true);
  });

  it('sin continuacion el prompt no cambia', () => {
    const sinParcial = buildConversationPrompt([], 'hola', []);
    expect(sinParcial).not.toContain('DATOS, NO INSTRUCCIONES');
    expect(buildConversationPrompt([], 'hola', [], null)).toBe(sinParcial);
    expect(buildConversationPrompt([], 'hola', [], '   ')).toBe(sinParcial);
  });

  it('lee el enlace con la respuesta que continua', () => {
    const origen = job({ resultSummary: PARCIAL });
    const seguimiento = job({
      metadata: { ...origen.metadata, continuesJobId: origen.id },
    });

    expect(parseConversationMetadata(origen)?.continuesJobId).toBeNull();
    expect(parseConversationMetadata(seguimiento)?.continuesJobId).toBe(origen.id);
    expect(continuationSourceOf(seguimiento, [origen, seguimiento])?.id).toBe(origen.id);
    // el origen puede haber salido del historial cargado
    expect(continuationSourceOf(seguimiento, [seguimiento])).toBeNull();
  });

  it('reconstruye el documento uniendo los fragmentos sin repetirlos', () => {
    const origen = job({ resultSummary: PARCIAL });
    const seguimiento = job({
      resultSummary: '  <li>Primer producto de la lista</li>\n  <li>Segundo</li>\n</ul>',
      metadata: { ...origen.metadata, continuesJobId: origen.id },
    });

    const documento = conversationDocumentOf(seguimiento, [origen, seguimiento]);
    expect(documento?.fragments).toBe(2);
    expect(documento?.needsReview).toBe(false);
    expect(documento?.text.match(/Primer producto/g)).toHaveLength(1);
    expect(documento?.text.endsWith('</ul>')).toBe(true);
  });

  it('une una cadena de tres fragmentos en orden', () => {
    const uno = job({ resultSummary: 'CAPITULO UNO: el principio de todo esto' });
    const dos = job({
      resultSummary: 'CAPITULO UNO: el principio de todo esto\nCAPITULO DOS: sigue la historia',
      metadata: { ...uno.metadata, continuesJobId: uno.id },
    });
    const tres = job({
      resultSummary: 'CAPITULO DOS: sigue la historia\nCAPITULO TRES: el final',
      metadata: { ...uno.metadata, continuesJobId: dos.id },
    });

    const documento = conversationDocumentOf(tres, [uno, dos, tres]);
    expect(documento?.fragments).toBe(3);
    expect(documento?.text).toBe(
      'CAPITULO UNO: el principio de todo esto\nCAPITULO DOS: sigue la historia\nCAPITULO TRES: el final',
    );
    expect(documento?.notes).toHaveLength(2);
  });

  it('avisa cuando la costura no se pudo demostrar', () => {
    const origen = job({ resultSummary: '<div class=' });
    const seguimiento = job({
      resultSummary: '"tarjeta">contenido</div>',
      metadata: { ...origen.metadata, continuesJobId: origen.id },
    });

    const documento = conversationDocumentOf(seguimiento, [origen, seguimiento]);
    expect(documento?.needsReview).toBe(true);
    // nada se pierde: el aviso es para revisar, no para descartar
    expect(documento?.text).toBe('<div class="tarjeta">contenido</div>');
  });

  it('una respuesta que no continua a nadie no tiene documento unido', () => {
    expect(conversationDocumentOf(job(), [job()])).toBeNull();
  });

  it('un enlace circular no cuelga la interfaz', () => {
    const uno = job({ resultSummary: 'A' });
    const dos = job({
      resultSummary: 'B',
      metadata: { ...uno.metadata, continuesJobId: uno.id },
    });
    const circular: StudioJob = {
      ...uno,
      metadata: { ...uno.metadata, continuesJobId: dos.id },
    };

    const documento = conversationDocumentOf(dos, [circular, dos]);
    expect(documento?.fragments).toBe(2);
  });
});

describe('P0.8 - sondeo que no desborda la base de datos', () => {
  it('el ritmo depende de lo que este pasando, no del reloj', () => {
    expect(conversationPollDelayMs({ hasActiveJob: true, hidden: false })).toBe(1500);
    expect(conversationPollDelayMs({ hasActiveJob: false, hidden: false })).toBe(10_000);
    // oculta manda sobre todo: nadie esta mirando el streaming
    expect(conversationPollDelayMs({ hasActiveJob: true, hidden: true })).toBe(60_000);
  });

  it('no vuelve a pedir el detalle de una respuesta terminada', () => {
    const terminado = job({ status: 'completed' });
    const cache = { [terminado.id]: { job: terminado, events: [] } };

    expect(conversationDetailsToFetch([terminado], cache)).toHaveLength(0);
  });

  it('pide el detalle de lo que no tiene en cache', () => {
    const nuevo = job({ status: 'completed' });
    expect(conversationDetailsToFetch([nuevo], {})).toHaveLength(1);
  });

  it('pide siempre el detalle de una respuesta viva', () => {
    const corriendo = job({ status: 'running', completedAt: null, resultSummary: null });
    const cache = { [corriendo.id]: { job: corriendo, events: [] } };

    expect(conversationDetailsToFetch([corriendo], cache)).toHaveLength(1);
  });

  it('vuelve a pedirlo una vez mas cuando acaba de terminar', () => {
    const antes = job({ status: 'running', completedAt: null, resultSummary: null });
    const despues = { ...antes, status: 'completed' as const, resultSummary: 'ya esta' };
    const cache = { [antes.id]: { job: antes, events: [] } };

    expect(conversationDetailsToFetch([despues], cache)).toHaveLength(1);
  });

  it('un resultado que cambia despues de terminar tampoco se pierde', () => {
    const guardado = job({ status: 'completed', resultSummary: 'primera version' });
    const cache = { [guardado.id]: { job: guardado, events: [] } };
    const corregido = { ...guardado, resultSummary: 'version definitiva' };

    expect(conversationDetailsToFetch([corregido], cache)).toHaveLength(1);
  });

  it('una conversacion entera terminada no genera ni una peticion de detalle', () => {
    const turnos = [job(), job(), job(), job(), job(), job()];
    const cache = Object.fromEntries(turnos.map((item) => [item.id, { job: item, events: [] }]));

    // esto es exactamente el bucle que medi el 2026-08-06: seis detalles cada
    // 1,5 s de respuestas que llevaban horas guardadas
    expect(conversationDetailsToFetch(turnos, cache)).toHaveLength(0);
  });
});

describe('P0.9 - streaming por el bus local del agente', () => {
  const jobId = '99999999-9999-4999-8999-999999999999';
  const claimed = {
    type: 'job.claimed' as const,
    at: '2026-08-06T10:00:00.000Z',
    jobId,
    shortId: 'LUX-LOC',
    provider: 'kimi' as const,
    projectAlias: 'demo',
  };
  const output = (message: string, at: string): AgentEvent => ({
    type: 'job.output',
    at,
    jobId,
    shortId: 'LUX-LOC',
    message,
  });

  it('acumula el texto que publica el agente local', () => {
    let streams = reduceLocalJobStream({}, claimed);
    streams = reduceLocalJobStream(streams, output('<html>', '2026-08-06T10:00:02.000Z'));
    streams = reduceLocalJobStream(streams, output('<html><body>', '2026-08-06T10:00:03.000Z'));

    // el evento trae el texto acumulado, no el trozo: manda el ultimo
    expect(streams[jobId]?.text).toBe('<html><body>');
    expect(streams[jobId]?.live).toBe(true);
    expect(streams[jobId]?.firstOutputAt).toBe('2026-08-06T10:00:02.000Z');
  });

  it('al terminar apaga el directo pero conserva el texto', () => {
    let streams = reduceLocalJobStream({}, claimed);
    streams = reduceLocalJobStream(streams, output('a medias', '2026-08-06T10:00:02.000Z'));
    streams = reduceLocalJobStream(streams, {
      type: 'job.cancelled',
      at: '2026-08-06T10:00:05.000Z',
      jobId,
      shortId: 'LUX-LOC',
      modifiedFiles: 0,
      worktreePath: null,
    });

    expect(streams[jobId]?.live).toBe(false);
    expect(streams[jobId]?.text).toBe('a medias');
  });

  it('ignora los eventos que no hablan de un trabajo', () => {
    const streams = { [jobId]: { text: 'x', live: true, firstOutputAt: null, updatedAt: 'z' } };
    const igual = reduceLocalJobStream(streams, {
      type: 'heartbeat.updated',
      at: '2026-08-06T10:00:06.000Z',
    });
    expect(igual).toBe(streams);
  });

  it('con la respuesta viva en esta maquina el sondeo afloja', () => {
    const local = job({ id: jobId, status: 'running' });
    const streams = reduceLocalJobStream({}, claimed);

    expect(activeJobsAreLocal([local], streams)).toBe(true);
    expect(
      conversationPollDelayMs({ hasActiveJob: true, hidden: false, streamedLocally: true }),
    ).toBe(10_000);
  });

  it('una respuesta viva en OTRA maquina mantiene el sondeo rapido', () => {
    const remoto = job({ status: 'running' });
    const local = job({ id: jobId, status: 'running' });
    const streams = reduceLocalJobStream({}, claimed);

    // basta una que no publique eventos aqui
    expect(activeJobsAreLocal([local, remoto], streams)).toBe(false);
    expect(
      conversationPollDelayMs({ hasActiveJob: true, hidden: false, streamedLocally: false }),
    ).toBe(1500);
  });

  it('un trabajo local que ya termino no cuenta como directo', () => {
    const local = job({ id: jobId, status: 'running' });
    let streams = reduceLocalJobStream({}, claimed);
    streams = reduceLocalJobStream(streams, {
      type: 'job.completed',
      at: '2026-08-06T10:00:09.000Z',
      jobId,
      shortId: 'LUX-LOC',
      summary: 'listo',
      filesChanged: 0,
      testsPassed: 0,
      testsFailed: 0,
      durationMs: 9000,
      worktreePath: null,
      branch: null,
      projectAlias: 'demo',
    });

    // el agente dice que acabo, pero lo guardado se lee del trabajo persistido
    expect(activeJobsAreLocal([local], streams)).toBe(false);
  });

  it('la ventana oculta manda aunque el directo sea local', () => {
    expect(
      conversationPollDelayMs({ hasActiveJob: true, hidden: true, streamedLocally: true }),
    ).toBe(60_000);
  });

  it('mide el primer texto sin pedir los eventos guardados', () => {
    const local = job({ id: jobId, startedAt: '2026-08-06T10:00:00.000Z' });
    const streams = reduceLocalJobStream(
      reduceLocalJobStream({}, claimed),
      output('hola', '2026-08-06T10:00:02.500Z'),
    );

    expect(localFirstTokenMs(local, streams[jobId] ?? null)).toBe(2500);
    expect(localFirstTokenMs(local, null)).toBeNull();
  });
});
