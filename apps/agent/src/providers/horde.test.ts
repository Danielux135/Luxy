import { describe, it, expect, vi } from 'vitest';
import type { HordeImageRequest } from '@luxy/shared';
import type { HordeError } from './horde.js';
import {
  awaitImage,
  cancelImage,
  checkImage,
  downloadImage,
  estimateKudos,
  findUser,
  isAnonymousKey,
  listImageModels,
  readImageStatus,
  submitImage,
  ANONYMOUS_API_KEY,
  HORDE_BASE_URL,
  MAX_LORAS,
} from './horde.js';

const KEY = 'clave_de_prueba_del_horde';

/**
 * peticion de ejemplo con la forma de `HordeImageRequest`.
 *
 * Se escribe como literal a proposito: el tipo vive en `@luxy/shared` y aqui
 * solo hace falta algo que la cumpla, no otra copia del tipo. Los `overrides`
 * van tipados contra el, porque con `Record<string, unknown>` el spread
 * ensanchaba el resultado y un campo mal escrito llegaba hasta la llamada sin
 * que nadie lo parase.
 */
function request(overrides: Partial<HordeImageRequest> = {}): HordeImageRequest {
  return {
    prompt: 'una foto ### borroso, marca de agua',
    models: ['Deliberate'],
    width: 512,
    height: 768,
    steps: 25,
    cfgScale: 7,
    samplerName: 'k_euler_a',
    scheduler: 'karras',
    clipSkip: 1,
    seed: null,
    loras: [],
    hiresFix: false,
    postProcessing: [],
    nsfw: true,
    shared: false,
    // lo normal es generar de cero; las pruebas de img2img lo sobrescriben
    sourceImage: null,
    sourceProcessing: 'img2img',
    denoisingStrength: 0.45,
    ...overrides,
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  apikey: string | null;
  authorization: string | null;
  clientAgent: string | null;
}

/** transporte falso: ni una peticion real, ni un kudo gastado */
function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  let index = 0;

  const impl = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: url.toString(),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      apikey: headers.get('apikey'),
      authorization: headers.get('Authorization'),
      clientAgent: headers.get('Client-Agent'),
    });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status,
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const options = (impl: typeof fetch, apiKey = KEY) => ({
  baseUrl: HORDE_BASE_URL,
  apiKey,
  signal: new AbortController().signal,
  fetchImpl: impl,
  // sin espera real: las pruebas no duermen
  sleep: async () => undefined,
});

/**
 * espera el rechazo de una promesa y lo devuelve como `HordeError`.
 *
 * Existe porque `await f().catch((e) => e as HordeError)` deja la union
 * `Resultado | HordeError`, y ahi leer `.hint` o `.rc` no compila aunque la
 * prueba solo llegue a esa linea cuando ha fallado de verdad. Aislar la
 * asercion aqui evita repetirla en cada caso.
 */
async function rejection(promise: Promise<unknown>): Promise<HordeError> {
  return (await promise.catch((e: unknown) => e)) as HordeError;
}

const accepted = { status: 202, body: { id: 'pet-1', kudos: 12 } };

describe('autenticacion', () => {
  it('la clave viaja en la cabecera apikey, nunca en Authorization', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request(), options(impl));

    // el horde no habla Bearer: su cabecera es `apikey` con el valor plano
    expect(calls[0]?.apikey).toBe(KEY);
    expect(calls[0]?.authorization).toBeNull();
  });

  it('siempre se identifica el cliente', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request(), options(impl));
    // sin esta cabecera el servidor asume «unknown:0:unknown»
    expect(calls[0]?.clientAgent).toBe('Luxy:1.0:luxy');
  });

  it('reconoce la clave anonima', () => {
    expect(ANONYMOUS_API_KEY).toBe('0000000000');
    expect(isAnonymousKey(ANONYMOUS_API_KEY)).toBe(true);
    expect(isAnonymousKey(` ${ANONYMOUS_API_KEY} `)).toBe(true);
    expect(isAnonymousKey(KEY)).toBe(false);
  });

  it('la clave nunca aparece en el mensaje de error', async () => {
    const { impl } = fakeFetch([{ status: 400, body: { message: `la clave ${KEY} no vale` } }]);
    const error = await rejection(submitImage(request(), options(impl)));
    expect(error.message).not.toContain(KEY);
  });
});

