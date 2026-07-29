// Registros y Ajustes.
import { useEffect, useState, type JSX } from 'react';
import { MACHINE_TOKEN_SECRET, type AppInfo } from '../../shared/ipc.js';
import { Empty, Field, Notice, Panel, Skeleton, Tag } from '../ui/primitives.js';
import type { ConfigSummary } from '../useConfig.js';

const NIVELES = ['todos', 'debug', 'info', 'warn', 'error'] as const;

export function LogsPage(): JSX.Element {
  const [lines, setLines] = useState<string[] | null>(null);
  const [level, setLevel] = useState<(typeof NIVELES)[number]>('todos');
  const [query, setQuery] = useState('');

  const cargar = async (): Promise<void> => {
    const result = await window.luxy.tailLogs(300);
    setLines(result.ok ? result.value.lines : []);
  };

  useEffect(() => {
    void cargar();
  }, []);

  const visibles = (lines ?? []).filter((line) => {
    if (level !== 'todos' && !line.includes(`"level":"${level}"`)) return false;
    return query.length === 0 || line.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Registros</h1>
        {lines !== null && <Tag>{visibles.length} lineas</Tag>}
      </div>
      <p className="page__lede">
        Registro del agente. Las claves y los tokens salen ya tapados: la redaccion ocurre antes de
        escribir en disco, no al mostrarlo aqui.
      </p>

      <Panel
        title="Filtros"
        actions={
          <>
            <button className="btn" onClick={() => void cargar()}>
              Actualizar
            </button>
            <button className="btn" onClick={() => void window.luxy.openLogsFolder()}>
              Abrir carpeta
            </button>
          </>
        }
      >
        <div className="row">
          <Field label="Nivel">
            <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
              {NIVELES.map((nivel) => (
                <option key={nivel} value={nivel}>
                  {nivel}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Buscar">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="texto o identificador"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Lineas" flush>
        {lines === null ? (
          <div style={{ padding: 16 }}>
            <Skeleton rows={6} />
          </div>
        ) : visibles.length === 0 ? (
          <Empty title="Nada que mostrar">
            {lines.length === 0
              ? 'El agente aun no ha escrito ninguna linea. Arrancalo desde Inicio.'
              : 'Ninguna linea coincide con el filtro. Prueba a ampliarlo.'}
          </Empty>
        ) : (
          <ul className="stream" style={{ maxHeight: 460 }}>
            {visibles.map((line, index) => (
              <li key={index}>
                <time>{extraerHora(line)}</time>
                <span className="scroller">{extraerMensaje(line)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function extraerHora(line: string): string {
  const match = /"ts":"([^"]+)"/.exec(line);
  if (match === null) return '';
  const date = new Date(match[1]!);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('es-ES', { hour12: false });
}

function extraerMensaje(line: string): string {
  const match = /"msg":"((?:[^"\\]|\\.)*)"/.exec(line);
  return match === null ? line : match[1]!.replace(/\\"/g, '"');
}

// -----------------------------------------------------------------------------

export function SettingsPage({
  summary,
  onSave,
  onDeleteSecret,
  onOpenSetup,
}: {
  summary: ConfigSummary;
  onSave: (config: unknown) => Promise<boolean>;
  onDeleteSecret: (name: string) => Promise<boolean>;
  onOpenSetup: () => void;
}): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let active = true;
    void window.luxy.getAppInfo().then((result) => {
      if (active && result.ok) setInfo(result.value);
    });
    return () => {
      active = false;
    };
  }, []);

  const config = summary.config;
  const tokenGuardado = summary.secrets.configured[MACHINE_TOKEN_SECRET] === true;

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Ajustes</h1>
      </div>
      <p className="page__lede">Configuracion de esta maquina y del propio Luxy.</p>

      {!summary.secrets.encryptionAvailable && (
        <Notice tone="fault">
          Windows no ofrece cifrado para tu cuenta en este equipo. Luxy no guardara secretos hasta
          que se resuelva.
        </Notice>
      )}

      <Panel
        title="Maquina"
        actions={
          <button className="btn" onClick={onOpenSetup}>
            {summary.configured ? 'Volver a configurar' : 'Configurar'}
          </button>
        }
      >
        {config === null ? (
          <Empty title="Sin configurar">
            Ejecuta la configuracion inicial para registrar esta maquina en tu gateway.
          </Empty>
        ) : (
          <>
            <Field label="Nombre de maquina">
              <input type="text" value={config.machineName} readOnly />
            </Field>
            <Field label="URL del gateway">
              <input type="text" value={config.gatewayUrl} readOnly />
            </Field>
            <Field
              label="Token de maquina"
              hint={
                tokenGuardado
                  ? 'Guardado cifrado. Vuelve a registrar la maquina para sustituirlo.'
                  : 'No hay token guardado: la maquina no podra hablar con el gateway.'
              }
            >
              <div className="row">
                <input type="password" value={tokenGuardado ? '••••••••••••' : ''} readOnly style={{ flex: 1 }} />
                <Tag tone={tokenGuardado ? 'ok' : 'fault'}>
                  {tokenGuardado ? 'configurado' : 'ausente'}
                </Tag>
              </div>
            </Field>
          </>
        )}
      </Panel>

      <Panel title="Arranque">
        <label className="check">
          <input
            type="checkbox"
            checked={config?.ui.enabled ?? false}
            onChange={(event) =>
              config !== null &&
              void onSave({ ...config, ui: { ...config.ui, enabled: event.target.checked } })
            }
            disabled={config === null}
          />
          <span>
            Interfaz local en el navegador
            <small>
              Sirve la vista antigua en 127.0.0.1. No hace falta con Luxy Desktop; util para
              diagnosticar.
            </small>
          </span>
        </label>
      </Panel>

      <Panel title="Seguridad">
        <div className="row">
          <button
            className="btn btn--danger"
            onClick={() => void onDeleteSecret(MACHINE_TOKEN_SECRET)}
            disabled={!tokenGuardado}
          >
            Borrar token guardado
          </button>
        </div>
        <p className="field__hint">
          Al borrarlo, el agente dejara de conectarse hasta que vuelvas a registrar la maquina.
        </p>
      </Panel>

      <Panel title="Acerca de">
        {info === null ? (
          <Skeleton rows={2} />
        ) : (
          <ul className="list" style={{ margin: -16 }}>
            <li>
              <div className="list__main">
                <div className="list__name">Luxy {info.appVersion}</div>
                <div className="list__meta mono">
                  Electron {info.electronVersion} · Node {info.nodeVersion} · {info.platform}
                </div>
                <div className="list__meta mono scroller">
                  agente: {info.agentBuild ?? 'sin arrancar'}
                </div>
              </div>
              <Tag tone={info.encryptionAvailable ? 'ok' : 'fault'}>
                {info.encryptionAvailable ? 'cifrado disponible' : 'sin cifrado'}
              </Tag>
            </li>
            <li>
              <div className="list__main">
                <div className="list__name">Configuracion</div>
                <div className="list__meta mono scroller">{summary.configPath}</div>
              </div>
            </li>
          </ul>
        )}
      </Panel>
    </>
  );
}
