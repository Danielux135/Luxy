import { describe, it, expect } from 'vitest';
import {
  formatAutoLockOption,
  formatLockCountdown,
  imageCostOutcome,
  imageOriginSnapshot,
  pendingImageCard,
  windowAfterImageCommit,
  type ImageOrigin,
  type VaultController,
} from './useVault.js';
import {
  vaultChangePasswordArgsSchema,
  vaultCreateResultSchema,
  vaultImageCommitArgsSchema,
  vaultImageEstimateArgsSchema,
  vaultStatusSchema,
  vaultUnlockArgsSchema,
} from '../shared/ipc.js';
import { composeHordeImagePlan, imageAttemptSchema, imagePlanEditFrom } from '@luxy/shared';
import type { HordeRecipe, ImageAttempt } from '@luxy/shared';

describe('cuenta atras del bloqueo', () => {
  it('en minutos cuando falta mas de uno', () => {
    expect(formatLockCountdown(5 * 60_000)).toBe('se cerrará sola en 5 min');
    expect(formatLockCountdown(61_000)).toBe('se cerrará sola en 1 min');
  });

  it('en segundos en el ultimo minuto', () => {
    expect(formatLockCountdown(45_000)).toBe('se cerrará sola en 45 s');
    expect(formatLockCountdown(0)).toBe('se cerrará sola en 0 s');
  });

  it('no dice nada si la boveda esta cerrada', () => {
    expect(formatLockCountdown(null)).toBeNull();
  });
});

describe('etiquetas del bloqueo automatico', () => {
  it('minutos, horas y desactivado', () => {
    expect(formatAutoLockOption(1)).toBe('1 minutos de inactividad');
    expect(formatAutoLockOption(30)).toBe('30 minutos de inactividad');
    expect(formatAutoLockOption(60)).toBe('1 hora de inactividad');
    expect(formatAutoLockOption(240)).toBe('4 horas de inactividad');
    // el 0 no se muestra como "0 minutos", que seria justo lo contrario
    expect(formatAutoLockOption(0)).toBe('No cerrarla sola');
  });
});

