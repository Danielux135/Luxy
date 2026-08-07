// traduccion de las teclas del protocolo a scancodes de Windows.
//
// POR QUE SCANCODES Y NO VIRTUAL-KEYS:
//
// El virtual-key depende de la distribucion de teclado activa en el host. Si el
// movil pide "Ctrl+Z" y el host tiene teclado frances (AZERTY), mandar VK_Z
// acaba en otra tecla fisica. El scancode identifica la POSICION fisica, que es
// justo lo que hace un teclado real, y Windows le aplica la distribucion del
// usuario. Por eso todas las teclas y atajos van con KEYEVENTF_SCANCODE.
//
// El texto es el caso contrario y va por otro camino: ver textToUnitChunks.
import type { Modifier, SpecialKey } from '@luxy/remote-protocol';

/** una tecla fisica: scancode del set 1 y si necesita el prefijo E0 */
export interface ScanCode {
  code: number;
  /**
   * teclas del bloque de navegacion, las flechas y algunas mas comparten
   * scancode con el teclado numerico y se distinguen SOLO por el prefijo E0.
   * Sin el, "Inicio" es el 7 del numerico.
   */
  extended: boolean;
}

const TECLAS: Record<SpecialKey, ScanCode> = {
  escape: { code: 0x01, extended: false },
  tab: { code: 0x0f, extended: false },
  backspace: { code: 0x0e, extended: false },
  enter: { code: 0x1c, extended: false },
  space: { code: 0x39, extended: false },
  // el bloque de edicion y navegacion: todos duplican el numerico
  delete: { code: 0x53, extended: true },
  insert: { code: 0x52, extended: true },
  home: { code: 0x47, extended: true },
  end: { code: 0x4f, extended: true },
  pageup: { code: 0x49, extended: true },
  pagedown: { code: 0x51, extended: true },
  up: { code: 0x48, extended: true },
  down: { code: 0x50, extended: true },
  left: { code: 0x4b, extended: true },
  right: { code: 0x4d, extended: true },
  f1: { code: 0x3b, extended: false },
  f2: { code: 0x3c, extended: false },
  f3: { code: 0x3d, extended: false },
  f4: { code: 0x3e, extended: false },
  f5: { code: 0x3f, extended: false },
  f6: { code: 0x40, extended: false },
  f7: { code: 0x41, extended: false },
  f8: { code: 0x42, extended: false },
  f9: { code: 0x43, extended: false },
  f10: { code: 0x44, extended: false },
  // f11 y f12 NO continuan la serie: se anadieron despues y cayeron en 0x57/0x58
  f11: { code: 0x57, extended: false },
  f12: { code: 0x58, extended: false },
  printscreen: { code: 0x37, extended: true },
};

const MODIFICADORES: Record<Modifier, ScanCode> = {
  ctrl: { code: 0x1d, extended: false },
  alt: { code: 0x38, extended: false },
  shift: { code: 0x2a, extended: false },
  // la tecla Windows solo existe en su variante extendida
  meta: { code: 0x5b, extended: true },
};

/**
 * scancode de una tecla del protocolo.
 *
 * El protocolo usa listas cerradas (SPECIAL_KEYS, MODIFIERS) validadas por Zod,
 * asi que aqui no puede llegar nada fuera de la tabla. Aun asi se devuelve null
 * en vez de lanzar: la capa de entrada nunca debe tumbar la sesion por un
 * mensaje raro.
 */
export function scanCodeFor(key: SpecialKey | Modifier): ScanCode | null {
  return TECLAS[key as SpecialKey] ?? MODIFICADORES[key as Modifier] ?? null;
}

// -----------------------------------------------------------------------------
// texto Unicode
// -----------------------------------------------------------------------------

/**
 * limite de unidades por llamada a SendInput.
 *
 * SendInput es atomica: los eventos de una llamada no se intercalan con los de
 * otro hilo. Mandar 4096 caracteres de golpe funciona, pero reserva un bloque
 * enorme y bloquea la cola de entrada del sistema mientras dura. Se trocea.
 */
export const MAX_UNITS_PER_BATCH = 128;

/**
 * trocea texto en lotes de unidades de codigo UTF-16.
 *
 * LO QUE ESTO PROTEGE: KEYEVENTF_UNICODE inyecta UNA unidad UTF-16 por evento.
 * Un emoji fuera del BMP son DOS unidades (par de surrogates) y Windows solo lo
 * compone si llegan juntas. Si el troceo partiera un par entre dos llamadas a
 * SendInput, el usuario recibiria dos caracteres basura en vez del emoji, y
 * dependeria de la longitud del texto: el fallo aparece solo a veces.
 *
 * Por eso el corte nunca cae entre un high surrogate y su low surrogate.
 */
export function textToUnitChunks(text: string, maxUnits = MAX_UNITS_PER_BATCH): number[][] {
  const lotes: number[][] = [];
  let actual: number[] = [];

  for (const caracter of text) {
    // iterar el string da PUNTOS DE CODIGO, no unidades: un emoji sale entero
    const unidades: number[] = [];
    for (let i = 0; i < caracter.length; i += 1) {
      unidades.push(caracter.charCodeAt(i));
    }

    // si el caracter no cabe entero, se cierra el lote antes de partirlo
    if (actual.length > 0 && actual.length + unidades.length > maxUnits) {
      lotes.push(actual);
      actual = [];
    }
    actual.push(...unidades);
  }

  if (actual.length > 0) lotes.push(actual);
  return lotes;
}
