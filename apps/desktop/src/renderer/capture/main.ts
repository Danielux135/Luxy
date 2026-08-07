// motor de captura y WebRTC. Corre en el renderer OCULTO.
//
// Este archivo hace lo que ningun otro proceso puede hacer: getDisplayMedia y
// RTCPeerConnection solo existen donde vive Chromium.
//
// LO QUE NO HACE, Y ES LO IMPORTANTE:
//
// No interpreta ni un solo mensaje de control. Lo que llega por el DataChannel
// se reenvia al main COMO TEXTO, sin mirarlo. Este es el unico componente de
// Luxy que recibe bytes de un dispositivo remoto, asi que se trata como si ya
// estuviera comprometido: lo unico que puede pedirle al main es "me ha llegado
// esta cadena", y el main la pasa por guardControlMessage.
//
// Tampoco elige que pantalla se captura: eso lo resuelve
// setDisplayMediaRequestHandler en el proceso principal.
import {
  CONTENT_HINT,
  DEGRADATION_PREFERENCE,
  encodingFor,
  orderCodecs,
} from '../../shared/codec-preferences.js';
import {
  DATA_CHANNEL_LABEL,
  type DataChannelKind,
  type FromCapture,
  type ToCapture,
} from '../../shared/capture-ipc.js';

/** lo que expone el preload de esta ventana */
interface CaptureBridge {
  onCommand(handler: (message: unknown) => void): () => void;
  send(message: unknown): void;
}

const puente = (window as unknown as { luxyCapture?: CaptureBridge }).luxyCapture;

let pc: RTCPeerConnection | null = null;
let stream: MediaStream | null = null;
let sender: RTCRtpSender | null = null;
let statsTimer: number | null = null;
let alturaFuente = 1080;
let calidad: Parameters<typeof encodingFor>[0] = { preset: 'balanced' };

function enviar(message: FromCapture): void {
  puente?.send(message);
}

function fallo(code: string, detail: unknown): void {
  enviar({ type: 'error', code, detail: String(detail).slice(0, 300) });
}

// -----------------------------------------------------------------------------
// captura
// -----------------------------------------------------------------------------

/**
 * pide la pantalla.
 *
 * NO se pasa deviceId ni nada parecido: getDisplayMedia no lo acepta. La
 * eleccion real la hace el main al resolver la peticion. Aqui solo se pide "una
 * pantalla" y se confia en que el otro lado ya decidio cual.
 *
 * El audio va con 'loopback', que es una extension de Electron y SOLO funciona
 * en Windows. En cualquier otro sistema la peticion fallaria entera y se
 * quedaria sin video tambien, por eso se pide aparte y se degrada.
 */
async function capturar(audio: boolean): Promise<MediaStream> {
  const restricciones: MediaStreamConstraints = {
    video: {
      // sin tope de fotogramas aqui: el limite real lo pone el encoder con
      // maxFramerate. Ponerlo en la captura hace que Chromium descarte
      // fotogramas ANTES de codificar y ya no puede subir si mejora la red.
      frameRate: { ideal: 60 },
    },
    ...(audio ? { audio: { mandatory: { chromeMediaSource: 'desktop' } } as never } : {}),
  };

  try {
    return await navigator.mediaDevices.getDisplayMedia(restricciones);
  } catch (error) {
    if (audio) {
      // el audio de sistema es un extra; sin el la sesion sigue siendo util
      enviar({ type: 'error', code: 'audio_no_disponible', detail: String(error).slice(0, 300) });
      return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60 } } });
    }
    throw error;
  }
}

// -----------------------------------------------------------------------------
// WebRTC
// -----------------------------------------------------------------------------

/**
 * abre un canal de datos.
 *
 * 'input' va sin orden y sin retransmision: una posicion de raton es absoluta,
 * asi que reintentar una vieja solo anade latencia. 'control' va fiable y
 * ordenado porque una tecla perdida se nota. Ver DATA_CHANNELS en capture-ipc.
 */
