// la red de seguridad del arbol de React.
//
// POR QUE SE PRUEBA ASI Y NO PINTANDO: este repositorio no tiene jsdom ni
// testing-library, y anadirlos por un panel de error seria pagar mucho por
// poco. Lo que si se puede afirmar sin DOM es el contrato que hace que la
// ventana no se pierda: que una excepcion se convierte en estado en vez de
// propagarse, y que con ese estado se devuelve un panel y no los hijos que
// acaban de fallar. El 2026-09-15 no habia NINGUNA barrera en el renderer
// —`createRoot(...).render(<StrictMode><App /></StrictMode>)` y ahi acababa—,
// asi que una excepcion en el render de `ModelsPage` desmonto el arbol entero.
import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { ErrorBoundary } from './ErrorBoundary.js';

describe('ErrorBoundary', () => {
  it('convierte la excepcion en estado en vez de dejarla subir', () => {
    const error = new Error('hay dos modelos con la id "koboldcpp-llama-3.2-3b"');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it('sin error deja pasar a sus hijos tal cual', () => {
    const boundary = new ErrorBoundary({ children: 'contenido' });
    expect(boundary.render()).toBe('contenido');
  });

  it('con error pinta un panel, no los hijos que acaban de fallar', () => {
    const boundary = new ErrorBoundary({ children: 'contenido' });
    boundary.state = { error: new Error('se rompio') };
    const pintado = boundary.render();
    expect(isValidElement(pintado)).toBe(true);
    expect(JSON.stringify(pintado)).toContain('se rompio');
  });

  it('un error sin mensaje sigue diciendo algo', () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { error: new Error('') };
    expect(JSON.stringify(boundary.render())).toContain('Error sin mensaje');
  });
});