describe('cuerpo de la peticion', () => {
  it('censor_nsfw viaja SIEMPRE y en false, aunque nadie lo pida', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request(), options(impl));

    // su swagger dice que el defecto es false, pero el parser del servidor lo
    // declara True: omitirlo puede devolver la imagen censurada en negro
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).toHaveProperty('censor_nsfw');
    expect(body.censor_nsfw).toBe(false);
  });

  it('manda las banderas que abaratan y amplian el pool', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request(), options(impl));
    const body = calls[0]?.body as Record<string, unknown>;

    // slow_workers en false costaria x1.2 y exigiria kudos por adelantado
    expect(body.slow_workers).toBe(true);
    expect(body.extra_slow_workers).toBe(true);
    expect(body.allow_downgrade).toBe(true);
    expect(body.r2).toBe(true);
    expect(body.trusted_workers).toBe(false);
    expect((body.params as Record<string, unknown>).n).toBe(1);
  });

  it('el negativo viaja dentro del prompt, no como campo', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request(), options(impl));
    const body = calls[0]?.body as Record<string, unknown>;

    // la API no tiene campo de negativo: va detras de ' ### ' en el prompt
    expect(body).not.toHaveProperty('negative_prompt');
    expect(String(body.prompt)).toContain(' ### ');
  });

  it('la semilla y los extras solo se mandan si se piden', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request(), options(impl));
    const params = (calls[0]?.body as { params: Record<string, unknown> }).params;
    expect(params).not.toHaveProperty('seed');
    expect(params).not.toHaveProperty('loras');
    expect(params).not.toHaveProperty('post_processing');

    const otro = fakeFetch([accepted]);
    await submitImage(
      request({
        seed: '12345',
        postProcessing: ['RealESRGAN_x4plus'],
        loras: [{ name: '247778', isVersion: true, model: 1, clip: 1 }],
      }),
      options(otro.impl),
    );
    const conExtras = (otro.calls[0]?.body as { params: Record<string, unknown> }).params;
    expect(conExtras.seed).toBe('12345');
    expect(conExtras.post_processing).toEqual(['RealESRGAN_x4plus']);
    // `is_version` obliga a que el nombre sea el id numerico de CivitAI
    expect(conExtras.loras).toEqual([{ name: '247778', is_version: true, model: 1, clip: 1 }]);
  });

  it('shared viaja tal y como se pide', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request({ shared: false }), options(impl));
    expect((calls[0]?.body as Record<string, unknown>).shared).toBe(false);

    const otro = fakeFetch([accepted]);
    await submitImage(request({ shared: true }), options(otro.impl));
    expect((otro.calls[0]?.body as Record<string, unknown>).shared).toBe(true);
  });

  it('con la clave anonima se avisa de que la imagen se comparte igual', async () => {
    const { impl } = fakeFetch([accepted]);
    const submission = await submitImage(
      request({ shared: false }),
      options(impl, ANONYMOUS_API_KEY),
    );

    // el horde fuerza shared=true con la clave anonima: callarlo seria mentir
    // sobre donde acaba el contenido
    expect(submission.warnings.map((warning) => warning.code)).toContain(
      'AnonymousKeySharesImage',
    );
    expect(submission.warnings[0]?.message).toContain('LAION');
  });

  it('conserva los avisos que manda el propio horde', async () => {
    const { impl } = fakeFetch([
      {
        status: 202,
        body: {
          id: 'pet-1',
          kudos: 9,
          warnings: [{ code: 'NoAvailableWorker', message: 'nadie tiene ese modelo' }],
        },
      },
    ]);
    const submission = await submitImage(request(), options(impl));
    expect(submission.id).toBe('pet-1');
    expect(submission.kudos).toBe(9);
    expect(submission.warnings[0]?.code).toBe('NoAvailableWorker');
  });

  it('rechaza una respuesta con otra forma', async () => {
    const { impl } = fakeFetch([{ status: 202, body: { kudos: 'gratis' } }]);
    await expect(submitImage(request(), options(impl))).rejects.toThrow(
      'no tiene el formato esperado',
    );
  });

  it('una peticion aceptada sin identificador no se da por buena', async () => {
    // sin id no hay nada que sondear: la generacion seguiria adelante en el
    // horde y aqui nadie podria recogerla nunca
    const { impl } = fakeFetch([{ status: 202, body: { kudos: 3 } }]);
    await expect(submitImage(request(), options(impl))).rejects.toThrow(
      'sin devolver su identificador',
    );
  });

});

