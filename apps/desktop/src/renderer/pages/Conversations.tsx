// Conversaciones: chat persistente y comparacion de dos modelos sobre trabajos reales.
import { useEffect, useMemo, useState, type JSX } from 'react';
import { buildDefaultCatalog, describeArtifactSize } from '@luxy/shared';
import type { JobStatus, ProviderId, StudioJob, StudioMachine } from '@luxy/shared';
import { Empty, Field, Notice, Panel, Tag } from '../ui/primitives.js';
import { FormattedResponse } from '../formatted-response.js';
import type { ConfigSummary } from '../useConfig.js';
import {
  conversationArtifactOf,
  conversationDocumentOf,
  conversationFeedbackOf,
  conversationOutcomeView,
  conversationTiming,
  continuationMessageFor,
  type ConversationDocument,
  formatConversationCount,
  formatTurnCount,
  groupConversationTurns,
  isConversationRunning,
  latestConversationMemory,
  liveConversationPreview,
  localFirstTokenMs,
  recommendConversationTarget,
  type LocalJobStream,
} from '../conversation.js';
import { useConversations } from '../useConversations.js';

const STATUS: Record<JobStatus, string> = {
  queued: 'En cola',
  waiting_for_machine: 'Esperando máquina',
  claimed: 'Preparando',
  running: 'Respondiendo',
  waiting_for_approval: 'Esperando aprobación',
  completed: 'Guardado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  interrupted: 'Interrumpido',
};

function statusTone(status: JobStatus): 'ok' | 'fault' | 'busy' | 'warn' | undefined {
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'interrupted') return 'fault';
  if (status === 'cancelled') return 'warn';
  if (status === 'running' || status === 'claimed') return 'busy';
  return undefined;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function modelSuggestions(provider: ProviderId | '', summary: ConfigSummary): string[] {
  if (provider === '') return [];
  if (provider === 'claude') return [summary.config?.providers.claude.model ?? 'opus'];
  if (provider === 'codex') {
    const configured = summary.config?.providers.codex.model;
    return configured === undefined ? [] : [configured];
  }

  const models = (summary.config?.connections ?? [])
    .flatMap((connection) => buildDefaultCatalog(connection.id))
    .filter((model) => model.family === provider && model.category === 'text')
    .map((model) => model.apiModel);
  return [...new Set(models)];
}

function useMachineSelection(machines: StudioMachine[]): {
  machineId: string;
  setMachineId: (value: string) => void;
  machine: StudioMachine | null;
  projectAlias: string;
  setProjectAlias: (value: string) => void;
} {
  const [machineId, setMachineId] = useState('');
  const [projectAlias, setProjectAlias] = useState('');
  const machine = machines.find((item) => item.id === machineId) ?? null;

  useEffect(() => {
    if (machines.length === 0) {
      setMachineId('');
      return;
    }
    if (!machines.some((item) => item.id === machineId && item.enabled)) {
      setMachineId((machines.find((item) => item.enabled && item.online) ?? machines[0]!).id);
    }
  }, [machineId, machines]);

  useEffect(() => {
    const projects = machine?.projects ?? [];
    if (!projects.includes(projectAlias)) setProjectAlias(projects[0] ?? '');
  }, [machine, projectAlias]);

  return { machineId, setMachineId, machine, projectAlias, setProjectAlias };
}

