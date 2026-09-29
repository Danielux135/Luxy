// pruebas del contrato IPC y del protocolo con el proceso del agente.
//
// no arrancan Electron: comprueban las invariantes que se pueden romper sin
// darse cuenta al editar el contrato, que son justo las de seguridad.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  agentEventSchema,
  hostRequestSchema,
  hostResponseSchema,
  type RecapCoverage,
} from '@luxy/shared';
// el modulo entero, para poder barrer sus esquemas en vez de listarlos a mano
import * as ipc from './ipc.js';
import {
  IPC_EVENT,
  IPC_INVOKE,
  appInfoSchema,
  emptyArgsSchema,
  logsTailArgsSchema,
  pickFolderArgsSchema,
  stopAgentArgsSchema,
  approvalResolveArgsSchema,
  connectionTestArgsSchema,
  configSaveArgsSchema,
  secretNameSchema,
  vaultCharacterImportArgsSchema,
  vaultVisionProbeArgsSchema,
  vaultVisionProbeResultSchema,
  vaultCharacterSummarySchema,
  vaultCharacterProviderArgsSchema,
  vaultCharacterImageReviewArgsSchema,
  vaultCharacterImageCastArgsSchema,
  vaultCharacterReplyGuidanceArgsSchema,
  vaultCharacterPendingPacingArgsSchema,
  vaultHordeCharacterSaveArgsSchema,
  vaultCompatibilityArgsSchema,
  vaultCompatibilityResultSchema,
  VAULT_COMPATIBILITY_REPLY_CHARS,
  vaultMediaAttachArgsSchema,
  vaultMemoryReadArgsSchema,
  vaultRecapCoverageSchema,
  vaultImageCommitArgsSchema,
  vaultImageEstimateArgsSchema,
  vaultRecapSyncArgsSchema,
  vaultRecapSyncResultSchema,
  vaultRecapUpdateArgsSchema,
  worktreeOpenFolderArgsSchema,
  studioJobActionArgsSchema,
  studioJobsListArgsSchema,
  workspaceOpenArgsSchema,
  workspacePrepareArgsSchema,
} from './ipc.js';

