// Proyectos, Conexiones y Modelos.
import { useEffect, useState, type JSX } from 'react';
import {
  ModelRegistry,
  buildCatalogForConnection,
  buildDefaultCatalog,
  guessModelFamily,
  type CatalogSnapshot,
  type ConnectionProfile,
  type ModelFamily,
  type ResolvedModel,
  type StoredAgentConfig,
} from '@luxy/shared';
import { connectionSecretName } from '../../shared/ipc.js';
import {
  describeModelEvidence,
  loadModelEvidenceHistory,
  summarizeModelEvidence,
} from '../model-evidence.js';
import type { ModelEvidence } from '../model-evidence.js';
import { Empty, Field, Notice, Panel, Tag } from '../ui/primitives.js';
import type { ConfigSummary } from '../useConfig.js';

const FAMILIA: Record<ModelFamily, string> = {
  deepseek: 'DeepSeek',
  glm: 'GLM',
  hunyuan: 'Hunyuan',
  kat: 'KAT',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  other: 'Otros',
  qwen: 'Qwen',
  sensenova: 'SenseNova',
  step: 'Step',
  stepaudio: 'StepAudio',
  stepimage: 'Step Image',
  router: 'Enrutado',
};

/**
 * construye el registro a partir de la configuracion y del estado de secretos.
 *
 * `snapshot` es el catalogo REAL leido de la pasarela, cuando existe. Sin el,
 * la lista de modelos servidos va vacia y el registro lo interpreta como «no se
 * sabe», que es la verdad: nadie ha preguntado. Antes esa lista vacia se leia
 * como «no sirve ninguno» y la pantalla declaraba los 19 modelos no
 * disponibles con la clave puesta y trabajos corriendo contra ellos.
 */
function buildRegistry(summary: ConfigSummary, snapshot: CatalogSnapshot | null): ModelRegistry {
  const connections = (summary.config?.connections ?? []) as ConnectionProfile[];
  const models =
    connections.length === 0
      ? []
      : snapshot?.connectionId === connections[0]!.id
        ? buildCatalogForConnection(
            connections[0]!.id,
            snapshot.models.map((model) => model.apiModel),
          )
        : buildDefaultCatalog(connections[0]!.id);
  return new ModelRegistry({
    connections,
    models,
    statuses: connections.map((connection) => ({
      connectionId: connection.id,
      hasApiKey: summary.secrets.configured[connectionSecretName(connection.id)] === true,
      reachable: snapshot?.connectionId === connection.id ? true : null,
      checkedAt: snapshot?.connectionId === connection.id ? snapshot.fetchedAt : null,
      availableModels:
        snapshot?.connectionId === connection.id
          ? snapshot.models.map((model) => model.apiModel)
          : [],
      error: null,
    })),
  });
}

/** lee el ultimo catalogo guardado de la primera conexion configurada */
function useCatalogSnapshot(summary: ConfigSummary): {
  snapshot: CatalogSnapshot | null;
  setSnapshot: (value: CatalogSnapshot) => void;
  connectionId: string | null;
} {
  const connectionId = summary.config?.connections?.[0]?.id ?? null;
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [leido, setLeido] = useState(false);

  useEffect(() => {
    if (connectionId === null || leido) return;
    setLeido(true);
    void window.luxy.readCatalog(connectionId).then((result) => {
      if (result.ok && result.value.snapshot !== null) setSnapshot(result.value.snapshot);
    });
  }, [connectionId, leido]);

  return { snapshot, setSnapshot, connectionId };
}