function ResponseCard({
  job,
  detail,
  busy,
  cancelling,
  document,
  stream,
  onCancel,
  onRate,
  onContinue,
}: {
  job: StudioJob;
  detail: ReturnType<typeof useConversations>['details'][string] | undefined;
  busy: boolean;
  cancelling: boolean;
  /** documento reconstruido cuando esta respuesta continua a otra */
  document: ConversationDocument | null;
  /** streaming en vivo del agente local, cuando lo genera esta maquina */
  stream: LocalJobStream | null;
  onCancel: (jobId: string) => void;
  onRate: (jobId: string, rating: 'helpful' | 'not_helpful') => void;
  onContinue: (job: StudioJob) => void;
}): JSX.Element {
  const events = detail?.events ?? [];
  const timing = conversationTiming(detail?.job ?? job, events);
  // el texto que publica el agente local llega antes y sin pasar por la red;
  // el de los eventos guardados es el respaldo y el de otra maquina
  const preview = stream?.text.trim() || liveConversationPreview(events);
  const current = detail?.job ?? job;
  // con una respuesta continuada se muestra el documento unido, no el trozo
  // suelto: lo que importa es la pagina entera, no el ultimo fragmento
  const joined = current.resultSummary === null ? null : document;
  const text =
    joined?.text ??
    current.resultSummary ??
    preview ??
    (job.status === 'queued' ? 'Esperando a que el agente recoja la respuesta…' : 'Preparando…');
  const artifact = conversationArtifactOf(current);
  const feedback = conversationFeedbackOf(current);
  const outcome = conversationOutcomeView(current);
  // el texto parcial se ve SIEMPRE que exista, tambien con error delante:
  // 23 minutos de generacion no se esconden detras de un aviso rojo
  const partial = current.resultSummary?.trim() ?? '';
  const showsText = current.errorMessage === null || partial.length > 0;

  return (
    <article className="conversation-response" data-status={current.status}>
      <header className="conversation-response__head">
        <div>
          <div className="list__name">
            {current.provider}
            {current.model === null ? '' : ` / ${current.model}`}
          </div>
          <div className="list__meta mono">
            primer texto {formatDuration(timing.firstTokenMs ?? localFirstTokenMs(current, stream))}{' '}
            · total {formatDuration(outcome?.durationMs ?? timing.durationMs)}
            {outcome?.tokens != null &&
              ` · tokens ${outcome.tokens.input}/${outcome.tokens.output}`}
          </div>
        </div>
        <Tag tone={outcome === null ? statusTone(current.status) : outcome.tone}>
          {outcome === null ? STATUS[current.status] : outcome.label}
        </Tag>
      </header>
      {outcome !== null && outcome.outcome !== 'completed' && (
        <Notice tone={outcome.tone === 'fault' ? 'fault' : 'warn'}>{outcome.detail}</Notice>
      )}
      {joined !== null && (
        <p className="list__meta">
          Documento unido a partir de {joined.fragments} respuestas · {joined.notes.at(-1)}
        </p>
      )}
      {joined?.needsReview === true && (
        <Notice tone="warn">
          Alguna costura se pego sin poder demostrar que encajaba: revisa el punto de union antes de
          dar el documento por bueno.
        </Notice>
      )}
      {artifact !== null && (
        <p className="list__meta">
          Guardado como archivo: <span className="mono">{artifact.fileName}</span> ·{' '}
          {describeArtifactSize(artifact.bytes)}{' '}
          <button
            className="btn btn--quiet"
            onClick={() => void window.luxy.openArtifactFolder(current.id)}
          >
            Abrir carpeta
          </button>
        </p>
      )}
      {showsText && <FormattedResponse text={text} />}
      {current.errorMessage !== null && <Notice tone="fault">{current.errorMessage}</Notice>}
      {outcome?.memoryNote != null && <p className="list__meta">{outcome.memoryNote}</p>}
      {outcome?.canContinue === true && (
        <button
          className="btn btn--primary btn--quiet"
          disabled={busy}
          onClick={() => onContinue(current)}
        >
          Continuar generación
        </button>
      )}
      {isConversationRunning(current) && (
        <button
          className="btn btn--danger btn--quiet"
          disabled={busy || cancelling}
          onClick={() => onCancel(job.id)}
        >
          {cancelling ? 'Deteniendo…' : 'Detener'}
        </button>
      )}
      {current.status === 'completed' && (
        <div className="conversation-feedback" aria-label="Valorar respuesta">
          <span className="list__meta">¿Te sirvió?</span>
          <button
            className="btn btn--quiet"
            data-selected={feedback === 'helpful'}
            disabled={busy}
            onClick={() => onRate(current.id, 'helpful')}
          >
            Util
          </button>
          <button
            className="btn btn--quiet"
            data-selected={feedback === 'not_helpful'}
            disabled={busy}
            onClick={() => onRate(current.id, 'not_helpful')}
          >
          No me sirvió
          </button>
        </div>
      )}
    </article>
  );
}

