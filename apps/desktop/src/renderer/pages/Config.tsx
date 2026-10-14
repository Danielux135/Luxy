// Proyectos, Conexiones y Modelos.
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import {
  ALLOWED_TEST_EXECUTABLES,
  ModelRegistry,
  REASONING_MODE_LABELS,
  REASONING_MODE_SHORT,
  type ReasoningMode,
  buildCatalogReport,
  buildDefaultCatalog,
  catalogDialectFor,
  connectionProfileSchema,
  guessDisplayGroup,
  type CatalogSnapshot,
  type CatalogSource,
  type ConnectionProfile,
  type ModelFamily,
  type ProjectType,
  type ResolvedModel,
  type SkippedModel,
  type StoredAgentConfig,
} from '@luxy/shared';
import { connectionSecretName } from '../../shared/ipc.js';
import {
  describeModelEvidence,
  loadModelEvidenceHistory,
  summarizeModelEvidence,
} from '../model-evidence.js';
import type { ModelEvidence } from '../model-evidence.js';
import {
  PROJECT_TYPE_LABELS,
  buildProjectProfileUpdate,
  projectToDraft,
  type ProjectDraft,
} from '../project-profile.js';
import { callBridge } from '../bridge-call.js';
import {
  buildHttpProvider,
  catalogDateLabel,
  describeProviderModelSettings,
  describeSampling,
  emptyHttpProviderDraft,
  emptyProviderModelDraft,
  hostOfBaseUrl,
  httpProviderToDraft,
  HTTP_PROVIDER_PRESETS,
  isReasoningOrphan,
  providerModelSettings,
  providerModelSettingsToDraft,
  providerModelSuggestions,
  reasoningChoicesFor,
  reasoningModeDraft,
  reasoningOutputCapIsShort,
  REASONING_OUTPUT_CAP_FLOOR,
  withModelSampling,
  withProviderModelSampling,
  type HttpProviderConfig,
  type HttpProviderDraft,
  type ProviderModelDraft,
  type ProviderModelSettings,
  type ReasoningChoices,
  type ReasoningModeDraft,
} from '../http-provider-config.js';
import { Empty, Explica, Field, Notice, Panel, Tag } from '../ui/primitives.js';
import type { ConfigSummary } from '../useConfig.js';
import {
  catalogChanged,
  catalogOriginKey,
  catalogOriginsOf,
  useStoredCatalog,
  type CatalogOrigin,
  type StoredCatalog,
} from '../useCatalog.js';

/**
 * banderas que significan «acepta imágenes», con los nombres que usan las
 * pasarelas. Se resaltan porque es la pregunta que de verdad se hace uno
 * delante de esta lista: cuál puede describir una foto.
 */
const VISION_FLAGS = ['vision', 'image_input', 'multimodal'];

