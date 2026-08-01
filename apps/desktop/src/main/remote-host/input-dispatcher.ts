// despacho de eventos de entrada al sistema.
//
// La capa que TOCA Windows esta detras de una interfaz, por dos razones:
//
//   1. Se empieza con koffi llamando a user32!SendInput y se migrara a un
//      auxiliar nativo en Rust cuando choquemos con el techo de DPI y UIPI.
//      Ver docs/adr/0005-host-windows.md. Con la interfaz, migrar es escribir
//      otra clase.
//   2. Toda la logica -que es donde estan los fallos- se puede probar sin
//      Windows, sin pantalla y sin mover el raton de nadie.
//
// LO QUE ESTE ARCHIVO RESUELVE Y NO ES OBVIO: el estado de las teclas. SendInput
// no reinicia el teclado. Si el canal se cae con Ctrl pulsado, la tecla se queda
// PEGADA en el ordenador y el usuario se encuentra la maquina haciendose cosas
// raras sin saber por que. Hay que llevar la cuenta de lo que esta pulsado y
// soltarlo.
import type { ControlMessage, Modifier, MouseButton, SpecialKey } from '@luxy/remote-protocol';
import {
  resolveMonitor,
  toAbsolute,
  type AbsolutePoint,
  type DisplayInfo,
} from './monitors.js';

/** lo minimo que tiene que saber hacer la capa nativa */
export interface InputBackend {
  moveTo(point: AbsolutePoint): void;
  mouseButton(button: MouseButton, action: 'down' | 'up', point: AbsolutePoint): void;
  scroll(point: AbsolutePoint, dx: number, dy: number): void;
  keyDown(key: SpecialKey | Modifier): void;
  keyUp(key: SpecialKey | Modifier): void;
  typeText(text: string): void;
}

export interface DispatchResult {
  ok: boolean;
  /** por que no se ejecuto, para poder decirselo al usuario */
  reason?: string;
}

/**
 * lleva el estado de lo pulsado y traduce mensajes a llamadas nativas.
 *
 * No comprueba permisos: eso ya lo hizo guardControlMessage, que es la puerta
 * unica. Aqui se asume que el mensaje esta autorizado, y se hace UNA cosa:
 * traducirlo bien.
 */
export class InputDispatcher {
  private readonly botonesPulsados = new Set<MouseButton>();
  private readonly teclasPulsadas = new Set<SpecialKey | Modifier>();
  private monitorActual: string | null = null;

  constructor(
    private readonly backend: InputBackend,
    private displays: readonly DisplayInfo[],
  ) {}

  /** se llama cuando cambian los monitores en caliente */
  updateDisplays(displays: readonly DisplayInfo[]): void {
    this.displays = displays;
    // si el monitor elegido desaparecio, se vuelve al primario en vez de
    // quedarse apuntando a la nada
    if (this.monitorActual !== null && !displays.some((d) => d.id === this.monitorActual)) {
      this.monitorActual = null;
    }
  }

  currentMonitorId(): string | null {
    return this.monitorActual;
  }

  /** cuantas teclas y botones quedan pulsados; util para el diagnostico */
  pressedCount(): number {
    return this.botonesPulsados.size + this.teclasPulsadas.size;
  }

