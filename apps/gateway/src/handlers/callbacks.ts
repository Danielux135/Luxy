// botones inline: eleccion de maquina, diff, pruebas, commit, descartar y push
import { STATUS_LABELS, splitAsCodeBlocks, renderError } from '@luxy/shared';
import type { z } from 'zod';
import type { telegramCallbackQuerySchema } from '@luxy/shared';
import type { WebhookDeps } from './webhook.js';
import { parseCallbackData, buildPushConfirmKeyboard } from '../telegram.js';

type CallbackQuery = z.infer<typeof telegramCallbackQuerySchema>;

export async function handleCallbackQuery(
  query: CallbackQuery,
  deps: WebhookDeps,
): Promise<void> {
  const { repo, telegram, logger } = deps;
  const chatId = query.message?.chat.id;
  if (typeof chatId !== 'number' || !query.data) {
    await telegram.answerCallbackQuery(query.id);
    return;
  }

  const parsed = parseCallbackData(query.data);
  if (!parsed) {
    await telegram.answerCallbackQuery(query.id, 'Accion no reconocida.');
    return;
  }

  logger.info('callback recibido', { action: parsed.action });

  switch (parsed.action) {
    case 'pick':
      await handleMachinePick(parsed.argument, chatId, query, deps);
      return;
    case 'diff':
    case 'tests':
      await handleShowArtifact(parsed.action, parsed.argument, chatId, query, deps);
      return;
    case 'commit':
    case 'discard':
      await handleApprovalRequest(parsed.action, parsed.argument, chatId, query, deps);
      return;
    case 'askpush':
      await handlePushRequest(parsed.argument, chatId, query, deps);
      return;
    case 'dopush':
      await handlePushConfirm(parsed.argument, chatId, query, deps);
      return;
    case 'nopush':
      await telegram.answerCallbackQuery(query.id, 'Push cancelado.');
      await telegram.sendMessage(chatId, 'Push cancelado. No se ha enviado nada al remoto.');
      return;
    default:
      await telegram.answerCallbackQuery(query.id, 'Accion desconocida.');
      await repo.getJobByShortId(parsed.argument).catch(() => null);
  }
}

/** el usuario eligio maquina para un trabajo que estaba esperando */
async function handleMachinePick(
  argument: string,
  chatId: number,
  query: CallbackQuery,
  deps: WebhookDeps,
): Promise<void> {
  const { repo, telegram } = deps;
  // el formato es "IDCORTO|nombremaquina"
  const separator = argument.indexOf('|');
  if (separator <= 0) {
    await telegram.answerCallbackQuery(query.id, 'Dato invalido.');
    return;
  }
  const shortId = argument.slice(0, separator);
  const machineName = argument.slice(separator + 1);

  const [job, machine] = await Promise.all([
    repo.getJobByShortId(shortId),
    repo.getMachineByName(machineName),
  ]);

  if (!job || !machine) {
    await telegram.answerCallbackQuery(query.id, 'El trabajo o la maquina ya no existen.');
    return;
  }
  if (job.status !== 'waiting_for_machine') {
    await telegram.answerCallbackQuery(query.id, `El trabajo ya esta ${STATUS_LABELS[job.status]}.`);
    return;
  }

  // se asigna la maquina y se pone en cola para que la reclame
  await repo.updateJob(job.id, { target_machine_id: machine.id, status: 'queued' });
  // y se recuerda la eleccion como preferencia del usuario
  await repo.setUserPreference(query.from.id, query.from.username ?? null, machine.id);

  await telegram.answerCallbackQuery(query.id, `Asignado a ${machine.name}.`);
  await telegram.sendMessage(
    chatId,
    [
      `${job.shortId} asignado a ${machine.name}.`,
      '',
      `He guardado "${machine.name}" como tu maquina preferida. Cambiala con /use.`,
    ].join('\n'),
  );
}

