import { describe, it, expect } from 'vitest';
import { PADDING_BLOCK, pad, paddedSize, paddingOverhead, unpad } from './padding.js';
import { KEY_BYTES, openText, sealText } from './envelope.js';
import { VaultCryptoError, fromBase64Url, randomBytes, utf8 } from './bytes.js';

describe('relleno', () => {
  it('va y vuelve sin perder nada', () => {
    for (const length of [0, 1, 100, 255, 256, 257, 5000]) {
      const original = length === 0 ? new Uint8Array(0) : randomBytes(length);
      expect([...unpad(pad(original))]).toEqual([...original]);
    }
  });

  it('el resultado siempre es multiplo del bloque', () => {
    for (const length of [0, 1, 100, 300, 1000]) {
      expect(pad(randomBytes(length || 1)).length % PADDING_BLOCK).toBe(0);
    }
  });

  it('mensajes de tamaños distintos ocupan lo mismo', () => {
    // este es el punto entero del relleno
    expect(paddedSize(10)).toBe(paddedSize(200));
    expect(pad(utf8('hola')).length).toBe(pad(utf8('x'.repeat(200))).length);
  });

  it('el coste nunca pasa de un bloque', () => {
    for (const length of [1, 100, 1000, 100_000]) {
      expect(paddingOverhead(length)).toBeLessThanOrEqual(PADDING_BLOCK);
    }
  });

  it('lo guardado antes del relleno se sigue abriendo', () => {
    // sin marca: es material anterior, y debe devolverse tal cual
    const legacy = utf8('{"v":1,"role":"user"}');
    expect([...unpad(legacy)]).toEqual([...legacy]);
  });

  it('rechaza un relleno incoherente en vez de devolver basura', () => {
    const padded = pad(utf8('hola'));
    // longitud declarada mayor que el propio bloque
    new DataView(padded.buffer).setUint32(4, 999_999, false);
    expect(() => unpad(padded)).toThrow(VaultCryptoError);
  });
});

describe('el sobre de texto oculta la longitud', () => {
  it('dos mensajes muy distintos producen sobres del mismo tamaño', async () => {
    const key = randomBytes(KEY_BYTES);
    const corto = await sealText(key, 'vault.conversation', 'hola');
    const largo = await sealText(key, 'vault.conversation', 'x'.repeat(200));

    // era exactamente lo que se filtraba antes del relleno
    expect(fromBase64Url(corto.ciphertext).length).toBe(fromBase64Url(largo.ciphertext).length);
  });

  it('sigue descifrando correctamente', async () => {
    const key = randomBytes(KEY_BYTES);
    const texto = 'un mensaje con acentos áéíóú y emoji 🔒';
    expect(await openText(key, 'vault.conversation', await sealText(key, 'vault.conversation', texto))).toBe(
      texto,
    );
  });

  it('un mensaje muy largo no paga un porcentaje, solo un bloque', async () => {
    const key = randomBytes(KEY_BYTES);
    const texto = 'y'.repeat(100_000);
    const sealed = await sealText(key, 'vault.conversation', texto);
    const bytes = fromBase64Url(sealed.ciphertext).length;
    expect(bytes).toBeLessThan(texto.length + PADDING_BLOCK + 32);
  });
});
