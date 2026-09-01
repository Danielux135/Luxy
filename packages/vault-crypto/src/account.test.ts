import { describe, it, expect } from 'vitest';
import { createAccount, openAccount, rewrapAccountPassword } from './account.js';
import { deriveSubkey } from './kdf.js';
import { openText, sealText } from './envelope.js';
import { toBase64Url, VaultCryptoError } from './bytes.js';

const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const PASSWORD = 'una frase larga de prueba';

describe('crear cuenta', () => {
  it('lo que va al servidor no abre nada', async () => {
    const { registration } = await createAccount(PASSWORD, FAST);
    const enviado = JSON.stringify(registration);

    // ni la contraseña ni la llave maestra en claro
    expect(enviado).not.toContain(PASSWORD);
    // la llave envuelta es un sobre, no la llave
    expect(registration.wrappedMasterKey.purpose).toBe('vault.account.masterkey');
    // los campos son exactamente los cinco que el esquema del servidor espera
    expect(Object.keys(registration).sort()).toEqual([
      'argon2Params',
      'authHash',
      'authSalt',
      'vaultId',
      'wrappedMasterKey',
    ]);
  });

  it('deja la boveda abierta y usable', async () => {
    const { account } = await createAccount(PASSWORD, FAST);
    const key = deriveSubkey(account.masterKey, 'conversation', 'c1');
    const envelope = await sealText(key, 'vault.conversation', 'hola');
    expect(await openText(key, 'vault.conversation', envelope)).toBe('hola');
  });

  it('da una clave de recuperacion con formato', async () => {
    const { recoveryKey } = await createAccount(PASSWORD, FAST);
    expect(recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$/);
  });

  it('dos cuentas con la misma contraseña son distintas', async () => {
    const uno = await createAccount(PASSWORD, FAST);
    const dos = await createAccount(PASSWORD, FAST);
    // la llave maestra es aleatoria: misma contraseña, distinta boveda
    expect(uno.registration.vaultId).not.toBe(dos.registration.vaultId);
    expect(uno.registration.authHash).not.toBe(dos.registration.authHash);
  });
});

describe('abrir cuenta', () => {
  it('la contraseña correcta recupera la misma boveda', async () => {
    const { registration, account } = await createAccount(PASSWORD, FAST);
    const opened = await openAccount(PASSWORD, registration);

    expect(toBase64Url(opened.masterKey)).toBe(toBase64Url(account.masterKey));
    expect(opened.vaultId).toBe(account.vaultId);
    expect(opened.authHash).toBe(account.authHash);
  });

  it('la contraseña incorrecta no abre', async () => {
    const { registration } = await createAccount(PASSWORD, FAST);
    await expect(openAccount('otra frase distinta', registration)).rejects.toThrow(VaultCryptoError);
  });

  it('el hash de acceso al abrir es el que el servidor guardo', async () => {
    const { registration } = await createAccount(PASSWORD, FAST);
    // asi el servidor puede verificar la contraseña sin conocerla
    const opened = await openAccount(PASSWORD, registration);
    expect(opened.authHash).toBe(registration.authHash);
  });

  it('rechaza una sal manipulada', async () => {
    const { registration } = await createAccount(PASSWORD, FAST);
    await expect(
      openAccount(PASSWORD, { ...registration, authSalt: 'AAAA' }),
    ).rejects.toThrow(VaultCryptoError);
  });
});

describe('cambiar contraseña', () => {
  it('la nueva abre, la antigua no, y la boveda no se recifra', async () => {
    const { account } = await createAccount(PASSWORD, FAST);

    // un dato cifrado con una subclave de la maestra ANTES del cambio
    const key = deriveSubkey(account.masterKey, 'conversation', 'c1');
    const envelope = await sealText(key, 'vault.conversation', 'escrito antes');

    const renewed = await rewrapAccountPassword(account.masterKey, 'contraseña nueva larga', FAST);
    const abierta = await openAccount('contraseña nueva larga', {
      authSalt: renewed.authSalt,
      argon2Params: renewed.argon2Params,
      wrappedMasterKey: renewed.wrappedMasterKey,
    });

    // la maestra es la misma: el dato de antes se sigue abriendo
    const mismaKey = deriveSubkey(abierta.masterKey, 'conversation', 'c1');
    expect(await openText(mismaKey, 'vault.conversation', envelope)).toBe('escrito antes');

    await expect(
      openAccount(PASSWORD, {
        authSalt: renewed.authSalt,
        argon2Params: renewed.argon2Params,
        wrappedMasterKey: renewed.wrappedMasterKey,
      }),
    ).rejects.toThrow();
  });

  it('el hash de acceso cambia con la contraseña', async () => {
    const { registration, account } = await createAccount(PASSWORD, FAST);
    const renewed = await rewrapAccountPassword(account.masterKey, 'otra distinta larga', FAST);
    expect(renewed.authHash).not.toBe(registration.authHash);
  });
});
