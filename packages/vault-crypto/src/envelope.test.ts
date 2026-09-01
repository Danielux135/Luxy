import { describe, it, expect } from 'vitest';
import {
  ENVELOPE_VERSION,
  KEY_BYTES,
  NONCE_BYTES,
  open,
  openText,
  seal,
  sealText,
} from './envelope.js';
import {
  VaultCryptoError,
  concat,
  fromBase64Url,
  fromUtf8,
  randomBytes,
  timingSafeEqual,
  toBase64Url,
  utf8,
  wipe,
} from './bytes.js';

const key = (): Uint8Array => randomBytes(KEY_BYTES);

describe('utilidades de bytes', () => {
  it('base64url va y vuelve sin perder nada', () => {
    for (const length of [0, 1, 2, 3, 31, 32, 255, 1024]) {
      const original = length === 0 ? new Uint8Array(0) : randomBytes(length);
      expect([...fromBase64Url(toBase64Url(original))]).toEqual([...original]);
    }
  });

  it('base64url no lleva relleno ni caracteres inseguros para una URL', () => {
    for (let length = 1; length <= 64; length += 1) {
      const encoded = toBase64Url(randomBytes(length));
      expect(encoded).not.toContain('=');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
    }
  });

  it('rechaza una cadena que no es base64url', () => {
    expect(() => fromBase64Url('no base64!')).toThrow(VaultCryptoError);
  });

  it('codifica cadenas grandes sin desbordar la pila', () => {
    // el troceado de toBase64Url existe justo por este caso: un bloque de video
    const big = randomBytes(600_000);
    expect([...fromBase64Url(toBase64Url(big))]).toEqual([...big]);
  });

  it('wipe deja el buffer a ceros', () => {
    const secret = randomBytes(32);
    wipe(secret);
    expect(secret.every((byte) => byte === 0)).toBe(true);
  });

  it('wipe tolera nulos sin romperse', () => {
    expect(() => wipe(null, undefined, randomBytes(4))).not.toThrow();
  });

  it('timingSafeEqual compara contenido y longitud', () => {
    const a = utf8('identico');
    expect(timingSafeEqual(a, utf8('identico'))).toBe(true);
    expect(timingSafeEqual(a, utf8('identicX'))).toBe(false);
    expect(timingSafeEqual(a, utf8('identico-mas-largo'))).toBe(false);
  });

  it('concat une en orden', () => {
    expect(fromUtf8(concat(utf8('a'), utf8('bc'), utf8('d')))).toBe('abcd');
  });
});

describe('sobre cifrado', () => {
  it('cifra y descifra el mismo contenido', async () => {
    const k = key();
    const envelope = await sealText(k, 'vault.test', 'hola boveda');
    expect(await openText(k, 'vault.test', envelope)).toBe('hola boveda');
  });

  it('el texto cifrado no contiene el original', async () => {
    const envelope = await sealText(key(), 'vault.test', 'palabra-buscable');
    expect(JSON.stringify(envelope)).not.toContain('palabra-buscable');
  });

  it('dos sobres del mismo texto son distintos', async () => {
    const k = key();
    const first = await sealText(k, 'vault.test', 'mismo texto');
    const second = await sealText(k, 'vault.test', 'mismo texto');
    // nonce aleatorio por sobre: sin esto se filtraria que el contenido se repite
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('usa un nonce del tamaño esperado', async () => {
    const envelope = await sealText(key(), 'vault.test', 'x');
    expect(fromBase64Url(envelope.nonce).length).toBe(NONCE_BYTES);
  });

  it('falla con una llave distinta', async () => {
    const envelope = await sealText(key(), 'vault.test', 'secreto');
    await expect(openText(key(), 'vault.test', envelope)).rejects.toThrow(VaultCryptoError);
  });

  it('falla si se altera un solo bit del texto cifrado', async () => {
    const k = key();
    const envelope = await sealText(k, 'vault.test', 'contenido integro');
    const bytes = fromBase64Url(envelope.ciphertext);
    bytes[0] ^= 0x01;

    await expect(
      openText(k, 'vault.test', { ...envelope, ciphertext: toBase64Url(bytes) }),
    ).rejects.toThrow('no se pudo descifrar el dato');
  });

  it('falla si se altera el nonce', async () => {
    const k = key();
    const envelope = await sealText(k, 'vault.test', 'contenido integro');
    const nonce = fromBase64Url(envelope.nonce);
    nonce[0] ^= 0x01;

    await expect(
      openText(k, 'vault.test', { ...envelope, nonce: toBase64Url(nonce) }),
    ).rejects.toThrow(VaultCryptoError);
  });

  it('un sobre de un dominio no se abre en otro', async () => {
    const k = key();
    const envelope = await sealText(k, 'vault.media', 'una imagen');
    // aunque la llave sea la correcta: el proposito va autenticado en los AAD
    await expect(openText(k, 'vault.conversation', envelope)).rejects.toThrow(VaultCryptoError);
  });

  it('no se puede reetiquetar el proposito de un sobre', async () => {
    const k = key();
    const envelope = await sealText(k, 'vault.thumbnail', 'miniatura');
    // el atacante reescribe el campo para que coincida con lo que pide quien abre
    await expect(
      openText(k, 'vault.conversation', { ...envelope, purpose: 'vault.conversation' }),
    ).rejects.toThrow(VaultCryptoError);
  });

  it('rechaza una version de formato desconocida', async () => {
    const k = key();
    const envelope = await sealText(k, 'vault.test', 'del futuro');
    await expect(
      openText(k, 'vault.test', { ...envelope, version: ENVELOPE_VERSION + 1 }),
    ).rejects.toThrow('formato de sobre desconocido');
  });

  it('rechaza una llave que no mide 32 bytes', async () => {
    await expect(sealText(randomBytes(16), 'vault.test', 'x')).rejects.toThrow(VaultCryptoError);
  });

  it('rechaza propositos vacios o con caracteres raros', async () => {
    const k = key();
    await expect(sealText(k, '', 'x')).rejects.toThrow(VaultCryptoError);
    await expect(sealText(k, 'Vault.Test', 'x')).rejects.toThrow(VaultCryptoError);
    await expect(sealText(k, 'vault test', 'x')).rejects.toThrow(VaultCryptoError);
  });

  it('conserva bytes binarios arbitrarios', async () => {
    const k = key();
    const original = randomBytes(4096);
    const opened = await open(k, 'vault.media', await seal(k, 'vault.media', original));
    expect([...opened]).toEqual([...original]);
  });

  it('conserva texto no ASCII', async () => {
    const k = key();
    const text = 'acentos áéíóú, emoji 🔒, y CJK 私は';
    expect(await openText(k, 'vault.test', await sealText(k, 'vault.test', text))).toBe(text);
  });
});
