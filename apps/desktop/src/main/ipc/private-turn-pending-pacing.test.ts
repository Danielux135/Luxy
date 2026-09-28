// el modo esporadico de los pendientes (`D-104`) en el turno privado.
//
// Lo que se compone esta probado en `packages/shared/src/vault-pending-pacing.test.ts`
// y la seleccion en `relation-selection.test.ts`. Aqui va lo que solo pasa al
// cruzar el IPC: que el ajuste del PERSONAJE llega a la seleccion y al prompt,
// que el numero de orden sale del historial de la conversacion, que apagado no
// cambia nada, y que el registro dice lo que de verdad paso sin una palabra de
// la boveda. Todo el texto es INVENTADO para la prueba.
import { describe, it, expect, vi } from 'vitest';
import {
  RELATION_EXTRACTOR_VERSION,
  VAULT_PENDING_ALREADY_RAISED_BODY,
  VAULT_PENDING_ALREADY_RAISED_TITLE,
  VAULT_PENDING_SPARSE_PERMISSION,
  type RelationNote,
} from '@luxy/shared';

/** canales registrados por `registerIpcHandlers`, para poder invocarlos */
const canales = vi.hoisted(
  () => new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
);

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
const { vaultCharacterSchema } = await import('../vault/character-store.js');
const { noteId } = await import('../vault/relation.js');
const { tokenize } = await import('../vault/turn-index.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV_VIEJA = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_AHORA = 'bbbbbbbb-2222-4222-8222-222222222222';
const NORA = 'e0000000-5555-4555-8555-555555555555';

const DIA_MS = 24 * 60 * 60 * 1000;
const AHORA = Date.now();
const PROMETIDA_EN = new Date(AHORA - 7 * DIA_MS).toISOString();

const CAFES = 'mañana te traigo dos cafés y una tarta de chocolate a la cama';
const MERCADO = 'el sábado vamos juntos al mercado de las flores';
/** seis de las siete raices de la cita de los cafes: la regla estricta la acepta */
const SACA_CAFES =
  'oye, ¿y esos dos cafés con la tarta de chocolate en la cama que me ibas a traer mañana?';
const NOMBRA_CAFES = 'estoy preparando los dos cafés y la tarta de chocolate';

const PERMISO = VAULT_PENDING_SPARSE_PERMISSION.join('\n');
const YA_SALIO = `${VAULT_PENDING_ALREADY_RAISED_TITLE}:\n${VAULT_PENDING_ALREADY_RAISED_BODY}`;

interface TurnoFalso {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

/** la conversacion vieja, donde se hicieron las dos promesas */
const VIEJA: TurnoFalso[] = [
  { conversationId: CONV_VIEJA, sequence: 0, role: 'user', text: `${CAFES}, te lo juro`, createdAt: PROMETIDA_EN },
  {
    conversationId: CONV_VIEJA,
    sequence: 1,
    role: 'user',
    text: `${MERCADO}, ¿vale?`,
    createdAt: new Date(AHORA - 7 * DIA_MS + 60_000).toISOString(),
  },
];

function apuntada(quote: string, sequence: number, at: string): RelationNote {
  const origin = { conversationId: CONV_VIEJA, sequence, role: 'user' as const, at };
  return {
    id: noteId(origin, quote),
    quote,
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
    createdAt: at,
    updatedAt: at,
    origin,
  };
}

const NOTA_CAFES = apuntada(CAFES, 0, PROMETIDA_EN);
const NOTA_MERCADO = apuntada(MERCADO, 1, VIEJA[1]!.createdAt);

/**
 * el personaje tal y como lo devolveria el almacen.
 *
 * `ritmo` ausente es un registro anterior al campo: pasa por el mismo `parse()`
 * que el almacen y sale con su valor por defecto.
 */
function personaje(ritmo?: 'per-note' | 'sparse'): unknown {
  return vaultCharacterSchema.parse({
    characterId: NORA,
    imageProvider: 'xavira',
    xavira: { characterId: NORA, modelId: 'modelo-inventado' },
    description: 'Te llamas Nora.',
    label: 'Nora',
    avatarObjectKey: null,
    createdAt: '2026-09-04T10:00:00.000Z',
    ...(ritmo === undefined ? {} : { pendingPacing: ritmo }),
  });
}

interface Huella {
  prompts: string[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  campos: (mensaje: string) => Record<string, unknown> | undefined;
}

interface Montaje {
  personajes: unknown[];
  notes?: RelationNote[];
  /** la conversacion de ahora antes del mensaje, en orden alterno el/ella */
  ahora?: string[];
}

function montar(montaje: Montaje): Huella {
  const huella: Huella = {
    prompts: [],
    registros: [],
    campos: (mensaje) => huella.registros.find((r) => r.mensaje === mensaje)?.campos,
  };
  const turnos: TurnoFalso[] = (montaje.ahora ?? []).map((text, sequence) => ({
    conversationId: CONV_AHORA,
    sequence,
    role: sequence % 2 === 0 ? 'user' : 'assistant',
    text,
    createdAt: new Date(AHORA - 2 * 60 * 60 * 1000 + sequence * 60_000).toISOString(),
  }));
  // la linea temporal se toma al empezar el turno, como la del indice real
  const linea = [...VIEJA, ...turnos];

  const context = {
    vault: { isUnlocked: () => true, onLock: () => () => undefined, beginUserWait: () => () => undefined },
    privateConversations: {
      list: async () => [
        { conversationId: CONV_VIEJA, title: '', turns: 2, updatedAt: '', characterId: NORA },
        { conversationId: CONV_AHORA, title: '', turns: turnos.length, updatedAt: '', characterId: NORA },
      ],
      read: async () => turnos.map((turno) => ({ ...turno })),
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
      latestMemory: async () => null,
      // el dueño se lee SOLO por `owner()` (`D-103`)
      owner: async () => ({
        characterId: NORA,
        characterDescription: 'Te llamas Nora.',
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
    characters: { list: async () => montaje.personajes },
    privateMedia: { list: async () => [] },
    secretStore: { get: () => undefined },
    relations: {
      read: async () => ({
        notes: montaje.notes ?? [NOTA_CAFES],
        // al dia: sin esto la guarda de desfase lo bloquearia todo
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
      }),
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
        characterId === NORA ? new Set([CONV_VIEJA, CONV_AHORA]) : new Set<string>(),
      turnAt: (conversationId: string, sequence: number) =>
        linea.find(
          (turno) => turno.conversationId === conversationId && turno.sequence === sequence,
        ) ?? null,
    },
    memoryPreferences: {
      auxiliary: () => null,
      excluded: () => new Set([CONV_VIEJA, CONV_AHORA]),
    },
    controller: {
      runLocalTurn: async (request: { prompt: string }) => {
        huella.prompts.push(request.prompt);
        return {
          outcome: 'completed',
          text: 'una respuesta inventada que no habla de nada pendiente',
          executedModel: 'modelo-inventado',
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

async function enviar(mensaje: string): Promise<boolean> {
  const handler = canales.get(IPC_INVOKE.vaultConversationSend);
  if (handler === undefined) throw new Error('el canal de envio no se registro');
  const respuesta = (await handler(null, {
    conversationId: CONV_AHORA,
    message: mensaje,
    provider: 'conexion-inventada',
    model: 'modelo-inventado',
    projectAlias: 'luxy',
  })) as { ok: boolean };
  return respuesta.ok;
}

/** el segundo mensaje de el en la conversacion: con el tope, cerrado */
const SEGUNDO = ['buenos dias', 'buenos dias a ti'];

describe('apagado, el turno es el de siempre', () => {
  it('un personaje sin el campo da el mismo prompt que `per-note` explicito', async () => {
    const sinCampo = montar({ personajes: [personaje()], ahora: SEGUNDO });
    expect(await enviar('¿que tal has dormido?')).toBe(true);
    const explicito = montar({ personajes: [personaje('per-note')], ahora: SEGUNDO });
    expect(await enviar('¿que tal has dormido?')).toBe(true);

    expect(sinCampo.prompts[0]).toBe(explicito.prompts[0]);
    // en el segundo mensaje el bloque va, como siempre, con el permiso de siempre
    expect(sinCampo.prompts[0]).toContain('ASUNTOS PENDIENTES ENTRE VOSOTROS (DATOS)');
    expect(sinCampo.prompts[0]).not.toContain(PERMISO);
    expect(sinCampo.prompts[0]).not.toContain(YA_SALIO);
  });

  it('el registro lo dice con los campos nuevos siempre presentes', async () => {
    const huella = montar({ personajes: [personaje()], ahora: SEGUNDO });
    expect(await enviar('¿que tal has dormido?')).toBe(true);

    const campos = huella.campos('prompt privado compuesto');
    expect(campos).toMatchObject({
      pendientesEsporadicos: false,
      notaYaSalio: false,
      pendientes: { ofrecidas: 1, topeCerrado: false, retenidasPorTope: 0, sacadasPorElla: 0 },
    });
  });

  it('apagado, la nota de «ya salio» no viaja, pero la linea base se cuenta', async () => {
    const huella = montar({
      personajes: [personaje('per-note')],
      ahora: ['buenos dias', SACA_CAFES],
    });
    expect(await enviar('¿que tal has dormido?')).toBe(true);

    expect(huella.prompts[0]).not.toContain(YA_SALIO);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      notaYaSalio: false,
      pendientes: { enEscena: 1, sacadasPorElla: 1 },
    });
  });
});

describe('encendido', () => {
  it('en el primer mensaje de la conversacion va el bloque, con el permiso nuevo', async () => {
    const huella = montar({ personajes: [personaje('sparse')], ahora: [] });
    expect(await enviar('hola, ya estoy aqui')).toBe(true);

    const prompt = huella.prompts[0] ?? '';
    expect(prompt).toContain('ASUNTOS PENDIENTES ENTRE VOSOTROS (DATOS)');
    expect(prompt).toContain(PERMISO);
    expect(prompt).toContain(CAFES);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      pendientesEsporadicos: true,
      pendientes: { ofrecidas: 1, topeCerrado: false, retenidasPorTope: 0 },
    });
  });

  it('en el segundo no va, y el registro dice que el tope actuo', async () => {
    const huella = montar({ personajes: [personaje('sparse')], ahora: SEGUNDO });
    expect(await enviar('¿que tal has dormido?')).toBe(true);

    expect(huella.prompts[0]).not.toContain('ASUNTOS PENDIENTES');
    expect(huella.prompts[0]).not.toContain(CAFES);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      pendientesEsporadicos: true,
      pendientes: { ofrecidas: 0, topeCerrado: true, retenidasPorTope: 1 },
    });
  });

  it('con el tope cerrado, si el la nombra, va sola y marcada', async () => {
    const huella = montar({
      personajes: [personaje('sparse')],
      notes: [NOTA_CAFES, NOTA_MERCADO],
      ahora: SEGUNDO,
    });
    expect(await enviar(NOMBRA_CAFES)).toBe(true);

    const prompt = huella.prompts[0] ?? '';
    expect(prompt).toContain(CAFES);
    expect(prompt).toContain('lo nombra en su mensaje de ahora');
    expect(prompt).not.toContain(MERCADO);
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      pendientes: { ofrecidas: 1, tocadas: 1, topeCerrado: true, retenidasPorTope: 1 },
    });
  });

  it('si una respuesta suya de la ventana la saco, viaja la nota, sin decir cual', async () => {
    const huella = montar({
      personajes: [personaje('sparse')],
      ahora: ['buenos dias', SACA_CAFES],
    });
    expect(await enviar('¿que tal has dormido?')).toBe(true);

    const prompt = huella.prompts[0] ?? '';
    expect(prompt).toContain(YA_SALIO);
    // entre sus turnos y el mensaje nuevo
    expect(prompt.indexOf(YA_SALIO)).toBeGreaterThan(prompt.indexOf('ULTIMOS TURNOS'));
    expect(prompt.indexOf(YA_SALIO)).toBeLessThan(prompt.indexOf('MENSAJE NUEVO DEL USUARIO'));
    expect(huella.campos('prompt privado compuesto')).toMatchObject({
      notaYaSalio: true,
      pendientes: { enEscena: 1, sacadasPorElla: 1 },
    });
  });

  it('encendido y apagado solo difieren en lo que cambia el ajuste', async () => {
    // mismo turno, primer mensaje: las unicas diferencias son el permiso y,
    // desde la revision del 28/09, la regla de la promesa que no consta, que con
    // el tope deja de afirmar que la lista esta completa
    const apagado = montar({ personajes: [personaje('per-note')], ahora: [] });
    expect(await enviar('hola, ya estoy aqui')).toBe(true);
    const encendido = montar({ personajes: [personaje('sparse')], ahora: [] });
    expect(await enviar('hola, ya estoy aqui')).toBe(true);

    const hoy = apagado.prompts[0] ?? '';
    const permisoDeHoy = hoy.slice(
      hoy.indexOf('Tu te acuerdas aunque'),
      hoy.indexOf('por la cabeza y no como un aviso.') + 'por la cabeza y no como un aviso.'.length,
    );
    expect(permisoDeHoy.length).toBeGreaterThan(100);
    const reglaDeHoy = [
      'Una promesa que no aparezca en esta lista, en los ULTIMOS TURNOS ni en el momento que tienes',
      'transcrito no se hizo: no la reclames ni la des por hecha.',
    ].join('\n');
    const reglaConTope = [
      'Una promesa que no aparezca en esta lista, en los ULTIMOS TURNOS, en la memoria de esta',
      'conversacion ni en el momento que tienes transcrito',
      'no la saques tu ni la des por hecha. Esta lista no siempre las trae todas: si el nombra una',
      'que no ves aqui, no la niegues; siguele sin añadir nada que no conste.',
    ].join('\n');
    expect(hoy).toContain(reglaDeHoy);
    expect(encendido.prompts[0]).toBe(
      hoy.replace(permisoDeHoy, PERMISO).replace(reglaDeHoy, reglaConTope),
    );
  });
});

describe('el registro no lleva nada de la boveda', () => {
  it('los campos nuevos son booleanos o numeros, y ninguna cita sale', async () => {
    const huella = montar({
      personajes: [personaje('sparse')],
      notes: [NOTA_CAFES, NOTA_MERCADO],
      ahora: ['buenos dias', SACA_CAFES],
    });
    expect(await enviar(NOMBRA_CAFES)).toBe(true);

    const campos = huella.campos('prompt privado compuesto') ?? {};
    expect(typeof campos.pendientesEsporadicos).toBe('boolean');
    expect(typeof campos.notaYaSalio).toBe('boolean');
    const pendientes = campos.pendientes as Record<string, unknown>;
    expect(typeof pendientes.topeCerrado).toBe('boolean');
    expect(typeof pendientes.retenidasPorTope).toBe('number');
    expect(typeof pendientes.sacadasPorElla).toBe('number');

    const escrito = JSON.stringify(huella.registros);
    for (const texto of [CAFES, MERCADO, SACA_CAFES, NOMBRA_CAFES, 'cafés', 'chocolate']) {
      expect(escrito).not.toContain(texto);
    }
  });
});
