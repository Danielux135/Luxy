// el interruptor de las notas de direccion contra la autocopia (`D-102`),
// cruzando el IPC.
//
// Lo mismo que el de `imageCast`: el almacen se prueba en
// `character-store.test.ts` y aqui va lo que solo pasa en el canal. Que el verbo
// existe y enciende y apaga, que rechaza un valor desconocido sin escribir, que
// un personaje que no esta no escribe, que al registro no va quien es, y que los
// demas verbos no lo mueven. Todo el texto es INVENTADO.
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
    vault: { isUnlocked: () => unlocked, onLock: () => () => undefined },
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

const guiar = (args: unknown) => invocar(IPC_INVOKE.vaultCharacterReplyGuidance, args);

describe('las notas de direccion de un personaje', () => {
  it('nace apagado: un registro sin el campo se lee como `none`', () => {
    const anterior: Record<string, unknown> = { ...personaje() };
    delete anterior.replyGuidance;
    expect(vaultCharacterSchema.parse(anterior).replyGuidance).toBe('none');
  });

  it('las enciende y devuelve la lista ya aplicada', async () => {
    const huella = registrar([personaje()]);

    const respuesta = await guiar({ characterId: NORA, guidance: 'vary-and-lead' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    expect(respuesta.value.characters[0]?.replyGuidance).toBe('vary-and-lead');
    expect(huella.guardados()[0]?.replyGuidance).toBe('vary-and-lead');
  });

  it('y se vuelven a apagar, que es para lo que existe el interruptor', async () => {
    const huella = registrar([personaje({ replyGuidance: 'vary-and-lead' })]);

    const respuesta = await guiar({ characterId: NORA, guidance: 'none' });
    expect(respuesta.ok).toBe(true);
    expect(huella.guardados()[0]?.replyGuidance).toBe('none');
  });

  it('no toca nada mas del personaje ni los otros interruptores', async () => {
    registrar([personaje({ imageReview: 'nunca', imageCast: 'both' })]);

    const respuesta = await guiar({ characterId: NORA, guidance: 'vary-and-lead' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    const despues = respuesta.value.characters[0];
    expect(despues?.imageReview).toBe('nunca');
    expect(despues?.imageCast).toBe('both');
    expect(despues?.imageProvider).toBe('horde');
    expect(despues?.horde?.recipe.seed).toBe('424242');
    expect(despues?.label).toBe('Nora');
    expect(despues?.description).toBe('Te llamas Nora.');
  });

  it('un personaje que no esta en la boveda no escribe nada', async () => {
    const huella = registrar([personaje()]);

    const respuesta = await guiar({ characterId: OTRA, guidance: 'vary-and-lead' });
    expect(respuesta.ok).toBe(false);
    expect(huella.escrituras()).toBe(0);
  });

  it('un valor desconocido se rechaza antes de tocar el almacen', async () => {
    // un valor que no esta en el enum es justo lo que haria que un Studio
    // antiguo descartase la lista entera: no puede llegar a escribirse
    const huella = registrar([personaje()]);

    for (const guidance of ['vary', 'lead', true, 'VARY-AND-LEAD']) {
      const respuesta = await guiar({ characterId: NORA, guidance });
      expect(respuesta.ok, String(guidance)).toBe(false);
    }
    expect(huella.escrituras()).toBe(0);
    expect(huella.guardados()[0]?.replyGuidance).toBe('none');
  });

  it('con la boveda cerrada no se cambia', async () => {
    const huella = registrar([personaje()], false);

    const respuesta = await guiar({ characterId: NORA, guidance: 'vary-and-lead' });
    expect(respuesta.ok).toBe(false);
    expect(huella.escrituras()).toBe(0);
  });

  it('al registro va la decision y nada de quien es', async () => {
    const huella = registrar([personaje()]);
    await guiar({ characterId: NORA, guidance: 'vary-and-lead' });

    expect(huella.registros).toEqual([
      { mensaje: 'notas de direccion cambiadas', campos: { notas: 'vary-and-lead' } },
    ]);
    const escrito = JSON.stringify(huella.registros);
    expect(escrito).not.toContain(NORA);
    expect(escrito).not.toContain('Nora');
    expect(escrito).not.toContain('grey hair');
  });

  it('lo que sale cumple el contrato que el renderer da por hecho', async () => {
    registrar([personaje()]);

    const respuesta = await guiar({ characterId: NORA, guidance: 'vary-and-lead' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    const leido = vaultCharacterListResultSchema.parse(respuesta.value);
    expect(leido.characters[0]?.replyGuidance).toBe('vary-and-lead');
  });
});

describe('los otros verbos no mueven este interruptor', () => {
  it('guardar la receta lo conserva', async () => {
    // la trampa de `add()`: hace `parse()`, y un campo con defecto que no viaje
    // RENACE apagado. Encenderlo y despues corregir la receta lo apagaria solo
    const receta = personaje().horde?.recipe;
    if (receta === undefined) throw new Error('la receta de prueba no esta');
    const huella = registrar([personaje({ replyGuidance: 'vary-and-lead' })]);

    const respuesta = await invocar(IPC_INVOKE.vaultHordeCharacterSave, {
      characterId: NORA,
      label: 'Nora',
      description: 'Te llamas Nora.',
      recipe: { ...receta, steps: 35 },
    });

    expect(respuesta.ok).toBe(true);
    expect(huella.guardados()[0]?.replyGuidance).toBe('vary-and-lead');
    expect(huella.guardados()[0]?.horde?.recipe.steps).toBe(35);
  });

  it('ni la revision, ni el reparto, ni el proveedor', async () => {
    const huella = registrar([personaje({ replyGuidance: 'vary-and-lead' })]);

    expect(
      (await invocar(IPC_INVOKE.vaultCharacterImageReview, { characterId: NORA, review: 'nunca' }))
        .ok,
    ).toBe(true);
    expect(
      (await invocar(IPC_INVOKE.vaultCharacterImageCast, { characterId: NORA, cast: 'both' })).ok,
    ).toBe(true);
    expect(
      (
        await invocar(IPC_INVOKE.vaultCharacterImageProvider, {
          characterId: NORA,
          provider: 'horde',
        })
      ).ok,
    ).toBe(true);

    expect(huella.guardados()[0]?.replyGuidance).toBe('vary-and-lead');
    expect(huella.guardados()[0]?.imageReview).toBe('nunca');
    expect(huella.guardados()[0]?.imageCast).toBe('both');
  });

  it('y cambiar este no mueve los otros', async () => {
    const huella = registrar([personaje({ imageReview: 'nunca', imageCast: 'both' })]);
    await guiar({ characterId: NORA, guidance: 'vary-and-lead' });
    await guiar({ characterId: NORA, guidance: 'none' });

    expect(huella.guardados()[0]?.imageReview).toBe('nunca');
    expect(huella.guardados()[0]?.imageCast).toBe('both');
  });
});