  /**
   * ejecuta un mensaje ya autorizado.
   *
   * NUNCA lanza. Un fallo de la capa nativa se informa como resultado, no como
   * excepcion: si se propagara, un solo clic fallido podria tumbar el manejador
   * de la sesion entera y cortar la conexion por nada.
   */
  dispatch(message: ControlMessage): DispatchResult {
    try {
      return this.ejecutar(message);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'la capa de entrada fallo',
      };
    }
  }

  private ejecutar(message: ControlMessage): DispatchResult {
    const monitor = resolveMonitor(this.displays, this.monitorActual);
    if (monitor === null) {
      return { ok: false, reason: 'no hay ningun monitor disponible' };
    }

    switch (message.type) {
      case 'mouse.move':
        this.backend.moveTo(this.punto(message.x, message.y, monitor));
        return { ok: true };

      case 'mouse.button': {
        const punto = this.punto(message.x, message.y, monitor);
        // el estado se actualiza ANTES de llamar: si la llamada nativa lanza, el
        // boton queda registrado como pulsado y releaseAll lo soltara. Al reves
        // se quedaria pulsado sin que nadie lo supiera.
        if (message.action === 'down') this.botonesPulsados.add(message.button);
        else this.botonesPulsados.delete(message.button);

        this.backend.mouseButton(message.button, message.action, punto);
        return { ok: true };
      }

      case 'mouse.scroll':
        this.backend.scroll(this.punto(message.x, message.y, monitor), message.dx, message.dy);
        return { ok: true };

      case 'key.press':
        return this.pulsarCombinacion(message.key, message.modifiers);

      case 'key.text':
        this.backend.typeText(message.text);
        return { ok: true };

      case 'input.release_all':
        this.releaseAll();
        return { ok: true };

      case 'monitor.select': {
        const existe = this.displays.some((d) => d.id === message.monitorId);
        if (!existe) return { ok: false, reason: 'ese monitor ya no existe' };
        this.monitorActual = message.monitorId;
        return { ok: true };
      }

      case 'quality.set':
        // no toca la entrada; lo aplica el renderer de captura
        return { ok: true };
    }
  }

  /**
   * pulsa una combinacion completa.
   *
   * Los modificadores se sueltan en ORDEN INVERSO, que es lo que hace un teclado
   * real: Ctrl+Shift+T suelta T, luego Shift, luego Ctrl. Soltarlos en el mismo
   * orden deja combinaciones intermedias que algunas aplicaciones interpretan.
   */
  private pulsarCombinacion(key: SpecialKey, modifiers: readonly Modifier[]): DispatchResult {
    for (const modificador of modifiers) {
      this.teclasPulsadas.add(modificador);
      this.backend.keyDown(modificador);
    }

    this.teclasPulsadas.add(key);
    this.backend.keyDown(key);
    this.backend.keyUp(key);
    this.teclasPulsadas.delete(key);

    for (const modificador of [...modifiers].reverse()) {
      this.backend.keyUp(modificador);
      this.teclasPulsadas.delete(modificador);
    }

    return { ok: true };
  }

  /**
   * suelta TODO lo que quedara pulsado.
   *
   * Se llama al terminar la sesion, al perder el canal y cuando el cliente lo
   * pide. NO es opcional: sin esto, un corte de red con Ctrl pulsado deja la
   * tecla hundida en el ordenador.
   *
   * No lanza aunque el backend falle: si una tecla no se puede soltar, hay que
   * seguir intentandolo con las demas.
   */
  releaseAll(): void {
    for (const boton of this.botonesPulsados) {
      try {
        this.backend.mouseButton(boton, 'up', { dx: 0, dy: 0 });
      } catch {
        // se sigue con los demas
      }
    }
    this.botonesPulsados.clear();

    for (const tecla of this.teclasPulsadas) {
      try {
        this.backend.keyUp(tecla);
      } catch {
        // se sigue con las demas
      }
    }
    this.teclasPulsadas.clear();
  }

  private punto(x: number, y: number, monitor: DisplayInfo): AbsolutePoint {
    return toAbsolute(x, y, monitor, this.displays);
  }
}

// -----------------------------------------------------------------------------
// deteccion del fallo silencioso de UIPI
// -----------------------------------------------------------------------------

/**
 * SendInput FALLA EN SILENCIO contra ventanas elevadas.
 *
 * La documentacion de Microsoft lo dice sin rodeos: "neither GetLastError nor
 * the return value will indicate the failure was caused by UIPI blocking". El
 * usuario hace clic, la llamada devuelve exito y NO PASA NADA. Sin avisar,
 * parece que Luxy esta roto.
 *
 * No se puede detectar por el valor de retorno, asi que se detecta por otra via:
 * preguntando por la ventana en primer plano. Esa consulta la hace la capa
 * nativa; aqui esta la decision de que decirle al usuario.
 */
export interface ForegroundWindowInfo {
  title: string;
  elevated: boolean;
}

export function describeElevatedBlock(info: ForegroundWindowInfo | null): string | null {
  if (info === null || !info.elevated) return null;

  const nombre = info.title.trim().length > 0 ? `"${info.title}"` : 'la ventana activa';
  return (
    `${nombre} se ejecuta como administrador, asi que Windows bloquea el control remoto ` +
    'sobre ella. Tus clics y teclas no llegaran mientras esa ventana tenga el foco. ' +
    'No es un fallo de Luxy y no se puede sortear sin elevar Luxy tambien.'
  );
}
