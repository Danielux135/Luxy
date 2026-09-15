// catálogo operativo compartido por las pantallas que ejecutan modelos.
//
// POR QUÉ MIRA DOS LISTAS: Luxy guarda las conexiones en dos sitios distintos,
// `connections` y `providers.http`, y esto sólo leía la PRIMERA de la primera
// —escrito a mano como `connections[0]`—. Con eso, un proveedor HTTP no
// aparecía nunca: añadir Mistral y pulsar «Actualizar modelos» volvía a
// preguntarle a la pasarela de siempre, y su selector de modelo salía vacío.
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  buildCatalogForConnection,
  buildDefaultCatalog,
  mergeCatalogs,
  type CatalogSnapshot,
  type CatalogSource,
  type ModelDefinition,
  type StoredAgentConfig,
} from '@luxy/shared';
import type { ConfigSummary } from './useConfig.js';

/** un sitio al que se le puede preguntar qué modelos sirve */
export interface CatalogOrigin {
  id: string;
  source: CatalogSource;
  /** lo que se lee en el selector */
  displayName: string;
  /**
   * familia con la que se registran TODOS sus modelos, si la impone el origen.
   *
   * Una conexión agregadora sirve muchas familias y hay que adivinarlas por el
   * nombre. Un proveedor HTTP no: el agente lo registra bajo su identificador,
   * y el identificador de proveedor ES la familia con la que se ejecuta.
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
 * Junto y no uno elegido: quien lo consume filtra por familia, así que tener
 * todos los modelos en la misma lista es lo correcto. Un modelo de una familia
 * que no es la del proveedor activo no se ofrece igualmente.
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

  const todos = loading
    ? []
    : origins.flatMap((origin) => {
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

  return { models, loading };
}
