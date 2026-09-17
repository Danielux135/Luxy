// el envio de una imagen, visto desde el registro de intentos.
//
// Lo que solo puede romperse AQUI es la costura: que el texto que sale sea el
// del plan y no otro compuesto por el camino, que el intento quede apuntado
// PASE LO QUE PASE —incluido el fallo, que es cuando hace falta—, y que un
// registro que revienta no decida si se genera o no.
//
// Ni red, ni tokens, ni una sola llamada real: `submitImage`, `awaitImage` y
// `downloadImage` estan simulados aqui dentro.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  composeHordeImagePlan,
  composeXaviraImagePlan,
  hordeRecipeSchema,
  imageAttemptSchema,
  VAULT_IMAGE_NEGATIVE,
  type ImageAttempt,
  type VaultImageAttemptState,
  type VaultImagePlan,
  type VaultMediaPayload,
} from '@luxy/shared';

/** canales registrados por `registerIpcHandlers`, para poder invocarlos */
const canales = vi.hoisted(
  () => new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
);

// electron no existe fuera de electron: solo hace falta lo que se toca al
// REGISTRAR, que es el registro de canales
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0', getPath: () => '' },
  dialog: {},
  shell: {},
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: {
    removeHandler: (channel: string) => {
      canales.delete(channel);
    },
    handle: (channel: string, fn: (event: unknown, args: unknown) => Promise<unknown>) => {
      canales.set(channel, fn);
    },
  },
  BrowserWindow: class {},
}));

/** lo que el proveedor simulado va a hacer en la proxima llamada */
const horde = vi.hoisted(() => ({
  /** la peticion tal y como llego al transporte: es la prueba de la invariante */
  lastRequest: null as {
    prompt: string;
    models: string[];
    seed: string | null;
    shared: boolean;
  } | null,
  /**
   * lo que el SERVIDOR contesta que hizo con la imagen.
   *
   * Es un valor propio y no un eco de la peticion: el horde decide por su
   * cuenta, asi que la prueba tiene que poder separarlos. `null` = no lo dijo.
   */
  shared: null as boolean | null,
  submitWarnings: [] as { code: string; message: string }[],
  /** si no es null, `submitImage` lanza esto */
  submitError: null as Error | null,
  /** la peticion en seco, aparte de la de verdad: no pueden confundirse */
  lastEstimate: null as { prompt: string; dryRun: boolean | undefined } | null,
  estimateCalls: 0,
  estimateKudos: 34 as number | null,
  estimateWarnings: [] as { code: string; message: string }[],
  /** si no es null, `estimateKudos` lanza esto */
  estimateError: null as Error | null,
  awaitCalls: 0,
  /** si no es null, `awaitImage` lanza esto: el fallo DESPUES de encolar */
  awaitError: null as Error | null,
  downloadCalls: 0,
  seed: '1080257389',
  model: 'WAI-NSFW-illustrious-SDXL',
  workerName: 'una-gpu-cualquiera',
  workerId: 'w-9',
  kudos: 12.5,
}));

