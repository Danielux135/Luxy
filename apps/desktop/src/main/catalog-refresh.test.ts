// la peticion del catalogo real, sin red: que se pide a cada host, cuando se
// cae a la lista simple, cuando NO se escribe lo que llego y que dos refrescos
// a la vez del mismo origen son uno solo.
//
// Todo esto vivia en el manejador `catalogRefresh`, sin una sola prueba. Las
// respuestas son INVENTADAS, con la forma de la lista de NanoGPT; el `fetch`,
// el disco y el reloj son los de aqui dentro.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redact, type CatalogSnapshot, type CatalogSource } from '@luxy/shared';
import {
  CATALOG_REFRESH_TIMEOUT_MS,
  CatalogRefreshError,
  NO_PRICING_NOTICE,
  createCatalogRefresher,
  refreshCatalog,
  type CatalogFetch,
  type CatalogRefreshDeps,
  type CatalogRefreshTarget,
} from './catalog-refresh.js';

const KEY = 'clave-inventada-0123456789abcdef';
const NOW = '2026-10-13T09:30:00.000Z';

const NANO: CatalogRefreshTarget = {
  connectionId: 'nanogpt',
  source: 'http',
  baseUrl: 'https://api.nano-gpt.com/api/v1',
  apiKey: KEY,
};
const NANO_DETAILED_URL = 'https://api.nano-gpt.com/api/v1/models?detailed=true';
const NANO_BASIC_URL = 'https://api.nano-gpt.com/api/v1/models';

// un host sin dialecto de catalogo, y con barras de mas al final de la base
const MISTRAL: CatalogRefreshTarget = {
  connectionId: 'mistral',
  source: 'http',
  baseUrl: 'https://api.mistral.ai/v1//',
  apiKey: KEY,
};

/** la lista con detalle, con lo que Luxy lee y con lo que ignora a proposito */
const DETAILED = {
  object: 'list',
  data: [
    {
      id: 'deepseek/deepseek-v4-pro',
      object: 'model',
      owned_by: 'deepseek',
      context_length: 128000,
      max_output_tokens: 64000,
      capabilities: { vision: false, reasoning: true, tool_calling: true },
      reasoning_efforts: ['none', 'high', 'max'],
      pricing: { prompt: 0.55, completion: 2.19, currency: 'USD' },
    },
    {
      id: 'TheDrummer/Cydonia-24B-v4.3',
      object: 'model',
      owned_by: 'thedrummer',
      context_length: 32768,
      max_output_tokens: null,
      capabilities: { vision: false, reasoning: false, tool_calling: false },
    },
  ],
};

/** la lista simple del mismo host: solo identificadores */
const BASIC = {
  object: 'list',
  data: [
    { id: 'deepseek/deepseek-v4-pro', object: 'model', created: 1, owned_by: 'deepseek' },
    { id: 'TheDrummer/Cydonia-24B-v4.3', object: 'model', created: 1, owned_by: 'thedrummer' },
  ],
};

type Reply = () => ReturnType<CatalogFetch>;

const json =
  (status: number, body: unknown): Reply =>
  async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const notJson =
  (status: number): Reply =>
  async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  });

// lo que lanza `fetch` cuando no llega: su mensaje trae la URL, y la de una
// conexion puede llevar credenciales incrustadas
const down = (): Reply => async () => {
  throw new TypeError(
    'fetch failed: connect ECONNREFUSED https://usuario:secreto@pasarela.example',
  );
};

function model(apiModel: string, extra: Partial<CatalogSnapshot['models'][number]> = {}) {
  return {
    apiModel,
    ownedBy: null,
    billing: 'unknown' as const,
    modelRatio: null,
    completionRatio: null,
    perCall: null,
    groups: [],
    declaredCapabilities: [],
    ...extra,
  };
}

/** un catalogo ya guardado, de dos modelos */
function stored(overrides: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    connectionId: 'nanogpt',
    source: 'http',
    fetchedAt: '2026-10-01T08:00:00.000Z',
    models: [
      model('deepseek/deepseek-v4-pro', {
        reasoning: true,
        reasoningEfforts: ['none', 'high', 'max'],
      }),
      model('TheDrummer/Cydonia-24B-v4.3', { reasoning: false }),
    ],
    pricingAvailable: false,
    notice: null,
    ...overrides,
  };
}

interface Harness {
  deps: CatalogRefreshDeps;
  calls: { url: string; authorization: string | undefined }[];
  written: CatalogSnapshot[];
  reads: [string, CatalogSource][];
}

