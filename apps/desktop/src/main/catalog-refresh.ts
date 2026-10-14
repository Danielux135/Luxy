// la peticion del catalogo real: que lista se pide, cuando se cae a la simple
// y cuando NO se escribe lo que llego.
//
// POR QUE EXISTE (F36): todo esto vivia dentro del manejador `catalogRefresh`,
// que no tenia ni una prueba, y tenia tres agujeros:
//
//  - cualquier fallo se quedaba en un null y el codigo HTTP se perdia: un 429
//    pasajero y una URL mal escrita daban el mismo «no devolvio la lista de
//    modelos», sin nada que hacer con el;
//  - un 200 con otra forma no era un fallo. Salian cero modelos y ese catalogo
//    vacio se ESCRIBIA encima del bueno;
//  - a un host con dialecto de catalogo (NanoGPT) hay que pedirle la lista con
//    detalle, la unica que trae los niveles de razonamiento que declara cada
//    modelo. Caer a la simple sin mas ante un fallo pasajero borraria los
//    niveles de todos los modelos ya leidos.
//
// Aqui no hay disco, ni Electron, ni reloj propio: el `fetch`, quien lee y
// quien escribe el catalogo y la hora llegan por parametro, y por eso se prueba
// sin red. El manejador se queda con lo unico que necesita su contexto: sacar
// la URL de la configuracion guardada y la clave del almacen, que nunca cruzan
// el IPC.
import {
  basicCatalogModelsUrl,
  buildCatalogSnapshot,
  catalogDialectFor,
  catalogModelsUrl,
  type CatalogDetail,
  type CatalogSnapshot,
  type CatalogSource,
} from '@luxy/shared';

/**
 * cuanto se espera a la pasarela. Es el de siempre, y cubre tambien la lectura
 * del cuerpo: una respuesta que empieza y no acaba cuenta como que no llego.
 */
export const CATALOG_REFRESH_TIMEOUT_MS = 30_000;

/**
 * lo que dice el catalogo de un host SIN dialecto sobre los precios. Es el
 * texto de siempre, letra por letra.
 */
export const NO_PRICING_NOTICE = 'Esta conexion no publica precios por API; Luxy no los consulta.';

/**
 * lo minimo de `fetch` que se usa aqui. El global encaja tal cual, y una prueba
 * puede dar una respuesta de tres campos sin construir una `Response` entera.
 */
export type CatalogFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** a quien se le pregunta. Todo sale del proceso principal, nada del renderer */
export interface CatalogRefreshTarget {
  connectionId: string;
  source: CatalogSource;
  /** la de la configuracion GUARDADA */
  baseUrl: string;
  /** ya descifrada. Solo viaja en la cabecera: ni al catalogo ni a un mensaje */
  apiKey: string;
}

export interface CatalogRefreshDeps {
  fetchImpl: CatalogFetch;
  /**
   * el catalogo guardado de ESE origen, o null. Lleva los dos datos porque una
   * conexion y un proveedor HTTP pueden llamarse igual y no comparten catalogo
   */
  readSnapshot: (connectionId: string, source: CatalogSource) => CatalogSnapshot | null;
  writeSnapshot: (snapshot: CatalogSnapshot) => void;
  /** la hora que se guarda como fecha de lectura */
  now: () => Date;
}

/**
 * el catalogo no se pudo actualizar.
 *
 * El mensaje es lo que ve el usuario, entero: que paso, con el codigo HTTP si
 * lo hubo, si se conserva lo que tenia y que hacer. Nunca lleva el texto del
 * error original —puede traer la URL, y la de una conexion admite credenciales
 * incrustadas—, ni la clave.
 */
export class CatalogRefreshError extends Error {
  constructor(
    message: string,
    /** el codigo HTTP del fallo que decidio; null si no hubo respuesta */
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'CatalogRefreshError';
  }
}

/** por que una lista no sirve */
type ListFailure =
  | { kind: 'http'; status: number }
  | { kind: 'not-json'; status: number }
  /**
   * contesto bien y sin un solo modelo legible. Lleva el catalogo vacio que
   * salio, por si no hay nada que perder y se acaba guardando
   */
  | { kind: 'no-models'; status: number; snapshot: CatalogSnapshot }
  /**
   * se pidio con detalle y llego con modelos, pero sin nada de lo que solo trae
   * la lista con detalle: es la simple, contestada a otra peticion
   */
  | { kind: 'no-detail'; status: number }
  | { kind: 'timeout' }
  | { kind: 'unreachable' };

type ListReading = { ok: true; snapshot: CatalogSnapshot } | { ok: false; failure: ListFailure };

