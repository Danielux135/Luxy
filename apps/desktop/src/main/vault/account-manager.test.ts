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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toBase64Url } from '@luxy/vault-crypto';
import { LOCAL_VAULT_CONFLICT, VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { VaultAccountManager, type SessionStore } from './account-manager.js';
import { SyncAnchorStore, syncAnchorFilePath } from './sync-anchor-store.js';

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
  /** para dejar colgado el aviso de salida, como con la red caida */
  const control: { logoutGate: Promise<void> | null } = { logoutGate: null };
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
      if (control.logoutGate !== null) await control.logoutGate;
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

  return { impl, accounts, revoked, control };
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
      segundo.vault.lock('manual');

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
      // mas tiempo que el global de 20 s, y solo aqui: son cuatro derivaciones
      // de clave de verdad (alta, entrada con la clave, cambio y entrada con la
      // nueva), lentas a proposito. Sola tarda 9-11 s en este equipo; con la
      // suite entera y el equipo cargado paso de 20 s el 28/09 sin fallar
      // ninguna asercion. Rebajar el coste de la derivacion en la prueba dejaria
      // de probar la de verdad
    }, 60_000);

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

    // revision del 28/09: con la red colgada, la boveda seguia abierta mientras
    // «Cerrar sesion» esperaba al servidor
    it('salir cierra la boveda ANTES de esperar al servidor', async () => {
      const { vault, accounts } = machine();
      await accounts.register(EMAIL, PASSWORD);
      let soltar: () => void = () => undefined;
      gateway.control.logoutGate = new Promise<void>((resolve) => {
        soltar = resolve;
      });

      const salida = accounts.logout();
      expect(vault.isUnlocked()).toBe(false);
      expect(accounts.status().signedIn).toBe(false);

      soltar();
      await salida;
      expect(gateway.revoked).toHaveLength(1);
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

describe('una boveda local sin cuenta no se pisa al entrar (SYNC-F1-07)', () => {
  let directories: string[] = [];
  let gateway: ReturnType<typeof fakeGateway>;

  function machine(): { vault: VaultService; accounts: VaultAccountManager; directory: string } {
    const directory = mkdtempSync(join(tmpdir(), 'luxy-apartar-'));
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

  /** una boveda creada aqui, sin cuenta, con una conversacion dentro */
  async function localConContenido(): Promise<ReturnType<typeof machine> & { antes: string; subclave: string }> {
    const equipo = machine();
    await equipo.vault.create(PASSWORD);
    const subclave = toBase64Url(equipo.vault.subkeyFor('conversation', 'c1'));
    mkdirSync(join(equipo.directory, 'vault', 'conversations'), { recursive: true });
    writeFileSync(join(equipo.directory, 'vault', 'conversations', 'c.jsonl'), '{}\n', 'utf8');
    equipo.vault.lock('manual');
    return { ...equipo, antes: readFileSync(vaultFilePathFor(equipo.directory), 'utf8'), subclave };
  }

  beforeEach(() => {
    gateway = fakeGateway();
    directories = [];
  });

  afterEach(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  });

  it('entrar se niega y no toca nada', async () => {
    const cuenta = machine();
    await cuenta.accounts.register(EMAIL, PASSWORD);
    const local = await localConContenido();

    await expect(local.accounts.login(EMAIL, PASSWORD)).rejects.toThrow(LOCAL_VAULT_CONFLICT.message);

    // vault.json igual byte a byte, y la boveda local se sigue abriendo con su llave
    expect(readFileSync(vaultFilePathFor(local.directory), 'utf8')).toBe(local.antes);
    await local.vault.unlock(PASSWORD);
    expect(toBase64Url(local.vault.subkeyFor('conversation', 'c1'))).toBe(local.subclave);
    expect(local.accounts.status().signedIn).toBe(false);
  });

  it('crear una cuenta tambien, y antes de tocar el servidor', async () => {
    const local = await localConContenido();

    await expect(local.accounts.register('otra@example.com', PASSWORD)).rejects.toThrow(
      LOCAL_VAULT_CONFLICT.message,
    );
    // ninguna cuenta huerfana en el servidor
    expect(gateway.accounts.size).toBe(0);
    expect(readFileSync(vaultFilePathFor(local.directory), 'utf8')).toBe(local.antes);
  });

  it('sin contenido en la carpeta, entra como siempre', async () => {
    const cuenta = machine();
    await cuenta.accounts.register(EMAIL, PASSWORD);
    const vacia = machine();
    await vacia.vault.create(PASSWORD);
    vacia.vault.lock('manual');

    await vacia.accounts.login(EMAIL, PASSWORD);
    expect(vacia.vault.boundAccount()).toMatchObject({ email: EMAIL });
  });

  it('con la MISMA llave abierta, se adopta: no hay nada que perder', async () => {
    // una boveda vinculada cuyo vault.json perdio la marca de la cuenta
    const equipo = machine();
    await equipo.vault.create(PASSWORD);
    await equipo.accounts.link(EMAIL, PASSWORD);
    const subclave = toBase64Url(equipo.vault.subkeyFor('conversation', 'c1'));
    const archivo = vaultFilePathFor(equipo.directory);
    const contenido = JSON.parse(readFileSync(archivo, 'utf8')) as Record<string, unknown>;
    delete contenido.account;
    writeFileSync(archivo, JSON.stringify(contenido), 'utf8');
    mkdirSync(join(equipo.directory, 'vault', 'conversations'), { recursive: true });
    writeFileSync(join(equipo.directory, 'vault', 'conversations', 'c.jsonl'), '{}\n', 'utf8');

    await equipo.accounts.login(EMAIL, PASSWORD);
    expect(equipo.vault.boundAccount()).toMatchObject({ email: EMAIL });
    expect(toBase64Url(equipo.vault.subkeyFor('conversation', 'c1'))).toBe(subclave);
  });

  it('apartarla la renombra sin borrar nada, y despues se puede entrar', async () => {
    const cuenta = machine();
    await cuenta.accounts.register(EMAIL, PASSWORD);
    const local = await localConContenido();

    const apartada = local.vault.setAsideLocalVault(new Date('2026-10-07T10:00:00.000Z'));

    expect(apartada.vaultFile).toBe('vault.json.apartada-2026-10-07T10-00-00-000Z');
    expect(apartada.vaultDirectory).toBe('vault-apartada-2026-10-07T10-00-00-000Z');
    // nada borrado: la llave y el contenido siguen ahi, con otro nombre
    expect(readFileSync(join(local.directory, apartada.vaultFile), 'utf8')).toBe(local.antes);
    expect(
      existsSync(join(local.directory, apartada.vaultDirectory!, 'conversations', 'c.jsonl')),
    ).toBe(true);

    await local.accounts.login(EMAIL, PASSWORD);
    expect(local.vault.boundAccount()).toMatchObject({ email: EMAIL });
  });

  it('una boveda que ya es de una cuenta no se aparta', async () => {
    const cuenta = machine();
    await cuenta.accounts.register(EMAIL, PASSWORD);
    expect(() => cuenta.vault.setAsideLocalVault()).toThrow(VaultError);
    expect(cuenta.vault.status().configured).toBe(true);
  });
});

describe('entrar en una cuenta con la carpeta vacia deja este equipo como replica (F1-R1-01)', () => {
  // antes el papel solo se decidia en la primera pasada, y hasta entonces era
  // «sin papel», que dejaba escribir: un equipo nuevo que escribia en Privado
  // antes de pulsar «Sincronizar» quedaba como origen y seguia despues las
  // conversaciones del otro sin las fichas
  let directories: string[] = [];
  let gateway: ReturnType<typeof fakeGateway>;

  function equipo(): { vault: VaultService; accounts: VaultAccountManager; directory: string } {
    const directory = mkdtempSync(join(tmpdir(), 'luxy-ancla-'));
    directories.push(directory);
    const vault = new VaultService(vaultFilePathFor(directory), memoryStore(), { argon2Params: FAST });
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

  it('un equipo nuevo que entra queda apuntado como replica antes de nada, sin la llave', async () => {
    await equipo().accounts.register(EMAIL, PASSWORD);
    const nuevo = equipo();

    await nuevo.accounts.login(EMAIL, PASSWORD);

    // apuntado fuera del estado sellado: no depende de la primera pasada ni
    // de que ese estado se pueda leer
    expect(new SyncAnchorStore(syncAnchorFilePath(nuevo.directory)).read()).toEqual({
      kind: 'role',
      role: 'replica',
    });
    const raw = JSON.parse(readFileSync(syncAnchorFilePath(nuevo.directory), 'utf8')) as Record<string, unknown>;
    expect(raw).toMatchObject({ version: 1, role: 'replica', source: 'account-login' });
    // sin un solo identificador ni nada de la cuenta
    expect(JSON.stringify(raw)).not.toContain(EMAIL);
  });

  it('tambien entrando con la clave de recuperacion', async () => {
    const { recoveryKey } = await equipo().accounts.register(EMAIL, PASSWORD);
    const nuevo = equipo();
    await nuevo.accounts.login(EMAIL, recoveryKey, 'recovery');
    expect(new SyncAnchorStore(syncAnchorFilePath(nuevo.directory)).read()).toEqual({
      kind: 'role',
      role: 'replica',
    });
  });

  it('el de siempre, que vuelve a entrar con su boveda llena, no', async () => {
    const deSiempre = equipo();
    await deSiempre.accounts.register(EMAIL, PASSWORD);
    mkdirSync(join(deSiempre.directory, 'vault', 'conversations'), { recursive: true });
    writeFileSync(join(deSiempre.directory, 'vault', 'conversations', 'c.jsonl'), '{}\n', 'utf8');
    await deSiempre.accounts.logout();

    // la sesion caduco y vuelve a «Entrar»: es el paso 5 del despliegue
    await deSiempre.accounts.login(EMAIL, PASSWORD);

    expect(new SyncAnchorStore(syncAnchorFilePath(deSiempre.directory)).read()).toEqual({ kind: 'none' });
  });

  it('crear la cuenta no deja replica: no hay nada en el servidor de lo que ser copia', async () => {
    const nuevo = equipo();
    await nuevo.accounts.register(EMAIL, PASSWORD);
    expect(new SyncAnchorStore(syncAnchorFilePath(nuevo.directory)).read()).toEqual({ kind: 'none' });
  });

  it('si no se puede apuntar, no se entra: no hay ningun momento en que pueda escribir', async () => {
    await equipo().accounts.register(EMAIL, PASSWORD);
    const nuevo = equipo();
    // en el sitio del ancla, una carpeta: leerla da EISDIR, que no es «no existe»
    mkdirSync(syncAnchorFilePath(nuevo.directory), { recursive: true });

    await expect(nuevo.accounts.login(EMAIL, PASSWORD)).rejects.toThrow();
    expect(existsSync(vaultFilePathFor(nuevo.directory))).toBe(false);
    expect(nuevo.vault.isUnlocked()).toBe(false);
  });

  it('si vault.json no se puede escribir, el ancla recien apuntada se quita y se puede reintentar', async () => {
    await equipo().accounts.register(EMAIL, PASSWORD);
    const nuevo = equipo();
    // donde va el temporal de vault.json, una carpeta: escribirlo falla
    const temporal = `${vaultFilePathFor(nuevo.directory)}.tmp`;
    mkdirSync(temporal, { recursive: true });

    await expect(nuevo.accounts.login(EMAIL, PASSWORD)).rejects.toThrow();
    // sin entrar, nada apuntado: una boveda local creada despues aqui escribiria
    expect(new SyncAnchorStore(syncAnchorFilePath(nuevo.directory)).read()).toEqual({ kind: 'none' });

    rmSync(temporal, { recursive: true, force: true });
    await nuevo.accounts.login(EMAIL, PASSWORD);
    expect(new SyncAnchorStore(syncAnchorFilePath(nuevo.directory)).read()).toEqual({
      kind: 'role',
      role: 'replica',
    });
  });
});

describe('la caducidad renovada por el gateway (SYNC-F1-07)', () => {
  let directory: string;
  let gateway: ReturnType<typeof fakeGateway>;

  beforeEach(() => {
    gateway = fakeGateway();
    directory = mkdtempSync(join(tmpdir(), 'luxy-renovar-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('se guarda hacia delante, solo para la sesion con la que se pidio, y sobrevive al reinicio', async () => {
    const sessions = memoryStore();
    const vault = new VaultService(vaultFilePathFor(directory), memoryStore(), { argon2Params: FAST });
    const options = { gatewayUrl: () => 'https://gw.example', fetchImpl: gateway.impl, argon2Params: FAST };
    const accounts = new VaultAccountManager(vault, sessions, options);
    await accounts.register(EMAIL, PASSWORD);
    const token = accounts.sessionToken();
    const antes = accounts.status().expiresAt!;
    const despues = new Date(Date.parse(antes) + 30 * 24 * 3_600_000).toISOString();

    // una respuesta de otra sesion no la toca
    accounts.renewSessionExpiry('token-de-otra-sesion-0000', despues);
    expect(accounts.status().expiresAt).toBe(antes);
    // una mas corta tampoco
    accounts.renewSessionExpiry(token, new Date(Date.parse(antes) - 1000).toISOString());
    expect(accounts.status().expiresAt).toBe(antes);

    accounts.renewSessionExpiry(token, despues);
    expect(accounts.status().expiresAt).toBe(despues);
    expect(new VaultAccountManager(vault, sessions, options).status().expiresAt).toBe(despues);
  });
});
