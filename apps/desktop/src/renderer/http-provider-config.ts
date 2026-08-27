import { httpProviderConfigSchema } from '@luxy/shared';
import type { StoredAgentConfig } from '@luxy/shared';

export type HttpProviderConfig = StoredAgentConfig['providers']['http'][number];

export interface HttpProviderDraft {
  id: string;
  displayName: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  supportsStreaming: boolean;
  maxOutputTokens: string;
  dailyBudget: string;
}

export interface HttpProviderBuildResult {
  provider: HttpProviderConfig | null;
  error: string | null;
}

export function emptyHttpProviderDraft(): HttpProviderDraft {
  return {
    id: '',
    displayName: '',
    baseUrl: '',
    model: '',
    enabled: true,
    supportsStreaming: true,
    maxOutputTokens: '8192',
    dailyBudget: '0',
  };
}

export function httpProviderToDraft(provider: HttpProviderConfig): HttpProviderDraft {
  return {
    id: provider.id,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    model: provider.model,
    enabled: provider.enabled,
    supportsStreaming: provider.supportsStreaming,
    maxOutputTokens: String(provider.maxOutputTokens),
    dailyBudget: String(provider.dailyBudget),
  };
}

/** el nombre interno no lo decide el renderer ni se muestra como campo libre */
export function apiKeyNameForProvider(id: string): string {
  return `LUXY_HTTP_${id.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

export function buildHttpProvider(
  draft: HttpProviderDraft,
  existing: HttpProviderConfig | null,
): HttpProviderBuildResult {
  const id = draft.id.trim().toLowerCase();
  const parsed = httpProviderConfigSchema.safeParse({
    id,
    displayName: draft.displayName.trim(),
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
    model: draft.model.trim(),
    apiKeyEnv: existing?.apiKeyEnv ?? apiKeyNameForProvider(id),
    enabled: draft.enabled,
    supportsStreaming: draft.supportsStreaming,
    maxOutputTokens: Number(draft.maxOutputTokens),
    dailyBudget: Number(draft.dailyBudget),
    ...(existing?.softTerminalGraceMs === undefined
      ? {}
      : { softTerminalGraceMs: existing.softTerminalGraceMs }),
  });
  if (parsed.success) return { provider: parsed.data, error: null };

  return {
    provider: null,
    error: parsed.error.issues
      .slice(0, 3)
      .map((issue) => issue.message)
      .join('; '),
  };
}
