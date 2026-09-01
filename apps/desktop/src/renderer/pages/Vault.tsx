// pantalla de la boveda privada.
//
// Regla de la que depende todo lo demas: mientras la boveda esta cerrada, esta
// pantalla no muestra NADA de su contenido. Ni titulos, ni recuentos, ni "tu
// ultima conversacion fue el martes". No es que se oculte: es que el renderer
// no lo tiene, porque el proceso principal no puede descifrarlo sin la llave.
import { useEffect, useState, type JSX } from 'react';
import { Empty, Field, Notice, Panel, Readout, Skeleton, Tag } from '../ui/primitives.js';
import type { ConfigSummary } from '../useConfig.js';
import {
  formatAutoLockOption,
  formatLockCountdown,
  type VaultController,
} from '../useVault.js';

/** debe coincidir con AUTO_LOCK_MINUTES del proceso principal */
const AUTO_LOCK_CHOICES = [1, 5, 15, 30, 60, 240, 0] as const;

const MIN_PASSWORD_LENGTH = 10;

export function VaultPage({
  vault,
  summary,
}: {
  vault: VaultController;
  summary: ConfigSummary;
}): JSX.Element {
  if (vault.loading) return <Skeleton rows={4} />;
  if (vault.recoveryKey !== null) return <RecoveryKeyPanel vault={vault} />;
  if (!vault.status.configured) return <CreatePanel vault={vault} />;
  // con la boveda cerrada no se muestra NADA de su contenido: ni la lista de
  // conversaciones, ni cuantas hay. El renderer ni siquiera las tiene.
  if (!vault.status.unlocked) return <UnlockPanel vault={vault} />;
  return (
    <>
      <ConversationPanel vault={vault} summary={summary} />
      <UnlockedPanel vault={vault} />
    </>
  );
}

// -----------------------------------------------------------------------------
// conversaciones privadas
// -----------------------------------------------------------------------------

