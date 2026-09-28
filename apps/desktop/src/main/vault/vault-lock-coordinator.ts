// quien decide CUANDO se cierra la boveda sin que nadie pulse el boton.
//
// Vive aparte de `main/index.ts` por una razon concreta: ninguna prueba importa
// ese archivo, porque carga Electron, y el `setInterval` que cerraba la boveda
// por inactividad no lo cubria nada. Aqui no se importa Electron: el
// `powerMonitor` llega inyectado y en las pruebas es un EventEmitter (`D-106`).
//
// Tambien es el UNICO sitio que escribe «boveda abierta» y «boveda cerrada».
// Enganchado a `onLock` y `onUnlock` y no a cada handler, porque cerrar y abrir
// ocurre por caminos que ningun handler ve: salir de Luxy, cerrar la sesion de
// la cuenta, entrar con ella.
import type { VaultLockEvent, VaultService } from './vault-service.js';
import type { VaultLockReason, VaultUnlockVia } from '../../shared/vault-lock.js';

/** cada cuanto se mira el reloj de inactividad */
export const VAULT_TICK_MS = 15_000;

/**
 * cuanto se aplaza, como mucho, el cierre por bloquear Windows con una
 * respuesta en camino. Solo un ENVIO suyo lo aplaza, y solo hasta que su
 * respuesta queda guardada: una imagen que se este generando o aprobando no,
 * tampoco la de un turno (con el texto en disco el envio la espera como
 * `image`), porque este tope se midio sobre turnos privados.
 *
 * Con la pantalla bloqueada Windows ya impide usar la interfaz; lo que queda
 * expuesto es la llave en memoria unos minutos. A cambio no se tira una
 * respuesta ya pagada. Diez minutos cubren el p99 medido de un turno privado
 * (616 s sobre 151). A 0, Win+L cierra siempre en el acto.
 */
export const LOCK_SCREEN_GRACE_MS = 10 * 60_000;

/** los avisos del sistema que se escuchan; los nombres son los de Electron */
export type VaultPowerEvent = 'lock-screen' | 'unlock-screen' | 'suspend';

export interface VaultPowerSource {
  on(event: VaultPowerEvent, listener: () => void): unknown;
  removeListener(event: VaultPowerEvent, listener: () => void): unknown;
}

type CoordinatedVault = Pick<
  VaultService,
  'isUnlocked' | 'lock' | 'touch' | 'tickAutoLock' | 'activeUserWaits' | 'onLock' | 'onUnlock'
>;

export interface VaultLockCoordinatorOptions {
  vault: CoordinatedVault;
  power: VaultPowerSource;
  log: (message: string, fields?: Record<string, unknown>) => void;
  /** avisa a la pantalla. Viaja el motivo, un enumerado cerrado, y nada mas */
  notifyRenderer: (reason: VaultLockReason) => void;
  tickMs?: number;
  lockScreenGraceMs?: number;
  now?: () => number;
}

