// construccion de las estructuras INPUT que espera user32!SendInput.
//
// POR QUE ESTE ARCHIVO EXISTE SEPARADO DEL BACKEND:
//
// Todo lo que puede salir mal aqui son BANDERAS. Un flag olvidado no rompe nada
// visible: la llamada devuelve exito y el cursor aparece en otro sitio, o el
// scroll va al reves, o Alt+Tab abre el menu del sistema. Son fallos que solo se
// ven con una pantalla delante, y ahi es donde no hay pruebas automaticas.
//
// Asi que el calculo de las banderas vive aqui, en codigo puro, con pruebas que
// comprueban los numeros exactos. El backend de koffi solo copia estos campos a
// memoria: si el plan es correcto, lo unico que queda por verificar a mano es que
// koffi cargue y que la llamada llegue.
import type { Modifier, MouseButton, SpecialKey } from '@luxy/remote-protocol';
import { scanCodeFor, textToUnitChunks } from './keycodes.js';
import type { AbsolutePoint } from './monitors.js';

// banderas de MOUSEINPUT.dwFlags (winuser.h)
export const MOUSEEVENTF = {
  MOVE: 0x0001,
  LEFTDOWN: 0x0002,
  LEFTUP: 0x0004,
  RIGHTDOWN: 0x0008,
  RIGHTUP: 0x0010,
  MIDDLEDOWN: 0x0020,
  MIDDLEUP: 0x0040,
  WHEEL: 0x0800,
  HWHEEL: 0x1000,
  VIRTUALDESK: 0x4000,
  ABSOLUTE: 0x8000,
} as const;

// banderas de KEYBDINPUT.dwFlags
export const KEYEVENTF = {
  EXTENDEDKEY: 0x0001,
  KEYUP: 0x0002,
  UNICODE: 0x0004,
  SCANCODE: 0x0008,
} as const;

export const INPUT_MOUSE = 0;
export const INPUT_KEYBOARD = 1;

/** una muesca de rueda. Windows lo define asi y las aplicaciones lo asumen */
export const WHEEL_DELTA = 120;

export interface MouseInputPlan {
  kind: 'mouse';
  dx: number;
  dy: number;
  /** muescas de rueda para WHEEL/HWHEEL; 0 en el resto */
  mouseData: number;
  flags: number;
}

export interface KeyInputPlan {
  kind: 'key';
  /** SIEMPRE 0 salvo que se quiera un virtual-key, cosa que aqui no se hace */
  wVk: number;
  wScan: number;
  flags: number;
}

export type InputPlan = MouseInputPlan | KeyInputPlan;

/**
 * posicionamiento absoluto sobre el escritorio virtual.
 *
 * Las tres banderas van SIEMPRE juntas y en este orden conceptual:
 *   - ABSOLUTE: sin ella el valor se interpreta como desplazamiento relativo, y
 *     la aceleracion del raton lo multiplica hasta por cuatro. El cursor no
 *     llegaria nunca al sitio pedido.
 *   - VIRTUALDESK: sin ella el 0..65535 se reparte SOLO sobre el monitor
 *     primario, asi que con dos monitores nada cae en el secundario.
 *   - MOVE: el evento de movimiento propiamente dicho.
 */
const POSICION = MOUSEEVENTF.ABSOLUTE | MOUSEEVENTF.VIRTUALDESK | MOUSEEVENTF.MOVE;

export function planMove(point: AbsolutePoint): InputPlan[] {
  return [{ kind: 'mouse', dx: point.dx, dy: point.dy, mouseData: 0, flags: POSICION }];
}

const BOTONES: Record<MouseButton, { down: number; up: number }> = {
  left: { down: MOUSEEVENTF.LEFTDOWN, up: MOUSEEVENTF.LEFTUP },
  right: { down: MOUSEEVENTF.RIGHTDOWN, up: MOUSEEVENTF.RIGHTUP },
  middle: { down: MOUSEEVENTF.MIDDLEDOWN, up: MOUSEEVENTF.MIDDLEUP },
};

