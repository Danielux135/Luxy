// pruebas de la eleccion de codec y de los limites de codificacion.
import { describe, it, expect } from 'vitest';
import {
  CONTENT_HINT,
  DEGRADATION_PREFERENCE,
  encodingFor,
  orderCodecs,
  scaleFor,
  type CodecLike,
} from './codec-preferences.js';

/** lista parecida a la que devuelve Chromium, a proposito desordenada */
const DEL_NAVEGADOR: CodecLike[] = [
  { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=0;profile-level-id=42e01f' },
  { mimeType: 'video/VP8' },
  { mimeType: 'video/rtx' },
  { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' },
  { mimeType: 'video/AV1' },
  { mimeType: 'video/red' },
  { mimeType: 'video/VP9' },
  { mimeType: 'video/ulpfec' },
];

function tipos(codecs: CodecLike[]): string[] {
  return codecs.map((c) => c.mimeType.toLowerCase());
}

describe('orden de codecs', () => {
  it('AV1 primero, luego VP9, luego H.264, luego VP8', () => {
    const orden = tipos(orderCodecs(DEL_NAVEGADOR));
    expect(orden.slice(0, 2)).toEqual(['video/av1', 'video/vp9']);
    expect(orden.indexOf('video/h264')).toBeLessThan(orden.indexOf('video/vp8'));
  });

  it('NO ELIMINA NINGUN CODEC', () => {
    // setCodecPreferences reemplaza la lista entera. Si se quitara H.264, un
    // Android que solo lo decodifique por hardware se quedaria con pantalla
    // negra para siempre, y sin ningun error que lo explicara.
    expect(orderCodecs(DEL_NAVEGADOR)).toHaveLength(DEL_NAVEGADOR.length);
    expect(tipos(orderCodecs(DEL_NAVEGADOR))).toContain('video/h264');
    expect(tipos(orderCodecs(DEL_NAVEGADOR))).toContain('video/vp8');
  });

  it('rtx, red y ulpfec SIGUEN AHI, al final', () => {
    // sin rtx no hay retransmision: cada paquete perdido se convierte en un
    // bloque congelado hasta el siguiente fotograma clave. Y la ruta habitual es
    // TURN desde 4G, que pierde paquetes.
    const orden = tipos(orderCodecs(DEL_NAVEGADOR));

    expect(orden).toContain('video/rtx');
    expect(orden).toContain('video/red');
    expect(orden).toContain('video/ulpfec');
    // detras de todos los de video
    expect(orden.indexOf('video/rtx')).toBeGreaterThan(orden.indexOf('video/vp8'));
  });

  it('dentro de H.264 gana packetization-mode=1', () => {
    // con mode=0 cada NAL tiene que caber en un paquete, asi que un fotograma
    // clave de pantalla completa no cabe y el codificador baja la calidad hasta
    // que quepa
    const h264 = orderCodecs(DEL_NAVEGADOR).filter((c) => c.mimeType.toLowerCase().includes('h264'));

    expect(h264[0]!.sdpFmtpLine).toContain('packetization-mode=1');
    expect(h264).toHaveLength(2);
  });

  it('un codec desconocido no se pierde ni se cuela delante', () => {
    const orden = tipos(orderCodecs([...DEL_NAVEGADOR, { mimeType: 'video/H266' }]));

    expect(orden).toContain('video/h266');
    expect(orden.indexOf('video/h266')).toBeGreaterThan(orden.indexOf('video/vp8'));
    expect(orden.indexOf('video/h266')).toBeLessThan(orden.indexOf('video/rtx'));
  });

  it('el orden es estable entre iguales', () => {
    // a igualdad se conserva el del navegador, que ya viene ordenado por lo que
    // su hardware acelera
    const dos: CodecLike[] = [
      { mimeType: 'video/VP9', sdpFmtpLine: 'profile-id=0' },
      { mimeType: 'video/VP9', sdpFmtpLine: 'profile-id=2' },
    ];
    expect(orderCodecs(dos).map((c) => c.sdpFmtpLine)).toEqual(['profile-id=0', 'profile-id=2']);
  });

  it('no muta la lista que recibe', () => {
    const copia = [...DEL_NAVEGADOR];
    orderCodecs(DEL_NAVEGADOR);
    expect(DEL_NAVEGADOR).toEqual(copia);
  });

  it('una lista vacia no revienta', () => {
    expect(orderCodecs([])).toEqual([]);
  });
});

describe('lo que se optimiza es texto nitido', () => {
  it('la pista del codificador es texto, no video', () => {
    expect(CONTENT_HINT).toBe('text');
  });

  it('al faltar ancho de banda se sacrifican fotogramas, NO resolucion', () => {
    // el valor por defecto ('balanced') reduce la resolucion, y en un escritorio
    // eso significa que el texto deja de leerse: justo lo que el usuario venia a
    // hacer
    expect(DEGRADATION_PREFERENCE).toBe('maintain-resolution');
  });
});

describe('limites de codificacion', () => {
  it('cada perfil da un techo distinto y el ahorro es el mas bajo', () => {
    const ahorro = encodingFor({ preset: 'saver' }, 1080);
    const alta = encodingFor({ preset: 'high' }, 1080);
    const equilibrada = encodingFor({ preset: 'balanced' }, 1080);

    expect(ahorro.maxBitrate).toBeLessThan(equilibrada.maxBitrate);
    expect(equilibrada.maxBitrate).toBeLessThan(alta.maxBitrate);
  });

  it('auto tiene techo: sin el, una LAN de gigabit gasta 40 Mbps para nada', () => {
    expect(encodingFor({ preset: 'auto' }, 1080).maxBitrate).toBeLessThanOrEqual(8_000_000);
  });

  it('el modo ahorro sirve para no tocar la cuota de TURN', () => {
    // 1.000 GB gratis: a 1,5 Mbps son ~1.400 horas; a 8 Mbps serian 270
    expect(encodingFor({ preset: 'saver' }, 1080).maxBitrate).toBeLessThanOrEqual(1_500_000);
  });

  it('custom aplica los tres campos, y el bitrate viaja en kbps', () => {
    const limites = encodingFor(
      { preset: 'custom', maxBitrateKbps: 2500, maxFps: 15, maxHeight: 720 },
      1440,
    );

    // si no se multiplicara por 1000, se pediria 2,5 kbps y no se veria nada
    expect(limites.maxBitrate).toBe(2_500_000);
    expect(limites.maxFramerate).toBe(15);
    expect(limites.scaleResolutionDownBy).toBeCloseTo(2);
  });

  it('los campos de custom que no vienen no se inventan', () => {
    const limites = encodingFor({ preset: 'custom', maxFps: 10 }, 1080);
    expect(limites.maxFramerate).toBe(10);
    expect(limites.scaleResolutionDownBy).toBe(1);
  });

  it('los campos de custom se IGNORAN en los demas perfiles', () => {
    // el preset es la fuente de verdad; si se mezclaran, elegir "ahorro" con
    // restos de una configuracion anterior daria un resultado impredecible
    const limites = encodingFor({ preset: 'saver', maxBitrateKbps: 50_000 }, 1080);
    expect(limites.maxBitrate).toBe(1_500_000);
  });
});

describe('divisor de resolucion', () => {
  it('es un DIVISOR, no una altura', () => {
    // confundirlos daria una imagen de 720 pixeles... de division, es decir dos
    // pixeles de alto
    expect(scaleFor(1440, 720)).toBe(2);
    expect(scaleFor(2160, 1080)).toBe(2);
  });

  it('NUNCA baja de 1', () => {
    // un divisor menor que uno amplia la imagen: gasta ancho de banda sin anadir
    // un solo pixel de informacion, y Chromium rechaza el parametro entero
    expect(scaleFor(720, 1080)).toBe(1);
    expect(scaleFor(1080, 4000)).toBe(1);
  });

  it('valores absurdos no producen divisiones por cero', () => {
    expect(scaleFor(0, 720)).toBe(1);
    expect(scaleFor(1080, 0)).toBe(1);
  });
});