function abrirCanal(conexion: RTCPeerConnection, kind: DataChannelKind): RTCDataChannel {
  const canal = conexion.createDataChannel(
    DATA_CHANNEL_LABEL[kind],
    kind === 'input'
      ? // maxRetransmits:0 implica no fiable; ordered:false permite entregar en
        // cuanto llega en vez de esperar al hueco anterior
        { ordered: false, maxRetransmits: 0 }
      : { ordered: true },
  );

  canal.onmessage = (evento: MessageEvent<unknown>) => {
    // SIN INTERPRETAR. Solo se comprueba que sea texto: un ArrayBuffer aqui
    // significaria que el otro extremo esta mandando algo que el protocolo no
    // define, y reenviarlo obligaria al main a manejar binario sin necesidad.
    if (typeof evento.data !== 'string') return;
    enviar({ type: 'control', channel: kind, raw: evento.data });
  };

  return canal;
}

async function iniciar(orden: Extract<ToCapture, { type: 'start' }>): Promise<void> {
  enviar({ type: 'state', state: 'starting', detail: '' });

  alturaFuente = orden.sourceHeight;
  calidad = orden.quality;

  stream = await capturar(orden.audio);

  const conexion = new RTCPeerConnection({
    iceServers: orden.iceServers as RTCIceServer[],
    // 'all' y no 'relay': se intenta la ruta directa primero. Forzar relay
    // gastaria la cuota de TURN incluso dentro de la propia casa.
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
  });
  pc = conexion;

  const pista = stream.getVideoTracks()[0];
  if (pista === undefined) throw new Error('la captura no devolvio ninguna pista de video');

  // que se optimice NITIDEZ y no suavidad: un escritorio se usa para leer
  pista.contentHint = CONTENT_HINT;

  // si el usuario detiene la captura desde el aviso de Windows, hay que
  // enterarse: sin esto la sesion seguiria viva mandando negro
  pista.onended = () => {
    enviar({ type: 'state', state: 'closed', detail: 'la captura se detuvo desde el sistema' });
  };

  const transceptor = conexion.addTransceiver(pista, {
    direction: 'sendonly',
    streams: [stream],
  });
  sender = transceptor.sender;

  for (const audio of stream.getAudioTracks()) conexion.addTrack(audio, stream);

  aplicarCodecs(transceptor);
  await aplicarCalidad();

  abrirCanal(conexion, 'input');
  abrirCanal(conexion, 'control');

  conexion.onicecandidate = (evento) => {
    if (evento.candidate === null) return;
    enviar({
      type: 'ice',
      candidate: evento.candidate.candidate,
      sdpMid: evento.candidate.sdpMid,
      sdpMLineIndex: evento.candidate.sdpMLineIndex,
    });
  };

  conexion.onconnectionstatechange = () => {
    const estado = conexion.connectionState;
    if (estado === 'connected') {
      enviar({ type: 'state', state: 'connected', detail: '' });
      arrancarEstadisticas();
    } else if (estado === 'failed') {
      enviar({ type: 'state', state: 'failed', detail: 'la conexion WebRTC fallo' });
    } else if (estado === 'closed' || estado === 'disconnected') {
      enviar({ type: 'state', state: 'closed', detail: estado });
    }
  };

  const oferta = await conexion.createOffer();
  await conexion.setLocalDescription(oferta);

  // se manda la descripcion LOCAL y no la oferta: setLocalDescription puede
  // reescribirla, y el main la va a firmar. Firmar un SDP distinto del que se
  // usa dejaria la huella DTLS fuera de lo firmado, que es justo lo que la firma
  // tiene que proteger.
  const sdp = conexion.localDescription?.sdp ?? oferta.sdp;
  if (sdp === undefined) throw new Error('no se genero ninguna oferta SDP');

  enviar({ type: 'offer', sdp });
  enviar({ type: 'state', state: 'connecting', detail: '' });
}

/**
 * ordena los codecs del transceptor.
 *
 * Se hace sobre el TRANSCEPTOR y antes de createOffer: setCodecPreferences solo
 * afecta a la siguiente negociacion. Llamarlo despues no cambia nada y no da
 * ningun error.
 */
