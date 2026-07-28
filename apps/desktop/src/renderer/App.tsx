// shell de Luxy Desktop: barra de estado permanente, navegacion y panel.
import { useState, type JSX } from 'react';
import { StatusRail } from './ui/StatusRail.js';
import { useAgent } from './useAgent.js';
import { useConfig } from './useConfig.js';
import { HomePage, JobsPage } from './pages/Overview.js';
import { ConnectionsPage, ModelsPage, ProjectsPage } from './pages/Config.js';
import { LogsPage, SettingsPage } from './pages/System.js';
import { SetupPage } from './pages/Setup.js';

const SECCIONES = [
  { id: 'inicio', label: 'Inicio', short: 'IN' },
  { id: 'trabajos', label: 'Trabajos', short: 'TR' },
  { id: 'proyectos', label: 'Proyectos', short: 'PR' },
  { id: 'conexiones', label: 'Conexiones', short: 'CX' },
  { id: 'modelos', label: 'Modelos', short: 'MD' },
  { id: 'registros', label: 'Registros', short: 'RG' },
  { id: 'ajustes', label: 'Ajustes', short: 'AJ' },
] as const;

type SeccionId = (typeof SECCIONES)[number]['id'];

export function App(): JSX.Element {
  const { status, activity, busy, error, start, stop, restart } = useAgent();
  const { summary, loading, save, setSecret, deleteSecret, reload } = useConfig();
  const [seccion, setSeccion] = useState<SeccionId>('inicio');
  // el onboarding se abre solo la primera vez, y a mano desde Ajustes
  const [setupAbierto, setSetupAbierto] = useState(false);

  const mostrarSetup = setupAbierto || (!loading && !summary.configured);

  if (mostrarSetup) {
    return (
      <SetupPage
        summary={summary}
        onSave={save}
        onSetSecret={setSecret}
        onFinish={() => {
          setSetupAbierto(false);
          void reload();
          setSeccion('inicio');
        }}
        onCancel={() => setSetupAbierto(false)}
      />
    );
  }

  const trabajosActivos = status.agent?.activeJob == null ? 0 : 1;

  return (
    <div className="app">
      <StatusRail status={status} />

      <nav className="nav" aria-label="Secciones">
        {SECCIONES.map((entrada) => (
          <button
            key={entrada.id}
            className="nav__item"
            data-short={entrada.short}
            aria-current={seccion === entrada.id ? 'page' : undefined}
            onClick={() => setSeccion(entrada.id)}
          >
            {entrada.label}
            {entrada.id === 'trabajos' && trabajosActivos > 0 && (
              <span className="nav__count">{trabajosActivos}</span>
            )}
          </button>
        ))}
        <div className="nav__foot">
          {summary.secrets.encryptionAvailable ? 'Secretos cifrados' : 'Sin cifrado'}
        </div>
      </nav>

      <main className="main">
        {seccion === 'inicio' && (
          <HomePage
            status={status}
            activity={activity}
            busy={busy}
            error={error}
            onStart={() => void start()}
            onStop={() => void stop()}
            onRestart={() => void restart()}
            configured={summary.configured}
          />
        )}
        {seccion === 'trabajos' && <JobsPage activity={activity} />}
        {seccion === 'proyectos' && <ProjectsPage summary={summary} onSave={save} />}
        {seccion === 'conexiones' && (
          <ConnectionsPage summary={summary} onSetSecret={setSecret} onDeleteSecret={deleteSecret} />
        )}
        {seccion === 'modelos' && <ModelsPage summary={summary} />}
        {seccion === 'registros' && <LogsPage />}
        {seccion === 'ajustes' && (
          <SettingsPage
            summary={summary}
            onSave={save}
            onDeleteSecret={deleteSecret}
            onOpenSetup={() => setSetupAbierto(true)}
          />
        )}
      </main>
    </div>
  );
}
