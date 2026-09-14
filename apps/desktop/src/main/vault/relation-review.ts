// la lista para corregir: lo que Daniel ve de cada pendiente y lo que decide.
//
// Por que existe. El extractor acierta casi siempre, pero «casi» no basta
// cuando el error se paga en boca de ella: una frase de coqueteo tomada por
// promesa acaba en un reproche por algo que nadie prometio. La defensa no es
// afinar el extractor —la cita se verifica, la intencion no se puede— sino que
// Daniel repase la lista ANTES de encender el bloque y tenga la ultima palabra
// despues.
//
// Dos piezas, las dos PURAS: la proyeccion de lo guardado a lo que se enseña, y
// la transicion que aplica su decision. Sin disco, sin reloj —el instante se
// inyecta— y sin IPC, que es lo que las hace probables de una en una.
//
// Lo que NO hay aqui, a proposito: alta a mano. Todo pendiente señala un turno
// real con una cita que el codigo comprueba; uno escrito a mano no tendria
// contra que verificarse y seria justo el agujero por el que ella podria
// reclamar algo que nunca se dijo.
import {
  ACTIVE_RELATION_KINDS,
  civilDayLabel,
  quoteAppearsIn,
  type ActiveRelationKind,
  type RelationKind,
  type RelationNote,
  type RelationParty,
  type RelationStatus,
  type RelationTurnRef,
  type TemporalAnchor,
} from '@luxy/shared';

/** un pendiente tal y como se enseña para repasarlo */
export interface RelationReviewItem {
  id: string;
  /** de quien es, deducido de su conversacion de origen (`D-062`) */
  characterId: string | null;
  kind: ActiveRelationKind;
  by: RelationParty;
  /** LITERAL: es lo que se dijo, y es lo unico que permite juzgar si cuenta */
  quote: string;
  /** el dia civil en que se prometio, con el mismo corte de las 05:00 */
  day: string;
  status: RelationStatus;
  /** quien puso el estado actual; el extractor nunca pisa a 'daniel' */
  decidedBy: 'extractor' | 'daniel';
  reopenedByDaniel: boolean;
  /** con que CLI se reviso, para poder decir «revisado con Codex» */
  extractedBy: string | null;
  /** a donde apunta: con esto se abre el turno y se lee en su contexto */
  origin: { conversationId: string; sequence: number };
  /**
   * la cita ya no aparece en su turno.
   *
   * Pasa si el turno se retiro o si su numero se reutilizo. Una nota asi NO se
   * le ofrece a ella —lo filtra la seleccion—, y enseñarlo aqui es la unica
   * forma de que Daniel sepa por que un pendiente que ve en la lista no sale
   * nunca.
   */
  quoteBroken: boolean;
  /** el dia en que se cerro, si esta cerrada */
  closedDay: string | null;
}

export interface RelationReviewInput {
  /** todo lo guardado, tal y como esta en el almacen */
  notes: readonly RelationNote[];
  /** de quien es cada conversacion que sigue existiendo */
  owners: ReadonlyMap<string, string | null>;
  /** el turno de origen tal y como esta AHORA; `null` si ya no esta */
  turnAt: (ref: RelationTurnRef) => { text: string } | null;
  /** la zona y el corte del dia: los mismos que usa el resto de la boveda */
  anchor: TemporalAnchor;
}

/**
 * lo abierto primero.
 *
 * Es lo unico que puede salir por su boca, asi que es lo unico que corre prisa
 * repasar. Lo cerrado se queda debajo, visible: una lapida que no se ve no se
 * puede reabrir cuando el que se equivoco fue Daniel.
 */
const STATUS_ORDER: Record<RelationStatus, number> = {
  open: 0,
  fulfilled: 1,
  released: 2,
  dismissed: 3,
};

function isActiveKind(kind: RelationKind): kind is ActiveRelationKind {
  const active: readonly RelationKind[] = ACTIVE_RELATION_KINDS;
  return active.includes(kind);
}

/**
 * lo guardado, proyectado a lo que se repasa.
 *
 * Solo promesas y planes: una version posterior puede guardar otros `kind` —el
 * animo, lo que ella sabe de el— y esos no son pendientes de nadie. Tirarlos de
 * la lista no los borra, porque el almacen conserva lo que no entiende.
 */
export function listRelationsForReview(input: RelationReviewInput): RelationReviewItem[] {
  const dated = input.notes.flatMap((note) => {
    const kind = note.kind;
    if (!isActiveKind(kind)) return [];

    const turn = input.turnAt(note.origin);
    const item: RelationReviewItem = {
      id: note.id,
      // una nota cuya conversacion ya no esta se queda sin dueño en vez de
      // colarse en el grupo de otro: borrarla la sacaria del alcance de
      // Daniel, y es justo la que puede haber quedado mal
      characterId: input.owners.get(note.origin.conversationId) ?? null,
      kind,
      by: note.by,
      quote: note.quote,
      day: civilDayLabel(note.origin.at, input.anchor),
      status: note.status,
      decidedBy: note.decidedBy,
      reopenedByDaniel: note.reopenedByDaniel,
      extractedBy: note.extractedBy,
      origin: { conversationId: note.origin.conversationId, sequence: note.origin.sequence },
      quoteBroken: turn === null || !quoteAppearsIn(note.quote, turn.text),
      closedDay: note.closure === null ? null : civilDayLabel(note.closure.at, input.anchor),
    };
    return [{ item, at: note.origin.at }];
  });

  // por el instante y no por el dia civil: dos promesas de la misma noche
  // tienen el mismo dia, y ordenarlas por el las dejaria en el orden en que
  // salieron del almacen, que cambia al reextraer
  dated.sort(
    (a, b) =>
      STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status] ||
      b.at.localeCompare(a.at) ||
      a.item.id.localeCompare(b.item.id),
  );
  return dated.map((entry) => entry.item);
}

/**
 * lo que decide Daniel.
 *
 * El estado ES la decision: `fulfilled` (cumplida), `released` (ya no vale),
 * `dismissed` (no era una promesa) y `open` (reabrir). No hay un enum aparte a
 * proposito: uno paralelo se separaria del que guarda el almacen, y entonces un
 * boton dejaria de hacer lo que dice.
 *
 * Lo que hace inviolable la decision es `decidedBy: 'daniel'`: `mergeExtraction`
 * no toca una nota que lo lleve, asi que ni la reabre ni la vuelve a cerrar por
 * su cuenta. Sin eso, descartar un falso positivo duraria hasta la siguiente
 * pasada del extractor.
 */
export function decideRelation(
  note: RelationNote,
  status: RelationStatus,
  now: string,
): RelationNote {
  if (status === 'open') {
    return {
      ...note,
      status,
      // el cierre se va entero: dejarlo haria que el panel siguiera enseñando
      // «cumplida el 4» debajo de algo que vuelve a estar pendiente
      closure: null,
      decidedBy: 'daniel',
      // la marca es historia y no se quita nunca: dice que este pendiente
      // volvio porque el lo pidio. Reabrir lo ya abierto no la enciende
      reopenedByDaniel: note.reopenedByDaniel || note.status !== 'open',
      updatedAt: now,
    };
  }

  return {
    ...note,
    status,
    // `ref: null` porque lo cerro EL, no un turno. Apuntar aqui un turno
    // inventado haria que el panel enseñara una cita de cierre que nadie dijo
    closure: { how: status, ref: null, at: now },
    decidedBy: 'daniel',
    updatedAt: now,
  };
}
