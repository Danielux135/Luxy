// Inicio y Trabajos.
import type { JSX } from 'react';
import type { AgentHostStatus } from '@luxy/shared';
import { Empty, Notice, Panel, Readout, Tag } from '../ui/primitives.js';
import { RUN_STATE_LABEL } from '../ui/StatusRail.js';
import type { ActivityLine } from '../useAgent.js';

function hora(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('es-ES', { hour12: false });
}

function desde(iso: string | null): string {
  if (iso === null) return 'nunca';
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (Number.isNaN(seconds)) return 'nunca';
  if (seconds < 60) return `hace ${seconds} s`;
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)} min`;
  return `hace ${Math.round(seconds / 3600)} h`;
}

const TONO_EVENTO: Record<string, 'ok' | 'fault' | 'busy' | undefined> = {
  'job.completed': 'ok',
  'gateway.connected': 'ok',
  'job.failed': 'fault',
  'agent.error': 'fault',
  'gateway.disconnected': 'fault',
  'job.claimed': 'busy',
  'job.tool.requested': 'busy',
};

export function HomePage({
  status,
  activity,
  busy,
  error,
  onStart,
  onStop,
  onRestart,
  configured,
}: {
  status: AgentHostStatus;
  activity: ActivityLine[];
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  configured: boolean;
}): JSX.Element {
  const agent = status.agent;
  const running = status.runState === 'running';
  const connected = agent?.gatewayConnected ?? false;

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Inicio</h1>
      </div>
      <p className="page__lede">
        Estado de la maquina y de lo que esta haciendo ahora mismo.
      </p>

      {error !== null && <Notice tone="fault">{error}</Notice>}
      {status.lastError !== null && <Notice tone="fault">{status.lastError}</Notice>}
      {!configured && (
        <Notice tone="warn">
          Esta maquina todavia no esta registrada. Ve a Ajustes para completar la configuracion.
        </Notice>
      )}

      <Panel
        title="Maquina"
        actions={
          <>
            <button className="btn btn--primary" onClick={onStart} disabled={busy || running}>
              Iniciar
            </button>
            <button className="btn" onClick={onStop} disabled={busy || !running}>
              Detener
            </button>
            <button className="btn" onClick={onRestart} disabled={busy || !running}>
              Reiniciar
            </button>
          </>
        }
      >
        <Readout
          items={[
            {
              label: 'Agente',
              value: RUN_STATE_LABEL[status.runState] ?? status.runState,
              tone: running ? 'ok' : 'idle',
            },
            {
              label: 'Gateway',
              value: connected ? 'Conectado' : 'Sin conexion',
              tone: connected ? 'ok' : 'fault',
            },
            { label: 'Ultimo latido', value: desde(agent?.lastHeartbeatAt ?? null), tone: 'idle' },
            {
              label: 'Telegram',
              value: connected ? 'Alcanzable' : 'No alcanzable',
              tone: connected ? 'ok' : 'idle',
            },
            {
              label: 'Proveedores',
              value: agent === null || agent.providers.length === 0 ? 'ninguno' : agent.providers.join(', '),
              tone: (agent?.providers.length ?? 0) > 0 ? 'ok' : 'idle',
            },
            {
              label: 'Eventos en cola',
              value: String(agent?.pendingEvents ?? 0),
              tone: (agent?.pendingEvents ?? 0) > 0 ? 'busy' : 'idle',
            },
          ]}
        />
      </Panel>

      <Panel title="Trabajo activo">
        {agent?.activeJob == null ? (
          <Empty title="Nada en curso">
            Manda un trabajo desde Telegram, por ejemplo{' '}
            <code className="mono">/deepseek mi-proyecto arregla los tests</code>.
          </Empty>
        ) : (
          <Readout
            items={[
              { label: 'Identificador', value: agent.activeJob.shortId, tone: 'busy' },
              { label: 'Proveedor', value: agent.activeJob.provider },
              { label: 'Proyecto', value: agent.activeJob.projectAlias },
              { label: 'Desde', value: desde(agent.activeJob.startedAt) },
            ]}
          />
        )}
      </Panel>

      <Panel title="Actividad reciente" flush>
        {activity.length === 0 ? (
          <Empty title="Sin actividad">
            Aqui apareceran las fases, herramientas y resultados en cuanto el agente reciba trabajo.
          </Empty>
        ) : (
          <ul className="stream">
            {activity
              .slice()
              .reverse()
              .map((line) => (
                <li key={line.id} data-tone={TONO_EVENTO[line.type]}>
                  <time>{hora(line.at)}</time>
                  <span>{line.text}</span>
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export function JobsPage({ activity }: { activity: ActivityLine[] }): JSX.Element {
  // los trabajos historicos viven en el gateway; hasta que Desktop los consulte
  // se muestra lo observado en esta sesion, y se dice claramente que es asi
  const jobs = new Map<string, ActivityLine[]>();
  for (const line of activity) {
    const match = /\b(LUX-[A-Z0-9]+)/.exec(line.text);
    if (match === null) continue;
    const key = match[1]!;
    jobs.set(key, [...(jobs.get(key) ?? []), line]);
  }

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Trabajos</h1>
        <Tag>{jobs.size} en esta sesion</Tag>
      </div>
      <p className="page__lede">
        Trabajos que esta maquina ha ejecutado desde que abriste Luxy. El historial completo, con
        diff y pruebas, llega cuando Desktop consulte el gateway.
      </p>

      {jobs.size === 0 ? (
        <Panel flush>
          <Empty title="Ningun trabajo todavia">
            Envia uno desde Telegram y aparecera aqui con sus fases y su resultado.
          </Empty>
        </Panel>
      ) : (
        [...jobs.entries()].reverse().map(([shortId, lines]) => (
          <Panel key={shortId} title={shortId} flush>
            <ul className="stream">
              {lines.map((line) => (
                <li key={line.id} data-tone={TONO_EVENTO[line.type]}>
                  <time>{hora(line.at)}</time>
                  <span>{line.text}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
    </>
  );
}
