// pantalla de la boveda privada.
//
// Regla de la que depende todo lo demas: mientras la boveda esta cerrada, esta
// pantalla no muestra NADA de su contenido. Ni titulos, ni recuentos, ni "tu
// ultima conversacion fue el martes". No es que se oculte: es que el renderer
// no lo tiene, porque el proceso principal no puede descifrarlo sin la llave.
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Empty, Explica, Field, Notice, Panel, Readout, Skeleton, Tag } from '../ui/primitives.js';
import {
  describeWhen,
  groupConversationsByCharacter,
} from '../vault-conversation-groups.js';
import type { ConfigSummary } from '../useConfig.js';
import {
  formatAutoLockOption,
  formatLockCountdown,
  type VaultCharacterView,
  type VaultController,
} from '../useVault.js';
import { imageBlockReason } from '../../shared/vault-image-capability.js';
import {
  NATIVE_MODEL_SUGGESTIONS,
  modelForProvider,
  modelsForProvider,
} from '../../shared/model-selection.js';
import {
  HORDE_ANIME_MODELS,
  HORDE_REALISTIC_MODELS,
  describeConversationMemoryStatus,
  describeHordeCharacter,
  hordeRecipeSchema,
  recipeDefaultsFor,
  type HordeBaseline,
  type HordeLora,
  type HordeRecipe,
  type ModelDefinition,
} from '@luxy/shared';

/** debe coincidir con AUTO_LOCK_MINUTES del proceso principal */
const AUTO_LOCK_CHOICES = [1, 5, 15, 30, 60, 240, 0] as const;

const MIN_PASSWORD_LENGTH = 10;

/** ocho grupos de cuatro, sin los separadores. Debe coincidir con vault-crypto */
const RECOVERY_KEY_LENGTH = 32;

