// piezas compartidas de la interfaz.
//
// deliberadamente pocas y sin opciones: el sistema visual vive en styles.css y
// estas funciones solo le dan nombre a las combinaciones que se repiten.
import type { JSX, ReactNode } from 'react';

export type Tone = 'ok' | 'fault' | 'busy' | 'warn' | 'idle';

export function Panel({
  title,
  actions,
  flush,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="panel">
      {(title !== undefined || actions !== undefined) && (
        <div className="panel__head">
          <span className="silk">{title}</span>
          {actions !== undefined && <span className="row">{actions}</span>}
        </div>
      )}
      <div className={flush === true ? 'panel__body panel__body--flush' : 'panel__body'}>
        {children}
      </div>
    </section>
  );
}

export function Readout({ items }: { items: { label: string; value: ReactNode; tone?: Tone }[] }): JSX.Element {
  return (
    <dl className="readout">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd data-tone={item.tone}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tag({ tone, children }: { tone?: Tone; children: ReactNode }): JSX.Element {
  return (
    <span className="tag" data-tone={tone}>
      {children}
    </span>
  );
}

/**
 * un estado vacio es una invitacion a actuar, no un encogimiento de hombros:
 * siempre dice cual es el siguiente paso concreto.
 */
export function Empty({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p>{children}</p>
    </div>
  );
}

export function Notice({ tone, children }: { tone: Tone; children: ReactNode }): JSX.Element {
  return (
    <p className="notice" data-tone={tone} role={tone === 'fault' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error != null && error.length > 0 ? (
        <p className="field__error">{error}</p>
      ) : (
        hint !== undefined && <p className="field__hint">{hint}</p>
      )}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="skeleton"
          style={{ marginBottom: 9, width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  );
}
