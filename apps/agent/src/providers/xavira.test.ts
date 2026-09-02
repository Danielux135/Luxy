import { describe, it, expect, vi } from 'vitest';
import type { XaviraError } from './xavira.js';
import {
  awaitGeneration,
  createCharacter,
  downloadOutput,
  generateImage,
  generateVideo,
  readGeneration,
  retryAfterMs,
  CHARACTER_MODELS,
  CHARACTER_TRAITS,
  MAX_NEGATIVE_CHARS,
  MAX_SCENE_CHARS,
} from './xavira.js';

const KEY = 'xav_live_clave_de_prueba';

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}

/** transporte falso: ni una peticion real, ni un credito gastado */
function fakeFetch(responses: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: Call[] = [];
  let index = 0;

  const impl = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    calls.push({
      url: url.toString(),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      authorization: headers.get('Authorization'),
    });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const options = (impl: typeof fetch) => ({
  baseUrl: 'https://api.xavira.ai',
  apiKey: KEY,
  signal: new AbortController().signal,
  fetchImpl: impl,
  // sin espera real: las pruebas no duermen
  sleep: async () => undefined,
});

describe('personajes', () => {
  it('crea uno y devuelve su identificador', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { character_id: 'per-1' } }]);
    const created = await createCharacter(
      { modelId: 'realistic-sharp-v1', traits: { pelo: 'largo' } },
      options(impl),
    );

    expect(created.characterId).toBe('per-1');
    expect(calls[0]?.url).toBe('https://api.xavira.ai/v1/characters');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.authorization).toBe(`Bearer ${KEY}`);
  });

  it('rechaza una respuesta con otra forma', async () => {
    const { impl } = fakeFetch([{ status: 201, body: { id: 'per-1' } }]);
    await expect(createCharacter({ modelId: 'realistic-sharp-v1' }, options(impl))).rejects.toThrow('no tiene el formato esperado');
  });
});

describe('modelo del personaje', () => {
  it('se manda SIEMPRE: sin el, la API responde 400 invalid_model_id', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { character_id: 'per-1' } }]);
    await createCharacter({ modelId: 'realistic-sharp-v1' }, options(impl));
    // lo aprendimos de la propia API el 2026-09-02, no de su documentacion
    expect((calls[0]?.body as { model_id: string }).model_id).toBe('realistic-sharp-v1');
  });

  it('el catalogo conocido son los dos que la API nombro', () => {
    expect([...CHARACTER_MODELS]).toEqual(['realistic-sharp-v1', 'anime-pure-v1']);
  });

  it('no se filtra en local: un modelo nuevo de la API debe poder mandarse', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { character_id: 'per-1' } }]);
    await createCharacter({ modelId: 'modelo-que-aun-no-existe' }, options(impl));
    // si es invalido, el error de la API lo explica mejor que una lista nuestra
    expect((calls[0]?.body as { model_id: string }).model_id).toBe('modelo-que-aun-no-existe');
  });
});

describe('avatar del personaje', () => {
  it('se captura la URL que devuelve la creacion', async () => {
    const { impl } = fakeFetch([
      { status: 201, body: { character_id: 'per-1', avatar_url: 'https://cdn.example/a.webp' } },
    ]);
    const created = await createCharacter({ modelId: 'realistic-sharp-v1' }, options(impl));
    // se pago con la creacion: descartarla obligaba a generar otra imagen solo
    // para ver a quien acabas de crear
    expect(created.avatarUrl).toBe('https://cdn.example/a.webp');
  });

  it('sin avatar en la respuesta, es null y no un fallo', async () => {
    const { impl } = fakeFetch([{ status: 201, body: { character_id: 'per-1' } }]);
    const created = await createCharacter({ modelId: 'realistic-sharp-v1' }, options(impl));
    expect(created.avatarUrl).toBeNull();
  });
});