export function VaultPage({
  vault,
  summary,
  providers,
  models,
}: {
  vault: VaultController;
  summary: ConfigSummary;
  /** catalogo real de la conexion; se filtra por familia = proveedor */
  models: ModelDefinition[];
  /**
   * proveedores que el agente tiene EN MARCHA, tal y como los anuncia.
   *
   * No se deducen de la configuracion: una conexion registra un proveedor por
   * familia de modelos, asi que mirar solo `providers.http` dejaba fuera todo
   * lo que sirve una pasarela —que es justo lo que estaba pasando—.
   */
  providers: string[];
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
      <ConversationPanel
        vault={vault}
        summary={summary}
        providers={providers}
        models={models}
      />
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
  providers,
  models,
}: {
  vault: VaultController;
  summary: ConfigSummary;
  providers: string[];
  models: ModelDefinition[];
}): JSX.Element {
  const projects = Object.keys(summary.config?.projects ?? {});
  // el compositor vive en el controlador, no aquí: esta página se desmonta al
  // cambiar de pestaña y con ella se perdía el proveedor elegido y todo lo
  // escrito sin enviar
  const { composer } = vault;
  const { message, instructions: draftInstructions, characterId: draftCharacter } = composer;
  const draftDescription = composer.characterDescription;
  // `null` significa «no ha elegido»: entonces vale el primero de la lista,
  // pero una elección suya se conserva aunque la lista cambie de orden
  const project = composer.project ?? projects[0] ?? '';
  const provider = composer.provider ?? providers[0] ?? 'claude';
  // el id de proveedor ES la familia del modelo: asi los registra el agente
  const familyModels = modelsForProvider(models, provider) as ModelDefinition[];
  // cadena vacia = «el de la conexion». Es lo que hacia siempre, y ahora es una
  // eleccion visible en vez de la unica posibilidad.
  //
  // Y se comprueba que pertenezca a ESTA familia: el modelo se recuerda por
  // conversacion y viaja al cambiar de proveedor, asi que uno guardado puede no
  // existir para el proveedor actual. Mandarlo gasta la llamada y devuelve
  // `unrecognized_model`
  const model = modelForProvider(models, provider, composer.model) ?? '';

  const canSend =
    message.trim().length > 0 && project.length > 0 && provider.length > 0 && !vault.sending;

  const submit = (): void => {
    void vault
      .send({
        message: message.trim(),
        provider,
        model: model.length === 0 ? null : model,
        projectAlias: project,
        instructions: draftInstructions,
        characterId: draftCharacter,
        characterDescription: draftDescription,
      })
      .then((kept) => {
        // solo si el turno llegó a existir. Si el modelo no contestó, el
        // mensaje vuelve al compositor y limpiarlo aquí lo perdería
        if (!kept) return;
        // ya están guardados con el turno: los borradores dejan de ser
        // necesarios y el panel vuelve a leer lo que hay de verdad
        vault.setComposer({
          message: '',
          instructions: null,
          characterId: null,
          characterDescription: null,
        });
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
      {vault.conversations.length > 0 && <ConversationList vault={vault} />}

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

      {vault.media.length > 0 && (
        <MediaGallery vault={vault} provider={provider} model={model} project={project} />
      )}

      {vault.lastImage !== null && <ImageOutcome image={vault.lastImage} />}

      {vault.lastMemoryStatus !== null && vault.lastMemoryStatus !== 'structured' && (
        <Notice tone="warn">
          {/* la frase de `describeConversationMemoryStatus` ya termina en «se
              conserva la anterior»: repetirlo aqui la duplicaba en pantalla */}
          {describeConversationMemoryStatus(vault.lastMemoryStatus)} La conversación
          sigue igual; pero si se repite, ese modelo no está escribiendo bien el
          bloque de memoria.
        </Notice>
      )}

      <InstructionsPanel
        vault={vault}
        draft={draftInstructions}
        onChange={(value) => vault.setComposer({ instructions: value })}
        draftCharacter={draftCharacter}
        onCharacterChange={(value) => vault.setComposer({ characterId: value })}
      />

      <GeneratePanel
        vault={vault}
        activeCharacterId={draftCharacter ?? vault.characterId}
        onCharacterReady={(id, description) => {
          // se adopta directamente: copiar un uuid a mano entre dos campos de
          // la misma pantalla era un paso que no aportaba nada
          vault.setComposer({ characterId: id, characterDescription: description });

          // y con el vienen sus instrucciones: la personalidad es del personaje,
          // no del hilo, y reescribirla en cada conversacion nueva produce el
          // mismo personaje comportandose distinto segun donde se le hable.
          // No pisa las que ya haya: solo rellena lo que esta vacio
          if (draftInstructions !== null || (vault.instructions ?? '').length > 0) return;
          void vault.readCharacterInstructions(id).then((instructions) => {
            if (instructions !== null) vault.setComposer({ instructions });
          });
        }}
      />

      <MemoryPanel vault={vault} provider={provider} model={model} project={project} />

      <CompatibilityPanel vault={vault} models={models} project={project} />

      {vault.error !== null && <Notice tone="fault">{vault.error}</Notice>}

      {providers.length === 0 && (
        <Notice tone="warn">
          El agente todavía no anuncia ningún proveedor. Arráncalo desde Inicio;
          si ya está en marcha, comprueba que la conexión tenga clave guardada.
        </Notice>
      )}

      {projects.length === 0 ? (
        <Notice tone="warn">
          No hay ningún proyecto configurado en esta máquina. Añade uno en
          Proyectos: el turno se ejecuta dentro de uno, en solo lectura.
        </Notice>
      ) : (
        <>
          <div className="row">
            <Field label="Proveedor">
              <select
                value={provider}
                onChange={(event) =>
                  // el modelo se suelta al cambiar de proveedor: uno de otra
                  // familia no existe para el nuevo, y mandarlo produce un
                  // `unrecognized_model` que gasta la llamada igual
                  vault.setComposer({ provider: event.target.value, model: null })
                }
              >
                {providers.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </Field>
            {familyModels.length > 0 ? (
              <Field
                label="Modelo"
                hint="Sin elegir usa el de la conexión, que suele ser el mayor de la familia."
              >
                <select
                  value={model}
                  onChange={(event) => vault.setComposer({ model: event.target.value })}
                >
                  <option value="">por defecto de la conexión</option>
                  {familyModels.map((definition) => (
                    <option key={definition.id} value={definition.apiModel}>
                      {definition.displayName}
                      {/* marcado aquí y no en un aviso aparte: describir una
                          imagen necesita un modelo que sepa mirarla, y elegir
                          uno que no lo hace gasta la llamada para nada. Sólo
                          sale si la conexión lo declara: en silencio significa
                          «no lo dice», no «no puede» */}
                      {definition.capabilities.includes('image_input') ? ' · ve imágenes' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              // los CLI locales no salen en /v1/models, asi que no hay catalogo
              // que ofrecer: se escribe, con sugerencias donde las hay. El valor
              // se manda exacto y decide el CLI
              <Field
                label="Modelo"
                hint={`Sin escribir nada usa el que trae ${provider} por defecto.`}
              >
                <input
                  value={model}
                  list={`modelos-${provider}`}
                  placeholder="por defecto"
                  onChange={(event) => vault.setComposer({ model: event.target.value })}
                />
                <datalist id={`modelos-${provider}`}>
                  {(NATIVE_MODEL_SUGGESTIONS[provider] ?? []).map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              </Field>
            )}
            <Field label="Proyecto">
              <select
                value={project}
                onChange={(event) => vault.setComposer({ project: event.target.value })}
              >
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
            onChange={(event) => vault.setComposer({ message: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canSend) submit();
            }}
          />
          <div className="row">
            <button className="btn btn--primary" disabled={!canSend} onClick={submit}>
              {vault.sending ? 'Esperando respuesta…' : 'Enviar'}
            </button>
            <input
              className="vault-caption"
              value={composer.caption}
              placeholder="Qué se ve en lo que vas a adjuntar…"
              disabled={vault.attaching || vault.openConversationId === null}
              onChange={(event) => vault.setComposer({ caption: event.target.value })}
            />
            <button
              className="btn"
              disabled={vault.attaching || vault.openConversationId === null}
              onClick={() => {
                void vault.attachMedia(composer.caption).then(() => {
                  vault.setComposer({ caption: '' });
                });
              }}
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
 * los dos proveedores de imagen, en el orden en que le sirven a quien mira.
 *
 * AI Horde va primero porque es gratis de verdad y no pide tarjeta: quien no
 * quiera pagar nada tiene que ver esa puerta antes que la otra. Xavira sigue
 * debajo sin recortes, porque hace vídeo y el horde no.
 *
 * Las dos claves son cuentas distintas y se guardan por separado: tener una no
 * habilita la otra.
 */
function ImageProvidersPanel({ vault }: { vault: VaultController }): JSX.Element {
  return (
    <>
      <HordeKeyPanel vault={vault} />
      <MediaKeyPanel vault={vault} />
    </>
  );
}

/**
 * clave de AI Horde, el proveedor gratuito.
 *
 * Aqui no hay nada que comprar: la red la sostienen ordenadores prestados y los
 * kudos deciden el turno en la cola, no el precio. Lo que si hay que decir sin
 * rodeos es lo de la clave anonima, porque el horde le fuerza `shared` y eso
 * dona a un conjunto de datos publico justo lo que se genera en una boveda
 * privada.
 *
 * Los kudos NO se piden al montar: es una llamada de red y la dispara el
 * usuario, igual que hace el panel de memoria de esta misma pantalla.
 */
function HordeKeyPanel({ vault }: { vault: VaultController }): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const configured = vault.status.hordeConfigured;
  const anonymous = vault.status.hordeAnonymous;
  const account = vault.hordeAccount;

  return (
    <Panel
      title="Gratis: AI Horde"
      actions={
        <>
          {/* la cabecera empuja sus acciones contra el borde derecho, y sin
              «--fin» la caja de la explicacion se saldria de la ventana */}
          <span className="explica--fin">
            <Explica termino="aiHorde" />
          </span>
          {!configured ? (
            <Tag tone="idle">sin clave</Tag>
          ) : anonymous ? (
            <Tag tone="warn">
              clave anónima
              <span className="explica--fin">
                <Explica termino="claveAnonima" />
              </span>
            </Tag>
          ) : (
            <Tag tone="ok">clave guardada</Tag>
          )}
        </>
      }
    >
      <p className="vault-prose">
        AI Horde genera imágenes en ordenadores que presta otra gente. Es gratis
        y <strong>no pide método de pago</strong>: la clave se saca registrándose
        en{' '}
        <a href="https://aihorde.net" target="_blank" rel="noreferrer">
          aihorde.net
        </a>
        . No genera vídeo; para eso está Xavira, más abajo.
      </p>

      <Field
        label={configured ? 'Sustituir la clave' : 'Clave de AI Horde'}
        hint="Se envía sólo a AI Horde. Se guarda cifrada con tu cuenta de Windows y no vuelve a mostrarse."
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
            void vault.setHordeKey(apiKey).then(() => setApiKey(''));
          }}
        >
          Guardar clave
        </button>
        {configured && (
          <button
            className="btn btn--danger"
            disabled={vault.busy}
            onClick={() => void vault.deleteHordeKey()}
          >
            Borrar
          </button>
        )}
        {configured && (
          <button className="btn" disabled={vault.busy} onClick={() => void vault.readHordeAccount()}>
            Ver mis kudos
          </button>
        )}
      </div>

      {anonymous && (
        <Notice tone="warn">
          Estás usando la clave anónima <code>0000000000</code>. Funciona, pero
          el horde obliga a <strong>compartir</strong> con ella: todo lo que
          generes se dona a un conjunto de datos público. En una bóveda privada
          eso es lo contrario de lo que se espera. Una clave propia de aihorde.net
          es gratis, tarda un minuto y no comparte nada.
        </Notice>
      )}

      {account !== null && (
        <Readout
          items={[
            { label: 'Usuario', value: account.username },
            { label: 'Kudos', value: String(account.kudos) },
            { label: 'Peticiones a la vez', value: String(account.concurrency) },
          ]}
        />
      )}

      {/* el resto lo cuenta el «?»: repetir aqui la entrada entera del
          glosario dejaba el mismo parrafo dos veces en la misma tarjeta */}
      <p className="field__hint">
        Los kudos
        <Explica termino="kudos" /> no son dinero: deciden en qué puesto de la
        cola entra tu petición.
      </p>
    </Panel>
  );
}

/**
 * clave de Xavira, el proveedor de imagenes DE PAGO.
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
      title="Xavira (de pago): imágenes y vídeo"
      actions={
        <>
          {/* mismo caso que en el panel del horde: pegada al borde derecho, la
              caja necesita abrirse hacia dentro */}
          <span className="explica--fin">
            <Explica termino="xavira" />
          </span>
          {configured ? <Tag tone="ok">clave guardada</Tag> : <Tag tone="idle">sin clave</Tag>}
        </>
      }
    >
      <p className="vault-prose">
        Sin clave, Luxy no ofrece generar imágenes con Xavira: ni en el panel de
        generación ni dentro de una conversación. Se guarda cifrada con tu cuenta
        de Windows y no vuelve a mostrarse. Es el único de los dos que hace
        vídeo, y aquí cada personaje y cada generación cuestan créditos.
      </p>

      <Field
        label={configured ? 'Sustituir la clave' : 'Clave de Xavira'}
        hint="Se envía sólo a Xavira. Ni el gateway ni Supabase la ven."
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
  // reenviar una que ya existía no cuesta créditos, y decirlo importa: es la
  // diferencia entre pagar por una foto nueva y volver a enseñar la de antes
  if (image.costCredits === null) {
    return (
      <Notice tone="ok">
        Te ha reenviado una imagen que ya tenía, sin gastar créditos. Está abajo,
        con el resto de archivos.
      </Notice>
    );
  }
  // los kudos NO son créditos: no se compran y no se gastan en euros. Llamarlos
  // igual en una pantalla donde el otro proveedor cobra de verdad se lee como
  // que la opción gratis está cobrando
  if (image.costUnit === 'kudos') {
    return (
      <Notice tone="ok">
        Imagen generada y cifrada en esta conversación · {image.costCredits}{' '}
        kudos, que no son dinero: sólo tu puesto en la cola. Aparece abajo, con
        el resto de archivos.
      </Notice>
    );
  }
  return (
    <Notice tone="ok">
      Imagen generada y cifrada en esta conversación · {image.costCredits}{' '}
      créditos. Aparece abajo, con el resto de archivos.
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
  // el campo acepta cualquier cadena, así que hay que decir si esa de ahí
  // corresponde a alguien. Sin esto, un identificador inventado se anunciaba
  // igual que uno bueno y solo el proveedor lo desmentía, un turno después.
  // La regla es la misma que aplica el proceso principal al armar el prompt
  const knownCharacter = vault.characters.find((c) => c.characterId === characterValue);
  const imageBlock = imageBlockReason({
    characterId: characterValue,
    characterInVault: knownCharacter !== undefined,
    // la clave que hace falta es la de quien le hace las fotos AHORA, no la de
    // quien se las hacía cuando se creó: el personaje ya no pertenece a ningún
    // proveedor y `imageProvider` puede cambiar sin tocar nada más. Es la misma
    // regla que aplica el proceso principal al armar el prompt
    hasApiKey:
      knownCharacter?.imageProvider === 'horde'
        ? vault.status.hordeConfigured
        : vault.status.mediaProviderConfigured,
  });

  return (
    <details className="vault-generate" open={saved.length > 0}>
      <summary>
        Instrucciones de la conversación
        {saved.length > 0 && !pending && ' · activas'}
        {pending && ' · se aplicarán al enviar'}
      </summary>

      {/* el hint decia ademas «acompaña a cada mensaje sin repetirlo», que es
          palabra por palabra lo que ya cuenta el glosario */}
      <Field
        label="Cómo debe comportarse"
        hint="Se guarda cifrado con la conversación, como el resto."
        explica="instruccionesConversacion"
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
      {characterValue.length > 0 && knownCharacter !== undefined && (
        <p className="field__hint">
          <Tag tone="ok">
            {knownCharacter.label.length > 0 ? knownCharacter.label : 'personaje asignado'}
          </Tag>{' '}
          es quien responde en esta conversación
          {characterValue !== (vault.characterId ?? '') && ' · se fija al enviar'}.
        </p>
      )}
      {imageBlock === 'personaje-desconocido' && (
        <Notice tone="warn">
          Ese identificador no está en la bóveda de este equipo. Mientras siga así,
          esta conversación no podrá generar ni reenviar imágenes, y no se le
          ofrecerá hacerlo. Dalo de alta abajo, en «Generar imagen o vídeo», o
          elige uno de la lista.
        </Notice>
      )}
      {vault.characterDescription !== null && (
        <p className="field__hint">
          El modelo sabe que es: <em>{vault.characterDescription}</em>
        </p>
      )}
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
 * catalogo de rasgos, con su etiqueta en español.
 *
 * Las CLAVES y los VALORES son los del proveedor y no se traducen: viajan tal
 * cual y su enum es cerrado. Lo unico traducido es lo que se lee en pantalla.
 */
const TRAIT_CATALOG: Record<string, { label: string; values: [string, string][] }> = {
  gender: {
    label: 'Género',
    values: [
      ['female', 'mujer'],
      ['male', 'hombre'],
    ],
  },
  ethnicity: {
    label: 'Etnia',
    values: [
      ['white', 'blanca'],
      ['black', 'negra'],
      ['hispanic', 'hispana'],
      ['middle-eastern', 'de Oriente Medio'],
      ['indian', 'india'],
      ['east-asian', 'asiática oriental'],
      ['south-east-asian', 'del sudeste asiático'],
    ],
  },
  ageRange: {
    label: 'Edad',
    values: [
      ['18-22', '18-22'],
      ['21-22', '21-22'],
      ['23-29', '23-29'],
      ['30-39', '30-39'],
      ['40-plus', '40 o más'],
    ],
  },
  hairLength: {
    label: 'Largo del pelo',
    values: [
      ['short', 'corto'],
      ['medium', 'medio'],
      ['long', 'largo'],
    ],
  },
  hairColor: {
    label: 'Color del pelo',
    values: [
      ['black', 'negro'],
      ['brown', 'castaño'],
      ['blonde', 'rubio'],
      ['red', 'pelirrojo'],
      ['auburn', 'castaño rojizo'],
      ['grey', 'gris'],
      ['white', 'blanco'],
    ],
  },
  build: {
    label: 'Complexión',
    values: [
      ['petite', 'menuda'],
      ['slim', 'delgada'],
      ['athletic', 'atlética'],
      ['curvy', 'con curvas'],
      ['voluptuous', 'voluptuosa'],
    ],
  },
  breastSize: {
    label: 'Pecho',
    values: [
      ['small', 'pequeño'],
      ['medium', 'mediano'],
      ['large', 'grande'],
      ['very-large', 'muy grande'],
      ['huge', 'enorme'],
    ],
  },
  assSize: {
    label: 'Trasero',
    values: [
      ['small', 'pequeño'],
      ['medium', 'mediano'],
      ['large', 'grande'],
      ['very-large', 'muy grande'],
      ['huge', 'enorme'],
    ],
  },
};

/**
 * describe al personaje en texto, para el MODELO.
 *
 * El identificador que devuelve el proveedor solo le sirve a el: conserva la
 * identidad entre generaciones. El modelo que escribe no ve ninguna imagen, asi
 * que sin esto no sabe a quien encarna —y responde como un asistente generico,
 * que es exactamente lo que pasaba—.
 *
 * Se compone con las MISMAS etiquetas que se leen en pantalla: no hay un
 * segundo catalogo que pueda divergir.
 */
export function describeCharacter(
  label: string,
  traits: Record<string, string>,
  scene: string,
): string {
  const partes: string[] = [];
  for (const [field, entry] of Object.entries(TRAIT_CATALOG)) {
    const raw = traits[field];
    if (raw === undefined || raw.length === 0) continue;
    const label = entry.values.find(([value]) => value === raw)?.[1] ?? raw;
    partes.push(`${entry.label.toLowerCase()}: ${label}`);
  }
  // el nombre va PRIMERO y forma parte de quien es: sin el, el modelo se
  // inventa uno y la conversacion siguiente ya no cuadra con la anterior
  const nombre = label.trim().length === 0 ? '' : `Te llamas ${label.trim()}. `;
  const rasgos = partes.length === 0 ? '' : `Rasgos: ${partes.join(', ')}.`;
  const extra = scene.trim().length === 0 ? '' : ` Detalles: ${scene.trim()}.`;
  return `${nombre}${rasgos}${extra}`.trim();
}

/** un rasgo del enum cerrado. «Sin especificar» lo deja fuera de la peticion */
function TraitField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const entry = TRAIT_CATALOG[field]!;
  return (
    <Field label={entry.label}>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Sin especificar</option>
        {entry.values.map(([raw, label]) => (
          <option key={raw} value={raw}>
            {label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * avatar de un personaje, descifrado al vuelo.
 *
 * No se cachea a proposito: mantenerlo en el estado del renderer lo dejaria
 * vivo despues de cerrar la boveda, que es justo lo que la boveda evita.
 */
function CharacterAvatar({
  vault,
  characterId,
}: {
  vault: VaultController;
  characterId: string;
}): JSX.Element | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void vault.readCharacterAvatar(characterId).then((value) => {
      if (vivo) setDataUrl(value);
    });
    return () => {
      vivo = false;
    };
  }, [vault, characterId]);

  if (dataUrl === null) return null;
  return <img className="vault-character__avatar" src={dataUrl} alt="" />;
}

/**
 * dar de alta un personaje que ya existe en el proveedor.
 *
 * Existe porque la API **no sabe listar personajes**: quien tenga un
 * identificador de antes —o lo saque de la URL de su avatar— no tiene otra
 * forma de meterlo en Luxy, y crear otro cuesta creditos.
 */
function ImportCharacterForm({
  vault,
  onImported,
}: {
  vault: VaultController;
  onImported: () => void;
}): JSX.Element {
  const [characterId, setCharacterId] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [modelId, setModelId] = useState<'realistic-sharp-v1' | 'anime-pure-v1'>(
    'realistic-sharp-v1',
  );
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Field
        label="Identificador del personaje"
        hint="Si sólo tienes la URL de su avatar, el identificador es el uuid del nombre del archivo."
      >
        <input
          value={characterId}
          placeholder="4a1e227d-89b6-4393-8fe5-cbff8f95ed4c"
          disabled={busy}
          onChange={(event) => setCharacterId(event.target.value)}
        />
      </Field>
      <Field label="Nombre">
        <input value={label} disabled={busy} onChange={(event) => setLabel(event.target.value)} />
      </Field>
      <Field
        label="Estilo con el que se creó"
        hint="Tiene que coincidir con el que usaste al crearlo; aquí sólo se anota, no lo cambia."
      >
        <select
          value={modelId}
          disabled={busy}
          onChange={(event) =>
            setModelId(event.target.value as 'realistic-sharp-v1' | 'anime-pure-v1')
          }
        >
          <option value="realistic-sharp-v1">Realista</option>
          <option value="anime-pure-v1">Anime</option>
        </select>
      </Field>
      <Field
        label="Quién es (lo lee el modelo)"
        hint="Lo lee el modelo para encarnarlo. Sin esto responderá como un asistente."
      >
        <textarea
          rows={2}
          value={description}
          disabled={busy}
          placeholder="Rasgos: género: mujer, edad: 23-29, color del pelo: rubio."
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field
        label="URL del avatar (opcional)"
        hint="Se descarga y se guarda cifrada aquí. La URL ya era pública; Luxy sólo se trae una copia."
      >
        <input
          value={avatarUrl}
          disabled={busy}
          onChange={(event) => setAvatarUrl(event.target.value)}
        />
      </Field>
      <div className="row">
        <button
          className="btn btn--primary"
          disabled={busy || characterId.trim().length === 0}
          onClick={() => {
            setBusy(true);
            void vault
              .importCharacter({
                characterId: characterId.trim(),
                modelId,
                label: label.trim(),
                description:
                  label.trim().length === 0
                    ? description.trim()
                    : `Te llamas ${label.trim()}. ${description.trim()}`.trim(),
                avatarUrl: avatarUrl.trim(),
              })
              .then((ok) => {
                if (!ok) return;
                setCharacterId('');
                setLabel('');
                setDescription('');
                setAvatarUrl('');
                onImported();
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Guardando…' : 'Guardar personaje'}
        </button>
      </div>
    </>
  );
}

/** el tope de la receta: mas de cuatro modelos los rechaza `hordeRecipeSchema` */
const HORDE_MAX_MODELS = 4;

/** el tope del horde: la peticion con un sexto LoRA se rechaza entera */
const HORDE_MAX_LORAS = 5;

/** un modelo ofrecido en la lista, con la foto de workers del dia que se anotó */
interface HordeModelOption {
  readonly name: string;
  readonly workers: number;
  readonly baseline: HordeBaseline;
}

type HordeStyle = 'anime' | 'realistic';

/**
 * de que lista salen los modelos y como se le escribe al generador.
 *
 * No es solo estetico: los modelos de anime se guian por etiquetas booru y los
 * realistas por prosa. Escribirle a uno como al otro empeora el resultado sin
 * dar ningun error.
 */
const HORDE_STYLES: Record<
  HordeStyle,
  {
    label: string;
    models: readonly HordeModelOption[];
    promptStyle: HordeRecipe['promptStyle'];
    appearance: string;
    outfit: string;
  }
> = {
  anime: {
    label: 'Anime',
    models: HORDE_ANIME_MODELS,
    promptStyle: 'tags',
    appearance: '1girl, long black hair, green eyes, small mole under left eye',
    outfit: 'white blouse, denim jacket, black pleated skirt',
  },
  realistic: {
    label: 'Realista',
    models: HORDE_REALISTIC_MODELS,
    promptStyle: 'prose',
    appearance:
      'a woman in her late twenties, dark wavy hair, green eyes, a small mole under her left eye',
    outfit: 'a white blouse and a worn denim jacket',
  },
};

/**
 * de que lista viene un personaje que ya existe.
 *
 * Se mira por el modelo y no por `promptStyle`, porque el modelo es lo que de
 * verdad decide el aspecto; el estilo de prompt es el desempate cuando la
 * receta trae un modelo que ya no esta en ninguna de las dos listas.
 */
function hordeStyleOf(recipe: HordeRecipe | null): HordeStyle {
  if (recipe === null) return 'anime';
  for (const style of ['anime', 'realistic'] as const) {
    const known = HORDE_STYLES[style].models;
    if (recipe.models.some((name) => known.some((option) => option.name === name))) return style;
  }
  return recipe.promptStyle === 'tags' ? 'anime' : 'realistic';
}

/** con que se esta generando ese personaje, para leerlo de un vistazo en la lista */
function hordeModelSummary(recipe: HordeRecipe | null): string {
  if (recipe === null) return 'sin modelo';
  const first = recipe.models[0];
  if (first === undefined) return 'sin modelo';
  const rest = recipe.models.length - 1;
  return rest === 0 ? first : `${first} +${rest}`;
}

/**
 * con que se le hacen las fotos AHORA.
 *
 * Ya no dice de quien es el personaje —no es de nadie: el personaje es lo
 * duradero y el proveedor una propiedad suya—, sino con que se genera, que es
 * lo unico que cambia al cambiar de proveedor.
 */
function activeLookSummary(character: VaultCharacterView): string {
  if (character.imageProvider === 'horde') {
    return `fotos gratis · ${hordeModelSummary(character.horde?.recipe ?? null)}`;
  }
  const modelId = character.xavira?.modelId ?? '';
  return `fotos de pago · ${modelId === 'anime-pure-v1' ? 'anime' : 'realista'}`;
}

/**
 * un personaje en la lista.
 *
 * Enseña **que sabe hacer**, no de quien es: las identidades que tiene, cual le
 * hace las fotos ahora, y —cuando le falta una— lo que se puede hacer para
 * dársela. Una identidad que no tiene no se enseña como etiqueta apagada,
 * porque una etiqueta no dice que hacer al respecto.
 */
function CharacterRow({
  vault,
  character,
  active,
  onPick,
  onEditHorde,
}: {
  vault: VaultController;
  character: VaultCharacterView;
  /** es quien responde en la conversacion abierta */
  active: boolean;
  onPick: () => void;
  /** abre el formulario del horde con ESTE personaje, tenga aspecto o no */
  onEditHorde: () => void;
}): JSX.Element {
  const name = character.label.length > 0 ? character.label : 'Sin nombre';
  // sin las dos identidades no hay nada entre lo que elegir, y el proceso
  // principal rechazaría el cambio de todas formas
  const canSwitch = character.xavira !== null && character.horde !== null;

  return (
    <div
      className="vault-list__item vault-list__item--character"
      aria-current={active ? 'true' : undefined}
    >
      {character.avatarObjectKey !== null && (
        <CharacterAvatar vault={vault} characterId={character.characterId} />
      )}
      <button className="vault-character__pick" onClick={onPick}>
        <span className="vault-list__title">{name}</span>
        <span className="vault-list__meta">{activeLookSummary(character)}</span>
      </button>

      <div className="vault-character__skills">
        {character.xavira !== null && (
          <Tag tone={character.imageProvider === 'xavira' ? 'ok' : 'idle'}>Xavira</Tag>
        )}
        {character.horde !== null && (
          <Tag tone={character.imageProvider === 'horde' ? 'ok' : 'idle'}>AI Horde</Tag>
        )}
        {character.horde === null && (
          <button className="btn btn--quiet" onClick={onEditHorde}>
            Darle aspecto en AI Horde
          </button>
        )}
      </div>

      {canSwitch && (
        <select
          value={character.imageProvider}
          aria-label={`Quién le hace las fotos a ${name}`}
          onChange={(event) =>
            void vault.setCharacterImageProvider(
              character.characterId,
              // el valor sale de estas dos opciones: comparar basta y evita
              // afirmar un tipo sobre una cadena cualquiera del DOM
              event.target.value === 'horde' ? 'horde' : 'xavira',
            )
          }
        >
          <option value="horde">Fotos: AI Horde</option>
          <option value="xavira">Fotos: Xavira</option>
        </select>
      )}

      {active ? (
        <Tag tone="ok">en uso</Tag>
      ) : (
        <button className="btn btn--quiet" onClick={onPick}>
          Usar
        </button>
      )}

      {/* corregir el aspecto del horde es gratis y se puede repetir; el de
          Xavira lo decide el al crearlo y despues no se puede cambiar */}
      {character.horde !== null && (
        <button className="btn btn--quiet" onClick={onEditHorde}>
          Editar su aspecto
        </button>
      )}

      <button
        className="vault-character__forget"
        title="Olvidar aquí. Su identidad en Xavira, si la tiene, sigue existiendo allí."
        onClick={() => void vault.forgetCharacter(character.characterId)}
      >
        ×
      </button>
    </div>
  );
}

/**
 * dar aspecto en AI Horde a un personaje: uno nuevo, o uno que ya existe.
 *
 * Alli no hay personajes en ningun servidor: el aspecto **es** esta receta,
 * guardada cifrada en este equipo. Por eso editarla no cuesta nada y se puede
 * repetir hasta que la cara salga bien, al reves que en Xavira.
 *
 * `editing` puede llegar SIN receta: es alguien que ya existe —normalmente con
 * identidad en Xavira— al que se le esta añadiendo su cara en el horde. En ese
 * caso los campos nacen vacios pero conserva su `characterId`, su nombre y su
 * descripcion, porque no se esta creando a nadie.
 *
 * El formulario se remonta con `key` cuando cambia a quien edita: asi el estado
 * inicial se lee una sola vez y no hace falta un efecto que lo sincronice.
 */
function HordeCharacterForm({
  vault,
  editing,
  onSaved,
  onCancel,
}: {
  vault: VaultController;
  /** a quien se le da o se le corrige el aspecto; `null` para crear uno nuevo */
  editing: VaultCharacterView | null;
  onSaved: (characterId: string, description: string) => void;
  onCancel: () => void;
}): JSX.Element {
  // el aspecto en el horde es una propiedad suya que puede no existir todavia:
  // un personaje de Xavira llega aqui entero pero sin receta
  const base = editing?.horde?.recipe ?? null;
  /** se le esta estrenando la cara en el horde a alguien que ya existe */
  const estrenando = editing !== null && editing.horde === null;
  const initial = recipeDefaultsFor('sdxl');

  const [label, setLabel] = useState(editing?.label ?? '');
  const [style, setStyle] = useState<HordeStyle>(hordeStyleOf(base));
  const [models, setModels] = useState<string[]>(base === null ? [] : [...base.models]);
  const [appearance, setAppearance] = useState(base?.appearance ?? '');
  const [outfit, setOutfit] = useState(base?.outfit ?? '');
  const [negative, setNegative] = useState(base?.negative ?? '');
  const [seed, setSeed] = useState(base?.seed ?? '');
  const [width, setWidth] = useState(base?.width ?? initial.width);
  const [height, setHeight] = useState(base?.height ?? initial.height);
  const [steps, setSteps] = useState(base?.steps ?? initial.steps);
  // una receta que ya existe llega con sus numeros decididos: elegir un modelo
  // no debe pisarlos. Y en cuanto alguien los toca a mano, tampoco
  const [tuned, setTuned] = useState(base !== null);
  const [cfgScale, setCfgScale] = useState(base?.cfgScale ?? initial.cfgScale);
  const [clipSkip, setClipSkip] = useState(base?.clipSkip ?? initial.clipSkip);
  // se copia cada LoRA en vez de compartir el array de la receta: editarlo en
  // sitio mutaria el personaje guardado aunque despues se cancele
  const [loras, setLoras] = useState<HordeLora[]>(
    base === null ? [] : base.loras.map((lora) => ({ ...lora })),
  );
  const [denoisingStrength, setDenoisingStrength] = useState(base?.denoisingStrength ?? 0.45);
  // `null` significa «no la he escrito»: entonces vale la que sale de la receta
  const [description, setDescription] = useState<string | null>(editing?.description ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preset = HORDE_STYLES[style];

  // un LoRA sin palabra de activacion no la lleva como cadena vacia: el campo
  // se omite, porque '' viajaria al horde como un disparador literal vacio
  const cleanLoras: HordeLora[] = loras.map((lora) => {
    const trigger = lora.injectTrigger?.trim() ?? '';
    const clean: HordeLora = {
      name: lora.name.trim(),
      isVersion: lora.isVersion,
      model: lora.model,
      clip: lora.clip,
    };
    return trigger.length === 0 ? clean : { ...clean, injectTrigger: trigger };
  });

  // lo que la receta ya tenia y este formulario no edita —muestreador, retoques,
  // hiresFix— se conserva: corregir la cara no es motivo para tirar el resto
  const candidate = {
    ...(base ?? {}),
    models,
    appearance: appearance.trim(),
    outfit: outfit.trim(),
    negative: negative.trim(),
    seed: seed.trim().length === 0 ? null : seed.trim(),
    width,
    height,
    steps,
    cfgScale,
    clipSkip,
    loras: cleanLoras,
    denoisingStrength,
    promptStyle: preset.promptStyle,
  };
  const parsed = hordeRecipeSchema.safeParse(candidate);
  const auto = parsed.success ? describeHordeCharacter(label, parsed.data) : '';
  const descriptionValue = description ?? auto;

  const applyStyle = (next: HordeStyle): void => {
    setStyle(next);
    // los modelos son de una lista o de la otra: dejar marcados los de la
    // anterior los escondia de la vista sin quitarlos de la receta
    if (next !== style) setModels([]);
  };

  const toggleModel = (option: HordeModelOption): void => {
    if (models.includes(option.name)) {
      setModels(models.filter((name) => name !== option.name));
      return;
    }
    if (models.length >= HORDE_MAX_MODELS) return;
    // el primero decide la familia, y con ella el tamaño y el clipSkip: SD1 a
    // 1024 produce cuerpos deformes, y SDXL a 512 pierde detalle
    if (models.length === 0 && !tuned) {
      const defaults = recipeDefaultsFor(option.baseline);
      setWidth(defaults.width);
      setHeight(defaults.height);
      setSteps(defaults.steps);
      setCfgScale(defaults.cfgScale);
      setClipSkip(defaults.clipSkip);
    }
    setModels([...models, option.name]);
  };

  const updateLora = (index: number, patch: Partial<HordeLora>): void => {
    setLoras(loras.map((lora, each) => (each === index ? { ...lora, ...patch } : lora)));
  };

  const save = (): void => {
    // el motivo mas frecuente, dicho en español: el de Zod para una lista vacía
    // llega en inglés y no explica para qué sirve el modelo
    if (models.length === 0) {
      setProblem('Marca al menos un modelo: sin ninguno el horde no sabe con qué generar.');
      return;
    }
    // el de Zod para una fila a medias sería «loras.0.name: String must contain
    // at least 1 character(s)», que no dice qué hacer con ella
    if (cleanLoras.some((lora) => lora.name.length === 0)) {
      setProblem(
        'Hay un LoRA sin identificador: escribe el suyo de CivitAI o quítalo de la lista.',
      );
      return;
    }
    if (!parsed.success) {
      // el mensaje de Zod aqui es mucho mas util que el error del proceso
      // principal, que llega despues y sin decir que campo fue
      setProblem(
        parsed.error.issues
          .map((issue) =>
            issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
          )
          .join('; '),
      );
      return;
    }
    setProblem(null);
    const text = descriptionValue.trim();
    setSaving(true);
    void vault
      .saveHordeCharacter({
        // vacio crea uno nuevo; con valor le da o le corrige el aspecto a ESE,
        // sea del horde o de Xavira, sin tocar sus imagenes ni sus recuerdos
        characterId: editing?.characterId ?? '',
        label: label.trim(),
        description: text,
        recipe: parsed.data,
      })
      .then((id) => {
        if (id === null) return;
        onSaved(id, text);
      })
      .finally(() => setSaving(false));
  };

  return (
    <>
      {editing !== null && estrenando && (
        <Notice tone="idle">
          {editing.label.length > 0 ? editing.label : 'Este personaje'} ya existe
          en la bóveda: esto <strong>no crea a nadie nuevo</strong>. Conserva su
          identificador, sus recuerdos y sus conversaciones; lo que escribas aquí
          decide sólo cómo saldrá en las fotos que le haga AI Horde. Al
          guardarlo, pasa a hacérselas él; puedes devolvérselas a Xavira cuando
          quieras, desde la lista de personajes.
        </Notice>
      )}

      {/* el parrafo entero repetia la entrada del glosario; queda la frase que
          hay que leer sin hacer nada, y el «?» cuenta por que importa */}
      <p className="field__hint">
        En AI Horde el aspecto <strong>es</strong> esta receta, guardada cifrada
        en este equipo.
        <Explica termino="personajeReceta" />
      </p>

      <Field label="Nombre">
        <input
          value={label}
          disabled={saving}
          placeholder="Luxy"
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>

      <Field
        label="Estilo"
        hint="Cambia los modelos que se ofrecen y cómo se le escribe: etiquetas en anime, prosa en realista."
        explica="estiloPrompt"
      >
        <div className="row">
          {(['anime', 'realistic'] as const).map((option) => (
            <button
              key={option}
              className={style === option ? 'btn btn--primary' : 'btn btn--quiet'}
              disabled={saving}
              onClick={() => applyStyle(option)}
            >
              {HORDE_STYLES[option].label}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label={`Modelos (hasta ${HORDE_MAX_MODELS})`}
        hint="Marcar varios suma sus workers y acorta la espera; no cuesta kudos de más."
        explica="modeloImagen"
      >
        <div className="vault-models">
          {preset.models.map((option) => {
            const chosen = models.includes(option.name);
            const live = vault.hordeModels?.find((each) => each.name === option.name) ?? null;
            return (
              <label key={option.name} className="check">
                <input
                  type="checkbox"
                  checked={chosen}
                  disabled={saving || (!chosen && models.length >= HORDE_MAX_MODELS)}
                  onChange={() => toggleModel(option)}
                />
                <span>
                  {option.name}
                  <small>
                    {option.baseline === 'sdxl' ? 'SDXL' : 'SD1'} · {option.workers} workers
                    cuando se anotó
                    {live !== null && ` · ahora ${live.count}, espera ${live.eta} s`}
                    {live === null &&
                      vault.hordeModels !== null &&
                      vault.hordeModels.length > 0 &&
                      ' · ahora no lo sirve nadie'}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
      </Field>

      <div className="row">
        <button
          className="btn btn--quiet"
          disabled={saving}
          // no se pregunta al montar: es una llamada de red, y la dispara quien
          // la quiera, igual que hace el panel de memoria de esta pantalla
          onClick={() => void vault.loadHordeModels()}
        >
          Ver disponibilidad
        </button>
        <Explica termino="workers" />
        {vault.hordeModels !== null && vault.hordeModels.length > 0 && (
          <span className="field__hint">
            Workers y espera de ahora mismo. Cambian cada pocas horas.
          </span>
        )}
        {vault.hordeModels !== null && vault.hordeModels.length === 0 && (
          <span className="field__hint">
            La consulta no ha devuelto ningún modelo: puede ser un fallo de red.
            Los de la lista siguen valiendo.
          </span>
        )}
      </div>

      <Field
        label="Aspecto fijo, en inglés"
        hint="Es lo único que se repite palabra por palabra en cada imagen: es lo que hace que sea la misma persona."
        explica="aspectoFijo"
      >
        <textarea
          rows={2}
          value={appearance}
          disabled={saving}
          placeholder={preset.appearance}
          onChange={(event) => setAppearance(event.target.value)}
        />
      </Field>

      <Field label="Ropa habitual, en inglés" hint="Va aparte porque cambia mucho más a menudo que la cara.">
        <textarea
          rows={2}
          value={outfit}
          disabled={saving}
          placeholder={preset.outfit}
          onChange={(event) => setOutfit(event.target.value)}
        />
      </Field>

      <Field
        label="Negativo propio (opcional)"
        hint="Lo que no quieres ver nunca, separado por comas."
        explica="negativo"
      >
        <input
          value={negative}
          disabled={saving}
          placeholder="blurry, extra fingers, watermark"
          onChange={(event) => setNegative(event.target.value)}
        />
      </Field>

      <Field label="Semilla (opcional)" explica="semilla">
        <input
          value={seed}
          disabled={saving}
          placeholder="sin fijar"
          onChange={(event) => setSeed(event.target.value)}
        />
      </Field>
      <div className="row">
        <button
          className="btn btn--quiet"
          disabled={saving}
          onClick={() => setSeed(String(Math.floor(Math.random() * 2147483647)))}
        >
          Fijar una al azar
        </button>
        <span className="field__hint">
          Con la misma semilla la cara se repite mucho mejor. Sin fijarla, cambia
          en cada imagen.
        </span>
      </div>

      <details className="vault-generate">
        <summary>
          LoRA de personaje (lo único que fija la cara)
          <Explica termino="lora" />
        </summary>
        {/* lo del id numerico lo dice ahora el «?» de la propia casilla, justo
            donde se decide; aqui se queda lo que cuesta pedir un LoRA */}
        <p className="field__hint">
          El LoRA tiene que estar <strong>publicado en CivitAI</strong>: al horde
          no se le puede subir uno propio. Cada uno cuesta <strong>+3 kudos</strong>{' '}
          y sólo <strong>9 de los 18 workers</strong> de hoy los aceptan, así que
          pedirlos <strong>reduce a la mitad</strong> quién puede atenderte.
        </p>

        {loras.map((lora, index) => (
          // la clave es la posición porque un LoRA no tiene identificador
          // propio y todos los campos los gobierna este estado
          <div key={index} className="vault-lora">
            <div className="row">
              <Field label="Identificador o nombre en CivitAI">
                <input
                  value={lora.name}
                  disabled={saving}
                  placeholder={lora.isVersion ? '1234567' : 'nombre exacto o id de la página'}
                  onChange={(event) => updateLora(index, { name: event.target.value })}
                />
              </Field>
              <button
                className="vault-character__forget"
                title="Quitar este LoRA"
                disabled={saving}
                onClick={() => setLoras(loras.filter((_, each) => each !== index))}
              >
                ×
              </button>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={lora.isVersion}
                disabled={saving}
                onChange={(event) => updateLora(index, { isVersion: event.target.checked })}
              />
              <span>
                Es un id de versión
                {/* el «?» es un boton, y pulsarlo dentro de una etiqueta NO
                    marca la casilla: el navegador no propaga esa activacion */}
                <Explica termino="loraVersion" />
                <small>
                  Marcado, el identificador es el número de una versión concreta.
                  Sin marcar, el nombre exacto o el id de la página del modelo.
                </small>
              </span>
            </label>

            <div className="row">
              {/* el «?» va solo en el primero: los dos pesos son el mismo
                  concepto y repetirlo llena la fila de interrogaciones */}
              <Field label="Peso del modelo" explica="loraPeso">
                <input
                  type="number"
                  min={-5}
                  max={5}
                  step={0.05}
                  value={lora.model}
                  disabled={saving}
                  onChange={(event) => updateLora(index, { model: Number(event.target.value) })}
                />
              </Field>
              <Field label="Peso del CLIP">
                <input
                  type="number"
                  min={-5}
                  max={5}
                  step={0.05}
                  value={lora.clip}
                  disabled={saving}
                  onChange={(event) => updateLora(index, { clip: Number(event.target.value) })}
                />
              </Field>
            </div>

            <Field
              label="Palabra de activación (opcional)"
              hint="Si el LoRA la necesita y no se pone, casi no hace nada."
              explica="loraTrigger"
            >
              <input
                maxLength={30}
                value={lora.injectTrigger ?? ''}
                disabled={saving}
                placeholder="any"
                onChange={(event) => updateLora(index, { injectTrigger: event.target.value })}
              />
            </Field>
          </div>
        ))}

        <div className="row">
          <button
            className="btn btn--quiet"
            disabled={saving || loras.length >= HORDE_MAX_LORAS}
            onClick={() => setLoras([...loras, { name: '', isVersion: false, model: 1, clip: 1 }])}
          >
            Añadir LoRA
          </button>
          <span className="field__hint">
            {loras.length} de {HORDE_MAX_LORAS}.
            {loras.length >= HORDE_MAX_LORAS && ' El horde no acepta más.'}
          </span>
        </div>
      </details>

      <details className="vault-generate">
        <summary>Avanzado</summary>
        {/* no hay campo para el clipSkip: se pone solo con el modelo, asi que
            el «?» cuelga de donde se lee su valor */}
        <p className="field__hint">
          Los valores los pone el modelo elegido y casi nunca hay que tocarlos:
          ahora mismo cfgScale {cfgScale} y clipSkip {clipSkip}
          <Explica termino="clipSkip" />. Los lados van de 512 a 1536 y tienen
          que ser múltiplos de 64.
        </p>
        <div className="row">
          {/* el «?» explica el par ancho/alto entero, asi que va solo en el
              primero de los dos */}
          <Field label="Ancho" explica="resolucion">
            <input
              type="number"
              min={512}
              max={1536}
              step={64}
              value={width}
              disabled={saving}
              onChange={(event) => {
                setTuned(true);
                setWidth(Number(event.target.value));
              }}
            />
          </Field>
          <Field label="Alto">
            <input
              type="number"
              min={512}
              max={1536}
              step={64}
              value={height}
              disabled={saving}
              onChange={(event) => {
                setTuned(true);
                setHeight(Number(event.target.value));
              }}
            />
          </Field>
          <Field label="Pasos" hint="Deja 30." explica="pasos">
            <input
              type="number"
              min={1}
              max={60}
              value={steps}
              disabled={saving}
              onChange={(event) => {
                setTuned(true);
                setSteps(Number(event.target.value));
              }}
            />
          </Field>
        </div>

        <Field
          label="Cuánto puede cambiar respecto a la imagen de partida"
          hint="Sólo cuenta al partir de una imagen anterior."
          explica="cuantoPuedeCambiar"
        >
          <input
            type="number"
            min={0.01}
            max={1}
            step={0.05}
            value={denoisingStrength}
            disabled={saving}
            onChange={(event) => setDenoisingStrength(Number(event.target.value))}
          />
        </Field>
      </details>

      <Field
        label="Quién es (lo lee el modelo)"
        hint="El modelo que escribe no ve ninguna imagen: sin esto no sabe a quién encarna y responde como un asistente."
      >
        <textarea
          rows={2}
          value={descriptionValue}
          disabled={saving}
          placeholder="Se compone sola con el nombre y el aspecto; puedes reescribirla."
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      {problem !== null && <Notice tone="fault">{problem}</Notice>}

      <div className="row">
        <button className="btn btn--primary" disabled={saving} onClick={save}>
          {saving
            ? 'Guardando…'
            : editing === null
              ? 'Guardar personaje'
              : estrenando
                ? 'Darle este aspecto'
                : 'Guardar cambios'}
        </button>
        {editing !== null && (
          <button className="btn btn--quiet" disabled={saving} onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
      <p className="field__hint">
        Guardar no llama a ninguna API y no cuesta nada. Lo que escribas aquí
        viaja a AI Horde cuando generes: la bóveda protege lo que Luxy guarda, no
        lo que un tercero ve porque se lo envías.
      </p>
    </>
  );
}

/**
 * generacion de imagen y video.
 *
 * El personaje es obligatorio: es lo que mantiene la misma apariencia entre
 * generaciones. Vive en la boveda con su `characterId`, que no cambia nunca, y
 * el proveedor que le hace las fotos es una propiedad suya que se cambia cuando
 * haga falta: cambiarla no le quita recuerdos, conversaciones ni imagenes.
 */
function GeneratePanel({
  vault,
  activeCharacterId,
  onCharacterReady,
}: {
  vault: VaultController;
  /**
   * el elegido AHORA, aunque todavia no se haya enviado ningun mensaje.
   *
   * Sin esto, pulsar un personaje no cambiaba nada en pantalla —la marca solo
   * aparecia al enviar— y no habia forma de saber si la seleccion habia
   * funcionado.
   */
  activeCharacterId: string | null;
  onCharacterReady: (characterId: string, description: string) => void;
}): JSX.Element {
  const [characterId, setCharacterId] = useState('');
  const [traits, setTraits] = useState<Record<string, string>>({});
  const [scene, setScene] = useState('');
  const [sfw, setSfw] = useState(false);
  const [modelId, setModelId] = useState<'realistic-sharp-v1' | 'anime-pure-v1'>(
    'realistic-sharp-v1',
  );
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  // a quien se esta corrigiendo del horde, y si su formulario esta desplegado.
  // El desplegable va controlado porque «Editar» tiene que abrirlo desde fuera
  const [hordeEditing, setHordeEditing] = useState<VaultCharacterView | null>(null);
  const [hordeFormOpen, setHordeFormOpen] = useState(false);
  // cadena vacia = empezar de cero, que es lo normal
  const [fromMediaId, setFromMediaId] = useState('');

  // partir de una imagen solo existe en el horde: Xavira no tiene img2img. Lo
  // que decide es quien le hace las fotos AHORA, no que aspectos tenga guardados
  const hordeCharacter =
    vault.characters.find(
      (character) =>
        character.characterId === characterId.trim() && character.imageProvider === 'horde',
    ) ?? null;
  const sourceOptions = vault.media.filter((item) => item.mimeType.startsWith('image/'));
  // una eleccion que ya no esta en la lista —otra conversacion, un medio
  // olvidado— no puede seguir viajando: seria un identificador que no existe
  const sourceMediaId = sourceOptions.some((item) => item.mediaId === fromMediaId)
    ? fromMediaId
    : '';

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

      {!vault.status.mediaProviderConfigured && !vault.status.hordeConfigured && (
        <Notice tone="warn">
          No hay ninguna clave guardada: ni la gratuita de AI Horde ni la de
          Xavira. Las dos están más abajo; sin una de ellas no se puede generar
          nada, ni aquí ni desde la conversación.
        </Notice>
      )}
      {!vault.status.mediaProviderConfigured && vault.status.hordeConfigured && (
        <Notice tone="idle">
          Sólo está la clave gratuita de AI Horde: pueden hacerse fotos los
          personajes que tengan aspecto en el horde, y sólo imágenes. El vídeo lo
          hace Xavira, que está más abajo.
        </Notice>
      )}

      <Field
        label="Personaje"
        hint="Hace falta uno: es lo que mantiene la misma apariencia entre generaciones."
      >
        <input
          value={characterId}
          placeholder="identificador del personaje"
          onChange={(event) => setCharacterId(event.target.value)}
        />
      </Field>

      <details className="vault-generate">
        <summary>Ya tengo un personaje</summary>
        <p className="field__hint">
          Xavira no sabe listar personajes, así que uno creado fuera de Luxy —o
          antes de que se guardaran— hay que darlo de alta a mano. Crear otro
          costaría créditos.
        </p>
        <ImportCharacterForm vault={vault} onImported={() => setCreated(null)} />
      </details>

      <details
        className="vault-generate"
        open={hordeFormOpen}
        onToggle={(event) => setHordeFormOpen(event.currentTarget.open)}
      >
        <summary>
          {/* tres titulos distintos porque son tres cosas distintas: crear a
              alguien, darle cara en el horde a quien ya existe, o corregir la
              que ya tiene. Decir «crear» en el segundo caso hacía temer que se
              duplicaba el personaje */}
          {hordeEditing === null
            ? 'Crear un personaje gratis, con AI Horde'
            : hordeEditing.horde === null
              ? `Darle aspecto en AI Horde a ${
                  hordeEditing.label.length > 0 ? hordeEditing.label : 'este personaje'
                }`
              : `Corregir el aspecto de ${
                  hordeEditing.label.length > 0 ? hordeEditing.label : 'este personaje'
                }`}
        </summary>

        {!vault.status.hordeConfigured && (
          <Notice tone="warn">
            Falta la clave de AI Horde. Está más abajo, en «Gratis: AI Horde», y
            es gratis y sin tarjeta. Puedes escribir la receta y guardarla igual,
            pero no generará ninguna imagen hasta que la pongas.
          </Notice>
        )}
        {vault.status.hordeAnonymous && (
          <Notice tone="warn">
            Con la clave anónima el horde <strong>dona</strong> lo que generes a
            un conjunto de datos público. Cambiarla por una propia es gratis y
            está más abajo.
          </Notice>
        )}

        <HordeCharacterForm
          // remontar al cambiar de personaje: asi el formulario nace con sus
          // valores y no hace falta sincronizarlo despues
          key={hordeEditing?.characterId ?? 'nuevo'}
          vault={vault}
          editing={hordeEditing}
          onSaved={(id, description) => {
            // corregir el pelo de un personaje CUALQUIERA no puede cambiar quién
            // responde en la conversación abierta. Crear uno sí lo adopta, que
            // es lo que se espera al acabar de crearlo; editar, no
            const creando = hordeEditing === null;
            setHordeEditing(null);
            setHordeFormOpen(false);
            if (!creando) return;
            setCharacterId(id);
            onCharacterReady(id, description);
          }}
          onCancel={() => {
            setHordeEditing(null);
            setHordeFormOpen(false);
          }}
        />
      </details>

      {vault.characters.length > 0 && (
        <>
          <div className="vault-list">
            {vault.characters.map((character) => (
              <CharacterRow
                key={character.characterId}
                vault={vault}
                character={character}
                active={character.characterId === activeCharacterId}
                onPick={() => {
                  setCharacterId(character.characterId);
                  onCharacterReady(character.characterId, character.description);
                }}
                onEditHorde={() => {
                  setHordeEditing(character);
                  setHordeFormOpen(true);
                }}
              />
            ))}
          </div>
          <p className="field__hint">
            Tus personajes guardados. Pulsa <strong>Usar</strong> para que sea
            quien responda en esta conversación: queda fijado al enviar el
            próximo mensaje. Cada uno enseña qué sabe hacer —quién puede hacerle
            fotos, con <strong>Xavira</strong>
            <Explica termino="xavira" /> o con <strong>AI Horde</strong>
            <Explica termino="aiHorde" />— y cuál se las hace ahora mismo.
          </p>
          <p className="field__hint">
            Cambiar de proveedor <strong>no le quita nada</strong>: es el mismo
            personaje, con sus recuerdos, sus conversaciones y las imágenes que
            ya tiene. Lo único que cambia es de dónde salen las fotos nuevas —y
            que su cara será distinta, porque cada proveedor la construye a su
            manera.
          </p>
        </>
      )}

      <Field
        label="Nombre del personaje"
        hint="Sólo para reconocerlo en tu lista y en el panel de Xavira."
      >
        <input
          value={label}
          disabled={creating}
          placeholder="Luxy"
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>

      <Field
        label="Estilo del personaje"
        hint="Lo decide Xavira al crearlo y después no se puede cambiar: gobierna el aspecto de lo que genere él."
      >
        <select
          value={modelId}
          disabled={creating}
          onChange={(event) =>
            setModelId(event.target.value as 'realistic-sharp-v1' | 'anime-pure-v1')
          }
        >
          <option value="realistic-sharp-v1">Realista</option>
          <option value="anime-pure-v1">Anime</option>
        </select>
      </Field>

      <div className="row">
        {(['gender', 'ethnicity', 'ageRange'] as const).map((field) => (
          <TraitField
            key={field}
            field={field}
            value={traits[field] ?? ''}
            disabled={creating}
            onChange={(value) => setTraits({ ...traits, [field]: value })}
          />
        ))}
      </div>
      <div className="row">
        {(['hairLength', 'hairColor', 'build'] as const).map((field) => (
          <TraitField
            key={field}
            field={field}
            value={traits[field] ?? ''}
            disabled={creating}
            onChange={(value) => setTraits({ ...traits, [field]: value })}
          />
        ))}
      </div>
      {traits.gender === 'female' && (
        <div className="row">
          {(['breastSize', 'assSize'] as const).map((field) => (
            <TraitField
              key={field}
              field={field}
              value={traits[field] ?? ''}
              disabled={creating}
              onChange={(value) => setTraits({ ...traits, [field]: value })}
            />
          ))}
        </div>
      )}
      <p className="field__hint">
        Xavira sólo acepta esta lista cerrada de rasgos; no admite texto libre
        aquí. Lo demás —ojos, pecas, ropa, luz, pose, escenario— va en la
        descripción de abajo.
      </p>

      <Field
        label="Aspecto, en inglés (para las imágenes)"
        hint="En inglés: es lo que pide su documentación. Aquí va lo que los rasgos no cubren. Pasa por la moderación de Xavira."
      >
        <textarea
          rows={2}
          value={scene}
          disabled={creating}
          placeholder="green eyes, freckles, wearing a crew-neck sweater and jeans"
          onChange={(event) => setScene(event.target.value)}
        />
      </Field>

      <label className="check">
        <input
          type="checkbox"
          checked={sfw}
          disabled={creating}
          onChange={(event) => setSfw(event.target.checked)}
        />
        Avatar inicial vestido
      </label>

      <div className="row">
        <button
          className="btn btn--quiet"
          disabled={creating}
          onClick={() => {
            setCreating(true);
            void vault
              .createCharacter({
                modelId,
                traits,
                scene,
                sfw,
                label: label.trim(),
                description: describeCharacter(label, traits, scene),
              })
              .then((id) => {
                if (id === null) return;
                setCharacterId(id);
                setCreated(id);
                // el modelo no ve imagenes: sin una descripcion en texto no
                // sabe a quien encarna, por muy bien que salga el avatar
                onCharacterReady(id, describeCharacter(label, traits, scene));
              })
              .finally(() => setCreating(false));
          }}
        >
          {creating ? 'Creando… (tarda unos segundos)' : 'Crear personaje'}
        </button>
      </div>
      {created !== null && (
        <Notice tone="ok">
          Personaje creado y ya asignado a esta conversación. Su identificador es{' '}
          <code>{created}</code> — guárdalo si quieres reutilizarlo en otra.
        </Notice>
      )}
      <p className="field__hint">
        Esto le da identidad en <strong>Xavira</strong>: el identificador lo pone
        él, generar su avatar <strong>consume créditos</strong> y ese aspecto
        después no se puede cambiar. El de AI Horde, arriba, es gratis y se
        corrige cuando quieras; un personaje puede tener los dos y elegir cuál
        le hace las fotos.
      </p>

      {hordeCharacter !== null && sourceOptions.length > 0 && (
        <>
          <Field
            label="Partir de una imagen de esta conversación"
            hint="Opcional. Sirve para volver a intentar una imagen que ya salió bien."
            explica="imagenPartida"
          >
            <select
              value={sourceMediaId}
              disabled={vault.generating}
              onChange={(event) => setFromMediaId(event.target.value)}
            >
              <option value="">Empezar de cero</option>
              {sourceOptions.map((item) => (
                <option key={item.mediaId} value={item.mediaId}>
                  {item.displayName !== null && item.displayName.length > 0
                    ? item.displayName
                    : item.mediaId.slice(0, 8)}
                </option>
              ))}
            </select>
          </Field>
          {sourceMediaId.length > 0 && (
            <Notice tone="warn">
              Esto <strong>varía</strong> esa imagen. <strong>No</strong> lleva la
              cara del personaje a una escena nueva: AI Horde no sabe hacer eso.
              Y cuesta <strong>un 30 % más de kudos</strong>.
            </Notice>
          )}
          <p className="field__hint">
            Cuánto se aleja del original lo decide el personaje, en su campo
            «Cuánto puede cambiar»: por debajo de 0,3 devuelve casi la misma
            imagen y por encima de 0,6 se pierde la cara.
          </p>
        </>
      )}

      <Field
        label="Qué quieres ver en la imagen"
        hint="Sólo para esta generación. La apariencia ya la fija el personaje."
      >
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
              .generateMedia({
                characterId: characterId.trim(),
                prompt: prompt.trim(),
                kind,
                // sin imagen de partida el campo no viaja: el horde cobra un
                // 30 % mas solo por llevarla
                fromMediaId: sourceMediaId.length === 0 ? undefined : sourceMediaId,
              })
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
        <p className="field__hint">
          Última generación: {vault.lastCost.amount}{' '}
          {vault.lastCost.unit === 'kudos'
            ? 'kudos, que no son dinero: sólo tu puesto en la cola.'
            : 'créditos.'}
        </p>
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
/**
 * la lista de conversaciones, separada por personaje.
 *
 * Plana y ordenada solo por fecha, los hilos de Lia salian mezclados con los
 * que no son suyos y habia que abrirlos para saber de quien eran: en un
 * contenido privado eso es justo lo que no se quiere hacer.
 *
 * Con un solo personaje no se pinta ninguna cabecera. Un unico grupo titulado
 * no separa nada y solo añade ruido.
 */
function ConversationList({ vault }: { vault: VaultController }): JSX.Element {
  const groups = useMemo(
    () => groupConversationsByCharacter(vault.conversations),
    [vault.conversations],
  );
  // se lee una vez por render y se pasa a `describeWhen`, que es pura: asi
  // «hoy» y «ayer» se calculan con la hora local sin meter el reloj dentro
  const now = new Date();
  const grouped = groups.length > 1;

  return (
    <div className="vault-groups">
      {groups.map((group) => (
        <div className="vault-group" key={group.characterId ?? 'sin-personaje'}>
          {grouped && (
            <p className="vault-group__head">
              <span className="vault-group__name">{group.label}</span>
              <span className="vault-group__count">
                {group.conversations.length === 1
                  ? '1 conversación'
                  : `${group.conversations.length} conversaciones`}
              </span>
            </p>
          )}
          <div className="vault-list">
            {group.conversations.map((conversation) => (
              <button
                key={conversation.conversationId}
                className="vault-list__item"
                aria-current={
                  conversation.conversationId === vault.openConversationId ? 'true' : undefined
                }
                onClick={() => void vault.openConversation(conversation.conversationId)}
              >
                <span className="vault-list__title">{conversation.title}</span>
                <span className="vault-list__meta">
                  {conversation.turns} turnos · {describeWhen(conversation.updatedAt, now)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * los archivos de la conversacion, en rejilla.
 *
 * Antes era una lista de botones «Ver» y no se veia nada sin abrirlos uno a
 * uno. Con miniaturas se ve de un vistazo lo que hay, que es justo lo que hace
 * falta para decidir si pedir otra imagen o reutilizar una.
 *
 * No hay miniaturas GUARDADAS a proposito: Electron no sabe decodificar webp
 * en el proceso principal —comprobado—, y webp es el formato de casi todo lo
 * que entra aqui. Asi que cada baldosa descifra su imagen cuando entra en
 * pantalla y ni una antes.
 */
function MediaGallery({
  vault,
  provider,
  model,
  project,
}: {
  vault: VaultController;
  /* el mismo proveedor, modelo y proyecto que ya estan elegidos arriba: pedir
     una descripcion es otra llamada a lo mismo, no una conexion aparte */
  provider: string;
  model: string;
  project: string;
}): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = vault.media.find((item) => item.mediaId === openId) ?? null;

  return (
    <>
      <div className="vault-gallery">
        {vault.media.map((item) => (
          <GalleryTile
            key={item.mediaId}
            item={item}
            vault={vault}
            onOpen={() => setOpenId(item.mediaId)}
          />
        ))}
      </div>
      {open !== null && (
        <MediaViewer
          item={open}
          vault={vault}
          provider={provider}
          model={model}
          project={project}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

/**
 * una baldosa de la rejilla.
 *
 * Descifra su imagen cuando entra en pantalla y no antes: abrir una
 * conversacion con treinta archivos no puede descifrarlos todos de golpe.
 * La copia descifrada vive en el estado de este componente, que se desmonta
 * al cerrar la boveda, asi que no sobrevive al cierre.
 */
function GalleryTile({
  item,
  vault,
  onOpen,
}: {
  item: VaultController['media'][number];
  vault: VaultController;
  onOpen: () => void;
}): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const node = box.current;
    if (node === null || visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void vault.openMedia(item.mediaId).then((url) => {
      if (cancelled) return;
      if (url === null) setTooBig(true);
      else setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, item.mediaId, vault]);

  const isVideo = item.mimeType.startsWith('video/');
  const caption = item.caption ?? '';
  const name = item.displayName ?? item.mediaId.slice(0, 8);

  return (
    <button
      ref={box}
      className="vault-gallery__tile"
      onClick={onOpen}
      title={caption.length > 0 ? caption : name}
    >
      <span className="vault-gallery__frame">
        {dataUrl !== null && !isVideo && (
          <img className="vault-gallery__image" src={dataUrl} alt="" />
        )}
        {dataUrl !== null && isVideo && (
          /* sin `controls`: la baldosa es para mirar, y el visor es donde se
             reproduce. Con controles, pulsar la baldosa daba al play en vez
             de abrirla */
          <video className="vault-gallery__image" src={dataUrl} muted />
        )}
        {dataUrl === null && (
          <span className="vault-gallery__placeholder">
            {tooBig ? 'demasiado grande' : '…'}
          </span>
        )}
        {isVideo && <span className="vault-gallery__badge">vídeo</span>}
      </span>
      <span className="vault-gallery__foot">
        {caption.length > 0 ? (
          caption
        ) : (
          /* sin pie de foto el modelo no sabe que hay aqui y acaba pagando otra
             generacion: se marca en la propia baldosa, no en un aviso aparte */
          <em className="vault-gallery__missing">sin pie de foto</em>
        )}
      </span>
    </button>
  );
}

/**
 * el archivo abierto a tamaño completo, con todo lo que se puede hacer con el.
 *
 * Va sobre la pantalla y no dentro de la rejilla porque corregir un pie de foto
 * es leerlo contra la imagen: en linea, el cuadro de texto y la imagen no
 * cabian a la vez.
 */
function MediaViewer({
  item,
  vault,
  provider,
  model,
  project,
  onClose,
}: {
  item: VaultController['media'][number];
  vault: VaultController;
  provider: string;
  model: string;
  project: string;
  onClose: () => void;
}): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);
  // borrador del pie de foto. `null` significa «nadie lo esta corrigiendo», y
  // se guarda aparte del valor real para que una descripcion recien escrita por
  // el modelo se vea sin pisar lo que haya a medio escribir aqui
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // por que no hay descripcion despues de pedirla: negarse y no contestar se
  // arreglan de forma distinta, asi que no se pueden contar igual
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void vault.openMedia(item.mediaId).then((url) => {
      if (cancelled) return;
      if (url === null) setTooBig(true);
      else setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [item.mediaId, vault]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // sin esto la unica salida es dar al boton, y en una imagen a pantalla
      // casi completa lo primero que se pulsa es Escape
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isVideo = item.mimeType.startsWith('video/');
  // solo una imagen se puede mirar: pedirle a un modelo con vista que describa
  // un video gasta la llamada y no devuelve nada
  const isImage = item.mimeType.startsWith('image/');
  const caption = item.caption ?? '';
  const editing = draft !== null;
  const chosen = model.length === 0 ? provider : model;

  return (
    <div
      className="vault-viewer"
      role="dialog"
      aria-modal="true"
      // cerrar al pulsar FUERA, no dentro: sin la comprobacion, escribir en el
      // pie de foto cerraba el visor con cada clic
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="vault-viewer__panel">
        <div className="vault-viewer__head">
          <strong>{item.displayName ?? item.mediaId.slice(0, 8)}</strong>
          <button className="btn btn--quiet" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {dataUrl !== null && !isVideo && (
          <img className="vault-viewer__media" src={dataUrl} alt="" />
        )}
        {dataUrl !== null && isVideo && (
          <video className="vault-viewer__media" src={dataUrl} controls />
        )}
        {dataUrl === null && !tooBig && <Skeleton rows={3} />}

        {tooBig && (
          <Notice tone="warn">
            Demasiado grande para previsualizarlo todavía. El archivo está
            guardado y cifrado; falta la parte que reproduce vídeo sin
            descifrarlo entero en memoria.
          </Notice>
        )}

        {caption.length > 0 ? (
          <p className="vault-media__caption">{caption}</p>
        ) : (
          <Notice tone="warn">
            Sin pie de foto. Es lo único que el modelo sabe de este archivo: sin
            él no sabe qué se ve aquí, así que no puede elegirlo para
            reenviártelo y acaba pagando otra generación.
          </Notice>
        )}

        {item.prompt !== null && item.prompt.length > 0 && (
          /* lo que se PIDIO no es lo que se VE: verlos juntos es justo lo que
             explica una imagen que no salio como se esperaba. Es historia, y por
             eso se enseña en pequeño y no se puede corregir */
          <p className="vault-media__prompt">Se pidió al generarla: «{item.prompt}»</p>
        )}

        {editing ? (
          <div className="row">
            <input
              className="vault-caption"
              value={draft}
              placeholder="Qué se ve en este archivo…"
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              className="btn btn--primary"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                // vacio a proposito lo deja sin pie de foto: borrar una
                // descripcion equivocada es tan legitimo como corregirla
                void vault.setMediaCaption(item.mediaId, draft.trim()).then((ok) => {
                  setSaving(false);
                  if (ok) setDraft(null);
                });
              }}
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button className="btn btn--quiet" disabled={saving} onClick={() => setDraft(null)}>
              Cancelar
            </button>
          </div>
        ) : (
          <div className="row">
            <button className="btn btn--quiet" onClick={() => setDraft(caption)}>
              {caption.length > 0 ? 'Corregir el pie de foto' : 'Escribir el pie de foto'}
            </button>
            {isImage && (
              <button
                className="btn btn--quiet"
                disabled={vault.describingMedia}
                onClick={() => {
                  setFailure(null);
                  void vault
                    .describeMedia({
                      mediaId: item.mediaId,
                      provider,
                      model: model.length === 0 ? null : model,
                      projectAlias: project,
                    })
                    // con descripcion ya esta guardada y la lista se recarga sola:
                    // aqui solo queda quedarse con el motivo cuando no la hubo
                    .then((result) => setFailure(result.failure));
                }}
              >
                {vault.describingMedia ? 'Mirando…' : 'Describir con IA'}
              </button>
            )}
          </div>
        )}

        {isImage && !editing && (
          <p className="field__hint">
            Describir gasta una llamada a <Tag tone="idle">{chosen}</Tag> y necesita
            un modelo que sepa <strong>mirar</strong> imágenes: no todos los de la
            lista lo son. Lo que escriba se puede corregir a mano, porque es
            exactamente lo que lee después el personaje.
          </p>
        )}

        {failure === 'negativa' && (
          <Notice tone="warn">
            Ese modelo se negó a describir la imagen. Repetirlo no lo arregla:
            cambia el modelo de arriba y vuelve a pulsar, o escribe tú el pie de
            foto.
          </Notice>
        )}

        {failure === 'vacio' && (
          <Notice tone="warn">
            {chosen} no contestó nada. Aquí sí tiene sentido volver a intentarlo.
          </Notice>
        )}
      </div>
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
        // solo cuando toca: quien escribe su contraseña no necesita que le
        // expliquen que es una contraseña
        {...(recovering ? { explica: 'claveRecuperacion' as const } : {})}
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
    <Panel
      title="Bóveda cerrada"
      actions={
        <span className="explica--fin">
          <Explica termino="boveda" />
        </span>
      }
    >
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
        {...(mode === 'recovery' ? { explica: 'claveRecuperacion' as const } : {})}
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
            {/* «Cerrar ahora» no decía QUÉ se cierra, y quien busca la salida
                de la bóveda no lo reconocía como tal */}
            <button className="btn" disabled={vault.busy} onClick={() => void vault.lock()}>
              Cerrar la bóveda
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

      <ImageProvidersPanel vault={vault} />

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
        {/* con la sesión caducada, entrar era la ÚNICA salida de esta pantalla:
            quien no quisiera volver a entrar se quedaba sin forma de soltar la
            cuenta de este equipo. Cerrar sesión no necesita sesión viva —sólo
            avisa al servidor si la hay— y es lo que se busca aquí */}
        {linked && (
          <button
            className="btn"
            disabled={vault.busy}
            onClick={() => void vault.logoutAccount()}
          >
            Cerrar sesión
          </button>
        )}
      </div>
      {linked && (
        <p className="field__hint">
          Cerrar sesión suelta esta cuenta de este ordenador y cierra la bóveda.
          Lo cifrado se queda aquí y se vuelve a abrir con la misma contraseña.
        </p>
      )}
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


/**
 * comprueba que modelos sirven para esta conversacion.
 *
 * La sonda es la propia conversacion, que ya esta cifrada: no se escribe aqui
 * ningun texto de muestra, y ademas es mejor prueba —lo que importa es si un
 * modelo acepta lo tuyo, no un ejemplo inventado—.
 *
 * Es de solo lectura: no añade turnos ni toca la memoria.
 */
function CompatibilityPanel({
  vault,
  models,
  project,
}: {
  vault: VaultController;
  models: ModelDefinition[];
  project: string;
}): JSX.Element | null {
  const [selected, setSelected] = useState<string[]>([]);
  const [repetitions, setRepetitions] = useState(1);

  const usable = models.filter((model) => model.enabled);
  if (usable.length === 0 || vault.openConversationId === null) return null;

  const toggle = (id: string): void => {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((each) => each !== id) : [...previous, id],
    );
  };

  const run = (): void => {
    const targets = usable
      .filter((model) => selected.includes(model.id))
      .map((model) => ({ provider: model.family, model: model.apiModel }));
    void vault.checkCompatibility({ projectAlias: project, targets, repetitions });
  };

  return (
    <details className="vault-generate">
      <summary>Comprobar modelos con esta conversación</summary>

      <p className="field__hint">
        Ejecuta tu último mensaje contra los modelos que elijas, con las
        instrucciones y el personaje de esta conversación. No guarda nada, no
        añade turnos y no genera imágenes: solo mira qué contesta cada uno.
      </p>

      <div className="vault-list">
        {usable.map((model) => (
          <label key={model.id} className="row">
            <input
              type="checkbox"
              checked={selected.includes(model.id)}
              onChange={() => toggle(model.id)}
            />
            <span>
              {model.displayName} <Tag tone="idle">{model.family}</Tag>
            </span>
          </label>
        ))}
      </div>

      <Field
        label="Repeticiones por modelo"
        hint="Una sola vez es un sondeo, no una prueba: la respuesta de un modelo varía entre intentos."
      >
        <select
          value={repetitions}
          onChange={(event) => setRepetitions(Number(event.target.value))}
        >
          {[1, 2, 3, 5].map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </Field>

      <button
        className="btn"
        disabled={selected.length === 0 || vault.checkingCompatibility}
        onClick={run}
      >
        {vault.checkingCompatibility ? 'Probando…' : `Probar ${selected.length} modelo(s)`}
      </button>

      {vault.compatibility !== null && (
        <div className="vault-media">
          {vault.compatibility.map((result) => (
            <p key={`${result.provider}:${result.model ?? ''}`} className="field__hint">
              <Tag tone={result.refused > 0 ? 'warn' : result.answered > 0 ? 'ok' : 'idle'}>
                {result.model ?? result.provider}
              </Tag>{' '}
              {result.answered} contestó · {result.refused} se negó · {result.empty} sin respuesta
              {result.answered > 0 && ` · memoria correcta ${result.memoryOk}/${result.answered}`}
              {result.signals.length > 0 && ` · ${result.signals.join(', ')}`}
              {result.error !== null && ` · ${result.error}`}
            </p>
          ))}
        </div>
      )}
    </details>
  );
}


/**
 * lo que el personaje puede recordar.
 *
 * Existe para DIAGNOSTICAR, no para crear recuerdos: esos se hacen solos. Si un
 * dia no se acuerda de algo, aqui se ve si el momento existe, con que titulo
 * quedo y que hay dentro exactamente.
 */
function MemoryPanel({
  vault,
  provider,
  model,
  project,
}: {
  vault: VaultController;
  provider: string;
  model: string;
  project: string;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);

  const episodes = vault.memoryEpisodes;

  return (
    <details
      className="vault-generate"
      onToggle={(event) => {
        // se cargan al abrir el panel y no antes: construir el indice tiene un
        // coste y nadie lo pidio todavia
        if (!event.currentTarget.open || episodes !== null) return;
        // catalogar primero y listar despues: si hay escenas nuevas, la lista
        // ya sale partida y titulada por quien leyo la conversacion, no por el
        // reloj.
        //
        // Y hasta ACABAR, en tandas: a tres por apertura, diez conversaciones
        // exigian abrir el panel cuatro veces sin saber por que, que parecia
        // que recatalogaba lo ya hecho. Se hacen solos, asi que se acaban solos.
        void (async () => {
          const target = {
            provider,
            model: model.length === 0 ? null : model,
            projectAlias: project,
          };
          // tope de vueltas: una cola que no baja es un fallo, no un motivo
          // para seguir gastando llamadas
          for (let vuelta = 0; vuelta < 12; vuelta += 1) {
            const result = await vault.syncCatalog(target);
            if (result === null || result.pending === 0) break;
            // si una tanda no cataloga NADA, algo va mal de forma sistematica
            // —un modelo que no existe para ese proveedor, por ejemplo— y seguir
            // solo gasta una llamada por conversacion pendiente
            if (result.cataloged === 0 || result.failed > 0) break;
          }
          await vault.loadMemory();
        })();
      }}
    >
      <summary>
        Lo que recuerda ({vault.catalogingMemory ? 'leyendo…' : (episodes?.length ?? '…')})
      </summary>

      <p className="field__hint">
        Momentos que puede recordar en cualquier conversación, del más reciente al
        más antiguo. Se hacen solos a partir de lo que ya habéis hablado. Excluir
        una conversación no la borra: sigue abriéndose igual, pero deja de volver
        desde otro sitio.
      </p>

      <Notice tone="idle">
        Para partirlos y titularlos se manda el texto completo de cada conversación
        sin catalogar al proveedor elegido arriba: ahora mismo{' '}
        <Tag tone="idle">{model.length === 0 ? provider : model}</Tag>. Si prefieres
        otro para esta tarea, cámbialo antes de abrir esto. Lo excluido no se envía.
      </Notice>

      {vault.lastCatalog !== null && (
        <p className="field__hint">
          {vault.lastCatalog.cataloged > 0
            ? `Se han ordenado ${vault.lastCatalog.cataloged} conversación(es) en ${vault.lastCatalog.scenes} momentos.`
            : 'No había nada nuevo que ordenar.'}
          {vault.lastCatalog.pending > 0 &&
            ` Quedan ${vault.lastCatalog.pending} sin ordenar.`}
        </p>
      )}

      {vault.lastCatalog !== null && vault.lastCatalog.failed.length > 0 && (
        <Notice tone="warn">
          {/* el reintento va aqui y no tras reiniciar: quien se niega es un
              modelo concreto, asi que la salida natural es probar con otro sin
              cerrar el programa */}
          <button
            className="btn btn--quiet"
            disabled={vault.catalogingMemory}
            onClick={() => {
              const target = {
                provider,
                model: model.length === 0 ? null : model,
                projectAlias: project,
              };
              void (async () => {
                for (const each of vault.lastCatalog?.failed ?? []) {
                  await vault.syncCatalog({ ...target, conversationId: each.conversationId });
                }
                await vault.loadMemory();
              })();
            }}
          >
            {vault.catalogingMemory
              ? 'Probando…'
              : `Reintentar con ${model.length === 0 ? provider : model}`}
          </button>{' '}
          {vault.lastCatalog.failed.length === 1
            ? 'Una conversación no se pudo ordenar y se queda partida por silencios'
            : `${vault.lastCatalog.failed.length} conversaciones no se pudieron ordenar y se quedan partidas por silencios`}
          :{' '}
          {[...new Set(vault.lastCatalog.failed.map((each) => each.reason))].join('; ')}. No se
          reintentan solas hasta que reinicies, para no gastar una llamada en cada
          apertura.
        </Notice>
      )}

      {vault.lastCatalog !== null && vault.lastCatalog.uneven.length > 0 && (
        <Notice tone="warn">
          {/* mismo boton que el reintento por fallo, y por el mismo motivo: lo
              que hay que cambiar es el modelo, no volver a abrir el panel */}
          <button
            className="btn btn--quiet"
            disabled={vault.catalogingMemory}
            onClick={() => {
              const target = {
                provider,
                model: model.length === 0 ? null : model,
                projectAlias: project,
              };
              void (async () => {
                for (const each of vault.lastCatalog?.uneven ?? []) {
                  await vault.syncCatalog({ ...target, conversationId: each.conversationId });
                }
                await vault.loadMemory();
              })();
            }}
          >
            {vault.catalogingMemory
              ? 'Probando…'
              : `Repetir con ${model.length === 0 ? provider : model}`}
          </button>{' '}
          {vault.lastCatalog.uneven.length === 1
            ? 'Una conversación salió partida en trozos del mismo tamaño'
            : `${vault.lastCatalog.uneven.length} conversaciones salieron partidas en trozos del mismo tamaño`}
          . Eso no es como fue la conversación: es que el modelo no encontró dónde
          cortar y repartió a ojo. El catálogo se conserva —uno tosco recuerda más
          que ninguno—, así que no hay nada que arreglar con prisa; si quieres
          momentos de verdad, cambia el modelo de arriba y repítelas.
        </Notice>
      )}

      {episodes !== null && episodes.length === 0 && (
        <Empty title="Todavía no hay nada que recordar">
          Habla un poco más y aquí irán apareciendo los momentos.
        </Empty>
      )}

      {episodes?.map((episode) => {
        const excluded = vault.memoryExcluded.includes(episode.conversationId);
        return (
          <div key={episode.id} className="vault-media__item">
            <p className="field__hint">
              <Tag tone={excluded ? 'idle' : 'ok'}>{episode.date}</Tag> {episode.title}{' '}
              <span className="vault-list__meta">
                {episode.turns} turnos
                {episode.catalogedBy === null
                  ? ' · sin catalogar, partido por silencios'
                  : ` · catalogado con ${episode.catalogedBy}`}
              </span>
            </p>
            <div className="row">
              <button
                className="btn btn--quiet"
                onClick={() => {
                  if (open === episode.id) {
                    setOpen(null);
                    return;
                  }
                  void vault.readMemoryEpisode(episode).then((read) => {
                    setTurns(read);
                    setOpen(episode.id);
                  });
                }}
              >
                {open === episode.id ? 'Cerrar' : 'Ver'}
              </button>
              <button
                className="btn btn--quiet"
                onClick={() => void vault.excludeFromMemory(episode.conversationId, !excluded)}
              >
                {excluded ? 'Volver a recordar' : 'Excluir esta conversación'}
              </button>
              {/* sin esto, mejorar el catalogador no arregla los catálogos que
                  ya existen: sólo se aplicaría a las conversaciones nuevas, y
                  las que salieron mal se quedarían mal para siempre */}
              <button
                className="btn btn--quiet"
                disabled={vault.catalogingMemory}
                title="Vuelve a partir esta conversación en momentos, con el modelo elegido arriba"
                onClick={() => {
                  void vault
                    .syncCatalog({
                      provider,
                      model: model.length === 0 ? null : model,
                      projectAlias: project,
                      conversationId: episode.conversationId,
                    })
                    .then(() => vault.loadMemory());
                }}
              >
                {vault.catalogingMemory ? 'Repasando…' : 'Repasar sus momentos'}
              </button>
            </div>
            {open === episode.id && (
              <div className="vault-thread">
                {turns.map((turn, index) => (
                  <div key={index} className={`vault-turn vault-turn--${turn.role}`}>
                    <span className="vault-turn__who">
                      {turn.role === 'user' ? 'Tú' : 'Ella'}
                    </span>
                    <p className="vault-turn__text">{turn.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </details>
  );
}
