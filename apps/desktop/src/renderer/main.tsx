import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppBoundary } from './ui/ErrorBoundary';
import './styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('falta el contenedor #root');

// la barrera va DENTRO de StrictMode y envuelve a App entera: sin ella,
// cualquier excepcion en cualquier render desmonta el arbol y deja la ventana
// en blanco, que es lo que paso el 2026-09-15
createRoot(container).render(
  <StrictMode>
    <AppBoundary>
      <App />
    </AppBoundary>
  </StrictMode>,
);