/**
 * un `fetch` que contesta las respuestas dadas, en orden. Una peticion de mas
 * falla: asi «no pide la simple» se comprueba dos veces, por el recuento y
 * porque no habria quien la contestara.
 */
function setup(
  replies: Reply[],
  saved: CatalogSnapshot | null | ((source: CatalogSource) => CatalogSnapshot | null) = null,
): Harness {
  const pending = [...replies];
  const harness: Harness = {
    calls: [],
    written: [],
    reads: [],
    deps: {
      fetchImpl: async (url, init) => {
        harness.calls.push({ url, authorization: init.headers['Authorization'] });
        const next = pending.shift();
        if (next === undefined) throw new Error('la prueba no esperaba otra peticion');
        return next();
      },
      readSnapshot: (connectionId, source) => {
        harness.reads.push([connectionId, source]);
        return typeof saved === 'function' ? saved(source) : saved;
      },
      writeSnapshot: (snapshot) => {
        harness.written.push(snapshot);
      },
      now: () => new Date(NOW),
    },
  };
  return harness;
}

async function failureOf(run: Promise<unknown>): Promise<CatalogRefreshError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof CatalogRefreshError) return error;
    throw error;
  }
  throw new Error('se esperaba un CatalogRefreshError y no fallo');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('un host sin dialecto de catalogo: la lista simple de siempre', () => {
  it('pide la base mas /models con la clave en la cabecera, y no dice con que lista se leyo', async () => {
    const h = setup([json(200, BASIC)]);
    const snapshot = await refreshCatalog(MISTRAL, h.deps);

    // la misma cadena de siempre, byte a byte: sin consulta y sin barras dobles
    expect(h.calls).toEqual([
      { url: 'https://api.mistral.ai/v1/models', authorization: `Bearer ${KEY}` },
    ]);
    expect(h.written).toEqual([snapshot]);
    expect(snapshot).toMatchObject({ connectionId: 'mistral', source: 'http', fetchedAt: NOW });
    expect(snapshot.models.map((entry) => entry.apiModel)).toEqual([
      'deepseek/deepseek-v4-pro',
      'TheDrummer/Cydonia-24B-v4.3',
    ]);
    // `detail` es solo de los hosts con dialecto: aqui la clave ni existe
    expect('detail' in snapshot).toBe(false);
    expect(snapshot.notice).toBe(NO_PRICING_NOTICE);
    expect(NO_PRICING_NOTICE).toBe(
      'Esta conexion no publica precios por API; Luxy no los consulta.',
    );
  });

  it('un host PARECIDO al de la pasarela recibe la simple, no la detallada', async () => {
    const h = setup([json(200, BASIC)]);
    const snapshot = await refreshCatalog(
      { ...NANO, baseUrl: 'https://api.nano-gpt.com.otro.example/api/v1' },
      h.deps,
    );
    expect(h.calls.map((call) => call.url)).toEqual([
      'https://api.nano-gpt.com.otro.example/api/v1/models',
    ]);
    expect('detail' in snapshot).toBe(false);
  });

  it.each([
    { status: 401, advice: 'Revisa la clave guardada' },
    { status: 403, advice: 'Revisa la clave guardada' },
    { status: 404, advice: 'Revisa la URL base' },
    { status: 429, advice: 'espera un momento' },
    { status: 500, advice: 'dentro de un momento' },
  ])('un $status llega con su codigo y con que hacer, y no escribe nada', async (row) => {
    const h = setup([json(row.status, { error: { message: 'inventado' } })]);
    const error = await failureOf(refreshCatalog(MISTRAL, h.deps));

    expect(error.status).toBe(row.status);
    expect(error.message).toContain(
      `el proveedor no devolvió la lista de modelos (HTTP ${row.status})`,
    );
    expect(error.message).toContain(row.advice);
    // sin dialecto no hay segunda lista que pedir
    expect(h.calls).toHaveLength(1);
    expect(h.written).toEqual([]);
  });

  it('nombra de que lista de la configuracion sale', async () => {
    const h = setup([json(500, {})]);
    const error = await failureOf(
      refreshCatalog({ ...MISTRAL, connectionId: 'pasarela', source: 'connection' }, h.deps),
    );
    expect(error.message).toContain('la conexión no devolvió la lista de modelos (HTTP 500)');
  });

  it('cero modelos no se escriben encima de un catalogo que los tiene', async () => {
    // un 200 con otra forma no es un fallo de red: antes salia un catalogo
    // vacio y se guardaba encima del bueno
    for (const body of [{ error: 'otra forma' }, { data: [] }, { data: [{ id: 42 }] }, 'texto']) {
      const h = setup([json(200, body)], stored({ connectionId: 'mistral' }));
      const error = await failureOf(refreshCatalog(MISTRAL, h.deps));

      expect(h.written).toEqual([]);
      expect(error.status).toBe(200);
      expect(error.message).toContain('HTTP 200 sin ningún modelo que Luxy pueda leer');
      expect(error.message).toContain('Se conserva el catálogo anterior, con 2 modelos.');
      // y lo guardado se busca con el identificador y el origen pedidos
      expect(h.reads).toEqual([['mistral', 'http']]);
    }
  });

  it('cero modelos sin nada que perder se escriben, con la cuenta de lo ilegible', async () => {
    const empties: (CatalogSnapshot | null)[] = [null, stored({ models: [] })];
    for (const saved of empties) {
      const h = setup([json(200, { data: [{ id: 42 }, 'suelta'] })], saved);
      const snapshot = await refreshCatalog(MISTRAL, h.deps);

      expect(h.written).toEqual([snapshot]);
      expect(snapshot.models).toEqual([]);
      expect(snapshot.unreadableModels).toBe(2);
    }
  });

  it('cuando no llega, lo dice sin el texto del error original', async () => {
    const h = setup([down()], stored({ models: [model('uno')] }));
    const error = await failureOf(refreshCatalog(MISTRAL, h.deps));

    expect(error.status).toBeNull();
    expect(error.message).toContain('(no se pudo llegar al servidor)');
    expect(error.message).toContain('Se conserva el catálogo anterior, con 1 modelo.');
    expect(error.message).toContain('Comprueba la conexión a internet y la URL base');
    expect(error.message).not.toContain('ECONNREFUSED');
    expect(error.message).not.toContain('secreto');
    expect(h.written).toEqual([]);
  });

  it('un 200 que no es JSON no es un catalogo', async () => {
    const h = setup([notJson(200)]);
    const error = await failureOf(refreshCatalog(MISTRAL, h.deps));

    expect(error.status).toBe(200);
    expect(error.message).toContain('HTTP 200 con una respuesta que no es JSON');
    expect(error.message).not.toContain('Unexpected token');
    // sin nada guardado no hay nada que decir que se conserva
    expect(error.message).not.toContain('Se conserva');
    expect(h.written).toEqual([]);
  });
});