vi.mock('@luxy/agent/dist/providers/horde.js', () => {
  class HordeError extends Error {
    constructor(
      message: string,
      readonly status: number | null = null,
      readonly hint: string | null = null,
      readonly rc: string | null = null,
      /**
       * lo que se supiera de la generacion al fallar.
       *
       * Un bloqueo de la red llega DESPUES de generar: el worker, el modelo y
       * la semilla vienen dentro. `null` es un fallo anterior a todo eso.
       */
      readonly attribution: {
        workerName: string | null;
        workerId: string | null;
        model: string | null;
        seed: string | null;
      } | null = null,
    ) {
      super(message);
      this.name = 'HordeError';
    }
  }
  return {
    HordeError,
    ANONYMOUS_API_KEY: '0000000000',
    HORDE_BASE_URL: 'https://stablehorde.net/api',
    isAnonymousKey: (key: string) => key === '0000000000',
    findUser: async () => ({ username: 'nadie', id: 1, kudos: 0, concurrency: 1 }),
    listImageModels: async () => [],
    submitImage: async (request: {
      prompt: string;
      models: string[];
      seed: string | null;
      shared: boolean;
    }) => {
      horde.lastRequest = request;
      if (horde.submitError !== null) throw horde.submitError;
      return { id: 'trabajo-1', kudos: 1, warnings: horde.submitWarnings };
    },
    estimateKudos: async (request: { prompt: string; dryRun?: boolean }) => {
      horde.estimateCalls += 1;
      horde.lastEstimate = { prompt: request.prompt, dryRun: request.dryRun };
      if (horde.estimateError !== null) throw horde.estimateError;
      return { kudos: horde.estimateKudos, warnings: horde.estimateWarnings };
    },
    awaitImage: async () => {
      horde.awaitCalls += 1;
      if (horde.awaitError !== null) throw horde.awaitError;
      return {
        done: true,
        faulted: false,
        isPossible: true,
        waiting: 0,
        processing: 0,
        finished: 1,
        waitTimeSeconds: 0,
        queuePosition: 0,
        kudos: horde.kudos,
        shared: horde.shared,
        generations: [
          {
            img: 'https://ejemplo/invalida.webp',
            seed: horde.seed,
            id: 'gen-1',
            model: horde.model,
            workerName: horde.workerName,
            workerId: horde.workerId,
            censored: false,
            metadata: [],
          },
        ],
      };
    },
    downloadImage: async () => {
      horde.downloadCalls += 1;
      return { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/webp' };
    },
  };
});

/**
 * el otro proveedor, contado por ramas.
 *
 * Es el unico que hace video, asi que solo aqui se puede ver si el `kind` de la
 * peticion sobrevive hasta el envio o se pierde por el camino.
 */
const xavira = vi.hoisted(() => ({
  imageCalls: 0,
  videoCalls: 0,
  /** si no es null, `generateImage` lanza esto */
  imageError: null as Error | null,
}));

vi.mock('@luxy/agent/dist/providers/xavira.js', () => ({
  XaviraError: class XaviraError extends Error {},
  awaitGeneration: async () => ({ outputUrl: 'https://ejemplo/salida.webm', costCredits: 3 }),
  createCharacter: async () => ({}),
  downloadOutput: async () => ({ bytes: new Uint8Array([7, 7, 7]), mimeType: 'video/webm' }),
  generateImage: async () => {
    xavira.imageCalls += 1;
    if (xavira.imageError !== null) throw xavira.imageError;
    return {};
  },
  generateVideo: async () => {
    xavira.videoCalls += 1;
    return {};
  },
}));

const { registerIpcHandlers } = await import('./handlers.js');
const { IPC_INVOKE, VAULT_HORDE_API_SECRET, VAULT_MEDIA_API_SECRET } =
  await import('../../shared/ipc.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV = '11111111-1111-4111-8111-111111111111';
const LIA = 'c0000000-3333-4333-8333-333333333333';

const RECETA = hordeRecipeSchema.parse({
  models: ['WAI-NSFW-illustrious-SDXL'],
  appearance: 'light brown hair, green eyes, freckles',
  outfit: 'white summer dress',
  negative: 'blurry',
  seed: null,
});

/** el plan que el handler tiene que componer: se calcula aqui para compararlo */
const PLAN = composeHordeImagePlan({
  recipe: RECETA,
  scene: 'sitting by the window',
  extraNegative: VAULT_IMAGE_NEGATIVE,
});

/** lo que hizo cada pieza durante la llamada */
interface Huella {
  attempts: ImageAttempt[];
  media: { mediaId: string; metadata: Omit<VaultMediaPayload, 'v' | 'createdAt'> }[];
  log: { message: string; fields: Record<string, unknown> }[];
}

interface Averia {
  /** el almacen de intentos revienta al dar de alta */
  alAlta?: boolean;
  /** el almacen de intentos revienta al cerrar el intento */
  alCambiar?: boolean;
}

function registrar(averia: Averia = {}): Huella {
  const huella: Huella = { attempts: [], media: [], log: [] };
  let contador = 0;

  const context = {
    vault: { isUnlocked: () => true, onLock: () => () => undefined },
    log: (message: string, fields?: Record<string, unknown>) => {
      huella.log.push({ message, fields: fields ?? {} });
    },
    getMainWindow: () => null,
    secretStore: {
      // las dos claves: el proveedor de pago es el unico que hace video, y sin
      // la suya la rama ni se alcanza
      get: (name: string) =>
        name === VAULT_HORDE_API_SECRET || name === VAULT_MEDIA_API_SECRET
          ? 'clave-de-prueba'
          : undefined,
      isEncryptionAvailable: () => false,
      listNames: () => [],
    },
    characters: {
      list: async () => [
        {
          characterId: LIA,
          imageProvider: 'horde',
          imageReview: 'nunca',
          xavira: null,
          horde: { recipe: RECETA },
          description: '',
          label: 'ella',
          avatarObjectKey: null,
          createdAt: new Date().toISOString(),
        },
      ],
    },
    privateMedia: {
      add: async (
        _vault: unknown,
        _conversationId: string,
        bytes: Uint8Array,
        metadata: Omit<VaultMediaPayload, 'v' | 'createdAt'>,
      ) => {
        contador += 1;
        const mediaId = `medio-${contador}`;
        huella.media.push({ mediaId, metadata });
        return { mediaId, byteSize: bytes.length, hasThumbnail: false };
      },
      // la lista tal y como la lee la pantalla: es por donde el enlace con el
      // intento llega al visor, y sin ella no se podria comprobar que llega
      list: async () =>
        huella.media.map((item) => ({ ...item, hasThumbnail: false })),
    },
    imageAttempts: {
      append: async (_vault: unknown, _conversationId: string, entry: ImageAttempt) => {
        if (averia.alAlta === true) throw new Error('el registro de intentos no abre');
        huella.attempts.push(entry);
        return entry;
      },
      update: async (
        _vault: unknown,
        _conversationId: string,
        attemptId: string,
        patch: Partial<ImageAttempt>,
      ) => {
        if (averia.alCambiar === true) throw new Error('el registro de intentos no abre');
        // el almacen de verdad lee el archivo, lo descifra y despues lo
        // reescribe: entre comprobar y escribir hay E/S, y por ese hueco caben
        // dos decisiones sobre el mismo pendiente. Sin este `await` el doble
        // seria atomico y ninguna prueba podria ver la carrera
        await Promise.resolve();
        const index = huella.attempts.findIndex((item) => item.attemptId === attemptId);
        if (index === -1) return undefined;
        const previo = huella.attempts[index] as ImageAttempt;
        const siguiente = { ...previo, ...patch };
        huella.attempts[index] = siguiente;
        return siguiente;
      },
      prune: async () => undefined,
      // copias, como las que devuelve el almacen de verdad al descifrar y
      // validar: quien lee no comparte objeto con quien escribe
      list: async () => huella.attempts.map((item) => ({ ...item })),
      // el ULTIMO que sigue esperando, igual que el almacen de verdad
      pending: async () =>
        [...huella.attempts].reverse().find((item) => item.state === 'pending'),
    },
    privateMemory: { invalidate: () => undefined },
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return huella;
}

async function generar(): Promise<{ ok: boolean; error?: string; hint?: string | null; value?: { mediaId: string } }> {
  const handler = canales.get(IPC_INVOKE.vaultMediaGenerate);
  if (handler === undefined) throw new Error('el canal de generacion no se registro');
  return (await handler(null, {
    conversationId: CONV,
    characterId: LIA,
    prompt: 'sitting by the window',
    kind: 'image',
  })) as { ok: boolean; error?: string; hint?: string | null; value?: { mediaId: string } };
}

beforeEach(() => {
  xavira.imageCalls = 0;
  xavira.videoCalls = 0;
  xavira.imageError = null;
  horde.lastRequest = null;
  horde.submitWarnings = [];
  horde.submitError = null;
  horde.lastEstimate = null;
  horde.estimateCalls = 0;
  horde.estimateKudos = 34;
  horde.estimateWarnings = [];
  horde.estimateError = null;
  horde.awaitCalls = 0;
  horde.awaitError = null;
  horde.downloadCalls = 0;
  horde.shared = null;
});

describe('el envio consume el plan y apunta el intento', () => {
  it('UNA SOLA ENTRADA AL TRANSPORTE: lo que sale es `plan.joined`, tal cual', async () => {
    // es la invariante que sostiene todo lo demas. Si esta asercion se borra,
    // nada impide que el camino compuesto y el corregido a mano se separen —un
    // prefijo aqui, un negativo alla— y el fallo no lo notaria ninguna prueba
    registrar();

    expect(await generar()).toMatchObject({ ok: true });
    expect(horde.lastRequest?.prompt).toBe(PLAN.joined);
    // y la identidad va DELANTE de la escena, que es de donde sale el parecido
    expect(horde.lastRequest?.prompt.startsWith(RECETA.appearance)).toBe(true);
    // el negativo detras del separador, que es como lo lee el horde
    expect(horde.lastRequest?.prompt).toContain(' ### ');
  });

  it('un envio correcto deja un intento OK con semilla, modelo, worker y kudos', async () => {
    const huella = registrar();

    const resultado = await generar();
    expect(resultado).toMatchObject({ ok: true });

    expect(huella.attempts).toHaveLength(1);
    const intento = huella.attempts[0] as ImageAttempt;
    expect(intento.state).toBe('ok');
    expect(intento.mediaId).toBe('medio-1');
    // la semilla REAL: con `params.seed` a null la sortea el servidor, asi que
    // esta es la unica forma de volver a sacar una imagen que salio bien
    expect(intento.seed).toBe('1080257389');
    expect(intento.model).toBe('WAI-NSFW-illustrious-SDXL');
    expect(intento.worker).toBe('una-gpu-cualquiera');
    expect(intento.workerId).toBe('w-9');
    // el servidor contesto, asi que un hueco aqui seria suyo y no del registro
    expect(intento.attribution).toBe('reported');
    expect(intento.kudos).toBe(12.5);
    expect(intento.planId).toBe(PLAN.planId);
    expect(intento.plan?.provider).toBe('horde');
  });

  it('SE APUNTA LO QUE EL SERVIDOR HIZO con la imagen, no lo que se le pidio', async () => {
    // el servidor contesta lo contrario de lo pedido. Es el caso que prueba la
    // procedencia: si el valor guardado saliera de la casilla, este seria false
    horde.shared = true;
    const huella = registrar();

    expect(await generar()).toMatchObject({ ok: true });

    const intento = huella.attempts[0] as ImageAttempt;
    const plan = intento.plan;
    if (plan === null || plan.provider !== 'horde') {
      throw new Error('el intento tendria que conservar su plan del horde');
    }
    // lo PEDIDO sigue donde estaba, y no se toca
    expect(horde.lastRequest?.shared).toBe(false);
    expect(plan.params.shared).toBe(false);
    // lo HECHO, con su propio nombre y traido del estado del trabajo
    expect(intento.sharedByServer).toBe(true);
  });

  it('si el servidor no dice si compartio, queda en null y no en un no', async () => {
    horde.shared = null;
    const huella = registrar();

    expect(await generar()).toMatchObject({ ok: true });

    // sin dato no se afirma nada: `false` seria decir que NO la compartio
    expect((huella.attempts[0] as ImageAttempt).sharedByServer).toBeNull();
  });

  it('el medio guardado lleva el `attemptId` de su intento', async () => {
    const huella = registrar();

    await generar();
    const guardado = huella.media[0];
    expect(guardado?.metadata.attemptId).toBe(huella.attempts[0]?.attemptId);
    // una REFERENCIA, no una copia: la semilla y el worker siguen viviendo solo
    // en el registro, que es tambien donde quedan los intentos sin medio
    expect(guardado?.metadata.prompt).toBe(PLAN.joined);
    expect(guardado?.metadata.width).toBe(PLAN.params.width);
  });

  it('y ese enlace LLEGA A LA PANTALLA en la lista de archivos', async () => {
    // sin esto el visor no puede enseñar la semilla que se uso de verdad: la
    // referencia se quedaria guardada en el sobre y el renderer no la veria
    const huella = registrar();
    await generar();

    const listar = canales.get(IPC_INVOKE.vaultMediaList);
    if (listar === undefined) throw new Error('el canal de la lista no se registro');
    const resultado = (await listar(null, { conversationId: CONV })) as {
      ok: boolean;
      value?: { media: { mediaId: string; attemptId: string | null; prompt: string | null }[] };
    };

    expect(resultado.ok).toBe(true);
    const primero = resultado.value?.media[0];
    expect(primero?.attemptId).toBe(huella.attempts[0]?.attemptId);
    // y el prompt sigue viajando entero, con el negativo detras del separador:
    // es la pantalla quien lo parte para enseñar las dos mitades
    expect(primero?.prompt).toBe(PLAN.joined);
  });

  it('LOS AVISOS DEL ENVIO ACABAN EN EL INTENTO, y hasta ahora se tiraban', async () => {
    horde.submitWarnings = [
      {
        code: 'AnonymousKeySharesImage',
        message: 'con la clave anonima AI Horde comparte la imagen con LAION',
      },
    ];
    const huella = registrar();

    await generar();
    expect(huella.attempts[0]?.warnings).toEqual([
      {
        code: 'AnonymousKeySharesImage',
        message: 'con la clave anonima AI Horde comparte la imagen con LAION',
      },
    ]);
  });

  it('UN RECHAZO GUARDA SU `rc`, que es lo que hoy se aplana al convertir el error', async () => {
    // 'csam' es el filtro de la red y no se reintenta; 'censored' es el filtro
    // propio del worker que te toco y con otro sale. Al construir el
    // `VaultError` los dos acaban siendo «no salio»
    const { HordeError } = (await import('@luxy/agent/dist/providers/horde.js')) as unknown as {
      HordeError: new (m: string, s: number | null, h: string | null, rc: string | null) => Error;
    };
    horde.submitError = new HordeError(
      'el worker que atendio la peticion censuro la imagen',
      null,
      'vuelve a intentarlo para que la coja otro',
      'censored',
    );
    const huella = registrar();

    const resultado = await generar();
    // el error que sale sigue siendo el de siempre, con su mismo mensaje y su
    // misma pista: el registro no cambia lo que ve el usuario
    expect(resultado.ok).toBe(false);
    expect(resultado.error).toBe('el worker que atendio la peticion censuro la imagen');
    expect(resultado.hint).toBe('vuelve a intentarlo para que la coja otro');

    const intento = huella.attempts[0] as ImageAttempt;
    expect(intento.state).toBe('failed');
    expect(intento.rc).toBe('censored');
    expect(intento.errorMessage).toBe('el worker que atendio la peticion censuro la imagen');
    // y el plan ENTERO, que es lo que de verdad se perdia: `request` era una
    // variable local que moria con la excepcion
    expect(intento.plan).toEqual(PLAN);
  });

  it('un fallo que no es del horde tambien se apunta, sin inventarse un `rc`', async () => {
    horde.submitError = new Error('se corto la red');
    const huella = registrar();

    expect(await generar()).toMatchObject({ ok: false });
    const intento = huella.attempts[0] as ImageAttempt;
    expect(intento.state).toBe('failed');
    expect(intento.rc).toBeNull();
  });

  it('UN BLOQUEO APUNTA EL WORKER, EL MODELO Y LA SEMILLA, que hoy se pierden', async () => {
    // el caso real: el panel enseño «Worker —, Modelo —, Semilla no llego a
    // saberse» y eso parecia decir que el rechazo habia sido sobre el TEXTO,
    // antes de encolar. No decia eso: el bloqueo llega con la imagen ya
    // generada y el dato venia dentro; lo que faltaba era apuntarlo
    const { HordeError } = (await import('@luxy/agent/dist/providers/horde.js')) as unknown as {
      HordeError: new (
        m: string,
        s: number | null,
        h: string | null,
        rc: string | null,
        attribution: {
          workerName: string | null;
          workerId: string | null;
          model: string | null;
          seed: string | null;
        } | null,
      ) => Error;
    };
    horde.submitError = new HordeError(
      'el filtro anti-CSAM de AI Horde bloqueo esta imagen',
      null,
      'no es un fallo tecnico y no se reintenta: cambia el prompt',
      'csam',
      {
        workerName: 'una-gpu-cualquiera',
        workerId: 'w-9',
        model: 'WAI-NSFW-illustrious-SDXL',
        seed: '1080257389',
      },
    );
    const huella = registrar();

    expect(await generar()).toMatchObject({ ok: false });
    const intento = huella.attempts[0] as ImageAttempt;
    expect(intento.state).toBe('failed');
    expect(intento.rc).toBe('csam');
    expect(intento.worker).toBe('una-gpu-cualquiera');
    expect(intento.workerId).toBe('w-9');
    expect(intento.model).toBe('WAI-NSFW-illustrious-SDXL');
    expect(intento.seed).toBe('1080257389');
    // y la marca que distingue este hueco del de un intento antiguo
    expect(intento.attribution).toBe('reported');
  });

  it('un fallo anterior a la generacion apunta «se miro y no habia», no un vacio', async () => {
    // la diferencia con el de arriba es justo la que decide donde mirar: aqui la
    // peticion no llego a manos de ningun worker
    horde.submitError = new Error('se corto la red');
    const huella = registrar();

    expect(await generar()).toMatchObject({ ok: false });
    const intento = huella.attempts[0] as ImageAttempt;
    expect(intento.attribution).toBe('absent');
    expect(intento.worker).toBeNull();
    expect(intento.model).toBeNull();
    expect(intento.seed).toBeNull();
    expect(intento.workerId).toBeNull();
  });

  it('UNA ESPERA QUE VENCE NO PUEDE DECIR «no lo hubo»: la peticion ya estaba encolada', async () => {
    // la peticion salio y el sondeo pudo ver `processing` por encima de cero, o
    // sea un worker dibujando. Que al final no llegara nada no permite afirmar
    // que no hubo generacion, y `absent` es exactamente esa afirmacion: fue la
    // que llevo a diagnosticar mal un bloqueo leyendo «no hubo worker» donde lo
    // que pasaba era que no se apunto
    horde.awaitError = new Error('la imagen no estuvo lista a tiempo');
    const huella = registrar();

    expect(await generar()).toMatchObject({ ok: false });
    const intento = huella.attempts[0] as ImageAttempt;
    expect(intento.state).toBe('failed');
    expect(intento.attribution).toBeNull();
    expect(intento.worker).toBeNull();
    expect(intento.seed).toBeNull();
  });

  it('SI EL REGISTRO REVIENTA AL DAR DE ALTA, la generacion sale igual', async () => {
    // apuntar es contabilidad, no permiso: un archivo de disco no decide si se
    // genera
    const huella = registrar({ alAlta: true });

    expect(await generar()).toMatchObject({ ok: true, value: { mediaId: 'medio-1' } });
    expect(huella.attempts).toHaveLength(0);
    // y el medio se guarda con su enlace, aunque al otro lado no haya nadie
    expect(huella.media[0]?.metadata.attemptId).toBeTypeOf('string');
  });

  it('SI EL REGISTRO REVIENTA AL CERRAR, el error que sale es el del PROVEEDOR', async () => {
    // lo contrario seria lo peor que puede pasar aqui: sustituir «te lo
    // censuraron» por «no se pudo escribir un archivo» justo cuando el usuario
    // intenta entender por que no le llego la imagen
    const { HordeError } = (await import('@luxy/agent/dist/providers/horde.js')) as unknown as {
      HordeError: new (m: string, s: number | null, h: string | null, rc: string | null) => Error;
    };
    horde.submitError = new HordeError('el filtro anti-CSAM bloqueo esta imagen', null, null, 'csam');
    registrar({ alCambiar: true });

    const resultado = await generar();
    expect(resultado.ok).toBe(false);
    expect(resultado.error).toBe('el filtro anti-CSAM bloqueo esta imagen');
  });

  it('el registro tecnico no lleva ni una palabra del prompt', async () => {
    const huella = registrar();

    await generar();
    const escrito = JSON.stringify(huella.log);
    expect(escrito).not.toContain('freckles');
    expect(escrito).not.toContain('sitting by the window');
    // lo que si lleva son las dos huellas con las que encontrarlo en el
    // registro cifrado, mas contadores
    const generado = huella.log.find((line) => line.message === 'medio privado generado');
    expect(generado?.fields.planId).toBe(PLAN.planId);
    expect(generado?.fields.attemptId).toBe(huella.attempts[0]?.attemptId);
  });
});

// -----------------------------------------------------------------------------
// la decision sobre un pendiente
// -----------------------------------------------------------------------------

const PENDIENTE = '22222222-2222-4222-8222-222222222222';

/** deja en el registro un intento como el que apunta el turno con revision */
function sembrar(
  huella: Huella,
  state: VaultImageAttemptState = 'pending',
  plan: VaultImagePlan = PLAN,
  kind: 'image' | 'video' = 'image',
): ImageAttempt {
  const entry = imageAttemptSchema.parse({
    attemptId: PENDIENTE,
    conversationId: CONV,
    characterId: LIA,
    createdAt: new Date().toISOString(),
    state,
    source: 'compuesto',
    plan,
    planId: plan.planId,
    kind,
  });
  huella.attempts.push(entry);
  return entry;
}

interface Respuesta {
  ok: boolean;
  error?: string;
  hint?: string | null;
  value?: Record<string, unknown>;
}

async function invocar(channel: string, args: unknown): Promise<Respuesta> {
  const handler = canales.get(channel);
  if (handler === undefined) throw new Error(`el canal ${channel} no se registro`);
  return (await handler(null, args)) as Respuesta;
}

describe('los verbos de la decision', () => {
  it('el pendiente se puede volver a pedir: cerrar Studio no es decir que no', async () => {
    const huella = registrar();
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImagePending, { conversationId: CONV });
    expect(resultado.ok).toBe(true);
    expect((resultado.value?.attempt as ImageAttempt | null)?.attemptId).toBe(PENDIENTE);
  });

  it('sin nada esperando devuelve null, que no es un error', async () => {
    registrar();

    const resultado = await invocar(IPC_INVOKE.vaultImagePending, { conversationId: CONV });
    expect(resultado).toMatchObject({ ok: true, value: { attempt: null } });
  });

  it('el registro se puede leer entero, para mirar un fallo despues', async () => {
    const huella = registrar();
    sembrar(huella, 'failed');

    const resultado = await invocar(IPC_INVOKE.vaultImageAttempts, { conversationId: CONV });
    expect((resultado.value?.attempts as ImageAttempt[]).map((item) => item.state)).toEqual([
      'failed',
    ]);
  });

  it('generar sin correccion manda el texto compuesto, tal cual', async () => {
    const huella = registrar();
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado).toMatchObject({ ok: true, value: { state: 'ok', mediaId: 'medio-1' } });
    expect(horde.lastRequest?.prompt).toBe(PLAN.joined);
    // el mismo intento, cerrado: no se apunta uno nuevo al decidir
    expect(huella.attempts).toHaveLength(1);
    expect(huella.attempts[0]?.state).toBe('ok');
    expect(huella.attempts[0]?.source).toBe('compuesto');
  });

  it('GENERAR CON CORRECCION MANDA LO ESCRITO, sin apariencia delante ni recorte', async () => {
    // es el motivo entero de la funcion: «pedi un encuadre y no llego». Lo
    // escrito a mano se manda tal cual, sin volver a pasar por la receta ni por
    // `stripConflictingTraits`
    const huella = registrar();
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: { provider: 'horde', positive: 'from behind, dark hair', negative: 'blurry' },
    });

    expect(resultado.ok).toBe(true);
    expect(horde.lastRequest?.prompt).toBe('from behind, dark hair ### blurry');
    // la apariencia de la receta YA NO va delante: lo escrito sustituye al
    // positivo entero, que es lo que se estaba enseñando en el panel
    expect(horde.lastRequest?.prompt).not.toContain('freckles');
    // y el color que el recorte automatico habria quitado sobrevive: lo puso
    // una persona a proposito
    expect(horde.lastRequest?.prompt).toContain('dark hair');

    const intento = huella.attempts[0] as ImageAttempt;
    // `editado` es lo que dentro de un mes explica una imagen que no se parece
    expect(intento.source).toBe('editado');
    expect(intento.planId).not.toBe(PLAN.planId);
    expect(intento.plan?.provider === 'horde' && intento.plan.positive).toBe(
      'from behind, dark hair',
    );
  });

  it('UN PENDIENTE QUE YA NO VALE NO LLAMA AL PROVEEDOR, y dice por que', async () => {
    const huella = registrar();
    sembrar(huella, 'superseded');

    const resultado = await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain('dejo de valer');
    expect(resultado.hint).toContain('pidesela otra vez');
    expect(horde.lastRequest).toBeNull();
    // y el estado no se toca: sigue siendo lo que era
    expect(huella.attempts[0]?.state).toBe('superseded');
  });

  it('uno ya mandado tampoco se puede volver a pulsar', async () => {
    // el mismo pendiente pagado dos veces es el fallo que este guardia impide
    const huella = registrar();
    sembrar(huella, 'ok');

    const resultado = await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain('ya se genero');
    expect(horde.lastRequest).toBeNull();
    expect(huella.attempts[0]?.state).toBe('ok');
  });

  it('un intento que ya no esta en el registro no genera nada', async () => {
    registrar();

    const resultado = await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain('ya no esta en el registro');
    expect(horde.lastRequest).toBeNull();
  });

  it('DESCARTAR NO LLAMA A NADIE y no cuesta nada', async () => {
    const huella = registrar();
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'discard',
      conversationId: CONV,
      attemptId: PENDIENTE,
    });

    expect(resultado).toMatchObject({
      ok: true,
      value: { state: 'discarded', mediaId: null, costCredits: null },
    });
    expect(horde.lastRequest).toBeNull();
    expect(horde.awaitCalls).toBe(0);
    expect(horde.downloadCalls).toBe(0);
    expect(huella.attempts[0]?.state).toBe('discarded');
  });

  it('si el registro no se deja marcar, NO se genera', async () => {
    // lo contrario dejaria el pendiente pendiente despues de haber gastado, y
    // el siguiente botonazo lo pagaria otra vez
    const huella = registrar({ alCambiar: true });
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toBe('no se ha podido apuntar la decision sobre esa imagen');
    expect(horde.lastRequest).toBeNull();
  });

  it('una correccion del otro proveedor se rechaza en vez de mandarse a medias', async () => {
    const huella = registrar();
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: { provider: 'xavira', prompt: 'lo que sea' },
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain('no es del mismo proveedor');
    expect(horde.lastRequest).toBeNull();
  });

  it('LO QUE SE APRUEBA ES LO QUE SE PIDIO: un video se genera como video', async () => {
    // el intento es lo UNICO que queda entre componer el plan y aprobarlo. Con
    // el `kind` fijado a 'image' en la decision, una peticion de video acababa
    // en la rama de foto fija: se cobraba igual y salia otra cosa. Y encima solo
    // con la revision puesta, que es el valor por defecto: el mismo personaje
    // con la revision quitada si generaba el video
    const huella = registrar();
    sembrar(huella, 'pending', PLAN_XAVIRA, 'video');

    const resultado = await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado).toMatchObject({ ok: true, value: { state: 'ok' } });
    expect(xavira.videoCalls).toBe(1);
    expect(xavira.imageCalls).toBe(0);
  });

  it('y una foto sigue siendo una foto', async () => {
    const huella = registrar();
    sembrar(huella, 'pending', PLAN_XAVIRA);

    await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(xavira.imageCalls).toBe(1);
    expect(xavira.videoCalls).toBe(0);
  });

  it('UNA IMAGEN QUE EXISTE NO DICE «no lo hubo» del modelo que la dibujo', async () => {
    // el caso real: se genera con el proveedor de pago, sale bien, se abre el
    // intento y la pantalla decia «Semilla: no lo hubo / Worker: no lo hubo /
    // Modelo: no lo hubo» sobre una imagen que esta ahi. Este proveedor genera
    // con algun modelo y alguna semilla; lo que no hace es publicarlos, asi que
    // el silencio es suyo —«no lo dijo»— y no un hueco del registro
    const huella = registrar();
    sembrar(huella, 'pending', PLAN_XAVIRA);

    expect(await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    })).toMatchObject({ ok: true });

    const intento = huella.attempts[0] as ImageAttempt;
    expect(intento.state).toBe('ok');
    expect(intento.attribution).toBe('reported');
    expect(intento.seed).toBeNull();
    expect(intento.model).toBeNull();
    expect(intento.worker).toBeNull();
  });

  // un rechazo ANTES de generar no es «no lo dijo»: no hay ninguna generacion
  // de cuyo rastro callarse. Es el caso de quedarse sin creditos o de una clave
  // invalida, y decir `reported` ahi afirma que el proveedor dibujo la imagen
  it('pero un rechazo antes de empezar dice «no lo hubo», no «no lo dijo»', async () => {
    xavira.imageError = new Error('el proveedor no acepto la peticion');
    const huella = registrar();
    sembrar(huella, 'pending', PLAN_XAVIRA);

    expect(await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    })).toMatchObject({ ok: false });

    const intento = huella.attempts[0] as ImageAttempt;
    expect(intento.state).toBe('failed');
    expect(intento.attribution).toBe('absent');
  });

  it('DOS PULSACIONES SEGUIDAS GENERAN UNA SOLA VEZ', async () => {
    // comprobar-y-escribir con E/S en medio: `loadPendingAttempt` lee y
    // comprueba que sigue 'pending', y solo despues se escribe 'sent'. Con el
    // foco en el boton, el autorepeat del teclado dispara el segundo click
    // antes de que React repinte y lo apague; los dos leen 'pending', los dos
    // generan, y son dos trabajos encolados y los kudos cobrados dos veces por
    // una sola aprobacion
    const huella = registrar();
    sembrar(huella);

    const args = {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    };
    const [primera, segunda] = await Promise.all([
      invocar(IPC_INVOKE.vaultImageCommit, args),
      invocar(IPC_INVOKE.vaultImageCommit, args),
    ]);

    expect([primera?.ok, segunda?.ok].filter((ok) => ok === true)).toHaveLength(1);
    // donde de verdad se ve el cobro doble: una espera en la cola y un medio
    expect(horde.awaitCalls).toBe(1);
    expect(huella.media).toHaveLength(1);
    expect(huella.attempts.filter((item) => item.state === 'ok')).toHaveLength(1);
    // y la segunda dice por que, en vez de dejar al usuario sin saberlo
    const rechazada = [primera, segunda].find((respuesta) => respuesta?.ok === false);
    expect(rechazada?.error).toBeTypeOf('string');
  });

  it('decidir no escribe ni una palabra del texto en el registro tecnico', async () => {
    const huella = registrar();
    sembrar(huella);

    await invocar(IPC_INVOKE.vaultImageCommit, {
      action: 'generate',
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: { provider: 'horde', positive: 'from behind, dark hair', negative: 'blurry' },
    });

    const escrito = JSON.stringify(huella.log);
    expect(escrito).not.toContain('from behind');
    expect(escrito).not.toContain('freckles');
    const aprobado = huella.log.find((line) => line.message === 'plan de imagen aprobado');
    expect(aprobado?.fields.origen).toBe('editado');
  });
});

