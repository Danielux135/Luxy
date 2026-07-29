// pruebas del carril de audio e imagen.
//
// Lo que se protege aqui es que un modelo de medios NUNCA acabe en el bucle de
// herramientas de archivos, y que cuando falta el adjunto el usuario reciba una
// instruccion util en vez de un error del proveedor.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AgentConfig, ClaimedJob } from '@luxy/shared';
import { findMediaModel, runMediaJob } from './media-runner.js';
import * as adapters from './providers/media-adapters.js';

const connection = {
  id: 'newapi',
  label: 'NewAPI',
  baseUrl: 'https://api.ejemplo.test',
  dialect: 'openai' as const,
  apiKeyEnv: 'connection:newapi',
  enabled: true,
  timeoutMs: 120_000,
};

const config = { connections: [connection] } as unknown as AgentConfig;

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    shortId: 'abc123',
    prompt: 'ponle un sombrero',
    attachment: null,
    ...overrides,
  } as ClaimedJob;
}

function deps(overrides: Partial<Parameters<typeof runMediaJob>[2]> = {}) {
  return {
    config,
    downloadAttachment: vi.fn(async () => Buffer.from('bytes')),
    apiKeyFor: () => 'sk-prueba',
    signal: new AbortController().signal,
    emit: () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('findMediaModel', () => {
  it('reconoce los modelos de audio y de imagen', () => {
    expect(findMediaModel('step-image-edit-2', config)?.definition.category).toBe('image');
    expect(findMediaModel('stepaudio-2.5-tts', config)?.definition.category).toBe('audio');
  });

  it('no desvia los modelos de texto: esos van al bucle de herramientas', () => {
    expect(findMediaModel('DeepSeek-V4-Pro', config)).toBeNull();
  });

  it('no desvia los modelos de enrutado: no son un destino final', () => {
    expect(findMediaModel('step-router-v1', config)).toBeNull();
    expect(findMediaModel('auto', config)).toBeNull();
  });

  it('ignora las conexiones deshabilitadas', () => {
    const apagada = { connections: [{ ...connection, enabled: false }] } as unknown as AgentConfig;
    expect(findMediaModel('step-image-edit-2', apagada)).toBeNull();
  });
});

describe('sintesis de voz', () => {
  it('no necesita adjunto y devuelve el audio en base64', async () => {
    vi.spyOn(adapters, 'synthesizeSpeech').mockResolvedValue({
      audio: Buffer.from('audio-falso'),
      contentType: 'audio/mpeg',
    });

    const model = findMediaModel('stepaudio-2.5-tts', config)!;
    const result = await runMediaJob(job({ prompt: 'hola Hugo' }), model, deps());

    expect(result.ok).toBe(true);
    expect(result.media?.kind).toBe('audio');
    expect(result.media?.base64).toBe(Buffer.from('audio-falso').toString('base64'));
  });
});

describe('edicion de imagen', () => {
  const model = () => findMediaModel('step-image-edit-2', config)!;

  it('sin adjunto explica que hay que enviar una foto, sin llamar a la API', async () => {
    const editar = vi.spyOn(adapters, 'editImage');
    const d = deps();

    const result = await runMediaJob(job(), model(), d);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('imagen');
    expect(editar).not.toHaveBeenCalled();
    expect(d.downloadAttachment).not.toHaveBeenCalled();
  });

  it('con adjunto descarga los bytes y devuelve la imagen', async () => {
    const editar = vi
      .spyOn(adapters, 'editImage')
      .mockResolvedValue({ url: 'https://cdn.ejemplo.test/x.png', base64: null });

    const d = deps();
    const conFoto = job({
      attachment: {
        fileId: 'FID',
        kind: 'photo',
        mimeType: 'image/jpeg',
        fileName: 'foto.jpg',
        size: 1024,
      },
    });

    const result = await runMediaJob(conFoto, model(), d);

    expect(d.downloadAttachment).toHaveBeenCalledOnce();
    expect(editar.mock.calls[0]![0].image).toEqual(Buffer.from('bytes'));
    expect(result.media?.url).toBe('https://cdn.ejemplo.test/x.png');
  });

  it('si la API no devuelve ninguna imagen, no se declara exito', async () => {
    vi.spyOn(adapters, 'editImage').mockResolvedValue({ url: null, base64: null });
    const conFoto = job({
      attachment: { fileId: 'FID', kind: 'photo', mimeType: null, fileName: null, size: null },
    });

    const result = await runMediaJob(conFoto, model(), deps());
    expect(result.ok).toBe(false);
  });
});

describe('transcripcion', () => {
  it('el fallo conocido del proveedor se explica como limitacion, no como culpa del usuario', async () => {
    vi.spyOn(adapters, 'transcribeAudio').mockRejectedValue(
      new adapters.MediaAdapterError('la API respondio 404', 404),
    );

    const model = findMediaModel('stepaudio-2.5-asr', config)!;
    const conAudio = job({
      attachment: {
        fileId: 'FID',
        kind: 'voice',
        mimeType: 'audio/ogg',
        fileName: 'nota.ogg',
        size: 900,
      },
    });

    const result = await runMediaJob(conAudio, model, deps());

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('404');
    expect(result.summary).toContain('limitacion conocida');
  });
});

describe('canales que no existen todavia', () => {
  it('la voz en tiempo real lo dice, en vez de fallar de forma opaca', async () => {
    const model = findMediaModel('stepaudio-2.5-realtime', config)!;
    const result = await runMediaJob(job(), model, deps());
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('/speak');
  });
});

describe('claves', () => {
  it('sin clave de la conexion no se llama a ninguna API', async () => {
    const enviar = vi.spyOn(adapters, 'synthesizeSpeech');
    const model = findMediaModel('stepaudio-2.5-tts', config)!;

    const result = await runMediaJob(job(), model, deps({ apiKeyFor: () => undefined }));

    expect(result.ok).toBe(false);
    expect(enviar).not.toHaveBeenCalled();
  });
});