describe('validacion antes de la red', () => {
  it('una anchura que no es multiplo de 64 no llega a salir', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await expect(submitImage(request({ width: 500 }), options(impl))).rejects.toThrow(
      'la anchura no vale',
    );
    // ocupar un hueco de la cola para que lo rechacen alli no aporta nada
    expect(calls).toHaveLength(0);
  });

  it('una altura fuera de rango tampoco', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await expect(submitImage(request({ height: 4096 }), options(impl))).rejects.toThrow(
      'la altura no vale',
    );
    expect(calls).toHaveLength(0);
  });

  it('explica el tamaño valido en la pista', async () => {
    const { impl } = fakeFetch([accepted]);
    const error = await rejection(submitImage(request({ width: 500 }), options(impl)));
    expect(error.hint).toContain('64');
    expect(error.hint).toContain('3072');
  });

  it('mas de cinco LoRAs se rechaza sin llamar a la red', async () => {
    const loras = Array.from({ length: MAX_LORAS + 1 }, (_unused, index) => ({
      name: `lora-${index}`,
      isVersion: false,
      model: 1,
      clip: 1,
    }));
    const { impl, calls } = fakeFetch([accepted]);
    await expect(submitImage(request({ loras }), options(impl))).rejects.toThrow('LoRAs');
    expect(calls).toHaveLength(0);
  });
});

describe('imagen de partida', () => {
  /** base64 PURO, como lo espera la API: sin `data:` delante */
  const SOURCE = Buffer.from('un webp de mentira').toString('base64');

  it('sin imagen no viaja ninguno de los tres campos', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request(), options(impl));
    const body = calls[0]?.body as Record<string, unknown>;

    expect(body).not.toHaveProperty('source_image');
    expect(body).not.toHaveProperty('source_processing');
    // sin imagen no significa nada: dejarlo puesto confunde al releer el registro
    expect(body.params as Record<string, unknown>).not.toHaveProperty('denoising_strength');
  });

  it('con imagen, la imagen va en la RAIZ y el parecido dentro de params', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(
      request({ sourceImage: SOURCE, denoisingStrength: 0.35 }),
      options(impl),
    );
    const body = calls[0]?.body as Record<string, unknown>;
    const params = body.params as Record<string, unknown>;

    // las dos ubicaciones, explicitas: en `params` el servidor ignora la imagen
    // en silencio y devuelve una generacion de cero, sin ningun error
    expect(body.source_image).toBe(SOURCE);
    expect(params).not.toHaveProperty('source_image');
    expect(params.denoising_strength).toBe(0.35);
    expect(body).not.toHaveProperty('denoising_strength');
  });

  it('source_processing viaja en la raiz y como img2img', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request({ sourceImage: SOURCE }), options(impl));
    const body = calls[0]?.body as Record<string, unknown>;

    expect(body.source_processing).toBe('img2img');
    expect(body.params as Record<string, unknown>).not.toHaveProperty('source_processing');
  });

  it('un base64 con prefijo data: se rechaza sin llamar a la red', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    // el servidor hace `b64decode` directo: el prefijo vuelve como un error
    // opaco mucho despues, con los kudos ya comprometidos
    await expect(
      submitImage(
        request({ sourceImage: `data:image/webp;base64,${SOURCE}` }),
        options(impl),
      ),
    ).rejects.toThrow('prefijo');
    expect(calls).toHaveLength(0);
  });

  it('una imagen demasiado grande se rechaza sin llamar a la red', async () => {
    // 7 millones de caracteres de base64 son unos 5,25 MB decodificados
    const { impl, calls } = fakeFetch([accepted]);
    const error = await rejection(
      submitImage(request({ sourceImage: 'A'.repeat(7_000_000) }), options(impl)),
    );

    expect(error.message).toContain('demasiado grande');
    expect(error.hint).toContain('mas pequeña');
    expect(calls).toHaveLength(0);
  });

  it('un parecido fuera de 0.01..1 se rechaza sin llamar a la red', async () => {
    for (const denoisingStrength of [0, 1.5]) {
      const { impl, calls } = fakeFetch([accepted]);
      await expect(
        submitImage(request({ sourceImage: SOURCE, denoisingStrength }), options(impl)),
      ).rejects.toThrow('no vale para AI Horde');
      expect(calls).toHaveLength(0);
    }
  });

  it('sin imagen, un parecido imposible no molesta', async () => {
    // el campo no viaja, asi que no hay nada que rechazar: fallar aqui obligaria
    // a limpiarlo en la receta para generar de cero
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request({ denoisingStrength: 0 }), options(impl));
    expect(calls).toHaveLength(1);
  });
});

