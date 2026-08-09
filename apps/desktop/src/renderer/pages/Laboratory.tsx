// Catalogo del Laboratorio. Esta primera version solo prepara pruebas: no
// ejecuta modelos ni hace red hasta que exista una confirmacion explicita.
import {
  MODEL_EVALUATIONS,
  buildDefaultCatalog,
  buildModelEvaluationPrompt,
  getModelEvaluationFixture,
  modelDeclaresEvaluationCapabilities,
  type ModelEvaluationDefinition,
  type StoredModelEvaluationResult,
  type StudioMachine,
} from '@luxy/shared';
import { useCallback, useEffect, useState, type JSX } from 'react';
import {
  collectActiveModelEvaluations,
  collectModelEvaluationHistory,
  type ActiveModelEvaluationEntry,
  type ModelEvaluationHistoryEntry,
} from '../evaluation-history.js';
import { evaluationExecutionBlockReason, evaluationProvider } from '../evaluation-run-policy.js';
import { Empty, Field, Notice, Panel, Readout, Tag, type Tone } from '../ui/primitives.js';
import type { ConfigSummary } from '../useConfig.js';

const CATEGORY_LABELS: Record<ModelEvaluationDefinition['category'], string> = {
  speed: 'Rapidez',
  coding: 'Codigo',
  frontend: 'Frontend',
  spanish: 'Español',
  instructions: 'Instrucciones',
  json: 'JSON',
  long_context: 'Contexto largo',
  tool_calling: 'Tool calling',
};

const VALIDATION_LABELS: Record<ModelEvaluationDefinition['validationMode'], string> = {
  automatic: 'validador local',
  manual: 'revision manual',
  sandbox: 'runner aislado pendiente',
  trace: 'traza pendiente',
};

const RESULT_LABELS: Record<StoredModelEvaluationResult['status'], string> = {
  passed: 'Validada',
  failed: 'No supera los checks',
  not_scored: 'Sin puntuar',
};

function resultTone(status: StoredModelEvaluationResult['status']): Tone {
  if (status === 'passed') return 'ok';
  if (status === 'failed') return 'fault';
  return 'warn';
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('es-ES', { hour12: false });
}

