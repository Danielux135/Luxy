// pruebas del registro de intentos de imagen contra una boveda de verdad.
//
// Se cifra y se descifra de verdad porque lo que se comprueba es justo lo que no
// se puede comprobar sin sellar: que el prompt vuelve entero, que en disco no se
// lee ni una palabra de el, que la subclave de OTRA conversacion no abre este
// archivo y que borrar la conversacion se lleva el archivo entero.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openText, sealText, wipe, type SealedEnvelope } from '@luxy/vault-crypto';
import {
  composeHordeImagePlan,
  hordeRecipeSchema,
  imageAttemptSchema,
  type ImageAttempt,
  type VaultImagePlan,
} from '@luxy/shared';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { ImageAttemptStore, attemptKeyContext, imageAttemptsDirectory } from './image-attempt-store.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const CONV_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const CONV_B = 'bbbbbbbb-2222-4222-8222-222222222222';

/**
 * la cadena testigo.
 *
 * No aparece en ningun otro sitio del repositorio, asi que encontrarla en el
 * archivo sellado solo puede significar que el prompt quedo en claro.
 */
const TESTIGO = 'zarzamora';

function memoryDeviceKeys(): DeviceKeyStore {
  let value: string | undefined;
  return {
    get: () => value,
    set: (next: string) => {
      value = next;
    },
    delete: () => {
      value = undefined;
    },
  };
}

function planFor(scene: string): VaultImagePlan {
  return composeHordeImagePlan({
    recipe: hordeRecipeSchema.parse({
      models: ['AlbedoBase XL (SDXL)'],
      appearance: 'light brown hair, green eyes',
      outfit: 'silk robe',
    }),
    scene: scene,
    extraNegative: 'lowres, bad anatomy',
  });
}

let counter = 0;

function attempt(over: Partial<ImageAttempt> = {}): ImageAttempt {
  counter += 1;
  const plan = over.plan ?? planFor(`sitting by the window, ${TESTIGO} in the vase`);
  return imageAttemptSchema.parse({
    attemptId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    conversationId: CONV_A,
    characterId: 'lia',
    createdAt: '2026-09-16T10:00:00.000Z',
    state: 'pending',
    source: 'compuesto',
    plan,
    planId: plan.planId,
    ...over,
  });
}

