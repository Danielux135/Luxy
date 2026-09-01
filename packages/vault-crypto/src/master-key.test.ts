import { describe, it, expect } from 'vitest';
import { VaultCryptoError, randomBytes, toBase64Url, wipe } from './bytes.js';
import { KEY_BYTES, openText, sealText } from './envelope.js';
import {
  generateMasterKey,
  generateRecoveryKey,
  isValidRecoveryKey,
  normalizeRecoveryKey,
  rewrapWithNewPassword,
  unwrapMasterKey,
  unwrapMasterKeyFromDevice,
  wrapMasterKey,
  wrapMasterKeyForDevice,
} from './master-key.js';
import { ARGON2_PARAMS, KEY_DOMAINS, assertArgon2Params, deriveSubkey } from './kdf.js';

/**
 * Argon2 con los parametros reales tarda cientos de milisegundos por llamada.
 * Las pruebas usan el minimo aceptado: lo que se verifica es la ESTRUCTURA
 * (que la envoltura abre, que los parametros viajan, que cambiar la contraseña
 * no recifra), no el coste, que se comprueba aparte sobre la constante.
 */
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;

describe('parametros de derivacion', () => {
  it('los parametros por defecto son aceptables y caros de verdad', () => {
    expect(() => assertArgon2Params(ARGON2_PARAMS)).not.toThrow();
    // segunda opcion recomendada de RFC 9106 §4. Si alguien los baja por
    // descuido para que la suite corra mas rapido, esta prueba lo dice
    expect(ARGON2_PARAMS.m).toBeGreaterThanOrEqual(64 * 1024);
    expect(ARGON2_PARAMS.t).toBeGreaterThanOrEqual(3);
  });

  it(
    'los parametros reales funcionan de extremo a extremo',
    async () => {
      // el resto de la suite usa el minimo aceptado para no tardar. Esta prueba
      // existe para que algo ejercite los parametros que se envian de verdad:
      // sin ella, un cambio que los rompiese pasaria desapercibido.
      const master = generateMasterKey();
      const wrap = await wrapMasterKey(master, 'contraseña real', 'password');
      expect(wrap.params).toEqual({ ...ARGON2_PARAMS });
      expect([...(await unwrapMasterKey(wrap, 'contraseña real'))]).toEqual([...master]);
    },
    60_000,
  );

  it('informa del progreso durante la derivacion', async () => {
    const fractions: number[] = [];
    await wrapMasterKey(generateMasterKey(), 'contraseña', 'password', FAST, (fraction) =>
      fractions.push(fraction),
    );
    // la interfaz necesita esto para no parecer colgada mientras deriva
    expect(fractions.length).toBeGreaterThan(0);
    expect(Math.min(...fractions)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...fractions)).toBeLessThanOrEqual(1);
  });

  it('rechaza parametros fuera de rango', () => {
    expect(() => assertArgon2Params({ t: 0, m: 8 * 1024, p: 1 })).toThrow(VaultCryptoError);
    expect(() => assertArgon2Params({ t: 1, m: 1024, p: 1 })).toThrow(VaultCryptoError);
    // un archivo manipulado no puede pedir 64 GiB y tumbar el proceso
    expect(() => assertArgon2Params({ t: 1, m: 64 * 1024 * 1024, p: 1 })).toThrow(VaultCryptoError);
    expect(() => assertArgon2Params({ t: 1.5, m: 8 * 1024, p: 1 })).toThrow(VaultCryptoError);
  });
});

