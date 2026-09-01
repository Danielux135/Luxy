// pruebas del cable entre la cuenta y la boveda local.
//
// Lo que se comprueba aqui no es la criptografia —eso ya lo cubre
// @luxy/vault-crypto— sino la invariante que da sentido a todo el bloque: los
// dos origenes de la llave maestra producen LA MISMA llave, y por tanto las
// mismas subclaves. Si esto se rompe, un equipo nuevo entra y no puede leer
// nada de lo que escribio el anterior.
//
// Sin red y sin Supabase: el gateway es un objeto con memoria.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toBase64Url } from '@luxy/vault-crypto';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { VaultAccountManager, type SessionStore } from './account-manager.js';

const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const EMAIL = 'daniel@example.com';
const PASSWORD = 'una frase larga de prueba';

function memoryStore(): DeviceKeyStore & SessionStore {
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

/** gateway falso con memoria: registra, entrega el login y cierra sesiones */
function fakeGateway() {
  const accounts = new Map<string, Record<string, unknown>>();
  const revoked: string[] = [];
  let issued = 0;

  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(url.toString()).pathname;
    const body = init?.body === undefined ? null : JSON.parse(String(init.body));
    const session = () => ({
      sessionToken: `token-de-sesion-${(issued += 1)}`,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    if (path === '/api/vault/register') {
      if (accounts.has(body.email)) return new Response('', { status: 409 });
      accounts.set(body.email, body);
      return Response.json({ ...session(), vaultId: body.vaultId }, { status: 201 });
    }
    if (path === '/api/vault/login/start') {
      const account = accounts.get(body.email);
      if (account === undefined) return new Response('', { status: 401 });
      const recovery = account.recovery as Record<string, unknown>;
      return Response.json({
        authSalt: account.authSalt,
        argon2Params: account.argon2Params,
        wrappedMasterKey: account.wrappedMasterKey,
        // las dos puertas viajan juntas, como en el gateway de verdad
        recovery: {
          authSalt: recovery.authSalt,
          argon2Params: recovery.argon2Params,
          wrappedMasterKey: recovery.wrappedMasterKey,
        },
      });
    }
    if (path === '/api/vault/login/finish') {
      const account = accounts.get(body.email);
      const recovery = account?.recovery as { authHash?: string } | undefined;
      const proves =
        account !== undefined &&
        (account.authHash === body.authHash || recovery?.authHash === body.authHash);
      if (!proves) return new Response('', { status: 401 });
      return Response.json({ ...session(), vaultId: account.vaultId });
    }
    if (path === '/api/vault/logout') {
      revoked.push(new Headers(init?.headers ?? {}).get('Authorization') ?? '');
      return Response.json({ ok: true });
    }
    if (path === '/api/vault/password') {
      const account = [...accounts.values()][0];
      if (account === undefined) return new Response('', { status: 401 });
      const recovery = account.recovery as { authHash?: string };
      // vale la contraseña actual o la clave de recuperacion, como en el real
      const proves =
        account.authHash === body.currentAuthHash ||
        recovery.authHash === body.currentAuthHash;
      if (!proves) return new Response('', { status: 403 });
      Object.assign(account, {
        authSalt: body.authSalt,
        argon2Params: body.argon2Params,
        authHash: body.authHash,
        wrappedMasterKey: body.wrappedMasterKey,
      });
      return Response.json({ ok: true });
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;

  return { impl, accounts, revoked };
}

describe('cuenta de la boveda', () => {
  let directories: string[] = [];
  let gateway: ReturnType<typeof fakeGateway>;

  /** un equipo entero: su carpeta, su boveda y su cuenta */
  function machine(): { vault: VaultService; accounts: VaultAccountManager; directory: string } {
    const directory = mkdtempSync(join(tmpdir(), 'luxy-cuenta-'));
    directories.push(directory);
    const vault = new VaultService(vaultFilePathFor(directory), memoryStore(), {
      argon2Params: FAST,
    });
    const accounts = new VaultAccountManager(vault, memoryStore(), {
      gatewayUrl: () => 'https://gw.example',
      fetchImpl: gateway.impl,
      argon2Params: FAST,
    });
    return { vault, accounts, directory };
  }

  beforeEach(() => {
    gateway = fakeGateway();
    directories = [];
  });

  afterEach(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  });

  describe('registro', () => {
    it('deja la boveda abierta y vinculada a la cuenta', async () => {
      const { vault, accounts } = machine();
      const { recoveryKey } = await accounts.register(EMAIL, PASSWORD);

      expect(vault.isUnlocked()).toBe(true);
      expect(recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$/);
      expect(accounts.status()).toMatchObject({ email: EMAIL, signedIn: true });
      expect(vault.boundAccount()).toMatchObject({ email: EMAIL });
    });

    it('el archivo local no guarda la contraseña ni la llave', async () => {
      const { vault, accounts, directory } = machine();
      await accounts.register(EMAIL, PASSWORD);

      const raw = readFileSync(vaultFilePathFor(directory), 'utf8');
      expect(raw).not.toContain(PASSWORD);
      expect(raw).not.toContain(toBase64Url(vault.subkeyFor('index')));
    });

    it('el identificador local y el de la cuenta son el mismo', async () => {
      const { vault, accounts } = machine();
      await accounts.register(EMAIL, PASSWORD);
      // si no coincidieran, el servidor guardaria los registros bajo una boveda
      // y el cliente los buscaria bajo otra
      expect(vault.vaultId()).toBe(gateway.accounts.get(EMAIL)?.vaultId);
    });
  });

  describe('entrar desde otro equipo', () => {
    it('un equipo nuevo obtiene la MISMA llave con solo la contraseña', async () => {
      const primero = machine();
      await primero.accounts.register(EMAIL, PASSWORD);
      const esperada = toBase64Url(primero.vault.subkeyFor('conversation', 'c1'));

      const segundo = machine();
      await segundo.accounts.login(EMAIL, PASSWORD);

      // esta igualdad es la razon de ser de todo el bloque: sin ella, lo
      // escrito en un equipo seria ilegible en el otro
      expect(toBase64Url(segundo.vault.subkeyFor('conversation', 'c1'))).toBe(esperada);
      expect(segundo.vault.vaultId()).toBe(primero.vault.vaultId());
    });

    it('deja una cache local que abre sin volver a llamar al servidor', async () => {
      const primero = machine();
      await primero.accounts.register(EMAIL, PASSWORD);

      const segundo = machine();
      await segundo.accounts.login(EMAIL, PASSWORD);
      segundo.vault.lock();

      // un gateway que ya no responde: el arranque siguiente no depende de el
      const sinRed = new VaultService(vaultFilePathFor(segundo.directory), memoryStore(), {
        argon2Params: FAST,
      });
      await sinRed.unlock(PASSWORD);
      expect(sinRed.vaultId()).toBe(primero.vault.vaultId());
    });

    it('la contraseña incorrecta no abre nada', async () => {
      const primero = machine();
      await primero.accounts.register(EMAIL, PASSWORD);

      const segundo = machine();
      await expect(segundo.accounts.login(EMAIL, 'otra frase larga distinta')).rejects.toThrow(
        VaultError,
      );
      expect(segundo.vault.isUnlocked()).toBe(false);
      expect(segundo.vault.status().configured).toBe(false);
    });

    it('no pisa la boveda de otra cuenta que ya haya en el equipo', async () => {
      const compartido = machine();
      await compartido.accounts.register(EMAIL, PASSWORD);
      const suya = toBase64Url(compartido.vault.subkeyFor('conversation', 'c1'));

      const otra = new VaultAccountManager(compartido.vault, memoryStore(), {
        gatewayUrl: () => 'https://gw.example',
        fetchImpl: gateway.impl,
        argon2Params: FAST,
      });

      // pisar el archivo dejaria ilegible, sin aviso, todo lo de la primera
      await expect(otra.register('otra@example.com', 'otra frase larga')).rejects.toThrow(
        VaultError,
      );
      await expect(otra.login('otra@example.com', 'otra frase larga')).rejects.toThrow(VaultError);

      // y se corta antes de la red: no queda una cuenta huerfana en el servidor
      expect(gateway.accounts.size).toBe(1);
      expect(toBase64Url(compartido.vault.subkeyFor('conversation', 'c1'))).toBe(suya);
    });
  });

  describe('recuperar la cuenta desde un equipo nuevo', () => {
    it('la clave de recuperacion abre la MISMA boveda en otro ordenador', async () => {
      const primero = machine();
      const { recoveryKey } = await primero.accounts.register(EMAIL, PASSWORD);
      const esperada = toBase64Url(primero.vault.subkeyFor('conversation', 'c1'));

      // otro ordenador, sin nada de este: solo el correo y el papel
      const segundo = machine();
      await segundo.accounts.login(EMAIL, recoveryKey, 'recovery');

      expect(toBase64Url(segundo.vault.subkeyFor('conversation', 'c1'))).toBe(esperada);
      expect(segundo.vault.vaultId()).toBe(primero.vault.vaultId());
      expect(segundo.accounts.status().openedWithRecoveryKey).toBe(true);
    });

    it('se acepta escrita de forma descuidada', async () => {
      const primero = machine();
      const { recoveryKey } = await primero.accounts.register(EMAIL, PASSWORD);

      const segundo = machine();
      // se copia a mano de un papel: minusculas y espacios en vez de guiones
      await segundo.accounts.login(EMAIL, recoveryKey.toLowerCase().replace(/-/g, ' '), 'recovery');
      expect(segundo.vault.isUnlocked()).toBe(true);
    });

    it('la clave de otra cuenta no abre', async () => {
      const primero = machine();
      await primero.accounts.register(EMAIL, PASSWORD);

      const segundo = machine();
      await expect(
        segundo.accounts.login(EMAIL, 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ23-4567-89AB', 'recovery'),
      ).rejects.toThrow(VaultError);
      expect(segundo.vault.status().configured).toBe(false);
    });

    it('el equipo recuperado no guarda contraseña, porque no se conoce', async () => {
      const primero = machine();
      const { recoveryKey } = await primero.accounts.register(EMAIL, PASSWORD);

      const segundo = machine();
      await segundo.accounts.login(EMAIL, recoveryKey, 'recovery');

      // la cache local solo puede tener la puerta por la que se entro
      expect(segundo.vault.status().methods).toMatchObject({ password: false, recovery: true });
    });

    it('permite elegir una contraseña nueva, que es a lo que se venia', async () => {
      const primero = machine();
      const { recoveryKey } = await primero.accounts.register(EMAIL, PASSWORD);
      const esperada = toBase64Url(primero.vault.subkeyFor('conversation', 'c1'));

      const segundo = machine();
      await segundo.accounts.login(EMAIL, recoveryKey, 'recovery');
      // la prueba de «lo que ya sabes» es la clave, no la contraseña olvidada
      await segundo.accounts.changePassword(recoveryKey, 'una contraseña nueva larga');

      expect(segundo.accounts.status().openedWithRecoveryKey).toBe(false);
      expect(segundo.vault.status().methods.password).toBe(true);

      // y la nueva ya entra por la puerta normal, desde un tercer equipo
      const tercero = machine();
      await tercero.accounts.login(EMAIL, 'una contraseña nueva larga');
      expect(toBase64Url(tercero.vault.subkeyFor('conversation', 'c1'))).toBe(esperada);
    });

    it('cambiar la contraseña no invalida la clave de recuperacion', async () => {
      const primero = machine();
      const { recoveryKey } = await primero.accounts.register(EMAIL, PASSWORD);
      await primero.accounts.changePassword(PASSWORD, 'una contraseña nueva larga');

      // el papel que el usuario guardo en un cajon sigue valiendo
      const segundo = machine();
      await segundo.accounts.login(EMAIL, recoveryKey, 'recovery');
      expect(segundo.vault.isUnlocked()).toBe(true);
    });

    it('la contraseña vieja deja de abrir tras el cambio', async () => {
      const primero = machine();
      await primero.accounts.register(EMAIL, PASSWORD);
      await primero.accounts.changePassword(PASSWORD, 'una contraseña nueva larga');

      const segundo = machine();
      await expect(segundo.accounts.login(EMAIL, PASSWORD)).rejects.toThrow(VaultError);
    });
  });

  describe('vincular una boveda que ya existia', () => {
    it('sube la misma llave, sin recifrar nada', async () => {
      const { vault, accounts } = machine();
      await vault.create(PASSWORD);
      const antes = toBase64Url(vault.subkeyFor('conversation', 'c1'));

      await accounts.link(EMAIL, PASSWORD);

      expect(toBase64Url(vault.subkeyFor('conversation', 'c1'))).toBe(antes);
      expect(vault.boundAccount()).toMatchObject({ email: EMAIL });

      // y desde otro equipo se abre esa misma boveda
      const otro = machine();
      await otro.accounts.login(EMAIL, PASSWORD);
      expect(toBase64Url(otro.vault.subkeyFor('conversation', 'c1'))).toBe(antes);
    });

    it('exige la contraseña que abre esta boveda', async () => {
      const { vault, accounts } = machine();
      await vault.create(PASSWORD);

      // si no se comprobara, quedarian dos contraseñas para la misma boveda
      await expect(accounts.link(EMAIL, 'otra frase larga distinta')).rejects.toThrow(VaultError);
      expect(gateway.accounts.size).toBe(0);
    });

    it('no se vincula dos veces', async () => {
      const { vault, accounts } = machine();
      await vault.create(PASSWORD);
      await accounts.link(EMAIL, PASSWORD);
      await expect(accounts.link('otro@example.com', PASSWORD)).rejects.toThrow(VaultError);
    });
  });

  describe('sesion', () => {
    it('sobrevive a reiniciar la aplicacion', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'luxy-cuenta-'));
      directories.push(directory);
      const sessions = memoryStore();
      const vault = new VaultService(vaultFilePathFor(directory), memoryStore(), {
        argon2Params: FAST,
      });
      const options = {
        gatewayUrl: () => 'https://gw.example',
        fetchImpl: gateway.impl,
        argon2Params: FAST,
      };
      const accounts = new VaultAccountManager(vault, sessions, options);
      await accounts.register(EMAIL, PASSWORD);

      // el mismo almacen cifrado, un proceso nuevo
      const reabierto = new VaultAccountManager(vault, sessions, options);
      expect(reabierto.status().signedIn).toBe(true);
      expect(reabierto.sessionToken()).toBe(accounts.sessionToken());
    });

    it('una sesion caducada no vale y se olvida sola', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'luxy-cuenta-'));
      directories.push(directory);
      const sessions = memoryStore();
      const vault = new VaultService(vaultFilePathFor(directory), memoryStore(), {
        argon2Params: FAST,
      });
      let ahora = Date.now();
      const accounts = new VaultAccountManager(vault, sessions, {
        gatewayUrl: () => 'https://gw.example',
        fetchImpl: gateway.impl,
        argon2Params: FAST,
        now: () => ahora,
      });
      await accounts.register(EMAIL, PASSWORD);

      ahora += 7_200_000;
      expect(accounts.status().signedIn).toBe(false);
      // la boveda sigue vinculada y sigue abriendose: lo que caduca es sincronizar
      expect(accounts.status().email).toBe(EMAIL);
      expect(() => accounts.sessionToken()).toThrow(VaultError);
      expect(sessions.get()).toBeUndefined();
    });

    it('salir cierra la boveda y revoca la sesion en el servidor', async () => {
      const { vault, accounts } = machine();
      await accounts.register(EMAIL, PASSWORD);
      const token = accounts.sessionToken();

      await accounts.logout();

      expect(gateway.revoked).toContain(`Bearer ${token}`);
      expect(vault.isUnlocked()).toBe(false);
      expect(accounts.status().signedIn).toBe(false);
      // lo cifrado sigue en el equipo: salir no borra nada
      expect(vault.status().configured).toBe(true);
    });

    it('el token no aparece en el estado que ve la interfaz', async () => {
      const { accounts } = machine();
      await accounts.register(EMAIL, PASSWORD);
      expect(JSON.stringify(accounts.status())).not.toContain(accounts.sessionToken());
      expect(Object.keys(accounts.status()).sort()).toEqual([
        'email',
        'expiresAt',
        'openedWithRecoveryKey',
        'signedIn',
      ]);
    });
  });

  describe('cambio de contraseña', () => {
    it('cambia la cuenta y la cache local a la vez', async () => {
      const { vault, accounts, directory } = machine();
      await accounts.register(EMAIL, PASSWORD);
      const antes = toBase64Url(vault.subkeyFor('conversation', 'c1'));

      await accounts.changePassword(PASSWORD, 'otra frase larga distinta');

      // el contenido no se recifra: la llave maestra no cambia
      expect(toBase64Url(vault.subkeyFor('conversation', 'c1'))).toBe(antes);

      // la nueva abre en local...
      const local = new VaultService(vaultFilePathFor(directory), memoryStore(), {
        argon2Params: FAST,
      });
      await local.unlock('otra frase larga distinta');
      await expect(local.unlock(PASSWORD)).rejects.toThrow(VaultError);

      // ...y tambien desde un equipo nuevo
      const otro = machine();
      await otro.accounts.login(EMAIL, 'otra frase larga distinta');
      expect(toBase64Url(otro.vault.subkeyFor('conversation', 'c1'))).toBe(antes);
    });

    it('la contraseña actual incorrecta no cambia nada', async () => {
      const { vault, accounts, directory } = machine();
      await accounts.register(EMAIL, PASSWORD);

      await expect(
        accounts.changePassword('la que no es pero es larga', 'otra frase larga distinta'),
      ).rejects.toThrow(VaultError);

      const local = new VaultService(vaultFilePathFor(directory), memoryStore(), {
        argon2Params: FAST,
      });
      await local.unlock(PASSWORD);
      expect(vault.isUnlocked()).toBe(true);
    });

    it('una boveda de cuenta no se cambia solo en local', async () => {
      const { vault, accounts } = machine();
      await accounts.register(EMAIL, PASSWORD);

      // cambiarla aqui dejaria este equipo con una contraseña que ningun otro
      // reconoce, y sin forma de darse cuenta hasta intentar entrar
      await expect(vault.changePassword(PASSWORD, 'otra frase larga distinta')).rejects.toThrow(
        VaultError,
      );
    });
  });

  describe('sin gateway configurado', () => {
    it('lo dice en vez de fallar en la red', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'luxy-cuenta-'));
      directories.push(directory);
      const vault = new VaultService(vaultFilePathFor(directory), memoryStore(), {
        argon2Params: FAST,
      });
      const accounts = new VaultAccountManager(vault, memoryStore(), {
        gatewayUrl: () => null,
        fetchImpl: gateway.impl,
        argon2Params: FAST,
      });
      await expect(accounts.register(EMAIL, PASSWORD)).rejects.toThrow(VaultError);
    });
  });
});
