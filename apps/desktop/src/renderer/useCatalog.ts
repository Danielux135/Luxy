// catálogo operativo compartido por las pantallas que ejecutan modelos.
import { useEffect, useState } from 'react';
import {
  buildCatalogForConnection,
  buildDefaultCatalog,
  type CatalogSnapshot,
  type ModelDefinition,
} from '@luxy/shared';
import type { ConfigSummary } from './useConfig.js';

export function useDetectedCatalog(summary: ConfigSummary): {
  models: ModelDefinition[];
  snapshot: CatalogSnapshot | null;
  loading: boolean;
} {
  const connectionId = summary.config?.connections?.[0]?.id ?? null;
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(connectionId !== null);

  useEffect(() => {
    if (connectionId === null) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void window.luxy.readCatalog(connectionId).then((result) => {
      if (!active) return;
      setSnapshot(result.ok ? result.value.snapshot : null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [connectionId]);

  const models =
    connectionId === null || loading
      ? []
      : snapshot?.connectionId === connectionId
        ? buildCatalogForConnection(
            connectionId,
            snapshot.models.map((model) => model.apiModel),
          )
        : buildDefaultCatalog(connectionId);

  return { models, snapshot, loading };
}
