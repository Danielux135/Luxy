// un envio que la boveda corta al cerrarse, y la presencia que la mantiene
// abierta (`D-106`).
//
// Desde que leer no cuenta como actividad, Win+L sin nada en camino, suspender
// o la X cierran la boveda en el acto aunque haya un turno a medias. La
// conversacion no puede quedar con un mensaje suyo sin contestar, ni la pantalla
// puede decirle algo falso de donde esta su texto. Todo el texto es INVENTADO.
import { describe, it, expect, vi } from 'vitest';

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

const { registerIpcHandlers, SEND_CUT_BY_LOCK } = await import('./handlers.js');
const { IPC_INVOKE } = await import('../../shared/ipc.js');
const { VaultError } = await import('../vault/vault-service.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const CONV = 'dddddddd-4444-4444-8444-444444444444';
const LIA = 'c0000000-3333-4333-8333-333333333333';

interface Turno {
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  /** en claro en el registro de verdad: lo unico que se puede mirar sin la llave */
  recordId: string;
}

interface Huella {
  turnos: Turno[];
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  campos: (mensaje: string) => Record<string, unknown> | undefined;
  esperas: { empezadas: number; soltadas: number };
  toques: number;
  boveda: { abierta: boolean };
  /** veces que se llamo al modelo */
  llamadas: number;
  /** lo que llego a borrarse: medios y archivo de la conversacion */
  borrados: string[];
}

interface Montaje {
  /** en que momento se cierra la boveda */
  cierre: 'durante-la-llamada' | 'tras-guardar-la-respuesta' | 'antes-de-empezar' | 'nunca';
  ventana?: { visible: boolean; foco: boolean } | null;
  /**
   * como acaba la llamada al modelo; por defecto, con una respuesta buena.
   * `lanza` es `runLocalTurn` tirando un error, como con el agente parado
   */
  llamada?: 'responde' | 'falla' | 'vacia' | 'lanza';
  /** durante la llamada entra otra linea detras de su mensaje */
  intrusa?: boolean;
  /** turnos que la conversacion ya tenia antes del envio */
  historial?: { role: 'user' | 'assistant'; text: string }[];
  /** la llamada al modelo no vuelve hasta que esto se resuelve */
  pausa?: Promise<void>;
}

function montar(montaje: Montaje): Huella {
  const huella: Huella = {
    turnos: (montaje.historial ?? []).map((turno, sequence) => ({
      conversationId: CONV,
      sequence,
      role: turno.role,
      text: turno.text,
      createdAt: new Date(0).toISOString(),
      recordId: `previo-${sequence}`,
    })),
    registros: [],
    campos: (mensaje) => huella.registros.find((r) => r.mensaje === mensaje)?.campos,
    esperas: { empezadas: 0, soltadas: 0 },
    toques: 0,
    boveda: { abierta: montaje.cierre !== 'antes-de-empezar' },
    llamadas: 0,
    borrados: [],
  };
  // como el almacen de verdad: todo lo que descifra o sella exige la llave
  const llave = (): void => {
    if (!huella.boveda.abierta) throw new VaultError('la boveda esta bloqueada');
  };

  const context = {
    vault: {
      isUnlocked: () => huella.boveda.abierta,
      onLock: () => () => undefined,
      touch: () => {
        huella.toques += 1;
      },
      beginUserWait: () => {
        huella.esperas.empezadas += 1;
        return () => {
          huella.esperas.soltadas += 1;
        };
      },
    },
    getMainWindow: () =>
      montaje.ventana == null
        ? null
        : {
            isDestroyed: () => false,
            isVisible: () => montaje.ventana?.visible ?? false,
            isFocused: () => montaje.ventana?.foco ?? false,
          },
    privateConversations: {
      list: async () => {
        llave();
        return [];
      },
      read: async () => {
        llave();
        return huella.turnos.map((turno) => ({ ...turno }));
      },
      appendTurn: async (
        _vault: unknown,
        conversationId: string,
        turno: { role: 'user' | 'assistant'; text: string },
      ) => {
        llave();
        const recordId = `registro-${huella.turnos.length}`;
        huella.turnos.push({
          conversationId,
          sequence: huella.turnos.length,
          role: turno.role,
          text: turno.text,
          createdAt: new Date().toISOString(),
          recordId,
        });
        if (turno.role === 'assistant' && montaje.cierre === 'tras-guardar-la-respuesta') {
          huella.boveda.abierta = false;
        }
        return { recordId };
      },
      // no necesita la llave, como el de verdad (`conversation-store.ts`), y con
      // un registro concreto solo quita la ultima linea si es esa
      removeLastTurn: (_conversationId: string, expectedRecordId?: string) => {
        const ultima = huella.turnos.at(-1);
        if (ultima === undefined) return false;
        if (expectedRecordId !== undefined && ultima.recordId !== expectedRecordId) return false;
        huella.turnos.pop();
        return true;
      },
      delete: (conversationId: string) => {
        huella.borrados.push(`archivo:${conversationId}`);
        huella.turnos = [];
      },
      latestMemory: async () => {
        llave();
        return null;
      },
      owner: async () => {
        llave();
        return {
          characterId: LIA,
          characterDescription: 'personaje inventado',
          instructions: null,
          characterLabel: null,
          source: 'turn' as const,
          signedAfter: 0,
          linkedAt: null,
          events: 0,
          winningEventId: null,
          instructionsSource: null,
        };
      },
    },
    characters: {
      list: async () => {
        llave();
        return [];
      },
    },
    privateMedia: {
      list: async () => [],
      deleteConversation: async (conversationId: string) => {
        huella.borrados.push(`medios:${conversationId}`);
      },
    },
    secretStore: { get: () => undefined },
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
      timeline: async () => [],
      ownerOf: () => undefined,
      conversationsFor: () => new Set<string>(),
      turnAt: () => null,
    },
    memoryPreferences: {
      auxiliary: () => null,
      excluded: () => new Set([CONV]),
    },
    controller: {
      runLocalTurn: async () => {
        huella.llamadas += 1;
        if (montaje.pausa !== undefined) await montaje.pausa;
        // Win+L, la X o suspender mientras el modelo contesta
        if (montaje.cierre === 'durante-la-llamada') huella.boveda.abierta = false;
        // lo que haria la sincronizacion de antes de este arreglo: bajar un
        // registro de otro equipo detras de su mensaje
        if (montaje.intrusa === true) {
          huella.turnos.push({
            conversationId: CONV,
            sequence: huella.turnos.length,
            role: 'assistant',
            text: 'LINEA_INTRUSA_INVENTADA',
            createdAt: new Date().toISOString(),
            recordId: 'intrusa',
          });
        }
        const llamada = montaje.llamada ?? 'responde';
        if (llamada === 'lanza') throw new Error('el proceso del agente no esta arrancado');
        if (llamada === 'falla') {
          // la red cae al volver de una suspension, un 429...: sin texto
          return {
            outcome: 'failed',
            text: '',
            executedModel: 'deepseek-v4-flash',
            inputTokens: null,
            outputTokens: null,
            durationMs: 1234,
            error: 'fallo inventado del proveedor',
          };
        }
        return {
          outcome: 'completed',
          text:
            llamada === 'vacia' ? '' : 'RESPUESTA_INVENTADA_TESTIGO con unas cuantas palabras mas',
          executedModel: 'deepseek-v4-flash',
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
  | {
      ok: true;
      value: { userTurnKept: boolean; turns: unknown[]; error: string | null; image: unknown };
    }
  | { ok: false; error: string; hint: string | null };

async function invocar(canal: string, args: unknown): Promise<unknown> {
  const handler = canales.get(canal);
  if (handler === undefined) throw new Error(`el canal ${canal} no se registro`);
  return handler(null, args);
}

async function enviar(mensaje: string): Promise<Respuesta> {
  return (await invocar(IPC_INVOKE.vaultConversationSend, {
    conversationId: CONV,
    message: mensaje,
    provider: 'hcnsec',
    model: 'deepseek-v4-flash',
    projectAlias: 'luxy',
  })) as Respuesta;
}

describe('un envio que corta el cierre de la boveda', () => {
  it('si se cierra durante la llamada, retira su mensaje y le dice donde sigue el texto', async () => {
    const huella = montar({ cierre: 'durante-la-llamada' });
    const respuesta = await enviar('MENSAJE_INVENTADO_TESTIGO');

    expect(respuesta).toEqual({
      ok: false,
      error: SEND_CUT_BY_LOCK.lostMessage,
      hint: SEND_CUT_BY_LOCK.lostHint,
    });
    // ni su mensaje suelto ni una respuesta: la conversacion queda como estaba
    expect(huella.turnos).toEqual([]);
    expect(huella.campos('turno privado cortado por el cierre de la boveda')).toEqual({
      mensajeRetirado: true,
      respuestaGuardada: false,
    });
    // la espera se abrio y se solto, aunque fallara
    expect(huella.esperas).toEqual({ empezadas: 1, soltadas: 1 });
    const escrito = JSON.stringify(huella.registros);
    expect(escrito).not.toContain('MENSAJE_INVENTADO_TESTIGO');
    expect(escrito).not.toContain('RESPUESTA_INVENTADA_TESTIGO');
  });

  // la retirada de siempre (turno sin respuesta) y la del cierre no pueden
  // sumarse: `removeLastTurn` quita la ultima linea sin mirar su rol, y la
  // segunda se llevaba la respuesta buena de ANTES del envio, sin papelera
  for (const llamada of ['falla', 'vacia'] as const) {
    it(`si se cierra durante una llamada que ${llamada === 'falla' ? 'falla' : 'vuelve vacia'}, retira SOLO su mensaje`, async () => {
      const huella = montar({
        cierre: 'durante-la-llamada',
        llamada,
        historial: [
          { role: 'user', text: 'hola inventado' },
          { role: 'assistant', text: 'RESPUESTA_ANTERIOR_INVENTADA' },
        ],
      });
      const respuesta = await enviar('MENSAJE_INVENTADO_TESTIGO');

      expect(respuesta).toEqual({
        ok: false,
        error: SEND_CUT_BY_LOCK.lostMessage,
        hint: SEND_CUT_BY_LOCK.lostHint,
      });
      // la conversacion queda EXACTAMENTE como estaba antes de enviar
      expect(huella.turnos.map((turno) => [turno.role, turno.text])).toEqual([
        ['user', 'hola inventado'],
        ['assistant', 'RESPUESTA_ANTERIOR_INVENTADA'],
      ]);
      // lo retiro el propio turno, una sola vez, y el registro lo dice
      expect(huella.campos('turno privado cortado por el cierre de la boveda')).toEqual({
        mensajeRetirado: true,
        respuestaGuardada: false,
      });
      expect(huella.esperas).toEqual({ empezadas: 1, soltadas: 1 });
    });
  }

  // las otras dos salidas, con historial: sin el, una doble retirada no deja
  // rastro, porque retirar de una lista vacia no hace nada (revision del 28/09)
  for (const llamada of ['responde', 'lanza'] as const) {
    it(`si se cierra durante una llamada que ${llamada}, la conversacion queda como estaba`, async () => {
      const huella = montar({
        cierre: 'durante-la-llamada',
        llamada,
        historial: [
          { role: 'user', text: 'hola inventado' },
          { role: 'assistant', text: 'RESPUESTA_ANTERIOR_INVENTADA' },
        ],
      });
      const respuesta = await enviar('MENSAJE_INVENTADO_TESTIGO');

      expect(respuesta).toEqual({
        ok: false,
        error: SEND_CUT_BY_LOCK.lostMessage,
        hint: SEND_CUT_BY_LOCK.lostHint,
      });
      expect(huella.turnos.map((turno) => [turno.role, turno.text])).toEqual([
        ['user', 'hola inventado'],
        ['assistant', 'RESPUESTA_ANTERIOR_INVENTADA'],
      ]);
      expect(huella.campos('turno privado cortado por el cierre de la boveda')).toEqual({
        mensajeRetirado: true,
        respuestaGuardada: false,
      });
      expect(huella.esperas).toEqual({ empezadas: 1, soltadas: 1 });
    });
  }

  it('si se cierra justo despues de guardar la respuesta, el turno cuenta y no viaja nada descifrado', async () => {
    const huella = montar({ cierre: 'tras-guardar-la-respuesta' });
    const respuesta = await enviar('otro mensaje inventado');

    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    // `userTurnKept` vacia el cuadro de texto: no se reenvia un duplicado
    expect(respuesta.value.userTurnKept).toBe(true);
    expect(respuesta.value.turns).toEqual([]);
    expect(respuesta.value.error).toBe(SEND_CUT_BY_LOCK.savedReply);
    expect(huella.turnos.map((turno) => turno.role)).toEqual(['user', 'assistant']);
    expect(huella.campos('turno privado cortado por el cierre de la boveda')).toEqual({
      mensajeRetirado: false,
      respuestaGuardada: true,
    });
    expect(huella.esperas).toEqual({ empezadas: 1, soltadas: 1 });
    expect(JSON.stringify(respuesta)).not.toContain('RESPUESTA_INVENTADA_TESTIGO');
  });

  it('con la boveda ya cerrada al enviar no se habla de ningun corte', async () => {
    const huella = montar({ cierre: 'antes-de-empezar' });
    const respuesta = await enviar('mensaje inventado');

    expect(respuesta.ok).toBe(false);
    if (respuesta.ok) return;
    expect(respuesta.error).toBe('la boveda esta bloqueada');
    expect(huella.campos('turno privado cortado por el cierre de la boveda')).toBeUndefined();
  });

  it('sin cierre, el envio es una espera suya que se suelta al terminar', async () => {
    const huella = montar({ cierre: 'nunca' });
    const respuesta = await enviar('mensaje inventado');

    expect(respuesta.ok).toBe(true);
    expect(huella.esperas).toEqual({ empezadas: 1, soltadas: 1 });
    expect(huella.turnos).toHaveLength(2);
  });
});

describe('un envio que falla con la boveda abierta', () => {
  const HISTORIAL = [
    { role: 'user' as const, text: 'hola inventado' },
    { role: 'assistant' as const, text: 'RESPUESTA_ANTERIOR_INVENTADA' },
  ];

  it('si la llamada LANZA, retira su mensaje igual que cuando vuelve vacia', async () => {
    // revision del 28/09: con el agente parado `runLocalTurn` lanza, y el mensaje
    // se quedaba en el historial mientras su texto seguia en el cuadro; al
    // reenviarlo salia dos veces
    const huella = montar({ cierre: 'nunca', llamada: 'lanza', historial: HISTORIAL });
    const respuesta = await enviar('MENSAJE_INVENTADO_TESTIGO');

    expect(respuesta.ok).toBe(false);
    expect(huella.turnos.map((turno) => [turno.role, turno.text])).toEqual([
      ['user', 'hola inventado'],
      ['assistant', 'RESPUESTA_ANTERIOR_INVENTADA'],
    ]);
    // no es un corte por el cierre: no se registra como tal
    expect(huella.campos('turno privado cortado por el cierre de la boveda')).toBeUndefined();
    expect(huella.esperas).toEqual({ empezadas: 1, soltadas: 1 });
  });

  it('si LANZA en el primer mensaje, la conversacion queda vacia y se retira una vez', async () => {
    const huella = montar({ cierre: 'nunca', llamada: 'lanza' });
    const respuesta = await enviar('MENSAJE_INVENTADO_TESTIGO');

    expect(respuesta.ok).toBe(false);
    expect(huella.turnos).toEqual([]);
    expect(huella.llamadas).toBe(1);
  });

  it('si LANZA con otra linea detras de su mensaje, no toca ninguna de las dos', async () => {
    // la retirada va por `recordId`: si su mensaje ya no es la ultima linea, no
    // se retira nada, ni una segunda vez en otro sitio
    const huella = montar({
      cierre: 'nunca',
      llamada: 'lanza',
      intrusa: true,
      historial: HISTORIAL,
    });
    const respuesta = await enviar('MENSAJE_INVENTADO_TESTIGO');

    expect(respuesta.ok).toBe(false);
    expect(huella.turnos.map((turno) => turno.text)).toEqual([
      'hola inventado',
      'RESPUESTA_ANTERIOR_INVENTADA',
      'MENSAJE_INVENTADO_TESTIGO',
      'LINEA_INTRUSA_INVENTADA',
    ]);
  });

  it('si detras de su mensaje entro otra linea, no se lleva esa en su lugar', async () => {
    // retirar «la ultima linea» se habria llevado la intrusa y dejado el mensaje
    // huerfano. Con el `recordId` no casa, y no se toca nada
    const huella = montar({
      cierre: 'nunca',
      llamada: 'falla',
      intrusa: true,
      historial: HISTORIAL,
    });
    const respuesta = await enviar('MENSAJE_INVENTADO_TESTIGO');

    expect(respuesta.ok).toBe(true);
    expect(huella.turnos.map((turno) => turno.text)).toEqual([
      'hola inventado',
      'RESPUESTA_ANTERIOR_INVENTADA',
      'MENSAJE_INVENTADO_TESTIGO',
      'LINEA_INTRUSA_INVENTADA',
    ]);
  });
});

describe('un envio por conversacion', () => {
  it('rechaza otro envio a la misma conversacion mientras el primero sigue en vuelo', async () => {
    // revision del 28/09: con la ventana recargada a mitad (Ctrl+R o un
    // cuelgue), la pantalla deja enviar otra vez. Los dos turnos se intercalaban
    // y el primero en terminar quitaba la marca de «enviando» con el segundo aun
    // en vuelo
    let soltar: () => void = () => undefined;
    const pausa = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    const huella = montar({ cierre: 'nunca', pausa });
    const primero = enviar('PRIMER_MENSAJE_INVENTADO');
    // hasta que el primero esta esperando al modelo
    while (huella.llamadas === 0) await new Promise((resolve) => setTimeout(resolve, 0));

    const segundo = await enviar('SEGUNDO_MENSAJE_INVENTADO');
    expect(segundo.ok).toBe(false);
    if (segundo.ok) return;
    expect(segundo.error).toBe('esa conversacion esta contestando ahora mismo');
    // el rechazo no quita la marca del primero: un tercero tambien se rechaza
    expect((await enviar('TERCER_MENSAJE_INVENTADO')).ok).toBe(false);
    // ni llama al modelo, ni escribe nada, ni abre una espera
    expect(huella.llamadas).toBe(1);
    expect(huella.esperas.empezadas).toBe(1);

    soltar();
    expect((await primero).ok).toBe(true);
    expect(huella.turnos.map((turno) => turno.role)).toEqual(['user', 'assistant']);
    expect(huella.turnos[0]?.text).toBe('PRIMER_MENSAJE_INVENTADO');

    // terminado el primero, se puede volver a enviar
    expect((await enviar('CUARTO_MENSAJE_INVENTADO')).ok).toBe(true);
    expect(huella.turnos).toHaveLength(4);
  });
});

describe('borrar una conversacion que esta contestando', () => {
  it('se rechaza: al volver, su respuesta resucitaba la conversacion borrada', async () => {
    // revision del 28/09: el borrado no miraba el envio en vuelo. `appendTurn`
    // sellaba la respuesta en el archivo ya borrado y la conversacion volvia
    // con solo esa linea
    let soltar: () => void = () => undefined;
    const pausa = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    const huella = montar({
      cierre: 'nunca',
      pausa,
      historial: [
        { role: 'user', text: 'hola inventado' },
        { role: 'assistant', text: 'RESPUESTA_ANTERIOR_INVENTADA' },
      ],
    });
    const envio = enviar('MENSAJE_INVENTADO_TESTIGO');
    while (huella.llamadas === 0) await new Promise((resolve) => setTimeout(resolve, 0));

    const borrado = (await invocar(IPC_INVOKE.vaultConversationDelete, {
      conversationId: CONV,
    })) as Respuesta;
    expect(borrado.ok).toBe(false);
    if (borrado.ok) return;
    expect(borrado.error).toBe('esa conversacion esta contestando ahora mismo');
    // no se toco nada: ni medios ni archivo
    expect(huella.borrados).toEqual([]);

    soltar();
    expect((await envio).ok).toBe(true);
    expect(huella.turnos.map((turno) => turno.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });
});

describe('la presencia solo cuenta con alguien delante', () => {
  it('con la ventana a la vista y con el foco, cuenta', async () => {
    const huella = montar({ cierre: 'nunca', ventana: { visible: true, foco: true } });
    const respuesta = await invocar(IPC_INVOKE.vaultPresence, {});
    expect(respuesta).toEqual({ ok: true, value: { counted: true } });
    expect(huella.toques).toBe(1);
  });

  it('sin el foco no cuenta: el raton pasaba por encima', async () => {
    const huella = montar({ cierre: 'nunca', ventana: { visible: true, foco: false } });
    expect(await invocar(IPC_INVOKE.vaultPresence, {})).toEqual({
      ok: true,
      value: { counted: false },
    });
    expect(huella.toques).toBe(0);
  });

  it('con la ventana escondida en la bandeja no cuenta', async () => {
    const huella = montar({ cierre: 'nunca', ventana: { visible: false, foco: true } });
    expect(await invocar(IPC_INVOKE.vaultPresence, {})).toEqual({
      ok: true,
      value: { counted: false },
    });
    expect(huella.toques).toBe(0);
  });

  it('sin ventana no cuenta, y no admite argumentos', async () => {
    const huella = montar({ cierre: 'nunca', ventana: null });
    expect(await invocar(IPC_INVOKE.vaultPresence, {})).toEqual({
      ok: true,
      value: { counted: false },
    });
    expect(await invocar(IPC_INVOKE.vaultPresence, { inyectado: true })).toMatchObject({
      ok: false,
    });
    expect(huella.toques).toBe(0);
  });
});
