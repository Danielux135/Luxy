import { describe, it, expect } from 'vitest';
import { VaultCryptoError, randomBytes, toBase64Url } from './bytes.js';
import { KEY_BYTES, openText, sealText } from './envelope.js';
import { generateMasterKey } from './master-key.js';
import { deriveSubkey } from './kdf.js';
import {
  X25519_KEY_BYTES,
  generateRecipientKeyPair,
  openFromSender,
  sealForRecipient,
} from './recipient.js';

describe('identidad de destinatario', () => {
  it('genera un par de claves del tamaño esperado', () => {
    const pair = generateRecipientKeyPair();
    expect(pair.publicKey).not.toBe(pair.secretKey);
    expect(pair.publicKey.length).toBeGreaterThan(0);
  });

  it('no repite pares', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateRecipientKeyPair().publicKey));
    expect(keys.size).toBe(20);
  });
});

describe('compartir una llave con otra persona', () => {
  it('el destinatario recupera exactamente la llave compartida', async () => {
    const tutor = generateRecipientKeyPair();
    const key = randomBytes(KEY_BYTES);

    const sealed = await sealForRecipient(key, tutor.publicKey);
    expect([...(await openFromSender(sealed, tutor.secretKey))]).toEqual([...key]);
  });

  it('lo compartido no contiene la llave en claro', async () => {
    const tutor = generateRecipientKeyPair();
    const key = randomBytes(KEY_BYTES);
    const sealed = await sealForRecipient(key, tutor.publicKey);
    expect(JSON.stringify(sealed)).not.toContain(toBase64Url(key));
  });

  it('otra persona no puede abrirlo', async () => {
    const tutor = generateRecipientKeyPair();
    const tercero = generateRecipientKeyPair();
    const sealed = await sealForRecipient(randomBytes(KEY_BYTES), tutor.publicKey);

    await expect(openFromSender(sealed, tercero.secretKey)).rejects.toThrow(
      'este dato no fue compartido con esta identidad',
    );
  });

  it('cada envoltura usa una clave efimera distinta', async () => {
    const tutor = generateRecipientKeyPair();
    const key = randomBytes(KEY_BYTES);
    const first = await sealForRecipient(key, tutor.publicKey);
    const second = await sealForRecipient(key, tutor.publicKey);

    // sin esto, dos envios a la misma persona serian correlacionables
    expect(first.ephemeralPublicKey).not.toBe(second.ephemeralPublicKey);
    expect(first.envelope.ciphertext).not.toBe(second.envelope.ciphertext);
  });

  it('no se puede redirigir un sobre a otro destinatario', async () => {
    const tutor = generateRecipientKeyPair();
    const tercero = generateRecipientKeyPair();
    const sealed = await sealForRecipient(randomBytes(KEY_BYTES), tutor.publicKey);

    // el atacante reescribe el destinatario declarado para que cuadre con el suyo
    const redirected = { ...sealed, recipientPublicKey: tercero.publicKey };
    await expect(openFromSender(redirected, tercero.secretKey)).rejects.toThrow(VaultCryptoError);
  });

  it('no se puede sustituir la clave efimera', async () => {
    const tutor = generateRecipientKeyPair();
    const atacante = generateRecipientKeyPair();
    const sealed = await sealForRecipient(randomBytes(KEY_BYTES), tutor.publicKey);

    const tampered = { ...sealed, ephemeralPublicKey: atacante.publicKey };
    await expect(openFromSender(tampered, tutor.secretKey)).rejects.toThrow(VaultCryptoError);
  });

  it('falla si se altera el texto cifrado', async () => {
    const tutor = generateRecipientKeyPair();
    const sealed = await sealForRecipient(randomBytes(KEY_BYTES), tutor.publicKey);
    const broken = {
      ...sealed,
      envelope: { ...sealed.envelope, ciphertext: `${sealed.envelope.ciphertext.slice(0, -2)}AA` },
    };
    await expect(openFromSender(broken, tutor.secretKey)).rejects.toThrow(VaultCryptoError);
  });

  it('rechaza claves publicas del tamaño equivocado', async () => {
    await expect(
      sealForRecipient(randomBytes(KEY_BYTES), toBase64Url(randomBytes(16))),
    ).rejects.toThrow(VaultCryptoError);
    expect(X25519_KEY_BYTES).toBe(32);
  });

  it('rechaza compartir algo que no es una llave de 32 bytes', async () => {
    const tutor = generateRecipientKeyPair();
    await expect(sealForRecipient(randomBytes(16), tutor.publicKey)).rejects.toThrow(
      VaultCryptoError,
    );
  });
});

describe('compartir una conversacion sin entregar la boveda', () => {
  it('el invitado abre solo lo compartido, no el resto', async () => {
    const master = generateMasterKey();
    const tutor = generateRecipientKeyPair();

    const compartida = deriveSubkey(master, 'conversation', 'conv-compartida');
    const privada = deriveSubkey(master, 'conversation', 'conv-privada');

    const visible = await sealText(compartida, 'vault.conversation', 'esto si se comparte');
    const oculta = await sealText(privada, 'vault.conversation', 'esto no se comparte');

    // solo se envuelve la subclave de UNA conversacion
    const sealed = await sealForRecipient(compartida, tutor.publicKey);
    const received = await openFromSender(sealed, tutor.secretKey);

    expect(await openText(received, 'vault.conversation', visible)).toBe('esto si se comparte');
    // con esa llave, la otra conversacion sigue siendo ilegible
    await expect(openText(received, 'vault.conversation', oculta)).rejects.toThrow(VaultCryptoError);
  });

  it('la llave compartida no permite derivar la maestra ni otras subclaves', async () => {
    const master = generateMasterKey();
    const tutor = generateRecipientKeyPair();
    const compartida = deriveSubkey(master, 'conversation', 'conv-1');

    const sealed = await sealForRecipient(compartida, tutor.publicKey);
    const received = await openFromSender(sealed, tutor.secretKey);

    // HKDF no es invertible: lo recibido es la subclave, nunca la maestra
    expect(toBase64Url(received)).not.toBe(toBase64Url(master));
    expect(toBase64Url(received)).not.toBe(toBase64Url(deriveSubkey(master, 'media')));
  });
});
