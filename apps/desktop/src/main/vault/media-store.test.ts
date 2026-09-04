import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, sealText, toBase64Url, wipe } from '@luxy/vault-crypto';
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

  describe('corregir el pie de foto', () => {
    const objetos = (): string[] => readdirSync(mediaDirectory(directory));
    const indice = (): string =>
      readFileSync(join(mediaIndexDirectory(directory), `${CONVERSATION}.jsonl`), 'utf8');

    it('lo cambia sin tocar los bytes de la imagen', async () => {
      const original = randomBytes(20_000);
      const stored = await store.add(vault, CONVERSATION, original, metadata);
      const cifradoAntes = readFileSync(join(mediaDirectory(directory), objetos()[0]!));

      await store.setCaption(vault, CONVERSATION, stored.mediaId, 'ella mirando por la ventana');

      // el archivo cifrado es byte a byte el mismo: solo se resella la
      // metadata, y volver a cifrar la imagen entera no compraria nada
      const cifradoDespues = readFileSync(join(mediaDirectory(directory), objetos()[0]!));
      expect(cifradoDespues.equals(cifradoAntes)).toBe(true);

      const leido = await store.read(vault, CONVERSATION, stored.mediaId);
      expect([...leido.bytes]).toEqual([...original]);

      const lista = await store.list(vault, CONVERSATION);
      expect(lista[0]?.metadata.caption).toBe('ella mirando por la ventana');
    });

    it('conserva el prompt y todo lo demas de la metadata', async () => {
      const stored = await store.add(vault, CONVERSATION, randomBytes(2048), metadata);
      const antes = (await store.list(vault, CONVERSATION))[0]!.metadata;
      expect(antes.caption).toBeNull();

      await store.setCaption(vault, CONVERSATION, stored.mediaId, 'un pie de foto corregido');

      const despues = (await store.list(vault, CONVERSATION))[0]!.metadata;
      // corregir lo que se VE no puede borrar lo que se PIDIO: es lo unico que
      // explica por que la imagen salio como salio
      expect(despues.prompt).toBe('el prompt con el que se genero');
      expect(despues).toEqual({ ...antes, caption: 'un pie de foto corregido' });
    });

    it('no se lleva por delante los demas medios de la conversacion', async () => {
      const primero = await store.add(vault, CONVERSATION, randomBytes(1024), metadata);
      const segundo = await store.add(vault, CONVERSATION, randomBytes(1024), metadata);

      await store.setCaption(vault, CONVERSATION, primero.mediaId, 'solo el primero');

      // el indice se reescribe entero, asi que perder una linea es el fallo a
      // vigilar: los dos siguen ahi y en el mismo orden
      const lista = await store.list(vault, CONVERSATION);
      expect(lista.map((item) => item.mediaId)).toEqual([primero.mediaId, segundo.mediaId]);
      expect(lista[1]?.metadata.caption).toBeNull();
    });

    it('sobrevive a cerrar y volver a abrir la boveda', async () => {
      const stored = await store.add(vault, CONVERSATION, randomBytes(2048), metadata);
      await store.setCaption(vault, CONVERSATION, stored.mediaId, 'lo que se ve, ya corregido');
      vault.lock();

      const otra = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
        argon2Params: FAST,
      });
      await otra.unlock(PASSWORD);
      const lista = await store.list(otra, CONVERSATION);
      expect(lista[0]?.metadata.caption).toBe('lo que se ve, ya corregido');
    });

    it('no queda en claro en ningun archivo', async () => {
      const stored = await store.add(vault, CONVERSATION, randomBytes(2048), metadata, randomBytes(512));
      await store.setCaption(vault, CONVERSATION, stored.mediaId, 'una frase que describe algo privado');

      // describe el contenido, asi que filtrarlo seria tan malo como filtrar la
      // imagen: ni en el indice ni en los objetos
      expect(indice()).not.toContain('una frase que describe');
      for (const archivo of objetos()) {
        const bytes = readFileSync(join(mediaDirectory(directory), archivo)).toString('latin1');
        expect(bytes).not.toContain('una frase que describe');
      }
      // y ningun temporal a medio escribir con el texto dentro
      expect(readdirSync(mediaIndexDirectory(directory)).filter((f) => f.endsWith('.tmp'))).toEqual(
        [],
      );
    });

    it('un medio que no existe es un error, no un cambio silencioso', async () => {
      await store.add(vault, CONVERSATION, randomBytes(1024), metadata);

      await expect(
        store.setCaption(vault, CONVERSATION, '99999999-9999-4999-8999-999999999999', 'da igual'),
      ).rejects.toThrow('no existe en esta conversacion');
    });

    it('un medio guardado antes de que existiera el campo se lee con null', async () => {
      const stored = await store.add(vault, CONVERSATION, randomBytes(2048), metadata);
      const record = store.rawRecords(CONVERSATION)[0]!;

      // se resella el payload TAL Y COMO se escribia antes de este campo, sin
      // el: es lo que hay en el disco de quien ya usaba Luxy
      const key = vault.subkeyFor('media', record.mediaId);
      const contenido = await sealText(
        key,
        'vault.media',
        JSON.stringify({
          v: 1,
          mimeType: 'image/png',
          displayName: 'foto.png',
          prompt: 'lo que se pidio entonces',
          width: null,
          height: null,
          durationMs: null,
          characterId: null,
          provider: null,
          model: null,
          createdAt: new Date().toISOString(),
        }),
      );
      wipe(key);
      writeFileSync(
        join(mediaIndexDirectory(directory), `${CONVERSATION}.jsonl`),
        `${JSON.stringify({ ...record, content: contenido })}\n`,
        'utf8',
      );

      const lista = await store.list(vault, CONVERSATION);
      expect(lista[0]?.metadata.caption).toBeNull();
      expect(lista[0]?.metadata.prompt).toBe('lo que se pidio entonces');

      // y se puede corregir sin inventar nada de lo que falta
      await store.setCaption(vault, CONVERSATION, stored.mediaId, 'lo que se ve ahora');
      const despues = (await store.list(vault, CONVERSATION))[0]!.metadata;
      expect(despues.caption).toBe('lo que se ve ahora');
      expect(despues.prompt).toBe('lo que se pidio entonces');
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
