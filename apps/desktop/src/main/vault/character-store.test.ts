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
import { VaultCharacterStore, charactersFilePath } from './character-store.js';
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
  modelId: 'anime-pure-v1',
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
});
