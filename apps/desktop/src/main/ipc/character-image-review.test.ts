// el interruptor de «revisar el texto antes de generar», cruzando el IPC.
//
// Lo que se prueba aqui no es el almacen —eso va en `character-store.test.ts`—
// sino lo unico que solo pasa en el canal: que el verbo existe, que rechaza un
// valor que no es de los dos, que un personaje que no esta en la boveda no
// escribe nada, que la lista vuelve ya aplicada para que la pantalla no pinte
// el valor viejo, y que al registro no se va ni el nombre del personaje ni lo
// que se le iba a pedir.
import { describe, it, expect, vi } from 'vitest';
import type { VaultCharacter } from '../vault/character-store.js';

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
const { IPC_INVOKE, vaultCharacterListResultSchema } = await import('../../shared/ipc.js');
// el almacen de verdad hace `parse()` al guardar, y eso es justo lo que
// convierte un campo omitido en su valor por defecto en vez de en un hueco. El
// doble tiene que hacer lo mismo o un olvido de campo no se veria nunca aqui
const { vaultCharacterSchema } = await import('../vault/character-store.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const LIA = 'c0000000-3333-4333-8333-333333333333';
const OTRA = 'd0000000-4444-4444-8444-444444444444';

function personaje(over: Partial<VaultCharacter> = {}): VaultCharacter {
  return {
    characterId: LIA,
    imageProvider: 'horde',
    imageReview: 'siempre',
    xavira: null,
    horde: {
      recipe: {
        models: ['Prefect Pony'],
        appearance: 'green eyes',
        outfit: '',
        negative: '',
        seed: '1080257389',
        shared: false,
        width: 1024,
        height: 1024,
        steps: 30,
        cfgScale: 5,
        samplerName: 'k_euler_a',
        scheduler: 'karras',
        clipSkip: 2,
        loras: [],
        hiresFix: false,
        postProcessing: [],
        denoisingStrength: 0.75,
        promptStyle: 'tags',
      },
    },
    description: 'Te llamas Lia.',
    label: 'Lia',
    avatarObjectKey: null,
    createdAt: '2026-09-04T10:00:00.000Z',
    ...over,
  };
}

interface Huella {
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  guardados: () => VaultCharacter[];
  /** cuantas veces se ha reescrito la lista: cero prueba que no se escribio */
  escrituras: () => number;
}

function registrar(characters: VaultCharacter[], unlocked = true): Huella {
  let guardados = [...characters];
  let escrituras = 0;
  const huella: Huella = {
    registros: [],
    guardados: () => guardados,
    escrituras: () => escrituras,
  };

  const context = {
    // `registerIpcHandlers` engancha el trabajo de fondo al cierre de la boveda
    // nada mas registrar
    vault: { isUnlocked: () => unlocked, onLock: () => () => undefined },
    characters: {
      list: async () => guardados,
      add: async (_vault: unknown, character: unknown) => {
        escrituras += 1;
        // el mismo `parse()` que hace `CharacterStore.add`
        const guardado = vaultCharacterSchema.parse(character);
        guardados = [
          ...guardados.filter((entry) => entry.characterId !== guardado.characterId),
          guardado,
        ];
        return guardados;
      },
    },
    controller: {},
    log: (mensaje: string, campos?: Record<string, unknown>) => {
      huella.registros.push({ mensaje, campos });
    },
  } as unknown as HandlerContext;

  registerIpcHandlers(context);
  return huella;
}

type Respuesta =
  { ok: true; value: { characters: VaultCharacter[] } } | { ok: false; error: string };

async function revisar(args: unknown): Promise<Respuesta> {
  const handler = canales.get(IPC_INVOKE.vaultCharacterImageReview);
  if (handler === undefined) throw new Error('el canal de revision no se registro');
  return (await handler(null, args)) as Respuesta;
}

describe('revisar el texto de la imagen antes de generarla', () => {
  it('apaga la revision y devuelve la lista ya aplicada', async () => {
    const huella = registrar([personaje()]);

    const respuesta = await revisar({ characterId: LIA, review: 'nunca' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;

    expect(respuesta.value.characters[0]?.imageReview).toBe('nunca');
    // y en el almacen, no solo en lo que se devolvio
    expect(huella.guardados()[0]?.imageReview).toBe('nunca');
  });

  it('no toca nada mas del personaje', async () => {
    // cambiar un interruptor no puede ser la puerta por la que se le reescribe
    // la receta: sin la semilla y los modelos exactos deja de ser ella
    registrar([personaje()]);

    const respuesta = await revisar({ characterId: LIA, review: 'nunca' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;

    const despues = respuesta.value.characters[0];
    expect(despues?.characterId).toBe(LIA);
    expect(despues?.imageProvider).toBe('horde');
    expect(despues?.horde?.recipe.seed).toBe('1080257389');
    expect(despues?.horde?.recipe.models).toEqual(['Prefect Pony']);
    expect(despues?.label).toBe('Lia');
    expect(despues?.description).toBe('Te llamas Lia.');
  });

  it('funciona igual con un personaje de Xavira', async () => {
    // alli casi todo el texto vive en el servidor del proveedor, pero la
    // decision de pararse a mirar sigue siendo del usuario
    registrar([
      personaje({
        imageProvider: 'xavira',
        xavira: { characterId: LIA, modelId: 'anime-pure-v1' },
        horde: null,
      }),
    ]);

    const respuesta = await revisar({ characterId: LIA, review: 'nunca' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    expect(respuesta.value.characters[0]?.imageReview).toBe('nunca');
  });

  it('un personaje que no esta en la boveda no escribe nada', async () => {
    const huella = registrar([personaje()]);

    const respuesta = await revisar({ characterId: OTRA, review: 'nunca' });
    expect(respuesta.ok).toBe(false);
    expect(huella.escrituras()).toBe(0);
  });

  it('un valor que no es de los dos se rechaza antes de tocar el almacen', async () => {
    const huella = registrar([personaje()]);

    const respuesta = await revisar({ characterId: LIA, review: 'a veces' });
    expect(respuesta.ok).toBe(false);
    expect(huella.escrituras()).toBe(0);
    expect(huella.guardados()[0]?.imageReview).toBe('siempre');
  });

  it('con la boveda cerrada no se cambia', async () => {
    const huella = registrar([personaje()], false);

    const respuesta = await revisar({ characterId: LIA, review: 'nunca' });
    expect(respuesta.ok).toBe(false);
    expect(huella.escrituras()).toBe(0);
  });

  it('al registro va la decision y nada de quien es', async () => {
    const huella = registrar([personaje()]);
    await revisar({ characterId: LIA, review: 'nunca' });

    const escrito = JSON.stringify(huella.registros);
    expect(escrito).toContain('nunca');
    expect(escrito).not.toContain(LIA);
    expect(escrito).not.toContain('Lia');
    expect(escrito).not.toContain('green eyes');
  });

  it('lo que sale cumple el contrato que el renderer da por hecho', async () => {
    // el handler no se comprueba contra su esquema en tiempo de ejecucion: es
    // un tipo, y un tipo no falla en produccion. Aqui si, porque la pantalla
    // lee `z.infer` de este esquema para pintar el interruptor
    registrar([personaje()]);

    const respuesta = await revisar({ characterId: LIA, review: 'nunca' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    expect(respuesta.value.characters).toHaveLength(1);
    expect(() => vaultCharacterListResultSchema.parse(respuesta.value)).not.toThrow();
  });
});

describe('corregir la receta no mueve el interruptor', () => {
  async function guardarReceta(args: unknown): Promise<{ ok: boolean; error?: string }> {
    const handler = canales.get(IPC_INVOKE.vaultHordeCharacterSave);
    if (handler === undefined) throw new Error('el canal de la receta no se registro');
    return (await handler(null, args)) as { ok: boolean; error?: string };
  }

  it('GUARDAR LA RECETA CONSERVA `imageReview`, que es el camino de no usar la funcion', async () => {
    // el verbo reconstruia el personaje campo a campo y este no estaba en la
    // lista. Como `add()` hace `parse()` y el campo tiene `.default('siempre')`,
    // no se quedaba vacio: RENACIA encendido. O sea que apagar la revision y
    // despues tocar la receta —cambiar de modelo, subir los pasos— volvia a
    // encenderla sola, en silencio y sin error
    const receta = personaje().horde?.recipe;
    if (receta === undefined) throw new Error('la receta de prueba no esta');
    const huella = registrar([personaje({ imageReview: 'nunca' })]);

    const respuesta = await guardarReceta({
      characterId: LIA,
      label: 'Lia',
      description: 'Te llamas Lia.',
      recipe: { ...receta, steps: 35 },
    });

    expect(respuesta.ok).toBe(true);
    expect(huella.guardados()[0]?.imageReview).toBe('nunca');
    // y lo que se venia a cambiar SI entra: se conserva el interruptor, no la
    // receta vieja
    expect(huella.guardados()[0]?.horde?.recipe.steps).toBe(35);
  });

  it('y lo demas del personaje sigue donde estaba', async () => {
    const receta = personaje().horde?.recipe;
    if (receta === undefined) throw new Error('la receta de prueba no esta');
    const huella = registrar([
      personaje({
        imageReview: 'nunca',
        xavira: { characterId: LIA, modelId: 'anime-pure-v1' },
        avatarObjectKey: '0123456789abcdef0123456789abcdef',
        createdAt: '2026-01-02T03:04:05.000Z',
      }),
    ]);

    await guardarReceta({
      characterId: LIA,
      label: 'Lia',
      description: 'Te llamas Lia.',
      recipe: receta,
    });

    const despues = huella.guardados()[0];
    expect(despues?.xavira?.modelId).toBe('anime-pure-v1');
    expect(despues?.avatarObjectKey).toBe('0123456789abcdef0123456789abcdef');
    expect(despues?.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(despues?.imageProvider).toBe('horde');
  });
});
