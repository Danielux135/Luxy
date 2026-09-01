import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, toBase64Url } from '@luxy/vault-crypto';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { LocalBlobStore, mediaDirectory } from './blob-store.js';
import { PrivateMediaStore, mediaIndexDirectory } from './media-store.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const CONVERSATION = '11111111-1111-4111-8111-111111111111';

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

const metadata = {
  mimeType: 'image/png',
  displayName: 'un-nombre-revelador.png',
  prompt: 'el prompt con el que se genero',
  width: 1024,
  height: 1024,
  durationMs: null,
  characterId: 'personaje-abc',
  provider: 'un-proveedor',
  model: 'un-modelo',
};

describe('medios privados', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateMediaStore;
  let blobs: LocalBlobStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-media-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    blobs = new LocalBlobStore(mediaDirectory(directory));
    store = new PrivateMediaStore(mediaIndexDirectory(directory), blobs);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  describe('guardar y recuperar', () => {
    it('devuelve los bytes exactos', async () => {
      const original = randomBytes(50_000);
      const stored = await store.add(vault, CONVERSATION, original, metadata);
      const read = await store.read(vault, CONVERSATION, stored.mediaId);

      expect([...read.bytes]).toEqual([...original]);
      expect(read.mimeType).toBe('image/png');
    });

    it('el archivo en disco no contiene los bytes originales', async () => {
      // un contenido uniforme sin cifrar saltaria a la vista
      const original = new Uint8Array(4096).fill(0x7f);
      await store.add(vault, CONVERSATION, original, metadata);

      const archivos = readdirSync(mediaDirectory(directory));
      const guardado = readFileSync(join(mediaDirectory(directory), archivos[0]!));
      expect(toBase64Url(new Uint8Array(guardado))).not.toContain('f39_f39_');
      expect(guardado.length).toBeGreaterThan(original.length);
    });

    it('el nombre del archivo no dice que es ni de que conversacion', async () => {
      await store.add(vault, CONVERSATION, randomBytes(1024), metadata);
      const archivos = readdirSync(mediaDirectory(directory));

      expect(archivos).toHaveLength(1);
      // todo termina en .bin: un .mp4 junto a un .png ya diria que hay video,
      // y Windows generaria miniaturas de ambos
      expect(archivos[0]).toMatch(/^[0-9a-f]{32}\.bin$/);
      expect(archivos[0]).not.toContain(CONVERSATION);
      expect(archivos[0]).not.toContain('png');
    });

    it('el indice no revela tipo, nombre, prompt ni personaje', async () => {
      await store.add(vault, CONVERSATION, randomBytes(1024), metadata);
      const raw = readFileSync(join(mediaIndexDirectory(directory), `${CONVERSATION}.jsonl`), 'utf8');

      expect(raw).not.toContain('image/png');
      expect(raw).not.toContain('un-nombre-revelador');
      expect(raw).not.toContain('el prompt con el que');
      expect(raw).not.toContain('personaje-abc');
    });

    it('los metadatos se leen sin descargar los bytes', async () => {
      const stored = await store.add(vault, CONVERSATION, randomBytes(80_000), metadata);
      const list = await store.list(vault, CONVERSATION);

      expect(list).toHaveLength(1);
      expect(list[0]?.mediaId).toBe(stored.mediaId);
      expect(list[0]?.metadata.mimeType).toBe('image/png');
      expect(list[0]?.metadata.characterId).toBe('personaje-abc');
    });

    it('sobrevive a cerrar y volver a abrir la boveda', async () => {
      const original = randomBytes(2048);
      const stored = await store.add(vault, CONVERSATION, original, metadata);
      vault.lock();

      const otra = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
        argon2Params: FAST,
      });
      await otra.unlock(PASSWORD);
      const read = await store.read(otra, CONVERSATION, stored.mediaId);
      expect([...read.bytes]).toEqual([...original]);
    });

    it('con la boveda cerrada no se puede leer nada', async () => {
      const stored = await store.add(vault, CONVERSATION, randomBytes(1024), metadata);
      vault.lock();

      await expect(store.read(vault, CONVERSATION, stored.mediaId)).rejects.toThrow(VaultError);
      await expect(store.list(vault, CONVERSATION)).rejects.toThrow(VaultError);
    });
  });

  describe('miniaturas', () => {
    it('se guardan cifradas y se recuperan', async () => {
      const thumbnail = randomBytes(3000);
      const stored = await store.add(
        vault,
        CONVERSATION,
        randomBytes(40_000),
        metadata,
        thumbnail,
      );

      expect(stored.hasThumbnail).toBe(true);
      const read = await store.readThumbnail(vault, CONVERSATION, stored.mediaId);
      expect([...read]).toEqual([...thumbnail]);
    });

    it('ocupan un archivo aparte, igual de opaco', async () => {
      await store.add(vault, CONVERSATION, randomBytes(4096), metadata, randomBytes(1024));
      const archivos = readdirSync(mediaDirectory(directory));
      // dos archivos, ambos con nombre opaco: el original y su miniatura
      expect(archivos).toHaveLength(2);
      for (const archivo of archivos) expect(archivo).toMatch(/^[0-9a-f]{32}\.bin$/);
    });

    it('sin miniatura, pedirla es un error claro', async () => {
      const stored = await store.add(vault, CONVERSATION, randomBytes(1024), metadata);
      expect(stored.hasThumbnail).toBe(false);
      await expect(store.readThumbnail(vault, CONVERSATION, stored.mediaId)).rejects.toThrow(
        'no tiene miniatura',
      );
    });
  });

  describe('borrado', () => {
    it('se lleva los bytes, no solo el indice', async () => {
      await store.add(vault, CONVERSATION, randomBytes(2048), metadata, randomBytes(512));
      await store.add(vault, CONVERSATION, randomBytes(2048), metadata);
      expect(readdirSync(mediaDirectory(directory))).toHaveLength(3);

      const borrados = await store.deleteConversation(CONVERSATION);

      expect(borrados).toBe(2);
      // sin esto quedarian archivos cifrados ocupando disco para siempre, sin
      // nada que los referenciara y sin forma de saber a que pertenecian
      expect(readdirSync(mediaDirectory(directory))).toHaveLength(0);
      expect(existsSync(join(mediaIndexDirectory(directory), `${CONVERSATION}.jsonl`))).toBe(false);
    });

    it('borrar una conversacion sin medios no falla', async () => {
      expect(await store.deleteConversation(CONVERSATION)).toBe(0);
    });
  });

  describe('cuota', () => {
    it('mide lo que ocupan los archivos cifrados', async () => {
      expect(await store.usedBytes()).toBe(0);
      await store.add(vault, CONVERSATION, randomBytes(10_000), metadata);
      const usado = await store.usedBytes();
      // el cifrado añade cabecera y etiqueta, asi que ocupa un poco mas
      expect(usado).toBeGreaterThan(10_000);
      expect(usado).toBeLessThan(10_000 + 1024);
    });
  });

  describe('el almacen de bytes', () => {
    it('rechaza una clave de objeto que no sea opaca', async () => {
      for (const clave of ['asuka.png', '../fuera', 'A'.repeat(32), 'abc']) {
        await expect(blobs.get(clave)).rejects.toThrow(VaultError);
      }
    });

    it('rechaza guardar un archivo vacio', async () => {
      await expect(blobs.put('a'.repeat(32), new Uint8Array(0))).rejects.toThrow('vacio');
    });

    it('explica que un archivo puede estar en otro equipo', async () => {
      await expect(blobs.get('b'.repeat(32))).rejects.toThrow('no esta en este equipo');
    });

    it('no deja archivos temporales tras escribir', async () => {
      await blobs.put('c'.repeat(32), randomBytes(1024));
      const temporales = readdirSync(mediaDirectory(directory)).filter((f) => f.endsWith('.tmp'));
      expect(temporales).toEqual([]);
    });
  });
});
