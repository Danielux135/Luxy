// contrato entre el proceso principal y el renderer oculto de captura.
//
// POR QUE ESTE CONTRATO ES TAN ESTRECHO:
//
// El renderer oculto es el unico componente de Luxy que habla directamente con
// el exterior: recibe el DataChannel de un dispositivo remoto. Si un fallo de
// Chromium lo comprometiera, lo unico que ese atacante gana es lo que este
// archivo le permita pedir al main.
//
// De ahi la decision que atraviesa todo: LOS MENSAJES DE CONTROL CRUZAN COMO
// TEXTO OPACO. El renderer no los parsea, no los interpreta y no puede pedir
// "mueve el raton aqui". Solo puede decir "me ha llegado esta cadena", y es el
// main quien la pasa por guardControlMessage, que sigue siendo la puerta unica.
// Un renderer comprometido no tiene mas poder que el dispositivo emparejado.
import { z } from 'zod';
import { QUALITY_PRESETS, statsSchema } from '@luxy/remote-protocol';

// los nombres de canal viven en shared/channels.ts porque los necesita el
// preload de la ventana oculta, que corre en sandbox y no puede importar zod
export { CAPTURE_CHANNEL } from './channels.js';

/**
 * limite del mensaje de control que cruza el IPC.
 *
 * Se comprueba ANTES de cruzar. guardControlMessage vuelve a comprobarlo -es su
 * primer paso, y con razon- pero para entonces el proceso principal ya habria
 * copiado el bloque a su memoria. Un cliente que mande 10 MB sesenta veces por
 * segundo llenaria la memoria del main aunque el guard los rechace todos.
 */
export const MAX_CONTROL_BYTES = 16 * 1024;

/**
 * LOS DOS CANALES DE DATOS, Y POR QUE SON DOS.
 *
 * El plan pedia un DataChannel no fiable y no ordenado para el control, y para
 * el raton es lo correcto: una posicion es absoluta, asi que un movimiento
 * perdido no importa y uno que llega tarde es peor que ninguno. Retransmitirlo
 * solo anade latencia.
 *
 * Pero un canal no ordenado ENTREGA FUERA DE ORDEN, y acceptEnvelope exige
 * secuencia estrictamente creciente para matar la reinyeccion. Las dos cosas
 * juntas significan que si llegan 5, 7 y 6, el 6 se rechaza como "replayed".
 * Para un movimiento de raton da igual. Para una tecla NO: el usuario escribiria
 * y le faltarian letras, de forma intermitente y solo con mala red.
 *
 * Bajar la exigencia del anti-replay para arreglarlo seria debilitar justo la
 * proteccion que evita que se reinyecte un "clic en Aceptar" capturado. Asi que
 * se separan los canales:
 *
 *   input    no ordenado y sin retransmision. Solo raton y rueda.
 *   control  fiable y ordenado. Teclas, botones, release_all, monitor, calidad.
 *
 * Cada uno lleva su propia numeracion y su propia ventana anti-replay, lo que ya
 * soporta guardControlMessage sin cambiar nada: recibe la ventana como
 * parametro.
 */
export const DATA_CHANNEL_KINDS = ['input', 'control'] as const;
export type DataChannelKind = (typeof DATA_CHANNEL_KINDS)[number];

/** etiquetas tal y como viajan en el SDP; el movil abre las mismas */
export const DATA_CHANNEL_LABEL: Record<DataChannelKind, string> = {
  input: 'luxy-input',
  control: 'luxy-control',
};

const iceServerSchema = z.object({
  urls: z.array(z.string().max(300)).min(1).max(8),
  username: z.string().max(300).optional(),
  credential: z.string().max(300).optional(),
});

const qualitySchema = z.object({
  preset: z.enum(QUALITY_PRESETS),
  maxFps: z.number().int().min(1).max(60).optional(),
  maxBitrateKbps: z.number().int().min(100).max(50_000).optional(),
  maxHeight: z.number().int().min(240).max(2160).optional(),
});

// -----------------------------------------------------------------------------
// main -> renderer oculto
// -----------------------------------------------------------------------------

export const toCaptureSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    sessionId: z.string().min(1).max(128),
    /** id de desktopCapturer; lo resuelve el main, NUNCA lo elige el renderer */
    sourceId: z.string().min(1).max(128),
    monitorId: z.string().min(1).max(64),
    sourceHeight: z.number().int().min(1).max(8192),
    quality: qualitySchema,
    iceServers: z.array(iceServerSchema).max(8).default([]),
    /**
     * audio del sistema. Va explicito y por defecto FALSE: capturar el sonido
     * del equipo sin que el usuario lo haya pedido es una sorpresa desagradable.
     */
    audio: z.boolean().default(false),
  }),
  z.object({ type: z.literal('stop'), reason: z.string().max(120).default('') }),
  z.object({
    type: z.literal('switch-monitor'),
    sourceId: z.string().min(1).max(128),
    monitorId: z.string().min(1).max(64),
    sourceHeight: z.number().int().min(1).max(8192),
  }),
  z.object({ type: z.literal('quality'), quality: qualitySchema }),
  /** la respuesta del movil, ya verificada su firma por el main */
  z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(64 * 1024) }),
  z.object({
    type: z.literal('ice'),
    candidate: z.string().max(1024),
    sdpMid: z.string().max(64).nullable(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullable(),
  }),
]);

