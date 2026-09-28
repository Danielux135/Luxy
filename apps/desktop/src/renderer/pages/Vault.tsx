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
import {
  PENDING_DECISION_HINTS,
  PENDING_DECISION_LABELS,
  PENDING_PARTY_LABELS,
  PENDING_STATUS_LABELS,
  PENDING_STATUS_TONES,
  groupPendingByCharacter,
  pendingDecisionsFor,
} from '../vault-pending.js';
import {
  keepSweepingCatalog,
  keepSweepingRecaps,
  keepSweepingRelations,
} from '../vault-sweep.js';
import {
  CLI_LABELS,
  RECAP_REFUSAL_LABELS,
  describeForgetAck,
  describeRecapRow,
} from '../vault-recap-row.js';
import { describeKudosBreakdown } from '../vault-kudos-breakdown.js';
import { vaultNoticeFor } from '../vault-notice.js';
import { useVaultPresence } from '../vault-presence.js';
import {
  RECENT_MEMORIES_CHECKBOX,
  charactersNamedIn,
  describeCharacterLink,
  describeCharacterUnlink,
  linkSeparator,
  ownerHintQuestion,
  ownerTitle,
  replySpeaker,
  shortDate,
  suggestWithHistory,
  userTextsOf,
} from '../vault-character-link.js';
import { describeReply, replyAt, replyTabLabel, replyTone } from '../vault-compatibility-reply.js';
import { auxiliaryName, backgroundAuxiliary } from '../vault-auxiliary.js';
import type { ConfigSummary } from '../useConfig.js';
import type { VaultErrorArea } from '../useVault.js';
import {
  formatAutoLockOption,
  formatLockCountdown,
  imageCostOutcome,
  imageOriginSnapshot,
  pendingImageCard,
  type CompatibilityResult,
  type ImageOrigin,
  type VaultCharacterView,
  type VaultController,
} from '../useVault.js';
import { ImagePlanPanel } from './vault/ImagePlanPanel.js';
import { imageBlockReason } from '../../shared/vault-image-capability.js';
import { describeQueue, type HordeQueueProgress } from '../../shared/horde-progress.js';
import {
  NATIVE_MODEL_SUGGESTIONS,
  effortsFor,
  missingProviderReason,
  modelForProvider,
  modelsForProvider,
  providerForModel,
} from '../../shared/model-selection.js';
import {
  HORDE_ANIME_MODELS,
  HORDE_REALISTIC_MODELS,
  IMAGE_ATTEMPT_STATE_LABELS,
  MAX_CAPTION_CHARS,
  describeConversationMemoryStatus,
  describeHordeCharacter,
  hordeRecipeSchema,
  isConversationalModel,
  mixedBaselineWarning,
  qualityPrefixWarning,
  recipeDefaultsFor,
  splitJoinedPrompt,
  type HordeBaseline,
  type HordeLora,
  type HordeRecipe,
  type ImageAttempt,
  type LocalCliProvider,
  type ModelDefinition,
  type ReasoningEffort,
  resolveAuxiliaryTarget,
} from '@luxy/shared';

/**
 * el aviso de un recuadro: el motivo y, pegada, la salida.
 *
 * `slots` son las areas de las que ese recuadro se hace cargo; `null` es el
 * aviso general de la pagina. Quien decide es una funcion pura con pruebas
 * (`vault-notice.ts`), porque escribir la condicion a mano en cada panel es lo
 * que dejo la pista huerfana: el motivo en su seccion y la unica frase que dice
 * que hacer varios paneles mas abajo, en verde, junto a los «Clave guardada».
 */
function VaultNotice({
  vault,
  slots,
}: {
  vault: VaultController;
  slots: readonly VaultErrorArea[] | null;
}): JSX.Element | null {
  const aviso = vaultNoticeFor(vault, slots);
  if (aviso === null) return null;
  return (
    <Notice tone={aviso.tone}>
      {aviso.error}
      {aviso.error !== null && aviso.hint !== null && ' '}
      {aviso.hint}
    </Notice>
  );
}

/** debe coincidir con AUTO_LOCK_MINUTES del proceso principal */
const AUTO_LOCK_CHOICES = [1, 5, 15, 30, 60, 240, 0] as const;

const MIN_PASSWORD_LENGTH = 10;

/** ocho grupos de cuatro, sin los separadores. Debe coincidir con vault-crypto */
const RECOVERY_KEY_LENGTH = 32;

/** lo que se elige en el desplegable para escribir un modelo que no esta listado */
const OTRO_MODELO = '::otro::';

/**
 * el modelo de un proveedor NATIVO —los CLI locales— como lista de verdad.
 *
 * Claude y Codex no salen en `/v1/models`: no son conexiones HTTP, son
 * programas que ya estan instalados aqui. Antes esto era una caja de texto con
 * un `datalist` detras, y un `datalist` es una lista que casi nadie ve: hay
 * que ponerse a escribir para que aparezca. En la practica era escribir el
 * nombre del modelo de memoria, y en el banco de pruebas de vision ni siquiera
 * habia sugerencias.
 *
 * Ahora es un `select`, y la lista lleva tres cosas:
 *
 * 1. **por defecto**, que es dejarselo al CLI. Para Codex eso significa el
 *    `model` de su `config.toml`, o sea lo que el usuario ya tenia puesto;
 * 2. **las sugerencias comprobadas** de ese proveedor, si las hay;
 * 3. **el valor en uso**, aunque no sea una sugerencia. Sin esto, un modelo
 *    escrito a mano desaparecia de la lista en cuanto se volvia a mirar, y
 *    parecia que se habia perdido.
 *
 * Y **«otro…»**, que devuelve la caja de texto. No es un adorno: la lista de
 * sugerencias es corta a proposito —`CLAUDE.md` prohibe inventarse los valores
 * de un CLI sin comprobarlos contra su `--help`, y el de Codex declara
 * `--model <MODEL>` sin enumerar ninguno— asi que cerrar la lista dejaria
 * fuera modelos que existen de verdad.
 */
function NativeModelField({
  provider,
  value,
  onChange,
}: {
  provider: string;
  value: string;
  onChange: (model: string) => void;
}): JSX.Element {
  const [escribiendo, setEscribiendo] = useState(false);
  const sugerencias = NATIVE_MODEL_SUGGESTIONS[provider] ?? [];
  const opciones =
    value.length > 0 && !sugerencias.includes(value) ? [...sugerencias, value] : sugerencias;

  if (escribiendo) {
    return (
      <Field label="Modelo" hint={`Se manda tal cual. Sin nada usa el de ${provider}.`}>
        <input
          value={value}
          placeholder="por defecto"
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="btn btn--quiet" onClick={() => setEscribiendo(false)}>
          Volver a la lista
        </button>
      </Field>
    );
  }

  return (
    <Field label="Modelo" hint={`Sin elegir usa el que trae ${provider} por defecto.`}>
      <select
        value={value}
        onChange={(event) => {
          // «otro…» no es un modelo: abre la caja de texto y deja lo que
          // hubiera elegido, para poder corregirlo en vez de empezar de cero
          if (event.target.value === OTRO_MODELO) setEscribiendo(true);
          else onChange(event.target.value);
        }}
      >
        <option value="">por defecto</option>
        {opciones.map((opcion) => (
          <option key={opcion} value={opcion}>
            {opcion}
          </option>
        ))}
        <option value={OTRO_MODELO}>otro…</option>
      </select>
    </Field>
  );
}

