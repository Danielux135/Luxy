// punto de entrada del agente cuando lo lanza Luxy Desktop.
//
// a diferencia de index.ts (la CLI), aqui NO hay process.exit, ni handlers de
// señales, ni banner por consola: el ciclo de vida lo manda el proceso
// principal de Electron por mensajes.
//
// se comunica por process.parentPort (utilityProcess de Electron). si no hay
// parentPort, el modulo no hace nada: asi importarlo desde un test es inocuo.
import { agentConfigSchema, hostRequestSchema } from '@luxy/shared';
import type { AgentConfig, HostRequest, HostResponse } from '@luxy/shared';
import { AgentHost } from './host.js';
import { AgentLogger, describeError } from '../logger.js';
import { logsDir, stateDir, worktreesDir } from '../paths.js';

/**
 * puerto hacia el proceso padre. Electron lo inyecta en utilityProcess; los
 * tipos de node no lo conocen, por eso la comprobacion es en tiempo de
 * ejecucion y no un cast a ciegas.
 */
interface ParentPort {
  on(event: 'message', listener: (message: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start?(): void;
}

function getParentPort(): ParentPort | null {
  const candidate = (process as unknown as { parentPort?: unknown }).parentPort;
  if (candidate === undefined || candidate === null) return null;
  const port = candidate as ParentPort;
  return typeof port.postMessage === 'function' && typeof port.on === 'function' ? port : null;
}

export function startHostEntry(port: ParentPort): void {
  // sin consola: en Electron no hay stdout util y los logs ya van al archivo
  const logger = new AgentLogger('info', logsDir(), false);

  const host = new AgentHost({
    logger,
    config: null,
    stateDirectory: stateDir(),
    worktreesDirectory: worktreesDir(),
  });

  const send = (message: HostResponse): void => {
    try {
      port.postMessage(message);
    } catch (error) {
      // el padre puede haberse cerrado; no hay nada que hacer ni a quien avisar
      logger.debug('no se pudo enviar un mensaje al proceso principal', describeError(error));
    }
  };

  host.subscribe((event) => send({ type: 'event', event }));

  const ack = (requestId: string, ok: boolean, error: string | null): void => {
    send({ type: 'ack', requestId, ok, error, status: host.getStatus() });
  };

  const handle = async (request: HostRequest): Promise<void> => {
    switch (request.type) {
      case 'start':
        await host.start();
        ack(request.requestId, true, null);
        break;
      case 'stop':
        await host.stop(request.reason);
        ack(request.requestId, true, null);
        break;
      case 'restart':
        await host.restart();
        ack(request.requestId, true, null);
        break;
      case 'status':
        ack(request.requestId, true, null);
        break;
      case 'configure': {
        // la configuracion viene del proceso principal, pero se valida igual:
        // un borde entre procesos es una entrada externa
        let config: AgentConfig | null = null;
        if (request.config !== null && request.config !== undefined) {
          config = agentConfigSchema.parse(request.config);
        }
        host.updateConfig(config, request.providerKeys);
        ack(request.requestId, true, null);
        break;
      }
      case 'shutdown':
        await host.stop('cierre de Luxy');
        ack(request.requestId, true, null);
        break;
    }
  };

  port.on('message', (message) => {
    const parsed = hostRequestSchema.safeParse(message.data);
    if (!parsed.success) {
      logger.warn('mensaje descartado por no cumplir el protocolo del host');
      return;
    }
    void handle(parsed.data).catch((error) => {
      const described = describeError(error);
      logger.error('fallo atendiendo una orden del proceso principal', described);
      ack(parsed.data.requestId, false, described.message);
    });
  });

  port.start?.();
  send({ type: 'ready' });
}

const parentPort = getParentPort();
if (parentPort !== null) startHostEntry(parentPort);
