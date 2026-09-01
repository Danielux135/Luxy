import { describe, it, expect } from 'vitest';
import {
  generateMasterKey,
  generateRecipientKeyPair,
  generateRecoveryKey,
  sealForRecipient,
  sealText,
  wrapMasterKey,
  wrapMasterKeyForDevice,
  deriveSubkey,
  randomBytes,
  KEY_BYTES,
} from '@luxy/vault-crypto';
import {
  CONVERSATION_PRIVACY,
  FORBIDDEN_PLAINTEXT_FIELDS,
  argon2ParamsSchema,
  assertNoPlaintextLeak,
  conversationPrivacySchema,
  findPlaintextLeaks,
  keyWrapSchema,
  privateMediaSchema,
  privateRecordSchema,
  sealedEnvelopeSchema,
  sealedForRecipientSchema,
  shareGrantSchema,
  shareInviteSchema,
  telegramBridgeSchema,
  vaultPublicKeySchema,
} from './vault.js';

/** Argon2 con el minimo aceptado: aqui se valida forma, no coste */
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;

const uuid = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

describe('nivel de privacidad', () => {
  it('solo admite cloud y private', () => {
    expect(CONVERSATION_PRIVACY).toEqual(['cloud', 'private']);
    expect(conversationPrivacySchema.safeParse('private').success).toBe(true);
    // no hay estado intermedio a proposito
    expect(conversationPrivacySchema.safeParse('semi').success).toBe(false);
  });
});

