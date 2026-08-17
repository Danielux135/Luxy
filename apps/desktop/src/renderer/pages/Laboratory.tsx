// Catalogo y ejecucion controlada del Laboratorio. Nunca hace red ni ejecuta
// modelos hasta que exista una confirmacion explicita.
import {
  EXECUTABLE_MODEL_EVALUATIONS,
  MODEL_EVALUATIONS,
  buildModelEvaluationPrompt,
  getModelEvaluationFixture,
  modelDeclaresEvaluationCapabilities,
  type ModelEvaluationDefinition,
  type StoredModelEvaluationResult,
  type StudioJob,
  type StudioJobCreateRequest,
  type StudioMachine,
} from '@luxy/shared';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { createControlledEvaluationPair } from '../evaluation-comparison.js';
import { assessModelEvaluationRecommendation } from '../evaluation-recommendation.js';
import {
  MIN_EVALUATION_EVIDENCE_SAMPLES,
  aggregateModelEvaluationEvidence,
  collectActiveModelEvaluations,
  collectModelEvaluationComparisons,
  collectModelEvaluationHistory,
  collectUnscoredTerminalEvaluations,
  type ActiveModelEvaluationEntry,
  type ModelEvaluationComparison,
  type ModelEvaluationHistoryEntry,
  type UnscoredTerminalEvaluationEntry,
} from '../evaluation-history.js';
import {
  evaluationComparisonBlockReason,
  evaluationExecutionBlockReason,
  evaluationProvider,
} from '../evaluation-run-policy.js';
import { Empty, Field, Notice, Panel, Readout, Tag, type Tone } from '../ui/primitives.js';
import type { ConfigSummary } from '../useConfig.js';
import { useDetectedCatalog } from '../useCatalog.js';

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

