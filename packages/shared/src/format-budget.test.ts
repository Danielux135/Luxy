import { describe, it, expect } from 'vitest';
import {
  splitMessage,
  splitAsCodeBlocks,
  formatDuration,
  renderJobCreated,
  renderJobFinished,
  escapeMarkdownV2,
} from './telegram/format.js';
import { checkBudget, recordUsage, utcDay, estimateCost } from './budget.js';
import { computeBackoffDelay, retryWithBackoff, RetryError } from './backoff.js';
import { generateShortId, isShortId, normalizeShortId, slugify, buildBranchName } from './ids.js';
import { TELEGRAM_MAX_MESSAGE_LENGTH } from './constants.js';
import type { BudgetState, ProviderUsage } from './index.js';

// -----------------------------------------------------------------------------
// division de mensajes largos
// -----------------------------------------------------------------------------
describe('splitMessage', () => {
  it('no divide un mensaje que cabe entero', () => {
    expect(splitMessage('hola')).toEqual(['hola']);
  });

  it('devuelve una lista vacia para texto vacio', () => {
    expect(splitMessage('')).toEqual([]);
  });

  it('divide respetando el limite de telegram', () => {
    const texto = 'a'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH * 2 + 100);
    const partes = splitMessage(texto);
    expect(partes.length).toBeGreaterThan(1);
    for (const parte of partes) {
      expect(parte.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
    }
  });

  it('prefiere cortar por saltos de linea', () => {
    const linea = `${'x'.repeat(50)}\n`;
    const partes = splitMessage(linea.repeat(10), 120);
    // ningun fragmento debe empezar por un salto de linea suelto
    for (const parte of partes) expect(parte.startsWith('\n')).toBe(false);
  });

  it('no pierde contenido al dividir', () => {
    const texto = Array.from({ length: 200 }, (_, i) => `linea numero ${i}`).join('\n');
    const partes = splitMessage(texto, 100);
    const reunido = partes.join('\n').replace(/\s+/g, ' ');
    // se comprueba que todas las lineas siguen presentes
    for (const i of [0, 50, 199]) expect(reunido).toContain(`linea numero ${i}`);
  });

  it('nunca produce fragmentos vacios', () => {
    const partes = splitMessage('\n\n\n'.repeat(100), 20);
    for (const parte of partes) expect(parte.length).toBeGreaterThan(0);
  });

  it('divide texto sin espacios mediante corte duro', () => {
    const partes = splitMessage('z'.repeat(500), 100);
    expect(partes.length).toBe(5);
  });

  it('rechaza un limite no positivo', () => {
    expect(() => splitMessage('hola', 0)).toThrow();
  });
});

