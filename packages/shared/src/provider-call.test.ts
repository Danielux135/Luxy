// como se clasifica el final de UNA llamada, y que el presupuesto cuente todas.
//
// la matriz de abajo es la razon de ser del arreglo: hasta el 2026-09-15 todos
// estos finales se veian igual —«el turno tardo»— y los que costaban dinero sin
// devolver nada eran indistinguibles de los que no costaban nada.
import { describe, it, expect } from 'vitest';
import {
  classifyProviderCallEnding,
  isBilledCallEnding,
  PROVIDER_CALL_LOG_MESSAGE,
  type ProviderCallEndingInput,
} from './provider-call.js';
import { PROVIDER_CALL_ENDINGS } from './constants.js';
import { checkBudget, checkCallBudget, recordUsage, utcDay } from './budget.js';
import type { BudgetState, ProviderUsage } from './index.js';

/** una llamada que fue bien; cada prueba cambia solo lo que le interesa */
function llamada(cambios: Partial<ProviderCallEndingInput> = {}): ProviderCallEndingInput {
  return {
    ok: true,
    cancelled: false,
    silence: false,
    requestTimeout: false,
    httpStatus: 200,
    elapsedMs: 1_200,
    transportEnd: 'done_marker',
    finishReason: 'stop',
    textChars: 420,
    streamError: false,
    outputBudgetExhausted: false,
    ...cambios,
  };
}

describe('classifyProviderCallEnding', () => {
  it('una respuesta normal es answered', () => {
    expect(classifyProviderCallEnding(llamada())).toBe('answered');
  });

  it('el silencio hasta el tope es su propio final, no un fallo de red', () => {
    // este es el caso caro: la llamada se atendio y se cobra, aunque no llegara
    // ni un byte. Confundirlo con «no se pudo conectar» es lo que hacia que
    // Luxy la repitiera sola y pagara otra entera.
    const final = classifyProviderCallEnding(
      llamada({
        ok: false,
        silence: true,
        httpStatus: null,
        transportEnd: null,
        finishReason: null,
        textChars: 0,
      }),
    );
    expect(final).toBe('silence');
    expect(isBilledCallEnding(final, null)).toBe(true);
  });

  it('un socket rechazado al instante no se cobra', () => {
    const final = classifyProviderCallEnding(
      llamada({
        ok: false,
        httpStatus: null,
        elapsedMs: 4,
        transportEnd: null,
        finishReason: null,
        textChars: 0,
      }),
    );
    expect(final).toBe('connect_failed');
    expect(isBilledCallEnding(final, null)).toBe(false);
  });

  it('sin cabeceras pero minutos en vuelo NO es un fallo de conexion', () => {
    // la tercera llamada vacia del 2026-09-14: murio a los 268 s «porque la
    // corto el otro lado» y se cobro igual. Como esta pasarela retiene las
    // cabeceras hasta que el modelo contesta, llego sin codigo de estado, se
    // declaraba gratis y se reenviaba sola hasta tres veces.
    const final = classifyProviderCallEnding(
      llamada({
        ok: false,
        httpStatus: null,
        elapsedMs: 268_000,
        transportEnd: null,
        finishReason: null,
        textChars: 0,
      }),
    );
    expect(final).toBe('dropped');
    expect(isBilledCallEnding(final, null)).toBe(true);
  });

  it('un rechazo 4xx del borde no se cobra; un 5xx si', () => {
    // ninguna pasarela factura una peticion que rechaza por autenticacion, por
    // cuerpo mal formado o por frecuencia: se para antes de la inferencia.
    // Contarlas era peligroso por el otro lado: una racha de 401 al caducar una
    // clave consumia el cupo diario de llamadas y, como se persiste, seguia
    // rechazando turnos legitimos hasta la medianoche con la clave ya arreglada.
    for (const status of [400, 401, 403, 404, 422, 429]) {
      expect(isBilledCallEnding('http_error', status)).toBe(false);
    }
    // el 5xx es ambiguo —el borde pudo llegar al modelo— y ahi lo conservador
    // es contar
    expect(isBilledCallEnding('http_error', 500)).toBe(true);
    expect(isBilledCallEnding('http_error', 503)).toBe(true);
  });

  it('todos los demas finales se cobran', () => {
    for (const final of PROVIDER_CALL_ENDINGS) {
      // con httpStatus 200: solo `connect_failed` sale gratis por el final
      expect(isBilledCallEnding(final, 200)).toBe(final !== 'connect_failed');
    }
  });

  it('una persona que para gana sobre cualquier lectura tecnica', () => {
    expect(
      classifyProviderCallEnding(
        llamada({ ok: false, cancelled: true, silence: true, transportEnd: 'read_error' }),
      ),
    ).toBe('cancelled');
  });

  it('el reloj de Luxy y el silencio de la conexion son finales distintos', () => {
    // piden arreglos opuestos: uno se corrige subiendo el tope del trabajo y el
    // otro el de la conexion. Verlos igual fue lo que dejo el tope de fabrica
    // de Node gobernando el sistema sin que nadie lo eligiera.
    expect(
      classifyProviderCallEnding(llamada({ ok: false, requestTimeout: true, textChars: 0 })),
    ).toBe('timed_out');
    expect(classifyProviderCallEnding(llamada({ ok: false, silence: true, textChars: 0 }))).toBe(
      'silence',
    );
  });

  it('un codigo de estado manda sobre lo que diga el transporte', () => {
    expect(
      classifyProviderCallEnding(
        llamada({ ok: false, httpStatus: 429, transportEnd: null, textChars: 0 }),
      ),
    ).toBe('http_error');
  });

  it('un error dentro del flujo con HTTP 200 no es una respuesta vacia', () => {
    expect(
      classifyProviderCallEnding(
        llamada({ ok: false, streamError: true, textChars: 0, finishReason: null }),
      ),
    ).toBe('stream_error');
  });

  it('agotar el presupuesto razonando se distingue de no contestar', () => {
    expect(
      classifyProviderCallEnding(
        llamada({ ok: false, outputBudgetExhausted: true, textChars: 0, finishReason: 'length' }),
      ),
    ).toBe('output_budget');
  });

  it('un corte por tope de tokens CON texto delante es truncated', () => {
    expect(classifyProviderCallEnding(llamada({ finishReason: 'length', textChars: 1200 }))).toBe(
      'truncated',
    );
  });

  it('un socket caido a mitad es un corte del otro lado, aunque haya texto', () => {
    expect(
      classifyProviderCallEnding(
        llamada({ ok: false, transportEnd: 'read_error', finishReason: null, textChars: 800 }),
      ),
    ).toBe('remote_close');
  });

  it('un cierre limpio sin una sola palabra es empty, y se paga igual', () => {
    const final = classifyProviderCallEnding(
      llamada({ transportEnd: 'body_closed', finishReason: null, textChars: 0 }),
    );
    expect(final).toBe('empty');
    expect(isBilledCallEnding(final)).toBe(true);
  });

  it('el mensaje del registro es literal y estable: se filtra por el', () => {
    expect(PROVIDER_CALL_LOG_MESSAGE).toBe('llamada al proveedor');
  });
});