describe('subclaves por dominio', () => {
  it('cada dominio da una llave distinta', () => {
    const master = generateMasterKey();
    const derived = KEY_DOMAINS.map((domain) => toBase64Url(deriveSubkey(master, domain)));
    expect(new Set(derived).size).toBe(KEY_DOMAINS.length);
  });

  it('es determinista: la misma entrada da la misma llave', () => {
    const master = generateMasterKey();
    expect(toBase64Url(deriveSubkey(master, 'media'))).toBe(toBase64Url(deriveSubkey(master, 'media')));
  });

  it('el contexto separa objetos dentro de un dominio', () => {
    const master = generateMasterKey();
    const a = toBase64Url(deriveSubkey(master, 'conversation', 'conv-1'));
    const b = toBase64Url(deriveSubkey(master, 'conversation', 'conv-2'));
    // esto es lo que permite compartir una conversacion sin dar las demas
    expect(a).not.toBe(b);
  });

  it('el separador de contexto no permite colisiones', () => {
    const master = generateMasterKey();
    const a = toBase64Url(deriveSubkey(master, 'media', 'x|y'));
    const b = toBase64Url(deriveSubkey(master, 'media', 'x')) + toBase64Url(deriveSubkey(master, 'media', 'y'));
    expect(a).not.toBe(b);
  });

  it('una llave maestra distinta da subclaves distintas', () => {
    expect(toBase64Url(deriveSubkey(generateMasterKey(), 'index'))).not.toBe(
      toBase64Url(deriveSubkey(generateMasterKey(), 'index')),
    );
  });

  it('rechaza un dominio desconocido y una maestra de tamaño incorrecto', () => {
    const master = generateMasterKey();
    expect(() => deriveSubkey(master, 'inventado' as never)).toThrow(VaultCryptoError);
    expect(() => deriveSubkey(randomBytes(16), 'index')).toThrow(VaultCryptoError);
  });

  it('una subclave sirve para cifrar y descifrar de verdad', async () => {
    const master = generateMasterKey();
    const key = deriveSubkey(master, 'conversation', 'conv-1');
    const otherConversation = deriveSubkey(master, 'conversation', 'conv-2');

    const envelope = await sealText(key, 'vault.conversation', 'contenido de la conversacion 1');
    expect(await openText(key, 'vault.conversation', envelope)).toContain('conversacion 1');
    // la llave de otra conversacion no abre esta
    await expect(openText(otherConversation, 'vault.conversation', envelope)).rejects.toThrow();
  });
});

describe('clave de recuperacion', () => {
  it('tiene el formato de 8 grupos de 4', () => {
    const recovery = generateRecoveryKey();
    expect(recovery).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$/);
    expect(isValidRecoveryKey(recovery)).toBe(true);
  });

  it('no usa caracteres que se confunden al copiarlos a mano', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(generateRecoveryKey()).not.toMatch(/[ILOU01]/);
    }
  });

  it('no se repite entre generaciones', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateRecoveryKey()));
    expect(keys.size).toBe(50);
  });

  it('normaliza minusculas, espacios y guiones', () => {
    const recovery = generateRecoveryKey();
    const messy = recovery.toLowerCase().replace(/-/g, ' ');
    expect(normalizeRecoveryKey(messy)).toBe(normalizeRecoveryKey(recovery));
  });

  it('rechaza claves con formato incorrecto', () => {
    expect(isValidRecoveryKey('demasiado-corta')).toBe(false);
    expect(isValidRecoveryKey('IIII-IIII-IIII-IIII-IIII-IIII-IIII-IIII')).toBe(false);
  });
});

