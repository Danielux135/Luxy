// punto de entrada del worker: pasarela publica de Luxy
import { loadConfig, EnvError, type Env } from './env.js';
import { Logger, describeError } from './logger.js';
import { SupabaseClient } from './supabase.js';
import { Repository } from './repository.js';
import { TelegramClient } from './telegram.js';
import { Router } from './router.js';
import { handleWebhook, type WebhookDeps } from './handlers/webhook.js';
import {
  handlePairStart,
  handlePairClaim,
  handlePairConfirm,
  handleListDevices,
  handleUpdateAccess,
  handleRevokeDevice,
} from './handlers/remote.js';
import { RemoteRepository } from './remote-repository.js';
import {
  handleRegister,
  handleHeartbeat,
  handleClaim,
  handleJobControl,
  handleJobEvents,
  handleJobComplete,
  handleJobFail,
  handleJobCancelled,
  handleApprovalResolve,
  handleApprovalsPending,
  handleJobAttachment,
  json,
  errorResponse,
  type ApiDeps,
} from './handlers/api.js';

type Deps = ApiDeps & WebhookDeps;

// las rutas se declaran una sola vez y se reutilizan entre peticiones
const router = new Router<Deps>()
  .post('/telegram/webhook', (request, deps) => handleWebhook(request, deps))
  .post('/api/machines/register', (request, deps) => handleRegister(request, deps))
  .post('/api/machines/heartbeat', (request, deps, params) => handleHeartbeat(request, deps, params))
  .post('/api/jobs/claim', (request, deps, params) => handleClaim(request, deps, params))
  .get('/api/jobs/:jobId/control', (request, deps, params) => handleJobControl(request, deps, params))
  .post('/api/jobs/:jobId/events', (request, deps, params) => handleJobEvents(request, deps, params))
  .post('/api/jobs/:jobId/complete', (request, deps, params) =>
    handleJobComplete(request, deps, params),
  )
  .post('/api/jobs/:jobId/fail', (request, deps, params) => handleJobFail(request, deps, params))
  .post('/api/jobs/:jobId/cancelled', (request, deps, params) =>
    handleJobCancelled(request, deps, params),
  )
  .get('/api/jobs/:jobId/attachment', (request, deps, params) =>
    handleJobAttachment(request, deps, params),
  )
  // -------------------------------------------------------------------------
  // control remoto
  //
  // pair/start y pair/claim NO llevan autenticacion de dispositivo: son los
  // pasos en los que todavia no hay emparejamiento. Su proteccion es el codigo,
  // que caduca en tres minutos, es de un solo uso y hay que firmar para
  // reclamarlo.
  // -------------------------------------------------------------------------
  .post('/api/remote/pair/start', (request, deps) => handlePairStart(request, deps))
  .post('/api/remote/pair/claim', (request, deps) => handlePairClaim(request, deps))
  .post('/api/remote/pair/confirm', (request, deps) => handlePairConfirm(request, deps))
  .get('/api/remote/devices', (request, deps, params) => handleListDevices(request, deps, params))
  .post('/api/remote/devices/:deviceId/access', (request, deps, params) =>
    handleUpdateAccess(request, deps, params),
  )
  .post('/api/remote/devices/:deviceId/revoke', (request, deps, params) =>
    handleRevokeDevice(request, deps, params),
  )
  .get('/api/approvals/pending', (request, deps) => handleApprovalsPending(request, deps, {}))
  .post('/api/approvals/:approvalId/resolve', (request, deps, params) =>
    handleApprovalResolve(request, deps, params),
  );

/** construye las dependencias de una peticion */
function buildDeps(env: Env, requestId: string): Deps {
  const config = loadConfig(env);
  const logger = new Logger(config.LOG_LEVEL, { requestId });
  const db = new SupabaseClient(config);
  return {
    config,
    db,
    repo: new Repository(db),
    remote: new RemoteRepository(db),
    telegram: new TelegramClient(config.TELEGRAM_BOT_TOKEN),
    logger,
  };
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // /health no necesita configuracion completa: sirve para comprobar el despliegue
    if (url.pathname === '/health' && request.method === 'GET') {
      const configured = Boolean(env.SUPABASE_URL && env.TELEGRAM_BOT_TOKEN);
      return json({
        service: 'luxy-gateway',
        status: 'ok',
        configured,
        time: new Date().toISOString(),
      });
    }

    const requestId = crypto.randomUUID();
    let deps: Deps;
    try {
      deps = buildDeps(env, requestId);
    } catch (error) {
      if (error instanceof EnvError) {
        // el mensaje explica que secreto falta, sin revelar ningun valor
        console.log(JSON.stringify({ level: 'error', msg: error.message, requestId }));
        return errorResponse(error.message, 500);
      }
      return errorResponse('error interno de configuracion', 500);
    }

    try {
      const response = await router.handle(request, deps);
      if (response) return response;
      return errorResponse('ruta no encontrada', 404);
    } catch (error) {
      const described = describeError(error);
      deps.logger.error('error no controlado', described);
      // nunca se devuelve la traza al cliente
      return errorResponse('error interno', 500);
    }
  },

  /**
   * cron: barrido de leases caducados.
   * los trabajos que ya habian empezado se marcan como interrumpidos y NO se
   * reasignan solos, porque la maquina pudo dejar cambios sin guardar.
   */
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    let deps: Deps;
    try {
      deps = buildDeps(env, crypto.randomUUID());
    } catch (error) {
      console.log(JSON.stringify({ level: 'error', msg: 'cron sin configuracion valida' }));
      void error;
      return;
    }

    try {
      const result = await deps.repo.expireLeases();
      if (result.requeued > 0 || result.interrupted > 0) {
        deps.logger.info('barrido de leases', result);
      }
    } catch (error) {
      deps.logger.error('fallo el barrido de leases', describeError(error));
    }
  },
};