// -----------------------------------------------------------------------------
// el presupuesto cuenta TODOS los intentos
// -----------------------------------------------------------------------------

function consumo(cambios: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    jobId: null,
    inputTokens: 7601,
    outputTokens: 0,
    estimatedCost: 0,
    ...cambios,
  };
}

describe('checkCallBudget', () => {
  const hoy = new Date('2026-09-15T10:00:00.000Z');

  function estado(calls: number, day = utcDay(hoy)): BudgetState {
    return { deepseek: { day, spent: 0, inputTokens: 0, outputTokens: 0, calls } };
  }

  it('sin limite configurado no frena nada', () => {
    expect(checkCallBudget(estado(500), 'deepseek', 0, hoy).allowed).toBe(true);
  });

  it('frena al alcanzar el numero de llamadas del dia', () => {
    const check = checkCallBudget(estado(20), 'deepseek', 20, hoy);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('20 de 20');
    // el motivo dice QUE HACER, no vuelca un diagnostico
    expect(check.reason).toContain('cobra entera');
  });

  it('las llamadas de ayer no cuentan hoy', () => {
    expect(checkCallBudget(estado(99, '2026-09-14'), 'deepseek', 20, hoy).allowed).toBe(true);
  });

  it('protege donde el presupuesto en dinero es ciego', () => {
    // el caso real: una pasarela con tarifa plana por llamada. Tres intentos
    // que devuelven CERO tokens no mueven el gasto ni un centimo, asi que
    // `checkBudget` los deja pasar para siempre; el contador si los ve.
    let state: BudgetState = {};
    for (let i = 0; i < 3; i += 1) {
      state = recordUsage(state, consumo({ inputTokens: 0, estimatedCost: 0 }), hoy);
    }
    expect(checkBudget(state, 'deepseek', 100, hoy).allowed).toBe(true);
    expect(checkCallBudget(state, 'deepseek', 3, hoy).allowed).toBe(false);
  });
});

describe('recordUsage por llamada', () => {
  const hoy = new Date('2026-09-15T10:00:00.000Z');

  it('un turno de tres llamadas suma tres, no una', () => {
    // el turno del informe: 7.601 tokens de entrada figuraban una vez cuando se
    // habian pagado tres veces
    let state: BudgetState = {};
    for (let i = 0; i < 3; i += 1) state = recordUsage(state, consumo(), hoy);

    expect(state['deepseek']?.calls).toBe(3);
    expect(state['deepseek']?.inputTokens).toBe(7601 * 3);
  });

  it('no muta el estado que recibe', () => {
    const inicial: BudgetState = {};
    const siguiente = recordUsage(inicial, consumo(), hoy);
    expect(inicial).toEqual({});
    expect(siguiente).not.toBe(inicial);
  });
});