export type ToCapture = z.infer<typeof toCaptureSchema>;

// -----------------------------------------------------------------------------
// renderer oculto -> main
// -----------------------------------------------------------------------------

export const CAPTURE_STATES = ['starting', 'connecting', 'connected', 'failed', 'closed'] as const;

export const fromCaptureSchema = z.discriminatedUnion('type', [
  /** la oferta SDP; el main la firmara antes de mandarla, ver sdp-auth */
  z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(64 * 1024) }),
  z.object({
    type: z.literal('ice'),
    candidate: z.string().max(1024),
    sdpMid: z.string().max(64).nullable(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullable(),
  }),
  z.object({
    type: z.literal('state'),
    state: z.enum(CAPTURE_STATES),
    detail: z.string().max(300).default(''),
  }),
  /**
   * un mensaje de control tal y como llego por el DataChannel.
   *
   * TEXTO SIN INTERPRETAR, a proposito: aqui no hay ningun campo "boton" ni
   * "coordenada" que el renderer pueda rellenar. Lo unico que puede hacer es
   * entregar bytes, y el main los pasa por la puerta unica.
   *
   * channel dice POR CUAL de los dos canales llego, y no es informativo: cada
   * canal lleva su propia numeracion de secuencia y por tanto su propia ventana
   * anti-replay. Ver DATA_CHANNELS.
   */
  z.object({
    type: z.literal('control'),
    channel: z.enum(DATA_CHANNEL_KINDS),
    raw: z.string().max(MAX_CONTROL_BYTES),
  }),
  z.object({ type: z.literal('stats'), stats: statsSchema }),
  z.object({
    type: z.literal('error'),
    code: z.string().max(64),
    detail: z.string().max(300).default(''),
  }),
]);

export type FromCapture = z.infer<typeof fromCaptureSchema>;

/**
 * valida lo que llega del renderer oculto.
 *
 * Devuelve un resultado en vez de lanzar: un mensaje malformado del renderer no
 * puede tumbar el proceso principal, que es lo que sostiene la aplicacion
 * entera.
 */
export function parseFromCapture(
  raw: unknown,
): { ok: true; message: FromCapture } | { ok: false; reason: string } {
  const resultado = fromCaptureSchema.safeParse(raw);
  if (resultado.success) return { ok: true, message: resultado.data };

  const primero = resultado.error.issues[0];
  const ruta = primero === undefined ? '' : primero.path.join('.');
  // NO se incluye el valor recibido: puede ser texto del portapapeles del
  // usuario o parte de un archivo, y esto acaba en un log
  return { ok: false, reason: ruta.length > 0 ? `campo "${ruta}" invalido` : 'mensaje invalido' };
}

/**
 * tamano en BYTES UTF-8, que es lo que ocupa de verdad.
 *
 * string.length cuenta unidades UTF-16: un texto de emoji o de CJK ocupa hasta
 * tres veces mas de lo que dice length, asi que el limite se podria superar en
 * mas del triple sin que saltara.
 */
export function controlBytes(raw: string): number {
  return Buffer.byteLength(raw, 'utf8');
}

export function withinControlLimit(raw: string): boolean {
  return controlBytes(raw) <= MAX_CONTROL_BYTES;
}

/**
 * por que canal debe viajar cada tipo de mensaje.
 *
 * Solo el raton y la rueda pueden ir por el canal no fiable, porque son los
 * unicos cuya perdida no cambia el resultado: la siguiente posicion absoluta
 * corrige cualquier hueco. Todo lo demas cambia estado -una tecla, un boton,
 * soltar todo- y perderlo o reordenarlo se nota.
 */
export function channelForMessage(type: string): DataChannelKind {
  return type === 'mouse.move' || type === 'mouse.scroll' ? 'input' : 'control';
}

/**
 * comprueba que un mensaje llego por el canal que le toca.
 *
 * NO es una formalidad. Si una tecla llegara por el canal no ordenado, se
 * perderia o se reordenaria justo cuando la red va mal, y el usuario veria
 * letras que faltan sin ninguna explicacion. Rechazarlo hace que el fallo sea
 * visible en el desarrollo del cliente movil en vez de intermitente en
 * produccion.
 */
export function channelMatches(type: string, channel: DataChannelKind): boolean {
  return channelForMessage(type) === channel;
}
