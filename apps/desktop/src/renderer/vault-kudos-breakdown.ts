// como se lee el saldo de AI Horde, con su desglose.
//
// Vive fuera del JSX por lo mismo que `vault-recap-row.ts`: dentro era una
// cadena de ternarios que solo se podia comprobar abriendo la aplicacion, y lo
// que decide no es estetica. La pantalla enseñaba un total —25— que no se
// movia nunca, y de ahi se dedujo mal lo que pasaba. La misma respuesta que ya
// se pedia trae el reparto de ese total, y el reparto cuenta otra cosa:
//
//   - `accumulated` va en CRUDO, sin recortarlo al minimo. El contrato lo
//     define como «Kudos accumulated or used for generating images», asi que
//     no es solo gasto: por ahi entra tambien lo que paga prestar la GPU;
//   - las casillas de entrada con nombre propio a cero dicen que por ESAS no
//     ha entrado nada. No dicen nada de lo que cae en `accumulated`;
//   - y un total quieto se explica por el minimo del tipo de cuenta, que el
//     servidor declara en `pseudonymous`. Si no lo declara, no se afirma cual.
//
// Regla que manda aqui: `null` es «el servidor no lo dijo» y NUNCA vale cero.
// Un cero afirma —por ahi no ha entrado nada— y la ausencia no afirma nada, asi
// que lo ausente no se pinta ni se suma. Lo mismo con una suma incompleta: se
// dice de que casillas sale, nunca «en total».
//
// PURO: recibe la cuenta tal y como llega del proceso principal y devuelve como
// se pinta.
import type { z } from 'zod';
import type { vaultHordeAccountResultSchema, vaultHordeKudosDetailsSchema } from '../shared/ipc.js';

export type KudosDetailsView = z.infer<typeof vaultHordeKudosDetailsSchema>;
type HordeAccount = z.infer<typeof vaultHordeAccountResultSchema>;

/** una fila del recuadro, ya escrita */
export interface KudosRow {
  label: string;
  value: string;
}

export interface KudosBreakdownView {
  /** filas que se añaden a las de siempre. Vacio = el desglose no vino */
  rows: KudosRow[];
  /** lo entrado POR ESAS casillas, en una frase. `null` si no vino ninguna */
  income: string | null;
  /** que es la casilla `accumulated`. `null` si el servidor no la mando */
  spending: string | null;
  /** por que el total no baja. `null` si no hay nada comprobado que decir */
  floor: string | null;
}

/**
 * las casillas por las que un kudos puede ENTRAR con nombre propio.
 *
 * Las etiquetas son la descripcion del contrato y nada mas, porque de ahi
 * vinieron los adornos que hubo que quitar: `awarded` no es «por valorar
 * imagenes» —el contrato dice «from things like rating images», y ademas hay
 * un endpoint AwardKudos—, `recurring` no dice de que recompensa se trata y
 * `admin` no dice que sea un regalo.
 */
const INCOME_LABELS: { key: keyof KudosDetailsView; label: string }[] = [
  { key: 'awarded', label: 'Premios recibidos' },
  { key: 'received', label: 'Regalos de otras personas' },
  { key: 'styled', label: 'Por estilizar peticiones de otros' },
  { key: 'recurring', label: 'Recompensas recurrentes' },
  { key: 'admin', label: 'Dados por los administradores' },
];

/** lo que SALE porque se ha regalado: solo se enseña si de verdad hay algo */
const OUTGOING_LABELS: { key: keyof KudosDetailsView; label: string }[] = [
  { key: 'gifted', label: 'Regalados a otras personas' },
  { key: 'donated', label: 'Donados a cuentas de bien público' },
];