function ConversationPanel({
  vault,
  summary,
}: {
  vault: VaultController;
  summary: ConfigSummary;
}): JSX.Element {
  const [message, setMessage] = useState('');
  const projects = Object.keys(summary.config?.projects ?? {});
  const [project, setProject] = useState(projects[0] ?? '');
  const providers = ['claude', 'codex', ...(summary.config?.providers.http ?? []).map((p) => p.id)];
  const [provider, setProvider] = useState(providers[0] ?? 'claude');

  const canSend =
    message.trim().length > 0 && project.length > 0 && provider.length > 0 && !vault.sending;

  const submit = (): void => {
    void vault.send({ message: message.trim(), provider, model: null, projectAlias: project }).then(
      () => setMessage(''),
    );
  };

  return (
    <Panel
      title="Conversación privada"
      actions={
        vault.openConversationId !== null && (
          <button className="btn btn--quiet" onClick={() => void vault.openConversation(null)}>
            Nueva
          </button>
        )
      }
    >
      {vault.conversations.length > 0 && (
        <div className="vault-list">
          {vault.conversations.map((conversation) => (
            <button
              key={conversation.conversationId}
              className="vault-list__item"
              aria-current={
                conversation.conversationId === vault.openConversationId ? 'true' : undefined
              }
              onClick={() => void vault.openConversation(conversation.conversationId)}
            >
              <span className="vault-list__title">{conversation.title}</span>
              <span className="vault-list__meta">{conversation.turns} turnos</span>
            </button>
          ))}
        </div>
      )}

      {vault.turns.length === 0 ? (
        <Empty title="Nada todavía">
          Escribe abajo para empezar. El mensaje se cifra en este equipo antes de
          guardarse, y la respuesta la genera el proveedor que elijas: él sí ve
          el texto que le envías.
        </Empty>
      ) : (
        <div className="vault-thread">
          {vault.turns.map((turn) => (
            <div key={turn.sequence} className={`vault-turn vault-turn--${turn.role}`}>
              <span className="vault-turn__who">
                {turn.role === 'user' ? 'Tú' : 'Respuesta'}
              </span>
              <p className="vault-turn__text">{turn.text}</p>
            </div>
          ))}
        </div>
      )}

      {vault.media.length > 0 && <MediaStrip vault={vault} />}

      <GeneratePanel vault={vault} />

      {vault.error !== null && <Notice tone="fault">{vault.error}</Notice>}

      {projects.length === 0 ? (
        <Notice tone="warn">
          No hay ningún proyecto configurado en esta máquina. Añade uno en
          Proyectos: el turno se ejecuta dentro de uno, en solo lectura.
        </Notice>
      ) : (
        <>
          <div className="row">
            <Field label="Proveedor">
              <select value={provider} onChange={(event) => setProvider(event.target.value)}>
                {providers.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Proyecto">
              <select value={project} onChange={(event) => setProject(event.target.value)}>
                {projects.map((alias) => (
                  <option key={alias} value={alias}>
                    {alias}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <textarea
            className="vault-composer"
            rows={3}
            value={message}
            placeholder="Escribe tu mensaje…"
            disabled={vault.sending}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canSend) submit();
            }}
          />
          <div className="row">
            <button className="btn btn--primary" disabled={!canSend} onClick={submit}>
              {vault.sending ? 'Esperando respuesta…' : 'Enviar'}
            </button>
            <button
              className="btn"
              disabled={vault.attaching || vault.openConversationId === null}
              onClick={() => void vault.attachMedia()}
              title={
                vault.openConversationId === null
                  ? 'Envía un mensaje primero para crear la conversación'
                  : undefined
              }
            >
              {vault.attaching ? 'Cifrando…' : 'Adjuntar'}
            </button>
            {vault.openConversationId !== null && (
              <button
                className="btn btn--danger"
                disabled={vault.sending}
                onClick={() => void vault.removeConversation(vault.openConversationId!)}
              >
                Borrar conversación
              </button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

/**
 * generacion de imagen y video.
 *
 * El personaje es obligatorio porque el proveedor lo exige para generar: es lo
 * que mantiene la misma apariencia entre generaciones. Se crea una vez y se
 * reutiliza; su identificador vive en el proveedor, no aqui.
 */
function GeneratePanel({ vault }: { vault: VaultController }): JSX.Element {
  const [characterId, setCharacterId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [creating, setCreating] = useState(false);

  const disabled = vault.openConversationId === null;
  const canGenerate =
    !disabled && characterId.trim().length > 0 && prompt.trim().length > 0 && !vault.generating;

  return (
    <details className="vault-generate">
      <summary>Generar imagen o vídeo</summary>

      {disabled && (
        <Notice tone="idle">
          Envía un mensaje primero: lo generado se guarda dentro de una
          conversación.
        </Notice>
      )}

      <Field
        label="Personaje"
        hint="El proveedor exige uno; es lo que mantiene la misma apariencia entre generaciones."
      >
        <input
          value={characterId}
          placeholder="identificador del personaje"
          onChange={(event) => setCharacterId(event.target.value)}
        />
      </Field>

      <div className="row">
        <button
          className="btn btn--quiet"
          disabled={creating}
          onClick={() => {
            setCreating(true);
            void vault
              .createCharacter({})
              .then((id) => {
                if (id !== null) setCharacterId(id);
              })
              .finally(() => setCreating(false));
          }}
        >
          {creating ? 'Creando…' : 'Crear personaje nuevo'}
        </button>
      </div>

      <Field label="Descripción">
        <textarea
          rows={2}
          value={prompt}
          disabled={vault.generating}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </Field>

      <div className="row">
        <select value={kind} onChange={(event) => setKind(event.target.value as 'image' | 'video')}>
          <option value="image">Imagen</option>
          <option value="video">Vídeo</option>
        </select>
        <button
          className="btn btn--primary"
          disabled={!canGenerate}
          onClick={() => {
            void vault
              .generateMedia({ characterId: characterId.trim(), prompt: prompt.trim(), kind })
              .then((ok) => {
                if (ok) setPrompt('');
              });
          }}
        >
          {vault.generating ? 'Generando…' : 'Generar'}
        </button>
      </div>

      {vault.generating && (
        <p className="field__hint">
          Un vídeo puede tardar minutos. Luxy pregunta al proveedor cada pocos
          segundos hasta que termina.
        </p>
      )}

      {vault.lastCost !== null && (
        <p className="field__hint">Última generación: {vault.lastCost} créditos.</p>
      )}

      <p className="field__hint">
        El resultado se descarga y se cifra antes de tocar el disco. Lo que
        escribas aquí lo recibe el proveedor: la bóveda protege lo que Luxy
        guarda, no lo que un tercero ve porque se lo envías.
      </p>
    </details>
  );
}

/**
 * medios de la conversacion.
 *
 * Cada elemento se descifra al pedirlo y NO se guarda en el estado: mantener
 * imagenes descifradas en memoria del renderer las dejaria vivas despues de
 * cerrar la boveda, que es justo lo contrario de lo que hace cerrarla.
 */
function MediaStrip({ vault }: { vault: VaultController }): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="vault-media">
      {vault.media.map((item) => (
        <MediaTile
          key={item.mediaId}
          item={item}
          open={openId === item.mediaId}
          onToggle={() => setOpenId(openId === item.mediaId ? null : item.mediaId)}
          vault={vault}
        />
      ))}
    </div>
  );
}

function MediaTile({
  item,
  open,
  onToggle,
  vault,
}: {
  item: VaultController['media'][number];
  open: boolean;
  onToggle: () => void;
  vault: VaultController;
}): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);

  useEffect(() => {
    if (!open) {
      // al cerrar se suelta la copia descifrada en vez de dejarla en memoria
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    void vault.openMedia(item.mediaId).then((url) => {
      if (cancelled) return;
      if (url === null) setTooBig(true);
      else setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [open, item.mediaId, vault]);

  const isVideo = item.mimeType.startsWith('video/');

  return (
    <div className="vault-media__item">
      <button className="btn btn--quiet" onClick={onToggle}>
        {open ? 'Ocultar' : 'Ver'} · {item.displayName ?? item.mediaId.slice(0, 8)}
      </button>

      {open && tooBig && (
        <Notice tone="warn">
          Demasiado grande para previsualizarlo todavía. El archivo está guardado
          y cifrado; falta la parte que reproduce vídeo sin descifrarlo entero en
          memoria.
        </Notice>
      )}

      {open && dataUrl !== null && !isVideo && (
        <img className="vault-media__preview" src={dataUrl} alt="" />
      )}
      {open && dataUrl !== null && isVideo && (
        <video className="vault-media__preview" src={dataUrl} controls />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// crear
// -----------------------------------------------------------------------------

function CreatePanel({ vault }: { vault: VaultController }): JSX.Element {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat.length > 0 && password !== repeat;
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH && password === repeat && !vault.busy;

  return (
    <Panel title="Crear la bóveda">
      <p className="vault-prose">
        La bóveda cifra su contenido con una llave que sólo existe en este equipo
        mientras está abierta. Ni el servidor ni Luxy pueden leerla.
      </p>
      <Notice tone="warn">
        Si olvidas la contraseña y pierdes la clave de recuperación, el contenido
        no se puede recuperar. Nadie puede restablecerla: eso es justo lo que
        hace que nadie más pueda abrirla.
      </Notice>

      <Field
        label="Contraseña"
        hint={`Al menos ${MIN_PASSWORD_LENGTH} caracteres. Una frase de varias palabras es más fácil de recordar y más difícil de adivinar.`}
        error={tooShort ? `Todavía faltan ${MIN_PASSWORD_LENGTH - password.length} caracteres` : null}
      >
        <input
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Field label="Repite la contraseña" error={mismatch ? 'No coinciden' : null}>
        <input
          type="password"
          value={repeat}
          autoComplete="new-password"
          onChange={(event) => setRepeat(event.target.value)}
        />
      </Field>

      {vault.error !== null && <Notice tone="fault">{vault.error}</Notice>}

      <div className="row">
        <button
          className="btn btn--primary"
          disabled={!canSubmit}
          onClick={() => {
            void vault.create(password).then((ok) => {
              if (ok) {
                setPassword('');
                setRepeat('');
              }
            });
          }}
        >
          {vault.busy ? 'Creando…' : 'Crear bóveda'}
        </button>
      </div>
      <p className="field__hint">
        Crear la bóveda tarda unos segundos a propósito: ese tiempo es lo que
        encarece adivinar la contraseña a quien se lleve el archivo.
      </p>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// clave de recuperacion
// -----------------------------------------------------------------------------

function RecoveryKeyPanel({ vault }: { vault: VaultController }): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Panel title="Guarda tu clave de recuperación">
      <Notice tone="warn">
        Esto se muestra <strong>una sola vez</strong>. No se guarda en ningún
        sitio: si no la copias ahora, deja de existir.
      </Notice>

      <pre className="mono vault-key">{vault.recoveryKey}</pre>

      <p className="vault-prose">
        Es la única forma de abrir la bóveda si olvidas la contraseña. Guárdala
        fuera de este ordenador: en papel, o en un gestor de contraseñas.
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        La he guardado en un sitio seguro
      </label>

      <div className="row">
        <button
          className="btn btn--primary"
          disabled={!confirmed}
          onClick={() => vault.acknowledgeRecoveryKey()}
        >
          Continuar
        </button>
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// abrir
// -----------------------------------------------------------------------------

function UnlockPanel({ vault }: { vault: VaultController }): JSX.Element {
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [secret, setSecret] = useState('');

  const submit = (): void => {
    void vault.unlock(mode, secret).then((ok) => {
      // la contraseña deja de estar en memoria del renderer en cuanto se usa
      if (ok) setSecret('');
    });
  };

  return (
    <Panel title="Bóveda cerrada">
      <p className="vault-prose">
        El contenido sigue en este equipo, pero está cifrado. Luxy tampoco puede
        leerlo hasta que la abras.
      </p>

      {vault.hint !== null && <Notice tone="idle">{vault.hint}</Notice>}

      {vault.status.methods.device && (
        <div className="row">
          <button
            className="btn"
            disabled={vault.busy}
            onClick={() => void vault.unlock('device')}
          >
            Abrir con esta cuenta de Windows
          </button>
        </div>
      )}

      <Field
        label={mode === 'password' ? 'Contraseña' : 'Clave de recuperación'}
        hint={
          mode === 'recovery'
            ? 'Ocho grupos de cuatro caracteres. Da igual mayúsculas, guiones o espacios.'
            : undefined
        }
      >
        <input
          type={mode === 'password' ? 'password' : 'text'}
          value={secret}
          autoComplete={mode === 'password' ? 'current-password' : 'off'}
          onChange={(event) => setSecret(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && secret.length > 0 && !vault.busy) submit();
          }}
        />
      </Field>

      {vault.error !== null && <Notice tone="fault">{vault.error}</Notice>}

      <div className="row">
        <button
          className="btn btn--primary"
          disabled={secret.length === 0 || vault.busy}
          onClick={submit}
        >
          {vault.busy ? 'Abriendo…' : 'Abrir'}
        </button>
        {vault.status.methods.recovery && (
          <button
            className="btn btn--quiet"
            onClick={() => {
              setMode(mode === 'password' ? 'recovery' : 'password');
              setSecret('');
              vault.clearError();
            }}
          >
            {mode === 'password' ? 'Usar clave de recuperación' : 'Usar contraseña'}
          </button>
        )}
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// abierta
// -----------------------------------------------------------------------------

function UnlockedPanel({ vault }: { vault: VaultController }): JSX.Element {
  const [changing, setChanging] = useState(false);
  const countdown = formatLockCountdown(vault.status.lockingInMs);

  return (
    <>
      <Panel
        title="Bóveda abierta"
        actions={
          <button className="btn" disabled={vault.busy} onClick={() => void vault.lock()}>
            Cerrar ahora
          </button>
        }
      >
        <Readout
          items={[
            { label: 'Estado', value: <Tag tone="ok">abierta</Tag> },
            {
              label: 'Bloqueo automático',
              value:
                vault.status.autoLockMinutes === 0
                  ? 'desactivado'
                  : (countdown ?? formatAutoLockOption(vault.status.autoLockMinutes)),
            },
            {
              label: 'Desbloqueo rápido',
              value: vault.status.methods.device ? (
                <Tag tone="ok">activado</Tag>
              ) : (
                <Tag tone="idle">desactivado</Tag>
              ),
            },
          ]}
        />

        {vault.hint !== null && <Notice tone="ok">{vault.hint}</Notice>}
        {vault.error !== null && <Notice tone="fault">{vault.error}</Notice>}

        <p className="vault-prose">
          Todavía no hay conversaciones privadas: falta conectar la bóveda con
          Conversaciones. Lo que ya funciona es crearla, abrirla y cerrarla.
        </p>
      </Panel>

      <Panel title="Ajustes de la bóveda">
        <Field
          label="Cerrar la bóveda sola"
          hint="Se cuenta desde la última vez que se usó la bóveda, no desde el último clic en la ventana."
        >
          <select
            value={vault.status.autoLockMinutes}
            disabled={vault.busy}
            onChange={(event) => void vault.setAutoLock(Number(event.target.value))}
          >
            {AUTO_LOCK_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {formatAutoLockOption(minutes)}
              </option>
            ))}
          </select>
        </Field>

        {vault.status.autoLockMinutes === 0 && !vault.status.methods.device && (
          <Notice tone="warn">
            La bóveda quedará abierta hasta que la cierres a mano o salgas de
            Luxy. Cualquiera que use este ordenador mientras tanto verá su
            contenido.
          </Notice>
        )}

        <label className="check">
          <input
            type="checkbox"
            checked={vault.status.methods.device}
            disabled={vault.busy}
            onChange={(event) => void vault.setDeviceUnlock(event.target.checked)}
          />
          Recordar en este equipo
        </label>
        <p className="field__hint">
          Guarda la llave protegida por tu cuenta de Windows, para abrir sin
          escribir la contraseña. Protege frente a otra cuenta del equipo y
          frente a que alguien copie el archivo a otro ordenador. No protege
          frente a otro programa que corra con tu usuario.
        </p>

        {vault.status.methods.device && vault.status.autoLockMinutes !== 0 && (
          <Notice tone="warn">
            Con el desbloqueo rápido activado, cerrar la bóveda sola protege
            menos: volver a abrirla es un clic, sin escribir nada. Si lo que
            quieres es que nadie más pueda abrirla en este ordenador, desactiva
            el desbloqueo rápido.
          </Notice>
        )}

        {changing ? (
          <ChangePasswordForm vault={vault} onDone={() => setChanging(false)} />
        ) : (
          <div className="row">
            <button className="btn btn--quiet" onClick={() => setChanging(true)}>
              Cambiar la contraseña
            </button>
          </div>
        )}
      </Panel>
    </>
  );
}

function ChangePasswordForm({
  vault,
  onDone,
}: {
  vault: VaultController;
  onDone: () => void;
}): JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  return (
    <>
      <Field
        label="Contraseña actual"
        hint="Se pide aunque la bóveda esté abierta: tenerla abierta no demuestra que la conoces."
      >
        <input
          type="password"
          value={current}
          autoComplete="current-password"
          onChange={(event) => setCurrent(event.target.value)}
        />
      </Field>
      <Field
        label="Contraseña nueva"
        hint="Cambiarla no vuelve a cifrar el contenido, así que es inmediato."
      >
        <input
          type="password"
          value={next}
          autoComplete="new-password"
          onChange={(event) => setNext(event.target.value)}
        />
      </Field>
      <div className="row">
        <button
          className="btn btn--primary"
          disabled={current.length === 0 || next.length < MIN_PASSWORD_LENGTH || vault.busy}
          onClick={() => {
            void vault.changePassword(current, next).then((ok) => {
              setCurrent('');
              setNext('');
              if (ok) onDone();
            });
          }}
        >
          Cambiar
        </button>
        <button
          className="btn btn--quiet"
          onClick={() => {
            setCurrent('');
            setNext('');
            onDone();
          }}
        >
          Cancelar
        </button>
      </div>
    </>
  );
}