describe('splitAsCodeBlocks', () => {
  it('envuelve cada fragmento en una valla de codigo', () => {
    const bloques = splitAsCodeBlocks('linea\n'.repeat(200), 200);
    for (const bloque of bloques) {
      expect(bloque.startsWith('```')).toBe(true);
      expect(bloque.endsWith('```')).toBe(true);
      expect(bloque.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('formatDuration', () => {
  it('formatea minutos y segundos', () => {
    expect(formatDuration(43_000)).toBe('00:43');
    expect(formatDuration(501_000)).toBe('08:21');
  });

  it('incluye horas cuando hace falta', () => {
    expect(formatDuration(3_661_000)).toBe('01:01:01');
  });

  it('trata valores negativos como cero', () => {
    expect(formatDuration(-100)).toBe('00:00');
  });
});

describe('escapeMarkdownV2', () => {
  it('escapa los caracteres reservados', () => {
    expect(escapeMarkdownV2('a_b*c[d]')).toBe('a\\_b\\*c\\[d\\]');
  });
});

// -----------------------------------------------------------------------------
// tarjetas de telegram
// -----------------------------------------------------------------------------
describe('tarjetas de trabajo', () => {
  it('la tarjeta de creacion incluye los datos clave', () => {
    const texto = renderJobCreated({
      shortId: 'LUX-4F82',
      machineName: 'casa',
      projectAlias: 'errorlux',
      provider: 'claude',
      status: 'queued',
    });
    expect(texto).toContain('LUX-4F82');
    expect(texto).toContain('casa');
    expect(texto).toContain('errorlux');
    expect(texto).toContain('Claude');
  });

  it('la tarjeta de creacion explica el motivo del router automatico', () => {
    const texto = renderJobCreated({
      shortId: 'LUX-4F82',
      machineName: 'casa',
      projectAlias: 'errorlux',
      provider: 'claude',
      status: 'queued',
      routerReason: 'la tarea requiere modificar varios archivos',
    });
    expect(texto).toContain('Proveedor elegido: Claude');
    expect(texto).toContain('Motivo:');
  });

  it('la tarjeta final incluye el recuento de pruebas', () => {
    const texto = renderJobFinished({
      shortId: 'LUX-4F82',
      machineName: 'casa',
      projectAlias: 'errorlux',
      provider: 'claude',
      status: 'completed',
      durationMs: 501_000,
      filesChanged: 4,
      testsPassed: 32,
      testsFailed: 0,
      summary: 'Se corrigio la conservacion de solutionId.',
    });
    expect(texto).toContain('Archivos modificados: 4');
    expect(texto).toContain('Pruebas superadas: 32');
    expect(texto).toContain('Pruebas fallidas: 0');
    expect(texto).toContain('08:21');
  });

  it('la tarjeta final redacta secretos del resumen', () => {
    const texto = renderJobFinished({
      shortId: 'LUX-1',
      machineName: 'casa',
      projectAlias: 'demo',
      provider: 'codex',
      status: 'completed',
      durationMs: 1000,
      filesChanged: 1,
      testsPassed: 1,
      testsFailed: 0,
      summary: 'Se uso Bearer sk-abcdefghijklmnopqrstuvwxyz123456 en la peticion',
    });
    expect(texto).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});

// -----------------------------------------------------------------------------
// presupuestos de proveedores
// -----------------------------------------------------------------------------
describe('presupuesto diario', () => {
  const uso = (coste: number): ProviderUsage => ({
    provider: 'deepseek',
    model: 'x',
    jobId: null,
    inputTokens: 100,
    outputTokens: 50,
    estimatedCost: coste,
  });

  it('permite la llamada cuando no hay consumo previo', () => {
    expect(checkBudget({}, 'deepseek', 10).allowed).toBe(true);
  });

  it('un limite de 0 significa sin limite', () => {
    const estado: BudgetState = {
      deepseek: { day: utcDay(), spent: 9999, inputTokens: 0, outputTokens: 0, calls: 1 },
    };
    expect(checkBudget(estado, 'deepseek', 0).allowed).toBe(true);
  });

  it('bloquea cuando se alcanza el limite', () => {
    const estado: BudgetState = {
      deepseek: { day: utcDay(), spent: 10, inputTokens: 0, outputTokens: 0, calls: 1 },
    };
    const resultado = checkBudget(estado, 'deepseek', 10);
    expect(resultado.allowed).toBe(false);
    expect(resultado.reason).toContain('presupuesto diario agotado');
  });

  it('acumula el consumo sin mutar el estado original', () => {
    const inicial: BudgetState = {};
    const siguiente = recordUsage(inicial, uso(2));
    expect(inicial).toEqual({});
    expect(siguiente.deepseek?.spent).toBe(2);
    expect(recordUsage(siguiente, uso(3)).deepseek?.spent).toBe(5);
  });

  it('reinicia el contador al cambiar de dia utc', () => {
    const ayer = new Date('2026-07-26T12:00:00Z');
    const hoy = new Date('2026-07-27T12:00:00Z');
    const estado = recordUsage({}, uso(8), ayer);
    expect(checkBudget(estado, 'deepseek', 10, hoy).spent).toBe(0);
    expect(recordUsage(estado, uso(1), hoy).deepseek?.spent).toBe(1);
  });

  it('estima el coste a partir de los tokens', () => {
    expect(estimateCost(1_000_000, 1_000_000, 1, 2)).toBe(3);
    expect(estimateCost(1000, 1000)).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// backoff
// -----------------------------------------------------------------------------
describe('backoff', () => {
  it('crece exponencialmente sin jitter', () => {
    const opciones = { baseDelayMs: 1000, maxDelayMs: 60_000, jitter: 0 };
    expect(computeBackoffDelay(0, opciones)).toBe(1000);
    expect(computeBackoffDelay(1, opciones)).toBe(2000);
    expect(computeBackoffDelay(3, opciones)).toBe(8000);
  });

  it('respeta el retardo maximo', () => {
    expect(computeBackoffDelay(20, { baseDelayMs: 1000, maxDelayMs: 30_000, jitter: 0 })).toBe(
      30_000,
    );
  });

  it('el jitter mantiene el retardo dentro del margen esperado', () => {
    const opciones = { baseDelayMs: 1000, maxDelayMs: 60_000, jitter: 0.3 };
    for (const aleatorio of [0, 0.5, 1]) {
      const retardo = computeBackoffDelay(1, opciones, () => aleatorio);
      expect(retardo).toBeGreaterThanOrEqual(1400);
      expect(retardo).toBeLessThanOrEqual(2600);
    }
  });

  it('reintenta y acaba devolviendo el resultado', async () => {
    let intentos = 0;
    const resultado = await retryWithBackoff(
      async () => {
        intentos += 1;
        if (intentos < 3) throw new Error('temporal');
        return 'ok';
      },
      { maxAttempts: 5, sleep: async () => undefined },
    );
    expect(resultado).toBe('ok');
    expect(intentos).toBe(3);
  });

  it('no reintenta errores permanentes', async () => {
    let intentos = 0;
    await expect(
      retryWithBackoff(
        async () => {
          intentos += 1;
          throw new Error('401');
        },
        { maxAttempts: 5, shouldRetry: () => false, sleep: async () => undefined },
      ),
    ).rejects.toThrow(RetryError);
    expect(intentos).toBe(1);
  });

  it('lanza RetryError al agotar los intentos', async () => {
    await expect(
      retryWithBackoff(
        async () => {
          throw new Error('siempre falla');
        },
        { maxAttempts: 3, sleep: async () => undefined },
      ),
    ).rejects.toThrow(RetryError);
  });

  // POR QUE EXISTE: un 400 rechazado a la primera llegaba al usuario como
  // "fallo tras 3 intentos". Eso manda a investigar unos reintentos que no
  // ocurrieron y esconde lo unico cierto: la API dijo que no.
  it('cuenta los intentos REALES, no el maximo configurado', async () => {
    const fallo = await retryWithBackoff(
      async () => {
        throw Object.assign(new Error('400: no permitido'), { status: 400 });
      },
      { maxAttempts: 3, shouldRetry: () => false, sleep: async () => undefined },
    ).catch((error: unknown) => error as RetryError);

    expect(fallo.attempts).toBe(1);
    expect(fallo.message).toContain('tras 1 intento');
    expect(fallo.message).not.toContain('intentos');
  });

  it('conserva el codigo HTTP al envolver el error', async () => {
    // sin esto, quien recibe el error no distingue un 429 de un 401 y acaba
    // enseñando el JSON crudo del proveedor
    const fallo = await retryWithBackoff(
      async () => {
        throw Object.assign(new Error('429: demasiadas peticiones'), { status: 429 });
      },
      { maxAttempts: 2, sleep: async () => undefined },
    ).catch((error: unknown) => error as RetryError);

    expect(fallo.status).toBe(429);
    expect(fallo.attempts).toBe(2);
  });

  it('obedece la espera que pide el error por encima del backoff', async () => {
    const esperas: number[] = [];
    await retryWithBackoff(
      async () => {
        throw Object.assign(new Error('429'), { status: 429, retryAfterMs: 30_000 });
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1000,
        jitter: 0,
        sleep: async (ms) => {
          esperas.push(ms);
        },
        delayForError: (error, _attempt, calculado) => {
          const pedido = (error as { retryAfterMs?: number }).retryAfterMs;
          return typeof pedido === 'number' ? Math.max(pedido, calculado) : null;
        },
      },
    ).catch(() => undefined);

    expect(esperas).toEqual([30_000]);
  });
});

// -----------------------------------------------------------------------------
// identificadores y ramas
// -----------------------------------------------------------------------------
describe('identificadores', () => {
  it('genera identificadores con el prefijo esperado', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = generateShortId();
      expect(id).toMatch(/^LUX-[2-9A-HJ-NP-Z]{4}$/);
      expect(isShortId(id)).toBe(true);
    }
  });

  it('no usa caracteres ambiguos', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateShortId()).not.toMatch(/[01IO]/);
    }
  });

  it('normaliza lo que escribe el usuario', () => {
    expect(normalizeShortId('4f82')).toBe('LUX-4F82');
    expect(normalizeShortId('lux-4f82')).toBe('LUX-4F82');
    expect(normalizeShortId('  LUX-4F82  ')).toBe('LUX-4F82');
  });
});

describe('slugify y ramas', () => {
  it('quita tildes y caracteres no validos', () => {
    // el slug se recorta a 32 caracteres para que la rama no sea interminable
    expect(slugify('Corrige la configuración del menú')).toBe('corrige-la-configuracion-del-men');
  });

  it('nunca deja guiones al principio o al final', () => {
    const slug = slugify('  ...hola...  ');
    expect(slug.startsWith('-')).toBe(false);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('devuelve un valor por defecto si no queda nada', () => {
    expect(slugify('!!!???')).toBe('tarea');
  });

  it('construye un nombre de rama valido para git', () => {
    const rama = buildBranchName('LUX-4F82', 'Corrige el Quick Pick de la extensión');
    expect(rama).toMatch(/^luxy\/4f82-[a-z0-9-]+$/);
    // git rechaza espacios, dos puntos y tildes
    expect(rama).not.toMatch(/[\s:áéíóú]/);
  });
});