export class VaultLockCoordinator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly unsubscribe: (() => void)[] = [];
  /** un cierre que espera a que llegue la respuesta que el estaba esperando */
  private pending: { reason: VaultLockReason; since: number } | null = null;
  private readonly tickMs: number;
  private readonly graceMs: number;
  private readonly now: () => number;

  private readonly onLockScreen = (): void => this.guard(() => this.lockScreen());
  private readonly onUnlockScreen = (): void => this.guard(() => this.unlockScreen());
  private readonly onSuspend = (): void =>
    this.guard(() => {
      // al suspender la memoria sigue alimentada durante horas y la red se cae
      // de todos modos: una respuesta en camino no llegaria
      if (this.options.vault.isUnlocked()) this.options.vault.lock('suspension');
    });

  constructor(private readonly options: VaultLockCoordinatorOptions) {
    this.tickMs = options.tickMs ?? VAULT_TICK_MS;
    this.graceMs = options.lockScreenGraceMs ?? LOCK_SCREEN_GRACE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer !== null) return;
    const { vault, power } = this.options;
    // el cierre por inactividad se comprueba por reloj, no con un temporizador
    // de un solo disparo: asi una suspension larga aparece cerrada al volver
    this.timer = setInterval(() => this.tick(), this.tickMs);
    power.on('lock-screen', this.onLockScreen);
    power.on('unlock-screen', this.onUnlockScreen);
    power.on('suspend', this.onSuspend);
    this.unsubscribe.push(
      vault.onLock((event) => this.guard(() => this.closed(event))),
      vault.onUnlock((via) => this.guard(() => this.opened(via))),
    );
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const { power } = this.options;
    power.removeListener('lock-screen', this.onLockScreen);
    power.removeListener('unlock-screen', this.onUnlockScreen);
    power.removeListener('suspend', this.onSuspend);
    for (const off of this.unsubscribe.splice(0)) off();
    this.pending = null;
  }

  /**
   * una vuelta del temporizador.
   *
   * Todo dentro de `guard`: si el registro o el aviso lanzan, la vuelta
   * siguiente tiene que ocurrir igual. Antes no habia try/catch y un fallo al
   * escribir el log podia dejar la boveda sin cierre automatico.
   */
  tick(): void {
    this.guard(() => {
      const { vault } = this.options;
      if (this.pending !== null) {
        if (!vault.isUnlocked()) {
          this.pending = null;
          return;
        }
        const waited = this.now() - this.pending.since;
        if (vault.activeUserWaits('reply') === 0 || waited >= this.graceMs) {
          vault.lock(this.pending.reason);
        }
        return;
      }
      vault.tickAutoLock();
    });
  }

  /**
   * la ventana se ha cerrado con la X.
   *
   * Cierra en el acto aunque haya un envio: aqui no hay pantalla de Windows que
   * proteja, y quien la vuelva a abrir desde la bandeja veria el contenido.
   */
  windowClosed(): void {
    this.guard(() => {
      if (this.options.vault.isUnlocked()) this.options.vault.lock('ventana-cerrada');
    });
  }

  private lockScreen(): void {
    const { vault } = this.options;
    if (!vault.isUnlocked()) return;
    // solo un envio suyo: generar o aprobar una imagen no deja la llave en
    // memoria con Windows bloqueado (`D-106`)
    const waits = vault.activeUserWaits('reply');
    if (waits === 0 || this.graceMs <= 0) {
      vault.lock('pantalla-bloqueada');
      return;
    }
    // pulsar Win+L justo mientras espera una respuesta es lo normal: se deja
    // que llegue y se guarde, y se cierra en la vuelta siguiente del reloj
    this.pending = { reason: 'pantalla-bloqueada', since: this.now() };
    this.options.log('cierre de la boveda aplazado', {
      motivo: 'pantalla-bloqueada',
      envios: waits,
    });
  }

  private unlockScreen(): void {
    if (this.pending === null) return;
    const aplazadoMs = this.now() - this.pending.since;
    const motivo = this.pending.reason;
    this.pending = null;
    // ha vuelto antes de que el cierre llegara: esta delante
    this.options.vault.touch();
    this.options.log('cierre de la boveda anulado', { motivo, aplazadoMs });
  }

  private closed(event: VaultLockEvent): void {
    const deferred = this.pending;
    this.pending = null;
    // `lock()` avisa tambien con la boveda ya cerrada —salir la cierra dos
    // veces—, y eso no es un cierre nuevo: ni linea ni aviso
    if (!event.wasUnlocked) return;
    // primero la pantalla, que es la que tiene contenido descifrado que vaciar:
    // un registro que falle no puede dejarla sin aviso
    this.guard(() => this.options.notifyRenderer(event.reason));
    this.options.log('boveda cerrada', {
      motivo: event.reason,
      abiertaMs: event.openMs,
      derivaciones: event.derivations,
      ...(deferred === null ? {} : { aplazadoMs: this.now() - deferred.since }),
    });
  }

  private opened(via: VaultUnlockVia): void {
    this.options.log('boveda abierta', { via });
  }

  /** nada de lo que haga el coordinador puede tumbar a quien lo llama */
  private guard(work: () => void): void {
    try {
      work();
    } catch (error) {
      try {
        // el tipo y nada mas: el mensaje de un error de la boveda podria
        // arrastrar algo que no debe ir a un registro
        this.options.log('fallo en el cierre automatico de la boveda', {
          tipo: error instanceof Error ? error.name : typeof error,
        });
      } catch {
        // si tampoco se puede registrar, la vuelta siguiente lo intenta de nuevo
      }
    }
  }
}