describe('canales IPC', () => {
  it('todos los canales llevan el prefijo luxy:', () => {
    for (const channel of [...Object.values(IPC_INVOKE), ...Object.values(IPC_EVENT)]) {
      expect(channel.startsWith('luxy:')).toBe(true);
    }
  });

  it('no hay dos canales con el mismo nombre', () => {
    const todos = [...Object.values(IPC_INVOKE), ...Object.values(IPC_EVENT)];
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('ningun canal expone un verbo abierto', () => {
    // un canal tipo exec/run/eval reintroduciria por IPC lo que el ejecutor de
    // pruebas bloquea con su lista blanca
    const prohibidos = ['exec', 'run', 'eval', 'spawn', 'shell', 'command', 'write-file'];
    for (const channel of Object.values(IPC_INVOKE)) {
      for (const prohibido of prohibidos) {
        expect(channel.toLowerCase()).not.toContain(prohibido);
      }
    }
  });
});

describe('validacion de argumentos', () => {
  it('acepta la ausencia de argumentos donde no hacen falta', () => {
    for (const entrada of [undefined, null, {}]) {
      expect(emptyArgsSchema.safeParse(entrada).success).toBe(true);
    }
  });

  it('rechaza argumentos inesperados en los canales sin parametros', () => {
    expect(emptyArgsSchema.safeParse({ inyectado: true }).success).toBe(false);
  });

  it('aplica valores por defecto sensatos', () => {
    expect(logsTailArgsSchema.parse({}).count).toBe(120);
    expect(stopAgentArgsSchema.parse({}).reason.length).toBeGreaterThan(0);
    expect(pickFolderArgsSchema.parse({}).title.length).toBeGreaterThan(0);
  });

  it('acota el numero de lineas de log que puede pedir el renderer', () => {
    expect(logsTailArgsSchema.safeParse({ count: 0 }).success).toBe(false);
    expect(logsTailArgsSchema.safeParse({ count: 100_000 }).success).toBe(false);
    expect(logsTailArgsSchema.safeParse({ count: 500 }).success).toBe(true);
  });

  it('valida la pagina del historial que puede pedir el renderer', () => {
    expect(
      studioJobsListArgsSchema.parse({ projectAlias: 'luxy', limit: 100, offset: 200 }),
    ).toMatchObject({
      projectAlias: 'luxy',
      limit: 100,
      offset: 200,
    });
    expect(studioJobsListArgsSchema.safeParse({ projectAlias: '../otro' }).success).toBe(false);
    expect(studioJobsListArgsSchema.safeParse({ limit: 101, offset: 0 }).success).toBe(false);
    expect(studioJobsListArgsSchema.safeParse({ limit: 100, offset: -1 }).success).toBe(false);
  });

  it('el alta manual de un personaje exige el UUID del proveedor', () => {
    // lo que motivo la comprobacion: se dio de alta un identificador sacado de
    // la ruta de la URL del avatar, y el fallo no aparecio hasta tres pantallas
    // despues, dentro de una conversacion y con la foto ya prometida
    expect(
      vaultCharacterImportArgsSchema.safeParse({
        characterId: '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d',
      }).success,
    ).toBe(true);

    for (const invalido of [
      '1788339037320_4a1e227d-89b6-4393-8fe5-cbff8f95ed4c',
      'https://pub-abc.r2.dev/xavira/characters/x.webp',
      '036edeab',
      '',
    ]) {
      expect(vaultCharacterImportArgsSchema.safeParse({ characterId: invalido }).success).toBe(
        false,
      );
    }
  });

  it('un personaje de AI Horde no exige UUID ni existe en ningun servidor', () => {
    // la diferencia de fondo con el de pago: alli el identificador lo da la API
    // y aqui no hay API, asi que exigir un UUID del proveedor no tendria a quien
    // preguntarselo. Lo obligatorio es la receta, que ES el personaje
    const valido = vaultHordeCharacterSaveArgsSchema.safeParse({
      label: 'Lia',
      recipe: { models: ['Prefect Pony'], appearance: '1girl, green eyes' },
    });
    expect(valido.success).toBe(true);
    // crear manda el identificador vacio; editar manda el suyo
    expect(valido.success && valido.data.characterId).toBe('');

    // sin receta no hay personaje
    expect(vaultHordeCharacterSaveArgsSchema.safeParse({ label: 'Lia' }).success).toBe(false);
  });

  it('la receta rechaza lo que AI Horde rechazaria despues', () => {
    const base = { label: 'Lia', appearance: 'x' };
    // un lado que no es multiplo de 64 lo rechaza su API; enterarse aqui evita
    // gastar la espera de la cola para acabar en un 400
    expect(
      vaultHordeCharacterSaveArgsSchema.safeParse({
        ...base,
        recipe: { models: ['Prefect Pony'], appearance: 'x', width: 800 },
      }).success,
    ).toBe(false);
    // su tope publicado es de cinco, y cada uno cuesta kudos aparte
    expect(
      vaultHordeCharacterSaveArgsSchema.safeParse({
        ...base,
        recipe: {
          models: ['Prefect Pony'],
          appearance: 'x',
          loras: Array.from({ length: 6 }, (_, index) => ({ name: `l${index}` })),
        },
      }).success,
    ).toBe(false);
    // sin ningun modelo la peticion no tiene a quien pedirsela
    expect(
      vaultHordeCharacterSaveArgsSchema.safeParse({
        ...base,
        recipe: { models: [], appearance: 'x' },
      }).success,
    ).toBe(false);
  });

  it('un personaje sin proveedor declarado se lee como de Xavira', () => {
    // los que ya existen en una boveda son todos suyos: sin este defecto, una
    // boveda anterior dejaria de poder leer su propia lista
    const leido = vaultCharacterSummarySchema.parse({
      characterId: '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d',
      description: '',
      label: 'Una',
      avatarObjectKey: null,
      createdAt: '2026-09-02T08:50:37.000Z',
    });
    expect(leido.imageProvider).toBe('xavira');
    expect(leido.horde).toBeNull();
  });

  it('un personaje puede existir en los dos sitios a la vez', () => {
    // es lo que permite que el mismo personaje —con sus recuerdos y sus
    // conversaciones— reciba sus fotos de uno o de otro sin volver a crearlo
    const leido = vaultCharacterSummarySchema.parse({
      characterId: '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d',
      description: '',
      label: 'Lía',
      avatarObjectKey: null,
      createdAt: '2026-09-02T08:50:37.000Z',
      imageProvider: 'horde',
      xavira: { characterId: '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d', modelId: 'anime-pure-v1' },
      horde: { recipe: { models: ['Prefect Pony'], appearance: 'green eyes' } },
    });
    expect(leido.imageProvider).toBe('horde');
    expect(leido.xavira?.modelId).toBe('anime-pure-v1');
    expect(leido.horde?.recipe.models).toEqual(['Prefect Pony']);
  });

  it('cambiar de proveedor exige decir a cual, y solo eso', () => {
    // el argumento no admite tocar nada mas del personaje: cambiar de proveedor
    // no puede ser una puerta para reescribirle el nombre ni la descripcion
    expect(
      vaultCharacterProviderArgsSchema.safeParse({ characterId: 'per-1', provider: 'horde' })
        .success,
    ).toBe(true);
    expect(
      vaultCharacterProviderArgsSchema.safeParse({ characterId: 'per-1', provider: 'otro' })
        .success,
    ).toBe(false);
  });

  it('un personaje sin el ajuste de revision se lee con el puesto', () => {
    // el defecto es lo que hace que una boveda escrita antes de este campo siga
    // pintando su interruptor con un valor de verdad y no con un hueco
    const leido = vaultCharacterSummarySchema.parse({
      characterId: '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d',
      description: '',
      label: 'Lía',
      avatarObjectKey: null,
      createdAt: '2026-09-02T08:50:37.000Z',
    });
    expect(leido.imageReview).toBe('siempre');
  });

  it('el interruptor de revision solo admite sus dos valores, y solo eso', () => {
    // el mismo criterio que el proveedor: un verbo que cambia una cosa no puede
    // ser la puerta por la que se le reescribe la receta a un personaje
    expect(
      vaultCharacterImageReviewArgsSchema.safeParse({ characterId: 'per-1', review: 'nunca' })
        .success,
    ).toBe(true);
    expect(
      vaultCharacterImageReviewArgsSchema.safeParse({ characterId: 'per-1', review: 'a veces' })
        .success,
    ).toBe(false);
    // sin `review` no hay nada que decidir: el defecto vive en el almacen, no
    // en un argumento que llega a medias
    expect(vaultCharacterImageReviewArgsSchema.safeParse({ characterId: 'per-1' }).success).toBe(
      false,
    );
    expect(
      vaultCharacterImageReviewArgsSchema.safeParse({ characterId: '', review: 'nunca' }).success,
    ).toBe(false);
  });

  it('un personaje sin el ajuste de la escena se lee dibujando solo al personaje', () => {
    // el defecto es lo que hace que una boveda escrita antes de este campo siga
    // comportandose EXACTAMENTE como hoy, sin que la pantalla adivine nada
    const leido = vaultCharacterSummarySchema.parse({
      characterId: '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d',
      description: '',
      label: 'Lía',
      avatarObjectKey: null,
      createdAt: '2026-09-02T08:50:37.000Z',
    });
    expect(leido.imageCast).toBe('character-only');
  });

  it('el interruptor de la escena solo admite sus dos valores, y solo eso', () => {
    // mismo criterio que los otros dos verbos: uno que cambia una cosa no puede
    // ser la puerta por la que se le reescribe la receta a un personaje
    expect(
      vaultCharacterImageCastArgsSchema.safeParse({ characterId: 'per-1', cast: 'both' }).success,
    ).toBe(true);
    expect(
      vaultCharacterImageCastArgsSchema.safeParse({ characterId: 'per-1', cast: 'character-only' })
        .success,
    ).toBe(true);
    expect(
      vaultCharacterImageCastArgsSchema.safeParse({ characterId: 'per-1', cast: 'ambos' }).success,
    ).toBe(false);
    // sin `cast` no hay nada que decidir: el defecto vive en el almacen, no en
    // un argumento que llega a medias
    expect(vaultCharacterImageCastArgsSchema.safeParse({ characterId: 'per-1' }).success).toBe(
      false,
    );
    expect(
      vaultCharacterImageCastArgsSchema.safeParse({ characterId: '', cast: 'both' }).success,
    ).toBe(false);
  });

  it('un personaje sin las notas de direccion se lee con ellas apagadas', () => {
    // apagadas no añaden nada al prompt (`D-102`)
    const leido = vaultCharacterSummarySchema.parse({
      characterId: 'e0000000-5555-4555-8555-555555555555',
      description: '',
      label: 'Nora',
      avatarObjectKey: null,
      createdAt: '2026-09-02T08:50:37.000Z',
    });
    expect(leido.replyGuidance).toBe('none');
  });

  it('el interruptor de las notas solo admite sus dos valores', () => {
    const valido = (args: unknown) => vaultCharacterReplyGuidanceArgsSchema.safeParse(args).success;
    expect(valido({ characterId: 'per-1', guidance: 'vary-and-lead' })).toBe(true);
    expect(valido({ characterId: 'per-1', guidance: 'none' })).toBe(true);
    expect(valido({ characterId: 'per-1', guidance: 'vary' })).toBe(false);
    expect(valido({ characterId: 'per-1', guidance: true })).toBe(false);
    // sin valor no hay nada que decidir: el defecto vive en el almacen
    expect(valido({ characterId: 'per-1' })).toBe(false);
    expect(valido({ characterId: '', guidance: 'none' })).toBe(false);
  });

  it('un personaje sin el modo esporadico se lee con el apagado', () => {
    // apagado no añade nada al prompt (`D-104`)
    const leido = vaultCharacterSummarySchema.parse({
      characterId: 'e0000000-5555-4555-8555-555555555555',
      description: '',
      label: 'Nora',
      avatarObjectKey: null,
      createdAt: '2026-09-02T08:50:37.000Z',
    });
    expect(leido.pendingPacing).toBe('per-note');
  });

  it('el interruptor del modo esporadico solo admite sus dos valores', () => {
    const valido = (args: unknown) => vaultCharacterPendingPacingArgsSchema.safeParse(args).success;
    expect(valido({ characterId: 'per-1', pacing: 'sparse' })).toBe(true);
    expect(valido({ characterId: 'per-1', pacing: 'per-note' })).toBe(true);
    expect(valido({ characterId: 'per-1', pacing: 'rare' })).toBe(false);
    expect(valido({ characterId: 'per-1', pacing: true })).toBe(false);
    // sin valor no hay nada que decidir: el defecto vive en el almacen
    expect(valido({ characterId: 'per-1' })).toBe(false);
    expect(valido({ characterId: '', pacing: 'sparse' })).toBe(false);
  });

  it('el pie de foto de un adjunto es opcional y acotado', () => {
    // es lo unico que el modelo llega a saber de un archivo que no genero el:
    // no lo ve, no lo abre y no tiene ojos
    expect(
      vaultMediaAttachArgsSchema.parse({ conversationId: '4d609d37-8f3e-4558-ae82-538eb6385dda' })
        .caption,
    ).toBe('');
    expect(
      vaultMediaAttachArgsSchema.safeParse({
        conversationId: '4d609d37-8f3e-4558-ae82-538eb6385dda',
        caption: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it('la comprobacion de modelos no admite una lista sin fin ni repeticiones locas', () => {
    // cada objetivo es una llamada de verdad: sin tope, un descuido en la
    // pantalla se convierte en una tanda de cientos
    const base = {
      conversationId: '4d609d37-8f3e-4558-ae82-538eb6385dda',
      projectAlias: 'luxy',
      targets: [{ provider: 'deepseek' }],
    };
    expect(vaultCompatibilityArgsSchema.parse(base).repetitions).toBe(1);
    expect(vaultCompatibilityArgsSchema.parse(base).targets[0]?.model).toBeNull();

    expect(vaultCompatibilityArgsSchema.safeParse({ ...base, targets: [] }).success).toBe(false);
    expect(
      vaultCompatibilityArgsSchema.safeParse({
        ...base,
        targets: Array.from({ length: 13 }, () => ({ provider: 'deepseek' })),
      }).success,
    ).toBe(false);
    expect(vaultCompatibilityArgsSchema.safeParse({ ...base, repetitions: 50 }).success).toBe(
      false,
    );
  });

  it('lo que escribio cada modelo cabe en el resultado, y con tope', () => {
    // el texto es contenido de la boveda: viaja al renderer como cualquier
    // turno, pero un modelo desbocado no puede mandar por aqui lo que quiera
    const fila = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      answered: 1,
      refused: 0,
      empty: 0,
      signals: [],
      memoryOk: 1,
      error: null,
    };

    // sin `replies` sigue validando: quien no mire el texto no nota el cambio
    const viejo = vaultCompatibilityResultSchema.parse({ results: [fila] });
    expect(viejo.results[0]?.replies).toEqual([]);

    const conTexto = vaultCompatibilityResultSchema.parse({
      results: [
        {
          ...fila,
          replies: [
            {
              attempt: 1,
              kind: 'answered',
              text: 'te esperaba',
              chars: 11,
              kept: 11,
              clipped: false,
            },
          ],
        },
      ],
    });
    expect(conTexto.results[0]?.replies[0]?.attempt).toBe(1);

    const desbocada = {
      results: [
        {
          ...fila,
          replies: [
            {
              attempt: 1,
              kind: 'answered',
              text: 'x'.repeat(VAULT_COMPATIBILITY_REPLY_CHARS + 1),
              chars: 90000,
              kept: VAULT_COMPATIBILITY_REPLY_CHARS,
              clipped: true,
            },
          ],
        },
      ],
    };
    expect(vaultCompatibilityResultSchema.safeParse(desbocada).success).toBe(false);

    // y no caben mas repeticiones de las que se pueden pedir
    const demasiadas = {
      results: [
        {
          ...fila,
          replies: Array.from({ length: 6 }, (_unused, index) => ({
            attempt: 1,
            kind: 'answered',
            text: `intento ${index}`,
            chars: 10,
            kept: 10,
            clipped: false,
          })),
        },
      ],
    };
    expect(vaultCompatibilityResultSchema.safeParse(demasiadas).success).toBe(false);

    // y `kept` es obligatorio, sin valor por defecto: es lo que la pantalla
    // enseña como «Luxy guardó los primeros N», y el unico sitio donde se sabe
    // cuanto ocupa la marca del recorte es el proceso principal. Un defecto aqui
    // seria una cifra inventada con pinta de medida
    const sinKept = {
      results: [
        {
          ...fila,
          replies: [{ attempt: 1, kind: 'answered', text: 'hola', chars: 4, clipped: false }],
        },
      ],
    };
    expect(vaultCompatibilityResultSchema.safeParse(sinKept).success).toBe(false);
  });

  it('leer un recuerdo exige un rango, no una conversacion entera', () => {
    // sin rango, este canal seria una forma de volcar una conversacion completa
    // por un camino distinto al que ya existe y con otras comprobaciones
    expect(
      vaultMemoryReadArgsSchema.safeParse({
        conversationId: '4d609d37-8f3e-4558-ae82-538eb6385dda',
        from: 0,
        to: 12,
      }).success,
    ).toBe(true);
    expect(
      vaultMemoryReadArgsSchema.safeParse({
        conversationId: '4d609d37-8f3e-4558-ae82-538eb6385dda',
      }).success,
    ).toBe(false);
    expect(
      vaultMemoryReadArgsSchema.safeParse({
        conversationId: '../otra',
        from: 0,
        to: 1,
      }).success,
    ).toBe(false);
  });

  it('acota la longitud de los textos que llegan del renderer', () => {
    expect(stopAgentArgsSchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(false);
    expect(pickFolderArgsSchema.safeParse({ title: 'x'.repeat(500) }).success).toBe(false);
  });

  it('valida las rutas cerradas para abrir y preparar worktrees', () => {
    expect(
      worktreeOpenFolderArgsSchema.safeParse({ worktreePath: 'C:/Luxy/worktrees/lux-1' }).success,
    ).toBe(true);
    expect(worktreeOpenFolderArgsSchema.safeParse({ worktreePath: '' }).success).toBe(false);
    expect(worktreeOpenFolderArgsSchema.safeParse({ worktreePath: 'x'.repeat(2000) }).success).toBe(
      false,
    );
    expect(
      workspacePrepareArgsSchema.safeParse({ projectAlias: 'luxy', label: 'mi espacio' }).success,
    ).toBe(true);
    expect(workspacePrepareArgsSchema.safeParse({ projectAlias: '', label: '' }).success).toBe(
      false,
    );
    expect(workspaceOpenArgsSchema.safeParse({ path: 'C:/Luxy/worktrees/uno' }).success).toBe(true);
  });

  it('la prueba de conexion no admite una URL elegida por el renderer', () => {
    expect(connectionTestArgsSchema.safeParse({ connectionId: 'default' }).success).toBe(true);
    expect(
      connectionTestArgsSchema.safeParse({
        connectionId: 'default',
        baseUrl: 'https://atacante.example',
      }).success,
    ).toBe(false);
  });

  it('valida la clave atomica de un proveedor HTTP', () => {
    expect(
      configSaveArgsSchema.safeParse({
        config: {},
        providerSecret: { name: 'LUXY_HTTP_EXTERNO_API_KEY', value: 'clave-secreta' },
      }).success,
    ).toBe(true);
    expect(
      configSaveArgsSchema.safeParse({
        config: {},
        providerSecret: { name: '../clave', value: 'clave-secreta' },
      }).success,
    ).toBe(false);
    expect(secretNameSchema.safeParse('LUXY_HTTP_EXTERNO_API_KEY').success).toBe(true);
  });
});

describe('el relleno de la memoria de lo ya hablado', () => {
  const MINIMO = { projectAlias: 'luxy' };
  const CONV = 'aaaaaaaa-1111-4111-8111-111111111111';

  it('mira sin guardar solo cuando se pide: por defecto el relleno escribe', () => {
    // el valor por defecto decide lo que pasa cuando el renderer no dice nada.
    // Al reves —`dryRun` a true por defecto— el panel diria que ha rellenado
    // diecisiete conversaciones y no habria ni una ficha en disco
    expect(vaultRecapSyncArgsSchema.parse(MINIMO).dryRun).toBe(false);
    expect(vaultRecapSyncArgsSchema.parse({ ...MINIMO, dryRun: true }).dryRun).toBe(true);
  });

  it('la tanda son dos conversaciones, no tres como la de pendientes', () => {
    // aqui una sola conversacion puede gastar varias llamadas: una ventana por
    // cada cuarenta turnos. Es `RECAP_DEFAULT_LIMIT`, que vive en la pasada
    expect(vaultRecapSyncArgsSchema.parse(MINIMO).limit).toBe(2);
    expect(vaultRecapSyncArgsSchema.parse(MINIMO).force).toBe(false);
  });

  it('acota la tanda y el proyecto que puede pedir el renderer', () => {
    expect(vaultRecapSyncArgsSchema.safeParse({ ...MINIMO, limit: 0 }).success).toBe(false);
    expect(vaultRecapSyncArgsSchema.safeParse({ ...MINIMO, limit: 11 }).success).toBe(false);
    expect(vaultRecapSyncArgsSchema.safeParse({ projectAlias: '../otro' }).success).toBe(false);
  });

  it('rehacer una sola conversacion exige su UUID, no un nombre', () => {
    expect(vaultRecapSyncArgsSchema.safeParse({ ...MINIMO, conversationId: CONV }).success).toBe(
      true,
    );
    expect(
      vaultRecapSyncArgsSchema.safeParse({ ...MINIMO, conversationId: 'la de agosto' }).success,
    ).toBe(false);
  });

  it('no lleva proveedor: el trabajo de fondo nunca sale por la API de la ventana', () => {
    // si el renderer pudiera elegir a quien se le manda, un descuido costaria
    // una llamada cobrada POR VENTANA sobre la boveda entera
    expect(Object.keys(vaultRecapSyncArgsSchema.shape)).not.toContain('provider');
    expect(Object.keys(vaultRecapSyncArgsSchema.shape)).not.toContain('model');
  });

  it('el resultado separa los cinco finales de una ventana en vez de mezclarlos', () => {
    // mezclar negativa, ficha ilegible y ficha vacia en un solo contador es el
    // defecto que ya tiene la pasada de pendientes: el arreglo de cada uno es
    // distinto, y con un numero solo no se sabe que boton pulsar
    const campos = Object.keys(vaultRecapSyncResultSchema.shape);
    for (const campo of ['ok', 'partial', 'refused', 'vague', 'invalid', 'failed', 'deduced']) {
      expect(campos).toContain(campo);
    }
  });

  it('sin vistazo, el resultado no lleva ni un texto de la boveda', () => {
    const parsed = vaultRecapSyncResultSchema.parse({
      reviewed: 1,
      windows: 1,
      ok: 1,
      partial: 0,
      deduced: 0,
      refused: 0,
      vague: 0,
      invalid: 0,
      failed: [],
      superseded: 0,
      gaps: 0,
      clipped: 0,
      kept: 0,
      rewritten: 0,
      dropped: 0,
      added: 0,
      chars: 342,
      pending: 16,
      provider: 'codex',
      replaced: false,
    });
    expect(parsed.preview).toEqual([]);
  });

  it('la linea de cobertura que cruza el IPC es la que calcula `recapCoverage`', () => {
    // el literal va anotado a proposito: si alguna vez se renombra un campo alla,
    // esto deja de compilar en vez de enseñar un cero donde habia diecisiete
    const calculada: RecapCoverage = {
      total: 18,
      excluded: 0,
      summarized: 9,
      withGaps: 3,
      indexOnly: 2,
      // escritas y esperando el visto bueno: NO es lo mismo que no tener nada,
      // y contarlas juntas hacia que la linea dijera «17 sin leer» justo despues
      // de la pasada que escribio las diecisiete
      awaitingApproval: 2,
      missing: 1,
      sealed: 1,
    };

    const parsed = vaultRecapCoverageSchema.parse(calculada);
    expect(parsed).toEqual(calculada);
    // y los numeros SUMAN: si no cuadra es un fallo, no un redondeo
    const suma =
      parsed.summarized +
      parsed.withGaps +
      parsed.indexOnly +
      parsed.awaitingApproval +
      parsed.missing +
      parsed.sealed;
    expect(suma).toBe(parsed.total - parsed.excluded);
  });

  it('aprobarlas todas no puede llevar una conversacion que nadie mire', () => {
    // seria un boton que dice una cosa y hace otra
    expect(vaultRecapUpdateArgsSchema.safeParse({ action: 'approve-all' }).success).toBe(true);
    expect(
      vaultRecapUpdateArgsSchema.safeParse({ action: 'approve-all', conversationId: CONV }).success,
    ).toBe(false);
  });

  it('aprobar y borrar exigen decir cual', () => {
    expect(
      vaultRecapUpdateArgsSchema.safeParse({ action: 'approve', conversationId: CONV }).success,
    ).toBe(true);
    expect(
      vaultRecapUpdateArgsSchema.safeParse({ action: 'forget', conversationId: CONV }).success,
    ).toBe(true);
    expect(vaultRecapUpdateArgsSchema.safeParse({ action: 'approve' }).success).toBe(false);
    expect(vaultRecapUpdateArgsSchema.safeParse({ action: 'forget' }).success).toBe(false);
  });

  it('no hay edicion libre del texto por IPC', () => {
    // la v1 no edita: «Borrarlo» y «Rehacerlo con el otro CLI» cubren el caso.
    // Un verbo que aceptara texto seria una ficha escrita a mano sin nada
    // contra lo que comprobarse, y se propagaria a cada turno futuro del hilo
    expect(
      vaultRecapUpdateArgsSchema.safeParse({ action: 'edit', conversationId: CONV }).success,
    ).toBe(false);
    expect(
      vaultRecapUpdateArgsSchema.safeParse({
        action: 'approve',
        conversationId: CONV,
        summary: 'lo que yo diga',
      }).success,
    ).toBe(false);
  });
});

describe('la decision sobre una imagen que estaba esperando', () => {
  const CONV = 'aaaaaaaa-1111-4111-8111-111111111111';
  const INTENTO = 'bbbbbbbb-2222-4222-8222-222222222222';

  it('generar admite mandarlo tal cual, y `edit` ausente significa eso mismo', () => {
    const parsed = vaultImageCommitArgsSchema.parse({
      action: 'generate',
      conversationId: CONV,
      attemptId: INTENTO,
    });
    expect(parsed).toEqual({
      action: 'generate',
      conversationId: CONV,
      attemptId: INTENTO,
      edit: null,
    });
  });

  it('DESCARTAR NO PUEDE LLEVAR TEXTO: sin strict, el boton diria una cosa y haria otra', () => {
    // el mismo argumento escrito en `vaultRecapUpdateArgsSchema`. Aqui un campo
    // que se descarta en silencio se paga en kudos
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'discard',
        conversationId: CONV,
        attemptId: INTENTO,
      }).success,
    ).toBe(true);
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'discard',
        conversationId: CONV,
        attemptId: INTENTO,
        edit: { provider: 'horde', positive: 'lo que sea', negative: '' },
      }).success,
    ).toBe(false);
  });

  it('un campo de mas en generar se rechaza en vez de perderse', () => {
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'generate',
        conversationId: CONV,
        attemptId: INTENTO,
        edit: null,
        // los parametros no se editan a mano: si algun dia se editan, que se
        // vea aqui y no en una imagen del tamaño equivocado
        seed: '1080257389',
      }).success,
    ).toBe(false);
  });

  it('un campo de mas DENTRO de `edit` tampoco se pierde', () => {
    // el `strict` de fuera no cubria el objeto anidado, que es justo el que
    // lleva el texto que se paga. Una semilla escrita ahi es lo primero que uno
    // intenta al verla en el panel: si se tirase en silencio, la imagen saldria
    // con otra y nadie lo diria
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'generate',
        conversationId: CONV,
        attemptId: INTENTO,
        edit: { provider: 'horde', positive: 'from behind', negative: '', seed: '1080257389' },
      }).success,
    ).toBe(false);
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'generate',
        conversationId: CONV,
        attemptId: INTENTO,
        edit: { provider: 'xavira', prompt: 'from behind', negativeAppend: 'borroso' },
      }).success,
    ).toBe(false);
    // y el precio se pregunta por el MISMO objeto: la regla no puede aflojarse
    // ahi, o se estimaria una cosa y se mandaria otra
    expect(
      vaultImageEstimateArgsSchema.safeParse({
        conversationId: CONV,
        attemptId: INTENTO,
        edit: { provider: 'horde', positive: 'from behind', negative: '', seed: '1080257389' },
      }).success,
    ).toBe(false);
  });

  it('el intento se nombra por su identificador, no por su posicion', () => {
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'generate',
        conversationId: CONV,
        attemptId: 'el-ultimo',
      }).success,
    ).toBe(false);
  });

  it('el positivo tiene tope, y el tope es el del plan', () => {
    const cabe = (positive: string): boolean =>
      vaultImageCommitArgsSchema.safeParse({
        action: 'generate',
        conversationId: CONV,
        attemptId: INTENTO,
        edit: { provider: 'horde', positive, negative: '' },
      }).success;
    expect(cabe('x'.repeat(6000))).toBe(true);
    expect(cabe('x'.repeat(6001))).toBe(false);
  });

  it('una correccion a medias no pasa: el proveedor manda sobre los campos', () => {
    // con el proveedor de pago no hay positivo ni negativo separados, y con el
    // horde no hay un `prompt` suelto. Mezclarlos seria mandar la mitad
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'generate',
        conversationId: CONV,
        attemptId: INTENTO,
        edit: { provider: 'horde', prompt: 'from behind' },
      }).success,
    ).toBe(false);
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'generate',
        conversationId: CONV,
        attemptId: INTENTO,
        edit: { provider: 'xavira', prompt: 'from behind' },
      }).success,
    ).toBe(true);
  });

  it('preguntar el precio pregunta por el MISMO texto que se mandaria', () => {
    // si el presupuesto se pidiera sobre el compuesto y se mandara el corregido,
    // el numero de la pantalla seria de otra imagen
    const parsed = vaultImageEstimateArgsSchema.parse({
      conversationId: CONV,
      attemptId: INTENTO,
      edit: { provider: 'horde', positive: 'from behind', negative: 'blurry' },
    });
    expect(parsed.edit).toEqual({
      provider: 'horde',
      positive: 'from behind',
      negative: 'blurry',
    });
    expect(
      vaultImageEstimateArgsSchema.safeParse({
        conversationId: CONV,
        attemptId: INTENTO,
        dryRun: false,
      }).success,
    ).toBe(false);
  });

  it('un medio sellado antes del registro sale con `attemptId: null`', () => {
    // el enlace con el intento se añadio despues, y el proceso principal lo
    // rellena desde el sobre del medio: todo lo guardado antes no lo trae y el
    // visor tiene que abrirse igual, solo que sin semilla ni worker
    const parsed = ipc.vaultMediaItemSchema.parse({
      mediaId: 'medio-1',
      mimeType: 'image/webp',
      displayName: null,
      byteSize: 0,
      hasThumbnail: false,
      previewable: true,
    });
    expect(parsed.attemptId).toBeNull();
    expect(
      ipc.vaultMediaItemSchema.parse({
        mediaId: 'medio-1',
        mimeType: 'image/webp',
        displayName: null,
        byteSize: 0,
        hasThumbnail: false,
        previewable: true,
        attemptId: INTENTO,
      }).attemptId,
    ).toBe(INTENTO);
  });
});

