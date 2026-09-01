// servicio de la boveda. Vive SOLO en el proceso principal.
//
// Es el unico objeto de todo Luxy que llega a tener la llave maestra en claro,
// y la tiene unicamente en memoria. Las reglas que lo gobiernan:
//
//   1. la llave maestra NUNCA se devuelve. Ni al renderer, ni al agente, ni a
//      otro modulo del main. Lo unico que sale son subclaves derivadas para un
//      dominio y un objeto concretos;
//   2. `status()` es lo unico que puede cruzar el IPC, y no contiene material
//      criptografico de ningun tipo;
//   3. al bloquear, la llave se sobreescribe y toda lectura posterior falla.
//      No es "ocultar la seccion": es no poder descifrar.
import {
  ARGON2_PARAMS,
  KEY_BYTES,
  VaultCryptoError,
  deriveSubkey,
  deriveVaultId,
  generateMasterKey,
  generateRecoveryKey,
  isValidRecoveryKey,
  randomBytes,
  toBase64Url,
  fromBase64Url,
  unwrapMasterKey,
  unwrapMasterKeyFromDevice,
  wipe,
  wrapMasterKey,
  wrapMasterKeyForDevice,
  type Argon2Params,
  type KeyDomain,
} from '@luxy/vault-crypto';
import {
  AUTO_LOCK_MINUTES,
  DEFAULT_AUTO_LOCK_MINUTES,
  createVaultKeyFile,
  findWrap,
  readVaultKeyFile,
  removeWrap,
  upsertWrap,
  writeVaultKeyFile,
  VaultFileError,
  type AutoLockMinutes,
  type VaultKeyFile,
} from './key-file.js';

