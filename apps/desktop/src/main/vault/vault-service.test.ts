import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARGON2_PARAMS, openText, sealText, toBase64Url } from '@luxy/vault-crypto';
import {
  MAX_USER_WAIT_MS,
  MIN_PASSWORD_LENGTH,
  VaultError,
  VaultService,
  type DeviceKeyStore,
  type VaultLockEvent,
} from './vault-service.js';
import { DEFAULT_AUTO_LOCK_MINUTES, readVaultKeyFile, vaultFilePathFor } from './key-file.js';

const PASSWORD = 'una frase larga de prueba';

/** almacen de llave del equipo en memoria, en lugar de DPAPI */
function memoryDeviceKeys(): DeviceKeyStore & { value: string | undefined } {
  return {
    value: undefined as string | undefined,
    get() {
      return this.value;
    },
    set(value: string) {
      this.value = value;
    },
    delete() {
      this.value = undefined;
    },
  };
}

describe('VaultService', () => {
  let directory: string;
  let file: string;
  let devices: ReturnType<typeof memoryDeviceKeys>;
  let clock: number;

  /**
   * Argon2 con los parametros reales cuesta ~2,7 s por derivacion, y crear una
   * boveda hace dos. Con los reales este archivo tardaba 252 s y algun caso
   * rozaba el limite de 20 s de vitest, lo que lo habria vuelto intermitente en
   * un equipo mas lento.
   *
   * Aqui se prueba la maquina de estados, no el coste. Del coste se ocupan
   * packages/vault-crypto y la prueba de abajo, que verifica que el valor por
   * defecto del servicio sigue siendo el real.
   */
  const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;

  const service = (): VaultService =>
    new VaultService(file, devices, { now: () => clock, argon2Params: FAST });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-vault-'));
    file = vaultFilePathFor(directory);
    devices = memoryDeviceKeys();
    clock = 1_000_000;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  describe('estado inicial', () => {
    it('sin boveda no esta configurada ni abierta', () => {
      const status = service().status();
      expect(status.configured).toBe(false);
      expect(status.unlocked).toBe(false);
      expect(status.lockingInMs).toBeNull();
    });

    it('no se puede abrir lo que no existe', async () => {
      await expect(service().unlock(PASSWORD)).rejects.toThrow('todavia no hay una boveda');
    });

    it('un archivo dañado no impide arrancar, pero si abrir', async () => {
      writeFileSync(file, '{ esto no es json', 'utf8');
      const vault = service();
      // el estado no lanza: la aplicacion tiene que poder arrancar igual
      expect(vault.status().configured).toBe(false);
      await expect(vault.unlock(PASSWORD)).rejects.toThrow();
    });
  });

  describe('creacion', () => {
    it('crea, queda abierta y devuelve la clave de recuperacion una vez', async () => {
      const vault = service();
      const { recoveryKey } = await vault.create(PASSWORD);

      expect(recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$/);
      expect(vault.isUnlocked()).toBe(true);
      expect(vault.status().methods).toEqual({ password: true, recovery: true, device: false });
    });

    it('el archivo guardado no contiene la contraseña ni la llave maestra', async () => {
      const vault = service();
      const { recoveryKey } = await vault.create(PASSWORD);

      const raw = readFileSync(file, 'utf8');
      expect(raw).not.toContain(PASSWORD);
      expect(raw).not.toContain(recoveryKey);
      expect(raw).not.toContain(recoveryKey.replace(/-/g, ''));
    });

    it('guarda exactamente dos envolturas y ninguna repetida', async () => {
      await service().create(PASSWORD);
      const contents = readVaultKeyFile(file);
      expect(contents?.wraps.map((wrap) => wrap.method).sort()).toEqual(['password', 'recovery']);
    });

    it('rechaza una contraseña demasiado corta', async () => {
      await expect(service().create('corta')).rejects.toThrow(VaultError);
      expect(existsSync(file)).toBe(false);
      expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(10);
    });

    it('no se crea dos veces', async () => {
      await service().create(PASSWORD);
      await expect(service().create(PASSWORD)).rejects.toThrow('ya existe una boveda');
    });
  });

  describe('apertura', () => {
    it('la contraseña correcta abre en una instancia nueva', async () => {
      await service().create(PASSWORD);

      const otra = service();
      expect(otra.isUnlocked()).toBe(false);
      await otra.unlock(PASSWORD);
      expect(otra.isUnlocked()).toBe(true);
    });

    it('la contraseña incorrecta no abre y no dice por que', async () => {
      await service().create(PASSWORD);
      const otra = service();
      await expect(otra.unlock('otra cosa completamente')).rejects.toThrow('contraseña incorrecta');
      expect(otra.isUnlocked()).toBe(false);
    });

    it('la clave de recuperacion abre', async () => {
      const { recoveryKey } = await service().create(PASSWORD);
      const otra = service();
      await otra.unlockWithRecoveryKey(recoveryKey);
      expect(otra.isUnlocked()).toBe(true);
    });

    it('la clave de recuperacion se acepta escrita de forma descuidada', async () => {
      const { recoveryKey } = await service().create(PASSWORD);
      const otra = service();
      await otra.unlockWithRecoveryKey(recoveryKey.toLowerCase().replace(/-/g, ' '));
      expect(otra.isUnlocked()).toBe(true);
    });

    it('una clave de recuperacion mal formada se rechaza antes de derivar', async () => {
      await service().create(PASSWORD);
      const otra = service();
      await expect(otra.unlockWithRecoveryKey('esto-no-vale')).rejects.toThrow(
        'no tiene el formato correcto',
      );
    });
  });

  describe('bloqueo', () => {
    it('tras bloquear no se puede derivar nada', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      expect(() => vault.subkeyFor('conversation', 'c1')).not.toThrow();

      vault.lock('manual');

      expect(vault.isUnlocked()).toBe(false);
      expect(() => vault.subkeyFor('conversation', 'c1')).toThrow('la boveda esta bloqueada');
    });

    it('lo cifrado antes de bloquear queda ilegible, y vuelve al abrir', async () => {
      const vault = service();
      await vault.create(PASSWORD);

      const key = vault.subkeyFor('conversation', 'c1');
      const envelope = await sealText(key, 'vault.conversation', 'contenido privado');

      vault.lock('manual');
      // la boveda ya no puede dar la llave: los datos siguen ahi, ilegibles
      expect(() => vault.subkeyFor('conversation', 'c1')).toThrow(VaultError);

      await vault.unlock(PASSWORD);
      const again = vault.subkeyFor('conversation', 'c1');
      expect(await openText(again, 'vault.conversation', envelope)).toBe('contenido privado');
    });

    it('bloquear dos veces no rompe nada', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.lock('manual');
      expect(() => vault.lock('manual')).not.toThrow();
    });
  });

  describe('bloqueo automatico', () => {
    it('se cierra sola tras el tiempo de inactividad', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);

      clock += 59_000;
      expect(vault.tickAutoLock()).toBe(false);
      expect(vault.isUnlocked()).toBe(true);

      clock += 2_000;
      expect(vault.tickAutoLock()).toBe(true);
      expect(vault.isUnlocked()).toBe(false);
    });

    it('la actividad aplaza el cierre', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);

      clock += 50_000;
      vault.touch();
      clock += 50_000;
      // sin el touch ya habrian pasado 100 s sobre un limite de 60
      expect(vault.tickAutoLock()).toBe(false);
      expect(vault.isUnlocked()).toBe(true);
    });

    // REESCRITA (`D-106`). Decia lo contrario —«usar la boveda cuenta como
    // actividad»— y exigia que `subkeyFor` aplazara el cierre. Con esa prueba en
    // verde la propia pantalla, al releerse sola, tuvo la boveda abierta hora y
    // media sin nadie delante, y ninguna prueba podia fallar por ello
    it('leer la boveda NO cuenta como actividad', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);

      clock += 50_000;
      vault.subkeyFor('media');
      vault.subkeyFor('identity', 'characters');
      clock += 50_000;
      expect(vault.tickAutoLock()).toBe(true);
      expect(vault.isUnlocked()).toBe(false);
    });

    // `INV-LLAVE-001`: el contador que solo salia en la linea de cierre, ahora
    // tambien a mitad de sesion. Mirarlo es SOLO leer: ni deriva ni cuenta como
    // actividad (`D-106`)
    it('el contador de derivaciones se lee sin derivar y sin mantenerla abierta', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);
      const base = vault.derivationCount;

      vault.subkeyFor('media');
      vault.subkeyFor('identity', 'characters');
      expect(vault.derivationCount).toBe(base + 2);
      // leerlo no deriva
      expect(vault.derivationCount).toBe(base + 2);

      clock += 61_000;
      expect(vault.tickAutoLock()).toBe(true);
      // y con la boveda cerrada vale 0, como en la linea de cierre
      expect(vault.derivationCount).toBe(0);
    });

    it('una espera del usuario aplaza el cierre, y el limite empieza al soltarla', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);

      const release = vault.beginUserWait('reply');
      clock += 10 * 60_000;
      expect(vault.tickAutoLock()).toBe(false);
      // la cuenta atras no baja mientras espera: anunciaria un cierre que no llega
      expect(vault.status().lockingInMs).toBe(60_000);

      release();
      clock += 59_000;
      expect(vault.tickAutoLock()).toBe(false);
      clock += 2_000;
      expect(vault.tickAutoLock()).toBe(true);
    });

    it('una espera de imagen tambien aplaza la inactividad, y se cuenta por clase', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);
      const release = vault.beginUserWait('image');
      clock += 10 * 60_000;
      expect(vault.tickAutoLock()).toBe(false);
      expect(vault.activeUserWaits()).toBe(1);
      expect(vault.activeUserWaits('image')).toBe(1);
      // Win+L solo mira los envios
      expect(vault.activeUserWaits('reply')).toBe(0);
      release();
    });

    it('soltar una espera dos veces no la vuelve a contar', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);
      const release = vault.beginUserWait('reply');
      release();
      clock += 61_000;
      release();
      expect(vault.tickAutoLock()).toBe(true);
    });

    it('una espera olvidada no apaga el cierre para siempre', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);

      vault.beginUserWait('reply');
      clock += MAX_USER_WAIT_MS - 1;
      expect(vault.tickAutoLock()).toBe(false);
      clock += 61_000;
      expect(vault.activeUserWaits()).toBe(0);
      expect(vault.tickAutoLock()).toBe(true);
    });

    it('cerrar borra las esperas: una de antes no mantiene abierta la siguiente', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);

      const release = vault.beginUserWait('reply');
      vault.lock('manual');
      await vault.unlock(PASSWORD);
      clock += 61_000;
      expect(vault.tickAutoLock()).toBe(true);
      // y soltarla despues no toca la sesion nueva
      await vault.unlock(PASSWORD);
      clock += 30_000;
      release();
      clock += 31_000;
      expect(vault.tickAutoLock()).toBe(true);
    });

    it('con la boveda cerrada no se puede empezar una espera', () => {
      const vault = service();
      const release = vault.beginUserWait('reply');
      expect(vault.activeUserWaits()).toBe(0);
      expect(() => release()).not.toThrow();
    });

    it('quien escucha el cierre recibe el motivo y el hecho, sin nada mas', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      const events: VaultLockEvent[] = [];
      vault.onLock((event) => events.push(event));
      const vias: string[] = [];
      vault.onUnlock((via) => vias.push(via));

      await vault.unlock(PASSWORD);
      clock += 5_000;
      vault.subkeyFor('media');
      vault.subkeyFor('media', 'otro');
      vault.subkeyFor('identity', 'characters');
      clock += 2_000;
      vault.lock('suspension');
      vault.lock('salida');

      expect(events).toEqual([
        { reason: 'suspension', wasUnlocked: true, openMs: 7_000, derivations: 3 },
        { reason: 'salida', wasUnlocked: false, openMs: null, derivations: 0 },
      ]);
      expect(vias).toEqual(['password']);
    });

    it('la apertura avisa por donde se abrio', async () => {
      const vias: string[] = [];
      const vault = service();
      vault.onUnlock((via) => vias.push(via));
      const { recoveryKey } = await vault.create(PASSWORD);
      vault.lock('manual');
      await vault.unlockWithRecoveryKey(recoveryKey);
      expect(vias).toEqual(['create', 'recovery']);
    });

    it('un oyente del cierre que falla no deja sin aviso a los demas', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      let avisado = false;
      vault.onLock(() => {
        throw new Error('registro roto');
      });
      vault.onLock(() => {
        avisado = true;
      });
      expect(() => vault.lock('manual')).toThrow('registro roto');
      expect(avisado).toBe(true);
      expect(vault.isUnlocked()).toBe(false);
    });

    it('un oyente de la apertura que falla no tumba la apertura', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.lock('manual');
      vault.onUnlock(() => {
        throw new Error('registro roto');
      });
      await vault.unlock(PASSWORD);
      expect(vault.isUnlocked()).toBe(true);
      expect(() => vault.subkeyFor('media')).not.toThrow();
    });

    it('un equipo suspendido mucho tiempo aparece bloqueado al volver', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);

      // se comprueba por reloj, no con temporizador: una suspension larga no
      // puede dejar la boveda abierta toda la noche
      clock += 9 * 60 * 60 * 1000;
      expect(vault.tickAutoLock()).toBe(true);
      expect(vault.isUnlocked()).toBe(false);
    });

    it('sobre una boveda bloqueada no hace nada', () => {
      expect(service().tickAutoLock()).toBe(false);
    });

    it('con el valor 0 no se cierra nunca sola', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(0);

      // una semana entera sin tocarla
      clock += 7 * 24 * 60 * 60 * 1000;
      expect(vault.tickAutoLock()).toBe(false);
      expect(vault.isUnlocked()).toBe(true);
      // y no se muestra cuenta atras, porque no la hay
      expect(vault.status().lockingInMs).toBeNull();
      expect(vault.status().autoLockMinutes).toBe(0);
    });

    it('el ajuste sobrevive a cerrar y volver a abrir', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(60);
      vault.lock('manual');

      const otra = service();
      await otra.unlock(PASSWORD);
      expect(otra.status().autoLockMinutes).toBe(60);
    });

    it('no se puede cambiar con la boveda cerrada', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.lock('manual');
      // si no, cualquiera que se siente delante lo desactivaria para la proxima
      expect(() => vault.setAutoLockMinutes(0)).toThrow('abre la boveda antes');
    });

    it('una boveda nueva usa el valor por defecto', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      expect(vault.status().autoLockMinutes).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    });

    it('el estado informa de cuanto queda', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.setAutoLockMinutes(1);
      clock += 20_000;
      expect(vault.status().lockingInMs).toBe(40_000);

      vault.lock('manual');
      expect(vault.status().lockingInMs).toBeNull();
    });
  });

  describe('subclaves', () => {
    it('cada conversacion tiene la suya', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      const a = toBase64Url(vault.subkeyFor('conversation', 'c1'));
      const b = toBase64Url(vault.subkeyFor('conversation', 'c2'));
      expect(a).not.toBe(b);
    });

    it('son estables entre aperturas', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      const before = toBase64Url(vault.subkeyFor('media', 'm1'));

      vault.lock('manual');
      await vault.unlock(PASSWORD);
      expect(toBase64Url(vault.subkeyFor('media', 'm1'))).toBe(before);
    });

    it('la clave de recuperacion da las mismas subclaves que la contraseña', async () => {
      const vault = service();
      const { recoveryKey } = await vault.create(PASSWORD);
      const conContraseña = toBase64Url(vault.subkeyFor('conversation', 'c1'));

      const otra = service();
      await otra.unlockWithRecoveryKey(recoveryKey);
      // ambas envolturas abren LA MISMA llave maestra
      expect(toBase64Url(otra.subkeyFor('conversation', 'c1'))).toBe(conContraseña);
    });
  });

  describe('desbloqueo rapido del equipo', () => {
    it('se activa con la boveda abierta y luego abre sin contraseña', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      await vault.enableDeviceUnlock();

      const otra = service();
      await otra.unlockWithDevice();
      expect(otra.isUnlocked()).toBe(true);
    });

    it('no se puede activar con la boveda cerrada', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      vault.lock('manual');
      await expect(vault.enableDeviceUnlock()).rejects.toThrow('abre la boveda antes');
    });

    it('da las mismas subclaves que la contraseña', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      await vault.enableDeviceUnlock();
      const esperada = toBase64Url(vault.subkeyFor('conversation', 'c1'));

      const otra = service();
      await otra.unlockWithDevice();
      expect(toBase64Url(otra.subkeyFor('conversation', 'c1'))).toBe(esperada);
    });

    it('sin activarlo, falla con una explicacion util', async () => {
      await service().create(PASSWORD);
      await expect(service().unlockWithDevice()).rejects.toThrow('desbloqueo rapido');
    });

    it('si la llave del equipo cambia, se rechaza sin romper la contraseña', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      await vault.enableDeviceUnlock();

      // simula otra cuenta de Windows: la envoltura sigue, la llave ya no sirve
      devices.set(toBase64Url(new Uint8Array(32).fill(9)));

      const otra = service();
      await expect(otra.unlockWithDevice()).rejects.toThrow('ya no es valido');
      await expect(otra.unlock(PASSWORD)).resolves.toBeUndefined();
    });

    it('desactivarlo borra la envoltura y la llave del equipo', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      await vault.enableDeviceUnlock();

      vault.disableDeviceUnlock();

      expect(devices.get()).toBeUndefined();
      expect(vault.status().methods.device).toBe(false);
      // la contraseña sigue funcionando: desactivar no es perder la boveda
      const otra = service();
      await expect(otra.unlock(PASSWORD)).resolves.toBeUndefined();
    });
  });

  describe('cambio de contraseña', () => {
    it('la nueva abre, la antigua deja de abrir', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      await vault.changePassword(PASSWORD, 'otra frase igual de larga');

      const otra = service();
      await expect(otra.unlock(PASSWORD)).rejects.toThrow('contraseña incorrecta');
      await expect(otra.unlock('otra frase igual de larga')).resolves.toBeUndefined();
    });

    it('no recifra: lo guardado antes se sigue abriendo', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      const envelope = await sealText(
        vault.subkeyFor('conversation', 'c1'),
        'vault.conversation',
        'escrito antes del cambio',
      );

      await vault.changePassword(PASSWORD, 'otra frase igual de larga');

      const otra = service();
      await otra.unlock('otra frase igual de larga');
      const key = otra.subkeyFor('conversation', 'c1');
      expect(await openText(key, 'vault.conversation', envelope)).toBe('escrito antes del cambio');
    });

    it('exige la contraseña actual aunque la boveda este abierta', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      // tener la sesion abierta no demuestra conocer la contraseña
      await expect(vault.changePassword('equivocada', 'otra frase larga aqui')).rejects.toThrow(
        'contraseña incorrecta',
      );
    });

    it('rechaza una nueva contraseña demasiado corta', async () => {
      const vault = service();
      await vault.create(PASSWORD);
      await expect(vault.changePassword(PASSWORD, 'corta')).rejects.toThrow(VaultError);
    });

    it('la clave de recuperacion sigue valiendo despues del cambio', async () => {
      const vault = service();
      const { recoveryKey } = await vault.create(PASSWORD);
      await vault.changePassword(PASSWORD, 'otra frase igual de larga');

      const otra = service();
      await expect(otra.unlockWithRecoveryKey(recoveryKey)).resolves.toBeUndefined();
    });
  });

  describe('coste de derivacion', () => {
    it(
      'por defecto usa los parametros reales, no los de las pruebas',
      async () => {
        // sin esto, inyectar parametros para acelerar la suite podria acabar
        // silenciosamente en produccion
        const real = new VaultService(file, devices, { now: () => clock });
        await real.create(PASSWORD);

        const contents = readVaultKeyFile(file);
        const wrap = contents?.wraps.find((entry) => entry.method === 'password');
        expect(wrap?.params).toEqual({ ...ARGON2_PARAMS });
      },
      120_000,
    );
  });

  describe('lo que el estado expone', () => {
    it('no contiene material criptografico de ningun tipo', async () => {
      const vault = service();
      const { recoveryKey } = await vault.create(PASSWORD);
      await vault.enableDeviceUnlock();

      const serialized = JSON.stringify(vault.status());
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain(recoveryKey);
      expect(serialized).not.toContain(devices.get() ?? 'NADA');
      // ni sales, ni sobres, ni nada que se le parezca
      expect(serialized).not.toContain('ciphertext');
      expect(serialized).not.toContain('salt');
      expect(Object.keys(vault.status()).sort()).toEqual([
        'autoLockMinutes',
        'configured',
        'lockingInMs',
        'methods',
        'unlocked',
      ]);
    });
  });
});