describe('informacion de la aplicacion', () => {
  it('no incluye ningun campo que pueda contener un secreto', () => {
    const campos = Object.keys(appInfoSchema.shape);
    for (const campo of campos) {
      expect(/key|token|secret|password|clave/i.test(campo)).toBe(false);
    }
  });

  it('solo dice si el cifrado esta disponible, nunca una clave', () => {
    const info = appInfoSchema.parse({
      appVersion: '0.1.0',
      electronVersion: '43.2.0',
      nodeVersion: '22.0.0',
      platform: 'win32',
      hostname: 'DESKTOP-PRUEBA',
      logsDirectory: 'C:\\datos\\logs',
      encryptionAvailable: true,
      agentBuild: 'a1b2c3d4e5f6@2026-07-29T11:00',
    });
    expect(typeof info.encryptionAvailable).toBe('boolean');
    // la huella identifica que build del agente corre, no es un secreto
    expect(info.agentBuild).not.toMatch(/sk-|token/i);
  });

  it('expone la huella del agente para detectar una instalacion vieja', () => {
    // se añadio despues de regenerar el instalador sin reinstalarlo: la
    // aplicacion seguia con el agente antiguo y el fallo "arreglado" volvia
    expect(Object.keys(appInfoSchema.shape)).toContain('agentBuild');
    const sinArrancar = appInfoSchema.parse({
      appVersion: '0.1.0',
      electronVersion: '43.2.0',
      nodeVersion: '22.0.0',
      platform: 'win32',
      hostname: 'DESKTOP-PRUEBA',
      logsDirectory: 'C:/datos/logs',
      encryptionAvailable: true,
      agentBuild: null,
    });
    expect(sinArrancar.agentBuild).toBeNull();
  });
});