/** lee una vez el historial reciente; no sondea ni ejecuta modelos */
function useModelEvidence(): {
  evidence: Map<string, ModelEvidence>;
  loading: boolean;
  error: string | null;
  sampleSize: number;
  capped: boolean;
  paginationStalled: boolean;
} {
  const [evidence, setEvidence] = useState<Map<string, ModelEvidence>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sampleSize, setSampleSize] = useState(0);
  const [capped, setCapped] = useState(false);
  const [paginationStalled, setPaginationStalled] = useState(false);

  useEffect(() => {
    let active = true;
    void loadModelEvidenceHistory(async (offset, limit) => {
      const result = await window.luxy.listStudioJobs({ limit, offset });
      if (!result.ok) throw new Error(result.error);
      return result.value.jobs;
    })
      .then((history) => {
        if (!active) return;
        setEvidence(summarizeModelEvidence(history.jobs));
        setSampleSize(history.jobs.length);
        setCapped(history.capped);
        setPaginationStalled(history.paginationStalled);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'no se pudo leer el historial');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { evidence, loading, error, sampleSize, capped, paginationStalled };
}

// -----------------------------------------------------------------------------
// Proyectos
// -----------------------------------------------------------------------------

export function ProjectsPage({
  summary,
  onSave,
}: {
  summary: ConfigSummary;
  onSave: (config: unknown) => Promise<boolean>;
}): JSX.Element {
  const projects = Object.entries(summary.config?.projects ?? {});
  const [alias, setAlias] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const elegirCarpeta = async (): Promise<void> => {
    const result = await window.luxy.pickFolder('Elige la carpeta del proyecto');
    if (result.ok && !result.value.canceled && result.value.path !== null) {
      setPath(result.value.path);
    }
  };

  const anadir = async (): Promise<void> => {
    setError(null);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(alias)) {
      setError('El alias admite minusculas, digitos, punto, guion y guion bajo.');
      return;
    }
    if (path.length === 0) {
      setError('Elige la carpeta del proyecto.');
      return;
    }
    const base = summary.config;
    if (base === null) {
      setError('Configura primero la maquina en Ajustes.');
      return;
    }
    const next: StoredAgentConfig = {
      ...base,
      projects: { ...base.projects, [alias]: { ...defaultProject(), path } },
    };
    if (await onSave(next)) {
      setAlias('');
      setPath('');
    }
  };

  const quitar = async (clave: string): Promise<void> => {
    const base = summary.config;
    if (base === null) return;
    const projects = { ...base.projects };
    delete projects[clave];
    await onSave({ ...base, projects });
  };

  const toggleHostChecks = async (clave: string): Promise<void> => {
    const base = summary.config;
    const project = base?.projects[clave];
    if (base === null || project === undefined) return;
    await onSave({
      ...base,
      projects: {
        ...base.projects,
        [clave]: { ...project, allowHostChecks: !project.allowHostChecks },
      },
    });
  };

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Proyectos</h1>
        <Tag>{projects.length}</Tag>
      </div>
      <p className="page__lede">
        Carpetas sobre las que Luxy puede trabajar. Cada trabajo de edicion ocurre en un worktree
        aislado; tu carpeta no se toca.
      </p>

      <Panel title="Añadir proyecto">
        {error !== null && <Notice tone="fault">{error}</Notice>}
        <Field label="Alias" hint="Es lo que escribes en Telegram: /deepseek mi-alias arregla algo">
          <input
            type="text"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder="mi-proyecto"
            spellCheck={false}
          />
        </Field>
        <Field label="Carpeta">
          <div className="row">
            <input type="text" value={path} readOnly placeholder="Sin elegir" style={{ flex: 1 }} />
            <button className="btn" onClick={() => void elegirCarpeta()}>
              Elegir
            </button>
          </div>
        </Field>
        <button className="btn btn--primary" onClick={() => void anadir()}>
          Añadir proyecto
        </button>
      </Panel>

      <Panel title="Proyectos configurados" flush>
        <Notice tone="warn">
          Las comprobaciones se ejecutan en Windows y pueden cargar codigo modificado por el modelo.
          Permanecen desactivadas por proyecto hasta que revises y aceptes ese riesgo.
        </Notice>
        {projects.length === 0 ? (
          <Empty title="Ningun proyecto">
            Añade una carpeta arriba para que Luxy pueda trabajar sobre ella.
          </Empty>
        ) : (
          <ul className="list">
            {projects.map(([clave, proyecto]) => (
              <li key={clave}>
                <div className="list__main">
                  <div className="list__name">{clave}</div>
                  <div className="list__meta scroller">{proyecto.path}</div>
                </div>
                <Tag>{proyecto.type}</Tag>
                {proyecto.allowEdits && <Tag tone="busy">edita</Tag>}
                {proyecto.allowCommit && <Tag tone="warn">commit</Tag>}
                {proyecto.allowPush ? <Tag tone="fault">push</Tag> : <Tag>sin push</Tag>}
                <button className="btn btn--quiet" onClick={() => void toggleHostChecks(clave)}>
                  {proyecto.allowHostChecks ? 'Pruebas: activas' : 'Pruebas: bloqueadas'}
                </button>
                <button className="btn btn--danger btn--quiet" onClick={() => void quitar(clave)}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function defaultProject(): NonNullable<StoredAgentConfig['projects']>[string] {
  return {
    path: '',
    type: 'other',
    testCommands: [],
    testTimeoutMs: 600_000,
    allowHostChecks: false,
    allowEdits: true,
    allowCommit: true,
    // el push nunca se activa solo
    allowPush: false,
  };
}

// -----------------------------------------------------------------------------
// Conexiones
// -----------------------------------------------------------------------------

export function ConnectionsPage({
  summary,
  onSetSecret,
  onDeleteSecret,
}: {
  summary: ConfigSummary;
  onSetSecret: (name: string, value: string) => Promise<boolean>;
  onDeleteSecret: (name: string) => Promise<boolean>;
}): JSX.Element {
  const connections = (summary.config?.connections ?? []) as ConnectionProfile[];
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');

  const guardar = async (id: string): Promise<void> => {
    if (await onSetSecret(connectionSecretName(id), value)) {
      setEditing(null);
      setValue('');
    }
  };

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Conexiones</h1>
        <Tag>{connections.length}</Tag>
      </div>
      <p className="page__lede">
        Endpoints de API y sus claves. Las claves se guardan cifradas con tu cuenta de Windows y no
        vuelven a mostrarse: para cambiarlas se introduce una nueva.
      </p>

      {!summary.secrets.encryptionAvailable && (
        <Notice tone="fault">
          Este equipo no ofrece cifrado para tu cuenta. Luxy no guardara ninguna clave hasta
          resolverlo, porque no las escribira sin cifrar.
        </Notice>
      )}

      {connections.length === 0 ? (
        <Panel flush>
          <Empty title="Ninguna conexion">
            Completa la configuracion inicial en Ajustes para crear tu primera conexion de API.
          </Empty>
        </Panel>
      ) : (
        connections.map((connection) => {
          const secretName = connectionSecretName(connection.id);
          const configured = summary.secrets.configured[secretName] === true;
          return (
            <Panel
              key={connection.id}
              title={connection.displayName}
              actions={
                <>
                  <Tag tone={connection.enabled ? 'ok' : undefined}>
                    {connection.enabled ? 'activa' : 'desactivada'}
                  </Tag>
                  <Tag tone={configured ? 'ok' : 'warn'}>
                    {configured ? 'clave configurada' : 'sin clave'}
                  </Tag>
                </>
              }
            >
              <Field label="Base URL">
                <input type="text" value={connection.baseUrl} readOnly />
              </Field>
              <Field label="Protocolo">
                <input type="text" value={connection.protocol} readOnly />
              </Field>

              <Field
                label="Clave de API"
                hint={
                  configured
                    ? 'Hay una clave guardada. Introduce una nueva para sustituirla.'
                    : 'La clave se cifra al guardarla y no se muestra nunca.'
                }
              >
                {editing === connection.id ? (
                  <div className="row">
                    <input
                      type="password"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder="Pega la clave"
                      autoFocus
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn btn--primary"
                      onClick={() => void guardar(connection.id)}
                    >
                      Guardar
                    </button>
                    <button className="btn btn--quiet" onClick={() => setEditing(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="row">
                    <input
                      type="password"
                      value={configured ? '••••••••••••' : ''}
                      readOnly
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn"
                      onClick={() => {
                        setEditing(connection.id);
                        setValue('');
                      }}
                      disabled={!summary.secrets.encryptionAvailable}
                    >
                      {configured ? 'Sustituir' : 'Añadir'}
                    </button>
                    {configured && (
                      <button
                        className="btn btn--danger btn--quiet"
                        onClick={() => void onDeleteSecret(secretName)}
                      >
                        Borrar
                      </button>
                    )}
                  </div>
                )}
              </Field>
            </Panel>
          );
        })
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Modelos
// -----------------------------------------------------------------------------

/**
 * catalogo REAL leido de la pasarela, frente al que Luxy trae escrito.
 *
 * lo de abajo es lo que Luxy cree; esto es lo que la conexion dice servir de
 * verdad, con su fecha. Cuando no coinciden, manda este.
 */
function CatalogoReal({
  connectionId,
  snapshot,
  onSnapshot,
}: {
  connectionId: string | null;
  snapshot: CatalogSnapshot | null;
  onSnapshot: (value: CatalogSnapshot) => void;
}): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (connectionId === null) return null;

  const refrescar = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await window.luxy.refreshCatalog(connectionId);
    setBusy(false);
    if (result.ok) onSnapshot(result.value);
    else setError(result.error);
  };

  const porFamiliaReal = new Map<string, CatalogSnapshot['models']>();
  for (const model of snapshot?.models ?? []) {
    const familia = guessModelFamily(model.apiModel);
    porFamiliaReal.set(familia, [...(porFamiliaReal.get(familia) ?? []), model]);
  }

  return (
    <Panel
      title="Catalogo real de la conexion"
      actions={
        <>
          {snapshot !== null && <Tag tone="ok">{snapshot.models.length} modelos</Tag>}
          <button
            className="btn btn--primary btn--quiet"
            disabled={busy}
            onClick={() => void refrescar()}
          >
            {busy ? 'Actualizando…' : 'Actualizar modelos'}
          </button>
        </>
      }
    >
      {error !== null && <Notice tone="fault">{error}</Notice>}
      {snapshot === null ? (
        <Empty title="Sin consultar todavia">
          Pulsa para preguntarle a la pasarela que modelos sirve de verdad.
        </Empty>
      ) : (
        <>
          <p className="list__meta">Leido el {new Date(snapshot.fetchedAt).toLocaleString()}</p>
          <Notice tone="idle">
            Esta conexion no publica precios por API; Luxy no los consulta.
          </Notice>
          {[...porFamiliaReal.entries()].map(([familia, modelos]) => (
            <section key={familia} className="model-catalog-family model-catalog-family--inline">
              <div className="silk">
                {familia} · {modelos.length}
              </div>
              <ul className="model-catalog-list">
                {modelos.map((model) => (
                  <li key={model.apiModel}>
                    <div className="list__main">
                      <div className="list__name mono scroller">{model.apiModel}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </Panel>
  );
}

export function ModelsPage({ summary }: { summary: ConfigSummary }): JSX.Element {
  const { snapshot, setSnapshot, connectionId } = useCatalogSnapshot(summary);
  const localEvidence = useModelEvidence();
  const registry = buildRegistry(summary, snapshot);
  const resolved = registry.resolveAll();

  const porFamilia = new Map<ModelFamily, ResolvedModel[]>();
  for (const model of resolved) {
    const familia = model.definition.family;
    porFamilia.set(familia, [...(porFamilia.get(familia) ?? []), model]);
  }

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Modelos</h1>
        <Tag>{resolved.length} en el catalogo</Tag>
      </div>
      <p className="page__lede">
        Catalogo agrupado por familia. Un modelo declarado no es un modelo disponible: hace falta
        conexion activa, clave guardada y que la conexion confirme que lo sirve.
      </p>

      <CatalogoReal connectionId={connectionId} snapshot={snapshot} onSnapshot={setSnapshot} />

      {localEvidence.error !== null && (
        <Notice tone="warn">No se pudo leer la evidencia local: {localEvidence.error}</Notice>
      )}
      {!localEvidence.loading && localEvidence.error === null && (
        <Notice tone={localEvidence.capped ? 'warn' : 'idle'}>
          Evidencia local: {localEvidence.sampleSize} trabajos revisados
          {localEvidence.paginationStalled
            ? '; el gateway no avanzo al paginar y debe actualizarse para leer el resto.'
            : localEvidence.capped
              ? '; hay mas historial y la muestra se limita a los 1.000 mas recientes.'
              : '; historial reciente completo.'}
        </Notice>
      )}

      {resolved.length === 0 ? (
        <Panel flush>
          <Empty title="Catalogo vacio">
            Crea una conexion de API en Ajustes y el catalogo aparecera aqui.
          </Empty>
        </Panel>
      ) : (
        [...porFamilia.entries()].map(([familia, modelos]) => (
          <div key={familia} className="model-catalog-family">
            <Panel title={FAMILIA[familia]} flush>
              <ul className="model-catalog-list">
                {modelos.map(({ definition, usable, unavailableReason, servedByConnection }) => (
                  <li key={definition.id}>
                    <div className="list__main">
                      <div className="list__name">
                        {definition.displayName}{' '}
                        {definition.defaultForFamily && <Tag tone="busy">predeterminado</Tag>}
                      </div>
                      <div className="list__meta mono scroller">{definition.apiModel}</div>
                      <div className="list__meta">
                        {definition.telegramAliases.length === 0
                          ? 'sin comando de Telegram'
                          : definition.telegramAliases.map((alias) => `/${alias}`).join('  ')}
                      </div>
                      <div className="list__meta">
                        {localEvidence.loading
                          ? 'leyendo ejecuciones recientes…'
                          : localEvidence.evidence.has(definition.apiModel)
                            ? describeModelEvidence(
                                localEvidence.evidence.get(definition.apiModel)!,
                              )
                            : 'sin ejecuciones atribuibles en el historial revisado'}
                      </div>
                      {!usable && unavailableReason !== null && (
                        <div className="list__meta">{unavailableReason}</div>
                      )}
                    </div>
                    {definition.agentic && <Tag tone="busy">herramientas</Tag>}
                    <Tag>{definition.category}</Tag>
                    <Tag tone={usable ? 'ok' : servedByConnection === null ? 'warn' : 'fault'}>
                      {usable
                        ? 'disponible'
                        : servedByConnection === null
                          ? 'sin comprobar'
                          : 'no disponible'}
                    </Tag>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        ))
      )}
    </>
  );
}
