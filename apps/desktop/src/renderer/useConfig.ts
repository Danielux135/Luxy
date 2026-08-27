// configuracion y secretos en el renderer.
//
// el renderer nunca guarda un valor de clave. `secrets.configured` es un mapa de
// nombre -> booleano, y eso es todo lo que React llega a saber.
import { useCallback, useEffect, useState } from 'react';
import type { StoredAgentConfig } from '@luxy/shared';

export interface SecretsSummary {
  encryptionAvailable: boolean;
  configured: Record<string, boolean>;
}

export interface ConfigSummary {
  configured: boolean;
  configPath: string;
  config: StoredAgentConfig | null;
  secrets: SecretsSummary;
}

const EMPTY: ConfigSummary = {
  configured: false,
  configPath: '',
  config: null,
  secrets: { encryptionAvailable: false, configured: {} },
};

export function useConfig(): {
  summary: ConfigSummary;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  save: (
    config: unknown,
    providerSecret?: { name: string; value: string },
  ) => Promise<boolean>;
  setSecret: (name: string, value: string) => Promise<boolean>;
  deleteSecret: (name: string) => Promise<boolean>;
} {
  const [summary, setSummary] = useState<ConfigSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await window.luxy.getConfig();
    if (result.ok) {
      setSummary(result.value as ConfigSummary);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void window.luxy.getConfig().then((result) => {
      if (!active) return;
      if (result.ok) setSummary(result.value as ConfigSummary);
      else setError(result.error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (
    config: unknown,
    providerSecret?: { name: string; value: string },
  ) => {
    const result = await window.luxy.saveConfig(config, providerSecret);
    if (result.ok) {
      setSummary(result.value as ConfigSummary);
      setError(null);
      return true;
    }
    setError(result.error);
    return false;
  }, []);

  const setSecret = useCallback(async (name: string, value: string) => {
    const result = await window.luxy.setSecret(name, value);
    if (result.ok) {
      setSummary((previous) => ({ ...previous, secrets: result.value as SecretsSummary }));
      setError(null);
      return true;
    }
    setError(result.error);
    return false;
  }, []);

  const deleteSecret = useCallback(async (name: string) => {
    const result = await window.luxy.deleteSecret(name);
    if (result.ok) {
      setSummary((previous) => ({ ...previous, secrets: result.value as SecretsSummary }));
      return true;
    }
    setError(result.error);
    return false;
  }, []);

  return { summary, loading, error, reload, save, setSecret, deleteSecret };
}