describe('protocolo con el proceso del agente', () => {
  it('acepta una orden bien formada', () => {
    expect(hostRequestSchema.safeParse({ type: 'start', requestId: 'abc' }).success).toBe(true);
  });

  it('rechaza una orden desconocida', () => {
    expect(hostRequestSchema.safeParse({ type: 'ejecutar', requestId: 'abc' }).success).toBe(false);
  });

  it('rechaza una orden sin identificador de peticion', () => {
    // sin requestId la respuesta no se podria correlacionar y quedaria colgada
    expect(hostRequestSchema.safeParse({ type: 'start' }).success).toBe(false);
  });

  it('acota el motivo de parada', () => {
    const largo = { type: 'stop', requestId: 'a', reason: 'x'.repeat(500) };
    expect(hostRequestSchema.safeParse(largo).success).toBe(false);
  });

  it('valida las respuestas del agente', () => {
    expect(hostResponseSchema.safeParse({ type: 'ready' }).success).toBe(true);
    expect(
      hostResponseSchema.safeParse({
        type: 'ack',
        requestId: 'a',
        ok: true,
        error: null,
        status: { runState: 'running', agent: null, lastError: null },
      }).success,
    ).toBe(true);
  });

  it('transporta el worktree preparado en el ack correlacionado', () => {
    expect(
      hostResponseSchema.safeParse({
        type: 'ack',
        requestId: 'preparar-1',
        ok: true,
        error: null,
        status: null,
        workspace: {
          projectAlias: 'luxy',
          path: 'C:/Luxy/worktrees/uno',
          branch: 'luxy/lux-abcd-mi-espacio',
        },
      }).success,
    ).toBe(true);
  });

  it('rechaza una respuesta con un estado de ejecucion invalido', () => {
    expect(
      hostResponseSchema.safeParse({
        type: 'ack',
        requestId: 'a',
        ok: true,
        error: null,
        status: { runState: 'explotando', agent: null, lastError: null },
      }).success,
    ).toBe(false);
  });

  it('rechaza un evento que no cumple el contrato', () => {
    expect(hostResponseSchema.safeParse({ type: 'event', event: { type: 'raro' } }).success).toBe(
      false,
    );
  });

  it('deja pasar un evento valido', () => {
    const evento = { type: 'gateway.connected', at: new Date().toISOString() };
    expect(agentEventSchema.safeParse(evento).success).toBe(true);
    expect(hostResponseSchema.safeParse({ type: 'event', event: evento }).success).toBe(true);
  });
});