describe('sondeo', () => {
  it('sondea check y pide status una sola vez', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: progress({ done: false, waiting: 1 }) },
      { status: 200, body: progress({ done: false, processing: 1 }) },
      { status: 200, body: progress({ done: true, finished: 1 }) },
      {
        status: 200,
        body: {
          ...progress({ done: true, finished: 1 }),
          generations: [
            { img: 'https://r2.example/a.webp', seed: '7', id: 'g-1', model: 'Deliberate' },
          ],
        },
      },
    ]);

    const visto: number[] = [];
    const result = await awaitImage('pet-1', {
      ...options(impl),
      onProgress: (p) => visto.push(p.waiting + p.processing + p.finished),
    });

    expect(result.generations[0]?.img).toBe('https://r2.example/a.webp');
    expect(result.generations[0]?.seed).toBe('7');
    expect(visto).toEqual([1, 1, 1]);

    const checks = calls.filter((call) => call.url.includes('/v2/generate/check/'));
    const status = calls.filter((call) => call.url.includes('/v2/generate/status/'));
    // status admite DIEZ POR MINUTO: sondearlo seria un 429 asegurado
    expect(checks).toHaveLength(3);
    expect(status).toHaveLength(1);
    expect(status[0]?.method).toBe('GET');
  });

  it('is_possible false aborta pronto y lo explica', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: progress({ done: false, is_possible: false }) },
    ]);

    const error = await rejection(awaitImage('pet-1', options(impl)));
    expect(error.message).toContain('ningun worker conectado');
    expect(error.hint).toContain('modelo');
    // ni una lectura de status: esperar diez minutos no lo arregla
    expect(calls.filter((call) => call.method === 'GET' && call.url.includes('/status/'))).toHaveLength(
      0,
    );
    // pero SI se cancela: abandonarla sin decirlo la deja viva hasta que caduca,
    // ocupando un hueco de concurrencia que el usuario cree libre
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('faulted true falla', async () => {
    const { impl } = fakeFetch([{ status: 200, body: progress({ done: false, faulted: true }) }]);
    const error = await rejection(awaitImage('pet-1', options(impl)));
    expect(error.message).toContain('no pudo generar');
  });

  it('se rinde al agotar el tiempo, sin decir que fallo', async () => {
    const { impl } = fakeFetch([{ status: 200, body: progress({ done: false }) }]);
    await expect(awaitImage('pet-1', { ...options(impl), maxWaitMs: 0 })).rejects.toThrow(
      'no estuvo lista a tiempo',
    );
  });

  // PASO DE VERDAD, y esta en su registro: al vencer los diez minutos la
  // peticion estaba en el PUESTO 18 con 56 segundos estimados, y se tiro. El
  // horde NO la habia descartado —seguia viva y subiendo puestos—; el que
  // perdia la imagen era nuestro plazo.
  //
  // Estas cuatro pruebas necesitan que el reloj CORRA: con `sleep` instantaneo
  // el plazo base nunca vence dentro del bucle y no habria nada que estirar.
  //
  // La primera version dormia DE VERDAD 40 ms contra un plazo de 60, y fallo
  // sola con la suite entera en paralelo: una siesta se paso de 60 ms y el
  // plazo vencio antes de la primera vuelta. Nada estaba roto. Ahora el
  // `sleep` no duerme, adelanta un reloj falso: la prueba es instantanea, mide
  // exactamente lo que dice medir y no depende de como ande la maquina.
  const lento = (impl: typeof fetch) => {
    let reloj = 0;
    return {
      ...options(impl),
      sleep: async () => {
        reloj += 40;
      },
      now: () => reloj,
      maxWaitMs: 60,
    };
  };

  it('estira el plazo mientras la cola avanza', async () => {
    const { impl } = fakeFetch([
      { status: 200, body: progress({ done: false, queue_position: 40, waiting: 1 }) },
      { status: 200, body: progress({ done: false, queue_position: 18, waiting: 1 }) },
      { status: 200, body: progress({ done: true, finished: 1 }) },
      {
        status: 200,
        body: {
          ...progress({ done: true, finished: 1 }),
          generations: [{ img: 'https://r2.example/a.webp', seed: '1', id: 'g-1' }],
        },
      },
    ]);

    const result = await awaitImage('pet-1', lento(impl));
    expect(result.generations[0]?.img).toBe('https://r2.example/a.webp');
  });

  it('un worker dibujandola tambien renueva el plazo', async () => {
    const { impl } = fakeFetch([
      { status: 200, body: progress({ done: false, processing: 1 }) },
      { status: 200, body: progress({ done: false, processing: 1 }) },
      { status: 200, body: progress({ done: true, finished: 1 }) },
      {
        status: 200,
        body: {
          ...progress({ done: true, finished: 1 }),
          generations: [{ img: 'https://r2.example/b.webp', seed: '2', id: 'g-2' }],
        },
      },
    ]);

    const result = await awaitImage('pet-1', lento(impl));
    expect(result.generations[0]?.img).toBe('https://r2.example/b.webp');
  });

  it('una cola PARADA no estira nada y se rinde a su hora', async () => {
    // es lo que evita esperar veinte minutos a algo que no va a salir: sin
    // señales de avance manda el plazo base
    const { impl } = fakeFetch([
      { status: 200, body: progress({ done: false, queue_position: 40, waiting: 1 }) },
    ]);
    await expect(awaitImage('pet-1', lento(impl))).rejects.toThrow('no estuvo lista a tiempo');
  });

  it('el techo absoluto no se pasa por muchas señales que haya', async () => {
    // graceMs 0: aunque la cola avance, no queda margen que estirar
    const { impl } = fakeFetch([
      { status: 200, body: progress({ done: false, queue_position: 40, waiting: 1 }) },
      { status: 200, body: progress({ done: false, queue_position: 18, waiting: 1 }) },
      { status: 200, body: progress({ done: false, queue_position: 5, waiting: 1 }) },
    ]);
    await expect(awaitImage('pet-1', { ...lento(impl), graceMs: 0 })).rejects.toThrow(
      'no estuvo lista a tiempo',
    );
  });

  it('un worker DIBUJANDOLA estira el techo: no se corta a un segundo del final', async () => {
    // PASO DE VERDAD (2026-09-15): una imagen murio con un worker dibujandola y
    // 38 segundos declarados, porque el techo vencia en ese instante. Aqui el
    // techo esta agotado (graceMs 0) y aun asi tiene que esperar, porque
    // `processing` dice que la imagen esta en las manos de alguien.
    const { impl } = fakeFetch([
      { status: 200, body: progress({ done: false, queue_position: 5, waiting: 1 }) },
      { status: 200, body: progress({ done: false, queue_position: 0, processing: 1 }) },
      { status: 200, body: progress({ done: true, finished: 1 }) },
      {
        status: 200,
        body: {
          ...progress({ done: true, finished: 1 }),
          generations: [{ img: 'https://r2.example/tarde.webp', seed: '3', id: 'g-3' }],
        },
      },
    ]);

    const result = await awaitImage('pet-1', { ...lento(impl), graceMs: 0 });
    expect(result.generations[0]?.img).toBe('https://r2.example/tarde.webp');
  });

  it('pero dibujarla tampoco es una espera abierta: el margen se acaba', async () => {
    // el techo se estira, no desaparece. Un `processing` que se queda pegado
    // para siempre tiene que rendirse igual, o la espera la marca el horde
    const pegada = Array.from({ length: 40 }, () => ({
      status: 200,
      body: progress({ done: false, queue_position: 0, processing: 1 }),
    }));
    const { impl } = fakeFetch(pegada);

    await expect(awaitImage('pet-1', { ...lento(impl), graceMs: 0 })).rejects.toThrow(
      'no estuvo lista a tiempo',
    );
  });

  it('respeta la cancelacion', async () => {
    const controller = new AbortController();
    controller.abort();
    const { impl, calls } = fakeFetch([{ status: 200, body: progress({ done: false }) }]);

    await expect(
      awaitImage('pet-1', { ...options(impl), signal: controller.signal }),
    ).rejects.toThrow('cancelada');
    // no sondea nada, pero SI cancela en el horde, y con una señal propia: la
    // del usuario ya esta abortada y con ella el DELETE no llegaria a salir,
    // que es justo cuando mas falta hace
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(0);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('lee el progreso suelto', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: progress({ done: false, wait_time: 42, queue_position: 3, kudos: 5 }) },
    ]);
    const current = await checkImage('pet-1', options(impl));
    expect(current.waitTimeSeconds).toBe(42);
    expect(current.queuePosition).toBe(3);
    expect(current.kudos).toBe(5);
    expect(calls[0]?.url).toBe(`${HORDE_BASE_URL}/v2/generate/check/pet-1`);
  });

  it('un estado SIN precio no se lee como cero kudos', async () => {
    // `kudos` es `nullish` en la respuesta, y este numero no se queda en la
    // pantalla de la cola: es el que acaba en `costCredits` y en el campo
    // `kudos` del intento cifrado. Un 0 inventado ahi no se distingue de un
    // precio real. Los demas contadores si pueden caer a cero sin mentir
    const sinPrecio = progress({ done: true, finished: 1 });
    delete sinPrecio.kudos;

    const { impl } = fakeFetch([{ status: 200, body: sinPrecio }]);
    const current = await checkImage('pet-1', options(impl));
    expect(current.kudos).toBeNull();
    expect(current.waiting).toBe(0);

    // y por el camino que de verdad se apunta: el resultado completo
    const completo = fakeFetch([
      {
        status: 200,
        body: {
          ...sinPrecio,
          generations: [
            { img: 'https://r2.example/a.webp', seed: '1', id: 'g-1', model: 'Deliberate' },
          ],
        },
      },
    ]);
    const result = await readImageStatus('pet-1', options(completo.impl));
    expect(result.kudos).toBeNull();
  });

  it('escapa el identificador en la ruta', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: progress({ done: false }) }]);
    await checkImage('a/b', options(impl));
    // sin escapar, un identificador con barra saltaria a otra ruta de la API
    expect(calls[0]?.url).toBe(`${HORDE_BASE_URL}/v2/generate/check/a%2Fb`);
  });
});