const FAMILIA: Record<ModelFamily, string> = {
  deepseek: 'DeepSeek',
  glm: 'GLM',
  kat: 'KAT',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  mistral: 'Mistral',
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
function buildRegistry(
  summary: ConfigSummary,
  snapshot: CatalogSnapshot | null,
  origin: CatalogOrigin | null,
): { registry: ModelRegistry; skipped: SkippedModel[]; unreadable: number } {
  const declaradas = (summary.config?.connections ?? []) as ConnectionProfile[];
  // un proveedor HTTP no es una conexion, pero tiene lo que el registro
  // necesita para resolver: identificador, nombre y URL. Se construye uno
  // equivalente para que sus modelos puedan salir disponibles en vez de
  // aparecer como huerfanos de una conexion que no existe
  const comoConexion =
    origin === null || origin.source !== 'http'
      ? null
      : (connectionProfileSchema.safeParse({
          id: origin.id,
          displayName: origin.displayName,
          baseUrl:
            summary.config?.providers.http.find((provider) => provider.id === origin.id)?.baseUrl ??
            'https://example.invalid',
        }).data ?? null);

  const connections = comoConexion === null ? declaradas : [...declaradas, comoConexion];
  // se compara tambien el ORIGEN: una conexion y un proveedor pueden llamarse
  // igual, y con solo el identificador el catalogo de uno pasaria por el del otro
  const leido =
    origin !== null &&
    snapshot?.connectionId === origin.id &&
    (snapshot.source ?? 'connection') === origin.source;
  const report =
    origin === null
      ? { models: [], skipped: [] }
      : leido
        ? // los registros enteros, no solo los nombres: llevan lo que la
          // pasarela declara que sabe hacer cada modelo
          buildCatalogReport(origin.id, snapshot.models, origin.family ?? undefined)
        : {
            // de un proveedor HTTP no se sabe NADA hasta preguntarle:
            // rellenarlo con el catalogo de fabrica ofreceria modelos de otra
            // pasarela
            models: origin.source === 'connection' ? buildDefaultCatalog(origin.id) : [],
            skipped: [],
          };

  const registry = new ModelRegistry({
    connections,
    models: report.models,
    statuses: connections.map((connection) => ({
      connectionId: connection.id,
      hasApiKey:
        connection.id === comoConexion?.id
          ? summary.secrets.configured[
              summary.config?.providers.http.find((provider) => provider.id === connection.id)
                ?.apiKeyEnv ?? ''
            ] === true
          : summary.secrets.configured[connectionSecretName(connection.id)] === true,
      reachable: leido && snapshot.connectionId === connection.id ? true : null,
      checkedAt: leido && snapshot.connectionId === connection.id ? snapshot.fetchedAt : null,
      availableModels:
        leido && snapshot.connectionId === connection.id
          ? snapshot.models.map((model) => model.apiModel)
          : [],
      error: null,
    })),
    // el catalogo lo sirve un tercero: una id repetida es un dato raro, no un
    // fallo nuestro, y esto corre DENTRO del render. Lanzando aqui se pierde
    // la aplicacion entera, no la lista
    onConflict: 'skip',
  });

  // lo que se cayo ANTES de llegar aqui, al parsear `/v1/models`: una fila sin
  // `id`, un `id` que no es cadena, uno de mas de 200 caracteres. Eso no entra
  // en `skipped` —el catalogo ya no lo ve— y sin sumarlo el aviso contaba menos
  // modelos de los que de verdad faltaban
  const unreadable = leido ? (snapshot.unreadableModels ?? 0) : 0;

  return { registry, skipped: report.skipped, unreadable };
}

/**
 * lee el ultimo catalogo guardado del origen ELEGIDO.
 *
 * Antes era siempre `connections[0]`, escrito a mano. Con mas de una conexion
 * —o con un proveedor HTTP, que vive en otra lista— no habia forma de
 * preguntarle a ningun otro: «Actualizar modelos» volvia a interrogar siempre
 * al mismo y el resto quedaba invisible.
 */
function useCatalogSnapshot(summary: ConfigSummary): {
  snapshot: CatalogSnapshot | null;
  setSnapshot: (value: CatalogSnapshot) => void;
  origins: CatalogOrigin[];
  origin: CatalogOrigin | null;
  setOriginKey: (value: string) => void;
} {
  const origins = catalogOriginsOf(summary.config);
  const [originKey, setOriginKey] = useState<string | null>(null);
  const origin =
    origins.find((entry) => catalogOriginKey(entry) === originKey) ?? origins[0] ?? null;
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  // la clave, no el objeto: se construye nuevo en cada render y como
  // dependencia dispararia la lectura sin parar
  const clave = origin === null ? null : catalogOriginKey(origin);

  useEffect(() => {
    if (clave === null) return;
    let active = true;
    // al cambiar de origen se suelta el anterior: dejarlo puesto enseñaria los
    // modelos de una conexion bajo el nombre de otra
    setSnapshot(null);
    // el origen se reconstruye desde la clave y no se toma de fuera: el objeto
    // nace nuevo en cada render, y como dependencia repetiria la lectura sin
    // parar. Ni los identificadores de conexion ni los de proveedor admiten
    // dos puntos, asi que la clave se parte sin ambiguedad
    const corte = clave.indexOf(':');
    const source = clave.slice(0, corte) as CatalogSource;
    const id = clave.slice(corte + 1);
    void window.luxy.readCatalog({ connectionId: id, source }).then((result) => {
      if (!active) return;
      if (result.ok && result.value.snapshot !== null) setSnapshot(result.value.snapshot);
    });
    return () => {
      active = false;
    };
  }, [clave]);

  return { snapshot, setSnapshot, origins, origin, setOriginKey };
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
  onOpenProject,
}: {
  summary: ConfigSummary;
  onSave: (config: unknown) => Promise<boolean>;
  onOpenProject: (alias: string, destination: 'conversaciones' | 'trabajos') => void;
}): JSX.Element {
  const projects = Object.entries(summary.config?.projects ?? {});
  const [alias, setAlias] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

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
    if (base.projects[alias] !== undefined) {
      setError('Ese alias ya existe. Abre su ficha para modificarlo.');
      return;
    }
    const project = { ...defaultProject(), path };
    const next: StoredAgentConfig = {
      ...base,
      projects: { ...base.projects, [alias]: project },
    };
    if (await onSave(next)) {
      setEditingAlias(alias);
      setDraft(projectToDraft(project));
      setAlias('');
      setPath('');
    }
  };

  const quitar = async (clave: string): Promise<void> => {
    const base = summary.config;
    if (base === null) return;
    const projects = { ...base.projects };
    delete projects[clave];
    if (await onSave({ ...base, projects })) {
      if (editingAlias === clave) {
        setEditingAlias(null);
        setDraft(null);
      }
    }
  };

  const editar = (
    clave: string,
    project: NonNullable<StoredAgentConfig['projects']>[string],
  ): void => {
    setEditingAlias(clave);
    setDraft(projectToDraft(project));
    setProfileError(null);
    setProfileSaved(false);
  };

  const elegirCarpetaFicha = async (): Promise<void> => {
    if (draft === null) return;
    const result = await window.luxy.pickFolder('Elige la carpeta del proyecto');
    if (result.ok && !result.value.canceled && result.value.path !== null) {
      const selectedPath = result.value.path;
      setDraft((previous) => (previous === null ? null : { ...previous, path: selectedPath }));
      setProfileSaved(false);
    }
  };

  const guardarFicha = async (): Promise<void> => {
    const base = summary.config;
    const project = editingAlias === null ? undefined : base?.projects[editingAlias];
    if (base === null || project === undefined || draft === null || editingAlias === null) return;

    setProfileError(null);
    setProfileSaved(false);
    const update = buildProjectProfileUpdate(project, draft);
    if (!update.ok) {
      setProfileError(update.error);
      return;
    }

    if (
      await onSave({
        ...base,
        projects: { ...base.projects, [editingAlias]: update.project },
      })
    ) {
      setDraft(projectToDraft(update.project));
      setProfileSaved(true);
    } else {
      setProfileError('No se pudo guardar la ficha. Revisa los campos e inténtalo de nuevo.');
    }
  };

  const updateCheck = (
    index: number,
    field: 'executable' | 'argumentsText',
    value: string,
  ): void => {
    setDraft((previous) =>
      previous === null
        ? null
        : {
            ...previous,
            checks: previous.checks.map((check, checkIndex) =>
              checkIndex === index ? { ...check, [field]: value } : check,
            ),
          },
    );
    setProfileSaved(false);
  };

  const removeCheck = (index: number): void => {
    setDraft((previous) =>
      previous === null
        ? null
        : { ...previous, checks: previous.checks.filter((_, checkIndex) => checkIndex !== index) },
    );
    setProfileSaved(false);
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

      {editingAlias !== null && draft !== null && (
        <Panel
          title={`Ficha · ${editingAlias}`}
          actions={
            <button
              className="btn btn--quiet"
              type="button"
              onClick={() => {
                setEditingAlias(null);
                setDraft(null);
                setProfileError(null);
                setProfileSaved(false);
              }}
            >
              Cerrar
            </button>
          }
        >
          <Notice tone="idle">
            Esta ficha vive sólo en la configuración de esta máquina. Las instrucciones se envían al
            agente para los trabajos del proyecto; no incluyas claves ni secretos.
          </Notice>
          {profileError !== null && <Notice tone="fault">{profileError}</Notice>}
          {profileSaved && <Notice tone="ok">Ficha guardada.</Notice>}

          <div className="project-profile__grid">
            <Field label="Alias estable" hint="Identifica trabajos e historial; no se renombra.">
              <input type="text" value={editingAlias} readOnly />
            </Field>
            <Field label="Nombre visible" hint="Opcional; se muestra sin sustituir el alias.">
              <input
                type="text"
                value={draft.displayName}
                maxLength={80}
                onChange={(event) => {
                  setDraft({ ...draft, displayName: event.target.value });
                  setProfileSaved(false);
                }}
                placeholder="Luxy"
              />
            </Field>
            <Field label="Tipo base">
              <select
                value={draft.type}
                onChange={(event) => {
                  setDraft({ ...draft, type: event.target.value as ProjectType });
                  setProfileSaved(false);
                }}
              >
                {Object.entries(PROJECT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stack" hint="Tecnologías separadas por comas; máximo 16.">
              <input
                type="text"
                value={draft.stack}
                onChange={(event) => {
                  setDraft({ ...draft, stack: event.target.value });
                  setProfileSaved(false);
                }}
                placeholder="TypeScript, Electron, React"
              />
            </Field>
          </div>

          <Field label="Carpeta de esta máquina">
            <div className="row">
              <input type="text" value={draft.path} readOnly style={{ flex: 1 }} />
              <button className="btn" type="button" onClick={() => void elegirCarpetaFicha()}>
                Cambiar
              </button>
            </div>
          </Field>
          <Field label="Descripción" hint={`${draft.description.length}/600 caracteres`}>
            <textarea
              rows={3}
              value={draft.description}
              maxLength={600}
              onChange={(event) => {
                setDraft({ ...draft, description: event.target.value });
                setProfileSaved(false);
              }}
              placeholder="Qué hace el proyecto y qué parte mantiene esta máquina."
            />
          </Field>
          <Field
            label="Instrucciones del proyecto"
            hint={`${draft.instructions.length}/8000 caracteres · La tarea actual prevalece cuando concreta algo distinto.`}
          >
            <textarea
              rows={8}
              value={draft.instructions}
              maxLength={8000}
              onChange={(event) => {
                setDraft({ ...draft, instructions: event.target.value });
                setProfileSaved(false);
              }}
              placeholder="Convenciones, archivos que preservar y criterios propios del proyecto."
            />
          </Field>

          <section className="project-checks">
            <div className="project-checks__head">
              <div>
                <div className="silk">Comprobaciones</div>
                <p className="field__hint">
                  Guardar no ejecuta nada. Cada línea de argumentos será un elemento separado y
                  nunca se pasará a un shell.
                </p>
              </div>
              <button
                className="btn btn--quiet"
                type="button"
                disabled={draft.checks.length >= 10}
                onClick={() => {
                  setDraft({
                    ...draft,
                    checks: [...draft.checks, { executable: 'npm', argumentsText: 'test' }],
                  });
                  setProfileSaved(false);
                }}
              >
                Añadir comando
              </button>
            </div>

            <datalist id="project-check-executables">
              {ALLOWED_TEST_EXECUTABLES.map((executable) => (
                <option key={executable} value={executable} />
              ))}
            </datalist>

            {draft.checks.length === 0 ? (
              <p className="project-checks__empty">
                Sin comandos. Luxy no ejecutará comprobaciones aunque el permiso esté activo.
              </p>
            ) : (
              <div className="project-checks__list">
                {draft.checks.map((check, index) => (
                  <div className="project-check" key={index}>
                    <div className="project-check__fields">
                      <Field
                        label={`Ejecutable ${index + 1}`}
                        hint="Debe pertenecer a la lista blanca; no admite rutas."
                      >
                        <input
                          type="text"
                          list="project-check-executables"
                          value={check.executable}
                          maxLength={128}
                          spellCheck={false}
                          onChange={(event) => updateCheck(index, 'executable', event.target.value)}
                        />
                      </Field>
                      <Field label="Argumentos" hint="Uno por línea. Ejemplo: run, después lint.">
                        <textarea
                          rows={3}
                          value={check.argumentsText}
                          spellCheck={false}
                          onChange={(event) =>
                            updateCheck(index, 'argumentsText', event.target.value)
                          }
                        />
                      </Field>
                    </div>
                    <button
                      className="btn btn--danger btn--quiet"
                      type="button"
                      onClick={() => removeCheck(index)}
                    >
                      Quitar comando
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Field
              label="Timeout por comando"
              hint="Entre 1 y 3600 segundos; al agotarse se mata el árbol de procesos."
            >
              <div className="project-checks__timeout">
                <input
                  type="number"
                  min={1}
                  max={3600}
                  step={0.001}
                  value={draft.testTimeoutSeconds}
                  onChange={(event) => {
                    setDraft({ ...draft, testTimeoutSeconds: Number(event.target.value) });
                    setProfileSaved(false);
                  }}
                />
                <span>segundos</span>
              </div>
            </Field>

            {draft.checks.length > 0 && !draft.allowHostChecks && (
              <Notice tone="warn">
                Hay comandos configurados, pero seguirán bloqueados hasta activar explícitamente las
                comprobaciones en el host.
              </Notice>
            )}
          </section>

          <div className="project-profile__permissions">
            <label className="check">
              <input
                type="checkbox"
                checked={draft.allowEdits}
                onChange={(event) => {
                  setDraft({ ...draft, allowEdits: event.target.checked });
                  setProfileSaved(false);
                }}
              />
              <span>
                Permitir edición
                <small>Los cambios siguen confinados a un worktree aislado.</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.allowHostChecks}
                onChange={(event) => {
                  setDraft({ ...draft, allowHostChecks: event.target.checked });
                  setProfileSaved(false);
                }}
              />
              <span>
                Permitir comprobaciones en el host
                <small>Pueden cargar código modificado; se mantienen bloqueadas por defecto.</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.allowCommit}
                onChange={(event) => {
                  setDraft({ ...draft, allowCommit: event.target.checked });
                  setProfileSaved(false);
                }}
              />
              <span>
                Permitir commit
                <small>Crear el commit todavía exige aprobación explícita.</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.allowPush}
                onChange={(event) => {
                  setDraft({ ...draft, allowPush: event.target.checked });
                  setProfileSaved(false);
                }}
              />
              <span>
                Permitir push
                <small>Es sólo una puerta; cada push sigue exigiendo dos confirmaciones.</small>
              </span>
            </label>
          </div>
          {draft.allowPush && (
            <Notice tone="warn">
              Push habilitado para este proyecto. Luxy no publicará nada sin las dos confirmaciones
              obligatorias.
            </Notice>
          )}
          <button className="btn btn--primary" type="button" onClick={() => void guardarFicha()}>
            Guardar ficha
          </button>
        </Panel>
      )}

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
          <ul className="list project-list">
            {projects.map(([clave, proyecto]) => (
              <li key={clave}>
                <div className="list__main">
                  <div className="list__name">{proyecto.displayName?.trim() || clave}</div>
                  <div className="list__meta scroller">
                    {proyecto.displayName?.trim() ? `${clave} · ` : ''}
                    {proyecto.path}
                  </div>
                  {(proyecto.stack?.length ?? 0) > 0 && (
                    <div className="list__meta">{proyecto.stack?.join(' · ')}</div>
                  )}
                </div>
                <Tag>{proyecto.type}</Tag>
                {proyecto.allowEdits && <Tag tone="busy">edita</Tag>}
                {proyecto.allowCommit && <Tag tone="warn">commit</Tag>}
                {proyecto.allowPush ? <Tag tone="fault">push</Tag> : <Tag>sin push</Tag>}
                {proyecto.testCommands.length > 0 && (
                  <Tag>{proyecto.testCommands.length} checks</Tag>
                )}
                <button
                  className="btn btn--quiet"
                  type="button"
                  onClick={() => onOpenProject(clave, 'conversaciones')}
                >
                  Conversaciones
                </button>
                <button
                  className="btn btn--quiet"
                  type="button"
                  onClick={() => onOpenProject(clave, 'trabajos')}
                >
                  Trabajos
                </button>
                <button className="btn btn--quiet" onClick={() => editar(clave, proyecto)}>
                  Editar ficha
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

/**
 * los pasos para mirar en Registros que se envio y que se le noto al modelo.
 *
 * Van aparte porque los dicen IGUAL los dos caminos del selector: la tabla de
 * `D-107` y el catalogo de la pasarela. La seccion se llama «Registros»
 * —«Sistema» no existe en la barra lateral—, y es el unico sitio donde Daniel
 * puede comprobar si el ajuste llega (LA-055). Solo carga las ultimas lineas,
 * asi que hay que mirarlo nada mas enviar (octava ronda). Los seis veredictos
 * vienen en ingles porque asi salen en el registro, y «hidden» se dice como lo
 * que es, una deduccion (`D-093`)
 */
const REGISTROS_STEPS =
  'envía un mensaje, ve a Registros, pulsa «Actualizar» y busca «llamada al proveedor». Si ' +
  'reasoningSent dice not_sent, no se envió nada. reasoningVerdict dice qué se le notó: ' +
  'visible, razonó y se ve; counted, el proveedor dice que razonó sin enseñarlo (cuánto, en ' +
  'reasoningTokensReported); hidden, probablemente razonó sin enseñarlo; not_seen, no se ' +
  'le notó; unclear o no_data, no se puede decir.';

/**
 * el rotulo del boton que vuelve a leer el catalogo de UN proveedor HTTP.
 *
 * Es una constante porque lo citan las pistas de aqui y los errores de
 * `reasoningModeError`: si el boton se llamara de otra forma, mandarian a
 * pulsar algo que no existe. Una prueba comprueba que coinciden.
 */
export const REFRESH_PROVIDER_MODELS = 'Actualizar modelos de este proveedor';

/**
 * la pista del selector de razonamiento EN UN HOST DE LA TABLA, aparte para
 * poder probarla. La de un host con dialecto de catalogo es `reasoningHintFor`.
 *
 * `providerWide`: en el formulario del proveedor HTTP el valor va al nivel
 * superior, y `samplingFor` lo aplica a cualquier modelo que pida la peticion
 * y no tenga su propio ajuste. Las opciones salen del modelo del formulario, y
 * sin decirlo parecia un ajuste solo de ese modelo (`D-093`)
 */
export function reasoningFieldHint(input: {
  options: readonly ReasoningMode[];
  note: string | null;
  providerWide: boolean;
}): string {
  const alcance = input.providerWide
    ? 'Es del proveedor, no solo de este modelo: viaja también con cualquier otro modelo suyo ' +
      'que elijas en una conversación, si no tiene su propio ajuste y admite este valor; a los ' +
      'que no lo admiten no se les envía nada. Las opciones de aquí son las del modelo de arriba. '
    : '';
  return input.options.length === 0
    ? 'Luxy no sabe cómo pedírselo a este modelo: no enviará nada. Sólo se ofrece donde la ' +
        'documentación del modelo dice qué valores admite.'
    : `${alcance}${input.note ?? ''} No se sabe si tu pasarela deja pasar este ajuste. Para ` +
        `saberlo: ${REGISTROS_STEPS}`;
}

/** «su catálogo del 13/10/2026», y lo mismo sin fecha cuando no hay ninguna que decir */
function datedCatalog(choices: ReasoningChoices): {
  date: string | null;
  ofDate: string;
  theirs: string;
} {
  const date = catalogDateLabel(choices.catalog?.fetchedAt);
  return date === null
    ? { date, ofDate: '', theirs: 'su catálogo guardado' }
    : { date, ofDate: ` del ${date}`, theirs: `su catálogo del ${date}` };
}

/**
 * la pista del selector de razonamiento, venga de donde vengan las opciones.
 *
 * En un host de la tabla es `reasoningFieldHint`, sin tocar. En un host con
 * dialecto de catalogo (NanoGPT) hay un texto por cada sitio del que pueden
 * salir —o no salir— las opciones, porque cada silencio es distinto: no hay
 * catalogo, se leyo sin detalle, el modelo no esta, la pasarela declara que no
 * razona, o razona y no declara niveles. Juntarlos en un «no admitido» seria
 * afirmar de un tercero algo que nadie ha dicho (`D-093`).
 *
 * Por eso ninguno de estos textos dice que el modelo «admite» nada ni que algo
 * este comprobado: dicen lo que la pasarela DECLARA, con la fecha del catalogo,
 * y que lo elegido es lo que Luxy pide. Nada de NanoGPT se ha medido con una
 * llamada.
 *
 * `modelEmpty`: el campo del modelo esta vacio. Sin nombre no hay nada que
 * buscar en el catalogo, y decir «ese identificador no esta» seria absurdo.
 */
export function reasoningHintFor(
  choices: ReasoningChoices,
  context: { providerWide: boolean; modelEmpty?: boolean },
): string {
  const dialect = choices.dialect;
  if (dialect === null) {
    return reasoningFieldHint({
      options: choices.options,
      note: choices.note,
      providerWide: context.providerWide,
    });
  }
  const label = dialect.label;
  const { date, ofDate, theirs } = datedCatalog(choices);
  const refresh = `pulsa «${REFRESH_PROVIDER_MODELS}»`;
  const steps = `Para ver qué se envió y qué se le notó: ${REGISTROS_STEPS}`;
  // elegido a mano no hay nada declarado que lo respalde: decide la pasarela. Si
  // rechaza el nivel con un 4xx, el agente no lo reintenta: solo repite los 5xx
  // y el 429.
  //
  // Sin nada que ofrecer no hay nivel que elegir —con el campo «Modelo» vacio,
  // que es lo primero que se ve al añadir uno—, y entonces tampoco hay nota:
  // «un error así» se quedaba sin error delante, y los pasos de Registros
  // mandaban a mirar un envio que no se puede hacer
  const manual =
    choices.options.length === 0 || context.modelEmpty === true
      ? 'Escribe arriba el modelo para elegir el nivel a mano.'
      : `${choices.note ?? ''} Un error así no se reintenta. ${steps}`;
  switch (choices.source) {
    case 'provider-wide':
      return (
        `En ${label} el nivel no se elige para todo el proveedor, sino para cada modelo: cada ` +
        `uno declara los suyos en el catálogo de ${label}. Se elige en «Ajustes por modelo», en ` +
        'la tarjeta de este proveedor, una vez guardado.'
      );
    case 'unavailable':
      return (
        `En ${label} los niveles salen de su catálogo, y Luxy sólo lo lee para un proveedor ` +
        'HTTP, en sus «Ajustes por modelo». Aquí no se ofrece ninguno.'
      );
    case 'loading':
      return `Luxy está leyendo el catálogo guardado de ${label}: los niveles salen de él.`;
    case 'missing':
      return `No hay ningún catálogo de ${label} guardado, y los niveles salen de él: ${refresh}.`;
    case 'unknown-model':
      return context.modelEmpty === true
        ? `Escribe arriba el modelo: los niveles salen de lo que ${label} declara para cada ` +
            `uno en ${theirs}.`
        : `Este identificador no está en el catálogo de ${label}${ofDate}: comprueba las ` +
            `mayúsculas y el sufijo, o ${refresh}. Mientras no esté, no se ofrece ningún nivel.`;
    case 'not-reasoning':
      return `${label} declara que este modelo no razona, en ${theirs}: no se ofrece ningún nivel.`;
    case 'basic':
      return (
        `El catálogo guardado de ${label}${ofDate} se leyó sin detalle y no trae los niveles ` +
        `que declara cada modelo: ${refresh} para pedirlo otra vez. ${manual}`
      );
    case 'no-levels':
      return `${label} no declara niveles para este modelo en ${theirs}. ${manual}`;
    case 'levels': {
      if (choices.options.length === 0) {
        return (
          `${label} declara para este modelo, en ${theirs}, niveles que Luxy no sabe pedir ` +
          `(${(choices.catalog?.levels ?? []).join(', ')}): no se ofrece ninguno.`
        );
      }
      // la nota de shared no lleva fecha —alli no la hay—: la pone la pantalla
      const read = date === null ? '' : ` Luxy leyó ese catálogo el ${date}.`;
      // de NanoGPT en concreto: su catalogo y su guia nombran `max`, el esquema
      // publicado de su API no. Otro dialecto no hereda la frase
      const max =
        dialect.family === 'nanogpt' && choices.options.includes('max')
          ? ` «${REASONING_MODE_LABELS.max}» figura en el catálogo y en la guía de ${label}, no ` +
            'en el esquema publicado de su API: si contesta con un error, elige otro.'
          : '';
      return `${choices.note ?? ''}${read}${max} ${steps}`;
    }
    default:
      return `Luxy no puede ofrecer ningún nivel para este modelo en ${label}.`;
  }
}

/**
 * lo que se dice de un valor que YA NO esta entre lo que se ofrece.
 *
 * En un host de la tabla es la frase de siempre: alli ese valor no viaja nunca
 * (`not_sent`). En un host con dialecto de catalogo es al reves, y por eso no
 * puede decir «no admitido»: el agente no conoce el catalogo, asi que un nivel
 * guardado en la entrada de un modelo SE SIGUE ENVIANDO aunque la pasarela ya no
 * lo declare. La unica excepcion es el nivel de proveedor, que alli no se envia.
 *
 * Dice «si ya estaba guardado» porque el selector no sabe si el valor viene del
 * disco o de un borrador al que se le cambio el modelo despues de elegir.
 */
export function reasoningOrphanNotice(value: ReasoningMode, choices: ReasoningChoices): string {
  const label = choices.dialect?.label;
  if (label === undefined) {
    return (
      'Este modelo no admite ese valor: elige otro o «Lo que traiga el modelo (no se envía ' +
      `nada)». ${choices.note ?? 'Luxy no sabe cómo pedírselo a este modelo.'}`
    );
  }
  const { ofDate, theirs } = datedCatalog(choices);
  const level = `«${REASONING_MODE_SHORT[value]}»`;
  const empty = '«Lo que traiga el modelo (no se envía nada)»';
  const stillSent = 'Si ya estaba guardado, Luxy lo sigue enviando hasta que lo cambies';
  switch (choices.source) {
    case 'provider-wide':
      return (
        `En ${label} el nivel de proveedor no se envía nunca: se elige para cada modelo. ` +
        `Déjalo aquí en ${empty} y elígelo en «Ajustes por modelo», en la tarjeta de este ` +
        'proveedor.'
      );
    case 'unavailable':
      return (
        `En ${label} los niveles salen de su catálogo, y Luxy sólo lo lee para un proveedor ` +
        `HTTP: aquí no puede comprobar ${level}. ${stillSent}; déjalo en ${empty}.`
      );
    case 'missing':
      return (
        `No hay ningún catálogo de ${label} guardado: Luxy no puede comprobar ${level}. ` +
        `${stillSent}. Pulsa «${REFRESH_PROVIDER_MODELS}».`
      );
    case 'unknown-model':
      return (
        `Este identificador no está en el catálogo de ${label}${ofDate}: Luxy no puede ` +
        `comprobar ${level}. ${stillSent}. Comprueba las mayúsculas y el sufijo, o pulsa ` +
        `«${REFRESH_PROVIDER_MODELS}».`
      );
    case 'not-reasoning':
      return (
        `${label} declara que este modelo no razona, en ${theirs}. ${stillSent}: déjalo en ` +
        `${empty}.`
      );
    case 'levels':
      return choices.options.length === 0
        ? `${label} declara para este modelo, en ${theirs}, niveles que Luxy no sabe pedir ` +
            `(${(choices.catalog?.levels ?? []).join(', ')}). ${stillSent}: déjalo en ${empty}.`
        : `${label} no declara ${level} para este modelo en ${theirs}. ${stillSent}. Elige ` +
            `uno de los que declara o ${empty}.`;
    default:
      return `Ese valor no se puede elegir aquí: déjalo en ${empty}.`;
  }
}

/**
 * el rotulo de la opcion que conserva en el desplegable un valor que no se
 * ofrece. Se sigue ENSEÑANDO en vez de borrarse solo, y lo que lleva entre
 * parentesis dice por que no esta entre las demas —nunca «no admitido» en un
 * host con dialecto de catalogo, donde nadie ha dicho eso—.
 */
export function reasoningOrphanOption(value: ReasoningMode, choices: ReasoningChoices): string {
  const base = REASONING_MODE_LABELS[value];
  const label = choices.dialect?.label;
  if (label === undefined) return `${base} (no admitido)`;
  switch (choices.source) {
    case 'loading':
      return `${base} (leyendo el catálogo)`;
    case 'provider-wide':
      return `${base} (aquí no se envía)`;
    case 'levels':
    case 'not-reasoning':
      return `${base} (${label} no lo declara)`;
    default:
      return `${base} (sin comprobar)`;
  }
}

/**
 * el aviso que sale cuando el nombre del modelo lleva «deepseek».
 *
 * Recibe las MISMAS opciones que el selector de debajo. Sin eso, en un host con
 * dialecto de catalogo decia «con este nombre no puede» —la tabla no tiene esos
 * identificadores— justo encima de un selector que ofrecia los niveles
 * declarados. En la tabla el texto es el de siempre.
 */
export function deepseekSamplingNotice(choices: ReasoningChoices): string {
  const documented =
    'DeepSeek documenta que, cuando el modelo razona, ni la temperatura ni las penalizaciones ' +
    'de frecuencia y de presencia hacen efecto.';
  const measure =
    'Para medir, cambia una sola cosa cada vez y mira en Registros si esa llamada razonó.';
  const label = choices.dialect?.label;
  if (label !== undefined) {
    return (
      `${documented} No está comprobado en ${label}: con cualquier nivel distinto de «Sin ` +
      'razonar», la temperatura y las penalizaciones de esta entrada pueden dejar de actuar ' +
      `sin dar error. ${measure}`
    );
  }
  // «Con Sin razonar, si» solo donde Luxy sabe pedirlo: con otro nombre el
  // selector de abajo sale apagado
  const off = choices.options.includes('off')
    ? 'Con «Sin razonar» sí, si tu pasarela deja pasar el ajuste: el registro lo dirá.'
    : 'Luxy sólo sabe apagarle el razonamiento a DeepSeek-V4-Flash, V4-Pro y V4.1-Flash; con este nombre no puede.';
  return `${documented} ${off} ${measure}`;
}

/**
 * la marca de una fila de «Ajustes por modelo», o null si no hay nada que marcar.
 *
 * Existe porque lo guardado puede quedarse atras sin que nadie lo vea: la
 * pasarela cambia los niveles de un modelo, o el identificador se escribio con
 * una errata, y el ajuste sigue en la lista con el mismo aspecto. Antes solo se
 * veia al pulsar «Editar».
 *
 * Solo marca en un host con dialecto de catalogo, y solo lo que el catalogo
 * guardado permite decir: mientras se lee, o si se leyo sin detalle, calla.
 */
export function providerModelRowMark(
  row: Pick<ProviderModelSettings, 'apiModel' | 'sampling'>,
  baseUrl: string,
  stored: StoredCatalog,
): string | null {
  const choices = reasoningChoicesFor(row.apiModel, baseUrl, { stored });
  const label = choices.dialect?.label;
  if (label === undefined) return null;
  const { ofDate } = datedCatalog(choices);
  const mode = row.sampling?.reasoningMode;
  const level = mode === undefined ? null : `«${REASONING_MODE_SHORT[mode]}»`;
  if (choices.source === 'unknown-model') {
    return (
      `Este identificador no está en el catálogo de ${label}${ofDate}: comprueba las ` +
      'mayúsculas y el sufijo.' +
      (level === null ? '' : ` Luxy sigue enviando ${level} con él.`)
    );
  }
  if (mode === undefined || level === null || !isReasoningOrphan(mode, choices)) return null;
  switch (choices.source) {
    case 'missing':
      return `No hay catálogo de ${label} guardado para comprobar ${level}; Luxy lo sigue enviando.`;
    case 'not-reasoning':
      return (
        `${label} declara que este modelo no razona, en su catálogo${ofDate}; Luxy sigue ` +
        `enviando ${level} hasta que lo cambies.`
      );
    case 'levels':
      return (
        `${label} no declara ${level} en el catálogo${ofDate}; Luxy lo sigue enviando hasta ` +
        'que lo cambies.'
      );
    default:
      return null;
  }
}

/**
 * la pista del campo «Máximo de tokens de este modelo».
 *
 * El dato de la pasarela va AL LADO y nunca dentro del campo: es suyo y tiene
 * fecha, y rellenarlo solo seria elegir por el usuario un tope que se cobra
 * (`D-098`). Los numeros salen sin separador de miles porque asi hay que
 * escribirlos: «16.384» se rechaza al guardar.
 */
export function outputCapFieldHint(providerMax: number, choices: ReasoningChoices): string {
  const base =
    `Vacío = el del proveedor (${providerMax}). Un número entero entre 256 y 200000, sin ` +
    'puntos ni comas.';
  const declared = choices.catalog?.outputCap ?? null;
  const label = choices.dialect?.label;
  if (declared === null || label === undefined) return base;
  return (
    `${base} ${label} declara ${declared} de salida para este modelo en ` +
    `${datedCatalog(choices).theirs}; no está comprobado con ninguna llamada.`
  );
}

/**
 * el aviso de tope corto para un nivel que razona.
 *
 * El razonamiento se cobra como salida y sale del MISMO `max_tokens` que la
 * respuesta: con poco sitio puede gastarlo entero, y eso es una llamada pagada
 * que acaba en error. Es un aviso y no un valor por defecto —vacio sigue sin
 * mandar nada—, y los numeros que propone no estan medidos: son el tope por
 * defecto de un proveedor y su doble.
 */
export function reasoningCapWarning(input: {
  /** el campo del modelo esta vacio: se aplicaria el tope del proveedor */
  ownIsEmpty: boolean;
  providerMax: number;
  choices: ReasoningChoices;
}): string {
  const floor = REASONING_OUTPUT_CAP_FLOOR;
  const declared = input.choices.catalog?.outputCap ?? null;
  const label = input.choices.dialect?.label;
  const inEffect = input.ownIsEmpty
    ? ` Con este campo vacío se usa el del proveedor (${input.providerMax}).`
    : '';
  const advice =
    declared !== null && label !== undefined && declared < floor * 2
      ? ` ${label} declara ${declared} de salida para este modelo: no pongas más que eso.`
      : ` Pon aquí ${floor} o más; por ejemplo, ${floor * 2}.`;
  return (
    `Con un máximo por debajo de ${floor} tokens, el razonamiento puede gastarlo entero antes ` +
    'de escribir la respuesta: sale del mismo máximo, y esa llamada se paga igual.' +
    `${inEffect}${advice}`
  );
}

/**
 * el selector de razonamiento de un modelo (D-107), junto a la temperatura.
 *
 * Solo ofrece lo que hay con que respaldar: en un host de la tabla, los valores
 * que la documentacion de ESE modelo admite; en un host con dialecto de
 * catalogo, los niveles que la pasarela declara para el —o los siete, a mano,
 * cuando el catalogo no los trae—. La primera opcion es siempre «no enviar
 * nada». Sin nada que ofrecer el selector sale apagado: ofrecer algo ahi seria
 * prometer un efecto que no llega (D-093).
 *
 * NO calcula las opciones: las recibe hechas (`reasoningChoicesFor`). Son las
 * mismas que mira la validacion al guardar y el aviso de DeepSeek, y si cada
 * uno las calculara por su cuenta bastaria un argumento distinto para que la
 * pantalla se contradijera.
 *
 * Si el valor guardado ya no esta entre ellas —porque se cambio el modelo o la
 * URL, o porque la pasarela dejo de declararlo—, se sigue ENSEÑANDO con su
 * aviso en vez de borrarse solo: borrarlo en silencio cambiaria la
 * configuracion sin que nadie lo decidiera. Al guardar se rechaza.
 */
function ReasoningField({
  choices,
  value,
  onChange,
  providerWide = false,
  modelEmpty = false,
}: {
  choices: ReasoningChoices;
  value: ReasoningModeDraft;
  onChange: (next: ReasoningModeDraft) => void;
  /**
   * el valor se guarda en el nivel superior del proveedor HTTP, no en la
   * entrada de ese modelo: `samplingFor` lo aplica a CUALQUIER modelo que pida
   * la peticion y no tenga su propio ajuste. Las opciones salen del modelo del
   * formulario, y sin decirlo parecia un ajuste solo de ese modelo
   */
  providerWide?: boolean;
  /** el campo del modelo esta vacio: todavia no hay nombre que buscar */
  modelEmpty?: boolean;
}): JSX.Element {
  // el valor puesto que no esta entre las opciones. Se pinta SIEMPRE como una
  // opcion mas: sin ella el desplegable enseñaria «Lo que traiga el modelo»
  // mientras el valor guardado sigue siendo otro
  const fuera = value !== '' && !choices.options.includes(value) ? value : null;
  // mientras el catalogo se lee no es un huerfano: todavia no se sabe
  const huerfano = fuera !== null && isReasoningOrphan(fuera, choices) ? fuera : null;
  return (
    <Field
      label="Razonamiento"
      hint={reasoningHintFor(choices, { providerWide, modelEmpty })}
      // el error SUSTITUYE a la pista: la nota del modelo va dentro, o se perdia
      error={huerfano === null ? null : reasoningOrphanNotice(huerfano, choices)}
    >
      <select
        value={value}
        // con un huerfano se deja abierto aunque no haya nada que ofrecer: tiene
        // que poder vaciarse, o el formulario no se podria guardar nunca
        disabled={choices.options.length === 0 && huerfano === null}
        onChange={(event) => onChange(reasoningModeDraft(event.target.value))}
      >
        <option value="">Lo que traiga el modelo (no se envía nada)</option>
        {choices.options.map((mode) => (
          <option key={mode} value={mode}>
            {REASONING_MODE_LABELS[mode]}
          </option>
        ))}
        {fuera !== null && <option value={fuera}>{reasoningOrphanOption(fuera, choices)}</option>}
      </select>
    </Field>
  );
}

/** una fila de la lista de ajustes por modelo, ya dicha */
interface ModelSettingsRow {
  apiModel: string;
  /** lo guardado para ese modelo, en una linea */
  summary: string;
  /** lo guardado, en el molde del formulario, para poder editarlo */
  draft: ProviderModelDraft;
  /** lo que conviene saber de lo guardado sin abrir el editor, o null */
  mark: string | null;
}

/** lo que se esta editando: de que modelo y con que borrador */
interface ModelSettingsEditing {
  apiModel: string;
  isNew: boolean;
  draft: ProviderModelDraft;
}

/** como acabo un «Guardar» o un «Quitar». `error`: no se llego ni a intentar */
interface ModelSettingsApplied {
  saved: boolean;
  error: string | null;
}

/**
 * los ajustes POR MODELO de un origen: la lista de los modelos que tienen
 * alguno y el editor de uno.
 *
 * Es por modelo y no por origen porque un mismo origen sirve varios —una
 * conexion registra a la vez varias familias, y esas mismas ejecutan los
 * trabajos con herramientas; un proveedor HTTP como NanoGPT, cientos—: una
 * temperatura del origen se la llevarian todos. Aqui solo la recibe el modelo
 * exacto que se elige.
 *
 * NO SABE DE QUIEN ES. Lo usan las conexiones y los proveedores HTTP, que
 * guardan en sitios distintos y validan con esquemas distintos: el dueño le da
 * las filas ya dichas y una funcion que aplica, y aqui solo queda lo que es
 * igual para los dos —los cuatro campos de muestreo con sus reglas, el selector
 * de razonamiento y el orden de la pantalla—. Los rotulos son parametros porque
 * los de las conexiones estan citados letra por letra en `LOCAL-ACTIONS.md`.
 *
 * Lo que solo tiene un proveedor HTTP entra por tres puertas opcionales: su
 * catalogo guardado (`stored`), que alimenta el selector; el tope de salida por
 * modelo (`providerMaxOutputTokens`), que pinta su campo; y una barra propia
 * (`toolbar`). Sin ellas la seccion es, letra por letra, la de una conexion.
 */
function ModelSettingsSection({
  title,
  listId,
  emptyText,
  modelPlaceholder,
  baseUrl,
  rows,
  suggestions,
  editing,
  onEditing,
  onApply,
  notice,
  toolbar,
  stored,
  providerMaxOutputTokens,
}: {
  title: string;
  /** identificador del `<datalist>`: tiene que ser unico en la pagina */
  listId: string;
  /** lo que se dice cuando ningun modelo tiene ajustes */
  emptyText: string;
  modelPlaceholder: string;
  /** la URL base del origen: de su host salen las opciones de razonamiento */
  baseUrl: string;
  rows: readonly ModelSettingsRow[];
  /** nombres de modelo que se sugieren al añadir uno; no es una lista cerrada */
  suggestions: readonly string[];
  /**
   * lo que se edita vive en el DUEÑO y no aqui: un proveedor HTTP necesita
   * saber si el editor esta abierto para leer entonces su catalogo guardado
   */
  editing: ModelSettingsEditing | null;
  onEditing: (next: ModelSettingsEditing | null) => void;
  /** valida y guarda; un borrador vacio QUITA los ajustes de ese modelo */
  onApply: (apiModel: string, draft: ProviderModelDraft) => Promise<ModelSettingsApplied>;
  /** el aviso fijo del editor: lo que hay que saber antes de tocar nada */
  notice: ReactNode;
  toolbar?: ReactNode;
  /** el catalogo guardado del origen; AUSENTE = no tiene ninguno que leer */
  stored?: StoredCatalog;
  /** solo un proveedor HTTP: su tope, y con el el campo del tope por modelo */
  providerMaxOutputTokens?: number;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const setEditing = onEditing;

  const aplicar = async (apiModel: string, draft: ProviderModelDraft): Promise<void> => {
    const result = await onApply(apiModel, draft);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    if (result.saved) {
      setEditing(null);
      setError(null);
    }
  };

  const campo = (key: Exclude<keyof ProviderModelDraft, 'reasoningMode'>, value: string): void => {
    if (editing === null) return;
    setEditing({ ...editing, draft: { ...editing.draft, [key]: value } });
  };

  // UNA sola cuenta de opciones para el aviso de DeepSeek, el selector y la
  // pista del tope: los tres tienen que estar mirando lo mismo
  const choices =
    editing === null ? null : reasoningChoicesFor(editing.apiModel, baseUrl, { stored });

  return (
    <>
      <div className="row">
        <strong style={{ flex: 1 }}>{title}</strong>
        <button
          className="btn"
          type="button"
          disabled={editing !== null}
          onClick={() => {
            setEditing({ apiModel: '', isNew: true, draft: emptyProviderModelDraft() });
            setError(null);
          }}
        >
          Añadir modelo
        </button>
      </div>
      {toolbar}

      {rows.length === 0 && editing === null ? (
        <p className="page__lede">{emptyText}</p>
      ) : (
        rows.map((row) => (
          <div className="row" key={row.apiModel}>
            <span style={{ flex: 1 }}>
              <strong>{row.apiModel}</strong> · {row.summary}
              {row.mark !== null && (
                <span className="list__meta" style={{ display: 'block', color: 'var(--warn)' }}>
                  {row.mark}
                </span>
              )}
            </span>
            <button
              className="btn btn--quiet"
              type="button"
              disabled={editing !== null}
              onClick={() => {
                setEditing({ apiModel: row.apiModel, isNew: false, draft: row.draft });
                setError(null);
              }}
            >
              Editar
            </button>
            <button
              className="btn btn--danger btn--quiet"
              type="button"
              disabled={editing !== null}
              onClick={() => void aplicar(row.apiModel, emptyProviderModelDraft())}
            >
              Quitar
            </button>
          </div>
        ))
      )}

      {editing !== null && choices !== null && (
        <>
          {notice}
          {/deepseek/i.test(editing.apiModel) && (
            <Notice tone="idle">{deepseekSamplingNotice(choices)}</Notice>
          )}
          <Field
            label="Modelo"
            hint="El nombre exacto con el que viaja en la petición. Distingue mayúsculas."
          >
            <input
              type="text"
              list={listId}
              value={editing.apiModel}
              readOnly={!editing.isNew}
              placeholder={modelPlaceholder}
              onChange={(event) => setEditing({ ...editing, apiModel: event.target.value })}
            />
          </Field>
          <datalist id={listId}>
            {suggestions.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <div className="row">
            {/* de TEXTO y no `number`, por lo mismo que en el formulario de
                proveedor: «1,3» con un campo numérico llegaba vacío */}
            <Field label="Temperatura" hint="Vacío = no se envía. De 0 a 2.">
              <input
                type="text"
                inputMode="decimal"
                placeholder="sin enviar"
                value={editing.draft.temperature}
                onChange={(event) => campo('temperature', event.target.value)}
              />
            </Field>
            <Field
              label="Penalización por frecuencia"
              hint="Vacío = no se envía. De -2 a 2. Crece con las veces que ya salió ese token."
            >
              <input
                type="text"
                inputMode="decimal"
                placeholder="sin enviar"
                value={editing.draft.frequencyPenalty}
                onChange={(event) => campo('frequencyPenalty', event.target.value)}
              />
            </Field>
          </div>
          <ReasoningField
            choices={choices}
            modelEmpty={editing.apiModel.trim().length === 0}
            value={editing.draft.reasoningMode}
            onChange={(next) =>
              setEditing({ ...editing, draft: { ...editing.draft, reasoningMode: next } })
            }
          />
          {providerMaxOutputTokens !== undefined && (
            <>
              {/* de TEXTO, como los demas: lo que se escribe es lo que se ve, y
                  un valor que no vale lo explica el error al guardar */}
              <Field
                label="Máximo de tokens de este modelo"
                hint={outputCapFieldHint(providerMaxOutputTokens, choices)}
                explica="maxTokensModelo"
              >
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="el del proveedor"
                  value={editing.draft.outputCap}
                  onChange={(event) => campo('outputCap', event.target.value)}
                />
              </Field>
              {reasoningOutputCapIsShort(
                editing.draft.reasoningMode,
                editing.draft.outputCap,
                providerMaxOutputTokens,
              ) && (
                <Notice tone="warn">
                  {reasoningCapWarning({
                    ownIsEmpty: editing.draft.outputCap.trim().length === 0,
                    providerMax: providerMaxOutputTokens,
                    choices,
                  })}
                </Notice>
              )}
            </>
          )}
          <div className="row">
            <Field
              label="Penalización por presencia"
              hint="Vacío = no se envía. De -2 a 2. Se aplica una vez, en cuanto el token apareció."
            >
              <input
                type="text"
                inputMode="decimal"
                placeholder="sin enviar"
                value={editing.draft.presencePenalty}
                onChange={(event) => campo('presencePenalty', event.target.value)}
              />
            </Field>
            <Field
              label="Penalización por repetición"
              hint="Vacío = no se envía. Mayor que 0, neutro en 1. No es de OpenAI: sólo la admiten algunos servidores."
            >
              <input
                type="text"
                inputMode="decimal"
                placeholder="sin enviar"
                value={editing.draft.repetitionPenalty}
                onChange={(event) => campo('repetitionPenalty', event.target.value)}
              />
            </Field>
          </div>
          {error !== null && <Notice tone="fault">{error}</Notice>}
          <div className="row">
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void aplicar(editing.apiModel, editing.draft)}
            >
              Guardar
            </button>
            <button
              className="btn btn--quiet"
              type="button"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * el muestreo por modelo de una CONEXION.
 *
 * El titulo, el boton, la opcion vacia del selector y las etiquetas son los de
 * siempre, letra por letra: los citan `LA-050`, `LA-055` y `LA-058`. Una
 * conexion no tiene tope de salida por modelo ni catalogo que leer aqui: su
 * razonamiento sigue saliendo de la tabla de `D-107`.
 *
 * Los cuatro campos son los mismos, con el mismo aviso y las mismas reglas, que
 * los de un proveedor HTTP: vacio = no se envia.
 */
function ConnectionSamplingSection({
  connection,
  onSave,
}: {
  connection: ConnectionProfile;
  onSave: (next: ConnectionProfile) => Promise<boolean>;
}): JSX.Element {
  const [editing, setEditing] = useState<ModelSettingsEditing | null>(null);
  const entries = Object.entries(connection.modelSampling ?? {});
  const puestos = new Set(entries.map(([model]) => model));
  // sugerencias, no una lista cerrada: el modelo de una conversacion puede
  // salir del catalogo real de la pasarela y no del de fabrica
  const sugerencias = buildDefaultCatalog(connection.id)
    .map((model) => model.apiModel)
    .filter((model) => !puestos.has(model));

  const aplicar = async (
    apiModel: string,
    draft: ProviderModelDraft,
  ): Promise<ModelSettingsApplied> => {
    const result = withModelSampling(connection, apiModel, draft);
    if (result.connection === null) return { saved: false, error: result.error };
    return { saved: await onSave(result.connection), error: null };
  };

  return (
    <ModelSettingsSection
      title="Muestreo por modelo"
      listId={`sampling-models-${connection.id}`}
      emptyText="Ningún modelo de esta conexión lleva parámetros de muestreo: Luxy no envía ninguno."
      modelPlaceholder="DeepSeek-V4-Flash"
      baseUrl={connection.baseUrl}
      rows={entries.map(([apiModel, parameters]) => ({
        apiModel,
        summary: describeSampling(parameters),
        draft: providerModelSettingsToDraft({ sampling: parameters, outputCap: undefined }),
        mark: null,
      }))}
      suggestions={sugerencias}
      editing={editing}
      onEditing={setEditing}
      onApply={aplicar}
      notice={
        <Notice tone="idle">
          Se aplican <strong>sólo a este modelo</strong>, en todo lo que haga por esta conexión:
          conversaciones y trabajos. Si cambias de modelo, no le acompañan. Vacío significa que Luxy{' '}
          <strong>no los envía</strong>: el cuerpo de la petición sale igual que si estos campos no
          existieran. Las penalizaciones actúan sobre <strong>tokens</strong> que ya han salido, no
          sobre temas ni sobre ideas, y valores altos degradan la prosa. Cada servidor decide cuáles
          admite: puede ignorarlos o contestar con un error.
        </Notice>
      }
    />
  );
}

/**
 * el aviso fijo de «Ajustes por modelo» en un proveedor HTTP.
 *
 * Dice las tres cosas que aqui cuestan algo y que en una conexion no pasaban:
 *
 *  - un proveedor HTTP SI tiene muestreo propio, y la entrada de un modelo lo
 *    sustituye ENTERO (`samplingForModel`): ponerle un nivel a un modelo le quita
 *    la temperatura del proveedor sin que nadie lo decida. Y al reves: ponerle
 *    solo una temperatura le quita el nivel de razonamiento del proveedor, que
 *    en un host de la tabla SI viajaba con el. El tope va en otro mapa y no
 *    cuenta como entrada;
 *  - el razonamiento se cobra como salida, y un ajuste guardado se aplica a
 *    todos los turnos hasta que se quita (`D-082` no persistia lo caro; `D-107`
 *    si, y aqui es una pasarela de pago);
 *  - el «Presupuesto diario» no ve el gasto de un proveedor HTTP.
 *
 * No dice «admite» de ningun servidor: es texto que tambien se lee en NanoGPT.
 */
export const PROVIDER_MODEL_SETTINGS_NOTICE =
  'Se aplican sólo a este modelo, en todo lo que haga por este proveedor: conversaciones y ' +
  'trabajos. Vacío significa que Luxy no lo envía. En cuanto el modelo tiene aquí temperatura, ' +
  'alguna penalización o un nivel de razonamiento, deja de recibir la temperatura, las ' +
  'penalizaciones y el nivel de razonamiento del proveedor: repite aquí lo que quieras ' +
  'conservar. Poner sólo el máximo de tokens no cambia eso. Los tokens de razonamiento se cobran ' +
  'como salida, y el ajuste vale para todos los turnos de ese modelo hasta que lo quites: el ' +
  '«Presupuesto diario» de Luxy no lo frena en un proveedor HTTP. Cada servidor decide qué hace ' +
  'con lo que recibe: puede ignorarlo o contestar con un error.';

/** cuando se leyo un catalogo, con el formato de fecha y hora de esta pagina */
function catalogReadWhen(fetchedAt: string): string {
  return new Date(fetchedAt).toLocaleString();
}

/**
 * como se leyo el catalogo guardado, en una linea.
 *
 * `detailed` y `basic` son las dos formas de leer el de un host con dialecto de
 * catalogo, y hay que decir cual fue: en uno leido sin detalle, que un modelo
 * no traiga niveles no significa que la pasarela no los declare. Sin la marca
 * —un host sin dialecto, o un catalogo guardado antes de que existiera— la
 * linea es la de siempre.
 *
 * `gateway` es el nombre de la pasarela si su host tiene dialecto, o null.
 */
export function catalogReadLine(
  snapshot: Pick<CatalogSnapshot, 'fetchedAt' | 'detail'>,
  gateway: string | null,
): string {
  const when = catalogReadWhen(snapshot.fetchedAt);
  const who = gateway ?? 'la pasarela';
  if (snapshot.detail === 'detailed') {
    return (
      `Leído con detalle el ${when}: trae lo que ${who} declara de cada modelo, que Luxy no ha ` +
      'comprobado con ninguna llamada.'
    );
  }
  if (snapshot.detail === 'basic') {
    return (
      `Leído sin detalle el ${when}: no trae los niveles de razonamiento que ${who} declara ` +
      'de cada modelo.'
    );
  }
  return `Leido el ${when}`;
}

/**
 * el aviso de un catalogo guardado: lo que se dice de sus precios y de como se
 * leyo.
 *
 * Antes era un texto FIJO de la pantalla —«Esta conexion no publica precios por
 * API»—, que ignoraba el aviso guardado con el catalogo. En NanoGPT era falso:
 * su lista con detalle trae precios, y lo unico cierto es que Luxy no los lee.
 * El proceso principal ya guarda el aviso correcto de cada host, con el motivo
 * cuando la lista con detalle fallo; aqui se enseña ese.
 *
 * Un catalogo de un host con dialecto guardado sin la marca `detail` es de antes
 * de que Luxy pidiera la lista con detalle: su aviso es el texto viejo, y se
 * cambia por uno que dice que hacer.
 */
export function catalogNoticeText(
  snapshot: Pick<CatalogSnapshot, 'notice' | 'detail'>,
  gateway: string | null,
): string {
  if (gateway === null) {
    return snapshot.notice ?? 'Esta conexion no publica precios por API; Luxy no los consulta.';
  }
  if (snapshot.detail === undefined) {
    return (
      `Este catálogo de ${gateway} se guardó antes de que Luxy pidiera su lista con detalle: ` +
      `pulsa «Actualizar modelos» para leerla. Luxy no lee los precios de ${gateway}.`
    );
  }
  return snapshot.notice ?? `Luxy no lee los precios de ${gateway}.`;
}

/**
 * lo que se dice del catalogo guardado junto al boton de actualizarlo.
 *
 * Tres estados que no se pueden confundir: todavia no se ha leido el disco, no
 * hay nada guardado, o lo hay —y entonces cuantos modelos y como se leyo—.
 *
 * Un catalogo leido SIN detalle enseña el aviso que se guardo con el: es el
 * unico sitio donde queda POR QUE fallo la lista con detalle —su codigo HTTP—,
 * porque el respaldo salio bien y el boton no tuvo ningun error que enseñar.
 */
export function storedCatalogLine(stored: StoredCatalog, gateway: string | null): string {
  if (stored.loading) return 'Leyendo el catálogo guardado…';
  const snapshot = stored.snapshot;
  if (snapshot === null) {
    return 'No hay catálogo guardado de este proveedor: Luxy no sabe qué modelos sirve.';
  }
  const count = snapshot.models.length === 1 ? '1 modelo' : `${snapshot.models.length} modelos`;
  if (snapshot.detail === 'basic' && snapshot.notice !== null) {
    return `${count}. Leído el ${catalogReadWhen(snapshot.fetchedAt)}. ${snapshot.notice}`;
  }
  return `${count}. ${catalogReadLine(snapshot, gateway)}`;
}

/**
 * la etiqueta de un modelo del catalogo con lo que la pasarela declara de su
 * razonamiento, o null si no declara nada.
 *
 * UNA sola por fila, y con tres estados: la pasarela dice que si, dice que no,
 * o no dice nada. Ausente no pinta nada: un silencio no es un «no» (`D-093`).
 * Los niveles salen con SUS nombres y sin traducir, como las demas banderas de
 * esa lista. El «no» lleva delante quien lo dice, porque es una afirmacion de
 * un tercero y no algo que Luxy haya comprobado.
 */
export function declaredReasoningTag(
  model: Pick<CatalogSnapshot['models'][number], 'reasoning' | 'reasoningEfforts'>,
  gateway: string | null,
): string | null {
  const efforts = model.reasoningEfforts ?? [];
  if (efforts.length > 0) {
    // con niveles y `reasoning: false` a la vez, la pasarela se contradice: se
    // enseñan los niveles sin afirmar ninguna de las dos cosas
    return `${model.reasoning === false ? 'niveles' : 'razona'}: ${efforts.join(' · ')}`;
  }
  if (model.reasoning === true) return 'razona, sin niveles declarados';
  if (model.reasoning === false) return `${gateway ?? 'la pasarela'} declara que no razona`;
  return null;
}

/**
 * el nombre de la pasarela de un origen del catalogo, si su host tiene dialecto
 * de catalogo; null en los demas.
 *
 * Solo esos hosts se nombran: lo que un catalogo cualquiera declare se atribuye
 * a «la pasarela», sin decir de quien es lo que Luxy no sabe de quien es.
 */
export function catalogGatewayLabel(
  config: StoredAgentConfig | null,
  origin: Pick<CatalogOrigin, 'id' | 'source'> | null,
): string | null {
  if (config === null || origin === null) return null;
  const baseUrl =
    origin.source === 'http'
      ? config.providers.http.find((provider) => provider.id === origin.id)?.baseUrl
      : config.connections.find((connection) => connection.id === origin.id)?.baseUrl;
  return baseUrl === undefined ? null : (catalogDialectFor(hostOfBaseUrl(baseUrl))?.label ?? null);
}

/**
 * los ajustes por modelo de un PROVEEDOR HTTP: el muestreo, el nivel de
 * razonamiento con lo que declara su catalogo, y el tope de salida.
 *
 * Es lo que le faltaba a un proveedor que sirve muchos modelos: su formulario
 * tiene UN nivel para todos, y en un agregador cada modelo declara los suyos.
 *
 * El catalogo guardado se lee SOLO cuando hay algo que decir con el —una fila
 * que marcar o el editor abierto—: hay una tarjeta por proveedor, y leyendo al
 * montar serian tantas lecturas de disco como proveedores para una seccion que
 * casi siempre esta cerrada. Por eso el boton de actualizarlo y su fecha salen
 * tambien solo entonces: sin leer no hay fecha que enseñar.
 */
function ProviderModelSection({
  provider,
  onSave,
}: {
  provider: HttpProviderConfig;
  onSave: (next: HttpProviderConfig) => Promise<boolean>;
}): JSX.Element {
  const [editing, setEditing] = useState<ModelSettingsEditing | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const settings = providerModelSettings(provider);
  const active = settings.length > 0 || editing !== null;
  const stored = useStoredCatalog(provider.id, 'http', active);
  const gateway = catalogDialectFor(hostOfBaseUrl(provider.baseUrl))?.label ?? null;

  const refrescar = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshError(null);
    // por `callBridge`: un rechazo del puente dejaria el boton en
    // «Actualizando…» para siempre
    const result = await callBridge(() =>
      window.luxy.refreshCatalog({ connectionId: provider.id, source: 'http' }),
    );
    setRefreshing(false);
    if (!result.ok) {
      // el error ya trae el codigo HTTP, si se conserva el catalogo anterior y
      // que hacer: se enseña entero
      setRefreshError(result.hint === null ? result.error : `${result.error} ${result.hint}`);
      return;
    }
    // es lo que hace que se enteren el selector de aqui al lado, que vuelve a
    // leer el disco, y el de modelo de Privado
    catalogChanged();
  };

  // al cerrarse el editor se va tambien el error de la ultima actualizacion: la
  // tarjeta sigue montada, y sin esto reabrirlo volvia a pintar un fallo viejo
  // como si acabara de pasar
  const cambiarEdicion = (next: ModelSettingsEditing | null): void => {
    setEditing(next);
    if (next === null) setRefreshError(null);
  };

  const aplicar = async (
    apiModel: string,
    draft: ProviderModelDraft,
  ): Promise<ModelSettingsApplied> => {
    // con el MISMO catalogo que alimenta el selector: en un host con dialecto
    // lo que se guarde aqui viaja sin que el agente lo vuelva a comprobar
    const result = withProviderModelSampling(provider, apiModel, draft, stored);
    if (result.provider === null) return { saved: false, error: result.error };
    return { saved: await onSave(result.provider), error: null };
  };

  return (
    <ModelSettingsSection
      title="Ajustes por modelo"
      listId={`provider-model-settings-${provider.id}`}
      emptyText="Ningún modelo de este proveedor tiene ajustes propios: todos usan los del proveedor."
      modelPlaceholder={provider.model}
      baseUrl={provider.baseUrl}
      rows={settings.map((row) => ({
        apiModel: row.apiModel,
        summary: describeProviderModelSettings(row),
        draft: providerModelSettingsToDraft(row),
        mark: providerModelRowMark(row, provider.baseUrl, stored),
      }))}
      // solo con el editor abierto: es donde existe la lista que las pinta
      suggestions={
        editing === null
          ? []
          : providerModelSuggestions(
              stored.snapshot,
              settings.map((row) => row.apiModel),
            )
      }
      editing={editing}
      onEditing={cambiarEdicion}
      onApply={aplicar}
      stored={stored}
      providerMaxOutputTokens={provider.maxOutputTokens}
      notice={<Notice tone="idle">{PROVIDER_MODEL_SETTINGS_NOTICE}</Notice>}
      toolbar={
        active ? (
          <>
            <div className="row">
              <button
                className="btn btn--quiet"
                type="button"
                disabled={refreshing}
                onClick={() => void refrescar()}
              >
                {refreshing ? 'Actualizando…' : REFRESH_PROVIDER_MODELS}
              </button>
              <span className="list__meta" style={{ flex: 1 }}>
                {storedCatalogLine(stored, gateway)}
              </span>
            </div>
            {refreshError !== null && <Notice tone="fault">{refreshError}</Notice>}
          </>
        ) : undefined
      }
    />
  );
}

export function ConnectionsPage({
  summary,
  onSave,
  onSetSecret,
  onDeleteSecret,
}: {
  summary: ConfigSummary;
  onSave: (config: unknown, providerSecret?: { name: string; value: string }) => Promise<boolean>;
  onSetSecret: (name: string, value: string) => Promise<boolean>;
  onDeleteSecret: (name: string) => Promise<boolean>;
}): JSX.Element {
  const connections = (summary.config?.connections ?? []) as ConnectionProfile[];
  const httpProviders = summary.config?.providers.http ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<HttpProviderDraft | null>(null);
  const [providerSecret, setProviderSecret] = useState('');
  const [providerError, setProviderError] = useState<string | null>(null);
  /** lo que conviene saber del proveedor elegido antes de gastar la clave */
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const [pendingProviderDelete, setPendingProviderDelete] = useState<HttpProviderConfig | null>(
    null,
  );

  const guardar = async (id: string): Promise<void> => {
    if (await onSetSecret(connectionSecretName(id), value)) {
      setEditing(null);
      setValue('');
    }
  };

  // sustituye UNA conexion y deja el resto de la configuracion tal cual; el
  // proceso principal la vuelve a validar entera con Zod antes de escribirla
  const guardarConexion = async (next: ConnectionProfile): Promise<boolean> => {
    if (summary.config === null) return false;
    return onSave({
      ...summary.config,
      connections: connections.map((item) => (item.id === next.id ? next : item)),
    });
  };

  // lo mismo para UN proveedor HTTP, cuando cambian sus ajustes por modelo. No
  // pasa por `guardarProveedor`: ese es el del formulario, que exige la clave
  // al crear y cierra el formulario al terminar
  const guardarAjustesProveedor = async (next: HttpProviderConfig): Promise<boolean> => {
    if (summary.config === null) return false;
    return onSave({
      ...summary.config,
      providers: {
        ...summary.config.providers,
        http: httpProviders.map((item) => (item.id === next.id ? next : item)),
      },
    });
  };

  const editarProveedor = (provider: HttpProviderConfig): void => {
    setEditingProviderId(provider.id);
    setProviderDraft(httpProviderToDraft(provider));
    setProviderSecret('');
    setProviderError(null);
    setProviderNote(null);
  };

  // PASO DE VERDAD: el formulario esta ENCIMA de la lista, asi que al pulsar
  // «Editar» en una conexion de las de abajo se rellenaba fuera de la vista y
  // parecia que el boton no respondia. Con siete conexiones no se ve ninguna de
  // las ultimas sin subir a ciegas.
  //
  // El desplazamiento va en un efecto y no en el manejador porque el panel no
  // existe en el DOM hasta que React vuelve a pintar. Y el ancla es un div
  // vacio delante del panel en vez de envolverlo: envolverlo obliga a reindentar
  // las casi doscientas lineas del formulario, y eso enterraria este cambio.
  const anclaFormularioProveedor = useRef<HTMLDivElement>(null);
  const formularioProveedorAbierto = providerDraft !== null;

  useEffect(() => {
    if (!formularioProveedorAbierto) return;
    anclaFormularioProveedor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // depende de QUE proveedor se edita, no del borrador entero: con el borrador
    // como dependencia, cada tecla escrita en el formulario lo desplazaria otra vez
  }, [formularioProveedorAbierto, editingProviderId]);

  const cancelarProveedor = (): void => {
    setEditingProviderId(null);
    setProviderDraft(null);
    setProviderSecret('');
    setProviderError(null);
    setProviderNote(null);
  };

  const guardarProveedor = async (): Promise<void> => {
    if (providerDraft === null || summary.config === null) return;
    const existing = httpProviders.find((provider) => provider.id === editingProviderId) ?? null;
    const built = buildHttpProvider(providerDraft, existing);
    if (built.provider === null) {
      setProviderError(built.error);
      return;
    }
    if (
      httpProviders.some(
        (provider) => provider.id === built.provider?.id && provider.id !== editingProviderId,
      )
    ) {
      setProviderError('Ya existe un proveedor con ese identificador.');
      return;
    }
    const key = providerSecret.trim();
    const endpointChanged =
      existing !== null &&
      existing.baseUrl.replace(/\/+$/, '') !== built.provider.baseUrl.replace(/\/+$/, '');
    if (existing === null && key.length === 0) {
      setProviderError('Introduce la clave de API para crear el proveedor.');
      return;
    }
    if (
      endpointChanged &&
      summary.secrets.configured[existing.apiKeyEnv] === true &&
      key.length === 0
    ) {
      setProviderError('Al cambiar el endpoint debes introducir de nuevo la clave de API.');
      return;
    }

    const nextHttp =
      existing === null
        ? [...httpProviders, built.provider]
        : httpProviders.map((provider) =>
            provider.id === editingProviderId ? built.provider! : provider,
          );
    const nextConfig = {
      ...summary.config,
      providers: { ...summary.config.providers, http: nextHttp },
    };
    const saved = await onSave(
      nextConfig,
      key.length === 0 ? undefined : { name: built.provider.apiKeyEnv, value: key },
    );
    if (saved) cancelarProveedor();
  };

  const quitarProveedor = async (provider: HttpProviderConfig): Promise<void> => {
    if (summary.config === null) return;
    const nextConfig = {
      ...summary.config,
      providers: {
        ...summary.config.providers,
        http: httpProviders.filter((item) => item.id !== provider.id),
      },
    };
    if (await onSave(nextConfig)) {
      setPendingProviderDelete(null);
      cancelarProveedor();
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

              <ConnectionSamplingSection connection={connection} onSave={guardarConexion} />
            </Panel>
          );
        })
      )}

      <div className="page__head">
        <h1 className="page__title">Proveedores HTTP</h1>
        <div className="row">
          <Tag>{httpProviders.length}</Tag>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!summary.secrets.encryptionAvailable || providerDraft !== null}
            onClick={() => {
              setEditingProviderId(null);
              setProviderDraft(emptyHttpProviderDraft());
              setProviderSecret('');
              setProviderError(null);
              setProviderNote(null);
            }}
          >
            Añadir proveedor
          </button>
        </div>
      </div>
      <p className="page__lede">
        APIs compatibles con chat completions. Luxy cifra la clave, añade `/chat/completions` a la
        URL base y aplica los cambios al agente sin exigir un reinicio manual.
      </p>

      <div ref={anclaFormularioProveedor} aria-hidden="true" />

      {providerDraft !== null && (
        <Panel
          title={editingProviderId === null ? 'Nuevo proveedor HTTP' : 'Editar proveedor HTTP'}
        >
          {providerError !== null && <Notice tone="fault">{providerError}</Notice>}
          {editingProviderId === null && (
            <Field
              label="Empezar desde uno conocido"
              hint="Rellena la URL base y un modelo de partida. Sigue haciendo falta tu clave."
            >
              <select
                value=""
                onChange={(event) => {
                  const preset = HTTP_PROVIDER_PRESETS.find(
                    (entry) => entry.id === event.target.value,
                  );
                  if (preset === undefined) return;
                  setProviderDraft({
                    ...providerDraft,
                    id: preset.id,
                    displayName: preset.displayName,
                    baseUrl: preset.baseUrl,
                    model: preset.model,
                  });
                  // lo que hay que saber antes de gastar la clave, no después
                  setProviderNote(preset.nota);
                }}
              >
                <option value="">Configurarlo a mano</option>
                {HTTP_PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.displayName}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {providerNote !== null && <Notice tone="idle">{providerNote}</Notice>}
          <Field
            label="Identificador"
            // el «queda fijo» ya lo cuenta el glosario; aqui sobra repetirlo
            hint="Minúsculas, números, guion o guion bajo."
            explica="identificadorProveedor"
          >
            <input
              type="text"
              value={providerDraft.id}
              readOnly={editingProviderId !== null}
              maxLength={32}
              spellCheck={false}
              placeholder="mi-proveedor"
              onChange={(event) => setProviderDraft({ ...providerDraft, id: event.target.value })}
            />
          </Field>
          <Field label="Nombre visible">
            <input
              type="text"
              value={providerDraft.displayName}
              maxLength={64}
              placeholder="Mi proveedor"
              onChange={(event) =>
                setProviderDraft({ ...providerDraft, displayName: event.target.value })
              }
            />
          </Field>
          <Field
            label="URL base"
            // el formato y el ejemplo los da el glosario; aqui queda lo que solo
            // sabe esta pantalla: la regla de HTTPS que aplica Luxy al validarla
            hint="HTTPS es obligatorio salvo en localhost."
            explica="urlBase"
          >
            <input
              type="url"
              value={providerDraft.baseUrl}
              maxLength={300}
              spellCheck={false}
              placeholder="https://api.example/v1"
              onChange={(event) =>
                setProviderDraft({ ...providerDraft, baseUrl: event.target.value })
              }
            />
          </Field>
          <Field label="Modelo predeterminado" explica="modeloTexto">
            <input
              type="text"
              value={providerDraft.model}
              maxLength={128}
              spellCheck={false}
              placeholder="modelo-texto-v2"
              onChange={(event) =>
                setProviderDraft({ ...providerDraft, model: event.target.value })
              }
            />
          </Field>
          <Field
            label="Clave de API"
            // que se cifra y no vuelve a verse ya lo dice el glosario: el hint
            // solo aclara lo que cambia entre crear y editar
            hint={
              editingProviderId === null
                ? 'Obligatoria al crear el proveedor.'
                : 'Déjala vacía para conservar la actual; introduce otra para sustituirla.'
            }
            explica="claveApi"
          >
            <input
              type="password"
              value={providerSecret}
              maxLength={512}
              autoComplete="new-password"
              placeholder={editingProviderId === null ? 'Pega la clave' : 'Sin cambios'}
              onChange={(event) => setProviderSecret(event.target.value)}
            />
          </Field>
          <div className="row">
            <Field label="Máximo de tokens" explica="maxTokens">
              <input
                type="number"
                min={256}
                max={200000}
                step={256}
                value={providerDraft.maxOutputTokens}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, maxOutputTokens: event.target.value })
                }
              />
            </Field>
            <Field
              label="Presupuesto diario"
              hint="0 significa sin límite local."
              explica="presupuestoDiario"
            >
              <input
                type="number"
                min={0}
                max={1000000}
                step="0.01"
                value={providerDraft.dailyBudget}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, dailyBudget: event.target.value })
                }
              />
            </Field>
          </div>
          {/*
            los cuatro van juntos y con el aviso delante porque el riesgo de
            este bloque no es escribir un numero malo: es creerse lo que hacen.
            El texto dice sobre QUE actuan y que degradan la prosa, y no promete
            ningun resultado, porque no se ha medido ninguno.
          */}
          <Notice tone="idle">
            Parámetros de muestreo, todos opcionales. Vacío significa que Luxy{' '}
            <strong>no los envía</strong>: el cuerpo de la petición sale igual que si estos campos
            no existieran, que es lo que conviene cuando la pasarela rechaza lo que no conoce. Las
            penalizaciones actúan sobre <strong>tokens</strong> que ya han salido, no sobre temas ni
            sobre ideas: no impiden volver a lo mismo con otras palabras. Valores altos degradan la
            prosa, porque el modelo empieza a esquivar palabras corrientes. Cada servidor decide
            cuáles admite: puede ignorarlos o contestar con un error.
          </Notice>
          <div className="row">
            {/* de TEXTO y no `number`, los cuatro: un campo numérico de HTML
                devuelve la cadena vacía ante cualquier cosa que no sea un
                decimal con punto, así que «1,5» —lo que sale de un teclado
                español— se guardaba como «sin poner» y sin ningún aviso. En
                texto se ve lo escrito, la coma se acepta y los rangos los
                valida Zod, que además explica qué pasa */}
            <Field label="Temperatura" hint="Vacío = no se envía. De 0 a 2.">
              <input
                type="text"
                inputMode="decimal"
                placeholder="sin enviar"
                value={providerDraft.temperature}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, temperature: event.target.value })
                }
              />
            </Field>
            <Field
              label="Penalización por frecuencia"
              hint="Vacío = no se envía. De -2 a 2. Crece con las veces que ya salió ese token."
            >
              <input
                type="text"
                inputMode="decimal"
                placeholder="sin enviar"
                value={providerDraft.frequencyPenalty}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, frequencyPenalty: event.target.value })
                }
              />
            </Field>
          </div>
          {/* el del NIVEL DE PROVEEDOR. En un host con dialecto de catalogo sale
              apagado y dice donde se elige: alli vale para cientos de modelos
              que declaran niveles distintos, y el agente no lo envia */}
          <ReasoningField
            choices={reasoningChoicesFor(providerDraft.model, providerDraft.baseUrl, {
              providerWide: true,
            })}
            modelEmpty={providerDraft.model.trim().length === 0}
            value={providerDraft.reasoningMode}
            onChange={(next) => setProviderDraft({ ...providerDraft, reasoningMode: next })}
            providerWide
          />
          <div className="row">
            <Field
              label="Penalización por presencia"
              hint="Vacío = no se envía. De -2 a 2. Se aplica una vez, en cuanto el token apareció."
            >
              <input
                type="text"
                inputMode="decimal"
                placeholder="sin enviar"
                value={providerDraft.presencePenalty}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, presencePenalty: event.target.value })
                }
              />
            </Field>
            <Field
              label="Penalización por repetición"
              hint="Vacío = no se envía. Mayor que 0, neutro en 1. No es de OpenAI: sólo la admiten algunos servidores."
            >
              <input
                type="text"
                inputMode="decimal"
                placeholder="sin enviar"
                value={providerDraft.repetitionPenalty}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, repetitionPenalty: event.target.value })
                }
              />
            </Field>
          </div>
          <div className="http-provider-options">
            <label className="check">
              <input
                type="checkbox"
                checked={providerDraft.enabled}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, enabled: event.target.checked })
                }
              />
              <span>
                Proveedor activo
                <small>Se anunciará al Gateway cuando tenga una clave guardada.</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={providerDraft.supportsStreaming}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, supportsStreaming: event.target.checked })
                }
              />
              <span>
                Respuesta en streaming
                <Explica termino="streaming" />
                <small>Desactívalo si el endpoint sólo devuelve JSON completo.</small>
              </span>
            </label>
          </div>
          <div className="row">
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void guardarProveedor()}
            >
              Guardar proveedor
            </button>
            <button className="btn btn--quiet" type="button" onClick={cancelarProveedor}>
              Cancelar
            </button>
          </div>
        </Panel>
      )}

      {httpProviders.length === 0 ? (
        <Panel flush>
          <Empty title="Ningun proveedor http">
            Añade desde aquí una API compatible y quedará disponible en Trabajos y Conversaciones.
          </Empty>
        </Panel>
      ) : (
        httpProviders.map((provider) => {
          const configured = summary.secrets.configured[provider.apiKeyEnv] === true;
          return (
            <Panel
              key={provider.id}
              title={provider.displayName}
              actions={
                <>
                  <Tag tone={provider.enabled ? 'ok' : undefined}>
                    {provider.enabled ? 'activo' : 'desactivado'}
                  </Tag>
                  <Tag tone={configured ? 'ok' : 'warn'}>
                    {configured ? 'clave configurada' : 'sin clave'}
                  </Tag>
                </>
              }
            >
              <Field label="Base URL">
                <input type="text" value={provider.baseUrl} readOnly />
              </Field>
              <Field label="Modelo">
                <input type="text" value={provider.model} readOnly />
              </Field>
              <div className="row">
                <Tag>{provider.supportsStreaming ? 'streaming' : 'respuesta completa'}</Tag>
                <Tag>{provider.maxOutputTokens.toLocaleString('es-ES')} tokens</Tag>
                <button className="btn" type="button" onClick={() => editarProveedor(provider)}>
                  Editar
                </button>
                <button
                  className="btn btn--danger btn--quiet"
                  type="button"
                  onClick={() => setPendingProviderDelete(provider)}
                >
                  Eliminar
                </button>
              </div>

              <ProviderModelSection provider={provider} onSave={guardarAjustesProveedor} />
            </Panel>
          );
        })
      )}

      {pendingProviderDelete !== null && (
        <div className="confirm-layer" role="presentation">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-delete-title"
          >
            <div className="silk" id="provider-delete-title">
              Eliminar proveedor
            </div>
            <p>
              ¿Eliminar <strong>{pendingProviderDelete.displayName}</strong> y su clave cifrada?
              Dejará de aparecer en Trabajos y Conversaciones.
            </p>
            <div className="confirm-dialog__actions">
              <button className="btn" type="button" onClick={() => setPendingProviderDelete(null)}>
                Volver
              </button>
              <button
                className="btn btn--danger"
                type="button"
                onClick={() => void quitarProveedor(pendingProviderDelete)}
              >
                Eliminar
              </button>
            </div>
          </section>
        </div>
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
  origin,
  origins,
  onOrigin,
  snapshot,
  onSnapshot,
  gateway,
}: {
  origin: CatalogOrigin | null;
  origins: CatalogOrigin[];
  onOrigin: (value: string) => void;
  snapshot: CatalogSnapshot | null;
  onSnapshot: (value: CatalogSnapshot) => void;
  /** el nombre de la pasarela si su host tiene dialecto de catalogo, o null */
  gateway: string | null;
}): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (origin === null) return null;

  const refrescar = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await window.luxy.refreshCatalog({
      connectionId: origin.id,
      source: origin.source,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSnapshot(result.value);
    // sin esto el catálogo nuevo se quedaba en esta pantalla: el selector de
    // modelo de Privado seguía vacío hasta reiniciar Luxy
    catalogChanged();
  };

  const porFamiliaReal = new Map<string, CatalogSnapshot['models']>();
  for (const model of snapshot?.models ?? []) {
    const familia = guessDisplayGroup(model.apiModel);
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
      {origins.length > 1 && (
        <Field
          label="A quién se le pregunta"
          hint="Cada conexión y cada proveedor HTTP sirve sus propios modelos; se consultan por separado."
        >
          <select
            value={catalogOriginKey(origin)}
            onChange={(event) => onOrigin(event.target.value)}
          >
            {origins.map((entry) => (
              <option key={catalogOriginKey(entry)} value={catalogOriginKey(entry)}>
                {entry.displayName}
                {entry.source === 'http' ? ' · proveedor HTTP' : ' · conexión'}
              </option>
            ))}
          </select>
        </Field>
      )}
      {error !== null && <Notice tone="fault">{error}</Notice>}
      {snapshot === null ? (
        <Empty title="Sin consultar todavia">
          Pulsa para preguntarle a {origin.displayName} qué modelos sirve de verdad.
        </Empty>
      ) : (
        <>
          <p className="list__meta">{catalogReadLine(snapshot, gateway)}</p>
          {/* el aviso guardado CON el catalogo, no un texto fijo: de un host a
              otro cambia lo que se puede decir de sus precios, y es donde queda
              por que se leyo sin detalle */}
          <Notice tone="idle">{catalogNoticeText(snapshot, gateway)}</Notice>
          {[...porFamiliaReal.entries()].map(([familia, modelos]) => (
            <section key={familia} className="model-catalog-family model-catalog-family--inline">
              <div className="silk">
                {familia} · {modelos.length}
              </div>
              <ul className="model-catalog-list">
                {modelos.map((model) => {
                  // lo que declara de su razonamiento va en UNA etiqueta propia,
                  // con sus tres estados y sus niveles; la bandera suelta
                  // `reasoning` diria lo mismo a medias, asi que cede el sitio
                  const razonamiento = declaredReasoningTag(model, gateway);
                  const declaradas = (model.declaredCapabilities ?? []).filter(
                    (capacidad) => razonamiento === null || capacidad !== 'reasoning',
                  );
                  return (
                    <li key={model.apiModel}>
                      <div className="list__main">
                        <div className="list__name mono scroller">{model.apiModel}</div>
                        {(declaradas.length > 0 || razonamiento !== null) && (
                          /* lo que dice la pasarela, con SUS nombres y sin
                             traducir: es un dato suyo, no una deducción nuestra.
                             Sin esto había que adivinar por el nombre cuál sabe
                             mirar una imagen */
                          <div className="row row--tight">
                            {razonamiento !== null && (
                              <Tag tone={model.reasoning === false ? 'idle' : 'busy'}>
                                {razonamiento}
                              </Tag>
                            )}
                            {declaradas.map((capacidad) => (
                              <Tag
                                key={capacidad}
                                tone={VISION_FLAGS.includes(capacidad) ? 'ok' : 'idle'}
                              >
                                {capacidad === 'vision' ? 've imágenes' : capacidad}
                              </Tag>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </Panel>
  );
}

export function ModelsPage({ summary }: { summary: ConfigSummary }): JSX.Element {
  const { snapshot, setSnapshot, origins, origin, setOriginKey } = useCatalogSnapshot(summary);
  const localEvidence = useModelEvidence();
  const { registry, skipped, unreadable } = buildRegistry(summary, snapshot, origin);
  const resolved = registry.resolveAll();
  // lo que la pasarela sirvio y no pudo entrar en el catalogo. Se dice en vez
  // de callarlo: un modelo que falta sin explicacion se busca durante un rato.
  // Los tres sumandos son tres sitios distintos donde se pierde un modelo —al
  // leer la respuesta, al construir el catalogo y al meterlo en el registro— y
  // hacen falta los tres: contando solo el de en medio, una pasarela con seis
  // filas raras dejaba dos modelos y el aviso decia que faltaba uno
  const descartados = unreadable + skipped.length + registry.conflicts.length;

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

      <CatalogoReal
        origin={origin}
        origins={origins}
        onOrigin={setOriginKey}
        snapshot={snapshot}
        onSnapshot={setSnapshot}
        gateway={catalogGatewayLabel(summary.config, origin)}
      />

      {descartados > 0 && (
        <Notice tone="warn">
          {descartados === 1
            ? 'Un modelo servido se quedo fuera del catalogo'
            : `${descartados} modelos servidos se quedaron fuera del catalogo`}
          : su entrada no se pudo leer, o el nombre esta repetido, vacio o no cabe. El resto de la
          lista es correcto.
        </Notice>
      )}
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
