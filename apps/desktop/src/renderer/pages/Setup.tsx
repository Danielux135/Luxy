// configuracion inicial en seis pasos.
//
// aqui la numeracion SI es informacion: es una secuencia real, cada paso depende
// del anterior y el usuario necesita saber cuanto le queda.
import { useCallback, useEffect, useState, type JSX } from 'react';
import {
  DEFAULT_CONNECTIONS,
  DEFAULT_CONNECTION_ID,
  ModelRegistry,
  buildCatalogForConnection,
  buildDefaultCatalog,
  type StoredAgentConfig,
} from '@luxy/shared';
import { connectionSecretName } from '../../shared/ipc.js';
import { Empty, Field, Notice, Panel, Skeleton, Tag } from '../ui/primitives.js';
import type { ConfigSummary } from '../useConfig.js';

const PASOS = ['Maquina', 'Herramientas', 'Conexion', 'Modelos', 'Proyectos', 'Resumen'] as const;

interface ToolPresence {
  available: boolean;
  version: string | null;
  path: string | null;
}

export function suggestedMachineName(hostname: string): string {
  const normalized = hostname
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-$/g, '');
  return normalized.length > 0 ? normalized : 'equipo';
}

export function configWithRegisteredMachine(
  config: StoredAgentConfig,
  machineId: string | null,
): StoredAgentConfig {
  return machineId === null ? config : { ...config, machineId };
}