describe('registro de intentos de imagen', () => {
  let directory: string;
  let vault: VaultService;
  let store: ImageAttemptStore;

  beforeEach(async () => {
    counter = 0;
    directory = mkdtempSync(join(tmpdir(), 'luxy-att-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    store = new ImageAttemptStore(imageAttemptsDirectory(directory));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /**
   * escribe un contenido cualquiera con el sello de verdad, para poder romperlo.
   *
   * `context` es lo que separa este registro de un turno de la misma
   * conversacion: por defecto sella como sella el almacen, y las pruebas del
   * compartimento lo cambian por el del turno para comprobar que NO se abre.
   */
  async function sealPayload(
    payload: unknown,
    context: string = attemptKeyContext(CONV_A),
  ): Promise<void> {
    const key = vault.subkeyFor('conversation', context);
    try {
      const sealed = await sealText(key, 'vault.conversation', JSON.stringify(payload));
      mkdirSync(imageAttemptsDirectory(directory), { recursive: true });
      writeFileSync(
        store.fileFor(CONV_A),
        JSON.stringify({ version: 1, content: sealed }),
        'utf8',
      );
    } finally {
      wipe(key);
    }
  }

  it('lo apuntado vuelve igual tras reabrir, y en disco no se lee el prompt', async () => {
    const escrito = await store.append(vault, CONV_A, attempt());

    // otra instancia: lo que vuelve sale del archivo, no de nada en memoria
    const leido = await new ImageAttemptStore(imageAttemptsDirectory(directory)).list(
      vault,
      CONV_A,
    );
    expect(leido).toHaveLength(1);
    expect(leido[0]?.attemptId).toBe(escrito.attemptId);
    expect(leido[0]?.plan?.provider).toBe('horde');
    expect(leido[0]?.plan?.provider === 'horde' ? leido[0]?.plan.joined : '').toContain(TESTIGO);

    const crudo = readFileSync(store.fileFor(CONV_A), 'utf8');
    expect(crudo).not.toContain(TESTIGO);
    expect(crudo).not.toContain('silk robe');
    expect(crudo).not.toContain('lowres');
  });

  it('el pendiente que devuelve es el ultimo sin decidir', async () => {
    await store.append(vault, CONV_A, attempt({ state: 'superseded' }));
    const viejo = await store.append(vault, CONV_A, attempt());
    const nuevo = await store.append(vault, CONV_A, attempt());
    await store.append(vault, CONV_A, attempt({ state: 'ok' }));

    const pendiente = await store.pending(vault, CONV_A);
    expect(pendiente?.attemptId).toBe(nuevo.attemptId);
    expect(pendiente?.attemptId).not.toBe(viejo.attemptId);
  });

  it('update cambia el estado y no toca la identidad del intento', async () => {
    const escrito = await store.append(vault, CONV_A, attempt());

    const actualizado = await store.update(vault, CONV_A, escrito.attemptId, {
      state: 'ok',
      mediaId: 'medio-1',
      seed: '123456',
      worker: 'un worker cualquiera',
      rc: null,
      warnings: [{ code: 'AnonymousKeySharesImage', message: 'la clave anonima comparte' }],
    });

    expect(actualizado?.state).toBe('ok');
    expect(actualizado?.attemptId).toBe(escrito.attemptId);
    expect(actualizado?.createdAt).toBe(escrito.createdAt);
    expect(actualizado?.warnings).toHaveLength(1);

    const leido = await store.list(vault, CONV_A);
    expect(leido[0]?.state).toBe('ok');
    expect(leido[0]?.seed).toBe('123456');
    expect(await store.pending(vault, CONV_A)).toBeUndefined();
  });

  it('update de un intento que ya no esta no es un error', async () => {
    await store.append(vault, CONV_A, attempt());
    const nada = await store.update(vault, CONV_A, '11111111-1111-4111-8111-111111111111', {
      state: 'ok',
    });
    expect(nada).toBeUndefined();
  });

  it('borrar la conversacion se lleva el archivo entero', async () => {
    await store.append(vault, CONV_A, attempt());
    const file = store.fileFor(CONV_A);
    expect(existsSync(file)).toBe(true);

    await store.removeConversation(vault, CONV_A);

    expect(existsSync(file)).toBe(false);
    expect(await store.list(vault, CONV_A)).toEqual([]);
    // borrar dos veces tampoco puede fallar: el borrado real lo intenta sin saber
    // si esta conversacion llego a pedir alguna imagen
    await store.removeConversation(vault, CONV_A);
  });

  it('la subclave de otra conversacion no abre este archivo', async () => {
    await store.append(vault, CONV_A, attempt());
    // el archivo de A, colocado con el nombre de B: solo la subclave decide
    copyFileSync(store.fileFor(CONV_A), store.fileFor(CONV_B));

    expect(await store.list(vault, CONV_B)).toEqual([]);
    // y el de A sigue leyendose como estaba
    expect(await store.list(vault, CONV_A)).toHaveLength(1);
  });

  it('un sobre sellado como TURNO no se abre aqui, aunque lleve dentro un registro valido', async () => {
    // el contenido es impecable: si el compartimento fuera el mismo que el de
    // los turnos, esto se leeria como si lo hubiera escrito el almacen. Por eso
    // no vale con que el esquema del payload lo rechace: aqui el payload es el
    // que toca y quien tiene que decir que no es la llave
    await sealPayload({ v: 1, attempts: [attempt({ state: 'ok' })] }, CONV_A);

    expect(await store.list(vault, CONV_A)).toEqual([]);
  });

  it('la subclave del turno no abre el sobre que escribe este almacen', async () => {
    await store.append(vault, CONV_A, attempt());

    const archivo = JSON.parse(readFileSync(store.fileFor(CONV_A), 'utf8')) as {
      content: SealedEnvelope;
    };
    // la llave que un dia se envuelve para un invitado (`shareGrant.wrappedKey`)
    // es la de la conversacion. Compartir el hilo no puede abrir tambien esto,
    // que guarda lo que el hilo no enseña: el `rc`, el error y el texto
    // reescrito a mano
    const turno = vault.subkeyFor('conversation', CONV_A);
    try {
      await expect(openText(turno, 'vault.conversation', archivo.content)).rejects.toThrow();
    } finally {
      wipe(turno);
    }
  });

  it('prune conserva el pendiente y los ultimos', async () => {
    const viejoPendiente = await store.append(vault, CONV_A, attempt({ state: 'pending' }));
    for (let index = 0; index < 12; index += 1) {
      await store.append(vault, CONV_A, attempt({ state: 'ok' }));
    }

    await store.prune(vault, CONV_A, 5);

    const leido = await store.list(vault, CONV_A);
    // los cinco ultimos mas el pendiente que cayo fuera de la ventana
    expect(leido).toHaveLength(6);
    expect(leido.map((entry) => entry.attemptId)).toContain(viejoPendiente.attemptId);
    expect(leido[0]?.attemptId).toBe(viejoPendiente.attemptId);
    expect((await store.pending(vault, CONV_A))?.attemptId).toBe(viejoPendiente.attemptId);
  });

  it('una racha de imagenes buenas no se lleva por delante los fallos', async () => {
    // el caso real: una tarde de pruebas gasta el anillo en unas horas y, al
    // podar por antiguedad, lo que sale por la ventana es justo el bloqueo que
    // se iba a mirar. Un `ok` tiene su imagen guardada aparte; un `failed` solo
    // existe aqui
    const bloqueo = await store.append(vault, CONV_A, attempt({ state: 'failed', rc: 'csam' }));
    const censura = await store.append(vault, CONV_A, attempt({ state: 'failed', rc: 'censored' }));
    for (let index = 0; index < 12; index += 1) {
      await store.append(vault, CONV_A, attempt({ state: 'ok' }));
    }

    await store.prune(vault, CONV_A, 5);

    const leido = await store.list(vault, CONV_A);
    const ids = leido.map((entry) => entry.attemptId);
    expect(ids).toContain(bloqueo.attemptId);
    expect(ids).toContain(censura.attemptId);
    // y los correctos si se podan a su cupo
    expect(leido.filter((entry) => entry.state === 'ok')).toHaveLength(5);
  });

  it('el cupo de diagnostico tambien tiene tope', async () => {
    const primero = await store.append(vault, CONV_A, attempt({ state: 'failed' }));
    await store.append(vault, CONV_A, attempt({ state: 'failed' }));
    const penultimo = await store.append(vault, CONV_A, attempt({ state: 'malformed' }));
    const ultimo = await store.append(vault, CONV_A, attempt({ state: 'sent' }));

    await store.prune(vault, CONV_A, 5, 2);

    const ids = (await store.list(vault, CONV_A)).map((entry) => entry.attemptId);
    expect(ids).toEqual([penultimo.attemptId, ultimo.attemptId]);
    expect(ids).not.toContain(primero.attemptId);
  });

  it('prune no toca nada cuando aun caben', async () => {
    await store.append(vault, CONV_A, attempt({ state: 'ok' }));
    await store.append(vault, CONV_A, attempt({ state: 'ok' }));

    await store.prune(vault, CONV_A, 5);

    expect(await store.list(vault, CONV_A)).toHaveLength(2);
  });

  it('un archivo ilegible devuelve vacio en vez de parar el turno', async () => {
    const file = store.fileFor(CONV_A);
    mkdirSync(imageAttemptsDirectory(directory), { recursive: true });

    writeFileSync(file, 'esto no es json', 'utf8');
    expect(await store.list(vault, CONV_A)).toEqual([]);

    writeFileSync(file, JSON.stringify({ version: 2, content: {} }), 'utf8');
    expect(await store.list(vault, CONV_A)).toEqual([]);

    // y escribir encima vuelve a dejarlo utilizable
    await store.append(vault, CONV_A, attempt());
    expect(await store.list(vault, CONV_A)).toHaveLength(1);
  });

  it('un intento roto no se lleva por delante a los demas', async () => {
    const bueno = attempt({ state: 'ok' });
    // lo que escribiria una version posterior: un estado que este esquema aun
    // no conoce. No puede tirar el intento de al lado.
    await sealPayload({
      v: 1,
      attempts: [{ ...attempt({ state: 'ok' }), state: 'requeued' }, bueno],
    });

    const leido = await store.list(vault, CONV_A);
    expect(leido).toHaveLength(1);
    expect(leido[0]?.attemptId).toBe(bueno.attemptId);
  });

  it('un identificador de conversacion que no es un uuid se rechaza', () => {
    expect(() => store.fileFor('..')).toThrow(VaultError);
    expect(() => store.fileFor('../../otra')).toThrow(VaultError);
  });

  it('un intento mal formado no llega a escribirse', async () => {
    await expect(
      store.append(vault, CONV_A, { ...attempt(), attemptId: 'no-es-un-uuid' }),
    ).rejects.toThrow(VaultError);
    expect(await store.list(vault, CONV_A)).toEqual([]);
  });

  it('dos escrituras a la vez no se pisan', async () => {
    await Promise.all([
      store.append(vault, CONV_A, attempt({ state: 'ok' })),
      store.append(vault, CONV_A, attempt({ state: 'ok' })),
      store.append(vault, CONV_A, attempt({ state: 'ok' })),
    ]);

    expect(await store.list(vault, CONV_A)).toHaveLength(3);
  });
});
