// estado del agente en el renderer.
//
// no hay polling agresivo: el estado inicial se pide una vez y a partir de ahi
// manda el flujo de eventos. la suscripcion se limpia al desmontar, que es lo
// que evita listeners duplicados al navegar entre vistas.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, AgentHostStatus } from '@luxy/shared';

const INITIAL: AgentHostStatus = { runState: 'stopped', agent: null, lastError: null };

/** cuantas lineas de actividad reciente se conservan en memoria */
const MAX_ACTIVITY = 200;

export interface ActivityLine {
  id: number;
  at: string;
  type: AgentEvent['type'];
  text: string;
}

function describe(event: AgentEvent): string | null {
  switch (event.type) {
    case 'agent.started':
      return 'Agente arrancado';
    case 'agent.stopped':
      return `Agente detenido (${event.reason})`;
    case 'agent.error':
      return `Error: ${event.message}`;
    case 'gateway.connected':
      return 'Gateway conectado';
    case 'gateway.disconnected':
      return `Gateway desconectado${event.message === null ? '' : `: ${event.message}`}`;
    case 'job.claimed':
      return `${event.shortId} reclamado (${event.provider} / ${event.projectAlias})`;
    case 'job.phase':
    case 'job.output':
    case 'job.tests':
    case 'job.warning':
      return `${event.shortId}: ${event.message}`;
    case 'job.completed':
      return `${event.shortId} terminado: ${event.filesChanged} archivos, ${event.testsFailed} pruebas fallidas`;
    case 'job.failed':
      return `${event.shortId} fallido: ${event.errorMessage}`;
    case 'job.cancelled':
      return `${event.shortId} cancelado`;
    case 'job.tool.requested':
      return `${event.shortId}: herramienta ${event.tool} (paso ${event.step})`;
    case 'job.tool.completed':
      return `${event.shortId}: ${event.tool} ${event.ok ? 'ok' : 'fallo'} en ${event.durationMs} ms`;
    case 'approval.pending':
      return `${event.shortId} espera aprobacion (${event.action})`;
    default:
      // heartbeat y status.updated no ensucian la actividad
      return null;
  }
}

export function useAgent(): {
  status: AgentHostStatus;
  activity: ActivityLine[];
  busy: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
} {
  const [status, setStatus] = useState<AgentHostStatus>(INITIAL);
  const [activity, setActivity] = useState<ActivityLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    let active = true;

    void window.luxy.getAgentStatus().then((result) => {
      if (active && result.ok) setStatus(result.value);
    });

    // la funcion de baja llega del preload; sin ella cada montaje añadiria
    // un listener mas sobre el mismo canal
    const unsubscribe = window.luxy.onAgentEvent((event) => {
      if (!active) return;
      if (event.type === 'status.updated') setStatus(event.status);

      const text = describe(event);
      if (text === null) return;
      setActivity((previous) => {
        nextId.current += 1;
        const line: ActivityLine = { id: nextId.current, at: event.at, type: event.type, text };
        return [...previous, line].slice(-MAX_ACTIVITY);
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<{ ok: true; value: AgentHostStatus } | { ok: false; error: string }>) => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        if (result.ok) setStatus(result.value);
        else setError(result.error);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return {
    status,
    activity,
    busy,
    error,
    start: () => run(() => window.luxy.startAgent()),
    stop: () => run(() => window.luxy.stopAgent()),
    restart: () => run(() => window.luxy.restartAgent()),
  };
}
