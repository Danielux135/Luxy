// procesamiento de los comandos de telegram
import {
  parseCommand,
  extractMention,
  parseNaturalMention,
  CommandParseError,
  selectMachine,
  isMachineOnline,
  routeProvider,
  PROVIDER_IDS,
  normalizeShortId,
  renderJobCreated,
  renderError,
  formatDuration,
  PROVIDER_LABELS,
  STATUS_LABELS,
  splitAsCodeBlocks,
  machineSupportsProvider,
  MAX_PROMPT_LENGTH,
} from '@luxy/shared';
import type { Job, Machine, ProviderId } from '@luxy/shared';
import type { GatewayConfig } from '../env.js';
import type { Repository } from '../repository.js';
import type { Logger } from '../logger.js';
import {
  type TelegramClient,
  buildMachineChoiceKeyboard,
  type InlineKeyboard,
} from '../telegram.js';

export interface CommandContext {
  config: GatewayConfig;
  repo: Repository;
  telegram: TelegramClient;
  logger: Logger;
  chatId: number;
  userId: number;
  username: string | null;
  isPrivateChat: boolean;
  /** true si el mensaje responde directamente a un mensaje del bot */
  isReplyToBot: boolean;
  /** texto citado por el usuario, tratado siempre como dato no confiable */
  quotedText: string | null;
}

/** respuesta que el manejador quiere enviar */
export interface CommandReply {
  text: string;
  keyboard?: InlineKeyboard;
}

const HELP_TEXT = [
  'Luxy - agente personal controlado desde Telegram',
  '',
  'Estado y configuracion:',
  '/status - trabajos activos y maquina seleccionada',
  '/machines - maquinas registradas y su estado',
  '/use <maquina> - fija tu maquina preferida',
  '/projects - alias de proyecto disponibles',
  '/providers - proveedores disponibles por maquina',
  '',
  'Sesion local (sin claves de API):',
  '/claude <proyecto> <tarea>',
  '/codex <proyecto> <tarea>',
  '',
  'Modelos de codigo. El alias sin version usa el predeterminado de su familia,',
  'asi que puedes cambiar el predeterminado sin cambiar el comando que escribes:',
  '/deepseek | /deepseek_pro | /deepseek_flash',
  '/glm | /glm_52 | /glm_51',
  '/kimi | /kimi_k26',
  '/qwen | /qwen_397b | /qwen_35b',
  '/minimax | /minimax_m3',
  '/step | /step_37 | /step_35 | /step_35_2603',
  '/kat | /kat_v25',
  '/auto <proyecto> <tarea> - Luxy elige el modelo',
  '',
  'Audio e imagen:',
  '/audio_chat, /speak, /transcribe, /voice, /image_edit',
  '',
  'Control:',
  '/cancel [ID] - cancela el trabajo activo o el indicado',
  '/job <ID> - detalle de un trabajo',
  '/logs <ID> - ultimos eventos de un trabajo',
  '',
  'Tras un trabajo puedes pedir commit o descartar con los botones.',
  'El push exige que el proyecto lo permita Y una segunda confirmacion.',
  '',
  'En grupos tambien puedes mencionar al bot en lenguaje natural.',
].join('\n');

/**
 * punto de entrada: decide si el mensaje va dirigido a luxy y lo procesa.
 * devuelve null cuando el mensaje debe ignorarse en silencio.
 */
export async function handleTextMessage(
  context: CommandContext,
  text: string,
): Promise<CommandReply | null> {
  const mention = extractMention(text, {
    botUsername: context.config.botUsername ?? undefined,
    isPrivateChat: context.isPrivateChat,
    isReplyToBot: context.isReplyToBot,
  });

  const trimmed = text.trim();
  const looksLikeCommand = trimmed.startsWith('/');

  // en grupos, sin mencion y sin comando, el mensaje no es para luxy
  if (!context.isPrivateChat && !mention.mentioned && !looksLikeCommand) return null;

  if (looksLikeCommand) {
    try {
      const parsed = parseCommand(trimmed, {
        botUsername: context.config.botUsername ?? undefined,
      });
      return await dispatchParsedCommand(context, parsed);
    } catch (error) {
      if (error instanceof CommandParseError) {
        return { text: renderError(error.message, error.hint) };
      }
      throw error;
    }
  }

  // mencion en lenguaje natural
  return handleNaturalMention(context, mention.text);
}

