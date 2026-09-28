// el bloque de pendientes dentro del turno privado de pago.
//
// Lo que se prueba aqui no es la dosificacion —eso es puro y va en
// `relation-selection.test.ts`— sino lo que solo pasa al cruzar el IPC: que lo
// elegido llega al prompt que se envia, que las cifras de la seleccion quedan
// en el registro, que se cuenta si ella acabo sacandolo, y sobre todo las dos
// cosas que no pueden fallar nunca: que un fallo de la seleccion no cuesta el
// turno y que ni una palabra de la boveda acaba en el log.
import { describe, it, expect, vi } from 'vitest';
import {
  RELATION_EXTRACTOR_VERSION,
  type ConversationMemory,
  type RelationNote,
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

const { registerIpcHandlers } = await import('./handlers.js');
const { IPC_INVOKE } = await import('../../shared/ipc.js');
const { noteId } = await import('../vault/relation.js');
const { tokenize } = await import('../vault/turn-index.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV_VIEJA = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_AHORA = 'bbbbbbbb-2222-4222-8222-222222222222';
const LIA = 'c0000000-3333-4333-8333-333333333333';

const DIA_MS = 24 * 60 * 60 * 1000;
const AHORA = Date.now();
const PROMETIDA_EN = new Date(AHORA - 7 * DIA_MS).toISOString();

/** la promesa que motivo todo esto, tal y como se dijo */
const CAFES = 'mañana te traigo dos cafés y una tarta de chocolate a la cama';
const TURNO_ORIGEN = `*la abraza* ${CAFES}, te lo juro`;

interface TurnoFalso {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

/** la linea temporal que ya tenia la memoria episodica cuando empieza el turno */
function lineaTemporal(citaOrigen: string, suyaAhora: string): TurnoFalso[] {
  return [
    {
      conversationId: CONV_VIEJA,
      sequence: 0,
      role: 'user',
      text: citaOrigen,
      createdAt: PROMETIDA_EN,
    },
    {
      conversationId: CONV_VIEJA,
      sequence: 1,
      role: 'assistant',
      text: '*se rie* mas te vale',
      createdAt: new Date(AHORA - 7 * DIA_MS + 60_000).toISOString(),
    },
    // por defecto la de ahora no habla de la promesa: si lo hiciera estaria «en
    // escena» y la seleccion la callaria, que es justo lo contrario de lo que se
    // mide aqui. Una prueba la cambia a proposito, para medir ese caso
    {
      conversationId: CONV_AHORA,
      sequence: 0,
      role: 'user',
      text: 'buenos dias',
      createdAt: new Date(AHORA - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      conversationId: CONV_AHORA,
      sequence: 1,
      role: 'assistant',
      text: suyaAhora,
      createdAt: new Date(AHORA - 2 * 60 * 60 * 1000 + 60_000).toISOString(),
    },
  ];
}

function apuntada(over: Partial<RelationNote> & { quote: string }): RelationNote {
  const origin = over.origin ?? {
    conversationId: CONV_VIEJA,
    sequence: 0,
    role: 'user' as const,
    at: PROMETIDA_EN,
  };
  return {
    id: noteId(origin, over.quote),
    kind: 'promise',
    by: 'user',
    keywords: [],
    status: 'open',
    closure: null,
    source: 'extractor',
    decidedBy: 'extractor',
    reopenedByDaniel: false,
    extractedBy: 'codex',
    extractorVersion: RELATION_EXTRACTOR_VERSION,
    createdAt: PROMETIDA_EN,
    updatedAt: PROMETIDA_EN,
    ...over,
    origin,
  };
}

interface Huella {
  /** cada prompt que se mando a un proveedor, en orden */
  prompts: string[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  campos: (mensaje: string) => Record<string, unknown> | undefined;
}

interface Montaje {
  notes?: RelationNote[];
  /** lo que devuelve el almacen; si lanza, la seleccion se cae entera */
  readFalla?: Error;
  /** el texto de origen tal y como esta HOY en la boveda */
  citaOrigen?: string;
  /** la memoria acumulativa sellada de la conversacion */
  memoria?: ConversationMemory;
  /** la ultima respuesta suya, la que viaja como historial reciente */
  suyaAhora?: string;
  /** lo que contesta el modelo de pago */
  respuesta?: string;
  /** la llamada de pago no llega a escribir nada */
  turnoFallido?: boolean;
}

function montar(montaje: Montaje = {}): Huella {
  const huella: Huella = {
    prompts: [],
    registros: [],
    campos: (mensaje) => huella.registros.find((r) => r.mensaje === mensaje)?.campos,
  };

  const citaOrigen = montaje.citaOrigen ?? TURNO_ORIGEN;
  const linea = lineaTemporal(citaOrigen, montaje.suyaAhora ?? 'buenos dias a ti');
  // los turnos de la conversacion de ahora, que el turno va a hacer crecer
  const turnos: TurnoFalso[] = linea.filter((turno) => turno.conversationId === CONV_AHORA);

  const context = {
    vault: { isUnlocked: () => true, onLock: () => () => undefined, beginUserWait: () => () => undefined },
    privateConversations: {
      list: async () => [
        { conversationId: CONV_VIEJA, title: '', turns: 2, updatedAt: '', characterId: LIA },
        { conversationId: CONV_AHORA, title: '', turns: 2, updatedAt: '', characterId: LIA },
      ],
      read: async (_vault: unknown, conversationId: string) =>
        turnos.filter((turno) => turno.conversationId === conversationId),
      appendTurn: async (
        _vault: unknown,
        conversationId: string,
        turno: { role: 'user' | 'assistant'; text: string },
      ) => {
        turnos.push({
          conversationId,
          sequence: turnos.length,
          role: turno.role,
          text: turno.text,
          createdAt: new Date().toISOString(),
        });
        // el almacen de verdad devuelve el registro; el envio retira por su recordId
        return { recordId: `registro-${turnos.length}` };
      },
      removeLastTurn: () => turnos.pop(),
      latestMemory: async () => montaje.memoria ?? null,
      // el dueño se lee SOLO por `owner()` (`D-103`)
      owner: async () => ({
        characterId: LIA,
        characterDescription: 'Lia, veinticuatro años',
        instructions: null,
        characterLabel: null,
        source: 'turn' as const,
        signedAfter: 0,
        linkedAt: null,
        events: 0,
        winningEventId: null,
        instructionsSource: null,
      }),
    },
    characters: { list: async () => [] },
    privateMedia: { list: async () => [] },
    secretStore: { get: () => undefined },
    relations: {
      read: async () => {
        if (montaje.readFalla !== undefined) throw montaje.readFalla;
        return {
          notes: montaje.notes ?? [],
          // al dia: sin esto todo se bloquearia por desfase y la prueba mediria
          // la guarda en vez del bloque
          cursors: [CONV_VIEJA, CONV_AHORA].map((conversationId) => ({
            conversationId,
            through: 999,
            throughAt: null,
            version: RELATION_EXTRACTOR_VERSION,
            provider: 'codex' as const,
            model: null,
            at: PROMETIDA_EN,
            refusedVersion: null,
            refusedAtTurns: null,
          })),
          counters: {},
          droppedOnRead: 0,
          unreadable: { notes: [], cursors: [] },
        };
      },
      apply: async () => undefined,
    },
    privateMemory: {
      invalidate: () => undefined,
      search: async () => [],
      listEpisodes: async () => [],
      readEpisode: async () => [],
      timeline: async () =>
        linea.map((turno) => ({
          conversationId: turno.conversationId,
          sequence: turno.sequence,
          role: turno.role,
          createdAt: turno.createdAt,
          stems: new Set(tokenize(turno.text)),
        })),
      // sin enganches: ningun cursor se invalida por dueño (`D-103`)
      ownerOf: () => undefined,
      conversationsFor: (characterId: string | null) =>
        characterId === LIA ? new Set([CONV_VIEJA, CONV_AHORA]) : new Set<string>(),
      turnAt: (conversationId: string, sequence: number) =>
        linea.find(
          (turno) => turno.conversationId === conversationId && turno.sequence === sequence,
        ) ?? null,
    },
    memoryPreferences: {
      auxiliary: () => null,
      // el trabajo de fondo no es lo que se mide aqui: excluidas las dos, el
      // disparo posterior al turno no manda nada a ningun CLI
      excluded: () => new Set([CONV_VIEJA, CONV_AHORA]),
    },
    controller: {
      runLocalTurn: async (request: { prompt: string }) => {
        huella.prompts.push(request.prompt);
        if (montaje.turnoFallido === true) {
          return {
            outcome: 'failed',
            text: '',
            executedModel: null,
            inputTokens: null,
            outputTokens: null,
            durationMs: 1234,
            error: 'el proveedor devolvio 429',
          };
        }
        return {
          outcome: 'completed',
          text: montaje.respuesta ?? '*se estira* buenos dias',
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

type Respuesta =
  | { ok: true; value: { outcome: string; userTurnKept: boolean; turns: unknown[] } }
  | { ok: false; error: string };

async function enviar(mensaje: string): Promise<Respuesta> {
  const handler = canales.get(IPC_INVOKE.vaultConversationSend);
  if (handler === undefined) throw new Error('el canal de envio no se registro');
  return (await handler(null, {
    conversationId: CONV_AHORA,
    message: mensaje,
    provider: 'deepseek',
    model: 'deepseek-chat',
    projectAlias: 'luxy',
  })) as Respuesta;
}

describe('lo pendiente dentro del turno privado', () => {
  it('mete la cita en el prompt y deja las cifras en el registro', async () => {
    const huella = montar({ notes: [apuntada({ quote: CAFES })] });

    const respuesta = await enviar('¿que tal has dormido?');
    expect(respuesta.ok).toBe(true);

    const prompt = huella.prompts[0] ?? '';
    expect(prompt).toContain('ASUNTOS PENDIENTES ENTRE VOSOTROS (DATOS)');
    // la cita va LITERAL: es lo unico que puede repetir sin inventarse nada
    expect(prompt).toContain(CAFES);
    // y va antes del mensaje nuevo, no pegado al final, que es lo que la haria
    // soltarla en cada turno
    expect(prompt.indexOf('ASUNTOS PENDIENTES')).toBeLessThan(
      prompt.lastIndexOf('¿que tal has dormido?'),
    );

    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      pendientes: {
        abiertas: 1,
        ofrecidas: 1,
        tocadas: 0,
        enEscena: 0,
        enReposo: 0,
        enEspera: 0,
        dormidas: 0,
        bloqueadasPorDesfase: 0,
        citaRota: 0,
      },
      pendientesError: false,
    });
  });

  it('cuenta si ella acabo sacando lo que se le enseño', async () => {
    const huella = montar({
      notes: [apuntada({ quote: CAFES })],
      respuesta: '*bosteza* bien... ¿y mi tarta de chocolate y mis dos cafés en la cama?',
    });

    expect((await enviar('¿que tal has dormido?')).ok).toBe(true);
    expect(huella.campos('pendientes en la respuesta')).toEqual({ mostrados: 1, aludidos: 1 });
  });

  it('y cuenta que no la saco cuando contesta de otra cosa', async () => {
    const huella = montar({
      notes: [apuntada({ quote: CAFES })],
      respuesta: '*se estira* bien, aunque hacia frio',
    });

    expect((await enviar('¿que tal has dormido?')).ok).toBe(true);
    expect(huella.campos('pendientes en la respuesta')).toEqual({ mostrados: 1, aludidos: 0 });
  });

  it('un turno que no llego a contestar no cuenta como que ella lo ignoro', async () => {
    const huella = montar({ notes: [apuntada({ quote: CAFES })], turnoFallido: true });

    const respuesta = await enviar('¿que tal has dormido?');
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    expect(respuesta.value.userTurnKept).toBe(false);

    // se le enseño, eso consta arriba...
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      pendientes: { ofrecidas: 1 },
    });
    // ...pero no hay respuesta que mirar, y un «aludidos: 0» aqui diria que la
    // dejo pasar
    expect(huella.campos('pendientes en la respuesta')).toBeUndefined();
  });

  it('sin nada apuntado el prompt queda igual que antes', async () => {
    const huella = montar({ notes: [] });

    expect((await enviar('buenos dias')).ok).toBe(true);
    expect(huella.prompts[0] ?? '').not.toContain('ASUNTOS PENDIENTES');
    // y no se registra lo que no se enseño: un «mostrados: 0» por turno seria
    // ruido en el unico sitio donde se mira lo que paso
    expect(huella.campos('pendientes en la respuesta')).toBeUndefined();
  });

  it('un fallo de la seleccion deja el turno intacto y sin bloque', async () => {
    // el almacen no se abre. Es el caso que no puede costar una llamada de pago
    const huella = montar({
      notes: [apuntada({ quote: CAFES })],
      readFalla: new Error('no se pudo abrir el sobre de TARTA_SENTINEL'),
    });

    const respuesta = await enviar('¿que tal has dormido?');
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    // el turno sale entero: se contesto, se guardo y el mensaje del usuario se
    // conserva
    expect(respuesta.value.outcome).toBe('completed');
    expect(respuesta.value.userTurnKept).toBe(true);
    expect(respuesta.value.turns).toHaveLength(4);

    expect(huella.prompts).toHaveLength(1);
    expect(huella.prompts[0] ?? '').not.toContain('ASUNTOS PENDIENTES');
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      pendientes: null,
      pendientesError: true,
    });
  });

  it('ni la cita ni las keywords aparecen en ningun registro', async () => {
    const cita = `manana te traigo dos cafes y una TARTA_SENTINEL de chocolate a la cama`;
    const huella = montar({
      notes: [apuntada({ quote: cita, keywords: ['TARTA_SENTINEL'] })],
      citaOrigen: `*la abraza* ${cita}, te lo juro`,
    });

    expect((await enviar('¿que tal has dormido?')).ok).toBe(true);
    // sin esto la comprobacion pasaria tambien con el bloque apagado, que es
    // justo lo que no prueba nada
    expect(huella.prompts[0] ?? '').toContain('TARTA_SENTINEL');

    const escrito = JSON.stringify(huella.registros);
    expect(escrito).toContain('prompt privado compuesto');
    expect(escrito).toContain('pendientes en la respuesta');
    expect(escrito).not.toContain('TARTA_SENTINEL');
    expect(escrito).not.toContain('chocolate');
    expect(escrito).not.toContain(CONV_VIEJA);
  });

  it('tampoco el motivo por el que fallo la seleccion', async () => {
    // un error de validacion trae dentro el dato que no valido, y ese dato es
    // una cita de la boveda
    const huella = montar({
      notes: [apuntada({ quote: CAFES })],
      readFalla: new Error('nota invalida: «TARTA_SENTINEL de chocolate»'),
    });

    expect((await enviar('¿que tal has dormido?')).ok).toBe(true);
    expect(JSON.stringify(huella.registros)).not.toContain('TARTA_SENTINEL');
  });
});

// lo que se le enseña dosificado es una cosa; lo que vuelve solo, otra. Estas
// miden lo segundo, que es lo que no se podia ver desde fuera.
describe('a que conversacion pertenece un prompt y que vuelve solo en el', () => {
  it('el registro dice de que conversacion es el prompt', async () => {
    const huella = montar({ notes: [apuntada({ quote: CAFES })] });

    expect((await enviar('¿que tal has dormido?')).ok).toBe(true);
    // sin esta cifra no se puede saber a que conversacion pertenece una linea,
    // que es exactamente lo que impidio datar el sintoma
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      conversacion: CONV_AHORA,
    });
  });

  it('cuenta la promesa que vuelve sola por la memoria acumulativa', async () => {
    const huella = montar({
      notes: [apuntada({ quote: CAFES })],
      memoria: {
        version: 1,
        summary: 'van despertandose',
        facts: [],
        decisions: [],
        plan: ['llevarle dos cafés y una tarta de chocolate a la cama'],
        openQuestions: ['¿a que hora se levanta?'],
        lessons: [],
      },
    });

    expect((await enviar('¿que tal has dormido?')).ok).toBe(true);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      // dos entradas miradas —una de `plan` y otra de `openQuestions`— y solo
      // una repite la promesa: la otra no cuenta
      ecoMemoria: { entradas: 2, enNotas: 1 },
      ecoHistorial: { respuestas: 1, enNotas: 0 },
    });
  });

  it('cuenta la promesa que vuelve sola dentro de su ultima respuesta', async () => {
    const huella = montar({
      notes: [apuntada({ quote: CAFES })],
      suyaAhora: 'te debo dos cafés y una tarta de chocolate a la cama, no se me olvida',
    });

    expect((await enviar('¿que tal has dormido?')).ok).toBe(true);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      // la dosificacion la calla porque ella ya la tiene delante...
      pendientes: { abiertas: 1, ofrecidas: 0, enEscena: 1 },
      // ...y aun asi la promesa viaja entera en el prompt, otra vez. Ese es el
      // canal que «ofrecidas: 0» no deja ver
      ecoHistorial: { respuestas: 1, enNotas: 1 },
      ecoMemoria: { entradas: 0, enNotas: 0 },
    });
  });

  it('sin nada apuntado las dos cifras son cero, no un fallo', async () => {
    const huella = montar({ notes: [] });

    expect((await enviar('buenos dias')).ok).toBe(true);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      ecoMemoria: { entradas: 0, enNotas: 0 },
      ecoHistorial: { respuestas: 1, enNotas: 0 },
    });
  });

  it('si no se pudo leer lo apuntado las dos van en nulo, no en cero', async () => {
    // un cero diria «no vuelve nada», que es una afirmacion; aqui no se sabe
    const huella = montar({
      notes: [apuntada({ quote: CAFES })],
      readFalla: new Error('no se pudo abrir el sobre'),
    });

    expect((await enviar('¿que tal has dormido?')).ok).toBe(true);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      ecoMemoria: null,
      ecoHistorial: null,
    });
  });

  it('las cifras de eco no arrastran ni una palabra de lo que midieron', async () => {
    const cita = 'manana te traigo dos cafes y una TARTA_SENTINEL de chocolate a la cama';
    const huella = montar({
      notes: [apuntada({ quote: cita })],
      citaOrigen: `*la abraza* ${cita}, te lo juro`,
      memoria: {
        version: 1,
        summary: 'sigue debiendole el desayuno PLAN_SENTINEL',
        facts: [],
        decisions: [],
        plan: ['llevarle dos cafes y una TARTA_SENTINEL de chocolate a la cama'],
        openQuestions: ['¿PREGUNTA_SENTINEL a que hora se levanta?'],
        lessons: [],
      },
      suyaAhora: 'te debo la TARTA_SENTINEL de chocolate y los dos cafes, HISTORIAL_SENTINEL',
    });

    expect((await enviar('¿que tal has dormido?')).ok).toBe(true);

    // sin esto la comprobacion pasaria tambien con todo apagado, que es justo lo
    // que no prueba nada: los centinelas TIENEN que estar en el prompt
    const prompt = huella.prompts[0] ?? '';
    expect(prompt).toContain('PLAN_SENTINEL');
    expect(prompt).toContain('PREGUNTA_SENTINEL');
    expect(prompt).toContain('HISTORIAL_SENTINEL');
    // ...y las dos cifras tienen que haber contado de verdad
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      ecoMemoria: { entradas: 2, enNotas: 1 },
      ecoHistorial: { respuestas: 1, enNotas: 1 },
    });

    // esto es lo que de verdad importa: se midio texto descifrado y al registro
    // solo salieron enteros
    const escrito = JSON.stringify(huella.registros);
    for (const centinela of [
      'TARTA_SENTINEL',
      'PLAN_SENTINEL',
      'PREGUNTA_SENTINEL',
      'HISTORIAL_SENTINEL',
      'chocolate',
      'cafes',
      'cama',
      'dormido',
    ]) {
      expect(escrito).not.toContain(centinela);
    }
  });
});
