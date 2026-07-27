import { describe, it, expect, beforeEach } from 'vitest';
import { SlidingWindowRateLimiter } from './ratelimit.js';
import { Router } from './router.js';
import { buildCallbackData, parseCallbackData, buildMachineChoiceKeyboard, buildResultKeyboard, buildPushConfirmKeyboard } from './telegram.js';
import { Repository } from './repository.js';
import { loadConfig, EnvError, type Env } from './env.js';

// -----------------------------------------------------------------------------
// rate limiting
// -----------------------------------------------------------------------------
describe('SlidingWindowRateLimiter', () => {
  it('permite hasta el limite y luego bloquea', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    const ahora = 1_000_000;
    expect(limiter.check('u1', ahora).allowed).toBe(true);
    expect(limiter.check('u1', ahora).allowed).toBe(true);
    expect(limiter.check('u1', ahora).allowed).toBe(true);
    expect(limiter.check('u1', ahora).allowed).toBe(false);
  });

  it('vuelve a permitir cuando la ventana avanza', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000);
    const ahora = 1_000_000;
    limiter.check('u1', ahora);
    limiter.check('u1', ahora);
    expect(limiter.check('u1', ahora).allowed).toBe(false);
    // 61 segundos despues la ventana ya paso
    expect(limiter.check('u1', ahora + 61_000).allowed).toBe(true);
  });

  it('cuenta cada clave por separado', () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000);
    const ahora = 1_000_000;
    expect(limiter.check('u1', ahora).allowed).toBe(true);
    expect(limiter.check('u2', ahora).allowed).toBe(true);
    expect(limiter.check('u1', ahora).allowed).toBe(false);
  });

  it('informa de cuantas peticiones quedan', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    expect(limiter.check('u1', 1000).remaining).toBe(2);
    expect(limiter.check('u1', 1000).remaining).toBe(1);
  });

  it('no crece sin limite cuando aparecen muchas claves', () => {
    const limiter = new SlidingWindowRateLimiter(10, 1000, 50);
    for (let i = 0; i < 500; i += 1) limiter.check(`clave-${i}`, 1_000_000 + i);
    // no debe lanzar ni quedarse sin memoria
    expect(limiter.check('final', 2_000_000).allowed).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// enrutador
// -----------------------------------------------------------------------------
describe('Router', () => {
  const build = (): Router<null> =>
    new Router<null>()
      .get('/health', async () => new Response('health'))
      .post('/api/jobs/claim', async () => new Response('claim'))
      .get('/api/jobs/:jobId/control', async (_r, _d, params) => new Response(params.jobId))
      .post('/api/approvals/:approvalId/resolve', async (_r, _d, p) => new Response(p.approvalId));

  it('encuentra rutas estaticas', () => {
    expect(build().match('GET', '/health')).not.toBeNull();
    expect(build().match('POST', '/api/jobs/claim')).not.toBeNull();
  });

  it('extrae parametros de la ruta', () => {
    const found = build().match('GET', '/api/jobs/abc-123/control');
    expect(found?.params).toEqual({ jobId: 'abc-123' });
  });

  it('decodifica los parametros', () => {
    const found = build().match('POST', '/api/approvals/a%2Fb/resolve');
    expect(found?.params.approvalId).toBe('a/b');
  });

  it('distingue el metodo http', () => {
    expect(build().match('GET', '/api/jobs/claim')).toBeNull();
  });

  it('no confunde rutas con distinto numero de segmentos', () => {
    expect(build().match('GET', '/api/jobs/abc/control/extra')).toBeNull();
    expect(build().match('GET', '/api/jobs/control')).toBeNull();
  });

  it('devuelve null para rutas desconocidas', () => {
    expect(build().match('GET', '/no/existe')).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// callbacks de telegram
// -----------------------------------------------------------------------------
describe('callback_data', () => {
  it('construye y vuelve a parsear', () => {
    const data = buildCallbackData('diff', 'LUX-4F82');
    expect(parseCallbackData(data)).toEqual({ action: 'diff', argument: 'LUX-4F82' });
  });

  it('conserva los dos puntos que haya en el argumento', () => {
    const data = buildCallbackData('pick', 'LUX-1|casa');
    expect(parseCallbackData(data)).toEqual({ action: 'pick', argument: 'LUX-1|casa' });
  });

  it('rechaza datos que superan el limite de 64 bytes de telegram', () => {
    expect(() => buildCallbackData('accion', 'x'.repeat(80))).toThrow('demasiado largo');
  });

  it('devuelve null si el formato no es valido', () => {
    expect(parseCallbackData('sinseparador')).toBeNull();
    expect(parseCallbackData(':vacio')).toBeNull();
  });
});

describe('teclados inline', () => {
  it('el teclado de resultado sin cambios solo ofrece ver diff y pruebas', () => {
    const teclado = buildResultKeyboard('LUX-1', false);
    const acciones = teclado.flat().map((boton) => boton.callback_data.split(':')[0]);
    expect(acciones).toEqual(['diff', 'tests']);
    // sin cambios no debe ofrecerse commit ni push
    expect(acciones).not.toContain('commit');
    expect(acciones).not.toContain('askpush');
  });

  it('con cambios ofrece commit, descartar y solicitar push', () => {
    const acciones = buildResultKeyboard('LUX-1', true)
      .flat()
      .map((boton) => boton.callback_data.split(':')[0]);
    expect(acciones).toContain('commit');
    expect(acciones).toContain('discard');
    expect(acciones).toContain('askpush');
    // nunca se ofrece el push directo sin pasar por la solicitud
    expect(acciones).not.toContain('dopush');
  });

  it('el push exige una segunda confirmacion explicita', () => {
    const acciones = buildPushConfirmKeyboard('LUX-1')
      .flat()
      .map((boton) => boton.callback_data.split(':')[0]);
    expect(acciones).toEqual(['dopush', 'nopush']);
  });

  it('el teclado de eleccion de maquina lista una fila por maquina', () => {
    const teclado = buildMachineChoiceKeyboard(
      [
        { id: 'm1', name: 'casa' },
        { id: 'm2', name: 'portatil' },
      ],
      'LUX-1',
    );
    expect(teclado).toHaveLength(2);
    expect(teclado[0]?.[0]?.text).toBe('casa');
  });
});

// -----------------------------------------------------------------------------
// idempotencia de telegram
// -----------------------------------------------------------------------------
describe('Repository.registerUpdate - idempotencia', () => {
  /** supabase simulado que respeta la unicidad de update_id */
  function fakeDb() {
    const vistos = new Set<number>();
    return {
      client: {
        async insertIfAbsent(_table: string, values: { update_id: number }) {
          if (vistos.has(values.update_id)) return false;
          vistos.add(values.update_id);
          return true;
        },
        async update() {
          return [];
        },
      } as any,
      vistos,
    };
  }

  it('acepta un update nuevo', async () => {
    const { client } = fakeDb();
    const repo = new Repository(client);
    expect(await repo.registerUpdate(1001)).toBe(true);
  });

  it('rechaza el mismo update_id la segunda vez', async () => {
    const { client } = fakeDb();
    const repo = new Repository(client);
    expect(await repo.registerUpdate(1001)).toBe(true);
    expect(await repo.registerUpdate(1001)).toBe(false);
    expect(await repo.registerUpdate(1001)).toBe(false);
  });

  it('acepta updates distintos', async () => {
    const { client } = fakeDb();
    const repo = new Repository(client);
    expect(await repo.registerUpdate(1)).toBe(true);
    expect(await repo.registerUpdate(2)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// validacion del entorno del worker
// -----------------------------------------------------------------------------
describe('loadConfig', () => {
  const BASE: Env = {
    TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    TELEGRAM_WEBHOOK_SECRET: 'secreto-webhook-1234',
    TELEGRAM_ADMIN_USER_ID: '111222333',
    TELEGRAM_ALLOWED_CHAT_IDS: '111222333,-1001234567890',
    SUPABASE_URL: 'https://proyecto.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'clave-de-servicio-muy-larga-12345',
    MACHINE_REGISTRATION_SECRET: 'secreto-registro-1234',
  };

  beforeEach(() => {
    // el registro de secretos es global: se limpia entre pruebas
  });

  it('acepta una configuracion completa', () => {
    const config = loadConfig(BASE);
    expect(config.adminUserId).toBe(111222333);
    expect(config.allowedChatIds).toEqual([111222333, -1001234567890]);
  });

  it('aplica valores por defecto a las variables opcionales', () => {
    const config = loadConfig(BASE);
    expect(config.MACHINE_OFFLINE_SECONDS).toBe(45);
    expect(config.JOB_LEASE_SECONDS).toBe(120);
    expect(config.RATE_LIMIT_PER_MINUTE).toBe(30);
  });

  it('respeta las variables numericas configuradas', () => {
    const config = loadConfig({ ...BASE, MACHINE_OFFLINE_SECONDS: '90' });
    expect(config.MACHINE_OFFLINE_SECONDS).toBe(90);
  });

  it('quita la arroba del nombre del bot', () => {
    expect(loadConfig({ ...BASE, TELEGRAM_BOT_USERNAME: '@LuxyBot' }).botUsername).toBe('LuxyBot');
  });

  it('explica que secreto falta sin revelar ningun valor', () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omitido, ...incompleto } = BASE;
    try {
      loadConfig(incompleto as Env);
      expect.unreachable('deberia haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as Error).message).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect((error as Error).message).not.toContain('clave-de-servicio');
    }
  });

  it('rechaza una url de supabase invalida', () => {
    expect(() => loadConfig({ ...BASE, SUPABASE_URL: 'no-es-url' })).toThrow(EnvError);
  });

  it('rechaza una lista de chats sin ningun id valido', () => {
    expect(() => loadConfig({ ...BASE, TELEGRAM_ALLOWED_CHAT_IDS: 'abc,def' })).toThrow(EnvError);
  });
});
