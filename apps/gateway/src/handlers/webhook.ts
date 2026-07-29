// webhook de telegram: autenticacion, autorizacion, idempotencia y despacho
import {
  extractAttachment, telegramUpdateSchema, renderError } from '@luxy/shared';
import type { GatewayConfig } from '../env.js';
import type { Repository } from '../repository.js';
import type { Logger } from '../logger.js';
import { describeError } from '../logger.js';
import { type TelegramClient } from '../telegram.js';
import { isAuthorizedChat, isAuthorizedUser, verifyWebhookSecret } from '../auth.js';
import { getWebhookLimiter } from '../ratelimit.js';
import { handleTextMessage, type CommandContext } from './commands.js';
import { handleCallbackQuery } from './callbacks.js';

export interface WebhookDeps {
  config: GatewayConfig;
  repo: Repository;
  telegram: TelegramClient;
  logger: Logger;
}

/**
 * el webhook SIEMPRE responde 200 salvo que falle el secreto.
 * si devolviera error, telegram reintentaria el mismo update en bucle.
 */
export async function handleWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const { config, repo, telegram, logger } = deps;

  // 1. el secreto del webhook es la primera barrera
  if (!verifyWebhookSecret(request, config)) {
    logger.warn('webhook rechazado: secreto invalido');
    return new Response('unauthorized', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    logger.warn('webhook con cuerpo no json');
    return new Response('ok', { status: 200 });
  }

  // 2. validacion zod: solo se extraen los campos que luxy necesita
  const parsed = telegramUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn('update de telegram con forma inesperada');
    return new Response('ok', { status: 200 });
  }
  const update = parsed.data;

  // 3. idempotencia: un update_id repetido no se procesa dos veces
  const isNew = await repo.registerUpdate(update.update_id).catch((error) => {
    logger.error('no se pudo registrar el update', describeError(error));
    // si supabase falla, se procesa igualmente: es preferible a perder el mensaje
    return true;
  });
  if (!isNew) {
    logger.info('update duplicado ignorado', { updateId: update.update_id });
    return new Response('ok', { status: 200 });
  }

  try {
    await dispatchUpdate(update, deps);
    await repo.markUpdateProcessed(update.update_id).catch(() => undefined);
  } catch (error) {
    const described = describeError(error);
    logger.error('fallo procesando el update', { updateId: update.update_id, ...described });
    await repo.markUpdateProcessed(update.update_id, described.message).catch(() => undefined);

    // se intenta avisar al usuario, con el mensaje ya redactado
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (typeof chatId === 'number' && isAuthorizedChat(chatId, config)) {
      await telegram
        .sendMessage(chatId, renderError('Luxy no pudo procesar la peticion', described.message))
        .catch(() => undefined);
    }
  }

  return new Response('ok', { status: 200 });
}

async function dispatchUpdate(
  update: ReturnType<typeof telegramUpdateSchema.parse>,
  deps: WebhookDeps,
): Promise<void> {
  const { config, repo, telegram, logger } = deps;

  if (update.callback_query) {
    const query = update.callback_query;
    // los botones se validan igual que los mensajes
    if (!isAuthorizedUser(query.from.id, config)) {
      await telegram.answerCallbackQuery(query.id, 'No estas autorizado.');
      return;
    }
    const chatId = query.message?.chat.id;
    if (!isAuthorizedChat(chatId, config)) {
      await telegram.answerCallbackQuery(query.id, 'Chat no autorizado.');
      return;
    }
    await handleCallbackQuery(query, deps);
    return;
  }

  // los mensajes editados se ignoran a proposito: reejecutarlos seria peligroso
  const message = update.message;
  if (!message?.text) return;

  const userId = message.from?.id;
  const chatId = message.chat.id;

  // el chat debe estar en la lista blanca antes de responder nada
  if (!isAuthorizedChat(chatId, config)) {
    logger.warn('mensaje de chat no autorizado', { chatId });
    return;
  }

  // solo el usuario administrador puede dar ordenes.
  // en un grupo, los mensajes de otros miembros NO se ejecutan nunca.
  if (!isAuthorizedUser(userId, config)) {
    logger.warn('mensaje de usuario no autorizado', { chatId, userId });
    return;
  }

  // rate limiting por usuario
  const limit = getWebhookLimiter(config.RATE_LIMIT_PER_MINUTE).check(String(userId));
  if (!limit.allowed) {
    logger.warn('usuario limitado por rate limit', { userId });
    await telegram.sendMessage(chatId, 'Vas demasiado rapido. Espera unos segundos.');
    return;
  }

  const isPrivateChat = message.chat.type === 'private';
  const replyFrom = message.reply_to_message?.from;
  const isReplyToBot = replyFrom?.is_bot === true;

  const context: CommandContext = {
    config,
    repo,
    telegram,
    logger,
    chatId,
    userId: userId!,
    username: message.from?.username ?? null,
    isPrivateChat,
    isReplyToBot,
    // el texto citado se pasa como dato, nunca como instruccion
    quotedText: message.reply_to_message?.text ?? null,
    // adjunto del propio mensaje o, si no, del mensaje al que responde: asi
    // puedes mandar la foto y luego pedirle algo respondiendo a ella
    attachment:
      extractAttachment(message) ??
      (message.reply_to_message ? extractAttachment(message.reply_to_message) : null),
  };

  // con una foto la instruccion viene en el pie, no en el texto
  const texto = message.text ?? message.caption ?? '';
  const reply = await handleTextMessage(context, texto);
  if (!reply) return;

  const messageId = await telegram.sendMessage(chatId, reply.text, {
    replyMarkup: reply.keyboard,
  });

  // se guarda el id del mensaje para poder editarlo con el progreso
  const shortIdMatch = /LUX-[A-Z0-9]+/.exec(reply.text);
  if (messageId && shortIdMatch) {
    const job = await repo.getJobByShortId(shortIdMatch[0]).catch(() => null);
    if (job) {
      await repo.mergeJobMetadata(job.id, { progressMessageId: messageId }).catch(() => undefined);
    }
  }
}
