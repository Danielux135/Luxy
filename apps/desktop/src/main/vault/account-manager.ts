// cuenta de la boveda en el proceso principal.
//
// Es el cable que une los dos origenes de la misma llave maestra: el servidor
// (que guarda la llave ENVUELTA y no puede abrirla) y el archivo local
// `vault.json` (que a partir de aqui es una cache de esa misma llave).
//
// El reparto de responsabilidades, que es lo que hace que esto sea seguro:
//
//   - `account-client` habla con el gateway y devuelve la llave maestra abierta;
//   - este modulo la entrega a `VaultService` y no conserva ninguna copia;
//   - `VaultService` es el unico que la guarda, y sigue sin devolverla nunca.
//
// El token de sesion vive aqui y en el almacen cifrado del sistema. NO cruza el
// IPC: el renderer no lo necesita, y darselo seria darle una credencial
// reutilizable contra el gateway.
import {
  ARGON2_PARAMS,
  generateRecoveryKey,
  normalizeRecoveryKey,
  wipe,
  type Argon2Params,
} from '@luxy/vault-crypto';
import { VAULT_MIN_PASSWORD_LENGTH, vaultEmailSchema } from '@luxy/shared';
import { z } from 'zod';
import {
  changeAccountPassword,
  linkAccount,
  loginAccount,
  logoutAccount,
  registerAccount,
  type AccountClientDeps,
  type AccountLoginMethod,
} from './account-client.js';
import { VaultError, type VaultService } from './vault-service.js';

/** lo que se puede contar al renderer sobre la sesion. Nunca el token */
export interface AccountStatus {
  /** correo de la cuenta vinculada a este equipo, aunque no haya sesion */
  email: string | null;
  /** hay una sesion viva contra el gateway */
  signedIn: boolean;
  expiresAt: string | null;
  /**
   * la sesion se abrio con la clave de recuperacion.
   *
   * la interfaz lo necesita para dos cosas: pedir la clave —y no la
   * contraseña— al cambiarla, y proponer elegir una contraseña nueva, que es lo
   * que va a querer hacer quien acaba de recuperar su cuenta.
   */
  openedWithRecoveryKey: boolean;
}

/**
 * custodia del token de sesion.
 *
 * se inyecta, como la llave del equipo, para poder probar todo esto sin
 * Electron. En produccion lo respalda SecretStore, es decir DPAPI.
 */
export interface SessionStore {
  get(): string | undefined;
  set(value: string): void;
  delete(): void;
}

/** lo que se guarda cifrado entre arranques. El token es el unico secreto */
const storedSessionSchema = z.object({
  email: z.string(),
  sessionToken: z.string().min(16).max(200),
  expiresAt: z.string(),
  vaultId: z.string().length(43),
  argon2Params: z.object({
    t: z.number().int(),
    m: z.number().int(),
    p: z.number().int(),
  }),
  /** por que puerta se entro; decide como se prueba «lo que ya sabes» */
  openedWith: z.enum(['password', 'recovery']).default('password'),
});

type StoredSession = z.infer<typeof storedSessionSchema>;

export interface VaultAccountManagerOptions {
  /** el gateway configurado en esta maquina; null si aun no lo hay */
  gatewayUrl: () => string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** solo para pruebas: bajar el coste de Argon2id (ver VaultServiceOptions) */
  argon2Params?: Argon2Params;
}

export class VaultAccountManager {
  private session: StoredSession | null;
  private readonly now: () => number;
  private readonly argon2Params: Argon2Params;

  constructor(
    private readonly vault: VaultService,
    private readonly sessions: SessionStore,
    private readonly options: VaultAccountManagerOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
    this.argon2Params = options.argon2Params ?? ARGON2_PARAMS;
    this.session = this.readStored();
  }

  // ---------------------------------------------------------------------------
  // estado
  // ---------------------------------------------------------------------------

  status(): AccountStatus {
    const live = this.liveSession();
    const bound = this.vault.boundAccount();
    return {
      email: live?.email ?? bound?.email ?? null,
      signedIn: live !== null,
      expiresAt: live?.expiresAt ?? null,
      openedWithRecoveryKey: live?.openedWith === 'recovery',
    };
  }

  /**
   * token con el que se autentica la sincronizacion.
   *
   * lanza en vez de devolver null porque quien lo pide ya no puede continuar
   * sin el, y asi el mensaje explica que hacer.
   */
  sessionToken(): string {
    const live = this.liveSession();
    if (live === null) {
      throw new VaultError(
        'no hay sesion en tu cuenta',
        'entra con tu correo y contraseña desde Privado para sincronizar',
      );
    }
    return live.sessionToken;
  }

  /** olvida la sesion sin avisar al servidor. La usa un 401 del gateway */
  forgetSession(): void {
    this.session = null;
    this.sessions.delete();
  }