describe('censura de la red', () => {
  it('un gen_metadata de csam produce un error propio que lo dice', async () => {
    const { impl } = fakeFetch([
      {
        status: 200,
        body: {
          ...progress({ done: true, finished: 1 }),
          generations: [
            {
              img: 'https://r2.example/a.webp',
              seed: '1',
              id: 'g-1',
              model: 'Deliberate',
              censored: true,
              gen_metadata: [{ type: 'censorship', value: 'csam' }],
            },
          ],
        },
      },
    ]);

    const error = await rejection(readImageStatus('pet-1', options(impl)));
    // no es un fallo tecnico y no se reintenta: hay que decirlo tal cual
    expect(error.message).toContain('CSAM');
    expect(error.rc).toBe('csam');
    expect(error.hint).toContain('no se reintenta');
  });

  it('otros metadatos no bloquean el resultado', async () => {
    const { impl } = fakeFetch([
      {
        status: 200,
        body: {
          ...progress({ done: true, finished: 1 }),
          generations: [
            {
              img: 'https://r2.example/a.webp',
              seed: '1',
              id: 'g-1',
              model: 'Deliberate',
              worker_name: 'un voluntario',
              gen_metadata: [{ type: 'lora', value: 'baseline', ref: '247778' }],
            },
          ],
        },
      },
    ]);

    const result = await readImageStatus('pet-1', options(impl));
    expect(result.generations[0]?.workerName).toBe('un voluntario');
    expect(result.generations[0]?.metadata[0]).toEqual({
      type: 'lora',
      value: 'baseline',
      ref: '247778',
    });
  });

  it('un worker que censura por su cuenta tampoco pasa por buena', async () => {
    // el filtro PROPIO de un worker no deja metadato: solo marca `censored` y
    // devuelve una imagen negra. Sin esto se cifraba y se guardaba como la foto
    // del personaje, con los kudos gastados y sin ninguna explicacion
    const { impl } = fakeFetch([
      {
        status: 200,
        body: {
          ...progress({ done: true, finished: 1 }),
          generations: [
            {
              img: 'https://r2.example/negra.webp',
              seed: '1',
              id: 'g-1',
              model: 'Deliberate',
              censored: true,
            },
          ],
        },
      },
    ]);

    const error = await rejection(readImageStatus('pet-1', options(impl)));
    expect(error.message).toContain('censuro');
    expect(error.rc).toBe('censored');
    // se puede reintentar, al contrario que el filtro de la red
    expect(error.hint).toContain('otro');
  });
});

