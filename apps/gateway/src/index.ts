// punto de entrada del worker: pasarela publica de Luxy
import { loadConfig, EnvError, type Env } from './env.js';
import { Logger, describeError } from './logger.js';
import { SupabaseClient, SupabaseError } from './supabase.js';
import { Repository } from './repository.js';
import { TelegramClient } from './telegram.js';
import { Router } from './router.js';
import { handleWebhook, type WebhookDeps } from './handlers/webhook.js';
import {
  handlePairStart,
  handlePairClaim,
  handlePairConfirm,
  handlePairState,
  handleListDevices,
  handleUpdateAccess,
  handleRevokeDevice,
} from './handlers/remote.js';
import { RemoteRepository } from './remote-repository.js';
import { VaultObjectStore } from './object-store.js';
import {
  handleRegister,
  handleHeartbeat,
  handleClaim,
  handleJobControl,
  handleJobEvents,
  handleJobComplete,
  handleJobFail,
  handleJobCancelled,
  handleApprovalComplete,
  handleApprovalResolve,
  handleApprovalsPending,
  handleJobAttachment,
  json,
  errorResponse,
  type ApiDeps,
} from './handlers/api.js';
import {
  handleStudioJobCancel,
  handleStudioJobAction,
  handleStudioJobCreate,
  handleStudioJobDetail,
  handleStudioJobFeedback,
  handleStudioJobs,
  handleStudioOptions,
} from './handlers/studio.js';
import {
  handleVaultChangePassword,
  handleVaultConversations,
  handleVaultDelete,
  handleVaultLoginFinish,
  handleVaultLoginStart,
  handleVaultLogout,
  handleVaultMediaDownload,
  handleVaultMediaList,
  handleVaultMediaPush,
  handleVaultMediaUpload,
  handleVaultPull,
  handleVaultPush,
  handleVaultRegister,
} from './handlers/vault.js';
import { redact } from '@luxy/shared';

type Deps = ApiDeps & WebhookDeps;

/** host del proyecto de Supabase, para saber contra cual se hablo de verdad */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'url invalida';
  }
}

// las rutas se declaran una sola vez y se reutilizan entre peticiones
const router = new Router<Deps>()
  .post('/telegram/webhook', (request, deps) => handleWebhook(request, deps))
  .post('/api/machines/register', (request, deps) => handleRegister(request, deps))
  .post('/api/machines/heartbeat', (request, deps, params) =>
    handleHeartbeat(request, deps, params),
  )
  .post('/api/jobs/claim', (request, deps, params) => handleClaim(request, deps, params))
  .get('/api/jobs/:jobId/control', (request, deps, params) =>
    handleJobControl(request, deps, params),
  )
  .post('/api/jobs/:jobId/events', (request, deps, params) =>
    handleJobEvents(request, deps, params),
  )
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
  .get('/api/studio/options', (request, deps, params) => handleStudioOptions(request, deps, params))
  .post('/api/studio/jobs', (request, deps, params) => handleStudioJobCreate(request, deps, params))
  .get('/api/studio/jobs', (request, deps, params) => handleStudioJobs(request, deps, params))
  .get('/api/studio/jobs/:jobId', (request, deps, params) =>
    handleStudioJobDetail(request, deps, params),
  )
  .post('/api/studio/jobs/:jobId/cancel', (request, deps, params) =>
    handleStudioJobCancel(request, deps, params),
  )
  .post('/api/studio/jobs/:jobId/feedback', (request, deps, params) =>
    handleStudioJobFeedback(request, deps, params),
  )
  // cuentas de boveda: registro y login no exigen sesion previa
  .post('/api/vault/register', (request, deps) => handleVaultRegister(request, deps))
  .post('/api/vault/login/start', (request, deps) => handleVaultLoginStart(request, deps))
  .post('/api/vault/login/finish', (request, deps) => handleVaultLoginFinish(request, deps))
  .post('/api/vault/logout', (request, deps, params) => handleVaultLogout(request, deps, params))
  .post('/api/vault/password', (request, deps, params) =>
    handleVaultChangePassword(request, deps, params),
  )
  // sincronizacion: autorizada por sesion de usuario
  .post('/api/vault/records', (request, deps, params) => handleVaultPush(request, deps, params))
  .get('/api/vault/conversations', (request, deps, params) =>
    handleVaultConversations(request, deps, params),
  )
  .get('/api/vault/conversations/:conversationId', (request, deps, params) =>
    handleVaultPull(request, deps, params),
  )
  .get('/api/vault/media', (request, deps, params) =>
    handleVaultMediaList(request, deps, params),
  )
  .post('/api/vault/media', (request, deps, params) =>
    handleVaultMediaPush(request, deps, params),
  )
  .put('/api/vault/media/objects/:objectKey', (request, deps, params) =>
    handleVaultMediaUpload(request, deps, params),
  )
  .get('/api/vault/media/objects/:objectKey', (request, deps, params) =>
    handleVaultMediaDownload(request, deps, params),
  )
  .post('/api/vault/conversations/:conversationId/delete', (request, deps, params) =>
    handleVaultDelete(request, deps, params),
  )
  .post('/api/studio/jobs/:jobId/action', (request, deps, params) =>
    handleStudioJobAction(request, deps, params),
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
  .get('/api/remote/pair/:code/state', (request, deps, params) =>
    handlePairState(request, deps, params),
  )
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
  )
  .post('/api/approvals/:approvalId/complete', (request, deps, params) =>
    handleApprovalComplete(request, deps, params),
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
    objects: new VaultObjectStore(config),
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
      // el detalle de Supabase dice QUE columna o filtro sobra; sin el, un 400
      // solo decia «supabase respondio 400» y habia que adivinar. Va al log del
      // Worker, redactado, y NUNCA al cliente.
      const detalle =
        error instanceof SupabaseError
          ? {
              supabaseStatus: error.status,
              supabaseDetails: redact(error.details).slice(0, 500),
              // CONTRA QUE proyecto se hablo. Es el host, no la clave: sin esto
              // no habia forma de distinguir «la columna no existe» de «no es
              // la base que yo creia».
              supabaseHost: safeHost(deps.config.SUPABASE_URL),
            }
          : {};
      deps.logger.error('error no controlado', { ...described, ...detalle });
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
