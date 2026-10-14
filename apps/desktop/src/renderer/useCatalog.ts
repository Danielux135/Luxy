// catálogo operativo compartido por las pantallas que ejecutan modelos.
//
// POR QUÉ MIRA DOS LISTAS: Luxy guarda las conexiones en dos sitios distintos,
// `connections` y `providers.http`, y esto sólo leía la PRIMERA de la primera
// —escrito a mano como `connections[0]`—. Con eso, un proveedor HTTP no
// aparecía nunca: añadir Mistral y pulsar «Actualizar modelos» volvía a
// preguntarle a la pasarela de siempre, y su selector de modelo salía vacío.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  buildCatalogForConnection,
  buildDefaultCatalog,
  mergeCatalogs,
  type CatalogSnapshot,
  type CatalogSource,
  type ModelDefinition,
  type StoredAgentConfig,
} from '@luxy/shared';
import { callBridge } from './bridge-call.js';
import type { ConfigSummary } from './useConfig.js';

/** un sitio al que se le puede preguntar qué modelos sirve */
export interface CatalogOrigin {
  id: string;
  source: CatalogSource;
  /** lo que se lee en el selector */
  displayName: string;
  /**
   * familia con la que se AGRUPAN sus modelos, si la impone el origen.
   *
   * Una conexión agregadora sirve muchas familias y hay que adivinarlas por el
   * nombre. Un proveedor HTTP no, así que se le pasa su propio identificador y
   * se agrupa todo junto.
   *
   * OJO: esto agrupa, no decide quién ejecuta. `buildServedModel` sólo acepta
   * el valor si además es una familia REAL (`MODEL_FAMILIES`), así que para
   * `horde-cydonia`, `groq` y `ovh-nemo` se descarta y la familia se adivina
   * del nombre: `Cydonia-24B` acaba en `other` y el de OVH en `mistral`, que
   * aquí es otra pasarela. Quién ejecuta lo dice `providerCandidatesForModel`
   * mirando `origin`, y ésa fue la mitad del fallo del 2026-09-15.
   */
  family: string | null;
}

/**
 * los dos orígenes juntos, en el orden en que se ofrecen.
 *
 * Es puro a propósito: decidir a quién hay que preguntarle es justo la parte
 * que estaba mal y la que conviene poder probar sin una ventana delante.
 */
export function catalogOriginsOf(config: StoredAgentConfig | null): CatalogOrigin[] {
  if (config === null) return [];
  const conexiones: CatalogOrigin[] = config.connections.map((connection) => ({
    id: connection.id,
    source: 'connection',
    displayName: connection.displayName,
    family: null,
  }));
  const http: CatalogOrigin[] = config.providers.http.map((provider) => ({
    id: provider.id,
    source: 'http',
    displayName: provider.displayName,
    family: provider.id,
  }));
  return [...conexiones, ...http];
}

/** la clave con la que se distingue un origen de otro; los ids se repiten */
export function catalogOriginKey(origin: Pick<CatalogOrigin, 'id' | 'source'>): string {
  return `${origin.source}:${origin.id}`;
}

// -----------------------------------------------------------------------------
// aviso de catálogo nuevo
// -----------------------------------------------------------------------------
//
// POR QUÉ EXISTE: «Actualizar modelos» escribía el catálogo en disco y nadie
// más se enteraba. Cada pantalla lee el suyo al montarse, así que el selector
// de modelo de Privado seguía vacío después de descargarlo —medido: el catálogo
// se escribió once segundos después de arrancar la aplicación— y sólo se
// arreglaba reiniciando Luxy. Un contador con suscripción es lo mínimo que
// hace falta: no hay estado que compartir, sólo «vuelve a leer».

let version = 0;
const oyentes = new Set<() => void>();