  // ---------------------------------------------------------------------------
  // registro, entrada y salida
  // ---------------------------------------------------------------------------

  /**
   * crea la cuenta y deja la boveda abierta con SU llave.
   *
   * la clave de recuperacion se devuelve una vez y no se guarda en claro en
   * ningun sitio: aqui se usa para dejar una envoltura local hecha con ella.
   */
  async register(email: string, password: string): Promise<{ recoveryKey: string }> {
    const address = this.normalizeEmail(email);
    // se comprueba ANTES de tocar la red: si se dejara para el momento de
    // adoptar la llave, quedaria una cuenta creada en el servidor que este
    // equipo no puede usar y que nadie va a limpiar
    if (this.vault.boundAccount() !== null) {
      throw new VaultError(
        'este equipo ya guarda la boveda de una cuenta',
        'sal de esa cuenta y borra su boveda de este equipo antes de crear otra',
      );
    }
    const { session, recoveryKey } = await registerAccount(
      this.deps(),
      address,
      password,
      this.argon2Params,
    );
    try {
      await this.vault.adoptAccountKey({
        masterKey: session.masterKey,
        password,
        recoveryKey,
        account: { email: address, vaultId: session.vaultId },
      });
    } catch (error) {
      wipe(session.masterKey);
      throw error;
    }
    this.remember(address, session);
    return { recoveryKey };
  }

  /**
   * entra en una cuenta que ya existe y adopta su llave en este equipo.
   *
   * `method` decide por que puerta: la contraseña o la clave de recuperacion.
   * Las dos abren la MISMA llave maestra, asi que entrar por una u otra deja el
   * equipo igual de utilizable. La diferencia esta en lo que se puede guardar
   * en la cache local: con la clave de recuperacion no se conoce la contraseña,
   * asi que la envoltura que queda aqui es la de recuperacion, y la interfaz
   * propone elegir una contraseña nueva.
   */
  async login(
    email: string,
    secret: string,
    method: AccountLoginMethod = 'password',
  ): Promise<void> {
    const address = this.normalizeEmail(email);
    const bound = this.vault.boundAccount();
    if (bound !== null && bound.email !== address) {
      throw new VaultError(
        'este equipo guarda la boveda de otra cuenta',
        `esta vinculado a ${bound.email}. Bórrala de este equipo antes de entrar con otra.`,
      );
    }
    const session = await loginAccount(this.deps(), address, secret, method);
    try {
      await this.vault.adoptAccountKey({
        masterKey: session.masterKey,
        ...(method === 'password' ? { password: secret } : { recoveryKey: secret }),
        account: { email: address, vaultId: session.vaultId },
      });
    } catch (error) {
      wipe(session.masterKey);
      throw error;
    }
    this.remember(address, session);
  }

  /**
   * vincula a una cuenta nueva la boveda que YA existe en este equipo.
   *
   * Sube la MISMA llave maestra envuelta con la contraseña, asi que lo que ya
   * hay cifrado aqui se sigue abriendo igual y ademas se podra abrir desde otro
   * equipo. No recifra nada.
   *
   * Devuelve una clave de recuperacion NUEVA, y la anterior deja de valer. No
   * es un capricho: la vieja se mostro una sola vez y no se guardo en ningun
   * sitio, asi que no hay forma de subir al servidor una copia cerrada con
   * ella. Sin clave nueva, esta cuenta no tendria red de seguridad.
   */
  async link(email: string, password: string): Promise<{ recoveryKey: string }> {
    const address = this.normalizeEmail(email);
    if (this.vault.boundAccount() !== null) {
      throw new VaultError('esta boveda ya pertenece a una cuenta');
    }
    // la envoltura que sube tiene que abrirse con la MISMA contraseña que abre
    // este equipo: si no, quedarian dos contraseñas para la misma boveda
    if (!(await this.vault.verifyPassword(password))) {
      throw new VaultError(
        'contraseña incorrecta',
        'usa la misma con la que abres esta boveda: vincularla no la cambia',
      );
    }

    const recoveryKey = generateRecoveryKey();
    const registration = await this.vault.accountRegistration(
      password,
      recoveryKey,
      this.argon2Params,
    );
    const session = await linkAccount(this.deps(), address, registration);
    this.vault.bindAccount({ email: address, vaultId: registration.vaultId });
    // la envoltura local se sustituye por la de la clave nueva: las dos copias,
    // la de aqui y la del servidor, tienen que ser de la MISMA clave
    await this.vault.rewrapLocalRecoveryKey(recoveryKey, this.argon2Params);
    this.remember(address, session);
    return { recoveryKey };
  }

