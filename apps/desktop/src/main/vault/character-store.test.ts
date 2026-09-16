// pruebas del almacen de personajes.
//
// Lo que se prueba aqui no es criptografia: es que un identificador PAGADO no
// se pierda. La API no sabe listar personajes, asi que uno que no acabe en este
// archivo no se recupera de ninguna manera.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import {
  VaultCharacterStore,
  charactersFilePath,
  storedCharacterSchema,
} from './character-store.js';
import { LocalBlobStore, mediaDirectory } from './blob-store.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;

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

const character = (id: string, label = 'Una') => ({
  characterId: id,
  // nacido en Xavira, que es de donde vienen todos los que ya existian
  xavira: { characterId: id, modelId: 'anime-pure-v1' },
  description: 'Rasgos: género: mujer, color del pelo: rubio.',
  label,
  avatarObjectKey: null,
  createdAt: new Date().toISOString(),
});

describe('personajes guardados', () => {
  let directory: string;
  let vault: VaultService;
  let store: VaultCharacterStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-chars-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    store = new VaultCharacterStore(
      charactersFilePath(directory),
      new LocalBlobStore(mediaDirectory(directory)),
    );
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('sin archivo, la lista esta vacia y no es un error', async () => {
    expect(await store.list(vault)).toEqual([]);
  });

  it('guarda y recupera un personaje', async () => {
    await store.add(vault, character('per-1'));
    const guardados = await store.list(vault);
    expect(guardados).toHaveLength(1);
    expect(guardados[0]?.characterId).toBe('per-1');
    expect(guardados[0]?.description).toContain('rubio');
  });

  it('sobrevive a cerrar y volver a abrir la boveda', async () => {
    await store.add(vault, character('per-1'));
    vault.lock();
    await vault.unlock(PASSWORD);
    // es justo el caso que se perdia: crear el personaje y no volver hasta luego
    expect((await store.list(vault))[0]?.characterId).toBe('per-1');
  });

  it('el identificador no queda en claro en el disco', async () => {
    await store.add(vault, character('per-secreto', 'Etiqueta reveladora'));
    const raw = readFileSync(charactersFilePath(directory), 'utf8');
    expect(raw).not.toContain('per-secreto');
    expect(raw).not.toContain('Etiqueta reveladora');
    expect(raw).not.toContain('rubio');
  });

  it('con la boveda cerrada no se puede leer', async () => {
    await store.add(vault, character('per-1'));
    vault.lock();
    await expect(store.list(vault)).rejects.toThrow(VaultError);
  });

  it('guardar el mismo identificador actualiza en vez de duplicar', async () => {
    await store.add(vault, character('per-1', 'Nombre viejo'));
    await store.add(vault, character('per-1', 'Nombre nuevo'));
    const guardados = await store.list(vault);
    expect(guardados).toHaveLength(1);
    expect(guardados[0]?.label).toBe('Nombre nuevo');
  });

  it('conserva varios', async () => {
    await store.add(vault, character('per-1'));
    await store.add(vault, character('per-2'));
    expect((await store.list(vault)).map((c) => c.characterId)).toEqual(['per-1', 'per-2']);
  });

  it('olvidar uno deja los demas', async () => {
    await store.add(vault, character('per-1'));
    await store.add(vault, character('per-2'));
    const quedan = await store.remove(vault, 'per-1');
    expect(quedan.map((c) => c.characterId)).toEqual(['per-2']);
  });

  it('otra boveda no puede leerlos', async () => {
    await store.add(vault, character('per-1'));

    const otro = mkdtempSync(join(tmpdir(), 'luxy-chars-otra-'));
    const otraVault = new VaultService(vaultFilePathFor(otro), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await otraVault.create('otra frase larga distinta');
    await expect(store.list(otraVault)).rejects.toThrow();
    rmSync(otro, { recursive: true, force: true });
  });

  it('guarda el avatar cifrado y lo devuelve entero', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const objectKey = await store.saveAvatar(vault, bytes);
    // se pago con la creacion: perderlo obligaba a generar otra imagen para
    // ver a quien acabas de crear
    expect([...(await store.readAvatar(vault, objectKey))]).toEqual([...bytes]);
  });

  it('el avatar no queda en claro en el disco', async () => {
    const bytes = new Uint8Array([200, 201, 202, 203, 204, 205, 206, 207]);
    const objectKey = await store.saveAvatar(vault, bytes);
    const guardado = readFileSync(join(mediaDirectory(directory), `${objectKey}.bin`));
    expect(guardado.includes(Buffer.from(bytes))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // AI Horde
  //
  // Alli el personaje NO existe en ningun servidor: es su receta. Perder la
  // receta no cuesta creditos, cuesta el personaje entero, asi que tiene que
  // sobrevivir al cifrado igual que un identificador pagado.
  // -------------------------------------------------------------------------

  it('guarda la receta entera de un personaje del horde', async () => {
    await store.add(vault, {
      characterId: 'horde-1',
      label: 'Lia',
      description: '',
      createdAt: new Date().toISOString(),
      imageProvider: 'horde',
      horde: {
        recipe: {
          models: ['Prefect Pony', 'WAI-CUTE Pony'],
          appearance: '1girl, long black hair, green eyes',
          seed: '12345',
        },
      },
    });

    const [guardado] = await store.list(vault);
    expect(guardado?.imageProvider).toBe('horde');
    // sin los modelos exactos la peticion se queda en cola para siempre, y sin
    // la semilla la cara cambia en cada imagen
    expect(guardado?.horde?.recipe.models).toEqual(['Prefect Pony', 'WAI-CUTE Pony']);
    expect(guardado?.horde?.recipe.seed).toBe('12345');
    // lo que no se escribio toma su valor por defecto en vez de quedar a medias
    expect(guardado?.horde?.recipe.width).toBe(1024);
    expect(guardado?.horde?.recipe.clipSkip).toBe(2);
    expect(guardado?.horde?.recipe.promptStyle).toBe('tags');
  });

  it('el aspecto del personaje no queda en claro en el disco', async () => {
    // describe a alguien: saber que existe uno con ciertos rasgos ya dice mucho
    await store.add(vault, {
      characterId: 'horde-1',
      label: 'Lia',
      description: '',
      createdAt: new Date().toISOString(),
      imageProvider: 'horde',
      horde: { recipe: { models: ['Prefect Pony'], appearance: 'freckles and a scar' } },
    });
    const guardado = readFileSync(charactersFilePath(directory), 'utf8');
    expect(guardado).not.toContain('freckles');
    expect(guardado).not.toContain('Prefect Pony');
  });

  // -------------------------------------------------------------------------
  // el mismo personaje en los dos sitios (D-068)
  //
  // Lo que se protege aqui es una sola cosa: que `characterId` NO cambie. A el
  // se agarran las conversaciones, los recuerdos y las imagenes ya generadas,
  // asi que moverlo es perder a la persona aunque el resto del registro este
  // perfecto.
  // -------------------------------------------------------------------------

  it('darle un aspecto en el horde a uno de Xavira no crea a nadie nuevo', async () => {
    await store.add(vault, character('83cc7f03-5eb3-4d03-833f-56dfbe80cd7d', 'Lia'));
    const [antes] = await store.list(vault);

    const despues = await store.add(vault, {
      ...antes!,
      imageProvider: 'horde',
      horde: { recipe: { models: ['Prefect Pony'], appearance: 'green eyes' } },
    });

    // un solo personaje, con su identificador de siempre
    expect(despues).toHaveLength(1);
    expect(despues[0]?.characterId).toBe('83cc7f03-5eb3-4d03-833f-56dfbe80cd7d');
    // y con las DOS identidades: la de Xavira no se pierde al añadir la otra
    expect(despues[0]?.xavira?.characterId).toBe('83cc7f03-5eb3-4d03-833f-56dfbe80cd7d');
    expect(despues[0]?.horde?.recipe.appearance).toBe('green eyes');
    expect(despues[0]?.imageProvider).toBe('horde');
  });

  it('cambiar de proveedor no toca nada mas del personaje', async () => {
    await store.add(vault, {
      ...character('per-1', 'Lia'),
      imageProvider: 'horde',
      horde: { recipe: { models: ['Prefect Pony'], appearance: 'green eyes' } },
    });
    const [antes] = await store.list(vault);

    const despues = await store.add(vault, { ...antes!, imageProvider: 'xavira' });
    expect(despues[0]?.imageProvider).toBe('xavira');
    // la receta sigue ahi para poder volver sin reescribirla
    expect(despues[0]?.horde?.recipe.appearance).toBe('green eyes');
    expect(despues[0]?.label).toBe('Lia');
  });

  // -------------------------------------------------------------------------
  // revisar el texto antes de generar
  //
  // Es un ajuste del PERSONAJE, como el proveedor: lo que se revisa sale de su
  // receta. Lo que se protege aqui es que nazca puesto —quien no lo sepa no
  // paga una generacion a ciegas— y que cambiarlo no arrastre nada mas.
  // -------------------------------------------------------------------------

  it('un personaje guardado antes de este ajuste se lee con la revision puesta', async () => {
    // el ayudante de estas pruebas no lo escribe: es exactamente la forma que
    // tiene en disco una boveda anterior a este campo
    await store.add(vault, character('per-1'));
    expect((await store.list(vault))[0]?.imageReview).toBe('siempre');
  });

  it('cambiar el interruptor no toca ni el proveedor ni la receta ni el avatar', async () => {
    const objectKey = await store.saveAvatar(vault, new Uint8Array([9, 9, 9, 9]));
    await store.add(vault, {
      ...character('per-1', 'Lia'),
      imageProvider: 'horde',
      horde: { recipe: { models: ['Prefect Pony'], appearance: 'green eyes', seed: '1080257389' } },
      avatarObjectKey: objectKey,
    });
    const [antes] = await store.list(vault);

    const despues = await store.add(vault, { ...antes!, imageReview: 'nunca' });

    expect(despues[0]?.imageReview).toBe('nunca');
    expect(despues[0]?.imageProvider).toBe('horde');
    expect(despues[0]?.horde?.recipe.appearance).toBe('green eyes');
    // sin la semilla la cara cambia en cada imagen: perderla aqui seria perder
    // al personaje por tocar un interruptor que no tiene nada que ver
    expect(despues[0]?.horde?.recipe.seed).toBe('1080257389');
    expect(despues[0]?.xavira?.modelId).toBe('anime-pure-v1');
    expect(despues[0]?.avatarObjectKey).toBe(objectKey);
    expect(despues[0]?.label).toBe('Lia');
  });

  it('el valor sobrevive a guardar otro personaje distinto', async () => {
    // `add` reescribe la lista ENTERA, asi que tocar a uno es reescribir a
    // todos: es justo donde un campo nuevo se pierde sin dar ningun error
    await store.add(vault, character('per-1'));
    const [antes] = await store.list(vault);
    await store.add(vault, { ...antes!, imageReview: 'nunca' });

    await store.add(vault, character('per-2'));

    const guardados = await store.list(vault);
    expect(guardados.find((c) => c.characterId === 'per-1')?.imageReview).toBe('nunca');
    // y el que llega nuevo nace con la revision puesta
    expect(guardados.find((c) => c.characterId === 'per-2')?.imageReview).toBe('siempre');
  });

  it('el ajuste sobrevive a cerrar y volver a abrir la boveda', async () => {
    await store.add(vault, { ...character('per-1'), imageReview: 'nunca' });
    vault.lock();
    await vault.unlock(PASSWORD);
    expect((await store.list(vault))[0]?.imageReview).toBe('nunca');
  });
});

describe('personajes escritos antes de D-068', () => {
  it('uno de Xavira conserva su identificador y lo copia a su identidad', () => {
    // ES el caso real de Daniel: su personaje se creo cuando la clave de la
    // boveda y la de Xavira eran la misma cosa. Si esta traduccion se
    // equivocara, sus conversaciones y sus recuerdos apuntarian a nadie
    const leido = storedCharacterSchema.parse({
      characterId: '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d',
      provider: 'xavira',
      modelId: 'anime-pure-v1',
      recipe: null,
      description: 'Te llamas Lia.',
      label: 'Lia',
      avatarObjectKey: null,
      createdAt: '2026-09-02T08:50:37.000Z',
    });

    expect(leido.characterId).toBe('83cc7f03-5eb3-4d03-833f-56dfbe80cd7d');
    expect(leido.imageProvider).toBe('xavira');
    expect(leido.xavira).toEqual({
      characterId: '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d',
      modelId: 'anime-pure-v1',
    });
    // no tenia aspecto en el horde, y no se le inventa uno
    expect(leido.horde).toBeNull();
  });

  it('uno del horde conserva su receta y no gana una identidad de Xavira', () => {
    const leido = storedCharacterSchema.parse({
      characterId: 'c0ffee00-0000-4000-8000-000000000000',
      provider: 'horde',
      modelId: 'Prefect Pony',
      recipe: { models: ['Prefect Pony'], appearance: 'green eyes' },
      description: '',
      label: 'Lia',
      avatarObjectKey: null,
      createdAt: '2026-09-04T10:00:00.000Z',
    });

    expect(leido.imageProvider).toBe('horde');
    expect(leido.horde?.recipe.models).toEqual(['Prefect Pony']);
    // inventarle una identidad en Xavira mandaria su clave local a esa API
    expect(leido.xavira).toBeNull();
  });

  it('uno sin proveedor declarado se lee como de Xavira', () => {
    // los mas antiguos de todos, de antes de que hubiera dos proveedores
    const leido = storedCharacterSchema.parse({
      characterId: 'per-1',
      modelId: 'realistic-sharp-v1',
      description: '',
      label: 'Una',
      avatarObjectKey: null,
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    expect(leido.imageProvider).toBe('xavira');
    expect(leido.xavira?.characterId).toBe('per-1');
  });

  it('ninguno de ellos trae el ajuste de revision, y se lee puesto', () => {
    // la lectura es lo unico que decide: el archivo no se reescribe al leer, y
    // un `undefined` aqui dejaria el interruptor de la pantalla sin estado
    const leido = storedCharacterSchema.parse({
      characterId: 'per-1',
      provider: 'horde',
      recipe: { models: ['Prefect Pony'], appearance: 'green eyes' },
      description: '',
      label: 'Lia',
      avatarObjectKey: null,
      createdAt: '2026-09-04T10:00:00.000Z',
    });
    expect(leido.imageReview).toBe('siempre');
  });

  it('uno ya escrito en la forma nueva no se vuelve a traducir', () => {
    const leido = storedCharacterSchema.parse({
      characterId: 'per-1',
      imageProvider: 'horde',
      xavira: { characterId: 'otro-de-xavira', modelId: 'anime-pure-v1' },
      horde: { recipe: { models: ['Prefect Pony'], appearance: 'green eyes' } },
      description: '',
      label: 'Lia',
      avatarObjectKey: null,
      createdAt: '2026-09-04T12:00:00.000Z',
    });
    // la identidad de Xavira es SUYA y distinta de la clave de la boveda: si la
    // traduccion se aplicara otra vez, la pisaria con la clave local
    expect(leido.xavira?.characterId).toBe('otro-de-xavira');
    expect(leido.imageProvider).toBe('horde');
  });
});
