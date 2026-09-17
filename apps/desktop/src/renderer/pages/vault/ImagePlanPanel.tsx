// el panel donde se lee —y se corrige— lo que va a salir hacia el generador.
//
// Vive en su propio archivo y no en `Vault.tsx` por una razon practica: esa
// pantalla son 5.500 lineas y otro bloque dentro no lo encontraria nadie. Y usa
// la forma del visor de archivos (`vault-viewer`), no la del cuadro de
// confirmacion: aquel esta copiado a mano en tres pantallas y esta hecho para
// dos lineas y dos botones. Aqui hay dos cuadros de texto largos, una tabla de
// parametros y tres decisiones distintas.
//
// REGLA: este componente no compone texto. El positivo y el negativo se
// corrigen a mano, y el texto unido que se enseña sale de `planFromEdit`, la
// MISMA funcion que aplicara el proceso principal al mandarlo. Si esto uniera
// por su cuenta, lo enseñado y lo enviado podrian dejar de ser lo mismo sin que
// fallara nada.
import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  IMAGE_PLAN_TEXT_LIMITS,
  imagePlanBlockReason,
  imagePlanEditFrom,
  imagePlanEstimateBlockReason,
  planFromEdit,
  restoreDroppedFragment,
  type HordeImagePlan,
  type ImageAttempt,
  type VaultImagePlan,
  type VaultImagePlanEdit,
} from '@luxy/shared';
import { Notice, Readout, Tag } from '../../ui/primitives.js';
import { describeQueue } from '../../../shared/horde-progress.js';
import type { VaultController } from '../../useVault.js';

/**
 * lo que costaria, preguntado en seco.
 *
 * `null` es «todavia no se ha preguntado», que no es lo mismo que «no hay
 * precio»: eso ultimo es `kudos: null` dentro de la respuesta.
 */
type Estimate = { kudos: number | null; warnings: { code: string; message: string }[] };

