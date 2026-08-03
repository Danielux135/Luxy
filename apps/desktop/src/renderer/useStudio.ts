// estado remoto de Luxy Studio.
//
// el renderer solo usa verbos IPC cerrados. El token de maquina permanece en
// el proceso principal y nunca cruza window.luxy.
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  StudioJob,
  StudioJobCreateRequest,
  StudioJobEvent,
  StudioMachine,
} from '@luxy/shared';

export interface StudioDetail {
  job: StudioJob;
  events: StudioJobEvent[];
}

export function useStudio(): {
  machines: StudioMachine[];
  jobs: StudioJob[];
  detail: StudioDetail | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  select: (jobId: string) => Promise<void>;
  create: (request: StudioJobCreateRequest) => Promise<boolean>;
  cancel: (jobId: string) => Promise<void>;
  reload: () => Promise<void>;
} {
  const [machines, setMachines] = useState<StudioMachine[]>([]);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [detail, setDetail] = useState<StudioDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedId = useRef<string | null>(null);

  const loadDetail = useCallback(async (jobId: string): Promise<void> => {
    selectedId.current = jobId;
    const result = await window.luxy.getStudioJob(jobId);
    if (result.ok) setDetail(result.value);
    else setError(result.error);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const [options, history] = await Promise.all([
      window.luxy.getStudioOptions(),
      window.luxy.listStudioJobs({ limit: 30 }),
    ]);
    if (!options.ok) {
      setError(options.error);
      return;
    }
    if (!history.ok) {
      setError(history.error);
      return;
    }

    setMachines(options.value.machines);
    setJobs(history.value.jobs);
    setError(null);
    if (selectedId.current !== null) {
      const selected = await window.luxy.getStudioJob(selectedId.current);
      if (selected.ok) setDetail(selected.value);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void reload().finally(() => {
      if (active) setLoading(false);
    });
    const timer = window.setInterval(() => {
      if (active) void reload();
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
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
        selectedId.current = result.value.job.id;
        setDetail(result.value);
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

  return { machines, jobs, detail, loading, busy, error, select, create, cancel, reload };
}