describe('el contrato coincide con la criptografia real', () => {
  it('un sobre producido por vault-crypto valida contra el esquema', async () => {
    const envelope = await sealText(randomBytes(KEY_BYTES), 'vault.conversation', 'contenido');
    // si las dos definiciones se separan, esta prueba lo dice
    expect(sealedEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it('acepta todos los propositos que el paquete de cripto usa de verdad', async () => {
    const key = randomBytes(KEY_BYTES);
    for (const purpose of ['vault.conversation', 'vault.media', 'vault.thumbnail', 'vault.memory']) {
      const envelope = await sealText(key, purpose, 'x');
      expect(sealedEnvelopeSchema.safeParse(envelope).success).toBe(true);
    }
  });

  it('rechaza un proposito que no esta en la lista cerrada', async () => {
    const envelope = await sealText(randomBytes(KEY_BYTES), 'vault.inventado', 'x');
    expect(sealedEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });

  it('el nonce tiene exactamente la longitud declarada', async () => {
    const envelope = await sealText(randomBytes(KEY_BYTES), 'vault.media', 'x');
    expect(envelope.nonce.length).toBe(16);
  });

  it('las tres envolturas de llave maestra validan', async () => {
    const master = generateMasterKey();
    const password = await wrapMasterKey(master, 'contraseña', 'password', FAST);
    const recovery = await wrapMasterKey(master, generateRecoveryKey(), 'recovery', FAST);
    const device = await wrapMasterKeyForDevice(master, randomBytes(KEY_BYTES));

    for (const wrap of [password, recovery, device]) {
      const parsed = keyWrapSchema.safeParse(wrap);
      expect(parsed.success).toBe(true);
    }
  });

  it('la sal real tiene la longitud que el esquema exige', async () => {
    const wrap = await wrapMasterKey(generateMasterKey(), 'contraseña', 'password', FAST);
    expect(wrap.salt?.length).toBe(22);
  });

  it('una envoltura de contraseña sin sal se rechaza', async () => {
    const wrap = await wrapMasterKey(generateMasterKey(), 'contraseña', 'password', FAST);
    expect(keyWrapSchema.safeParse({ ...wrap, salt: null }).success).toBe(false);
    expect(keyWrapSchema.safeParse({ ...wrap, params: null }).success).toBe(false);
  });

  it('una envoltura de equipo con sal se rechaza', async () => {
    const wrap = await wrapMasterKeyForDevice(generateMasterKey(), randomBytes(KEY_BYTES));
    const inventada = { ...wrap, salt: 'A'.repeat(22), params: { ...FAST } };
    expect(keyWrapSchema.safeParse(inventada).success).toBe(false);
  });

  it('una llave compartida de verdad valida contra el esquema', async () => {
    const tutor = generateRecipientKeyPair();
    const sealed = await sealForRecipient(deriveSubkey(generateMasterKey(), 'conversation', 'c1'), tutor.publicKey);
    expect(sealedForRecipientSchema.safeParse(sealed).success).toBe(true);
  });

  it('una clave publica real tiene la longitud que el esquema exige', () => {
    const pair = generateRecipientKeyPair();
    expect(vaultPublicKeySchema.safeParse(pair.publicKey).success).toBe(true);
    expect(pair.publicKey.length).toBe(43);
  });
});

describe('parametros de derivacion', () => {
  it('rechaza memoria por debajo del minimo y por encima del tope', () => {
    expect(argon2ParamsSchema.safeParse({ t: 3, m: 1024, p: 1 }).success).toBe(false);
    // el tope evita que una envoltura manipulada tumbe el proceso
    expect(argon2ParamsSchema.safeParse({ t: 3, m: 64 * 1024 * 1024, p: 1 }).success).toBe(false);
    expect(argon2ParamsSchema.safeParse({ t: 3, m: 64 * 1024, p: 1 }).success).toBe(true);
  });

  it('rechaza valores no enteros', () => {
    expect(argon2ParamsSchema.safeParse({ t: 2.5, m: 64 * 1024, p: 1 }).success).toBe(false);
  });
});

describe('registro privado', () => {
  const record = (): unknown => ({
    recordId: uuid(),
    conversationId: uuid(),
    privacy: 'private',
    sequence: 0,
    content: {
      version: 1,
      purpose: 'vault.conversation',
      nonce: 'A'.repeat(16),
      ciphertext: 'Zm9v',
    },
    sealedMemory: null,
    createdAt: now(),
  });

  it('acepta un registro bien formado', () => {
    expect(privateRecordSchema.safeParse(record()).success).toBe(true);
  });

  it('no tiene ningun campo donde meter contenido en claro', () => {
    const parsed = privateRecordSchema.parse(record());
    const keys = Object.keys(parsed);
    for (const forbidden of FORBIDDEN_PLAINTEXT_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('descarta los campos extra que alguien intente colar', () => {
    const conFuga = { ...(record() as object), conversationTitle: 'Titulo revelador' };
    const parsed = privateRecordSchema.parse(conFuga);
    // zod por defecto no conserva claves desconocidas: el titulo no sobrevive
    expect(JSON.stringify(parsed)).not.toContain('Titulo revelador');
  });

  it('exige que privacy sea exactamente private', () => {
    expect(privateRecordSchema.safeParse({ ...(record() as object), privacy: 'cloud' }).success).toBe(
      false,
    );
  });
});

describe('medio privado', () => {
  const media = (): unknown => ({
    mediaId: uuid(),
    conversationId: uuid(),
    objectKey: 'a'.repeat(32),
    byteSize: 1024,
    content: { version: 1, purpose: 'vault.media', nonce: 'A'.repeat(16), ciphertext: 'Zm9v' },
    thumbnailObjectKey: null,
    createdAt: now(),
  });

  it('acepta un medio bien formado', () => {
    expect(privateMediaSchema.safeParse(media()).success).toBe(true);
  });

  it('exige una clave de objeto opaca, sin nombre ni extension', () => {
    for (const clave of ['asuka.png', '../escape', 'a'.repeat(31), 'video-final.mp4']) {
      expect(privateMediaSchema.safeParse({ ...(media() as object), objectKey: clave }).success).toBe(
        false,
      );
    }
  });

  it('no admite el tipo de archivo en claro', () => {
    const parsed = privateMediaSchema.parse({ ...(media() as object), mimeType: 'video/mp4' });
    // saber que una conversacion tiene cuarenta video/mp4 ya dice bastante
    expect(JSON.stringify(parsed)).not.toContain('video/mp4');
  });
});

describe('puente de Telegram', () => {
  it('viene apagado por defecto', () => {
    const bridge = telegramBridgeSchema.parse({});
    expect(bridge.enabled).toBe(false);
    expect(bridge.acknowledgedAt).toBeNull();
  });
});

describe('invitaciones y permisos', () => {
  it('una invitacion nace pendiente y sin clave publica', () => {
    const invite = shareInviteSchema.parse({
      inviteId: uuid(),
      email: 'alguien@example.com',
      state: 'pending',
      createdAt: now(),
    });
    // no se puede cifrar para alguien cuya clave publica todavia no existe
    expect(invite.recipientPublicKey).toBeNull();
    expect(invite.state).toBe('pending');
  });

  it('rechaza un correo mal formado', () => {
    expect(
      shareInviteSchema.safeParse({
        inviteId: uuid(),
        email: 'no-es-un-correo',
        state: 'pending',
        createdAt: now(),
      }).success,
    ).toBe(false);
  });

  it('un permiso es siempre sobre una conversacion concreta', async () => {
    const tutor = generateRecipientKeyPair();
    const wrappedKey = await sealForRecipient(randomBytes(KEY_BYTES), tutor.publicKey);
    const grant = shareGrantSchema.parse({
      grantId: uuid(),
      inviteId: uuid(),
      conversationId: uuid(),
      state: 'active',
      wrappedKey,
      createdAt: now(),
    });
    expect(grant.conversationId).toBeTruthy();
    expect(grant.revokedAt).toBeNull();
  });
});

describe('deteccion de contenido en claro', () => {
  it('no encuentra nada en un registro correcto', () => {
    expect(
      findPlaintextLeaks({
        recordId: uuid(),
        content: { version: 1, purpose: 'vault.conversation', nonce: 'x', ciphertext: 'y' },
      }),
    ).toEqual([]);
  });

  it('encuentra un campo prohibido en la raiz', () => {
    expect(findPlaintextLeaks({ prompt: 'hola' })).toEqual(['prompt']);
  });

  it('encuentra un campo prohibido anidado en profundidad', () => {
    const leaks = findPlaintextLeaks({ job: { metadata: { conversationTitle: 'revelador' } } });
    // esconderlo dentro de un objeto sigue siendo enviarlo
    expect(leaks).toEqual(['job.metadata.conversationTitle']);
  });

  it('encuentra un campo prohibido dentro de un array', () => {
    expect(findPlaintextLeaks({ turns: [{ ok: 1 }, { memory: 'algo' }] })).toEqual([
      'turns[1].memory',
    ]);
  });

  it('encuentra varios a la vez', () => {
    const leaks = findPlaintextLeaks({ title: 'a', media: { fileName: 'b', outputUrl: 'c' } });
    expect(leaks.sort()).toEqual(['media.fileName', 'media.outputUrl', 'title']);
  });

  it('un campo prohibido vacio o nulo no cuenta como fuga', () => {
    expect(findPlaintextLeaks({ prompt: null, title: '', memory: undefined })).toEqual([]);
  });

  it('assertNoPlaintextLeak nombra los campos ofensivos', () => {
    expect(() => assertNoPlaintextLeak({ prompt: 'x', title: 'y' })).toThrow(/prompt/);
    expect(() => assertNoPlaintextLeak({ prompt: 'x', title: 'y' })).toThrow(/title/);
  });

  it('un campo prohibido que contiene un sobre cifrado no es una fuga', async () => {
    const sealed = await sealText(randomBytes(KEY_BYTES), 'vault.memory', 'memoria privada');
    // lo que importa es el contenido, no como se llame el campo: `memory` con
    // un sobre dentro es exactamente lo que queremos, no lo que impedimos
    expect(findPlaintextLeaks({ memory: sealed })).toEqual([]);
    expect(findPlaintextLeaks({ title: sealed })).toEqual([]);
  });

  it('un campo prohibido con algo que solo PARECE un sobre si es una fuga', () => {
    const falso = { version: 1, purpose: 'vault.memory', nonce: 'corto', ciphertext: 'x' };
    expect(findPlaintextLeaks({ memory: falso })).toEqual(['memory']);
  });

  it('assertNoPlaintextLeak deja pasar un registro privado real', async () => {
    const content = await sealText(randomBytes(KEY_BYTES), 'vault.conversation', 'texto privado');
    expect(() =>
      assertNoPlaintextLeak({
        recordId: uuid(),
        conversationId: uuid(),
        privacy: 'private',
        sequence: 0,
        content,
        sealedMemory: null,
        createdAt: now(),
      }),
    ).not.toThrow();
  });

  it('detecta la fuga tipica: el titulo colado en la metadata del trabajo', () => {
    // esta es exactamente la forma que tiene hoy una conversacion de Studio
    const payload = {
      metadata: {
        studioMode: 'conversation',
        conversationId: uuid(),
        conversationTitle: 'lo que sea',
        conversationUserMessage: 'el mensaje entero',
      },
    };
    expect(findPlaintextLeaks(payload).sort()).toEqual([
      'metadata.conversationTitle',
      'metadata.conversationUserMessage',
    ]);
  });
});