/** el fallo en pocas palabras, para ir entre parentesis en el mensaje */
function describeFailure(failure: ListFailure): string {
  switch (failure.kind) {
    case 'http':
      return `HTTP ${failure.status}`;
    case 'not-json':
      return `HTTP ${failure.status} con una respuesta que no es JSON`;
    case 'no-models':
      return `HTTP ${failure.status} sin ningún modelo que Luxy pueda leer`;
    case 'no-detail':
      return `HTTP ${failure.status} con la lista sin el detalle de ningún modelo`;
    case 'timeout':
      return `sin respuesta en ${Math.round(CATALOG_REFRESH_TIMEOUT_MS / 1000)} segundos`;
    case 'unreachable':
      return 'no se pudo llegar al servidor';
  }
}

function statusOf(failure: ListFailure): number | null {
  return 'status' in failure ? failure.status : null;
}

/**
 * que hacer, segun lo que fallo.
 *
 * Los codigos se leen por lo que significan en HTTP, no por lo que haga cada
 * pasarela: son una pista de por donde empezar, no un diagnostico.
 */
function adviceFor(failure: ListFailure): string {
  if (failure.kind === 'http') {
    if (failure.status === 401 || failure.status === 403) {
      return 'Revisa la clave guardada y vuelve a actualizar los modelos.';
    }
    if (failure.status === 404) return 'Revisa la URL base y vuelve a actualizar los modelos.';
    if (failure.status === 429) {
      return 'Suele ser un límite de peticiones: espera un momento y vuelve a actualizar los modelos.';
    }
    return 'Vuelve a actualizar los modelos dentro de un momento; si se repite, revisa la URL base.';
  }
  if (failure.kind === 'timeout' || failure.kind === 'unreachable') {
    return 'Comprueba la conexión a internet y la URL base, y vuelve a actualizar los modelos.';
  }
  // la URL contesto un 200 y con modelos: es la de la API, y mandar a revisarla
  // seria un consejo falso. Lo unico que cabe es volver a pedir la lista
  if (failure.kind === 'no-detail') return 'Vuelve a actualizar los modelos dentro de un momento.';
  return 'Revisa que la URL base sea la de la API y vuelve a actualizar los modelos.';
}

/**
 * si un modelo trae algo de lo que solo declara la lista con detalle.
 *
 * Un catalogo es `detailed` por lo que LLEGO, no por lo que se pidio: una
 * pasarela puede contestar un 200 con la lista simple a quien le pide el
 * detalle. Sellada como `detailed`, la pantalla afirmaria de cada modelo que
 * la pasarela «no declara niveles», cuando es que no se llego a leer ninguno.
 */
function carriesDeclaredDetail(model: CatalogSnapshot['models'][number]): boolean {
  return (
    model.reasoning !== undefined ||
    model.reasoningEfforts !== undefined ||
    model.declaredOutputCap !== undefined ||
    model.declaredContext !== undefined
  );
}

function countModels(count: number): string {
  return count === 1 ? '1 modelo' : `${count} modelos`;
}

/**
 * como se nombra a quien se le pregunta. Un host con dialecto tiene nombre
 * propio; del resto solo se sabe de que lista de la configuracion sale.
 */
function gatewayName(target: CatalogRefreshTarget, hasDialect: boolean): string {
  if (hasDialect) return catalogDialectFor(target.baseUrl)?.label ?? 'la pasarela';
  return target.source === 'http' ? 'el proveedor' : 'la conexión';
}

/**
 * el codigo del sistema de un fallo al escribir (`EPERM`, `ENOSPC`), si lo trae.
 * Solo el codigo: el mensaje de Node lleva la ruta del archivo.
 */
function writeErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(code) ? ` (${code})` : '';
}

/**
 * pide el catalogo de un origen y lo guarda, sin perder por el camino lo que
 * ya habia.
 *
 * Las reglas, que son lo que se prueba:
 *
 *  1. a un host con dialecto de catalogo se le pide la lista CON DETALLE. Si
 *     contesta y al menos un modelo trae algo de ese detalle, se guarda como
 *     `detailed`;
 *  2. si esa falla —no llega, no es 2xx, no es JSON, viene sin modelos o llega
 *     sin el detalle de ningun modelo— y lo guardado es `detailed`, NO se toca:
 *     error con el codigo, y lo anterior se conserva. Solo cuando no habia nada
 *     con detalle que perder se pide la simple, y se guarda como `basic` con el
 *     motivo en su aviso;
 *  3. a un host sin dialecto, la simple de siempre, y el catalogo no dice con
 *     que lista se leyo;
 *  4. un catalogo de cero modelos nunca se escribe encima de uno que los tiene.
 *     Sin nada que perder si se escribe, como antes: lleva la cuenta de las
 *     filas que no se pudieron leer, que es lo unico que explica el vacio.
 *
 * Devuelve el catalogo que ha quedado guardado. Si no se guarda nada, lanza
 * `CatalogRefreshError`.
 */