export function SetupPage({
  summary,
  onSave,
  onSetSecret,
  onFinish,
  onCancel,
}: {
  summary: ConfigSummary;
  onSave: (config: unknown) => Promise<boolean>;
  onSetSecret: (name: string, value: string) => Promise<boolean>;
  onFinish: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [step, setStep] = useState(0);

  // paso 1
  const [machineName, setMachineName] = useState(summary.config?.machineName ?? '');
  const [gatewayUrl, setGatewayUrl] = useState(summary.config?.gatewayUrl ?? '');
  const [registrationSecret, setRegistrationSecret] = useState('');
  const [gatewayState, setGatewayState] = useState<string | null>(null);
  const [registered, setRegistered] = useState(summary.secrets.configured['machineToken'] === true);
  const [machineId, setMachineId] = useState<string | null>(summary.config?.machineId ?? null);

  // paso 2
  const [tools, setTools] = useState<Record<string, ToolPresence> | null>(null);

  // paso 3
  const [baseUrl, setBaseUrl] = useState(DEFAULT_CONNECTIONS[0]?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [connectionState, setConnectionState] = useState<string | null>(null);
  const [servedModels, setServedModels] = useState<string[]>([]);

  // paso 5
  const [projects, setProjects] = useState<Record<string, string>>(() => {
    const existing = summary.config?.projects ?? {};
    return Object.fromEntries(Object.entries(existing).map(([alias, p]) => [alias, p.path]));
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectar = useCallback(async () => {
    setTools(null);
    const result = await window.luxy.detectTools();
    setTools(result.ok ? (result.value.tools as Record<string, ToolPresence>) : {});
  }, []);

  useEffect(() => {
    if (step === 1 && tools === null) void detectar();
  }, [step, tools, detectar]);

  useEffect(() => {
    if (summary.config?.machineName !== undefined) return;
    void window.luxy.getAppInfo().then((result) => {
      if (!result.ok) return;
      setMachineName((current) =>
        current.length > 0 ? current : suggestedMachineName(result.value.hostname),
      );
    });
  }, [summary.config?.machineName]);

  // ---------------------------------------------------------------------------

  const comprobarGateway = async (): Promise<void> => {
    setBusy(true);
    setGatewayState(null);
    const result = await window.luxy.checkGateway(gatewayUrl);
    setBusy(false);
    if (!result.ok) {
      setGatewayState(result.error);
      return;
    }
    setGatewayState(
      result.value.reachable
        ? 'El gateway responde.'
        : `No responde: ${result.value.error ?? 'sin detalle'}`,
    );
  };

  const registrar = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await window.luxy.registerMachine({
      gatewayUrl,
      machineName,
      registrationSecret,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // el secreto de registro no vuelve a hacer falta: se olvida en el acto
    setRegistrationSecret('');
    setRegistered(true);
    setMachineId(result.value.machineId);
    await onSave(configWithRegisteredMachine(buildConfig(), result.value.machineId));
  };

  const guardarClave = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const guardado = await onSetSecret(connectionSecretName(DEFAULT_CONNECTION_ID), apiKey);
    setBusy(false);
    if (guardado) setApiKey('');
  };

  const probarConexion = async (): Promise<void> => {
    setBusy(true);
    setConnectionState(null);
    const result = await window.luxy.testConnection(DEFAULT_CONNECTION_ID);
    setBusy(false);
    if (!result.ok) {
      setConnectionState(result.error);
      return;
    }
    if (result.value.reachable) {
      setServedModels(result.value.models);
      setConnectionState(`La conexion responde y sirve ${result.value.models.length} modelos.`);
    } else {
      setConnectionState(result.value.error ?? 'No responde.');
    }
  };

  function buildConfig(): StoredAgentConfig {
    const base = summary.config;
    return {
      ...(base ?? {}),
      machineName,
      gatewayUrl,
      projects: Object.fromEntries(
        Object.entries(projects).map(([alias, path]) => [
          alias,
          {
            ...(base?.projects[alias] ?? {}),
            path,
            type: base?.projects[alias]?.type ?? 'other',
            testCommands: base?.projects[alias]?.testCommands ?? [],
            testTimeoutMs: base?.projects[alias]?.testTimeoutMs ?? 600_000,
            allowHostChecks: base?.projects[alias]?.allowHostChecks ?? false,
            allowEdits: base?.projects[alias]?.allowEdits ?? true,
            allowCommit: base?.projects[alias]?.allowCommit ?? true,
            allowPush: base?.projects[alias]?.allowPush ?? false,
          },
        ]),
      ),
      connections: [{ ...DEFAULT_CONNECTIONS[0]!, baseUrl }],
    } as StoredAgentConfig;
  }

  const terminar = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const guardado = await onSave(buildConfig());
    setBusy(false);
    if (guardado) onFinish();
  };

  const anadirProyecto = async (): Promise<void> => {
    const result = await window.luxy.pickFolder('Elige la carpeta del proyecto');
    if (!result.ok || result.value.canceled || result.value.path === null) return;
    const path = result.value.path;
    const sugerido = (path.split(/[\\/]/).pop() ?? 'proyecto')
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-');
    setProjects((previous) => ({ ...previous, [sugerido]: path }));
  };

  const claveGuardada =
    summary.secrets.configured[connectionSecretName(DEFAULT_CONNECTION_ID)] === true;
  const puedeAvanzar = step !== 0 || registered;

  return (
    <div className="setup">
      <aside className="setup__rail">
        <p className="setup__brand">LUXY</p>
        <p className="setup__tagline">Configuracion inicial de esta maquina</p>
        <ol className="steps">
          {PASOS.map((nombre, indice) => (
            <li
              key={nombre}
              data-state={indice === step ? 'current' : indice < step ? 'done' : 'pending'}
            >
              <span className="steps__n">{String(indice + 1).padStart(2, '0')}</span>
              <span className="steps__label">{nombre}</span>
            </li>
          ))}
        </ol>
      </aside>

      <div className="setup__stage">
        <div className="wrap">
          {error !== null && <Notice tone="fault">{error}</Notice>}

          {step === 0 && (
            <>
              <h1 className="page__title">Registra esta maquina</h1>
              <p className="page__lede">
                Luxy necesita un nombre para esta maquina y la direccion de tu gateway. El secreto
                de registro se usa una sola vez y no se guarda.
              </p>
              <Field
                label="Nombre de maquina"
                hint="Minusculas, digitos y guion. Por ejemplo: sobremesa"
              >
                <input
                  type="text"
                  value={machineName}
                  onChange={(event) => setMachineName(event.target.value)}
                  placeholder="sobremesa"
                  spellCheck={false}
                />
              </Field>
              <Field label="URL del gateway">
                <div className="row">
                  <input
                    type="url"
                    value={gatewayUrl}
                    onChange={(event) => setGatewayUrl(event.target.value)}
                    placeholder="https://luxy.tu-dominio.workers.dev"
                    style={{ flex: 1 }}
                  />
                  <button className="btn" onClick={() => void comprobarGateway()} disabled={busy}>
                    Comprobar
                  </button>
                </div>
              </Field>
              {gatewayState !== null && <Notice tone="warn">{gatewayState}</Notice>}
              <Field
                label="Secreto de registro"
                hint="El valor de MACHINE_REGISTRATION_SECRET de tu gateway. Se descarta tras registrar."
              >
                <input
                  type="password"
                  value={registrationSecret}
                  onChange={(event) => setRegistrationSecret(event.target.value)}
                />
              </Field>
              <div className="row">
                <button
                  className="btn btn--primary"
                  onClick={() => void registrar()}
                  disabled={busy || machineName.length === 0 || registrationSecret.length < 8}
                >
                  Registrar maquina
                </button>
                {registered && <Tag tone="ok">registrada</Tag>}
              </div>
              {machineId !== null && (
                <Notice tone="ok">
                  ID de máquina: <span className="mono">{machineId}</span>
                </Notice>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="page__title">Herramientas locales</h1>
              <p className="page__lede">
                Lo que Luxy ha encontrado en esta maquina. Claude y Codex usan tu sesion local: no
                hacen falta claves de API para ellos.
              </p>
              <Panel
                title="Detectado"
                flush
                actions={
                  <button className="btn" onClick={() => void detectar()}>
                    Volver a detectar
                  </button>
                }
              >
                {tools === null ? (
                  <div style={{ padding: 16 }}>
                    <Skeleton rows={5} />
                  </div>
                ) : (
                  <ul className="list">
                    {Object.entries(tools)
                      .filter(([, presence]) => typeof presence === 'object' && presence !== null)
                      .map(([name, presence]) => (
                        <li key={name}>
                          <div className="list__main">
                            <div className="list__name">{name}</div>
                            <div className="list__meta mono scroller">
                              {presence.version ?? 'sin version'}
                              {presence.path !== null && ` · ${presence.path}`}
                            </div>
                          </div>
                          <Tag tone={presence.available ? 'ok' : 'fault'}>
                            {presence.available ? 'disponible' : 'no encontrado'}
                          </Tag>
                        </li>
                      ))}
                  </ul>
                )}
              </Panel>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="page__title">Conexion de API</h1>
              <p className="page__lede">
                Un endpoint compatible con OpenAI que sirve varios modelos. La clave se cifra con tu
                cuenta de Windows y no vuelve a mostrarse.
              </p>
              {!summary.secrets.encryptionAvailable && (
                <Notice tone="fault">
                  Windows no ofrece cifrado para tu cuenta. Luxy no guardara la clave sin cifrar.
                </Notice>
              )}
              <Field label="Base URL">
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  spellCheck={false}
                />
              </Field>
              <Field
                label="Clave de API"
                hint={
                  claveGuardada
                    ? 'Ya hay una guardada. Introduce otra para sustituirla.'
                    : undefined
                }
              >
                <div className="row">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={claveGuardada ? '••••••••••••' : 'Pega la clave'}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn"
                    onClick={() => void guardarClave()}
                    disabled={busy || apiKey.length === 0 || !summary.secrets.encryptionAvailable}
                  >
                    Guardar
                  </button>
                </div>
              </Field>
              <div className="row">
                <button
                  className="btn btn--primary"
                  onClick={() => void probarConexion()}
                  disabled={busy || !claveGuardada}
                >
                  Probar conexion
                </button>
                {claveGuardada && <Tag tone="ok">clave configurada</Tag>}
              </div>
              {connectionState !== null && <Notice tone="warn">{connectionState}</Notice>}
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="page__title">Modelos</h1>
              <p className="page__lede">
                Este es el catalogo que Luxy registrara. Podras activar, renombrar y cambiar el
                predeterminado de cada familia despues, sin repetir esta configuracion.
              </p>
              <SetupModels served={servedModels} />
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="page__title">Proyectos</h1>
              <p className="page__lede">
                Carpetas sobre las que Luxy podra trabajar. El alias es lo que escribiras en
                Telegram. Puedes añadir mas despues.
              </p>
              <Panel
                title="Carpetas"
                flush
                actions={
                  <button className="btn" onClick={() => void anadirProyecto()}>
                    Añadir carpeta
                  </button>
                }
              >
                {Object.keys(projects).length === 0 ? (
                  <Empty title="Ninguna carpeta">
                    Añade al menos una para poder mandarle trabajo a Luxy desde Telegram.
                  </Empty>
                ) : (
                  <ul className="list">
                    {Object.entries(projects).map(([alias, path]) => (
                      <li key={alias}>
                        <div className="list__main">
                          <div className="list__name">{alias}</div>
                          <div className="list__meta mono scroller">{path}</div>
                        </div>
                        <button
                          className="btn btn--danger btn--quiet"
                          onClick={() =>
                            setProjects((previous) => {
                              const next = { ...previous };
                              delete next[alias];
                              return next;
                            })
                          }
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          )}

          {step === 5 && (
            <>
              <h1 className="page__title">Todo listo</h1>
              <p className="page__lede">Revisa antes de terminar.</p>
              <Panel title="Resumen" flush>
                <ul className="list">
                  <li>
                    <div className="list__main">
                      <div className="list__name">Maquina</div>
                      <div className="list__meta mono">{machineName || 'sin nombre'}</div>
                      <div className="list__meta mono">
                        ID: {machineId ?? 'pendiente de registro'}
                      </div>
                    </div>
                    <Tag tone={registered ? 'ok' : 'fault'}>
                      {registered ? 'registrada' : 'sin registrar'}
                    </Tag>
                  </li>
                  <li>
                    <div className="list__main">
                      <div className="list__name">Gateway</div>
                      <div className="list__meta mono scroller">{gatewayUrl}</div>
                    </div>
                  </li>
                  <li>
                    <div className="list__main">
                      <div className="list__name">Conexion de API</div>
                      <div className="list__meta mono scroller">{baseUrl}</div>
                    </div>
                    <Tag tone={claveGuardada ? 'ok' : 'warn'}>
                      {claveGuardada ? 'clave cifrada' : 'sin clave'}
                    </Tag>
                  </li>
                  <li>
                    <div className="list__main">
                      <div className="list__name">Proyectos</div>
                      <div className="list__meta">
                        {Object.keys(projects).length === 0
                          ? 'ninguno'
                          : Object.keys(projects).join(', ')}
                      </div>
                    </div>
                  </li>
                </ul>
              </Panel>
            </>
          )}

          <div className="setup__foot">
            {step > 0 && (
              <button className="btn" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                Atras
              </button>
            )}
            {step < PASOS.length - 1 ? (
              <button
                className="btn btn--primary"
                onClick={() => setStep((s) => s + 1)}
                disabled={busy || !puedeAvanzar}
              >
                Siguiente
              </button>
            ) : (
              <button className="btn btn--primary" onClick={() => void terminar()} disabled={busy}>
                Terminar e iniciar Luxy
              </button>
            )}
            <button className="btn btn--quiet" onClick={onCancel} disabled={busy}>
              {summary.configured ? 'Volver' : 'Configurar despues'}
            </button>
          </div>

          {step === 0 && !registered && (
            <p className="field__hint" style={{ marginTop: 12 }}>
              Registra la maquina para continuar. Sin token, el agente no puede hablar con el
              gateway.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** catalogo del onboarding, cruzado con lo que la conexion dijo servir */
function SetupModels({ served }: { served: string[] }): JSX.Element {
  const registry = new ModelRegistry({
    connections: DEFAULT_CONNECTIONS,
    models:
      served.length === 0
        ? buildDefaultCatalog()
        : buildCatalogForConnection(DEFAULT_CONNECTION_ID, served),
    statuses: [
      {
        connectionId: DEFAULT_CONNECTION_ID,
        hasApiKey: true,
        reachable: served.length > 0,
        checkedAt: null,
        availableModels: served,
        error: null,
      },
    ],
  });

  const modelos = registry.resolveAll();
  return (
    <Panel title={`Catalogo (${modelos.length})`} flush>
      <ul className="list">
        {modelos.map(({ definition, servedByConnection }) => (
          <li key={definition.id}>
            <div className="list__main">
              <div className="list__name">{definition.displayName}</div>
              <div className="list__meta mono scroller">{definition.apiModel}</div>
            </div>
            <Tag>{definition.category}</Tag>
            {served.length === 0 ? (
              <Tag tone="warn">sin comprobar</Tag>
            ) : (
              <Tag tone={servedByConnection === true ? 'ok' : 'fault'}>
                {servedByConnection === true ? 'servido' : 'no servido'}
              </Tag>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
