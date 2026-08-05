// pruebas de la clasificacion del final de una respuesta.
//
// POR QUE EXISTE: antes solo habia "salio bien" y "fallo". Una web generada
// durante 23 minutos que acaba a mitad de una etiqueta no es ninguna de las
// dos, y tratarla como fallo tira trabajo real. Cada final tiene que llegar a
// un estado unico, y ninguno puede quedarse sin clasificar.
import { describe, it, expect } from 'vitest';
import {
  classifyResponseOutcome,
  isRecoverableOutcome,
  describeResponseOutcome,
  RESPONSE_OUTCOME_LABELS,
} from './response-outcome.js';
import { RESPONSE_OUTCOMES } from './constants.js';
import type { ResponseTermination } from './schemas.js';
import type { ResponseOutcome } from './types.js';

function termination(overrides: Partial<ResponseTermination> = {}): ResponseTermination {
  return {
    httpStatus: 200,
    streamed: true,
    chunks: 10,
    bytes: 4096,
    durationMs: 1000,
    transportEnd: 'done_marker',
    finishReason: 'stop',
    finalUsageReceived: true,
    abortedBy: null,
    effectiveTimeoutMs: 3_600_000,
    maxOutputTokens: 8192,
    inputTokens: 100,
    outputTokens: 200,
    textLength: 500,
    ...overrides,
  };
}

describe('classifyResponseOutcome', () => {
  it('completa: señal terminal valida con texto', () => {
    expect(
      classifyResponseOutcome({
        termination: termination(),
        cancelled: false,
        failed: false,
        textLength: 500,
      }),
    ).toBe('completed');
  });

  it('completa: cierre HTTP normal sin [DONE]', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({ transportEnd: 'body_closed', finishReason: null }),
        cancelled: false,
        failed: false,
        textLength: 500,
      }),
    ).toBe('completed');
  });

  it('truncada: finish_reason length manda aunque no lanzara nada', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({ finishReason: 'length' }),
        cancelled: false,
        failed: false,
        textLength: 24_910,
      }),
    ).toBe('truncated');
  });

  it('interrumpida: el socket se cayo DESPUES de recibir contenido', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({ transportEnd: 'read_error', finishReason: null }),
        cancelled: false,
        failed: true,
        textLength: 8,
      }),
    ).toBe('interrupted');
  });

  it('fallo: el socket se cayo sin haber recibido nada', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({ transportEnd: 'read_error', finishReason: null, textLength: 0 }),
        cancelled: false,
        failed: true,
        textLength: 0,
      }),
    ).toBe('failed');
  });

  it('tiempo agotado: lo aborto el tope de Luxy, no el usuario', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({
          transportEnd: 'read_error',
          finishReason: null,
          abortedBy: 'request_timeout',
        }),
        cancelled: false,
        failed: true,
        textLength: 1200,
      }),
    ).toBe('timed_out');
  });

  it('cancelada: la peticion del usuario manda sobre cualquier otra señal', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({ finishReason: 'length' }),
        cancelled: true,
        failed: true,
        textLength: 1200,
      }),
    ).toBe('cancelled');
  });

  it('cancelada tambien cuando solo lo dice el transporte', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({ transportEnd: 'read_error', abortedBy: 'user' }),
        cancelled: false,
        failed: true,
        textLength: 10,
      }),
    ).toBe('cancelled');
  });

  it('el cierre local de Luxy tras una señal terminal es una respuesta completa', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({
          transportEnd: 'local_end',
          abortedBy: 'local_finalization',
        }),
        cancelled: false,
        failed: false,
        textLength: 500,
      }),
    ).toBe('completed');
  });

  it('un cierre limpio sin texto no es un exito', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({ transportEnd: 'body_closed', finishReason: null }),
        cancelled: false,
        failed: false,
        textLength: 0,
      }),
    ).toBe('failed');
  });

  it('sin diagnostico no se inventa un motivo', () => {
    // un proveedor sin instrumentar (Claude, Codex) sigue funcionando
    expect(
      classifyResponseOutcome({
        termination: null,
        cancelled: false,
        failed: false,
        textLength: 500,
      }),
    ).toBe('completed');
    expect(
      classifyResponseOutcome({ termination: null, cancelled: false, failed: true, textLength: 0 }),
    ).toBe('failed');
    expect(
      classifyResponseOutcome({ termination: null, cancelled: false, failed: true, textLength: 9 }),
    ).toBe('interrupted');
  });

  it('una respuesta sin streaming se clasifica igual', () => {
    expect(
      classifyResponseOutcome({
        termination: termination({ streamed: false, transportEnd: 'no_stream' }),
        cancelled: false,
        failed: false,
        textLength: 40,
      }),
    ).toBe('completed');
  });
});

describe('recuperacion y etiquetas', () => {
  it('solo truncado, interrumpido y tiempo agotado admiten continuacion', () => {
    const recuperables = RESPONSE_OUTCOMES.filter((outcome) => isRecoverableOutcome(outcome));
    expect(recuperables).toEqual(['truncated', 'interrupted', 'timed_out']);
  });

  it('cada final tiene etiqueta y explicacion', () => {
    for (const outcome of RESPONSE_OUTCOMES) {
      expect(RESPONSE_OUTCOME_LABELS[outcome as ResponseOutcome]).toBeTruthy();
      expect(describeResponseOutcome(outcome as ResponseOutcome).length).toBeGreaterThan(10);
    }
  });

  it('los finales recuperables dicen que se conserva lo generado', () => {
    for (const outcome of ['truncated', 'interrupted', 'timed_out'] as const) {
      expect(describeResponseOutcome(outcome)).toContain('conserva');
    }
  });
});