describe('aprobaciones desde el escritorio', () => {
  it('acepta una peticion bien formada', () => {
    const parsed = approvalResolveArgsSchema.safeParse({
      jobId: 'job-1',
      shortId: 'LUX-A1B2',
      action: 'commit',
      projectAlias: 'demo',
      worktreePath: 'C:/datos/worktrees/lux-a1b2',
      branch: 'luxy/lux-a1b2-x',
    });
    expect(parsed.success).toBe(true);
    // por defecto NO hay doble confirmacion: el push tendra que pedirla
    expect(parsed.data?.confirmedTwice).toBe(false);
  });

  it('rechaza una accion que no existe', () => {
    expect(
      approvalResolveArgsSchema.safeParse({
        jobId: 'j',
        shortId: 's',
        action: 'force_push',
        projectAlias: 'demo',
        worktreePath: 'C:/x',
        branch: 'b',
      }).success,
    ).toBe(false);
  });

  it('acota las rutas y los textos que llegan del renderer', () => {
    const base = {
      jobId: 'j',
      shortId: 's',
      action: 'commit' as const,
      projectAlias: 'demo',
      branch: 'b',
    };
    expect(
      approvalResolveArgsSchema.safeParse({ ...base, worktreePath: 'x'.repeat(2000) }).success,
    ).toBe(false);
    expect(
      approvalResolveArgsSchema.safeParse({
        ...base,
        worktreePath: 'C:/x',
        message: 'y'.repeat(1000),
      }).success,
    ).toBe(false);
  });
});