function ResultHistory({
  entries,
}: {
  entries: readonly ModelEvaluationHistoryEntry[];
}): JSX.Element {
  return (
    <ul className="list">
      {entries.slice(0, 12).map((entry) => {
        const definition = MODEL_EVALUATIONS.find((item) => item.id === entry.result.evaluationId);
        const passedChecks = entry.result.checks.filter((check) => check.passed).length;
        return (
          <li key={entry.jobId}>
            <div className="list__main">
              <span>{definition?.title ?? entry.result.evaluationId}</span>
              <span className="row">
                <Tag tone={resultTone(entry.result.status)}>
                  {RESULT_LABELS[entry.result.status]}
                </Tag>
                <Tag>{entry.result.model}</Tag>
              </span>
            </div>
            <div className="list__meta">
              {entry.shortId} · {when(entry.validatedAt ?? entry.createdAt)} ·{' '}
              {entry.result.durationMs.toLocaleString()} ms ·{' '}
              {entry.result.outputChars.toLocaleString()} caracteres
              {entry.result.inputTokens === null || entry.result.outputTokens === null
                ? ' · tokens no disponibles'
                : ` · ${entry.result.inputTokens} entrada / ${entry.result.outputTokens} salida`}
            </div>
            {entry.result.checks.length > 0 && (
              <div className="list__meta">
                Checks: {passedChecks}/{entry.result.checks.length}
              </div>
            )}
            {entry.result.reason !== null && (
              <div className="list__meta">{entry.result.reason}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EvaluationCard({ evaluation }: { evaluation: ModelEvaluationDefinition }): JSX.Element {
  const fixture =
    evaluation.fixtureId === null ? null : getModelEvaluationFixture(evaluation.fixtureId);

  return (
    <Panel
      title={evaluation.title}
      actions={
        <>
          <Tag>{CATEGORY_LABELS[evaluation.category]}</Tag>
          <Tag tone={evaluation.executionEnabled ? 'ok' : 'warn'}>
            v{evaluation.version} ·{' '}
            {evaluation.executionEnabled ? 'individual disponible' : 'pendiente'}
          </Tag>
        </>
      }
    >
      <p>{evaluation.summary}</p>
      <p className="list__meta mono">{evaluation.id}</p>
      <p className="silk">Prompt versionado</p>
      <p className="mono prewrap">{evaluation.prompt}</p>
      <p className="silk">Criterios</p>
      <ul className="list">
        {evaluation.successCriteria.map((criterion) => (
          <li key={criterion}>
            <div className="list__main">{criterion}</div>
          </li>
        ))}
      </ul>
      {fixture !== null && (
        <p className="list__meta mono">
          {fixture.id} · {fixture.kind} · {fixture.content.length.toLocaleString()} caracteres
        </p>
      )}
      <div className="row">
        {evaluation.requiredCapabilities.map((capability) => (
          <Tag key={capability}>{capability}</Tag>
        ))}
        {fixture !== null && <Tag tone="busy">fixture disponible</Tag>}
        <Tag tone={evaluation.validationMode === 'automatic' ? 'ok' : 'warn'}>
          {VALIDATION_LABELS[evaluation.validationMode]}
        </Tag>
      </div>
    </Panel>
  );
}

export function LaboratoryPage({ summary }: { summary: ConfigSummary }): JSX.Element {
  const [evaluationId, setEvaluationId] = useState(MODEL_EVALUATIONS[0]!.id);
  const [modelId, setModelId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState<ModelEvaluationHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [machines, setMachines] = useState<StudioMachine[]>([]);
  const [machineId, setMachineId] = useState('');
  const [projectAlias, setProjectAlias] = useState('');
  const [activeEvaluation, setActiveEvaluation] = useState(false);
  const [activeEntries, setActiveEntries] = useState<ActiveModelEvaluationEntry[]>([]);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [cancelRequestedJobIds, setCancelRequestedJobIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdShortId, setCreatedShortId] = useState<string | null>(null);
  const evaluation = MODEL_EVALUATIONS.find((item) => item.id === evaluationId)!;
  const connectionId = summary.config?.connections?.[0]?.id ?? null;
  const models = connectionId === null ? [] : buildDefaultCatalog(connectionId);
  const compatibleModels = models.filter((model) =>
    modelDeclaresEvaluationCapabilities(model, evaluation),
  );
  const selectedModel =
    compatibleModels.find((model) => model.id === modelId) ?? compatibleModels[0] ?? null;
  const preview = buildModelEvaluationPrompt(evaluation.id)!;
  const machine = machines.find((item) => item.id === machineId) ?? null;
  const provider = evaluationProvider(selectedModel);

  useEffect(() => {
    setConfirmed(false);
  }, [evaluation.id, selectedModel?.id]);

  useEffect(() => {
    if (machines.length === 0) {
      setMachineId('');
      return;
    }
    if (!machines.some((item) => item.id === machineId && item.enabled && item.online)) {
      setMachineId((machines.find((item) => item.enabled && item.online) ?? machines[0]!).id);
    }
  }, [machineId, machines]);

  useEffect(() => {
    const projects = machine?.projects ?? [];
    if (!projects.includes(projectAlias)) setProjectAlias(projects[0] ?? '');
  }, [machine, projectAlias]);

  const loadHistory = useCallback(async (): Promise<void> => {
    setHistoryLoading(true);
    const [historyResult, optionsResult] = await Promise.all([
      window.luxy.listStudioJobs({ limit: 100 }),
      window.luxy.getStudioOptions(),
    ]);
    if (historyResult.ok && optionsResult.ok) {
      setHistory(collectModelEvaluationHistory(historyResult.value.jobs));
      setMachines(optionsResult.value.machines);
      const active = collectActiveModelEvaluations(historyResult.value.jobs);
      setActiveEntries(active);
      setActiveEvaluation(active.length > 0);
      setHistoryError(null);
    } else {
      setHistoryError(historyResult.ok ? optionsResult.error : historyResult.error);
    }
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const blockReason = evaluationExecutionBlockReason({
    evaluation,
    model: selectedModel,
    machine,
    projectAlias,
    activeEvaluation,
    confirmed,
    busy: creating,
  });

  const execute = async (): Promise<void> => {
    if (blockReason !== null || selectedModel === null || machine === null || provider === null) {
      return;
    }
    const accepted = window.confirm(
      [
        `¿Ejecutar ${evaluation.title}?`,
        '',
        `Modelo exacto: ${selectedModel.apiModel}`,
        `Maquina: ${machine.name}`,
        'Esta accion puede consumir tokens. Luxy no consulta ni conoce el precio.',
        'Solo se creara una evaluacion individual de solo lectura.',
      ].join('\n'),
    );
    if (!accepted) return;
    setCreating(true);
    setCreateError(null);
    setCreatedShortId(null);
    const result = await window.luxy.createStudioJob({
      targetMachineId: machine.id,
      provider,
      model: selectedModel.apiModel,
      projectAlias,
      prompt: preview.text,
      priority: 0,
      mode: 'evaluation',
      evaluation: {
        evaluationId: evaluation.id,
        evaluationVersion: evaluation.version,
        promptVersion: 1,
        fixtureId: evaluation.fixtureId,
        validationMode: evaluation.validationMode,
        scoring: evaluation.scoring,
        confirmed: true,
      },
    });
    if (result.ok) {
      setCreatedShortId(result.value.job.shortId);
      setConfirmed(false);
      await loadHistory();
    } else {
      setCreateError(result.error);
    }
    setCreating(false);
  };

  const cancelEvaluation = async (entry: ActiveModelEvaluationEntry): Promise<void> => {
    if (!window.confirm(`¿Cancelar ${entry.shortId}?\n\nLa salida quedara sin puntuar.`)) return;
    setCancellingJobId(entry.jobId);
    setCreateError(null);
    const result = await window.luxy.cancelStudioJob(entry.jobId);
    if (!result.ok) setCreateError(result.error);
    else setCancelRequestedJobIds((current) => [...new Set([...current, entry.jobId])]);
    await loadHistory();
    setCancellingJobId(null);
  };

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Laboratorio</h1>
        <Tag>{MODEL_EVALUATIONS.length} pruebas definidas</Tag>
      </div>
      <p className="page__lede">
        Pruebas versionadas para comparar modelos con los mismos prompts, fixtures y criterios.
      </p>

      <Notice tone="warn">
        Ejecucion individual: solo las pruebas automaticas estan habilitadas. Cada envio exige
        confirmacion y puede consumir tokens; Luxy no consulta precios.
      </Notice>

      <Panel title="Preparar una prueba">
        <div className="form-grid">
          <Field label="Maquina">
            <select value={machineId} onChange={(event) => setMachineId(event.target.value)}>
              {machines.length === 0 ? (
                <option value="">Sin maquinas disponibles</option>
              ) : (
                machines.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.enabled || !item.online}>
                    {item.name} · {item.online ? 'conectada' : 'desconectada'}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Field label="Proyecto" hint="Solo identifica el contexto local; la evaluacion no edita.">
            <select value={projectAlias} onChange={(event) => setProjectAlias(event.target.value)}>
              {(machine?.projects ?? []).map((project) => (
                <option key={project} value={project}>
                  {project}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prueba reproducible">
            <select value={evaluation.id} onChange={(event) => setEvaluationId(event.target.value)}>
              {MODEL_EVALUATIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.version}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Modelo compatible"
            hint="Filtrado por capacidades declaradas; todavia no demuestra que funcionen."
          >
            <select
              value={selectedModel?.id ?? ''}
              disabled={compatibleModels.length === 0}
              onChange={(event) => setModelId(event.target.value)}
            >
              {compatibleModels.length === 0 ? (
                <option value="">Sin modelos declarados compatibles</option>
              ) : (
                compatibleModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName} · {model.apiModel}
                  </option>
                ))
              )}
            </select>
          </Field>
        </div>
        <Notice tone="warn">
          Vista previa local: seleccionar un modelo no confirma capacidades ni envia este prompt.
        </Notice>
        <Readout
          items={[
            { label: 'Modelo', value: selectedModel?.apiModel ?? 'ninguno compatible' },
            { label: 'Prompt final', value: `${preview.text.length.toLocaleString()} caracteres` },
            { label: 'Fixture', value: preview.fixtureId ?? 'no necesaria' },
          ]}
        />
        <details>
          <summary>Ver prompt final completo</summary>
          <pre className="mono prewrap">{preview.text}</pre>
        </details>
        <Field
          label="Confirmacion futura"
          hint="Se reinicia al cambiar de prueba o modelo y todavia no envia nada."
        >
          <label className="row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={selectedModel === null || !evaluation.executionEnabled}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Confirmo que esta ejecucion consumiria tokens del modelo seleccionado
          </label>
        </Field>
        {blockReason !== null && <Notice tone="idle">{blockReason}</Notice>}
        {createError !== null && <Notice tone="fault">{createError}</Notice>}
        {createdShortId !== null && (
          <Notice tone="busy">
            {createdShortId} creado. Puedes seguirlo en Trabajos y actualizar este historial al
            terminar.
          </Notice>
        )}
        <button
          className="btn btn--primary"
          type="button"
          disabled={blockReason !== null}
          onClick={() => void execute()}
        >
          {creating ? 'Creando evaluacion…' : 'Ejecutar prueba individual'}
        </button>
      </Panel>

      {activeEntries.length > 0 && (
        <Panel title="Evaluacion activa" actions={<Tag tone="busy">sin polling</Tag>}>
          <ul className="list">
            {activeEntries.map((entry) => (
              <li key={entry.jobId}>
                <div className="list__main">
                  <span>
                    {entry.shortId} ·{' '}
                    {MODEL_EVALUATIONS.find((item) => item.id === entry.evaluationId)?.title ??
                      entry.evaluationId}
                  </span>
                  <button
                    className="btn"
                    type="button"
                    disabled={
                      cancellingJobId !== null || cancelRequestedJobIds.includes(entry.jobId)
                    }
                    onClick={() => void cancelEvaluation(entry)}
                  >
                    {cancellingJobId === entry.jobId
                      ? 'Cancelando…'
                      : cancelRequestedJobIds.includes(entry.jobId)
                        ? 'Cancelacion solicitada'
                        : 'Cancelar'}
                  </button>
                </div>
                <div className="list__meta">
                  {entry.model} · {entry.status} · iniciada {when(entry.createdAt)}
                </div>
              </li>
            ))}
          </ul>
          <p className="list__meta">
            Pulsa Actualizar para leer su estado. Laboratorio no sondea el Gateway.
          </p>
        </Panel>
      )}

      <Panel
        title="Resultados guardados"
        actions={
          <button
            className="btn"
            type="button"
            disabled={historyLoading}
            onClick={() => void loadHistory()}
          >
            Actualizar
          </button>
        }
      >
        <p className="list__meta">
          Una lectura de los últimos 100 trabajos; no ejecuta modelos y no se actualiza por sondeo.
        </p>
        {historyLoading ? (
          <Notice tone="idle">Leyendo historial…</Notice>
        ) : historyError !== null ? (
          <Notice tone="fault">{historyError}</Notice>
        ) : history.length === 0 ? (
          <Empty title="Todavia no hay evaluaciones guardadas">
            El Laboratorio sigue en preparacion. No hace falta ejecutar nada para validar esta
            pantalla.
          </Empty>
        ) : (
          <ResultHistory entries={history} />
        )}
      </Panel>

      {MODEL_EVALUATIONS.map((evaluation) => (
        <EvaluationCard key={evaluation.id} evaluation={evaluation} />
      ))}
    </>
  );
}