describe('cancelacion en el horde', () => {
  it('borra la peticion y devuelve lo que hubiera', async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          ...progress({ done: true, finished: 1 }),
          generations: [{ img: 'https://r2.example/a.webp', seed: '1', id: 'g-1', model: 'D' }],
        },
      },
    ]);

    const result = await cancelImage('pet-1', options(impl));
    // es la UNICA forma de cancelar: sin esto la peticion sigue viva
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(`${HORDE_BASE_URL}/v2/generate/status/pet-1`);
    expect(result.generations).toHaveLength(1);
  });
});

describe('errores', () => {
  it('cada codigo lleva su mensaje y su pista', async () => {
    const casos = [
      { status: 401, rc: 'InvalidAPIKey', texto: 'clave', pista: 'Conexiones' },
      { status: 429, rc: 'TooManyPrompts', texto: 'demasiadas peticiones', pista: 'en curso' },
      { status: 404, rc: 'RequestNotFound', texto: 'ya no existe', pista: '10 minutos' },
      { status: 503, rc: 'MaintenanceMode', texto: 'mantenimiento', pista: 'reintenta' },
    ] as const;

    const mensajes = new Set<string>();
    const pistas = new Set<string>();
    for (const caso of casos) {
      const { impl } = fakeFetch([{ status: caso.status, body: { message: 'no', rc: caso.rc } }]);
      const error = await rejection(submitImage(request(), options(impl)));

      expect(error.rc).toBe(caso.rc);
      expect(error.status).toBe(caso.status);
      expect(error.message).toContain(caso.texto);
      expect(error.hint).toContain(caso.pista);
      mensajes.add(error.message);
      pistas.add(error.hint ?? '');
    }
    // cada caso pide hacer algo distinto: no pueden colapsar en el mismo aviso
    expect(mensajes.size).toBe(casos.length);
    expect(pistas.size).toBe(casos.length);
  });

  it('cualquier mensaje de kudos manda pedir menos', async () => {
    const { impl } = fakeFetch([
      { status: 400, body: { message: 'You do not have enough kudos', rc: 'KudosUpfront' } },
    ]);
    const error = await rejection(submitImage(request(), options(impl)));
    expect(error.hint).toContain('resolucion');

    // y tambien cuando el codigo no lo conocemos
    const otro = fakeFetch([{ status: 400, body: { message: 'not enough kudos', rc: 'Futuro' } }]);
    const segundo = await rejection(submitImage(request(), options(otro.impl)));
    expect(segundo.hint).toContain('resolucion');
  });

  it('un codigo desconocido conserva el texto original', async () => {
    const { impl } = fakeFetch([{ status: 418, body: { message: 'algo nuevo', rc: 'Futuro' } }]);
    const error = await rejection(submitImage(request(), options(impl)));
    expect(error.message).toContain('418');
    expect(error.message).toContain('algo nuevo');
    expect(error.rc).toBe('Futuro');
  });

  it('un cuerpo que no es JSON no rompe el manejo del error', async () => {
    const impl = (async () =>
      new Response('<html>502 Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;
    const error = await rejection(submitImage(request(), options(impl)));
    expect(error.status).toBe(502);
    expect(error.rc).toBeNull();
    expect(error.message).toContain('502');
  });
});

describe('coste', () => {
  it('estimateKudos pregunta con dry_run y no genera nada', async () => {
    // SIN identificador a proposito: `dry_run` no encola ningun trabajo, asi que
    // el horde no tiene id que devolver. Fabricar uno aqui daba por verificado
    // un contrato que el servidor no produce
    const { impl, calls } = fakeFetch([{ status: 202, body: { kudos: 34 } }]);
    const estimate = await estimateKudos(request(), options(impl));

    expect(estimate.kudos).toBe(34);
    expect((calls[0]?.body as Record<string, unknown>).dry_run).toBe(true);
    // una sola llamada: dry_run devuelve el precio sin encolar trabajo
    expect(calls).toHaveLength(1);
  });

  it('los avisos del dry run vuelven con el precio', async () => {
    // es la mitad util de preguntar en seco: «ningun worker sirve ese modelo»
    // se sabe ANTES de encolar, y hasta ahora se tiraba junto con el resto
    const { impl } = fakeFetch([
      {
        status: 202,
        body: {
          kudos: 34,
          warnings: [{ code: 'NoAvailableWorker', message: 'nadie tiene ese modelo' }],
        },
      },
    ]);
    const estimate = await estimateKudos(request(), options(impl));

    expect(estimate.warnings[0]?.code).toBe('NoAvailableWorker');
  });

  it('sin precio en la respuesta devuelve null, no cero', async () => {
    // cero kudos no existe como precio: enseñarlo seria inventarse un numero
    // en la unica pantalla que sirve para decidir si se pulsa o no
    const { impl } = fakeFetch([{ status: 202, body: {} }]);
    const estimate = await estimateKudos(request(), options(impl));

    expect(estimate.kudos).toBeNull();
  });

  it('sin dry_run el campo no viaja', async () => {
    const { impl, calls } = fakeFetch([accepted]);
    await submitImage(request(), options(impl));
    expect(calls[0]?.body).not.toHaveProperty('dry_run');
  });
});

describe('descarga', () => {
  it('un img con http se descarga', async () => {
    const calls: string[] = [];
    const impl = (async (url: string | URL) => {
      calls.push(url.toString());
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } });
    }) as unknown as typeof fetch;

    const result = await downloadImage('https://r2.example/a.webp', options(impl));
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(result.mimeType).toBe('image/webp');
    expect(calls).toEqual(['https://r2.example/a.webp']);
  });

  it('un img sin http se trata como base64 y no llama a la red', async () => {
    const impl = vi.fn() as unknown as typeof fetch;
    const base64 = Buffer.from([9, 8, 7]).toString('base64');

    const result = await downloadImage(base64, options(impl));
    expect([...result.bytes]).toEqual([9, 8, 7]);
    // el horde solo produce webp: el tipo no hay que adivinarlo
    expect(result.mimeType).toBe('image/webp');
    expect(impl).not.toHaveBeenCalled();
  });

  it('rechaza una URL de resultado sin cifrar', async () => {
    const impl = (async () => new Response('')) as unknown as typeof fetch;
    // seria contenido privado viajando en claro por la red
    await expect(downloadImage('http://r2.example/a.webp', options(impl))).rejects.toThrow(
      'conexion insegura',
    );
  });

  it('explica un enlace caducado', async () => {
    const impl = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    const error = await rejection(downloadImage('https://r2.example/a.webp', options(impl)));
    // la URL prefirmada de R2 caduca a los 1800 s
    expect(error.message).toContain('403');
    expect(error.hint).toContain('media hora');
  });
});

