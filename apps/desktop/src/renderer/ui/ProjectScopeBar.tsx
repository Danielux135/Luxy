import type { JSX } from 'react';

export function ProjectScopeBar({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="project-scope" role="status">
      <span>
        <span className="silk">Proyecto activo</span>
        <strong>{label}</strong>
      </span>
      <button className="btn btn--quiet" type="button" onClick={onClear}>
        Ver todos los proyectos
      </button>
    </div>
  );
}
