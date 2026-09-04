// piezas compartidas de la interfaz.
//
// deliberadamente pocas y sin opciones: el sistema visual vive en styles.css y
// estas funciones solo le dan nombre a las combinaciones que se repiten.
import type { JSX, ReactNode } from 'react';
import { GLOSSARY, type GlossaryEntry, type GlossaryKey } from './glossary.js';

export type Tone = 'ok' | 'fault' | 'busy' | 'warn' | 'idle';

/**
 * explicacion de un tecnicismo, al pasar el raton por encima.
 *
 * Se abre con el raton Y con el teclado, y por eso es un `button` de verdad y
 * no un `span` con `title`: el `title` del navegador tarda un segundo, no se
 * puede leer con el teclado y se corta si el texto es largo, que es justo el
 * caso aqui.
 *
 * El texto vive en `glossary.ts`, nunca aqui: un termino se explica en un solo
 * sitio, y dos pantallas que lo usen comparten esa explicacion.
 */
export function Explica({ termino }: { termino: GlossaryKey }): JSX.Element {
  const entry: GlossaryEntry = GLOSSARY[termino];
  return (
    <span className="explica">
      <button
        type="button"
        className="explica__marca"
        // sin esto un lector de pantalla anuncia «boton» y nada mas
        aria-label={`Que es ${entry.termino}`}
        // este boton no HACE nada: se abre al pasar el raton y al enfocarlo con
        // el teclado. Cancelar el clic importa donde vive dentro de un
        // `<summary>`, porque alli pulsarlo plegaria el desplegable entero. El
        // foco si llega, que es lo que abre la caja al pulsarlo
        onClick={(event) => event.preventDefault()}
      >
        ?
      </button>
      <span className="explica__caja" role="tooltip">
        <span className="explica__termino">{entry.termino}</span>
        <span className="explica__que">{entry.queEs}</span>
        {entry.queRelleno !== undefined && (
          <span className="explica__rellenar">
            <strong>Qué escribir:</strong> {entry.queRelleno}
          </span>
        )}
        {entry.ejemplo !== undefined && (
          <span className="explica__ejemplo">
            Por ejemplo: <code>{entry.ejemplo}</code>
          </span>
        )}
        {entry.ojo !== undefined && (
          <span className="explica__ojo">
            <strong>Ojo:</strong> {entry.ojo}
          </span>
        )}
      </span>
    </span>
  );
}

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
  explica,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  /** termino del glosario que explica este cuadro al pasar el raton por su «?» */
  explica?: GlossaryKey;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <label>
        {label}
        {explica !== undefined && <Explica termino={explica} />}
      </label>
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
