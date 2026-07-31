// mensajes de control: raton, teclado, gestos, monitor.
//
// DECISION QUE ATRAVIESA TODO EL ARCHIVO: las coordenadas viajan NORMALIZADAS
// entre 0 y 1, relativas al monitor elegido. Nunca en pixeles.
//
// El motivo es concreto. El movil tiene una pantalla de un tamano, el monitor
// otro, Windows aplica un factor de escala por monitor (125%, 150%...) y puede
// haber varios monitores con escalas distintas. Si viajaran pixeles, cada una de
// esas cuatro cosas seria una oportunidad de que el cursor acabe donde no toca, y
// el error dependeria del monitor. Normalizado, la unica conversion ocurre en el
// host, que es el unico que conoce la geometria real.
import { z } from 'zod';

/** coordenada normalizada dentro del monitor activo */
export const normalizedSchema = z.number().min(0).max(1);

export const MOUSE_BUTTONS = ['left', 'right', 'middle'] as const;
export type MouseButton = (typeof MOUSE_BUTTONS)[number];

export const mouseMoveSchema = z.object({
  type: z.literal('mouse.move'),
  x: normalizedSchema,
  y: normalizedSchema,
});

export const mouseButtonSchema = z.object({
  type: z.literal('mouse.button'),
  button: z.enum(MOUSE_BUTTONS),
  /** down y up separados a proposito: permite arrastrar, que es down + move + up */
  action: z.enum(['down', 'up']),
  x: normalizedSchema,
  y: normalizedSchema,
});

export const mouseScrollSchema = z.object({
  type: z.literal('mouse.scroll'),
  x: normalizedSchema,
  y: normalizedSchema,
  /** muescas de rueda; positivo hacia arriba. Se acota para que un gesto
   *  desbocado del movil no genere un desplazamiento absurdo */
  dx: z.number().min(-100).max(100),
  dy: z.number().min(-100).max(100),
});

/**
 * teclas especiales.
 *
 * Se usa una lista cerrada en vez de codigos crudos por dos razones: el cliente
 * no tiene por que conocer los virtual-key de Windows, y una lista cerrada
 * impide que un cliente comprometido invente combinaciones no previstas.
 */
export const SPECIAL_KEYS = [
  'escape', 'tab', 'backspace', 'enter', 'space', 'delete', 'insert',
  'home', 'end', 'pageup', 'pagedown',
  'up', 'down', 'left', 'right',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'printscreen',
] as const;
export type SpecialKey = (typeof SPECIAL_KEYS)[number];

export const MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'] as const;
export type Modifier = (typeof MODIFIERS)[number];

export const keyPressSchema = z.object({
  type: z.literal('key.press'),
  key: z.enum(SPECIAL_KEYS),
  modifiers: z.array(z.enum(MODIFIERS)).max(4).default([]),
});

/**
 * texto Unicode.
 *
 * va SEPARADO de las teclas a proposito. Escribir "ñ" o un emoji no es una
 * pulsacion: en Windows se inyecta con KEYEVENTF_UNICODE, que es otro camino.
 * Mezclarlos obligaria al cliente a saber la distribucion de teclado del host,
 * que no puede saber.
 */
export const textInputSchema = z.object({
  type: z.literal('key.text'),
  text: z.string().min(1).max(4096),
});

/**
 * suelta todas las teclas y botones.
 *
 * NO es opcional. SendInput no reinicia el estado del teclado, asi que si el
 * canal se cae con Ctrl pulsado, la tecla se queda PEGADA en el ordenador y el
 * usuario se encuentra el equipo haciendo cosas raras sin saber por que. El host
 * lo ejecuta tambien por su cuenta al cerrar la sesion, pero el cliente puede
 * pedirlo al perder el foco.
 */
export const releaseAllSchema = z.object({
  type: z.literal("input.release_all"),
});

export const monitorSelectSchema = z.object({
  type: z.literal('monitor.select'),
  monitorId: z.string().min(1).max(64),
});

export const QUALITY_PRESETS = ['auto', 'saver', 'balanced', 'high', 'custom'] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

export const qualitySetSchema = z.object({
  type: z.literal('quality.set'),
  preset: z.enum(QUALITY_PRESETS),
  /** solo se miran si preset es custom */
  maxFps: z.number().int().min(1).max(60).optional(),
  maxBitrateKbps: z.number().int().min(100).max(50_000).optional(),
  maxHeight: z.number().int().min(240).max(2160).optional(),
});

/** union de todo lo que un cliente puede mandar al host durante una sesion */
export const controlMessageSchema = z.discriminatedUnion('type', [
  mouseMoveSchema,
  mouseButtonSchema,
  mouseScrollSchema,
  keyPressSchema,
  textInputSchema,
  releaseAllSchema,
  monitorSelectSchema,
  qualitySetSchema,
]);

export type ControlMessage = z.infer<typeof controlMessageSchema>;

/**
 * que capacidad exige cada mensaje.
 *
 * Esta tabla es la que impide que una sesion de SOLO VISUALIZACION mueva el
 * raton. El host la consulta en cada mensaje, no al abrir la sesion: si los
 * permisos cambian a mitad, el siguiente mensaje ya se rechaza.
 */
export function requiredCapability(message: ControlMessage): 'control' | 'view' {
  switch (message.type) {
    case 'mouse.move':
    case 'mouse.button':
    case 'mouse.scroll':
    case 'key.press':
    case 'key.text':
      return 'control';
    // soltar teclas es siempre seguro: solo puede dejar el teclado en reposo
    case 'input.release_all':
      return 'control';
    // elegir monitor y bajar la calidad NO modifican el ordenador: los puede
    // hacer quien solo esta mirando
    case 'monitor.select':
    case 'quality.set':
      return 'view';
  }
}