export function ImagePlanPanel({
  vault,
  attempt,
  onClose,
}: {
  vault: VaultController;
  /** el intento que espera decision, tal y como esta guardado en el registro */
  attempt: ImageAttempt;
  onClose: () => void;
}): JSX.Element {
  const plan = attempt.plan;
  // el borrador arranca del plan guardado. Se reinicia al cambiar de intento
  // porque el texto de una peticion no vale para la siguiente
  const [edit, setEdit] = useState<VaultImagePlanEdit | null>(
    plan === null ? null : imagePlanEditFrom(plan),
  );
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    setEdit(plan === null ? null : imagePlanEditFrom(plan));
    // un precio preguntado para el texto anterior no dice nada de este
    setEstimate(null);
    setDecided(false);
  }, [attempt.attemptId, plan]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // en un panel a pantalla casi completa lo primero que se pulsa es Escape;
      // cerrar no decide nada: el intento sigue esperando en el registro
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="vault-viewer"
      role="dialog"
      aria-modal="true"
      // cerrar al pulsar FUERA y no dentro: sin la comprobacion, escribir en el
      // positivo cerraba el panel con cada clic
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="vault-viewer__panel">
        <div className="vault-viewer__head">
          <strong>Lo que se va a mandar</strong>
          <button className="btn btn--quiet" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {plan === null || edit === null ? (
          <Notice tone="warn">
            Este intento no llegó a componer ningún texto, así que no hay nada que revisar. Queda
            apuntado en el registro con su motivo; pídele la foto otra vez.
          </Notice>
        ) : (
          <PlanBody
            vault={vault}
            attempt={attempt}
            plan={plan}
            edit={edit}
            onEdit={setEdit}
            estimate={estimate}
            onEstimate={setEstimate}
            decided={decided}
            onDecided={() => {
              setDecided(true);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

function PlanBody({
  vault,
  attempt,
  plan,
  edit,
  onEdit,
  estimate,
  onEstimate,
  decided,
  onDecided,
}: {
  vault: VaultController;
  attempt: ImageAttempt;
  plan: VaultImagePlan;
  edit: VaultImagePlanEdit;
  onEdit: (edit: VaultImagePlanEdit) => void;
  estimate: Estimate | null;
  onEstimate: (estimate: Estimate | null) => void;
  decided: boolean;
  onDecided: () => void;
}): JSX.Element {
  // el texto unido y el origen salen de la misma funcion que los calculara al
  // mandarlo: aqui no se une nada a mano
  const preview = useMemo(() => planFromEdit(plan, edit), [plan, edit]);
  const busy = vault.generating || vault.estimatingImage || decided;
  const blockReason = imagePlanBlockReason({ state: attempt.state, edit, busy });
  const estimateReason = imagePlanEstimateBlockReason({ state: attempt.state, edit, busy });
  const edited = preview !== null && preview.source === 'editado';

  /** se manda lo que hay escrito, o `null` si no se ha tocado nada */
  const editToSend = (): VaultImagePlanEdit | null => (edited ? edit : null);

  return (
    <>
      {edit.provider === 'horde' ? (
        <>
          <label className="field__hint" htmlFor="plan-positivo">
            <strong>Positivo</strong> · la apariencia fija y la ropa van delante de la escena a
            propósito: los primeros tokens pesan más, y con la escena delante la cara deja de
            repetirse.
          </label>
          <textarea
            id="plan-positivo"
            className="vault-caption"
            rows={8}
            value={edit.positive}
            disabled={busy}
            onChange={(event) => onEdit({ ...edit, positive: event.target.value })}
          />
          <p className="field__hint">
            {edit.positive.length} de {IMAGE_PLAN_TEXT_LIMITS.positive} caracteres.
          </p>

          <label className="field__hint" htmlFor="plan-negativo">
            <strong>Negativo</strong> · lo que el generador debe evitar. Sale del negativo de la
            receta fundido con el fijo de la bóveda.
          </label>
          <textarea
            id="plan-negativo"
            className="vault-caption"
            rows={4}
            value={edit.negative}
            disabled={busy}
            onChange={(event) => onEdit({ ...edit, negative: event.target.value })}
          />
          <p className="field__hint">
            {edit.negative.length} de {IMAGE_PLAN_TEXT_LIMITS.negative} caracteres.
          </p>
        </>
      ) : (
        <>
          <label className="field__hint" htmlFor="plan-escena">
            <strong>Escena</strong> · es lo único que viaja.
          </label>
          <textarea
            id="plan-escena"
            className="vault-caption"
            rows={8}
            value={edit.prompt}
            disabled={busy}
            onChange={(event) => onEdit({ provider: 'xavira', prompt: event.target.value })}
          />
          <p className="field__hint">
            {edit.prompt.length} de {IMAGE_PLAN_TEXT_LIMITS.prompt} caracteres.
          </p>
          <Notice tone="warn">
            La identidad del personaje vive en el servidor del proveedor, detrás de su
            identificador. El texto completo que allí se ejecuta{' '}
            <strong>no existe en este equipo</strong>: esto es sólo el trozo que se envía, y el
            negativo de aquí abajo es una constante del programa que no se puede corregir.
          </Notice>
          {plan.provider === 'xavira' && plan.negativeAppend.length > 0 && (
            <p className="vault-media__prompt">Negativo fijo: {plan.negativeAppend}</p>
          )}
        </>
      )}

      {preview !== null && preview.plan.provider === 'horde' && (
        <>
          <p className="field__hint">
            <strong>Tal y como saldrá.</strong> AI Horde no tiene campo de negativo: lo lee del
            propio texto, detrás de <code> ### </code>.
          </p>
          <p className="vault-media__prompt">{preview.plan.joined}</p>
        </>
      )}

      {plan.provider === 'horde' && plan.dropped.length > 0 && (
        <>
          {/* el ejemplo del pelo sólo valía cuando se recortaban colores. Desde que el
              recorte cubre también complexión y rubor, explicar un rubor quitado con «salió
              una morena» no tiene ningún sentido para quien lo lee */}
          <p className="field__hint">
            El recorte automático le quitó esto a la escena porque la apariencia fija ya lo dice.
            Repetirlo con otras palabras le resta peso al resto, y si las dos versiones no
            coinciden, el generador recibe dos descripciones de la misma persona. Si lo pedías a
            propósito, devuélvelo:
          </p>
          <div className="row">
            {plan.dropped.map((fragment) => (
              <button
                key={fragment}
                className="btn btn--quiet"
                disabled={busy || edit.provider !== 'horde'}
                onClick={() => {
                  if (edit.provider !== 'horde') return;
                  onEdit({
                    ...edit,
                    positive: restoreDroppedFragment(edit.positive, fragment),
                  });
                }}
              >
                + {fragment}
              </button>
            ))}
          </div>
        </>
      )}

      {plan.provider === 'horde' && <HordeParams plan={plan} />}

      {edited && (
        <Notice tone="warn">
          Has cambiado el texto, así que se mandará <strong>tal cual</strong>: sin recorte de rasgos
          y sin anteponer nada. Queda apuntado como escrito a mano, que es lo que dentro de un mes
          explicará una imagen que no se parece al personaje.
        </Notice>
      )}

      <Notice tone="idle">
        Lo que se guarda es lo que se <strong>mandó</strong>, que no es necesariamente lo que se
        ejecutó: el servidor puede sustituir términos y bajar pasos o resolución por su cuenta, y
        eso no llega hasta aquí.
      </Notice>

      {estimate !== null && (
        <Notice tone="ok">
          {estimate.kudos === null
            ? 'El servidor aceptó la petición en seco pero no dijo el precio.'
            : `Costaría unos ${estimate.kudos} kudos, que no son dinero: sólo tu puesto en la cola.`}{' '}
          El dry run comprueba la <strong>forma</strong> —que los parámetros estén en rango y que el
          modelo exista— y da el precio. No predice que te la censuren: eso lo decide después el
          worker que la atienda.
          {estimate.warnings.map((warning) => (
            <span key={warning.code}>
              {' · '}
              <Tag tone="warn">{warning.code}</Tag> {warning.message}
            </span>
          ))}
        </Notice>
      )}

      {vault.hordeProgress !== null && (
        <Notice tone={vault.hordeProgress.processing > 0 ? 'ok' : 'idle'}>
          {describeQueue(vault.hordeProgress)}
        </Notice>
      )}

      {blockReason !== null && <Notice tone="warn">{blockReason}</Notice>}

      <div className="row">
        <button
          className="btn btn--primary"
          disabled={blockReason !== null}
          onClick={() => {
            void vault
              .commitImagePlan({ attemptId: attempt.attemptId, edit: editToSend() })
              .then((ok) => {
                if (ok) onDecided();
              });
          }}
        >
          {vault.generating ? 'Generando…' : 'Generar con este texto'}
        </button>
        <button
          className="btn btn--quiet"
          disabled={estimateReason !== null}
          onClick={() => {
            onEstimate(null);
            void vault
              .estimateImagePlan({ attemptId: attempt.attemptId, edit: editToSend() })
              .then((result) => {
                if (result !== null) onEstimate(result);
              });
          }}
        >
          {vault.estimatingImage ? 'Comprobando…' : 'Comprobar coste'}
        </button>
        <button
          className="btn btn--quiet"
          disabled={busy}
          onClick={() => {
            void vault.discardImagePlan(attempt.attemptId).then((ok) => {
              if (ok) onDecided();
            });
          }}
        >
          Descartar
        </button>
      </div>

      {estimateReason !== null && edit.provider === 'xavira' && (
        <p className="field__hint">{estimateReason}</p>
      )}
    </>
  );
}

/**
 * los parametros que deciden como se dibuja, en solo lectura.
 *
 * No se editan a mano a proposito: `clipSkip` lo fija el modelo y un lado que no
 * sea multiplo de 64 lo rechaza el servidor DESPUES de encolar, cuando ya no se
 * le puede explicar a nadie. Se cambian en la receta del personaje.
 */
function HordeParams({ plan }: { plan: HordeImagePlan }): JSX.Element {
  const { params } = plan;
  return (
    <>
      <Readout
        items={[
          { label: 'Modelos', value: params.models.join(', ') },
          { label: 'Tamaño', value: `${params.width} × ${params.height}` },
          { label: 'Pasos', value: params.steps },
          { label: 'CFG', value: params.cfgScale },
          { label: 'CLIP skip', value: params.clipSkip },
          { label: 'Sampler', value: `${params.samplerName} · ${params.scheduler}` },
          {
            label: 'LoRAs',
            value:
              params.loras.length === 0
                ? 'ninguno'
                : params.loras.map((lora) => lora.name).join(', '),
          },
          { label: 'Hires fix', value: params.hiresFix ? 'sí' : 'no' },
          {
            label: 'Postproceso',
            value:
              params.postProcessing.length === 0 ? 'ninguno' : params.postProcessing.join(', '),
          },
          { label: 'Reinterpretación', value: params.denoisingStrength },
          {
            label: 'Semilla',
            value: params.seed === null ? 'la sortea el servidor' : params.seed,
            tone: params.seed === null ? 'warn' : undefined,
          },
        ]}
      />
      {params.seed === null && (
        <p className="field__hint">
          Sin semilla fija, AI Horde sortea una en cada generación: por eso dos peticiones con este
          mismo texto dan imágenes distintas. La que usó de verdad queda apuntada en el registro
          cuando la imagen llega.
        </p>
      )}
      <p className="field__hint">
        La <strong>reinterpretación</strong> sólo cuenta cuando se parte de una imagen que ya
        existe, y por este camino no se parte de ninguna.
        {params.shared && ' Esta receta dona lo generado al conjunto público de AI Horde.'}
      </p>
    </>
  );
}
