// segundo corte vertical: conversaciones persistentes sobre la cola real.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderId, StudioJob, StudioJobEvent, StudioMachine } from '@luxy/shared';
import {
  CONVERSATION_OPTIONS_TTL_MS,
  activeJobsAreLocal,
  buildConversationPrompt,
  conversationDetailsToFetch,
  conversationPollDelayMs,
  conversationTitleFrom,
  groupConversations,
  isConversationRunning,
  parseConversationMetadata,
  reduceLocalJobStream,
  type ConversationSummary,
  type LocalJobStreams,
} from './conversation.js';
import { historyNeedsScopeFallback, jobsForProject } from './project-context.js';

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
  /** trabajo cuya respuesta cortada continua este turno */
  continuesJobId?: string | null;
}

export interface ConversationLibraryUpdate {
  title?: string;
  archived?: boolean;
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

export function useConversations(projectScope: string | null = null): {
  machines: StudioMachine[];
  conversations: ConversationSummary[];
  history: StudioJob[];
  selected: ConversationSummary | null;
  details: Record<string, ConversationDetail>;
  /** streaming en vivo publicado por el agente de esta maquina */
  localStreams: LocalJobStreams;
  loading: boolean;
  busy: boolean;
  cancellingIds: ReadonlySet<string>;
  error: string | null;
  scopeFallback: boolean;
  select: (conversationId: string) => void;
  startNew: () => void;
  send: (request: SendConversationRequest) => Promise<boolean>;
  cancel: (jobId: string) => Promise<void>;
  rate: (jobId: string, rating: 'helpful' | 'not_helpful') => Promise<void>;
  updateConversation: (
    conversationId: string,
    update: ConversationLibraryUpdate,
  ) => Promise<boolean>;
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
  const [scopeFallback, setScopeFallback] = useState(false);
  const jobsRef = useRef<StudioJob[]>([]);
  const selectedRef = useRef<string | null>(null);
  const draftingRef = useRef(false);
  const refreshingRef = useRef(false);
  const detailsRef = useRef<Record<string, ConversationDetail>>({});
  const activeJobsRef = useRef(false);
  const optionsAtRef = useRef(0);
  const machinesRef = useRef<StudioMachine[] | null>(null);
  // recarga inmediata y reprograma el ritmo; la rellena el bucle de sondeo
  const wakeRef = useRef<() => void>(() => {});
  const [localStreams, setLocalStreams] = useState<LocalJobStreams>({});
  const localStreamsRef = useRef<LocalJobStreams>({});
  const localOnlyRef = useRef(false);

  const conversations = useMemo(() => groupConversations(jobs), [jobs]);
  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  const reload = useCallback(async (): Promise<void> => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      // las maquinas y los proyectos no cambian cada segundo: pedirlos en cada
      // vuelta era una peticion de cada cuatro sin ninguna informacion nueva
      const optionsAreStale =
        Date.now() - optionsAtRef.current >= CONVERSATION_OPTIONS_TTL_MS ||
        machinesRef.current === null;
      const [options, history] = await Promise.all([
        optionsAreStale ? window.luxy.getStudioOptions() : Promise.resolve(null),
        window.luxy.listStudioJobs({
          limit: 100,
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
      setScopeFallback(historyNeedsScopeFallback(history.value.jobs, projectScope));
      const conversationJobs = visibleJobs.filter((job) => parseConversationMetadata(job) !== null);
      const grouped = groupConversations(conversationJobs);
      let activeId = selectedRef.current;
      if (activeId === null && !draftingRef.current && grouped.length > 0) {
        activeId = grouped[0]!.id;
        selectedRef.current = activeId;
        setSelectedId(activeId);
      }

      if (machinesRef.current !== null) setMachines(machinesRef.current);
      setJobs(conversationJobs);
      jobsRef.current = conversationJobs;
      setError(null);

      if (activeId === null) {
        activeJobsRef.current = false;
        setDetails({});
        return;
      }

      const visible = conversationJobs
        .filter((job) => parseConversationMetadata(job)?.conversationId === activeId)
        .slice(-20);
      activeJobsRef.current = visible.some(isConversationRunning);
      localOnlyRef.current = activeJobsAreLocal(visible, localStreamsRef.current);

      // solo se piden los detalles que pueden haber cambiado. Los demas ya
      // estan en cache y volver a pedirlos no aporta nada.
      const pending = conversationDetailsToFetch(visible, detailsRef.current);
      const loaded = await Promise.all(
        pending.map(async (job) => ({
          jobId: job.id,
          result: await window.luxy.getStudioJob(job.id),
        })),
      );

      const next: Record<string, ConversationDetail> = {};
      for (const job of visible) {
        const previous = detailsRef.current[job.id];
        if (previous !== undefined) next[job.id] = previous;
      }
      for (const item of loaded) {
        if (item.result.ok) next[item.jobId] = item.result.value;
      }
      detailsRef.current = next;
      setDetails(next);
    } finally {
      refreshingRef.current = false;
    }
  }, [projectScope]);

  useEffect(() => {
    let active = true;
    let timer = 0;

    const schedule = (): void => {
      window.clearTimeout(timer);
      if (!active) return;
      const delay = conversationPollDelayMs({
        hasActiveJob: activeJobsRef.current,
        hidden: document.visibilityState === 'hidden',
        streamedLocally: localOnlyRef.current,
      });
      timer = window.setTimeout(() => {
        void reload().finally(schedule);
      }, delay);
    };

    // enviar o detener cambia lo que hay que mirar: el ritmo se recalcula ya,
    // sin esperar a que venza el temporizador lento. No recarga: quien llama
    // acaba de hacerlo.
    wakeRef.current = schedule;

    // al volver a la ventana se refresca ya: nadie espera un minuto mirando
    // una pantalla vieja
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
      wakeRef.current = () => {};
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  // el agente de esta maquina corre dentro de Studio y publica lo que escribe.
  // Escucharlo evita preguntarle a Supabase por algo que ya tenemos aqui, y
  // convierte el final de un trabajo en una recarga dirigida en vez de un
  // sondeo a ciegas (`P0.9`).
  useEffect(() => {
    const unsubscribe = window.luxy.onAgentEvent((event) => {
      const next = reduceLocalJobStream(localStreamsRef.current, event);
      if (next !== localStreamsRef.current) {
        localStreamsRef.current = next;
        setLocalStreams(next);
      }

      if (
        event.type === 'job.claimed' ||
        event.type === 'job.completed' ||
        event.type === 'job.failed' ||
        event.type === 'job.cancelled'
      ) {
        // el evento dice que algo cambio; lo que quedo guardado se lee del
        // trabajo persistido, que sigue siendo la fuente de verdad
        void reload().finally(() => wakeRef.current());
      }
    });
    return unsubscribe;
  }, [reload]);

  const select = useCallback(
    (conversationId: string): void => {
      draftingRef.current = false;
      selectedRef.current = conversationId;
      setSelectedId(conversationId);
      detailsRef.current = {};
      setDetails({});
      void reload();
    },
    [reload],
  );

  const startNew = useCallback((): void => {
    draftingRef.current = true;
    selectedRef.current = null;
    setSelectedId(null);
    detailsRef.current = {};
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
        const existingTitle = groupConversations(existingJobs)[0]?.title ?? null;
        const title = existingTitle ?? conversationTitleFrom(request.message);
        const projectJobs = jobsRef.current.filter(
          (job) => job.projectAlias === request.projectAlias,
        );
        // continuar solo tiene sentido dentro de la misma conversacion: el
        // parcial que se le enseña al modelo sale del trabajo enlazado, no de
        // lo que hubiera en pantalla.
        const continued =
          request.continuesJobId == null
            ? null
            : (existingJobs.find((job) => job.id === request.continuesJobId) ?? null);
        const prompt = buildConversationPrompt(
          existingJobs,
          request.message,
          projectJobs,
          continued?.resultSummary ?? null,
        );

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
              ...(continued === null ? {} : { continuesJobId: continued.id }),
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
        // hay una respuesta en marcha: el sondeo vuelve al ritmo rapido ya
        activeJobsRef.current = true;
        await reload();
        wakeRef.current();
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
            const next =
              detail === undefined
                ? current
                : { ...current, [jobId]: { ...detail, job: asCancelled(detail.job) } };
            // la cache es la que decide si hay que volver a pedir un detalle:
            // si se queda atras, el sondeo dejaria de refrescarlo
            detailsRef.current = next;
            return next;
          });
        }
        await reload();
        // ya no hay nada corriendo: el sondeo puede aflojar el ritmo
        wakeRef.current();
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
        setDetails((current) => {
          const next = replaceConversationDetail(current, updated);
          detailsRef.current = next;
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const updateConversation = useCallback(
    async (conversationId: string, update: ConversationLibraryUpdate): Promise<boolean> => {
      const conversation = groupConversations(jobsRef.current).find(
        (item) => item.id === conversationId,
      );
      const latestJob = conversation?.jobs.at(-1);
      if (latestJob === undefined) return false;

      setBusy(true);
      setError(null);
      try {
        const result = await window.luxy.updateStudioConversation({
          jobId: latestJob.id,
          conversationId,
          ...(update.title === undefined ? {} : { title: update.title.trim() }),
          ...(update.archived === undefined ? {} : { archived: update.archived }),
        });
        if (!result.ok) {
          setError(result.error);
          return false;
        }

        const updated = result.value.job;
        setJobs((current) => {
          const next = replaceConversationJob(current, updated);
          jobsRef.current = next;
          return next;
        });
        setDetails((current) => {
          const next = replaceConversationDetail(current, updated);
          detailsRef.current = next;
          return next;
        });
        return true;
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
    localStreams,
    loading,
    busy,
    cancellingIds,
    error,
    scopeFallback,
    select,
    startNew,
    send,
    cancel,
    rate,
    updateConversation,
    reload,
  };
}
