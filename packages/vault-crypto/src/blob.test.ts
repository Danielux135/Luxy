import { describe, it, expect } from 'vitest';
import { BLOB_HEADER_BYTES, openBlob, sealBlob, sealedBlobSize } from './blob.js';
import { KEY_BYTES, sealText } from './envelope.js';
import { VaultCryptoError, randomBytes, toBase64Url } from './bytes.js';

const key = (): Uint8Array => randomBytes(KEY_BYTES);

describe('sobre binario', () => {
  it('cifra y descifra los mismos bytes', async () => {
    const k = key();
    const original = randomBytes(4096);
    expect([...(await openBlob(k, 'vault.media', await sealBlob(k, 'vault.media', original)))]).toEqual(
      [...original],
    );
  });

  it('no infla como base64: solo cabecera y etiqueta', async () => {
    const k = key();
    const original = randomBytes(100_000);
    const blob = await sealBlob(k, 'vault.media', original);

    // 13 de cabecera + 16 de etiqueta = 29 bytes fijos, no un 33%
    expect(blob.length).toBe(original.length + BLOB_HEADER_BYTES + 16);
    expect(blob.length).toBe(sealedBlobSize(original.length));

    const comoJson = await sealText(k, 'vault.media', 'x'.repeat(100_000));
    expect(comoJson.ciphertext.length).toBeGreaterThan(blob.length * 1.3);
  });

  it('el blob no contiene los bytes originales', async () => {
    const original = new Uint8Array(2048).fill(0xab);
    const blob = await sealBlob(key(), 'vault.media', original);
    // un contenido uniforme sin cifrar se veria de inmediato
    expect(toBase64Url(blob.subarray(BLOB_HEADER_BYTES))).not.toContain('q6ur');
  });

  it('dos cifrados del mismo contenido son distintos', async () => {
    const k = key();
    const original = randomBytes(1024);
    const a = await sealBlob(k, 'vault.media', original);
    const b = await sealBlob(k, 'vault.media', original);
    expect(toBase64Url(a)).not.toBe(toBase64Url(b));
  });

  it('falla con otra llave', async () => {
    const blob = await sealBlob(key(), 'vault.media', randomBytes(64));
    await expect(openBlob(key(), 'vault.media', blob)).rejects.toThrow(VaultCryptoError);
  });

  it('falla si se altera un solo byte', async () => {
    const k = key();
    const blob = await sealBlob(k, 'vault.media', randomBytes(1024));
    blob[BLOB_HEADER_BYTES + 10] ^= 0x01;
    await expect(openBlob(k, 'vault.media', blob)).rejects.toThrow('no se pudo descifrar');
  });

  it('falla si se altera el nonce', async () => {
    const k = key();
    const blob = await sealBlob(k, 'vault.media', randomBytes(1024));
    blob[3] ^= 0x01;
    await expect(openBlob(k, 'vault.media', blob)).rejects.toThrow(VaultCryptoError);
  });

  it('una miniatura no se abre como si fuera el original', async () => {
    const k = key();
    const blob = await sealBlob(k, 'vault.thumbnail', randomBytes(512));
    // el proposito lo aporta quien abre y va autenticado: no hay campo que tocar
    await expect(openBlob(k, 'vault.media', blob)).rejects.toThrow(VaultCryptoError);
  });

  it('rechaza una version desconocida', async () => {
    const k = key();
    const blob = await sealBlob(k, 'vault.media', randomBytes(64));
    blob[0] = 99;
    await expect(openBlob(k, 'vault.media', blob)).rejects.toThrow('formato de archivo desconocido');
  });

  it('rechaza un blob truncado', async () => {
    const k = key();
    const blob = await sealBlob(k, 'vault.media', randomBytes(64));
    await expect(openBlob(k, 'vault.media', blob.subarray(0, BLOB_HEADER_BYTES))).rejects.toThrow(
      'incompleto',
    );
  });

  it('aguanta un contenido del tamaño de un video corto', async () => {
    const k = key();
    // 8 MiB: suficiente para cruzar los limites de troceado sin alargar la suite
    const original = randomBytes(8 * 1024 * 1024);
    const recovered = await openBlob(k, 'vault.media', await sealBlob(k, 'vault.media', original));
    expect(recovered.length).toBe(original.length);
    expect(recovered[0]).toBe(original[0]);
    expect(recovered[recovered.length - 1]).toBe(original[original.length - 1]);
  });
});