describe('decisiones desde Studio', () => {
  const jobId = '11111111-1111-4111-8111-111111111111';

  it('exige confirmacion explicita para aplicar o descartar', () => {
    expect(
      studioJobActionArgsSchema.safeParse({ jobId, action: 'commit', confirmed: true }).success,
    ).toBe(true);
    expect(
      studioJobActionArgsSchema.safeParse({ jobId, action: 'discard', confirmed: false }).success,
    ).toBe(false);
  });

  it('no expone push en el contrato de Studio', () => {
    expect(
      studioJobActionArgsSchema.safeParse({ jobId, action: 'push', confirmed: true }).success,
    ).toBe(false);
  });
});

describe('protocolo de aprobacion con el agente', () => {
  it('el mensaje de aprobacion cumple el contrato del host', () => {
    expect(
      hostRequestSchema.safeParse({
        type: 'approval',
        requestId: 'r1',
        approval: {
          jobId: 'j',
          shortId: 'LUX-1',
          action: 'push',
          projectAlias: 'demo',
          worktreePath: 'C:/wt',
          branch: 'luxy/x',
          confirmedTwice: true,
        },
      }).success,
    ).toBe(true);
  });

  it('rechaza una aprobacion sin worktree', () => {
    expect(
      hostRequestSchema.safeParse({
        type: 'approval',
        requestId: 'r1',
        approval: { jobId: 'j', shortId: 's', action: 'commit', projectAlias: 'demo', branch: 'b' },
      }).success,
    ).toBe(false);
  });

  it('el evento de aprobacion resuelta cumple el contrato', () => {
    expect(
      agentEventSchema.safeParse({
        type: 'approval.resolved',
        at: new Date().toISOString(),
        jobId: 'j',
        shortId: 'LUX-1',
        action: 'commit',
        ok: true,
        message: 'commit creado',
      }).success,
    ).toBe(true);
  });

  it('job.completed lleva worktree y rama para poder aprobar', () => {
    // sin ellos, el escritorio no sabria sobre que actuar
    const evento = {
      type: 'job.completed',
      at: new Date().toISOString(),
      jobId: 'j',
      shortId: 'LUX-1',
      summary: 'hecho',
      filesChanged: 2,
      testsPassed: 3,
      testsFailed: 0,
      durationMs: 100,
      worktreePath: 'C:/wt',
      branch: 'luxy/x',
      projectAlias: 'demo',
    };
    expect(agentEventSchema.safeParse(evento).success).toBe(true);
    const { worktreePath: _sin, ...incompleto } = evento;
    expect(agentEventSchema.safeParse(incompleto).success).toBe(false);
  });
});