describe('contrato IPC de la boveda', () => {
  it('el estado no admite material criptografico', () => {
    const parsed = vaultStatusSchema.parse({
      configured: true,
      unlocked: true,
      methods: { password: true, recovery: true, device: false },
      autoLockMinutes: 5,
      lockingInMs: 120_000,
      account: {
        email: 'daniel@example.com',
        signedIn: true,
        expiresAt: null,
        openedWithRecoveryKey: false,
      },
      mediaProviderConfigured: true,
      hordeConfigured: true,
      hordeAnonymous: false,
      // lo que alguien pudiera intentar colar de vuelta al renderer
      masterKey: 'AAAA',
      salt: 'BBBB',
      sessionToken: 'CCCC',
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('AAAA');
    expect(serialized).not.toContain('BBBB');
    // el token de sesion es una credencial reutilizable: tampoco cruza el IPC
    expect(serialized).not.toContain('CCCC');
    expect(Object.keys(parsed).sort()).toEqual([
      'account',
      'autoLockMinutes',
      'configured',
      // el hecho de que haya clave, nunca la clave; y si es la anonima, porque
      // esa comparte lo que genera y hay que poder avisarlo
      'hordeAnonymous',
      'hordeConfigured',
      'lockingInMs',
      'mediaProviderConfigured',
      'methods',
      'unlocked',
    ]);
  });

  it('desbloquear con el equipo no necesita secreto', () => {
    expect(vaultUnlockArgsSchema.safeParse({ method: 'device' }).success).toBe(true);
  });

  it('desbloquear con contraseña acepta el secreto', () => {
    expect(
      vaultUnlockArgsSchema.safeParse({ method: 'password', secret: 'una frase larga' }).success,
    ).toBe(true);
  });

  it('rechaza un metodo inventado', () => {
    expect(vaultUnlockArgsSchema.safeParse({ method: 'huella', secret: 'x' }).success).toBe(false);
  });

  it('rechaza un secreto vacio', () => {
    expect(vaultUnlockArgsSchema.safeParse({ method: 'password', secret: '' }).success).toBe(false);
  });

  it('cambiar contraseña exige las dos', () => {
    expect(
      vaultChangePasswordArgsSchema.safeParse({ currentPassword: 'a', newPassword: 'b' }).success,
    ).toBe(true);
    expect(vaultChangePasswordArgsSchema.safeParse({ newPassword: 'b' }).success).toBe(false);
  });

  it('la clave de recuperacion solo aparece al crear', () => {
    const parsed = vaultCreateResultSchema.parse({
      status: {
        configured: true,
        unlocked: true,
        methods: { password: true, recovery: true, device: false },
        autoLockMinutes: 5,
        lockingInMs: 300_000,
        account: {
          email: null,
          signedIn: false,
          expiresAt: null,
          openedWithRecoveryKey: false,
        },
        mediaProviderConfigured: false,
        hordeConfigured: false,
        hordeAnonymous: false,
      },
      recoveryKey: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ23-4567-89AB',
    });
    expect(parsed.recoveryKey).toContain('ABCD');
    // y no esta en el esquema de estado, que es el que se pide continuamente
    expect(vaultStatusSchema.safeParse(parsed).success).toBe(false);
  });
});

describe('lo que manda el panel de revision de imagen', () => {
  const CONVERSACION = '11111111-2222-4333-8444-555555555555';
  const INTENTO = '99999999-8888-4777-8666-555555555555';

  const receta: HordeRecipe = {
    models: ['AlbedoBase XL (SDXL)'],
    appearance: 'light brown hair, green eyes',
    outfit: 'white shirt',
    negative: 'blurry',
    width: 896,
    height: 1152,
    steps: 30,
    cfgScale: 7,
    samplerName: 'k_euler_a',
    scheduler: 'karras',
    clipSkip: 2,
    seed: null,
    loras: [],
    hiresFix: false,
    postProcessing: [],
    promptStyle: 'tags',
    denoisingStrength: 0.45,
    shared: false,
  };

  it('generar sin tocar nada manda `edit: null`, que significa «tal y como lo compusiste»', () => {
    const parsed = vaultImageCommitArgsSchema.safeParse({
      action: 'generate',
      conversationId: CONVERSACION,
      attemptId: INTENTO,
      edit: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('el texto corregido que saca el panel del plan vale como correccion', () => {
    // `imagePlanEditFrom` es lo que rellena los dos cuadros de texto: si lo que
    // saca de ahi no validara contra el contrato, el boton fallaria con un error
    // de esquema, que no le dice nada a nadie
    const plan = composeHordeImagePlan({
      recipe: receta,
      scene: 'sitting by the window',
      extraNegative: 'extra fingers',
    });
    const parsed = vaultImageCommitArgsSchema.safeParse({
      action: 'generate',
      conversationId: CONVERSACION,
      attemptId: INTENTO,
      edit: imagePlanEditFrom(plan),
    });
    expect(parsed.success).toBe(true);
  });

  it('el plan entero NO se puede mandar de vuelta: solo el texto', () => {
    // la huella y los parametros se leen del registro cifrado en el proceso
    // principal. Un `planId` que llegue de esta ventana no se lo cree nadie, y
    // sin `strict` se habria colado en silencio
    const plan = composeHordeImagePlan({
      recipe: receta,
      scene: 'sitting by the window',
      extraNegative: '',
    });
    const parsed = vaultImageCommitArgsSchema.safeParse({
      action: 'generate',
      conversationId: CONVERSACION,
      attemptId: INTENTO,
      edit: imagePlanEditFrom(plan),
      planId: plan.planId,
    });
    expect(parsed.success).toBe(false);
  });

  it('descartar no lleva correccion', () => {
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'discard',
        conversationId: CONVERSACION,
        attemptId: INTENTO,
      }).success,
    ).toBe(true);
    expect(
      vaultImageCommitArgsSchema.safeParse({
        action: 'discard',
        conversationId: CONVERSACION,
        attemptId: INTENTO,
        edit: null,
      }).success,
    ).toBe(false);
  });

  it('preguntar el precio se hace por el MISMO texto que se mandaria', () => {
    // el boton de coste manda lo mismo que el de generar, corregido incluido:
    // un precio de un texto que no va a salir no sirve de nada
    const parsed = vaultImageEstimateArgsSchema.safeParse({
      conversationId: CONVERSACION,
      attemptId: INTENTO,
      edit: { provider: 'horde', positive: 'una escena', negative: '' },
    });
    expect(parsed.success).toBe(true);
    expect(
      vaultImageEstimateArgsSchema.safeParse({
        conversationId: CONVERSACION,
        attemptId: INTENTO,
        edit: null,
      }).success,
    ).toBe(true);
  });
});

// lo que decide la pantalla de la boveda sobre una imagen que quedo esperando.
//
// Sin React, como el resto de pruebas de este renderer: lo que se comprueba es
// la decision —que tarjeta se pinta, en que queda la ventana despues de decidir
// y que sigue enseñando el visor—, que es exactamente lo que no se ve en una
// captura y lo que `npm run check` dejaba pasar en verde.
const HILO = '11111111-2222-4333-8444-555555555555';
const INTENTO_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const INTENTO_B = 'bbbbbbbb-2222-4222-8222-222222222222';

function intento(over: Partial<ImageAttempt> = {}): ImageAttempt {
  return imageAttemptSchema.parse({
    attemptId: INTENTO_A,
    conversationId: HILO,
    createdAt: '2026-09-16T10:00:00.000Z',
    state: 'pending',
    planId: 'huella',
    ...over,
  });
}

function esperando(attemptId: string): NonNullable<VaultController['lastImage']> {
  return {
    mediaId: null,
    costCredits: null,
    costUnit: null,
    error: null,
    state: 'pending',
    attemptId,
  };
}

describe('la tarjeta de la imagen que quedo esperando', () => {
  it('sale aunque la ventana ya no recuerde el turno que la pidio', () => {
    // el caso real: se cierra Studio —o se cambia de conversacion y se vuelve—
    // con un pendiente sin decidir. `lastImage` es estado de la ventana y
    // arranca en null; el plan sigue guardado en el registro cifrado. Sin esta
    // tarjeta no hay ningun boton que abra el panel, y el pendiente no se puede
    // ni ver, ni generar, ni descartar
    const card = pendingImageCard({ lastImage: null, pendingImagePlan: intento() });
    expect(card).toEqual({
      mediaId: null,
      costCredits: null,
      costUnit: null,
      error: null,
      state: 'pending',
      attemptId: INTENTO_A,
    });
  });

  it('no se repite cuando el aviso del turno ya es el de ese mismo intento', () => {
    expect(
      pendingImageCard({ lastImage: esperando(INTENTO_A), pendingImagePlan: intento() }),
    ).toBeNull();
  });

  it('sale igual cuando el aviso del turno habla de OTRO intento', () => {
    // un turno que ya termino no cancela un pendiente que sigue esperando
    const card = pendingImageCard({
      lastImage: { ...esperando(INTENTO_B), state: 'done', error: 'el horde la rechazo' },
      pendingImagePlan: intento(),
    });
    expect(card?.attemptId).toBe(INTENTO_A);
  });

  it('sin pendiente no hay tarjeta', () => {
    expect(pendingImageCard({ lastImage: null, pendingImagePlan: null })).toBeNull();
    expect(
      pendingImageCard({ lastImage: esperando(INTENTO_A), pendingImagePlan: null }),
    ).toBeNull();
  });
});

describe('en que queda la ventana despues de aprobar un pendiente', () => {
  const generada = {
    ok: true,
    attemptId: INTENTO_A,
    mediaId: 'medio-1',
    costCredits: 12,
    costUnit: 'kudos',
  } as const;

  it('generada: el hilo deja de decir «esperando» y la tarjeta se va', () => {
    const after = windowAfterImageCommit({ attemptId: INTENTO_A, result: generada });
    expect(after.pending).toBe('clear');
    const next = after.lastImage(esperando(INTENTO_A));
    expect(next?.state).toBe('done');
    expect(next?.mediaId).toBe('medio-1');
    expect(next?.costCredits).toBe(12);
  });

  it('fallida: el hilo deja de decir «esperando» y cuenta el fallo', () => {
    // era el agujero: el camino de fallo no tocaba nada, asi que el aviso seguia
    // diciendo «te ofrecio una foto y esta esperando» sobre un intento que el
    // proceso principal ya habia dejado en `sent` y despues en `failed`
    const next = windowAfterImageCommit({
      attemptId: INTENTO_A,
      result: { ok: false, error: 'ese modelo no existe en el horde' },
    }).lastImage(esperando(INTENTO_A));
    expect(next?.state).not.toBe('pending');
    expect(next?.error).toBe('ese modelo no existe en el horde');
  });

  it('fallida: el pendiente se vuelve a preguntar al registro en vez de suponerlo', () => {
    // borrarlo seria tirar una tarjeta que quiza sigue esperando, y dejarlo como
    // estaba era lo que clavaba los tres botones —«Descartar» incluido— sobre un
    // intento que el proceso principal ya rechaza. Solo el registro sabe si
    // llego a salir
    expect(
      windowAfterImageCommit({
        attemptId: INTENTO_A,
        result: { ok: false, error: 'no se pudo hablar con el servidor' },
      }).pending,
    ).toBe('reload');
  });

  it('no toca el aviso de otro turno, decida lo que decida', () => {
    const otro = esperando(INTENTO_B);
    expect(windowAfterImageCommit({ attemptId: INTENTO_A, result: generada }).lastImage(otro)).toBe(
      otro,
    );
    expect(
      windowAfterImageCommit({
        attemptId: INTENTO_A,
        result: { ok: false, error: 'lo que sea' },
      }).lastImage(otro),
    ).toBe(otro);
  });

  it('sin aviso en el hilo no se inventa ninguno', () => {
    expect(
      windowAfterImageCommit({ attemptId: INTENTO_A, result: generada }).lastImage(null),
    ).toBeNull();
  });
});

describe('la semilla y el worker que enseña el visor', () => {
  const leido = intento({ attemptId: INTENTO_A, seed: '1080257389', worker: 'alfa' });

  it('se copian en cuanto el hueco compartido trae el intento de ese archivo', () => {
    expect(imageOriginSnapshot(null, { attemptId: INTENTO_A, shared: leido })).toEqual({
      attemptId: INTENTO_A,
      seed: '1080257389',
      worker: 'alfa',
    });
  });

  it('sobreviven a que el desplegable de un fallo recupere el hueco', () => {
    // el hueco del controlador es UNO: «Ver lo que se mando» vuelve a pedir el
    // suyo en cuanto se lo quitan, y antes el visor perdia la fila
    // «Semilla / Worker» y no la recuperaba mientras aquel siguiera abierto
    const copia = imageOriginSnapshot(null, { attemptId: INTENTO_A, shared: leido });
    const despues = imageOriginSnapshot(copia, {
      attemptId: INTENTO_A,
      shared: intento({ attemptId: INTENTO_B, seed: '7', worker: 'beta' }),
    });
    expect(despues).toEqual({ attemptId: INTENTO_A, seed: '1080257389', worker: 'alfa' });
  });

  it('no se quedan pegadas al abrir otro archivo', () => {
    const copia = imageOriginSnapshot(null, { attemptId: INTENTO_A, shared: leido });
    expect(imageOriginSnapshot(copia, { attemptId: INTENTO_B, shared: null })).toBeNull();
  });

  it('un archivo adjuntado a mano no tiene intento y no enseña nada', () => {
    const copia = imageOriginSnapshot(null, { attemptId: INTENTO_A, shared: leido });
    expect(imageOriginSnapshot(copia, { attemptId: null, shared: leido })).toBeNull();
  });

  it('lo copiado son dos escalares: el texto de la escena no sale de aqui', () => {
    // la regla que justifica la copia. Si algun dia esto llevara el plan, seria
    // contenido descifrado de la boveda colgado de un componente y fuera de la
    // purga del candado
    const copia: ImageOrigin | null = imageOriginSnapshot(null, {
      attemptId: INTENTO_A,
      shared: leido,
    });
    expect(Object.keys(copia ?? {}).sort()).toEqual(['attemptId', 'seed', 'worker']);
  });
});

describe('que se dice sobre lo que costo una imagen', () => {
  it('sin precio y sin moneda es un reenvio: no se genero nada', () => {
    expect(imageCostOutcome({ costCredits: null, costUnit: null })).toEqual({ kind: 'resent' });
  });

  // el caso que rompia: AI Horde devuelve el estado sin `kudos` y la imagen
  // llegaba con el precio vacio, igual que un reenvio. El hilo anunciaba «te ha
  // reenviado una que ya tenia, sin gastar creditos» sobre una foto recien
  // generada y cobrada
  it('sin precio pero con moneda es una generacion cuyo precio callo el servidor', () => {
    expect(imageCostOutcome({ costCredits: null, costUnit: 'kudos' })).toEqual({
      kind: 'generated',
      unit: 'kudos',
      amount: null,
    });
  });

  it('con precio en kudos es una generacion, y conserva el numero', () => {
    expect(imageCostOutcome({ costCredits: 12, costUnit: 'kudos' })).toEqual({
      kind: 'generated',
      unit: 'kudos',
      amount: 12,
    });
  });

  it('con precio en creditos es una generacion del proveedor de pago', () => {
    expect(imageCostOutcome({ costCredits: 3, costUnit: 'creditos' })).toEqual({
      kind: 'generated',
      unit: 'creditos',
      amount: 3,
    });
  });

  // un precio sin moneda no puede leerse como reenvio: algo se genero
  it('con precio pero sin moneda sigue siendo una generacion', () => {
    expect(imageCostOutcome({ costCredits: 5, costUnit: null })).toEqual({
      kind: 'generated',
      unit: 'creditos',
      amount: 5,
    });
  });
});