// -----------------------------------------------------------------------------
// el coste, preguntado en seco
// -----------------------------------------------------------------------------

/** el mismo intento pendiente, pero del proveedor que no sabe decir el precio */
const PLAN_XAVIRA = composeXaviraImagePlan({
  scene: 'sitting by the window',
  extraNegative: VAULT_IMAGE_NEGATIVE,
});

describe('preguntar el coste no encola nada', () => {
  it('EL DRY RUN NO GENERA: ni espera, ni descarga, ni encola', async () => {
    // es la unica razon por la que este verbo puede existir separado del de
    // generar. Si un dia encola de verdad, el boton de «comprobar coste» pasa a
    // cobrar sin avisar
    const huella = registrar();
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImageEstimate, {
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado).toMatchObject({ ok: true, value: { kudos: 34 } });
    expect(horde.lastEstimate?.dryRun).toBe(true);
    // el texto por el que se pregunta es el que se mandaria, tal cual
    expect(horde.lastEstimate?.prompt).toBe(PLAN.joined);
    // y por el otro camino no paso nadie
    expect(horde.lastRequest).toBeNull();
    expect(horde.awaitCalls).toBe(0);
    expect(horde.downloadCalls).toBe(0);
  });

  it('PREGUNTAR NO ES DECIDIR: el intento sigue esperando', async () => {
    // lo contrario seria lo peor: pulsar «comprobar coste» y quedarse sin poder
    // generar, o peor, que el registro dijera que se mando algo que no salio
    const huella = registrar();
    sembrar(huella);

    await invocar(IPC_INVOKE.vaultImageEstimate, {
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(huella.attempts).toHaveLength(1);
    expect(huella.attempts[0]?.state).toBe('pending');
    expect(huella.attempts[0]?.source).toBe('compuesto');
  });

  it('se pregunta por el texto CORREGIDO, no por el compuesto', async () => {
    // el precio de un texto que no se va a mandar no sirve de nada: lo que se
    // estima tiene que ser lo mismo que despues sale
    const huella = registrar();
    sembrar(huella);

    await invocar(IPC_INVOKE.vaultImageEstimate, {
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: { provider: 'horde', positive: 'from behind, dark hair', negative: 'blurry' },
    });

    expect(horde.lastEstimate?.prompt).toBe('from behind, dark hair ### blurry');
    // y la correccion no se guarda: solo se ha preguntado
    expect(huella.attempts[0]?.planId).toBe(PLAN.planId);
  });

  it('LOS AVISOS DEL DRY RUN LLEGAN: es lo unico que adelanta de verdad', async () => {
    horde.estimateWarnings = [
      { code: 'NoAvailableWorker', message: 'ningun worker sirve ese modelo ahora mismo' },
    ];
    const huella = registrar();
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImageEstimate, {
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado.value?.warnings).toEqual([
      { code: 'NoAvailableWorker', message: 'ningun worker sirve ese modelo ahora mismo' },
    ]);
  });

  it('sin precio en la respuesta devuelve null, y no un cero inventado', async () => {
    horde.estimateKudos = null;
    const huella = registrar();
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImageEstimate, {
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado).toMatchObject({ ok: true, value: { kudos: null } });
  });

  it('EL PROVEEDOR DE PAGO NO SE INVENTA UN NUMERO: dice que no puede', async () => {
    const huella = registrar();
    sembrar(huella, 'pending', PLAN_XAVIRA);

    const resultado = await invocar(IPC_INVOKE.vaultImageEstimate, {
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain('no dice lo que cuesta antes de generar');
    expect(horde.estimateCalls).toBe(0);
  });

  it('un pendiente que dejo de valer tampoco se puede preguntar', async () => {
    const huella = registrar();
    sembrar(huella, 'superseded');

    const resultado = await invocar(IPC_INVOKE.vaultImageEstimate, {
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain('dejo de valer');
    expect(horde.estimateCalls).toBe(0);
  });

  it('un rechazo del dry run conserva el motivo, que es para lo que sirve', async () => {
    // «ese modelo no existe» dicho ANTES de encolar es justo lo que este verbo
    // puede adelantar; taparlo con un «no se pudo preguntar» lo haria inutil
    const { HordeError } = (await import('@luxy/agent/dist/providers/horde.js')) as unknown as {
      HordeError: new (m: string, s: number | null, h: string | null, rc: string | null) => Error;
    };
    horde.estimateError = new HordeError(
      'AI Horde no reconoce uno de los modelos pedidos',
      400,
      'comprueba la lista de modelos de la receta',
      null,
    );
    const huella = registrar();
    sembrar(huella);

    const resultado = await invocar(IPC_INVOKE.vaultImageEstimate, {
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: null,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toBe('AI Horde no reconoce uno de los modelos pedidos');
    expect(resultado.hint).toBe('comprueba la lista de modelos de la receta');
    // y el intento sigue esperando: un precio que no se pudo preguntar no es
    // una decision
    expect(huella.attempts[0]?.state).toBe('pending');
  });

  it('preguntar el precio no escribe ni una palabra del texto en el registro tecnico', async () => {
    const huella = registrar();
    sembrar(huella);

    await invocar(IPC_INVOKE.vaultImageEstimate, {
      conversationId: CONV,
      attemptId: PENDIENTE,
      edit: { provider: 'horde', positive: 'from behind, dark hair', negative: 'blurry' },
    });

    const escrito = JSON.stringify(huella.log);
    expect(escrito).not.toContain('from behind');
    expect(escrito).not.toContain('freckles');
    const preguntado = huella.log.find(
      (line) => line.message === 'coste de imagen preguntado en seco',
    );
    expect(preguntado?.fields.kudos).toBe(34);
    expect(preguntado?.fields.attemptId).toBe(PENDIENTE);
  });
});