describe('un host con dialecto de catalogo', () => {
  it('pide la lista con detalle y la guarda como tal, con lo que declara cada modelo', async () => {
    const h = setup([json(200, DETAILED)]);
    const snapshot = await refreshCatalog(NANO, h.deps);

    expect(h.calls).toEqual([{ url: NANO_DETAILED_URL, authorization: `Bearer ${KEY}` }]);
    expect(h.written).toEqual([snapshot]);
    expect(snapshot.detail).toBe('detailed');
    expect(snapshot.fetchedAt).toBe(NOW);
    expect(snapshot.models[0]).toMatchObject({
      apiModel: 'deepseek/deepseek-v4-pro',
      reasoning: true,
      reasoningEfforts: ['none', 'high', 'max'],
      declaredOutputCap: 64000,
      declaredContext: 128000,
    });
    // el que declara que no razona lo dice, y un tope `null` no es cero
    expect(snapshot.models[1]).toMatchObject({ reasoning: false, declaredContext: 32768 });
    expect('declaredOutputCap' in (snapshot.models[1] ?? {})).toBe(false);
  });

  it('del precio solo dice que Luxy no lo lee', async () => {
    const h = setup([json(200, DETAILED)]);
    const snapshot = await refreshCatalog(NANO, h.deps);

    // la lista con detalle SI trae precios: decir que la pasarela «no publica
    // precios» seria falso. Luxy no los lee, y no afirma nada mas
    expect(snapshot.notice).toBe('Luxy no lee los precios de NanoGPT.');
    expect(snapshot.notice).not.toContain('no publica');
    expect(snapshot.pricingAvailable).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('2.19');
  });

  it('vale igual para el otro host de la pasarela y con la base acabada en barra', async () => {
    const h = setup([json(503, {}), json(200, BASIC)]);
    await refreshCatalog({ ...NANO, baseUrl: 'https://nano-gpt.com/api/v1/' }, h.deps);
    expect(h.calls.map((call) => call.url)).toEqual([
      'https://nano-gpt.com/api/v1/models?detailed=true',
      'https://nano-gpt.com/api/v1/models',
    ]);
  });

  interface DetailedFailure {
    title: string;
    reply: Reply;
    says: string;
    status: number | null;
  }

  const DETAILED_FAILURES: DetailedFailure[] = [
    {
      title: 'un 429 pasajero',
      reply: json(429, { error: { code: 'rate_limited' } }),
      says: '(HTTP 429)',
      status: 429,
    },
    { title: 'un 500', reply: json(500, {}), says: '(HTTP 500)', status: 500 },
    {
      title: 'que no llegue',
      reply: down(),
      says: '(no se pudo llegar al servidor)',
      status: null,
    },
    {
      title: 'un 200 sin modelos',
      reply: json(200, { data: [] }),
      says: '(HTTP 200 sin ningún modelo que Luxy pueda leer)',
      status: 200,
    },
    {
      title: 'un 200 que no es JSON',
      reply: notJson(200),
      says: '(HTTP 200 con una respuesta que no es JSON)',
      status: 200,
    },
    {
      // la lista simple contestada a quien pidio el detalle: llega bien y con
      // modelos, y sellarla como detallada borraria los niveles de todos
      title: 'un 200 con la lista simple',
      reply: json(200, BASIC),
      says: '(HTTP 200 con la lista sin el detalle de ningún modelo)',
      status: 200,
    },
  ];

  it.each(DETAILED_FAILURES)(
    'con $title y un catalogo detallado guardado, no se pide la simple ni se escribe',
    async (row) => {
      // caer a la simple aqui borraria los niveles de TODOS los modelos por un
      // fallo que puede durar un minuto
      const h = setup([row.reply], stored({ detail: 'detailed' }));
      const error = await failureOf(refreshCatalog(NANO, h.deps));

      expect(h.calls.map((call) => call.url)).toEqual([NANO_DETAILED_URL]);
      expect(h.written).toEqual([]);
      expect(h.reads).toEqual([['nanogpt', 'http']]);
      expect(error.status).toBe(row.status);
      expect(error.message).toContain(
        `NanoGPT no devolvió la lista de modelos con detalle ${row.says}.`,
      );
      expect(error.message).toContain('Se conserva el catálogo anterior, con 2 modelos');
      expect(error.message).toContain('no trae los niveles de razonamiento');
    },
  );

  it.each([
    { title: 'no hay nada guardado', saved: null },
    { title: 'lo guardado se leyo sin detalle', saved: stored({ detail: 'basic' }) },
    { title: 'lo guardado es anterior a F36 y no dice como se leyo', saved: stored() },
  ])('si la detallada falla y $title, cae a la simple y lo deja dicho', async (row) => {
    const h = setup([json(429, {}), json(200, BASIC)], row.saved);
    const snapshot = await refreshCatalog(NANO, h.deps);

    expect(h.calls).toEqual([
      { url: NANO_DETAILED_URL, authorization: `Bearer ${KEY}` },
      { url: NANO_BASIC_URL, authorization: `Bearer ${KEY}` },
    ]);
    expect(h.written).toEqual([snapshot]);
    // `basic` y no ausente: la pantalla tiene que poder decir que los niveles
    // no se pidieron, que no es lo mismo que «no los declara»
    expect(snapshot.detail).toBe('basic');
    expect(snapshot.models).toHaveLength(2);
    expect(snapshot.models.some((entry) => 'reasoningEfforts' in entry)).toBe(false);
    // el codigo del intento con detalle no se pierde: es lo unico que queda de el
    expect(snapshot.notice).toContain(
      'NanoGPT no devolvió la lista de modelos con detalle (HTTP 429)',
    );
    expect(snapshot.notice).toContain('se leyó sin detalle');
    expect(snapshot.notice).toContain('Luxy no lee los precios de NanoGPT.');
    expect(snapshot.notice).not.toContain('no publica');
  });

  it('la lista simple contestada a la peticion con detalle no se guarda como detallada', async () => {
    // un catalogo se marca `detailed` por lo que LLEGO, no por lo que se pidio.
    // Marcada asi, la pantalla diria de cada modelo que la pasarela «no declara
    // niveles», cuando es que no se llego a leer ninguno
    const h = setup([json(200, BASIC), json(200, BASIC)]);
    const snapshot = await refreshCatalog(NANO, h.deps);

    expect(h.calls.map((call) => call.url)).toEqual([NANO_DETAILED_URL, NANO_BASIC_URL]);
    expect(h.written).toEqual([snapshot]);
    expect(snapshot.detail).toBe('basic');
    expect(snapshot.models).toHaveLength(2);
    expect(snapshot.notice).toContain(
      'NanoGPT no devolvió la lista de modelos con detalle (HTTP 200 con la lista sin el detalle de ningún modelo)',
    );
    expect(snapshot.notice).toContain('se leyó sin detalle');

    // y basta con UN dato declarado en UN modelo para que sea la detallada: un
    // modelo recien añadido del que la pasarela aun no dice nada no la invalida
    const declared = [
      { capabilities: { reasoning: false } },
      { reasoning_efforts: ['low'] },
      { max_output_tokens: 8192 },
      { context_length: 32768 },
    ];
    for (const fields of declared) {
      const one = setup([json(200, { data: [{ id: 'sin-nada' }, { id: 'con-dato', ...fields }] })]);
      const kept = await refreshCatalog(NANO, one.deps);
      expect(one.calls.map((call) => call.url)).toEqual([NANO_DETAILED_URL]);
      expect(kept.detail).toBe('detailed');
    }
  });

  it('ante la lista simple en lugar de la detallada no manda a revisar la URL base', async () => {
    // la URL contesto un 200 y con modelos: es la de la API, y mandar a
    // revisarla seria un consejo falso. Lo unico que cabe es volver a pedirla
    const h = setup([json(200, BASIC)], stored({ detail: 'detailed' }));
    const error = await failureOf(refreshCatalog(NANO, h.deps));

    expect(error.message).toContain(
      'que no trae los niveles de razonamiento. Vuelve a actualizar los modelos dentro de un momento.',
    );
    expect(error.message).not.toContain('URL base');

    // un 200 sin modelos es otra cosa: ahi si puede ser que la URL no sea la de
    // la API, y se sigue diciendo
    const empty = setup([json(200, { data: [] })], stored({ detail: 'detailed' }));
    const other = await failureOf(refreshCatalog(NANO, empty.deps));
    expect(other.message).toContain('Revisa que la URL base sea la de la API');
  });

  it('si fallan las dos, el error trae los dos codigos y no se escribe nada', async () => {
    const h = setup([json(503, {}), json(429, {})]);
    const error = await failureOf(refreshCatalog(NANO, h.deps));

    expect(h.calls).toHaveLength(2);
    expect(h.written).toEqual([]);
    expect(error.status).toBe(429);
    expect(error.message).toContain(
      'NanoGPT no devolvió la lista de modelos (con detalle, HTTP 503; sin detalle, HTTP 429).',
    );
    expect(error.message).not.toContain('Se conserva');
  });

  it('la simple de respaldo tampoco escribe cero modelos encima de un catalogo que los tiene', async () => {
    const h = setup([json(200, { data: [] }), json(200, {})], stored({ detail: 'basic' }));
    const error = await failureOf(refreshCatalog(NANO, h.deps));

    expect(h.calls).toHaveLength(2);
    expect(h.written).toEqual([]);
    expect(error.status).toBe(200);
    expect(error.message).toContain('Se conserva el catálogo anterior, con 2 modelos.');
    // lo guardado se lee una sola vez aunque se consulte en los dos pasos
    expect(h.reads).toEqual([['nanogpt', 'http']]);
  });

  it('una conexion y un proveedor HTTP con el mismo nombre no comparten lo guardado', async () => {
    // el detallado es del proveedor HTTP. La conexion que se llama igual no
    // tiene nada con detalle que perder, y a ella si se le pide la simple
    const onlyHttp = (source: CatalogSource): CatalogSnapshot | null =>
      source === 'http' ? stored({ detail: 'detailed' }) : null;

    const connection = setup([json(429, {}), json(200, BASIC)], onlyHttp);
    const snapshot = await refreshCatalog({ ...NANO, source: 'connection' }, connection.deps);
    expect(connection.reads).toEqual([['nanogpt', 'connection']]);
    expect(connection.written).toEqual([snapshot]);
    expect(snapshot).toMatchObject({ source: 'connection', detail: 'basic' });

    const provider = setup([json(429, {})], onlyHttp);
    await failureOf(refreshCatalog(NANO, provider.deps));
    expect(provider.written).toEqual([]);
  });
});

