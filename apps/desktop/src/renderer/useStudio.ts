// estado remoto de Luxy Studio.
//
// el renderer solo usa verbos IPC cerrados. El token de maquina permanece en
// el proceso principal y nunca cruza window.luxy.
import { useCallback, useEffect, useRef, useState } from 'react';
import { TERMINAL_JOB_STATUSES } from '@luxy/shared';
import type {
  StudioJob,
  StudioJobAction,
  StudioJobCreateRequest,
  StudioJobEvent,
  StudioMachine,
} from '@luxy/shared';
import { CONVERSATION_OPTIONS_TTL_MS, conversationPollDelayMs } from './conversation.js';
import { historyNeedsScopeFallback, jobsForProject } from './project-context.js';

export interface StudioDetail {
  job: StudioJob;
  events: StudioJobEvent[];
}

export function workspaceBindingMatches(
  request: StudioJobCreateRequest,
  created: StudioJob,
): boolean {
  if (request.workspacePath === undefined) return true;
  return created.metadata['resumeWorktreePath'] === request.workspacePath;
}

export function useStudio(projectScope: string | null = null): {
  machines: StudioMachine[];
  jobs: StudioJob[];
  detail: StudioDetail | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  scopeFallback: boolean;
  select: (jobId: string) => Promise<void>;
  create: (request: StudioJobCreateRequest) => Promise<boolean>;
  cancel: (jobId: string) => Promise<void>;
  decide: (jobId: string, action: StudioJobAction) => Promise<boolean>;
  reload: () => Promise<void>;
} {
  const [machines, setMachines] = useState<StudioMachine[]>([]);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [detail, setDetail] = useState<StudioDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeFallback, setScopeFallback] = useState(false);
  const selectedId = useRef<string | null>(null);
  const detailRef = useRef<StudioDetail | null>(null);
  const activeJobsRef = useRef(false);
  const optionsAtRef = useRef(0);
  const machinesRef = useRef<StudioMachine[] | null>(null);

  const loadDetail = useCallback(async (jobId: string): Promise<void> => {
    selectedId.current = jobId;
    const result = await window.luxy.getStudioJob(jobId);
    if (result.ok) {
      detailRef.current = result.value;
      setDetail(result.value);
    } else setError(result.error);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    // las opciones cambian de tarde en tarde; pedirlas cada tres segundos era
    // una peticion de cada tres sin informacion nueva (`P0.8`)
    const optionsAreStale =
      Date.now() - optionsAtRef.current >= CONVERSATION_OPTIONS_TTL_MS ||
      machinesRef.current === null;
    const [options, history] = await Promise.all([
      optionsAreStale ? window.luxy.getStudioOptions() : Promise.resolve(null),
      window.luxy.listStudioJobs({
        limit: projectScope === null ? 30 : 100,
        ...(projectScope === null ? {} : { projectAlias: projectScope }),
      }),
    ]);
    if (options !== null && !options.ok) {
      setError(options.error);
      return;
    }
    if (!history.ok) {
      setError(history.error);
      return;
    }
    if (options !== null && options.ok) {
      optionsAtRef.current = Date.now();
      machinesRef.current = options.value.machines;
    }

    const visibleJobs = jobsForProject(history.value.jobs, projectScope);
    if (machinesRef.current !== null) setMachines(machinesRef.current);
    setJobs(visibleJobs);
    setScopeFallback(historyNeedsScopeFallback(history.value.jobs, projectScope));
    setError(null);
    activeJobsRef.current = visibleJobs.some(
      (job) => !(TERMINAL_JOB_STATUSES as readonly string[]).includes(job.status),
    );

    const current = selectedId.current;
    if (current === null) return;
    // un trabajo terminado que no ha cambiado ya no tiene eventos nuevos
    const listed = visibleJobs.find((job) => job.id === current) ?? null;
    const cached = detailRef.current;
    const unchanged =
      cached !== null &&
      cached.job.id === current &&
      listed !== null &&
      (TERMINAL_JOB_STATUSES as readonly string[]).includes(listed.status) &&
      cached.job.status === listed.status &&
      cached.job.completedAt === listed.completedAt &&
      cached.job.resultSummary === listed.resultSummary;
    if (unchanged) return;

    const selected = await window.luxy.getStudioJob(current);
    if (selected.ok) {
      detailRef.current = selected.value;
      setDetail(selected.value);
    }
  }, [projectScope]);

  useEffect(() => {
    let active = true;
    let timer = 0;

    const schedule = (): void => {
      window.clearTimeout(timer);
      if (!active) return;
      timer = window.setTimeout(
        () => {
          void reload().finally(schedule);
        },
        conversationPollDelayMs({
          hasActiveJob: activeJobsRef.current,
          hidden: document.visibilityState === 'hidden',
        }),
      );
    };

    const onVisible = (): void => {
      if (!active || document.visibilityState !== 'visible') return;
      window.clearTimeout(timer);
      void reload().finally(schedule);
    };
    document.addEventListener('visibilitychange', onVisible);

    void reload()
      .finally(() => {
        if (active) setLoading(false);
      })
      .finally(schedule);

    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  const select = useCallback(
    async (jobId: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await loadDetail(jobId);
      } finally {
        setBusy(false);
      }
    },
    [loadDetail],
  );

  const create = useCallback(
    async (request: StudioJobCreateRequest): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.luxy.createStudioJob(request);
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        if (!workspaceBindingMatches(request, result.value.job)) {
          // Un Gateway anterior elimina workspacePath como campo desconocido y
          // crea un trabajo normal. Se cancela de inmediato para no prometer
          // reutilizacion mientras el agente prepara otra carpeta.
          await window.luxy.cancelStudioJob(result.value.job.id);
          setError(
            'El Gateway desplegado no conserva el espacio de trabajo. Ejecuta deploy-gateway.bat antes de volver a intentarlo.',
          );
          return false;
        }
        selectedId.current = result.value.job.id;
        detailRef.current = result.value;
        setDetail(result.value);
        activeJobsRef.current = true;
        await reload();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const cancel = useCallback(
    async (jobId: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.luxy.cancelStudioJob(jobId);
        if (!result.ok) setError(result.error);
        else await reload();
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const decide = useCallback(
    async (jobId: string, action: StudioJobAction): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.luxy.requestStudioJobAction({
          jobId,
          action,
          confirmed: true,
          message: null,
        });
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        await reload();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return {
    machines,
    jobs,
    detail,
    loading,
    busy,
    error,
    scopeFallback,
    select,
    create,
    cancel,
    decide,
    reload,
  };
}