async function dispatchParsedCommand(
  context: CommandContext,
  parsed: ReturnType<typeof parseCommand>,
): Promise<CommandReply | null> {
  switch (parsed.kind) {
    case 'none':
      return null;
    case 'unknown':
      return {
        text: renderError(
          `no conozco el comando /${parsed.command}`,
          'usa /help para ver los comandos disponibles',
        ),
      };
    case 'control':
      return handleControlCommand(context, parsed.command, parsed.argument);
    case 'task':
      return createJobFromRequest(context, {
        provider: parsed.provider,
        // apiModel exacto cuando el comando apunta a un modelo concreto
        model: parsed.model,
        projectAlias: parsed.projectAlias,
        prompt: parsed.prompt,
        explicit: parsed.provider !== null,
      });
    default:
      return null;
  }
}

async function handleControlCommand(
  context: CommandContext,
  command: string,
  argument: string | null,
): Promise<CommandReply> {
  switch (command) {
    case 'start':
      return {
        text: [
          'Luxy conectado.',
          '',
          'Escribe /help para ver los comandos.',
          'Escribe /machines para ver que ordenadores estan encendidos.',
        ].join('\n'),
      };

    case 'help':
      return { text: HELP_TEXT };

    case 'machines':
      return { text: await renderMachines(context) };

    case 'status':
      return { text: await renderStatus(context) };

    case 'projects':
      return { text: await renderProjects(context) };

    case 'providers':
      return { text: await renderProviders(context) };

    case 'use':
      return handleUse(context, argument);

    case 'cancel':
      return handleCancel(context, argument);

    case 'job':
      return handleJobDetail(context, argument);

    case 'logs':
      return handleLogs(context, argument);

    default:
      return { text: renderError(`comando /${command} no implementado`) };
  }
}

// -----------------------------------------------------------------------------
// comandos informativos
// -----------------------------------------------------------------------------

async function renderMachines(context: CommandContext): Promise<string> {
  const machines = await context.repo.listMachines();
  if (machines.length === 0) {
    return [
      'No hay ninguna maquina registrada.',
      '',
      'Ejecuta en el ordenador que quieras usar:',
      'npm run setup:machine',
    ].join('\n');
  }

  const preferredId = await context.repo.getUserPreference(context.userId);
  const offlineAfter = context.config.MACHINE_OFFLINE_SECONDS;

  const lines = ['Maquinas registradas', ''];
  for (const machine of machines) {
    const online = isMachineOnline(machine, new Date(), offlineAfter);
    const marker = machine.id === preferredId ? ' (preferida)' : '';
    lines.push(`${machine.name}${marker}: ${online ? 'conectada' : 'desconectada'}`);
    lines.push(`  equipo: ${machine.hostname} - ${machine.platform} ${machine.platformVersion}`);
    lines.push(`  proyectos: ${machine.projects.join(', ') || 'ninguno'}`);
    lines.push(`  ultimo contacto: ${formatLastSeen(machine.lastSeenAt)}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'nunca';
  const elapsed = Date.now() - Date.parse(lastSeenAt);
  if (!Number.isFinite(elapsed)) return 'desconocido';
  return `hace ${formatDuration(elapsed)}`;
}

async function renderStatus(context: CommandContext): Promise<string> {
  const [machines, jobs, preferredId] = await Promise.all([
    context.repo.listMachines(),
    context.repo.listActiveJobs(),
    context.repo.getUserPreference(context.userId),
  ]);

  const offlineAfter = context.config.MACHINE_OFFLINE_SECONDS;
  const online = machines.filter((machine) => isMachineOnline(machine, new Date(), offlineAfter));
  const preferred = machines.find((machine) => machine.id === preferredId);

  const lines = [
    'Estado de Luxy',
    '',
    `Maquinas conectadas: ${online.map((machine) => machine.name).join(', ') || 'ninguna'}`,
    `Maquina preferida: ${preferred?.name ?? 'sin fijar'}`,
    '',
  ];

  if (jobs.length === 0) {
    lines.push('No hay trabajos activos.');
  } else {
    lines.push('Trabajos activos:');
    for (const job of jobs) {
      const machine = machines.find((item) => item.id === job.claimedBy);
      lines.push(
        `${job.shortId} - ${PROVIDER_LABELS[job.provider]} en ${job.projectAlias}` +
          ` - ${STATUS_LABELS[job.status]}${machine ? ` (${machine.name})` : ''}`,
      );
    }
  }
  return lines.join('\n');
}

async function renderProjects(context: CommandContext): Promise<string> {
  const machines = await context.repo.listMachines();
  // se agrupa por alias porque el pc y el portatil pueden compartir alias
  const byAlias = new Map<string, string[]>();
  for (const machine of machines) {
    for (const alias of machine.projects) {
      byAlias.set(alias, [...(byAlias.get(alias) ?? []), machine.name]);
    }
  }
  if (byAlias.size === 0) {
    return 'Ninguna maquina tiene proyectos configurados. Ejecuta npm run setup:machine.';
  }
  const lines = ['Proyectos configurados', ''];
  for (const [alias, names] of [...byAlias].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${alias}: disponible en ${names.join(', ')}`);
  }
  // las rutas locales nunca se muestran: son especificas de cada equipo
  lines.push('', 'Las rutas locales solo existen en cada ordenador.');
  return lines.join('\n');
}