function aplicarCodecs(transceptor: RTCRtpTransceiver): void {
  const capacidades = RTCRtpSender.getCapabilities('video');
  if (capacidades === null) return;

  try {
    transceptor.setCodecPreferences(orderCodecs(capacidades.codecs));
  } catch (error) {
    // no es mortal: sin preferencias se negocia el orden por defecto
    fallo('codecs_no_aplicados', error);
  }
}

async function aplicarCalidad(): Promise<void> {
  if (sender === null) return;

  const parametros = sender.getParameters();
  const limites = encodingFor(calidad, alturaFuente);

  // sacrificar fotogramas antes que pixeles: si baja la resolucion, el texto
  // deja de leerse y el usuario se conecto justo para leer
  parametros.degradationPreference = DEGRADATION_PREFERENCE;

  // getParameters puede devolver encodings vacio antes de negociar; asignar uno
  // nuevo en ese caso hace que setParameters falle con InvalidModificationError,
  // asi que solo se modifica lo que ya existe
  if (parametros.encodings.length === 0) parametros.encodings = [{}];
  for (const encoding of parametros.encodings) {
    encoding.maxBitrate = limites.maxBitrate;
    encoding.maxFramerate = limites.maxFramerate;
    encoding.scaleResolutionDownBy = limites.scaleResolutionDownBy;
  }

  try {
    await sender.setParameters(parametros);
  } catch (error) {
    fallo('calidad_no_aplicada', error);
  }
}

/**
 * cambia de monitor SIN renegociar.
 *
 * replaceTrack sustituye la fuente dejando el transceptor y el codec como
 * estaban. Si en su lugar se quitara y se anadiera la pista, haria falta una
 * nueva oferta, otra firma del SDP y otra ronda por el gateway: un cambio de
 * monitor pasaria de instantaneo a tardar segundos.
 */
async function cambiarMonitor(orden: Extract<ToCapture, { type: 'switch-monitor' }>): Promise<void> {
  if (pc === null || sender === null) return;

  alturaFuente = orden.sourceHeight;
  const nuevo = await capturar(false);
  const pista = nuevo.getVideoTracks()[0];
  if (pista === undefined) {
    nuevo.getTracks().forEach((t) => t.stop());
    throw new Error('el monitor nuevo no devolvio ninguna pista');
  }

  pista.contentHint = CONTENT_HINT;
  await sender.replaceTrack(pista);

  // las pistas viejas se paran DESPUES de sustituir: pararlas antes deja un
  // hueco de negro visible, y en Windows suelta la captura y vuelve a pedirla
  stream?.getVideoTracks().forEach((t) => t.stop());
  stream = nuevo;

  // la altura cambio, asi que el divisor de resolucion tambien
  await aplicarCalidad();
}

// -----------------------------------------------------------------------------
// estadisticas
// -----------------------------------------------------------------------------

/**
 * publica estadisticas cada dos segundos.
 *
 * relayed importa mas de lo que parece: dice si la sesion va por TURN, que es lo
 * que consume la cuota gratuita. Sin este dato, el usuario no puede saber por
 * que se le agota.
 */