  /**
   * cierra la sesion.
   *
   * cierra tambien la boveda: seguir con ella abierta despues de salir de la
   * cuenta enseñaria el contenido de alguien que acaba de decir que se va. Lo
   * cifrado se queda en el equipo y se vuelve a abrir con la misma contraseña.
   */
  async logout(): Promise<void> {
    const stored = this.session;
    if (stored !== null && this.options.gatewayUrl() !== null) {
      await logoutAccount(this.deps(), stored.sessionToken);
    }
    this.forgetSession();
    this.vault.lock();
  }

  /**
   * cambia la contraseña de la cuenta.
   *
   * El orden importa: primero el servidor, despues la cache local. Si se
   * hiciera al reves, un fallo de red dejaria este equipo abriendo con una
   * contraseña que ningun otro reconoce.
   */
  /**
   * cambia la contraseña de la cuenta.
   *
   * `currentSecret` es lo que ya se sabe: la contraseña actual, o la clave de
   * recuperacion si se entro con ella. Ese segundo caso es el que convierte la
   * recuperacion en algo util de verdad: quien ha olvidado su contraseña entra
   * con la clave y elige una nueva, en vez de quedarse con acceso pero sin
   * poder arreglar nada.
   *
   * La copia de recuperacion del servidor NO se toca: la clave que el usuario
   * guardo en un papel sigue valiendo despues del cambio.
   *
   * El orden importa: primero el servidor, despues la cache local. Si se
   * hiciera al reves, un fallo de red dejaria este equipo abriendo con una
   * contraseña que ningun otro reconoce.
   */
  async changePassword(currentSecret: string, newPassword: string): Promise<void> {
    const live = this.liveSession();
    if (live === null) {
      throw new VaultError(
        'entra en tu cuenta para cambiar la contraseña',
        'el cambio vale para todos tus equipos, asi que necesita al servidor',
      );
    }
    if (newPassword.length < VAULT_MIN_PASSWORD_LENGTH) {
      throw new VaultError(
        `la contraseña debe tener al menos ${VAULT_MIN_PASSWORD_LENGTH} caracteres`,
        'una frase de varias palabras es mas facil de recordar y mas dificil de adivinar',
      );
    }

    // se prueba con la sal y el coste de LA PUERTA por la que se entro: la de
    // la contraseña y la de la clave de recuperacion tienen los suyos
    const proof =
      live.openedWith === 'recovery' ? normalizeRecoveryKey(currentSecret) : currentSecret;
    const currentAuthHash = await this.vault.accountAuthHash(proof, live.argon2Params);
    const renewed = await this.vault.accountPasswordCredentials(newPassword, this.argon2Params);
    await changeAccountPassword(this.deps(), live.sessionToken, currentAuthHash, renewed);
    await this.vault.rewrapLocalPassword(newPassword, this.argon2Params);

    // a partir de aqui este equipo abre con contraseña, asi que la sesion deja
    // de estar «abierta con la clave de recuperacion»
    this.session = { ...live, openedWith: 'password', argon2Params: renewed.argon2Params };
    this.sessions.set(JSON.stringify(this.session));
  }

  // ---------------------------------------------------------------------------
  // interno
  // ---------------------------------------------------------------------------

  private deps(): AccountClientDeps {
    const gatewayUrl = this.options.gatewayUrl();
    if (gatewayUrl === null) {
      throw new VaultError(
        'Luxy todavia no sabe a que gateway conectarse',
        'completa la configuracion de esta maquina en Ajustes antes de crear la cuenta',
      );
    }
    return {
      gatewayUrl,
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
    };
  }

  private normalizeEmail(email: string): string {
    const parsed = vaultEmailSchema.safeParse(email);
    if (!parsed.success) throw new VaultError('ese correo no tiene un formato valido');
    return parsed.data;
  }

  /** la sesion guardada, o null si caduco. Una caducada se borra al detectarla */
  private liveSession(): StoredSession | null {
    if (this.session === null) return null;
    if (Date.parse(this.session.expiresAt) <= this.now()) {
      this.forgetSession();
      return null;
    }
    return this.session;
  }

  private remember(
    email: string,
    session: {
      sessionToken: string;
      expiresAt: string;
      vaultId: string;
      argon2Params: Argon2Params;
      openedWith: AccountLoginMethod;
    },
  ): void {
    this.session = {
      email,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      vaultId: session.vaultId,
      argon2Params: { ...session.argon2Params },
      openedWith: session.openedWith,
    };
    this.sessions.set(JSON.stringify(this.session));
  }

  private readStored(): StoredSession | null {
    const raw = this.sessions.get();
    if (raw === undefined) return null;
    try {
      const parsed = storedSessionSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      // una sesion ilegible no es un error del que informar: se vuelve a entrar
      return null;
    }
  }
}