export async function refreshCatalog(
  target: CatalogRefreshTarget,
  deps: CatalogRefreshDeps,
): Promise<CatalogSnapshot> {
  // quien decide que se pide es `catalogModelsUrl`, que es quien tiene las
  // pruebas de «que URL para que host»; aqui solo se le obedece
  const plan = catalogModelsUrl(target.baseUrl);
  const gateway = gatewayName(target, plan.detailed);

  // lo guardado solo hace falta cuando algo va mal, y entonces se lee una vez
  let lookedUp = false;
  let previous: CatalogSnapshot | null = null;
  const saved = (): CatalogSnapshot | null => {
    if (!lookedUp) {
      previous = deps.readSnapshot(target.connectionId, target.source);
      lookedUp = true;
    }
    return previous;
  };

  const readList = async (
    url: string,
    detail: CatalogDetail | undefined,
    notice: string,
  ): Promise<ListReading> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOG_REFRESH_TIMEOUT_MS);
    let status: number;
    let payload: unknown;
    try {
      const response = await deps.fetchImpl(url, {
        headers: { Authorization: `Bearer ${target.apiKey}` },
        signal: controller.signal,
      });
      status = response.status;
      if (!response.ok) return { ok: false, failure: { kind: 'http', status } };
      try {
        payload = await response.json();
      } catch {
        // el corte por tiempo tambien puede caer leyendo el cuerpo, y entonces
        // no es que la respuesta venga rota: es que no llego entera
        if (controller.signal.aborted) return { ok: false, failure: { kind: 'timeout' } };
        return { ok: false, failure: { kind: 'not-json', status } };
      }
    } catch {
      // el error original no se guarda ni se enseña: trae la URL
      return {
        ok: false,
        failure: { kind: controller.signal.aborted ? 'timeout' : 'unreachable' },
      };
    } finally {
      clearTimeout(timer);
    }

    const snapshot = buildCatalogSnapshot({
      connectionId: target.connectionId,
      source: target.source,
      fetchedAt: deps.now().toISOString(),
      modelsPayload: payload,
      pricingPayload: null,
      notice,
      ...(detail === undefined ? {} : { detail }),
    });
    if (snapshot.models.length === 0) {
      return { ok: false, failure: { kind: 'no-models', status, snapshot } };
    }
    // basta con un modelo: uno recien añadido del que la pasarela aun no dice
    // nada no convierte la lista con detalle en la simple
    if (detail === 'detailed' && !snapshot.models.some(carriesDeclaredDetail)) {
      return { ok: false, failure: { kind: 'no-detail', status } };
    }
    return { ok: true, snapshot };
  };

  const store = (snapshot: CatalogSnapshot): CatalogSnapshot => {
    try {
      deps.writeSnapshot(snapshot);
    } catch (error) {
      throw new CatalogRefreshError(
        `la lista de modelos llegó, pero no se pudo guardar en este equipo${writeErrorCode(error)}. Comprueba que queda espacio en el disco y que la carpeta de datos de Luxy se puede escribir, y vuelve a actualizar los modelos.`,
        null,
      );
    }
    return snapshot;
  };

  /**
   * la ultima lista que se pide, sea la simple de siempre o el respaldo.
   * `what` es lo que se cuenta del fallo; con respaldo trae los dos intentos.
   */
  const settle = (
    reading: ListReading,
    what: (failure: ListFailure) => string,
  ): CatalogSnapshot => {
    if (reading.ok) return store(reading.snapshot);
    const { failure } = reading;
    const before = saved();
    const kept = before !== null && before.models.length > 0;
    if (failure.kind === 'no-models' && !kept) return store(failure.snapshot);
    throw new CatalogRefreshError(
      `${gateway} no devolvió la lista de modelos (${what(failure)}).` +
        (kept
          ? ` Se conserva el catálogo anterior, con ${countModels(before.models.length)}.`
          : '') +
        ` ${adviceFor(failure)}`,
      statusOf(failure),
    );
  };

  if (!plan.detailed) {
    return settle(await readList(plan.url, undefined, NO_PRICING_NOTICE), describeFailure);
  }

  // un catalogo leido de un host con dialecto no puede decir que la pasarela
  // «no publica precios»: seria afirmar algo de un tercero, y la lectura previa
  // de F36 apunto que la lista con detalle de NanoGPT si los trae. Es Luxy
  // quien no los lee (alcance de F36), y eso es lo unico que se afirma
  const pricing = `Luxy no lee los precios de ${gateway}.`;

  const detailed = await readList(plan.url, 'detailed', pricing);
  if (detailed.ok) return store(detailed.snapshot);

  const before = saved();
  if (before !== null && before.detail === 'detailed') {
    throw new CatalogRefreshError(
      `${gateway} no devolvió la lista de modelos con detalle (${describeFailure(detailed.failure)}). ` +
        `Se conserva el catálogo anterior, con ${countModels(before.models.length)}: Luxy no lo cambia por la lista simple, que no trae los niveles de razonamiento. ` +
        adviceFor(detailed.failure),
      statusOf(detailed.failure),
    );
  }

  // no habia nada con detalle que perder: mejor una lista sin niveles que
  // ninguna. El motivo va en el aviso del catalogo, que es lo unico que queda
  // de este intento cuando el respaldo sale bien y no hay error que enseñar
  const whyBasic = describeFailure(detailed.failure);
  const basic = await readList(
    basicCatalogModelsUrl(target.baseUrl),
    'basic',
    `${gateway} no devolvió la lista de modelos con detalle (${whyBasic}): este catálogo se leyó sin detalle y no trae los niveles de razonamiento que declara cada modelo. Vuelve a actualizar los modelos para pedirla otra vez. ${pricing}`,
  );
  return settle(
    basic,
    (failure) => `con detalle, ${whyBasic}; sin detalle, ${describeFailure(failure)}`,
  );
}