function responseTime(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds.toLocaleString()} ms`;
  if (milliseconds < 60_000)
    return `${(milliseconds / 1000).toFixed(1)} s (${milliseconds.toLocaleString()} ms)`;
  return `${(milliseconds / 60_000).toFixed(1)} min (${milliseconds.toLocaleString()} ms)`;
}

function durationLabel(result: StoredModelEvaluationResult): string {
  if (result.responseOutcome === 'failed') return 'Duracion hasta el fallo';
  if (result.responseOutcome === 'cancelled') return 'Duracion hasta la cancelacion';
  if (result.responseOutcome === 'timed_out') return 'Duracion hasta agotar el tiempo';
  return 'Tiempo de respuesta';
}

function ResultHistory({
  entries,
}: {
  entries: readonly ModelEvaluationHistoryEntry[];
}): JSX.Element {
  return (
    <ul className="list evaluation-history">
      {entries.slice(0, 12).map((entry) => {
        const definition = MODEL_EVALUATIONS.find((item) => item.id === entry.result.evaluationId);
        const passedChecks = entry.result.checks.filter((check) => check.passed).length;
        return (
          <li key={entry.jobId} className="evaluation-history__entry">
            <div className="evaluation-history__header">
              <strong className="evaluation-history__title">
                {definition?.title ?? entry.result.evaluationId}
              </strong>
              <span className="row">
                <Tag tone={resultTone(entry.result.status)}>
                  {RESULT_LABELS[entry.result.status]}
                </Tag>
                <Tag>{entry.result.model}</Tag>
              </span>
            </div>
            <div className="evaluation-history__metrics list__meta">
              <span>
                {entry.shortId} · {when(entry.validatedAt ?? entry.createdAt)}
              </span>
              <span>
                {durationLabel(entry.result)}: {responseTime(entry.result.durationMs)}
              </span>
              <span>{entry.result.outputChars.toLocaleString()} caracteres</span>
              <span>
                {entry.result.inputTokens === null || entry.result.outputTokens === null
                  ? 'Tokens no disponibles'
                  : `${entry.result.inputTokens} entrada / ${entry.result.outputTokens} salida`}
              </span>
              {entry.result.checks.length > 0 && (
                <span>
                  Checks: {passedChecks}/{entry.result.checks.length}
                </span>
              )}
            </div>
            {entry.result.reason !== null && (
              <div className="evaluation-history__reason list__meta">{entry.result.reason}</div>
            )}
            <details className="evaluation-history__evidence">
              <summary>Ver evidencia reproducible</summary>
              <div className="list__meta">
                {entry.provider} · {entry.projectAlias} · máquina{' '}
                {entry.targetMachineId ?? 'no registrada'} · {entry.result.validationMode} ·{' '}
                {entry.result.scoring}
              </div>
              <p className="silk">Prompt guardado</p>
              <pre className="mono prewrap">{entry.prompt}</pre>
              <p className="silk">Respuesta guardada</p>
              <pre className="mono prewrap">{entry.response ?? 'Sin respuesta persistida'}</pre>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function UnscoredTerminalHistory({
  entries,
}: {
  entries: readonly UnscoredTerminalEvaluationEntry[];
}): JSX.Element {
  return (
    <ul className="list evaluation-history">
      {entries.slice(0, 12).map((entry) => (
        <li key={entry.jobId} className="evaluation-history__entry">
          <div className="evaluation-history__header">
            <strong className="evaluation-history__title">
              {MODEL_EVALUATIONS.find((item) => item.id === entry.evaluationId)?.title ??
                entry.evaluationId}
            </strong>
            <span className="row">
              <Tag tone="warn">Sin resultado validado</Tag>
              <Tag>{entry.model}</Tag>
            </span>
          </div>
          <div className="evaluation-history__metrics list__meta">
            <span>{entry.shortId}</span>
            <span>{entry.status}</span>
            <span>{when(entry.createdAt)}</span>
          </div>
          <div className="evaluation-history__reason list__meta">{entry.reason}</div>
        </li>
      ))}
    </ul>
  );
}

function ComparisonHistory({
  comparisons,
}: {
  comparisons: readonly ModelEvaluationComparison[];
}): JSX.Element {
  const terminal = ['completed', 'failed', 'cancelled', 'interrupted'];
  return (
    <ul className="list comparison-list">
      {comparisons.slice(0, 12).map((comparison) => (
        <li key={comparison.groupId} className="comparison-entry">
          <div className="comparison-entry__header">
            <strong className="comparison-entry__title">
              {MODEL_EVALUATIONS.find((item) => item.id === comparison.evaluationId)?.title ??
                comparison.evaluationId}{' '}
              · v{comparison.evaluationVersion}
            </strong>
            <Tag tone={comparison.issue === null ? 'ok' : 'warn'}>
              {comparison.issue === null ? 'Par terminado' : 'Par incompleto'}
            </Tag>
          </div>
          <div className="list__meta mono">Grupo {comparison.groupId}</div>
          <ul className="list comparison-members">
            {comparison.members.map((member) => (
              <li key={member.jobId} className="comparison-member">
                <div className="comparison-member__identity">
                  <strong className="comparison-member__name">
                    Modelo {member.index === 0 ? 'A' : 'B'} · {member.model}
                  </strong>
                  <span className="row">
                    <Tag>{member.status}</Tag>
                    {member.result === null ? (
                      <Tag tone="warn">
                        {terminal.includes(member.status)
                          ? 'Sin resultado validado'
                          : 'Resultado pendiente'}
                      </Tag>
                    ) : (
                      <Tag tone={resultTone(member.result.status)}>
                        {RESULT_LABELS[member.result.status]}
                      </Tag>
                    )}
                  </span>
                </div>
                <div className="comparison-member__meta list__meta">
                  {member.shortId} · {when(member.createdAt)}
                  {member.result === null
                    ? ''
                    : ` · ${durationLabel(member.result)}: ${responseTime(member.result.durationMs)}`}
                </div>
              </li>
            ))}
          </ul>
          {comparison.issue !== null && <Notice tone="warn">{comparison.issue}</Notice>}
        </li>
      ))}
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
  const [evaluationId, setEvaluationId] = useState(EXECUTABLE_MODEL_EVALUATIONS[0]!.id);
  const [modelId, setModelId] = useState('');
  const [secondModelId, setSecondModelId] = useState('');
  const [executionMode, setExecutionMode] = useState<'individual' | 'comparison'>('individual');
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState<ModelEvaluationHistoryEntry[]>([]);
  const [unscoredTerminal, setUnscoredTerminal] = useState<UnscoredTerminalEvaluationEntry[]>([]);
  const [comparisons, setComparisons] = useState<ModelEvaluationComparison[]>([]);
  const [studioJobs, setStudioJobs] = useState<StudioJob[]>([]);
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
  const [pendingConfirmation, setPendingConfirmation] = useState<
    { kind: 'execute' } | { kind: 'cancel'; entry: ActiveModelEvaluationEntry } | null
  >(null);
  const evaluation =
    EXECUTABLE_MODEL_EVALUATIONS.find((item) => item.id === evaluationId) ??
    EXECUTABLE_MODEL_EVALUATIONS[0]!;
  const { models } = useDetectedCatalog(summary);
  const compatibleModels = models.filter((model) =>
    modelDeclaresEvaluationCapabilities(model, evaluation),
  );
  const selectedModel =
    compatibleModels.find((model) => model.id === modelId) ?? compatibleModels[0] ?? null;
  const selectedSecondModel =
    compatibleModels.find(
      (model) => model.id === secondModelId && model.id !== selectedModel?.id,
    ) ??
    compatibleModels.find((model) => model.id !== selectedModel?.id) ??
    null;
  const preview = buildModelEvaluationPrompt(evaluation.id)!;
  const machine = machines.find((item) => item.id === machineId) ?? null;
  const provider = evaluationProvider(selectedModel);
  const evidence = aggregateModelEvaluationEvidence(history);
  const recommendation = assessModelEvaluationRecommendation({
    evaluation,
    entries: history,
    jobs: studioJobs,
    allowedModels: compatibleModels.map((model) => model.apiModel),
    projectAlias,
  });

  useEffect(() => {
    setConfirmed(false);
  }, [evaluation.id, executionMode, selectedModel?.id, selectedSecondModel?.id]);

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
      const jobs = historyResult.value.jobs;
      setHistory(collectModelEvaluationHistory(jobs));
      setUnscoredTerminal(collectUnscoredTerminalEvaluations(jobs));
      setComparisons(collectModelEvaluationComparisons(jobs));
      setStudioJobs(jobs);
      setMachines(optionsResult.value.machines);
      const active = collectActiveModelEvaluations(jobs);
      setActiveEntries(active);
      setActiveEvaluation(active.length > 0);
      setHistoryError(null);
    } else if (!historyResult.ok) {
      setHistoryError(historyResult.error);
    } else if (!optionsResult.ok) {
      setHistoryError(optionsResult.error);
    }
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (activeEntries.length === 0) return;
    const timer = window.setInterval(() => void loadHistory(), 5_000);
    return () => window.clearInterval(timer);
  }, [activeEntries.length, loadHistory]);

  const executionPolicy = {
    evaluation,
    model: selectedModel,
    machine,
    projectAlias,
    activeEvaluation,
    confirmed,
    busy: creating,
  };
  const blockReason =
    executionMode === 'comparison'
      ? evaluationComparisonBlockReason({
          ...executionPolicy,
          secondModel: selectedSecondModel,
        })
      : evaluationExecutionBlockReason(executionPolicy);

  const execute = async (): Promise<void> => {
    const secondProvider = evaluationProvider(selectedSecondModel);
    if (
      blockReason !== null ||
      selectedModel === null ||
      machine === null ||
      provider === null ||
      (executionMode === 'comparison' && (selectedSecondModel === null || secondProvider === null))
    ) {
      return;
    }
    const comparison = executionMode === 'comparison' && selectedSecondModel !== null;
    setCreating(true);
    setCreateError(null);
    setCreatedShortId(null);
    const buildRequest = (
      model: typeof selectedModel,
      requestProvider: typeof provider,
      comparisonGroupId?: string,
      comparisonIndex?: 0 | 1,
    ): StudioJobCreateRequest => ({
      targetMachineId: machine.id,
      provider: requestProvider,
      model: model.apiModel,
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
        ...(comparisonGroupId === undefined ? {} : { comparisonGroupId, comparisonIndex }),
      },
    });

    if (comparison && secondProvider !== null) {
      const comparisonGroupId = crypto.randomUUID();
      const result = await createControlledEvaluationPair(
        (request) => window.luxy.createStudioJob(request),
        buildRequest(selectedModel, provider, comparisonGroupId, 0),
        buildRequest(selectedSecondModel, secondProvider, comparisonGroupId, 1),
      );
      setCreatedShortId(result.shortIds.length === 0 ? null : result.shortIds.join(' + '));
      setCreateError(result.error);
      if (result.shortIds.length > 0) await loadHistory();
      if (result.status === 'complete') setConfirmed(false);
    } else {
      const result = await window.luxy.createStudioJob(buildRequest(selectedModel, provider));
      if (result.ok) {
        setCreatedShortId(result.value.job.shortId);
        setConfirmed(false);
        await loadHistory();
      } else {
        setCreateError(result.error);
      }
    }
    setCreating(false);
  };

  const cancelEvaluation = async (entry: ActiveModelEvaluationEntry): Promise<void> => {
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
        <Tag>
          {EXECUTABLE_MODEL_EVALUATIONS.length} ejecutables · {MODEL_EVALUATIONS.length} definidas
        </Tag>
      </div>
      <p className="page__lede">
        Pruebas versionadas para comparar modelos con los mismos prompts, fixtures y criterios.
      </p>

      <Notice tone="warn">
        Solo las pruebas automaticas estan habilitadas. Cada ejecucion individual o comparacion
        exige confirmacion y puede consumir tokens; Luxy no consulta precios.
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
              {EXECUTABLE_MODEL_EVALUATIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.version} · automática
                </option>
              ))}
            </select>
          </Field>
          <Field label="Modo de ejecucion">
            <select
              value={executionMode}
              onChange={(event) =>
                setExecutionMode(event.target.value as 'individual' | 'comparison')
              }
            >
              <option value="individual">Prueba individual</option>
              <option value="comparison">Comparar dos modelos</option>
            </select>
          </Field>
          <Field
            label={executionMode === 'comparison' ? 'Modelo A compatible' : 'Modelo compatible'}
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
          {executionMode === 'comparison' && (
            <Field
              label="Modelo B compatible"
              hint="Debe ser un modelo exacto distinto y estar disponible en la misma maquina."
            >
              <select
                value={selectedSecondModel?.id ?? ''}
                disabled={compatibleModels.length < 2}
                onChange={(event) => setSecondModelId(event.target.value)}
              >
                {compatibleModels
                  .filter((model) => model.id !== selectedModel?.id)
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName} · {model.apiModel}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </div>
        <Notice tone="warn">
          Vista previa local: este formulario sólo incluye las cuatro pruebas automáticas.
          Seleccionar un modelo no confirma capacidades ni envía el prompt. Las pruebas que
          necesitan revisión, sandbox o trazas siguen documentadas más abajo como pendientes.
        </Notice>
        <Readout
          items={[
            {
              label: executionMode === 'comparison' ? 'Modelo A' : 'Modelo',
              value: selectedModel?.apiModel ?? 'ninguno compatible',
            },
            ...(executionMode === 'comparison'
              ? [
                  {
                    label: 'Modelo B',
                    value: selectedSecondModel?.apiModel ?? 'ninguno compatible',
                  },
                ]
              : []),
            { label: 'Prompt final', value: `${preview.text.length.toLocaleString()} caracteres` },
            { label: 'Fixture', value: preview.fixtureId ?? 'no necesaria' },
          ]}
        />
        <details>
          <summary>Ver prompt final completo</summary>
          <pre className="mono prewrap">{preview.text}</pre>
        </details>
        <Field
          label="Confirmacion de consumo"
          hint="Se reinicia al cambiar de prueba, modo o modelo y por si sola no envia nada."
        >
          <label className="row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={selectedModel === null || !evaluation.executionEnabled}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Confirmo que esta ejecucion puede consumir tokens del modelo o modelos seleccionados
          </label>
        </Field>
        {blockReason !== null && <Notice tone="idle">{blockReason}</Notice>}
        {createError !== null && <Notice tone="fault">{createError}</Notice>}
        {createdShortId !== null && (
          <Notice tone="busy">
            {createdShortId} creado. Puedes seguirlo en Trabajos y actualizar este historial al
            terminar. En una comparacion, ambos identificadores comparten prompt y grupo.
          </Notice>
        )}
        <button
          className="btn btn--primary"
          type="button"
          disabled={blockReason !== null}
          onClick={() => setPendingConfirmation({ kind: 'execute' })}
        >
          {creating
            ? 'Creando evaluacion…'
            : executionMode === 'comparison'
              ? 'Ejecutar comparacion controlada'
              : 'Ejecutar prueba individual'}
        </button>
      </Panel>

      {activeEntries.length > 0 && (
        <Panel title="Evaluacion activa" actions={<Tag tone="busy">actualizacion cada 5 s</Tag>}>
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
                    onClick={() => setPendingConfirmation({ kind: 'cancel', entry })}
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
            Se actualiza mientras haya evaluaciones activas. Tambien puedes pulsar Actualizar.
          </p>
        </Panel>
      )}

      {comparisons.length > 0 && (
        <Panel title="Comparaciones controladas" actions={<Tag>mismo prompt</Tag>}>
          <p className="list__meta">
            Pares reconstruidos sólo por UUID e índice guardados. Un miembro ausente, cancelado o
            sin resultado permanece visible y nunca se sustituye por otra ejecución cercana.
          </p>
          <ComparisonHistory comparisons={comparisons} />
        </Panel>
      )}

      {evidence.length > 0 && (
        <Panel title="Evidencia descriptiva" actions={<Tag>sin ranking</Tag>}>
          <p className="list__meta">
            Agrupada por prueba, version y modelo. Luxy necesita al menos{' '}
            {MIN_EVALUATION_EVIDENCE_SAMPLES} resultados puntuados para mostrar una tasa.
          </p>
          <ul className="list">
            {evidence.map((summary) => (
              <li key={`${summary.evaluationId}:${summary.evaluationVersion}:${summary.model}`}>
                <div className="list__main">
                  <span>
                    {MODEL_EVALUATIONS.find((item) => item.id === summary.evaluationId)?.title ??
                      summary.evaluationId}{' '}
                    · v{summary.evaluationVersion}
                  </span>
                  <Tag>{summary.model}</Tag>
                </div>
                <div className="list__meta">
                  {summary.passRate === null
                    ? `Muestra insuficiente: ${summary.scored}/${MIN_EVALUATION_EVIDENCE_SAMPLES} puntuados`
                    : `${Math.round(summary.passRate * 100)}% validado · ${summary.passed}/${summary.scored}`}
                  {` · ${summary.notScored} sin puntuar`}
                  {summary.medianDurationMs === null
                    ? ''
                    : ` · mediana de respuesta ${responseTime(summary.medianDurationMs)}`}
                  {summary.medianOutputTokens === null
                    ? ''
                    : ` · ${summary.medianOutputTokens.toLocaleString()} tokens salida`}
                </div>
              </li>
            ))}
          </ul>
          <Notice tone="idle">
            Estos datos describen ejecuciones locales; no recomiendan un modelo ni comparan pruebas
            distintas.
          </Notice>
        </Panel>
      )}

      <Panel
        title="Recomendación local"
        actions={<Tag tone={recommendation.status === 'recommended' ? 'ok' : 'warn'}>prudente</Tag>}
      >
        {recommendation.recommendation !== null ? (
          <>
            <div className="list__main">
              <span>{recommendation.recommendation.model}</span>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const model = compatibleModels.find(
                    (item) => item.apiModel === recommendation.recommendation?.model,
                  );
                  if (model !== undefined) setModelId(model.id);
                }}
              >
                Seleccionar modelo
              </button>
            </div>
            <p className="list__meta">{recommendation.recommendation.reason}</p>
            <Notice tone="idle">
              Recomendación provisional para esta prueba y versión. Seleccionarla no ejecuta nada ni
              sustituye tu confirmación.
            </Notice>
          </>
        ) : recommendation.status === 'insufficient_samples' ? (
          <Notice tone="idle">
            Sin recomendación: hacen falta al menos dos modelos con tres resultados puntuados cada
            uno para esta misma prueba y versión.
          </Notice>
        ) : (
          <Notice tone="idle">
            Sin recomendación: la evidencia suficiente continúa empatada y Luxy no fuerza un
            ganador.
          </Notice>
        )}
      </Panel>

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
        ) : history.length === 0 && unscoredTerminal.length === 0 ? (
          <Empty title="Todavía no hay evaluaciones guardadas">
            El Laboratorio sigue en preparacion. No hace falta ejecutar nada para validar esta
            pantalla.
          </Empty>
        ) : (
          <>
            {history.length > 0 && <ResultHistory entries={history} />}
            {unscoredTerminal.length > 0 && <UnscoredTerminalHistory entries={unscoredTerminal} />}
          </>
        )}
      </Panel>

      {pendingConfirmation !== null && (
        <div className="confirm-layer" role="presentation">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evaluation-confirm-title"
          >
            <div className="silk" id="evaluation-confirm-title">
              Confirmar accion
            </div>
            {pendingConfirmation.kind === 'execute' ? (
              <>
                <p>
                  ¿Ejecutar {executionMode === 'comparison' ? 'la comparacion' : 'la prueba'}{' '}
                  <strong>{evaluation.title}</strong>?
                </p>
                <div className="list__meta">
                  Modelo A: {selectedModel?.apiModel ?? 'ninguno'}
                  {executionMode === 'comparison'
                    ? ` · Modelo B: ${selectedSecondModel?.apiModel ?? 'ninguno'}`
                    : ''}
                  {' · '}Maquina: {machine?.name ?? 'ninguna'}
                </div>
                <Notice tone="warn">
                  Puede consumir tokens. Luxy no consulta ni conoce el precio.
                </Notice>
              </>
            ) : (
              <p>
                ¿Cancelar <strong>{pendingConfirmation.entry.shortId}</strong>? La salida quedara
                sin puntuar.
              </p>
            )}
            <div className="confirm-dialog__actions">
              <button className="btn" type="button" onClick={() => setPendingConfirmation(null)}>
                Volver
              </button>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => {
                  const pending = pendingConfirmation;
                  setPendingConfirmation(null);
                  if (pending.kind === 'execute') void execute();
                  else void cancelEvaluation(pending.entry);
                }}
              >
                {pendingConfirmation.kind === 'execute' ? 'Ejecutar' : 'Cancelar evaluacion'}
              </button>
            </div>
          </section>
        </div>
      )}

      {MODEL_EVALUATIONS.map((evaluation) => (
        <EvaluationCard key={evaluation.id} evaluation={evaluation} />
      ))}
    </>
  );
}