describe('dos refrescos a la vez del mismo origen', () => {
  /** un turno entero del bucle: todo lo que podia avanzar sin la red ya avanzo */
  const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * una red que no contesta hasta que la prueba la vacia. «A la vez» es que las
   * llamadas esten esperando respuesta, y eso no puede depender de cuantos
   * `await` tenga cada camino. `replyTo` recibe la URL y el numero de orden de
   * la peticion, empezando en 1.
   */
  function slowNetwork(replyTo: (url: string, nth: number) => Reply): {
    fetchImpl: CatalogFetch;
    urls: string[];
    drain: () => Promise<void>;
  } {
    const urls: string[] = [];
    const waiting: (() => void)[] = [];
    return {
      urls,
      fetchImpl: (url) => {
        urls.push(url);
        const reply = replyTo(url, urls.length);
        return new Promise((resolve, reject) => {
          waiting.push(() => {
            reply().then(resolve, reject);
          });
        });
      },
      // de una en una y por orden de llegada, con un turno entero entre medias:
      // lo que cada respuesta desencadena —otra peticion, una escritura— ocurre
      // antes de que conteste la siguiente
      drain: async () => {
        while (waiting.length > 0) {
          waiting.shift()?.();
          await turn();
        }
      },
    };
  }

  it('el segundo recibe el refresco que ya esta en curso: una sola tanda de peticiones y el mismo catalogo', async () => {
    const h = setup([]);
    const net = slowNetwork(() => json(200, DETAILED));
    const refresh = createCatalogRefresher();

    const first = refresh(NANO, { ...h.deps, fetchImpl: net.fetchImpl });
    // el otro boton de la pantalla: otra llamada, con sus propios objetos. Lo
    // que la hace la misma es el origen
    const second = refresh({ ...NANO }, { ...h.deps, fetchImpl: net.fetchImpl });
    await turn();
    expect(net.urls).toEqual([NANO_DETAILED_URL]);

    await net.drain();
    const [a, b] = await Promise.all([first, second]);
    expect(net.urls).toEqual([NANO_DETAILED_URL]);
    expect(b).toBe(a);
    expect(h.written).toEqual([a]);
  });

  it('el que cayo a la lista simple no escribe encima del que guardo la detallada', async () => {
    // el fallo, por orden de llegada: dos botones de la pantalla refrescan el
    // mismo proveedor. A uno le falla la lista con detalle, ve que no hay nada
    // detallado guardado y pide la simple; mientras la espera, el otro guarda
    // la detallada. La simple llega la ultima y borra los niveles recien leidos.
    // El disco es el de verdad: se lee lo ultimo que se escribio
    const h: Harness = setup([], () => h.written[h.written.length - 1] ?? null);
    // la primera peticion con detalle falla; cualquier otra acierta
    const net = slowNetwork((url, nth) =>
      url === NANO_BASIC_URL ? json(200, BASIC) : nth === 1 ? json(429, {}) : json(200, DETAILED),
    );
    const deps = { ...h.deps, fetchImpl: net.fetchImpl };
    const refresh = createCatalogRefresher();

    const first = refresh(NANO, deps);
    const second = refresh(NANO, deps);
    await net.drain();
    const [a, b] = await Promise.all([first, second]);

    // nunca hubo una detallada guardada que pisar, porque fue una sola tanda
    expect(h.written.map((snapshot) => snapshot.detail)).toEqual(['basic']);
    expect(net.urls).toEqual([NANO_DETAILED_URL, NANO_BASIC_URL]);
    // y las dos llamadas reciben lo que de verdad quedo guardado
    expect(b).toBe(a);
    expect(h.written).toEqual([a]);
  });

  it('origenes distintos no se esperan entre si', async () => {
    const h = setup([]);
    const net = slowNetwork((url) => json(200, url === NANO_DETAILED_URL ? DETAILED : BASIC));
    const deps = { ...h.deps, fetchImpl: net.fetchImpl };
    const refresh = createCatalogRefresher();

    const provider = refresh(NANO, deps);
    // la conexion que se llama igual que el proveedor es OTRO origen, con su
    // URL, su clave y su catalogo: darle el refresco del proveedor seria
    // entregarle un catalogo que no es el suyo
    const connection = refresh({ ...NANO, source: 'connection' }, deps);
    const other = refresh(MISTRAL, deps);
    // las tres peticiones han salido sin que ninguna haya contestado
    expect(net.urls).toEqual([
      NANO_DETAILED_URL,
      NANO_DETAILED_URL,
      'https://api.mistral.ai/v1/models',
    ]);

    await net.drain();
    const snapshots = await Promise.all([provider, connection, other]);
    expect(snapshots.map((snapshot) => [snapshot.connectionId, snapshot.source])).toEqual([
      ['nanogpt', 'http'],
      ['nanogpt', 'connection'],
      ['mistral', 'http'],
    ]);
    expect(h.written).toEqual(snapshots);
  });

  it('la clave es el origen y no el nombre de archivo: la conexion `http-x` y el proveedor `x` no comparten refresco', async () => {
    // el almacen guarda el catalogo de un proveedor como `http-<id>.json` y el
    // de una conexion como `<id>.json`: estos dos van al MISMO archivo, y la
    // configuracion los admite juntos. Ese choque es del almacen y no se
    // arregla aqui. Lo que se decide aqui es que el registro no lo herede: con
    // el nombre de archivo como clave, la conexion recibiria el catalogo del
    // proveedor, pedido a otra URL y con otra clave
    const h = setup([]);
    const net = slowNetwork(() => json(200, BASIC));
    const deps = { ...h.deps, fetchImpl: net.fetchImpl };
    const refresh = createCatalogRefresher();

    const provider = refresh(
      { connectionId: 'x', source: 'http', baseUrl: 'https://proveedor.example/v1', apiKey: KEY },
      deps,
    );
    const connection = refresh(
      {
        connectionId: 'http-x',
        source: 'connection',
        baseUrl: 'https://conexion.example/v1',
        apiKey: KEY,
      },
      deps,
    );
    // las dos peticiones han salido, cada una a su URL
    expect(net.urls).toEqual([
      'https://proveedor.example/v1/models',
      'https://conexion.example/v1/models',
    ]);

    await net.drain();
    const snapshots = await Promise.all([provider, connection]);
    expect(snapshots.map((snapshot) => [snapshot.connectionId, snapshot.source])).toEqual([
      ['x', 'http'],
      ['http-x', 'connection'],
    ]);
    expect(h.written).toEqual(snapshots);
  });

  it('al terminar deja el hueco libre: una llamada nueva vuelve a pedir', async () => {
    const h = setup([json(200, DETAILED), json(200, DETAILED)]);
    const refresh = createCatalogRefresher();

    const first = await refresh(NANO, h.deps);
    const again = await refresh(NANO, h.deps);

    // no es una cache: «Actualizar modelos» siempre pregunta a la pasarela
    expect(h.calls.map((call) => call.url)).toEqual([NANO_DETAILED_URL, NANO_DETAILED_URL]);
    expect(again).not.toBe(first);
    expect(h.written).toEqual([first, again]);
  });

  it('un refresco que falla tambien lo deja libre, y el fallo llega a los dos', async () => {
    const h = setup([]);
    // la primera peticion falla; la siguiente acierta
    const net = slowNetwork((_url, nth) => (nth === 1 ? json(500, {}) : json(200, BASIC)));
    const deps = { ...h.deps, fetchImpl: net.fetchImpl };
    const refresh = createCatalogRefresher();

    const first = failureOf(refresh(MISTRAL, deps));
    const second = failureOf(refresh(MISTRAL, deps));
    await net.drain();
    const [a, b] = await Promise.all([first, second]);
    expect(net.urls).toHaveLength(1);
    expect(b).toBe(a);
    expect(a.status).toBe(500);
    expect(h.written).toEqual([]);

    // un fallo no deja al origen sin poder actualizarse hasta reiniciar: el
    // siguiente no hereda el error, vuelve a pedir
    const retry = refresh(MISTRAL, deps);
    await net.drain();
    const snapshot = await retry;
    expect(net.urls).toHaveLength(2);
    expect(h.written).toEqual([snapshot]);
  });
});

