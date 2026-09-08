// pruebas de los formatos de archivo admitidos.
//
// La que de verdad importa es la ultima: que ninguna extension ofrecida en un
// dialogo sea desconocida para el mapa de tipos. Esa invariante es exactamente
// la que estaba rota —dos listas y un mapa, mantenidos a mano por separado— y
// su fallo no se veia como un error sino como una ventana colgada media hora.
import { describe, it, expect } from 'vitest';
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  isKnownImage,
  mimeTypeFor,
  sniffImageType,
} from './media-types.js';

describe('el tipo que se deduce de la extension', () => {
  it('conoce avif, que es el formato con el que empezo todo esto', () => {
    expect(mimeTypeFor('C:/Users/x/Desktop/foto.avif')).toBe('image/avif');
  });

  it('no le importan las mayusculas: Windows las mezcla', () => {
    expect(mimeTypeFor('C:/x/FOTO.AVIF')).toBe('image/avif');
    expect(mimeTypeFor('C:/x/Foto.JPG')).toBe('image/jpeg');
  });

  it('jpg y jpeg son el mismo tipo', () => {
    expect(mimeTypeFor('a.jpg')).toBe(mimeTypeFor('a.jpeg'));
  });

  it('lo desconocido cae en octet-stream, que es lo que hay que parar antes', () => {
    // no es un tipo de imagen y no debe cruzar el IPC: el esquema del host lo
    // rechaza por no casar con `^image/` y al otro lado se descarta sin avisar
    expect(mimeTypeFor('C:/x/foto.heic')).toBe('application/octet-stream');
    expect(mimeTypeFor('C:/x/documento.pdf')).toBe('application/octet-stream');
    expect(isKnownImage('C:/x/foto.heic')).toBe(false);
  });

  it('un archivo sin extension no revienta', () => {
    expect(mimeTypeFor('C:/x/README')).toBe('application/octet-stream');
    expect(mimeTypeFor('')).toBe('application/octet-stream');
  });

  it('un video no es una imagen, por muy conocido que sea', () => {
    expect(mimeTypeFor('a.mp4')).toBe('video/mp4');
    expect(isKnownImage('a.mp4')).toBe(false);
  });
});

describe('las listas de los dialogos y el mapa no pueden separarse', () => {
  // ESTA es la prueba de regresion. Cada extension que se ofrece al usuario
  // tiene que tener un tipo de verdad detras: ofrecer una que el mapa no
  // conozca produce el peor fallo de los dos, porque no parece un fallo.
  it('toda extension de imagen ofrecida se traduce a un image/*', () => {
    for (const extension of IMAGE_EXTENSIONS) {
      expect(mimeTypeFor(`archivo.${extension}`)).toMatch(/^image\//);
    }
  });

  it('toda extension de video ofrecida se traduce a un video/*', () => {
    for (const extension of VIDEO_EXTENSIONS) {
      expect(mimeTypeFor(`archivo.${extension}`)).toMatch(/^video\//);
    }
  });

  it('las dos listas no se solapan: el banco no puede aceptar un video', () => {
    const imagenes = new Set<string>(IMAGE_EXTENSIONS);
    for (const extension of VIDEO_EXTENSIONS) expect(imagenes.has(extension)).toBe(false);
  });

  it('todo lo que el mapa llama image/* se le ofrece al usuario', () => {
    // el sentido contrario del mismo trato: un formato que sabemos nombrar y no
    // ofrecemos es una foto que el usuario no ve en su carpeta sin saber por que
    for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']) {
      if (!mimeTypeFor(`a.${extension}`).startsWith('image/')) continue;
      expect(IMAGE_EXTENSIONS as readonly string[]).toContain(extension);
    }
  });
});

// POR QUE: la copia del avatar de un personaje se guardaba con
// `mimeType: 'image/webp'` escrito a pelo, fuera lo que fuera de verdad. Eso
// derrota la unica guarda que impide mandarle a AI Horde un formato que no
// admite —su comprobacion mira el tipo DECLARADO— y convierte un rechazo claro
// en un fallo dentro del worker.
describe('el tipo real, leido de los bytes', () => {
  const con = (...bytes: number[]): Uint8Array => new Uint8Array([...bytes, 0, 0, 0, 0, 0, 0]);
  const conTexto = (relleno: number, ...trozos: string[]): Uint8Array =>
    new Uint8Array([
      ...Array.from({ length: relleno }, () => 0),
      ...trozos.flatMap((t) => [...t].map((c) => c.charCodeAt(0))),
    ]);

  it('reconoce png por su firma', () => {
    expect(sniffImageType(con(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
  });

  it('reconoce jpeg', () => {
    expect(sniffImageType(con(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  it('reconoce gif', () => {
    expect(sniffImageType(con(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
  });

  it('reconoce webp saltandose los cuatro bytes del tamaño', () => {
    // esos cuatro cambian con cada imagen: mirarlos seria no reconocer ninguna
    const bytes = new Uint8Array([
      ...[...'RIFF'].map((c) => c.charCodeAt(0)),
      0x2a, 0x00, 0x01, 0x00,
      ...[...'WEBP'].map((c) => c.charCodeAt(0)),
    ]);
    expect(sniffImageType(bytes)).toBe('image/webp');
  });

  it('reconoce avif, que es una caja ISO-BMFF', () => {
    expect(sniffImageType(conTexto(4, 'ftyp', 'avif'))).toBe('image/avif');
  });

  it('lo que no reconoce devuelve null, no un tipo inventado', () => {
    // inventarlo era el fallo: un PNG etiquetado como webp pasa la guarda del
    // horde y falla mucho despues, donde nadie puede explicarlo
    expect(sniffImageType(con(0x00, 0x01, 0x02, 0x03))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });

  it('un archivo mas corto que la firma no revienta', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});