describe('rasgos y escena', () => {
  it('los rasgos viajan tal cual, sin traducir', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { character_id: 'per-1' } }]);
    await createCharacter(
      {
        modelId: 'realistic-sharp-v1',
        traits: { gender: 'female', ethnicity: 'hispanic', hairColor: 'blonde' },
      },
      options(impl),
    );
    // el enum es del proveedor: traducir un valor seria inventarse otro
    expect((calls[0]?.body as { traits: unknown }).traits).toEqual({
      gender: 'female',
      ethnicity: 'hispanic',
      hairColor: 'blonde',
    });
  });

  it('el catalogo es el que publica el proveedor', () => {
    expect([...CHARACTER_TRAITS.gender]).toEqual(['female', 'male']);
    expect([...CHARACTER_TRAITS.ageRange]).toEqual(['18-22', '21-22', '23-29', '30-39', '40-plus']);
    // los adultos son lo unico que ofrece, y eso no se toca desde aqui
    expect(CHARACTER_TRAITS.ageRange.some((value) => value.startsWith('1') && value !== '18-22')).toBe(
      false,
    );
  });

  it('la escena se recorta al tope de la API en vez de que lo rechace', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { character_id: 'per-1' } }]);
    await createCharacter(
      { modelId: 'realistic-sharp-v1', scene: 'x'.repeat(MAX_SCENE_CHARS + 500) },
      options(impl),
    );
    expect((calls[0]?.body as { scene: string }).scene).toHaveLength(MAX_SCENE_CHARS);
  });

  it('lo que no se aporta no se manda', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { character_id: 'per-1' } }]);
    await createCharacter({ modelId: 'realistic-sharp-v1' }, options(impl));
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('scene');
    expect(body).not.toHaveProperty('sfw');
    // el proveedor RETIRO las fotos de referencia: no queda rastro del campo
    expect(body).not.toHaveProperty('reference_image_url');
  });
});

describe('imagen', () => {
  it('acepta la respuesta sincrona (201)', async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 201,
        body: {
          generation_id: 'gen-1',
          status: 'completed',
          output_url: 'https://cdn.example/a.png',
          cost_credits: 2.5,
        },
      },
    ]);

    const generation = await generateImage(
      { characterId: 'per-1', prompt: 'un prompt' },
      options(impl),
    );
    expect(generation.status).toBe('completed');
    expect(generation.outputUrl).toBe('https://cdn.example/a.png');
    expect(generation.costCredits).toBe(2.5);
    expect(calls[0]?.url).toBe('https://api.xavira.ai/v1/images:generate');
  });

  it('acepta la respuesta asincrona (202)', async () => {
    const { impl } = fakeFetch([
      { status: 202, body: { generation_id: 'gen-2', status: 'pending', poll_url: '/v1/g/gen-2' } },
    ]);
    const generation = await generateImage(
      { characterId: 'per-1', prompt: 'otro' },
      options(impl),
    );
    expect(generation.status).toBe('pending');
    expect(generation.outputUrl).toBeNull();
  });

  it('envia los campos opcionales solo si se piden', async () => {
    const { impl, calls } = fakeFetch([
      { status: 201, body: { generation_id: 'g', status: 'completed' } },
    ]);
    await generateImage({ characterId: 'per-1', prompt: 'p' }, options(impl));
    expect(calls[0]?.body).toEqual({ character_id: 'per-1', prompt: 'p' });

    const segundo = fakeFetch([{ status: 201, body: { generation_id: 'g', status: 'completed' } }]);
    await generateImage(
      { characterId: 'per-1', prompt: 'p', hiresFix: '1.5x', resolution: 'hd_portrait' },
      options(segundo.impl),
    );
    expect(segundo.calls[0]?.body).toEqual({
      character_id: 'per-1',
      prompt: 'p',
      resolution: 'hd_portrait',
      hires_fix: '1.5x',
    });
  });
});

