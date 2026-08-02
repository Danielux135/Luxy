// eleccion de codec y parametros de codificacion.
//
// Codigo puro: no toca RTCPeerConnection, solo decide QUE orden y QUE numeros. El
// renderer oculto se limita a aplicarlo. Asi lo unico que queda sin prueba
// automatica es la negociacion real, no la logica.
//
// LO QUE SE OPTIMIZA AQUI ES TEXTO NITIDO, NO VIDEO FLUIDO. Un escritorio remoto
// se usa para leer codigo y menus: un fotograma borroso a 60 fps es inutil y uno
// nitido a 15 fps sirve. De ahi salen las dos decisiones que atraviesan el
// archivo: contentHint 'text' y degradationPreference 'maintain-resolution'.
import type { QualityPreset } from '@luxy/remote-protocol';

/** lo minimo de RTCRtpCodecCapability que hace falta para ordenar */
export interface CodecLike {
  mimeType: string;
  clockRate?: number;
  sdpFmtpLine?: string;
}

/**
 * pista para el codificador. 'text' hace que Chromium priorice nitidez sobre
 * suavidad: menos fotogramas antes que letras emborronadas.
 */
export const CONTENT_HINT = 'text' as const;

/**
 * que sacrifica el codificador cuando falta ancho de banda.
 *
 * 'maintain-resolution' baja los fps y conserva los pixeles. El de por defecto
 * ('balanced') reduce la RESOLUCION, y en un escritorio eso significa que el
 * texto deja de leerse, que es exactamente para lo que se conecta el usuario.
 */
export const DEGRADATION_PREFERENCE = 'maintain-resolution' as const;

/**
 * orden de preferencia. AV1 -> VP9 -> H.264 -> VP8.
 *
 * AV1 primero porque en contenido de escritorio -grandes zonas planas, texto
 * repetido- gana mucho mas que en video real: es donde su modo de pantalla
 * brilla. VP9 despues por lo mismo en menor medida. H.264 va tercero pese a
 * tener aceleracion por hardware casi siempre, porque su modo de alta calidad
 * para texto es peor; pero es el unico que TODOS los Android decodifican por
 * hardware, asi que nunca se elimina de la lista.
 */
const PRIORIDAD = ['video/av1', 'video/vp9', 'video/h264', 'video/vp8'];

/**
 * codecs auxiliares que NO son video y que hay que conservar.
 *
 * ESTO NO ES OPCIONAL. setCodecPreferences REEMPLAZA la lista entera: lo que no
 * este, no se negocia. Si se filtrara dejando solo los codecs de video, se
 * perderia rtx -la retransmision- y cada paquete perdido se convertiria en un
 * bloque congelado hasta el siguiente fotograma clave. Justo en la ruta por TURN
 * desde 4G, que es la habitual.
 */
const AUXILIARES = ['video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec-03'];

function rango(codec: CodecLike): number {
  const tipo = codec.mimeType.toLowerCase();
  const indice = PRIORIDAD.indexOf(tipo);
  if (indice >= 0) return indice;
  if (AUXILIARES.includes(tipo)) return PRIORIDAD.length + 1;
  // un codec desconocido va detras de los conocidos pero delante de los
  // auxiliares: si apareciera algo nuevo, mejor probarlo que descartarlo
  return PRIORIDAD.length;
}

/**
 * H.264 tiene varias variantes y no todas sirven.
 *
 * packetization-mode=1 permite trocear un fotograma en varios paquetes. Con
 * mode=0 cada NAL tiene que caber en un paquete, asi que un fotograma clave de
 * pantalla completa no cabe y el codificador acaba bajando la calidad hasta que
 * quepa. Se prefiere mode=1 dentro de H.264, sin eliminar el resto.
 */
function penalizacionH264(codec: CodecLike): number {
  if (!codec.mimeType.toLowerCase().includes('h264')) return 0;
  const fmtp = codec.sdpFmtpLine ?? '';
  return fmtp.includes('packetization-mode=1') ? 0 : 1;
}

