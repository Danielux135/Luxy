// pruebas del despacho del webhook.
//
// ORIGEN: al enviar una foto con el comando en el pie, Luxy no hacia NADA.
// Toda la tuberia de adjuntos estaba construida, pero el despachador exigia
// `message.text` y descartaba el mensaje antes de mirar el `caption`.
//
// La invariante que se protege aqui es que una instruccion llegue igual venga
// en el texto o en el pie de un archivo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebhook, type WebhookDeps } from './webhook.js';
import * as commands from './commands.js';

const SECRETO = 'secreto-del-webhook-1234';
const USUARIO = 111222333;
const CHAT = 111222333;

const config = {
  TELEGRAM_WEBHOOK_SECRET: SECRETO,
  RATE_LIMIT_PER_MINUTE: 1000,
  adminUserId: USUARIO,
  allowedChatIds: [CHAT],
} as unknown as WebhookDeps['config'];

function deps(): WebhookDeps {
  return {
    config,
    repo: {
      registerUpdate: vi.fn(async () => true),
      markUpdateProcessed: vi.fn(async () => undefined),
      getJobByShortId: vi.fn(async () => null),
      mergeJobMetadata: vi.fn(async () => undefined),
    } as unknown as WebhookDeps['repo'],
    telegram: {
      sendMessage: vi.fn(async () => 42),
    } as unknown as WebhookDeps['telegram'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as WebhookDeps['logger'],
  };
}

let contador = 0;
function peticion(message: Record<string, unknown>): Request {
  return new Request('https://gateway.test/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': SECRETO,
    },
    body: JSON.stringify({
      update_id: ++contador,
      message: {
        message_id: contador,
        from: { id: USUARIO, is_bot: false, first_name: 'Daniel' },
        chat: { id: CHAT, type: 'private' },
        ...message,
      },
    }),
  });
}

let handle: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  handle = vi
    .spyOn(commands, 'handleTextMessage')
    .mockResolvedValue({ text: 'Trabajo creado LUX-ABC123' });
});

describe('de donde sale la instruccion', () => {
  it('un mensaje de texto normal se despacha', async () => {
    const d = deps();
    await handleWebhook(peticion({ text: '/status' }), d);
    expect(handle).toHaveBeenCalledWith(expect.anything(), '/status');
  });

  it('una FOTO con el comando en el pie se despacha igual', async () => {
    const d = deps();
    await handleWebhook(
      peticion({
        caption: '/image_edit test ponle un sombrero',
        photo: [
          { file_id: 'pequena', file_size: 900 },
          { file_id: 'grande', file_size: 180_000 },
        ],
      }),
      d,
    );

    expect(handle).toHaveBeenCalledWith(
      expect.anything(),
      '/image_edit test ponle un sombrero',
    );
    // y el adjunto viaja en el contexto, con la miniatura mayor
    expect(handle.mock.calls[0]![0]).toMatchObject({
      attachment: { fileId: 'grande', kind: 'photo' },
    });
  });

  it('una foto enviada como ARCHIVO tambien vale', async () => {
    // asi es como llega cuando marcas "enviar sin comprimir": es un document
    const d = deps();
    await handleWebhook(
      peticion({
        caption: '/image_edit test edita esta foto',
        document: { file_id: 'DOC', file_name: 'foto.jpg', mime_type: 'image/jpeg' },
      }),
      d,
    );

    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]![0]).toMatchObject({
      attachment: { fileId: 'DOC', kind: 'document', mimeType: 'image/jpeg' },
    });
  });

  it('una nota de voz con el comando en el pie se despacha', async () => {
    const d = deps();
    await handleWebhook(
      peticion({
        caption: '/transcribe test transcribe esto',
        voice: { file_id: 'VOZ', mime_type: 'audio/ogg' },
      }),
      d,
    );
    expect(handle.mock.calls[0]![0]).toMatchObject({ attachment: { kind: 'voice' } });
  });
});

describe('lo que sigue sin despacharse', () => {
  it('una foto SIN instruccion no lanza nada', async () => {
    const d = deps();
    await handleWebhook(peticion({ photo: [{ file_id: 'X', file_size: 900 }] }), d);
    expect(handle).not.toHaveBeenCalled();
  });

  it('un pie en blanco no cuenta como instruccion', async () => {
    const d = deps();
    await handleWebhook(peticion({ caption: '   ', document: { file_id: 'D' } }), d);
    expect(handle).not.toHaveBeenCalled();
  });

  it('un mensaje de otro usuario nunca se ejecuta', async () => {
    const d = deps();
    await handleWebhook(
      peticion({ text: '/deepseek test borra todo', from: { id: 999, is_bot: false, first_name: 'Otro' } }),
      d,
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it('sin el secreto correcto se rechaza con 401', async () => {
    const d = deps();
    const request = new Request('https://gateway.test/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 1 }),
    });
    const response = await handleWebhook(request, d);
    expect(response.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });
});