describe('video', () => {
  it('nunca envia callback_url', async () => {
    const { impl, calls } = fakeFetch([
      { status: 202, body: { generation_id: 'v-1', status: 'pending' } },
    ]);
    await generateVideo(
      { characterId: 'per-1', prompt: 'que se mueva', duration: '5s' },
      options(impl),
    );

    // un callback exigiria una URL publica, y el contenido pasaria por el
    // gateway: es justo lo que la boveda existe para impedir
    expect(JSON.stringify(calls[0]?.body)).not.toContain('callback');
    expect(calls[0]?.body).toEqual({
      character_id: 'per-1',
      prompt: 'que se mueva',
      duration: '5s',
    });
  });

  it('puede animar una imagen anterior', async () => {
    const { impl, calls } = fakeFetch([
      { status: 202, body: { generation_id: 'v-2', status: 'pending' } },
    ]);
    await generateVideo({ characterId: 'per-1', fromGenerationId: 'gen-1' }, options(impl));
    expect(calls[0]?.body).toEqual({ character_id: 'per-1', generation_id: 'gen-1' });
  });
});

describe('sondeo', () => {
  it('devuelve de inmediato lo que ya esta terminado', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
    const done = await awaitGeneration(
      {
        generationId: 'g',
        status: 'completed',
        outputUrl: 'https://cdn.example/a.png',
        costCredits: null,
        genTimeMs: null,
        error: null,
      },
      options(impl),
    );
    expect(done.outputUrl).toBe('https://cdn.example/a.png');
    // no hace falta ni una peticion
    expect(calls).toHaveLength(0);
  });

  it('sondea hasta que termina', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: { generation_id: 'g', status: 'running' } },
      { status: 200, body: { generation_id: 'g', status: 'running' } },
      {
        status: 200,
        body: { generation_id: 'g', status: 'completed', output_url: 'https://cdn.example/v.mp4' },
      },
    ]);

    const progreso: string[] = [];
    const done = await awaitGeneration(
      { generationId: 'g', status: 'pending', outputUrl: null, costCredits: null, genTimeMs: null, error: null },
      { ...options(impl), onProgress: (_n, status) => progreso.push(status) },
    );

    expect(done.status).toBe('completed');
    expect(done.outputUrl).toBe('https://cdn.example/v.mp4');
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url).toBe('https://api.xavira.ai/v1/generations/g');
    expect(progreso).toEqual(['running', 'running', 'completed']);
  });

  it('propaga el error del proveedor con su motivo', async () => {
    const { impl } = fakeFetch([
      { status: 200, body: { generation_id: 'g', status: 'failed', error: 'prompt rechazado' } },
    ]);
    await expect(
      awaitGeneration(
        { generationId: 'g', status: 'pending', outputUrl: null, costCredits: null, genTimeMs: null, error: null },
        options(impl),
      ),
    ).rejects.toThrow('prompt rechazado');
  });

  it('se rinde al agotar el tiempo, sin decir que fallo', async () => {
    const { impl } = fakeFetch([{ status: 200, body: { generation_id: 'g', status: 'running' } }]);
    await expect(
      awaitGeneration(
        { generationId: 'g', status: 'pending', outputUrl: null, costCredits: null, genTimeMs: null, error: null },
        { ...options(impl), maxWaitMs: 0 },
      ),
    ).rejects.toThrow('no termino a tiempo');
  });

  it('respeta la cancelacion', async () => {
    const controller = new AbortController();
    controller.abort();
    const { impl } = fakeFetch([{ status: 200, body: { generation_id: 'g', status: 'running' } }]);
    await expect(
      awaitGeneration(
        { generationId: 'g', status: 'pending', outputUrl: null, costCredits: null, genTimeMs: null, error: null },
        { ...options(impl), signal: controller.signal },
      ),
    ).rejects.toThrow('cancelada');
  });

  it('lee la cabecera Retry-After y la acota a 60 s', () => {
    const con = (value: string): Response => new Response('', { headers: { 'Retry-After': value } });
    expect(retryAfterMs(con('5'))).toBe(5000);
    expect(retryAfterMs(con('900'))).toBe(60_000);
    expect(retryAfterMs(con('no es un numero'))).toBeNull();
    expect(retryAfterMs(new Response(''))).toBeNull();
  });
});