/**
 * pulsacion o soltado de boton.
 *
 * El movimiento y el boton van en DOS estructuras dentro de la MISMA llamada, no
 * combinados en una. Combinar MOVE con LEFTDOWN en un solo INPUT funciona en
 * Windows, pero algunas aplicaciones (y el arrastre de la propia shell) leen el
 * punto del mensaje anterior y se quedan con la posicion vieja. Separarlos es lo
 * que hace un raton de verdad.
 *
 * point puede ser null, y ESO IMPORTA: releaseAll suelta botones sin saber donde
 * esta el cursor. Si en ese caso se emitiera un movimiento con dx=0,dy=0, soltar
 * un boton al cortar la sesion TELETRANSPORTARIA el cursor a la esquina superior
 * izquierda de la pantalla del usuario.
 */
export function planButton(
  button: MouseButton,
  action: 'down' | 'up',
  point: AbsolutePoint | null,
): InputPlan[] {
  const flags = BOTONES[button][action];
  const plan: InputPlan[] = [];
  if (point !== null) plan.push(...planMove(point));
  plan.push({ kind: 'mouse', dx: 0, dy: 0, mouseData: 0, flags });
  return plan;
}

/**
 * rueda vertical y horizontal.
 *
 * mouseData va en muescas de 120 y es un ENTERO CON SIGNO de 32 bits que el
 * campo guarda como sin signo: un scroll hacia abajo (negativo) tiene que
 * viajar en complemento a dos, o Windows lee un desplazamiento gigantesco hacia
 * arriba.
 *
 * El signo horizontal es al reves que el vertical en el protocolo: dx positivo
 * significa "contenido hacia la derecha", que en Windows es HWHEEL positivo.
 */
export function planScroll(point: AbsolutePoint, dx: number, dy: number): InputPlan[] {
  const plan: InputPlan[] = [...planMove(point)];

  if (dy !== 0) {
    plan.push({
      kind: 'mouse',
      dx: 0,
      dy: 0,
      mouseData: toUint32(Math.round(dy * WHEEL_DELTA)),
      flags: MOUSEEVENTF.WHEEL,
    });
  }
  if (dx !== 0) {
    plan.push({
      kind: 'mouse',
      dx: 0,
      dy: 0,
      mouseData: toUint32(Math.round(dx * WHEEL_DELTA)),
      flags: MOUSEEVENTF.HWHEEL,
    });
  }

  return plan;
}

/** complemento a dos en 32 bits, que es como viaja mouseData */
export function toUint32(value: number): number {
  return value >>> 0;
}

/**
 * pulsar o soltar una tecla por scancode.
 *
 * wVk va a 0 y se pone KEYEVENTF_SCANCODE: con el flag puesto Windows ignora el
 * virtual-key y usa el scancode, que es lo que queremos (ver keycodes.ts).
 */
export function planKey(key: SpecialKey | Modifier, action: 'down' | 'up'): InputPlan[] {
  const scan = scanCodeFor(key);
  if (scan === null) return [];

  let flags = KEYEVENTF.SCANCODE;
  if (scan.extended) flags |= KEYEVENTF.EXTENDEDKEY;
  if (action === 'up') flags |= KEYEVENTF.KEYUP;

  return [{ kind: 'key', wVk: 0, wScan: scan.code, flags }];
}

/**
 * texto Unicode, en lotes.
 *
 * KEYEVENTF_UNICODE EXIGE wVk=0; con cualquier virtual-key puesto, Windows
 * descarta el evento en silencio. Y no admite modificadores: por eso el
 * protocolo separa key.text de key.press en vez de tener un solo mensaje.
 *
 * Cada unidad necesita su pareja down+up. Sin el up, la aplicacion receptora ve
 * la tecla como mantenida y algunas repiten el caracter.
 */
export function planText(text: string): InputPlan[][] {
  return textToUnitChunks(text).map((unidades) => {
    const lote: InputPlan[] = [];
    for (const unidad of unidades) {
      lote.push({ kind: 'key', wVk: 0, wScan: unidad, flags: KEYEVENTF.UNICODE });
      lote.push({ kind: 'key', wVk: 0, wScan: unidad, flags: KEYEVENTF.UNICODE | KEYEVENTF.KEYUP });
    }
    return lote;
  });
}
