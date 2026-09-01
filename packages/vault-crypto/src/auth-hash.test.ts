import { describe, it, expect } from 'vitest';
import { deriveAuthHash, deriveSubkey, deriveVaultId } from './kdf.js';
import { generateMasterKey } from './master-key.js';
import { toBase64Url } from './bytes.js';

const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const PASSWORD = 'una frase larga de prueba';

describe('hash de acceso', () => {
  it('es determinista', async () => {
    const master = generateMasterKey();
    const uno = await deriveAuthHash(master, PASSWORD, FAST);
    const dos = await deriveAuthHash(master, PASSWORD, FAST);
    expect(uno).toBe(dos);
  });

  it('cambia con la contraseña', async () => {
    const master = generateMasterKey();
    const uno = await deriveAuthHash(master, PASSWORD, FAST);
    const dos = await deriveAuthHash(master, 'otra frase distinta', FAST);
    expect(uno).not.toBe(dos);
  });

  it('cambia con la llave maestra', async () => {
    const uno = await deriveAuthHash(generateMasterKey(), PASSWORD, FAST);
    const dos = await deriveAuthHash(generateMasterKey(), PASSWORD, FAST);
    expect(uno).not.toBe(dos);
  });

  it('NO coincide con la llave maestra ni con ninguna subclave', async () => {
    const master = generateMasterKey();
    const hash = await deriveAuthHash(master, PASSWORD, FAST);

    // si coincidiera, enviarlo al servidor le entregaria material de cifrado
    expect(hash).not.toBe(toBase64Url(master));
    for (const dominio of ['index', 'conversation', 'memory', 'media', 'thumbnail'] as const) {
      expect(hash).not.toBe(toBase64Url(deriveSubkey(master, dominio)));
    }
  });

  it('NO coincide con el identificador de boveda', async () => {
    const master = generateMasterKey();
    // los dos viajan al servidor: si fueran iguales, uno de los dos sobraria y
    // seria señal de que algo se esta derivando mal
    expect(await deriveAuthHash(master, PASSWORD, FAST)).not.toBe(deriveVaultId(master));
  });

  it('rechaza una contraseña vacia y una maestra de tamaño incorrecto', async () => {
    await expect(deriveAuthHash(generateMasterKey(), '', FAST)).rejects.toThrow();
    await expect(deriveAuthHash(new Uint8Array(16), PASSWORD, FAST)).rejects.toThrow();
  });

  it('tiene la forma que el servidor va a guardar', async () => {
    const hash = await deriveAuthHash(generateMasterKey(), PASSWORD, FAST);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
