// pruebas de la extraccion de adjuntos de un mensaje de Telegram.
//
// ORIGEN: al enviar una foto al bot no pasaba nada. El mensaje llegaba sin
// `text` (la instruccion va en `caption`) y sin ninguna referencia al archivo.
import { describe, it, expect } from 'vitest';
import { extractAttachment } from './commands.js';
import { categoryOfApiModel, commandForAttachment } from '../models/aliases.js';

describe('extractAttachment', () => {
  it('de una foto coge el tamaño MAYOR, no el primero', () => {
    // Telegram manda las miniaturas de menor a mayor: quedarse con la primera
    // enviaria una imagen de 90 px al modelo, que rechaza menos de 64 px
    const attachment = extractAttachment({
      photo: [
        { file_id: 'pequena', file_size: 900 },
        { file_id: 'mediana', file_size: 12_000 },
        { file_id: 'grande', file_size: 180_000 },
      ],
    });

    expect(attachment?.fileId).toBe('grande');
    expect(attachment?.kind).toBe('photo');
    expect(attachment?.mimeType).toBe('image/jpeg');
  });

  it('reconoce una nota de voz', () => {
    const attachment = extractAttachment({ voice: { file_id: 'V', mime_type: 'audio/ogg' } });
    expect(attachment).toMatchObject({ fileId: 'V', kind: 'voice', mimeType: 'audio/ogg' });
  });

  it('reconoce un archivo de audio y conserva su nombre', () => {
    const attachment = extractAttachment({
      audio: { file_id: 'A', file_name: 'cancion.mp3', mime_type: 'audio/mpeg' },
    });
    expect(attachment).toMatchObject({ kind: 'audio', fileName: 'cancion.mp3' });
  });

  it('reconoce un documento sin tipo declarado', () => {
    const attachment = extractAttachment({ document: { file_id: 'D', file_name: 'notas.txt' } });
    expect(attachment).toMatchObject({ kind: 'document', mimeType: null });
  });

  it('un mensaje de solo texto no tiene adjunto', () => {
    expect(extractAttachment({})).toBeNull();
  });

  it('una foto sin miniaturas no se toma como adjunto', () => {
    expect(extractAttachment({ photo: [] })).toBeNull();
  });
});

describe('categoria del modelo', () => {
  it('distingue texto, audio e imagen', () => {
    expect(categoryOfApiModel('step-image-edit-2')).toBe('image');
    expect(categoryOfApiModel('stepaudio-2.5-tts')).toBe('audio');
    expect(categoryOfApiModel('DeepSeek-V4-Pro')).toBe('text');
  });

  it('un modelo que no esta en el catalogo no inventa categoria', () => {
    expect(categoryOfApiModel('modelo-que-no-existe')).toBeNull();
  });
});

describe('comando sugerido por tipo de adjunto', () => {
  it('propone el carril correcto', () => {
    expect(commandForAttachment('photo')).toBe('/image_edit');
    expect(commandForAttachment('voice')).toBe('/transcribe');
    expect(commandForAttachment('audio')).toBe('/transcribe');
  });

  it('para un documento no propone nada: no hay carril propio', () => {
    expect(commandForAttachment('document')).toBeNull();
  });
});