describe('consulta de estado', () => {
  it('lee una generacion por su identificador', async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          generation_id: 'gen-9',
          status: 'completed',
          output_url: 'https://cdn.example/x.png',
          gen_time_ms: 4200,
          cost_credits: 2.5,
        },
      },
    ]);

    const generation = await readGeneration('gen-9', options(impl));
    expect(generation.genTimeMs).toBe(4200);
    expect(generation.costCredits).toBe(2.5);
    expect(calls[0]?.method).toBe('GET');
  });

  it('escapa el identificador en la ruta', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: { generation_id: 'a/b', status: 'pending' } },
    ]);
    await readGeneration('a/b', options(impl));
    // sin escapar, un identificador con barra saltaria a otra ruta de la API
    expect(calls[0]?.url).toBe('https://api.xavira.ai/v1/generations/a%2Fb');
  });
});

describe('errores', () => {
  it('explica que hacer segun el codigo', async () => {
    for (const [status, texto] of [
      [401, 'comprueba la clave'],
      [402, 'sin creditos'],
      [429, 'demasiadas peticiones'],
    ] as const) {
      const { impl } = fakeFetch([{ status, body: { message: 'no' } }]);
      await expect(
        generateImage({ characterId: 'c', prompt: 'p' }, options(impl)),
      ).rejects.toMatchObject({ hint: expect.stringContaining(texto) });
    }
  });

  it('un personaje que la API no reconoce se explica, no se vuelca', async () => {
    // el cuerpo real del 2026-09-02, que llegaba entero a la pantalla
    const { impl } = fakeFetch([
      {
        status: 404,
        body: {
          error: {
            code: 'character_not_found',
            message: 'character 4a1e227d-89b6-4393-8fe5-cbff8f95ed4c does not exist',
            request_id: '01M1H6ZJWYMBF771AWEBERJMK5',
          },
          request_id: '01M1H6ZJWYMBF771AWEBERJMK5',
        },
      },
    ]);

    const error = await generateImage({ characterId: 'c', prompt: 'p' }, options(impl)).catch(
      (e: unknown) => e as XaviraError,
    );

    expect(error.code).toBe('character_not_found');
    expect(error.status).toBe(404);
    expect(error.message).toContain('ese personaje no existe para la clave configurada');
    // la API responde igual para un identificador inventado y para uno de otra
    // cuenta, asi que el aviso tiene que mandar a mirar las dos cosas
    expect(error.hint).toContain('identificador');
    expect(error.hint).toContain('Conexiones');
    // y nada de JSON crudo delante del usuario
    expect(error.message).not.toContain('does not exist');
    expect(error.message).not.toContain('{');
  });

  it('conserva la referencia con la que se puede preguntar a su soporte', async () => {
    const { impl } = fakeFetch([
      {
        status: 404,
        body: {
          error: { code: 'character_not_found' },
          request_id: '01M1H6ZJWYMBF771AWEBERJMK5',
        },
      },
    ]);

    const error = await generateImage({ characterId: 'c', prompt: 'p' }, options(impl)).catch(
      (e: unknown) => e as XaviraError,
    );

    expect(error.requestId).toBe('01M1H6ZJWYMBF771AWEBERJMK5');
    expect(error.message).toContain('01M1H6ZJWYMBF771AWEBERJMK5');
  });

  it('un bloqueo de moderacion enseña el motivo tal cual', async () => {
    // su documentacion lo pide: es lo unico que dice que parte del texto sobra
    const { impl } = fakeFetch([
      {
        status: 422,
        body: {
          error: {
            code: 'moderation_blocked',
            message: 'Blocked: prompt contains restricted content (category=minors)',
          },
        },
      },
    ]);

    const error = await generateImage({ characterId: 'c', prompt: 'p' }, options(impl)).catch(
      (e: unknown) => e as XaviraError,
    );

    expect(error.message).toContain('category=minors');
    expect(error.hint).toContain('credito');
  });

  it('un codigo que no conocemos conserva el texto original de la API', async () => {
    // inventarse una traduccion para algo nuevo diria menos que su propio texto
    const { impl } = fakeFetch([
      { status: 418, body: { error: { code: 'codigo_futuro', message: 'algo nuevo' } } },
    ]);

    const error = await generateImage({ characterId: 'c', prompt: 'p' }, options(impl)).catch(
      (e: unknown) => e as XaviraError,
    );

    expect(error.message).toContain('418');
    expect(error.message).toContain('algo nuevo');
    expect(error.code).toBe('codigo_futuro');
  });

  it('un cuerpo que no es JSON no rompe el manejo del error', async () => {
    const impl = (async () =>
      new Response('<html>502 Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;

    const error = await generateImage({ characterId: 'c', prompt: 'p' }, options(impl)).catch(
      (e: unknown) => e as XaviraError,
    );

    expect(error.status).toBe(502);
    expect(error.code).toBeNull();
    expect(error.message).toContain('502');
  });

  it('lo que no debe salir viaja en el negativo, nunca en el prompt', async () => {
    // su documentacion insiste: el prompt positivo no tiene el concepto de «no»
    // y nombrar algo para excluirlo lo invoca
    const { impl, calls } = fakeFetch([{ status: 201, body: { generation_id: 'g', status: 'completed' } }]);
    await generateImage(
      { characterId: 'per-1', prompt: 'p', negativePromptAppend: '2girls, camera' },
      options(impl),
    );
    expect(calls[0]?.body).toEqual({
      character_id: 'per-1',
      prompt: 'p',
      negative_prompt_append: '2girls, camera',
    });
  });

  it('el negativo se acota al tope que documenta la API', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { generation_id: 'g', status: 'completed' } }]);
    await generateImage(
      { characterId: 'per-1', prompt: 'p', negativePromptAppend: 'x'.repeat(MAX_NEGATIVE_CHARS + 50) },
      options(impl),
    );
    const body = calls[0]?.body as { negative_prompt_append: string };
    expect(body.negative_prompt_append.length).toBe(MAX_NEGATIVE_CHARS);
  });

  it('un video acepta el mismo negativo', async () => {
    const { impl, calls } = fakeFetch([{ status: 202, body: { generation_id: 'g', status: 'pending' } }]);
    await generateVideo(
      { characterId: 'per-1', negativePromptAppend: '2girls' },
      options(impl),
    );
    expect(calls[0]?.body).toEqual({ character_id: 'per-1', negative_prompt_append: '2girls' });
  });

  it('la clave nunca aparece en el mensaje de error', async () => {
    // un cuerpo de error que repitiera la clave la filtraria al log
    const { impl } = fakeFetch([
      { status: 400, body: { error: { message: `clave ${KEY} invalida` } } },
    ]);
    const error = await generateImage({ characterId: 'c', prompt: 'p' }, options(impl)).catch(
      (e: unknown) => e as XaviraError,
    );
    expect(error.message).not.toContain(KEY);
  });
});