function arrancarEstadisticas(): void {
  if (statsTimer !== null) return;

  let bytesPrevios = 0;
  let momentoPrevio = 0;

  statsTimer = window.setInterval(() => {
    if (pc === null) return;

    void pc.getStats().then((informe) => {
      let rttMs = 0;
      let relayed = false;
      let codec = '';
      const acumulado = { bytes: 0, fps: 0, width: 0, height: 0, lost: 0, dropped: 0, jitter: 0 };
      const codecsPorId = new Map<string, string>();
      const candidatosPorId = new Map<string, string>();

      informe.forEach((entrada: Record<string, unknown>) => {
        if (entrada['type'] === 'codec') {
          codecsPorId.set(String(entrada['id']), String(entrada['mimeType'] ?? ''));
        } else if (entrada['type'] === 'local-candidate') {
          candidatosPorId.set(String(entrada['id']), String(entrada['candidateType'] ?? ''));
        }
      });

      informe.forEach((entrada: Record<string, unknown>) => {
        if (entrada['type'] === 'outbound-rtp' && entrada['kind'] === 'video') {
          acumulado.bytes = Number(entrada['bytesSent'] ?? 0);
          acumulado.fps = Number(entrada['framesPerSecond'] ?? 0);
          acumulado.width = Number(entrada['frameWidth'] ?? 0);
          acumulado.height = Number(entrada['frameHeight'] ?? 0);
          acumulado.dropped = Number(entrada['framesDropped'] ?? 0);
          const codecId = entrada['codecId'];
          if (typeof codecId === 'string') codec = codecsPorId.get(codecId) ?? '';
        } else if (entrada['type'] === 'remote-inbound-rtp') {
          rttMs = Number(entrada['roundTripTime'] ?? 0) * 1000;
          acumulado.lost = Number(entrada['packetsLost'] ?? 0);
          acumulado.jitter = Number(entrada['jitter'] ?? 0) * 1000;
        } else if (entrada['type'] === 'candidate-pair' && entrada['state'] === 'succeeded') {
          const local = entrada['localCandidateId'];
          if (typeof local === 'string') {
            relayed = candidatosPorId.get(local) === 'relay';
          }
        }
      });

      const ahora = Date.now();
      const bitrateKbps =
        momentoPrevio === 0
          ? 0
          : ((acumulado.bytes - bytesPrevios) * 8) / (ahora - momentoPrevio);
      bytesPrevios = acumulado.bytes;
      momentoPrevio = ahora;

      enviar({
        type: 'stats',
        stats: {
          type: 'stats',
          rttMs: Math.max(0, Math.min(rttMs, 60_000)),
          packetsLost: Math.max(0, Math.round(acumulado.lost)),
          bitrateKbps: Math.max(0, bitrateKbps),
          framesDropped: Math.max(0, Math.round(acumulado.dropped)),
          fps: Math.max(0, Math.min(acumulado.fps, 240)),
          jitterMs: Math.max(0, acumulado.jitter),
          codec: codec.slice(0, 32),
          width: Math.max(0, Math.round(acumulado.width)),
          height: Math.max(0, Math.round(acumulado.height)),
          relayed,
        },
      });
    });
  }, 2000);
}

// -----------------------------------------------------------------------------
// ciclo de vida
// -----------------------------------------------------------------------------

/**
 * cierra todo.
 *
 * Las pistas se paran SIEMPRE, aunque cerrar la conexion falle: una pista de
 * captura viva deja encendido el aviso de grabacion de Windows y el usuario
 * creeria que le siguen viendo la pantalla.
 */
function parar(): void {
  if (statsTimer !== null) {
    window.clearInterval(statsTimer);
    statsTimer = null;
  }

  try {
    stream?.getTracks().forEach((t) => t.stop());
  } finally {
    stream = null;
    sender = null;
    try {
      pc?.close();
    } finally {
      pc = null;
    }
  }
}

async function manejar(orden: ToCapture): Promise<void> {
  switch (orden.type) {
    case 'start':
      await iniciar(orden);
      return;

    case 'answer': {
      if (pc === null) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: orden.sdp });
      return;
    }

    case 'ice': {
      // los candidatos que llegan antes de la respuesta se descartan: sin
      // descripcion remota, addIceCandidate lanza. El otro extremo los reenvia.
      if (pc === null || pc.remoteDescription === null) return;
      await pc.addIceCandidate({
        candidate: orden.candidate,
        sdpMid: orden.sdpMid,
        sdpMLineIndex: orden.sdpMLineIndex,
      });
      return;
    }

    case 'switch-monitor':
      await cambiarMonitor(orden);
      return;

    case 'quality':
      calidad = orden.quality;
      await aplicarCalidad();
      return;

    case 'stop':
      parar();
      enviar({ type: 'state', state: 'closed', detail: orden.reason });
      return;
  }
}

puente?.onCommand((mensaje) => {
  // el main ya valido lo que manda; aqui se envuelve en un catch porque una
  // promesa rechazada sin manejar en un renderer oculto no se ve en ningun sitio
  void manejar(mensaje as ToCapture).catch((error: unknown) => {
    fallo('orden_fallida', error);
    enviar({ type: 'state', state: 'failed', detail: String(error).slice(0, 300) });
  });
});

// si la ventana muere por cualquier via, las pistas se sueltan
window.addEventListener('pagehide', parar);
