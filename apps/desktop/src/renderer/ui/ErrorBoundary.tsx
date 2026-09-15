// red de seguridad del arbol de React.
//
// POR QUE EXISTE: el 2026-09-15 `ModelRegistry` lanzo DENTRO del render de
// `ModelsPage` y Luxy se quedo en negro —React desmonta el arbol entero ante
// cualquier excepcion en render— y hubo que cerrarla desde la bandeja. Ese
// fallo concreto ya esta contenido en su origen, que es donde tenia que
// estarlo: el catalogo omite y cuenta en vez de lanzar.
//
// Esto es la OTRA mitad de la misma regla `D-088`, la que no depende de haber
// enumerado los sitios que pueden lanzar. La garantia «la pantalla no se puede
// quedar en negro» no puede vivir en la memoria de quien escriba el siguiente
// render: quedan 212 KB de `Vault.tsx`, 57 KB de `Config.tsx` y 34 KB de
// `Laboratory.tsx` sin enumerar, y el precio de equivocarse una sola vez ya
// esta medido —la aplicacion entera—.
//
// LO QUE NO HACE: esconder el error. Se pinta con su mensaje y se escribe en la
// consola del renderer, porque un fallo de programacion tiene que oirse. Lo
// unico que cambia es que cuesta un panel y no la sesion de trabajo.
import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** salida alternativa al reintento; sin ella solo se ofrece reintentar */
  onReset?: (() => void) | undefined;
  resetLabel?: string | undefined;
  /** que se estaba pintando, para que el aviso diga algo mas que «fallo» */
  what?: string | undefined;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // a la consola del renderer: es lo unico que puede leer quien depura. Va la
    // traza de componentes, que dice QUE se estaba pintando; no se vuelca nada
    // del estado, que es por donde pasarian los datos de la boveda
    console.error('fallo al pintar la interfaz', error, info.componentStack);
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  private readonly reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    const { onReset, resetLabel, what } = this.props;
    return (
      <div className="panel" role="alert">
        <div className="panel__head">
          <span className="silk">{what === undefined ? 'Fallo en la interfaz' : what}</span>
        </div>
        <div className="panel__body">
          <p className="notice" data-tone="fault">
            {error.message.length === 0 ? 'Error sin mensaje' : error.message}
          </p>
          <p>
            Esta parte de Luxy no se pudo pintar. El resto sigue funcionando y no se ha perdido
            ningun trabajo: los que esten en marcha corren en el agente, no aqui.
          </p>
          <div className="row">
            <button onClick={this.retry}>Reintentar</button>
            {onReset !== undefined && (
              <button onClick={this.reset}>
                {resetLabel === undefined ? 'Volver a Inicio' : resetLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

/**
 * el mismo panel, envolviendo la ventana entera.
 *
 * Aqui la salida es recargar: si lo que fallo esta en la raiz —`useConfig`,
 * `useDetectedCatalog`— no queda ninguna seccion a la que irse, y recargar es
 * exactamente lo que Daniel tenia que hacer a mano cerrando desde la bandeja.
 */
export function AppBoundary({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ErrorBoundary
      what="Luxy no pudo pintar la ventana"
      resetLabel="Recargar"
      onReset={() => window.location.reload()}
    >
      {children}
    </ErrorBoundary>
  );
}