describe('el tiempo de espera', () => {
  /** un `fetch` que no contesta nunca y solo acaba cuando lo cortan */
  function hanging(): { fetchImpl: CatalogFetch; signals: AbortSignal[] } {
    const signals: AbortSignal[] = [];
    return {
      signals,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          signals.push(init.signal);
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    };
  }

  it('son los 30 segundos de siempre, ni uno menos', async () => {
    vi.useFakeTimers();
    const h = setup([]);
    const { fetchImpl, signals } = hanging();
    const outcome = failureOf(refreshCatalog(MISTRAL, { ...h.deps, fetchImpl }));

    expect(CATALOG_REFRESH_TIMEOUT_MS).toBe(30_000);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signals.map((signal) => signal.aborted)).toEqual([false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);

    const error = await outcome;
    expect(error.status).toBeNull();
    expect(error.message).toContain('(sin respuesta en 30 segundos)');
    expect(h.written).toEqual([]);
  });

  it('cubre tambien la lectura del cuerpo', async () => {
    // una respuesta que empieza y no acaba no es «un JSON roto»: no llego
    vi.useFakeTimers();
    const h = setup([]);
    const fetchImpl: CatalogFetch = async (_url, init) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    });
    const outcome = failureOf(refreshCatalog(MISTRAL, { ...h.deps, fetchImpl }));
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_TIMEOUT_MS);

    const error = await outcome;
    expect(error.message).toContain('(sin respuesta en 30 segundos)');
    expect(error.message).not.toContain('no es JSON');
  });

  it('en un host con dialecto cada lista tiene su propio plazo', async () => {
    vi.useFakeTimers();
    const h = setup([]);
    const { fetchImpl, signals } = hanging();
    const outcome = failureOf(refreshCatalog(NANO, { ...h.deps, fetchImpl }));

    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_TIMEOUT_MS);
    // la detallada se corto y la simple acaba de salir, con su plazo entero
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_TIMEOUT_MS);

    const error = await outcome;
    expect(error.message).toContain(
      '(con detalle, sin respuesta en 30 segundos; sin detalle, sin respuesta en 30 segundos)',
    );
  });

  it('no deja ningun temporizador vivo, ni al acertar ni al fallar', async () => {
    vi.useFakeTimers();
    const ok = setup([json(200, BASIC)]);
    await refreshCatalog(MISTRAL, ok.deps);
    expect(vi.getTimerCount()).toBe(0);

    const ko = setup([json(500, {}), down()]);
    await failureOf(refreshCatalog(NANO, ko.deps));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('lo que nunca sale de aqui', () => {
  it('la clave no llega al catalogo guardado ni a ningun mensaje', async () => {
    const good = setup([json(200, DETAILED)]);
    await refreshCatalog(NANO, good.deps);
    expect(JSON.stringify(good.written)).not.toContain(KEY);

    const fallback = setup([json(401, { error: `clave ${KEY} rechazada` }), json(200, BASIC)]);
    await refreshCatalog(NANO, fallback.deps);
    expect(JSON.stringify(fallback.written)).not.toContain(KEY);

    const scenarios: Harness[] = [
      setup([json(401, { error: `clave ${KEY} rechazada` })], stored({ detail: 'detailed' })),
      setup([down(), down()]),
      setup([notJson(200), json(200, {})], stored()),
    ];
    for (const h of scenarios) {
      const error = await failureOf(refreshCatalog(NANO, h.deps));
      expect(error.message).not.toContain(KEY);
      expect(error.message).not.toContain('Bearer');
    }
  });

  it('los mensajes pasan por la redaccion del IPC sin perder nada', async () => {
    // el manejador devuelve `redact(error.message)`: un mensaje que la
    // redaccion mutilase llegaria a la pantalla sin el codigo o sin el consejo
    const scenarios: [CatalogRefreshTarget, Harness][] = [
      [NANO, setup([json(429, {})], stored({ detail: 'detailed' }))],
      [NANO, setup([json(200, BASIC)], stored({ detail: 'detailed' }))],
      [NANO, setup([json(503, {}), json(404, {})])],
      [MISTRAL, setup([json(401, {})])],
      [MISTRAL, setup([json(200, {})], stored())],
    ];
    for (const [target, h] of scenarios) {
      const error = await failureOf(refreshCatalog(target, h.deps));
      expect(redact(error.message)).toBe(error.message);
    }
  });

  it('si no se puede guardar, lo dice con el codigo del sistema y sin la ruta', async () => {
    const h = setup([json(200, DETAILED)]);
    const error = await failureOf(
      refreshCatalog(NANO, {
        ...h.deps,
        writeSnapshot: () => {
          throw Object.assign(
            new Error(
              "EPERM: operation not permitted, open 'X:\\ruta\\inventada\\http-nanogpt.json'",
            ),
            { code: 'EPERM' },
          );
        },
      }),
    );

    expect(error.status).toBeNull();
    expect(error.message).toContain(
      'la lista de modelos llegó, pero no se pudo guardar en este equipo (EPERM).',
    );
    expect(error.message).toContain('vuelve a actualizar los modelos');
    expect(error.message).not.toContain('inventada');
    expect(error.message).not.toContain('operation not permitted');
  });

  it('un fallo al guardar sin codigo reconocible tampoco enseña el error original', async () => {
    const h = setup([json(200, BASIC)]);
    const error = await failureOf(
      refreshCatalog(MISTRAL, {
        ...h.deps,
        writeSnapshot: () => {
          throw Object.assign(new Error('algo raro en X:\\ruta'), { code: 'no es un codigo' });
        },
      }),
    );
    expect(error.message).toContain('no se pudo guardar en este equipo. Comprueba');
    expect(error.message).not.toContain('algo raro');
  });
});
