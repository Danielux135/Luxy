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
  deriveAuthHash,
  deriveSubkey,
  deriveVaultId,
  generateMasterKey,
  generateRecoveryKey,
  isValidRecoveryKey,
  passwordCredentialsForMasterKey,
  randomBytes,
  registrationForMasterKey,
  toBase64Url,
  fromBase64Url,
  unwrapMasterKey,
  unwrapMasterKeyFromDevice,
  wipe,
  wrapMasterKey,
  wrapMasterKeyForDevice,
  type AccountPasswordCredentials,
  type AccountRegistration,
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

  /**
   * cuenta a la que pertenece la boveda de este equipo, si esta vinculada.
   *
   * se puede leer con la boveda cerrada: no es material criptografico, es la
   * etiqueta que dice de quien es el archivo.
   */
  boundAccount(): { email: string; vaultId: string } | null {
    try {
      return this.contents()?.account ?? null;
    } catch (error) {
      if (error instanceof VaultFileError) return null;
      throw error;
    }
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

  /**
   * abre la boveda con una llave maestra que llega de la cuenta.
   *
   * Es el cable que une los dos origenes de la misma llave. El servidor no
   * guarda la boveda de este equipo: guarda la llave maestra ENVUELTA, y quien
   * la abre es el cliente. Lo que hace este metodo es adoptar esa llave y
   * dejar en disco una copia local envuelta con la misma contraseña, para que
   * el siguiente arranque no dependa de la red.
   *
   * El archivo local pasa a ser una CACHE de la cuenta, no otra boveda: su
   * `vaultId` se deriva de la misma llave, asi que los dos origenes producen
   * el mismo identificador y la misma memoria descifrable.
   *
   * Si ya existia una boveda local de OTRA cuenta, no se pisa: el contenido
   * cifrado con la llave anterior quedaria ilegible sin aviso.
   */
  async adoptAccountKey(input: {
    masterKey: Uint8Array;
    /** ausente cuando se entro con la clave de recuperacion: no se conoce */
    password?: string;
    /** al registrarse, y al entrar con ella: envoltura local de recuperacion */
    recoveryKey?: string;
    account: { email: string; vaultId: string };
  }): Promise<void> {
    if (input.masterKey.length !== KEY_BYTES) {
      throw new VaultError('la llave de la cuenta no es valida');
    }

    const existing = this.safeContents();
    if (existing !== null && existing.account !== undefined) {
      if (existing.account.vaultId !== input.account.vaultId) {
        throw new VaultError(
          'este equipo ya guarda la boveda de otra cuenta',
          `esta vinculado a ${existing.account.email}. Ciérrala y bórrala antes de usar otra.`,
        );
      }
    }

    if (input.password === undefined && input.recoveryKey === undefined) {
      throw new VaultError('no hay con que guardar la boveda en este equipo');
    }

    const wraps: unknown[] = [];
    if (input.password !== undefined) {
      wraps.push(
        await wrapMasterKey(input.masterKey, input.password, 'password', this.argon2Params),
      );
    }
    if (input.recoveryKey !== undefined) {
      wraps.push(
        await wrapMasterKey(input.masterKey, input.recoveryKey, 'recovery', this.argon2Params),
      );
    }

    // se conservan los ajustes y la envoltura de equipo de una cache anterior:
    // volver a entrar no deberia apagar el desbloqueo rapido ni el auto-cierre
    let contents = createVaultKeyFile(wraps, input.account);
    if (existing !== null) {
      contents = { ...contents, settings: existing.settings };
      const device = findWrap(existing, 'device');
      // la envoltura de equipo solo sirve si envuelve ESTA misma llave
      if (device !== undefined && existing.account?.vaultId === input.account.vaultId) {
        contents = upsertWrap(contents, device);
      }
      const recovery = findWrap(existing, 'recovery');
      if (recovery !== undefined && input.recoveryKey === undefined) {
        contents = upsertWrap(contents, recovery);
      }
      const password = findWrap(existing, 'password');
      if (password !== undefined && input.password === undefined) {
        contents = upsertWrap(contents, password);
      }
    }
    writeVaultKeyFile(this.file, contents);
    this.adopt(input.masterKey);
  }

  /**
   * material con el que registrar en una cuenta la boveda que ya existe aqui.
   *
   * La llave maestra no sale: entra la contraseña y sale lo que el servidor
   * puede guardar sin poder abrirlo. Es lo que permite vincular una boveda
   * creada antes de que existieran las cuentas sin recifrar su contenido.
   */
  async accountRegistration(
    password: string,
    recoveryKey: string,
    params?: Argon2Params,
  ): Promise<AccountRegistration> {
    if (this.masterKey === null) {
      throw new VaultError('abre la boveda antes de vincularla a una cuenta');
    }
    assertUsablePassword(password);
    this.touch();
    return registrationForMasterKey(
      this.masterKey,
      password,
      recoveryKey,
      params ?? this.argon2Params,
    );
  }

  /**
   * la puerta de la contraseña, sola, para cambiarla en la cuenta.
   *
   * No toca la copia de recuperacion del servidor: la clave que el usuario
   * guardo en un papel sigue valiendo despues de cambiar la contraseña.
   */
  async accountPasswordCredentials(
    password: string,
    params?: Argon2Params,
  ): Promise<AccountPasswordCredentials> {
    if (this.masterKey === null) throw new VaultError('la boveda esta bloqueada');
    assertUsablePassword(password);
    this.touch();
    return passwordCredentialsForMasterKey(this.masterKey, password, params ?? this.argon2Params);
  }

  /**
   * sustituye la envoltura local de recuperacion.
   *
   * la usa vincular una boveda anterior a las cuentas: la clave de recuperacion
   * vieja se mostro una vez y ya no se conoce, asi que para poder subir una
   * copia de recuperacion al servidor hay que generar una nueva, y las dos
   * copias —la de aqui y la de alli— tienen que ser de la MISMA clave.
   */
  async rewrapLocalRecoveryKey(recoveryKey: string, params?: Argon2Params): Promise<void> {
    if (this.masterKey === null) throw new VaultError('la boveda esta bloqueada');
    const contents = this.requireContents();
    const renewed = await wrapMasterKey(
      this.masterKey,
      recoveryKey,
      'recovery',
      params ?? this.argon2Params,
    );
    writeVaultKeyFile(this.file, upsertWrap(contents, renewed));
    this.touch();
  }

  /**
   * comprueba una contraseña sin cambiar el estado de la boveda.
   *
   * Hace falta al vincular una boveda local a una cuenta: la envoltura que
   * sube tiene que abrirse con la MISMA contraseña que abre este equipo, o el
   * usuario acabaria con dos contraseñas distintas para la misma boveda sin
   * saberlo. Tener la boveda abierta no demuestra conocerla, igual que en
   * `changePassword`.
   */
  async verifyPassword(password: string): Promise<boolean> {
    const contents = this.requireContents();
    const wrap = findWrap(contents, 'password');
    if (wrap === undefined) throw new VaultError('esta boveda no se abre con contraseña');

    let candidate: Uint8Array | null = null;
    try {
      candidate = await unwrapMasterKey(wrap, password);
      return true;
    } catch (error) {
      if (error instanceof VaultCryptoError) return false;
      throw error;
    } finally {
      wipe(candidate);
    }
  }

  /**
   * prueba de que se conoce una contraseña, sin enviarla.
   *
   * Es la segunda vuelta de Argon2id sobre la llave maestra; el servidor la
   * compara con la que guarda. Sirve para demostrar la contraseña ACTUAL al
   * cambiarla, que es justo lo que no demuestra tener la boveda abierta.
   */
  async accountAuthHash(password: string, params: Argon2Params): Promise<string> {
    if (this.masterKey === null) throw new VaultError('la boveda esta bloqueada');
    this.touch();
    return deriveAuthHash(this.masterKey, password, params);
  }

  /**
   * sustituye la envoltura local por otra con la contraseña nueva.
   *
   * lo llama la cuenta DESPUES de que el servidor haya aceptado el cambio: si
   * se hiciera antes, un fallo de red dejaria este equipo abriendo con una
   * contraseña que ya no vale en ningun otro.
   */
  async rewrapLocalPassword(newPassword: string, params?: Argon2Params): Promise<void> {
    if (this.masterKey === null) throw new VaultError('la boveda esta bloqueada');
    assertUsablePassword(newPassword);
    const contents = this.requireContents();
    const renewed = await wrapMasterKey(
      this.masterKey,
      newPassword,
      'password',
      params ?? this.argon2Params,
    );
    writeVaultKeyFile(this.file, upsertWrap(contents, renewed));
    this.touch();
  }

  /** deja constancia de la cuenta en el archivo local, sin tocar las llaves */
  bindAccount(account: { email: string; vaultId: string }): void {
    const contents = this.requireContents();
    writeVaultKeyFile(this.file, { ...contents, account });
  }

  /** lee el archivo tratando uno dañado como inexistente */
  private safeContents(): VaultKeyFile | null {
    try {
      return this.contents();
    } catch (error) {
      if (error instanceof VaultFileError) return null;
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
    if (contents.account !== undefined) {
      // cambiarla solo aqui dejaria el equipo abriendo con una contraseña que
      // el servidor no conoce: desde otro equipo seguiria valiendo la vieja
      throw new VaultError(
        'esta boveda pertenece a una cuenta',
        'cambia la contraseña de la cuenta: se aplica a todos tus equipos',
      );
    }
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
