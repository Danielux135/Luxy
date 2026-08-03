// primer corte vertical de Luxy Studio: crear, seguir y cancelar trabajos.
import { useEffect, useMemo, useState, type JSX } from 'react';
import { TERMINAL_JOB_STATUSES } from '@luxy/shared';
import type { JobStatus, ProviderId, StudioJob } from '@luxy/shared';
import { Empty, Field, Notice, Panel, Readout, Tag } from '../ui/primitives.js';
import { useStudio } from '../useStudio.js';

const STATUS: Record<JobStatus, string> = {
  queued: 'En cola',
  waiting_for_machine: 'Esperando maquina',
  claimed: 'Preparando',
  running: 'Ejecutando',
  waiting_for_approval: 'Esperando aprobacion',
  completed: 'Completado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  interrupted: 'Interrumpido',
};

function tone(status: JobStatus): 'ok' | 'fault' | 'busy' | 'warn' | undefined {
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'interrupted') return 'fault';
  if (status === 'cancelled') return 'warn';
  if (status === 'running' || status === 'claimed') return 'busy';
  return undefined;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('es-ES', { hour12: false });
}

function isTerminal(job: StudioJob): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(job.status);
}

export function StudioPage(): JSX.Element {
  const studio = useStudio();
  const [machineId, setMachineId] = useState('');
  const [projectAlias, setProjectAlias] = useState('');
  const [provider, setProvider] = useState<ProviderId | ''>('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');

  const machine = studio.machines.find((item) => item.id === machineId) ?? null;
  const projects = useMemo(() => machine?.projects ?? [], [machine]);
  const providers = useMemo(() => machine?.providers ?? [], [machine]);

  useEffect(() => {
    if (studio.machines.length === 0 || machineId.length > 0) return;
    const preferred =
      studio.machines.find((item) => item.enabled && item.online) ?? studio.machines[0]!;
    setMachineId(preferred.id);
  }, [machineId, studio.machines]);

  useEffect(() => {
    if (!projects.includes(projectAlias)) setProjectAlias(projects[0] ?? '');
  }, [projectAlias, projects]);

  useEffect(() => {
    if (!providers.includes(provider as ProviderId)) setProvider(providers[0] ?? '');
  }, [provider, providers]);

  const canCreate =
    machine !== null &&
    machine.enabled &&
    projectAlias.length > 0 &&
    provider.length > 0 &&
    prompt.trim().length > 0 &&
    !studio.busy;

  const metadata = studio.detail?.job.metadata ?? {};
  const diffStat = typeof metadata['diffStat'] === 'string' ? metadata['diffStat'] : null;
  const testsPassed = typeof metadata['testsPassed'] === 'number' ? metadata['testsPassed'] : 0;
  const testsFailed = typeof metadata['testsFailed'] === 'number' ? metadata['testsFailed'] : 0;

  const orderedJobs = useMemo(
    () => [...studio.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [studio.jobs],
  );

  const submit = async (): Promise<void> => {
    if (!canCreate || provider === '' || machine === null) return;
    const created = await studio.create({
      targetMachineId: machine.id,
      provider,
      model: model.trim().length === 0 ? null : model.trim(),
      projectAlias,
      prompt: prompt.trim(),
      priority: 0,
    });
    if (created) setPrompt('');
  };

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Trabajos</h1>
        <Tag tone={studio.jobs.some((job) => !isTerminal(job)) ? 'busy' : undefined}>
          {studio.jobs.length} recientes
        </Tag>
      </div>
      <p className="page__lede">
        Crea una tarea desde Studio y sigue su ejecucion real: maquina, proyecto, modelo, eventos,
        comprobaciones y resumen del diff.
      </p>

      {studio.error !== null && <Notice tone="fault">{studio.error}</Notice>}
      {studio.loading && <Notice tone="warn">Cargando el estado del gateway…</Notice>}

      <Panel title="Nueva tarea">
        {studio.machines.length === 0 ? (
          <Empty title="Sin maquinas disponibles">
            Arranca y registra al menos una maquina para crear trabajos desde Studio.
          </Empty>
        ) : (
          <div className="studio-form">
            <Field label="Maquina">
              <select value={machineId} onChange={(event) => setMachineId(event.target.value)}>
                {studio.machines.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.enabled}>
                    {item.name} · {item.online ? 'conectada' : 'desconectada'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Proyecto">
              <select
                value={projectAlias}
                onChange={(event) => setProjectAlias(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Proveedor">
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value as ProviderId)}
              >
                {providers.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Modelo exacto" hint="Opcional. Vacío usa el predeterminado configurado.">
              <input
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="por ejemplo: DeepSeek-V4-Pro"
                spellCheck={false}
              />
            </Field>
            <div className="studio-form__prompt">
              <Field label="Tarea">
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={5}
                  maxLength={8000}
                  placeholder="Describe exactamente lo que quieres que Luxy haga…"
                />
              </Field>
            </div>
            <div className="studio-form__actions">
              <button
                className="btn btn--primary"
                disabled={!canCreate}
                onClick={() => void submit()}
              >
                Crear y ejecutar
              </button>
              {machine !== null && !machine.online && (
                <span className="list__meta">Quedara en cola hasta que la maquina se conecte.</span>
              )}
            </div>
          </div>
        )}
      </Panel>

      <div className="studio-layout">
        <Panel title="Historial real" flush>
          {orderedJobs.length === 0 ? (
            <Empty title="Todavia no hay trabajos">
              Crea la primera tarea con el formulario superior.
            </Empty>
          ) : (
            <ul className="list studio-jobs">
              {orderedJobs.map((job) => (
                <li key={job.id} data-selected={studio.detail?.job.id === job.id}>
                  <button className="studio-job" onClick={() => void studio.select(job.id)}>
                    <span className="list__main">
                      <span className="list__name">
                        {job.shortId} · {job.projectAlias}
                      </span>
                      <span className="list__meta">
                        {job.provider}
                        {job.model === null ? '' : ` / ${job.model}`} · {when(job.createdAt)}
                      </span>
                    </span>
                    <Tag tone={tone(job.status)}>{STATUS[job.status]}</Tag>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={studio.detail === null ? 'Detalle' : studio.detail.job.shortId}>
          {studio.detail === null ? (
            <Empty title="Selecciona un trabajo">
              Aqui apareceran el prompt, las fases, el resultado, las pruebas y el resumen del diff.
            </Empty>
          ) : (
            <>
              <Readout
                items={[
                  {
                    label: 'Estado',
                    value: STATUS[studio.detail.job.status],
                    tone: tone(studio.detail.job.status),
                  },
                  { label: 'Origen', value: studio.detail.job.origin },
                  { label: 'Proveedor', value: studio.detail.job.provider },
                  { label: 'Modelo', value: studio.detail.job.model ?? 'predeterminado' },
                  {
                    label: 'Pruebas OK',
                    value: String(testsPassed),
                    tone: testsPassed > 0 ? 'ok' : 'idle',
                  },
                  {
                    label: 'Pruebas fallidas',
                    value: String(testsFailed),
                    tone: testsFailed > 0 ? 'fault' : 'idle',
                  },
                ]}
              />
              <div className="studio-detail__block">
                <div className="list__meta">Tarea</div>
                <p>{studio.detail.job.prompt}</p>
              </div>
              {studio.detail.job.resultSummary !== null && (
                <div className="studio-detail__block">
                  <div className="list__meta">Resultado</div>
                  <p className="prewrap">{studio.detail.job.resultSummary}</p>
                </div>
              )}
              {studio.detail.job.errorMessage !== null && (
                <Notice tone="fault">{studio.detail.job.errorMessage}</Notice>
              )}
              {diffStat !== null && (
                <div className="studio-detail__block">
                  <div className="list__meta">Resumen del diff</div>
                  <pre className="mono prewrap">{diffStat}</pre>
                </div>
              )}
              <div className="studio-detail__block">
                <div className="list__meta">Eventos</div>
                {studio.detail.events.length === 0 ? (
                  <p className="list__meta">Sin eventos todavia.</p>
                ) : (
                  <ul className="stream studio-events">
                    {studio.detail.events.map((event) => (
                      <li key={event.sequence}>
                        <time>{String(event.sequence).padStart(3, '0')}</time>
                        <span>{event.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {!isTerminal(studio.detail.job) && (
                <button
                  className="btn btn--danger"
                  disabled={studio.busy}
                  onClick={() => void studio.cancel(studio.detail!.job.id)}
                >
                  Cancelar trabajo
                </button>
              )}
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
