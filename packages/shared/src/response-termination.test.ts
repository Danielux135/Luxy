// pruebas del diagnostico de final de respuesta.
//
// POR QUE EXISTE: una generacion larga acabo a mitad de una etiqueta HTML y no
// se pudo demostrar si fue el tope de tokens, un timeout de Luxy, un proxy o un
// socket caido. Cada hipotesis pide un arreglo distinto. Este contrato es la
// evidencia que permite elegir, y LO QUE NO PUEDE LLEVAR es contenido.
import { describe, it, expect } from 'vitest';
import { formatResponseTermination, responseTerminationSchema } from './schemas.js';
import { redact } from './redact.js';

const completa = {
  httpStatus: 200,
  streamed: true,
  chunks: 42,
  bytes: 18_320,
  durationMs: 1_423_000,
  transportEnd: 'local_end' as const,
  finishReason: 'length',
  finalUsageReceived: true,
  abortedBy: 'local_finalization' as const,
  effectiveTimeoutMs: 3_600_000,
  maxOutputTokens: 8192,
  inputTokens: 287,
  outputTokens: 6422,
  textLength: 24_910,
};

describe('responseTerminationSchema', () => {
  it('acepta un diagnostico completo', () => {
    expect(responseTerminationSchema.parse(completa)).toEqual(completa);
  });

  it('acepta que no haya HTTP, finish_reason ni aborto', () => {
    const parsed = responseTerminationSchema.parse({
      ...completa,
      httpStatus: null,
      finishReason: null,
      abortedBy: null,
      maxOutputTokens: null,
    });
    expect(parsed.finishReason).toBeNull();
    expect(parsed.abortedBy).toBeNull();
  });

  it('rechaza una señal de transporte que no existe', () => {
    expect(
      responseTerminationSchema.safeParse({ ...completa, transportEnd: 'se_corto' }).success,
    ).toBe(false);
  });

  it('rechaza un aborto inventado', () => {
    expect(responseTerminationSchema.safeParse({ ...completa, abortedBy: 'kimi' }).success).toBe(
      false,
    );
  });
});

describe('formatResponseTermination', () => {
  it('nombra la señal, el aborto y los limites efectivos', () => {
    const linea = formatResponseTermination(completa);
    expect(linea).toContain('final=local_end');
    expect(linea).toContain('finishReason=length');
    expect(linea).toContain('aborto=local_finalization');
    expect(linea).toContain('timeout=3600000ms');
    expect(linea).toContain('maxTokens=8192');
    expect(linea).toContain('tokens=287/6422');
  });

  it('dice "ninguno" en vez de dejar huecos cuando falta una señal', () => {
    const linea = formatResponseTermination({
      ...completa,
      httpStatus: null,
      finishReason: null,
      abortedBy: null,
      maxOutputTokens: null,
    });
    expect(linea).toContain('http=ninguno');
    expect(linea).toContain('finishReason=ninguno');
    expect(linea).toContain('aborto=ninguno');
    expect(linea).toContain('maxTokens=sin tope');
  });

  it('los contadores sobreviven a la redaccion: no son credenciales', () => {
    // esto ya paso una vez con inputTokens/outputTokens: el redactor los
    // convirtio en cadenas y la validacion del resultado fallo despues.
    const linea = redact(formatResponseTermination(completa));
    expect(linea).toContain('tokens=287/6422');
    expect(linea).toContain('bytes=18320');
  });
});