describe('banco de pruebas de vision', () => {
  it('el modelo es opcional: sin elegir manda el de la conexion', () => {
    const valido = vaultVisionProbeArgsSchema.safeParse({
      provider: 'mistral',
      projectAlias: 'luxy-test',
    });
    expect(valido.success && valido.data.model).toBeNull();
  });

  it('exige proveedor y proyecto: sin ellos no hay a quien preguntarle', () => {
    expect(vaultVisionProbeArgsSchema.safeParse({ projectAlias: 'luxy-test' }).success).toBe(false);
    expect(vaultVisionProbeArgsSchema.safeParse({ provider: 'mistral' }).success).toBe(false);
  });

  it('NO admite una ruta de archivo del renderer', () => {
    // el archivo lo elige el usuario en un dialogo del proceso principal: si el
    // renderer pudiera nombrar la ruta, podria pedir que se leyera cualquier
    // cosa del disco y se enviara a un proveedor
    const conRuta = vaultVisionProbeArgsSchema.safeParse({
      provider: 'mistral',
      projectAlias: 'luxy-test',
      filePath: 'C:/Users/oscar/.ssh/id_rsa',
    });
    expect(conRuta.success && 'filePath' in conRuta.data).toBe(false);
  });

  it('cancelar el dialogo es un resultado valido, no un error', () => {
    const cancelado = vaultVisionProbeResultSchema.safeParse({
      cancelled: true,
      fileName: null,
      mimeType: null,
      byteSize: 0,
      dataUrl: null,
      caption: null,
      failure: null,
      error: null,
      executedModel: null,
    });
    expect(cancelado.success).toBe(true);
  });

  it('distingue no contestar de negarse, y las dos de que la llamada falle', () => {
    for (const failure of ['vacio', 'negativa', 'fallo', null]) {
      const resultado = vaultVisionProbeResultSchema.safeParse({
        cancelled: false,
        fileName: 'foto.webp',
        mimeType: 'image/webp',
        byteSize: 1234,
        dataUrl: null,
        caption: null,
        failure,
        // un turno FALLIDO se contaba como «no contestó nada»: eso pedía
        // repetir algo que no puede funcionar y escondía el motivo real
        error: failure === 'fallo' ? 'HTTP 400 del proveedor' : null,
        executedModel: 'mistral-small-latest',
      });
      expect(resultado.success).toBe(true);
    }
    expect(
      vaultVisionProbeResultSchema.safeParse({
        cancelled: false,
        fileName: 'foto.webp',
        mimeType: 'image/webp',
        byteSize: 1,
        dataUrl: null,
        caption: null,
        failure: 'lo-que-sea',
        error: null,
        executedModel: null,
      }).success,
    ).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// donde se elige un modelo, se elige el esfuerzo
// -----------------------------------------------------------------------------

/**
 * la regla, ejecutable en vez de escrita en un documento.
 *
 * Este fallo ha ocurrido TRES veces en este proyecto, siempre igual: se anade
 * un ajuste, se cablea en el camino que se tenia delante, y los demas se quedan
 * sin el sin que nada lo diga. Con el modelo lo documenta `job-runner.ts`
 * —«antes solo se le pasaba a claude»—. Con el esfuerzo lo encontro Daniel: el
 * banco de pruebas de vision se habia quedado fuera, y con el otros cuatro
 * caminos.
 *
 * Lo que no se puede es confiar en acordarse. Asi que la regla se comprueba:
 * **todo esquema de ARGUMENTOS que deje elegir proveedor y modelo tiene que
 * dejar elegir tambien el esfuerzo.** Si alguien anade un camino nuevo y se
 * olvida, esto falla y le dice por que.
 *
 * Se mira sobre `ipc` entero y no sobre una lista escrita a mano, justamente
 * para que un esquema NUEVO entre solo. Una lista habria que acordarse de
 * actualizarla, que es el problema que esto viene a resolver.
 */
describe('la cuenta de AI Horde que llega a la pantalla', () => {
  const cuenta = {
    username: 'daniel#123',
    kudos: 25,
    concurrency: 3,
    anonymous: false,
    pseudonymous: false,
    service: false,
  };

  it('el desglose viaja con las ocho casillas, no solo el total', () => {
    // el total es un numero clavado que no explica nada; las ocho casillas
    // dicen por donde ha entrado y por donde no ha entrado nunca
    const parsed = ipc.vaultHordeAccountResultSchema.parse({
      ...cuenta,
      kudosDetails: {
        accumulated: -812.5,
        gifted: 0,
        donated: 0,
        admin: 0,
        received: 0,
        recurring: 0,
        awarded: 0,
        styled: 0,
      },
    });

    expect(Object.keys(ipc.vaultHordeKudosDetailsSchema.shape)).toEqual([
      'accumulated',
      'gifted',
      'donated',
      'admin',
      'received',
      'recurring',
      'awarded',
      'styled',
    ]);
    expect(parsed.kudosDetails?.accumulated).toBe(-812.5);
  });

  it('sin desglose la pantalla sigue teniendo el total', () => {
    // es el caso de un servidor que deja de mandarlo: se pierde el detalle, no
    // el dato por el que se pulso el boton
    const parsed = ipc.vaultHordeAccountResultSchema.parse({ ...cuenta, kudosDetails: null });
    expect(parsed.kudos).toBe(25);
    expect(parsed.kudosDetails).toBeNull();
  });

  it('una casilla puede ser null, y eso NO es un cero', () => {
    // la diferencia es que un 0 afirma «por ahi no ha entrado nada» y el null
    // no afirma nada. El contrato tiene que poder distinguirlas
    const parsed = ipc.vaultHordeAccountResultSchema.parse({
      ...cuenta,
      kudosDetails: {
        accumulated: -812.5,
        gifted: null,
        donated: null,
        admin: null,
        received: null,
        recurring: null,
        awarded: 0,
        styled: null,
      },
    });
    expect(parsed.kudosDetails?.awarded).toBe(0);
    expect(parsed.kudosDetails?.styled).toBeNull();
  });

  it('el desglose no es opcional en el contrato: se manda o se declara ausente', () => {
    // omitirlo dejaria a la pantalla sin saber si es que no vino o si es que
    // nadie se acordo de pasarlo. `null` lo dice; la ausencia no
    const sinDesglose: Record<string, unknown> = { ...cuenta };
    expect(ipc.vaultHordeAccountResultSchema.safeParse(sinDesglose).success).toBe(false);
  });

  it('el tipo de cuenta llega declarado, no deducido del saldo', () => {
    // con 25 kudos se venia diciendo «cuenta de Google, Discord o GitHub»
    // mirando solo el numero. El horde lo declara en esta misma respuesta
    const parsed = ipc.vaultHordeAccountResultSchema.parse({
      ...cuenta,
      kudosDetails: null,
      pseudonymous: true,
    });
    expect(parsed.pseudonymous).toBe(true);
    expect(parsed.service).toBe(false);
  });

  it('sin tipo de cuenta el contrato dice null, y null NO es false', () => {
    // false afirma «se registro por OAuth»; null no afirma nada. Confundirlos
    // es exactamente volver a adivinar el tipo de cuenta
    const parsed = ipc.vaultHordeAccountResultSchema.parse({
      ...cuenta,
      kudosDetails: null,
      pseudonymous: null,
      service: null,
    });
    expect(parsed.pseudonymous).toBeNull();
    expect(parsed.service).toBeNull();
  });

  it('el tipo de cuenta tampoco es opcional: se manda o se declara ausente', () => {
    // mismo motivo que el desglose: omitirlo no se distingue de un olvido
    const sinTipo: Record<string, unknown> = { ...cuenta, kudosDetails: null };
    delete sinTipo['pseudonymous'];
    expect(ipc.vaultHordeAccountResultSchema.safeParse(sinTipo).success).toBe(false);
  });
});

describe('donde se elige un modelo, se elige el esfuerzo', () => {
  /** los esquemas de argumentos que dejan elegir proveedor Y modelo */
  function esquemasConModelo(): [string, z.ZodRawShape][] {
    const encontrados: [string, z.ZodRawShape][] = [];
    for (const [nombre, valor] of Object.entries(ipc)) {
      if (!nombre.endsWith('ArgsSchema')) continue;
      if (!(valor instanceof z.ZodObject)) continue;
      const shape = valor.shape as z.ZodRawShape;
      if (shape['provider'] === undefined || shape['model'] === undefined) continue;
      encontrados.push([nombre, shape]);
    }
    return encontrados;
  }

  it('encuentra los esquemas de verdad, no una lista vacia', () => {
    // sin esto la prueba pasaria sola si el barrido dejara de encontrar nada,
    // que es la forma mas silenciosa de que una invariante deje de comprobarse
    const nombres = esquemasConModelo().map(([nombre]) => nombre);
    expect(nombres.length).toBeGreaterThanOrEqual(4);
    expect(nombres).toContain('vaultVisionProbeArgsSchema');
    expect(nombres).toContain('vaultCatalogSyncArgsSchema');
  });

  it('todos dejan elegir tambien el esfuerzo', () => {
    const sinEsfuerzo = esquemasConModelo()
      .filter(([, shape]) => shape['effort'] === undefined)
      .map(([nombre]) => nombre);
    expect(sinEsfuerzo).toEqual([]);
  });

  // la comparativa es la excepcion de FORMA, no de fondo: su modelo va dentro
  // de cada candidato, asi que su esfuerzo tambien
  it('y en la comparativa va dentro del candidato, con el modelo', () => {
    const targets = ipc.vaultCompatibilityArgsSchema.shape.targets;
    const candidato = targets.element as z.ZodObject<z.ZodRawShape>;
    expect(Object.keys(candidato.shape)).toContain('effort');
  });
});