export function ConversationsPage({ summary }: { summary: ConfigSummary }): JSX.Element {
  const conversations = useConversations();
  const { machineId, setMachineId, machine, projectAlias, setProjectAlias } = useMachineSelection(
    conversations.machines,
  );
  const providers = useMemo(() => machine?.providers ?? [], [machine]);
  const [providerA, setProviderA] = useState<ProviderId | ''>('');
  const [providerB, setProviderB] = useState<ProviderId | ''>('');
  const [modelA, setModelA] = useState('');
  const [modelB, setModelB] = useState('');
  const [compare, setCompare] = useState(false);
  const [message, setMessage] = useState('');
  // respuesta cortada que el proximo envio continua; se limpia al enviar
  const [continuesJobId, setContinuesJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!providers.includes(providerA as ProviderId)) setProviderA(providers[0] ?? '');
    if (!providers.includes(providerB as ProviderId))
      setProviderB(providers[1] ?? providers[0] ?? '');
  }, [providerA, providerB, providers]);

  const turns = useMemo(
    () => groupConversationTurns(conversations.selected?.jobs ?? []),
    [conversations.selected],
  );
  const activeMemory = useMemo(
    () => latestConversationMemory(conversations.selected?.jobs ?? []),
    [conversations.selected],
  );
  const recommendation = useMemo(
    () => recommendConversationTarget(conversations.history, providers, projectAlias, message),
    [conversations.history, message, projectAlias, providers],
  );
  const sameTarget =
    compare &&
    providerA === providerB &&
    modelA.trim().toLowerCase() === modelB.trim().toLowerCase();
  const canSend =
    machine !== null &&
    machine.enabled &&
    projectAlias.length > 0 &&
    providerA !== '' &&
    (!compare || providerB !== '') &&
    !sameTarget &&
    message.trim().length > 0 &&
    !conversations.busy;

  const send = async (): Promise<void> => {
    if (!canSend || machine === null) return;
    const targets = [
      { provider: providerA, model: modelA.trim().length === 0 ? null : modelA.trim() },
      ...(compare && providerB !== ''
        ? [{ provider: providerB, model: modelB.trim().length === 0 ? null : modelB.trim() }]
        : []),
    ];
    const sent = await conversations.send({
      machineId: machine.id,
      projectAlias,
      message: message.trim(),
      targets,
      continuesJobId,
    });
    if (sent) {
      setMessage('');
      setContinuesJobId(null);
    }
  };

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Conversaciones</h1>
        <Tag>{formatConversationCount(conversations.conversations.length)}</Tag>
      </div>
      <p className="page__lede">
        Consulta un modelo o compara dos con la misma pregunta. Las respuestas se transmiten desde
        la maquina elegida y quedan guardadas en el historial real de Luxy.
      </p>

      {conversations.error !== null && <Notice tone="fault">{conversations.error}</Notice>}
      {conversations.loading && <Notice tone="warn">Cargando conversaciones…</Notice>}

      <div className="conversation-shell">
        <Panel
          title="Historial"
          flush
          actions={
            <button
              className="btn btn--primary btn--quiet"
              onClick={() => {
                setContinuesJobId(null);
                conversations.startNew();
              }}
            >
              Nueva
            </button>
          }
        >
          {conversations.conversations.length === 0 ? (
            <Empty title="Sin conversaciones">Escribe el primer mensaje para crear una.</Empty>
          ) : (
            <ul className="list conversation-list">
              {conversations.conversations.map((conversation) => (
                <li
                  key={conversation.id}
                  data-selected={conversation.id === conversations.selected?.id}
                >
                  <button
                    className="conversation-list__button"
                    onClick={() => {
                      setContinuesJobId(null);
                      conversations.select(conversation.id);
                    }}
                  >
                    <span className="list__name">{conversation.title}</span>
                    <span className="list__meta">
                      {formatTurnCount(groupConversationTurns(conversation.jobs).length)} · guardada
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <section className="conversation-main">
          <Panel title={conversations.selected?.title ?? 'Nueva conversacion'}>
            {turns.length === 0 ? (
              <Empty title="Pregunta a tus modelos">
                Elige una maquina, un proyecto y uno o dos modelos. Conversaciones siempre trabaja
                en modo de solo lectura.
              </Empty>
            ) : (
              <div className="conversation-thread">
                {turns.map((turn) => (
                  <div className="conversation-turn" key={turn.id}>
                    <div className="conversation-user">
                      <div className="silk">Tu mensaje</div>
                      <p className="prewrap">{turn.userMessage}</p>
                    </div>
                    <div className="conversation-answers" data-columns={turn.jobs.length}>
                      {turn.jobs.map((job) => (
                        <ResponseCard
                          key={job.id}
                          job={job}
                          detail={conversations.details[job.id]}
                          busy={conversations.busy}
                          cancelling={conversations.cancellingIds.has(job.id)}
                          onCancel={(jobId) => void conversations.cancel(jobId)}
                          onRate={(jobId, rating) => void conversations.rate(jobId, rating)}
                          document={conversationDocumentOf(job, conversations.selected?.jobs ?? [])}
                          stream={conversations.localStreams[job.id] ?? null}
                          onContinue={(source) => {
                            // se reutiliza el mismo modelo: continuar con otro
                            // distinto es empezar una respuesta nueva
                            setProviderA(source.provider);
                            setModelA(source.model ?? '');
                            setCompare(false);
                            setMessage(continuationMessageFor(source));
                            setContinuesJobId(source.id);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {activeMemory !== null && (
            <Panel title="Memoria activa" actions={<Tag tone="ok">contexto persistente</Tag>}>
              <p className="conversation-memory__summary">{activeMemory.memory.summary}</p>
              <div className="conversation-memory__grid">
                {(
                  [
                    ['Hechos', activeMemory.memory.facts],
                    ['Decisiones', activeMemory.memory.decisions],
                    ['Plan', activeMemory.memory.plan],
                    ['Preguntas abiertas', activeMemory.memory.openQuestions],
                    ['Lecciones', activeMemory.memory.lessons],
                  ] satisfies Array<[string, string[]]>
                ).map(([title, entries]) =>
                  entries.length > 0 ? (
                    <section key={String(title)}>
                      <div className="silk">{title}</div>
                      <ul>
                        {entries.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null,
                )}
              </div>
              <p className="list__meta">
                Luxy guarda este resumen con el trabajo y lo reenvia en el siguiente turno. Tambien
                recupera memorias relacionadas del mismo proyecto.
              </p>
            </Panel>
          )}

          <Panel title="Enviar mensaje">
            {conversations.machines.length === 0 ? (
              <Empty title="Sin maquinas disponibles">
                Arranca y registra una maquina antes de conversar.
              </Empty>
            ) : (
              <div className="conversation-composer">
                {continuesJobId !== null && (
                  <Notice tone="warn">
                    Este envio continua una respuesta cortada: al modelo se le pasa su final como
                    dato y Luxy unira los dos fragmentos.{' '}
                    <button className="btn btn--quiet" onClick={() => setContinuesJobId(null)}>
                      Enviar como mensaje normal
                    </button>
                  </Notice>
                )}
                <div className="conversation-settings">
                  <Field label="Maquina">
                    <select
                      value={machineId}
                      onChange={(event) => setMachineId(event.target.value)}
                    >
                      {conversations.machines.map((item) => (
                        <option key={item.id} value={item.id} disabled={!item.enabled}>
                          {item.name} · {item.online ? 'conectada' : 'desconectada'}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Proyecto" hint="Solo se usa como contexto de lectura.">
                    <select
                      value={projectAlias}
                      onChange={(event) => setProjectAlias(event.target.value)}
                    >
                      {(machine?.projects ?? []).map((project) => (
                        <option key={project} value={project}>
                          {project}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="conversation-compare">
                    <input
                      type="checkbox"
                      checked={compare}
                      onChange={(event) => setCompare(event.target.checked)}
                    />
                    Comparar dos modelos
                  </label>
                </div>

                {message.trim().length > 2 && recommendation !== null && (
                  <div className="conversation-recommendation">
                    <div>
                      <div className="silk">Recomendacion de Luxy</div>
                      <strong>
                        {recommendation.provider}
                        {recommendation.model === null ? '' : ` / ${recommendation.model}`}
                      </strong>
                      <p>{recommendation.reason}</p>
                    </div>
                    <button
                      className="btn btn--quiet"
                      onClick={() => {
                        setProviderA(recommendation.provider);
                        setModelA(recommendation.model ?? '');
                      }}
                    >
                      Usar recomendacion
                    </button>
                  </div>
                )}

                <div className="conversation-targets" data-columns={compare ? 2 : 1}>
                  <div>
                    <Field label={compare ? 'Modelo A · proveedor' : 'Proveedor'}>
                      <select
                        value={providerA}
                        onChange={(event) => setProviderA(event.target.value as ProviderId)}
                      >
                        {providers.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Modelo exacto" hint="Vacio usa el predeterminado.">
                      <input
                        type="text"
                        list="conversation-model-a"
                        value={modelA}
                        onChange={(event) => setModelA(event.target.value)}
                        placeholder="predeterminado"
                        spellCheck={false}
                      />
                      <datalist id="conversation-model-a">
                        {modelSuggestions(providerA, summary).map((model) => (
                          <option key={model} value={model} />
                        ))}
                      </datalist>
                    </Field>
                  </div>
                  {compare && (
                    <div>
                      <Field label="Modelo B · proveedor">
                        <select
                          value={providerB}
                          onChange={(event) => setProviderB(event.target.value as ProviderId)}
                        >
                          {providers.map((provider) => (
                            <option key={provider} value={provider}>
                              {provider}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Modelo exacto" hint="Debe ser distinto del modelo A.">
                        <input
                          type="text"
                          list="conversation-model-b"
                          value={modelB}
                          onChange={(event) => setModelB(event.target.value)}
                          placeholder="predeterminado"
                          spellCheck={false}
                        />
                        <datalist id="conversation-model-b">
                          {modelSuggestions(providerB, summary).map((model) => (
                            <option key={model} value={model} />
                          ))}
                        </datalist>
                      </Field>
                    </div>
                  )}
                </div>

                {sameTarget && (
                  <Notice tone="warn">
                    Elige dos proveedores o modelos distintos para comparar.
                  </Notice>
                )}
                <Field label="Mensaje">
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={5}
                    maxLength={6000}
                    placeholder="Escribe tu pregunta…"
                  />
                </Field>
                <div className="conversation-send">
                  <span className="list__meta">
        Solo lectura · guardado automático · sin commit ni push
                  </span>
                  <button
                    className="btn btn--primary"
                    disabled={!canSend}
                    onClick={() => void send()}
                  >
                    {compare ? 'Enviar a los dos' : 'Enviar'}
                  </button>
                </div>
              </div>
            )}
          </Panel>
        </section>
      </div>
    </>
  );
}
