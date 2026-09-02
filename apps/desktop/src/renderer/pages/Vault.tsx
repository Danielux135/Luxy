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

/** ocho grupos de cuatro, sin los separadores. Debe coincidir con vault-crypto */
const RECOVERY_KEY_LENGTH = 32;

export function VaultPage({
  vault,
  summary,
}: {
  vault: VaultController;
  summary: ConfigSummary;
}): JSX.Element {
  if (vault.loading) return <Skeleton rows={4} />;
  if (vault.recoveryKey !== null) return <RecoveryKeyPanel vault={vault} />;
  // sin bóveda en este equipo la puerta es la cuenta, no la contraseña: es lo
  // que hace que un ordenador nuevo funcione sabiendo sólo la contraseña
  if (!vault.status.configured) return <AccountPanel vault={vault} />;
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
  // `null` mientras no se edite: enviar sin tocarlas conserva las guardadas
  const [draftInstructions, setDraftInstructions] = useState<string | null>(null);
  const [draftCharacter, setDraftCharacter] = useState<string | null>(null);
  const projects = Object.keys(summary.config?.projects ?? {});
  const [project, setProject] = useState(projects[0] ?? '');
  const providers = ['claude', 'codex', ...(summary.config?.providers.http ?? []).map((p) => p.id)];
  const [provider, setProvider] = useState(providers[0] ?? 'claude');

  const canSend =
    message.trim().length > 0 && project.length > 0 && provider.length > 0 && !vault.sending;

  const submit = (): void => {
    void vault
      .send({
        message: message.trim(),
        provider,
        model: null,
        projectAlias: project,
        instructions: draftInstructions,
        characterId: draftCharacter,
      })
      .then(() => {
        setMessage('');
        // ya están guardados con el turno: los borradores dejan de ser
        // necesarios y el panel vuelve a leer lo que hay de verdad
        setDraftInstructions(null);
        setDraftCharacter(null);
      });
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

      {vault.lastImage !== null && <ImageOutcome image={vault.lastImage} />}

      <InstructionsPanel
        vault={vault}
        draft={draftInstructions}
        onChange={setDraftInstructions}
        draftCharacter={draftCharacter}
        onCharacterChange={setDraftCharacter}
      />

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
 * clave del proveedor de imagenes.
 *
 * Vive aqui y no en Conexiones a proposito. Conexiones gestiona las pasarelas
 * de texto, y su formulario **rechaza** este nombre: es un secreto reservado,
 * precisamente para que nadie pueda apropiarselo declarando un proveedor con
 * ese `apiKeyEnv`. Ponerlo aqui, en la seccion que lo usa, evita esa colision y
 * ademas lo deja donde el usuario lo va a buscar.
 *
 * La clave cruza el IPC en una sola direccion —el usuario la escribe en esta
 * ventana— y no vuelve nunca: lo unico que sale del main es si hay una guardada.
 */
function MediaKeyPanel({ vault }: { vault: VaultController }): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const configured = vault.status.mediaProviderConfigured;

  return (
    <Panel
      title="Proveedor de imágenes"
      actions={configured ? <Tag tone="ok">clave guardada</Tag> : <Tag tone="idle">sin clave</Tag>}
    >
      <p className="vault-prose">
        Sin clave, Luxy no ofrece generar imágenes: ni en el panel de abajo ni
        dentro de una conversación. Se guarda cifrada con tu cuenta de Windows y
        no vuelve a mostrarse.
      </p>

      <Field
        label={configured ? 'Sustituir la clave' : 'Clave del proveedor'}
        hint="Se envía sólo al proveedor de imágenes. Ni el gateway ni Supabase la ven."
      >
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder={configured ? 'Introduce una nueva para sustituirla' : 'Pega la clave'}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </Field>

      <div className="row">
        <button
          className="btn btn--primary"
          disabled={apiKey.length === 0 || vault.busy}
          onClick={() => {
            void vault.setMediaKey(apiKey).then(() => setApiKey(''));
          }}
        >
          Guardar clave
        </button>
        {configured && (
          <button
            className="btn btn--danger"
            disabled={vault.busy}
            onClick={() => void vault.deleteMediaKey()}
          >
            Borrar
          </button>
        )}
      </div>
    </Panel>
  );
}

/**
 * convierte «clave: valor» por linea en el mapa que espera el proveedor.
 *
 * Es deliberadamente tonto: sin claves, sin valores vacios y sin lineas que no
 * lleven dos puntos. Lo que no encaja se ignora en vez de inventarse una clave,
 * porque un rasgo mal formado viajaria al proveedor tal cual.
 */
export function parseTraits(text: string): Record<string, string> {
  const traits: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().slice(0, 64);
    const value = line.slice(separator + 1).trim().slice(0, 120);
    if (key.length === 0 || value.length === 0) continue;
    traits[key] = value;
  }
  return traits;
}