export class VaultError extends Error {
  constructor(
    message: string,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

/**
 * custodia de la llave del equipo.
 *
 * se inyecta en vez de usar SecretStore directamente para poder probar el
 * servicio sin Electron, igual que hace SecretStore con su cifrado.
 */
export interface DeviceKeyStore {
  get(): string | undefined;
  set(value: string): void;
  delete(): void;
}

/** lo unico que puede cruzar el IPC. Ni una llave, ni un sobre, ni una sal */
export interface VaultStatus {
  /** false mientras no exista bóveda en este equipo */
  configured: boolean;
  unlocked: boolean;
  /** que formas de abrirla hay configuradas */
  methods: { password: boolean; recovery: boolean; device: boolean };
  /** 0 significa que no se cierra sola */
  autoLockMinutes: number;
  /** milisegundos que quedan para el bloqueo automatico; null si no aplica */
  lockingInMs: number | null;
}

export interface VaultServiceOptions {
  /** inyectable para probar el bloqueo automatico sin esperar de verdad */
  now?: () => number;
  /**
   * coste de Argon2id. Por defecto el real (D-040).
   *
   * Se inyecta SOLO para las pruebas: con los parametros reales cada creacion
   * cuesta ~5 s y la suite entera se iria a varios minutos. Nadie debe pasarlo
   * en produccion, y una prueba verifica que el valor por defecto es el bueno.
   *
   * Bajarlo no debilita una boveda ya creada: cada envoltura guarda los suyos y
   * se abre con ellos.
   */
  argon2Params?: Argon2Params;
}

export class VaultService {
  private masterKey: Uint8Array | null = null;
  private lastActivityAt = 0;
  private readonly now: () => number;
  private readonly argon2Params: Argon2Params;

  constructor(
    private readonly file: string,
    private readonly deviceKeys: DeviceKeyStore,
    options: VaultServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.argon2Params = options.argon2Params ?? ARGON2_PARAMS;
  }

  // ---------------------------------------------------------------------------
  // estado
  // ---------------------------------------------------------------------------

  private contents(): VaultKeyFile | null {
    return readVaultKeyFile(this.file);
  }

  status(): VaultStatus {
    let contents: VaultKeyFile | null = null;
    try {
      contents = this.contents();
    } catch (error) {
      // un archivo dañado no debe impedir que la aplicacion arranque: se
      // informa como "no configurada" y el error real sale al intentar abrirla
      if (!(error instanceof VaultFileError)) throw error;
    }

    return {
      configured: contents !== null,
      unlocked: this.isUnlocked(),
      methods: {
        password: contents !== null && findWrap(contents, 'password') !== undefined,
        recovery: contents !== null && findWrap(contents, 'recovery') !== undefined,
        device: contents !== null && findWrap(contents, 'device') !== undefined,
      },
      autoLockMinutes: this.autoLockMinutes(contents),
      lockingInMs: this.remainingLockMs(contents),
    };
  }

  isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  /** minutos configurados; 0 significa que no se cierra sola */
  private autoLockMinutes(contents: VaultKeyFile | null): number {
    return contents?.settings.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES;
  }

  private autoLockMs(contents: VaultKeyFile | null): number {
    return this.autoLockMinutes(contents) * 60_000;
  }

  private remainingLockMs(contents: VaultKeyFile | null): number | null {
    if (!this.isUnlocked()) return null;
    const limit = this.autoLockMs(contents);
    // sin bloqueo automatico no hay cuenta atras que mostrar
    if (limit === 0) return null;
    return Math.max(0, this.lastActivityAt + limit - this.now());
  }

  /**
   * cambia el bloqueo automatico.
   *
   * exige la boveda abierta: si no, cualquiera que se siente delante podria
   * desactivarlo y dejarla abierta indefinidamente para la proxima vez.
   */
  setAutoLockMinutes(minutes: AutoLockMinutes): void {
    if (this.masterKey === null) {
      throw new VaultError('abre la boveda antes de cambiar su bloqueo automatico');
    }
    if (!AUTO_LOCK_MINUTES.includes(minutes)) {
      throw new VaultError('ese valor de bloqueo automatico no esta permitido');
    }
    const contents = this.requireContents();
    writeVaultKeyFile(this.file, { ...contents, settings: { autoLockMinutes: minutes } });
    this.touch();
  }

  // ---------------------------------------------------------------------------
  // creacion
  // ---------------------------------------------------------------------------

  /**
   * crea la boveda.
   *
   * devuelve la clave de recuperacion UNA sola vez. No se guarda en ningun
   * sitio en claro: si el usuario no la copia, deja de existir. Eso es
   * intencionado, y la interfaz debe decirlo antes de continuar.
   */
  async create(password: string): Promise<{ recoveryKey: string }> {
    if (this.contents() !== null) {
      throw new VaultError('ya existe una boveda en este equipo');
    }
    assertUsablePassword(password);

    const masterKey = generateMasterKey();
    const recoveryKey = generateRecoveryKey();
    try {
      const passwordWrap = await wrapMasterKey(masterKey, password, 'password', this.argon2Params);
      const recoveryWrap = await wrapMasterKey(
        masterKey,
        recoveryKey,
        'recovery',
        this.argon2Params,
      );
      writeVaultKeyFile(this.file, createVaultKeyFile([passwordWrap, recoveryWrap]));
      // se queda abierta: acabar de crearla y tener que escribir la contraseña
      // otra vez no aporta nada
      this.adopt(masterKey);
      return { recoveryKey };
    } catch (error) {
      wipe(masterKey);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // apertura y cierre
  // ---------------------------------------------------------------------------

  async unlock(password: string): Promise<void> {
    await this.unlockWith('password', password);
  }

  async unlockWithRecoveryKey(recoveryKey: string): Promise<void> {
    if (!isValidRecoveryKey(recoveryKey)) {
      throw new VaultError(
        'esa clave de recuperacion no tiene el formato correcto',
        'son ocho grupos de cuatro caracteres, por ejemplo ABCD-EFGH-...',
      );
    }
    await this.unlockWith('recovery', recoveryKey);
  }

  private async unlockWith(method: 'password' | 'recovery', secret: string): Promise<void> {
    const contents = this.requireContents();
    const wrap = findWrap(contents, method);
    if (wrap === undefined) {
      throw new VaultError(
        method === 'password'
          ? 'esta boveda no se abre con contraseña'
          : 'esta boveda no tiene clave de recuperacion',
      );
    }

    try {
      this.adopt(await unwrapMasterKey(wrap, secret));
    } catch (error) {
      if (error instanceof VaultCryptoError) {
        // no se distingue "contraseña incorrecta" de "archivo alterado": decirlo
        // ayudaria a quien este probando contraseñas
        throw new VaultError(
          method === 'password'
            ? 'contraseña incorrecta'
            : 'esa clave de recuperacion no abre esta boveda',
        );
      }
      throw error;
    }
  }

  /** desbloqueo rapido con la cuenta de Windows, si esta activado */
  async unlockWithDevice(): Promise<void> {
    const contents = this.requireContents();
    const wrap = findWrap(contents, 'device');
    const stored = this.deviceKeys.get();
    if (wrap === undefined || stored === undefined) {
      throw new VaultError(
        'este equipo no tiene activado el desbloqueo rapido',
        'abre la boveda con tu contraseña y activalo desde ajustes',
      );
    }

    const deviceKey = fromBase64Url(stored);
    try {
      this.adopt(await unwrapMasterKeyFromDevice(wrap, deviceKey));
    } catch (error) {
      if (error instanceof VaultCryptoError) {
        throw new VaultError(
          'el desbloqueo rapido de este equipo ya no es valido',
          'puede que se creara con otra cuenta de Windows. Abre con tu contraseña.',
        );
      }
      throw error;
    } finally {
      wipe(deviceKey);
    }
  }

  /**
   * cierra la boveda.
   *
   * a partir de aqui los datos siguen en disco pero son indescifrables, tambien
   * para Luxy. Es la diferencia entre esconder una seccion y no poder leerla.
   */
  lock(): void {
    wipe(this.masterKey);
    this.masterKey = null;
    this.lastActivityAt = 0;
  }

  private adopt(masterKey: Uint8Array): void {
    // si ya habia una abierta, la anterior se borra en vez de quedar suelta
    wipe(this.masterKey);
    this.masterKey = masterKey;
    this.touch();
  }

  private requireContents(): VaultKeyFile {
    const contents = this.contents();
    if (contents === null) {
      throw new VaultError('todavia no hay una boveda en este equipo');
    }
    return contents;
  }

  // ---------------------------------------------------------------------------
  // bloqueo automatico
  // ---------------------------------------------------------------------------

  /** marca actividad. lo llama cada operacion que use la boveda */
  touch(): void {
    if (this.isUnlocked()) this.lastActivityAt = this.now();
  }

  /**
   * cierra la boveda si paso el tiempo de inactividad.
   *
   * se comprueba por reloj y no con un temporizador porque un temporizador no
   * se entera de que el equipo estuvo suspendido: al despertar seguiria
   * pendiente, y la boveda habria quedado abierta toda la noche.
   */
  tickAutoLock(): boolean {
    if (!this.isUnlocked()) return false;
    let contents: VaultKeyFile | null = null;
    try {
      contents = this.contents();
    } catch {
      // si el archivo no se puede leer se aplica el valor por defecto: quedarse
      // sin cerrar por un archivo dañado seria el peor fallo posible aqui
    }
    const limit = this.autoLockMs(contents);
    if (limit === 0) return false;
    if (this.now() - this.lastActivityAt < limit) return false;
    this.lock();
    return true;
  }

  // ---------------------------------------------------------------------------
  // material de trabajo
  // ---------------------------------------------------------------------------

  /**
   * la UNICA forma de obtener material criptografico de la boveda.
   *
   * devuelve una subclave derivada, jamas la llave maestra. Quien la reciba no
   * puede llegar desde ella a otras subclaves ni a la maestra: HKDF no se
   * invierte. Y esto sigue siendo del proceso principal: no cruza el IPC.
   */
  /**
   * identificador publico de esta boveda.
   *
   * Es lo unico derivado de la llave maestra que SI puede salir del equipo: se
   * obtiene con HKDF, que no se invierte, asi que el servidor puede agruparlo
   * sin aprender nada de la llave. Ver `deriveVaultId`.
   *
   * Exige la boveda abierta, como todo lo demas: sin llave no hay identificador
   * que derivar.
   */
  vaultId(): string {
    if (this.masterKey === null) {
      throw new VaultError('la boveda esta bloqueada');
    }
    this.touch();
    return deriveVaultId(this.masterKey);
  }

  subkeyFor(domain: KeyDomain, context = ''): Uint8Array {
    if (this.masterKey === null) {
      throw new VaultError(
        'la boveda esta bloqueada',
        'introduce tu contraseña para volver a abrirla',
      );
    }
    this.touch();
    return deriveSubkey(this.masterKey, domain, context);
  }

  // ---------------------------------------------------------------------------
  // gestion de metodos de apertura
  // ---------------------------------------------------------------------------

  /**
   * activa el desbloqueo rapido de este equipo.
   *
   * genera una llave aleatoria, la guarda en el almacen cifrado del sistema
   * (DPAPI, atado a la cuenta de Windows) y envuelve con ella la maestra.
   * Exige la boveda abierta: no se puede activar sin demostrar acceso.
   */
  async enableDeviceUnlock(): Promise<void> {
    if (this.masterKey === null) {
      throw new VaultError('abre la boveda antes de activar el desbloqueo rapido');
    }
    const contents = this.requireContents();

    const deviceKey = randomBytes(KEY_BYTES);
    try {
      const wrap = await wrapMasterKeyForDevice(this.masterKey, deviceKey);
      // primero el secreto y luego el archivo: si falla el segundo paso queda
      // una llave huerfana e inofensiva, no una envoltura que nada puede abrir
      this.deviceKeys.set(toBase64Url(deviceKey));
      writeVaultKeyFile(this.file, upsertWrap(contents, wrap));
    } finally {
      wipe(deviceKey);
    }
  }

  /** desactiva el desbloqueo rapido. la contraseña sigue funcionando */
  disableDeviceUnlock(): void {
    const contents = this.contents();
    if (contents !== null && findWrap(contents, 'device') !== undefined) {
      writeVaultKeyFile(this.file, removeWrap(contents, 'device'));
    }
    this.deviceKeys.delete();
  }

  /**
   * cambia la contraseña sin recifrar la boveda.
   *
   * exige la actual, aunque la boveda este abierta: tener la sesion abierta no
   * es lo mismo que demostrar que conoces la contraseña, y quien se siente
   * delante de un equipo desatendido no deberia poder cambiarla.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    assertUsablePassword(newPassword);
    const contents = this.requireContents();
    const wrap = findWrap(contents, 'password');
    if (wrap === undefined) throw new VaultError('esta boveda no se abre con contraseña');

    let masterKey: Uint8Array | null = null;
    try {
      masterKey = await unwrapMasterKey(wrap, currentPassword);
      const renewed = await wrapMasterKey(masterKey, newPassword, 'password', this.argon2Params);
      writeVaultKeyFile(this.file, upsertWrap(contents, renewed));
    } catch (error) {
      if (error instanceof VaultCryptoError) throw new VaultError('contraseña incorrecta');
      throw error;
    } finally {
      wipe(masterKey);
    }
  }
}

/** requisito minimo de contraseña, en el unico sitio donde se decide */
export const MIN_PASSWORD_LENGTH = 10;

function assertUsablePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new VaultError(
      `la contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
      'una frase de varias palabras es mas facil de recordar y mas dificil de adivinar',
    );
  }
}
