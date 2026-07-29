// contrato de eventos del runtime del agente.
//
// lo consumen tres procesos distintos: el agente (que los emite), el proceso
// principal de Electron (que los reenvia) y el renderer (que los pinta). por eso
// vive en shared y no depende de node: cruza fronteras de proceso y se valida
// con zod en cada salto, igual que la entrada de telegram.
import { z } from 'zod';
import { providerIdSchema } from './schemas.js';

/** estado del ciclo de vida del host, independiente del estado del agente */
export const AGENT_RUN_STATES = ['stopped', 'starting', 'running', 'stopping'] as const;
export type AgentRunState = (typeof AGENT_RUN_STATES)[number];
export const agentRunStateSchema = z.enum(AGENT_RUN_STATES);

export const agentStatusSchema = z.object({
  machineName: z.string(),
  gatewayConnected: z.boolean(),
  lastHeartbeatAt: z.string().nullable(),
  activeJob: z
    .object({
      shortId: z.string(),
      provider: providerIdSchema,
      projectAlias: z.string(),
      startedAt: z.string(),
    })
    .nullable(),
  projects: z.array(z.string()),
  providers: z.array(z.string()),
  pendingEvents: z.number().int().nonnegative(),
  startedAt: z.string(),
});

export type AgentStatus = z.infer<typeof agentStatusSchema>;

/** estado que expone el host: envuelve al del agente y añade el ciclo de vida */
export const agentHostStatusSchema = z.object({
  runState: agentRunStateSchema,
  /** null mientras el agente no ha llegado a arrancar */
  agent: agentStatusSchema.nullable(),
  /** ultimo error de arranque o de ejecucion, ya redactado */
  lastError: z.string().nullable(),
});

export type AgentHostStatus = z.infer<typeof agentHostStatusSchema>;

const base = { at: z.string() };
const jobBase = {
  ...base,
  jobId: z.string(),
  shortId: z.string(),
};

/**
 * eventos del agente.
 *
 * los de herramienta y aprobacion forman parte del contrato desde el principio
 * para que el resto del sistema se escriba contra el, pero todavia no tienen
 * emisor: llegan con el ejecutor de herramientas y con las aprobaciones locales.
 */
export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('agent.started'), ...base }),
  z.object({ type: z.literal('agent.stopped'), ...base, reason: z.string() }),
  z.object({ type: z.literal('agent.error'), ...base, message: z.string() }),

  z.object({ type: z.literal('gateway.connected'), ...base }),
  z.object({ type: z.literal('gateway.disconnected'), ...base, message: z.string().nullable() }),
  z.object({ type: z.literal('heartbeat.updated'), ...base }),

  z.object({
    type: z.literal('job.claimed'),
    ...jobBase,
    provider: providerIdSchema,
    projectAlias: z.string(),
  }),
  z.object({ type: z.literal('job.phase'), ...jobBase, message: z.string() }),
  z.object({ type: z.literal('job.output'), ...jobBase, message: z.string() }),
  z.object({ type: z.literal('job.tests'), ...jobBase, message: z.string() }),
  z.object({ type: z.literal('job.warning'), ...jobBase, message: z.string() }),
  z.object({
    type: z.literal('job.completed'),
    ...jobBase,
    summary: z.string(),
    filesChanged: z.number().int().nonnegative(),
    testsPassed: z.number().int().nonnegative(),
    testsFailed: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    /** hacen falta para poder aprobar el commit o el push desde el escritorio */
    worktreePath: z.string().nullable(),
    branch: z.string().nullable(),
    projectAlias: z.string(),
  }),
  z.object({
    type: z.literal('job.failed'),
    ...jobBase,
    errorMessage: z.string(),
    worktreePath: z.string().nullable(),
  }),
  z.object({
    type: z.literal('job.cancelled'),
    ...jobBase,
    modifiedFiles: z.number().int().nonnegative(),
    worktreePath: z.string().nullable(),
  }),

  // ---- emisor pendiente: ejecutor de herramientas ----
  z.object({
    type: z.literal('job.tool.requested'),
    ...jobBase,
    tool: z.string(),
    step: z.number().int().nonnegative(),
    /** argumentos ya redactados y recortados, solo para mostrar */
    detail: z.string(),
  }),
  z.object({
    type: z.literal('job.tool.completed'),
    ...jobBase,
    tool: z.string(),
    step: z.number().int().nonnegative(),
    ok: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    detail: z.string(),
  }),

  // ---- emisor pendiente: aprobaciones locales ----
  z.object({
    type: z.literal('approval.pending'),
    ...jobBase,
    approvalId: z.string(),
    action: z.enum(['commit', 'discard', 'push']),
  }),

  z.object({
    type: z.literal('approval.resolved'),
    ...jobBase,
    action: z.enum(['commit', 'discard', 'push']),
    ok: z.boolean(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('log.appended'),
    ...base,
    level: z.enum(['debug', 'info', 'warn', 'error']),
    line: z.string(),
  }),
  z.object({ type: z.literal('status.updated'), ...base, status: agentHostStatusSchema }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentEventType = AgentEvent['type'];

/** receptor de eventos del agente. sincrono y que nunca debe lanzar */
export type AgentEventSink = (event: AgentEvent) => void;
