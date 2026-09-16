// el turno privado cuando ella pide una imagen.
//
// Lo que solo puede romperse AQUI es el reparto: con la revision puesta el turno
// TERMINA sin generar —la respuesta de texto llega entera, el mensaje del
// usuario se conserva y la peticion queda esperando—, y con la revision quitada
// pasa exactamente lo de siempre. Y las dos averias de estado que esto puede
// causar: que el turno siguiente crea que la foto salio, y que un bloque cortado
// se lea igual que un turno sin imagen.
//
// Ni red, ni tokens: el proveedor de imagenes esta simulado aqui dentro y en el
// camino de revision no se le llama ni una vez, que es justo lo que se mide.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  composeHordeImagePlan,
  hordeRecipeSchema,
  VAULT_IMAGE_NEGATIVE,
  type ImageAttempt,
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

/** lo que el proveedor simulado ha hecho: aqui lo que importa es CUANTAS veces */
const horde = vi.hoisted(() => ({
  submitCalls: 0,
  lastPrompt: null as string | null,
  /** cuando no es `null`, el envio revienta con ese mensaje y ese motivo */
  fail: null as { message: string; rc: string | null } | null,
}));

vi.mock('@luxy/agent/dist/providers/horde.js', () => {
  class HordeError extends Error {
    constructor(
      message: string,
      readonly status: number | null = null,
      readonly hint: string | null = null,
      readonly rc: string | null = null,
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
    submitImage: async (request: { prompt: string }) => {
      horde.submitCalls += 1;
      horde.lastPrompt = request.prompt;
      if (horde.fail !== null) {
        throw new HordeError(horde.fail.message, 400, 'prueba con otro modelo', horde.fail.rc);
      }
      return { id: 'trabajo-1', kudos: 1, warnings: [] };
    },
    // handlers.ts lo importa para el verbo del coste en seco; aqui no se usa,
    // pero un import que el mock no declara revienta al cargar el modulo
    estimateKudos: async () => ({ kudos: null, warnings: [] }),
    awaitImage: async () => ({
      done: true,
      faulted: false,
      isPossible: true,
      waiting: 0,
      processing: 0,
      finished: 1,
      waitTimeSeconds: 0,
      queuePosition: 0,
      kudos: 8,
      generations: [
        {
          img: 'https://ejemplo/invalida.webp',
          seed: '1080257389',
          id: 'gen-1',
          model: 'WAI-NSFW-illustrious-SDXL',
          workerName: 'una-gpu-cualquiera',
          censored: false,
          metadata: [],
        },
      ],
    }),
    downloadImage: async () => ({ bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/webp' }),
  };
});

// el otro proveedor no se toca aqui, pero handlers.ts lo importa al cargarse
vi.mock('@luxy/agent/dist/providers/xavira.js', () => ({
  XaviraError: class XaviraError extends Error {},
  awaitGeneration: async () => ({ outputUrl: null, costCredits: null }),
  createCharacter: async () => ({}),
  downloadOutput: async () => ({ bytes: new Uint8Array(), mimeType: 'image/webp' }),
  generateImage: async () => ({}),
  generateVideo: async () => ({}),
}));

const { registerIpcHandlers } = await import('./handlers.js');
const { IPC_INVOKE, VAULT_HORDE_API_SECRET } = await import('../../shared/ipc.js');
const { tokenize } = await import('../vault/turn-index.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV = '11111111-1111-4111-8111-111111111111';
const LIA = 'c0000000-3333-4333-8333-333333333333';

/** una palabra que solo puede venir de la receta: sirve de testigo en los logs */
const RECETA = hordeRecipeSchema.parse({
  models: ['WAI-NSFW-illustrious-SDXL'],
  appearance: 'light brown hair, green eyes, PECAS_TESTIGO',
  outfit: 'white summer dress',
  negative: 'blurry',
  seed: null,
});

const ESCENA = 'sitting by the window, ESCENA_TESTIGO';
const PLAN = composeHordeImagePlan({
  recipe: RECETA,
  scene: ESCENA,
  extraNegative: VAULT_IMAGE_NEGATIVE,
});

const ABRE = '<LUXY_IMAGEN>';
const CIERRA = '</LUXY_IMAGEN>';
/** lo que escribe el modelo cuando pide generar, tal y como se le enseña */
const CON_BLOQUE = `*se muerde el labio* toma, mirame\n\n${ABRE}{"prompt":"${ESCENA}","kind":"image"}${CIERRA}`;
/** la respuesta se corto DENTRO del bloque: empezo y no cerro */
const CORTADO = `*se muerde el labio* toma, mirame\n\n${ABRE}{"prompt":"${ESCENA}"`;
/** el bloque esta entero y lo de dentro no es un JSON valido */
const MAL_ESCRITO = `*se muerde el labio* toma, mirame\n\n${ABRE}{prompt: sin comillas}${CIERRA}`;
/**
 * el mismo bloque, pero con un pie de foto que NO nombra ninguna imagen.
 *
 * Hace falta para medir el dato cierto «en tu turno anterior te mando una»: con
 * «toma, mirame» la puerta del turno siguiente se abriria igual por el lexico
 * —«mirame» esta en `OFFER_TOPIC`— y la prueba pasaria con el estado roto. Que
 * el pie de foto no nombre nada es ademas lo normal, y es la razon entera de que
 * ese dato exista.
 */
const SIN_NOMBRARLA = `*se sienta en el sofa* listo\n\n${ABRE}{"prompt":"${ESCENA}","kind":"image"}${CIERRA}`;

interface TurnoFalso {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

interface Huella {
  prompts: string[];
  turnos: TurnoFalso[];
  intentos: ImageAttempt[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  campos: (mensaje: string) => Record<string, unknown> | undefined;
  /** todos los apuntes con ese mensaje, en orden: hay turnos que registran varios */
  todos: (mensaje: string) => Record<string, unknown>[];
}

interface Montaje {
  /** el interruptor del personaje */
  review?: 'siempre' | 'nunca';
  /** lo que contesta el modelo, un turno por elemento; el ultimo se repite */
  respuestas?: string[];
  /** el registro de intentos no abre */
  registroRoto?: boolean;
}

function montar(montaje: Montaje = {}): Huella {
  const huella: Huella = {
    prompts: [],
    turnos: [],
    intentos: [],
    registros: [],
    campos: (mensaje) => huella.registros.find((r) => r.mensaje === mensaje)?.campos,
    todos: (mensaje) =>
      huella.registros.filter((r) => r.mensaje === mensaje).map((r) => r.campos ?? {}),
  };

  const respuestas = montaje.respuestas ?? [CON_BLOQUE];
  let turnosPedidos = 0;
  let medios = 0;

  const context = {
    vault: { isUnlocked: () => true, onLock: () => () => undefined },
    privateConversations: {
      list: async () => [
        { conversationId: CONV, title: '', turns: huella.turnos.length, updatedAt: '' },
      ],
      read: async () => [...huella.turnos],
      appendTurn: async (
        _vault: unknown,
        conversationId: string,
        turno: { role: 'user' | 'assistant'; text: string },
      ) => {
        huella.turnos.push({
          conversationId,
          sequence: huella.turnos.length,
          role: turno.role,
          text: turno.text,
          createdAt: new Date().toISOString(),
        });
      },
      removeLastTurn: () => huella.turnos.pop(),
      latestMemory: async () => null,
      latestInstructions: async () => null,
      latestCharacterId: async () => LIA,
      latestCharacterDescription: async () => 'Lia, veinticuatro años',
    },
    characters: {
      list: async () => [
        {
          characterId: LIA,
          label: 'Lia',
          description: '',
          imageProvider: 'horde',
          imageReview: montaje.review ?? 'siempre',
          xavira: null,
          horde: { recipe: RECETA },
          avatarObjectKey: null,
          createdAt: new Date().toISOString(),
        },
      ],
    },
    privateMedia: {
      list: async () => [],
      add: async () => {
        medios += 1;
        return { mediaId: `medio-${medios}`, byteSize: 4, hasThumbnail: false };
      },
    },
    secretStore: {
      get: (name: string) => (name === VAULT_HORDE_API_SECRET ? 'clave-de-prueba' : undefined),
      isEncryptionAvailable: () => false,
      listNames: () => [],
    },
    imageAttempts: {
      pending: async () => {
        if (montaje.registroRoto === true) throw new Error('el registro no abre');
        return [...huella.intentos].reverse().find((item) => item.state === 'pending');
      },
      append: async (_vault: unknown, _conversationId: string, entry: ImageAttempt) => {
        if (montaje.registroRoto === true) throw new Error('el registro no abre');
        huella.intentos.push(entry);
        return entry;
      },
      update: async (
        _vault: unknown,
        _conversationId: string,
        attemptId: string,
        patch: Partial<ImageAttempt>,
      ) => {
        const index = huella.intentos.findIndex((item) => item.attemptId === attemptId);
        if (index === -1) return undefined;
        const siguiente = { ...(huella.intentos[index] as ImageAttempt), ...patch };
        huella.intentos[index] = siguiente;
        return siguiente;
      },
      // la lista entera: es por donde `vaultImageCommit` carga el pendiente
      // sobre el que se decide
      list: async () => [...huella.intentos],
      prune: async () => undefined,
    },
    recaps: { entryFor: async () => null },
    relations: {
      read: async () => ({
        notes: [],
        cursors: [],
        counters: {},
        droppedOnRead: 0,
        unreadable: { notes: [], cursors: [] },
      }),
      apply: async () => undefined,
    },
    privateMemory: {
      invalidate: () => undefined,
      search: async () => [],
      listEpisodes: async () => [],
      readEpisode: async () => [],
      timeline: async () =>
        huella.turnos.map((turno) => ({
          conversationId: turno.conversationId,
          sequence: turno.sequence,
          role: turno.role,
          createdAt: turno.createdAt,
          stems: new Set(tokenize(turno.text)),
        })),
      conversationsFor: () => new Set([CONV]),
      turnAt: (conversationId: string, sequence: number) =>
        huella.turnos.find(
          (turno) => turno.conversationId === conversationId && turno.sequence === sequence,
        ) ?? null,
    },
    memoryPreferences: {
      auxiliary: () => null,
      // el trabajo de fondo no es lo que se mide aqui
      excluded: () => new Set([CONV]),
    },
    getMainWindow: () => null,
    controller: {
      runLocalTurn: async (request: { prompt: string }) => {
        huella.prompts.push(request.prompt);
        const texto = respuestas[Math.min(turnosPedidos, respuestas.length - 1)] ?? '';
        turnosPedidos += 1;
        return {
          outcome: 'completed',
          text: texto,
          executedModel: 'deepseek-chat',
          inputTokens: 10,
          outputTokens: 20,
          durationMs: 1234,
          error: null,
        };
      },
    },
    log: (mensaje: string, campos?: Record<string, unknown>) => {
      huella.registros.push({ mensaje, campos });
    },
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return huella;
}

interface Imagen {
  mediaId: string | null;
  error: string | null;
  state: string;
  attemptId: string | null;
  plan: { provider: string; joined?: string } | null;
}

type Respuesta = {
  ok: boolean;
  value?: { userTurnKept: boolean; turns: TurnoFalso[]; image: Imagen | null };
};

async function enviar(mensaje: string): Promise<Respuesta> {
  const handler = canales.get(IPC_INVOKE.vaultConversationSend);
  if (handler === undefined) throw new Error('el canal de envio no se registro');
  return (await handler(null, {
    conversationId: CONV,
    message: mensaje,
    provider: 'deepseek',
    model: 'deepseek-chat',
    projectAlias: 'luxy',
  })) as Respuesta;
}

/** aprueba el pendiente que dejo el turno, que es como llega de verdad la foto */
async function aprobar(attemptId: string | null | undefined): Promise<void> {
  const handler = canales.get(IPC_INVOKE.vaultImageCommit);
  if (handler === undefined) throw new Error('el canal de la decision no se registro');
  if (typeof attemptId !== 'string') throw new Error('el turno no dejo ningun pendiente');
  const respuesta = (await handler(null, {
    action: 'generate',
    conversationId: CONV,
    attemptId,
    edit: null,
  })) as { ok: boolean; error?: string };
  if (!respuesta.ok) throw new Error(`la aprobacion fallo: ${respuesta.error ?? ''}`);
}

beforeEach(() => {
  horde.submitCalls = 0;
  horde.lastPrompt = null;
  horde.fail = null;
});

describe('el turno termina sin generar y deja el plan pendiente', () => {
  it('con la revision puesta NO se llama al proveedor ni una vez', async () => {
    const huella = montar({ review: 'siempre' });

    const respuesta = await enviar('mandame una foto tuya');
    expect(respuesta.ok).toBe(true);

    const imagen = respuesta.value?.image;
    expect(imagen?.state).toBe('pending');
    expect(imagen?.mediaId).toBeNull();
    // no ha pasado nada malo: todavia no ha pasado nada. Un error aqui lo
    // pintaria en rojo y diria que fallo algo
    expect(imagen?.error).toBeNull();
    expect(imagen?.attemptId).toBeTypeOf('string');
    expect(imagen?.plan?.provider).toBe('horde');
    // y el texto que se enseña es el MISMO que saldria: si se recompusiera al
    // mandarlo, el panel estaria enseñando otra cosa
    expect(imagen?.plan?.joined).toBe(PLAN.joined);

    expect(horde.submitCalls).toBe(0);
    expect(huella.intentos).toHaveLength(1);
    expect(huella.intentos[0]?.state).toBe('pending');
    expect(huella.intentos[0]?.planId).toBe(PLAN.planId);
  });

  it('el turno se guarda igual: el texto entero y el mensaje del usuario conservado', async () => {
    const huella = montar({ review: 'siempre' });

    const respuesta = await enviar('mandame una foto tuya');
    expect(respuesta.value?.userTurnKept).toBe(true);
    // los dos turnos de siempre, en su sitio de siempre
    expect(huella.turnos).toHaveLength(2);
    expect(huella.turnos[0]?.role).toBe('user');
    expect(huella.turnos[1]?.role).toBe('assistant');
    // y lo que se guarda es el texto visible, sin el bloque tecnico
    expect(huella.turnos[1]?.text).toBe('*se muerde el labio* toma, mirame');
    expect(huella.turnos[1]?.text).not.toContain(ABRE);
  });

  it('un pendiente NO cuenta como imagen mandada en el turno siguiente', async () => {
    // si contara, la puerta del tercer turno se abriria sola —«ya te mande una,
    // el tema esta abierto»— por una foto que el usuario no ha visto nunca
    const huella = montar({
      review: 'siempre',
      respuestas: [CON_BLOQUE, '*se rie* vale', '*se estira* aqui sigo'],
    });

    await enviar('mandame una foto tuya');
    await enviar('vale');
    await enviar('vale');

    const puertas = huella.todos('turno privado');
    expect(puertas).toHaveLength(3);
    // los dos primeros abren —uno porque el mensaje lo pide, otro porque el
    // anterior hablaba de fotos—, y sin ellos el tercero no probaria nada: tres
    // puertas cerradas pasarian esta prueba con el estado roto
    expect(puertas[0]?.puedeGenerar).toBe(true);
    expect(puertas[1]?.puedeGenerar).toBe(true);
    // el tercero ya no tiene motivo ninguno, y lo tendria si el pendiente
    // contara como imagen mandada
    expect(puertas[2]?.puedeGenerar).toBe(false);
    expect(huella.todos('prompt privado compuesto')[2]?.imagenPuertaMotivo).toBe('sin-motivo');
  });

  it('UN MENSAJE NUEVO SUSTITUYE al pendiente y el prompt siguiente lo dice', async () => {
    // sin esta linea el turno siguiente se construye sobre una mentira: ella ya
    // dijo «toma, mirame» y el usuario no ha visto nada
    const huella = montar({ review: 'siempre', respuestas: [CON_BLOQUE, '*se rie* vale'] });

    await enviar('mandame una foto tuya');
    await enviar('¿y esa foto?');

    expect(huella.intentos[0]?.state).toBe('superseded');
    const segundo = huella.prompts[1] ?? '';
    expect(segundo).toContain('la imagen que ofreciste en tu turno anterior NO ha salido');
    expect(huella.campos('la imagen pendiente la sustituye un mensaje nuevo')).toMatchObject({
      attemptId: huella.intentos[0]?.attemptId,
    });
    // y el primer prompt no la llevaba: no habia nada esperando
    expect(huella.prompts[0] ?? '').not.toContain('NO ha salido');
  });

  it('con la revision QUITADA pasa exactamente lo de siempre', async () => {
    const huella = montar({ review: 'nunca' });

    const respuesta = await enviar('mandame una foto tuya');
    const imagen = respuesta.value?.image;
    expect(imagen?.state).toBe('done');
    expect(imagen?.mediaId).toBe('medio-1');
    // el plan no viaja: no hay nada que decidir, ya se mando
    expect(imagen?.plan).toBeNull();

    expect(horde.submitCalls).toBe(1);
    expect(horde.lastPrompt).toBe(PLAN.joined);
    expect(huella.intentos[0]?.state).toBe('ok');
  });

  it('UN BLOQUE CORTADO deja de ser invisible', async () => {
    // hoy `parseVaultImageRequest` ya devolvia el motivo y nadie lo leia: un
    // bloque cortado salia de aqui igual que un turno sin imagen
    const huella = montar({ review: 'siempre', respuestas: [CORTADO] });

    const respuesta = await enviar('mandame una foto tuya');
    const imagen = respuesta.value?.image;
    expect(imagen?.state).toBe('malformed');
    expect(imagen?.error).toBe('ella intento mandarte una imagen y el bloque se corto');
    expect(huella.intentos[0]?.state).toBe('malformed');
    expect(huella.intentos[0]?.malformedReason).toBe('truncated_block');
    // no hay texto que mandar, que es justo el problema
    expect(horde.submitCalls).toBe(0);
    // y lo que si llego se conserva
    expect(huella.turnos[1]?.text).toBe('*se muerde el labio* toma, mirame');
  });

  it('y un bloque mal escrito se distingue del cortado', async () => {
    const huella = montar({ review: 'siempre', respuestas: [MAL_ESCRITO] });

    const respuesta = await enviar('mandame una foto tuya');
    expect(respuesta.value?.image?.error).toBe(
      'ella intento mandarte una imagen y el bloque estaba mal escrito',
    );
    expect(huella.intentos[0]?.malformedReason).toBe('invalid');
  });

  it('EL TEXTO DEL PLAN NO VIAJA DENTRO DE `error` ni acaba en el registro', async () => {
    // la pantalla pinta `image.error` tal cual: meter ahi el prompt seria
    // escribir contenido de la boveda en un mensaje de error
    const huella = montar({ review: 'siempre' });

    const respuesta = await enviar('mandame una foto tuya');
    expect(respuesta.value?.image?.error).toBeNull();

    const escrito = JSON.stringify(huella.registros);
    expect(escrito).not.toContain('PECAS_TESTIGO');
    expect(escrito).not.toContain('ESCENA_TESTIGO');
    // lo que si lleva es la clasificacion y el uuid con el que encontrarlo
    expect(huella.campos('turno privado terminado')).toMatchObject({
      imagen: 'pending',
      imagenIntento: respuesta.value?.image?.attemptId,
    });
  });

  it('UN FALLO DEL PROVEEDOR DEJA EL TEXTO EN EL REGISTRO, NO EN `image.error`', async () => {
    // es la regla que sostiene lo que se ve en el hilo: la pantalla pinta
    // `image.error` tal cual, asi que ahi no puede ir ni una palabra del prompt.
    // Lo que se mando se lee aparte, del registro cifrado, y solo si se pide
    horde.fail = { message: 'ese modelo no existe', rc: 'censored' };
    const huella = montar({ review: 'nunca' });

    const respuesta = await enviar('mandame una foto tuya');
    const imagen = respuesta.value?.image;
    expect(imagen?.state).toBe('done');
    expect(imagen?.error).toBe('ese modelo no existe');
    expect(imagen?.error).not.toContain('PECAS_TESTIGO');
    expect(imagen?.error).not.toContain('ESCENA_TESTIGO');
    // y el plan tampoco viaja de vuelta al renderer: se lee con el identificador
    expect(imagen?.plan).toBeNull();
    expect(imagen?.attemptId).toBeTypeOf('string');

    // pero el registro SI lo tiene: es lo que abre «ver lo que se mando»
    const intento = huella.intentos.find((item) => item.attemptId === imagen?.attemptId);
    expect(intento?.state).toBe('failed');
    expect(intento?.rc).toBe('censored');
    expect(intento?.plan?.provider).toBe('horde');
    expect(intento?.plan?.provider === 'horde' && intento.plan.joined).toBe(PLAN.joined);
  });

  it('el aviso de un bloque roto tampoco lleva texto de la escena', async () => {
    const huella = montar({ review: 'siempre', respuestas: [CORTADO] });

    const respuesta = await enviar('mandame una foto tuya');
    expect(respuesta.value?.image?.error).not.toContain('ESCENA_TESTIGO');
    // y ahi no hay plan que leer: el bloque no llego a componerse
    expect(huella.intentos[0]?.plan).toBeNull();
  });

  it('si el registro de intentos no abre, el turno sale igual', async () => {
    // apuntar es contabilidad, no permiso. Sin intento no hay nada que aprobar,
    // asi que se genera: lo contrario dejaria la conversacion sin imagenes por
    // un archivo de disco
    const huella = montar({ review: 'nunca', registroRoto: true });

    const respuesta = await enviar('mandame una foto tuya');
    expect(respuesta.value?.userTurnKept).toBe(true);
    expect(respuesta.value?.image?.mediaId).toBe('medio-1');
    expect(huella.intentos).toHaveLength(0);
  });

  it('PERO UN PENDIENTE NO SE PROMETE SI NO SE PUDO APUNTAR', async () => {
    // aqui apuntar SI es el permiso: `vaultImageCommit` solo genera sobre un
    // intento que este en disco. Con el alta perdida y la tarjeta puesta, la
    // peticion queda irrecuperable —no se puede ni aprobar ni descartar— y el
    // turno siguiente se construye sobre la mentira de que la foto salio
    const huella = montar({
      review: 'siempre',
      registroRoto: true,
      respuestas: [CON_BLOQUE, '*se rie* vale'],
    });

    const respuesta = await enviar('mandame una foto tuya');
    const imagen = respuesta.value?.image;
    expect(imagen?.state).not.toBe('pending');
    expect(imagen?.attemptId).toBeNull();
    expect(imagen?.error).toBe('no se ha podido apuntar la imagen que quedaba por aprobar');
    // no se ha gastado nada, que es el lado seguro de fallar aqui
    expect(horde.submitCalls).toBe(0);
    expect(huella.intentos).toHaveLength(0);
    // y el texto de ella se conserva entero: el fallo de la imagen no tira el turno
    expect(respuesta.value?.userTurnKept).toBe(true);
    expect(huella.turnos[1]?.text).toBe('*se muerde el labio* toma, mirame');

    // EL TURNO SIGUIENTE LO SABE. Sin esto, el prompt no lleva ningun aviso y
    // ella da por mandada una foto que nadie ha visto
    await enviar('¿y esa foto?');
    expect(huella.prompts[1] ?? '').toContain('NO llego a generarse');
  });

  it('UNA APROBACION CUENTA COMO IMAGEN MANDADA en el turno siguiente', async () => {
    // el dato cierto que sostiene «otra porfa». Con la revision puesta el turno
    // termina sin `mediaId`, asi que la conversacion sale de la lista; la foto
    // llega despues, al aprobarla. Si nadie vuelve a apuntarla ahi, la señal es
    // SIEMPRE falsa justo con el ajuste por defecto, y la puerta se queda a
    // merced del lexico que esa señal existe para no necesitar
    const huella = montar({ review: 'siempre', respuestas: [SIN_NOMBRARLA] });

    const primero = await enviar('mandame una foto tuya');
    await aprobar(primero.value?.image?.attemptId);

    const segundo = await enviar('otra');
    await aprobar(segundo.value?.image?.attemptId);

    // el tercero es el que prueba algo: ni su mensaje, ni el turno anterior de
    // ella, ni el anterior de el nombran ninguna foto. Lo unico que puede abrir
    // la puerta es haber recibido la del turno de antes
    await enviar('otra');

    const puertas = huella.todos('turno privado');
    expect(puertas).toHaveLength(3);
    expect(puertas[2]?.puertaAbierta).toBe(true);
    expect(huella.todos('prompt privado compuesto')[2]?.imagenPuertaMotivo).toBe(
      'acepta-ofrecimiento',
    );
    // y las dos aprobaciones generaron de verdad
    expect(horde.submitCalls).toBe(2);
  });
});
