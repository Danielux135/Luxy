// segundo corte vertical: conversaciones persistentes sobre la cola real.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderId, StudioJob, StudioJobEvent, StudioMachine } from '@luxy/shared';
import {
  buildConversationPrompt,
  conversationTitleFrom,
  groupConversations,
  parseConversationMetadata,
  type ConversationSummary,
} from './conversation.js';

export interface ConversationDetail {
  job: StudioJob;
  events: StudioJobEvent[];
}

export interface ConversationTarget {
  provider: ProviderId;
  model: string | null;
}

export interface SendConversationRequest {
  machineId: string;
  projectAlias: string;
  message: string;
  targets: ConversationTarget[];
}

export function replaceConversationJob(jobs: StudioJob[], updated: StudioJob): StudioJob[] {
  return jobs.map((job) => (job.id === updated.id ? updated : job));
}

export function replaceConversationDetail(
  details: Record<string, ConversationDetail>,
  updated: StudioJob,
): Record<string, ConversationDetail> {
  const current = details[updated.id];
  return current === undefined
    ? details
    : { ...details, [updated.id]: { ...current, job: updated } };
}

export function useConversations(): {
  machines: StudioMachine[];
  conversations: ConversationSummary[];
  history: StudioJob[];
  selected: ConversationSummary | null;
  details: Record<string, ConversationDetail>;
  loading: boolean;
  busy: boolean;
  cancellingIds: ReadonlySet<string>;
  error: string | null;
  select: (conversationId: string) => void;
  startNew: () => void;
  send: (request: SendConversationRequest) => Promise<boolean>;
  cancel: (jobId: string) => Promise<void>;
  rate: (jobId: string, rating: 'helpful' | 'not_helpful') => Promise<void>;
  reload: () => Promise<void>;
} {
  const [machines, setMachines] = useState<StudioMachine[]>([]);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ConversationDetail>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const jobsRef = useRef<StudioJob[]>([]);
  const selectedRef = useRef<string | null>(null);
  const draftingRef = useRef(false);
  const refreshingRef = useRef(false);

  const conversations = useMemo(() => groupConversations(jobs), [jobs]);
  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  const reload = useCallback(async (): Promise<void> => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const [options, history] = await Promise.all([
        window.luxy.getStudioOptions(),
        window.luxy.listStudioJobs({ limit: 100 }),
      ]);
      if (!options.ok) {
        setError(options.error);
        return;
      }
      if (!history.ok) {
        setError(history.error);
        return;
      }

      const conversationJobs = history.value.jobs.filter(
        (job) => parseConversationMetadata(job) !== null,
      );
      const grouped = groupConversations(conversationJobs);
      let activeId = selectedRef.current;
      if (activeId === null && !draftingRef.current && grouped.length > 0) {
        activeId = grouped[0]!.id;
        selectedRef.current = activeId;
        setSelectedId(activeId);
      }

      setMachines(options.value.machines);
      setJobs(conversationJobs);
      jobsRef.current = conversationJobs;
      setError(null);

      if (activeId !== null) {
        const visible = conversationJobs
          .filter((job) => parseConversationMetadata(job)?.conversationId === activeId)
          .slice(-20);
        const loaded = await Promise.all(
          visible.map(async (job) => ({
            jobId: job.id,
            result: await window.luxy.getStudioJob(job.id),
          })),
        );
        const next: Record<string, ConversationDetail> = {};
        for (const item of loaded) {
          if (item.result.ok) next[item.jobId] = item.result.value;
        }
        setDetails(next);
      } else {
        setDetails({});
      }
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void reload().finally(() => {
      if (active) setLoading(false);
    });
    const timer = window.setInterval(() => {
      if (active) void reload();
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [reload]);

  const select = useCallback(
    (conversationId: string): void => {
      draftingRef.current = false;
      selectedRef.current = conversationId;
      setSelectedId(conversationId);
      setDetails({});
      void reload();
    },
    [reload],
  );

  const startNew = useCallback((): void => {
    draftingRef.current = true;
    selectedRef.current = null;
    setSelectedId(null);
    setDetails({});
    setError(null);
  }, []);

  const send = useCallback(
    async (request: SendConversationRequest): Promise<boolean> => {
      if (request.targets.length < 1 || request.targets.length > 2) return false;
      setBusy(true);
      setError(null);
      try {
        const existingId = selectedRef.current;
        const conversationId = existingId ?? crypto.randomUUID();
        const turnId = crypto.randomUUID();
        const existingJobs = jobsRef.current.filter(
          (job) => parseConversationMetadata(job)?.conversationId === conversationId,
        );
        const existingTitle =
          existingJobs.map(parseConversationMetadata).find((item) => item !== null)?.title ?? null;
        const title = existingTitle ?? conversationTitleFrom(request.message);
        const projectJobs = jobsRef.current.filter(
          (job) => job.projectAlias === request.projectAlias,
        );
        const prompt = buildConversationPrompt(existingJobs, request.message, projectJobs);

        const results = await Promise.all(
          request.targets.map((target, comparisonIndex) =>
            window.luxy.createStudioJob({
              targetMachineId: request.machineId,
              provider: target.provider,
              model: target.model,
              projectAlias: request.projectAlias,
              prompt,
              priority: 0,
              mode: 'conversation',
              conversationId,
              conversationTurnId: turnId,
              conversationTitle: title,
              conversationUserMessage: request.message.trim(),
              comparisonIndex,
            }),
          ),
        );
        const failures = results.filter((result) => !result.ok);
        if (failures.length > 0) {
          setError(
            failures
              .map((result) => (result.ok ? '' : result.error))
              .filter((message) => message.length > 0)
              .join(' · '),
          );
        }
        if (failures.length === results.length) return false;

        draftingRef.current = false;
        selectedRef.current = conversationId;
        setSelectedId(conversationId);
        await reload();
        return failures.length === 0;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const cancel = useCallback(
    async (jobId: string): Promise<void> => {
      setBusy(true);
      setCancellingIds((current) => new Set(current).add(jobId));
      setError(null);
      try {
        const result = await window.luxy.cancelStudioJob(jobId);
        if (!result.ok) {
          setError(result.error);
        } else {
          const completedAt = new Date().toISOString();
          const asCancelled = (job: StudioJob): StudioJob =>
            job.id === jobId ? { ...job, status: 'cancelled', completedAt } : job;
          setJobs((current) => {
            const next = current.map(asCancelled);
            jobsRef.current = next;
            return next;
          });
          setDetails((current) => {
            const detail = current[jobId];
            return detail === undefined
              ? current
              : { ...current, [jobId]: { ...detail, job: asCancelled(detail.job) } };
          });
        }
        await reload();
      } finally {
        setCancellingIds((current) => {
          const next = new Set(current);
          next.delete(jobId);
          return next;
        });
        setBusy(false);
      }
    },
    [reload],
  );

  const rate = useCallback(
    async (jobId: string, rating: 'helpful' | 'not_helpful'): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.luxy.rateStudioJob({ jobId, rating });
        if (!result.ok) {
          setError(result.error);
          return;
        }

        // El gateway ya devuelve la version persistida. Aplicarla directamente
        // evita que un sondeo concurrente se coma la recarga y exija otro clic.
        const updated = result.value.job;
        setJobs((current) => {
          const next = replaceConversationJob(current, updated);
          jobsRef.current = next;
          return next;
        });
        setDetails((current) => replaceConversationDetail(current, updated));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return {
    machines,
    conversations,
    history: jobs,
    selected,
    details,
    loading,
    busy,
    cancellingIds,
    error,
    select,
    startNew,
    send,
    cancel,
    rate,
    reload,
  };
}