/** avisa a toda la ventana de que hay un catálogo nuevo en disco */
export function catalogChanged(): void {
  version += 1;
  for (const oyente of oyentes) oyente();
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

function useCatalogVersion(): number {
  return useSyncExternalStore(
    suscribir,
    () => version,
    // el renderizado del servidor no existe aquí, pero la firma lo pide y
    // devolver otra cosa provocaría un desajuste de hidratación
    () => version,
  );
}

/**
 * el catálogo de TODOS los orígenes configurados, junto.
 *
 * Junto y no uno elegido: quien lo consume filtra por PROVEEDOR con
 * `modelsForProvider`, así que tener todos los modelos en la misma lista es lo
 * correcto. Uno que ejecuta otro proveedor no se ofrece igualmente.
 *
 * Y lleva los orígenes apagados a propósito: sus modelos siguen en el catálogo
 * del disco y se marcan «sin proveedor» en pantalla, que explica más que
 * desaparecer sin decir nada.
 */
export function useDetectedCatalog(summary: ConfigSummary): {
  models: ModelDefinition[];
  loading: boolean;
} {
  const origins = catalogOriginsOf(summary.config);
  // una cadena y no el array: el array se construye nuevo en cada render y
  // como dependencia dispararía el efecto para siempre
  const clave = origins.map(catalogOriginKey).join(',');
  // vuelve a leer cuando alguien descarga un catálogo nuevo, no sólo cuando
  // cambia la lista de orígenes
  const catalogVersion = useCatalogVersion();
  const [snapshots, setSnapshots] = useState<Map<string, CatalogSnapshot | null>>(new Map());
  const [loading, setLoading] = useState(clave.length > 0);

  useEffect(() => {
    if (clave.length === 0) {
      setSnapshots(new Map());
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const pendientes = clave.split(',').map(async (key) => {
      const [source, ...resto] = key.split(':');
      const id = resto.join(':');
      const result = await window.luxy.readCatalog({
        connectionId: id,
        source: source as CatalogSource,
      });
      return [key, result.ok ? result.value.snapshot : null] as const;
    });
    void Promise.all(pendientes).then((entries) => {
      if (!active) return;
      setSnapshots(new Map(entries));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [clave, catalogVersion]);

  // mientras se lee no hay nada que ofrecer; después, lo construido para ESTA
  // lectura, que `detectedModelsOf` recuerda en vez de rehacerlo en cada render
  const models = loading ? [] : detectedModelsOf(origins, snapshots);

  return { models, loading };
}

/** lo último construido para cada lectura; se va con ella cuando nadie la usa */
const construidos = new WeakMap<
  ReadonlyMap<string, CatalogSnapshot | null>,
  { clave: string; models: ModelDefinition[] }
>();

/**
 * los modelos de todos los orígenes, a partir de los catálogos leídos.
 *
 * RECUERDA LO CONSTRUIDO POR LECTURA. Antes esta cuenta vivía en el cuerpo del
 * gancho y se repetía en cada render de quien lo usa, y cada modelo servido
 * pasa por la validación de su esquema. El gancho se llama en la raíz de la
 * aplicación, junto al estado de Privado, que cambia con cada tecla: con los
 * 644 modelos de NanoGPT eso son 644 validaciones por tecla. Está leído en el
 * código, no medido en la ventana. El resultado sólo puede cambiar cuando se
 * lee otro catálogo —`snapshots` es entonces OTRO mapa— o cuando cambia la
 * lista de orígenes, así que con el mismo mapa y los mismos orígenes se
 * devuelve la MISMA lista, sin volver a construir nada.
 *
 * De cada origen sólo cuentan su identificador y de cuál de las dos listas
 * sale: la familia se deriva de eso (`catalogOriginsOf`) y el nombre no entra
 * en la cuenta. Por eso basta con la clave de los orígenes para saber si son
 * los mismos.
 *
 * El mapa no se toca después de pasarlo —el gancho crea uno nuevo en cada
 * lectura—, y quien recibe la lista no la modifica: es la misma para todos los
 * renders.
 */
export function detectedModelsOf(
  origins: readonly CatalogOrigin[],
  snapshots: ReadonlyMap<string, CatalogSnapshot | null>,
): ModelDefinition[] {
  const clave = origins.map(catalogOriginKey).join(',');
  const previo = construidos.get(snapshots);
  if (previo !== undefined && previo.clave === clave) return previo.models;

  const todos = origins.flatMap((origin) => {
    const snapshot = snapshots.get(catalogOriginKey(origin));
    // sin catálogo leído se usa el de fábrica, y sólo para una conexión: de
    // un proveedor HTTP no sabemos nada hasta preguntarle, y rellenarlo con
    // modelos de otra pasarela ofrecería nombres que ese proveedor no sirve
    if (snapshot == null) {
      return origin.source === 'connection' ? buildDefaultCatalog(origin.id) : [];
    }
    // se pasan los registros enteros y no solo los nombres: llevan lo que
    // la pasarela declara que sabe hacer cada uno, que es lo que marca
    // cuáles aceptan imágenes sin tener que deducirlo del nombre
    return buildCatalogForConnection(origin.id, snapshot.models, origin.family ?? undefined);
  });

  // dos orígenes pueden servir el mismo modelo, y su identificador se deriva
  // del nombre: sin esto saldría repetido en cada selector.
  //
  // Se renombra en vez de descartar. Descartar era lo que había, y con las
  // cuatro conexiones de Daniel a la MISMA pasarela de AI Horde —las cuatro
  // devuelven los mismos 27 nombres— tres de ellas se quedaban sin un solo
  // modelo: `modelsForProvider` empareja por `connectionId`, así que sus
  // selectores salían vacíos sin ninguna explicación.
  const models = mergeCatalogs(todos);
  construidos.set(snapshots, { clave, models });
  return models;
}

// -----------------------------------------------------------------------------
// el catálogo guardado de UN origen
// -----------------------------------------------------------------------------

/**
 * el catálogo guardado de un origen, tal y como lo ve una pantalla.
 *
 * `loading` es «todavía no se ha leído», y mientras lo sea `snapshot` no dice
 * nada: un `null` ahí NO significa que no haya catálogo. Hace falta la
 * diferencia porque de «no hay catálogo» salen frases que se le enseñan al
 * usuario —«pulsa Actualizar modelos»— y marcas sobre lo que tiene guardado.
 */
export interface StoredCatalog {
  snapshot: CatalogSnapshot | null;
  loading: boolean;
}

/** lo último leído, con el origen del que se leyó */
interface StoredCatalogRead {
  key: string;
  snapshot: CatalogSnapshot | null;
}

/**
 * lo que se enseña a partir de lo último leído.
 *
 * Una lectura de OTRO origen no vale: enseñarla pondría los niveles de una
 * pasarela bajo el nombre de otra. Sin nada leído de éste, sigue «leyendo»,
 * también si nadie lo ha pedido todavía: lo que no se puede hacer es dar por
 * inexistente un catálogo que no se ha mirado.
 */
export function storedCatalogView(read: StoredCatalogRead | null, key: string): StoredCatalog {
  if (read === null || read.key !== key) return { snapshot: null, loading: true };
  return { snapshot: read.snapshot, loading: false };
}

/**
 * lee el catálogo guardado de un origen. Sólo lee el disco: no pregunta a nadie.
 *
 * `null` es «no hay nada que enseñar»: no existe, no se pudo leer o el puente
 * falló. En los tres casos la salida para el usuario es la misma —volver a
 * actualizar los modelos—, y es ese botón el que dice el error si lo hay.
 */
export async function readStoredCatalog(
  id: string,
  source: CatalogSource,
): Promise<CatalogSnapshot | null> {
  // por `callBridge`: un rechazo del puente dejaría la pantalla «leyendo» para
  // siempre, con el guardado bloqueado y sin decir por qué
  const result = await callBridge(() => window.luxy.readCatalog({ connectionId: id, source }));
  return result.ok ? result.value.snapshot : null;
}

/**
 * el catálogo guardado de UN origen, leído sólo cuando hace falta.
 *
 * POR QUÉ NO SIRVEN LOS OTROS DOS: `useDetectedCatalog` convierte lo leído en
 * modelos operativos y por el camino pierde lo que la pasarela DECLARA de cada
 * uno —niveles de razonamiento, tope de salida—; y el de la página de Modelos
 * es de un único origen elegido en un desplegable. La sección «Ajustes por
 * modelo» de un proveedor necesita el catálogo de ESE proveedor, entero.
 *
 * `active` existe porque hay una tarjeta por proveedor: leyendo al montar
 * serían tantas lecturas de disco como proveedores para una sección que casi
 * siempre está cerrada. Con `active` a false no se lee nada, y lo que ya se
 * hubiera leído se conserva.
 *
 * Vuelve a leer cuando alguien descarga un catálogo nuevo (`catalogChanged`):
 * es lo que hace que el botón «Actualizar modelos de este proveedor» se note
 * en el selector de al lado. Mientras llega la lectura nueva se sigue
 * enseñando la anterior, que es lo que había en disco hasta ese momento.
 */
export function useStoredCatalog(
  id: string,
  source: CatalogSource,
  active: boolean,
): StoredCatalog {
  const catalogVersion = useCatalogVersion();
  const [read, setRead] = useState<StoredCatalogRead | null>(null);
  const key = catalogOriginKey({ id, source });

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void readStoredCatalog(id, source).then((snapshot) => {
      if (alive) setRead({ key: catalogOriginKey({ id, source }), snapshot });
    });
    return () => {
      alive = false;
    };
  }, [active, id, source, catalogVersion]);

  // el MISMO objeto mientras no cambie lo leído: quien lo reciba puede pasarlo
  // de dependencia sin que cada render parezca un catálogo nuevo
  return useMemo(() => storedCatalogView(read, key), [read, key]);
}