/**
 * ordena la lista de codecs para setCodecPreferences.
 *
 * NO ELIMINA NADA. Ordenar dice la preferencia; eliminar impide la conexion si
 * el otro extremo solo tiene el que se quito. Con un Android antiguo que solo
 * decodifique H.264, quitar H.264 significa pantalla negra para siempre.
 */
export function orderCodecs<T extends CodecLike>(codecs: readonly T[]): T[] {
  return [...codecs]
    .map((codec, indice) => ({ codec, indice }))
    .sort((a, b) => {
      const porTipo = rango(a.codec) - rango(b.codec);
      if (porTipo !== 0) return porTipo;

      const porPerfil = penalizacionH264(a.codec) - penalizacionH264(b.codec);
      if (porPerfil !== 0) return porPerfil;

      // estable: a igualdad, se conserva el orden del navegador, que ya viene
      // ordenado por lo que su hardware acelera
      return a.indice - b.indice;
    })
    .map((entrada) => entrada.codec);
}

// -----------------------------------------------------------------------------
// parametros de codificacion
// -----------------------------------------------------------------------------

export interface EncodingLimits {
  /** bits por segundo, que es lo que espera RTCRtpEncodingParameters */
  maxBitrate: number;
  maxFramerate: number;
  /** divisor de resolucion; 1 = sin reducir */
  scaleResolutionDownBy: number;
}

/**
 * perfiles de calidad.
 *
 * 'saver' existe por el limite de TURN: la Fase 7 tiene una cuota gratuita de
 * 1.000 GB y el requisito es cero posibilidad de cargo. A 1,5 Mbps son unas 1.400
 * horas; a 8 Mbps serian 270 y el limite se tocaria de verdad.
 */
const PERFILES: Record<Exclude<QualityPreset, 'custom'>, EncodingLimits> = {
  // auto deja que el estimador de ancho de banda decida, con un techo alto por
  // si acaso: sin techo, una LAN de gigabit gasta 40 Mbps para nada
  auto: { maxBitrate: 8_000_000, maxFramerate: 30, scaleResolutionDownBy: 1 },
  saver: { maxBitrate: 1_500_000, maxFramerate: 12, scaleResolutionDownBy: 1 },
  balanced: { maxBitrate: 4_000_000, maxFramerate: 24, scaleResolutionDownBy: 1 },
  high: { maxBitrate: 12_000_000, maxFramerate: 30, scaleResolutionDownBy: 1 },
};

export interface QualityRequest {
  preset: QualityPreset;
  maxFps?: number | undefined;
  maxBitrateKbps?: number | undefined;
  maxHeight?: number | undefined;
}

/**
 * traduce un mensaje quality.set a parametros de codificacion.
 *
 * sourceHeight es la altura REAL de la captura y hace falta para el divisor:
 * scaleResolutionDownBy es un divisor, no una altura objetivo. Confundirlos
 * daria una imagen de 4 pixeles de alto.
 */
export function encodingFor(request: QualityRequest, sourceHeight: number): EncodingLimits {
  const base =
    request.preset === 'custom'
      ? PERFILES.balanced
      : (PERFILES[request.preset] ?? PERFILES.balanced);

  const limites: EncodingLimits = { ...base };

  if (request.preset === 'custom') {
    if (request.maxBitrateKbps !== undefined) limites.maxBitrate = request.maxBitrateKbps * 1000;
    if (request.maxFps !== undefined) limites.maxFramerate = request.maxFps;
    if (request.maxHeight !== undefined) {
      limites.scaleResolutionDownBy = scaleFor(sourceHeight, request.maxHeight);
    }
  }

  return limites;
}

/**
 * divisor para no superar una altura.
 *
 * Nunca baja de 1: un divisor menor que uno AMPLIA la imagen, gasta ancho de
 * banda y no anade ni un pixel de informacion. Chromium ademas rechaza el
 * parametro y la codificacion falla entera.
 */
export function scaleFor(sourceHeight: number, maxHeight: number): number {
  if (sourceHeight <= 0 || maxHeight <= 0) return 1;
  return Math.max(1, sourceHeight / maxHeight);
}