/** en castellano y con el separador de aqui; sin decimales de adorno */
export function formatKudos(value: number): string {
  return value.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

/**
 * el minimo por debajo del cual el servidor no deja caer ESTA cuenta.
 *
 * El tipo de cuenta lo DECLARA el servidor, ya no se deduce del saldo: el
 * contrato define `pseudonymous` como «If true, this user has not registered
 * using an oauth service». Deducirlo del numero era el camino al reves, y es
 * lo que produjo la frase que nombraba a Google, Discord y GitHub: ningun
 * campo de la respuesta dice con QUE servicio se registro uno, asi que aqui
 * se dice «un servicio externo» y se para ahi.
 *
 * `service` NO sirve para esto aunque lo parezca: el contrato lo define como
 * «This is a service account used by a horde proxy», una cuenta de proxy.
 *
 * Los tres numeros salen de `get_min_kudos()` del servidor, leido en la
 * auditoria. Sin tipo declarado no se afirma ningun minimo.
 */
function minimumFor(account: HordeAccount): { kudos: number; kind: string } | null {
  // el caso anonimo no viene del Horde: lo calcula Studio mirando la clave
  if (account.anonymous) return { kudos: -50, kind: 'la clave anónima' };
  if (account.pseudonymous === true) {
    return { kudos: 14, kind: 'una cuenta de usuario y contraseña' };
  }
  if (account.pseudonymous === false) {
    return { kudos: 25, kind: 'una cuenta registrada con un servicio externo' };
  }
  return null;
}

function floorNote(account: HordeAccount): string | null {
  const minimum = minimumFor(account);
  if (minimum === null) {
    // sin tipo de cuenta no se sabe cual es su minimo, asi que solo se cuenta
    // lo que se ve: el contador de cobros se mueve y el saldo no
    const charged = account.kudosDetails?.accumulated ?? null;
    if (charged === null || charged >= 0) return null;
    return `El Horde ha ido cobrando por generar y el saldo sigue en ${formatKudos(account.kudos)}. El servidor no ha dicho de qué tipo es esta cuenta: lo más probable es que ese número sea el mínimo de su tipo, pero no está comprobado.`;
  }
  if (account.kudos !== minimum.kudos) return null;
  return `Esos ${formatKudos(minimum.kudos)} no son lo que queda: son el mínimo de ${minimum.kind}. El Horde cobra cada imagen y después devuelve la cuenta al mínimo, así que el número no baja.`;
}

export function describeKudosBreakdown(account: HordeAccount): KudosBreakdownView {
  const floor = floorNote(account);
  const details = account.kudosDetails;
  if (details === null) {
    return { rows: [], income: null, spending: null, floor };
  }

  const counted = INCOME_LABELS.filter((entry) => details[entry.key] !== null);
  const total = counted.reduce((sum, entry) => sum + (details[entry.key] ?? 0), 0);

  const rows: KudosRow[] = [];
  let income: string | null = null;

  if (counted.length > 0) {
    // «ninguno» solo si NINGUNA via se ha movido. Una suma de cero con casillas
    // distintas de cero diria que no ha entrado nada, y si habria entrado algo
    const quieto = counted.every((entry) => details[entry.key] === 0);
    rows.push({
      label: 'Kudos que han entrado',
      value: quieto ? 'ninguno' : formatKudos(total),
    });
    // el detalle solo cuando hay algo que detallar: cinco ceros seguidos
    // esconden el unico dato que importa, que es que la suma es cero
    for (const entry of counted) {
      const value = details[entry.key] ?? 0;
      if (value !== 0) rows.push({ label: entry.label, value: formatKudos(value) });
    }
    // «en total» solo si estan las cinco casillas. Con alguna en silencio la
    // suma es parcial, y llamarla total afirmaria lo que no se ha contado
    const completo = counted.length === INCOME_LABELS.length;
    if (!quieto) {
      income = completo
        ? `Por estas cinco casillas han entrado ${formatKudos(total)} kudos.`
        : `De las casillas que el servidor ha contado salen ${formatKudos(total)} kudos; las demás no las ha mandado.`;
    } else if (completo) {
      // el alcance es EXACTAMENTE las cinco casillas de INCOME_LABELS: lo que
      // paga prestar la GPU cae en `accumulated` y no se mira aqui
      income =
        'Ni un kudos por premios, regalos, estilos, recompensas recurrentes ni administradores. Lo que paga prestar la GPU no se cuenta aquí.';
    } else {
      income = 'De las casillas que el servidor ha contado no ha entrado ni un kudos.';
    }
  }

  for (const entry of OUTGOING_LABELS) {
    const value = details[entry.key];
    if (value !== null && value !== 0) rows.push({ label: entry.label, value: formatKudos(value) });
  }

  let spending: string | null = null;
  if (details.accumulated !== null) {
    rows.push({ label: 'Acumulado o gastado', value: formatKudos(details.accumulated) });
    spending =
      'Ahí el Horde apunta lo que cobra por generar, pero también lo que paga prestar la GPU: no es sólo gasto. Va en crudo, sin recortar al mínimo, así que se mueve aunque el saldo se quede quieto.';
  }

  return { rows, income, spending, floor };
}
