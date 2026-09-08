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
