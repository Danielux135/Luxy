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

/** trabajo terminado que todavia tiene cambios pendientes de decidir */
export interface PendingJob {
  jobId: string;
  shortId: string;
  projectAlias: string;
  worktreePath: string;
  branch: string;
  summary: string;
  filesChanged: number;
  testsFailed: number;
  at: string;
  /** resultado de la ultima accion pedida sobre este trabajo */
  lastAction: { action: 'commit' | 'discard' | 'push'; ok: boolean; message: string } | null;
  /** true una vez confirmado: no tiene sentido volver a confirmar */
  committed: boolean;
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
    case 'approval.resolved':
      return `${event.shortId}: ${event.action} ${event.ok ? 'hecho' : 'denegado'} - ${event.message}`;
    default:
      // heartbeat y status.updated no ensucian la actividad
      return null;
  }
}

export function useAgent(): {
  status: AgentHostStatus;
  activity: ActivityLine[];
  /** trabajos terminados con cambios pendientes de decidir */
  pending: PendingJob[];
  approve: (
    job: PendingJob,
    action: 'commit' | 'discard' | 'push',
    confirmedTwice?: boolean,
  ) => Promise<void>;
  busy: boolean;
  error: string | null;
  /** que puede hacer el usuario cuando el agente no arranca */
  hint: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
} {
  const [status, setStatus] = useState<AgentHostStatus>(INITIAL);
  const [activity, setActivity] = useState<ActivityLine[]>([]);
  const [pending, setPending] = useState<PendingJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
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

      // un trabajo terminado con worktree deja cambios que hay que decidir
      if (event.type === 'job.completed' && event.worktreePath !== null && event.branch !== null) {
        setPending((previous) => [
          ...previous.filter((job) => job.jobId !== event.jobId),
          {
            jobId: event.jobId,
            shortId: event.shortId,
            projectAlias: event.projectAlias,
            worktreePath: event.worktreePath!,
            branch: event.branch!,
            summary: event.summary,
            filesChanged: event.filesChanged,
            testsFailed: event.testsFailed,
            at: event.at,
            lastAction: null,
            committed: false,
          },
        ]);
      }
      // el resultado se PINTA siempre. Antes no se mostraba nada al confirmar,
      // asi que parecia que el boton no hacia nada y se pulsaba una y otra vez.
      if (event.type === 'approval.resolved') {
        if (event.ok && event.action !== 'commit') {
          // descartado o publicado: ya no hay nada que decidir
          setPending((previous) => previous.filter((job) => job.jobId !== event.jobId));
        } else {
          setPending((previous) =>
            previous.map((job) =>
              job.jobId === event.jobId
                ? {
                    ...job,
                    lastAction: { action: event.action, ok: event.ok, message: event.message },
                    committed: job.committed || (event.ok && event.action === 'commit'),
                  }
                : job,
            ),
          );
        }
      }

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
    async (
      action: () => Promise<
        { ok: true; value: AgentHostStatus } | { ok: false; error: string; hint: string | null }
      >,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        if (result.ok) {
          setStatus(result.value);
          setError(null);
          setHint(null);
        } else {
          setError(result.error);
          setHint(result.hint ?? null);
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const approve = useCallback(
    async (job: PendingJob, action: 'commit' | 'discard' | 'push', confirmedTwice = false) => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.luxy.resolveApproval({
          jobId: job.jobId,
          shortId: job.shortId,
          action,
          projectAlias: job.projectAlias,
          worktreePath: job.worktreePath,
          branch: job.branch,
          message: null,
          confirmedTwice,
        });
        if (!result.ok) setError(result.error);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return {
    status,
    activity,
    pending,
    approve,
    busy,
    error,
    hint,
    start: () => run(() => window.luxy.startAgent()),
    stop: () => run(() => window.luxy.stopAgent()),
    restart: () => run(() => window.luxy.restartAgent()),
  };
}
