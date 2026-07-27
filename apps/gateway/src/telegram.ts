// cliente de la bot api de telegram. solo salida: el worker nunca hace polling.
import { splitMessage, redact, TELEGRAM_MAX_MESSAGE_LENGTH } from '@luxy/shared';

export interface InlineButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = InlineButton[][];

export interface SendMessageOptions {
  replyMarkup?: InlineKeyboard;
  replyToMessageId?: number;
  disableNotification?: boolean;
}

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly description: string,
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

export class TelegramClient {
  private readonly apiUrl: string;

  constructor(botToken: string) {
    this.apiUrl = `https://api.telegram.org/bot${botToken}`;
  }

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.apiUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      description?: string;
    };

    if (!response.ok || body.ok !== true) {
      // la descripcion de telegram puede contener el token en algunos errores
      throw new TelegramError(
        `telegram ${method} fallo`,
        response.status,
        redact(body.description ?? 'sin descripcion'),
      );
    }
    return body.result as T;
  }

  /**
   * envia un mensaje troceandolo si supera el limite de telegram.
   * devuelve el id del primer mensaje, que es el que luego se edita.
   */
  async sendMessage(
    chatId: number,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<number | null> {
    const chunks = splitMessage(redact(text), TELEGRAM_MAX_MESSAGE_LENGTH);
    if (chunks.length === 0) return null;

    let firstMessageId: number | null = null;
    for (let index = 0; index < chunks.length; index += 1) {
      const isLast = index === chunks.length - 1;
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: chunks[index],
        disable_notification: options.disableNotification ?? false,
      };
      // los botones solo se adjuntan al ultimo fragmento
      if (isLast && options.replyMarkup) {
        payload.reply_markup = { inline_keyboard: options.replyMarkup };
      }
      if (index === 0 && options.replyToMessageId) {
        payload.reply_to_message_id = options.replyToMessageId;
      }
      const result = await this.call<{ message_id: number }>('sendMessage', payload);
      if (index === 0) firstMessageId = result.message_id;
    }
    return firstMessageId;
  }

  /**
   * edita un mensaje existente. se usa para el progreso, en vez de enviar
   * mensajes nuevos continuamente.
   * telegram devuelve error si el texto no cambio: eso no es un fallo real.
   */
  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboard,
  ): Promise<boolean> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      // si el progreso creciera demasiado se recorta: editar no admite trocear
      text: redact(text).slice(0, TELEGRAM_MAX_MESSAGE_LENGTH),
    };
    if (replyMarkup) payload.reply_markup = { inline_keyboard: replyMarkup };

    try {
      await this.call('editMessageText', payload);
      return true;
    } catch (error) {
      if (error instanceof TelegramError && /message is not modified/i.test(error.description)) {
        return false;
      }
      throw error;
    }
  }

  /** confirma la pulsacion de un boton para que telegram deje de mostrar el reloj */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text ? redact(text).slice(0, 200) : undefined,
    });
  }
}

// -----------------------------------------------------------------------------
// construccion de teclados
// el callback_data de telegram tiene un limite duro de 64 bytes, asi que se usa
// un formato compacto: "accion:idcorto"
// -----------------------------------------------------------------------------

export function buildCallbackData(action: string, argument: string): string {
  const data = `${action}:${argument}`;
  if (new TextEncoder().encode(data).length > 64) {
    throw new Error(`callback_data demasiado largo: ${data}`);
  }
  return data;
}

export function parseCallbackData(data: string): { action: string; argument: string } | null {
  const index = data.indexOf(':');
  if (index <= 0) return null;
  return { action: data.slice(0, index), argument: data.slice(index + 1) };
}

/** botones que acompañan a un trabajo terminado con cambios */
export function buildResultKeyboard(shortId: string, canCommit: boolean): InlineKeyboard {
  const rows: InlineKeyboard = [
    [
      { text: 'Ver diff', callback_data: buildCallbackData('diff', shortId) },
      { text: 'Ver pruebas', callback_data: buildCallbackData('tests', shortId) },
    ],
  ];
  if (canCommit) {
    rows.push([
      { text: 'Crear commit', callback_data: buildCallbackData('commit', shortId) },
      { text: 'Descartar cambios', callback_data: buildCallbackData('discard', shortId) },
    ]);
    // el push es un flujo aparte y siempre exige una segunda confirmacion
    rows.push([{ text: 'Solicitar push', callback_data: buildCallbackData('askpush', shortId) }]);
  }
  return rows;
}

/** segundo paso del push: confirmar o cancelar */
export function buildPushConfirmKeyboard(shortId: string): InlineKeyboard {
  return [
    [
      { text: 'Confirmar push', callback_data: buildCallbackData('dopush', shortId) },
      { text: 'Cancelar', callback_data: buildCallbackData('nopush', shortId) },
    ],
  ];
}

/** botones para elegir maquina cuando hay varias conectadas */
export function buildMachineChoiceKeyboard(
  machines: Array<{ id: string; name: string }>,
  shortId: string,
): InlineKeyboard {
  return machines.map((machine) => [
    {
      text: machine.name,
      // se usa el nombre, no el uuid, porque el limite es de 64 bytes
      callback_data: buildCallbackData('pick', `${shortId}|${machine.name}`),
    },
  ]);
}
