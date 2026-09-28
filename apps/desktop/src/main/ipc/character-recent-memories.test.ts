// el interruptor del resumen de sus dos ultimas conversaciones (`D-105`),
// cruzando el IPC. El mismo molde que los demas interruptores del personaje.
// Todo el texto es INVENTADO.
import { describe, it, expect, vi } from 'vitest';
import type { VaultCharacter } from '../vault/character-store.js';

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
const { IPC_INVOKE, vaultCharacterListResultSchema } = await import('../../shared/ipc.js');
// el doble hace el mismo `parse()` que el almacen: es lo que convierte un campo
// omitido en su valor por defecto, y sin eso un olvido no se veria aqui
const { vaultCharacterSchema } = await import('../vault/character-store.js');
type HandlerContext = Parameters<typeof registerIpcHandlers>[0];

const NORA = 'e0000000-5555-4555-8555-555555555555';
const OTRA = 'f0000000-6666-4666-8666-666666666666';

function personaje(over: Partial<VaultCharacter> = {}): VaultCharacter {
  return {
    characterId: NORA,
    imageProvider: 'horde',
    imageReview: 'siempre',
    imageCast: 'character-only',
    replyGuidance: 'none',
    pendingPacing: 'per-note',
    recentMemories: 'off',
    xavira: null,
    horde: {
      recipe: {
        models: ['Modelo Inventado'],
        appearance: 'short grey hair',
        outfit: '',
        negative: '',
        seed: '424242',
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
    description: 'Te llamas Nora.',
    label: 'Nora',
    avatarObjectKey: null,
    createdAt: '2026-09-04T10:00:00.000Z',
    ...over,
  };
}

interface Huella {
  registros: { mensaje: string; campos: Record<string, unknown> | undefined }[];
  guardados: () => VaultCharacter[];
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
    vault: { isUnlocked: () => unlocked, onLock: () => () => undefined, beginUserWait: () => () => undefined },
    characters: {
      list: async () => guardados,
      add: async (_vault: unknown, character: unknown) => {
        escrituras += 1;
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

async function invocar(canal: string, args: unknown): Promise<Respuesta> {
  const handler = canales.get(canal);
  if (handler === undefined) throw new Error(`el canal ${canal} no se registro`);
  return (await handler(null, args)) as Respuesta;
}

const recordar = (args: unknown) => invocar(IPC_INVOKE.vaultCharacterRecentMemories, args);

describe('el resumen de sus ultimas conversaciones', () => {
  it('nace apagado: un registro sin el campo se lee como `off`', () => {
    const anterior: Record<string, unknown> = { ...personaje() };
    delete anterior.recentMemories;
    expect(vaultCharacterSchema.parse(anterior).recentMemories).toBe('off');
  });

  it('lo enciende y devuelve la lista ya aplicada', async () => {
    const huella = registrar([personaje()]);

    const respuesta = await recordar({ characterId: NORA, recent: 'recent-two' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    expect(respuesta.value.characters[0]?.recentMemories).toBe('recent-two');
    expect(huella.guardados()[0]?.recentMemories).toBe('recent-two');
  });

  it('y se vuelve a apagar, que es para lo que existe el interruptor', async () => {
    const huella = registrar([personaje({ recentMemories: 'recent-two' })]);

    const respuesta = await recordar({ characterId: NORA, recent: 'off' });
    expect(respuesta.ok).toBe(true);
    expect(huella.guardados()[0]?.recentMemories).toBe('off');
  });

  it('no toca nada mas del personaje ni los otros interruptores', async () => {
    registrar([
      personaje({ imageReview: 'nunca', imageCast: 'both', replyGuidance: 'vary-and-lead', pendingPacing: 'sparse' }),
    ]);

    const respuesta = await recordar({ characterId: NORA, recent: 'recent-two' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    const despues = respuesta.value.characters[0];
    expect(despues?.imageReview).toBe('nunca');
    expect(despues?.imageCast).toBe('both');
    expect(despues?.replyGuidance).toBe('vary-and-lead');
    expect(despues?.pendingPacing).toBe('sparse');
    expect(despues?.imageProvider).toBe('horde');
    expect(despues?.horde?.recipe.seed).toBe('424242');
    expect(despues?.label).toBe('Nora');
    expect(despues?.description).toBe('Te llamas Nora.');
  });

  it('un personaje que no esta en la boveda no escribe nada', async () => {
    const huella = registrar([personaje()]);

    const respuesta = await recordar({ characterId: OTRA, recent: 'recent-two' });
    expect(respuesta.ok).toBe(false);
    expect(huella.escrituras()).toBe(0);
  });

  it('un valor desconocido se rechaza antes de tocar el almacen', async () => {
    // un valor que no esta en el enum es justo lo que haria que un Studio
    // antiguo descartase la lista entera: no puede llegar a escribirse
    const huella = registrar([personaje()]);

    for (const recent of ['two', 'RECENT-TWO', true, 4, null]) {
      const respuesta = await recordar({ characterId: NORA, recent });
      expect(respuesta.ok, String(recent)).toBe(false);
    }
    expect(huella.escrituras()).toBe(0);
    expect(huella.guardados()[0]?.recentMemories).toBe('off');
  });

  it('con la boveda cerrada no se cambia', async () => {
    const huella = registrar([personaje()], false);

    const respuesta = await recordar({ characterId: NORA, recent: 'recent-two' });
    expect(respuesta.ok).toBe(false);
    expect(huella.escrituras()).toBe(0);
  });

  it('al registro va la decision y nada de quien es', async () => {
    const huella = registrar([personaje()]);
    await recordar({ characterId: NORA, recent: 'recent-two' });

    expect(huella.registros).toEqual([
      { mensaje: 'resumen de sus conversaciones cambiado', campos: { recientes: 'recent-two' } },
    ]);
    const escrito = JSON.stringify(huella.registros);
    expect(escrito).not.toContain(NORA);
    expect(escrito).not.toContain('Nora');
    expect(escrito).not.toContain('grey hair');
  });

  it('lo que sale cumple el contrato que el renderer da por hecho', async () => {
    registrar([personaje()]);

    const respuesta = await recordar({ characterId: NORA, recent: 'recent-two' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    const leido = vaultCharacterListResultSchema.parse(respuesta.value);
    expect(leido.characters[0]?.recentMemories).toBe('recent-two');
  });
});

describe('volver a dar de alta al mismo personaje', () => {
  it('conserva sus casillas, su receta y su avatar: no renacen con el valor por defecto', async () => {
    const huella = registrar([
      personaje({
        recentMemories: 'recent-two',
        pendingPacing: 'sparse',
        replyGuidance: 'vary-and-lead',
        imageReview: 'nunca',
        avatarObjectKey: 'abcdef0123456789abcdef0123456789',
      }),
    ]);

    const respuesta = await invocar(IPC_INVOKE.vaultCharacterImport, {
      characterId: NORA,
      label: 'Nora',
      description: 'Te llamas Nora, ficha nueva.',
    });
    expect(respuesta.ok).toBe(true);
    const nora = huella.guardados().find((entry) => entry.characterId === NORA)!;
    expect(nora).toMatchObject({
      recentMemories: 'recent-two',
      pendingPacing: 'sparse',
      replyGuidance: 'vary-and-lead',
      imageReview: 'nunca',
      avatarObjectKey: 'abcdef0123456789abcdef0123456789',
      description: 'Te llamas Nora, ficha nueva.',
      imageProvider: 'xavira',
      createdAt: '2026-09-04T10:00:00.000Z',
    });
    expect(nora.horde).not.toBeNull();
    expect(nora.xavira).toMatchObject({ characterId: NORA });
  });
});