/** la misma llamada que `refreshCatalog`, para quien la recibe ya protegida */
export type CatalogRefresher = (
  target: CatalogRefreshTarget,
  deps: CatalogRefreshDeps,
) => Promise<CatalogSnapshot>;

/**
 * un `refreshCatalog` que no deja dos refrescos en curso del mismo origen.
 *
 * POR QUE: `refreshCatalog` decide «no hay nada con detalle que perder, caigo a
 * la lista simple» y escribe DESPUES de esperar a la red, y la pantalla tiene
 * dos botones que actualizan el mismo proveedor, cada uno con su propio
 * «Actualizando…». Con dos refrescos a la vez, uno guardaba la lista con
 * detalle y el otro, que ya habia decidido caer a la simple, la pisaba al
 * llegar: los niveles de todos los modelos, borrados por orden de llegada.
 *
 * El que llega con uno en curso no espera turno ni se rechaza: recibe ESA MISMA
 * promesa. Pidio lo mismo al mismo origen y lo que quiere es el catalogo que
 * queda guardado, que es justo lo que devuelve el que ya va de camino. Sus
 * `target` y `deps` no se usan: si la URL o la clave guardadas cambiaron entre
 * las dos llamadas, la respuesta es la de la primera, y la siguiente
 * actualizacion ya pregunta con lo nuevo.
 *
 * El hueco se libera al terminar, acabe bien o mal: un fallo no puede dejar a
 * un origen sin poder actualizarse hasta reiniciar Luxy.
 *
 * Es una fabrica, como `createAuxiliaryLane`: el registro es de quien registra
 * los manejadores, y cada prueba estrena el suyo.
 */
export function createCatalogRefresher(): CatalogRefresher {
  const inFlight = new Map<string, Promise<CatalogSnapshot>>();

  return (target, deps) => {
    // el origen es la lista de la configuracion de la que sale y su
    // identificador en ella: una conexion y un proveedor HTTP pueden llamarse
    // igual. `source` es un enum sin `:`, asi que dos origenes distintos no
    // pueden dar la misma clave.
    //
    // NO es el nombre de archivo del catalogo, a proposito. Ese lo decide el
    // almacen, y hoy da el mismo a dos origenes distintos: la conexion `http-x`
    // y el proveedor `x` comparten `http-x.json`. Con ese nombre como clave, uno
    // de los dos recibiria el catalogo del otro, pedido a otra URL y con otra
    // clave. Que esos dos se pisen en disco no lo arregla este registro, ni a
    // la vez ni por turnos: es del almacen
    const key = `${target.source}:${target.connectionId}`;
    const running = inFlight.get(key);
    if (running !== undefined) return running;

    // entre mirar el registro y apuntarse no hay ningun `await`: nadie se cuela.
    // Y sin `async` a proposito: envolveria la promesa en otra
    const started = refreshCatalog(target, deps).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, started);
    return started;
  };
}
