// interfaz local minima y opcional.
//
// escucha SOLO en 127.0.0.1: no es accesible desde la red local.
// el agente funciona completamente sin abrirla.
import { createServer, type Server } from 'node:http';
import type { AgentStatus } from '@luxy/shared';
import type { AgentLogger } from './logger.js';
import { formatDuration } from '@luxy/shared';

/**
 * lo unico que necesita la interfaz local. depender de la clase concreta
 * impedia reutilizar este servidor desde el host, y no aportaba nada.
 */
export interface StatusSource {
  getStatus(): AgentStatus | null;
}

export interface UiServerOptions {
  host: '127.0.0.1';
  port: number;
  agent: StatusSource;
  logger: AgentLogger;
  /** se invoca cuando se pulsa el boton de detener */
  onStopRequested: () => void;
}

/** pagina html autocontenida: sin recursos externos ni dependencias */
function renderPage(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Luxy</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #0f1115; color: #e6e6e6;
         font-family: Consolas, Menlo, monospace; font-size: 14px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8a8f98; margin-bottom: 20px; }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .card { background: #171a21; border: 1px solid #262b36; border-radius: 8px; padding: 14px; }
  .label { color: #8a8f98; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  .value { font-size: 16px; margin-top: 6px; word-break: break-word; }
  .ok { color: #4ade80; } .bad { color: #f87171; } .warn { color: #fbbf24; }
  pre { background: #0b0d11; border: 1px solid #262b36; border-radius: 8px;
        padding: 12px; overflow: auto; max-height: 320px; font-size: 12px; }
  button { background: #b91c1c; color: #fff; border: 0; border-radius: 6px;
           padding: 10px 16px; font: inherit; cursor: pointer; margin-top: 16px; }
  button:hover { background: #dc2626; }
</style>
</head>
<body>
  <h1>Luxy</h1>
  <div class="sub" id="machine">cargando...</div>
  <div class="grid" id="cards"></div>
  <h2 style="font-size:15px;margin:24px 0 8px">Logs recientes</h2>
  <pre id="logs">cargando...</pre>
  <button id="stop">Detener Luxy</button>

<script>
// la interfaz solo lee estado: no envia ordenes a ningun modelo
function card(label, value, cls) {
  return '<div class="card"><div class="label">' + label + '</div>' +
         '<div class="value ' + (cls || '') + '">' + value + '</div></div>';
}
function esc(text) {
  return String(text).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}
async function refresh() {
  try {
    const status = await (await fetch('/api/status')).json();
    document.getElementById('machine').textContent =
      'Maquina: ' + status.machineName + ' - iniciada ' + status.startedAt;

    const job = status.activeJob
      ? status.activeJob.shortId + ' (' + status.activeJob.provider + ')'
      : 'ninguno';

    document.getElementById('cards').innerHTML = [
      card('Gateway', status.gatewayConnected ? 'conectado' : 'sin conexion',
           status.gatewayConnected ? 'ok' : 'bad'),
      card('Ultimo heartbeat', status.lastHeartbeatAgo || 'nunca'),
      card('Trabajo activo', esc(job), status.activeJob ? 'warn' : ''),
      card('Proveedor en uso', status.activeJob ? esc(status.activeJob.provider) : '-'),
      card('Proyectos', esc(status.projects.join(', ') || 'ninguno')),
      card('Proveedores', esc(status.providers.join(', ') || 'ninguno')),
      card('Eventos pendientes', status.pendingEvents,
           status.pendingEvents > 0 ? 'warn' : 'ok'),
      card('Consumo de APIs', esc(status.usageSummary || 'sin consumo registrado'))
    ].join('');

    const logs = await (await fetch('/api/logs')).json();
    document.getElementById('logs').textContent = logs.lines.join('\\n') || 'sin logs';
  } catch (error) {
    document.getElementById('machine').textContent = 'Luxy no responde';
  }
}
document.getElementById('stop').addEventListener('click', async function () {
  if (!confirm('Detener Luxy en este ordenador?')) return;
  await fetch('/api/stop', { method: 'POST' });
  document.getElementById('machine').textContent = 'Deteniendo Luxy...';
});
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}

/** arranca la interfaz local. devuelve null si no se pudo abrir el puerto. */
export function startUiServer(options: UiServerOptions): Server | null {
  const server = createServer((request, response) => {
    // barrera adicional: solo se atienden peticiones que llegan por loopback
    const remote = request.socket.remoteAddress ?? '';
    if (!remote.includes('127.0.0.1') && remote !== '::1' && !remote.includes('::ffff:127.0.0.1')) {
      response.writeHead(403).end('solo accesible desde este ordenador');
      return;
    }

    const url = request.url ?? '/';

    if (url === '/' || url === '/index.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderPage());
      return;
    }

    if (url === '/api/status') {
      const status = options.agent.getStatus();
      if (status === null) {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'el agente no esta arrancado' }));
        return;
      }
      const lastHeartbeatAgo = status.lastHeartbeatAt
        ? `hace ${formatDuration(Date.now() - Date.parse(status.lastHeartbeatAt))}`
        : null;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ...status, lastHeartbeatAgo }));
      return;
    }

    if (url === '/api/logs') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      // los logs ya salen redactados del logger
      response.end(JSON.stringify({ lines: options.logger.tail(60) }));
      return;
    }

    if (url === '/api/stop' && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      options.onStopRequested();
      return;
    }

    response.writeHead(404).end('no encontrado');
  });

  server.on('error', (error) => {
    options.logger.warn(`no se pudo abrir la interfaz local: ${error.message}`);
  });

  try {
    // el bind explicito a 127.0.0.1 impide el acceso desde la red
    server.listen(options.port, options.host, () => {
      options.logger.info(`interfaz local en http://${options.host}:${options.port}`);
    });
    return server;
  } catch (error) {
    options.logger.warn(`no se pudo arrancar la interfaz local: ${String(error)}`);
    return null;
  }
}
