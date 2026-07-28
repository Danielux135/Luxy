// pruebas de los adaptadores de audio, imagen y router.
//
// se sustituye fetch por un doble: no se llama a ninguna API real ni se gasta
// nada. Los formatos que devuelve el doble son los que respondio la conexion de
// verdad el 2026-07-28, copiados de la comprobacion.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ADAPTER_VERIFICATION,
  DEFAULT_VOICE,
  MediaAdapterError,
  editImage,
  routeRemotely,
  synthesizeSpeech,
  transcribeAudio,
} from './media-adapters.js';

const originalFetch = globalThis.fetch;
let peticiones: { url: string; init: RequestInit }[] = [];

function mockFetch(responder: (url: string, init: RequestInit) => Response): void {
  peticiones = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    peticiones.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const options = () => ({
  baseUrl: 'https://api.example/v1',
  apiKey: 'sk-de-prueba',
  signal: new AbortController().signal,
});

describe('estado de verificacion', () => {
  it('la transcripcion NO se declara verificada', () => {
    // criterio 29: una integracion sin comprobar no se presenta como terminada
    expect(ADAPTER_VERIFICATION.transcription.verified).toBe(false);
    expect(ADAPTER_VERIFICATION.transcription.note).toContain('404');
  });

  it('los adaptadores comprobados llevan la fecha', () => {
    for (const key of ['speech', 'imageEdit', 'router', 'audioChat'] as const) {
      expect(ADAPTER_VERIFICATION[key].verified).toBe(true);
      expect(ADAPTER_VERIFICATION[key].checkedAt).toBe('2026-07-28');
    }
  });
});

describe('sintesis de voz', () => {
  beforeEach(() => {
    mockFetch(
      () =>
        new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
          headers: { 'content-type': 'audio/mpeg' },
        }),
    );
  });

  it('pide /audio/speech con la forma real', async () => {
    const result = await synthesizeSpeech(
      { model: 'stepaudio-2.5-tts', text: 'hola' },
      options(),
    );
    expect(result.contentType).toBe('audio/mpeg');
    expect(result.audio.length).toBeGreaterThan(0);

    expect(peticiones[0]?.url).toBe('https://api.example/v1/audio/speech');
    const body = JSON.parse(String(peticiones[0]?.init.body));
    expect(body).toMatchObject({ model: 'stepaudio-2.5-tts', input: 'hola' });
  });

  it('usa una voz que existe de verdad en el proveedor', async () => {
    await synthesizeSpeech({ model: 'stepaudio-2.5-tts', text: 'hola' }, options());
    const body = JSON.parse(String(peticiones[0]?.init.body));
    // "alloy", la de OpenAI, devuelve voice_id_invalid en este proveedor
    expect(body.voice).toBe(DEFAULT_VOICE);
    expect(body.voice).not.toBe('alloy');
  });

  it('rechaza un audio vacio en vez de devolverlo', async () => {
    mockFetch(() => new Response(new Uint8Array([]), { headers: { 'content-type': 'audio/mpeg' } }));
    await expect(
      synthesizeSpeech({ model: 'stepaudio-2.5-tts', text: 'hola' }, options()),
    ).rejects.toBeInstanceOf(MediaAdapterError);
  });

  it('traduce un error de la API sin filtrar la clave', async () => {
    mockFetch(() => new Response('{"error":{"message":"voice_id_invalid"}}', { status: 400 }));
    try {
      await synthesizeSpeech({ model: 'stepaudio-2.5-tts', text: 'hola' }, options());
      expect.unreachable();
    } catch (error) {
      expect((error as MediaAdapterError).status).toBe(400);
      expect((error as Error).message).not.toContain('sk-de-prueba');
    }
  });
});

describe('edicion de imagen', () => {
  it('devuelve la URL que da la API', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({ created: 1, data: [{ url: 'https://res.example/imagen.png' }] }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );

    const result = await editImage(
      { model: 'step-image-edit-2', image: Buffer.from('png'), prompt: 'hazlo azul' },
      options(),
    );
    expect(result.url).toBe('https://res.example/imagen.png');
    expect(peticiones[0]?.url).toBe('https://api.example/v1/images/edits');
    // multipart, no JSON: es lo que acepta el endpoint real
    expect(peticiones[0]?.init.body).toBeInstanceOf(FormData);
  });

  it('rechaza una respuesta con formato inesperado', async () => {
    mockFetch(() => new Response('{"resultado":"ok"}', { headers: { 'content-type': 'application/json' } }));
    await expect(
      editImage({ model: 'step-image-edit-2', image: Buffer.from('x'), prompt: 'y' }, options()),
    ).rejects.toBeInstanceOf(MediaAdapterError);
  });
});

describe('transcripcion (sin verificar)', () => {
  it('manda multipart con file y model', async () => {
    mockFetch(() => new Response('{"text":"hola mundo"}', { headers: { 'content-type': 'application/json' } }));
    const result = await transcribeAudio(
      { model: 'stepaudio-2.5-asr', audio: Buffer.from('mp3') },
      options(),
    );
    expect(result.text).toBe('hola mundo');
    expect(peticiones[0]?.url).toBe('https://api.example/v1/audio/transcriptions');
  });

  it('el 404 del proveedor llega como error, no como silencio', async () => {
    // es lo que devuelve hoy la conexion real
    mockFetch(() => new Response('{"error":{"message":"openai_error"}}', { status: 404 }));
    await expect(
      transcribeAudio({ model: 'stepaudio-2.5-asr', audio: Buffer.from('x') }, options()),
    ).rejects.toBeInstanceOf(MediaAdapterError);
  });
});

describe('router remoto', () => {
  const responder = (content: string) =>
    mockFetch(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          headers: { 'content-type': 'application/json' },
        }),
    );

  it('acepta la eleccion si es uno de los candidatos ofrecidos', async () => {
    responder('DeepSeek-V4-Pro');
    const result = await routeRemotely(
      { model: 'step-router-v1', prompt: 'refactoriza', candidates: ['DeepSeek-V4-Pro', 'Kimi-K2.6'] },
      options(),
    );
    expect(result.model).toBe('DeepSeek-V4-Pro');
  });

  it('DESCARTA un modelo que no estaba en la lista', async () => {
    // el router remoto no puede elegir algo que Luxy no le haya ofrecido
    responder('gpt-4-turbo');
    const result = await routeRemotely(
      { model: 'step-router-v1', prompt: 'refactoriza', candidates: ['DeepSeek-V4-Pro'] },
      options(),
    );
    expect(result.model).toBeNull();
    expect(result.raw).toBe('gpt-4-turbo');
  });

  it('una respuesta vacia no elige nada', async () => {
    responder('');
    const result = await routeRemotely(
      { model: 'step-router-v1', prompt: 'x', candidates: ['DeepSeek-V4-Pro'] },
      options(),
    );
    expect(result.model).toBeNull();
  });

  it('solo ofrece los candidatos que se le pasan', async () => {
    responder('DeepSeek-V4-Pro');
    await routeRemotely(
      { model: 'step-router-v1', prompt: 'x', candidates: ['DeepSeek-V4-Pro', 'Kimi-K2.6'] },
      options(),
    );
    const body = JSON.parse(String(peticiones[0]?.init.body));
    expect(body.messages[0].content).toContain('DeepSeek-V4-Pro');
    expect(body.messages[0].content).toContain('Kimi-K2.6');
  });
});
