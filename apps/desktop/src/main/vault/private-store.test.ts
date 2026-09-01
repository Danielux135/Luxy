import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, toBase64Url } from '@luxy/vault-crypto';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import {
  openMedia,
  openMediaMetadata,
  openMediaThumbnail,
  openTurn,
  randomObjectKey,
  sealMedia,
  sealTurn,
} from './private-store.js';

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

describe('cifrado en el cliente', () => {
  let directory: string;
  let vault: VaultService;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-private-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  describe('turnos', () => {
    const turno = {
      role: 'user' as const,
      text: 'un mensaje que no debe salir en claro',
      title: 'Titulo revelador de la conversacion',
      provider: 'xavira',
      model: 'un-modelo',
      inputTokens: 12,
      outputTokens: 340,
    };

    it('sella y vuelve a abrir sin perder nada', async () => {
      const record = await sealTurn(vault, { conversationId: CONVERSATION, sequence: 0, turn: turno });
      const { turn } = await openTurn(vault, record);

      expect(turn.text).toBe(turno.text);
      expect(turn.title).toBe(turno.title);
      expect(turn.provider).toBe('xavira');
      expect(turn.outputTokens).toBe(340);
    });

    it('el registro no contiene el texto, ni el titulo, ni el proveedor', async () => {
      const record = await sealTurn(vault, { conversationId: CONVERSATION, sequence: 0, turn: turno });
      const serialized = JSON.stringify(record);

      expect(serialized).not.toContain('un mensaje que no debe salir');
      expect(serialized).not.toContain('Titulo revelador');
      // el proveedor tambien va dentro: revelaria a que API hablas y cuanto
      expect(serialized).not.toContain('xavira');
      expect(serialized).not.toContain('un-modelo');
    });

    it('lo unico legible es lo que se acepto como metadato', async () => {
      const record = await sealTurn(vault, { conversationId: CONVERSATION, sequence: 3, turn: turno });
      expect(Object.keys(record).sort()).toEqual([
        'content',
        'conversationId',
        'createdAt',
        'privacy',
        'recordId',
        'sealedMemory',
        'sequence',
      ]);
      expect(record.sequence).toBe(3);
    });

    it('sella la memoria con una subclave distinta del turno', async () => {
      const record = await sealTurn(vault, {
        conversationId: CONVERSATION,
        sequence: 0,
        turn: turno,
        memory: {
          memory: {
            version: 1 as const,
            summary: 'resumen privado',
            facts: ['un hecho'],
            decisions: [],
            plan: [],
            openQuestions: [],
            lessons: [],
          },
        },
      });

      expect(JSON.stringify(record)).not.toContain('resumen privado');
      const { memory } = await openTurn(vault, record);
      expect(memory?.memory.summary).toBe('resumen privado');
      expect(memory?.memory.facts).toEqual(['un hecho']);
    });

    it('sin memoria, el campo queda nulo', async () => {
      const record = await sealTurn(vault, { conversationId: CONVERSATION, sequence: 0, turn: turno });
      expect(record.sealedMemory).toBeNull();
      expect((await openTurn(vault, record)).memory).toBeNull();
    });

    it('otra conversacion no puede abrirlo', async () => {
      const record = await sealTurn(vault, { conversationId: CONVERSATION, sequence: 0, turn: turno });
      const ajeno = { ...record, conversationId: '22222222-2222-4222-8222-222222222222' };
      // la subclave depende del identificador: cambiarlo no da acceso
      await expect(openTurn(vault, ajeno)).rejects.toThrow();
    });

    it('con la boveda bloqueada no se puede sellar ni abrir', async () => {
      const record = await sealTurn(vault, { conversationId: CONVERSATION, sequence: 0, turn: turno });
      vault.lock();

      await expect(
        sealTurn(vault, { conversationId: CONVERSATION, sequence: 1, turn: turno }),
      ).rejects.toThrow(VaultError);
      await expect(openTurn(vault, record)).rejects.toThrow('la boveda esta bloqueada');
    });

    it('un contenido alterado no se abre', async () => {
      const record = await sealTurn(vault, { conversationId: CONVERSATION, sequence: 0, turn: turno });
      const roto = {
        ...record,
        content: { ...record.content, ciphertext: `${record.content.ciphertext.slice(0, -2)}AA` },
      };
      await expect(openTurn(vault, roto)).rejects.toThrow();
    });

    it('conserva texto largo y no ASCII', async () => {
      const texto = `${'línea con acentos áéíóú y emoji 🔒\n'.repeat(500)}fin`;
      const record = await sealTurn(vault, {
        conversationId: CONVERSATION,
        sequence: 0,
        turn: { ...turno, text: texto },
      });
      expect((await openTurn(vault, record)).turn.text).toBe(texto);
    });
  });

  describe('imagenes y videos', () => {
    const metadata = {
      mimeType: 'video/mp4',
      displayName: 'un-nombre-revelador.mp4',
      prompt: 'el prompt con el que se genero',
      width: 1080,
      height: 1920,
      durationMs: 5000,
      characterId: 'personaje-abc',
      provider: 'xavira',
      model: 'un-modelo',
    };

    it('sella y recupera los bytes exactos', async () => {
      const bytes = randomBytes(64_000);
      const sealed = await sealMedia(vault, { conversationId: CONVERSATION, bytes, metadata });
      const recovered = await openMedia(vault, sealed.record, sealed.blob);
      expect([...recovered]).toEqual([...bytes]);
    });

    it('el registro no revela tipo, nombre, prompt ni personaje', async () => {
      const sealed = await sealMedia(vault, {
        conversationId: CONVERSATION,
        bytes: randomBytes(1024),
        metadata,
      });
      const serialized = JSON.stringify(sealed.record);

      expect(serialized).not.toContain('video/mp4');
      expect(serialized).not.toContain('un-nombre-revelador');
      expect(serialized).not.toContain('el prompt con el que');
      expect(serialized).not.toContain('personaje-abc');
      expect(serialized).not.toContain('xavira');
    });

    it('los metadatos se leen sin descargar el archivo', async () => {
      const sealed = await sealMedia(vault, {
        conversationId: CONVERSATION,
        bytes: randomBytes(1024),
        metadata,
      });
      // solo con el registro, sin tocar sealed.blob
      const opened = await openMediaMetadata(vault, sealed.record);
      expect(opened.mimeType).toBe('video/mp4');
      expect(opened.characterId).toBe('personaje-abc');
    });

    it('la clave del objeto es opaca y distinta cada vez', async () => {
      const bytes = randomBytes(512);
      const a = await sealMedia(vault, { conversationId: CONVERSATION, bytes, metadata });
      const b = await sealMedia(vault, { conversationId: CONVERSATION, bytes, metadata });

      expect(a.record.objectKey).toMatch(/^[0-9a-f]{32}$/);
      // el mismo contenido dos veces no comparte clave: no se puede deducir
      // que dos archivos son iguales mirando el almacen
      expect(a.record.objectKey).not.toBe(b.record.objectKey);
    });

    it('la miniatura tambien se cifra, y con su propia subclave', async () => {
      const thumbnail = randomBytes(2048);
      const sealed = await sealMedia(vault, {
        conversationId: CONVERSATION,
        bytes: randomBytes(8192),
        metadata,
        thumbnail,
      });

      expect(sealed.thumbnailBlob).not.toBeNull();
      // el fallo clasico: cifrar el video y dejar la miniatura legible al lado
      expect(toBase64Url(sealed.thumbnailBlob!)).not.toBe(toBase64Url(thumbnail));
      expect(sealed.record.thumbnailObjectKey).toMatch(/^[0-9a-f]{32}$/);

      const recovered = await openMediaThumbnail(vault, sealed.record, sealed.thumbnailBlob!);
      expect([...recovered]).toEqual([...thumbnail]);
    });

    it('la miniatura no se abre con la llave del original', async () => {
      const sealed = await sealMedia(vault, {
        conversationId: CONVERSATION,
        bytes: randomBytes(4096),
        metadata,
        thumbnail: randomBytes(1024),
      });
      await expect(openMedia(vault, sealed.record, sealed.thumbnailBlob!)).rejects.toThrow();
    });

    it('sin miniatura no se inventa ninguna', async () => {
      const sealed = await sealMedia(vault, {
        conversationId: CONVERSATION,
        bytes: randomBytes(1024),
        metadata,
      });
      expect(sealed.thumbnailBlob).toBeNull();
      expect(sealed.record.thumbnailObjectKey).toBeNull();
      await expect(openMediaThumbnail(vault, sealed.record, randomBytes(64))).rejects.toThrow(
        'no tiene miniatura',
      );
    });

    it('el tamaño declarado es el del archivo cifrado', async () => {
      const sealed = await sealMedia(vault, {
        conversationId: CONVERSATION,
        bytes: randomBytes(10_000),
        metadata,
      });
      // para cuotas hay que contar lo que ocupa de verdad en el almacen
      expect(sealed.record.byteSize).toBe(sealed.blob.length);
      expect(sealed.record.byteSize).toBeGreaterThan(10_000);
    });

    it('rechaza un archivo vacio', async () => {
      await expect(
        sealMedia(vault, {
          conversationId: CONVERSATION,
          bytes: new Uint8Array(0),
          metadata,
        }),
      ).rejects.toThrow('esta vacio');
    });

    it('un medio de otra conversacion no se abre cambiando el identificador', async () => {
      const sealed = await sealMedia(vault, {
        conversationId: CONVERSATION,
        bytes: randomBytes(1024),
        metadata,
      });
      const ajeno = { ...sealed.record, mediaId: '33333333-3333-4333-8333-333333333333' };
      await expect(openMedia(vault, ajeno, sealed.blob)).rejects.toThrow();
    });
  });

  describe('claves de objeto', () => {
    it('son 32 caracteres hexadecimales y no se repiten', () => {
      const keys = new Set(Array.from({ length: 200 }, () => randomObjectKey()));
      expect(keys.size).toBe(200);
      for (const key of keys) expect(key).toMatch(/^[0-9a-f]{32}$/);
    });
  });
});