describe('cuenta y catalogo', () => {
  it('lee el saldo de kudos', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: { username: 'daniel#123', id: 42, kudos: 1250.5, concurrency: 3 } },
    ]);
    const user = await findUser(options(impl));

    expect(user.kudos).toBe(1250.5);
    expect(user.concurrency).toBe(3);
    expect(calls[0]?.url).toBe(`${HORDE_BASE_URL}/v2/find_user`);
    expect(calls[0]?.apikey).toBe(KEY);
  });

  it('el catalogo se parsea y no exige clave', async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 200,
        body: [
          { name: 'Deliberate', count: 12, performance: 3.2, queued: 0, jobs: 1, eta: 4, type: 'image' },
          { name: 'AlbedoBase XL (SDXL)', count: 0, eta: 0 },
        ],
      },
    ]);

    const models = await listImageModels({
      baseUrl: HORDE_BASE_URL,
      signal: new AbortController().signal,
      fetchImpl: impl,
    });

    // `name` es el string exacto que hay que mandar despues en `models`
    expect(models.map((model) => model.name)).toEqual(['Deliberate', 'AlbedoBase XL (SDXL)']);
    // count 0 = existe pero hoy no lo sirve nadie
    expect(models[1]?.count).toBe(0);
    expect(calls[0]?.url).toBe(`${HORDE_BASE_URL}/v2/status/models?type=image`);
  });

  it('un catalogo con otra forma se rechaza', async () => {
    const { impl } = fakeFetch([{ status: 200, body: { models: [] } }]);
    await expect(
      listImageModels({
        baseUrl: HORDE_BASE_URL,
        signal: new AbortController().signal,
        fetchImpl: impl,
      }),
    ).rejects.toThrow('no tiene el formato esperado');
  });
});

describe('sin red real', () => {
  it('ninguna prueba de este archivo usa fetch de verdad', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      const { impl } = fakeFetch([accepted]);
      await submitImage(request(), options(impl));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

/** respuesta de `check`, con lo que el horde manda siempre */
function progress(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    done: false,
    faulted: false,
    is_possible: true,
    waiting: 0,
    processing: 0,
    finished: 0,
    restarted: 0,
    wait_time: 0,
    queue_position: 0,
    kudos: 0,
    ...overrides,
  };
}