/** muestra el diff o el log de pruebas guardados en los metadatos del trabajo */
async function handleShowArtifact(
  kind: 'diff' | 'tests',
  shortId: string,
  chatId: number,
  query: CallbackQuery,
  deps: WebhookDeps,
): Promise<void> {
  const { repo, telegram } = deps;
  const job = await repo.getJobByShortId(shortId);
  if (!job) {
    await telegram.answerCallbackQuery(query.id, 'Ese trabajo ya no existe.');
    return;
  }
  await telegram.answerCallbackQuery(query.id);

  if (kind === 'diff') {
    const diffStat = typeof job.metadata.diffStat === 'string' ? job.metadata.diffStat : null;
    if (!diffStat) {
      await telegram.sendMessage(chatId, `El trabajo ${shortId} no registro ningun diff.`);
      return;
    }
    for (const block of splitAsCodeBlocks(diffStat)) {
      await telegram.sendMessage(chatId, block);
    }
    await telegram.sendMessage(
      chatId,
      `El diff completo esta en el worktree de la maquina:\n${job.metadata.worktreePath ?? 'ruta no registrada'}`,
    );
    return;
  }

  const events = await repo.listEvents(job.id, 50);
  const testEvents = events.filter((event) => event.type === 'test_result');
  if (testEvents.length === 0) {
    await telegram.sendMessage(chatId, `El trabajo ${shortId} no ejecuto pruebas.`);
    return;
  }
  const body = testEvents
    .slice()
    .reverse()
    .map((event) => event.message)
    .join('\n');
  for (const block of splitAsCodeBlocks(body)) {
    await telegram.sendMessage(chatId, block);
  }
}

/**
 * commit y descarte requieren aprobacion registrada.
 * la aprobacion queda auditada en la tabla approvals.
 */
async function handleApprovalRequest(
  action: 'commit' | 'discard',
  shortId: string,
  chatId: number,
  query: CallbackQuery,
  deps: WebhookDeps,
): Promise<void> {
  const { repo, telegram } = deps;
  const job = await repo.getJobByShortId(shortId);
  if (!job) {
    await telegram.answerCallbackQuery(query.id, 'Ese trabajo ya no existe.');
    return;
  }

  const approval = await repo.createApproval(job.id, action, {
    requestedFromChat: chatId,
    worktreePath: job.metadata.worktreePath ?? null,
  });
  // la pulsacion del boton es la accion explicita del usuario: se aprueba ya
  await repo.resolveApproval(approval.id, 'approved', query.from.id);
  await repo.updateJob(job.id, { status: 'waiting_for_approval' });

  await telegram.answerCallbackQuery(query.id, 'Solicitud enviada a la maquina.');
  await telegram.sendMessage(
    chatId,
    action === 'commit'
      ? `Commit solicitado para ${shortId}. La maquina lo creara en la rama ${job.metadata.branch ?? 'del worktree'}.`
      : `Descarte solicitado para ${shortId}. La maquina eliminara el worktree y sus cambios.`,
  );
}

/** primer paso del push: pedir confirmacion */
async function handlePushRequest(
  shortId: string,
  chatId: number,
  query: CallbackQuery,
  deps: WebhookDeps,
): Promise<void> {
  const { repo, telegram } = deps;
  const job = await repo.getJobByShortId(shortId);
  if (!job) {
    await telegram.answerCallbackQuery(query.id, 'Ese trabajo ya no existe.');
    return;
  }
  await telegram.answerCallbackQuery(query.id);
  await telegram.sendMessage(
    chatId,
    [
      `Vas a hacer push de ${shortId}.`,
      '',
      `Rama: ${job.metadata.branch ?? 'desconocida'}`,
      `Proyecto: ${job.projectAlias}`,
      '',
      'El push esta deshabilitado por defecto en la configuracion de cada maquina.',
      'Si allowPush es false, la maquina rechazara la operacion.',
      '',
      'Esta accion envia codigo a un remoto. Confirma para continuar.',
    ].join('\n'),
    { replyMarkup: buildPushConfirmKeyboard(shortId) },
  );
}

/** segundo paso del push: registrar la aprobacion doble */
async function handlePushConfirm(
  shortId: string,
  chatId: number,
  query: CallbackQuery,
  deps: WebhookDeps,
): Promise<void> {
  const { repo, telegram } = deps;
  const job = await repo.getJobByShortId(shortId);
  if (!job) {
    await telegram.answerCallbackQuery(query.id, 'Ese trabajo ya no existe.');
    return;
  }

  try {
    const approval = await repo.createApproval(job.id, 'push', {
      confirmedTwice: true,
      branch: job.metadata.branch ?? null,
    });
    await repo.resolveApproval(approval.id, 'approved', query.from.id);
    await repo.updateJob(job.id, { status: 'waiting_for_approval' });

    await telegram.answerCallbackQuery(query.id, 'Push confirmado.');
    await telegram.sendMessage(
      chatId,
      `Push confirmado para ${shortId}. La maquina lo ejecutara solo si su configuracion lo permite.`,
    );
  } catch (error) {
    await telegram.answerCallbackQuery(query.id, 'No se pudo registrar la aprobacion.');
    await telegram.sendMessage(
      chatId,
      renderError('no se pudo registrar la aprobacion del push', String(error).slice(0, 200)),
    );
  }
}
