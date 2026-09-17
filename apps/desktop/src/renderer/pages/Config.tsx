// Proyectos, Conexiones y Modelos.
import { useEffect, useRef, useState, type JSX } from 'react';
import {
  ALLOWED_TEST_EXECUTABLES,
  ModelRegistry,
  buildCatalogReport,
  buildDefaultCatalog,
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
import {
  buildHttpProvider,
  emptyHttpProviderDraft,
  httpProviderToDraft,
  HTTP_PROVIDER_PRESETS,
  type HttpProviderConfig,
  type HttpProviderDraft,
} from '../http-provider-config.js';
import { Empty, Explica, Field, Notice, Panel, Tag } from '../ui/primitives.js';
import type { ConfigSummary } from '../useConfig.js';
import {
  catalogChanged,
  catalogOriginKey,
  catalogOriginsOf,
  type CatalogOrigin,
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
}: {
  origin: CatalogOrigin | null;
  origins: CatalogOrigin[];
  onOrigin: (value: string) => void;
  snapshot: CatalogSnapshot | null;
  onSnapshot: (value: CatalogSnapshot) => void;
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
                {modelos.map((model) => {
                  const declaradas = model.declaredCapabilities ?? [];
                  return (
                    <li key={model.apiModel}>
                      <div className="list__main">
                        <div className="list__name mono scroller">{model.apiModel}</div>
                        {declaradas.length > 0 && (
                          /* lo que dice la pasarela, con SUS nombres y sin
                             traducir: es un dato suyo, no una deducción nuestra.
                             Sin esto había que adivinar por el nombre cuál sabe
                             mirar una imagen */
                          <div className="row row--tight">
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