describe('envolturas de la llave maestra', () => {
  it('la contraseña correcta recupera exactamente la misma llave', async () => {
    const master = generateMasterKey();
    const wrap = await wrapMasterKey(master, 'contraseña larga y buena', 'password', FAST);
    const recovered = await unwrapMasterKey(wrap, 'contraseña larga y buena');
    expect([...recovered]).toEqual([...master]);
  });

  it('la envoltura guardada no contiene la llave maestra', async () => {
    const master = generateMasterKey();
    const wrap = await wrapMasterKey(master, 'contraseña', 'password', FAST);
    expect(JSON.stringify(wrap)).not.toContain(toBase64Url(master));
  });

  it('una contraseña incorrecta falla', async () => {
    const wrap = await wrapMasterKey(generateMasterKey(), 'correcta', 'password', FAST);
    await expect(unwrapMasterKey(wrap, 'incorrecta')).rejects.toThrow(VaultCryptoError);
  });

  it('guarda los parametros usados, no los actuales por defecto', async () => {
    const wrap = await wrapMasterKey(generateMasterKey(), 'contraseña', 'password', FAST);
    expect(wrap.params).toEqual({ ...FAST });
    // una boveda creada con parametros antiguos debe seguir abriendose si algun
    // dia se sube el coste por defecto
    expect(wrap.params).not.toEqual(ARGON2_PARAMS);
  });

  it('dos envolturas de la misma llave usan sales distintas', async () => {
    const master = generateMasterKey();
    const first = await wrapMasterKey(master, 'contraseña', 'password', FAST);
    const second = await wrapMasterKey(master, 'contraseña', 'password', FAST);
    expect(first.salt).not.toBe(second.salt);
    expect(first.envelope.ciphertext).not.toBe(second.envelope.ciphertext);
  });

  it('contraseña y recuperacion abren la misma llave maestra', async () => {
    const master = generateMasterKey();
    const recovery = generateRecoveryKey();
    const byPassword = await wrapMasterKey(master, 'contraseña', 'password', FAST);
    const byRecovery = await wrapMasterKey(master, recovery, 'recovery', FAST);

    expect([...(await unwrapMasterKey(byPassword, 'contraseña'))]).toEqual([...master]);
    expect([...(await unwrapMasterKey(byRecovery, recovery))]).toEqual([...master]);
  });

  it('la clave de recuperacion se acepta escrita de forma descuidada', async () => {
    const master = generateMasterKey();
    const recovery = generateRecoveryKey();
    const wrap = await wrapMasterKey(master, recovery, 'recovery', FAST);
    const recovered = await unwrapMasterKey(wrap, recovery.toLowerCase().replace(/-/g, ' '));
    expect([...recovered]).toEqual([...master]);
  });

  it('una envoltura no se abre con el metodo de la otra', async () => {
    const master = generateMasterKey();
    const recovery = generateRecoveryKey();
    const byRecovery = await wrapMasterKey(master, recovery, 'recovery', FAST);
    // el proposito del sobre difiere por metodo, asi que ni con el secreto
    // correcto se puede abrir declarando otro metodo
    await expect(
      unwrapMasterKey({ ...byRecovery, method: 'password' }, recovery),
    ).rejects.toThrow(VaultCryptoError);
  });

  it('rechaza una clave de recuperacion mal formada al envolver', async () => {
    await expect(
      wrapMasterKey(generateMasterKey(), 'no-es-una-clave', 'recovery', FAST),
    ).rejects.toThrow(VaultCryptoError);
  });

  it('rechaza una envoltura sin sal o sin parametros', async () => {
    const wrap = await wrapMasterKey(generateMasterKey(), 'contraseña', 'password', FAST);
    await expect(unwrapMasterKey({ ...wrap, salt: null }, 'contraseña')).rejects.toThrow(
      VaultCryptoError,
    );
    await expect(unwrapMasterKey({ ...wrap, params: null }, 'contraseña')).rejects.toThrow(
      VaultCryptoError,
    );
  });

  it('rechaza parametros manipulados que pedirian memoria absurda', async () => {
    const wrap = await wrapMasterKey(generateMasterKey(), 'contraseña', 'password', FAST);
    await expect(
      unwrapMasterKey({ ...wrap, params: { t: 1, m: 64 * 1024 * 1024, p: 1 } }, 'contraseña'),
    ).rejects.toThrow(VaultCryptoError);
  });

  it('rechaza una contraseña vacia', async () => {
    await expect(wrapMasterKey(generateMasterKey(), '', 'password', FAST)).rejects.toThrow(
      VaultCryptoError,
    );
  });
});