async function renderProviders(context: CommandContext): Promise<string> {
  const machines = await context.repo.listMachines();
  if (machines.length === 0) return 'No hay ninguna maquina registrada.';

  const lines = ['Proveedores por maquina', ''];
  for (const machine of machines) {
    const available = (['claude', 'codex', 'deepseek', 'glm', 'qwen'] as ProviderId[]).filter(
      (provider) => machineSupportsProvider(machine, provider),
    );
    lines.push(`${machine.name}: ${available.map((id) => PROVIDER_LABELS[id]).join(', ') || 'ninguno'}`);
  }
  lines.push('', 'Claude y Codex usan la sesion local de cada ordenador.');
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// /use
// -----------------------------------------------------------------------------

async function handleUse(context: CommandContext, argument: string | null): Promise<CommandReply> {
  if (!argument) {
    return {
      text: renderError('falta el nombre de la maquina', 'formato: /use <maquina>'),
    };
  }
  const name = argument.trim().toLowerCase();
  const machine = await context.repo.getMachineByName(name);
  if (!machine) {
    return {
      text: renderError(`no existe ninguna maquina llamada "${name}"`, 'usa /machines para verlas'),
    };
  }
  await context.repo.setUserPreference(context.userId, context.username, machine.id);
  const online = isMachineOnline(machine, new Date(), context.config.MACHINE_OFFLINE_SECONDS);
  return {
    text: [
      `Maquina preferida: ${machine.name}`,
      online ? 'Esta conectada.' : 'Ahora mismo esta desconectada; los trabajos quedaran en cola.',
    ].join('\n'),
  };
}

// -----------------------------------------------------------------------------
// creacion de trabajos
// -----------------------------------------------------------------------------

export interface JobRequest {
  provider: ProviderId | null;
  /**
   * apiModel EXACTO, o null para dejar que el agente use el predeterminado de
   * la familia. Nunca se normaliza aqui: viaja tal cual hasta el proveedor.
   */
  model?: string | null;
  projectAlias: string;
  prompt: string;
  explicit: boolean;
}

async function createJobFromRequest(
  context: CommandContext,
  request: JobRequest,
): Promise<CommandReply> {
  const machines = await context.repo.listMachines();
  if (machines.length === 0) {
    return {
      text: renderError(
        'no hay ninguna maquina registrada',
        'ejecuta npm run setup:machine en el ordenador que quieras usar',
      ),
    };
  }

  const preferredMachineId = await context.repo.getUserPreference(context.userId);
  const now = new Date();
  const offlineAfter = context.config.MACHINE_OFFLINE_SECONDS;

  // maquinas que tienen el proyecto: de ahi salen los proveedores posibles
  const withProject = machines.filter((machine) => machine.projects.includes(request.projectAlias));
  if (withProject.length === 0) {
    return {
      text: renderError(
        `ninguna maquina tiene configurado el proyecto "${request.projectAlias}"`,
        'usa /projects para ver los alias disponibles',
      ),
    };
  }

  // el router necesita saber que proveedores hay realmente instalados
  const onlineWithProject = withProject.filter((machine) =>
    isMachineOnline(machine, now, offlineAfter),
  );
  const routingBase = onlineWithProject.length > 0 ? onlineWithProject : withProject;
  const availableProviders = collectProviders(routingBase);

  if (availableProviders.length === 0) {
    return {
      text: renderError(
        'ninguna maquina compatible tiene proveedores disponibles',
        'comprueba que Claude Code o Codex estan instalados y autenticados',
      ),
    };
  }

  // decision del proveedor: explicita o mediante el router determinista
  let provider: ProviderId;
  let routerReason: string | null = null;
  let substitution: { requested: ProviderId; chosen: ProviderId } | null = null;
  if (request.provider && request.explicit) {
    const decision = routeProvider({
      prompt: request.prompt,
      availableProviders,
      explicitProvider: request.provider,
    });
    provider = decision.provider;
    // solo se explica el motivo si luxy tuvo que cambiar de proveedor
    routerReason = decision.provider === request.provider ? null : decision.reason;
    // pediste un modelo concreto: si no se usa ese, hay que decirlo antes de
    // ejecutar nada, no esconderlo en el motivo del router
    if (decision.provider !== request.provider) {
      substitution = { requested: request.provider, chosen: decision.provider };
    }
  } else {
    const decision = routeProvider({ prompt: request.prompt, availableProviders });
    provider = decision.provider;
    routerReason = decision.reason;
  }

  const selection = selectMachine({
    machines,
    provider,
    projectAlias: request.projectAlias,
    preferredMachineId,
    now,
    offlineAfterSeconds: offlineAfter,
  });

  if (selection.kind === 'unavailable') {
    return { text: renderError(selection.reason) };
  }

  // varias maquinas conectadas y ninguna preferida: se pregunta con botones
  if (selection.kind === 'needs_choice') {
    const job = await context.repo.createJob({
      telegramChatId: context.chatId,
      telegramUserId: context.userId,
      targetMachineId: null,
      provider,
      projectAlias: request.projectAlias,
      prompt: request.prompt,
      // no entra en la cola hasta que el usuario elija maquina
      status: 'waiting_for_machine',
      metadata: buildMetadata(context, routerReason, request.explicit, request.model ?? null),
    });
    return {
      text: [
        renderJobCreated({
          shortId: job.shortId,
          machineName: null,
          projectAlias: job.projectAlias,
          provider,
          status: 'waiting_for_machine',
          routerReason,
        }),
        '',
        'Hay varias maquinas conectadas. Elige una:',
      ].join('\n'),
      keyboard: buildMachineChoiceKeyboard(selection.candidates, job.shortId),
    };
  }

  const targetMachine = selection.kind === 'selected' ? selection.machine : null;
  const job = await context.repo.createJob({
    telegramChatId: context.chatId,
    telegramUserId: context.userId,
    targetMachineId: targetMachine?.id ?? null,
    provider,
    projectAlias: request.projectAlias,
    prompt: request.prompt,
    status: 'queued',
    metadata: buildMetadata(context, routerReason, request.explicit, request.model ?? null),
  });

  const text = renderJobCreated({
    shortId: job.shortId,
    machineName: targetMachine?.name ?? null,
    projectAlias: job.projectAlias,
    provider,
    status: 'queued',
    routerReason,
  });

  // pediste un modelo concreto y se va a usar otro: se dice ANTES del resto,
  // no escondido en el motivo del router
  const aviso =
    substitution === null
      ? ''
      : [
          `Pediste ${PROVIDER_LABELS[substitution.requested]}, pero ninguna maquina conectada lo ofrece.`,
          `Luxy usara ${PROVIDER_LABELS[substitution.chosen]} en su lugar.`,
          'Si esa maquina tiene la conexion configurada, comprueba que su agente este arrancado:',
          'las capacidades se anuncian en cada latido.',
          '',
          '',
        ].join('\n');

  const base = selection.kind === 'queued' ? `${text}\n\n${selection.reason}` : text;
  return { text: aviso + base };
}

function buildMetadata(
  context: CommandContext,
  routerReason: string | null,
  explicit: boolean,
  model: string | null,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { providerExplicit: explicit };
  // el agente lee metadata.model para saber que modelo concreto ejecutar
  if (model !== null) metadata.model = model;
  if (routerReason) metadata.routerReason = routerReason;
  // el texto citado se guarda marcado, para que el agente lo trate como dato
  if (context.quotedText) metadata.quotedText = context.quotedText.slice(0, 4000);
  return metadata;
}

/** union de los proveedores disponibles en un conjunto de maquinas */
function collectProviders(machines: Machine[]): ProviderId[] {
  // la lista sale de PROVIDER_IDS, no escrita a mano: con cinco valores fijos,
  // las familias nuevas (kimi, kat, minimax, step) no se ofrecian nunca
  return PROVIDER_IDS.filter((provider) =>
    machines.some((machine) => machineSupportsProvider(machine, provider)),
  );
}

// -----------------------------------------------------------------------------
// menciones naturales
// -----------------------------------------------------------------------------

async function handleNaturalMention(
  context: CommandContext,
  text: string,
): Promise<CommandReply | null> {
  if (text.trim().length === 0) return { text: HELP_TEXT };

  const machines = await context.repo.listMachines();
  const aliases = [...new Set(machines.flatMap((machine) => machine.projects))];
  const parsed = parseNaturalMention(text, aliases);

  if (!parsed.projectAlias) {
    return {
      text: renderError(
        'no he identificado el proyecto',
        `alias disponibles: ${aliases.join(', ') || 'ninguno'}`,
      ),
    };
  }
  if (parsed.prompt.length > MAX_PROMPT_LENGTH) {
    return { text: renderError('el mensaje es demasiado largo') };
  }

  return createJobFromRequest(context, {
    provider: parsed.provider,
    projectAlias: parsed.projectAlias,
    prompt: parsed.prompt,
    explicit: parsed.provider !== null,
  });
}

// -----------------------------------------------------------------------------
// /cancel, /job, /logs
// -----------------------------------------------------------------------------

async function handleCancel(
  context: CommandContext,
  argument: string | null,
): Promise<CommandReply> {
  let job: Job | null = null;

  if (argument) {
    job = await context.repo.getJobByShortId(normalizeShortId(argument));
    if (!job) return { text: renderError(`no encuentro el trabajo ${argument}`) };
  } else {
    // sin id: se cancela el trabajo activo de la maquina seleccionada
    const preferredId = await context.repo.getUserPreference(context.userId);
    const active = await context.repo.listActiveJobs();
    const mine = active.filter((item) => item.telegramUserId === context.userId);
    job = preferredId ? (mine.find((item) => item.claimedBy === preferredId) ?? mine[0] ?? null) : (mine[0] ?? null);
    if (!job) return { text: 'No hay ningun trabajo activo que cancelar.' };
  }

  const status = await context.repo.requestCancel(job.id);
  if (status === null) {
    return { text: `El trabajo ${job.shortId} ya habia terminado (${STATUS_LABELS[job.status]}).` };
  }

  return {
    text: [
      `Cancelacion solicitada para ${job.shortId}.`,
      '',
      status === 'cancelled'
        ? 'El trabajo aun no habia empezado y se ha cancelado directamente.'
        : 'La maquina detendra el proceso en unos segundos. Los cambios del worktree se conservan.',
    ].join('\n'),
  };
}

async function handleJobDetail(
  context: CommandContext,
  argument: string | null,
): Promise<CommandReply> {
  if (!argument) return { text: renderError('falta el id', 'formato: /job LUX-4F82') };
  const job = await context.repo.getJobByShortId(normalizeShortId(argument));
  if (!job) return { text: renderError(`no encuentro el trabajo ${argument}`) };

  const machine = job.claimedBy ? await context.repo.getMachineById(job.claimedBy) : null;
  const lines = [
    `Trabajo ${job.shortId}`,
    '',
    `Estado: ${STATUS_LABELS[job.status]}`,
    `Maquina: ${machine?.name ?? 'sin asignar'}`,
    `Proyecto: ${job.projectAlias}`,
    `Agente: ${PROVIDER_LABELS[job.provider]}`,
    `Creado: ${job.createdAt}`,
  ];
  if (job.metadata.branch) lines.push(`Rama: ${job.metadata.branch}`);
  if (typeof job.metadata.filesChanged === 'number') {
    lines.push(`Archivos modificados: ${job.metadata.filesChanged}`);
  }
  if (job.resultSummary) lines.push('', 'Resumen:', job.resultSummary);
  if (job.errorMessage) lines.push('', 'Error:', job.errorMessage);
  return { text: lines.join('\n') };
}

async function handleLogs(
  context: CommandContext,
  argument: string | null,
): Promise<CommandReply> {
  if (!argument) return { text: renderError('falta el id', 'formato: /logs LUX-4F82') };
  const job = await context.repo.getJobByShortId(normalizeShortId(argument));
  if (!job) return { text: renderError(`no encuentro el trabajo ${argument}`) };

  const events = await context.repo.listEvents(job.id, 40);
  if (events.length === 0) return { text: `El trabajo ${job.shortId} no tiene eventos todavia.` };

  const body = events
    .slice()
    .reverse()
    .map((event) => `[${event.type}] ${event.message}`)
    .join('\n');

  // los logs siempre superan el limite: se envian troceados como bloques
  const blocks = splitAsCodeBlocks(body);
  return { text: `Eventos de ${job.shortId}\n\n${blocks[0] ?? ''}` };
}

export { HELP_TEXT };
