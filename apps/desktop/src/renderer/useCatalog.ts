// catálogo operativo compartido por las pantallas que ejecutan modelos.
//
// POR QUÉ MIRA DOS LISTAS: Luxy guarda las conexiones en dos sitios distintos,
// `connections` y `providers.http`, y esto sólo leía la PRIMERA de la primera
// —escrito a mano como `connections[0]`—. Con eso, un proveedor HTTP no
// aparecía nunca: añadir Mistral y pulsar «Actualizar modelos» volvía a
// preguntarle a la pasarela de siempre, y su selector de modelo salía vacío.
import { useEffect, useState } from 'react';
import {
  buildCatalogForConnection,
  buildDefaultCatalog,
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
  }, [clave]);

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
        return buildCatalogForConnection(
          origin.id,
          snapshot.models.map((model) => model.apiModel),
          origin.family ?? undefined,
        );
      });

  // dos orígenes pueden servir el mismo modelo, y su identificador se deriva
  // del nombre: sin esto saldría repetido en cada selector. Gana el primero,
  // que es el orden en que están configurados
  const vistos = new Set<string>();
  const models = todos.filter((model) => {
    if (vistos.has(model.id)) return false;
    vistos.add(model.id);
    return true;
  });

  return { models, loading };
}