describe('descarga', () => {
  it('devuelve los bytes y el tipo', async () => {
    const impl = (async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'Content-Type': 'image/png' },
      })) as unknown as typeof fetch;

    const result = await downloadOutput('https://cdn.example/a.png', options(impl));
    expect([...result.bytes]).toEqual([1, 2, 3, 4]);
    expect(result.mimeType).toBe('image/png');
  });

  it('rechaza una URL sin cifrar', async () => {
    const impl = (async () => new Response('')) as unknown as typeof fetch;
    // seria contenido privado viajando en claro por la red
    await expect(downloadOutput('http://cdn.example/a.png', options(impl))).rejects.toThrow(
      'conexion insegura',
    );
  });

  it('rechaza una URL que no lo es', async () => {
    const impl = (async () => new Response('')) as unknown as typeof fetch;
    await expect(downloadOutput('no-es-una-url', options(impl))).rejects.toThrow('no es valida');
  });

  it('explica un fallo de descarga', async () => {
    const impl = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(downloadOutput('https://cdn.example/a.png', options(impl))).rejects.toThrow('404');
  });
});

describe('sin red real', () => {
  it('ninguna prueba de este archivo usa fetch de verdad', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      const { impl } = fakeFetch([{ status: 201, body: { character_id: 'c' } }]);
      await createCharacter({ modelId: 'realistic-sharp-v1' }, options(impl));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