/**
 * instrucciones fijas de la conversacion.
 *
 * Acompañan a cada turno sin que haya que rescribirlas, y sin depender de que
 * sobrevivan a la memoria acumulativa, que resume y por tanto pierde matices a
 * proposito. Se guardan cifradas con el turno, asi que el historial conserva
 * cuales regian cada respuesta.
 *
 * `draft === null` significa «no las he tocado»: al enviar se conservan las
 * guardadas. Vaciarlas y enviar SI las borra, que es la unica forma de volver
 * atras una vez puestas.
 */
function ImageOutcome({
  image,
}: {
  image: NonNullable<VaultController['lastImage']>;
}): JSX.Element {
  if (image.error !== null) {
    return (
      <Notice tone="fault">
        Se pidió una imagen y no pudo generarse: {image.error}. La respuesta de
        texto sí se ha guardado.
      </Notice>
    );
  }
  return (
    <Notice tone="ok">
      Imagen generada y cifrada en esta conversación
      {image.costCredits !== null && ` · ${image.costCredits} créditos`}. Aparece
      abajo, con el resto de archivos.
    </Notice>
  );
}

function InstructionsPanel({
  vault,
  draft,
  onChange,
  draftCharacter,
  onCharacterChange,
}: {
  vault: VaultController;
  draft: string | null;
  onChange: (value: string | null) => void;
  draftCharacter: string | null;
  onCharacterChange: (value: string | null) => void;
}): JSX.Element {
  const saved = vault.instructions ?? '';
  const value = draft ?? saved;
  const pending = draft !== null && draft !== saved;
  const savedCharacter = vault.characterId ?? '';
  const characterValue = draftCharacter ?? savedCharacter;

  return (
    <details className="vault-generate" open={saved.length > 0}>
      <summary>
        Instrucciones de la conversación
        {saved.length > 0 && !pending && ' · activas'}
        {pending && ' · se aplicarán al enviar'}
      </summary>

      <Field
        label="Contexto fijo"
        hint="Acompaña a cada mensaje de esta conversación. No hace falta repetirlo, y se guarda cifrado como el resto."
      >
        <textarea
          rows={4}
          value={value}
          placeholder="Cómo quieres que responda, qué debe tener en cuenta, qué evitar…"
          disabled={vault.sending}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>

      {pending && (
        <p className="field__hint">
          Se guardan con el próximo mensaje que envíes; no hay un botón aparte
          porque no hacen nada por sí solas.
        </p>
      )}
      {pending && value.length === 0 && (
        <Notice tone="warn">
          Al enviar vacías se borran las que había. Los turnos anteriores
          conservan las suyas: lo que cambia es de aquí en adelante.
        </Notice>
      )}

      <Field
        label="Personaje de esta conversación"
        hint="Con uno puesto, puedes pedir imágenes dentro de la conversación y se generan solas. Sin él, no se ofrece."
      >
        <input
          value={characterValue}
          placeholder="identificador del personaje"
          disabled={vault.sending}
          onChange={(event) => onCharacterChange(event.target.value)}
        />
      </Field>
      {savedCharacter.length === 0 && characterValue.length === 0 && (
        <p className="field__hint">
          Créalo abajo, en «Generar imagen o vídeo», y pégalo aquí. Se guarda con
          la conversación: no hay que repetirlo en cada mensaje.
        </p>
      )}
    </details>
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
  const [traits, setTraits] = useState('');
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

      {!vault.status.mediaProviderConfigured && (
        <Notice tone="warn">
          Falta la clave del proveedor de imágenes. Está más abajo, en
          «Proveedor de imágenes»: sin ella no se puede generar nada, ni aquí ni
          desde la conversación.
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

      <Field
        label="Rasgos del personaje nuevo"
        hint="Uno por línea, con dos puntos: pelo: castaño. Se envían sólo al crearlo; sin rasgos, el proveedor elige por ti."
      >
        <textarea
          rows={3}
          value={traits}
          placeholder={'pelo: castaño\nojos: verdes\nedad: adulta'}
          disabled={creating}
          onChange={(event) => setTraits(event.target.value)}
        />
      </Field>

      <div className="row">
        <button
          className="btn btn--quiet"
          disabled={creating}
          onClick={() => {
            setCreating(true);
            void vault
              .createCharacter(parseTraits(traits))
              .then((id) => {
                if (id !== null) setCharacterId(id);
              })
              .finally(() => setCreating(false));
          }}
        >
          {creating ? 'Creando…' : 'Crear personaje nuevo'}
        </button>
      </div>
      <p className="field__hint">
        El identificador vive en el proveedor, no aquí: guárdalo si quieres
        reutilizar el mismo personaje en otra conversación.
      </p>

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
// cuenta
// -----------------------------------------------------------------------------

/**
 * puerta de entrada cuando este equipo todavia no tiene boveda.
 *
 * Crear la cuenta y entrar son la MISMA llave maestra vista desde dos sitios:
 * al crearla nace aquí y el servidor guarda una copia envuelta que no puede
 * abrir; al entrar, esa copia vuelve y la abre la contraseña. Por eso un equipo
 * nuevo necesita sólo el correo y la contraseña, y por eso nadie más —tampoco
 * el servidor— puede abrir lo que se guarda.
 */
function AccountPanel({ vault }: { vault: VaultController }): JSX.Element {
  const [mode, setMode] = useState<'register' | 'login' | 'recovery' | 'local'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');

  if (mode === 'local') {
    return <CreatePanel vault={vault} onUseAccount={() => setMode('register')} />;
  }

  const registering = mode === 'register';
  const recovering = mode === 'recovery';
  // la clave de recuperación no es una contraseña y no se mide igual: son ocho
  // grupos de cuatro, y se acepta escrita de forma descuidada
  const minimum = recovering ? RECOVERY_KEY_LENGTH : MIN_PASSWORD_LENGTH;
  const typed = recovering ? password.replace(/[^A-Za-z0-9]/g, '') : password;
  const tooShort = typed.length > 0 && typed.length < minimum;
  const mismatch = registering && repeat.length > 0 && password !== repeat;
  const canSubmit =
    email.includes('@') &&
    typed.length >= minimum &&
    (!registering || password === repeat) &&
    !vault.busy;

  const submit = (): void => {
    const action = registering
      ? vault.registerAccount(email.trim(), password)
      : vault.loginAccount(email.trim(), password, recovering ? 'recovery' : 'password');
    // el secreto deja de estar en memoria del renderer en cuanto se usa
    void action.then(() => {
      setPassword('');
      setRepeat('');
    });
  };

  const title = registering
    ? 'Crear tu cuenta privada'
    : recovering
      ? 'Entrar con tu clave de recuperación'
      : 'Entrar en tu cuenta';

  return (
    <Panel
      title={title}
      actions={
        <button
          className="btn btn--quiet"
          onClick={() => {
            setMode(registering ? 'login' : 'register');
            setPassword('');
            setRepeat('');
            vault.clearError();
          }}
        >
          {registering ? 'Ya tengo cuenta' : 'Crear una cuenta'}
        </button>
      }
    >
      <p className="vault-prose">
        {registering
          ? 'La llave que cifra tu contenido nace en este equipo. El servidor guarda una copia cerrada con tu contraseña, y por eso puede devolvértela sin poder abrirla: así entras desde otro ordenador sabiendo sólo la contraseña.'
          : recovering
            ? 'El servidor guarda una segunda copia de tu llave, cerrada con tu clave de recuperación. Es la que abre la bóveda cuando ya no recuerdas la contraseña, y funciona desde cualquier ordenador. Después podrás elegir una contraseña nueva.'
            : 'Tu contraseña no viaja. Lo que llega del servidor es tu llave cerrada, y se abre aquí. Si la contraseña es incorrecta no se abre nada, y el servidor ni se entera del intento.'}
      </p>

      {registering && (
        <Notice tone="warn">
          Si olvidas la contraseña y pierdes la clave de recuperación, el
          contenido no se puede recuperar. Nadie puede restablecerla —tampoco el
          servidor—: eso es justo lo que hace que nadie más pueda abrirla.
        </Notice>
      )}

      <Field label="Correo" hint="Sólo identifica tu cuenta. No se envía nada a esa dirección.">
        <input
          type="email"
          value={email}
          autoComplete="username"
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <Field
        label={recovering ? 'Clave de recuperación' : 'Contraseña'}
        hint={
          registering
            ? `Al menos ${MIN_PASSWORD_LENGTH} caracteres. Una frase de varias palabras es más fácil de recordar y más difícil de adivinar.`
            : recovering
              ? 'Ocho grupos de cuatro caracteres. Da igual mayúsculas, guiones o espacios.'
              : undefined
        }
        error={tooShort ? `Todavía faltan ${minimum - typed.length} caracteres` : null}
      >
        <input
          type={recovering ? 'text' : 'password'}
          value={password}
          autoComplete={registering ? 'new-password' : recovering ? 'off' : 'current-password'}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit) submit();
          }}
        />
      </Field>

      {registering && (
        <Field label="Repite la contraseña" error={mismatch ? 'No coinciden' : null}>
          <input
            type="password"
            value={repeat}
            autoComplete="new-password"
            onChange={(event) => setRepeat(event.target.value)}
          />
        </Field>
      )}

      {vault.error !== null && <Notice tone="fault">{vault.error}</Notice>}
      {vault.hint !== null && <Notice tone="idle">{vault.hint}</Notice>}

      <div className="row">
        <button className="btn btn--primary" disabled={!canSubmit} onClick={submit}>
          {vault.busy
            ? registering
              ? 'Creando cuenta…'
              : 'Entrando…'
            : registering
              ? 'Crear cuenta'
              : 'Entrar'}
        </button>
        {!registering && (
          <button
            className="btn btn--quiet"
            onClick={() => {
              setMode(recovering ? 'login' : 'recovery');
              setPassword('');
              vault.clearError();
            }}
          >
            {recovering ? 'Usar contraseña' : 'He olvidado la contraseña'}
          </button>
        )}
        <button className="btn btn--quiet" onClick={() => setMode('local')}>
          Usar sólo en este equipo
        </button>
      </div>
      <p className="field__hint">
        {registering
          ? 'Tarda unos segundos a propósito: ese tiempo es lo que encarece adivinar la contraseña a quien se lleve una copia.'
          : recovering
            ? 'Esta puerta es inmediata: una clave de recuperación son treinta y dos caracteres al azar, y encarecer cada intento no protege de nada cuando no hay nada que adivinar.'
            : 'Tarda unos segundos: la llave se abre aquí, y ese coste es el mismo que protege tu contraseña.'}
      </p>
      <p className="field__hint">
        Sin cuenta la bóveda funciona igual, pero sólo en este ordenador: no se
        sincroniza y no se puede abrir desde otro. Podrás vincularla después sin
        volver a cifrar nada.
      </p>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// crear
// -----------------------------------------------------------------------------

function CreatePanel({
  vault,
  onUseAccount,
}: {
  vault: VaultController;
  onUseAccount: () => void;
}): JSX.Element {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat.length > 0 && password !== repeat;
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH && password === repeat && !vault.busy;

  return (
    <Panel
      title="Crear la bóveda sólo en este equipo"
      actions={
        <button className="btn btn--quiet" onClick={onUseAccount}>
          Usar una cuenta
        </button>
      }
    >
      <p className="vault-prose">
        La bóveda cifra su contenido con una llave que sólo existe en este equipo
        mientras está abierta. Ni el servidor ni Luxy pueden leerla. Sin cuenta
        esa llave no sale de aquí: no hay sincronización, y desde otro ordenador
        no se puede abrir.
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

      {vault.status.account.email !== null && (
        <Notice tone="idle">
          Abre tu bóveda <strong>desde cualquier ordenador</strong>, no sólo
          desde éste: el servidor guarda una segunda copia de tu llave cerrada
          con esta clave, y tampoco puede abrirla. Es la única forma de entrar
          si olvidas la contraseña.
        </Notice>
      )}

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
  // tras entrar con la clave de recuperación, este equipo NO tiene envoltura de
  // contraseña: no se conoce. Ofrecer ese campo primero sería ofrecer lo único
  // que aquí no funciona.
  const [mode, setMode] = useState<'password' | 'recovery'>(
    vault.status.methods.password ? 'password' : 'recovery',
  );
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

      {vault.status.account.email !== null && (
        <p className="field__hint">
          Bóveda de <strong>{vault.status.account.email}</strong>. Se abre aquí
          sin conexión: la llave ya está en este equipo, cerrada con tu
          contraseña.
        </p>
      )}

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
  const byRecovery = vault.status.account.openedWithRecoveryKey;
  // quien acaba de recuperar su cuenta viene justamente a esto: el formulario
  // ya está abierto en vez de escondido detrás de un botón más
  const [changing, setChanging] = useState(byRecovery);
  const countdown = formatLockCountdown(vault.status.lockingInMs);

  return (
    <>
      <Panel
        title="Bóveda abierta"
        actions={
          <>
            <button
              className="btn btn--quiet"
              disabled={vault.syncing || vault.busy || !vault.status.account.signedIn}
              title={
                vault.status.account.signedIn
                  ? undefined
                  : 'Sincronizar necesita la sesión de tu cuenta'
              }
              onClick={() => void vault.sync()}
            >
              {vault.syncing ? 'Sincronizando…' : 'Sincronizar'}
            </button>
            <button className="btn" disabled={vault.busy} onClick={() => void vault.lock()}>
              Cerrar ahora
            </button>
          </>
        }
      >
        <Readout
          items={[
            { label: 'Estado', value: <Tag tone="ok">abierta</Tag> },
            {
              label: 'Cuenta',
              value:
                vault.status.account.email === null ? (
                  <Tag tone="idle">sólo en este equipo</Tag>
                ) : vault.status.account.signedIn ? (
                  vault.status.account.email
                ) : (
                  <Tag tone="warn">sesión caducada</Tag>
                ),
            },
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

        {vault.lastSync !== null && (
          <>
            <p className="field__hint">
              Última sincronización: {vault.lastSync.uploaded} turnos subidos,{' '}
              {vault.lastSync.downloaded} descargados; {vault.lastSync.mediaUploaded}{' '}
              archivos subidos, {vault.lastSync.mediaDownloaded} descargados. Lo
              que viaja va cifrado; el servidor no puede leerlo.
            </p>
            {vault.lastSync.mediaSkipped > 0 && (
              <Notice tone="warn">
                {vault.lastSync.mediaSkipped} archivo(s) son demasiado grandes
                para sincronizarlos y se quedan en el equipo donde se crearon.
                El resto sí ha viajado.
              </Notice>
            )}
          </>
        )}

      </Panel>

      <MediaKeyPanel vault={vault} />

      <AccountSection vault={vault} />

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

        {byRecovery && (
          <Notice tone="warn">
            Has entrado con tu clave de recuperación, así que este equipo no
            sabe tu contraseña: hasta que elijas una nueva, la bóveda sólo se
            vuelve a abrir aquí con la clave. Tu contenido está intacto.
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

/**
 * la cuenta, con la boveda ya abierta.
 *
 * Tres situaciones distintas, y cada una se arregla de otra forma:
 *
 *   - sin cuenta: la boveda vive solo aqui y se puede vincular sin recifrarla;
 *   - con cuenta y sesion: no hay nada que hacer, salvo salir;
 *   - con cuenta y sin sesion: lo local sigue funcionando, la sincronizacion no.
 */
function AccountSection({ vault }: { vault: VaultController }): JSX.Element {
  const [email, setEmail] = useState(vault.status.account.email ?? '');
  const [password, setPassword] = useState('');
  const linked = vault.status.account.email !== null;
  const canSubmit = email.includes('@') && password.length >= MIN_PASSWORD_LENGTH && !vault.busy;

  const submit = (): void => {
    const action = linked
      ? vault.loginAccount(email.trim(), password)
      : vault.linkAccount(email.trim(), password);
    void action.then(() => setPassword(''));
  };

  if (linked && vault.status.account.signedIn) {
    return (
      <Panel title="Tu cuenta">
        <p className="vault-prose">
          Esta bóveda pertenece a <strong>{vault.status.account.email}</strong>.
          Lo que sincronizas viaja cifrado y el servidor no puede leerlo: sólo
          sabe cuántos registros hay y de quién son.
        </p>
        <div className="row">
          <button
            className="btn"
            disabled={vault.busy}
            onClick={() => void vault.logoutAccount()}
          >
            Cerrar sesión
          </button>
        </div>
        <p className="field__hint">
          Cerrar sesión también cierra la bóveda. Lo cifrado se queda en este
          ordenador y se vuelve a abrir con la misma contraseña.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={linked ? 'Vuelve a entrar en tu cuenta' : 'Vincular a una cuenta'}>
      <p className="vault-prose">
        {linked
          ? 'Tu sesión ha caducado. La bóveda sigue abriéndose aquí sin conexión; lo que no funciona hasta que entres es sincronizar con tus otros equipos.'
          : 'Esta bóveda sólo existe en este ordenador. Vincularla sube tu llave cerrada con tu contraseña, sin volver a cifrar nada de lo que ya hay: a partir de ahí podrás abrirla desde otro equipo y sincronizar.'}
      </p>

      <Field label="Correo">
        <input
          type="email"
          value={email}
          autoComplete="username"
          readOnly={linked}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <Field
        label="Contraseña"
        hint={linked ? undefined : 'La misma con la que abres esta bóveda.'}
      >
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit) submit();
          }}
        />
      </Field>

      <div className="row">
        <button className="btn btn--primary" disabled={!canSubmit} onClick={submit}>
          {vault.busy ? 'Un momento…' : linked ? 'Entrar' : 'Vincular'}
        </button>
      </div>
    </Panel>
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
  // quien entró con la clave de recuperación no sabe la contraseña actual: eso
  // es justo lo que venía a arreglar. Su prueba de «lo que ya sabes» es la
  // clave con la que acaba de entrar.
  const byRecovery = vault.status.account.openedWithRecoveryKey;

  return (
    <>
      <Field
        label={byRecovery ? 'Tu clave de recuperación' : 'Contraseña actual'}
        hint={
          byRecovery
            ? 'La misma con la que acabas de entrar. Seguirá valiendo después del cambio.'
            : 'Se pide aunque la bóveda esté abierta: tenerla abierta no demuestra que la conoces.'
        }
      >
        <input
          type={byRecovery ? 'text' : 'password'}
          value={current}
          autoComplete={byRecovery ? 'off' : 'current-password'}
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