describe('envoltura del equipo', () => {
  it('el almacen del sistema recupera la misma llave', async () => {
    const master = generateMasterKey();
    const deviceKey = randomBytes(KEY_BYTES);
    const wrap = await wrapMasterKeyForDevice(master, deviceKey);
    expect([...(await unwrapMasterKeyFromDevice(wrap, deviceKey))]).toEqual([...master]);
  });

  it('no se abre con la llave de otro equipo', async () => {
    const wrap = await wrapMasterKeyForDevice(generateMasterKey(), randomBytes(KEY_BYTES));
    await expect(unwrapMasterKeyFromDevice(wrap, randomBytes(KEY_BYTES))).rejects.toThrow(
      VaultCryptoError,
    );
  });

  it('no se puede abrir con una contraseña', async () => {
    const wrap = await wrapMasterKeyForDevice(generateMasterKey(), randomBytes(KEY_BYTES));
    await expect(unwrapMasterKey(wrap, 'lo que sea')).rejects.toThrow(
      'esta envoltura la abre el sistema operativo',
    );
  });
});

describe('cambio de contraseña', () => {
  it('la nueva abre y la antigua deja de abrir', async () => {
    const master = generateMasterKey();
    const original = await wrapMasterKey(master, 'antigua', 'password', FAST);
    const renewed = await rewrapWithNewPassword(original, 'antigua', 'nueva', FAST);

    expect([...(await unwrapMasterKey(renewed, 'nueva'))]).toEqual([...master]);
    await expect(unwrapMasterKey(renewed, 'antigua')).rejects.toThrow(VaultCryptoError);
  });

  it('la llave maestra NO cambia, asi que no hay que recifrar nada', async () => {
    const master = generateMasterKey();
    const original = await wrapMasterKey(master, 'antigua', 'password', FAST);

    // un dato cifrado antes del cambio con una subclave de la maestra
    const key = deriveSubkey(master, 'conversation', 'conv-1');
    const envelope = await sealText(key, 'vault.conversation', 'escrito antes del cambio');

    const renewed = await rewrapWithNewPassword(original, 'antigua', 'nueva', FAST);
    const recovered = await unwrapMasterKey(renewed, 'nueva');
    const sameKey = deriveSubkey(recovered, 'conversation', 'conv-1');

    expect(await openText(sameKey, 'vault.conversation', envelope)).toBe('escrito antes del cambio');
  });

  it('la clave de recuperacion sigue funcionando tras cambiar la contraseña', async () => {
    const master = generateMasterKey();
    const recovery = generateRecoveryKey();
    const byRecovery = await wrapMasterKey(master, recovery, 'recovery', FAST);
    const byPassword = await wrapMasterKey(master, 'antigua', 'password', FAST);

    await rewrapWithNewPassword(byPassword, 'antigua', 'nueva', FAST);
    // la envoltura de recuperacion es independiente: no se toca
    expect([...(await unwrapMasterKey(byRecovery, recovery))]).toEqual([...master]);
  });

  it('no se puede cambiar sin la contraseña actual', async () => {
    const wrap = await wrapMasterKey(generateMasterKey(), 'antigua', 'password', FAST);
    await expect(rewrapWithNewPassword(wrap, 'equivocada', 'nueva', FAST)).rejects.toThrow(
      VaultCryptoError,
    );
  });
});

describe('borrado de material sensible', () => {
  it('bloquear deja la llave maestra a ceros y sus datos ilegibles', async () => {
    const master = generateMasterKey();
    const key = deriveSubkey(master, 'conversation', 'conv-1');
    const envelope = await sealText(key, 'vault.conversation', 'contenido privado');

    wipe(master, key);

    expect(master.every((byte) => byte === 0)).toBe(true);
    // una llave a ceros no abre nada: es el estado tras bloquear la boveda
    await expect(openText(key, 'vault.conversation', envelope)).rejects.toThrow(VaultCryptoError);
  });
});
