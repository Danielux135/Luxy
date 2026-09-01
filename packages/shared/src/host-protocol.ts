// protocolo entre el proceso principal de Electron y el proceso del agente.
//
// el agente corre en un utilityProcess aparte, no dentro del main. razones:
// resolve-executable necesita un node.exe real, agent.start() gira bucles
// propios que no deben competir con la UI, y una excepcion del agente no puede
// llevarse por delante la ventana ni la bandeja.
//
// todo mensaje se valida con zod en ambos extremos: el borde entre procesos se
// trata igual que la entrada de telegram.
import { z } from 'zod';
import { agentEventSchema, agentHostStatusSchema } from './agent-events.js';

/** mensajes del proceso principal hacia el agente */
export const hostRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), requestId: z.string() }),
  z.object({ type: z.literal('stop'), requestId: z.string(), reason: z.string().max(200) }),
  z.object({ type: z.literal('restart'), requestId: z.string() }),
  z.object({ type: z.literal('status'), requestId: z.string() }),
  z.object({
    type: z.literal('prepare_worktree'),
    requestId: z.string(),
    projectAlias: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(120),
  }),
  z.object({
    type: z.literal('configure'),
    requestId: z.string(),
    /** se valida con agentConfigSchema en el hijo; null = sin configurar */
    config: z.unknown(),
    /**
     * claves de API en claro. viajan solo por memoria entre dos procesos de
     * Luxy y NUNCA se escriben en un log ni se devuelven al renderer.
     */
    providerKeys: z.record(z.string().max(64), z.string().max(512)).default({}),
  }),
  z.object({
    type: z.literal('approval'),
    requestId: z.string(),
    /**
     * aprobacion pedida desde la interfaz de escritorio.
     *
     * el agente NO se fia de esto: vuelve a comprobar allowCommit, allowPush y
     * la doble confirmacion, y confina la ruta del worktree. Que la interfaz lo
     * pida no significa que se pueda hacer.
     */
    approval: z.object({
      jobId: z.string().max(64),
      shortId: z.string().max(32),
      action: z.enum(['commit', 'discard', 'push']),
      projectAlias: z.string().max(64),
      worktreePath: z.string().max(1024),
      branch: z.string().max(256),
      message: z.string().max(500).nullable().default(null),
      confirmedTwice: z.boolean().default(false),
    }),
  }),
  /**
   * ejecuta un turno de conversacion privada en esta maquina.
   *
   * Es el UNICO camino de trabajo que no pasa por la cola de Supabase, y existe
   * exactamente por eso: un turno privado no puede encolarse en un servidor que
   * no debe poder leerlo. El prompt viaja por memoria entre dos procesos de
   * Luxy, igual que ya hacen las claves de API en 'configure'.
   *
   * A cambio se pierde lo que da la cola: no hay lease, no hay reintento tras
   * un corte y no hay historial en el servidor. Si Luxy se cierra a media
   * respuesta, esa respuesta se pierde. Es el precio de que nadie mas la vea.
   */
  z.object({
    type: z.literal('run_local_turn'),
    requestId: z.string(),
    /** identificador local; NO es un id de trabajo del gateway */
    localTurnId: z.string().uuid(),
    provider: z.string().min(1).max(64),
    model: z.string().max(128).nullable().default(null),
    projectAlias: z.string().min(1).max(64),
    /** texto en claro. no se escribe en ningun log ni se devuelve al gateway */
    prompt: z.string().min(1).max(2_000_000),
  }),
  z.object({
    type: z.literal('cancel_local_turn'),
    requestId: z.string(),
    localTurnId: z.string().uuid(),
  }),
  z.object({ type: z.literal('shutdown'), requestId: z.string() }),
]);

export type HostRequest = z.infer<typeof hostRequestSchema>;

/** mensajes del agente hacia el proceso principal */
export const hostResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    /**
     * huella del bundle del agente.
     *
     * existe porque una vez se regenero el instalador y no se reinstalo: la
     * aplicacion seguia ejecutando el agente antiguo y el fallo "arreglado"
     * reaparecia identico. Con esto se ve de un vistazo que build corre.
     */
    build: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal('ack'),
    requestId: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    status: agentHostStatusSchema.nullable(),
    workspace: z
      .object({
        projectAlias: z.string().min(1).max(64),
        path: z.string().min(1).max(1024),
        branch: z.string().min(1).max(256),
      })
      .nullable()
      .default(null),
  }),
  z.object({ type: z.literal('event'), event: agentEventSchema }),
  /**
   * resultado de un turno privado.
   *
   * viaja aparte de 'ack' porque lleva el TEXTO de la respuesta, que en el
   * camino normal nunca sale del agente sin pasar por el gateway. Aqui es al
   * reves: es lo unico que debe llegar al proceso principal, y solo a el.
   */
  z.object({
    type: z.literal('local_turn'),
    requestId: z.string(),
    localTurnId: z.string(),
    outcome: z.enum(['completed', 'failed', 'cancelled']),
    text: z.string(),
    error: z.string().nullable(),
    executedModel: z.string().nullable(),
    durationMs: z.number().int().min(0),
    inputTokens: z.number().int().min(0).nullable(),
    outputTokens: z.number().int().min(0).nullable(),
  }),
]);

export type HostResponse = z.infer<typeof hostResponseSchema>;