export function VaultPage({
  vault,
  summary,
  providers,
  models,
}: {
  vault: VaultController;
  summary: ConfigSummary;
  /**
   * catalogo real de TODOS los origenes configurados, junto.
   *
   * Quien lo consume filtra por proveedor con `modelsForProvider`, que no es lo
   * mismo que filtrar por familia: ver `providerCandidatesForModel`.
   */
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
  // teclado y raton dentro de Privado mantienen abierta la boveda; leerla, no
  // (`D-106`). Va antes de los `return` tempranos: un hook no puede saltarse
  useVaultPresence(vault.status.unlocked, vault.markPresence);
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
      <VisionBench
        vault={vault}
        providers={providers}
        models={models}
        project={vault.composer.project ?? Object.keys(summary.config?.projects ?? {})[0] ?? ''}
        conversationProvider={vault.composer.provider ?? providers[0] ?? 'claude'}
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
  // qué intento se está revisando; `null` es «ninguno». El panel NO se abre solo
  // encima de una escena en marcha: aparece la tarjeta y se mira cuando se
  // quiera. Un modal automático a mitad de conversación es lo que hace que una
  // función así se apague a la semana
  const [reviewingAttempt, setReviewingAttempt] = useState<string | null>(null);
  /**
   * el cambio de dueño que se esta confirmando: con un personaje es enganchar,
   * con `null` es soltar. `undefined` es que no hay ninguno abierto.
   *
   * Lleva la conversacion en la que se pidio, y solo vale mientras siga siendo
   * la abierta. Este panel no se remonta al cambiar de hilo: sin eso, pulsar
   * «Nueva» o abrir otra con la confirmacion delante dejaba el selector
   * desactivado sin forma de cerrarla, y la confirmacion saltaba a la otra
   * conversacion, donde se podia enganchar un hilo que no era el elegido.
   */
  const [ownerChangeRequest, setOwnerChange] = useState<
    | {
        conversationId: string;
        characterId: string | null;
        /**
         * ya se llevo la vista a la confirmacion una vez. Al volver a esta
         * conversacion desde la lista el panel se monta otra vez, y sin esto la
         * pagina saltaba a la confirmacion en vez de al hilo (revision del 28/09)
         */
        shown?: boolean;
      }
    | undefined
  >(undefined);
  const ownerChange =
    ownerChangeRequest !== undefined &&
    ownerChangeRequest.conversationId === vault.openConversationId
      ? ownerChangeRequest
      : undefined;
  // el acuse del ultimo cambio, en la conversacion en la que se hizo
  const [ownerAck, setOwnerAck] = useState<{ conversationId: string; text: string } | null>(null);
  // la tarjeta de lo que quedó esperando, que NO depende de `lastImage`: ver
  // `pendingImageCard`
  const pendingCard = pendingImageCard({
    lastImage: vault.lastImage,
    pendingImagePlan: vault.pendingImagePlan,
  });
  // el compositor vive en el controlador, no aquí: esta página se desmonta al
  // cambiar de pestaña y con ella se perdía el proveedor elegido y todo lo
  // escrito sin enviar
  const { composer } = vault;
  const { message, instructions: draftInstructions, characterId: draftCharacter } = composer;
  // `null` significa «no ha elegido»: entonces vale el primero de la lista,
  // pero una elección suya se conserva aunque la lista cambie de orden
  const project = composer.project ?? projects[0] ?? '';
  const provider = composer.provider ?? providers[0] ?? 'claude';
  // los que ejecuta ESTE proveedor, que no es «los de su familia»: ver
  // `providerCandidatesForModel`. Se le pasa la lista de proveedores en marcha
  // para que un modelo con un ejecutor mas exacto no se cuele aqui —el selector
  // de `mistral` ofrecia uno que solo sirve `ovh-nemo`—
  const providerModels = modelsForProvider(models, provider, providers) as ModelDefinition[];
  // cadena vacia = «el de la conexion». Es lo que hacia siempre, y ahora es una
  // eleccion visible en vez de la unica posibilidad.
  //
  // Y se comprueba que lo ejecute ESTE proveedor: el modelo se recuerda por
  // conversacion y viaja al cambiar de proveedor, asi que uno guardado puede no
  // existir para el proveedor actual. Mandarlo gasta la llamada y devuelve
  // `unrecognized_model`
  const model = modelForProvider(models, provider, composer.model, providers) ?? '';

  // que esfuerzos tiene sentido ofrecer AQUI. Vacio = este proveedor no
  // entiende de esfuerzos, y entonces no se pinta nada: un selector que no
  // hace nada es peor que no tenerlo
  const efforts = effortsFor(provider, model.length === 0 ? null : model);
  // y el elegido tiene que seguir estando: cambiar de modelo puede dejar fuera
  // el esfuerzo que habia —`ultra` no existe en `gpt-5.5`— y mandarlo asi
  // haria fallar la llamada, que se paga igual
  const effort =
    composer.effort !== null && efforts.includes(composer.effort) ? composer.effort : null;

  // con la confirmacion del enganche abierta no se envia: un turno en medio
  // dejaba su texto desfasado —«tambien sus N mensajes anteriores», «no tiene
  // todavia memoria propia»— y, mientras se enganchaba, main contestaba con un
  // error evitable (revision del 28/09)
  const canSend =
    message.trim().length > 0 &&
    project.length > 0 &&
    provider.length > 0 &&
    !vault.sending &&
    ownerChange === undefined;

  const submit = (): void => {
    void vault
      .send({
        message: message.trim(),
        provider,
        model: model.length === 0 ? null : model,
        effort,
        projectAlias: project,
        instructions: draftInstructions,
        // el personaje solo viaja al NACER la conversacion; despues se cambia con
        // el selector y main rechazaria el envio (`D-103`). La ficha la pone
        // main desde la boveda, nunca la de aqui
        characterId: vault.openConversationId === null ? draftCharacter : null,
        characterDescription: null,
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

  /**
   * UNA sola forma de elegir personaje, venga del selector, de la galeria o del
   * aviso por nombre: en una conversacion nueva prepara su turno 0; en una sin
   * dueño abre la confirmacion del enganche; en una que ya es de alguien no
   * cambia de quien es (la galeria sigue eligiendo para generar imagenes).
   *
   * La galeria NO abre el enganche en una conversacion ya empezada (revision
   * del 28/09): la confirmacion se pinta junto al selector, varias pantallas por
   * debajo de la lista, y alli donde se pulso «Usar» no cambiaba nada. Ademas,
   * quien solo queria generar una imagen se encontraba con una pregunta que no
   * habia hecho. Enganchar se hace desde el selector o desde el boton de arriba.
   */
  const chooseCharacter = (characterId: string, from: 'selector' | 'gallery' = 'selector'): void => {
    if (vault.openConversationId === null) {
      vault.setComposer({ characterId, characterDescription: null });
      return;
    }
    if (from === 'gallery') return;
    if ((vault.conversationOwner?.source ?? 'none') === 'none') {
      setOwnerAck(null);
      setOwnerChange({ conversationId: vault.openConversationId, characterId });
    }
  };

  const draftLabel =
    draftCharacter === null
      ? null
      : (vault.characters.find((entry) => entry.characterId === draftCharacter)?.label ?? null);
  const owner = vault.openConversationId === null ? null : vault.conversationOwner;
  const ownerless = vault.openConversationId !== null && (owner?.source ?? 'none') === 'none';
  const separator = owner === null ? null : linkSeparator(owner);

  // el aviso «¿Es de Lia?»: solo sus mensajes y el borrador, sin dueño y sin
  // descarte. Se calcula aqui y no se registra en ningun sitio.
  //
  // Lo de los turnos va memoizado aparte del borrador: trocear toda la
  // conversacion en cada render costaba 150-650 ms con una larga sin dueño
  // —justo el caso del aviso—, y hay un render por tecla y otro por latido
  // (revision del 28/09). `vault.turns` solo cambia al releer la conversacion
  const hintOwnerId = vault.openConversationId === null ? draftCharacter : vault.characterId;
  const hintDismissed = vault.ownerHintDismissed.has(vault.openConversationId ?? '');
  const namedInHistory = useMemo(
    () =>
      hintOwnerId !== null || hintDismissed
        ? []
        : charactersNamedIn(userTextsOf(vault.turns), vault.characters),
    [hintOwnerId, hintDismissed, vault.turns, vault.characters],
  );
  const suggested =
    ownerChange !== undefined
      ? []
      : suggestWithHistory({
          namedInHistory,
          draft: message,
          characters: vault.characters,
          ownerId: hintOwnerId,
          dismissed: hintDismissed,
        });
  const suggestedCharacters = suggested
    .map((id) => vault.characters.find((entry) => entry.characterId === id))
    .filter((entry): entry is VaultCharacterView => entry !== undefined);

  return (
    <Panel
      title={ownerTitle(owner, draftLabel)}
      actions={
        vault.openConversationId !== null && (
          <>
            {/* sin proyectos la confirmacion no se pinta —vive en la rama que los
                tiene—, y el boton se quedaba desactivado sin nada a la vista */}
            {ownerless && vault.characters.length > 0 && projects.length > 0 && (
              <button
                className="btn btn--quiet"
                disabled={vault.sending || ownerChange !== undefined}
                // desactivado y sin explicacion parecia roto: la confirmacion
                // puede estar varias pantallas mas abajo (revision del 28/09)
                title={
                  ownerChange !== undefined
                    ? 'Ya hay un cambio de personaje esperando: confírmalo o déjalo estar más abajo, encima del selector de personaje'
                    : vault.sending
                      ? 'Espera a que llegue la respuesta'
                      : undefined
                }
                onClick={() => {
                  if (vault.openConversationId === null) return;
                  setOwnerAck(null);
                  setOwnerChange({
                    conversationId: vault.openConversationId,
                    characterId: vault.characters[0]!.characterId,
                  });
                }}
              >
                Enganchar a un personaje
              </button>
            )}
            <button className="btn btn--quiet" onClick={() => void vault.openConversation(null)}>
              Nueva
            </button>
          </>
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
            <div key={turn.sequence}>
              <div className={`vault-turn vault-turn--${turn.role}`}>
                {/* con su nombre solo lo que se escribio con su ficha: desde la
                    posicion del dueño en adelante (`D-103`) */}
                <span className="vault-turn__who">{replySpeaker(turn, owner)}</span>
                <p className="vault-turn__text">{turn.text}</p>
              </div>
              {separator !== null && turn.sequence === owner?.signedAfter && (
                <p className="field__hint">{separator}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {vault.media.length > 0 && (
        /* la clave es la conversacion a proposito: al cambiar de hilo se
           remonta, asi que se cierra la imagen que hubiera abierta y la lista
           vuelve a estar plegada. Sin esto, el visor de una conversacion
           seguia encima al abrir otra */
        <MediaGallery
          key={vault.openConversationId ?? ''}
          vault={vault}
          provider={provider}
          model={model}
          effort={effort}
          project={project}
        />
      )}

      {vault.lastImage !== null && (
        <ImageOutcome
          vault={vault}
          image={vault.lastImage}
          onReview={setReviewingAttempt}
        />
      )}

      {/* y lo que quedó esperando, venga del turno de ahora o del registro
          cifrado. `lastImage` es estado de esta ventana y se pierde al cambiar
          de conversación o al cerrar Studio; el plan sigue guardado. Sin esta
          tarjeta no había forma de llegar al panel —el único botón que lo abre
          está dentro— y el pendiente quedaba inalcanzable: ni verlo, ni
          generarlo, ni descartarlo */}
      {pendingCard !== null && (
        <ImageOutcome vault={vault} image={pendingCard} onReview={setReviewingAttempt} />
      )}

      {/* y el panel SOLO cuando se ha pedido mirar ese intento en concreto. Se
          compara el identificador y no un booleano porque el pendiente cambia
          al cambiar de conversacion: con un booleano, abrir otro hilo habria
          desplegado encima el plan del nuevo sin que nadie lo pidiera */}
      {vault.pendingImagePlan !== null &&
        vault.pendingImagePlan.attemptId === reviewingAttempt && (
          <ImagePlanPanel
            vault={vault}
            attempt={vault.pendingImagePlan}
            onClose={() => setReviewingAttempt(null)}
          />
        )}

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
        draftCharacter={vault.openConversationId === null ? draftCharacter : null}
      />

      {/* «Usar» pasa por la misma eleccion que el selector, pero solo decide en
          una conversacion NUEVA: en una empezada elige para generar y el
          enganche se pide desde el selector. Sus instrucciones ya no las carga
          la pantalla por su cuenta, las pone main al nacer la conversacion o al
          engancharla (`D-103`) */}
      <GeneratePanel
        vault={vault}
        activeCharacterId={draftCharacter ?? vault.characterId}
        onCharacterReady={(id) => chooseCharacter(id, 'gallery')}
      />

      <MemoryPanel
        vault={vault}
        provider={provider}
        model={model}
        effort={effort}
        project={project}
      />

      <CompatibilityPanel
        vault={vault}
        models={models}
        providers={providers}
        effort={effort}
        project={project}
      />

      {/* el aviso general de la página: recoge lo que no es de ninguna sección
          —enviar, adjuntar, generar— y nada más. Lo que sí tiene dueño se pinta
          donde se pulsó, y repetirlo aquí era lo que llenaba la pantalla del
          mismo texto cuatro o cinco veces */}
      {vault.error !== null && vault.errorArea === null && (
        <Notice tone="fault">{vault.error}</Notice>
      )}

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
          {ownerChange !== undefined && vault.openConversationId !== null && (
            <OwnerChangePanel
              key={`${vault.openConversationId}:${ownerChange.characterId ?? 'soltar'}`}
              vault={vault}
              characterId={ownerChange.characterId}
              project={project}
              scrollOnMount={ownerChange.shown !== true}
              onShown={() =>
                setOwnerChange((previous) =>
                  previous === undefined || previous.shown === true
                    ? previous
                    : { ...previous, shown: true },
                )
              }
              onDone={(text) => {
                if (text !== null && vault.openConversationId !== null) {
                  setOwnerAck({ conversationId: vault.openConversationId, text });
                }
                setOwnerChange(undefined);
              }}
            />
          )}
          {ownerAck !== null && ownerAck.conversationId === vault.openConversationId && (
            <Notice tone="ok">{ownerAck.text}</Notice>
          )}

          <div className="row">
            <CharacterSelector
              vault={vault}
              draftCharacter={draftCharacter}
              disabled={vault.sending || ownerChange !== undefined}
              onChoose={(id) => {
                if (id === null) vault.setComposer({ characterId: null, characterDescription: null });
                else chooseCharacter(id);
              }}
              onUnlink={() => {
                if (vault.openConversationId === null) return;
                setOwnerAck(null);
                setOwnerChange({ conversationId: vault.openConversationId, characterId: null });
              }}
            />
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
            {providerModels.length > 0 ? (
              <Field
                label="Modelo"
                hint="Sin elegir usa el de la conexión, que suele ser el mayor de la familia."
              >
                <select
                  value={model}
                  onChange={(event) => vault.setComposer({ model: event.target.value })}
                >
                  <option value="">por defecto de la conexión</option>
                  {providerModels.map((definition) => (
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
              // que pedir: la lista la ponemos nosotros, con salida a texto libre
              <NativeModelField
                provider={provider}
                value={model}
                onChange={(elegido) => vault.setComposer({ model: elegido })}
              />
            )}
            {/* solo donde significa algo. Una conexion HTTP no tiene donde
                poner esto —el contrato `chat completions` no lo contempla— y
                pintarlo alli seria un mando que no mueve nada */}
            {efforts.length > 0 && (
              <Field
                label="Esfuerzo"
                hint="Cuánto le dejas pensar antes de contestar. Sin elegir usa el suyo, que puede ser caro."
              >
                <select
                  value={effort ?? ''}
                  onChange={(event) =>
                    vault.setComposer({
                      effort: event.target.value === '' ? null : (event.target.value as ReasoningEffort),
                    })
                  }
                >
                  <option value="">el suyo por defecto</option>
                  {efforts.map((nivel) => (
                    <option key={nivel} value={nivel}>
                      {nivel}
                    </option>
                  ))}
                </select>
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

          {suggestedCharacters.length > 0 && (
            <Notice tone="idle">
              {ownerHintQuestion(suggestedCharacters.map((entry) => entry.label))}{' '}
              {suggestedCharacters.length === 1 ? (
                <button
                  className="btn btn--quiet"
                  disabled={vault.sending}
                  onClick={() => chooseCharacter(suggestedCharacters[0]!.characterId)}
                >
                  Sí, es suya
                </button>
              ) : (
                suggestedCharacters.map((entry) => (
                  <button
                    key={entry.characterId}
                    className="btn btn--quiet"
                    disabled={vault.sending}
                    onClick={() => chooseCharacter(entry.characterId)}
                  >
                    Es de {entry.label}
                  </button>
                ))
              )}{' '}
              <button
                className="btn btn--quiet"
                onClick={() => vault.dismissOwnerHint(vault.openConversationId)}
              >
                No, esta no
              </button>
            </Notice>
          )}

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
            <button
              className="btn btn--primary"
              disabled={!canSend}
              onClick={submit}
              title={
                ownerChange !== undefined
                  ? 'Confirma o deja estar el cambio de personaje antes de enviar.'
                  : undefined
              }
            >
              {vault.sending ? 'Esperando respuesta…' : 'Enviar'}
            </button>
            {ownerChange !== undefined && (
              /* el `title` solo no bastaba: tarda en salir y casi nadie lo ve,
                 y Enviar parecia roto (revision del 28/09). La confirmacion
                 esta encima del selector de personaje */
              <p className="field__hint">
                Enviar espera a que confirmes o dejes estar el cambio de personaje,
                encima del selector.
              </p>
            )}
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
            {vault.openConversationId === null && (
              /* estaba explicado sólo en el `title` del navegador, que tarda un
                 segundo en salir y casi nadie llega a ver: el botón parecía roto.
                 Los archivos cuelgan de una conversación, así que hasta que
                 exista no hay dónde guardarlos */
              <p className="field__hint">
                Adjuntar necesita una conversación: envía un mensaje primero. Para
                sólo probar si un modelo sabe mirar una foto, usa{' '}
                <strong>Probar la vista de un modelo</strong>, abajo — eso no
                guarda nada.
              </p>
            )}
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
  // el reparto de ese total se decide fuera del JSX y con pruebas: aqui dentro
  // era una cadena de ternarios que solo se podia comprobar abriendo Luxy, y lo
  // que decide es justo lo delicado —un cero afirma, un silencio no—
  const kudos = useMemo(
    () => (account === null ? null : describeKudosBreakdown(account)),
    [account],
  );

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
          la red te atiende la última. Y sobre compartir, las dos fuentes no
          dicen lo mismo: la <strong>documentación</strong> del horde dice que
          con ella se dona todo lo que generes a un conjunto de datos público,
          mientras que el <strong>código desplegado</strong> descarta esa
          petición. Con una clave propia de aihorde.net —gratis, un minuto— no
          hay esa duda.
        </Notice>
      )}

      {account !== null && kudos !== null && (
        <>
          <Readout
            items={[
              { label: 'Usuario', value: account.username },
              { label: 'Kudos', value: String(account.kudos) },
              { label: 'Peticiones a la vez', value: String(account.concurrency) },
              ...kudos.rows,
            ]}
          />
          {/* las tres frases solo salen cuando hay algo comprobado que decir:
              el desglose puede no venir, y entonces se queda el total de antes */}
          {kudos.floor !== null && <p className="field__hint">{kudos.floor}</p>}
          {kudos.income !== null && <p className="field__hint">{kudos.income}</p>}
          {kudos.spending !== null && <p className="field__hint">{kudos.spending}</p>}
        </>
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
 * qué pasó con la imagen del último turno.
 *
 * Cinco finales distintos y ninguno se puede pintar como otro: esperando una
 * decisión, el bloque llegó roto, falló el proveedor, se reenvió una que ya
 * había, o se generó. Los dos primeros son nuevos y antes eran invisibles —un
 * pendiente no tiene error ni coste, así que caía en «te ha reenviado una que ya
 * tenía», y un bloque cortado salía igual que un turno en el que no pidió nada—.
 *
 * `image.error` se pinta tal cual, así que ahí NUNCA va el texto del prompt: eso
 * sería escribir contenido de la bóveda dentro de un mensaje de error. Lo que se
 * mandó se lee aparte, del registro cifrado, y sólo si se pide.
 */
function ImageOutcome({
  vault,
  image,
  onReview,
}: {
  vault: VaultController;
  image: NonNullable<VaultController['lastImage']>;
  /** abre el panel de revisión de ese intento */
  onReview: (attemptId: string) => void;
}): JSX.Element {
  if (image.state === 'pending') {
    // el plan del hilo NO se guarda en `lastImage`: se lee de `pendingImagePlan`,
    // que sí desaparece al cerrarse la bóveda. Si el registro no llegó a abrir,
    // no hay nada que enseñar y se dice, en vez de un botón que no hace nada
    const pending =
      vault.pendingImagePlan !== null && vault.pendingImagePlan.attemptId === image.attemptId
        ? vault.pendingImagePlan
        : null;
    return (
      <Notice tone="warn">
        Te ofreció una foto y está esperando: el texto ya está compuesto y no ha
        salido de este equipo. Nada se ha generado y nada se ha cobrado.{' '}
        {pending === null ? (
          'No se ha podido leer del registro; vuelve a abrir la conversación.'
        ) : (
          <button className="btn btn--quiet" onClick={() => onReview(pending.attemptId)}>
            Ver lo que se va a mandar
          </button>
        )}
      </Notice>
    );
  }
  if (image.state === 'malformed') {
    // hasta ahora esto no se veia: `parseVaultImageRequest` ya devolvia el
    // motivo y no lo leia nadie, asi que una respuesta cortada a mitad del
    // bloque era indistinguible de un turno en el que no pidio ninguna foto
    return (
      <Notice tone="warn">
        {image.error ?? 'Intentó mandarte una imagen y el bloque no se pudo leer'}. La
        respuesta de texto sí se ha guardado; pídesela otra vez y la escribirá
        entera.
      </Notice>
    );
  }
  if (image.error !== null) {
    return (
      <Notice tone="fault">
        Se pidió una imagen y no pudo generarse: {image.error}. La respuesta de
        texto sí se ha guardado.
        {image.attemptId !== null && (
          <SentPlanDetails vault={vault} attemptId={image.attemptId} />
        )}
      </Notice>
    );
  }
  // reenviar una que ya existía no cuesta créditos, y decirlo importa: es la
  // diferencia entre pagar por una foto nueva y volver a enseñar la de antes.
  // El reenvío NO se reconoce por el precio vacío —una generación cuyo precio
  // calla el servidor también lo trae—, sino por `imageCostOutcome`
  const cost = imageCostOutcome({
    costCredits: image.costCredits,
    costUnit: image.costUnit,
  });
  if (cost.kind === 'resent') {
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
  if (cost.unit === 'kudos') {
    return (
      <Notice tone="ok">
        Imagen generada y cifrada en esta conversación ·{' '}
        {cost.amount === null
          ? 'el servidor no dijo cuántos kudos costó'
          : `${cost.amount} kudos, que no son dinero: sólo tu puesto en la cola`}
        . Aparece abajo, con el resto de archivos.
      </Notice>
    );
  }
  return (
    <Notice tone="ok">
      Imagen generada y cifrada en esta conversación ·{' '}
      {cost.amount === null ? 'sin precio declarado' : `${cost.amount} créditos`}
      . Aparece abajo, con el resto de archivos.
    </Notice>
  );
}

/**
 * lo que se mandó de verdad, para un intento que ya terminó.
 *
 * Plegado y de solo lectura: es lo que contesta «¿por qué me la censuraron?» sin
 * volver a poner delante de los ojos el texto de una escena cada vez que se pasa
 * por el hilo. Se lee del registro cifrado EN CADA apertura porque el hueco del
 * controlador es uno solo —el visor de un archivo usa el mismo—, así que lo que
 * hubiera dentro puede ser ya de otra imagen.
 */
function SentPlanDetails({
  vault,
  attemptId,
}: {
  vault: VaultController;
  attemptId: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  // `null` mientras no se sabe; `true` cuando el registro contestó que ese
  // intento ya no está. Distinguirlo del «todavía cargando» es lo que evita
  // pintar «no está» durante el descifrado
  const [missing, setMissing] = useState<boolean | null>(null);
  // la función, no el controlador: es lo único estable entre renderizados, y
  // leer el intento cambia el estado del controlador
  const { readImageAttempt } = vault;
  const attempt =
    vault.openImageAttempt !== null && vault.openImageAttempt.attemptId === attemptId
      ? vault.openImageAttempt
      : null;

  useEffect(() => {
    // el hueco del controlador es UNO: abrir un archivo en el visor lo ocupa
    // con otro intento. Mientras esto esté desplegado se vuelve a pedir el
    // suyo, salvo que el registro ya haya dicho que no está —eso no cambia
    // por preguntarlo otra vez, y preguntarlo otra vez no acabaría nunca—
    if (!open || attempt !== null || missing === true) return;
    let cancelled = false;
    void readImageAttempt(attemptId).then((ok) => {
      if (!cancelled) setMissing(!ok);
    });
    return () => {
      cancelled = true;
    };
  }, [open, attempt, missing, attemptId, readImageAttempt]);

  return (
    <details
      className="vault-generate"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Ver lo que se mandó</summary>
      {attempt !== null ? (
        <AttemptReadout attempt={attempt} />
      ) : missing === true ? (
        <p className="field__hint">
          Ese intento ya no está en el registro: de cada conversación se guardan
          los últimos, y los fallos muchos más que los que salieron bien.
        </p>
      ) : (
        <Skeleton rows={2} />
      )}
    </details>
  );
}

/**
 * qué se enseña donde no hay dato, que no siempre significa lo mismo.
 *
 * Tres huecos distintos y hasta ahora un solo guion para los tres:
 *
 * - no se sabe (`attribution` a `null`): o el intento se escribió antes de que
 *   esto se apuntara, o falló con la petición ya encolada y nadie contestó.
 *   Decir «no lo hubo» sería inventárselo;
 * - no hubo generación (`absent`): la petición se rechazó antes de encolarse,
 *   y eso es un dato de diagnóstico, no un vacío;
 * - el proveedor no dijo ese campo (`reported`). Incluye al proveedor de pago,
 *   que genera con algún modelo y alguna semilla pero no publica ninguno de
 *   los dos: el silencio es suyo, y la imagen existe.
 *
 * Viene de un bloqueo real: el panel enseñó «Worker —, Modelo —, Semilla no
 * llegó a saberse» y se leyó como que el filtro había juzgado el TEXTO antes de
 * encolar. No decía eso; lo que pasaba es que al fallar no se apuntaba nada.
 */
function missingTrace(attempt: ImageAttempt): string {
  if (attempt.attribution === null) return 'no se apuntó';
  return attempt.attribution === 'absent' ? 'no lo hubo' : 'no lo dijo';
}

/**
 * un intento del registro, entero.
 *
 * Es historia y no se corrige. El texto va detrás de los datos a propósito: para
 * diagnosticar, lo primero que hace falta es el motivo del servidor —`csam` no
 * es lo mismo que `censored`: uno lo decide el propio AI Horde después de
 * generar y el otro el worker que atendió la petición—.
 */
function AttemptReadout({ attempt }: { attempt: ImageAttempt }): JSX.Element {
  const plan = attempt.plan;
  const partido =
    plan !== null && plan.provider === 'horde' ? splitJoinedPrompt(plan.joined) : null;

  return (
    <>
      <Readout
        items={[
          { label: 'Estado', value: IMAGE_ATTEMPT_STATE_LABELS[attempt.state] },
          {
            label: 'Texto',
            value: attempt.source === 'editado' ? 'escrito a mano' : 'compuesto por Luxy',
            tone: attempt.source === 'editado' ? 'warn' : undefined,
          },
          { label: 'Semilla', value: attempt.seed ?? missingTrace(attempt) },
          { label: 'Worker', value: attempt.worker ?? missingTrace(attempt) },
          { label: 'Modelo', value: attempt.model ?? missingTrace(attempt) },
          // sólo cuando lo hay: el nombre lo cambia el voluntario cuando
          // quiere y el identificador no, así que es lo único con lo que se
          // puede decir «otra vez el mismo» dos semanas después
          ...(attempt.workerId === null
            ? []
            : [{ label: 'Id del worker', value: attempt.workerId }]),
          ...(attempt.rc === null
            ? []
            : [{ label: 'Motivo del servidor', value: attempt.rc, tone: 'fault' as const }]),
        ]}
      />
      {attempt.errorMessage !== null && (
        <p className="field__hint">{attempt.errorMessage}</p>
      )}
      {attempt.warnings.map((warning) => (
        <p key={warning.code} className="field__hint">
          <Tag tone="warn">{warning.code}</Tag> {warning.message}
        </p>
      ))}
      {partido !== null && (
        <>
          <p className="vault-media__prompt">{partido.positive}</p>
          {partido.negative !== null && (
            <p className="vault-media__prompt">Negativo: {partido.negative}</p>
          )}
        </>
      )}
      {plan !== null && plan.provider === 'xavira' && (
        <p className="vault-media__prompt">{plan.prompt}</p>
      )}
      {plan === null && (
        <p className="field__hint">
          Este intento no llegó a componer ningún texto, así que no hay nada que
          leer aquí.
        </p>
      )}
    </>
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
function InstructionsPanel({
  vault,
  draft,
  onChange,
  draftCharacter,
}: {
  vault: VaultController;
  draft: string | null;
  onChange: (value: string | null) => void;
  /** el elegido para una conversacion NUEVA, antes de su primer mensaje */
  draftCharacter: string | null;
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

      {/* el campo del identificador ya no existe (`D-103`): el personaje se
          elige con el selector «Personaje», junto al proveedor, y es la unica
          forma de cambiarlo. Aqui solo quedan los avisos de imagen, que
          dependen de el */}
      {imageBlock === 'personaje-desconocido' && (
        <Notice tone="warn">
          El personaje de esta conversación no está en la bóveda de este equipo.
          Mientras siga así, esta conversación no podrá generar ni reenviar
          imágenes, y no se le ofrecerá hacerlo. Para arreglarlo, dalo de alta
          abajo, en «Generar imagen o vídeo», con su mismo identificador
          {characterValue.length === 0 ? '' : ` (${characterValue})`}:
          cambiarla a otro personaje no está disponible.
        </Notice>
      )}
      {/* faltaba, y su ausencia costó una tarde: el motivo se calculaba y se
          tiraba. Un personaje del horde sin clave del horde no pinta nada en
          ninguna de las dos pantallas donde uno miraría —el aviso que sí existe
          vive dentro del desplegable «Crear un personaje gratis», que quien ya
          creó a su personaje no tiene motivo para abrir—, así que el usuario
          pide una foto, el modelo improvisa una excusa en personaje, y nadie
          cuenta que la capacidad ni siquiera se ofreció */}
      {imageBlock === 'sin-clave' && (
        <Notice tone="warn">
          {knownCharacter?.imageProvider === 'horde'
            ? 'Falta la clave de AI Horde, que es quien le hace las fotos a este personaje. Es gratis y sin tarjeta: está más abajo, en «Gratis: AI Horde».'
            : 'Falta la clave de Xavira, que es quien le hace las fotos a este personaje. Está más abajo, en «Generar imagen o vídeo».'}{' '}
          Mientras siga así, esta conversación no podrá generar imágenes y no se
          le ofrecerá hacerlo: si le pides una, se inventará una excusa en vez de
          decirte que no puede.
        </Notice>
      )}
      {vault.characterDescription !== null && (
        <p className="field__hint">
          El modelo sabe que es: <em>{vault.characterDescription}</em>
          {/* la sellada no es la vigente si se edito su ficha: main la cambia en
              el siguiente mensaje y la sella (`D-103`, tercera ronda). Con la
              misma regla que main —con texto y distinta—, para no decirle que
              sigue con la vieja (revision del 28/09) */}
          {draftCharacter === null &&
          knownCharacter !== undefined &&
          knownCharacter.description.trim().length > 0 &&
          knownCharacter.description !== vault.characterDescription
            ? ' Has cambiado su ficha: desde tu próximo mensaje le llega la nueva, y queda guardada en esta conversación.'
            : ''}
        </p>
      )}
    </details>
  );
}

/**
 * la pista del selector en una conversacion nueva. Dice lo que cuesta elegir:
 * se sella en el primer mensaje y la pantalla ya no lo cambia ni lo suelta
 */
const FRESH_CHARACTER_HINT =
  'Elige con quién hablas antes del primer mensaje. Si eliges a alguien, después no se podrá cambiar ni soltar; sus instrucciones se cargan al enviar, salvo que escribas unas propias arriba.';

/**
 * de quien es la conversacion, siempre a la vista junto al proveedor (`D-103`).
 *
 * Cuatro estados y una sola forma de cambiar el dueño: en una conversacion
 * nueva elige quien responde desde el primer mensaje; en una sin dueño elegir
 * abre la confirmacion del enganche; en una que nacio con su personaje no se
 * cambia; y en una enganchada solo se puede soltar.
 */
function CharacterSelector({
  vault,
  draftCharacter,
  disabled,
  onChoose,
  onUnlink,
}: {
  vault: VaultController;
  draftCharacter: string | null;
  disabled: boolean;
  onChoose: (characterId: string | null) => void;
  onUnlink: () => void;
}): JSX.Element {
  const fresh = vault.openConversationId === null;
  const owner = vault.conversationOwner;
  const source = fresh ? 'none' : (owner?.source ?? 'none');
  const ownerId = fresh ? draftCharacter : vault.characterId;
  const known = vault.characters.find((entry) => entry.characterId === ownerId);
  const label = owner?.label ?? known?.label ?? 'su personaje';

  let hint: string;
  // se sella en su primer mensaje y desde la pantalla ya no se cambia ni se
  // suelta: decirlo aqui, que es donde se decide (revision del 28/09). Sus
  // instrucciones las pone main al enviar, salvo que escribas unas propias
  if (fresh) hint = FRESH_CHARACTER_HINT;
  else if (source === 'none') hint = 'Esta conversación no es de nadie. Elige un personaje para engancharla.';
  // `turn` no siempre es haber nacido con el: el campo que habia antes lo
  // fijaba en cualquier mensaje, y decir «nacio con» de esas es falso
  else if (source === 'turn') {
    hint = `${
      owner?.signedAfter === 0 ? `Nació con ${label}` : `Es de ${label} desde uno de sus mensajes`
    }. Cambiarla de personaje no está disponible.`;
  }
  else {
    hint = `Enganchada a ${label}${
      owner?.linkedAt == null ? '' : ` el ${shortDate(owner.linkedAt)}`
    }. Solo en este equipo.`;
  }

  // con dueño se enseña el suyo, aunque ya no este en la boveda
  const orphan = ownerId !== null && known === undefined && !fresh && source !== 'none';
  const value = fresh ? (draftCharacter ?? '') : source === 'none' ? '' : (ownerId ?? '');

  return (
    <Field label="Personaje" hint={hint}>
      <select
        value={value}
        disabled={disabled || (!fresh && source !== 'none')}
        onChange={(event) => onChoose(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">Nadie</option>
        {vault.characters.map((entry) => (
          <option key={entry.characterId} value={entry.characterId}>
            {entry.label.length > 0 ? entry.label : 'Sin nombre'}
          </option>
        ))}
        {orphan && <option value={ownerId}>{`${label} · ya no está en la bóveda`}</option>}
      </select>
      {source === 'link' && (
        <button className="btn btn--quiet" disabled={disabled} onClick={onUnlink}>
          Soltar
        </button>
      )}
    </Field>
  );
}

/**
 * la confirmacion de enganchar o soltar, con el patron de «borrar lo que
 * recuerda»: primero la vista previa que calcula main, despues el texto que
 * sale de ella y solo entonces el boton. Sin vista previa no hay boton que
 * pulsar, porque el texto no podria decir la verdad (`D-093`).
 */
function OwnerChangePanel({
  vault,
  characterId,
  project,
  scrollOnMount,
  onShown,
  onDone,
}: {
  vault: VaultController;
  /** con un personaje es enganchar; con `null`, soltar */
  characterId: string | null;
  project: string;
  /** llevar la vista aqui al montarse: solo la primera vez de cada peticion */
  scrollOnMount: boolean;
  /** avisa de que ya se llevo la vista, para no repetirlo al volver */
  onShown: () => void;
  /** con el acuse si se hizo, o `null` si se dejo estar */
  onDone: (ack: string | null) => void;
}): JSX.Element {
  const [target, setTarget] = useState<string | null>(characterId);
  const [working, setWorking] = useState(false);
  // la vista previa fallo: sin esto el panel se quedaba en «Comprobando…» para
  // siempre, con el boton desactivado y sin decir que no iba a llegar
  const [failed, setFailed] = useState(false);
  // cada «Volver a comprobar» sube este numero y repite el efecto
  const [attempt, setAttempt] = useState(0);
  // `ownerPreviewEpoch` sube cuando se relee la conversacion abierta y con ello
  // se tira la vista previa: sin volver a pedirla, reabrir la misma o
  // «Sincronizar» dejaban el panel en «Comprobando…» para siempre
  const { previewConversationOwner, clearOwnerPreview, ownerPreviewEpoch } = vault;
  useEffect(() => {
    let live = true;
    setFailed(false);
    void previewConversationOwner(target).then((value) => {
      if (live && value === null) setFailed(true);
    });
    return () => {
      live = false;
      clearOwnerPreview();
    };
  }, [target, attempt, ownerPreviewEpoch, previewConversationOwner, clearOwnerPreview]);

  // se abre desde el boton de la cabecera, varias pantallas por encima de donde
  // se pinta: sin llevar la vista, pulsar parecia no hacer nada (revision del
  // 28/09). Es el mismo fallo que ya se corrigio en la galeria y en el horde.
  // Solo al montarse, y solo la primera vez de cada peticion: cambiar de
  // personaje dentro no vuelve a mover la pagina, y volver a esta conversacion
  // desde la lista tampoco. Se leen del primer render a proposito
  const box = useRef<HTMLDivElement | null>(null);
  const firstMount = useRef({ scrollOnMount, onShown });
  useEffect(() => {
    if (!firstMount.current.scrollOnMount) return;
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    firstMount.current.onShown();
  }, []);

  const preview = vault.ownerPreview;
  const linking = target !== null;
  // la ficha, de la lista que ya tiene la pantalla: la vista previa no lo trae.
  // Con `trim`, como el prompt: una ficha de solo espacios no pone «QUIEN ERES»,
  // y decir «te responde con su ficha» seria falso (revision del 28/09)
  const hasDescription =
    (vault.characters.find((entry) => entry.characterId === target)?.description.trim()
      .length ?? 0) > 0;
  const paragraphs =
    preview === null
      ? []
      : linking
        ? describeCharacterLink(preview, { hasDescription })
        : describeCharacterUnlink(preview);

  return (
    <div className="vault-generate" ref={box}>
      {linking && vault.characters.length > 1 && (
        <Field label="¿De quién es?">
          <select
            value={target}
            disabled={working}
            onChange={(event) => setTarget(event.target.value)}
          >
            {vault.characters.map((entry) => (
              <option key={entry.characterId} value={entry.characterId}>
                {entry.label.length > 0 ? entry.label : 'Sin nombre'}
              </option>
            ))}
          </select>
        </Field>
      )}
      {/* el fallo y su pista, aqui y no en el aviso general: la pista es la
          mitad que dice que hacer, y alli no salia */}
      <VaultNotice vault={vault} slots={['enganche']} />
      {preview === null ? (
        working ? (
          // al confirmar, la vista previa se tira antes de que vuelva la lista:
          // sin esto el panel volvia a decir «Comprobando…» con el cambio ya
          // hecho, y parecia que algo habia fallado (revision del 28/09)
          <Notice tone="idle">Aplicando el cambio…</Notice>
        ) : failed ? (
          <div className="row">
            <Notice tone="warn">No se pudo comprobar qué cambiaría, así que no se cambia nada.</Notice>
            <button
              className="btn btn--quiet"
              disabled={working}
              onClick={() => setAttempt((value) => value + 1)}
            >
              Volver a comprobar
            </button>
          </div>
        ) : (
          <Notice tone="idle">Comprobando qué cambiaría…</Notice>
        )
      ) : (
        paragraphs.map((paragraph) => (
          <p key={paragraph} className="field__hint">
            {paragraph}
          </p>
        ))
      )}
      <div className="row">
        <button
          className={linking ? 'btn btn--primary' : 'btn btn--danger'}
          // con un envio en curso main lo rechazaria: la respuesta que llega
          // escribiria despues del ancla sin la ficha
          disabled={preview === null || working || vault.sending || project.length === 0}
          onClick={() => {
            if (preview === null) return;
            const label = preview.characterLabel;
            setWorking(true);
            void vault.setConversationOwner(target, project).then((ok) => {
              setWorking(false);
              if (!ok) return;
              onDone(linking ? `Enganchada a ${label}.` : `Soltada. Ya no es de ${label}.`);
            });
          }}
        >
          {linking ? `Enganchar a ${preview?.characterLabel ?? '…'}` : 'Soltar'}
        </button>
        <button className="btn btn--quiet" disabled={working} onClick={() => onDone(null)}>
          Dejarlo estar
        </button>
      </div>
    </div>
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
  readAvatar,
  characterId,
}: {
  /**
   * la funcion, no el controlador entero: el objeto de `useVault` es nuevo en
   * cada render, y con el en las dependencias este efecto releia la foto cada
   * 5 s. Eso mantuvo la boveda abierta hora y media sin nadie delante (`D-106`)
   */
  readAvatar: VaultController['readCharacterAvatar'];
  characterId: string;
}): JSX.Element | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void readAvatar(characterId).then((value) => {
      if (vivo) setDataUrl(value);
    });
    return () => {
      vivo = false;
    };
  }, [readAvatar, characterId]);

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
        <CharacterAvatar readAvatar={vault.readCharacterAvatar} characterId={character.characterId} />
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

      {/* va por PERSONAJE y no por máquina: pararse a leer el texto en cada foto
          tiene sentido con quien sale raro y estorba con quien sale bien. Nace
          puesto, y quitarlo devuelve el comportamiento de antes en una pulsación */}
      <label className="check">
        <input
          type="checkbox"
          checked={character.imageReview === 'siempre'}
          onChange={(event) =>
            void vault.setCharacterImageReview(
              character.characterId,
              event.target.checked ? 'siempre' : 'nunca',
            )
          }
        />
        <span>
          Revisar el prompt antes de generar
          <small>
            {character.imageReview === 'siempre'
              ? 'la foto que ofrezca espera a que la mires; nada se genera ni se cobra hasta entonces'
              : 'se genera de una vez, sin enseñarte antes lo que sale hacia el proveedor'}
          </small>
        </span>
      </label>

      {/* sólo cambia las escenas en las que salís los dos; el resto se pide
          igual que siempre. Existe porque estos modelos encajan dos figuras de
          forma irregular, y apagarlo devuelve el comportamiento de antes */}
      <label className="check">
        <input
          type="checkbox"
          checked={character.imageCast === 'both'}
          onChange={(event) =>
            void vault.setCharacterImageCast(
              character.characterId,
              event.target.checked ? 'both' : 'character-only',
            )
          }
        />
        <span>
          Dibujar las escenas en las que salís los dos
          <small>
            {character.imageCast === 'both'
              ? 'sólo afecta a esas escenas; con dos figuras estos modelos fallan a menudo la anatomía, así que apágalo si sale mal'
              : 'sólo afecta a esas escenas: se pide únicamente al personaje, en plano cercano y sin ti'}
          </small>
        </span>
      </label>

      {/* D-102. Dice lo que PIDE, no lo que consigue (D-093): que funcione no
          está medido. La línea «copia de sus respuestas» del registro solo ve
          copias palabra por palabra, así que con la nota de forma encendida puede
          bajar aunque la plantilla siga con otras palabras: hay que leer respuestas.
          Apagada, ESTA casilla no añade nada; no se dice «el prompt de siempre»
          porque otras casillas y la ficha editada también lo cambian */}
      <label className="check">
        <input
          type="checkbox"
          checked={character.replyGuidance === 'vary-and-lead'}
          onChange={(event) =>
            void vault.setCharacterReplyGuidance(
              character.characterId,
              event.target.checked ? 'vary-and-lead' : 'none',
            )
          }
        />
        <span>
          Pedirle que varíe la forma y ponga su parte
          <small>
            {character.replyGuidance === 'vary-and-lead'
              ? 'le pide no reutilizar entradas, gestos ni cierres de sus respuestas anteriores y que decida cuando le cedes la decisión; no está medido que funcione, y se apaga aquí'
              : 'apagada, esta casilla no añade nada al prompt'}
          </small>
        </span>
      </label>

      {/* D-104. Dice lo que PIDE y cuándo puede llegarle la lista, no que deje de
          repetirse (D-093): no está medido. «Parece» va a propósito: si tu
          mensaje nombra un pendiente, y si ella ya sacó uno, lo decide un
          comparador de palabras que se equivoca en los dos sentidos. Apagada,
          ESTA casilla no añade nada; decia «exactamente como siempre» y no lo
          era: con la casilla del resumen (D-105) encendida cambia la
          regla del bloque de pendientes (revision del 28/09) */}
      <label className="check">
        <input
          type="checkbox"
          checked={character.pendingPacing === 'sparse'}
          onChange={(event) =>
            void vault.setCharacterPendingPacing(
              character.characterId,
              event.target.checked ? 'sparse' : 'per-note',
            )
          }
        />
        <span>
          Sacar los pendientes solo de vez en cuando
          <small>
            {character.pendingPacing === 'sparse'
              ? 'la lista de pendientes solo puede llegarle en tu primer mensaje de la conversación y luego en uno de cada cuatro, salvo el que tu mensaje parezca nombrar; le pide sacarlos solo si la escena los trae y, si en sus últimas respuestas parece haber sacado uno que no has retomado, se lo recuerda sin decir cuál. No está medido que funcione, y se apaga aquí'
              : 'apagada, esta casilla no añade nada al prompt'}
          </small>
        </span>
      </label>

      {/* D-105. Dice lo que se le PASA y lo que no está garantizado (D-093): el
          resumen lo escribió el modelo y puede no llevar lo acordado, y la guía
          de campos solo mejora las memorias que se escriban a partir de ahora.
          Apagada, ESTA casilla no añade nada al prompt */}
      <label className="check">
        <input
          type="checkbox"
          checked={character.recentMemories === 'recent-two'}
          onChange={(event) =>
            void vault.setCharacterRecentMemories(
              character.characterId,
              event.target.checked ? 'recent-two' : 'off',
            )
          }
        />
        <span>
          {RECENT_MEMORIES_CHECKBOX}
          <small>
            {character.recentMemories === 'recent-two'
              ? 'en cada mensaje le llega un resumen corto de sus dos conversaciones más recientes, sin la de ahora; las más antiguas no entran. Solo de las que tengan memoria apuntada o una ficha de «Memoria de lo ya hablado» aprobada y al día: una sin ninguna de las dos se salta y no se cambia por otra, así que puede no llegarle nada. Lo escribió el modelo en cada una y puede no incluir todo lo acordado; las que enganchaste se resumieron sin su ficha. Mientras esté encendida, también le pide apuntar aparte lo acordado en la memoria. Se apaga aquí'
              : 'apagada, esta casilla no añade nada al prompt'}
          </small>
        </span>
      </label>

      {active ? (
        <Tag tone="ok">en uso</Tag>
      ) : (
        <button className="btn btn--quiet" onClick={onPick}>
          Usar
        </button>
      )}

      {/* corregir el aspecto del horde es gratis y se puede repetir; el de
          Xavira lo decide el al crearlo y despues no se puede cambiar.
          Y se DICE de cual: un personaje con las dos identidades tiene dos
          aspectos, el formulario de Xavira esta justo debajo en la misma
          pantalla, y «Editar su aspecto» a secas se leia como el de Xavira */}
      {character.horde !== null && (
        <button className="btn btn--quiet" onClick={onEditHorde}>
          Editar su aspecto en AI Horde
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
  const [shared, setShared] = useState(base?.shared ?? false);
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
    shared,
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
        hint="Marcar varios de la MISMA familia suma sus workers y acorta la espera; no cuesta kudos de más."
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

      {/* mezclar familias es el fallo que la propia pantalla invitaba a cometer
          —«marcar varios acorta la espera»— y su sintoma no se parece a un
          fallo: sale una imagen, pero de otra persona */}
      {mixedBaselineWarning(models) !== null && (
        <Notice tone="warn">{mixedBaselineWarning(models)}</Notice>
      )}

      {/* Pony sin sus `score_` no da error: devuelve imágenes genéricas que
          ignoran media escena, y eso se confunde con «el prompt no se
          entendió». Pasó con un desnudo en un baño que volvió como retrato de
          busto, vestida y sobre fondo blanco */}
      {qualityPrefixWarning(models, appearance) !== null && (
        <Notice tone="warn">{qualityPrefixWarning(models, appearance)}</Notice>
      )}

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

      {/* el motivo, junto al botón que lo provocó. La consulta puede fallar
          —red caída, clave mala— y el único aviso de la pantalla se pinta al
          final de la página: desde aquí no se ve, y lo que quedaba era un botón
          que no parecía hacer nada.
          SÓLO el suyo: sin el dueño, un fallo cualquiera del controlador se
          pintaba a la vez aquí, en el panel de personajes, en el de memoria y
          al final de la página, cuatro recuadros rojos idénticos */}
      <VaultNotice vault={vault} slots={['disponibilidad']} />

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

      {/* la casilla decía «a cambio de kudos» y eso era FALSO. Comprobado
          contra su código: (1) desde julio de 2023 el Horde descarta la
          petición de compartir en todos los modelos menos uno de Stability,
          que sigue siendo la única excepción de ese `else` y que Luxy no
          comprueba al generar; (2) compartir nunca fue un ingreso, era un
          descuento de 2 kudos sobre esa misma imagen, y también está apagado.
          La casilla se queda porque el mecanismo puede volver y quitar una
          opción es perder función, pero su texto sólo dice lo que se ha
          verificado. Va por personaje y no por máquina porque uno puede ser
          anodino y otro no */}
      <label className="check">
        <input
          type="checkbox"
          checked={shared}
          disabled={saving}
          onChange={(event) => setShared(event.target.checked)}
        />
        Donar sus imágenes a AI Horde (hoy el servidor casi siempre lo ignora)
      </label>
      <p className="field__hint">
        <strong>Marcarla casi nunca hace nada</strong>: AI Horde descarta esta
        petición en todos los modelos menos uno de Stability
        (<code>SDXL_beta::stability.ai#6901</code>), esté marcada o no. Tampoco
        da kudos, y nunca los dio: era un descuento de 2 kudos sobre esa misma
        imagen, y ese descuento también está apagado. Si volviera a funcionar,
        lo que se cedería sería la imagen <strong>y el texto completo de lo que
        se pidió</strong>, y no se ha encontrado forma de retirarlo después.
      </p>

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
  // el campo empieza con el personaje de la conversacion.
  //
  // Antes empezaba vacio y la UNICA forma de rellenarlo era el boton «Usar» de
  // la lista, que no aparece justamente en quien YA esta en uso: para generarle
  // una imagen al personaje con el que estabas hablando habia que copiar su
  // identificador a mano del campo de arriba. Es lo primero que se quiere hacer
  // y era lo unico que no se podia.
  //
  // No pisa lo escrito: solo rellena si esta vacio, porque generar para OTRO
  // personaje sigue siendo legitimo.
  useEffect(() => {
    if (activeCharacterId === null || activeCharacterId.length === 0) return;
    setCharacterId((previo) => (previo.length === 0 ? activeCharacterId : previo));
  }, [activeCharacterId]);
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
  // el formulario del horde vive ENCIMA de la lista de personajes, y su boton
  // «Editar su aspecto» esta DENTRO de la lista. Pulsarlo lo desplegaba fuera
  // de la pantalla, hacia arriba: no pasaba nada donde estabas mirando. Daniel
  // bajo buscandolo y se encontro el formulario de Xavira, que si esta debajo,
  // y creyo que el boton llevaba al proveedor equivocado
  const hordeForm = useRef<HTMLDetailsElement | null>(null);
  const [scrollToHorde, setScrollToHorde] = useState(false);
  useEffect(() => {
    if (!scrollToHorde) return;
    setScrollToHorde(false);
    hordeForm.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollToHorde]);
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
        ref={hordeForm}
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

      {/* aquí y no sólo al final de la página: el único aviso de la pantalla se
          pinta DESPUÉS de este panel, del de memoria y del de compatibilidad, o
          sea a varias pantallas de scroll de la «×» de olvidar un personaje y
          de «Ver disponibilidad». Un error que no se ve desde donde se pulsa se
          lee igual que un botón que no hizo nada.
          Lo de «Ver disponibilidad» tiene su propio aviso DENTRO del formulario
          y sólo se recoge aquí cuando ese formulario está plegado: si no, el
          motivo se quedaría en un panel cerrado y no lo vería nadie */}
      <VaultNotice
        vault={vault}
        slots={hordeFormOpen ? ['personajes'] : ['personajes', 'disponibilidad']}
      />

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
                  // y llevar la vista hasta el: se despliega mas arriba de
                  // donde esta el boton, asi que sin esto no se ve nada
                  setScrollToHorde(true);
                }}
              />
            ))}
          </div>
          <p className="field__hint">
            Tus personajes guardados. Pulsa <strong>Usar</strong> para elegirlo:
            en una conversación nueva será quien responda desde el primer
            mensaje; en una que ya ha empezado, solo lo elige para generar
            imágenes. Para que una conversación sin personaje pase a ser suya,
            usa <strong>Enganchar a un personaje</strong>, arriba. Cada
            uno enseña qué sabe hacer —quién puede hacerle
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

      {vault.generating && vault.hordeProgress === null && (
        <p className="field__hint">
          Un vídeo puede tardar minutos. Luxy pregunta al proveedor cada pocos
          segundos hasta que termina.
        </p>
      )}

      {/* la cola de AI Horde, en cuanto se sabe. Antes eran diez minutos en
          blanco seguidos de «no estuvo lista a tiempo», que no distingue estar
          el 300º de la cola de que nadie sirva tus modelos */}
      {vault.hordeProgress !== null && (
        <HordeQueueNotice progress={vault.hordeProgress} />
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
 * banco de pruebas de visión.
 *
 * POR QUÉ EXISTE, con las palabras de Daniel: «necesitamos un sitio en Privado
 * que permita hacer pruebas para pasarle fotos y que nos devuelva las
 * descripciones». Antes, para averiguar si un modelo sabe mirar había que
 * adjuntar una imagen a una conversación —lo que obligaba a crear una— y pedir
 * la descripción sobre contenido de la bóveda.
 *
 * Tiene **su propio proveedor y su propio modelo**, aparte de los de la
 * conversación. Ése era el problema de fondo: el selector era el mismo, así que
 * elegir un modelo con vista cambiaba también quién encarna al personaje.
 *
 * No guarda nada: ni en la bóveda, ni en la conversación, ni como pie de foto.
 */
function VisionBench({
  vault,
  providers,
  models,
  project,
  conversationProvider,
}: {
  vault: VaultController;
  providers: string[];
  models: ModelDefinition[];
  project: string;
  /** el de la conversación, sólo como punto de partida razonable */
  conversationProvider: string;
}): JSX.Element {
  // vive en el compositor y no aquí: el mismo modelo que se prueba es el que
  // usa después «Describir con IA» sobre los archivos guardados, y una
  // preferencia que se pierde al cambiar de panel no sirve para eso
  const provider = vault.composer.visionProvider;
  const model = vault.composer.visionModel ?? '';
  const setProvider = (value: string): void =>
    vault.setComposer({ visionProvider: value, visionModel: null });
  const setModel = (value: string): void =>
    vault.setComposer({ visionModel: value.length === 0 ? null : value });
  const elegido = provider ?? conversationProvider;
  const providerModels = modelsForProvider(models, elegido, providers) as ModelDefinition[];
  // un modelo que ejecuta OTRO proveedor no existe para este: mandarlo gasta la
  // llamada y devuelve `unrecognized_model`
  const modelo =
    modelForProvider(models, elegido, model.length === 0 ? null : model, providers) ?? '';

  // misma regla que en la conversacion: la lista depende del modelo, y un
  // esfuerzo que deje de estar soportado se suelta en vez de viajar y fallar
  const efforts = effortsFor(elegido, modelo.length === 0 ? null : modelo);
  const elegidoEffort = vault.composer.visionEffort;
  const effort = elegidoEffort !== null && efforts.includes(elegidoEffort) ? elegidoEffort : null;

  return (
    <Panel
      title="Probar la vista de un modelo"
      actions={
        vault.probes.length > 0 && (
          <button className="btn btn--quiet" onClick={vault.clearProbes}>
            Limpiar
          </button>
        )
      }
    >
      <p className="page__lede">
        Elige una imagen de tu disco y mira qué dice de ella. <strong>No se guarda
        nada</strong>: ni en la bóveda, ni en la conversación, ni como pie de
        foto. Sirve para saber si un modelo sabe mirar antes de gastar una
        llamada sobre algo tuyo.
      </p>

      <div className="row">
        <Field label="Proveedor">
          <select value={elegido} onChange={(event) => {
            setProvider(event.target.value);
            // el modelo se suelta al cambiar de proveedor: uno de otra familia
            // no existe para el nuevo
            setModel('');
          }}>
            {providers.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </Field>
        {providerModels.length > 0 ? (
          <Field
            label="Modelo"
            hint="Los marcados «ve imágenes» son los que la conexión declara con vista."
          >
            <select value={modelo} onChange={(event) => setModel(event.target.value)}>
              <option value="">por defecto de la conexión</option>
              {providerModels.map((definition) => (
                <option key={definition.id} value={definition.apiModel}>
                  {definition.displayName}
                  {definition.capabilities.includes('image_input') ? ' · ve imágenes' : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          // aqui no habia ni sugerencias: era una caja de texto a secas para un
          // nombre que hay que saberse de memoria
          <NativeModelField provider={elegido} value={model} onChange={setModel} />
        )}
        {/* el banco existe para COMPARAR: sin fijar el esfuerzo, dos pruebas
            pueden diferir por el modelo o por lo que se le dejo pensar, y no
            hay forma de saber cual de las dos cosas fue */}
        {efforts.length > 0 && (
          <Field label="Esfuerzo" hint="Cuánto le dejas pensar. Sin elegir usa el suyo.">
            <select
              value={effort ?? ''}
              onChange={(event) =>
                vault.setComposer({
                  visionEffort:
                    event.target.value === '' ? null : (event.target.value as ReasoningEffort),
                })
              }
            >
              <option value="">el suyo por defecto</option>
              {efforts.map((nivel) => (
                <option key={nivel} value={nivel}>
                  {nivel}
                </option>
              ))}
            </select>
          </Field>
        )}
        <button
          className="btn btn--primary"
          disabled={vault.probingVision || project.length === 0}
          onClick={() => {
            void vault.probeVision({
              provider: elegido,
              model: modelo.length === 0 ? null : modelo,
              effort,
              projectAlias: project,
            });
          }}
        >
          {vault.probingVision ? 'Mirando…' : 'Elegir una imagen y probar'}
        </button>
      </div>

      {/* las últimas pruebas, la más reciente arriba.
          Antes sólo se guardaba la última, y con eso el banco no servía para lo
          que existe: Claude describió una imagen y el 429 de Mistral, treinta y
          dos segundos después, se llevó esa descripción de la pantalla sin que
          se llegara a leer. */}
      {vault.probes.map((probe) => (
        /* la clave es el identificador de la prueba, no su posicion: al poder
           cerrar una del medio, con la posicion React reutilizaba el recuadro y
           enseñaba la imagen de una prueba con el texto de otra */
        <div className="vision-probe" key={probe.id}>
          {/* se van acumulando, y lo que se acumula son imagenes descifradas en
              la pantalla. El tope de cuatro acaba echandolas, pero «acaba»
              puede ser dentro de un rato: la que ya has mirado se cierra */}
          <button
            className="vision-probe__close"
            title="Cerrar esta prueba"
            aria-label="Cerrar esta prueba"
            onClick={() => vault.dismissProbe(probe.id)}
          >
            ×
          </button>
          {probe.dataUrl !== null && (
            <img className="vision-probe__image" src={probe.dataUrl} alt="" />
          )}
          <div className="vision-probe__text">
            <p className="field__hint">
              {probe.fileName} · {Math.round(probe.byteSize / 1024)} KB
              {probe.executedModel === null ? '' : ` · respondió ${probe.executedModel}`}
            </p>
            {probe.caption !== null && <p className="vault-media__caption">{probe.caption}</p>}
            {probe.reasoning !== null && (
              /* lo que penso antes de contestar. Va PLEGADO y aparte: explica
                 una descripcion rara —que es cuando de verdad hace falta— pero
                 no es la descripcion, y no se guarda en ningun sitio */
              <details className="vision-probe__reasoning">
                <summary>Lo que pensó antes de responder</summary>
                <p>{probe.reasoning}</p>
              </details>
            )}
            {probe.failure === 'negativa' && (
              <Notice tone="warn">
                Ese modelo se negó a describir la imagen. Repetirlo no lo arregla:
                prueba con otro.
              </Notice>
            )}
            {probe.failure === 'solo-razono' && (
              /* razono pero nunca contesto: agoto el limite de salida
                 pensando. Distinto de «no contesto nada», y se arregla
                 distinto: aqui el modelo SI vio la imagen */
              <Notice tone="warn">
                Se quedó pensando y se le acabó el espacio: analizó la imagen
                pero nunca llegó a escribir la descripción. <strong>Sí la vio</strong>
                {' '}— lo tienes abajo. Prueba con otro modelo que delibere menos.{' '}
                {/* decia «o sube el limite de salida de esa conexion», y el
                    describidor ya no usa el de la conexion: pide el suyo */}
                Subir el límite de la conexión no ayuda: el describidor pide lo
                suyo.
              </Notice>
            )}
            {probe.failure === 'vacio' && (
              <Notice tone="warn">
                No contestó nada. Puede que no sepa mirar imágenes, o que se le
                haya atragantado ésta: vuelve a intentarlo antes de descartarlo.
              </Notice>
            )}
            {probe.failure === 'fallo' && (
              /* distinto de «no contestó»: la llamada no llegó a completarse,
                 así que repetirla igual no va a cambiar nada */
              <Notice tone="fault">
                La llamada falló: {probe.error}
                <br />
                No es que el modelo no supiera describirla. Repetir lo mismo no
                lo arregla.
              </Notice>
            )}
            {probe.failure === 'sin-imagen' && (
              /* el caso que estuvo pasando por bueno: el modelo contesta con una
                 frase perfecta diciendo que no le ha llegado nada. Como pie de
                 foto habría hecho creer al personaje que la imagen ES esa frase */
              <Notice tone="fault">
                Ese modelo contestó que <strong>no le llegó ninguna imagen</strong>.
                Los proveedores locales —Claude Code y Codex— reciben el texto por
                la consola y no tienen por dónde mandar una foto. Necesitas un
                proveedor <strong>HTTP</strong> con un modelo que sepa mirar.
              </Notice>
            )}
          </div>
        </div>
      ))}
    </Panel>
  );
}

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
/**
 * como va la cola de AI Horde mientras se espera.
 *
 * Existe porque el fallo mas caro de este proveedor no es que falle: es que
 * tarda diez minutos sin decir nada y luego dice «no estuvo lista a tiempo».
 * Con el puesto delante, esa espera deja de ser un misterio y se convierte en
 * una decision: esperar, o cambiar de modelo.
 *
 * El tono NO es de aviso mientras avanza: estar en cola es lo normal en una red
 * de voluntarios. Solo se pone serio cuando el propio horde dice que hoy nadie
 * puede hacerlo.
 */
function HordeQueueNotice({ progress }: { progress: HordeQueueProgress }): JSX.Element {
  const dibujando = progress.processing > 0;
  return (
    <Notice tone={dibujando ? 'ok' : 'idle'}>
      {describeQueue(progress)}
      {!dibujando && (
        <>
          {' '}
          En AI Horde el puesto lo deciden tus <strong>kudos</strong>: se
          acumulan solos y suben si prestas tu GPU. Marcar varios modelos de la
          misma familia suma sus workers y acorta la espera.
        </>
      )}
    </Notice>
  );
}


function MediaGallery({
  vault,
  provider,
  model,
  effort,
  project,
}: {
  vault: VaultController;
  /* el mismo proveedor, modelo y proyecto que ya estan elegidos arriba: pedir
     una descripcion es otra llamada a lo mismo, no una conexion aparte */
  provider: string;
  model: string;
  /** el de la conversacion; describir una foto usa el de vision, que es otro */
  effort: ReasoningEffort | null;
  project: string;
}): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = vault.media.find((item) => item.mediaId === openId) ?? null;

  const imagenes = vault.media.filter((item) => !item.mimeType.startsWith('video/')).length;
  const videos = vault.media.length - imagenes;

  return (
    <>
      {/* PLEGADA, y sin `open`. El avatar del personaje se copia a cada
          conversacion suya para que pueda reenviarlo, asi que la galeria nunca
          esta vacia: su foto de perfil quedaba a la vista en todos los hilos
          como si fuera contenido de esa conversacion. */}
      <details className="vault-generate">
        <summary>
          Archivos de esta conversación ·{' '}
          {[
            imagenes > 0 ? `${imagenes} imagen${imagenes === 1 ? '' : 'es'}` : null,
            videos > 0 ? `${videos} vídeo${videos === 1 ? '' : 's'}` : null,
          ]
            .filter((parte) => parte !== null)
            .join(' · ')}
        </summary>

        <div className="vault-gallery">
          {vault.media.map((item) => (
            <GalleryEntry key={item.mediaId} item={item} onOpen={() => setOpenId(item.mediaId)} />
          ))}
        </div>
      </details>

      {open !== null && (
        <MediaViewer
          item={open}
          vault={vault}
          provider={provider}
          model={model}
          effort={effort}
          project={project}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

/**
 * una entrada de la lista de archivos.
 *
 * NO descifra ni pinta la imagen: solo dice lo que hay. La imagen se ve al
 * pulsarla, en el visor.
 *
 * Antes era una baldosa con miniatura, y eso obligaba a descifrar el archivo
 * ENTERO para pintar un cuadro de 128 px —no hay miniaturas guardadas, y no
 * puede haberlas: `nativeImage` no decodifica webp (`D-069`)—. Abrir la galeria
 * descifraba de golpe todo lo que entrara en pantalla. Aqui no se lee ni un
 * byte hasta que se pulsa.
 */
function GalleryEntry({
  item,
  onOpen,
}: {
  item: VaultController['media'][number];
  onOpen: () => void;
}): JSX.Element {
  const isVideo = item.mimeType.startsWith('video/');
  const caption = item.caption ?? '';
  const name = item.displayName ?? item.mediaId.slice(0, 8);

  return (
    <button className="vault-gallery__entry" onClick={onOpen}>
      <span className="vault-gallery__entry-head">
        <Tag tone="idle">{isVideo ? 'vídeo' : 'imagen'}</Tag>
        <span className="vault-gallery__entry-name">{name}</span>
        {/* decirlo AQUI y no al abrirla: pulsar para encontrarse un hueco es
            peor que saber antes que ese archivo no se va a poder mirar */}
        {!item.previewable && <span className="field__hint">demasiado grande</span>}
      </span>
      <span className="vault-gallery__foot">
        {caption.length > 0 ? (
          caption
        ) : (
          /* sin pie de foto el modelo no sabe que hay aqui y acaba pagando otra
             generacion: se marca en la propia entrada, no en un aviso aparte */
          <em className="vault-gallery__missing">sin pie de foto</em>
        )}
      </span>
    </button>
  );
}

/**
 * de donde salio este archivo, en solo lectura.
 *
 * Lo que se PIDIO no es lo que se VE, y verlos juntos es justo lo que explica
 * una imagen que no salio como se esperaba. Dos cosas cambian respecto a la
 * linea de antes:
 *
 * - el prompt se parte por su separador. AI Horde no tiene campo de negativo y
 *   lo lee del propio texto, asi que en disco los dos estan pegados; leidos de
 *   una pieza, lo que se pidio y lo que se prohibio parecian lo mismo.
 * - si el medio trae intento, se leen del registro cifrado la SEMILLA que uso de
 *   verdad y el worker que lo dibujo. Ninguna de las dos esta guardada con el
 *   archivo, y sin ellas «la misma semilla me da caras distintas» no se puede ni
 *   empezar a mirar —la receta suele no fijar semilla, asi que el servidor
 *   sortea una en cada generacion—.
 *
 * Es historia: no se corrige nada de aqui.
 */
function MediaOrigin({
  item,
  vault,
}: {
  item: VaultController['media'][number];
  vault: VaultController;
}): JSX.Element | null {
  const attemptId = item.attemptId;
  // la FUNCION, no el controlador entero: el controlador es un objeto nuevo en
  // cada renderizado, y leer el intento cambia su estado. Con `vault` en las
  // dependencias, cada lectura provocaria otra lectura y el bucle no pararia
  const { readImageAttempt } = vault;

  // lo poco que se pinta aquí, copiado en cuanto se lee: el hueco del
  // controlador es UNO y el desplegable «Ver lo que se mandó» de un fallo vuelve
  // a pedir el suyo en cuanto se lo quitan. Ver `imageOriginSnapshot`
  const [origin, setOrigin] = useState<ImageOrigin | null>(null);
  const shared = vault.openImageAttempt;

  useEffect(() => {
    // solo cuando hay algo que leer: descifrar el registro para un archivo
    // adjuntado a mano no devolveria nada
    if (attemptId === null) return;
    void readImageAttempt(attemptId);
  }, [attemptId, readImageAttempt]);

  useEffect(() => {
    setOrigin((previous) => imageOriginSnapshot(previous, { attemptId, shared }));
  }, [attemptId, shared]);

  const prompt = item.prompt;
  if ((prompt === null || prompt.length === 0) && origin === null) return null;
  const partido = prompt === null || prompt.length === 0 ? null : splitJoinedPrompt(prompt);

  return (
    <>
      {partido !== null && (
        <p className="vault-media__prompt">
          Se pidió al generarla: «{partido.positive}»
          {/* y QUIEN la dibujo. Con varios modelos en la receta la coge el
              que esté libre, y cada uno da otra cara: sin esto, dos imágenes
              de la misma semilla salen distintas y no hay por dónde empezar */}
          {item.model !== null && item.model.length > 0 && (
            <>
              {' · la dibujó '}
              <strong>{item.model}</strong>
            </>
          )}
        </p>
      )}
      {partido !== null && partido.negative !== null && (
        <p className="vault-media__prompt">Y se pidió evitar: «{partido.negative}»</p>
      )}
      {origin !== null && (origin.seed !== null || origin.worker !== null) && (
        <Readout
          items={[
            { label: 'Semilla', value: origin.seed ?? 'no la devolvió' },
            { label: 'Worker', value: origin.worker ?? 'no lo devolvió' },
          ]}
        />
      )}
    </>
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
  effort,
  project,
  onClose,
}: {
  item: VaultController['media'][number];
  vault: VaultController;
  provider: string;
  model: string;
  /** el de la CONVERSACION; el de mirar es otro y sale de `vision` */
  effort: ReasoningEffort | null;
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
  // lo que penso el modelo en la ultima descripcion; efimero a proposito
  const [reasoning, setReasoning] = useState<string | null>(null);
  // el fallo del reformulador va APARTE del de la descripcion: los avisos de
  // aquella hablan de mirar la imagen —«se nego a describirla», «la vio, le
  // falto sitio»— y al reformulador no se le manda ninguna. Reaprovechar el
  // aviso habria contado una historia falsa sobre lo que acababa de pasar
  const [rewriteFailure, setRewriteFailure] = useState<string | null>(null);

  // de la funcion y no del objeto `vault`, que es nuevo en cada render: con el
  // en las dependencias, el visor volvia a descifrar la imagen cada 5 s (`D-106`)
  const { openMedia } = vault;
  useEffect(() => {
    let cancelled = false;
    void openMedia(item.mediaId).then((url) => {
      if (cancelled) return;
      if (url === null) setTooBig(true);
      else setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [item.mediaId, openMedia]);

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
  const visionProvider = vault.composer.visionProvider ?? provider;
  const visionModel = vault.composer.visionModel ?? (model.length === 0 ? null : model);
  const visionEfforts = effortsFor(visionProvider, visionModel);
  const visionElegido = vault.composer.visionEffort;
  const visionEffort =
    visionElegido !== null && visionEfforts.includes(visionElegido) ? visionElegido : null;
  const editing = draft !== null;
  // quién mira, que no tiene por qué ser quién conversa. Sin elegir en el banco
  // de pruebas se usa el de la conversación, como toda la vida
  const vision = {
    provider: vault.composer.visionProvider ?? provider,
    model: vault.composer.visionModel ?? (model.length === 0 ? null : model),
    // el de mirar, no el de conversar. Si el elegido no lo acepta este modelo,
    // se suelta: mandarlo no lo recortaria, fallaria cobrando igual
    effort: visionEffort,
  };
  const chosen = vision.model ?? vision.provider;

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

        <MediaOrigin item={item} vault={vault} />

        {editing ? (
          <div className="vault-caption-edit">
            {/* era un `input` de una sola linea para un texto que llega a 3.000
                caracteres: el cursor saltaba al principio y no habia forma de
                ver lo que se estaba corrigiendo. Corregir un pie de foto es
                leerlo entero contra la imagen, asi que necesita caja */}
            <textarea
              className="vault-caption"
              rows={10}
              value={draft}
              placeholder="Qué se ve en este archivo…"
              // tambien mientras reescribe: lo que devuelva pisa el borrador, y
              // dejar escribir encima seria perder lo tecleado a mitad
              disabled={saving || vault.rewritingCaption}
              onChange={(event) => setDraft(event.target.value)}
            />
            <p className="field__hint">
              {draft.length} de {MAX_CAPTION_CHARS} caracteres. Es lo único que el
              modelo sabrá de este archivo, así que lo que escribas aquí lo dará
              por cierto.
            </p>
            <div className="row">
              <button
                className="btn btn--primary"
                disabled={saving || vault.rewritingCaption}
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
              <button
                className="btn btn--quiet"
                disabled={saving || vault.rewritingCaption || draft.trim().length === 0}
                onClick={() => {
                  setRewriteFailure(null);
                  void vault
                    .rewriteCaption({
                      caption: draft.trim(),
                      // el de la CONVERSACIÓN, no el de visión: aquí no hay nada
                      // que mirar, es texto. Y quien mira bien no es quien
                      // escribe bien: los modelos con vista disponibles ven
                      // estupendamente y redactan fatal, que es justo el problema
                      // que este botón viene a arreglar
                      provider,
                      model: model.length === 0 ? null : model,
                      effort,
                      projectAlias: project,
                    })
                    // vuelve al BORRADOR, no al pie de foto guardado: se lee al
                    // lado de la imagen y se guarda —o no— a mano
                    .then((result) => {
                      setRewriteFailure(result.failure);
                      setReasoning(result.reasoning);
                      if (result.caption !== null) setDraft(result.caption);
                    });
                }}
              >
                {vault.rewritingCaption ? 'Reescribiendo…' : 'Mejorar el español'}
              </button>
              <button
                className="btn btn--quiet"
                disabled={saving || vault.rewritingCaption}
                onClick={() => setDraft(null)}
              >
                Cancelar
              </button>
            </div>
            <p className="field__hint">
              <strong>Mejorar el español</strong> gasta una llamada a{' '}
              <Tag tone="idle">{model.length === 0 ? provider : model}</Tag> y solo
              le manda <strong>este texto</strong>, no la imagen: arregla la
              redacción y no puede añadir nada, porque no ve nada. Lo que
              devuelva cae aquí para que lo leas contra la foto antes de
              guardarlo.
            </p>

            {rewriteFailure === 'negativa' && (
              <Notice tone="warn">
                Ese modelo se negó a reescribirlo. Pasa con los pies de foto
                explícitos, y repetirlo no lo arregla: tu texto sigue intacto
                aquí arriba. Cambia el modelo de la conversación o corrígelo a
                mano.
              </Notice>
            )}

            {rewriteFailure === 'solo-razono' && (
              <Notice tone="warn">
                Se quedó pensando y se le acabó el espacio antes de escribir
                nada. Tu texto sigue intacto. Repetirlo con el mismo modelo dará
                lo mismo: el límite es suyo, no del intento.
              </Notice>
            )}

            {rewriteFailure === 'vacio' && (
              <Notice tone="warn">
                No contestó nada. Tu texto sigue intacto y aquí sí tiene sentido
                volver a intentarlo.
              </Notice>
            )}
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
                      // el de VISIÓN, no el de la conversación: elegir un modelo
                      // con vista para describir una foto no puede cambiar quién
                      // encarna al personaje. Sin elegir ninguno, el de siempre
                      provider: vision.provider,
                      model: vision.model,
                      effort: vision.effort,
                      projectAlias: project,
                    })
                    // con descripcion ya esta guardada y la lista se recarga sola:
                    // aqui solo queda quedarse con el motivo cuando no la hubo
                    .then((result) => {
                      setFailure(result.failure);
                      // el razonamiento NO se guarda con el medio: se enseña
                      // aqui, esta vez, para poder juzgar la descripcion
                      setReasoning(result.reasoning);
                    });
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
            un modelo que sepa <strong>mirar</strong> imágenes. Se elige abajo, en{' '}
            <strong>Probar la vista de un modelo</strong>, y es independiente del
            de la conversación: cambiarlo no toca a tu personaje.
            {vault.composer.visionProvider === null &&
              ' Sin elegir ninguno se usa el de la conversación.'}{' '}
            Lo que escriba se puede corregir a mano, porque es exactamente lo que
            lee después el personaje.
          </p>
        )}

        {reasoning !== null && (
          <details className="vision-probe__reasoning">
            <summary>Lo que pensó antes de responder</summary>
            <p>{reasoning}</p>
          </details>
        )}

        {failure === 'negativa' && (
          <Notice tone="warn">
            Ese modelo se negó a describir la imagen. Repetirlo no lo arregla:
            cambia el modelo de arriba y vuelve a pulsar, o escribe tú el pie de
            foto.
          </Notice>
        )}

        {failure === 'solo-razono' && (
          <Notice tone="warn">
            Se quedó pensando y se le acabó el espacio antes de escribir la
            descripción. Vio la imagen; lo que falta es sitio para responder.{' '}
            {/* sin remedio, este aviso solo servia para frustrar: repetirlo con
                el mismo modelo da el mismo resultado, porque el limite es suyo
                y no del intento */}
            Repetirlo con el mismo modelo dará lo mismo:{' '}
            <strong>elige otro que delibere menos</strong> en «Probar la vista de
            un modelo», aquí abajo.
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

        {/* la pista es la mitad ACCIONABLE de un fallo: dice qué hacer. Sólo se
            queda aquí cuando su error también se queda aquí; con dueño se va con
            él, pegada al botón que falló. Antes se quedaba siempre en este hueco
            —el de «Clave guardada», y en verde— mientras el motivo se pintaba
            varios paneles más arriba, así que la salida no la leía nadie */}
        {/* sincronizar, cerrar la bóveda y la cuenta no pertenecen a ninguna
            sección de arriba, así que su aviso llega aquí sin dueño. Un fallo
            que SÍ es de una sección se queda en la suya —y se lleva su pista
            con él— y no se repite aquí */}
        <VaultNotice vault={vault} slots={null} />

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
            {vault.lastSync.conversationsDeferred > 0 && (
              <p className="field__hint">
                La conversación a la que se estaba contestando no se ha
                sincronizado: su último mensaje aún podía retirarse. Irá la próxima
                vez que pulses «Sincronizar».
              </p>
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
  effort,
  vault,
  models,
  providers,
  project,
}: {
  vault: VaultController;
  models: ModelDefinition[];
  /** los que el agente tiene EN MARCHA: deciden quien puede ejecutar cada modelo */
  providers: string[];
  /** el mismo para todos los candidatos: es la comparacion, no una variable */
  effort: ReasoningEffort | null;
  project: string;
}): JSX.Element | null {
  const [selected, setSelected] = useState<string[]>([]);
  const [repetitions, setRepetitions] = useState(1);

  // `enabled` no basta y la sonda era la unica de las tres pantallas que se
  // conformaba con el: de los catorce modelos que sirve Groq, siete no son de
  // chat —dos whisper, dos orpheus y tres clasificadores— y llegaban aqui con
  // la casilla activa. Marcar tres de esos son tres turnos gastados para leer
  // «0 contesto · 0 se nego · 1 sin respuesta», que es el sintoma del que salio
  // toda esta investigacion
  const conversables = models.filter((model) => model.enabled && isConversationalModel(model));
  // quien ejecutaria cada uno, resuelto ANTES de gastar el turno.
  //
  // Antes esto mandaba `model.family` como proveedor, que es cierto solo para
  // los modelos de una conexion agregadora. Un modelo de AI Horde sale con
  // familia `other` —no es un fallo: de verdad no es de ninguna familia
  // conocida— y la sonda pedia ejecutar contra un proveedor llamado «other»,
  // que no existe en ninguna maquina.
  const ejecutor = (model: ModelDefinition): string | null => providerForModel(model, providers);
  // los que no se pueden probar, al final. La lista ya sale agrupada por origen
  // —es el orden del catalogo— asi que esto es lo unico que falta para que lo
  // marcable quede junto y no repartido entre ciento y pico fichas
  const usable = [
    ...conversables.filter((model) => ejecutor(model) !== null),
    ...conversables.filter((model) => ejecutor(model) === null),
  ];
  if (usable.length === 0 || vault.openConversationId === null) return null;

  const sinProveedor = usable.filter((model) => ejecutor(model) === null);
  // una frase por ORIGEN, no por modelo: las veintisiete de una misma conexion
  // de Horde dicen todas lo mismo y llenarian la pantalla.
  //
  // Y con el agente parado no se dice ninguna: ahi NADA tiene proveedor, asi que
  // serian tantos avisos como origenes para explicar una sola cosa. La explica
  // el aviso de abajo, que se pinta AQUI DENTRO y no solo fuera del desplegable:
  // con el catalogo de Daniel la lista mide dos pantallas, y la unica razon de
  // que todo este en gris quedaba a pantalla y media de scroll
  const motivos =
    providers.length === 0
      ? []
      : [
          ...new Set(
            sinProveedor.map((model) => missingProviderReason(model, providers, 'group') ?? ''),
          ),
        ].filter((motivo) => motivo.length > 0);
  // los que de verdad van a viajar. El boton cuenta ESTOS y no las marcas: una
  // marca sobre un modelo sin proveedor no es un candidato, y anunciar «probar 3»
  // para acabar ejecutando 2 es mentir sobre lo que se va a gastar
  const marcados = usable.filter((model) => selected.includes(model.id) && ejecutor(model) !== null);
  // y si NINGUNO se puede probar, decirlo: «el resto de la lista sí» era falso
  // con todas las conexiones apagadas, y ademas se repetia una vez por origen
  const marcables = usable.length - sinProveedor.length;

  const toggle = (id: string): void => {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((each) => each !== id) : [...previous, id],
    );
  };

  const run = (): void => {
    const targets = usable
      .filter((model) => selected.includes(model.id))
      // el mismo esfuerzo para todos, y a proposito: se estan comparando
      // modelos, asi que dejar que cada uno corra al suyo por defecto mezclaria
      // dos variables y el resultado no diria nada de ninguna de las dos
      .flatMap((model) => {
        const provider = ejecutor(model);
        // uno sin proveedor no viaja: su casilla ya esta desactivada, y esto es
        // el cinturon por si la lista de proveedores cambia con la marca puesta
        return provider === null ? [] : [{ provider, model: model.apiModel, effort }];
      });
    void vault.checkCompatibility({ projectAlias: project, targets, repetitions });
  };

  return (
    <details className="vault-generate">
      <summary>Comprobar modelos con esta conversación</summary>

      <p className="field__hint">
        Ejecuta tu último mensaje contra los modelos que elijas, con las
        instrucciones y el personaje de esta conversación. No guarda nada, no
        añade turnos y no genera imágenes: te enseña lo que ha contestado cada
        uno para que puedas compararlos, y ese texto desaparece al cerrar la
        bóveda.
      </p>

      {providers.length === 0 && (
        <Notice tone="warn">
          El agente todavía no anuncia ningún proveedor, así que no se puede
          probar ninguno de estos modelos. Arráncalo desde Inicio; si ya está en
          marcha, comprueba que la conexión tenga clave guardada.
        </Notice>
      )}

      {motivos.length > 0 && (
        <Notice tone="warn">
          {motivos.join(' ')}{' '}
          {marcables > 0
            ? 'Los modelos marcados «sin proveedor» no se pueden probar desde aquí; el resto de la lista sí.'
            : 'Ninguno de los modelos de la lista se puede probar desde aquí ahora mismo.'}
        </Notice>
      )}

      <div className="vault-list">
        {usable.map((model) => {
          // la etiqueta dice QUIEN lo ejecutaria, no de que familia es: la
          // familia no basta para saberlo y era justo la confusion del fallo
          const provider = ejecutor(model);
          return (
            <label key={model.id} className="row">
              <input
                type="checkbox"
                disabled={provider === null}
                checked={provider !== null && selected.includes(model.id)}
                onChange={() => toggle(model.id)}
              />
              <span>
                {model.displayName}{' '}
                {provider === null ? (
                  <Tag tone="warn">sin proveedor</Tag>
                ) : (
                  <Tag tone="idle">{provider}</Tag>
                )}
              </span>
            </label>
          );
        })}
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
        disabled={marcados.length === 0 || vault.checkingCompatibility}
        onClick={run}
      >
        {vault.checkingCompatibility ? 'Probando…' : `Probar ${marcados.length} modelo(s)`}
      </button>

      {vault.compatibility !== null && (
        <div className="vault-media">
          {vault.compatibility.map((result) => (
            <CompatibilityResultRow
              key={`${result.provider}:${result.model ?? ''}`}
              result={result}
            />
          ))}
        </div>
      )}
    </details>
  );
}

/**
 * lo que contesto UN modelo: las cifras de siempre y, debajo, lo que escribio.
 *
 * Es un componente y no un trozo del `map` porque cada fila recuerda dos cosas
 * suyas —que repeticion se esta mirando y si esta desplegada— y eso son hooks,
 * que dentro de un `map` no pueden vivir.
 *
 * El texto que pinta es CONTENIDO DE LA BOVEDA: llega por el IPC como cualquier
 * turno, se enseña, y se va cuando se cierra la boveda. No se guarda en ningun
 * sitio, no vuelve al proceso principal y no se registra.
 *
 * Lo que decide que enseñar y cuanto vive en `vault-compatibility-reply.ts`,
 * con sus pruebas: aqui solo se pinta.
 */
function CompatibilityResultRow({ result }: { result: CompatibilityResult }): JSX.Element {
  // `null` es «la primera», no «ninguna»: la fila tiene que enseñar algo desde
  // el momento en que llega, sin obligar a pulsar nada
  const [attempt, setAttempt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const reply = replyAt(result.replies, attempt);
  const look = reply === null ? null : describeReply(reply, expanded);

  return (
    <div className="vault-media__item">
      <p className="field__hint">
        <Tag tone={result.refused > 0 ? 'warn' : result.answered > 0 ? 'ok' : 'idle'}>
          {result.model ?? result.provider}
        </Tag>{' '}
        {/* y QUIEN lo ejecuto, siempre: las cuatro conexiones de AI Horde
            sirven los mismos nombres, asi que dos filas del mismo `apiModel`
            con cifras distintas no se distinguian en nada. Cada una lleva su
            clave y sus topes, o sea que no es un detalle cosmetico */}
        {result.model !== null && <Tag tone="idle">{result.provider}</Tag>}{' '}
        {result.answered} contestó · {result.refused} se negó · {result.empty} sin respuesta
        {result.answered > 0 && ` · memoria correcta ${result.memoryOk}/${result.answered}`}
        {result.signals.length > 0 && ` · ${result.signals.join(', ')}`}
        {result.error !== null && ` · ${result.error}`}
      </p>

      {result.replies.length > 1 && (
        <div className="vault-replies">
          {result.replies.map((each) => (
            <button
              key={each.attempt}
              className="btn btn--quiet"
              data-selected={reply?.attempt === each.attempt}
              // el veredicto tiñe el boton: con tres intentos iguales en gris
              // habria que abrirlos uno a uno para ver cual se torció
              data-tone={replyTone(each.kind)}
              onClick={() => {
                setAttempt(each.attempt);
                // cambiar de intento vuelve a plegar: dos textos largos
                // seguidos, uno desplegado y otro no, no se comparan
                setExpanded(false);
              }}
            >
              {replyTabLabel(each)}
            </button>
          ))}
        </div>
      )}

      {/* sin texto no hay caja: un recuadro con borde y nada dentro se lee como
          un fallo de pintado, y lo que pasa —que el modelo no escribio nada— lo
          dice la nota de debajo, que si se pinta siempre */}
      {look !== null && look.body !== '' && (
        <p className="vault-reply__text" data-tone={look.tone}>
          {look.body}
        </p>
      )}

      {look !== null && (
        <p className="vault-list__meta vault-reply__meta">
          {look.meta}
          {look.expandable && (
            <>
              {' · '}
              <button className="btn btn--quiet" onClick={() => setExpanded(!expanded)}>
                {look.expandLabel}
              </button>
            </>
          )}
        </p>
      )}
    </div>
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
  effort,
  project,
}: {
  vault: VaultController;
  provider: string;
  model: string;
  /**
   * y cuanto se le deja pensar. Aqui es donde mas cuesta equivocarse: catalogar
   * no es una llamada, es una por conversacion pendiente y en tandas.
   */
  effort: ReasoningEffort | null;
  project: string;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);

  const episodes = vault.memoryEpisodes;

  // quien catalogara de verdad: lo elegido abajo, o el de la ventana si es Claude
  // o Codex, o Codex. Nunca una API de pago
  const pedido = { provider, model: model.length === 0 ? null : model, effort };
  const destino = resolveAuxiliaryTarget(pedido, vault.auxiliary);
  const automatico = resolveAuxiliaryTarget(pedido, null);
  const nombreDe = auxiliaryName;
  const destinoNombre = nombreDe(destino);
  /**
   * y quien hara de verdad los pendientes y el relleno.
   *
   * Hacen falta DOS nombres porque los tres trabajos no se resuelven igual: el
   * catalogo si manda el proveedor de la ventana (`handlers.ts`, `catalogOnce`),
   * y la pasada de pendientes y la del relleno llaman con `null` y se quedan
   * con lo elegido aqui abajo, o con Codex. Con «Automatico» y la ventana
   * hablando por Claude —el estado inicial de la aplicacion— el panel decia
   * Claude y el trabajo salia por Codex, asi que «Rehacerlo con Claude» se
   * negaba otra vez con el mismo CLI sin cambiar nada.
   */
  const fondo = backgroundAuxiliary(vault.auxiliary);
  const fondoNombre = nombreDe(fondo);

  const { loadAuxiliary } = vault;
  useEffect(() => {
    void loadAuxiliary();
  }, [loadAuxiliary]);

  /**
   * busca en lo ya hablado lo que quedó pendiente entre los dos.
   *
   * En tandas y hasta acabar, igual que el catálogo y con el mismo tope de
   * vueltas: una cola que no baja es un fallo, no un motivo para seguir
   * arrancando el CLI. Cuándo parar lo decide `keepSweepingRelations`, que se
   * prueba aparte.
   *
   * `force` solo lo manda el botón, y solo en la primera vuelta: es Daniel quien
   * pide reintentar lo que se negó o falló, y repetirlo en las doce volvería a
   * arrancar el CLI para las mismas conversaciones rotas.
   */
  const buscarPendientes = async (force = false): Promise<void> => {
    for (let vuelta = 0; vuelta < 12; vuelta += 1) {
      const result = await vault.syncRelations({
        projectAlias: project,
        force: force && vuelta === 0,
      });
      if (!keepSweepingRelations(result)) break;
    }
    // y se recarga la lista SIEMPRE, aunque la pasada no apunte nada nuevo: la
    // primera apertura no busca nada y aun así tiene que enseñar lo que ya hay
    await vault.loadPendingAffairs();
  };

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
            effort,
            projectAlias: project,
          };
          // tope de vueltas: una cola que no baja es un fallo, no un motivo
          // para seguir gastando llamadas
          for (let vuelta = 0; vuelta < 12; vuelta += 1) {
            // si una tanda no cataloga NADA y ademas no falla nada, algo va mal
            // de forma sistematica —un modelo que no existe, por ejemplo— y
            // seguir no sirve. Pero una negativa no para las demas: la
            // conversacion negada queda marcada y la tanda siguiente coge otras
            if (!keepSweepingCatalog(await vault.syncCatalog(target))) break;
          }
          // y despues, en el mismo carril, lo que quedo pendiente entre los dos:
          // asi ella puede sacarlo sola sin que el se lo recuerde
          await buscarPendientes();
          await vault.loadMemory();
          // las fichas ya escritas, para poder repasarlas. Esto NO llama a
          // ningun CLI: solo lee lo que hay. Rellenar es un boton aparte
          await vault.loadRecaps();
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
        sin catalogar a <Tag tone="idle">{destinoNombre}</Tag>, con tu sesión de Claude
        o Codex: nunca a una API de pago, aunque la ventana use una. Lo excluido no se
        envía.
      </Notice>

      <label className="field">
        <span>Quién hace el trabajo de fondo (sin coste por llamada)</span>
        <select
          value={vault.auxiliary?.provider ?? ''}
          disabled={vault.catalogingMemory}
          onChange={(event) => {
            const valor = event.currentTarget.value;
            void vault.setAuxiliary(
              valor === 'codex' || valor === 'claude' ? { provider: valor, model: null } : null,
              'trabajo-de-fondo',
            );
          }}
        >
          <option value="">Automático ({nombreDe(automatico)})</option>
          <option value="codex">Codex</option>
          <option value="claude">Claude</option>
        </select>
      </label>

      {/* el motivo, junto al desplegable que lo provocó. Iba marcado como de
          «Memoria de lo ya hablado», que es otra sección de este mismo panel y
          está dos bloques más abajo: cambiar de CLI aquí y fallar pintaba el
          aviso dentro de un recuadro que nadie había tocado */}
      <VaultNotice vault={vault} slots={['trabajo-de-fondo']} />

      {/* comprobar la memoria sobre lo YA hablado: cobertura, la busqueda por
          fecha contra las fechas reales y el estilo, todo en cifras */}
      <div className="row">
        <button
          className="btn btn--quiet"
          disabled={vault.diagnosingMemory}
          onClick={() => void vault.diagnoseMemory()}
        >
          {vault.diagnosingMemory ? 'Comprobando…' : 'Comprobar la memoria'}
        </button>
        {/* se hace solo al abrir el panel y despues de cada turno; el boton está
            para volver a pasarlo cuando se cambia de CLI o se corrige algo */}
        <button
          className="btn btn--quiet"
          disabled={vault.syncingRelations || vault.catalogingMemory}
          title={`Lee lo que ya habéis hablado con ${fondoNombre} y apunta lo que quedó pendiente entre los dos. Reintenta también lo que se negó o falló antes`}
          onClick={() => void buscarPendientes(true)}
        >
          {vault.syncingRelations ? 'Buscando…' : 'Buscar lo pendiente en lo ya hablado'}
        </button>
      </div>

      {vault.lastRelationSync !== null && (
        <p className="field__hint">
          {vault.lastRelationSync.notes > 0
            ? `Se han apuntado ${vault.lastRelationSync.notes} promesa(s) o plan(es) pendientes.`
            : 'No había nada pendiente nuevo que apuntar.'}
          {vault.lastRelationSync.closed > 0 &&
            ` ${vault.lastRelationSync.closed} se dieron por cumplidos.`}
          {vault.lastRelationSync.pending > 0 &&
            ` Quedan ${vault.lastRelationSync.pending} conversación(es) por leer.`}
          {vault.lastRelationSync.refused > 0 &&
            ` ${vault.lastRelationSync.refused} no se pudo leer con ${fondoNombre}: cambia arriba de CLI y vuelve a pulsar, o púlsalo otra vez para reintentar con el mismo.`}
        </p>
      )}
      <PendingAffairsSection vault={vault} />

      {/* el relleno hacia atras de las conversaciones viejas. Su boton va DENTRO
          de la seccion y fuera del `onToggle` de arriba: los tres trabajos de
          fondo comparten un solo carril y un solo CLI, y abrir este panel no
          puede arrancar media hora de proceso que nadie pidio */}
      <RecapSection
        vault={vault}
        project={project}
        destino={fondo.provider}
        destinoNombre={fondoNombre}
      />

      {vault.lastDiagnostics !== null && (
        <MemoryDiagnosticsSummary diagnostics={vault.lastDiagnostics} />
      )}

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
                effort,
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
              : `Reintentar con ${destinoNombre}`}
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
                effort,
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
              : `Repetir con ${destinoNombre}`}
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
                  // si la lectura falla NO se abre nada: un recuadro vacío se
                  // lee como «este momento no tiene turnos», y el error queda
                  // arriba del todo, fuera de la pantalla
                  void vault.readMemoryEpisode(episode).then((read) => {
                    if (read === null) return;
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
                      effort,
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

/**
 * lo que quedó pendiente entre los dos, para repasarlo.
 *
 * Por qué existe esta pantalla. El extractor comprueba la cita letra por letra
 * y comprueba quién la dijo, pero la INTENCIÓN no se puede comprobar: una frase
 * de coqueteo puede parecer un compromiso. Que una promesa no se apunte sólo es
 * molesto; que se apunte una que nadie hizo acaba en un reproche de ella por
 * algo que no pasó. Así que Daniel repasa esto ANTES de que ella vea nada, y
 * tiene la última palabra después: lo que descarte aquí no se vuelve a apuntar.
 *
 * No hay alta a mano a propósito. Todo pendiente señala un turno real con una
 * cita verificada; uno escrito a mano no tendría contra qué comprobarse, y sería
 * justo el agujero por el que ella podría reclamar lo que nunca se dijo.
 */
function PendingAffairsSection({ vault }: { vault: VaultController }): JSX.Element | null {
  /** qué pendiente tiene el turno abierto, por su identificador */
  const [openTurn, setOpenTurn] = useState<string | null>(null);
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);

  const pending = vault.pendingAffairs;
  const characters = vault.characters;
  const labels = useMemo(
    () => new Map(characters.map((character) => [character.characterId, character.label])),
    [characters],
  );
  const groups = useMemo(
    () => groupPendingByCharacter(pending ?? [], labels),
    [pending, labels],
  );

  // todavía no se ha pedido: no es lo mismo que «no hay ninguno»
  if (pending === null) return null;

  return (
    <div className="vault-generate__section">
      <p className="field__hint">
        <strong>Lo que tenéis pendiente.</strong> Promesas y planes que salieron
        en vuestras conversaciones y que, por lo que consta, siguen sin cumplirse.
        Ella puede sacarlos sola, sin que tú los nombres, así que repásalos: lo
        que descartes aquí no se vuelve a apuntar y lo que des por cumplido deja
        de poder salir. Cada uno señala un turno de verdad y la frase entre
        comillas es literal.
      </p>

      {pending.length === 0 && (
        <Empty title="Todavía no hay nada pendiente">
          Aparecerán solos cuando alguno de los dos prometa algo o quedéis en algo.
        </Empty>
      )}

      {groups.map((group) => (
        <div key={group.characterId ?? 'sin-personaje'}>
          <p className="field__hint">
            <Tag tone={group.open > 0 ? 'busy' : 'idle'}>{group.label}</Tag>{' '}
            <span className="vault-list__meta">
              {group.open === 0
                ? 'nada pendiente ahora mismo'
                : group.open === 1
                  ? '1 pendiente'
                  : `${group.open} pendientes`}
            </span>
          </p>

          {group.pending.map((affair) => (
            <div key={affair.id} className="vault-media__item">
              <p className="field__hint">
                <Tag tone={PENDING_STATUS_TONES[affair.status]}>
                  {PENDING_STATUS_LABELS[affair.status]}
                </Tag>{' '}
                {PENDING_PARTY_LABELS[affair.by]}{' '}
                <span className="vault-list__meta">
                  · {affair.kind === 'plan' ? 'plan' : 'promesa'} del {affair.day}
                  {affair.closedDay !== null && ` · cerrado el ${affair.closedDay}`}
                  {affair.decidedBy === 'daniel'
                    ? ' · lo decidiste tú'
                    : affair.extractedBy === null
                      ? ''
                      : ` · revisado con ${affair.extractedBy}`}
                  {affair.reopenedByDaniel && ' · lo reabriste'}
                </span>
              </p>

              {/* la cita va tal y como se dijo: es lo único con lo que se puede
                  juzgar si de verdad hubo una promesa */}
              <p className="vault-turn__text">«{affair.quote}»</p>

              {affair.quoteBroken && (
                <Notice tone="warn">
                  Esta frase ya no está en su turno —se retiró o se reescribió—, así
                  que ella no va a sacarlo nunca. Puedes descartarlo sin perder nada.
                </Notice>
              )}

              <div className="row">
                <button
                  className="btn btn--quiet"
                  onClick={() => {
                    if (openTurn === affair.id) {
                      setOpenTurn(null);
                      return;
                    }
                    // el mismo canal que los momentos, con un solo turno: un
                    // pendiente no es un resumen, es un puntero a lo que se dijo
                    void vault
                      .readMemoryTurns({
                        conversationId: affair.origin.conversationId,
                        from: affair.origin.sequence,
                        to: affair.origin.sequence,
                      })
                      .then((read) => {
                        // igual que en los momentos: un fallo no abre un
                        // recuadro vacío, que diría que no hay turno
                        if (read === null) return;
                        setTurns(read);
                        setOpenTurn(affair.id);
                      });
                  }}
                >
                  {openTurn === affair.id ? 'Cerrar' : 'Ver turno'}
                </button>

                {pendingDecisionsFor(affair.status).map((decision) => (
                  <button
                    key={decision}
                    className="btn btn--quiet"
                    disabled={vault.decidingPendingAffair}
                    title={PENDING_DECISION_HINTS[decision]}
                    onClick={() => void vault.decidePendingAffair(affair.id, decision)}
                  >
                    {PENDING_DECISION_LABELS[decision]}
                  </button>
                ))}
              </div>

              {openTurn === affair.id && (
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
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * la memoria de lo ya hablado: las conversaciones antiguas, rellenadas hacia
 * atrás.
 *
 * Diecisiete de las dieciocho conversaciones no tienen memoria acumulativa
 * porque estuvo rota meses. Esto la escribe con Claude o Codex, por ventanas y
 * sin tocar un byte de lo sellado.
 *
 * Por qué esta pantalla existe, y por qué «Ver» no es un adorno: el único fallo
 * que el código NO puede cazar es un resumen competente pero saneado —«tuvieron
 * un encuentro íntimo y quedaron el sábado»—, que valida contra el esquema, pasa
 * el detector de vaguedad, avanza el cursor y se queda de semilla para siempre
 * en ese hilo, porque cada turno futuro conserva lo válido de la memoria
 * anterior. El único juez posible es Daniel leyéndolo ANTES que ella. Por eso una
 * ficha escrita por un CLI no entra en ningún prompt hasta que se aprueba.
 */
function RecapSection({
  vault,
  project,
  destino,
  destinoNombre,
}: {
  vault: VaultController;
  project: string;
  /** a qué CLI va el trabajo de fondo ahora mismo */
  destino: LocalCliProvider;
  destinoNombre: string;
}): JSX.Element {
  /**
   * qué bloque está abierto, y CUÁL de los dos.
   *
   * Dos y no uno porque una conversación sellada tiene dos textos distintos: la
   * ficha retroactiva, que ya no entra en ningún prompt, y su memoria propia,
   * que es lo único que ella lee. Con un solo identificador el botón «Ver»
   * enseñaba la muerta sin decirlo.
   */
  const [open, setOpen] = useState<{
    conversationId: string;
    kind: 'card' | 'sealed';
  } | null>(null);
  /**
   * qué dejó el último repaso, para que se vea que se ha ejecutado.
   *
   * Aparte de `lastRecapSync` a propósito: aquella es «la última pasada que
   * llamó a un CLI» y la lee `fuePrueba`. Escribir aquí habría hecho que el
   * panel dijera «no se ha escrito ninguna ficha» después de un simple repaso,
   * que no llama a nadie y no escribe nada.
   *
   * Lleva la hora porque el repaso más útil es justo el que no cambia nada: sin
   * ella, pulsar dos veces deja la misma frase y vuelve a parecer que no pasa.
   */
  const [repaso, setRepaso] = useState<{
    hora: string;
    rows: number;
    changed: boolean;
  } | null>(null);
  /**
   * la última tanda fue una prueba y no se guardó nada.
   *
   * Vive aquí y no en el resultado porque el resultado no lo dice: los
   * contadores de una prueba son idénticos a los de una pasada de verdad. Sin
   * esta marca, «se han escrito 2 fichas» aparecía después de una prueba que no
   * escribió ninguna, que es exactamente la clase de frase que hace desconfiar
   * de todas las demás.
   */
  const [fuePrueba, setFuePrueba] = useState(false);
  /**
   * qué se está ejecutando ahora mismo, y sobre qué conversación.
   *
   * Los tres botones leían la misma bandera `syncingRecaps`, así que durante
   * una pasada la pantalla decía a la vez «Rellenando…», «Probando…» y
   * «Rehaciendo…» en cada fila. Volver al panel diez minutos después no
   * permitía saber si lo que corría era la prueba que no guarda nada o la
   * pasada que sí escribe, que es justo la distinción que esta sección se toma
   * el trabajo de marcar en todos los demás sitios.
   *
   * No sustituye a `fuePrueba`: esto vuelve a `null` al terminar y aquello
   * tiene que sobrevivir para etiquetar el resultado.
   */
  const [corriendo, setCorriendo] = useState<{
    accion: 'rellenar' | 'prueba' | 'rehacer' | 'repasar';
    conversationId: string | null;
  } | null>(null);
  /**
   * de qué conversación se está preguntando si borrar su memoria propia.
   *
   * Un paso intermedio y no un `confirm()` del navegador porque lo que hay que
   * decir no cabe en una línea: qué se destruye, qué se queda —los mensajes, que
   * es lo que de verdad da miedo perder— y que el hilo volverá a escribirse
   * memoria en cuanto se le conteste. «¿Seguro?» no distingue «borro lo que
   * recuerda» de «borro la conversación», que es la confusión que más caro sale.
   */
  const [borrando, setBorrando] = useState<string | null>(null);
  /**
   * qué se está borrando AHORA, y si con su ficha retroactiva.
   *
   * Local y no la bandera del controlador: `decidingRecap` la comparten el
   * borrado y las decisiones sobre las fichas, así que aprobar o borrar la
   * ficha de OTRA fila ponía «Borrando…» en el botón rojo de esta confirmación,
   * afirmando en presente una destrucción que no estaba ocurriendo.
   */
  const [borrandoAhora, setBorrandoAhora] = useState<{
    conversationId: string;
    conFicha: boolean;
  } | null>(null);
  /**
   * qué dejó el último borrado, para que se vea que ocurrió.
   *
   * Al borrar, la fila pierde sus botones y el bloque se cierra: la pantalla
   * queda MÁS vacía que antes, que se lee igual que un botón que no hizo nada.
   * La cifra son turnos, porque la memoria se vuelve a sellar en cada turno que
   * la trae buena y una conversación larga guarda muchas copias.
   *
   * `fichaEnUso` se decide al pulsar y no al releer la lista: es lo que hay que
   * contarle —si la ficha retroactiva se quedó y era de las que viajan, desde
   * el próximo mensaje ella lee ESA— y la fila puede desaparecer del panel
   * justo después de borrar, que es lo que le pasa a una conversación excluida.
   */
  const [borrado, setBorrado] = useState<{
    conversationId: string;
    turnos: number;
    fichaEnUso: boolean;
  } | null>(null);

  const rows = vault.recaps;
  const cobertura = vault.recapCoverage;
  const ultima = vault.lastRecapSync;
  // `corriendo` entra en la cuenta porque el repaso no mueve ninguna bandera del
  // controlador: sin esto su botón se podía pulsar cinco veces seguidas mientras
  // la primera lectura seguía descifrando
  const ocupado =
    vault.syncingRecaps || vault.decidingRecap || corriendo !== null || borrandoAhora !== null;

  /**
   * rellena hacia atrás, en tandas y hasta acabar.
   *
   * Fuera del `onToggle` del panel a propósito: catálogo, pendientes y esto
   * comparten un solo carril y un solo CLI, y abrir «Lo que recuerda» no puede
   * convertirse en media hora de proceso arrancando sin haberlo pedido.
   *
   * Cuándo parar lo decide `keepSweepingRecaps`, que se prueba aparte: las dos
   * conversaciones de una tanda son siempre las dos más antiguas, así que cortar
   * cuando no se escribe ninguna ficha dejaría las quince restantes sin mirar.
   */
  const rellenar = async (force = false): Promise<void> => {
    setFuePrueba(false);
    setCorriendo({ accion: 'rellenar', conversationId: null });
    try {
      for (let vuelta = 0; vuelta < 12; vuelta += 1) {
        const result = await vault.syncRecaps({
          projectAlias: project,
          // `force` solo en la primera vuelta: repetirlo en las doce volvería a
          // empezar desde cero las mismas conversaciones ya rellenadas
          force: force && vuelta === 0,
        });
        if (!keepSweepingRecaps(result)) break;
      }
      await vault.loadRecaps();
    } finally {
      setCorriendo(null);
    }
  };

  /**
   * una sola tanda, sin guardar nada.
   *
   * NO se repite en bucle, y es deliberado: con `dryRun` no se escribe ninguna
   * entrada, así que la cola no baja y la vuelta siguiente cogería LAS MISMAS
   * dos conversaciones para volver a pagarlas. Esto es una muestra para leer, no
   * una pasada.
   */
  const probar = async (): Promise<void> => {
    setFuePrueba(true);
    setCorriendo({ accion: 'prueba', conversationId: null });
    try {
      await vault.syncRecaps({ projectAlias: project, dryRun: true });
    } finally {
      setCorriendo(null);
    }
  };

  /**
   * vuelve a leer lo escrito, sin llamar a ningún CLI.
   *
   * Envuelto igual que sus dos vecinos aunque no llame a nadie, y por lo que
   * cuesta: la lectura recorre la línea temporal entera y descifra la memoria de
   * cada conversación. Antes era un `onClick` desnudo sin etiqueta ni acuse, así
   * que la única lectura posible de esos segundos era que el botón no hacía
   * nada. El acuse va aparte de `lastRecapSync`, que significa otra cosa.
   */
  const repasar = async (): Promise<void> => {
    setCorriendo({ accion: 'repasar', conversationId: null });
    try {
      const leido = await vault.loadRecaps();
      // en el fallo NO se escribe acuse: el error ya está puesto, y una frase
      // de «repasado» al lado sería decir que fue bien
      if (leido === null) {
        setRepaso(null);
        return;
      }
      setRepaso({
        hora: new Date().toLocaleTimeString(),
        rows: leido.rows,
        changed: leido.changed,
      });
    } finally {
      setCorriendo(null);
    }
  };

  /**
   * borra lo que ella recuerda de una conversación. Sólo tras confirmarlo.
   *
   * Cierra el bloque abierto de esa fila: si no, el recuadro se quedaría
   * enseñando en pantalla un texto que ya no existe en disco.
   *
   * `tambienLaFicha` es la salida del caso feo, y existe porque avisar sin dar
   * salida es lavarse las manos: cuando esa conversación tiene además una ficha
   * retroactiva que empezaría a viajar al quedarse sin memoria propia, borrar
   * sólo la memoria no limpia nada —cambia un texto por otro, y el otro habla
   * de esta misma conversación—.
   *
   * ORDEN: primero la ficha y después la memoria. Si falla el primer paso no se
   * ha destruido nada, la memoria sigue ahí y el botón también; al revés
   * quedaría la ficha viva junto a una memoria ya borrada, que es exactamente
   * el estado que esta pantalla acaba de prometer evitar.
   */
  const borrarMemoria = async (
    conversationId: string,
    opciones: { tambienLaFicha: boolean; revive: boolean },
  ): Promise<void> => {
    setBorrandoAhora({ conversationId, conFicha: opciones.tambienLaFicha });
    try {
      if (opciones.tambienLaFicha) {
        const hecho = await vault.decideRecap({ action: 'forget', conversationId });
        // el motivo ya está puesto en esta misma sección; seguir sería dejar la
        // ficha viva y la memoria no, que es el peor de los dos resultados
        if (!hecho) return;
      }
      const turnos = await vault.forgetSealedMemory(conversationId);
      // en el fallo NO se cierra la pregunta ni se escribe acuse: el error ya
      // está puesto arriba de esta misma sección, y quitar el diálogo se leería
      // como que el borrado salió bien
      if (turnos === null) return;
      setBorrando(null);
      setOpen((actual) => (actual?.conversationId === conversationId ? null : actual));
      setBorrado({
        conversationId,
        turnos,
        // la ficha sólo pasa a usarse si se quedó Y era de las que viajan
        fichaEnUso: opciones.revive && !opciones.tambienLaFicha,
      });
    } finally {
      setBorrandoAhora(null);
    }
  };

  /**
   * vuelve a hacer una conversación desde cero.
   *
   * Con un CLI distinto cuando el otro se negó: quien se niega es un modelo
   * concreto, así que la salida natural es probar con el otro. Cambia además la
   * preferencia del trabajo de fondo, porque el botón dice «con Claude» y tiene
   * que ir de verdad a Claude, no al que siga elegido arriba.
   */
  const rehacer = async (conversationId: string, con: LocalCliProvider): Promise<void> => {
    setFuePrueba(false);
    setCorriendo({ accion: 'rehacer', conversationId });
    try {
      // SIEMPRE, sin comparar con lo que el panel cree que está elegido: es
      // barato, es idempotente, y comparar era justo lo que hacía que el botón
      // dijera un CLI y el trabajo saliera por el otro
      await vault.setAuxiliary({ provider: con, model: null }, 'memoria');
      await vault.syncRecaps({ projectAlias: project, conversationId, force: true });
      await vault.loadRecaps();
    } finally {
      setCorriendo(null);
    }
  };

  // los cinco que suman. Se pinta la SUMA y no `total - excluded - sealed`: si
  // el panel pudiera decir un total distinto del que enseña, la linea de
  // cobertura dejaria de servir para lo unico que sirve
  const rellenables =
    cobertura === null
      ? 0
      : cobertura.summarized +
        cobertura.withGaps +
        cobertura.indexOnly +
        cobertura.awaitingApproval +
        cobertura.missing;
  const cuadra =
    cobertura === null || rellenables + cobertura.sealed === cobertura.total - cobertura.excluded;

  /**
   * fichas escritas que sólo esperan que las lea y las apruebe.
   *
   * Las de una conversación que ya tiene memoria propia no cuentan: la sellada
   * gana siempre, así que aprobarlas dejaría en disco un `approved` que no
   * significa nada y un botón que no hace nada.
   */
  const esperando =
    rows?.filter(
      (row) => !row.approved && row.block.length > 0 && !row.sealed && !row.superseded,
    ) ?? [];

  return (
    <div className="vault-generate__section">
      <p className="field__hint">
        <strong>Memoria de lo ya hablado.</strong> Al reabrir una conversación
        antigua, ella no recuerda en qué punto quedó: sólo ve los últimos turnos.
        Esto lo escribe hacia atrás, conversación a conversación, leyéndolas con{' '}
        {destinoNombre}. Es por conversación: por sí sola no hace que se acuerde
        de un hilo estando en otro, que es lo que hacen los momentos y lo
        pendiente. <strong>Con una excepción</strong>: si su personaje tiene
        encendida «{RECENT_MEMORIES_CHECKBOX}», la ficha que
        apruebes aquí, mientras siga al día, de una conversación sin memoria
        propia viaja, resumida, a
        sus otras conversaciones mientras esa siga entre las dos más recientes.
      </p>

      <Notice tone="idle">
        Para resumirlas se manda el texto de cada conversación sin ficha a{' '}
        <Tag tone="idle">{destinoNombre}</Tag>, con tu sesión de Claude o Codex:
        nunca a una API de pago. Lo excluido no se envía. Lo que se niegue a
        resumir no se manda a ningún otro sitio: se queda sin resumir y aquí lo
        verás.
      </Notice>

      {cobertura !== null && (
        <p className="field__hint">
          {/* «escritas y esperando» va aparte de «sin memoria» porque no son el
              mismo estado ni se arreglan igual: una espera un minuto de lectura
              y la otra una llamada a un CLI. Juntas, la línea decía «17 sin
              leer» justo después de la pasada que escribió las diecisiete */}
          <strong>Cobertura:</strong> {cobertura.summarized} resumida(s) ·{' '}
          {cobertura.withGaps} con huecos · {cobertura.indexOnly} sólo por índice ·{' '}
          {cobertura.awaitingApproval} escrita(s) esperando que las apruebes ·{' '}
          {cobertura.missing} sin memoria en el prompt ({rellenables} en total).{' '}
          {cobertura.sealed === 1
            ? '1 ya tiene memoria propia.'
            : `${cobertura.sealed} ya tienen memoria propia.`}
          {cobertura.excluded > 0 && ` ${cobertura.excluded} excluida(s) quedan fuera.`}
        </p>
      )}

      {!cuadra && (
        <Notice tone="fault">
          Esta cuenta no cuadra con el total de conversaciones, y eso no es un
          redondeo: es un fallo. No te fíes de la línea de arriba hasta que se
          arregle.
        </Notice>
      )}

      {/* la ventana en la que el trabajo se pierde sin que nada lo diga: una
          ficha sin aprobar no entra en el prompt, así que el primer turno que se
          conteste en ese hilo se compone sin ella y sella su propia memoria. Y
          la sellada gana siempre, de modo que esa ficha ya no vuelve a entrar
          por mucho que se apruebe después */}
      {esperando.length > 0 && (
        <Notice tone="warn">
          {esperando.length === 1
            ? 'Hay 1 ficha escrita y sin aprobar.'
            : `Hay ${esperando.length} fichas escritas y sin aprobar.`}{' '}
          Léelas y apruébalas <strong>antes</strong> de volver a escribir en esas
          conversaciones: el primer mensaje que contestes en una de ellas sella su
          propia memoria, y a partir de ahí la ficha ya no puede entrar aunque la
          apruebes.
        </Notice>
      )}

      <div className="row">
        <button
          className="btn btn--quiet"
          disabled={ocupado}
          title={`Lee con ${destinoNombre} las conversaciones que no tienen ficha y escribe la memoria de cada una. No toca lo ya escrito`}
          onClick={() => void rellenar()}
        >
          {corriendo?.accion === 'rellenar'
            ? 'Rellenando…'
            : 'Generar la memoria de lo ya hablado'}
        </button>
        {/* lo unico que contesta a la vez «¿se niegan?» y «¿sale bueno?» sin
            dejar nada escrito. Una sola tanda: no guarda, asi que repetirla
            cogeria las mismas conversaciones */}
        <button
          className="btn btn--quiet"
          disabled={ocupado}
          title="Corre la pasada entera con dos conversaciones y NO guarda nada: sólo te enseña lo que habría escrito"
          onClick={() => void probar()}
        >
          {corriendo?.accion === 'prueba' ? 'Probando…' : 'Probar sin guardar'}
        </button>
        <button
          className="btn btn--quiet"
          disabled={ocupado}
          title="Vuelve a leer lo que ya hay escrito, sin llamar a ningún CLI"
          onClick={() => void repasar()}
        >
          {corriendo?.accion === 'repasar' ? 'Repasando…' : 'Repasar lo que hay'}
        </button>
      </div>

      {/* el error de esta sección se pintaba SÓLO en la cabecera de la página,
          muy por encima de este panel: un fallo de cualquiera de estos botones
          aparecía fuera de la pantalla y lo que se veía era un botón inerte.
          Y SÓLO el de esta sección: sin el dueño, un fallo de listar modelos de
          AI Horde salía aquí dentro diciendo que había fallado algo de la
          memoria, que es justo lo que nadie había tocado */}
      <VaultNotice vault={vault} slots={['memoria']} />

      {/* el acuse del repaso. Se pinta también —sobre todo— cuando no ha
          cambiado nada: que siga igual es información, una pantalla quieta no */}
      {repaso !== null && (
        <p className="field__hint">
          <strong>Repasado a las {repaso.hora}:</strong>{' '}
          {repaso.rows === 1
            ? '1 conversación releída'
            : `${repaso.rows} conversaciones releídas`}
          . {repaso.changed ? 'La lista ha cambiado.' : 'Sigue igual que antes.'}
        </p>
      )}

      {ultima !== null && (
        <p className="field__hint">
          {fuePrueba
            ? ultima.windows === 0
              ? 'Prueba: no había ninguna conversación sin ficha que leer.'
              : `Prueba, y no se ha guardado nada: ${ultima.windows} llamada(s) a ${CLI_LABELS[ultima.provider]} habrían dado ${ultima.reviewed} ficha(s).`
            : ultima.reviewed > 0
              ? `Se han escrito o ampliado ${ultima.reviewed} ficha(s) en ${ultima.windows} llamada(s).`
              : 'No se ha escrito ninguna ficha nueva.'}
          {ultima.partial > 0 &&
            ` ${ultima.partial} salieron con tramos declarados, que es la respuesta honesta: esos huecos viajan al prompt y ella preguntará en vez de suponer.`}
          {ultima.refused > 0 &&
            ` ${ultima.refused} tramo(s) no los quiso resumir ${CLI_LABELS[ultima.provider]}: cambia de CLI abajo en cada ficha y reinténtalo.`}
          {ultima.vague > 0 &&
            ` ${ultima.vague} salieron sin decir nada y no se guardaron: eso depende del modelo más que del CLI.`}
          {ultima.invalid > 0 && ` ${ultima.invalid} no se pudieron leer.`}
          {ultima.deduced > 0 &&
            ` ${ultima.deduced} se quedaron en el índice de sus escenas, que no es memoria: dice qué escenas hubo, no qué se dijo.`}
          {ultima.superseded > 0 &&
            ` ${ultima.superseded} ya tenían memoria propia y no se tocan.`}
          {ultima.dropped > 0 &&
            ` Atención: al encadenar ventanas se perdieron ${ultima.dropped} entradas de las anteriores (${ultima.added} nuevas).`}
          {ultima.pending > 0 && ` Quedan ${ultima.pending} conversación(es) por rellenar.`}
        </p>
      )}

      {ultima !== null && ultima.replaced && (
        <Notice tone="warn">
          La preferencia guardada pedía un proveedor de pago y se ha sustituido por{' '}
          {CLI_LABELS[ultima.provider]}. Este trabajo no llama nunca a una API que
          cobre.
        </Notice>
      )}

      {ultima !== null && ultima.failed.length > 0 && (
        <Notice tone="warn">
          {ultima.failed.length === 1
            ? 'Una conversación no se pudo ni leer ni guardar'
            : `${ultima.failed.length} conversaciones no se pudieron ni leer ni guardar`}
          : {[...new Set(ultima.failed.map((each) => each.reason))].join('; ')}. No se
          reintentan solas: búscalas abajo —salen sin ficha— y pídelo desde su
          fila, o cambia de CLI arriba y vuelve a pulsar.
        </Notice>
      )}

      {vault.recapPreview !== null && (
        <div className="vault-generate__section">
          <p className="field__hint">
            <strong>Prueba sin guardar.</strong> Esto es lo que se habría escrito.
            No se ha guardado nada, no ha entrado en ningún prompt y desaparece al
            cerrar. Léelo antes de decidir con qué CLI haces la pasada de verdad:
            lo que busques es si dice qué pasó, con nombres, o si lo ha dejado en
            «tuvieron un momento íntimo», que no sirve para nada.
          </p>
          {vault.recapPreview.length === 0 && (
            <Empty title="No salió ninguna ficha">
              {ultima !== null && ultima.windows === 0
                ? 'No había ninguna conversación sin ficha que leer, así que no se ha llamado a nadie.'
                : 'Ninguna de las conversaciones probadas dio un resumen utilizable. Prueba con el otro CLI antes de hacer la pasada entera.'}
            </Empty>
          )}
          {vault.recapPreview.map((preview) => (
            <div key={preview.conversationId} className="vault-media__item">
              <p className="field__hint">
                <Tag tone={preview.refusedKind === null ? 'ok' : 'warn'}>
                  {preview.refusedKind === null
                    ? preview.source === 'index'
                      ? 'sólo índice'
                      : 'ficha'
                    : RECAP_REFUSAL_LABELS[preview.refusedKind]}
                </Tag>{' '}
                <span className="vault-list__meta">
                  cubre del turno {preview.covered.from} al {preview.covered.to} ·{' '}
                  {preview.chars} caracteres en cada turno futuro
                  {preview.gaps > 0 && ` · ${preview.gaps} tramo(s) sin resumir`}
                </span>
              </p>
              {preview.block.length > 0 && (
                <p className="vault-recap__block">{preview.block}</p>
              )}
            </div>
          ))}
          <div className="row">
            <button className="btn btn--quiet" onClick={() => vault.clearRecapPreview()}>
              Cerrar la prueba
            </button>
          </div>
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <Empty title="No hay ninguna conversación que rellenar">
          Las que hay o están excluidas, o ya tienen memoria propia, o no tienen
          ningún mensaje todavía.
        </Empty>
      )}

      {esperando.length > 0 && (
        <div className="row">
          {/* son diecisiete textos cortos: un minuto. Pero leerlos primero es el
              punto entero de esta pantalla */}
          <button
            className="btn btn--quiet"
            disabled={ocupado}
            title="Deja entrar en los prompts todas las fichas que están esperando. Léelas antes: lo que pongan se propaga a todos los turnos futuros de ese hilo"
            onClick={() => void vault.decideRecap({ action: 'approve-all' })}
          >
            Aprobar todas
          </button>
        </div>
      )}

      {rows?.map((row) => {
        // como se pinta y, sobre todo, que NO se enseña. Vive en un modulo puro
        // con pruebas porque una de las dos cosas que decide es la regla de que
        // una negativa no anuncia de que iba la conversacion
        const look = describeRecapRow(row, destino);
        /** cuál de los dos bloques de ESTA fila está abierto, si alguno */
        const abierto =
          open !== null && open.conversationId === row.conversationId ? open.kind : null;
        // NO hay aquí ningún «esta fila no ofrece nada, y es lo correcto»: se
        // escribió uno y era inalcanzable. Con entrada siempre queda
        // «Borrarlo»; sin entrada, la sellada trae bloque —`formatConversation-
        // Memory` emite al menos su «Resumen:»— y con él «Ver su memoria», y la
        // que no está sellada o se puede rehacer o ni sale de la lista. Un
        // párrafo que explica un estado que no existe es peor que nada, así que
        // se quitó en vez de arreglarle la condición

        return (
          <div key={row.conversationId} className="vault-media__item">
            <p className="field__hint">
              <Tag tone={look.tone}>{look.state}</Tag>{' '}
              {look.title ?? `Del ${row.day}`}{' '}
              <span className="vault-list__meta">
                {look.title === null ? '· ' : `· del ${row.day} · `}
                {row.turns} mensajes
                {look.canRead && ` · cubre ${row.covered} de ${row.turns} turnos`}
                {/* «en cada turno» sería mentira en una ficha que ya no entra en
                    ningún prompt: esa no viaja en ninguno */}
                {look.canRead &&
                  (look.cardIsStale
                    ? ` · ${row.chars} caracteres que ya no viajan`
                    : ` · ${row.chars} caracteres en cada turno`)}
                {row.source === 'index' && ' · sólo el índice de sus escenas'}
                {row.gaps > 0 && ` · ${row.gaps} tramo(s) que nadie resumió`}
                {row.provider !== null && ` · escrita con ${CLI_LABELS[row.provider]}`}
                {row.model !== null && ` (${row.model})`}
              </span>
            </p>

            {row.source === 'index' && (
              <Notice tone="idle">
                Esto no es un resumen de lo que se dijo: son los títulos de sus
                escenas y una frase de cada una. Ella lo lee como índice y sigue
                sabiendo que le faltan turnos, así que preguntará en vez de
                suponer.
              </Notice>
            )}

            {/* una aprobación de Daniel no puede caerse en silencio. El trabajo
                de fondo amplía la ficha y la deja sin aprobar A PROPÓSITO —el
                texto es otro—, pero el efecto es que ese hilo deja de leer una
                ficha que sí leía, y hasta ahora eso se veía igual que una ficha
                que nadie había mirado nunca. El disparador más probable es haber
                borrado la memoria propia de ese hilo, que lo devuelve a la
                pasada */}
            {look.approvalLost && (
              <Notice tone="warn">
                <strong>Esta ficha la habías aprobado y ya no lo está.</strong> El
                trabajo de fondo la ha vuelto a escribir con los mensajes nuevos, y
                una ficha reescrita no entra en ningún mensaje hasta que la vuelves a
                aprobar: no se mete en un prompt un texto que no has leído. Mientras
                tanto, este hilo no está leyendo ninguna ficha. Léela con «Ver» y, si
                te sirve, «Aprobar».
              </Notice>
            )}

            <div className="row">
              {/* la memoria propia va PRIMERO porque es la que manda: cuando una
                  conversación la tiene, la ficha retroactiva de al lado ya no
                  entra en ningún prompt */}
              {look.canReadSealed && (
                <button
                  className="btn btn--quiet"
                  title="La memoria que esta conversación se escribió a sí misma. Es la que ella lee de verdad en cada mensaje de este hilo"
                  onClick={() =>
                    setOpen(
                      abierto === 'sealed'
                        ? null
                        : { conversationId: row.conversationId, kind: 'sealed' },
                    )
                  }
                >
                  {abierto === 'sealed' ? 'Cerrar su memoria' : 'Ver su memoria'}
                </button>
              )}
              {/* en rojo y con una pregunta detrás porque destruye contenido de
                  Daniel. Al lado de «Ver su memoria» y no junto a «Borrarlo»,
                  que es el de la ficha retroactiva: los dos botones de un mismo
                  texto tienen que ir juntos para que no se confundan */}
              {look.canForgetSealed && (
                <button
                  className="btn btn--danger"
                  // se apaga mientras la pregunta está abierta en vez de hacer
                  // de interruptor: cerrarla ya lo hace «Dejarlo estar», ahí
                  // debajo, y dos botones con la misma palabra en la misma fila
                  // se leen como dos cosas distintas
                  disabled={ocupado || borrando === row.conversationId}
                  title="Borra lo que ella recuerda de esta conversación. Los mensajes no se tocan"
                  onClick={() => {
                    setBorrando(row.conversationId);
                    // el acuse del borrado anterior se retira: dejarlo encima de
                    // una pregunta nueva diría que ésta ya se contestó
                    setBorrado(null);
                  }}
                >
                  Borrar su memoria
                </button>
              )}
              {look.canRead && (
                <button
                  className="btn btn--quiet"
                  title={
                    look.cardIsStale
                      ? 'La ficha que se escribió hacia atrás. Esta conversación ya tiene memoria propia, así que esto NO entra en ningún prompt: se conserva para que puedas leerla y borrarla'
                      : 'Léela antes de aprobarla: esto es lo que ella va a leer en cada mensaje de ese hilo'
                  }
                  onClick={() =>
                    setOpen(
                      abierto === 'card'
                        ? null
                        : { conversationId: row.conversationId, kind: 'card' },
                    )
                  }
                >
                  {abierto === 'card'
                    ? 'Cerrar'
                    : look.cardIsStale
                      ? 'Ver la ficha antigua'
                      : 'Ver'}
                </button>
              )}
              {look.canApprove && (
                <button
                  className="btn btn--quiet"
                  disabled={ocupado}
                  title="Hasta que no la apruebes no entra en ningún prompt"
                  onClick={() =>
                    void vault.decideRecap({
                      action: 'approve',
                      conversationId: row.conversationId,
                    })
                  }
                >
                  Aprobar
                </button>
              )}
              {/* borrarla devuelve esa conversacion a su aviso de turnos
                  omitidos, que es el estado seguro: eso hace el trabajo entero
                  reversible. Sin entrada no hay nada que borrar */}
              {row.hasEntry && (
                <button
                  className="btn btn--quiet"
                  disabled={ocupado}
                  title="Quita esta ficha. Esa conversación vuelve a avisarle de que le faltan turnos, que es el estado seguro"
                  onClick={() =>
                    void vault.decideRecap({
                      action: 'forget',
                      conversationId: row.conversationId,
                    })
                  }
                >
                  Borrarlo
                </button>
              )}
              {look.canRedo && (
                <button
                  className="btn btn--quiet"
                  disabled={ocupado}
                  title={
                    row.inPrompt
                      ? `Vuelve a leerla desde cero con ${CLI_LABELS[look.retryWith]}. Ojo: si esta vez no sale nada utilizable, esta ficha se queda como está y no se sustituye por una vacía`
                      : `Empieza esta conversación desde cero con ${CLI_LABELS[look.retryWith]}, y deja elegido ese CLI para el trabajo de fondo`
                  }
                  onClick={() => void rehacer(row.conversationId, look.retryWith)}
                >
                  {corriendo?.accion === 'rehacer' &&
                  corriendo.conversationId === row.conversationId
                    ? 'Rehaciendo…'
                    : look.redoLabel}
                </button>
              )}
            </div>

            {/* la pregunta dice las dos mitades, y la de «qué NO se toca» va
                primero: lo que da miedo al pulsar un botón rojo en una
                conversación es perderla, y hasta que eso no queda descartado no
                se lee nada más. Lo de volver a sellarse va DENTRO y no en una
                nota aparte porque sin saberlo se volvería a encontrar memoria
                en ese hilo y parecería que el borrado no funcionó */}
            {borrando === row.conversationId && (
              <>
                <Notice tone="warn">
                  <strong>Se borra sólo lo que ella recuerda de esta conversación:</strong>{' '}
                  el resumen que este hilo se escribió a sí mismo y que viaja dentro de
                  cada uno de sus mensajes. Es el texto que enseña «Ver su memoria».{' '}
                  <strong>No se toca nada más:</strong> los mensajes de la conversación
                  se quedan enteros, y sus imágenes también. Tampoco se tocan el catálogo
                  de escenas ni lo que quedó apuntado entre vosotros.{' '}
                  {/* «la ficha retroactiva tampoco se toca» SÓLO cuando además es
                      verdad de la que sirve: si esa ficha iba a empezar a viajar
                      al quitar la memoria, decir que no se toca es literalmente
                      cierto y materialmente engañoso, y de eso se encarga el
                      aviso rojo de abajo */}
                  {look.canRead && !look.forgetRevivesCard && (
                    <>
                      La ficha retroactiva se queda donde está —ésa la quita «Borrarlo»—
                      y borrar esto tampoco hace que pase a usarse.{' '}
                      {/* «se queda donde está» era verdad a medias y dos revisores
                          la cazaron: quitar la memoria propia devuelve esta
                          conversación a la pasada de fondo, que puede ampliar la
                          ficha. Ampliarla la deja sin aprobar, y eso sí es una
                          decisión de Daniel que desaparece. Se dice ANTES, aquí, y
                          además queda dicho DESPUÉS, en la propia fila */}
                      {look.forgetCostsApproval && (
                        <>
                          <strong>Eso sí:</strong> esta conversación vuelve al trabajo
                          de fondo, que puede ampliar esa ficha con los mensajes
                          nuevos. Si lo hace, la ficha se queda <strong>sin tu
                          aprobación</strong> hasta que la leas y la apruebes otra vez,
                          y mientras tanto no viaja. La fila te lo dirá.{' '}
                        </>
                      )}
                    </>
                  )}
                  <strong>Y se vuelve a escribir sola:</strong> en cuanto contestes otro
                  mensaje en este hilo, ella escribirá memoria nueva, desde cero y a
                  partir de los últimos mensajes. Esto limpia lo de antes; no apaga la
                  memoria de esta conversación para siempre.{' '}
                  {/* el alcance, que no es un detalle: `D-099` decide no propagar
                      el borrado —el registro ya subido conserva su memoria porque
                      la subida es inmutable— y a cambio obliga a decirlo aquí */}
                  <strong>Y borra en este equipo:</strong> lo que ya se había
                  sincronizado sigue en el servidor, así que en otro ordenador tuyo ella
                  lo seguirá recordando, y si esta conversación se descarga otra vez
                  desde cero, vuelve con ello.
                </Notice>
                {/* dos revisores lo encontraron por su cuenta, y es lo contrario de
                    lo que prometía el texto de arriba: `chooseConversationMemory`
                    sólo antepone la sellada, así que al quitarla la ficha
                    retroactiva de esta MISMA conversación vuelve a ser candidata y
                    entra en el prompt siguiente. Borrar no limpia: cambia un texto
                    por otro. Se dice ANTES de pulsar, y con la salida al lado */}
                {look.forgetRevivesCard && (
                  <Notice tone="fault">
                    <strong>Aquí borrar no deja el hilo a cero.</strong> Esta
                    conversación tiene además una ficha retroactiva —el resumen que se
                    escribió hacia atrás, el de «Ver la ficha antigua»— que hoy no entra
                    en ningún mensaje porque la memoria propia gana siempre. En cuanto
                    borres la memoria, <strong>esa ficha pasa a viajar</strong> en el
                    siguiente mensaje de este hilo: no se queda sin nada, se queda con
                    otro resumen de esta misma conversación. Léela antes de decidir con
                    «Ver la ficha antigua»; si tampoco la quieres, «Sí, borra las dos»
                    quita las dos de una vez.
                  </Notice>
                )}
                <div className="row">
                  {look.forgetRevivesCard ? (
                    <>
                      <button
                        className="btn btn--danger"
                        disabled={ocupado}
                        title="Quita las dos cosas: la memoria propia de este hilo y la ficha retroactiva. Los mensajes no se tocan"
                        onClick={() =>
                          void borrarMemoria(row.conversationId, {
                            tambienLaFicha: true,
                            revive: true,
                          })
                        }
                      >
                        {borrandoAhora?.conversationId === row.conversationId &&
                        borrandoAhora.conFicha
                          ? 'Borrando…'
                          : 'Sí, borra las dos'}
                      </button>
                      <button
                        className="btn btn--quiet"
                        disabled={ocupado}
                        title="Deja la ficha retroactiva donde está: desde el próximo mensaje será ella la que viaje"
                        onClick={() =>
                          void borrarMemoria(row.conversationId, {
                            tambienLaFicha: false,
                            revive: true,
                          })
                        }
                      >
                        {borrandoAhora?.conversationId === row.conversationId &&
                        !borrandoAhora.conFicha
                          ? 'Borrando…'
                          : 'Sólo la suya, y que pase a leer la ficha'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn--danger"
                      disabled={ocupado}
                      onClick={() =>
                        void borrarMemoria(row.conversationId, {
                          tambienLaFicha: false,
                          revive: false,
                        })
                      }
                    >
                      {borrandoAhora?.conversationId === row.conversationId
                        ? 'Borrando…'
                        : 'Sí, borra lo que recuerda'}
                    </button>
                  )}
                  <button
                    className="btn btn--quiet"
                    disabled={ocupado}
                    onClick={() => setBorrando(null)}
                  >
                    Dejarlo estar
                  </button>
                </div>
              </>
            )}

            {/* sin esto el borrado no se ve: la fila pierde sus botones y el
                recuadro se cierra, así que la pantalla queda más vacía que
                antes, que es como se ve un botón que no hace nada. El texto se
                arma fuera, en un módulo puro con pruebas, porque dos de sus
                frases eran falsas y sólo una prueba lo caza */}
            {borrado?.conversationId === row.conversationId && (
              <Notice tone="ok">
                {describeForgetAck({
                  turns: borrado.turnos,
                  cardNowInUse: borrado.fichaEnUso,
                })}
              </Notice>
            )}

            {abierto === 'sealed' && (
              <p className="vault-recap__block">{row.sealedBlock}</p>
            )}

            {abierto === 'card' && (
              <>
                {/* sin este aviso el bloque se leía como la memoria en uso, que
                    es justo lo que no es: esa conversación ya se escribió la
                    suya y la sellada gana siempre */}
                {look.cardIsStale && (
                  <Notice tone="warn">
                    Esto es la ficha que se escribió hacia atrás, <strong>antes</strong> de
                    que esta conversación tuviera memoria propia. Ya no viaja en ningún
                    mensaje: lo que ella lee es su memoria, ahí al lado. Se conserva
                    para que puedas leerla y, si no te sirve, borrarla.
                  </Notice>
                )}
                <p className="vault-recap__block">{row.block}</p>
              </>
            )}
          </div>
        );
      })}

      {/* el acuse cuando la fila ya no existe. Pasa de verdad, y justo en el
          caso de una conversación de prueba: excluida del trabajo de fondo y
          sin ficha, en cuanto pierde su memoria propia deja de salir en esta
          lista. Sin esto, pulsar el botón rojo hacía desaparecer la fila sin
          una sola palabra, que se lee igual que un fallo */}
      {borrado !== null &&
        !(rows ?? []).some((row) => row.conversationId === borrado.conversationId) && (
          <Notice tone="ok">
            {describeForgetAck({ turns: borrado.turnos, cardNowInUse: borrado.fichaEnUso })}{' '}
            Esta conversación ya no aparece en la lista porque no le queda nada que
            rellenar ni que borrar desde aquí.
          </Notice>
        )}
    </div>
  );
}

/**
 * el diagnostico de la memoria, en frases.
 *
 * Solo cifras sobre todas las conversaciones, nunca su contenido: es lo que
 * permite comprobar las mejoras sobre lo ya hablado sin sacar nada de la boveda.
 */
function MemoryDiagnosticsSummary({
  diagnostics,
}: {
  diagnostics: NonNullable<VaultController['lastDiagnostics']>;
}): JSX.Element {
  const c = diagnostics.conversations;
  const e = diagnostics.episodes;
  const i = diagnostics.index;
  const d = diagnostics.dateRecall;
  const o = diagnostics.origin;
  const s = diagnostics.style;
  const t = diagnostics.triggers;
  return (
    <div className="field__hint">
      <p>
        <strong>Cobertura:</strong> {c.cataloged} de {c.total} conversaciones con resumen y
        etiquetas; {c.gapOnly} solo troceadas por pausas, que no se encuentran por paráfrasis.
      </p>
      <p>
        <strong>Índice:</strong> {i.lines} de {e.total} momentos a la vista en cada mensaje
        {i.omitted > 0
          ? `; los otros ${i.omitted} se recuerdan igual por fecha o por palabras`
          : ''}
        . El primero de todos va siempre, con su resumen.
      </p>
      <p>
        <strong>Búsqueda por fecha:</strong> {d.hits} de {d.tested} días encontrados
        {d.missedDays.length > 0 ? ' · fallan: ' + d.missedDays.join(', ') : ''}
      </p>
      <p>
        <strong>Cómo os conocisteis:</strong> {o.found} de {o.probes} formas de preguntarlo
        traen el primer momento{o.day === null ? '' : `, que es del ${o.day}`}.
      </p>
      <p>
        <strong>Tu forma de escribir:</strong> {s.userMessages} mensajes, mediana de{' '}
        {s.medianChars} caracteres; {s.withTemporalReference} con fecha,{' '}
        {s.withMemoryRequest} pidiendo recuerdos y {s.withConversationRecall} hablando de lo
        dicho.
      </p>
      <p>
        <strong>Tus mensajes, pasados por la memoria:</strong> {t.byDate} habrían traído un
        momento por su fecha, {t.byOrigin} por cómo os conocisteis y {t.byWords} lo habrían
        buscado por palabras. {t.dateWithoutQuestion} nombraban un día sin preguntar nada y no
        dispararon, que es lo correcto.
        {t.dateWithoutMoment > 0
          ? ` ${t.dateWithoutMoment} preguntaban por un día en que no hablasteis.`
          : ''}
        {t.dateInHistory > 0
          ? ` ${t.dateInHistory} preguntaban por algo que ya estaba en la conversación.`
          : ''}
      </p>
      {diagnostics.scope.otherConversations > 0 && (
        <p>
          Medido sobre {diagnostics.scope.characterName ?? 'las conversaciones sin personaje'},
          como en un turno real; {diagnostics.scope.otherConversations} de otros personajes o
          sin personaje quedan fuera.
        </p>
      )}
      {/* la cobertura de la memoria acumulativa, que es lo que el diagnostico no
          medía: medía catálogo, fechas, estilo y disparos, y no cuántas
          conversaciones saben en qué punto quedaron */}
      {diagnostics.recaps !== undefined && (
        <p>
          <strong>Memoria de lo ya hablado:</strong> {diagnostics.recaps.summarized} de{' '}
          {diagnostics.recaps.summarized +
            diagnostics.recaps.withGaps +
            diagnostics.recaps.indexOnly +
            diagnostics.recaps.awaitingApproval +
            diagnostics.recaps.missing}{' '}
          conversaciones con ficha completa en el prompt; {diagnostics.recaps.withGaps} con tramos
          que nadie resumió, {diagnostics.recaps.indexOnly} sólo con el índice de sus escenas,{' '}
          {/* escrita y esperando NO es lo mismo que sin nada: decirlo junto hacía
              que esta frase dijera «0 de 17» justo después de escribir las 17 */}
          {diagnostics.recaps.awaitingApproval} escritas esperando que las apruebes y{' '}
          {diagnostics.recaps.missing} sin nada, que siguen avisándole de que les faltan turnos.{' '}
          {diagnostics.recaps.sealed} ya tienen memoria propia.
        </p>
      )}
      {diagnostics.relations !== undefined && (
        <PendingDiagnosticsSummary relations={diagnostics.relations} />
      )}
    </div>
  );
}

/**
 * lo pendiente entre los dos, en tres frases.
 *
 * Las tres contestan a preguntas distintas: si el trabajo de fondo va donde
 * debe y cuanto le queda, que hay apuntado, y —la que decide si merece la pena—
 * cada cuanto saldria y cuanto se inventa ella hoy.
 *
 * Va aparte de las de la memoria porque se lee aparte: son la misma pantalla
 * pero no la misma pregunta.
 */
function PendingDiagnosticsSummary({
  relations,
}: {
  relations: NonNullable<NonNullable<VaultController['lastDiagnostics']>['relations']>;
}): JSX.Element {
  const g = relations.catalogGuard;
  const c = relations.coverage;
  const n = relations.notes;
  const d = relations.dosing;
  const r = relations.raising;
  const revisadas = c.conversations - c.excludedSkipped;
  const frecuencia =
    d.userTurnsSimulated === 0
      ? 0
      : Math.round((100 * d.turnsWithBlock) / d.userTurnsSimulated);
  return (
    <>
      <p>
        <strong>Trabajo de fondo:</strong> {c.upToDate} de {revisadas} conversaciones revisadas
        con Codex o Claude, {c.behind} por detrás
        {c.turnsBehind > 0 ? ` (${c.turnsBehind} turnos sin leer)` : ''}
        {c.refusedPersisted > 0 ? `, ${c.refusedPersisted} negativas` : ''}
        {c.failedThisSession > 0 ? `, ${c.failedThisSession} fallidas en esta sesión` : ''}.
        {c.excludedSkipped > 0 ? ` ${c.excludedSkipped} excluidas quedan fuera.` : ''}
        {g.byOther > 0
          ? ` Cuidado: ${g.byOther} escenas del catálogo se hicieron con otro proveedor.`
          : ' Ninguna escena del catálogo salió a una API de pago.'}
        {g.legacyUnknown > 0
          ? ` ${g.legacyUnknown} son anteriores a la guarda y no dicen con qué se hicieron.`
          : ''}
      </p>
      <p>
        <strong>Pendientes:</strong> {n.byStatus.open} abiertos ({n.byWho.user} tuyos,{' '}
        {n.byWho.character} suyos, {n.byWho.both} de los dos), {n.byStatus.fulfilled} cumplidos,{' '}
        {n.byStatus.released} anulados y {n.byStatus.dismissed} descartados por ti.{' '}
        {relations.extraction.rejectedQuote} citas se rechazaron por no aparecer tal cual
        {relations.integrity.quoteBroken > 0
          ? `; ${relations.integrity.quoteBroken} apuntados ya no casan con su turno`
          : ''}
        {n.dormant > 0 ? `; ${n.dormant} llevan tanto tiempo callados que no saldrían` : ''}.
        {/* sólo si pasa: es la cifra que distingue «no había promesas» de «no se
            llegó a leer», y esa segunda se arregla en un sitio muy distinto */}
        {relations.extraction.clipped > 0
          ? ` Cuidado: ${relations.extraction.clipped} turnos se enviaron recortados, así que lo que se dijera en su centro no se apuntó.`
          : ''}
      </p>
      <p>
        <strong>Dosificación:</strong> saldría en el {frecuencia} % de tus mensajes (
        {d.turnsWithBlock} de {d.userTurnsSimulated}), como mucho{' '}
        {d.maxConsecutiveOffersSameNote} veces seguidas el mismo. Ella sacó{' '}
        {r.notesRaisedByHerBeforeHim} antes que tú, repitió {r.sameNoteWithin24h} dentro de las
        mismas 24 horas y reclamó {relations.inventionGuard.unbacked} cosas que no constan, de{' '}
        {relations.inventionGuard.herClaims}. Si ahora mismo le escribieras, saldrían{' '}
        {relations.nextTurn.linesForLatestConversation}.
      </p>
      {/* `D-104`: cuánto dispara la nota de «ya salió» y cuánto pesan las citas
          largas, donde casi nunca cuenta. Solo cifras */}
      <p>
        <strong>«Ya salió»:</strong> de las {r.herMentions} veces que ella sacó un pendiente,{' '}
        {r.herMentionsClear} habrían contado para la nota.
        {r.longQuotes > 0
          ? ` ${r.longQuotes} pendientes tienen una cita larga (nueve palabras con contenido o más); de esos los sacó ${r.herMentionsLong} veces y contaron ${r.herMentionsClearLong}.`
          : ''}
      </p>
    </>
  );
}
